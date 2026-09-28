/// <reference types="vite/client" />

// Declaration merging onto vite/client's own ImportMetaEnv, so the variables are
// typed rather than reached through that interface's `any` index signature.
/** The digests of the two shader translators' WebAssembly Babylon ships,
 * `name=<SHA-256 hex>` joined by `|`, computed by the build
 * (`vite.config.ts`): part of the WebGPU shader lookup's salt
 * (`shaderLookup.ts`), so the page never hashes 2.6 MB. */
declare const __WGSL_TRANSLATORS__: string;

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  /** The public site's base URL, e.g. https://games.csarko.sh/dayhike. Invites are built on it. */
  readonly VITE_WEB_BASE?: string;
  /** Where latest.json lives; unset in development, so no link and no banner. */
  readonly VITE_DOWNLOADS_URL?: string;
}
