/// <reference types="vite/client" />

// Declaration merging onto vite/client's own ImportMetaEnv, so the variables are
// typed rather than reached through that interface's `any` index signature.
/** The version of Babylon Lite the page is built with, as `client/package.json`
 * pins it: the fork's tag (`v1.39.3-dayhike.7`), read by the build
 * (`vite.config.ts`, `tools/vite/liteVersion.mjs`). Telemetry's `lite`. */
declare const __LITE_VERSION__: string;

/** The table of the environment's reflectance Babylon.js's PBR reads, a
 * PNG as a data URL taken from its installed package as the page is built
 * (`tools/vite/environmentBrdf.mjs`): the renderer on Babylon Lite lights
 * its materials' reflections with the same. */
declare module "virtual:dayhike-environment-brdf" {
  const url: string;
  export default url;
}

/** lib-visits' client, when `index.html` loaded it: `page()` counts a route change as a view. */
interface Window {
  visits?: { page?: () => void; send?: (name: string, data?: Record<string, string | number | boolean>) => void };
}

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  /** The public site's base URL, e.g. https://games.csarko.sh/dayhike. Invites are built on it. */
  readonly VITE_WEB_BASE?: string;
  /** Where latest.json lives; unset in development, so no link and no banner. */
  readonly VITE_DOWNLOADS_URL?: string;
  /** The telemetry route on its Cloud Run service, e.g.
   * https://fps-telemetry-…-uw.a.run.app/t; unset in development, so a dev
   * page sends nothing unless `?telemetry=on` (`net/telemetry.ts`). */
  readonly VITE_TELEMETRY_URL?: string;
  /** The git short sha the client was built from, `-dirty` where the tree
   * was, set by the deploy's build (`tools/deploy/lib/buildClient.mjs`);
   * unset in development. Every telemetry row names it. */
  readonly VITE_BUILD_SHA?: string;
}
