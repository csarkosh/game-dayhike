/**
 * Where the cliff modules stand: a pure function of the world.
 *
 * The steep rock hillsides are a smooth sheet with a rock texture on them,
 * and no paint breaks a silhouette. This field seats rock-wall models on
 * ground that is BOTH rock and too steep to stand on, so the faces grow
 * ledges and the skyline breaks. The one rule everything here serves: a
 * module never stands where a foot can go — and a module is a solid, not a
 * base plane. The gate is the simulation's own stand limit
 * (`GROUND_NORMAL_Y`) with a margin, read at the module's centre and then
 * under its whole above-ground body — the corners of that box, and the edge
 * midpoints of its longer axes, the top edge among them, which the lean
 * throws furthest downhill; so sight and collision never disagree underfoot.
 * The probes bound the solid at their own spacing and no finer; what falls
 * between them is covered by the module's own colliders, which contain the
 * whole drawn solid (`passes/cliffs.ts`).
 *
 * A qualifying cell lays a RUN along the contour rather than one module: the
 * face reads as a wall instead of a row of outcrops (`cliffRun`).
 *
 * This is simulation, not rendering: the modules are part of the world every
 * peer has to agree on, so every constant below is declared in the level id
 * and nothing here may use engine-defined maths. Two consequences run through
 * the file:
 *
 * - No trig. `Math.acos`, `Math.atan2`, `Math.sin` and `Math.cos` are
 *   implementation-defined to the last bit (`architecture.test.ts`), and a
 *   placement that differs by a bit between two engines is a world that
 *   differs between two peers, with nothing on the wire to correct it. The
 *   capped lean is written out as a rotation about `UP × normal` with
 *   `Math.sqrt` and arithmetic only (`leanPoint`), and a module's facing is
 *   carried as the unit vector pair the maths actually needs
 *   (`cliffFacing`) rather than as an angle. The renderer turns that pair
 *   back into an angle for Babylon — the division of labour `groundTilt.ts`
 *   already documents for the ground tilt.
 * - No paint. The rock a module needs is the simulation's own rock slope
 *   band (`rockSlopeBand`, the band the rock props already stand on), not
 *   the renderer's `classifySurface`.
 */
import { CLUTTER_ROCK, rockSlopeBand, type ClutterInstance } from "./clutter.js";
import { GROUND_NORMAL_Y } from "./constants.js";
import { hash3 } from "./field.js";
import { elevationSampleAt, type TerrainSample } from "./terrain.js";

/** Lattice cell (m). One run at most per cell. */
export const CLIFF_CELL = 12;
/** Jitter of a run's first module inside its cell, as a fraction of the cell,
 * per axis. */
export const CLIFF_JITTER = 0.5;
/** How far below the stand limit the ground must be (in normal-y) before a
 * module may stand on it: a margin so a module never stands on the last
 * centimetre a foot can. */
export const CLIFF_STAND_MARGIN = 0.03;
/** Rock weight a spot needs before a module stands on it, so a module can
 * never stand off the ground class it belongs to. The weight is the rock
 * class's own slope band (`rockSlopeBand`), which the stand gate above
 * already saturates — every gradient steep enough to fail the stand limit is
 * past `CLUTTER_ROCK_SLOPE_HI` — so this threshold binds only if one of the
 * two ever moves toward the other. It is kept, and read, for that. */
export const CLIFF_ROCK_MIN = 0.8;
/** Share of the cells that start a run. Drawn first, before a terrain
 * sample, so the cheap rejection comes first. Rare on purpose: a run reaches
 * up to `CLIFF_RUN_REACH` either side of its cell, so with every other 12 m
 * cell along a face starting one, runs laid the same stretch of wall two and
 * three deep; at one cell in ten a stretch is laid about once, and faces
 * keep real gaps between runs. */
export const CLIFF_DENSITY = 0.1;
/** Scale band a module draws — a multiplier on the model's own size, not a
 * length. Every module in a run draws its own, so a wall is not a row of
 * copies. */
export const CLIFF_SCALE: readonly [number, number] = [0.7, 1.6];
/** Yaw jitter (rad) either side of straight downslope, so a run of modules
 * is not a fence. */
