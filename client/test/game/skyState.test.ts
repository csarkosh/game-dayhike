import { describe, it, expect, beforeAll, vi } from "vitest";
import { desaturateRgb, luma, type Rgb } from "../../src/game/colour.js";
import { MOONLIGHT, NIGHT_SKY, sunPositionAt, type Vec3 } from "../../src/game/sky.js";
import { AMBIENT_DESAT, WEATHER_PRESETS, airColourUnder, type WeatherParams } from "../../src/game/weather.js";
import {
  RING_ELEVATION_DEG, SKY_EYE_KM, SKY_GROUND_KM, SLICE_ALTITUDES_DEG, SLICE_AZIMUTHS, SLICE_ELEVATIONS, rowOfElevation,
  type SkySlice,
} from "../../src/game/skyModel.js";
import { buildSkyTableSync, createSkyTable, NOON_ALTITUDE_DEG, sliceBracket, type SkyTable } from "../../src/game/skyTable.js";
import {
  DECK_TAU, FILL_DAY_LUMA, GLOW_FALLOFF_FLOOR, GLOW_FIT_FROM_DEG, GLOW_FIT_TO_DEG, GLOW_FULL_CONTRAST, GLOW_MIN_CONTRAST,
  GLOW_POWER_MAX, GLOW_POWER_MIN, MIST_HORIZON,
  NIGHT_YA_DAY, NIGHT_YA_NIGHT, SKY_GAMMA, SKY_IBL_SCALE, SKY_NOON_ZENITH_LUMINANCE, SUN_DISC_CAPTURE_MAX, SUN_DISC_COS,
  SUN_DISC_RADIANCE, SUN_DISC_VIEW_MAX, adaptationFor, captureEncode, deckRadiance, domeRadiance, fitGlow, levelLight,
  nightFactor, skyScale, skyStateFor, skyTableUv, sunUpFor, type SkyState,
} from "../../src/game/skyState.js";
import { skyFixture, SKY_FIXTURE_HOURS } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

const CLEAR = WEATHER_PRESETS.clear;
const MIST = WEATHER_PRESETS.mist;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const DEG = Math.PI / 180;

/** A slice with the given fields over a black sky. */
function slice(fields: Partial<SkySlice>): SkySlice {
  return {
    altitudeDeg: 30,
    texels: new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3),
    ring: new Float32Array(SLICE_AZIMUTHS * 3),
    zenith: { r: 0, g: 0, b: 0 },
    skyIrradiance: { r: 0, g: 0, b: 0 },
    sun: { r: 0, g: 0, b: 0 },
    ...fields,
  };
}

const grey = (v: number): Rgb => ({ r: v, g: v, b: v });

/** Direction at `elevationDeg`, `azimuth` radians round from the sun's azimuth. */
function around(s: SkyState, elevationDeg: number, azimuth: number): Vec3 {
  const e = elevationDeg * DEG;
  const g = s.glowDir;
  return {
    x: Math.cos(e) * (g.x * Math.cos(azimuth) - g.z * Math.sin(azimuth)),
    y: Math.sin(e),
    z: Math.cos(e) * (g.x * Math.sin(azimuth) + g.z * Math.cos(azimuth)),
  };
}

/** The largest per-channel difference, over the luma of `b`. */
function apart(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) / luma(b);
}

describe("the sky's constants", () => {
  it("keep the night sky and the moonlight they had, frozen", () => {
    expect(NIGHT_SKY).toEqual({ r: 0.02, g: 0.03, b: 0.06 });
    expect(MOONLIGHT).toEqual({ r: 0.2, g: 0.26, b: 0.4 });
    expect(Object.isFrozen(NIGHT_SKY)).toBe(true);
    expect(Object.isFrozen(MOONLIGHT)).toBe(true);
  });

  it("make the disc 0.27 degrees in radius with an irradiance of 1, and keep the day fill's luma", () => {
    expect(Math.acos(SUN_DISC_COS) / DEG).toBeCloseTo(0.27, 6);
    expect(SUN_DISC_RADIANCE * 2 * Math.PI * (1 - SUN_DISC_COS)).toBeCloseTo(1, 12);
    expect([SUN_DISC_CAPTURE_MAX, SUN_DISC_VIEW_MAX]).toEqual([1, 16]);
    expect(FILL_DAY_LUMA).toBe(0.5633);
    expect(luma({ r: 0.42, g: 0.58, b: 0.82 })).toBeCloseTo(0.5633, 4);
    expect(MIST_HORIZON).toBe(0.08);
    expect([GLOW_POWER_MIN, GLOW_POWER_MAX]).toEqual([1, 64]);
    expect([GLOW_FIT_FROM_DEG, GLOW_FIT_TO_DEG, GLOW_FALLOFF_FLOOR]).toEqual([20, 30, 1e-4]);
    expect(SKY_IBL_SCALE).toBe(1);
  });
});

