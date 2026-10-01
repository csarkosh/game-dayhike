// Checking a built client for the WGSL maps (`check-build.mjs`): what the
// deploy would ship, read from its files, before anything is deployed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleMapProblems, staticChunks } from '../../deploy/lib/bundle.mjs';
import { findChunkName, findMapUrl } from '../../deploy/lib/modelUrls.mjs';

/** What only the WebGPU chunk may name. */
const WEBGPU_ONLY = ['wgsl-map', 'wgslFormat', 'dayhike-wgsl'];
/** The tiers a map is built for, as the page's `TIERS` lists them. */
export const MAP_TIERS = ['low', 'medium', 'high'];
/** The map the build emits for a tier. */
const mapPattern = (tier) => new RegExp(`^wgsl-map-${tier}-[A-Za-z0-9_-]{8}\\.json$`);

/**
 * What is wrong with the built client in `dist`, or nothing: for each tier
 * exactly one `assets/wgsl-map-<tier>-*.json`, parsing as a map of
 * `mapFormat` (its table of lines and its entries; the deploy check reads the
 * runs); the entry chunk and every chunk it imports statically naming none of
 * `WEBGPU_ONLY`; the WebGPU chunk naming every map; and the deploy check
 * accepting each map against the same chunks the deploy check reads
 * (`bundleMapProblems`), a tier's map allowed to be empty while another
 * tier's holds translations (a tier not yet recorded has none). `note` hears
 * which chunk carries Babylon's version.
 */
export async function checkBuild(dist, { mapFormat, note = () => undefined }) {
  const problems = [];
  const assets = join(dist, 'assets');
  const readFile = (name) => (existsSync(join(assets, name)) ? readFileSync(join(assets, name), 'utf8') : null);

  const names = existsSync(assets) ? readdirSync(assets) : [];
  const maps = [];
  for (const tier of MAP_TIERS) {
    const found = names.filter((name) => mapPattern(tier).test(name));
    if (found.length !== 1) {
      problems.push(`the build holds ${found.length} WGSL maps for the ${tier} tier (assets/wgsl-map-${tier}-*.json), not 1`);
      continue;
    }
    const name = found[0];
    const text = readFile(name);
    let map = null;
    try {
      map = JSON.parse(text);
    } catch {
      problems.push(`assets/${name} does not parse as JSON`);
    }
    if (map !== null && (map?.format !== mapFormat || !Array.isArray(map.lines) || typeof map.entries !== 'object' || map.entries === null)) {
      problems.push(`assets/${name} is not a map of ${mapFormat}`);
    }
    maps.push({ tier, name, text, entries: map === null || typeof map.entries !== 'object' || map.entries === null ? 0 : Object.keys(map.entries).length });
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
  const carriers = new Map();
  for (const { tier, name, text } of maps) {
    const url = findMapUrl(chunk, tier);
    if (url === null || !url.endsWith(`/assets/${name}`)) {
      problems.push(`the WebGPU chunk assets/${gpu} does not name assets/${name}`);
      continue;
    }
    const mayBeEmpty = maps.some((other) => other.tier !== tier && other.entries > 0);
    const checked = await bundleMapProblems({ entry, entryText, read: readFile, mapText: text, chunkSource: chunk, mayBeEmpty });
    for (const problem of checked.problems) problems.push(`the deploy check refuses the ${tier} tier's map: ${problem}`);
    for (const carrier of checked.carriers) carriers.set(carrier, checked.babylon);
  }
  for (const [name, babylon] of carriers) {
    note(`Babylon's version ${babylon} is in assets/${name}, ${name === entry ? 'the entry chunk' : 'which the entry chunk imports statically'}`);
  }
  return problems;
}
