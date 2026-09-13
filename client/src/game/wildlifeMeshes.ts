/**
 * The Babylon shell for ambient wildlife. Owns the
 * memoized collector, one `UnitState` per unit in the disc, the creature-pool
 * slots for every ground member, and the bird thin instances. Pure
 * decisions live in wildlifeField.ts / wildlifeBehaviour.ts; this file only
 * moves nodes. Rebuilds the unit set every WILDLIFE_REBUILD_STEP metres of
 * travel — the clutter cadence — and steps every unit every frame the tick
 * advances.
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
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import { hash3 } from "../sim/field.js";
import { elevationSampleAt } from "../sim/terrain.js";
import { SIM_TICK_HZ } from "../sim/constants.js";
import type { WeatherParams } from "./weather.js";
import { modelUrl } from "./assetUrls.js";
import { seatOnGround } from "./groundTilt.js";
import { fadeWeight } from "./distanceFadePlugin.js";
import { attachWing, WING_TIME_WRAP } from "./wingPlugin.js";
import {
  createWildlifeCollector, FIRST_BIRD_SPECIES, SPECIES_COUNT, SPECIES_DEER, SPECIES_ELK,
  SPECIES_RAVEN_PAIR, SPECIES_RAVEN_ROOST, WILDLIFE_RADIUS,
} from "./wildlifeField.js";
import {
  createUnitState, PHASE_REST, stepUnit, wildlifePresenceUnder,
  type PlayerPoint, type UnitState, type WildlifeEvent,
} from "./wildlifeBehaviour.js";
import { createCreaturePool, type CreatureInstance, type CreaturePool } from "./creatureModel.js";

/**
 * Catalog ids per species; null for the four bird species, which render as
 * thin instances rather than pooled containers. Indexed by species;
 * wildlifeMeshes.test.ts holds it to SPECIES_COUNT entries, so a species added
 * to wildlifeField.ts without an entry here fails a test rather than silently
 * rendering nothing.
 */
export const SPECIES_ASSET: readonly (string | null)[] = [
  "wildlife.elk", "wildlife.deer", "wildlife.rabbit", "wildlife.squirrel", null, null, null, null,
];
/**
 * The FLYING model each bird species renders as, indexed by species; null for
 * the four ground species, which are pooled containers rather than thin
 * instances. A roost and a pair are both ravens on the wing and share one
 * bucket — the bucket is the MODEL, not the species, so two species that fly
 * the same model share its geometry, its material and its wing plugin.
 *
 * Held to SPECIES_COUNT entries by a test, like `SPECIES_ASSET`.
 */
export const BIRD_ASSET: readonly (string | null)[] = [
  null, null, null, null, "wildlife.raven", "wildlife.raven", "wildlife.gull", "wildlife.eagle",
];
/**
 * The one bucket that is not a flight pose: a roost in PHASE_REST is sitting on
 * its snag, and a beating-winged raven card held still there reads as a bird
 * frozen mid-flap. Its members move to `BIRD_ASSET[SPECIES_RAVEN_ROOST]` the
 * moment the roost lifts.
 */
export const BIRD_PERCHED_ASSET = "wildlife.crow_perched";

// Wing-beat rates. Every ω is an exact 2π·n / WING_TIME_WRAP so the shader's
// time wrap is phase-continuous — wingPlugin.ts's rule, inherited from wind.
const RAVEN_WING_OMEGA = (2 * Math.PI * 900) / WING_TIME_WRAP; // 3 Hz
const GULL_WING_OMEGA = (2 * Math.PI * 750) / WING_TIME_WRAP;  // 2.5 Hz
/**
 * Wing-beat rate per species (rad/s). Eagles are zero: an eagle at 120–250 m
 * soars, and `poseBirds` gives it amp 0 as well, so both halves of the product
 * agree that it never flaps.
 */
export const BIRD_OMEGA: readonly number[] = [
  0, 0, 0, 0, RAVEN_WING_OMEGA, RAVEN_WING_OMEGA, GULL_WING_OMEGA, 0,
];

