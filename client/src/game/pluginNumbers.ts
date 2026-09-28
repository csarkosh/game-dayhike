/**
 * One number for each material plugin class, the same on every load.
 *
 * Babylon 9.18 gives each plugin class a define of its own, `MATERIALPLUGIN_<n>`,
 * and numbers it the first time a plugin of that class is added to a material
 * on the page (`MaterialPluginManager._addPlugin`: a page-wide counter, keyed
 * by the class's `getClassName()`). A material carries one such define, that
 * of the last class added to it (`_addPlugin` rebuilds the material's plugin
 * defines around the class it adds). What is added first follows what loads
 * first, so the number of a class, and with it the text of every shader of a
 * material whose last plugin it is, can differ from one load to the next: on WebGPU, a stage
 * whose text differs has another key (`shaderLookup.ts`), and a translation
 * the build shipped or the browser stored is not found. The define is read by
 * no shader, so the number changes nothing drawn.
 *
 * `pinPluginNumbers` sets every class the game's materials carry to its place
 * in `PLUGIN_ORDER`, and Babylon's counter past them, when a WebGPU engine is
 * made (`createWebGpuEngine`), before any of that engine's materials exist. A
 * class not in the list is numbered after them, by Babylon, as it comes;
 * `pluginNumbers.test.ts` holds the list to every class the game's materials
 * carry. On WebGL2 nothing changes: a page that never makes a WebGPU engine
 * keeps Babylon's own numbering, and its shader text.
 */
import { MaterialPluginManager } from "@babylonjs/core/Materials/materialPluginManager.pure.js";

/** Every material plugin class the game's materials carry, by
 * `getClassName()`: Babylon's own, in the order a PBR material adds them,
 * then the game's. */
export const PLUGIN_ORDER: readonly string[] = [
  "PBRBRDFConfiguration",
  "PBRClearCoatConfiguration",
  "PBRIridescenceConfiguration",
  "PBRAnisotropicConfiguration",
  "PBRSheenConfiguration",
  "PBRSubSurfaceConfiguration",
  "DetailMapConfiguration",
  "DecalMapConfiguration",
  "AtmospherePlugin",
  "CliffTintPlugin",
  "DistanceFadePlugin",
  "FoliageLightPlugin",
  "FoliagePlugin",
  "GroundConformPlugin",
  "SkinShadingPlugin",
  "TerrainTexturePlugin",
  "WingPlugin",
];

/** Babylon 9.18's page-wide numbering of plugin classes. */
type Numbering = { _MaterialPluginClassToMainDefine: Record<string, string>; _MaterialPluginCounter: number };

/** Numbers every class of `PLUGIN_ORDER` by its place in it (the first is
 * `MATERIALPLUGIN_1`), whatever was numbered before on the page, and has
 * Babylon number any other class after them. */
export function pinPluginNumbers(): void {
  const numbering = MaterialPluginManager as unknown as Numbering;
  const pinned: Record<string, string> = {};
  PLUGIN_ORDER.forEach((name, i) => {
    pinned[name] = `MATERIALPLUGIN_${i + 1}`;
  });
  numbering._MaterialPluginClassToMainDefine = pinned;
  numbering._MaterialPluginCounter = PLUGIN_ORDER.length;
}
