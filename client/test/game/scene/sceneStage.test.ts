import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { carModelOf, dimCabParts, stageFrame, type StageDeps } from "../../../src/game/scene/sceneStage.js";
import type { PlacedModel } from "../../../src/game/staticModel.js";
import type { Frame } from "../../../src/game/scene/timeline.js";
import type { CharacterInstance } from "../../../src/game/characterModel.js";

const frame: Frame = {
  t: 3,
  camera: { x: 1, y: 2, z: 3, yaw: 0.4, pitch: 0.1, fov: 0.43, roll: 0.02, dof: true },
  actors: [{ id: "ranger.nathan", x: 5, y: 6, z: 7, yaw: 1.2, clip: "walk", clipTime: 0.75, visible: true }],
  car: { x: 10, y: 11, z: 12, yaw: 3, wheelSpin: 2, doorOpen: 0.5, wheelTurn: 0, steer: 0, handset: "cradle" },
  caption: { from: 1, to: 4, text: "hello", radio: false },
  black: 0.25,
};

function deps(over: Partial<StageDeps> = {}): StageDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setFreecam: (v) => void calls.push(`cam ${v.x},${v.y},${v.z} ${v.yaw} ${v.pitch} ${v.fov} ${v.roll}`),
    setDepthOfField: (on) => void calls.push(`dof ${on}`),
    actor: () => null,
    car: null,
    captions: { set: (c) => void calls.push(`caption ${c?.text ?? "-"}`), dispose() {} },
    black: (a) => void calls.push(`black ${a}`),
    warn: (line) => void calls.push(`warn ${line}`),
    ...over,
  };
}

describe("the stage", () => {
  it("writes the camera, the depth of field, the caption and the black from the frame", () => {
    const d = deps();
    stageFrame(frame, d);
    // The frame's one actor has no instance here: that is the warning between.
    expect(d.calls).toEqual(["cam 1,2,3 0.4 0.1 0.43 0.02", "dof true", "warn scene: no model for actor ranger.nathan; not drawn", "caption hello", "black 0.25"]);
  });

  it("poses a visible actor at its place and clip time, and hides one that is not", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("ranger", scene);
    const pose = vi.fn();
    const instance = { root, pose, clipNames: () => ["Walk"], play() {}, setSpeed() {}, dispose() {} } as unknown as CharacterInstance;
    const d = deps({ actor: (id) => (id === "ranger.nathan" ? instance : null) });
    stageFrame(frame, d);
    expect(root.position.asArray()).toEqual([5, 6, 7]);
    expect(root.rotation.y).toBe(1.2);
    expect(root.isEnabled()).toBe(true);
    expect(pose).toHaveBeenCalledWith("walk", 0.75, undefined);
    stageFrame({ ...frame, actors: [{ ...frame.actors[0]!, visible: false }] }, d);
    expect(root.isEnabled()).toBe(false);
    engine.dispose();
  });

  it("stages a frame with no actor instance and logs once", () => {
    const d = deps();
    stageFrame(frame, d);
    stageFrame(frame, d);
    expect(d.calls.filter((c) => c.startsWith("warn"))).toEqual(["warn scene: no model for actor ranger.nathan; not drawn"]);
  });

  it("moves a car with no parts as a whole, and spins the wheels and swings the door where they exist", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const whole = new TransformNode("car", scene);
    const d = deps({ car: { root: whole, wheels: [], door: null, steering: null, handset: null, cradle: null, handsetRest: null } });
    stageFrame(frame, d);
    expect(whole.position.asArray()).toEqual([10, 11, 12]);
    expect(whole.rotation.y).toBe(3);
    const root = new TransformNode("car2", scene);
    const wheel = new TransformNode("wheel_fl", scene);
    wheel.parent = root;
    const door = new TransformNode("door_driver", scene);
    door.parent = root;
    const parts = carModelOf({ node: root, meshes: [], dispose() {} }, () => {});
    expect(parts.wheels.length).toBe(1);
    expect(parts.door).toBe(door);
    stageFrame(frame, deps({ car: parts }));
    // The parts keep the model's own frame: a wheel's axle is its z.
    expect(wheel.rotation.z).toBe(-2);
    expect(door.rotation.y).toBeCloseTo(-1.047198, 6);
    engine.dispose();
  });

  it("turns a part that came from a loader with a rotation quaternion, which would otherwise ignore the write", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("car3", scene);
    const wheel = new TransformNode("wheel_rl", scene);
    wheel.parent = root;
    // What the glTF loader leaves on every node: a quaternion, under which
    // Babylon ignores the Euler `rotation` entirely.
    wheel.rotationQuaternion = Quaternion.Identity();
    const parts = carModelOf({ node: root, meshes: [], dispose() {} }, () => {});
    stageFrame(frame, deps({ car: parts }));
    // Turned as a bare node under the same car turned the same way is: the up axis of each.
    const bare = new TransformNode("bare", scene);
    bare.parent = root;
    bare.rotation.z = -2;
    const up = (n: TransformNode) => Vector3.TransformNormal(new Vector3(0, 1, 0), n.computeWorldMatrix(true)).asArray().map((v) => +v.toFixed(6));
    expect(up(wheel)).toEqual(up(bare));
    expect(up(wheel)).not.toEqual([0, 1, 0]);
    engine.dispose();
  });
});

