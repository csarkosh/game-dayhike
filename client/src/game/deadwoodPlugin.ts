/**
 * The deadwood plugin: the dead trees' dressing, on the one material
 * `deadwood.snag` loads with, which draws a fallen log lying as the model is
 * authored and a standing snag stood up by its instance matrix. Three things
 * the trunks have that the file's own small map could not give a trunk nine
 * to fourteen metres long: a trunk bark set (`barkParams.ts`) laid along the
 * trunk and round it in the set's own metres at the instance's scale, a
 * whole number of tiles round so the seam closes, written over the material's
 * own texture coordinates in the vertex stage; the trunks' moss, on a log's
 * upper side by the world normal and down a snag's wet side low on the trunk
 * as the moss plugin lays it on a standing trunk, which the role attribute
 * tells apart; and a contact band, the bark darkened toward a log's underside
 * where it meets the floor. Never on a living trunk: those wear the moss
 * plugin, whose mask and constants this one shares (`mossParams.ts`), and
 * the two never meet on one material. Renderer-only.
 *
 * One attribute, `deadwoodRole`, per thin instance: 0 a snag, 1 a log,
 * written by the forest with the bucket's matrices. One varying, `vDeadwood`:
 * the role, the height over the snag's base (m), the model's own y and the
 * foot's hash. One sampler, the forest's moss map, shared as the moss
 * plugin shares it. Two uniforms, `deadwoodBark` (the set's repeats a metre
 * along and round, the trunk's radius, the snag's base along the model's x)
 * and `deadwoodAxis` (where the trunk's axis runs through the model's y and
 * z), on both uniform paths.
 *
 * Injection points: CUSTOM_VERTEX_DEFINITIONS and CUSTOM_VERTEX_MAIN_END (the
 * coordinates and the varying, after the vertex is placed, so `finalWorld`
 * carries the instance), CUSTOM_FRAGMENT_DEFINITIONS and
 * CUSTOM_FRAGMENT_BEFORE_LIGHTS, and the roughness anchor the moss plugin
 * uses, re-emitting Babylon's line after the moss's roughness, for the
 * reason that file records. Priority 215, the moss plugin's.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { BARK_FOOTPRINT } from "./barkParams.js";
import { DEADWOOD_AXIS, DEADWOOD_BARK, DEADWOOD_RADIUS } from "./deadwoodParams.js";
import { MOSS_ROUGHNESS_INJECTION_POINT } from "./mossPlugin.js";
import vertexDefs from "./shaders/deadwood.vertex.fx?raw";
import vertexUv from "./shaders/deadwoodUv.vertex.fx?raw";
import fragmentDefs from "./shaders/deadwood.fragment.fx?raw";
import fragmentLights from "./shaders/deadwoodLights.fragment.fx?raw";

/** The moss's roughness written into the reflectivity block's output under
 * this plugin's define, then Babylon's statement as it was. */
export const DEADWOOD_ROUGHNESS_INJECTION_CODE =
  "\n#ifdef DEADWOOD\n" +
  "reflectivityOut.roughness=mix(reflectivityOut.roughness,MOSS_ROUGHNESS,mossW);\n" +
  "#endif\n" +
  "float microSurface=reflectivityOut.microSurface;";
/** The sampler the plugin declares and binds: the moss plugin's name, so one
 * map serves both. */
export const DEADWOOD_MOSS_SAMPLER = "mossSampler";
/** The per-instance role attribute: 0 a standing snag, 1 a fallen log. */
export const DEADWOOD_ROLE_ATTRIBUTE = "deadwoodRole";

export class DeadwoodPlugin extends MaterialPluginBase {
  /** The moss colour map, the forest's: never disposed here. */
  readonly texture: BaseTexture;
  /** The snag's base along the model's x (m at scale 1), measured from the
   * loaded geometry by the forest: the height the moss band reads from. */
  base = 0;

  constructor(material: Material, texture: BaseTexture) {
    super(material, "Deadwood", 215, { DEADWOOD: false });
    this.texture = texture;
    this._enable(true);
  }

  override getClassName(): string {
    return "DeadwoodPlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.DEADWOOD = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override isReadyForSubMesh(_defines: MaterialDefines, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): boolean {
    return this.texture.isReadyOrNotBlocking();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push(DEADWOOD_ROLE_ATTRIBUTE);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(DEADWOOD_MOSS_SAMPLER);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
    return {
      ubo: [
        { name: "deadwoodBark", size: 4, type: "vec4" },
        { name: "deadwoodAxis", size: 2, type: "vec2" },
      ],
      vertex: "uniform vec4 deadwoodBark;\nuniform vec2 deadwoodAxis;",
      fragment: "",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const footprint = BARK_FOOTPRINT[DEADWOOD_BARK.set];
    uniformBuffer.updateFloat4("deadwoodBark", 1 / footprint.height, 1 / footprint.width, DEADWOOD_RADIUS, this.base);
    uniformBuffer.updateFloat2("deadwoodAxis", DEADWOOD_AXIS.y, DEADWOOD_AXIS.z);
    uniformBuffer.setTexture(DEADWOOD_MOSS_SAMPLER, this.texture);
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this.texture);
  }

  override hasTexture(texture: BaseTexture): boolean {
    return texture === this.texture;
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_MAIN_END: vertexUv };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
        [MOSS_ROUGHNESS_INJECTION_POINT]: DEADWOOD_ROUGHNESS_INJECTION_CODE,
      };
    }
    return null;
  }
}

/** Attach once per material with the forest's moss map; later calls return
 * the plugin already there. The material must carry an albedo map: the moss
 * samples at the bark's coordinates, and the block compiles only where Babylon
 * declares them. */
export function attachDeadwood(material: Material, texture: BaseTexture): DeadwoodPlugin {
  const had = material.pluginManager?.getPlugin("Deadwood");
  if (had instanceof DeadwoodPlugin) return had;
  return new DeadwoodPlugin(material, texture);
}
