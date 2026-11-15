import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_BRDF_ID, environmentBrdfPlugin, environmentBrdfUrl } from '../environmentBrdf.mjs';

const FROM = createRequire(new URL('../../../client/package.json', import.meta.url)).resolve('@babylonjs/core/Misc/brdfTextureTools.js');

describe('the environment BRDF table', () => {
  it("is found in the installed Babylon.js as a PNG's data URL", () => {
    const url = environmentBrdfUrl(readFileSync(FROM, 'utf8'));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    // The PNG's signature, and its header's size: a 256 by 256 table.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
  });

  it('refuses a text that holds no table', () => {
    expect(() => environmentBrdfUrl('export const nothing = 1;')).toThrow(/no environment BRDF table/);
  });

  it('serves the table as the default export of its module, and no other module', () => {
    const plugin = environmentBrdfPlugin({ from: FROM });
    const resolved = plugin.resolveId(ENVIRONMENT_BRDF_ID);
    expect(resolved).toBe(`\0${ENVIRONMENT_BRDF_ID}`);
    expect(plugin.resolveId('./elsewhere.js')).toBeNull();
    expect(plugin.load.call({}, './elsewhere.js')).toBeNull();
    const code = plugin.load.call({}, resolved);
    expect(code).toBe(`export default ${JSON.stringify(environmentBrdfUrl(readFileSync(FROM, 'utf8')))};`);
  });
});
