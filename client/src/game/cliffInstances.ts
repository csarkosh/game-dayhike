/**
 * The cliff modules' instance lists: what each bucket of the rock walls is
 * drawn with, made from the modules `cliffField.ts` collects round the eye.
 * One list a model and a LOD ring, each a matrix and the ground's colour
 * under the module an instance (`instanceLists.ts`), the far ring's with
 * the bands it dithers out across at the reach. `cliffMeshes.ts` says what
 * the buckets are and draws them.
 *
 * Where a module stands is the simulation's (`sim/cliffField.ts`), and in
 * the level id; this module only seats and tints what the field placed.
 * Loads no engine.
 */
import { CLIFF_MODEL_HEIGHT, CLIFF_MODELS, CLIFF_SINK, CLIFF_TILT_MAX, cliffFacing } from "../sim/cliffField.js";
import type { ClutterInstance } from "../sim/clutter.js";
import { CLIFF_FADE_BAND, CLIFF_RINGS, cliffBands, cliffOrigin, createCliffCollector } from "./cliffField.js";
import { trampleFrame, writeFoliage } from "./clutterInstances.js";
import { fadeBands, type FadeBands } from "./distanceFade.js";
import { seatOnGroundCapped } from "./groundTilt.js";
import { composeInto, type Quat } from "./instancePose.js";
import { createInstanceList, ensureCapacity, type InstanceList } from "./instanceLists.js";
import type { QualityTier } from "./quality.js";

/** The LOD roots inside each model's file, by bucket. */
export const CLIFF_LOD_NODES: readonly [string, string, string] = ["LOD0", "LOD1", "LOD2"];
/** The bucket that dithers out at the reach, and the first bucket past the
 * ones that cast. */
export const CLIFF_FAR_LOD = 2;

/** Share of the ground albedo in a module's colour: half the module's own,
 * half the ground's under it, so a brown granite module and a pale cobble
 * hillside read as one material. Mirrored in shaders/cliffTint.fragment.fx;
 * the lockstep test asserts it. */
export const CLIFF_GROUND_TINT = 0.5;

const scratchQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchMat = new Float32Array(16);

/**
 * A module's rotation, written into `out`: its facing turned back into a yaw,
 * then the CAPPED lean.
 *
 * The field carries the facing as a unit vector pair drawn without trig
 * (`cliffFacing`, from the ground's gradient and the yaw jitter in `hash`),
 * because a placement must agree to the bit on every peer; a renderer wants
 * an angle, and may take one — forward is `(sin yaw, cos yaw)`, so the yaw
 * is `atan2(fx, fz)`. The lean is `seatOnGroundCapped`'s quaternion, which
 * is the rotation the field writes out as `leanPoint`; the two agree to
 * 1e-9 (`test/game/cliffField.test.ts`), so the solid the probes cleared is
 * the solid that is drawn.
 */
export function cliffSeat(inst: ClutterInstance, out: Quat): void {
  const f = cliffFacing(inst.groundDx, inst.groundDz, inst.hash);
  seatOnGroundCapped(Math.atan2(f.fx, f.fz), inst.groundDx, inst.groundDz, CLIFF_TILT_MAX, out);
}

/**
 * A module's world matrix, written into `out` (16 floats): uniform scale, the
 * seat above (`cliffSeat`), and the origin the field chose.
 *
 * Not the clutter's `instanceMatrixFor`, which seats its tilted classes on the
 * full ground normal: a wall laid back with a 45° face throws its top metres
 * out over the ground at its foot, which is ground the field's probes have not
 * cleared (`sim/cliffField.ts`'s `CLIFF_TILT_MAX`). The sink is vertical and
 * already inside `groundH`, so there is no `CLUTTER_SINK` here either — that
 * two-centimetre nudge breaks coplanarity for cards lying on the surface, and
 * a module buried a third of its height needs no such help.
 */
export function cliffInstanceMatrix(inst: ClutterInstance, out: Float32Array): void {
  cliffSeat(inst, scratchQ);
  composeInto(out, 0, inst.scale, inst.scale, inst.scale, scratchQ, inst.x, inst.groundH, inst.z);
}