describe("the pieces", () => {
  it("skyScale puts the noon zenith at 0.416", () => {
    expect(skyScale(slice({ zenith: grey(0.104) }))).toBeCloseTo(4, 12);
    expect(SKY_NOON_ZENITH_LUMINANCE).toBe(0.416);
  });

  it("levelLight is the sun on level ground plus the sky's light, and the sky's alone below the horizon", () => {
    const up = levelLight(slice({ altitudeDeg: 30, sun: { r: 1, g: 0.5, b: 0.25 }, skyIrradiance: { r: 0.1, g: 0.2, b: 0.3 } }));
    expect(up.r).toBeCloseTo(0.6, 12);
    expect(up.g).toBeCloseTo(0.45, 12);
    expect(up.b).toBeCloseTo(0.425, 12);
    const down = levelLight(slice({ altitudeDeg: -5, sun: { r: 1, g: 1, b: 1 }, skyIrradiance: { r: 0.1, g: 0.2, b: 0.3 } }));
    expect(down).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it("adaptationFor is 1 at noon's light, goes as its -1/2 power below, and stops at the floor", () => {
    expect(adaptationFor(1, 1)).toBe(1);
    expect(adaptationFor(0.25, 1)).toBeCloseTo(2, 12);
    expect(adaptationFor(2.5, 10)).toBeCloseTo(2, 12);
    expect(adaptationFor(0.01, 1)).toBeCloseTo(10, 12);
    expect(adaptationFor(0, 1) / 1e6).toBeCloseTo(1, 12);
    expect(SKY_GAMMA).toBe(0.5);
  });

  it("nightFactor is exactly 0 from NIGHT_YA_DAY up and exactly 1 from NIGHT_YA_NIGHT down, linear in the log between", () => {
    expect([NIGHT_YA_DAY, NIGHT_YA_NIGHT]).toEqual([0.1, 0.003]);
    expect(nightFactor(NIGHT_YA_DAY)).toBe(0);
    expect(nightFactor(1)).toBe(0);
    expect(nightFactor(NIGHT_YA_NIGHT)).toBe(1);
    expect(nightFactor(1e-4)).toBe(1);
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(Math.sqrt(NIGHT_YA_DAY * NIGHT_YA_NIGHT))).toBeCloseTo(0.5, 12);
    let previous = 0;
    for (let k = 1; k < 50; k++) {
      const n = nightFactor(NIGHT_YA_DAY * (NIGHT_YA_NIGHT / NIGHT_YA_DAY) ** (k / 50));
      expect(n).toBeGreaterThan(previous);
      previous = n;
    }
  });

  it("deckRadiance is the overcast law: the zenith overhead, a third of it at and below the horizon", () => {
    const zenith = { r: 3, g: 6, b: 9 };
    const at = (sinE: number) => {
      const c = deckRadiance(zenith, sinE);
      return [c.r, c.g, c.b].map((v) => Number(v.toFixed(12)));
    };
    expect(at(1)).toEqual([3, 6, 9]);
    expect(at(0.5)).toEqual([2, 4, 6]);
    expect(at(0)).toEqual([1, 2, 3]);
    expect(at(-0.5)).toEqual([1, 2, 3]);
  });

  it("sunUpFor fades the sun out over one disc diameter, ending where its ray meets the ground", () => {
    // From the eye's 200 m the horizon dips 0.4544 degrees.
    const dip = Math.acos(SKY_GROUND_KM / (SKY_GROUND_KM + SKY_EYE_KM));
    expect(dip / DEG).toBeCloseTo(0.4544, 4);
    expect(sunUpFor(0.1 * DEG)).toBe(1);
    expect(sunUpFor(-dip)).toBe(0);
    expect(sunUpFor(-0.46 * DEG)).toBe(0);
    expect(sunUpFor(-dip + 0.27 * DEG)).toBeCloseTo(0.5, 9);
    let previous = 1;
    for (let a = 0.1; a >= -0.46; a -= 0.01) {
      const up = sunUpFor(a * DEG);
      expect(up).toBeLessThanOrEqual(previous);
      previous = up;
    }
  });
});

describe("skyTableUv, the fragment stage's mapping transcribed", () => {
  const SUN: Vec3 = { x: Math.cos(0.3), y: Math.sin(0.3), z: 0 };

  it("lands on the texel centres at the zenith, the horizon either way and 90 degrees round", () => {
    expect(skyTableUv(UP, SUN)).toEqual([0.015625, 0.9921875]);
    expect(skyTableUv({ x: 1, y: 0, z: 0 }, SUN)).toEqual([0.015625, 0.5]);
    expect(skyTableUv({ x: -1, y: 0, z: 0 }, SUN)).toEqual([0.984375, 0.5]);
    // Mirror-symmetric about the sun's vertical plane.
    expect(skyTableUv({ x: 0, y: 0, z: 1 }, SUN)).toEqual([0.5, 0.5]);
    expect(skyTableUv({ x: 0, y: 0, z: -1 }, SUN)).toEqual([0.5, 0.5]);
  });

  it("measures the azimuth from the sun's, wherever the sun is", () => {
    const sun = sunPositionAt(17);
    const level = Math.hypot(sun.x, sun.z);
    expect(skyTableUv({ x: sun.x / level, y: 0, z: sun.z / level }, sun)).toEqual([0.015625, 0.5]);
  });

  it("maps the elevation by its root, as rowOfElevation does", () => {
    const e = Math.PI / 4;
    const [, v] = skyTableUv({ x: Math.cos(e), y: Math.sin(e), z: 0 }, SUN);
    // (0.5 + 0.5 sqrt(1/2)) on 64 texel centres.
    expect(v).toBeCloseTo(0.84802912, 8);
    for (const deg of [0.5, 2, 10, 30, 60, 89]) {
      const [, at] = skyTableUv({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG), z: 0 }, SUN);
      expect(at).toBeCloseTo((rowOfElevation(deg * DEG) * (SLICE_ELEVATIONS - 1) + 0.5) / SLICE_ELEVATIONS, 12);
    }
  });

  it("reads the horizon's row for every direction below the horizon", () => {
    const below = (deg: number, az: number): Vec3 => ({ x: Math.cos(deg * DEG) * Math.cos(az), y: Math.sin(deg * DEG), z: Math.cos(deg * DEG) * Math.sin(az) });
    expect(skyTableUv(below(-30, 1), SUN)).toEqual(skyTableUv(below(0, 1), SUN));
    expect(skyTableUv({ x: 0, y: -1, z: 0 }, SUN)).toEqual([0.015625, 0.5]);
  });
});

