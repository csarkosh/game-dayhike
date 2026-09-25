import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { generateChunk, registeredPasses } from "../../../src/sim/chunk.js";
import { createChunkGrid } from "../../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../../src/sim/forestConstants.js";
import type { Aabb } from "../../../src/sim/level.js";
import type { ClutterInstance } from "../../../src/sim/clutter.js";
import { depenetrate, sweepBox } from "../../../src/sim/collision.js";
import { PLAYER_HALF } from "../../../src/sim/constants.js";
import {
  CLIFF_CELL, CLIFF_RUN_REACH, CLIFF_TUNABLES, cliffCellRuns, type CliffPoint,
} from "../../../src/sim/cliffField.js";
import {
  CLIFF_BOX_STEP, CLIFF_GATHER_REACH, CLIFF_MATERIAL, CLIFF_SOLID_REACH, cliffBoxesInRect, cliffModuleBoxes,
} from "../../../src/sim/passes/cliffs.js";
import { boxShell, seat } from "../helpers/cliffSolid.js";

/** The atmo scarp the gates are shot at, and the chunk holding it. */
const ATMO = 627994160;
const SCARP_CHUNK = { cx: -11, cz: -29 };
/** A wall on the scarp whose boxes cross the chunk border at z = −896: the
 * first module of cell (−27, −72)'s run, found by searching the scarp's
 * modules for one whose boxes reach exactly two chunks. Seven boxes, one of
 * which crosses the border, so the two chunks hold eight pieces between
 * them. */
const STRADDLE = { ci: -27, cj: -72, k: 0, a: { cx: -11, cz: -29 }, b: { cx: -11, cz: -28 } };

/** Containment is exact up to the rounding of one rotation: every lattice
 * point is a convex combination of the corners its box bounds. */
const EPS = 1e-9;

function inside(b: Aabb, x: number, y: number, z: number): boolean {
  return x >= b.min.x - EPS && x <= b.max.x + EPS
    && y >= b.min.y - EPS && y <= b.max.y + EPS
    && z >= b.min.z - EPS && z <= b.max.z + EPS;
}

/** `b` clipped to chunk (cx, cz)'s footprint, or null where it does not
 * reach into it — what the pass emits for it there. */
function clip(b: Aabb, cx: number, cz: number): Aabb | null {
  const minX = cx * CHUNK_SIZE, minZ = cz * CHUNK_SIZE;
  const lo = { x: Math.max(minX, b.min.x), y: b.min.y, z: Math.max(minZ, b.min.z) };
  const hi = { x: Math.min(minX + CHUNK_SIZE, b.max.x), y: b.max.y, z: Math.min(minZ + CHUNK_SIZE, b.max.z) };
  return lo.x < hi.x && lo.z < hi.z ? { min: lo, max: hi } : null;
}

function cliffProps(seed: number, cx: number, cz: number): Aabb[] {
  return generateChunk(seed, cx, cz).props.filter((p) => p.material === CLIFF_MATERIAL).map((p) => p.box);
}

/** `cliffCellRuns`, memoised for one world: the sweeps below ask for each
 * cell from every chunk around it. */
function memoRuns(): (seed: number, ci: number, cj: number) => readonly ClutterInstance[] {
  const cache = new Map<string, readonly ClutterInstance[]>();
  return (seed, ci, cj) => {
    const key = `${seed},${ci},${cj}`;
    let run = cache.get(key);
    if (run === undefined) {
      run = cliffCellRuns(seed, ci, cj);
      cache.set(key, run);
    }
    return run;
  };
}

