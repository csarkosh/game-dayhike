import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Handed back from the engine's repository: these two checks read Day Hike's own files (its
// client/tsconfig.json and its installed copy of the engine), which the engine's repository
// does not have. They check that the game includes the engine's types for the page's
// __LITE_VERSION__ and can reach the installed package. Paths are from this repository's root.
const CLIENT = new URL('../../../client/', import.meta.url);

describe("the version of Babylon Lite the page is built with", () => {
  it("is typed where the page reads it", () => {
    // By the package's own place among the installed modules: an installed copy of the engine's release.
    expect(readFileSync(new URL('tsconfig.json', CLIENT), 'utf8')).toMatch(/"include": \[[^\]]*"\.\.\/node_modules\/@csarkosh\/engine\/src\/env\.d\.ts"[^\]]*\]/);
    expect(readFileSync(new URL('../node_modules/@csarkosh/engine/src/env.d.ts', CLIENT), 'utf8')).toContain('declare const __LITE_VERSION__: string;');
  });
});
