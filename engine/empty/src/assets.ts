/**
 * The shipped files the empty game is drawn and heard with: the engine's own
 * (the trees, the cliffs, the clutter, the animals, the bark, moss and ground
 * textures, the forest's and the shore's sound), registered with the engine
 * by name (`assetUrls.ts`). Importing this registers them; the entry does.
 *
 * They stand in the engine's own folder, and the engine gathers them
 * (`ENGINE_ASSETS`): this game has none of its own. Nothing of Day Hike's own
 * is asked for here: no ranger, no car, no sign, no voice, no film.
 */
import { registerAssets } from "@csarkosh/engine/game/assetUrls";
import { ENGINE_ASSETS } from "@csarkosh/engine/game/engineAssets";

registerAssets(ENGINE_ASSETS);
