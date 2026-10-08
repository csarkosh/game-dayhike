// client/src/game/waterPlugin.ts
/**
 * The water plugin: PBR with what water is about spliced in (spec §3):
 * per-pixel bed depth from the bed height texture, the waterline, the
 * medium and low tiers' single alpha, the reflected ray held above the
 * horizon, and on the high tier a refracted read of the scene copy with
 * per-channel attenuation. Everything else — the sun's specular, the sky
 * probe, the headlamps, fog, the colour path — is PBR's own. Renderer-only.
 * The GLSL lives in shaders/water*.fx so shaderHygiene.test.ts covers it.
 *
 * The sea's material also draws its waves (`ocean`, `oceanRender.ts`): their
 * GLSL lives in shaders/ocean*.fx, all of it under the `OCEAN` define, which
 * is set only while the plugin has an ocean, so a lake's shader text is
 * unchanged by it. A lake's material alone reads the lake's mirror
 * (`lakeMirror.fragment.fx`, `lakeMirror.ts`) and, on the tiers without
 * one, its shore panorama and skyline (`lakePanorama.ts`), so the sea's is
 * unchanged by that in turn.
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
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import vertexDefs from "./shaders/water.vertex.fx?raw";
import vertexWorldPos from "./shaders/waterWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/water.fragment.fx?raw";
import lakeRipplesDefs from "./shaders/lakeRipples.fragment.fx?raw";
import lakeMirrorDefs from "./shaders/lakeMirror.fragment.fx?raw";
import fragmentLights from "./shaders/waterLights.fragment.fx?raw";
import fragmentCompose from "./shaders/waterCompose.fragment.fx?raw";
import oceanVertexDefs from "./shaders/ocean.vertex.fx?raw";
import oceanDisplace from "./shaders/oceanDisplace.vertex.fx?raw";
import oceanFragmentDefs from "./shaders/ocean.fragment.fx?raw";
import oceanSurface from "./shaders/oceanSurface.fx?raw";
import oceanShade from "./shaders/oceanShade.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";
import { WIND_TIME_WRAP } from "./windParams.js";
import { MIRROR_OFFSET_K } from "./mirrorView.js";

/** Babylon's dielectric F0 at metallicF0Factor 1 is 0.04; water's 0.02 is half of it. */
const PBR_DIELECTRIC_F0 = 0.04;

/** The definitions each stage gets: the water's, then the sea's declarations,
 * then the sea's surface, which both stages evaluate (`oceanSurface.fx`), and
 * in the fragment stage the sea's shading (each file ends in a newline, so no
 * two lines join). A lake's fragment stage also gets the lake's ripples and
 * the mirror's read after the water's; the sea's never does, so its text is as
 * it was before them. */
const VERTEX_DEFINITIONS = vertexDefs + oceanVertexDefs + oceanSurface;
const SEA_FRAGMENT_DEFINITIONS = fragmentDefs + oceanFragmentDefs + oceanSurface + oceanShade;
const LAKE_FRAGMENT_DEFINITIONS = fragmentDefs + lakeRipplesDefs + lakeMirrorDefs + oceanFragmentDefs + oceanSurface + oceanShade;

/**
 * Babylon 9.18's line that takes the reflectivity block's roughness, which
 * comes after CUSTOM_FRAGMENT_BEFORE_LIGHTS, where no roughness can be written
 * yet; and the sea's line in its place: the roughness of the slope variance
 * its normal leaves undrawn, per pixel (`wOceanVar`, waterLights.fragment.fx;
 * spec §7.3). The wet plugin rewrites the same line on the materials it wets;
 * the water never carries that plugin.
 */
export const OCEAN_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;";
export const OCEAN_ROUGHNESS_CODE = "float roughness=min(sqrt(sqrt(2.0 * wOceanVar)), 1.0);";

/**
 * What the sea's material draws its waves from, filled in place each frame
 * by `oceanRender.ts`. The tuples are the shader's vec4 uniforms, in order.
 */
