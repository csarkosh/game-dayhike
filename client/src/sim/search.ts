/**
 * The poster and the place: the one missing hiker the poster names, the
 * poster on the trailhead kiosk, the car, and where the body is found.
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
import { CAR_HALF, KIOSK_HALF, kioskFacing } from "./passes/trailhead.js";
import { hikerNames } from "./hikerNames.js";
import { facingYaw } from "./facing.js";

export const POSTER_RADIUS = 0.4;
/** Height above the kiosk's ground of the poster's centre: the middle of the
 * 1 m tall board on the 2.5 m kiosk, a little under a hiker's eye. */
export const POSTER_HEIGHT = 1.4;
/** How far the poster's point stands in front of the kiosk's collision face:
 * just off the box a hiker stands against. The painted paper is about 0.4 m
 * behind that face, under the kiosk's roof, and still well within reach. */
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
  /** The kiosk's and the car's sites (`trailheadSite` for each). */
  kiosk: { x: number; z: number };
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
    poster: posterPoint(input.kiosk, graph.trailhead, groundH),
    car: { x: input.car.x, y: groundH(input.car.x, input.car.z) + CAR_HALF.y, z: input.car.z },
  };
}

/**
 * The poster's centre: in front of the kiosk's poster face (`kioskFacing`)
 * by the kiosk's half-depth plus POSTER_STANDOFF, POSTER_HEIGHT above the ground
 * at the kiosk's own site, where its box stands.
 */
function posterPoint(kiosk: { x: number; z: number }, trailhead: { z: number }, groundH: (x: number, z: number) => number): Vec3 {
  const f = kioskFacing(kiosk, trailhead);
  const out = KIOSK_HALF.z + POSTER_STANDOFF;
  return { x: kiosk.x + f.dx * out, y: groundH(kiosk.x, kiosk.z) + POSTER_HEIGHT, z: kiosk.z + f.dz * out };
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
