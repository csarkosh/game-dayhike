// client/test/sim/waterTerrainSweep.test.ts
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bowlFor, coveFor, olympicPreTrailSample, coveProfileD, COVE_BACK_FADE } from "../../src/sim/olympic.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { variantOrThrow } from "./helpers/derivatives.js";
import {
  featureStageD, lakeStageD, lobePoints, marshWeightAt, LAKE_SILL, LAKE_NOTCH_FADE, LAKE_TRAIL_CLEAR,
  MARSH_MURK_MIN, POND_SHORE, type Feature,
} from "../../src/sim/features.js";
import { lakeOutline, lakeShelfWidth, lakeShoreInto, newLakeShore, type LakeShape } from "../../src/sim/lakeShape.js";
import { CLUTTER_LILY, clutterInRect } from "../../src/sim/clutter.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * The water terrain's 200-world scan. The bowl's build must not move: every
 * feature, the trail graph and the field in the road's corridor and at the pad
 * are compared with a fixture recorded on the code that placed the valley
 * lakes (`RECORD_WATER_BASELINE=1` writes it; nothing else may), each lake
 * with its family, bound and level. Every world is built once per run.
 */
const FIXTURE = fileURLToPath(new URL("./fixtures/waterBaseline.json", import.meta.url));

type FeatureRecord = {
  id: number; kind: string; x: number; z: number; radius: number; height: number; crestH: number | null;
  family: string | null; bound: number | null;
};
type WorldRecord = { seed: number; features: FeatureRecord[]; loops: number; graph: string; field: string };

/** FNV-1a over the numbers' float64 bytes: a hash that changes when any bit does. */
function fnv(values: readonly number[]): string {
  const bytes = new Uint8Array(new Float64Array(values).buffer);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function recordWorld(seed: number): WorldRecord {
  const v = variantOrThrow("olympic");
  const centre = v.roadCenterX as (seed: number, z: number) => number;
  const b = bowlFor(seed);
  const graph: number[] = [];
  for (const n of b.graph.nodes) graph.push(n.x, n.z, n.h);
  for (const e of b.graph.edges) graph.push(e.a, e.b);
  const field: number[] = [];
  // The corridor, both sides of the centreline, along the cove's whole span.
  for (let z = -150; z <= 150; z += 50) {
    for (const u of [-29, -20, -10, 0, 10, 20, 29]) {
      const s = v.sample(seed, centre(seed, z) + u, z);
      field.push(s.h, s.dx, s.dz);
    }
  }
  // The pad and the ground just inland of it.
  for (const z of [-12, 0, 12]) {
    for (const u of [8, 9, 14, 20]) {
      const s = v.sample(seed, centre(seed, z) + u, z);
      field.push(s.h, s.dx, s.dz);
    }
  }
  return {
    seed,
    // `+ 0` turns a −0 into 0, which JSON cannot tell apart anyway.
    features: b.features.map((f) => ({
      id: f.id, kind: f.kind, x: f.x + 0, z: f.z + 0, radius: f.radius + 0, height: f.height + 0,
      crestH: f.crestH === undefined ? null : f.crestH + 0,
      family: f.shape === undefined ? null : f.shape.family,
      bound: f.shape === undefined ? null : f.shape.bound + 0,
    })),
    loops: b.graph.loops.length,
    graph: fnv(graph),
    field: fnv(field),
  };
}

let built: WorldRecord[] | null = null;
function worlds(): WorldRecord[] {
  if (built === null) built = LOBBY_SEEDS.map(recordWorld);
  return built;
}

/** Every lake of the 200 lobby worlds, with its world's seed. */
function lakes(): Array<{ seed: number; f: Feature; shape: LakeShape }> {
  const out: Array<{ seed: number; f: Feature; shape: LakeShape }> = [];
  for (const seed of LOBBY_SEEDS) {
    for (const f of bowlFor(seed).features) if (f.kind === "pond" && f.shape !== undefined) out.push({ seed, f, shape: f.shape });
  }
  return out;
}

/** The world's ground with its features and lakes and without the trail: the
 * field the lakes are designed on. */
function untrailed(seed: number, x: number, z: number): number {
  const fs = bowlFor(seed).features;
  return lakeStageD(seed, fs, x, z, featureStageD(fs, x, z, olympicPreTrailSample(seed, x, z))).h;
}

/** A field read on a 2 m grid over a lake's box, with each cell's shore distance. */
type LakeGrid = { n: number; x0: number; z0: number; h: Float64Array; s: Float64Array };
const GRID_STEP = 2;
function lakeGrid(shape: LakeShape, field: (x: number, z: number) => number): LakeGrid {
  const n = Math.ceil((2 * shape.bound) / GRID_STEP) + 1;
  const x0 = shape.cx - shape.bound, z0 = shape.cz - shape.bound;
  const h = new Float64Array(n * n), s = new Float64Array(n * n);
  const r = newLakeShore();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * GRID_STEP, z = z0 + j * GRID_STEP;
      h[j * n + i] = field(x, z);
      s[j * n + i] = lakeShoreInto(r, shape, x, z).s;
    }
  }
  return { n, x0, z0, h, s };
}

