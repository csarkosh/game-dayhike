#!/usr/bin/env node
// Translates the corpus of GLSL stages (`client/shaders/corpus/`, one shader
// file a stage and an index of the tiers each was recorded on:
// `tools/wgsl/lib/corpus.mjs`) into the maps of WGSL the page fetches on its
// WebGPU path, one a quality tier, so that a player's first visit finds its
// shaders instead of translating them on the page's thread. Run by `npm run
// build` before Vite, which ships each map as a content-hashed asset of the
// WebGPU chunk, and by the dev server.
//
// Every stage is keyed with the page's own code under this build's salt and
// translated once with the very translator files the page ships, as the page
// translates it. Each tier's map holds the stages the index puts on that
// tier, every distinct line of WGSL once and each stage as runs of those
// lines (`mapText`): the union of the tiers' stages outgrew one map's
// ceiling, and a page knows its tier before its engine is made. The same
// corpus and translators give the same bytes. A stage that does not translate
// is left out of every map and reported: the build goes on, and the page
// translates that stage itself, as it always has. A map over 10 MiB
// (`MAP_MAX_BYTES`) fails the build, and so does a corpus file whose bytes
// are not the stage its name says (edited, reformatted or renamed), or an
// index that does not match the files. Once written, each map is read back
// from its file with the page's own reader and every entry expanded and
// compared with its translation, byte for byte: any difference fails the
// build, naming the entry, and every map is removed.
//
// Usage: node tools/wgsl/build-map.mjs [--corpus <dir>] [--out <dir>] [--reuse]
//   --out    the directory the maps are written to, `wgsl-map-<tier>.json`
//            each, with `wgsl-map.inputs`, the record of what they were made
//            from (`client/shaders/map/` by default)
//   --reuse  leaves maps made from the same corpus under the same salt as
//            they are (the dev server's start).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  asciiProblem,
  buildMap,
  entriesOn,
  inputsDigest,
  lineFigures,
  mapSizeProblem,
  nodeSalt,
  readBackProblems,
  readTimes,
  sizes,
  tableFigures,
} from './lib/buildMap.mjs';
import { readCorpusDir, refusalText, tiersText } from './lib/corpus.mjs';
import { CORPUS_DIR, MAP_DIR, inputsFile, mapFile, writeWhole } from './lib/files.mjs';
import { loadShared } from './lib/shared.mjs';
import { startTranslators, translateStage } from './lib/translators.mjs';

