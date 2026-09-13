import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Nullable } from "@babylonjs/core/types.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
// Non-`.pure` import, load-bearing exactly as documented in lighting.ts: the
// wrapper registers the plugin-manager machinery this module depends on.
import {
  RegisterMaterialPlugin,
  UnregisterMaterialPlugin,
} from "@babylonjs/core/Materials/materialPluginManager.js";
import celBandFragment from "./shaders/celBand.fragment.fx?raw";

/** Module-level so every material's plugin instance reads one source of truth.
 * A second renderer in one process would share it — acceptable for the spike
 * and stated here rather than hidden. */
let celEnabled = false;

/**
 * Bands the PBR direct-diffuse accumulator: the injected code is gated by the
 * `celOn` UNIFORM, not a define, because plugin custom code is applied by
 * processFinalCode AFTER the string preprocessor has resolved every
 * conditional (effect.functions.js:79-88) — an injected define-gate would
 * silently compile out. The uniform gate also makes `/style` instant: no
 * shader recompile on toggle, just a different float next frame.
 */
class CelShadingPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priority 200 (after Babylon's own plugins); no defines; enable
    // immediately — the uniform decides whether the code acts.
    super(material, "CelShading", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "CelShadingPlugin";
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    fragment: string;
  } {
    return {
      ubo: [{ name: "celOn", size: 1, type: "float" }],
      fragment: "uniform float celOn;",
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("celOn", celEnabled ? 1 : 0);
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: celBandFragment,
      // Regex point (leading `!`), matched against POST-include-expansion
      // code: `aggShadow=aggShadow/numLights;` is the first, unconditional
      // statement of pbrBlockFinalLitComponents, which runs after every
      // light has accumulated into diffuseBase and before the albedo fold —
      // band the light, keep the paint. Unlit materials never contain the
      // line, so they are skipped by construction.
      "!aggShadow=aggShadow/numLights;":
        "diffuseBase=celBand(diffuseBase,celOn);aggShadow=aggShadow/numLights;",
    };
  }
}

export type CelShading = {
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  dispose(): void;
};

/**
 * Registers the plugin factory. MUST run before any PBR material exists —
 * createRenderer calls it immediately after constructing the Scene — because
 * RegisterMaterialPlugin only reaches materials created afterwards. The
 * factory declines non-PBR materials (sky, particles) by returning null.
 */
// `scene` is part of the required signature (renderer.ts's call site) even
// though the module-level `celEnabled` flag does not need it;
// TS's own noUnusedParameters already exempts the leading underscore, only
// this project's eslint config (tseslint recommended, no argsIgnorePattern)
// does not.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createCelShading(_scene: Scene): CelShading {
  RegisterMaterialPlugin("CelShading", (material) =>
    material instanceof PBRMaterial ? new CelShadingPlugin(material) : null,
  );
  return {
    get enabled() {
      return celEnabled;
    },
    setEnabled(on) {
      celEnabled = on;
    },
    dispose() {
      // Unregistering stops FUTURE materials receiving the plugin; instances
      // already attached die with their materials when the renderer disposes
      // the whole scene — the same borrowed-state policy lighting.ts documents.
      UnregisterMaterialPlugin("CelShading");
      celEnabled = false;
    },
  };
}
