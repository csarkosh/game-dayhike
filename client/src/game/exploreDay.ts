/**
 * The explore mode's day (`gameMode.ts`): a clock round the whole day and a
 * weather that turns with the hour through every preset but the eerie one,
 * so a hike with nothing to dread still meets the whole of the weather, its
 * nights and its mists among them, and never the dread. Babylon-free.
 *
 * The clock runs round the twenty-four hours at `EXPLORE_HOUR_S` real seconds
 * an hour: a day in sixteen minutes, and the weather turning every minute or
 * two of play. `/time` sets where it starts. The weather is read off
 * `EXPLORE_SCHEDULE`, a preset at each of its hours and the lerp between
 * neighbours in between, so a rain comes in over an hour and a half and goes
 * out over the next, twice a day; the name the lake's calm reads is the
 * nearer preset's. The night's dark is the sky's own, not the dread's.
 */
import { lerpWeather, WEATHER_PRESETS, type WeatherParams, type WeatherPresetName } from "./weather.js";

/** Real seconds an hour of the explore day takes: forty, a day in sixteen minutes. */
export const EXPLORE_HOUR_S = 40;

/** The weather at each hour of the day, midnight to midnight; between two, the lerp. The last
 * entry is the first again, so the turn past midnight is seamless. */
export const EXPLORE_SCHEDULE: readonly { hour: number; weather: WeatherPresetName }[] = Object.freeze([
  { hour: 0, weather: "overcast" },
  { hour: 2, weather: "clear" },
  { hour: 3.5, weather: "mist" },
  { hour: 5, weather: "clear" },
  { hour: 6.5, weather: "bright" },
  { hour: 8, weather: "overcast" },
  { hour: 9.5, weather: "rain" },
  { hour: 11, weather: "bright" },
  { hour: 12.5, weather: "clear" },
  { hour: 14, weather: "overcast" },
  { hour: 15.5, weather: "mist" },
  { hour: 17, weather: "rain" },
  { hour: 18.5, weather: "bright" },
  { hour: 20, weather: "clear" },
  { hour: 22, weather: "mist" },
  { hour: 24, weather: "overcast" },
]);

/** The day's hour `elapsedS` seconds after a start at `startHour`, round the clock. */
export function exploreHour(startHour: number, elapsedS: number): number {
  const start = ((startHour % 24) + 24) % 24;
  return (start + Math.max(0, elapsedS) / EXPLORE_HOUR_S) % 24;
}

/** How far into the night `hour` is for the birds' hush: none by day, in over the two hours to
 * ten at night and out over the two to six in the morning. The sky's own dark follows the hour. */
export function exploreNight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const t = h >= 20 ? (h - 20) / 2 : h < 4 ? 1 : 1 - (h - 4) / 2;
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** The weather at `hour` off the schedule, and the preset it is nearer. */
export function exploreWeather(hour: number): { name: WeatherPresetName; weather: WeatherParams } {
  const h = ((hour % 24) + 24) % 24;
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