export const CLIFF_YAW_JITTER = 0.3;
/** The tangent of `CLIFF_YAW_JITTER`, which is what the field actually draws
 * from: rotating the downslope direction by `atan(q)` for a drawn `q` needs
 * no trig at all (`cliffFacing`), where rotating it by a drawn angle would.
 * The bound on the angle is exactly `CLIFF_YAW_JITTER` either side; only the
 * distribution inside the bound differs from a uniform draw on the angle, and
 * over 0.3 rad `atan` is straight to a part in a hundred. Pinned against
 * `Math.tan(CLIFF_YAW_JITTER)` in the test. */
export const CLIFF_YAW_TAN = 0.30933624960962325;
/** How far a module is pushed into the ground, as a fraction of its rendered
 * height: the base is buried, the ledges above ground are what shows. */
export const CLIFF_SINK = 0.35;
/** Neighbours (of four, at `CLIFF_CELL`) that must be steep rock for the long
 * module to start a run rather than the short one. */
export const CLIFF_LONG_NEIGHBOURS = 3;
/** The two models, by variant index. */
export const CLIFF_WALL_A = 0;
export const CLIFF_WALL_B = 1;
export const CLIFF_MODELS: readonly string[] = ["models/cliff.wall_a.glb", "models/cliff.wall_b.glb"];
/** Each model's own size at scale 1, in metres, from its `LOD0` mesh: the
 * extent along its width (x), its depth (z) and its height (y). `scale` is a
 * multiplier on the model, so a band in metres means metres only once
 * divided by these. */
export const CLIFF_MODEL_WIDTH: readonly number[] = [8.27, 20.23];
export const CLIFF_MODEL_DEPTH: readonly number[] = [4.38, 6.58];
export const CLIFF_MODEL_HEIGHT: readonly number[] = [4.96, 7.17];
/** How far the scanned face itself reaches from the model's origin along +Z
 * at scale 1 — the front of the depth, which the origin does not sit in the
 * middle of. The lean throws the top of this face downhill, so it is the
 * furthest the solid reaches out over the hill. */
export const CLIFF_MODEL_FRONT: readonly number[] = [0.77, 2.19];
/** How far the model reaches from its origin along +X at scale 1, in the
 * frame the instance matrix works in — the loader's right-handed to
 * left-handed mirror is already baked into the vertices, so this is the
 * mirror of the model's own +X. The origin is off-centre across the width as
 * well as through the depth, so the body runs from `−(W − R)` to `+R`, not
 * `±W/2`. */
export const CLIFF_MODEL_RIGHT: readonly number[] = [4.40, 10.55];

/** How far a module may lean toward the ground normal (rad). A cliff face
 * stands AGAINST a steep hillside rather than lying on it, and the lean is
 * what throws the module's upper body out over ground its base never touched:
 * seated on the full normal, the long model at the top of its scale band puts
 * its top-front edge 8.6 m horizontally downhill of its origin on a 45° face,
 * out past its own footprint and over any bench at the foot of the riser. A
 * 20° lean is still enough to bed a wall into the hill, and it keeps the
 * solid close enough to its own footprint for the probes below to follow.
 *
 * The angle itself is the renderer's (`seatOnGroundCapped` takes it); the
 * field leans by the cosine and sine below, which are that angle's, pinned
 * against it in the test. Comparing a slope against the CAP is the same
 * comparison either way: `acos` decreases, so `acos(ny) > CLIFF_TILT_MAX` is
 * exactly `ny < CLIFF_TILT_COS`, with no trig. */
export const CLIFF_TILT_MAX = 0.35;
export const CLIFF_TILT_COS = 0.9393727128473789;
export const CLIFF_TILT_SIN = 0.34289780745545134;

/** How far apart the probes over a module's solid may be, as a fraction of
 * the model's own longest dimension: every local axis is sampled at both ends
 * and again wherever that would leave a wider gap, which is the eight corners
 * of the solid plus a midpoint on each of its longer axes — and, where two
 * axes both earn a midpoint, the centre of the face they share (`wall_a`
 * takes 18 points, `wall_b` 12). */
export const CLIFF_PROBE_SPAN = 0.5;

/** Spacing along a run, as a fraction of the mean of the two neighbours'
 * placed widths: neighbours overlap by about a third, so a run reads as one
 * wall rather than a lattice of outcrops with gaps between them. The mean,
 * not the previous module's width alone, because the models alternate along
 * a run — a long module stepping by its own width to a short one would clear
 * the short one's half-width and leave a gap. */
