import { describe, it, expect } from "vitest";
import {
  atmosphereUnder, atmosphereUniforms, emptyAtmosphereUniforms, fogGradientAt, fogGradientUnder, heightFogAmount, GRADIENT_MID_STEP, GRADIENT_STEPS,
} from "../../src/game/atmosphereParams.js";
import { cloudFor, cloudUniforms, noCloud } from "../../src/game/cloudParams.js";
import { WEATHER_PRESETS, airColourUnder, fogDensityUnder } from "../../src/game/weather.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { skyFixture } from "../../testing/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;
const MIST = WEATHER_PRESETS.mist;
const EERIE = WEATHER_PRESETS.eerie;
const table = skyFixture();

describe("the fog gradient", () => {
  it("has 256 entries, its far end the sky state's mist air and its near end that, dimmed", () => {
    expect(GRADIENT_STEPS).toBe(256);
    const sky = skyStateFor(table, 12, MIST);
    const g = fogGradientUnder(MIST, sky);
    expect(g.length).toBe(256);
    expect(g[255]).toEqual(sky.mistAir);
    // GRADIENT_NEAR_DIM: the air close by is denser and darker.
    expect(g[0]!.r).toBeCloseTo(sky.mistAir.r * 0.85, 12);
    expect(g[0]!.g).toBeCloseTo(sky.mistAir.g * 0.85, 12);
    expect(g[0]!.b).toBeCloseTo(sky.mistAir.b * 0.85, 12);
  });

  it("reads one step as the list holds it: the middle the mist banks take, the near end the motes take", () => {
    expect(GRADIENT_MID_STEP).toBe(128);
    for (const [hour, weather] of [[12, MIST], [18.25, CLEAR], [22, EERIE]] as const) {
      const sky = skyStateFor(table, hour, weather);
      const g = fogGradientUnder(weather, sky);
      for (const step of [0, 1, GRADIENT_MID_STEP, 254, 255]) expect(fogGradientAt(sky, step), `hour ${hour} step ${step}`).toEqual(g[step]);
    }
  });

  it("at clear ends exactly on the dome's horizon away from the sun, at every hour the sky is read at", () => {
    for (const hour of [6, 8, 12, 15, 17, 18, 18.25, 18.5, 19, 21]) {
      const sky = skyStateFor(table, hour, CLEAR);
      expect(fogGradientUnder(CLEAR, sky)[255], `hour ${hour}`).toEqual(sky.horizonAway);
    }
  });
});

describe("atmosphereUnder", () => {
  it("at clear keeps the base density and the lowest height fog, and takes its glow from the sky state", () => {
    const sky = skyStateFor(table, 17, CLEAR);
    const a = atmosphereUnder(CLEAR, sky, 4000);
    expect(a.baseDensity).toBe(fogDensityUnder(CLEAR, 4000));
    expect(a.heightDensity).toBe(0.004);
    expect(a.gradientScale).toBe(0.00025);
    expect(a.sunDir).toEqual(sky.glowDir);
    expect(a.sunColour).toEqual(sky.horizonToward);
    expect(a.sunWeight).toBe(sky.glowWeight);
    expect(a.sunPower).toBe(sky.glowPower);
  });

  it("colours the glow with the horizon toward the sun under the weather's air, as the fog is the horizon away under it", () => {
    for (const hour of [12, 18, 18.25]) {
      const sky = skyStateFor(table, hour, MIST);
      const a = atmosphereUnder(MIST, sky, 4000);
      expect(a.sunColour, `hour ${hour}`).toEqual(airColourUnder(MIST, sky.horizonToward));
      expect(fogGradientUnder(MIST, sky)[255], `hour ${hour}`).toEqual(airColourUnder(MIST, sky.horizonAway));
    }
  });

  it("lays the glow on the horizon under the sun, and puts none under a full deck", () => {
    const sky = skyStateFor(table, 17, CLEAR);
    const a = atmosphereUnder(CLEAR, sky, 4000);
    expect(a.sunDir.y).toBe(0);
    expect(Math.hypot(a.sunDir.x, a.sunDir.z)).toBeCloseTo(1, 12);
    // The afternoon sun is on the -x side of its arc.
    expect(Math.sign(a.sunDir.x)).toBe(Math.sign(sky.sunDir.x));
    // A full deck is even all round the horizon: no glow.
    expect(atmosphereUnder(EERIE, skyStateFor(table, 12, EERIE), 4000).sunWeight).toBe(0);
  });

  it("mist raises the height density and the reference level; dread raises the level further", () => {
    const at = (w: typeof CLEAR) => atmosphereUnder(w, skyStateFor(table, 12, w), 4000);
    // HEIGHT_DENSITY_BASE x (1 + HEIGHT_MIST_GAIN).
    expect(at(MIST).heightDensity).toBeCloseTo(0.012, 10);
    // REFERENCE_LEVEL_BASE, then + LEVEL_MIST_RISE, then + LEVEL_DREAD_RISE.
    expect(at(CLEAR).referenceLevel).toBe(-20);
    expect(at(MIST).referenceLevel).toBeCloseTo(-12, 10);
    expect(at(EERIE).referenceLevel).toBeCloseTo(-6, 10);
  });

  it("the reference level holds still across a plateau of the dread fade", () => {
    const a = { ...EERIE, dread: 0.36 };
    const b = { ...EERIE, dread: 0.42 };
    const sky = skyStateFor(table, 17, EERIE);
    expect(atmosphereUnder(a, sky, 4000).referenceLevel).toBe(atmosphereUnder(b, sky, 4000).referenceLevel);
  });
});

