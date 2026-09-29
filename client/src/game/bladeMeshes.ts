/**
 * The Babylon shell over `bladeField.ts`: one thin-instance bucket per clump
 * character, distance tier and size, on one opaque material per tier, filled
 * from the field's tier lists with the cards' own matrix, trample and tint writers
 * (clutterMeshes.ts) plus a per-instance strength. Rebuilt on the field's own
 * 1 m crossing; no per-frame allocation on the hot path, the clutter shell's
 * discipline. Nothing here dithers: every hand-off is geometric, so no bucket
 * carries the distance fade or `fadeBands`.
 *
 * The split is `clutterMeshes.ts`'s and for the same reason: all band and
 * placement maths is the pure field, and what lives here is buffers, matrices
 * and dispose. The thirty-six buckets are the product of three axes that
 * cannot be collapsed — a character is a different MESH (its own blade table
 * and tip feature, so its own vertex data), a tier is a different blade COUNT
 * of the same character and a different hand-off band, and a size is a
 * further COUNT scaling of the same character and tier (`bladeCountFor`), so
 * a cell that buys a bigger clump gets a mesh with more blades rather than a
 * scaled-up one. Tier is the material axis because the band is a material
 * uniform on the foliage plugin; neither character nor size is, since all
 * twelve of a tier's character-size buckets share that band exactly.
 *
 * Draw-call budget: 4 characters × 3 tiers × 3 sizes = 36 draws, opaque and
 * single-material, drawn over the meadow's near cards.
 *
 * Culled to the view (`grassCull.ts`). The buckets surround the eye and
 * Babylon draws a thin-instanced mesh whole or not at all, so each bucket
 * keeps two sets of buffers: the COLLECTED ones the rebuild writes, which stay
 * on the CPU, and the DRAWN ones handed to the mesh. `cull`, run from the
 * renderer once the camera's pose for the frame is final, copies the cells
 * inside a slightly widened frustum to the front of the drawn buffers, in
 * order (so still nearest first), sets the count to them and uploads only
 * that prefix. It does that after every rebuild and whenever the view has
 * moved past grassCull.ts's thresholds, and nothing otherwise. The draw count
 * is the buckets' own and does not change; a bucket whose prefix is empty is
 * disabled, which can only lower it.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { Rgb } from "./colour.js";
import {
  BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, BLADE_SIZE_COUNT, bladeTierBands, createBladeCollector,
  type BladeCell, type BladeTiers,
} from "./bladeField.js";
import { BLADE_ALBEDO, BLADE_CHARACTERS, bladeClumpGeometry, bladeCountFor, type BladeQuality } from "./bladeClump.js";
import { attachFoliage, FOLIAGE_PROFILES, setFoliageBladeEdges } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { instanceMatrixFor, prepBucketMesh, trampleFrame, writeFoliage } from "./clutterMeshes.js";
import { cullInvalidate, cullPlanes, cullPrefix, cullSet, needsCull, type CullPose, type CullSet } from "./grassCull.js";
import { createKeptValues } from "./keptValues.js";
import { createCrossing, crossingAt, finish, type Slices, type SyncJobs } from "./syncJobs.js";

export const BLADE_MESH_PREFIX = "blade_clumps";
export function bladeMeshName(character: number, tier: number, size: number): string {
  return `${BLADE_MESH_PREFIX}_c${character}_t${tier}_s${size}`;
}
/** A cell's height scale at strength 0 and 1 (`strength`, the clamped
 * [0, 1] cut — never the unclamped `cover` a cell's `size` was chosen from). */
export const BLADE_STRENGTH_HEIGHT: readonly [number, number] = [0.5, 1];
/** A cell's height scale under full canopy: 1, so the canopy no longer
 * shortens the sward on its own — a cell's strength alone carries the height. */
export const BLADE_CANOPY_HEIGHT = 1;

/** A cell's height scale: the strength cut between BLADE_STRENGTH_HEIGHT's
 * ends, then the canopy's own scale toward BLADE_CANOPY_HEIGHT. */
