// client/test/sim/waterTerrainSweep.test.ts
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bowlFor, coveFor, coveProfileD, COVE_BACK_FADE } from "../../src/sim/olympic.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { variantOrThrow } from "./helpers/derivatives.js";
import { segmentDistance } from "../../src/sim/trail.js";
import { lobePoints, LAKE_SHELF_WIDTH, MARSH_MURK_MIN } from "../../src/sim/features.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * The water terrain's 200-world scan. The bowl's build must not move: every
 * feature, the trail graph and the field in the road's corridor and at the pad
 * are compared with a fixture recorded on `origin/main` before any of the water
 * terrain's code existed (`RECORD_WATER_BASELINE=1` writes it; nothing else
 * may). Later tasks add the lobe's and the cove's invariants here, so every
 * world is built once per run.
 */
const FIXTURE = fileURLToPath(new URL("./fixtures/waterBaseline.json", import.meta.url));

type FeatureRecord = {
  id: number; kind: string; x: number; z: number; radius: number; height: number; crestH: number | null;
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

describe("the water terrain over 200 worlds", { timeout: timeLimit(900_000) }, () => {
  it("builds every world's features, trail and road as origin/main did", () => {
    const now = worlds();
    if (process.env.RECORD_WATER_BASELINE === "1") {
      writeFileSync(FIXTURE, "[\n" + now.map((w) => JSON.stringify(w)).join(",\n") + "\n]\n");
      return;
    }
    expect(existsSync(FIXTURE), "record the baseline on origin/main's code first").toBe(true);
    const before = JSON.parse(readFileSync(FIXTURE, "utf8")) as WorldRecord[];
    expect(now.length).toBe(before.length);
    for (let i = 0; i < now.length; i++) expect(now[i], `seed ${before[i]!.seed}`).toEqual(before[i]);
  });

  it("keeps every trail edge out of every lake, and every marsh between its wall and its rim", () => {
    let murky = 0, marshes = 0;
    for (const seed of LOBBY_SEEDS) {
      const b = bowlFor(seed);
      for (const f of b.features) {
        if (f.kind !== "pond") continue;
        let nearest = Infinity;
        for (const e of b.graph.edges) {
          const a = b.graph.nodes[e.a]!, c = b.graph.nodes[e.b]!;
          nearest = Math.min(nearest, segmentDistance(a.x, a.z, c.x, c.z, f.x, f.z));
        }
        expect(nearest, `seed ${seed}: a trail edge inside the lake`).toBeGreaterThanOrEqual(f.radius);
        if ((f.murk ?? 0) > MARSH_MURK_MIN) murky++;
        if (!f.lobe) continue;
        marshes++;
        for (const [x, z] of lobePoints(f, 2)) {
          const q = Math.hypot(x - f.x, z - f.z);
          expect(q, `seed ${seed}`).toBeGreaterThan(f.radius - LAKE_SHELF_WIDTH);
          expect(q, `seed ${seed}`).toBeLessThan(f.radius);
        }
      }
    }
    // every murky lake has its marsh, and there are some
    expect(marshes).toBe(murky);
    expect(marshes).toBeGreaterThan(10);
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
          const h = v.sample(seed, x0 + d, z).h;
          expect(h, `seed ${seed} z ${z} d ${d}`).toBeCloseTo(coveProfileD(d).v, 9);
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
});
