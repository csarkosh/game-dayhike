/**
 * What a scene's stage works out for the film car's handset and its cord,
 * with no engine: where the handset sits in the hand, how it eases there
 * from its cradle, and where the cord's two ends are. The stage on
 * Babylon.js (`sceneStage.ts`) moves the loader's nodes by the same numbers;
 * a renderer with no node to move carries the handset's vertices by
 * `handsetCarry` and lays the cord between `cordEnds`.
 *
 * Every matrix is sixteen floats as a shader reads them, and every frame
 * here is told in one frame of the caller's choosing (the world's, or the
 * car's own, which a whole-car move does not change).
 *
 * Loads no engine.
 */
import { invertAffine } from "./actorPose.js";

/** The handset in the hand: its offset (m) in the hand joint's own frame, the fingers along +y and the palm toward +z,
 * measured on the talk clip's fist: the microphone's middle in the fist and 0.025 m toward the index finger, so its
 * grille end stands clear of it. */
export const GRIP_OFFSET: readonly [number, number, number] = [0.025, 0.075, 0.03];
/** And its turn there: a quarter about its length (the hand's x), so the grille faces the mouth. */
export const GRIP_TURN = Math.PI / 2;

/** The cord's socket on the radio's faceplate and its plug at the microphone's foot, each in its part's own frame, measured on the model. */
export const CORD_SOCKET: readonly [number, number, number] = [-0.0645, -0.012, 0.025];
export const CORD_PLUG: readonly [number, number, number] = [-0.0645, 0, 0];
/** The cord: 0.6 m, sagging 0.04 m at most, 20 coils of 6 mm. */
export const CORD = { length: 0.6, maxSag: 0.04, radius: 0.006, turns: 20, points: 201 } as const;

/** A place, a turn (xyzw) and a size. */
export type Placed = { position: [number, number, number]; rotation: [number, number, number, number]; scaling: [number, number, number] };

/** a·b into `out`: `b` applied first. `out` may be neither operand. */
export function multiplyInto(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): Float64Array {
  for (let column = 0; column < 4; column++) {
    const b0 = b[column * 4] as number, b1 = b[column * 4 + 1] as number, b2 = b[column * 4 + 2] as number, b3 = b[column * 4 + 3] as number;
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] = (a[row] as number) * b0 + (a[4 + row] as number) * b1 + (a[8 + row] as number) * b2 + (a[12 + row] as number) * b3;
    }
  }
  return out;
}

/** The matrix of a size, a turn and a place, into `out`. */
export function composeInto(placed: Placed, out: Float64Array): Float64Array {
  const [x, y, z, w] = placed.rotation;
  const [sx, sy, sz] = placed.scaling;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
  out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
  out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
  out[12] = placed.position[0]; out[13] = placed.position[1]; out[14] = placed.position[2]; out[15] = 1;
  return out;
}

/**
 * A matrix taken apart into a size, a turn and a place, as Babylon.js takes
 * one apart: each axis's length its size, the second axis's size negative
 * where the matrix mirrors, and the turn read from what is left.
 */
export function decomposeInto(m: ArrayLike<number>, out: Placed): Placed {
  const a = (i: number): number => m[i] as number;
  out.position[0] = a(12);
  out.position[1] = a(13);
  out.position[2] = a(14);
  const sx = Math.sqrt(a(0) * a(0) + a(1) * a(1) + a(2) * a(2));
  let sy = Math.sqrt(a(4) * a(4) + a(5) * a(5) + a(6) * a(6));
  const sz = Math.sqrt(a(8) * a(8) + a(9) * a(9) + a(10) * a(10));
  const determinant = a(0) * (a(5) * a(10) - a(6) * a(9)) - a(1) * (a(4) * a(10) - a(6) * a(8)) + a(2) * (a(4) * a(9) - a(5) * a(8));
  if (determinant <= 0) sy = -sy;
  out.scaling[0] = sx;
  out.scaling[1] = sy;
  out.scaling[2] = sz;
  if (sx === 0 || sy === 0 || sz === 0) {
    out.rotation[0] = out.rotation[1] = out.rotation[2] = 0;
    out.rotation[3] = 1;
    return out;
  }
  const m11 = a(0) / sx, m21 = a(1) / sx, m31 = a(2) / sx;
  const m12 = a(4) / sy, m22 = a(5) / sy, m32 = a(6) / sy;
  const m13 = a(8) / sz, m23 = a(9) / sz, m33 = a(10) / sz;
  const trace = m11 + m22 + m33;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s;
  }
  out.rotation[0] = x;
  out.rotation[1] = y;
  out.rotation[2] = z;
  out.rotation[3] = w;
  return out;
}

