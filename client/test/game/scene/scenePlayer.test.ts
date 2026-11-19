import { describe, expect, it, vi } from "vitest";
import { createSceneClock } from "../../../src/game/scene/sceneClock.js";
import { createScenePlayer, type SceneStage } from "../../../src/game/scene/scenePlayer.js";
import type { Frame, Scene } from "../../../src/game/scene/timeline.js";

const scene: Scene = {
  duration: 10,
  camera: (t) => ({ x: t, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0.43, roll: 0, dof: false }),
  actors: [],
  car: null,
  captions: [],
  black: () => 0,
};

/** A stage that keeps what it is handed: every frame, where each frame's camera stands along x, and how often it was let go. */
function deps(): SceneStage & { frames: Frame[]; cams: number[]; disposed: number } {
  const frames: Frame[] = [];
  const cams: number[] = [];
  const out = {
    frames, cams, disposed: 0,
    frame: (frame: Frame) => {
      frames.push(frame);
      cams.push(frame.camera.x);
    },
    dispose: () => void (out.disposed += 1),
  };
  return out;
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
    // The stage is handed the frame the tick returns, whole.
    expect(d.frames).toHaveLength(3);
    expect(p.tick()).toBe(d.frames[3]);
    expect(d.frames[3]).toEqual({ t: 10, camera: { x: 10, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0.43, roll: 0, dof: false }, actors: [], car: null, caption: null, black: 0 });
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

  it("lets go of its stage with itself", () => {
    const d = deps();
    const p = createScenePlayer(scene, createSceneClock(() => 0), d);
    p.dispose();
    expect(d.disposed).toBe(1);
  });
});
