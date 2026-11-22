#!/usr/bin/env node
// A public URL of any branch, for a machine that cannot reach this one (the
// rented Windows rigs that read frame times): a Firebase Hosting preview channel.
// The client is built as production is, against the live addresses, and published
// to a channel of its own that expires, with the engine's site tool (the site is
// shared with other games); nothing live is touched. Solo play only:
// the signaling server lists no channel origin, so a lobby will not connect.
//
// Usage: npm run preview:channel -- <name>
//        npm run preview:channel -- <name> --expires 2d    (whole days, 1d to 30d; 7d by default)
//        npm run preview:channel -- <name> --dry-run       (build, lay out site/, and run the tool's dry run: its plan, nothing written)
//
// The last line printed is the channel's address (`tools/rig/session.sh` reads it).

import { requireCommand, run, tfOutput, fail } from './lib/preconditions.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { assembleSite } from './lib/site.mjs';
import { siteDeployArgs } from './lib/siteDeploy.mjs';
import { channelPublishedText, channelUrlFrom, checkChannelName, expiresDays, parseChannelArgs } from './lib/channel.mjs';

let args;
try {
  args = parseChannelArgs(process.argv.slice(2));
  checkChannelName(args.name);
  args.days = expiresDays(args.expires);
} catch (error) {
  fail(error.message);
}

requireCommand('npx', 'Install Node 22 or later.');
requireCommand('gcloud', 'Install the Google Cloud CLI: the site tool takes its access token from it.');

const project = tfOutput('gcp_project_id');
const site = tfOutput('hosting_site_id');
console.log(`→ channel   ${args.name} (expires in ${args.days} days) on ${project}`);

buildClient();
const sitePath = assembleSite({ siteUrl: tfOutput('site_url'), legacyHost: tfOutput('legacy_domain_name') });
console.log(`→ site dirs site${sitePath} and site/root`);

const deployArgs = siteDeployArgs({ project, site, sitePath, channel: args.name, expiresDays: args.days, dryRun: args.dryRun });

// The tool's output is read for the address, so it is shown when the tool ends, or on a failure.
console.log(`→ ${args.dryRun ? 'planning' : 'deploying'} (the site tool prints when it ends)`);
let stdout;
try {
  stdout = run('node', deployArgs, { maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  fail(`the channel deploy failed (exit ${error.status ?? 'unknown'}):\n${error.stdout ?? ''}${error.stderr ?? error.message}`);
}
process.stdout.write(stdout);
if (args.dryRun) {
  console.log('\n✓ dry run, nothing published');
  process.exit(0);
}
let url;
try {
  url = channelUrlFrom(stdout, sitePath);
} catch (error) {
  fail(error.message);
}
console.log(channelPublishedText(url));