describe("the cliff pass", () => {
  it("registers as pass 10, named cliffs, carrying every placement constant and the box step", () => {
    const pass = registeredPasses().find((p) => p.id === 10);
    expect(pass).toBeDefined();
    expect(pass!.name).toBe("cliffs");
    for (const [k, v] of Object.entries(CLIFF_TUNABLES)) expect(pass!.tunables[k], k).toBe(v);
    expect(pass!.tunables.CLIFF_BOX_STEP).toBe(4);
    expect(Object.keys(pass!.tunables).length).toBe(Object.keys(CLIFF_TUNABLES).length + 1);
    // Moved here, not copied: no other pass declares a placement constant.
    // (The terrain's own cliff bands declare `CLIFF_PHASE_*` and the like in
    // the elevation pass; those are a different field.)
    for (const other of registeredPasses()) {
      if (other === pass) continue;
      expect(Object.keys(other.tunables).filter((k) => k in CLIFF_TUNABLES), other.name).toEqual([]);
    }
  });

  it("emits under its own material, told apart from trunks and boulders", () => {
    expect(CLIFF_MATERIAL).toBe("cliff");
    const props = generateChunk(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz).props;
    const cliff = props.filter((p) => p.material === CLIFF_MATERIAL);
    expect(cliff.length).toBeGreaterThan(0);
    for (const p of cliff) expect(["trunk", "rock"]).not.toContain(p.material);
  });

  it("gathers from as far as a run carries a module plus the farthest its solid reaches", () => {
    expect(CLIFF_BOX_STEP).toBe(4);
    // The long model's farthest corner at the top of the scale band:
    // 1.6 · sqrt(10.55² + 7.17² + 4.39²). A rotation keeps a corner's
    // distance from the origin, so no yaw or lean carries the solid further.
    expect(CLIFF_SOLID_REACH).toBeCloseTo(21.584201629895883, 9);
    expect(CLIFF_RUN_REACH).toBeCloseTo(63.84, 9);
    expect(CLIFF_GATHER_REACH).toBeCloseTo(85.42420162989589, 9);
  });
});

describe("the colliders", () => {
  it("contain the drawn solid: every point of the model's box lies inside one of its module's boxes", () => {
    // The lattice §11's residual was swept on (`cliffField.test.ts`),
    // extended from the sink line down to the model's base: the faces of
    // each module's whole drawn box at 1 m, the buried part included, seated
    // as the renderer seats it, over every module within 400 m of the origin
    // on 200 worlds. The lean drops the front of the base below the sunk
    // origin, where the downhill ground can lie lower still, so the part the
    // sink was meant to bury can stand in the open. Each point must lie
    // inside one of the module's own boxes, in all three axes, so nothing
    // drawn stands outside what collides.
    const WORLDS = 200;
    const r = 400;
    const w = r + CLIFF_RUN_REACH;
    const p: CliffPoint = { x: 0, y: 0, z: 0 };
    let modules = 0, points = 0, boxes = 0, outside = 0;
    for (let seed = 1; seed <= WORLDS; seed++) {
      for (let cj = Math.floor(-w / CLIFF_CELL); cj <= Math.floor(w / CLIFF_CELL); cj++) {
        for (let ci = Math.floor(-w / CLIFF_CELL); ci <= Math.floor(w / CLIFF_CELL); ci++) {
          for (const m of cliffCellRuns(seed, ci, cj)) {
            if (Math.hypot(m.x, m.z) >= r) continue;
            modules++;
            const own = cliffModuleBoxes(m);
            boxes += own.length;
            for (const [lx, ly, lz] of boxShell(m.variant, m.scale, 1, 0)) {
              seat(m, lx, ly, lz, p);
              points++;
              const x = m.x + p.x, y = m.groundH + p.y, z = m.z + p.z;
              if (!own.some((b) => inside(b, x, y, z))) outside++;
            }
          }
        }
      }
    }
    expect(outside).toBe(0);
    expect(modules).toBe(206);
    expect(points).toBe(106996);
    expect(boxes).toBe(834);
  }, 300_000);

  it("lays a wall straddling a chunk border into both chunks, each its own clipped share", () => {
    const m = cliffCellRuns(ATMO, STRADDLE.ci, STRADDLE.cj)[STRADDLE.k]!;
    const own = cliffModuleBoxes(m);
    expect(own.length).toBe(7);
    const shares: Aabb[][] = [];
    for (const c of [STRADDLE.a, STRADDLE.b]) {
      const share = own.map((b) => clip(b, c.cx, c.cz)).filter((b): b is Aabb => b !== null);
      const props = cliffProps(ATMO, c.cx, c.cz);
      for (const b of share) expect(props).toContainEqual(b);
      shares.push(share);
    }
    expect(shares.map((s) => s.length)).toEqual([5, 3]);
    // Exactly one box crosses the border and is clipped into both chunks.
    const shared = own.filter((b) => clip(b, STRADDLE.a.cx, STRADDLE.a.cz) !== null
      && clip(b, STRADDLE.b.cx, STRADDLE.b.cz) !== null);
    expect(shared.length).toBe(1);
    // Between them the two shares are the whole of every box: the clipped
    // footprints' areas add up to each box's own.
    for (const b of own) {
      const area = (x: Aabb): number => (x.max.x - x.min.x) * (x.max.z - x.min.z);
      let sum = 0;
      for (const c of [STRADDLE.a, STRADDLE.b]) {
        const piece = clip(b, c.cx, c.cz);
        if (piece !== null) sum += area(piece);
      }
      expect(Math.abs(sum - area(b))).toBeLessThan(1e-9);
    }
  }, 60_000);

  it("finds the same boxes for a module from whichever chunk finds it, and builds a chunk the same way twice", () => {
    const m = cliffCellRuns(ATMO, STRADDLE.ci, STRADDLE.cj)[STRADDLE.k]!;
    const from = [STRADDLE.a, STRADDLE.b].map((c) => {
      const minX = c.cx * CHUNK_SIZE, minZ = c.cz * CHUNK_SIZE;
      const found = cliffBoxesInRect(ATMO, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE)
        .find((e) => e.m.x === m.x && e.m.z === m.z);
      expect(found).toBeDefined();
      return found!.boxes;
    });
    expect(from[0]).toEqual(from[1]);
    expect(from[0]).toEqual(cliffModuleBoxes(m));
    // Two builds of the chunk, the second on a grid that has walked other
    // chunks first: the same boxes, in the same order.
    const first = cliffProps(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz);
    const grid = createChunkGrid(ATMO);
    for (let i = -2; i <= 2; i++) grid.chunkAt(SCARP_CHUNK.cx + i, SCARP_CHUNK.cz - 3);
    const second = grid.chunkAt(SCARP_CHUNK.cx, SCARP_CHUNK.cz).props
      .filter((p) => p.material === CLIFF_MATERIAL).map((p) => p.box);
    expect(second).toEqual(first);
  }, 60_000);
});

