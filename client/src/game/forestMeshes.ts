/**
 * The Babylon shell over `forestField.ts`: thin-instance buckets for
 * the near LOD rings and understory, plus one alpha-tested impostor quad per
 * species for the far annulus. All band math is `forestField.ts`'s
 * (via its memoizing `createBandCollector`, output-identical to the pure
 * `collectBands`); what lives here is buffers, materials and dispose — the
 * same split as `clipmap.ts`/`renderer.ts` and `water.ts`/`renderer.ts`.
 *
 * Four cohorts, one shell: canopy giants and regeneration saplings both take
 * the full 3-LOD-plus-impostor treatment, and standing snags and fallen nurse
 * logs share ONE near bucket, instancing `deadwood.snag`'s LOD2 mesh — see
 * `deadwoodMatrixBuffer` for why LOD2 and not LOD0 — whose SNAG half carries
 * on past the near radius as a billboard of its own, baked upright
 * (`SNAG_POSE`) because the asset is modelled lying down. Saplings and snags
 * used to STOP at the near radius, on the argument that an 11 m tree is
 * nearly sub-pixel beyond it; the no-visible-spawn design retired that:
 * a sapling is still tens of pixels wide at 300 m, so ending it at
 * NEAR_RADIUS is a spawn edge the player walks into, and a billboard costs
 * one plane and one 256² bake per cohort. Saplings shipped as a
 * single LOD0-only bucket at first, trading triangles for draw calls; that
 * traded the wrong way — ~87% of near-band saplings sit past LOD_RING_1,
 * and rendering them all at LOD0 measured 1.7-2.5 ms/frame of GPU cost at a
 * deep-forest camera in production.
 *
 * Every bucket dithers rather than pops: each carries a
 * `fadeBands` quad — in-band, out-band — that `applyBucketBuffer` writes once
 * per instance, so a tree cross-fades across a LOD ring instead of swapping
 * meshes on one frame. The impostor planes are the one bucket whose bands
 * are NOT constant: the on-lattice list and the off-lattice fill list share
 * a plane, a material and a bake, and end at different ranges — which is the
 * whole reason `fadeBands` is a per-INSTANCE attribute rather than a uniform.
 *
 * Draw-call budget (≤ 32): a multi-primitive glTF mesh (bark +
 * canopy) loads as separate SIBLING `Mesh` objects, one `SubMesh` each —
 * never one mesh with two submeshes — so each bark/canopy pair below is 2
 * draw calls, not "2 submeshes of 1 mesh". 2 giant species × 3 LODs × 2
 * sibling meshes = 12, + 2 sapling species × 3 LODs × 2 sibling meshes =
 * 12, + 5 impostor planes (2 giants, 2 saplings, 1 snag) = 5, + 2 understory
 * (single-material, 1 mesh each) = 2, + 1 deadwood bucket (single-material)
 * = 1. Total 32, and 32 is the budget: raised from 30
 * because saplings and snags now
 * exist beyond the near radius, and +2 is immaterial against a
 * 250-call frame ceiling. An empty bucket is disabled and costs nothing
 * (`applyBucketBuffer`), and the sapling rings are the sparse ones, so a
 * real camera draws fewer — 30 at the deep-forest camera the budget test
 * measures. The fill list rides the SAME plane as the on-lattice list under
 * per-instance bands rather than taking five planes of its own: on this
 * full-inventory basis those five would have made it 37.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// friends are patched onto `Mesh.prototype` by this module. Without it the
// calls below are `undefined` at runtime — the exact failure mode recorded in
// `lighting.ts`'s import comment.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Node } from "@babylonjs/core/node.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import {
  createBandCollector,
  bandsOrigin,
  NEAR_RADIUS,
  SEAM_LOD0,
  SEAM_LOD1,
  SEAM_FILL,
  SEAM_FAR,
  seamNear,
  UNDERSTORY_RADIUS,
} from "./forestField.js";
import {
  SPECIES_COUNT,
  COHORT_GIANT,
  COHORT_SAPLING,
  COHORT_SNAG,
  forestDensity,
  type TreeInstance,
} from "../sim/vegetation.js";
import { surfaceAlbedo } from "./terrainSurface.js";
import { macroNoise, macroTint } from "./groundHexParams.js";
import { elevationAt } from "../sim/terrain.js";
import { attachFoliage, FOLIAGE_PROFILES, setFoliageEdges } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { groundNormalTilt, groundNormalY, seatOnGround } from "./groundTilt.js";
import { attachGroundConform } from "./groundConformPlugin.js";
import {
  attachDistanceFade,
  fadeBands,
  writeFadeBands,
  type FadeBands,
} from "./distanceFadePlugin.js";
import { modelUrl } from "./assetUrls.js";

/** Species index 0 → fir/conifer_a, 1 → pine/conifer_b (the `treeInCell`
 * convention). Understory keeps pairing off SPECIES, not cohort. */
const TREE_URLS = [modelUrl("models/tree.giant_fir.glb"), modelUrl("models/tree.giant_pine.glb")];
/** The regeneration cohort re-casts the two conifer GLBs the canopy giants
 * used to use — same species split, smaller stand-in trees. */
const SAPLING_URLS = [modelUrl("models/tree.conifer_a.glb"), modelUrl("models/tree.conifer_b.glb")];
/** Deadwood is species-agnostic: one asset, one bucket, both roles (see
 * `deadwoodMatrixBuffer`). */
const DEADWOOD_URL = modelUrl("models/deadwood.snag.glb");
/** Understory follows the tree species split: ferns under a, shrubs under b. */
const UNDERSTORY_URLS = [
  modelUrl("models/understory.fern.glb"),
  modelUrl("models/understory.shrub.glb"),
];

/** Impostor bake resolution — a quad this far away needs no more. */
const IMPOSTOR_BAKE_SIZE = 256;

/** The snag billboard bakes from an UPRIGHT clone. `deadwood.snag` is
 * modelled lying down (long axis on local X — see `deadwoodMatrixBuffer`), so
 * an un-posed bake would billboard a felled trunk against standing ones; this
 * is the very +90° roll `deadwoodMatrixBuffer` applies to the snag role.
 * FROZEN because it is handed live to an injected `bakeImpostor`: Babylon's
 * math types are mutable, and a callee that scaled or normalized it in place
 * would silently re-pose every later bake. */
const SNAG_POSE: Quaternion = Object.freeze(Quaternion.FromEulerAngles(0, 0, Math.PI / 2));

export type SpeciesMeshes = { lods: [Mesh, Mesh, Mesh]; understory?: Mesh };

export type ForestMeshesOptions = {
  /** NullEngine escape hatch: stub meshes instead of the seven production
   * GLBs (2 giants, 2 understory, 2 saplings, 1 deadwood). */
  assets?: {
    /** Canopy giants, per species — unchanged in shape from an earlier pass. */
    giants: SpeciesMeshes[];
    /** Regeneration saplings, per species: a full LOD ladder like the
     * giants' (the optional `understory` field is ignored — understory
     * pairs off the giant species). */
    saplings: SpeciesMeshes[];
    /** Deadwood: one mesh (or multi-primitive root) standing in for
     * `deadwood.snag`'s LOD2, the single bucket both roles ride. */
    deadwood: Mesh;
  } | null;
  /** NullEngine escape hatch: render targets lie under NullEngine, so tests
   * inject a stub. A null bake (sync or resolved) DISABLES that billboard's
   * bucket — far trees drop out rather than draw grey quads. The production
   * default is async: it must wait out shader compilation. Same parameter
   * order as `defaultBakeImpostor`, trailing options and all: `timeoutMs`
   * third, the optional bake `pose` (the snag's upright roll) fourth. */
  bakeImpostor?: (
    mesh: Mesh,
    scene: Scene,
    timeoutMs?: number,
    pose?: Quaternion,
  ) => Texture | null | Promise<Texture | null>;
  /** Near-band radius override — the quality-tier knob (low = 140). */
  nearRadius?: number;
};

