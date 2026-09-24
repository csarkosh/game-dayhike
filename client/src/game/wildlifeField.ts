/**
 * Where ambient wildlife is: a pure function of
 * (world seed, species, cell), read through the sim's exported fields and
 * never added to them. Renderer-only by design — no constant here may migrate
 * into sim/ or a tunables registry: wildlife is cosmetic, peers need not agree
 * on it byte-for-byte, and it must not move the level id.
 *
 * Every unit carries its refuge (bush, trunk, snag, forest-edge direction) so
 * a reaction in wildlifeBehaviour.ts is a lookup, never a search.
 *
 * `walkable()` (beach + slope) gates every ground species, not just elk: a
 * rabbit on a cliff face or a squirrel's tree standing on the beach are wrong
 * for the same reason an elk herd there is.
 */
import { hash3 } from "../sim/field.js";
import { activeTerrainVariant, elevationSampleAt, type TerrainSample } from "../sim/terrain.js";
import { COHORT_GIANT, COHORT_SNAG, forestDensity, TREE_CELL, treeInCell } from "../sim/vegetation.js";
import {
  CLUTTER_BUSH, CLUTTER_FLOWER, CLUTTER_GRASS, CLUTTER_GRASS_CANOPY_LO, CLUTTER_MEADOW, clutterDensity, clutterInRect,
} from "../sim/clutter.js";
import { MAX_WALKABLE_GRADIENT } from "../sim/ground.js";
import { SAND_TOP } from "./terrainSurface.js";

export const SPECIES_ELK = 0;
export const SPECIES_DEER = 1;
export const SPECIES_RABBIT = 2;
export const SPECIES_SQUIRREL = 3;
export const SPECIES_RAVEN_ROOST = 4;
export const SPECIES_RAVEN_PAIR = 5;
export const SPECIES_GULL = 6;
export const SPECIES_EAGLE = 7;
/**
 * A butterfly, numbered among the birds because it rides their thin-instance card path
 * (the wing beat, the buffers) rather than a pooled creature — but it flies no loop of its
 * own, so `wildlifeMeshes.ts`'s `isLoopFlier` names it out of the four true fliers above it,
 * and it is placed in the open near flower cover rather than scanned for a snag or a coast.
 *
 * Numbering a non-flier above `FIRST_BIRD_SPECIES` has a cost worth naming before a second
 * one is added: every `>= FIRST_BIRD_SPECIES` test in the tree now needs a hand-written
 * `!== SPECIES_BUTTERFLY` beside it, and there are six of them (`isLoopFlier` and
 * `birdPresenceFor` here, `poseBirds`, `cueSpeedFor` and `callGain` in wildlifeBehaviour.ts,
 * `placeable` in wildlifeDirector.ts). A second boundary constant — the last LOOP flier, so
 * the true fliers are a closed range and the card species sit above it — would turn all six
 * back into range tests that a new species joins for free. Worth doing when there is a
 * second card species and not before: one exception written out six times is still readable,
 * and the refactor is only correct once there is something to draw the boundary between.
 */
export const SPECIES_BUTTERFLY = 8;
export const SPECIES_COUNT = 9;
/** Ground species are < this; the rest fly and are culled rather than faded. */
export const FIRST_BIRD_SPECIES = SPECIES_RAVEN_ROOST;

/**
 * Cell sides (m). A roost cell scans its 4×4 tree cells for a snag. The butterfly's is
 * smaller than any ground species' — flower drift patches run 8-20 m
 * (`CLUTTER_FLOWER_PATCH_WAVELENGTH`), so a coarser cell would average a patch and its gaps
 * into one presence draw instead of letting the two read differently.
 */
export const WILDLIFE_CELL: readonly number[] = [96, 64, 32, 24, 4 * TREE_CELL, 160, 120, 512, 16];
/**
 * Visible disc per species (m); low tier scales by 0.6. Index 8 is the butterfly's, and it
 * is the smallest by a distance: the card is eight centimetres across, so it is a few
 * pixels well before anything else is, and 40 m is comfortably more than three times the
 * twelve it can be made out at while staying under the squirrel's fifty.
 */
export const WILDLIFE_RADIUS: readonly number[] = [150, 150, 60, 50, 400, 400, 400, 400, 40];
/**
 * Seeded presence draw per gated cell — starting points.
 *
 * The butterfly's coin flip sits on top of a habitat gate that has already rejected most of
 * the world (`clutterDensity(seed, CLUTTER_FLOWER, …)` plus the open-ground test), and the
 * two together make it the SPARSEST species in the world by a wide margin. Measured over 289
 * camera positions on a 120 m grid, three seeds: a butterfly is somewhere in the disc at only
 * 9–14 % of them, at 0.19–0.30 per disc, against the rabbit's 0.71–1.21 and the squirrel's
 * 1.67–2.74 — and per square metre the gap is wider still, since its disc is 40 m against
 * their 60 and 50.
 *
 * So the design's "the most frequent small cue there is" is delivered by the DIRECTOR, not by
 * the world: the butterfly takes a fifth of the small group's cue weight, and the field
 * underneath it is nearly empty. That is the whole of the reasoning — this number is not
 * trying to make butterflies common, and nothing downstream reads it as if they were. The
 * one thing that does depend on the sparsity is `DIRECTOR_POOL`'s entry: see there.
 */
