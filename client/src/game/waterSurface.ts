/**
 * A body of water's surface as numbers: what its material is drawn with a
 * frame, kept and stepped with no engine. One record a material (the sea's,
 * each lake's): the row it is shaded by, where its bed's square lies, the
 * clock and the wind and the wind's integral over the run, the rain and the
 * sun's share, and on a lake its time, the cat's-paws' cover, its calm, its
 * mirror's numbers and the shore it reflects. The water's plugins take the
 * values as records of uniforms by name (`lakeUniforms`,
 * `waterFrameUniforms`).
 *
 * Also the ripple bump's drift (`createBumpDrift`): how far the bump's
 * picture has slid under the low tier's sea and under the lakes.
 */
import { MIRROR_OFFSET_K } from "@csarkosh/engine/game/mirrorView";
import { roughnessFor, type WaterRow } from "./waterShading.js";
import { WIND_TIME_WRAP } from "@csarkosh/engine/game/windParams";

/** Bump-texture UV drift per second — u and v deliberately unequal so the
 * ripples drift diagonally instead of tracking an axis. */
export const WATER_UV_SCROLL = [0.015, 0.011] as const;

/** The scroll's speed, tiles a second: what a lake's ripple drifts at in a full wind. */
export const LAKE_BUMP_DRIFT = Math.hypot(WATER_UV_SCROLL[0], WATER_UV_SCROLL[1]);

/** How far a material's roughness may stand from the wind's before it is set again. */
export const WATER_ROUGHNESS_STEP = 1e-3;

/** One water material's numbers. */
export type WaterSurface = {
  readonly row: WaterRow;
  /** The bed height square's low corner (x, z), its texels a side and their spacing (m). */
  bedOrigin: [number, number];
  bedTexels: number;
  bedSpacing: number;
  /** The frame's 1/size, where the surface reads the frame behind it. */
  screen: [number, number];
  /** The camera's near and far, where the frame behind the surface is read. */
  nearFar: [number, number];
  /** The clock, seconds, as `advanceWater` last had it. */
  time: number;
  /** The wind's direction (x, z) and its 0..1 speed, as `setWaterWind` last had them. */
  windDir: [number, number];
  windSpeed: number;
  /** On a lake, the wind's velocity (its direction times its 0..1 speed)
   * integrated over the run, in seconds; on the sea, its direction alone. */
  windTime: [number, number];
  /** The clock `advanceWater` last stepped from; null before the first step. */
  lastSeconds: number | null;
  /** Ripple octaves the fragment blends: 2, or 1 on the low tier. */
  octaves: number;
  /** The duckweed and algae skin: how much of the surface may carry it, and the seed's noise offset. */
  skin: [number, number];
  /** The weather's rain, 0 to 1. */
  rain: number;
  /** The sun's share through the cloud and above the horizon, 0 to 1. */
  sun: number;
  /** The lake's time: the shared seconds wrapped at WIND_TIME_WRAP. */
  lakeTime: number;
  /** How much of the lake the cat's-paws may cover, 0 to 1: 1 until first set. */
  pawCover: number;
  /** The lake's centre (x, level, z) and its radius: the cylinder its shore is read on. */
  readonly lakeBody: [number, number, number, number];
  /** The forest's colour under the skyline, raw. */
  readonly shadeColour: [number, number, number];
  /** The calm: the glass's share, the state's mirror weight, a full paw's smear in pixels. */
  calmShare: number;
  mirrorWeight: number;
  mirrorSmearPx: number;
  /** The held frames' smear: pixels of the frame's height times metres. */
  mirrorMotion: number;
  /** The mirrored camera's view-projection, identity until set. */
  readonly mirrorViewProjection: Float32Array;
  /** The cove the swash's table runs along: z0, halfWidth, toeD, faceGrade; zeros until set. */
  readonly cove: [number, number, number, number];
};

/** A surface shaded by `row`, at rest: no wind, no rain, a lake rough all over until its calm is first set. */
export function createWaterSurface(row: WaterRow): WaterSurface {
  return {
    row,
    bedOrigin: [0, 0], bedTexels: 256, bedSpacing: 1,
    screen: [1, 1], nearFar: [0.05, 1000],
    time: 0, windDir: [1, 0], windSpeed: 0, windTime: [0, 0], lastSeconds: null,
    octaves: 2, skin: [0, 0], rain: 0, sun: 0, lakeTime: 0, pawCover: 1,
    lakeBody: [0, 0, 0, 0], shadeColour: [0, 0, 0],
    calmShare: 0, mirrorWeight: 0, mirrorSmearPx: 0, mirrorMotion: 0,
    mirrorViewProjection: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    cove: [0, 0, 0, 0],
  };
}

