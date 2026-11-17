import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LITE_PACKAGE, liteVersion } from '../liteVersion.mjs';

const CLIENT = new URL('../../../client/', import.meta.url);
const pin = (value) => JSON.stringify({ dependencies: { [LITE_PACKAGE]: value } });

describe("the version of Babylon Lite the page is built with", () => {
  it("is the tag the client's package pins, which names the patches the hike is drawn with", () => {
    const version = liteVersion(readFileSync(new URL('package.json', CLIENT), 'utf8'));
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
    expect(() => liteVersion(JSON.stringify({ dependencies: {} }))).toThrow(/not among the client's dependencies/);
    expect(() => liteVersion(JSON.stringify({}))).toThrow(/not among the client's dependencies/);
    expect(() => liteVersion(pin('github:csarkosh/babylon-lite#'))).toThrow(/pinned with no tag/);
  });

  it("is defined for the page by the client's build, and typed where the page reads it", () => {
    const config = readFileSync(new URL('vite.config.ts', CLIENT), 'utf8');
    expect(config).toContain('__LITE_VERSION__: JSON.stringify(liteVersion(readFileSync(new URL("package.json", import.meta.url), "utf8"))),');
    expect(readFileSync(new URL('src/env.d.ts', CLIENT), 'utf8')).toContain('declare const __LITE_VERSION__: string;');
    // The page names it once, in what every telemetry row carries.
    const main = readFileSync(new URL('src/main.ts', CLIENT), 'utf8');
    expect(main.match(/__LITE_VERSION__/g)).toHaveLength(1);
    expect(main).toContain('    lite: __LITE_VERSION__,');
  });
});
