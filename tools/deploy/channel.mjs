#!/usr/bin/env node
// A public URL of any branch, for a machine that cannot reach this one (the
// rented Windows rigs that read frame times): a Firebase Hosting preview channel.
// The client is built as production is, against the live addresses, and published
// to a channel of its own that expires; nothing live is touched. Solo play only:
// the signaling server lists no channel origin, so a lobby will not connect.
//
// Usage: npm run preview:channel -- <name>
//        npm run preview:channel -- <name> --expires 2d    (7d by default)
//        npm run preview:channel -- <name> --dry-run       (build and lay out site/, print the command, deploy nothing)
//
// The last line printed is the channel's address.

import { requireCommand, run, tfOutput, fail } from './lib/preconditions.mjs';
import { buildClient } from './lib/buildClient.mjs';
import { assembleSite } from './lib/site.mjs';
import { channelDeployArgs, channelUrlFrom, checkChannelName, parseChannelArgs } from './lib/channel.mjs';

let args;
try {
  args = parseChannelArgs(process.argv.slice(2));
  checkChannelName(args.name);
} catch (error) {
  fail(error.message);
}

requireCommand('npx', 'Install Node 22 or later.');

const project = tfOutput('gcp_project_id');
console.log(`→ channel   ${args.name} (expires in ${args.expires}) on ${project}`);

buildClient();
const sitePath = assembleSite({ siteUrl: tfOutput('site_url'), legacyHost: tfOutput('legacy_domain_name') });
console.log(`→ site dir  site${sitePath} (+ redirect page and favicon at /)`);

const deployArgs = channelDeployArgs(args.name, args.expires, project);
if (args.dryRun) {
  console.log(`\n→ dry run, not deployed: npx ${deployArgs.join(' ')}`);
  process.exit(0);
}

// The CLI's output is read for the address, so it is shown when the deploy ends, or on a failure.
console.log('→ deploying (the CLI prints when it ends)');
let stdout;
try {
  stdout = run('npx', deployArgs, { maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  fail(`the channel deploy failed (exit ${error.status ?? 'unknown'}):\n${error.stdout ?? ''}${error.stderr ?? error.message}`);
}
process.stdout.write(stdout);
let url;
try {
  url = channelUrlFrom(stdout, sitePath);
} catch (error) {
  fail(error.message);
}
console.log(`\n✓ channel published\n${url}`);
