// The injected code needs `vFoliageH`, declared by the Foliage plugin
// (foliagePlugin.ts) — attachFoliageLight declines any material that does
// not already carry it. Priority 210, the same slot skin.ts's shading plugin
// uses: the two never attach to the same material (skin is enemies, this is
// foliage), so there is no ordering question between them.
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Nullable } from "@babylonjs/core/types.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
// Non-`.pure` import, load-bearing exactly as skin.ts documents: the wrapper
// registers the plugin-manager machinery this module depends on.
import "@babylonjs/core/Materials/materialPluginManager.js";
import diffuseFragment from "./shaders/foliageDiffuse.fragment.fx?raw";

import { FOLIAGE_SHADOW_FLOOR } from "./coverAlbedoParams.js";

/** Mirrored in foliageDiffuse.fragment.fx; the lockstep test asserts it. */
export const FOLIAGE_WRAP = 1.0;

/**
 * Per-light injection. `shaderProcessor.js`'s `ProcessIncludes` expands the
 * `lightFragment` include and unrolls `{X}` into each light's digit (0, 1, …)
 * first; only afterwards does the plugin manager's `_injectCustomCode` run
 * the `!`-prefixed point as a global regex with `$n` substitutions
 * (materialPluginManager.pure.js, `ReplaceRegExpSubstitutions`) over that
 * already-expanded code. So `$2` is a real digit at the point the regex
 * fires, and `DIRLIGHT$2` reads `DIRLIGHT0`, `DIRLIGHT1`, etc. — nothing
 * rides through a later unroll. The `\{X\}` alternative in the pattern
 * exists only so `FOLIAGE_LIGHT_INJECTION_POINT`'s own anchor test can match
 * the un-unrolled shader-store text directly (which still reads
 * `diffuse{X}.rgb`), not because it ever matches in a compiled shader. The
 * pattern matches every directional/point/spot light's diffuse line and
 * captures both the light colour expression and its digit. Hemispheric
 * lights and the translucency variants have different tails and are left
 * alone.
 *
 * Every line the pattern matches gets the same text, and the preprocessor
 * resolves each light's type defines only after the injection, so the text
 * carries its own conditional and Babylon's own line is the other branch.
 * Two defines select the foliage call:
 *
 * - `DIRLIGHT$2`: the call is compiled into the directional light's line and
 *   no other, whatever order the lights were made in. The sun is the scene's
 *   only `DirectionalLight` (lighting.ts), and in the game it is not light 0:
 *   the local headlamp, a spot light, is made before it (renderer.ts). The
 *   headlamps and any other light keep Babylon's own diffuse. This is the key
 *   the terrain's far-cover sun line uses (`TERRAIN_SUN_INJECTION_CODE`).
 * - `FOLIAGE`: the call reads `vFoliageH`, which the Foliage plugin declares
 *   under `#ifdef FOLIAGE`. The guard is not decoration: Babylon processes an
 *   effect's source again on a mesh's first draw with a vertex buffer not of
 *   floats (`checkNonFloatVertexBuffers`), and that late pass reads the
 *   plugin manager's plugins of that moment, not of the effect's compile. An
 *   effect compiled before this plugin attached — its defines without
 *   `FOLIAGE` — reprocessed after, took the call without the declaration,
 *   and the whole engine fell to WebGL2 over one transient shader. Guarded,
 *   that pass compiles to the line Babylon would have made.
 */
export const FOLIAGE_LIGHT_INJECTION_POINT =
  "!info\\.diffuse=computeDiffuseLighting\\(preInfo,(diffuse(\\d+|\\{X\\})\\.rgb)\\);";
const FOLIAGE_LIGHT_INJECTION_CODE =
  "#if defined(FOLIAGE) && defined(DIRLIGHT$2)\n" +
  "info.diffuse=foliageDiffuseLighting(preInfo,$1,vFoliageH,viewDirectionW);\n" +
  "#else\n" +
  "info.diffuse=computeDiffuseLighting(preInfo,$1);\n" +
  "#endif";

/**
 * The line that applies a light's cast shadow to its diffuse, once per
 * light after the shadow is read. On foliage the shadow is held at
 * `FOLIAGE_SHADOW_FLOOR` or above: the cover's own shade (its root
 * darkening, its cards' dark pixels, the canopy's cut) stacks on the
 * generator's darkness, and the stack went to black. The line has no light
 * index, so the floor is every light's; only the sun casts shadows. The
 * lines after it in the include (the specular's among them) read the held
 * value too. Under `FOLIAGE` for the reason the diffuse call is: an effect
 * processed without the define keeps Babylon's line alone.
 */
export const FOLIAGE_SHADOW_INJECTION_POINT = "!diffuseBase\\+=info\\.diffuse\\*shadow;";
const FOLIAGE_SHADOW_INJECTION_CODE =
  "#ifdef FOLIAGE\n" +
  `shadow=max(shadow,${FOLIAGE_SHADOW_FLOOR.toFixed(2)});\n` +
  "#endif\n" +
  "diffuseBase+=info.diffuse*shadow;";

class FoliageLightPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "FoliageLight", 210, undefined, true, true);
  }

  override getClassName(): string {
    return "FoliageLightPlugin";
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: diffuseFragment,
      [FOLIAGE_LIGHT_INJECTION_POINT]: FOLIAGE_LIGHT_INJECTION_CODE,
      [FOLIAGE_SHADOW_INJECTION_POINT]: FOLIAGE_SHADOW_INJECTION_CODE,
    };
  }
}

/**
 * Attach the plugin to one material. Returns early unless the material
 * already carries the Foliage plugin — the injected code reads `vFoliageH`,
 * which only that plugin's shader declares. Idempotent by name
 * `"FoliageLight"`.
 */
export function attachFoliageLight(material: Material): void {
  if (!material.pluginManager?.getPlugin("Foliage")) return;
  if (material.pluginManager.getPlugin("FoliageLight")) return;
  new FoliageLightPlugin(material);
}
