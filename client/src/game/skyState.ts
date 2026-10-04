/**
 * The sky's state at one hour under one weather: every light, colour and
 * weight that the dome, the image-based light, the sun, the fill, the fog and
 * the haze read, from one blended slice of the scattering table
 * (`skyTable.ts`). One state feeds them all, so the fog's far colour is the
 * dome's horizon and the haze's glow is the dome's own glow toward the sun:
 * they cannot disagree.
 *
 * Pure and Babylon-free; `lighting.ts`, `skyDome.ts` and `atmosphereParams.ts`
 * are the shells that apply it. `domeRadiance`, `skyTableUv` and
 * `deckRadiance` transcribe the dome's fragment stage
 * (`shaders/skyDome.fragment.fx`) step for step, and a lockstep test holds the
 * stage's constants to the ones here.
 */
import { clamp01, desaturateRgb, luma, mixRgb, type Rgb } from "./colour.js";
import { FILL_DAY, FILL_NIGHT, MOONLIGHT, NIGHT_SKY, SUN_PEAK, sunPositionAt, type Vec3 } from "./sky.js";
import { AMBIENT_DESAT, FILL_LIFT, SUN_CLOUD_LOSS, SUN_DESAT, airColourUnder, type WeatherParams } from "./weather.js";
import {
  RING_ELEVATION_DEG, SKY_EYE_KM, SKY_GROUND_KM, SLICE_AZIMUTHS, SLICE_ELEVATIONS, type SkySlice,
} from "./skyModel.js";
import { NOON_ALTITUDE_DEG, type SkyTable } from "./skyTable.js";

/** The zenith at clear noon of the sky the table replaced (Babylon's
 * SkyMaterial), linear Rec. 709 luma. The scale K puts the table's noon
 * zenith here, so noon keeps its look. */
export const SKY_NOON_ZENITH_LUMINANCE = 0.416;
/** The adaptation's exponent. Every light the sky gives is multiplied by
 * (Y / Y_noon)^(SKY_GAMMA - 1), so the scene's brightness goes as
 * (Y / Y_noon)^SKY_GAMMA: at 0.5, sunset reads about a quarter of noon. */
export const SKY_GAMMA = 0.5;
/** The floor on Y / Y_noon under the adaptation's power: below it the table
 * is black and the factor stops growing. */
export const SKY_Y_FLOOR = 1e-12;
/** Adapted light at and above which the night factor is exactly 0. */
export const NIGHT_YA_DAY = 0.1;
/** Adapted light at and below which the night factor is exactly 1. */
export const NIGHT_YA_NIGHT = 0.003;
/** The cloud deck's transmission: its zenith is DECK_TAU times the zenith an
 * overcast sky has over the clear sky's light on level ground. Set so the
 * dome's zenith at noon in mist (cloud 0.9) has a luma of 0.80, the noon mist
 * dome of the sky the table replaced. */
export const DECK_TAU = 0.1598;
/** Scale, in the sine of the elevation, of the mist's blend toward the fog
 * colour at the horizon. Mist is the one part of the air the table does not
 * hold, so with this blend the dome meets the fog without a band. */
export const MIST_HORIZON = 0.08;
/** The sun's angular radius, radians: 0.27 degrees. */
const SUN_RADIUS = (0.27 * Math.PI) / 180;
/** The cosine of the sun's angular radius: a direction this close to the sun
 * is on its disc. */
export const SUN_DISC_COS = Math.cos(SUN_RADIUS);
/** The radiance of a disc of that size whose irradiance is 1: one over its
 * solid angle. */
export const SUN_DISC_RADIANCE = 1 / (2 * Math.PI * (1 - SUN_DISC_COS));
/** The disc's cap per channel in the probe's capture, so a few texels of HDR
 * sun do not sparkle in rough reflections. */
export const SUN_DISC_CAPTURE_MAX = 1;
/** The image-based light's share relative to the dome's own radiance: 1 is
 * coherent with the dome. The checks by eye may lower it if noon's shadows
 * read brighter than they did, since the image-based light before the table
 * was the sky raised to 2.2 (a linear sky in a probe read as gamma). Lighting
 * sets the environment intensity to the dread's ambient collapse times this. */
