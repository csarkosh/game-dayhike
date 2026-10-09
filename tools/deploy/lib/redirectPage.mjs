// The page every path outside the game is rewritten to, on both hosts. The site
// root itself never reaches it: firebase.json 301s `/` to GAMES_INDEX. One
// function decides where to send the visitor; the page embeds that function's
// source, so the tested logic and the shipped logic are the same text.

/** The list of games on csarko.sh. firebase.json's redirect for `/` names it too. */
export const GAMES_INDEX = 'https://csarko.sh/games';

/**
 * An old-host link keeps its path, under the game; anything else on the new
 * host is not a page, so it goes to the list of games.
 * @param {{ host: string; pathname: string; search: string }} loc
 * @param {{ legacyHost: string; base: string; index: string }} opts base has no trailing slash
 */
export function redirectTarget(loc, opts) {
  if (loc.host === opts.legacyHost) return opts.base + loc.pathname + loc.search;
  return opts.index;
}

/** @param {{ legacyHost: string; base: string; index: string }} opts */
export function renderRedirectPage(opts) {
  const home = opts.index;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Day Hike</title>
    <meta http-equiv="refresh" content="0;url=${home}">
    <style>html,body{margin:0;height:100%;background:#101014;color:#fff;font-family:ui-monospace,monospace}body{display:flex;align-items:center;justify-content:center}a{color:#fff}</style>
    <script>
      ${redirectTarget.toString()}
      location.replace(redirectTarget(location, ${JSON.stringify(opts)}));
    </script>
  </head>
  <body>
    <p>Find Day Hike and the other games at <a href="${home}">${home}</a></p>
  </body>
</html>
`;
}
