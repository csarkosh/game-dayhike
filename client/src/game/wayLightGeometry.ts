/**
 * The way down's mist (docs/gameplay/2026-11-13-the-way-down.md): the way as
 * the player sees it in the chase, a channel of pale ground mist that lies
 * thin and low on the path and stands in tall banks either side of it. This
 * file is the geometry and its numbers, free of Babylon so it is tested as
 * arithmetic; wayLight.ts makes the meshes and the material from it.
 *
 * The mist is drawn as sheets that all read one field of noise in the
 * world, so together they look like a volume and never like a surface:
 *
 * - **Sheets** lie across the whole width and follow the ground, one at each
 *   of WAY_SHEETS_M over it. The lowest is the ground's own glow; the rest
 *   are the mist a plant on the path stands in.
 * - **Veils** stand along the way, WAY_VEILS a side, wandering in and out
 *   and taller and shorter as they go: the banks seen from the side.
 * - **Fins** stand across the way at every point, from the line outward: the
 *   banks, and the path's own mist, seen by an eye looking down the way,
 *   where the veils are edge on.
 *
 * A point of the way gives WAY_POINT_VERTICES vertices in a fixed order: the
 * sheets, lowest first, each from its left edge to its right; then, a side
 * at a time, each veil's foot and head, and the fin's inner foot and head
 * and outer foot and head. Each vertex carries WAY_LIGHT_FLOATS numbers for
 * the shader: its metres from the line, its metres over the ground, its
 * kind, and the metres the mist stands to where it is (a veil's and a fin's
 * head is built WAY_HEAD times as high as that).
 */
import type { Rgb } from "./colour.js";
import { CLOUD_NOISE_LARGE_M, CLOUD_NOISE_SMALL_M, CLOUD_WIND_MPS } from "./cloudParams.js";

/** Metres either side of the line the sheets reach, the metres over the ground each lies at, and the metres the banks stand to, which every sheet thins toward. */
export const WAY_WIDTH_M = 7;
export const WAY_SHEETS_M: readonly number[] = [0, 0.22, 0.45, 0.7, 0.95, 1.25, 1.6];
export const WAY_SHEET_TOP_M = 3;
/** The veils a side: the metres from the line each stands at and the metres it stands to, before its wandering. */
export const WAY_VEILS: readonly { out: number; top: number }[] = [{ out: 2.7, top: 2.3 }, { out: 3.7, top: 3.5 }, { out: 4.9, top: 3.0 }];
/**
 * A veil and a fin are built this many times as high as their mist stands at
 * rest. The shader lifts a top with the large shapes (to 1.2 times) and the
 * heave, and holds it under this head, so the mist always ends before its
 * sheet does and no bank shows a cut edge along its top.
 */
export const WAY_HEAD = 1.3;
/** A fin: the metres from the line it reaches and the metres it stands to, before its wandering. */
export const WAY_FIN_REACH_M = 6.4;
export const WAY_FIN_TOP_M = 3.6;
/**
 * The way across at a point is square to the line from this many points
 * behind it to this many ahead. The drawn way has kinks (a step in five
 * turns on a radius under 7 m), and a way across taken at the point alone
 * folds the mist over itself on the inside of one.
 */
export const WAY_ACROSS_POINTS = 4;
/** Metres of way a mesh holds, and the metres every vertex stands over the ground under it. */
export const WAY_CHUNK_M = 64;
export const WAY_LIFT_M = 0.08;

/** A vertex's kind, as the shader reads it. */
export const WAY_KIND_SHEET = 0;
export const WAY_KIND_VEIL = 1;
export const WAY_KIND_FIN = 2;
/** Numbers a vertex carries for the shader. */
export const WAY_LIGHT_FLOATS = 4;
/** Vertices across a sheet (a metre apart), in all a point's sheets, a side's veils and fin, and a point's whole. */
export const WAY_ROW_VERTICES = 2 * WAY_WIDTH_M + 1;
export const WAY_SHEET_VERTICES = WAY_ROW_VERTICES * WAY_SHEETS_M.length;
const SIDE_VERTICES = WAY_VEILS.length * 2 + 4;
export const WAY_POINT_VERTICES = WAY_SHEET_VERTICES + 2 * SIDE_VERTICES;
/** Places on the ground a point's vertices stand on (`wayGroundOf`): a sheet's row, and a side's veils and its fin's outer end. */
export const WAY_POINT_GROUNDS = WAY_ROW_VERTICES + 2 * (WAY_VEILS.length + 1);
/** Metres between the way's points (sim/wayDown.ts WAY_STEP_M; a test holds a chunk to 64 m by it). */
const STEP_M = 2;

