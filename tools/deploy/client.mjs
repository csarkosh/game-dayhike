#!/usr/bin/env node
// Build the client against the live signaling URL and publish it.
//
// Every address is read from Terraform rather than written down anywhere, so
// the client can never be built against a stale endpoint.
//
// Usage: npm run deploy:client

import { readdirSync } from 'node:fs';
import { requireCommand, requireProjectMatchesTerraform, runLoud, tfOutput } from './lib/preconditions.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { assembleSite } from './lib/site.mjs';

requireCommand('npx', 'Install Node 22 or later.');
requireProjectMatchesTerraform();

const site = tfOutput('hosting_site_id');
const project = tfOutput('gcp_project_id');
console.log(`→ site      ${site}`);

const env = buildClient();

// The public directory Firebase publishes is laid out by `lib/site.mjs`, fresh
// on every deploy. The source maps stay out of it and go to the downloads bucket
// under the build's sha, where `tools/telemetry/symbolicate.mjs` reads a
// telemetry stack against them. The bucket is public, as the repository is. They
// go up gzipped on the wire and are stored as they are: 20 MB of JSON is 4 MB
// that way, most of the upload's time at a home connection's upload speed.
const siteUrl = tfOutput('site_url');
const legacyHost = tfOutput('legacy_domain_name');
const sitePath = assembleSite({ siteUrl, legacyHost });
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
