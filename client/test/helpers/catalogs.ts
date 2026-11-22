import dayCatalog from "../../assets/catalog.json" with { type: "json" };
import { engineCatalog } from "@csarkosh/engine/testing/engineFiles";

/**
 * The shipped files' catalogs: Day Hike's own (`client/assets/`), the engine's (`engine/assets/`), and the two as
 * one, Day Hike's entries first, as the page registers them.
 */
export { dayCatalog, engineCatalog };
export const catalog = {
  assets: [...dayCatalog.assets, ...engineCatalog.assets],
  textures: [...dayCatalog.textures, ...engineCatalog.textures],
  audio: [...dayCatalog.audio, ...engineCatalog.audio],
  video: dayCatalog.video,
};
