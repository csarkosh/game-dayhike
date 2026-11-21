/**
 * The shipped files the empty game is drawn and heard with: the engine's own
 * (the trees, the cliffs, the clutter, the animals, the bark, moss and ground
 * textures, the forest's and the shore's sound), registered with the engine
 * by name (`assetUrls.ts`). Importing this registers them; the entry does.
 *
 * They stand in Day Hike's folder for now, beside its own, and are read from
 * there: the engine's assets come to the engine when it is lifted into a
 * repository of its own. Nothing of Day Hike's own is asked for here: no
 * ranger, no car, no sign, no voice, no film.
 */
// eslint-disable-next-line no-restricted-imports -- the one reach into Day Hike's folder: the engine's assets and their catalog stand there until the lift
import catalog from "../../../client/assets/catalog.json" with { type: "json" };
import { registerAssets } from "@csarkosh/engine/game/assetUrls";

const ASSETS = "../../../client/assets/";

const MODELS = import.meta.glob(
  [
    "../../../client/assets/models/tree.*.glb",
    "../../../client/assets/models/deadwood.*.glb",
    "../../../client/assets/models/cliff.*.glb",
    "../../../client/assets/models/clutter.*.glb",
    "../../../client/assets/models/understory.*.glb",
    "../../../client/assets/models/wildlife.*.glb",
  ],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

const TEXTURES = import.meta.glob(
  ["../../../client/assets/textures/bark.*.ktx2", "../../../client/assets/textures/moss.*.ktx2", "../../../client/assets/textures/ground.*.webp"],
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

const AUDIO = import.meta.glob(["../../../client/assets/audio/ambience.*.mp3", "../../../client/assets/audio/call.*.mp3"], {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** One glob's files by the name the engine asks for ("models/<id>.glb"), on a null prototype so no inherited name answers. */
function byName(glob: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, url] of Object.entries(glob)) {
    if (!key.startsWith(ASSETS)) throw new Error(`import.meta.glob returned an unexpected key "${key}"; expected it to start with "${ASSETS}".`);
    map[key.slice(ASSETS.length)] = url;
  }
  return map;
}

registerAssets({ models: byName(MODELS), textures: byName(TEXTURES), audio: byName(AUDIO), catalog });