describe("clear noon keeps the anchors of the sky the table replaced", () => {
  it("the dome's zenith at 0.416, the sun at 4, the fill at 0.15, no night and no night floor", () => {
    const s = skyStateFor(skyFixture(), 12, CLEAR);
    expect(s.scale * luma(s.clear.zenith)).toBeCloseTo(0.416, 12);
    expect(s.nightFloor).toEqual({ r: 0, g: 0, b: 0 });
    // Straight up the stage reads the zenith texel at its centre, and the floor adds nothing by
    // day. The blended slice holds its texels in float32, so 7 places.
    expect(luma(domeRadiance(s, UP))).toBeCloseTo(0.416, 7);
    expect(s.adaptation).toBe(1);
    expect(s.night).toBe(0);
    expect(s.sunIntensity).toBe(4);
    expect(luma(s.sunColour)).toBeCloseTo(1, 12);
    expect(s.fillIntensity).toBe(0.15);
    expect(luma(s.fillColour)).toBeCloseTo(0.5633, 12);
    expect(s.cloud).toBe(0);
    expect(s.mistWeight).toBe(0);
  });
});

describe("the noon reading", () => {
  /** A table of the fixture's noon bracket and the afternoon's. */
  function afternoonTable(): SkyTable {
    const table = createSkyTable();
    for (const deg of [74, 76, 42, 44]) table.add(skyFixture().blendAt(deg));
    return table;
  }

  it("blends the noon slice once for each count of slices the table holds, so a state blends one slice", () => {
    const table = afternoonTable();
    const blend = vi.spyOn(table, "blendAt");
    skyStateFor(table, 15, CLEAR);
    expect(blend).toHaveBeenCalledTimes(2);
    skyStateFor(table, 15, MIST);
    skyStateFor(table, 15.1, CLEAR);
    expect(blend).toHaveBeenCalledTimes(4);
    // A slice arrives: the noon slice is read again, once.
    table.add(skyFixture().blendAt(28));
    skyStateFor(table, 15, CLEAR);
    expect(blend).toHaveBeenCalledTimes(6);
    skyStateFor(table, 15, CLEAR);
    expect(blend).toHaveBeenCalledTimes(7);
  });

  it("changes no value: a state from a table read before is the state from one read afresh, and says how many slices it was made from", () => {
    const warm = afternoonTable();
    skyStateFor(warm, 12, CLEAR);
    skyStateFor(warm, 15, MIST);
    const fresh = afternoonTable();
    for (const w of [CLEAR, MIST, WEATHER_PRESETS.rain]) expect(skyStateFor(warm, 15, w)).toEqual(skyStateFor(afternoonTable(), 15, w));
    expect(skyStateFor(fresh, 15, CLEAR).tableCount).toBe(4);
    // Noon's anchors, from the reading.
    const noon = skyStateFor(warm, 12, CLEAR);
    expect(noon.sunIntensity).toBe(4);
    expect(noon.scale * luma(noon.clear.zenith)).toBeCloseTo(0.416, 12);
  });
});

