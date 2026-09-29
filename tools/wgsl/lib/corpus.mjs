// The committed corpus (`client/shaders/corpus/`), read by the map's build
// (`build-map.mjs`) and written by the merge (`merge-corpus.mjs`).
//
// The 522 recorded stages are made of far fewer distinct pieces of text: the
// same functions, declarations and defines recur in most of them. The corpus
// keeps each piece once, and each stage as the list of its pieces:
//
// - `blocks/<h>/<block id>.glsl`: one file a distinct BLOCK (`cutBlocks`),
//   its bytes exactly the block's text (UTF-8, nothing added, no newline
//   added at the end); `<block id>` the first 16 hexadecimal digits of the
//   SHA-256 of those bytes, `<h>` the first of them.
// - `stages/<h>/<id>.<stage>[.uniformity-off].txt`: one small file a stage,
//   `STAGE_FORMAT` on its first line, then its blocks' ids, one a line, in
//   order. `<id>` is the first 16 hexadecimal digits of the stage's
//   `corpusId` (the name the tools print), `<stage>` `vertex` or `fragment`,
//   and `.uniformity-off` there exactly when its flag is set (its WGSL is
//   made with Tint's uniformity analysis off).
//
// A stage's text is its blocks' texts joined by `\n`. Its key is a hash of
// that exact text, so one byte of difference is a stage no page asks for:
// every name is checked against the content on every read, and a block
// whose bytes are not its name, or a stage whose blocks do not make the
// stage its name says, is refused. The build writes every stage expanded,
// whole, into a directory that is not committed (`writeExpanded`), for a
// person to open.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The first line of a stage's file. */
export const STAGE_FORMAT = 'dayhike-wgsl-stage/1';
/** The name of a block's file within its folder. */
const BLOCK_FILE = /^([0-9a-f]{16})\.glsl$/;
/** The name of a stage's file within its folder: its id, stage and flag. */
const STAGE_FILE = /^([0-9a-f]{16})\.(vertex|fragment)(\.uniformity-off)?\.txt$/;
/** The name of an expanded stage's file within its folder. */
const EXPANDED_FILE = /^([0-9a-f]{16})\.(vertex|fragment)(\.uniformity-off)?\.glsl$/;
/** A folder: the first digit of the ids in it. */
const FOLDER = /^[0-9a-f]$/;
/** How many hexadecimal digits of a hash name a file. */
const ID_DIGITS = 16;

/** What every refusal ends with: what the corpus is, and how to put it right. */
export const RECORDED =
  'The corpus is recorded, not written: its stages are the exact texts pages handed the shader translator, cut into blocks, ' +
  'and every file is named by a hash of its content, so a file changed by hand or by an editor ' +
  '(a newline added at the end, whitespace trimmed, line endings changed) is a stage no page asks for. ' +
  'Restore it from Git (git checkout -- <file>). Stages are added only from a page recorded with ?wgsl=record, ' +
  'by node tools/wgsl/merge-corpus.mjs <recording.json>.';

/** An error as the tools print it: `✗` before each line of what went wrong,
 * and what the corpus is (`RECORDED`), when it says so, after them as it is. */
export function refusalText(error) {
  const text = error instanceof Error ? error.message : String(error);
  const at = text.indexOf(RECORDED);
  const head = at < 0 ? text : text.slice(0, at).trimEnd();
  return head.split('\n').map((line) => `✗ ${line}`).join('\n') + (at < 0 ? '' : `\n${text.slice(at)}`);
}

/**
 * `text` cut into blocks, the one rule every stage is cut by, so that the
 * same text always gives the same blocks: the text is split at `\n` into
 * lines; a block ends after a line that is empty once trimmed or that starts
 * with `}`; whatever is left at the end is the last block. A block's text is
 * its lines joined by `\n`, and `cutBlocks(text).join('\n') === text`,
 * whether or not the text ends in a newline.
 */
export function cutBlocks(text) {
  const blocks = [];
  let lines = [];
  for (const line of text.split('\n')) {
    lines.push(line);
    if (line.trim() === '' || line.startsWith('}')) {
      blocks.push(lines.join('\n'));
      lines = [];
    }
  }
  if (lines.length > 0) blocks.push(lines.join('\n'));
  return blocks;
}

/** A block's id: the first 16 digits of the SHA-256 of its UTF-8 bytes. */
export function blockId(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, ID_DIGITS);
}

/** The path, relative to the corpus, of the block `id`. */
export const blockPath = (id) => `blocks/${id[0]}/${id}.glsl`;

/** A stage's file name within its folder, `<id>.<stage>[.uniformity-off]` and `extension`. */
function stageName(entry, shared, extension) {
  const id = shared.corpusId(entry).slice(0, ID_DIGITS);
  return `${id[0]}/${id}.${entry.stage}${entry.flag ? '.uniformity-off' : ''}${extension}`;
}

/** The path, relative to the corpus, of `entry`'s stage file. */
export const stagePath = (entry, shared) => `stages/${stageName(entry, shared, '.txt')}`;

