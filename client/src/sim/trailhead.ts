import { ROAD_BED_HALF } from "./road.js";
import { TRAILHEAD_RADIUS } from "./bowl.js";
import { PLAYER_HALF } from "./constants.js";
import { segmentBoxGap, type Ground } from "./boxGap.js";
import { TRAIL_BED_HALF } from "./trail.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import type { Vec3 } from "./types.js";
import { facingYaw } from "./facing.js";

/**
 * The trailhead's places: the ranger's car, where a player arrives, and the
 * roofed notice board at the trail's entrance. The drawn models stand on
 * boxes; the boxes are what a hiker collides with. Everything follows from
 * the seed and the trail graph, so every peer places it alike with nothing
 * on the wire.
 *
 * Pure geometry and constants. Pass 8 (passes/trailhead.ts) emits the boxes;
 * this module registers nothing, so reading a constant from it has no effect.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
export const CAR_HALF: Vec3 = { x: 0.9, y: 0.8, z: 2.3 };
/** The car: parked on the shoulder, parallel to the
 * road, its road-side face 0.5 m off the pavement edge, at the pad's own
 * place along the road, so that it is behind a player who stands near the
 * pad's centre and faces the trail. */
export const CAR_ROAD_U = ROAD_BED_HALF + 0.5 + CAR_HALF.x; // centre's u
export const CAR_ROAD_Z = 0;                               // centre's z from the anchor
/** The least gap from the bed's centreline to the car's box: the bed's
 * half-width and a player's, so a player walking the bed's edge clears the
 * car. Where the gap is less, the car slides along the road. */
export const CAR_BED_CLEAR = TRAIL_BED_HALF + PLAYER_HALF.x;
export const CAR_SLIDE_STEP = 0.5;
/** The pad's radius. Over the 227-seed sweep the car slides 3.5 m at most. */
export const CAR_SLIDE_MAX = 8;
/** How far past the car's box, along the line to the entrance, a player
 * spawns (`trailheadSpawn` in spawn.ts). It stands here because it is part
 * of what every peer must agree on, and the pass's tunables are what the
 * level id reads. */
export const SPAWN_GAP = 2.5;

export const CAR_MATERIAL = "car";
export const KIOSK_MATERIAL = "kiosk";

export type EntranceGraph = Pick<TrailGraph, "nodes" | "edges" | "stem" | "trailhead">;

/**
 * The trail's entrance: the point where the stem's first edge crosses the
 * pad's rim, and the unit direction the trail leaves in. The first edge is
 * longer than the pad's radius on every seed of the sweep (11.4 m at the
 * least), so the bed is straight from the pad's centre to the rim. A graph
 * with no stem leaves toward +x.
 */
export function trailEntrance(graph: EntranceGraph): { x: number; z: number; dx: number; dz: number } {
  const first = graph.stem.length === 0 ? undefined : graph.edges[graph.stem[0] as number];
  const from = graph.nodes[0] as TrailNode;
  const to = first === undefined ? from : (graph.nodes[first.a === 0 ? first.b : first.a] as TrailNode);
  const ex = to.x - from.x, ez = to.z - from.z;
  const len = Math.sqrt(ex * ex + ez * ez);
  const dx = len > 0 ? ex / len : 1, dz = len > 0 ? ez / len : 0;
  return { x: graph.trailhead.x + dx * TRAILHEAD_RADIUS, z: graph.trailhead.z + dz * TRAILHEAD_RADIUS, dx, dz };
}

/** The least gap from any edge's centreline to a box. */
export function bedGap(graph: Pick<TrailGraph, "nodes" | "edges">, centre: Ground, half: Ground): number {
  let gap = Infinity;
  for (const e of graph.edges) {
    const g = segmentBoxGap(graph.nodes[e.a] as TrailNode, graph.nodes[e.b] as TrailNode, centre, half);
    if (g < gap) gap = g;
  }
  return gap;
}

