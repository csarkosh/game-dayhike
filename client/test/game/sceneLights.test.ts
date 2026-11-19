import { describe, expect, it } from "vitest";
import { FILL_GROUND, FILL_SPECULAR, SHADOW_FLOOR, sceneLightsUnder, sunShadowDarkness, sunTravel } from "../../src/game/sceneLights.js";
import { sunPositionAt } from "../../src/game/sky.js";
import { SKY_IBL_SCALE, skyStateFor } from "../../src/game/skyState.js";
import { AMBIENT_COLLAPSE, WEATHER_PRESETS, ambientCollapseUnder } from "../../src/game/weather.js";
import { luma } from "../../src/game/colour.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;
const table = skyFixture();

describe("the scene's lights", () => {
  it("are, for an hour and a weather, the sky state's numbers, made with no engine", () => {
    for (const hour of [8, 12, 18.25, 22]) {
      for (const w of [CLEAR, WEATHER_PRESETS.overcast, WEATHER_PRESETS.eerie]) {
        const sky = skyStateFor(table, hour, w);
        const lights = sceneLightsUnder(w, sky);
        const collapse = ambientCollapseUnder(w);
        expect(lights, `hour ${hour}`).toEqual({
          sun: {
            direction: { x: -sky.sunDir.x, y: -sky.sunDir.y, z: -sky.sunDir.z },
            colour: sky.sunColour,
            intensity: sky.sunIntensity,
            shadowDarkness: sunShadowDarkness(w),
          },
          fill: {
            direction: { x: 0, y: 1, z: 0 },
            colour: sky.fillColour,
            groundColour: { r: 0, g: 0, b: 0 },
            specular: { r: 1, g: 1, b: 1 },
            intensity: sky.fillIntensity * collapse,
          },
          environmentIntensity: collapse * SKY_IBL_SCALE,
          air: sky.mistAir,
        });
      }
    }
  });

  it("aim the sun along the way its light travels: down at noon, a unit vector", () => {
    const sun = sceneLightsUnder(CLEAR, skyStateFor(table, 12, CLEAR)).sun;
    expect(sun.direction.y).toBeLessThan(0);
    expect(Math.hypot(sun.direction.x, sun.direction.y, sun.direction.z)).toBeCloseTo(1, 12);
    expect(sun.intensity).toBeGreaterThan(0);
    expect(luma(sun.colour)).toBeCloseTo(1, 6);
  });

  it("leave no sun at night, and the fill the light left", () => {
    const lights = sceneLightsUnder(CLEAR, skyStateFor(table, 0, CLEAR));
    expect(lights.sun.intensity).toBe(0);
    expect(lights.fill.intensity).toBeGreaterThan(0);
  });

  it("collapse the fill and the image-based light together on the top plateau of dread", () => {
    const dread = { ...CLEAR, dread: 1 };
    const calm = sceneLightsUnder(CLEAR, skyStateFor(table, 12, CLEAR));
    const top = sceneLightsUnder(dread, skyStateFor(table, 12, dread));
    expect(calm.environmentIntensity).toBe(SKY_IBL_SCALE);
    expect(top.environmentIntensity).toBeCloseTo(SKY_IBL_SCALE * (1 - AMBIENT_COLLAPSE), 12);
    expect(top.fill.intensity / calm.fill.intensity).toBeCloseTo(top.environmentIntensity / calm.environmentIntensity, 12);
  });

  it("keep a floor of the sun's light in a cast shadow, and lose the shadow under full cloud", () => {
    expect(SHADOW_FLOOR).toBe(0.17);
    expect(sceneLightsUnder(CLEAR, skyStateFor(table, 12, CLEAR)).sun.shadowDarkness).toBe(0.17);
    expect(sceneLightsUnder(WEATHER_PRESETS.rain, skyStateFor(table, 12, WEATHER_PRESETS.rain)).sun.shadowDarkness).toBe(1);
  });

  it("make a record of its own each time, never the sky state's or the constants' objects", () => {
    const sky = skyStateFor(table, 12, CLEAR);
    const lights = sceneLightsUnder(CLEAR, sky);
    expect(lights.sun.colour).not.toBe(sky.sunColour);
    expect(lights.air).not.toBe(sky.mistAir);
    expect(lights.fill.groundColour).not.toBe(FILL_GROUND);
    expect(lights.fill.specular).not.toBe(FILL_SPECULAR);
  });
});

describe("the way the sun's light travels", () => {
  it("is the negation of the direction toward the sun, into the vector handed in", () => {
    const toSun = sunPositionAt(15);
    const out = { x: 9, y: 9, z: 9 };
    expect(sunTravel(toSun, out)).toBe(out);
    expect(out).toEqual({ x: -toSun.x, y: -toSun.y, z: -toSun.z });
    expect(sunTravel(toSun)).toEqual(out);
    expect(sunTravel(toSun)).not.toBe(out);
  });
});
