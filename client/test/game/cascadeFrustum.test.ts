import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js";

import { cameraPose, installExactCascadeFrustum, sliceCorners } from "../../src/game/cascadeFrustum.js";
import { GAME_FOV } from "../../src/game/renderer.js";

/** The game's camera: near 0.05 m, far 10,000 m, the game's field of view, a laptop window's aspect. */
const NEAR = 0.05;
const FAR = 10000;
const WIDTH = 1300;
const HEIGHT = 1035;
/** Medium's first cascade in the forest: 18.5 m of the 300 m reach (lambda 0.9). */
const BREAK = 0.0018438;
/** Where the forest view stands, hundreds of metres from the world origin, as the player does. */
const WHERE = new Vector3(250, 31, -500);

type Fake = {
  _getCamera(): Camera;
  _cascades: { prevBreakDistance: number; breakDistance: number }[];
  _frustumCornersWorldSpace: Vector3[][];
  _scene: Scene;
  _shadowMaxZ: number;
  _computeFrustumInWorldSpace(cascadeIndex: number): void;
};

/** Babylon's own corner computation, run on a stand-in with the state it reads: no shadow map, which NullEngine cannot make. */
function stock(scene: Scene, camera: Camera, prev: number, brk: number): Fake {
  const fake: Fake = {
    _getCamera: () => camera,
    _cascades: [{ prevBreakDistance: prev, breakDistance: brk }],
    _frustumCornersWorldSpace: [Array.from({ length: 8 }, () => new Vector3())],
    _scene: scene,
    _shadowMaxZ: 300,
    _computeFrustumInWorldSpace: CascadedShadowGenerator.prototype["_computeFrustumInWorldSpace" as keyof CascadedShadowGenerator] as Fake["_computeFrustumInWorldSpace"],
  };
  return fake;
}

/** The same stand-in with the exact computation installed. */
function exact(scene: Scene, camera: Camera, prev: number, brk: number): Fake {
  const fake = stock(scene, camera, prev, brk);
  installExactCascadeFrustum(fake as unknown as CascadedShadowGenerator);
  return fake;
}

/** The stabilised cascade's bounding sphere, as `_computeCascadeFrustum` finds it: the corners' centroid and the farthest corner from it. */
function radius(corners: Vector3[]): number {
  const centre = corners.reduce((sum, c) => sum.addInPlace(c), Vector3.Zero()).scaleInPlace(1 / corners.length);
  return Math.max(...corners.map((c) => c.subtract(centre).length()));
}

function corners(fake: Fake): Vector3[] {
  fake._computeFrustumInWorldSpace(0);
  return fake._frustumCornersWorldSpace[0] as Vector3[];
}

describe("cascade frustum slice", () => {
  const engines: NullEngine[] = [];
  const make = (rightHanded = false): { scene: Scene; camera: UniversalCamera } => {
    const engine = new NullEngine({ renderWidth: WIDTH, renderHeight: HEIGHT, textureSize: 1, deterministicLockstep: false, lockstepMaxSteps: 1 });
    engines.push(engine);
    const scene = new Scene(engine);
    scene.useRightHandedSystem = rightHanded;
    const camera = new UniversalCamera("cam", WHERE.clone(), scene);
    camera.minZ = NEAR;
    camera.maxZ = FAR;
    camera.fov = GAME_FOV;
    scene.activeCamera = camera;
    return { scene, camera };
  };
  afterEach(() => {
    for (const e of engines.splice(0)) e.dispose();
  });

  const sweep = (camera: UniversalCamera, fake: Fake): number[] => {
    const radii: number[] = [];
    for (let i = 0; i < 180; i++) {
      camera.rotation.y = (i / 180) * Math.PI * 2;
      camera.rotation.x = 0.1 * Math.sin(i / 7);
      camera.getViewMatrix(true);
      camera.getProjectionMatrix(true);
      radii.push(radius(corners(fake)));
    }
    return radii;
  };

  it("Babylon's inverse-matrix corners give a slice radius that wobbles with the camera's orientation (the defect)", () => {
    const { scene, camera } = make();
    const radii = sweep(camera, stock(scene, camera, 0, BREAK));
    const spread = Math.max(...radii) - Math.min(...radii);
    // Measured in the forest: 26.4–26.9 m around an exact 26.65 m. Anything
    // over Babylon's 1/16 m rounding step re-phases the texel snap.
    expect(spread).toBeGreaterThan(1 / 16);
  });

  it("the exact corners give a radius that holds through every orientation, the analytic value", () => {
    const { scene, camera } = make();
    const radii = sweep(camera, exact(scene, camera, 0, BREAK));
    const spread = Math.max(...radii) - Math.min(...radii);
    expect(spread).toBeLessThan(1e-9);
    // The analytic sphere of a slice from z0 to z1: its centroid is on the
    // axis at the mean depth, its farthest corners the far ones.
    const z0 = NEAR;
    const z1 = NEAR + (FAR - NEAR) * BREAK;
    const t = Math.tan(GAME_FOV / 2);
    const a = WIDTH / HEIGHT;
    const zc = (z0 + z1) / 2;
    const expected = Math.hypot(t * a * z1, t * z1, z1 - zc);
    expect(radii[0]).toBeCloseTo(expected, 9);
  });

  it("agrees with Babylon's corners where its inverse is well conditioned, in both handednesses and fov modes", () => {
    for (const rightHanded of [false, true]) {
      for (const fovMode of [Camera.FOVMODE_VERTICAL_FIXED, Camera.FOVMODE_HORIZONTAL_FIXED]) {
        const { scene, camera } = make(rightHanded);
        camera.minZ = 1;
        camera.maxZ = 100;
        camera.fovMode = fovMode;
        camera.rotation.set(0.3, 1.1, 0);
        camera.getViewMatrix(true);
        camera.getProjectionMatrix(true);
        const theirs = corners(stock(scene, camera, 0.2, 0.7)).map((c) => c.clone());
        const ours = corners(exact(scene, camera, 0.2, 0.7));
        // Same eight points, whatever their order.
        for (const p of theirs) {
          const nearest = Math.min(...ours.map((q) => q.subtract(p).length()));
          expect(nearest, `rightHanded ${rightHanded} fovMode ${fovMode}`).toBeLessThan(1e-3);
        }
      }
    }
  });

  it("sliceCorners lays the slice along the pose's axes", () => {
    const pose = { position: new Vector3(1, 2, 3), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), forward: new Vector3(0, 0, 1), tanX: 2, tanY: 1 };
    const out = sliceCorners(pose, 10, 20, Array.from({ length: 8 }, () => new Vector3()));
    expect(out[0]?.asArray()).toEqual([1 - 20, 2 - 10, 13]);
    expect(out[3]?.asArray()).toEqual([1 + 20, 2 + 10, 13]);
    expect(out[4]?.asArray()).toEqual([1 - 40, 2 - 20, 23]);
    expect(out[7]?.asArray()).toEqual([1 + 40, 2 + 20, 23]);
  });

  it("cameraPose reads the lens by its fixed axis", () => {
    const { camera } = make();
    camera.fov = 1;
    camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
    camera.getViewMatrix(true);
    const v = cameraPose(camera, 2, false);
    expect(v.tanY).toBeCloseTo(Math.tan(0.5));
    expect(v.tanX).toBeCloseTo(2 * Math.tan(0.5));
    camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    const h = cameraPose(camera, 2, false);
    expect(h.tanX).toBeCloseTo(Math.tan(0.5));
    expect(h.tanY).toBeCloseTo(Math.tan(0.5) / 2);
  });
});
