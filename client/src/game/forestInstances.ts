/**
 * The forest's instance lists as typed arrays: what each bucket of
 * `lite/forestMeshes.ts` is drawn with, made from the bands `forestField.ts`
 * collects. A matrix an instance (sixteen floats, `instancePose.ts`), and
 * beside it the per-instance attributes the materials read: the fade's bands
 * (`distanceFade.ts`), the ground's gradient for the base conform
 * (`groundConform.ts`), the ground's colour and the sky's openness for a
 * tinting foliage profile, and a dead tree's role. With them, what the
 * shell measures once from the models that land: the fade bands of every
 * bucket for a near radius, the dead trees' seat, a billboard's quad.
 *
 * Loads no engine: the shell that draws the forest hands these arrays to its
 * meshes, and nothing here knows what a mesh is.
 */
import { elevationAt } from "../sim/terrain.js";
import { COHORT_GIANT, COHORT_LOG, COHORT_SAPLING, COHORT_SNAG, forestDensity, type TreeInstance } from "../sim/vegetation.js";
import { fadeBands, writeFadeBands, type FadeBands } from "./distanceFade.js";
import { SEAM_FAR, SEAM_FILL, SEAM_LOD0, SEAM_LOD1, UNDERSTORY_RADIUS, farTreeScale, seamNear } from "./forestField.js";
import { macroNoise, macroTint } from "./groundHexParams.js";
import { groundNormalTilt, groundNormalY, seatOnGround } from "./groundTilt.js";
import { composeInto, quatAboutAxis, quatFromEuler, quatMultiply, transformPoint, type Quat, type Vec3 } from "./instancePose.js";
import { LOG_STATIONS, logStationOffsets, seatLog, trunkSeat, trunkTop, type TrunkSeat } from "./logSeat.js";
import { NURSE_FERN, nursePlants } from "./nurseLog.js";
import type { Slices } from "./syncJobs.js";
import { surfaceAlbedo } from "./terrainSurface.js";

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const scratchQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchTiltQ: Quat = { x: 0, y: 0, z: 0, w: 1 };

/**
 * The fade bands of every bucket of a forest whose near band ends at
 * `nearRadius` (the quality tier's knob).
 *
 * Each ring fades in where the one inside it fades out, and the last hands
 * over to the billboards at the near seam. A ring's own out-band is clipped
 * to that seam when the ring's fixed edge reaches `nearRadius` or would sit
 * past it: at the default radius every fixed seam ends inside it, so the clip
 * bites only a shrunk radius (the low tier's 70 m), where ring 1's fixed
 * out-band would otherwise leave its trees whole over the billboards fading
 * in, every such tree drawn twice.
 */
export type ForestFadeBands = {
  /** The near seam: where full geometry hands over to the billboards. */
  nearSeam: readonly [number, number];
  /** The three LOD rings' bands, index the LOD. */
  lods: [FadeBands, FadeBands, FadeBands];
  /** Ring 1's own out-band: where a crown's motion must have reached zero. */
  lod1Out: readonly [number, number];
  /** The understory: nothing takes over at its disc edge, so it thins over the last fifth of its radius. */
  understory: FadeBands;
  /** Both dead-tree roles: the snags cross-fade into their billboard at the near seam, and a log thins out there. */
  deadwood: FadeBands;
  /** A billboard's on-lattice list: in at the near seam, out at the edge of the drawn world. */
  impostorLattice: FadeBands;
  /** A billboard's off-lattice fill: in at the near seam, out where the sparser lattice takes over. */
  impostorFill: FadeBands;
};

export function forestFadeBands(nearRadius: number): ForestFadeBands {
  const nearSeam = seamNear(nearRadius);
  const ringOutBand = (s: readonly [number, number]): readonly [number, number] => (s[1] < nearRadius ? s : nearSeam);
  const lod1Out = ringOutBand(SEAM_LOD1);
  return {
    nearSeam,
    lods: [fadeBands(null, ringOutBand(SEAM_LOD0)), fadeBands(SEAM_LOD0, lod1Out), fadeBands(SEAM_LOD1, nearSeam)],
    lod1Out,
    understory: fadeBands(null, [UNDERSTORY_RADIUS * 0.8, UNDERSTORY_RADIUS]),
    deadwood: fadeBands(null, nearSeam),
    impostorLattice: fadeBands(nearSeam, SEAM_FAR),
    impostorFill: fadeBands(nearSeam, SEAM_FILL),
  };
}

