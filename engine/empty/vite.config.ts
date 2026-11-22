import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { enginePreset } from "@csarkosh/engine/vite/preset";

// The empty game's own build and tests: the engine's page with a game of nothing on it.
export default mergeConfig(
  enginePreset(),
  defineConfig({
    base: process.env.EMPTY_BASE ?? "/empty/",
    server: {
      port: 5174,
      proxy: {
        "/ws": { target: "ws://localhost:8080", ws: true },
        "/t": { target: "http://localhost:8080" },
      },
    },
    build: {
      sourcemap: "hidden",
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.ts"],
      // A test here makes a real world from a seed, which takes seconds on a loaded machine.
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
