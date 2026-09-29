import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { RECORDED, cutBlocks, readCorpusDir, stagePath } from '../lib/corpus.mjs';
import { CORPUS_DIR, NODE_CORPUS_DIR } from '../lib/files.mjs';
import { mergeCorpus } from '../lib/mergeCorpus.mjs';
import { loadShared } from '../lib/shared.mjs';

const run = promisify(execFile);
const MERGE = fileURLToPath(new URL('../merge-corpus.mjs', import.meta.url));
const BUILD = fileURLToPath(new URL('../build-map.mjs', import.meta.url));

const HEAD = '#version 450\nprecision highp float;\n\n';
const TWICE = 'float twice(float x) {\n  return x * 2.0;\n}\n';
/** Six stages. */
const STAGES = {
  vertex: { stage: 'vertex', flag: false, glsl: `${HEAD}${TWICE}layout(location = 0) in vec3 position;\nvoid main() {\n  gl_Position = vec4(position * twice(1.0), 1.0);\n}\n` },
  fragment: { stage: 'fragment', flag: false, glsl: `${HEAD}${TWICE}layout(location = 0) out vec4 glFragColor;\nvoid main() {\n  glFragColor = vec4(twice(0.5));\n}\n` },
  flagged: {
    stage: 'fragment',
    flag: true,
    glsl: `${HEAD}#define DISABLE_UNIFORMITY_ANALYSIS\nlayout(location = 0) out vec4 glFragColor;\nvoid main() {\n  glFragColor = vec4(dFdx(1.0));\n}\n`,
  },
  noFinalNewline: { stage: 'vertex', flag: false, glsl: `${HEAD}void main() {\n  gl_Position = vec4(0.0);\n}` },
  emDash: { stage: 'fragment', flag: false, glsl: `${HEAD}// the light — as the page hands it\nvoid main() {}\n` },
  newlines: { stage: 'fragment', flag: false, glsl: '#version 450\nvoid main() {}\n\n\n' },
};
/** What the merge writes of the six: every file, and its text. */
const SIX_FILES = {
  'blocks/2/230bca14d9d5f1a4.glsl': 'layout(location = 0) out vec4 glFragColor;\nvoid main() {\n  glFragColor = vec4(twice(0.5));\n}',
  'blocks/2/28b02f5729069647.glsl': 'void main() {\n  gl_Position = vec4(0.0);\n}',
  'blocks/4/4320bdc96bfb35bd.glsl': '#version 450\nprecision highp float;\n',
  'blocks/7/799c8d395343cf2b.glsl': '#define DISABLE_UNIFORMITY_ANALYSIS\nlayout(location = 0) out vec4 glFragColor;\nvoid main() {\n  glFragColor = vec4(dFdx(1.0));\n}',
  'blocks/9/90ef625aac0febc4.glsl': '// the light — as the page hands it\nvoid main() {}\n',
  'blocks/9/9ceda9b13e1dedb8.glsl': 'layout(location = 0) in vec3 position;\nvoid main() {\n  gl_Position = vec4(position * twice(1.0), 1.0);\n}',
  'blocks/b/b82d8fdbfede7ad2.glsl': '#version 450\nvoid main() {}\n',
  'blocks/e/e3b0c44298fc1c14.glsl': '',
  'blocks/e/e79f756d741da1ef.glsl': 'float twice(float x) {\n  return x * 2.0;\n}',
  'stages/1/156cbeed5d571559.fragment.txt': 'dayhike-wgsl-stage/1\n4320bdc96bfb35bd\n90ef625aac0febc4\n',
  'stages/2/2cf01fccb51ba51c.fragment.txt': 'dayhike-wgsl-stage/1\nb82d8fdbfede7ad2\ne3b0c44298fc1c14\ne3b0c44298fc1c14\n',
  'stages/a/a06e63ad51375668.fragment.uniformity-off.txt': 'dayhike-wgsl-stage/1\n4320bdc96bfb35bd\n799c8d395343cf2b\ne3b0c44298fc1c14\n',
  'stages/a/a1bbc29e67a23640.vertex.txt': 'dayhike-wgsl-stage/1\n4320bdc96bfb35bd\n28b02f5729069647\n',
  'stages/f/fe622b76d6bcf476.fragment.txt': 'dayhike-wgsl-stage/1\n4320bdc96bfb35bd\ne79f756d741da1ef\n230bca14d9d5f1a4\ne3b0c44298fc1c14\n',
  'stages/f/feccba5656cff234.vertex.txt': 'dayhike-wgsl-stage/1\n4320bdc96bfb35bd\ne79f756d741da1ef\n9ceda9b13e1dedb8\ne3b0c44298fc1c14\n',
};

