#!/usr/bin/env node
// Says whether a desktop release is due: compares desktop/package.json's exact
// Electron pin with the mirror's latest stable release. Exit 1 when outdated,
// so it can sit in a shell alias or a cron. Bumps nothing — the bump is a
// reviewed change to desktop/package.json and package-lock.json, then
// `npm run deploy:desktop -- --version X.Y.Z`.
import { readFileSync } from 'node:fs';
import { fail, requireGhAuth, run } from './lib/preconditions.mjs';
import { parseSemver } from './lib/desktopRelease.mjs';
import { latestMirrorVersion, outdatedVerdict } from './lib/mirrorRelease.mjs';

const MIRROR_REPO = 'csarkosh/electron-gamepatch';

requireGhAuth();
const pinned = JSON.parse(readFileSync('desktop/package.json', 'utf8')).devDependencies.electron;
if (!parseSemver(pinned)) fail(`desktop/package.json pins electron as ${pinned}; it must be an exact version`);

let releases;
try {
  releases = JSON.parse(
    run('gh', ['release', 'list', '--repo', MIRROR_REPO, '--limit', '30', '--json', 'tagName,isDraft,isPrerelease']),
  );
} catch (error) {
  fail(`could not read ${MIRROR_REPO}'s releases through gh: ${error.message}\nCheck \`gh auth status\` and that the repo is reachable, then re-run.`);
}
if (!Array.isArray(releases)) fail(`gh returned something other than a release list for ${MIRROR_REPO}`);

const verdict = outdatedVerdict(pinned, latestMirrorVersion(releases));
console.log(verdict.message);
process.exit(verdict.outdated ? 1 : 0);
