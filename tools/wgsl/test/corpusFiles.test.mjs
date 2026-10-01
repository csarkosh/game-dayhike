import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { RECORDED, readCorpusDir, stageFile } from '../lib/corpus.mjs';
import { CORPUS_DIR, NODE_CORPUS_DIR } from '../lib/files.mjs';
import { mergeCorpus } from '../lib/mergeCorpus.mjs';
import { loadShared } from '../lib/shared.mjs';

const run = promisify(execFile);
const MERGE = fileURLToPath(new URL('../merge-corpus.mjs', import.meta.url));
const BUILD = fileURLToPath(new URL('../build-map.mjs', import.meta.url));

/** Six stages, each with the name its file must have. */
const STAGES = {
  vertex: {
    file: '1/1f9c5378261a7db6.vertex.glsl',
    entry: { stage: 'vertex', flag: false, glsl: '#version 450\nlayout(location = 0) in vec3 position;\nvoid main() { gl_Position = vec4(position, 1.0); }\n' },
  },
  fragment: {
    file: 'd/df650a7e30d8a7c2.fragment.glsl',
    entry: { stage: 'fragment', flag: false, glsl: '#version 450\nlayout(location = 0) out vec4 glFragColor;\nvoid main() { glFragColor = vec4(1.0); }\n' },
  },
  flagged: {
    file: 'f/ff6feb4cc93235b8.fragment.uniformity-off.glsl',
    entry: {
      stage: 'fragment',
      flag: true,
      glsl: '#version 450\n#define DISABLE_UNIFORMITY_ANALYSIS\nlayout(location = 0) out vec4 glFragColor;\nvoid main() { glFragColor = vec4(dFdx(1.0)); }\n',
    },
  },
  noFinalNewline: {
    file: '5/5c22fb730f6e235a.vertex.glsl',
    entry: { stage: 'vertex', flag: false, glsl: '#version 450\nvoid main() { gl_Position = vec4(0.0); }' },
  },
  emDash: {
    file: '6/6ced38dd87b3c72a.fragment.glsl',
    entry: { stage: 'fragment', flag: false, glsl: '#version 450\n// the light — as the page hands it\nvoid main() {}\n' },
  },
  newlines: {
    file: '2/2cf01fccb51ba51c.fragment.glsl',
    entry: { stage: 'fragment', flag: false, glsl: '#version 450\nvoid main() {}\n\n\n' },
  },
};

function directory(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-files-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** Every file under `dir`, by its path relative to it. */
const tree = (dir) => readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()).sort();

/** The first 16 digits of the SHA-256 the page names a stage by, over the file's own bytes. */
function idOfBytes(stage, flag, bytes) {
  return createHash('sha256').update(`\0${stage}\0${flag ? 1 : 0}\0`).update(bytes).digest('hex').slice(0, 16);
}

let shared;
beforeAll(async () => {
  shared = await loadShared();
}, timeLimit(30_000));

/** A corpus of the six stages, written by the merge. */
function sixStages() {
  const recording = join(directory({ 'r.json': shared.corpusText(Object.values(STAGES).map((s) => s.entry)) }), 'r.json');
  const dir = directory();
  mergeCorpus({ dir, recorded: [recording], shared });
  return dir;
}

