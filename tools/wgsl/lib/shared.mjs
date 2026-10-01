// The page's own code for the key, the salt, the corpus and the map
// (`client/src/game/wgslFormat.ts`), loaded under Node. It is TypeScript, and
// Node here runs no TypeScript, so it is bundled with esbuild (its one import,
// the page's SHA-256, with it) into a temporary module and imported from
// there: the tools key a stage with the code the page keys it with, never a
// copy of it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const SOURCE = fileURLToPath(new URL('../../../client/src/game/wgslFormat.ts', import.meta.url));

/** `wgslFormat.ts`'s exports: `lookupSalt`, `stageKey`, `corpusId`, `corpusText`, `readCorpus`, `readRecording`, `mapText`, `readMap`, `TIERS`, `MAP_MAX_BYTES` and the formats. */
export async function loadShared() {
  const bundled = await build({
    entryPoints: [SOURCE],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const dir = mkdtempSync(join(tmpdir(), 'dayhike-wgsl-'));
  const file = join(dir, 'wgslFormat.mjs');
  try {
    writeFileSync(file, bundled.outputFiles[0].text);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
