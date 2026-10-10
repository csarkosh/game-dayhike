/**
 * Whether a lake's water is in a camera's view, read by its shore rather than
 * by its mesh's box. The water's mesh spans the lake's square box
 * (`lakeSurface`), and the box of a bent or diagonal lake is mostly bank: a
 * camera on the bank inside that box, facing away from the water, reads the
 * box in its frustum. So the box is only a cheap first test; past it the lake
 * is in view when the camera stands over the water, when the view's centre
 * ray meets the lake's level over water (a narrow lens, or a steep look at a
 * strip of water between two shore points), or when a point of its shore at
 * its level lies inside all six of the frustum's planes.
 *
 * The points are made once a lake at load (`lakeViewPoints`), the planes once
 * (`newLakeViewPlanes`), the scratch vector once by the caller: `lakeInView`
 * allocates nothing.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { lakeOutline, lakeShoreInto, newLakeShore, type LakeShape } from "../sim/lakeShape.js";

/** The shore's march step (m); every other point is kept, so the points stand about twice this apart. */
export const LAKE_VIEW_STEP = 2;

/** The shore at the lake's level, about 4 m apart: (x, level, z) a point. */
export function lakeViewPoints(shape: LakeShape, level: number): Float32Array {
  const o = lakeOutline(shape, LAKE_VIEW_STEP);
  const n = Math.ceil(o.xs.length / 2);
  const points = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    points[k * 3] = o.xs[k * 2] as number;
    points[k * 3 + 1] = level;
    points[k * 3 + 2] = o.zs[k * 2] as number;
  }
  return points;
}

/** The six planes `Frustum.GetPlanesToRef` fills, made once. */
export function newLakeViewPlanes(): Plane[] {
  return [0, 1, 2, 3, 4, 5].map(() => new Plane(0, 0, 0, 0));
}

/** The shore read at the camera's place and down its centre ray, reused. */
const SHORE = newLakeShore();
/** The camera's forward axis in its own frame, left- and right-handed. */
const FORWARD_LH = new Vector3(0, 0, 1);
const FORWARD_RH = new Vector3(0, 0, -1);

/**
 * Whether the lake is in `camera`'s view this frame: its mesh's box in the
 * frustum (the camera's matrices and the mesh's world matrix already current),
 * and then, in turn, the camera over the water, the view's centre ray meeting
 * the lake's level over water, or a shore point inside every plane. `planes`
 * and `scratch` are the caller's, refilled here.
 */
export function lakeInView(
  camera: Camera, mesh: AbstractMesh, shape: LakeShape, points: Float32Array, planes: Plane[], scratch: Vector3,
): boolean {
  if (!camera.isInFrustum(mesh)) return false;
  const eye = camera.position;
  if (lakeShoreInto(SHORE, shape, eye.x, eye.z).s > 0) return true;
  camera.getDirectionToRef(camera.getScene().useRightHandedSystem ? FORWARD_RH : FORWARD_LH, scratch);
  const t = (shape.level - eye.y) / scratch.y;
  if (Number.isFinite(t) && t > 0 && lakeShoreInto(SHORE, shape, eye.x + t * scratch.x, eye.z + t * scratch.z).s > 0) return true;
  Frustum.GetPlanesToRef(camera.getTransformationMatrix(), planes);
  for (let k = 0; k < points.length; k += 3) {
    scratch.set(points[k] as number, points[k + 1] as number, points[k + 2] as number);
    let inside = true;
    for (let p = 0; p < planes.length; p++) {
      if ((planes[p] as Plane).dotCoordinate(scratch) < 0) {
        inside = false;
        break;
      }
    }
    if (inside) return true;
  }
  return false;
}
