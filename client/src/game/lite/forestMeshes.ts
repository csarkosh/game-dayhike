/**
 * The forest's trees on Babylon Lite: the near rings of full geometry, the
 * canopy giants and the saplings at three LODs each, the dead trees, a
 * standing snag and a fallen log in one bucket, and past the near radius a
 * billboard a tree, and on the nurse logs their ferns and seedlings. Every
 * bucket is a mesh a primitive (a tree's bark and its crown are two) drawn
 * as thin instances.
 *
 * What each bucket is drawn with is the game's own, made with no engine:
 * the bands `forestField.ts` collects round the camera, the matrices and the
 * per-instance attributes `forestInstances.ts` makes of them, the fade bands
 * of each ring, the bark each tree wears (`barkParams.ts`), each material's
 * share of the sky (`forestLookParams.ts`), the foliage's numbers
 * (`foliageUniforms.ts`), and a billboard's quad, its bake's pose and frame
 * and its distance field (`impostorBake.ts`, `impostorField.ts`). This
 * module is where those meet Lite: the models
 * and maps its loaders read (`forestModels.ts`), a PBR material a look with
 * the forest's plugins (`forestPlugins.ts`), and the instance lists written
 * into each mesh as the camera crosses a tree cell.
 *
 * **A bucket's lists are written in place.** A mesh keeps one array of
 * matrices and one of plugin instance data at a capacity; a rebuild writes
 * the new list over the old and sets how many are drawn, and only a list
 * that outgrows its arrays takes new ones. A bucket with no instance is
 * hidden: Lite draws every mesh it is not told to hide.
 *
 * **The materials**, as `forestMeshes.ts` dresses them on Babylon.js: a
 * crown is its file's alpha-tested cards with the foliage at the tree's
 * profile, the distance dither and the base conform; a bark is one of the
 * four bark sets laid by its dressing's transform (in the mesh's own
 * coordinates here, since the material takes none), with the foliage's
 * sway, the conform, the moss, and the lights' diffuse under the set's
 * occlusion; LOD2 wears neither the sway nor the foliage's colour block.
 * The dead trees wear a bark set laid along the trunk by their plugin, the
 * moss in its two forms and the contact band, drawn on both sides and lit
 * on one. Every material takes the wet look at its cap and the air.
 *
 * **The billboards**, one a giant bucket set, one a sapling species and one
 * for the snags: a quad the size of the tree's box, turned to the camera
 * when its list is made, drawing both far lists (the lattice's and the
 * fill's, which end at different ranges, so the bands are each instance's
 * own). Its colour and its normal map are a bake: the tree's second LOD
 * drawn side-on, once, when the models have landed (`impostorBake.ts` here;
 * the snag stood up, for its model lies down), in the materials the near
 * trees wear less what moves and what the weather does, the two pictures
 * read back and made into a distance field off the page
 * (`impostorFieldWorker.ts`). A billboard stands hidden until its bake has
 * landed, and for good if it fails, which is said: an unbaked card would
 * draw a grey quad a tree. The card lights the baked colour once, live, as
 * a crown, through the baked normals, and tests the field at its rim.
 * Nothing bakes again while the forest stands: the pictures are unlit, so
 * neither the hour nor the weather is in them.
 *
 * **What grows on a nurse log** (`nurseLog.ts`): the understory's fern and
 * a seedling built in code, each a bucket, placed along each log's top line
 * by the log's own matrix and stood plumb (`nurseBuffers`), dithering out
 * with distance. The fern wears its file's cards in the cover's green under
 * the cards' contrast, with no map of normals, no sway and no ground tint:
 * it stands a metre off the ground. The seedling is white under its own
 * vertex colours. Both are matt, drawn on both sides and lit on one.
 */
