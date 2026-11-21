/**
 * The hour and the weather a renderer is set to, and what they light the
 * world with: the sky's state for them (`skyStateFor`), the scene's lights
 * (`sceneLightsUnder`), the air (`atmosphereUnder`) and the frame's exposure
 * (`exposureUnder`). It keeps the weather's fade, which a renderer steps a
 * frame at a time, and waits for the sky's table: until the table holds the
 * slices the hour needs there is no state, and the slice that completes them
 * makes it.
 *
 * Nothing here draws: a renderer reads `version` to know its lights and its
 * air are to be written again. Loads no engine.
 */
import { atmosphereUnder, type AtmosphereRecord } from "../atmosphereParams.js";
import { sunPositionAt } from "@csarkosh/engine/game/sky";
import { sceneLightsUnder, sunTravel, type SceneLights } from "@csarkosh/engine/game/sceneLights";
import { skyStateFor, type SkyState } from "@csarkosh/engine/game/skyState";
import type { SkyTable } from "@csarkosh/engine/game/skyTable";
import { DEFAULT_HOUR, skyHeld } from "@csarkosh/engine/game/skyWait";
import { DEFAULT_WEATHER, WEATHER_PRESETS, exposureUnder, weatherFadeAt, type WeatherParams } from "@csarkosh/engine/game/weather";

export type WorldLight = {
  readonly hour: number;
  /** A copy of the weather now, mid-fade where one runs. */
  readonly weather: WeatherParams;
  /** The sky's state of the last apply that found its slices: a new object
   * each apply. Null until the table first holds them. */
  readonly sky: SkyState | null;
  /** The lights and the air for that state; null with it. */
  readonly lights: SceneLights | null;
  readonly air: AtmosphereRecord | null;
  /** The way the sun's light travels: the lights' own at an apply, then the
   * hour's as `followHour` moves it between two. One vector, live. */
  readonly sunTravel: { readonly x: number; readonly y: number; readonly z: number };
  /** The weather's and the hour's exposure, known with or without the sky. */
  readonly exposure: number;
  /** Counts the applies and the followed hours: what is drawn from the
   * state is written again when it has moved. */
  readonly version: number;
  setHour(hour: number): void;
  /** The sun's direction alone at `hour`, between two applies, so its light
   * moves with the hour every frame; nothing while the sky is waited for. */
  followHour(hour: number): void;
  /** A fade from the weather now to `next` over `fadeSeconds` (3 absent); at
   * once at 0 or less. */
  setWeather(next: WeatherParams, fadeSeconds?: number): void;
  /** The hour and the weather together, the weather at once, applied once. */
  setView(hour: number, weather: WeatherParams): void;
  /** A frame of `seconds` of the weather's fade, where one runs. */
  step(seconds: number): void;
  /** Stops listening to the table, which outlives this. */
  dispose(): void;
};

export function createWorldLight(table: SkyTable, viewDistance: number): WorldLight {
  let hour = DEFAULT_HOUR;
  let weather: WeatherParams = { ...WEATHER_PRESETS[DEFAULT_WEATHER] };
  let fadeFrom: WeatherParams | null = null;
  let fadeTarget: WeatherParams = weather;
  let fadeDuration = 0;
  let fadeElapsed = 0;
  let sky: SkyState | null = null;
  let lights: SceneLights | null = null;
  let air: AtmosphereRecord | null = null;
  /** The last apply found the table without its slices: the next slice to arrive applies again. */
  let waiting = true;
  let exposure = 1;
  let version = 0;
  const travel = { x: 0, y: -1, z: 0 };

  function apply(): void {
    version++;
    exposure = exposureUnder(weather, sunPositionAt(hour).y);
    waiting = !skyHeld(table, hour);
    if (waiting) return;
    sky = skyStateFor(table, hour, weather);
    lights = sceneLightsUnder(weather, sky);
    air = atmosphereUnder(weather, sky, viewDistance);
    travel.x = lights.sun.direction.x;
    travel.y = lights.sun.direction.y;
    travel.z = lights.sun.direction.z;
  }

  const offTable = table.onChange(() => {
    if (waiting) apply();
  });
  apply();

  return {
    get hour() {
      return hour;
    },
    get weather() {
      return { ...weather };
    },
    get sky() {
      return sky;
    },
    get lights() {
      return lights;
    },
    get air() {
      return air;
    },
    sunTravel: travel,
    get exposure() {
      return exposure;
    },
    get version() {
      return version;
    },
    setHour(next) {
      hour = next;
      apply();
    },
    followHour(next) {
      hour = next;
      if (waiting) return;
      sunTravel(sunPositionAt(next), travel);
      version++;
    },
    setWeather(next, fadeSeconds = 3) {
      if (fadeSeconds <= 0) {
        weather = { ...next };
        fadeFrom = null;
        apply();
        return;
      }
      fadeFrom = { ...weather };
      fadeTarget = { ...next };
      fadeDuration = fadeSeconds;
      fadeElapsed = 0;
    },
    setView(nextHour, next) {
      hour = nextHour;
      weather = { ...next };
      fadeFrom = null;
      apply();
    },
    step(seconds) {
      if (fadeFrom === null) return;
      fadeElapsed += seconds;
      weather = weatherFadeAt(fadeFrom, fadeTarget, fadeElapsed, fadeDuration);
      if (fadeElapsed >= fadeDuration) fadeFrom = null;
      apply();
    },
    dispose() {
      offTable();
    },
  };
}
