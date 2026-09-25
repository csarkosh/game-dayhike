import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import type { Aabb } from "../level.js";
import type { ClutterInstance } from "../clutter.js";
import { activeTerrainVariantName, elevationSampleAt } from "../terrain.js";
import {
  CLIFF_CELL, CLIFF_MODEL_BASE, CLIFF_MODEL_DEPTH, CLIFF_MODEL_FRONT, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_RIGHT, CLIFF_MODEL_WIDTH,
  CLIFF_RUN_REACH, CLIFF_SCALE, CLIFF_TUNABLES, cliffCellRuns, cliffFacing, leanPoint,
  type CliffPoint,
} from "../cliffField.js";

/**
 * The cliff modules' colliders: a rock wall stops a hiker, and blocks sight,
 * the way a boulder does.
 *
 * A module is a slab up to 32 m long, yawed to face downslope and leant up to
 * 20° toward the ground normal (`cliffField.ts`). One axis-aligned box around
 * a yawed slab that long would claim ground far off its face, so each module
 * is a ROW of boxes along its length: the width is cut into pieces no longer
 * than `CLIFF_BOX_STEP`, and each piece gets the axis-aligned bounds of its
 * own part of the seated solid.
 *
 * The bounds are of the SEATED solid — the eight corners of the piece's
 * whole drawn box (`y` from the model's base, `CLIFF_MODEL_BASE` — a little
 * below the origin — to its top, `BASE + CLIFF_MODEL_HEIGHT`, the part the sink
 * buries included; `z` from the back of the depth to the face's reach),
 * turned to the module's facing and then leant exactly as the renderer leans
 * it. The lean turns about the sunk origin: it tips the top downslope, out
 * over the foot of the face, by up to `H · scale · sin 20°` (3.9 m for the
 * long model at the top of the band), drops the front of the base below the
 * origin, and lifts the back of the top edge above the plumb height. Bounding
 * the plumb, unleant box instead leaves nearly half the drawn solid outside
 * (`test/sim/passes/cliffs.test.ts`). A seated point of the piece is a convex
 * combination of the piece's seated corners, so it lies inside their bounds:
 * the boxes contain the whole drawn solid, above the ground and below it.
 *
 * Each box runs from the lowest of its seated corners to the highest.
 *
 * Two consequences of standing axis-aligned boxes round a leaning slab. At
 * the foot of the face each box stands plumb over the whole of the lean's
 * reach, so it claims a few metres of ground in front of the drawn rock —
 * ground that is mostly too steep to stand on, though only the probe points
 * are guaranteed to be. And a box's top is flat and level with the highest
 * corner of its piece, so where the hillside behind a wall comes up to that
 * top, a hiker sliding down from above can land on a ledge that stands above
 * the drawn top edge.
 *
 * That ledge is on purpose. Left where the seated corners put it, a box's
 * uphill face stands in the open above the hillside behind the wall, and the
 * ground there is too steep to stand on: a hiker sliding down behind the
 * wall comes to rest in the V between hillside and face, never grounded, so
 * unable to jump, with air control too weak to climb and the face cancelling
 * the slide — trapped for good. So each box's uphill face is moved back into
 * the hill (`buryBox`) until the hillside along it stands at or above the
 * box's top: the slide then meets the top, which is flat and holds a foot,
 * and the hiker walks forward off the front. The boxes only grow, so they
 * still contain the drawn solid. The uphill face is the one the uphill
 * direction points through most nearly; moving the other side face too,
 * where the uphill direction is near a diagonal, would bury a face that
 * runs down the slope, whose downhill end the hillside never reaches, and
 * every such face would stop at the cap (§12.5 of the design).
 */

/** Longest piece of a module's width (m) that one box covers. */
export const CLIFF_BOX_STEP = 4;

/** How far (m) a box's uphill face moves each time the terrain along it is
 * found below the box's top (`buryBox`). */
export const CLIFF_BURY_STEP = 1;
/** The furthest (m) a box's uphill face is moved into the hill. Where the
 * terrain along the face is still below the top there, the box stops at this
 * and the case is counted (`passes/cliffs.test.ts`). The seven boxes that
 * trapped a hiker at the scarp needed 1–5 m; over every module within 400 m
 * of the origin on 200 worlds the furthest any face needed was 14 m, and
 * none reached this. */
export const CLIFF_BURY_MAX = 16;
/** How far apart (m), at most, the terrain is read along a face. */
export const CLIFF_BURY_SAMPLE = 1;
/** The material the cliff boxes carry: the renderer leaves them undrawn, as
 * it does trunks and boulders, because the cliff meshes draw the module
 * itself (`game/propMeshes.ts`). */
export const CLIFF_MATERIAL = "cliff";

