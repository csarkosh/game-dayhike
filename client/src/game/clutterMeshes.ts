/**
 * The Babylon shell over `clutterField.ts`: thin-
 * instance buckets for the nine clutter classes — grass, rock, boulder,
 * driftwood, fungus, bush, meadow, flower, litter — two LOD levels deep. All band
 * math is `clutterField.ts` (via its memoizing `createClutterCollector`,
 * output-identical to the pure `collectClutter`); what lives here is buffers,
 * matrices and dispose — the same split as `forestField.ts`/`forestMeshes.ts`,
 * whose idioms this file follows: `AssetContainer` loading, one bucket per
 * model per LOD, deferred update while the GLBs land, `setEnabled(count > 0)`,
 * dispose discipline.
 *
 * It is `forestMeshes.ts`'s simpler sibling, and the simplifications are the
 * design: NO impostors and no bakes ("nothing here is tall enough
 * to earn one", so there is no render target, no alpha-tested quad, no
 * readiness gate), NO cohort or species split (a clutter class picks between
 * variant models by the instance's own `variant` field, which the sim already
 * drew), and only two of the three LOD levels each model ships: LOD0 for
 * the `near` band, LOD1 for `far`. LOD2 exists in every file and goes unused —
 * a prop's LOD1 is already 36–230 triangles, and a third ring would buy
 * single-digit triangles per instance at the cost of seventeen more draw calls.
 *
 * Draw-call budget ("one draw per model per LOD"): every clutter GLB
 * is single-primitive and single-material, so each bucket is exactly one draw
 * call — 17 models × 2 LOD levels = 34, all of them ground cover the forest's
 * own 29 sit on top of, plus one opaque blade-clump draw for the meadow on
 * the tiers that create it.
 *
 * Allocation discipline ("no per-frame allocation on the hot path"):
 * `update` allocates NOTHING while the camera stays inside its 3 m grass cell,
 * which is the per-frame case; a rebuild reuses one `Float32Array` per bucket,
 * grown geometrically and never shrunk, and composes each matrix through
 * module-level scratch objects. This is the one place the file deliberately
 * diverges from `forestMeshes.ts`, which allocates a fresh buffer per rebuild:
 * clutter rebuilds on a 3 m crossing rather than the forest's 12 m, so its
 * eighteen buffers would churn four times as often.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// friends are patched onto `Mesh.prototype` by this module. Without it the
// calls below are `undefined` at runtime — the same failure mode
// `forestMeshes.ts` and `lighting.ts` record at their own imports.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Node } from "@babylonjs/core/node.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import { bladeEdges, BLADE_PAD, BLADE_RADIUS, clutterFadeEdges, clutterSeamEdges, createClutterCollector } from "./clutterField.js";
import { bladeClumpGeometry } from "./bladeClump.js";
import {
  CLUTTER_BOULDER,
  CLUTTER_BUSH,
  CLUTTER_CLASS_COUNT,
  CLUTTER_DRIFTWOOD,
  CLUTTER_FLOWER,
  CLUTTER_GRASS,
  CLUTTER_GRASS_CELL,
  CLUTTER_LITTER,
  CLUTTER_MEADOW,
  CLUTTER_ROCK,
  type ClutterInstance,
} from "../sim/clutter.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { attachFoliage, setFoliageEdges, FOLIAGE_PROFILES, type FoliageProfile } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { attachDistanceFade, fadeBands, FADE_ALWAYS, writeFadeBands, type FadeBands } from "./distanceFadePlugin.js";
import { seatOnGround } from "./groundTilt.js";
import { modelUrl } from "./assetUrls.js";
import { surfaceAlbedo } from "./terrainSurface.js";
import { macroNoise, macroTint, TUFT_ALBEDO } from "./groundHexParams.js";
import { forestDensity } from "../sim/vegetation.js";
import type { Rgb } from "./colour.js";
import { trampleAt, TRAMPLE_BAND } from "./trailBenchParams.js";
// The boulder mesh's sink is the COLLIDER's own constants, not a second pair
// tuned by eye: `clutter.boulder_a/b` were sized so that a mesh sunk by
// exactly BOULDER_SINK · (that variant's own BASE_H) · scale shows a visible
// top level with the top of the box `passes/clutter.ts` pushes for THAT
// variant — exactly so for the untilted mesh; the box stays axis-aligned and
// unchanged (correctly — it must stay bit-identical), but the ground-conform
// pass now tilts the mesh onto the ground normal up to 41°, so the top-alignment
// this sink buys is only approximate once tilted (measured within ~0.15 m at
// the steepest measured ground). Importing them from the pass keeps the two
// derived from one source — a retune of either moves the mesh and the box
// together. The import also evaluates the pass module, whose `registerPass`
// side effect is idempotent under ESM (one module instance per process), so
// it cannot double-register pass 7.
import { BOULDER_A_BASE_H, BOULDER_B_BASE_H, BOULDER_SINK } from "../sim/passes/clutter.js";

/**
 * Model per class per variant, indexed by the class ids of `sim/clutter.ts`
 * (grass 0, rock 1, boulder 2, driftwood 3, fungus 4, bush 5, meadow 6,
 * flower 7, litter 8) and then by the instance's own `variant` draw. Driftwood and
 * meadow ship ONE model each, which is why the sim gives those classes
 * `variants: 1` and their instances always draw variant 0. Litter reuses the
 * rock and driftwood models at its own (small) scale range rather than
 * shipping dedicated pebble/twig geometry.
 */
