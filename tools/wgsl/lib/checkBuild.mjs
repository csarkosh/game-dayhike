// Checking a built client for the WGSL map (`check-build.mjs`): what the
// deploy would ship, read from its files, before anything is deployed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findChunkName, findMapUrl } from '../../deploy/lib/modelUrls.mjs';
import { mapProblems } from '../../deploy/lib/wgslMap.mjs';

/** What only the WebGPU chunk may name. */
const WEBGPU_ONLY = ['wgsl-map', 'wgslFormat', 'dayhike-wgsl'];
/** A map the build emits. */
const MAP_NAME = /^wgsl-map-[A-Za-z0-9_-]{8}\.json$/;
/** A chunk's static imports and re-exports of a sibling chunk (never `import(…)`). */
const STATIC_IMPORT = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g;

/**
 * What is wrong with the built client in `dist`, or nothing: exactly one
 * `assets/wgsl-map-*.json`, parsing as a map of `mapFormat`; the entry chunk
 * and every chunk it imports statically naming none of `WEBGPU_ONLY`; the
 * WebGPU chunk naming the map; and the deploy check accepting the map
 * against the chunks.
 */
export function checkBuild(dist, { mapFormat }) {
  const problems = [];
  const assets = join(dist, 'assets');
  const read = (name) => readFileSync(join(assets, name), 'utf8');

  const maps = existsSync(assets) ? readdirSync(assets).filter((name) => MAP_NAME.test(name)) : [];
  if (maps.length !== 1) problems.push(`the build holds ${maps.length} WGSL maps (assets/wgsl-map-*.json), not 1`);
  const mapName = maps.length === 1 ? maps[0] : null;
  let mapText = null;
  if (mapName !== null) {
    mapText = read(mapName);
    let map = null;
    try {
      map = JSON.parse(mapText);
    } catch {
      problems.push(`assets/${mapName} does not parse as JSON`);
    }
    if (map !== null && (map?.format !== mapFormat || typeof map.entries !== 'object' || map.entries === null)) {
      problems.push(`assets/${mapName} is not a map of ${mapFormat}`);
    }
  }

  const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : '';
  const entrySrc = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  if (!entrySrc) {
    problems.push('index.html names no entry chunk');
    return problems;
  }
  const entry = basename(entrySrc);
  // The entry chunk and every chunk it loads with it.
  const loaded = [];
  const stack = [entry];
  while (stack.length > 0) {
    const name = stack.pop();
    if (loaded.includes(name) || !existsSync(join(assets, name))) continue;
    loaded.push(name);
    for (const m of read(name).matchAll(STATIC_IMPORT)) stack.push(m[1]);
  }
  for (const name of loaded) {
    const text = read(name);
    for (const word of WEBGPU_ONLY) {
      if (text.includes(word)) problems.push(`assets/${name}, loaded with the entry chunk, names ${word}`);
    }
  }

  const entrySource = read(entry);
  const gpu = findChunkName(entrySource, 'gpuEngine');
  if (gpu === null) {
    problems.push(`the entry chunk assets/${entry} names no WebGPU chunk`);
    return problems;
  }
  const chunk = read(gpu);
  if (mapName !== null) {
    const url = findMapUrl(chunk);
    if (url === null || !url.endsWith(`/assets/${mapName}`)) problems.push(`the WebGPU chunk assets/${gpu} does not name assets/${mapName}`);
    else {
      const refused = mapProblems(mapText, chunk, loaded.map(read).join('\n'));
      for (const problem of refused) problems.push(`the deploy check refuses the map: ${problem}`);
    }
  }
  return problems;
}
