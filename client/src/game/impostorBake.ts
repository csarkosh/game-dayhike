/**
 * A far tree's bake as arithmetic: how large its two pictures are, how long
 * a bake may take, how the tree is posed and framed for them, and what the
 * forest keeps of each bake. The pictures are drawn by the forest's shell
 * (`forestMeshes.ts`), which makes of them a billboard's colour and normal
 * map through the distance field (`impostorField.ts`); the quad the pictures
 * are laid on is `forestInstances.ts`'s (`impostorQuad`, `snagImpostorQuad`).
 *
 * Loads no engine: nothing here knows what a camera or a render target is.
 */
import { composeInto, quatFromEuler, transformPoint, type Quat, type Vec3 } from "./instancePose.js";

/** Impostor bake resolution: 512 since 2026-10-15 (256 before), so a
 * giant's card at the near seam, 120 m off and some 400 px tall in a 1080p
 * window, is drawn from near its own texels and its branches survive the
 * field's spread. Seven bakes (three giant sets, three saplings, the snag),
 * two pictures each, a few megabytes. */
export const IMPOSTOR_BAKE_SIZE = 512;

/** A bake still waiting on its shaders this long says so, once, as a warning,
 * and goes on waiting: late is better than never, but late must be visible. A
 * cold WebGPU start can take about this long and land, so it is not an error. */
export const IMPOSTOR_BAKE_WARN_MS = 30_000;

/** A bake still waiting this long gives up: about four times the slowest cold
 * WebGPU bake seen, so it ends a bake that will never be ready (a failure
 * nothing reported) rather than one that is merely slow, and says so. */
export const IMPOSTOR_BAKE_FAIL_MS = 120_000;

/** One billboard's bake, as the forest last saw it: still baking, landed
 * (`ready`, its bucket drawing once filled), or `failed` (null, or rejected:
 * the bucket stays off, and the console has said so). `ms` is how long it
 * took to settle, null while baking. */
export type ImpostorBake = { name: string; state: "baking" | "ready" | "failed"; ms: number | null };

/** Which picture a bake's render writes: 0 the lit colour, 1 the albedo, 2 the normal. */
export type ImpostorBakeMode = 0 | 1 | 2;

/** A billboard's name, and its bake's: `of` is its cohort and slot (`giant_0`, `sapling_2`, `snag`). */
export function impostorName(of: string): string {
  return `forest_impostor_${of}`;
}

/** The roll (about z, radians) the snag is baked under. `deadwood.snag` is
 * modelled lying down, its long axis on local x, so an un-posed bake would
 * billboard a felled trunk against standing ones: this is the very roll
 * `deadwoodMatrixBuffer` stands a snag up by. */
export const SNAG_BAKE_ROLL = Math.PI / 2;

const scratchQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
const scratchP: Vec3 = { x: 0, y: 0, z: 0 };

/** The pose a model is baked under as a matrix: rolled by `roll` about z, at the origin, unscaled. */
export function bakePoseMatrix(roll: number): Float32Array {
  const pose = new Float32Array(16);
  composeInto(pose, 0, 1, 1, 1, quatFromEuler(0, 0, roll, scratchQ), 0, 0, 0);
  return pose;
}

/** The box of every vertex of `parts` (xyz a vertex each) once carried by `pose`: what a posed bake frames. */
export function posedBounds(pose: ArrayLike<number>, parts: readonly ArrayLike<number>[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const positions of parts) {
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const p = transformPoint(pose, 0, positions[i] as number, positions[i + 1] as number, positions[i + 2] as number, scratchP);
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
  }
  return { min, max };
}

/**
 * How a bake's camera frames the tree: side-on and orthographic, looking
 * along +z with +y up, so the picture's square maps exactly onto the tree's
 * height by its widest horizontal extent, the quad `impostorQuad` sizes.
 */
export type ImpostorBakeFrame = {
  /** The picture's extent across and up, metres. */
  width: number;
  height: number;
  /** The middle of the tree's box: what the camera looks at. */
  centre: Vec3;
  /** Where the camera stands: in front of the box along -z, two depths off. */
  eye: Vec3;
  /** The camera's near and far planes, from the eye. */
  near: number;
  far: number;
};

/** The frame of a bake of the box `min` to `max`, or null for a box with no width or no height: nothing to bake. */
export function impostorBakeFrame(min: Vec3, max: Vec3): ImpostorBakeFrame | null {
  const width = Math.max(max.x - min.x, max.z - min.z);
  const height = max.y - min.y;
  if (!(width > 0) || !(height > 0)) return null;
  const centre = { x: (min.x + max.x) * 0.5, y: (min.y + max.y) * 0.5, z: (min.z + max.z) * 0.5 };
  const depth = Math.max(width, 1);
  return { width, height, centre, eye: { x: centre.x, y: centre.y, z: centre.z - depth * 2 }, near: 0.01, far: depth * 4 };
}
