import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";

const SHADERS = join(dirname(fileURLToPath(import.meta.url)), "../../src/game/shaders");
const files = readdirSync(SHADERS).filter((f) => f.endsWith(".fx"));

/**
 * Two comment defects broke shaders twice in this repo, and NullEngine never
 * compiles GLSL so it cannot see either: a trailing `// comment` holding a
 * semicolon is split by Babylon's ShaderCodeCursor into bare code, and a
 * hashed preprocessor keyword merely SPELLED in a comment is parsed as a
 * real directive by MoveCursorRegex. Every .fx file is linted here, and run
 * through the REAL preprocessor to prove main() survives.
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
  return new Promise((resolve) => Process(source, options, (code) => resolve(code)));
}

describe("every shader under src/game/shaders", () => {
  it("exists to be linted", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(join(SHADERS, file), "utf8");

    it(`${file}: no hashed keyword in a comment, no semicolon in a trailing comment`, () => {
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        const commentAt = line.indexOf("//");
        if (commentAt < 0) continue;
        const comment = line.slice(commentAt);
        expect(/#(ifdef|ifndef|if|else|elif|endif|define|undef|include)\b/.test(comment), `${file}: ${line}`).toBe(false);
        if (!trimmed.startsWith("//")) {
          expect(comment.includes(";"), `${file}: ${line}`).toBe(false);
        }
      }
    });

    it(`${file}: survives Babylon's real preprocessor with every function intact`, async () => {
      const declared = [...source.matchAll(/^(?:vec[234]|float|mat[34]|void)\s+(\w+)\s*\(/gm)].map((m) => m[1]);
      expect(declared.length).toBeGreaterThan(0);
      const processed = await processShader(source);
      for (const name of declared) expect(processed, `${file} lost ${name}`).toContain(`${name}(`);
    });
  }
});
