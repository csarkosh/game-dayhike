/**
 * The engine's own shipped files: the trees, the dead wood, the cliffs, the clutter, the understory
 * and the animals as models; the bark, moss and ground textures; the forest's and the shore's sound.
 * They stand in `engine/assets/`, described by its own `catalog.json`, and are served the way a
 * game's own are: each glob's files are imported with `?url`, so the build fingerprints them.
 *
 * This only gathers them, keyed by the name the engine asks for ("models/<id>.glb"). A game
 * registers them with its own (`mergeAssets`, then `registerAssets` in `assetUrls.ts`).
 */
import catalog from "../../assets/catalog.json" with { type: "json" };
import type { AssetAddresses } from "./assetUrls.js";

const MODELS = import.meta.glob("../../assets/models/*.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const TEXTURES = import.meta.glob("../../assets/textures/*.{ktx2,webp}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const AUDIO = import.meta.glob("../../assets/audio/*.mp3", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The globs' own key prefix, stripped so a key is the catalog's `output` verbatim. */
const ASSETS = "../../assets/";

/** One glob's files by the name the engine asks for ("models/<id>.glb"), on a null prototype so no inherited name answers. */
function byName(glob: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, url] of Object.entries(glob)) {
    if (!key.startsWith(ASSETS)) throw new Error(`import.meta.glob returned an unexpected key "${key}"; expected it to start with "${ASSETS}".`);
    map[key.slice(ASSETS.length)] = url;
  }
  return map;
}

/** The engine's shipped files and their catalog, for a game to merge with its own. */
export const ENGINE_ASSETS: AssetAddresses = { models: byName(MODELS), textures: byName(TEXTURES), audio: byName(AUDIO), catalog };
