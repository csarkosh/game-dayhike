import { describe, expect, it } from "vitest";
import {
  createFrogChorus, FROG_HOLLOW_RESUME, FROG_HOLLOW_STOP, FROG_QUIET_RADIUS,
  type FrogChorus,
} from "../../src/game/frogChorus.js";
import type { FrogVoice } from "../../src/game/waterLifeField.js";

const SEED = 388817;

/**
 * Ten voices round a lake, 30 m from its middle: each 18.5 m from the voices
 * beside it and 35 m from the next ones on, so a stretch of shore is the
 * voices beside one another and a player standing at one hears its
 * neighbours call.
 */
const RING: readonly FrogVoice[] = [
  { x: 30, y: 1, z: 0, seed: 0, marsh: false },
  { x: 24.27, y: 1, z: 17.63, seed: 1, marsh: false },
  { x: 9.27, y: 1, z: 28.53, seed: 2, marsh: false },
  { x: -9.27, y: 1, z: 28.53, seed: 3, marsh: false },
  { x: -24.27, y: 1, z: 17.63, seed: 4, marsh: true },
  { x: -30, y: 1, z: 0, seed: 5, marsh: true },
  { x: -24.27, y: 1, z: -17.63, seed: 6, marsh: false },
  { x: -9.27, y: 1, z: -28.53, seed: 7, marsh: false },
  { x: 9.27, y: 1, z: -28.53, seed: 8, marsh: false },
  { x: 24.27, y: 1, z: -17.63, seed: 9, marsh: false },
];
/** The Hollow nowhere near. */
const FAR = 1000;
const AWAY = [{ x: 500, z: 0 }];
const NOBODY: readonly { x: number; z: number }[] = [];

/** Halfway between two voices: within 9.3 m of both. */
function between(a: number, b: number): { x: number; z: number } {
  return { x: (RING[a]!.x + RING[b]!.x) / 2, z: (RING[a]!.z + RING[b]!.z) / 2 };
}

/** Steps `chorus` every quarter-second from `from` to `to` inclusive (quarters
 * keep every time exact), returning each call as [voice, t]. */
function run(
  chorus: FrogChorus, from: number, to: number,
  players: (t: number) => readonly { x: number; z: number }[],
  hollow: (t: number) => number = () => FAR,
  presence: (t: number) => number = () => 1,
): [number, number][] {
  const log: [number, number][] = [];
  for (let k = from * 4; k <= to * 4; k++) {
    const t = k / 4;
    chorus.step(t, 0.25, players(t), hollow(t), presence(t));
    for (const c of chorus.calls) log.push([c.voice, t]);
  }
  return log;
}

/** Each voice's first call at or after `after`. */
function firstCalls(log: readonly [number, number][], after: number): Record<number, number> {
  const first: Record<number, number> = {};
  for (const [voice, t] of log) if (t >= after && first[voice] === undefined) first[voice] = t;
  return first;
}

/** The voices that call between `from` and `to` (exclusive), in order. */
function calling(log: readonly [number, number][], from: number, to: number): number[] {
  return [...new Set(log.filter(([, t]) => t >= from && t < to).map(([v]) => v))].sort((a, b) => a - b);
}

