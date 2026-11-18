/**
 * The scenery a hike places once, as files and numbers: the trailhead's car,
 * its board and the film's car that takes the parked car's place, the body
 * at the crest and what stands for it until its model arrives, and where
 * each stands. `lite/sceneryMeshes.ts`, which draws them, keeps the
 * meshes and the materials.
 *
 * Loads no engine.
 */
import { carDirection, type Board } from "../sim/trailhead.js";
import { BOARD_FACE } from "./boardFace.js";
import { armYaw } from "./signParts.js";

export const TRAILHEAD_CAR_OUTPUT = "models/trailhead.car.glb";
export const TRAILHEAD_KIOSK_OUTPUT = "models/trailhead.kiosk.glb";
/** The film's car (the intro's, with wheels and a door), which the end scene swaps in for the parked one. */
export const FILM_CAR_NAME = "intro.car";
export const FILM_CAR_OUTPUT = "models/intro.car.glb";
export const BODY_OUTPUT = "models/summit.body.glb";

/**
 * How far in front of the model's own face the painted plane stands. With
 * the view's near plane at 5 cm, a vertex lands in depth to within about
 * 0.7 mm for every metre between it and the eye, so a plane 1 mm in front
 * of another loses to it, in wedges across the face, from some places a
 * player stands. Measured from standpoints 1 to 18 m in front of the board:
 * at 1 mm and no bias the paint was lost from 16 of 75 under WebGPU and 1
 * of 78 under WebGL2; at 2 mm with the material's bias (`boardDraw.ts`),
 * from none under either. 2 mm holds the first metres and the bias the
 * rest.
 */
export const BOARD_FACE_LIFT = 0.002;

type Site = { x: number; z: number };

export type TrailheadSites = {
  /** The car's footprint centre, and the trailhead it is parked beside;
   * absent, no car is placed: a staged scene brings its own and moves it. */
  car?: { site: Site; trailhead: Site };
  /** The board: its centre, the way its face looks, and its own line. */
  board: Board;
};

/**
 * The car's yaw: 0 or PI only, so the model stays square to the box the sim
 * collides with. It stands at the pad's own place along the road on most
 * worlds, and there its nose points toward +z (yaw 0); where it has slid
 * along the road to clear the trail, its nose points back toward the pad.
 * The rule is the sim's (`carDirection`), so the door spot agrees with it.
 */
export function carYaw(site: Site, trailhead: Site): number {
  return carDirection(site, trailhead) === 1 ? 0 : Math.PI;
}

/** The board's yaw: its model's face looks toward +z, turned onto the way the board faces. */
export function boardYaw(board: Board): number {
  return armYaw({ dx: board.fx, dz: board.fz });
}

/**
 * The painted face's four corners in the world, for a board standing at
 * `board` on ground at `groundY`: 2 m by 1 m, `BOARD_FACE_LIFT` in front of
 * the model's planks, turned with the board. xyz a corner: bottom left,
 * bottom right, top right, top left, as the face is read; and the way it
 * looks.
 */
export function boardFaceCorners(board: Board, groundY: number): { corners: Float32Array; normal: { x: number; y: number; z: number } } {
  const yaw = boardYaw(board);
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const out = BOARD_FACE.front + BOARD_FACE_LIFT;
  const corners = new Float32Array(12);
  const hw = BOARD_FACE.width / 2, hh = BOARD_FACE.height / 2;
  // The face looks along the board's own +z: read from in front of it, its left is toward the board's +x.
  for (const [c, [lx, ly]] of ([[hw, -hh], [-hw, -hh], [-hw, hh], [hw, hh]] as const).entries()) {
    corners[c * 3] = board.x + lx * cos + out * sin;
    corners[c * 3 + 1] = groundY + BOARD_FACE.centreY + ly;
    corners[c * 3 + 2] = board.z - lx * sin + out * cos;
  }
  return { corners, normal: { x: sin, y: 0, z: cos } };
}

/** How much of the sky's reflected light the radio and its handset take, the rest of it roof: the
 * environment lights a part as if all the sky were open around it, and these plain dark parts,
 * unlike the cab's own textures, carry no darkness of their own. Set by eye on the insert. */
export const CAB_SKY = 0.3;
/** The film's car's parts that take `CAB_SKY` of the sky: the radio's cradle, and the handset that hangs under it in the file. */
export const CAB_PARTS: readonly string[] = ["cradle"];

/** What stands for the body until its model arrives: a cross of dark timber holding a pale figure, in the body's own frame. */
export const BODY_STAND_IN = {
  wood: { r: 0.16, g: 0.11, b: 0.07 },
  figure: { r: 0.72, g: 0.66, b: 0.6 },
  upright: { width: 0.25, height: 3.2, depth: 0.25, up: 1.6 },
  crossbar: { width: 2.0, height: 0.25, depth: 0.25, up: 2.4 },
  /** Hung `forward` in front of the upright, along the body's own +z. */
  capsule: { height: 1.7, radius: 0.25, up: 1.75, forward: 0.15 },
} as const;
