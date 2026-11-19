import { describe, expect, it } from "vitest";
import {
  CROWD_AHEAD_M, CROWD_APART_M, CROWD_BEHIND_M, CROWD_CLEAR_M, CROWD_FAR_BAND_M, CROWD_KEEP_M, CROWD_MOST, CROWD_NEAR_BAND_M, CROWD_NEAR_SHARE, CROWD_OFF_WAY_M,
  CROWD_CHASE_M, CROWD_CHASE_MPS, CROWD_EDGE_M, CROWD_FADE_S, CROWD_LUNGE_M, CROWD_LUNGE_MPS, CROWD_LUNGE_SHARE, CROWD_MIST_M, CROWD_PACK, CROWD_PRESS_M, CROWD_RISE_S, CROWD_RUSH, CROWD_RUSH_M,
  CROWD_TRIES_A_STEP, CROWD_VIEW_COS,
  crowdGives, crowdLunges, crowdSpeed, crowdTakes, crowdTarget, figureOf, newCrowd, placeCrowd, presenceOf, stepCrowd, type Crowd, type CrowdFigure, type CrowdWorld,
} from "../../src/game/crowdField.js";
import { SPRINT_SPEED, WALK_SPEED } from "../../src/sim/constants.js";
import { WAY_FLOOR_M, WAY_RIM_M } from "../../src/sim/wayDown.js";

/** A straight way along +x, 400 m long, and ground that admits everything but one square beside it. */
const LENGTH = 400;
const REFUSED = { x0: 20, x1: 30, z0: 10, z1: 20 };
export const straightWorld = (): CrowdWorld => ({
  length: LENGTH,
  project: (x, z) => { const s = Math.min(LENGTH, Math.max(0, x)); return { s, d: Math.hypot(x - s, z) }; },
  point: (s, out) => { out.x = s; out.z = 0; return out; },
  direction: (_s, out) => { out.x = 1; out.z = 0; return out; },
  admit: (x, z) => !(x >= REFUSED.x0 && x <= REFUSED.x1 && z >= REFUSED.z0 && z <= REFUSED.z1),
});
const figureAt = (id: number, x: number, z: number): CrowdFigure => ({ id, x, z, born: 0, gone: -1, rise: 0, ...figureOf(id, 1) });

describe("the crowd's numbers", () => {
  it("is the design's: sixty at the thickest on every tier, off the path from a metre into its mist, most of them near it, far down the way", () => {
    expect(CROWD_MOST).toEqual({ low: 60, medium: 60, high: 60 });
    expect([CROWD_CLEAR_M, CROWD_NEAR_BAND_M, CROWD_FAR_BAND_M, CROWD_NEAR_SHARE, CROWD_AHEAD_M, CROWD_BEHIND_M, CROWD_APART_M, CROWD_KEEP_M]).toEqual([1, 15, 35, 0.7, 85, 30, 5.5, 3]);
    expect(CROWD_EDGE_M).toBe(WAY_FLOOR_M + CROWD_CLEAR_M);
    expect(CROWD_OFF_WAY_M).toEqual([8, 15]);
  });

  it("wants fewer near the crest, the most through the middle, and fewer again as the road comes", () => {
    expect([crowdTarget(0, 60), crowdTarget(0.3, 60), crowdTarget(0.55, 60), crowdTarget(0.8, 60), crowdTarget(1, 60)]).toEqual([20, 60, 60, 60, 30]);
    expect(crowdTarget(0.15, 60)).toBeGreaterThan(20);
    expect(crowdTarget(0.15, 60)).toBeLessThan(60);
    expect(crowdTarget(0.5, 36)).toBe(36);
    expect(crowdTarget(0.5, 0)).toBe(0);
    expect(crowdTarget(-1, 60)).toBe(20);
    expect(crowdTarget(2, 60)).toBe(30);
  });

  it("gives each figure its size, eyes and pace from its own number: a fifth small, one in seven large, the rest a Hollow's size", () => {
    const looks = Array.from({ length: 1000 }, (_, id) => figureOf(id, 7));
    const sizes = looks.map((l) => l.size);
    expect(sizes.filter((s) => s <= 0.7).length / 1000).toBeCloseTo(0.2, 1);
    expect(sizes.filter((s) => s >= 1.4).length / 1000).toBeCloseTo(1 / 7, 1);
    expect(sizes.filter((s) => s > 0.7 && s < 0.8).length).toBe(0);
    expect(sizes.filter((s) => s > 1.25 && s < 1.4).length).toBe(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1.75);
    for (const l of looks) {
      expect(l.eyes).toBeGreaterThanOrEqual(0.35); expect(l.eyes).toBeLessThanOrEqual(1);
      expect(l.warm).toBeGreaterThanOrEqual(0); expect(l.warm).toBeLessThanOrEqual(1);
      expect(l.pace).toBeGreaterThanOrEqual(0.6); expect(l.pace).toBeLessThanOrEqual(1.4);
    }
    // The same figure for as long as it lives, and not its neighbour's.
    expect(figureOf(3, 7)).toEqual(figureOf(3, 7));
    expect(figureOf(3, 7)).not.toEqual(figureOf(4, 7));
    expect(figureOf(3, 7)).not.toEqual(figureOf(3, 8));
  });
});