/**
 * The crests water rising in the lake meets on its way out: from each vertex
 * of the 1 m outline, straight out along −∇s every quarter metre, the highest
 * ground over the level before the ground falls under the level again (or,
 * where it never does within the bank and the widest apron, the highest
 * reached); none where the line crosses a spit back into the lake. The
 * lowest of them is the lake's spill height.
 */
function crestsOf(shape: LakeShape, field: (x: number, z: number) => number): { crest: number[]; xs: readonly number[]; zs: readonly number[] } {
  const o = lakeOutline(shape, 1);
  const r = newLakeShore();
  const crest: number[] = [];
  for (let i = 0; i < o.xs.length; i++) {
    lakeShoreInto(r, shape, o.xs[i]!, o.zs[i]!);
    const gl = Math.hypot(r.sx, r.sz);
    const nx = -r.sx / gl, nz = -r.sz / gl;
    let top = -Infinity;
    const p = newLakeShore();
    for (let t = 0.25; t <= 40; t += 0.25) {
      const x = o.xs[i]! + nx * t, z = o.zs[i]! + nz * t;
      // A line that crosses a spit back into the lake is no way out.
      if (lakeShoreInto(p, shape, x, z).s > 0) { top = Infinity; break; }
      const h = field(x, z) - shape.level;
      if (h > top) top = h;
      if (h < 0 && top > 0) break;
    }
    crest.push(top);
  }
  return { crest, xs: o.xs, zs: o.zs };
}

