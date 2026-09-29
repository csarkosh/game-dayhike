// Types for the client suite, which imports `corpus.mjs` from TypeScript.

import type { CorpusStage, Shared } from "./buildMap.mjs";

export declare const STAGE_FORMAT: string;
export declare const RECORDED: string;
export declare function refusalText(error: unknown): string;
export declare function cutBlocks(text: string): string[];
export declare function blockId(text: string): string;
export declare function blockPath(id: string): string;
export declare function stagePath(entry: CorpusStage, shared: Shared): string;
export declare function expandedPath(entry: CorpusStage, shared: Shared): string;
export declare function stageFileText(blocks: readonly string[]): string;
export declare function readCorpusDir(
  dir: string,
  shared: Shared,
): { stages: CorpusStage[]; files: string[]; blocks: { files: number; bytes: number }; unused: string[]; others: string[] };
export declare function writeExpanded(dir: string, stages: readonly CorpusStage[], shared: Shared): { written: number; removed: number };
export declare function removeIfEmpty(path: string): void;
export declare function removeCorpusFiles(dir: string): void;
