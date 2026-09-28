import { describe, it, expect } from 'vitest';
import { MAX_STATIC_CHUNKS, bundleMapProblems, staticChunks } from '../lib/bundle.mjs';

const hex = (c) => c.repeat(64);
const TRANSLATORS = `glslang=${hex('a')}|twgsl=${hex('b')}|glslang.js=${hex('c')}|twgsl.js=${hex('d')}`;
const SALT = `dayhike-wgsl/1|babylon=9.18.0|${TRANSLATORS}|staticUA=false`;
const MAP = JSON.stringify({ format: 'dayhike-wgsl-map/1', salt: SALT, entries: { [hex('e')]: '@vertex fn main() {}' } });
// The WebGPU chunk, carrying the formats, the digests and the switch, not Babylon's version.
const CHUNK =
  'import{Ze}from"./index-AAAAAAAA.js";var Ci=`dayhike-wgsl/1`,Mf=`dayhike-wgsl-map/1`;' +
  `function Ei(){return\`\${Ci}|babylon=\${Ze.Version}|\${"${TRANSLATORS}"}|staticUA=\${Tn.DisableUniformityAnalysis}\`}` +
  'Tn.DisableUniformityAnalysis=!1;var Wm=`/dayhike/assets/wgsl-map-Qx3_Zk9a.json`;';

/**
 * A bundle as the build splits it: the entry chunk imports a vendor chunk,
 * which re-exports a shared chunk, statically, and the WebGPU chunk
 * dynamically. Babylon's version is in the shared chunk alone. `change`
 * replaces chunks; null answers as a missing file does.
 */
function bundle(change = {}) {
  const files = {
    'index-AAAAAAAA.js': 'import{a as e}from"./vendor-BBBBBBBB.js";const l=()=>import("./gpuEngine-CCCCCCCC.js");',
    'vendor-BBBBBBBB.js': 'export{b}from"./shared-DDDDDDDD.js";export const a=1;',
    'shared-DDDDDDDD.js': 'var Ze=class{static get Version(){return`9.18.0`}};export const b=Ze;',
    'gpuEngine-CCCCCCCC.js': CHUNK,
    ...change,
  };
  return async (name) => files[name] ?? null;
}

describe('the chunks the entry chunk loads with it', () => {
  it('are it and every chunk it imports or re-exports statically, never one it imports dynamically', async () => {
    const walk = await staticChunks('index-AAAAAAAA.js', bundle());
    expect([...walk.chunks.keys()]).toEqual(['index-AAAAAAAA.js', 'vendor-BBBBBBBB.js', 'shared-DDDDDDDD.js']);
    expect(walk.problems).toEqual([]);
  });

  it('fail plainly where one does not answer, and where there are more than the ceiling', async () => {
    const missing = await staticChunks('index-AAAAAAAA.js', bundle({ 'vendor-BBBBBBBB.js': null }));
    expect(missing.problems).toEqual(['assets/vendor-BBBBBBBB.js, which the entry chunk loads, could not be read']);
    expect(MAX_STATIC_CHUNKS).toBe(500);
    const many = await staticChunks('index-AAAAAAAA.js', bundle(), 2);
    expect(many.problems).toEqual(['the entry chunk loads more than 2 chunks statically; the walk stopped there (MAX_STATIC_CHUNKS)']);
  });
});

describe("the map against the bundle, as the deploy check and the build's check both read it", () => {
  it("finds Babylon's version where it is only in a chunk the entry imports, and names that chunk", async () => {
    const found = await bundleMapProblems({ entry: 'index-AAAAAAAA.js', read: bundle(), mapText: MAP, chunkSource: CHUNK });
    expect(found.problems).toEqual([]);
    expect(found.carriers).toEqual(['shared-DDDDDDDD.js']);
  });

  it('refuses the map where no chunk carries the version, and where a chunk does not answer', async () => {
    const absent = await bundleMapProblems({
      entry: 'index-AAAAAAAA.js',
      read: bundle({ 'shared-DDDDDDDD.js': 'export const b=1;' }),
      mapText: MAP,
      chunkSource: CHUNK,
    });
    expect(absent.problems).toEqual(['its salt was made against Babylon 9.18.0, which the bundle does not carry']);
    expect(absent.carriers).toEqual([]);
    const missing = await bundleMapProblems({ entry: 'index-AAAAAAAA.js', read: bundle({ 'shared-DDDDDDDD.js': null }), mapText: MAP, chunkSource: CHUNK });
    expect(missing.problems).toEqual([
      'assets/shared-DDDDDDDD.js, which the entry chunk loads, could not be read',
      'its salt was made against Babylon 9.18.0, which the bundle does not carry',
    ]);
  });
});
