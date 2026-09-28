/// <reference types="vite/client" />

// Declaration merging onto vite/client's own ImportMetaEnv, so the variables are
// typed rather than reached through that interface's `any` index signature.
/** The digests of the two shader translators Babylon ships, their
 * WebAssembly and their loaders, `name=<SHA-256 hex>` joined by `|`, computed
 * by the build
 * (`vite.config.ts`): part of the WebGPU shader lookup's salt
 * (`shaderLookup.ts`), so the page never hashes 2.6 MB. */
declare const __WGSL_TRANSLATORS__: string;

/** The URL of the WGSL map the build ships (`tools/wgsl/lib/mapPlugin.mjs`):
 * a content-hashed asset of the WebGPU chunk; on the dev server, the map it
 * makes as it starts; empty under the suite. */
declare module "virtual:dayhike-wgsl-map" {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  /** The public site's base URL, e.g. https://games.csarko.sh/dayhike. Invites are built on it. */
  readonly VITE_WEB_BASE?: string;
  /** Where latest.json lives; unset in development, so no link and no banner. */
  readonly VITE_DOWNLOADS_URL?: string;
}
