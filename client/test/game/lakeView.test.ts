import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Frustum } from "@babylonjs/core/Maths/math.frustum.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { lakeInView, lakeViewPoints, newLakeViewPlanes } from "../../src/game/lakeView.js";
import type { LakeShape } from "../../src/sim/lakeShape.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A diagonal lake: its spine from (−30, −30) to (30, 30), 8 m to the shore either side, at level 0. */
const DIAGONAL: LakeShape = { ...stadiumShape({ cx: 0, cz: 0, halfLen: 42, w: 8, level: 0 }), px: [-30, 30], pz: [-30, 30] };

describe("a lake in a camera's view", { timeout: timeLimit(30_000) }, () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    vi.restoreAllMocks();
    engine?.dispose();
    engine = null;
  });

  /** The lake's water as the renderer lays it: a flat square over its box at its level. */
  function setUp(): { scene: Scene; camera: FreeCamera; mesh: Mesh } {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("eye", Vector3.Zero(), scene);
    const mesh = CreateGround("pond_0", { width: 2 * DIAGONAL.bound, height: 2 * DIAGONAL.bound }, scene);
    return { scene, camera, mesh };
  }

  function look(camera: FreeCamera, mesh: Mesh, from: Vector3, to: Vector3): boolean {
    camera.position.copyFrom(from);
    camera.setTarget(to);
    camera.getViewMatrix();
    camera.getProjectionMatrix();
    mesh.computeWorldMatrix();
    return lakeInView(camera, mesh, DIAGONAL, lakeViewPoints(DIAGONAL, 0), newLakeViewPlanes(), new Vector3());
  }

  it("keeps every other point of the shore marched at 2 m, at the lake's level", () => {
    const points = lakeViewPoints(DIAGONAL, 12);
    // The stadium's shore, 2π·8 + 4·42.4 m (about 220 m), in 74 points.
    expect(points.length / 3).toBe(74);
    for (let k = 1; k < points.length; k += 3) expect(points[k]).toBe(12);
    // No two in turn farther apart than two of the march's diagonals.
    let gap = 0;
    for (let k = 3; k < points.length; k += 3) {
      gap = Math.max(gap, Math.hypot((points[k] as number) - (points[k - 3] as number), (points[k + 2] as number) - (points[k - 1] as number)));
    }
    expect(gap).toBeLessThan(4 * Math.SQRT2);
  });

  it("reads the lake out of view from the bank inside its box, facing away from the water", () => {
    const { camera, mesh } = setUp();
    // 42 m from the spine, 34 m from the water, well inside the box's 97 m.
    expect(look(camera, mesh, new Vector3(30, 2, -30), new Vector3(60, 0, -60))).toBe(false);
    // The box alone reads it in view.
    expect(camera.isInFrustum(mesh)).toBe(true);
  });

  it("reads the lake in view from the same bank facing the water", () => {
    const { camera, mesh } = setUp();
    expect(look(camera, mesh, new Vector3(30, 2, -30), new Vector3(0, 0, 0))).toBe(true);
  });

  it("reads the lake in view from over the water with no shore point in view", () => {
    const { camera, mesh } = setUp();
    // 2 m over the spine looking at the water at its feet, away from the near shore.
    expect(look(camera, mesh, new Vector3(0, 2, 0), new Vector3(0.5, -10, -0.5))).toBe(true);
  });

  it("reads the lake out of view without a point test once its box is out of the frustum", () => {
    const { camera, mesh } = setUp();
    const fill = vi.spyOn(Frustum, "GetPlanesToRef");
    const planes = newLakeViewPlanes();
    // 150 m east of the centre, past the box's 97 m, facing farther east.
    camera.position.set(150, 2, 0);
    camera.setTarget(new Vector3(200, 0, 0));
    camera.getViewMatrix();
    camera.getProjectionMatrix();
    mesh.computeWorldMatrix();
    expect(lakeInView(camera, mesh, DIAGONAL, lakeViewPoints(DIAGONAL, 0), planes, new Vector3())).toBe(false);
    // The shore's planes never filled: the box test alone answered.
    expect(fill.mock.calls.some((c) => c[1] === planes)).toBe(false);
  });
});
