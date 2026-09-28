// Where the tools read and write, and how they write.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The committed corpus: every `*.json` in it is read. */
export const CORPUS_DIR = fileURLToPath(new URL('../../../client/shaders/corpus/', import.meta.url));
/** Where the map is written for the page's build, which ships it. Not committed. */
export const MAP_FILE = fileURLToPath(new URL('../../../client/shaders/map/wgsl-map.json', import.meta.url));

/** Writes `text` to `file` whole or not at all: a reader never sees half of it. */
export function writeWhole(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}
