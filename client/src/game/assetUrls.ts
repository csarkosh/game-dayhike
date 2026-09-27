/**
 * The URL each shipped model is actually served at.
 *
 * Shipped .glb output used to live in `client/public/assets/models/`. Vite copies
 * `public/` through verbatim, so those files shipped at fixed, unhashed URLs —
 * `/assets/models/ranger.nathan.glb` — and Firebase could only cache them for an
 * hour (a longer cache on an unhashed URL means a redeployed model is stale
 * until the cache expires, with no way to bust it). Every model in the game was
 * therefore re-fetched hourly, and for the first hour after a deploy a warm
 * client could still be loading the previous build's geometry.
 *
 * The ground textures solved this first: they sit under
 * `client/assets/`, are imported with `?url`, and Vite fingerprints anything
 * imported as a module. A fingerprinted URL is safe to cache forever, which is
 * what Firebase's `/assets/**` `immutable` rule already grants. `public/` cannot
 * do this — being copied uninspected is the entire point of that directory — so
 * the models moved beside the catalog that describes them and go through the
 * same mechanism here.
 *
 * The catalog's `output` field ("models/<id>.glb") stays the single key
 * everything resolves through: it is assigned once per model, and callers ask
 * for it by that name without knowing what Vite renamed it to.
 */

/**
 * Every shipped model, keyed by its path relative to `client/src/game/`. `eager`
 * because these are strings, not modules — the whole map is a couple of hundred
 * bytes in the bundle, and a lazy map would make every caller async for nothing.
 */
const GLOB_URLS = import.meta.glob("../../assets/models/*.glb", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The wildlife call clips, through the same mechanism for the same reason.
 * Empty until the first clip is committed — the directory need not exist for
 * the glob to resolve — which is why `audioUrl`'s throw is a normal, expected
 * outcome that `wildlifeAudio.ts` catches: a call whose recording has not
 * landed yet is silence, not a startup failure. That is the one place its
 * contract differs from `modelUrl`'s.
 */
const AUDIO_GLOB_URLS = import.meta.glob("../../assets/audio/*.mp3", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The globs' own key prefix, stripped so the lookup key is the catalog's
 * `output` verbatim ("models/<id>.glb", "audio/<id>.mp3") rather than a path
 * relative to this file. Both globs sit under it, which is why one constant and
 * one builder serve both. */
const GLOB_PREFIX = "../../assets/";

/**
 * One glob's keys, stripped, on a null prototype.
 *
 * `Object.create(null)` rather than a plain object literal because a plain one
 * inherits `Object.prototype`: `MODEL_URLS["toString"]` would then be an
 * inherited FUNCTION, not `undefined`, and `modelUrl("toString")` would return it
 * typed as a string instead of throwing. `resolveCharacterAssets` accepts any
 * `output` that is merely a non-empty string, so the throw below is the only
 * thing standing between a malformed catalog entry and a function object handed
 * to Babylon as a URL.
 */
function urlMap(glob: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, url] of Object.entries(glob)) {
    // Fail here, not later. If Vite ever changes how it normalises glob keys
    // (absolute paths, a leading slash, a different relative base), silently
    // keeping the raw key would leave the map correct-looking but keyed wrong —
    // and every caller's top-level `modelUrl(...)` would then throw "unknown
    // model", sending the reader to check a file and a catalog entry that are
    // both fine. This names the actual cause.
    if (!key.startsWith(GLOB_PREFIX)) {
      throw new Error(
        `import.meta.glob returned an unexpected key "${key}"; expected it to start ` +
          `with "${GLOB_PREFIX}". Vite's glob key normalisation changed — the prefix ` +
          `this file strips has to change with it.`,
      );
    }
    map[key.slice(GLOB_PREFIX.length)] = url;
  }
  return map;
}

const MODEL_URLS = urlMap(GLOB_URLS);
const AUDIO_URLS = urlMap(AUDIO_GLOB_URLS);

/**
 * Resolves a catalog `output` ("models/<id>.glb") to the URL Vite serves it at
 * — content-hashed in a production build, the plain source path in dev and under
 * vitest.
 *
 * Throws on an unknown key rather than returning it. A typo or a catalog entry
 * whose file has not shipped would otherwise become a 404 at load time, which
 * Babylon reports by leaving the mesh absent — enemies silently fall back to
 * capsules and clutter silently disappears. Failing here makes it a startup
 * error naming both places the model has to exist.
 */
export function modelUrl(output: string): string {
  const url = Object.hasOwn(MODEL_URLS, output) ? MODEL_URLS[output] : undefined;
  if (url === undefined) {
    throw new Error(
      `unknown model "${output}". It must exist both as a shipped file at ` +
        `client/assets/${output} and as an \`output\` in client/assets/catalog.json.`,
    );
  }
  return url;
}

/**
 * The same resolution for a wildlife call clip ("audio/<id>.mp3").
 *
 * Throws the same way for the same reason — but here the throw is also the
 * ordinary path while recordings are still landing: no clip is
 * committed until it is ready, and the
 * game must run, silently, in the meantime. `wildlifeAudio.ts` therefore catches
 * it per clip. Anything else calling this wants the same guarantee `modelUrl`
 * gives: a typo is a startup error, not a 404 the browser swallows.
 */
export function audioUrl(output: string): string {
  const url = Object.hasOwn(AUDIO_URLS, output) ? AUDIO_URLS[output] : undefined;
  if (url === undefined) {
    throw new Error(
      `unknown audio clip "${output}". It must exist both as a shipped file at ` +
        `client/assets/${output} and as an \`audio\` entry in client/assets/catalog.json.`,
    );
  }
  return url;
}