export const CLIFF_RUN_SPACING = 0.7;
/** Modules a run lays either side of its cell's own: a cell contributes at
 * most `2 · CLIFF_RUN_MAX + 1`. */
export const CLIFF_RUN_MAX = 4;

/**
 * The farthest (m) a run can carry a module's origin from its cell's own
 * jittered point, so a walk over cells knows how far past a region it must
 * look for the cells whose runs reach into it.
 *
 * Step `k` of a side (k = 1 … `CLIFF_RUN_MAX`) is `CLIFF_RUN_SPACING` of the
 * mean of the two neighbours' placed widths, `(W[a]·s_a + W[b]·s_b) / 2`,
 * with every `s` at most `CLIFF_SCALE[1]`; the models alternate along the
 * run, so step `k` joins models `(v0 + k − 1) mod 2` and `(v0 + k) mod 2` for
 * a run whose own module is `v0`. The origin of the side's last module is the
 * end of those steps, and a straight line is no longer than the path it
 * closes, however the contour bends, so
 *
 *   reach = max over v0 of Σ_{k=1}^{CLIFF_RUN_MAX} CLIFF_RUN_SPACING ·
 *           (W[(v0 + k − 1) mod 2] + W[(v0 + k) mod 2]) / 2 · CLIFF_SCALE[1]
 *
 * — at the shipped constants 4 · 0.7 · 1.6 · (20.23 + 8.27) / 2 = 63.84 m,
 * met only by a run on a straight contour at the top of the scale band.
 *
 * It bounds the ORIGIN. A module's solid reaches further than that from its
 * origin, which a consumer that needs the solid adds itself (the cliff pass's
 * `CLIFF_SOLID_REACH`).
 */
export const CLIFF_RUN_REACH = runReach();

function runReach(): number {
  let worst = 0;
  for (let v0 = 0; v0 < CLIFF_MODEL_WIDTH.length; v0++) {
    let d = 0;
    for (let k = 1; k <= CLIFF_RUN_MAX; k++) {
      const a = CLIFF_MODEL_WIDTH[(v0 + k - 1) % 2] as number;
      const b = CLIFF_MODEL_WIDTH[(v0 + k) % 2] as number;
      d += CLIFF_RUN_SPACING * ((a + b) / 2) * CLIFF_SCALE[1];
    }
    worst = Math.max(worst, d);
  }
  return worst;
}

/** This field's own hash salt. The cell draws are salted apart from the
 * tree, blade and litter lattices beside them and from every other salt in
 * the simulation (the terrain's cliff-phase noise among them). */
export const CLIFF_SALT = 0xc1f0;
/** Which of a cell's draws feeds what: the density draw, the jitter of the
 * run's first module in x and z, and from `CLIFF_DRAW_RUN` onward a pair per
 * module along the run, so two modules in one run never share a scale or a
 * jitter. Renumbering a slot re-deals every module in every world, so the
 * slots are declared in the level id with the rest of the field's
 * constants. */
export const CLIFF_DRAW_DENSITY = 0;
export const CLIFF_DRAW_X = 1;
export const CLIFF_DRAW_Z = 2;
export const CLIFF_DRAW_RUN = 3;

/** One of a cell's draws, in [0, 1). */
function cellDraw(seed: number, ci: number, cj: number, i: number): number {
  return hash3(ci, cj, i, seed ^ CLIFF_SALT);
}

/** The draw index of module `k` (0 = the cell's own) on side `side` (0 or 1)
 * of a run: two consecutive draws, the scale and the yaw jitter. */
function runDraw(seed: number, ci: number, cj: number, side: number, k: number, which: number): number {
  return cellDraw(seed, ci, cj, CLIFF_DRAW_RUN + 2 * (side * (CLIFF_RUN_MAX + 1) + k) + which);
}

/** Where cell (ci, cj)'s run starts, jittered inside the cell. */
export function cliffCellPoint(seed: number, ci: number, cj: number): { x: number; z: number } {
  return {
    x: (ci + 0.5 + CLIFF_JITTER * (cellDraw(seed, ci, cj, CLIFF_DRAW_X) - 0.5)) * CLIFF_CELL,
    z: (cj + 0.5 + CLIFF_JITTER * (cellDraw(seed, ci, cj, CLIFF_DRAW_Z) - 0.5)) * CLIFF_CELL,
  };
}

