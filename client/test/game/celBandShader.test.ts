import { describe, it, expect } from "vitest";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import celBandFragment from "../../src/game/shaders/celBand.fragment.fx?raw";
import {
  CEL_BANDS, CEL_SOFTNESS, CEL_STRENGTH, CEL_ZERO_GUARD,
} from "../../src/game/stylizeParams.js";

/**
 * The injected snippet is spliced into the PBR fragment AFTER Babylon's
 * preprocessor has run on the base shader, but the CUSTOM_FRAGMENT_DEFINITIONS
 * path and any future refactor can re-expose it to the string pipeline — and
 * the two comment-hazard classes (trailing-comment semicolons, hashed
 * keywords in prose) that broke etchedOutline.fragment.fx twice are cheap to
 * lint here the same way: run the REAL preprocessor over the file wrapped in
 * a minimal main harness and assert the anatomy survives.
 */
function processShader(source: string): Promise<string> {
  const options: _IProcessingOptions = {
    defines: [],
    indexParameters: {},
    isFragment: true,
    shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: false,
    shadersRepository: "",
    includesShadersStore: {},
    processor: { shaderLanguage: ShaderLanguage.GLSL },
    version: "",
    platformName: "WEBGL2",
    processingContext: null,
    isNDCHalfZRange: false,
    useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => {
    Process(source, options, (migratedCode) => resolve(migratedCode));
  });
}

const HARNESS = "\nuniform float celOn;\nvoid main(void){gl_FragColor=vec4(celBand(vec3(1.0),celOn),1.0);}\n";

describe("celBand.fragment.fx survives Babylon's real shader preprocessor", () => {
  it("keeps the band function and the harness main intact", async () => {
    const processed = await processShader(celBandFragment + HARNESS);
    expect(processed).toContain("vec3 celBand(vec3 diffuse, float celOn)");
    expect(processed).toContain("void main");
    // The function body's last operation must survive verbatim — a swallowed
    // tail is exactly how an earlier etchedOutline defect presented.
    expect(processed).toContain("return diffuse * (lb / l);");
  });
});

// GLSL requires a decimal point on float literals (`1.0`, not `1`), but JS's
// default number-to-string coercion drops it for whole numbers (`String(1)
// === "1"`). A bare `${CEL_STRENGTH}` interpolation would silently expect
// "1" when CEL_STRENGTH is a whole number like 1.0, while the .fx file
// (correctly) spells "1.0". Format every asserted constant as a GLSL float
// would be written instead of special-casing one.
function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

describe("GLSL constants stay in lockstep with celBandCurve's TS constants", () => {
  it("carries the exact literals stylizeParams.ts exports", () => {
    expect(celBandFragment).toContain(`const float CEL_BANDS = ${glslFloat(CEL_BANDS)};`);
    expect(celBandFragment).toContain(`const float CEL_SOFTNESS = ${glslFloat(CEL_SOFTNESS)};`);
    expect(celBandFragment).toContain(`const float CEL_STRENGTH = ${glslFloat(CEL_STRENGTH)};`);
    expect(celBandFragment).toContain(`const float CEL_ZERO_GUARD = ${glslFloat(CEL_ZERO_GUARD)};`);
  });
});

describe("comment hazards (the etchedOutline lessons)", () => {
  it("has no declaration line with a trailing comment containing a semicolon, and no hashed keyword in comments", () => {
    for (const line of celBandFragment.split("\n")) {
      const trimmed = line.trim();
      const commentAt = line.indexOf("//");
      if (trimmed.startsWith("//")) {
        expect(/#(ifdef|ifndef|if|else|elif|endif|define|undef|include)\b/.test(trimmed)).toBe(false);
        continue;
      }
      if (commentAt >= 0) {
        expect(line.slice(commentAt).includes(";")).toBe(false);
      }
    }
  });
});
