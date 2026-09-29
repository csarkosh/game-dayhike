#!/usr/bin/env node
// Merges recordings into the committed corpus (`client/shaders/corpus/`, one
// shader file a stage: `tools/wgsl/lib/corpus.mjs`): each stage it does not
// hold becomes a file of its own, and no file already there changes. It
// reports how many stages the recordings hold and how many of them are new.
// A recording is what `dayhikeWgsl.download()` saves on a page opened with
// `?wgsl=record`, one JSON file; one dropped into the corpus directory as it
// was downloaded is merged too, and removed once its stages are files. Every
// `\r\n` in every recorded stage is turned to `\n`. It refuses, writing
// nothing and exiting 1, a stage with a carriage return left, a recording
// that is not one, and a corpus file whose bytes are not the stage its name
// says (edited, reformatted or renamed).
//
// Usage: node tools/wgsl/merge-corpus.mjs [--corpus <dir>] [recording.json ...]

import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { refusalText } from './lib/corpus.mjs';
import { CORPUS_DIR } from './lib/files.mjs';
import { mergeCorpus } from './lib/mergeCorpus.mjs';
import { loadShared } from './lib/shared.mjs';

const { values, positionals } = parseArgs({ options: { corpus: { type: 'string' } }, allowPositionals: true });
const dir = values.corpus === undefined ? CORPUS_DIR : resolve(values.corpus);
const shared = await loadShared();
let merged;
try {
  merged = mergeCorpus({ dir, recorded: positionals.map((path) => resolve(path)), shared });
} catch (error) {
  console.error(refusalText(error));
  process.exit(1);
}
const shown = relative(process.cwd(), dir) || dir;
console.log(`wgsl corpus: ${shown}`);
console.log(`  read:   ${merged.read} stages from ${positionals.length + merged.removed.length} recorded files`);
console.log(`  new:    ${merged.added}`);
console.log(`  holds:  ${merged.total} stages`);
console.log(`  normalised: ${merged.normalised} stages had Windows line endings`);
for (const name of merged.removed) console.log(`  merged and removed ${name}`);
for (const name of merged.leftAlone) console.log(`  left alone ${name}: not a corpus file`);