export const SKY_IBL_SCALE = 1;
/** The disc's largest channel in the view, its hue kept. Its own radiance is
 * of the order of 10^5 in scene units by day, past half float's largest value
 * (65504): the scene's half-float target would hold infinity, and the post
 * chain's blurs would spread it. 16 is past white under either tone map at
 * every exposure the game uses. */
export const SUN_DISC_VIEW_MAX = 16;
/** The luma of the day sky colour the fill took before the table, (0.42,
 * 0.58, 0.82): the fill's day colour keeps it. */
export const FILL_DAY_LUMA = 0.5633;
/** The haze glow's power range. */
export const GLOW_POWER_MIN = 1;
export const GLOW_POWER_MAX = 64;
/** The horizon's luma toward the sun over its mean away from it, at and below
 * which there is no glow. */
export const GLOW_MIN_CONTRAST = 1.05;
/** The same ratio at and above which the glow has its full weight. */
export const GLOW_FULL_CONTRAST = 1.25;

export type SkyState = {
  hour: number;
  /** Radians: asin(sunPositionAt(hour).y). */
  altitude: number;
  /** sunPositionAt(hour). */
  sunDir: Vec3;
  /** K * A: the table's units to the scene's, adapted. */
  scale: number;
  /** A. */
  adaptation: number;
  /** n: 0 by day, 1 at night. */
  night: number;
  /** clamp01(cloudCover). */
  cloud: number;
  /** NIGHT_SKY times the night factor: the dome's floor, which stands in for
   * the moonlit night sky and appears as the twilight fades. Nothing by day,
   * so clear noon's zenith is the table's alone. */
  nightFloor: Rgb;
  /** The clear sky's slice at the sun's altitude, unscaled. */
  clear: SkySlice;
  /** The cloud deck's zenith, scene units. */
  deckZenith: Rgb;
  /** The fog colour and the clear colour: the air over the horizon away from the sun. */
  mistAir: Rgb;
  /** clamp01(mist): the weight of the dome's blend toward mistAir at the horizon. */
  mistWeight: number;
  /** The sun light's colour, luma 1, desaturated by cloud. */
  sunColour: Rgb;
  sunIntensity: number;
  /** The disc's radiance in the view, scene units. */
  discColour: Rgb;
  fillColour: Rgb;
  /** Before the dread's ambient collapse, which lighting applies. */
  fillIntensity: number;
  /** The dome's horizon away from the sun at RING_ELEVATION_DEG, scene units. */
  horizonAway: Rgb;
  /** The dome's horizon toward the sun at RING_ELEVATION_DEG, scene units. */
  horizonToward: Rgb;
  /** Unit and level: toward the sun's azimuth. */
  glowDir: Vec3;
  glowPower: number;
  glowWeight: number;
};

/** The overcast law's zenith luminance per unit of ground illuminance:
 * L_z = E / (7 pi / 9). */
const DECK_ZENITH_PER_LIGHT = 9 / (7 * Math.PI);
/** The first column of the ring's half away from the sun: past 90 degrees. */
const AWAY_FIRST = SLICE_AZIMUTHS / 2;
/** The last column the glow's fit reads, short of 90 degrees. */
const GLOW_LAST = AWAY_FIRST - 1;
const DEG = Math.PI / 180;
/** How far below level the eye's horizon lies, radians: a ray from SKY_EYE_KM
 * at this depression grazes the ground, and below it the sun's transmittance
 * is 0. */
const HORIZON_DIP = Math.acos(SKY_GROUND_KM / (SKY_GROUND_KM + SKY_EYE_KM));

function scaled(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

function added(a: Rgb, b: Rgb): Rgb {
  return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b };
}

/** Texel `i` of an RGB array. */
function texel(data: Float32Array, i: number): Rgb {
  return { r: data[i * 3] ?? 0, g: data[i * 3 + 1] ?? 0, b: data[i * 3 + 2] ?? 0 };
}

function smoothstep01(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}

/** K: the table's units to the scene's, so the noon zenith has the luma
 * SKY_NOON_ZENITH_LUMINANCE. */
export function skyScale(noon: SkySlice): number {
  return SKY_NOON_ZENITH_LUMINANCE / luma(noon.zenith);
}

