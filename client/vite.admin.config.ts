import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * The admin page's build, for the shared admin host.
 *
 * The page (`admin/index.html`, `src/admin/`) is served from
 * admin.csarko.sh/game-dayhike/ (the csarko.sh repository's `admin/`), not
 * from the game's site, so it is built apart from the game: Vite has one
 * `base` a build, and the game's is `/dayhike/` (`vite.config.ts`). This
 * config builds the admin entry alone, under the host's path, to
 * `dist-admin/`, which `tools/deploy/admin.mjs` uploads for the host to
 * pull. The tests and the dev server use `vite.config.ts`; this one is for
 * `npm run build:admin` only.
 *
 *   DAYHIKE_ADMIN_BASE  the path on the host, `/game-dayhike/` unless set
 */

/** This package's directory, where its imports resolve from. */
const CLIENT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vite writes an entry's page at its path under the root, `admin/index.html`
 * here; the host serves the folder as the page's root, so the page moves to
 * the top of the output once the bundle is on disk (the page is written after
 * `generateBundle`, so it is moved there rather than renamed in the bundle).
 * The hashed assets are referenced by the base, so nothing else moves.
 */
function pageAtRoot(outDir: string): Plugin {
  return {
    name: "dayhike-admin-page-at-root",
    closeBundle() {
      const written = join(outDir, "admin", "index.html");
      if (!existsSync(written)) throw new Error(`the admin page was not written at ${written}`);
      renameSync(written, join(outDir, "index.html"));
      rmSync(join(outDir, "admin"), { recursive: true });
    },
  };
}

const OUT_DIR = join(CLIENT, "dist-admin");

export default defineConfig({
  plugins: [pageAtRoot(OUT_DIR)],
  base: process.env.DAYHIKE_ADMIN_BASE ?? "/game-dayhike/",
  // The game's public files (favicons, the KTX2 decoder) are the game's; the
  // host serves its own favicon at its root, which the page's links name.
  publicDir: false,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // Source maps, written beside the chunks but not referenced by them: the
    // deploy keeps them off the host and stores them by build sha, as the
    // game's (`tools/telemetry/symbolicate.mjs` reads a stack against them).
    sourcemap: "hidden",
    rollupOptions: {
      input: fileURLToPath(new URL("admin/index.html", import.meta.url)),
      // The host's token module (`src/admin/auth.ts`): served at the host's
      // root, shared by every app's page, resolved by the browser and never
      // bundled.
      external: ["/auth.js"],
    },
  },
  root: CLIENT,
});
