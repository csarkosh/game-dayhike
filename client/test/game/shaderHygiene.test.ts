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
 * through the REAL preprocessor to prove its own code survives: a file that
 * declares a top-level function must still declare it once processed, and
 * every file must still have at least one line of real code left, not just
 * directives and comments. A splice file gated entirely behind its own
 * `#ifdef`/`#ifndef`/`#if defined(...)` (a plugin's define, read straight out
 * of the file's own guards) is processed with exactly those defines turned
 * on, so its gated body is what gets checked rather than stripped away.
 */
function definesGatedIn(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/#\s*(?:ifdef|ifndef)\s+(\w+)/g)) names.add(m[1] as string);
  for (const m of source.matchAll(/defined\(\s*(\w+)\s*\)/g)) names.add(m[1] as string);
  return [...names];
}

function processShader(source: string, defines: string[]): Promise<string> {
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

    it(`${file}: survives Babylon's real preprocessor with its own gates enabled`, async () => {
      const declared = [...source.matchAll(/^(?:vec[234]|float|mat[34]|void)\s+(\w+)\s*\(/gm)].map((m) => m[1]);
      const defines = definesGatedIn(source).map((n) => `#define ${n}`);
      const processed = await processShader(source, defines);
      for (const name of declared) expect(processed, `${file} lost ${name}`).toContain(`${name}(`);
      const bodyLines = processed.split("\n").filter((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("#");
      });
      expect(bodyLines.length, `${file}: no code survived the preprocessor`).toBeGreaterThan(0);
    });
  }
});
