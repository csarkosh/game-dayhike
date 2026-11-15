import { describe, it, expect } from "vitest";
import {
  CLOUD_CHASE_DENSITY, CLOUD_GROUND_SIZE, CLOUD_GROUND_SPAN, CLOUD_HAUNT_HEIGHT_M, CLOUD_HEIGHT_M, CLOUD_NIGHT_DENSITY, CLOUD_NOISE_SIZE, cloudColourUnder,
  cloudDensityUnder, cloudGroundMap, cloudHeightUnder, cloudNoiseMap,
  CLOUD_GLOW, CLOUD_GLOW_POWER, CLOUD_MARCH_FLOOR, CLOUD_NEAR_M, CLOUD_NOISE_LARGE_M, CLOUD_NOISE_SMALL_M, CLOUD_RANGE, CLOUD_SEAT,
  CLOUD_SIGMA, CLOUD_TRAIL_SHARE, CLOUD_WIND_MPS,
  cloudFor, cloudMarchSteps, cloudOn, cloudUniforms, emptyCloudUniforms, noCloud, writeCloudGround,
  CLOUD_GROUND_REBUILD_M, CLOUD_STEPS_HIGH, CLOUD_STEPS_MEDIUM, cloudDensityNow, cloudGroundDue, cloudStepsFor,
} from "../../src/game/cloudParams.js";
import { postFeaturesFor } from "../../src/game/postParams.js";

describe("the ground cloud's density", () => {
  it("is the night's with no haunt on, lifted by the haunt, the chase's by its cast, and nothing by day", () => {
    expect(cloudDensityUnder(0, 1, 1)).toBe(0);
    expect(cloudDensityUnder(1, 0, 0)).toBeCloseTo(CLOUD_NIGHT_DENSITY, 9);
    expect(cloudDensityUnder(1, 1, 0)).toBeGreaterThan(CLOUD_NIGHT_DENSITY);
    expect(cloudDensityUnder(1, 1, 0)).toBeLessThan(CLOUD_CHASE_DENSITY);
    expect(cloudDensityUnder(1, 0, 1)).toBeCloseTo(CLOUD_CHASE_DENSITY, 9);
    expect(cloudDensityUnder(0.5, 0, 0)).toBeCloseTo(CLOUD_NIGHT_DENSITY * 0.5, 9);
  });
});

describe("the cloud as a frame is handed it", () => {
  it("draws the held level whatever the night, else the night's by how far the mist has come in", () => {
    expect(cloudDensityNow(0.7, 0, 0, 0, 0)).toBe(0.7);
    expect(cloudDensityNow(0, 1, 1, 1, 1)).toBe(0);
    expect(cloudDensityNow(null, 1, 0.5, 0.25, 1)).toBe(cloudDensityUnder(1, 0.5, 0.25));
    expect(cloudDensityNow(null, 1, 0.5, 0.25, 0.4)).toBe(cloudDensityUnder(1, 0.5, 0.25) * 0.4);
    expect(cloudDensityNow(null, 1, 1, 1, 0)).toBe(0);
  });

  it("marches on the tiers with a post chain, in more steps where the chain has its halation", () => {
    expect(cloudStepsFor(postFeaturesFor("low", true))).toBe(0);
    expect(cloudStepsFor(postFeaturesFor("medium", true))).toBe(CLOUD_STEPS_MEDIUM);
    expect(cloudStepsFor(postFeaturesFor("high", true))).toBe(CLOUD_STEPS_HIGH);
    // No chain where the device cannot run it, on any tier.
    expect(cloudStepsFor(postFeaturesFor("high", false))).toBe(0);
  });

  it("builds the ground's map at first, then once the eye is past the rebuild distance from its centre", () => {
    expect(cloudGroundDue(null, 0, 0)).toBe(true);
    const at = { x: 100, z: -40 };
    expect(cloudGroundDue(at, 100, -40)).toBe(false);
    expect(cloudGroundDue(at, 100 + CLOUD_GROUND_REBUILD_M, -40)).toBe(false);
    expect(cloudGroundDue(at, 100 + CLOUD_GROUND_REBUILD_M + 0.01, -40)).toBe(true);
    expect(cloudGroundDue(at, 100 + 12, -40 - 12)).toBe(true);
  });
});

describe("the cloud's height", () => {
  it("stands taller with the haunt, from its own height to that plus the haunt's", () => {
    expect(cloudHeightUnder(0)).toBe(CLOUD_HEIGHT_M);
    expect(cloudHeightUnder(1)).toBe(CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M);
    // At a full haunt the mist thins to 1/e at the figure's own height, 5.4 m.
    expect(cloudHeightUnder(1)).toBeCloseTo(5.4, 9);
    expect(cloudHeightUnder(0.5)).toBeCloseTo(CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M / 2, 9);
    expect(cloudHeightUnder(3)).toBe(CLOUD_HEIGHT_M + CLOUD_HAUNT_HEIGHT_M);
  });
});