export type ForestMeshes = {
  update(camX: number, camZ: number): void;
  /**
   * The LOD0 bucket meshes — the complete forest shadow-caster set. LOD1,
   * LOD2, understory and impostors never cast (LOD1 dropped in a performance
   * check — see the comment at the `casterMeshes.push`
   * call in `adoptSpecies`). In production the GLBs load asynchronously, so
   * this array starts empty and fills once; callers that register casters
   * must watch its length, not snapshot it at creation.
   */
  readonly casterMeshes: readonly Mesh[];
  dispose(): void;
};

/** One logical bucket: every geometry-bearing mesh of a LOD (bark + canopy
 * primitives arrive as separate meshes) sharing a single instance buffer.
 * `fade` is the band pair every instance of the bucket carries — the dither
 * plugin's per-instance attribute, constant within a bucket except on the
 * impostor planes (see `Impostor`). */
type Bucket = { meshes: Mesh[]; fade: FadeBands };

/** One billboard cohort: a single alpha-tested quad drawing BOTH impostor
 * lists — the on-lattice, stride-thinned one and the off-lattice fill inside
 * IMPOSTOR_FULL_RADIUS. They share the plane, the material and the bake and
 * differ only in where they fade out, which the per-instance `fadeBands`
 * attribute carries (`fillImpostor`); five more planes would break the
 * draw-call budget. */
type Impostor = {
  bucket: Bucket;
  /** Vertical centre of the quad in tree-local metres — the quad is
   * origin-centred, the tree origin is at its footprint base. */
  centreY: number;
  /** True once a bake texture landed on the material. Until then — and
   * forever, if the bake returned null or failed — the bucket stays
   * disabled: an untextured alpha-test material draws opaque grey. */
  ready: boolean;
};

type SpeciesBuckets = {
  /** index = LOD 0..2, matching `collectBands().near` (or `.saplings`). */
  lods: [Bucket, Bucket, Bucket];
  understory: Bucket | null;
  impostor: Impostor;
};

const UP = Vector3.Up();
const scratchQ = new Quaternion();
const scratchTiltQ = new Quaternion();
const scratchScale = new Vector3();
const scratchPos = new Vector3();
const scratchMat = new Matrix();

