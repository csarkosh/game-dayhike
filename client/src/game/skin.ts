// The injected code needs `REFLECTIVITY` (Babylon gates it on
// `scene.texturesEnabled` and `MaterialFlags.SpecularTextureEnabled` —
// turning either off after attachment is a compile error, not a no-op).
// Babylon's clustered-lighting path (`CLUSTLIGHT{X}`) computes diffuse
// elsewhere and would bypass this plugin silently; neither is used in this
// repo.
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Nullable } from "@babylonjs/core/types.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
// Non-`.pure` import, load-bearing exactly as cel.ts documents: the wrapper
// registers the plugin-manager machinery this module depends on.
import "@babylonjs/core/Materials/materialPluginManager.js";
import skinFragment from "./shaders/skinDiffuse.fragment.fx?raw";
import { SKIN_SCATTER, SKIN_WRAP } from "./skinParams.js";

/**
 * Per-light injection. Babylon's plugin manager applies
 * a `!`-prefixed point as a global regex with `$n` substitutions
 * (materialPluginManager.pure.js, ReplaceRegExpSubstitutions). The pattern
 * matches every directional/point/spot light's diffuse line and captures the
 * light colour expression (`diffuse{X}.rgb` before index substitution).
 * Hemispheric lights and the translucency variants have different tails and
 * are left alone. `surfaceMetallicOrReflectivityColorMap` is the main-scope
 * MR sample — it exists only on MR-textured materials, which is why this
 * plugin is attached per material, never registered globally.
 */
// `(?:\\d+|\\{X\\})`: at compile time the light index is a digit; the shader
// store's include still reads `{X}`, and the anchor test matches that text.
export const SKIN_INJECTION_POINT =
  "!info\\.diffuse=computeDiffuseLighting\\(preInfo,(diffuse(?:\\d+|\\{X\\})\\.rgb)\\);";
const SKIN_INJECTION_CODE =
  "info.diffuse=skinDiffuseLighting(preInfo,$1,surfaceMetallicOrReflectivityColorMap.r);";

// Module-level like cel.ts: every material's plugin instance reads one truth.
let skinEnabled = true;
let skinWrap = SKIN_WRAP;
let skinScatter = SKIN_SCATTER;

class SkinShadingPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priority 210: after Babylon's own plugins and after cel (200); the two
    // touch different points and compose regardless.
    super(material, "SkinShading", 210, undefined, true, true);
  }

  override getClassName(): string {
    return "SkinShadingPlugin";
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    fragment: string;
  } {
    return {
      ubo: [
        { name: "skinOn", size: 1, type: "float" },
        { name: "skinWrap", size: 1, type: "float" },
        { name: "skinScatter", size: 1, type: "float" },
      ],
      fragment: "uniform float skinOn;\nuniform float skinWrap;\nuniform float skinScatter;",
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("skinOn", skinEnabled ? 1 : 0);
    uniformBuffer.updateFloat("skinWrap", skinWrap);
    uniformBuffer.updateFloat("skinScatter", skinScatter);
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: skinFragment,
      [SKIN_INJECTION_POINT]: SKIN_INJECTION_CODE,
    };
  }
}

/**
 * Attach the plugin to one material. Only a PBRMaterial with an MR texture
 * qualifies — the injected code reads the MR sample, which the shader only
 * declares under REFLECTIVITY. Returns whether it attached.
 *
 * The decline is silent: both shipped enemies (`enemy.grunt`,
 * `enemy.skeleton`) have no metallicRoughness texture, so this is the
 * expected case on every game load, not a fault to surface. `attachSkinShading`
 * returning `false` is the only signal when an attachment is expected and
 * did not happen.
 */
export function attachSkinShading(material: Material): boolean {
  if (!(material instanceof PBRMaterial) || !material.metallicTexture) {
    return false;
  }
  if (material.pluginManager?.getPlugin("SkinShading")) return false;
  new SkinShadingPlugin(material);
  return true;
}

/** Attach to every qualifying material in a loaded container; returns the count. */
export function attachSkinToMaterials(materials: readonly Material[]): number {
  let count = 0;
  for (const material of materials) if (attachSkinShading(material)) count += 1;
  return count;
}

export type SkinShading = {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  setWrap(wrap: number): void;
  setScatter(scatter: number): void;
  dispose(): void;
};

/**
 * The controller the renderer and `/skin` use. `scene` is part of the
 * signature for parity with the renderer's other `create*Shading`-style call
 * sites, even though the module-level state does not need it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createSkinShading(_scene: Scene): SkinShading {
  skinEnabled = true;
  return {
    get enabled() {
      return skinEnabled;
    },
    setEnabled(on) {
      skinEnabled = on;
    },
    setWrap(wrap) {
      skinWrap = Math.min(1, Math.max(0, wrap));
    },
    setScatter(scatter) {
      skinScatter = Math.min(1, Math.max(0, scatter));
    },
    dispose() {
      // Instances die with their materials when the scene is disposed — the
      // same borrowed-state policy cel.ts and lighting.ts document.
      skinEnabled = true;
      skinWrap = SKIN_WRAP;
      skinScatter = SKIN_SCATTER;
    },
  };
}
