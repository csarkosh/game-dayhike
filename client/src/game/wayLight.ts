/**
 * The way down's mist (docs/gameplay/2026-11-13-the-way-down.md), as it is
 * drawn: the channel of pale ground mist a player in the chase runs down,
 * geometry (sheets over the ground, veils along the way and fins across it,
 * wayLightGeometry.ts) with one material of its own, so no other material's
 * shader knows of it. This file is what that material is drawn with and how
 * a stretch of the way is stood on the ground, computed with no engine;
 * `lite/wayLightMeshes.ts` makes the meshes and the material from it.
 *
 * The stages' text is `shaders/wayLight/`. A vertex carries, as
 * wayLightGeometry.ts sets them: its metres from the way's line, its metres
 * over the ground, its kind (0 a sheet, 1 a veil, 2 a fin) and the metres
 * the mist stands to where it is. The fragment stage does the rest, since
 * the mist is shaped by where each fragment is in the world:
 *
 * - **Every sheet reads the one field of noise in the world** (the ground
 *   mist's own map: large shapes in its red, small in its green), so
 *   together they look like a volume.
 * - **Across the way the mist is thin on the path and whole in the banks
 *   either side**: `wayPath.x` of the banks' on the line, filling to whole
 *   between `wayEdge.x` and `wayEdge.y` metres from it, gone between
 *   `wayEdge.z` and `wayEdge.w`. It stands lower on the path too
 *   (`wayPath.y` metres, the banks to each vertex's own). The lowest sheet
 *   is the ground's own glow, a faint core on the path.
 * - **It moves.** The shapes drift (`wayDrift`), the small ones another way
 *   from the large and carried by them (`wayMove.y`), so they curl and
 *   change. The banks' tops heave on two crossed waves (`wayMove.x` of their
 *   height, the waves' phases in `wayMove.z` and `wayMove.w`). A veil's and
 *   a fin's mist is held under the head its sheet is built to (`wayHead`
 *   times the height it stands to at rest), so it always ends before its
 *   sheet does.
 * - **Near the eye the shapes smooth to a plain veil** and the mist thins to
 *   `wayPath.z` of itself, so it hangs round a runner and never rushes past.
 *   A fin seen edge on fades out, and a sheet seen along itself, so neither
 *   shows as a line: how squarely the eye looks at a face is read from the
 *   face itself, so a sheet on a slope is judged by its own lie, and a face
 *   too small to have a lie (a fragment against the eye) is given none,
 *   never a division by nothing. With the metres from the eye everything
 *   falls away (`wayGround.z` the ground's glow, `wayGround.w` the mist).
 * - **The blend is premultiplied**: the colour goes out times the amount,
 *   and the alpha is the share of what lies behind that the mist hides
 *   (`wayMist.w` of the amount). Thin mist glows a little, thick mist
 *   settles at its own colour and never whitens.
 */
import type { Rgb } from "@csarkosh/engine/game/colour";
import { CHASE_TINT } from "@csarkosh/engine/game/gradeParams";
import { sliceDue, type Slices } from "@csarkosh/engine/game/syncJobs";
import {
  WAY_CURL, WAY_DENSITY_FLOOR, WAY_EDGE_M, WAY_FIN_SHARE, WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_HEAD, WAY_HEAVE, WAY_HIDE_SHARE, WAY_MIST_REACH,
  WAY_NEAR_DAMP, WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_POINT_VERTICES, WAY_SHEET_STRENGTH, WAY_STRATA_M, WAY_VEIL_STRENGTH,
  wayChunk, wayDrift, wayGroundOf, wayHeavePhases, wayTint, type WayShape,
} from "./wayLightGeometry.js";

/** Heights of the ground the build asks for in one slice of a frame's share, at the most. */
export const WAY_HEIGHTS_A_SLICE = 24;
/**
 * How far toward the eye the mist's depth is pulled, by the slope of each
 * face, so its lowest sheet never fights the ground it lies on. The depth
 * runs from 1 at the near plane to 0 far away, so toward the eye is up.
 */
export const WAY_DEPTH_SLOPE = 2;

/** Which path a tier's colour takes: graded by a post chain, or shown as the materials write it. */
export type WayColourPath = "post" | "material";

