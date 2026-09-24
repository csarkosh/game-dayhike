import { type Rgb } from "./colour.js";
import { latticeHash } from "./groundHexParams.js";
import { BLADE_TRIS, BLADE_VERTS, createStripWriter, type StripArrays } from "./bladeClump.js";

/**
 * The duff clumps: dead leaves, twigs and small branches lying on the forest
 * floor, built from the blade strip writer so they shade and collapse like
 * the blades, on a lattice hash so they need no asset. Babylon-free; the
 * shell (duffMeshes.ts) wraps the arrays in meshes. The trail's own litter
 * (a separate piece of work) calls `duffClumpGeometry` with its own strength.
 *
 * A piece is a strip written upright by the writer, then laid down: rotated
 * about its root so its length runs along a ground direction with a lift at
 * the far end, drawn per piece from the character's own `lift` range. The
 * `blade` attribute keeps the piece's root, so the field's collapse pulls the
 * whole piece to a point exactly as it does a blade.
 *
 * A character's `lift` range is not free to tune by eye: a flat piece sitting
 * exactly at the ground-cover field's sampled height can be occluded outright
 * by the true (correctly rendered) ground surface between the eye and it —
 * ordinary grazing-angle line-of-sight blockage on a curved slope, nothing to
 * do with z-fighting — and a piece too short to rise clear of that reads as
 * nothing at all rather than as litter. The leaf character's own range
 * ([0.1, 0.5] rad) was raised from a near-flat [0.0, 0.12] for exactly this
 * reason: at its previous range it was invisible from an ordinary downhill
 * eye line despite every other property being correct, and only widening
 * `lift` (not lifting its placement) fixed it, since real leaf litter reads
 * as a lumpy scatter rather than a flat film for the same reason it survives
 * that sightline — chosen by re-measuring visible-instance counts at a fixed
 * pose across candidate ranges, not by arithmetic: still short of standing
 * (twig's own `lift[1]` is 0.25 rad and reads as lying down), and the
 * shorter, lighter leaf piece needs the extra angle to reach a comparable
 * rise. `duffClumpReach` and `duffClumpMaxHeight` below are re-derived from
 * this array, not hand-adjusted, so a further retune here cannot silently
 * violate either bound — the test suite the bound holds against is the
 * check, not this comment.
 */

export const DUFF_TWIG = 0;
export const DUFF_LEAF = 1;
export const DUFF_BRANCH = 2;
export const DUFF_CHARACTER_COUNT = 3;

export type DuffCharacter = {
  name: string;
  /** Pieces per clump at count 1, [min, max], by one draw per character: the
   * mesh shell builds one geometry per (character, tier) bucket and thin-
   * instances it, so this has to be a pure function of (character, count) —
   * every clump of a character carries the same piece count, and variety
   * comes from the characters and from per-instance placement, not from a
   * per-clump piece draw. */
  pieces: readonly [number, number];
  /** Piece length (m) by the piece's draw. */
  length: readonly [number, number];
  /** Half-width (m) at the piece's base; a strip tapers to its tip. */
  width: number;
  /** Vertex colour, multiplied by a per-piece luma inside ±tintSpread. */
  tint: Rgb;
  tintSpread: number;
  /** Lift of the far end above the ground (rad), by the piece's draw. */
  lift: readonly [number, number];
  /** Whether a piece also writes a fork strip (the branch). An explicit
   * field rather than an identity check against `DUFF_CHARACTERS`, so a
   * caller that clones or maps a character (the trail litter is the second
   * one) still gets its fork. */
  forked: boolean;
};

/** Roots lie on a disc of this radius (m). */
export const DUFF_CLUMP_RADIUS = 0.3;
/** No vertex rises above this (m): duff is floor, never cover. */
export const DUFF_HEIGHT_MAX = 0.12;
/** The material's base albedo, linear: a dead-leaf brown. */
export const DUFF_ALBEDO: Rgb = { r: 0.16, g: 0.11, b: 0.06 };
/** Piece-count multiplier per tier (near, far). */
export const DUFF_TIER_COUNTS: Record<"high" | "medium", readonly [number, number]> = {
  high: [2, 1],
  medium: [1, 1],
};

/** The fork's attachment point, as a fraction along the branch's own length. */
const DUFF_FORK_OFFSET = 0.6;
/** The fork's own length, as a fraction of the branch's own length. */
const DUFF_FORK_LENGTH = 0.45;
/** The fork's half-width, as a fraction of the branch's own half-width. */
const DUFF_FORK_WIDTH = 0.7;
/** The fork's angle (rad) off the branch's own line. */
const DUFF_FORK_ANGLE = 0.61;

