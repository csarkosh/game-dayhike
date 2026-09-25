import { describe, it, expect } from "vitest";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "../../src/sim/passes/index.js";
import { GROUND_NORMAL_Y } from "../../src/sim/constants.js";
import { CLUTTER_ROCK, type ClutterInstance } from "../../src/sim/clutter.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  CLIFF_BUDGET, CLIFF_CELL, CLIFF_DENSITY, CLIFF_LONG_NEIGHBOURS, CLIFF_MODEL_DEPTH,
  CLIFF_MODEL_FRONT, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_RIGHT, CLIFF_MODEL_WIDTH, CLIFF_PAD, CLIFF_PROBE_SPAN,
  CLIFF_RINGS, CLIFF_ROCK_MIN, CLIFF_SCALE, CLIFF_SINK, CLIFF_STAND_MARGIN, CLIFF_TILT_MAX, CLIFF_WALL_A,
  CLIFF_WALL_B, CLIFF_YAW_JITTER, cliffBands, cliffCell, cliffCellPoint, cliffGate, cliffLean,
  cliffOrigin, cliffYaw, collectCliffs, createCliffCollector,
} from "../../src/game/cliffField.js";
import { seatOnGroundCapped } from "../../src/game/groundTilt.js";
import { latticeHash } from "../../src/game/groundHexParams.js";

/** Seed 1's worst 400 m disc for steep rock (5,549 four-metre cells), from
 * the census in the design's §5. */
const WORST = { seed: 1, x: 1100, z: -1200 };

function normalY(dx: number, dz: number): number {
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

/** Every module the field places within `r` metres of (x, z). */
function modulesIn(seed: number, x: number, z: number, r: number) {
  const out: NonNullable<ReturnType<typeof cliffCell>>[] = [];
  for (let cj = Math.floor((z - r) / CLIFF_CELL); cj <= Math.floor((z + r) / CLIFF_CELL); cj++) {
    for (let ci = Math.floor((x - r) / CLIFF_CELL); ci <= Math.floor((x + r) / CLIFF_CELL); ci++) {
      const m = cliffCell(seed, ci, cj);
      if (m !== null && Math.hypot(m.x - x, m.z - z) < r) out.push(m);
    }
  }
  return out;
}

describe("cliffGate", () => {
  it("opens only below the stand limit by a margin, and only on rock", () => {
    let open = 0, closed = 0;
    for (let z = -1500; z < 1500; z += 40) {
      for (let x = -1500; x < 1500; x += 40) {
        const g = cliffGate(WORST.seed, x, z);
        const ny = normalY(g.s.dx, g.s.dz);
        if (g.open) {
          open++;
          expect(ny).toBeLessThan(GROUND_NORMAL_Y - CLIFF_STAND_MARGIN);
          expect(g.rock).toBeGreaterThanOrEqual(CLIFF_ROCK_MIN);
        } else {
          closed++;
          expect(ny >= GROUND_NORMAL_Y - CLIFF_STAND_MARGIN || g.rock < CLIFF_ROCK_MIN).toBe(true);
        }
      }
    }
    // Teeth: both branches ran on real ground.
    expect(open).toBeGreaterThan(20);
    expect(closed).toBeGreaterThan(1000);
  });
});

/** Points on the faces of the module's above-ground box, in the model's own
 * frame at `scale`, no further apart than `step`: x from the left of the
 * width to the model's own reach along +X (`CLIFF_MODEL_RIGHT`), y from the
 * sink line to the top, z from the back of the depth to the scanned face's
 * own reach (`CLIFF_MODEL_FRONT`) — the origin sits off-centre in both, so
 * neither runs `±half`. */
function boxShell(variant: number, scale: number, step: number): Vector3[] {
  const w = (CLIFF_MODEL_WIDTH[variant] as number) * scale;
  const h = (CLIFF_MODEL_HEIGHT[variant] as number) * scale;
  const d = (CLIFF_MODEL_DEPTH[variant] as number) * scale;
  const f = (CLIFF_MODEL_FRONT[variant] as number) * scale;
  const rt = (CLIFF_MODEL_RIGHT[variant] as number) * scale;
  const span = (a: number, b: number): number[] => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
    return out;
  };
  const xs = span(-(w - rt), rt), ys = span(CLIFF_SINK * h, h), zs = span(-(d - f), f);
  const pts: Vector3[] = [];
  for (const [i, x] of xs.entries()) {
    for (const [j, y] of ys.entries()) {
      for (const [k, z] of zs.entries()) {
        const onFace = i === 0 || i === xs.length - 1 || j === 0 || j === ys.length - 1
          || k === 0 || k === zs.length - 1;
        if (onFace) pts.push(new Vector3(x, y, z));
      }
    }
  }
  return pts;
}

