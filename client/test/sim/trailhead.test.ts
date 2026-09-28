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
  CAR_HALF, PROPS, bedGap, carSite, propSite, roadProp, trailEntrance, trailheadSite,
} from "../../src/sim/passes/trailhead.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { TRAIL_BED_HALF } from "../../src/sim/trail.js";
import type { TrailGraph, TrailEdge } from "../../src/sim/trail.js";
import { TRAILHEAD_U } from "../../src/sim/bowl.js";
import { SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

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

/** A graph of bare nodes and edges with its pad at the origin, 9 m from a road along z at x = -9. */
function padGraph(nodes: Array<[number, number]>, edges: Array<[number, number, TrailEdge["kind"]]>): TrailGraph {
  return {
    nodes: nodes.map(([x, z]) => ({ x, z, h: 0, u: 0 })),
    edges: edges.map(([a, b, kind]) => ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: 0, progress1: 1 })),
    trailhead: { x: 0, z: 0, u: 9 }, summit: 1, stem: [0], loops: [], features: [], stemLen: 100, fallbacks: 0,
    forks: [], homeDist: [], shortestHome: 100,
  };
}
const straightRoad = (): number => -9;

describe("the trailhead pass", () => {
  // 120000 -> 300000 (2026-09-11): `bowlFor`
  // costs 433 ms a seed now that loops actually route (230 ms before), so a
  // 227-seed sweep needs ~100 s of its own and was timing out
  // against the 120 s box once the whole suite competed for the CPU. The tests
  // were not failing, they were running out of clock.
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  it("holds two props, the kiosk and the car, found by material", () => {
    expect(PROPS.map((p) => p.material)).toEqual(["kiosk", "car"]);
    expect(roadProp("kiosk").half).toEqual({ x: 1.1, y: 1.25, z: 0.55 });
    expect(roadProp("car").half).toEqual({ x: 0.9, y: 0.8, z: 2.3 });
    expect(() => roadProp("pillar")).toThrow();
  });

  it("emits one kiosk and one car at the trailhead, once, in the road frame", () => {
    for (const seed of [0x5eed, 1, 12345]) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const th = graph.trailhead;
      const grid = createChunkGrid(seed);
      const props = propsAround(grid, th.x, th.z);
      expect(props.filter((b) => b.material === "pillar" || b.material === "crate"), `seed ${seed}`).toHaveLength(0);
      const kiosks = props.filter((b) => b.material === "kiosk");
      expect(kiosks.length, `seed ${seed}`).toBe(1);
      expect(props.filter((b) => b.material === "car").length, `seed ${seed}`).toBe(1);
      const k = kiosks[0]!.box;
      expect(k.max.x - k.min.x).toBeCloseTo(2.2, 6);
      expect(k.max.y - k.min.y).toBeCloseTo(2.5, 6);
      expect(k.max.z - k.min.z).toBeCloseTo(1.1, 6);
      // The EMITTED box, not a recomputed centre: the kiosk's road-side
      // face clears the pavement. The sweep below holds the same
      // predicate on the frame itself over all 227 seeds.
      for (const b of kiosks) {
        const zMid = (b.box.min.z + b.box.max.z) / 2;
        expect(b.box.min.x - roadCenterXOf(seed, zMid), `seed ${seed}`).toBeGreaterThanOrEqual(ROAD_BED_HALF + 0.5);
      }
    }
  }, timeLimit(60_000));

  it("puts the pad centre 9 m from the road centreline on every seed, and the car on the shoulder at the pad", () => {
    const slides = new Map<number, number>();
    let leastGap = Infinity, leastSeed = 0;
    for (const seed of SEEDS) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const rx = roadCenterXOf(seed, graph.trailhead.z);
      expect(Math.abs(graph.trailhead.x - rx - TRAILHEAD_U)).toBeLessThan(1e-6);
      expect(TRAILHEAD_U).toBe(9);
      // The car: a box in the road frame, its road-side face 6 m from the
      // centreline AT ITS OWN z (the centreline curves), which is 0.5 m off
      // the pavement's edge.
      const car0 = carSite(graph, v.roadCenterX!, seed);
      const carRx = roadCenterXOf(seed, car0.z);
      const chunk = chunkHolding(seed, car0.x, car0.z);
      const car = chunk.props.find((p) => p.material === "car");
      expect(car, `seed ${seed}`).toBeDefined();
      expect(car!.box.min.x - carRx).toBeCloseTo(6, 6);
      expect(car!.box.max.z - car!.box.min.z).toBeCloseTo(4.6, 6);
      // It stands at the pad, or has slid a whole number of half-metres
      // along the road, away from the way the trail heads.
      const along = car0.z - graph.trailhead.z;
      const slide = Math.round(Math.abs(along) * 2) / 2;
      expect(Math.abs(Math.abs(along) - slide), `seed ${seed}`).toBeLessThan(1e-9);
      slides.set(slide, (slides.get(slide) ?? 0) + 1);
      if (slide > 0) expect(Math.sign(along), `seed ${seed}`).toBe(trailEntrance(graph).dz > 0 ? -1 : 1);
      const gap = bedGap(graph, car0, CAR_HALF);
      if (gap < leastGap) { leastGap = gap; leastSeed = seed; }
    }
    console.info(`[trailhead] car: slides ${JSON.stringify([...slides].sort((a, b) => a[0] - b[0]))}, least bed gap ${leastGap.toFixed(3)} m on seed ${leastSeed}`);
    expect([...slides].sort((a, b) => a[0] - b[0])).toEqual([[0, 216], [3, 1], [3.5, 10]]);
    expect(leastGap, `seed ${leastSeed}`).toBeGreaterThanOrEqual(1.15);
  }, timeLimit(300000));

  it("keeps every trailhead prop off the road bed AND clear of the trail bed, over the 227-seed sweep", () => {
    // TWO CLAUSES, both over the same 227 seeds trailBed.test.ts requires.
    //
    // (a) OFF THE ROAD (2026-09-11). The post and
    // the sign used to be placed in a departure frame pointing into the
    // widest FREE wedge at node 0 — away from the trail. With TRAILHEAD_U
    // moved to 9 the trail leaves the pad inland, so "away" pointed at the
    // highway: 38 of the first 40 sweep seeds measured with the
    // post or the sign standing on the pavement, and this sweep never looked
    // at the road at all. (The post has since gone, and the sign is now
    // the kiosk.) Both frames are gone; every prop is placed at
    // a fixed u in the ROAD frame, and this asserts the consequence — the
    // box's ROAD-SIDE FACE (min.x, the road is at lower x) is at least
    // ROAD_BED_HALF + 0.5 from the centreline at the prop's own z.
    //
    // (b) CLEAR OF THE TRAIL BED. The distance from every
    // prop's centre to every edge's centreline (trailDistance, a plain min
    // over the graph's edges) must clear the bed's half-width plus the prop's
    // own half-extent plus a 0.5 m margin. The car is inside the gate now
    // that it is one of the same props; at u ≈ 6.9 it is outside the
    // bowl the trail graph is built in, so its own margin is large.
    //
    // NO EXCEPTIONS LIST: track the WORST seed per prop and assert once, the
    // way trailBed.test.ts's bucket-fit test does, rather than stopping at
    // the first offender — but nothing here widens a threshold or drops a
    // seed.
    const v = terrainVariant("olympic")!;
    for (const p of PROPS) {
      // The board keeps the mirrored-site rule and its centre-to-bed
      // threshold. The car stands by its own rule (`carSite`), beside the
      // pad's centre where the bed begins, so its clause is the gap from
      // the bed to its box: 1.15 m, a player's half-width off the bed's edge.
      const isCar = p.material === "car";
      const bedThreshold = TRAIL_BED_HALF + Math.max(p.half.x, p.half.z) + 0.5;
      let worstRoad = Infinity, worstRoadSeed = 0;
      let worstBed = Infinity, worstBedSeed = 0;
      let mirrored = 0;
      for (const seed of SEEDS) {
        const graph = v.trailGraph!(seed);
        const site = trailheadSite(graph, v.roadCenterX!, seed, p.material);
        if (!isCar && site.z !== graph.trailhead.z + p.z) mirrored++;
        const rx = roadCenterXOf(seed, site.z);
        const road = (site.x - p.half.x) - rx - (ROAD_BED_HALF + 0.5);
        if (road < worstRoad) { worstRoad = road; worstRoadSeed = seed; }
        const bed = isCar
          ? bedGap(graph, site, p.half) - 1.15
          : v.trailDistance!(seed, site.x, site.z) - bedThreshold;
        if (bed < worstBed) { worstBed = bed; worstBedSeed = seed; }
      }
      console.info(`[trailhead] ${p.material} u=${p.u}: mirrored on ${mirrored}/${SEEDS.length} seeds, worst road margin ${worstRoad.toFixed(2)} m, worst bed margin ${worstBed.toFixed(2)} m`);
      expect(worstRoad, `${p.material} u=${p.u} off the road bed, worst seed ${worstRoadSeed}`).toBeGreaterThanOrEqual(-1e-9);
      expect(worstBed, `${p.material} u=${p.u} clear of the trail bed, worst seed ${worstBedSeed}`).toBeGreaterThanOrEqual(0);
      expect(mirrored, `${p.material} mirrored`).toBe(isCar ? 0 : 15);
    }
  }, timeLimit(300000));
});