describe("midnight keeps the night it had", () => {
  it("the moonlight fill, the night sky overhead, no sun", () => {
    for (const w of [CLEAR, MIST, WEATHER_PRESETS.eerie]) {
      const s = skyStateFor(skyFixture(), 0, w);
      expect(s.night).toBe(1);
      expect(s.nightFloor).toEqual({ r: 0.02, g: 0.03, b: 0.06 });
      expect(s.fillIntensity).toBe(1.2);
      expect(s.fillColour).toEqual({ r: 0.2, g: 0.26, b: 0.4 });
      expect(s.sunIntensity).toBe(0);
      expect(s.discColour).toEqual({ r: 0, g: 0, b: 0 });
    }
    const s = skyStateFor(skyFixture(), 0, CLEAR);
    // What the table still holds at -18 degrees, adapted, is under a tenth of the night sky.
    const zenith = domeRadiance(s, UP);
    expect(Math.abs(zenith.r - 0.02)).toBeLessThan(0.002);
    expect(Math.abs(zenith.g - 0.03)).toBeLessThan(0.002);
    expect(Math.abs(zenith.b - 0.06)).toBeLessThan(0.002);
  });
});

describe("one sky for the dome, the fog and the glow", () => {
  const MISTLESS: WeatherParams[] = [CLEAR, { ...WEATHER_PRESETS.overcast, mist: 0 }, { ...WEATHER_PRESETS.rain, mist: 0 }];

  /** The dome's mean at the horizon, elevation 0, over the columns past 90 degrees from the sun (93 to 180). */
  function domeAway(s: SkyState): Rgb {
    let mean: Rgb = { r: 0, g: 0, b: 0 };
    for (let i = SLICE_AZIMUTHS / 2; i < SLICE_AZIMUTHS; i++) {
      const c = domeRadiance(s, around(s, 0, (Math.PI * i) / (SLICE_AZIMUTHS - 1)));
      const k = 1 / (SLICE_AZIMUTHS / 2);
      mean = { r: mean.r + c.r * k, g: mean.g + c.g * k, b: mean.b + c.b * k };
    }
    return mean;
  }

  /** The dome at the horizon, elevation 0, toward the sun's azimuth: the sky's colour there, without
   * the disc, which sits on that very direction at sunrise and sunset. */
  function domeToward(s: SkyState): Rgb {
    return domeRadiance({ ...s, discColour: { r: 0, g: 0, b: 0 } }, around(s, 0, 0));
  }

  // The ring is the table's at exactly 0 degrees, grazing the horizon; the
  // dome reads the horizon between the rows either side of it, 0.023 degrees
  // below and above, which moves a channel by well under half a per cent of
  // the luma.
  it("the horizon's colours are the dome's own at the horizon at 12:00, 17:00, 18:00 and 18:30 clear", () => {
    expect(RING_ELEVATION_DEG).toBe(0);
    for (const hour of [12, 17, 18, 18.5]) {
      const s = skyStateFor(skyFixture(), hour, CLEAR);
      expect(apart(domeAway(s), s.horizonAway), `hour ${hour}`).toBeLessThan(0.005);
      expect(apart(domeToward(s), s.horizonToward), `hour ${hour}`).toBeLessThan(0.005);
    }
  });

  it("the horizon away from the sun is the dome's own at the horizon, 90 to 180 degrees round", () => {
    for (const w of MISTLESS) {
      for (const hour of SKY_FIXTURE_HOURS) {
        const s = skyStateFor(skyFixture(), hour, w);
        expect(apart(domeAway(s), s.horizonAway), `hour ${hour}`).toBeLessThan(0.005);
      }
    }
  });

  it("the horizon toward the sun is the dome's own at the horizon toward the sun's azimuth", () => {
    for (const w of MISTLESS) {
      for (const hour of SKY_FIXTURE_HOURS) {
        const s = skyStateFor(skyFixture(), hour, w);
        expect(apart(domeToward(s), s.horizonToward), `hour ${hour}`).toBeLessThan(0.005);
      }
    }
  });

  it("the fog's colour is the air over the horizon away from the sun, exactly that horizon at clear", () => {
    for (const hour of SKY_FIXTURE_HOURS) {
      const clear = skyStateFor(skyFixture(), hour, CLEAR);
      expect(clear.mistAir).toEqual(clear.horizonAway);
      const misty = skyStateFor(skyFixture(), hour, MIST);
      expect(misty.mistAir).toEqual(airColourUnder(MIST, misty.horizonAway));
    }
  });

  it("the glow points level, at the sun's azimuth", () => {
    for (const hour of [8, 15, 18]) {
      const s = skyStateFor(skyFixture(), hour, CLEAR);
      const level = Math.hypot(s.sunDir.x, s.sunDir.z);
      expect(s.glowDir.y).toBe(0);
      expect(s.glowDir.x).toBeCloseTo(s.sunDir.x / level, 12);
      expect(s.glowDir.z).toBeCloseTo(s.sunDir.z / level, 12);
    }
  });
});