/** The upward unit normal's y component, 1/sqrt(1 + dx² + dz²) — `groundTilt`'s
 * `groundNormalY`, written here so the field owes the renderer nothing. */
function normalY(dx: number, dz: number): number {
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

/**
 * Whether ground of gradient (dx, dz) takes a module: steep past the stand
 * limit by the margin, AND rock. The rock weight is the rock class's own
 * slope band, by reference — the modules stand on the ground the rock props
 * already claim — and reads 0 wherever the stand gate has already refused.
 */
export function cliffGround(dx: number, dz: number): { rock: number; open: boolean } {
  // `GROUND_NORMAL_Y` is a movement constant — the steepest ground a foot
  // holds (`movement.ts`, `ground.ts`) — and rides in no pass's tunables. A
  // change to it changes how every peer walks, which a pass digest cannot
  // see; that is what `GEN_VERSION` in `forest.ts` exists for, and bumping
  // it moves the level id for this gate too.
  if (normalY(dx, dz) >= GROUND_NORMAL_Y - CLIFF_STAND_MARGIN) return { rock: 0, open: false };
  const rock = rockSlopeBand(dx * dx + dz * dz);
  return { rock, open: rock >= CLIFF_ROCK_MIN };
}

/** The gate at one spot: the terrain sample there, and `cliffGround` of its
 * gradient. */
export function cliffGate(seed: number, x: number, z: number): { s: TerrainSample; rock: number; open: boolean } {
  const s = elevationSampleAt(seed, x, z);
  const { rock, open } = cliffGround(s.dx, s.dz);
  return { s, rock, open };
}

/** A direction in the ground plane: the scene's own (x, z), unit length. */
export type CliffFacing = {
  /** The way the scanned face looks out of the hill — the renderer's forward,
   * `(sin yaw, cos yaw)`. */
  fx: number;
  fz: number;
  /** The module's width axis — the renderer's right, `(cos yaw, −sin yaw)`,
   * which is the contour when the jitter is zero. */
  rx: number;
  rz: number;
};

/**
 * Straight downslope, with the module's own yaw jitter turned into it.
 *
 * `jitter` is the instance's `hash`, uniform in [0, 1): it picks a tangent
 * `q` in `±CLIFF_YAW_TAN`, and `(d + q·r)/sqrt(1 + q²)` is `d` turned by
 * `atan(q)` — the rotation without the rotation's trig. On flat ground the
 * downslope direction does not exist and the facing falls back to +Z; the
 * gate never opens there, so nothing placed takes that branch.
 */
export function cliffFacing(dx: number, dz: number, jitter: number): CliffFacing {
  const g = Math.sqrt(dx * dx + dz * dz);
  if (g < 1e-12) return { fx: 0, fz: 1, rx: 1, rz: 0 };
  const dfx = -dx / g, dfz = -dz / g;
  const q = CLIFF_YAW_TAN * (2 * jitter - 1);
  const k = 1 / Math.sqrt(1 + q * q);
  // right = (fz, −fx), so the turned forward is (d + q·right)/‖·‖.
  const fx = (dfx + q * dfz) * k;
  const fz = (dfz - q * dfx) * k;
  return { fx, fz, rx: fz, rz: -fx };
}

/** Cosine and sine of the lean a module takes on ground of gradient (dx, dz):
 * the slope's own angle, capped at `CLIFF_TILT_MAX`. Below the cap the angle
 * is `acos(ny)`, so its cosine is `ny` itself and its sine `sqrt(1 − ny²)` —
 * no trig, and exact to the bit on every engine. */
export function cliffLeanTrig(dx: number, dz: number): { c: number; s: number } {
  const ny = normalY(dx, dz);
  if (ny <= CLIFF_TILT_COS) return { c: CLIFF_TILT_COS, s: CLIFF_TILT_SIN };
  return { c: ny, s: Math.sqrt(1 - ny * ny) };
}

/** A point in the scene's frame; `leanPoint` writes into one. */
export type CliffPoint = { x: number; y: number; z: number };

/**
 * `(px, py, pz)` leant onto the ground of gradient (dx, dz): a rotation about
 * the unit axis `UP × normal`, which for that gradient is `(−dz, 0, dx)`
 * normalised, through the capped lean above. Written out as Rodrigues'
 * formula, `v·c + (a × v)·s + a·(a · v)·(1 − c)`, which is the same rotation
 * the renderer composes as a quaternion in `seatOnGroundCapped` — the two are
 * held together at 1e-9 on random gradients by `test/game/cliffField.test.ts`,
 * so the solid the probes bound is the solid that is drawn.
 *
 * Written into `out` and returned; the probe loop reuses one.
 */
export function leanPoint(px: number, py: number, pz: number, dx: number, dz: number, out: CliffPoint): CliffPoint {
  const g = Math.sqrt(dx * dx + dz * dz);
  if (g < 1e-12) {
    out.x = px; out.y = py; out.z = pz;
    return out;
  }
  const ax = -dz / g, az = dx / g;
  const { c, s } = cliffLeanTrig(dx, dz);
  // a × v with a.y = 0, and a · v likewise.
  const cx = -az * py, cy = az * px - ax * pz, cz = ax * py;
  const d = (ax * px + az * pz) * (1 - c);
  out.x = px * c + cx * s + ax * d;
  out.y = py * c + cy * s;
  out.z = pz * c + cz * s + az * d;
  return out;
}

/** The four neighbours a long face is looked for in. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL],
];

const probePoint: CliffPoint = { x: 0, y: 0, z: 0 };

/**
 * The ground under every probe point of a module's above-ground solid is
 * steep rock: the box `x ∈ [−(W − R), R]`, `y ∈ [CLIFF_SINK·H, H]`,
 * `z ∈ [−(D − F), F]` at `scale`, seated exactly as the renderer seats it —
 * yawed by `facing`, then leant — and dropped straight down.
 *
 * The origin sits at the model's base and off-centre both across the width
 * and through the depth: the footprint runs from `−(W − R)` to `+R` across
 * and from `−(D − F)` behind the origin to the scanned face's own reach `F`
 * in front. The lean turns the solid about that origin, which the sink
 * buries `CLIFF_SINK·H·scale` below the ground — so the top of the box swings
 * `H·scale·sin θc` downhill, not `(1 − CLIFF_SINK)·H·scale·sin θc`. Probing
 * the box itself keeps both facts in one place instead of in a formula that
 * has to restate them.
 *
 * The probes bound the solid at their own spacing and no finer: the gate is a
 * per-point reading of terrain that can dip in and out of the stand limit
 * inside a footprint metres across, so ground between two open probes is not
 * guaranteed open. §11 of the design records what closing that by probing
 * would cost; §12.3 closes it with a collider instead (`passes/cliffs.ts`),
 * whose boxes contain the whole drawn solid, so the ground between two
 * probes can no longer hold a foot under an overhang the simulation does not
 * know about.
 */
function solidOpen(
  seed: number,
  x: number,
  z: number,
  facing: CliffFacing,
  dx: number,
  dz: number,
  scale: number,
  variant: number,
): boolean {
  const w = (CLIFF_MODEL_WIDTH[variant] as number) * scale;
  const h = (CLIFF_MODEL_HEIGHT[variant] as number) * scale;
  const d = (CLIFF_MODEL_DEPTH[variant] as number) * scale;
  const f = (CLIFF_MODEL_FRONT[variant] as number) * scale;
  const rt = (CLIFF_MODEL_RIGHT[variant] as number) * scale;
  const step = Math.max(w, h, d) * CLIFF_PROBE_SPAN;
  const x0 = -(w - rt), xSpan = rt - x0;
  const y0 = CLIFF_SINK * h, ySpan = h - y0;
  const z0 = -(d - f), zSpan = f - z0;
  const nx = Math.max(1, Math.ceil(xSpan / step));
  const ny = Math.max(1, Math.ceil(ySpan / step));
  const nz = Math.max(1, Math.ceil(zSpan / step));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        // The faces of the box only: a point with every index strictly inside
        // is inside the solid, and the ground under it is bounded by the face
        // points around it.
        if (i > 0 && i < nx && j > 0 && j < ny && k > 0 && k < nz) continue;
        const lx = x0 + (xSpan * i) / nx;
        const ly = y0 + (ySpan * j) / ny;
        const lz = z0 + (zSpan * k) / nz;
        // Yaw first, then the lean — the order `seatOnGroundCapped` composes.
        leanPoint(lx * facing.rx + lz * facing.fx, ly, lx * facing.rz + lz * facing.fz, dx, dz, probePoint);
        if (!cliffGate(seed, x + probePoint.x, z + probePoint.z).open) return false;
      }
    }
  }
  return true;
}

