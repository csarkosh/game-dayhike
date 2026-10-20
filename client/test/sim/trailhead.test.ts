import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, terrainVariant } from "../../src/sim/terrain.js";
import type { Brush } from "../../src/sim/level.js";
import {
  BOARD_BOX_HALF, CAR_HALF, bedGap, boardBoxes, boardSite, carDirection, carSite, doorSpot, trailEntrance, trailheadPlaces,
} from "../../src/sim/trailhead.js";
import { trailheadSpawn, type Start } from "../../src/sim/spawn.js";
import { facingYaw } from "../../src/sim/facing.js";
import type { TrailGraph, TrailEdge } from "../../src/sim/trail.js";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * The trailhead's rules at known numbers, on hand-built graphs and three
 * probe seeds. The same rules on every world of the 227-seed sweep are
 * `trailheadSweep.ts`, run in parts (`trailheadSweep.part<k>.test.ts`).
 */

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

  it("faces +z at the pad and back toward the pad where it slid past it, with its door on the inland side, half a metre ahead", () => {
    // At the pad, level with the trailhead: nose to +z.
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    const car = carSite(g, straightRoad, 1);
    expect(carDirection(car, g.trailhead)).toBe(1);
    const door = doorSpot(car, 1);
    expect(door.x).toBeCloseTo(-0.6, 9);
    expect(door.z).toBeCloseTo(0.5, 9);
    // Slid to 2 m toward -z: the trailhead is ahead, still +z.
    expect(carDirection({ x: -2.1, z: -2 }, g.trailhead)).toBe(1);
    // Slid to 8 m toward +z: nose back toward the pad, the door half a metre toward it.
    expect(carDirection({ x: -2.1, z: 8 }, g.trailhead)).toBe(-1);
    const back = doorSpot({ x: -2.1, z: 8 }, -1);
    expect(back.x).toBeCloseTo(-0.6, 9);
    expect(back.z).toBeCloseTo(7.5, 9);
  });
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
});