/**
 * The roughness the wind gives the surface, if the material's (`current`,
 * null where none is set) stands further from it than
 * `WATER_ROUGHNESS_STEP`; null where the material may keep its own.
 */
export function waterRoughnessDue(surface: WaterSurface, current: number | null, wind01: number): number | null {
  const r = roughnessFor(wind01, surface.row.shelter);
  return current === null || Math.abs(current - r) > WATER_ROUGHNESS_STEP ? r : null;
}

/** Per frame from the wind's record: the game's 0..1 wind and its direction (kept, not copied). */
export function setWaterWind(surface: WaterSurface, wind01: number, dir: [number, number]): void {
  surface.windDir = dir;
  surface.windSpeed = wind01;
}

/**
 * Per frame, with the renderer's clock: sets the time and adds the step to
 * the wind's integral, times the wind's velocity on a lake and its direction
 * alone on the sea (`sea`).
 */
export function advanceWater(surface: WaterSurface, seconds: number, sea: boolean): void {
  const dt = surface.lastSeconds === null ? 0 : Math.max(0, seconds - surface.lastSeconds);
  const speed = sea ? 1 : surface.windSpeed;
  surface.windTime[0] += surface.windDir[0] * speed * dt;
  surface.windTime[1] += surface.windDir[1] * speed * dt;
  surface.lastSeconds = seconds;
  surface.time = seconds;
}

/** Per frame, the shared seconds (wrapped or not): the lake's time, wrapped
 * at WIND_TIME_WRAP as the wind's is; 0 for a time that is not finite. */
export function setWaterLakeTime(surface: WaterSurface, seconds: number): void {
  surface.lakeTime = Number.isFinite(seconds) ? seconds - Math.floor(seconds / WIND_TIME_WRAP) * WIND_TIME_WRAP : 0;
}

/** Per frame, the share of the lake the cat's-paws may cover, clamped to 0..1; 0 for a cover that is not finite. */
export function setWaterPawCover(surface: WaterSurface, cover: number): void {
  surface.pawCover = Number.isFinite(cover) ? Math.min(1, Math.max(0, cover)) : 0;
}

/**
 * Per frame on a lake: the glass's share of it, the state's mirror weight (0
 * under rough), and a full paw's smear in pixels. The share and the weight
 * clamped to 0..1 and the smear to 0 and up; any of them 0 when it is not
 * finite.
 */
export function setWaterCalm(surface: WaterSurface, share: number, weight: number, smearPx: number): void {
  surface.calmShare = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  surface.mirrorWeight = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
  surface.mirrorSmearPx = Number.isFinite(smearPx) ? Math.max(0, smearPx) : 0;
}

/** Per frame on a lake: the held frames' smear, 0 and up; 0 when it is not finite. */
export function setWaterMirrorMotion(surface: WaterSurface, pxMetres: number): void {
  surface.mirrorMotion = Number.isFinite(pxMetres) ? Math.max(0, pxMetres) : 0;
}

/** The lake's centre at its level, and its radius: the shore's cylinder. */
export function setWaterLakeBody(surface: WaterSurface, x: number, level: number, z: number, radius: number): void {
  surface.lakeBody[0] = x;
  surface.lakeBody[1] = level;
  surface.lakeBody[2] = z;
  surface.lakeBody[3] = radius;
}

/** The forest's colour under the skyline, raw (copied). */
export function setWaterShade(surface: WaterSurface, shadeColour: readonly [number, number, number]): void {
  surface.shadeColour[0] = shadeColour[0];
  surface.shadeColour[1] = shadeColour[1];
  surface.shadeColour[2] = shadeColour[2];
}

/** The cove the swash's table runs along; all four 0 when any is not finite. */
export function setWaterCove(surface: WaterSurface, z0: number, halfWidth: number, toeD: number, faceGrade: number): void {
  const finite = Number.isFinite(z0) && Number.isFinite(halfWidth) && Number.isFinite(toeD) && Number.isFinite(faceGrade);
  surface.cove[0] = finite ? z0 : 0;
  surface.cove[1] = finite ? halfWidth : 0;
  surface.cove[2] = finite ? toeD : 0;
  surface.cove[3] = finite ? faceGrade : 0;
}