const CLUTTER_MODEL_URLS: readonly (readonly string[])[] = [
  [modelUrl("models/clutter.grass_a.glb"), modelUrl("models/clutter.grass_b.glb")],
  [modelUrl("models/clutter.rock_a.glb"), modelUrl("models/clutter.rock_b.glb")],
  [modelUrl("models/clutter.boulder_a.glb"), modelUrl("models/clutter.boulder_b.glb")],
  [modelUrl("models/clutter.driftwood.glb")],
  [modelUrl("models/clutter.fungus_a.glb"), modelUrl("models/clutter.fungus_b.glb")],
  [modelUrl("models/clutter.bush_a.glb"), modelUrl("models/clutter.bush_b.glb")],
  [modelUrl("models/clutter.meadow.glb")],
  [modelUrl("models/clutter.flower_a.glb"), modelUrl("models/clutter.flower_b.glb")],
  [modelUrl("models/clutter.rock_a.glb"), modelUrl("models/clutter.rock_b.glb"), modelUrl("models/clutter.driftwood.glb")],
];

/** LOD node names inside each shipped GLB, in bucket order: index 0 is the
 * `near` band's bucket, index 1 the `far` band's. Every file also ships an
 * "LOD2"; see the file-head comment for why it is unused. */
const LOD_NAMES = ["LOD0", "LOD1"] as const;
const NEAR_LOD = 0;
const FAR_LOD = 1;

/**
 * How far every non-boulder prop is sunk below its sampled ground height (m).
 * A grass card's base edge and a rock's flattened underside sit exactly on
 * y = 0 in their own model space (ARCHITECTURE.md, Model conventions), which lands them coplanar with
 * the terrain triangle underneath and z-fights at grazing angles. Two
 * centimetres is under a blade's width, so nothing visibly shortens.
 * Boulders sink far further and by their own rule — see `BOULDER_SINK`.
 */
export const CLUTTER_SINK = 0.02;

/** Ground-layer classes that sway and carry the foliage plugin's ground
 * tint, mapped to the profile that governs their amplitude, root darkening
 * and canopy shade. Rock, boulder, driftwood, and fungus stay static. */
const FOLIAGE_BY_CLASS = new Map<number, FoliageProfile>([
  [CLUTTER_GRASS, FOLIAGE_PROFILES.GRASS],
  [CLUTTER_MEADOW, FOLIAGE_PROFILES.MEADOW],
  [CLUTTER_FLOWER, FOLIAGE_PROFILES.FLOWER],
  [CLUTTER_BUSH, FOLIAGE_PROFILES.BUSH],
]);

/** Classes that LIE on the ground rather than stand on it, so they take the
 * ground normal. Grass, meadow, flower, bush and fungus are excluded: measured,
 * their worst footprint gap is 0.28 m, and they sway, which a tilt fights.
 * Litter reuses the rock and driftwood meshes, so it tilts the same way. */
const TILTED = new Set<number>([CLUTTER_ROCK, CLUTTER_BOULDER, CLUTTER_DRIFTWOOD, CLUTTER_LITTER]);

/** Per-variant base scale of the litter class: rock_a/rock_b at the sim's
 * 0.25–0.6 are pebbles already; driftwood needs another 0.3 to be a twig. */
export const LITTER_VARIANT_SCALE: readonly number[] = [1, 1, 0.3];

/** The blade clump mesh's name, and its bucket's index in the meadow class's
 * variant-0 list, after the two LOD buckets. The bucket exists only when
 * `ClutterMeshesOptions.blades` is set (the tiers above low). */
export const BLADE_MESH_NAME = "clutter_blades";
export const BLADE_BUCKET = 2;

/** The classes the bench tramples: the swaying ground layer. */
const TRAMPLED = new Set<number>([CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FLOWER]);

/** Instances a bucket's first real allocation covers. Sized so the sparse
 * classes (boulder ≤ 260, fungus ≤ 500 across two variants and two bands)
 * settle after one or two doublings, and grass — the only class that reaches
 * the high hundreds per bucket — after four. */
const BUCKET_MIN_INSTANCES = 64;

/** Shared zero-length placeholder for a bucket that has never held an
 * instance: `ensureCapacity` replaces it the first time one lands, and until
 * then nothing reads or writes it. */
const EMPTY_BUFFER = new Float32Array(0);

export type ClutterMeshesOptions = {
  /** Scales every class radius together — the quality-tier knob, passed
   * straight to the collector (low ≈ 60% radii). */
  radiusScale?: number;
  /** Draw the meadow's near instances as blade clumps (bladeClump.ts) inside
   * BLADE_RADIUS, handing off to the cards across `bladeEdges()`. Off on the
   * low tier, which keeps the cards alone. */
  blades?: boolean;
  /** NullEngine escape hatch: bucket meshes per class → variant → LOD in
   * place of the seventeen production GLBs (the forestMeshes `assets` idiom).
   * `adopt` runs synchronously on them. */
  assets?: Mesh[][][][];
};