/** The node itself plus descendants, filtered to meshes that carry geometry. */
function geometryMeshes(node: Node): Mesh[] {
  const out: Mesh[] = [];
  const all: Node[] = [node, ...node.getChildMeshes(false)];
  for (const n of all) {
    if (n instanceof Mesh && n.getTotalVertices() > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Flags every bucket mesh needs before it can hold thin instances. */
function prepBucketMesh(mesh: Mesh): void {
  mesh.isPickable = false;
  // Babylon culls a thin-instance mesh by its own bounding box, and syncing
  // that box would scan up to 26k matrices per rebuild
  // (`thinInstanceRefreshBoundingInfo` inside `thinInstanceSetBuffer`). The
  // forest surrounds the camera on every side anyway, so the bucket is simply
  // always active and the sync is skipped.
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  // Nothing to draw until the first update fills a buffer.
  mesh.setEnabled(false);
}

/** `count` copies of one band quad — every bucket but the impostor planes,
 * whose two lists carry different bands (see `fillImpostor`). */
function fadeBandsBuffer(count: number, bands: FadeBands): Float32Array {
  const buf = new Float32Array(4 * count);
  for (let i = 0; i < count; i++) writeFadeBands(buf, i * 4, bands);
  return buf;
}

/** Replaces a bucket's instance buffers wholesale and enables/disables it.
 * `bands` overrides the bucket's constant fade for the buckets that vary per
 * instance; omit it and every instance gets `bucket.fade`. `grad` and
 * `foliage` are the optional per-instance attributes only some buckets carry —
 * the ground gradient the conform plugin reads, and the ground colour the
 * foliage plugin tints the root toward. A bucket whose material declares
 * either MUST pass it: Babylon leaves an unfilled attribute at the generic
 * (0, 0, 0, 1). */
function applyBucketBuffer(
  bucket: Bucket,
  buf: Float32Array,
  grad?: Float32Array,
  bands?: Float32Array,
  foliage?: Float32Array,
): void {
  const count = buf.length / 16;
  const fade = bands ?? fadeBandsBuffer(count, bucket.fade);
  for (const mesh of bucket.meshes) {
    // Static flag: like `applyRingGeometry`, the buffer is replaced wholesale
    // on every rebuild, never edited in place.
    mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
    // The dither bands and the gradient ride the same wholesale-replace
    // discipline. Order matters only in that "matrix" must be set first — it
    // is what fixes the instance count every other per-instance buffer is
    // checked against.
    mesh.thinInstanceSetBuffer("fadeBands", fade, 4, true);
    if (grad !== undefined) mesh.thinInstanceSetBuffer("groundGrad", grad, 2, true);
    if (foliage !== undefined) mesh.thinInstanceSetBuffer("foliage", foliage, 4, true);
    // A zero-count bucket must be disabled outright: with `instancesCount` 0
    // Babylon's `hasThinInstances` is false and the bare bucket mesh would be
    // drawn once at the origin.
    mesh.setEnabled(count > 0);
  }
}

/** World matrices for full-geometry trees and understory: scale and rotation
 * derived renderer-side — sim/ emits `hash`, never angles, so the trig lives
 * HERE (game/ is allowed trig; sim/ is not).
 *
 * `tilt` is the understory's flag and only the understory's. A shrub rests on
 * the ground and leans with it; a conifer grows plumb whatever the hillside
 * does, and its base is closed by the vertex-stage conform instead. */
function treeMatrixBuffer(list: readonly TreeInstance[], tilt: boolean): Float32Array {
  const buf = new Float32Array(16 * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    const yaw = t.hash * Math.PI * 2;
    if (tilt) {
      seatOnGround(yaw, t.groundDx, t.groundDz, scratchQ);
    } else {
      Quaternion.RotationAxisToRef(UP, yaw, scratchQ);
    }
    scratchScale.copyFromFloats(t.scale, t.scale, t.scale);
    scratchPos.copyFromFloats(t.x, t.groundH, t.z);
    Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchMat);
    scratchMat.copyToArray(buf, i * 16);
  }
  return buf;
}

/** Per-instance ground gradient for the conform plugin's `groundGrad`
 * attribute: 8 bytes an instance against the matrix's 64. Built in the same
 * pass as the matrices, from the sample sim/ already took. */
function groundGradBuffer(list: readonly TreeInstance[]): Float32Array {
  const buf = new Float32Array(2 * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    buf[i * 2] = t.groundDx;
    buf[i * 2 + 1] = t.groundDz;
  }
  return buf;
}

/** Per-instance ground colour and canopy shade for the understory's `foliage`
 * attribute — the four floats `writeFoliage` in clutterMeshes.ts writes for
 * ground cover, from the same palette, so a fern's base and the ground it
 * stands in can never disagree. Only the tinting profiles need it, which among
 * the forest buckets is the understory alone: the tree profile has no ground
 * tint and so never declares the attribute. Allocated with the matrix buffer,
 * on the same wholesale-replace discipline. */
function treeFoliageBuffer(seed: number, list: readonly TreeInstance[]): Float32Array {
  const buf = new Float32Array(4 * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    const canopy = forestDensity(seed, t.x, t.z);
    const slope = Math.hypot(t.groundDx, t.groundDz);
    const c = surfaceAlbedo(seed, t.x, t.z, t.groundH, slope, canopy);
    // The floor applies the same tint in terrainTexture.ts, so a tuft and the
    // ground under it agree by construction.
    const ny = 1 / Math.sqrt(1 + t.groundDx * t.groundDx + t.groundDz * t.groundDz);
    const tint = macroTint(macroNoise(t.x, t.z), 1 - ny);
    buf[i * 4] = c.r * tint.r;
    buf[i * 4 + 1] = c.g * tint.g;
    buf[i * 4 + 2] = c.b * tint.b;
    buf[i * 4 + 3] = 1 - 0.5 * canopy;
  }
  return buf;
}

/**
 * World matrices for the one deadwood bucket, which rides two roles.
 * `deadwood.snag` is modelled LYING DOWN in its shipped file — its long axis
 * is local X (4.048 m of a 4.048 × 1.050 × 1.049 m bbox) — so the NURSE LOG
 * role is the asset's native orientation: only yaw varies (from the same
 * `hash` draw `treeMatrixBuffer` uses), so logs lie in varied directions
 * rather than all pointing one way. The STANDING SNAG role is the one that
 * needs rotating upright: a +90° roll (Z-axis) swings the local X axis onto
 * world Y, and — because that roll fixes the Y axis pointwise — the result
 * is exactly vertical for every yaw, so composing yaw and roll in either
 * order still lands the snag standing straight.
 *
 * The mesh origin is NOT at either end of the trunk: it sits at the asset's
 * own mesh origin (not re-centred), a deliberate departure from ARCHITECTURE.md,
 * Model conventions' base-of-object convention, and the shipped LOD2 mesh's local X extends from
 * roughly -1.9 to +2.07 m — the origin sits close to the middle of the
 * trunk's length, not its end. Placing that origin straight at `groundH`
 * (as an early version of this function did) buries a standing snag by
 * roughly half its length. Both roles therefore carry a base-to-ground
 * offset along whichever local axis becomes "up" for that role:
 *  - SNAG: the roll above maps local X to world Y, so the snag's base is
 *    the bucket's local X MINIMUM — a large offset, since it is close to
 *    half the trunk's ~4 m length.
 *  - LOG: the log's base is the bucket's local Y MINIMUM — a small offset,
 *    since the trunk's cross-section is only mildly asymmetric about its
 *    own centre.
 * Both offsets are measured from the ACTUAL loaded bucket geometry (see
 * `createForestMeshes`'s `unionBounds` call on the deadwood meshes at adopt
 * time) rather than hardcoded, so a future update to `deadwood.snag`
 * that shifts the mesh origin updates the offset instead of silently
 * reintroducing this bug.
 *
 * The SNAG role also TILTS onto the ground normal (`groundTilt.ts`),
 * composed AFTER the upright roll so the now-vertical trunk leans with the
 * hillside instead of the un-rolled model. Tilting swings the origin-relative
 * foot offset sideways as well as up/down, which the base-to-ground offset
 * below corrects for (see the inline comment at that offset).
 *
 * The LOG role also PITCHES. `t.groundH` is the terrain height at the
 * instance's ORIGIN x/z only; that is enough for a standing snag (narrow,
 * vertical, one sample covers it) but not for a log lying along its local X
 * axis, which at deadwood scale runs roughly 8 m — long enough that on a
 * slope the far end floats by roughly slope × length (measured live: up to
 * 1.05 m). A real fallen log follows the ground along its own length
 * instead of lying dead level, so this samples the terrain at the log's two
 * ends (from its hashed yaw — kept exactly as before, so logs still lie in
 * varied directions — and its native length, `logMaxX - logMinX`, taken
 * from the loaded geometry's bounds, same as the base offsets above) and
 * pitches to match: rotating about local Z (this file's "roll" parameter)
 * tilts local X toward Y without touching local Z, exactly like the snag's
 * 90° roll above but partial, so it is applied here through the same Euler
 * "roll" slot, with yaw composed after it (Babylon's FromEulerAnglesToRef
 * order) so the tilt survives being pointed in the hashed direction. The
 * two endpoints are computed from yaw and length alone, ignoring the small
 * cosine foreshortening the pitch itself introduces — negligible at the
 * grades this guards against and exactly what keeps this a closed-form,
 * one-pass computation instead of an iterative solve.
 */
function deadwoodMatrixBuffer(
  seed: number,
  list: readonly TreeInstance[],
  snagBaseOffset: number,
  logMinX: number,
  logMaxX: number,
  logMinY: number,
): Float32Array {
  const buf = new Float32Array(16 * list.length);
  // Native trunk length along local X, scale-independent (each instance
  // multiplies by its own t.scale below).
  const logLength = logMaxX - logMinX;
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    const isSnag = t.cohort === COHORT_SNAG;
    const yaw = t.hash * Math.PI * 2;
    scratchScale.copyFromFloats(t.scale, t.scale, t.scale);
    if (isSnag) {
      Quaternion.FromEulerAnglesToRef(0, yaw, Math.PI / 2, scratchQ);
      // Lay the standing trunk onto the ground normal, composed AFTER the
      // upright roll (Hamilton a·b applies b first — see groundTilt.ts).
      groundNormalTilt(t.groundDx, t.groundDz, scratchTiltQ);
      scratchTiltQ.multiplyToRef(scratchQ, scratchQ);
      // The tilt pivots on the instance ORIGIN, so the trunk's foot (local X
      // minimum) swings SIDEWAYS as well as up/down as it leans — it lands
      // snagBaseOffset·scale along the ground normal from the origin, not
      // straight down (the roll+yaw above already put the trunk's local X
      // exactly on that normal, independent of yaw — see the function
      // comment). Sample the REAL terrain at that drifted x/z, the same
      // trick the LOG role below uses for its own ends, rather than
      // linear-approximating from t.groundH and the origin's own gradient:
      // a linear correction is exact on the perfectly planar SLOPE_VARIANT
      // test terrain but drifts off by the field's curvature on Olympic's
      // fbm terrain, whereas sampling the real height at the real point has
      // no such error.
      const nY = groundNormalY(t.groundDx, t.groundDz);
      const footOffset = snagBaseOffset * t.scale;
      const footX = t.x + footOffset * t.groundDx * nY;
      const footZ = t.z + footOffset * t.groundDz * nY;
      const footH = elevationAt(seed, footX, footZ);
      scratchPos.copyFromFloats(t.x, footH + footOffset * nY, t.z);
    } else {
      // World XZ of the log's two ends, from yaw + native length only (see
      // the function comment on why the pitch's own foreshortening is
      // ignored here): rotating local +X by yaw about world Y lands it on
      // (cosYaw, -sinYaw) — the same convention `impostorMatrixBuffer`
      // documents for rotating local +Z by atan2(dx, dz) onto (dx, dz).
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const endAx = t.x + logMinX * t.scale * cosYaw;
      const endAz = t.z - logMinX * t.scale * sinYaw;
      const endBx = t.x + logMaxX * t.scale * cosYaw;
      const endBz = t.z - logMaxX * t.scale * sinYaw;
      const endAH = elevationAt(seed, endAx, endAz);
      const endBH = elevationAt(seed, endBx, endBz);
      const horizLen = logLength * t.scale;
      // The angle that carries the local-X spine from endAH to endBH over
      // that length — this IS the "roll" slot (see the function comment):
      // rotating local X toward Y is exactly rotation about local Z.
      const pitch = horizLen > 0 ? Math.atan2(endBH - endAH, horizLen) : 0;
      // The pitch seats the trunk ALONG its spine, from two real samples — the
      // right tool over a span that reaches 10 m at full scale. It leaves the
      // other axis untouched, which is what makes a log lying across the fall
      // line hang on one flank. Roll about the trunk's own axis closes it,
      // from the analytic gradient resolved perpendicular to the spine.
      // Rotating local +X by yaw lands it on (cosYaw, −sinYaw) in world xz, so
      // the perpendicular horizontal direction is (sinYaw, cosYaw), and a
      // positive roll about local +X carries local +Z downward — hence the
      // negation.
      const across = t.groundDx * sinYaw + t.groundDz * cosYaw;
      const roll = -Math.atan(across);
      Quaternion.FromEulerAnglesToRef(roll, yaw, pitch, scratchQ);
      // Seat end A on its sampled height. `FromEulerAnglesToRef(roll, yaw,
      // pitch)` composes as Ry(yaw)·Rx(roll)·Rz(pitch), so roll is about the
      // trunk's own axis only to FIRST ORDER; the cos(roll) correction below
      // is applied on that basis to the logMinY term (the roll swings the
      // underside about the trunk axis, so the offset that used to reach
      // straight down now reaches down by roughly cos(roll)) but not to the
      // logMinX·sin(pitch) term above it. Measured over 720 yaws: within
      // 0.021 m of an axis-correct composition at every gradient up to 0.86,
      // against a roll that by itself takes max daylight from 0.887 m down
      // to 0.124 m — the approximation costs little of what the roll buys.
      const endAOffsetY =
        logMinX * t.scale * Math.sin(pitch)
        + logMinY * t.scale * Math.cos(pitch) * Math.cos(roll);
      scratchPos.copyFromFloats(t.x, endAH - endAOffsetY, t.z);
    }
    Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchMat);
    scratchMat.copyToArray(buf, i * 16);
  }
  return buf;
}

