// The committed corpus (`client/shaders/corpus/`): one shader file a stage,
// and an index of the tiers each stage was recorded on, read by the map's
// build (`build-map.mjs`) and written by the merge (`merge-corpus.mjs`).
//
// A stage's file is `<h>/<id>.<stage>[.uniformity-off].glsl`: `<id>` the
// first 16 hexadecimal digits of its `corpusId` (the name the tools print),
// `<h>` the first of them, `<stage>` `vertex` or `fragment`, and
// `.uniformity-off` there exactly when its flag is set (its WGSL is made
// with Tint's uniformity analysis off). The file's bytes ARE the stage's
// text, UTF-8, nothing added or removed: a stage's key is a hash of its
// exact text, so one byte of difference is a stage no page asks for. The
// name is therefore checked against the bytes on every read, and a file
// whose bytes are not the stage its name says is refused.
//
// The index, `tiers.json` at the top of the corpus (`TIERS_FILE`), names for
// every stage the quality tiers it was recorded on: the build makes a map a
// tier of the stages recorded on it, since the union of every tier's stages
// passed one map's ceiling. It is `{"format": TIERS_FORMAT, "stages": {<id>:
// [<tier>, ...], ...}}`, one stage a line, the ids ascending and the tiers in
// `TIERS`' order (`tiersText`), so the same corpus gives the same bytes. It
// names every stage of the corpus and no other, each on one tier at least.

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The name of a stage's file within its folder: its id, stage and flag. */
export const STAGE_FILE = /^([0-9a-f]{16})\.(vertex|fragment)(\.uniformity-off)?\.glsl$/;
/** A folder of the corpus: the first digit of the ids in it. */
const FOLDER = /^[0-9a-f]$/;
/** How many digits of a stage's `corpusId` name its file. */
const ID_DIGITS = 16;
/** The index of tiers, at the top of the corpus. */
export const TIERS_FILE = 'tiers.json';
/** The index's format. */
export const TIERS_FORMAT = 'dayhike-wgsl-tiers/1';

/** What every refusal ends with: what the corpus is, and how to put it right. */
export const RECORDED =
  'The corpus is recorded, not written: each file is the exact text a page handed the shader translator, named by a hash of its bytes, ' +
  'so a file changed by hand or by an editor (a newline added at the end, whitespace trimmed, line endings changed) is a stage no page asks for. ' +
  'Restore it from Git (git checkout -- <file>). Stages are added only from a page recorded with ?wgsl=record, ' +
  'by node tools/wgsl/merge-corpus.mjs <recording.json>, which also writes tiers.json, the index of the tiers each stage was recorded on.';

/** An error as the tools print it: `✗` before each line of what went wrong,
 * and what the corpus is (`RECORDED`), when it says so, after them as it is. */
export function refusalText(error) {
  const text = error instanceof Error ? error.message : String(error);
  const at = text.indexOf(RECORDED);
  const head = at < 0 ? text : text.slice(0, at).trimEnd();
  return head.split('\n').map((line) => `✗ ${line}`).join('\n') + (at < 0 ? '' : `\n${text.slice(at)}`);
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** The path, relative to the corpus, of `entry`'s file. */
export function stageFile(entry, shared) {
  const id = shared.corpusId(entry);
  return `${id[0]}/${id.slice(0, ID_DIGITS)}.${entry.stage}${entry.flag ? '.uniformity-off' : ''}.glsl`;
}

/** The name of `entry` in the index: the digits that name its file. */
export function stageId(entry, shared) {
  return shared.corpusId(entry).slice(0, ID_DIGITS);
}

/** How a stage is named in a message. */
const described = (stage, flag) => `${stage} stage${flag ? ' with the uniformity analysis off' : ''}`;

/**
 * Why the file at `path` (in folder `folder`, named `name`) is not the stage
 * its name says, or null when it is; and the stage it holds.
 */
function checkFile(path, folder, name, shared) {
  const [, id, stage, off] = STAGE_FILE.exec(name);
  const flag = off !== undefined;
  if (folder !== id[0]) return { problem: `a stage named ${id} belongs in the folder ${id[0]}/, not ${folder}/: the file was moved or renamed` };
  let glsl;
  try {
    glsl = decoder.decode(readFileSync(path));
  } catch {
    return { problem: 'is not valid UTF-8' };
  }
  if (glsl.includes('\r')) return { problem: 'carries a carriage return (Windows line endings), which no stage the corpus records has' };
  const idOf = (text, s = stage, f = flag) => shared.corpusId({ stage: s, flag: f, glsl: text }).slice(0, ID_DIGITS);
  const actual = idOf(glsl);
  if (actual === id) return { entry: { stage, flag, glsl } };
  if (glsl.startsWith('﻿') && idOf(glsl.slice(1)) === id) return { problem: 'starts with a byte-order mark its stage does not have' };
  if (glsl.endsWith('\n') && idOf(glsl.slice(0, -1)) === id) return { problem: 'ends with a newline its stage does not have (one added on save)' };
  for (const [s, f] of [['vertex', false], ['vertex', true], ['fragment', false], ['fragment', true]]) {
    if ((s !== stage || f !== flag) && idOf(glsl, s, f) === id) {
      return { problem: `holds the ${described(s, f)} ${id}, not the ${described(stage, flag)} its name says: the file was renamed` };
    }
  }
  return { problem: `its bytes are not the ${described(stage, flag)} its name says: they hash to ${actual}, not ${id}; the file was edited, reformatted or renamed` };
}

/**
 * The index's text for `tiers` (a stage's id to the tiers it was recorded
 * on): one stage a line, the ids ascending, each stage's tiers in `TIERS`'
 * order, each once.
 */
export function tiersText(tiers, shared) {
  const lines = [...tiers.keys()].sort().map((id) => {
    const on = new Set(tiers.get(id));
    return `${JSON.stringify(id)}:${JSON.stringify(shared.TIERS.filter((tier) => on.has(tier)))}`;
  });
  const body = lines.length === 0 ? '' : `\n${lines.join(',\n')}\n`;
  return `{"format":${JSON.stringify(TIERS_FORMAT)},"stages":{${body}}}\n`;
}

/**
 * The index read from its `text`: each stage's id to its tiers. Throws on
 * another format, an id that is not a stage's, and tiers that are not some
 * of `TIERS` in that order, each once, one at least.
 */
export function readTiers(text, shared) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('does not parse as JSON');
  }
  if (file?.format !== TIERS_FORMAT) throw new Error(`is not an index of ${TIERS_FORMAT}: ${String(file?.format)}`);
  if (typeof file.stages !== 'object' || file.stages === null || Array.isArray(file.stages)) throw new Error('has no stages');
  const tiers = new Map();
  for (const [id, listed] of Object.entries(file.stages)) {
    if (!/^[0-9a-f]{16}$/.test(id)) throw new Error(`names ${JSON.stringify(id)}, which is not a stage's name (16 hexadecimal digits)`);
    const inOrder = Array.isArray(listed) && listed.length > 0 && listed.every((tier, i) => i === 0 || shared.TIERS.indexOf(listed[i - 1]) < shared.TIERS.indexOf(tier));
    if (!inOrder || !listed.every((tier) => shared.TIERS.includes(tier))) {
      throw new Error(`names the tiers ${JSON.stringify(listed)} for ${id}, not some of ${shared.TIERS.join(', ')} in that order, each once`);
    }
    tiers.set(id, listed);
  }
  return tiers;
}

