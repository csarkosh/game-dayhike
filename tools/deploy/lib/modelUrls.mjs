// Finding the deployed models' (and ground textures') URLs, which are no
// longer knowable in advance.
//
// Models used to ship from client/public/ at fixed paths, so `deploy:verify`
// could fetch `/assets/models/<id>.glb` by name. They now go through
// Vite's `?url` pipeline (client/src/game/assetUrls.ts) and land at
// `/assets/<id>-<hash>.glb`, where the hash changes whenever the bytes do.
// Ground textures (`client/src/game/groundMaps.ts`, `terrainTexture.ts`) are
// imported with `?url` the same way and land at `/assets/<id>-<hash>.webp`.
//
// The URL is therefore discovered the way check #3 already discovers the
// signaling URL: by reading it out of the deployed bundle source the verifier
// has fetched anyway. Keeping the discovery here as a pure function is what
// makes it testable without a network — verify.mjs itself is a script that talks
// to production on import.

/**
 * How many characters Vite's asset hash is. All 23 built names use exactly 8,
 * and pinning the length is what makes an id an unambiguous match rather than a
 * prefix of one.
 *
 * The hash alphabet is base64url, so it can itself contain `-`. With an open
 * `+` quantifier that made `ranger.nathan` match `/assets/ranger.nathan-v2-BCzVRFA1.glb`
 * — a DIFFERENT model's URL — because the `+` happily swallowed `v2-` as part of
 * the hash. `deploy:verify` would then have fetched the sibling, found a real
 * glTF behind it, and reported the id it never actually checked as healthy: a
 * false pass in the one check that exists to catch a silent failure. No shipped
 * id contains a `-` today, but nothing about an id's shape rules one out.
 *
 * The cost of pinning is that a future Vite changing its hash length makes this
 * find nothing, which `verify.mjs` reports as "the bundle does not reference
 * <id>". That is a loud failure pointing one step away from its cause — the
 * right trade against a silent wrong answer, but worth knowing when it happens.
 */
const HASH_LENGTH = 8;

/**
 * The URLs a built bundle references for the given asset ids, all sharing one
 * extension. Shared by `findModelUrls` (.glb) and `findTextureUrls` (.webp) —
 * the matching logic does not care what kind of asset it is, only that Vite
 * hashed it the same way.
 *
 * @param {string} source  JavaScript source of a deployed chunk.
 * @param {readonly string[]} ids  Catalog ids, e.g. `['ranger.nathan']`.
 * @param {string} ext  File extension, without the dot (`'glb'`, `'webp'`).
 * @returns {Record<string, string>} id → the full quoted URL, base-absolute
 *   (`/dayhike/assets/<id>-<hash>.<ext>`) when Vite was built with a non-root
 *   `base`, bare (`/assets/<id>-<hash>.<ext>`) when it was built with `base:
 *   "/"` (the desktop build). An id the source does not reference is absent
 *   rather than mapped to a guess — the caller decides whether that is a
 *   failure.
 */
function findAssetUrls(source, ids, ext) {
  const found = {};
  for (const id of ids) {
    // The id contains a `.` ("ranger.nathan"), which must not be a wildcard here:
    // otherwise `ranger.nathan` would also match `rangerXnathan`, and worse, a
    // shorter id would match inside a longer one's URL.
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchoring on `/assets/` and requiring `-<hash>` at exactly HASH_LENGTH
    // makes the matched basename be `<id>-<hash>.<ext>` by construction: it
    // cannot be a longer id's name, and it cannot be the unhashed dev path
    // (`/assets/models/<id>.<ext>`), which on a live site would mean the
    // deploy shipped something that is not a production build.
    //
    // The captured group reaches back to the opening quote rather than
    // starting at `/assets/`: Vite bakes its `base` config into every asset
    // URL it emits, so the web build's URLs are `/dayhike/assets/...`, not
    // `/assets/...`. Fetching the bare suffix against the site's origin hits
    // Firebase's `**` rewrite instead of the file — a 200 of the redirect
    // page's HTML, not the model. The class cannot cross a string delimiter,
    // so this only ever reaches back to where the current literal opened,
    // never into unrelated source or a different URL earlier in the file.
    // Backticks are delimiters too: the minifier emits template literals for
    // plain strings, and the first production verify after the site move
    // failed on exactly that — the models were there, quoted with backticks.
    const match = source.match(
      new RegExp(`["'\`]([^"'\`]*/assets/${escaped}-[A-Za-z0-9_-]{${HASH_LENGTH}}\\.${ext})["'\`]`),
    );
    if (match) found[id] = match[1];
  }
  return found;
}

/** The URLs a built bundle references for the given model ids (`.glb`). */
export function findModelUrls(source, ids) {
  return findAssetUrls(source, ids, 'glb');
}

/**
 * The URLs a built bundle references for the given ground-texture ids
 * (`.webp`) — `ground.<layer>`, `ground.<layer>.normal` and
 * `ground.<layer>.rah`, the catalog's naming for a ground layer's albedo,
 * normal and roughness/AO/height maps. Same matching rules as `findModelUrls`,
 * including the trap it guards against: an id that is a strict prefix of
 * another (`ground.grass` inside `ground.grass.rah-<hash>.webp`) still cannot
 * match, because the character right after the escaped id must be `-`, and
 * here it is `.`.
 */
export function findTextureUrls(source, ids) {
  return findAssetUrls(source, ids, 'webp');
}
