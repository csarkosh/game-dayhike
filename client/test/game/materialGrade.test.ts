import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHASE_SHADOW_DENSITY, CHASE_SHADOW_HUE, VIGNETTE_COLOUR } from "../../src/game/gradeParams.js";
import {
  DITHER_INTENSITY, VIGNETTE_CAMERA_FOV, curveSettingsUnder, curveVectors, emptyCurveVectors, materialGradeUniforms, vignetteVectors, type CurveSettings,
} from "../../src/game/materialGrade.js";
import { WEATHER_PRESETS, gradeUnder, saturationUnder } from "../../src/game/weather.js";
import { babylonValues } from "../helpers/babylonFixture.js";

const src = (name: string): string => readFileSync(new URL(`../../src/game/${name}`, import.meta.url), "utf8");

/**
 * What Babylon.js gave, recorded. `curves`: what it binds for each case's settings, its own `ColorCurves` set as
 * the game sets them and bound to a stand-in effect (`ColorCurvesBind`): every weather under a chase of 0, 0.3 and
 * 1 as the game graded them when they were recorded, then eight settings it curves hard, in the order the first
 * test below walks them. `image`: its image processing's defaults, and what `bind()` sends an effect for a frame
 * of that size with the vignette and the dither on, at that weight and the game's vignette colour.
 */
const BABYLON = babylonValues<{
  curves: { settings: CurveSettings; neutral: number[]; positive: number[]; negative: number[] }[];
  image: {
    defaults: { vignetteCameraFov: number; vignetteStretch: number; vignetteCenterX: number; vignetteCenterY: number; vignetteBlendsByMultiplying: boolean; ditheringIntensity: number };
    weight: number; width: number; height: number; colour: number[];
    sent: { vignetteSettings1: number[]; vignetteSettings2: number[]; vInverseScreenSize: number[]; ditherIntensity: number[] };
  };
}>("numbers/materialGrade.json");

