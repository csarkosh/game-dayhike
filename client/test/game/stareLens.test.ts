import { describe, it, expect } from "vitest";
import {
  HEART_ATTACK, HEART_BPM_FULL, HEART_BPM_REST, HEART_DUB_AT, HEART_DUB_SHARE, STARE_LENS_REST, STARE_PULSE,
  STARE_SIDE_SHIFT, heartbeat, stareReach, stareShadeUnder, stareSide, stepStareLens, type StareLens,
  CHASE_BPM_CALM, CHASE_LENS_EASE_S, CHASE_PULSE, CHASE_QUICK_IN_S, CHASE_QUICK_OUT_S, CHASE_REACH,
} from "../../src/game/stareLens.js";
import { stareWithDark } from "../../src/game/scenePlay.js";

const DT = 1 / 60;
/** Steps a lens `seconds` at 60 frames a second under one stare and side. */
function run(from: StareLens, stare: number, side: { x: number; y: number } | null, seconds: number): StareLens {
  let lens = from;
  for (let i = 0; i < Math.round(seconds / DT); i++) lens = stepStareLens(lens, stare, side, DT);
  return lens;
}

describe("the heartbeat", () => {
  it("swells twice a beat, the second smaller, and rests for the beat's last half", () => {
    expect(heartbeat(0)).toBe(0);
    expect(heartbeat(HEART_ATTACK)).toBeCloseTo(1, 12);
    expect(heartbeat(HEART_DUB_AT)).toBeLessThan(0.5);
    expect(heartbeat(HEART_DUB_AT + HEART_ATTACK)).toBeGreaterThan(HEART_DUB_SHARE);
    expect(heartbeat(HEART_DUB_AT + HEART_ATTACK)).toBeLessThan(HEART_DUB_SHARE + 0.25);
    for (let p = 0.75; p < 1; p += 0.05) expect(heartbeat(p)).toBeLessThan(0.05);
    for (let p = 0; p < 1; p += 0.001) {
      expect(heartbeat(p)).toBeGreaterThanOrEqual(0);
      expect(heartbeat(p)).toBeLessThanOrEqual(1);
    }
  });

  it("never darkens the frame's edge three times a second: under 90 beats a minute at a full stare", () => {
    // Two swells a beat (WCAG 2.3.1's general flash): 2 × bpm / 60 < 3.
    expect((2 * HEART_BPM_FULL) / 60).toBeLessThan(3);
    expect(HEART_BPM_REST).toBeLessThan(HEART_BPM_FULL);
  });
});

describe("stepStareLens", () => {
  it("stays at rest with no stare, and changes nothing on a frame of no time", () => {
    expect(stepStareLens(STARE_LENS_REST, 0, null, DT)).toEqual(STARE_LENS_REST);
    const lens = run(STARE_LENS_REST, 0.6, { x: 1, y: 0 }, 1);
    expect(stepStareLens(lens, 1, null, 0)).toBe(lens);
  });

  it("follows the stare within a few frames, and begins a beat as the stare begins", () => {
    const first = stepStareLens(STARE_LENS_REST, 0.5, null, DT);
    expect(first.beats).toBe(1);
    expect(first.phase).toBeGreaterThan(0);
    const second = stepStareLens(first, 0.5, null, DT);
    expect(second.beats).toBe(1);
    expect(run(STARE_LENS_REST, 0.5, null, 2).level).toBeCloseTo(0.5, 2);
  });

  it("beats at the rest rate as the stare begins and at the full rate at a full stare", () => {
    const slow = run(STARE_LENS_REST, 0.03, null, 60);
    expect(slow.beats).toBeGreaterThanOrEqual(HEART_BPM_REST);
    expect(slow.beats).toBeLessThanOrEqual(HEART_BPM_REST + 2);
    const fast = run(STARE_LENS_REST, 1, null, 60);
    expect(fast.beats).toBeGreaterThanOrEqual(HEART_BPM_FULL - 1);
    expect(fast.beats).toBeLessThanOrEqual(HEART_BPM_FULL + 1);
    expect(fast.period).toBeCloseTo(60 / HEART_BPM_FULL, 6);
  });

  it("comes to rest once the stare has emptied, keeping its count of beats and its side", () => {
    const full = run(STARE_LENS_REST, 1, { x: -1, y: 0 }, 3);
    const rest = run(full, 0, null, 2);
    expect(rest.level).toBe(0);
    expect(rest.phase).toBe(0);
    expect(rest.beats).toBe(full.beats + Math.round(rest.beats - full.beats));
    expect(rest.beats).toBeGreaterThanOrEqual(full.beats);
    expect(rest.sideX).toBe(full.sideX);
    // The next stare begins one beat on from there.
    expect(stepStareLens(rest, 0.4, null, DT).beats).toBe(rest.beats + 1);
  });

  it("eases its side toward the Hollow's, and holds it when none is in front", () => {
    const toward = run(STARE_LENS_REST, 1, { x: 1, y: -0.5 }, 8);
    expect(toward.sideX).toBeCloseTo(1, 2);
    expect(toward.sideY).toBeCloseTo(-0.5, 2);
    const held = run(toward, 1, null, 5);
    expect(held.sideX).toBe(toward.sideX);
    expect(held.sideY).toBe(toward.sideY);
  });
});

