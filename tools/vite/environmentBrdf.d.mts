// Types for `environmentBrdf.mjs`, which `client/vite.config.ts` imports.
import type { Plugin } from 'vite';

/** The module the renderer imports the table's URL from. */
export declare const ENVIRONMENT_BRDF_ID: string;
/** The table's data URL in `text`, the text of Babylon.js's `brdfTextureTools.js`. */
export declare function environmentBrdfUrl(text: string): string;
/** The plugin, reading the table from `from`, the path of Babylon.js's `brdfTextureTools.js`. */
export declare function environmentBrdfPlugin(options: { from: string }): Plugin;
