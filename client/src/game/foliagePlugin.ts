/**
 * The foliage plugin: everything the vertex stage does to a card or a crown
 * (lean, gust, flutter, camera tilt, player bend, far sink — or, for the blade
 * clumps, a per-blade collapse to the root across the band in place of the
 * sink) and everything
 * the fragment stage does to ground it (root darkening, ground tint, clump
 * variation, a rounded normal, and the canopy's cut of the sky). Replaces
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
 * material whose meshes receive no cast shadow and 0 for one whose meshes do:
 * the cast shadow cuts those already). The hemispheric fill is untouched.
 *
 * Injection points: CUSTOM_VERTEX_DEFINITIONS + CUSTOM_VERTEX_UPDATE_WORLDPOS
 * (after the thin-instance matrix, so finalWorld[3] is the instance origin)
 * and CUSTOM_FRAGMENT_DEFINITIONS + CUSTOM_FRAGMENT_BEFORE_LIGHTS +
 * CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION. The GLSL lives in
 * shaders/foliage*.fx so shaderHygiene.test.ts covers it.
 *
 * `edges` lives on the plugin instance, so it is per MATERIAL, not per LOD
 * bucket: a card GLB whose two LOD buckets share one material gets ONE edge
 * pair. Task 3 sets the far bucket's edges — the near bucket's sink then
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
import type { WindRecord } from "./windParams.js";
import { FADE_NONE_IN, FADE_NONE_OUT } from "./distanceFadePlugin.js";
import { BLADE_SOFT } from "./bladeClump.js";
import type { BladeEdges } from "./bladeField.js";

/** Mirrored in the .fx files; the lockstep test asserts it. */
export const FOLIAGE_TILT = 0.04;
export const FOLIAGE_BEND = 0.25;
export const FOLIAGE_BEND_R = 0.6;
export const FOLIAGE_SINK = 0.5;
export const FOLIAGE_CLUMP_LUMA = 0.16;
export const FOLIAGE_CLUMP_CELL = 1.5;
/** The share of the sky's light the canopy takes from a card under full
 * density (foliageSky.fragment.fx). The trees' bark takes 0.65 and their
 * crowns 0.4 (`forestLookParams.ts`); the ground under a canopy sees the sky
 * through the trunks' gaps, less than a crown does, so a little under the
 * crown's cut. */
export const FOLIAGE_CANOPY_SKY = 0.4;
/** The share of the sun's light the canopy takes, under full density, from a
 * card that receives no cast shadow: it stands in for the shadow the trees
 * would cast on it. A shadowed receiver keeps 0.45 of the sun under the
 * "bright" weather (`lighting.ts`); a card is taller than the floor and
 * catches the gaps, so it keeps 0.6. Bound as the `foliageCanopySun` uniform,
 * 0 for a material whose meshes receive cast shadows (`attachFoliage`). */
export const FOLIAGE_CANOPY_SUN = 0.4;
export const FOLIAGE_PLAYERS = 5;
/** XZ magnitude a parked (absent) player slot sits at. The bend reads only
 * `windPlayers[i].xz` (foliageWorldPos.vertex.fx), so a slot parked below the
 * world at this origin's XZ would still be a live bender there — parking has
 * to move the slot's XZ, not its Y. */
export const FOLIAGE_PLAYER_PARKED = 1e6;
/** The per-blade shrink window; lives in bladeClump.ts, mirrored in foliageWorldPos.vertex.fx. */
export { BLADE_SOFT as FOLIAGE_BLADE_SOFT };

export type FoliageProfile = {
  /** Unitless multiplier on the record's fractions (grass 0.06 m of tip = 1). */
  amp: number;
  /** Ground-tint weight at the root; > 0 turns on FOLIAGE_TINT and the attribute. */
  groundTint: number;
  /** Albedo factor at the root. */
  rootAO: number;
  /** Weight of the card's own normal at the root (0 = the ground's up). */
  normalRoot: number;
  tilt: boolean;
  bend: boolean;
  /** The blade clump mesh: the `blade` attribute is declared, each blade
   * shrinks to its root across `edges` in place of the far sink, and the
   * motion weight ignores the edge term. */
  blades: boolean;
  /** World-space up added to `vNormalW` at the hook where it runs (already
   * transformed to world space, not the vertex normal before transform),
   * then the sum renormalised — 1.0 puts a horizontal normal at 45°. Blades
   * only: the blade mesh's own normals lie flat (y = 0), so the bias is what
   * lets a blade take the sun the way the turf under it does; the card
   * models already carry normals of their own, so every card profile keeps
   * this at 0. */
  normalUp: number;
};

