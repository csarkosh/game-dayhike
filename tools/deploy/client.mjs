#!/usr/bin/env node
// Build the client against the live signaling URL and publish it.
//
// Every address is read from Terraform rather than written down anywhere, so
// the client can never be built against a stale endpoint.
//
// Usage: npm run deploy:client

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { requireCommand, requireProjectMatchesTerraform, runLoud, tfOutput } from './lib/preconditions.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { GAMES_INDEX, renderRedirectPage } from './lib/redirectPage.mjs';

requireCommand('npx', 'Install Node 22 or later.');
requireProjectMatchesTerraform();

const site = tfOutput('hosting_site_id');
const project = tfOutput('gcp_project_id');
console.log(`→ site      ${site}`);

const env = buildClient();

// The public directory Firebase publishes: the client build under the site
// path, and the redirect page at the root. Assembled fresh on every deploy so
// a stale file can never ride along. The admin page is not in it: it is
// served from the shared admin host and shipped by `npm run deploy:admin`
// (`tools/deploy/admin.mjs`); its old address under the site 301s there
// (`firebase.json`).
const siteUrl = tfOutput('site_url');
const legacyHost = tfOutput('legacy_domain_name');
const sitePath = new URL(siteUrl).pathname.replace(/\/+$/, '');
rmSync('site', { recursive: true, force: true });
mkdirSync(`site${sitePath}`, { recursive: true });
// The source maps stay out of the site (`sourcemap: "hidden"` writes them
// beside the chunks) and go to the downloads bucket under the build's sha,
// where `tools/telemetry/symbolicate.mjs` reads a telemetry stack against
// them. The bucket is public, as the repository is. They go up gzipped on the
// wire and are stored as they are: 20 MB of JSON is 4 MB that way, most of the
// upload's time at a home connection's upload speed.
cpSync('client/dist', `site${sitePath}`, { recursive: true, filter: (src) => !src.endsWith('.map') });
const maps = readdirSync('client/dist/assets').filter((name) => name.endsWith('.map'));
const downloadsBucket = tfOutput('downloads_bucket');
if (maps.length > 0) {
  runLoud('gcloud', [
    'storage',
    'cp',
    ...maps.map((name) => `client/dist/assets/${name}`),
    `gs://${downloadsBucket}/sourcemaps/${env.VITE_BUILD_SHA}/assets/`,
    '--gzip-in-flight-all',
    '--quiet',
  ]);
  console.log(`→ ${maps.length} source maps stored under sourcemaps/${env.VITE_BUILD_SHA}/`);
}
writeFileSync('site/index.html', renderRedirectPage({ legacyHost, base: siteUrl, index: GAMES_INDEX }));
// Browsers ask the origin for /favicon.ico whatever page they are on, and the
// catch-all rewrite would answer with the redirect page's HTML.
cpSync('client/dist/favicon.ico', 'site/favicon.ico');
console.log(`→ site dir  site${sitePath} (+ redirect page and favicon at /)`);

runLoud('npx', [
  'firebase-tools',
  'deploy',
  '--only',
  'hosting',
  '--project',
  project,
  '--non-interactive',
]);

console.log(`\n✓ client published`);
