import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  DOOR_NAME, DOOR_SWING, STEERING_COLUMN, STEERING_NAME, WHEEL_NAMES, affineInverse, carPartTurn, doorTurn, frontWheel, partMatrix, poseVertices,
  wheelSpinTurn, wheelSteerTurn,
} from "../../src/game/carParts.js";
import { matrixMultiply } from "../../src/game/instancePose.js";
import { stageCar, type CarModel } from "../../src/game/scene/sceneStage.js";
import type { CarPose } from "../../src/game/scene/timeline.js";

const pose = (over: Partial<CarPose> = {}): CarPose => ({ x: 0, y: 0, z: 0, yaw: 0, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset: "cradle", ...over });

describe("the film's car's parts, as a pose turns them", () => {
  it("names the four wheels, the front pair first, the steering wheel and the driver's door", () => {
    expect(WHEEL_NAMES).toEqual(["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]);
    expect(WHEEL_NAMES.map(frontWheel)).toEqual([true, true, false, false]);
    expect([STEERING_NAME, DOOR_NAME]).toEqual(["wheel_steering", "door_driver"]);
    expect(DOOR_SWING).toBeCloseTo(Math.PI / 1.5, 12);
  });

  it("spins every wheel back about its axle, turns the front pair alone, and swings the door outward", () => {
    const p = pose({ wheelSpin: 3, wheelTurn: 0.2, doorOpen: 0.5 });
    expect(wheelSpinTurn(p)).toBe(-3);
    expect([wheelSteerTurn(p, true), wheelSteerTurn(p, false)]).toEqual([-0.2, 0]);
    expect(doorTurn(p)).toBeCloseTo(-0.5 * DOOR_SWING, 12);
    expect(carPartTurn("cradle", p, { x: 0, y: 0, z: 0, w: 1 })).toBeNull();
  });

  it("undoes a turn, a scale and a move", () => {
    const scene = new Scene(new NullEngine());
    const m = new Float32Array(16);
    const q = Quaternion.RotationYawPitchRoll(0.7, -0.3, 1.1);
    // A mirrored, scaled, turned, moved frame, as a loader's root and a part's node make together.
    const world = new TransformNode("n", scene);
    world.rotationQuaternion = q;
    world.scaling.set(1, 1.5, -1);
    world.position.set(3, -2, 5);
    world.computeWorldMatrix(true).copyToArray(m);
    const inverse = affineInverse(m, new Float32Array(16));
    const one = new Float32Array(16);
    matrixMultiply(m, inverse, one);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 16; i++) expect(one[i]).toBeCloseTo(identity[i] as number, 5);
    scene.getEngine().dispose();
  });

  it("carries a part's vertices where the stage on Babylon.js turns its node: under a mirrored root, a wheel spun and turned, the steering wheel about its column", () => {
    const scene = new Scene(new NullEngine());
    // A loader's root (it mirrors the file), the model's own node turned a quarter, and the parts under it where the file has them.
    const mirror = new TransformNode("__root__", scene);
    mirror.rotationQuaternion = new Quaternion(0, 1, 0, 0);
    mirror.scaling.set(1, 1, -1);
    const model = new TransformNode("intro.car", scene);
    model.parent = mirror;
    model.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 1, 0), -Math.PI / 2);
    const part = (name: string, x: number, y: number, z: number): TransformNode => {
      const node = new TransformNode(name, scene);
      node.parent = model;
      node.position.set(x, y, z);
      return node;
    };
    const front = part("wheel_fl", 1.326, 0.348, -0.73);
    const rear = part("wheel_rl", -1.349, 0.348, -0.73);
    const steering = part("wheel_steering", 0.594, 1.034, -0.411);
    const door = part("door_driver", 0.875, 0.897, -0.752);
    const car: CarModel = {
      root: mirror, wheels: [{ node: front, front: true }, { node: rear, front: false }], door, steering, handset: null, cradle: null, handsetRest: null,
    };
    // Three vertices of each part in its own frame, with a normal and a tangent each.
    const own = [[0.3, 0.1, 0.05], [-0.2, 0.25, -0.1], [0, -0.348, 0.12]] as const;
    const normal = new Vector3(0.6, 0.8, 0);
    const local = (node: TransformNode): Float32Array => {
      const out = new Float32Array(16);
      node.computeWorldMatrix(true).copyToArray(out);
      return out;
    };
    const rest = (node: TransformNode): { positions: Float32Array; normals: Float32Array; tangents: Float32Array; local: Float32Array } => {
      const world = node.computeWorldMatrix(true);
      const positions = new Float32Array(9), normals = new Float32Array(9), tangents = new Float32Array(12);
      own.forEach((v, i) => {
        Vector3.TransformCoordinates(new Vector3(v[0], v[1], v[2]), world).toArray(positions, i * 3);
        Vector3.TransformNormal(normal, world).toArray(normals, i * 3);
        Vector3.TransformNormal(normal, world).toArray(tangents, i * 4);
        tangents[i * 4 + 3] = -1;
      });
      return { positions, normals, tangents, local: local(node) };
    };
    const parts = [front, rear, steering, door].map((node) => ({ node, ...rest(node) }));
    const staged = pose({ wheelSpin: 2.3, wheelTurn: 0.17, steer: 0.17 * 15, doorOpen: 0.4 });
    stageCar(staged, car);
    const turn = { x: 0, y: 0, z: 0, w: 1 };
    const matrix = new Float32Array(16);
    for (const { node, positions, normals, tangents, local: frame } of parts) {
      const q = carPartTurn(node.name, staged, turn);
      expect(q, node.name).not.toBeNull();
      const out = { positions: new Float32Array(9), normals: new Float32Array(9), tangents: new Float32Array(12) };
      poseVertices(partMatrix(frame, q as NonNullable<typeof q>, matrix), { positions, normals, tangents }, out, 0, 3);
      // Where Babylon.js has the same vertices now that the node is turned. The root's own place and turn (the pose's) are taken out: the parts are turned in the model.
      mirror.position.set(0, 0, 0);
      mirror.rotation.y = 0;
      const world = node.computeWorldMatrix(true);
      own.forEach((v, i) => {
        const at = Vector3.TransformCoordinates(new Vector3(v[0], v[1], v[2]), world);
        const n = Vector3.TransformNormal(normal, world);
        for (const [k, want] of [at.x, at.y, at.z].entries()) expect(out.positions[i * 3 + k], `${node.name} vertex ${i}`).toBeCloseTo(want, 5);
        for (const [k, want] of [n.x, n.y, n.z].entries()) {
          expect(out.normals[i * 3 + k], `${node.name} normal ${i}`).toBeCloseTo(want, 5);
          expect(out.tangents[i * 4 + k], `${node.name} tangent ${i}`).toBeCloseTo(want, 5);
        }
        // A tangent's handedness is carried as it is.
        expect(out.tangents[i * 4 + 3]).toBe(-1);
      });
    }
    // The column the steering wheel turns about is the stage's.
    expect(Math.hypot(...STEERING_COLUMN)).toBeGreaterThan(0.99);
    scene.getEngine().dispose();
  });

  it("leaves a run it is not asked for as it was", () => {
    const rest = { positions: new Float32Array([1, 2, 3, 4, 5, 6]), normals: new Float32Array([0, 1, 0, 0, 1, 0]), tangents: null };
    const out = { positions: new Float32Array(6), normals: new Float32Array(6), tangents: null };
    const move = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
    poseVertices(move, rest, out, 1, 1);
    expect([...out.positions]).toEqual([0, 0, 0, 14, 25, 36]);
    expect([...out.normals]).toEqual([0, 0, 0, 0, 1, 0]);
  });
});
