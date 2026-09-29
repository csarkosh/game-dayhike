// Translating the corpus into the map the page fetches (`build-map.mjs`):
// every stage of the corpus, keyed under this build's salt with the page's own
// code (`shared.mjs`), translated with the files the page ships
// (`translators.mjs`), written as the page reads it (`mapText`: each distinct
// line once, each stage as runs of them), and read back with the page's own
// reader (`readMap`) before it is shipped.

import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { WebGPUTintWASM } from '@babylonjs/core/Engines/WebGPU/webgpuTintWASM.js';
import { CLIENT_DIR, translatorDigests } from './translators.mjs';

/**
 * This build's salt, as the page computes it (`buildSalt`, `shaderLookup.ts`):
 * the same function, over Babylon's version and its page-wide uniformity
 * switch read from the installed Babylon, and the digests of the translators
 * the client resolves.
 */
export function nodeSalt(shared, clientDir = CLIENT_DIR) {
  return shared.lookupSalt({
    babylon: AbstractEngine.Version,
    translators: translatorDigests(clientDir),
    staticUniformityOff: WebGPUTintWASM.DisableUniformityAnalysis,
  });
}

/**
 * The map of `stages` under `salt`: each stage once (by `corpusId`), in the
 * order of its name, keyed by `stageKey` and translated by `translate`. A
 * stage that does not translate is left out and reported in `failed`, never
 * thrown: the page translates what the map lacks, as it always has. The same
 * stages and translators give the same `text`, whatever their order.
 */
export function buildMap({ stages, salt, translate, shared, now = () => performance.now() }) {
  const byId = new Map();
  for (const entry of stages) byId.set(shared.corpusId(entry), entry);
  const entries = new Map();
  const translated = [];
  const failed = [];
  for (const id of [...byId.keys()].sort()) {
    const entry = byId.get(id);
    const key = shared.stageKey(salt, entry.stage, entry.flag, entry.glsl);
    const from = now();
    try {
      const wgsl = translate(entry);
      entries.set(key, wgsl);
      translated.push({ id, key, stage: entry.stage, ms: now() - from, glslBytes: entry.glsl.length, wgslBytes: wgsl.length });
    } catch (error) {
      // The translators run in contexts of their own, whose errors are not
      // this context's `Error`s.
      failed.push({ id, stage: entry.stage, message: typeof error?.message === 'string' ? error.message : String(error) });
    }
  }
  return { text: shared.mapText(salt, entries), entries, translated, failed };
}

/** The page's `MAP_MAX_BYTES` (`client/src/game/wgslFormat.ts`), 8 MiB of
 * text, for a caller without it; the build passes the page's own, and
 * `mapSize.test.mjs` holds the two equal. */
const MAP_CEILING = 8_388_608;

/**
 * Why a map of `bytes` may not ship, or null: over `ceiling` the page would
 * parse it in one task and hold its lines for the engine's life.
 */
export function mapSizeProblem(bytes, ceiling = MAP_CEILING) {
  if (bytes <= ceiling) return null;
  return (
    `the WGSL map is ${bytes} bytes, over its ceiling of ${ceiling} (MAP_MAX_BYTES): a page reads it in one task and holds its lines for the engine's life. ` +
    'A corpus that outgrows it is answered by a map per platform, not by a higher ceiling: see MAP_MAX_BYTES and its reasons in client/src/game/wgslFormat.ts'
  );
}

/**
 * Why the map's `text`, read back with the page's own reader (`readMap`) for
 * `salt`, does not serve exactly `entries` (key to WGSL), or nothing: a map
 * the page would refuse, with its reason; each entry that expands to other
 * text than its translation, byte for byte, or is missing; each entry that is
 * no translation.
 */
export function readBackProblems(text, salt, entries, shared) {
  let map;
  try {
    map = shared.readMap(text, salt);
  } catch (error) {
    return [`the map does not read back: ${error instanceof Error ? error.message : String(error)}`];
  }
  const problems = [];
  for (const [key, wgsl] of entries) {
    const back = map.get(key);
    if (back === null) problems.push(`the entry ${key} is not in the map read back`);
    else if (back !== wgsl) problems.push(`the entry ${key} reads back as other text than its translation`);
  }
  for (const key of map.keys()) if (!entries.has(key)) problems.push(`the map read back holds ${key}, which is no translation`);
  return problems;
}

/** The map's table of lines and its runs, counted from its `text`. */
export function tableFigures(text) {
  const map = JSON.parse(text);
  let runs = 0;
  for (const entry of Object.values(map.entries)) runs += entry.length / 2;
  return { lines: map.lines.length, runs };
}

/**
 * How much of the map's WGSL (`texts`, its entries) is repeated lines: every
 * text split at each newline, the lines in all, the distinct lines and their
 * bytes (each once, with its newline); and the same with every run of digits
 * in a line read as `#`, so that lines that differ only in a generated number
 * count as one.
 */
export function lineFigures(texts) {
  // Held once: an iterator handed in (the map's values) reads only once, and
  // there are two counts to make.
  const held = [...texts];
  const count = (mask) => {
    const seen = new Set();
    let lines = 0;
    let distinctBytes = 0;
    for (const text of held) {
      for (const raw of text.split('\n')) {
        lines += 1;
        const line = mask ? raw.replace(/\d+/g, '#') : raw;
        if (seen.has(line)) continue;
        seen.add(line);
        distinctBytes += Buffer.byteLength(line) + 1;
      }
    }
    return { lines, distinct: seen.size, distinctBytes };
  };
  return { ...count(false), masked: count(true) };
}

/**
 * Why the map's `text` is not ASCII, or null. The page's fallback, where a
 * response has no body to read as it comes, bounds the map by its length in
 * characters, a character a byte only while it is ASCII.
 */
export function asciiProblem(text) {
  let outside = 0;
  let first = -1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      outside += 1;
      if (first < 0) first = i;
    }
  }
  if (outside === 0) return null;
  return `the WGSL map is not ASCII: ${outside} character${outside === 1 ? '' : 's'} outside it, the first at character ${first}`;
}

/** `text`'s bytes raw, gzipped at level 9 and brotli'd at quality 11. */
export function sizes(text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
    }).length,
  };
}

/**
 * What reading the map costs the page, in ms on this machine, with the page's
 * own reader (`shared.readMap`) for `salt`: reading the text (its parse and
 * its checks), expanding every entry, and expanding the one of the most
 * text. Each the least of `runs` readings.
 */
export function readTimes(text, salt, shared, runs = 5) {
  const least = (read) => {
    let best = Infinity;
    for (let run = 0; run < runs; run++) {
      const from = performance.now();
      read();
      best = Math.min(best, performance.now() - from);
    }
    return best;
  };
  const map = shared.readMap(text, salt);
  let largest = null;
  let largestLength = -1;
  for (const key of map.keys()) {
    const length = map.get(key).length;
    if (length > largestLength) [largest, largestLength] = [key, length];
  }
  return {
    readMs: least(() => shared.readMap(text, salt)),
    expandAllMs: least(() => {
      for (const key of map.keys()) map.get(key);
    }),
    expandLargestMs: largest === null ? 0 : least(() => map.get(largest)),
  };
}

/** A digest of everything the map is made of: its format, the salt and the
 * corpus's stages. A map of another format is made again, never reused. */
export function inputsDigest(salt, stages, shared) {
  return createHash('sha256').update(shared.MAP_FORMAT).update('\0').update(salt).update('\0').update(shared.corpusText(stages)).digest('hex');
}