describe("the car's place", () => {
  it("finds the entrance where the stem's first edge crosses the pad's rim", () => {
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    expect(trailEntrance(g)).toEqual({ x: 8, z: 0, dx: 1, dz: 0 });
  });

  it("stands the car on the shoulder at the pad when the trail leaves straight inland", () => {
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    const car = carSite(g, straightRoad, 1);
    expect(car.x).toBeCloseTo(-2.1, 9);
    expect(car.z).toBe(0);
    expect(bedGap(g, car, CAR_HALF)).toBeCloseTo(1.2, 9);
  });

  it("slides the car away from the way the trail heads until the bed clears it", () => {
    // The trail leaves along +z, leaning 5.7 degrees toward the road: at the
    // pad the bed is 0.9652 m from the car's box, and 1.1642 m once the car
    // has slid 2 m toward -z.
    const g = padGraph([[0, 0], [-10, 100]], [[0, 1, "stem"]]);
    expect(bedGap(g, { x: -2.1, z: 0 }, CAR_HALF)).toBeCloseTo(0.9652, 4);
    const car = carSite(g, straightRoad, 1);
    expect(car.x).toBeCloseTo(-2.1, 9);
    expect(car.z).toBe(-2);
    expect(bedGap(g, car, CAR_HALF)).toBeCloseTo(1.1642, 4);
  });

  it("stops sliding at 8 m where no place clears the bed", () => {
    // The stem leaves along -z, so the car slides toward +z, where a second
    // bed runs along the shoulder through every place it could stand.
    const g = padGraph([[0, 0], [0, -100], [-1.5, 1], [-1.5, 100]], [[0, 1, "stem"], [2, 3, "loop"]]);
    const car = carSite(g, straightRoad, 1);
    expect(car.x).toBeCloseTo(-2.1, 9);
    expect(car.z).toBe(8);
  });

  it("gives the car by its own rule and the board by the mirrored one", () => {
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    expect(trailheadSite(g, straightRoad, 1, "car")).toEqual(carSite(g, straightRoad, 1));
    expect(trailheadSite(g, straightRoad, 1, "kiosk")).toEqual(propSite(g, straightRoad, 1, roadProp("kiosk")));
  });
});
