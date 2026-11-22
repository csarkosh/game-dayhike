import { describe, it, expect, vi, afterEach } from "vitest";
import { afterNextPaint } from "../../src/game/paint.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("afterNextPaint", () => {
  it("runs after the frame that follows, never inside the current task", () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const ran: string[] = [];
    afterNextPaint(() => ran.push("work"));
    expect(ran).toEqual([]);
    // The frame callback runs before that frame paints, so the work must not
    // run there either — only once the frame's timers fire, after the paint.
    for (const cb of frames.splice(0)) cb(16);
    expect(ran).toEqual([]);
    vi.runAllTimers();
    expect(ran).toEqual(["work"]);
  });
});