export type ClutterMeshes = {
  update(camX: number, camZ: number): void;
  /**
   * The boulder buckets — the complete clutter shadow-caster set. Grass,
   * rocks, driftwood, fungus and bush never cast: they are small props at
   * four-figure instance counts, and the shadow-map draw costs more than the
   * contact darkening it would buy. In production the GLBs load
   * asynchronously, so this array starts empty and fills once; callers that
   * register casters must watch its length, not snapshot it at creation —
   * the same contract `ForestMeshes.casterMeshes` carries.
   */
  readonly casterMeshes: readonly Mesh[];
  dispose(): void;
};

/**
 * One logical bucket: every geometry-bearing mesh of one model's one LOD
 * level (single-primitive for all seventeen clutter GLBs, so one mesh in practice)
 * sharing a single reused instance buffer.
 */
type Bucket = {
  meshes: Mesh[];
  /** Matrix data, reused across rebuilds; capacity is `buf.length / 16`. */
  buf: Float32Array;
  /** Four floats per instance, `fadeBands` attribute; capacity tracks `buf`. */
  bands: Float32Array;
  /** Four floats per instance (ground colour rgb + canopy shade), the
   * `foliage` attribute; capacity tracks `buf`. Only written and uploaded
   * when `tints` is set — the classes without the foliage plugin never read
   * this buffer, so it stays at `EMPTY_BUFFER`. */
  foliage: Float32Array;
  /** The constant every instance of this bucket carries. */
  fade: FadeBands;
  /** Set for the classes that wear the foliage plugin (`FOLIAGE_BY_CLASS`),
   * which is exactly the classes whose `foliage` buffer this file writes and
   * uploads. */
  tints: boolean;
  /** Set for every GLB bucket, which dithers and so uploads `fadeBands`; the
   * blade bucket is opaque, carries no fade plugin, and uploads none. */
  fades: boolean;
  /** Instances this rebuild — counted in pass 1, then reused as the write
   * cursor in pass 2, so it is the live count again when the fill ends. */
  count: number;
  /** Set when `buf` was replaced this rebuild: the mesh then needs a fresh
   * `thinInstanceSetBuffer` (a new GPU buffer) rather than an in-place
   * upload of the existing one. */
  grown: boolean;
};

const UP = Vector3.Up();
const scratchQ = new Quaternion();
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchMat = new Matrix();
const scratchLeanAxis = new Vector3();
const scratchLean = new Quaternion();
/** One matrix's worth of scratch floats, reused by `instanceMatrixFor` so
 * `writeInstanceMatrix` can copy it into a bucket buffer at any offset
 * without `Matrix.copyToArray` needing a per-instance subarray view. */
const scratchMatBuf = new Float32Array(16);

/** The node itself plus descendants, filtered to meshes that carry geometry —
 * `forestMeshes.ts`'s helper, which cannot be shared without exporting it from
 * a module this file doesn't otherwise touch. */
