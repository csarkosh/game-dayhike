// client/test/sim/waterTerrainSweep.test.ts
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bowlFor } from "../../src/sim/olympic.js";
import { variantOrThrow } from "./helpers/derivatives.js";
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
});
