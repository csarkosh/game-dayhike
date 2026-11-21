import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { liteVersion } from "../../tools/vite/liteVersion.mjs";

// The empty game's own build and tests: the engine's page with a game of nothing on it.
export default defineConfig({
  define: {
    // The tag of Babylon Lite the engine pins, which every telemetry row carries (`shell.ts`).
    __LITE_VERSION__: JSON.stringify(liteVersion(readFileSync(new URL("../package.json", import.meta.url), "utf8"))),
  },
  base: process.env.EMPTY_BASE ?? "/empty/",
  // The KTX2 decoder the forest's textures are read with stands in the game's public folder until the engine carries its own.
  publicDir: fileURLToPath(new URL("../../client/public", import.meta.url)),
  server: {
    port: 5174,
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/t": { target: "http://localhost:8080" },
    },
  },
  build: {
    sourcemap: "hidden",
    // Model and ground-texture files stay files, as in the game's build: inlined, each would be parsed as script.
    assetsInlineLimit: (file) => (file.endsWith(".glb") || (file.endsWith(".webp") && file.includes("/textures/ground.")) ? false : undefined),
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // A test here makes a real world from a seed, which takes seconds on a loaded machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
