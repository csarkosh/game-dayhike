import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { timeLimit } from "./test/helpers/timeLimit.js";

/**
 * The SHA-256 of each shader translator as Babylon ships it, its WebAssembly
 * and its JavaScript loader (which holds the translator's defaults and its
 * wrapper), `glslang=<hex>|twgsl=<hex>|glslang.js=<hex>|twgsl.js=<hex>`: part
 * of the salt of every key the WebGPU shader lookup makes
 * (`shaderLookup.ts`), so a translator that changes makes every stored
 * translation unreachable. Computed here, once a build, so the page never
 * hashes 2.7 MB.
 */
function translatorDigests(): string {
  const resolve = createRequire(import.meta.url).resolve;
  const digest = (name: string, kind: "wasm" | "js"): string =>
    createHash("sha256").update(readFileSync(resolve(`@babylonjs/core/assets/${name}/${name}.${kind}`))).digest("hex");
  return `glslang=${digest("glslang", "wasm")}|twgsl=${digest("twgsl", "wasm")}|glslang.js=${digest("glslang", "js")}|twgsl.js=${digest("twgsl", "js")}`;
}

export default defineConfig({
  define: {
    __WGSL_TRANSLATORS__: JSON.stringify(translatorDigests()),
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
    },
  },
  build: {
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
