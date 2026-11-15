/**
 * The cliff tint plugin: one thing only — mix a module's albedo halfway
 * toward the ground colour under it, read from the per-instance `foliage`
 * attribute the cliff shell writes with `writeFoliage` (clutterMeshes.ts),
 * so a brown granite module and a pale cobble hillside read as one
 * material. Fragment-only in effect; the vertex stage just carries the
 * attribute across. Not the foliage plugin, whose vertex stage is wind,
 * lean and collapse for cards — a wall wants none of that. Renderer-only:
 * nothing here may migrate into sim/. The GLSL lives in shaders/cliffTint*.fx
 * so shaderHygiene.test.ts covers it.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import vertexDefs from "./shaders/cliffTint.vertex.fx?raw";
import vertexWorldPos from "./shaders/cliffTintWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/cliffTint.fragment.fx?raw";
import fragmentLights from "./shaders/cliffTintLights.fragment.fx?raw";

// The share of the ground's albedo in a module's colour is
// `cliffInstances.ts`'s, which loads no engine; named from here too.
export { CLIFF_GROUND_TINT } from "./cliffInstances.js";

export class CliffTintPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // 210: after the foliage plugin's 200 and the fade's 205. The far LOD
    // bucket's material carries this and the fade together (cliffMeshes.ts),
    // so that ordering is real and not hypothetical; the priorities are
    // fixed, so the two always splice in the same order.
    super(material, "CliffTint", 210, { CLIFFTINT: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "CliffTintPlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.CLIFFTINT = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("foliage");
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs, CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights };
    }
    return null;
  }
}

/** Attach once per material; later calls are no-ops (LOD buckets share materials). */
export function attachCliffTint(material: Material): void {
  if (material.pluginManager?.getPlugin("CliffTint")) return;
  new CliffTintPlugin(material);
}
