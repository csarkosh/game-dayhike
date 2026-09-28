import { describe, it, expect } from 'vitest';
import { findMapUrl } from '../lib/modelUrls.mjs';
import { mapProblems } from '../lib/wgslMap.mjs';

const hex = (c) => c.repeat(64);
const TRANSLATORS = `glslang=${hex('a')}|twgsl=${hex('b')}|glslang.js=${hex('c')}|twgsl.js=${hex('d')}`;
// A slice shaped like the real WebGPU chunk: the key's format, the map's, the
// translators' digests the build baked in, and the map's URL, base-absolute.
const CHUNK =
  'var Ci=`dayhike-wgsl/1`,Mf=`dayhike-wgsl-map/1`;' +
  `function Ei(){return\`\${Ci}|babylon=\${Ze.Version}|\${"${TRANSLATORS}"}|staticUA=\${Tn.DisableUniformityAnalysis}\`}` +
  'var Wm=`/dayhike/assets/wgsl-map-Qx3_Zk9a.json`,dr=`/dayhike/assets/glslang-G7Yt_-32.wasm`;';
const SALT = `dayhike-wgsl/1|babylon=9.18.0|${TRANSLATORS}|staticUA=false`;
const map = (fields) => JSON.stringify({ format: 'dayhike-wgsl-map/1', salt: SALT, entries: { [hex('e')]: '@vertex fn main() {}' }, ...fields });

describe('findMapUrl', () => {
  it('finds the map the WebGPU chunk names, and nothing where there is none', () => {
    expect(findMapUrl(CHUNK)).toBe('/dayhike/assets/wgsl-map-Qx3_Zk9a.json');
    expect(findMapUrl('`/dayhike/assets/wgsl-mapx-Qx3_Zk9a.json`')).toBeNull();
    expect(findMapUrl('`/dayhike/assets/glslang-G7Yt_-32.wasm`')).toBeNull();
  });
});

describe('mapProblems', () => {
  it('passes a map of this build that holds translations', () => {
    expect(mapProblems(map({}), CHUNK)).toEqual([]);
  });

  it('fails a map that does not parse, as the site answers a missing file with its page', () => {
    expect(mapProblems('<!doctype html><title>Day Hike</title>', CHUNK)).toEqual(['the map does not parse as JSON']);
    expect(mapProblems('null', CHUNK)).toEqual(['the map is not an object']);
  });

  it("fails a map of another format, or made for another build's translators or key", () => {
    expect(mapProblems(map({ format: 'dayhike-wgsl-map/2' }), CHUNK)).toEqual([
      'its format "dayhike-wgsl-map/2" is not the one the WebGPU chunk reads',
    ]);
    const otherTranslators = SALT.replace(hex('a'), hex('f'));
    expect(mapProblems(map({ salt: otherTranslators }), CHUNK)).toHaveLength(1);
    expect(mapProblems(map({ salt: otherTranslators }), CHUNK)[0]).toMatch(/^its salt ".*"… is not this build's$/);
    expect(mapProblems(map({ salt: SALT.replace('dayhike-wgsl/1', 'dayhike-wgsl/2') }), CHUNK)).toHaveLength(1);
    expect(mapProblems(map({}), CHUNK.replace(TRANSLATORS, 'translators=unknown'))).toEqual([
      "the WebGPU chunk carries no translators' digests to check the salt against",
    ]);
  });

  it('fails a map that holds no translations', () => {
    expect(mapProblems(map({ entries: {} }), CHUNK)).toEqual(['it is empty']);
    expect(mapProblems(map({ entries: [] }), CHUNK)).toEqual(['it has no entries']);
    expect(mapProblems(map({ entries: { [hex('e')]: 7 } }), CHUNK)).toEqual(['an entry is not WGSL text']);
  });
});
