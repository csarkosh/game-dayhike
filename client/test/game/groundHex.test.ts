import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import head from "../../src/game/shaders/groundHex.fragment.fx?raw";
import fetches from "../../src/game/shaders/groundHexFetch.fragment.fx?raw";
import noise from "../../src/game/shaders/groundHexNoise.fragment.fx?raw";
import { HEX_FETCH_MACROS, terrainHexDefs } from "../../src/game/terrainTexture.js";

/** The include as WebGL2 compiles it: the three files joined. */
const hexFx = head + fetches + noise;
import {
  HEX_LATTICE, HEX_SHARPNESS, HEX_SKEW, HEX_UNSKEW, MACRO_WAVE, MACRO_WEIGHT, MACRO_SLOPE,
  MACRO_LUSH, MACRO_DRY,
} from "../../src/game/groundHexParams.js";

function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }
function glslVec3(c: { r: number; g: number; b: number }): string { return `vec3(${glslFloat(c.r)}, ${glslFloat(c.g)}, ${glslFloat(c.b)})`; }

describe("groundHex.fragment.fx stays in lockstep with groundHexParams.ts", () => {
  it("carries the lattice, sharpness and skew matrices verbatim", () => {
    expect(hexFx).toContain(`const float HEX_LATTICE = ${glslFloat(HEX_LATTICE)};`);
    expect(hexFx).toContain(`const float HEX_SHARPNESS = ${glslFloat(HEX_SHARPNESS)};`);
    expect(hexFx).toContain(`const mat2 HEX_SKEW = mat2(${HEX_SKEW.map(glslFloat).join(", ")});`);
    expect(hexFx).toContain(`const mat2 HEX_UNSKEW = mat2(${HEX_UNSKEW.map(glslFloat).join(", ")});`);
  });
  it("carries the lattice hash token for token", () => {
    expect(hexFx).toContain("fract(0.618034 * c.x + 0.381966 * c.y + 0.0113 * c.x * c.y)");
  });
  it("carries the macro octaves, weights, slope push and tints verbatim", () => {
    expect(hexFx).toContain(`const vec2 MACRO_WAVE = vec2(${glslFloat(MACRO_WAVE[0])}, ${glslFloat(MACRO_WAVE[1])});`);
    expect(hexFx).toContain(`const vec2 MACRO_WEIGHT = vec2(${glslFloat(MACRO_WEIGHT[0])}, ${glslFloat(MACRO_WEIGHT[1])});`);
    expect(hexFx).toContain(`const float MACRO_SLOPE = ${glslFloat(MACRO_SLOPE)};`);
    expect(hexFx).toContain(`const vec3 MACRO_LUSH = ${glslVec3(MACRO_LUSH)};`);
    expect(hexFx).toContain(`const vec3 MACRO_DRY = ${glslVec3(MACRO_DRY)};`);
  });
  it("samples with explicit gradients so the hex seams carry no mip discontinuity, and never discards", () => {
    expect(hexFx).toContain("textureGrad(");
    expect(hexFx).not.toContain("discard");
    expect(hexFx).not.toContain("uniform sampler");
  });
});

describe("the hex include, per engine", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  it("joins back into the original include, byte for byte", () => {
    expect(sha(head + fetches + noise)).toBe("21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb");
    expect(terrainHexDefs(false)).toContain(head + fetches + noise);
  });
  it("gives WebGPU the two fetches as macros and no function taking a sampler", () => {
    const gpu = terrainHexDefs(true);
    expect(gpu).toContain(head + HEX_FETCH_MACROS + noise);
    expect(gpu).not.toMatch(/\w+\s+\w+\s*\([^)]*\bsampler2D(?:Array)?\b[^)]*\)\s*\{/);
    expect(gpu).toContain("#define hexFetch2D(tex, u1, u2, u3, s, dx, dy)");
    expect(gpu).toContain("#define hexFetchArray(tex, u1, u2, u3, s, layer, dx, dy)");
  });
  it("fetches with the same six terms either way", () => {
    const terms = (s: string) =>
      [...s.matchAll(/textureGrad\(tex, (?:vec3\()?u[123](?:, layer\))?, dx, dy\)\.rgb \* \(?s\)?\.[xyz]/g)]
        .map((m) => m[0].replace("(s)", "s"));
    expect(terms(fetches)).toHaveLength(6);
    expect(terms(HEX_FETCH_MACROS)).toEqual(terms(fetches));
  });
});