/**
 * A lake's own uniforms by the names its shader reads them under: what
 * belongs to the one lake and moves only as its calm, its bed's square or
 * the hour's shade does.
 */
export type LakeUniforms = {
  waterLevel: Float32Array;
  waterKd: Float32Array;
  waterBed: Float32Array;
  waterBedTexels: Float32Array;
  waterOctaves: Float32Array;
  waterSkin: Float32Array;
  waterPawCover: Float32Array;
  waterCalmShare: Float32Array;
  waterMirrorWeight: Float32Array;
  waterLakeCentre: Float32Array;
  waterLakeRadius: Float32Array;
  waterShadeColour: Float32Array;
  waterPanoramaOn: Float32Array;
  waterSkylineOn: Float32Array;
};

/** A lake's uniforms, zeros. */
export function emptyLakeUniforms(): LakeUniforms {
  const f = (n: number): Float32Array => new Float32Array(n);
  return {
    waterLevel: f(1), waterKd: f(3), waterBed: f(4), waterBedTexels: f(1), waterOctaves: f(1), waterSkin: f(2), waterPawCover: f(1),
    waterCalmShare: f(1), waterMirrorWeight: f(1), waterLakeCentre: f(3), waterLakeRadius: f(1), waterShadeColour: f(3),
    waterPanoramaOn: f(1), waterSkylineOn: f(1),
  };
}

/**
 * Fills `out` from `surface`, a lake's at `level`, which reflects a shore
 * panorama and a skyline or not (`shore`). Returns whether any value moved:
 * a material whose uniforms stand as they were is not written again.
 */
export function lakeUniforms(surface: WaterSurface, level: number, shore: { panorama: boolean; skyline: boolean }, out: LakeUniforms): boolean {
  let moved = false;
  const put = (to: Float32Array, at: number, value: number): void => {
    const next = Math.fround(value);
    if (to[at] !== next) {
      to[at] = next;
      moved = true;
    }
  };
  const extent = surface.bedTexels * surface.bedSpacing;
  put(out.waterLevel, 0, level);
  for (let i = 0; i < 3; i++) put(out.waterKd, i, surface.row.kd[i] as number);
  put(out.waterBed, 0, surface.bedOrigin[0]);
  put(out.waterBed, 1, surface.bedOrigin[1]);
  put(out.waterBed, 2, 1 / extent);
  put(out.waterBed, 3, surface.bedSpacing);
  put(out.waterBedTexels, 0, surface.bedTexels);
  put(out.waterOctaves, 0, surface.octaves);
  put(out.waterSkin, 0, surface.skin[0]);
  put(out.waterSkin, 1, surface.skin[1]);
  put(out.waterPawCover, 0, surface.pawCover);
  put(out.waterCalmShare, 0, surface.calmShare);
  put(out.waterMirrorWeight, 0, surface.mirrorWeight);
  for (let i = 0; i < 3; i++) put(out.waterLakeCentre, i, surface.lakeBody[i] as number);
  put(out.waterLakeRadius, 0, surface.lakeBody[3]);
  for (let i = 0; i < 3; i++) put(out.waterShadeColour, i, surface.shadeColour[i] as number);
  put(out.waterPanoramaOn, 0, shore.panorama ? 1 : 0);
  put(out.waterSkylineOn, 0, shore.skyline ? 1 : 0);
  return moved;
}

/**
 * A lake's mirror's uniforms by the names its shader reads them under, on
 * the tier that draws a mirror: the view-projection the picture was last
 * drawn through, whether this lake reads it, the ripple's reach into the
 * read, a full paw's smear and the held frames' smear.
 */
export type LakeMirrorUniforms = {
  waterMirrorVP: Float32Array;
  waterMirrorOn: Float32Array;
  waterMirrorK: Float32Array;
  waterMirrorSmearPx: Float32Array;
  waterMirrorMotion: Float32Array;
};

