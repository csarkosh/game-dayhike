import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { checkBuild } from '../lib/checkBuild.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../check-build.mjs', import.meta.url));
const FORMAT = 'dayhike-wgsl-map/2';

const hex = (c) => c.repeat(64);
const TRANSLATORS = `glslang=${hex('a')}|twgsl=${hex('b')}|glslang.js=${hex('c')}|twgsl.js=${hex('d')}`;
const SALT = `dayhike-wgsl/1|babylon=9.18.0|${TRANSLATORS}|staticUA=false`;
/** A map of `tier`, as the build makes one: it says its tier. */
const mapOf = (tier) => JSON.stringify({ format: FORMAT, salt: SALT, tier, lines: ['@vertex fn main() {}'], entries: { [hex('e')]: [0, 1] } });
/** A map of `tier` that holds no translations. */
const emptyOf = (tier) => JSON.stringify({ format: FORMAT, salt: SALT, tier, lines: [], entries: {} });
/** The three maps' names in the build, one a tier. */
const MAPS = { low: 'wgsl-map-low-Lo1_Zk9a.json', medium: 'wgsl-map-medium-Me2_Zk9a.json', high: 'wgsl-map-high-Qx3_Zk9a.json' };
const URLS = `{low:\`/dayhike/assets/${MAPS.low}\`,medium:\`/dayhike/assets/${MAPS.medium}\`,high:\`/dayhike/assets/${MAPS.high}\`}`;
/** The WebGPU chunk: the formats, the digests, the switch, and the maps' URLs as `urls`. */
const gpuChunk = (urls) =>
  'import{Ze}from"./index-AAAAAAAA.js";var Ci=`dayhike-wgsl/1`,Mf=`dayhike-wgsl-map/2`;' +
  `function Ei(){return\`\${Ci}|babylon=\${Ze.Version}|\${"${TRANSLATORS}"}|staticUA=\${Tn.DisableUniformityAnalysis}\`}` +
  `Tn.DisableUniformityAnalysis=!1;var Wm=${urls};`;

/**
 * A built client shaped as the real one: the page naming its entry chunk, the
 * entry importing a vendor chunk statically and the WebGPU chunk dynamically,
 * the WebGPU chunk naming the three maps, and the maps. `change` replaces
 * files.
 */
function dist(change = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dayhike-dist-'));
  mkdirSync(join(root, 'assets'));
  const files = {
    'index.html': '<!doctype html><script type="module" crossorigin src="/dayhike/assets/index-AAAAAAAA.js"></script>',
    'assets/index-AAAAAAAA.js':
      'import{a as e}from"./vendor-BBBBBBBB.js";' +
      'var Ze=class{static get Version(){return`9.18.0`}};' +
      'const l=()=>import(`./gpuEngine-CCCCCCCC.js`),__vite__mapDeps=["assets/gpuEngine-CCCCCCCC.js"];',
    'assets/vendor-BBBBBBBB.js': 'export const a=1;',
    'assets/gpuEngine-CCCCCCCC.js': gpuChunk(URLS),
    [`assets/${MAPS.low}`]: mapOf('low'),
    [`assets/${MAPS.medium}`]: mapOf('medium'),
    [`assets/${MAPS.high}`]: mapOf('high'),
    ...change,
  };
  for (const [name, text] of Object.entries(files)) {
    if (text === null) rmSync(join(root, name), { force: true });
    else {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), text);
    }
  }
  return root;
}

