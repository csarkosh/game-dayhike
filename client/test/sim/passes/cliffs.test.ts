import { describe, expect, it } from "vitest";
import "../../../src/sim/passes/index.js";
import { generateChunk, registeredPasses } from "../../../src/sim/chunk.js";
import { createChunkGrid } from "../../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../../src/sim/forestConstants.js";
import type { Aabb } from "../../../src/sim/level.js";
import { depenetrate, sweepBox } from "../../../src/sim/collision.js";
import { GROUND_NORMAL_Y, PLAYER_HALF } from "../../../src/sim/constants.js";
import { createForest } from "../../../src/sim/forest.js";
import { elevationSampleAt } from "../../../src/sim/terrain.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../../src/sim/world.js";
import { Button } from "../../../src/sim/types.js";
import {
  CLIFF_CELL, CLIFF_RUN_REACH, CLIFF_TUNABLES, cliffCellRuns, type CliffPoint,
} from "../../../src/sim/cliffField.js";
import {
  CLIFF_BOX_STEP, CLIFF_BURY_MAX, CLIFF_BURY_SAMPLE, CLIFF_BURY_STEP, CLIFF_GATHER_REACH, CLIFF_MATERIAL,
  CLIFF_SOLID_REACH, cliffBoxesInRect, cliffBuryFaces, cliffCellBoxes, cliffModuleBoxes, clearCliffRunCache,
} from "../../../src/sim/passes/cliffs.js";
import { drawnShell, seat } from "../helpers/cliffSolid.js";

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

/** How far below a box's top the terrain along its uphill face may read
 * and still count as burying it. The pass reads the terrain at most
 * `CLIFF_BURY_SAMPLE` apart and moves the face until every reading is at or
 * above the top; this test reads four times as densely, so between the
 * pass's readings a curving hillside could dip a little. Measured over 40
 * worlds at this density: it never dips at all. 5 cm is far below anything a
 * hull could stand in. */
const CLIFF_BURY_TOLERANCE = 0.05;

/** The seven places behind the scarp's walls where a hiker came to rest and
 * could not leave, before the uphill faces were buried: the hull's centre,
 * recorded by the host tick at rest. */
const TRAPS: readonly (readonly [number, number, number])[] = [
  [-300.892, 148.694, -988.027],
  [-301.959, 145.486, -960.263],
  [-334.771, 83.547, -932.77],
  [-276.284, 156.061, -892.85],
  [-290.154, 144.904, -907.654],
  [-277.303, 142.415, -862.982],
  [-305.224, 77.727, -823.56],
];

/** The host's own tick on the atmo world with one hiker: `run` puts the
 * hull at a point (on the ground there when no height is given), gives it
 * one input for `ticks` ticks, and returns the hull centre and whether it is
 * grounded after each. */
