// Types for `preset.mjs`, which a game's Vite config imports as `@csarkosh/engine/vite/preset`.
import type { Plugin, UserConfig } from "vite";

/** Makes every file under `engine/public/` part of the game's site, at its path under the game's base. */
export declare function enginePublic(): Plugin;
/** The engine's part of a game's Vite config: the Lite version, the inline rule and the engine's public files. */
export declare function enginePreset(): UserConfig;
