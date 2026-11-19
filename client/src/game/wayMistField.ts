/**
 * The mist beyond the way's banks (docs/gameplay/2026-11-13-the-way-down.md),
 * as it is drawn on the tiers with no marched ground mist: one mesh round
 * the eye (wayMistFieldGeometry.ts) and one material, the way's own mist
 * carried on over all the ground the player can see. This file is what that
 * material is drawn with and how the mesh follows the eye, computed with no
 * engine; `lite/wayFieldMesh.ts` makes the mesh and the material from it.
 *
 * The stages' text is `shaders/wayField/`. A vertex carries, as
 * wayMistFieldGeometry.ts sets them: its metres from the way's line (under
 * nothing where its ground is not yet known, which draws nothing), its
 * metres over the ground, its kind (0 a sheet, 1 a fin) and the metres a
 * fin's mist stands to. The fragment reads the same field of noise as the
 * way's own mist (wayLight.ts), drifts and curls and heaves with it, thins
 * near the eye as it does, and is blended as it is, so the two are one mist.
 * It comes in from `wayFieldReach.x` to `wayFieldReach.y` metres off the
 * way's line, where the way's banks go out, and fades out from
 * `wayFieldReach.z` to `wayFieldReach.w` metres from the eye, short of the
 * mesh's own edge. `wayFieldMist` is a sheet's strength, a fin's, the metres
 * the sheets' mist stands to, and the share of what lies behind that the
 * mist hides.
 */
import { wayDistanceWithin, type WayDown } from "../sim/wayDown.js";
import { WAY_CURL, WAY_HEAD, WAY_HEAVE, WAY_HIDE_SHARE } from "./wayLightGeometry.js";
import {
  FIELD_CELL_M, FIELD_FAR_M, FIELD_FILL_A_FRAME, FIELD_FIN_STRENGTH, FIELD_FLOATS, FIELD_FROM_M, FIELD_RIM_M, FIELD_SHEET_STRENGTH, FIELD_TOP_M, FIELD_VERTICES, FIELD_WHOLE_M,
  fillField, newFieldCache, refreshField,
} from "./wayMistFieldGeometry.js";

/** The field's uniforms, by the names its stages read them under. */
export type WayFieldUniforms = {
  wayTint: [number, number, number];
  wayGain: [number];
  wayHead: [number];
  wayMove: [number, number, number, number];
  wayDrift: [number, number, number, number];
  wayFieldMist: [number, number, number, number];
  wayFieldReach: [number, number, number, number];
};

/** The field's uniforms with the geometry's numbers in them and no mist yet. */
export function emptyWayFieldUniforms(): WayFieldUniforms {
  return {
    wayTint: [0, 0, 0],
    wayGain: [0],
    wayHead: [WAY_HEAD],
    wayMove: [WAY_HEAVE, WAY_CURL, 0, 0],
    wayDrift: [0, 0, 0, 0],
    wayFieldMist: [FIELD_SHEET_STRENGTH, FIELD_FIN_STRENGTH, FIELD_TOP_M, WAY_HIDE_SHARE],
    wayFieldReach: [FIELD_FROM_M, FIELD_WHOLE_M, FIELD_RIM_M[0], FIELD_RIM_M[1]],
  };
}

/** The field's vertices as they follow the eye. */
export type WayFieldFollow = {
  /** The vertices' places and their four numbers each (`FIELD_FLOATS`), written in place. */
  readonly positions: Float32Array;
  readonly field: Float32Array;
  /**
   * A frame with the eye at `eye` over `way`, on the ground `heightAt`: asks
   * for a few more of the square's cells (`FIELD_FILL_A_FRAME`), the nearest
   * first, and lays the vertices out again where a cell was learned or the
   * eye has crossed into another cell. True where the vertices changed. A
   * way that is another forgets the cells kept for the last.
   */
  step(eye: { readonly x: number; readonly y: number; readonly z: number }, way: WayDown, heightAt: (x: number, z: number) => number): boolean;
};

/** The field's vertices, none known yet: every one says it is under nothing from the way, and draws nothing. */
export function createWayFieldFollow(): WayFieldFollow {
  const out = { positions: new Float32Array(FIELD_VERTICES * 3), field: new Float32Array(FIELD_VERTICES * FIELD_FLOATS).fill(-1) };
  let cache = newFieldCache();
  let lastWay: WayDown | null = null;
  let lastX = Number.NaN, lastZ = Number.NaN;
  return {
    positions: out.positions,
    field: out.field,
    step(eye, way, heightAt) {
      if (way !== lastWay) {
        lastWay = way;
        cache = newFieldCache();
      }
      const cellX = Math.round(eye.x / FIELD_CELL_M), cellZ = Math.round(eye.z / FIELD_CELL_M);
      const filled = refreshField(cache, cellX, cellZ, heightAt, (x, z) => wayDistanceWithin(way, x, z, FIELD_FAR_M), FIELD_FILL_A_FRAME);
      if (filled === 0 && cellX === lastX && cellZ === lastZ) return false;
      lastX = cellX;
      lastZ = cellZ;
      fillField(out, cellX, cellZ, cache, eye.y);
      return true;
    },
  };
}
