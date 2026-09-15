import { describe, it, expect } from "vitest";
import gradeFragment from "../../src/game/shaders/grade.fragment.fx?raw";
import finishFragment from "../../src/game/shaders/finish.fragment.fx?raw";
import halationFragment from "../../src/game/shaders/halationExtract.fragment.fx?raw";
import {
  AGX_INSET, AGX_OUTSET, SRGB_TO_REC2020, REC2020_TO_SRGB, AGX_MIN_EV, AGX_MAX_EV,
  SPLIT_TONE_DENSITY_SCALE, SPLIT_TONE_SATURATION_SCALE, type Mat3,
} from "../../src/game/gradeParams.js";
import { OVERLAP_INNER, OVERLAP_SCALE, DITHER_LSB, HALATION_THRESHOLD, HALATION_CAP } from "../../src/game/postParams.js";

function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}
function glslMat3(m: Mat3): string {
  return `mat3(${m.map(glslFloat).join(", ")})`;
}

describe("grade.fragment.fx stays in lockstep with gradeParams.ts", () => {
  it("carries the AgX matrices and range verbatim", () => {
    expect(gradeFragment).toContain(`const mat3 AGX_INSET = ${glslMat3(AGX_INSET)};`);
    expect(gradeFragment).toContain(`const mat3 AGX_OUTSET = ${glslMat3(AGX_OUTSET)};`);
    expect(gradeFragment).toContain(`const mat3 SRGB_TO_REC2020 = ${glslMat3(SRGB_TO_REC2020)};`);
    expect(gradeFragment).toContain(`const mat3 REC2020_TO_SRGB = ${glslMat3(REC2020_TO_SRGB)};`);
    expect(gradeFragment).toContain(`const float AGX_MIN_EV = ${glslFloat(AGX_MIN_EV)};`);
    expect(gradeFragment).toContain(`const float AGX_MAX_EV = ${glslFloat(AGX_MAX_EV)};`);
  });
  it("carries the split-tone response scales verbatim", () => {
    expect(gradeFragment).toContain(`const float SPLIT_TONE_DENSITY_SCALE = ${glslFloat(SPLIT_TONE_DENSITY_SCALE)};`);
    expect(gradeFragment).toContain(`const float SPLIT_TONE_SATURATION_SCALE = ${glslFloat(SPLIT_TONE_SATURATION_SCALE)};`);
  });
  it("keeps the MIT notice for the borrowed tone map", () => {
    expect(gradeFragment).toContain("three.js, MIT License, Copyright 2010-2024 three.js authors");
  });
});

describe("finish.fragment.fx and halationExtract.fragment.fx stay in lockstep with postParams.ts", () => {
  it("carries the overlap mask, the dither amplitude and the halation threshold", () => {
    expect(finishFragment).toContain(`const float OVERLAP_INNER = ${glslFloat(OVERLAP_INNER)};`);
    expect(finishFragment).toContain(`const float OVERLAP_SCALE = ${glslFloat(OVERLAP_SCALE)};`);
    expect(finishFragment).toContain(`const float DITHER_LSB = ${glslFloat(DITHER_LSB)};`);
    expect(halationFragment).toContain(`const float HALATION_THRESHOLD = ${glslFloat(HALATION_THRESHOLD)};`);
    expect(halationFragment).toContain(`const float HALATION_CAP = ${glslFloat(HALATION_CAP)};`);
  });
});