/**
 * The ω a bucket's material takes, resolved from the asset id rather than the
 * species, because a bucket can serve two species (both ravens) and a material
 * carries exactly one plugin. The perched bucket matches nothing here and takes
 * 0 — it is only ever drawn with amp 0.
 */
export function birdBucketOmega(assetId: string): number {
  for (let s = FIRST_BIRD_SPECIES; s < BIRD_ASSET.length; s++) {
    if (BIRD_ASSET[s] === assetId) return BIRD_OMEGA[s] ?? 0;
  }
  return 0;
}

/** Instances a bird bucket's first real allocation covers, then doubling —
 * `clutterMeshes.ts`'s BUCKET_MIN_INSTANCES, at the same size. A 400 m disc
 * holds tens of birds per bucket, so this is usually the only allocation. */
const BIRD_MIN_INSTANCES = 64;
/** Shared zero-length placeholder for a bucket that has never held an instance. */
const EMPTY_BUFFER = new Float32Array(0);
/** Salt for the per-instance wing phase draw; local to this file's hash3 use. */
const SALT_WING_PHASE = 41;

/**
 * One bird model's thin-instance bucket: EVERY geometry-bearing mesh of its
 * LOD0, the matrix buffer and the `wing` (phase, amp) buffer the plugin reads,
 * both reused across frames and grown by doubling — never per-frame
 * allocation, the clutter contract.
 *
 * `meshes` is a list for the reason `clutterMeshes.ts`'s `Bucket` is: the
 * shipped model's primitives are merged BY MATERIAL, so a bird authored with
 * a second material — a beak, an eye, a separate feather sheet — arrives as two
 * primitives under one LOD0 root. Adopting only the first would drop half the
 * bird silently. All of them share one matrix buffer and one
 * `wing` buffer, because they are one bird.
 */
type BirdBucket = {
  meshes: Mesh[];
  /** Matrix data; capacity is `matrices.length / 16`. */
  matrices: Float32Array;
  /** Per-instance (phase, amp) pairs, stride 2, in lockstep with `matrices`. */
  wing: Float32Array;
  /** Instances this frame — counted in pass 1, reused as the write cursor in pass 2. */
  count: number;
  /** Set when the buffers were replaced this frame, so the GPU buffers need a
   * fresh `thinInstanceSetBuffer` rather than an in-place upload. */
  grown: boolean;
};

/** Metres of travel between unit-set rebuilds. */
export const WILDLIFE_REBUILD_STEP = 8;
/** Width of the fade band at the outer edge of every species' disc (m): 130–150 of 150. */
export const WILDLIFE_FADE_BAND = 20;
/** Feet sit this far above the analytic ground so a flat-footed rig never z-fights the terrain. */
export const FOOT_LIFT = 0.02;
/** Seconds the ground presence takes to traverse a weather change. */
export const PRESENCE_RAMP_SECONDS = 3;
/**
 * Pool keys are `unit.id · SLOT_STRIDE + member`, the encoding creatureModel.ts
 * documents. Every species' member count is below the stride (the largest is
 * elk's 8, WILDLIFE_MEMBERS) and `unit.id` is unique per (species, cell) since
 * it became a packed int, so two units can never collide on a key.
 */
export const SLOT_STRIDE = 16;
/**
 * An undrained `events` backlog is dropped at this length rather than grown
 * without bound. `events` is cleared by its consumer (the audio shell),
 * never here — see `update` — so a build with no consumer wired would otherwise
 * accumulate one call event per roost per half-minute for the length of a
 * session. Far above any single frame's output, so a live consumer never sees it.
 */
const EVENT_BACKLOG_CAP = 4096;

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
  pool?: CreaturePool;
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
  ): void;
  /**
   * Calls, lifts and flee starts, appended as they happen and never cleared
   * here: the consumer (the audio shell) drains the array when it has read
   * it, and may do so whenever it likes. Nothing in this file reads it across a
   * frame boundary — `update` takes the disturbances it feeds back to
   * `stepUnit` out of the events IT appended, before returning.
   */
  readonly events: WildlifeEvent[];
  dispose(): void;
};