const { values } = parseArgs({
  options: { corpus: { type: 'string' }, out: { type: 'string' }, reuse: { type: 'boolean', default: false } },
});
const corpusDir = values.corpus === undefined ? CORPUS_DIR : resolve(values.corpus);
const outDir = values.out === undefined ? MAP_DIR : resolve(values.out);
const inputs = inputsFile(outDir);
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
const { stages, tiers } = corpus;
for (const name of corpus.others) {
  const hint = !name.includes('/') && name.endsWith('.json') ? ' (a recording? node tools/wgsl/merge-corpus.mjs adds its stages)' : '';
  console.error(`! ${join(corpusDir, name)}: not a corpus file, left alone${hint}`);
}
const outputs = shared.TIERS.map((tier) => ({ tier, file: mapFile(outDir, tier) }));
const digest = inputsDigest(salt, stages, shared, tiersText(tiers, shared));
if (values.reuse && outputs.every(({ file }) => existsSync(file)) && existsSync(inputs) && readFileSync(inputs, 'utf8') === digest) {
  console.log(`wgsl maps: ${shown(outDir)} is up to date with ${shown(corpusDir)}`);
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
const ms = made.translated.map((stage) => stage.ms);
const total = ms.reduce((a, b) => a + b, 0);
const onTier = (tier) => [...tiers.values()].filter((on) => on.includes(tier)).length;
console.log(`wgsl maps: ${shown(outDir)}, one a tier`);
console.log(
  `  corpus:       ${stages.length} stages under ${shown(corpusDir)}, ${made.translated.length + made.failed.length} distinct; ` +
    shared.TIERS.map((tier) => `on ${tier} ${onTier(tier)}`).join(', '),
);
console.log(`  failed:       ${made.failed.length}${made.failed.length > 0 ? ` (${made.failed.map((stage) => stage.id).join(', ')})` : ''}`);
console.log(
  `  translation:  translators started in ${startMs.toFixed(0)} ms; ${total.toFixed(0)} ms in all, ` +
    `${(made.translated.length ? total / made.translated.length : 0).toFixed(0)} ms a stage on average, ${Math.max(0, ...ms).toFixed(0)} ms the longest`,
);

// Each tier's map, its figures first, so a map over its ceiling still says
// what it is; nothing is written until every map may be.
const refusals = [];
for (const output of outputs) {
  output.entries = entriesOn(made, tiers, output.tier);
  output.text = shared.mapText(salt, output.entries, output.tier);
  const size = sizes(output.text);
  // A map the page's reader refuses is timed as nothing here, and fails the
  // build when it is read back (below).
  let times;
  try {
    times = readTimes(output.text, salt, shared);
  } catch (error) {
    times = { refused: error instanceof Error ? error.message : String(error) };
  }
  const lines = lineFigures(output.entries.values());
  const table = tableFigures(output.text);
  const notAscii = asciiProblem(output.text);
  const largest = made.translated.filter((stage) => output.entries.has(stage.key)).reduce((a, b) => (b.wgslBytes > (a?.wgslBytes ?? -1) ? b : a), null);
  console.log(`wgsl map: ${shown(output.file)} (the ${output.tier} tier)`);
  console.log(`  entries:      ${output.entries.size}`);
  console.log(`  bytes:        ${size.raw} raw, ${size.gzip} gzip -9, ${size.brotli} brotli -q 11`);
  console.log(`  ascii:        ${notAscii === null ? 'yes' : 'no'}`);
  console.log(
    `  lines:        ${lines.lines} in all, ${lines.distinct} distinct in ${lines.distinctBytes} B; ` +
      `digits as #: ${lines.masked.lines} in all, ${lines.masked.distinct} distinct in ${lines.masked.distinctBytes} B`,
  );
  console.log(`  runs:         ${table.runs}, over a table of ${table.lines} lines`);
  console.log(`  largest:      ${largest === null ? 'none' : `${largest.wgslBytes} B of WGSL, the ${largest.stage} stage ${largest.id.slice(0, 16)}`}`);
  console.log(
    times.refused === undefined
      ? `  reading it:   ${times.readMs.toFixed(2)} ms to read with the page's reader, ` +
          `${times.expandAllMs.toFixed(2)} ms to expand every entry, ${times.expandLargestMs.toFixed(2)} ms the largest`
      : `  reading it:   the page's reader refuses it (${times.refused})`,
  );
  if (notAscii !== null) refusals.push(notAscii.replace('the WGSL map', `the WGSL map of the ${output.tier} tier`));
  const tooLarge = mapSizeProblem(Buffer.byteLength(output.text), shared.MAP_MAX_BYTES, `the WGSL map of the ${output.tier} tier`);
  if (tooLarge !== null) refusals.push(tooLarge);
}
if (refusals.length > 0) {
  for (const refusal of refusals) console.error(`\n!! ${refusal}.`);
  console.error('\nNothing was written.\n');
  process.exit(1);
}
for (const output of outputs) writeWhole(output.file, output.text);
// Each file as the page will read it: every entry expanded and compared with
// the translation it was made of. A map that does not serve exactly them is
// removed with the others, and the record of what they were made from, so
// that nothing ships it and `--reuse` never keeps it.
const readBack = outputs.flatMap((output) =>
  readBackProblems(readFileSync(output.file, 'utf8'), salt, output.entries, shared, output.tier).map((problem) => `${shown(output.file)}: ${problem}`),
);
if (readBack.length > 0) {
  for (const output of outputs) rmSync(output.file, { force: true });
  rmSync(inputs, { force: true });
  for (const problem of readBack) console.error(`✗ ${problem}`);
  console.error(`\n!! a WGSL map read back from ${shown(outDir)} does not serve its translations. Every map was removed.\n`);
  process.exit(1);
}
for (const output of outputs) console.log(`  read back:    ${shown(output.file)}: ${output.entries.size} entries, each byte for byte its translation`);
writeFileSync(inputs, digest);
if (made.failed.length > 0) {
  console.error(
    `\n!! wgsl maps: ${made.failed.length} of ${made.translated.length + made.failed.length} stages did not translate and are NOT in any map ` +
      `(the page translates them itself). Fix or drop them in ${shown(corpusDir)}.\n`,
  );
}
