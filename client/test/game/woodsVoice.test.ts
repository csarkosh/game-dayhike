import { describe, it, expect } from "vitest";
import {
  BIRDS_FULL_UNTIL, BIRDS_GONE_AT, BIRDS_HOLD_S, BIRDS_RAIN_SHARE, CALL_CLIMBS, CALL_FAR_HZ, CALL_FAR_LEVEL, CALL_FAR_M,
  CALL_NEAR_HZ, CALL_NEAR_LEVEL, CALL_NEAR_M, HOLLOW_CALL_CLIP, WOODS_REST, birdsAt, callCue, stepWoods,
  type WoodsInputs, type WoodsState,
} from "../../src/game/woodsVoice.js";
import { CALL_CLIP } from "../../src/game/wildlifeAudio.js";

const DT = 1 / 60;
const CLIMBING: WoodsInputs = { climb: 0, chase: false, hollow: false, rain: 0 };
function run(from: WoodsState, input: WoodsInputs, seconds: number): { state: WoodsState; calls: number } {
  let state = from;
  let calls = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const out = stepWoods(state, input, DT);
    state = out.state;
    if (out.call !== null) calls++;
  }
  return { state, calls };
}

describe("the birdsong", () => {
  it("is all there low down, thins evenly with the climb, and is gone short of the crest", () => {
    expect(birdsAt(0)).toBe(1);
    expect(birdsAt(BIRDS_FULL_UNTIL)).toBe(1);
    expect(birdsAt((BIRDS_FULL_UNTIL + BIRDS_GONE_AT) / 2)).toBeCloseTo(0.5, 12);
    expect(birdsAt(BIRDS_GONE_AT)).toBe(0);
    expect(birdsAt(1)).toBe(0);
  });

  it("starts at what the climb leaves, with no fade in, and rain takes most of it", () => {
    expect(stepWoods(WOODS_REST, CLIMBING, DT).state.birds).toBe(1);
    expect(stepWoods(WOODS_REST, { ...CLIMBING, rain: 1 }, DT).state.birds).toBeCloseTo(BIRDS_RAIN_SHARE, 12);
  });

  it("stops within a breath when a Hollow is out, stays stopped after it has gone, and comes back slowly", () => {
    const singing = run(WOODS_REST, CLIMBING, 1).state;
    const hushed = run(singing, { ...CLIMBING, hollow: true }, 0.5).state;
    expect(hushed.birds).toBeLessThan(0.01);
    expect(hushed.hold).toBe(BIRDS_HOLD_S);
    // Gone: silent for the hold, then a slow return.
    const held = run(hushed, CLIMBING, BIRDS_HOLD_S - 0.5).state;
    expect(held.birds).toBeLessThan(0.01);
    const back = run(held, CLIMBING, 5).state;
    expect(back.birds).toBeGreaterThan(0.2);
    expect(back.birds).toBeLessThan(0.6);
    expect(run(back, CLIMBING, 60).state.birds).toBeCloseTo(1, 2);
  });

  it("is silent in the chase", () => {
    expect(run(WOODS_REST, { ...CLIMBING, chase: true }, 30).state.birds).toBe(0);
  });
});

describe("the Hollow's call", () => {
  it("is made from one of the wildlife's recordings", () => {
    expect(CALL_CLIP).toContain(HOLLOW_CALL_CLIP);
  });

  it("is far, quiet and dull at the first mark and near, loud and clear at the last", () => {
    expect(callCue(0)).toEqual({ distance: CALL_FAR_M, level: CALL_FAR_LEVEL, cutoffHz: CALL_FAR_HZ });
    const last = callCue(CALL_CLIMBS.length - 1);
    expect(last.distance).toBeCloseTo(CALL_NEAR_M, 9);
    expect(last.level).toBeCloseTo(CALL_NEAR_LEVEL, 9);
    expect(last.cutoffHz).toBeCloseTo(CALL_NEAR_HZ, 9);
    for (let i = 1; i < CALL_CLIMBS.length; i++) {
      expect(CALL_CLIMBS[i]!).toBeGreaterThan(CALL_CLIMBS[i - 1]!);
      expect(callCue(i).distance).toBeLessThan(callCue(i - 1).distance);
      expect(callCue(i).level).toBeGreaterThan(callCue(i - 1).level);
    }
  });

  it("sounds once as the climb passes each mark, in order, and never twice", () => {
    let state = stepWoods(WOODS_REST, CLIMBING, DT).state;
    const heard: number[] = [];
    for (let climb = 0; climb <= 1.0001; climb += 0.002) {
      const out = stepWoods(state, { ...CLIMBING, climb }, DT);
      state = out.state;
      if (out.call !== null) heard.push(out.call.distance);
    }
    expect(heard).toEqual(CALL_CLIMBS.map((_, i) => callCue(i).distance));
    expect(run(state, { ...CLIMBING, climb: 1 }, 5).calls).toBe(0);
  });

  it("is one a frame when a climb jumps several marks", () => {
    let state = stepWoods(WOODS_REST, CLIMBING, DT).state;
    const first = stepWoods(state, { ...CLIMBING, climb: 0.5 }, DT);
    expect(first.call).toEqual(callCue(0));
    state = first.state;
    expect(stepWoods(state, { ...CLIMBING, climb: 0.5 }, DT).call).toEqual(callCue(1));
  });

  it("is not heard for the marks a screen joins past, nor in the chase", () => {
    const joined = stepWoods(WOODS_REST, { ...CLIMBING, climb: 0.7 }, DT);
    expect(joined.call).toBeNull();
    expect(joined.state.calls).toBe(4);
    expect(stepWoods(joined.state, { ...CLIMBING, climb: 0.8 }, DT).call).toEqual(callCue(4));
    const chase = run(stepWoods(WOODS_REST, CLIMBING, DT).state, { ...CLIMBING, climb: 1, chase: true }, 2);
    expect(chase.calls).toBe(0);
    expect(chase.state.calls).toBe(CALL_CLIMBS.length);
  });
});