/** The clear sky's light on level ground, sun and sky together, per unit of
 * solar irradiance. */
export function levelLight(s: SkySlice): Rgb {
  return added(scaled(s.sun, Math.max(Math.sin(s.altitudeDeg * DEG), 0)), s.skyIrradiance);
}

/** A: the factor every light the sky gives is multiplied by, standing in for
 * the eye adjusting. 1 at noon, growing as the light falls. */
export function adaptationFor(y: number, yNoon: number): number {
  return Math.pow(Math.max(y / yNoon, SKY_Y_FLOOR), SKY_GAMMA - 1);
}

/** n from the adapted light: exactly 0 at and above NIGHT_YA_DAY, exactly 1 at
 * and below NIGHT_YA_NIGHT, linear in the logarithm between. */
export function nightFactor(adapted: number): number {
  if (adapted >= NIGHT_YA_DAY) return 0;
  const day = Math.log10(NIGHT_YA_DAY);
  return clamp01((day - Math.log10(Math.max(adapted, 1e-12))) / (day - Math.log10(NIGHT_YA_NIGHT)));
}

/** The CIE overcast sky: brightest at the zenith, a third of it at the horizon. */
export function deckRadiance(zenith: Rgb, sinElevation: number): Rgb {
  return scaled(zenith, (1 + 2 * Math.max(sinElevation, 0)) / 3);
}

/** How much of the sun is still up: 1 until its centre is one disc diameter
 * above the horizon's dip, 0 at the dip, smooth between. The disc and the
 * light it casts fade out as it sets; on the transmittance alone they would
 * stay until the ray met the ground and then drop at once. */
export function sunUpFor(altitude: number): number {
  return smoothstep01((altitude + HORIZON_DIP) / (2 * SUN_RADIUS));
}

/**
 * The table texture's coordinates for direction `d`: the azimuth from the
 * sun's across (0 to 180 degrees, mirrored), the elevation's root mapping up,
 * each on texel centres. The elevation is clamped at the horizon: below it a
 * slice holds only the air's own scattered light, which is dim and grey,
 * where the dome has always shown the horizon's colour down to the ground.
 * The fragment stage's `skyTableUv`, transcribed.
 */
export function skyTableUv(d: Vec3, sunDir: Vec3): [number, number] {
  const hl = Math.hypot(d.x, d.z);
  const sl = Math.hypot(sunDir.x, sunDir.z);
  const c = hl > 1e-6 && sl > 1e-6 ? Math.min(1, Math.max(-1, (d.x * sunDir.x + d.z * sunDir.z) / (hl * sl))) : 1;
  const u = Math.acos(c) / Math.PI;
  const e = Math.asin(Math.min(1, Math.max(0, d.y)));
  const v = 0.5 + 0.5 * Math.sign(e) * Math.sqrt(Math.abs(e) / (0.5 * Math.PI));
  return [
    (u * (SLICE_AZIMUTHS - 1) + 0.5) / SLICE_AZIMUTHS,
    (v * (SLICE_ELEVATIONS - 1) + 0.5) / SLICE_ELEVATIONS,
  ];
}

/** The slice's texels read as the GPU reads them: bilinear between texel
 * centres, clamped at the edges. */
function bilinear(texels: Float32Array, u: number, v: number): Rgb {
  const x = Math.min(Math.max(u * SLICE_AZIMUTHS - 0.5, 0), SLICE_AZIMUTHS - 1);
  const y = Math.min(Math.max(v * SLICE_ELEVATIONS - 0.5, 0), SLICE_ELEVATIONS - 1);
  const x0 = Math.min(Math.floor(x), SLICE_AZIMUTHS - 2);
  const y0 = Math.min(Math.floor(y), SLICE_ELEVATIONS - 2);
  const row = (j: number): Rgb =>
    mixRgb(texel(texels, j * SLICE_AZIMUTHS + x0), texel(texels, j * SLICE_AZIMUTHS + x0 + 1), x - x0);
  return mixRgb(row(y0), row(y0 + 1), y - y0);
}