export const DUFF_CHARACTERS: readonly DuffCharacter[] = [
  { name: "twig", pieces: [2, 3], length: [0.10, 0.25], width: 0.005, tint: { r: 1.0, g: 0.85, b: 0.65 }, tintSpread: 0.25, lift: [0.05, 0.25], forked: false },
  { name: "leaf cluster", pieces: [4, 6], length: [0.04, 0.07], width: 0.022, tint: { r: 1.15, g: 0.80, b: 0.45 }, tintSpread: 0.3, lift: [0.1, 0.5], forked: false },
  { name: "small branch", pieces: [1, 1], length: [0.30, 0.60], width: 0.010, tint: { r: 0.85, g: 0.70, b: 0.55 }, tintSpread: 0.2, lift: [0.02, 0.15], forked: true },
];

export type DuffClumpGeometry = StripArrays;

function draw(i: number, salt: number): number {
  return latticeHash(i + 977, salt + 313);
}

function pieceCount(character: DuffCharacter, count: number): number {
  const [lo, hi] = character.pieces;
  return count * (lo + Math.floor(draw(7, 11) * (hi - lo + 1)));
}

/** A forked piece (the branch) is one strip plus a fork strip; every other
 * piece is one strip. */
function stripsPer(character: DuffCharacter): number {
  return character.forked ? 2 : 1;
}

export function duffVertexCount(character: DuffCharacter, count: number): number {
  return pieceCount(character, count) * stripsPer(character) * BLADE_VERTS;
}

/**
 * The farthest a clump of this character can reach from its own center (m),
 * derived from the same numbers the geometry uses — the root disc, the
 * piece's own length range, half-width and lift range — rather than
 * measured off a sample and rounded, so it moves automatically when a
 * character is retuned. A later renderer task uses this for culling and for
 * how far a clump can extend past its cell.
 *
 * A plain piece's farthest vertex is either its tip (at the shallowest lift
 * in the character's range, since cosine is largest there) or a root-ring
 * vertex at its full half-width; whichever is farther from the root sets the
 * local reach. A forked piece (the branch) also has to account for the
 * fork's own tip and root-ring vertices, each reached by two piece segments
 * at a fixed angle to one another (`DUFF_FORK_ANGLE`) rather than lying on
 * one line, so those two candidates are combined by the law of cosines
 * (`a² + b² + 2ab·cos/sin(angle)`) rather than simply summed, which would
 * overstate the reach.
 */
export function duffClumpReach(character: DuffCharacter): number {
  const cl = Math.cos(character.lift[0]);
  const length = character.length[1];
  let local = Math.max(cl * length, character.width);
  if (character.forked) {
    const toFork = cl * length * DUFF_FORK_OFFSET;
    const forkTip = cl * length * DUFF_FORK_LENGTH;
    const forkRoot = character.width * DUFF_FORK_WIDTH;
    const cosA = Math.cos(DUFF_FORK_ANGLE), sinA = Math.sin(DUFF_FORK_ANGLE);
    const throughTip = Math.sqrt(toFork * toFork + forkTip * forkTip + 2 * toFork * forkTip * cosA);
    const throughRoot = Math.sqrt(toFork * toFork + forkRoot * forkRoot + 2 * toFork * forkRoot * sinA);
    local = Math.max(local, throughTip, throughRoot);
  }
  return DUFF_CLUMP_RADIUS + local;
}

/**
 * The highest a clump of this character's vertices can rise (m) before the
 * generator's own safety clamp to `DUFF_HEIGHT_MAX`, derived the same way as
 * `duffClumpReach`: a plain piece's tip rises `length · sin(lift)` at most,
 * and a forked piece's fork tip carries the branch's own rise to the fork's
 * base as well as the fork's own, so it rises `length · sin(lift) ·
 * (DUFF_FORK_OFFSET + DUFF_FORK_LENGTH)` at most. Both assume the piece's
 * own maximum length and lift, the combination that rises highest. A test
 * asserts this stays under `DUFF_HEIGHT_MAX` with real margin, so the clamp
 * — kept as a last-resort safety — cannot quietly start firing and go
 * unnoticed.
 */
export function duffClumpMaxHeight(character: DuffCharacter): number {
  const rise = character.length[1] * Math.sin(character.lift[1]);
  const factor = character.forked ? Math.max(1, DUFF_FORK_OFFSET + DUFF_FORK_LENGTH) : 1;
  return rise * factor;
}

/** Rotates the vertices [first, first + n) about the piece's root so the
 * strip's +y length runs along (dirX, dirZ), rising by `lift` radians. The
 * normals rotate with them. */
