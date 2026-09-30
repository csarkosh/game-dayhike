import { describe, expect, it, vi } from "vitest";
import { createSceneClock } from "../../../src/game/scene/sceneClock.js";
import { createScenePlayer } from "../../../src/game/scene/scenePlayer.js";
import type { Scene } from "../../../src/game/scene/timeline.js";
import type { StageDeps } from "../../../src/game/scene/sceneStage.js";

const scene: Scene = {
  duration: 10,
  camera: (t) => ({ x: t, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0.43, roll: 0, dof: false }),
  actors: [],
  car: null,
  captions: [],
  black: () => 0,
};

function deps(): StageDeps & { cams: number[] } {
  const cams: number[] = [];
  return { cams, setFreecam: (v) => void cams.push(v.x), setDepthOfField() {}, actor: () => null, car: null, captions: { set() {}, dispose() {} }, black() {}, warn() {} };
}

describe("the scene player", () => {
  it("stages the frame at the clock's time, and holds the last frame at the end, saying so once", () => {
    let ms = 0;
    const onEnd = vi.fn();
    const d = deps();
    const p = createScenePlayer(scene, createSceneClock(() => ms), d, onEnd);
    ms = 2500;
    expect(p.tick().t).toBe(2.5);
    ms = 12000;
    expect(p.tick().t).toBe(10);
    expect(p.ended()).toBe(true);
    ms = 20000;
    expect(p.tick().t).toBe(10);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(d.cams).toEqual([2.5, 10, 10]);
  });

  it("seeks and steps, a seek after the end playing on from there", () => {
    let ms = 0;
    const d = deps();
    const p = createScenePlayer(scene, createSceneClock(() => ms), d);
    p.step(48);
    ms = 9000;
    expect(p.tick().t).toBe(2);
    ms = 50000;
    p.tick();
    expect(p.ended()).toBe(false);
    p.seek(3);
    expect(p.tick().t).toBe(3);
  });

  it("holds while hidden", () => {
    let ms = 0;
    const p = createScenePlayer(scene, createSceneClock(() => ms), deps());
    ms = 1000;
    p.hidden(true);
    ms = 5000;
    expect(p.tick().t).toBe(1);
    p.hidden(false);
    ms = 6000;
    expect(p.tick().t).toBe(2);
  });
});