/** A turn mixed `amount` of the way from `a` to `b` along its arc, into `out`. */
function slerp(a: readonly number[], b: readonly number[], amount: number, out: number[]): void {
  let dot = (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number) + (a[3] as number) * (b[3] as number);
  let flipped = false;
  if (dot < 0) {
    flipped = true;
    dot = -dot;
  }
  let ka: number, kb: number;
  if (dot > 0.999999) {
    ka = 1 - amount;
    kb = flipped ? -amount : amount;
  } else {
    const angle = Math.acos(dot);
    const k = 1 / Math.sin(angle);
    ka = Math.sin((1 - amount) * angle) * k;
    kb = flipped ? -Math.sin(amount * angle) * k : Math.sin(amount * angle) * k;
  }
  for (let i = 0; i < 4; i++) out[i] = ka * (a[i] as number) + kb * (b[i] as number);
}

const gripScratch = new Float64Array(16);
const worldScratch = new Float64Array(16);
const inverseScratch = new Float64Array(16);
const localScratch = new Float64Array(16);
const gripPlaced: Placed = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
const heldPlaced: Placed = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };

/**
 * The handset in its cradle's own frame, into `out`: at `rest` where no
 * hand holds it; else in the grip of `hand` (the hand joint's matrix, its
 * size taken out but not its mirror, which a glTF skeleton under a loader's
 * mirrored root has), eased there from its rest by `grip` (0 to 1): its
 * turn along the arc, its place along the line, its size the grip's.
 * `hand` and `cradle` are told in one frame.
 */
export function handsetInCradle(hand: ArrayLike<number> | null, cradle: ArrayLike<number>, rest: Placed, grip: number, out: Placed): Placed {
  if (hand === null) {
    for (let i = 0; i < 3; i++) {
      out.position[i] = rest.position[i] as number;
      out.scaling[i] = rest.scaling[i] as number;
    }
    for (let i = 0; i < 4; i++) out.rotation[i] = rest.rotation[i] as number;
    return out;
  }
  const unit = 1 / Math.hypot(hand[0] as number, hand[1] as number, hand[2] as number);
  // The grip in the hand's frame, at the model's own size whatever the skeleton's.
  gripPlaced.position[0] = GRIP_OFFSET[0] * unit;
  gripPlaced.position[1] = GRIP_OFFSET[1] * unit;
  gripPlaced.position[2] = GRIP_OFFSET[2] * unit;
  gripPlaced.rotation[0] = Math.sin(GRIP_TURN / 2);
  gripPlaced.rotation[3] = Math.cos(GRIP_TURN / 2);
  gripPlaced.scaling[0] = gripPlaced.scaling[1] = gripPlaced.scaling[2] = unit;
  composeInto(gripPlaced, gripScratch);
  multiplyInto(hand, gripScratch, worldScratch);
  invertAffine(cradle, 0, inverseScratch, 0);
  multiplyInto(inverseScratch, worldScratch, localScratch);
  decomposeInto(localScratch, heldPlaced);
  for (let i = 0; i < 3; i++) {
    out.scaling[i] = heldPlaced.scaling[i] as number;
    out.position[i] = (rest.position[i] as number) + ((heldPlaced.position[i] as number) - (rest.position[i] as number)) * grip;
  }
  slerp(rest.rotation, heldPlaced.rotation, grip, out.rotation);
  return out;
}

const heldMatrix = new Float64Array(16);
const restInverse = new Float64Array(16);
const carriedScratch = new Float64Array(16);

/**
 * The matrix that carries the handset's vertices from where they rest to
 * where `held` (the handset in its cradle's frame, `handsetInCradle`) puts
 * them, into `out`: the cradle's frame, the handset in it, and the
 * handset's own resting frame undone. `cradle` and `rest` (the handset's
 * frame at rest) are told in the frame the vertices are in.
 */
export function handsetCarry(cradle: ArrayLike<number>, held: Placed, rest: ArrayLike<number>, out: Float64Array): Float64Array {
  composeInto(held, heldMatrix);
  multiplyInto(cradle, heldMatrix, carriedScratch);
  invertAffine(rest, 0, restInverse, 0);
  return multiplyInto(carriedScratch, restInverse, out);
}

/** The point (x, y, z) of a frame carried by its matrix, into `out`. */
function carried(m: ArrayLike<number>, p: readonly [number, number, number], out: { x: number; y: number; z: number }): void {
  out.x = p[0] * (m[0] as number) + p[1] * (m[4] as number) + p[2] * (m[8] as number) + (m[12] as number);
  out.y = p[0] * (m[1] as number) + p[1] * (m[5] as number) + p[2] * (m[9] as number) + (m[13] as number);
  out.z = p[0] * (m[2] as number) + p[1] * (m[6] as number) + p[2] * (m[10] as number) + (m[14] as number);
}

/** The cord's two ends: its socket on the cradle and its plug on the handset, each part's matrix told in one frame. */
export function cordEnds(cradle: ArrayLike<number>, handset: ArrayLike<number>, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void {
  carried(cradle, CORD_SOCKET, from);
  carried(handset, CORD_PLUG, to);
}
