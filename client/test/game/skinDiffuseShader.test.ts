import { describe, it, expect } from "vitest";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import skinFragment from "../../src/game/shaders/skinDiffuse.fragment.fx?raw";
import { SKIN_SCATTER_TINT, SKIN_WRAP, skinWrapLambert } from "../../src/game/skinParams.js";

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

// The real PBR fragment defines these before CUSTOM_FRAGMENT_DEFINITIONS; the
// harness stands them in so the snippet compiles through the preprocessor alone.
const HARNESS_HEAD =
  "struct preLightingInfo { float NdotL; float NdotLUnclamped; float attenuation; };\n" +
  "vec3 computeDiffuseLighting(preLightingInfo info, vec3 lightColor) { return lightColor * info.NdotL * info.attenuation; }\n" +
  "uniform float skinOn; uniform float skinWrap; uniform float skinScatter;\n";
const HARNESS_TAIL =
  "\nvoid main(void){ preLightingInfo p; p.NdotL = 0.5; p.NdotLUnclamped = 0.5; p.attenuation = 1.0;" +
  " gl_FragColor = vec4(skinDiffuseLighting(p, vec3(1.0), 1.0), 1.0); }\n";

function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

describe("skinDiffuse.fragment.fx survives Babylon's real shader preprocessor", () => {
  it("keeps the function and the harness main intact", async () => {
    const processed = await processShader(HARNESS_HEAD + skinFragment + HARNESS_TAIL);
    expect(processed).toContain("vec3 skinDiffuseLighting(preLightingInfo info, vec3 lightColor, float mask)");
    expect(processed).toContain("void main");
    expect(processed).toContain("return mix(base, wrapped + scatter, mask);");
  });
});

describe("GLSL constants stay in lockstep with skinParams.ts", () => {
  it("carries the exact literal", () => {
    const [r, g, b] = SKIN_SCATTER_TINT;
    expect(skinFragment).toContain(`const vec3 SKIN_SCATTER_TINT = vec3(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)});`);
  });
});

describe("skinWrapLambert — the TS mirror of the wrap term", () => {
  it("is energy-conserving: never above Lambert at full light, lifts the terminator, zero well behind it", () => {
    expect(skinWrapLambert(1, SKIN_WRAP)).toBeLessThanOrEqual(1);
    expect(skinWrapLambert(0, SKIN_WRAP)).toBeGreaterThan(0);
    expect(skinWrapLambert(-1, SKIN_WRAP)).toBe(0);
    expect(skinWrapLambert(0.5, 0)).toBeCloseTo(0.5, 6);
  });
});