function layDown(g: StripArrays, first: number, n: number, rootX: number, rootZ: number, dirX: number, dirZ: number, lift: number): void {
  const cl = Math.cos(lift), sl = Math.sin(lift);
  for (let v = first; v < first + n; v++) {
    const px = g.positions[v * 3]! - rootX, py = g.positions[v * 3 + 1]!, pz = g.positions[v * 3 + 2]! - rootZ;
    // Local frame: y (length) → along dir with lift; the strip's own width
    // axis stays horizontal, so a leaf lies flat and a twig rests on its side.
    const along = py * cl, up = py * sl;
    g.positions[v * 3] = rootX + px + dirX * along;
    g.positions[v * 3 + 1] = up;
    g.positions[v * 3 + 2] = rootZ + pz + dirZ * along;
    const nx = g.normals[v * 3]!, ny = g.normals[v * 3 + 1]!, nz = g.normals[v * 3 + 2]!;
    // The upright strip's normal lies in the horizontal plane; laid down, the
    // face turns to look up. Blend toward up by how flat the piece lies.
    const ux = nx * sl, uy = cl, uz = nz * sl;
    const l = Math.hypot(ux, uy, uz) || 1;
    g.normals[v * 3] = ux / l; g.normals[v * 3 + 1] = uy / l; g.normals[v * 3 + 2] = uz / l;
    // This is exact at lift = 0 (a flat piece's true normal is straight up)
    // but blends toward the upright strip's own rolled-cylinder normal
    // rather than the true flat-ribbon normal as lift rises, off by no more
    // than sin(lift) — at most sin(0.25) ≈ 0.247, the twig's own largest
    // declared lift. Kept: the visible error is small, and computing the
    // exact flat normal would need its own path through the strip writer.
    void ny;
  }
}

export function duffClumpGeometry(character: DuffCharacter, count: number): DuffClumpGeometry {
  const pieces = pieceCount(character, count);
  const strips = stripsPer(character);
  const w = createStripWriter(pieces * strips * BLADE_VERTS, pieces * strips * BLADE_TRIS);
  for (let p = 0; p < pieces; p++) {
    const random = draw(p, 1);
    const rho = DUFF_CLUMP_RADIUS * Math.sqrt(draw(p, 2));
    const phi = 2 * Math.PI * draw(p, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const length = character.length[0] + (character.length[1] - character.length[0]) * draw(p, 4);
    const yaw = 2 * Math.PI * draw(p, 5);
    const lift = character.lift[0] + (character.lift[1] - character.lift[0]) * draw(p, 6);
    const luma = 1 + character.tintSpread * (2 * draw(p, 8) - 1);
    const dirX = Math.cos(yaw), dirZ = Math.sin(yaw);
    // Written upright with no droop, then laid along its direction.
    const first = w.strip(rootX, 0, rootZ, length, 0, character.width, dirX, dirZ, yaw + Math.PI / 2,
      random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma, rootX, rootZ);
    layDown(w, first, BLADE_VERTS, rootX, rootZ, dirX, dirZ, lift);
    if (strips === 2) {
      // The fork: a shorter strip from partway along the branch, at an angle off its line.
      const fx = rootX + dirX * length * DUFF_FORK_OFFSET * Math.cos(lift), fz = rootZ + dirZ * length * DUFF_FORK_OFFSET * Math.cos(lift);
      const fyaw = yaw + (draw(p, 9) < 0.5 ? DUFF_FORK_ANGLE : -DUFF_FORK_ANGLE);
      const fdx = Math.cos(fyaw), fdz = Math.sin(fyaw);
      const f2 = w.strip(fx, 0, fz, length * DUFF_FORK_LENGTH, 0, character.width * DUFF_FORK_WIDTH, fdx, fdz, fyaw + Math.PI / 2,
        random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma, rootX, rootZ);
      layDown(w, f2, BLADE_VERTS, fx, fz, fdx, fdz, lift);
      // The fork's base sits at the branch's height there.
      const baseY = length * DUFF_FORK_OFFSET * Math.sin(lift);
      for (let v = f2; v < f2 + BLADE_VERTS; v++) w.positions[v * 3 + 1] = Math.min(DUFF_HEIGHT_MAX, w.positions[v * 3 + 1]! + baseY);
    }
    for (let v = first; v < first + BLADE_VERTS; v++) w.positions[v * 3 + 1] = Math.min(DUFF_HEIGHT_MAX, w.positions[v * 3 + 1]!);
  }
  return { positions: w.positions, normals: w.normals, colors: w.colors, indices: w.indices, blade: w.blade };
}
