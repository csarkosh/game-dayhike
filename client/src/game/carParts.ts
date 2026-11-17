/**
 * The film's car as a scene moves it, with no engine: the parts a pose
 * turns, by the names its file gives their nodes, each part's turn in its
 * own frame at a pose, and the arithmetic that carries a part's vertices
 * there for a renderer that draws the car as one mesh a material and has
 * no node to turn. The stage on Babylon.js turns the loader's nodes by the
 * same angles (`scene/sceneStage.ts`).
 *
 * A renderer that carries them in its vertex stage is handed the same
 * arithmetic as numbers: a turn for each frame a pose turns (`turnSlots`),
 * which turn each vertex takes (`partNumbers`), and each turn as the three
 * rows a vertex is carried by, written when a pose moves it and not
 * otherwise (`writeTurns`).
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

/** Every part a pose turns, by its node's name: the four wheels, the steering wheel, the driver's door. */
export const TURNED_PART_NAMES: readonly string[] = [...WHEEL_NAMES, STEERING_NAME, DOOR_NAME];

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

/** What of a pose turns the car's parts. */
export type PartsPose = Pick<CarPose, "wheelSpin" | "wheelTurn" | "steer" | "doorOpen">;

/** Whether `pose` turns the part named `name` otherwise than `was`: a wheel by its spin, a front one by its turn too, the steering wheel and the door each by its own. */
export function partMoved(name: string, was: PartsPose, pose: PartsPose): boolean {
  if (name === DOOR_NAME) return was.doorOpen !== pose.doorOpen;
  if (name === STEERING_NAME) return was.steer !== pose.steer;
  return was.wheelSpin !== pose.wheelSpin || (was.wheelTurn !== pose.wheelTurn && frontWheel(name));
}

/** One turn of a car: the part it is a turn of, and that part's own frame in the model's. */
export type TurnSlot = { name: string; local: Float32Array };

/**
 * The turns the runs of a car's vertices need, and which each run takes:
 * one for each frame a named part is turned in, so the primitives of a part
 * that share its frame (a door's panel, its trim and its window) share a
 * turn. The turns stand in the parts' own order (`TURNED_PART_NAMES`), the
 * wheels together, so a pose that drives the car moves one run of them.
 * `of` holds each run's turn, in the runs' order.
 */
export function turnSlots(runs: readonly { name: string; local: ArrayLike<number> }[]): { slots: TurnSlot[]; of: number[] } {
  const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
    for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  const slots: TurnSlot[] = [];
  for (const name of TURNED_PART_NAMES) {
    for (const run of runs) {
      if (run.name === name && !slots.some((slot) => slot.name === name && same(slot.local, run.local))) slots.push({ name, local: Float32Array.from(run.local) });
    }
  }
  const of = runs.map((run) => {
    const at = slots.findIndex((slot) => slot.name === run.name && same(slot.local, run.local));
    if (at < 0) throw new Error(`no pose turns a part named "${run.name}"`);
    return at;
  });
  return { slots, of };
}

/**
 * Which turn each of a mesh's `vertices` takes, a float a vertex: 0 for a
 * vertex no pose turns, and one more than its turn's place among the car's
 * (`turnSlots`) for a vertex of a run.
 */
export function partNumbers(vertices: number, runs: readonly { first: number; count: number; slot: number }[]): Float32Array {
  const numbers = new Float32Array(vertices);
  for (const run of runs) numbers.fill(run.slot + 1, run.first, run.first + run.count);
  return numbers;
}

/** The floats of one turn as a vertex stage reads it: three rows of four, a row a coordinate. */
export const TURN_ROW_FLOATS = 12;

/**
 * `matrix` (`partMatrix`) as the three rows of the turn at `slot` of `rows`:
 * a vertex's x is its position against the first row and that row's fourth
 * float, a normal's the same with no fourth; so for y and z.
 */
export function writeTurnRows(matrix: ArrayLike<number>, rows: Float32Array, slot: number): void {
  const at = slot * TURN_ROW_FLOATS;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) rows[at + row * 4 + column] = matrix[column * 4 + row] as number;
  }
}

/** `count` turns that carry nothing: a part at its rest, exactly. */
export function restTurns(count: number): Float32Array {
  const rows = new Float32Array(count * TURN_ROW_FLOATS);
  for (let slot = 0; slot < count; slot++) {
    rows[slot * TURN_ROW_FLOATS] = 1;
    rows[slot * TURN_ROW_FLOATS + 5] = 1;
    rows[slot * TURN_ROW_FLOATS + 10] = 1;
  }
  return rows;
}

const slotTurn: Quat = { x: 0, y: 0, z: 0, w: 1 };
const slotMatrix = new Float32Array(16);

/**
 * Writes into `rows` the turn of every slot that `pose` turns otherwise
 * than `was`, which is then made the pose's, and fills `range` with the
 * floats written: the first and the one past the last. False, with nothing
 * written, where the pose turns every part as `was` did: a car that stands,
 * or drives with its wheels locked, moves no turn. A part a pose has never
 * moved keeps the rest it was made with.
 */
export function writeTurns(slots: readonly TurnSlot[], was: PartsPose, pose: CarPose, rows: Float32Array, range: { from: number; to: number }): boolean {
  let from = Infinity;
  let to = -Infinity;
  for (const [at, slot] of slots.entries()) {
    if (!partMoved(slot.name, was, pose)) continue;
    const turn = carPartTurn(slot.name, pose, slotTurn);
    if (turn === null) continue;
    writeTurnRows(partMatrix(slot.local, turn, slotMatrix), rows, at);
    from = Math.min(from, at * TURN_ROW_FLOATS);
    to = Math.max(to, (at + 1) * TURN_ROW_FLOATS);
  }
  was.wheelSpin = pose.wheelSpin;
  was.wheelTurn = pose.wheelTurn;
  was.steer = pose.steer;
  was.doorOpen = pose.doorOpen;
  if (to <= from) return false;
  range.from = from;
  range.to = to;
  return true;
}

/**
 * A point carried by the turn at `slot` of `rows`, as a vertex stage
 * carries a position, into `out` (xyz from `at`).
 */
export function turnPoint(rows: ArrayLike<number>, slot: number, x: number, y: number, z: number, out: Float32Array, at: number): void {
  const r = slot * TURN_ROW_FLOATS;
  for (let row = 0; row < 3; row++) {
    out[at + row] = x * (rows[r + row * 4] as number) + y * (rows[r + row * 4 + 1] as number) + z * (rows[r + row * 4 + 2] as number) + (rows[r + row * 4 + 3] as number);
  }
}
