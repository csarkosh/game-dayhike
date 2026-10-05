import { clamp01 } from "./colour.js";
import type { WeatherParams } from "./weather.js";

/**
 * When the lake's life is out, Babylon-free: the midges at dawn and dusk, the
 * dragonflies by day, the chorus frogs at night, each switched off by the
 * weather, the wind and the dread as the field studies find them, and the
 * summer air's temperature through the day, which the swarms' hum follows.
 *
 * Hours run 0–24 with the sun up from 06:00 to 18:00. Every edge is a
 * smoothstep over its span, so no share jumps as the clock runs; `waterLife.ts`
 * eases what this returns over 3 s, as the animals' presence is eased, so a
 * jump of the clock or the weather does not jump either.
 */

/** The wind's speed (0–1) read as m/s: 1 is this many. Clear weather blows
 * near 2 m/s, overcast near 5. */
export const WATER_LIFE_WIND_MPS = 8;
/** The dread's quieting, the ground animals' curve: k = clamp01((dread − FROM) / SPAN),
 * so the lake is silent by the middle of the dread. */
export const DREAD_QUIET_FROM = 0.3;
export const DREAD_QUIET_SPAN = 0.2;

/** `seen`: the share of a kind's units drawn at all; `flying`: the share of
 * those aloft, the rest perched. */
export type DragonflyShare = { seen: number; flying: number };
export type WaterLifePresence = {
  /** 0–1: swarms present. */
  midge: number;
  /** 1–1.3: mist fills the swarms up to 30 % fuller. */
  midgeFullness: number;
  darner: DragonflyShare;
  skimmer: DragonflyShare;
  damselfly: DragonflyShare;
  /** 0–1: the chorus present, before the players' and the Hollow's silences. */
  frog: number;
};

/** The midges' dawn: up 05:15→05:45, down 06:30→07:00. */
const MIDGE_DAWN_UP0 = 5.25, MIDGE_DAWN_UP1 = 5.75, MIDGE_DAWN_DOWN0 = 6.5, MIDGE_DAWN_DOWN1 = 7;
/** The midges' dusk, fullest just after sunset: up 17:45→18:15, down 19:15→19:45. */
const MIDGE_DUSK_UP0 = 17.75, MIDGE_DUSK_UP1 = 18.25, MIDGE_DUSK_DOWN0 = 19.25, MIDGE_DUSK_DOWN1 = 19.75;
/** Wind: swarms full to 0.5 (4 m/s), gone by 0.75 (6 m/s), where the field
 * studies' swarms break up. */
const MIDGE_WIND_FROM = 0.5, MIDGE_WIND_GONE = 0.75;
/** Rain: swarms gone by 0.3. */
const MIDGE_RAIN_GONE = 0.3;
/** Mist fills a swarm by this share at mist 1. */
const MIDGE_MIST_FILL = 0.3;
/** The dragonflies' day: up 08:00→09:00, down 17:00→18:00. */
const DAY_UP0 = 8, DAY_UP1 = 9, DAY_DOWN0 = 17, DAY_DOWN1 = 18;
/** Darners fly into dusk: down to a third by 18:00, holding it to 18:30, gone by 19:00. */
const DARNER_DUSK_SHARE = 1 / 3;
const DARNER_DUSK0 = 18.5, DARNER_DUSK1 = 19;
/** Sun: full below cloud 0.4, none by 0.7. */
const SUN_CLOUD0 = 0.4, SUN_CLOUD1 = 0.7;
/** Rain: no dragonfly flies above 0.05. */
const DRAGONFLY_RAIN_GONE = 0.05;
/** Wind: every dragonfly perched above 0.7 (5.6 m/s). */
const DRAGONFLY_WIND_FROM = 0.6, DRAGONFLY_WIND_GONE = 0.7;
/** The frogs, silent before 19:30: 0.6 of the chorus up over 19:30→20:00 and
 * the rest up with it to 1 by 21:00, full to midnight, back to 0.6 over
 * 00:00→00:30, holding it to 04:30, gone by 05:00. */
const FROG_DUSK0 = 19.5, FROG_DUSK1 = 20;
const FROG_SWELL0 = 19.5, FROG_SWELL1 = 21;
const FROG_EASE0 = 0, FROG_EASE1 = 0.5;
const FROG_DAWN0 = 4.5, FROG_DAWN1 = 5;
const FROG_LATE_SHARE = 0.6;

/** The summer air: 16 °C mean, a 5 °C swing peaking at 15:00 (11 °C in the
 * small hours, 21 °C mid-afternoon), the swing halved under full cloud, 3 °C
 * cooler in full rain. */
const TEMP_MEAN = 16;
const TEMP_SWING = 5;
const TEMP_PEAK_HOUR = 15;
const TEMP_CLOUD_DAMP = 0.5;
const TEMP_RAIN_COOL = 3;
/** The hum: *Chironomus* males near 230 Hz at 15 °C, 10 Hz higher per °C. */
const HUM_PITCH_AT_15 = 230;
const HUM_PITCH_PER_DEGREE = 10;
const HUM_PITCH_MIN = 180;
const HUM_PITCH_MAX = 330;