export const WILDLIFE_D: readonly number[] = [0.35, 0.5, 0.6, 0.5, 0.25, 0.4, 0.7, 0.6, 0.5];
/**
 * How many pool slots the shell reserves per species for the wildlife director's placed
 * animals — the resource the director's `place` events draw from, since the director itself
 * only decides WHAT to place, never how many units of it may exist at once. Indexed like
 * every other per-species table here, though only elk, deer, rabbit, squirrel and the
 * butterfly (`placeable` in wildlifeDirector.ts) ever draw from theirs — a loop flier is only
 * ever driven, never placed, so its slots stand unused until a future change lets one be.
 *
 * The butterfly's 3 is the largest entry in the table, and deliberately so — it does NOT
 * match its placeable mates (elk and deer take 1, rabbit and squirrel 2). Two measurements
 * put it there.
 *
 * Its cues are almost all PLACES. Over the director's own thousand-second sweep the
 * butterfly runs 18–43 placements against 0–2 drives, while the rabbit runs the other way
 * round, 4–20 placements against 9–31 drives. That follows straight from `WILDLIFE_D`'s
 * census: the natural butterfly population is the sparsest in the world, so there is almost
 * never one already out there to be driven into frame, and the pool carries the whole
 * species rather than topping it up.
 *
 * And the director asks for three at once. Peak concurrent placed butterflies over that
 * sweep reaches 3 on half of the graded seed-runs (7 of 14) and 4–5 under an ungraded
 * fast-turning head — so a pool of 2 would have had `poolSlotFor` decline placements on
 * half of them. (Those peaks are demand, not what the shell granted: the sweep's own
 * harness models no pool at all.) Elk and deer show as much demand and still take 1,
 * because that is a different trade: an elk is a pooled GLB with a shadow, and several
 * standing about at once reads as a herd rather than as a sighting. Three butterflies is
 * three 8 cm cards in a bucket that already exists.
 *
 * The entry also has to stay non-zero for as long as the species can be cued at all: while
 * `wildlifeMeshes.ts` shipped it no asset this held at 0, so `poolSlotFor` never handed out
 * a slot for an animal nothing could render. `wildlifeMeshes.test.ts`'s asset/pool
 * consistency check holds the two facts (asset shipped, pool slot given) to changing
 * together in either direction.
 */
export const DIRECTOR_POOL: readonly number[] = [1, 1, 2, 2, 2, 2, 2, 2, 3];
/**
 * `[lo, hi]` members per unit, by species — read only for the species that actually vary
 * (`membersFor`'s explicit callers: the four ground species and the roost/gull/eagle among
 * the birds). The raven pair's own entry is never read (its two members are fixed in code),
 * and the butterfly needs none at all: it is always a single insect, set directly where its
 * unit is built rather than through this table, so this stays the eight entries those seven
 * callers actually reach.
 */
export const WILDLIFE_MEMBERS: readonly (readonly [number, number])[] = [[4, 8], [1, 2], [2, 4], [1, 1], [3, 7], [2, 2], [3, 6], [1, 2]];
/** Member spread around the anchor (m) for ground species. Zero for everything that flies —
 * a flier's members are spread around its loop rather than around a point on the ground —
 * and zero for the butterfly too, at index 8, though for a different reason: it has no loop
 * of its own and no herd either, just the one insect its `members: 1` already says. Read per
 * unit when a unit's state is built, so this is the second of the two tables a unit of
 * species 8 reaches (`NOTICE` and `WILDLIFE_RADIUS`, read by the renderer's cull and the
 * director rather than per unit, are the other two nine-entry tables). */
export const WILDLIFE_SPREAD: readonly number[] = [12, 6, 5, 0, 0, 0, 0, 0, 0];

