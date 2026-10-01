// Types for the client suite, which imports `corpus.mjs` from TypeScript.

import type { CorpusStage, Shared } from "./buildMap.mjs";

export declare const STAGE_FILE: RegExp;
export declare const RECORDED: string;
export declare const TIERS_FILE: "tiers.json";
export declare const TIERS_FORMAT: "dayhike-wgsl-tiers/1";
export declare function stageFile(entry: CorpusStage, shared: Shared): string;
export declare function stageId(entry: CorpusStage, shared: Shared): string;
export declare function tiersText(tiers: ReadonlyMap<string, Iterable<string>>, shared: Shared): string;
export declare function readTiers(text: string, shared: Shared): Map<string, string[]>;
export declare function readCorpusDir(
  dir: string,
  shared: Shared,
): { stages: CorpusStage[]; files: string[]; others: string[]; tiers: Map<string, string[]> };
export declare function removeCorpusFiles(dir: string): void;
export declare function refusalText(error: unknown): string;
