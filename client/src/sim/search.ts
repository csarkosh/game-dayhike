/**
 * The poster and the place: the one missing hiker the poster names, the
 * poster on the trailhead board, the car, and where the body is found.
 * All of it follows from the seed and the trail graph, so every peer reads
 * the same poster with nothing on the wire. The rules that turn the find into
 * the chase live in summit.ts.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { Vec3 } from "./types.js";
import { cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import { BOARD_BOX_HALF, CAR_HALF, type Board } from "./trailhead.js";
import { hikerNames } from "./hikerNames.js";
import { facingYaw } from "./facing.js";

export const POSTER_RADIUS = 0.4;
/** How far along the board's own line, from its centre, the poster's sheet is centred. */
export const POSTER_ALONG = 0.36;
/** Height above the ground at the board's centre of the poster's centre: a little under a hiker's eye. */
export const POSTER_HEIGHT = 1.32;
/** How far the poster's point stands in front of the board's boxes. */
export const POSTER_STANDOFF = 0.05;
export const POSTER_INTERACTABLE_ID = 2;

export const enum InteractKind {
  Debug = 0,
  Poster = 2,
}

export type Search = {
  /** The one missing hiker, as the poster names them. */
  hiker: { name: string };
  /** Where the body is found: the crest, facing the stem's arrival. `yaw` is the facing, as a player's. */
  body: { pos: Vec3; yaw: number };
  /** The poster's centre on the notice board's face: what the hand reaches for. */
  poster: Vec3;
  /** The car's centre. */
  car: Vec3;
};

export type SearchInput = {
  seed: number;
  graph: TrailGraph;
  groundH(x: number, z: number): number;
  /** The board, and the car's place (`trailheadPlaces`). */
  board: Board;
  car: { x: number; z: number };
};

/** The poster's hiker, the body's place, the poster and the car, all from the seed. */
export function buildSearch(input: SearchInput): Search {
  const { graph, groundH } = input;
  const crest = graph.nodes[graph.summit] as TrailNode;
  const lastEdge = graph.edges[graph.stem[graph.stem.length - 1] as number];
  const from = lastEdge === undefined ? crest : (graph.nodes[lastEdge.a === graph.summit ? lastEdge.b : lastEdge.a] as TrailNode);
  // The body faces the way a climber arrives: from the crest back down the
  // stem's last edge, which on a stem is never degenerate.
  const body = {
    pos: { x: crest.x, y: groundH(crest.x, crest.z), z: crest.z },
    yaw: facingYaw(from.x - crest.x, from.z - crest.z),
  };
  return {
    hiker: { name: hikerNames(input.seed, 1)[0] as string },
    body,
    poster: posterPoint(input.board, groundH),
    car: { x: input.car.x, y: groundH(input.car.x, input.car.z) + CAR_HALF.y, z: input.car.z },
  };
}

/**
 * The poster's centre: POSTER_ALONG along the board's own line from its
 * centre, in front of the board's boxes by POSTER_STANDOFF, POSTER_HEIGHT
 * above the ground at the board's centre.
 */
function posterPoint(board: Board, groundH: (x: number, z: number) => number): Vec3 {
  const out = BOARD_BOX_HALF.z + POSTER_STANDOFF;
  return {
    x: board.x + board.ax * POSTER_ALONG + board.fx * out,
    y: groundH(board.x, board.z) + POSTER_HEIGHT,
    z: board.z + board.az * POSTER_ALONG + board.fz * out,
  };
}

/**
 * Installs the poster as the one interactable on the notice board. Called on
 * the host's world and on a client's predicted world alike, so both resolve
 * the same thing in reach; reading the poster is the client's own screen.
 */
export function installSearch(world: World, search: Search): void {
  world.search = search;
  world.interactables.set(POSTER_INTERACTABLE_ID, {
    id: POSTER_INTERACTABLE_ID,
    pos: cloneVec3(search.poster),
    radius: POSTER_RADIUS,
    kind: InteractKind.Poster,
    label: "Read the poster",
    onInteract: () => undefined,
  });
}
