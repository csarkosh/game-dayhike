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

  it('holds the 1399 recorded stages, each file\'s bytes hashing to the name it has: 324 on the medium and high tiers, 561 on low, 212 on high alone, 298 on medium alone, 4 on every tier', () => {
    expect(roundTrip(CORPUS_DIR)).toHaveLength(1399);
    const read = readCorpusDir(CORPUS_DIR, shared);
    expect(read.stages).toHaveLength(1399);
    expect(read.others).toEqual([]);
    expect(read.stages.filter((s) => s.glsl.includes('—'))).toHaveLength(796);
    // The 222 recorded on the medium and high tiers (the far field: the prepass's variants of
    // every material on the two tiers the far softening reads the scene's depth on, the
    // ground haze in every PBR fragment, the meadow's far band in the clutter's vertex stages,
    // the high tier's three cascades and its far shadows, 790 stages new over a recording at
    // the ten places on the three tiers; 193 retired as define-set twins, 155 PBR fragments
    // and 6 under uniformity off before the haze and 32 PBR vertex stages before the far band;
    // and, the high and medium maps having passed the 10 MiB ceiling, every material stage
    // those two tiers can no longer compile dropped from them, 972 of them whole files: the
    // prepass's define is the scene's, so a render target that opts out of the prepass still
    // compiles the prepass variant (the impostor bake's stages carry it), and a plain PBR or
    // default stage the recording did not meet on the tier cannot recur there, nor can a
    // receiver under the high tier's two cascades or its PCF; the eighteen plain stages the
    // medium tier did meet, two materials compiled twice on each page, are kept (2026-10-16);
    // the dead trees' dressing, the deadwood
    // plugin's role attribute, varying and moss sampler on the snag's and the logs' PBR stages
    // and the snag's bake, 12 stages here and 11 on low, met at the ten places, the six PBR
    // vertex stages of the undressed snag retired (2026-10-15); the lake as one surface, its ripples'
    // amplitude the breeze's field in streaks, its skin in whole mats, its bed added after the fog
    // and its caustics signed under the sun, met at a lake on the title's world from its lower
    // shore, a tenth place, at the tarn and from the title's tour (2026-10-15); the sun's
    // soft-edged shadows on the high tier, the terrain reading the trail's two tables from one
    // texture and every shadowed receiver under the contact-hardening define, met at the ten
    // places on high alone, 192 stages new over this recording and most of the 231 the high
    // tier alone holds (2026-10-15); the trunks' bark under its moss, on the wet
    // side, low on the trunk and more on some trees than others, 26 stages here and 20 on low, met
    // on the forest floor, at the trailhead, in the meadow, at the tarn, dry and under rain, from
    // the win to the title page, and on the title's and the intro's pages (2026-10-14); the
    // foliage's vertex stages, 36 here and 26 on low, and its fragment stages and the far
    // ground's in the wording the floors and the olive sward kept, 38 here and 28 on low
    // (2026-10-14); 16 PBR stages the intro's page met on the low tier and 3 the win met there
    // (2026-10-14); the foliage's stages with the canopy's
    // share of the sky and of the sun apart, the cards' contrast toward the main tuft's colour,
    // the albedo floor, the half-Lambert wrap and the cast shadow held at three quarters on
    // the cover, and the far ground's olive sward with its metre-scale clumps, met on the forest floor, at the trailhead, in the meadow,
    // at the tarn, dry and under rain, from the win to the title page, and on the title's and
    // the intro's pages (2026-10-14); the trees' bark with its occlusion, roughness and
    // metalness map and no vertex tangent, the giant pine in both its barks, met at the same
    // places (2026-10-14); the foliage's fragment stages with the
    // sun's wrap and backlight keyed on the light's directional define, met on the forest floor,
    // at the trailhead, in the meadow and at the tarn, dry and under rain, 13 here and 13 on low,
    // and one stage the medium tier held alone that the high tier met too (2026-10-13); the lake's water with the faint bump outside
    // its cat's-paws, met at a lake from the title's tour and from its shore under a lamp and under
    // rain (2026-10-13); the end scene's stages, first
    // met at night in the eerie weather from the win to the title page (2026-10-13):
    // the film's car under the hike's lights, fog, shadows and wet layer, its dark
    // patch, the tail lamps drawn outside the fog and the car's materials under the
    // local body's lamp, 132 stages over this set and the two tiers' own; the
    // rain's streak vertex stage falling whole under the canopy and the splashes' with no cover term
    // (2026-10-13), the drip vertex stage with the sky fade softened (2026-10-12), four stages of two wet
    // materials first met at a lake under three lights among them
    // (2026-10-11), a foliage material's pbr pair first met when the foliage
    // light injection took its FOLIAGE guard (2026-10-12)), the low tier's
    // 483, recorded on it alone (the end scene's 98, which the tier's earlier
    // recording, ended before the win, had not met (2026-10-13), a foliage pbr
    // pair of the same recording
    // among them, and the rain's streak vertex stage with the sky fade softened), the 151 the high tier alone met (the soft-edged shadows' receivers and their prepass variants, the lake's
    // mirror, the sea's curl and fourteen PBR stages the canopy trail under rain
    // first met on 2026-10-12 among them), the 232 the medium tier alone met (its receivers' prepass variants under its two cascades' PCF, and a PBR pair
    // the canopy trail under rain first met on 2026-10-13 among them), and the sky
    // dome's 2 and the midges' 2, whose text is the same on every tier.
    // Stages whose text a shader no longer produces are
    // retired, not kept, each one a tracked stage whose define set a recorded stage meets with
    // another text and which none of the thirty pages met as it was: 292 PBR vertex stages before
    // the atmosphere's cloud uniforms (its near veil and its trail) were in the block, 60 PBR
    // fragment stages (the lake's and the sea's water before the one surface, the bed after the
    // fog and the signed caustics, and stages whose headlamp's light defines the page now lists
    // in another order), the grade's 4, the lens's 1 and 4 postprocess vertex stages before the
    // shades were lighter and blurrier, 361 over the recording of 2026-10-15; the trees' bark's 11 fragment stages before the moss, and the foliage's
    // 61 fragment stages and the far ground's 4 recorded before the floors' and the olive sward's
    // last wording, every one met again in the wording that stands (2026-10-14); the foliage's
    // vertex stages, retired with the stages before the floors though the pages still met them,
    // are back (2026-10-14); the foliage's stages before the canopy's share of the sky and of the
    // sun were apart, before the cards' contrast and before the floors and the half-Lambert
    // wrap, and the far ground's before its olive sward, 391 of them over the three
    // recordings of 2026-10-14, 73 of which the pages did not meet again (the lamps of three and more
    // players, the lamps under rain, the lake's mirror, and the blades under rain)
    // (2026-10-14), the foliage's 35 fragment stages before the wrap was keyed on the sun's
    // define, 13 of which the pages did not meet again (a second player's lamp under rain, the
    // lake's mirror, and the blades under rain) (2026-10-13),
    // the lake's water before the faint bump outside its paws, with its twin
    // reading the bump straight off the mesh's UV, a first frame's compile the pages recorded
    // did not meet again (2026-10-13),
    // the rain's streak and splash vertex stages before the
    // canopy stopped lightening them (2026-10-13), the rain's 3 vertex stages before its sky fade softened
    // (2026-10-12), the terrain's 2 stages before the lakes' shore reads
    // (2026-10-11), its 3 stages before the far ground's
    // cover (2026-10-10), the sea's 8 stages before it rested on the pebbles
    // between sheets (2026-10-09), its 15 and the wet ground's 523 before
    // the swash climbed the beach (2026-10-09), the lake's 3 vertex stages before its mirror
    // smeared by the eye's travel (2026-10-08) went that way, the 458 PBR
    // fragments of the atmosphere before the
    // ground cloud (2026-10-07), the grade's before the
    // shades' dissolve, the 156 PBR fragments before the cloud's near veil,
    // the 149 before the trail's share and the real thing's shadow form, and
    // the grade's before the real thing stood whole and sharper.
    // 2026-10-17, the painted look: every PBR fragment (the fog's haze, the
    // cover's green), the far cover, the grade and the new paint pass changed
    // text, so 41 pages were recorded again on the three tiers, 257 older
    // texts retired and 269 new stages added (12 of them the paint pass and
    // the grade's palette variants), the eerie evening on low left unrecorded
    // (its page hung) and so its older texts kept. 2026-10-20: the shades'
    // smoke, the plugin on the mask's figures, 9 stages on the medium and high
    // tiers, met on the haunt's page (high on the climb at night). The same
    // day the summit's scene and the win's end scene, which no page had met,
    // so a WebGPU page translated some 80 stages at each one's first frame:
    // 221 stages on the three tiers, the two pages recorded.
    // The temporal anti-aliasing's fragment and the trunks' bark shade and the matched cover's
    // material stages (2026-10-28), four places (the trailhead, the forest, the night, the rain)
    // recorded on medium and high: 54 stages new, 3 gained a tier.
    expect(read.tiers.size).toBe(1399);
    const on = (tier) => [...read.tiers.values()].filter((tiers) => tiers.includes(tier)).length;
    expect([on('low'), on('medium'), on('high')]).toEqual([565, 626, 540]);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'medium,high')).toHaveLength(324);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'low')).toHaveLength(561);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'high')).toHaveLength(212);
    expect([...read.tiers.values()].filter((tiers) => tiers.join() === 'medium')).toHaveLength(298);
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
