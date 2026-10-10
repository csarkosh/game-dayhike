import { describe, it, expect } from "vitest";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import farFx from "../../src/game/shaders/groundFarCover.fragment.fx?raw";
import {
  FAR_COVER_BAND, FAR_COVER_BAND_LOW, FAR_SWARD_COVER, FAR_SWARD_MAX, FAR_SWARD, FAR_LITTER, FAR_CANOPY_SHADE,
  FAR_CLUMP_CELL, FAR_CLUMP_WEIGHT, FAR_CLUMP_SALT, FAR_CLUMP_WRAP, FAR_CLUMP_AO, FAR_CLUMP_TILT,
  FAR_COVER_TILT, FAR_SPEC_CUT, FAR_SELF_SHADOW, FAR_SUN_GAIN_MAX,
} from "../../src/game/groundHexParams.js";
import { TERRAIN_SUN_INJECTION_CODE } from "../../src/game/terrainTexture.js";
import { timeLimit } from "../helpers/timeLimit.js";

function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }
function glslVec2(v: readonly [number, number]): string { return `vec2(${glslFloat(v[0])}, ${glslFloat(v[1])})`; }
function glslVec3(c: { r: number; g: number; b: number }): string { return `vec3(${glslFloat(c.r)}, ${glslFloat(c.g)}, ${glslFloat(c.b)})`; }

