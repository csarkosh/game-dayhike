import { describe, it, expect } from "vitest";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "../../src/sim/passes/index.js";
import { GROUND_NORMAL_Y } from "../../src/sim/constants.js";
import { groundCover, rockSlopeBand, type ClutterInstance } from "../../src/sim/clutter.js";
import { hash3 } from "../../src/sim/field.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import {
  CLIFF_CELL, CLIFF_MODEL_WIDTH, CLIFF_RUN_REACH, CLIFF_TILT_MAX, CLIFF_WALL_A, CLIFF_WALL_B,
  cliffCellPoint, cliffCellRuns, cliffFacing, leanPoint, type CliffPoint,
} from "../../src/sim/cliffField.js";
import {
  CLIFF_BUDGET, CLIFF_PAD, CLIFF_RINGS, cliffBands, cliffOrigin, collectCliffs, createCliffCollector,
} from "../../src/game/cliffField.js";
import { cliffSeat } from "../../src/game/cliffMeshes.js";
import { seatOnGroundCapped } from "../../src/game/groundTilt.js";
import { classifySurface } from "../../src/game/terrainSurface.js";

/** Seed 1's worst 400 m disc for steep rock (5,549 four-metre cells), from
 * the census in the design's §5. */
const WORST = { seed: 1, x: 1100, z: -1200 };
/** A disc with modules inside it that a run carried in from a cell outside
 * it: the fixture for the collector's collar. */
const COLLAR = { seed: 627994160, x: -200, z: -1000 };

type Placed = { m: ClutterInstance; ci: number; cj: number };

/** Every module whose origin lies within `r` of (x, z), with its cell,
 * walking cells a generous 100 m past what `CLIFF_RUN_REACH` claims so the
 * brute force does not rest on the claim it is checking. */
function modulesIn(seed: number, x: number, z: number, r: number): Placed[] {
  const out: Placed[] = [];
  const w = r + CLIFF_RUN_REACH + 100;
  for (let cj = Math.floor((z - w) / CLIFF_CELL); cj <= Math.floor((z + w) / CLIFF_CELL); cj++) {
    for (let ci = Math.floor((x - w) / CLIFF_CELL); ci <= Math.floor((x + w) / CLIFF_CELL); ci++) {
      for (const m of cliffCellRuns(seed, ci, cj)) {
        if (Math.hypot(m.x - x, m.z - z) < r) out.push({ m, ci, cj });
      }
    }
  }
  return out;
}