describe("the dome, as the fragment stage computes it", () => {
  it("reads the horizon's colour below the horizon", () => {
    for (const hour of [12, 18, 18.5]) {
      const s = skyStateFor(skyFixture(), hour, MIST);
      for (const az of [0.4, 1.5, 2.9]) expect(domeRadiance(s, around(s, -30, az))).toEqual(domeRadiance(s, around(s, 0, az)));
    }
  });

  it("caps the disc in the probe's capture and nowhere else", () => {
    const s = skyStateFor(skyFixture(), 15, CLEAR);
    const noDisc = { ...s, discColour: { r: 0, g: 0, b: 0 } };
    const view = domeRadiance(s, s.sunDir);
    const capture = domeRadiance(s, s.sunDir, true);
    const sky = domeRadiance(noDisc, s.sunDir);
    expect(view.r - sky.r).toBeCloseTo(s.discColour.r, 9);
    expect(capture.r - sky.r).toBeCloseTo(Math.min(s.discColour.r, 1), 9);
    expect(capture.b - sky.b).toBeCloseTo(Math.min(s.discColour.b, 1), 9);
    // Off the disc the capture is the view.
    const off = around(s, 30, 2);
    expect(domeRadiance(s, off, true)).toEqual(domeRadiance(s, off));
  });

  it("writes the capture gamma-encoded, so a material decoding it by 2.2 reads the linear sky", () => {
    const encoded = captureEncode({ r: 1, g: 0.5, b: 4 });
    expect(encoded.r).toBe(1);
    expect(encoded.g).toBeCloseTo(0.72974, 5);
    expect(encoded.b).toBeCloseTo(1.87786, 5);
    const dim = captureEncode({ r: 0, g: -0.1, b: 0.04 });
    expect([dim.r, dim.g]).toEqual([0, 0]);
    expect(dim.b).toBeCloseTo(0.23151, 5);
    const s = skyStateFor(skyFixture(), 18, CLEAR);
    for (const d of [UP, s.sunDir, around(s, 2, 0), around(s, 10, 3)]) {
      const linear = domeRadiance(s, d, true);
      const decoded = captureEncode(linear);
      expect(decoded.r ** 2.2).toBeCloseTo(linear.r, 9);
      expect(decoded.g ** 2.2).toBeCloseTo(linear.g, 9);
      expect(decoded.b ** 2.2).toBeCloseTo(linear.b, 9);
    }
  });

  it("keeps the disc under half float's range in the view, its hue kept", () => {
    const s = skyStateFor(skyFixture(), 12, CLEAR);
    expect(Math.max(s.discColour.r, s.discColour.g, s.discColour.b)).toBeCloseTo(16, 9);
    const t = s.clear.sun;
    expect(s.discColour.g / s.discColour.r).toBeCloseTo(t.g / t.r, 9);
    expect(s.discColour.b / s.discColour.r).toBeCloseTo(t.b / t.r, 9);
  });

  it("blends into the fog colour at the horizon by the mist, and hardly at all overhead", () => {
    const s = skyStateFor(skyFixture(), 12, MIST);
    expect(domeRadiance(s, around(s, 0, 1))).toEqual(s.mistAir);
    const h = Math.exp(-1 / 0.08);
    const plain = domeRadiance({ ...s, mistWeight: 0 }, UP);
    expect(domeRadiance(s, UP).r).toBeCloseTo(plain.r + (s.mistAir.r - plain.r) * h, 12);
  });
});

describe("the cloud deck", () => {
  it("leaves the clear dome alone at no cloud", () => {
    for (const hour of [12, 18]) {
      const s = skyStateFor(skyFixture(), hour, CLEAR);
      const odd = { ...s, deckZenith: { r: 99, g: 99, b: 99 } };
      for (const d of [UP, around(s, 2, 0), around(s, 10, 2), around(s, 45, 3)]) expect(domeRadiance(odd, d)).toEqual(domeRadiance(s, d));
      const ring0 = { r: s.clear.ring[0]!, g: s.clear.ring[1]!, b: s.clear.ring[2]! };
      expect(s.horizonToward.r).toBeCloseTo(s.scale * ring0.r + s.nightFloor.r, 9);
      expect(s.horizonToward.b).toBeCloseTo(s.scale * ring0.b + s.nightFloor.b, 9);
    }
  });

  it("takes the disc and the glow away at full cloud", () => {
    for (const hour of [12, 15, 17, 18]) {
      const s = skyStateFor(skyFixture(), hour, WEATHER_PRESETS.rain);
      expect(s.cloud).toBe(1);
      expect(s.discColour).toEqual({ r: 0, g: 0, b: 0 });
      expect(s.glowWeight).toBe(0);
    }
  });

  it("follows the clear sky's light on level ground, desaturated, and dims with it toward dusk", () => {
    for (const hour of [8, 12, 15, 17, 18, 18.25]) {
      const s = skyStateFor(skyFixture(), hour, MIST);
      const light = levelLight(s.clear);
      const expected = luma(light) * DECK_TAU * (9 / (7 * Math.PI)) * s.scale;
      expect(luma(s.deckZenith) / expected).toBeCloseTo(1, 12);
      const hue = desaturateRgb(light, AMBIENT_DESAT);
      expect(s.deckZenith.g / s.deckZenith.r).toBeCloseTo(hue.g / hue.r, 9);
      expect(s.deckZenith.b / s.deckZenith.r).toBeCloseTo(hue.b / hue.r, 9);
    }
    const noon = skyStateFor(skyFixture(), 12, MIST);
    const dusk = skyStateFor(skyFixture(), 18, MIST);
    expect(luma(dusk.deckZenith)).toBeLessThan(0.2 * luma(noon.deckZenith));
  });

  it("gives noon in mist the old mist dome overhead, luma 0.80", () => {
    const s = skyStateFor(skyFixture(), 12, MIST);
    expect(Math.abs(luma(domeRadiance(s, UP)) - 0.8)).toBeLessThan(0.01);
  });
});