describe("the grade on the material colour path", () => {
  it("works the colour curves' three vectors out as Babylon.js does, under every weather and through the chase", () => {
    // The weathers' cases are worked out from the settings in the record, the ones `curveSettingsUnder` gave for each
    // weather and cast when Babylon.js's curves were recorded for them: six weathers under three casts.
    const weathers = Object.values(WEATHER_PRESETS).length;
    expect(weathers).toBe(6);
    expect(BABYLON.curves).toHaveLength(weathers * 3 + 8);
    let n = 0;
    for (; n < weathers * 3; n++) {
      const { settings, ...theirs } = BABYLON.curves[n] as (typeof BABYLON.curves)[number];
      const ours = curveVectors(settings);
      for (let i = 0; i < 4; i++) {
        expect(ours.gradeCurveNeutral[i]).toBeCloseTo(theirs.neutral?.[i] as number, 12);
        expect(ours.gradeCurvePositive[i]).toBeCloseTo(theirs.positive?.[i] as number, 12);
        expect(ours.gradeCurveNegative[i]).toBeCloseTo(theirs.negative?.[i] as number, 12);
      }
    }
    // Settings Babylon.js would curve hard: a negative density turns the hue over, and every hue's sector is taken.
    for (const hue of [0, 45, 100, 170, 200, 260, 310, 359]) {
      const settings: CurveSettings = { globalSaturation: -35, shadows: { hue, density: -60, saturation: 20 }, midtones: { hue: (hue + 77) % 360, density: 40, saturation: -10 }, highlights: { hue: (hue + 190) % 360, density: 100, saturation: 55 } };
      const { settings: recorded, ...theirs } = BABYLON.curves[n++] as (typeof BABYLON.curves)[number];
      expect(recorded).toEqual(settings);
      const ours = curveVectors(settings);
      for (let i = 0; i < 4; i++) {
        expect(ours.gradeCurveNeutral[i]).toBeCloseTo(theirs.neutral?.[i] as number, 12);
        expect(ours.gradeCurvePositive[i]).toBeCloseTo(theirs.positive?.[i] as number, 12);
        expect(ours.gradeCurveNegative[i]).toBeCloseTo(theirs.negative?.[i] as number, 12);
      }
    }
    expect(n).toBe(BABYLON.curves.length);
  });


  it("leaves the frame as it is under clear weather: the neutral curve at one and nothing added or taken", () => {
    const clear = curveVectors(curveSettingsUnder(WEATHER_PRESETS.clear, 0));
    expect(clear.gradeCurveNeutral.map((v) => +v.toFixed(12))).toEqual([1, 1, 1, 1]);
    expect(clear.gradeCurvePositive.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 0, 0]);
    expect(clear.gradeCurveNegative.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 0, 0]);
    const out = emptyCurveVectors();
    expect(curveVectors(curveSettingsUnder(WEATHER_PRESETS.clear, 0), out)).toBe(out);
  });

  it("sets the curves by the weather's grade, and turns the shadows toward burgundy and deepens them by the chase's cast", () => {
    const weather = WEATHER_PRESETS.eerie;
    const g = gradeUnder(weather);
    expect(curveSettingsUnder(weather, 0)).toEqual({
      globalSaturation: saturationUnder(weather),
      shadows: { hue: g.shadowsHue, density: g.shadowsDensity, saturation: g.shadowsSaturation },
      midtones: { hue: g.midtonesHue, density: g.midtonesDensity, saturation: g.midtonesSaturation },
      highlights: { hue: g.highlightsHue, density: g.highlightsDensity, saturation: g.highlightsSaturation },
    });
    const chased = curveSettingsUnder(weather, 1);
    expect(chased.shadows.hue).toBeCloseTo(CHASE_SHADOW_HUE, 12);
    expect(chased.shadows.density).toBe(g.shadowsDensity + CHASE_SHADOW_DENSITY);
    // The shell on Babylon.js writes these settings onto its own curves.
    const post = src("post.ts");
    expect(post).toContain("const set = curveSettingsUnder(weather, record.chase);");
    for (const line of ["curves.globalSaturation = set.globalSaturation;", "curves.shadowsHue = set.shadows.hue;", "curves.shadowsDensity = set.shadows.density;", "curves.highlightsSaturation = set.highlights.saturation;"]) {
      expect(post, line).toContain(line);
    }
  });

  it("shapes the vignette and the dither as Babylon.js's image processing binds them", () => {
    // Babylon.js's own defaults are what the game leaves standing: its vignette's field of view, no stretch, the centre, the multiply blend, the dither's step.
    const image = BABYLON.image.defaults;
    expect(image.vignetteCameraFov).toBe(VIGNETTE_CAMERA_FOV);
    expect(image.vignetteStretch).toBe(0);
    expect([image.vignetteCenterX, image.vignetteCenterY]).toEqual([0, 0]);
    expect(image.vignetteBlendsByMultiplying).toBe(true);
    expect(image.ditheringIntensity).toBe(DITHER_INTENSITY);
    // What it then sent an effect: the vignette and the dither on, the weight 1.7, the game's vignette colour, a frame 1470 by 956.
    expect([BABYLON.image.weight, BABYLON.image.width, BABYLON.image.height]).toEqual([1.7, 1470, 956]);
    expect(BABYLON.image.colour).toEqual([VIGNETTE_COLOUR.r, VIGNETTE_COLOUR.g, VIGNETTE_COLOUR.b]);
    const sent = BABYLON.image.sent;
    const ours = vignetteVectors(1.7, 1470, 956);
    for (let i = 0; i < 4; i++) {
      expect(ours.gradeVignette1[i]).toBeCloseTo(sent.vignetteSettings1?.[i] as number, 12);
      expect(ours.gradeVignette2[i]).toBeCloseTo(sent.vignetteSettings2?.[i] as number, 12);
    }
    expect([ours.gradeScreen[0], ours.gradeScreen[1]]).toEqual(sent.vInverseScreenSize);
    expect(ours.gradeScreen[2]).toBe(sent.ditherIntensity?.[0]);
  });

  it("makes a frame's whole grade from the weather and the grade's record", () => {
    const u = materialGradeUniforms(WEATHER_PRESETS.eerie, { vignetteWeight: 2, chase: 0.5 }, 1280, 720);
    expect(u.gradeCurveNeutral).toEqual(curveVectors(curveSettingsUnder(WEATHER_PRESETS.eerie, 0.5)).gradeCurveNeutral);
    expect(u.gradeVignette2[3]).toBe(-4);
    expect(u.gradeScreen.slice(0, 2)).toEqual([1 / 1280, 1 / 720]);
    expect(src("materialGrade.ts")).not.toMatch(/@babylonjs/);
  });
});
