import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { readCorpusDir, stagePath } from '../lib/corpus.mjs';
import { mergeCorpus } from '../lib/mergeCorpus.mjs';
import { loadShared } from '../lib/shared.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../merge-corpus.mjs', import.meta.url));

/** A stage whose text is `#version 450` and `body`. */
const stage = (body, kind = 'fragment', flag = false) => ({ stage: kind, flag, glsl: `#version 450\n${body}` });

function directory(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-corpus-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** Every file under `dir`, by its path relative to it. */
const tree = (dir) => readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()).sort();

let shared;
beforeAll(async () => {
  shared = await loadShared();
}, timeLimit(30_000));

describe('merging recordings into the corpus', () => {
  it('writes the union, each stage once, as its stage file and its blocks, and counts what is new', () => {
    const a = stage('// a');
    const b = stage('// b', 'vertex');
    const c = stage('// c', 'fragment', true);
    const recorded = directory({
      'one.json': shared.corpusText([a, b]),
      'two.json': shared.corpusText([b, c]),
    });
    const dir = directory();
    const first = mergeCorpus({ dir, recorded: [join(recorded, 'one.json'), join(recorded, 'two.json')], shared });
    expect(first).toEqual({ read: 4, added: 3, total: 3, removed: [], normalised: 0, leftAlone: [], blocksAdded: 3, blocksRemoved: 0 });
    expect(tree(dir).filter((file) => file.startsWith('stages/'))).toEqual([a, b, c].map((s) => stagePath(s, shared)).sort());
    const { stages } = readCorpusDir(dir, shared);
    expect(new Set(stages.map((s) => shared.corpusId(s)))).toEqual(new Set([a, b, c].map((s) => shared.corpusId(s))));
    // What it read from elsewhere, it leaves where it was.
    expect(existsSync(join(recorded, 'one.json'))).toBe(true);
    expect(mergeCorpus({ dir, recorded: [join(recorded, 'one.json')], shared })).toEqual({ read: 2, added: 0, total: 3, removed: [], normalised: 0, leftAlone: [], blocksAdded: 0, blocksRemoved: 0 });
    expect(mergeCorpus({ dir, recorded: [], shared })).toEqual({ read: 0, added: 0, total: 3, removed: [], normalised: 0, leftAlone: [], blocksAdded: 0, blocksRemoved: 0 });
    // Three stage files, and a block each.
    expect(tree(dir)).toHaveLength(6);
  });

  it('merges a recording dropped into the corpus as it was downloaded, and removes it once its stages are files', () => {
    const a = stage('// a');
    const b = stage('// b');
    const dir = directory({ 'dayhike-wgsl-corpus-1790000000000.json': shared.corpusText([a, b]) });
    expect(mergeCorpus({ dir, recorded: [], shared })).toEqual({
      read: 2,
      added: 2,
      total: 2,
      removed: ['dayhike-wgsl-corpus-1790000000000.json'],
      normalised: 0,
      leftAlone: [],
      blocksAdded: 2,
      blocksRemoved: 0,
    });
    expect(tree(dir).filter((file) => file.startsWith('stages/'))).toEqual([a, b].map((s) => stagePath(s, shared)).sort());
    expect(tree(dir)).toHaveLength(4);
  });

  it('refuses a recording that is not a corpus, naming it, and writes nothing', () => {
    const dir = directory();
    const bad = join(directory({ 'report.json': '{"mode":"record","effects":[]}' }), 'report.json');
    const good = join(directory({ 'r.json': shared.corpusText([stage('// a')]) }), 'r.json');
    expect(() => mergeCorpus({ dir, recorded: [good, bad], shared })).toThrow(`${bad}: not a corpus of dayhike-wgsl-corpus/1`);
    expect(tree(dir)).toEqual([]);
  });

  it('refuses a stage that is not Unicode text, naming it, and writes nothing', () => {
    const lone = stage('// \ud800');
    const dir = directory();
    const recorded = join(directory({ 'r.json': shared.corpusText([lone]) }), 'r.json');
    expect(() => mergeCorpus({ dir, recorded: [recorded], shared })).toThrow(
      `${recorded}: the fragment stage ${shared.corpusId(lone).slice(0, 16)} is not valid UTF-8 text (it holds a lone surrogate); nothing was written`,
    );
    expect(tree(dir)).toEqual([]);
  });

  it('runs from the command line, saying what it read and what was new', async () => {
    const recorded = join(directory({ 'r.json': shared.corpusText([stage('// a'), stage('// b')]) }), 'r.json');
    const dir = directory();
    const { stdout } = await run(process.execPath, [TOOL, '--corpus', dir, recorded]);
    expect(stdout).toContain('  read:   2 stages from 1 recorded files\n  new:    2\n  holds:  2 stages\n  normalised: 0 stages had Windows line endings\n');
  }, timeLimit(30_000));
});

describe('line endings in a recording', () => {
  it('turns every \\r\\n into \\n and counts the stages it changed', () => {
    const windows = stage('// one\r\n// two\r\nvoid main() {}');
    const unix = stage('// one\n// two\nvoid main() {}');
    const other = stage('// three\r\nvoid main() {}', 'vertex');
    const dir = directory();
    const recorded = join(directory({ 'r.json': shared.corpusText([windows, unix, other]) }), 'r.json');
    expect(mergeCorpus({ dir, recorded: [recorded], shared })).toEqual({ read: 3, added: 2, total: 2, removed: [], normalised: 2, leftAlone: [], blocksAdded: 2, blocksRemoved: 0 });
    const { stages } = readCorpusDir(dir, shared);
    expect(stages.map((s) => s.glsl).sort()).toEqual(['#version 450\n// one\n// two\nvoid main() {}', '#version 450\n// three\nvoid main() {}']);
    for (const file of tree(dir)) expect(readFileSync(join(dir, file)).includes(0x0d)).toBe(false);
  });

  it('refuses a stage that still carries a carriage return after that, naming it, and writes nothing', () => {
    const lone = stage('// one\rvoid main() {}');
    const dir = directory();
    const recorded = join(directory({ 'r.json': shared.corpusText([stage('// fine'), lone]) }), 'r.json');
    expect(() => mergeCorpus({ dir, recorded: [recorded], shared })).toThrow(
      `${recorded}: the fragment stage ${shared.corpusId(lone).slice(0, 16)} carries a carriage return that ends no line; nothing was written`,
    );
    expect(tree(dir)).toEqual([]);
  });

  it('says from the command line how many stages had Windows line endings, and exits 1 on one it cannot repair', async () => {
    const recorded = join(directory({ 'r.json': shared.corpusText([stage('// a\r\nvoid main() {}'), stage('// b')]) }), 'r.json');
    const { stdout } = await run(process.execPath, [TOOL, '--corpus', directory(), recorded]);
    expect(stdout).toContain('  normalised: 1 stages had Windows line endings\n');
    const bad = join(directory({ 'r.json': shared.corpusText([stage('// a\rvoid main() {}')]) }), 'r.json');
    const failed = await run(process.execPath, [TOOL, '--corpus', directory(), bad]).then(
      () => null,
      (error) => error,
    );
    expect(failed?.code).toBe(1);
    expect(failed?.stderr).toContain('carries a carriage return that ends no line; nothing was written');
  }, timeLimit(30_000));
});
