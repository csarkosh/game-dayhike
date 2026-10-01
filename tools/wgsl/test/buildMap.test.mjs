import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as page from '../../../client/src/game/wgslFormat.ts';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { buildMap, entriesOn, nodeSalt, readBackProblems } from '../lib/buildMap.mjs';
import { readCorpusDir } from '../lib/corpus.mjs';
import { NODE_CORPUS_DIR, inputsFile, mapFile } from '../lib/files.mjs';
import { mergeCorpus } from '../lib/mergeCorpus.mjs';
import { loadShared } from '../lib/shared.mjs';
import { startTranslators, translateStage } from '../lib/translators.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../build-map.mjs', import.meta.url));
/** Two stages: a vertex stage, and a fragment stage that turns uniformity analysis off. */
const FIXTURE = fileURLToPath(new URL('./fixtures/corpus/', import.meta.url));
const BROKEN = { stage: 'fragment', flag: false, glsl: '#version 450\nvoid main( { this is not GLSL' };
const TIERS = ['low', 'medium', 'high'];

/** The translators the client ships, each digested, as the page's build digests them. */
function shippedDigests() {
  const resolve = createRequire(fileURLToPath(new URL('../../../client/package.json', import.meta.url))).resolve;
  const digest = (file) => createHash('sha256').update(readFileSync(resolve(`@babylonjs/core/assets/${file}`))).digest('hex');
  return (
    `glslang=${digest('glslang/glslang.wasm')}|twgsl=${digest('twgsl/twgsl.wasm')}` +
    `|glslang.js=${digest('glslang/glslang.js')}|twgsl.js=${digest('twgsl/twgsl.js')}`
  );
}

/** A directory of its own, holding `files` (name to text). */
function directory(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-test-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** Every entry of a map read with the page's reader, expanded. */
const expanded = (map) => new Map([...map.keys()].map((key) => [key, map.get(key)]));

/** The lines of a map's table and its runs, from its text. */
function tableAndRuns(text) {
  const file = JSON.parse(text);
  return { lines: file.lines.length, runs: Object.values(file.entries).reduce((sum, runs) => sum + runs.length / 2, 0) };
}

/** Every file under `dir`, by its path relative to it. */
const tree = (dir) => readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()).sort();

/** A corpus of its own holding `stages`, one file a stage, as the merge writes
 * it, each stage on `tiers` (every tier, where none are named). */
function corpusOf(stages, tiers = []) {
  const dir = directory();
  mergeCorpus({ dir, recorded: [join(directory({ 'r.json': shared.corpusText(stages, tiers) }), 'r.json')], shared });
  return dir;
}

/** The tool run on `corpus`, writing its maps under `out`: its exit, its
 * output, each tier's map, and `map`, the high tier's. */
async function tool(corpus, out, ...flags) {
  const done = await run(process.execPath, [TOOL, '--corpus', corpus, '--out', out, ...flags]);
  const maps = Object.fromEntries(TIERS.map((tier) => [tier, readFileSync(mapFile(out, tier), 'utf8')]));
  return { ...done, maps, map: maps.high };
}

let shared;
let translators;
beforeAll(async () => {
  shared = await loadShared();
  translators = await startTranslators();
}, timeLimit(60_000));

