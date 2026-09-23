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
 * about its root so its length runs along a ground direction with a small
 * lift at the far end, so twigs rest on the ground and leaves lie flat. The
 * `blade` attribute keeps the piece's root, so the field's collapse pulls the
 * whole piece to a point exactly as it does a blade.
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

export const DUFF_CHARACTERS: readonly DuffCharacter[] = [
  { name: "twig", pieces: [2, 3], length: [0.10, 0.25], width: 0.005, tint: { r: 1.0, g: 0.85, b: 0.65 }, tintSpread: 0.25, lift: [0.05, 0.25] },
  { name: "leaf cluster", pieces: [4, 6], length: [0.04, 0.07], width: 0.022, tint: { r: 1.15, g: 0.80, b: 0.45 }, tintSpread: 0.3, lift: [0.0, 0.12] },
  { name: "small branch", pieces: [1, 1], length: [0.30, 0.60], width: 0.010, tint: { r: 0.85, g: 0.70, b: 0.55 }, tintSpread: 0.2, lift: [0.02, 0.15] },
];

export type DuffClumpGeometry = StripArrays;

function draw(i: number, salt: number): number {
  return latticeHash(i + 977, salt + 313);
}

function pieceCount(character: DuffCharacter, count: number): number {
  const [lo, hi] = character.pieces;
  return count * (lo + Math.floor(draw(7, 11) * (hi - lo + 1)));
}

/** A branch is one strip plus a fork strip; every other piece is one strip. */
function stripsPer(character: DuffCharacter): number {
  return character === DUFF_CHARACTERS[DUFF_BRANCH] ? 2 : 1;
}

export function duffVertexCount(character: DuffCharacter, count: number): number {
  return pieceCount(character, count) * stripsPer(character) * BLADE_VERTS;
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
      // The fork: a shorter strip from 60 % along the branch, 35° off its line.
      const fx = rootX + dirX * length * 0.6 * Math.cos(lift), fz = rootZ + dirZ * length * 0.6 * Math.cos(lift);
      const fyaw = yaw + (draw(p, 9) < 0.5 ? 0.61 : -0.61);
      const fdx = Math.cos(fyaw), fdz = Math.sin(fyaw);
      const f2 = w.strip(fx, 0, fz, length * 0.45, 0, character.width * 0.7, fdx, fdz, fyaw + Math.PI / 2,
        random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma, rootX, rootZ);
      layDown(w, f2, BLADE_VERTS, fx, fz, fdx, fdz, lift);
      // The fork's base sits at the branch's height there.
      const baseY = length * 0.6 * Math.sin(lift);
      for (let v = f2; v < f2 + BLADE_VERTS; v++) w.positions[v * 3 + 1] = Math.min(DUFF_HEIGHT_MAX, w.positions[v * 3 + 1]! + baseY);
    }
    for (let v = first; v < first + BLADE_VERTS; v++) w.positions[v * 3 + 1] = Math.min(DUFF_HEIGHT_MAX, w.positions[v * 3 + 1]!);
  }
  return { positions: w.positions, normals: w.normals, colors: w.colors, indices: w.indices, blade: w.blade };
}
