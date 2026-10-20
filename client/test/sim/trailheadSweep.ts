import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { generateChunk } from "../../src/sim/chunk.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, terrainVariant, activeTerrainVariant } from "../../src/sim/terrain.js";
import {
  BOARD_BOX_HALF, CAR_HALF, bedGap, boardBoxes, boardSite, carSite, trailEntrance, trailheadPlaces,
} from "../../src/sim/trailhead.js";
import { trailheadSpawn } from "../../src/sim/spawn.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { TRAILHEAD_U } from "../../src/sim/bowl.js";
import { SEEDS } from "./trailGateSeeds.js";
import { seedPart } from "../helpers/seedPart.js";

/**
 * The trailhead over the 227-seed sweep: the pad, the car, the player and the
 * board on every world, where `trailhead.test.ts` pins the same rules at known
 * numbers on hand-built graphs.
 *
 * The four checks run in parts (`seedPart`), each over the part's own seeds,
 * so the part builds its worlds once for all four: vitest hands out files,
 * and as tests of `trailhead.test.ts` the four were one of the floors under
 * the client suite, about 350 s on a CI runner. Every check is the worst any
 * seed reads against a fixed bound, or a thing every seed must do, so the
 * parts hold together what the sweep whole did, save the board's sides,
 * which are counted: each part holds its own (`SIDE_PINS`).
 *
 * Their limits went from 120 s to 300 s (2026-09-11) when `bowlFor` came to
 * cost 433 ms a seed once loops actually routed (230 ms before), so a
 * 227-seed sweep needed ~100 s of its own and was timing out against the
 * 120 s box once the whole suite competed for the CPU. The tests were not
 * failing, they were running out of clock.
 */
setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/** The parts the sweep is split into, one test file each (`trailheadSweep.part<k>.test.ts`). */
export const TRAILHEAD_PARTS = 6;

/** The variant's road centreline x at z. */
function roadCenterXOf(seed: number, z: number): number {
  return activeTerrainVariant().roadCenterX!(seed, z);
}

