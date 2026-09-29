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
  BOARD_BOX_HALF, CAR_HALF, bedGap, boardBoxes, boardSite, carSite, trailEntrance, trailheadPlaces,
} from "../../src/sim/trailhead.js";
import { trailheadSpawn, type Start } from "../../src/sim/spawn.js";
import { facingYaw } from "../../src/sim/facing.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
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
  it("emits one car and the board's five boxes at the trailhead, once", () => {
    for (const seed of [0x5eed, 1, 12345]) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const th = graph.trailhead;
      const grid = createChunkGrid(seed);
      const props = propsAround(grid, th.x, th.z);
      expect(props.filter((b) => b.material === "car"), `seed ${seed}`).toHaveLength(1);
      const kiosks = props.filter((b) => b.material === "kiosk");
      expect(kiosks, `seed ${seed}`).toHaveLength(5);
      const places = trailheadPlaces(graph, v.roadCenterX!, seed);
      const centres = boardBoxes(places.board);
      for (const c of centres) {
        const box = kiosks.find((b) => Math.abs(b.box.min.x + 0.275 - c.x) < 1e-6 && Math.abs(b.box.min.z + 0.275 - c.z) < 1e-6);
        expect(box, `seed ${seed} box at ${c.x}, ${c.z}`).toBeDefined();
        expect(box!.box.max.x - box!.box.min.x).toBeCloseTo(0.55, 6);
        expect(box!.box.max.y - box!.box.min.y).toBeCloseTo(2.5, 6);
        expect(box!.box.max.z - box!.box.min.z).toBeCloseTo(0.55, 6);
      }
      // The post at the entrance is gone: the only sign posts are the junctions'.
      expect(props.filter((b) => b.material === "signpost" && Math.hypot(b.box.min.x - th.x, b.box.min.z - th.z) < 12), `seed ${seed}`).toHaveLength(0);
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
    // 2026-09-29: it stood at the pad on 216 seeds, and slid 3 m on 1 and
    // 3.5 m on 10. The trail leaves the pad inland now, through the doorway
    // (`closeShore`), and nowhere runs along the car's flank.
    expect([...slides].sort((a, b) => a[0] - b[0])).toEqual([[0, 227]]);
    expect(leastGap, `seed ${leastSeed}`).toBeGreaterThanOrEqual(1.15);
  }, timeLimit(300000));

  it("keeps the car off the road bed and clear of the trail bed, over the 227-seed sweep", () => {
    // TWO CLAUSES, both over the same 227 seeds trailBed.test.ts requires.
    //
    // (a) OFF THE ROAD. The car's ROAD-SIDE FACE (min.x, the road is at
    // lower x) is ROAD_BED_HALF + 0.5 from the centreline at the car's own
    // z, where the centreline curves.
    //
    // (b) CLEAR OF THE TRAIL BED. The bed's centreline, on any edge, is at
    // least 1.15 m from the car's box: the bed's half-width and a player's.
    // The car stands beside the pad's centre, where the bed begins, so the
    // measure is to its box and not to its centre.
    //
    // The board's own clauses are in "the board's place" below.
    //
    // NO EXCEPTIONS LIST: track the WORST seed and assert once, the way
    // trailBed.test.ts's bucket-fit test does, rather than stopping at the
    // first offender — but nothing here widens a threshold or drops a seed.
    const v = terrainVariant("olympic")!;
    let worstRoad = Infinity, worstRoadSeed = 0;
    let worstBed = Infinity, worstBedSeed = 0;
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const site = carSite(graph, v.roadCenterX!, seed);
      const rx = roadCenterXOf(seed, site.z);
      const road = (site.x - CAR_HALF.x) - rx - (ROAD_BED_HALF + 0.5);
      if (road < worstRoad) { worstRoad = road; worstRoadSeed = seed; }
      const bed = bedGap(graph, site, CAR_HALF) - 1.15;
      if (bed < worstBed) { worstBed = bed; worstBedSeed = seed; }
    }
    console.info(`[trailhead] car: worst road margin ${worstRoad.toFixed(2)} m, worst bed margin ${worstBed.toFixed(2)} m`);
    expect(worstRoad, `off the road bed, worst seed ${worstRoadSeed}`).toBeGreaterThanOrEqual(-1e-9);
    expect(worstBed, `clear of the trail bed, worst seed ${worstBedSeed}`).toBeGreaterThanOrEqual(0);
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

});

