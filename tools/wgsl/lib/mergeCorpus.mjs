// Merging recorded corpus files (`dayhikeWgsl.download()` on a page opened
// with `?wgsl=record`) into the committed corpus (`merge-corpus.mjs`).
//
// The corpus is kept as sixteen files at most, `stages-<h>.json`, a stage in
// the one named by the first hex digit of its `corpusId`: a stage always lands
// in the same file, each file stays a sixteenth of the whole (a large corpus
// would otherwise be one file near the size a Git host refuses), and a merge
// reads in a diff as the stages it adds to each.

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeWhole } from './files.mjs';

/** The name of a corpus file the merge writes. */
export const SHARD = /^stages-[0-9a-f]\.json$/;

/** Reads the stages of a corpus file, naming it when it is not one. */
function readFile(path, shared) {
  try {
    return shared.readCorpus(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Writes into `dir` the union of its corpus and of the `recorded` files, each
 * stage once, into its `stages-<h>.json`. A corpus file in `dir` that is not
 * one of those (a recorded file dropped in as it was downloaded) is read as
 * recorded and, once its stages are in the others, removed; a recorded file
 * named from elsewhere is only read. Returns how many stages were read from
 * the recorded files, how many of them were new, how many the corpus holds
 * now, and the files removed.
 */
export function mergeCorpus({ dir, recorded, shared }) {
  const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const shards = names.filter((name) => SHARD.test(name));
  const dropped = names.filter((name) => !SHARD.test(name));
  const union = new Map();
  for (const name of shards) {
    for (const entry of readFile(join(dir, name), shared)) union.set(shared.corpusId(entry), entry);
  }
  let read = 0;
  let added = 0;
  for (const path of [...recorded, ...dropped.map((name) => join(dir, name))]) {
    for (const entry of readFile(path, shared)) {
      read += 1;
      const id = shared.corpusId(entry);
      if (union.has(id)) continue;
      union.set(id, entry);
      added += 1;
    }
  }
  const byShard = new Map();
  for (const [id, entry] of union) {
    const name = `stages-${id[0]}.json`;
    if (!byShard.has(name)) byShard.set(name, []);
    byShard.get(name).push(entry);
  }
  for (const [name, entries] of byShard) writeWhole(join(dir, name), shared.corpusText(entries));
  for (const name of dropped) rmSync(join(dir, name));
  return { read, added, total: union.size, removed: dropped };
}
