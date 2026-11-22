// Types for `liteVersion.mjs`, which the engine's Vite configs import.

/** The dependency the hike's renderer is. */
export declare const LITE_PACKAGE: string;
/** The pinned version in `text`, the text of the engine's `package.json`: the tag of a repository pin. */
export declare function liteVersion(text: string): string;
