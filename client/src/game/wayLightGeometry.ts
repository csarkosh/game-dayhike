/**
 * The half pipe's shape (docs/gameplay/2026-11-13-the-way-down.md): the way
 * down as the player sees it, a floor of faint cold light with a wall of lit
 * mist curving up from either edge. This file is the geometry and its
 * numbers, free of Babylon so it is tested as arithmetic; wayLight.ts makes
 * the meshes and the material from it.
 *
 * A point of the way gives WAY_POINT_VERTICES vertices in a fixed order: the
 * floor's nine across the line (4 m to its left to 4 m to its right), then
 * the left wall's eleven from its foot to its rim, then the right wall's.
 * Each vertex carries two numbers for the shader: how much of its kind's
 * light it holds (the profile, 0 to 1), and its kind (0 the floor, 1 a wall).
 */

/** Metres from the line a wall's foot stands, the radius of the quarter circle it rises by (its rim is that far out again, and that high), and the strips it is drawn in. */
export const WAY_WALL_FOOT_M = 2;
export const WAY_WALL_RADIUS_M = 3.5;
export const WAY_WALL_STEPS = 10;
/** Metres from the line within which the floor's light is whole, and at which it is gone. */
export const WAY_FLOOR_CORE_M = 1.5;
export const WAY_FLOOR_EDGE_M = 4;
/** Metres of way a mesh holds, and the metres every vertex stands over the ground under it. */
export const WAY_CHUNK_M = 64;
export const WAY_LIFT_M = 0.08;
/** How strong the floor's light and a wall's are, and how fast each falls off with the metres from the eye (e^(-reach × d)). */
export const WAY_FLOOR_STRENGTH = 0.06;
export const WAY_WALL_STRENGTH = 0.3;
export const WAY_FLOOR_REACH = 0.012;
export const WAY_WALL_REACH = 0.016;
/** The light's colour, linear: cold. */
export const WAY_TINT: readonly [number, number, number] = [0.62, 0.7, 0.86];

/** The floor's vertices across the line, a metre apart. */
const FLOOR_VERTICES = 2 * WAY_FLOOR_EDGE_M + 1;
const WALL_VERTICES = WAY_WALL_STEPS + 1;
/** Vertices a point of the way gives. */
export const WAY_POINT_VERTICES = FLOOR_VERTICES + 2 * WALL_VERTICES;
/** Metres between the way's points (sim/wayDown.ts WAY_STEP_M; a test holds a chunk to 64 m by it). */
const STEP_M = 2;

const smooth = (r: number): number => r * r * (3 - 2 * r);

/**
 * A wall's light at `t` of the way up it, 0 at its foot to 1 at its rim:
 * dark where it begins to rise, gathering light as it climbs, fading to
 * nothing at the rim.
 */
export function wallProfile(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return Math.pow(smooth(Math.min(1, t / 0.6)), 1.6) * Math.pow(1 - t, 1.1);
}

/** The floor's light `lateral` metres from the line: whole within WAY_FLOOR_CORE_M, gone by WAY_FLOOR_EDGE_M. */
export function floorProfile(lateral: number): number {
  const d = Math.abs(lateral);
  if (d <= WAY_FLOOR_CORE_M) return 1;
  if (d >= WAY_FLOOR_EDGE_M) return 0;
  return 1 - smooth((d - WAY_FLOOR_CORE_M) / (WAY_FLOOR_EDGE_M - WAY_FLOOR_CORE_M));
}

/** The way as the light needs it: what sim/wayDown.ts's WayDown is, and all the renderer sees of it. */
export type WayShape = { readonly xs: Float32Array; readonly zs: Float32Array; readonly cum: Float32Array; readonly length: number };

/** A wall's profile across its strips: metres out from the line, metres up, and its light, foot to rim. */
const WALL: readonly { out: number; up: number; light: number }[] = Array.from({ length: WALL_VERTICES }, (_, k) => {
  const t = k / WAY_WALL_STEPS, a = (t * Math.PI) / 2;
  return { out: WAY_WALL_FOOT_M + WAY_WALL_RADIUS_M * Math.sin(a), up: WAY_WALL_RADIUS_M * (1 - Math.cos(a)), light: wallProfile(t) };
});

/** The way's points a chunk each, as [first, last] indices: WAY_CHUNK_M of way a chunk, neighbours sharing their end point. */
export function wayChunks(way: WayShape): [number, number][] {
  const out: [number, number][] = [];
  const per = WAY_CHUNK_M / STEP_M;
  for (let from = 0; from + 1 < way.xs.length; from += per) out.push([from, Math.min(from + per, way.xs.length - 1)]);
  return out;
}

/**
 * The half pipe over the way's points `from` to `to`: positions (three
 * floats a vertex, world space), `light` (two floats a vertex: the profile
 * and the kind) and the triangles' indices. Every vertex stands on
 * `heightAt` of its own place, WAY_LIFT_M over it, a wall's as high again as
 * its curve.
 */
export function wayChunk(way: WayShape, heightAt: (x: number, z: number) => number, from: number, to: number): { positions: Float32Array; light: Float32Array; indices: Uint32Array } {
  const points = to - from + 1;
  const positions = new Float32Array(points * WAY_POINT_VERTICES * 3);
  const light = new Float32Array(points * WAY_POINT_VERTICES * 2);
  const last = way.xs.length - 1;
  let v = 0;
  const put = (x: number, z: number, up: number, share: number, kind: number): void => {
    positions[v * 3] = x;
    positions[v * 3 + 1] = heightAt(x, z) + WAY_LIFT_M + up;
    positions[v * 3 + 2] = z;
    light[v * 2] = share;
    light[v * 2 + 1] = kind;
    v++;
  };
  for (let i = from; i <= to; i++) {
    const x = way.xs[i] as number, z = way.zs[i] as number;
    // The way's direction here, from the points either side, and the unit vector to its left.
    const a = i > 0 ? i - 1 : i, b = i < last ? i + 1 : i;
    let tx = (way.xs[b] as number) - (way.xs[a] as number), tz = (way.zs[b] as number) - (way.zs[a] as number);
    const len = Math.hypot(tx, tz);
    tx = len > 0 ? tx / len : 1;
    tz = len > 0 ? tz / len : 0;
    const lx = -tz, lz = tx;
    for (let k = 0; k < FLOOR_VERTICES; k++) {
      const lateral = k - WAY_FLOOR_EDGE_M;
      put(x + lx * lateral, z + lz * lateral, 0, floorProfile(lateral), 0);
    }
    for (const side of [1, -1]) {
      for (const w of WALL) put(x + lx * side * w.out, z + lz * side * w.out, w.up, w.light, 1);
    }
  }
  const quads = (FLOOR_VERTICES - 1) + 2 * WAY_WALL_STEPS;
  const indices = new Uint32Array((points - 1) * quads * 6);
  let n = 0;
  const strip = (p: number, first: number, count: number): void => {
    for (let k = 0; k < count; k++) {
      const a = p * WAY_POINT_VERTICES + first + k, b = a + 1, c = a + WAY_POINT_VERTICES, d = c + 1;
      indices[n++] = a; indices[n++] = c; indices[n++] = b;
      indices[n++] = b; indices[n++] = c; indices[n++] = d;
    }
  };
  for (let p = 0; p + 1 < points; p++) {
    strip(p, 0, FLOOR_VERTICES - 1);
    strip(p, FLOOR_VERTICES, WAY_WALL_STEPS);
    strip(p, FLOOR_VERTICES + WALL_VERTICES, WAY_WALL_STEPS);
  }
  return { positions, light, indices };
}
