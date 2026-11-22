// The kernel's sources as one hash: what the built module committed in src/sim/kernel/fieldWasm.ts says it
// was built from. A source changed without building again leaves the two apart, and the engine's tools suite says so.
// Every path here is relative to the engine's root, and the hash covers those path strings, so it does not change
// whether the engine is a folder of a game's repository or a repository of its own.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The files a build of the kernel reads, from the engine's root, in a fixed order. */
export function kernelSources(root) {
  const crate = 'rust/field';
  const rs = readdirSync(join(root, crate, 'src'), { recursive: true })
    .map((name) => String(name).split('\\').join('/'))
    .filter((name) => name.endsWith('.rs'))
    .sort()
    .map((name) => `${crate}/src/${name}`);
  return ['rust/rust-toolchain.toml', `${crate}/Cargo.toml`, `${crate}/Cargo.lock`, ...rs];
}

/** SHA-256 over each source's path and bytes (line endings as committed: LF). */
export function kernelSourceHash(root) {
  const hash = createHash('sha256');
  for (const path of kernelSources(root)) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(root, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** The hash the committed module names as its sources', or null if it names none. */
export function builtFrom(root) {
  const text = readFileSync(join(root, 'src/sim/kernel/fieldWasm.ts'), 'utf8');
  return /FIELD_WASM_SOURCE_SHA256 = "([0-9a-f]{64})"/.exec(text)?.[1] ?? null;
}