// ---- The look, as the shader is given it (wayLight.ts sets each as a uniform). ----

/** How much a veil veils at its thickest, a fin's share of that, a sheet's own, and the share of what is behind it the mist hides (the rest of it is light added, so thin mist glows and thick mist settles at its own colour and never whitens). */
export const WAY_VEIL_STRENGTH = 0.3;
export const WAY_FIN_SHARE = 0.7;
export const WAY_SHEET_STRENGTH = 0.28;
export const WAY_HIDE_SHARE = 0.85;
/** The ground's glow under the banks and on the path, and how fast the ground's glow and the mist fall off with the metres from the eye (e^(-reach × d)). */
export const WAY_GROUND_BAND = 0.14;
export const WAY_GROUND_CORE = 0.04;
export const WAY_GROUND_REACH = 0.012;
export const WAY_MIST_REACH = 0.0144;
/** The path's mist: its share of the banks' and the metres it stands to. Then the share of itself the mist keeps against the eye (it fills to whole by 10 m), and the least a wisp's gap thins it to. */
export const WAY_PATH_SHARE = 0.55;
export const WAY_PATH_TOP_M = 1.7;
export const WAY_NEAR_DAMP = 0.3;
export const WAY_DENSITY_FLOOR = 0.15;
/**
 * The mist's movement, so the banks are never still: how far their tops
 * heave (a share of their height, on slow waves passing along them), how far
 * the small shapes are carried by the large ones (a share of a tile: they
 * curl and change, where a plain drift only slides), how many times the
 * ground mist's wind the shapes drift at, and the metres of height a
 * standing sheet's small shapes span.
 */
export const WAY_HEAVE = 0.3;
/** The heave's two waves, in radians a second: a turn every 7 s and every 11 s, crossed, so the banks never repeat a beat a player could count. */
export const WAY_HEAVE_RATES: readonly [number, number] = [0.9, 0.55];
export const WAY_CURL = 0.12;
export const WAY_WIND_SCALE = 2.2;
export const WAY_STRATA_M = 4;
/** The cold the mist's colour leans toward (linear), by how much, and how many times the ground mist's own colour it is lit to, on the post path (before the tone map) and on the material path (in the frame's own terms). */
export const WAY_TINT: readonly [number, number, number] = [0.62, 0.7, 0.86];
export const WAY_COLD_SHARE = 0.25;
export const WAY_POST_LIFT = 8;
export const WAY_MATERIAL_LIFT = 14;

const weight = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * The mist's colour: the ground mist's own (`mist`, cloudParams.ts
 * cloudColourUnder), so it belongs to the night it stands in, leant
 * WAY_COLD_SHARE of the way toward the cold tint at the same weight, and
 * `lift` times as bright, so it reads as the lit way.
 */
export function wayMistColour(mist: Rgb, lift: number): [number, number, number] {
  const cold = weight(mist.r, mist.g, mist.b) / weight(WAY_TINT[0], WAY_TINT[1], WAY_TINT[2]);
  return [
    (mist.r + (cold * WAY_TINT[0] - mist.r) * WAY_COLD_SHARE) * lift,
    (mist.g + (cold * WAY_TINT[1] - mist.g) * WAY_COLD_SHARE) * lift,
    (mist.b + (cold * WAY_TINT[2] - mist.b) * WAY_COLD_SHARE) * lift,
  ];
}

