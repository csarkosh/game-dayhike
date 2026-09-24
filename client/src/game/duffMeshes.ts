/**
 * The Babylon shell over `duffField.ts`: one thin-instance bucket per clump
 * character and distance tier, on one opaque material per tier, filled from
 * the field's tier lists with the cards' own matrix and tint writers
 * (clutterMeshes.ts) plus a per-instance strength. `bladeMeshes.ts`'s sibling:
 * same rebuild cadence, same two-pass fill, same buffer-reuse discipline, same
 * dispose. The differences are the field's own — two tiers, not three, since
 * duff never grows fine detail the way a blade clump does, and no size axis,
 * since a duff cell's `strength` is already bounded to [0, 1] and never buys a
 * bigger clump the way a blade cell's boosted `cover` does.
 *
 * Draw-call budget: 3 characters × 2 tiers = 6 draws, opaque and
 * single-material, filling in what the thinning grass field gives up.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import {
  DUFF_REACH, DUFF_REBUILD_CELL, createDuffCollector, duffTierBands, type DuffCell, type DuffTiers,
} from "./duffField.js";
import { DUFF_ALBEDO, DUFF_CHARACTERS, DUFF_CHARACTER_COUNT, DUFF_TIER_COUNTS, duffClumpGeometry } from "./duffClump.js";
import { attachFoliage, FOLIAGE_PROFILES, setFoliageBladeEdges } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { instanceMatrixFor, prepBucketMesh, trampleFrame, writeFoliage } from "./clutterMeshes.js";

export const DUFF_MESH_PREFIX = "duff_clumps";
export function duffMeshName(character: number, tier: number): string {
  return `${DUFF_MESH_PREFIX}_c${character}_t${tier}`;
}
/** The material's roughness: duller than the blades' 0.8 — dead leaf litter
 * scatters light more diffusely than a living blade's waxy surface. */
const DUFF_ROUGHNESS = 0.9;

export type DuffMeshesOptions = { quality: "high" | "medium" };

export type DuffMeshes = {
  update(camX: number, camZ: number): void;
  /** Every bucket mesh, in tier-then-character order. Complete the moment
   * `createDuffMeshes` returns — the blade shell's own contract, since the
   * clumps are generated geometry rather than a GLB that lands later. */
  readonly meshes: readonly Mesh[];
  dispose(): void;
};

/** One character bucket inside one tier: its mesh and the three buffers it
 * uploads, reused across rebuilds and grown geometrically. */
type Bucket = {
  mesh: Mesh;
  /** Matrix data; capacity is `buf.length / 16`. */
  buf: Float32Array;
  /** Four floats per instance (ground colour rgb + canopy shade), the
   * `foliage` attribute; capacity tracks `buf`. Every bucket wears the DUFF
   * profile's tinting, so unlike the clutter shell there is no bucket that
   * leaves this one empty. */
  foliage: Float32Array;
  /** One float per instance, the `bladeStrength` attribute the DUFF profile
   * declares (`blades: true`): the cell's own `strength`, already bounded to
   * [0, 1] by the ground-cover field, no separate clamp needed. Named for the
   * GPU attribute it becomes rather than reusing the blade shell's `strength`
   * field name, since duff has no unclamped `cover` for that name to
   * disambiguate from. */
  bladeStrength: Float32Array;
  /** Instances this rebuild — counted in pass 1, then reused as the write
   * cursor in pass 2, so it is the live count again when the fill ends. */
  count: number;
  /** Set when `buf` was replaced this rebuild: the mesh then needs a fresh
   * `thinInstanceSetBuffer` (a new GPU buffer) rather than an in-place upload
   * of the existing one. */
  grown: boolean;
};

/** Instances a bucket's first real allocation covers — the blade shell's own
 * floor, sized the same way: duff's discs are smaller (12 m high, 8 m
 * medium) than a blade tier's, so every bucket settles within a doubling or
 * two of this floor. */
const BUCKET_MIN_INSTANCES = 64;