/** The path, relative to the expanded directory, of `entry` expanded. */
export const expandedPath = (entry, shared) => stageName(entry, shared, '.glsl');

/** A stage file's text: the format, then the ids of `blocks`, one a line. */
export const stageFileText = (blocks) => `${STAGE_FORMAT}\n${blocks.map(blockId).join('\n')}\n`;

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** How a stage is named in a message. */
const described = (stage, flag) => `${stage} stage${flag ? ' with the uniformity analysis off' : ''}`;

/** The folders of `dir/sub` and the files in each: `[folder, name, path]`,
 * and every other name, relative to `dir`, in `others`. */
function listFolders(dir, sub, others) {
  const found = [];
  const top = join(dir, sub);
  for (const folder of readdirSync(top).sort()) {
    const folderPath = join(top, folder);
    if (!FOLDER.test(folder) || !statSync(folderPath).isDirectory()) {
      others.push(`${sub}/${folder}`);
      continue;
    }
    for (const name of readdirSync(folderPath).sort()) found.push([folder, name, join(folderPath, name)]);
  }
  return found;
}

/** Why the block file at `path` is not the block its name says, or its text. */
function checkBlock(path, folder, id) {
  if (folder !== id[0]) return { problem: `the block ${id} belongs in the folder blocks/${id[0]}/, not blocks/${folder}/: the file was moved or renamed` };
  const bytes = readFileSync(path);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { problem: 'is not valid UTF-8' };
  }
  if (text.includes('\r')) return { problem: 'carries a carriage return (Windows line endings), which no block of the corpus has' };
  const actual = createHash('sha256').update(bytes).digest('hex').slice(0, ID_DIGITS);
  if (actual === id) return { text };
  if (text.startsWith('﻿') && blockId(text.slice(1)) === id) return { problem: 'starts with a byte-order mark its block does not have' };
  if (text.endsWith('\n') && blockId(text.slice(0, -1)) === id) return { problem: 'ends with a newline its block does not have (one added on save)' };
  return { problem: `its bytes are not the block its name says: they hash to ${actual}, not ${id}; the file was edited, reformatted or renamed` };
}

/** Why the stage file at `path` is not the stage its name says, or the stage. */
function checkStage(path, folder, name, blocks, refusedBlocks, shared) {
  const [, id, stage, off] = STAGE_FILE.exec(name);
  const flag = off !== undefined;
  if (folder !== id[0]) return { problem: `the stage ${id} belongs in the folder stages/${id[0]}/, not stages/${folder}/: the file was moved or renamed` };
  let text;
  try {
    text = decoder.decode(readFileSync(path));
  } catch {
    return { problem: 'is not valid UTF-8' };
  }
  if (text.includes('\r')) return { problem: 'carries a carriage return (Windows line endings), which no stage file of the corpus has' };
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== STAGE_FORMAT) return { problem: `is not a stage file: its first line is not ${STAGE_FORMAT}` };
  const ids = lines.slice(1);
  const bad = ids.findIndex((line) => !/^[0-9a-f]{16}$/.test(line));
  if (bad >= 0) return { problem: `is not a stage file: its line ${bad + 2} is not a block's id` };
  const missing = ids.filter((block) => !blocks.has(block));
  // A block refused on its own is named once, as a block, not again here.
  if (missing.length > 0 && missing.every((block) => refusedBlocks.has(block))) return { problem: null };
  if (missing.length > 0) {
    return { problem: `names ${missing.length === 1 ? 'a block' : 'blocks'} the corpus does not hold: ${missing.map(blockPath).join(', ')}` };
  }
  const glsl = ids.map((block) => blocks.get(block)).join('\n');
  const idOf = (s, f) => shared.corpusId({ stage: s, flag: f, glsl }).slice(0, ID_DIGITS);
  const actual = idOf(stage, flag);
  if (actual !== id) {
    for (const [s, f] of [['vertex', false], ['vertex', true], ['fragment', false], ['fragment', true]]) {
      if ((s !== stage || f !== flag) && idOf(s, f) === id) {
        return { problem: `holds the ${described(s, f)} ${id}, not the ${described(stage, flag)} its name says: the file was renamed` };
      }
    }
    return {
      problem:
        `its blocks, joined, are not the ${described(stage, flag)} its name says: they hash to ${actual}, not ${id}; ` +
        'the file was edited (a block named, dropped or moved) or renamed',
    };
  }
  const cut = cutBlocks(glsl).map(blockId);
  if (cut.length !== ids.length || cut.some((block, i) => block !== ids[i])) {
    return { problem: `its blocks make its stage, but are not the blocks its text is cut into (${cut.length} blocks): the file was edited` };
  }
  return { entry: { stage, flag, glsl }, ids };
}

