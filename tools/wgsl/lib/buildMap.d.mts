// Types for the client suite, which imports `buildMap.mjs` from TypeScript.

export type CorpusStage = { stage: "vertex" | "fragment"; flag: boolean; glsl: string };

/** What the tools use of `client/src/game/wgslFormat.ts`. */
export type Shared = {
  MAP_FORMAT: string;
  MAP_MAX_BYTES: number;
  TIERS: readonly string[];
  lookupSalt(parts: { babylon: string; translators: string; staticUniformityOff: boolean }): string;
  stageKey(salt: string, stage: "vertex" | "fragment", flag: boolean, glsl: string): string;
  corpusId(entry: CorpusStage): string;
  corpusText(stages: Iterable<CorpusStage>, tiers?: Iterable<string>): string;
  readCorpus(text: string): CorpusStage[];
  readRecording(text: string): { tiers: readonly string[] | null; stages: CorpusStage[] };
  mapText(salt: string, entries: ReadonlyMap<string, string>, tier?: string): string;
  readMap(text: string, salt: string, tier?: string): { readonly size: number; keys(): IterableIterator<string>; get(key: string): string | null };
};

export declare function nodeSalt(shared: Shared, clientDir?: string): string;
export declare function asciiProblem(text: string): string | null;
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
export declare function entriesOn(
  made: { translated: { id: string; key: string }[]; entries: ReadonlyMap<string, string> },
  tiers: ReadonlyMap<string, readonly string[]>,
  tier: string,
): Map<string, string>;
export declare function sizes(text: string): { raw: number; gzip: number; brotli: number };
export declare function mapSizeProblem(bytes: number, ceiling?: number, named?: string): string | null;
export declare function lineFigures(texts: Iterable<string>): {
  lines: number;
  distinct: number;
  distinctBytes: number;
  masked: { lines: number; distinct: number; distinctBytes: number };
};
export declare function readBackProblems(text: string, salt: string, entries: ReadonlyMap<string, string>, shared: Shared, tier?: string): string[];
export declare function tableFigures(text: string): { lines: number; runs: number };
export declare function readTimes(
  text: string,
  salt: string,
  shared: Shared,
  runs?: number,
): { readMs: number; expandAllMs: number; expandLargestMs: number };
export declare function inputsDigest(salt: string, stages: readonly CorpusStage[], shared: Shared, tiersIndex?: string): string;