function hikerOn(seed: number): (
  start: readonly [number, number | null, number], yaw: number, moveZ: number, ticks: number, buttons?: number,
) => [number, number, number, boolean][] {
  const world = createForestWorld(createForest(seed), true);
  const p = spawnPlayer(world);
  return (start, yaw, moveZ, ticks, buttons = 0) => {
    const [x, y, z] = start;
    p.pos = { x, y: y ?? elevationSampleAt(seed, x, z).h + PLAYER_HALF.y + 0.05, z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.grounded = false;
    const out: [number, number, number, boolean][] = [];
    for (let i = 0; i < ticks; i++) {
      tickWorld(world, new Map([[p.id, { seq: i + 1, moveX: 0, moveZ, yaw, pitch: 0, buttons }]]));
      out.push([p.pos.x, p.pos.y, p.pos.z, p.grounded]);
    }
    return out;
  };
}

/** Whether a hull centred at (x, y, z) stands on a box's top: its feet
 * within 5 cm of the top and its footprint over the box. */
function onTop(boxes: readonly Aabb[], x: number, y: number, z: number): boolean {
  return boxes.some((b) => Math.abs(y - PLAYER_HALF.y - b.max.y) < 0.05
    && x + PLAYER_HALF.x > b.min.x && x - PLAYER_HALF.x < b.max.x
    && z + PLAYER_HALF.z > b.min.z && z - PLAYER_HALF.z < b.max.z);
}

describe("the cliff pass", () => {
  it("registers as pass 10, named cliffs, carrying every placement constant and the box step", () => {
    const pass = registeredPasses().find((p) => p.id === 10);
    expect(pass).toBeDefined();
    expect(pass!.name).toBe("cliffs");
    for (const [k, v] of Object.entries(CLIFF_TUNABLES)) expect(pass!.tunables[k], k).toBe(v);
    expect(pass!.tunables.CLIFF_BOX_STEP).toBe(4);
    expect(pass!.tunables.CLIFF_BURY_STEP).toBe(1);
    expect(pass!.tunables.CLIFF_BURY_MAX).toBe(16);
    expect(pass!.tunables.CLIFF_BURY_SAMPLE).toBe(1);
    expect(Object.keys(pass!.tunables).length).toBe(Object.keys(CLIFF_TUNABLES).length + 4);
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
    // And the furthest a box's uphill face is moved into the hill.
    expect(CLIFF_BURY_STEP).toBe(1);
    expect(CLIFF_BURY_SAMPLE).toBe(1);
    expect(CLIFF_BURY_MAX).toBe(16);
    expect(CLIFF_GATHER_REACH).toBeCloseTo(101.42420162989589, 9);
  });
});

describe("the colliders", () => {
  it("contain the drawn solid, and bury their uphill faces in the hill, over the 200-world sweep", () => {
    // The lattice §11's residual was swept on (`cliffField.test.ts`),
    // extended from the sink line down to the model's base (which sits a
    // little below its origin, `CLIFF_MODEL_BASE`) and up to its true top:
    // the faces of each module's whole drawn box at 1 m, the buried part
    // included, seated as the renderer seats it, over every module within
    // 400 m of the origin on 200 worlds. The lean drops the front of the
    // base below the sunk origin, where the downhill ground can lie lower
    // still, so the part the sink was meant to bury can stand in the open.
    // Each point must lie inside one of the module's own boxes, in all three
    // axes, so nothing drawn stands outside what collides.
    //
    // The same sweep holds the burial (§12.5 of the design): along every
    // box's uphill face, read every quarter metre, the hillside stands at or
    // above the box's top, less CLIFF_BURY_TOLERANCE — except where the face
    // stopped at CLIFF_BURY_MAX, which is counted.
    const WORLDS = 200;
    const r = 400;
    const w = r + CLIFF_RUN_REACH;
    const p: CliffPoint = { x: 0, y: 0, z: 0 };
    let modules = 0, points = 0, boxes = 0, outside = 0, capped = 0, faceReads = 0, exposed = 0;
    for (let seed = 1; seed <= WORLDS; seed++) {
      for (let cj = Math.floor(-w / CLIFF_CELL); cj <= Math.floor(w / CLIFF_CELL); cj++) {
        for (let ci = Math.floor(-w / CLIFF_CELL); ci <= Math.floor(w / CLIFF_CELL); ci++) {
          for (const m of cliffCellRuns(seed, ci, cj)) {
            if (Math.hypot(m.x, m.z) >= r) continue;
            modules++;
            const built = cliffModuleBoxes(seed, m);
            const own = built.boxes;
            boxes += own.length;
            capped += built.capped;
            const { sx, sz } = cliffBuryFaces(m);
            for (const b of own) {
              const lo = sx !== 0 ? b.min.z : b.min.x, hi = sx !== 0 ? b.max.z : b.max.x;
              const at = sx > 0 ? b.max.x : sx < 0 ? b.min.x : sz > 0 ? b.max.z : b.min.z;
              const n = Math.ceil((hi - lo) / 0.25);
              for (let i = 0; i <= n; i++) {
                const t = lo + ((hi - lo) * i) / n;
                const h = sx !== 0 ? elevationSampleAt(seed, at, t).h : elevationSampleAt(seed, t, at).h;
                faceReads++;
                if (h < b.max.y - CLIFF_BURY_TOLERANCE) exposed++;
              }
            }
            for (const [lx, ly, lz] of drawnShell(m.variant, m.scale, 1)) {
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
    expect(capped).toBe(0);
    expect(exposed).toBe(0);
    expect(faceReads).toBe(21975);
  }, 300_000);

  it("lays a wall straddling a chunk border into both chunks, each its own clipped share", () => {
    const m = cliffCellRuns(ATMO, STRADDLE.ci, STRADDLE.cj)[STRADDLE.k]!;
    const own = cliffModuleBoxes(ATMO, m).boxes;
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
    expect(from[0]).toEqual(cliffModuleBoxes(ATMO, m).boxes);
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

describe("the remembered runs", () => {
  it("change no output: a chunk built cold, warm, and from the field directly is the same", () => {
    clearCliffRunCache();
    const cold = cliffProps(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz);
    // Warm: every cell the chunk gathers is remembered now, and so are the
    // neighbours' shared cells when they are built.
    const warm = cliffProps(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz);
    expect(warm).toEqual(cold);
    // Built by another world in between, then back: the worlds are kept
    // apart.
    cliffProps(ATMO + 1, SCARP_CHUNK.cx, SCARP_CHUNK.cz);
    expect(cliffProps(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz)).toEqual(cold);
    // And the same modules as reading every cell afresh.
    const minX = SCARP_CHUNK.cx * CHUNK_SIZE, minZ = SCARP_CHUNK.cz * CHUNK_SIZE;
    const fresh = cliffBoxesInRect(ATMO, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE, cliffCellBoxes);
    const cached = cliffBoxesInRect(ATMO, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE);
    expect(cached).toEqual(fresh);
    expect(cold.length).toBe(65);
  }, 60_000);
});

describe("a wall stops a hiker", () => {
  // Box 2 of the straddling wall, approached along +x toward its −x face —
  // the downhill face the wall looks out of — which stands clear of the
  // wall's other boxes and of every other prop.
  function target(): Aabb {
    const m = cliffCellRuns(ATMO, STRADDLE.ci, STRADDLE.cj)[STRADDLE.k]!;
    return cliffModuleBoxes(ATMO, m).boxes[2]!;
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

describe("a hiker behind a wall", () => {
  // Before the uphill faces were buried, a hiker sliding down behind a wall
  // could come to rest in the V between the hillside and the box's back
  // face: the ground there is too steep to stand on, so the hull is never
  // grounded and cannot jump; air control alone cannot climb; and the face
  // cancels the slide. At these seven points five seconds of walking,
  // jumping or sprinting in any of eight directions moved the hull less
  // than 0.35 m. With the faces buried, the hillside meets each box at its
  // top, so the slide lands on the top instead.
  it("is not trapped at the seven points: the hull lands on a box top, and walks off it", () => {
    const run = hikerOn(ATMO);
    const boxes = cliffBoxesInRect(ATMO, -400, -1050, -220, -780).flatMap((e) => e.boxes);
    const results: string[] = [];
    for (const t of TRAPS) {
      const idle = run([t[0], t[1], t[2]], 0, 0, 300);
      const [x, y, z] = idle[299]!;
      const moved = Math.hypot(x - t[0], z - t[2]);
      const top = onTop(boxes, x, y, z);
      // From wherever it came to rest, the best of eight directions,
      // walking, jumping and sprinting, for five seconds each.
      let best = 0;
      for (let k = 0; k < 8; k++) {
        for (const buttons of [0, Button.Jump, Button.Sprint]) {
          const end = run([x, y, z], (k * Math.PI) / 4, 1, 300, buttons)[299]!;
          best = Math.max(best, Math.hypot(end[0] - x, end[2] - z));
        }
      }
      expect(top || moved > 2, `${t.join(",")} rested at ${x},${y},${z}`).toBe(true);
      expect(best, `${t.join(",")}`).toBeGreaterThan(2);
      results.push(top ? "top" : "slid");
    }
    expect(results).toEqual(["top", "top", "top", "top", "top", "top", "top"]);
  }, 300_000);

  it("slides onto a top or away, never into a trap: the gate's slide census at the scarp", () => {
    // The census the trap was found in: every box piece of every module
    // within 90 m of the scarp, a hiker set down 3 m uphill of the piece
    // (skipping starts within 0.6 m of any box) with no input for five
    // seconds. Each rest that is neither on a top nor still sliding is then
    // tried for escape as above. Before the burial: 131 starts, 117 on a
    // top, 12 at rest elsewhere, 2 sliding, and 6 of the 12 could not leave.
    const run = hikerOn(ATMO);
    const cx = -336, cz = -900, R = 90;
    const found = cliffBoxesInRect(ATMO, cx - R - 30, cz - R - 30, cx + R + 30, cz + R + 30);
    const all = found.flatMap((e) => e.boxes);
    const dist = (x: number, z: number, b: Aabb): number =>
      Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));
    let starts = 0, top = 0, still = 0, sliding = 0, trapped = 0;
    const rests: [number, number, number][] = [];
    for (const { m, boxes } of found) {
      if (Math.hypot(m.x - cx, m.z - cz) >= R) continue;
      const g = Math.hypot(m.groundDx, m.groundDz);
      const ux = m.groundDx / g, uz = m.groundDz / g;
      for (const b of boxes) {
        const mx = (b.min.x + b.max.x) / 2, mz = (b.min.z + b.max.z) / 2;
        let t = 0;
        while (dist(mx + ux * t, mz + uz * t, b) === 0 && t < 60) t += 0.25;
        const sx = mx + ux * (t + 3), sz = mz + uz * (t + 3);
        if (all.some((bb) => dist(sx, sz, bb) < 0.6)) continue;
        starts++;
        const tr = run([sx, null, sz], Math.atan2(-ux, -uz), 0, 300);
        const [x, y, z] = tr[299]!;
        const [px, py, pz] = tr[239]!;
        if (onTop(all, x, y, z)) top++;
        else if (Math.hypot(x - px, y - py, z - pz) < 0.05) { still++; rests.push([x, y, z]); }
        else sliding++;
      }
    }
    for (const [x, y, z] of rests) {
      let best = 0;
      for (let k = 0; k < 8; k++) {
        for (const buttons of [0, Button.Jump, Button.Sprint]) {
          const end = run([x, y, z], (k * Math.PI) / 4, 1, 300, buttons)[299]!;
          best = Math.max(best, Math.hypot(end[0] - x, end[2] - z));
        }
      }
      if (best < 1) trapped++;
    }
    expect({ starts, top, still, sliding, trapped }).toEqual({ starts: 119, top: 115, still: 4, sliding: 0, trapped: 0 });
  }, 300_000);
});

describe("a hiker along a wall's top", () => {
  // The gate's crest walk: from a rest on the top of a crest run at the
  // scarp, walking along the contour for ten seconds. Two things showed as
  // jitter there.
  //
  // The first was the ground's stick. It snapped the grounded hull down
  // onto the hillside where that passes a few centimetres under a box's top,
  // inside the box, and the next tick's depenetrate lifted it back out: the
  // hull went up to 0.107 m inside a box. The stick now stands the hull on
  // the higher of the hillside and the box top under it.
  //
  // The second is not a box at all. After about 2.7 s the walk is blocked by
  // the front of a higher wall, and the hull, pressed into the corner
  // between that face and hillside too steep to stand on, steps onto the
  // hillside, loses its footing and slides back, every few ticks, in a patch
  // a few centimetres across. It is the stand limit's own dither, and it does
  // the same wherever a hiker walks into ground too steep to stand on, with
  // no box in sight: at the bench at the scarp's foot, 118 reversals in ten
  // seconds within 5 cm. So it is counted apart, and bounded, not zeroed.
  it("walks along a crest run's top without sinking into a box, and dithers only where it is blocked", () => {
    const run = hikerOn(ATMO);
    const boxes = cliffBoxesInRect(ATMO, -500, -1100, -200, -700).flatMap((e) => e.boxes);
    const g = [1.54, -0.577] as const;
    const gl = Math.hypot(g[0], g[1]);
    const ux = g[0] / gl, uz = g[1] / gl;
    const tx = -uz, tz = ux;
    const yaw = Math.atan2(tx, tz);
    const [x0, y0, z0] = run([-289.34, 142.903, -900.898], yaw, 0, 60)[59]!;
    const tr = run([x0, y0, z0], yaw, 1, 600);
    let walking = 0, blocked = 0, lastPerp = 0, along = 0, deepest = 0, stopped = -1;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1]!, b = tr[i]!;
      const vx = (b[0] - a[0]) * 60, vz = (b[2] - a[2]) * 60;
      const perp = vx * ux + vz * uz;
      const reversed = i > 30 && Math.abs(perp) > 0.3 && lastPerp !== 0 && Math.sign(perp) !== Math.sign(lastPerp);
      if (Math.abs(perp) > 0.3) lastPerp = perp;
      if (stopped < 0 && i > 30 && Math.abs(vx * tx + vz * tz) <= 1) stopped = i;
      if (reversed) {
        if (stopped < 0) walking++;
        else blocked++;
      }
      if (stopped >= 0) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, b[k] as number);
          hi[k] = Math.max(hi[k]!, b[k] as number);
        }
      }
      along += (b[0] - a[0]) * tx + (b[2] - a[2]) * tz;
      for (const bx of boxes) {
        const ox = Math.min(b[0] + PLAYER_HALF.x, bx.max.x) - Math.max(b[0] - PLAYER_HALF.x, bx.min.x);
        const oy = Math.min(b[1] + PLAYER_HALF.y, bx.max.y) - Math.max(b[1] - PLAYER_HALF.y, bx.min.y);
        const oz = Math.min(b[2] + PLAYER_HALF.z, bx.max.z) - Math.max(b[2] - PLAYER_HALF.z, bx.min.z);
        if (ox > 0 && oy > 0 && oz > 0) deepest = Math.max(deepest, Math.min(ox, oy, oz));
      }
    }
    // Inside a box by no more than a millimetre: the skin the sweeps keep,
    // and float error, but never the stick's snap (0.107 m before).
    expect(deepest).toBeLessThan(0.001);
    expect({ walking, blocked, stopped }).toEqual({ walking: 3, blocked: 96, stopped: 160 });
    // Where it is blocked, the hull stays within a few centimetres on every
    // axis.
    const span = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
    expect(span).toBeLessThan(0.1);
    expect(along).toBeCloseTo(13.018, 2);
  }, 60_000);
});

describe("what the colliders claim", () => {
  it("stand over walkable ground rarely: 40 worlds, counted with and without the buried volume", () => {
    // Every metre cell under a box's footprint, over every module within
    // 400 m of the origin on 40 worlds. `walkable` counts the cells whose
    // ground a foot holds; `standing` counts the ones among them where some
    // box's top stands above that ground — a collider in the open where a
    // hiker walks. The second is the one that matters: burying a box's
    // uphill face pushes its footprint back under the hill, and where that
    // reaches walkable ground above a crest the box is below the ground there,
    // which no hiker meets. Before the burial: 17 standing cells in 4
    // modules.
    const r = 400, w = r + CLIFF_RUN_REACH;
    let modules = 0, walkable = 0, standing = 0, modulesStanding = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let cj = Math.floor(-w / CLIFF_CELL); cj <= Math.floor(w / CLIFF_CELL); cj++) {
        for (let ci = Math.floor(-w / CLIFF_CELL); ci <= Math.floor(w / CLIFF_CELL); ci++) {
          for (const m of cliffCellRuns(seed, ci, cj)) {
            if (Math.hypot(m.x, m.z) >= r) continue;
            modules++;
            const { boxes } = cliffModuleBoxes(seed, m);
            const tops = new Map<string, number>();
            for (const b of boxes) {
              for (let x = Math.ceil(b.min.x); x <= b.max.x; x++) {
                for (let z = Math.ceil(b.min.z); z <= b.max.z; z++) {
                  const k = `${x},${z}`;
                  tops.set(k, Math.max(tops.get(k) ?? -Infinity, b.max.y));
                }
              }
            }
            let stands = false;
            for (const [k, top] of tops) {
              const [x, z] = k.split(",").map(Number) as [number, number];
              const s = elevationSampleAt(seed, x, z);
              if (1 / Math.sqrt(1 + s.dx * s.dx + s.dz * s.dz) < GROUND_NORMAL_Y) continue;
              walkable++;
              if (s.h < top) { standing++; stands = true; }
            }
            if (stands) modulesStanding++;
          }
        }
      }
    }
    expect({ modules, walkable, standing, modulesStanding }).toEqual({ modules: 84, walkable: 305, standing: 40, modulesStanding: 9 });
  }, 300_000);
});

describe("what the colliders cost", () => {
  it("pins the boxes per chunk on the scarp and at the census worlds' worst chunks", () => {
    expect(cliffProps(ATMO, SCARP_CHUNK.cx, SCARP_CHUNK.cz).length).toBe(65);
    // The chunk with the most boxes on each census world's worst 400 m disc,
    // counted as the pass counts them (a box reaching into two chunks counts
    // in each).
    const worst: [number, string][] = [];
    for (const [seed, x, z] of [[ATMO, -200, -1000], [388817, -100, -500], [1, 1100, -1200]] as const) {
      let most = 0, at = "";
      for (let cz = Math.floor((z - 400) / CHUNK_SIZE); cz <= Math.floor((z + 400) / CHUNK_SIZE); cz++) {
        for (let cx = Math.floor((x - 400) / CHUNK_SIZE); cx <= Math.floor((x + 400) / CHUNK_SIZE); cx++) {
          const minX = cx * CHUNK_SIZE, minZ = cz * CHUNK_SIZE;
          let n = 0;
          for (const { boxes } of cliffBoxesInRect(seed, minX, minZ, minX + CHUNK_SIZE, minZ + CHUNK_SIZE)) {
            for (const b of boxes) if (clip(b, cx, cz) !== null) n++;
          }
          if (n > most) { most = n; at = `${cx},${cz}`; }
        }
      }
      worst.push([most, at]);
    }
    expect(worst).toEqual([[88, "-10,-27"], [36, "-6,-21"], [68, "39,-40"]]);
  }, 300_000);
});
