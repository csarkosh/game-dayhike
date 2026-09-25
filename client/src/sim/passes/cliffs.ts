import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import type { Aabb } from "../level.js";
import type { ClutterInstance } from "../clutter.js";
import { activeTerrainVariantName } from "../terrain.js";
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
 */

/** Longest piece of a module's width (m) that one box covers. */
export const CLIFF_BOX_STEP = 4;

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
 * lay a module whose solid reaches into the region: as far as a run carries
 * a module's origin (`CLIFF_RUN_REACH`), plus the farthest the module's solid
 * reaches from that origin (`CLIFF_SOLID_REACH`). A cell's point lies inside
 * its own cell, so walking every cell that meets the region grown by this
 * much finds every such module. */
export const CLIFF_GATHER_REACH = CLIFF_RUN_REACH + CLIFF_SOLID_REACH;

const corner: CliffPoint = { x: 0, y: 0, z: 0 };

/**
 * A module's colliders in the world's frame, unclipped: one box per piece of
 * its width, in order along the width from `−(W − R)` to `+R`. A pure
 * function of the module, so every chunk that finds it computes the same
 * boxes.
 */
export function cliffModuleBoxes(m: ClutterInstance): Aabb[] {
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

/** A cell's run, for `cliffBoxesInRect`: the remembered field by default,
 * or `cliffCellRuns` itself for a build that must read every cell cold. */
export type CliffRunSource = (seed: number, ci: number, cj: number) => readonly ClutterInstance[];

/** Cells whose runs the pass keeps, across every world and terrain variant
 * together, before it forgets them all and starts again. A chunk's gather
 * window is about 17 cells on a side and a walk adds a row or column of them
 * per chunk crossed, so this holds the neighbourhood of a long walk. */
export const CLIFF_RUN_CACHE_MAX = 32768;

/** Runs already read, by world and terrain variant, then by cell. */
const runCache = new Map<string, Map<number, readonly ClutterInstance[]>>();
let runCacheSize = 0;
// Numeric cell key, exact for |cell index| < 2^20 — the collector's packing.
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;

/**
 * `cliffCellRuns`, remembered. A chunk gathers every cell within
 * `CLIFF_GATHER_REACH` of it — a window about 203 m across for a 32 m chunk —
 * so each cell's run is asked for by some forty chunks, and building the
 * level id's probe alone reads hundreds of cells at start-up. The field is a
 * pure function of the world seed, the active terrain variant and the cell,
 * so remembering it changes no output: a chunk's boxes are the same whether
 * its cells were read cold or come from here (`passes/cliffs.test.ts`). The
 * variant is part of the key because `/terrain` can swap it at runtime.
 * Nothing here is mutated after it is stored; readers only read.
 */
export function cachedCliffCellRuns(seed: number, ci: number, cj: number): readonly ClutterInstance[] {
  const world = `${activeTerrainVariantName()}|${seed}`;
  let cells = runCache.get(world);
  if (cells === undefined) {
    cells = new Map();
    runCache.set(world, cells);
  }
  const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
  let run = cells.get(key);
  if (run === undefined) {
    run = cliffCellRuns(seed, ci, cj);
    if (runCacheSize >= CLIFF_RUN_CACHE_MAX) {
      runCache.clear();
      runCacheSize = 0;
      cells = new Map();
      runCache.set(world, cells);
    }
    cells.set(key, run);
    runCacheSize++;
  }
  return run;
}

/** Forgets every remembered run. For tests that compare a cold build with a
 * warm one. */
export function clearCliffRunCache(): void {
  runCache.clear();
  runCacheSize = 0;
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
  runs: CliffRunSource = cachedCliffCellRuns,
): { m: ClutterInstance; boxes: Aabb[] }[] {
  const out: { m: ClutterInstance; boxes: Aabb[] }[] = [];
  const g = CLIFF_GATHER_REACH;
  const ci0 = Math.floor((minX - g) / CLIFF_CELL), ci1 = Math.floor((maxX + g) / CLIFF_CELL);
  const cj0 = Math.floor((minZ - g) / CLIFF_CELL), cj1 = Math.floor((maxZ + g) / CLIFF_CELL);
  for (let cj = cj0; cj <= cj1; cj++) {
    for (let ci = ci0; ci <= ci1; ci++) {
      for (const m of runs(seed, ci, cj)) {
        const boxes = cliffModuleBoxes(m);
        if (boxes.some((b) => b.max.x > minX && b.min.x < maxX && b.max.z > minZ && b.min.z < maxZ)) {
          out.push({ m, boxes });
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
    return { ...CLIFF_TUNABLES, CLIFF_BOX_STEP };
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