describe("heightFogAmount — the TS mirror of the GLSL", () => {
  it("is zero over zero distance, grows with distance, and is larger for a ray going down", () => {
    expect(heightFogAmount(50, 0.1, 0, 0.02, 0.05, 0)).toBe(0);
    expect(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0)).toBeGreaterThan(0);
    expect(heightFogAmount(50, 0.1, 200, 0.02, 0.05, 0)).toBeGreaterThan(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0));
    expect(heightFogAmount(50, -0.1, 100, 0.02, 0.05, 0)).toBeGreaterThan(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0));
  });

  it("a camera higher above the level sees thinner fog", () => {
    expect(heightFogAmount(200, 0, 100, 0.02, 0.05, 0)).toBeLessThan(heightFogAmount(20, 0, 100, 0.02, 0.05, 0));
  });
});

describe("the atmosphere's uniforms", () => {
  const VIEW = 4000;

  it("are, for an hour and a weather, the record's numbers by name over the cloud's, made with no engine", () => {
    const sky = skyStateFor(table, 17.5, MIST);
    const r = atmosphereUnder(MIST, sky, VIEW);
    const cloud = cloudFor(noCloud(), 0.4, 8, 30, 0, fogGradientUnder(MIST, sky)[0]!);
    const u = atmosphereUniforms(r, cloud, 8);
    expect(u).toEqual({
      atmOn: [1],
      atmBaseDensity: [fogDensityUnder(MIST, VIEW)],
      atmHeightDensity: [r.heightDensity],
      atmHeightFalloff: [r.heightFalloff],
      atmReferenceLevel: [r.referenceLevel],
      atmGradientScale: [1 / VIEW],
      atmSunPower: [sky.glowPower],
      atmSunWeight: [sky.glowWeight],
      atmSunDir: [sky.glowDir.x, sky.glowDir.y, sky.glowDir.z],
      atmSunColour: [r.sunColour.r, r.sunColour.g, r.sunColour.b],
      atmFarColour: [sky.mistAir.r, sky.mistAir.g, sky.mistAir.b],
      ...cloudUniforms(cloud, 8),
    });
  });

  it("name the air's uniforms first, in the order the material declares them, then the cloud's", () => {
    expect(Object.keys(emptyAtmosphereUniforms())).toEqual([
      "atmOn", "atmBaseDensity", "atmHeightDensity", "atmHeightFalloff", "atmReferenceLevel", "atmGradientScale", "atmSunPower",
      "atmSunWeight", "atmSunDir", "atmSunColour", "atmFarColour",
      "atmCloudDensity", "atmCloudSteps", "atmCloudRange", "atmCloudFalloff", "atmCloudSeat", "atmCloudGroundRange", "atmCloudNear",
      "atmCloudTrail", "atmCloudNoiseScale", "atmCloudWind", "atmCloudGlow", "atmCloudColour", "atmCloudGroundRect",
    ]);
  });

  it("are off with no record: the air's zero, and the cloud not marched", () => {
    const cloud = cloudFor(noCloud(), 0.4, 8, 30, 0, { r: 0.1, g: 0.1, b: 0.1 });
    const off = atmosphereUniforms(null, cloud, 8);
    expect(off.atmOn).toEqual([0]);
    expect(off.atmCloudSteps).toEqual([0]);
    expect([off.atmBaseDensity, off.atmHeightDensity, off.atmSunDir, off.atmFarColour]).toEqual([[0], [0], [0, 0, 0], [0, 0, 0]]);
  });

  it("fill the record handed in, on and then off again", () => {
    const sky = skyStateFor(table, 12, CLEAR);
    const r = atmosphereUnder(CLEAR, sky, VIEW);
    const out = emptyAtmosphereUniforms();
    expect(atmosphereUniforms(r, noCloud(), 0, out)).toBe(out);
    expect(out).toEqual(atmosphereUniforms(r, noCloud(), 0));
    atmosphereUniforms(null, noCloud(), 0, out);
    expect(out).toEqual(atmosphereUniforms(null, noCloud(), 0));
  });
});
