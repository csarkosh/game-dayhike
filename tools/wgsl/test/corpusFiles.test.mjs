import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { RECORDED, TIERS_FILE, readCorpusDir, readTiers, stageFile, tiersText } from '../lib/corpus.mjs';
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
/** The stage files under `dir`: every file but the index of tiers. */
const stageTree = (dir) => tree(dir).filter((name) => name !== TIERS_FILE);
/** Every tier, as a recording that names none is merged. */
const EVERY_TIER = ['low', 'medium', 'high'];

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
  it('writes a recording merged into an empty directory as exactly one file a stage, named by the stage, each file its exact bytes, and the index of tiers', () => {
    const dir = sixStages();
    expect(tree(dir)).toEqual([...Object.values(STAGES).map((s) => s.file), TIERS_FILE].sort());
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
    // Read back, the same six stages, each on every tier: the recording named none.
    const read = readCorpusDir(dir, shared);
    expect(read.files).toEqual(stageTree(dir));
    expect(read.others).toEqual([]);
    expect(new Set(read.stages.map((s) => JSON.stringify(s)))).toEqual(new Set(Object.values(STAGES).map((s) => JSON.stringify(s.entry))));
    expect(read.tiers).toEqual(new Map(Object.values(STAGES).map((s) => [s.file.slice(2, 18), EVERY_TIER])));
    // The index, one stage a line, the ids ascending.
    expect(readFileSync(join(dir, TIERS_FILE), 'utf8')).toBe(
      '{"format":"dayhike-wgsl-tiers/1","stages":{\n' +
        Object.values(STAGES)
          .map((s) => s.file.slice(2, 18))
          .sort()
          .map((id) => `"${id}":["low","medium","high"]`)
          .join(',\n') +
        '\n}}\n',
    );
  });

  it('adds a new stage as a new file and to the index, and changes nothing else in the directory', () => {
    const dir = sixStages();
    const before = new Map(stageTree(dir).map((file) => [file, { bytes: readFileSync(join(dir, file)), ms: statSync(join(dir, file)).mtimeMs }]));
    const more = { stage: 'vertex', flag: false, glsl: '#version 450\nvoid main() { gl_Position = vec4(2.0); }\n' };
    const recording = join(directory({ 'r.json': shared.corpusText([STAGES.vertex.entry, more]) }), 'r.json');
    expect(mergeCorpus({ dir, recorded: [recording], shared })).toEqual({
      read: 2,
      added: 1,
      retiered: 0,
      total: 7,
      tiers: { low: 7, medium: 7, high: 7 },
      removed: [],
      normalised: 0,
      leftAlone: [],
    });
    expect(tree(dir)).toEqual([...before.keys(), stageFile(more, shared), TIERS_FILE].sort());
    for (const [file, { bytes, ms }] of before) {
      expect(readFileSync(join(dir, file))).toEqual(bytes);
      expect(statSync(join(dir, file)).mtimeMs).toBe(ms);
    }
    expect(readCorpusDir(dir, shared).tiers.get(stageFile(more, shared).slice(2, 18))).toEqual(EVERY_TIER);
    // A merge that adds nothing and puts no stage on a new tier leaves the index as it is.
    const index = statSync(join(dir, TIERS_FILE)).mtimeMs;
    expect(mergeCorpus({ dir, recorded: [recording], shared }).added).toBe(0);
    expect(statSync(join(dir, TIERS_FILE)).mtimeMs).toBe(index);
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

describe('the index of tiers', () => {
  const SIX = Object.values(STAGES).map((s) => s.file.slice(2, 18)).sort();
  /** The six stages with `damage` done to the index, and what reading them throws. */
  function refusal(damage) {
    const dir = sixStages();
    const index = join(dir, TIERS_FILE);
    writeFileSync(index, damage(readFileSync(index, 'utf8')));
    let thrown = null;
    try {
      readCorpusDir(dir, shared);
    } catch (error) {
      thrown = error.message;
    }
    return { dir, index, thrown };
  }

  it('writes each stage once, the ids ascending and the tiers in their order, and reads back what it wrote', () => {
    const text = tiersText(new Map([['ffffffffffffffff', new Set(['high', 'low'])], ['0000000000000000', ['medium']]]), shared);
    expect(text).toBe('{"format":"dayhike-wgsl-tiers/1","stages":{\n"0000000000000000":["medium"],\n"ffffffffffffffff":["low","high"]\n}}\n');
    expect(readTiers(text, shared)).toEqual(new Map([['0000000000000000', ['medium']], ['ffffffffffffffff', ['low', 'high']]]));
    expect(tiersText(new Map(), shared)).toBe('{"format":"dayhike-wgsl-tiers/1","stages":{}}\n');
    expect(readTiers(tiersText(new Map(), shared), shared)).toEqual(new Map());
  });

  it('refuses an index that is not one: another format, no stages, a name that is no stage\'s, tiers that are not the three in order each once', () => {
    expect(() => readTiers('{"format":"dayhike-wgsl-tiers/2","stages":{}}', shared)).toThrow('is not an index of dayhike-wgsl-tiers/1: dayhike-wgsl-tiers/2');
    expect(() => readTiers('{"format":"dayhike-wgsl-tiers/1"}', shared)).toThrow('has no stages');
    expect(() => readTiers('{"format":"dayhike-wgsl-tiers/1","stages":[]}', shared)).toThrow('has no stages');
    expect(() => readTiers('{"format":"dayhike-wgsl-tiers/1","stages":{"abc":["low"]}}', shared)).toThrow('names "abc", which is not a stage\'s name (16 hexadecimal digits)');
    const bad = (tiers) => `{"format":"dayhike-wgsl-tiers/1","stages":{"0000000000000000":${JSON.stringify(tiers)}}}`;
    for (const tiers of [[], ['ultra'], ['high', 'low'], ['low', 'low'], 'low', null]) {
      expect(() => readTiers(bad(tiers), shared)).toThrow(`names the tiers ${JSON.stringify(tiers)} for 0000000000000000, not some of low, medium, high in that order, each once`);
    }
    expect(() => readTiers('{', shared)).toThrow('does not parse as JSON');
  });

  it('refuses a corpus whose index names a stage that has no file, or leaves a file out, or is missing, naming each', () => {
    const extra = refusal((text) => text.replace('"stages":{\n', '"stages":{\n"0000000000000000":["low"],\n'));
    expect(extra.thrown).toBe(`${extra.index}: names the stage 0000000000000000, which has no file in the corpus\n${RECORDED}`);
    const first = Object.values(STAGES).find((s) => s.file.slice(2, 18) === SIX[0]);
    const missingOne = refusal((text) => text.replace(`"${SIX[0]}":["low","medium","high"],\n`, ''));
    expect(missingOne.thrown).toBe(`${join(missingOne.dir, first.file)}: has no tiers in ${TIERS_FILE}\n${RECORDED}`);
    const dir = sixStages();
    rmSync(join(dir, TIERS_FILE));
    expect(() => readCorpusDir(dir, shared)).toThrow(`${join(dir, TIERS_FILE)}: missing, so no stage has the tiers it was recorded on\n${RECORDED}`);
    // An empty corpus has no index to miss.
    expect(readCorpusDir(directory(), shared)).toEqual({ stages: [], files: [], others: [], tiers: new Map() });
    const reordered = refusal((text) => text.replace(`"${SIX[0]}":["low","medium","high"],\n`, '').replace('\n}}\n', `,\n"${SIX[0]}":["low","medium","high"]\n}}\n`));
    expect(reordered.thrown).toBe(`${reordered.index}: is not as the merge writes it (one stage a line, the ids ascending): it was edited by hand\n${RECORDED}`);
    const reformatted = refusal((text) => JSON.stringify(JSON.parse(text), null, 2));
    expect(reformatted.thrown).toContain(`${reformatted.index}: is not as the merge writes it`);
    const unreadable = refusal(() => '{"format":"something else"}');
    expect(unreadable.thrown).toBe(`${unreadable.index}: is not an index of dayhike-wgsl-tiers/1: something else\n${RECORDED}`);
    expect(RECORDED).toContain('which also writes tiers.json, the index of the tiers each stage was recorded on');
  });
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
    const files = stageTree(dir);
    for (const file of files) {
      const [, folder, id, stage, off] = /^([0-9a-f])\/([0-9a-f]{16})\.(vertex|fragment)(\.uniformity-off)?\.glsl$/.exec(file) ?? [];
      expect(id, file).toBeDefined();
      expect(folder).toBe(id[0]);
      expect(idOfBytes(stage, off !== undefined, readFileSync(join(dir, file))), file).toBe(id);
    }
    return files;
  }

  it('holds the 864 recorded stages, each file\'s bytes hashing to the name it has: 600 on the medium and high tiers, 235 on low, 9 on high alone, 16 on medium alone, 4 on every tier', () => {
    expect(roundTrip(CORPUS_DIR)).toHaveLength(864);
    const read = readCorpusDir(CORPUS_DIR, shared);
    expect(read.stages).toHaveLength(864);
    expect(read.others).toEqual([]);
    expect(read.stages.filter((s) => s.glsl.includes('—'))).toHaveLength(254);
    // The 600 recorded on the medium and high tiers, the low tier's 235,
    // recorded on it alone, the 9 the high tier alone met, the 16 the
    // medium tier alone met, and the sky dome's 2 and the midges' 2, whose
    // text is the same on every tier. Stages whose text a shader no longer produces are
    // retired, not kept: the 458 PBR fragments of the atmosphere before the
    // ground cloud (2026-10-07) went that way.
    expect(read.tiers.size).toBe(864);
    const on = (tier) => [...read.tiers.values()].filter((tiers) => tiers.includes(tier)).length;
    expect([on('low'), on('medium'), on('high')]).toEqual([239, 620, 613]);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'medium,high')).toHaveLength(600);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'low')).toHaveLength(235);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'high')).toHaveLength(9);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'low,medium,high')).toHaveLength(4);
    expect(readFileSync(join(CORPUS_DIR, TIERS_FILE), 'utf8')).toBe(tiersText(read.tiers, shared));
  }, timeLimit(30_000));

  it('holds the fixture\'s 10 stages the same way, each on every tier', () => {
    expect(roundTrip(NODE_CORPUS_DIR)).toHaveLength(10);
    const read = readCorpusDir(NODE_CORPUS_DIR, shared);
    expect(read.stages).toHaveLength(10);
    expect([...read.tiers.values()]).toEqual(Array.from({ length: 10 }, () => EVERY_TIER));
  });
});
