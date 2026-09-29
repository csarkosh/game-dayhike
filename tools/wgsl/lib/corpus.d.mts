// Types for the client suite, which imports `corpus.mjs` from TypeScript.

import type { CorpusStage, Shared } from "./buildMap.mjs";

export declare const STAGE_FILE: RegExp;
export declare const RECORDED: string;
export declare function stageFile(entry: CorpusStage, shared: Shared): string;
export declare function readCorpusDir(dir: string, shared: Shared): { stages: CorpusStage[]; files: string[]; others: string[] };
export declare function removeCorpusFiles(dir: string): void;
export declare function refusalText(error: unknown): string;
