import { describe, it, expect } from 'vitest';
import { findMapUrl } from '../lib/modelUrls.mjs';
import { MAP_ENTRY_MAX_CHARS, MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { LIVE_ENTRY_MAX_CHARS, LIVE_MAP_MAX_BYTES, mapProblems } from '../lib/wgslMap.mjs';

const hex = (c) => c.repeat(64);
const TRANSLATORS = `glslang=${hex('a')}|twgsl=${hex('b')}|glslang.js=${hex('c')}|twgsl.js=${hex('d')}`;
// A slice shaped like the real WebGPU chunk: the key's format, the map's, the
// translators' digests the build baked in, Babylon's uniformity switch, and
// the maps' URLs, one a tier, base-absolute.
const CHUNK =
  'var Ci=`dayhike-wgsl/1`,Mf=`dayhike-wgsl-map/2`;' +
  `function Ei(){return\`\${Ci}|babylon=\${Ze.Version}|\${"${TRANSLATORS}"}|staticUA=\${Tn.DisableUniformityAnalysis}\`}` +
  'Tn.DisableUniformityAnalysis=!1;' +
  'var Wm={low:`/dayhike/assets/wgsl-map-low-Lo1_Zk9a.json`,medium:`/dayhike/assets/wgsl-map-medium-Me2_Zk9a.json`,high:`/dayhike/assets/wgsl-map-high-Qx3_Zk9a.json`},' +
  'dr=`/dayhike/assets/glslang-G7Yt_-32.wasm`;';
// And of the entry chunk, which carries Babylon's version.
const ENTRY = 'var Ze=class{static get Version(){return`9.18.0`}static get NpmPackage(){return`babylonjs@9.18.0`}};';
const SALT = `dayhike-wgsl/1|babylon=9.18.0|${TRANSLATORS}|staticUA=false`;
const map = (fields) =>
  JSON.stringify({ format: 'dayhike-wgsl-map/2', salt: SALT, lines: ['@vertex fn main() {}', ''], entries: { [hex('e')]: [0, 1] }, ...fields });

describe('findMapUrl', () => {
  it("finds each tier's map the WebGPU chunk names, and nothing where there is none", () => {
    expect(findMapUrl(CHUNK, 'low')).toBe('/dayhike/assets/wgsl-map-low-Lo1_Zk9a.json');
    expect(findMapUrl(CHUNK, 'medium')).toBe('/dayhike/assets/wgsl-map-medium-Me2_Zk9a.json');
    expect(findMapUrl(CHUNK, 'high')).toBe('/dayhike/assets/wgsl-map-high-Qx3_Zk9a.json');
    // A map of no tier, as the build named it before there was one a tier.
    expect(findMapUrl('`/dayhike/assets/wgsl-map-Qx3_Zk9a.json`', 'high')).toBeNull();
    expect(findMapUrl('`/dayhike/assets/wgsl-map-highx-Qx3_Zk9a.json`', 'high')).toBeNull();
    expect(findMapUrl('`/dayhike/assets/glslang-G7Yt_-32.wasm`', 'low')).toBeNull();
  });
});

describe('mapProblems', () => {
  it('refuses an empty map, unless it may be empty: a tier not yet recorded, while another tier holds translations', () => {
    expect(mapProblems(map({ entries: {} }), CHUNK, ENTRY)).toEqual(['it is empty']);
    expect(mapProblems(map({ entries: {} }), CHUNK, ENTRY, { mayBeEmpty: true })).toEqual([]);
    expect(mapProblems(map({ entries: {} }), CHUNK, ENTRY, { mayBeEmpty: false })).toEqual(['it is empty']);
    // Only emptiness is forgiven.
    expect(mapProblems(map({ entries: {}, format: 'dayhike-wgsl-map/3' }), CHUNK, ENTRY, { mayBeEmpty: true })).toEqual([
      'its format "dayhike-wgsl-map/3" is not the one the WebGPU chunk reads',
    ]);
  });

  it('passes a map of this build that holds translations', () => {
    expect(mapProblems(map({}), CHUNK, ENTRY)).toEqual([]);
  });

  it("fails a map that says it is another tier's than the one asked, or no tier's, as the page refuses it; asked no tier, it reads none", () => {
    expect(mapProblems(map({ tier: 'low' }), CHUNK, ENTRY, { tier: 'low' })).toEqual([]);
    expect(mapProblems(map({ tier: 'high' }), CHUNK, ENTRY, { tier: 'low' })).toEqual(["it says it is the high tier's map, under the low tier's name"]);
    expect(mapProblems(map({ tier: 3 }), CHUNK, ENTRY, { tier: 'high' })).toEqual(["it says it is the 3 tier's map, under the high tier's name"]);
    expect(mapProblems(map({}), CHUNK, ENTRY, { tier: 'medium' })).toEqual(["it names no tier, under the medium tier's name"]);
    expect(mapProblems(map({ tier: 'high' }), CHUNK, ENTRY)).toEqual([]);
    expect(mapProblems(map({ tier: 'high' }), CHUNK, ENTRY, { mayBeEmpty: true })).toEqual([]);
    // Beside the map's other problems, in their order.
    expect(mapProblems(map({ tier: 'high', entries: {} }), CHUNK, ENTRY, { tier: 'low' })).toEqual([
      "it says it is the high tier's map, under the low tier's name",
      'it is empty',
    ]);
  });

  it("fails a map made against another Babylon than the bundle's, or under the other uniformity switch", () => {
    expect(mapProblems(map({ salt: SALT.replace('babylon=9.18.0', 'babylon=9.17.0') }), CHUNK, ENTRY)).toEqual([
      'its salt was made against Babylon 9.17.0, which the bundle does not carry',
    ]);
    expect(mapProblems(map({}), CHUNK, ENTRY.replaceAll('9.18.0', '9.19.0'))).toEqual([
      'its salt was made against Babylon 9.18.0, which the bundle does not carry',
    ]);
    expect(mapProblems(map({ salt: SALT.replace('staticUA=false', 'staticUA=true') }), CHUNK, ENTRY)).toEqual([
      "its salt's uniformity switch, true, is not the bundle's, false",
    ]);
  });

  it('fails a map that does not parse, as the site answers a missing file with its page', () => {
    expect(mapProblems('<!doctype html><title>Day Hike</title>', CHUNK, ENTRY)).toEqual(['the map does not parse as JSON']);
    expect(mapProblems('null', CHUNK, ENTRY)).toEqual(['the map is not an object']);
  });

  it("fails a map of another format, or made for another build's translators or key", () => {
    expect(mapProblems(map({ format: 'dayhike-wgsl-map/3' }), CHUNK, ENTRY)).toEqual([
      'its format "dayhike-wgsl-map/3" is not the one the WebGPU chunk reads',
    ]);
    // The format before this one, each entry's WGSL whole, against a chunk that reads this one.
    expect(mapProblems(map({ format: 'dayhike-wgsl-map/1', lines: undefined, entries: { [hex('e')]: '@vertex fn main() {}' } }), CHUNK, ENTRY)).toEqual([
      'its format "dayhike-wgsl-map/1" is not the one the WebGPU chunk reads',
      'it has no table of lines',
    ]);
    const otherTranslators = SALT.replace(hex('a'), hex('f'));
    expect(mapProblems(map({ salt: otherTranslators }), CHUNK, ENTRY)).toHaveLength(1);
    expect(mapProblems(map({ salt: otherTranslators }), CHUNK, ENTRY)[0]).toMatch(/^its salt ".*"… is not this build's$/);
    expect(mapProblems(map({ salt: SALT.replace('dayhike-wgsl/1', 'dayhike-wgsl/2') }), CHUNK, ENTRY)).toHaveLength(1);
    expect(mapProblems(map({}), CHUNK.replace(TRANSLATORS, 'translators=unknown'), ENTRY)).toEqual([
      "the WebGPU chunk carries no translators' digests to check the salt against",
    ]);
  });

  it('fails a map that holds no translations: none, or none that expands to text', () => {
    expect(mapProblems(map({ entries: {} }), CHUNK, ENTRY)).toEqual(['it is empty']);
    expect(mapProblems(map({ entries: [] }), CHUNK, ENTRY)).toEqual(['it has no entries']);
    // Every entry the empty line alone: nothing to serve.
    expect(mapProblems(map({ entries: { [hex('e')]: [1, 1], [hex('f')]: [1, 1] } }), CHUNK, ENTRY)).toEqual(['no entry expands to WGSL text']);
    // One that does is enough, beside one that does not.
    expect(mapProblems(map({ entries: { [hex('e')]: [1, 1], [hex('f')]: [1, 1, 0, 1] } }), CHUNK, ENTRY)).toEqual([]);
  });

  it('fails a map whose lines or runs are damaged, as the page would refuse it', () => {
    expect(mapProblems(map({ lines: undefined }), CHUNK, ENTRY)).toEqual(['it has no table of lines']);
    expect(mapProblems(map({ lines: ['@vertex fn main() {}', 7] }), CHUNK, ENTRY)).toEqual(['a line of its table is not text without a newline']);
    expect(mapProblems(map({ lines: ['@vertex\nfn main() {}'] }), CHUNK, ENTRY)).toEqual(['a line of its table is not text without a newline']);
    for (const runs of [7, '0,1', [], [0], [0, 1, 1], [0, 0], [1, -1], [2, 1], [-1, 2], [0.5, 1], [0, '1'], [4294967296, 1], [0, 1e21]]) {
      expect(mapProblems(map({ entries: { [hex('e')]: runs } }), CHUNK, ENTRY), JSON.stringify(runs)).toEqual([
        'an entry is not runs of the lines in its table',
      ]);
    }
  });

  it("fails a map with an entry that expands past the most the page reads, as the page refuses it", () => {
    // A line of 100,000 characters named 84 times: 8,400,083 characters from about 100 kB.
    const runs = Array.from({ length: 84 }, () => [0, 1]).flat();
    expect(mapProblems(map({ lines: ['x'.repeat(100_000), '@vertex fn main() {}'], entries: { [hex('e')]: runs, [hex('f')]: [1, 1] } }), CHUNK, ENTRY)).toEqual([
      'an entry expands to 8400083 characters, past the ceiling of 8388608 the page reads',
    ]);
    // Exactly the most: 3 × 2,796,202 characters and 2 newlines.
    expect(mapProblems(map({ lines: ['x'.repeat(2_796_202)], entries: { [hex('e')]: [0, 1, 0, 1, 0, 1] } }), CHUNK, ENTRY)).toEqual([]);
  });

  it("fails a map over the page's ceiling of 8,388,608 bytes with a plain line", () => {
    const text = map({});
    const padded = (bytes) => text + ' '.repeat(bytes - text.length);
    expect(mapProblems(padded(8_388_608), CHUNK, ENTRY)).toEqual([]);
    expect(mapProblems(padded(8_388_609), CHUNK, ENTRY)).toEqual([
      "it is 8388609 bytes, over the page's ceiling of 8388608 (MAP_MAX_BYTES): every page refuses it and translates every stage itself",
    ]);
  });

  it("holds the page's own ceilings", () => {
    expect([LIVE_MAP_MAX_BYTES, LIVE_ENTRY_MAX_CHARS]).toEqual([8_388_608, 8_388_608]);
    expect([LIVE_MAP_MAX_BYTES, LIVE_ENTRY_MAX_CHARS]).toEqual([MAP_MAX_BYTES, MAP_ENTRY_MAX_CHARS]);
  });
});
