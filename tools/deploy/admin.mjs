#!/usr/bin/env node
// Build the admin page for the shared admin host and hand it over.
//
// The page is served from https://admin.csarko.sh/game-dayhike/ by the
// csarko.sh repository, whose `admin/deploy.sh` assembles the host from every
// app's bundle and publishes it. This script's part: build the page against
// the live telemetry URL (`client/vite.admin.config.ts`), put the bundle where
// that script pulls it from, the downloads bucket under `admin/latest/`, and
// run that script when the repository is beside this one. The source maps
// stay off the host and go where the game's go, by build sha, so a stack from
// the admin page reads back the same way (`tools/telemetry/symbolicate.mjs`).
//
// Usage: npm run deploy:admin
//
//   CSARKO_SH_REPO  where the csarko.sh checkout is; ~/Projects/csarko.sh unless set

import { accessSync, constants, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireCommand, requireProjectMatchesTerraform, runLoud, tfOutput } from './lib/preconditions.mjs';
import { ADMIN_DIST, buildAdmin } from './lib/buildClient.mjs';

/** Where the host's deploy pulls this app's bundle from, under the downloads bucket. */
const ADMIN_PREFIX = 'admin/latest';

requireCommand('npx', 'Install Node 22 or later.');
requireCommand('gcloud', 'Install the Google Cloud CLI.');
requireProjectMatchesTerraform();

const env = buildAdmin();

const downloadsBucket = tfOutput('downloads_bucket');
const target = `gs://${downloadsBucket}/${ADMIN_PREFIX}`;
// The folder as the host serves it, and nothing else: whatever the last build
// left there and this one did not is deleted, and the maps never go up with
// it (`sourcemap: "hidden"` writes them beside the chunks).
runLoud('gcloud', [
  'storage',
  'rsync',
  ADMIN_DIST,
  target,
  '--recursive',
  '--delete-unmatched-destination-objects',
  '--exclude=.*\\.map$',
  '--quiet',
]);
console.log(`→ admin page at ${target}/ (index.html and assets/)`);

const maps = readdirSync(join(ADMIN_DIST, 'assets')).filter((name) => name.endsWith('.map'));
if (maps.length > 0) {
  runLoud('gcloud', [
    'storage',
    'cp',
    ...maps.map((name) => join(ADMIN_DIST, 'assets', name)),
    `gs://${downloadsBucket}/sourcemaps/${env.VITE_BUILD_SHA}/assets/`,
    '--quiet',
  ]);
  console.log(`→ ${maps.length} source maps stored under sourcemaps/${env.VITE_BUILD_SHA}/`);
}

// The host is the csarko.sh repository's to publish: its script pulls the
// folder above into its own tree, runs its checks and deploys the site. Run
// here when that checkout is at hand, so one command ships the page; named
// otherwise, so the step is never silently skipped.
const shellDeploy = join(process.env.CSARKO_SH_REPO ?? join(homedir(), 'Projects', 'csarko.sh'), 'admin', 'deploy.sh');
let runnable = false;
try {
  accessSync(shellDeploy, constants.X_OK);
  runnable = true;
} catch {
  runnable = false;
}
if (runnable) {
  console.log(`→ publishing the host: ${shellDeploy}`);
  runLoud(shellDeploy, [], { cwd: join(shellDeploy, '..', '..') });
  console.log(`\n✓ admin page published to https://admin.csarko.sh/game-dayhike/`);
} else {
  console.log(`\n✓ admin page uploaded to ${target}/`);
  console.log(`  The host is published from the csarko.sh repository. Run there:\n\n    admin/deploy.sh\n\n  (${shellDeploy} is not here or not executable; set CSARKO_SH_REPO to the checkout to run it from here.)`);
}