export function bladeHeightScale(strength: number, canopy: number): number {
  return (BLADE_STRENGTH_HEIGHT[0] + (BLADE_STRENGTH_HEIGHT[1] - BLADE_STRENGTH_HEIGHT[0]) * strength) *
    (1 + (BLADE_CANOPY_HEIGHT - 1) * canopy);
}
/** The material's roughness. */
const BLADE_ROUGHNESS = 0.8;

export type BladeMeshesOptions = {
  quality: BladeQuality;
  /** The renderer's scheduler: a one-cell step at a walk rebuilds as a job
   * over the frames that follow rather than in the frame of the crossing. */
  jobs?: SyncJobs;
};

export type BladeMeshes = {
  update(camX: number, camZ: number): void;
  /**
   * Draws only the cells inside the frustum of `pose` widened by
   * `CULL_MARGIN` (grassCull.ts), refiltering after a rebuild or once the
   * view has moved past the thresholds, and doing nothing otherwise. `null`
   * draws every collected cell. Until the first call after a rebuild, the
   * buckets draw the prefix of the last cut.
   */
  cull(pose: CullPose | null): void;
  /** The eye position the collected buffers were last built for. */
  readonly view: { readonly x: number; readonly z: number };
  /**
   * Every bucket mesh, in tier-then-character-then-size order. Unlike the
   * clutter shell's `casterMeshes` this array is complete the moment
   * `createBladeMeshes` returns and never grows: the clumps are generated
   * geometry, not a GLB that has to land first, so there is no deferred
   * adoption and no contract to watch the length.
   */
  readonly meshes: readonly Mesh[];
  /** Cells whose matrix and tint are kept (keptValues.ts). */
  readonly kept: number;
  dispose(): void;
};

/** One character-and-size bucket inside one tier: its mesh, the three
 * collected buffers the rebuild writes and the three drawn buffers `cull`
 * fills from them, all reused across rebuilds and grown geometrically. No
 * `bands` and no `fade` — the tier hand-off is the shader's geometric
 * collapse, so nothing here ever writes `fadeBands`. */
type Bucket = {
  mesh: Mesh;
  /** Collected matrix data; capacity is `buf.length / 16`. */
  buf: Float32Array;
  /** Four floats per instance (ground colour rgb + canopy shade), the
   * collected `foliage` attribute; capacity tracks `buf`. Every bucket wears the
   * tinting BLADES profile, so unlike the clutter shell there is no bucket
   * that leaves this one empty. */
  foliage: Float32Array;
  /** One float per instance, the `bladeStrength` attribute the BLADES profile
   * declares: the cell's clamped `strength` (never the unclamped `cover`),
   * which cuts blades inside the clump. */
  strength: Float32Array;
  /** The drawn buffers, the collected ones' capacity each: what the mesh
   * holds and uploads, the kept prefix at the front. */
  drawn: { buf: Float32Array; foliage: Float32Array; strength: Float32Array };
  /** Each cell's translation, x, y, z, written by the fill beside `buf`:
   * what the cut tests. */
  origins: Float32Array;
  /** The collected and drawn buffers as `cullPrefix` walks them, with the
   * last cut's indices; rebuilt only on growth. */
  cull: CullSet;
  /** Instances this rebuild — counted in pass 1, then reused as the write
   * cursor in pass 2, so it is the live count again when the fill ends. */
  count: number;
  /** Set when `buf` was replaced this rebuild: the mesh then needs a fresh
   * `thinInstanceSetBuffer` (a new GPU buffer) for the new drawn buffers. */
  grown: boolean;
};

function emptyBucket(mesh: Mesh): Bucket {
  const drawn = { buf: EMPTY_BUFFER, foliage: EMPTY_BUFFER, strength: EMPTY_BUFFER };
  return {
    mesh, buf: EMPTY_BUFFER, foliage: EMPTY_BUFFER, strength: EMPTY_BUFFER, drawn, origins: EMPTY_BUFFER,
    cull: bucketCullSet(0, EMPTY_BUFFER, EMPTY_BUFFER, EMPTY_BUFFER, EMPTY_BUFFER, drawn), count: 0, grown: false,
  };
}

function bucketCullSet(
  capacity: number, origins: Float32Array, buf: Float32Array, foliage: Float32Array, strength: Float32Array,
  drawn: Bucket["drawn"],
): CullSet {
  return cullSet(capacity, origins, { src: buf, dst: drawn.buf }, [{ src: foliage, dst: drawn.foliage }], [{ src: strength, dst: drawn.strength }]);
}