describe('the check of the built client', () => {
  it('passes a build whose three maps, one a tier, are named by the WebGPU chunk alone and are this build\'s', async () => {
    expect(await checkBuild(dist(), { mapFormat: FORMAT })).toEqual([]);
  });

  it('passes a tier\'s map that is empty while another tier\'s holds translations, and fails a build whose every map is empty', async () => {
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: emptyOf('low') }), { mapFormat: FORMAT })).toEqual([]);
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: emptyOf('low'), [`assets/${MAPS.medium}`]: emptyOf('medium') }), { mapFormat: FORMAT })).toEqual([]);
    expect(
      await checkBuild(dist({ [`assets/${MAPS.low}`]: emptyOf('low'), [`assets/${MAPS.medium}`]: emptyOf('medium'), [`assets/${MAPS.high}`]: emptyOf('high') }), { mapFormat: FORMAT }),
    ).toEqual([
      "the deploy check refuses the low tier's map: it is empty",
      "the deploy check refuses the medium tier's map: it is empty",
      "the deploy check refuses the high tier's map: it is empty",
    ]);
  });

  it('fails a build with a tier\'s map missing, or two of them, or one that is not a map of the known format', async () => {
    expect(await checkBuild(dist({ [`assets/${MAPS.high}`]: null }), { mapFormat: FORMAT })).toEqual([
      'the build holds 0 WGSL maps for the high tier (assets/wgsl-map-high-*.json), not 1',
    ]);
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: null, [`assets/${MAPS.medium}`]: null }), { mapFormat: FORMAT })).toEqual([
      'the build holds 0 WGSL maps for the low tier (assets/wgsl-map-low-*.json), not 1',
      'the build holds 0 WGSL maps for the medium tier (assets/wgsl-map-medium-*.json), not 1',
    ]);
    expect(await checkBuild(dist({ 'assets/wgsl-map-low-Zz9_Zk9a.json': mapOf('low') }), { mapFormat: FORMAT })).toEqual([
      'the build holds 2 WGSL maps for the low tier (assets/wgsl-map-low-*.json), not 1',
    ]);
    // A map of no tier, as the build named it before there was one a tier, is none of the three.
    expect(await checkBuild(dist({ [`assets/${MAPS.medium}`]: null, 'assets/wgsl-map-Qx3_Zk9a.json': mapOf('medium') }), { mapFormat: FORMAT })).toEqual([
      'the build holds 0 WGSL maps for the medium tier (assets/wgsl-map-medium-*.json), not 1',
    ]);
    expect(await checkBuild(dist({ [`assets/${MAPS.medium}`]: '<!doctype html>' }), { mapFormat: FORMAT })).toContain(
      `assets/${MAPS.medium} does not parse as JSON`,
    );
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: mapOf('low').replace(FORMAT, 'dayhike-wgsl-map/3') }), { mapFormat: FORMAT })).toContain(
      `assets/${MAPS.low} is not a map of dayhike-wgsl-map/2`,
    );
    // The format before this one, each entry's WGSL whole.
    const first = JSON.stringify({ format: 'dayhike-wgsl-map/1', salt: SALT, tier: 'high', entries: { [hex('e')]: '@vertex fn main() {}' } });
    expect(await checkBuild(dist({ [`assets/${MAPS.high}`]: first }), { mapFormat: FORMAT })).toContain(`assets/${MAPS.high} is not a map of dayhike-wgsl-map/2`);
    // Its format's name on a map without its lines.
    const noLines = JSON.stringify({ format: FORMAT, salt: SALT, tier: 'high', entries: { [hex('e')]: [0, 1] } });
    expect(await checkBuild(dist({ [`assets/${MAPS.high}`]: noLines }), { mapFormat: FORMAT })).toContain(`assets/${MAPS.high} is not a map of dayhike-wgsl-map/2`);
  });

  it('fails a build whose entry chunk, or a chunk it imports statically, names the map or the lookup', async () => {
    expect(
      await checkBuild(dist({ 'assets/vendor-BBBBBBBB.js': `export const a=\`/dayhike/assets/${MAPS.high}\`;` }), { mapFormat: FORMAT }),
    ).toEqual(['assets/vendor-BBBBBBBB.js, loaded with the entry chunk, names wgsl-map']);
    expect(
      await checkBuild(dist({ 'assets/vendor-BBBBBBBB.js': 'export{a}from"./shared-DDDDDDDD.js";', 'assets/shared-DDDDDDDD.js': 'export const a=`dayhike-wgsl-corpus-`;' }), {
        mapFormat: FORMAT,
      }),
    ).toEqual(['assets/shared-DDDDDDDD.js, loaded with the entry chunk, names dayhike-wgsl']);
    // The WebGPU chunk, imported dynamically, is not the entry's to carry.
    expect(await checkBuild(dist({ 'assets/index-AAAAAAAA.js': 'import"./vendor-BBBBBBBB.js";var Ze=`9.18.0`;const l=()=>import("./gpuEngine-CCCCCCCC.js");' }), { mapFormat: FORMAT })).toEqual([]);
  });

  it("fails a build whose WebGPU chunk does not name every map, or whose map is not the bundle's", async () => {
    expect(
      await checkBuild(dist({ 'assets/gpuEngine-CCCCCCCC.js': `var Wm=${URLS.replace(MAPS.medium, 'wgsl-map-medium-Zz9_Zk9a.json')};` }), { mapFormat: FORMAT }),
    ).toContain(`the WebGPU chunk assets/gpuEngine-CCCCCCCC.js does not name assets/${MAPS.medium}`);
    expect(await checkBuild(dist({ 'assets/gpuEngine-CCCCCCCC.js': gpuChunk(`{high:\`/dayhike/assets/${MAPS.high}\`}`) }), { mapFormat: FORMAT })).toEqual([
      `the WebGPU chunk assets/gpuEngine-CCCCCCCC.js does not name assets/${MAPS.low}`,
      `the WebGPU chunk assets/gpuEngine-CCCCCCCC.js does not name assets/${MAPS.medium}`,
    ]);
    const other = mapOf('low').replace('babylon=9.18.0', 'babylon=9.17.0');
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: other }), { mapFormat: FORMAT })).toEqual([
      "the deploy check refuses the low tier's map: its salt was made against Babylon 9.17.0, which the bundle does not carry",
    ]);
  });

  it("fails a build whose map says it is another tier's than its name, or no tier's, as every page refuses it", async () => {
    // Under the low tier's name, a map that says it is the high tier's: the build's own check and the deploy check both refuse it.
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: mapOf('high') }), { mapFormat: FORMAT })).toEqual([
      `assets/${MAPS.low} says it is the high tier's map, under the low tier's name`,
      "the deploy check refuses the low tier's map: it says it is the high tier's map, under the low tier's name",
    ]);
    // A map of no tier, as the build made one before there was one a tier, under a tier's name.
    const noTier = JSON.stringify({ format: FORMAT, salt: SALT, lines: ['@vertex fn main() {}'], entries: { [hex('e')]: [0, 1] } });
    expect(await checkBuild(dist({ [`assets/${MAPS.medium}`]: noTier }), { mapFormat: FORMAT })).toEqual([
      `assets/${MAPS.medium} names no tier, under the medium tier's name`,
      "the deploy check refuses the medium tier's map: it names no tier, under the medium tier's name",
    ]);
    // Two tiers' maps swapped: two problems a map.
    expect(await checkBuild(dist({ [`assets/${MAPS.low}`]: mapOf('medium'), [`assets/${MAPS.medium}`]: mapOf('low') }), { mapFormat: FORMAT })).toHaveLength(4);
  });

  it("finds Babylon's version where only a chunk the entry imports statically carries it, as the deploy check does, and says which", async () => {
    const entry = 'import{a as e}from"./vendor-BBBBBBBB.js";const l=()=>import(`./gpuEngine-CCCCCCCC.js`),__vite__mapDeps=["assets/gpuEngine-CCCCCCCC.js"];';
    const notes = [];
    expect(
      await checkBuild(dist({ 'assets/index-AAAAAAAA.js': entry, 'assets/vendor-BBBBBBBB.js': 'var Ze=class{static get Version(){return`9.18.0`}};export const a=Ze;' }), {
        mapFormat: FORMAT,
        note: (line) => notes.push(line),
      }),
    ).toEqual([]);
    expect(notes).toEqual(["Babylon's version 9.18.0 is in assets/vendor-BBBBBBBB.js, which the entry chunk imports statically"]);
    // Nowhere: refused with the deploy check's own words.
    expect(await checkBuild(dist({ 'assets/index-AAAAAAAA.js': entry }), { mapFormat: FORMAT })).toEqual([
      "the deploy check refuses the low tier's map: its salt was made against Babylon 9.18.0, which the bundle does not carry",
      "the deploy check refuses the medium tier's map: its salt was made against Babylon 9.18.0, which the bundle does not carry",
      "the deploy check refuses the high tier's map: its salt was made against Babylon 9.18.0, which the bundle does not carry",
    ]);
  });

  it('reads chunks in folders against the chunk that names them', async () => {
    const notes = [];
    const nested = dist({
      'assets/index-AAAAAAAA.js': 'import"./nested/a-XXXXXXXX.js";const l=()=>import(`./gpuEngine-CCCCCCCC.js`);',
      'assets/nested/a-XXXXXXXX.js': 'import{v}from"./b-YYYYYYYY.js";',
      'assets/nested/b-YYYYYYYY.js': 'export const v=`9.18.0`;',
    });
    expect(await checkBuild(nested, { mapFormat: FORMAT, note: (line) => notes.push(line) })).toEqual([]);
    expect(notes).toEqual(["Babylon's version 9.18.0 is in assets/nested/b-YYYYYYYY.js, which the entry chunk imports statically"]);
  });

  it('runs from the command line: fails with a plain line a problem, passes saying so', async () => {
    const good = await run(process.execPath, [TOOL, dist()]);
    expect(good.stdout).toContain('the built client carries the WGSL maps as it should');
    const bad = await run(process.execPath, [TOOL, dist({ [`assets/${MAPS.high}`]: null })]).then(
      () => null,
      (error) => error,
    );
    expect(bad?.code).toBe(1);
    expect(bad?.stderr).toContain('✗ the build holds 0 WGSL maps for the high tier (assets/wgsl-map-high-*.json), not 1');
  }, timeLimit(60_000));
});