function geometryMeshes(node: Node): Mesh[] {
  const out: Mesh[] = [];
  const all: Node[] = [node, ...node.getChildMeshes(false)];
  for (const n of all) {
    if (n instanceof Mesh && n.getTotalVertices() > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Flags every bucket mesh needs before it can hold thin instances.
 *
 * Clutter thin instances deliberately never receive shadows (left at the
 * Babylon default `receiveShadows = false`): measured ~4 ms
 * for bush-scale receivers alone, enough on its own to push a
 * deep-forest frame past the 16.7 ms vsync cliff. Bushes read as
 * canopy-shadowed instead via a pre-darkened palette colour (`bush` in
 * `assets/palette.json`) rather than a real shadow
 * sample. The blade bucket is the one exception, and turns the flag back on
 * itself right after this call — see `adopt`. */
function prepBucketMesh(mesh: Mesh): void {
  mesh.isPickable = false;
  // Babylon culls a thin-instance mesh by its own bounding box, and syncing
  // that box would scan every matrix in the buffer on each rebuild
  // (`thinInstanceRefreshBoundingInfo` inside `thinInstanceSetBuffer`).
  // Clutter surrounds the camera on every side exactly as the forest does, so
  // the bucket is simply always active and the sync is skipped.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  // Nothing to draw until the first rebuild fills a buffer.
  mesh.setEnabled(false);
}

/**
 * Grows `bucket.buf` to hold `bucket.count` matrices if it does not already,
 * doubling from `BUCKET_MIN_INSTANCES` so a bucket allocates a bounded number
 * of times over a session and never per rebuild. The old contents are dropped
 * rather than copied: every live matrix is rewritten immediately afterwards.
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
  // 16 floats of matrix per instance ↔ 4 floats of bands (or foliage) per instance.
  bucket.bands = new Float32Array(capacity / 4);
  bucket.foliage = new Float32Array(capacity / 4);
  bucket.grown = true;
}

/**
 * Pushes a filled bucket to its meshes. A bucket whose buffer was just grown
 * needs the whole GPU buffer recreated; one that was written in place needs
 * only the live prefix re-uploaded, which is what `thinInstanceBufferUpdated`
 * does once `thinInstanceCount` has been set (it uploads `instancesCount`
 * strides, not the whole array).
 *
 * The buffer is created UPDATABLE (`staticBuffer` false), unlike
 * `forestMeshes.ts`'s static one, and that is load-bearing rather than a
 * preference: `Buffer.updateDirectly` no-ops silently on a non-updatable
 * buffer, so an in-place rebuild would never reach the GPU and the field
 * would freeze at whatever the last wholesale set left behind. Babylon's
 * recovery path for that (`thinInstanceAllowAutomaticStaticBufferRecreation`,
 * off unless opted into) disposes and recreates the GPU buffer on EVERY
 * update — the exact per-rebuild allocation this file's buffer reuse exists
 * to avoid. Updatable from the start is both correct and cheap.
 */
function applyBucket(bucket: Bucket): void {
  const count = bucket.count;
  for (const mesh of bucket.meshes) {
    if (bucket.grown) {
      // Sets `thinInstanceCount` to the full CAPACITY as a side effect, which
      // the assignment below immediately trims to the live count.
      mesh.thinInstanceSetBuffer("matrix", bucket.buf, 16, false);
      if (bucket.fades) mesh.thinInstanceSetBuffer("fadeBands", bucket.bands, 4, false);
      if (bucket.tints) mesh.thinInstanceSetBuffer("foliage", bucket.foliage, 4, false);
      mesh.thinInstanceCount = count;
    } else {
      mesh.thinInstanceCount = count;
      if (count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        if (bucket.fades) mesh.thinInstanceBufferUpdated("fadeBands");
        if (bucket.tints) mesh.thinInstanceBufferUpdated("foliage");
      }
    }
    // A zero-count bucket must be disabled outright: with `instancesCount` 0
    // Babylon's `hasThinInstances` is false and the bare bucket mesh would be
    // drawn once at the origin.
    mesh.setEnabled(count > 0);
  }
}

/** The untrampled identity frame: frozen, and shared by every card the bench
 * does not touch rather than allocated per instance. */
const IDENTITY_TRAMPLE_FRAME: { readonly height: number; readonly lean: number; readonly ax: number; readonly az: number; readonly tint: Rgb } =
  Object.freeze({ height: 1, lean: 0, ax: 0, az: 0, tint: Object.freeze({ r: 1, g: 1, b: 1 }) });
/** `trampleFrame`'s own scratch result: written in place and returned, so a
 * rebuild's per-instance call costs no allocation. Callers use the fields
 * before the next call, the same contract `instanceMatrixFor`'s scratch
 * matrix and quaternions already carry. */
const scratchTrampleFrame: { height: number; lean: number; ax: number; az: number; tint: Rgb } = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };

/**
 * The trampled band beside the bench for one card: height scale, lean (rad)
 * about the horizontal axis perpendicular to the away direction (ax, az) —
 * the unit gradient of the trail distance, by central difference — and the
 * stain tint. The identity frame past TRAMPLE_BAND[1], with no trail, and
 * for every class the bench does not trample.
 */
export function trampleFrame(seed: number, inst: ClutterInstance): Readonly<{ height: number; lean: number; ax: number; az: number; tint: Rgb }> {
  if (!TRAMPLED.has(inst.cls)) return IDENTITY_TRAMPLE_FRAME;
  const rtOf = activeTerrainVariant().trailDistance;
  if (rtOf === undefined) return IDENTITY_TRAMPLE_FRAME;
  const rt = rtOf(seed, inst.x, inst.z);
  if (rt >= TRAMPLE_BAND[1]) return IDENTITY_TRAMPLE_FRAME;
  const h = 0.25;
  let gx = rtOf(seed, inst.x + h, inst.z) - rtOf(seed, inst.x - h, inst.z);
  let gz = rtOf(seed, inst.x, inst.z + h) - rtOf(seed, inst.x, inst.z - h);
  const gl = Math.hypot(gx, gz);
  if (gl > 1e-9) { gx /= gl; gz /= gl; } else { gx = 0; gz = 0; }
  const t = trampleAt(rt);
  scratchTrampleFrame.height = t.height;
  scratchTrampleFrame.lean = t.lean;
  scratchTrampleFrame.ax = gx;
  scratchTrampleFrame.az = gz;
  scratchTrampleFrame.tint = t.tint;
  return scratchTrampleFrame;
}

/**
 * The instance's world matrix, written into `out` (16 floats, offset 0):
 * `writeInstanceMatrix`'s pure core, split out so a test can build one
 * matrix and inspect it directly rather than reading a bucket buffer back
 * off a `thinInstanceSetBuffer` spy. Rotation is derived HERE, from the
 * plain `hash` draw the sim emits: sim/ is forbidden trig, game/ is not —
 * the same division of labour `forestMeshes`' `treeMatrixBuffer` documents.
 * Yaw for the classes that stand, yaw composed with the ground normal for
 * the classes that lie — rock, boulder, driftwood and litter (which reuses
 * their meshes), whose flat undersides hang visibly on a slope untilted.
 * Litter also scales by its own per-variant table (`LITTER_VARIANT_SCALE`)
 * on top of the sim's own scale, on the class's own pebble/twig models — no
 * other class reads that table. Uniform scale otherwise, and a per-class
 * sink:
 *  - BOULDER sinks `BOULDER_SINK · (variant's own BASE_H) · scale`, the seat
 *    the mesh was sized around and the pass's per-variant collider box is
 *    derived from — variant 0 uses BOULDER_A_BASE_H, variant 1 uses
 *    BOULDER_B_BASE_H.
 *  - everything else sinks `CLUTTER_SINK`, purely to break coplanarity.
 */
export function instanceMatrixFor(inst: ClutterInstance, frame: ReturnType<typeof trampleFrame>, out: Float32Array): void {
  const yaw = inst.hash * Math.PI * 2;
  if (TILTED.has(inst.cls)) {
    seatOnGround(yaw, inst.groundDx, inst.groundDz, scratchQ);
  } else {
    Quaternion.RotationAxisToRef(UP, yaw, scratchQ);
  }
  if (frame.lean > 0) {
    // The axis perpendicular to the away direction, chosen (by the right-hand
    // rule) so the card's top moves ALONG (ax, az) rather than into the bed;
    // composed after the yaw (and after the ground tilt for tilted classes —
    // cards are not tilted, so for them it is yaw then lean).
    scratchLeanAxis.copyFromFloats(frame.az, 0, -frame.ax);
    Quaternion.RotationAxisToRef(scratchLeanAxis, frame.lean, scratchLean);
    scratchLean.multiplyToRef(scratchQ, scratchQ);
  }
  const litterScale = inst.cls === CLUTTER_LITTER ? inst.scale * (LITTER_VARIANT_SCALE[inst.variant] ?? 1) : inst.scale;
  scratchScale.copyFromFloats(litterScale, litterScale * frame.height, litterScale);
  const boulderBaseH = inst.variant === 1 ? BOULDER_B_BASE_H : BOULDER_A_BASE_H;
  const sink = inst.cls === CLUTTER_BOULDER ? BOULDER_SINK * boulderBaseH * inst.scale : CLUTTER_SINK;
  scratchPos.copyFromFloats(inst.x, inst.groundH - sink, inst.z);
  Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchMat);
  scratchMat.copyToArray(out);
}

function writeInstanceMatrix(inst: ClutterInstance, buf: Float32Array, offset: number, frame: ReturnType<typeof trampleFrame>): void {
  instanceMatrixFor(inst, frame, scratchMatBuf);
  buf.set(scratchMatBuf, offset);
}

/** Ground colour at the instance (the palette the clipmap bakes into vertex
 * colour, so grass and ground can never disagree) and the canopy shade the
 * bush palette used to carry by hand. slope = |∇h|; canopy = forestDensity. */
function writeFoliage(seed: number, inst: ClutterInstance, buf: Float32Array, offset: number, frame: ReturnType<typeof trampleFrame>): void {
  const slope = Math.hypot(inst.groundDx, inst.groundDz);
  const canopy = forestDensity(seed, inst.x, inst.z);
  const c = surfaceAlbedo(seed, inst.x, inst.z, inst.groundH, slope, canopy);
  // The floor applies the same tint in terrainTexture.ts, so a tuft and the
  // ground under it agree where the ground is grass and inside the relief
  // fade; on non-grass ground the card carries this tint alone, and past the
  // fade the floor's tint has faded out while the card keeps its own.
  const ny = 1 / Math.sqrt(1 + inst.groundDx * inst.groundDx + inst.groundDz * inst.groundDz);
  const tint = macroTint(macroNoise(inst.x, inst.z), 1 - ny);
  buf[offset] = c.r * tint.r * frame.tint.r;
  buf[offset + 1] = c.g * tint.g * frame.tint.g;
  buf[offset + 2] = c.b * tint.b * frame.tint.b;
  buf[offset + 3] = 1 - 0.5 * canopy;
}

/**
 * The blade clump as a Babylon mesh: the pure geometry through `VertexData`,
 * the `blade` record as a custom vertex buffer (set after `applyToMesh`,
 * which rebuilds the mesh's buffers), and an opaque two-sided PBR material
 * in the tuft colour whose vertex colours carry the per-blade tint. No
 * texture and no alpha, so the material never alpha-tests and never carries
 * a discard: early depth rejection stays on for the whole draw. The foliage
 * plugins attach here with the BLADES profile; the bucket flags and the
 * plugin's edges are the shell's.
 */
export function createBladeMesh(scene: Scene): Mesh {
  const g = bladeClumpGeometry();
  const mesh = new Mesh(BLADE_MESH_NAME, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("blade", g.blade, false, 4);
  const mat = new PBRMaterial(`${BLADE_MESH_NAME}_mat`, scene);
  mat.albedoColor = new Color3(TUFT_ALBEDO.r, TUFT_ALBEDO.g, TUFT_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = 0.8;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.refreshBoundingInfo();
  attachFoliage(mat, FOLIAGE_PROFILES.BLADES, mesh.getBoundingInfo().boundingBox.maximum.y);
  attachFoliageLight(mat);
  return mesh;
}

/**
 * The clutter's Babylon shell. Production loads the seventeen shipped GLBs
 * asynchronously and builds buckets when they arrive; the returned object is
 * complete immediately — an `update` before the assets exist just remembers
 * the camera, and is replayed the moment they land.
 */
export function createClutterMeshes(
  scene: Scene,
  seed: number,
  options: ClutterMeshesOptions = {},
): ClutterMeshes {
  const radiusScale = options.radiusScale ?? 1;
  const blades = options.blades ?? false;
  const bladeReach = blades ? BLADE_RADIUS + BLADE_PAD : 0;
  // Memoizing collector, not the pure `collectClutter`: a rebuild happens on
  // every 3 m grass-cell crossing, and re-sampling all eight discs from cold
  // each time would pay fresh density and terrain samples for thousands of
  // cells that have not moved (see clutterField.ts).
  const collector = createClutterCollector(seed);

  const casterMeshes: Mesh[] = [];
  const containers: AssetContainer[] = [];
  /** `buckets[class][variant][lod]`, or null until the GLBs land. */
  let buckets: Bucket[][][] | null = null;
  let bladeMesh: Mesh | null = null;
  let disposed = false;

  // Last camera seen and last origin built. Split so an `update` that arrives
  // while the GLBs are still loading is honoured the moment they land.
  let camX = NaN;
  let camZ = NaN;
  let builtX = NaN;
  let builtZ = NaN;

  /**
   * The bucket an instance belongs in. Indexing by the sim's own `variant`
   * draw is the whole variant mechanism; the `?? variants[0]` fallback covers
   * only a model table that has fallen behind the sim's per-class `variants`
   * count, where crashing the frame would be the worse failure.
   */
  function bucketFor(variants: Bucket[][], inst: ClutterInstance, lod: number): Bucket {
    const perLod = variants[inst.variant] ?? (variants[0] as Bucket[]);
    return perLod[lod] as Bucket;
  }

  /**
   * Rebuild: two passes over the collected bands, so every bucket knows its
   * size before a single matrix is written and no buffer has to grow
   * mid-fill. Pass 1 counts, `ensureCapacity` grows what it must, pass 2
   * writes (reusing `count` as the cursor), then the buffers are pushed.
   */
  function rebuild(x: number, z: number): void {
    const all = buckets as Bucket[][][];
    const bands = collector.collect(x, z, radiusScale, bladeReach);

    for (const variants of all) {
      for (const perLod of variants) {
        for (const bucket of perLod) bucket.count = 0;
      }
    }
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const variants = all[cls] as Bucket[][];
      const band = bands[cls] as { near: ClutterInstance[]; far: ClutterInstance[]; blades: ClutterInstance[] };
      for (const inst of band.near) bucketFor(variants, inst, NEAR_LOD).count++;
      for (const inst of band.far) bucketFor(variants, inst, FAR_LOD).count++;
      if (cls === CLUTTER_MEADOW && bladeMesh !== null) {
        (variants[0] as Bucket[])[BLADE_BUCKET]!.count += band.blades.length;
      }
    }

    for (const variants of all) {
      for (const perLod of variants) {
        for (const bucket of perLod) {
          ensureCapacity(bucket);
          bucket.count = 0;
        }
      }
    }
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      const variants = all[cls] as Bucket[][];
      const band = bands[cls] as { near: ClutterInstance[]; far: ClutterInstance[]; blades: ClutterInstance[] };
      for (const inst of band.near) {
        const bucket = bucketFor(variants, inst, NEAR_LOD);
        const frame = trampleFrame(seed, inst);
        writeInstanceMatrix(inst, bucket.buf, bucket.count * 16, frame);
        writeFadeBands(bucket.bands, bucket.count * 4, bucket.fade);
        if (bucket.tints) writeFoliage(seed, inst, bucket.foliage, bucket.count * 4, frame);
        bucket.count++;
      }
      for (const inst of band.far) {
        const bucket = bucketFor(variants, inst, FAR_LOD);
        const frame = trampleFrame(seed, inst);
        writeInstanceMatrix(inst, bucket.buf, bucket.count * 16, frame);
        writeFadeBands(bucket.bands, bucket.count * 4, bucket.fade);
        if (bucket.tints) writeFoliage(seed, inst, bucket.foliage, bucket.count * 4, frame);
        bucket.count++;
      }
      if (cls === CLUTTER_MEADOW && bladeMesh !== null) {
        const bucket = (variants[0] as Bucket[])[BLADE_BUCKET] as Bucket;
        for (const inst of band.blades) {
          const frame = trampleFrame(seed, inst);
          writeInstanceMatrix(inst, bucket.buf, bucket.count * 16, frame);
          if (bucket.tints) writeFoliage(seed, inst, bucket.foliage, bucket.count * 4, frame);
          bucket.count++;
        }
      }
    }

    for (const variants of all) {
      for (const perLod of variants) {
        for (const bucket of perLod) applyBucket(bucket);
      }
    }
  }

  /**
   * Rebuild only when the cell-snapped origin moves. ONE snap for all eight
   * classes, on the SMALLEST cell (grass, 3 m): the bands are a pure function
   * of each class's own snapped origin, so snapping on the finest grid can
   * only rebuild more often than a per-class snap would, never less — and the
   * collector's per-cell memoization absorbs the extra polls, which is what
   * makes one shared origin cheaper than tracking eight. Instance positions
   * live on each class's own fixed world lattice, so a stale origin only
   * shifts each disc's *boundary* by up to ~4 m diagonal, invisible at the
   * meadow's 20 m rim and its 9 m LOD split; rebuilding on the 0.7 m grid
   * would rebuild ~4× as often for no visible gain.
   *
   * Snapped inline rather than through a `{x, z}` helper: this runs every
   * frame, and an object per call is exactly the per-frame allocation this
   * file rules out.
   */
  function maybeBuild(): void {
    if (buckets === null || Number.isNaN(camX)) return;
    const originX = Math.floor(camX / CLUTTER_GRASS_CELL) * CLUTTER_GRASS_CELL;
    const originZ = Math.floor(camZ / CLUTTER_GRASS_CELL) * CLUTTER_GRASS_CELL;
    if (originX === builtX && originZ === builtZ) return;
    builtX = originX;
    builtZ = originZ;
    rebuild(camX, camZ);
  }

  /**
   * Bucket meshes for one named LOD of a loaded container — `forestMeshes.ts`'
   * `lodMeshes`, minus its impostor-bake reparenting (no bake here needs a
   * single root to walk from). Located by NAME anywhere in the node graph,
   * never by scene-root position, because the shipped files nest the LOD roots
   * under wrapper nodes and the loader adds its own `__root__`.
   *
   * Each mesh gets its world transform (which carries the glTF right-handed →
   * Babylon left-handed conversion on the loader's `__root__`) baked into its
   * vertices and is then detached with an identity transform: thin instances
   * compose as `world * instanceMatrix`, i.e. the bucket mesh's own world
   * matrix is applied AFTER the per-instance matrix, so any leftover mesh
   * transform would mirror the whole placed field rather than each prop.
   * `bakeTransformIntoVertices` flips triangle winding when the determinant is
   * negative, so the handedness mirror keeps faces outward.
   */
  function lodMeshes(container: AssetContainer, name: string): Mesh[] {
    const nodes: Node[] = [...container.transformNodes, ...container.meshes];
    const root = nodes.find((n) => n.name === name);
    if (root === undefined) return [];
    const meshes = geometryMeshes(root);
    // Snapshot every world matrix before resetting any transform: if one
    // bucket mesh were an ancestor of another, resetting it first would
    // corrupt the descendant's world matrix mid-loop.
    const worlds = meshes.map((mesh) => mesh.computeWorldMatrix(true).clone());
    for (const [i, mesh] of meshes.entries()) {
      mesh.bakeTransformIntoVertices(worlds[i] as Matrix);
      mesh.position.setAll(0);
      mesh.rotationQuaternion = null;
      mesh.rotation.setAll(0);
      mesh.scaling.setAll(1);
      // Detach from the container hierarchy, whose nodes still carry the
      // transforms just baked away.
      mesh.parent = null;
    }
    return meshes;
  }

  /** Loads one container, adds it to the scene, and disables everything it
   * brought that isn't in one of the returned bucket groups (LOD2, empty
   * wrappers). Returns null if disposed mid-await — the caller must bail out
   * without adopting anything. */
  async function loadBucketed(url: string): Promise<Mesh[][] | null> {
    const container = await loadAssetContainerAsync(url, scene);
    containers.push(container);
    // Disposed while awaiting: dispose() has already run over an earlier
    // (possibly empty) container list, so clean up what just landed here.
    if (disposed) {
      container.dispose();
      return null;
    }
    container.addAllToScene();
    const groups = LOD_NAMES.map((lodName) => lodMeshes(container, lodName));
    const bucketed = new Set<Mesh>(groups.flat());
    for (const mesh of container.meshes) {
      if (mesh instanceof Mesh && !bucketed.has(mesh)) mesh.setEnabled(false);
    }
    return groups;
  }

  /** Turns the loaded mesh groups into buckets and replays any update that
   * arrived while they were loading. */
  function adopt(loaded: Mesh[][][][]): void {
    buckets = loaded.map((variants, cls) =>
      variants.map((perLod) =>
        perLod.map((meshes, lod) => {
          for (const mesh of meshes) prepBucketMesh(mesh);
          // Boulders are the only clutter that casts — see `casterMeshes`.
          // BOTH their LOD buckets do: a boulder crossing the near/far split
          // would otherwise drop its shadow mid-view.
          if (cls === CLUTTER_BOULDER) casterMeshes.push(...meshes);
          // Every class dithers toward its disc edge, and across its near/far
          // seam: the near LOD fades out over the seam, the
          // far LOD in over the seam and out over the edge. Hoisted above the
          // foliage block below, which also needs `edge`.
          const edge = clutterFadeEdges(cls, radiusScale);
          const seam = clutterSeamEdges(cls, radiusScale);
          const profile = FOLIAGE_BY_CLASS.get(cls);
          if (profile !== undefined) {
            for (const mesh of meshes) {
              if (mesh.material) {
                // Bake ran already, so the bound box is the placed geometry;
                // models put the origin at the footprint base, so max.y IS the height.
                mesh.refreshBoundingInfo();
                attachFoliage(mesh.material, profile, mesh.getBoundingInfo().boundingBox.maximum.y);
                attachFoliageLight(mesh.material);
                // `edges` lives on the plugin instance, so it is per MATERIAL:
                // a card GLB's two LOD buckets share one material, so setting
                // the far bucket's edges here also governs the near bucket's
                // plugin instance — harmless, since the near bucket sits
                // entirely inside the disc edge already.
                if (lod === FAR_LOD) setFoliageEdges(mesh.material, [edge.start, edge.end]);
              }
            }
          }
          // With blades on, the meadow's near cards dither IN across the
          // blade band: inside it the clumps are the grass, and a card
          // fragment there is discarded before any fetch.
          const fade: FadeBands = lod === NEAR_LOD
            ? fadeBands(blades && cls === CLUTTER_MEADOW ? [bladeEdges().start, bladeEdges().end] : null, [seam.start, seam.end])
            : fadeBands([seam.start, seam.end], [edge.start, edge.end]);
          for (const mesh of meshes) {
            if (mesh.material) attachDistanceFade(mesh.material);
          }
          return {
            meshes,
            buf: EMPTY_BUFFER,
            bands: EMPTY_BUFFER,
            foliage: EMPTY_BUFFER,
            count: 0,
            grown: false,
            fade,
            tints: profile !== undefined,
            fades: true,
          };
        }),
      ),
    );
    if (blades) {
      // The meadow's third bucket: the clump mesh on the near instances. Its
      // material's edge band is the hand-off band, and the meadow's near CARD
      // bucket dithers in across the same band (above), so the two sides of
      // the hand-off read one pair of numbers.
      bladeMesh = createBladeMesh(scene);
      prepBucketMesh(bladeMesh);
      // The one clutter bucket that RECEIVES shadows, against the rule
      // `prepBucketMesh` just applied: the clumps are opaque, a few metres
      // from the eye and inside the first cascade, so a clump under the
      // canopy has to sit in the same shadow as the turf it stands in — lit
      // geometry on shadowed ground reads as a glow at this range, where a
      // card's could hide behind its size and its cutout. It still never
      // casts; no clutter does.
      bladeMesh.receiveShadows = true;
      const band = bladeEdges();
      setFoliageEdges(bladeMesh.material as Material, [band.start, band.end]);
      (buckets[CLUTTER_MEADOW]![0] as Bucket[])[BLADE_BUCKET] = {
        meshes: [bladeMesh],
        buf: EMPTY_BUFFER,
        bands: EMPTY_BUFFER,
        foliage: EMPTY_BUFFER,
        count: 0,
        grown: false,
        fade: FADE_ALWAYS,
        tints: true,
        fades: false,
      };
    }
    maybeBuild();
  }

  /** Production path: the seventeen clutter GLBs, `forestMeshes.ts`'s loading
   * idiom (itself `enemyModel.ts`'s). */
  async function loadAssets(): Promise<void> {
    registerBuiltInLoaders();
    try {
      const loaded: Mesh[][][][] = [];
      for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
        const urls = CLUTTER_MODEL_URLS[cls] as readonly string[];
        const variants: Mesh[][][] = [];
        for (const url of urls) {
          const groups = await loadBucketed(url);
          if (groups === null) return;
          variants.push(groups);
        }
        loaded.push(variants);
      }
      adopt(loaded);
    } catch {
      // A missing or broken asset costs the ground cover, never the match —
      // the same degrade-don't-block rule as `createForestMeshes`.
    }
  }

  // Fire and forget, like the forest's: clutter pops in when the assets land,
  // and stays absent forever if they fail. The NullEngine escape hatch runs
  // synchronously so the attachment is provable under test.
  if (options.assets !== undefined) adopt(options.assets);
  else void loadAssets();

  return {
    update(x, z) {
      if (disposed) return;
      camX = x;
      camZ = z;
      // While the GLBs are still loading this only remembers the camera;
      // adopt() replays it the moment they land.
      maybeBuild();
    },
    casterMeshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      // The blade mesh and its material are ours, not a container's, so the
      // material has to be disposed here rather than left to a container;
      // captured before the bucket loop below disposes the mesh itself,
      // since that loop already reaches this mesh through its own bucket.
      const bladeMat = bladeMesh?.material ?? null;
      if (buckets !== null) {
        for (const variants of buckets) {
          for (const perLod of variants) {
            for (const bucket of perLod) {
              for (const mesh of bucket.meshes) mesh.dispose();
            }
          }
        }
      }
      bladeMat?.dispose();
      bladeMesh = null;
      // Containers own whatever the buckets did not adopt (materials, LOD2
      // meshes, wrapper nodes); mesh.dispose is idempotent, so the overlap
      // with the loop above is harmless.
      for (const container of containers) container.dispose();
      casterMeshes.length = 0;
      buckets = null;
    },
  };
}