/** `count` copies of one band quad — every bucket but the impostor planes,
 * whose two lists carry different bands (see `fillImpostor`). */
export function fadeBandsBuffer(count: number, bands: FadeBands): Float32Array {
  const buf = new Float32Array(4 * count);
  for (let i = 0; i < count; i++) writeFadeBands(buf, i * 4, bands);
  return buf;
}

/** World matrices for full-geometry trees and understory: scale and rotation
 * derived renderer-side — sim/ emits `hash`, never angles, so the trig lives
 * HERE (game/ is allowed trig; sim/ is not).
 *
 * `tilt` is the understory's flag and only the understory's. A shrub rests on
 * the ground and leans with it; a conifer grows plumb whatever the hillside
 * does, and its base is closed by the vertex-stage conform instead. */
export function treeMatrixBuffer(list: readonly TreeInstance[], tilt: boolean): Float32Array {
  const buf = new Float32Array(16 * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    const yaw = t.hash * Math.PI * 2;
    if (tilt) {
      seatOnGround(yaw, t.groundDx, t.groundDz, scratchQ);
    } else {
      quatAboutAxis(UP, yaw, scratchQ);
    }
    composeInto(buf, i * 16, t.scale, t.scale, t.scale, scratchQ, t.x, t.groundH, t.z);
  }
  return buf;
}

/** Per-instance ground gradient for the conform plugin's `groundGrad`
 * attribute: 8 bytes an instance against the matrix's 64. Built in the same
 * pass as the matrices, from the sample sim/ already took. */
export function groundGradBuffer(list: readonly TreeInstance[]): Float32Array {
  const buf = new Float32Array(2 * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    buf[i * 2] = t.groundDx;
    buf[i * 2 + 1] = t.groundDz;
  }
  return buf;
}

/** Per-instance ground colour and the sky's openness (`1 − canopy`) for the
 * understory's `foliage`
 * attribute — the four floats `writeFoliage` in `clutterInstances.ts` writes for
 * ground cover, from the same palette, so a fern's base and the ground it
 * stands in can never disagree. Only the tinting profiles need it, which among
 * the forest buckets is the understory alone: the tree profile has no ground
 * tint and so never declares the attribute. Allocated with the matrix buffer,
 * on the same wholesale-replace discipline. */
export function treeFoliageBuffer(seed: number, list: readonly TreeInstance[]): Float32Array {
  const buf = new Float32Array(4 * list.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    const canopy = forestDensity(seed, t.x, t.z);
    const slope = Math.hypot(t.groundDx, t.groundDz);
    const c = surfaceAlbedo(seed, t.x, t.z, t.groundH, slope, canopy);
    // The floor applies the same tint in lite/terrainPlugins.ts, so a tuft and the
    // ground under it agree where the ground is grass and inside the relief
    // fade; on non-grass ground the card carries this tint alone, and past
    // the fade the floor's tint has faded out while the card keeps its own.
    const ny = 1 / Math.sqrt(1 + t.groundDx * t.groundDx + t.groundDz * t.groundDz);
    const tint = macroTint(macroNoise(t.x, t.z), 1 - ny);
    buf[i * 4] = c.r * tint.r;
    buf[i * 4 + 1] = c.g * tint.g;
    buf[i * 4 + 2] = c.b * tint.b;
    buf[i * 4 + 3] = 1 - canopy;
  }
  return buf;
}

