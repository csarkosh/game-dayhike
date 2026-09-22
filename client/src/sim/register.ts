/**
 * The poster and the place: the one missing hiker the poster names, the box
 * on its post the poster hangs on, the car, and where the body is found.
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
import { CAR_HALF } from "./passes/trailhead.js";
import { hikerNames } from "./hikerNames.js";

export const BOX_RADIUS = 0.4;
/** Chest height on the 1.2 m post, where the poster hangs. */
export const BOX_HEIGHT = 1;
export const BOX_INTERACTABLE_ID = 2;

export const enum InteractKind {
  Debug = 0,
  Register = 2,
}

export type Register = {
  /** The one missing hiker, as the poster names them. */
  hiker: { name: string };
  /** Where the body is found: the crest, facing the stem's arrival. `yaw` is the facing, as a player's. */
  body: { pos: Vec3; yaw: number };
  /** The box on its post: what the hand reaches for. */
  box: Vec3;
  /** The car's centre. */
  car: Vec3;
};

export type RegisterInput = {
  seed: number;
  graph: TrailGraph;
  groundH(x: number, z: number): number;
  /** The post's and the car's sites (`propSite` over PROPS[0] and PROPS[2]). */
  box: { x: number; z: number };
  car: { x: number; z: number };
};

/**
 * The body faces the way a climber arrives: from the crest back down the
 * stem's last edge. A piecewise-linear atan2 over eight octants, exact at
 * the axes and within 0.07 rad between them — enough for a body to read as
 * facing the trail — and bit-identical everywhere because it uses no trig;
 * yaw = 0 faces +z, and on a stem the last edge is never degenerate.
 */
function facingYaw(dx: number, dz: number): number {
  const ax = dx < 0 ? -dx : dx, az = dz < 0 ? -dz : dz;
  const t = ax + az === 0 ? 0 : ax / (ax + az); // 0 on +z, 1 on +x
  const quarter = Math.PI / 2;
  let yaw = t * quarter; // first octant pair: +x, +z
  if (dz < 0) yaw = Math.PI - yaw;
  if (dx < 0) yaw = -yaw;
  return yaw;
}

/** The poster's hiker, the body's place, the box and the car, all from the seed. */
export function buildRegister(input: RegisterInput): Register {
  const { graph, groundH } = input;
  const crest = graph.nodes[graph.summit] as TrailNode;
  const lastEdge = graph.edges[graph.stem[graph.stem.length - 1] as number];
  const from = lastEdge === undefined ? crest : (graph.nodes[lastEdge.a === graph.summit ? lastEdge.b : lastEdge.a] as TrailNode);
  const body = {
    pos: { x: crest.x, y: groundH(crest.x, crest.z), z: crest.z },
    yaw: facingYaw(from.x - crest.x, from.z - crest.z),
  };
  return {
    hiker: { name: hikerNames(input.seed, 1)[0] as string },
    body,
    box: { x: input.box.x, y: groundH(input.box.x, input.box.z) + BOX_HEIGHT, z: input.box.z },
    car: { x: input.car.x, y: groundH(input.car.x, input.car.z) + CAR_HALF.y, z: input.car.z },
  };
}

/**
 * Registers the box as the one interactable the poster hangs on. Called on
 * the host's world and on a client's predicted world alike, so both resolve
 * the same thing in reach; reading the poster is the client's own screen.
 */
export function installRegister(world: World, register: Register): void {
  world.register = register;
  world.interactables.set(BOX_INTERACTABLE_ID, {
    id: BOX_INTERACTABLE_ID,
    pos: cloneVec3(register.box),
    radius: BOX_RADIUS,
    kind: InteractKind.Register,
    label: "Read the poster",
    onInteract: () => undefined,
  });
}
