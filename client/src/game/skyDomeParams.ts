/**
 * What the sky's dome is drawn with, for a sky state (`skyStateFor`), with no
 * engine: the box's size, the stage's uniforms by name, and whether the
 * table's slice is to go up again. `skyDome.ts` draws the dome with them on
 * Babylon.js, `lite/skyDome.ts` on Babylon Lite; the stage's own text is
 * `skyDome.fragment.glsl`, whose uniforms these are.
 *
 * Loads no engine.
 */
import { NIGHT_SKY } from "./sky.js";
import type { SkyState } from "./skyState.js";

/** The box's size: big enough to sit outside any view, small enough to stay inside the far plane. */
export const SKY_DOME_SIZE = 8000;

/**
 * The dome's uniforms that the sky and the frame's exposure set, by the
 * stage's names, in the order it declares them. The capture's switch and
 * the tone map's are a pass's and a colour path's, not the sky's, and are
 * not here.
 */
export type SkyDomeUniforms = {
  /** The table's units to the scene's: 1 once the slice goes up already scaled, 0 before any (the night sky alone). */
  skyScale: [number];
  skyCloud: [number];
  skyDeckZenith: [number, number, number];
  /** The night floor (`SkyState.nightFloor`). */
  skyNight: [number, number, number];
  skyMistAir: [number, number, number];
  skyMistWeight: [number];
  /** Toward the sun. */
  skySunDir: [number, number, number];
  /** The disc's colour in the view. */
  skyDisc: [number, number, number];
  skyExposure: [number];
  skyContrast: [number];
};

/** The dome before any sky state: the night sky alone, straight up, at an exposure and a contrast of 1. */
export function emptySkyDomeUniforms(): SkyDomeUniforms {
  return {
    skyScale: [0], skyCloud: [0], skyDeckZenith: [0, 0, 0], skyNight: [NIGHT_SKY.r, NIGHT_SKY.g, NIGHT_SKY.b], skyMistAir: [0, 0, 0],
    skyMistWeight: [0], skySunDir: [0, 1, 0], skyDisc: [0, 0, 0], skyExposure: [1], skyContrast: [1],
  };
}

/**
 * The dome's uniforms for `s`, at the frame's `exposure` and the display
 * curve's `contrast`: the sky's from the state, with the slice taken as
 * already in the scene's units (`skyScale` 1: it goes up times the state's
 * scale, `rgbToHalfRgba`). Fills and returns `out` (a record of its own when
 * none is given).
 */
export function skyDomeUniforms(s: SkyState, exposure: number, contrast: number, out: SkyDomeUniforms = emptySkyDomeUniforms()): SkyDomeUniforms {
  out.skyScale[0] = 1;
  out.skyCloud[0] = s.cloud;
  out.skyDeckZenith[0] = s.deckZenith.r;
  out.skyDeckZenith[1] = s.deckZenith.g;
  out.skyDeckZenith[2] = s.deckZenith.b;
  out.skyNight[0] = s.nightFloor.r;
  out.skyNight[1] = s.nightFloor.g;
  out.skyNight[2] = s.nightFloor.b;
  out.skyMistAir[0] = s.mistAir.r;
  out.skyMistAir[1] = s.mistAir.g;
  out.skyMistAir[2] = s.mistAir.b;
  out.skyMistWeight[0] = s.mistWeight;
  out.skySunDir[0] = s.sunDir.x;
  out.skySunDir[1] = s.sunDir.y;
  out.skySunDir[2] = s.sunDir.z;
  out.skyDisc[0] = s.discColour.r;
  out.skyDisc[1] = s.discColour.g;
  out.skyDisc[2] = s.discColour.b;
  out.skyExposure[0] = exposure;
  out.skyContrast[0] = contrast;
  return out;
}

/**
 * When the table's slice goes up again: the scaled slice depends on the
 * sun's altitude and on how many slices the table held (`SkyState.tableCount`)
 * alone, so a weather fade uploads nothing.
 */
export type SkyTableUploads = {
  /** Whether the slice of `s` is to go up: true when either has moved since
   * the last state it said true for (the first included), which it now
   * holds as uploaded. */
  due(s: SkyState): boolean;
};

export function createSkyTableUploads(): SkyTableUploads {
  let altitude = Number.NaN;
  let count = -1;
  return {
    due(s) {
      if (s.clear.altitudeDeg === altitude && s.tableCount === count) return false;
      altitude = s.clear.altitudeDeg;
      count = s.tableCount;
      return true;
    },
  };
}