export const FOLIAGE_PROFILES = {
  GRASS: { amp: 1.0, groundTint: 0.6, rootAO: 0.6, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
  MEADOW: { amp: 1.0, groundTint: 0.7, rootAO: 0.65, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
  FLOWER: { amp: 0.83, groundTint: 0.4, rootAO: 0.65, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
  BUSH: { amp: 0.5, groundTint: 0.3, rootAO: 0.75, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 0 },
  UNDERSTORY: { amp: 0.67, groundTint: 0.4, rootAO: 0.7, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 0 },
  TREE: { amp: 0.33, groundTint: 0, rootAO: 1, normalRoot: 0.6, tilt: false, bend: false, blades: false, normalUp: 0 },
  BLADES: { amp: 1.0, groundTint: 0.7, rootAO: 0.65, normalRoot: 0, tilt: true, bend: true, blades: true, normalUp: 1.0 },
  /** Reeds and cattails: the blade builder's strips, whose normals lie flat,
   * so the blades' up-bias; no ground tint (their colours are their own), no
   * per-blade cut and no tilt, so the shader variant is the trees'. */
  REEDS: { amp: 0.5, groundTint: 0, rootAO: 0.75, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 1.0 },
  /** Dead leaves, twigs and small branches: no wind (amp 0 — litter does not
   * sway), no tilt or bend, but still the per-piece `blades` cut so a thin
   * cell's clump can lose pieces the way a thin sward loses blades. Ground
   * tint at half, not 0.7: on the mid-brown floor (NEEDLE_BED) half seats the
   * pieces into it, where 0.7 pulled them fully into the ground colour. */
  DUFF: { amp: 0, groundTint: 0.5, rootAO: 0.75, normalRoot: 0, tilt: false, bend: false, blades: true, normalUp: 0.5 },
} as const satisfies Record<string, FoliageProfile>;

// Module-level like skin.ts: every material's plugin instance reads one truth,
// written once per frame by the renderer.
let wind: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
/** 5 × xyz; unused slots parked a thousand kilometres away in XZ, where no
 * origin is within the bend radius. */
const players = new Float32Array(FOLIAGE_PLAYERS * 3);
for (let i = 0; i < FOLIAGE_PLAYERS; i++) {
  players[i * 3] = FOLIAGE_PLAYER_PARKED;
  players[i * 3 + 2] = FOLIAGE_PLAYER_PARKED;
}

/** `positions` is 5 × xyz and replaces the whole array wholesale — it does
 * not merge with the existing parked defaults. A caller with fewer than 5
 * active players must park each absent slot itself, at
 * `(FOLIAGE_PLAYER_PARKED, 0, FOLIAGE_PLAYER_PARKED)`, the same convention
 * this module's own initial state uses. */
export function setFoliageWind(record: WindRecord, positions: Float32Array): void {
  wind = record;
  players.set(positions.subarray(0, FOLIAGE_PLAYERS * 3));
}

/** How `attachFoliage` decides the material's cut of the sun by the canopy. */
export type FoliageOptions = {
  /** The material's meshes receive cast shadows (`receiveShadows`), so the
   * canopy's cut of the sun is theirs already and the uniform binds 0. Off,
   * the uniform binds `FOLIAGE_CANOPY_SUN`. */
  sunShadowed?: boolean;
};

export class FoliagePlugin extends MaterialPluginBase {
  private readonly _profile: FoliageProfile;
  private readonly _meshHeight: number;
  /** The `foliageCanopySun` uniform's value: `FOLIAGE_CANOPY_SUN`, or 0 for
   * a material whose meshes receive cast shadows. */
  readonly canopySun: number;
  /** Outer fade of the bucket, set by the shell; motion reaches zero at .y. */
  edges: readonly [number, number] = FADE_NONE_OUT;
  /** The blades profile's hand-off: (grow-in start, grow-in end, collapse
   * start, collapse end) in metres from the eye. The default grows nowhere
   * and collapses nowhere: every blade whole. */
  bladeEdges: BladeEdges = [FADE_NONE_IN[0], FADE_NONE_IN[1], FADE_NONE_OUT[0], FADE_NONE_OUT[1]];

  constructor(material: Material, profile: FoliageProfile, meshHeight: number, canopySun: number) {
    super(material, "Foliage", 200, { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false });
    this._profile = profile;
    this._meshHeight = meshHeight;
    this.canopySun = canopySun;
    this._enable(true);
  }

  override getClassName(): string {
    return "FoliagePlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.FOLIAGE = true;
    defines.FOLIAGE_TINT = this._profile.groundTint > 0;
    defines.FOLIAGE_BLADES = this._profile.blades;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    if (this._profile.groundTint > 0) attributes.push("foliage");
    if (this._profile.blades) attributes.push("blade");
    if (this._profile.blades) attributes.push("bladeStrength");
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
uniform float foliageNormalRoot;
#endif
`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const p = this._profile;
    const eye = scene.activeCamera?.globalPosition;
    uniformBuffer.updateFloat2("windDir", wind.dirX, wind.dirZ);
    uniformBuffer.updateFloat("windLean", wind.lean);
    uniformBuffer.updateFloat("windGust", wind.gustAmp);
    uniformBuffer.updateFloat("windFlutter", wind.flutterAmp);
    uniformBuffer.updateFloat("windTime", wind.time);
    uniformBuffer.updateFloat3("windEye", eye?.x ?? 0, eye?.y ?? 0, eye?.z ?? 0);
    uniformBuffer.updateFloatArray("windPlayers", players);
    uniformBuffer.updateFloat("foliageAmp", p.amp);
    uniformBuffer.updateFloat("foliageHeight", this._meshHeight);
    uniformBuffer.updateFloat("foliageTint", p.groundTint);
    uniformBuffer.updateFloat("foliageRootAO", p.rootAO);
    uniformBuffer.updateFloat("foliageCanopySun", this.canopySun);
    uniformBuffer.updateFloat("foliageNormalRoot", p.normalRoot);
    uniformBuffer.updateFloat("foliageNormalUp", p.normalUp);
    uniformBuffer.updateFloat2("foliageFlags", p.tilt ? 1 : 0, p.bend ? 1 : 0);
    uniformBuffer.updateFloat2("foliageEdges", this.edges[0], this.edges[1]);
    uniformBuffer.updateFloat4("foliageBladeEdges", this.bladeEdges[0], this.bladeEdges[1], this.bladeEdges[2], this.bladeEdges[3]);
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
 * and the uniform binds 0, otherwise `FOLIAGE_CANOPY_SUN`. */
export function attachFoliage(material: Material, profile: FoliageProfile, meshHeight: number, options: FoliageOptions = {}): void {
  if (material.pluginManager?.getPlugin("Foliage")) return;
  new FoliagePlugin(material, profile, meshHeight, options.sunShadowed === true ? 0 : FOLIAGE_CANOPY_SUN);
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
