/**
 * The camera's pose as a frame of three axes, and a world point as a place
 * on the canvas through it. The game places its camera by a position, a yaw,
 * a pitch and a roll (yaw 0 faces +Z and grows toward +X, positive pitch
 * looks down, in a left-handed world with y up); Babylon Lite's camera is
 * placed by a position, a point it looks at and an up vector, so the pose is
 * turned into its forward and up axes here, the same rotation Babylon's
 * camera makes of its (pitch, yaw, roll).
 *
 * Loads nothing, and makes nothing a frame: every function fills what it is
 * handed.
 */

/** Where the camera stands and how it is turned, radians. */
export type CameraPose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };

/** The camera's own axes in the world, unit and at right angles: the way it
 * looks, its up and its right. */
export type CameraAxes = {
  fx: number; fy: number; fz: number;
  ux: number; uy: number; uz: number;
  rx: number; ry: number; rz: number;
};

/** Axes for `cameraAxes` to fill: a camera at rest, looking along +Z. */
export function restAxes(): CameraAxes {
  return { fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0 };
}

/**
 * The axes of a camera turned by `yaw`, then `pitch`, then `roll`: its
 * local +Z, +Y and +X carried through the roll about z, the pitch about x
 * and the yaw about y, in that order. Fills and returns `out`.
 */
export function cameraAxes(yaw: number, pitch: number, roll: number, out: CameraAxes): CameraAxes {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  out.fx = sy * cp;
  out.fy = -sp;
  out.fz = cy * cp;
  out.ux = cr * sp * sy - sr * cy;
  out.uy = cr * cp;
  out.uz = cr * sp * cy + sr * sy;
  out.rx = cr * cy + sr * sp * sy;
  out.ry = sr * cp;
  out.rz = sr * sp * cy - cr * sy;
  return out;
}

/** A point on the canvas, CSS pixels from its top left, and its distance from the eye, metres. */
export type CanvasPoint = { x: number; y: number; depth: number };

/**
 * The world point (px, py, pz) on a canvas `width` by `height` CSS pixels,
 * seen from `pose` along `axes` through a lens of vertical field of view
 * `fov` (radians): null where the point is not ahead of the near plane.
 */
export function projectToCanvas(
  pose: CameraPose, axes: CameraAxes, fov: number, near: number, width: number, height: number,
  px: number, py: number, pz: number,
): CanvasPoint | null {
  const dx = px - pose.x;
  const dy = py - pose.y;
  const dz = pz - pose.z;
  const ahead = dx * axes.fx + dy * axes.fy + dz * axes.fz;
  if (!(ahead > near)) return null;
  const across = dx * axes.rx + dy * axes.ry + dz * axes.rz;
  const above = dx * axes.ux + dy * axes.uy + dz * axes.uz;
  const half = Math.tan(fov / 2);
  const aspect = height > 0 ? width / height : 1;
  return {
    x: (across / (ahead * half * aspect) * 0.5 + 0.5) * width,
    y: (0.5 - above / (ahead * half) * 0.5) * height,
    depth: Math.hypot(dx, dy, dz),
  };
}