/**
 * Where the car stands: on the shoulder at the pad's own place along the
 * road, and where the bed would come within CAR_BED_CLEAR of its box, slid
 * along the road in CAR_SLIDE_STEP steps until it does not, or until
 * CAR_SLIDE_MAX. It slides away from the way the trail heads, so the bed
 * runs off from the car and not along its flank. Over the 227-seed sweep it
 * stands at the pad on 216 seeds and slides 3 m on one and 3.5 m on ten.
 */
export function carSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
): Ground {
  const away = trailEntrance(graph).dz > 0 ? -1 : 1;
  const at = (slide: number): Ground => {
    const z = graph.trailhead.z + CAR_ROAD_Z + away * slide;
    return { x: roadCenterX(seed, z) + CAR_ROAD_U, z };
  };
  let site = at(0);
  for (let slide = CAR_SLIDE_STEP; slide <= CAR_SLIDE_MAX && bedGap(graph, site, CAR_HALF) < CAR_BED_CLEAR; slide += CAR_SLIDE_STEP) {
    site = at(slide);
  }
  return site;
}

/** Where a player arrives, and the yaw they face. */
export type Start = { x: number; z: number; yaw: number };

/**
 * A player arrives on the straight line from the car to the trail's
 * entrance, SPAWN_GAP past the point where that line leaves the car's box,
 * facing the entrance. Because they stand on that line, the car is behind
 * them and the entrance ahead whatever way the trail leaves the pad: on 24
 * of the 227 sweep seeds it leaves nearly parallel to the road, and a place
 * fixed in the road's frame could not put the car behind them there.
 */
export function trailheadSpawn(graph: EntranceGraph, car: Ground): Start {
  const e = trailEntrance(graph);
  const lx = e.x - car.x, lz = e.z - car.z;
  const len = Math.sqrt(lx * lx + lz * lz);
  const ux = lx / len, uz = lz / len;
  const ax = ux < 0 ? -ux : ux, az = uz < 0 ? -uz : uz;
  // How far along the line the car's box reaches: the nearer of its two faces.
  const outX = ax === 0 ? Infinity : CAR_HALF.x / ax;
  const outZ = az === 0 ? Infinity : CAR_HALF.z / az;
  const reach = (outX < outZ ? outX : outZ) + SPAWN_GAP;
  const x = car.x + ux * reach, z = car.z + uz * reach;
  return { x, z, yaw: facingYaw(e.x - x, e.z - z) };
}

/**
 * How far past the entrance, along the trail, the board stands: BOARD_ALONG
 * where it can, and nearer by BOARD_ALONG_STEP at a time, to BOARD_ALONG_MIN
 * at the least, where that keeps it nearer the centre of the player's view.
 * An upright phone of 390 by 844 shows 21.3 degrees to each side; over the
 * 227-seed sweep the whole board is within 20.56 degrees, and stands 4.5 m
 * past the entrance on 224 seeds, 3.5 m on 1 and 3 m on 2.
 */
export const BOARD_ALONG = 4.5;
export const BOARD_ALONG_MIN = 2.5;
export const BOARD_ALONG_STEP = 0.5;
/** The board's centre from the bed's centreline. */
export const BOARD_OFFSET = 2.5;
/** The bed's half-width and a player's, as for the car. */
export const BOARD_BED_CLEAR = TRAIL_BED_HALF + PLAYER_HALF.x;
/** The shoulder the car keeps. */
export const BOARD_ROAD_CLEAR = ROAD_BED_HALF + 0.5;
/**
 * A box cannot turn, and the board faces any way, so its solid shape is a
 * row of small boxes along its own line: BOARD_BOXES of them, BOARD_BOX_STEP
 * apart, 2.31 m from end to end and nowhere thicker than 0.78 m. The roof
 * overhangs the row, above a hiker's head, and has no box.
 */
export const BOARD_BOX_HALF: Vec3 = { x: 0.275, y: 1.25, z: 0.275 };
export const BOARD_BOX_STEP = 0.44;
export const BOARD_BOXES = 5;