describe("the shade", () => {
  const at = (level: number, phase: number): StareLens => ({ ...STARE_LENS_REST, level, phase, sideX: 0.5, sideY: -1 });

  it("is nothing at rest, slight at a glance and closed at a full stare on the beat", () => {
    expect(stareShadeUnder(STARE_LENS_REST, 9)).toEqual({ x: 0, y: 0, reach: 0, time: 0 });
    expect(stareReach(at(0.2, 0.6))).toBeLessThan(0.1);
    expect(stareReach(at(1, HEART_ATTACK))).toBeCloseTo(1, 12);
    expect(stareReach(at(1, 0.7))).toBeCloseTo(1 - STARE_PULSE * (1 - heartbeat(0.7)), 9);
    expect(stareReach(at(1, 0.95))).toBeCloseTo(1 - STARE_PULSE, 2);
  });

  it("swells with the beat at any level, and puts the open centre off the Hollow's side", () => {
    expect(stareReach(at(0.6, HEART_ATTACK))).toBeGreaterThan(stareReach(at(0.6, 0.6)));
    const shade = stareShadeUnder(at(1, 0.6), 3);
    expect(shade.x).toBeCloseTo(-0.5 * STARE_SIDE_SHIFT, 12);
    expect(shade.y).toBeCloseTo(STARE_SIDE_SHIFT, 12);
    expect(shade.time).toBe(3);
  });
});

