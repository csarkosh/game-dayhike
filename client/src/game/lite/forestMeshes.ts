/**
 * The forest's trees on Babylon Lite: the near rings of full geometry, the
 * canopy giants and the saplings at three LODs each, and the dead trees, a
 * standing snag and a fallen log in one bucket. Every bucket is a mesh a
 * primitive (a tree's bark and its crown are two) drawn as thin instances.
 *
 * What each bucket is drawn with is the game's own, made with no engine:
 * the bands `forestField.ts` collects round the camera, the matrices and the
 * per-instance attributes `forestInstances.ts` makes of them, the fade bands
 * of each ring, the bark each tree wears (`barkParams.ts`), each material's
 * share of the sky (`forestLookParams.ts`) and the foliage's numbers
 * (`foliageUniforms.ts`). This module is where those meet Lite: the models
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
 * **Not drawn here:** the far billboards (their bake is a render of the
 * models the renderer does not make yet), and what grows on the nurse logs.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, invalidateRenderBundles, markMaterialUboDirty, releaseTexture,
  removeFromScene, setMeshVisible, setPbrAlphaCutoff, setPbrMetallicReflectance, setThinInstanceCount, setThinInstances,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import { TREE_CELL, type TreeInstance } from "../../sim/vegetation.js";
import { modelUrl, textureUrl } from "../assetUrls.js";
import {
  GIANT_SETS, SAPLING_BARKS, barkLook, barkSize, barkUv, inGiantSet, type BarkDressing, type BarkLook,
} from "../barkParams.js";
import { DEADWOOD_BARK, DEADWOOD_TONE } from "../deadwoodParams.js";
import type { FadeBands } from "../distanceFade.js";
import { FOLIAGE_PROFILES, foliageLook, type FoliageLook } from "../foliageUniforms.js";
import { NEAR_RADIUS, bandsOrigin, createBandCollector } from "../forestField.js";
import {
  deadwoodMatrixBuffer, deadwoodMeasure, deadwoodRoleBuffer, fadeBandsBuffer, forestFadeBands, groundGradBuffer, treeMatrixBuffer,
  type DeadwoodMeasure,
} from "../forestInstances.js";
import { treeSkyLook } from "../forestLookParams.js";
import { MOSS_OUTPUT } from "../mossParams.js";
import type { QualityTier } from "../quality.js";
import { createCrossing, crossingAt, finish, type Slices } from "../syncJobs.js";
import type { WetUniforms } from "../wetSurface.js";
import { loadKtx2Map, loadModel, type LoadedModel, type ModelPart } from "./forestModels.js";
import {
  baseColourPlugin, directOcclusionPlugin, oneSidedLightPlugin, surfaceWetPlugin, vegetationInstanceLayout, vegetationPlugin, writeVegetationInstances,
  type Vegetation, type VegetationInstanceLayout,
} from "./forestPlugins.js";

/** The canopy giants' models by `TreeInstance.species`: the fir, then the pine. */
const GIANT_MODELS = ["models/tree.giant_fir.glb", "models/tree.giant_pine.glb"];
/** The saplings' models by `TreeInstance.species`: the two conifers, then the alder. */
const SAPLING_MODELS = ["models/tree.conifer_a.glb", "models/tree.conifer_b.glb", "models/tree.alder.glb"];
/** The dead trees' one model, both roles. */
const DEADWOOD_MODEL = "models/deadwood.snag.glb";
const TREE_LODS = ["LOD0", "LOD1", "LOD2"] as const;

/** A dielectric's reflectance at normal incidence from its index of refraction. */
const reflectanceOf = (ior: number): number => ((ior - 1) / (ior + 1)) ** 2;

/** Instances a bucket's arrays hold before its first list: a bucket in view of no tree still stands, hidden. */
const FIRST_CAPACITY = 16;