/** The chunk holding a world point — how the trailhead pass emits its props. */
function chunkHolding(seed: number, x: number, z: number) {
  return generateChunk(seed, Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
}

/** The pad 9 m from the road's centreline, and the car on the shoulder at the pad, on every one of the part's worlds. */
export function checkPadPart(part: number): void {
  const seeds = seedPart(SEEDS, part, TRAILHEAD_PARTS);
  const slides = new Map<number, number>();
  let leastGap = Infinity, leastSeed = 0;
  for (const seed of seeds) {
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
  console.info(`[trailhead, part ${part} of ${TRAILHEAD_PARTS}] car: slides ${JSON.stringify([...slides].sort((a, b) => a[0] - b[0]))}, least bed gap ${leastGap.toFixed(3)} m on seed ${leastSeed}`);
  // 2026-09-29: it stood at the pad on 216 seeds, and slid 3 m on 1 and
  // 3.5 m on 10. The trail leaves the pad inland now, through the doorway
  // (`closeShore`), and nowhere runs along the car's flank: on every seed of
  // the 227, so on every seed of each part.
  expect([...slides].sort((a, b) => a[0] - b[0])).toEqual([[0, seeds.length]]);
  expect(leastGap, `seed ${leastSeed}`).toBeGreaterThanOrEqual(1.15);
}

/** The car off the road bed and clear of the trail bed, on every one of the part's worlds. */
export function checkCarPart(part: number): void {
  // TWO CLAUSES, both over the same 227 seeds trailBedSweep.ts requires.
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
  // The board's own clauses are in `checkBoardPart` below.
  //
  // NO EXCEPTIONS LIST: track the WORST seed and assert once, the way
  // trailBedSweep.ts's bucket-fit check does, rather than stopping at the
  // first offender — but nothing here widens a threshold or drops a seed.
  const v = terrainVariant("olympic")!;
  let worstRoad = Infinity, worstRoadSeed = 0;
  let worstBed = Infinity, worstBedSeed = 0;
  for (const seed of seedPart(SEEDS, part, TRAILHEAD_PARTS)) {
    const graph = v.trailGraph!(seed);
    const site = carSite(graph, v.roadCenterX!, seed);
    const rx = roadCenterXOf(seed, site.z);
    const road = (site.x - CAR_HALF.x) - rx - (ROAD_BED_HALF + 0.5);
    if (road < worstRoad) { worstRoad = road; worstRoadSeed = seed; }
    const bed = bedGap(graph, site, CAR_HALF) - 1.15;
    if (bed < worstBed) { worstBed = bed; worstBedSeed = seed; }
  }
  console.info(`[trailhead, part ${part} of ${TRAILHEAD_PARTS}] car: worst road margin ${worstRoad.toFixed(2)} m, worst bed margin ${worstBed.toFixed(2)} m`);
  expect(worstRoad, `off the road bed, worst seed ${worstRoadSeed}`).toBeGreaterThanOrEqual(-1e-9);
  expect(worstBed, `clear of the trail bed, worst seed ${worstBedSeed}`).toBeGreaterThanOrEqual(0);
}

/** The player in front of the car, facing the trail's entrance, on every one of the part's worlds. */
export function checkPlayerPart(part: number): void {
  const v = terrainVariant("olympic")!;
  const gapTo = (x: number, z: number, c: { x: number; z: number }, h: { x: number; z: number }): number =>
    Math.hypot(Math.max(Math.abs(x - c.x) - h.x, 0), Math.max(Math.abs(z - c.z) - h.z, 0));
  let behind = Infinity, ahead = 0, axis = 0, carGap = Infinity, boardGap = Infinity, road = Infinity, reach = 0;
  for (const seed of seedPart(SEEDS, part, TRAILHEAD_PARTS)) {
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
  console.info(`[trailhead, part ${part} of ${TRAILHEAD_PARTS}] player: car ${behind.toFixed(2)} deg off the facing at least, entrance ${ahead.toFixed(2)} at most, facing ${axis.toFixed(2)} off the trail's direction at most, ${carGap.toFixed(2)} m from the car, ${boardGap.toFixed(2)} m from the board, ${road.toFixed(2)} m from the centreline, ${reach.toFixed(2)} m from the entrance at most`);
  expect(behind).toBeGreaterThanOrEqual(175);
  expect(ahead).toBeLessThanOrEqual(5);
  expect(axis).toBeLessThanOrEqual(19);
  expect(carGap).toBeGreaterThanOrEqual(1.5);
  expect(boardGap).toBeGreaterThanOrEqual(6);
  expect(road).toBeGreaterThanOrEqual(7.5);
  expect(reach).toBeLessThanOrEqual(7);
}

/**
 * How many of each part's boards stand on the +n side of the trail and how
 * many on the -n, measured on 2026-10-19 when the sweep was split into its
 * six parts of 38 worlds (37 the last); they sum to the 195 and 32 the sweep
 * whole was held to. A part with no sides here fails naming what it
 * measured, so a change to the split or to the worlds re-pins from one run.
 */
const SIDE_PINS: Record<number, [number, number]> = { 1: [34, 4], 2: [34, 4], 3: [35, 3], 4: [31, 7], 5: [33, 5], 6: [28, 9] };

/** The board in the player's view, clear of the bed, the road and the car, on every one of the part's worlds. */
export function checkBoardPart(part: number): void {
  const seeds = seedPart(SEEDS, part, TRAILHEAD_PARTS);
  const v = terrainVariant("olympic")!;
  const boxGap = (a: { x: number; z: number }, c: { x: number; z: number }, h: { x: number; z: number }): number =>
    Math.hypot(Math.max(Math.abs(a.x - c.x) - 0.275 - h.x, 0), Math.max(Math.abs(a.z - c.z) - 0.275 - h.z, 0));
  let farEnd = 0, nearest = Infinity, farthest = 0, bed = Infinity, road = Infinity, carGap = Infinity, turned = 0;
  let plus = 0, minus = 0;
  const along = new Map<string, number>();
  for (const seed of seeds) {
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
  const summary = `[trailhead, part ${part} of ${TRAILHEAD_PARTS}] board: far end ${farEnd.toFixed(2)} deg off the facing at most, ${nearest.toFixed(2)}-${farthest.toFixed(2)} m from the player, bed ${bed.toFixed(2)} m, road ${road.toFixed(2)} m, car ${carGap.toFixed(2)} m, sides +n ${plus} -n ${minus}`;
  console.info(summary);
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
  // The sides were [195, 32] over the sweep whole; each part holds its own.
  const sides = SIDE_PINS[part];
  if (sides === undefined) throw new Error(`no sides for part ${part} of ${TRAILHEAD_PARTS}; it measured [${plus}, ${minus}]\n${summary}`);
  expect([plus, minus], summary).toEqual(sides);
  expect([...along].sort()).toEqual([["4.5", seeds.length]]);
}