export const ELK_MEADOW_FLOOR = 0.6;
export const ELK_ROAD_CLEAR = 25;
export const DEER_DENSITY_LO = 0.15;
export const DEER_DENSITY_HI = 0.5;
export const RABBIT_GRASS_FLOOR = 0.4;
export const RABBIT_COVER_RADIUS = 15;
export const SQUIRREL_DENSITY_FLOOR = 0.5;
export const RAVEN_PAIR_DENSITY_FLOOR = 0.6;
export const GULL_BAND = 60;
/** Forest-edge refuge search: 12 samples on a 60 m ring; the flee runs 100 m that way. */
export const REFUGE_RING = 60;
export const REFUGE_SAMPLES = 12;
export const REFUGE_DISTANCE = 100;
export const EAGLE_SAMPLES = 16;
export const RAVEN_PERCH_HEIGHT = 7;
/**
 * How far above the CANOPY a lifted roost circles (m), and the floor that applies where
 * there is no canopy to clear. The altitude is not a fixed range: testing in the browser found the
 * original 20–40 m starting point buried inside the foliage, and the first fix's flat
 * [55, 75] was measured to be inside it too at ~99% of roosts — a giant pine reaches
 * 17.18 m × GIANT_SCALE_MAX × VALLEY_SCALE_BOOST ≈ 88 m, and the tallest giant within a
 * roost's own loop stands at a median of ~77 m above the snag's ground. Any flat number is
 * a guess that goes stale the next time the vegetation is retuned, so the loop is drawn
 * RELATIVE to the stand it has to clear (see `canopyTopNear`). The perch stays at
 * RAVEN_PERCH_HEIGHT: birds sitting under the canopy is what a roost looks like, and they
 * are visible from the trunk.
 */
export const RAVEN_ROOST_CLEARANCE: readonly [number, number] = [10, 20];
/** Loop altitude where the stand is short or absent (m) — a roost in a clearing still has
 * to circle high enough to be read as a flock rather than as birds in a bush. */
export const RAVEN_ROOST_ALT_FLOOR = 40;
/**
 * Shipped model height (m) at scale 1, by `treeInCell`'s species index — 0 fir, 1 pine,
 * the order `forestMeshes.ts` maps to tree.giant_fir / tree.giant_pine. The numbers are the
 * ACTUAL bounding boxes recorded in `client/assets/catalog.json`, not any
 * generic reference figures; `vegetation.ts` sizes a giant as this × its drawn scale, and
 * that scale already carries VALLEY_SCALE_BOOST.
 *
 * Only the GIANT cohort is measured. Saplings re-cast the 10.6 m conifer models at 0.8–1.3
 * before the boost and deadwood the ~4 m snag model at 1.5–2, so the tallest either can
 * reach is under 20 m — below RAVEN_ROOST_ALT_FLOOR, where they could not change the
 * answer even if they were counted.
 */
export const GIANT_MODEL_HEIGHT: readonly number[] = [14.70, 17.18];
/**
 * Trunk radius (m) of a giant AT SCALE 1 — multiply by a tree's drawn `scale` for the
 * radius in world metres. The squirrel's cling offset is built from this (observed in the
 * browser: a constant 0.35 m offset put the squirrel inside the wood at 4/4 orbit
 * stations, because a giant drawn at 2.8–4.1 × VALLEY_SCALE_BOOST has a trunk 0.29–0.72 m
 * across the axis at the height the squirrel climbs to).
 *
 * MEASURED, not guessed, from the shipped `client/assets/models/tree.giant_{pine,fir}.glb`:
 * the LOD0 bark primitive's positions, sliced every 0.5 m, with the trunk axis tracked
 * upward from the unbranched 1–2 m band so that branch vertices are excluded, and the
 * mean ring radius taken per slice. Over the 5–10 m band the largest slice reads
 * pine 0.139 (fir 0.121); over the 1.2–3.6 m band, which is where the squirrel actually
 * clings (SQUIRREL_CLIMB is 6–10 world metres on a tree scaled 2.8–5.125), pine 0.127
 * (fir 0.118). 0.14 is the larger of the two models rounded up, so it clears both bands
 * and both species — the trunk is very nearly a cylinder over this whole range, which is
 * why one scalar rather than a per-species table is honest here.
 */
export const GIANT_TRUNK_RADIUS_PER_SCALE = 0.14;
export const RAVEN_PAIR_ALT: readonly [number, number] = [40, 80];
export const RAVEN_PAIR_RADIUS: readonly [number, number] = [30, 60];
export const GULL_ALT: readonly [number, number] = [15, 40];
export const GULL_RADIUS: readonly [number, number] = [20, 50];
export const EAGLE_ALT: readonly [number, number] = [120, 250];
export const EAGLE_RADIUS: readonly [number, number] = [80, 140];

const SALT = 0x5a1f;

export type WildlifeUnit = {
  species: number;
  /** Unique across every species and cell — see `unitId`. Not seeded. */
  id: number;
  cellX: number;
  cellZ: number;
  x: number;
  z: number;
  h: number;
  members: number;
  refugeX: number;
  refugeZ: number;
  homeX: number;
  homeZ: number;
  homeH: number;
  /**
   * The drawn `scale` of the tree the home anchor sits on, where the home IS a tree — the
   * squirrel's giant. 1 for every other species, none of which reads it. Renderer-side
   * only: it is carried so the squirrel's cling offset can be built from the trunk's real
   * radius (GIANT_TRUNK_RADIUS_PER_SCALE) instead of a constant, and it never crosses the
   * wire or enters the sim.
   */
  homeScale: number;
  altitude: number;
  radius: number;
  hash: number;
  presenceDraw: number;
};

