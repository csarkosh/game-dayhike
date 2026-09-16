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

/** Mirrored in foliageDiffuse.fragment.fx; the lockstep test asserts it. */
export const FOLIAGE_WRAP = 0.35;

/**
 * Per-light injection. `shaderProcessor.js`'s `ProcessIncludes` expands the
 * `lightFragment` include and unrolls `{X}` into each light's digit (0, 1, …)
 * first; only afterwards does the plugin manager's `_injectCustomCode` run
 * the `!`-prefixed point as a global regex with `$n` substitutions
 * (materialPluginManager.pure.js, `ReplaceRegExpSubstitutions`) over that
 * already-expanded code. So `$2` is a real digit at the point the regex
 * fires, and `float($2)` compiles straight to `float(0)`, `float(1)`, etc. —
 * nothing rides through a later unroll. The `\{X\}` alternative in the
 * pattern exists only so `FOLIAGE_LIGHT_INJECTION_POINT`'s own anchor test
 * can match the un-unrolled shader-store text directly (which still reads
 * `diffuse{X}.rgb`), not because it ever matches in a compiled shader. The
 * pattern matches every directional/point/spot light's diffuse line and
 * captures both the light colour expression and its index. Hemispheric
 * lights and the translucency variants have different tails and are left
 * alone.
 */
export const FOLIAGE_LIGHT_INJECTION_POINT =
  "!info\\.diffuse=computeDiffuseLighting\\(preInfo,(diffuse(\\d+|\\{X\\})\\.rgb)\\);";
const FOLIAGE_LIGHT_INJECTION_CODE =
  "info.diffuse=foliageDiffuseLighting(preInfo,$1,float($2),vFoliageH,viewDirectionW);";

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
