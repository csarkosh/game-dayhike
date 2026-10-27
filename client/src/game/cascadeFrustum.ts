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
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
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

/**
 * The texel snap's anchor, near (2026-10-27): the point Babylon holds on a
 * texel corner is the world origin, and as the sun moves it is the wrong
 * point. The cascade's light space turns with the sun about the slice's
 * centre; a point `r` metres from that centre moves `r·δ` across the map
 * when the sun turns by `δ`. The origin is hundreds of metres from the
 * player, so on the explore day (a day in sixteen minutes, 0.0003 rad a
 * redraw) it moves whole texels a redraw, and the snap, which rounds it to a
 * corner, re-phases the whole grid by a fraction of a texel each time: every
 * shadow edge is rasterised at a new sub-texel offset twenty times a second
 * while the camera stands still, and the light on the trunks and the cover
 * flickers. In the game the sun moves the same way through the escalation.
 *
 * The anchor here is a world point within `ANCHOR_RANGE` of the slice's
 * centre, fixed while the centre stays near it, so a turn of the sun moves it
 * a fortieth of a texel a redraw at most (the shadows themselves move more)
 * and the camera's own motion does not move it at all. When the centre
 * has left the range the anchor steps after it by whole texels along the
 * map's own axes (`moveAlongLattice`): the grid before and after the step is
 * the same grid, so the step shows nothing. Babylon's origin snap stays and is
 * then overridden by this one (`snapToAnchor`), the generator's matrices
 * rewritten in place after its own `_computeMatrices`, on every redraw.
 */

/** How far (m) a cascade's centre may leave its anchor, across the light, before the anchor steps after it. */
export const ANCHOR_RANGE = 2;

/** A cascade's texel lattice: the world directions of the map's x and y, and the texel's size in metres. */
export type TexelLattice = { readonly ex: Vector3; readonly ey: Vector3; readonly texel: number };

/**
 * The lattice of a cascade from its light-space view matrix (Babylon's row
 * vectors: the world direction that becomes light-space x is the matrix's
 * first column) and its orthographic extent across `mapSize` texels.
 */
export function texelLattice(view: Matrix, minX: number, maxX: number, mapSize: number): TexelLattice {
  const m = view.m;
  return { ex: new Vector3(m[0], m[4], m[8]), ey: new Vector3(m[1], m[5], m[9]), texel: (maxX - minX) / mapSize };
}

/** How far `target` is from `anchor` across the light, in metres. */
export function acrossLight(anchor: Vector3, target: Vector3, lattice: TexelLattice): number {
  const d = target.subtract(anchor);
  return Math.hypot(Vector3.Dot(d, lattice.ex), Vector3.Dot(d, lattice.ey));
}

/** Moves `anchor` to the lattice point nearest `target` across the light: whole texels along the map's axes, so the grid it anchors is unchanged. */
export function moveAlongLattice(anchor: Vector3, target: Vector3, lattice: TexelLattice): void {
  const d = target.subtract(anchor);
  const nx = Math.round(Vector3.Dot(d, lattice.ex) / lattice.texel);
  const ny = Math.round(Vector3.Dot(d, lattice.ey) / lattice.texel);
  anchor.addInPlace(lattice.ex.scale(nx * lattice.texel)).addInPlace(lattice.ey.scale(ny * lattice.texel));
}

/**
 * Shifts the cascade's projection, as Babylon's own snap does, so that
 * `anchor` lands on a texel corner, and rewrites `transform` (view ×
 * projection). Returns the shift applied, in texels.
 */
export function snapToAnchor(anchor: Vector3, view: Matrix, projection: Matrix, transform: Matrix, mapSize: number): { x: number; y: number } {
  const p = Vector3.TransformCoordinates(anchor, transform).scaleInPlace(mapSize / 2);
  const x = Math.round(p.x) - p.x;
  const y = Math.round(p.y) - p.y;
  projection.multiplyToRef(Matrix.Translation((x * 2) / mapSize, (y * 2) / mapSize, 0), projection);
  view.multiplyToRef(projection, transform);
  return { x, y };
}

/** What the anchored snap reads of a generator: its public cascade matrices and extents, and the private centre and array the stock snap also writes. */
type SnapState = {
  stabilizeCascades: boolean;
  mapSize: number;
  numCascades: number;
  getCascadeViewMatrix(cascadeNum: number): Matrix | null;
  getCascadeProjectionMatrix(cascadeNum: number): Matrix | null;
  getCascadeTransformMatrix(cascadeNum: number): Matrix | null;
  getCascadeMinExtents(cascadeNum: number): Vector3 | null;
  getCascadeMaxExtents(cascadeNum: number): Vector3 | null;
  _frustumCenter: Vector3[];
  _transformMatricesAsArray: Float32Array;
  _computeMatrices(): void;
};

/**
 * Makes `shadows` anchor each cascade's texel snap at a world point near the
 * cascade (`ANCHOR_RANGE`) instead of at the world origin, so the map's grid
 * stays still in the world as the sun moves. Nothing while `stabilizeCascades`
 * is off. `range` is the anchor's reach, for tests.
 */
export function installAnchoredSnap(shadows: CascadedShadowGenerator, range: number = ANCHOR_RANGE): void {
  const state = shadows as unknown as SnapState;
  const anchors: Vector3[] = [];
  const stock = state._computeMatrices;
  state._computeMatrices = function (this: SnapState): void {
    stock.call(this);
    if (!this.stabilizeCascades) return;
    for (let i = 0; i < this.numCascades; i++) {
      const view = this.getCascadeViewMatrix(i);
      const projection = this.getCascadeProjectionMatrix(i);
      const transform = this.getCascadeTransformMatrix(i);
      const min = this.getCascadeMinExtents(i);
      const max = this.getCascadeMaxExtents(i);
      const centre = this._frustumCenter[i];
      if (view === null || projection === null || transform === null || min === null || max === null || centre === undefined) continue;
      let anchor = anchors[i];
      if (anchor === undefined) {
        anchor = centre.clone();
        anchors[i] = anchor;
      } else {
        const lattice = texelLattice(view, min.x, max.x, this.mapSize);
        if (acrossLight(anchor, centre, lattice) > range) moveAlongLattice(anchor, centre, lattice);
      }
      snapToAnchor(anchor, view, projection, transform, this.mapSize);
      transform.copyToArray(this._transformMatricesAsArray, i * 16);
    }
  };
}