/** Instances a bucket's first real allocation covers. A tier's cells are
 * split twelve ways by character and size, and the fine tier's disc (4 m +
 * pad) holds a few hundred cells at full strength, so the common bucket
 * settles after one or two doublings and only the coarse tier's fine-grass
 * bucket — the 0.6 weight over an 18 m disc — climbs further. */
const BUCKET_MIN_INSTANCES = 64;

/** Shared zero-length placeholder for a bucket that has never held an
 * instance: `ensureCapacity` replaces it the first time one lands, and until
 * then nothing reads or writes it. */
const EMPTY_BUFFER = new Float32Array(0);

/** One matrix's worth of scratch floats, so a cell's matrix can be composed
 * and copied into the kept values at any offset without a per-instance
 * subarray view — `computeInstance`'s trick in the clutter shell. */
const scratchMat = new Float32Array(16);
/** The widened frustum's planes, rewritten by each cut. */
const cullScratchPlanes = new Float32Array(20);
/** All-zero planes, which `cullPrefix` passes every instance through. */
const KEEP_ALL = new Float32Array(20);
/** The frame handed to `instanceMatrixFor`: the bench's own trample frame with
 * the height scaled by the cell's strength and canopy. Module-level and
 * rewritten per cell, because a walk computes thousands of cells and an
 * object per cell is exactly the allocation this file rules out. */
const scratchFrame: { height: number; lean: number; ax: number; az: number; tint: Rgb } = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };

/**
 * Grows a bucket's buffers to hold `bucket.count` instances if they do not
 * already, doubling from `BUCKET_MIN_INSTANCES` so a bucket allocates a
 * bounded number of times over a session and never per rebuild. The old
 * contents are dropped rather than copied: every live instance is rewritten
 * immediately afterwards.
 */