/** Where the shapes have drifted to at `seconds`: the large shapes' offset (x, y) and the small shapes' (z, w), each a share of its tile, the small going another way from the large. */
export function wayDrift(seconds: number): [number, number, number, number] {
  const large = (seconds * CLOUD_WIND_MPS * WAY_WIND_SCALE) / CLOUD_NOISE_LARGE_M;
  const small = (seconds * CLOUD_WIND_MPS * WAY_WIND_SCALE) / CLOUD_NOISE_SMALL_M;
  return [large % 1, (large * 0.6) % 1, (small * 0.6) % 1, small % 1];
}

/** Where the heave's two waves are at `seconds`, each within a turn, so the shader's sines keep their precision however long the page has run. */
export function wayHeavePhases(seconds: number): [number, number] {
  const turn = 2 * Math.PI;
  return [(seconds * WAY_HEAVE_RATES[0]) % turn, (seconds * WAY_HEAVE_RATES[1]) % turn];
}

/** Veil `k` on `side` (1 or -1) at `s` metres down the way: the metres from the line it stands at and the metres it stands to. It wanders, so no two lines of it run true. */
export function wayVeilAt(k: number, side: number, s: number): { out: number; top: number } {
  const veil = WAY_VEILS[k] as { out: number; top: number };
  return {
    out: veil.out + 0.45 * Math.sin(s * 0.13 + k * 2.1 + side) + 0.3 * Math.sin(s * 0.051 + k * 1.3 - side),
    top: veil.top * (1 + 0.22 * Math.sin(s * 0.09 + k * 1.7 + side * 2) + 0.14 * Math.sin(s * 0.23 + k)),
  };
}

/** The metres the fin on `side` (1 or -1) stands to at `s` metres down the way. */
export function wayFinTop(side: number, s: number): number {
  return WAY_FIN_TOP_M * (1 + 0.25 * Math.sin(s * 0.31 + side * 1.9) + 0.15 * Math.sin(s * 0.83 + side));
}

/**
 * For vertex `j` of a point, the vertex of that point whose place on the
 * ground it stands over (itself, where it is the first there): a sheet's
 * vertex stands over the lowest sheet's, a head over its foot, and a fin's
 * inner end over the line. The ground's height is the dear part of a build,
 * and this is how it asks for WAY_POINT_GROUNDS of them a point.
 */
export function wayGroundOf(j: number): number {
  if (j < WAY_SHEET_VERTICES) return j % WAY_ROW_VERTICES;
  const r = (j - WAY_SHEET_VERTICES) % SIDE_VERTICES;
  const veils = WAY_VEILS.length * 2;
  if (r < veils) return j - (r % 2);
  if (r < veils + 2) return WAY_WIDTH_M;
  return j - (r - veils - 2);
}

/** The way as the mist needs it: what sim/wayDown.ts's WayDown is, and all the renderer sees of it. */
export type WayShape = { readonly xs: Float32Array; readonly zs: Float32Array; readonly cum: Float32Array; readonly length: number };

/** The way's points a chunk each, as [first, last] indices: WAY_CHUNK_M of way a chunk, neighbours sharing their end point. */
export function wayChunks(way: WayShape): [number, number][] {
  const out: [number, number][] = [];
  const per = WAY_CHUNK_M / STEP_M;
  for (let from = 0; from + 1 < way.xs.length; from += per) out.push([from, Math.min(from + per, way.xs.length - 1)]);
  return out;
}

/**
 * The mist over the way's points `from` to `to`, standing on `heightAt`:
 * positions, `light` (WAY_LIGHT_FLOATS a vertex) and the triangles' indices.
 */