describe("where a figure of the crowd may stand", () => {
  const eye = { x: 100, z: 0, yaw: Math.PI / 2 };

  it("beside the way ahead of the player: beyond the path's edge and its clear ground, most within 15 m of it, none past 35 m", () => {
    const world = straightWorld(), rng = { rngSeed: 11 };
    const places: { x: number; z: number }[] = [];
    for (let i = 0; i < 800; i++) { const p = placeCrowd(world, eye, [], rng, 0); if (p !== null) places.push(p); }
    expect(places.length).toBeGreaterThan(700);
    let near = 0, left = 0;
    for (const p of places) {
      const off = Math.abs(p.z) - WAY_FLOOR_M;
      expect(off).toBeGreaterThanOrEqual(CROWD_CLEAR_M - 1e-9);
      expect(off).toBeLessThanOrEqual(CROWD_FAR_BAND_M + 1e-9);
      // Never behind the player's own place on the way, never past 85 m down it.
      expect(p.x).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(100 + CROWD_AHEAD_M + 1e-9);
      if (off <= CROWD_NEAR_BAND_M) near++;
      if (p.z > 0) left++;
    }
    expect(near / places.length).toBeGreaterThan(0.64);
    expect(near / places.length).toBeLessThan(0.76);
    // Both sides, evenly.
    expect(left / places.length).toBeGreaterThan(0.42);
    expect(left / places.length).toBeLessThan(0.58);
  });

  it("never on ground that refuses it, and never within 5.5 m of another figure", () => {
    const world = straightWorld(), rng = { rngSeed: 5 };
    const figures: CrowdFigure[] = [];
    for (let i = 0; i < 4000; i++) {
      const p = placeCrowd(world, { x: 0, z: 0, yaw: Math.PI / 2 }, figures, rng, 0);
      if (p === null) continue;
      expect(world.admit(p.x, p.z)).toBe(true);
      for (const f of figures) expect(Math.hypot(f.x - p.x, f.z - p.z)).toBeGreaterThanOrEqual(CROWD_APART_M - 1e-9);
      figures.push(figureAt(figures.length, p.x, p.z));
    }
    // The ground beside 85 m of way holds well over sixty at that spacing, and the tries fill it.
    expect(figures.length).toBeGreaterThan(120);
    // Some stood round the refused square, none in it.
    expect(figures.some((f) => f.x > 10 && f.x < 40 && f.z > 0 && f.z < 30)).toBe(true);
  });

  it("round a player who has left the way: 8 to 15 m from them, wherever they look, and still clear of the channel", () => {
    const world = straightWorld(), rng = { rngSeed: 21 };
    const off = { x: 200, z: 40, yaw: 0 };
    let kept = 0;
    const bearings = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const p = placeCrowd(world, off, [], rng, 40 - WAY_RIM_M);
      if (p === null) continue;
      kept++;
      const d = Math.hypot(p.x - off.x, p.z - off.z);
      expect(d).toBeGreaterThanOrEqual(CROWD_OFF_WAY_M[0] - 1e-9);
      expect(d).toBeLessThanOrEqual(CROWD_OFF_WAY_M[1] + 1e-9);
      expect(world.project(p.x, p.z).d).toBeGreaterThanOrEqual(CROWD_EDGE_M - 1e-9);
      bearings.add(Math.floor(((Math.atan2(p.x - off.x, p.z - off.z) + Math.PI) / (2 * Math.PI)) * 8));
    }
    expect(kept).toBeGreaterThan(500);
    // All round them: every eighth of the compass.
    expect(bearings.size).toBe(8);
  });

  it("spends the same draws whatever the ground says, so the stream never depends on where trunks stand", () => {
    const open = straightWorld(), shut: CrowdWorld = { ...straightWorld(), admit: () => false };
    const a = { rngSeed: 99 }, b = { rngSeed: 99 };
    for (let i = 0; i < 50; i++) { placeCrowd(open, eye, [], a, 0); placeCrowd(shut, eye, [], b, 0); }
    expect(a.rngSeed).toBe(b.rngSeed);
    expect(placeCrowd(shut, eye, [], b, 0)).toBeNull();
  });
});

