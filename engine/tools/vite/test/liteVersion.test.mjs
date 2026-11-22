import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LITE_PACKAGE, liteVersion } from '../../../vite/liteVersion.mjs';

// The engine's own folder (this is engine/tools/vite/test/), from here; the game's client from the game's root, where the suite is started.
const ENGINE = new URL('../../../', import.meta.url);
const CLIENT = pathToFileURL(`${process.cwd()}/client/`);
const pin = (value) => JSON.stringify({ dependencies: { [LITE_PACKAGE]: value } });

describe("the version of Babylon Lite the page is built with", () => {
  it("is the tag the engine's package pins, which names the patches the hike is drawn with", () => {
    const version = liteVersion(readFileSync(new URL('package.json', ENGINE), 'utf8'));
    expect(version).toMatch(/^v\d+\.\d+\.\d+-dayhike\.\d+$/);
    // The installed package says only the release the tag stands on: the same for every tag made on it.
    const installed = JSON.parse(readFileSync(new URL('../node_modules/@babylonjs/lite/package.json', CLIENT), 'utf8')).version;
    expect(version.startsWith(`v${installed}-`)).toBe(true);
  });

  it('reads the tag after the # of a repository pin, and a plain version as written', () => {
    expect(liteVersion(pin('github:csarkosh/babylon-lite#v1.39.3-dayhike.7'))).toBe('v1.39.3-dayhike.7');
    expect(liteVersion(pin('git+https://github.com/csarkosh/babylon-lite.git#v1.40.0-dayhike.1'))).toBe('v1.40.0-dayhike.1');
    expect(liteVersion(pin('1.39.3'))).toBe('1.39.3');
  });

  it('refuses a package that does not pin it, or pins it with no tag', () => {
    expect(() => liteVersion(JSON.stringify({ dependencies: {} }))).toThrow(/not among the engine's dependencies/);
    expect(() => liteVersion(JSON.stringify({}))).toThrow(/not among the engine's dependencies/);
    expect(() => liteVersion(pin('github:csarkosh/babylon-lite#'))).toThrow(/pinned with no tag/);
  });

  it("is defined for the page by the engine's preset, and typed where the page reads it", () => {
    const preset = readFileSync(new URL('vite/preset.mjs', ENGINE), 'utf8');
    expect(preset).toContain("__LITE_VERSION__: JSON.stringify(liteVersion(readFileSync(new URL('package.json', ENGINE), 'utf8'))),");
    // Declared by the engine, whose shell reads it, and included in the client's own typecheck.
    expect(readFileSync(new URL('src/env.d.ts', ENGINE), 'utf8')).toContain('declare const __LITE_VERSION__: string;');
    // By the package's own place among the installed modules, which is the engine's folder here and an installed copy elsewhere.
    expect(readFileSync(new URL('tsconfig.json', CLIENT), 'utf8')).toMatch(/"include": \[[^\]]*"\.\.\/node_modules\/@csarkosh\/engine\/src\/env\.d\.ts"[^\]]*\]/);
    expect(readFileSync(new URL('../node_modules/@csarkosh/engine/src/env.d.ts', CLIENT), 'utf8')).toContain('declare const __LITE_VERSION__: string;');
    // The page names it once, in what every telemetry row carries.
    const shell = readFileSync(new URL('src/shell.ts', ENGINE), 'utf8');
    expect(shell.match(/__LITE_VERSION__/g)).toHaveLength(1);
    expect(shell).toContain('      lite: __LITE_VERSION__,');
  });
});
