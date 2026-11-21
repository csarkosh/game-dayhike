import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHASE_LIFT, CHASE_TINT, PAINT_AMBER, PAINT_ASH, PAINT_OILS, gradeRecordUnder } from "../../src/game/gradeParams.js";
import { LENS } from "@csarkosh/engine/game/lensParams";
import {
  FAR_CLOUD_UNIFORMS, FAR_SOFT_BAND, FAR_SOFT_RADIUS, HALATION_RATIO, LENS_FOLD_S, LENS_IDLE_S, SHADE_BLUR, SHADE_DARK, SHADE_MONSTER_DARK,
  composeUniforms, createLensGate, createPaletteFade, createTaaFrame, endBlurKernel, extractUniforms, farSoftUniforms, gradeUniforms, lensUniforms,
  paintUniforms, paintUniformsDrawn, postPasses, sharpenUniforms, type PostView,
} from "../../src/game/postFrame.js";
import {
  PAINT_RADIUS_MEDIUM, PAINT_SCALE, PAINT_STRENGTH, TAA_BLEND, TAA_BLEND_STILL, TAA_CLIP, TAA_SHARPEN, paintTexelRadius, postFeaturesFor, taaJitter,
} from "@csarkosh/engine/game/postParams";
import { STARE_LENS_REST } from "../../src/game/stareLens.js";
import { WEATHER_PRESETS } from "@csarkosh/engine/game/weather";

const src = (name: string): string => readFileSync(new URL(`../../src/game/${name}`, import.meta.url), "utf8");

/** A camera at (1, 2, 3) looking along +Z, a right-angle lens on a frame twice as wide as tall. */
const VIEW: PostView = { eye: { x: 1, y: 2, z: 3 }, forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: Math.PI / 2, aspect: 2 };

