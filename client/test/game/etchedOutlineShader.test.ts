import { describe, it, expect } from "vitest";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import etchedOutlineFragment from "../../src/game/shaders/etchedOutline.fragment.fx?raw";

/**
 * Two consecutive defects in etchedOutline.fragment.fx's COMMENTS (never its
 * shader logic) were invisible to NullEngine, because NullEngine never
 * compiles GLSL — it only exercises the Babylon-object wiring in
 * `stylize.test.ts`. Both defects lived one layer below that: in Babylon's
 * own string-level shader preprocessor, which runs equally well in plain
 * Node, no WebGL context required. This file closes that gap by running the
 * REAL preprocessor, not a hand-rolled reimplementation of it.
 *
 * The first: a trailing `// comment` containing a mid-line semicolon split
 * into a bare, uncommented GLSL fragment. The second: a comment that merely
 * SPELLED a hashed preprocessor keyword (`#ifdef`/`#endif`, as prose about
 * the first bug) was itself parsed as a real conditional, silently
 * dropping everything through the file's next real `#endif` — every uniform,
 * `readDepth()`, and `main()`. Both bugs live in
 * `Engines/Processors/{shaderProcessor,shaderCodeCursor}.js`'s
 * `EvaluatePreProcessors` -> `MoveCursor` / `ShaderCodeCursor.lines` path.
 */

/**
 * Runs the shader source through Babylon's own `Process()` — the same
 * function `Materials/effect.functions.js` (`:75`, `:83`) calls to prepare
 * vertex/fragment code before handing it to the GPU driver, i.e. this is not
 * a look-alike reimplementation, it is the production entry point. `Process`
 * early-returns before touching any of the `#ifdef`/`#endif` machinery when
 * `options.processor` is falsy (`shaderProcessor.js`'s `ProcessShaderConversion`:
 * `if (!options.processor) return preparedSourceCode;`), so `processor` here
 * is a minimal but REAL `IShaderProcessor` — every field on that interface
 * except `shaderLanguage` is optional, so `{ shaderLanguage: GLSL }` is
 * enough to take the full real path rather than the early exit.
 */
function processShader(defines: string[]): Promise<string> {
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
  return new Promise((resolve) => {
    Process(etchedOutlineFragment, options, (migratedCode) => resolve(migratedCode));
  });
}

describe("etchedOutline.fragment.fx survives Babylon's real shader preprocessor", () => {
  it("keeps main() and the depth/noise uniforms with no defines (medium tier)", async () => {
    const processed = await processShader([]);
    expect(processed).toContain("void main");
    expect(processed).toContain("uniform sampler2D depthSampler;");
    expect(processed).toContain("uniform sampler2D noiseSampler;");
    // The ETCH_NORMALS-gated block must be ABSENT without its define — this
    // is what proves the conditional is genuinely being evaluated rather
    // than the whole file surviving (or vanishing) undiscriminately.
    expect(processed).not.toContain("uniform sampler2D normalSampler;");
  });

  it("keeps main(), every uniform, AND the normal-tap code with the g-buffer defines (high tier)", async () => {
    const processed = await processShader(["#define ETCH_NORMALS", "#define ETCH_GBUFFER_DEPTH"]);
    expect(processed).toContain("void main");
    expect(processed).toContain("uniform sampler2D depthSampler;");
    expect(processed).toContain("uniform sampler2D noiseSampler;");
    expect(processed).toContain("uniform sampler2D normalSampler;");
    expect(processed).toContain("float crease = max(1.0 - dot(nC, nR), 1.0 - dot(nC, nD));");
  });
});
