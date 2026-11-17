import { describe, expect, it } from "vitest";
import {
  DOOR_NAME, DOOR_SWING, STEERING_COLUMN, STEERING_NAME, WHEEL_NAMES, affineInverse, carPartTurn, doorTurn, frontWheel, partMatrix, poseVertices,
  wheelSpinTurn, wheelSteerTurn,
} from "../../src/game/carParts.js";
import { matrixMultiply } from "../../src/game/instancePose.js";
import { babylonValues } from "../helpers/babylonFixture.js";
import type { CarPose } from "../../src/game/scene/timeline.js";

const pose = (over: Partial<CarPose> = {}): CarPose => ({ x: 0, y: 0, z: 0, yaw: 0, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset: "cradle", ...over });
/**
 * What Babylon.js's nodes and the stage on it gave, recorded. `frame`: the world matrix of a node turned, scaled
 * (1, 1.5, -1) and moved to (3, -2, 5). `parts`: four of the car's parts as nodes where the file has them, under the
 * model's own node turned a quarter, under a loader's root (it mirrors the file); of each its matrix in the model
 * (`local`), three vertices of its own frame with a normal and a tangent each as they rest in the model, and where
 * the same vertices and normal stood once the stage had turned the nodes by `pose`.
 */
const BABYLON = babylonValues<{
  frame: number[];
  pose: CarPose;
  parts: { name: string; local: number[]; positions: number[]; normals: number[]; tangents: number[]; wantPositions: number[]; wantNormals: number[] }[];
}>("numbers/carParts.json");

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
    // A mirrored, scaled, turned, moved frame, as a loader's root and a part's node make together.
    const m = new Float32Array(BABYLON.frame);
    expect([m[12], m[13], m[14]]).toEqual([3, -2, 5]);
    expect(Math.hypot(m[4] as number, m[5] as number, m[6] as number)).toBeCloseTo(1.5, 6);
    const inverse = affineInverse(m, new Float32Array(16));
    const one = new Float32Array(16);
    matrixMultiply(m, inverse, one);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 16; i++) expect(one[i]).toBeCloseTo(identity[i] as number, 5);
  });

  it("carries a part's vertices where the stage on Babylon.js turns its node: under a mirrored root, a wheel spun and turned, the steering wheel about its column", () => {
    const staged = pose({ wheelSpin: 2.3, wheelTurn: 0.17, steer: 0.17 * 15, doorOpen: 0.4 });
    // The record is of this pose, and of a front wheel, a rear one, the steering wheel and the door.
    expect(BABYLON.pose).toEqual(staged);
    expect(BABYLON.parts.map((part) => part.name)).toEqual(["wheel_fl", "wheel_rl", "wheel_steering", "door_driver"]);
    const turn = { x: 0, y: 0, z: 0, w: 1 };
    const matrix = new Float32Array(16);
    for (const part of BABYLON.parts) {
      // Three vertices of the part as they rest in the model, with a normal and a tangent each, and the part's frame there.
      const rest = { positions: new Float32Array(part.positions), normals: new Float32Array(part.normals), tangents: new Float32Array(part.tangents) };
      const frame = new Float32Array(part.local);
      const q = carPartTurn(part.name, staged, turn);
      expect(q, part.name).not.toBeNull();
      const out = { positions: new Float32Array(9), normals: new Float32Array(9), tangents: new Float32Array(12) };
      poseVertices(partMatrix(frame, q as NonNullable<typeof q>, matrix), rest, out, 0, 3);
      // Where Babylon.js had the same vertices once the node was turned, the root's own place and turn (the pose's) taken out: the parts are turned in the model.
      expect([part.wantPositions.length, part.wantNormals.length]).toEqual([9, 9]);
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) {
          expect(out.positions[i * 3 + k], `${part.name} vertex ${i}`).toBeCloseTo(part.wantPositions[i * 3 + k] as number, 5);
          expect(out.normals[i * 3 + k], `${part.name} normal ${i}`).toBeCloseTo(part.wantNormals[i * 3 + k] as number, 5);
          expect(out.tangents[i * 4 + k], `${part.name} tangent ${i}`).toBeCloseTo(part.wantNormals[i * 3 + k] as number, 5);
        }
        // A tangent's handedness is carried as it is.
        expect(out.tangents[i * 4 + 3]).toBe(-1);
      }
    }
    // The column the steering wheel turns about is the stage's.
    expect(Math.hypot(...STEERING_COLUMN)).toBeGreaterThan(0.99);
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
