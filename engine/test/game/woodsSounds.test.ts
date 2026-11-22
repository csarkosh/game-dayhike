import { describe, it, expect } from "vitest";
import {
  FLY_DAY_MIN, FLY_GAP_S, ODD_BEHIND_SHARE, ODD_GAP_FIRST_S, ODD_GAP_FULL_S, ODD_KINDS, ODD_NIGHT_MIN, ODD_RANGE,
  WOODS_SOUNDS_REST, draw, stepWoodsSounds, woodsSoundsFrom, type OddCue, type WoodsSoundsInputs,
} from "../../src/game/woodsSounds.js";

const DT = 1 / 60;
function run(seed: number, input: WoodsSoundsInputs, seconds: number): OddCue[] {
  let state = woodsSoundsFrom(seed);
  const cues: OddCue[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const out = stepWoodsSounds(state, input, DT);
    state = out.state;
    if (out.cue !== null) cues.push(out.cue);
  }
  return cues;
}
const DAY: WoodsSoundsInputs = { night: 0, day: 1, chase: false };
const NIGHT: WoodsSoundsInputs = { night: 1, day: 0, chase: false };

describe("the stream", () => {
  it("is a deterministic draw in [0, 1)", () => {
    const a = draw(7), b = draw(7);
    expect(a).toEqual(b);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
    expect(draw(a.seed).value).not.toBe(a.value);
    expect(woodsSoundsFrom(-1).seed).toBe(4294967295);
  });
});

describe("the night's sounds", () => {
  it("are none in the day, under ODD_NIGHT_MIN, or in the chase", () => {
    expect(run(1, DAY, 600).filter((c) => c.kind !== "fly")).toEqual([]);
    expect(run(1, { night: ODD_NIGHT_MIN - 0.01, day: 0, chase: false }, 600)).toEqual([]);
    expect(run(1, { ...NIGHT, chase: true }, 600)).toEqual([]);
    expect(stepWoodsSounds(WOODS_SOUNDS_REST, NIGHT, 0).cue).toBeNull();
  });

  it("come about every ODD_GAP_FULL_S at full night and about every ODD_GAP_FIRST_S as it begins, of every kind, never the same kind twice running", () => {
    const full = run(3, NIGHT, 1200);
    expect(full.length).toBeGreaterThan(1200 / ODD_GAP_FULL_S / 1.6);
    expect(full.length).toBeLessThan(1200 / ODD_GAP_FULL_S / 0.6);
    const kinds = new Set(full.map((c) => c.kind));
    for (const k of ODD_KINDS) expect(kinds.has(k), k).toBe(true);
    for (let i = 1; i < full.length; i++) expect(full[i]!.kind).not.toBe(full[i - 1]!.kind);
    const first = run(3, { night: ODD_NIGHT_MIN, day: 0, chase: false }, 1200);
    expect(first.length).toBeLessThan(full.length / 2);
    expect(first.length).toBeGreaterThan(1200 / ODD_GAP_FIRST_S / 2);
  });

  it("places each kind within its range, mostly behind, and the swell nowhere", () => {
    const cues = run(5, NIGHT, 2400).filter((c) => c.kind !== "fly");
    let behind = 0, placed = 0;
    for (const c of cues) {
      if (c.kind === "swell") { expect([c.x, c.y, c.z]).toEqual([0, 0, 0]); continue; }
      if (c.kind === "fly") continue;
      const [near, far] = ODD_RANGE[c.kind];
      const d = Math.hypot(c.x, c.z);
      expect(d).toBeGreaterThanOrEqual(near - 1e-9);
      expect(d).toBeLessThanOrEqual(far + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-0.5);
      expect(c.y).toBeLessThanOrEqual(1.5);
      expect(c.level).toBeGreaterThan(0.5);
      expect(c.level).toBeLessThanOrEqual(1);
      placed++;
      if (c.z < 0) behind++;
    }
    expect(placed).toBeGreaterThan(50);
    expect(behind / placed).toBeGreaterThan(ODD_BEHIND_SHARE - 0.15);
    expect(behind / placed).toBeLessThan(ODD_BEHIND_SHARE + 0.15);
  });

  it("is the same woods for the same seed, and other woods for another", () => {
    expect(run(9, NIGHT, 300)).toEqual(run(9, NIGHT, 300));
    expect(run(9, NIGHT, 300)).not.toEqual(run(10, NIGHT, 300));
  });
});

describe("the day's flies", () => {
  it("pass about every FLY_GAP_S while the day lasts, close by, and not under FLY_DAY_MIN or in the chase", () => {
    const flies = run(2, DAY, 1200);
    expect(flies.every((c) => c.kind === "fly")).toBe(true);
    expect(flies.length).toBeGreaterThan(1200 / FLY_GAP_S / 1.7);
    expect(flies.length).toBeLessThan(1200 / FLY_GAP_S / 0.5);
    for (const f of flies) expect(Math.hypot(f.x, f.z)).toBeCloseTo(1.2, 9);
    expect(run(2, { night: 0, day: FLY_DAY_MIN - 0.01, chase: false }, 600)).toEqual([]);
    expect(run(2, { ...DAY, chase: true }, 600)).toEqual([]);
  });
});
