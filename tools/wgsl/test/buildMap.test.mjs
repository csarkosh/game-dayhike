import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as page from '../../../client/src/game/wgslFormat.ts';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { buildMap, nodeSalt, readCorpusDir } from '../lib/buildMap.mjs';
import { CORPUS_DIR } from '../lib/files.mjs';
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

  it('makes the same bytes from the same corpus, whatever its order and however it is split into files', async () => {
    const salt = nodeSalt(shared);
    const { stages } = readCorpusDir(FIXTURE, shared);
    const translate = (entry) => translateStage(translators, entry);
    const once = buildMap({ stages, salt, translate, shared }).text;
    expect(buildMap({ stages: [...stages].reverse(), salt, translate, shared }).text).toBe(once);
    expect(buildMap({ stages: [...stages, ...stages], salt, translate, shared }).text).toBe(once);
    // Run as the build runs it, twice, and from the corpus split in two files.
    const out = directory();
    const first = await tool(FIXTURE, join(out, 'first.json'));
    const second = await tool(FIXTURE, join(out, 'second.json'));
    const split = directory({
      'a.json': shared.corpusText([stages[0]]),
      'b.json': shared.corpusText([stages[1]]),
    });
    const third = await tool(split, join(out, 'third.json'));
    expect(first.map).toBe(once);
    expect(second.map).toBe(once);
    expect(third.map).toBe(once);
  }, timeLimit(120_000));

  it('leaves out a stage that does not translate, says so loudly, and goes on', async () => {
    const corpus = directory({ 'broken.json': shared.corpusText([BROKEN]) });
    cpSync(join(FIXTURE, 'two-stages.json'), join(corpus, 'two-stages.json'));
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
  }, timeLimit(120_000));

  it('makes an empty map of an empty corpus', async () => {
    const out = join(directory(), 'map.json');
    const done = await tool(directory(), out);
    expect(done.map).toBe(`{"format":"dayhike-wgsl-map/1","salt":${JSON.stringify(nodeSalt(shared))},"entries":{}}`);
    expect(done.stdout).toContain('  entries:      0\n');
  }, timeLimit(60_000));

  it('prints the entries, the bytes raw, gzipped and brotli\'d, and the milliseconds of each stage', async () => {
    const out = join(directory(), 'map.json');
    const done = await tool(FIXTURE, out);
    const lines = done.stdout.split('\n');
    expect(lines.filter((line) => / ms {2}(vertex {2}|fragment) {2}[0-9a-f]{16} {2}\d+ B GLSL -> \d+ B WGSL$/.test(line))).toHaveLength(2);
    expect(done.stdout).toContain('  entries:      2\n');
    expect(done.stdout).toMatch(/ {2}bytes: {8}\d+ raw, \d+ gzip -9, \d+ brotli -q 11\n/);
    expect(done.stdout).toMatch(/ {2}translation: {2}translators started in \d+ ms; \d+ ms in all, \d+ ms a stage on average, \d+ ms the longest\n/);
    expect(done.stdout).toMatch(/ {2}reading it: {3}\d+\.\d\d ms as one JSON \(shipped\), \d+\.\d\d ms as an index and a text\n/);
    expect(done.stderr).toBe('');
  }, timeLimit(60_000));

  it('with --reuse leaves a map made from the same corpus under the same salt as it is, and remakes one whose corpus changed', async () => {
    const corpus = directory();
    cpSync(join(FIXTURE, 'two-stages.json'), join(corpus, 'two-stages.json'));
    const out = join(directory(), 'map.json');
    await tool(corpus, out);
    const made = statSync(out).mtimeMs;
    const again = await tool(corpus, out, '--reuse');
    expect(again.stdout).toContain('is up to date with');
    expect(statSync(out).mtimeMs).toBe(made);
    writeFileSync(join(corpus, 'more.json'), shared.corpusText([{ stage: 'vertex', flag: false, glsl: '#version 450\nvoid main() { gl_Position = vec4(1.0); }' }]));
    const remade = await tool(corpus, out, '--reuse');
    expect(remade.stdout).not.toContain('is up to date with');
    expect(Object.keys(JSON.parse(remade.map).entries)).toHaveLength(3);
  }, timeLimit(120_000));

  it('makes the map of the committed corpus, every stage translated, and says what it cost', async () => {
    const out = join(directory(), 'map.json');
    const done = await tool(CORPUS_DIR, out);
    const { stages } = readCorpusDir(CORPUS_DIR, shared);
    expect(stages).toHaveLength(10);
    expect(Object.keys(JSON.parse(done.map).entries)).toHaveLength(10);
    expect(done.stderr).not.toContain('FAILED');
    // The figures, for the run's log: sizes, what reading it costs, the translators' start.
    console.log(done.stdout.slice(done.stdout.indexOf('wgsl map:')));
  }, timeLimit(300_000));

  it('refuses a corpus file that is not one, naming it', () => {
    const corpus = directory({ 'bad.json': '{"format":"something else"}' });
    expect(() => readCorpusDir(corpus, shared)).toThrow(`${join(corpus, 'bad.json')}: not a corpus of dayhike-wgsl-corpus/1`);
  });
});
