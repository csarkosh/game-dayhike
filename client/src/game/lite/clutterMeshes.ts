/**
 * The ground clutter on Babylon Lite: the grass, meadow, flower, bush and
 * fern cards, the shrubs and the wet and high ground's plants, and the
 * rocks, boulders, driftwood, fungus, litter and drift logs, two LOD levels
 * deep. Every bucket is a mesh drawn as thin instances (`listMeshes.ts`).
 *
 * What each bucket is drawn with is the game's own, made with no engine:
 * which model and LOD a class draws, its profile and wet cap
 * (`clutterInstances.ts`), the lists of instances round the eye with their
 * matrices, fade bands and ground tints (`clutterLists.ts`), the stones'
 * cuts (`rockRelief.ts`), the plants built in code (`shrubClump.ts`,
 * `wetPlantClump.ts`, `highPlantClump.ts`), the cards' tint and contrast
 * (`coverAlbedoParams.ts`) and the foliage's numbers (`foliageUniforms.ts`).
 * This module is where those meet Lite: the models its loader reads
 * (`forestModels.ts`) and a PBR material a class's model with the
 * vegetation's plugins (`forestPlugins.ts`).
 *
 * **The materials**, as `clutterMeshes.ts` dresses them on Babylon.js. A
 * class that sways (the cards and the plants) wears the foliage at its
 * profile with the foliage's own light, its far level's edges, and for a
 * card model its tint toward the cover's green and the cards' contrast;
 * cover matched to the ground glints nowhere. A material dithers across its
 * bucket's bands, and widens with distance where its class does, only where
 * it alpha-tests already: the stones, the wood, the fungus and the plants
 * built in code hand off by their geometry. A drift log's bark is bleached.
 * A plant built in code is white under its own vertex colours, drawn on
 * both sides and lit on one. Every material takes the wet look at its
 * class's cap and the air.
 *
 * **The stones are cut** as the game cuts them: each rock and boulder model
 * into `ROCK_CUTS` fractures, one plane list a model and a cut for both of
 * its LOD levels, a bucket a cut.
 *
 * **The lists follow the eye.** They are made again when the eye crosses a
 * grass cell (3 m): at a walk as a job of the renderer's scheduler
 * (`rebuildJobs.ts`), whose last slice fills every bucket's list and shows
 * them together, so no frame draws one bucket moved on against another that
 * has not; between crossings the cells the next one adds are looked up as
 * idle work. The grass class's are cut to the view on the tiers that ask
 * for it.
 */
