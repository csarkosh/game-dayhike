// Checking a built client for the WGSL map (`check-build.mjs`): what the
// deploy would ship, read from its files, before anything is deployed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleMapProblems, staticChunks } from '../../deploy/lib/bundle.mjs';
import { findChunkName, findMapUrl } from '../../deploy/lib/modelUrls.mjs';

/** What only the WebGPU chunk may name. */
const WEBGPU_ONLY = ['wgsl-map', 'wgslFormat', 'dayhike-wgsl'];
/** A map the build emits. */
const MAP_NAME = /^wgsl-map-[A-Za-z0-9_-]{8}\.json$/;

/**
 * What is wrong with the built client in `dist`, or nothing: exactly one
 * `assets/wgsl-map-*.json`, parsing as a map of `mapFormat`; the entry chunk
 * and every chunk it imports statically naming none of `WEBGPU_ONLY`; the
 * WebGPU chunk naming the map; and the deploy check accepting the map
 * against the same chunks the deploy check reads (`bundleMapProblems`).
 * `note` hears which chunk carries Babylon's version.
 */
export async function checkBuild(dist, { mapFormat, note = () => undefined }) {
  const problems = [];
  const assets = join(dist, 'assets');
  const readFile = (name) => (existsSync(join(assets, name)) ? readFileSync(join(assets, name), 'utf8') : null);

  const maps = existsSync(assets) ? readdirSync(assets).filter((name) => MAP_NAME.test(name)) : [];
  if (maps.length !== 1) problems.push(`the build holds ${maps.length} WGSL maps (assets/wgsl-map-*.json), not 1`);
  const mapName = maps.length === 1 ? maps[0] : null;
  const mapText = mapName === null ? null : readFile(mapName);
  if (mapText !== null) {
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
  const entry = entrySrc.slice(entrySrc.lastIndexOf('/assets/') + '/assets/'.length);
  const entryText = readFile(entry);
  const walk = await staticChunks(entry, readFile, undefined, entryText);
  for (const [name, text] of walk.chunks) {
    for (const word of WEBGPU_ONLY) {
      if (text.includes(word)) problems.push(`assets/${name}, loaded with the entry chunk, names ${word}`);
    }
  }

  const gpu = findChunkName(entryText ?? '', 'gpuEngine');
  if (gpu === null) {
    problems.push(`the entry chunk assets/${entry} names no WebGPU chunk`);
    return problems;
  }
  const chunk = readFile(gpu) ?? '';
  if (mapName !== null) {
    const url = findMapUrl(chunk);
    if (url === null || !url.endsWith(`/assets/${mapName}`)) problems.push(`the WebGPU chunk assets/${gpu} does not name assets/${mapName}`);
    else {
      const checked = await bundleMapProblems({ entry, entryText, read: readFile, mapText, chunkSource: chunk });
      for (const problem of checked.problems) problems.push(`the deploy check refuses the map: ${problem}`);
      for (const name of checked.carriers) {
        note(`Babylon's version ${checked.babylon} is in assets/${name}, ${name === entry ? 'the entry chunk' : 'which the entry chunk imports statically'}`);
      }
    }
  }
  return problems;
}
