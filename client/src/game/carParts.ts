/**
 * The film's car as a scene moves it, with no engine: the parts a pose
 * turns, by the names its file gives their nodes, each part's turn in its
 * own frame at a pose, and the arithmetic that carries a part's vertices
 * there for a renderer that draws the car as one mesh a material and has
 * no node to turn. The stage on Babylon.js turns the loader's nodes by the
 * same angles (`scene/sceneStage.ts`).
 *
 * The parts keep the model's own frame (the car drives +x in it, its
 * wheels' axles along z), which a whole-model turn does not change, and
 * their nodes carry no turn of their own in the file: a part's vertices as
 * they stand in the model with no pose are its rest.
 *
 * Loads no engine.
 */
import { composeInto, matrixMultiply, quatAboutAxis, quatFromEuler, type Quat } from "./instancePose.js";
import type { CarPose } from "./scene/timeline.js";

/** The four wheels' nodes: the front pair first. */
export const WHEEL_NAMES: readonly string[] = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
export const DOOR_NAME = "door_driver";
export const STEERING_NAME = "wheel_steering";
/** How far the driver's door swings when fully open (rad), outward. */
export const DOOR_SWING = Math.PI / 1.5;
/** The steering wheel's column in the part's own frame, not yet a unit vector: the wheel's thinnest direction, measured on the model. */
export const STEERING_COLUMN: readonly [number, number, number] = [0.871, -0.491, 0];

/** Whether a wheel's node is one of the front pair, which turn with the steering. */
export function frontWheel(name: string): boolean {
  return name.startsWith("wheel_f");
}

/** A wheel's turn about its axle at `pose` (its own z), radians. */
export function wheelSpinTurn(pose: CarPose): number {
  return -pose.wheelSpin;
}

/** A wheel's turn about the vertical at `pose` (its own y), radians: the front pair's alone. The part's own frame, under a loader's mirrored root, reverses a turn about y. */
export function wheelSteerTurn(pose: CarPose, front: boolean): number {
  return front ? -pose.wheelTurn : 0;
}

/** The driver's door's turn about the vertical at `pose`, radians. */
export function doorTurn(pose: CarPose): number {
  return -pose.doorOpen * DOOR_SWING;
}

/**
 * The turn of the part named `name` in its own frame at `pose`, into `out`:
 * a wheel spun about its axle and then, the front pair, turned about the
 * vertical; the steering wheel turned about its column; the door swung
 * about the vertical. Null for a name the pose does not turn.
 */
export function carPartTurn(name: string, pose: CarPose, out: Quat): Quat | null {
  if (WHEEL_NAMES.includes(name)) return quatFromEuler(0, wheelSteerTurn(pose, frontWheel(name)), wheelSpinTurn(pose), out);
  if (name === STEERING_NAME) return quatAboutAxis({ x: STEERING_COLUMN[0], y: STEERING_COLUMN[1], z: STEERING_COLUMN[2] }, pose.steer, out);
  if (name === DOOR_NAME) return quatFromEuler(0, doorTurn(pose), 0, out);
  return null;
}

/** The inverse of a matrix of a turn, a scale and a move (sixteen floats, as a shader reads them), into `out`. */
export function affineInverse(m: ArrayLike<number>, out: Float32Array): Float32Array {
  const a = (i: number): number => m[i] as number;
  const c00 = a(5) * a(10) - a(6) * a(9), c01 = a(6) * a(8) - a(4) * a(10), c02 = a(4) * a(9) - a(5) * a(8);
  const det = a(0) * c00 + a(1) * c01 + a(2) * c02;
  const k = 1 / det;
  const r0 = c00 * k, r1 = (a(2) * a(9) - a(1) * a(10)) * k, r2 = (a(1) * a(6) - a(2) * a(5)) * k;
  const r4 = c01 * k, r5 = (a(0) * a(10) - a(2) * a(8)) * k, r6 = (a(2) * a(4) - a(0) * a(6)) * k;
  const r8 = c02 * k, r9 = (a(1) * a(8) - a(0) * a(9)) * k, r10 = (a(0) * a(5) - a(1) * a(4)) * k;
  const tx = a(12), ty = a(13), tz = a(14);
  out[0] = r0; out[1] = r1; out[2] = r2; out[3] = 0;
  out[4] = r4; out[5] = r5; out[6] = r6; out[7] = 0;
  out[8] = r8; out[9] = r9; out[10] = r10; out[11] = 0;
  out[12] = -(r0 * tx + r4 * ty + r8 * tz);
  out[13] = -(r1 * tx + r5 * ty + r9 * tz);
  out[14] = -(r2 * tx + r6 * ty + r10 * tz);
  out[15] = 1;
  return out;
}

const turnScratch = new Float32Array(16);
const inverseScratch = new Float32Array(16);

/**
 * The matrix that carries a part's vertices from their rest in the model's
 * frame to where `turn`, a turn in the part's own frame, puts them:
 * `local` (the part's frame in the model's), the turn, and `local` undone.
 */
export function partMatrix(local: ArrayLike<number>, turn: Quat, out: Float32Array): Float32Array {
  composeInto(turnScratch, 0, 1, 1, 1, turn, 0, 0, 0);
  affineInverse(local, inverseScratch);
  matrixMultiply(turnScratch, inverseScratch, out);
  matrixMultiply(local, out, out);
  return out;
}

/** A run of a mesh's vertices: xyz of position and of normal a vertex, xyzw of tangent where it has any. */
export type VertexRun = { positions: Float32Array; normals: Float32Array; tangents: Float32Array | null };

/**
 * `count` vertices of `rest` from `first`, carried by `matrix` into the same
 * places of `out`: each position by all of it, each normal and each
 * tangent by its turn (a tangent's fourth float, its handedness, as it is).
 * The matrix is a turn and a move: a unit vector stays one.
 */
export function poseVertices(matrix: ArrayLike<number>, rest: VertexRun, out: VertexRun, first: number, count: number): void {
  const m = (i: number): number => matrix[i] as number;
  for (let v = first; v < first + count; v++) {
    const p = v * 3;
    const x = rest.positions[p] as number, y = rest.positions[p + 1] as number, z = rest.positions[p + 2] as number;
    out.positions[p] = x * m(0) + y * m(4) + z * m(8) + m(12);
    out.positions[p + 1] = x * m(1) + y * m(5) + z * m(9) + m(13);
    out.positions[p + 2] = x * m(2) + y * m(6) + z * m(10) + m(14);
    const nx = rest.normals[p] as number, ny = rest.normals[p + 1] as number, nz = rest.normals[p + 2] as number;
    out.normals[p] = nx * m(0) + ny * m(4) + nz * m(8);
    out.normals[p + 1] = nx * m(1) + ny * m(5) + nz * m(9);
    out.normals[p + 2] = nx * m(2) + ny * m(6) + nz * m(10);
    if (rest.tangents !== null && out.tangents !== null) {
      const t = v * 4;
      const ax = rest.tangents[t] as number, ay = rest.tangents[t + 1] as number, az = rest.tangents[t + 2] as number;
      out.tangents[t] = ax * m(0) + ay * m(4) + az * m(8);
      out.tangents[t + 1] = ax * m(1) + ay * m(5) + az * m(9);
      out.tangents[t + 2] = ax * m(2) + ay * m(6) + az * m(10);
      out.tangents[t + 3] = rest.tangents[t + 3] as number;
    }
  }
}
