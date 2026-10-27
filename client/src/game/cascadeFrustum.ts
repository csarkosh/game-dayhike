/**
 * The cascade's frustum slice, exact (2026-10-27): the eight world-space
 * corners of the camera frustum between two split distances, from the
 * camera's pose, field of view and aspect, in doubles.
 *
 * Babylon's `CascadedShadowGenerator` finds the same corners by inverting the
 * camera's view-projection matrix and unprojecting the clip-space cube
 * (`_computeFrustumInWorldSpace`). That matrix is single precision and, with
 * the game's camera (near 0.05 m, far 10,000 m, a ratio of 2×10⁵), its
 * inverse is ill-conditioned at the far plane: the far corners come out with
 * an error near 1 % that changes with the camera's orientation, and the
 * slice's corners are a fraction of that ray. The stabilised cascade's
 * bounding sphere, and so its texel size, then wobbles by ±1 % as the camera
 * turns (measured in the forest on medium: 26.4–26.9 m for a slice whose
 * exact radius is 26.65 m). Babylon's texel snap is anchored at the world
 * origin, hundreds of metres from the player, so every change of texel size
 * re-phases the whole map by a fraction of a texel: each redraw rasterises
 * every shadow edge at a new sub-texel offset while the camera moves, and
 * the light on the trees shimmers; still, nothing changes. Computed from the
 * pose directly, the radius is constant for a given field of view, aspect
 * and split, the snap holds, and a shadow edge stays where it is in the
 * world through any camera motion.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js";

/** A camera's pose and lens, as the slice reads them. */
export type SlicePose = {
  readonly position: Vector3;
  /** Unit axes in world space. `forward` is where the camera looks. */
  readonly right: Vector3;
  readonly up: Vector3;
  readonly forward: Vector3;
  /** Half-extents of the frustum at unit depth: `tan(fov / 2)` on the fixed axis, scaled by the aspect on the other. */
  readonly tanX: number;
  readonly tanY: number;
};

/**
 * Writes the slice's eight corners into `out` (four at `z0`, then four at
 * `z1`, each in the order −x−y, +x−y, −x+y, +x+y), the depths measured along
 * `forward` from the camera.
 */
export function sliceCorners(pose: SlicePose, z0: number, z1: number, out: Vector3[]): Vector3[] {
  let i = 0;
  for (const z of [z0, z1]) {
    const hx = pose.tanX * z;
    const hy = pose.tanY * z;
    for (const sy of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const corner = out[i++] as Vector3;
        corner.copyFrom(pose.position);
        corner.addInPlace(pose.forward.scale(z));
        corner.addInPlace(pose.right.scale(sx * hx));
        corner.addInPlace(pose.up.scale(sy * hy));
      }
    }
  }
  return out;
}

/** Vertical fixed field of view, Babylon's `Camera.FOVMODE_VERTICAL_FIXED`. */
const FOVMODE_VERTICAL_FIXED = 0;

/** The pose of a perspective `camera` now: its world axes, and its half-extents at unit depth for `aspect`. */
export function cameraPose(camera: Camera, aspect: number, rightHanded: boolean): SlicePose {
  // The world matrix is single precision; its axes are orthonormal to about
  // 1e-7. Re-orthonormalised in doubles, so the slice's shape, and with it
  // the cascade's sphere, is exactly the lens's and never the matrix's.
  const world = camera.getWorldMatrix();
  const forward = Vector3.TransformNormal(rightHanded ? Vector3.Backward() : Vector3.Forward(), world).normalize();
  const right = Vector3.TransformNormal(Vector3.Right(), world);
  right.subtractInPlace(forward.scale(Vector3.Dot(right, forward))).normalize();
  const up = Vector3.Cross(forward, right);
  if (Vector3.Dot(up, Vector3.TransformNormal(Vector3.Up(), world)) < 0) up.scaleInPlace(-1);
  const t = Math.tan(camera.fov / 2);
  const vertical = camera.fovMode === FOVMODE_VERTICAL_FIXED;
  return {
    position: camera.globalPosition,
    right,
    up,
    forward,
    tanX: vertical ? t * aspect : t,
    tanY: vertical ? t : t / aspect,
  };
}

/** What the installer reads of a generator: Babylon's private state the stock computation also uses. */
type FrustumState = {
  _getCamera(): Camera | null;
  _cascades: { prevBreakDistance: number; breakDistance: number }[];
  _frustumCornersWorldSpace: Vector3[][];
  _scene: { getEngine(): { getAspectRatio(camera: Camera): number }; useRightHandedSystem: boolean };
  _shadowMaxZ: number;
  _computeFrustumInWorldSpace(cascadeIndex: number): void;
};

/**
 * Makes `shadows` find each cascade's slice corners from the camera's pose
 * (`sliceCorners`) instead of from the inverse of its view-projection matrix.
 * The split distances are Babylon's own (`_cascades`), interpolated between
 * the near and far planes as the stock code interpolates its corner rays, so
 * the slices are the same slices, found exactly.
 */
export function installExactCascadeFrustum(shadows: CascadedShadowGenerator): void {
  const state = shadows as unknown as FrustumState;
  state._computeFrustumInWorldSpace = function (this: FrustumState, cascadeIndex: number): void {
    const camera = this._getCamera();
    if (camera === null) return;
    const cascade = this._cascades[cascadeIndex];
    const corners = this._frustumCornersWorldSpace[cascadeIndex];
    if (cascade === undefined || corners === undefined) return;
    const near = camera.minZ;
    // An infinite far plane (`maxZ` 0) reaches the shadow's own, as Babylon's does.
    const far = camera.maxZ === 0 ? this._shadowMaxZ : camera.maxZ;
    const pose = cameraPose(camera, this._scene.getEngine().getAspectRatio(camera), this._scene.useRightHandedSystem);
    sliceCorners(pose, near + (far - near) * cascade.prevBreakDistance, near + (far - near) * cascade.breakDistance, corners);
  };
}
