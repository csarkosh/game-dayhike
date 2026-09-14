#!/usr/bin/env node
// Build the client against the live signaling URL and publish it.
//
// Every address is read from Terraform rather than written down anywhere, so
// the client can never be built against a stale endpoint.
//
// Usage: npm run deploy:client

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { requireCommand, requireProjectMatchesTerraform, runLoud, tfOutput } from './lib/preconditions.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { renderRedirectPage } from './lib/redirectPage.mjs';

requireCommand('npx', 'Install Node 22 or later.');
requireProjectMatchesTerraform();

const site = tfOutput('hosting_site_id');
const project = tfOutput('gcp_project_id');
console.log(`→ site      ${site}`);

buildClient();

// The public directory Firebase publishes: the client build under the site
// path, and the redirect page at the root. Assembled fresh on every deploy so
// a stale file can never ride along.
const siteUrl = tfOutput('site_url');
const legacyHost = tfOutput('legacy_domain_name');
const sitePath = new URL(siteUrl).pathname.replace(/\/+$/, '');
rmSync('site', { recursive: true, force: true });
mkdirSync(`site${sitePath}`, { recursive: true });
cpSync('client/dist', `site${sitePath}`, { recursive: true });
writeFileSync('site/index.html', renderRedirectPage({ legacyHost, base: siteUrl }));
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
