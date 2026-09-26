import { CLUTTER_MEADOW, groundCover, type ClutterInstance } from "../sim/clutter.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { latticeHash } from "./groundHexParams.js";
import { CLUTTER_FAR_SPLIT, CLUTTER_RADII, clutterSeamEdges } from "./clutterField.js";

/**
 * The blade field: the near-field lattice the blade clumps stand on, walked
 * around the eye and gated by the sim's own ground-cover field. Pure and
 * Babylon-free like `clutterField.ts`, whose walk this mirrors: cells of
 * BLADE_CELL on a fixed world grid, squared distances from a snapped origin,
 * a memoising collector keyed by cell. Where the clutter classes decide
 * presence by a coin flip per cell, this field draws a clump in every cell
 * whose cover clears a floor and lets the cover set both how much grass the
 * clump shows (`strength`, clamped to [0, 1]) and how large a clump the cell
 * can afford (`size`, from the unclamped `cover`), so a thin spot is a thin
 * sward rather than bare floor with tufts, and a boosted patch stands taller
 * clumps rather than merely more of the same one.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 * The sim is read (its gate, terrain sample, trail distance and forest
 * density), never written.
 */

/** Lattice cell (m). */
export const BLADE_CELL = 0.5;
/** The field rebuilds when the eye crosses a cell of this size (m). */
export const BLADE_REBUILD_CELL = 1;
/** The worst offset (m) between the true eye and the origin the distances
 * were measured against: the origin is floored to BLADE_CELL at the last
 * rebuild, and the eye moves under BLADE_REBUILD_CELL per axis before the
 * next. Every tier list is collected this far past its edge, so a clump is
 * present for every eye inside the rebuild cell and never pops. */
export const BLADE_PAD = Math.SQRT2 * (BLADE_REBUILD_CELL + BLADE_CELL);
/** The outer reach: the meadow carpet's own near/far split, so the coarse
 * tier hands off to the far cards where they already dither in. */
export const BLADE_REACH = (CLUTTER_RADII[CLUTTER_MEADOW] as number) * CLUTTER_FAR_SPLIT;
/** Outer edges (m) of the fine and mid tiers. */
export const BLADE_TIER_EDGE: readonly [number, number] = [4, 8];
/** Width (m) of the fine→mid and mid→coarse hand-off bands, ending at the tier edge. */
export const BLADE_TIER_BAND = 1.5;
/** A cell whose gate is under this draws nothing. */
export const BLADE_STRENGTH_FLOOR = 0.05;
/** Jitter of a cell's clump inside the cell, as a fraction of the cell. */
export const BLADE_JITTER = 0.4;

/** Clump characters, by index into `BLADE_CHARACTERS` (bladeClump.ts). */
export const BLADE_FINE = 0;
export const BLADE_TUSSOCK = 1;
export const BLADE_WEED = 2;
export const BLADE_FLOWER = 3;
export const BLADE_CHARACTER_COUNT = 4;
/** Share of cells per character at full strength, in index order. */
export const BLADE_CHARACTER_WEIGHTS: readonly number[] = [0.6, 0.2, 0.12, 0.08];
/** Flower-bearing clumps only stand in grass at least this thick; below it
 * their share goes to fine grass. */
export const BLADE_FLOWER_MIN_STRENGTH = 0.5;

/** Clump sizes a cell can buy, by its cover: thin below the thin band, full
 * above the full band, base between. Inside a band the choice is dithered by
 * the cell's own draw, so the share of each size is a smoothstep of cover
 * and no contour of clump size ever forms across the field. */
export const BLADE_SIZE_THIN = 0;
export const BLADE_SIZE_BASE = 1;
export const BLADE_SIZE_FULL = 2;
export const BLADE_SIZE_COUNT = 3;
/** A cell at the canopy floor sits above this band, so it draws the base
 * clump rather than the thin one. */
