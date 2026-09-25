import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { generateChunk } from "../../src/sim/chunk.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import {
  setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, terrainVariant, activeTerrainVariant,
} from "../../src/sim/terrain.js";
import type { Brush } from "../../src/sim/level.js";
import {
  CAR_HALF, POST_HALF, SIGN_HALF, CAR_ROAD_Z, PROPS, propSite,
} from "../../src/sim/passes/trailhead.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { TRAILHEAD_U, TRAILHEAD_RADIUS } from "../../src/sim/bowl.js";
import { SEEDS } from "./trailGateSeeds.js";

/** Every prop brush in the 3×3 chunks around a world point. `chunkAt` is the
 * grid's only surface that keeps `Brush.material`; `allBoxesIn` returns bare
 * `Aabb`s. Props are emitted into the chunk holding their CENTRE, and every
 * offset here is under CHUNK_SIZE, so the 3×3 block always contains them. */
function propsAround(grid: ReturnType<typeof createChunkGrid>, x: number, z: number): Brush[] {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  const out: Brush[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(...grid.chunkAt(cx + dx, cz + dz).props);
  return out;
}

/** The variant's road centreline x at z. */
function roadCenterXOf(seed: number, z: number): number {
  return activeTerrainVariant().roadCenterX!(seed, z);
}

/** The chunk holding a world point — how the trailhead pass emits its props. */
function chunkHolding(seed: number, x: number, z: number) {
  return generateChunk(seed, Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
}

describe("the trailhead pass", () => {
  // 120000 -> 300000 (2026-09-11): `bowlFor`
  // costs 433 ms a seed now that loops actually route (230 ms before), so a
  // 227-seed sweep needs ~100 s of its own and was timing out
  // against the 120 s box once the whole suite competed for the CPU. The tests
  // were not failing, they were running out of clock.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  it("emits a post and a sign on the flat, once, in the road frame", () => {
    for (const seed of [0x5eed, 1, 12345]) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const th = graph.trailhead;
      const grid = createChunkGrid(seed);
      const props = propsAround(grid, th.x, th.z);
      const pillars = props.filter((b) => b.material === "pillar");
      expect(pillars.length, `seed ${seed}`).toBe(2);
      const sizes = pillars.map((p) => p.box.max.y - p.box.min.y).sort();
      expect(sizes[0]).toBeCloseTo(2 * POST_HALF.y, 6);
      expect(sizes[1]).toBeCloseTo(2 * SIGN_HALF.y, 6);
      // The EMITTED boxes, not a recomputed centre: each pillar's road-side
      // face clears the pavement. The sweep below holds the same
      // predicate on the frame itself over all 227 seeds.
      for (const b of pillars) {
        const zMid = (b.box.min.z + b.box.max.z) / 2;
        expect(b.box.min.x - roadCenterXOf(seed, zMid), `seed ${seed}`).toBeGreaterThanOrEqual(ROAD_BED_HALF + 0.5);
      }
    }
  }, 60_000);

  it("puts the pad centre 9 m from the road centreline on every seed, and the car on the shoulder beside it", () => {
    for (const seed of SEEDS) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const rx = roadCenterXOf(seed, graph.trailhead.z);
      expect(Math.abs(graph.trailhead.x - rx - TRAILHEAD_U)).toBeLessThan(1e-6);
      expect(TRAILHEAD_U).toBe(9);
      // The car: a box in the road frame, its road-side face ROAD_BED_HALF +
      // 0.5 off the pavement edge AT ITS OWN z (the centreline curves, so the
      // pass evaluates it at the prop's z, not at the anchor's), on whichever
      // side of the pad `propSite` puts it.
      const carProp = PROPS.find((p) => p.material === "crate")!;
      const car0 = propSite(graph, v.roadCenterX!, seed, carProp);
      const carRx = roadCenterXOf(seed, car0.z);
      const chunk = chunkHolding(seed, car0.x, car0.z);
      const car = chunk.props.find((p) => p.material === "crate");
      expect(car, `seed ${seed}`).toBeDefined();
      expect(car!.box.min.x - carRx).toBeCloseTo(ROAD_BED_HALF + 0.5, 6);
      expect(car!.box.max.z - car!.box.min.z).toBeCloseTo(2 * CAR_HALF.z, 6);
      expect(Math.abs(Math.abs(car0.z - graph.trailhead.z) - CAR_ROAD_Z)).toBeLessThan(1e-9);
      // Off the pad: no corner inside TRAILHEAD_RADIUS of the pad centre.
      const corners: Array<[number, number]> = [
        [car!.box.min.x, car!.box.min.z],
        [car!.box.max.x, car!.box.max.z],
      ];
      for (const [cx, cz] of corners) {
        expect(Math.hypot(cx - graph.trailhead.x, cz - graph.trailhead.z)).toBeGreaterThan(TRAILHEAD_RADIUS);
      }
    }
  }, 300000);

  it("keeps every trailhead prop off the road bed AND clear of the trail bed, over the 227-seed sweep", () => {
    // TWO CLAUSES, both over the same 227 seeds trailBed.test.ts requires.
    //
    // (a) OFF THE ROAD (2026-09-11). The post and
    // the sign used to be placed in a departure frame pointing into the
    // widest FREE wedge at node 0 — away from the trail. With TRAILHEAD_U
    // moved to 9 the trail leaves the pad inland, so "away" pointed at the
    // highway: 38 of the first 40 sweep seeds measured with the
    // post or the sign standing on the pavement, and this sweep never looked
    // at the road at all. Both frames are gone; every prop is placed at
    // a fixed u in the ROAD frame, and this asserts the consequence — the
    // box's ROAD-SIDE FACE (min.x, the road is at lower x) is at least
    // ROAD_BED_HALF + 0.5 from the centreline at the prop's own z.
    //
    // (b) CLEAR OF THE TRAIL BED. The distance from every
    // prop's centre to every edge's centreline (trailDistance, a plain min
    // over the graph's edges) must clear the bed's half-width plus the prop's
    // own half-extent plus a 0.5 m margin. The car is inside the gate now
    // that it is one of the same three props; at u ≈ 6.9 it is outside the
    // bowl the trail graph is built in, so its own margin is large.
    //
    // NO EXCEPTIONS LIST: track the WORST seed per prop and assert once, the
    // way trailBed.test.ts's bucket-fit test does, rather than stopping at
    // the first offender — but nothing here widens a threshold or drops a
    // seed.
    const v = terrainVariant("olympic")!;
    for (const p of PROPS) {
      const bedThreshold = TRAIL_BED_HALF + Math.max(p.half.x, p.half.z) + 0.5;
      let worstRoad = Infinity, worstRoadSeed = 0;
      let worstBed = Infinity, worstBedSeed = 0;
      let mirrored = 0;
      for (const seed of SEEDS) {
        const graph = v.trailGraph!(seed);
        const site = propSite(graph, v.roadCenterX!, seed, p);
        if (site.z !== graph.trailhead.z + p.z) mirrored++;
        const rx = roadCenterXOf(seed, site.z);
        const road = (site.x - p.half.x) - rx - (ROAD_BED_HALF + 0.5);
        if (road < worstRoad) { worstRoad = road; worstRoadSeed = seed; }
        const bed = v.trailDistance!(seed, site.x, site.z) - bedThreshold;
        if (bed < worstBed) { worstBed = bed; worstBedSeed = seed; }
      }
      console.info(`[trailhead] ${p.material} u=${p.u}: mirrored on ${mirrored}/${SEEDS.length} seeds, worst road margin ${worstRoad.toFixed(2)} m, worst bed margin ${worstBed.toFixed(2)} m`);
      expect(worstRoad, `${p.material} u=${p.u} off the road bed, worst seed ${worstRoadSeed}`).toBeGreaterThanOrEqual(0);
      expect(worstBed, `${p.material} u=${p.u} clear of the trail bed, worst seed ${worstBedSeed}`).toBeGreaterThanOrEqual(0);
    }
  }, 300000);
});