describe("the film car's parts", () => {
  /** The car as the loader leaves a model: under a root that flips z, its parts in the model's own frame. */
  function car(scene: Scene, warn: (line: string) => void = () => {}) {
    const handedness = new TransformNode("__root__", scene);
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
    part("wheel_fl", lod0, [1.326, 0.348, -0.73]);
    part("wheel_rr", lod0, [-1.349, 0.348, 0.73]);
    part("wheel_steering", lod0, [0.594, 1.034, -0.411]);
    part("door_driver", lod0, [0.875, 0.897, -0.752]);
    const cradle = part("cradle", lod0, [0.744, 0.784, 0.039]);
    part("handset", cradle, [0, 0.048, 0]);
    return carModelOf({ node: root, meshes: [], dispose() {} } as unknown as PlacedModel, warn);
  }
  const at = (over: Partial<NonNullable<Frame["car"]>>): Frame => ({ ...frame, actors: [], car: { ...frame.car!, ...over } });

  it("puts the handset back where the model rests it in its cradle", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const model = car(scene);
    // A model whose handset lies lower in its cradle, turned a little.
    const handset = model.handset!;
    handset.position.set(0, 0.041, 0);
    handset.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.1, 0, 0);
    const rested = carModelOf({ node: model.root, meshes: [], dispose() {} } as unknown as PlacedModel, () => {});
    const hand = new TransformNode("hand", scene);
    stageFrame(at({ handset: "hand", grip: 1 }), deps({ car: rested, hand: () => hand }));
    stageFrame(at({ handset: "cradle" }), deps({ car: rested }));
    expect(rested.handset!.position.asArray()).toEqual([0, 0.041, 0]);
    expect(rested.handset!.rotationQuaternion!.asArray()).toEqual(Quaternion.RotationYawPitchRoll(0.1, 0, 0).asArray());
    engine.dispose();
  });

  it("lets the radio and its handset see the sky only as a cab's windows do", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const model = car(scene);
    const mic = new Mesh("handset_primitive0", scene);
    mic.parent = model.handset;
    mic.material = new PBRMaterial("mic", scene);
    const radio = new Mesh("cradle_primitive0", scene);
    radio.parent = model.cradle;
    radio.material = new PBRMaterial("radio", scene);
    dimCabParts(model);
    expect([(mic.material as PBRMaterial).environmentIntensity, (radio.material as PBRMaterial).environmentIntensity]).toEqual([0.3, 0.3]);
    engine.dispose();
  });

  it("says once which parts the car lacks", () => {
    const engine = new NullEngine();
    const lines: string[] = [];
    car(new Scene(engine), (line) => void lines.push(line));
    expect(lines).toEqual(["scene: no part wheel_fr on the car; not moved", "scene: no part wheel_rl on the car; not moved"]);
    engine.dispose();
  });

  it("says once when the handset has no hand to go to, and leaves it in its cradle", () => {
    const engine = new NullEngine();
    const model = car(new Scene(engine));
    const d = deps({ car: model, hand: () => null });
    stageFrame(at({ handset: "hand", grip: 1 }), d);
    stageFrame(at({ handset: "hand", grip: 1 }), d);
    expect(d.calls.filter((c) => c.startsWith("warn"))).toEqual(["warn scene: no hand for the handset; it stays in its cradle"]);
    expect(model.handset!.position.asArray()).toEqual([0, 0.048, 0]);
    engine.dispose();
  });

  it("finds the wheels, the steering wheel, the door, the handset and its cradle by name", () => {
    const engine = new NullEngine();
    const model = car(new Scene(engine));
    expect(model.wheels.map((w) => [w.node.name, w.front])).toEqual([["wheel_fl", true], ["wheel_rr", false]]);
    expect([model.steering?.name, model.door?.name, model.handset?.name, model.cradle?.name]).toEqual(["wheel_steering", "door_driver", "handset", "cradle"]);
    engine.dispose();
  });

  it("spins each wheel about its axle, steers the front ones, and turns the steering wheel about its column", () => {
    const engine = new NullEngine();
    const model = car(new Scene(engine));
    stageFrame(at({ wheelSpin: 2, wheelTurn: 0.1, steer: 1.5, doorOpen: 0.5 }), deps({ car: model }));
    const [fl, rr] = model.wheels;
    // The part's frame reverses a turn about y: a front wheel turned toward the car's right turns by -0.1.
    expect([fl!.node.rotation.z, fl!.node.rotation.y, rr!.node.rotation.z, rr!.node.rotation.y]).toEqual([-2, -0.1, -2, 0]);
    const q = model.steering!.rotationQuaternion!;
    const want = Quaternion.RotationAxis(new Vector3(0.871, -0.491, 0).normalize(), 1.5);
    for (const k of ["x", "y", "z", "w"] as const) expect(q[k]).toBeCloseTo(want[k], 9);
    expect(model.door!.rotation.y).toBeCloseTo(-0.5 * (Math.PI / 1.5), 9);
    engine.dispose();
  });

  it("carries the handset in the hand, and puts it back in its cradle on a seek backward", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const model = car(scene);
    // A hand as a skeleton's joint is: scaled with its armature, turned, somewhere in the cab.
    const hand = new TransformNode("hand", scene);
    hand.position = new Vector3(0.4, 1.3, -0.2);
    hand.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.2, 0.1);
    hand.scaling = new Vector3(0.01, 0.01, 0.01);
    const d = deps({ car: model, hand: () => hand });
    stageFrame(at({ handset: "hand" }), d);
    model.handset!.computeWorldMatrix(true);
    // In the fist: 0.075 m along the fingers (the joint's +y), 0.03 m toward the palm (+z) and 0.025 m toward the index finger (+x).
    const want = new Vector3(0.025, 0.075, 0.03).applyRotationQuaternion(hand.rotationQuaternion).add(hand.position);
    const got = model.handset!.getAbsolutePosition();
    for (const k of ["x", "y", "z"] as const) expect(got[k]).toBeCloseTo(want[k], 5);
    stageFrame(at({ handset: "cradle" }), d);
    expect(model.handset!.position.asArray()).toEqual([0, 0.048, 0]);
    expect(model.handset!.rotationQuaternion?.asArray()).toEqual([0, 0, 0, 1]);
    expect(model.handset!.scaling.asArray()).toEqual([1, 1, 1]);
    engine.dispose();
  });

  it("eases the handset between its cradle and the fist by the pose's grip", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const model = car(scene);
    const hand = new TransformNode("hand", scene);
    hand.position = new Vector3(0.4, 1.3, -0.2);
    hand.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.2, 0.1);
    hand.scaling = new Vector3(0.01, -0.01, 0.01);
    const d = deps({ car: model, hand: () => hand });
    const placed = (grip: number): Vector3 => {
      stageFrame(at({ handset: "hand", grip }), d);
      model.handset!.computeWorldMatrix(true);
      return model.handset!.getAbsolutePosition().clone();
    };
    const rest = placed(0);
    expect(model.handset!.position.asArray()).toEqual([0, 0.048, 0]);
    const held = placed(1);
    const half = placed(0.5);
    for (const k of ["x", "y", "z"] as const) expect(half[k]).toBeCloseTo((rest[k] + held[k]) / 2, 6);
    engine.dispose();
  });

  it("sits the handset along a mirrored hand's own fingers, as the model's skeleton has them", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const model = car(scene);
    // A glTF skeleton under Babylon's handedness root: its joints' world matrices mirror one axis.
    const hand = new TransformNode("hand", scene);
    hand.position = new Vector3(0.4, 1.3, -0.2);
    hand.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.2, 0.1);
    hand.scaling = new Vector3(0.01, -0.01, 0.01);
    stageFrame(at({ handset: "hand" }), deps({ car: model, hand: () => hand }));
    model.handset!.computeWorldMatrix(true);
    // The joint's +y is the rotation's -y here: 0.075 m along the fingers, 0.03 m toward the palm, 0.025 m toward the index finger.
    const want = new Vector3(0.025, -0.075, 0.03).applyRotationQuaternion(hand.rotationQuaternion).add(hand.position);
    const got = model.handset!.getAbsolutePosition();
    for (const k of ["x", "y", "z"] as const) expect(got[k]).toBeCloseTo(want[k], 6);
    engine.dispose();
  });
});

