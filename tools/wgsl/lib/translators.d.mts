// Types for the page's build config and the client suite, which import
// `translators.mjs` from TypeScript.

/** One translator's files: its loader and its WebAssembly. */
export type TranslatorFile = { js: string; wasm: string };

/** The two translators started, as Babylon holds them. */
export type StartedTranslators = {
  glslang: { compileGLSL(glsl: string, stage: string): Uint32Array };
  twgsl: unknown;
  tint: { convertSpirV2WGSL(spirv: Uint32Array, disableUniformityAnalysis?: boolean): string };
};

export declare const CLIENT_DIR: string;
export declare function translatorFiles(clientDir?: string): { glslang: TranslatorFile; twgsl: TranslatorFile };
export declare function translatorDigests(clientDir?: string): string;
export declare function startTranslators(files?: { glslang: TranslatorFile; twgsl: TranslatorFile }): Promise<StartedTranslators>;
export declare function translateStage(
  translators: StartedTranslators,
  entry: { stage: "vertex" | "fragment"; flag: boolean; glsl: string },
): string;
