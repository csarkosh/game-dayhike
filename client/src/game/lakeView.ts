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
 * The tests themselves load no engine (`lakeSeen.ts`): this module asks them
 * of a Babylon.js camera. The points are made once a lake at load
 * (`lakeViewPoints`), the planes once (`newLakeViewPlanes`), the scratch
 * vector once by the caller: `lakeInView` allocates nothing.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { LakeShape } from "../sim/lakeShape.js";
import { lakeUnderEye, shoreInPlanes } from "./lakeSeen.js";

export { LAKE_VIEW_STEP, lakeViewPoints } from "./lakeSeen.js";

/** The six planes `Frustum.GetPlanesToRef` fills, made once. */
export function newLakeViewPlanes(): Plane[] {
  return [0, 1, 2, 3, 4, 5].map(() => new Plane(0, 0, 0, 0));
}

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
  camera.getDirectionToRef(camera.getScene().useRightHandedSystem ? FORWARD_RH : FORWARD_LH, scratch);
  if (lakeUnderEye(shape, eye.x, eye.y, eye.z, scratch.x, scratch.y, scratch.z)) return true;
  Frustum.GetPlanesToRef(camera.getTransformationMatrix(), planes);
  return shoreInPlanes(points, planes);
}
