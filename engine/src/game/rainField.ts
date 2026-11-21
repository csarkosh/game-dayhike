/**
 * The rain's streaks and drips with no engine: the streak's sprite, the two
 * volumes' seeds, what a frame steps (the folded time, the wind's drift, the
 * smoothed frame, the canopy's water), how many of each are drawn, and the
 * uniforms each is drawn with, by name. `rainParams.ts` has the constants and
 * the placement's arithmetic; what draws the rain (`lite/rain.ts`) takes
 * every value from here.
 *
 * Renderer-only by design, as `rainParams.ts` is: nothing here may migrate
 * into sim/ or a tunables registry.
 */
import type { AtmosphereRecord } from "./atmosphereParams.js";
import { clamp01, type Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import {
  DRIP, DRIP_TIERS, RAIN_BOX, RAIN_CLASSES, RAIN_LAMP_GAIN, RAIN_MAP, RAIN_MILK, RAIN_SLANT, RAIN_TIERS, dripCountUnder, rainBoxMin, rainCountUnder,
  rainDrift, rainFold, rainSeeds, smoothedDt,
} from "./rainParams.js";
import { canopyWaterStep, type WeatherParams } from "./weather.js";
import type { WindRecord } from "./windParams.js";

export const RAIN_TEX_W = 4;
export const RAIN_TEX_H = 16;

/** A thin vertical streak: white, alpha peaking mid-column and fading at the ends. */
export function rainStreakMap(): Uint8Array {
  const data = new Uint8Array(RAIN_TEX_W * RAIN_TEX_H * 4);
  for (let y = 0; y < RAIN_TEX_H; y++) {
    const t = (y + 0.5) / RAIN_TEX_H;
    const vertical = Math.sin(Math.PI * t); // 0 at the ends, 1 in the middle
    for (let x = 0; x < RAIN_TEX_W; x++) {
      const nx = ((x + 0.5) / RAIN_TEX_W) * 2 - 1;
      const across = 1 - nx * nx;
      const i = (y * RAIN_TEX_W + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(200 * vertical * across);
    }
  }
  return data;
}

/** The seed buffers' hash seeds: the streaks' and the drips' layouts are the
 * same on every load, and not each other's. */
export const RAIN_SEED = 0x5261696e;
export const DRIP_SEED = 0x44726970;

/** The local headlamp as the streaks read it: its world position, its
 * direction, its intensity (0 when off), its cone angle in radians and its
 * colour. */
export type RainLamp = {
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  intensity: number;
  angle: number;
  r: number; g: number; b: number;
};

/** The rain's colour over a fog colour: lifted by RAIN_MILK, each channel held to [0, 1]. Fills and returns `out`. */
export function rainMilk(fog: Rgb, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = clamp01(fog.r * RAIN_MILK.gain + RAIN_MILK.lift);
  out[1] = clamp01(fog.g * RAIN_MILK.gain + RAIN_MILK.lift);
  out[2] = clamp01(fog.b * RAIN_MILK.gain + RAIN_MILK.lift);
  return out;
}

/**
 * What one volume's stage reads, by the names the streak plugin declares
 * (`lite/rain.ts`): the box's low corner and size, the wind's folded drift
 * and the folded time, the smoothed frame, the wind's horizontal velocity,
 * the eye, the headlamp (its place, its direction, its intensity as alpha
 * with the cosine of its half-angle, its colour), the classes' lanes, the
 * cover map's centre and extent, and the canopy's water.
 */
export type RainUniforms = {
  rainBoxMin: [number, number, number];
  rainBoxSize: [number, number, number];
  rainDrift: [number, number];
  rainFold: [number];
  rainDt: [number];
  rainWind: [number, number];
  rainCam: [number, number, number];
  rainLampPos: [number, number, number];
  rainLampDir: [number, number, number];
  rainLamp: [number, number];
  rainSpeeds: [number, number, number, number];
  rainWidths: [number, number, number, number];
  rainAlphas: [number, number, number, number];
  rainMapCentre: [number, number];
  rainMapExtent: [number];
  rainCanopyWater: [number];
  rainLampColour: [number, number, number];
};

/** A volume's record in a box of `box`: the classes' lanes and the map's extent set, the rest as a plugin starts. */
export function emptyRainUniforms(box: { x: number; y: number; z: number } = RAIN_BOX): RainUniforms {
  const lane = (of: (c: (typeof RAIN_CLASSES)[number]) => number): [number, number, number, number] =>
    [of(RAIN_CLASSES[0]!), of(RAIN_CLASSES[1]!), of(RAIN_CLASSES[2]!), of(RAIN_CLASSES[3]!)];
  return {
    rainBoxMin: [0, 0, 0],
    rainBoxSize: [box.x, box.y, box.z],
    rainDrift: [0, 0],
    rainFold: [0],
    rainDt: [1 / 60],
    rainWind: [0, 0],
    rainCam: [0, 0, 0],
    rainLampPos: [0, 0, 0],
    rainLampDir: [0, 0, 1],
    rainLamp: [0, 1],
    rainSpeeds: lane((c) => c.speed),
    rainWidths: lane((c) => c.width),
    rainAlphas: lane((c) => c.alpha),
    rainMapCentre: [0, 0],
    rainMapExtent: [RAIN_MAP.extent],
    rainCanopyWater: [0],
    rainLampColour: [1, 1, 1],
  };
}

/** The rain's volumes as a frame leaves them. */
export type RainField = {
  /** What the streaks' stage reads, filled by a `step` that draws anything. */
  readonly streaks: RainUniforms;
  /** The drips', in the shorter box; null on a tier that draws none. */
  readonly drips: RainUniforms | null;
  /** The two materials' colour: the fog colour lifted by RAIN_MILK. */
  readonly milk: readonly [number, number, number];
  /** Streaks drawn by the last step: the rain value's share of the tier's. */
  readonly drawn: number;
  /** Drips drawn by the last step: the canopy water's share of the tier's, none without a map to fall under. */
  readonly dripping: number;
  /** The canopy's water, 0 to 1, stepped by every `step` (`canopyWaterStep`, `weather.ts`). */
  readonly canopyWater: number;
  /**
   * One frame: the clocks step whether or not it rains, at most a second a
   * frame (a suspended tab resumes where it left off instead of lurching),
   * then the counts, and where either is above zero the colour and the two
   * records. `yaw` is the camera's (0 faces +Z), `dt` the frame's seconds,
   * `fog` the scene's fog colour, `map` the cover map's centre or null for
   * none. Returns whether anything is drawn; where nothing is, the records
   * stand as they were.
   */
  step(
    cam: { x: number; y: number; z: number }, yaw: number, w: WeatherParams, wind: WindRecord, dt: number, lamp: RainLamp, fog: Rgb,
    map: { readonly x: number; readonly z: number } | null,
  ): boolean;
};

/** The tier's rain: its streaks, and its drips where it draws any. */
export function createRainField(tier: QualityTier): RainField {
  const streaks = emptyRainUniforms();
  const drips = DRIP_TIERS[tier] > 0 ? emptyRainUniforms(DRIP.box) : null;
  const volumes = drips === null ? [streaks] : [streaks, drips];
  const milk: [number, number, number] = [1, 1, 1];
  let fold = 0;
  const drift = { x: 0, z: 0 };
  const boxMin = { x: 0, y: 0, z: 0 };
  let dtSmooth = 1 / 60;
  let canopyWater = 0;
  let drawn = 0;
  let dripping = 0;

  return {
    streaks,
    drips,
    milk,
    get drawn() {
      return drawn;
    },
    get dripping() {
      return dripping;
    },
    get canopyWater() {
      return canopyWater;
    },
    step(cam, yaw, w, wind, dt, lamp, fog, map) {
      const step = Math.min(1, Math.max(0, dt));
      fold = rainFold(fold + step);
      rainDrift(drift, wind, step, drift);
      dtSmooth = smoothedDt(dtSmooth, step);
      canopyWater = canopyWaterStep(canopyWater, w.rain, step);
      drawn = rainCountUnder(w.rain, tier);
      // The drips outlast the rain, and need the map to fall under.
      dripping = map === null || drips === null ? 0 : dripCountUnder(canopyWater, tier);
      if (drawn === 0 && dripping === 0) return false;

      rainMilk(fog, milk);
      const slant = RAIN_SLANT * wind.speed;
      for (const u of volumes) {
        rainBoxMin(cam, yaw, boxMin, u === streaks ? undefined : DRIP.box);
        u.rainBoxMin[0] = boxMin.x;
        u.rainBoxMin[1] = boxMin.y;
        u.rainBoxMin[2] = boxMin.z;
        u.rainDrift[0] = drift.x;
        u.rainDrift[1] = drift.z;
        u.rainFold[0] = fold;
        u.rainDt[0] = dtSmooth;
        u.rainWind[0] = wind.dirX * slant;
        u.rainWind[1] = wind.dirZ * slant;
        u.rainCam[0] = cam.x;
        u.rainCam[1] = cam.y;
        u.rainCam[2] = cam.z;
        u.rainLampPos[0] = lamp.x;
        u.rainLampPos[1] = lamp.y;
        u.rainLampPos[2] = lamp.z;
        u.rainLampDir[0] = lamp.dx;
        u.rainLampDir[1] = lamp.dy;
        u.rainLampDir[2] = lamp.dz;
        u.rainLamp[0] = lamp.intensity * RAIN_LAMP_GAIN;
        u.rainLamp[1] = Math.cos(lamp.angle / 2);
        u.rainLampColour[0] = lamp.r;
        u.rainLampColour[1] = lamp.g;
        u.rainLampColour[2] = lamp.b;
        u.rainCanopyWater[0] = canopyWater;
        if (map !== null) {
          u.rainMapCentre[0] = map.x;
          u.rainMapCentre[1] = map.z;
        }
      }
      return true;
    },
  };
}

/** Floats an instance of the rain's one mesh is: a matrix's sixteen, which carry the drop and no matrix. */
export const RAIN_INSTANCE_FLOATS = 16;

/**
 * Both volumes as the instances of one mesh, for a renderer that draws them
 * in one draw: the drips first, then the streaks, the order the game blends
 * them in (the drips, then the streaks, nearest last). An instance's sixteen
 * floats are the drop: its seed (xyz in the unit cube) and its class, as
 * `rainSeeds` makes them for its volume; then 1 for a drip and 0 for a
 * streak, and for a drip the share of the tier's drips before it and itself,
 * so a stage shows the first `n` of them by one comparison.
 */
export function rainInstances(tier: QualityTier): { data: Float32Array; drips: number; streaks: number } {
  const drips = DRIP_TIERS[tier];
  const streaks = RAIN_TIERS[tier];
  const data = new Float32Array((drips + streaks) * RAIN_INSTANCE_FLOATS);
  const dripSeeds = rainSeeds(drips, DRIP_SEED);
  const streakSeeds = rainSeeds(streaks, RAIN_SEED);
  for (let i = 0; i < drips; i++) {
    const at = i * RAIN_INSTANCE_FLOATS;
    data.set(dripSeeds.subarray(i * 4, i * 4 + 4), at);
    data[at + 4] = 1;
    data[at + 5] = (i + 0.5) / drips;
  }
  for (let i = 0; i < streaks; i++) data.set(streakSeeds.subarray(i * 4, i * 4 + 4), (drips + i) * RAIN_INSTANCE_FLOATS);
  return { data, drips, streaks };
}

/**
 * How many of `rainInstances`' a frame draws: every drip's place and the
 * streaks shown while a streak is, the drips shown alone while none is. So
 * a frame with streaks hands the stage the drips it does not show, which
 * the stage puts out of sight by `rainDripShown`.
 */
export function rainInstancesDrawn(field: RainField, drips: number): number {
  return field.drawn > 0 ? drips + field.drawn : field.dripping;
}

/**
 * What a stage that draws both volumes at once reads: the streaks' record,
 * the drips' box beside it (the one thing of theirs that differs), the share
 * of the tier's drips shown, and the material the game draws both with (its
 * colour, the scene's distance fog and the display curve of the material
 * colour path).
 */
export type RainStageUniforms = RainUniforms & {
  dripBoxMin: [number, number, number];
  dripBoxSize: [number, number, number];
  rainDripShown: [number];
  rainEmissive: [number, number, number];
  rainFogColour: [number, number, number];
  rainFogDensity: [number];
  rainExposure: [number];
  rainContrast: [number];
};

/** A record of the right shape for `rainStageUniforms` to fill. */
export function emptyRainStageUniforms(): RainStageUniforms {
  return {
    ...emptyRainUniforms(),
    dripBoxMin: [0, 0, 0],
    dripBoxSize: [DRIP.box.x, DRIP.box.y, DRIP.box.z],
    rainDripShown: [0],
    rainEmissive: [0, 0, 0],
    rainFogColour: [0, 0, 0],
    rainFogDensity: [0],
    rainExposure: [0],
    rainContrast: [0],
  };
}

/**
 * The one stage's uniforms for `field` as its last step left it, of whose
 * tier's `drips` it shows `field.dripping`, fogged by `air` (the scene's
 * fog: its colour the gradient's far end, its density the air's). Fills and
 * returns `out`.
 */
export function rainStageUniforms(
  field: RainField, drips: number, air: AtmosphereRecord, exposure: number, contrast: number, out: RainStageUniforms = emptyRainStageUniforms(),
): RainStageUniforms {
  const from = field.streaks as Record<string, number[]>;
  const to = out as Record<string, number[]>;
  for (const name in from) {
    const value = from[name] as number[];
    const target = to[name] as number[];
    for (let i = 0; i < value.length; i++) target[i] = value[i] as number;
  }
  if (field.drips !== null) {
    out.dripBoxMin[0] = field.drips.rainBoxMin[0];
    out.dripBoxMin[1] = field.drips.rainBoxMin[1];
    out.dripBoxMin[2] = field.drips.rainBoxMin[2];
  }
  out.rainDripShown[0] = drips > 0 ? field.dripping / drips : 0;
  out.rainEmissive[0] = field.milk[0];
  out.rainEmissive[1] = field.milk[1];
  out.rainEmissive[2] = field.milk[2];
  out.rainFogColour[0] = air.farColour.r;
  out.rainFogColour[1] = air.farColour.g;
  out.rainFogColour[2] = air.farColour.b;
  out.rainFogDensity[0] = air.baseDensity;
  out.rainExposure[0] = exposure;
  out.rainContrast[0] = contrast;
  return out;
}
