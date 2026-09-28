// Types for the client suite, which imports `buildMap.mjs` from TypeScript.

type CorpusStage = { stage: "vertex" | "fragment"; flag: boolean; glsl: string };

/** What the tools use of `client/src/game/wgslFormat.ts`. */
type Shared = {
  lookupSalt(parts: { babylon: string; translators: string; staticUniformityOff: boolean }): string;
  stageKey(salt: string, stage: "vertex" | "fragment", flag: boolean, glsl: string): string;
  corpusId(entry: CorpusStage): string;
  corpusText(stages: Iterable<CorpusStage>): string;
  readCorpus(text: string): CorpusStage[];
  mapText(salt: string, entries: ReadonlyMap<string, string>): string;
};

export declare function nodeSalt(shared: Shared, clientDir?: string): string;
export declare function readCorpusDir(dir: string, shared: Shared): { files: { name: string; stages: number }[]; stages: CorpusStage[] };
export declare function buildMap(options: {
  stages: readonly CorpusStage[];
  salt: string;
  translate: (entry: CorpusStage) => string;
  shared: Shared;
  now?: () => number;
}): {
  text: string;
  entries: Map<string, string>;
  translated: { id: string; key: string; stage: "vertex" | "fragment"; ms: number; glslBytes: number; wgslBytes: number }[];
  failed: { id: string; stage: "vertex" | "fragment"; message: string }[];
};
export declare function sizes(text: string): { raw: number; gzip: number; brotli: number };
export declare function formatTimes(text: string, runs?: number): { jsonMs: number; indexMs: number };
export declare function inputsDigest(salt: string, stages: readonly CorpusStage[], shared: Shared): string;
