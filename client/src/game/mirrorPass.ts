/**
 * The lake's mirror as arithmetic, with no engine: how large its picture is,
 * when its pass is armed and on which armed frames it draws, how far the
 * image it holds lags the eye, and the camera it is drawn through. What
 * draws it (`lite/lakeMirror.ts`) takes its values from here; the reflection
 * and the oblique near plane themselves are `mirrorView.ts`'s.
 *
 * The mirrored camera is the player's seen in the water's plane. On
 * Babylon.js its view is the reflection times the player's view, which
 * turns the winding over, and the engine is told to turn its front faces
 * with it. A renderer that cannot be told draws through a camera of the
 * ordinary kind instead (`mirroredPose`): the player's place, aim and up,
 * each mirrored in the plane. Its picture is the same one turned over left
 * to right, and its winding is as it was; the read turns the picture back
 * (`mirrorRead`).
 */
import { cameraSpacePlane, obliqueProjectionReversed } from "./mirrorView.js";

/** The picture's size as a share of the frame's, each way, up to MIRROR_MAX_WIDTH by MIRROR_MAX_HEIGHT. */
export const MIRROR_SCALE = 0.5;
/** The picture's largest size each way: half the frame up to a 4K frame's quarter, 960 by 540. Past that the pass's cost is its draws, not its fill. */
export const MIRROR_MAX_WIDTH = 960;
export const MIRROR_MAX_HEIGHT = 540;
/** The pass draws every this many frames while armed, the first armed frame always: between draws the lake reads the last image through the view-projection it was drawn with, so on the frames between the reflection is up to two frames behind the camera. */
export const MIRROR_EVERY = 3;
/** The mirror camera's field is the player's widened by this, each way (the tangent of the half field scaled), so a turn over the frames between draws stays inside the drawn image. */
export const MIRROR_FOV_MARGIN = 1.2;
/** The held frames' smear, in pixels of the frame's height per metre of the eye's travel over them, divided in the shader by the water point's distance: the parallax a reflected point that far away moves by, about half of it. */
export const MIRROR_MOTION_SMEAR = 0.5;
/** How much of the way the eye's travel moves the smoothed travel each frame. */
export const MIRROR_MOTION_SMOOTH = 0.3;
/** A step of the eye over this in one frame is a teleport or a respawn, not a walk: it leaves the smear alone. */
export const MIRROR_MOTION_STEP_MAX_M = 5;
/** The mirror's plane over the lake's level, metres: the lake's surface's own lift. */
export const MIRROR_LIFT = 0.02;
/** How far (m, across the ground) the eye may stand past the lake's bound with the pass armed: past it the lake is a sliver of the frame, and the sky's sheen stands in for its image. */
export const MIRROR_REACH_M = 200;

/** The picture's size along one side of a frame `frame` pixels long: half of it, at most `cap`, at least a texel. */
export function mirrorTargetSize(frame: number, cap: number): number {
  return Math.max(1, Math.min(cap, Math.round(frame * MIRROR_SCALE)));
}

/**
 * The share of the frame's size the picture takes each way, for a renderer
 * that sizes a target by one scale of its frame: MIRROR_SCALE, or less
 * where either side would pass its cap.
 */
export function mirrorScale(frameWidth: number, frameHeight: number): number {
  return Math.min(MIRROR_SCALE, MIRROR_MAX_WIDTH / Math.max(1, frameWidth), MIRROR_MAX_HEIGHT / Math.max(1, frameHeight));
}

/** The eye's travel the held frames can lag by, metres, smoothed: `motion` is the last value, `eyeStep` the eye's travel this frame. The frames between draws are MIRROR_EVERY - 1, so the lag is that many steps; the smoothing keeps it from flickering with the cadence, and a step over MIRROR_MOTION_STEP_MAX_M counts as none. */
export function mirrorMotion(motion: number, eyeStep: number): number {
  const step = eyeStep > MIRROR_MOTION_STEP_MAX_M ? 0 : eyeStep;
  return motion + ((MIRROR_EVERY - 1) * step - motion) * MIRROR_MOTION_SMOOTH;
}

/**
 * Whether the pass is armed for a frame: the lake's water in the view, glass
 * on it, the eye over the mirror's plane (at or under it the near plane
 * would turn over) and less than MIRROR_REACH_M past the lake's bound
 * (`past`, metres across the ground, negative inside it).
 */
export function mirrorArmed(lakeInView: boolean, calmShare: number, eyeY: number, plane: number, past: number): boolean {
  return lakeInView && calmShare > 0 && eyeY > plane && past < MIRROR_REACH_M;
}

