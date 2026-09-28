// Translating the corpus into the map the page fetches (`build-map.mjs`):
// every stage of the corpus, keyed under this build's salt with the page's own
// code (`shared.mjs`), translated with the files the page ships
// (`translators.mjs`), written as the page reads it (`mapText`).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * The stages of every corpus file in `dir` (`*.json`, in name order), how
 * many each file holds, and the stages whose text carries a carriage return
 * (`withCarriageReturns`: the file, the stage, its name), which the build
 * refuses. A file that is not a corpus throws, naming it: the corpus is
 * committed, and a damaged one is an error to fix, not to skip.
 */
export function readCorpusDir(dir, shared) {
  const files = [];
  const stages = [];
  const withCarriageReturns = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    let read;
    try {
      read = shared.readCorpus(readFileSync(join(dir, name), 'utf8'));
    } catch (error) {
      throw new Error(`${join(dir, name)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    files.push({ name, stages: read.length });
    stages.push(...read);
    for (const entry of read) {
      if (entry.glsl.includes('\r')) withCarriageReturns.push({ file: name, stage: entry.stage, id: shared.corpusId(entry) });
    }
  }
  return { files, stages, withCarriageReturns };
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

/** The page's `MAP_MAX_BYTES` (`client/src/game/wgslFormat.ts`), 32 MiB of
 * text, for a caller without it; the build passes the page's own, and
 * `mapSize.test.mjs` holds the two equal. */
const MAP_CEILING = 33_554_432;

/**
 * Why a map of `bytes` may not ship, or null: over `ceiling` the page would
 * hold it whole for the engine's life, and parse it in one task.
 */
export function mapSizeProblem(bytes, ceiling = MAP_CEILING) {
  if (bytes <= ceiling) return null;
  return `the WGSL map is ${bytes} bytes, over its ceiling of ${ceiling} (MAP_MAX_BYTES): a page would hold it whole for the engine's life`;
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
 * What reading the map costs in each of the two forms it could take, in ms
 * on this machine: the map as one JSON, parsed whole (the form shipped); and
 * a small JSON index of each entry's place in one UTF-8 text, the index
 * parsed and every entry decoded from its bytes (the form a page would read
 * without parsing the WGSL as JSON). Each the least of `runs` readings.
 */
export function formatTimes(text, runs = 5) {
  const entries = JSON.parse(text).entries;
  const encoder = new TextEncoder();
  const index = [];
  const parts = [];
  let at = 0;
  for (const [key, wgsl] of Object.entries(entries)) {
    const bytes = encoder.encode(wgsl);
    index.push([key, at, bytes.length]);
    parts.push(bytes);
    at += bytes.length;
  }
  const indexText = JSON.stringify(index);
  const blob = new Uint8Array(at);
  let offset = 0;
  for (const part of parts) {
    blob.set(part, offset);
    offset += part.length;
  }
  const decoder = new TextDecoder();
  const least = (read) => {
    let best = Infinity;
    for (let run = 0; run < runs; run++) {
      const from = performance.now();
      read();
      best = Math.min(best, performance.now() - from);
    }
    return best;
  };
  return {
    jsonMs: least(() => JSON.parse(text)),
    indexMs: least(() => {
      for (const [, start, length] of JSON.parse(indexText)) decoder.decode(blob.subarray(start, start + length));
    }),
  };
}

/** A digest of everything the map is made of: the salt and the corpus's stages. */
export function inputsDigest(salt, stages, shared) {
  return createHash('sha256').update(salt).update('\0').update(shared.corpusText(stages)).digest('hex');
}