/**
 * The module of `variant` at (x, z) on ground `s`, or null if its solid would
 * overhang ground the gate refuses.
 *
 * Shaped as a `ClutterInstance` of the rock class so the clutter's own
 * per-instance writers serve it, with the yaw JITTER riding in `hash` (a
 * facing is `cliffFacing(groundDx, groundDz, hash)`, never an angle — see the
 * head of this file) and the sink already in `groundH`. The matrix is not the
 * clutter's: a lying rock is seated on the full ground normal, and a wall that
 * lay back with a 45° face would overhang the ground at its foot, so the
 * renderer composes the capped lean instead (`cliffInstanceMatrix`).
 */
function placeModule(
  seed: number,
  x: number,
  z: number,
  s: TerrainSample,
  variant: number,
  scale: number,
  jitter: number,
): ClutterInstance | null {
  const facing = cliffFacing(s.dx, s.dz, jitter);
  if (!solidOpen(seed, x, z, facing, s.dx, s.dz, scale, variant)) return null;
  return {
    cls: CLUTTER_ROCK,
    x,
    z,
    groundH: s.h - CLIFF_SINK * scale * (CLIFF_MODEL_HEIGHT[variant] as number),
    groundDx: s.dx,
    groundDz: s.dz,
    scale,
    variant,
    hash: jitter,
  };
}