import {
  acquireTexture, addToScene, createMeshFromData, createPbrMaterial, createTexture2DFromPixels, disposeMeshGpu, getOrCreateSampler, invalidateRenderBundles,
  markMaterialUboDirty, releaseTexture, removeFromScene, setMeshVisible, setPbrAlphaCutoff, setPbrGammaAlbedo, setPbrMetallicReflectance, setThinInstanceCount,
  setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import { TREE_CELL, type TreeInstance } from "../../sim/vegetation.js";
import { modelUrl, textureUrl } from "../assetUrls.js";
import {
  GIANT_SETS, SAPLING_BARKS, barkLook, barkSize, barkUv, inGiantSet, type BarkDressing, type BarkLook,
} from "../barkParams.js";
import { FOLIAGE_CARD_CONTRAST, coverAlbedoTint } from "../coverAlbedoParams.js";
import { DEADWOOD_BARK, DEADWOOD_TONE } from "../deadwoodParams.js";
import type { FadeBands } from "../distanceFade.js";
import { FOLIAGE_PROFILES, foliageLook, type FoliageLook } from "../foliageUniforms.js";
import { NEAR_RADIUS, bandsOrigin, createBandCollector } from "../forestField.js";
import {
  NURSE_BANDS, deadwoodMatrixBuffer, deadwoodMeasure, deadwoodRoleBuffer, fadeBandsBuffer, forestFadeBands, groundGradBuffer, impostorFadeBuffer,
  impostorMatrixSlices, impostorQuad, nurseBuffers, partitionImpostors, snagImpostorQuad, treeMatrixBuffer,
  type DeadwoodMeasure, type ImpostorQuad,
} from "../forestInstances.js";
import { CROWN_SKY, TREE_SPECULAR_WEIGHT, treeSkyLook } from "../forestLookParams.js";
import {
  IMPOSTOR_BAKE_FAIL_MS, IMPOSTOR_BAKE_SIZE, IMPOSTOR_BAKE_WARN_MS, SNAG_BAKE_ROLL, bakePoseMatrix, impostorBakeFrame, impostorName, posedBounds,
  type ImpostorBake,
} from "../impostorBake.js";
import { IMPOSTOR_FIELD_CUT } from "../impostorField.js";
import { createFieldMaker } from "../impostorFieldWorker.js";
import type { Vec3 } from "../instancePose.js";
import { MOSS_OUTPUT } from "../mossParams.js";
import { seedlingGeometry } from "../nurseLog.js";
import type { QualityTier } from "../quality.js";
import { createCrossing, crossingAt, finish, type Slices } from "../syncJobs.js";
import type { WetUniforms } from "../wetSurface.js";
import { loadKtx2Map, loadModel, type LoadedModel, type ModelPart } from "./forestModels.js";
import {
  baseColourPlugin, directOcclusionPlugin, impostorBakePlugin, oneSidedLightPlugin, surfaceSplitPlugin, surfaceWetPlugin, vegetationInstanceLayout,
  vegetationPlugin, writeVegetationInstances,
  type Vegetation, type VegetationInstanceLayout,
} from "./forestPlugins.js";
import { createImpostorBaker, type BakeMesh } from "./impostorBake.js";

/** The canopy giants' models by `TreeInstance.species`: the fir, then the pine. */
const GIANT_MODELS = ["models/tree.giant_fir.glb", "models/tree.giant_pine.glb"];
/** The saplings' models by `TreeInstance.species`: the two conifers, then the alder. */
const SAPLING_MODELS = ["models/tree.conifer_a.glb", "models/tree.conifer_b.glb", "models/tree.alder.glb"];
/** The dead trees' one model, both roles. */
const DEADWOOD_MODEL = "models/deadwood.snag.glb";
/** The fern on the nurse logs, by catalog id: the understory's fern, in the cover's green as the floor's own are. */
const NURSE_FERN_ID = "understory.fern";
const NURSE_FERN_MODEL = `models/${NURSE_FERN_ID}.glb`;
const NURSE_FERN_LOD = "LOD0";
const TREE_LODS = ["LOD0", "LOD1", "LOD2"] as const;

/** A dielectric's reflectance at normal incidence from its index of refraction. */
const reflectanceOf = (ior: number): number => ((ior - 1) / (ior + 1)) ** 2;

/** Instances a bucket's arrays hold before its first list: a bucket in view of no tree still stands, hidden. */
const FIRST_CAPACITY = 16;

/** The anisotropy a billboard's two maps are sampled with: what Babylon.js gives a map filtered between its levels,
 * which the game's cards are. Without it the far crowns are drawn a level softer than the game draws them. */
const CARD_ANISOTROPY = 4;

export type ForestMeshes = {
  /** Follows the camera: the lists are made again when it crosses a tree cell. Before the models have landed it only keeps where the camera is. */
  update(camX: number, camZ: number): void;
  /** Once a frame: every material's uniforms are written again, for the wind and the eye move. */
  frame(): void;
  /** Models and maps still being fetched or decoded. */
  waiting(): number;
  /** Resolves once the models have landed, the first lists are drawn and every billboard's bake has settled, baked or
   * given up, or cannot be: a failure is said and costs the trees alone. */
  readonly ready: Promise<void>;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
  /** Every billboard's bake as it stands, in the order the billboards are made: the giants' sets, the saplings, the
   * snag. Empty until the models have landed. */
  impostorBakes(): readonly ImpostorBake[];
  /** Ends the bakes still in flight and the models still loading, at once and without a word: a bake so ended stays as
   * it stood. For a device that has failed; the forest stands until `dispose`. */
  abandon(): void;
  dispose(): void;
};

export type ForestMeshOptions = {
  /** The quality tier: the size of bark each tree wears, and the dead trees' LOD. */
  tier: QualityTier;
  /** Where the near band ends; `NEAR_RADIUS` when absent. */
  nearRadius?: number;
  /** The eye the foliage and the fade measure from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame drawn into, its height in pixels: the fade's noise is laid on its rows. */
  frame: { readonly height: number };
  /** The wet look's uniforms at each cap a forest material has (`wetUniforms`): filled in place each frame. */
  wet: { leaf: WetUniforms; bark: WetUniforms; deadwood: WetUniforms };
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
};

/** One bucket: the meshes of a LOD (a tree's bark and crown are two), one instance list for all of them. */
type Bucket = {
  meshes: Mesh[];
  /** Each mesh's per-instance attributes, as its material's plugin reads them, and their data. */
  layouts: VegetationInstanceLayout[];
  data: (Float32Array | null)[];
  fade: FadeBands;
  matrices: Float32Array;
  capacity: number;
  count: number;
};

/** A bark set's three maps. */
type BarkMaps = { colour: Texture2D; normal: Texture2D; arm: Texture2D };

/** One billboard: its quad, its bake as it stands, and its bucket once the bake has landed. */
type Billboard = {
  quad: ImpostorQuad;
  bake: ImpostorBake;
  /** When the bake was asked for (`performance.now()`), for its `ms`. */
  startedAt: number;
  /** Null until a bake lands, and for good if none does: the billboard is not drawn. */
  bucket: Bucket | null;
};

/** The box of every part of a LOD. */
function boxOf(parts: readonly ModelPart[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const part of parts) {
    min.x = Math.min(min.x, part.min.x);
    min.y = Math.min(min.y, part.min.y);
    min.z = Math.min(min.z, part.min.z);
    max.x = Math.max(max.x, part.max.x);
    max.y = Math.max(max.y, part.max.y);
    max.z = Math.max(max.z, part.max.z);
  }
  return { min, max };
}

/**
 * A bake's normal map as the card's material reads it. The bake writes the
 * map in the card's own frame, +x right and +y up (`impostorBakePlugin`).
 * Lite reads a map with no vertex tangents in a frame made of the
 * coordinates' derivatives, whose first axis runs against a card's u and
 * whose second with its v; the card's v runs down, with the bake's rows. So
 * both of the map's axes are turned over, and the z kept.
 */
export function cardNormals(normal: Uint8Array): Uint8Array {
  const turned = new Uint8Array(normal.length);
  for (let i = 0; i + 3 < normal.length; i += 4) {
    turned[i] = 255 - (normal[i] as number);
    turned[i + 1] = 255 - (normal[i + 1] as number);
    turned[i + 2] = normal[i + 2] as number;
    turned[i + 3] = normal[i + 3] as number;
  }
  return turned;
}

/**
 * A billboard's quad as a mesh's data: `quad.width` by `quad.height` about
 * its origin, facing -z, its coordinates laid as the bake's rows are, the
 * first at the top.
 */
export function cardGeometry(quad: ImpostorQuad): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const x = quad.width / 2;
  const y = quad.height / 2;
  return {
    positions: new Float32Array([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]),
    normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

export function createForestMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: ForestMeshOptions): ForestMeshes {
  const nearRadius = options.nearRadius ?? NEAR_RADIUS;
  const fades = forestFadeBands(nearRadius);
  const collector = createBandCollector(seed);
  const loads = new AbortController();
  const materials: PbrMaterialProps[] = [];
  const buckets: Bucket[] = [];
  /** The giants' buckets, one a bucket set (`GIANT_SETS`, index-aligned), each its three LODs; and the saplings', one a species. */
  const giants: [Bucket, Bucket, Bucket][] = [];
  const saplings: ([Bucket, Bucket, Bucket] | null)[] = [];
  let deadwood: { bucket: Bucket; measure: DeadwoodMeasure } | null = null;
  /** The ferns and the seedlings on the nurse logs; the ferns' bucket has no mesh where the model has no part. */
  let nurse: { ferns: Bucket; seedlings: Bucket } | null = null;
  /** The billboards by the slot the far lists are split into (`partitionImpostors`): the giants' sets, the saplings'
   * species, the snag. A slot with no billboard draws none of its trees. */
  const billboards: (Billboard | null)[] = [];
  /** Every bake still to settle. */
  const bakes: Promise<void>[] = [];
  /** The far lists as the last rebuild split them, and where the camera stood: a bake that lands later fills its billboard from them. */
  let far: { lattice: TreeInstance[][]; fill: TreeInstance[][]; x: number; z: number } | null = null;
  /** The bakes' maps: the forest's own, let go with it. */
  const baked: Texture2D[] = [];
  const baker = createImpostorBaker(engine);
  // One maker of distance fields for the forest's bakes: a worker, started at the first.
  const fieldMaker = createFieldMaker();
  let abandoned = false;
  let disposed = false;
  let adopted = false;
  let waiting = GIANT_MODELS.length + SAPLING_MODELS.length + 2;
  let camX = Number.NaN;
  let camZ = Number.NaN;
  const crossing = createCrossing();

  /** A map of the forest's, counted while it loads. */
  const maps = new Map<string, Promise<Texture2D>>();
  function map(output: string, colour: boolean): Promise<Texture2D> {
    let pending = maps.get(output);
    if (pending === undefined) {
      waiting++;
      pending = loadKtx2Map(engine, textureUrl(output), colour).finally(() => {
        waiting--;
      });
      maps.set(output, pending);
    }
    return pending;
  }
  async function barkMaps(look: BarkLook): Promise<BarkMaps> {
    const [colour, normal, arm] = await Promise.all([map(look.maps.colour, true), map(look.maps.normal, false), map(look.maps.arm, false)]);
    return { colour, normal, arm };
  }
  /** The trunks' moss map, one for the forest, a colour map as the bark's is. */
  const moss = map(MOSS_OUTPUT, true);

  /**
   * A material of the forest's: Lite's PBR with `plugins`, the wet look at `wet` and the air, lit by the scene's lights
   * as the terrain is. With no wet look (null) it is a bake's: dry, in no air, writing the bake's picture in place of
   * its colour, and the frames write it nothing.
   */
  function material(props: Partial<PbrMaterialProps>, specularWeight: number, plugins: MaterialPlugin[], wet: WetUniforms | null): PbrMaterialProps {
    const made = createPbrMaterial({ usePhysicalLightFalloff: true, ...props });
    // The specular weight scales the reflectance at normal incidence and at grazing angles both.
    setPbrMetallicReflectance(made, { color: [1, 1, 1], f0Factor: specularWeight });
    if (wet === null) {
      made.plugins = [baseColourPlugin(), ...plugins, surfaceSplitPlugin(), impostorBakePlugin(baker.picture)];
      return made;
    }
    made.plugins = [baseColourPlugin(), ...plugins, surfaceWetPlugin(wet), options.air()];
    materials.push(made);
    return made;
  }

  /** A crown's material: its file's cards, alpha-tested, under the crown's share of the sky. With no `vegetation` it is
   * a bake's: the cards alone, still, whole and unconformed. */
  function crownMaterial(part: ModelPart, vegetation: Pick<Vegetation, "foliage"> | null): PbrMaterialProps {
    const look = treeSkyLook(true, part.facts.specularWeight);
    const made = material(
      {
        baseColorTexture: part.colour, normalTexture: part.normal, metallicFactor: 0, roughnessFactor: 1,
        doubleSided: part.facts.doubleSided, environmentIntensity: look.sky,
        ...(part.facts.ior === null ? {} : { reflectance: reflectanceOf(part.facts.ior) }),
      },
      look.specularWeight,
      vegetation === null
        ? []
        : [vegetationPlugin({ eye: options.eye, frame: options.frame, match: false, light: false, fade: true, conform: true, moss: null, deadwood: null, sky: false, ...vegetation })],
      vegetation === null ? null : options.wet.leaf,
    );
    setPbrAlphaCutoff(made, part.facts.alphaCutoff);
    return made;
  }

  /** A bark's material: a bark set's three maps under its tone, the map's own occlusion, roughness and metalness, and
   * the moss. With no wet look it is a bake's (`material`): the far trees are mossed as the near ones. */
  function barkMaterial(
    part: ModelPart, look: BarkLook, set: BarkMaps, mossMap: Texture2D, wet: WetUniforms | null,
    vegetation: Pick<Vegetation, "foliage" | "fade" | "conform" | "deadwood">, more: MaterialPlugin[] = [],
  ): PbrMaterialProps {
    const sky = treeSkyLook(false, part.facts.specularWeight);
    return material(
      {
        baseColorTexture: set.colour, normalTexture: set.normal, ormTexture: set.arm,
        baseColorFactor: [look.tone.r, look.tone.g, look.tone.b, 1], metallicFactor: look.metallic, roughnessFactor: look.roughness,
        normalTextureScale: look.normalLevel, doubleSided: part.facts.doubleSided, environmentIntensity: sky.sky,
        ...(part.facts.ior === null ? {} : { reflectance: reflectanceOf(part.facts.ior) }),
      },
      sky.specularWeight,
      [...more, directOcclusionPlugin(), vegetationPlugin({ eye: options.eye, frame: options.frame, match: false, light: false, moss: mossMap, sky: false, ...vegetation })],
      wet,
    );
  }

  /** The file's own maps of a part the forest dresses in a set: nothing reads them, so they go. */
  const released = new Set<Texture2D>();
  function releaseFileMaps(part: ModelPart): void {
    for (const texture of [part.colour, part.normal]) {
      if (texture === undefined || released.has(texture)) continue;
      released.add(texture);
      releaseTexture(texture);
    }
  }

  /**
   * The file's own maps a bake draws with (a crown's), held by the forest for as long as it stands. Lite's loader
   * leaves a file's map to the draws that take it up and lets it go with the last of them, and a bake's draws are made
   * and let go while the near crowns' may not have been made yet: unheld, the crown's maps would go with the bake.
   */
  const held = new Set<Texture2D>();
  function holdFileMaps(part: ModelPart): void {
    for (const texture of [part.colour, part.normal]) {
      if (texture === undefined || held.has(texture)) continue;
      held.add(texture);
      acquireTexture(texture);
    }
  }

  /** A mesh of a bucket: `part`'s geometry with `uvs`, hidden and holding no instance until its first list. */
  function bucketMesh(name: string, part: ModelPart, uvs: Float32Array, tangents: Float32Array | null, made: PbrMaterialProps): Mesh {
    // The geometry is copied: a second bucket set of one model draws its own.
    const mesh = createMeshFromData(engine, name, part.positions.slice(), part.normals.slice(), part.indices.slice(), uvs, undefined, tangents ?? undefined);
    mesh.material = made;
    return mesh;
  }

  /** The bucket of `meshes`, each reading the per-instance attributes of `layouts`, added to the scene hidden. */
  function bucket(meshes: Mesh[], layouts: VegetationInstanceLayout[], fade: FadeBands): Bucket {
    const made: Bucket = { meshes, layouts, data: [], fade, matrices: new Float32Array(FIRST_CAPACITY * 16), capacity: FIRST_CAPACITY, count: 0 };
    meshes.forEach((mesh, i) => {
      const floats = (layouts[i] as VegetationInstanceLayout).floats;
      setThinInstances(mesh, made.matrices, made.capacity);
      const data = floats > 0 ? new Float32Array(made.capacity * floats) : null;
      made.data.push(data);
      if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = data;
      setThinInstanceCount(mesh, 0);
      setMeshVisible(mesh, false);
      addToScene(scene, mesh);
    });
    buckets.push(made);
    return made;
  }

  /** A bark part's coordinates under its dressing's transform (`barkUv`): the material takes no texture transform. */
  function barkUvs(part: ModelPart, look: BarkLook): Float32Array {
    const uvs = new Float32Array(part.uvs.length);
    for (let i = 0; i + 1 < uvs.length; i += 2) barkUv(look.transform, part.uvs[i] as number, part.uvs[i + 1] as number, uvs, i);
    return uvs;
  }

  /**
   * One species' buckets from its model, one set of three LODs a bark it
   * wears: the sets share the crown's two materials (LOD0 and LOD1's with
   * the foliage, LOD2's without) and each wears its own bark's two.
   */
  function adoptTrees(
    name: string, model: LoadedModel, barks: readonly { look: BarkLook; maps: BarkMaps }[], mossMap: Texture2D, kind: "giant" | "sapling", slot: number,
  ): [Bucket, Bucket, Bucket][] {
    const lods = TREE_LODS.map((lod) => model.get(lod) ?? []);
    const first = lods[0] as readonly ModelPart[];
    // A set's billboard is baked from, and sized by, the second LOD: detail enough for the bake, cheaper than the first.
    // A model with no second LOD bakes its first.
    const second = lods[1] as readonly ModelPart[];
    const source = second.length > 0 ? second : first;
    const box = boxOf(source);
    for (const part of source) if (part.facts.alphaMask) holdFileMaps(part);
    const crown = first.find((part) => part.facts.alphaMask);
    const bark = first.find((part) => !part.facts.alphaMask);
    // The foliage's height is the model's: its origin is at its footprint's base. Motion reaches zero where ring 1 has dissolved.
    const sway = (part: ModelPart): FoliageLook => {
      const look = foliageLook(part.facts.material ?? name, FOLIAGE_PROFILES.TREE, part.max.y);
      look.edges = fades.lod1Out;
      return look;
    };
    const crownNear = crown === undefined ? null : crownMaterial(crown, { foliage: sway(crown) });
    const crownFar = crown === undefined ? null : crownMaterial(crown, { foliage: null });
    return barks.map((dressing, k) => {
      // The set's billboard, its bake asked for now: the crown's cards and the set's bark under the moss, as the near
      // trees wear them, with nothing that moves and nothing the weather does.
      billboards.push(billboard(`${kind}_${slot + k}`, impostorQuad(box.min, box.max), box, bakePoseMatrix(0), () => source.map((part, p) => {
        const isCrown = part.facts.alphaMask;
        const made = isCrown
          ? crownMaterial(part, null)
          : barkMaterial(part, dressing.look, dressing.maps, mossMap, null, { foliage: null, fade: false, conform: false, deadwood: null });
        return { mesh: bucketMesh(`forest_${name}_${k}_bake${p}`, part, isCrown ? part.uvs.slice() : barkUvs(part, dressing.look), isCrown ? part.tangents : null, made), instance: null };
      })));
      const barkNear = bark === undefined ? null : barkMaterial(bark, dressing.look, dressing.maps, mossMap, options.wet.bark, { foliage: sway(bark), fade: false, conform: true, deadwood: null });
      const barkFar = bark === undefined ? null : barkMaterial(bark, dressing.look, dressing.maps, mossMap, options.wet.bark, { foliage: null, fade: false, conform: true, deadwood: null });
      return lods.map((parts, lod) => {
        const meshes: Mesh[] = [];
        const layouts: VegetationInstanceLayout[] = [];
        parts.forEach((part, p) => {
          const isCrown = part.facts.alphaMask;
          const made = isCrown ? (lod < 2 ? crownNear : crownFar) : (lod < 2 ? barkNear : barkFar);
          if (made === null) return;
          // A bark's tangents follow its file's coordinates, the set's normal map the set's own: the bark carries none.
          meshes.push(bucketMesh(`forest_${name}_${k}_lod${lod}_${isCrown ? "crown" : "bark"}${p}`, part, isCrown ? part.uvs.slice() : barkUvs(part, dressing.look), isCrown ? part.tangents : null, made));
          layouts.push(vegetationInstanceLayout({ foliage: null, fade: isCrown, conform: true, deadwood: null }));
          if (!isCrown) releaseFileMaps(part);
        });
        return bucket(meshes, layouts, fades.lods[lod] as FadeBands);
      }) as [Bucket, Bucket, Bucket];
    });
  }

  /** The dead trees' one bucket: a trunk bark set under dead wood's tone, laid along the trunk by its plugin. */
  function adoptDeadwood(parts: readonly ModelPart[], look: BarkLook, set: BarkMaps, mossMap: Texture2D): void {
    const positions = parts.flatMap((part) => Array.from(part.positions));
    const measure = deadwoodMeasure(positions);
    const meshes: Mesh[] = [];
    const layouts: VegetationInstanceLayout[] = [];
    const dressing = { base: measure.snagBaseOffset };
    parts.forEach((part, p) => {
      // Drawn on both sides, lit on one: a log is mirrored by its draw, which turns its winding.
      const made = barkMaterial(
        { ...part, facts: { ...part.facts, doubleSided: true } }, look, set, mossMap, options.wet.deadwood,
        { foliage: null, fade: true, conform: false, deadwood: dressing }, [oneSidedLightPlugin()],
      );
      meshes.push(bucketMesh(`forest_deadwood_${p}`, part, part.uvs.slice(), null, made));
      layouts.push(vegetationInstanceLayout({ foliage: null, fade: true, conform: false, deadwood: dressing }));
      releaseFileMaps(part);
    });
    deadwood = { bucket: bucket(meshes, layouts, fades.deadwood), measure };
    // The snags' billboard, baked from the same LOD stood up: the model lies down, and a snag stands its trunk up by
    // this roll. Each bake mesh is drawn as an instance that reads a snag's role, nothing. Its bark's normals are
    // read turned over, as the game's own bake of the snag reads them (`oneSidedLightPlugin`).
    const pose = bakePoseMatrix(SNAG_BAKE_ROLL);
    const still = { foliage: null, fade: false, conform: false, deadwood: dressing };
    billboards.push(billboard("snag", snagImpostorQuad(measure), posedBounds(pose, parts.map((part) => part.positions)), pose, () => parts.map((part, p) => {
      const made = barkMaterial({ ...part, facts: { ...part.facts, doubleSided: true } }, look, set, mossMap, null, still, [oneSidedLightPlugin(true)]);
      return { mesh: bucketMesh(`forest_deadwood_bake${p}`, part, part.uvs.slice(), null, made), instance: new Float32Array(vegetationInstanceLayout(still).floats) };
    })));
  }

  /**
   * What grows on the nurse logs, a bucket each. A plant on a log is too small to need the wind and stands off the
   * ground, so neither sways, conforms nor takes the ground's tint: both dither out by their distance, are matt, and
   * are drawn on both sides and lit on one.
   */
  function adoptNurse(ferns: readonly ModelPart[]): void {
    const still = { foliage: null, fade: true, conform: false, deadwood: null };
    const plain = { metallicFactor: 0, roughnessFactor: 1, doubleSided: true };
    const tint = coverAlbedoTint(NURSE_FERN_ID);
    const fernMeshes = ferns.map((part, p) => {
      // The file's cards in the cover's green, under the cards' contrast, which lifts the shade the texture bakes into
      // its dark texels: the foliage's colour block alone, at a profile that moves and tints nothing. The card's
      // normals are its mesh's: the file's map of them is not worn.
      const look = foliageLook(`${part.facts.material ?? NURSE_FERN_ID}_nurse`, FOLIAGE_PROFILES.NURSE, part.max.y, { contrast: FOLIAGE_CARD_CONTRAST });
      const made = material(
        { ...plain, doubleSided: part.facts.doubleSided, baseColorTexture: part.colour, baseColorFactor: [tint.r, tint.g, tint.b, 1] },
        0,
        [...(part.facts.doubleSided ? [oneSidedLightPlugin()] : []), vegetationPlugin({ eye: options.eye, frame: options.frame, match: false, light: false, moss: null, sky: false, ...still, foliage: look })],
        options.wet.leaf,
      );
      if (part.facts.alphaMask) setPbrAlphaCutoff(made, part.facts.alphaCutoff);
      // Nothing reads the file's map of normals: it goes.
      if (part.normal !== undefined && !released.has(part.normal)) {
        released.add(part.normal);
        releaseTexture(part.normal);
      }
      return bucketMesh(`nurse_fern_${p}`, part, part.uvs.slice(), null, made);
    });
    // The seedling is built in code (`seedlingGeometry`): white under its own vertex colours.
    const seedling = seedlingGeometry();
    const seedlingMesh = createMeshFromData(engine, "nurse_seedling", seedling.positions, seedling.normals, Uint32Array.from(seedling.indices), undefined, undefined, undefined, seedling.colors);
    seedlingMesh.material = material(
      { ...plain, baseColorFactor: [1, 1, 1, 1] },
      0,
      [oneSidedLightPlugin(), vegetationPlugin({ eye: options.eye, frame: options.frame, match: false, light: false, moss: null, sky: false, ...still })],
      options.wet.leaf,
    );
    const layout = vegetationInstanceLayout(still);
    nurse = { ferns: bucket(fernMeshes, fernMeshes.map(() => layout), NURSE_BANDS), seedlings: bucket([seedlingMesh], [layout], NURSE_BANDS) };
  }

  /**
   * One billboard, its bake asked for: `of` is its cohort and slot, `box` the box of what is baked as it is posed by
   * `pose`, and `meshes` makes the bake's own meshes, in its own materials, when its turn comes.
   */
  function billboard(of: string, quad: ImpostorQuad, box: { min: Vec3; max: Vec3 }, pose: Float32Array, meshes: () => BakeMesh[]): Billboard {
    const made: Billboard = { quad, bake: { name: impostorName(of), state: "baking", ms: null }, startedAt: performance.now(), bucket: null };
    const slot = billboards.length;
    bakes.push(bakeBillboard(made, slot, box, pose, meshes));
    return made;
  }

  /**
   * A billboard's bake, to its end: the two pictures drawn and read back, their distance field made, and the card
   * dressed in them. It says once that it is still waiting at `IMPOSTOR_BAKE_WARN_MS` and gives up, saying so, at
   * `IMPOSTOR_BAKE_FAIL_MS`; a bake that fails or gives up leaves its billboard undrawn and its record `failed`. One
   * ended by the forest's leaving or by `abandon` says nothing and stays as it stood.
   */
  async function bakeBillboard(board: Billboard, slot: number, box: { min: Vec3; max: Vec3 }, pose: Float32Array, meshes: () => BakeMesh[]): Promise<void> {
    const name = board.bake.name;
    const fail = (): void => {
      if (disposed || abandoned) return;
      board.bake.state = "failed";
      board.bake.ms = performance.now() - board.startedAt;
      console.error(`forest impostor: no bake for ${name}`);
    };
    const frame = impostorBakeFrame(box.min, box.max);
    if (frame === null) {
      fail();
      return;
    }
    const warned = setTimeout(() => {
      if (!disposed && !abandoned) console.warn(`forest impostor bake still waiting after ${Math.round(IMPOSTOR_BAKE_WARN_MS / 1000)} s: ${name}`);
    }, IMPOSTOR_BAKE_WARN_MS);
    let bound: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<"late">((resolve) => {
      bound = setTimeout(() => resolve("late"), IMPOSTOR_BAKE_FAIL_MS);
    });
    try {
      const made = baker
        .bake(meshes, pose, frame)
        .then((pictures) => (pictures === null ? null : fieldMaker.fields(pictures.albedo, pictures.normal, IMPOSTOR_BAKE_SIZE, IMPOSTOR_BAKE_SIZE)));
      const fields = await Promise.race([made, gaveUp]);
      if (fields === "late") {
        // What it makes after this is dropped: the card keeps nothing.
        void made.catch(() => undefined);
        if (!disposed && !abandoned) console.error(`forest impostor bake gave up after ${Math.round(IMPOSTOR_BAKE_FAIL_MS / 1000)} s: ${name}`);
        fail();
        return;
      }
      // No pictures or no fields: the baker or the maker of fields was ended, with the forest or by `abandon`.
      if (fields === null || fields.normal === null || disposed || abandoned) {
        fail();
        return;
      }
      dress(board, fields.albedo, fields.normal);
      board.bake.state = "ready";
      board.bake.ms = performance.now() - board.startedAt;
      // A rebuild may have split the far lists while the bake was drawn: the card takes its own now.
      fillBillboard(slot);
      invalidateRenderBundles(engine);
    } catch (error) {
      if (!disposed && !abandoned) console.error(`forest impostor bake failed: ${name}`, error);
      fail();
    } finally {
      clearTimeout(warned);
      clearTimeout(bound);
    }
  }

  /**
   * A billboard's card in its bake: the field's colour, kept in gamma space and decoded where it is read, as the game
   * keeps it, with the field's signed distance as the alpha the card tests at the rim; the field's normals; lit once,
   * live, as a crown, matt, on both of its sides by the one normal; glazed by the weather as a leaf.
   */
  function dress(board: Billboard, albedo: Uint8Array, normal: Uint8Array): void {
    const colour = createTexture2DFromPixels(engine, albedo, IMPOSTOR_BAKE_SIZE, IMPOSTOR_BAKE_SIZE, { mipMaps: true });
    const normals = createTexture2DFromPixels(engine, cardNormals(normal), IMPOSTOR_BAKE_SIZE, IMPOSTOR_BAKE_SIZE, { mipMaps: true });
    // Sampled as the game samples them: between levels, repeating, with the anisotropy Babylon.js gives such a map.
    const sampler = getOrCreateSampler(engine, {
      addressModeU: "repeat", addressModeV: "repeat", minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", maxAnisotropy: CARD_ANISOTROPY,
    });
    colour.sampler = sampler;
    normals.sampler = sampler;
    baked.push(colour, normals);
    const fade = { foliage: null, fade: true, conform: false, deadwood: null };
    const made = material(
      { baseColorTexture: colour, normalTexture: normals, metallicFactor: 0, roughnessFactor: 1, doubleSided: true, environmentIntensity: CROWN_SKY },
      TREE_SPECULAR_WEIGHT,
      [oneSidedLightPlugin(), vegetationPlugin({ eye: options.eye, frame: options.frame, match: false, light: false, moss: null, sky: false, ...fade })],
      options.wet.leaf,
    );
    setPbrAlphaCutoff(made, IMPOSTOR_FIELD_CUT);
    setPbrGammaAlbedo(made);
    const card = cardGeometry(board.quad);
    const mesh = createMeshFromData(engine, board.bake.name, card.positions, card.normals, card.indices, card.uvs);
    mesh.material = made;
    // The bands are each instance's own (`fillBillboard`): the bucket's are the lattice's, for a list that carries none.
    board.bucket = bucket([mesh], [vegetationInstanceLayout(fade)], fades.impostorLattice);
  }

  /**
   * A billboard's two lists onto its one card, the lattice's first and then the fill's, as the last rebuild split
   * them: each quad turned to where the camera then stood, its bands those of its list.
   */
  function fillBillboard(slot: number): void {
    const board = billboards[slot];
    if (board === null || board === undefined || board.bucket === null || far === null) return;
    const lattice = far.lattice[slot] ?? [];
    const fill = far.fill[slot] ?? [];
    const matrices = finish(impostorMatrixSlices(lattice, fill, board.quad.centreY, far.x, far.z));
    apply(board.bucket, matrices, { fadeBands: impostorFadeBuffer(lattice.length, fill.length, fades) });
  }

  /** A bucket's new list: its matrices and what its materials read an instance (its own bands, where `from` carries them), written over the old. */
  function apply(target: Bucket, matrices: Float32Array, from: { groundGrad?: Float32Array; deadwoodRole?: Float32Array; fadeBands?: Float32Array }): void {
    const count = matrices.length / 16;
    if (count > target.capacity) {
      // Outgrown: new arrays with room to spare, so a walk through thicker forest does not take new ones each cell.
      target.capacity = Math.ceil(count * 1.5);
      target.matrices = new Float32Array(target.capacity * 16);
      target.meshes.forEach((mesh, i) => {
        const floats = (target.layouts[i] as VegetationInstanceLayout).floats;
        const data = floats > 0 ? new Float32Array(target.capacity * floats) : null;
        target.data[i] = data;
        setThinInstances(mesh, target.matrices, target.capacity);
        if (mesh.thinInstances !== undefined && mesh.thinInstances !== null) mesh.thinInstances.pluginData = data;
      });
    }
    target.matrices.set(matrices);
    target.count = count;
    // A bucket's bands are one for its every instance, but a billboard's, whose two lists end at different ranges.
    const fadeBands = from.fadeBands ?? fadeBandsBuffer(count, target.fade);
    target.meshes.forEach((mesh, i) => {
      const data = target.data[i];
      if (data !== null && data !== undefined) {
        writeVegetationInstances(target.layouts[i] as VegetationInstanceLayout, count, { ...from, fadeBands }, data);
        const instances = mesh.thinInstances;
        if (instances !== undefined && instances !== null) instances.pluginVersion = (instances.pluginVersion ?? 0) + 1;
      }
      setThinInstanceCount(mesh, count);
      setMeshVisible(mesh, count > 0);
    });
  }

  /** The lists for a camera at (x, z), as slices: the bands collected, then every bucket's list made and written. */
  function* rebuild(x: number, z: number): Slices {
    const bands = yield* collector.collectSlices(x, z, nearRadius);
    yield;
    if (deadwood !== null) {
      const { bucket: target, measure } = deadwood;
      const matrices = deadwoodMatrixBuffer(seed, bands.deadwood, measure.snagBaseOffset, measure.logMinX, measure.logMaxX, measure.logSeat);
      apply(target, matrices, { deadwoodRole: deadwoodRoleBuffer(bands.deadwood) });
      if (nurse !== null) {
        // What grows on the logs, placed on each log's own matrix.
        const plants = nurseBuffers(bands.deadwood, matrices, measure.logMinX, measure.logMaxX, measure.logTop, measure.logSeat.diameter);
        apply(nurse.ferns, plants.ferns, {});
        apply(nurse.seedlings, plants.seedlings, {});
      }
    }
    const trees = (target: Bucket, list: readonly TreeInstance[]): void => apply(target, treeMatrixBuffer(list, false), { groundGrad: groundGradBuffer(list) });
    for (const [s, lods] of giants.entries()) {
      const set = GIANT_SETS[s] as (typeof GIANT_SETS)[number];
      lods.forEach((target, lod) => trees(target, (bands.near[lod] as TreeInstance[]).filter((t) => inGiantSet(set, t.species, t.variant))));
      yield;
    }
    for (const [s, lods] of saplings.entries()) {
      if (lods === null) continue;
      lods.forEach((target, lod) => trees(target, (bands.saplings[lod] as TreeInstance[]).filter((t) => t.species === s)));
      yield;
    }
    // The far trees: each list split in one pass by the billboard that draws the tree, a giant by its bucket set.
    const giantSlot = (t: TreeInstance): number => (giants.length === 0 ? -1 : GIANT_SETS.findIndex((set) => inGiantSet(set, t.species, t.variant)));
    far = {
      lattice: partitionImpostors(bands.impostors, giantSlot, giants.length, saplings.length),
      fill: partitionImpostors(bands.impostorsFill, giantSlot, giants.length, saplings.length),
      x, z,
    };
    yield;
    for (let slot = 0; slot < billboards.length; slot++) {
      fillBillboard(slot);
      yield;
    }
    // Plugin instance data goes up as its draw is recorded again.
    invalidateRenderBundles(engine);
  }

  /** Rebuilds when the camera's origin on the tree cells' lattice has moved: the bands are a function of it alone. */
  function maybeBuild(): void {
    if (!adopted || disposed || Number.isNaN(camX)) return;
    const origin = bandsOrigin(camX, camZ);
    if (crossingAt(crossing, camX, camZ, origin.x, origin.z, TREE_CELL, false) === "none") return;
    finish(rebuild(camX, camZ));
  }

  async function load(): Promise<void> {
    const one = async (output: string, lods: readonly string[]): Promise<LoadedModel> => {
      try {
        return await loadModel(engine, modelUrl(output), lods, loads.signal);
      } finally {
        waiting--;
      }
    };
    const dress = async (bark: BarkDressing, tone?: { r: number; g: number; b: number }): Promise<{ look: BarkLook; maps: BarkMaps }> => {
      const look = barkLook(bark, barkSize(options.tier, bark), tone);
      return { look, maps: await barkMaps(look) };
    };
    // Everything is asked for at once and adopted in the game's order: the giants, the saplings, the dead trees and
    // what grows on them.
    const giantModels = GIANT_MODELS.map((output) => one(output, TREE_LODS));
    const saplingModels = SAPLING_MODELS.map((output) => one(output, TREE_LODS));
    const deadwoodLod = options.tier === "high" ? "LOD0" : "LOD1";
    const deadwoodModel = one(DEADWOOD_MODEL, [deadwoodLod]);
    const fernModel = one(NURSE_FERN_MODEL, [NURSE_FERN_LOD]);
    const giantBarks = GIANT_SETS.map((set) => dress(set.bark));
    const saplingBarks = SAPLING_BARKS.map((bark) => dress(bark));
    const deadwoodBark = dress(DEADWOOD_BARK, DEADWOOD_TONE);
    // A model or a map that fails is waited out, so no load is left running against a forest that gave up.
    const settled = await Promise.allSettled([moss, ...giantModels, ...saplingModels, deadwoodModel, fernModel, ...giantBarks, ...saplingBarks, deadwoodBark]);
    if (disposed) return;
    const failed = settled.find((result) => result.status === "rejected");
    if (failed !== undefined) throw (failed as PromiseRejectedResult).reason;
    const mossMap = await moss;
    for (const [species, pending] of giantModels.entries()) {
      const barks = await Promise.all(giantBarks.filter((_, i) => (GIANT_SETS[i] as (typeof GIANT_SETS)[number]).species === species));
      giants.push(...adoptTrees(`giant_${species}`, await pending, barks, mossMap, "giant", giants.length));
    }
    for (const [species, pending] of saplingModels.entries()) {
      const bark = saplingBarks[species];
      // A sapling species the barks do not name has no dressing to wear, and is not drawn, near or far.
      if (bark === undefined) {
        saplings.push(null);
        billboards.push(null);
        continue;
      }
      saplings.push(adoptTrees(`sapling_${species}`, await pending, [await bark], mossMap, "sapling", species)[0] ?? null);
    }
    const dead = await deadwoodBark;
    adoptDeadwood((await deadwoodModel).get(deadwoodLod) ?? [], dead.look, dead.maps, mossMap);
    adoptNurse((await fernModel).get(NURSE_FERN_LOD) ?? []);
    adopted = true;
    // A camera that arrived while the models loaded is honoured now.
    maybeBuild();
  }

  const landed = load().catch((error: unknown) => {
    waiting = 0;
    // A missing or broken asset costs the trees, never the hike; a dispose mid-load ends here too, and says nothing.
    if (!disposed && !abandoned) console.error("the forest's trees could not be made; none is drawn", error);
  });
  // Every bake is asked for by the time the models are adopted; once the last has settled, what made them goes.
  const ready = landed.then(() => Promise.all(bakes)).then(() => {
    baker.dispose();
    fieldMaker.dispose();
  });

  return {
    update(x, z) {
      if (disposed) return;
      camX = x;
      camZ = z;
      maybeBuild();
    },
    frame() {
      for (const made of materials) markMaterialUboDirty(made);
    },
    waiting() {
      return Math.max(0, waiting);
    },
    ready,
    drawn() {
      let meshes = 0;
      let instances = 0;
      for (const made of buckets) {
        if (made.count === 0) continue;
        meshes += made.meshes.length;
        instances += made.count * made.meshes.length;
      }
      return { meshes, instances };
    },
    impostorBakes() {
      return billboards.filter((board) => board !== null).map((board) => ({ ...board.bake }));
    },
    abandon() {
      abandoned = true;
      loads.abort();
      baker.dispose();
      fieldMaker.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      // A bake in flight ends without its pictures, and one waiting on its fields is answered with none.
      baker.dispose();
      fieldMaker.dispose();
      for (const texture of baked) releaseTexture(texture);
      baked.length = 0;
      for (const texture of held) releaseTexture(texture);
      held.clear();
      far = null;
      nurse = null;
      for (const made of buckets) {
        for (const mesh of made.meshes) {
          removeFromScene(scene, mesh);
          disposeMeshGpu(mesh);
        }
      }
      buckets.length = 0;
      materials.length = 0;
      adopted = false;
    },
  };
}
