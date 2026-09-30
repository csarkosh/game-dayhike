/**
 * Runs a scene: the clock's time → one frame → the stage. A frame is
 * staged on `tick`, which the route calls once an animation frame and a
 * recorder calls once a rendered frame. At the end the clock is held on the
 * last frame and `onEnd` is told once; a seek or a step moves it and plays
 * on. A hidden tab holds the clock.
 */
import { FPS, type SceneClock } from "./sceneClock.js";
import { stageFrame, type StageDeps } from "./sceneStage.js";
import { evaluate, type Frame, type Scene } from "./timeline.js";

export type ScenePlayer = {
  /** Evaluates and stages the frame at the clock's time (or at `at`, which also seeks); returns it. */
  tick(at?: number): Frame;
  seek(t: number): void;
  /** Frame `frame` at 24 frames a second, held. */
  step(frame: number): void;
  hidden(on: boolean): void;
  time(): number;
  ended(): boolean;
  dispose(): void;
};

export function createScenePlayer(scene: Scene, clock: SceneClock, deps: StageDeps, onEnd?: () => void): ScenePlayer {
  let isEnded = false;
  let told = false;
  const player: ScenePlayer = {
    tick(at) {
      if (at !== undefined) player.seek(at);
      let t = clock.time();
      if (t >= scene.duration && !isEnded) {
        isEnded = true;
        clock.seek(scene.duration);
        clock.hold();
        t = scene.duration;
        if (!told) {
          told = true;
          onEnd?.();
        }
      }
      const frame = evaluate(scene, t);
      stageFrame(frame, deps);
      return frame;
    },
    seek(t) {
      isEnded = false;
      clock.seek(t);
      if (clock.held()) clock.resume();
    },
    step(frame) {
      isEnded = false;
      clock.step(frame, FPS);
    },
    hidden: (on) => clock.hidden(on),
    time: () => clock.time(),
    ended: () => isEnded,
    dispose() {
      deps.captions.dispose();
    },
  };
  return player;
}
