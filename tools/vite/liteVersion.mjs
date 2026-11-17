// The version of Babylon Lite the page is built with, for the page's
// telemetry (`client/vite.config.ts` defines `__LITE_VERSION__` from it).
//
// The hike is drawn with a patched Babylon Lite that `client/package.json`
// pins by the tag of its repository (`github:<owner>/<repo>#<tag>`). The
// tag is what names the patches: the installed package's own `version` is
// the release they stand on and is the same for every tag made on it. So
// the version a telemetry row carries is read from the pin, at build time,
// and no module of the library is loaded to ask it.

/** The dependency the hike's renderer is. */
export const LITE_PACKAGE = '@babylonjs/lite';

/**
 * The pinned version in `text`, the text of `client/package.json`: the tag
 * after the `#` of a repository pin, or the version as written where the
 * package is pinned by one. Throws where the package is not a dependency.
 */
export function liteVersion(text) {
  const pinned = JSON.parse(text).dependencies?.[LITE_PACKAGE];
  if (typeof pinned !== 'string' || pinned === '') throw new Error(`${LITE_PACKAGE} is not among the client's dependencies`);
  const at = pinned.lastIndexOf('#');
  const version = at < 0 ? pinned : pinned.slice(at + 1);
  if (version === '') throw new Error(`${LITE_PACKAGE} is pinned with no tag: ${pinned}`);
  return version;
}
