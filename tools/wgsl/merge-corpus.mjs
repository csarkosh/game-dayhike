#!/usr/bin/env node
// Merges recorded corpus files into the committed corpus
// (`client/shaders/corpus/`): the union, each stage once, reporting how many
// stages the recorded files hold and how many of them are new. A recorded
// file is what `dayhikeWgsl.download()` saves on a page opened with
// `?wgsl=record`; one dropped into the corpus directory as it was downloaded
// is merged too, and removed once its stages are in the corpus's own files.
// Every `\r\n` in every stage is turned to `\n`, and a stage with a carriage
// return left is refused: nothing is written, and it exits 1.
//
// Usage: node tools/wgsl/merge-corpus.mjs [--corpus <dir>] [recorded.json ...]

import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
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
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const shown = relative(process.cwd(), dir) || dir;
console.log(`wgsl corpus: ${shown}`);
console.log(`  read:   ${merged.read} stages from ${positionals.length + merged.removed.length} recorded files`);
console.log(`  new:    ${merged.added}`);
console.log(`  holds:  ${merged.total} stages`);
console.log(`  normalised: ${merged.normalised} stages had Windows line endings`);
for (const name of merged.removed) console.log(`  merged and removed ${name}`);