export type ForestMeshes = {
  /** Follows the camera: the lists are made again when it crosses a tree cell. Before the models have landed it only keeps where the camera is. */
  update(camX: number, camZ: number): void;
  /** Once a frame: every material's uniforms are written again, for the wind and the eye move. */
  frame(): void;
  /** Models and maps still being fetched or decoded. */
  waiting(): number;
  /** Resolves once the models have landed and the first lists are drawn, or cannot be: a failure is said and costs the trees alone. */
  readonly ready: Promise<void>;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
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
  let disposed = false;
  let adopted = false;
  let waiting = GIANT_MODELS.length + SAPLING_MODELS.length + 1;
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

  /** A material of the forest's: Lite's PBR with `plugins`, the wet look at `wet` and the air, lit by the scene's lights as the terrain is. */
  function material(props: Partial<PbrMaterialProps>, specularWeight: number, plugins: MaterialPlugin[], wet: WetUniforms): PbrMaterialProps {
    const made = createPbrMaterial({ usePhysicalLightFalloff: true, ...props });
    // The specular weight scales the reflectance at normal incidence and at grazing angles both.
    setPbrMetallicReflectance(made, { color: [1, 1, 1], f0Factor: specularWeight });
    made.plugins = [baseColourPlugin(), ...plugins, surfaceWetPlugin(wet), options.air()];
    materials.push(made);
    return made;
  }

  /** A crown's material: its file's cards, alpha-tested, under the crown's share of the sky. */
  function crownMaterial(part: ModelPart, vegetation: Pick<Vegetation, "foliage">): PbrMaterialProps {
    const look = treeSkyLook(true, part.facts.specularWeight);
    const made = material(
      {
        baseColorTexture: part.colour, normalTexture: part.normal, metallicFactor: 0, roughnessFactor: 1,
        doubleSided: part.facts.doubleSided, environmentIntensity: look.sky,
        ...(part.facts.ior === null ? {} : { reflectance: reflectanceOf(part.facts.ior) }),
      },
      look.specularWeight,
      [vegetationPlugin({ eye: options.eye, frame: options.frame, match: false, light: false, fade: true, conform: true, moss: null, deadwood: null, sky: false, ...vegetation })],
      options.wet.leaf,
    );
    setPbrAlphaCutoff(made, part.facts.alphaCutoff);
    return made;
  }

  /** A bark's material: a bark set's three maps under its tone, the map's own occlusion, roughness and metalness, and the moss. */
  function barkMaterial(
    part: ModelPart, look: BarkLook, set: BarkMaps, mossMap: Texture2D, wet: WetUniforms,
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
  function adoptTrees(name: string, model: LoadedModel, barks: readonly { look: BarkLook; maps: BarkMaps }[], mossMap: Texture2D): [Bucket, Bucket, Bucket][] {
    const lods = TREE_LODS.map((lod) => model.get(lod) ?? []);
    const first = lods[0] as readonly ModelPart[];
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
  }

  /** A bucket's new list: its matrices and what its materials read an instance, written over the old. */
  function apply(target: Bucket, matrices: Float32Array, from: { groundGrad?: Float32Array; deadwoodRole?: Float32Array }): void {
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
    const fadeBands = fadeBandsBuffer(count, target.fade);
    target.meshes.forEach((mesh, i) => {
      const data = target.data[i];
      if (data !== null && data !== undefined) {
        writeVegetationInstances(target.layouts[i] as VegetationInstanceLayout, count, { fadeBands, ...from }, data);
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
    // Everything is asked for at once and adopted in the game's order: the giants, the saplings, the dead trees.
    const giantModels = GIANT_MODELS.map((output) => one(output, TREE_LODS));
    const saplingModels = SAPLING_MODELS.map((output) => one(output, TREE_LODS));
    const deadwoodLod = options.tier === "high" ? "LOD0" : "LOD1";
    const deadwoodModel = one(DEADWOOD_MODEL, [deadwoodLod]);
    const giantBarks = GIANT_SETS.map((set) => dress(set.bark));
    const saplingBarks = SAPLING_BARKS.map((bark) => dress(bark));
    const deadwoodBark = dress(DEADWOOD_BARK, DEADWOOD_TONE);
    // A model or a map that fails is waited out, so no load is left running against a forest that gave up.
    const settled = await Promise.allSettled([moss, ...giantModels, ...saplingModels, deadwoodModel, ...giantBarks, ...saplingBarks, deadwoodBark]);
    if (disposed) return;
    const failed = settled.find((result) => result.status === "rejected");
    if (failed !== undefined) throw (failed as PromiseRejectedResult).reason;
    const mossMap = await moss;
    for (const [species, pending] of giantModels.entries()) {
      const barks = await Promise.all(giantBarks.filter((_, i) => (GIANT_SETS[i] as (typeof GIANT_SETS)[number]).species === species));
      giants.push(...adoptTrees(`giant_${species}`, await pending, barks, mossMap));
    }
    for (const [species, pending] of saplingModels.entries()) {
      const bark = saplingBarks[species];
      // A sapling species the barks do not name has no dressing to wear, and is not drawn.
      saplings.push(bark === undefined ? null : (adoptTrees(`sapling_${species}`, await pending, [await bark], mossMap)[0] ?? null));
    }
    const dead = await deadwoodBark;
    adoptDeadwood((await deadwoodModel).get(deadwoodLod) ?? [], dead.look, dead.maps, mossMap);
    adopted = true;
    // A camera that arrived while the models loaded is honoured now.
    maybeBuild();
  }

  const ready = load().catch((error: unknown) => {
    waiting = 0;
    // A missing or broken asset costs the trees, never the hike; a dispose mid-load ends here too, and says nothing.
    if (!disposed) console.error("the forest's trees could not be made; none is drawn", error);
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
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
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
