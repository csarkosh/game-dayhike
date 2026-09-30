/**
 * A scene's time source. Three ways to run: on the wall clock from the
 * moment it was made (or last resumed), held at a time, or stepped to a
 * frame and held there. A hidden tab holds it and a visible one resumes it
 * at the same time, except a stepped clock, which stays where the step put
 * it until `resume`: a recorder's frame must not move because the page was
 * hidden.
 */
export const FPS = 24;

export type SceneClock = {
  /** Seconds into the scene. */
  time(): number;
  hold(): void;
  resume(): void;
  seek(t: number): void;
  /** Frame `frame` at `fps` frames a second, held. */
  step(frame: number, fps: number): void;
  held(): boolean;
  hidden(on: boolean): void;
};

export function createSceneClock(now: () => number): SceneClock {
  /** The wall time (ms) that reads as `base` seconds; null while held. */
  let origin: number | null = now();
  let base = 0;
  let stepped = false;
  let wasRunning = true;
  const time = (): number => (origin === null ? base : base + (now() - origin) / 1000);
  const hold = (): void => {
    if (origin === null) return;
    base = time();
    origin = null;
  };
  const resume = (): void => {
    stepped = false;
    if (origin !== null) return;
    origin = now();
  };
  return {
    time,
    hold,
    resume,
    seek(t) {
      const running = origin !== null;
      base = t;
      origin = running ? now() : null;
    },
    step(frame, fps) {
      hold();
      base = frame / fps;
      stepped = true;
    },
    held: () => origin === null,
    hidden(on) {
      if (stepped) return;
      if (on) {
        wasRunning = origin !== null;
        hold();
      } else if (wasRunning) resume();
    },
  };
}
