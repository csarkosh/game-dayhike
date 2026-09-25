import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { registeredPasses } from "../../src/sim/chunk.js";
import { GROUND_NORMAL_Y } from "../../src/sim/constants.js";
import { CLUTTER_ROCK, rockSlopeBand, type ClutterInstance } from "../../src/sim/clutter.js";
import { hash3 } from "../../src/sim/field.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import * as cliffField from "../../src/sim/cliffField.js";
import { boxShell, seat } from "./helpers/cliffSolid.js";
import {
  CLIFF_CELL, CLIFF_DENSITY, CLIFF_LONG_NEIGHBOURS, CLIFF_MODEL_DEPTH, CLIFF_MODEL_FRONT, CLIFF_MODEL_HEIGHT,
  CLIFF_MODEL_RIGHT, CLIFF_MODEL_WIDTH, CLIFF_PROBE_SPAN, CLIFF_ROCK_MIN, CLIFF_RUN_MAX, CLIFF_RUN_REACH,
  CLIFF_RUN_SPACING, CLIFF_SCALE, CLIFF_SINK, CLIFF_STAND_MARGIN, CLIFF_TILT_COS, CLIFF_TILT_MAX, CLIFF_TILT_SIN,
  CLIFF_TUNABLES, CLIFF_WALL_A, CLIFF_WALL_B, CLIFF_YAW_JITTER, CLIFF_YAW_TAN,
  cliffCellPoint, cliffCellRuns, cliffFacing, cliffGate, cliffGround, cliffLeanTrig, leanPoint, type CliffPoint,
} from "../../src/sim/cliffField.js";

/** Seed 1's worst 400 m disc for steep rock (5,549 four-metre cells), from
 * the census in the design's §5. */
const WORST = { seed: 1, x: 1100, z: -1200 };
/** The scarp the gates are shot at: seed `atmo`, a long steep face. */
const SCARP = { seed: 627994160, x: -336, z: -900 };