describe("the crowd, stepped", () => {
  const DT = 1 / 60;
  const living = (c: Crowd): CrowdFigure[] => c.figures.filter((f) => f.gone < 0);
  const inView = (eye: { x: number; z: number; yaw: number }, f: { x: number; z: number }): boolean => {
    const dx = f.x - eye.x, dz = f.z - eye.z, d = Math.hypot(dx, dz);
    return d > 0 && (dx * Math.sin(eye.yaw) + dz * Math.cos(eye.yaw)) / d >= CROWD_VIEW_COS;
  };

  it("names its numbers", () => {
    expect([CROWD_TRIES_A_STEP, CROWD_RISE_S, CROWD_FADE_S, CROWD_VIEW_COS, CROWD_MIST_M]).toEqual([4, 2.4, 2.6, 0.5, 30]);
  });

  it("fills to what the way wants within seconds and never passes it, and nothing is ever added in plain view inside the mist's reach", () => {
    const world = straightWorld(), crowd = newCrowd(3), eye = { x: 200, z: 0, yaw: Math.PI / 2 };
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      stepCrowd(crowd, world, eye, 60, i * DT, DT);
      expect(living(crowd).length).toBeLessThanOrEqual(60);
      for (const f of crowd.figures) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        const d = Math.hypot(f.x - eye.x, f.z - eye.z);
        expect(d >= CROWD_MIST_M || !inView(eye, f), `figure ${f.id} born ${d.toFixed(1)} m off in view`).toBe(true);
        // One born in view, far off, opens its eyes there. Any other comes out of the mist.
        expect(f.rise).toBe(inView(eye, f) ? 1 : 0);
      }
    }
    expect(living(crowd).length).toBe(crowdTarget(0.5, 60));
  });

  it("keeps a runner's woods full the whole way down: never many short of what the way wants, never over it", () => {
    const world = straightWorld(), crowd = newCrowd(8);
    let worstShort = 0, behindInChannel = false;
    for (let i = 0; i < 50 * 60; i++) {
      const eye = { x: 20 + 7 * i * DT, z: 0, yaw: Math.PI / 2 };
      stepCrowd(crowd, world, eye, 60, i * DT, DT);
      const want = crowdTarget(eye.x / 400, 60), have = living(crowd).length;
      expect(have).toBeLessThanOrEqual(want + 1);
      if (i * DT > 10) worstShort = Math.max(worstShort, want - have);
      for (const f of living(crowd)) {
        // Further down the way than a lunge begins, nothing stands on the path or within a metre of its edge.
        if (f.x > eye.x + CROWD_LUNGE_M) expect(Math.abs(f.z)).toBeGreaterThanOrEqual(CROWD_EDGE_M - 1e-6);
        else if (f.x <= eye.x && Math.abs(f.z) < WAY_FLOOR_M) behindInChannel = true;
      }
    }
    expect(worstShort).toBeLessThanOrEqual(8);
    // What the runner has passed follows, and steps into the channel behind them.
    expect(behindInChannel).toBe(true);
  });

  it("comes toward a player who stands still, and none of it reaches them: a figure 3 m off begins to go", () => {
    const world = straightWorld(), crowd = newCrowd(4), eye = { x: 200, z: 0, yaw: Math.PI / 2 };
    let nearest = Infinity, closed = false;
    const first = new Map<number, number>();
    for (let i = 0; i < 40 * 60; i++) {
      stepCrowd(crowd, world, eye, 60, i * DT, DT);
      for (const f of living(crowd)) {
        const d = Math.hypot(f.x - eye.x, f.z - eye.z);
        nearest = Math.min(nearest, d);
        if (!first.has(f.id)) first.set(f.id, d);
        else if (d < first.get(f.id)! - 5) closed = true;
      }
      if (i * DT > 10) expect(living(crowd).length).toBeGreaterThanOrEqual(crowdTarget(0.5, 60) - 8);
    }
    expect(closed).toBe(true);
    expect(nearest).toBeGreaterThan(CROWD_KEEP_M - 0.1);
  });

  it("is drawn in round a player who leaves the way, and is never more than the most", () => {
    const world = straightWorld(), crowd = newCrowd(6);
    for (let i = 0; i < 5 * 60; i++) stepCrowd(crowd, world, { x: 200, z: 0, yaw: Math.PI / 2 }, 60, i * DT, DT);
    const eye = { x: 200, z: 31, yaw: 0 };
    for (let i = 5 * 60; i < 20 * 60; i++) {
      stepCrowd(crowd, world, eye, 60, i * DT, DT);
      expect(living(crowd).length).toBeLessThanOrEqual(60);
    }
    const round = living(crowd);
    expect(round.length).toBeGreaterThanOrEqual(10);
    for (const f of round) expect(Math.hypot(f.x - eye.x, f.z - eye.z)).toBeLessThanOrEqual(26);
  });

  it("goes when there is no way to stand beside: every figure fades, and none is left", () => {
    const world = straightWorld(), crowd = newCrowd(2), eye = { x: 200, z: 0, yaw: Math.PI / 2 };
    for (let i = 0; i < 300; i++) stepCrowd(crowd, world, eye, 60, i * DT, DT);
    expect(crowd.figures.length).toBeGreaterThan(40);
    const from = 300 * DT;
    stepCrowd(crowd, null, eye, 60, from, DT);
    expect(living(crowd).length).toBe(0);
    expect(crowd.figures.length).toBeGreaterThan(0);
    stepCrowd(crowd, null, eye, 60, from + CROWD_FADE_S + 0.1, DT);
    expect(crowd.figures.length).toBe(0);
    // And with the most at nothing (the console's hold), the same.
    const held = newCrowd(2);
    for (let i = 0; i < 60; i++) stepCrowd(held, world, eye, 0, i * DT, DT);
    expect(held.figures.length).toBe(0);
  });

  it("a figure's presence comes in over its rise and goes out over its fade", () => {
    const f: CrowdFigure = { id: 1, x: 0, z: 0, born: 10, gone: -1, rise: 0, ...figureOf(1, 1) };
    expect(presenceOf(f, 10)).toBe(0);
    expect(presenceOf(f, 10 + CROWD_RISE_S / 2)).toBeCloseTo(0.5, 6);
    expect(presenceOf(f, 10 + CROWD_RISE_S + 5)).toBe(1);
    const going = { ...f, gone: 20 };
    expect(presenceOf(going, 20)).toBe(1);
    expect(presenceOf(going, 20 + CROWD_FADE_S / 2)).toBeCloseTo(0.5, 6);
    expect(presenceOf(going, 20 + CROWD_FADE_S)).toBe(0);
    // One that began to go before it had risen never jumps up.
    expect(presenceOf({ ...f, gone: 10.6 }, 10.6)).toBeCloseTo(0.25, 6);
  });

  it("is each screen's own: the same seed and the same steps give the same crowd, another seed another", () => {
    const run = (seed: number): CrowdFigure[] => {
      const world = straightWorld(), crowd = newCrowd(seed);
      for (let i = 0; i < 200; i++) stepCrowd(crowd, world, { x: 150 + i * 0.1, z: 0, yaw: Math.PI / 2 }, 60, i * DT, DT);
      return crowd.figures;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
});

describe("the crowd closing on its player", () => {
  const DT = 1 / 60;
  const living = (c: Crowd): CrowdFigure[] => c.figures.filter((f) => f.gone < 0);
  const crowdOf = (...figures: CrowdFigure[]): Crowd => ({ ...newCrowd(1), figures, nextId: 1000 });

  it("names its numbers", () => {
    expect([CROWD_RUSH, CROWD_RUSH_M, CROWD_CHASE_MPS, CROWD_PACK, CROWD_PRESS_M]).toEqual([3.6, 22, 9, 10, 3]);
  });

  it("runs in from far off and stalks the last metres: a figure's own pace where it would go, several times it past 22 m, never slower for being further", () => {
    for (const pace of [0.6, 1, 1.4]) {
      expect(crowdSpeed(pace, CROWD_KEEP_M, false)).toBe(pace);
      expect(crowdSpeed(pace, 2, false)).toBe(pace);
      expect(crowdSpeed(pace, CROWD_RUSH_M, false)).toBeCloseTo(pace * CROWD_RUSH, 9);
      expect(crowdSpeed(pace, 90, false)).toBeCloseTo(pace * CROWD_RUSH, 9);
      for (let d = 0; d < 60; d += 0.5) {
        expect(crowdSpeed(pace, d + 0.5, false)).toBeGreaterThanOrEqual(crowdSpeed(pace, d, false));
        expect(crowdSpeed(pace, d + 0.5, true)).toBeGreaterThanOrEqual(crowdSpeed(pace, d, true));
      }
    }
  });

  it("gives chase faster than a player sprints, and holds off a runner's heels: what follows keeps its distance from one who runs and closes on one who stops", () => {
    expect(CROWD_CHASE_MPS).toBeGreaterThan(SPRINT_SPEED + 1);
    for (const pace of [0.6, 1.4]) {
      expect(crowdSpeed(pace, CROWD_CHASE_M, true)).toBe(CROWD_CHASE_MPS);
      for (const run of [WALK_SPEED, SPRINT_SPEED]) {
        // The distance a chaser keeps behind a player moving at `run`: where its speed is theirs.
        let held = CROWD_KEEP_M;
        while (crowdSpeed(pace, held, true) < run) held += 0.1;
        expect(held).toBeGreaterThan(CROWD_KEEP_M + 3);
        expect(held).toBeLessThan(CROWD_CHASE_M);
      }
    }
  });

  it("a figure deep in the woods ahead closes on a player at several metres a second", () => {
    const world = straightWorld(), eye = { x: 200, z: 0, yaw: Math.PI / 2 };
    const f = figureAt(1, 260, 30), crowd = crowdOf(f);
    const from = Math.hypot(f.x - eye.x, f.z - eye.z);
    for (let i = 0; i < 3 * 60; i++) stepCrowd(crowd, world, eye, 1, i * DT, DT);
    const closed = from - Math.hypot(f.x - eye.x, f.z - eye.z);
    expect(closed).toBeGreaterThan(f.pace * CROWD_RUSH * 3 * 0.95);
    expect(closed).toBeGreaterThan(6);
  });

  it("one behind a sprinting player gives chase and keeps up, and never reaches them", () => {
    const world = straightWorld(), f = figureAt(1, 75, 1), crowd = crowdOf(f);
    let nearest = Infinity;
    for (let i = 0; i < 12 * 60; i++) {
      const eye = { x: 100 + SPRINT_SPEED * i * DT, z: 0, yaw: Math.PI / 2 };
      stepCrowd(crowd, world, eye, 1, i * DT, DT);
      if (f.gone < 0) nearest = Math.min(nearest, Math.hypot(f.x - eye.x, f.z - eye.z));
    }
    const eyeX = 100 + SPRINT_SPEED * 12;
    expect(crowd.figures).toContain(f);
    expect(f.gone).toBe(-1);
    expect(eyeX - f.x).toBeLessThan(CROWD_CHASE_M);
    expect(nearest).toBeGreaterThan(CROWD_KEEP_M + 3);
  });

  it("keeps a pack at a sprinter's back and the rest of the crowd ahead of them: ten behind at the most", () => {
    const world = straightWorld(), crowd = newCrowd(8);
    let leastAhead = Infinity, mostBehind = 0, packSeen = 0;
    for (let i = 0; i < 40 * 60; i++) {
      const eye = { x: 20 + SPRINT_SPEED * i * DT, z: 0, yaw: Math.PI / 2 };
      stepCrowd(crowd, world, eye, 60, i * DT, DT);
      if (i * DT < 10) continue;
      const all = living(crowd), behind = all.filter((f) => f.x < eye.x).length;
      mostBehind = Math.max(mostBehind, behind);
      packSeen = Math.max(packSeen, behind);
      leastAhead = Math.min(leastAhead, all.length - behind - (crowdTarget(eye.x / 400, 60) - CROWD_PACK));
    }
    expect(mostBehind).toBeLessThanOrEqual(CROWD_PACK + 1);
    expect(packSeen).toBeGreaterThanOrEqual(CROWD_PACK - 2);
    // Ahead of the runner: all the way wants but the pack, give or take the few being placed.
    expect(leastAhead).toBeGreaterThanOrEqual(-10);
  });

  it("does not walk through one in front of it: the one behind waits at half the press's reach at the nearest", () => {
    const world = straightWorld(), eye = { x: 200, z: 20, yaw: 0 };
    // Both on the player's own line, off the way: the slow one in front, the fast one 4 m behind it.
    const front = { ...figureAt(1, 200, 38), pace: 0.6 }, back = { ...figureAt(2, 200, 42), pace: 1.4 };
    const crowd = crowdOf(front, back);
    let least = Infinity;
    for (let i = 0; i < 8 * 60 && front.gone < 0; i++) {
      stepCrowd(crowd, world, eye, 2, i * DT, DT);
      least = Math.min(least, Math.hypot(front.x - back.x, front.z - back.z));
    }
    expect(least).toBeGreaterThanOrEqual(CROWD_PRESS_M / 2 - 0.01);
    expect(back.z).toBeLessThan(40);
  });

  it("a pack that follows spreads out behind its player: no two of it in one place", () => {
    const world = straightWorld();
    const pack = Array.from({ length: 8 }, (_, k) => figureAt(k + 1, 96 - 3.5 * k, k % 2 === 0 ? 1.5 : -1.5));
    const crowd = crowdOf(...pack);
    let eye = { x: 100, z: 0, yaw: Math.PI / 2 };
    for (let i = 0; i < 15 * 60; i++) {
      eye = { x: 100 + SPRINT_SPEED * i * DT, z: 0, yaw: Math.PI / 2 };
      stepCrowd(crowd, world, eye, 8, i * DT, DT);
    }
    const left = pack.filter((f) => f.gone < 0 && crowd.figures.includes(f));
    expect(left.length).toBeGreaterThanOrEqual(6);
    for (const f of left) expect(eye.x - f.x).toBeLessThan(CROWD_BEHIND_M);
    for (const a of left) for (const b of left) if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(CROWD_PRESS_M / 2);
  });
});

describe("the crowd lunging at a runner", () => {
  const DT = 1 / 60;
  const crowdOf = (...figures: CrowdFigure[]): Crowd => ({ ...newCrowd(1), figures, nextId: 1000 });
  /** The first figure's number from `from` that lunges, or does not, under the seed figureAt gives a figure's look from. */
  const numberThat = (lunges: boolean, from = 1): number => { let id = from; while (crowdLunges(id, 1) !== lunges) id++; return id; };

  it("names its numbers", () => {
    expect([CROWD_LUNGE_M, CROWD_LUNGE_MPS, CROWD_LUNGE_SHARE, CROWD_CHASE_M]).toEqual([12, 8, 2 / 3, 12]);
    expect(CROWD_LUNGE_MPS).toBeGreaterThan(SPRINT_SPEED);
  });

  it("two figures in three are lungers, each from its own number, the same for as long as it lives", () => {
    let lungers = 0;
    for (let id = 0; id < 3000; id++) if (crowdLunges(id, 7)) lungers++;
    expect(lungers / 3000).toBeGreaterThan(0.63);
    expect(lungers / 3000).toBeLessThan(0.7);
    expect(crowdLunges(5, 7)).toBe(crowdLunges(5, 7));
  });

  it("a lunger at the path's edge waits there for a runner, and comes onto the path at them once they are within 12 m of it down the way", () => {
    const world = straightWorld(), f = { ...figureAt(numberThat(true), 160, 8), pace: 1 }, crowd = crowdOf(f);
    let waitedOff = true, least = Infinity, fastest = 0;
    for (let i = 0; i < 9 * 60; i++) {
      const eye = { x: 100 + SPRINT_SPEED * i * DT, z: 0, yaw: Math.PI / 2 };
      const was = { x: f.x, z: f.z };
      stepCrowd(crowd, world, eye, 1, i * DT, DT);
      if (f.x > eye.x + CROWD_LUNGE_M + 1 && Math.abs(f.z) < CROWD_EDGE_M - 1e-6) waitedOff = false;
      if (f.x > eye.x) least = Math.min(least, Math.abs(f.z));
      fastest = Math.max(fastest, Math.hypot(f.x - was.x, f.z - was.z) / DT);
    }
    expect(waitedOff).toBe(true);
    // On the path while still ahead of the runner, and at a lunge's speed.
    expect(least).toBeLessThan(WAY_FLOOR_M - 2);
    expect(fastest).toBeCloseTo(CROWD_LUNGE_MPS, 1);
  });

  it("one that is no lunger keeps off the path until the runner has passed it", () => {
    const world = straightWorld(), f = { ...figureAt(numberThat(false), 160, 8), pace: 1 }, crowd = crowdOf(f);
    for (let i = 0; i < 9 * 60; i++) {
      const eye = { x: 100 + SPRINT_SPEED * i * DT, z: 0, yaw: Math.PI / 2 };
      stepCrowd(crowd, world, eye, 1, i * DT, DT);
      if (f.x > eye.x) expect(Math.abs(f.z)).toBeGreaterThanOrEqual(CROWD_EDGE_M - 1e-6);
    }
  });

  it("a lunge never reaches the runner: the nearest it comes is where a figure goes", () => {
    const world = straightWorld(), crowd = newCrowd(12);
    let nearest = Infinity;
    for (let i = 0; i < 40 * 60; i++) {
      const eye = { x: 20 + SPRINT_SPEED * i * DT, z: 0, yaw: Math.PI / 2 };
      stepCrowd(crowd, world, eye, 60, i * DT, DT);
      for (const g of crowd.figures) if (g.gone < 0) nearest = Math.min(nearest, Math.hypot(g.x - eye.x, g.z - eye.z));
    }
    expect(nearest).toBeGreaterThan(CROWD_KEEP_M - 0.1);
    expect(nearest).toBeLessThan(CROWD_KEEP_M + 3);
  });
});

describe("the crowd and what kills", () => {
  const crowdOf = (...figures: CrowdFigure[]): Crowd => ({ ...newCrowd(1), figures, nextId: 1000 });

  it("gives the nearest of its figures to a killer the host has raised within 12 m of it: that one begins to go, and no other", () => {
    const near = figureAt(1, 105, 20), nearer = figureAt(2, 100, 24), far = figureAt(3, 100, 34), going = { ...figureAt(4, 100, 21), gone: 3 };
    const crowd = crowdOf(near, nearer, far, going);
    expect(crowdGives(crowd, { x: 100, z: 20 }, 9)).toBe(2);
    expect(nearer.gone).toBe(9);
    expect([near.gone, far.gone, going.gone]).toEqual([-1, -1, 3]);
    // The next killer there takes the next nearest. One past 12 m of every figure takes none, and rises as it always did.
    expect(crowdGives(crowd, { x: 100, z: 20 }, 10)).toBe(1);
    expect(crowdGives(crowd, { x: 100, z: 20 }, 11)).toBeNull();
    expect(far.gone).toBe(-1);
    expect(crowdGives(crowd, { x: 100, z: 20 }, 12, 15)).toBe(3);
  });

  it("takes back a killer that has stopped hunting: a figure of the crowd is born where it stood, with a look of its own", () => {
    const world = straightWorld(), crowd = crowdOf(figureAt(1, 100, 20));
    crowdTakes(crowd, { x: 140, z: -18 }, 7, world);
    expect(crowd.figures.length).toBe(2);
    const born = crowd.figures[1] as CrowdFigure;
    expect(born).toEqual({ id: 1000, x: 140, z: -18, born: 7, gone: -1, rise: 0, ...figureOf(1000, crowd.seed) });
    expect(crowd.nextId).toBe(1001);
  });

  it("leaves nothing where a figure of the crowd may not stand: in the channel, on its clear ground, or on ground that refuses it", () => {
    const world = straightWorld(), crowd = crowdOf();
    crowdTakes(crowd, { x: 140, z: 2 }, 7, world);
    crowdTakes(crowd, { x: 140, z: CROWD_EDGE_M - 0.5 }, 7, world);
    crowdTakes(crowd, { x: 25, z: 15 }, 7, world);
    expect(crowd.figures.length).toBe(0);
    expect(crowd.nextId).toBe(1000);
  });
});
