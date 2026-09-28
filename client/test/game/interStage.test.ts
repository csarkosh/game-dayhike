import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { WEBGPU_REQUIRED_LIMITS } from "../../src/game/engineChoice.js";
import { pluginsInStates } from "./helpers/pluginText.js";

/**
 * The WebGPU limit on inter-stage variables, held the way the specification
 * counts it ("validating inter-stage interfaces", WebGPU): a vertex stage may
 * write at most `maxInterStageShaderVariables` user-defined outputs, each at a
 * location below it; a fragment stage may read at most that many user-defined
 * inputs, less one for each inter-stage built-in it reads (`front_facing`,
 * `sample_index`, `sample_mask`, `primitive_index`, `subgroup_invocation_id`,
 * `subgroup_size`). The position built-in does not count.
 *
 * The suite cannot translate a shader to WGSL (the translators run only in a
 * browser), and on `NullEngine` Babylon builds a material without the engine
 * features that bring most of its own varyings (shadow cascades, derivatives
 * for the normal map), so a whole material's count cannot be read here. What
 * can be: each of the game's plugins' own varyings, parsed from the GLSL it
 * injects, sized as Babylon places them on WebGPU (a `mat3` takes three
 * locations), and the measured materials' totals, their Babylon share taken
 * from the browser's reading (the verification note, §6.1). Two rules of
 * Babylon's make the fragment count the vertex count: on WebGPU its GLSL
 * processor gives every vertex output a location and declares every one of
 * them in the fragment stage too (`_missingVaryings`), and a two-sided PBR
 * material reads `gl_FrontFacing`.
 */

/** Locations a GLSL type takes, as Babylon's WebGPU processing context counts them. */
const LOCATIONS: Readonly<Record<string, number>> = { mat2: 2, mat3: 3, mat4: 4 };

/** The locations of the varyings a plugin injects into the vertex stage, by name. */
function injectedVaryings(code: Record<string, string> | null): Map<string, number> {
  const found = new Map<string, number>();
  for (const text of Object.values(code ?? {})) {
    for (const m of text.matchAll(/\bvarying\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
      const [, type, name, length] = m as unknown as [string, string, string, string | undefined];
      found.set(name, (LOCATIONS[type] ?? 1) * (length === undefined ? 1 : Number(length)));
    }
  }
  return found;
}

/** Each plugin's own varyings, in every state it is drawn in. */
function pluginLocations(): Record<string, number> {
  const built = pluginsInStates();
  try {
    const out: Record<string, number> = {};
    for (const { name, plugin, states } of built.cases) {
      const all = new Map<string, number>();
      for (const enter of states) {
        enter();
        for (const [varying, size] of injectedVaryings(plugin.getCustomCode("vertex"))) all.set(varying, size);
      }
      out[name] = [...all.values()].reduce((sum, n) => sum + n, 0);
    }
    return out;
  } finally {
    built.dispose();
  }
}

/**
 * The materials the browser found at the limit (the verification note, §6.1):
 * the giant fir's and the giant pine's two, whose pipelines failed at 17. The
 * locations Babylon's own varyings take in each are the measured total less
 * the plugins' on it: 17 − 4 and 18 − 6. Both are two-sided, so the fragment
 * stage reads `front_facing` as well.
 */
const MEASURED = [
  { material: "the giant trees' material0", babylon: 13, plugins: ["foliage.TREE"], builtins: 1 },
  { material: "the giant trees' material1", babylon: 12, plugins: ["foliage.TREE", "distanceFade"], builtins: 1 },
] as const;

describe("inter-stage variables on WebGPU", () => {
  const plugins = pluginLocations();
  const limit = WEBGPU_REQUIRED_LIMITS.maxInterStageShaderVariables as number;

  it("pins what each plugin adds, so a new varying is seen and weighed against the limit", () => {
    expect(plugins).toEqual({
      atmosphere: 0,
      cliffTint: 1,
      distanceFade: 2,
      "foliage.BLADES": 4,
      "foliage.BUSH": 4,
      "foliage.DUFF": 4,
      "foliage.FLOWER": 4,
      "foliage.GRASS": 4,
      "foliage.MEADOW": 4,
      "foliage.TREE": 4,
      "foliage.UNDERSTORY": 4,
      foliageLight: 0,
      groundConform: 0,
      skin: 0,
      terrain: 3,
      wing: 0,
    });
  });

  it("holds the measured materials within the device's limit, counted as the specification counts", () => {
    for (const { material, babylon, plugins: attached, builtins } of MEASURED) {
      const outputs = babylon + attached.reduce((sum, name) => sum + (plugins[name] as number), 0);
      // The vertex stage: every output within the count, and the last location below the limit.
      expect(outputs, material).toBeLessThanOrEqual(limit);
      expect(outputs - 1, material).toBeLessThanOrEqual(limit - 1);
      // The fragment stage: Babylon declares every vertex output as an input,
      // and each inter-stage built-in it reads takes one more.
      expect(outputs + builtins, material).toBeLessThanOrEqual(limit);
    }
  });

  it("reads Babylon's rules the count rests on (canaries on the installed engine)", () => {
    const read = (spec: string): string => readFileSync(createRequire(import.meta.url).resolve(spec), "utf8");
    const glsl = read("@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js");
    // Every vertex output is declared in the fragment stage too.
    expect(glsl).toContain("        // inject the missing varying in the fragment shader\n        for (let i = 0; i < this._missingVaryings.length; ++i) {");
    // A matrix takes as many locations as it has columns.
    expect(read("@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js")).toContain("    mat3: 3,\n    mat4: 4,");
    // Babylon's own kernel blur (the halation's) sizes its varyings from the
    // device's limit, so it can never pass it.
    expect(read("@babylonjs/core/Engines/webgpuEngine.pure.js")).toContain("            maxVaryingVectors: this._deviceLimits.maxInterStageShaderVariables,");
    expect(read("@babylonjs/core/PostProcesses/thinBlurPostProcess.js")).toContain("const maxVaryingRows = this.options.engine.getCaps().maxVaryingVectors");
  });

  it("keeps the limit in one place", () => {
    const src = readFileSync(new URL("../../src/game/engineChoice.ts", import.meta.url), "utf8");
    expect(src.match(/maxInterStageShaderVariables: \d+/g)?.length).toBe(1);
  });
});