export const BLADE_THIN_BAND: readonly [number, number] = [0.25, 0.45];
export const BLADE_FULL_BAND: readonly [number, number] = [1.0, 1.25];

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The clump size a cell buys: `draw` (the cell's own uniform draw) decides
 * where it falls inside the thin or full band, so nearby cells with the same
 * cover split between sizes in the band's proportion rather than all picking
 * the same one — the dither that keeps a size choice from drawing a visible
 * contour across the field. */
export function bladeSizeFor(draw: number, cover: number): 0 | 1 | 2 {
  const pThin = 1 - smooth01(BLADE_THIN_BAND[0], BLADE_THIN_BAND[1], cover);
  if (draw < pThin) return BLADE_SIZE_THIN;
  const pFull = smooth01(BLADE_FULL_BAND[0], BLADE_FULL_BAND[1], cover);
  if (draw < pFull) return BLADE_SIZE_FULL;
  return BLADE_SIZE_BASE;
}

/** Four numbers like `fadeBands`: grow-in start and end, collapse start and end. */
export type BladeEdges = readonly [number, number, number, number];

/** A no-op grow-in: two distinct negative edges every distance is past.
 * Exported so `duffField.ts`'s own near tier — which likewise has no
 * grow-in — can share this exact pair rather than each field carrying its
 * own copy that a later edit could drift out of step with. */
export const GROW_NONE: readonly [number, number] = [-2, -1];

/** The three tiers' hand-off edges, in true eye distance. The fine tier has
 * no grow-in; each tier collapses over the band the next one grows over; the
 * coarse tier collapses over the meadow seam, where the far cards dither in. */
export function bladeTierBands(): [BladeEdges, BladeEdges, BladeEdges] {
  const [e0, e1] = BLADE_TIER_EDGE;
  const seam = clutterSeamEdges(CLUTTER_MEADOW);
  return [
    [GROW_NONE[0], GROW_NONE[1], e0 - BLADE_TIER_BAND, e0],
    [e0 - BLADE_TIER_BAND, e0, e1 - BLADE_TIER_BAND, e1],
    [e1 - BLADE_TIER_BAND, e1, seam.start, seam.end],
  ];
}

/** The character a cell draws: the weights walked with one uniform draw,
 * the flower share folded into fine grass below the strength threshold. */
export function bladeCharacterFor(draw: number, strength: number): number {
  let acc = 0;
  for (let c = 0; c < BLADE_CHARACTER_COUNT; c++) {
    let w = BLADE_CHARACTER_WEIGHTS[c] as number;
    if (c === BLADE_FINE && strength < BLADE_FLOWER_MIN_STRENGTH) w += BLADE_CHARACTER_WEIGHTS[BLADE_FLOWER] as number;
    if (c === BLADE_FLOWER && strength < BLADE_FLOWER_MIN_STRENGTH) w = 0;
    acc += w;
    if (draw < acc) return c;
  }
  return BLADE_FINE;
}

/**
 * One cell of the field. It is shaped as a `ClutterInstance` of the meadow
 * class (unit scale, variant 0) so the cards' matrix, trample and tint
 * writers in clutterMeshes.ts serve it unchanged, plus the field's own: the
 * cover and its clamped strength, the canopy, the trail distance, the
 * character and the size.
 */
export type BladeCell = ClutterInstance & {
  /** The ground-cover field's grass at the clump: how much grass this ground
   * earns, unclamped, in [BLADE_STRENGTH_FLOOR, CLUTTER_GRASS_BOOST]. Drives
   * which clump size the cell buys (`size`) — the boosted edge is where a
   * cell can afford a full clump. */
  cover: number;
  /** The alive cut the shader applies, in [0, 1]: `min(1, cover)`. `cover`
   * can run past 1 where the field boosts a patch; `strength` never does, so
   * it stays the number the per-blade cut and the height interpolation want. */
  strength: number;
  /** forestDensity at the clump, for the shade and the height. */
  canopy: number;
  /** Distance to the trail edge (Infinity without a trail). */
  rt: number;
  character: number;
  /** The uniform draw the character came from, kept so a test can re-derive it. */
  characterDraw: number;
  /** The clump size this cell buys: BLADE_SIZE_THIN, _BASE or _FULL. */
  size: 0 | 1 | 2;
  /** The uniform draw `size` came from, kept so a test can re-derive it. */
  sizeDraw: number;
};

/** One of a cell's draws: the lattice hash on salted cell indices. Exported
 * so tests can reproduce a cell's own sample point. */
export function cellDraw(ci: number, cj: number, salt: number): number {
  return latticeHash(ci + 131 * salt, cj + 173 * salt);
}

/** The cell at lattice indices (ci, cj), or null where the gate is under the
 * floor. Pure in (seed, ci, cj): every rebuild sees the same cell. */
export function bladeCellAt(seed: number, ci: number, cj: number): BladeCell | null {
  const x = (ci + 0.5 + BLADE_JITTER * (cellDraw(ci, cj, 1) - 0.5)) * BLADE_CELL;
  const z = (cj + 0.5 + BLADE_JITTER * (cellDraw(ci, cj, 2) - 0.5)) * BLADE_CELL;
  const variant = activeTerrainVariant();
  const s = variant.sample(seed, x, z);
  const cover = groundCover(seed, x, z, s).grass;
  if (cover < BLADE_STRENGTH_FLOOR) return null;
  const strength = Math.min(1, cover);
  const characterDraw = cellDraw(ci, cj, 4);
  const sizeDraw = cellDraw(ci, cj, 5);
  return {
    cls: CLUTTER_MEADOW,
    x,
    z,
    groundH: s.h,
    groundDx: s.dx,
    groundDz: s.dz,
    scale: 1,
    variant: 0,
    hash: cellDraw(ci, cj, 3),
    cover,
    strength,
    canopy: forestDensity(seed, x, z, s),
    rt: variant.trailDistance?.(seed, x, z) ?? Infinity,
    character: bladeCharacterFor(characterDraw, strength),
    characterDraw,
    size: bladeSizeFor(sizeDraw, cover),
    sizeDraw,
  };
}

export type BladeTiers = { fine: BladeCell[]; mid: BladeCell[]; coarse: BladeCell[] };

function bladeOrigin(v: number): number {
  return Math.floor(v / BLADE_CELL) * BLADE_CELL;
}

/** The walk, shared by the pure one-shot and the memoising collector. */
function collectBladeCore(camX: number, camZ: number, sample: (ci: number, cj: number) => BladeCell | null): BladeTiers {
  const ox = bladeOrigin(camX), oz = bladeOrigin(camZ);
  const [e0, e1] = BLADE_TIER_EDGE;
  const fineHi = e0 + BLADE_PAD;
  const midLo = Math.max(0, e0 - BLADE_TIER_BAND - BLADE_PAD), midHi = e1 + BLADE_PAD;
  const coarseLo = Math.max(0, e1 - BLADE_TIER_BAND - BLADE_PAD), coarseHi = BLADE_REACH + BLADE_PAD;
  const fineHi2 = fineHi * fineHi, midLo2 = midLo * midLo, midHi2 = midHi * midHi;
  const coarseLo2 = coarseLo * coarseLo, coarseHi2 = coarseHi * coarseHi;
  const r = coarseHi;
  const fine: { c: BladeCell; d2: number }[] = [];
  const mid: { c: BladeCell; d2: number }[] = [];
  const coarse: { c: BladeCell; d2: number }[] = [];
  const c0x = Math.floor((ox - r) / BLADE_CELL), c1x = Math.floor((ox + r) / BLADE_CELL);
  const c0z = Math.floor((oz - r) / BLADE_CELL), c1z = Math.floor((oz + r) / BLADE_CELL);
  for (let cj = c0z; cj <= c1z; cj++) {
    for (let ci = c0x; ci <= c1x; ci++) {
      const c = sample(ci, cj);
      if (c === null) continue;
      const dx = c.x - ox, dz = c.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= coarseHi2) continue;
      if (d2 < fineHi2) fine.push({ c, d2 });
      if (d2 >= midLo2 && d2 < midHi2) mid.push({ c, d2 });
      if (d2 >= coarseLo2) coarse.push({ c, d2 });
    }
  }
  const nearest = (a: { d2: number }, b: { d2: number }) => a.d2 - b.d2;
  fine.sort(nearest);
  mid.sort(nearest);
  coarse.sort(nearest);
  return { fine: fine.map((p) => p.c), mid: mid.map((p) => p.c), coarse: coarse.map((p) => p.c) };
}

