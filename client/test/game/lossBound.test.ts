import { describe, expect, it } from "vitest";
import { LOSS_BOUND_COUNT, LOSS_BOUND_WINDOW_MS, LOSS_ENDED_LINE, createLossRecord } from "../../src/game/lossBound.js";

const MINUTE = 60_000;

describe("the bound on rebuilds after a lost device", () => {
  it("is three losses within ten minutes, and its line is one sentence a player can read", () => {
    expect(LOSS_BOUND_COUNT).toBe(3);
    expect(LOSS_BOUND_WINDOW_MS).toBe(10 * MINUTE);
    expect(LOSS_ENDED_LINE.length).toBeGreaterThan(10);
    expect(LOSS_ENDED_LINE.length).toBeLessThan(90);
    expect(LOSS_ENDED_LINE.endsWith(".")).toBe(true);
  });

  it("answers the first two losses and ends the hike at the third inside the window", () => {
    const record = createLossRecord();
    expect(record.note(1_000)).toEqual({ losses: 1, recent: 1, sinceMs: null, end: false });
    expect(record.note(61_000)).toEqual({ losses: 2, recent: 2, sinceMs: 60_000, end: false });
    expect(record.note(9 * MINUTE)).toEqual({ losses: 3, recent: 3, sinceMs: 9 * MINUTE - 61_000, end: true });
    expect(record.losses).toBe(3);
  });

  it("counts a loss exactly the window after the first as inside it, and one a millisecond later as outside", () => {
    const inside = createLossRecord();
    inside.note(0);
    inside.note(1);
    expect(inside.note(LOSS_BOUND_WINDOW_MS).end).toBe(true);
    const outside = createLossRecord();
    outside.note(0);
    outside.note(1);
    expect(outside.note(LOSS_BOUND_WINDOW_MS + 1)).toMatchObject({ losses: 3, recent: 2, end: false });
  });

  it("never ends a hike whose losses are spread wider than the window, however many there are", () => {
    const record = createLossRecord();
    for (let i = 0; i < 40; i++) {
      const note = record.note(i * (LOSS_BOUND_WINDOW_MS / 2 + 1));
      expect(note.end).toBe(false);
      expect(note.recent).toBeLessThanOrEqual(2);
      expect(note.losses).toBe(i + 1);
    }
  });

  it("slides its window: two old losses do not count against a third and a fourth, and the fifth ends it", () => {
    const record = createLossRecord();
    record.note(0);
    record.note(MINUTE);
    expect(record.note(12 * MINUTE)).toMatchObject({ recent: 1, end: false });
    expect(record.note(13 * MINUTE)).toMatchObject({ recent: 2, end: false });
    expect(record.note(14 * MINUTE)).toMatchObject({ losses: 5, recent: 3, end: true });
  });

  it("is the page's: a loss after the bound was reached, still inside the window, ends the next hike at once", () => {
    const record = createLossRecord();
    record.note(0);
    record.note(1_000);
    expect(record.note(2_000).end).toBe(true);
    expect(record.note(5 * MINUTE)).toEqual({ losses: 4, recent: 4, sinceMs: 5 * MINUTE - 2_000, end: true });
    // And once those have left the window, a loss is answered again.
    expect(record.note(16 * MINUTE)).toMatchObject({ losses: 5, recent: 1, end: false });
  });

  it("takes other numbers where it is given them, and a clock that stands still", () => {
    const two = createLossRecord(2, 1_000);
    expect(two.note(50).end).toBe(false);
    expect(two.note(50)).toEqual({ losses: 2, recent: 2, sinceMs: 0, end: true });
  });
});
