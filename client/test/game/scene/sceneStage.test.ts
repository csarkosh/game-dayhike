import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { carModelOf, stageFrame, type StageDeps } from "../../../src/game/scene/sceneStage.js";
import type { Frame } from "../../../src/game/scene/timeline.js";
import type { CharacterInstance } from "../../../src/game/characterModel.js";

const frame: Frame = {
  t: 3,
  camera: { x: 1, y: 2, z: 3, yaw: 0.4, pitch: 0.1, fov: 0.43, roll: 0.02, dof: true },
  actors: [{ id: "ranger.nathan", x: 5, y: 6, z: 7, yaw: 1.2, clip: "walk", clipTime: 0.75, visible: true }],
  car: { x: 10, y: 11, z: 12, yaw: 3, wheelSpin: 2, doorOpen: 0.5 },
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
    expect(pose).toHaveBeenCalledWith("walk", 0.75);
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
    const d = deps({ car: { root: whole, wheels: [], door: null } });
    stageFrame(frame, d);
    expect(whole.position.asArray()).toEqual([10, 11, 12]);
    expect(whole.rotation.y).toBe(3);
    const root = new TransformNode("car2", scene);
    const wheel = new TransformNode("wheel_fl", scene);
    wheel.parent = root;
    const door = new TransformNode("door_driver", scene);
    door.parent = root;
    const parts = carModelOf({ node: root, meshes: [], dispose() {} });
    expect(parts.wheels.length).toBe(1);
    expect(parts.door).toBe(door);
    stageFrame(frame, deps({ car: parts }));
    expect(wheel.rotation.x).toBe(2);
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
    const parts = carModelOf({ node: root, meshes: [], dispose() {} });
    stageFrame(frame, deps({ car: parts }));
    // Turned as a bare node under the same car turned the same way is: the up axis of each.
    const bare = new TransformNode("bare", scene);
    bare.parent = root;
    bare.rotation.x = 2;
    const up = (n: TransformNode) => Vector3.TransformNormal(new Vector3(0, 1, 0), n.computeWorldMatrix(true)).asArray().map((v) => +v.toFixed(6));
    expect(up(wheel)).toEqual(up(bare));
    expect(up(wheel)).not.toEqual([0, 1, 0]);
    engine.dispose();
  });
});
