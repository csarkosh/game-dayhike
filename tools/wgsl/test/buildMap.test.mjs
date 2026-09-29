import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as page from '../../../client/src/game/wgslFormat.ts';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { buildMap, nodeSalt } from '../lib/buildMap.mjs';
import { readCorpusDir } from '../lib/corpus.mjs';
import { NODE_CORPUS_DIR } from '../lib/files.mjs';
import { mergeCorpus } from '../lib/mergeCorpus.mjs';
import { loadShared } from '../lib/shared.mjs';
import { startTranslators, translateStage } from '../lib/translators.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../build-map.mjs', import.meta.url));
/** Two stages: a vertex stage, and a fragment stage that turns uniformity analysis off. */
const FIXTURE = fileURLToPath(new URL('./fixtures/corpus/', import.meta.url));
const BROKEN = { stage: 'fragment', flag: false, glsl: '#version 450\nvoid main( { this is not GLSL' };

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

/** Every file under `dir`, by its path relative to it. */
const tree = (dir) => readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()).sort();

/** A corpus of its own holding `stages`, one file a stage, as the merge writes it. */
function corpusOf(stages) {
  const dir = directory();
  mergeCorpus({ dir, recorded: [join(directory({ 'r.json': shared.corpusText(stages) }), 'r.json')], shared });
  return dir;
}