describe("frogChorus", () => {
  it("a lone voice calls in bouts: eight calls a second apart, then a twelve-second rest", () => {
    const chorus = createFrogChorus([RING[0]!], SEED, () => 0.5);
    const log = run(chorus, 0, 40, () => NOBODY);
    // The first call 5 s in (the onset's draw), eight a bout at a 1 s gap, a 12 s rest.
    expect(log.map(([, t]) => t)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 24, 25, 26, 27, 28, 29, 30, 31]);
  });

  it("a call carries its voice's place and the voice's seeded loudness", () => {
    const chorus = createFrogChorus([RING[0]!], SEED, () => 0.5);
    run(chorus, 0, 4.75, () => NOBODY);
    chorus.step(5, 0.25, NOBODY, FAR, 1);
    expect(chorus.calls).toEqual([{ voice: 0, x: 30, y: 1, z: 0, gain: expect.closeTo(2.0919, 4) }]);
  });

  it("no voices, no calls, and nothing throws", () => {
    const chorus = createFrogChorus([], SEED, () => 0.5);
    expect(run(chorus, 0, 30, () => AWAY)).toEqual([]);
  });

  it("a voice with a player within 12 m stops at once; one just beyond 12 m does not hush it", () => {
    const chorus = createFrogChorus([RING[0]!], SEED, () => 0.5);
    const log = run(chorus, 0, 60, (t) => (t < 6.5 ? NOBODY : [{ x: 30 + FROG_QUIET_RADIUS - 0.1, z: 0 }]));
    // Mid-bout at 6.5 s: the calls at 5 and 6 and none after.
    expect(log.map(([, t]) => t)).toEqual([5, 6]);
    const edge = createFrogChorus([RING[0]!], SEED, () => 0.5);
    const heard = run(edge, 0, 20, () => [{ x: 30 + FROG_QUIET_RADIUS + 0.1, z: 0 }]);
    expect(heard.map(([, t]) => t)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("once the players have gone, the voice whose own wait has run out starts again first, and the others join 5 to 15 s later, never before their own waits", () => {
    // A player halfway between voices 0 and 1 for 10 s, then between 1 and 2
    // for 10 s, then gone. Voice 0 was last near at 9.75 s, voices 1 and 2 at
    // 19.75 s. At voice 0's 30 s draw (39.75 s) it is the only voice of the
    // stretch {0, 1, 2} that has waited, so it leads alone.
    const chorus = createFrogChorus(RING, SEED, () => 0.5);
    const walk = (t: number) => (t < 10 ? [between(0, 1)] : t < 20 ? [between(1, 2)] : AWAY);
    const log = run(chorus, 0, 70, walk).filter(([v]) => v <= 2);
    // Voices 0 and 1 silent from the start, voice 2 from 10 s.
    expect(log.filter(([, t]) => t >= 10 && t < 39.75)).toEqual([]);
    // Voice 0 alone for its whole bout (the call due at 43.75 s waits a quarter
    // second for a neighbour's call to end).
    expect(log.filter(([, t]) => t >= 20 && t < 49.75).map(([v, t]) => `${v}@${t}`)).toEqual([
      "0@39.75", "0@40.75", "0@41.75", "0@42.75", "0@44", "0@45", "0@46", "0@47",
    ]);
    // Voices 1 and 2 have 10 s of their waits to go and the join's draw is 10 s:
    // both join at 49.75 s, voice 2 calling as soon as voice 1's call has ended.
    expect(firstCalls(log, 49.75)).toEqual({ 0: 59, 1: 49.75, 2: 50.25 });
    // Draws of 0: the waits are 20 s and the joins 5 s. Voice 0 leads at 29.75 s; voices 1 and 2
    // have waited 10 s of theirs, so they join at 39.75 s, not 5 s after voice 0.
    const quick = createFrogChorus(RING, SEED, () => 0);
    const early = run(quick, 0, 50, walk).filter(([v]) => v <= 2);
    expect(early.filter(([, t]) => t >= 10 && t < 29.75)).toEqual([]);
    expect(firstCalls(early, 20)).toEqual({ 0: 29.75, 1: 39.75, 2: 40.25 });
  });

  it("when the waits of a stretch end together, the voice nearest its centre leads and the others join 5 to 15 s later", () => {
    // One player halfway between voices 0 and 1 and another between 1 and 2,
    // both gone at 10 s: all three waits end at 39.75 s and voice 1 is the
    // middle of the stretch.
    const chorus = createFrogChorus(RING, SEED, () => 0.5);
    const there = (t: number) => (t < 10 ? [between(0, 1), between(1, 2)] : AWAY);
    const log = run(chorus, 0, 70, there).filter(([v]) => v <= 2);
    expect(log.filter(([, t]) => t >= 0 && t < 39.75)).toEqual([]);
    expect(log.filter(([, t]) => t < 49.75).map(([v, t]) => `${v}@${t}`)).toEqual([
      "1@39.75", "1@40.75", "1@41.75", "1@42.75", "1@43.75", "1@44.75", "1@45.75", "1@46.75",
    ]);
    expect(firstCalls(log, 49.75)).toEqual({ 0: 49.75, 1: 58.75, 2: 49.75 });
  });

  it("a player walking the shore past three voices: each starts again no sooner than 20 s after the player was last within 12 m of it", () => {
    let s = 8;
    const chorus = createFrogChorus(RING.slice(0, 3), SEED, () => (s = (s * 16807) % 2147483647) / 2147483647);
    // 3 m/s along the circle the voices stand on, from 1 radian before voice 0,
    // then gone at 30 s. Voice by voice the player is within 12 m from
    // 6, 12.5 and 18.75 s, and was last within 12 m at 14, 20.25 and 26.5 s.
    const walk = (t: number) => {
      const angle = -1 + 0.1 * t;
      return t < 30 ? [{ x: 30 * Math.cos(angle), z: 30 * Math.sin(angle) }] : AWAY;
    };
    const log = run(chorus, 0, 90, walk);
    const HUSHED_FROM = [6, 12.5, 18.75], LAST_NEAR = [14, 20.25, 26.5];
    for (let v = 0; v < 3; v++) {
      expect(log.filter(([w, t]) => w === v && t >= HUSHED_FROM[v]! && t < LAST_NEAR[v]! + 20)).toEqual([]);
    }
    // Each voice's first call after the player, 21.5, 26.75 and 27.75 s on:
    // its own wait, then its stretch's lead or its join.
    expect([0, 1, 2].map((v) => log.find(([w, t]) => w === v && t > LAST_NEAR[v]!)![1])).toEqual([35.5, 47, 54.25]);
  });

  it("neighbours never start within a call's length of each other", () => {
    let s = 7;
    const chorus = createFrogChorus(RING, SEED, () => (s = (s * 16807) % 2147483647) / 2147483647);
    const log: [number, number][] = [];
    for (let k = 0; k <= 300 * 20; k++) {
      chorus.step(k / 20, 0.05, NOBODY, FAR, 1);
      for (const c of chorus.calls) log.push([c.voice, k / 20]);
    }
    expect(calling(log, 0, 301)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const last = new Map<number, number>();
    let closest = Infinity;
    for (const [v, t] of log) {
      // Each voice's neighbours on the ring are the voices beside it.
      for (const n of [(v + 1) % 10, (v + 9) % 10]) {
        const prev = last.get(n);
        if (prev !== undefined) closest = Math.min(closest, t - prev);
      }
      last.set(v, t);
    }
    expect(closest).toBeGreaterThanOrEqual(0.35 - 1e-9);
  });

  it("every voice stops while the Hollow is within 60 m, and starts again only beyond 80 m", () => {
    const chorus = createFrogChorus(RING, SEED, () => 0.5);
    const hollow = (t: number) => (t < 30 ? FAR : t < 90 ? FROG_HOLLOW_STOP - 10 : t < 150 ? FROG_HOLLOW_RESUME - 10 : FROG_HOLLOW_RESUME + 1);
    const log = run(chorus, 0, 170, () => NOBODY, hollow);
    expect(log.filter(([, t]) => t < 30).length).toBe(140);
    // Silent at once at 50 m, and still at 70 m on the way out.
    expect(log.filter(([, t]) => t >= 30 && t < 150)).toEqual([]);
    // Back beyond 80 m, the chorus starts again within the onset's 10 s.
    // Every draw 0.5 here, so each voice is due at 155 s and neighbours take turns.
    expect(firstCalls(log, 150)).toEqual({ 0: 155, 1: 155.5, 2: 155, 3: 155.5, 4: 155, 5: 155.5, 6: 155, 7: 155.5, 8: 155, 9: 155.5 });
  });

  it("presence thins the chorus by each voice's rank: the same voices every time", () => {
    const voicesAt = (presence: number) =>
      calling(run(createFrogChorus(RING, SEED, () => 0.5), 0, 60, () => NOBODY, () => FAR, () => presence), 0, 61);
    expect(voicesAt(0)).toEqual([]);
    expect(voicesAt(Number.NaN)).toEqual([]);
    expect(voicesAt(0.3)).toEqual([0, 2, 3, 5]);
    expect(voicesAt(0.6)).toEqual([0, 1, 2, 3, 5]);
    expect(voicesAt(1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("a jump from day into the night spreads the first calls over ten seconds rather than one burst", () => {
    // The hour jumps at 30 s: the frogs' presence goes from 0 to 1 in a step.
    const draws = [0.05, 0.5, 0.15, 0.5, 0.25, 0.5, 0.35, 0.5, 0.45, 0.5, 0.55, 0.5, 0.65, 0.5, 0.75, 0.5, 0.85, 0.5, 0.95, 0.5];
    let d = 0;
    const chorus = createFrogChorus(RING, SEED, () => draws[d++ % draws.length]!);
    const log = run(chorus, 0, 45, () => NOBODY, () => FAR, (t) => (t < 30 ? 0 : 1));
    expect(log.filter(([, t]) => t <= 30)).toEqual([]);
    expect(firstCalls(log, 30)).toEqual({
      0: 30.5, 1: 31.75, 2: 32.5, 3: 34, 4: 34.5, 5: 35.5, 6: 36.5, 7: 38, 8: 38.5, 9: 39.5,
    });
  });

  it("a stall fires none of the calls it owes: the chorus starts again over the onset", () => {
    const chorus = createFrogChorus(RING, SEED, () => 0.5);
    run(chorus, 0, 20, () => NOBODY);
    chorus.step(140, 120, NOBODY, FAR, 1);
    expect(chorus.calls).toEqual([]);
    const log = run(chorus, 140.25, 160, () => NOBODY);
    expect(firstCalls(log, 140)).toEqual({ 0: 145, 1: 145.5, 2: 145, 3: 145.5, 4: 145, 5: 145.5, 6: 145, 7: 145.5, 8: 145, 9: 145.5 });
  });

  it("five players round the lake: each voice by one is silent, the voices between call, and each starts again on its own", () => {
    const chorus = createFrogChorus(RING, SEED, () => 0.5);
    const standing = [0, 2, 4, 6, 8].map((i) => ({ x: RING[i]!.x, z: RING[i]!.z }));
    const log = run(chorus, 0, 120, (t) => (t < 60 ? standing : NOBODY));
    expect(calling(log, 0, 60)).toEqual([1, 3, 5, 7, 9]);
    expect(calling(log, 60, 89.75)).toEqual([1, 3, 5, 7, 9]);
    // Each silenced voice is a stretch of its own (35 m from the next): all five lead at once.
    expect(firstCalls(log, 60)).toEqual({ 0: 89.75, 1: 62, 2: 89.75, 3: 62, 4: 89.75, 5: 62, 6: 89.75, 7: 62, 8: 89.75, 9: 62 });
  });

  it("makes nothing per step: the calls array and its entries are the chorus's own, reused", () => {
    const chorus = createFrogChorus(RING, SEED, () => 0.5);
    const calls = chorus.calls;
    const seen = new Map<number, object>();
    for (let k = 0; k <= 120 * 4; k++) {
      chorus.step(k / 4, 0.25, NOBODY, FAR, 1);
      expect(chorus.calls).toBe(calls);
      for (const c of chorus.calls) {
        if (!seen.has(c.voice)) seen.set(c.voice, c);
        expect(seen.get(c.voice)).toBe(c);
      }
    }
    expect(seen.size).toBe(10);
  });
});
