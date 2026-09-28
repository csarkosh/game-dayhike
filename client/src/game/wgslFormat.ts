/**
 * What identifies a WGSL translation: the key of a stage and the salt it is
 * made under (`shaderLookup.ts`). Nothing here imports Babylon or the DOM,
 * so the build's tools can load it under Node and key a stage with the very
 * code the page keys it with.
 */
import { sha256Hex } from "./sha256.js";

/** The format of the key and of what is stored under it. A change to how
 * the key is made, or to what is stored for a key (the text composed for the
 * first translator, `translatorInput`; the translation, `translate` in
 * `lookUpShaders`; the packing, `pack` in `wgslStore.ts`) bumps it, so that
 * no entry made the old way is reachable; `shaderLookup.test.ts` pins the
 * three by their text beside it. */
export const LOOKUP_FORMAT = "dayhike-wgsl/1";

/** What Babylon 9.18 puts before a non-raw stage's defines and code
 * (`_compilePipelineStageDescriptor`, webgpuEngine.pure.js). */
const VERSION_PREFIX = "#version 450\n";
/** The define a stage turns Tint's uniformity analysis off with. */
const UNIFORMITY_OFF = "#define DISABLE_UNIFORMITY_ANALYSIS";

export type Stage = "vertex" | "fragment";

/** The salt: the key's format, Babylon's version (it owns the text around
 * the code and the diagnostic before the WGSL), the translators' own bytes'
 * digests, their WebAssembly and their loaders (`__WGSL_TRANSLATORS__`,
 * computed by the build), and Babylon's page-wide uniformity switch, which
 * no text shows. */
export function lookupSalt(parts: { babylon: string; translators: string; staticUniformityOff: boolean }): string {
  return `${LOOKUP_FORMAT}|babylon=${parts.babylon}|${parts.translators}|staticUA=${parts.staticUniformityOff}`;
}

/** The text Babylon 9.18 hands the first translator for one stage of a
 * non-raw GLSL effect: `_compilePipelineStageDescriptor` passes its version
 * line to `_compileShaderToSpirV`, which puts it and the defines before the
 * code. */
export function translatorInput(code: string, defines: string | null): string {
  return VERSION_PREFIX + (defines ? defines + "\n" : "") + code;
}

/** Whether a stage turns Tint's uniformity analysis off, read as Babylon 9.18
 * reads it: from the processed code, not the defines. */
export function uniformityOff(code: string): boolean {
  return code.indexOf(UNIFORMITY_OFF) >= 0;
}

const encoder = new TextEncoder();
const SEPARATOR = new Uint8Array([0]);

/** A stage's key: SHA-256 over the salt, the stage, its uniformity switch and
 * the exact text the first translator is handed, each apart by a zero byte. */
export function stageKey(salt: string, stage: Stage, flag: boolean, glsl: string): string {
  return sha256Hex(
    encoder.encode(salt),
    SEPARATOR,
    encoder.encode(stage),
    SEPARATOR,
    encoder.encode(flag ? "1" : "0"),
    SEPARATOR,
    encoder.encode(glsl),
  );
}