describe("the cloud's colour", () => {
  it("is the air's near colour pulled toward grey and lifted", () => {
    const c = cloudColourUnder({ r: 0.1, g: 0.2, b: 0.4 });
    // Less saturated than the air, and brighter in sum.
    expect(c.b - c.r).toBeLessThan(0.3 * 1.35);
    expect(c.r + c.g + c.b).toBeGreaterThan(0.7);
    const grey = cloudColourUnder({ r: 0.2, g: 0.2, b: 0.2 });
    expect(grey.r).toBeCloseTo(grey.g, 9);
    expect(grey.g).toBeCloseTo(grey.b, 9);
  });
});

describe("the cloud's noise", () => {
  it("is RGBA8 of its size, each channel spanning 0 to 255, tiling at its edges, and the two channels differ", () => {
    const n = cloudNoiseMap();
    expect(n.length).toBe(CLOUD_NOISE_SIZE * CLOUD_NOISE_SIZE * 4);
    for (const ch of [0, 1]) {
      let lo = 255, hi = 0;
      for (let i = 0; i < CLOUD_NOISE_SIZE * CLOUD_NOISE_SIZE; i++) {
        lo = Math.min(lo, n[i * 4 + ch]!);
        hi = Math.max(hi, n[i * 4 + ch]!);
      }
      expect(lo).toBe(0);
      expect(hi).toBe(255);
    }
    // Tiling: the last column is close to the first (the lattice wraps), never a seam.
    const S = CLOUD_NOISE_SIZE;
    let seam = 0;
    for (let y = 0; y < S; y++) seam += Math.abs(n[(y * S + S - 1) * 4]! - n[(y * S) * 4]!);
    expect(seam / S).toBeLessThan(24);
    let differ = 0;
    for (let i = 0; i < S * S; i++) if (Math.abs(n[i * 4]! - n[i * 4 + 1]!) > 8) differ++;
    expect(differ).toBeGreaterThan((S * S) / 2);
    for (let i = 0; i < S * S; i++) expect(n[i * 4 + 3]).toBe(255);
  });
});

describe("the ground map", () => {
  it("samples the ground over its span round a centre, the lowest at 0 and the highest at 255, with its base and range", () => {
    const ground = (x: number, z: number) => 0.1 * x + 0.05 * z + 3;
    const g = cloudGroundMap(ground, 100, -50);
    expect(g.data.length).toBe(CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE * 4);
    expect(g.centreX).toBe(100);
    expect(g.centreZ).toBe(-50);
    const half = CLOUD_GROUND_SPAN / 2, cell = CLOUD_GROUND_SPAN / CLOUD_GROUND_SIZE;
    const lo = ground(100 - half + cell / 2, -50 - half + cell / 2);
    const hi = ground(100 + half - cell / 2, -50 + half - cell / 2);
    expect(g.base).toBeCloseTo(lo, 9);
    expect(g.range).toBeCloseTo(hi - lo, 9);
    expect(g.data[0]).toBe(0);
    expect(g.data[(CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE - 1) * 4]).toBe(255);
    // The middle of the map is the centre's height, to the byte.
    const mid = (CLOUD_GROUND_SIZE / 2) * CLOUD_GROUND_SIZE + CLOUD_GROUND_SIZE / 2;
    const expected = ((ground(100 + cell / 2, -50 + cell / 2) - lo) / (hi - lo)) * 255;
    expect(Math.abs(g.data[mid * 4]! - expected)).toBeLessThanOrEqual(1);
    // Flat ground: a range of at least 1 m, so the shader never divides a step by nothing.
    expect(cloudGroundMap(() => 7, 0, 0).range).toBe(1);
    // With no trail, every place is off it (A 255); with one, the alpha is 0 on it and rises to 255 beyond its edge's fade.
    expect(g.data[3]).toBe(255);
    const t = cloudGroundMap(() => 0, 0, 0, (x) => Math.abs(x));
    const col = (x: number) => Math.round(((x + CLOUD_GROUND_SPAN / 2) / CLOUD_GROUND_SPAN) * CLOUD_GROUND_SIZE - 0.5);
    const row = CLOUD_GROUND_SIZE / 2;
    const alphaAt = (x: number) => t.data[(row * CLOUD_GROUND_SIZE + col(x)) * 4 + 3]!;
    expect(alphaAt(0)).toBeLessThan(5);
    expect(alphaAt(2)).toBeGreaterThan(0);
    expect(alphaAt(2)).toBeLessThan(255);
    expect(alphaAt(20)).toBe(255);
  });
});