/**
 * The stages of the corpus in `dir`, expanded from their blocks, in the order
 * of their files' paths: `stages`, `files` (each stage's file, relative to
 * `dir`), `blocks` (how many block files, and their bytes), `unused` (every
 * block file no stage names, relative to `dir`: the merge removes them) and
 * `others`, every name in `dir` that is not a corpus file (a `*.json` at the
 * top is a recording dropped in as it was downloaded), left alone for the
 * caller to report. A block whose bytes are not its name, a stage whose
 * blocks do not make the stage its name says or that names a block the
 * corpus does not hold, a carriage return, and a file that is not UTF-8 are
 * refused: it throws, naming every such file, before anything is written.
 */
export function readCorpusDir(dir, shared) {
  const others = [];
  const refused = [];
  const blocks = new Map();
  const blockFiles = new Map();
  const refusedBlocks = new Set();
  let blockBytes = 0;
  const held = new Set();
  for (const name of readdirSync(dir).sort()) {
    if ((name === 'blocks' || name === 'stages') && statSync(join(dir, name)).isDirectory()) held.add(name);
    else others.push(name);
  }
  if (held.has('blocks')) {
    for (const [folder, name, path] of listFolders(dir, 'blocks', others)) {
      const match = BLOCK_FILE.exec(name);
      if (match === null || !statSync(path).isFile()) {
        others.push(`blocks/${folder}/${name}`);
        continue;
      }
      const checked = checkBlock(path, folder, match[1]);
      if (checked.problem !== undefined) {
        refused.push(`${path}: ${checked.problem}`);
        refusedBlocks.add(match[1]);
      }
      else {
        blocks.set(match[1], checked.text);
        blockFiles.set(match[1], `blocks/${folder}/${name}`);
        blockBytes += Buffer.byteLength(checked.text);
      }
    }
  }
  const stages = [];
  const files = [];
  const named = new Set();
  if (held.has('stages')) {
    for (const [folder, name, path] of listFolders(dir, 'stages', others)) {
      if (!STAGE_FILE.test(name) || !statSync(path).isFile()) {
        others.push(`stages/${folder}/${name}`);
        continue;
      }
      const checked = checkStage(path, folder, name, blocks, refusedBlocks, shared);
      if (checked.problem === null) continue;
      if (checked.problem !== undefined) refused.push(`${path}: ${checked.problem}`);
      else {
        stages.push(checked.entry);
        files.push(`stages/${folder}/${name}`);
        for (const block of checked.ids) named.add(block);
      }
    }
  }
  if (refused.length > 0) throw new Error(`${refused.join('\n')}\n${RECORDED}`);
  const unused = [...blockFiles].filter(([id]) => !named.has(id)).map(([, file]) => file);
  return { stages, files, blocks: { files: blocks.size, bytes: blockBytes }, unused, others };
}

/**
 * Writes every stage of `stages` whole into `dir`, as its expanded file
 * (`expandedPath`), leaving a file whose bytes are already the stage's as
 * it is, and removes every other expanded file there; nothing else. The
 * directory is not committed: it is for a person to open a stage in full.
 * Returns how many files were written and removed.
 */
export function writeExpanded(dir, stages, shared) {
  const wanted = new Map(stages.map((entry) => [expandedPath(entry, shared), entry.glsl]));
  let written = 0;
  let removed = 0;
  mkdirSync(dir, { recursive: true });
  for (const folder of readdirSync(dir)) {
    const folderPath = join(dir, folder);
    if (!FOLDER.test(folder) || !statSync(folderPath).isDirectory()) continue;
    for (const name of readdirSync(folderPath)) {
      if (EXPANDED_FILE.test(name) && !wanted.has(`${folder}/${name}`)) {
        rmSync(join(folderPath, name));
        removed += 1;
      }
    }
  }
  for (const [file, glsl] of wanted) {
    const path = join(dir, file);
    const bytes = Buffer.from(glsl, 'utf8');
    let same = false;
    try {
      same = readFileSync(path).equals(bytes);
    } catch {
      same = false;
    }
    if (same) continue;
    mkdirSync(join(dir, file[0]), { recursive: true });
    writeFileSync(path, bytes);
    written += 1;
  }
  return { written, removed };
}

/** Removes the folder at `path` if nothing is left in it. */
export function removeIfEmpty(path) {
  if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
}

/**
 * Removes every corpus file in `dir`, unread, and each folder it empties;
 * nothing else. For a corpus written afresh (`node-corpus.mjs`).
 */
export function removeCorpusFiles(dir) {
  for (const [sub, pattern] of [['blocks', BLOCK_FILE], ['stages', STAGE_FILE]]) {
    const top = join(dir, sub);
    let folders;
    try {
      folders = readdirSync(top);
    } catch {
      continue;
    }
    for (const folder of folders) {
      const folderPath = join(top, folder);
      if (!FOLDER.test(folder) || !statSync(folderPath).isDirectory()) continue;
      for (const name of readdirSync(folderPath)) if (pattern.test(name)) rmSync(join(folderPath, name));
      removeIfEmpty(folderPath);
    }
    removeIfEmpty(top);
  }
}