/** Which armed frames draw. */
export type MirrorCadence = {
  /** A frame, armed or not: whether the pass draws with it. The first armed frame draws, then every MIRROR_EVERY-th. */
  step(armed: boolean): boolean;
  /** Whether the last frame stepped was armed. */
  readonly armed: boolean;
  /** The image held is no longer the lake's: the next armed frame draws. */
  rest(): void;
};

export function createMirrorCadence(): MirrorCadence {
  let armed = false;
  let sinceDraw = 0;
  return {
    get armed() {
      return armed;
    },
    step(on) {
      if (!on) {
        armed = false;
        return false;
      }
      const draw = !armed || sinceDraw >= MIRROR_EVERY - 1;
      armed = true;
      sinceDraw = draw ? 0 : sinceDraw + 1;
      return draw;
    },
    rest() {
      armed = false;
    },
  };
}

/** A camera's place, the point it looks at and its up. */
export type MirrorPose = { eye: [number, number, number]; target: [number, number, number]; up: [number, number, number] };

/**
 * The player's camera mirrored in the plane y = `plane`, into `out`: its
 * place and the point `ahead` metres along its aim, each mirrored, and its
 * up turned over.
 */
export function mirroredPose(
  plane: number, eye: { readonly x: number; readonly y: number; readonly z: number },
  axes: { readonly fx: number; readonly fy: number; readonly fz: number; readonly ux: number; readonly uy: number; readonly uz: number }, ahead: number, out: MirrorPose,
): MirrorPose {
  out.eye[0] = eye.x;
  out.eye[1] = 2 * plane - eye.y;
  out.eye[2] = eye.z;
  out.target[0] = eye.x + axes.fx * ahead;
  out.target[1] = 2 * plane - (eye.y + axes.fy * ahead);
  out.target[2] = eye.z + axes.fz * ahead;
  out.up[0] = axes.ux;
  out.up[1] = -axes.uy;
  out.up[2] = axes.uz;
  return out;
}

/**
 * The view of a camera at `pose`, into `out`: a view whose z runs along the
 * aim, its x the up crossed with the aim and its y the aim crossed with that
 * x, as a look-at camera's is in a left-handed world.
 */
export function poseView(pose: MirrorPose, out: Float32Array): Float32Array {
  const { eye, target, up } = pose;
  let fx = target[0] - eye[0];
  let fy = target[1] - eye[1];
  let fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = up[1] * fz - up[2] * fy;
  let ry = up[2] * fx - up[0] * fz;
  let rz = up[0] * fy - up[1] * fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  out[0] = rx;
  out[1] = ux;
  out[2] = fx;
  out[3] = 0;
  out[4] = ry;
  out[5] = uy;
  out[6] = fy;
  out[7] = 0;
  out[8] = rz;
  out[9] = uz;
  out[10] = fz;
  out[11] = 0;
  out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = -(fx * eye[0] + fy * eye[1] + fz * eye[2]);
  out[15] = 1;
  return out;
}

const scratchPlane = new Float32Array(4);

/**
 * The mirrored camera's projection where depth runs from 1 at the near plane
 * to 0, into `out`: `player`, the player's projection in that range with no
 * jitter on it, its field widened by MIRROR_FOV_MARGIN, and its near plane
 * made the plane y = `plane` as the camera whose view is `view` sees it
 * (`obliqueProjectionReversed`). Matrices are sixteen floats, a clip
 * component j the sum over i of p_i times m[4i + j].
 */
export function mirrorProjection(player: ArrayLike<number>, view: Float32Array, plane: number, out: Float32Array): Float32Array {
  for (let i = 0; i < 16; i++) out[i] = player[i] as number;
  out[0] = (out[0] as number) / MIRROR_FOV_MARGIN;
  out[5] = (out[5] as number) / MIRROR_FOV_MARGIN;
  // No jitter rides into the mirror: its picture is held over frames.
  out[8] = 0;
  out[9] = 0;
  cameraSpacePlane(view, plane, scratchPlane);
  return obliqueProjectionReversed(out, scratchPlane, out);
}

/**
 * What a point of the world is read through: `view` times `projection`,
 * into `out`, with the clip's x turned over, which is the view-projection of
 * the reflection's own camera where `view` is the mirrored pose's
 * (`mirroredPose`): the picture such a camera draws is that camera's turned
 * over left to right, and whoever reads it turns its u back.
 */
export function mirrorRead(view: ArrayLike<number>, projection: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (view[4 * i + k] as number) * (projection[4 * k + j] as number);
      out[4 * i + j] = j === 0 ? -sum : sum;
    }
  }
  return out;
}
