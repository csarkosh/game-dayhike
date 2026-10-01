// The chunks a built client's entry chunk loads with it, and the WGSL map
// checked against them: one walk, read from files by the build's check
// (`tools/wgsl/check-build.mjs`) and fetched by the deploy check
// (`verify.mjs`), so both search the same chunks.

import { posix } from 'node:path';
import { mapProblems } from './wgslMap.mjs';

/** The most chunks the walk reads; a bundle whose entry loads more fails it. */
export const MAX_STATIC_CHUNKS = 500;

/** A chunk's static imports and re-exports of another chunk by a relative
 * path (never `import(…)`). */
const STATIC_IMPORT = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["'`](\.{1,2}\/[^"'`]+\.js)["'`]/g;

/**
 * The entry chunk (`entry`, a path under `assets/`) and every chunk it
 * imports or re-exports statically, however deep, by path under `assets/`,
 * each resolved against the chunk that names it, in the order met. Each is
 * read with `read(path)` (its text, or null where it does not answer), but
 * the entry, whose text its caller already has (`entryText`), is not read
 * again. What stopped the walk: a chunk that did not answer or whose read
 * threw, or more than `max`.
 */
export async function staticChunks(entry, read, max = MAX_STATIC_CHUNKS, entryText = null) {
  const chunks = new Map();
  const problems = [];
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.shift();
    if (chunks.has(name)) continue;
    if (chunks.size >= max) {
      problems.push(`the entry chunk loads more than ${max} chunks statically; the walk stopped there (MAX_STATIC_CHUNKS)`);
      break;
    }
    let text;
    try {
      text = name === entry && entryText !== null ? entryText : await read(name);
    } catch (error) {
      problems.push(`assets/${name}, which the entry chunk loads, could not be read: ${error?.message ?? String(error)}`);
      continue;
    }
    if (text === null || text === undefined) {
      problems.push(`assets/${name}, which the entry chunk loads, could not be read`);
      continue;
    }
    chunks.set(name, text);
    for (const m of text.matchAll(STATIC_IMPORT)) {
      const named = posix.normalize(posix.join(posix.dirname(name), m[1]));
      if (!chunks.has(named)) queue.push(named);
    }
  }
  return { chunks, problems };
}

/**
 * What is wrong with the map (`mapText`) against the WebGPU chunk that names
 * it (`chunkSource`) and the chunks the entry loads with it (`staticChunks`):
 * the walk's own problems, then `mapProblems`' (`mayBeEmpty` passed on: a
 * tier's map may hold nothing while another tier's holds translations). With
 * the chunks read, and the names of those carrying the version of Babylon
 * the map's salt was made against, as a quoted literal.
 */
export async function bundleMapProblems({ entry, entryText = null, read, mapText, chunkSource, max = MAX_STATIC_CHUNKS, mayBeEmpty = false }) {
  const walk = await staticChunks(entry, read, max, entryText);
  const problems = [...walk.problems, ...mapProblems(mapText, chunkSource, [...walk.chunks.values()].join('\n'), { mayBeEmpty })];
  let babylon;
  try {
    babylon = JSON.parse(mapText)?.salt?.match(/\|babylon=([^|]*)\|/)?.[1];
  } catch {
    babylon = undefined;
  }
  const literal = babylon === undefined ? null : new RegExp(`["'\`]${babylon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`);
  const carriers = literal === null ? [] : [...walk.chunks].filter(([, text]) => literal.test(text)).map(([name]) => name);
  return { problems, chunks: walk.chunks, carriers, babylon };
}
