// Where the tools read and write, and how they write.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The committed corpus: one shader file a stage, `<h>/<id>.<stage>[.uniformity-off].glsl`, and its index of tiers (`corpus.mjs`). */
export const CORPUS_DIR = fileURLToPath(new URL('../../../client/shaders/corpus/', import.meta.url));
/** The ten stages made under Node (`tools/wgsl/node-corpus.mjs`), which no
 * browser asks for: a fixture the tools' and the client's tests translate,
 * never shipped. */
export const NODE_CORPUS_DIR = fileURLToPath(new URL('../test/fixtures/node-corpus/', import.meta.url));
/** Where the maps are written for the page's build, which ships them: one a
 * tier, `wgsl-map-<tier>.json` (`mapFile`), and the record of what they were
 * made from (`inputsFile`). Not committed. */
export const MAP_DIR = fileURLToPath(new URL('../../../client/shaders/map/', import.meta.url));

/** The name of `tier`'s map, in the map directory and on the dev server. */
export function mapName(tier) {
  return `wgsl-map-${tier}.json`;
}

/** The path of `tier`'s map under `dir`. */
export function mapFile(dir, tier) {
  return join(dir, mapName(tier));
}

/** The path of the record of what the maps under `dir` were made from. */
export function inputsFile(dir) {
  return join(dir, 'wgsl-map.inputs');
}

/** Writes `text` to `file` whole or not at all: a reader never sees half of it. */
export function writeWhole(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}
