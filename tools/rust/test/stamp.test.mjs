// The committed kernel module was built from the kernel's sources as they stand: a change under client/rust/
// that was not followed by `npm run kernel:build` fails here, with no Rust needed to find it.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtFrom, kernelSourceHash, kernelSources } from '../lib/stamp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('the field kernel\'s committed module', () => {
  it('sees the kernel\'s sources', () => {
    const sources = kernelSources(root);
    expect(sources).toContain('client/rust/field/src/lib.rs');
    expect(sources).toContain('client/rust/field/Cargo.lock');
    expect(sources).toContain('client/rust/rust-toolchain.toml');
  });

  it('names the sources it was built from, and they have not changed since', () => {
    expect(builtFrom(root)).toBe(kernelSourceHash(root));
  });
});
