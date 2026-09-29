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
const MAP = JSON.stringify({ format: FORMAT, salt: SALT, lines: ['@vertex fn main() {}'], entries: { [hex('e')]: [0, 1] } });

/**
 * A built client shaped as the real one: the page naming its entry chunk, the
 * entry importing a vendor chunk statically and the WebGPU chunk dynamically,
 * the WebGPU chunk naming the map, and the map. `change` replaces files.
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
    'assets/gpuEngine-CCCCCCCC.js':
      'import{Ze}from"./index-AAAAAAAA.js";var Ci=`dayhike-wgsl/1`,Mf=`dayhike-wgsl-map/2`;' +
      `function Ei(){return\`\${Ci}|babylon=\${Ze.Version}|\${"${TRANSLATORS}"}|staticUA=\${Tn.DisableUniformityAnalysis}\`}` +
      'Tn.DisableUniformityAnalysis=!1;var Wm=`/dayhike/assets/wgsl-map-Qx3_Zk9a.json`;',
    'assets/wgsl-map-Qx3_Zk9a.json': MAP,
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
  it('passes a build whose one map is named by the WebGPU chunk alone and is this build\'s', async () => {
    expect(await checkBuild(dist(), { mapFormat: FORMAT })).toEqual([]);
  });

  it('fails a build with no map, or with two, or with one that is not a map of the known format', async () => {
    expect(await checkBuild(dist({ 'assets/wgsl-map-Qx3_Zk9a.json': null }), { mapFormat: FORMAT })).toContain(
      'the build holds 0 WGSL maps (assets/wgsl-map-*.json), not 1',
    );
    expect(await checkBuild(dist({ 'assets/wgsl-map-Zz9_Zk9a.json': MAP }), { mapFormat: FORMAT })).toContain(
      'the build holds 2 WGSL maps (assets/wgsl-map-*.json), not 1',
    );
    expect(await checkBuild(dist({ 'assets/wgsl-map-Qx3_Zk9a.json': '<!doctype html>' }), { mapFormat: FORMAT })).toContain(
      'assets/wgsl-map-Qx3_Zk9a.json does not parse as JSON',
    );
    expect(
      await checkBuild(dist({ 'assets/wgsl-map-Qx3_Zk9a.json': MAP.replace(FORMAT, 'dayhike-wgsl-map/3') }), { mapFormat: FORMAT }),
    ).toContain('assets/wgsl-map-Qx3_Zk9a.json is not a map of dayhike-wgsl-map/2');
    // The format before this one, each entry's WGSL whole.
    const first = JSON.stringify({ format: 'dayhike-wgsl-map/1', salt: SALT, entries: { [hex('e')]: '@vertex fn main() {}' } });
    expect(await checkBuild(dist({ 'assets/wgsl-map-Qx3_Zk9a.json': first }), { mapFormat: FORMAT })).toContain(
      'assets/wgsl-map-Qx3_Zk9a.json is not a map of dayhike-wgsl-map/2',
    );
    // Its format's name on a map without its lines.
    const noLines = JSON.stringify({ format: FORMAT, salt: SALT, entries: { [hex('e')]: [0, 1] } });
    expect(await checkBuild(dist({ 'assets/wgsl-map-Qx3_Zk9a.json': noLines }), { mapFormat: FORMAT })).toContain(
      'assets/wgsl-map-Qx3_Zk9a.json is not a map of dayhike-wgsl-map/2',
    );
  });

  it('fails a build whose entry chunk, or a chunk it imports statically, names the map or the lookup', async () => {
    expect(
      await checkBuild(dist({ 'assets/vendor-BBBBBBBB.js': 'export const a=`/dayhike/assets/wgsl-map-Qx3_Zk9a.json`;' }), { mapFormat: FORMAT }),
    ).toEqual(['assets/vendor-BBBBBBBB.js, loaded with the entry chunk, names wgsl-map']);
    expect(
      await checkBuild(dist({ 'assets/vendor-BBBBBBBB.js': 'export{a}from"./shared-DDDDDDDD.js";', 'assets/shared-DDDDDDDD.js': 'export const a=`dayhike-wgsl-corpus-`;' }), {
        mapFormat: FORMAT,
      }),
    ).toEqual(['assets/shared-DDDDDDDD.js, loaded with the entry chunk, names dayhike-wgsl']);
    // The WebGPU chunk, imported dynamically, is not the entry's to carry.
    expect(await checkBuild(dist({ 'assets/index-AAAAAAAA.js': 'import"./vendor-BBBBBBBB.js";var Ze=`9.18.0`;const l=()=>import("./gpuEngine-CCCCCCCC.js");' }), { mapFormat: FORMAT })).toEqual([]);
  });

  it("fails a build whose WebGPU chunk does not name the map, or whose map is not the bundle's", async () => {
    expect(
      await checkBuild(dist({ 'assets/gpuEngine-CCCCCCCC.js': 'var Wm=`/dayhike/assets/wgsl-map-Zz9_Zk9a.json`;' }), { mapFormat: FORMAT }),
    ).toContain('the WebGPU chunk assets/gpuEngine-CCCCCCCC.js does not name assets/wgsl-map-Qx3_Zk9a.json');
    const other = MAP.replace('babylon=9.18.0', 'babylon=9.17.0');
    expect(await checkBuild(dist({ 'assets/wgsl-map-Qx3_Zk9a.json': other }), { mapFormat: FORMAT })).toEqual([
      'the deploy check refuses the map: its salt was made against Babylon 9.17.0, which the bundle does not carry',
    ]);
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
      'the deploy check refuses the map: its salt was made against Babylon 9.18.0, which the bundle does not carry',
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
    expect(good.stdout).toContain('the built client carries the WGSL map as it should');
    const bad = await run(process.execPath, [TOOL, dist({ 'assets/wgsl-map-Qx3_Zk9a.json': null })]).then(
      () => null,
      (error) => error,
    );
    expect(bad?.code).toBe(1);
    expect(bad?.stderr).toContain('✗ the build holds 0 WGSL maps (assets/wgsl-map-*.json), not 1');
  }, timeLimit(60_000));
});