/** The 1 m sweep grid: what the invariant is measured on. */
function solidBoxFaceGrid(variant: number, scale: number): Vector3[] {
  return boxShell(variant, scale, 1);
}

/** The lattice the field itself probes: `CLIFF_PROBE_SPAN` of the model's
 * longest dimension, which is its corners plus a midpoint on its longer
 * axes. */
function solidProbeLattice(variant: number, scale: number): Vector3[] {
  const longest = Math.max(
    (CLIFF_MODEL_WIDTH[variant] as number),
    (CLIFF_MODEL_HEIGHT[variant] as number),
    (CLIFF_MODEL_DEPTH[variant] as number),
  ) * scale;
  return boxShell(variant, scale, longest * CLIFF_PROBE_SPAN);
}

describe("cliffCell", () => {
  it("measures how much of the solid the probes leave uncovered", () => {
    // 200 worlds, every module within 400 m of the origin's neighbourhood on
    // each, swept on a 1 m grid over the faces of its above-ground box,
    // seated exactly as the field probes and the shell draw it.
    //
    // These three numbers are a MEASUREMENT, not a bound the placement meets
    // by construction. The probes read the box's corners and the midpoints of
    // its longer axes; the ground between two open probes can still dip back
    // over the stand limit, and where it does, part of the module's solid
    // hangs over ground the probes never cleared. `overhanging` counts the
    // modules with any such point; `overWalkable` counts the ones where that
    // ground is at or above the simulation's own stand limit — the modules
    // whose solid is over ground a player can stand on, which is the part
    // that matters to "sight and collision never disagree underfoot".
    //
    // Pinned so the residue cannot grow unnoticed: a placement change that
    // drives any of them up fails here and has to say why. Driving them to
    // zero is a placement-or-collision decision, open in §11 of
    // `docs/rendering/2026-09-24-cliff-modules-design.md` — probing this
    // finely at rebuild costs about twenty-five times what the field pays now.
    let modules = 0, overhanging = 0, overWalkable = 0;
    const rotated = new Vector3();
    const q = new Quaternion();
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of modulesIn(seed, 0, 0, 400)) {
        modules++;
        seatOnGroundCapped(m.hash * Math.PI * 2, m.groundDx, m.groundDz, CLIFF_TILT_MAX, q);
        let hangs = false, walkable = false;
        for (const p of solidBoxFaceGrid(m.variant, m.scale)) {
          p.applyRotationQuaternionToRef(q, rotated);
          const g = cliffGate(seed, m.x + rotated.x, m.z + rotated.z);
          if (g.open) continue;
          hangs = true;
          if (normalY(g.s.dx, g.s.dz) >= GROUND_NORMAL_Y) walkable = true;
        }
        if (hangs) overhanging++;
        if (walkable) overWalkable++;
      }
    }
    expect(modules).toBe(399);
    expect(overhanging).toBe(69);
    expect(overWalkable).toBe(31);
  }, 300_000);

  it("stands on ground that is steep rock under every probe of its solid", () => {
    // What the placement does guarantee, asserted over the probe set itself:
    // every point of the box lattice the field reads — its corners and the
    // midpoints of its longer axes — is open under the same seating the shell
    // draws with. 40 worlds; the residue between those probes is the case
    // above.
    let modules = 0, probes = 0;
    const rotated = new Vector3();
    const q = new Quaternion();
    for (let seed = 1; seed <= 40; seed++) {
      for (const m of modulesIn(seed, 0, 0, 400)) {
        modules++;
        seatOnGroundCapped(m.hash * Math.PI * 2, m.groundDx, m.groundDz, CLIFF_TILT_MAX, q);
        for (const p of solidProbeLattice(m.variant, m.scale)) {
          p.applyRotationQuaternionToRef(q, rotated);
          const px = m.x + rotated.x, pz = m.z + rotated.z;
          probes++;
          expect(cliffGate(seed, px, pz).open, `seed ${seed} module ${m.x},${m.z} at ${px},${pz}`).toBe(true);
        }
      }
    }
    // The lattice is the dozen-odd points it claims to be, on enough modules
    // to mean something: 12 for the long model, 18 for the short one.
    expect(modules).toBe(107);
    expect(probes).toBe(1590);
  }, 300_000);

  it("the base probes alone would hang a top edge over walkable ground", () => {
    // Why the solid is probed at all, counted on one disc. The old rule — the
    // centre and the four base edge midpoints — is recomputed here from the
    // field's own draws, and each module it would place is asked where its
    // top-front edge lands: `s · (H·sin θc + F·cos θc)` straight ahead of the
    // origin, the lean turning about the sunk origin so the whole height
    // swings forward. Some of those points are ground a player can stand on,
    // which is the overhang the solid's own probes now refuse.
    const cellDraw = (ci: number, cj: number, salt: number): number => latticeHash(ci + 307 * salt, cj + 331 * salt);
    let placedByOldRule = 0, overWalkable = 0;
    const r = 400;
    for (let cj = Math.floor((WORST.z - r) / CLIFF_CELL); cj <= Math.floor((WORST.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((WORST.x - r) / CLIFF_CELL); ci <= Math.floor((WORST.x + r) / CLIFF_CELL); ci++) {
        if (cellDraw(ci, cj, 6) >= CLIFF_DENSITY) continue;
        const { x, z } = cliffCellPoint(ci, cj);
        if (Math.hypot(x - WORST.x, z - WORST.z) >= r) continue;
        const g = cliffGate(WORST.seed, x, z);
        if (!g.open) continue;
        let steepNeighbours = 0;
        for (const [ox, oz] of [[CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL]] as const) {
          if (cliffGate(WORST.seed, x + ox, z + oz).open) steepNeighbours++;
        }
        const scale = CLIFF_SCALE[0] + (CLIFF_SCALE[1] - CLIFF_SCALE[0]) * cellDraw(ci, cj, 3);
        const yaw = cliffYaw(g.s) + CLIFF_YAW_JITTER * (2 * cellDraw(ci, cj, 4) - 1);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const baseOpen = (variant: number): boolean => {
          const hw = (CLIFF_MODEL_WIDTH[variant] as number) * scale / 2;
          const hd = (CLIFF_MODEL_DEPTH[variant] as number) * scale / 2;
          return (
            cliffGate(WORST.seed, x + rx * hw, z + rz * hw).open
            && cliffGate(WORST.seed, x - rx * hw, z - rz * hw).open
            && cliffGate(WORST.seed, x + fx * hd, z + fz * hd).open
            && cliffGate(WORST.seed, x - fx * hd, z - fz * hd).open
          );
        };
        let variant = steepNeighbours >= CLIFF_LONG_NEIGHBOURS ? CLIFF_WALL_B : CLIFF_WALL_A;
        if (!baseOpen(variant)) {
          if (variant === CLIFF_WALL_A) continue;
          variant = CLIFF_WALL_A;
          if (!baseOpen(variant)) continue;
        }
        placedByOldRule++;
        const lean = cliffLean(g.s.dx, g.s.dz);
        const height = (CLIFF_MODEL_HEIGHT[variant] as number);
        const front = (CLIFF_MODEL_FRONT[variant] as number);
        const reach = scale * (height * Math.sin(lean) + front * Math.cos(lean));
        const s = elevationSampleAt(WORST.seed, x + fx * reach, z + fz * reach);
        if (normalY(s.dx, s.dz) >= GROUND_NORMAL_Y) overWalkable++;
      }
    }
    expect(placedByOldRule).toBeGreaterThan(50);
    expect(overWalkable).toBeGreaterThan(0);
  }, 300_000);

  it("leans no further than the cap, and by the slope itself below it", () => {
    expect(CLIFF_TILT_MAX).toBe(0.35);
    for (const [dx, dz] of [[0, 0], [0.1, -0.05], [0.4, 0], [1, 0], [-1.4, 0.9]] as const) {
      const slope = Math.acos(normalY(dx, dz));
      expect(cliffLean(dx, dz)).toBeCloseTo(Math.min(slope, CLIFF_TILT_MAX), 12);
    }
    // Every module the field places is seated within the cap.
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 300)) {
      expect(cliffLean(m.groundDx, m.groundDz)).toBeLessThanOrEqual(CLIFF_TILT_MAX);
    }
  });

  it("is a pure function of (seed, cell) and differs by world", () => {
    let placed = 0, differ = 0;
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 200)) {
      placed++;
      const ci = Math.floor(m.x / CLIFF_CELL), cj = Math.floor(m.z / CLIFF_CELL);
      const again = cliffCell(WORST.seed, ci, cj);
      expect(again).toEqual(m);
      const other = cliffCell(WORST.seed + 1, ci, cj);
      if (other === null || other.x !== m.x || other.hash !== m.hash || other.scale !== m.scale) differ++;
    }
    expect(placed).toBeGreaterThan(20);
    expect(differ).toBe(placed);
  });

  it("faces downslope, within the yaw jitter, and is shaped as a lying rock instance", () => {
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 300)) {
      expect(m.cls).toBe(CLUTTER_ROCK);
      expect(m.variant === CLIFF_WALL_A || m.variant === CLIFF_WALL_B).toBe(true);
      expect(m.scale).toBeGreaterThanOrEqual(CLIFF_SCALE[0]);
      expect(m.scale).toBeLessThanOrEqual(CLIFF_SCALE[1]);
      expect(m.hash).toBeGreaterThanOrEqual(0);
      expect(m.hash).toBeLessThan(1);
      const s = elevationSampleAt(WORST.seed, m.x, m.z);
      const yaw = m.hash * Math.PI * 2;
      // The forward vector (sin yaw, cos yaw) points down the gradient.
      const down = Math.atan2(-s.dx, -s.dz);
      let d = yaw - down;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      expect(Math.abs(d)).toBeLessThanOrEqual(CLIFF_YAW_JITTER + 1e-9);
      expect(cliffYaw(s)).toBeCloseTo(down, 12);
      // The ground fields carry the sink: the instance sits CLIFF_SINK of its
      // rendered height below the sampled ground.
      const height = (CLIFF_MODEL_HEIGHT[m.variant] as number) * m.scale;
      expect(m.groundH).toBeCloseTo(s.h - CLIFF_SINK * height, 9);
      expect(m.groundDx).toBe(s.dx);
      expect(m.groundDz).toBe(s.dz);
    }
  });

  it("takes the long module where three neighbours are steep rock, the short one elsewhere", () => {
    let long = 0, short = 0;
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 300)) {
      let steepNeighbours = 0;
      for (const [ox, oz] of [[CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL]] as const) {
        if (cliffGate(WORST.seed, m.x + ox, m.z + oz).open) steepNeighbours++;
      }
      if (m.variant === CLIFF_WALL_B) {
        long++;
        expect(steepNeighbours).toBeGreaterThanOrEqual(3);
      } else {
        short++;
      }
    }
    // Both models are used on this face.
    expect(long).toBeGreaterThan(5);
    expect(short).toBeGreaterThan(5);
  });

  it("draws about half of the qualifying cells, before any terrain sample", () => {
    let qualifying = 0, placed = 0;
    const r = 400;
    for (let cj = Math.floor((WORST.z - r) / CLIFF_CELL); cj <= Math.floor((WORST.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((WORST.x - r) / CLIFF_CELL); ci <= Math.floor((WORST.x + r) / CLIFF_CELL); ci++) {
        const p = cliffCellPoint(ci, cj);
        if (Math.hypot(p.x - WORST.x, p.z - WORST.z) >= r) continue;
        if (!cliffGate(WORST.seed, p.x, p.z).open) continue;
        qualifying++;
        if (cliffCell(WORST.seed, ci, cj) !== null) placed++;
      }
    }
    // The density draw alone keeps half of them; the eight probes then drop
    // the rest, and drop far more than a density-only estimate would suggest,
    // because much of this disc's steep-rock area is narrow ridges rather
    // than one broad face — a footprint half-width of a few metres already
    // overruns a ridge that narrow on one side or the other, and the top
    // edge reaches metres further downhill again.
    // Measured on this disc: 91 placed of 555 qualifying (≈ 0.16).
    expect(qualifying).toBeGreaterThan(200);
    expect(placed / qualifying).toBeGreaterThan(0.14);
    expect(placed / qualifying).toBeLessThan(0.18);
  });
});