export type OceanBinding = {
  /** The swell's tables (`oceanTables.ts`): RGBA32F, nearest, clamped. */
  atlas: BaseTexture;
  /** The wind sea's displacement and slopes, 2D arrays: the scene's 1×1
   * placeholder (`oceanArrayPlaceholder`) where the tier draws none. */
  windDisp: BaseTexture;
  windSlope: BaseTexture;
  /** The swell's twelve phases, radians (`swellPhases`), zeros past the drawn count. */
  phases: Float32Array;
  /** The swell's components, (k0x, k0z, q0, a0) a component, twelve vec4s
   * (`oceanComponentsFor`): the `oceanK` uniforms, constant for the world. */
  components: Float32Array;
  /** The swell's unit direction of travel (x, z), its peak period (s) and its significant height (m). */
  swell: [number, number, number, number];
  /** The cove's two headland tips, (x0, z0, x1, z1); an absent one far inland (`OCEAN_NO_TIP`). */
  tips: [number, number, number, number];
  /** The coastline row's first z (m), its step (m), the swell components drawn, and the wind sea's mode (0 low, 1 loop, 2 FFT). */
  coast: [number, number, number, number];
  /** The wind sea's fully developed height (m), the loop's length scale, the loop's time (s), the whitecap coverage:
   * the sea's, at the speed it follows a minute behind its wind (`lagSeaWind`). */
  wind: [number, number, number, number];
  /** The wind sea's direction (x, z), its wind speed U10 (m/s), and the onshore weight (0 to 1). */
  windDir: [number, number, number, number];
  /** What the shaders normalise the drawn wind sea by: its height's standard
   * deviation (m) at the wind, fully developed, before its share near shore,
   * then each field's slope variance (the loop's alone, or the FFT's three
   * cascades'); zeros where none is drawn (`oceanWindSource.ts`). */
  windStats: [number, number, number, number];
  /** The point the wind sea's fields turn about as the wind turns, (x, z, 0, 0): the cove's waterline centre,
   * where the sea is seen up close, so nothing slides there (`oceanWindFrame`). */
  windPivot: [number, number, number, number];
};

/** The ten vec4 uniforms the sea's waves read, in the order they are bound. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
  "oceanWindStats", "oceanWindPivot",
] as const;

/** The lake's ripples' two floats (`lakeRipples.fragment.fx`), declared on a lake alone, after `waterRain`. */
const LAKE_UNIFORMS = ["waterLakeTime", "waterPawCover"] as const;

/** The lake's mirror's five floats (`lakeMirror.fragment.fx`), declared on a
 * lake alone, after its view-projection, which follows the ripples'. */
const MIRROR_FLOATS = ["waterMirrorOn", "waterMirrorK", "waterMirrorWeight", "waterMirrorSmearPx", "waterCalmShare"] as const;
/** The mirrored camera's view-projection, as its four columns: an array, bound as the sea's components are. */
const MIRROR_VP = "waterMirrorVP";
const MIRROR_VP_COLUMNS = 4;

/** The lake's shore on medium and low (`lakeMirror.fragment.fx`): the
 * cylinder's centre and radius, the forest's shade under the skyline and the
 * panorama's and the skyline's flags, declared on a lake alone, after the
 * mirror's floats. */
const SHORE_UNIFORMS = [
  { name: "waterLakeCentre", size: 3, type: "vec3" },
  { name: "waterLakeRadius", size: 1, type: "float" },
  { name: "waterShadeColour", size: 3, type: "vec3" },
  { name: "waterPanoramaOn", size: 1, type: "float" },
  { name: "waterSkylineOn", size: 1, type: "float" },
] as const;

/** The swell's components, a uniform array of twelve vec4s, bound after the ten. */
const OCEAN_COMPONENTS = "oceanK";
const OCEAN_COMPONENT_COUNT = 12;

/** Bound without an ocean: the uniforms exist on every water material. */
const NO_PHASES = new Float32Array(12);
const NO_COMPONENTS = new Float32Array(OCEAN_COMPONENT_COUNT * 4);
const NO_VEC4: readonly [number, number, number, number] = [0, 0, 0, 0];

