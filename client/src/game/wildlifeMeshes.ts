/**
 * The Babylon shell for ambient wildlife. Owns the creature-pool bodies of
 * every ground member and the meshes of the bird thin instances. Which
 * animals there are, where each stands and how, a frame, is worked out with
 * no engine (`wildlifeScene.ts`, over wildlifeField.ts / wildlifeBehaviour.ts
 * / wildlifeDirector.ts); this file only moves nodes and hands buffers on.
 *
 * Renderer-only by design: nothing here may migrate into sim/ (the
 * wildlifeField.ts rule). Wildlife is cosmetic and must not move the level id.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// `thinInstanceCount` are prototype extensions Babylon only installs when this
// module is pulled in — the same note `clutterMeshes.ts` carries.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { Node } from "@babylonjs/core/node.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { Quaternion, type Matrix } from "@babylonjs/core/Maths/math.vector.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import type { WeatherParams } from "./weather.js";
import { modelUrl } from "./assetUrls.js";
import { attachWing } from "./wingPlugin.js";
import { FIRST_BIRD_SPECIES, SPECIES_BUTTERFLY, SPECIES_COUNT } from "./wildlifeField.js";
import type { PlayerPoint, WildlifeEvent } from "./wildlifeBehaviour.js";
import { createCreaturePool, type CreatureInstance, type CreaturePool } from "./creatureModel.js";
import { loadContainer, loadUntilAborted } from "./modelLoad.js";
import type { FirstBuilds } from "./firstBuilds.js";
import type { MatchState, View } from "./wildlifeDirector.js";
import { BIRD_ASSET, BIRD_PERCHED_ASSET, birdBucketOmega, butterflyGeometry, createWildlifeScene, type BirdBucket } from "./wildlifeScene.js";

export {
  ANIMATE_OFFSCREEN_WITHIN_M, BIRD_ASSET, BIRD_OMEGA, BIRD_PERCHED_ASSET, BUTTERFLY_BODY_HALF, BUTTERFLY_COLOURWAYS, BUTTERFLY_OMEGA, BUTTERFLY_WING_CHORD,
  BUTTERFLY_WING_SPAN, CREATURE_SPHERE_M, FOOT_LIFT, PRESENCE_RAMP_SECONDS, SLOT_STRIDE, SPECIES_ASSET, WILDLIFE_FADE_BAND, WILDLIFE_REBUILD_STEP,
  birdBucketOmega, butterflyColourway, butterflyGeometry, creatureInView,
} from "./wildlifeScene.js";

/**
 * The mesh `loadBirdAssets` adopts for `BIRD_ASSET[SPECIES_BUTTERFLY]` — white albedo over
 * vertex colour (`terrainMaterialFor`'s convention in renderer.ts: PBR multiplies the two,
 * so tinting the material as well would apply the pattern twice), two-sided because a flat
 * card is seen from both sides as it wanders, and never a shadow caster for the same reason
 * no other clutter-scale card is (see `adoptBirdBucket`'s own note on birds).
 *
 * The material is created HERE rather than coming out of a loaded container, which makes
 * this bucket the one whose material nothing else owns — `dispose` has to free it by hand
 * (see `ownedMaterials`).
 */
function buildButterflyMesh(scene: Scene): Mesh {
  const mesh = new Mesh("wildlife_butterfly", scene);
  const geo = butterflyGeometry();
  const data = new VertexData();
  data.positions = geo.positions;
  data.normals = geo.normals;
  data.colors = geo.colors;
  data.indices = geo.indices;
  data.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  const material = new PBRMaterial("wildlife_butterfly_mat", scene);
  material.albedoColor = new Color3(1, 1, 1);
  material.metallic = 0;
  material.roughness = 1;
  material.backFaceCulling = false;
  mesh.material = material;
  return mesh;
}

/**
 * The shadow registry, satisfied by `lighting.addShadowMesh` /
 * `removeShadowMesh`. Both halves are required: a pooled creature's meshes
 * outlive neither the animal nor the shell, and this Babylon build's
 * `AbstractMesh.dispose` does not take itself out of a shadow generator's
 * render list, so an add with no matching remove leaks every animal that ever
 * left the disc into the shadow map.
 */