describe("the cloud for a frame", () => {
  const near = { r: 0.02, g: 0.03, b: 0.05 };

  it("starts as no cloud over no ground", () => {
    expect(noCloud()).toEqual({ density: 0, steps: 0, haunt: 0, seconds: 0, colour: { r: 0, g: 0, b: 0 }, ground: { centreX: 0, centreZ: 0, base: 0, range: 1 } });
    expect(noCloud()).not.toBe(noCloud());
  });

  it("takes its density and the haunt held to [0, 1], the tier's steps, the clock and its colour under the air's near colour, and keeps its ground", () => {
    const ground = cloudGroundMap((x) => 100 + x * 0.1, 40, -60);
    const on = cloudOn(noCloud(), ground);
    expect(on.ground).toEqual({ centreX: 40, centreZ: -60, base: ground.base, range: ground.range });
    const c = cloudFor(on, 0.8, 8, 12.5, 0.4, near);
    expect(c).toEqual({ density: 0.8, steps: 8, haunt: 0.4, seconds: 12.5, colour: cloudColourUnder(near), ground: on.ground });
    expect(cloudFor(on, 3, 12, 0, -1, near)).toMatchObject({ density: 1, haunt: 0 });
    expect(cloudFor(on, -3, 12, 0, 7, near)).toMatchObject({ density: 0, haunt: 1 });
    // A new state each time: the one before is left as it was.
    expect(on.density).toBe(0);
  });

  it("lays its ground into the map's blue and alpha, beside the noise", () => {
    const map = cloudNoiseMap();
    const noise = map.slice();
    const ground = cloudGroundMap((x, z) => x + z, 0, 0, (x) => Math.abs(x));
    writeCloudGround(map, ground);
    for (const i of [0, 77, CLOUD_GROUND_SIZE * CLOUD_GROUND_SIZE - 1]) {
      expect([map[i * 4], map[i * 4 + 1]], `noise ${i}`).toEqual([noise[i * 4], noise[i * 4 + 1]]);
      expect([map[i * 4 + 2], map[i * 4 + 3]], `ground ${i}`).toEqual([ground.data[i * 4], ground.data[i * 4 + 3]]);
    }
  });

  it("is marched in the tier's steps where it has density, and not at all at or under the floor", () => {
    expect(CLOUD_MARCH_FLOOR).toBe(0.002);
    expect(cloudMarchSteps(cloudFor(noCloud(), 0.3, 8, 0, 0, near))).toBe(8);
    expect(cloudMarchSteps(cloudFor(noCloud(), 0.002, 8, 0, 0, near))).toBe(0);
    expect(cloudMarchSteps(cloudFor(noCloud(), 0, 12, 0, 0, near))).toBe(0);
  });
});

describe("the cloud's uniforms", () => {
  const near = { r: 0.02, g: 0.03, b: 0.05 };
  const ground = cloudGroundMap((x) => 100 + x * 0.1, 40, -60);
  const c = cloudFor(cloudOn(noCloud(), ground), 0.8, 8, 100, 0.5, near);

  it("are its density, reach, height and ground, the noise's scales and the wind's drift, by name", () => {
    const wind = (100 * CLOUD_WIND_MPS) / CLOUD_NOISE_LARGE_M;
    const colour = cloudColourUnder(near);
    expect(cloudUniforms(c, 8)).toEqual({
      atmCloudDensity: [CLOUD_SIGMA * 0.8],
      atmCloudSteps: [8],
      atmCloudRange: [CLOUD_RANGE],
      atmCloudFalloff: [1 / cloudHeightUnder(0.5)],
      atmCloudSeat: [CLOUD_SEAT],
      atmCloudGroundRange: [ground.range],
      atmCloudNear: [CLOUD_NEAR_M],
      atmCloudTrail: [CLOUD_TRAIL_SHARE],
      atmCloudNoiseScale: [1 / CLOUD_NOISE_LARGE_M, 1 / CLOUD_NOISE_SMALL_M],
      atmCloudWind: [wind % 1, (wind * 0.6) % 1],
      atmCloudGlow: [CLOUD_GLOW, CLOUD_GLOW_POWER],
      atmCloudColour: [colour.r, colour.g, colour.b],
      atmCloudGroundRect: [40, -60, 1 / CLOUD_GROUND_SPAN, ground.base],
    });
    // The wind's drift is in tiles, folded: 100 s at 0.35 m/s over an 11 m tile is 3.18 tiles.
    expect(cloudUniforms(c, 8).atmCloudWind[0]).toBeCloseTo(0.1818, 4);
  });

  it("take the steps they are handed, whatever the state's: none where the cloud is drawn elsewhere", () => {
    expect(cloudUniforms(c, 0).atmCloudSteps).toEqual([0]);
    expect(cloudUniforms(c, 0).atmCloudDensity).toEqual([CLOUD_SIGMA * 0.8]);
  });

  it("fill the record handed in", () => {
    const out = emptyCloudUniforms();
    expect(cloudUniforms(c, 8, out)).toBe(out);
    expect(out).toEqual(cloudUniforms(c, 8));
    cloudUniforms(noCloud(), 0, out);
    expect(out).toEqual(cloudUniforms(noCloud(), 0));
  });
});