/**
 * The width `i * width + species` used to pack the eight species that existed before the
 * butterfly — frozen here rather than read live off `SPECIES_COUNT`, which is exactly the
 * bug this constant exists to stop happening again. `SPECIES_COUNT` moving from 8 to 9
 * changed `i * SPECIES_COUNT + species` for every (species, i) pair with i ≥ 1, across every
 * species already shipped: elk, deer, rabbit, squirrel, both ravens, gulls and eagles all
 * silently drew a DIFFERENT cell for the same seed the moment the butterfly raised the
 * count — caught only because three tests happened to pin exact numbers to a specific unit
 * for this seed (`wildlifeBehaviour.test.ts`'s elk alert range, two hand-picked cameras in
 * `wildlifeMeshes.test.ts`) and started finding a different one. A species this cosmetic is
 * allowed to look different after a balance change; it must not look different after one
 * that has nothing to do with it.
 */
const LEGACY_SPECIES_SALT_WIDTH = 8;
/**
 * The i-th independent draw for a cell of one species, in [0, 1). Index 4 is
 * retired (it was the old drawn `unitId`) and deliberately left unused: the
 * indices are independent streams, so a gap keeps every other draw
 * bit-identical to what it was before the id became positional.
 *
 * Species below `LEGACY_SPECIES_SALT_WIDTH` (elk through eagle) keep the exact salt they
 * always had. A species at or past it (the butterfly, and whatever comes after) gets a
 * private band far above anything `i * LEGACY_SPECIES_SALT_WIDTH + species` reaches — the
 * highest `i` any legacy species draws is the eagle's high-sample loop, comfortably under a
 * hundred — so a new species can never collide with a legacy one's stream, and two new
 * species can never collide with EACH OTHER's either.
 */
function draw(seed: number, species: number, cellX: number, cellZ: number, i: number): number {
  const salt = species < LEGACY_SPECIES_SALT_WIDTH
    ? i * LEGACY_SPECIES_SALT_WIDTH + species
    : 1_000_000 + (species - LEGACY_SPECIES_SALT_WIDTH) * 10_000 + i;
  return hash3(cellX, cellZ, salt, seed ^ SALT);
}
function range(t: number, lo: number, hi: number): number {
  return lo + t * (hi - lo);
}
function membersFor(seed: number, species: number, cx: number, cz: number): number {
  const [lo, hi] = WILDLIFE_MEMBERS[species]!;
  return lo + Math.floor(draw(seed, species, cx, cz, 3) * (hi - lo + 1));
}
/**
 * A unit's identity, PACKED rather than drawn: 14 bits of `cellX + CELL_ID_BIAS`,
 * 13 bits of `cellZ + CELL_ID_BIAS_Z`, 4 bits of species — 31 bits, so it is always
 * a positive int32.
 *
 * It used to be a `hash3` draw, which collides: `hash3` is structurally weak on
 * small integer lattice inputs, and the collisions are sign-crossing PAIRS, not
 * the neighbour relation this comment once claimed. Measured on the squirrel
 * draw at seed 388817: 4,660 of the 10,000 cells in a 100 x 100 block around the
 * origin repeat an earlier cell's draw — e.g. (-4, 44) with (0, -48) — and every
 * one of those pairs shares `(x | 0) ^ (z | 0)`. Two of the five squirrel units
 * inside the disc at the origin shared an id. Every consumer treats the id as a
 * unit's name — `wildlifeMeshes.ts` keys its state and pool slots on it,
 * `wildlifeBehaviour.ts` draws every per-unit random from
 * `hash3(unit.id, ...)` — so a collision rendered one of the two animals and gave
 * the other its dwell, wander, refuge and call schedule. The (species, cell)
 * triple that generated the unit is unique by construction, so it IS the id.
 *
 * Species held 3 bits (0-7) until the butterfly raised `SPECIES_COUNT` to 9: at species 8
 * the third bit above the 3-bit field is the low bit `cellZ` is shifted into, so every
 * butterfly cell aliased the id its own `cellZ + 1` neighbour would have drawn — measured
 * directly on this census: cell (110, -116) and (110, -115) packed to the same id, one of
 * the two exact symptoms this whole scheme exists to prevent. Species now takes 4 bits (0-15,
 * room for eight more species before this has to be revisited), taken out of `cellZ` rather
 * than `cellX` so only one axis's alias bound halves rather than both — it did not have to
 * be `cellZ`, but a positive int32 has exactly 31 bits to spend and something had to give.
 *
 * Consequences worth stating: the id is now the same for every seed (it names a
 * cell, not a draw — behaviour still varies by seed because `hash3` there mixes
 * the seed in), and cells outside +/- `CELL_ID_BIAS` (on x) or +/- `CELL_ID_BIAS_Z` (on z)
 * alias. At the smallest cell (the butterfly's 16 m) that bound is 131 km on x and 65.5 km
 * on z; at the largest (the eagle's 512 m) it is 4,194 km on x and 2,097 km on z — orders of
 * magnitude beyond anywhere a player reaches, on both axes, at every species' own cell size.
 */
