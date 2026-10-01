// Types for the client suite, which imports `files.mjs` from TypeScript.

export declare const CORPUS_DIR: string;
export declare const NODE_CORPUS_DIR: string;
export declare const MAP_DIR: string;
export declare function mapName(tier: string): string;
export declare function mapFile(dir: string, tier: string): string;
export declare function inputsFile(dir: string): string;
export declare function writeWhole(file: string, text: string): void;
