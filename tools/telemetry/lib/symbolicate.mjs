// Reading a telemetry stack back to source: each frame's chunk, line and
// column looked up in the build's source map, which the client deploy stores
// by build sha (`tools/deploy/client.mjs`). Pure over `loadMap`, so the
// parsing and the rewriting are tested on a map written by hand.

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

/** A frame's location in a stack line: `.../assets/<file>.js:<line>:<col>`, with or without parentheses. */
const FRAME = /(https?:\/\/[^\s()]+?\/([^/\s()]+\.js)):(\d+):(\d+)/g;

/**
 * The public URL of a build's maps: the downloads bucket, under
 * `sourcemaps/<build>/`, as the deploy lays them out.
 */
export function mapUrl(downloadsUrl, build, file) {
  return `${downloadsUrl}/sourcemaps/${build}/assets/${file}.map`;
}

/**
 * `stack` with every frame that resolves rewritten as
 * `<original file>:<line>:<column> (<name>)` beside the minified location;
 * frames the maps do not know are left as they are. `loadMap(file)` resolves
 * to the map's JSON for a chunk file name, or null.
 */
export async function symbolicate(stack, loadMap) {
  const maps = new Map();
  const mapFor = async (file) => {
    if (!maps.has(file)) {
      const json = await loadMap(file);
      maps.set(file, json === null ? null : new TraceMap(json));
    }
    return maps.get(file);
  };
  const lines = stack.split('\n');
  const out = [];
  for (const line of lines) {
    let rewritten = line;
    for (const match of line.matchAll(FRAME)) {
      const [whole, , file, lineNo, col] = match;
      const map = await mapFor(file);
      if (map === null) continue;
      // Stack columns are 1-based; the map's are 0-based.
      const pos = originalPositionFor(map, { line: Number(lineNo), column: Number(col) - 1 });
      if (pos.source === null) continue;
      const name = pos.name ? ` (${pos.name})` : '';
      rewritten = rewritten.replace(whole, `${pos.source}:${pos.line}:${pos.column + 1}${name} ← ${file}:${lineNo}:${col}`);
    }
    out.push(rewritten);
  }
  return out.join('\n');
}
