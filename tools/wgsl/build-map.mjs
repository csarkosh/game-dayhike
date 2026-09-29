#!/usr/bin/env node
// Translates the corpus of GLSL stages (`client/shaders/corpus/`, one shader
// file a stage: `tools/wgsl/lib/corpus.mjs`) into
// the map of WGSL the page fetches on its WebGPU path, so that a player's
// first visit finds its shaders instead of translating them on the page's
// thread. Run by `npm run build` before Vite, which ships the map as a
// content-hashed asset of the WebGPU chunk, and by the dev server.
//
// Every stage is keyed with the page's own code under this build's salt and
// translated with the very translator files the page ships, as the page
// translates it. The same corpus and translators give the same bytes. A stage
// that does not translate is left out of the map and reported: the build goes
// on, and the page translates that stage itself, as it always has. A map over
// 32 MiB (`MAP_MAX_BYTES`) fails the build, and so does a corpus file whose
// bytes are not the stage its name says (edited, reformatted or renamed).
//
// Usage: node tools/wgsl/build-map.mjs [--corpus <dir>] [--out <file>] [--reuse]
//   --reuse  leaves a map made from the same corpus under the same salt as it
//            is (the dev server's start).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { asciiProblem, buildMap, formatTimes, inputsDigest, lineFigures, mapSizeProblem, nodeSalt, sizes } from './lib/buildMap.mjs';
import { readCorpusDir, refusalText } from './lib/corpus.mjs';
import { CORPUS_DIR, MAP_FILE, writeWhole } from './lib/files.mjs';
import { loadShared } from './lib/shared.mjs';
import { startTranslators, translateStage } from './lib/translators.mjs';

const { values } = parseArgs({
  options: { corpus: { type: 'string' }, out: { type: 'string' }, reuse: { type: 'boolean', default: false } },
});
const corpusDir = values.corpus === undefined ? CORPUS_DIR : resolve(values.corpus);
const out = values.out === undefined ? MAP_FILE : resolve(values.out);
const inputsFile = `${out}.inputs`;
const shown = (path) => relative(process.cwd(), path) || path;

const shared = await loadShared();
const salt = nodeSalt(shared);
let corpus;
try {
  corpus = readCorpusDir(corpusDir, shared);
} catch (error) {
  console.error(`${refusalText(error)}\nNo map was written.`);
  process.exit(1);
}
const { stages } = corpus;
for (const name of corpus.others) {
  const hint = !name.includes('/') && name.endsWith('.json') ? ' (a recording? node tools/wgsl/merge-corpus.mjs adds its stages)' : '';
  console.error(`! ${join(corpusDir, name)}: not a corpus file, left alone${hint}`);
}
const inputs = inputsDigest(salt, stages, shared);
if (values.reuse && existsSync(out) && existsSync(inputsFile) && readFileSync(inputsFile, 'utf8') === inputs) {
  console.log(`wgsl map: ${shown(out)} is up to date with ${shown(corpusDir)}`);
  process.exit(0);
}

const started = performance.now();
const translators = await startTranslators();
const startMs = performance.now() - started;
const made = buildMap({ stages, salt, translate: (entry) => translateStage(translators, entry), shared });
for (const stage of made.translated) {
  console.log(`  ${stage.ms.toFixed(0).padStart(6)} ms  ${stage.stage.padEnd(8)}  ${stage.id.slice(0, 16)}  ${stage.glslBytes} B GLSL -> ${stage.wgslBytes} B WGSL`);
}
for (const stage of made.failed) {
  console.error(`  FAILED     ${stage.stage.padEnd(8)}  ${stage.id.slice(0, 16)}  ${stage.message}`);
}
const size = sizes(made.text);
const ms = made.translated.map((stage) => stage.ms);
const total = ms.reduce((a, b) => a + b, 0);
const times = formatTimes(made.text);
const lines = lineFigures(made.entries.values());
const notAscii = asciiProblem(made.text);
const largest = made.translated.reduce((a, b) => (b.wgslBytes > (a?.wgslBytes ?? -1) ? b : a), null);
// The figures first, so a map over its ceiling still says what it is.
console.log(`wgsl map: ${shown(out)}`);
console.log(`  corpus:       ${stages.length} stages under ${shown(corpusDir)}, ${made.translated.length + made.failed.length} distinct`);
console.log(`  entries:      ${made.entries.size}`);
console.log(`  failed:       ${made.failed.length}${made.failed.length > 0 ? ` (${made.failed.map((stage) => stage.id).join(', ')})` : ''}`);
console.log(`  bytes:        ${size.raw} raw, ${size.gzip} gzip -9, ${size.brotli} brotli -q 11`);
console.log(`  ascii:        ${notAscii === null ? 'yes' : 'no'}`);
console.log(
  `  lines:        ${lines.lines} in all, ${lines.distinct} distinct in ${lines.distinctBytes} B; ` +
    `digits as #: ${lines.masked.lines} in all, ${lines.masked.distinct} distinct in ${lines.masked.distinctBytes} B`,
);
console.log(`  largest:      ${largest === null ? 'none' : `${largest.wgslBytes} B of WGSL, the ${largest.stage} stage ${largest.id.slice(0, 16)}`}`);
console.log(
  `  translation:  translators started in ${startMs.toFixed(0)} ms; ${total.toFixed(0)} ms in all, ` +
    `${(made.translated.length ? total / made.translated.length : 0).toFixed(0)} ms a stage on average, ${Math.max(0, ...ms).toFixed(0)} ms the longest`,
);
console.log(`  reading it:   ${times.jsonMs.toFixed(2)} ms as one JSON (shipped), ${times.indexMs.toFixed(2)} ms as an index and a text`);
if (notAscii !== null) {
  console.error(`\n!! ${notAscii}. Nothing was written.\n`);
  process.exit(1);
}
const tooLarge = mapSizeProblem(Buffer.byteLength(made.text), shared.MAP_MAX_BYTES);
if (tooLarge !== null) {
  console.error(`\n!! ${tooLarge}. Nothing was written.\n`);
  process.exit(1);
}
writeWhole(out, made.text);
writeFileSync(inputsFile, inputs);
if (made.failed.length > 0) {
  console.error(
    `\n!! wgsl map: ${made.failed.length} of ${made.translated.length + made.failed.length} stages did not translate and are NOT in the map ` +
      `(the page translates them itself). Fix or drop them in ${shown(corpusDir)}.\n`,
  );
}