describe("the player's place", () => {
  it("stands the player in front of the car, facing the trail's entrance, on every seed", () => {
    const v = terrainVariant("olympic")!;
    const gapTo = (x: number, z: number, c: { x: number; z: number }, h: { x: number; z: number }): number =>
      Math.hypot(Math.max(Math.abs(x - c.x) - h.x, 0), Math.max(Math.abs(z - c.z) - h.z, 0));
    let behind = Infinity, ahead = 0, axis = 0, carGap = Infinity, boardGap = Infinity, road = Infinity, reach = 0;
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const car = carSite(graph, v.roadCenterX!, seed);
      const s = trailheadSpawn(graph, car);
      const board = boardSite(graph, v.roadCenterX!, seed, s);
      const e = trailEntrance(graph);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const off = (x: number, z: number): number => {
        const d = Math.hypot(x - s.x, z - s.z);
        const c = ((x - s.x) * fx + (z - s.z) * fz) / d;
        return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      };
      behind = Math.min(behind, off(car.x, car.z));
      ahead = Math.max(ahead, off(e.x, e.z));
      axis = Math.max(axis, (Math.acos(Math.max(-1, Math.min(1, fx * e.dx + fz * e.dz))) * 180) / Math.PI);
      carGap = Math.min(carGap, gapTo(s.x, s.z, car, CAR_HALF));
      for (const b of boardBoxes(board)) boardGap = Math.min(boardGap, gapTo(s.x, s.z, b, BOARD_BOX_HALF));
      road = Math.min(road, s.x - roadCenterXOf(seed, s.z));
      reach = Math.max(reach, Math.hypot(e.x - s.x, e.z - s.z));
    }
    console.info(`[trailhead] player: car ${behind.toFixed(2)} deg off the facing at least, entrance ${ahead.toFixed(2)} at most, facing ${axis.toFixed(2)} off the trail's direction at most, ${carGap.toFixed(2)} m from the car, ${boardGap.toFixed(2)} m from the board, ${road.toFixed(2)} m from the centreline, ${reach.toFixed(2)} m from the entrance at most`);
    expect(behind).toBeGreaterThanOrEqual(175);
    expect(ahead).toBeLessThanOrEqual(5);
    expect(axis).toBeLessThanOrEqual(19);
    expect(carGap).toBeGreaterThanOrEqual(1.5);
    expect(boardGap).toBeGreaterThanOrEqual(6);
    expect(road).toBeGreaterThanOrEqual(7.5);
    expect(reach).toBeLessThanOrEqual(7);
  }, timeLimit(300000));
});

/** A player at a place, facing the entrance at (8, 0) as `trailheadSpawn` faces them. */
const arrives = (x: number, z: number): Start => ({ x, z, yaw: facingYaw(8 - x, 0 - z) });