/** The log role's stations along its trunk and the ground under each, reused across instances. */
const logOffsets: number[] = [];
const logHeights: number[] = [];

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
 *  - LOG: the log's base is the UNDERSIDE OF ITS TRUNK, a line fitted through
 *    the loaded geometry (`trunkSeat`, logSeat.ts), not the bucket's local Y
 *    minimum: that minimum is the root flare, 0.3 to 0.6 m under the trunk
 *    over the rest of its length, and a log seated by it rests on the flare
 *    with its trunk in the air (up to 1.5 m at full scale).
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
 * axis, which at deadwood scale runs 6 to 10 m. A real fallen log follows the
 * ground along its own length and has settled into it, so this samples the
 * terrain at `LOG_STATIONS` places under the trunk (from its hashed yaw, so
 * logs still lie in varied directions, and its native length, taken from the
 * loaded geometry's bounds) and `seatLog` fits the ground's line through
 * them, pitches the trunk's underside onto it and sinks it a fifth of its
 * diameter: rotating about local Z (this file's "roll" parameter) tilts local
 * X toward Y without touching local Z, exactly like the snag's 90° roll above
 * but partial, so it is applied through the same Euler "roll" slot, with yaw
 * composed after it (`quatFromEuler`'s order) so the tilt
 * survives being pointed in the hashed direction.
 */
export function deadwoodMatrixBuffer(
  seed: number,
  list: readonly TreeInstance[],
  snagBaseOffset: number,
  logMinX: number,
  logMaxX: number,
  logSeat: TrunkSeat,
): Float32Array {
  const buf = new Float32Array(16 * list.length);
  // The stations along the trunk's native length on local X, scale-independent
  // (each instance multiplies by its own t.scale below).
  logStationOffsets(logMinX, logMaxX, logOffsets);
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    const isSnag = t.cohort === COHORT_SNAG;
    const yaw = t.hash * Math.PI * 2;
    // A log of the second draw (`TreeInstance.variant`) is the model mirrored
    // across the trunk's own plane: the same trunk read the other way round,
    // so two logs in one view share no silhouette. The mirror turns the
    // winding, which the material's back faces drawn absorbs (`adopt`).
    const scaleZ = !isSnag && t.variant === 1 ? -t.scale : t.scale;
    let y: number;
    if (isSnag) {
      quatFromEuler(0, yaw, Math.PI / 2, scratchQ);
      // Lay the standing trunk onto the ground normal, composed AFTER the
      // upright roll (Hamilton a·b applies b first — see groundTilt.ts).
      groundNormalTilt(t.groundDx, t.groundDz, scratchTiltQ);
      quatMultiply(scratchTiltQ, scratchQ, scratchQ);
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
      y = footH + footOffset * nY;
    } else {
      // The ground under the trunk at `LOG_STATIONS` places along it, from
      // yaw and the native length alone (the pitch's own foreshortening is
      // ignored: negligible at these grades, and what keeps this one pass):
      // rotating local +X by yaw about world Y lands it on (cosYaw, -sinYaw) —
      // the same convention `impostorMatrixSlices` documents for rotating
      // local +Z by atan2(dx, dz) onto (dx, dz).
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      for (let k = 0; k < LOG_STATIONS; k++) {
        const along = (logOffsets[k] as number) * t.scale;
        logHeights[k] = elevationAt(seed, t.x + along * cosYaw, t.z - along * sinYaw);
      }
      // The pitch seats the trunk ALONG its spine. It leaves the other axis
      // untouched, which is what makes a log lying across the fall line hang
      // on one flank. Roll about the trunk's own axis closes it, from the
      // analytic gradient resolved perpendicular to the spine. Rotating local
      // +X by yaw lands it on (cosYaw, −sinYaw) in world xz, so the
      // perpendicular horizontal direction is (sinYaw, cosYaw), and a positive
      // roll about local +X carries local +Z downward — hence the negation.
      const across = t.groundDx * sinYaw + t.groundDz * cosYaw;
      const roll = -Math.atan(across);
      // The trunk's underside onto the ground's line, sunk into the floor
      // (`logSeat.ts`). The pitch is rotation about local Z, the Euler "roll"
      // slot; `quatFromEuler(roll, yaw, pitch)` composes as
      // Ry(yaw)·Rx(roll)·Rz(pitch), so the roll is about the trunk's own axis
      // only to first order, which `seatLog`'s cos(roll) allows for.
      const seated = seatLog(logSeat, logOffsets, logHeights, t.scale, roll);
      quatFromEuler(roll, yaw, seated.pitch, scratchQ);
      y = seated.y;
    }
    composeInto(buf, i * 16, t.scale, t.scale, scaleZ, scratchQ, t.x, y, t.z);
  }
  return buf;
}

/** What grows on a log is drawn to this distance and dithers out over the band (m). */
export const NURSE_BANDS: FadeBands = fadeBands(null, [60, 75]);
const scratchWorld: Vec3 = { x: 0, y: 0, z: 0 };
const scratchMatrix = new Float32Array(16);
/** A plant stands this far (m at the log's scale 1) under the trunk's top line, rooted in the moss. */
const NURSE_ROOT = 0.03;

/**
 * World matrices for what grows on the nurse logs (`nurseLog.ts`): each
 * plant's place on its log's top line, carried to the world by the log's own
 * matrix from `deadwood` (index-aligned with `list`), then stood plumb at its
 * own yaw and scale, since a fern or a seedling grows up whatever way the log
 * lies.
 */
export function nurseBuffers(
  list: readonly TreeInstance[],
  deadwood: Float32Array,
  logMinX: number,
  logMaxX: number,
  top: { a: number; b: number },
  diameter: number,
): { ferns: Float32Array; seedlings: Float32Array } {
  const ferns: number[] = [];
  const seedlings: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i] as TreeInstance;
    if (t.cohort !== COHORT_LOG) continue;
    const plants = nursePlants(t.hash, logMinX, logMaxX);
    if (plants.length === 0) continue;
    for (const plant of plants) {
      transformPoint(deadwood, i * 16, plant.along, top.a + top.b * plant.along - NURSE_ROOT, plant.side * diameter, scratchWorld);
      quatAboutAxis(UP, plant.yaw, scratchQ);
      composeInto(scratchMatrix, 0, plant.scale, plant.scale, plant.scale, scratchQ, scratchWorld.x, scratchWorld.y, scratchWorld.z);
      const out = plant.kind === NURSE_FERN ? ferns : seedlings;
      for (let k = 0; k < 16; k++) out.push(scratchMatrix[k] as number);
    }
  }
  return { ferns: new Float32Array(ferns), seedlings: new Float32Array(seedlings) };
}

