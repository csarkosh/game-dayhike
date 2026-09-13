// The page at the root of the site and on the old host. One function decides
// where to send the visitor; the page embeds that function's source, so the
// tested logic and the shipped logic are the same text.

/**
 * @param {{ host: string; pathname: string; search: string }} loc
 * @param {{ legacyHost: string; base: string }} opts base has no trailing slash
 */
export function redirectTarget(loc, opts) {
  if (loc.host === opts.legacyHost) return opts.base + loc.pathname + loc.search;
  return opts.base + '/';
}

/** @param {{ legacyHost: string; base: string }} opts */
export function renderRedirectPage(opts) {
  const home = `${opts.base}/`;
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
    <p>Day Hike has moved to <a href="${home}">${home}</a></p>
  </body>
</html>
`;
}
