#!/usr/bin/env node
// Checks a built client (`npm run build`'s `client/dist`) for the WGSL map
// the WebGPU path fetches: one map of the known format, named by the WebGPU
// chunk and by nothing the WebGL2 page loads, and one the deploy check
// accepts. Exits 1 with a line for each problem.
//
// Usage: node tools/wgsl/check-build.mjs [dist]

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuild } from './lib/checkBuild.mjs';
import { loadShared } from './lib/shared.mjs';

const dist = resolve(process.argv[2] ?? fileURLToPath(new URL('../../client/dist/', import.meta.url)));
const { MAP_FORMAT } = await loadShared();
const problems = checkBuild(dist, { mapFormat: MAP_FORMAT });
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(`✓ the built client carries the WGSL map as it should (${dist})`);