/**
 * World matrices for impostor quads, each oriented toward the camera at
 * rebuild time. A thin instance is not billboarded by the engine (`billboardMode`
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
export function* impostorMatrixSlices(
  lattice: readonly TreeInstance[],
  fill: readonly TreeInstance[],
  centreY: number,
  camX: number,
  camZ: number,
): Slices<Float32Array> {
  const buf = new Float32Array(16 * (lattice.length + fill.length));
  let i = 0;
  for (const list of [lattice, fill]) {
    for (const t of list) {
      // Thousands of billboards a bucket: a slice composes a share of them.
      if (i > 0 && i % IMPOSTOR_SLICE === 0) yield;
      // Yaw that points the quad's face (−Z, the plane's; the material
      // is two-sided for the frames a rebuild is stale) at the camera:
      // rotating +Z by atan2(dx, dz) about Y lands it on (dx, dz), so −Z
      // faces the camera half a turn on. The face, not the back: the bake's
      // normal map is in the face's frame (`impostorBakePlugin`, `lite/forestPlugins.ts`).
      quatAboutAxis(UP, Math.atan2(camX - t.x, camZ - t.z) + Math.PI, scratchQ);
      // A lattice card past the fill's seam grows (`farTreeScale`): the
      // on-lattice list is the first of the two.
      const [across, up] = list === lattice ? farTreeScale(Math.hypot(t.x - camX, t.z - camZ)) : [1, 1];

      // The quad is centred on its origin while the tree origin sits at the
      // footprint base, so the quad centre rides up by the scaled tree centre.
      composeInto(buf, i * 16, t.scale * across, t.scale * up, t.scale * across, scratchQ, t.x, t.groundH + centreY * t.scale * up, t.z);
      i++;
    }
  }
  return buf;
}

/** Billboard matrices a slice composes: about a tenth of a millisecond. */
export const IMPOSTOR_SLICE = 512;

/**
 * The impostor lists in ONE pass each, split into the buckets that will draw
 * them: giant bucket sets 0..n, then sapling species 0..n, then the one snag
 * slot. `bands.impostors`/`impostorsFill` interleave every cohort, and a
 * filter per plane meant ten passes over up to ~46k instances on every
 * tree-cell crossing — the rebuild this file already guards for cost.
 * COHORT_LOG never reaches these lists (a log is near-field only) and is
 * dropped here if it ever does.
 */
