// client/src/game/waterPlugin.ts
/**
 * The water plugin: PBR with what water is about spliced in (spec §3):
 * per-pixel bed depth from the bed height texture, the waterline, the
 * medium and low tiers' single alpha, the reflected ray held above the
 * horizon, and on the high tier a refracted read of the scene copy with
 * per-channel attenuation. Everything else — the sun's specular, the sky
 * probe, the headlamps, fog, the colour path — is PBR's own. Renderer-only.
 * The GLSL lives in shaders/water*.fx so shaderHygiene.test.ts covers it.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import vertexDefs from "./shaders/water.vertex.fx?raw";
import vertexWorldPos from "./shaders/waterWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/water.fragment.fx?raw";
import fragmentLights from "./shaders/waterLights.fragment.fx?raw";
import fragmentCompose from "./shaders/waterCompose.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";

/** Babylon's dielectric F0 at metallicF0Factor 1 is 0.04; water's 0.02 is half of it. */
const PBR_DIELECTRIC_F0 = 0.04;

export class WaterPlugin extends MaterialPluginBase {
  readonly row: WaterRow;
  /** The bed height square (Task 4 uploads it); null until the first bake. */
  bedTexture: BaseTexture | null = null;
  bedOrigin: [number, number] = [0, 0];
  bedTexels = 256;
  bedSpacing = 1;
  /** High tier only (Task 6): the scene copy and depth read, and the screen's 1/size. */
  sceneTexture: BaseTexture | null = null;
  depthTexture: BaseTexture | null = null;
  screen: [number, number] = [1, 1];
  /** The camera's near and far, per frame: the copy's device depth is linearised with them. */
  nearFar: [number, number] = [0.05, 1000];
  time = 0;
  windDir: [number, number] = [1, 0];
  /** Ripple octaves the fragment blends: 2, or 1 on the low tier (spec §5.3). */
  octaves = 2;

  constructor(material: Material, row: WaterRow) {
    // 230: after the atmosphere's 200 and every look plugin's 205 to 220; the
    // water carries only this and the atmosphere, so the order is fixed.
    super(material, "Water", 230, { WATER: false });
    this.row = row;
    // For hardBindForSubMesh, called on every draw; set before activation,
    // which is when the manager reads it.
    this.registerForExtraEvents = true;
    if (material instanceof PBRMaterial) {
      material.metallic = 0;
      material.metallicF0Factor = WATER_F0 / PBR_DIELECTRIC_F0;
      material.albedoColor = new Color3(row.lInf[0], row.lInf[1], row.lInf[2]);
      material.roughness = roughnessFor(0, row.shelter);
    }
    this._enable(true);
  }

  override getClassName(): string {
    return "WaterPlugin";
  }

  /** Per frame from the renderer's wind record: the game's 0..1 wind and its direction. */
  setWind(wind01: number, dir: [number, number]): void {
    const m = this._material;
    if (m instanceof PBRMaterial) {
      // The setter marks every submesh dirty, and this runs every frame.
      const r = roughnessFor(wind01, this.row.shelter);
      if (m.roughness === null || Math.abs(m.roughness - r) > 1e-3) m.roughness = r;
    }
    this.windDir = dir;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WATER = true;
  }

  override isReadyForSubMesh(): boolean {
    // On the high tier the frame's depth has no texture behind it until the
    // first copy has run; the water waits for it rather than read nothing.
    const high = (this.sceneTexture?.isReady() ?? true) && (this.depthTexture?.isReady() ?? true);
    return this.bedTexture !== null && this.bedTexture.isReady() && high;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("bedDepth");
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("waterBedHeight", "waterScene", "waterDepth");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "waterLevel", size: 1, type: "float" },
        { name: "waterKd", size: 3, type: "vec3" },
        { name: "waterBed", size: 4, type: "vec4" },
        { name: "waterBedTexels", size: 1, type: "float" },
        { name: "waterTime", size: 1, type: "float" },
        { name: "waterWind", size: 2, type: "vec2" },
        { name: "waterScreen", size: 2, type: "vec2" },
        { name: "waterHigh", size: 1, type: "float" },
        { name: "waterOctaves", size: 1, type: "float" },
        { name: "waterNearFar", size: 2, type: "vec2" },
      ],
      fragment: [
        "uniform float waterLevel;",
        "uniform vec3 waterKd;",
        "uniform vec4 waterBed;",
        "uniform float waterBedTexels;",
        "uniform float waterTime;",
        "uniform vec2 waterWind;",
        "uniform vec2 waterScreen;",
        "uniform float waterHigh;",
        "uniform float waterOctaves;",
        "uniform vec2 waterNearFar;",
      ].join("\n"),
    };
  }

  /**
   * The level is the mesh's, not the material's: two ponds share the lake
   * material, and Babylon skips `bindForSubMesh` when one material and effect
   * draw back to back, so it is written here, on every draw.
   */
  override hardBindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const level = (subMesh.getMesh().metadata as { waterLevel?: number } | null)?.waterLevel ?? 0;
    uniformBuffer.updateFloat("waterLevel", level);
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const extent = this.bedTexels * this.bedSpacing;
    uniformBuffer.updateFloat3("waterKd", this.row.kd[0], this.row.kd[1], this.row.kd[2]);
    uniformBuffer.updateFloat4("waterBed", this.bedOrigin[0], this.bedOrigin[1], 1 / extent, this.bedSpacing);
    uniformBuffer.updateFloat("waterBedTexels", this.bedTexels);
    uniformBuffer.updateFloat("waterTime", this.time);
    uniformBuffer.updateFloat2("waterWind", this.windDir[0], this.windDir[1]);
    uniformBuffer.updateFloat2("waterScreen", this.screen[0], this.screen[1]);
    const high = this.sceneTexture !== null && this.depthTexture !== null;
    uniformBuffer.updateFloat("waterHigh", high ? 1 : 0);
    uniformBuffer.updateFloat("waterOctaves", this.octaves);
    uniformBuffer.updateFloat2("waterNearFar", this.nearFar[0], this.nearFar[1]);
    // Every declared sampler is bound on every draw: WebGPU validates the
    // bindings a pipeline declares whether or not a branch reads them. The
    // material is not ready until the bed texture exists, so the null guards
    // are never reached on a draw.
    if (this.bedTexture !== null) uniformBuffer.setTexture("waterBedHeight", this.bedTexture);
    const scene = this.sceneTexture ?? this.bedTexture;
    const depth = this.depthTexture ?? this.bedTexture;
    if (scene !== null) uniformBuffer.setTexture("waterScene", scene);
    if (depth !== null) uniformBuffer.setTexture("waterDepth", depth);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: fragmentCompose,
      };
    }
    return null;
  }
}

/** Attach once per material; a later call returns the plugin already there. */
export function attachWater(material: Material, row: WaterRow): WaterPlugin {
  const existing = material.pluginManager?.getPlugin("Water");
  if (existing instanceof WaterPlugin) return existing;
  return new WaterPlugin(material, row);
}