export type WildlifeShadows = { add(mesh: AbstractMesh): void; remove(mesh: AbstractMesh): void };
export type WildlifeMeshesOptions = {
  radiusScale?: number;
  /** The loader of first builds, for a start whose intro's film covers the hike (`firstBuilds.ts`):
   * while it is open, a collect of the field (the first, about 30 ms, and one after the camera has
   * moved on) is a task of the loader's own, never part of a frame; closed or absent, it runs in the call. */
  firstBuilds?: FirstBuilds;
  pool?: CreaturePool;
  /** The clock (ms) the wings beat on: the renderer's, so a stepped scene
   * beats in step with it; the wall clock absent. */
  now?: () => number;
  shadows?: WildlifeShadows;
  /**
   * NullEngine escape hatch, the `clutterMeshes.ts` `assets` idiom: bird bucket
   * meshes keyed by catalog id (`BIRD_ASSET`'s entries plus
   * `BIRD_PERCHED_ASSET`) in place of the shipped GLBs. Adopted synchronously, so
   * a test can assert on the first update's buffers. A list stands in for a
   * model whose LOD0 carries more than one primitive — what merge-by-material
   * leaves behind — which is the seam the multi-mesh bucket
   * is tested through. Meshes passed in belong to the caller and are not
   * disposed here.
   */
  birds?: Record<string, Mesh | Mesh[]>;
};
export type WildlifeMeshes = {
  update(
    camX: number,
    camZ: number,
    tick: number,
    players: readonly PlayerPoint[],
    weather: WeatherParams,
    hour: number,
    /**
     * The wildlife director's view of this frame, when the caller has one:
     * the camera it judges visibility against and the match state it goes
     * quiet under. Omitted — every test that does not pass it, and any world
     * with no camera to speak of — the director never runs at all: no cue is
     * ever staged and no pool unit is ever created. See wildlifeDirector.ts.
     */
    director?: { view: View; match: MatchState },
  ): void;
  /**
   * Calls, lifts and flee starts, appended as they happen and never cleared
   * here: the consumer (the audio shell) drains the array when it has read
   * it, and may do so whenever it likes. Nothing in this file reads it across a
   * frame boundary — `update` takes the disturbances it feeds back to
   * `stepUnit` out of the events IT appended, before returning.
   */
  readonly events: WildlifeEvent[];
  /**
   * The director's own sighting log, read straight off its `DirectorState`:
   * `(tick, species)` pairs in the order they were recorded, oldest first, up
   * to the ring's own capacity (see wildlifeDirector.ts's `createDirectorState`)
   * — a test seam, and empty for as long as `update` has never been given a
   * seventh argument.
   */
  directorLog(): readonly number[];
  /**
   * How many units the director currently has out of its pool — a test seam
   * for "no pool unit was ever created" that does not lean on the shape of
   * an id, since ownership is no longer something an id encodes at all.
   */
  poolCount(): number;
  /**
   * A copy of every id the director has asked to be given back since the
   * last drain, in request order — appended before `applyDirectorEvent`
   * decides whether to honour it, so this is what the director REQUESTED,
   * not what the shell actually did. A test seam for exactly the failure
   * `owned` exists to prevent: with `Candidate.owned` set wrong, this fills
   * with real, natural ids the director wrongly believes are its own to
   * recycle, even on a build whose own remove-guard quietly absorbs the
   * resulting bad requests and would otherwise look, from
   * `poolCount`/`acquired` alone, like nothing went wrong. Capped the same
   * way `events` is (see `DIRECTOR_REMOVAL_BACKLOG_CAP`) — nothing drains
   * this in production, so a session with no test ever reading it must not
   * grow it without bound either.
   */
  directorRemovals(): readonly number[];
  dispose(): void;
};

/**
 * Pushes a filled bucket to its meshes. Grown buffers need the whole GPU buffer
 * recreated; buffers written in place need only the live prefix re-uploaded,
 * which is what `thinInstanceBufferUpdated` does once `thinInstanceCount` is
 * set. Created UPDATABLE (`staticBuffer` false) for the reason
 * `clutterMeshes.ts` records: `updateDirectly` silently no-ops on a
 * non-updatable buffer, so the flock would freeze at the last wholesale set.
 *
 * A zero-count bucket is disabled outright — with `instancesCount` 0 Babylon's
 * `hasThinInstances` is false and the bare bucket mesh would be drawn once at
 * the origin, a single raven stuck at world zero.
 *
 * `meshes` is a list for the reason `clutterMeshes.ts`'s `Bucket` is: the
 * shipped model's primitives are merged BY MATERIAL, so a bird authored with
 * a second material — a beak, an eye, a separate feather sheet — arrives as two
 * primitives under one LOD0 root. Adopting only the first would drop half the
 * bird silently. All of them share one matrix buffer and one
 * `wing` buffer, because they are one bird.
 */