export const CELL_ID_BIAS = 8192;
/** As `CELL_ID_BIAS`, for the 13-bit `cellZ` field — one bit narrower than `cellX`'s so
 * species has the 4th bit it needs; see `unitId`'s own doc for why `cellZ` is the one that
 * gave it up. */
export const CELL_ID_BIAS_Z = 4096;
/** Exported as a test seam: a caller that needs a realistic field id — one shaped the way a
 * real unit's actually comes out, not a small placeholder — builds it the same way this
 * module does rather than guessing at the packing. */
export function unitId(species: number, cx: number, cz: number): number {
  return ((((cx + CELL_ID_BIAS) & 0x3fff) << 17) | (((cz + CELL_ID_BIAS_Z) & 0x1fff) << 4) | (species & 0xf));
}
function walkable(s: TerrainSample): boolean {
  return s.h > SAND_TOP && Math.hypot(s.dx, s.dz) <= MAX_WALKABLE_GRADIENT;
}
/** Direction of the densest forest on a ring around (x, z); the flee target lies REFUGE_DISTANCE that way. */
function forestRefuge(seed: number, x: number, z: number): { x: number; z: number } {
  let best = -1;
  let bx = x + REFUGE_DISTANCE;
  let bz = z;
  for (let k = 0; k < REFUGE_SAMPLES; k++) {
    const a = (2 * Math.PI * k) / REFUGE_SAMPLES;
    const sx = x + REFUGE_RING * Math.cos(a);
    const sz = z + REFUGE_RING * Math.sin(a);
    const rho = forestDensity(seed, sx, sz);
    if (rho > best) {
      best = rho;
      bx = x + REFUGE_DISTANCE * Math.cos(a);
      bz = z + REFUGE_DISTANCE * Math.sin(a);
    }
  }
  return { x: bx, z: bz };
}
function unit(
  partial: Omit<WildlifeUnit, "hash" | "id" | "presenceDraw" | "homeScale">
    & { seed: number; presenceDraw: number; homeScale?: number },
): WildlifeUnit {
  // `homeScale` defaults to 1: only the squirrel's home is a tree, and only the squirrel
  // reads it, so the other seven branches say nothing about it rather than repeating a 1.
  const { seed, homeScale = 1, ...rest } = partial;
  return { ...rest, homeScale, id: unitId(rest.species, rest.cellX, rest.cellZ), hash: draw(seed, rest.species, rest.cellX, rest.cellZ, 5) };
}

/** The seeded grazing anchor for a ground species' cell, before any habitat
 * gate runs. Exported as a test seam: the squirrel/rabbit "nearest to the
 * anchor" search picks among candidates found independently of it, so a test
 * needs this same point to check the search picked the right one. */
export function groundAnchor(seed: number, species: number, cellX: number, cellZ: number): { x: number; z: number } {
  const cell = WILDLIFE_CELL[species]!;
  return {
    x: (cellX + range(draw(seed, species, cellX, cellZ, 0), 0.2, 0.8)) * cell,
    z: (cellZ + range(draw(seed, species, cellX, cellZ, 1), 0.2, 0.8)) * cell,
  };
}

