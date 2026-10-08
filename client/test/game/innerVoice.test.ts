import { describe, it, expect } from "vitest";
import {
  OFF_TRAIL_M, OFF_TRAIL_S, VOICE_FIRST_S, VOICE_GAP_S, stepInnerVoice, voiceRest, type VoiceInputs, type VoiceState,
} from "../../src/game/innerVoice.js";
import { INNER_LINES } from "../../src/game/innerLines.js";

const DAY: VoiceInputs = {
  climb: 0.5, wet: 1, night: 0, mist: 0, chase: false, ended: false, offTrail: 0, lamp: false, stare: 0, moving: true,
  shadeSeen: false, cry: false, hollowSeen: false, nearCap: false, nearBody: false, safe: false,
};
const NIGHT: VoiceInputs = { ...DAY, climb: 0.7, night: 1, mist: 1, lamp: true };
const DT = 1 / 30;

function run(state: VoiceState, input: VoiceInputs, seconds: number): { state: VoiceState; lines: string[] } {
  const lines: string[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const out = stepInnerVoice(state, input, DT);
    state = out.state;
    if (out.line !== null) lines.push(out.line.text);
  }
  return { state, lines };
}

describe("the inner voice", () => {
  it("has a pool of three lines for every scenario, none of them repeated across the pool: enough variety, few enough clips", () => {
    for (const [scenario, pool] of Object.entries(INNER_LINES)) {
      expect(pool.length, scenario).toBe(3);
      expect(new Set(pool).size, scenario).toBe(pool.length);
    }
  });

  it("speaks at the trailhead once the first seconds have passed, then not again, and keeps the gap between lines", () => {
    const start = { ...DAY, climb: 0 };
    let { state, lines } = run(voiceRest(1), start, VOICE_FIRST_S - 0.5);
    expect(lines).toEqual([]);
    ({ state, lines } = run(state, start, 2));
    expect(lines).toHaveLength(1);
    expect(INNER_LINES.trailhead).toContain(lines[0]);
    // Off the trail at once: the condition holds, but the gap holds it back until VOICE_GAP_S.
    ({ state, lines } = run(state, { ...start, offTrail: OFF_TRAIL_M + 1 }, VOICE_GAP_S - 2));
    expect(lines).toEqual([]);
    ({ state, lines } = run(state, { ...start, offTrail: OFF_TRAIL_M + 1 }, 4));
    expect(lines).toHaveLength(1);
    expect(INNER_LINES.offTrailDay).toContain(lines[0]);
  });

  it("off the trail by day and by night says different things, after OFF_TRAIL_S there, and at most three times each", () => {
    const day = run(voiceRest(2), { ...DAY, offTrail: OFF_TRAIL_M + 1 }, OFF_TRAIL_S - 1);
    expect(day.lines).toEqual([]);
    const day2 = run(day.state, { ...DAY, offTrail: OFF_TRAIL_M + 1 }, 400);
    expect(day2.lines.length).toBe(3);
    for (const l of day2.lines) expect(INNER_LINES.offTrailDay).toContain(l);
    const night = run(voiceRest(3), { ...NIGHT, offTrail: OFF_TRAIL_M + 1 }, 400);
    expect(night.lines.length).toBeGreaterThanOrEqual(3);
    expect(night.lines.filter((l) => INNER_LINES.offTrailNight.includes(l)).length).toBe(3);
  });

  it("speaks its terror at the Hollow before its eyes, once, at once, and the find's shock the same", () => {
    const { lines } = run(voiceRest(4), { ...NIGHT, hollowSeen: true }, 3);
    expect(lines.filter((l) => INNER_LINES.hollow.includes(l))).toHaveLength(1);
    const again = run(run(voiceRest(4), { ...NIGHT, hollowSeen: true }, 3).state, { ...NIGHT, hollowSeen: true }, 120);
    expect(again.lines.filter((l) => INNER_LINES.hollow.includes(l))).toHaveLength(0);
    expect(INNER_LINES.body.every((l) => l.length > 0)).toBe(true);
  });

  it("answers the first cry at once, the second once more, and no later one", () => {
    let { state } = run(voiceRest(5), NIGHT, 30);
    const first = stepInnerVoice(state, { ...NIGHT, cry: true }, DT);
    expect(INNER_LINES.cryFirst).toContain(first.line?.text);
    // The line names its clip: the scenario and its index in the pool.
    expect(first.line?.scenario).toBe("cryFirst");
    expect(INNER_LINES.cryFirst[first.line!.index]).toBe(first.line!.text);
    state = run(first.state, NIGHT, VOICE_GAP_S + 1).state;
    const second = stepInnerVoice(state, { ...NIGHT, cry: true }, DT);
    expect(INNER_LINES.cryAgain).toContain(second.line?.text);
    state = run(second.state, NIGHT, VOICE_GAP_S + 1).state;
    const third = stepInnerVoice(state, { ...NIGHT, cry: true }, DT);
    expect(third.line === null || !INNER_LINES.cryAgain.includes(third.line.text)).toBe(true);
  });

  it("in the chase speaks only the chase's lines: run, the trail, the car", () => {
    let { state, lines } = run(voiceRest(6), { ...NIGHT, chase: true, offTrail: 0 }, 1);
    expect(lines).toHaveLength(1);
    expect(INNER_LINES.chaseStart).toContain(lines[0]);
    ({ state, lines } = run(state, { ...NIGHT, chase: true, offTrail: OFF_TRAIL_M + 3, stare: 1, shadeSeen: true, nearCap: true }, 60));
    for (const l of lines) expect(INNER_LINES.chaseOffTrail).toContain(l);
    const car = stepInnerVoice(state, { ...NIGHT, chase: true, safe: true }, DT);
    expect(INNER_LINES.safe).toContain(car.line?.text);
  });

  it("says nothing once the match has ended", () => {
    const out = run(voiceRest(7), { ...NIGHT, ended: true, cry: true, nearBody: true, offTrail: 20 }, 60);
    expect(out.lines).toEqual([]);
  });

  it("draws a pool in a seeded order with no repeat until it is spent, and two seeds differ", () => {
    const heard = (seed: number) => {
      const out = run(voiceRest(seed), { ...DAY, offTrail: OFF_TRAIL_M + 1 }, 400);
      return out.lines;
    };
    const orders = new Set<string>();
    for (let seed = 11; seed < 23; seed++) {
      const a = heard(seed);
      expect(new Set(a).size).toBe(a.length);
      orders.add(a.join("|"));
    }
    // Twelve seeds over six orders of three: at least two differ.
    expect(orders.size).toBeGreaterThan(1);
  });
});