/**
 * The farthest (m) any point of a seated module's solid stands from the
 * module's origin: the distance of the model's farthest corner at the top of
 * the scale band, bounded by `CLIFF_SCALE[1] · sqrt(max(R, W − R)² + H² +
 * max(F, D − F)²)`. The model runs from `CLIFF_MODEL_BASE` to `BASE + H` on
 * its own y axis, a little below the origin to a little short of `H`, so `H`
 * bounds its reach along y from either end.
 * Yaw and lean are rotations about the origin and keep every distance from
 * it, so no seating carries the solid further — horizontally or otherwise.
 * 21.58 m at the shipped constants (the long model: 1.6 · sqrt(10.55² +
 * 7.17² + 4.39²)); the seated solid's own horizontal reach is somewhat less,
 * which this bound does not need to know.
 */
export const CLIFF_SOLID_REACH = solidReach();

function solidReach(): number {
  let worst = 0;
  for (let v = 0; v < CLIFF_MODEL_WIDTH.length; v++) {
    const w = CLIFF_MODEL_WIDTH[v] as number, rt = CLIFF_MODEL_RIGHT[v] as number;
    const d = CLIFF_MODEL_DEPTH[v] as number, f = CLIFF_MODEL_FRONT[v] as number;
    const h = CLIFF_MODEL_HEIGHT[v] as number;
    const x = Math.max(rt, w - rt), z = Math.max(f, d - f);
    worst = Math.max(worst, CLIFF_SCALE[1] * Math.sqrt(x * x + h * h + z * z));
  }
  return worst;
}

/** How far past a region (m) a cell's own point may lie and its run still
 * lay a module whose box reaches into the region: as far as a run carries a
 * module's origin (`CLIFF_RUN_REACH`), plus the farthest the module's solid
 * reaches from that origin (`CLIFF_SOLID_REACH`), plus the furthest a box's
 * uphill face is moved on its axis (`CLIFF_BURY_MAX`). A cell's point lies inside
 * its own cell, so walking every cell that meets the region grown by this
 * much finds every such module. */
export const CLIFF_GATHER_REACH = CLIFF_RUN_REACH + CLIFF_SOLID_REACH + CLIFF_BURY_MAX;

const corner: CliffPoint = { x: 0, y: 0, z: 0 };

/**
 * A module's colliders in the world's frame, unclipped: one box per piece of
 * its width, in order along the width from `−(W − R)` to `+R`. A pure
 * function of the module, so every chunk that finds it computes the same
 * boxes.
 */
export function cliffSeatedBoxes(m: ClutterInstance): Aabb[] {
  const v = m.variant, s = m.scale;
  const w = (CLIFF_MODEL_WIDTH[v] as number) * s;
  const h = (CLIFF_MODEL_HEIGHT[v] as number) * s;
  const d = (CLIFF_MODEL_DEPTH[v] as number) * s;
  const f = (CLIFF_MODEL_FRONT[v] as number) * s;
  const rt = (CLIFF_MODEL_RIGHT[v] as number) * s;
  const y0 = (CLIFF_MODEL_BASE[v] as number) * s;
  const facing = cliffFacing(m.groundDx, m.groundDz, m.hash);
  const x0 = -(w - rt), z0 = -(d - f);
  const n = Math.max(1, Math.ceil(w / CLIFF_BOX_STEP));
  const out: Aabb[] = [];
  for (let i = 0; i < n; i++) {
    const a = x0 + (w * i) / n;
    const b = i === n - 1 ? rt : x0 + (w * (i + 1)) / n;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let c = 0; c < 8; c++) {
      const lx = c & 1 ? b : a, ly = c & 2 ? y0 + h : y0, lz = c & 4 ? f : z0;
      // Yaw first, then the lean — the order the placement probes and the
      // renderer both seat in.
      leanPoint(lx * facing.rx + lz * facing.fx, ly, lx * facing.rz + lz * facing.fz, m.groundDx, m.groundDz, corner);
      if (corner.x < minX) minX = corner.x;
      if (corner.x > maxX) maxX = corner.x;
      if (corner.z < minZ) minZ = corner.z;
      if (corner.z > maxZ) maxZ = corner.z;
      if (corner.y < minY) minY = corner.y;
      if (corner.y > maxY) maxY = corner.y;
    }
    out.push({
      min: { x: m.x + minX, y: m.groundH + minY, z: m.z + minZ },
      max: { x: m.x + maxX, y: m.groundH + maxY, z: m.z + maxZ },
    });
  }
  return out;
}

/** Which side face of a module's boxes lies uphill: the one its uphill
 * direction, `−(fx, fz)`, points through most nearly — the axis with the
 * larger component (x on a tie), signed — as `{ sx, sz }` with one of the two
 * zero. */
