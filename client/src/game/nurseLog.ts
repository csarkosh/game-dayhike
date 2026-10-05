/**
 * What grows on a fallen log, and the moss over it. In the rain forest a log
 * is under moss within two decades and carries several times the seedlings
 * of the floor beside it: the next trees start on it. Here a share of the
 * logs are nurse logs, each with a few ferns and conifer seedlings along its
 * top, and every log's upper side is tinted to moss.
 *
 * Pure and Babylon-free; a pure function of the log's own `hash`, so the same
 * log carries the same plants on every rebuild and on every peer's screen.
 * Renderer-only: nothing here is in the level id, since nothing here collides
 * or is read by the sim.
 */

/** The share of logs that carry plants. */
export const NURSE_SHARE = 0.7;
/** Ferns and seedlings on a nurse log: at least two of each, at most these. */
export const NURSE_FERNS_MAX = 4;
export const NURSE_SEEDLINGS_MAX = 6;
/** A fern on a log is a clump 1 to 1.7 m across (the model is 0.55 m). A
 * seedling is the unit seedling of `seedlingGeometry`, a metre tall, at 0.6
 * to 1.8: a young hemlock from knee to head height. */
export const NURSE_FERN_SCALE: readonly [number, number] = [1.8, 3];
export const NURSE_SEEDLING_SCALE: readonly [number, number] = [0.6, 1.8];
/** Plants keep this share of the trunk's length clear at each end. */
const NURSE_END_MARGIN = 0.12;
/** A plant stands within this share of the trunk's diameter of its spine. */
const NURSE_SIDE = 0.18;

export const NURSE_FERN = 0;
export const NURSE_SEEDLING = 1;
export type NursePlant = {
  kind: typeof NURSE_FERN | typeof NURSE_SEEDLING;
  /** Its place along the trunk, in the model's X (m at scale 1). */
  along: number;
  /** Its place across the trunk, as a share of the diameter, either side of the spine. */
  side: number;
  /** Its own scale, not the log's. */
  scale: number;
  /** Its yaw (rad). */
  yaw: number;
};

