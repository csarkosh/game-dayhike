// The two folders the engine's site tool publishes (`site/`): the client build
// (`site/dayhike/`, the site path) and the site's top-level files
// (`site/root/`: the redirect page, the favicon and robots.txt, nothing else). Assembled
// fresh every time so a stale file can never ride along. The admin page is not in
// it: it is served from the shared admin host and shipped by `npm run
// deploy:admin` (`tools/deploy/admin.mjs`); its old address under the site 301s
// there (`site.rules.json`). Shared by the production deploy and the preview
// channels.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { GAMES_INDEX, renderRedirectPage } from './redirectPage.mjs';

/** The folder of the top-level files, the tool's `--root-dir`. */
export const SITE_ROOT_DIR = 'site/root';

/** The folder served under the site path, the tool's `--dir`: `site/dayhike` for `/dayhike`. */
export const siteDirFor = (sitePath) => `site${sitePath}`;

/** Lays out `site/dayhike/` and `site/root/` from `client/dist`; returns the site path (`/dayhike`). */
export function assembleSite({ siteUrl, legacyHost }) {
  const sitePath = new URL(siteUrl).pathname.replace(/\/+$/, '');
  rmSync('site', { recursive: true, force: true });
  mkdirSync(siteDirFor(sitePath), { recursive: true });
  mkdirSync(SITE_ROOT_DIR, { recursive: true });
  // The source maps stay out of the site (`sourcemap: "hidden"` writes them
  // beside the chunks).
  cpSync('client/dist', siteDirFor(sitePath), { recursive: true, filter: (src) => !src.endsWith('.map') });
  writeFileSync(`${SITE_ROOT_DIR}/index.html`, renderRedirectPage({ legacyHost, base: siteUrl, index: GAMES_INDEX }));
  // Browsers ask the origin for /favicon.ico whatever page they are on, and the
  // catch-all rewrite would answer with the redirect page's HTML.
  cpSync('client/dist/favicon.ico', `${SITE_ROOT_DIR}/favicon.ico`);
  // Search engines find the game's sitemap through robots.txt, which the catch-all also answered
  // with the redirect page. The sitemap sits under the game's path, not at /sitemap.xml: the site
  // is shared, and csarko.sh's admin judges every visited path of a host against that host's
  // /sitemap.xml, so a root one naming only the game would call each party and game route, and
  // every other game's page, a 404.
  const page = `${siteUrl.replace(/\/+$/, '')}/`;
  writeFileSync(`${SITE_ROOT_DIR}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${page}sitemap.xml\n`);
  writeFileSync(
    `${siteDirFor(sitePath)}/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${page}</loc></url>\n</urlset>\n`,
  );
  return sitePath;
}