export function cliffBuryFaces(m: ClutterInstance): { sx: number; sz: number } {
  const f = cliffFacing(m.groundDx, m.groundDz, m.hash);
  const ux = -f.fx, uz = -f.fz;
  if (Math.abs(ux) >= Math.abs(uz)) return { sx: ux >= 0 ? 1 : -1, sz: 0 };
  return { sx: 0, sz: uz >= 0 ? 1 : -1 };
}

/** Whether the terrain along one side face of `b` stands at or above its top
 * at every sample: the face at `x = at` running over the box's z (`axis`
 * 0), or at `z = at` running over its x (`axis` 1). */
function faceBuried(seed: number, b: Aabb, axis: number, at: number): boolean {
  const lo = axis === 0 ? b.min.z : b.min.x;
  const hi = axis === 0 ? b.max.z : b.max.x;
  const n = Math.max(1, Math.ceil((hi - lo) / CLIFF_BURY_SAMPLE));
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    const h = axis === 0 ? elevationSampleAt(seed, at, t).h : elevationSampleAt(seed, t, at).h;
    if (h < b.max.y) return false;
  }
  return true;
}

/**
 * Moves `b`'s uphill faces into the hill, in `CLIFF_BURY_STEP`s, until the
 * terrain along each stands at or above the box's top, or the face has moved
 * `CLIFF_BURY_MAX`. Returns whether a face stopped at the cap. Grows `b` in
 * place, and only grows it.
 */
function buryBox(seed: number, b: Aabb, sx: number, sz: number): boolean {
  const x0 = sx > 0 ? b.max.x : b.min.x;
  const z0 = sz > 0 ? b.max.z : b.min.z;
  let ex = 0, ez = 0;
  for (;;) {
    const xOk = sx === 0 || faceBuried(seed, b, 0, sx > 0 ? b.max.x : b.min.x);
    const zOk = sz === 0 || faceBuried(seed, b, 1, sz > 0 ? b.max.z : b.min.z);
    if (xOk && zOk) return false;
    let moved = false;
    if (!xOk && ex < CLIFF_BURY_MAX) {
      ex = Math.min(CLIFF_BURY_MAX, ex + CLIFF_BURY_STEP);
      if (sx > 0) b.max.x = x0 + ex; else b.min.x = x0 - ex;
      moved = true;
    }
    if (!zOk && ez < CLIFF_BURY_MAX) {
      ez = Math.min(CLIFF_BURY_MAX, ez + CLIFF_BURY_STEP);
      if (sz > 0) b.max.z = z0 + ez; else b.min.z = z0 - ez;
      moved = true;
    }
    if (!moved) return true;
  }
}

/** A module with its colliders, and how many of its boxes stopped at the
 * burial cap. */
export type CliffModuleBoxes = { m: ClutterInstance; boxes: Aabb[]; capped: number };

/**
 * A module's colliders in the world's frame, unclipped: the seated boxes
 * (`cliffSeatedBoxes`) with their uphill faces buried in the hill
 * (`buryBox`). A pure function of the world seed and the module, so every
 * chunk that finds it computes the same boxes.
 */
export function cliffModuleBoxes(seed: number, m: ClutterInstance): CliffModuleBoxes {
  const boxes = cliffSeatedBoxes(m);
  const { sx, sz } = cliffBuryFaces(m);
  let capped = 0;
  for (const b of boxes) if (buryBox(seed, b, sx, sz)) capped++;
  return { m, boxes, capped };
}

/** One cell's modules with their colliders, read cold. */
export function cliffCellBoxes(seed: number, ci: number, cj: number): readonly CliffModuleBoxes[] {
  return cliffCellRuns(seed, ci, cj).map((m) => cliffModuleBoxes(seed, m));
}

/** A cell's modules with their colliders, for `cliffBoxesInRect`: the
 * remembered ones by default, or `cliffCellBoxes` for a build that must read
 * every cell cold. */
export type CliffCellSource = (seed: number, ci: number, cj: number) => readonly CliffModuleBoxes[];

/** Cells the pass keeps, across every world and terrain variant together,
 * before it forgets them all and starts again. A chunk's gather window is
 * about 18 cells on a side and a walk adds a row or column of them per chunk
 * crossed, so this holds the neighbourhood of a long walk. */
export const CLIFF_RUN_CACHE_MAX = 32768;

/** Cells already read, by world and terrain variant, then by cell. */
const cellCache = new Map<string, Map<number, readonly CliffModuleBoxes[]>>();
let cellCacheSize = 0;
// Numeric cell key, exact for |cell index| < 2^20 — the collector's packing.
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;

