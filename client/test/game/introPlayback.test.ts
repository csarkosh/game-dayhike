import { describe, expect, it } from "vitest";
import { createIntroPlayback, HOLD_MS, TITLE_CARD_MS } from "../../src/game/introPlayback.js";

describe("the intro's playback model", () => {
  it("plays, shows skip only once the world is ready, and a ring that fills over the hold", () => {
    const p = createIntroPlayback({});
    p.tick(0, 0, false);
    expect(p.view()).toMatchObject({ state: "playing", showSkip: false, holdFraction: 0 });
    p.holdStart(100);
    p.tick(500, 0.5, false);
    // Not ready: a hold does nothing.
    expect(p.view().holdFraction).toBe(0);
    p.ready();
    p.tick(600, 0.6, false);
    expect(p.view().showSkip).toBe(true);
    p.holdStart(1000);
    p.tick(1400, 1.4, false);
    expect(p.view().holdFraction).toBeCloseTo(400 / HOLD_MS, 6);
    expect(p.state()).toBe("holding");
  });

  it("cuts only on a gesture: a hold released early never skips, a full hold does", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.holdStart(0);
    p.tick(HOLD_MS - 1, 1, false);
    p.holdEnd(HOLD_MS - 1);
    expect(p.state()).toBe("readyToSkip");
    p.holdStart(2000);
    p.tick(2000 + HOLD_MS, 2, false);
    // The ring is full and the hold goes on: the cut is the release, the
    // gesture the browser lets the game take the pointer on.
    expect(p.state()).toBe("holding");
    expect(p.view().holdFraction).toBe(1);
    p.tick(2000 + HOLD_MS + 500, 2.5, false);
    expect(p.state()).toBe("holding");
    p.holdEnd(2000 + HOLD_MS + 500);
    expect(p.state()).toBe("cut");
  });

  it("holds the last frame until ready, then waits for the step-out click", () => {
    const p = createIntroPlayback({});
    p.tick(60_000, 60, true);
    expect(p.view()).toMatchObject({ state: "holdingLast", titleCard: true, showStepOut: false });
    p.tick(60_000 + TITLE_CARD_MS, 60, true);
    expect(p.view().titleCard).toBe(false);
    expect(p.view().showStepOut).toBe(false);
    p.ready();
    p.tick(61_000 + TITLE_CARD_MS, 60, true);
    expect(p.view().showStepOut).toBe(true);
    expect(p.state()).toBe("holdingLast");
    p.gesture();
    expect(p.state()).toBe("cut");
  });

  it("shows the title card once, even when ready came first", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.tick(60_000, 60, true);
    expect(p.view().titleCard).toBe(true);
    p.tick(60_000 + TITLE_CARD_MS + 1, 60, true);
    expect(p.view()).toMatchObject({ titleCard: false, showStepOut: true });
  });

  it("holds its state while hidden", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.holdStart(0);
    p.hidden(true, 100);
    p.tick(5000, 5, false);
    expect(p.view().holdFraction).toBe(0);
    expect(p.state()).toBe("readyToSkip");
    p.hidden(false, 5000);
    p.tick(5001, 5.001, false);
    expect(p.state()).toBe("readyToSkip");
  });

  it("never leaves cut", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.tick(1, 1, true);
    p.tick(1 + TITLE_CARD_MS, 1, true);
    p.gesture();
    p.tick(99_999, 99, true);
    p.holdStart(99_999);
    expect(p.state()).toBe("cut");
  });
});