describe("the water terrain over 200 worlds", { timeout: timeLimit(1_200_000) }, () => {
  it("builds every world's features, trail and road as the baseline recorded them", () => {
    const now = worlds();
    if (process.env.RECORD_WATER_BASELINE === "1") {
      writeFileSync(FIXTURE, "[\n" + now.map((w) => JSON.stringify(w)).join(",\n") + "\n]\n");
      return;
    }
    expect(existsSync(FIXTURE), "record the baseline first").toBe(true);
    const before = JSON.parse(readFileSync(FIXTURE, "utf8")) as WorldRecord[];
    expect(now.length).toBe(before.length);
    for (let i = 0; i < now.length; i++) expect(now[i], `seed ${before[i]!.seed}`).toEqual(before[i]);
  });

  it("keeps every trail edge LAKE_TRAIL_CLEAR outside every lake's shore, and every marsh between its shore and its shelf's inner edge", () => {
    let murky = 0, marshes = 0, valley = 0;
    const r = newLakeShore();
    for (const seed of LOBBY_SEEDS) {
      const b = bowlFor(seed);
      for (const f of b.features) {
        if (f.kind !== "pond") continue;
        valley++;
        const shape = f.shape!;
        for (const e of b.graph.edges) {
          const a = b.graph.nodes[e.a]!, c = b.graph.nodes[e.b]!;
          const steps = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z)));
          for (let k = 0; k <= steps; k++) {
            const x = a.x + ((c.x - a.x) * k) / steps, z = a.z + ((c.z - a.z) * k) / steps;
            expect(lakeShoreInto(r, shape, x, z).s, `seed ${seed} edge ${e.a}->${e.b}`).toBeLessThanOrEqual(-LAKE_TRAIL_CLEAR + 1e-9);
          }
        }
        if ((f.murk ?? 0) > MARSH_MURK_MIN) murky++;
        if (!f.lobe) continue;
        marshes++;
        const shelf = lakeShelfWidth(shape.sMax);
        for (const [x, z] of lobePoints(shape, f.lobe, 2)) {
          const s = lakeShoreInto(r, shape, x, z).s;
          expect(s, `seed ${seed}`).toBeGreaterThan(0);
          expect(s, `seed ${seed}`).toBeLessThan(shelf);
        }
      }
    }
    console.info(`[waterTerrainSweep] worlds with a valley lake: ${valley} of ${LOBBY_SEEDS.length} (101 had a pond before the outlines)`);
    // every murky lake has its marsh, and there are some
    expect(marshes).toBe(murky);
    expect(marshes).toBeGreaterThan(10);
  });

  it("holds each lake as one body at its level, with no puddle in its box (spec §13.2)", () => {
    const v = variantOrThrow("olympic");
    let checked = 0;
    for (const { seed, f, shape } of lakes()) {
      const g = lakeGrid(shape, (x, z) => v.sample(seed, x, z).h);
      const { n, h, s } = g;
      const below = (c: number): boolean => h[c]! < shape.level;
      // The marsh's own dips are the lake's.
      const marsh = (c: number): boolean => marshWeightAt(shape, f.lobe, g.x0 + (c % n) * GRID_STEP, g.z0 + Math.floor(c / n) * GRID_STEP) > 0;
      const comp = new Int32Array(n * n).fill(-1);
      let comps = 0;
      const touchesEdge: boolean[] = [], holdsLake: boolean[] = [], drawn: boolean[] = [];
      for (let c0 = 0; c0 < n * n; c0++) {
        if (!below(c0) || comp[c0] !== -1) continue;
        const id = comps++;
        touchesEdge.push(false); holdsLake.push(false); drawn.push(false);
        const stack = [c0];
        comp[c0] = id;
        while (stack.length > 0) {
          const c = stack.pop()!;
          const i = c % n, j = (c - i) / n;
          if (i === 0 || j === 0 || i === n - 1 || j === n - 1) touchesEdge[id] = true;
          if (s[c]! > 0 || marsh(c)) holdsLake[id] = true;
          // The lake's water is drawn 3 m past its shore (its surface's reach).
          if (s[c]! > -3) drawn[id] = true;
          for (const m of [i > 0 ? c - 1 : -1, i < n - 1 ? c + 1 : -1, j > 0 ? c - n : -1, j < n - 1 ? c + n : -1]) {
            if (m >= 0 && comp[m] === -1 && below(m)) { comp[m] = id; stack.push(m); }
          }
        }
      }
      // Every cell well under the level inside the shore lies in one body,
      // but for the marsh's own dips, which are the lake's.
      const bodies = new Set<number>();
      for (let c = 0; c < n * n; c++) if (s[c]! > 0 && h[c]! < shape.level - 0.06 && !marsh(c)) bodies.add(comp[c]!);
      expect(bodies.size, `seed ${seed}`).toBe(1);
      // No ground under the level within the water's reach that is not the
      // lake and does not reach the box's edge: no puddle the surface would draw.
      for (let id = 0; id < comps; id++) {
        if (!drawn[id]) continue;
        expect(holdsLake[id]! || touchesEdge[id]!, `seed ${seed}: a puddle`).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("spills each lake through its outlet at the sill, to 0.1 m, and nowhere lower (spec §5.4, §13.2)", () => {
    for (const { seed, shape } of lakes()) {
      const { crest, xs, zs } = crestsOf(shape, (x, z) => untrailed(seed, x, z));
      const sp = shape.spout!;
      expect(Math.abs(Math.min(...crest) - LAKE_SILL), `seed ${seed}`).toBeLessThanOrEqual(0.1);
      // Away from the spout's end and its notch every way out stands 0.1 m over the sill.
      for (let i = 0; i < crest.length; i++) {
        if (Math.hypot(xs[i]! - sp.bx, zs[i]! - sp.bz) <= sp.half + LAKE_NOTCH_FADE + 8) continue;
        expect(crest[i]!, `seed ${seed} (${xs[i]!.toFixed(1)}, ${zs[i]!.toFixed(1)})`).toBeGreaterThanOrEqual(LAKE_SILL + 0.1);
      }
    }
  });

  it("keeps the bank over the level within the water's 3 m reach under the trail's corridor, and the spill at the sill", () => {
    // The corridor reaches 7 m from an edge's centreline, so an edge at
    // s = −7 still blends the bank a few metres in: the composed ground
    // 0.5 to 3 m outside the shore must still stand over the water, away
    // from the notch, and the water must still leave by the sill.
    const v = variantOrThrow("olympic");
    const r = newLakeShore();
    for (const { seed, f, shape } of lakes()) {
      const o = lakeOutline(shape, 1);
      const sp = shape.spout!;
      for (let i = 0; i < o.xs.length; i++) {
        const x0 = o.xs[i]!, z0 = o.zs[i]!;
        if (Math.hypot(x0 - sp.bx, z0 - sp.bz) <= sp.half + LAKE_NOTCH_FADE + 6) continue;
        lakeShoreInto(r, shape, x0, z0);
        const gl = Math.hypot(r.sx, r.sz);
        for (const t of [0.5, 1, 2, 3]) {
          const x = x0 - (r.sx / gl) * t, z = z0 - (r.sz / gl) * t;
          if (marshWeightAt(shape, f.lobe, x, z) > 0) continue;
          expect(v.sample(seed, x, z).h, `seed ${seed} (${x.toFixed(1)}, ${z.toFixed(1)}) t ${t}`).toBeGreaterThanOrEqual(shape.level);
        }
      }
      const { crest } = crestsOf(shape, (x, z) => v.sample(seed, x, z).h);
      expect(Math.min(...crest), `seed ${seed}`).toBeGreaterThanOrEqual(LAKE_SILL - 0.1);
    }
  });

  it("gives every world its cove: the profile exactly, from the toe to the corridor, with no dunes", () => {
    const v = variantOrThrow("olympic");
    let backshore = 0;
    for (const seed of LOBBY_SEEDS) {
      // Inside the cove's full window, clear of the headlands and their stacks.
      for (const z of [-100, -50, 0, 50, 100]) {
        const cx = v.roadCenterX!(seed, z);
        const x0 = cx - v.coastDistance!(seed, cx, z);
        const inner = cx - ROAD_CORRIDOR_HALF - COVE_BACK_FADE; // the cove is whole seaward of here
        for (let d = -24; x0 + d <= inner; d += 0.5) {
          // The trail's stages leave a sub-millimetre tail on the backshore nearest the pad,
          // so the composed field is held to half a millimetre, the cove's own field exactly.
          const own = olympicPreTrailSample(seed, x0 + d, z).h;
          expect(own, `seed ${seed} z ${z} d ${d}`).toBeCloseTo(coveProfileD(d).v, 9);
          const h = v.sample(seed, x0 + d, z).h;
          expect(h, `seed ${seed} z ${z} d ${d}`).toBeCloseTo(coveProfileD(d).v, 3);
          if (d >= 40) backshore++;
        }
      }
    }
    // the mechanism fired on the backshore too, not only on the face
    expect(backshore).toBeGreaterThan(0);
  });

  it("keeps the cove's ground at or above the sea inland of the waterline, across its ends and under its headlands", () => {
    const v = variantOrThrow("olympic");
    for (const seed of LOBBY_SEEDS) {
      const c = coveFor(seed);
      for (let z = c.z0 - c.halfWidth - 60; z <= c.z0 + c.halfWidth + 60; z += 10) {
        const cx = v.roadCenterX!(seed, z);
        const x0 = cx - v.coastDistance!(seed, cx, z);
        for (let d = 0; d <= cx - ROAD_CORRIDOR_HALF - x0; d += 2) {
          expect(v.sample(seed, x0 + d, z).h, `seed ${seed} z ${z} d ${d}`).toBeGreaterThanOrEqual(-1e-9);
        }
      }
    }
  });

  it("floats every lily on its lake's water (spec §13.2)", () => {
    let lilies = 0;
    const r = newLakeShore();
    for (const seed of LOBBY_SEEDS) {
      for (const f of bowlFor(seed).features) {
        if (f.kind !== "pond" || (f.murk ?? 0) < 0.8) continue;
        const reach = f.radius + POND_SHORE + 1;
        for (const inst of clutterInRect(seed, CLUTTER_LILY, f.x - reach, f.z - reach, f.x + reach, f.z + reach)) {
          lilies++;
          expect(lakeShoreInto(r, f.shape!, inst.x, inst.z).s, `seed ${seed} (${inst.x}, ${inst.z})`).toBeGreaterThan(0);
        }
      }
    }
    expect(lilies).toBeGreaterThan(500);
  });
});