describe("collectCliffs and the collector", () => {
  it("returns every module within reach plus the pad of the snapped origin, nearest first", () => {
    const reach = CLIFF_RINGS.high[2];
    const o = cliffOrigin(WORST.x, WORST.z);
    const got = collectCliffs(WORST.seed, WORST.x, WORST.z, reach);
    const want = modulesIn(WORST.seed, o.x, o.z, reach + CLIFF_PAD);
    expect(got.length).toBe(want.length);
    for (let i = 1; i < got.length; i++) {
      const a = got[i - 1]!, b = got[i]!;
      expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeLessThanOrEqual(Math.hypot(b.x - o.x, b.z - o.z) + 1e-9);
    }
    expect(got.length).toBeGreaterThan(50);
    expect(got.length).toBeLessThanOrEqual(CLIFF_BUDGET);
  }, 300_000);

  it("memoises cells across rebuilds and matches the pure walk", () => {
    const reach = CLIFF_RINGS.high[2];
    const c = createCliffCollector(WORST.seed);
    const first = c.collect(WORST.x, WORST.z, reach);
    expect(first).toEqual(collectCliffs(WORST.seed, WORST.x, WORST.z, reach));
    const size = c.size;
    // One cell over: the disc's leading edge is new, the rest is cached.
    const second = c.collect(WORST.x + CLIFF_CELL, WORST.z, reach);
    expect(second).toEqual(collectCliffs(WORST.seed, WORST.x + CLIFF_CELL, WORST.z, reach));
    const cells = Math.ceil((2 * (reach + CLIFF_PAD)) / CLIFF_CELL) + 1;
    expect(c.size - size).toBeLessThanOrEqual(cells + 2);
    expect(c.size - size).toBeGreaterThan(0);
  }, 300_000);

  it("partitions the modules across the three LOD buckets by distance, exactly once each", () => {
    const rings = CLIFF_RINGS.high;
    const o = cliffOrigin(WORST.x, WORST.z);
    const all = collectCliffs(WORST.seed, WORST.x, WORST.z, rings[2]);
    const bands = cliffBands(all, o.x, o.z, rings);
    // collectCliffs's own pad (CLIFF_PAD) reaches past rings[2] so the cache
    // is warm before a module needs a band; cliffBands drops anything at or
    // past rings[2] instead of putting it in the far bucket early. Measured
    // on this disc: collectCliffs(seed, x, z, rings[2]) returns 92 modules and
    // none of them falls in that [rings[2], rings[2] + CLIFF_PAD) collar this
    // time, so the three bands hold all 92 — the collar is a property of the
    // reach, not of the disc, and the filter below is what pins it.
    const inReach = all.filter((m) => Math.hypot(m.x - o.x, m.z - o.z) < rings[2]);
    expect(all.length).toBe(92);
    expect(inReach.length).toBe(92);
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
    for (const [seed, x, z] of [[627994160, -200, -1000], [388817, -100, -500], [1, 1100, -1200]] as const) {
      expect(collectCliffs(seed, x, z, CLIFF_RINGS.high[2]).length).toBeLessThanOrEqual(CLIFF_BUDGET);
    }
  }, 300_000);

  it("evicts cells left behind by a long walk once the cache outgrows its sweep size", () => {
    // Walk away from the WORST census disc in 400 m strides (one reach's
    // width) at a fixed z, collecting at the high reach each time. Each
    // stride's leading edge adds a few thousand cells (each visited cell is
    // cached, hit or miss); measured on this walk: sizes grow to 14,210,
    // then a stride crosses the sweep size and the cache drops to 4,466
    // before growing again to 7,106 — the sweep fired exactly once, between
    // the fifth and sixth stride.
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
    expect(sizes).toEqual([4900, 7210, 9520, 11900, 14210, 4466, 7106]);
    // Teeth: the sweep actually fired (a stride that shrank the cache).
    expect(sizes[5]!).toBeLessThan(sizes[4]!);
    // Never left holding more than the sweep size plus one stride's own
    // worth of cells (measured: a fresh 400 m disc costs 4,900 cells here).
    for (const s of sizes) expect(s).toBeLessThan(16384 + 4900);

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
    expect(c.size - beforeFar).toBe(4900);
    expect(got).toEqual(collectCliffs(seed, 1100, z, reach));
    expect(got.length).toBe(92);
  }, 300_000);

  it("exercises the near LOD ring at a scarp with steep rock close to the eye", () => {
    // The three census discs above have no steep rock within 60 m of their
    // own centres (LOD0 is empty for all three), so this scarp is the one
    // fixture that puts modules in the near ring. Measured at this origin.
    const rings = CLIFF_RINGS.high;
    const seed = 627994160, x = -340, z = -897;
    const o = cliffOrigin(x, z);
    const all = collectCliffs(seed, x, z, rings[2]);
    const bands = cliffBands(all, o.x, o.z, rings);
    expect(all.length).toBe(174);
    expect(bands[0].length).toBe(17);
    expect(bands[1].length).toBe(51);
    expect(bands[2].length).toBe(101);
  }, 300_000);
});