describe("the chase's own dark", () => {
  /** Steps a lens `seconds` in the chase, with `threat` at the centre of the view and the sim's `stare`. */
  const chased = (from: StareLens, threat: number, seconds: number, stare = 0): StareLens => {
    let lens = from;
    for (let i = 0; i < Math.round(seconds / DT); i++) lens = stepStareLens(lens, stare, null, DT, threat);
    return lens;
  };
  const reaches = (from: StareLens, threat: number, seconds: number, stare = 0): number[] => {
    const out: number[] = [];
    let lens = from;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      lens = stepStareLens(lens, stare, null, DT, threat);
      out.push(stareReach(lens));
    }
    return out;
  };

  it("names its numbers: a third closed at the top of a beat, near half of that the beat's, 48 beats a minute with nothing in front", () => {
    expect([CHASE_REACH, CHASE_PULSE, CHASE_BPM_CALM, CHASE_LENS_EASE_S, CHASE_QUICK_IN_S, CHASE_QUICK_OUT_S]).toEqual([0.3, 0.45, 48, 1.2, 0.35, 1.5]);
    expect(CHASE_BPM_CALM).toBeLessThan(HEART_BPM_REST);
  });

  it("is there the whole chase, with no stare at all: it comes in over a second or two and pulses between its trough and its top for as long as the chase lasts", () => {
    const settled = chased(STARE_LENS_REST, 0, 6);
    expect(settled.chase).toBeGreaterThan(0.99);
    expect(settled.level).toBe(0);
    const over = reaches(settled, 0, 60);
    expect(Math.max(...over)).toBeCloseTo(CHASE_REACH, 2);
    expect(Math.min(...over)).toBeCloseTo(CHASE_REACH * (1 - CHASE_PULSE), 2);
    // Never at rest in the chase, however long nothing is looked at.
    expect(chased(settled, 0, 120).chase).toBeGreaterThan(0.99);
  });

  it("never closes further than that, however long the player stares at what hunts them", () => {
    const stared = chased(STARE_LENS_REST, 1, 6, 1);
    expect(stared.level).toBeCloseTo(1, 2);
    const over = reaches(stared, 1, 30, 1);
    expect(Math.max(...over)).toBeLessThanOrEqual(CHASE_REACH + 0.005);
    // Where the same stare outside the chase closes the frame.
    expect(stareReach({ ...run(STARE_LENS_REST, 1, null, 6), phase: HEART_ATTACK })).toBeGreaterThan(0.95);
  });

  it("beats faster with a shadow or what hunts at the centre of the view: from 48 a minute to the heart's fastest, and never past it", () => {
    const calm = chased(chased(STARE_LENS_REST, 0, 6), 0, 60).beats - chased(STARE_LENS_REST, 0, 6).beats;
    const pressed = chased(chased(STARE_LENS_REST, 1, 6), 1, 60).beats - chased(STARE_LENS_REST, 1, 6).beats;
    expect(calm).toBeGreaterThanOrEqual(CHASE_BPM_CALM - 1);
    expect(calm).toBeLessThanOrEqual(CHASE_BPM_CALM + 1);
    expect(pressed).toBeGreaterThanOrEqual(HEART_BPM_FULL - 1);
    expect(pressed).toBeLessThanOrEqual(HEART_BPM_FULL + 1);
    const half = chased(chased(STARE_LENS_REST, 0.5, 6), 0.5, 60).beats - chased(STARE_LENS_REST, 0.5, 6).beats;
    expect(half).toBeGreaterThan(calm + 10);
    expect(half).toBeLessThan(pressed - 10);
    expect((2 * HEART_BPM_FULL) / 60).toBeLessThan(3);
  });

  it("quickens within half a second of something coming to the centre, and slows over a few once it has gone", () => {
    const settled = chased(STARE_LENS_REST, 0, 6);
    expect(settled.quick).toBe(0);
    expect(chased(settled, 1, 0.5).quick).toBeGreaterThan(0.7);
    const pressed = chased(settled, 1, 4);
    expect(pressed.quick).toBeGreaterThan(0.99);
    expect(chased(pressed, 0, 0.5).quick).toBeGreaterThan(0.65);
    expect(chased(pressed, 0, 6).quick).toBeLessThan(0.03);
  });

  it("is centred: the stare's dark leans from the Hollow's side, the chase's closes evenly from every edge", () => {
    const leaning: StareLens = { ...chased(STARE_LENS_REST, 0, 6), sideX: 0.8, sideY: -0.4 };
    const shade = stareShadeUnder(leaning, 3);
    expect(Math.abs(shade.x)).toBeLessThan(0.01);
    expect(Math.abs(shade.y)).toBeLessThan(0.01);
    expect(shade.reach).toBeGreaterThan(0);
  });

  it("goes when the chase lets the player go (dead, on the road, the match decided): back to the stare's own, and to rest with none", () => {
    const settled = chased(STARE_LENS_REST, 0.4, 6);
    const after = run(settled, 0, null, 8);
    expect(after.chase).toBe(0);
    expect(after.quick).toBe(0);
    expect(stareReach(after)).toBe(0);
    expect(after).toEqual({ ...STARE_LENS_REST, beats: after.beats });
  });

  it("gives way to a death's closing dark: the dark that takes the frame is not held at the chase's third", () => {
    const settled = chased(STARE_LENS_REST, 0, 6);
    expect(stareWithDark(settled, 0)).toBe(settled);
    expect(stareWithDark(settled, 0.5).chase).toBeCloseTo(settled.chase * 0.5, 9);
    const closed = stareWithDark(settled, 1);
    expect(closed.chase).toBe(0);
    expect(stareReach(closed)).toBeGreaterThan(1 - STARE_PULSE - 0.01);
  });
});

describe("stareSide", () => {
  it("is null behind the camera, the centre dead ahead, and full length at the cone's edge and past it", () => {
    expect(stareSide(1, 0, -5)).toBeNull();
    expect(stareSide(0, 0, 10)).toEqual({ x: 0, y: 0, cos: 1 });
    // 10° right of the aim: about half the cone.
    const half = stareSide(Math.tan((10 * Math.PI) / 180) * 10, 0, 10)!;
    expect(half.x).toBeGreaterThan(0.4);
    expect(half.x).toBeLessThan(0.55);
    expect(half.y).toBe(0);
    const past = stareSide(-8, 6, 10)!;
    expect(Math.hypot(past.x, past.y)).toBeCloseTo(1, 12);
    expect(past.x).toBeCloseTo(-0.8, 12);
    expect(past.y).toBeCloseTo(0.6, 12);
    expect(past.cos).toBeCloseTo(10 / Math.hypot(10, 10), 12);
  });
});
