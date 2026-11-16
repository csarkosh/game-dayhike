import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ColorCurves, ColorCurvesBind } from "@babylonjs/core/Materials/colorCurves.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { CHASE_SHADOW_DENSITY, CHASE_SHADOW_HUE, VIGNETTE_COLOUR } from "../../src/game/gradeParams.js";
import {
  DITHER_INTENSITY, VIGNETTE_CAMERA_FOV, curveSettingsUnder, curveVectors, emptyCurveVectors, materialGradeUniforms, vignetteVectors, type CurveSettings,
} from "../../src/game/materialGrade.js";
import { WEATHER_PRESETS, gradeUnder, saturationUnder } from "../../src/game/weather.js";

const src = (name: string): string => readFileSync(new URL(`../../src/game/${name}`, import.meta.url), "utf8");

/** What Babylon.js binds for `settings`: its own curves set as the game sets them, and bound to a stand-in effect. */
function babylonVectors(settings: CurveSettings): Record<string, number[]> {
  const curves = new ColorCurves();
  curves.globalSaturation = settings.globalSaturation;
  curves.shadowsHue = settings.shadows.hue;
  curves.shadowsDensity = settings.shadows.density;
  curves.shadowsSaturation = settings.shadows.saturation;
  curves.midtonesHue = settings.midtones.hue;
  curves.midtonesDensity = settings.midtones.density;
  curves.midtonesSaturation = settings.midtones.saturation;
  curves.highlightsHue = settings.highlights.hue;
  curves.highlightsDensity = settings.highlights.density;
  curves.highlightsSaturation = settings.highlights.saturation;
  const sent: Record<string, number[]> = {};
  const effect = { setFloat4: (name: string, x: number, y: number, z: number, w: number) => void (sent[name] = [x, y, z, w]) } as unknown as Effect;
  ColorCurvesBind(curves, effect, "positive", "neutral", "negative");
  return sent;
}

describe("the grade on the material colour path", () => {
  it("works the colour curves' three vectors out as Babylon.js does, under every weather and through the chase", () => {
    for (const weather of Object.values(WEATHER_PRESETS)) {
      for (const chase of [0, 0.3, 1]) {
        const settings = curveSettingsUnder(weather, chase);
        const ours = curveVectors(settings);
        const theirs = babylonVectors(settings);
        for (let i = 0; i < 4; i++) {
          expect(ours.gradeCurveNeutral[i]).toBeCloseTo(theirs.neutral?.[i] as number, 12);
          expect(ours.gradeCurvePositive[i]).toBeCloseTo(theirs.positive?.[i] as number, 12);
          expect(ours.gradeCurveNegative[i]).toBeCloseTo(theirs.negative?.[i] as number, 12);
        }
      }
    }
    // Settings Babylon.js would curve hard: a negative density turns the hue over, and every hue's sector is taken.
    for (const hue of [0, 45, 100, 170, 200, 260, 310, 359]) {
      const settings: CurveSettings = { globalSaturation: -35, shadows: { hue, density: -60, saturation: 20 }, midtones: { hue: (hue + 77) % 360, density: 40, saturation: -10 }, highlights: { hue: (hue + 190) % 360, density: 100, saturation: 55 } };
      const ours = curveVectors(settings);
      const theirs = babylonVectors(settings);
      for (let i = 0; i < 4; i++) {
        expect(ours.gradeCurveNeutral[i]).toBeCloseTo(theirs.neutral?.[i] as number, 12);
        expect(ours.gradeCurvePositive[i]).toBeCloseTo(theirs.positive?.[i] as number, 12);
        expect(ours.gradeCurveNegative[i]).toBeCloseTo(theirs.negative?.[i] as number, 12);
      }
    }
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
    const image = new ImageProcessingConfiguration();
    expect(image.vignetteCameraFov).toBe(VIGNETTE_CAMERA_FOV);
    expect(image.vignetteStretch).toBe(0);
    expect([image.vignetteCenterX, image.vignetteCenterY]).toEqual([0, 0]);
    expect(image.vignetteBlendMode).toBe(ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY);
    expect(image.ditheringIntensity).toBe(DITHER_INTENSITY);
    image.vignetteEnabled = true;
    image.ditheringEnabled = true;
    image.vignetteWeight = 1.7;
    image.vignetteColor = new Color4(VIGNETTE_COLOUR.r, VIGNETTE_COLOUR.g, VIGNETTE_COLOUR.b, 0);
    const sent: Record<string, number[]> = {};
    const effect = {
      getEngine: () => ({ getRenderWidth: () => 1470, getRenderHeight: () => 956 }),
      setFloat: (name: string, x: number) => void (sent[name] = [x]),
      setFloat2: (name: string, x: number, y: number) => void (sent[name] = [x, y]),
      setFloat4: (name: string, x: number, y: number, z: number, w: number) => void (sent[name] = [x, y, z, w]),
      setTexture: () => undefined,
    } as unknown as Effect;
    image.bind(effect);
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
