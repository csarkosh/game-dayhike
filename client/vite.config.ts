import { defineConfig } from "vitest/config";

export default defineConfig({
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
    // either side: `clutter.fungus_b.glb` is 4,212 bytes, 116 short of the limit;
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
  },
});