/** One of the sea's vec4 uniforms, zeros where there is no sea: on every draw, so nothing is made for it. */
function bindVec4(
  uniformBuffer: UniformBuffer, name: (typeof OCEAN_UNIFORMS)[number], v: readonly [number, number, number, number] | undefined,
): void {
  const value = v ?? NO_VEC4;
  uniformBuffer.updateFloat4(name, value[0], value[1], value[2], value[3]);
}

const arrayPlaceholders = new WeakMap<Scene, BaseTexture>();

/**
 * A 1×1 RGBA 2D array of one layer, zero, made once per scene: what an array
 * sampler is bound to where nothing real is. WebGPU checks a binding's view
 * dimension against the shader's, so a 2D texture cannot stand in for it.
 * The scene disposes it with itself; a disposed one is made again.
 */
export function oceanArrayPlaceholder(scene: Scene): BaseTexture {
  const kept = arrayPlaceholders.get(scene);
  if (kept !== undefined && kept.getInternalTexture() !== null) return kept;
  const made = new RawTexture2DArray(new Uint8Array(4), 1, 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  made.name = "oceanArrayPlaceholder";
  arrayPlaceholders.set(scene, made);
  return made;
}

const mirrorPlaceholders = new WeakMap<Scene, BaseTexture>();

/**
 * A 1×1 RGBA texture, black with alpha 0, made once per scene: what the
 * lake's mirror sampler is bound to where no mirror is read (the sea, the
 * medium and low tiers, a lake before its mirror exists). Alpha 0 is
 * "nothing drawn here", so a read of it leaves the probe. The scene disposes
 * it with itself; a disposed one is made again.
 */
export function waterMirrorPlaceholder(scene: Scene): BaseTexture {
  const kept = mirrorPlaceholders.get(scene);
  if (kept !== undefined && kept.getInternalTexture() !== null) return kept;
  const made = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  made.name = "waterMirrorPlaceholder";
  mirrorPlaceholders.set(scene, made);
  return made;
}

export class WaterPlugin extends MaterialPluginBase {
  readonly row: WaterRow;
  /** The bed height square (Task 4 uploads it); null until the first bake. */
  bedTexture: BaseTexture | null = null;
  bedOrigin: [number, number] = [0, 0];
  bedTexels = 256;
  bedSpacing = 1;
  /** High tier only: the scene copy and depth read (`waterFrame.ts`), and the screen's 1/size. */
  sceneTexture: BaseTexture | null = null;
  depthTexture: BaseTexture | null = null;
  screen: [number, number] = [1, 1];
  /** The camera's near and far, per frame: the copy's device depth is linearised with them. */
  nearFar: [number, number] = [0.05, 1000];
  time = 0;
  windDir: [number, number] = [1, 0];
  /** The wind's 0..1 speed, as `setWind` last had it. */
  windSpeed = 0;
  /** On a lake, the wind's velocity (its direction times its 0..1 speed)
   * integrated over the run, in seconds: what the skin and the second octave
   * drift by, so the octave drifts at the wind's speed as well as along it.
   * On the sea, its direction alone: the low tier's caps drift by it at
   * their designed speed (`oceanShade.fragment.fx`'s OCEAN_CAP_DRIFT). */
  windTime: [number, number] = [0, 0];
  private _lastSeconds: number | null = null;
  /** Ripple octaves the fragment blends: 2, or 1 on the low tier (spec §5.3). */
  octaves = 2;
  /** The duckweed and algae skin: x how much of the surface may carry it
   * (`lakeSkin` of the lake's murk; 0 on the sea), y the seed's noise offset
   * (`waterSkinOffset`). */
  skin: [number, number] = [0, 0];
  /** The weather's rain, 0 to 1, per frame: the drops' rings on the surface,
   * the puddles' own on the sea (`waterRainSlope`), the lake's near the eye
   * (`lakeRainSlope`). */
  rain = 0;
  /** The lake's time: the shared seconds wrapped at WIND_TIME_WRAP, which the
   * cat's-paws and the rain's rings read (`lakeRipples.fragment.fx`). */
  lakeTime = 0;
  /** How much of the lake the cat's-paws may cover, 0 to 1 (`lakePaw`): 1 on
   * a lake rough all over, as it is until the renderer first sets it. */
  pawCover = 1;
  /** The lake's centre (x, level, z) and its radius: the cylinder the
   * medium tier reads its panorama on (`setLakeBody`). Zeros until set. */
  readonly lakeBody: [number, number, number, number] = [0, 0, 0, 0];
  /** The forest's colour under the skyline on the low tier (`setSkyline`),
   * raw: the shader scales it by the environment's intensity. */
  readonly shadeColour: [number, number, number] = [0, 0, 0];
  /** The medium tier's shore panorama and the skyline (medium and low), on
   * the lake that has them; null elsewhere, where the probe shows. Bound to
   * the mirror's placeholder without them, and on the sea. */
  private _panorama: BaseTexture | null = null;
  private _skyline: BaseTexture | null = null;
  private _ocean: OceanBinding | null = null;
  /** What the array samplers are bound to without an ocean. */
  private readonly _arrayPlaceholder: BaseTexture;
  /** The lake's mirror (`setMirror`): its target, or null where none is read. */
  private _mirror: BaseTexture | null = null;
  /** The mirrored camera's view-projection (Babylon layout), identity until set. */
  private readonly _mirrorViewProjection = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  /** What the mirror's sampler is bound to without a mirror, and on the sea. */
  private readonly _mirrorPlaceholder: BaseTexture;
  /** The calm (`setCalm`): the glass's share, the state's mirror weight, the smear in pixels. */
  private _calmShare = 0;
  private _mirrorWeight = 0;
  private _mirrorSmearPx = 0;

  constructor(material: Material, row: WaterRow) {
    // 230: after the atmosphere's 200 and every look plugin's 205 to 220; the
    // water carries only this and the atmosphere, so the order is fixed.
    super(material, "Water", 230, { WATER: false, OCEAN: false });
    this.row = row;
    this._arrayPlaceholder = oceanArrayPlaceholder(material.getScene());
    this._mirrorPlaceholder = waterMirrorPlaceholder(material.getScene());
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

  /** The sea's waves (`oceanRender.ts`), null on a lake. Whether there is one
   * sets `OCEAN`, so a change between the two rebuilds the effect. */
  get ocean(): OceanBinding | null {
    return this._ocean;
  }

  set ocean(binding: OceanBinding | null) {
    const had = this._ocean !== null;
    this._ocean = binding;
    if (had !== (binding !== null)) {
      // The lake's uniforms are a lake's alone (`getUniforms`), so a change of
      // body rebuilds the uniform buffer's layout, as Babylon does when a
      // plugin is added to a material already drawn.
      const m = this._material;
      if (m._uniformBufferLayoutBuilt) {
        m.resetDrawCache();
        m._createUniformBuffer();
      }
      this.markAllDefinesAsDirty();
    }
  }

  /** The medium tier's shore panorama (`lakePanorama.ts`), or null for the probe. */
  setPanorama(texture: BaseTexture | null): void {
    this._panorama = texture;
  }

  /** The skyline (`createSkylineTexture`) and the forest's colour under it,
   * the probe's horizon times SKYLINE_SHADE (copied), raw: the shader scales
   * it by the environment's intensity, as it does the probe; or null for the
   * probe. */
  setSkyline(texture: BaseTexture | null, shadeColour: readonly [number, number, number]): void {
    this._skyline = texture;
    this.shadeColour[0] = shadeColour[0];
    this.shadeColour[1] = shadeColour[1];
    this.shadeColour[2] = shadeColour[2];
  }

  /** The lake's centre at its level, and its radius: the shore's cylinder. */
  setLakeBody(x: number, level: number, z: number, radius: number): void {
    this.lakeBody[0] = x;
    this.lakeBody[1] = level;
    this.lakeBody[2] = z;
    this.lakeBody[3] = radius;
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
    this.windSpeed = wind01;
  }

  /** Per frame, with the renderer's clock: sets the time and adds the step to
   * `windTime`, times the wind's velocity on a lake and its direction alone
   * on the sea. */
  advance(seconds: number): void {
    const dt = this._lastSeconds === null ? 0 : Math.max(0, seconds - this._lastSeconds);
    const speed = this._ocean === null ? this.windSpeed : 1;
    this.windTime[0] += this.windDir[0] * speed * dt;
    this.windTime[1] += this.windDir[1] * speed * dt;
    this._lastSeconds = seconds;
    this.time = seconds;
  }

  /** Per frame, the shared seconds (wrapped or not): the lake's time, wrapped
   * at WIND_TIME_WRAP as the wind's is; 0 for a time that is not finite. */
  setLakeTime(seconds: number): void {
    this.lakeTime = Number.isFinite(seconds) ? seconds - Math.floor(seconds / WIND_TIME_WRAP) * WIND_TIME_WRAP : 0;
  }

  /** Per frame, the share of the lake the cat's-paws may cover, clamped to
   * 0..1; 0 for a cover that is not finite. */
  setPawCover(cover: number): void {
    this.pawCover = Number.isFinite(cover) ? Math.min(1, Math.max(0, cover)) : 0;
  }

  /**
   * Per frame on a lake: the mirror's target this frame and the mirrored
   * camera's view-projection (Babylon layout, copied), or null where none is
   * read (the pass not run this frame, the medium and low tiers), which
   * binds the placeholder and turns the read off.
   */
  setMirror(texture: BaseTexture | null, viewProjection: Float32Array): void {
    this._mirror = texture;
    this._mirrorViewProjection.set(viewProjection);
  }

  /** Per frame on a lake: the glass's share of it (`calmShare`), the state's
   * mirror weight (0 under rough), and a full paw's smear in pixels
   * (`smearPx`), which the shader scales by the paw mask (none on glass). The
   * share and the weight clamped to 0..1 and the smear to 0 and up; any of
   * them 0 when it is not finite. */
  setCalm(share: number, weight: number, smearPx: number): void {
    this._calmShare = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
    this._mirrorWeight = Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0;
    this._mirrorSmearPx = Number.isFinite(smearPx) ? Math.max(0, smearPx) : 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.WATER = true;
    defines.OCEAN = this._ocean !== null;
  }

  /**
   * Ready once the bed texture is, on every tier. The high tier's scene copy
   * and depth are not waited on: the frame binds textures that exist from its
   * creation (a far depth until its first copy), and the copy runs only with
   * water in view, so waiting on it would hold the scene's readiness, and the
   * page's start, on the view.
   */
  override isReadyForSubMesh(): boolean {
    return this.bedTexture !== null && this.bedTexture.isReady();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("bedDepth");
    // The rings' stitch (water.ts), read only by the sea's waves.
    if (this._ocean !== null) attributes.push("oceanMorph", "oceanCoarse");
  }

  // Always listed, ocean or none: Babylon gathers a plugin's samplers once,
  // when the material's uniform layout is built (`rainPlugin.ts` says why).
  // Undeclared on a lake, the ocean's are a null location on WebGL and
  // ignored on WebGPU, as the lake's mirror, panorama and skyline are on the sea.
  override getSamplers(samplers: string[]): void {
    samplers.push(
      "waterBedHeight", "waterScene", "waterDepth", "oceanAtlas", "oceanWindDisp", "oceanWindSlope", "waterMirror", "waterPanorama", "waterSkyline",
    );
  }

  /**
   * The water's uniforms, then, on a lake alone, the lake's ripples', its
   * mirror's and its shore's (the sea's text is as it was before them), then
   * the sea's ten and its components, declared on a lake too (a lake reads
   * none of them).
   */
  override getUniforms(): {
    ubo: { name: string; size: number; type: string; arraySize?: number }[]; vertex: string; fragment: string;
  } {
    const components = `uniform vec4 ${OCEAN_COMPONENTS}[${OCEAN_COMPONENT_COUNT}];`;
    const isLake = this._ocean === null;
    const lake = isLake ? LAKE_UNIFORMS : [];
    const mirror = isLake ? MIRROR_FLOATS : [];
    const shore = isLake ? SHORE_UNIFORMS : [];
    return {
      ubo: [
        { name: "waterLevel", size: 1, type: "float" },
        { name: "waterKd", size: 3, type: "vec3" },
        { name: "waterBed", size: 4, type: "vec4" },
        { name: "waterBedTexels", size: 1, type: "float" },
        { name: "waterTime", size: 1, type: "float" },
        { name: "waterWind", size: 2, type: "vec2" },
        { name: "waterWindTime", size: 2, type: "vec2" },
        { name: "waterScreen", size: 2, type: "vec2" },
        { name: "waterHigh", size: 1, type: "float" },
        { name: "waterOctaves", size: 1, type: "float" },
        { name: "waterNearFar", size: 2, type: "vec2" },
        { name: "waterSkin", size: 2, type: "vec2" },
        { name: "waterRain", size: 1, type: "float" },
        ...lake.map((name) => ({ name, size: 1, type: "float" })),
        ...(isLake ? [{ name: MIRROR_VP, size: 4, type: "vec4", arraySize: MIRROR_VP_COLUMNS }] : []),
        ...mirror.map((name) => ({ name, size: 1, type: "float" })),
        ...shore.map(({ name, size, type }) => ({ name, size, type })),
        ...OCEAN_UNIFORMS.map((name) => ({ name, size: 4, type: "vec4" })),
        { name: OCEAN_COMPONENTS, size: 4, type: "vec4", arraySize: OCEAN_COMPONENT_COUNT },
      ],
      // The sea's waves read theirs in the vertex stage too, which takes this
      // where uniform buffers are not supported.
      vertex: [...OCEAN_UNIFORMS.map((name) => `uniform vec4 ${name};`), components].join("\n"),
      fragment: [
        "uniform float waterLevel;",
        "uniform vec3 waterKd;",
        "uniform vec4 waterBed;",
        "uniform float waterBedTexels;",
        "uniform float waterTime;",
        "uniform vec2 waterWind;",
        "uniform vec2 waterWindTime;",
        "uniform vec2 waterScreen;",
        "uniform float waterHigh;",
        "uniform float waterOctaves;",
        "uniform vec2 waterNearFar;",
        "uniform vec2 waterSkin;",
        "uniform float waterRain;",
        ...lake.map((name) => `uniform float ${name};`),
        ...(isLake ? [`uniform vec4 ${MIRROR_VP}[${MIRROR_VP_COLUMNS}];`] : []),
        ...mirror.map((name) => `uniform float ${name};`),
        ...shore.map(({ name, type }) => `uniform ${type} ${name};`),
        ...OCEAN_UNIFORMS.map((name) => `uniform vec4 ${name};`),
        components,
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
    uniformBuffer.updateFloat2("waterWindTime", this.windTime[0], this.windTime[1]);
    uniformBuffer.updateFloat2("waterScreen", this.screen[0], this.screen[1]);
    const high = this.sceneTexture !== null && this.depthTexture !== null;
    uniformBuffer.updateFloat("waterHigh", high ? 1 : 0);
    uniformBuffer.updateFloat("waterOctaves", this.octaves);
    uniformBuffer.updateFloat2("waterNearFar", this.nearFar[0], this.nearFar[1]);
    uniformBuffer.updateFloat2("waterSkin", this.skin[0], this.skin[1]);
    uniformBuffer.updateFloat("waterRain", this.rain);
    // The lake's ripples, declared on a lake alone, bound on its every draw.
    if (this._ocean === null) {
      uniformBuffer.updateFloat("waterLakeTime", this.lakeTime);
      uniformBuffer.updateFloat("waterPawCover", this.pawCover);
      // The lake's mirror: off, the identity and a calm of zero until set.
      uniformBuffer.updateFloatArray(MIRROR_VP, this._mirrorViewProjection);
      uniformBuffer.updateFloat("waterMirrorOn", this._mirror !== null ? 1 : 0);
      uniformBuffer.updateFloat("waterMirrorK", MIRROR_OFFSET_K);
      uniformBuffer.updateFloat("waterMirrorWeight", this._mirrorWeight);
      uniformBuffer.updateFloat("waterMirrorSmearPx", this._mirrorSmearPx);
      uniformBuffer.updateFloat("waterCalmShare", this._calmShare);
      // The lake's shore on medium and low: zeros and the flags 0 until set.
      uniformBuffer.updateFloat3("waterLakeCentre", this.lakeBody[0], this.lakeBody[1], this.lakeBody[2]);
      uniformBuffer.updateFloat("waterLakeRadius", this.lakeBody[3]);
      uniformBuffer.updateFloat3("waterShadeColour", this.shadeColour[0], this.shadeColour[1], this.shadeColour[2]);
      uniformBuffer.updateFloat("waterPanoramaOn", this._panorama !== null ? 1 : 0);
      uniformBuffer.updateFloat("waterSkylineOn", this._skyline !== null ? 1 : 0);
    }
    // Every declared sampler is bound on every draw: WebGPU validates the
    // bindings a pipeline declares whether or not a branch reads them. The
    // material is not ready until the bed texture exists, so the null guards
    // are never reached on a draw.
    if (this.bedTexture !== null) uniformBuffer.setTexture("waterBedHeight", this.bedTexture);
    const scene = this.sceneTexture ?? this.bedTexture;
    const depth = this.depthTexture ?? this.bedTexture;
    if (scene !== null) uniformBuffer.setTexture("waterScene", scene);
    if (depth !== null) uniformBuffer.setTexture("waterDepth", depth);
    // The lake's mirror, the placeholder where none is read and on the sea.
    uniformBuffer.setTexture("waterMirror", this._ocean === null ? (this._mirror ?? this._mirrorPlaceholder) : this._mirrorPlaceholder);
    // The lake's shore panorama and skyline, the same placeholder likewise.
    uniformBuffer.setTexture("waterPanorama", this._ocean === null ? (this._panorama ?? this._mirrorPlaceholder) : this._mirrorPlaceholder);
    uniformBuffer.setTexture("waterSkyline", this._ocean === null ? (this._skyline ?? this._mirrorPlaceholder) : this._mirrorPlaceholder);
    // The sea's waves: zeros and placeholders on a lake, whose shader declares
    // none of it, so every water material binds the same.
    const ocean = this._ocean;
    const phases = ocean?.phases ?? NO_PHASES;
    for (let i = 0; i < 3; i++) {
      uniformBuffer.updateFloat4(
        OCEAN_UNIFORMS[i] as string,
        phases[i * 4] as number, phases[i * 4 + 1] as number, phases[i * 4 + 2] as number, phases[i * 4 + 3] as number,
      );
    }
    bindVec4(uniformBuffer, "oceanSwell", ocean?.swell);
    bindVec4(uniformBuffer, "oceanTips", ocean?.tips);
    bindVec4(uniformBuffer, "oceanCoast", ocean?.coast);
    bindVec4(uniformBuffer, "oceanWind", ocean?.wind);
    bindVec4(uniformBuffer, "oceanWindDir", ocean?.windDir);
    bindVec4(uniformBuffer, "oceanWindStats", ocean?.windStats);
    bindVec4(uniformBuffer, "oceanWindPivot", ocean?.windPivot);
    uniformBuffer.updateFloatArray(OCEAN_COMPONENTS, ocean?.components ?? NO_COMPONENTS);
    const atlas = ocean?.atlas ?? this.bedTexture;
    if (atlas !== null) uniformBuffer.setTexture("oceanAtlas", atlas);
    uniformBuffer.setTexture("oceanWindDisp", ocean?.windDisp ?? this._arrayPlaceholder);
    uniformBuffer.setTexture("oceanWindSlope", ocean?.windSlope ?? this._arrayPlaceholder);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_UPDATE_POSITION: oceanDisplace,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos,
      };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: this._ocean !== null ? SEA_FRAGMENT_DEFINITIONS : LAKE_FRAGMENT_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: fragmentCompose,
        // Listed always: Babylon gathers a plugin's hook names once, when the
        // plugin is added. An empty string injects nothing, so a lake's line
        // stays Babylon's own.
        [OCEAN_ROUGHNESS_ANCHOR]: this._ocean !== null ? OCEAN_ROUGHNESS_CODE : "",
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