/** The board's centre, the unit direction its face looks (`f`), and its own
 * line (`a`): the player's right as they look at it. */
export type Board = { x: number; z: number; fx: number; fz: number; ax: number; az: number };

/** The centres of the board's boxes, from the player's left to their right. */
export function boardBoxes(board: Board): Ground[] {
  const out: Ground[] = [];
  const mid = (BOARD_BOXES - 1) / 2;
  for (let k = 0; k < BOARD_BOXES; k++) {
    const s = (k - mid) * BOARD_BOX_STEP;
    out.push({ x: board.x + board.ax * s, z: board.z + board.az * s });
  }
  return out;
}

/**
 * Where the board stands: past the entrance along the trail, BOARD_OFFSET to
 * one side of the bed, facing the place a player arrives. The places it may
 * stand are on either side, from BOARD_ALONG past the entrance back to
 * BOARD_ALONG_MIN in steps of BOARD_ALONG_STEP. Of those that clear the road
 * and the bed it takes the one nearest the centre of the player's view,
 * which is the line from where they arrive to the entrance; where none
 * clears, the nearest of them all. A tie goes to the place further along,
 * and then to the side of `n`, the trail's direction turned a quarter turn.
 * Over the 227-seed sweep a place clears on every seed; on three the trail
 * bends into the side the player looks toward, and the board steps back.
 */
export function boardSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
  start: Ground,
): Board {
  const e = trailEntrance(graph);
  const nx = -e.dz, nz = e.dx;
  let vx = e.x - start.x, vz = e.z - start.z;
  const vl = Math.sqrt(vx * vx + vz * vz);
  vx = vl > 0 ? vx / vl : e.dx;
  vz = vl > 0 ? vz / vl : e.dz;
  const at = (along: number, side: number): { board: Board; clears: boolean; centred: number } => {
    const x = e.x + e.dx * along + side * nx * BOARD_OFFSET;
    const z = e.z + e.dz * along + side * nz * BOARD_OFFSET;
    const tx = start.x - x, tz = start.z - z;
    const tl = Math.sqrt(tx * tx + tz * tz);
    const fx = tl > 0 ? tx / tl : -e.dx, fz = tl > 0 ? tz / tl : -e.dz;
    const board: Board = { x, z, fx, fz, ax: -fz, az: fx };
    let clears = true;
    for (const b of boardBoxes(board)) {
      if (b.x - BOARD_BOX_HALF.x - roadCenterX(seed, b.z) < BOARD_ROAD_CLEAR) clears = false;
      if (bedGap(graph, b, BOARD_BOX_HALF) < BOARD_BED_CLEAR) clears = false;
    }
    // The cosine of the angle between the view's centre and the way to the
    // board: nearer 1 is nearer the centre.
    return { board, clears, centred: -(fx * vx + fz * vz) };
  };
  let best: { board: Board; clears: boolean; centred: number } | null = null;
  for (let k = 0; BOARD_ALONG - k * BOARD_ALONG_STEP >= BOARD_ALONG_MIN; k++) {
    for (const side of [1, -1]) {
      const c = at(BOARD_ALONG - k * BOARD_ALONG_STEP, side);
      // One that clears beats one that does not; of two alike, the more centred.
      if (best === null || (c.clears && !best.clears) || (c.clears === best.clears && c.centred > best.centred)) best = c;
    }
  }
  // BOARD_ALONG is not less than BOARD_ALONG_MIN, so the first place was tried.
  return (best as { board: Board }).board;
}

export type TrailheadPlaces = { car: Ground; start: Start; board: Board };

/** The trailhead's three places for a world, each from the one before it. */
export function trailheadPlaces(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
): TrailheadPlaces {
  const car = carSite(graph, roadCenterX, seed);
  const start = trailheadSpawn(graph, car);
  return { car, start, board: boardSite(graph, roadCenterX, seed, start) };
}
