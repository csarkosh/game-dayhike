import { beforeAll, describe, expect, it } from "vitest";
import { luma, type Rgb } from "../../src/game/colour.js";
import { sunPositionAt, type Vec3 } from "../../src/game/sky.js";
import {
  MULTI_SIZE,
  RING_ELEVATION_DEG,
  SKY_GROUND_KM,
  SKY_MIE_SCALE,
  SKY_TOP_KM,
  SLICE_ALTITUDES_DEG,
  SLICE_AZIMUTHS,
  SLICE_ELEVATIONS,
  TRANSMITTANCE_HEIGHT,
  TRANSMITTANCE_WIDTH,
  azimuthOfColumn,
  buildSkyTables,
  buildSlice,
  elevationOfRow,
  multiAt,
  rowOfElevation,
  skyIrradianceOf,
  skyRadiance,
  sunTransmittance,
  transmittanceAt,
  type SkySlice,
  type SkyTables,
} from "../../src/game/skyModel.js";
import { timeLimit } from "../helpers/timeLimit.js";

const DEG = Math.PI / 180;
/** The noon sun's altitude on the game's arc, degrees (75.96...). */
const NOON_DEG = Math.asin(sunPositionAt(12).y) / DEG;
const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** The unit direction at elevation e and azimuth az from the sun's, both in degrees. */
function dir(e: number, az: number): Vec3 {
  return { x: Math.cos(e * DEG) * Math.cos(az * DEG), y: Math.sin(e * DEG), z: Math.cos(e * DEG) * Math.sin(az * DEG) };
}

/** The mean of a ring's columns from..to, inclusive. */
function ringMean(ring: Float32Array, from: number, to: number): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  const n = to - from + 1;
  for (let i = from; i <= to; i++) {
    out.r += (ring[i * 3] as number) / n;
    out.g += (ring[i * 3 + 1] as number) / n;
    out.b += (ring[i * 3 + 2] as number) / n;
  }
  return out;
}

/** The clear noon horizon 2 degrees up, away from the sun (the columns' azimuths 93 to 180 degrees), over the zenith, in
 * luminance: where SKY_MIE_SCALE was set. */
function horizonOverZenith(t: SkyTables, slice: SkySlice): number {
  const away: Rgb = { r: 0, g: 0, b: 0 };
  for (let i = 16; i <= 31; i++) {
    const c = skyRadiance(t, dir(2, (180 * i) / 31), slice.altitudeDeg * DEG);
    away.r += c.r / 16;
    away.g += c.g / 16;
    away.b += c.b / 16;
  }
  return luma(away) / luma(slice.zenith);
}

/** Every value that is not a finite, non-negative number, as "what[k] = v". */
function badValues(values: ArrayLike<number>, what: string): string[] {
  const bad: string[] = [];
  for (let k = 0; k < values.length; k++) {
    const v = values[k] as number;
    if (!Number.isFinite(v) || v < 0) bad.push(`${what}[${k}] = ${v}`);
  }
  return bad;
}

const rgbValues = (c: Rgb): number[] => [c.r, c.g, c.b];

let tables: SkyTables;
let noon: SkySlice;
let sunset: SkySlice;
let deep: SkySlice;

beforeAll(() => {
  tables = buildSkyTables();
  noon = buildSlice(tables, NOON_DEG);
  sunset = buildSlice(tables, 0);
  deep = buildSlice(tables, -18);
}, timeLimit(20_000));

