// The public directory Firebase publishes (`site/`): the client build under the
// site path, and the redirect page at the root. Assembled fresh every time so a
// stale file can never ride along. The admin page is not in it: it is served
// from the shared admin host and shipped by `npm run deploy:admin`
// (`tools/deploy/admin.mjs`); its old address under the site 301s there
// (`firebase.json`). Shared by the production deploy and the preview channels.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { GAMES_INDEX, renderRedirectPage } from './redirectPage.mjs';

/** Lays out `site/` from `client/dist`; returns the site path (`/dayhike`). */
export function assembleSite({ siteUrl, legacyHost }) {
  const sitePath = new URL(siteUrl).pathname.replace(/\/+$/, '');
  rmSync('site', { recursive: true, force: true });
  mkdirSync(`site${sitePath}`, { recursive: true });
  // The source maps stay out of the site (`sourcemap: "hidden"` writes them
  // beside the chunks).
  cpSync('client/dist', `site${sitePath}`, { recursive: true, filter: (src) => !src.endsWith('.map') });
  writeFileSync('site/index.html', renderRedirectPage({ legacyHost, base: siteUrl, index: GAMES_INDEX }));
  // Browsers ask the origin for /favicon.ico whatever page they are on, and the
  // catch-all rewrite would answer with the redirect page's HTML.
  cpSync('client/dist/favicon.ico', 'site/favicon.ico');
  return sitePath;
}