describe('the map the build ships', () => {
  it('keys every stage with the page\'s own code, under the salt the page computes', () => {
    const salt = nodeSalt(shared);
    expect(salt).toBe(`dayhike-wgsl/1|babylon=9.18.0|${shippedDigests()}|staticUA=false`);
    expect(salt).toBe(page.lookupSalt({ babylon: '9.18.0', translators: shippedDigests(), staticUniformityOff: false }));
    const { stages } = readCorpusDir(FIXTURE, shared);
    expect(stages).toHaveLength(2);
    const made = buildMap({ stages, salt, translate: (entry) => translateStage(translators, entry), shared });
    const keys = stages.map((entry) => page.stageKey(salt, entry.stage, entry.flag, entry.glsl));
    expect([...made.entries.keys()].sort()).toEqual([...keys].sort());
    // Read with the page's reader, every entry expands to its translation, byte for byte.
    const text = shared.mapText(salt, made.entries);
    expect(expanded(page.readMap(text, salt))).toEqual(made.entries);
    // The two stages' 41 lines, 24 of them distinct, in 24 runs.
    expect(tableAndRuns(text)).toEqual({ lines: 24, runs: 24 });
  }, timeLimit(60_000));

  it('translates each stage as the page does: WGSL of its stage, with Babylon\'s diagnostic where the stage turns the analysis off', () => {
    const salt = nodeSalt(shared);
    const { stages } = readCorpusDir(FIXTURE, shared);
    const made = buildMap({ stages, salt, translate: (entry) => translateStage(translators, entry), shared });
    const wgslOf = (stage) => {
      const entry = stages.find((s) => s.stage === stage);
      return made.entries.get(page.stageKey(salt, entry.stage, entry.flag, entry.glsl));
    };
    expect(wgslOf('vertex')).toContain('@vertex');
    expect(wgslOf('vertex').startsWith('diagnostic(')).toBe(false);
    expect(wgslOf('fragment')).toContain('@fragment');
    expect(wgslOf('fragment').startsWith('diagnostic(off, derivative_uniformity);\n')).toBe(true);
    expect(made.failed).toEqual([]);
  }, timeLimit(60_000));

  it('makes the same bytes from the same corpus, whatever its order', async () => {
    const salt = nodeSalt(shared);
    const { stages } = readCorpusDir(FIXTURE, shared);
    const translate = (entry) => translateStage(translators, entry);
    const made = buildMap({ stages, salt, translate, shared });
    const once = shared.mapText(salt, made.entries);
    expect(shared.mapText(salt, buildMap({ stages: [...stages].reverse(), salt, translate, shared }).entries)).toBe(once);
    expect(shared.mapText(salt, buildMap({ stages: [...stages, ...stages], salt, translate, shared }).entries)).toBe(once);
    // Run as the build runs it, twice, and on the same stages written afresh:
    // each tier's map is the map of its entries, written for that tier.
    const out = directory();
    const first = await tool(FIXTURE, join(out, 'first'));
    const second = await tool(FIXTURE, join(out, 'second'));
    const third = await tool(corpusOf([...stages].reverse()), join(out, 'third'));
    for (const tier of TIERS) {
      expect(first.maps[tier], tier).toBe(shared.mapText(salt, made.entries, tier));
      expect(second.maps[tier], tier).toBe(first.maps[tier]);
      expect(third.maps[tier], tier).toBe(first.maps[tier]);
    }
    expect(new Set(Object.values(first.maps)).size).toBe(3);
  }, timeLimit(120_000));

  it('makes a map a tier, each of the stages recorded on that tier, and says how many are on each', async () => {
    const salt = nodeSalt(shared);
    const [vertex, fragment] = [...readCorpusDir(FIXTURE, shared).stages].sort((a, b) => (a.stage < b.stage ? 1 : -1));
    expect([vertex.stage, fragment.stage]).toEqual(['vertex', 'fragment']);
    const corpus = corpusOf([vertex], ['low']);
    mergeCorpus({ dir: corpus, recorded: [join(directory({ 'r.json': shared.corpusText([fragment], ['high', 'medium']) }), 'r.json')], shared });
    const { stages, tiers } = readCorpusDir(corpus, shared);
    const made = buildMap({ stages, salt, translate: (entry) => translateStage(translators, entry), shared });
    const keyOf = (entry) => page.stageKey(salt, entry.stage, entry.flag, entry.glsl);
    expect([...entriesOn(made, tiers, 'low').keys()]).toEqual([keyOf(vertex)]);
    expect([...entriesOn(made, tiers, 'medium').keys()]).toEqual([keyOf(fragment)]);
    expect([...entriesOn(made, tiers, 'high').keys()]).toEqual([keyOf(fragment)]);
    expect(entriesOn(made, new Map(), 'low')).toEqual(new Map());
    const done = await tool(corpus, directory());
    for (const tier of TIERS) {
      expect(done.maps[tier], tier).toBe(shared.mapText(salt, entriesOn(made, tiers, tier), tier));
      expect(Object.keys(JSON.parse(done.maps[tier]).entries), tier).toEqual([...entriesOn(made, tiers, tier).keys()]);
      expect(JSON.parse(done.maps[tier]).tier).toBe(tier);
    }
    expect(done.stdout).toMatch(/^ {2}corpus: {7}2 stages under \S+, 2 distinct; on low 1, on medium 1, on high 1$/m);
    expect(done.stdout).toContain('  failed:       0\n');
    expect(done.stdout.match(/^wgsl map: \S+ \(the (low|medium|high) tier\)$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}entries: {6}1$/gm)).toHaveLength(3);
    // Each read with the page's reader for its tier; another tier's map is refused.
    expect(readBackProblems(done.maps.low, salt, entriesOn(made, tiers, 'low'), shared, 'low')).toEqual([]);
    expect(readBackProblems(done.maps.low, salt, entriesOn(made, tiers, 'low'), shared, 'high')).toEqual(['the map does not read back: made for the low tier, not high']);
  }, timeLimit(120_000));

  it('leaves out a stage that does not translate, says so loudly, and goes on', async () => {
    const corpus = corpusOf([BROKEN, ...readCorpusDir(FIXTURE, shared).stages]);
    const salt = nodeSalt(shared);
    const made = buildMap({ stages: readCorpusDir(corpus, shared).stages, salt, translate: (entry) => translateStage(translators, entry), shared });
    expect(made.entries.size).toBe(2);
    expect(made.failed).toEqual([{ id: shared.corpusId(BROKEN), stage: 'fragment', message: 'GLSL compilation failed' }]);
    expect(made.entries.has(page.stageKey(salt, BROKEN.stage, BROKEN.flag, BROKEN.glsl))).toBe(false);
    // The build does not fail on it.
    const done = await tool(corpus, directory());
    for (const tier of TIERS) expect(Object.keys(JSON.parse(done.maps[tier]).entries), tier).toHaveLength(2);
    expect(done.stderr).toContain(`FAILED     fragment  ${shared.corpusId(BROKEN).slice(0, 16)}  GLSL compilation failed`);
    expect(done.stderr).toContain('!! wgsl maps: 1 of 3 stages did not translate and are NOT in any map');
    expect(done.stdout).toContain(`  failed:       1 (${shared.corpusId(BROKEN)})\n`);
  }, timeLimit(120_000));

  it('makes an empty map a tier of an empty corpus', async () => {
    const done = await tool(directory(), directory());
    for (const tier of TIERS) {
      expect(done.maps[tier], tier).toBe(`{"format":"dayhike-wgsl-map/2","salt":${JSON.stringify(nodeSalt(shared))},"tier":"${tier}","lines":[],"entries":{}}`);
    }
    expect(done.stdout).toContain('  corpus:       0 stages under ');
    expect(done.stdout).toContain(', 0 distinct; on low 0, on medium 0, on high 0\n');
    expect(done.stdout.match(/^ {2}runs: {9}0, over a table of 0 lines$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}read back: {4}\S+wgsl-map-(low|medium|high)\.json: 0 entries, each byte for byte its translation$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}entries: {6}0$/gm)).toHaveLength(3);
    expect(done.stdout).toContain('  failed:       0\n  translation:');
    expect(done.stdout.match(/^ {2}largest: {6}none$/gm)).toHaveLength(3);
  }, timeLimit(60_000));

  it('prints the entries, the bytes raw, gzipped and brotli\'d, each tier\'s, and the milliseconds of each stage once', async () => {
    const done = await tool(FIXTURE, directory());
    const lines = done.stdout.split('\n');
    expect(lines.filter((line) => / ms {2}(vertex {2}|fragment) {2}[0-9a-f]{16} {2}\d+ B GLSL -> \d+ B WGSL$/.test(line))).toHaveLength(2);
    expect(done.stdout).toContain(`wgsl maps: `);
    expect(done.stdout).toContain(', one a tier\n  corpus:       2 stages under ');
    expect(done.stdout).toContain(', 2 distinct; on low 2, on medium 2, on high 2\n  failed:       0\n  translation:');
    expect(done.stdout.match(/^wgsl map: \S+wgsl-map-(low|medium|high)\.json \(the \1 tier\)$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}entries: {6}2$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}ascii: {8}yes$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}largest: {6}\d+ B of WGSL, the (vertex|fragment) stage [0-9a-f]{16}$/gm)).toHaveLength(3);
    // The two stages' WGSL, as the shipped translators make it.
    expect(lines.filter((line) => line === '  lines:        41 in all, 24 distinct in 651 B; digits as #: 41 in all, 24 distinct in 638 B')).toHaveLength(3);
    expect(lines.filter((line) => line === '  runs:         24, over a table of 24 lines')).toHaveLength(3);
    expect(done.stdout.match(/^ {2}read back: {4}\S+wgsl-map-(low|medium|high)\.json: 2 entries, each byte for byte its translation$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}bytes: {8}\d+ raw, \d+ gzip -9, \d+ brotli -q 11$/gm)).toHaveLength(3);
    expect(done.stdout.match(/^ {2}translation: {2}translators started in \d+ ms; \d+ ms in all, \d+ ms a stage on average, \d+ ms the longest$/gm)).toHaveLength(1);
    expect(done.stdout.match(/^ {2}reading it: {3}\d+\.\d\d ms to read with the page's reader, \d+\.\d\d ms to expand every entry, \d+\.\d\d ms the largest$/gm)).toHaveLength(3);
    expect(done.stderr).toBe('');
  }, timeLimit(60_000));

  it('with --reuse leaves maps made from the same corpus under the same salt as they are, and remakes them where the corpus, its tiers or the format changed', async () => {
    const corpus = corpusOf(readCorpusDir(FIXTURE, shared).stages);
    const out = directory();
    await tool(corpus, out);
    const made = TIERS.map((tier) => statSync(mapFile(out, tier)).mtimeMs);
    const again = await tool(corpus, out, '--reuse');
    expect(again.stdout).toContain('is up to date with');
    expect(TIERS.map((tier) => statSync(mapFile(out, tier)).mtimeMs)).toEqual(made);
    // A stage put on another tier, no file of the corpus changed: made again.
    const [first] = readCorpusDir(corpus, shared).stages;
    writeFileSync(join(corpus, 'low.json'), shared.corpusText([first], ['low']));
    expect(mergeCorpus({ dir: corpus, recorded: [], shared }).retiered).toBe(0);
    writeFileSync(join(corpus, 'tiers.json'), readFileSync(join(corpus, 'tiers.json'), 'utf8').replace('["low","medium","high"]', '["low"]'));
    const retiered = await tool(corpus, out, '--reuse');
    expect(retiered.stdout).not.toContain('is up to date with');
    expect(Object.keys(JSON.parse(retiered.maps.high).entries)).toHaveLength(1);
    writeFileSync(join(corpus, 'more.json'), shared.corpusText([{ stage: 'vertex', flag: false, glsl: '#version 450\nvoid main() { gl_Position = vec4(1.0); }' }]));
    mergeCorpus({ dir: corpus, recorded: [], shared });
    const remade = await tool(corpus, out, '--reuse');
    expect(remade.stdout).not.toContain('is up to date with');
    expect(Object.keys(JSON.parse(remade.maps.low).entries)).toHaveLength(3);
    // A map missing: made again.
    rmSync(mapFile(out, 'medium'));
    expect((await tool(corpus, out, '--reuse')).stdout).not.toContain('is up to date with');
    // Maps made in the format before this one, from the same corpus under
    // the same salt, recorded as that format's tool recorded it: made again.
    const salt = nodeSalt(shared);
    const stages = readCorpusDir(corpus, shared).stages;
    for (const tier of TIERS) writeFileSync(mapFile(out, tier), JSON.stringify({ format: 'dayhike-wgsl-map/1', salt, entries: {} }));
    writeFileSync(inputsFile(out), createHash('sha256').update(salt).update('\0').update(shared.corpusText(stages)).digest('hex'));
    const renewed = await tool(corpus, out, '--reuse');
    expect(renewed.stdout).not.toContain('is up to date with');
    expect(JSON.parse(renewed.map).format).toBe('dayhike-wgsl-map/2');
  }, timeLimit(120_000));

  it('makes the map of the corpus made under Node, every stage translated, and says what it cost', async () => {
    const done = await tool(NODE_CORPUS_DIR, directory());
    const { stages } = readCorpusDir(NODE_CORPUS_DIR, shared);
    expect(stages).toHaveLength(10);
    expect(Object.keys(JSON.parse(done.map).entries)).toHaveLength(10);
    expect(done.stderr).not.toContain('FAILED');
    // The ten stages' 2,781 lines, 1,718 of them distinct, in 805 runs; each
    // entry, read with the page's reader, expands to its translation.
    expect(tableAndRuns(done.map)).toEqual({ lines: 1_718, runs: 805 });
    expect(done.stdout).toContain('  lines:        2781 in all, 1718 distinct in 67270 B;');
    const salt = nodeSalt(shared);
    const translated = buildMap({ stages, salt, translate: (entry) => translateStage(translators, entry), shared });
    expect(expanded(page.readMap(done.map, salt, 'high'))).toEqual(translated.entries);
    // The figures, for the run's log: sizes, what reading it costs, the translators' start.
    console.log(done.stdout.slice(done.stdout.indexOf('wgsl maps:')));

    // The same stages as a recording, the JSON a page downloads: merged, it
    // is the fixture's files byte for byte, and read as JSON, it makes the
    // map the files make, byte for byte.
    const recording = shared.corpusText(stages);
    const merged = corpusOf(shared.readCorpus(recording));
    expect(tree(merged)).toEqual(tree(NODE_CORPUS_DIR));
    for (const file of tree(merged)) expect(readFileSync(join(merged, file))).toEqual(readFileSync(join(NODE_CORPUS_DIR, file)));
    const fromJson = buildMap({ stages: shared.readCorpus(recording), salt: nodeSalt(shared), translate: (entry) => translateStage(translators, entry), shared });
    expect(shared.mapText(salt, fromJson.entries, 'high')).toBe(done.map);
  }, timeLimit(300_000));

  it('refuses a corpus in which a stage carries a carriage return, naming it, and writes no map', async () => {
    const corpus = corpusOf(readCorpusDir(FIXTURE, shared).stages);
    const [file] = tree(corpus);
    writeFileSync(join(corpus, file), readFileSync(join(corpus, file), 'utf8').replaceAll('\n', '\r\n'));
    const out = directory();
    const failed = await run(process.execPath, [TOOL, '--corpus', corpus, '--out', out]).then(
      () => null,
      (error) => error,
    );
    expect(failed?.code).toBe(1);
    expect(failed?.stderr).toContain(`✗ ${join(corpus, file)}: carries a carriage return (Windows line endings), which no stage the corpus records has\n`);
    expect(failed?.stderr).toContain('node tools/wgsl/merge-corpus.mjs <recording.json>');
    expect(tree(out)).toEqual([]);
  }, timeLimit(60_000));

  it('leaves alone a file in the corpus that is not a corpus file, says so, and builds the rest', async () => {
    const corpus = corpusOf(readCorpusDir(FIXTURE, shared).stages);
    writeFileSync(join(corpus, 'bad.json'), '{"format":"something else"}');
    const done = await tool(corpus, directory());
    expect(Object.keys(JSON.parse(done.map).entries)).toHaveLength(2);
    expect(done.stderr).toContain(`! ${join(corpus, 'bad.json')}: not a corpus file, left alone (a recording? node tools/wgsl/merge-corpus.mjs adds its stages)\n`);
    expect(readFileSync(join(corpus, 'bad.json'), 'utf8')).toBe('{"format":"something else"}');
  }, timeLimit(60_000));
});