/**
 * The dome's colour in direction `d` (unit, y up) as the fragment stage
 * computes it: the clear table scaled, mixed toward the deck by the cloud, the
 * night floor (`nightFloor`) added, then the disc (capped in the probe's capture), then the
 * mist's blend toward the fog colour at the horizon. Linear: before the low
 * tier's tone map, which only the stage applies, and, with `capture`, the
 * radiance the probe's materials decode from what the stage writes
 * (`captureEncode`).
 */
export function domeRadiance(s: SkyState, d: Vec3, capture = false): Rgb {
  const [u, v] = skyTableUv(d, s.sunDir);
  let L = scaled(bilinear(s.clear.texels, u, v), s.scale);
  L = mixRgb(L, deckRadiance(s.deckZenith, d.y), s.cloud);
  L = added(L, s.nightFloor);
  if (d.x * s.sunDir.x + d.y * s.sunDir.y + d.z * s.sunDir.z >= SUN_DISC_COS) {
    const disc = s.discColour;
    L = added(L, capture
      ? {
        r: Math.min(disc.r, SUN_DISC_CAPTURE_MAX),
        g: Math.min(disc.g, SUN_DISC_CAPTURE_MAX),
        b: Math.min(disc.b, SUN_DISC_CAPTURE_MAX),
      }
      : disc);
  }
  const h = s.mistWeight * Math.exp(-Math.max(d.y, 0) / MIST_HORIZON);
  return mixRgb(L, s.mistAir, h);
}

/** What the stage writes in the probe's capture for a linear colour: each
 * channel raised to 1/2.2, the inverse of the 2.2 every material that reads
 * the gamma-flagged probe raises it to. */
export function captureEncode(c: Rgb): Rgb {
  const encode = (x: number): number => Math.pow(Math.max(x, 0), 1 / 2.2);
  return { r: encode(c.r), g: encode(c.g), b: encode(c.b) };
}

/**
 * The haze glow's power and weight, from the ring in scene units (column i at
 * azimuth pi i / (SLICE_AZIMUTHS - 1) from the sun's) and its mean away from
 * the sun.
 *
 * The weight is 0 until the horizon toward the sun is GLOW_MIN_CONTRAST times
 * as bright as away and rises smoothly to 1 at GLOW_FULL_CONTRAST, so the
 * glow fades in and out with the hour rather than switching. The power is the
 * slope, through the origin, of ln r on ln cos(phi) over the columns short of
 * 90 degrees, where r is each column's luma between the away mean (0) and the
 * column toward the sun (1): the power of cos(phi) that the horizon's
 * fall-off follows. Each column counts by r (1 - r), so it enters and leaves
 * the fit smoothly as it nears either end and the power never steps between
 * adjacent hours. GLOW_POWER_MAX when no column lies between the ends: the
 * fall-off is sharper than the ring resolves.
 */
export function fitGlow(ring: readonly Rgb[], away: Rgb): { power: number; weight: number } {
  const la = luma(away);
  const toward = ring[0];
  const lt = toward === undefined ? 0 : luma(toward);
  if (!(lt > GLOW_MIN_CONTRAST * la)) return { power: GLOW_POWER_MIN, weight: 0 };
  const weight = smoothstep01((lt - GLOW_MIN_CONTRAST * la) / ((GLOW_FULL_CONTRAST - GLOW_MIN_CONTRAST) * la));
  const span = lt - la;
  let xy = 0;
  let xx = 0;
  for (let i = 1; i <= GLOW_LAST; i++) {
    const column = ring[i];
    if (column === undefined) continue;
    const r = (luma(column) - la) / span;
    if (!(r > 0 && r < 1)) continue;
    const x = Math.log(Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1)));
    const k = r * (1 - r);
    xy += k * x * Math.log(r);
    xx += k * x * x;
  }
  if (!(xx > 0)) return { power: GLOW_POWER_MAX, weight };
  return { power: Math.min(GLOW_POWER_MAX, Math.max(GLOW_POWER_MIN, xy / xx)), weight };
}

/**
 * The sky's state at `hour` under `w`. The table is to hold the noon bracket
 * and the slices at or bracketing the sun's altitude (`table.has`); short of
 * that, the nearest held slices stand in.
 */