function drawScale(u: number): number {
  return CLIFF_SCALE[0] + (CLIFF_SCALE[1] - CLIFF_SCALE[0]) * u;
}

/**
 * One side of a cell's run, from the module already placed at its start:
 * `sign` is +1 or −1 along the contour, and `side` (0 or 1) picks the draws.
 *
 * Each next spot draws its scale first, then steps `CLIFF_RUN_SPACING` of the
 * mean of the two neighbours' placed widths along the contour at the
 * previous module's own ground — the direction perpendicular to the
 * gradient, `±(−dz, dx)/‖∇‖` — so the run follows the face round instead of
 * running off it, and consecutive modules overlap by about a third of a
 * width whichever model is the longer. Every spot draws its own scale and yaw
 * jitter and takes the OTHER model, so a wall is not a row of copies; the
 * first spot that fails the gate or the probe rule ends that side. Appended
 * to `out`.
 */
function cliffRunSide(
  seed: number,
  ci: number,
  cj: number,
  side: number,
  sign: number,
  start: ClutterInstance,
  out: ClutterInstance[],
): void {
  let prev = start;
  for (let k = 1; k <= CLIFF_RUN_MAX; k++) {
    const g = Math.sqrt(prev.groundDx * prev.groundDx + prev.groundDz * prev.groundDz);
    if (g < 1e-12) return;
    const variant = (start.variant + k) % 2;
    const scale = drawScale(runDraw(seed, ci, cj, side, k, 0));
    const step = CLIFF_RUN_SPACING * 0.5 * (
      (CLIFF_MODEL_WIDTH[prev.variant] as number) * prev.scale + (CLIFF_MODEL_WIDTH[variant] as number) * scale
    );
    const x = prev.x + (sign * step * -prev.groundDz) / g;
    const z = prev.z + (sign * step * prev.groundDx) / g;
    const gate = cliffGate(seed, x, z);
    if (!gate.open) return;
    const m = placeModule(seed, x, z, gate.s, variant, scale, runDraw(seed, ci, cj, side, k, 1));
    if (m === null) return;
    out.push(m);
    prev = m;
  }
}

/**
 * The run of modules cell (ci, cj) lays, possibly empty, in order along the
 * wall: the side laid toward `−contour` (reversed, so its far end comes
 * first), the cell's own module, then the side laid toward `+contour`.
 *
 * The cell's own module stands at its jittered point — the long model where
 * the face around it is long, the short one where the long one's solid would
 * overhang, and nothing where even the short one would — and the run then
 * extends from it along the contour in both directions (`cliffRunSide`).
 *
 * Pure in (seed, ci, cj) and independent of any neighbour cell's OUTCOME: the
 * variant reads four neighbouring gates, which is terrain, not placement. Two
 * cells' runs can therefore cross the same stretch of face; `CLIFF_DENSITY`
 * keeps that rare, so a stretch is laid about once, and modules overlap only
 * within a run, where the spacing puts them a third of a width into each
 * other.
 */
