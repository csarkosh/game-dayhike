import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Every kind of file the game's asset globs import with `?url`
// (`client/src/game/assetUrls.ts`) is a shipped binary and goes through
// Git LFS, or its first commit puts the whole file into git's history.
const ATTRIBUTES = readFileSync(new URL('../../../.gitattributes', import.meta.url), 'utf8');
const lfs = (ext) => new RegExp(`^\\*\\.${ext}\\s+filter=lfs diff=lfs merge=lfs -text$`, 'm');

describe('.gitattributes', () => {
  it('tracks every shipped asset kind through LFS: models, images, calls and the film', () => {
    for (const ext of ['glb', 'webp', 'mp3', 'mp4']) expect(ATTRIBUTES, ext).toMatch(lfs(ext));
  });
});
