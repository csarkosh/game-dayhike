// The chunks a built client's entry chunk loads with it, and the WGSL map
// checked against them: one walk, read from files by the build's check
// (`tools/wgsl/check-build.mjs`) and fetched by the deploy check
// (`verify.mjs`), so both search the same chunks.

import { mapProblems } from './wgslMap.mjs';

/** The most chunks the walk reads; a bundle whose entry loads more fails it. */
export const MAX_STATIC_CHUNKS = 500;

/** A chunk's static imports and re-exports of a sibling chunk (never `import(…)`). */
const STATIC_IMPORT = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g;

/**
 * The entry chunk (`entry`, a file name under `assets/`) and every chunk it
 * imports or re-exports statically, however deep, by name, in the order met,
 * each read with `read(name)` (its text, or null where it does not answer);
 * and what stopped the walk: a chunk that did not answer, or more than `max`.
 */
export async function staticChunks(entry, read, max = MAX_STATIC_CHUNKS) {
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
    const text = await read(name);
    if (text === null || text === undefined) {
      problems.push(`assets/${name}, which the entry chunk loads, could not be read`);
      continue;
    }
    chunks.set(name, text);
    for (const m of text.matchAll(STATIC_IMPORT)) if (!chunks.has(m[1])) queue.push(m[1]);
  }
  return { chunks, problems };
}

/**
 * What is wrong with the map (`mapText`) against the WebGPU chunk that names
 * it (`chunkSource`) and the chunks the entry loads with it (`staticChunks`):
 * the walk's own problems, then `mapProblems`'. With the chunks read, and the
 * names of those carrying the version of Babylon the map's salt was made
 * against, as a quoted literal.
 */
export async function bundleMapProblems({ entry, read, mapText, chunkSource, max = MAX_STATIC_CHUNKS }) {
  const walk = await staticChunks(entry, read, max);
  const problems = [...walk.problems, ...mapProblems(mapText, chunkSource, [...walk.chunks.values()].join('\n'))];
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