/**
 * World matrices for impostor quads, each oriented toward the camera at
 * rebuild time. Babylon does NOT billboard thin instances (`billboardMode`
 * lives in the mesh world-matrix path, which instances bypass), so each
 * instance is yawed toward the camera when the buffer is built and the
 * between-rebuild error is accepted: a rebuild happens every tree-cell
 * crossing (12 m), and at ≥ 240 m an error of a few degrees is invisible.
 * The alternative — a custom billboard shader — is out of scope.
 *
 * The plane's two lists are written straight into one buffer, ON-LATTICE
 * FIRST — the order `fillImpostor` writes the matching `fadeBands` in, and
 * the only thing keeping the two per-instance buffers aligned. Taking them
 * as two arguments rather than one concatenated list keeps a ~7k-element
 * copy out of every rebuild.
 */
function impostorMatrixBuffer(
  lattice: readonly TreeInstance[],
  fill: readonly TreeInstance[],
  centreY: number,
  camX: number,
  camZ: number,
): Float32Array {
  const buf = new Float32Array(16 * (lattice.length + fill.length));
  let i = 0;
  for (const list of [lattice, fill]) {
    for (const t of list) {
      // Yaw that points the quad's normal (±Z; the material is two-sided) at
      // the camera: rotating +Z by atan2(dx, dz) about Y lands it on (dx, dz).
      Quaternion.RotationAxisToRef(UP, Math.atan2(camX - t.x, camZ - t.z), scratchQ);
      scratchScale.copyFromFloats(t.scale, t.scale, t.scale);
      // The quad is centred on its origin while the tree origin sits at the
      // footprint base, so the quad centre rides up by the scaled tree centre.
      scratchPos.copyFromFloats(t.x, t.groundH + centreY * t.scale, t.z);
      Matrix.ComposeToRef(scratchScale, scratchQ, scratchPos, scratchMat);
      scratchMat.copyToArray(buf, i * 16);
      i++;
    }
  }
  return buf;
}

/**
 * The impostor lists in ONE pass each, split into the buckets that will draw
 * them: giant species 0..n, then sapling species 0..n, then the one snag
 * slot. `bands.impostors`/`impostorsFill` interleave every cohort, and a
 * filter per plane meant ten passes over up to ~46k instances on every
 * tree-cell crossing — the rebuild this file already guards for cost.
 * COHORT_LOG never reaches these lists (a log is near-field only) and is
 * dropped here if it ever does.
 */
function partitionImpostors(
  list: readonly TreeInstance[],
  giantCount: number,
  saplingCount: number,
): TreeInstance[][] {
  const slots: TreeInstance[][] = [];
  for (let i = 0; i <= giantCount + saplingCount; i++) slots.push([]);
  const snagSlot = giantCount + saplingCount;
  for (const t of list) {
    if (t.cohort === COHORT_GIANT) {
      if (t.species < giantCount) (slots[t.species] as TreeInstance[]).push(t);
    } else if (t.cohort === COHORT_SAPLING) {
      if (t.species < saplingCount) (slots[giantCount + t.species] as TreeInstance[]).push(t);
    } else if (t.cohort === COHORT_SNAG) {
      (slots[snagSlot] as TreeInstance[]).push(t);
    }
  }
  return slots;
}

/** Union of the buckets' local bounding boxes (call after any baking, when
 * local space is world space). */
function unionBounds(meshes: readonly Mesh[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    mesh.refreshBoundingInfo();
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimum);
    max.maximizeInPlace(box.maximum);
  }
  return { min, max };
}

/** Bake-only layer bit: outside the default camera mask (0x0FFFFFFF), so the
 * temporary bake clones are invisible to every scene camera, while the bake's
 * explicit renderList — which skips layer-mask checks — still draws them. */
const IMPOSTOR_BAKE_LAYER = 0x10000000;

/**
 * Default impostor bake: renders the species' LOD1 (plus its primitive
 * siblings) side-on into a small RenderTargetTexture, once, at load. The
 * background clears to alpha 0 so the alpha-tested quad shows tree where
 * there is tree and nothing elsewhere.
 *
 * ASYNC, and that is the point: PBR shaders compile asynchronously, and a
 * render-target pass silently skips any mesh whose effect is not ready — a
 * synchronous render at container-load time bakes alpha-0 nothing and blanks
 * the whole far forest. Worse, readiness is PER RENDER PASS: effects are
 * cached per `renderPassId` × defines, and at least one define differs
 * between the player camera's default pass and this bake pass (the CSM
 * shadow-max-Z comparison reads the ACTIVE camera's `maxZ`, and the bake
 * camera's is a few tree-widths). So `forceCompilationAsync` — which
 * compiles under the default pass — is worthless here: its effect is a cache
 * miss at bake time and the one-shot render still bakes blank (measured live:
 * both clones active in the pass, `isReadyForSubMesh` false, 0/65536 pixels).
 * The only honest gate is `rtt.isReadyForRendering()`, which swaps in the
 * bake camera and the RTT's own render pass, kicks the correct compiles, and
 * reports when the draw will actually happen — so this clones the LOD1
 * hierarchy onto a bake-only layer (the real meshes are about to be disabled
 * and filled with thin instances by `adoptSpecies`), polls that gate, renders
 * once, and disposes the clones. Under NullEngine render targets lie — tests
 * inject a stub instead, so the pixels themselves only exist in a real
 * browser; the readiness-gate ordering is unit-tested by spying the RTT
 * prototype. Exported for those tests.
 *
 * A bake that never becomes ready (`timeoutMs`, test hook) resolves null,
 * which disables that billboard's bucket — far trees drop out instead of
 * drawing 3,200 opaque grey quads.
 *
 * `pose` rotates the bake clone before anything is measured, for a model
 * whose rest orientation is not how it stands in the world: `deadwood.snag`
 * ships lying down, so the snag billboard bakes under `SNAG_POSE`. It has to
 * be the CLONE that is framed, never the source — framing a felled trunk and
 * then rendering an upright one would squash an 8 m snag into a 1 m quad —
 * and the source mesh must come back untouched, since the caller is about to
 * fill it with thin instances.
 */