function directory(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-files-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

/** Every file under `dir`, by its path relative to it. */
const tree = (dir) => readdirSync(dir, { recursive: true }).filter((name) => statSync(join(dir, name)).isFile()).sort();

/** The first 16 digits of a SHA-256, over the parts' bytes: computed here, not through the tools. */
const hash16 = (...parts) => parts.reduce((h, part) => h.update(part), createHash('sha256')).digest('hex').slice(0, 16);

let shared;
beforeAll(async () => {
  shared = await loadShared();
}, timeLimit(30_000));

/** A corpus of `stages`, written by the merge. */
function corpusOf(stages) {
  const recording = join(directory({ 'r.json': shared.corpusText(stages) }), 'r.json');
  const dir = directory();
  mergeCorpus({ dir, recorded: [recording], shared });
  return dir;
}

describe('cutting a stage into blocks', () => {
  it('ends a block after a line that is empty once trimmed or that starts with }, and joined with \\n the blocks are the text', () => {
    const cases = [
      ['', ['']],
      ['void main() {}', ['void main() {}']],
      ['void main() {}\n', ['void main() {}\n']],
      ['a;\nb;', ['a;\nb;']],
      ['a;\n\nb;\n', ['a;\n', 'b;\n']],
      ['a;\n\n\n\nb;', ['a;\n', '', '', 'b;']],
      ['a;\n  \t\nb;', ['a;\n  \t', 'b;']],
      ['float f() {\n  return 1.0;\n}\nvoid main() {\n  f();\n}', ['float f() {\n  return 1.0;\n}', 'void main() {\n  f();\n}']],
      ['float f() {\n  return 1.0;\n}\n', ['float f() {\n  return 1.0;\n}', '']],
      ['struct S {\n  float x;\n};\nS s;\n', ['struct S {\n  float x;\n};', 'S s;\n']],
      ['  }\nx;', ['  }\nx;']],
      ['\n', ['', '']],
      ['#version 450\nvoid main() {}\n\n\n', ['#version 450\nvoid main() {}\n', '', '']],
    ];
    for (const [text, blocks] of cases) {
      expect(cutBlocks(text), JSON.stringify(text)).toEqual(blocks);
      expect(cutBlocks(text).join('\n')).toBe(text);
    }
  });
});

describe('the corpus as blocks and stages', () => {
  it('writes a recording merged into an empty directory as exactly the files expected, each with the bytes expected', () => {
    const dir = corpusOf(Object.values(STAGES));
    expect(tree(dir)).toEqual(Object.keys(SIX_FILES));
    for (const [file, text] of Object.entries(SIX_FILES)) expect(readFileSync(join(dir, file)), file).toEqual(Buffer.from(text, 'utf8'));
    // A block's last byte is its text's: nothing added, nothing trimmed.
    expect(readFileSync(join(dir, 'blocks/2/28b02f5729069647.glsl')).at(-1)).toBe(0x7d);
    // The em dash as its three UTF-8 bytes.
    const dash = readFileSync(join(dir, 'blocks/9/90ef625aac0febc4.glsl'));
    expect(dash.indexOf(Buffer.from([0xe2, 0x80, 0x94]))).toBe(13);
    expect(dash.length).toBe(53);
    expect(stagePath(STAGES.flagged, shared)).toBe('stages/a/a06e63ad51375668.fragment.uniformity-off.txt');
    // Read back, each stage is its recorded text, byte for byte.
    const read = readCorpusDir(dir, shared);
    expect(read.stages).toHaveLength(6);
    expect(read.blocks).toEqual({ files: 9, bytes: 524 });
    expect(read.unused).toEqual([]);
    expect(read.others).toEqual([]);
    const byFile = new Map(read.files.map((file, i) => [file, read.stages[i]]));
    for (const entry of Object.values(STAGES)) expect(byFile.get(stagePath(entry, shared))).toEqual(entry);
  });

  it('stores a block two stages share once', () => {
    const dir = corpusOf([STAGES.vertex, STAGES.fragment]);
    expect(tree(dir).filter((file) => file.startsWith('blocks/'))).toHaveLength(5);
    expect(tree(dir).filter((file) => file.startsWith('stages/'))).toHaveLength(2);
    expect(tree(dir)).toContain('blocks/e/e79f756d741da1ef.glsl');
  });

  it('adds a new stage as its stage file and only the blocks it does not share, and changes nothing else', () => {
    const dir = corpusOf(Object.values(STAGES));
    const before = new Map(tree(dir).map((file) => [file, { bytes: readFileSync(join(dir, file)), ms: statSync(join(dir, file)).mtimeMs }]));
    const more = { stage: 'vertex', flag: false, glsl: `${HEAD}${TWICE}void main() {\n  gl_Position = vec4(twice(2.0));\n}\n` };
    const recording = join(directory({ 'r.json': shared.corpusText([STAGES.vertex, more]) }), 'r.json');
    expect(mergeCorpus({ dir, recorded: [recording], shared })).toEqual({
      read: 2,
      added: 1,
      total: 7,
      removed: [],
      normalised: 0,
      leftAlone: [],
      blocksAdded: 1,
      blocksRemoved: 0,
    });
    const added = tree(dir).filter((file) => !before.has(file));
    expect(added).toEqual(['blocks/a/a465975303450eac.glsl', stagePath(more, shared)]);
    expect(readFileSync(join(dir, added[0]), 'utf8')).toBe('void main() {\n  gl_Position = vec4(twice(2.0));\n}');
    for (const [file, { bytes, ms }] of before) {
      expect(readFileSync(join(dir, file))).toEqual(bytes);
      expect(statSync(join(dir, file)).mtimeMs).toBe(ms);
    }
  });

  it('reports a block no stage names, which the map\'s build leaves and the merge removes', async () => {
    const dir = corpusOf(Object.values(STAGES));
    // Named by its own hash: a block, only no stage names it.
    const spare = `blocks/${hash16('const float spare = 1.0;')[0]}/${hash16('const float spare = 1.0;')}.glsl`;
    writeFileSync(join(dir, spare), 'const float spare = 1.0;');
    expect(readCorpusDir(dir, shared).unused).toEqual([spare]);
    const built = await run(process.execPath, [BUILD, '--corpus', dir, '--out', join(directory(), 'map.json')]);
    expect(built.stderr).toContain(`! ${join(dir, spare)}: a block no stage names (node tools/wgsl/merge-corpus.mjs removes it)\n`);
    expect(existsSync(join(dir, spare))).toBe(true);
    expect(mergeCorpus({ dir, recorded: [], shared })).toMatchObject({ blocksAdded: 0, blocksRemoved: 1 });
    expect(existsSync(join(dir, spare))).toBe(false);
    expect(tree(dir)).toEqual(Object.keys(SIX_FILES));
  }, timeLimit(60_000));

  it('leaves alone and reports a name that is not a corpus file', async () => {
    const dir = corpusOf(Object.values(STAGES));
    writeFileSync(join(dir, 'notes.txt'), 'kept');
    writeFileSync(join(dir, 'blocks', '4', 'README.md'), 'kept');
    writeFileSync(join(dir, 'stages', 'a', 'a1bbc29e67a23640.vertex.txt.orig'), 'kept');
    const others = ['notes.txt', 'blocks/4/README.md', 'stages/a/a1bbc29e67a23640.vertex.txt.orig'];
    expect(readCorpusDir(dir, shared).others).toEqual(others);
    expect(mergeCorpus({ dir, recorded: [], shared }).leftAlone).toEqual(others);
    const { stdout } = await run(process.execPath, [MERGE, '--corpus', dir]);
    expect(stdout).toContain('  left alone notes.txt: not a corpus file\n');
    for (const file of others) expect(readFileSync(join(dir, file), 'utf8')).toBe('kept');
  }, timeLimit(30_000));
});

describe('a corpus file that is not what its name says is refused', () => {
  /** The six stages with `damage` done, and what reading them throws. */
  function refusal(damage) {
    const dir = corpusOf(Object.values(STAGES));
    damage(dir);
    let thrown = null;
    try {
      readCorpusDir(dir, shared);
    } catch (error) {
      thrown = error.message;
    }
    return { dir, thrown };
  }
  const edit = (dir, file, change) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));

  it('a block changed by one byte', () => {
    const file = 'blocks/e/e79f756d741da1ef.glsl';
    const { dir, thrown } = refusal((d) => edit(d, file, (text) => text.replace('2.0', '3.0')));
    expect(thrown).toBe(
      `${join(dir, file)}: its bytes are not the block its name says: they hash to ${hash16(readFileSync(join(dir, file)))}, ` +
        `not e79f756d741da1ef; the file was edited, reformatted or renamed\n${RECORDED}`,
    );
    expect(thrown).toContain('The corpus is recorded, not written');
    expect(thrown).toContain('node tools/wgsl/merge-corpus.mjs <recording.json>');
  });

  it('a block with a newline added at its end, a carriage return, a byte-order mark, or bytes that are not UTF-8', () => {
    const newline = refusal((d) => edit(d, 'blocks/2/28b02f5729069647.glsl', (text) => `${text}\n`));
    expect(newline.thrown).toBe(`${join(newline.dir, 'blocks/2/28b02f5729069647.glsl')}: ends with a newline its block does not have (one added on save)\n${RECORDED}`);
    const cr = refusal((d) => edit(d, 'blocks/e/e79f756d741da1ef.glsl', (text) => text.replaceAll('\n', '\r\n')));
    expect(cr.thrown).toBe(`${join(cr.dir, 'blocks/e/e79f756d741da1ef.glsl')}: carries a carriage return (Windows line endings), which no block of the corpus has\n${RECORDED}`);
    const bom = refusal((d) => edit(d, 'blocks/9/90ef625aac0febc4.glsl', (text) => `﻿${text}`));
    expect(bom.thrown).toBe(`${join(bom.dir, 'blocks/9/90ef625aac0febc4.glsl')}: starts with a byte-order mark its block does not have\n${RECORDED}`);
    const latin1 = refusal((d) => writeFileSync(join(d, 'blocks/9/90ef625aac0febc4.glsl'), Buffer.from('// the light é', 'latin1')));
    expect(latin1.thrown).toBe(`${join(latin1.dir, 'blocks/9/90ef625aac0febc4.glsl')}: is not valid UTF-8\n${RECORDED}`);
  });

  it('a missing block', () => {
    const { dir, thrown } = refusal((d) => rmSync(join(d, 'blocks/9/90ef625aac0febc4.glsl')));
    expect(thrown).toBe(`${join(dir, 'stages/1/156cbeed5d571559.fragment.txt')}: names a block the corpus does not hold: blocks/9/90ef625aac0febc4.glsl\n${RECORDED}`);
  });

  it('a stage file naming its blocks out of order', () => {
    const file = 'stages/f/fe622b76d6bcf476.fragment.txt';
    const { dir, thrown } = refusal((d) =>
      writeFileSync(join(d, file), 'dayhike-wgsl-stage/1\ne79f756d741da1ef\n4320bdc96bfb35bd\n230bca14d9d5f1a4\ne3b0c44298fc1c14\n'),
    );
    const joined = [SIX_FILES['blocks/e/e79f756d741da1ef.glsl'], SIX_FILES['blocks/4/4320bdc96bfb35bd.glsl'], SIX_FILES['blocks/2/230bca14d9d5f1a4.glsl'], ''].join('\n');
    expect(thrown).toBe(
      `${join(dir, file)}: its blocks, joined, are not the fragment stage its name says: they hash to ${hash16('\0fragment\x000\0', joined)}, ` +
        `not fe622b76d6bcf476; the file was edited (a block named, dropped or moved) or renamed\n${RECORDED}`,
    );
  });

  it('a stage file renamed to another stage, to another flag, or into another folder', () => {
    const toFragment = refusal((d) => renameSync(join(d, 'stages/a/a1bbc29e67a23640.vertex.txt'), join(d, 'stages/a/a1bbc29e67a23640.fragment.txt')));
    expect(toFragment.thrown).toBe(
      `${join(toFragment.dir, 'stages/a/a1bbc29e67a23640.fragment.txt')}: holds the vertex stage a1bbc29e67a23640, ` +
        `not the fragment stage its name says: the file was renamed\n${RECORDED}`,
    );
    const flagDropped = refusal((d) =>
      renameSync(join(d, 'stages/a/a06e63ad51375668.fragment.uniformity-off.txt'), join(d, 'stages/a/a06e63ad51375668.fragment.txt')),
    );
    expect(flagDropped.thrown).toBe(
      `${join(flagDropped.dir, 'stages/a/a06e63ad51375668.fragment.txt')}: holds the fragment stage with the uniformity analysis off a06e63ad51375668, ` +
        `not the fragment stage its name says: the file was renamed\n${RECORDED}`,
    );
    const moved = refusal((d) => renameSync(join(d, 'stages/a/a1bbc29e67a23640.vertex.txt'), join(d, 'stages/f/a1bbc29e67a23640.vertex.txt')));
    expect(moved.thrown).toBe(
      `${join(moved.dir, 'stages/f/a1bbc29e67a23640.vertex.txt')}: the stage a1bbc29e67a23640 belongs in the folder stages/a/, not stages/f/: ` +
        `the file was moved or renamed\n${RECORDED}`,
    );
  });

  it('a stage file whose blocks make its stage but are not the blocks its text is cut into', () => {
    const file = 'stages/2/2cf01fccb51ba51c.fragment.txt';
    const merged = '#version 450\nvoid main() {}\n\n';
    const { dir, thrown } = refusal((d) => {
      writeFileSync(join(d, `blocks/${hash16(merged)[0]}/${hash16(merged)}.glsl`), merged);
      writeFileSync(join(d, file), `dayhike-wgsl-stage/1\n${hash16(merged)}\ne3b0c44298fc1c14\n`);
    });
    expect(thrown).toBe(`${join(dir, file)}: its blocks make its stage, but are not the blocks its text is cut into (3 blocks): the file was edited\n${RECORDED}`);
  });

  it('a stage file that is not one', () => {
    const file = 'stages/a/a1bbc29e67a23640.vertex.txt';
    const format = refusal((d) => edit(d, file, (text) => text.replace('dayhike-wgsl-stage/1', 'dayhike-wgsl-stage/2')));
    expect(format.thrown).toBe(`${join(format.dir, file)}: is not a stage file: its first line is not dayhike-wgsl-stage/1\n${RECORDED}`);
    const line = refusal((d) => edit(d, file, (text) => text.replace('28b02f5729069647', '28b02f57')));
    expect(line.thrown).toBe(`${join(line.dir, file)}: is not a stage file: its line 3 is not a block's id\n${RECORDED}`);
    const cr = refusal((d) => edit(d, file, (text) => text.replaceAll('\n', '\r\n')));
    expect(cr.thrown).toBe(`${join(cr.dir, file)}: carries a carriage return (Windows line endings), which no stage file of the corpus has\n${RECORDED}`);
  });

  it('names every file refused, and the merge and the map\'s build write nothing', async () => {
    const { dir } = refusal((d) => {
      edit(d, 'blocks/e/e79f756d741da1ef.glsl', () => 'edited');
      edit(d, 'stages/1/156cbeed5d571559.fragment.txt', (text) => text.replace('90ef625aac0febc4', '4320bdc96bfb35bd'));
    });
    const recording = join(directory({ 'r.json': shared.corpusText([{ stage: 'vertex', flag: false, glsl: '// new' }]) }), 'r.json');
    const before = tree(dir);
    expect(() => mergeCorpus({ dir, recorded: [recording], shared })).toThrow(`${join(dir, 'blocks/e/e79f756d741da1ef.glsl')}: its bytes are not`);
    expect(() => mergeCorpus({ dir, recorded: [recording], shared })).toThrow(`${join(dir, 'stages/1/156cbeed5d571559.fragment.txt')}: its blocks, joined, are not`);
    expect(tree(dir)).toEqual(before);
    const merged = await run(process.execPath, [MERGE, '--corpus', dir, recording]).then(() => null, (error) => error);
    expect(merged?.code).toBe(1);
    expect(merged?.stderr).toContain('The corpus is recorded, not written');
    expect(merged?.stderr).toContain('Nothing was written.');
    expect(tree(dir)).toEqual(before);
    const out = join(directory(), 'map.json');
    const built = await run(process.execPath, [BUILD, '--corpus', dir, '--out', out]).then(() => null, (error) => error);
    expect(built?.code).toBe(1);
    expect(built?.stderr).toContain(`✗ ${join(dir, 'blocks/e/e79f756d741da1ef.glsl')}: its bytes are not the block its name says`);
    expect(built?.stderr).toContain(`✗ ${join(dir, 'stages/1/156cbeed5d571559.fragment.txt')}: its blocks, joined, are not the fragment stage its name says`);
    expect(built?.stderr).toContain('No map was written.');
    expect(existsSync(out)).toBe(false);
  }, timeLimit(60_000));
});

