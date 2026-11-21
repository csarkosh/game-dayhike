/**
 * A lake's calm for a frame: how much of it is glass, how rough it is, how
 * much the cat's-paws cover and how far a paw smears the shore's image, from
 * the hour, the weather's preset (through a fade from one preset to the
 * next), the weather itself, the wind and the lake's shelter (`lakeCalm.ts`
 * has the rules). Whoever draws a lake asks this once a lake a frame and
 * hands the answer to the lake's material.
 *
 * Loads no engine.
 */
import { SLOPE_PAW_DEG, calmShare, isRough, roughShare, smearPx } from "./lakeCalm.js";
import { DEFAULT_WEATHER, type WeatherParams, type WeatherPresetName } from "./weather.js";

/** The lake's surface as its calm leaves it this frame (`lakeCalmUnder`). */
export type LakeCalmFrame = {
  /** The glass's share of the lake, 0 to 1: the calm share at the hour,
   * faded from one preset's to the next's, times what the rough leaves. */
  share: number;
  /** Past the rough's steps (`isRough`): rain, or a strong wind on an exposed lake. */
  rough: boolean;
  /** How rough the whole surface is, 0 to 1 (`roughShare`): the steps eased into ramps. */
  roughShare: number;
  /** How much of the lake the cat's-paws cover, 0 to 1: eased to 1 as it turns rough. */
  cover: number;
  /** The vertical smear (px) of the shore's image inside a full paw, for the frame's height and lens: the shader scales it by the paw mask. */
  smearPx: number;
};

/** The shelter at which the cat's-paws cover everything the glass leaves:
 * the clear high lake's (`lakeWaterRow` at murk 0). A sheltered lake's
 * cover is scaled down by its own shelter over this. */
export const PAW_COVER_SHELTER = 0.3;

/**
 * The glass's share at `hour` faded from `from` to the preset `to` by `t` (0
 * to 1, a weather fade's progress; exact at the ends, as `lerpWeather` is,
 * and a progress that is not a number is the start): `from` is a preset, or
 * the share a fade began at when it took over from another mid-way.
 */
export function fadedCalmShare(hour: number, from: WeatherPresetName | number, to: WeatherPresetName, t: number): number {
  const k = t > 0 ? Math.min(1, t) : 0;
  const a = typeof from === "number" ? from : calmShare(hour, from);
  const b = calmShare(hour, to);
  return k === 1 ? b : a + (b - a) * k;
}

/**
 * The lake's calm this frame into `out` (one record, refilled): the calm
 * share at `hour` faded from `from` (a preset, or the share a fade began at)
 * to the preset `to` by `t` (`fadedCalmShare`), the surface rough under `weather` and
 * the wind's 0..1 speed on a lake of `shelter`, the paws' cover
 * `(1 − share) · shelter / PAW_COVER_SHELTER`, and the smear of a paw's
 * slope for a frame `frameHeightPx` tall seen through `fov` (vertical,
 * radians). As the surface turns rough (`roughShare`, r) the share is
 * scaled by 1 − r and the cover eased to 1 by r: rough all over, the share
 * is 0 and the paws cover the lake.
 */
export function lakeCalmUnder(
  hour: number,
  from: WeatherPresetName | number,
  to: WeatherPresetName,
  t: number,
  weather: WeatherParams,
  wind01: number,
  shelter: number,
  frameHeightPx: number,
  fov: number,
  out: LakeCalmFrame,
): LakeCalmFrame {
  const share = fadedCalmShare(hour, from, to, t);
  const r = roughShare(weather, wind01, shelter);
  const cover = Math.min(1, Math.max(0, ((1 - share) * shelter) / PAW_COVER_SHELTER));
  out.rough = isRough(weather, wind01, shelter);
  out.roughShare = r;
  out.share = share * (1 - r);
  out.cover = cover + (1 - cover) * r;
  out.smearPx = smearPx(SLOPE_PAW_DEG, frameHeightPx, fov);
  return out;
}

/**
 * The weather's preset as the lakes' calm follows it: the preset the calm
 * fades from (or the share a fade took over at), the one it fades to, and
 * how far the fade has come.
 */
export type CalmFade = {
  /** What the calm fades from: a preset, or the share a fade began at when it took over from another mid-way. */
  readonly from: WeatherPresetName | number;
  /** The preset the calm fades to. */
  readonly to: WeatherPresetName;
  /** The fade's progress, 0 to 1: 1 while none runs. */
  readonly progress: number;
  /**
   * The weather is now `name`, over `fadeSeconds`: at once where that is 0
   * or less. A fade taken over mid-way starts from the share it had reached
   * at `hour`.
   */
  name(name: WeatherPresetName, fadeSeconds: number, hour: number): void;
  /** A frame of `dt` seconds: a fade that has run its length is over. */
  step(dt: number): void;
};

/** The calm's fade, standing at the default weather with no fade running. */
export function createCalmFade(): CalmFade {
  let from: WeatherPresetName | number = DEFAULT_WEATHER;
  let to: WeatherPresetName = DEFAULT_WEATHER;
  let fadeS = 0;
  let elapsedS = 0;
  return {
    get from() {
      return from;
    },
    get to() {
      return to;
    },
    get progress() {
      return fadeS > 0 ? elapsedS / fadeS : 1;
    },
    name(name, fadeSeconds, hour) {
      if (fadeSeconds <= 0) {
        from = name;
        to = name;
        fadeS = 0;
        elapsedS = 0;
        return;
      }
      from = fadeS > 0 ? fadedCalmShare(hour, from, to, elapsedS / fadeS) : to;
      to = name;
      fadeS = fadeSeconds;
      elapsedS = 0;
    },
    step(dt) {
      if (fadeS <= 0) return;
      elapsedS += dt;
      if (elapsedS >= fadeS) {
        from = to;
        fadeS = 0;
      }
    },
  };
}