/**
 * `cliffCellBoxes`, remembered. A chunk gathers every cell within
 * `CLIFF_GATHER_REACH` of it, so each cell is asked for by some forty chunks,
 * and building the level id's probe alone reads hundreds of cells at
 * start-up; burying a box reads the terrain along its face several times
 * over. The cell's modules and boxes are a pure function of the world seed,
 * the active terrain variant and the cell, so remembering them changes no
 * output: a chunk's boxes are the same whether its cells were read cold or
 * come from here (`passes/cliffs.test.ts`). The variant is part of the key
 * because `/terrain` can swap it at runtime. Nothing here is mutated after it
 * is stored; readers only read.
 */
export function cachedCliffCellBoxes(seed: number, ci: number, cj: number): readonly CliffModuleBoxes[] {
  const world = `${activeTerrainVariantName()}|${seed}`;
  let cells = cellCache.get(world);
  if (cells === undefined) {
    cells = new Map();
    cellCache.set(world, cells);
  }
  const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
  let cell = cells.get(key);
  if (cell === undefined) {
    cell = cliffCellBoxes(seed, ci, cj);
    if (cellCacheSize >= CLIFF_RUN_CACHE_MAX) {
      cellCache.clear();
      cellCacheSize = 0;
      cells = new Map();
      cellCache.set(world, cells);
    }
    cells.set(key, cell);
    cellCacheSize++;
  }
  return cell;
}

/** Forgets every remembered cell. For tests that compare a cold build with a
 * warm one. */
export function clearCliffRunCache(): void {
  cellCache.clear();
  cellCacheSize = 0;
}

/**
 * Every module with a box reaching into the rectangle (strictly — a box that
 * only touches an edge does not count), with its unclipped boxes, in a
 * canonical order: cells by row then column ascending, each run in its own
 * order along the wall.
 */
export function cliffBoxesInRect(
  seed: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  cells: CliffCellSource = cachedCliffCellBoxes,
): readonly CliffModuleBoxes[] {
  const out: CliffModuleBoxes[] = [];
  const g = CLIFF_GATHER_REACH;
  const ci0 = Math.floor((minX - g) / CLIFF_CELL), ci1 = Math.floor((maxX + g) / CLIFF_CELL);
  const cj0 = Math.floor((minZ - g) / CLIFF_CELL), cj1 = Math.floor((maxZ + g) / CLIFF_CELL);
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      for (const e of cells(seed, ci, cj)) {
        if (e.boxes.some((b) => b.max.x > minX && b.min.x < maxX && b.max.z > minZ && b.min.z < maxZ)) {
          out.push(e);
        }
      }
    }
  }
  return out;
}

/**
 * Pass 10: the cliff modules' colliders, and the level-id home of every
 * constant that steers where a module stands (`CLIFF_TUNABLES`) — a wall one
 * peer sees and another does not is a different world, so an old client
 * cannot join a new host.
 *
 * A wall straddling a chunk border is emitted by EVERY chunk it reaches into,
 * each chunk emitting its own share of each box: the box clipped to the
 * chunk's footprint. The chunk grid's broadphase surfaces only the props of
 * the chunks a query overlaps (`chunkGrid.ts`), so a box that hung over its
 * owner's border would be invisible to a query stopping short of that owner —
 * which is why the trees and boulders clamp to their chunk. They can afford
 * to lose the overhang (a trunk or boulder sits inside its chunk and loses at
 * most a sliver); a wall cannot, so instead of clamping to one chunk it is
 * split across all of them. The shares tile each box exactly, every query
 * finds the share in the chunks it overlaps, and a mover sliding along a wall
 * across a border meets two coplanar faces, which `sweepBox` resolves as one
 * (its skin keeps a sliding hull clear of the next share's edge). Emitting
 * the whole box from the chunk holding its centre would miss queries; emitting
 * it whole from every chunk would duplicate it in every query that spans the
 * border and still leave boxes hanging outside their chunk.
 *
 * The cells' runs are remembered across chunks (`cachedCliffCellRuns`), but
 * the field is pure, so a chunk's boxes still depend on nothing but the world
 * seed, the terrain variant and its own coordinates.
 */
registerPass({
  id: 10,
  name: "cliffs",
  get tunables() {
    return {
      ...CLIFF_TUNABLES,
      CLIFF_BOX_STEP,
      CLIFF_BURY_STEP,
      CLIFF_BURY_MAX,
      CLIFF_BURY_SAMPLE,
    };
  },
  run(chunk, worldSeed) {
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    for (const { boxes } of cliffBoxesInRect(worldSeed, minX, minZ, maxX, maxZ)) {
      for (const b of boxes) {
        const lx = Math.max(minX, b.min.x), hx = Math.min(maxX, b.max.x);
        const lz = Math.max(minZ, b.min.z), hz = Math.min(maxZ, b.max.z);
        if (lx >= hx || lz >= hz) continue;
        chunk.props.push({
          material: CLIFF_MATERIAL,
          box: { min: { x: lx, y: b.min.y, z: lz }, max: { x: hx, y: b.max.y, z: hz } },
        });
      }
    }
  },
});