describe("the board's place", () => {
  // The pad at the origin, the road along z at x = -9, the stem straight inland: the entrance is (8, 0).
  const inland = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);

  it("stands the board 4.5 m past the entrance and 2.5 m off the bed, facing where the player arrives", () => {
    const b = boardSite(inland, straightRoad, 1, arrives(1.3, -1));
    expect(b.x).toBeCloseTo(12.5, 9);
    expect(b.z).toBeCloseTo(2.5, 9);
    expect(b.fx).toBeCloseTo(-0.9544799780350298, 9);
    expect(b.fz).toBeCloseTo(-0.29827499313594685, 9);
    // Its own line is the player's right as they look at it: the facing turned a quarter turn.
    expect(b.ax).toBeCloseTo(0.29827499313594685, 9);
    expect(b.az).toBeCloseTo(-0.9544799780350298, 9);
  });

  it("takes the side toward which the player looks: a player off to -z looks across to +z", () => {
    expect(boardSite(inland, straightRoad, 1, arrives(1.3, -1)).z).toBeCloseTo(2.5, 9);
    expect(boardSite(inland, straightRoad, 1, arrives(1.3, 1)).z).toBeCloseTo(-2.5, 9);
  });

  it("takes +n where the two sides are as near the view's centre as each other", () => {
    const b = boardSite(inland, straightRoad, 1, arrives(1.3, 0));
    expect(b.x).toBeCloseTo(12.5, 9);
    expect(b.z).toBeCloseTo(2.5, 9);
    expect(b.fx).toBeCloseTo(-0.9759815859905213, 9);
    expect(b.fz).toBeCloseTo(-0.21785303258716995, 9);
  });

  it("takes the side that clears when the other does not, anywhere along it", () => {
    // A second bed runs along +z through every place the board could stand on that side, 2.5 m to 4.5 m past the entrance.
    const g = padGraph([[0, 0], [100, 0], [11.5, 1.2], [11.5, 60]], [[0, 1, "stem"], [2, 3, "loop"]]);
    const b = boardSite(g, straightRoad, 1, arrives(1.3, -1));
    expect(b.x).toBeCloseTo(12.5, 9);
    expect(b.z).toBeCloseTo(-2.5, 9);
  });

  it("steps back along the trail to stay on the side the player looks toward", () => {
    // A second bed runs along +z through the two furthest places on that
    // side, 4 m and 4.5 m past the entrance; 3.5 m past it the side clears.
    const g = padGraph([[0, 0], [100, 0], [13.5, 1.2], [13.5, 60]], [[0, 1, "stem"], [2, 3, "loop"]]);
    const b = boardSite(g, straightRoad, 1, arrives(1.3, -1));
    expect(b.x).toBeCloseTo(11.5, 9);
    expect(b.z).toBeCloseTo(2.5, 9);
    expect(b.fx).toBeCloseTo(-0.9458646319475186, 9);
    expect(b.fz).toBeCloseTo(-0.324561393315325, 9);
  });

  it("takes the place nearest the view's centre when none clears", () => {
    const g = padGraph(
      [[0, 0], [100, 0], [11.5, 1.2], [11.5, 60], [11.5, -1.2], [11.5, -60]],
      [[0, 1, "stem"], [2, 3, "loop"], [4, 5, "loop"]],
    );
    const b = boardSite(g, straightRoad, 1, arrives(1.3, -1));
    expect(b.x).toBeCloseTo(12.5, 9);
    expect(b.z).toBeCloseTo(2.5, 9);
    // And from the other side of the line, the other side of the trail.
    const c = boardSite(g, straightRoad, 1, arrives(1.3, 1));
    expect(c.x).toBeCloseTo(12.5, 9);
    expect(c.z).toBeCloseTo(-2.5, 9);
  });

  it("judges the board by its further end against the way the player faces", () => {
    // The trail leaves 18.4 degrees north of inland and then bends south, as it does on seed 173.
    // The player faces 4.0 degrees north of the entrance, which is the facing's own error there.
    const g = padGraph([[0, 0], [12, 4], [54, -52]], [[0, 1, "stem"], [1, 2, "stem"]]);
    const s = trailheadSpawn(g, carSite(g, straightRoad, 1));
    expect(s.x).toBeCloseTo(1.2189129331667146, 9);
    expect(s.z).toBeCloseTo(0.866534755019326, 9);
    expect(s.yaw).toBeCloseTo(1.2455862867634584, 9);
    const b = boardSite(g, straightRoad, 1, s);
    // North of the bed, 4.5 m past the entrance: its further end is 15.94 degrees from the
    // view's centre. South of it and 3 m past, where its centre is nearer the line to the
    // entrance, its further end would be 23.5 degrees from the view's centre.
    expect(b.x).toBeCloseTo(11.067971810589327, 9);
    expect(b.z).toBeCloseTo(6.324555320336759, 9);
  });

  it("lays five boxes along the board's own line, 2.31 m from end to end at any facing", () => {
    const b = boardSite(inland, straightRoad, 1, arrives(1.3, 0));
    const boxes = boardBoxes(b);
    expect(boxes).toHaveLength(5);
    expect(boxes[2]).toEqual({ x: b.x, z: b.z });
    expect(boxes[0]!.x).toBeCloseTo(12.30828933132329, 9);
    expect(boxes[0]!.z).toBeCloseTo(3.3588637956716587, 9);
    expect(boxes[4]!.x).toBeCloseTo(12.69171066867671, 9);
    expect(boxes[4]!.z).toBeCloseTo(1.6411362043283413, 9);
    expect(Math.hypot(boxes[4]!.x - boxes[0]!.x, boxes[4]!.z - boxes[0]!.z) + 0.55).toBeCloseTo(2.31, 9);
    expect(BOARD_BOX_HALF).toEqual({ x: 0.275, y: 1.25, z: 0.275 });
  });

  it("stands in the player's view, clear of the bed, the road and the car, on every seed", () => {
    const v = terrainVariant("olympic")!;
    const boxGap = (a: { x: number; z: number }, c: { x: number; z: number }, h: { x: number; z: number }): number =>
      Math.hypot(Math.max(Math.abs(a.x - c.x) - 0.275 - h.x, 0), Math.max(Math.abs(a.z - c.z) - 0.275 - h.z, 0));
    let farEnd = 0, nearest = Infinity, farthest = 0, bed = Infinity, road = Infinity, carGap = Infinity, turned = 0;
    let plus = 0, minus = 0;
    const along = new Map<string, number>();
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const { car, start: s, board: b } = trailheadPlaces(graph, v.roadCenterX!, seed);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const off = (x: number, z: number): number => {
        const d = Math.hypot(x - s.x, z - s.z);
        return (Math.acos(Math.max(-1, Math.min(1, ((x - s.x) * fx + (z - s.z) * fz) / d))) * 180) / Math.PI;
      };
      farEnd = Math.max(farEnd, off(b.x + b.ax * 1.1, b.z + b.az * 1.1), off(b.x - b.ax * 1.1, b.z - b.az * 1.1));
      const d = Math.hypot(b.x - s.x, b.z - s.z);
      nearest = Math.min(nearest, d);
      farthest = Math.max(farthest, d);
      turned = Math.max(turned, Math.abs(b.fx * ((s.x - b.x) / d) + b.fz * ((s.z - b.z) / d) - 1));
      for (const box of boardBoxes(b)) {
        bed = Math.min(bed, bedGap(graph, box, BOARD_BOX_HALF));
        road = Math.min(road, box.x - 0.275 - roadCenterXOf(seed, box.z));
        carGap = Math.min(carGap, boxGap(box, car, CAR_HALF));
      }
      const e = trailEntrance(graph);
      if ((b.x - e.x) * -e.dz + (b.z - e.z) * e.dx > 0) plus++;
      else minus++;
      const past = ((b.x - e.x) * e.dx + (b.z - e.z) * e.dz).toFixed(1);
      along.set(past, (along.get(past) ?? 0) + 1);
    }
    console.info(`[trailhead] board: far end ${farEnd.toFixed(2)} deg off the facing at most, ${nearest.toFixed(2)}-${farthest.toFixed(2)} m from the player, bed ${bed.toFixed(2)} m, road ${road.toFixed(2)} m, car ${carGap.toFixed(2)} m, sides +n ${plus} -n ${minus}`);
    // An upright phone of 390 by 844 shows 21.3 degrees to each side.
    // 2026-09-29: the bound was 21, against 20.56 measured. The board's
    // place is judged by its further end as the player faces, and the
    // further end is 17.88 degrees from the view's centre at most.
    expect(farEnd).toBeLessThanOrEqual(18);
    expect(nearest).toBeGreaterThanOrEqual(7);
    expect(farthest).toBeLessThanOrEqual(12);
    expect(bed).toBeGreaterThanOrEqual(1.15);
    expect(road).toBeGreaterThanOrEqual(6);
    expect(carGap).toBeGreaterThanOrEqual(8.5);
    expect(turned).toBeLessThan(1e-9);
    // 2026-09-29: [63, 164], and three boards stepped back to 3 and 3.5 m,
    // with the trail as it ran and the board's centre judged from the line
    // to the entrance. Every board stands 4.5 m past the entrance now.
    expect([plus, minus]).toEqual([195, 32]);
    expect([...along].sort()).toEqual([["4.5", 227]]);
  }, timeLimit(300000));
});