describe("collectCliffs and the collector", () => {
  it("returns every module within reach plus the pad of the snapped origin, nearest first", () => {
    const reach = CLIFF_RINGS.high[2];
    const o = cliffOrigin(WORST.x, WORST.z);
    const got = collectCliffs(WORST.seed, WORST.x, WORST.z, reach);
    const want = modulesIn(WORST.seed, o.x, o.z, reach + CLIFF_PAD);
    expect(new Set(got)).toEqual(new Set(want.map((p) => p.m)));
    expect(got.length).toBe(want.length);
    for (let i = 1; i < got.length; i++) {
      const a = got[i - 1]!, b = got[i]!;
      expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeLessThanOrEqual(Math.hypot(b.x - o.x, b.z - o.z) + 1e-9);
    }
    expect(got.length).toBe(78);
    expect(got.length).toBeLessThanOrEqual(CLIFF_BUDGET);
  }, 300_000);

  it("collects the modules a run carries into the disc from a cell beyond it", () => {
    // The collar's reason: modules inside the disc whose own cell's point is
    // outside it, laid there by a run from beyond the edge. A walk padded by
    // the cell diagonal alone would have missed every one — they would pop in
    // only once the eye walked toward their home cell. Measured on this disc.
    const reach = CLIFF_RINGS.high[2];
    const o = cliffOrigin(COLLAR.x, COLLAR.z);
    const key = (m: ClutterInstance): string => `${m.x},${m.z},${m.variant},${m.scale}`;
    const got = new Set(collectCliffs(COLLAR.seed, COLLAR.x, COLLAR.z, reach).map(key));
    const fromOutside = modulesIn(COLLAR.seed, o.x, o.z, reach + CLIFF_PAD).filter(({ ci, cj }) => {
      const home = cliffCellPoint(COLLAR.seed, ci, cj);
      return Math.hypot(home.x - o.x, home.z - o.z) >= reach + CLIFF_PAD;
    });
    expect(fromOutside.length).toBe(4);
    for (const { m } of fromOutside) expect(got.has(key(m))).toBe(true);
  }, 300_000);

  it("memoises cells across rebuilds and matches the pure walk", () => {
    const reach = CLIFF_RINGS.high[2];
    const c = createCliffCollector(WORST.seed);
    const first = c.collect(WORST.x, WORST.z, reach);
    expect(first).toEqual(collectCliffs(WORST.seed, WORST.x, WORST.z, reach));
    const size = c.size;
    // One cell over: the walk's leading edge is new, the rest is cached.
    const second = c.collect(WORST.x + CLIFF_CELL, WORST.z, reach);
    expect(second).toEqual(collectCliffs(WORST.seed, WORST.x + CLIFF_CELL, WORST.z, reach));
    const cells = Math.ceil((2 * (reach + CLIFF_PAD + CLIFF_RUN_REACH)) / CLIFF_CELL) + 1;
    expect(c.size - size).toBeLessThanOrEqual(cells + 2);
    // Measured: the walk's leading chord, 2 · 485.05 / 12 ≈ 80.8 cells.
    expect(c.size - size).toBe(80);
  }, 300_000);

  it("partitions the modules across the three LOD buckets by distance, exactly once each", () => {
    const rings = CLIFF_RINGS.high;
    const o = cliffOrigin(WORST.x, WORST.z);
    const all = collectCliffs(WORST.seed, WORST.x, WORST.z, rings[2]);
    const bands = cliffBands(all, o.x, o.z, rings);
    // collectCliffs's own pad (CLIFF_PAD) reaches past rings[2] so the cache
    // is warm before a module needs a band; cliffBands drops anything at or
    // past rings[2] instead of putting it in the far bucket early.
    const inReach = all.filter((m) => Math.hypot(m.x - o.x, m.z - o.z) < rings[2]);
    expect(all.length).toBe(78);
    expect(inReach.length).toBe(78);
    expect(bands[0].length + bands[1].length + bands[2].length).toBe(inReach.length);
    const seen = new Set<ClutterInstance>();
    for (const [lod, band] of bands.entries()) {
      for (const m of band) {
        expect(seen.has(m)).toBe(false);
        seen.add(m);
        const d = Math.hypot(m.x - o.x, m.z - o.z);
        expect(d).toBeLessThan(rings[lod] as number);
        if (lod > 0) expect(d).toBeGreaterThanOrEqual(rings[lod - 1] as number);
      }
    }
    // Teeth: the far band is where most of a 400 m disc lives.
    expect(bands[2].length).toBeGreaterThan(bands[0].length);
  }, 300_000);

  it("stays under the budget on the three census worlds' worst discs", () => {
    const counts: number[] = [];
    for (const [seed, x, z] of [[627994160, -200, -1000], [388817, -100, -500], [1, 1100, -1200]] as const) {
      counts.push(collectCliffs(seed, x, z, CLIFF_RINGS.high[2]).length);
    }
    expect(CLIFF_BUDGET).toBe(700);
    expect(counts).toEqual([333, 29, 78]);
    for (const n of counts) expect(n).toBeLessThanOrEqual(CLIFF_BUDGET);
  }, 300_000);

  it("evicts cells left behind by a long walk once the cache outgrows its sweep size", () => {
    // Walk away from the WORST census disc in 400 m strides (one reach's
    // width) at a fixed z, collecting at the high reach each time. Each
    // stride's leading edge adds a few thousand cells (each visited cell is
    // cached, hit or miss); the sweep fires once the cache passes 16,384.
    const seed = 1;
    const reach = CLIFF_RINGS.high[2];
    const z = -1200;
    const xs = [1100, 700, 300, -100, -500, -900, -1300];
    const c = createCliffCollector(seed);
    const sizes: number[] = [];
    for (const x of xs) {
      c.collect(x, z, reach);
      sizes.push(c.size);
    }
    expect(sizes).toEqual([5124, 7710, 10296, 12956, 15542, 5468, 8128]);
    // Teeth: the sweep actually fired (a stride that shrank the cache).
    expect(sizes.some((s, i) => i > 0 && s < sizes[i - 1]!)).toBe(true);
    // Never left holding more than the sweep size plus one cold walk's own
    // worth of cells.
    for (const s of sizes) expect(s).toBeLessThan(16384 + sizes[0]!);

    // Near side of the boundary: re-issuing the walk's own last call is a
    // clean cache hit — every cell that call needed is still there.
    const lastOrigin = xs[xs.length - 1]!;
    const beforeSame = c.size;
    c.collect(lastOrigin, z, reach);
    expect(c.size).toBe(beforeSame);

    // Far side: the WORST disc the walk started from is long past the
    // eviction margin of the last origin, so revisiting it must re-read
    // every cell from scratch (the same cost as the walk's first, cold
    // stride) and still return exactly what the pure walk would.
    const beforeFar = c.size;
    const got = c.collect(1100, z, reach);
    expect(c.size - beforeFar).toBe(sizes[0]!);
    expect(got).toEqual(collectCliffs(seed, 1100, z, reach));
    expect(got.length).toBe(78);
  }, 300_000);

  it("exercises the near LOD ring at a scarp with steep rock close to the eye", () => {
    // The three census discs above have no steep rock within 60 m of their
    // own centres, so this scarp is the fixture that puts modules in the near
    // ring. Measured at this origin.
    const rings = CLIFF_RINGS.high;
    const seed = 627994160, x = -340, z = -897;
    const o = cliffOrigin(x, z);
    const all = collectCliffs(seed, x, z, rings[2]);
    const bands = cliffBands(all, o.x, o.z, rings);
    expect(all.length).toBe(308);
    expect(bands.map((b) => b.length)).toEqual([59, 70, 173]);
    // A stretch of wall is laid about once: for each module in the near ring,
    // the other modules whose origins stand within a quarter of its own
    // width. At a density of 0.5 per cell this averaged 2.1 — runs from
    // neighbouring cells laid over one another two and three deep.
    let crowd = 0;
    for (const m of bands[0]) {
      const lim = 0.25 * (CLIFF_MODEL_WIDTH[m.variant] as number) * m.scale;
      for (const n of all) if (n !== m && Math.hypot(n.x - m.x, n.z - m.z) < lim) crowd++;
    }
    expect(crowd).toBe(49);
    expect(crowd / bands[0].length).toBeLessThanOrEqual(1);
  }, 300_000);
});