export type CliffLists = {
  /** `lists[model][lod]`, a model a file of `CLIFF_MODELS`. */
  readonly lists: readonly (readonly InstanceList[])[];
  /** The far ring's bands: whole to the last `CLIFF_FADE_BAND` metres of the reach, gone at it. */
  readonly farBands: FadeBands;
  /**
   * Fills the lists for an eye at (x, z): the modules in reach split by ring
   * from the eye's snapped origin, each written to the list of its model and
   * ring, two passes a ring so no array grows mid-fill. A list `held` does
   * not answer for (the shell has no mesh for it: a model that did not land,
   * a file with no such root) is left as it was, and its modules are neither
   * seated nor tinted.
   */
  rebuild(x: number, z: number, held: (model: number, lod: number) => boolean): void;
};

/** The lists of the cliff field at `quality`'s rings, the field laid at `density` (the shipped one when absent). */
export function createCliffLists(seed: number, quality: QualityTier, density?: number): CliffLists {
  const rings = CLIFF_RINGS[quality];
  const reach = rings[2];
  const farBands: FadeBands = fadeBands(null, [reach - CLIFF_FADE_BAND, reach]);
  // Memoising, not the pure `collectCliffs`: a rebuild happens on every
  // `CLIFF_CELL` crossing, and a qualifying cell costs dozens of terrain
  // samples (its gate, four neighbours, and the probes of every module along
  // its run).
  const collector = createCliffCollector(seed, density);
  /**
   * The ground tint per instance, kept for as long as the collector keeps the
   * instance. The tint costs a terrain sample, a surface classification and a
   * canopy read, and the collector hands back the SAME instance object for
   * every cell it still holds — so without this the whole field in reach was
   * re-sampled on each 12 m crossing, on the same frame as the clutter's own
   * rebuild. A `WeakMap` because the collector's eviction is the lifetime
   * that matters: an instance it drops takes its tint with it.
   */
  const tints = new WeakMap<ClutterInstance, Float32Array>();
  function tintFor(m: ClutterInstance): Float32Array {
    let tint = tints.get(m);
    if (tint === undefined) {
      tint = new Float32Array(4);
      // The ground's OWN height, not the sunk one `groundH` carries: the tint
      // is the colour of the surface the module stands on, and read a third
      // of a module's height lower a sea cliff would be tinted from a band it
      // never touches. Rock is outside the trampled set, so the frame is the
      // identity — asked for rather than assumed, as every other writer does.
      const onGround: ClutterInstance = {
        ...m,
        groundH: m.groundH + CLIFF_SINK * m.scale * (CLIFF_MODEL_HEIGHT[m.variant] as number),
      };
      writeFoliage(seed, onGround, tint, 0, trampleFrame(seed, onGround));
      tints.set(m, tint);
    }
    return tint;
  }
  const lists: InstanceList[][] = CLIFF_MODELS.map(() =>
    CLIFF_LOD_NODES.map((_, lod) => createInstanceList({ bands: lod === CLIFF_FAR_LOD, foliage: true, strength: false }, false)),
  );

  return {
    lists,
    farBands,
    rebuild(x, z, held) {
      const { x: ox, z: oz } = cliffOrigin(x, z);
      const all = collector.collect(x, z, reach);
      const bands = cliffBands(all, ox, oz, rings);
      const listOf = (m: ClutterInstance, lod: number): InstanceList | null => (held(m.variant, lod) ? ((lists[m.variant] as InstanceList[] | undefined)?.[lod] ?? null) : null);
      for (const [lod, band] of bands.entries()) {
        // Two passes: every list knows its size before a matrix is written,
        // so no buffer grows mid-fill.
        for (const [model, row] of lists.entries()) if (held(model, lod)) (row[lod] as InstanceList).count = 0;
        for (const m of band) {
          const list = listOf(m, lod);
          if (list !== null) list.count++;
        }
        for (const [model, row] of lists.entries()) {
          if (!held(model, lod)) continue;
          const list = row[lod] as InstanceList;
          ensureCapacity(list);
          list.count = 0;
        }
        for (const m of band) {
          const list = listOf(m, lod);
          if (list === null) continue;
          cliffInstanceMatrix(m, scratchMat);
          list.buf.set(scratchMat, list.count * 16);
          list.foliage.set(tintFor(m), list.count * 4);
          if (lod === CLIFF_FAR_LOD) list.bands.set(farBands, list.count * 4);
          list.count++;
        }
      }
    },
  };
}
