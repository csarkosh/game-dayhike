import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
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

/** Every stage the corpus in `dir` holds, and the files it is in. */
function corpusIn(dir, shared) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  return { files, stages: files.flatMap((name) => shared.readCorpus(readFileSync(join(dir, name), 'utf8'))) };
}

let shared;
beforeAll(async () => {
  shared = await loadShared();
}, timeLimit(30_000));

describe('merging recorded corpus files', () => {
  it('writes the union, each stage once, in the file named by the first digit of its name, and counts what is new', () => {
    const a = stage('// a');
    const b = stage('// b', 'vertex');
    const c = stage('// c', 'fragment', true);
    const recorded = directory({
      'one.json': shared.corpusText([a, b]),
      'two.json': shared.corpusText([b, c]),
    });
    const dir = directory();
    const first = mergeCorpus({ dir, recorded: [join(recorded, 'one.json'), join(recorded, 'two.json')], shared });
    expect(first).toEqual({ read: 4, added: 3, total: 3, removed: [] });
    const { files, stages } = corpusIn(dir, shared);
    expect(files).toEqual([...new Set([a, b, c].map((s) => `stages-${shared.corpusId(s)[0]}.json`))].sort());
    expect(stages).toHaveLength(3);
    expect(new Set(stages.map((s) => shared.corpusId(s)))).toEqual(new Set([a, b, c].map((s) => shared.corpusId(s))));
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8');
      // Each file as `corpusText` writes it: sorted, one stage a line.
      expect(text).toBe(shared.corpusText(shared.readCorpus(text)));
      for (const s of shared.readCorpus(text)) expect(shared.corpusId(s)[0]).toBe(name[7]);
    }
    // What it read from elsewhere, it leaves where it was.
    expect(existsSync(join(recorded, 'one.json'))).toBe(true);

    // Merged again, and with one new stage: only that one is new, and the
    // files it does not reach keep their bytes.
    const before = Object.fromEntries(files.map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
    const d = stage('// d');
    const more = directory({ 'three.json': shared.corpusText([a, d]) });
    expect(mergeCorpus({ dir, recorded: [join(more, 'three.json')], shared })).toEqual({ read: 2, added: 1, total: 4, removed: [] });
    const dFile = `stages-${shared.corpusId(d)[0]}.json`;
    for (const name of files.filter((n) => n !== dFile)) expect(readFileSync(join(dir, name), 'utf8')).toBe(before[name]);
    expect(mergeCorpus({ dir, recorded: [], shared })).toEqual({ read: 0, added: 0, total: 4, removed: [] });
  });

  it('merges a recorded file dropped into the corpus as it was downloaded, and removes it once its stages are in', () => {
    const a = stage('// a');
    const b = stage('// b');
    const dir = directory({ 'dayhike-wgsl-corpus-1790000000000.json': shared.corpusText([a, b]) });
    expect(mergeCorpus({ dir, recorded: [], shared })).toEqual({
      read: 2,
      added: 2,
      total: 2,
      removed: ['dayhike-wgsl-corpus-1790000000000.json'],
    });
    const { files, stages } = corpusIn(dir, shared);
    expect(files.every((name) => /^stages-[0-9a-f]\.json$/.test(name))).toBe(true);
    expect(stages).toHaveLength(2);
  });

  it('refuses a recorded file that is not a corpus, naming it, and writes nothing', () => {
    const dir = directory({ [`stages-0.json`]: shared.corpusText([]) });
    const bad = join(directory({ 'report.json': '{"mode":"record","effects":[]}' }), 'report.json');
    expect(() => mergeCorpus({ dir, recorded: [bad], shared })).toThrow(`${bad}: not a corpus of dayhike-wgsl-corpus/1`);
    expect(readFileSync(join(dir, 'stages-0.json'), 'utf8')).toBe(shared.corpusText([]));
  });

  it('runs from the command line, saying what it read and what was new', async () => {
    const recorded = join(directory({ 'r.json': shared.corpusText([stage('// a'), stage('// b')]) }), 'r.json');
    const dir = directory();
    const { stdout } = await run(process.execPath, [TOOL, '--corpus', dir, recorded]);
    expect(stdout).toContain('  read:   2 stages from 1 recorded files\n  new:    2\n  holds:  2 stages\n');
  }, timeLimit(30_000));
});
