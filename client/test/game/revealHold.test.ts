import { afterEach, describe, expect, it, vi } from "vitest";
import { holdReveal, whenFrameWhole } from "../../src/game/revealHold.js";

afterEach(() => {
  vi.useRealTimers();
});

/** A hold on a page whose game HUD shows `status`, recording what it does. */
function held(status = "") {
  const events: string[] = [];
  let hud = status;
  let frame: (() => void) | null = null;
  let lift: (() => void) | null = null;
  let stops = 0;
  const end = holdReveal({
    hideWorld: (hidden) => void events.push(hidden ? "world hidden" : "world shown"),
    showLine: (shown) => void events.push(shown ? "line shown" : "line gone"),
    releaseLine: () => void events.push("line released"),
    status: () => hud,
    eachFrame: (fn) => {
      frame = fn;
      return () => {
        frame = null;
      };
    },
    reveal: (fn) => {
      lift = fn;
      return () => void stops++;
    },
  });
  return {
    events,
    end,
    setStatus: (next: string) => void (hud = next),
    frame: () => frame?.(),
    lift: () => lift?.(),
    stops: () => stops,
    watchingFrames: () => frame !== null,
  };
}

describe("the start's hold on its world", () => {
  it("hides the world under its line, and shows it once a frame left nothing out, its line let go of", () => {
    const hold = held();
    expect(hold.events).toEqual(["world hidden", "line shown"]);
    hold.frame();
    expect(hold.events).toEqual(["world hidden", "line shown"]);
    hold.lift();
    expect(hold.events).toEqual(["world hidden", "line shown", "world shown", "line gone", "line released"]);
    expect(hold.watchingFrames()).toBe(false);
  });

  it("shows its line only while the game's own HUD says nothing, so a follower sees Connecting… alone", () => {
    const hold = held("Connecting…");
    expect(hold.events).toEqual(["world hidden"]);
    hold.frame();
    expect(hold.events).toEqual(["world hidden"]);
    hold.setStatus("");
    hold.frame();
    expect(hold.events).toEqual(["world hidden", "line shown"]);
    hold.setStatus("Reconnecting…");
    hold.frame();
    expect(hold.events).toEqual(["world hidden", "line shown", "line gone"]);
    hold.lift();
    expect(hold.events).toEqual(["world hidden", "line shown", "line gone", "world shown", "line released"]);
  });

  it("is lifted at once by a switch or the game's end, stops waiting for the frame, and lifts once", () => {
    const hold = held();
    hold.end();
    expect(hold.events).toEqual(["world hidden", "line shown", "world shown", "line gone", "line released"]);
    expect(hold.stops()).toBe(1);
    expect(hold.watchingFrames()).toBe(false);
    hold.end();
    hold.lift();
    expect(hold.events).toEqual(["world hidden", "line shown", "world shown", "line gone", "line released"]);
    expect(hold.stops()).toBe(1);
  });

  it("lifts at once where the reveal answers at once, and waits for no frame", () => {
    const events: string[] = [];
    let stops = 0;
    let watching = false;
    holdReveal({
      hideWorld: (hidden) => void events.push(hidden ? "world hidden" : "world shown"),
      showLine: (shown) => void events.push(shown ? "line shown" : "line gone"),
      releaseLine: () => void events.push("line released"),
      status: () => "",
      eachFrame: () => {
        watching = true;
        return () => void (watching = false);
      },
      reveal: (lift) => {
        lift();
        return () => void stops++;
      },
    });
    expect(events).toEqual(["world hidden", "line shown", "world shown", "line gone", "line released"]);
    expect(stops).toBe(1);
    expect(watching).toBe(false);
  });
});

describe("a switch's cover, waiting for a frame that left nothing out", () => {
  it("lifts when one comes, within what is left of its bound, and stops waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let lift: () => void = () => undefined;
    let stops = 0;
    let done = false;
    void whenFrameWhole((fn) => {
      lift = fn;
      return () => void stops++;
    }, 3_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(done).toBe(false);
    lift();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(stops).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(stops).toBe(1);
  });

  it("lifts when what is left of its bound runs out, and stops waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let stops = 0;
    let done = false;
    void whenFrameWhole(() => () => void stops++, 3_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(stops).toBe(1);
  });

  it("waits not at all when nothing is left of its bound, and when the frame is already whole", async () => {
    let watched = 0;
    await whenFrameWhole(() => {
      watched++;
      return () => undefined;
    }, 0);
    expect(watched).toBe(0);
    let stops = 0;
    await whenFrameWhole((fn) => {
      fn();
      return () => void stops++;
    }, 3_000);
    expect(stops).toBe(1);
  });
});
