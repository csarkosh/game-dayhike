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
 *
 * These are Day Hike's shipped files, under `client/assets/`, and the engine's own, under
 * `engine/assets/` (`engineAssets.ts`): the engine's modules and the game's alike ask for one
 * through `assetUrls.ts`, which answers from what this file registers, the two merged. Importing
 * it registers them; the page's entry does.
 */
import catalog from "../../assets/catalog.json" with { type: "json" };
import { mergeAssets, registerAssets } from "@csarkosh/engine/game/assetUrls";
import { ENGINE_ASSETS } from "@csarkosh/engine/game/engineAssets";

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

/**
 * The intro's film and the title page's loop and still, through the same
 * mechanism. Empty until each ships, and a title page or a Play without them
 * is the ordinary case until then: `videoUrl`, `titleVideoUrl` and
 * `titleStillUrl` give null rather than throwing, and the page shows no video
 * and no still.
 */
const VIDEO_GLOB_URLS = import.meta.glob("../../assets/video/*.mp4", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;
const IMAGE_GLOB_URLS = import.meta.glob("../../assets/images/*.webp", {
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
 * to the loader as a URL.
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
const VIDEO_URLS = urlMap(VIDEO_GLOB_URLS);
const IMAGE_URLS = urlMap(IMAGE_GLOB_URLS);

/**
 * Day Hike's own models, textures and sound, then the engine's. The bark, moss and ground textures
 * are the engine's, so Day Hike has none of its own to register here (the board's two are read
 * by `boardImages.ts`). Day Hike's go first, so the `assets` section, the one a module reads in
 * order (the wildlife's creatures), comes out in the order it had when one file held every entry.
 */
registerAssets(mergeAssets({ models: MODEL_URLS, textures: urlMap({}), audio: AUDIO_URLS, catalog }, ENGINE_ASSETS));

/** The intro film's hashed url, or null until it ships. */
export function videoUrl(): string | null {
  return Object.hasOwn(VIDEO_URLS, "video/intro.mp4") ? (VIDEO_URLS["video/intro.mp4"] as string) : null;
}

/** The title page's loop, or null until it ships. */
export function titleVideoUrl(): string | null {
  return Object.hasOwn(VIDEO_URLS, "video/title.mp4") ? (VIDEO_URLS["video/title.mp4"] as string) : null;
}

/** The title page's still, the loop's first frame, or null until it ships. */
export function titleStillUrl(): string | null {
  return Object.hasOwn(IMAGE_URLS, "images/title.still.webp") ? (IMAGE_URLS["images/title.still.webp"] as string) : null;
}