/** Hermite step between two edges. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 0 before `up0`, 1 from `up1` to `down0`, 0 after `down1`. */
function between(h: number, up0: number, up1: number, down0: number, down1: number): number {
  return smoothstep(up0, up1, h) * (1 - smoothstep(down0, down1, h));
}

export function dreadQuiet(dread: number): number {
  return clamp01((dread - DREAD_QUIET_FROM) / DREAD_QUIET_SPAN);
}

function frogHours(h: number): number {
  if (h >= 12) {
    return FROG_LATE_SHARE * smoothstep(FROG_DUSK0, FROG_DUSK1, h) +
      (1 - FROG_LATE_SHARE) * smoothstep(FROG_SWELL0, FROG_SWELL1, h);
  }
  const late = FROG_LATE_SHARE + (1 - FROG_LATE_SHARE) * (1 - smoothstep(FROG_EASE0, FROG_EASE1, h));
  return late * (1 - smoothstep(FROG_DAWN0, FROG_DAWN1, h));
}

/**
 * Every share of the lake's life at `hour` under `w`, with the wind's speed
 * `windSpeed` (0–1). Written into `out` when one is passed, so a caller that
 * runs this every frame allocates nothing; a fresh record otherwise.
 */
export function waterLifePresenceUnder(
  w: WeatherParams,
  hour: number,
  windSpeed: number,
  out: WaterLifePresence = {
    midge: 0, midgeFullness: 1,
    darner: { seen: 0, flying: 0 }, skimmer: { seen: 0, flying: 0 }, damselfly: { seen: 0, flying: 0 },
    frog: 0,
  },
): WaterLifePresence {
  const h = ((hour % 24) + 24) % 24;
  const quiet = 1 - dreadQuiet(w.dread);
  const rain = clamp01(w.rain);

  const midgeHours = between(h, MIDGE_DAWN_UP0, MIDGE_DAWN_UP1, MIDGE_DAWN_DOWN0, MIDGE_DAWN_DOWN1) +
    between(h, MIDGE_DUSK_UP0, MIDGE_DUSK_UP1, MIDGE_DUSK_DOWN0, MIDGE_DUSK_DOWN1);
  const midgeWind = 1 - smoothstep(MIDGE_WIND_FROM, MIDGE_WIND_GONE, windSpeed);
  const midgeRain = 1 - smoothstep(0, MIDGE_RAIN_GONE, rain);
  out.midge = midgeHours * midgeWind * midgeRain * quiet;
  out.midgeFullness = 1 + MIDGE_MIST_FILL * clamp01(w.mist);

  const day = between(h, DAY_UP0, DAY_UP1, DAY_DOWN0, DAY_DOWN1);
  // Down to a third over 17:00→18:00, then the third down over 18:30→19:00:
  // a blend, never a difference, so it lands on 0 exactly rather than below.
  const dusk = smoothstep(DAY_DOWN0, DAY_DOWN1, h);
  const darnerDay = smoothstep(DAY_UP0, DAY_UP1, h) *
    (1 - dusk + dusk * DARNER_DUSK_SHARE * (1 - smoothstep(DARNER_DUSK0, DARNER_DUSK1, h)));
  const sun = 1 - smoothstep(SUN_CLOUD0, SUN_CLOUD1, clamp01(w.cloudCover));
  const dry = 1 - smoothstep(0, DRAGONFLY_RAIN_GONE, rain);
  const calm = 1 - smoothstep(DRAGONFLY_WIND_FROM, DRAGONFLY_WIND_GONE, windSpeed);
  const flying = sun * calm * quiet;
  out.darner.seen = darnerDay * sun * dry * quiet;
  out.darner.flying = flying;
  // A skimmer under cloud stays on its perch, and is seen there.
  out.skimmer.seen = day * dry * quiet;
  out.skimmer.flying = flying;
  out.damselfly.seen = day * sun * dry * quiet;
  out.damselfly.flying = flying;

  // The wind's bed masks the chorus, and the frogs call on in rain and mist.
  out.frog = frogHours(h) * quiet;
  return out;
}

/** The summer air's temperature (°C) at `hour` under `w`. */
export function summerTemperature(hour: number, w: WeatherParams): number {
  const swing = TEMP_SWING * (1 - TEMP_CLOUD_DAMP * clamp01(w.cloudCover));
  return TEMP_MEAN + swing * Math.cos((2 * Math.PI * (hour - TEMP_PEAK_HOUR)) / 24) - TEMP_RAIN_COOL * clamp01(w.rain);
}

/** The swarms' hum (Hz) at `tempC`. */
export function midgeHumPitch(tempC: number): number {
  const pitch = HUM_PITCH_AT_15 + HUM_PITCH_PER_DEGREE * (tempC - 15);
  return Math.min(HUM_PITCH_MAX, Math.max(HUM_PITCH_MIN, pitch));
}
