/**
 * The foliage plugin: everything the vertex stage does to a card or a crown
 * (lean, gust, flutter, camera tilt, player bend, far sink — or, for the blade
 * clumps, a per-blade collapse to the root across the band in place of the
 * sink) and everything
 * the fragment stage does to ground it (the cards' contrast compressed
 * toward the cover's green, root darkening, ground tint, clump variation, a
 * rounded normal, and the canopy's cut of the sky). Replaces
 * windPlugin.ts. The wind arrives as one WindRecord per frame through
 * `setFoliageWind`, computed by windParams.ts; the ground colour and the
 * openness of the sky above the instance arrive as the per-instance `foliage`
 * attribute clutterMeshes.ts writes. Renderer-only: nothing here may migrate
 * into sim/ or a tunables registry.
 *
 * The canopy's cut is two terms, each its own share of the light the canopy
 * takes from a card under full density, both read from the openness in
 * `foliage.a` (`1 − ρ`, ρ the forest density, 1 in the open): the sky's
 * (`FOLIAGE_CANOPY_SKY`, on the probe's irradiance and reflection at the
 * final colour composition, shaders/foliageSky.fragment.fx) and the sun's
 * (`FOLIAGE_CANOPY_SUN`, on the sun's diffuse in foliageLightPlugin.ts's
 * shader, through the `foliageCanopySun` uniform, which is the constant for a
 * material whose meshes receive no cast shadow and 0 for one whose meshes do,
 * the blade clumps, the duff and the reeds: the cast shadow cuts those
 * already). The hemispheric fill is untouched.
 *
 * Injection points: CUSTOM_VERTEX_DEFINITIONS + CUSTOM_VERTEX_UPDATE_WORLDPOS
 * (after the thin-instance matrix, so finalWorld[3] is the instance origin)
 * and CUSTOM_FRAGMENT_DEFINITIONS + CUSTOM_FRAGMENT_BEFORE_LIGHTS +
 * CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION. The GLSL lives in
 * shaders/foliage*.fx so shaderHygiene.test.ts covers it.
 *
 * `edges` lives on the plugin instance, so it is per MATERIAL, not per LOD
 * bucket: a card GLB whose two LOD buckets share one material gets ONE edge
 * pair. The shell sets the far bucket's edges — the near bucket's sink then
 * starts at the same disc edge too, which is past its own seam and therefore
 * harmless.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import vertexDefs from "./shaders/foliage.vertex.fx?raw";
import vertexWorldPos from "./shaders/foliageWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/foliage.fragment.fx?raw";
import fragmentLights from "./shaders/foliageLights.fragment.fx?raw";
import fragmentSky from "./shaders/foliageSky.fragment.fx?raw";
import { BLADE_SOFT } from "./bladeClump.js";
import type { BladeEdges } from "./bladeField.js";
import {
  FOLIAGE_PLAYERS, emptyFoliageUniforms, foliageLook, foliageMatched, foliageUniforms,
  type FoliageLook, type FoliageOptions, type FoliageProfile,
} from "./foliageUniforms.js";

// The constants, the profiles, the cover matched to the ground, the frame's
// wind and the uniforms a foliage material is drawn with are
// `foliageUniforms.ts`'s, which loads no engine; named from here too.
export * from "./foliageUniforms.js";

/** The per-blade shrink window; lives in bladeClump.ts, mirrored in foliageWorldPos.vertex.fx. */
export { BLADE_SOFT as FOLIAGE_BLADE_SOFT };

/** The uniforms of the bind under way (`foliageUniforms`), filled again at each: one record for every plugin. */
const bound = emptyFoliageUniforms();

export class FoliagePlugin extends MaterialPluginBase {
  /** The material's own numbers (`foliageLook`): the shell sets its edges. */
  readonly look: FoliageLook;

  constructor(material: Material, profile: FoliageProfile, meshHeight: number, options: FoliageOptions) {
    super(material, "Foliage", 200, { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false, FOLIAGE_MATCH: false });
    this.look = foliageLook(material.name, profile, meshHeight, options);
    // Matched cover is lit as the ground: the cast shadow carries the
    // canopy's cut, and nothing glints on it.
    if (foliageMatched(material, profile)) {
      const pbr = material as Material & { metallicF0Factor?: number };
      if (pbr.metallicF0Factor !== undefined) pbr.metallicF0Factor = 0;
    }
    this._enable(true);
  }

  /** The `foliageCanopySun` uniform's value: `FOLIAGE_CANOPY_SUN`, or 0 for
   * a material whose meshes receive cast shadows. */
  get canopySun(): number {
    return this.look.canopySun;
  }

  /** The `foliageContrast` uniform's value: the share of the texture kept
   * over the cover's green, 1 for a material whose texture is left as it is. */
  get contrast(): number {
    return this.look.contrast;
  }

  /** Outer fade of the bucket, set by the shell; motion reaches zero at .y. */
  get edges(): readonly [number, number] {
    return this.look.edges;
  }

  set edges(edges: readonly [number, number]) {
    this.look.edges = edges;
  }

  /** The blades profile's hand-off: (grow-in start, grow-in end, collapse
   * start, collapse end) in metres from the eye. The default grows nowhere
   * and collapses nowhere: every blade whole. */
  get bladeEdges(): BladeEdges {
    return this.look.bladeEdges;
  }

  set bladeEdges(edges: BladeEdges) {
    this.look.bladeEdges = edges;
  }