/** Shared zero-length placeholder for a bucket that has never held an
 * instance: `ensureCapacity` replaces it the first time one lands, and until
 * then nothing reads or writes it. */
const EMPTY_BUFFER = new Float32Array(0);

/** One matrix's worth of scratch floats, so the fill can compose a matrix and
 * copy it into a bucket buffer at any offset without a per-instance subarray
 * view — `writeInstanceMatrix`'s trick in the clutter shell. */
const scratchMat = new Float32Array(16);

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
  // 16 floats of matrix per instance ↔ 4 of foliage ↔ 1 of bladeStrength.
  bucket.foliage = new Float32Array(capacity / 4);
  bucket.bladeStrength = new Float32Array(capacity / 16);
  bucket.grown = true;
}

/**
 * Pushes a filled bucket to its mesh — `bladeMeshes.ts`'s own `applyBucket`,
 * buffer names aside. See there for why the buffers are created UPDATABLE and
 * why the tail past `count` is re-uploaded whole on an in-place write.
 */
function applyBucket(bucket: Bucket): void {
  const { mesh, count } = bucket;
  if (bucket.grown) {
    mesh.thinInstanceSetBuffer("matrix", bucket.buf, 16, false);
    mesh.thinInstanceSetBuffer("foliage", bucket.foliage, 4, false);
    mesh.thinInstanceSetBuffer("bladeStrength", bucket.bladeStrength, 1, false);
    mesh.thinInstanceCount = count;
  } else {
    mesh.thinInstanceCount = count;
    if (count > 0) {
      mesh.thinInstanceBufferUpdated("matrix");
      mesh.thinInstanceBufferUpdated("foliage");
      mesh.thinInstanceBufferUpdated("bladeStrength");
    }
  }
  // A zero-count bucket must be disabled outright: with `instancesCount` 0
  // Babylon's `hasThinInstances` is false and the bare clump mesh would be
  // drawn once at the origin.
  mesh.setEnabled(count > 0);
}

/** One tier's material: opaque, two-sided (a laid-down twig or leaf is seen
 * from any yaw), the dead-leaf albedo, with the DUFF profile, its tier's
 * hand-off band, and never the distance fade — the hand-off is geometric,
 * the blade shell's own reasoning. */
