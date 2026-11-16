import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MIRROR_CANOPY_SHADE, mirrorGroundColour } from "../../src/game/mirrorGround.js";
import { NEEDLE_BED } from "../../src/game/terrainSurface.js";
import { WEATHER_PRESETS, ambientCollapseUnder } from "../../src/game/weather.js";

const sky = {
  sunIntensity: 3, sunDir: { y: 0.5 }, fillIntensity: 0.8,
  sunColour: { r: 1, g: 0.9, b: 0.8 }, fillColour: { r: 0.4, g: 0.5, b: 0.6 },
};

describe("the ground in a lake's reflections", () => {
  it("is the needle bed under the sun on level ground and the fill, into the record it is handed", () => {
    const out = { r: 0, g: 0, b: 0 };
    expect(mirrorGroundColour(sky, WEATHER_PRESETS.clear, out)).toBe(out);
    expect(out.r).toBeCloseTo(NEEDLE_BED.r * (1 * 1.5 + 0.4 * 0.8), 12);
    expect(out.g).toBeCloseTo(NEEDLE_BED.g * (0.9 * 1.5 + 0.5 * 0.8), 12);
    expect(out.b).toBeCloseTo(NEEDLE_BED.b * (0.8 * 1.5 + 0.6 * 0.8), 12);
  });

  it("takes no sun from under the horizon, and less fill as the weather's dread collapses it", () => {
    const night = mirrorGroundColour({ ...sky, sunDir: { y: -0.3 } }, WEATHER_PRESETS.clear, { r: 0, g: 0, b: 0 });
    expect(night.r).toBeCloseTo(NEEDLE_BED.r * 0.4 * 0.8, 12);
    const eerie = mirrorGroundColour({ ...sky, sunDir: { y: -0.3 } }, WEATHER_PRESETS.eerie, { r: 0, g: 0, b: 0 });
    expect(eerie.r).toBeCloseTo(night.r * ambientCollapseUnder(WEATHER_PRESETS.eerie), 12);
    expect(eerie.r).toBeLessThan(night.r);
  });

  it("is half as bright under a full canopy, as the stand-in's shader has it", () => {
    expect(MIRROR_CANOPY_SHADE).toBe(0.5);
    const fx = readFileSync(new URL("../../src/game/shaders/lakeMirrorTerrain.fragment.fx", import.meta.url), "utf8");
    expect(fx).toContain(`const float LAKE_MIRROR_CANOPY_SHADE = ${MIRROR_CANOPY_SHADE.toFixed(1)};`);
  });
});