function applyBirdBucket(bucket: BirdBucket, meshes: readonly Mesh[]): void {
  const count = bucket.count;
  for (const mesh of meshes) {
    if (bucket.grown) {
      // Sets `thinInstanceCount` to the full CAPACITY as a side effect, which
      // the assignment below immediately trims to the live count.
      mesh.thinInstanceSetBuffer("matrix", bucket.matrices, 16, false);
      mesh.thinInstanceSetBuffer("wing", bucket.wing, 2, false);
      // "color" is Babylon's own kind name; it registers the buffer under
      // `instanceColor`, the attribute its shaders multiply the vertex colour
      // by. Nothing of ours declares it.
      if (bucket.tint !== null) mesh.thinInstanceSetBuffer("color", bucket.tint, 4, false);
      mesh.thinInstanceCount = count;
    } else {
      mesh.thinInstanceCount = count;
      if (count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("wing");
        if (bucket.tint !== null) mesh.thinInstanceBufferUpdated("color");
      }
    }
    mesh.setEnabled(count > 0);
  }
}

/**
 * The catalog `output` for an asset id, or null if the catalog has no such
 * entry. Resolved here rather than through `modelUrl` directly because
 * `modelUrl` THROWS on an output it does not know: the catalog has no bird
 * entries yet, so calling it for an absent asset would take down startup
 * instead of simply leaving the sky empty (`creatureModel.ts`'s `urlFor` note,
 * from the other side).
 */
function birdOutputFor(assetId: string): string | null {
  const entries = (catalog as { assets?: unknown }).assets;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const a = entry as { id?: unknown; output?: unknown };
    if (a.id === assetId && typeof a.output === "string") return a.output;
  }
  return null;
}

/**
 * EVERY geometry-bearing mesh under the container's `LOD0` root, with each
 * transform baked into its own vertices and its parenting dropped —
 * `clutterMeshes.ts`'s `lodMeshes`, for one LOD level. Baking is not tidiness:
 * thin instances compose as `world * instanceMatrix`, so any leftover mesh
 * transform would move the whole flock rather than each bird.
 *
 * The root is located BY NAME anywhere in the node graph, and a container with
 * no `LOD0` returns nothing at all. The old fallback — scan
 * the whole container, take the first mesh with vertices — would silently adopt
 * an LOD1 or LOD2 mesh and draw the lowest level at full size, which is the
 * exact failure the by-name lookup exists to make impossible. No bucket is a
 * failure the caller already handles everywhere.
 *
 * World matrices are snapshotted BEFORE any transform is reset: if one bucket
 * mesh were an ancestor of another, resetting it first would corrupt the
 * descendant's world matrix mid-loop.
 */
export function birdLodMeshes(container: AssetContainer): Mesh[] {
  const nodes: Node[] = [...container.transformNodes, ...container.meshes];
  const root = nodes.find((n) => n.name === "LOD0");
  if (root === undefined) return [];
  const out: Mesh[] = [];
  for (const node of [root, ...root.getChildMeshes(false)]) {
    if (node instanceof Mesh && node.getTotalVertices() > 0 && !out.includes(node)) out.push(node);
  }
  const worlds = out.map((mesh) => mesh.computeWorldMatrix(true).clone());
  for (const [i, mesh] of out.entries()) {
    mesh.bakeTransformIntoVertices(worlds[i] as Matrix);
    mesh.position.setAll(0);
    mesh.rotationQuaternion = null;
    mesh.rotation.setAll(0);
    mesh.scaling.setAll(1);
    mesh.parent = null;
  }
  return out;
}

