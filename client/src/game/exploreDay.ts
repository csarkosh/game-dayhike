/**
 * The explore mode's day (`gameMode.ts`): a clock that runs through the
 * daylight hours and round again, and a weather that turns with the hour
 * through every preset but the eerie one, so a hike with nothing to dread
 * still meets the whole of the weather and never the dark. Babylon-free.
 *
 * The clock runs from `EXPLORE_DAWN` to `EXPLORE_DUSK` at `EXPLORE_HOUR_S`
 * real seconds an hour and wraps to dawn at dusk: a full turn of the weather
 * in under half an hour of play. `/time` sets where it starts. The weather is
 * read off `EXPLORE_SCHEDULE`, a preset at each of its hours and the lerp
 * between neighbours in between, so a rain comes in over an hour and goes
 * out over the next; the name the lake's calm reads is the nearer preset's.
 */
import { lerpWeather, WEATHER_PRESETS, type WeatherParams, type WeatherPresetName } from "./weather.js";

export const EXPLORE_DAWN = 6;
export const EXPLORE_DUSK = 20;
/** Real seconds an hour of the explore day takes: two minutes. */
export const EXPLORE_HOUR_S = 120;

/** The weather at each hour of the day, dawn to dusk; between two, the lerp. */
export const EXPLORE_SCHEDULE: readonly { hour: number; weather: WeatherPresetName }[] = Object.freeze([
  { hour: 6, weather: "clear" },
  { hour: 8, weather: "bright" },
  { hour: 10, weather: "overcast" },
  { hour: 12, weather: "mist" },
  { hour: 14, weather: "rain" },
  { hour: 16, weather: "overcast" },
  { hour: 18, weather: "bright" },
  { hour: 20, weather: "clear" },
]);

/** The day's hour `elapsedS` seconds after a start at `startHour`: inside the daylight hours, wrapping at dusk. */
export function exploreHour(startHour: number, elapsedS: number): number {
  const span = EXPLORE_DUSK - EXPLORE_DAWN;
  const start = startHour >= EXPLORE_DAWN && startHour < EXPLORE_DUSK ? startHour : EXPLORE_DAWN;
  const turned = (start - EXPLORE_DAWN + Math.max(0, elapsedS) / EXPLORE_HOUR_S) % span;
  return EXPLORE_DAWN + turned;
}

/** The weather at `hour` off the schedule, and the preset it is nearer. */
export function exploreWeather(hour: number): { name: WeatherPresetName; weather: WeatherParams } {
  const h = Math.min(EXPLORE_DUSK, Math.max(EXPLORE_DAWN, hour));
  let i = 0;
  while (i + 1 < EXPLORE_SCHEDULE.length - 1 && (EXPLORE_SCHEDULE[i + 1] as { hour: number }).hour <= h) i += 1;
  const from = EXPLORE_SCHEDULE[i] as { hour: number; weather: WeatherPresetName };
  const to = EXPLORE_SCHEDULE[i + 1] as { hour: number; weather: WeatherPresetName };
  const t = Math.min(1, Math.max(0, (h - from.hour) / (to.hour - from.hour)));
  return {
    name: t < 0.5 ? from.weather : to.weather,
    weather: lerpWeather(WEATHER_PRESETS[from.weather], WEATHER_PRESETS[to.weather], t),
  };
}