import {
  createMeshFromData, createPbrMaterial, disposeMeshGpu, invalidateRenderBundles, markMaterialUboDirty, removeFromScene, setPbrAlphaCutoff,
  setPbrMetallicReflectance,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import { CLUTTER_CLASS_COUNT, CLUTTER_DRIFTLOG, CLUTTER_GRASS_CELL, CLUTTER_HIGHPLANT, CLUTTER_SHRUB, CLUTTER_WETPLANT } from "../../sim/clutter.js";
import { modelUrl } from "../assetUrls.js";
import { clutterFadeEdges, coverWiden } from "../clutterField.js";
import {
  CLUTTER_MODEL_IDS, CUT_CLASSES, DRIFTLOG_BLEACH, FAR_LOD, FOLIAGE_BY_CLASS, NEAR_LOD, SHRUB_F0, SHRUB_ROUGHNESS, WET_CAP_BY_CLASS, clutterLodNames,
  clutterNearLodName, cutModel, seatDriftLogs,
} from "../clutterInstances.js";
import { createClutterLists, type ClutterBucket, type ClutterLists } from "../clutterLists.js";
import type { FirstBuilds } from "../firstBuilds.js";
import { FOLIAGE_CARD_CONTRAST, coverAlbedoTint } from "../coverAlbedoParams.js";
import { foliageLook, foliageMatched, type FoliageLook, type FoliageProfile } from "../foliageUniforms.js";
import type { CullPose } from "../grassCull.js";
import { HIGH_PLANT_COUNT, highPlantGeometry } from "../highPlantClump.js";
import { ROCK_CUTS, rockPlanes, rockRelief } from "../rockRelief.js";
import { SHRUB_CHARACTERS, shrubGeometry } from "../shrubClump.js";
import type { Slices, SyncJobs } from "../syncJobs.js";
import { WET_PLANT_COUNT, wetPlantGeometry } from "../wetPlantClump.js";
import type { WetUniforms } from "../wetSurface.js";
import { loadModel, type LoadedModel, type ModelPart } from "./forestModels.js";
import {
  baseColourPlugin, oneSidedLightPlugin, surfaceWetPlugin, vegetationInstanceLayout, vegetationPlugin, type Vegetation,
} from "./forestPlugins.js";
import { DRAW_ORDER, createDrawOrders } from "./drawOrder.js";
import { listMesh, showList, type ListMesh } from "./listMeshes.js";
import { cellOrigin, createRebuilds } from "./rebuildJobs.js";

export type ClutterMeshes = {
  /** Follows the eye: the lists are made again when it crosses a grass cell, at a walk over the frames after. Before the models have landed it only keeps where the eye is. */
  update(camX: number, camZ: number): void;
  /** Draws the culled classes' instances inside the view of `pose` (`null`: every one), cutting again only after a rebuild or once the view has moved past the thresholds. */
  cull(pose: CullPose | null): void;
  /** Once a frame: every material's uniforms are written again, for the wind and the eye move. */
  frame(): void;
  /** Models still being fetched or decoded. */
  waiting(): number;
  /** Resolves once the models have landed and the first lists are drawn, or cannot be: a failure is said and costs the clutter alone. */
  readonly ready: Promise<void>;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
  dispose(): void;
};

export type ClutterMeshOptions = {
  /** Scales every class radius together: the quality tier's knob. */
  radiusScale: number;
  /** The blade field draws over the meadow's near cards on this tier. */
  nearBlades: boolean;
  /** Filter the grass class's buckets to the view through `cull`. */
  cull: boolean;
  /** The eye the foliage and the fade measure from: one object, moved in place each frame. */
  eye: { readonly x: number; readonly y: number; readonly z: number };
  /** The frame drawn into, its height in pixels: the fade's noise is laid on its rows. */
  frame: { readonly height: number };
  /** The wet look's uniforms at a porosity cap (`wetUniforms`): one record a cap, filled in place each frame. */
  wet: (cap: number) => WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The renderer's scheduler: given it, a crossing at a walk is a job. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike (`firstBuilds.ts`). */
  firstBuilds?: FirstBuilds;
};

/** One mesh's worth of geometry: a model's primitive, a cut of one, or a plant built in code. */
type Geometry = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  tangents?: Float32Array;
  colors?: Float32Array;
};

/** A row of a class: the material its two levels share, and each level's geometry. */
type Row = { material: PbrMaterialProps; vegetation: Vegetation | null; levels: [Geometry[], Geometry[]] };

/** The height of the tallest vertex of `positions` (xyz a vertex) over the model's own ground. */
function heightOf(positions: Float32Array): number {
  let top = 0;
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i] as number);
  return top;
}

/** A model's primitive as a mesh's geometry: its coordinates and tangents only where it reads a map. */
function geometryOf(part: ModelPart): Geometry {
  const mapped = part.colour !== undefined || part.normal !== undefined;
  return {
    positions: part.positions, normals: part.normals, indices: part.indices,
    ...(mapped ? { uvs: part.uvs } : {}),
    ...(mapped && part.tangents !== null ? { tangents: part.tangents } : {}),
  };
}

