/**
 * The sky's probe, its capture as the scene's image-based light, with no
 * engine: the cube's size, how its six faces are laid out and which way
 * each texel of a face looks, and when the capture is made again.
 *
 * **When.** The renderer (`lite/skyCapture.ts`) captures the dome again at each
 * apply that finds the sky's slices: an hour set, a weather set, a view
 * set, every frame of a weather fade, and the slice that completes an hour
 * the table was waiting on. It makes a new sky state each time, so a
 * renderer captures again for each new state. The sun followed between two
 * applies (`followHour`) moves no sky and captures nothing. All six faces
 * are drawn in the frame after the apply, in one render, before the frame's
 * own draws read them: Babylon.js's cube target draws its faces in turn,
 * and nothing of the capture is spread over frames.
 *
 * **What.** Each face holds the dome's linear radiance (`domeRadiance`
 * with the disc capped, `skyState.ts`) as the probe sees it toward its
 * texels, at the cube's top level alone: Babylon.js reads a probe there
 * whatever a material's roughness. The probe gives no diffuse light: no
 * irradiance is worked for it.
 *
 * **Where from.** The probe stands at the world's origin, where Babylon.js
 * puts a reflection probe and the game leaves it, while the dome it
 * captures is the box that rides with the eye (`SKY_DOME_SIZE` across). So
 * the dome's direction a texel holds is not the texel's own: it is the way
 * from the eye to where the texel's ray from the origin meets the box
 * (`probeDomeDirection`). With the eye a few hundred metres from the
 * origin, the captured horizon stands a few texels off the face's middle;
 * the capture keeps the eye of the frame it was made in until the next.
 *
 * **Layout.** The cube map's own: layers +x, -x, +y, -y, +z, -z, a texel's
 * column across a face and its row down it, in the world's axes as they
 * stand (y up), each layer seen from inside the cube.
 *
 * Loads no engine.
 */
import type { Vec3 } from "./sky.js";
import { SKY_DOME_SIZE } from "./skyDomeParams.js";

/** Texels a face of the probe's cube. */
export const SKY_PROBE_SIZE = 128;

/** A face of the cube: the axis it looks along, and the ways its columns and its rows run across it. */
export type CubeFace = { readonly normal: Vec3; readonly across: Vec3; readonly down: Vec3 };

const v = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });

/** The six faces in the cube's layer order: +x, -x, +y, -y, +z, -z. */
export const SKY_PROBE_FACES: readonly CubeFace[] = Object.freeze([
  { normal: v(1, 0, 0), across: v(0, 0, -1), down: v(0, -1, 0) },
  { normal: v(-1, 0, 0), across: v(0, 0, 1), down: v(0, -1, 0) },
  { normal: v(0, 1, 0), across: v(1, 0, 0), down: v(0, 0, 1) },
  { normal: v(0, -1, 0), across: v(1, 0, 0), down: v(0, 0, -1) },
  { normal: v(0, 0, 1), across: v(1, 0, 0), down: v(0, -1, 0) },
  { normal: v(0, 0, -1), across: v(-1, 0, 0), down: v(0, -1, 0) },
].map((face) => Object.freeze(face)));

/**
 * The unit direction the texel at column `x` and row `y` of layer `face`
 * looks along, on a face of `size` texels: through the texel's centre.
 * Fills and returns `out` (a vector of its own when none is given).
 */
export function probeTexelDirection(face: number, x: number, y: number, size: number = SKY_PROBE_SIZE, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const f = SKY_PROBE_FACES[face];
  if (f === undefined) throw new Error(`a cube has six faces: ${face} is not one`);
  const a = (2 * (x + 0.5)) / size - 1;
  const b = (2 * (y + 0.5)) / size - 1;
  const dx = f.normal.x + f.across.x * a + f.down.x * b;
  const dy = f.normal.y + f.across.y * a + f.down.y * b;
  const dz = f.normal.z + f.across.z * a + f.down.z * b;
  const length = Math.hypot(dx, dy, dz);
  out.x = dx / length;
  out.y = dy / length;
  out.z = dz / length;
  return out;
}

/**
 * The dome's direction the probe sees along the unit `ray` from its place,
 * the world's origin, when the eye stands at `eye`: from the eye to where
 * the ray meets the faces of the dome's box round the eye. Unit; along the
 * ray itself when the eye is at the origin. Fills and returns `out` (a
 * vector of its own when none is given).
 */
export function probeDomeDirection(ray: Vec3, eye: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const half = SKY_DOME_SIZE / 2;
  // The nearest face ahead along each axis the ray moves on, as a distance along the ray.
  const along = (r: number, e: number): number => (Math.abs(r) > 1e-8 ? (e + Math.sign(r) * half) / r : Number.POSITIVE_INFINITY);
  const t = Math.min(along(ray.x, eye.x), along(ray.y, eye.y), along(ray.z, eye.z));
  const x = ray.x * t - eye.x;
  const y = ray.y * t - eye.y;
  const z = ray.z * t - eye.z;
  const length = Math.hypot(x, y, z);
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
  return out;
}