describe('the committed corpus and the tests\' fixture', () => {
  /** Each file's name checked against its own content, hashed here, not through the tools: every
   * block's bytes, and every stage's blocks' bytes joined by `\n`, which is its recorded text. */
  function roundTrip(dir) {
    const files = tree(dir);
    const blocks = new Map();
    for (const file of files.filter((f) => f.startsWith('blocks/'))) {
      const [, folder, id] = /^blocks\/([0-9a-f])\/([0-9a-f]{16})\.glsl$/.exec(file) ?? [];
      expect(id, file).toBeDefined();
      expect(folder).toBe(id[0]);
      const bytes = readFileSync(join(dir, file));
      expect(hash16(bytes), file).toBe(id);
      blocks.set(id, bytes);
    }
    const stages = files.filter((f) => f.startsWith('stages/'));
    for (const file of stages) {
      const [, folder, id, stage, off] = /^stages\/([0-9a-f])\/([0-9a-f]{16})\.(vertex|fragment)(\.uniformity-off)?\.txt$/.exec(file) ?? [];
      expect(id, file).toBeDefined();
      expect(folder).toBe(id[0]);
      const [format, ...ids] = readFileSync(join(dir, file), 'utf8').split('\n').slice(0, -1);
      expect(format).toBe('dayhike-wgsl-stage/1');
      const text = Buffer.concat(ids.flatMap((block, i) => (i === 0 ? [blocks.get(block)] : [Buffer.from('\n'), blocks.get(block)])));
      expect(hash16(`\0${stage}\0${off === undefined ? 0 : 1}\0`, text), file).toBe(id);
    }
    expect(files.length).toBe(blocks.size + stages.length);
    return { stages: stages.length, blocks: blocks.size };
  }

  it('holds the 522 recorded stages, each expanded from its blocks to the text its name is the hash of', () => {
    expect(roundTrip(CORPUS_DIR)).toEqual({ stages: 522, blocks: 939 });
    const read = readCorpusDir(CORPUS_DIR, shared);
    expect(read.stages).toHaveLength(522);
    expect(read.blocks).toEqual({ files: 939, bytes: 1_554_954 });
    expect(read.unused).toEqual([]);
    expect(read.others).toEqual([]);
    expect(read.stages.filter((s) => s.glsl.includes('—'))).toHaveLength(280);
    for (const [i, entry] of read.stages.entries()) expect(read.files[i]).toBe(stagePath(entry, shared));
  }, timeLimit(30_000));

  it('holds the fixture\'s 10 stages the same way', () => {
    expect(roundTrip(NODE_CORPUS_DIR)).toEqual({ stages: 10, blocks: 144 });
    expect(readCorpusDir(NODE_CORPUS_DIR, shared).stages).toHaveLength(10);
  });
});