export function skyStateFor(table: SkyTable, hour: number, w: WeatherParams): SkyState {
  const sunDir = sunPositionAt(hour);
  const altitude = Math.asin(sunDir.y);
  const noon = table.blendAt(NOON_ALTITUDE_DEG);
  // The same expression as NOON_ALTITUDE_DEG's, so noon blends the same slice
  // twice and its anchors hold exactly.
  const clear = table.blendAt((altitude * 180) / Math.PI);

  const K = skyScale(noon);
  const yNoon = luma(levelLight(noon));
  const light = levelLight(clear);
  const y = luma(light);
  const adaptation = adaptationFor(y, yNoon);
  const scale = K * adaptation;
  const adapted = (y / yNoon) * adaptation;
  const night = nightFactor(adapted);
  const cloud = clamp01(w.cloudCover);
  const nightFloor = scaled(NIGHT_SKY, night);

  const deckZenith = scaled(desaturateRgb(light, AMBIENT_DESAT), DECK_TAU * DECK_ZENITH_PER_LIGHT * scale);
  const ringDeck = deckRadiance(deckZenith, Math.sin(RING_ELEVATION_DEG * DEG));
  const ring: Rgb[] = [];
  for (let i = 0; i < SLICE_AZIMUTHS; i++) {
    ring.push(added(mixRgb(scaled(texel(clear.ring, i), scale), ringDeck, cloud), nightFloor));
  }
  let sum: Rgb = { r: 0, g: 0, b: 0 };
  for (let i = AWAY_FIRST; i < SLICE_AZIMUTHS; i++) sum = added(sum, ring[i] ?? nightFloor);
  const horizonAway = scaled(sum, 1 / (SLICE_AZIMUTHS - AWAY_FIRST));
  const horizonToward = ring[0] ?? horizonAway;
  const glow = fitGlow(ring, horizonAway);
  const level = Math.hypot(sunDir.x, sunDir.z);
  const glowDir: Vec3 = level > 0 ? { x: sunDir.x / level, y: 0, z: sunDir.z / level } : { x: 1, y: 0, z: 0 };

  const sun = clear.sun;
  const sunLuma = luma(sun);
  const sunHue = sunLuma > 0 ? scaled(sun, 1 / sunLuma) : { r: 1, g: 1, b: 1 };
  const up = sunUpFor(altitude);
  const sunIntensity = SUN_PEAK * (sunLuma / luma(noon.sun)) * adaptation * (1 - SUN_CLOUD_LOSS * cloud) * up;
  const disc = scaled(sun, SUN_DISC_RADIANCE * scale);
  const discPeak = Math.max(disc.r, disc.g, disc.b);
  const discCap = discPeak > SUN_DISC_VIEW_MAX ? SUN_DISC_VIEW_MAX / discPeak : 1;
  const discColour = scaled(disc, discCap * (1 - cloud) * up);

  const irradiance = clear.skyIrradiance;
  const irradianceLuma = luma(irradiance);
  const skyHue = irradianceLuma > 0 ? scaled(irradiance, 1 / irradianceLuma) : scaled(MOONLIGHT, 1 / luma(MOONLIGHT));
  const skyFill = scaled(desaturateRgb(skyHue, AMBIENT_DESAT * cloud), FILL_DAY_LUMA);
  const day = FILL_DAY * adapted * (1 + FILL_LIFT * cloud) * (1 - night);
  const moon = FILL_NIGHT * night;
  const fillIntensity = day + moon;
  // Each end exact: the day colour alone by day, the moonlight alone at night.
  const fillColour = moon === 0
    ? skyFill
    : day === 0
      ? { ...MOONLIGHT }
      : scaled(added(scaled(skyFill, day), scaled(MOONLIGHT, moon)), 1 / fillIntensity);

  return {
    hour,
    altitude,
    sunDir,
    scale,
    adaptation,
    night,
    cloud,
    nightFloor,
    clear,
    deckZenith,
    mistAir: airColourUnder(w, horizonAway),
    mistWeight: clamp01(w.mist),
    sunColour: desaturateRgb(sunHue, SUN_DESAT * cloud),
    sunIntensity,
    discColour,
    fillColour,
    fillIntensity,
    horizonAway,
    horizonToward,
    glowDir,
    glowPower: glow.power,
    glowWeight: glow.weight,
  };
}