function createTierMaterial(scene: Scene, tier: number, meshHeight: number, reach: number): PBRMaterial {
  const mat = new PBRMaterial(`${DUFF_MESH_PREFIX}_t${tier}_mat`, scene);
  mat.albedoColor = new Color3(DUFF_ALBEDO.r, DUFF_ALBEDO.g, DUFF_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = DUFF_ROUGHNESS;
  mat.backFaceCulling = false;
  attachFoliage(mat, FOLIAGE_PROFILES.DUFF, meshHeight);
  attachFoliageLight(mat);
  setFoliageBladeEdges(mat, duffTierBands(reach)[tier]!);
  return mat;
}

/** The clump mesh for one character and tier: the pure geometry through
 * `VertexData`, the `blade` record as a custom vertex buffer (set after
 * `applyToMesh`, which rebuilds the mesh's buffers). */
function createClumpMesh(scene: Scene, character: number, tier: number, count: number): Mesh {
  const g = duffClumpGeometry(DUFF_CHARACTERS[character]!, count);
  const mesh = new Mesh(duffMeshName(character, tier), scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("blade", g.blade, false, 4);
  prepBucketMesh(mesh);
  // Against `prepBucketMesh`'s own rule (clutter never receives shadows,
  // measured too costly at bush scale): duff lies flat on the turf, which
  // DOES receive shadows, so a lit mat on shadowed ground would be the exact
  // glow `bladeMeshes.ts` calls out for its own clumps — opaque, near the eye,
  // inside the first cascade — and the argument is stronger here than for a
  // standing blade, since duff is floor rather than something standing above
  // the ground it shares a shadow with.
  mesh.receiveShadows = true;
  return mesh;
}

export function createDuffMeshes(scene: Scene, seed: number, options: DuffMeshesOptions): DuffMeshes {
  const reach = DUFF_REACH[options.quality];
  // Memoizing collector, not the pure `collectDuffCells`: a rebuild happens on
  // every 1 m crossing, and re-sampling the whole disc from cold each time
  // would pay fresh gate, terrain and density samples for thousands of cells
  // that have not moved (see duffField.ts).
  const collector = createDuffCollector(seed);
  /** `buckets[tier][character]`. */
  const buckets: Bucket[][] = [];
  const materials: PBRMaterial[] = [];
  const meshes: Mesh[] = [];
  for (let tier = 0; tier < 2; tier++) {
    const row: Bucket[] = [];
    // The tier's tallest clump sets the material's height uniform, the blade
    // shell's own reasoning: one material serves all three of the tier's
    // character buckets, so the tallest is the only choice that never drives
    // the sway weight past 1 (moot here, since DUFF's amp is 0 — see below —
    // but the uniform is shared machinery the plugin always binds).
    let tallest = 0;
    for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
      const count = DUFF_TIER_COUNTS[options.quality][tier]!;
      const mesh = createClumpMesh(scene, ch, tier, count);
      tallest = Math.max(tallest, mesh.getBoundingInfo().boundingBox.maximum.y);
      row.push({ mesh, buf: EMPTY_BUFFER, foliage: EMPTY_BUFFER, bladeStrength: EMPTY_BUFFER, count: 0, grown: false });
      meshes.push(mesh);
    }
    const mat = createTierMaterial(scene, tier, tallest, reach);
    for (const bucket of row) bucket.mesh.material = mat;
    materials.push(mat);
    buckets.push(row);
  }
  let disposed = false;
  let builtX = NaN;
  let builtZ = NaN;

  /**
   * One tier's fill: two passes over its list, so every bucket knows its size
   * before a single matrix is written and no buffer has to grow mid-fill.
   * The list arrives nearest-first from the field and is walked in order, so
   * each bucket's instances stay sorted by distance.
   */
  function fill(list: DuffCell[], row: Bucket[]): void {
    for (const bucket of row) bucket.count = 0;
    for (const c of list) row[c.character]!.count++;
    for (const bucket of row) {
      ensureCapacity(bucket);
      bucket.count = 0;
    }
    for (const c of list) {
      const bucket = row[c.character]!;
      // The litter class is not in `TRAMPLED`, so this is always the identity
      // frame for duff — called anyway, rather than skipped, so the fill
      // walks the same path `bladeMeshes.ts` does and the two shells stay
      // comparable; nobody later has to wonder whether duff is meant to
      // flatten near the trail and does not.
      const frame = trampleFrame(seed, c);
      instanceMatrixFor(c, frame, scratchMat);
      bucket.buf.set(scratchMat, bucket.count * 16);
      writeFoliage(seed, c, bucket.foliage, bucket.count * 4, frame);
      bucket.bladeStrength[bucket.count] = c.strength;
      bucket.count++;
    }
    for (const bucket of row) applyBucket(bucket);
  }

  function rebuild(x: number, z: number): void {
    const tiers: DuffTiers = collector.collect(x, z, reach);
    fill(tiers.near, buckets[0]!);
    fill(tiers.far, buckets[1]!);
  }

  return {
    /**
     * Rebuild only when the eye's snapped origin moves, on the field's own
     * DUFF_REBUILD_CELL — the blade shell's own inlined-snap reasoning:
     * this runs every frame, and an object per call is exactly the per-frame
     * allocation this file rules out.
     */
    update(x, z) {
      if (disposed) return;
      const ox = Math.floor(x / DUFF_REBUILD_CELL) * DUFF_REBUILD_CELL;
      const oz = Math.floor(z / DUFF_REBUILD_CELL) * DUFF_REBUILD_CELL;
      if (ox === builtX && oz === builtZ) return;
      builtX = ox;
      builtZ = oz;
      rebuild(x, z);
    },
    meshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      // The meshes and the materials are both ours — generated here, adopted
      // from no container — so both have to be disposed by hand.
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
      meshes.length = 0;
    },
  };
}
