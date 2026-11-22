import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AGX_INSET, AGX_OUTSET, SRGB_TO_REC2020, REC2020_TO_SRGB, AGX_MIN_EV, AGX_MAX_EV,
  SPLIT_TONE_DENSITY_SCALE, SPLIT_TONE_SATURATION_SCALE, AGX_CONTRAST, type Mat3,
} from "../../src/game/gradeParams.js";
import { DITHER_LSB, HALATION_THRESHOLD, HALATION_CAP } from "../../src/game/postParams.js";
import { HALATION_EXTRACT_WGSL, gradeWgsl } from "../../src/game/lite/postWgsl.js";

function wgslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}
function wgslMat3(m: Mat3): string {
  return `mat3x3<f32>(${m.map(wgslFloat).join(",")})`;
}

/** The grade's stage as the chain compiles it, with the halation's glow and without. */
const STAGES = [gradeWgsl(true), gradeWgsl(false)];

describe("the grade's stage stays in lockstep with gradeParams.ts", () => {
  it("carries the AgX matrices and range verbatim", () => {
    for (const grade of STAGES) {
      expect(grade).toContain(`const AGX_INSET:mat3x3<f32>=${wgslMat3(AGX_INSET)};`);
      expect(grade).toContain(`const AGX_OUTSET:mat3x3<f32>=${wgslMat3(AGX_OUTSET)};`);
      expect(grade).toContain(`const SRGB_TO_REC2020:mat3x3<f32>=${wgslMat3(SRGB_TO_REC2020)};`);
      expect(grade).toContain(`const REC2020_TO_SRGB:mat3x3<f32>=${wgslMat3(REC2020_TO_SRGB)};`);
      expect(grade).toContain(`const AGX_MIN_EV:f32=${wgslFloat(AGX_MIN_EV)};`);
      expect(grade).toContain(`const AGX_MAX_EV:f32=${wgslFloat(AGX_MAX_EV)};`);
    }
  });
  it("carries the split-tone response scales verbatim", () => {
    for (const grade of STAGES) {
      expect(grade).toContain(`const SPLIT_TONE_DENSITY_SCALE:f32=${wgslFloat(SPLIT_TONE_DENSITY_SCALE)};`);
      expect(grade).toContain(`const SPLIT_TONE_SATURATION_SCALE:f32=${wgslFloat(SPLIT_TONE_SATURATION_SCALE)};`);
    }
  });
  it("keeps the MIT notice for the borrowed tone map, beside the constants copied from it", () => {
    const params = readFileSync(fileURLToPath(new URL("../../src/game/gradeParams.ts", import.meta.url)), "utf8");
    expect(params).toContain("three.js, MIT License, Copyright 2010-2024 three.js authors");
  });
  it("carries the AgX contrast polynomial's coefficients from AGX_CONTRAST, not a second copy", () => {
    const [c6, c5, c4, c3, c2, c1, c0] = AGX_CONTRAST;
    for (const grade of STAGES) {
      expect(grade).toContain(
        `return ${wgslFloat(c6)}*x4*x2-${wgslFloat(Math.abs(c5))}*x4*x+${wgslFloat(c4)}*x4-` +
        `${wgslFloat(Math.abs(c3))}*x2*x+${wgslFloat(c2)}*x2+${wgslFloat(c1)}*x-${wgslFloat(Math.abs(c0))};`,
      );
    }
  });
});

describe("the grade's stage and the halation's extract stay in lockstep with postParams.ts", () => {
  it("carries the dither amplitude and the halation threshold", () => {
    for (const grade of STAGES) expect(grade).toContain(`const DITHER_LSB:f32=${wgslFloat(DITHER_LSB)};`);
    expect(HALATION_EXTRACT_WGSL).toContain(`const HALATION_THRESHOLD:f32=${wgslFloat(HALATION_THRESHOLD)};`);
    expect(HALATION_EXTRACT_WGSL).toContain(`const HALATION_CAP:f32=${wgslFloat(HALATION_CAP)};`);
  });
});
