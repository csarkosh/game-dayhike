#!/usr/bin/env node
// Read a telemetry stack back to source.
//
//   node tools/telemetry/symbolicate.mjs <build sha> [stack.txt]
//
// The stack comes from the file, or from stdin; the build sha is the row's
// `build`. The maps are fetched from where the client deploy stored them, the
// downloads bucket under sourcemaps/<build>/ (`tools/deploy/client.mjs`).

import { readFileSync } from 'node:fs';
import { tfOutput } from '../deploy/lib/preconditions.mjs';
import { mapUrl, symbolicate } from './lib/symbolicate.mjs';

const [build, file] = process.argv.slice(2);
if (!build) {
  console.error('usage: node tools/telemetry/symbolicate.mjs <build sha> [stack.txt]');
  process.exit(2);
}
const stack = readFileSync(file ?? 0, 'utf8');
const downloads = tfOutput('downloads_url');

const loadMap = async (chunk) => {
  const res = await fetch(mapUrl(downloads, build, chunk));
  if (!res.ok) {
    console.error(`no map for ${chunk} in build ${build} (${res.status})`);
    return null;
  }
  return res.json();
};

process.stdout.write(`${await symbolicate(stack, loadMap)}\n`);