function ensureCapacity(bucket: Bucket): void {
  const needed = bucket.count * 16;
  if (bucket.buf.length >= needed) {
    bucket.grown = false;
    return;
  }
  let capacity = Math.max(bucket.buf.length, BUCKET_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  bucket.buf = new Float32Array(capacity);
  // 16 floats of matrix per instance ↔ 4 of foliage ↔ 1 of strength.
  bucket.foliage = new Float32Array(capacity / 4);
  bucket.strength = new Float32Array(capacity / 16);
  bucket.drawn = { buf: new Float32Array(capacity), foliage: new Float32Array(capacity / 4), strength: new Float32Array(capacity / 16) };
  bucket.origins = new Float32Array((capacity / 16) * 3);
  bucket.cull = bucketCullSet(capacity / 16, bucket.origins, bucket.buf, bucket.foliage, bucket.strength, bucket.drawn);
  bucket.grown = true;
}

/**
 * Hands a grown bucket's new drawn buffers to its mesh after a rebuild. A
 * bucket that did not grow needs nothing here: its mesh keeps drawing the last
 * cut's prefix, whose drawn buffers the rebuild does not touch, until `cull`
 * cuts the new collected set, which it does in the same frame. A grown one
 * has fresh, empty drawn buffers, so it draws nothing until then.
 *
 * The buffers are created UPDATABLE (`staticBuffer` false) for the reason
 * `clutterMeshes.ts` records: `Buffer.updateDirectly` no-ops silently on a
 * non-updatable buffer, so `cull`'s prefix uploads would never reach the GPU.
 */
function applyGrown(bucket: Bucket): void {
  if (!bucket.grown) return;
  const { mesh } = bucket;
  mesh.thinInstanceSetBuffer("matrix", bucket.drawn.buf, 16, false);
  mesh.thinInstanceSetBuffer("foliage", bucket.drawn.foliage, 4, false);
  mesh.thinInstanceSetBuffer("bladeStrength", bucket.drawn.strength, 1, false);
  // `thinInstanceSetBuffer` set the count to the whole capacity. A zero-count
  // bucket must be disabled outright: with `instancesCount` 0 Babylon's
  // `hasThinInstances` is false and the bare clump mesh would be drawn once at
  // the origin.
  mesh.thinInstanceCount = 0;
  mesh.setEnabled(false);
}

/**
 * Hands a bucket's drawn buffers, at their full capacity, back to its mesh.
 * After a WebGL context restore Babylon rebuilds each GPU buffer from the data
 * it was last given, which a prefix upload leaves as the prefix alone; a later,
 * longer cut would then write past its end. The bucket draws nothing until the
 * next cut fills it again.
 */
function rehandBucket(bucket: Bucket): void {
  if (bucket.drawn.buf.length === 0) return;
  bucket.grown = true;
  applyGrown(bucket);
  bucket.grown = false;
  cullInvalidate(bucket.cull);
}

/**
 * Cuts one bucket's collected set by `planes` into its drawn buffers, sets
 * the count to the kept cells and uploads only them (Babylon's count form of
 * `thinInstancePartialBufferUpdate`: `kept` strides from offset 0). A bucket
 * that keeps exactly the cells of its last cut is left as it is: no copy, no
 * upload.
 */
function cutBucket(bucket: Bucket, planes: Float32Array): void {
  if (!cullPrefix(planes, bucket.count, bucket.cull)) return;
  const { mesh } = bucket;
  const kept = bucket.cull.kept;
  mesh.thinInstanceCount = kept;
  if (kept > 0) {
    mesh.thinInstancePartialBufferUpdate("matrix", kept, 0);
    mesh.thinInstancePartialBufferUpdate("foliage", kept, 0);
    mesh.thinInstancePartialBufferUpdate("bladeStrength", kept, 0);
  }
  mesh.setEnabled(kept > 0);
}

/** One tier's material: opaque, two-sided, the meadow green, with the
 * blades profile, the sun-only translucency, its tier's hand-off band, and
 * never the distance fade. No texture and no alpha, so the material never
 * alpha-tests and never compiles a discard — early depth rejection stays on
 * for the whole draw, which keeps a full near field of grass cheap over the
 * cards drawn under it. The hand-off is geometric instead: each blade
 * shrinks to its root across the band, so there is nothing to dither. */
function createTierMaterial(scene: Scene, tier: number, meshHeight: number): PBRMaterial {
  const mat = new PBRMaterial(`${BLADE_MESH_PREFIX}_t${tier}_mat`, scene);
  mat.albedoColor = new Color3(BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = BLADE_ROUGHNESS;
  mat.backFaceCulling = false;
  attachFoliage(mat, FOLIAGE_PROFILES.BLADES, meshHeight);
  attachFoliageLight(mat);
  setFoliageBladeEdges(mat, bladeTierBands()[tier]!);
  return mat;
}

/** The clump mesh for one character, tier and size: the pure geometry through
 * `VertexData`, the `blade` record as a custom vertex buffer (set after
 * `applyToMesh`, which rebuilds the mesh's buffers). */
function createClumpMesh(scene: Scene, character: number, tier: number, size: number, count: number): Mesh {
  const g = bladeClumpGeometry(BLADE_CHARACTERS[character]!, count);
  const mesh = new Mesh(bladeMeshName(character, tier, size), scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  // `applyToMesh` already set the bounding box from the positions, and a
  // custom vertex kind does not move it, so the box the caller reads the
  // material's height uniform off is correct as it stands — and it must be,
  // because `prepBucketMesh` pins it (`doNotSyncBoundingInfo`) and nothing
  // syncs it again for the life of the mesh.
  mesh.setVerticesData("blade", g.blade, false, 4);
  prepBucketMesh(mesh);
  // The one clutter that receives shadows, against the rule `prepBucketMesh`
  // just applied: opaque, near the eye and inside the first cascade, a clump
  // under the canopy must sit in the turf's shadow — lit geometry on shadowed
  // ground reads as a glow at this range, where a card's could hide behind its
  // size and its cutout. It still never casts; no clutter does.
  mesh.receiveShadows = true;
  return mesh;
}

/** Floats kept per cell: the matrix (16), then the tint (4). */
const KEPT_STRIDE = 20;
const KEPT_FOLIAGE = 16;

export function createBladeMeshes(scene: Scene, seed: number, options: BladeMeshesOptions): BladeMeshes {
  /**
   * A cell's matrix and tint, computed the first time it is listed. Both are
   * functions of the cell and the seed alone: the trample frame is the
   * trail's, the height scale the cell's own strength and canopy, the tint
   * the ground under it. Nothing in them depends on the eye, the tier the
   * cell is listed in (a cell in two tiers' lists draws the same clump in
   * each), the time or the wind. The strength is the cell's own field.
   */
  function computeCell(c: BladeCell, out: Float32Array, offset: number): void {
    const frame = trampleFrame(seed, c);
    // A thin sward is short as well as sparse: bladeHeightScale carries that.
    const heightScale = bladeHeightScale(c.strength, c.canopy);
    // `trampleFrame` returns a SHARED scratch object, valid only until the
    // next call. The copy below exists so the height can be scaled without
    // writing through to it, and it copies `tint` only to stay a faithful
    // frame — `instanceMatrixFor` reads height, lean and the axis, never the
    // tint, so that field is inert here. The live read of the shared frame
    // is `writeFoliage`'s `frame.tint`, which is why the order (frame,
    // matrix, foliage) must stay inside one call: hoisting `writeFoliage`
    // past the next `trampleFrame` would stain this cell with the following
    // cell's bench tint. Only values are kept, never the frame.
    scratchFrame.height = frame.height * heightScale;
    scratchFrame.lean = frame.lean;
    scratchFrame.ax = frame.ax;
    scratchFrame.az = frame.az;
    scratchFrame.tint = frame.tint;
    instanceMatrixFor(c, scratchFrame, scratchMat);
    out.set(scratchMat, offset);
    writeFoliage(seed, c, out, offset + KEPT_FOLIAGE, frame);
  }
  const kept = createKeptValues<BladeCell>(KEPT_STRIDE, computeCell);
  // Memoizing collector, not the pure `collectBladeCells`: a rebuild happens
  // on every 1 m crossing, and re-sampling the whole disc from cold each time
  // would pay fresh gate, terrain and density samples for thousands of cells
  // that have not moved (see bladeField.ts). A cell it lets go takes its kept
  // values with it.
  const collector = createBladeCollector(seed, (c) => kept.release(c));
  /** `buckets[tier][character][size]`. */
  const buckets: Bucket[][][] = [];
  const materials: PBRMaterial[] = [];
  const meshes: Mesh[] = [];
  for (let tier = 0; tier < 3; tier++) {
    const row: Bucket[][] = [];
    // The tier's tallest clump sets the material's height uniform, which the
    // plugin divides the vertex's height by to weight the sway. One material
    // serves all twelve of the tier's character-size buckets, so the tallest
    // of them is the only choice that never drives a weight past 1.
    let tallest = 0;
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      const sizes: Bucket[] = [];
      for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
        const mesh = createClumpMesh(scene, ch, tier, size, bladeCountFor(options.quality, ch, tier, size));
        tallest = Math.max(tallest, mesh.getBoundingInfo().boundingBox.maximum.y);
        sizes.push(emptyBucket(mesh));
        meshes.push(mesh);
      }
      row.push(sizes);
    }
    const mat = createTierMaterial(scene, tier, tallest);
    for (const sizes of row) for (const bucket of sizes) bucket.mesh.material = mat;
    materials.push(mat);
    buckets.push(row);
  }
  let disposed = false;
  const jobs = options.jobs;
  const restoreObserver = scene.getEngine().onContextRestoredObservable.add(() => {
    for (const row of buckets) for (const sizes of row) for (const bucket of sizes) rehandBucket(bucket);
    dirty = true;
  });
  /** Set by a rebuild: the collected sets changed, so the next `cull` cuts
   * whatever the pose. */
  let dirty = false;
  /** What the drawn buffers hold: nothing cut yet, every cell (`cull(null)`),
   * or the cut at `lastPose`. */
  let cutMode: "none" | "all" | "pose" = "none";
  const lastPose: CullPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 0, aspect: 0 };

  /**
   * One tier's fill: two passes over its list, so every bucket knows its size
   * before a single matrix is written and no buffer has to grow mid-fill.
   * Pass 1 counts, `ensureCapacity` grows what it must, pass 2 writes
   * (reusing `count` as the cursor) into the collected buffers, then a grown
   * bucket's new drawn buffers go to its mesh; `cull` uploads the rest. The
   * list arrives nearest-first from the field and is walked in order, so each
   * bucket's instances stay sorted by distance. Pass 2 copies each cell's
   * kept matrix and tint, computing them only for a cell listed for the
   * first time (`computeCell`).
   */
  function fill(list: BladeCell[], row: Bucket[][]): void {
    for (const sizes of row) for (const bucket of sizes) bucket.count = 0;
    for (const c of list) row[c.character]![c.size]!.count++;
    for (const sizes of row) for (const bucket of sizes) {
      ensureCapacity(bucket);
      bucket.count = 0;
    }
    for (const c of list) {
      const bucket = row[c.character]![c.size]!;
      const at = kept.offsetOf(c);
      const data = kept.data;
      const { buf, foliage, origins } = bucket;
      const m = bucket.count * 16, f = bucket.count * 4, o = bucket.count * 3;
      for (let k = 0; k < 16; k++) buf[m + k] = data[at + k]!;
      origins[o] = data[at + 12]!;
      origins[o + 1] = data[at + 13]!;
      origins[o + 2] = data[at + 14]!;
      for (let k = 0; k < 4; k++) foliage[f + k] = data[at + KEPT_FOLIAGE + k]!;
      bucket.strength[bucket.count] = c.strength;
      bucket.count++;
    }
    for (const sizes of row) for (const bucket of sizes) {
      applyGrown(bucket);
      // The collected buffers were rewritten: the last cut's indices no
      // longer name the same cells.
      cullInvalidate(bucket.cull);
    }
  }

  /**
   * The rebuild for an eye at (x, z), as slices (`syncJobs.ts`): the tier
   * lists collected, then all three fills in the last slice. The fills write
   * the collected buffers `cull` reads, so they run in one step: a cut between
   * two of them would upload a bucket half written.
   */
  function* rebuild(x: number, z: number): Slices {
    const tiers: BladeTiers = yield* collector.collectSlices(x, z);
    fill(tiers.fine, buckets[0]!);
    fill(tiers.mid, buckets[1]!);
    fill(tiers.coarse, buckets[2]!);
    dirty = true;
    view.x = x;
    view.z = z;
  }

  const crossing = createCrossing();
  const view = { x: NaN, z: NaN };
  const owner = {};

  return {
    /**
     * Rebuild only when the eye's snapped origin moves, on the field's own
     * BLADE_REBUILD_CELL — the cell BLADE_PAD is derived from, so every tier
     * list collected at the old origin still covers the eye anywhere inside
     * the new cell and no clump pops. A one-cell step at a walk is a job
     * given `options.jobs` (`crossingAt` says which crossings build at once).
     */
    update(x, z) {
      if (disposed) return;
      const ox = Math.floor(x / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
      const oz = Math.floor(z / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
      const kind = crossingAt(crossing, x, z, ox, oz, BLADE_REBUILD_CELL, jobs !== undefined);
      if (kind === "none") return;
      if (kind === "later") {
        (jobs as SyncJobs).begin(owner, rebuild(x, z));
        return;
      }
      jobs?.cancel(owner);
      finish(rebuild(x, z));
    },
    view,
    cull(pose) {
      if (disposed) return;
      if (!dirty && (pose === null ? cutMode === "all" : cutMode === "pose" && !needsCull(lastPose, pose))) return;
      let planes = KEEP_ALL;
      if (pose === null) {
        cutMode = "all";
      } else {
        cullPlanes(pose, cullScratchPlanes);
        planes = cullScratchPlanes;
        Object.assign(lastPose, pose);
        cutMode = "pose";
      }
      dirty = false;
      for (const row of buckets) for (const sizes of row) for (const bucket of sizes) cutBucket(bucket, planes);
    },
    meshes,
    get kept() {
      return kept.size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      jobs?.cancel(owner);
      scene.getEngine().onContextRestoredObservable.remove(restoreObserver);
      // The meshes and the materials are both ours — generated here, adopted
      // from no container — so both have to be disposed by hand.
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
      meshes.length = 0;
    },
  };
}