describe('the corpus as one shader file a stage', () => {
  it('writes a recording merged into an empty directory as exactly one file a stage, named by the stage, each file its exact bytes', () => {
    const dir = sixStages();
    expect(tree(dir)).toEqual(Object.values(STAGES).map((s) => s.file).sort());
    for (const { file, entry } of Object.values(STAGES)) {
      expect(stageFile(entry, shared)).toBe(file);
      expect(readFileSync(join(dir, file))).toEqual(Buffer.from(entry.glsl, 'utf8'));
    }
    // The text's last byte, whatever it is, is the file's: nothing added, nothing trimmed.
    expect(readFileSync(join(dir, STAGES.noFinalNewline.file)).at(-1)).toBe(0x7d);
    expect(readFileSync(join(dir, STAGES.newlines.file)).subarray(-4)).toEqual(Buffer.from('}\n\n\n'));
    // The em dash as its three UTF-8 bytes, with no byte-order mark before the text.
    const dash = readFileSync(join(dir, STAGES.emDash.file));
    expect(dash.indexOf(Buffer.from([0xe2, 0x80, 0x94]))).toBe(26);
    expect(dash.subarray(0, 3)).toEqual(Buffer.from('#ve'));
    expect(dash.length).toBe(66);
    // Read back, the same six stages.
    const read = readCorpusDir(dir, shared);
    expect(read.files).toEqual(tree(dir));
    expect(read.others).toEqual([]);
    expect(new Set(read.stages.map((s) => JSON.stringify(s)))).toEqual(new Set(Object.values(STAGES).map((s) => JSON.stringify(s.entry))));
  });

  it('adds a new stage as a new file, and changes nothing else in the directory', () => {
    const dir = sixStages();
    const before = new Map(tree(dir).map((file) => [file, { bytes: readFileSync(join(dir, file)), ms: statSync(join(dir, file)).mtimeMs }]));
    const more = { stage: 'vertex', flag: false, glsl: '#version 450\nvoid main() { gl_Position = vec4(2.0); }\n' };
    const recording = join(directory({ 'r.json': shared.corpusText([STAGES.vertex.entry, more]) }), 'r.json');
    expect(mergeCorpus({ dir, recorded: [recording], shared })).toEqual({ read: 2, added: 1, total: 7, removed: [], normalised: 0, leftAlone: [] });
    expect(tree(dir)).toEqual([...before.keys(), stageFile(more, shared)].sort());
    for (const [file, { bytes, ms }] of before) {
      expect(readFileSync(join(dir, file))).toEqual(bytes);
      expect(statSync(join(dir, file)).mtimeMs).toBe(ms);
    }
  });

  it('leaves alone and reports a name that is not a corpus file', async () => {
    const dir = sixStages();
    writeFileSync(join(dir, 'notes.txt'), 'kept');
    writeFileSync(join(dir, '1', 'README.md'), 'kept');
    writeFileSync(join(dir, '1', '1f9c5378261a7db6.vertex.glsl.orig'), 'kept');
    const read = readCorpusDir(dir, shared);
    expect(read.stages).toHaveLength(6);
    expect(read.others).toEqual(['1/1f9c5378261a7db6.vertex.glsl.orig', '1/README.md', 'notes.txt']);
    expect(mergeCorpus({ dir, recorded: [], shared }).leftAlone).toEqual(['1/1f9c5378261a7db6.vertex.glsl.orig', '1/README.md', 'notes.txt']);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('kept');
    const { stdout } = await run(process.execPath, [MERGE, '--corpus', dir]);
    expect(stdout).toContain('  left alone notes.txt: not a corpus file\n');
    expect(tree(dir)).toContain('1/README.md');
  }, timeLimit(30_000));
});

