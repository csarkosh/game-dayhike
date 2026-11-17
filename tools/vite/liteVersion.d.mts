// Types for `liteVersion.mjs`, which `client/vite.config.ts` imports.

/** The dependency the hike's renderer is. */
export declare const LITE_PACKAGE: string;
/** The pinned version in `text`, the text of `client/package.json`: the tag of a repository pin. */
export declare function liteVersion(text: string): string;