/**
 * A step of `step` toward `target`, landing exactly ON it rather than past it.
 * Linear and measured in sim ticks, so a weather change takes the same
 * PRESENCE_RAMP_SECONDS at any frame rate and actually ARRIVES — an exponential
 * lag would approach and never reach, leaving ghost-scaled animals under dread.
 */
function rampTo(current: number, target: number, step: number): number {
  const gap = target - current;
  return Math.abs(gap) <= step ? target : current + Math.sign(gap) * step;
}

/**
 * Grows a bucket's buffers to hold `count` instances, doubling from
 * BIRD_MIN_INSTANCES. Old contents are dropped rather than copied: every live
 * instance is rewritten immediately afterwards. The two buffers grow together
 * under one `grown` flag so their capacities can never disagree — a `wing`
 * buffer shorter than the matrix buffer would leave Babylon reading past its
 * end for the tail instances.
 */
function ensureBirdCapacity(bucket: BirdBucket): void {
  const needed = bucket.count * 16;
  if (bucket.matrices.length >= needed) {
    bucket.grown = false;
    return;
  }
  let capacity = Math.max(bucket.matrices.length, BIRD_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  bucket.matrices = new Float32Array(capacity);
  bucket.wing = new Float32Array((capacity / 16) * 2);
  bucket.grown = true;
}

/**
 * Pushes a filled bucket to its mesh. Grown buffers need the whole GPU buffer
 * recreated; buffers written in place need only the live prefix re-uploaded,
 * which is what `thinInstanceBufferUpdated` does once `thinInstanceCount` is
 * set. Created UPDATABLE (`staticBuffer` false) for the reason
 * `clutterMeshes.ts` records: `updateDirectly` silently no-ops on a
 * non-updatable buffer, so the flock would freeze at the last wholesale set.
 *
 * A zero-count bucket is disabled outright — with `instancesCount` 0 Babylon's
 * `hasThinInstances` is false and the bare bucket mesh would be drawn once at
 * the origin, a single raven stuck at world zero.
 */
function applyBirdBucket(bucket: BirdBucket): void {
  const count = bucket.count;
  for (const mesh of bucket.meshes) {
    if (bucket.grown) {
      // Sets `thinInstanceCount` to the full CAPACITY as a side effect, which
      // the assignment below immediately trims to the live count.
      mesh.thinInstanceSetBuffer("matrix", bucket.matrices, 16, false);
      mesh.thinInstanceSetBuffer("wing", bucket.wing, 2, false);
      mesh.thinInstanceCount = count;
    } else {
      mesh.thinInstanceCount = count;
      if (count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("wing");
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
  const radiusScale = options.radiusScale ?? 1;
  // A pool handed in belongs to the caller; only one this created is disposed.
  const ownsPool = options.pool === undefined;
  const pool = options.pool ?? createCreaturePool();
  const shadows = options.shadows;
  const collector = createWildlifeCollector(seed);
  const states = new Map<number, UnitState>();
  const slots = new Map<number, CreatureInstance>();
  const events: WildlifeEvent[] = [];
  // The previous frame's herd flee starts, handed to `stepUnit` as this frame's
  // disturbances. `disturbPool` never shrinks, so re-filling `disturbances`
  // reuses the same point objects instead of allocating on the per-frame path.
  const disturbPool: { x: number; z: number }[] = [];
  const disturbances: PlayerPoint[] = [];
  const scratchQ = new Quaternion();
  const scratchScale = new Vector3();
  const scratchPos = new Vector3();
  const scratchMat = new Matrix();
  // Every bird unit in the disc, refreshed at each rebuild. An array rather
  // than a filter over `states` each frame: the bird pass walks it twice (count
  // then write), and two Map iterators per frame is exactly the per-frame
  // allocation this file's update path rules out.
  const birdList: UnitState[] = [];
  const birdBuckets: BirdBucket[] = [];
  const bucketByAsset = new Map<string, BirdBucket>();
  /** `bucketForSpecies[species]` is the FLYING bucket; null while unloaded. */
  const bucketForSpecies: (BirdBucket | null)[] = new Array<BirdBucket | null>(SPECIES_COUNT).fill(null);
  const birdContainers: AssetContainer[] = [];
  // Meshes handed in through `options.birds` belong to the caller; only ones
  // this loaded are disposed — the `ownsPool` rule, for the sky.
  const ownsBirds = options.birds === undefined;
  let perchedBucket: BirdBucket | null = null;
  let lastX = Infinity;
  let lastZ = Infinity;
  let presenceGround = 1;
  let presenceAloft = 1;
  let presenceRaven = 1;
  let lastPresenceTick = -1;
  let disposed = false;

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
      if (mesh.material !== null) attachWing(mesh.material, halfSpan, birdBucketOmega(assetId));
    }
    const bucket: BirdBucket = { meshes: [...meshes], matrices: EMPTY_BUFFER, wing: EMPTY_BUFFER, count: 0, grown: false };
    birdBuckets.push(bucket);
    bucketByAsset.set(assetId, bucket);
    perchedBucket = bucketByAsset.get(BIRD_PERCHED_ASSET) ?? null;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const id = BIRD_ASSET[s];
      bucketForSpecies[s] = id === null || id === undefined ? null : (bucketByAsset.get(id) ?? null);
    }
  }

  /** Production path: one GLB per distinct bird model, `clutterMeshes.ts`'s
   * loading idiom. A species whose asset is not in the catalog — which is all
   * four today — simply has no bucket and emits nothing. */
  async function loadBirdAssets(): Promise<void> {
    const wanted = new Set<string>([BIRD_PERCHED_ASSET]);
    for (let s = FIRST_BIRD_SPECIES; s < SPECIES_COUNT; s++) {
      const id = BIRD_ASSET[s];
      if (id !== null && id !== undefined) wanted.add(id);
    }
    registerBuiltInLoaders();
    for (const assetId of wanted) {
      const output = birdOutputFor(assetId);
      if (output === null) continue;
      try {
        const container = await loadAssetContainerAsync(modelUrl(output), scene);
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

  function releaseUnit(u: UnitState): void {
    const base = u.unit.id * SLOT_STRIDE;
    for (let m = 0; m < u.unit.members; m++) {
      const inst = slots.get(base + m);
      if (inst === undefined) continue;
      // Before the release: the meshes have to come out of the shadow map while
      // they still exist to be found in it.
      if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.remove(mesh);
      slots.delete(base + m);
      pool.release(base + m);
    }
  }

  function rebuild(camX: number, camZ: number, tick: number): void {
    const units = collector.collect(camX, camZ, radiusScale);
    const keep = new Set<number>();
    for (const u of units) {
      keep.add(u.id);
      if (!states.has(u.id)) states.set(u.id, createUnitState(u, tick, seed));
    }
    for (const [id, u] of [...states]) {
      if (keep.has(id)) continue;
      releaseUnit(u);
      states.delete(id);
    }
    birdList.length = 0;
    for (const u of states.values()) if (u.unit.species >= FIRST_BIRD_SPECIES) birdList.push(u);
  }

  /**
   * How present a bird unit is, in [0, ∞): `aloft` for gulls and eagles,
   * `raven` for both raven species. Negative means "not here at all".
   *
   * Ravens carry their presence entirely in COUNT:
   * `wildlifeField.ts` places roosts to twice their density and
   * tags each with `presenceDraw = draw / D`, and showing one only while its
   * draw sits under the live raven presence gives the first half at `clear`,
   * both halves under dread, and half of the first half at rain — all without a
   * re-walk of the field. A surviving raven is then drawn at FULL SIZE: a
   * half-scale raven is a wrong-looking bird, whereas fewer ravens is exactly
   * what rain means. Gulls and eagles are the other way round — placed at 1×,
   * never gated, and carrying `aloft` in scale.
   *
   * The "ravens ×2" density boost reaches only ROOSTS: pairs are
   * gated by this same draw, which thins them correctly under rain, but
   * `wildlifeField.ts` rejects a pair at `presenceDraw >= 1` rather than 2, so
   * dread buys extra roosts and nothing else. Inherited by design.
   */
  function birdPresenceFor(u: UnitState): number {
    const s = u.unit.species;
    if (s !== SPECIES_RAVEN_ROOST && s !== SPECIES_RAVEN_PAIR) return presenceAloft;
    return ravenHidden(u) ? -1 : presenceRaven;
  }

  /**
   * Whether the raven gate above hides this unit RIGHT NOW — i.e. it is not in
   * the world at all this frame, not merely undrawn.
   *
   * That distinction is the whole of it: a hidden roost that still ran its state
   * machine would still lift, still land, and still push the `call` events
   * `wildlifeAudio` voices at the ravens' full gain — a croak out of an empty
   * snag, and twice the intended raven call rate at `clear`, where the
   * gate hides half of every roost the field placed at 2xD. So the gate runs
   * before `stepUnit`, not after it.
   *
   * Its `UnitState` is KEPT and merely frozen, never released: when the dread
   * ramp lifts the gate the unit resumes from where it stopped, and `stepUnit`'s
   * MAX_CATCHUP_TICKS cap bounds the catch-up to six ticks however long it was
   * away. Nothing else needs to know: a frozen unit's poses are equally stale,
   * and `updateBirds` skips it on the same gate.
   */
  function ravenHidden(u: UnitState): boolean {
    const s = u.unit.species;
    return (s === SPECIES_RAVEN_ROOST || s === SPECIES_RAVEN_PAIR) && u.unit.presenceDraw >= presenceRaven;
  }

  /** The uniform scale a bird's instances take: 1 for a raven that passed the
   * gate, the aloft presence for everything else. */
  function birdScaleFor(u: UnitState, presence: number): number {
    const s = u.unit.species;
    if (s === SPECIES_RAVEN_ROOST || s === SPECIES_RAVEN_PAIR) return 1;
    return Math.min(1, presence);
  }

  /** The species' disc radius, SQUARED — the cull compares squared distances,
   * which is the same test without two `Math.hypot` square
   * roots per pose per frame. */
  function birdCullRadiusSquared(u: UnitState): number {
    const r = WILDLIFE_RADIUS[u.unit.species]! * radiusScale;
    return r * r;
  }

  /** The bucket a unit's members draw from this frame: a roost sitting on its
   * snag is a different model from the same roost in the air. */
  function birdBucketFor(u: UnitState): BirdBucket | null {
    if (u.unit.species === SPECIES_RAVEN_ROOST && u.phase === PHASE_REST) return perchedBucket;
    return bucketForSpecies[u.unit.species] ?? null;
  }

  /**
   * Every bird pose in the disc, gathered into its bucket's reused buffers.
   * Two passes so no buffer has to grow mid-fill (the clutter pattern): pass 1
   * counts, `ensureBirdCapacity` grows what it must, pass 2 writes.
   *
   * Birds CULL at the disc edge instead of fading: a gull shrinking
   * to nothing over the last 20 m of a 400 m disc is a gull the player cannot
   * see either way, and the fade band that saves a ground animal's pop-in buys
   * nothing 400 m out. Scale carries presence alone.
   */
  function updateBirds(camX: number, camZ: number): void {
    if (birdBuckets.length === 0) return;
    for (let i = 0; i < birdBuckets.length; i++) birdBuckets[i]!.count = 0;

    for (let i = 0; i < birdList.length; i++) {
      const u = birdList[i]!;
      // `<= 0`, not `< 0`: a gull at zero aloft presence is
      // gone, not shrunk. The ground path draws its animals at scale 0 to keep
      // a pooled slot warm; a thin instance has no slot to keep, so emitting
      // one buys a degenerate triangle and a buffer stride for nothing.
      if (birdPresenceFor(u) <= 0) continue;
      const bucket = birdBucketFor(u);
      if (bucket === null) continue;
      const r2 = birdCullRadiusSquared(u);
      for (let m = 0; m < u.poses.length; m++) {
        const pose = u.poses[m]!;
        const dx = pose.x - camX;
        const dz = pose.z - camZ;
        if (dx * dx + dz * dz > r2) continue;
        bucket.count++;
      }
    }

    for (let i = 0; i < birdBuckets.length; i++) {
      const bucket = birdBuckets[i]!;
      ensureBirdCapacity(bucket);
      bucket.count = 0;
    }

    for (let i = 0; i < birdList.length; i++) {
      const u = birdList[i]!;
      const p = birdPresenceFor(u);
      if (p <= 0) continue;
      const bucket = birdBucketFor(u);
      if (bucket === null) continue;
      const r2 = birdCullRadiusSquared(u);
      const presence = birdScaleFor(u, p);
      for (let m = 0; m < u.poses.length; m++) {
        const pose = u.poses[m]!;
        const dx = pose.x - camX;
        const dz = pose.z - camZ;
        if (dx * dx + dz * dz > r2) continue;
        const scale = pose.scale * presence;
        scratchScale.copyFromFloats(scale, scale, scale);
        Quaternion.RotationYawPitchRollToRef(pose.yaw, -pose.pitch, 0, scratchQ);
        scratchPos.copyFromFloats(pose.x, pose.y, pose.z);
        Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchMat);
        scratchMat.copyToArray(bucket.matrices, bucket.count * 16);
        // (phase, amp). The phase is per (unit, member) and constant for the
        // life of the bird, so a flock beats out of step without the shader
        // needing anything but its own clock; the amp is the behaviour's, and
        // 0 is a glide — an eagle always, a gull between beats, a perched raven.
        bucket.wing[bucket.count * 2] = hash3(u.unit.id, m, SALT_WING_PHASE, seed) * 2 * Math.PI;
        bucket.wing[bucket.count * 2 + 1] = pose.wing;
        bucket.count++;
      }
    }

    for (let i = 0; i < birdBuckets.length; i++) applyBirdBucket(birdBuckets[i]!);
  }

  function ensureSlot(u: UnitState, m: number): CreatureInstance | null {
    const key = u.unit.id * SLOT_STRIDE + m;
    const existing = slots.get(key);
    if (existing !== undefined) return existing;
    const assetId = SPECIES_ASSET[u.unit.species];
    // A species with no shipped asset simply has no animals — there is no
    // capsule fallback for wildlife.
    if (assetId === null || assetId === undefined || !pool.has(assetId)) return null;
    const inst = pool.acquire(key, assetId);
    if (inst === null) return null;
    // Ground animals cast — a shadowless rabbit at 8 m floats.
    if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.add(mesh);
    slots.set(key, inst);
    return inst;
  }

  /**
   * The herd flee starts among the events appended since `from`, copied into
   * `disturbances` for the next frame. Only a bolting herd disturbs a roost:
   * a squirrel's dash up a trunk and a rabbit's hop into a bush are
   * not events a raven notices, and a roost's own flee — pushed as it lifts —
   * must not feed itself, or no roost would ever settle again.
   */
  function captureDisturbances(from: number): void {
    let n = 0;
    for (let i = from; i < events.length; i++) {
      const e = events[i]!;
      if (e.kind !== "flee" || (e.species !== SPECIES_ELK && e.species !== SPECIES_DEER)) continue;
      let q = disturbPool[n];
      if (q === undefined) { q = { x: 0, z: 0 }; disturbPool[n] = q; }
      q.x = e.x;
      q.z = e.z;
      disturbances[n] = q;
      n++;
    }
    disturbances.length = n;
  }

  return {
    events,
    update(camX, camZ, tick, players, weather, hour) {
      if (events.length > EVENT_BACKLOG_CAP) events.length = 0;
      const eventsBefore = events.length;
      const dx = camX - lastX;
      const dz = camZ - lastZ;
      if (dx * dx + dz * dz >= WILDLIFE_REBUILD_STEP * WILDLIFE_REBUILD_STEP) {
        rebuild(camX, camZ, tick);
        lastX = camX;
        lastZ = camZ;
      }
      // All three presences ramp on the same clock (see `rampTo`): the sky has
      // to thin out at the same rate the ground does, or a weather change shows
      // the herd fading while the gulls snap out.
      // The very first update adopts the weather outright rather than fading in
      // from a full world the player never saw.
      const target = wildlifePresenceUnder(weather);
      if (lastPresenceTick === -1) {
        presenceGround = target.ground;
        presenceAloft = target.aloft;
        presenceRaven = target.raven;
      } else {
        const step = Math.max(0, tick - lastPresenceTick) / (PRESENCE_RAMP_SECONDS * SIM_TICK_HZ);
        presenceGround = rampTo(presenceGround, target.ground, step);
        presenceAloft = rampTo(presenceAloft, target.aloft, step);
        presenceRaven = rampTo(presenceRaven, target.raven, step);
      }
      lastPresenceTick = tick;

      for (const u of states.values()) {
        // A raven the presence gate hides is not here this frame — it neither
        // moves nor croaks (see `ravenHidden`).
        if (ravenHidden(u)) continue;
        stepUnit(u, tick, players, seed, hour, disturbances, events);
        if (u.unit.species >= FIRST_BIRD_SPECIES) continue; // thin instances — `updateBirds` below
        const r = WILDLIFE_RADIUS[u.unit.species]! * radiusScale;
        const edgeStart = Math.max(0, r - WILDLIFE_FADE_BAND);
        for (let m = 0; m < u.poses.length; m++) {
          const inst = ensureSlot(u, m);
          if (inst === null) continue;
          const pose = u.poses[m]!;
          const s = elevationSampleAt(seed, pose.x, pose.z);
          // A pitched pose (the squirrel clinging to a trunk) carries its own
          // height and wants no foot lift — it is not standing on anything.
          inst.root.position.set(pose.x, pose.pitch === 0 ? s.h + FOOT_LIFT : pose.y, pose.z);
          if (pose.pitch === 0) seatOnGround(pose.yaw, s.dx, s.dz, scratchQ);
          else Quaternion.RotationYawPitchRollToRef(pose.yaw, -pose.pitch, 0, scratchQ);
          if (inst.root.rotationQuaternion === null) inst.root.rotationQuaternion = scratchQ.clone();
          else inst.root.rotationQuaternion.copyFrom(scratchQ);
          // The disc edge fade, on the CPU. distanceFadePlugin.ts's per-instance
          // `fadeBands` attribute cannot do it here: a pooled creature is a
          // container clone, and its material is shared across every animal of
          // the species. Shrinking the root toward its own ground point is the
          // same shape of fade `fadeWeight` describes, at one multiply per
          // animal per frame.
          const fade = fadeWeight(Math.hypot(pose.x - camX, pose.z - camZ), edgeStart, r);
          const scale = pose.scale * presenceGround * fade;
          inst.root.scaling.set(scale, scale, scale);
          inst.play(pose.clip);
        }
      }
      updateBirds(camX, camZ);
      // This frame's flee starts, for next frame. Taken from the events this
      // call appended (never from the whole array), so a consumer that drains
      // `events` between updates cannot silently break the one cross-species
      // reaction wildlife has.
      captureDisturbances(eventsBefore);
    },
    dispose() {
      for (const [key, inst] of slots) {
        if (shadows !== undefined) for (const mesh of inst.root.getChildMeshes()) shadows.remove(mesh);
        pool.release(key);
      }
      slots.clear();
      states.clear();
      birdList.length = 0;
      events.length = 0;
      if (ownsBirds) {
        // Only meshes this shell loaded. The containers own whatever the
        // buckets did not adopt (materials, other LOD levels, wrapper nodes);
        // `mesh.dispose` is idempotent, so the overlap is harmless.
        for (const bucket of birdBuckets) for (const mesh of bucket.meshes) mesh.dispose();
        for (const container of birdContainers) container.dispose();
      }
      birdContainers.length = 0;
      birdBuckets.length = 0;
      bucketByAsset.clear();
      bucketForSpecies.fill(null);
      perchedBucket = null;
      disposed = true;
      if (ownsPool) pool.dispose();
    },
  };
}