describe("a wall stops a hiker", () => {
  // Box 2 of the straddling wall, approached along +x toward its −x face —
  // the downhill face the wall looks out of — which stands clear of the
  // wall's other boxes and of every other prop.
  function target(): Aabb {
    const m = cliffCellRuns(ATMO, STRADDLE.ci, STRADDLE.cj)[STRADDLE.k]!;
    return cliffModuleBoxes(m)[2]!;
  }

  it("sweepBox of a hiker's half-extents into the wall stops at the box", () => {
    const b = target();
    const grid = createChunkGrid(ATMO);
    // One metre off the face, at mid-height, moving three metres into it.
    const start = { x: b.min.x - PLAYER_HALF.x - 1, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
    expect(depenetrate(start, PLAYER_HALF, grid)).toEqual(start);
    const hit = sweepBox(start, PLAYER_HALF, { x: 3, y: 0, z: 0 }, grid);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(0.3333333333333333, 12);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
    // Where the sweep stops, the hull touches the face and goes no further.
    expect(start.x + 3 * hit!.t + PLAYER_HALF.x).toBeLessThanOrEqual(b.min.x + 1e-9);
  });

  it("depenetrate pushes a hiker out of the wall", () => {
    const b = target();
    const grid = createChunkGrid(ATMO);
    // Three centimetres into the face.
    const inside = { x: b.min.x - PLAYER_HALF.x + 0.03, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
    const out = depenetrate(inside, PLAYER_HALF, grid);
    expect(out.x + PLAYER_HALF.x).toBeLessThanOrEqual(b.min.x + 1e-9);
    expect(inside.x - out.x).toBeCloseTo(0.03, 9);
    expect(out.y).toBe(inside.y);
    expect(out.z).toBe(inside.z);
  });
});

describe("what the colliders cost", () => {
  it("pins the boxes per chunk on the scarp and at the census worlds' worst chunks", () => {
    expect(cliffProps(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz).length).toBe(66);
    // The chunk with the most boxes on each census world's worst 400 m disc,
    // counted as the pass counts them (a box reaching into two chunks counts
    // in each).
    const worst: [number, string][] = [];
    for (const [seed, x, z] of [[ATMO, -200, -1000], [388817, -100, -500], [1, 1100, -1200]] as const) {
      const runs = memoRuns();
      let most = 0, at = "";
      for (let cz = Math.floor((z - 400) / CHUNK_SIZE); cz <= Math.floor((z + 400) / CHUNK_SIZE); cz++) {
        for (let cx = Math.floor((x - 400) / CHUNK_SIZE); cx <= Math.floor((x + 400) / CHUNK_SIZE); cx++) {
          const minX = cx * CHUNK_SIZE, minZ = cz * CHUNK_SIZE;
          let n = 0;
          for (const { boxes } of cliffBoxesInRect(seed, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE, runs)) {
            for (const b of boxes) if (clip(b, cx, cz) !== null) n++;
          }
          if (n > most) { most = n; at = `${cx},${cz}`; }
        }
      }
      worst.push([most, at]);
    }
    expect(worst).toEqual([[87, "-10,-27"], [36, "-6,-21"], [69, "39,-40"]]);
  }, 300_000);
});
