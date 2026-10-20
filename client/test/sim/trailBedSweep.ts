import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor, olympicPreTrailSample } from "../../src/sim/olympic.js";
import { elevationSampleAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { MAX_WALKABLE_GRADIENT } from "../../src/sim/ground.js";
import { TRAIL_PAINT_MAX_SEGMENTS, TRAIL_PAINT_BUCKET_MAX, buildTrailTable, trailSegments } from "../../src/game/trailPaint.js";
import { featureStageD } from "../../src/sim/features.js";
import type { EdgeKind } from "../../src/sim/trail.js";
import { SEEDS } from "./trailGateSeeds.js";
import { seedPart } from "../helpers/seedPart.js";

/**
 * THE BED SCAN — the regression gate on the UNION.
 *
 * Every other trail test measures something one edge controls: its own
 * profile's slope, a node's own containment, one seed's walk. This one
 * measures the thing the player actually stands on — the COMPOSED field, base
 * → cliffs → dunes → the trailhead pad → the made features' stages (the
 * peak's dome, a meadow's flat, a pond's basin — the carved overlook they
 * replaced is deleted) → the union of every corridor — along the centreline
 * of every edge of every graph,
 * and asserts the gradient there never exceeds MAX_WALKABLE_GRADIENT.
 *
 * It exists because the builder's invariants are LOCAL and the field is a
 * union: the grid says a cell is walkable, the fine check says an edge's own
 * smoothed profile is under TRAIL_HARD_SLOPE_MAX, and neither has seen what
 * happens where two corridors overlap or where a corridor meets the pad. At
 * `2aede553`, under the fan-and-chord builder this replaced, the same scan
 * found ~3 % of seeds carrying a step the player cannot walk. It also carries
 * the FLUSH measurement: the bed is the ground now, so the
 * distance between the composed field and the pre-trail ground along a
 * centreline is the number that says so, and it is a gate rather than a note.
 *
 * NO EXCEPTION LISTS. An earlier version carried two transitional ones — a
 * walk-scan allowlist for seed 604923172 and a cut-measurement allowlist —
 * both fallout of the chord builder crossing the apron's own ground. That
 * builder is gone (2026-09-09) and so are they: the scan
 * asserts on every edge of every seed.
 *
 * The seeds are REALISTIC — `seedFromToken` over lobby-shaped room ids, which is
 * how `app.ts` derives the world seed — plus the five probe seeds the rest of
 * the suite uses, plus the sequential seeds measured to hold its worst cases.
 * Test code may use `Math.hypot`; `sim/` may not.
 *
 * The scan runs in parts (`seedPart`), the walk, the flush and the paint's
 * buckets each over the part's own seeds, so the part builds its worlds once
 * for all three. Every check but the flush's p95 is the worst any seed reads
 * against a fixed bound, which the parts hold together as the scan whole did;
 * a part's p95 is held to the same 0.5 m, and a p95 within it on every part
 * puts the whole scan's within it too (no part has more than a twentieth of
 * its samples over 0.5 m, so the whole has no more than a twentieth of
 * its). As one file the scan was one of the floors under the client suite:
 * vitest hands out files, and its 227 worlds took about 390 s on a CI runner.
 *
 * Its limits went from 120 s to 300 s when `bowlFor` came to cost 433 ms a
 * seed once loops actually routed (230 ms before), so a 227-seed sweep
 * needed ~100 s of its own and was timing out against the 120 s box once the
 * whole suite competed for the CPU. The tests were not failing, they were
 * running out of clock.
 */

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

// SEEDS (the 227-seed sweep: PROBE + REVIEW + LOBBY) moved to
// `trailGateSeeds.ts` so the trailhead's sweep (`trailheadSweep.ts`) can
// share it verbatim.

/** The parts the scan is split into, one test file each (`trailBedSweep.part<k>.test.ts`). */
export const BED_PARTS = 6;

/** The walk: the worst gradient on any edge of the part's worlds, by kind, and the seeds that fell back. */
export function checkBedWalkPart(part: number): void {
  // Worst gradient per edge KIND, so a failure says which of the two the
  // builder let through rather than only that one got through. <= 1 m steps:
  // the corridor's transverse blend is 3 m wide and the union's crossover is
  // narrower still, so a coarser walk can step over the very feature this is
  // looking for.
  const worst: Record<EdgeKind, { g: number; seed: number; edge: string }> = {
    stem: { g: 0, seed: 0, edge: "" }, loop: { g: 0, seed: 0, edge: "" },
    strand: { g: 0, seed: 0, edge: "" }, rung: { g: 0, seed: 0, edge: "" },
  };
  let fallbackSeeds = 0;
  for (const seed of seedPart(SEEDS, part, BED_PARTS)) {
    const { graph } = bowlFor(seed);
    if (graph.fallbacks > 0) fallbackSeeds++;
    for (const e of graph.edges) {
      const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(L));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const s = elevationSampleAt(seed, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        const g = Math.hypot(s.dx, s.dz);
        if (g > worst[e.kind].g) worst[e.kind] = { g, seed, edge: `${e.a}->${e.b}` };
      }
    }
  }
  const over = (Object.keys(worst) as EdgeKind[]).filter((k) => worst[k].g > MAX_WALKABLE_GRADIENT);
  // `fallbackSeeds === 0` is an ASSERTION, not a report (2026-09-09).
  // `graph.fallbacks` still exists and a world still builds when
  // every candidate fails — a seed that cannot make a trail must not throw —
  // but a fallback is a bed the fine check rejected and the builder shipped
  // anyway, and on this seed set there must not be one.
  expect({ over, worst, fallbackSeeds }).toEqual({ over: [], worst, fallbackSeeds: 0 });
  // 120 s: this scan builds 227 bowls (the grid, four searches, their
  // reroutes and a composed fine check per attempt) and walks every edge of
  // each at <= 1 m. Same reasoning as
  // clutter.test.ts's own explicit timeout: give the slow scans room instead
  // of letting the machine's load decide whether the gate runs.
  // 227 worlds built, about a second each with the valley lakes: 296 s.
}