/** Babylon's real preprocessor, as `shaderHygiene.test.ts` runs it. */
function processFx(source: string, defines: string[]): Promise<string> {
  const options: _IProcessingOptions = {
    defines,
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
  return new Promise((resolve) => Process(source, options, (code) => resolve(code)));
}

describe("groundFarCover.fragment.fx stays in lockstep with groundHexParams.ts", () => {
  it("carries every constant verbatim", () => {
    for (const line of [
      `const vec2 FAR_COVER_BAND = ${glslVec2(FAR_COVER_BAND_LOW)};`,
      `const vec2 FAR_COVER_BAND = ${glslVec2(FAR_COVER_BAND)};`,
      `const vec2 FAR_SWARD_COVER = ${glslVec2(FAR_SWARD_COVER)};`,
      `const float FAR_SWARD_MAX = ${glslFloat(FAR_SWARD_MAX)};`,
      `const vec3 FAR_SWARD = ${glslVec3(FAR_SWARD)};`,
      `const vec3 FAR_LITTER = ${glslVec3(FAR_LITTER)};`,
      `const float FAR_CANOPY_SHADE = ${glslFloat(FAR_CANOPY_SHADE)};`,
      `const vec2 FAR_CLUMP_CELL = ${glslVec2(FAR_CLUMP_CELL)};`,
      `const vec2 FAR_CLUMP_WEIGHT = ${glslVec2(FAR_CLUMP_WEIGHT)};`,
      `const vec2 FAR_CLUMP_SALT = ${glslVec2(FAR_CLUMP_SALT)};`,
      `const float FAR_CLUMP_WRAP = ${glslFloat(FAR_CLUMP_WRAP)};`,
      `const float FAR_CLUMP_AO = ${glslFloat(FAR_CLUMP_AO)};`,
      `const float FAR_CLUMP_TILT = ${glslFloat(FAR_CLUMP_TILT)};`,
      `const float FAR_COVER_TILT = ${glslFloat(FAR_COVER_TILT)};`,
      `const float FAR_SPEC_CUT = ${glslFloat(FAR_SPEC_CUT)};`,
    ]) expect(farFx, line).toContain(line);
  }, timeLimit(5_000));

  it("hashes on the wrapped cells with the macro noise's hash, band-limits with a rising smoothstep, and reads no texture", () => {
    expect(farFx).toContain("vec2 c0 = mod(c + salt, FAR_CLUMP_WRAP);");
    expect(farFx).toContain("float a = latticeHash(c0);");
    expect(farFx.split("1.0 - smoothstep(0.5, 1.0,").length - 1).toBe(2);
    expect(farFx).not.toContain("texture");
    expect(farFx).not.toContain("discard");
    expect(farFx).not.toContain("uniform");
  }, timeLimit(5_000));

  it("holds the include whole", () => {
    expect(farFx).toBe(`// The far ground's cover: the constants and functions the terrain's far
// cover reads, spliced by TerrainTexturePlugin at CUSTOM_FRAGMENT_DEFINITIONS
// after the hex include, inside its TERRAINTEX guard, so latticeHash is in
// scope. Every constant mirrors groundHexParams.ts and a lockstep test
// asserts they agree.
//
// The clump noise is the macro noise's lattice hash on cells wrapped to
// FAR_CLUMP_WRAP, so the hash's product term stays under the bound where the
// CPU twin agrees with it, anywhere in the world.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

#ifdef TERRAINFARLOW
const vec2 FAR_COVER_BAND = vec2(14.4, 18.0);
#else
const vec2 FAR_COVER_BAND = vec2(24.0, 30.0);
#endif
const vec2 FAR_SWARD_COVER = vec2(0.05, 0.5);
const float FAR_SWARD_MAX = 0.8;
const vec3 FAR_SWARD = vec3(0.049, 0.081, 0.032);
const vec3 FAR_LITTER = vec3(0.081, 0.057, 0.032);
const float FAR_CANOPY_SHADE = 0.5;
const vec2 FAR_CLUMP_CELL = vec2(0.8, 3.0);
const vec2 FAR_CLUMP_WEIGHT = vec2(0.6, 0.4);
const vec2 FAR_CLUMP_SALT = vec2(41.0, 17.0);
const float FAR_CLUMP_WRAP = 97.0;
const float FAR_CLUMP_AO = 0.65;
const float FAR_CLUMP_TILT = 0.67;
const float FAR_COVER_TILT = 0.3;
const float FAR_SPEC_CUT = 0.5;

// The far cover's weight in [0, 1]: any cover the near field draws, grass or
// litter, ramped in over the tier's band of eye distance. Mirrors
// farCoverWeight.
float farCoverWeight(float cover, float duff, float dist) {
  float key = clamp(cover + duff, 0.0, 1.0);
  return smoothstep(FAR_SWARD_COVER.x, FAR_SWARD_COVER.y, key) * smoothstep(FAR_COVER_BAND.x, FAR_COVER_BAND.y, dist);
}

// One octave of value noise and its gradient in cell units: xy the
// gradient, z the value in [0, 1]. Mirrors farClumpOctave.
vec3 farClumpOctave(vec2 p, float cell, vec2 salt) {
  vec2 q = p / cell;
  vec2 c = floor(q);
  vec2 f = q - c;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  vec2 c0 = mod(c + salt, FAR_CLUMP_WRAP);
  vec2 c1 = mod(c + salt + 1.0, FAR_CLUMP_WRAP);
  float a = latticeHash(c0);
  float b = latticeHash(vec2(c1.x, c0.y));
  float d = latticeHash(vec2(c0.x, c1.y));
  float e = latticeHash(c1);
  float k = a - b - d + e;
  float n = a + (b - a) * u.x + (d - a) * u.y + k * u.x * u.y;
  return vec3(du.x * (b - a + k * u.y), du.y * (d - a + k * u.x), n);
}

// The two octaves, each faded to its mean where its cell spans under two
// pixels. foot is the pixel's footprint on the ground in metres. The fade is
// written as 1.0 minus a rising smoothstep because GLSL leaves smoothstep
// undefined for a first edge above the second. Mirrors farClump.
vec3 farClump(vec2 p, float foot) {
  vec3 o1 = farClumpOctave(p, FAR_CLUMP_CELL.x, vec2(0.0));
  vec3 o2 = farClumpOctave(p, FAR_CLUMP_CELL.y, FAR_CLUMP_SALT);
  float b1 = FAR_CLUMP_WEIGHT.x * (1.0 - smoothstep(0.5, 1.0, foot / FAR_CLUMP_CELL.x));
  float b2 = FAR_CLUMP_WEIGHT.y * (1.0 - smoothstep(0.5, 1.0, foot / FAR_CLUMP_CELL.y));
  return vec3(b1 * o1.xy + b2 * o2.xy, 0.5 + b1 * (o1.z - 0.5) + b2 * (o2.z - 0.5));
}
`);
  }, timeLimit(5_000));

  it("keeps the low band and drops the other with TERRAINFARLOW, and the reverse without it", async () => {
    const low = await processFx(farFx, ["#define TERRAINFARLOW"]);
    expect(low).toContain("const vec2 FAR_COVER_BAND = vec2(14.4, 18.0);");
    expect(low).not.toContain("vec2(24.0, 30.0)");
    const high = await processFx(farFx, []);
    expect(high).toContain("const vec2 FAR_COVER_BAND = vec2(24.0, 30.0);");
    expect(high).not.toContain("vec2(14.4, 18.0)");
    for (const out of [low, high]) {
      for (const name of ["farCoverWeight(", "farClumpOctave(", "farClump("]) expect(out, name).toContain(name);
    }
  }, timeLimit(5_000));

  it("gives the sun's line its two constants from the twin", () => {
    expect(TERRAIN_SUN_INJECTION_CODE).toContain(`*mix(${glslFloat(FAR_SELF_SHADOW)},1.0,clamp(dot(viewDirectionW,preInfo.L),0.0,1.0))`);
    expect(TERRAIN_SUN_INJECTION_CODE).toContain(`/preInfo.NdotL,${glslFloat(FAR_SUN_GAIN_MAX)})*`);
  }, timeLimit(5_000));
});