/** A lake's mirror's uniforms: no mirror read, the identity. */
export function emptyLakeMirrorUniforms(): LakeMirrorUniforms {
  return {
    waterMirrorVP: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), waterMirrorOn: new Float32Array(1), waterMirrorK: new Float32Array([MIRROR_OFFSET_K]),
    waterMirrorSmearPx: new Float32Array(1), waterMirrorMotion: new Float32Array(1),
  };
}

/**
 * Fills `out` from `surface`, a lake's that reads the mirror this frame or
 * not (`on`). Returns whether any value moved.
 */
export function lakeMirrorUniforms(surface: WaterSurface, on: boolean, out: LakeMirrorUniforms): boolean {
  let moved = false;
  const put = (to: Float32Array, at: number, value: number): void => {
    const next = Math.fround(value);
    if (to[at] !== next) {
      to[at] = next;
      moved = true;
    }
  };
  for (let i = 0; i < 16; i++) put(out.waterMirrorVP, i, surface.mirrorViewProjection[i] as number);
  put(out.waterMirrorOn, 0, on ? 1 : 0);
  put(out.waterMirrorK, 0, MIRROR_OFFSET_K);
  put(out.waterMirrorSmearPx, 0, surface.mirrorSmearPx);
  put(out.waterMirrorMotion, 0, surface.mirrorMotion);
  return moved;
}

/**
 * What every lake's shader reads alike and what moves with the frame, by
 * the names it is read under: the lakes' time, the wind's direction and its
 * integral over the run, the rain, the sun's share, and how far the ripple
 * bump has drifted (tiles; `waterBumpOffset`, the offset a renderer adds to
 * the bump's coordinates where its texture has none of its own).
 */
export type WaterFrameUniforms = {
  waterLakeTime: Float32Array;
  waterWind: Float32Array;
  waterWindTime: Float32Array;
  waterRain: Float32Array;
  waterSun: Float32Array;
  waterBumpOffset: Float32Array;
};

/** The frame's water uniforms, zeros. */
export function emptyWaterFrameUniforms(): WaterFrameUniforms {
  return {
    waterLakeTime: new Float32Array(1), waterWind: new Float32Array(2), waterWindTime: new Float32Array(2), waterRain: new Float32Array(1),
    waterSun: new Float32Array(1), waterBumpOffset: new Float32Array(2),
  };
}

/** Fills `out` from a lake's `surface` (every lake's frame values are one lake's) and the lakes' bump `drift`. */
export function waterFrameUniforms(surface: WaterSurface, drift: BumpDrift, out: WaterFrameUniforms): WaterFrameUniforms {
  out.waterLakeTime[0] = surface.lakeTime;
  out.waterWind[0] = surface.windDir[0];
  out.waterWind[1] = surface.windDir[1];
  out.waterWindTime[0] = surface.windTime[0];
  out.waterWindTime[1] = surface.windTime[1];
  out.waterRain[0] = surface.rain;
  out.waterSun[0] = surface.sun;
  out.waterBumpOffset[0] = drift.lake[0];
  out.waterBumpOffset[1] = drift.lake[1];
  return out;
}

/**
 * How far the ripple bump's picture has slid, tiles: under the low tier's
 * sea at a fixed rate, and under the lakes downwind at the wind's speed
 * (the sample runs against the offset, so the offset runs upwind).
 */
export type BumpDrift = {
  /** The sea's offset (u, v): moved on the low tier alone. */
  readonly sea: [number, number];
  /** The lakes' offset (u, v). */
  readonly lake: [number, number];
  /**
   * A step of `dt` seconds under a wind of `wind01` along `dir`: the sea's
   * where `sea` is true (the low tier), the lakes' where `lakes` is.
   */
  step(dt: number, wind01: number, dir: readonly [number, number], sea: boolean, lakes: boolean): void;
};

/** A bump at rest. */
export function createBumpDrift(): BumpDrift {
  const sea: [number, number] = [0, 0];
  const lake: [number, number] = [0, 0];
  return {
    sea,
    lake,
    step(dt, wind01, dir, seaMoves, lakesMove) {
      if (seaMoves) {
        sea[0] += WATER_UV_SCROLL[0] * dt;
        sea[1] += WATER_UV_SCROLL[1] * dt;
      }
      if (lakesMove) {
        lake[0] -= dir[0] * wind01 * LAKE_BUMP_DRIFT * dt;
        lake[1] -= dir[1] * wind01 * LAKE_BUMP_DRIFT * dt;
      }
    },
  };
}