describe("an actor placed by a joint", () => {
  function actor(scene: Scene, withJoint: boolean) {
    const root = new TransformNode("ranger", scene);
    const hips = new TransformNode("hips", scene);
    hips.parent = root;
    hips.position = new Vector3(0, 0.25, -1.3);
    const pose = vi.fn();
    const instance = { root, pose, joint: (n: string) => (withJoint && n === "hips" ? hips : null), clipNames: () => [], play() {}, setSpeed() {}, dispose() {} } as unknown as CharacterInstance;
    return { root, hips, pose, instance };
  }
  const anchored = (yaw: number): Frame => ({
    ...frame,
    car: null,
    actors: [{ id: "intro.ranger", x: 1, y: 2, z: 3, yaw, clip: "door", clipTime: 0.1, visible: true, blend: { clip: "drive", clipTime: 55, weight: 0.7 }, anchor: { joint: "hips", x: 5, y: 2, z: 7 } }],
  });

  it("poses the actor with its blend and moves it so the joint is at the anchor, whichever way it faces", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (const yaw of [0, Math.PI / 2]) {
      const a = actor(scene, true);
      stageFrame(anchored(yaw), deps({ actor: () => a.instance }));
      expect(a.pose).toHaveBeenCalledWith("door", 0.1, { clip: "drive", seconds: 55, weight: 0.7 });
      a.root.computeWorldMatrix(true);
      a.hips.computeWorldMatrix(true);
      const at = a.hips.getAbsolutePosition();
      expect([at.x, at.y, at.z].map((v) => Number(v.toFixed(9)))).toEqual([5, 2, 7]);
    }
    engine.dispose();
  });

  it("places an actor at its base when its anchor's joint is missing, and says so once", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const a = actor(scene, false);
    const d = deps({ actor: () => a.instance });
    stageFrame(anchored(0), d);
    stageFrame(anchored(0), d);
    expect(a.root.position.asArray()).toEqual([1, 2, 3]);
    expect(d.calls.filter((c) => c.startsWith("warn"))).toEqual(["warn scene: no joint hips on intro.ranger; placed at its base"]);
    engine.dispose();
  });
});