/** The three tier lists around the eye, nearest first, each padded past its
 * band so no eye inside the rebuild cell can want a clump that is absent. */
export function collectBladeCells(seed: number, camX: number, camZ: number): BladeTiers {
  return collectBladeCore(camX, camZ, (ci, cj) => bladeCellAt(seed, ci, cj));
}

export type BladeCollector = {
  /** Identical output to `collectBladeCells(seed, camX, camZ)`. */
  collect(camX: number, camZ: number): BladeTiers;
  /** Cached cell count, for the tests. */
  readonly size: number;
};

// Numeric cell key: exact for |index| < 2^20 (±524 km on a 0.5 m lattice).
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;
/** Cells whose nearest point sits this far past the reach are evicted. */
const EVICT_RADIUS = BLADE_REACH + BLADE_PAD + 8 * BLADE_CELL;
/** A cold disc is about π·(18 + 2.1)²/0.25 ≈ 5,100 cells; a 1 m crossing adds
 * about 450. The sweep runs once this many are cached, so it is periodic,
 * never per crossing. */
export const BLADE_SWEEP_SIZE = 30000;

/** The memoising collector the shell uses: `bladeCellAt` is pure in its cell,
 * so a crossing re-samples only the ring of cells newly inside the disc. */
export function createBladeCollector(seed: number): BladeCollector {
  const cache = new Map<number, BladeCell | null>();
  return {
    collect(camX: number, camZ: number): BladeTiers {
      const tiers = collectBladeCore(camX, camZ, (ci, cj) => {
        const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
        let c = cache.get(key);
        if (c === undefined) {
          c = bladeCellAt(seed, ci, cj);
          cache.set(key, c);
        }
        return c;
      });
      if (cache.size > BLADE_SWEEP_SIZE) {
        const ox = bladeOrigin(camX), oz = bladeOrigin(camZ);
        for (const key of cache.keys()) {
          const cj = (key % KEY_SPAN) - KEY_HALF;
          const ci = Math.floor(key / KEY_SPAN) - KEY_HALF;
          const dx = Math.max(ci * BLADE_CELL - ox, 0, ox - (ci + 1) * BLADE_CELL);
          const dz = Math.max(cj * BLADE_CELL - oz, 0, oz - (cj + 1) * BLADE_CELL);
          if (dx * dx + dz * dz >= EVICT_RADIUS * EVICT_RADIUS) cache.delete(key);
        }
      }
      return tiers;
    },
    get size(): number {
      return cache.size;
    },
  };
}
