// Types for the page's build config, which imports `mapPlugin.mjs` from TypeScript.
import type { Plugin } from "vite";

export declare const WGSL_MAP_ID: "virtual:dayhike-wgsl-map";
export declare function wgslMapPlugin(options: { mapFile: string; tool: string }): Plugin;
