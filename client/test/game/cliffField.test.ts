import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { GROUND_NORMAL_Y } from "../../src/sim/constants.js";
import { CLUTTER_ROCK } from "../../src/sim/clutter.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  CLIFF_CELL, CLIFF_MODEL_DEPTH, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_WIDTH, CLIFF_ROCK_MIN,
  CLIFF_SCALE, CLIFF_SINK, CLIFF_STAND_MARGIN, CLIFF_WALL_A, CLIFF_WALL_B, CLIFF_YAW_JITTER,
  cliffCell, cliffCellPoint, cliffGate, cliffYaw,
} from "../../src/game/cliffField.js";

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

describe("cliffCell", () => {
  it("never stands where a foot can go: every footprint probe is steep rock", () => {
    // 200 worlds, every module within 400 m of the origin's neighbourhood
    // on each, probed at its centre and its four footprint points with the
    // gate itself. Red until the footprint check exists: a module a cell
    // wide can straddle the edge of a face.
    let modules = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of modulesIn(seed, 0, 0, 400)) {
        modules++;
        const yaw = m.hash * Math.PI * 2;
        const hw = (CLIFF_MODEL_WIDTH[m.variant] as number) * m.scale / 2;
        const hd = (CLIFF_MODEL_DEPTH[m.variant] as number) * m.scale / 2;
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const probes: [number, number][] = [
          [m.x, m.z],
          [m.x + rx * hw, m.z + rz * hw], [m.x - rx * hw, m.z - rz * hw],
          [m.x + fx * hd, m.z + fz * hd], [m.x - fx * hd, m.z - fz * hd],
        ];
        for (const [px, pz] of probes) expect(cliffGate(seed, px, pz).open, `seed ${seed} at ${px},${pz}`).toBe(true);
      }
    }
    // Teeth: the sweep found faces to test (measured: 839 modules across
    // 200 worlds at a 12 m lattice and density 0.5).
    expect(modules).toBeGreaterThan(300);
  }, 300_000);

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
    // The density draw alone keeps half of them; the footprint check then
    // drops the rest, and drops far more than a density-only estimate would
    // suggest, because much of this disc's steep-rock area is narrow ridges
    // rather than one broad face — a footprint half-width of a few metres
    // already overruns a ridge that narrow on one side or the other.
    // Measured on this disc: 128 placed of 555 qualifying (≈ 0.23).
    expect(qualifying).toBeGreaterThan(200);
    expect(placed / qualifying).toBeGreaterThan(0.2);
    expect(placed / qualifying).toBeLessThan(0.28);
  });
});
