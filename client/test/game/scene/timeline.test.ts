import { describe, expect, it } from "vitest";
import { captionAt, clampTime, evaluate, type Scene } from "../../../src/game/scene/timeline.js";

const captions = [
  { from: 1, to: 3, text: "Four-one, dispatch.", radio: true },
  { from: 3, to: 4.5, text: "Four-one. Go ahead.", radio: false },
];

const scene: Scene = {
  duration: 10,
  camera: (t) => ({ x: t, y: 2, z: 0, yaw: 0, pitch: 0, fov: 0.43, roll: 0, dof: false }),
  actors: [(t) => ({ id: "ranger", x: 0, y: 0, z: t * 2, yaw: 1, clip: "walk", clipTime: t, visible: t > 5 })],
  car: (t) => ({ x: 1, y: 0, z: 10 * t, yaw: 0, wheelSpin: t, doorOpen: 0 }),
  captions,
  black: (t) => (t < 1 ? 1 - t : 0),
};

describe("the timeline", () => {
  it("evaluates one frame from t, the same numbers every call", () => {
    const a = evaluate(scene, 2.5);
    const b = evaluate(scene, 2.5);
    expect(a).toEqual(b);
    expect(a.camera.x).toBe(2.5);
    expect(a.actors[0]?.z).toBe(5);
    expect(a.actors[0]?.visible).toBe(false);
    expect(a.car?.z).toBe(25);
    expect(a.caption?.text).toBe("Four-one, dispatch.");
    expect(a.black).toBe(0);
  });

  it("gives the caption for t or none, the boundary belonging to the later line", () => {
    expect(captionAt(captions, 0.5)).toBeNull();
    expect(captionAt(captions, 3)?.text).toBe("Four-one. Go ahead.");
    expect(captionAt(captions, 4.5)).toBeNull();
  });

  it("clamps t into [0, duration]", () => {
    expect(clampTime(scene, -3)).toBe(0);
    expect(clampTime(scene, 99)).toBe(10);
    expect(evaluate(scene, 99).t).toBe(10);
    expect(evaluate(scene, -1).black).toBe(1);
  });
});
