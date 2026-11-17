import { describe, expect, it } from "vitest";
import { HAND_JOINT, stageLiteFrame, type LiteStageDeps } from "../../../src/game/lite/sceneStage.js";
import type { LiteActor, LiteCar } from "../../../src/game/lite/sceneryMeshes.js";
import type { Frame } from "../../../src/game/scene/timeline.js";

const frame: Frame = {
  t: 3,
  camera: { x: 1, y: 2, z: 3, yaw: 0.4, pitch: 0.1, fov: 0.43, roll: 0.02, dof: true },
  actors: [{ id: "intro.ranger", x: 5, y: 6, z: 7, yaw: 1.2, clip: "talk", clipTime: 0.75, visible: true }],
  car: { x: 10, y: 11, z: 12, yaw: 3, wheelSpin: 2, doorOpen: 0.5, wheelTurn: 0, steer: 0, handset: "hand", grip: 0.6 },
  caption: { from: 1, to: 4, text: "hello", radio: false },
  black: 0.25,
};

/** An actor that says what it was staged with, and has the hand the film's ranger has. */
function actor(calls: string[], hand = true): LiteActor {
  return {
    settled: Promise.resolve(),
    stage: (pose) => void calls.push(`actor ${pose.id} ${pose.clip}@${pose.clipTime} ${pose.x},${pose.y},${pose.z}`),
    joint: (name, out) => {
      calls.push(`joint ${name}`);
      return hand && name === HAND_JOINT ? out.fill(4) : null;
    },
    dispose: () => undefined,
  };
}

function car(calls: string[]): LiteCar {
  return {
    stage: (pose, hand) => void calls.push(`car ${pose.x},${pose.y},${pose.z} ${pose.yaw} door ${pose.doorOpen} hand ${hand == null ? "none" : hand[0]}`),
    leave: () => undefined,
    tailLamps: () => undefined,
  };
}

function deps(calls: string[], over: Partial<LiteStageDeps> = {}): LiteStageDeps {
  return {
    setFreecam: (v) => void calls.push(`cam ${v.x},${v.y},${v.z} ${v.yaw} ${v.pitch} ${v.fov} ${v.roll}`),
    setDepthOfField: (on) => void calls.push(`dof ${on}`),
    actor: () => null,
    car: () => null,
    captions: { set: (c) => void calls.push(`caption ${c?.text ?? "-"}`), dispose() {} },
    black: (a) => void calls.push(`black ${a}`),
    warn: (line) => void calls.push(`warn ${line}`),
    ...over,
  };
}

describe("a scene's frame on the hike's own renderer", () => {
  it("writes the camera, the depth of field, the caption and the black from the frame", () => {
    const calls: string[] = [];
    stageLiteFrame({ ...frame, actors: [], car: null }, deps(calls));
    expect(calls).toEqual(["cam 1,2,3 0.4 0.1 0.43 0.02", "dof true", "caption hello", "black 0.25"]);
  });

  it("stands each actor as its pose has it, and says once which it has no model for", () => {
    const calls: string[] = [];
    const ranger = actor(calls);
    const d = deps(calls, { actor: (id) => (id === "intro.ranger" ? ranger : null) });
    stageLiteFrame({ ...frame, car: null, actors: [...frame.actors, { ...frame.actors[0]!, id: "nobody" }] }, d);
    stageLiteFrame({ ...frame, car: null, actors: [...frame.actors, { ...frame.actors[0]!, id: "nobody" }] }, d);
    expect(calls.filter((c) => c.startsWith("actor "))).toEqual(["actor intro.ranger talk@0.75 5,6,7", "actor intro.ranger talk@0.75 5,6,7"]);
    expect(calls.filter((c) => c.startsWith("warn "))).toEqual(["warn scene: no model for actor nobody; not drawn"]);
  });

  it("stands the car at its pose with the hand its handset rides in, read after the actors are posed", () => {
    const calls: string[] = [];
    const ranger = actor(calls);
    const theCar = car(calls);
    stageLiteFrame(frame, deps(calls, { actor: () => ranger, car: () => theCar, hand: () => ranger }));
    const order = calls.filter((c) => /^(actor|joint|car) /.test(c));
    expect(order).toEqual(["actor intro.ranger talk@0.75 5,6,7", `joint ${HAND_JOINT}`, "car 10,11,12 3 door 0.5 hand 4"]);
    expect(HAND_JOINT).toBe("hand_r");
  });

  it("leaves the handset in its cradle while the pose has it there, and asks for no hand", () => {
    const calls: string[] = [];
    const ranger = actor(calls);
    const theCar = car(calls);
    stageLiteFrame({ ...frame, car: { ...frame.car!, handset: "cradle" } }, deps(calls, { actor: () => ranger, car: () => theCar, hand: () => ranger }));
    expect(calls.filter((c) => c.startsWith("joint "))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("car "))).toEqual(["car 10,11,12 3 door 0.5 hand none"]);
  });

  it("says once when the handset has no hand to go to, and leaves it in its cradle", () => {
    const calls: string[] = [];
    const handless = actor(calls, false);
    const theCar = car(calls);
    const d = deps(calls, { actor: () => handless, car: () => theCar, hand: () => handless });
    stageLiteFrame(frame, d);
    stageLiteFrame(frame, d);
    expect(calls.filter((c) => c.startsWith("warn "))).toEqual(["warn scene: no hand for the handset; it stays in its cradle"]);
    expect(calls.filter((c) => c.startsWith("car "))).toEqual(["car 10,11,12 3 door 0.5 hand none", "car 10,11,12 3 door 0.5 hand none"]);
    // And with no one to ask, nothing is said: the scene has no hand.
    const quiet: string[] = [];
    stageLiteFrame(frame, deps(quiet, { car: () => car(quiet) }));
    expect(quiet.filter((c) => c.startsWith("warn scene: no hand"))).toEqual([]);
  });

  it("stages a frame whose car has not landed, and one with no car", () => {
    const calls: string[] = [];
    stageLiteFrame(frame, deps(calls, { hand: () => actor(calls) }));
    stageLiteFrame({ ...frame, car: null }, deps(calls, { car: () => car(calls) }));
    expect(calls.filter((c) => /^(car|joint) /.test(c))).toEqual([]);
  });
});