export function wayChunk(way: WayShape, heightAt: (x: number, z: number) => number, from: number, to: number): { positions: Float32Array; light: Float32Array; indices: Uint32Array } {
  const points = to - from + 1;
  const positions = new Float32Array(points * WAY_POINT_VERTICES * 3);
  const light = new Float32Array(points * WAY_POINT_VERTICES * WAY_LIGHT_FLOATS);
  const last = way.xs.length - 1;
  let v = 0;
  const put = (x: number, z: number, up: number, lateral: number, kind: number, top: number): void => {
    positions[v * 3] = x;
    positions[v * 3 + 1] = heightAt(x, z) + WAY_LIFT_M + up;
    positions[v * 3 + 2] = z;
    light[v * WAY_LIGHT_FLOATS] = lateral;
    light[v * WAY_LIGHT_FLOATS + 1] = up;
    light[v * WAY_LIGHT_FLOATS + 2] = kind;
    light[v * WAY_LIGHT_FLOATS + 3] = top;
    v++;
  };
  for (let i = from; i <= to; i++) {
    const x = way.xs[i] as number, z = way.zs[i] as number;
    const a = Math.max(0, i - WAY_ACROSS_POINTS), b = Math.min(last, i + WAY_ACROSS_POINTS);
    let tx = (way.xs[b] as number) - (way.xs[a] as number), tz = (way.zs[b] as number) - (way.zs[a] as number);
    const len = Math.hypot(tx, tz);
    tx = len > 0 ? tx / len : 1;
    tz = len > 0 ? tz / len : 0;
    // The way across, to the line's left.
    const lx = -tz, lz = tx;
    const s = way.cum[i] as number;
    for (const up of WAY_SHEETS_M) {
      for (let k = 0; k < WAY_ROW_VERTICES; k++) {
        const lateral = k - WAY_WIDTH_M;
        put(x + lx * lateral, z + lz * lateral, up, Math.abs(lateral), WAY_KIND_SHEET, WAY_SHEET_TOP_M);
      }
    }
    for (const side of [1, -1]) {
      for (let k = 0; k < WAY_VEILS.length; k++) {
        const { out, top } = wayVeilAt(k, side, s);
        put(x + lx * side * out, z + lz * side * out, 0, out, WAY_KIND_VEIL, top);
        put(x + lx * side * out, z + lz * side * out, top * WAY_HEAD, out, WAY_KIND_VEIL, top);
      }
      const top = wayFinTop(side, s);
      put(x, z, 0, 0, WAY_KIND_FIN, top);
      put(x, z, top * WAY_HEAD, 0, WAY_KIND_FIN, top);
      put(x + lx * side * WAY_FIN_REACH_M, z + lz * side * WAY_FIN_REACH_M, 0, WAY_FIN_REACH_M, WAY_KIND_FIN, top);
      put(x + lx * side * WAY_FIN_REACH_M, z + lz * side * WAY_FIN_REACH_M, top * WAY_HEAD, WAY_FIN_REACH_M, WAY_KIND_FIN, top);
    }
  }
  const between = (WAY_ROW_VERTICES - 1) * WAY_SHEETS_M.length + 2 * WAY_VEILS.length;
  // A point's fins are drawn once over the whole way: the point two chunks share by the chunk that begins on it, the way's last by its own.
  const finned = to === last ? points : points - 1;
  const indices = new Uint32Array(((points - 1) * between + finned * 2) * 6);
  let n = 0;
  const quad = (a: number, b: number, c: number, d: number): void => {
    indices[n++] = a; indices[n++] = c; indices[n++] = b;
    indices[n++] = b; indices[n++] = c; indices[n++] = d;
  };
  for (let p = 0; p < points; p++) {
    const at = p * WAY_POINT_VERTICES;
    if (p + 1 < points) {
      for (let l = 0; l < WAY_SHEETS_M.length; l++) {
        for (let k = 0; k + 1 < WAY_ROW_VERTICES; k++) {
          const a = at + l * WAY_ROW_VERTICES + k;
          quad(a, a + 1, a + WAY_POINT_VERTICES, a + WAY_POINT_VERTICES + 1);
        }
      }
      for (let side = 0; side < 2; side++) {
        for (let k = 0; k < WAY_VEILS.length; k++) {
          const a = at + WAY_SHEET_VERTICES + side * SIDE_VERTICES + k * 2;
          quad(a, a + 1, a + WAY_POINT_VERTICES, a + WAY_POINT_VERTICES + 1);
        }
      }
    }
    if (p >= finned) continue;
    for (let side = 0; side < 2; side++) {
      const a = at + WAY_SHEET_VERTICES + side * SIDE_VERTICES + WAY_VEILS.length * 2;
      quad(a, a + 1, a + 2, a + 3);
    }
  }
  return { positions, light, indices };
}
