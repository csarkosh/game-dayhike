import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NIGHT_SKY } from "../../src/game/sky.js";
import { SKY_DOME_SIZE, createSkyTableUploads, emptySkyDomeUniforms, skyDomeUniforms } from "../../src/game/skyDomeParams.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { babylonValues } from "../helpers/babylonFixture.js";
import { skyFixture } from "./helpers/skyFixture.js";

/** The uniforms the dome's shell on Babylon.js names (`skyDome.ts`), and of them the image's, bound at each draw: recorded. */
const { skyDomeUniforms: SKY_DOME_UNIFORMS, skyDomeImageUniforms: SKY_DOME_IMAGE_UNIFORMS } = babylonValues<{ skyDomeUniforms: string[]; skyDomeImageUniforms: string[] }>("stages/declared.json");
const FRAGMENT = readFileSync(new URL("../../src/game/shaders/skyDome.fragment.fx", import.meta.url), "utf8");

describe("what the sky's dome is drawn with", () => {
  it("is a box 8000 across", () => {
    expect(SKY_DOME_SIZE).toBe(8000);
  });

  it("names the stage's uniforms of the sky and the exposure, in the order it declares them, each its size", () => {
    const declared = [...FRAGMENT.matchAll(/^uniform (float|vec3) (\w+);/gm)].map((m) => [m[2] as string, m[1] === "float" ? 1 : 3] as const);
    const ours = Object.entries(emptySkyDomeUniforms()).map(([name, value]) => [name, value.length] as const);
    // Every one the stage declares and the shell names, but the capture's switch, the tone map's and the image's
    // bound at each draw.
    const rest = ["skyCapture", "skyToneMap", ...SKY_DOME_IMAGE_UNIFORMS];
    expect(ours).toEqual(declared.filter(([name]) => SKY_DOME_UNIFORMS.includes(name) && !rest.includes(name)));
    expect(ours.map(([name]) => name)).toEqual([
      "skyScale", "skyCloud", "skyDeckZenith", "skyNight", "skyMistAir", "skyMistWeight", "skySunDir", "skyDisc", "skyExposure", "skyContrast",
    ]);
  });

  it("starts as the night sky alone, straight up, at an exposure and a contrast of 1", () => {
    expect(emptySkyDomeUniforms()).toEqual({
      skyScale: [0], skyCloud: [0], skyDeckZenith: [0, 0, 0], skyNight: [NIGHT_SKY.r, NIGHT_SKY.g, NIGHT_SKY.b], skyMistAir: [0, 0, 0],
      skyMistWeight: [0], skySunDir: [0, 1, 0], skyDisc: [0, 0, 0], skyExposure: [1], skyContrast: [1],
    });
  });

  it("takes every value of a state, the slice as already in the scene's units, into the record it is given", () => {
    // Dusk in mist: cloud, mist, a disc and a deck all in play.
    const s = skyStateFor(skyFixture(), 18, WEATHER_PRESETS.mist);
    const out = emptySkyDomeUniforms();
    expect(skyDomeUniforms(s, 1.3, 1.1, out)).toBe(out);
    expect(out).toEqual({
      skyScale: [1], skyCloud: [0.9], skyDeckZenith: [s.deckZenith.r, s.deckZenith.g, s.deckZenith.b],
      skyNight: [s.nightFloor.r, s.nightFloor.g, s.nightFloor.b], skyMistAir: [s.mistAir.r, s.mistAir.g, s.mistAir.b], skyMistWeight: [1],
      skySunDir: [s.sunDir.x, s.sunDir.y, s.sunDir.z], skyDisc: [s.discColour.r, s.discColour.g, s.discColour.b], skyExposure: [1.3], skyContrast: [1.1],
    });
  });

  it("sends the slice up for the first state, again for a move of the hour or a slice's arrival, never for the weather alone", () => {
    const uploads = createSkyTableUploads();
    const noon = skyStateFor(skyFixture(), 12, WEATHER_PRESETS.clear);
    expect(uploads.due(noon)).toBe(true);
    expect(uploads.due(noon)).toBe(false);
    expect(uploads.due(skyStateFor(skyFixture(), 12, WEATHER_PRESETS.mist))).toBe(false);
    expect(uploads.due(skyStateFor(skyFixture(), 12, WEATHER_PRESETS.rain))).toBe(false);
    const afternoon = skyStateFor(skyFixture(), 15, WEATHER_PRESETS.clear);
    expect(uploads.due(afternoon)).toBe(true);
    expect(uploads.due({ ...afternoon, tableCount: afternoon.tableCount + 1 })).toBe(true);
    expect(uploads.due({ ...afternoon, tableCount: afternoon.tableCount + 1 })).toBe(false);
  });
});