describe("the haze glow's fit", () => {
  /** A ring whose luma falls from `toward` to `away` as cos(phi)^power, level past 90 degrees. */
  function ring(power: number, away = 0.2, toward = 1): Rgb[] {
    const out: Rgb[] = [];
    for (let i = 0; i < SLICE_AZIMUTHS; i++) {
      const c = Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1));
      out.push(grey(i < SLICE_AZIMUTHS / 2 ? away + (toward - away) * c ** power : away));
    }
    return out;
  }

  it("recovers the power of a known fall-off at full weight, to within 1e-9", () => {
    for (const power of [2, 5.5, 8, 20, 32]) {
      const fit = fitGlow(ring(power), grey(0.2));
      expect(fit.weight).toBe(1);
      expect(Math.abs(fit.power - power)).toBeLessThan(1e-9);
    }
  });

  /** A sharp core over a long tail, as the dusk horizon has: no single power follows both. */
  const twoLobes = (i: number): number => {
    const c = Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1));
    return 0.7 * c ** 40 + 0.3 * c ** 3;
  };
  const twoLobed = Array.from({ length: SLICE_AZIMUTHS }, (_, i) => grey(i < SLICE_AZIMUTHS / 2 ? 0.2 + 0.8 * twoLobes(i) : 0.2));

  it("fits by the least worst factor over the columns between 20 and 30 degrees, columns 4 and 5", () => {
    const worst = (p: number): number =>
      Math.max(...[4, 5].map((i) => Math.abs(Math.log(Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1)) ** p / twoLobes(i)))));
    const fit = fitGlow(twoLobed, grey(0.2));
    for (let p = 1; p <= 64; p += 0.01) expect(worst(fit.power)).toBeLessThanOrEqual(worst(p) + 1e-12);
    expect(fit.power).toBeCloseTo(13.487, 3);
  });

  it("reads no column outside them: the core and the tail leave the power where it is", () => {
    const fit = fitGlow(twoLobed, grey(0.2));
    const elsewhere = twoLobed.map((c, i) => (i === 0 || i === 4 || i === 5 ? c : grey(c.r * (i < 4 ? 0.9 : 1.3))));
    expect(fitGlow(elsewhere, grey(0.2))).toEqual(fit);
  });

  it("clamps the power to its range, and takes the largest when the ring cannot resolve the fall-off", () => {
    expect(fitGlow(ring(100), grey(0.2)).power).toBe(64);
    expect(fitGlow(ring(0.5), grey(0.2)).power).toBe(1);
    const spike = ring(8).map((c, i) => (i === 0 ? c : grey(0.2)));
    expect(fitGlow(spike, grey(0.2))).toEqual({ power: 64, weight: 1 });
  });

  it("has no glow at or below GLOW_MIN_CONTRAST, and fades in smoothly to full weight at GLOW_FULL_CONTRAST", () => {
    expect([GLOW_MIN_CONTRAST, GLOW_FULL_CONTRAST]).toEqual([1.05, 1.25]);
    expect(fitGlow(ring(8, 0.2, 0.2 * 1.04), grey(0.2))).toEqual({ power: 1, weight: 0 });
    expect(fitGlow(ring(8, 0.2, 0.2), grey(0.2))).toEqual({ power: 1, weight: 0 });
    expect(fitGlow(ring(8, 0.2, 0.2 * 1.15), grey(0.2)).weight).toBeCloseTo(0.5, 9);
    expect(fitGlow(ring(8, 0.2, 0.2 * 1.25), grey(0.2)).weight).toBeCloseTo(1, 9);
    expect(fitGlow(ring(8, 0.2, 0.3), grey(0.2)).weight).toBe(1);
    let previous = 0;
    for (let k = 1; k <= 20; k++) {
      const w = fitGlow(ring(8, 0.2, 0.2 * (1.05 + 0.01 * k)), grey(0.2)).weight;
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });
});