/**
 * The stages of the corpus in `dir`, read from its files in path order:
 * `stages`, `files` (each stage's path relative to `dir`), `tiers` (the
 * index: each stage's id to the tiers it was recorded on) and `others`,
 * every name in `dir` that is not a corpus file (a `*.json` at the top is a
 * recording dropped in as it was downloaded), left alone for the caller to
 * report. A corpus file whose bytes are not the stage its name says, that
 * carries a carriage return or that is not UTF-8 is refused: it throws,
 * naming every such file, before anything is written. So is an index that
 * does not read or is not as the merge writes it (`tiersText`: one stage a
 * line, the ids ascending), names a stage that has no file, or leaves a
 * file's stage out; and a corpus with stages but no index.
 */
export function readCorpusDir(dir, shared) {
  const stages = [];
  const files = [];
  const others = [];
  const refused = [];
  /** Every stage a file names, refused or not: the index is held to them. */
  const named = new Set();
  for (const folder of readdirSync(dir).sort()) {
    const folderPath = join(dir, folder);
    if (folder === TIERS_FILE && statSync(folderPath).isFile()) continue;
    if (!FOLDER.test(folder) || !statSync(folderPath).isDirectory()) {
      others.push(folder);
      continue;
    }
    for (const name of readdirSync(folderPath).sort()) {
      const path = join(folderPath, name);
      if (!STAGE_FILE.test(name) || !statSync(path).isFile()) {
        others.push(`${folder}/${name}`);
        continue;
      }
      named.add(STAGE_FILE.exec(name)[1]);
      const checked = checkFile(path, folder, name, shared);
      if (checked.problem !== undefined) refused.push(`${path}: ${checked.problem}`);
      else {
        stages.push(checked.entry);
        files.push(`${folder}/${name}`);
      }
    }
  }
  const indexPath = join(dir, TIERS_FILE);
  let tiers = new Map();
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    try {
      const text = readFileSync(indexPath, 'utf8');
      tiers = readTiers(text, shared);
      if (text !== tiersText(tiers, shared)) throw new Error('is not as the merge writes it (one stage a line, the ids ascending): it was edited by hand');
    } catch (error) {
      refused.push(`${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
      tiers = null;
    }
  } else if (stages.length > 0) {
    refused.push(`${indexPath}: missing, so no stage has the tiers it was recorded on`);
    tiers = null;
  }
  if (tiers !== null) {
    for (const id of tiers.keys()) if (!named.has(id)) refused.push(`${indexPath}: names the stage ${id}, which has no file in the corpus`);
    for (const file of files) {
      if (!tiers.has(STAGE_FILE.exec(file.slice(2))[1])) refused.push(`${join(dir, file)}: has no tiers in ${TIERS_FILE}`);
    }
  }
  if (refused.length > 0) throw new Error(`${refused.join('\n')}\n${RECORDED}`);
  return { stages, files, others, tiers };
}

/**
 * Removes every corpus file in `dir`, unread, and each folder it empties,
 * and the index; nothing else. For a corpus written afresh
 * (`node-corpus.mjs`).
 */
export function removeCorpusFiles(dir) {
  for (const folder of readdirSync(dir)) {
    const folderPath = join(dir, folder);
    if (!FOLDER.test(folder) || !statSync(folderPath).isDirectory()) continue;
    for (const name of readdirSync(folderPath)) if (STAGE_FILE.test(name)) rmSync(join(folderPath, name));
    if (readdirSync(folderPath).length === 0) rmSync(folderPath, { recursive: true });
  }
  rmSync(join(dir, TIERS_FILE), { force: true });
}
