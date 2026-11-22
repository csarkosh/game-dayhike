// The engine's site tool (`@csarkosh/engine`, `tools/site/deploy.mjs`) is how this
// repository publishes: the site is shared with other games, and a Firebase deploy
// would replace them all. This is its argument list, pure, for the production deploy
// and the preview channels. This repository owns the game's path and the site's
// root, so the rules file (`site.rules.json`) holds both and the root folder is
// always given.
import { SITE_ROOT_DIR, siteDirFor } from './site.mjs';

export const SITE_TOOL = 'node_modules/@csarkosh/engine/tools/site/deploy.mjs';
export const SITE_RULES = 'tools/deploy/site.rules.json';

/**
 * The arguments of `node` for the tool. `channel` (a name) with `expiresDays` publishes to a
 * preview channel in place of live; `message` is a live release's. `dryRun` reads the site and
 * prints the plan only.
 */
export function siteDeployArgs({ project, site, sitePath, channel, expiresDays, message, dryRun = false }) {
  const args = [
    SITE_TOOL,
    '--project', project,
    '--site', site,
    '--path', sitePath,
    '--dir', siteDirFor(sitePath),
    '--root-dir', SITE_ROOT_DIR,
    '--rules', SITE_RULES,
  ];
  if (channel !== undefined) args.push('--channel', channel, '--expires', String(expiresDays));
  else if (message !== undefined) args.push('--message', message);
  if (dryRun) args.push('--dry-run');
  return args;
}
