import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { liteVersion } from "./vite/liteVersion.mjs";
import { timeLimit } from "./vite/timeLimit.mjs";

// The engine's own tests, run with `--root engine` (`npm run test:engine`). The empty game
// (`empty/`) has a config of its own and is not collected here.
export default defineConfig({
  define: {
    // The tag of Babylon Lite the engine pins, which every telemetry row carries (`shell.ts`).
    __LITE_VERSION__: JSON.stringify(liteVersion(readFileSync(new URL("package.json", import.meta.url), "utf8"))),
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The engine's tests run under no game's identity (`test/setup/identity.ts`).
    setupFiles: ["test/setup/identity.ts"],
    // vitest's own defaults (5 s a test, 10 s a hook), scaled like every explicit limit. Only
    // under vitest, which sets VITEST before it loads this file: a bad TEST_TIME_SCALE throws
    // here, before any test runs.
    ...(process.env.VITEST ? { testTimeout: timeLimit(5_000), hookTimeout: timeLimit(10_000) } : {}),
    tags: [
      {
        // Tests whose assertion is a bar on elapsed time, set on the development machine. CI
        // leaves them out (`--tags-filter='!wall-clock'`); none stands in this suite today, and
        // the tag is defined so that a test given it is read, not refused as an unknown tag.
        name: "wall-clock",
        description: "asserts on elapsed time; meaningful only on a quiet machine",
      },
    ],
  },
});