export function createWildlifeMeshes(
  scene: Scene,
  seed: number,
  options: WildlifeMeshesOptions = {},
): WildlifeMeshes {
  // A pool handed in belongs to the caller; only one this created is disposed.
  const ownsPool = options.pool === undefined;
  const pool = options.pool ?? createCreaturePool();
  const shadows = options.shadows;
  /** The body of every ground member that holds one, by its key. */
  const slots = new Map<number, CreatureInstance>();
  const scratchQ = new Quaternion();
  /** Which animals there are and where each stands, a frame (`wildlifeScene.ts`). */
  const wildlife = createWildlifeScene(
    seed,
    {
      slot(key, assetId) {
        if (!pool.has(assetId)) return false;
        const inst = pool.acquire(key, assetId);
        if (inst === null) return false;
        // Ground animals cast — a shadowless rabbit at 8 m floats.
        if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.add(mesh);
        slots.set(key, inst);
        return true;
      },
      release(key) {
        const inst = slots.get(key);
        if (inst === undefined) return;
        // Before the release: the meshes have to come out of the shadow map while
        // they still exist to be found in it.
        if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.remove(mesh);
        slots.delete(key);
        pool.release(key);
      },
      planes: () => scene.frustumPlanes as Plane[] | undefined,
    },
    { radiusScale: options.radiusScale, firstBuilds: options.firstBuilds },
  );
  /** Each adopted bird model's meshes, by its bucket. */
  const bucketMeshes = new Map<BirdBucket, Mesh[]>();
  const birdContainers: AssetContainer[] = [];
  /**
   * Materials this shell created itself rather than adopting from a container — today just
   * the butterfly's. `Mesh.dispose()` leaves a material alone by default, which is right for
   * every GLB bird (its container owns the material and frees it), and wrong for exactly
   * this one: nothing else holds it, so without this list it would outlive every teardown,
   * still in `scene.materials` with its wing plugin and its compiled effect.
   */
  const ownedMaterials: Material[] = [];
  // Meshes handed in through `options.birds` belong to the caller; only ones
  // this loaded are disposed — the `ownsPool` rule, for the sky.
  const ownsBirds = options.birds === undefined;
  let disposed = false;
  /** Aborted first thing in `dispose`: the bird in flight then ends at once and
   * quietly, and the rest of the list is never fetched (`modelLoad.ts`). */
  const loads = new AbortController();

  // Fire and forget. Nothing has to be re-driven when it resolves: `ensureSlot`
  // asks `pool.has` again for every member of every unit on every frame, so
  // slots simply start appearing the frame after the assets land.
  void pool.load(scene);

  /**
   * Flags every mesh of a bucket needs before it can hold thin instances, plus
   * the wing plugin on each one's material. Birds never cast and never receive:
   * the shadow budget is reserved for ground animals, and a shadow-casting
   * gull at 40 m altitude buys a smudge for a full extra shadow-map draw.
   *
   * The half span is measured across the WHOLE bird, not per mesh. The shader
   * divides |x| by it, so a two-material bird whose beak mesh
   * got its own narrow half span would flap that beak through its full
   * amplitude while the wings barely moved — one bird, one wingspan.
   */
  function adoptBirdBucket(assetId: string, meshes: readonly Mesh[]): void {
    if (meshes.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const mesh of meshes) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      // Birds surround the camera exactly as clutter does, and syncing the
      // bucket's bounding box would rescan every matrix on every frame
      // (`thinInstanceRefreshBoundingInfo` inside `thinInstanceSetBuffer`).
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.doNotSyncBoundingInfo = true;
      mesh.setEnabled(false); // nothing to draw until the first frame fills a buffer
      // Bake has run already, so the bound box is the placed geometry: a
      // model's wingtips are its x extremes.
      mesh.refreshBoundingInfo();
      const box = mesh.getBoundingInfo().boundingBox;
      minX = Math.min(minX, box.minimum.x);
      maxX = Math.max(maxX, box.maximum.x);
    }
    const halfSpan = 0.5 * (maxX - minX);
    for (const mesh of meshes) {
      if (mesh.material !== null) attachWing(mesh.material, halfSpan, birdBucketOmega(assetId), options.now);
    }
    bucketMeshes.set(wildlife.adoptBird(assetId), [...meshes]);
  }

  /** Production path: one GLB per distinct bird model, `clutterMeshes.ts`'s
   * loading idiom. A species whose asset is not in the catalog simply has no
   * bucket and emits nothing, EXCEPT the butterfly's: that id names no catalog
   * output on purpose (`birdOutputFor` returns null for it, same as a
   * shipped-but-missing asset would), so it is built in code instead of skipped
   * — the one asset id in `wanted` this loop never fetches. */
  async function loadBirdAssets(): Promise<void> {
    const wanted = new Set<string>([BIRD_PERCHED_ASSET]);
    for (let s = FIRST_BIRD_SPECIES; s < SPECIES_COUNT; s++) {
      const id = BIRD_ASSET[s];
      if (id !== null && id !== undefined) wanted.add(id);
    }
    registerBuiltInLoaders();
    for (const assetId of wanted) {
      if (assetId === BIRD_ASSET[SPECIES_BUTTERFLY]) {
        // Disposed while an earlier asset was in flight: the same check the container
        // branch below makes, for the same reason — nothing should be built into a scene
        // this shell has already torn down.
        if (disposed) return;
        const mesh = buildButterflyMesh(scene);
        // No container brought this material, so nothing but `dispose` will ever free it.
        if (mesh.material !== null) ownedMaterials.push(mesh.material);
        adoptBirdBucket(assetId, [mesh]);
        continue;
      }
      const output = birdOutputFor(assetId);
      if (output === null) continue;
      try {
        const container = await loadUntilAborted(() => loadContainer(modelUrl(output), scene), loads.signal);
        // Disposed while awaiting: dispose() has already walked a shorter
        // container list, so clean up what just landed here.
        if (disposed) {
          container.dispose();
          return;
        }
        birdContainers.push(container);
        container.addAllToScene();
        const meshes = birdLodMeshes(container);
        if (meshes.length === 0) continue;
        // Everything the container brought that is not in the bucket — LOD1,
        // LOD2, empty wrappers — is disabled, `clutterMeshes.ts`'s rule.
        for (const other of container.meshes) {
          if (other instanceof Mesh && !meshes.includes(other)) other.setEnabled(false);
        }
        adoptBirdBucket(assetId, meshes);
      } catch {
        // Disposed mid-load: nothing failed, and the rest is not wanted.
        if (loads.signal.aborted) return;
        // One bad asset costs its own bird and nothing else — the
        // degrade-don't-block rule the forest and clutter shells share.
      }
    }
  }

  if (options.birds !== undefined) {
    for (const [assetId, mesh] of Object.entries(options.birds)) {
      adoptBirdBucket(assetId, Array.isArray(mesh) ? mesh : [mesh]);
    }
  } else void loadBirdAssets();

  return {
    events: wildlife.events,
    update(camX, camZ, tick, players, weather, hour, director) {
      wildlife.update(camX, camZ, tick, players, weather, hour, director);
      for (const g of wildlife.ground) {
        const inst = slots.get(g.key);
        if (inst === undefined) continue;
        inst.root.position.set(g.x, g.y, g.z);
        scratchQ.copyFromFloats(g.qx, g.qy, g.qz, g.qw);
        if (inst.root.rotationQuaternion === null) inst.root.rotationQuaternion = scratchQ.clone();
        else inst.root.rotationQuaternion.copyFrom(scratchQ);
        // The disc edge fade, on the CPU. distanceFadePlugin.ts's per-instance
        // `fadeBands` attribute cannot do it here: a pooled creature is a
        // container clone, and its material is shared across every animal of
        // the species. Shrinking the root toward its own ground point is the
        // same shape of fade `fadeWeight` describes, at one multiply per
        // animal per frame.
        inst.root.scaling.set(g.scale, g.scale, g.scale);
        inst.play(g.clip);
        // Its clip runs only where someone could see it (`creatureInView`):
        // every pooled animal's animation groups otherwise step every frame,
        // on or off the screen (2026-10-22: 3.5 ms a frame at the meadow).
        inst.animate?.(g.animate);
      }
      for (const [bucket, meshes] of bucketMeshes) applyBirdBucket(bucket, meshes);
    },
    directorLog: () => wildlife.directorLog(),
    poolCount: () => wildlife.poolCount(),
    directorRemovals: () => wildlife.directorRemovals(),
    dispose() {
      loads.abort();
      // Every body goes by the scene's own letting go: out of the shadow map, then back to the pool.
      wildlife.dispose();
      slots.clear();
      if (ownsBirds) {
        // Only meshes this shell loaded. The containers own whatever the
        // buckets did not adopt (materials, other LOD levels, wrapper nodes);
        // `mesh.dispose` is idempotent, so the overlap is harmless.
        for (const meshes of bucketMeshes.values()) for (const mesh of meshes) mesh.dispose();
        for (const container of birdContainers) container.dispose();
        // What no container covers: see `ownedMaterials`.
        for (const material of ownedMaterials) material.dispose();
      }
      ownedMaterials.length = 0;
      birdContainers.length = 0;
      bucketMeshes.clear();
      disposed = true;
      if (ownsPool) pool.dispose();
    },
  };
}
