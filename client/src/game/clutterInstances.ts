/**
 * What a piece of ground clutter is drawn with, as plain numbers: which
 * model and which of its LODs a class draws, how a rock is spread across its
 * cuts, each class's foliage profile and wet cap, and an instance's matrix
 * and ground tint. `lite/clutterMeshes.ts` says what the clutter is and draws it;
 * the blades, the duff and the cliffs seat and tint their instances with the
 * same writers. Loads no engine.
 */
import {
  CLUTTER_BOULDER, CLUTTER_BUSH, CLUTTER_DRIFTLOG, CLUTTER_DRIFTWOOD, CLUTTER_FERN, CLUTTER_FLOWER, CLUTTER_FUNGUS, CLUTTER_GRASS,
  CLUTTER_HIGHPLANT, CLUTTER_LITTER, CLUTTER_MEADOW, CLUTTER_ROCK, CLUTTER_SHRUB, CLUTTER_WETPLANT, type ClutterInstance,
} from "@csarkosh/engine/sim/clutter";
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
import { activeTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { forestDensity } from "@csarkosh/engine/sim/vegetation";
import type { Rgb } from "@csarkosh/engine/game/colour";
import { FOLIAGE_PROFILES, type FoliageProfile } from "@csarkosh/engine/game/foliageUniforms";
import { macroNoise, macroTint } from "@csarkosh/engine/game/groundHexParams";
import { seatOnGround } from "@csarkosh/engine/game/groundTilt";
import { composeInto, quatAboutAxis, quatMultiply, type Quat, type Vec3 } from "@csarkosh/engine/game/instancePose";
import { trunkSeat, type TrunkSeat } from "@csarkosh/engine/game/logSeat";
import { ROCK_CUTS } from "@csarkosh/engine/game/rockRelief";
import { surfaceAlbedo } from "@csarkosh/engine/game/terrainSurface";
import { TRAMPLE_BAND, trampleAt } from "@csarkosh/engine/game/trailBenchParams";
import { WET_CAP } from "@csarkosh/engine/game/wetSurface";

/**
 * Model per class per variant, by catalog id (`client/assets/catalog.json`,
 * whose output for an id is `models/<id>.glb`), indexed by the class ids of
 * `sim/clutter.ts` (grass 0, rock 1, boulder 2, driftwood 3, fungus 4,
 * bush 5, meadow 6, flower 7, litter 8, fern 9, shrub 10, drift log 11, wet
 * plant 12, high plant 13) and then by the instance's own `variant` draw.
 * Driftwood and meadow ship ONE model each, which is why the sim gives those
 * classes `variants: 1` and their instances always draw variant 0. Litter
 * reuses the rock and driftwood models at its own (small) scale range rather
 * than shipping dedicated pebble/twig geometry. Sword fern draws the
 * forest's understory fern, placed by its own habitat. The shrub class has
 * no model: its mounds are built in code (`shrubClump.ts`), as the
 * wet-ground plants (`wetPlantClump.ts`) and the high ground's
 * (`highPlantClump.ts`) are. The ids also key the cards' albedo gain
 * (`coverAlbedoParams.ts`).
 */
export const CLUTTER_MODEL_IDS: readonly (readonly string[])[] = [
  ["clutter.grass_a", "clutter.grass_b"],
  ["clutter.rock_a", "clutter.rock_b"],
  ["clutter.boulder_a", "clutter.boulder_b"],
  ["clutter.driftwood"],
  ["clutter.fungus_a", "clutter.fungus_b"],
  ["clutter.bush_a", "clutter.bush_b"],
  ["clutter.meadow"],
  ["clutter.flower_a", "clutter.flower_b"],
  ["clutter.rock_a", "clutter.rock_b", "clutter.driftwood"],
  ["understory.fern"],
  [],
  ["deadwood.snag"],
  [],
  [],
];

/** A shrub leaf's roughness, and its reflectance at normal incidence as a
 * share of a dielectric's. Salal's leaf is leathery and a little glossy, but
 * a mound of glossy facets mirrors the sky: at the material's defaults the
 * leaves read pale blue-grey whatever their own colour (halving the albedo
 * changed nothing), so the reflection is all but taken away. */
export const SHRUB_ROUGHNESS = 0.85;
export const SHRUB_F0 = 0.12;

/** LOD node names inside each shipped GLB, in bucket order: index 0 is the
 * `near` band's bucket, index 1 the `far` band's. Every file also ships an
 * "LOD2"; see `lite/clutterMeshes.ts`'s head for why most classes leave it unused. */
export const LOD_NAMES = ["LOD0", "LOD1"] as const;
/** The sword fern draws the model's LOD1 near and its LOD2 far, not LOD0 and
 * LOD1. The ferns were the most of the understory's triangles: at LOD0's 784
 * the 660 near clumps of a forest view were 520,000, and at LOD1's 351 the
 * 1,840 far ones 650,000. A clump is a metre across and seen from standing
 * height, where LOD1's 351 triangles and LOD0's are not told apart; past the
 * seam it is a few pixels under the canopy. */
const FERN_LOD_NAMES = ["LOD1", "LOD2"] as const;
/** A drift log draws the trunk's LOD1 near and its LOD2 far: the forest's own
 * logs draw LOD1 (`lite/forestMeshes.ts`), and LOD0's 4,196 triangles buy nothing
 * on a beach seen from the road. */
const DRIFTLOG_LOD_NAMES = ["LOD1", "LOD2"] as const;
/** The bushes draw the model's LOD1 near and its LOD2 far, as the ferns do
 * (2026-10-18). Their 110 m disc put about 2,000 of them past the seam at a
 * forest view, each LOD1's 510 triangles, and some 550 inside it at LOD0's
 * 1,150: 1.7 million triangles a frame, the most of any one thing in the
 * scene, for a shrub a metre across that past the seam is a few pixels under
 * the canopy, and inside it one the player walks among, where LOD1's cut of
 * the same cards reads as LOD0's. LOD2 is 200 triangles. */
const BUSH_LOD_NAMES = ["LOD1", "LOD2"] as const;

/** The two LOD roots of its models a class's buckets draw, the `near` band's then the `far` band's. */
export function clutterLodNames(cls: number): readonly [string, string] {
  return cls === CLUTTER_FERN ? FERN_LOD_NAMES : cls === CLUTTER_DRIFTLOG ? DRIFTLOG_LOD_NAMES : cls === CLUTTER_BUSH ? BUSH_LOD_NAMES : LOD_NAMES;
}

/** A drift log lies along the shore, within this (rad) either way of it: the
 * sea leaves a trunk where the last wave turned it, mostly side-on. */
export const DRIFTLOG_SWING = 0.9;
/** It is sunk this share of its diameter into the sand. */
export const DRIFTLOG_SINK = 0.25;
/** Its albedo over the bark's: bleached by salt and sun. Over 1, since the
 * bark's own texture is a dark brown and the factor multiplies it. */
export const DRIFTLOG_BLEACH: readonly [number, number, number] = [2.3, 2.2, 2.1];
/** The trunk's underside in the model (`logSeat.ts`), measured from the
 * loaded geometry when the class's meshes are adopted; the model's own
 * figures until then, and under the tests' stubs. */
let driftLogSeat: TrunkSeat = { a: 0.13, b: 0.09, diameter: 0.45 };

/** Measures the drift log's seat from its model's `positions` (xyz a vertex): kept for every drift log's matrix
 * from here on. Positions that measure no trunk leave the seat as it was. */
export function seatDriftLogs(positions: ArrayLike<number>): void {
  if (positions.length === 0) return;
  const seat = trunkSeat(positions);
  if (seat.diameter > 0) driftLogSeat = seat;
}

export const NEAR_LOD = 0;
export const FAR_LOD = 1;

/**
 * The LOD root a class's `near` band draws: LOD0, except the meadow's on the
 * tiers that draw the blade field over it. There the blades carry the fine
 * detail inside `BLADE_REACH` and the cards only the cover, and every card in
 * the band is drawn, dithered in and out or not, so its cost is per instance
 * in the vertex stage; the model's LOD1 is a coarser cut of the same card
 * on half of LOD0's vertices.
 */
export function clutterNearLodName(cls: number, nearBlades: boolean): (typeof LOD_NAMES)[number] {
  return nearBlades && cls === CLUTTER_MEADOW ? LOD_NAMES[FAR_LOD] : LOD_NAMES[NEAR_LOD];
}

/** Rock and boulder are the only classes cut into fractured, angular stone at
 * load (rockRelief.ts): a rounded model gets ROCK_CUTS distinct fractures so
 * a whole field of rocks doesn't repeat one silhouette. Every other class's
 * models ship pre-modelled and pass through untouched. */
export const CUT_CLASSES: ReadonlySet<number> = new Set([CLUTTER_ROCK, CLUTTER_BOULDER]);

/** Cuts per model for `cls`: ROCK_CUTS for the cut classes, one — meaning
 * "no cutting" — for every other class, so a bucket is found uniformly as
 * `variant * cutsFor(cls) + cutOf(inst)`. */
export function cutsFor(cls: number): number {
  return CUT_CLASSES.has(cls) ? ROCK_CUTS : 1;
}

/**
 * Which cut an instance draws, taken from its own hash rather than a fresh
 * random draw, so neighbouring rocks spread across the cuts without the sim
 * needing to know cutting exists. `inst.hash` is a float in [0, 1) (see
 * `clutterInCell` in sim/clutter.ts), so it has to be scaled up into the cut
 * range before any bit-masking makes sense: masking the float directly
 * (`inst.hash & (cuts - 1)`) would coerce every hash to 0 first and put
 * every instance in cut 0. `cuts` is a power of two, so the mask after
 * scaling is just a cheap belt-and-braces clamp on the floor's rounding.
 */
export function cutOf(inst: ClutterInstance): number {
  const cuts = cutsFor(inst.cls);
  return Math.floor(inst.hash * cuts) & (cuts - 1);
}

/** The model index a cut class's planes are drawn for (`rockPlanes`,
 * `rockRelief`): `cls * 16 + variant`, not the bare per-class variant. Rock's
 * and boulder's own first variant are both "variant 0", and a plane list
 * keyed on the variant alone would hand both the exact same cut-plane
 * directions. 16 is comfortably above the two variants either class ships. */
export function cutModel(cls: number, variant: number): number {
  return cls * 16 + variant;
}

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
 * tint, mapped to the profile that governs their amplitude and root
 * darkening. Rock, boulder, driftwood, and fungus stay static. */
export const FOLIAGE_BY_CLASS: ReadonlyMap<number, FoliageProfile> = new Map<number, FoliageProfile>([
  [CLUTTER_GRASS, FOLIAGE_PROFILES.GRASS],
  [CLUTTER_MEADOW, FOLIAGE_PROFILES.MEADOW],
  [CLUTTER_FLOWER, FOLIAGE_PROFILES.FLOWER],
  [CLUTTER_BUSH, FOLIAGE_PROFILES.BUSH],
  [CLUTTER_FERN, FOLIAGE_PROFILES.UNDERSTORY],
  [CLUTTER_SHRUB, FOLIAGE_PROFILES.UNDERSTORY],
  [CLUTTER_WETPLANT, FOLIAGE_PROFILES.UNDERSTORY],
  [CLUTTER_HIGHPLANT, FOLIAGE_PROFILES.UNDERSTORY],
]);

/** The weather's porosity cap per class (`wetSurface.ts`): the cards glaze,
 * stone darkens by half, driftwood and fungus soak. Litter is pebbles and
 * twigs under a metre across, taken as stone. Every class has an entry. */
export const WET_CAP_BY_CLASS: ReadonlyMap<number, number> = new Map<number, number>([
  [CLUTTER_GRASS, WET_CAP.leaf],
  [CLUTTER_ROCK, WET_CAP.rock],
  [CLUTTER_BOULDER, WET_CAP.rock],
  [CLUTTER_DRIFTWOOD, WET_CAP.deadwood],
  [CLUTTER_FUNGUS, WET_CAP.fungus],
  [CLUTTER_BUSH, WET_CAP.leaf],
  [CLUTTER_MEADOW, WET_CAP.leaf],
  [CLUTTER_FLOWER, WET_CAP.leaf],
  [CLUTTER_LITTER, WET_CAP.rock],
  [CLUTTER_FERN, WET_CAP.leaf],
  [CLUTTER_SHRUB, WET_CAP.leaf],
  [CLUTTER_DRIFTLOG, WET_CAP.deadwood],
  [CLUTTER_WETPLANT, WET_CAP.leaf],
  [CLUTTER_HIGHPLANT, WET_CAP.leaf],
]);

/** Classes that LIE on the ground rather than stand on it, so they take the
 * ground normal. Grass, meadow, flower, bush and fungus are excluded: measured,
 * their worst footprint gap is 0.28 m, and they sway, which a tilt fights.
 * Litter reuses the rock and driftwood meshes, so it tilts the same way. */
const TILTED = new Set<number>([CLUTTER_ROCK, CLUTTER_BOULDER, CLUTTER_DRIFTWOOD, CLUTTER_LITTER]);

/** Per-variant base scale of the litter class: rock_a/rock_b at the sim's
 * 0.25–0.6 are pebbles already; driftwood needs another 0.3 to be a twig. */
export const LITTER_VARIANT_SCALE: readonly number[] = [1, 1, 0.3];

/**
 * The classes whose buckets are filtered to the view. The grass class's
 * cards are 172–410 vertices each over a 110 m disc, and five in six of them
 * stand outside a walking gaze. The meadow's 20-vertex cards are not here:
 * filtering them measured no saving.
 */
export const CLUTTER_CULLED: ReadonlySet<number> = new Set([CLUTTER_GRASS]);

/** The classes the bench tramples: the swaying ground layer. */
const TRAMPLED = new Set<number>([CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FLOWER]);

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const Z_AXIS: Vec3 = { x: 0, y: 0, z: 1 };
const scratchQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchLeanAxis: Vec3 = { x: 0, y: 0, z: 0 };
const scratchLean: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchLevel: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** A card beside the bench: its height's scale, its lean (rad) away along the unit (ax, az), and the stain on its tint. */
export type TrampleFrame = Readonly<{ height: number; lean: number; ax: number; az: number; tint: Rgb }>;

/** The untrampled identity frame: frozen, and shared by every card the bench
 * does not touch rather than allocated per instance. */
const IDENTITY_TRAMPLE_FRAME: TrampleFrame = Object.freeze({ height: 1, lean: 0, ax: 0, az: 0, tint: Object.freeze({ r: 1, g: 1, b: 1 }) });
/** `trampleFrame`'s own scratch result: written in place and returned, so a
 * rebuild's per-instance call costs no allocation. Callers use the fields
 * before the next call, the same contract `instanceMatrixFor`'s scratch
 * quaternions already carry. */
const scratchTrampleFrame: { height: number; lean: number; ax: number; az: number; tint: Rgb } = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };

