/**
 * The moss plugin: a layer of moss over a trunk's bark, on the wet side, low
 * on the trunk, more on some trees than others. On every bark material the
 * forest dresses (`forestMeshes.ts`): the giants' three LODs, the pine's
 * second set, the saplings and the alder, and the billboards' bake clones.
 * Never the crowns, the snag (which keeps its file's bark and its own moss,
 * `nurseLog.ts`) or the billboards' own material. Renderer-only: nothing here
 * may migrate into sim/ or a tunables registry. The constants live in
 * `mossParams.ts`, Babylon-free, and the GLSL in shaders/moss*.fx so
 * shaderHygiene.test.ts covers it.
 *
 * One texture, the moss colour map, loaded once by the forest and shared by
 * every material's plugin (the plugin never disposes it: the forest does,
 * with its bark maps). One varying, `vMoss`, a vec2: the vertex's height
 * above the tree's foot in the model's metres and the tree's draw, hashed
 * from its foot. One sampler, `mossSampler`. No uniform: every constant is
 * a literal in the shader, so the UBO list is empty and the sampler is
 * declared in the fragment definitions, which both declaration paths reach.
 *
 * Injection points: CUSTOM_VERTEX_DEFINITIONS (the varying, the hash) and
 * CUSTOM_VERTEX_MAIN_END (the varying written, after the vertex is placed);
 * CUSTOM_FRAGMENT_DEFINITIONS (the varying, the sampler, the constants),
 * CUSTOM_FRAGMENT_BEFORE_LIGHTS (the mask and the albedo, where
 * `surfaceAlbedo` is the bark's colour and no light has run) and the
 * roughness, below.
 *
 * The roughness is set before Babylon's own roughness line and not on it:
 * the wet plugin rewrites that line (`WET_ROUGHNESS_ANCHOR`, wetPlugin.ts),
 * and the plugin manager concatenates every plugin's code for one point, so
 * a second rewrite of the same line would declare `roughness` twice on a
 * trunk, which wears both. The anchor here is the statement before it on
 * the same line of pbr.fragment, `float microSurface=reflectivityOut.microSurface;`,
 * re-emitted after the moss writes its roughness into `reflectivityOut`
 * under `MOSS`: Babylon's line, or the wet plugin's rewrite of it, then
 * reads the mossed roughness, so a wet trunk glosses over its moss as it
 * does over its bark. The code begins with a newline, since the anchor sits
 * mid-line and a directive must begin its own. Under `MOSS` for the reason
 * foliageLightPlugin.ts records: an effect processed again without the
 * define keeps Babylon's line alone.
 *
 * Priority 215: after the foliage plugin (200), whose colour block the
 * trunks also wear at the tree profile, and before the wet plugin (240),
 * whose darkening then wets the moss with the bark.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import vertexDefs from "./shaders/moss.vertex.fx?raw";
import vertexFoot from "./shaders/mossFoot.vertex.fx?raw";
import fragmentDefs from "./shaders/moss.fragment.fx?raw";
import fragmentLights from "./shaders/mossLights.fragment.fx?raw";

/** The statement before Babylon's roughness line on the same line of
 * pbr.fragment, matched once; a test pins it against the installed engine. */
export const MOSS_ROUGHNESS_INJECTION_POINT = "!float microSurface=reflectivityOut\\.microSurface;";
/** The moss's roughness written into the reflectivity block's output, then
 * Babylon's statement as it was. */
export const MOSS_ROUGHNESS_INJECTION_CODE =
  "\n#ifdef MOSS\n" +
  "reflectivityOut.roughness=mix(reflectivityOut.roughness,MOSS_ROUGHNESS,mossW);\n" +
  "#endif\n" +
  "float microSurface=reflectivityOut.microSurface;";

/** The sampler the plugin declares and binds. */
export const MOSS_SAMPLER = "mossSampler";

export class MossPlugin extends MaterialPluginBase {
  /** The moss colour map, the forest's: shared by every plugin, never
   * disposed here. */
  readonly texture: BaseTexture;

  constructor(material: Material, texture: BaseTexture) {
    super(material, "Moss", 215, { MOSS: false });
    this.texture = texture;
    this._enable(true);
  }

  override getClassName(): string {
    return "MossPlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.MOSS = true;
  }

  /** The material waits for the map as it waits for its own: a trunk drawn
   * before the moss landed would sample nothing. The forest loads the map
   * before any tree, so this never holds a trunk in practice. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): boolean {
    return this.texture.isReadyOrNotBlocking();
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(MOSS_SAMPLER);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
    // No scalar uniform: the constants are literals in the shader, and the
    // sampler is declared in the fragment definitions (moss.fragment.fx).
    return { ubo: [], vertex: "", fragment: "" };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.setTexture(MOSS_SAMPLER, this.texture);
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this.texture);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.texture;
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_MAIN_END: vertexFoot };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
        [MOSS_ROUGHNESS_INJECTION_POINT]: MOSS_ROUGHNESS_INJECTION_CODE,
      };
    }
    return null;
  }
}

/** Attach once per material with the forest's moss map; later calls are
 * no-ops (LOD buckets share materials). */
export function attachMoss(material: Material, texture: BaseTexture): void {
  if (material.pluginManager?.getPlugin("Moss")) return;
  new MossPlugin(material, texture);
}