/** The mist's uniforms, by the names its stages read them under. */
export type WayLightUniforms = {
  wayTint: [number, number, number];
  wayGain: [number];
  wayStrata: [number];
  wayHead: [number];
  wayMist: [number, number, number, number];
  wayGround: [number, number, number, number];
  wayPath: [number, number, number, number];
  wayEdge: [number, number, number, number];
  wayMove: [number, number, number, number];
  wayDrift: [number, number, number, number];
};

/** The mist's uniforms with the geometry's numbers in them and no mist yet: nothing drawn, nothing moved. */
export function emptyWayLightUniforms(): WayLightUniforms {
  return {
    wayTint: [0, 0, 0],
    wayGain: [0],
    wayStrata: [WAY_STRATA_M],
    wayHead: [WAY_HEAD],
    wayMist: [WAY_VEIL_STRENGTH, WAY_FIN_SHARE, WAY_SHEET_STRENGTH, WAY_HIDE_SHARE],
    wayGround: [WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_MIST_REACH],
    wayPath: [WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_NEAR_DAMP, WAY_DENSITY_FLOOR],
    wayEdge: [WAY_EDGE_M[0], WAY_EDGE_M[1], WAY_EDGE_M[2], WAY_EDGE_M[3]],
    wayMove: [WAY_HEAVE, WAY_CURL, 0, 0],
    wayDrift: [0, 0, 0, 0],
  };
}

/**
 * What moves with a frame, into `out`: the mist's `level` (0 none, 1
 * whole); its colour, the ground mist's (`mist`, cloudParams.ts
 * cloudColourUnder) lit as the tier's path needs it (`wayTint`: on the post
 * path `undim`, one over what the frame outside the mist is dimmed by, is
 * taken back out of it; on the material path it takes the chase's `cast`, 0
 * to 1, itself); and where the frame's `seconds` have carried its shapes and
 * its banks' heave.
 */
export function wayMistFrame(
  path: WayColourPath, level: number, undim: number, mist: Rgb, seconds: number, cast: number,
  out: { wayTint: [number, number, number]; wayGain: [number]; wayMove: [number, number, number, number]; wayDrift: [number, number, number, number] },
): void {
  const [r, g, b] = wayTint(path, mist, undim, cast, CHASE_TINT);
  out.wayTint[0] = r;
  out.wayTint[1] = g;
  out.wayTint[2] = b;
  out.wayGain[0] = level;
  const [dx, dy, dz, dw] = wayDrift(seconds);
  out.wayDrift[0] = dx;
  out.wayDrift[1] = dy;
  out.wayDrift[2] = dz;
  out.wayDrift[3] = dw;
  const [first, second] = wayHeavePhases(seconds);
  out.wayMove[0] = WAY_HEAVE;
  out.wayMove[1] = WAY_CURL;
  out.wayMove[2] = first;
  out.wayMove[3] = second;
}

/** A stretch of the way's mist, stood on the ground. */
export type WayChunkData = { positions: Float32Array; light: Float32Array; indices: Uint32Array };

/**
 * The mist over the way's points `from` to `to`, stood on `heightAt`, in
 * slices. The chunk is laid on a flat ground first, then each vertex lifted
 * onto the real one: the ground's height is the dear part (the walkable
 * rock's layer is several reads a place), so a vertex that stands over
 * another's place on it (a sheet over the lowest, a head over its foot)
 * takes that one's, and a slice ends after `WAY_HEIGHTS_A_SLICE` heights or
 * when the scheduler's clock says so, whichever is first.
 */
export function* standWayChunk(way: WayShape, heightAt: (x: number, z: number) => number, from: number, to: number): Slices<WayChunkData> {
  const data = wayChunk(way, () => 0, from, to);
  const count = data.positions.length / 3;
  const ground = new Float32Array(count);
  let asked = 0;
  for (let v = 0; v < count; v++) {
    const j = v % WAY_POINT_VERTICES, own = wayGroundOf(j);
    if (own !== j) ground[v] = ground[v - j + own] as number;
    else {
      ground[v] = heightAt(data.positions[v * 3] as number, data.positions[v * 3 + 2] as number);
      if (++asked % WAY_HEIGHTS_A_SLICE === 0 || sliceDue()) yield;
    }
    data.positions[v * 3 + 1] = (data.positions[v * 3 + 1] as number) + (ground[v] as number);
  }
  return data;
}
