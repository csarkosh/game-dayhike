import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { carModelOf, stageFrame, worldOf, type StageDeps } from "../../../src/game/scene/sceneStage.js";
import {
  CORD, CORD_PLUG, CORD_SOCKET, GRIP_OFFSET, GRIP_TURN, composeInto, cordEnds, decomposeInto, handsetCarry, handsetInCradle, multiplyInto, type Placed,
} from "../../../src/game/scene/stageParts.js";
import type { PlacedModel } from "../../../src/game/staticModel.js";
import type { Frame } from "../../../src/game/scene/timeline.js";

const placed = (): Placed => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] });

/** The car as the loader leaves a model (a root that mirrors it, its parts in the model's own frame), a hand as a skeleton's joint is, and a stage that moves them. */
function staged(scene: Scene) {
  const handedness = new TransformNode("__root__", scene);
  handedness.rotationQuaternion = new Quaternion(0, 1, 0, 0);
  handedness.scaling = new Vector3(1, 1, -1);
  const root = new TransformNode("car", scene);
  root.parent = handedness;
  const part = (name: string, parent: TransformNode, at: [number, number, number]) => {
    const node = new TransformNode(name, scene);
    node.parent = parent;
    node.position = new Vector3(...at);
    return node;
  };
  const lod0 = part("LOD0", root, [0, 0, 0]);
  const cradle = part("cradle", lod0, [0.294, 0.734, -0.061]);
  part("handset", cradle, [0, 0.041, 0]);
  const model = carModelOf({ node: handedness, meshes: [], dispose() {} } as unknown as PlacedModel, () => undefined);
  // A hand under a mirrored armature a hundredth the model's size, turned, somewhere in the cab.
  const armature = new TransformNode("armature", scene);
  armature.scaling = new Vector3(-0.01, 0.01, 0.01);
  armature.position = new Vector3(-212.4, 31.6, 640.2);
  armature.rotationQuaternion = Quaternion.RotationYawPitchRoll(-1.1, 0, 0);
  const hand = new TransformNode("hand_r", scene);
  hand.parent = armature;
  hand.position = new Vector3(21, 96, 38);
  hand.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.9, -0.4);
  const laid: { x: number; y: number; z: number }[][] = [];
  const deps: StageDeps = {
    setFreecam: () => undefined, setDepthOfField: () => undefined, actor: () => null, car: model, hand: () => hand,
    cord: { lay: (path) => void laid.push(path) }, captions: { set: () => undefined, dispose: () => undefined }, black: () => undefined, warn: () => undefined,
  };
  const frame = (handset: "cradle" | "hand", grip: number): Frame => ({
    t: 0, camera: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0.8, roll: 0, dof: false }, actors: [],
    car: { x: -212.8, y: 30.9, z: 640, yaw: -1.3, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset, grip },
    caption: null, black: 0,
  });
  return { model, hand, deps, frame, laid };
}

const floats = (m: { m: ArrayLike<number> }): Float64Array => Float64Array.from(m.m as ArrayLike<number>);