describe('a corpus file whose bytes are not the stage its name says is refused', () => {
  /** The six stages with `damage` done to one file, and what reading them throws. */
  function refusal(damage) {
    const dir = sixStages();
    damage(dir);
    let thrown = null;
    try {
      readCorpusDir(dir, shared);
    } catch (error) {
      thrown = error.message;
    }
    return { dir, thrown };
  }
  const bytesOf = (dir, file) => readFileSync(join(dir, file));

  it('a file changed by one byte', () => {
    const file = STAGES.vertex.file;
    const { dir, thrown } = refusal((d) => writeFileSync(join(d, file), bytesOf(d, file).toString('utf8').replace('1.0', '2.0')));
    expect(thrown).toBe(
      `${join(dir, file)}: its bytes are not the vertex stage its name says: they hash to ` +
        `${idOfBytes('vertex', false, bytesOf(dir, file))}, not 1f9c5378261a7db6; the file was edited, reformatted or renamed\n${RECORDED}`,
    );
    expect(thrown).toContain('The corpus is recorded, not written');
    expect(thrown).toContain('node tools/wgsl/merge-corpus.mjs <recording.json>');
  });

  it('a file renamed to another stage, or to another flag, or into another folder', () => {
    const toFragment = refusal((d) => renameSync(join(d, STAGES.vertex.file), join(d, '1/1f9c5378261a7db6.fragment.glsl')));
    expect(toFragment.thrown).toBe(
      `${join(toFragment.dir, '1/1f9c5378261a7db6.fragment.glsl')}: holds the vertex stage 1f9c5378261a7db6, ` +
        `not the fragment stage its name says: the file was renamed\n${RECORDED}`,
    );
    const flagDropped = refusal((d) => renameSync(join(d, STAGES.flagged.file), join(d, 'f/ff6feb4cc93235b8.fragment.glsl')));
    expect(flagDropped.thrown).toBe(
      `${join(flagDropped.dir, 'f/ff6feb4cc93235b8.fragment.glsl')}: holds the fragment stage with the uniformity analysis off ff6feb4cc93235b8, ` +
        `not the fragment stage its name says: the file was renamed\n${RECORDED}`,
    );
    const flagAdded = refusal((d) => renameSync(join(d, STAGES.fragment.file), join(d, 'd/df650a7e30d8a7c2.fragment.uniformity-off.glsl')));
    expect(flagAdded.thrown).toContain(': holds the fragment stage df650a7e30d8a7c2, not the fragment stage with the uniformity analysis off its name says: the file was renamed\n');
    const moved = refusal((d) => renameSync(join(d, STAGES.vertex.file), join(d, 'd', '1f9c5378261a7db6.vertex.glsl')));
    expect(moved.thrown).toBe(
      `${join(moved.dir, 'd/1f9c5378261a7db6.vertex.glsl')}: a stage named 1f9c5378261a7db6 belongs in the folder 1/, not d/: the file was moved or renamed\n${RECORDED}`,
    );
  });

  it('a file with a newline added at its end', () => {
    const file = STAGES.noFinalNewline.file;
    const { dir, thrown } = refusal((d) => writeFileSync(join(d, file), Buffer.concat([bytesOf(d, file), Buffer.from('\n')])));
    expect(thrown).toBe(`${join(dir, file)}: ends with a newline its stage does not have (one added on save)\n${RECORDED}`);
  });

  it('a file with a carriage return', () => {
    const file = STAGES.fragment.file;
    const { dir, thrown } = refusal((d) => writeFileSync(join(d, file), bytesOf(d, file).toString('utf8').replaceAll('\n', '\r\n')));
    expect(thrown).toBe(`${join(dir, file)}: carries a carriage return (Windows line endings), which no stage the corpus records has\n${RECORDED}`);
  });

  it('a file with trailing whitespace trimmed, a byte-order mark added, or bytes that are not UTF-8', () => {
    const trimmed = refusal((d) => writeFileSync(join(d, STAGES.newlines.file), '#version 450\nvoid main() {}'));
    expect(trimmed.thrown).toContain(`${join(trimmed.dir, STAGES.newlines.file)}: its bytes are not the fragment stage its name says`);
    const bom = refusal((d) => writeFileSync(join(d, STAGES.emDash.file), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytesOf(d, STAGES.emDash.file)])));
    expect(bom.thrown).toBe(`${join(bom.dir, STAGES.emDash.file)}: starts with a byte-order mark its stage does not have\n${RECORDED}`);
    const latin1 = refusal((d) => writeFileSync(join(d, STAGES.emDash.file), Buffer.from(STAGES.emDash.entry.glsl.replace('—', 'é'), 'latin1')));
    expect(latin1.thrown).toBe(`${join(latin1.dir, STAGES.emDash.file)}: is not valid UTF-8\n${RECORDED}`);
  });

  it('names every file refused, and the merge and the map\'s build write nothing', async () => {
    const { dir } = refusal((d) => {
      writeFileSync(join(d, STAGES.vertex.file), 'edited');
      writeFileSync(join(d, STAGES.fragment.file), 'edited');
    });
    const recording = join(directory({ 'r.json': shared.corpusText([{ stage: 'vertex', flag: false, glsl: '// new' }]) }), 'r.json');
    const before = tree(dir);
    expect(() => mergeCorpus({ dir, recorded: [recording], shared })).toThrow(`${join(dir, STAGES.vertex.file)}: its bytes are not`);
    expect(() => mergeCorpus({ dir, recorded: [recording], shared })).toThrow(`${join(dir, STAGES.fragment.file)}: its bytes are not`);
    expect(tree(dir)).toEqual(before);
    const merged = await run(process.execPath, [MERGE, '--corpus', dir, recording]).then(() => null, (error) => error);
    expect(merged?.code).toBe(1);
    expect(merged?.stderr).toContain('The corpus is recorded, not written');
    expect(merged?.stderr).toContain('Nothing was written.');
    expect(tree(dir)).toEqual(before);
    const out = join(directory(), 'map.json');
    const built = await run(process.execPath, [BUILD, '--corpus', dir, '--out', out]).then(() => null, (error) => error);
    expect(built?.code).toBe(1);
    expect(built?.stderr).toContain(`✗ ${join(dir, STAGES.fragment.file)}: its bytes are not the fragment stage its name says`);
    expect(built?.stderr).toContain('No map was written.');
    expect(existsSync(out)).toBe(false);
  }, timeLimit(60_000));
});

describe('the committed corpus and the tests\' fixture', () => {
  /** Each file's name checked against its own bytes, hashed here, not through the tools. */
  function roundTrip(dir) {
    const files = tree(dir);
    for (const file of files) {
      const [, folder, id, stage, off] = /^([0-9a-f])\/([0-9a-f]{16})\.(vertex|fragment)(\.uniformity-off)?\.glsl$/.exec(file) ?? [];
      expect(id, file).toBeDefined();
      expect(folder).toBe(id[0]);
      expect(idOfBytes(stage, off !== undefined, readFileSync(join(dir, file))), file).toBe(id);
    }
    return files;
  }

  it('holds the 663 recorded stages, each file\'s bytes hashing to the name it has', () => {
    expect(roundTrip(CORPUS_DIR)).toHaveLength(663);
    const read = readCorpusDir(CORPUS_DIR, shared);
    expect(read.stages).toHaveLength(663);
    expect(read.others).toEqual([]);
    expect(read.stages.filter((s) => s.glsl.includes('—'))).toHaveLength(359);
  }, timeLimit(30_000));

  it('holds the fixture\'s 10 stages the same way', () => {
    expect(roundTrip(NODE_CORPUS_DIR)).toHaveLength(10);
    expect(readCorpusDir(NODE_CORPUS_DIR, shared).stages).toHaveLength(10);
  });
});