function groundUnit(seed: number, species: number, cx: number, cz: number): WildlifeUnit | null {
  const cell = WILDLIFE_CELL[species]!;
  const { x, z } = groundAnchor(seed, species, cx, cz);
  const presenceDraw = draw(seed, species, cx, cz, 2) / WILDLIFE_D[species]!;
  if (presenceDraw >= 1) return null;
  const s = elevationSampleAt(seed, x, z);
  if (!walkable(s)) return null;
  const variant = activeTerrainVariant();
  const road = variant.roadDistance?.(seed, x, z) ?? Infinity;
  switch (species) {
    case SPECIES_ELK: {
      if (road < ELK_ROAD_CLEAR) return null;
      if (clutterDensity(seed, CLUTTER_MEADOW, x, z, s) < ELK_MEADOW_FLOOR) return null;
      if (forestDensity(seed, x, z, s) >= 0.6) return null;
      const r = forestRefuge(seed, x, z);
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x, z, h: s.h, members: membersFor(seed, species, cx, cz), refugeX: r.x, refugeZ: r.z, homeX: x, homeZ: z, homeH: s.h, altitude: 0, radius: 0 });
    }
    case SPECIES_DEER: {
      if (road < ELK_ROAD_CLEAR) return null;
      const rho = forestDensity(seed, x, z, s);
      if (rho < DEER_DENSITY_LO || rho > DEER_DENSITY_HI) return null;
      const r = forestRefuge(seed, x, z);
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x, z, h: s.h, members: membersFor(seed, species, cx, cz), refugeX: r.x, refugeZ: r.z, homeX: x, homeZ: z, homeH: s.h, altitude: 0, radius: 0 });
    }
    case SPECIES_RABBIT: {
      if (clutterDensity(seed, CLUTTER_GRASS, x, z, s) < RABBIT_GRASS_FLOOR) return null;
      const bushes = clutterInRect(seed, CLUTTER_BUSH, x - RABBIT_COVER_RADIUS, z - RABBIT_COVER_RADIUS, x + RABBIT_COVER_RADIUS, z + RABBIT_COVER_RADIUS);
      let best: { x: number; z: number; groundH: number } | null = null;
      let bestD = RABBIT_COVER_RADIUS;
      for (const b of bushes) {
        const d = Math.hypot(b.x - x, b.z - z);
        if (d <= bestD) { bestD = d; best = b; }
      }
      if (best === null) return null;
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x, z, h: s.h, members: membersFor(seed, species, cx, cz), refugeX: best.x, refugeZ: best.z, homeX: best.x, homeZ: best.z, homeH: best.groundH, altitude: 0, radius: 0 });
    }
    case SPECIES_SQUIRREL: {
      if (forestDensity(seed, x, z, s) < SQUIRREL_DENSITY_FLOOR) return null;
      // The nearest giant among the tree cells this wildlife cell covers. The
      // 24 m cell is not a multiple of TREE_CELL (10 m), so [t0x, t1x) is
      // every tree cell that OVERLAPS [cx·cell, (cx+1)·cell) — wider than a
      // fixed-count window, which (at n = ceil(cell/TREE_CELL)) can fall
      // short of the far edge for some residues of cx mod 5 and miss a tree
      // cell that legitimately overlaps this one. Ownership is disambiguated
      // by position: a tree belongs to this cell only if it falls inside the
      // cell's own [cx·cell, (cx+1)·cell) bounds, so at most one cell can
      // ever claim a given giant, and every giant that belongs to some cell
      // is reachable from that cell's own window.
      const t0x = Math.floor((cx * cell) / TREE_CELL);
      const t1x = Math.ceil(((cx + 1) * cell) / TREE_CELL);
      const t0z = Math.floor((cz * cell) / TREE_CELL);
      const t1z = Math.ceil(((cz + 1) * cell) / TREE_CELL);
      // `scale` rides along with the position: the squirrel clings to this trunk, and how
      // far out from its axis it has to sit is that scale × GIANT_TRUNK_RADIUS_PER_SCALE.
      let best: { x: number; z: number; groundH: number; scale: number } | null = null;
      let bestD = Infinity;
      for (let tz = t0z; tz < t1z; tz++) for (let tx = t0x; tx < t1x; tx++) {
        const t = treeInCell(seed, tx, tz);
        if (t === null || t.cohort !== COHORT_GIANT) continue;
        if (Math.floor(t.x / cell) !== cx || Math.floor(t.z / cell) !== cz) continue;
        const d = Math.hypot(t.x - x, t.z - z);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best === null) return null;
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x: best.x, z: best.z, h: best.groundH, members: membersFor(seed, species, cx, cz), refugeX: best.x, refugeZ: best.z, homeX: best.x, homeZ: best.z, homeH: best.groundH, homeScale: best.scale, altitude: 0, radius: 0 });
    }
    default:
      return null;
  }
}

/**
 * How high the canopy stands above `groundH` within `radius` of (x, z), as the top of the
 * tallest GIANT there — 0 where the disc holds none. Used by the roost to draw a loop that
 * clears the stand it lives in rather than a fixed altitude that the next vegetation retune
 * would silently bury.
 *
 * Deterministic and cheap: it reads the same `treeInCell` field the placement walk already
 * reads, and a tree can never leave its own cell (`JITTER_SPAN` keeps a 0.15-cell margin),
 * so the cells covering the disc's bounding box cover every tree in the disc. The walk runs
 * only for a cell that has already produced a snag, which is a few percent of roost cells.
 */
function canopyTopNear(seed: number, x: number, z: number, groundH: number, radius: number): number {
  let top = 0;
  const loX = Math.floor((x - radius) / TREE_CELL), hiX = Math.floor((x + radius) / TREE_CELL);
  const loZ = Math.floor((z - radius) / TREE_CELL), hiZ = Math.floor((z + radius) / TREE_CELL);
  for (let tz = loZ; tz <= hiZ; tz++) for (let tx = loX; tx <= hiX; tx++) {
    const t = treeInCell(seed, tx, tz);
    if (t === null || t.cohort !== COHORT_GIANT) continue;
    if (Math.hypot(t.x - x, t.z - z) > radius) continue;
    // Relative to the ROOST's ground, not the tree's: a giant standing uphill of the snag
    // hides the loop by the height difference as well as by its own.
    const above = t.groundH + GIANT_MODEL_HEIGHT[t.species]! * t.scale - groundH;
    if (above > top) top = above;
  }
  return top;
}