export function partitionImpostors(
  list: readonly TreeInstance[],
  giantSlot: (t: TreeInstance) => number,
  giantCount: number,
  saplingCount: number,
): TreeInstance[][] {
  const slots: TreeInstance[][] = [];
  for (let i = 0; i <= giantCount + saplingCount; i++) slots.push([]);
  const snagSlot = giantCount + saplingCount;
  for (const t of list) {
    if (t.cohort === COHORT_GIANT) {
      // The giants' slots are their bucket sets (`GIANT_SETS`): a species
      // with two barks has two, by the tree's variant; −1 is a species
      // whose model has not loaded.
      const slot = giantSlot(t);
      if (slot >= 0) (slots[slot] as TreeInstance[]).push(t);
    } else if (t.cohort === COHORT_SAPLING) {
      if (t.species < saplingCount) (slots[giantCount + t.species] as TreeInstance[]).push(t);
    } else if (t.cohort === COHORT_SNAG) {
      (slots[snagSlot] as TreeInstance[]).push(t);
    }
  }
  return slots;
}

/** Each dead tree's role for its material (`lite/forestPlugins.ts`), a float an instance: 1 a fallen log, 0 a standing snag. */
export function deadwoodRoleBuffer(list: readonly TreeInstance[]): Float32Array {
  const roles = new Float32Array(list.length);
  list.forEach((t, i) => {
    roles[i] = t.cohort === COHORT_LOG ? 1 : 0;
  });
  return roles;
}

/**
 * The fade bands of one billboard's two lists, `lattice` on-lattice
 * instances first and then `fill` off-lattice ones: the order
 * `impostorMatrixSlices` writes their matrices in, and the only thing
 * keeping the two per-instance buffers aligned.
 */
export function impostorFadeBuffer(lattice: number, fill: number, bands: ForestFadeBands): Float32Array {
  const fade = new Float32Array(4 * (lattice + fill));
  for (let i = 0; i < lattice; i++) writeFadeBands(fade, i * 4, bands.impostorLattice);
  for (let i = 0; i < fill; i++) writeFadeBands(fade, (lattice + i) * 4, bands.impostorFill);
  return fade;
}

/** What the dead trees' one model measures, once, from its vertices: never
 * hardcoded, so a model with other bounds moves these with it. */
export type DeadwoodMeasure = {
  /** The box of the model's vertices. */
  min: Vec3;
  max: Vec3;
  /** The snag's base-to-ground offset: the snag stands the trunk up by
   * rolling local X onto world Y, so its base is the local X minimum,
   * negated so that adding `offset * scale` to the ground's height raises
   * the origin until that minimum sits at ground level. */
  snagBaseOffset: number;
  /** The log keeps local X as its trunk's axis: its ends. */
  logMinX: number;
  logMaxX: number;
  /** The trunk's underside line and its top line (`logSeat.ts`), not the box's: the box's local Y minimum is the root flare's. */
  logSeat: TrunkSeat;
  logTop: { a: number; b: number };
};

/** The measure of the dead trees' model from `positions`, xyz a vertex. */
export function deadwoodMeasure(positions: ArrayLike<number>): DeadwoodMeasure {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] as number;
    const y = positions[i + 1] as number;
    const z = positions[i + 2] as number;
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  return { min, max, snagBaseOffset: -min.x, logMinX: min.x, logMaxX: max.x, logSeat: trunkSeat(positions), logTop: trunkTop(positions) };
}

/** A billboard's quad: its width and height (m at scale 1) and how far its
 * centre stands over the tree's origin, which is at the footprint's base. */
export type ImpostorQuad = { width: number; height: number; centreY: number };

/**
 * A tree's billboard quad from the box of the LOD its bake renders: the
 * tree's height by its widest horizontal extent, the quad the bake's
 * side-on frame maps onto exactly.
 */
export function impostorQuad(min: Vec3, max: Vec3): ImpostorQuad {
  return {
    width: Math.max(max.x - min.x, max.z - min.z, 0.01),
    height: Math.max(max.y - min.y, 0.01),
    centreY: (min.y + max.y) / 2,
  };
}

/**
 * The snag's billboard quad, in the rolled frame: local X becomes world Y
 * (`deadwoodMatrixBuffer`), so the trunk's length is the quad's height and
 * its cross-section the quad's width. Its centre sits half a trunk above the
 * foot: the snag's base offset re-bases the local X midpoint onto the ground.
 */
export function snagImpostorQuad(measure: DeadwoodMeasure): ImpostorQuad {
  const { min, max } = measure;
  return {
    width: Math.max(max.y - min.y, max.z - min.z, 0.01),
    height: Math.max(max.x - min.x, 0.01),
    centreY: measure.snagBaseOffset + (min.x + max.x) / 2,
  };
}
