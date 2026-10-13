import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { wgslMapPlugin } from "../tools/wgsl/lib/mapPlugin.mjs";
import { translatorDigests } from "../tools/wgsl/lib/translators.mjs";
import { timeLimit } from "./test/helpers/timeLimit.js";

/** This package's directory, where its imports resolve from. */
const CLIENT = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    // The WGSL maps of the shader corpus, one a quality tier, the WebGPU
    // shader lookup's first source: hashed assets of the WebGPU chunk in the
    // build, made on the dev server as it starts (`tools/wgsl/lib/mapPlugin.mjs`).
    wgslMapPlugin({
      mapDir: fileURLToPath(new URL("shaders/map/", import.meta.url)),
      tool: fileURLToPath(new URL("../tools/wgsl/build-map.mjs", import.meta.url)),
    }),
    {
      // The admin host's token module (`src/admin/auth.ts` imports `/auth.js`)
      // is no file of this package: in the build it is external
      // (`vite.admin.config.ts`), and on the dev server it is left to the
      // browser the same way, which asks for it by that path and reaches the
      // shell's local preview through the proxy below. Without this the dev
      // server refuses to serve the admin page's module graph at all.
      name: "dayhike-admin-shell-external",
      apply: "serve",
      resolveId(id) {
        return id === "/auth.js" ? { id, external: true } : null;
      },
    },
  ],
  define: {
    // The SHA-256 of each shader translator as Babylon ships it, its
    // WebAssembly and its JavaScript loader, `glslang=<hex>|twgsl=<hex>|
    // glslang.js=<hex>|twgsl.js=<hex>`: part of the salt of every key the
    // WebGPU shader lookup makes (`shaderLookup.ts`), so a translator that
    // changes makes every stored translation unreachable. Computed here, once
    // a build, so the page never hashes 2.7 MB; by the function the build's
    // translation of the corpus computes its salt with (`tools/wgsl/`).
    __WGSL_TRANSLATORS__: JSON.stringify(translatorDigests(CLIENT)),
  },
  // The web build lives under games.csarko.sh/dayhike; the desktop shell serves
  // from its own origin at /. The deploy scripts set DAYHIKE_BASE per build and
  // the router reads the result back from import.meta.env.BASE_URL, so no route
  // code spells the prefix. Development uses the web value, so the dev URL is
  // http://localhost:5173/dayhike/.
  base: process.env.DAYHIKE_BASE ?? "/dayhike/",
  server: {
    port: 5173,
    proxy: {
      // Keeps the WebSocket same-origin in development, so there is no CORS or
      // mixed-content surprise when this later runs behind HTTPS. The path is
      // passed through rather than rewritten, so development and production
      // both use `/ws`.
      "/ws": { target: "ws://localhost:8080", ws: true },
      // The telemetry route, for a dev page started with `?telemetry=on`: the
      // dev server process serves both roles (`server/src/index.ts`).
      "/t": { target: "http://localhost:8080" },
      // The admin host's shell, for the admin page in development
      // (http://localhost:5173/dayhike/admin/?preview): its token module and
      // its stylesheet live at the host's root (`src/admin/auth.ts`,
      // `admin/index.html`), so they come from the shell's local preview,
      // csarko.sh's `admin/` served on 8788. Without it running the page
      // still loads its own styles and fails only at the import.
      "/auth.js": { target: "http://localhost:8788" },
      "/theme.css": { target: "http://localhost:8788" },
    },
  },
  build: {
    // Source maps, written beside the chunks but not referenced by them: the
    // deploy keeps them out of the site and stores them by build sha, so a
    // telemetry stack can be read back (`tools/telemetry/symbolicate.mjs`).
    sourcemap: "hidden",
    // One page, the game. The admin page (`admin/index.html`) is served from
    // the shared admin host under its own base, so it has a build of its own
    // (`vite.admin.config.ts`) and is not an input here; the dev server still
    // serves it, at /dayhike/admin/.
    rollupOptions: {
      input: fileURLToPath(new URL("index.html", import.meta.url)),
    },
    // Never inline a model, and never inline a ground texture. `game/assetUrls.ts`
    // imports every shipped .glb with `?url`, and `groundMaps.ts`/`terrainTexture.ts`
    // import every `client/assets/textures/ground.*.webp` the same way, so Vite
    // content-hashes them — but Vite turns a `?url` asset under `assetsInlineLimit`
    // (4096 bytes by default) into a base64 `data:` URI instead, no separate
    // request and no cacheable URL either. That is not a hypothetical margin on
    // either side: `clutter.fungus_b.glb` is 4,236 bytes, only 140 over the limit;
    // and centring the RAH texture's AO channel on its own mean (groundMaps.mjs's
    // `packRAH`) — needed so a near-white, low-
    // variance source AO like asphalt's stops darkening the ground unequally per
    // layer — shrank `ground.asphalt.rah.webp` from ~6.5 KB to 2,784 bytes,
    // UNDER the limit, where it would otherwise silently drop out of the hashed,
    // cached set the same way a model would (`tools/deploy/verify.mjs`'s texture
    // check exists to catch exactly this in production). Returning `false` for
    // both opts them out; `undefined` leaves every other asset on the default
    // limit.
    assetsInlineLimit: (file) =>
      file.endsWith(".glb") || (file.endsWith(".webp") && file.includes("/textures/ground."))
        ? false
        : undefined,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // NullEngine given a raw 2D array texture maker (the file says why).
    setupFiles: ["test/setup/nullEngineArrays.ts"],
    // vitest's own defaults (5 s a test, 10 s a hook), scaled like every
    // explicit limit. Only under vitest, which sets VITEST before it loads this
    // file: `vite dev` and `vite build` load it too, and must not read or
    // validate TEST_TIME_SCALE. Under vitest a bad value throws here, before
    // any test runs.
    ...(process.env.VITEST ? { testTimeout: timeLimit(5_000), hookTimeout: timeLimit(10_000) } : {}),
    tags: [
      {
        // Tests whose assertion is a bar on elapsed time, set on the
        // development machine. CI leaves them out
        // (`--tags-filter='!wall-clock'`); a local `npm test` runs them, and
        // `npm run test:wall-clock` runs only them, one file at a time.
        name: "wall-clock",
        description: "asserts on elapsed time; meaningful only on a quiet machine",
      },
    ],
  },
});