/** The tool run on `corpus`, writing `out`: its exit, its output and the map. */
async function tool(corpus, out, ...flags) {
  const done = await run(process.execPath, [TOOL, '--corpus', corpus, '--out', out, ...flags]);
  return { ...done, map: readFileSync(out, 'utf8') };
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
    expect(page.readMap(made.text, salt)).toEqual(made.entries);
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
    const once = buildMap({ stages, salt, translate, shared }).text;
    expect(buildMap({ stages: [...stages].reverse(), salt, translate, shared }).text).toBe(once);
    expect(buildMap({ stages: [...stages, ...stages], salt, translate, shared }).text).toBe(once);
    // Run as the build runs it, twice, and on the same stages written afresh.
    const out = directory();
    const first = await tool(FIXTURE, join(out, 'first.json'));
    const second = await tool(FIXTURE, join(out, 'second.json'));
    const third = await tool(corpusOf([...stages].reverse()), join(out, 'third.json'));
    expect(first.map).toBe(once);
    expect(second.map).toBe(once);
    expect(third.map).toBe(once);
  }, timeLimit(120_000));

  it('leaves out a stage that does not translate, says so loudly, and goes on', async () => {
    const corpus = corpusOf([BROKEN, ...readCorpusDir(FIXTURE, shared).stages]);
    const salt = nodeSalt(shared);
    const made = buildMap({ stages: readCorpusDir(corpus, shared).stages, salt, translate: (entry) => translateStage(translators, entry), shared });
    expect(made.entries.size).toBe(2);
    expect(made.failed).toEqual([{ id: shared.corpusId(BROKEN), stage: 'fragment', message: 'GLSL compilation failed' }]);
    expect(made.entries.has(page.stageKey(salt, BROKEN.stage, BROKEN.flag, BROKEN.glsl))).toBe(false);
    // The build does not fail on it.
    const out = join(directory(), 'map.json');
    const done = await tool(corpus, out);
    expect(Object.keys(JSON.parse(done.map).entries)).toHaveLength(2);
    expect(done.stderr).toContain(`FAILED     fragment  ${shared.corpusId(BROKEN).slice(0, 16)}  GLSL compilation failed`);
    expect(done.stderr).toContain('!! wgsl map: 1 of 3 stages did not translate and are NOT in the map');
    expect(done.stdout).toContain(`  failed:       1 (${shared.corpusId(BROKEN)})\n`);
  }, timeLimit(120_000));

  it('makes an empty map of an empty corpus', async () => {
    const out = join(directory(), 'map.json');
    const done = await tool(directory(), out);
    expect(done.map).toBe(`{"format":"dayhike-wgsl-map/1","salt":${JSON.stringify(nodeSalt(shared))},"entries":{}}`);
    expect(done.stdout).toContain('  entries:      0\n');
    expect(done.stdout).toContain('  failed:       0\n  bytes:');
    expect(done.stdout).toContain('  largest:      none\n');
  }, timeLimit(60_000));

  it('prints the entries, the bytes raw, gzipped and brotli\'d, and the milliseconds of each stage', async () => {
    const out = join(directory(), 'map.json');
    const done = await tool(FIXTURE, out);
    const lines = done.stdout.split('\n');
    expect(lines.filter((line) => / ms {2}(vertex {2}|fragment) {2}[0-9a-f]{16} {2}\d+ B GLSL -> \d+ B WGSL$/.test(line))).toHaveLength(2);
    expect(done.stdout).toContain('  entries:      2\n  failed:       0\n');
    expect(done.stdout).toContain('  ascii:        yes\n');
    expect(done.stdout).toMatch(/ {2}largest: {6}\d+ B of WGSL, the (vertex|fragment) stage [0-9a-f]{16}\n/);
    // The two stages' WGSL, as the shipped translators make it.
    expect(lines).toContain('  lines:        41 in all, 24 distinct in 651 B; digits as #: 41 in all, 24 distinct in 638 B');
    expect(done.stdout).toMatch(/ {2}bytes: {8}\d+ raw, \d+ gzip -9, \d+ brotli -q 11\n/);
    expect(done.stdout).toMatch(/ {2}translation: {2}translators started in \d+ ms; \d+ ms in all, \d+ ms a stage on average, \d+ ms the longest\n/);
    expect(done.stdout).toMatch(/ {2}reading it: {3}\d+\.\d\d ms as one JSON \(shipped\), \d+\.\d\d ms as an index and a text\n/);
    expect(done.stderr).toBe('');
  }, timeLimit(60_000));

  it('with --reuse leaves a map made from the same corpus under the same salt as it is, and remakes one whose corpus changed', async () => {
    const corpus = corpusOf(readCorpusDir(FIXTURE, shared).stages);
    const out = join(directory(), 'map.json');
    await tool(corpus, out);
    const made = statSync(out).mtimeMs;
    const again = await tool(corpus, out, '--reuse');
    expect(again.stdout).toContain('is up to date with');
    expect(statSync(out).mtimeMs).toBe(made);
    writeFileSync(join(corpus, 'more.json'), shared.corpusText([{ stage: 'vertex', flag: false, glsl: '#version 450\nvoid main() { gl_Position = vec4(1.0); }' }]));
    mergeCorpus({ dir: corpus, recorded: [], shared });
    const remade = await tool(corpus, out, '--reuse');
    expect(remade.stdout).not.toContain('is up to date with');
    expect(Object.keys(JSON.parse(remade.map).entries)).toHaveLength(3);
  }, timeLimit(120_000));

  it('makes the map of the corpus made under Node, every stage translated, and says what it cost', async () => {
    const out = join(directory(), 'map.json');
    const done = await tool(NODE_CORPUS_DIR, out);
    const { stages } = readCorpusDir(NODE_CORPUS_DIR, shared);
    expect(stages).toHaveLength(10);
    expect(Object.keys(JSON.parse(done.map).entries)).toHaveLength(10);
    expect(done.stderr).not.toContain('FAILED');
    // The figures, for the run's log: sizes, what reading it costs, the translators' start.
    console.log(done.stdout.slice(done.stdout.indexOf('wgsl map:')));

    // The same stages as a recording, the JSON a page downloads: merged, it
    // is the fixture's files byte for byte, and read as JSON, it makes the
    // map the files make, byte for byte.
    const recording = shared.corpusText(stages);
    const merged = corpusOf(shared.readCorpus(recording));
    expect(tree(merged)).toEqual(tree(NODE_CORPUS_DIR));
    for (const file of tree(merged)) expect(readFileSync(join(merged, file))).toEqual(readFileSync(join(NODE_CORPUS_DIR, file)));
    const fromJson = buildMap({ stages: shared.readCorpus(recording), salt: nodeSalt(shared), translate: (entry) => translateStage(translators, entry), shared });
    expect(fromJson.text).toBe(done.map);
  }, timeLimit(300_000));

  it('refuses a corpus in which a stage carries a carriage return, naming it, and writes no map', async () => {
    const corpus = corpusOf(readCorpusDir(FIXTURE, shared).stages);
    const [file] = tree(corpus);
    writeFileSync(join(corpus, file), readFileSync(join(corpus, file), 'utf8').replaceAll('\n', '\r\n'));
    const out = join(directory(), 'map.json');
    const failed = await run(process.execPath, [TOOL, '--corpus', corpus, '--out', out]).then(
      () => null,
      (error) => error,
    );
    expect(failed?.code).toBe(1);
    expect(failed?.stderr).toContain(`✗ ${join(corpus, file)}: carries a carriage return (Windows line endings), which no stage the corpus records has\n`);
    expect(failed?.stderr).toContain('node tools/wgsl/merge-corpus.mjs <recording.json>');
    expect(existsSync(out)).toBe(false);
  }, timeLimit(60_000));

  it('leaves alone a file in the corpus that is not a corpus file, says so, and builds the rest', async () => {
    const corpus = corpusOf(readCorpusDir(FIXTURE, shared).stages);
    writeFileSync(join(corpus, 'bad.json'), '{"format":"something else"}');
    const out = join(directory(), 'map.json');
    const done = await tool(corpus, out);
    expect(Object.keys(JSON.parse(done.map).entries)).toHaveLength(2);
    expect(done.stderr).toContain(`! ${join(corpus, 'bad.json')}: not a corpus file, left alone (a recording? node tools/wgsl/merge-corpus.mjs adds its stages)\n`);
    expect(readFileSync(join(corpus, 'bad.json'), 'utf8')).toBe('{"format":"something else"}');
  }, timeLimit(60_000));
});
