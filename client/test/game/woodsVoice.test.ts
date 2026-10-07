import { describe, it, expect } from "vitest";
import {
  BIRDS_HOLD_S, BIRDS_RAIN_SHARE, BIRDS_WET_CUT, CALL_CLIMBS, CALL_FAR_HZ, CALL_FAR_LEVEL, CALL_FAR_M,
  CALL_NEAR_HZ, CALL_NEAR_LEVEL, CALL_NEAR_M, CALL_NIGHT_MIN, HOLLOW_CALL_CLIP, REVEAL_HZ, REVEAL_LEVEL, REVEAL_NEAR_M, REVEAL_SILENCE_S,
  WOODS_REST, birdsAt, callCue, revealCue, stepWoods,
  type WoodsInputs, type WoodsState,
} from "../../src/game/woodsVoice.js";
import { CALL_CLIP } from "../../src/game/wildlifeAudio.js";
import { DUSK_AT } from "../../src/game/escalation.js";

const DT = 1 / 60;
const CLIMBING: WoodsInputs = { climb: 0, wet: 0, night: 0, chase: false, hollow: false, rain: 0, crest: 500 };
/** The climb at full night, for the calls. */
const DARK: WoodsInputs = { ...CLIMBING, wet: 1, night: 1 };
/** The night, at the crest. */
const NIGHT: WoodsInputs = { ...CLIMBING, climb: 1, wet: 1, night: 1 };
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
  it("is all there in the day, half in the wet act, and gone by night", () => {
    expect(birdsAt(0, 0)).toBe(1);
    expect(birdsAt(1, 0)).toBeCloseTo(1 - BIRDS_WET_CUT, 12);
    expect(birdsAt(0.5, 0)).toBeCloseTo(1 - BIRDS_WET_CUT / 2, 12);
    expect(birdsAt(1, 0.5)).toBeCloseTo((1 - BIRDS_WET_CUT) / 2, 12);
    expect(birdsAt(1, 1)).toBe(0);
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

  it("is silent in the chase, and by night", () => {
    expect(run(WOODS_REST, { ...CLIMBING, chase: true }, 30).state.birds).toBe(0);
    expect(run(WOODS_REST, NIGHT, 30).state.birds).toBe(0);
  });
});

describe("the Hollow's call", () => {
  it("is made from one of the wildlife's recordings, and every mark of it is in the night", () => {
    expect(CALL_CLIP).toContain(HOLLOW_CALL_CLIP);
    for (const mark of CALL_CLIMBS) expect(mark).toBeGreaterThanOrEqual(DUSK_AT);
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
      const out = stepWoods(state, { ...DARK, climb }, DT);
      state = out.state;
      if (out.call !== null) heard.push(out.call.distance);
    }
    expect(heard).toEqual(CALL_CLIMBS.map((_, i) => callCue(i).distance));
    expect(run(state, { ...DARK, climb: 1 }, 5).calls).toBe(0);
  });

  it("is the latest mark's alone when a climb jumps several at once", () => {
    const state = stepWoods(WOODS_REST, CLIMBING, DT).state;
    const jumped = stepWoods(state, { ...DARK, climb: 0.8 }, DT);
    expect(jumped.call).toEqual(callCue(3));
    expect(jumped.state.calls).toBe(4);
    expect(stepWoods(jumped.state, { ...DARK, climb: 0.8 }, DT).call).toBeNull();
  });

  it("waits for the night to be fully in: a mark passed at dusk is heard, the latest alone, once it is", () => {
    const state = stepWoods(WOODS_REST, CLIMBING, DT).state;
    const dusk = stepWoods(state, { ...CLIMBING, climb: 0.5, wet: 1, night: 0.6 }, DT);
    expect(dusk.call).toBeNull();
    expect(dusk.state.calls).toBe(0);
    const night = stepWoods(dusk.state, { ...DARK, climb: 0.56 }, DT);
    expect(night.call).toEqual(callCue(1));
    expect(night.state.calls).toBe(2);
    expect(CALL_NIGHT_MIN).toBeGreaterThan(0.9);
  });

  it("is not heard for the marks a screen joins past, nor in the chase", () => {
    const joined = stepWoods(WOODS_REST, { ...CLIMBING, climb: 0.8 }, DT);
    expect(joined.call).toBeNull();
    expect(joined.state.calls).toBe(4);
    expect(stepWoods(joined.state, { ...DARK, climb: 0.86 }, DT).call).toEqual(callCue(4));
    const chase = run(stepWoods(WOODS_REST, CLIMBING, DT).state, { ...CLIMBING, climb: 1, chase: true }, 2);
    // One call in the chase: the reveal's, not a mark's.
    expect(chase.calls).toBe(1);
    expect(chase.state.calls).toBe(CALL_CLIMBS.length);
  });
});

describe("the reveal", () => {
  const CHASE: WoodsInputs = { ...NIGHT, chase: true, hollow: true, crest: 12 };

  it("cuts the world's sound as the chase begins, holds the silence, then calls once from the body", () => {
    let state = run(WOODS_REST, { ...CLIMBING, climb: 1 }, 1).state;
    const first = stepWoods(state, CHASE, DT);
    expect(first.hush).toBe(1);
    expect(first.call).toBeNull();
    state = first.state;
    let called = -1;
    let cue = null;
    for (let i = 1; i <= 600; i++) {
      const out = stepWoods(state, CHASE, DT);
      state = out.state;
      if (out.call !== null) {
        expect(called).toBe(-1);
        called = i;
        cue = out.call;
        expect(out.hush).toBe(0);
      } else expect(out.hush).toBe(called < 0 ? 1 : 0);
    }
    expect(called * DT).toBeGreaterThanOrEqual(REVEAL_SILENCE_S - DT);
    expect(called * DT).toBeLessThanOrEqual(REVEAL_SILENCE_S + 2 * DT);
    expect(cue).toEqual(revealCue(12));
  });

  it("is louder and clearer beside the body than any call of the climb, and the climb's far call from far off", () => {
    expect(revealCue(0)).toEqual({ distance: 0, level: REVEAL_LEVEL, cutoffHz: REVEAL_HZ });
    expect(revealCue(REVEAL_NEAR_M).level).toBe(REVEAL_LEVEL);
    expect(REVEAL_LEVEL).toBeGreaterThan(CALL_NEAR_LEVEL);
    expect(REVEAL_HZ).toBeGreaterThan(CALL_NEAR_HZ);
    const far = revealCue(CALL_FAR_M + 300);
    expect(far.level).toBeCloseTo(CALL_FAR_LEVEL, 12);
    expect(far.cutoffHz).toBeCloseTo(CALL_FAR_HZ, 12);
    expect(revealCue(200).level).toBeLessThan(revealCue(100).level);
  });

  it("is not staged for a screen that joins a chase under way, and never twice", () => {
    const joined = run(WOODS_REST, CHASE, 10);
    expect(joined.calls).toBe(0);
    expect(stepWoods(WOODS_REST, CHASE, DT).hush).toBe(0);
    const once = run(run(WOODS_REST, { ...CLIMBING, climb: 1 }, 1).state, CHASE, 30);
    expect(once.calls).toBe(1);
    expect(once.state.reveal).toBe(-1);
  });
});