function birdUnit(seed: number, species: number, cx: number, cz: number): WildlifeUnit | null {
  const cell = WILDLIFE_CELL[species]!;
  if (species === SPECIES_RAVEN_ROOST) {
    // One roost per 40 m cell at most: the first snag in scan order that passes the draw.
    const n = cell / TREE_CELL;
    for (let tz = cz * n; tz < (cz + 1) * n; tz++) for (let tx = cx * n; tx < (cx + 1) * n; tx++) {
      const t = treeInCell(seed, tx, tz);
      if (t === null || t.cohort !== COHORT_SNAG) continue;
      // Placed to TWICE the species density and tagged with the draw, so the shell can
      // show the second half only under dread (ravens ×2) without a re-walk.
      const presenceDraw = draw(seed, species, tx, tz, 2) / WILDLIFE_D[species]!;
      if (presenceDraw >= 2) continue;
      const radius = range(draw(seed, species, cx, cz, 7), 15, 25);
      // Above the stand, not at a fixed height: the clearance is drawn
      // from the same slot the flat range used, so a roost's altitude stays a pure function
      // of (seed, species, cell) and no new draw enters the field.
      const clearance = range(draw(seed, species, cx, cz, 6), ...RAVEN_ROOST_CLEARANCE);
      const alt = Math.max(RAVEN_ROOST_ALT_FLOOR, canopyTopNear(seed, t.x, t.z, t.groundH, radius) + clearance);
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x: t.x, z: t.z, h: t.groundH, members: membersFor(seed, species, cx, cz), refugeX: t.x, refugeZ: t.z, homeX: t.x, homeZ: t.z, homeH: t.groundH, altitude: alt, radius });
    }
    return null;
  }
  const presenceDraw = draw(seed, species, cx, cz, 2) / WILDLIFE_D[species]!;
  if (presenceDraw >= 1) return null;
  const x = (cx + range(draw(seed, species, cx, cz, 0), 0.2, 0.8)) * cell;
  const z = (cz + range(draw(seed, species, cx, cz, 1), 0.2, 0.8)) * cell;
  const variant = activeTerrainVariant();
  switch (species) {
    case SPECIES_RAVEN_PAIR: {
      const s = elevationSampleAt(seed, x, z);
      if (forestDensity(seed, x, z, s) < RAVEN_PAIR_DENSITY_FLOOR) return null;
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x, z, h: s.h, members: 2, refugeX: x, refugeZ: z, homeX: x, homeZ: z, homeH: s.h, altitude: range(draw(seed, species, cx, cz, 6), ...RAVEN_PAIR_ALT), radius: range(draw(seed, species, cx, cz, 7), ...RAVEN_PAIR_RADIUS) });
    }
    case SPECIES_GULL: {
      const d = variant.coastDistance?.(seed, x, z);
      if (d === undefined || !Number.isFinite(d)) return null;
      // coastDistance is signed x − coastlineX, so the coastline at this z is x − d.
      // x cancels out of hx exactly (hx = coastlineX(z) + jitter): the drawn
      // anchor x only picks a plausible sample point for coastDistance, not
      // the flock's actual position, which is why the gull's cell size (120 m,
      // WILDLIFE_CELL[SPECIES_GULL]) is effectively z-only despite the array's single value.
      const hx = x - d + range(draw(seed, species, cx, cz, 6), -GULL_BAND, GULL_BAND);
      const s = elevationSampleAt(seed, hx, z);
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x: hx, z, h: s.h, members: membersFor(seed, species, cx, cz), refugeX: hx, refugeZ: z, homeX: hx, homeZ: z, homeH: Math.max(s.h, 0), altitude: range(draw(seed, species, cx, cz, 7), ...GULL_ALT), radius: range(draw(seed, species, cx, cz, 8), ...GULL_RADIUS) });
    }
    case SPECIES_EAGLE: {
      // The generic bird anchor (x, z) above is not used here: EAGLE_SAMPLES
      // is always > 0, so the loop's first iteration unconditionally beats
      // the -Infinity starting height and overwrites bx/bz.
      let bestH = -Infinity;
      let bx = 0;
      let bz = 0;
      for (let k = 0; k < EAGLE_SAMPLES; k++) {
        const sx = (cx + draw(seed, species, cx, cz, 10 + 2 * k)) * cell;
        const sz = (cz + draw(seed, species, cx, cz, 11 + 2 * k)) * cell;
        const h = elevationSampleAt(seed, sx, sz).h;
        if (h > bestH) { bestH = h; bx = sx; bz = sz; }
      }
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x: bx, z: bz, h: bestH, members: membersFor(seed, species, cx, cz), refugeX: bx, refugeZ: bz, homeX: bx, homeZ: bz, homeH: bestH, altitude: range(draw(seed, species, cx, cz, 6), ...EAGLE_ALT), radius: range(draw(seed, species, cx, cz, 7), ...EAGLE_RADIUS) });
    }
    case SPECIES_BUTTERFLY: {
      // Open ground with flowers on it — the same "open" a meadow reads as, not merely
      // "not a dense stand": `CLUTTER_GRASS_CANOPY_LO` is the canopy fraction below which
      // grass and rabbits already treat the ground as clear.
      const s = elevationSampleAt(seed, x, z);
      if (forestDensity(seed, x, z, s) >= CLUTTER_GRASS_CANOPY_LO) return null;
      if (clutterDensity(seed, CLUTTER_FLOWER, x, z, s) <= 0) return null;
      // Always one insect — the raven pair's own fixed `members: 2` precedent — so no ninth
      // entry is owed to `WILDLIFE_MEMBERS` for a count that never varies.
      return unit({ seed, presenceDraw, species, cellX: cx, cellZ: cz, x, z, h: s.h, members: 1, refugeX: x, refugeZ: z, homeX: x, homeZ: z, homeH: s.h, altitude: 0, radius: 0 });
    }
    default:
      return null;
  }
}

