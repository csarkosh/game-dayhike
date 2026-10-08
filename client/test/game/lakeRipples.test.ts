// client/test/game/lakeRipples.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PAW_FEATURE_M, PAW_SPEED, PAW_EDGE_M, PAW_LIFE_S, PAW_GUST_FLOOR,
  LAKE_RING_REACH, LAKE_RING_FADE_M, LAKE_RING_CELL, LAKE_RING_SPEED, LAKE_RING_LAMBDA, LAKE_RING_TAU, LAKE_RING_AMP,
  LAKE_RINGS_PER_M2, LAKE_RAIN_MM_H, LAKE_RING_FOLD, LAKE_WIND_TURN,
  lakeGust, lakePawDrift, lakePaw, octaveAmplitude, lakeLiveRings, lakeRingHeight, lakeRingDh, lakeRingHash, lakeRainSlope,
} from "../../src/game/lakeRipples.js";
import {
  WIND_TIME_WRAP, WIND_K1, WIND_K2, WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_RAGGED, WIND_RAGGED_CELL,
  directionAt, gustAt, windRecordUnder,
} from "../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const glsl = source("../../src/game/shaders/lakeRipples.fragment.fx");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** A top-level GLSL function's body: from its signature's brace to the closing brace on a line of its own. */
function body(text: string, signature: string): string {
  const start = text.indexOf(signature);
  expect(start, signature).toBeGreaterThan(-1);
  return text.slice(text.indexOf("{", start) + 1, text.indexOf("\n}\n", start));
}

/** The wind's direction the paws are tested under: (0.6, 0.8). */
const DX = 0.6;
const DZ = 0.8;

/** The share of a 200 m square (1 m apart) the paws cover at the lake's time 120 s. */
function coveredShare(cover: number, gust: number): number {
  let sum = 0;
  for (let x = 0; x < 200; x++) for (let z = 0; z < 200; z++) sum += lakePaw(x + 0.37, z + 0.61, 120, DX, DZ, cover, gust);
  return sum / 40000;
}