/** A small generator seeded by a log's `hash`: mulberry32. */
function draws(hash: number): () => number {
  let a = Math.floor(hash * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The plants on the log whose `hash` this is: none for the logs that are
 * not nurse logs, else its ferns and its seedlings, between the trunk's ends
 * `minX` and `maxX`. */
export function nursePlants(hash: number, minX: number, maxX: number): NursePlant[] {
  const rand = draws(hash);
  if (rand() >= NURSE_SHARE) return [];
  const out: NursePlant[] = [];
  const lo = minX + (maxX - minX) * NURSE_END_MARGIN;
  const hi = maxX - (maxX - minX) * NURSE_END_MARGIN;
  const add = (kind: NursePlant["kind"], count: number, scale: readonly [number, number]): void => {
    for (let i = 0; i < count; i++) {
      out.push({
        kind,
        along: lo + (hi - lo) * rand(),
        side: (rand() * 2 - 1) * NURSE_SIDE,
        scale: scale[0] + (scale[1] - scale[0]) * rand(),
        yaw: rand() * Math.PI * 2,
      });
    }
  };
  add(NURSE_FERN, 2 + Math.floor(rand() * (NURSE_FERNS_MAX - 1)), NURSE_FERN_SCALE);
  add(NURSE_SEEDLING, 2 + Math.floor(rand() * (NURSE_SEEDLINGS_MAX - 1)), NURSE_SEEDLING_SCALE);
  return out;
}

/** The moss's tint, which multiplies the bark's own colour: over 1 in green,
 * so brown bark comes out a deep green and not an olive. */
export const MOSS_TINT: readonly [number, number, number] = [0.38, 1.15, 0.3];
/** A face is bare below MOSS_UP_LO of upward normal and full moss from MOSS_UP_HI. */
export const MOSS_UP_LO = -0.1;
export const MOSS_UP_HI = 0.55;
/** The moss is patchy: its weight varies between this and 1 over the trunk. */
const MOSS_PATCH_FLOOR = 0.55;

/**
 * Vertex colours (RGBA) that lay moss on a trunk modelled lying along local
 * X with +Y up: white where the bark shows, `MOSS_TINT` on the upper side,
 * in patches. `positions` and `normals` are xyz triples.
 */
export function mossColours(positions: ArrayLike<number>, normals: ArrayLike<number>): Float32Array {
  const count = positions.length / 3;
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const up = normals[i * 3 + 1] as number;
    const t = Math.min(1, Math.max(0, (up - MOSS_UP_LO) / (MOSS_UP_HI - MOSS_UP_LO)));
    const x = positions[i * 3] as number, z = positions[i * 3 + 2] as number;
    // Smooth along the trunk, so a patch spans many vertices.
    const patch = MOSS_PATCH_FLOOR + (1 - MOSS_PATCH_FLOOR) * (0.5 + 0.5 * Math.sin(x * 3.1 + Math.sin(z * 7.3) * 1.7));
    const w = t * t * (3 - 2 * t) * patch;
    out[i * 4] = 1 + (MOSS_TINT[0] - 1) * w;
    out[i * 4 + 1] = 1 + (MOSS_TINT[1] - 1) * w;
    out[i * 4 + 2] = 1 + (MOSS_TINT[2] - 1) * w;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** A seedling's tiers of branches, the branches a tier, and its colours (linear). */
const SEEDLING_TIERS = 6;
const SEEDLING_BRANCHES = 6;
const SEEDLING_RADIUS = 0.3;
/** A young hemlock's light green, lighter than the canopy's. Measured both
 * ways: at half of these a seedling under the trees was drawn and not seen
 * by day, and at twice them it glowed against the forest on a wet night. */
const SEEDLING_NEEDLE: readonly [number, number, number] = [0.04, 0.09, 0.035];
const SEEDLING_TIP: readonly [number, number, number] = [0.09, 0.18, 0.065];
const SEEDLING_STEM: readonly [number, number, number] = [0.04, 0.028, 0.02];

export type SeedlingGeometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

/**
 * A conifer seedling a metre tall, origin at its foot: a thin stem and tiers
 * of drooping branches, each a flat spray wider at its outer end, the tiers
 * shortening to a leader. Built in code, as the shrub is (`shrubClump.ts`): a
 * sapling model scaled down to a seedling is a few specks of needle, and this
 * is a silhouette. About 80 triangles.
 */
export function seedlingGeometry(): SeedlingGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: readonly [number, number, number]): number => {
    const len = Math.hypot(nx, ny, nz) || 1;
    positions.push(x, y, z);
    normals.push(nx / len, ny / len, nz / len);
    colors.push(c[0], c[1], c[2], 1);
    return positions.length / 3 - 1;
  };
  // The stem: three sides, tapering to the leader.
  const base: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    base.push(push(Math.cos(a) * 0.015, -0.03, Math.sin(a) * 0.015, Math.cos(a), 0.2, Math.sin(a), SEEDLING_STEM));
  }
  const leader = push(0, 1, 0, 0, 1, 0, SEEDLING_TIP);
  for (let k = 0; k < 3; k++) indices.push(base[k] as number, base[(k + 1) % 3] as number, leader);
  // The tiers, from the lowest up: each branch a spray from the stem out and down.
  for (let tier = 0; tier < SEEDLING_TIERS; tier++) {
    const u = tier / (SEEDLING_TIERS - 1);
    const y = 0.18 + 0.7 * u;
    const reach = SEEDLING_RADIUS * (1 - 0.78 * u);
    const droop = reach * 0.35;
    for (let b = 0; b < SEEDLING_BRANCHES; b++) {
      const a = ((b + 0.5 * (tier % 2)) / SEEDLING_BRANCHES) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      const half = reach * 0.38;
      const root = push(0, y, 0, cx * 0.3, 1, cz * 0.3, SEEDLING_NEEDLE);
      const left = push(cx * reach - cz * half, y - droop, cz * reach + cx * half, cx * 0.5, 1, cz * 0.5, SEEDLING_TIP);
      const right = push(cx * reach + cz * half, y - droop, cz * reach - cx * half, cx * 0.5, 1, cz * 0.5, SEEDLING_TIP);
      indices.push(root, left, right);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices),
  };
}