export function createClutterMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: ClutterMeshOptions): ClutterMeshes {
  const { radiusScale, nearBlades } = options;
  const loads = new AbortController();
  const materials: PbrMaterialProps[] = [];
  const meshes: Mesh[] = [];
  /** The meshes that draw each bucket of the lists, once the models have landed. */
  const drawnBy = new Map<ClutterBucket, ListMesh[]>();
  let lists: ClutterLists | null = null;
  /** Each material's place among the draws. */
  const orders = createDrawOrders(DRAW_ORDER.clutter);
  let disposed = false;
  let waiting = 0;
  let camX = Number.NaN;
  let camZ = Number.NaN;

  /** A model's file, read once however many classes draw it at the same LODs: the litter draws the rocks' and the driftwood's. */
  const models = new Map<string, Promise<LoadedModel>>();
  function model(id: string, lods: readonly string[]): Promise<LoadedModel> {
    const key = `${id}|${lods.join(",")}`;
    let pending = models.get(key);
    if (pending === undefined) {
      waiting++;
      pending = loadModel(engine, modelUrl(`models/${id}.glb`), lods, loads.signal).finally(() => {
        waiting--;
      });
      models.set(key, pending);
    }
    return pending;
  }

  /**
   * A class's material: Lite's PBR with the wet look at the class's cap and
   * the air, and where `vegetation` names any of it the foliage and the
   * fade. Its reflectance at normal incidence is `f0` of a dielectric's.
   */
  function material(cls: number, props: Partial<PbrMaterialProps>, f0: number, vegetation: Vegetation | null, more: MaterialPlugin[] = []): PbrMaterialProps {
    const made = createPbrMaterial({ metallicFactor: 0, usePhysicalLightFalloff: true, ...props });
    setPbrMetallicReflectance(made, { color: [1, 1, 1], f0Factor: f0 });
    made.plugins = [
      baseColourPlugin(), ...more,
      ...(vegetation === null ? [] : [vegetationPlugin(vegetation)]),
      surfaceWetPlugin(options.wet(WET_CAP_BY_CLASS.get(cls) as number)),
      options.air(),
    ];
    materials.push(made);
    // A class's materials are made in the game's order of classes, whichever model landed first.
    orders.take(made);
    return made;
  }

  /** What of the vegetation's stack a class's material carries: the foliage where the class sways, the dither where the material alpha-tests. */
  function vegetationOf(cls: number, look: FoliageLook | null, matched: boolean, dithers: boolean): Vegetation | null {
    if (look === null && !dithers) return null;
    const widen = dithers ? coverWiden(cls, radiusScale) : null;
    return {
      eye: options.eye, frame: options.frame, foliage: look, match: matched, light: look !== null, fade: dithers,
      ...(widen === null ? {} : { widen }),
      conform: false, moss: null, deadwood: null, sky: false,
    };
  }

  /** A swaying class's look for a material named `name`, its near level `height` tall: its far level's edges, where its motion ends and it sinks. */
  function lookOf(cls: number, profile: FoliageProfile, name: string, height: number, contrast: number): { look: FoliageLook; matched: boolean } {
    const matched = foliageMatched({ name }, profile);
    // Cover matched to the ground is lit as the ground: its cut of the sun is the ground's own.
    const look = foliageLook(name, profile, height, { contrast, sunShadowed: matched });
    const edge = clutterFadeEdges(cls, radiusScale);
    look.edges = [edge.start, edge.end];
    return { look, matched };
  }

  /** A class of models: a row a model, or for the stones a row a cut of a model. */
  function modelRows(cls: number, loaded: readonly LoadedModel[]): Row[] {
    const [nearName, farName] = clutterLodNames(cls);
    const profile = FOLIAGE_BY_CLASS.get(cls);
    const rows: Row[] = [];
    loaded.forEach((file, variant) => {
      const far = file.get(farName) ?? [];
      // The meadow's near band draws the far level's cut of the card under the blade field.
      const near = clutterNearLodName(cls, nearBlades) === "LOD0" ? (file.get(nearName) ?? []) : far;
      const first = near[0] ?? far[0];
      if (first === undefined) throw new Error(`${CLUTTER_MODEL_IDS[cls]?.[variant]}: no ${nearName} or ${farName} in the model`);
      const id = (CLUTTER_MODEL_IDS[cls] as readonly string[])[variant] as string;
      // The cards in the cover's green: a gain a channel on the file's own colour. A drift log's bark is bleached.
      const tint = profile !== undefined ? coverAlbedoTint(id) : { r: 1, g: 1, b: 1 };
      const colour: [number, number, number, number] = cls === CLUTTER_DRIFTLOG
        ? [DRIFTLOG_BLEACH[0], DRIFTLOG_BLEACH[1], DRIFTLOG_BLEACH[2], 1]
        : [first.factor[0] * tint.r, first.factor[1] * tint.g, first.factor[2] * tint.b, 1];
      const name = first.facts.material ?? id;
      const dressed = profile === undefined ? null : lookOf(cls, profile, name, heightOf(first.positions), FOLIAGE_CARD_CONTRAST);
      const vegetation = vegetationOf(cls, dressed?.look ?? null, dressed?.matched ?? false, first.facts.alphaMask);
      const made = material(
        cls,
        {
          baseColorFactor: colour, roughnessFactor: 1, doubleSided: first.facts.doubleSided,
          ...(first.colour === undefined ? {} : { baseColorTexture: first.colour }),
          ...(first.normal === undefined ? {} : { normalTexture: first.normal }),
        },
        // Matched cover glints nowhere; every other model keeps a dielectric's own reflectance.
        dressed?.matched === true ? 0 : (first.facts.specularWeight ?? 1),
        vegetation,
      );
      if (first.facts.alphaMask) setPbrAlphaCutoff(made, first.facts.alphaCutoff);
      if (!CUT_CLASSES.has(cls)) {
        rows.push({ material: made, vegetation, levels: [near.map(geometryOf), far.map(geometryOf)] });
        return;
      }
      // One plane list a model and a cut, from the near level's own vertices, for both levels: a rock cut with two
      // lists would change shape the moment its level swaps. A cut is unwelded, so it carries no tangent.
      const index = cutModel(cls, variant);
      for (let cut = 0; cut < ROCK_CUTS; cut++) {
        const planes = rockPlanes(index, cut, first.positions);
        const cutOf = (part: ModelPart): Geometry => {
          const relief = rockRelief({ positions: part.positions, normals: part.normals, uvs: part.uvs, indices: part.indices }, planes, index, cut);
          return { positions: relief.positions, normals: relief.normals, indices: relief.indices, colors: relief.colors, ...(relief.uvs === null ? {} : { uvs: relief.uvs }) };
        };
        rows.push({ material: made, vegetation, levels: [near.map(cutOf), far.map(cutOf)] });
      }
    });
    return rows;
  }

  /** A class built in code: a row a variant, white under the leaves' own vertex colours, both sides drawn and one lit. */
  function builtRows(
    cls: number, name: string, variants: number,
    geometry: (variant: number, lod: number) => { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array },
  ): Row[] {
    const profile = FOLIAGE_BY_CLASS.get(cls) as FoliageProfile;
    return Array.from({ length: variants }, (_, variant) => {
      const levels = [NEAR_LOD, FAR_LOD].map((lod) => {
        const g = geometry(variant, lod);
        return [{ positions: g.positions, normals: g.normals, indices: Uint32Array.from(g.indices), colors: g.colors }];
      }) as [Geometry[], Geometry[]];
      // No texture with shade baked in: its colours are kept whole.
      const { look, matched } = lookOf(cls, profile, `clutter_${name}_${variant}_mat`, heightOf((levels[0][0] as Geometry).positions), 1);
      const vegetation = vegetationOf(cls, look, matched, false);
      const made = material(cls, { baseColorFactor: [1, 1, 1, 1], roughnessFactor: SHRUB_ROUGHNESS, doubleSided: true }, SHRUB_F0, vegetation, [oneSidedLightPlugin()]);
      return { material: made, vegetation, levels };
    });
  }

  /** The buckets of every class from their rows, each mesh hidden until its first list, and the lists that fill them. */
  function adopt(rows: readonly Row[][]): void {
    lists = createClutterLists(seed, { radiusScale, nearBlades, cull: options.cull, rows: rows.map((of) => of.length) });
    rows.forEach((ofClass, cls) =>
      ofClass.forEach((row, r) =>
        row.levels.forEach((parts, lod) => {
          const layout = vegetationInstanceLayout(row.vegetation ?? { foliage: null, fade: false, conform: false, deadwood: null });
          const bucket = ((lists as ClutterLists).buckets[cls] as ClutterBucket[][])[r]![lod] as ClutterBucket;
          drawnBy.set(bucket, parts.map((g, p) => {
            const mesh = createMeshFromData(engine, `clutter_${cls}_${r}_lod${lod}_${p}`, g.positions.slice(), g.normals.slice(), g.indices.slice(), g.uvs?.slice(), undefined, g.tangents?.slice(), g.colors?.slice());
            mesh.material = row.material;
            mesh.renderOrder = orders.of(row.material);
            meshes.push(mesh);
            return listMesh(scene, mesh, layout);
          }));
        }),
      ),
    );
  }

  /** Whether a cut changed what a bucket's material reads an instance: the draws are then recorded again. */
  let cutResent = false;
  const showCut = (bucket: ClutterBucket): void => {
    if (show(bucket)) cutResent = true;
  };

  /** Shows a bucket's list on its meshes: true where a mesh's plugin data changed. */
  function show(bucket: ClutterBucket): boolean {
    const { list } = bucket;
    const from = list.culled ? list.drawn : list;
    const count = list.culled ? (list.cull?.kept ?? 0) : list.count;
    let resent = false;
    for (const target of drawnBy.get(bucket) ?? []) resent = showList(target, from, count) || resent;
    return resent;
  }

  /** The rebuild for an eye at (x, z): the lists' own, whose last slice fills every list, and in that same step each bucket shown. */
  function* rebuild(x: number, z: number): Slices {
    const made = lists;
    if (made === null) return;
    yield* made.rebuild(x, z);
    if (disposed) return;
    // A culled bucket goes on drawing its last cut until the next one.
    let resent = false;
    for (const bucket of made.all) if (!bucket.list.culled) resent = show(bucket) || resent;
    // Plugin instance data goes up as its draw is recorded again.
    if (resent) invalidateRenderBundles(engine);
  }
  // One snap for every class, on the smallest cell.
  const rebuilds = createRebuilds({
    name: "clutter",
    cell: CLUTTER_GRASS_CELL,
    origin: cellOrigin(CLUTTER_GRASS_CELL),
    rebuild,
    ahead: (x, z, hx, hz) => lists?.prefetch(x, z, hx, hz) ?? null,
    jobs: options.jobs,
    firstBuilds: options.firstBuilds,
  });

  /** Rebuilds when the eye's origin on the grass cells' lattice has moved; the first build, when the models land, is at once. */
  function maybeBuild(): void {
    if (lists === null || disposed || Number.isNaN(camX)) return;
    rebuilds.update(camX, camZ);
  }

  async function load(): Promise<void> {
    // Every model is asked for at once; a class is adopted in the game's order.
    const pending: (Promise<LoadedModel>[] | null)[] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const ids = CLUTTER_MODEL_IDS[cls] as readonly string[];
      pending.push(ids.length === 0 ? null : ids.map((id) => model(id, clutterLodNames(cls))));
    }
    // A model that fails is waited out, so no load is left running against a shell that gave up.
    const settled = await Promise.allSettled(pending.flatMap((of) => of ?? []));
    if (disposed) return;
    const failed = settled.find((result) => result.status === "rejected");
    if (failed !== undefined) throw (failed as PromiseRejectedResult).reason;
    const rows: Row[][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const files = pending[cls];
      if (cls === CLUTTER_SHRUB) rows.push(builtRows(cls, "shrub", SHRUB_CHARACTERS.length, shrubGeometry));
      else if (cls === CLUTTER_WETPLANT) rows.push(builtRows(cls, "wetplant", WET_PLANT_COUNT, wetPlantGeometry));
      else if (cls === CLUTTER_HIGHPLANT) rows.push(builtRows(cls, "highplant", HIGH_PLANT_COUNT, highPlantGeometry));
      else if (files === null || files === undefined) rows.push([]);
      else {
        const loaded = await Promise.all(files);
        // The drift log's seat, from its own trunk as the model has it.
        if (cls === CLUTTER_DRIFTLOG) seatDriftLogs(loaded[0]?.get(clutterLodNames(cls)[0])?.[0]?.positions ?? []);
        rows.push(modelRows(cls, loaded));
      }
    }
    adopt(rows);
    // An eye that arrived while the models loaded is honoured now.
    maybeBuild();
  }

  const ready = load().catch((error: unknown) => {
    waiting = 0;
    // A missing or broken asset costs the ground cover, never the hike; a dispose mid-load ends here too, and says nothing.
    if (!disposed) console.error("the ground clutter could not be made; none is drawn", error);
  });

  return {
    update(x, z) {
      if (disposed) return;
      camX = x;
      camZ = z;
      maybeBuild();
    },
    cull(pose) {
      if (disposed || lists === null) return;
      cutResent = false;
      lists.cut(pose, showCut);
      // Plugin instance data goes up as its draw is recorded again.
      if (cutResent) invalidateRenderBundles(engine);
    },
    frame() {
      for (const made of materials) markMaterialUboDirty(made);
    },
    waiting() {
      return Math.max(0, waiting);
    },
    ready,
    drawn() {
      let shown = 0;
      let instances = 0;
      for (const targets of drawnBy.values()) {
        for (const target of targets) {
          if (target.count === 0) continue;
          shown++;
          instances += target.count;
        }
      }
      return { meshes: shown, instances };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rebuilds.dispose();
      loads.abort();
      for (const mesh of meshes) {
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
      }
      meshes.length = 0;
      materials.length = 0;
      drawnBy.clear();
      lists = null;
    },
  };
}
