// The table Babylon.js's PBR materials read their environment's reflectance
// from, for the page's build and its dev server (`client/vite.config.ts`).
//
// The hike's renderer on Babylon Lite lights its materials with the sky's
// capture as Babylon.js's do, and so with the same table: the split sum of
// the reflectance over the view's angle and the roughness, which Babylon.js
// ships as a PNG in its package's source (`environmentBRDFTexture`,
// `Misc/brdfTextureTools.js`) and Lite reads from a URL. The renderer
// imports it from `virtual:dayhike-environment-brdf` as that PNG's data URL,
// taken from the installed package's text as the module is loaded: only the
// table's bytes reach the bundle, no code of Babylon.js, and they are always
// the ones of the Babylon.js the game draws with.

import { readFileSync } from 'node:fs';

/** The module the renderer imports the table's URL from. */
export const ENVIRONMENT_BRDF_ID = 'virtual:dayhike-environment-brdf';
const RESOLVED = `\0${ENVIRONMENT_BRDF_ID}`;

/** Where the table stands in the module's text: a PNG as a base64 data URL. */
const TABLE = /_environmentBRDFBase64Texture\s*=\s*"(data:image\/png;base64,[A-Za-z0-9+/]+={0,2})"/;

/** The table's data URL in `text`, the text of Babylon.js's `brdfTextureTools.js`; throws where it holds none. */
export function environmentBrdfUrl(text) {
  const found = TABLE.exec(text);
  if (found === null) throw new Error("Babylon.js's brdfTextureTools.js holds no environment BRDF table where the game reads it");
  return found[1];
}

/** The plugin, reading the table from `from`, the path of Babylon.js's `brdfTextureTools.js`. */
export function environmentBrdfPlugin({ from }) {
  return {
    name: 'dayhike-environment-brdf',
    resolveId(id) {
      return id === ENVIRONMENT_BRDF_ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile?.(from);
      return `export default ${JSON.stringify(environmentBrdfUrl(readFileSync(from, 'utf8')))};`;
    },
  };
}