describe("what the post chain's passes are drawn with", () => {
  it("gives the far softening a texel, its band and the ray through a pixel: the right and up axes at the half view's tangent", () => {
    const u = farSoftUniforms(VIEW, 1920, 1080);
    expect(u.texel).toEqual([1 / 1920, 1 / 1080]);
    expect(u.soft).toEqual([FAR_SOFT_BAND[0], FAR_SOFT_BAND[1], FAR_SOFT_RADIUS]);
    expect(u.farEye).toEqual([1, 2, 3]);
    expect(u.farForward).toEqual([0, 0, 1]);
    expect(u.farUp[1]).toBeCloseTo(1, 12);
    expect(u.farRight[0]).toBeCloseTo(2, 12);
    // The cloud's uniforms the pass reads beside its own are the atmosphere's, by the atmosphere's names.
    expect(FAR_CLOUD_UNIFORMS).toContain("atmCloudSteps");
    expect(FAR_CLOUD_UNIFORMS).toContain("atmSunDir");
  });

  it("starts the anti-aliasing with no history, blends gently while the camera is still and at the full share once it moves", () => {
    const taa = createTaaFrame();
    expect(taa.valid).toBe(false);
    const first = taa.step(VIEW, 1920, 1080);
    // No history: last frame's basis is this frame's, and the blend is held off.
    expect(first.taaParams).toEqual([TAA_BLEND, TAA_CLIP, 0]);
    expect(first.taaPrevEye).toEqual(first.taaEye);
    expect(first.taaPrevRight).toEqual(first.taaRight);
    expect(taa.valid).toBe(true);
    expect(taa.step(VIEW, 1920, 1080).taaParams).toEqual([TAA_BLEND_STILL, TAA_CLIP, 1]);
    // A metre's step is far more than a pixel: the full share, and the last camera is the one before the step.
    const moved = taa.step({ ...VIEW, eye: { x: 2, y: 2, z: 3 } }, 1920, 1080);
    expect(moved.taaParams).toEqual([TAA_BLEND, TAA_CLIP, 1]);
    expect(moved.taaPrevEye).toEqual([1, 2, 3]);
    expect(moved.taaEye).toEqual([2, 2, 3]);
    // A turn too: a quarter of a degree at 1080 rows under a right-angle lens is three pixels.
    const turned = taa.step({ ...VIEW, eye: { x: 2, y: 2, z: 3 }, forward: { x: Math.sin(0.0044), y: 0, z: Math.cos(0.0044) } }, 1920, 1080);
    expect(turned.taaParams[0]).toBe(TAA_BLEND);
    taa.reset();
    expect(taa.step(VIEW, 1920, 1080).taaParams[2]).toBe(0);
  });

  it("walks the jitter a step a frame", () => {
    const taa = createTaaFrame();
    for (let frame = 0; frame < 10; frame++) expect(taa.jitter(1470, 956)).toEqual(taaJitter(frame, 1470, 956));
  });

  it("gives the sharpen, the paint and its compose their texels and their strengths", () => {
    expect(sharpenUniforms(1470, 956)).toEqual({ texel: [1 / 1470, 1 / 956], sharpen: [TAA_SHARPEN] });
    // The paint's texel is its own half-size target's, and so is the compose's.
    expect(paintUniforms(PAINT_RADIUS_MEDIUM, 1470, 956)).toEqual({ texel: [1 / 735, 1 / 478], radius: [paintTexelRadius(PAINT_RADIUS_MEDIUM, 956)] });
    expect(composeUniforms(1470, 956)).toEqual({ halfTexel: [1 / 735, 1 / 478], strength: [PAINT_STRENGTH] });
    // As the game's chain draws them, the strokes are laid out by the paint's own target's size: the engine reports
    // that size while the paint applies. A texel is two of the target's own, and the radius a frame's half as tall.
    expect(paintUniformsDrawn(PAINT_RADIUS_MEDIUM, 1470, 956)).toEqual(paintUniforms(PAINT_RADIUS_MEDIUM, 735, 478));
    expect(paintUniformsDrawn(PAINT_RADIUS_MEDIUM, 1470, 956)).toEqual({ texel: [1 / 367, 1 / 239], radius: [1] });
    expect(PAINT_SCALE).toBe(0.5);
  });

  it("gives the grade its record under the shader's names", () => {
    const record = gradeRecordUnder(WEATHER_PRESETS.eerie, 22, 1, 1, 3, { ...STARE_LENS_REST, level: 0.5, phase: 0.6, sideX: 1 }, 0.4, PAINT_ASH);
    const u = gradeUniforms(record, 1470, 956, 7, true);
    expect(u.texelSize).toEqual([1 / 1470, 1 / 956]);
    expect(u.time).toEqual([7]);
    expect(u.exposure).toEqual([record.exposure]);
    expect(u.whitePoint).toEqual([...record.whitePoint]);
    expect(u.purkinje).toEqual([...record.purkinje]);
    expect(u.purkinjeStrength).toEqual([record.purkinjeStrength]);
    expect(u.shadowTint).toEqual([record.shadows.r, record.shadows.g, record.shadows.b]);
    expect(u.shadowAmount).toEqual([record.shadows.density, record.shadows.saturation]);
    expect(u.highlightAmount).toEqual([record.highlights.density, record.highlights.saturation]);
    expect(u.paintMidtoneTint).toEqual([PAINT_ASH.midtones.r, PAINT_ASH.midtones.g, PAINT_ASH.midtones.b]);
    expect(u.paintCurve).toEqual([PAINT_ASH.contrast, PAINT_ASH.pivot]);
    expect(u.paintLift).toEqual([PAINT_ASH.lift.r, PAINT_ASH.lift.g, PAINT_ASH.lift.b]);
    expect(u.lift).toEqual([record.lift.r, record.lift.g, record.lift.b]);
    expect(u.vignetteWeight).toEqual([record.vignetteWeight]);
    expect(u.stareShade).toEqual([record.stare.x, record.stare.y, record.stare.reach, record.stare.time]);
    expect(u.stareShade[2]).toBeGreaterThan(0);
    expect(u.chaseTint).toEqual([CHASE_TINT.r, CHASE_TINT.g, CHASE_TINT.b, 0.4]);
    expect(u.chaseLift).toEqual([CHASE_LIFT.r, CHASE_LIFT.g, CHASE_LIFT.b]);
    expect(u.shadeShape).toEqual([SHADE_BLUR, SHADE_DARK, 1470 / 956, 1]);
    expect(u.shadeMonster).toEqual([SHADE_MONSTER_DARK]);
    // No figure in the mask: the shape's gate is 0, and the pass reads none of it.
    expect(gradeUniforms(record, 1470, 956, 7, false).shadeShape[3]).toBe(0);
    expect(extractUniforms(record)).toEqual({ exposure: [record.exposure] });
  });

  it("folds the lens's clock at an hour, and brings the pass in at the strength's floor and out a second after it falls under", () => {
    expect(lensUniforms(0.5, LENS_FOLD_S + 12, 1470, 956)).toEqual({ texelSize: [1 / 1470, 1 / 956], lensStrength: [0.5], time: [12], aspect: [1470 / 956] });
    const gate = createLensGate();
    expect(gate.step(0, 0)).toBe(false);
    expect(gate.step(LENS.floor, 1)).toBe(true);
    expect(gate.step(LENS.floor / 2, 2)).toBe(true);
    expect(gate.step(LENS.floor / 2, 2 + LENS_IDLE_S - 0.01)).toBe(true);
    expect(gate.step(LENS.floor / 2, 2 + LENS_IDLE_S)).toBe(false);
    // Back at the floor, the count under it starts again.
    expect(gate.step(LENS.floor, 5)).toBe(true);
    expect(gate.step(0, 5.5)).toBe(true);
    expect(gate.step(0, 6.5)).toBe(false);
    expect(gate.on).toBe(false);
  });

  it("wears oils until told, fades to the palette given over its seconds, and jumps at 0", () => {
    let ms = 0;
    const fade = createPaletteFade(() => ms);
    expect(fade.now()).toBe(PAINT_OILS);
    fade.set(PAINT_ASH, 2);
    ms = 1000;
    expect(fade.now().saturation).toBeCloseTo((PAINT_OILS.saturation + PAINT_ASH.saturation) / 2, 12);
    ms = 2000;
    expect(fade.now()).toBe(PAINT_ASH);
    fade.set(PAINT_AMBER, 0);
    expect(fade.now()).toBe(PAINT_AMBER);
  });

  it("names the passes each tier runs, in their order, with the size each writes", () => {
    expect(postPasses(postFeaturesFor("low", true))).toEqual([]);
    expect(postPasses(postFeaturesFor("medium", false))).toEqual([]);
    expect(postPasses(postFeaturesFor("medium", true))).toEqual([
      { name: "farSoft", scale: 1 }, { name: "taa", scale: 1 }, { name: "taaSharpen", scale: 1 }, { name: "paint", scale: PAINT_SCALE },
      { name: "paintCompose", scale: 1 }, { name: "grade", scale: 1 }, { name: "lens", scale: 1 },
    ]);
    expect(postPasses(postFeaturesFor("high", true)).map((pass) => `${pass.name}@${pass.scale}`)).toEqual([
      "farSoft@1", "taa@1", "taaSharpen@1", "paint@0.5", "paintCompose@1", "scene@1", `halationExtract@${HALATION_RATIO}`, `halationBlurX@${HALATION_RATIO}`,
      `halationBlurY@${HALATION_RATIO}`, "grade@1", "lens@1",
    ]);
  });

  it("steps the end's blur through three kernels", () => {
    expect([0, 0.1, 0.34, 0.67, 1].map(endBlurKernel)).toEqual([0, 28 / 3, (28 / 3) * 2, 28, 28]);
  });

  it("names nothing of Babylon.js", () => {
    expect(src("postFrame.ts")).not.toMatch(/@babylonjs/);
  });
});
