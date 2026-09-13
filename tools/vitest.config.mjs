// Test root for tools/: the deploy and release scripts. Plain Node ESM with no TypeScript and no DOM,
// so it needs none of client/'s or server/'s config.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/test/**/*.test.mjs'],
  },
});
