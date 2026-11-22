// Test root for engine/tools/: the engine's scripts (the gate, the frame budget, the previews, the
// comparison, the kernel's build, the Vite preset). Plain Node ESM with no TypeScript and no DOM, so
// it needs none of engine/'s own config. Started from the game's root (`npm run test:engine-tools`):
// the tests that read the game's files (stills, views) read them from there.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/test/**/*.test.mjs'],
  },
});
