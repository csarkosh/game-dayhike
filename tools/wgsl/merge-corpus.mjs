#!/usr/bin/env node
// Merges recorded corpus files into the committed corpus
// (`client/shaders/corpus/`): the union, each stage once, reporting how many
// stages the recorded files hold and how many of them are new. A recorded
// file is what `dayhikeWgsl.download()` saves on a page opened with
// `?wgsl=record`; one dropped into the corpus directory as it was downloaded
// is merged too, and removed once its stages are in the corpus's own files.
//
// Usage: node tools/wgsl/merge-corpus.mjs [--corpus <dir>] [recorded.json ...]

import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CORPUS_DIR } from './lib/files.mjs';
import { mergeCorpus } from './lib/mergeCorpus.mjs';
import { loadShared } from './lib/shared.mjs';

const { values, positionals } = parseArgs({ options: { corpus: { type: 'string' } }, allowPositionals: true });
const dir = values.corpus === undefined ? CORPUS_DIR : resolve(values.corpus);
const merged = mergeCorpus({ dir, recorded: positionals.map((path) => resolve(path)), shared: await loadShared() });
const shown = relative(process.cwd(), dir) || dir;
console.log(`wgsl corpus: ${shown}`);
console.log(`  read:   ${merged.read} stages from ${positionals.length + merged.removed.length} recorded files`);
console.log(`  new:    ${merged.added}`);
console.log(`  holds:  ${merged.total} stages`);
for (const name of merged.removed) console.log(`  merged and removed ${name}`);