  override getClassName(): string {
    return "FoliagePlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.FOLIAGE = true;
    defines.FOLIAGE_TINT = this.look.profile.groundTint > 0;
    defines.FOLIAGE_BLADES = this.look.profile.blades;
    defines.FOLIAGE_MATCH = foliageMatched(this._material, this.look.profile);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    if (this.look.profile.groundTint > 0) attributes.push("foliage");
    if (this.look.profile.blades) attributes.push("blade");
    if (this.look.profile.blades) attributes.push("bladeStrength");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string; arraySize?: number }[]; vertex: string; fragment: string } {
    return {
      ubo: [
        { name: "windDir", size: 2, type: "vec2" },
        { name: "windLean", size: 1, type: "float" },
        { name: "windGust", size: 1, type: "float" },
        { name: "windFlutter", size: 1, type: "float" },
        { name: "windTime", size: 1, type: "float" },
        { name: "windEye", size: 3, type: "vec3" },
        { name: "windPlayers", size: 3, type: "vec3", arraySize: FOLIAGE_PLAYERS },
        { name: "foliageAmp", size: 1, type: "float" },
        { name: "foliageHeight", size: 1, type: "float" },
        { name: "foliageTint", size: 1, type: "float" },
        { name: "foliageRootAO", size: 1, type: "float" },
        { name: "foliageCanopySun", size: 1, type: "float" },
        { name: "foliageContrast", size: 1, type: "float" },
        { name: "foliageNormalRoot", size: 1, type: "float" },
        { name: "foliageNormalUp", size: 1, type: "float" },
        { name: "foliageFlags", size: 2, type: "vec2" },
        { name: "foliageEdges", size: 2, type: "vec2" },
        { name: "foliageBladeEdges", size: 4, type: "vec4" },
      ],
      vertex: `
#ifdef FOLIAGE
uniform vec2 windDir;
uniform float windLean;
uniform float windGust;
uniform float windFlutter;
uniform float windTime;
uniform vec3 windEye;
uniform vec3 windPlayers[5];
uniform float foliageAmp;
uniform float foliageHeight;
uniform float foliageNormalUp;
uniform vec2 foliageFlags;
uniform vec2 foliageEdges;
uniform vec4 foliageBladeEdges;
#endif
`,
      fragment: `
#ifdef FOLIAGE
uniform float foliageTint;
uniform float foliageRootAO;
uniform float foliageCanopySun;
uniform float foliageContrast;
uniform float foliageNormalRoot;
#endif
`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const u = foliageUniforms(this.look, scene.activeCamera?.globalPosition, bound);
    uniformBuffer.updateFloat2("windDir", u.windDir[0], u.windDir[1]);
    uniformBuffer.updateFloat("windLean", u.windLean[0]);
    uniformBuffer.updateFloat("windGust", u.windGust[0]);
    uniformBuffer.updateFloat("windFlutter", u.windFlutter[0]);
    uniformBuffer.updateFloat("windTime", u.windTime[0]);
    uniformBuffer.updateFloat3("windEye", u.windEye[0], u.windEye[1], u.windEye[2]);
    uniformBuffer.updateFloatArray("windPlayers", u.windPlayers);
    uniformBuffer.updateFloat("foliageAmp", u.foliageAmp[0]);
    uniformBuffer.updateFloat("foliageHeight", u.foliageHeight[0]);
    uniformBuffer.updateFloat("foliageTint", u.foliageTint[0]);
    uniformBuffer.updateFloat("foliageRootAO", u.foliageRootAO[0]);
    uniformBuffer.updateFloat("foliageCanopySun", u.foliageCanopySun[0]);
    uniformBuffer.updateFloat("foliageContrast", u.foliageContrast[0]);
    uniformBuffer.updateFloat("foliageNormalRoot", u.foliageNormalRoot[0]);
    uniformBuffer.updateFloat("foliageNormalUp", u.foliageNormalUp[0]);
    uniformBuffer.updateFloat2("foliageFlags", u.foliageFlags[0], u.foliageFlags[1]);
    uniformBuffer.updateFloat2("foliageEdges", u.foliageEdges[0], u.foliageEdges[1]);
    uniformBuffer.updateFloat4("foliageBladeEdges", u.foliageBladeEdges[0], u.foliageBladeEdges[1], u.foliageBladeEdges[2], u.foliageBladeEdges[3]);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: fragmentSky,
      };
    }
    return null;
  }
}

/** Attach once per material; later calls are no-ops (LOD buckets share
 * materials). The caller says whether the material's meshes receive cast
 * shadows (`sunShadowed`): the canopy's cut of the sun is then the shadow's
 * and the uniform binds 0, otherwise `FOLIAGE_CANOPY_SUN`. It says too how
 * much of the texture's contrast the material keeps (`contrast`, 1 unless
 * given). */
export function attachFoliage(material: Material, profile: FoliageProfile, meshHeight: number, options: FoliageOptions = {}): void {
  if (material.pluginManager?.getPlugin("Foliage")) return;
  new FoliagePlugin(material, profile, meshHeight, options);
}

/** The bucket's outer fade: motion weight reaches zero at `edges[1]`, and tinting
 * profiles sink across it. Materials without the plugin are ignored. */
export function setFoliageEdges(material: Material, edges: readonly [number, number]): void {
  const plugin = material.pluginManager?.getPlugin("Foliage") as FoliagePlugin | undefined;
  if (plugin) plugin.edges = edges;
}

/** The blade tier's hand-off band: four edges like `fadeBands`. Materials
 * without the plugin are ignored. */
export function setFoliageBladeEdges(material: Material, edges: BladeEdges): void {
  const plugin = material.pluginManager?.getPlugin("Foliage") as FoliagePlugin | undefined;
  if (plugin) plugin.bladeEdges = edges;
}