describe("the lake's ripples' constants", () => {
  it("are the design's", () => {
    expect([PAW_FEATURE_M, PAW_SPEED, PAW_EDGE_M, PAW_LIFE_S, PAW_GUST_FLOOR]).toEqual([10, 1.5, 0.5, 6, 0.5]);
    expect([LAKE_RING_REACH, LAKE_RING_FADE_M, LAKE_RING_CELL, LAKE_RING_SPEED, LAKE_RING_LAMBDA, LAKE_RING_TAU, LAKE_RING_AMP])
      .toEqual([8, 2, 0.18, 0.18, 0.03, 0.3, 0.004]);
    expect(LAKE_RINGS_PER_M2).toEqual([35, 77, 150]);
    expect([LAKE_RAIN_MM_H, LAKE_RING_FOLD]).toEqual([4, 512]);
    expect(LAKE_WIND_TURN).toBeCloseTo(0.005235987755982988, 15);
    // every rate a whole number of cycles in the wind's wrap, so the wrap moves no paw and no ring
    expect(WIND_TIME_WRAP / PAW_LIFE_S).toBe(50);
  });

  it("are every const float of the GLSL, in lockstep with lakeRipples.ts and windParams.ts", () => {
    const mirrored: Record<string, number> = {
      PAW_FEATURE_M, PAW_SPEED, PAW_EDGE_M, PAW_LIFE_S, PAW_GUST_FLOOR,
      LAKE_RING_REACH, LAKE_RING_FADE_M, LAKE_RING_CELL, LAKE_RING_SPEED, LAKE_RING_LAMBDA, LAKE_RING_TAU, LAKE_RING_AMP,
      LAKE_RINGS_0: LAKE_RINGS_PER_M2[0], LAKE_RINGS_1: LAKE_RINGS_PER_M2[1], LAKE_RINGS_2: LAKE_RINGS_PER_M2[2],
      LAKE_RAIN_MM_H, LAKE_RING_FOLD, LAKE_WIND_TURN,
      LAKE_TIME_WRAP: WIND_TIME_WRAP, LAKE_WIND_K1: WIND_K1, LAKE_WIND_K2: WIND_K2,
      LAKE_WIND_OMEGA1: WIND_OMEGA_GUST, LAKE_WIND_OMEGA2: WIND_OMEGA_GUST2,
      LAKE_WIND_RAGGED: WIND_RAGGED, LAKE_WIND_RAGGED_CELL: WIND_RAGGED_CELL,
    };
    const declared = [...glsl.matchAll(/^const float (\w+) = ([^;]+);$/gm)].map((m) => [m[1] as string, m[2] as string] as const);
    expect(declared.map(([name]) => name).sort()).toEqual(Object.keys(mirrored).sort());
    for (const [name, value] of declared) expect(value, name).toBe(glslFloat(mirrored[name] as number));
  });

  it("declare each GLSL function its twin mirrors, and the hashes and the gust line for line as theirs", () => {
    for (const signature of [
      "float lakeGust(vec2 p, float t, vec2 dir)",
      "float lakeHash(float i, float s)",
      "vec2 lakePawDrift(vec2 dir, float span)",
      "float lakePaw(vec2 xz, float t, vec2 windDir, float cover, float gust)",
      "float octaveAmplitude(float paw)",
      "float lakeLiveRings(float rate)",
      "float lakeRingDh(float r, float age)",
      "vec2 lakeRingHash(vec2 p)",
      "vec2 lakeRainSlope(vec2 xz, float t, float rate, float dist)",
    ]) expect(glsl).toContain(`${signature} {`);
    // the trees' gust, foliage.vertex.fx's, with the lake's names for its constants and its wind
    const foliage = body(source("../../src/game/shaders/foliage.vertex.fx"), "float foliageGust(vec2 p, float t)");
    expect(body(glsl, "float lakeGust(vec2 p, float t, vec2 dir)").replace(/LAKE_WIND_/g, "WIND_").replace(/\bdir\./g, "windDir."))
      .toBe(foliage);
    // Hoskins' hash as the midges' (midge.vertex.fx) and the splashes' (rainSplash.ts) are
    expect(body(glsl, "float lakeHash(float i, float s)")).toBe(body(source("../../src/game/shaders/midge.vertex.fx"), "float midgeHash(float i, float s)"));
    expect(body(glsl, "vec2 lakeRingHash(vec2 p)")).toBe(body(source("../../src/game/rainSplash.ts"), "vec2 splashHash(vec2 p)"));
    // no test on a varying: the branches are chosen by step, mix, clamp and smoothstep
    expect(glsl).not.toMatch(/\bif\s*\(/);
    expect(glsl).not.toContain("?");
    expect(glsl.endsWith("}\n")).toBe(true);
  });
});

describe("the gust and the drift", () => {
  it("is the trees' gust, gustAt's, at the lake's time", () => {
    const record = windRecordUnder(WEATHER_PRESETS.clear, 42);
    expect(lakeGust(12.5, -7.25, record.time, record.dirX, record.dirZ)).toBe(gustAt(record, 12.5, -7.25));
    expect(lakeGust(12.5, -7.25, 42, DX, DZ)).toBeCloseTo(0.2107274169504333, 12);
  });

  it("drifts the paws at PAW_SPEED along the wind of the moment, the wind turning", () => {
    // The drift over the wrap so far, read with the wind's direction at that moment: its rate is
    // 1.5 m/s along the wind, at t = 250 s along (-0.33179, 0.94335).
    const drift = (t: number): [number, number] => {
      const d = directionAt(t);
      return lakePawDrift(d.x, d.z, t);
    };
    const h = 1e-3;
    const a = drift(250 - h);
    const b = drift(250 + h);
    expect((b[0] - a[0]) / (2 * h)).toBeCloseTo(-0.4976852579, 6);
    expect((b[1] - a[1]) / (2 * h)).toBeCloseTo(1.4150298174, 6);
    // two seconds of it under a wind along (0.6, 0.8): 3 m, bent a little by the turn
    const two = lakePawDrift(DX, DZ, 2);
    expect(two[0]).toBeCloseTo(1.812533357275764, 12);
    expect(two[1]).toBeCloseTo(2.39053144349953, 12);
    expect(lakePawDrift(DX, DZ, 0)).toEqual([0, 0]);
  });
});

describe("the cat's-paws", () => {
  it("are nowhere at cover 0, whatever the gust and the hour", () => {
    for (const t of [0, 120, 299])
      for (const gust of [-1.5, 0, 1, 1.5])
        for (let x = -40; x <= 40; x += 3.7)
          for (let z = -40; z <= 40; z += 4.1) expect(lakePaw(x, z, t, DX, DZ, 0, gust)).toBe(0);
  });

  it("are everywhere inside a feature at cover 1 under a gust, and in the edge at cover 0.5 where the field crosses it", () => {
    for (const [x, z] of [[0, 0], [12.5, -7.25], [40, 33], [-18, 96]] as const) {
      expect(lakePaw(x, z, 120, DX, DZ, 1, 1)).toBe(1);
    }
    expect(lakePaw(12.5, -7.25, 120, DX, DZ, 0.5, 1)).toBeCloseTo(0.2839055388705209, 9);
    expect(lakePaw(0, 0, 120, DX, DZ, 0.5, 1)).toBe(1);
    expect(lakePaw(-18, 96, 120, DX, DZ, 0.5, 1)).toBe(0);
  });

  it("cover more of the lake as the cover rises, and more under a gust than without one", () => {
    expect(coveredShare(0.25, 1)).toBeCloseTo(0.0976, 3);
    expect(coveredShare(0.5, 1)).toBeCloseTo(0.4784, 3);
    expect(coveredShare(0.75, 1)).toBeCloseTo(0.8929, 3);
    expect(coveredShare(1, 1)).toBeCloseTo(1, 3);
    // without a gust the field is halved: none at half cover, and three quarters' cover is half's under a gust
    expect(coveredShare(0.5, 0)).toBe(0);
    expect(coveredShare(0.75, 0)).toBeCloseTo(0.4784, 3);
    // a lull is no gust: a negative gust is no less than none
    expect(lakePaw(12.5, -7.25, 120, DX, DZ, 0.9, -1.5)).toBe(lakePaw(12.5, -7.25, 120, DX, DZ, 0.9, 0));
  });

  it("have an edge PAW_EDGE_M wide: the mask climbs 1 / PAW_EDGE_M a metre across it", () => {
    const climbs: number[] = [];
    const h = 1e-4;
    const at = (x: number, z: number): number => lakePaw(x, z, 120, DX, DZ, 0.5, 1);
    for (let x = 0; x < 100; x += 0.37) {
      for (let z = 0; z < 100; z += 0.53) {
        const p = at(x, z);
        if (p <= 0.2 || p >= 0.8) continue;
        climbs.push(Math.hypot((at(x + h, z) - at(x - h, z)) / (2 * h), (at(x, z + h) - at(x, z - h)) / (2 * h)));
      }
    }
    climbs.sort((a, b) => a - b);
    expect(climbs.length).toBeGreaterThan(1000);
    const median = climbs[Math.floor(climbs.length / 2)] as number;
    expect(median).toBeGreaterThan(1.9);
    expect(median).toBeLessThan(2.1);
  });

  it("live PAW_LIFE_S: a patch returns, carried by its drift, one life later, and differs half a life on", () => {
    let differs = 0;
    for (const [x, z] of [[0, 0], [12.5, -7.25], [40, 33], [-18, 96], [7.7, 21.3]] as const) {
      const [ax, az] = lakePawDrift(DX, DZ, 100);
      const [bx, bz] = lakePawDrift(DX, DZ, 100 + PAW_LIFE_S);
      expect(lakePaw(x + bx - ax, z + bz - az, 100 + PAW_LIFE_S, DX, DZ, 0.5, 1)).toBeCloseTo(lakePaw(x, z, 100, DX, DZ, 0.5, 1), 9);
      const [cx, cz] = lakePawDrift(DX, DZ, 100 + PAW_LIFE_S / 2);
      differs += Math.abs(lakePaw(x + cx - ax, z + cz - az, 100 + PAW_LIFE_S / 2, DX, DZ, 0.5, 1) - lakePaw(x, z, 100, DX, DZ, 0.5, 1));
    }
    expect(differs).toBeGreaterThan(0.5);
  });

  it("run on through the wrap of the lake's time", () => {
    let jump = 0;
    for (let x = 0; x < 50; x += 1.3) {
      for (let z = 0; z < 50; z += 1.7) {
        jump = Math.max(jump, Math.abs(lakePaw(x, z, WIND_TIME_WRAP - 1e-6, DX, DZ, 0.5, 1) - lakePaw(x, z, 0, DX, DZ, 0.5, 1)));
      }
    }
    expect(jump).toBeLessThan(1e-3);
  });

  it("silence the octaves on glass and run them whole in a paw", () => {
    expect(octaveAmplitude(0)).toBe(0);
    expect(octaveAmplitude(0.25)).toBe(0.15625);
    expect(octaveAmplitude(0.5)).toBe(0.5);
    expect(octaveAmplitude(1)).toBe(1);
  });
});

describe("the rain's rings on the lake", () => {
  it("count the live rings a square metre by the rain: 35 at 0.5 mm/h, 77 at 1, 150 from 2", () => {
    expect([0, 0.0625, 0.125, 0.25, 0.375, 0.5, 1].map(lakeLiveRings)).toEqual([0, 17.5, 35, 77, 113.5, 150, 150]);
  });

  it("have their front at LAKE_RING_SPEED × age, nothing ahead of it", () => {
    // half a second after the drop the front is 9 cm out
    for (let r = 0.09; r < 0.3; r += 0.005) {
      expect(Math.abs(lakeRingHeight(r, 0.5))).toBe(0);
      expect(Math.abs(lakeRingDh(r, 0.5))).toBe(0);
    }
    expect(lakeRingHeight(0.085, 0.5)).toBeCloseTo(-0.000048465502285163844, 15);
    expect(lakeRingHeight(0.08, 0.5)).toBeCloseTo(-0.00016962925799807424, 15);
  });

  it("die over LAKE_RING_TAU: the same place behind the front is e^-1 as high a τ later", () => {
    expect(lakeRingHeight(0.6 * LAKE_RING_SPEED - 0.0123, 0.6) / lakeRingHeight(0.3 * LAKE_RING_SPEED - 0.0123, 0.3)).toBeCloseTo(0.36787944117144, 12);
  });

  it("take their slope as the height's derivative, in closed form", () => {
    let worst = 0;
    for (let r = 0.001; r < 0.2; r += 0.0013) {
      for (const age of [0.1, 0.4, 0.8]) {
        const numeric = (lakeRingHeight(r + 1e-7, age) - lakeRingHeight(r - 1e-7, age)) / 2e-7;
        worst = Math.max(worst, Math.abs(numeric - lakeRingDh(r, age)));
      }
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it("hash their cells as the splashes do", () => {
    expect(lakeRingHash(0, 0)).toEqual([0, 0]);
    const [a, b] = lakeRingHash(3, 7);
    expect(a).toBeCloseTo(0.2912651855262993, 9);
    expect(b).toBeCloseTo(0.5587030313431569, 9);
  });

  it("tilt the normal near the eye in rain, scaled by the live rings and faded out by LAKE_RING_REACH", () => {
    const [x, z, t] = [1.25, 5.6, 42.3];
    const full = lakeRainSlope(x, z, t, 1, 2);
    expect(full[0]).toBeCloseTo(0.016957453558010916, 12);
    expect(full[1]).toBeCloseTo(0.016886605192416897, 12);
    // 0.25 mm/h: 17.5 live rings a square metre of 77
    const light = lakeRainSlope(x, z, t, 0.0625, 2);
    expect(light[0]).toBeCloseTo(0.0038539667177297536, 12);
    expect(light[1]).toBeCloseTo(0.0038378648164583856, 12);
    // halfway through the fade
    const fading = lakeRainSlope(x, z, t, 1, 7);
    expect(fading[0]).toBeCloseTo(0.008478726779005458, 12);
    expect(fading[1]).toBeCloseTo(0.008443302596208449, 12);
    // no rain, and at and beyond the reach: nothing
    for (const [rate, dist] of [[0, 2], [1, 8], [1, 9], [0, 9]] as const) {
      expect(lakeRainSlope(x, z, t, rate, dist).map(Math.abs)).toEqual([0, 0]);
    }
  });

  it("tilt the lake by nothing on the whole: zero mean slope over a square of five cells a side", () => {
    let mx = 0;
    let mz = 0;
    let squares = 0;
    let n = 0;
    for (let x = 0; x < 0.9; x += 0.002) {
      for (let z = 0; z < 0.9; z += 0.002) {
        const [sx, sz] = lakeRainSlope(10 + x, 20 + z, 42.3, 1, 2);
        mx += sx;
        mz += sz;
        squares += sx * sx + sz * sz;
        n++;
      }
    }
    expect(Math.sqrt(squares / n)).toBeGreaterThan(0.05);
    expect(Math.abs(mx / n)).toBeLessThan(1e-3);
    expect(Math.abs(mz / n)).toBeLessThan(1e-3);
  });

  it("move no ring across the wrap of the lake's time", () => {
    let jump = 0;
    for (let x = 1; x < 3; x += 0.013) {
      for (let z = 1; z < 3; z += 0.017) {
        const a = lakeRainSlope(x, z, WIND_TIME_WRAP - 1e-9, 1, 2);
        const b = lakeRainSlope(x, z, 0, 1, 2);
        jump = Math.max(jump, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
      }
    }
    expect(jump).toBeLessThan(1e-4);
  });
});