export function cliffCellRuns(seed: number, ci: number, cj: number): ClutterInstance[] {
  if (cellDraw(seed, ci, cj, CLIFF_DRAW_DENSITY) >= CLIFF_DENSITY) return [];
  const { x, z } = cliffCellPoint(seed, ci, cj);
  const gate = cliffGate(seed, x, z);
  if (!gate.open) return [];
  let steepNeighbours = 0;
  for (const [ox, oz] of NEIGHBOURS) {
    if (cliffGate(seed, x + ox, z + oz).open) steepNeighbours++;
  }
  const scale = drawScale(runDraw(seed, ci, cj, 0, 0, 0));
  const jitter = runDraw(seed, ci, cj, 0, 0, 1);
  const wanted = steepNeighbours >= CLIFF_LONG_NEIGHBOURS ? CLIFF_WALL_B : CLIFF_WALL_A;
  let start = placeModule(seed, x, z, gate.s, wanted, scale, jitter);
  if (start === null && wanted === CLIFF_WALL_B) {
    start = placeModule(seed, x, z, gate.s, CLIFF_WALL_A, scale, jitter);
  }
  if (start === null) return [];
  const back: ClutterInstance[] = [];
  cliffRunSide(seed, ci, cj, 1, -1, start, back);
  const out = back.reverse();
  out.push(start);
  cliffRunSide(seed, ci, cj, 0, 1, start, out);
  return out;
}

/** Every constant that steers where a module stands, by name — the level-id
 * contract, the way `CLUTTER_TUNABLES` carries the clutter's. */
export const CLIFF_TUNABLES: Readonly<Record<string, number>> = {
  CLIFF_CELL, CLIFF_JITTER, CLIFF_STAND_MARGIN, CLIFF_ROCK_MIN, CLIFF_DENSITY,
  CLIFF_SCALE_MIN: CLIFF_SCALE[0], CLIFF_SCALE_MAX: CLIFF_SCALE[1],
  CLIFF_YAW_JITTER, CLIFF_YAW_TAN, CLIFF_SINK, CLIFF_LONG_NEIGHBOURS,
  CLIFF_TILT_MAX, CLIFF_TILT_COS, CLIFF_TILT_SIN, CLIFF_PROBE_SPAN,
  CLIFF_RUN_SPACING, CLIFF_RUN_MAX, CLIFF_RUN_REACH, CLIFF_SALT,
  CLIFF_DRAW_DENSITY, CLIFF_DRAW_X, CLIFF_DRAW_Z, CLIFF_DRAW_RUN,
  CLIFF_MODEL_WIDTH_A: CLIFF_MODEL_WIDTH[CLIFF_WALL_A] as number,
  CLIFF_MODEL_WIDTH_B: CLIFF_MODEL_WIDTH[CLIFF_WALL_B] as number,
  CLIFF_MODEL_DEPTH_A: CLIFF_MODEL_DEPTH[CLIFF_WALL_A] as number,
  CLIFF_MODEL_DEPTH_B: CLIFF_MODEL_DEPTH[CLIFF_WALL_B] as number,
  CLIFF_MODEL_HEIGHT_A: CLIFF_MODEL_HEIGHT[CLIFF_WALL_A] as number,
  CLIFF_MODEL_HEIGHT_B: CLIFF_MODEL_HEIGHT[CLIFF_WALL_B] as number,
  CLIFF_MODEL_FRONT_A: CLIFF_MODEL_FRONT[CLIFF_WALL_A] as number,
  CLIFF_MODEL_FRONT_B: CLIFF_MODEL_FRONT[CLIFF_WALL_B] as number,
  CLIFF_MODEL_RIGHT_A: CLIFF_MODEL_RIGHT[CLIFF_WALL_A] as number,
  CLIFF_MODEL_RIGHT_B: CLIFF_MODEL_RIGHT[CLIFF_WALL_B] as number,
};