export async function defaultBakeImpostor(
  mesh: Mesh,
  scene: Scene,
  timeoutMs = 5000,
  pose?: Quaternion,
): Promise<Texture | null> {
  // Clones share geometry and materials with the source; identical vertex
  // layout means an effect compiled for a clone is the effect the source
  // would use, so nothing is compiled twice.
  const clone = mesh.clone(`${mesh.name}_bake`, null, false);
  const bakeMeshes = [clone, ...clone.getChildMeshes(false)].filter(
    (n): n is Mesh => n instanceof Mesh,
  );
  // A mesh clone SHARES its source's material — fine for the geometry (see
  // above), but this call runs before `adoptSpecies` attaches anything to
  // that source material, and `adoptSpecies` is about to give it the Foliage
  // plugin. If the bake render landed after that attach with the material
  // still shared, the bake would render mid-sway (the render only happens
  // once `isReadyForRendering()` gates it through, frames after this call
  // returns) and freeze that pose into the billboard forever, tip clipping
  // the ortho frustum framed from the undisplaced bounds below. So each bake
  // mesh gets its OWN material clone right here, while the source is still
  // whatever `adoptSpecies` has attached SO FAR (never Foliage, since this
  // call happens first) — a material clone can only reconstruct a plugin
  // Babylon's own class registry knows, throwing on anything else already
  // attached (the same reason `adoptSpecies` splits LOD2's material before
  // any of its own plugins attach), so cloning here, ahead of the unsafe
  // ones, is what keeps it from ever throwing.
  for (const m of bakeMeshes) {
    if (m.material) m.material = m.material.clone(`${m.material.name}_bake`) ?? m.material;
    m.layerMask = IMPOSTOR_BAKE_LAYER;
    m.isPickable = false;
  }

  try {
    if (pose !== undefined) clone.rotationQuaternion = pose.clone();
    // The world matrices the bounds below read: `getHierarchyBoundingVectors`
    // refreshes descendants itself, but the root's own is this call's job.
    clone.computeWorldMatrix(true);
    const bounds = clone.getHierarchyBoundingVectors(true);
    const width = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    const height = bounds.max.y - bounds.min.y;
    if (!(width > 0) || !(height > 0)) return null;
    const centre = bounds.min.add(bounds.max).scale(0.5);

    const rtt = new RenderTargetTexture(
      "forest_impostor_bake",
      { width: IMPOSTOR_BAKE_SIZE, height: IMPOSTOR_BAKE_SIZE },
      scene,
      { generateMipMaps: true },
    );
    rtt.hasAlpha = true;
    rtt.renderList = bakeMeshes;
    rtt.onClearObservable.add((engine) => engine.clear(new Color4(0, 0, 0, 0), true, true, true));

    // Side-on orthographic framing: the quad's UV square maps exactly to the
    // tree's height by its widest horizontal extent.
    const depth = Math.max(width, 1);
    const camera = new TargetCamera(
      "forest_impostor_bake_cam",
      new Vector3(centre.x, centre.y, centre.z - depth * 2),
      scene,
    );
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -width / 2;
    camera.orthoRight = width / 2;
    camera.orthoBottom = -height / 2;
    camera.orthoTop = height / 2;
    camera.minZ = 0.01;
    camera.maxZ = depth * 4;
    camera.setTarget(centre);
    rtt.activeCamera = camera;

    // Readiness under the BAKE pass and camera (see the function comment):
    // each poll triggers the missing compiles and texture loads, so this
    // normally settles in a few frames' worth of 16 ms hops.
    const deadline = performance.now() + timeoutMs;
    while (!rtt.isReadyForRendering()) {
      if (performance.now() >= deadline) {
        camera.dispose();
        rtt.dispose();
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }

    rtt.render();
    camera.dispose();
    return rtt;
  } finally {
    // true: dispose the per-mesh material clones (and the textures `clone()`
    // made for them) along with the mesh hierarchy — they are owned
    // exclusively by this bake, never shared with the live buckets.
    clone.dispose(false, true);
  }
}

/**
 * The forest's Babylon shell. Production (no `assets` option) loads the
 * seven shipped GLBs asynchronously and builds buckets when they arrive; tests
 * inject stub meshes and get buckets synchronously. Either way the returned
 * object is complete immediately — `update` before the assets exist just
 * remembers the camera.
 */
export function createForestMeshes(
  scene: Scene,
  seed: number,
  options: ForestMeshesOptions = {},
): ForestMeshes {
  const nearRadius = options.nearRadius ?? NEAR_RADIUS;
  // The near/impostor seam, tier-scaled — every LOD ring's own out-band gets
  // clipped to it below. At the default
  // NEAR_RADIUS every fixed seam (SEAM_LOD0, SEAM_LOD1) already ends inside
  // it, so this only bites the low tier's shrunk nearRadius (70 m): ring 1's
  // fixed out-band SEAM_LOD1 = [76, 85] would otherwise stay fully visible
  // past 70 m while the impostor has already faded fully in over
  // seamNear(70) = [50, 70] — every such tree drawn twice from 70 to 85 m.
  const nearSeamBand = seamNear(nearRadius);
  /** A ring's own out-band, clipped to `nearSeamBand` when the ring's fixed
   * edge would otherwise sit past `nearRadius` (see the comment above). A
   * ring whose fixed edge is still inside `nearRadius` is untouched — this
   * is a no-op at the default tier, where every fixed seam already clears
   * it. */
  const ringOutBand = (s: readonly [number, number]): readonly [number, number] =>
    s[1] <= nearRadius ? s : nearSeamBand;
  const bakeImpostor = options.bakeImpostor ?? defaultBakeImpostor;
  // Memoizing collector, not the pure collectBands: a rebuild happens on every
  // 12 m tree-cell crossing, and re-sampling the whole ~112k-cell impostor
  // disc each time stalls the main thread 25–33 ms. The collector re-samples
  // only the leading edge (see forestField.ts).
  const collector = createBandCollector(seed);

  const casterMeshes: Mesh[] = [];
  const containers: AssetContainer[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];
  let species: SpeciesBuckets[] | null = null;
  // Regeneration saplings, per species (index-aligned with `species`): the
  // same shape the giants get, once they got their own billboard.
  // The single deadwood bucket both dead-tree roles ride inside the near
  // radius, and the SNAG half's billboard beyond it — species-agnostic, one
  // for the whole cohort. All set together with `species` in `adopt()`, so a
  // null check on `species` gates every one of them.
  let saplingSpecies: SpeciesBuckets[] | null = null;
  let deadwoodBucket: Bucket | null = null;
  let snagImpostor: Impostor | null = null;
  // Base-to-ground offset for the snag role, and the log role's local X/Y
  // bounds (its trunk-axis extent and its base-to-ground offset), measured
  // once from the loaded bucket geometry (see `adopt()`) — never hardcoded,
  // so an updated `deadwood.snag` with different bounds updates these
  // instead of silently reintroducing a half-buried snag or a floating log.
  // See `deadwoodMatrixBuffer` for the derivation of which local axis each
  // value is measured against.
  let deadwoodSnagBaseOffset = 0;
  let deadwoodLogMinX = 0;
  let deadwoodLogMaxX = 0;
  let deadwoodLogMinY = 0;
  let disposed = false;

  // Last camera seen and last origin built. Split so an `update` that arrives
  // while the GLBs are still loading is honoured the moment they land.
  let camX = NaN;
  let camZ = NaN;
  let builtX = NaN;
  let builtZ = NaN;

  /**
   * A bake landing on a billboard. A null texture — or a bake that failed —
   * leaves `ready` false forever, so the bucket never enables: far trees drop
   * out rather than draw opaque grey quads.
   */
  function adoptBake(imp: Impostor, mat: PBRMaterial, texture: Texture | null): void {
    if (texture === null) return;
    if (disposed) {
      texture.dispose();
      return;
    }
    textures.push(texture);
    mat.albedoTexture = texture;
    mat.useAlphaFromAlbedoTexture = true;
    imp.ready = true;
    // A rebuild may already have filled the buffer while the bake compiled;
    // enable now under the same non-empty rule `applyBucketBuffer` uses.
    for (const mesh of imp.bucket.meshes) mesh.setEnabled(mesh.thinInstanceCount > 0);
  }

  /**
   * One billboard: the quad, its alpha-tested material and the bake that will
   * (or will not) land on it. `name` distinguishes the five — two giant
   * species, two sapling species, one snag cohort — and `bake` is already in
   * flight when this is called, because framing the bake needs the source
   * mesh before `prepBucketMesh` disables it.
   */
  function createImpostor(
    name: string,
    bake: Texture | null | Promise<Texture | null>,
    width: number,
    height: number,
    centreY: number,
  ): Impostor {
    const plane = MeshBuilder.CreatePlane(`forest_impostor_${name}`, { width, height }, scene);
    prepBucketMesh(plane);

    const mat = new PBRMaterial(`mat_forest_impostor_${name}`, scene);
    // Alpha-TESTED, never alpha-blended: blending would need 20k quads sorted
    // back-to-front every frame, which is not a thing we do. Testing keeps
    // them order-independent and depth-writing.
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    // Two-sided, so the yaw-toward-camera orientation never shows a culled
    // back face even when it is half a rebuild stale.
    mat.backFaceCulling = false;
    mat.metallic = 0;
    mat.roughness = 1;
    attachDistanceFade(mat);
    plane.material = mat;
    materials.push(mat);

    const impostor: Impostor = {
      // `Bucket.fade` is the fallback `applyBucketBuffer` fills every instance
      // with when no explicit band buffer is passed. `fillImpostor` always
      // passes one (the two lists end at different ranges), so this value is
      // never uploaded — it is the on-lattice bands, kept so the field means
      // the same thing on every bucket and a future constant-band caller is
      // not silently wrong.
      bucket: { meshes: [plane], fade: fadeBands(seamNear(nearRadius), SEAM_FAR) },
      centreY,
      ready: false,
    };

    // A synchronous bake (the NullEngine stubs) lands before this function
    // returns; the async production bake lands whenever its shaders finish
    // compiling, and a rejection counts as a null bake.
    if (bake instanceof Promise) {
      bake.then(
        (texture) => adoptBake(impostor, mat, texture),
        () => adoptBake(impostor, mat, null),
      );
    } else {
      adoptBake(impostor, mat, bake);
    }
    return impostor;
  }

  /** Builds one species' buckets and billboard from its bucket meshes.
   * `kind` names the impostor plane ("giant" or "sapling") and decides the
   * shadow-caster question below — the two cohorts are otherwise identical
   * from here on: the same three rings, the same seams, the same bake. */
  function adoptSpecies(
    index: number,
    lods: [Mesh[], Mesh[], Mesh[]],
    understory: Mesh[] | null,
    kind: "giant" | "sapling",
  ): SpeciesBuckets {
    // Kick the bake off BEFORE prepBucketMesh touches the buckets: the
    // default bake clones the LOD1 hierarchy synchronously, so it must see
    // the meshes as loaded — enabled and free of thin instances. Impostor
    // texture from LOD1 — detailed enough for a 256² bake, cheaper than LOD0.
    const lod1First = lods[1][0];
    const bake = lod1First === undefined ? null : bakeImpostor(lod1First, scene);

    for (const mesh of [...lods.flat(), ...(understory ?? [])]) prepBucketMesh(mesh);

    // Every shipped tree GLB reuses ONE material per primitive across its
    // whole LOD ladder (verified directly against the four tree.*.glb
    // assets), so LOD0/1/2 usually arrive pointing at the SAME material
    // object. That is harmless for ground conform and the distance dither —
    // both read per-instance/per-vertex data, not per-material state — but
    // the crown sway below attaches a plugin carrying per-material uniforms
    // (the wind fade `edges`), and LOD2 must never see it. Split LOD2 onto
    // its own material wherever it shares one with LOD0 or LOD1, before ANY
    // plugin attaches to it: `Material.clone()` calls into Babylon's own
    // class registry to reconstruct each existing plugin, which throws for a
    // plugin outside that registry (ours all are), so cloning has to happen
    // while the material is still plugin-free.
    const lod01Materials = new Set(
      [...lods[0], ...lods[1]].map((m) => m.material).filter((m): m is Material => m != null),
    );
    const lod2Clones = new Map<Material, Material>();
    for (const mesh of lods[2]) {
      const material = mesh.material;
      if (material === null || !lod01Materials.has(material)) continue;
      let clone = lod2Clones.get(material);
      if (!clone) {
        clone = material.clone(`${material.name}_lod2`) ?? material;
        // Owned exclusively by this split, never by LOD0/1 (which keep the
        // shared original) — `dispose()` must walk it too, or it leaks with
        // the species.
        if (clone !== material) materials.push(clone);
        lod2Clones.set(material, clone);
      }
      mesh.material = clone;
    }

    // Base conform and the distance dither: the LOD meshes only — understory
    // is tilted rather than conformed (its material already carries the
    // foliage plugin), and the impostor plane's own material is built in
    // `createImpostor`,
    // which attaches the dither itself.
    for (const mesh of lods.flat()) {
      if (mesh.material) {
        attachGroundConform(mesh.material);
        attachDistanceFade(mesh.material);
      }
    }

    // Wind on the crowns: LOD0 and LOD1 carry the foliage plugin at the tree
    // profile (whole-tree bend by height fraction squared, so trunks stay
    // planted). LOD2, the snag and the impostor plane stay rigid, and LOD1's
    // motion must reach zero no later than where its OWN bucket starts
    // dissolving — `ringOutBand(SEAM_LOD1)`, not the fixed `SEAM_LOD1`: on a
    // shrunk nearRadius (the low tier) that ring's out-band clips to
    // `nearSeamBand`, ending well short of the fixed edge, and the motion
    // weight has to clip with it or LOD1 would still be swaying at full
    // amplitude while its own instances are dissolving out. LOD0 sits
    // entirely inside that band either way, so sharing the one plugin
    // instance with LOD1 — the usual case, per the split above — is correct
    // for both. The shadow depth pass does not run the plugin, so casters
    // draw unswayed; the tip lean this leaves undrawn ranges roughly 2.9 %
    // of DRAWN tree height at the calmest wind to 19.8 % at speed 1 — the
    // motion weight carries the instance's own scale, so those fractions
    // hold at every size a tree is drawn at — gate 4
    // checks that crown/shadow decoupling directly, but the decision to skip
    // a ShadowDepthWrapper here stands per spec regardless.
    for (const lod of [0, 1] as const) {
      for (const mesh of lods[lod]) {
        if (mesh.material) {
          mesh.refreshBoundingInfo();
          attachFoliage(mesh.material, FOLIAGE_PROFILES.TREE, mesh.getBoundingInfo().boundingBox.maximum.y);
          if (lod === 1) setFoliageEdges(mesh.material, ringOutBand(SEAM_LOD1));
        }
      }
    }

    // Foliage sway, understory: its own profile (denser flutter, lower amp),
    // attached here rather than below since it has no LOD ladder to split
    // from the crowns' loop. The impostor quad stays rigid regardless.
    if (understory !== null) {
      for (const mesh of understory) {
        if (mesh.material) {
          // Bake ran already, so the bound box is the placed geometry;
          // models put the origin at the footprint base, so max.y IS the height.
          mesh.refreshBoundingInfo();
          attachFoliage(mesh.material, FOLIAGE_PROFILES.UNDERSTORY, mesh.getBoundingInfo().boundingBox.maximum.y);
          attachFoliageLight(mesh.material);
          attachDistanceFade(mesh.material);
        }
      }
    }

    // The quad is framed AND sized from the SAME LOD as the bake (LOD1, with
    // an LOD0 fallback for stub assets that ship no LOD1 geometry): sizing
    // from a different LOD would stretch the bake across mismatched extents.
    const bounds = unionBounds(lods[1].length > 0 ? lods[1] : lods[0]);
    const width = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 0.01);
    const height = Math.max(bounds.max.y - bounds.min.y, 0.01);

    // Only the GIANTS' LOD0 (≤42 m, LOD_RING_0) casts shadows — LOD1 was
    // dropped from the caster set in a performance check:
    // LOD1 casting measured ~2 ms of cascade re-render there, and its
    // shadows are unreadable in closed-canopy interiors anyway (dense
    // overlapping canopy already self-shadows the ground more than any one
    // tree's shadow map would add). LOD2, understory and impostors still
    // never cast. Saplings (this same function, kind "sapling") and deadwood
    // (adoptBucket, below) are deliberately excluded too, for the same
    // reason: they are small, numerous, and sit under the giants'
    // own shadows, so the shadow-map cost is not worth paying.
    if (kind === "giant") casterMeshes.push(...lods[0]);

    return {
      // Each ring fades in where the previous one fades out, and the last
      // hands over to the billboard at the near seam.
      // Each ring's OUT-band is clipped to the near seam (`ringOutBand`)
      // when its own fixed edge would otherwise sit past `nearRadius` —
      // shared by saplings below, the same code path.
      lods: [
        { meshes: lods[0], fade: fadeBands(null, ringOutBand(SEAM_LOD0)) },
        { meshes: lods[1], fade: fadeBands(SEAM_LOD0, ringOutBand(SEAM_LOD1)) },
        { meshes: lods[2], fade: fadeBands(SEAM_LOD1, nearSeamBand) },
      ],
      understory:
        understory === null
          ? null
          : {
              meshes: understory,
              // Nothing takes over from ground cover at its disc edge, so it
              // thins out over the last fifth of the radius.
              fade: fadeBands(null, [UNDERSTORY_RADIUS * 0.8, UNDERSTORY_RADIUS]),
            },
      impostor: createImpostor(
        `${kind}_${index}`,
        bake,
        width,
        height,
        (bounds.min.y + bounds.max.y) / 2,
      ),
    };
  }

  /** The one single-role bucket left: deadwood, both dead-tree roles in one
   * instance list, with no LOD ladder of its own. Not added to
   * `casterMeshes` — see the comment at that push in `adoptSpecies` for why
   * saplings and deadwood are excluded from shadow casting. */
  function adoptBucket(meshes: Mesh[], fade: FadeBands): Bucket {
    for (const mesh of meshes) {
      prepBucketMesh(mesh);
      // The dither, but no ground conform: deadwood is seated and tilted on
      // the CPU (`deadwoodMatrixBuffer`), never conformed in the vertex stage.
      // Forced: deadwood is opaque (needAlphaTesting() false), but its LOD2
      // trunk -> billboard hand-off at 120 m is 40-50 px on this one
      // material's ~24 instances — an exception judged worth the cost in
      // practice, not a measured disc-edge one (distanceFadePlugin.ts header).
      if (mesh.material) attachDistanceFade(mesh.material, { force: true });
    }
    return { meshes, fade };
  }

  function adopt(loaded: {
    giants: { lods: [Mesh[], Mesh[], Mesh[]]; understory: Mesh[] | null }[];
    saplings: [Mesh[], Mesh[], Mesh[]][];
    deadwood: Mesh[];
  }): void {
    species = loaded.giants.map((s, i) => adoptSpecies(i, s.lods, s.understory, "giant"));
    // Saplings are a species like the giants now, understory aside: their own
    // GLBs, their own LOD ladder, their own billboard and bake.
    saplingSpecies = loaded.saplings.map((lods, i) => adoptSpecies(i, lods, null, "sapling"));

    // The snag's bake, kicked BEFORE `adoptBucket` disables the deadwood
    // meshes — the same rule `adoptSpecies` records for the tree bakes — and
    // posed upright, because the asset is modelled lying down (`SNAG_POSE`).
    // `timeoutMs` stays defaulted; it is the third parameter, the pose the
    // fourth.
    const snagSource = loaded.deadwood[0];
    const snagBake =
      snagSource === undefined ? null : bakeImpostor(snagSource, scene, undefined, SNAG_POSE);

    // Both dead-tree roles end at the near seam: the SNAG half cross-fades
    // into its billboard there, and a ~1 m log is sub-pixel beyond it and
    // simply thins out.
    deadwoodBucket = adoptBucket(loaded.deadwood, fadeBands(null, seamNear(nearRadius)));
    // Measured AFTER adoptBucket's prepBucketMesh (disabling doesn't affect
    // bounding info — `adoptSpecies` already relies on the same ordering for
    // its impostor-quad sizing) and BEFORE any thin instances exist, so this
    // is purely the one base mesh's own local bounds.
    const deadwoodBounds = unionBounds(loaded.deadwood);
    // SNAG stands the trunk up by rolling local X onto world Y (see
    // `deadwoodMatrixBuffer`), so its base is the local X minimum. Negated
    // so adding `offset * scale` to groundH raises the origin until that
    // minimum sits at ground level.
    deadwoodSnagBaseOffset = -deadwoodBounds.min.x;
    // LOG keeps local X as its trunk axis: its ends are the local X
    // min/max, and its base (the underside of the trunk) is the local Y
    // minimum — used un-negated, since `deadwoodMatrixBuffer` seats end A
    // directly rather than offsetting from an already-vertical axis.
    deadwoodLogMinX = deadwoodBounds.min.x;
    deadwoodLogMaxX = deadwoodBounds.max.x;
    deadwoodLogMinY = deadwoodBounds.min.y;

    // The snag billboard's quad, in the ROLLED frame: local X becomes world Y
    // (see `deadwoodMatrixBuffer`), so the trunk's length is the quad's
    // height and its cross-section the quad's width. Its centre sits half a
    // trunk above the foot — `deadwoodSnagBaseOffset` re-bases the local X
    // midpoint onto the ground the way `adoptSpecies` relies on the tree
    // models' origin already sitting at their footprint base.
    const snagCross = Math.max(
      deadwoodBounds.max.y - deadwoodBounds.min.y,
      deadwoodBounds.max.z - deadwoodBounds.min.z,
      0.01,
    );
    snagImpostor = createImpostor(
      "snag",
      snagBake,
      snagCross,
      Math.max(deadwoodBounds.max.x - deadwoodBounds.min.x, 0.01),
      deadwoodSnagBaseOffset + (deadwoodBounds.min.x + deadwoodBounds.max.x) / 2,
    );

    // An update that arrived while loading is honoured now.
    maybeBuild();
  }

  /** Rebuild only when the cell-snapped origin moves — `collectBands` is a
   * pure function of it, so the same origin would rebuild identical buffers. */
  function maybeBuild(): void {
    if (species === null || Number.isNaN(camX)) return;
    const origin = bandsOrigin(camX, camZ);
    if (origin.x === builtX && origin.z === builtZ) return;
    builtX = origin.x;
    builtZ = origin.z;
    rebuild(camX, camZ);
  }

  /** Loads one container, adds it to the scene, and disables everything it
   * brought that isn't in one of `pickBucketed`'s mesh groups (empty
   * wrappers, LOD levels the caller didn't pick). One group per bucket the
   * caller intends to build — sapling GLBs yield three (one per LOD ring),
   * deadwood yields one. Returns null if disposed mid-await — the caller
   * must bail out without adopting anything. */
  async function loadBucketed(
    url: string,
    pickBucketed: (container: AssetContainer) => Mesh[][],
  ): Promise<Mesh[][] | null> {
    const container = await loadAssetContainerAsync(url, scene);
    containers.push(container);
    // Disposed while awaiting: dispose() has already run over an earlier
    // (possibly empty) container list, so clean up what just landed here.
    if (disposed) {
      container.dispose();
      return null;
    }
    container.addAllToScene();
    const groups = pickBucketed(container);
    const bucketed = new Set<Mesh>(groups.flat());
    for (const mesh of container.meshes) {
      if (mesh instanceof Mesh && !bucketed.has(mesh)) mesh.setEnabled(false);
    }
    return groups;
  }

  /** Production path: the seven GLBs (2 giants, 2 understory, 2 saplings, 1
   * deadwood), `enemyModel.ts`'s loading idiom. */
  async function loadAssets(): Promise<void> {
    registerBuiltInLoaders();
    try {
      const giants: { lods: [Mesh[], Mesh[], Mesh[]]; understory: Mesh[] | null }[] = [];
      for (let s = 0; s < SPECIES_COUNT; s++) {
        const tree = await loadAssetContainerAsync(TREE_URLS[s] as string, scene);
        const under = await loadAssetContainerAsync(UNDERSTORY_URLS[s] as string, scene);
        containers.push(tree, under);
        if (disposed) {
          tree.dispose();
          under.dispose();
          return;
        }
        tree.addAllToScene();
        under.addAllToScene();
        const entry = {
          lods: [lodMeshes(tree, "LOD0"), lodMeshes(tree, "LOD1"), lodMeshes(tree, "LOD2")] as [
            Mesh[],
            Mesh[],
            Mesh[],
          ],
          // Understory renders only inside 50 m, so its LOD0 is the only
          // level worth a bucket; the container's LOD1/2 stay disabled below.
          understory: lodMeshes(under, "LOD0"),
        };
        giants.push(entry);
        // Everything the containers brought that is not a bucket (understory
        // LOD1/2, empty wrappers) must never draw.
        const bucketed = new Set<Mesh>([...entry.lods.flat(), ...entry.understory]);
        for (const mesh of [...tree.meshes, ...under.meshes]) {
          if (mesh instanceof Mesh && !bucketed.has(mesh)) mesh.setEnabled(false);
        }
      }

      const saplings: [Mesh[], Mesh[], Mesh[]][] = [];
      for (let s = 0; s < SPECIES_COUNT; s++) {
        // The full LOD ladder, same rings as the giants — and, since the
        // no-visible-spawn design, the same billboard beyond them.
        const lods = await loadBucketed(SAPLING_URLS[s] as string, (c) => [
          lodMeshes(c, "LOD0"),
          lodMeshes(c, "LOD1"),
          lodMeshes(c, "LOD2"),
        ]);
        if (lods === null) return;
        saplings.push(lods as [Mesh[], Mesh[], Mesh[]]);
      }

      // Deadwood instances the asset's LOD2 mesh, not LOD0: at LOD0 the
      // ~70-100 near-band deadwood instances would cost 294-420k triangles,
      // roughly half the whole vegetation budget on set dressing (see the
      // file-head comment).
      const deadwoodGroups = await loadBucketed(DEADWOOD_URL, (c) => [lodMeshes(c, "LOD2")]);
      if (deadwoodGroups === null) return;
      const deadwood = deadwoodGroups[0] as Mesh[];

      adopt({ giants, saplings, deadwood });
    } catch {
      // A missing or broken asset costs the trees, never the match — the same
      // degrade-don't-block rule as `EnemyModelPool.load`.
    }
  }

  /**
   * Bucket meshes for one named LOD of a loaded container. Located by NAME
   * anywhere in the node graph — never by scene-root position, because the
   * shipped files nest the LOD roots under wrapper nodes and the loader adds
   * its own `__root__`.
   *
   * Each mesh gets its world transform (which carries the glTF right-handed →
   * Babylon left-handed conversion on the loader's `__root__`) baked into its
   * vertices and is then detached with an identity transform: thin instances
   * compose as `world * instanceMatrix`, i.e. the bucket mesh's own world
   * matrix is applied AFTER the per-tree matrix, so any leftover mesh
   * transform would mirror the whole placed field rather than each tree.
   * `bakeTransformIntoVertices` flips triangle winding when the determinant
   * is negative, so the handedness mirror keeps faces outward.
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
    }
    // Detach from the container hierarchy (whose nodes still carry the
    // transforms just baked away), then gather the bucket under its first
    // mesh: a multi-primitive glTF mesh loads as sibling meshes (bark +
    // canopy) beneath a TransformNode, and the impostor bake's
    // `getChildMeshes` walk needs one mesh from which the whole LOD is
    // reachable. Every local transform is identity now, so the reparenting
    // changes no geometry, and thin instances are per-mesh, never inherited.
    const first = meshes[0];
    for (const mesh of meshes) mesh.parent = null;
    if (first !== undefined) {
      for (const mesh of meshes) {
        if (mesh !== first) mesh.parent = first;
      }
    }
    return meshes;
  }

  /**
   * One billboard's two lists onto its single plane: the on-lattice
   * (stride-thinned) entries first, then the off-lattice fill inside
   * IMPOSTOR_FULL_RADIUS (`partitionImpostors` hands both over already split
   * by bucket). They differ only in where they fade OUT — the fill hands over
   * to the sparser lattice at SEAM_FILL, the lattice thins to nothing at the
   * edge of the drawn world — so the bands are written per instance rather
   * than per bucket. Both fade IN at the near seam, where the full-geometry
   * rings hand over. The band buffer is filled in the SAME order
   * `impostorMatrixBuffer` writes its matrices; nothing else keeps the two
   * per-instance buffers aligned.
   */
  function fillImpostor(
    imp: Impostor,
    lattice: readonly TreeInstance[],
    fill: readonly TreeInstance[],
    x: number,
    z: number,
  ): void {
    const near = seamNear(nearRadius);
    // Hoisted: a rebuild writes thousands of instances per bucket, and
    // `fadeBands` allocates a quad each call.
    const latticeBands = fadeBands(near, SEAM_FAR);
    const fillBands = fadeBands(near, SEAM_FILL);
    const fade = new Float32Array(4 * (lattice.length + fill.length));
    for (let i = 0; i < lattice.length; i++) writeFadeBands(fade, i * 4, latticeBands);
    for (let i = 0; i < fill.length; i++) {
      writeFadeBands(fade, (lattice.length + i) * 4, fillBands);
    }
    applyBucketBuffer(
      imp.bucket,
      impostorMatrixBuffer(lattice, fill, imp.centreY, x, z),
      undefined,
      fade,
    );
    // Until (unless) a bake texture lands, the bucket must not draw: an
    // untextured alpha-test material renders every quad as opaque grey.
    if (!imp.ready) {
      for (const mesh of imp.bucket.meshes) mesh.setEnabled(false);
    }
  }

  function rebuild(x: number, z: number): void {
    const bands = collector.collect(x, z, nearRadius);
    const giants = species as SpeciesBuckets[];
    const saps = saplingSpecies as SpeciesBuckets[];
    // ONE pass over each impostor list, not one per plane: the five buckets
    // that draw them are disjoint, so they can be split in a single walk.
    const lattice = partitionImpostors(bands.impostors, giants.length, saps.length);
    const fill = partitionImpostors(bands.impostorsFill, giants.length, saps.length);

    // Giants and saplings run the identical shape, off different near lists
    // (`near` is GIANT-only, `saplings` SAPLING-only) and different slots of
    // the split impostor lists.
    const cohorts: [SpeciesBuckets[], TreeInstance[][], number][] = [
      [giants, bands.near, 0],
      [saps, bands.saplings, giants.length],
    ];
    for (const [all, nearLists, slotBase] of cohorts) {
      for (let s = 0; s < all.length; s++) {
        const sp = all[s] as SpeciesBuckets;
        for (let lod = 0; lod < 3; lod++) {
          // Filter, never mutate: TreeInstance objects are SHARED between
          // `understory` and `near[0]`, and between the seam-padded rings —
          // buffers are derived from them here and the objects themselves
          // stay read-only.
          const list = (nearLists[lod] as TreeInstance[]).filter((t) => t.species === s);
          applyBucketBuffer(sp.lods[lod] as Bucket, treeMatrixBuffer(list, false), groundGradBuffer(list));
        }
        if (sp.understory !== null) {
          const list = bands.understory.filter((t) => t.species === s);
          // The understory profile tints its root toward the ground, so its
          // material declares the `foliage` attribute and the bucket has to
          // fill it — see `applyBucketBuffer`.
          applyBucketBuffer(
            sp.understory,
            treeMatrixBuffer(list, true),
            undefined,
            undefined,
            treeFoliageBuffer(seed, list),
          );
        }
        const slot = slotBase + s;
        fillImpostor(sp.impostor, lattice[slot] as TreeInstance[], fill[slot] as TreeInstance[], x, z);
      }
    }

    // The snag billboard is species-agnostic — one asset, one bake, both
    // species' snags — exactly like the deadwood bucket it continues, so it
    // takes the single slot `partitionImpostors` puts last.
    const snagSlot = giants.length + saps.length;
    fillImpostor(
      snagImpostor as Impostor,
      lattice[snagSlot] as TreeInstance[],
      fill[snagSlot] as TreeInstance[],
      x,
      z,
    );

    // One bucket, both dead-tree roles — see `deadwoodMatrixBuffer`.
    applyBucketBuffer(
      deadwoodBucket as Bucket,
      deadwoodMatrixBuffer(
        seed,
        bands.deadwood,
        deadwoodSnagBaseOffset,
        deadwoodLogMinX,
        deadwoodLogMaxX,
        deadwoodLogMinY,
      ),
    );
  }

  if (options.assets != null) {
    const stub = options.assets;
    adopt({
      giants: stub.giants.map((a) => ({
        lods: [geometryMeshes(a.lods[0]), geometryMeshes(a.lods[1]), geometryMeshes(a.lods[2])] as [
          Mesh[],
          Mesh[],
          Mesh[],
        ],
        understory: a.understory === undefined ? null : geometryMeshes(a.understory),
      })),
      saplings: stub.saplings.map(
        (a) =>
          [geometryMeshes(a.lods[0]), geometryMeshes(a.lods[1]), geometryMeshes(a.lods[2])] as [
            Mesh[],
            Mesh[],
            Mesh[],
          ],
      ),
      deadwood: geometryMeshes(stub.deadwood),
    });
  } else {
    // Fire and forget, like `views.models.load`: the forest pops in when the
    // assets land, and stays absent forever if they fail.
    void loadAssets();
  }

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
      for (const sp of [...(species ?? []), ...(saplingSpecies ?? [])]) {
        for (const bucket of [...sp.lods, sp.understory, sp.impostor.bucket]) {
          if (bucket === null) continue;
          for (const mesh of bucket.meshes) mesh.dispose();
        }
      }
      for (const bucket of [deadwoodBucket, snagImpostor?.bucket ?? null]) {
        if (bucket === null) continue;
        for (const mesh of bucket.meshes) mesh.dispose();
      }
      for (const mat of materials) mat.dispose();
      for (const tex of textures) tex.dispose();
      // Containers own whatever the buckets did not adopt (materials,
      // source textures, wrapper nodes); mesh.dispose is idempotent, so the
      // overlap with the loop above is harmless.
      for (const container of containers) container.dispose();
      casterMeshes.length = 0;
      species = null;
      saplingSpecies = null;
      deadwoodBucket = null;
      snagImpostor = null;
    },
  };
}