describe("the slice altitudes and the table's coordinates", () => {
  it("are 93 altitudes from -18 to 76, every half degree to 12, then every 2", () => {
    expect(SLICE_ALTITUDES_DEG.length).toBe(93);
    expect(SLICE_ALTITUDES_DEG[0]).toBe(-18);
    expect(SLICE_ALTITUDES_DEG[60]).toBe(12);
    expect(SLICE_ALTITUDES_DEG[61]).toBe(14);
    expect(SLICE_ALTITUDES_DEG[92]).toBe(76);
    for (let k = 1; k < SLICE_ALTITUDES_DEG.length; k++) {
      const below = SLICE_ALTITUDES_DEG[k - 1] as number;
      expect((SLICE_ALTITUDES_DEG[k] as number) - below).toBe(below < 12 ? 0.5 : 2);
    }
  });

  it("puts half the rows within 22.5 degrees of the horizon, and maps rows and elevations both ways", () => {
    expect(elevationOfRow(0)).toBe(-Math.PI / 2);
    expect(elevationOfRow(0.5)).toBe(0);
    expect(elevationOfRow(1)).toBe(Math.PI / 2);
    expect(elevationOfRow(0.25)).toBeCloseTo(-Math.PI / 8, 12);
    expect(elevationOfRow(0.75)).toBeCloseTo(Math.PI / 8, 12);
    for (let j = 0; j < SLICE_ELEVATIONS; j++) {
      const v = j / (SLICE_ELEVATIONS - 1);
      expect(rowOfElevation(elevationOfRow(v))).toBeCloseTo(v, 12);
    }
    for (let e = -90; e <= 90; e += 2.5) expect(elevationOfRow(rowOfElevation(e * DEG))).toBeCloseTo(e * DEG, 12);
  });

  it("maps columns to azimuths from the sun's, 0 to 180 degrees", () => {
    expect(azimuthOfColumn(0)).toBe(0);
    expect(azimuthOfColumn(0.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(azimuthOfColumn(1)).toBeCloseTo(Math.PI, 12);
  });
});

describe("the transmittance", () => {
  it("lies in [0, 1] and rises with the cosine at every height of the table", () => {
    expect(tables.transmittance.length).toBe(TRANSMITTANCE_WIDTH * TRANSMITTANCE_HEIGHT * 3);
    const bad: string[] = [];
    for (let j = 0; j < TRANSMITTANCE_HEIGHT; j++) {
      for (let i = 0; i < TRANSMITTANCE_WIDTH; i++) {
        for (let c = 0; c < 3; c++) {
          const v = tables.transmittance[(j * TRANSMITTANCE_WIDTH + i) * 3 + c] as number;
          const before = i > 0 ? (tables.transmittance[(j * TRANSMITTANCE_WIDTH + i - 1) * 3 + c] as number) : 0;
          if (!(v >= 0 && v <= 1 && v >= before)) bad.push(`row ${j}, column ${i}, channel ${c}: ${before} then ${v}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("rises with the cosine between the table's texels, from the eye's height", () => {
    let previous = transmittanceAt(tables, SKY_GROUND_KM + 0.2, -1);
    for (let k = 1; k <= 400; k++) {
      const next = transmittanceAt(tables, SKY_GROUND_KM + 0.2, -1 + k / 200);
      for (const c of ["r", "g", "b"] as const) {
        expect(next[c]).toBeGreaterThanOrEqual(previous[c]);
        expect(next[c]).toBeLessThanOrEqual(1);
      }
      previous = next;
    }
  });

  it("is 1 looking up from the top of the air and 0 looking into the ground", () => {
    for (const v of rgbValues(transmittanceAt(tables, SKY_TOP_KM, 1))) expect(v).toBeCloseTo(1, 6);
    expect(transmittanceAt(tables, SKY_GROUND_KM, -0.5)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("reddens the sun toward the horizon, and is 0 once the sun is below the eye's horizon", () => {
    const altitudes = [76, 45, 20, 10, 5, 2, 0];
    const suns = altitudes.map((a) => sunTransmittance(tables, a * DEG));
    expect(suns[0]?.r).toBeGreaterThan(0.85);
    for (let k = 1; k < suns.length; k++) {
      const higher = suns[k - 1] as Rgb;
      const lower = suns[k] as Rgb;
      expect(lower.g / lower.r).toBeLessThan(higher.g / higher.r);
      expect(lower.b / lower.r).toBeLessThan(higher.b / higher.r);
      expect(luma(lower)).toBeLessThan(luma(higher));
    }
    // From 200 m the horizon dips 0.45 degrees: a sun 0.25 degrees down still shines, one 0.5 down is gone.
    expect(sunTransmittance(tables, -0.25 * DEG).r).toBeGreaterThan(0);
    expect(sunTransmittance(tables, -0.5 * DEG)).toEqual({ r: 0, g: 0, b: 0 });
    expect(sunTransmittance(tables, -30 * DEG)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("the multiple scattering", () => {
  it("is finite and non-negative, and brighter under a high sun than in the earth's shadow", () => {
    expect(tables.multi.length).toBe(MULTI_SIZE * MULTI_SIZE * 3);
    expect(badValues(tables.multi, "multi")).toEqual([]);
    const day = multiAt(tables, SKY_GROUND_KM + 0.2, 1);
    const shadow = multiAt(tables, SKY_GROUND_KM + 0.2, -0.5);
    expect(luma(day)).toBeGreaterThan(luma(shadow));
    expect(luma(day)).toBeGreaterThan(0);
  });
});

describe("the sky's light", () => {
  it("lays a slice out as the dome reads it", () => {
    expect(noon.altitudeDeg).toBe(NOON_DEG);
    expect(noon.texels.length).toBe(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3);
    expect(noon.ring.length).toBe(SLICE_AZIMUTHS * 3);
    for (const [j, i] of [[0, 0], [20, 7], [33, 0], [40, 31], [63, 16]] as const) {
      const e = elevationOfRow(j / (SLICE_ELEVATIONS - 1));
      const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
      const expected = skyRadiance(tables, { x: Math.cos(e) * Math.cos(az), y: Math.sin(e), z: Math.cos(e) * Math.sin(az) }, NOON_DEG * DEG);
      const k = (j * SLICE_AZIMUTHS + i) * 3;
      expect(noon.texels[k]).toBeCloseTo(expected.r, 7);
      expect(noon.texels[k + 1]).toBeCloseTo(expected.g, 7);
      expect(noon.texels[k + 2]).toBeCloseTo(expected.b, 7);
    }
    const ring9 = skyRadiance(tables, dir(RING_ELEVATION_DEG, (180 * 9) / 31), NOON_DEG * DEG);
    expect(noon.ring[27]).toBeCloseTo(ring9.r, 7);
    expect(noon.ring[28]).toBeCloseTo(ring9.g, 7);
    expect(noon.ring[29]).toBeCloseTo(ring9.b, 7);
    const top = (SLICE_ELEVATIONS - 1) * SLICE_AZIMUTHS * 3;
    expect(noon.zenith).toEqual({ r: noon.texels[top], g: noon.texels[top + 1], b: noon.texels[top + 2] });
    expect(noon.skyIrradiance).toEqual(skyIrradianceOf(noon.texels));
    expect(noon.sun).toEqual(sunTransmittance(tables, NOON_DEG * DEG));
  });

  it("is blue at the zenith at noon", () => {
    expect(noon.zenith.b).toBeGreaterThan(noon.zenith.g);
    expect(noon.zenith.g).toBeGreaterThan(noon.zenith.r);
  });

  it("keeps the clear noon horizon 2 degrees up at most twice the zenith, at the smallest aerosol scale that does", () => {
    expect(horizonOverZenith(tables, noon)).toBeLessThanOrEqual(2);
    // On the 0.05 grid, from the standard atmosphere's 1 up: one step less and the horizon is over twice the zenith.
    expect(Math.abs(SKY_MIE_SCALE * 20 - Math.round(SKY_MIE_SCALE * 20))).toBeLessThan(1e-9);
    expect(SKY_MIE_SCALE).toBeGreaterThanOrEqual(1);
    const fewer = buildSkyTables(SKY_MIE_SCALE - 0.05);
    expect(horizonOverZenith(fewer, buildSlice(fewer, NOON_DEG))).toBeGreaterThan(2);
  });

  it("reads the ring at the horizon itself, where the clear noon horizon is 1.69 times the zenith", () => {
    expect(RING_ELEVATION_DEG).toBe(0);
    const ratio = luma(ringMean(noon.ring, 16, 31)) / luma(noon.zenith);
    expect(ratio).toBeGreaterThan(1.68);
    expect(ratio).toBeLessThan(1.69);
  });

  it("keeps a blue zenith at sunset, between 3 % and 15 % of noon's light", () => {
    expect(sunset.zenith.b).toBeGreaterThan(sunset.zenith.r);
    expect(sunset.zenith.b).toBeGreaterThan(sunset.zenith.g);
    const share = luma(sunset.zenith) / luma(noon.zenith);
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.15);
  });

  it("is red toward the sun at the horizon at sunset", () => {
    const toward = ringMean(sunset.ring, 0, 0);
    expect(toward.r).toBeGreaterThan(toward.g);
    expect(toward.r).toBeGreaterThan(toward.b);
  });

  it("dims at the zenith with every half degree the sun sinks, to below a millionth of noon at -18 degrees", () => {
    let previous = luma(skyRadiance(tables, UP, 0));
    for (let k = 1; k <= 36; k++) {
      const next = luma(skyRadiance(tables, UP, (-k / 2) * DEG));
      expect(next).toBeLessThan(previous);
      previous = next;
    }
    expect(previous / luma(noon.zenith)).toBeLessThan(1e-6);
    expect(luma(deep.zenith) / luma(noon.zenith)).toBeLessThan(1e-6);
  });

  it("is finite and non-negative everywhere: whole slices at noon, sunset and -18 degrees, and every slice altitude sampled, its ring whole", () => {
    const bad: string[] = [];
    for (const slice of [noon, sunset, deep]) {
      bad.push(...badValues(slice.texels, `texels at ${slice.altitudeDeg}`));
      bad.push(...badValues(slice.ring, `ring at ${slice.altitudeDeg}`));
      bad.push(...badValues([...rgbValues(slice.zenith), ...rgbValues(slice.skyIrradiance), ...rgbValues(slice.sun)], `derived at ${slice.altitudeDeg}`));
    }
    for (const altitude of SLICE_ALTITUDES_DEG) {
      const sampled: number[] = rgbValues(sunTransmittance(tables, altitude * DEG));
      // The ring grazes the horizon: every column of it, from the eye and from the ground, where a level ray is tangent to it.
      for (let i = 0; i < SLICE_AZIMUTHS; i++) {
        const along = dir(RING_ELEVATION_DEG, (180 * i) / (SLICE_AZIMUTHS - 1));
        sampled.push(...rgbValues(skyRadiance(tables, along, altitude * DEG)), ...rgbValues(skyRadiance(tables, along, altitude * DEG, 0)));
      }
      for (let j = 0; j < SLICE_ELEVATIONS; j += 7) {
        for (let i = 0; i < SLICE_AZIMUTHS; i += 5) {
          const e = elevationOfRow(j / (SLICE_ELEVATIONS - 1));
          const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
          sampled.push(...rgbValues(skyRadiance(tables, { x: Math.cos(e) * Math.cos(az), y: Math.sin(e), z: Math.cos(e) * Math.sin(az) }, altitude * DEG)));
        }
      }
      bad.push(...badValues(sampled, `samples at ${altitude}`));
    }
    expect(bad).toEqual([]);
  });

  it("gives no light along no direction, and reads a direction's length out", () => {
    expect(skyRadiance(tables, { x: 0, y: 0, z: 0 }, NOON_DEG * DEG)).toEqual({ r: 0, g: 0, b: 0 });
    const long = skyRadiance(tables, { x: 0, y: 3, z: 0 }, NOON_DEG * DEG);
    const unit = skyRadiance(tables, UP, NOON_DEG * DEG);
    expect(long.r).toBeCloseTo(unit.r, 12);
    expect(long.b).toBeCloseTo(unit.b, 12);
  });

  /**
   * The eye is fixed at 200 m, while the world's relief reaches several
   * hundred metres. Raising the eye 1 km leaves e^(-1/8) = 0.88 of the air's
   * Rayleigh column above it and e^(-1/1.2) = 0.43 of its aerosols: the
   * lowest kilometre holds most of the haze, so no direction's light can move
   * by more than that column's factor, e^(1/1.2) = 2.30. The sun's own light
   * near the horizon is the exception (its path through the haze changes many
   * times over), so it is held to the bound only from 10 degrees up; so is the
   * horizon toward a sun at or below it, whose light comes to the eye along
   * the same grazing path (from the ground it is 5.9 times as bright at 0
   * degrees, 2.6 at -3, 2.5 at -6).
   */
  it("changes by less than the aerosols' column factor between eye heights of 0 and 1 km", () => {
    for (const altitude of [NOON_DEG, 30, 10, 2, 0, -3, -6, -12]) {
      const horizon = altitude > 0 ? [0, 90, 180] : [90, 180];
      for (const d of [UP, ...horizon.map((az) => dir(RING_ELEVATION_DEG, az))]) {
        const ratio = luma(skyRadiance(tables, d, altitude * DEG, 1)) / luma(skyRadiance(tables, d, altitude * DEG, 0));
        expect(ratio).toBeGreaterThan(1 / 2.3);
        expect(ratio).toBeLessThan(2.3);
      }
    }
    for (const altitude of [NOON_DEG, 30, 10]) {
      const ratio = luma(sunTransmittance(tables, altitude * DEG, 1)) / luma(sunTransmittance(tables, altitude * DEG, 0));
      expect(ratio).toBeGreaterThan(1 / 2.3);
      expect(ratio).toBeLessThan(2.3);
    }
  });
});

describe("the sky's light on level ground", () => {
  const field = (f: (e: number, az: number) => number): Float32Array => {
    const texels = new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3);
    for (let j = 0; j < SLICE_ELEVATIONS; j++) {
      for (let i = 0; i < SLICE_AZIMUTHS; i++) {
        const v = f(elevationOfRow(j / (SLICE_ELEVATIONS - 1)), azimuthOfColumn(i / (SLICE_AZIMUTHS - 1)));
        texels.fill(v, (j * SLICE_AZIMUTHS + i) * 3, (j * SLICE_AZIMUTHS + i) * 3 + 3);
      }
    }
    return texels;
  };

  it("integrates a uniform sky to PI and a sky of radiance sin(e) to 2 PI / 3, within half a percent", () => {
    expect(Math.abs(skyIrradianceOf(field(() => 1)).g / Math.PI - 1)).toBeLessThan(0.005);
    expect(Math.abs(skyIrradianceOf(field((e) => Math.max(0, Math.sin(e)))).g / ((2 * Math.PI) / 3) - 1)).toBeLessThan(0.005);
  });

  it("counts both mirrored halves of the azimuth and nothing below the horizon", () => {
    // 1 + cos(azimuth) over the full circle averages 1: the same light as a uniform sky.
    const uniform = skyIrradianceOf(field(() => 1)).g;
    expect(skyIrradianceOf(field((_, az) => 1 + Math.cos(az))).g).toBeCloseTo(uniform, 6);
    expect(skyIrradianceOf(field((e) => (e < 0 ? 1 : 0)))).toEqual({ r: 0, g: 0, b: 0 });
  });
});