/**
 * The trampled band beside the bench for one card: height scale, lean (rad)
 * about the horizontal axis perpendicular to the away direction (ax, az) —
 * the unit gradient of the trail distance, by central difference — and the
 * stain tint. The identity frame past TRAMPLE_BAND[1], with no trail, and
 * for every class the bench does not trample.
 */
export function trampleFrame(seed: number, inst: ClutterInstance): TrampleFrame {
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
 * The instance's world matrix, written into `out` (16 floats, offset 0).
 * Rotation is derived HERE, from the plain `hash` draw the sim emits: sim/
 * is forbidden trig, game/ is not — the same division of labour
 * `forestInstances.ts`'s `treeMatrixBuffer` documents.
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
export function instanceMatrixFor(inst: ClutterInstance, frame: TrampleFrame, out: Float32Array): void {
  if (inst.cls === CLUTTER_DRIFTLOG) {
    driftLogMatrix(inst, out);
    return;
  }
  const yaw = inst.hash * Math.PI * 2;
  if (TILTED.has(inst.cls)) {
    seatOnGround(yaw, inst.groundDx, inst.groundDz, scratchQ);
  } else {
    quatAboutAxis(UP, yaw, scratchQ);
  }
  if (frame.lean > 0) {
    // The axis perpendicular to the away direction, chosen (by the right-hand
    // rule) so the card's top moves ALONG (ax, az) rather than into the bed;
    // composed after the yaw (and after the ground tilt for tilted classes —
    // cards are not tilted, so for them it is yaw then lean).
    scratchLeanAxis.x = frame.az;
    scratchLeanAxis.y = 0;
    scratchLeanAxis.z = -frame.ax;
    quatAboutAxis(scratchLeanAxis, frame.lean, scratchLean);
    quatMultiply(scratchLean, scratchQ, scratchQ);
  }
  const litterScale = inst.cls === CLUTTER_LITTER ? inst.scale * (LITTER_VARIANT_SCALE[inst.variant] ?? 1) : inst.scale;
  const boulderBaseH = inst.variant === 1 ? BOULDER_B_BASE_H : BOULDER_A_BASE_H;
  const sink = inst.cls === CLUTTER_BOULDER ? BOULDER_SINK * boulderBaseH * inst.scale : CLUTTER_SINK;
  composeInto(out, 0, litterScale, litterScale * frame.height, litterScale, scratchQ, inst.x, inst.groundH - sink, inst.z);
}

/**
 * A drift log's matrix: laid along the shore (across the beach's fall line,
 * swung up to `DRIFTLOG_SWING` either way and end for end by its hash; any
 * way round on level sand), on the beach's own plane, its trunk's underside
 * and not its bounding box on the sand (`logSeat.ts`), sunk `DRIFTLOG_SINK`
 * of its diameter. A beach is near enough a plane over a log's length that
 * the one sample under its middle seats it.
 */
function driftLogMatrix(inst: ClutterInstance, out: Float32Array): void {
  const steep = Math.hypot(inst.groundDx, inst.groundDz);
  // The model's +X lands on (cos yaw, −sin yaw); across the gradient (dx, dz) is (−dz, dx).
  const along = steep > 1e-3 ? Math.atan2(-inst.groundDx, -inst.groundDz) : inst.hash * Math.PI * 2;
  const flip = Math.floor(inst.hash * 1024) % 2 === 0 ? 0 : Math.PI;
  const yaw = along + flip + (inst.hash - 0.5) * 2 * DRIFTLOG_SWING;
  seatOnGround(yaw, inst.groundDx, inst.groundDz, scratchQ);
  // The trunk's underside climbs at `b` in the model: levelled first, in the model's own frame.
  quatAboutAxis(Z_AXIS, -Math.atan(driftLogSeat.b), scratchLevel);
  quatMultiply(scratchQ, scratchLevel, scratchQ);
  composeInto(
    out, 0, inst.scale, inst.scale, inst.scale, scratchQ,
    inst.x, inst.groundH - (driftLogSeat.a + DRIFTLOG_SINK * driftLogSeat.diameter) * inst.scale, inst.z,
  );
}

/** Ground colour at the instance (the palette the clipmap bakes into vertex
 * colour, so grass and ground can never disagree) and the openness of the sky
 * above it, `1 − canopy` (1 in the open, the generic value of a draw that
 * writes none), from which the foliage's shaders take the canopy's
 * share of the sky and of the sun (`FOLIAGE_CANOPY_SKY`, `FOLIAGE_CANOPY_SUN`),
 * in place of the shade the bush palette used to carry by hand.
 * slope = |∇h|; canopy = forestDensity. */
export function writeFoliage(seed: number, inst: ClutterInstance, buf: Float32Array, offset: number, frame: TrampleFrame): void {
  const slope = Math.hypot(inst.groundDx, inst.groundDz);
  const canopy = forestDensity(seed, inst.x, inst.z);
  const c = surfaceAlbedo(seed, inst.x, inst.z, inst.groundH, slope, canopy);
  // The floor applies the same tint in lite/terrainPlugins.ts, so a tuft and the
  // ground under it agree where the ground is grass and inside the relief
  // fade; on non-grass ground the card carries this tint alone, and past the
  // fade the floor's tint has faded out while the card keeps its own.
  const ny = 1 / Math.sqrt(1 + inst.groundDx * inst.groundDx + inst.groundDz * inst.groundDz);
  const tint = macroTint(macroNoise(inst.x, inst.z), 1 - ny);
  buf[offset] = c.r * tint.r * frame.tint.r;
  buf[offset + 1] = c.g * tint.g * frame.tint.g;
  buf[offset + 2] = c.b * tint.b * frame.tint.b;
  buf[offset + 3] = 1 - canopy;
}
