/**
 * A loaded model's geometry stood where its file's node tree puts it, so a
 * mesh that draws it needs no transform of its own. A thin instance's
 * matrix is applied before its mesh's, so whatever a bucket's mesh kept of
 * its nodes' transforms (the handedness mirror a glTF loader puts on its
 * root among them) would turn the whole placed field instead of each tree:
 * the transform goes into the vertices, and the mesh stands at the origin.
 * Loads no engine.
 */
import { composeInto, matrixMultiply, type Quat, type Vec3 } from "./instancePose.js";

/** A node of a loaded model as its place is read: where it stands in its parent, how it is turned and scaled. */
export type PlacedNode = { readonly position: Vec3; readonly rotationQuaternion: Quat; readonly scaling: Vec3 };

/** The matrix of a chain of nodes from a model's root down to a mesh's own node, root first: sixteen floats, as a shader reads them. */
export function chainMatrix(chain: readonly PlacedNode[]): Float32Array {
  const world = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const local = new Float32Array(16);
  for (const node of chain) {
    composeInto(local, 0, node.scaling.x, node.scaling.y, node.scaling.z, node.rotationQuaternion, node.position.x, node.position.y, node.position.z);
    matrixMultiply(world, local, world);
  }
  return world;
}

/** The determinant of a matrix's turn and scale: negative for one that mirrors. */
export function mirrors(m: ArrayLike<number>): boolean {
  const a = (i: number): number => m[i] as number;
  const det = a(0) * (a(5) * a(10) - a(6) * a(9)) - a(4) * (a(1) * a(10) - a(2) * a(9)) + a(8) * (a(1) * a(6) - a(2) * a(5));
  return det < 0;
}

/** A mesh's geometry as it is baked: xyz a vertex of position and of normal, xyzw of tangent, three indices a triangle. */
export type BakedGeometry = { positions: Float32Array; normals: Float32Array; tangents?: Float32Array | null; indices: Uint32Array };

/**
 * Bakes `world` into `geometry`, in place: each position carried by it, each
 * normal and each tangent turned by it and made a unit vector again (a
 * tangent's fourth float, its handedness, is left as it is).
 *
 * A glTF loader's meshes are wound to face outward under the mirror on its
 * root: baked under a transform that mirrors, their triangles are left as
 * they are; under one that does not, they are turned over.
 */
export function bakeGeometry(world: ArrayLike<number>, geometry: BakedGeometry): void {
  const m = (i: number): number => world[i] as number;
  const { positions, normals, indices } = geometry;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] as number;
    const y = positions[i + 1] as number;
    const z = positions[i + 2] as number;
    positions[i] = x * m(0) + y * m(4) + z * m(8) + m(12);
    positions[i + 1] = x * m(1) + y * m(5) + z * m(9) + m(13);
    positions[i + 2] = x * m(2) + y * m(6) + z * m(10) + m(14);
  }
  const turn = (array: Float32Array, stride: number): void => {
    for (let i = 0; i + 2 < array.length; i += stride) {
      const x = array[i] as number;
      const y = array[i + 1] as number;
      const z = array[i + 2] as number;
      const tx = x * m(0) + y * m(4) + z * m(8);
      const ty = x * m(1) + y * m(5) + z * m(9);
      const tz = x * m(2) + y * m(6) + z * m(10);
      const length = Math.hypot(tx, ty, tz) || 1;
      array[i] = tx / length;
      array[i + 1] = ty / length;
      array[i + 2] = tz / length;
    }
  };
  turn(normals, 3);
  if (geometry.tangents !== undefined && geometry.tangents !== null) turn(geometry.tangents, 4);
  if (!mirrors(world)) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const second = indices[i + 1] as number;
      indices[i + 1] = indices[i + 2] as number;
      indices[i + 2] = second;
    }
  }
}

/** The box of a mesh's positions, xyz a vertex. */
export function boundsOf(positions: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i] as number;
    const y = positions[i + 1] as number;
    const z = positions[i + 2] as number;
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  return { min, max };
}