export function wildlifeUnitInCell(seed: number, species: number, cellX: number, cellZ: number): WildlifeUnit | null {
  return species < FIRST_BIRD_SPECIES ? groundUnit(seed, species, cellX, cellZ) : birdUnit(seed, species, cellX, cellZ);
}

function inDisc(u: WildlifeUnit, camX: number, camZ: number, r: number): boolean {
  const cx = u.species >= FIRST_BIRD_SPECIES ? u.homeX : u.x;
  const cz = u.species >= FIRST_BIRD_SPECIES ? u.homeZ : u.z;
  const dx = cx - camX;
  const dz = cz - camZ;
  return dx * dx + dz * dz <= r * r;
}

/** Pure one-shot: every unit whose anchor lies inside its species' scaled disc. */
export function wildlifeUnitsInDisc(seed: number, camX: number, camZ: number, radiusScale = 1): WildlifeUnit[] {
  const out: WildlifeUnit[] = [];
  for (let species = 0; species < SPECIES_COUNT; species++) {
    const cell = WILDLIFE_CELL[species]!;
    const r = WILDLIFE_RADIUS[species]! * radiusScale;
    const x0 = Math.floor((camX - r) / cell);
    const x1 = Math.floor((camX + r) / cell);
    const z0 = Math.floor((camZ - r) / cell);
    const z1 = Math.floor((camZ + r) / cell);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const u = wildlifeUnitInCell(seed, species, cx, cz);
      if (u !== null && inDisc(u, camX, camZ, r)) out.push(u);
    }
  }
  return out;
}

export type WildlifeCollector = {
  collect(camX: number, camZ: number, radiusScale: number): WildlifeUnit[];
  /** How many (species, cell) pairs have been sampled so far — a test hook for the memo. */
  readonly cellsSampled: number;
};

/**
 * The renderer's hot path: the same walk, with per-cell results memoized so a
 * rebuild after 8 m of travel re-samples only the disc's leading edge. A roost
 * cell costs up to 16 `treeInCell` calls to scan its 4×4 tree cells for a snag,
 * and the few percent that find one pay `canopyTopNear` on top — another 16–49
 * over the bounding box of its 15–25 m disc. A 400 m disc holds ~300 roost cells,
 * so the first collect is ~30 ms and every later one is a few hundred microseconds.
 */
export function createWildlifeCollector(seed: number): WildlifeCollector {
  const memo = new Map<string, WildlifeUnit | null>();
  let sampled = 0;
  return {
    get cellsSampled() { return sampled; },
    collect(camX, camZ, radiusScale) {
      const out: WildlifeUnit[] = [];
      for (let species = 0; species < SPECIES_COUNT; species++) {
        const cell = WILDLIFE_CELL[species]!;
        const r = WILDLIFE_RADIUS[species]! * radiusScale;
        const x0 = Math.floor((camX - r) / cell);
        const x1 = Math.floor((camX + r) / cell);
        const z0 = Math.floor((camZ - r) / cell);
        const z1 = Math.floor((camZ + r) / cell);
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const key = `${species}:${cx}:${cz}`;
          let u = memo.get(key);
          if (u === undefined) {
            u = wildlifeUnitInCell(seed, species, cx, cz);
            memo.set(key, u);
            sampled++;
          }
          if (u !== null && inDisc(u, camX, camZ, r)) out.push(u);
        }
      }
      return out;
    },
  };
}