describe("the haze glow on the sky's own horizon toward sunset", () => {
  /** The hours the reviewed glow was too wide at, 17:50 among them. */
  const HOURS = [17, 17 + 50 / 60, 18];
  let table: SkyTable;
  beforeAll(() => {
    const indices = new Set<number>(sliceBracket(NOON_ALTITUDE_DEG));
    for (const hour of HOURS) for (const index of sliceBracket(Math.asin(sunPositionAt(hour).y) / DEG)) indices.add(index);
    table = buildSkyTableSync([...indices].sort((a, b) => a - b).map((index) => SLICE_ALTITUDES_DEG[index] as number));
  }, timeLimit(20_000));

  /** The ring's luma per column as the state reads it under a clear sky, between the away mean (0) and toward the sun (1). */
  function falloff(s: SkyState): number[] {
    const away = luma(s.horizonAway);
    const toward = luma(s.horizonToward);
    return Array.from({ length: SLICE_AZIMUTHS }, (_, i) => {
      const c = { r: s.clear.ring[i * 3]! * s.scale + s.nightFloor.r, g: s.clear.ring[i * 3 + 1]! * s.scale + s.nightFloor.g, b: s.clear.ring[i * 3 + 2]! * s.scale + s.nightFloor.b };
      return (luma(c) - away) / (toward - away);
    });
  }

  /** The fall-off at `deg` from the sun's azimuth, linear between the columns either side. */
  function falloffAt(r: number[], deg: number): number {
    const x = (deg / 180) * (SLICE_AZIMUTHS - 1);
    const i = Math.floor(x);
    return r[i]! + (r[i + 1]! - r[i]!) * (x - i);
  }

  it("is the power whose lobe misses the ring's own columns between 20 and 30 degrees by the least worst factor", () => {
    for (const hour of HOURS) {
      const s = skyStateFor(table, hour, CLEAR);
      const r = falloff(s);
      const worst = (p: number): number =>
        Math.max(...[4, 5].map((i) => Math.abs(Math.log(Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1)) ** p / r[i]!))));
      for (let p = 1; p <= 64; p += 0.01) expect(worst(s.glowPower), `hour ${hour}`).toBeLessThanOrEqual(worst(p) + 1e-12);
    }
  });

  it("draws the glow within a factor of 1.6 of the ring's fall-off at 20 and at 30 degrees from the sun, either way", () => {
    for (const hour of HOURS) {
      const s = skyStateFor(table, hour, CLEAR);
      expect(s.glowWeight, `hour ${hour}`).toBe(1);
      const r = falloff(s);
      for (const deg of [20, 30]) {
        const ratio = Math.cos(deg * DEG) ** s.glowPower / falloffAt(r, deg);
        expect(ratio, `hour ${hour}, ${deg} degrees`).toBeLessThanOrEqual(1.6);
        expect(ratio, `hour ${hour}, ${deg} degrees`).toBeGreaterThanOrEqual(0.625);
      }
    }
  });
});

describe("18:00 under a clear sky", () => {
  it("keeps the zenith blue and turns the horizon toward the sun red", () => {
    const s = skyStateFor(skyFixture(), 18, CLEAR);
    const zenith = domeRadiance(s, UP);
    expect(zenith.b).toBeGreaterThan(zenith.r);
    expect(zenith.b).toBeGreaterThan(zenith.g);
    expect(s.horizonToward.r).toBeGreaterThan(s.horizonToward.g);
    expect(s.horizonToward.r).toBeGreaterThan(s.horizonToward.b);
    expect(s.glowWeight).toBeGreaterThan(0);
  });
});