function normalY(dx: number, dz: number): number {
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

type Placed = { m: ClutterInstance; ci: number; cj: number };

/** Every module whose origin lies within `r` of (x, z), with the cell whose
 * run laid it. A run can carry a module up to `CLIFF_RUN_REACH` from its
 * cell's point, so the cells are walked that much further out. */
function modulesIn(seed: number, x: number, z: number, r: number): Placed[] {
  const out: Placed[] = [];
  const w = r + CLIFF_RUN_REACH;
  for (let cj = Math.floor((z - w) / CLIFF_CELL); cj <= Math.floor((z + w) / CLIFF_CELL); cj++) {
    for (let ci = Math.floor((x - w) / CLIFF_CELL); ci <= Math.floor((x + w) / CLIFF_CELL); ci++) {
      for (const m of cliffCellRuns(seed, ci, cj)) {
        if (Math.hypot(m.x - x, m.z - z) < r) out.push({ m, ci, cj });
      }
    }
  }
  return out;
}

/** The lattice the field itself probes: `CLIFF_PROBE_SPAN` of the model's
 * longest dimension, which is its corners plus a midpoint on its longer
 * axes. */
function solidProbeLattice(variant: number, scale: number): [number, number, number][] {
  const longest = Math.max(
    (CLIFF_MODEL_WIDTH[variant] as number),
    (CLIFF_MODEL_HEIGHT[variant] as number),
    (CLIFF_MODEL_DEPTH[variant] as number),
  ) * scale;
  return boxShell(variant, scale, longest * CLIFF_PROBE_SPAN);
}

describe("the gate", () => {
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

  it("reads the rock class's own slope band: steep gradients open, gentle ones close", () => {
    // The stand limit less the margin is ny = 0.67, a gradient of 1.1077.
    expect(cliffGround(1.12, 0).open).toBe(true);
    expect(cliffGround(0, -1.5).open).toBe(true);
    expect(cliffGround(-0.9, 0.9).open).toBe(true);
    expect(cliffGround(1.1, 0).open).toBe(false);
    expect(cliffGround(0.5, 0.2).open).toBe(false);
    expect(cliffGround(0, 0).open).toBe(false);
    // The weight is the band itself, by reference.
    for (const [dx, dz] of [[1.12, 0], [0, -1.5], [-0.9, 0.9], [2, 1]] as const) {
      expect(cliffGround(dx, dz).rock).toBe(rockSlopeBand(dx * dx + dz * dz));
    }
    // The stand gate saturates the band: every gradient steep enough to pass
    // it is past the band's top, so the rock threshold binds only if one of
    // the two ever moves toward the other.
    const steepest = 1 / ((GROUND_NORMAL_Y - CLIFF_STAND_MARGIN) ** 2) - 1;
    expect(rockSlopeBand(steepest)).toBe(1);
    expect(CLIFF_ROCK_MIN).toBe(0.8);
  });
});

describe("the lean and the facing, without trig", () => {
  it("pins the cap's cosine and sine and the jitter's tangent to their angles", () => {
    expect(CLIFF_TILT_MAX).toBe(0.35);
    expect(CLIFF_TILT_COS).toBe(0.9393727128473789);
    expect(CLIFF_TILT_SIN).toBe(0.34289780745545134);
    expect(CLIFF_YAW_JITTER).toBe(0.3);
    expect(CLIFF_YAW_TAN).toBe(0.30933624960962325);
    expect(Math.abs(CLIFF_TILT_COS - Math.cos(CLIFF_TILT_MAX))).toBeLessThan(1e-15);
    expect(Math.abs(CLIFF_TILT_SIN - Math.sin(CLIFF_TILT_MAX))).toBeLessThan(1e-15);
    expect(Math.abs(CLIFF_YAW_TAN - Math.tan(CLIFF_YAW_JITTER))).toBeLessThan(1e-15);
  });

  it("leans no further than the cap, and by the slope itself below it", () => {
    for (const [dx, dz] of [[0, 0], [0.1, -0.05], [0.3, 0.2], [0.4, 0], [1, 0], [-1.4, 0.9]] as const) {
      const lean = Math.min(Math.acos(normalY(dx, dz)), CLIFF_TILT_MAX);
      const t = cliffLeanTrig(dx, dz);
      expect(t.c).toBeCloseTo(Math.cos(lean), 12);
      expect(t.s).toBeCloseTo(Math.sin(lean), 12);
    }
  });

  it("leans UP onto the ground normal below the cap, and toward it by the cap above", () => {
    const p: CliffPoint = { x: 0, y: 0, z: 0 };
    // Below the cap: UP lands on the normal itself.
    for (const [dx, dz] of [[0.2, -0.1], [-0.15, 0.25], [0.05, 0.3]] as const) {
      leanPoint(0, 1, 0, dx, dz, p);
      const ny = normalY(dx, dz);
      expect(p.x).toBeCloseTo(-dx * ny, 12);
      expect(p.y).toBeCloseTo(ny, 12);
      expect(p.z).toBeCloseTo(-dz * ny, 12);
    }
    // Above it: UP tips downslope by exactly the cap.
    for (const [dx, dz] of [[1.2, 0.3], [-0.8, -1.1], [0, 2]] as const) {
      leanPoint(0, 1, 0, dx, dz, p);
      const g = Math.hypot(dx, dz);
      expect(p.y).toBeCloseTo(Math.cos(CLIFF_TILT_MAX), 12);
      expect(p.x).toBeCloseTo((-dx / g) * Math.sin(CLIFF_TILT_MAX), 12);
      expect(p.z).toBeCloseTo((-dz / g) * Math.sin(CLIFF_TILT_MAX), 12);
    }
    // A rotation: lengths are kept, and the contour axis does not move.
    for (const [dx, dz] of [[0.2, -0.1], [1.2, 0.3]] as const) {
      leanPoint(3, -2, 5, dx, dz, p);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(Math.hypot(3, -2, 5), 12);
      const g = Math.hypot(dx, dz);
      leanPoint(-dz / g, 0, dx / g, dx, dz, p);
      expect(p.x).toBeCloseTo(-dz / g, 12);
      expect(p.y).toBeCloseTo(0, 12);
      expect(p.z).toBeCloseTo(dx / g, 12);
    }
  });

  it("faces downslope, turned by at most the jitter, with the width along the turned contour", () => {
    for (const [dx, dz] of [[1.2, 0.3], [-0.8, -1.1], [0, 2], [0.7, -0.7]] as const) {
      const g = Math.hypot(dx, dz);
      const down = [-dx / g, -dz / g] as const;
      const centre = cliffFacing(dx, dz, 0.5);
      expect(centre.fx).toBeCloseTo(down[0], 12);
      expect(centre.fz).toBeCloseTo(down[1], 12);
      for (const j of [0, 0.1, 0.37, 0.5, 0.81, 0.999999]) {
        const f = cliffFacing(dx, dz, j);
        expect(Math.hypot(f.fx, f.fz)).toBeCloseTo(1, 12);
        expect(f.rx).toBe(f.fz);
        expect(f.rz).toBe(-f.fx);
        const turn = Math.acos(Math.min(1, f.fx * down[0] + f.fz * down[1]));
        expect(turn).toBeLessThanOrEqual(CLIFF_YAW_JITTER + 1e-9);
      }
      // The ends of the draw are the ends of the jitter.
      const edge = cliffFacing(dx, dz, 0);
      expect(Math.acos(edge.fx * down[0] + edge.fz * down[1])).toBeCloseTo(CLIFF_YAW_JITTER, 12);
    }
  });
});

describe("the placement", () => {
  it("carries no module further from its cell than CLIFF_RUN_REACH", () => {
    // Every module every cell lays within 463.84 m of the origin, on 200
    // worlds, against the bound the chunk pass and the collector walk by.
    // The residual this walk once also measured — solid hanging over ground
    // the probes never cleared — is retired by the colliders of the cliff
    // pass (`passes/cliffs.test.ts`), which contain the whole solid.
    const WORLDS = 200;
    let laid = 0, farthest = 0;
    const w = 400 + CLIFF_RUN_REACH;
    for (let seed = 1; seed <= WORLDS; seed++) {
      for (let cj = Math.floor(-w / CLIFF_CELL); cj <= Math.floor(w / CLIFF_CELL); cj++) {
        for (let ci = Math.floor(-w / CLIFF_CELL); ci <= Math.floor(w / CLIFF_CELL); ci++) {
          const run = cliffCellRuns(seed, ci, cj);
          if (run.length === 0) continue;
          const home = cliffCellPoint(seed, ci, cj);
          for (const m of run) {
            laid++;
            const reach = Math.hypot(m.x - home.x, m.z - home.z);
            farthest = Math.max(farthest, reach);
            expect(reach).toBeLessThanOrEqual(CLIFF_RUN_REACH);
          }
        }
      }
    }
    expect(laid).toBe(405);
    // Measured: the farthest a run carried a module across these worlds,
    // 50.59 m of the 63.84 the constants allow.
    expect(farthest).toBeCloseTo(50.594476156076325, 9);
  }, 300_000);

  it("pins the run's reach to the arithmetic of its constants", () => {
    // Every step along a run is CLIFF_RUN_SPACING of the mean of its two
    // modules' placed widths, the models alternate, and a straight contour at
    // the top of the scale band is the farthest a run can go:
    // 4 · 0.7 · 1.6 · (20.23 + 8.27) / 2.
    expect(CLIFF_RUN_MAX).toBe(4);
    expect(CLIFF_RUN_SPACING).toBe(0.7);
    expect(CLIFF_SCALE).toEqual([0.7, 1.6]);
    expect(CLIFF_RUN_REACH).toBeCloseTo(63.84, 9);
  });

  it("stands on ground that is steep rock under every probe of its solid", () => {
    // What the placement does guarantee, asserted over the probe set itself:
    // every point of the box lattice the field reads is open under the same
    // seating. 40 worlds; what lies between those probes is covered by the
    // module's colliders (`passes/cliffs.test.ts`).
    let modules = 0, probes = 0;
    const p: CliffPoint = { x: 0, y: 0, z: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      for (const { m } of modulesIn(seed, 0, 0, 400)) {
        modules++;
        for (const [lx, ly, lz] of solidProbeLattice(m.variant, m.scale)) {
          seat(m, lx, ly, lz, p);
          const px = m.x + p.x, pz = m.z + p.z;
          probes++;
          expect(cliffGate(seed, px, pz).open, `seed ${seed} module ${m.x},${m.z} at ${px},${pz}`).toBe(true);
        }
      }
    }
    // 12 probes for the long model, 18 for the short one.
    expect(modules).toBe(84);
    expect(probes).toBe(1284);
  }, 300_000);

  it("the base probes alone would hang a top edge over walkable ground", () => {
    // Why the solid is probed at all, counted on one disc. At every cell
    // point the gate opens, a module of each model is stood with this test's
    // own scale and jitter draws and judged by the old rule — the centre and
    // the four base edge midpoints — and each one that rule would place is
    // asked where its top-front edge lands: `s · (H·sin θc + F·cos θc)`
    // straight ahead of the origin, the lean turning about the sunk origin so
    // the whole height swings forward. Some of those points are ground a
    // player can stand on, which is the overhang the solid's own probes
    // refuse.
    let placedByOldRule = 0, overWalkable = 0;
    const r = 400;
    for (let cj = Math.floor((WORST.z - r) / CLIFF_CELL); cj <= Math.floor((WORST.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((WORST.x - r) / CLIFF_CELL); ci <= Math.floor((WORST.x + r) / CLIFF_CELL); ci++) {
        const { x, z } = cliffCellPoint(WORST.seed, ci, cj);
        if (Math.hypot(x - WORST.x, z - WORST.z) >= r) continue;
        const g = cliffGate(WORST.seed, x, z);
        if (!g.open) continue;
        for (const variant of [CLIFF_WALL_A, CLIFF_WALL_B]) {
          const scale = CLIFF_SCALE[0] + (CLIFF_SCALE[1] - CLIFF_SCALE[0]) * hash3(ci, cj, variant, 17);
          const f = cliffFacing(g.s.dx, g.s.dz, hash3(ci, cj, variant, 23));
          const hw = (CLIFF_MODEL_WIDTH[variant] as number) * scale / 2;
          const hd = (CLIFF_MODEL_DEPTH[variant] as number) * scale / 2;
          const baseOpen = cliffGate(WORST.seed, x + f.rx * hw, z + f.rz * hw).open
            && cliffGate(WORST.seed, x - f.rx * hw, z - f.rz * hw).open
            && cliffGate(WORST.seed, x + f.fx * hd, z + f.fz * hd).open
            && cliffGate(WORST.seed, x - f.fx * hd, z - f.fz * hd).open;
          if (!baseOpen) continue;
          placedByOldRule++;
          const lean = cliffLeanTrig(g.s.dx, g.s.dz);
          const reach = scale * ((CLIFF_MODEL_HEIGHT[variant] as number) * lean.s + (CLIFF_MODEL_FRONT[variant] as number) * lean.c);
          const s = elevationSampleAt(WORST.seed, x + f.fx * reach, z + f.fz * reach);
          if (normalY(s.dx, s.dz) >= GROUND_NORMAL_Y) overWalkable++;
        }
      }
    }
    expect(placedByOldRule).toBe(410);
    expect(overWalkable).toBe(10);
  }, 300_000);

  it("is a pure function of (seed, cell), whatever order the cells are read in, and differs by world", () => {
    const r = 400;
    const cells: [number, number][] = [];
    for (let cj = Math.floor((WORST.z - r) / CLIFF_CELL); cj <= Math.floor((WORST.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((WORST.x - r) / CLIFF_CELL); ci <= Math.floor((WORST.x + r) / CLIFF_CELL); ci++) {
        cells.push([ci, cj]);
      }
    }
    const forward = cells.map(([ci, cj]) => cliffCellRuns(WORST.seed, ci, cj));
    const backward = [...cells].reverse().map(([ci, cj]) => cliffCellRuns(WORST.seed, ci, cj)).reverse();
    expect(backward).toEqual(forward);
    let runs = 0, multi = 0, differ = 0;
    for (const [i, run] of forward.entries()) {
      if (run.length === 0) continue;
      runs++;
      if (run.length > 1) multi++;
      const [ci, cj] = cells[i]!;
      const other = cliffCellRuns(WORST.seed + 1, ci, cj);
      const first = run[0]!;
      if (!other.some((m) => m.x === first.x && m.z === first.z && m.hash === first.hash)) differ++;
    }
    // Measured on this disc; runs longer than one module are among them.
    expect(runs).toBe(14);
    expect(multi).toBe(12);
    expect(differ).toBe(runs);
  }, 300_000);

  it("faces downslope, within the yaw jitter, and is shaped as a lying rock instance", () => {
    for (const { m } of modulesIn(WORST.seed, WORST.x, WORST.z, 300)) {
      expect(m.cls).toBe(CLUTTER_ROCK);
      expect(m.variant === CLIFF_WALL_A || m.variant === CLIFF_WALL_B).toBe(true);
      expect(m.scale).toBeGreaterThanOrEqual(CLIFF_SCALE[0]);
      expect(m.scale).toBeLessThanOrEqual(CLIFF_SCALE[1]);
      expect(m.hash).toBeGreaterThanOrEqual(0);
      expect(m.hash).toBeLessThan(1);
      const s = elevationSampleAt(WORST.seed, m.x, m.z);
      const f = cliffFacing(m.groundDx, m.groundDz, m.hash);
      const g = Math.hypot(s.dx, s.dz);
      const turn = Math.acos(Math.min(1, (f.fx * -s.dx + f.fz * -s.dz) / g));
      expect(turn).toBeLessThanOrEqual(CLIFF_YAW_JITTER + 1e-9);
      // The ground fields carry the sink: the instance sits CLIFF_SINK of its
      // rendered height below the sampled ground.
      const height = (CLIFF_MODEL_HEIGHT[m.variant] as number) * m.scale;
      expect(m.groundH).toBeCloseTo(s.h - CLIFF_SINK * height, 9);
      expect(m.groundDx).toBe(s.dx);
      expect(m.groundDz).toBe(s.dz);
      // Every module stands on open ground, the capped lean at most the cap.
      expect(cliffGate(WORST.seed, m.x, m.z).open).toBe(true);
      expect(cliffLeanTrig(m.groundDx, m.groundDz).c).toBeGreaterThanOrEqual(CLIFF_TILT_COS);
    }
  }, 300_000);

  it("starts a run with the long module where three neighbours are steep rock, the short one elsewhere", () => {
    let long = 0, short = 0;
    for (const { m, ci, cj } of modulesIn(WORST.seed, WORST.x, WORST.z, 400)) {
      const home = cliffCellPoint(WORST.seed, ci, cj);
      if (m.x !== home.x || m.z !== home.z) continue;
      let steepNeighbours = 0;
      for (const [ox, oz] of [[CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL]] as const) {
        if (cliffGate(WORST.seed, m.x + ox, m.z + oz).open) steepNeighbours++;
      }
      if (m.variant === CLIFF_WALL_B) {
        long++;
        expect(steepNeighbours).toBeGreaterThanOrEqual(CLIFF_LONG_NEIGHBOURS);
      } else {
        short++;
      }
    }
    // Both models start runs on this disc. Measured.
    expect(long).toBe(10);
    expect(short).toBe(3);
  }, 300_000);

  it("lays runs along the contour on the scarp, spaced by the neighbours' mean width, the models alternating", () => {
    const r = 150;
    let cells = 0, multi = 0, pairs = 0, longest = 0, gaps = 0;
    for (let cj = Math.floor((SCARP.z - r) / CLIFF_CELL); cj <= Math.floor((SCARP.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((SCARP.x - r) / CLIFF_CELL); ci <= Math.floor((SCARP.x + r) / CLIFF_CELL); ci++) {
        const run = cliffCellRuns(SCARP.seed, ci, cj);
        if (run.length === 0) continue;
        cells++;
        longest = Math.max(longest, run.length);
        if (run.length > 1) multi++;
        expect(run.length).toBeLessThanOrEqual(2 * CLIFF_RUN_MAX + 1);
        // The run is ordered along the wall; its own module is at the cell's
        // point, and every step away from it is taken along the contour at
        // the module nearer to it.
        const home = cliffCellPoint(SCARP.seed, ci, cj);
        const k = run.findIndex((m) => m.x === home.x && m.z === home.z);
        expect(k).toBeGreaterThanOrEqual(0);
        for (let i = 1; i < run.length; i++) {
          const a = run[i - 1]!, b = run[i]!;
          const prev = i <= k ? b : a;
          const wa = (CLIFF_MODEL_WIDTH[a.variant] as number) * a.scale;
          const wb = (CLIFF_MODEL_WIDTH[b.variant] as number) * b.scale;
          const step = CLIFF_RUN_SPACING * (wa + wb) / 2;
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          expect(Math.abs(d - step)).toBeLessThanOrEqual(0.05 * step);
          // A gap: the two origins farther apart than their half-widths reach.
          if (d > (wa + wb) / 2) gaps++;
          // Along the contour at the previous module's ground: square to its
          // gradient.
          const g = Math.hypot(prev.groundDx, prev.groundDz);
          expect(Math.abs(((b.x - a.x) * prev.groundDx + (b.z - a.z) * prev.groundDz) / (d * g))).toBeLessThan(1e-9);
          expect(b.variant).not.toBe(a.variant);
          // Each module draws its own scale and jitter.
          expect(b.scale === a.scale && b.hash === a.hash).toBe(false);
          pairs++;
        }
      }
    }
    expect(cells).toBe(17);
    expect(multi).toBe(16);
    expect(pairs).toBe(111);
    expect(longest).toBe(9);
    // Stepping by the previous module's width alone left 133 of 541 pairs
    // here with a gap, where a long module stepped to a short one.
    expect(gaps).toBe(0);
  }, 300_000);

  it("starts a run on about one qualifying cell in ten, before any terrain sample", () => {
    let qualifying = 0, placed = 0, modules = 0;
    const r = 400;
    for (let cj = Math.floor((WORST.z - r) / CLIFF_CELL); cj <= Math.floor((WORST.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((WORST.x - r) / CLIFF_CELL); ci <= Math.floor((WORST.x + r) / CLIFF_CELL); ci++) {
        const p = cliffCellPoint(WORST.seed, ci, cj);
        if (Math.hypot(p.x - WORST.x, p.z - WORST.z) >= r) continue;
        if (!cliffGate(WORST.seed, p.x, p.z).open) continue;
        qualifying++;
        const run = cliffCellRuns(WORST.seed, ci, cj);
        if (run.length > 0) placed++;
        modules += run.length;
      }
    }
    // The density draw alone keeps one in ten: a run reaches up to
    // CLIFF_RUN_REACH either side of its cell, so a denser draw lays the
    // same stretch of wall several times over. The probes over the solid
    // then drop more, because much of this disc's steep-rock area is narrow
    // ridges rather than one broad face.
    expect(CLIFF_DENSITY).toBe(0.1);
    expect(qualifying).toBe(542);
    expect(placed).toBe(13);
    expect(modules).toBe(78);
  }, 300_000);
});

describe("the level id", () => {
  it("declares every exported numeric CLIFF_ constant in CLIFF_TUNABLES", () => {
    for (const [k, v] of Object.entries(cliffField)) {
      if (!k.startsWith("CLIFF_") || k === "CLIFF_WALL_A" || k === "CLIFF_WALL_B") continue;
      if (typeof v === "number") expect(CLIFF_TUNABLES[k], k).toBe(v);
    }
    // The tables, per model.
    for (const [name, table] of [
      ["WIDTH", CLIFF_MODEL_WIDTH], ["DEPTH", CLIFF_MODEL_DEPTH], ["HEIGHT", CLIFF_MODEL_HEIGHT],
      ["FRONT", CLIFF_MODEL_FRONT], ["RIGHT", CLIFF_MODEL_RIGHT],
    ] as const) {
      expect(CLIFF_TUNABLES[`CLIFF_MODEL_${name}_A`], name).toBe(table[CLIFF_WALL_A]);
      expect(CLIFF_TUNABLES[`CLIFF_MODEL_${name}_B`], name).toBe(table[CLIFF_WALL_B]);
    }
    expect(CLIFF_TUNABLES.CLIFF_SCALE_MIN).toBe(CLIFF_SCALE[0]);
    expect(CLIFF_TUNABLES.CLIFF_SCALE_MAX).toBe(CLIFF_SCALE[1]);
  });

  it("is carried by a registered pass, so a placement constant moves the level id", () => {
    const carried = registeredPasses().find((p) => Object.keys(p.tunables).includes("CLIFF_RUN_SPACING"));
    expect(carried).toBeDefined();
    for (const [k, v] of Object.entries(CLIFF_TUNABLES)) expect(carried!.tunables[k], k).toBe(v);
  });
});
