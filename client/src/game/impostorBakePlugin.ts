/**
 * The impostor bake plugin (2026-10-15): on the bake clones' materials alone,
 * never on a material the scene draws. A billboard used to be its species
 * lit at bake time and lit again, live, on a flat card: a crown lit twice,
 * dark under any sun, and the far forest the black cut-outs the far field
 * opened with. The plugin writes the bake's two pictures instead of the lit
 * colour, at `CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR`, by `bakeMode`:
 *
 * - 1, the albedo: the surface's own colour after its maps, in gamma space
 *   as a colour map is stored, with the alpha the material's test left;
 * - 2, the normal: the shaded normal in the bake camera's view, written as a
 *   tangent-space map of the card. The bake camera looks along world +Z with
 *   +Y up and no roll (`defaultBakeImpostor`), so its view frame is the
 *   world's and the world normal serves (the fragment declares no view
 *   matrix on WebGL2); a surface facing it has the normal (0, 0, −1). The
 *   card's own frame is +X right, +Y up and −Z out (Babylon's plane faces
 *   −Z and the forest turns that face to the camera), so the map is
 *   (x, y, −z) mapped onto 0 to 1.
 *
 * The card then lights the albedo once, live, through the normal: the crown's
 * top takes the sun and its underside the shade, as the near trees do.
 * Anything else, 0, leaves Babylon's colour alone. Renderer-only.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";

/** Which picture the bake writes: 0 Babylon's lit colour, 1 the albedo, 2 the normal. */
export type ImpostorBakeMode = 0 | 1 | 2;

/** The plugin's one uniform, on both uniform paths. */
export const IMPOSTOR_BAKE_UNIFORM = "bakeMode";

/** The fragment's tail: the two pictures, under the plugin's define.
 * `surfaceAlbedo`, `alpha` and `normalW` are Babylon's own, in scope where
 * the hook lands. */
export const IMPOSTOR_BAKE_FRAGMENT =
  "\n#ifdef IMPOSTORBAKE\n" +
  "if (bakeMode > 1.5) {\n" +
  "vec3 bakeN = normalize(normalW);\n" +
  "finalColor = vec4(vec3(bakeN.x, bakeN.y, -bakeN.z) * 0.5 + 0.5, alpha);\n" +
  "} else if (bakeMode > 0.5) {\n" +
  "finalColor = vec4(toGammaSpace(surfaceAlbedo), alpha);\n" +
  "}\n" +
  "#endif\n";

export class ImpostorBakePlugin extends MaterialPluginBase {
  /** The picture the next render writes. */
  mode: ImpostorBakeMode = 1;

  constructor(material: Material) {
    super(material, "ImpostorBake", 230, { IMPOSTORBAKE: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "ImpostorBakePlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.IMPOSTORBAKE = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
    return {
      ubo: [{ name: IMPOSTOR_BAKE_UNIFORM, size: 1, type: "float" }],
      vertex: "",
      fragment: `uniform float ${IMPOSTOR_BAKE_UNIFORM};`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat(IMPOSTOR_BAKE_UNIFORM, this.mode);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: IMPOSTOR_BAKE_FRAGMENT };
    }
    return null;
  }
}

/** Attach once per material; later calls return the plugin already there. */
export function attachImpostorBake(material: Material): ImpostorBakePlugin {
  const had = material.pluginManager?.getPlugin("ImpostorBake");
  if (had instanceof ImpostorBakePlugin) return had;
  return new ImpostorBakePlugin(material);
}