describe("the night factor across the day", () => {
  it("is exactly 0 through the day and exactly 1 through the night", () => {
    for (const hour of [8, 12, 15, 17]) expect(skyStateFor(skyFixture(), hour, CLEAR).night).toBe(0);
    for (const hour of [19, 21, 22, 0]) expect(skyStateFor(skyFixture(), hour, CLEAR).night).toBe(1);
    const dusk = skyStateFor(skyFixture(), 18.25, CLEAR).night;
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("brings the night floor in with it: none by day, the night sky at night, between in the twilight", () => {
    expect(skyStateFor(skyFixture(), 15, CLEAR).nightFloor).toEqual({ r: 0, g: 0, b: 0 });
    expect(skyStateFor(skyFixture(), 21, CLEAR).nightFloor).toEqual({ r: 0.02, g: 0.03, b: 0.06 });
    const twilight = skyStateFor(skyFixture(), 18.25, CLEAR);
    for (const [k, full] of [["r", 0.02], ["g", 0.03], ["b", 0.06]] as const) {
      expect(twilight.nightFloor[k]).toBeGreaterThan(0);
      expect(twilight.nightFloor[k]).toBeLessThan(full);
      expect(twilight.nightFloor[k]).toBeCloseTo(full * twilight.night, 12);
    }
  });
});

describe("continuity through dusk", () => {
  let table: SkyTable;
  // Every slice from -18 to 16 degrees, as the game holds them, and the noon bracket.
  beforeAll(() => {
    table = buildSkyTableSync(SLICE_ALTITUDES_DEG.filter((a) => a <= 16 || a >= 74));
  }, timeLimit(60_000));

  const scaled = (c: Rgb, k: number): Rgb => ({ r: c.r * k, g: c.g * k, b: c.b * k });
  const channels = (name: string, f: (s: SkyState) => Rgb): [string, (s: SkyState) => number][] =>
    (["r", "g", "b"] as const).map((k) => [`${name}.${k}`, (s: SkyState) => f(s)[k]]);
  /** The haze's glow at `deg` from the sun as the haze draws it: the lobe, weight times
   * cos^power, mixing the away colour toward the toward colour, so what it adds is the
   * lobe times the toward colour's lead over the away colour. */
  const glowSeen = (s: SkyState, deg: number): Rgb => {
    const lobe = s.glowWeight * Math.cos(deg * DEG) ** s.glowPower;
    return { r: lobe * (s.horizonToward.r - s.horizonAway.r), g: lobe * (s.horizonToward.g - s.horizonAway.g), b: lobe * (s.horizonToward.b - s.horizonAway.b) };
  };
  /** Every value the state hands a consumer, as it is seen: the lights as their colour
   * times their intensity (a colour at zero intensity is not seen), and the glow as what
   * it adds to the haze at three angles (a weight on no difference of colour is not
   * seen: in deep twilight, as the contrast between the horizon's colours falls through
   * the weight's fade, the weight moves fast where that difference is a few per cent). */
  const VALUES: [string, (s: SkyState) => number][] = [
    ["night", (s) => s.night],
    ["sunIntensity", (s) => s.sunIntensity],
    ["fillIntensity", (s) => s.fillIntensity],
    ...[10, 30, 60].flatMap((deg) => channels(`glow${deg}`, (s) => glowSeen(s, deg))),
    ...channels("zenith", (s) => domeRadiance(s, UP)),
    ...channels("horizonAway", (s) => s.horizonAway),
    ...channels("horizonToward", (s) => s.horizonToward),
    ...channels("mistAir", (s) => s.mistAir),
    ...channels("deckZenith", (s) => s.deckZenith),
    ...channels("discColour", (s) => s.discColour),
    ...channels("sunLight", (s) => scaled(s.sunColour, s.sunIntensity)),
    ...channels("fillLight", (s) => scaled(s.fillColour, s.fillIntensity)),
  ];

  /**
   * The sun's altitude moves at most 0.146 degrees in 0.01 h (its arc's 15
   * degrees an hour, at the horizon), so a step crosses at most one slice
   * boundary. Between boundaries every value is a smooth function of a slice
   * blended linearly in the altitude, so a step differs from the steps either
   * side only by how the slope bends at a boundary. The table's light falls
   * by under 1.5 decades a degree wherever night is not complete (the next
   * test checks it): an adapted value, which goes as its square root, bends
   * by a factor under 2.4 across a 0.5 degree slice. A step more than 3 times
   * both its neighbours, beyond 0.5 % of the value's largest magnitude over
   * the sweep (below anything the eye sees), is a jump.
   */
  it("steps no value by more than 3 times its neighbouring steps, from 17:00 to 19:30 every 0.01 h, under every preset", () => {
    for (const name of ["clear", "overcast", "mist", "rain", "eerie"] as const) {
      const states: SkyState[] = [];
      for (let k = 0; k <= 250; k++) states.push(skyStateFor(table, 17 + k * 0.01, WEATHER_PRESETS[name]));
      for (const [key, value] of VALUES) {
        const v = states.map(value);
        for (const x of v) expect(Number.isFinite(x), `${name} ${key}`).toBe(true);
        const steps = v.slice(1).map((x, i) => Math.abs(x - (v[i] as number)));
        const floor = 0.005 * Math.max(...v.map(Math.abs));
        steps.forEach((step, k) => {
          const neighbours = Math.max(steps[k - 1] ?? 0, steps[k + 1] ?? 0);
          expect(step, `${name} ${key} at ${(17.01 + 0.01 * k).toFixed(2)}`).toBeLessThanOrEqual(3 * neighbours + floor);
        });
      }
    }
  });

  /**
   * The night factor is linear in log10 of the adapted light over
   * log10(NIGHT_YA_DAY / NIGHT_YA_NIGHT) = 1.52 decades; the adapted light goes
   * as the level light's SKY_GAMMA power, and the level light falls by under
   * 1.5 decades a degree wherever the night is not complete (checked here), so
   * n moves at most 0.5 x 1.5 x 0.146 / 1.52 = 0.072 a step.
   */
  it("moves the night factor by at most 0.072 a step", () => {
    const yNoon = luma(levelLight(table.blendAt(NOON_ALTITUDE_DEG)));
    let previous = luma(levelLight(table.blendAt(16)));
    for (let a = 15.95; a >= -18; a -= 0.05) {
      const y = luma(levelLight(table.blendAt(a)));
      if ((y / yNoon) ** SKY_GAMMA > NIGHT_YA_NIGHT) expect((Math.log10(previous) - Math.log10(y)) / 0.05).toBeLessThan(1.5);
      previous = y;
    }
    for (const name of ["clear", "mist", "eerie"] as const) {
      let n = skyStateFor(table, 17, WEATHER_PRESETS[name]).night;
      for (let k = 1; k <= 250; k++) {
        const next = skyStateFor(table, 17 + k * 0.01, WEATHER_PRESETS[name]).night;
        expect(Math.abs(next - n)).toBeLessThanOrEqual(0.072);
        n = next;
      }
    }
  });
});
