/**
 * The splashes with no engine: their seeds, how many a frame draws, and the
 * uniforms the rings are drawn with, by name. `rainParams.ts` has the
 * constants; what draws them (`lite/rainSplash.ts`) takes every value from
 * here.
 *
 * Renderer-only by design, as `rainParams.ts` is: nothing here may migrate
 * into sim/ or a tunables registry.
 */
import type { AtmosphereRecord } from "./atmosphereParams.js";
import { clamp01 } from "./colour.js";
import type { QualityTier } from "./quality.js";
import type { RainLamp } from "./rainField.js";
import { RAIN_LAMP_GAIN, RAIN_MAP, SPLASH_TIERS, rainSeeds, splashCountUnder, splashFold } from "./rainParams.js";
import type { WeatherParams } from "./weather.js";

/** The seed buffer's hash seed: the splashes' layout is the same on every load. */
export const SPLASH_SEED = 0x53706c73;

/** The sun's backlight fades in over this much of the sun's height (the
 * sine of its elevation): none once it is down. */
export const SUN_UP = 0.1;

/**
 * What the rings' stage reads, by the names the splash plugin declares
 * (`lite/rainSplash.ts`): the folded running time, the eye, the rain value, the
 * direction the sun's light travels scaled by how far up the sun is (0 once
 * it is down), the headlamp (its place, its direction, its intensity as
 * alpha with the cosine of its half-angle), and the cover map's centre and
 * extent.
 */
export type SplashUniforms = {
  splashTime: [number];
  splashCam: [number, number, number];
  splashRain: [number];
  splashSun: [number, number, number];
  splashLampPos: [number, number, number];
  splashLampDir: [number, number, number];
  splashLamp: [number, number];
  splashMapCentre: [number, number];
  splashMapExtent: [number];
};

/** A record of the right shape, as a plugin starts, for `splashUniforms` to fill. */
export function emptySplashUniforms(): SplashUniforms {
  return {
    splashTime: [0], splashCam: [0, 0, 0], splashRain: [0], splashSun: [0, 0, 0], splashLampPos: [0, 0, 0], splashLampDir: [0, 0, 1], splashLamp: [0, 1],
    splashMapCentre: [0, 0], splashMapExtent: [RAIN_MAP.extent],
  };
}

/** The rings drawn under `w` on `tier`: the rain value's share of the tier's, none without a map to land on. */
export function splashesDrawn(w: WeatherParams, tier: QualityTier, hasMap: boolean): number {
  return hasMap ? splashCountUnder(w.rain, tier) : 0;
}

/**
 * The rings' uniforms for a frame: `sunDir` is the direction the sun's light
 * travels (the directional light's), `seconds` the running time, `map` the
 * cover map's centre, or null for none, which leaves the last one standing.
 * Fills and returns `out`.
 */
export function splashUniforms(
  cam: { x: number; y: number; z: number }, w: WeatherParams, lamp: RainLamp, sunDir: { x: number; y: number; z: number }, seconds: number,
  map: { readonly x: number; readonly z: number } | null, out: SplashUniforms = emptySplashUniforms(),
): SplashUniforms {
  out.splashTime[0] = splashFold(seconds);
  out.splashCam[0] = cam.x;
  out.splashCam[1] = cam.y;
  out.splashCam[2] = cam.z;
  out.splashRain[0] = clamp01(w.rain);
  // The light travels down while the sun is up: its height is -y.
  const up = clamp01(-sunDir.y / SUN_UP);
  out.splashSun[0] = sunDir.x * up;
  out.splashSun[1] = sunDir.y * up;
  out.splashSun[2] = sunDir.z * up;
  out.splashLampPos[0] = lamp.x;
  out.splashLampPos[1] = lamp.y;
  out.splashLampPos[2] = lamp.z;
  out.splashLampDir[0] = lamp.dx;
  out.splashLampDir[1] = lamp.dy;
  out.splashLampDir[2] = lamp.dz;
  out.splashLamp[0] = lamp.intensity * RAIN_LAMP_GAIN;
  out.splashLamp[1] = Math.cos(lamp.angle / 2);
  if (map !== null) {
    out.splashMapCentre[0] = map.x;
    out.splashMapCentre[1] = map.z;
  }
  return out;
}

/** Floats an instance of the splashes' mesh is: a matrix's sixteen, which carry the ring's seed and no matrix. */
export const SPLASH_INSTANCE_FLOATS = 16;

/**
 * The tier's rings as the instances of one mesh, for a renderer whose
 * instances carry a matrix alone: an instance's first four floats are the
 * ring's seed as `rainSeeds` makes it (three hashes and a size factor), the
 * rest nothing.
 */
export function splashInstances(tier: QualityTier): { data: Float32Array; count: number } {
  const count = SPLASH_TIERS[tier];
  const data = new Float32Array(count * SPLASH_INSTANCE_FLOATS);
  const seeds = rainSeeds(count, SPLASH_SEED);
  for (let i = 0; i < count; i++) data.set(seeds.subarray(i * 4, i * 4 + 4), i * SPLASH_INSTANCE_FLOATS);
  return { data, count };
}

/**
 * What a stage of a renderer's own reads beside the rings' record: the
 * material the game draws them with (its colour, the streaks'; the scene's
 * distance fog and the display curve of the material colour path).
 */
export type SplashStageUniforms = SplashUniforms & {
  splashEmissive: [number, number, number];
  splashFogColour: [number, number, number];
  splashFogDensity: [number];
  splashExposure: [number];
  splashContrast: [number];
};

/** A record of the right shape for `splashStageUniforms` to fill. */
export function emptySplashStageUniforms(): SplashStageUniforms {
  return { ...emptySplashUniforms(), splashEmissive: [0, 0, 0], splashFogColour: [0, 0, 0], splashFogDensity: [0], splashExposure: [0], splashContrast: [0] };
}

/**
 * The material's part of a stage's uniforms: coloured `milk` (`rainMilk`),
 * fogged by `air` (the scene's fog: its colour the gradient's far end, its
 * density the air's). The rings' own part of `out` is `splashUniforms`'.
 * Fills and returns `out`.
 */
export function splashStageUniforms(
  milk: readonly [number, number, number], air: AtmosphereRecord, exposure: number, contrast: number, out: SplashStageUniforms,
): SplashStageUniforms {
  out.splashEmissive[0] = milk[0];
  out.splashEmissive[1] = milk[1];
  out.splashEmissive[2] = milk[2];
  out.splashFogColour[0] = air.farColour.r;
  out.splashFogColour[1] = air.farColour.g;
  out.splashFogColour[2] = air.farColour.b;
  out.splashFogDensity[0] = air.baseDensity;
  out.splashExposure[0] = exposure;
  out.splashContrast[0] = contrast;
  return out;
}
