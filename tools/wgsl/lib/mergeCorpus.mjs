// Merging recordings (`dayhikeWgsl.download()` on a page opened with
// `?wgsl=record`, one JSON file of `wgslFormat.ts`'s `CORPUS_FORMAT`) into the
// committed corpus (`merge-corpus.mjs`), which is one shader file a stage
// (`corpus.mjs`): a new stage is a new file, and no file already there is
// rewritten.

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCorpusDir, stageFile } from './corpus.mjs';
import { writeWhole } from './files.mjs';

/** Reads the stages of a recording, naming it when it is not one. */
function readRecording(path, shared) {
  try {
    return shared.readCorpus(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * `entry` with every `\r\n` in its text turned to `\n`, and whether it
 * changed; throws, naming it and `path`, on a carriage return left that ends
 * no line, or on a text that is not Unicode (a lone surrogate, which has no
 * UTF-8 bytes). A stage's key is the hash of its exact text: one recorded
 * from a checkout with Windows line endings (the game's shader files read as
 * `\r\n`) is never asked for by a page built from one without.
 */
function withUnixLineEndings(entry, path, shared) {
  const name = () => `${path}: the ${entry.stage} stage ${shared.corpusId(entry).slice(0, 16)}`;
  if (!entry.glsl.isWellFormed()) throw new Error(`${name()} is not valid UTF-8 text (it holds a lone surrogate); nothing was written`);
  const glsl = entry.glsl.replaceAll('\r\n', '\n');
  if (glsl.includes('\r')) throw new Error(`${name()} carries a carriage return that ends no line; nothing was written`);
  return { entry: { ...entry, glsl }, changed: glsl !== entry.glsl };
}

/**
 * Adds to the corpus in `dir` the stages of the `recorded` files that it does
 * not hold, each as a file of its own (`stageFile`), every `\r\n` in them
 * turned to `\n` first. A `*.json` at the top of `dir` is a recording dropped
 * in as it was downloaded: it is merged too and, once its stages are files,
 * removed; a recording named from elsewhere is only read. Every other name in
 * `dir` that is not a corpus file is left alone and returned in `leftAlone`.
 * Everything is read and checked before anything is written: a corpus file
 * that is not the stage its name says, a recording that is not one, or a
 * stage with a carriage return left refuses the whole merge. Returns how many
 * stages were read from the recordings, how many of them were new, how many
 * the corpus holds now, the recordings removed, how many stages had Windows
 * line endings, and the names left alone.
 */
export function mergeCorpus({ dir, recorded, shared }) {
  let corpus;
  try {
    corpus = readCorpusDir(dir, shared);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nNothing was written.`);
  }
  const dropped = corpus.others.filter((name) => !name.includes('/') && name.endsWith('.json'));
  const leftAlone = corpus.others.filter((name) => !dropped.includes(name));
  const union = new Map();
  const taken = new Map();
  for (const [i, entry] of corpus.stages.entries()) {
    union.set(shared.corpusId(entry), entry);
    taken.set(corpus.files[i], shared.corpusId(entry));
  }
  let read = 0;
  let normalised = 0;
  const added = [];
  for (const path of [...recorded, ...dropped.map((name) => join(dir, name))]) {
    for (const raw of readRecording(path, shared)) {
      read += 1;
      const repaired = withUnixLineEndings(raw, path, shared);
      if (repaired.changed) normalised += 1;
      const { entry } = repaired;
      const id = shared.corpusId(entry);
      if (union.has(id)) continue;
      const file = stageFile(entry, shared);
      // Two stages whose ids share their first 16 digits would share a file.
      if (taken.has(file)) throw new Error(`${path}: two stages would be ${join(dir, file)}, ${taken.get(file)} and ${id}; nothing was written`);
      union.set(id, entry);
      taken.set(file, id);
      added.push({ file, entry });
    }
  }
  for (const { file, entry } of added) writeWhole(join(dir, file), entry.glsl);
  for (const name of dropped) rmSync(join(dir, name));
  return { read, added: added.length, total: union.size, removed: dropped, normalised, leftAlone };
}