describe('the map read back', () => {
  const SALT = 's';
  const ENTRIES = new Map([
    ['aa', 'a\nb\n'],
    ['bb', 'b\nc'],
  ]);

  it('passes a map whose every entry expands to its translation', () => {
    const text = shared.mapText(SALT, ENTRIES);
    expect(text).toBe('{"format":"dayhike-wgsl-map/2","salt":"s","lines":["a","b","","c"],"entries":{"aa":[0,3],"bb":[1,1,3,1]}}');
    expect(readBackProblems(text, SALT, ENTRIES, shared)).toEqual([]);
    expect(readBackProblems(shared.mapText(SALT, new Map()), SALT, new Map(), shared)).toEqual([]);
  });

  it('names each entry that expands to other text than its translation, or is missing, or is no translation', () => {
    const text = shared.mapText(SALT, ENTRIES);
    expect(readBackProblems(text.replace('"lines":["a","b","","c"]', '"lines":["a","c","","b"]'), SALT, ENTRIES, shared)).toEqual([
      'the entry aa reads back as other text than its translation',
      'the entry bb reads back as other text than its translation',
    ]);
    expect(readBackProblems(text.replace('"c"]', '"d"]'), SALT, ENTRIES, shared)).toEqual(['the entry bb reads back as other text than its translation']);
    expect(readBackProblems(text.replace('"bb":[1,1,3,1]', '"bb":[1,1]'), SALT, ENTRIES, shared)).toEqual([
      'the entry bb reads back as other text than its translation',
    ]);
    expect(readBackProblems(shared.mapText(SALT, new Map([['aa', 'a\nb\n']])), SALT, ENTRIES, shared)).toEqual(['the entry bb is not in the map read back']);
    expect(readBackProblems(text, SALT, new Map([['aa', 'a\nb\n']]), shared)).toEqual(['the map read back holds bb, which is no translation']);
  });

  it('refuses a map the page would not read, with the page\'s reason', () => {
    const text = shared.mapText(SALT, ENTRIES);
    expect(readBackProblems(text.replace('[1,1,3,1]', '[1,1,4,1]'), SALT, ENTRIES, shared)).toEqual([
      'the map does not read back: the entry bb has a run outside its lines: 4, 1',
    ]);
    expect(readBackProblems(text, 'another', ENTRIES, shared)).toEqual(['the map does not read back: made for another build']);
    // A tier's map, read for that tier, for another, and for none.
    const low = shared.mapText(SALT, ENTRIES, 'low');
    expect(low).toBe('{"format":"dayhike-wgsl-map/2","salt":"s","tier":"low","lines":["a","b","","c"],"entries":{"aa":[0,3],"bb":[1,1,3,1]}}');
    expect(readBackProblems(low, SALT, ENTRIES, shared, 'low')).toEqual([]);
    expect(readBackProblems(low, SALT, ENTRIES, shared)).toEqual([]);
    expect(readBackProblems(low, SALT, ENTRIES, shared, 'high')).toEqual(['the map does not read back: made for the low tier, not high']);
    expect(readBackProblems(text, SALT, ENTRIES, shared, 'low')).toEqual(['the map does not read back: made for the undefined tier, not low']);
    expect(readBackProblems(text.slice(0, -1), SALT, ENTRIES, shared)[0]).toMatch(/^the map does not read back: /);
  });
});