describe("the handset and its cord, as a stage places them", () => {
  it("holds the grip, the cord's ends and the cord the film was staged with", () => {
    expect(GRIP_OFFSET).toEqual([0.025, 0.075, 0.03]);
    expect(GRIP_TURN).toBeCloseTo(Math.PI / 2, 12);
    expect(CORD_SOCKET).toEqual([-0.0645, -0.012, 0.025]);
    expect(CORD_PLUG).toEqual([-0.0645, 0, 0]);
    expect(CORD).toEqual({ length: 0.6, maxSag: 0.04, radius: 0.006, turns: 20, points: 201 });
  });

  it("takes a matrix apart and puts it together again, a mirrored one too", () => {
    const scene = new Scene(new NullEngine());
    const node = new TransformNode("n", scene);
    node.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.7, -0.3, 1.1);
    node.scaling.set(-0.01, 0.01, 0.01);
    node.position.set(3, -2, 5);
    const m = node.computeWorldMatrix(true);
    const scale = new Vector3(), turn = new Quaternion(), place = new Vector3();
    m.decompose(scale, turn, place);
    const got = decomposeInto(floats(m), placed());
    for (const [i, k] of (["x", "y", "z"] as const).entries()) {
      expect(got.scaling[i]).toBeCloseTo(scale[k], 7);
      expect(got.position[i]).toBeCloseTo(place[k], 6);
    }
    for (const [i, k] of (["x", "y", "z", "w"] as const).entries()) expect(got.rotation[i]).toBeCloseTo(turn[k], 5);
    const again = composeInto(got, new Float64Array(16));
    for (let e = 0; e < 16; e++) expect(again[e]).toBeCloseTo(m.m[e] as number, 6);
    scene.getEngine().dispose();
  });

  it("sits the handset where the stage on Babylon.js sits it: in its cradle, in the fist, and part of the way between", () => {
    const scene = new Scene(new NullEngine());
    const { model, hand, deps, frame } = staged(scene);
    const rest: Placed = { position: [0, 0.041, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
    const held = placed();
    const local = new Float64Array(16);
    const world = new Float64Array(16);
    for (const [handset, grip] of [["cradle", 0], ["hand", 1], ["hand", 0.35], ["hand", 0], ["cradle", 1]] as const) {
      stageFrame(frame(handset, grip), deps);
      const cradle = floats(worldOf(model.cradle!));
      const want = worldOf(model.handset!).m;
      handsetInCradle(handset === "hand" ? floats(worldOf(hand)) : null, cradle, rest, grip, held);
      multiplyInto(cradle, composeInto(held, local), world);
      for (let e = 0; e < 16; e++) expect(world[e], `${handset} ${grip} float ${e}`).toBeCloseTo(want[e] as number, 3);
      // The place to a tenth of a millimetre, at coordinates of hundreds of metres in single floats.
      for (const e of [12, 13, 14]) expect(Math.abs((world[e] as number) - (want[e] as number))).toBeLessThan(2e-4);
    }
    scene.getEngine().dispose();
  });

  it("is the same handset told in the car's own frame as in the world's", () => {
    const scene = new Scene(new NullEngine());
    const { model, hand, deps, frame } = staged(scene);
    stageFrame(frame("hand", 0.6), deps);
    const rest: Placed = { position: [0, 0.041, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
    const inWorld = handsetInCradle(floats(worldOf(hand)), floats(worldOf(model.cradle!)), rest, 0.6, placed());
    // The car's own frame: every matrix under the car's place undone.
    const car = worldOf(model.root).clone().invert();
    const inCar = handsetInCradle(floats(worldOf(hand).multiply(car)), floats(worldOf(model.cradle!).multiply(car)), rest, 0.6, placed());
    for (let i = 0; i < 3; i++) {
      expect(inCar.position[i]).toBeCloseTo(inWorld.position[i] as number, 4);
      expect(inCar.scaling[i]).toBeCloseTo(inWorld.scaling[i] as number, 5);
    }
    for (let i = 0; i < 4; i++) expect(inCar.rotation[i]).toBeCloseTo(inWorld.rotation[i] as number, 4);
    scene.getEngine().dispose();
  });

  it("carries the handset's resting vertices to where its node would stand them", () => {
    const scene = new Scene(new NullEngine());
    const { model, hand, deps, frame } = staged(scene);
    const rest: Placed = { position: [0, 0.041, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
    stageFrame(frame("cradle", 0), deps);
    const cradle = floats(worldOf(model.cradle!));
    const restWorld = floats(worldOf(model.handset!));
    const own = new Vector3(0.02, -0.05, 0.01);
    const resting = Vector3.TransformCoordinates(own, worldOf(model.handset!));
    // In its cradle the carry moves nothing.
    const still = handsetCarry(cradle, handsetInCradle(null, cradle, rest, 0, placed()), restWorld, new Float64Array(16));
    for (const [e, want] of [[0, 1], [5, 1], [10, 1], [12, 0], [13, 0], [14, 0], [1, 0], [6, 0]] as const) expect(still[e]).toBeCloseTo(want, 4);
    stageFrame(frame("hand", 1), deps);
    const want = Vector3.TransformCoordinates(own, worldOf(model.handset!));
    const carry = handsetCarry(cradle, handsetInCradle(floats(worldOf(hand)), cradle, rest, 1, placed()), restWorld, new Float64Array(16));
    const got = {
      x: resting.x * carry[0]! + resting.y * carry[4]! + resting.z * carry[8]! + carry[12]!,
      y: resting.x * carry[1]! + resting.y * carry[5]! + resting.z * carry[9]! + carry[13]!,
      z: resting.x * carry[2]! + resting.y * carry[6]! + resting.z * carry[10]! + carry[14]!,
    };
    // Single floats at hundreds of metres carried through a matrix and back: a millimetre.
    for (const k of ["x", "y", "z"] as const) expect(Math.abs(got[k] - want[k])).toBeLessThan(2e-3);
    scene.getEngine().dispose();
  });

  it("ends the cord at the socket and the plug the stage lays it between", () => {
    const scene = new Scene(new NullEngine());
    const { model, deps, frame, laid } = staged(scene);
    stageFrame(frame("hand", 1), deps);
    const path = laid[laid.length - 1]!;
    const from = { x: 0, y: 0, z: 0 }, to = { x: 0, y: 0, z: 0 };
    cordEnds(floats(worldOf(model.cradle!)), floats(worldOf(model.handset!)), from, to);
    // The coil narrows to nothing at either end: the path's first and last points are the ends.
    for (const k of ["x", "y", "z"] as const) {
      expect(path[0]![k]).toBeCloseTo(from[k], 6);
      expect(path[path.length - 1]![k]).toBeCloseTo(to[k], 6);
    }
    expect(path).toHaveLength(CORD.points);
    scene.getEngine().dispose();
  });
});