/** The flush: the bed against the pre-trail ground with its domes, along every centreline of the part's worlds. */
export function checkBedFlushPart(part: number): void {
  // |composed − pre-trail-with-domes| along every centreline at <= 1 m. The
  // invariant: p95 <= 0.5 m. Measured here over the 227 gate
  // seeds: p50 0.057, p95 0.296, max 1.517.
  //
  // The MAX ceiling is 2, re-pinned 2026-09-09 from an earlier 1.5 (which
  // an earlier measurement checked against 1.25, over 55 seeds), and the
  // expected row moves with it. The tail is not routing slop — it is the bed
  // doing its job in the TWO places the ground is not smooth at the profile's
  // own scale: (1) the trail's first edge crossing the PAD's own fade ring,
  // where padD holds a disc at its centre height and the step it leaves is
  // steeper than anything the terrain has; and (2) mid-edge over a real
  // ridgelet narrower than the 8 m kernel, on steep ground. Corrected later:
  // an earlier version of this comment blamed the second-largest
  // residual on the 1–3 m overlap either side of a node, which turned out
  // false — NO sample within 4 m of a node exceeds 1.5, and the seed it
  // named tops out at 0.893. p95 — the invariant that says "the bed IS the
  // ground" — is what this test is really for, and it sits well inside 0.5.
  // The residual at a node is no longer zero by construction (a node's height
  // is the de-clodded ground, not the raw ground), which is what a p95 of a
  // few centimetres is measuring.
  //
  // Re-pinned 2026-10-10 from 2 to 2.6, with the valley lakes: a third
  // place, (3) a lake loop's bed is smoothed across the apron's fill at 13
  // to 22 m from the shore, as a built trail cuts and fills. Measured: p50
  // 0.078, p95 0.375, max 2.520 (seed -1725488583, loop edge 23, 21.7 m
  // out from the shore); the fifteen samples over 2 m are all on a lake's
  // loop, 16.5 to 22.4 m out.
  const resid: number[] = [];
  for (const seed of seedPart(SEEDS, part, BED_PARTS)) {
    const { graph, features } = bowlFor(seed);
    for (const e of graph.edges) {
      const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(L));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const ground = featureStageD(features, x, z, olympicPreTrailSample(seed, x, z)).h;
        resid.push(Math.abs(elevationSampleAt(seed, x, z).h - ground));
      }
    }
  }
  resid.sort((p, q) => p - q);
  const q = (f: number) => resid[Math.min(resid.length - 1, Math.floor(f * resid.length))]!;
  const stats = { part: `${part} of ${BED_PARTS}`, p50: q(0.5), p95: q(0.95), max: resid[resid.length - 1]! };
  expect(stats.p95, JSON.stringify(stats)).toBeLessThanOrEqual(0.5);
  expect(stats.max, JSON.stringify(stats)).toBeLessThanOrEqual(2.6);
  // 227 worlds built, about a second each with the valley lakes, and read along every edge: 296 s.
}

/** The paint: every one of the part's worlds fits its segments in the paint's buckets. */
export function checkBedBucketsPart(part: number): void {
  let worstBucket = 0, worstCount = 0;
  for (const seed of seedPart(SEEDS, part, BED_PARTS)) {
    const t = buildTrailTable(trailSegments(bowlFor(seed).graph));
    expect(t.overflow, `seed ${seed} overflowed the segment table`).toBe(false);
    worstBucket = Math.max(worstBucket, t.bucketMax);
    worstCount = Math.max(worstCount, t.count);
  }
  // Pre-flight over 55 seeds: at most 25 in a bucket, ≤ 180 edges a world.
  // Measured over the 227-seed sweep: bucketMax 13, worst count 141.
  expect(worstBucket).toBeLessThanOrEqual(TRAIL_PAINT_BUCKET_MAX);
  expect(worstCount).toBeLessThanOrEqual(TRAIL_PAINT_MAX_SEGMENTS);
}