describe("the shell seats what the field probed", () => {
  it("turns a point by the shell's quaternion exactly as leanPoint turns the faced point, to 1e-9", () => {
    const q = new Quaternion();
    const ref = new Quaternion();
    const turned = new Vector3();
    const p: CliffPoint = { x: 0, y: 0, z: 0 };
    let n = 0, worst = 0;
    for (let i = 0; i < 500; i++) {
      // Gradients from gentle (below the cap) to far past it, any direction.
      const g = 2.5 * hash3(i, 0, 1, 99) ** 2;
      const a = 2 * Math.PI * hash3(i, 0, 2, 99);
      const dx = g * Math.cos(a), dz = g * Math.sin(a);
      const jitter = hash3(i, 0, 3, 99);
      const m: ClutterInstance = {
        cls: 0, x: 0, z: 0, groundH: 0, groundDx: dx, groundDz: dz,
        scale: 1, variant: i % 2 === 0 ? CLIFF_WALL_A : CLIFF_WALL_B, hash: jitter,
      };
      cliffSeat(m, q);
      // The shell's seat is `seatOnGroundCapped` at the facing's own yaw.
      const f = cliffFacing(dx, dz, jitter);
      seatOnGroundCapped(Math.atan2(f.fx, f.fz), dx, dz, CLIFF_TILT_MAX, ref);
      expect(q.equalsWithEpsilon(ref, 1e-12)).toBe(true);
      for (let k = 0; k < 4; k++) {
        const lx = 20 * hash3(i, k, 4, 99) - 10;
        const ly = 8 * hash3(i, k, 5, 99);
        const lz = 8 * hash3(i, k, 6, 99) - 4;
        new Vector3(lx, ly, lz).applyRotationQuaternionToRef(q, turned);
        leanPoint(lx * f.rx + lz * f.fx, ly, lx * f.rz + lz * f.fz, dx, dz, p);
        worst = Math.max(worst, Math.abs(turned.x - p.x), Math.abs(turned.y - p.y), Math.abs(turned.z - p.z));
        n++;
      }
    }
    expect(n).toBe(2000);
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("the simulation's rock band against the paint's", () => {
  it("agrees with classifySurface's rock weight on steep ground", () => {
    // 200 random points past the stand limit, drawn across three worlds: the
    // simulation's band (what the field now reads) against the paint's rock
    // weight (what it read before). Measured: they agree exactly. Past the
    // stand limit the gradient is beyond both the band's top
    // (`CLUTTER_ROCK_SLOPE_HI`, 0.6) and the paint's scree slope (0.95), so
    // both read full rock; the snow, canopy and duff terms never touch the
    // paint's rock weight there.
    const TOLERANCE = 0;
    const seeds = [1, 388817, 627994160];
    let n = 0, worst = 0, tries = 0;
    for (let i = 0; n < 200 && i < 600_000; i++) {
      tries++;
      const seed = seeds[i % 3]!;
      const x = 3000 * hash3(i, 0, 1, 7) - 1500;
      const z = 3000 * hash3(i, 0, 2, 7) - 1500;
      const s = elevationSampleAt(seed, x, z);
      const slopeSq = s.dx * s.dx + s.dz * s.dz;
      if (1 / Math.sqrt(1 + slopeSq) >= GROUND_NORMAL_Y) continue;
      const duff = groundCover(seed, x, z, s).duff;
      const paint = classifySurface(seed, x, z, s.h, Math.sqrt(slopeSq), forestDensity(seed, x, z, s), duff).weights.rock;
      worst = Math.max(worst, Math.abs(paint - rockSlopeBand(slopeSq)));
      n++;
    }
    expect(n).toBe(200);
    expect(tries).toBeGreaterThan(n);
    expect(worst).toBeLessThanOrEqual(TOLERANCE);
  }, 300_000);
});
