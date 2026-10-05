import { describe, expect, it } from "vitest";
import type { LakeSource } from "../../src/sim/terrain.js";
import { WEATHER_PRESETS, type WeatherParams } from "../../src/game/weather.js";
import { waterLifePresenceUnder, type DragonflyShare, type WaterLifePresence } from "../../src/game/waterLifeParams.js";
import type { DarnerBeat, Perch, WaterLifeLayout } from "../../src/game/waterLifeField.js";
import {
  createDragonflyBehaviour, KIND_DAMSELFLY, KIND_DARNER, KIND_SKIMMER, type Dragonflies,
} from "../../src/game/dragonflyBehaviour.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 388817;
/** One frame at 60 Hz. */
const DT = 1 / 60;
/** A lake 30 m across its rim's radius at the origin, its water at 10 m. */
const LAKE: LakeSource = { kind: "lake", level: 10, x: 0, z: 0, radius: 30, murk: 0.2, lobe: null };
/** The camera over the lake's middle: within range of everything on its shore, 28 m from every beat. */
const MIDDLE = { x: 0, y: 11, z: 0 };
/** The angle a 20 m beat spans on the circle 2 m in from the rim. */
const SPAN = 20 / 28;

/** The point `r` from the lake's centre, `a` radians round from +x toward +z, at height `y`. */
function at(a: number, r: number, y: number): { x: number; y: number; z: number } {
  return { x: r * Math.cos(a), y, z: r * Math.sin(a) };
}

/** A beat of five points 2 m in from the rim and 1 m over the water, from angle `a0` across `span`, with
 * hover points a quarter and three quarters along it facing out to the shore: the shape
 * `waterLifeLayout` gives a beat, built by hand. */
function beat(a0: number, span = SPAN): DarnerBeat {
  const points = [];
  for (let i = 0; i <= 4; i++) points.push(at(a0 + (span * i) / 4, 28, 11));
  const hovers = [0.25, 0.75].map((f) => {
    const a = a0 + span * f;
    return { ...at(a, 28, 11), faceX: Math.cos(a), faceZ: Math.sin(a) };
  });
  return { points, hovers, seed: 1 };
}

/** A perch or stem at angle `a`, `r` from the centre, `y` up. */
function perch(a: number, r: number, y: number, seed = 1): Perch {
  return { ...at(a, r, y), seed };
}

/** A bed of twelve stems in a 4 × 3 grid at the water's edge, 2 m apart, each a little higher than the last
 * (but the fifth, the tenth). */
function bed(): Perch[] {
  return Array.from({ length: 12 }, (_, i) => ({ x: 30 + 2 * (i % 4), y: 10.4 + 0.05 * (i % 5), z: 2 * Math.floor(i / 4) - 2, seed: i }));
}

function layout(parts: Partial<WaterLifeLayout>): WaterLifeLayout {
  return { lake: LAKE, markers: [], beats: [], perches: [], stems: [], voices: [], ...parts };
}

/** Nine beats meeting end to end round the lake; sixteen perches on the shore; twenty stems, one per
 * 4 m², in a bed 10 m by 8 m. */
function crowd(): WaterLifeLayout {
  const beats = Array.from({ length: 9 }, (_, i) => beat((i * 2 * Math.PI) / 9, (2 * Math.PI) / 9));
  const perches = Array.from({ length: 16 }, (_, i) => perch((i * 2 * Math.PI) / 16, 31, 10.8, i));
  const stems: Perch[] = [];
  const bed = at(1, 30.5, 10.4);
  for (let i = 0; i < 20; i++) stems.push({ x: bed.x + 2 * (i % 5) - 4, y: 10.4, z: bed.z + 2 * Math.floor(i / 5) - 3, seed: i });
  return layout({ beats, perches, stems });
}

function presence(darner: DragonflyShare, skimmer: DragonflyShare, damselfly: DragonflyShare): WaterLifePresence {
  return { midge: 0, midgeFullness: 1, darner, skimmer, damselfly, frog: 0 };
}
/** Every kind seen and flying. */
const ABOUT = presence({ seen: 1, flying: 1 }, { seen: 1, flying: 1 }, { seen: 1, flying: 1 });
/** Every kind seen, none flying: a gale. */
const GROUNDED = presence({ seen: 1, flying: 0 }, { seen: 1, flying: 0 }, { seen: 1, flying: 0 });

/** Distance from (x, y, z) to the beat's polyline. */
function toBeat(b: DarnerBeat, x: number, y: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < b.points.length; i++) {
    const p = b.points[i]!, q = b.points[i + 1]!;
    const hx = q.x - p.x, hy = q.y - p.y, hz = q.z - p.z;
    const f = Math.min(1, Math.max(0, ((x - p.x) * hx + (y - p.y) * hy + (z - p.z) * hz) / (hx * hx + hy * hy + hz * hz)));
    best = Math.min(best, Math.hypot(p.x + hx * f - x, p.y + hy * f - y, p.z + hz * f - z));
  }
  return best;
}

/** Steps `d` `frames` times at 60 Hz from `tick`, calling `each` after every step; returns the next tick. */
function run(
  d: Dragonflies, tick: number, frames: number, cam: { x: number; y: number; z: number },
  players: readonly { x: number; y: number; z: number }[], p: WaterLifePresence, each?: () => void,
): number {
  for (let i = 0; i < frames; i++) {
    d.step(tick + i, DT, cam.x, cam.y, cam.z, players, p);
    each?.();
  }
  return tick + frames;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

describe("the darners", () => {
  it("keeps a darner on its beat for ten minutes, turning no faster than 300°/s, flying no faster than 2 m/s", () => {
    const b = beat(0);
    const d = createDragonflyBehaviour(layout({ beats: [b] }), SEED);
    const start = b.points[0]!, end = b.points[4]!;
    let off = 0, turn = 0, speed = 0, toStart = Infinity, toEnd = Infinity, frames = 0, facing = 0;
    let lx = NaN, lz = NaN, lyaw = NaN;
    run(d, 0, 36_000, MIDDLE, [], ABOUT, () => {
      if (d.count[KIND_DARNER] === 1) frames++;
      const p = d.poses[KIND_DARNER][0]!;
      for (const h of b.hovers) {
        if (p.x === h.x && p.y === h.y && p.z === h.z && Math.abs(wrapAngle(p.yaw - Math.atan2(h.faceX, h.faceZ))) < 1e-9) facing++;
      }
      off = Math.max(off, toBeat(b, p.x, p.y, p.z));
      toStart = Math.min(toStart, Math.hypot(p.x - start.x, p.z - start.z));
      toEnd = Math.min(toEnd, Math.hypot(p.x - end.x, p.z - end.z));
      if (!Number.isNaN(lx)) {
        turn = Math.max(turn, Math.abs(wrapAngle(p.yaw - lyaw)) / DT);
        speed = Math.max(speed, Math.hypot(p.x - lx, p.z - lz) / DT);
      }
      lx = p.x; lz = p.z; lyaw = p.yaw;
    });
    expect(frames).toBe(36_000);
    // Frames held at a hover point facing the shore: 259 s of the 600.
    expect(facing).toBe(15_562);
    // Its U-turns at the ends carry it a little past the line, and no further.
    expect(off).toBeLessThan(0.8);
    // It patrols the whole beat, end to end.
    expect(toStart).toBeLessThan(0.6);
    expect(toEnd).toBeLessThan(0.6);
    expect(turn).toBeLessThanOrEqual(5.2359878);
    expect(speed).toBeLessThanOrEqual(2.0000001);
  }, timeLimit(20_000));

  it("bends a darner's beat around a player standing on it, and carries it on past them", () => {
    const b = beat(0);
    const d = createDragonflyBehaviour(layout({ beats: [b] }), SEED);
    const mid = b.points[2]!;
    const player = { x: mid.x, y: 10, z: mid.z };
    const start = b.points[0]!, end = b.points[4]!;
    let nearest = Infinity, toStart = Infinity, toEnd = Infinity;
    run(d, 0, 7_200, MIDDLE, [player], ABOUT, () => {
      const p = d.poses[KIND_DARNER][0]!;
      nearest = Math.min(nearest, Math.hypot(p.x - player.x, p.z - player.z));
      toStart = Math.min(toStart, Math.hypot(p.x - start.x, p.z - start.z));
      toEnd = Math.min(toEnd, Math.hypot(p.x - end.x, p.z - end.z));
    });
    expect(nearest).toBeGreaterThan(1.6);
    expect(toStart).toBeLessThan(0.6);
    expect(toEnd).toBeLessThan(0.6);
  });

  it("sets darners on neighbouring beats chasing where their beats meet, at 3.6 m/s, and sends both home", () => {
    // Two beats meeting end to end: they meet at the end they share.
    const a = beat(0), b = beat(SPAN);
    const meet = b.points[0]!;
    const d = createDragonflyBehaviour(layout({ beats: [a, b] }), SEED);
    const loud: { x: number; y: number; z: number }[] = [];
    let quiet = 0, speed = 0, offA = 0, offB = 0;
    let ax = NaN, az = NaN;
    run(d, 0, 72_000, MIDDLE, [], ABOUT, () => {
      for (const e of d.rustles) {
        if (e.loud) loud.push({ x: e.x, y: e.y, z: e.z });
        else quiet++;
      }
      const pa = d.poses[KIND_DARNER][0]!, pb = d.poses[KIND_DARNER][1]!;
      if (!Number.isNaN(ax)) speed = Math.max(speed, Math.hypot(pa.x - ax, pa.z - az) / DT);
      ax = pa.x; az = pa.z;
      offA = Math.max(offA, toBeat(a, pa.x, pa.y, pa.z));
      offB = Math.max(offB, toBeat(b, pb.x, pb.y, pb.z));
    });
    // A clatter at each chase's start, at the meeting point; the camera is too far for a pass.
    expect(loud.length).toBe(5);
    for (const e of loud) expect([e.x, e.y, e.z]).toEqual([meet.x, meet.y, meet.z]);
    expect(quiet).toBe(0);
    expect(speed).toBeCloseTo(3.6, 9);
    // The chase stays about the meeting point, and each darner flies back to its own beat.
    expect(offA).toBeLessThan(3);
    expect(offB).toBeLessThan(3);
  }, timeLimit(20_000));

  it("rustles once a pass as a darner flies within 2 m of the camera", () => {
    const b = beat(0);
    const d = createDragonflyBehaviour(layout({ beats: [b] }), SEED);
    // Beside the beat's middle, 1 m toward the shore, at its height.
    const cam = at(SPAN / 2, 29, 11);
    const events: { x: number; y: number; z: number; loud: boolean }[] = [];
    let passes = 0, inside = false;
    run(d, 0, 7_200, cam, [], ABOUT, () => {
      for (const e of d.rustles) events.push({ x: e.x, y: e.y, z: e.z, loud: e.loud });
      const p = d.poses[KIND_DARNER][0]!;
      const r = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      if (!inside && r <= 2) { inside = true; passes++; }
      else if (inside && r > 2.5) inside = false;
    });
    expect(passes).toBe(6);
    expect(events.length).toBe(6);
    for (const e of events) {
      expect(e.loud).toBe(false);
      expect(Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z)).toBeLessThanOrEqual(2);
    }
  });
});

describe("the skimmers and the damselflies", () => {
  it("sends a skimmer out over the water and back to the same perch, no faster than 3 m/s", () => {
    const home = perch(0, 31, 10.8);
    const d = createDragonflyBehaviour(layout({ perches: [home] }), SEED);
    let sallies = 0, wasPerched = true, away = 0, speed = 0, wrong = 0, lowest = Infinity, shoreward = 0;
    let lx = NaN, ly = NaN, lz = NaN;
    run(d, 0, 36_000, MIDDLE, [], ABOUT, () => {
      const p = d.poses[KIND_SKIMMER][0]!;
      if (p.perched && (p.x !== home.x || p.y !== home.y || p.z !== home.z)) wrong++;
      if (wasPerched && !p.perched) sallies++;
      wasPerched = p.perched;
      away = Math.max(away, Math.hypot(p.x - home.x, p.z - home.z));
      lowest = Math.min(lowest, p.y);
      shoreward = Math.max(shoreward, Math.hypot(p.x, p.z));
      if (!Number.isNaN(lx)) speed = Math.max(speed, Math.hypot(p.x - lx, p.y - ly, p.z - lz) / DT);
      lx = p.x; ly = p.y; lz = p.z;
    });
    expect(sallies).toBe(60);
    expect(wrong).toBe(0);
    expect(away).toBeLessThanOrEqual(5.0000001);
    expect(lowest).toBe(10.8);
    expect(speed).toBeLessThanOrEqual(3.0000001);
    // Out over the water: a sally heads toward the lake's middle, never up the shore behind the perch.
    expect(shoreward).toBeLessThan(31.5);
  }, timeLimit(20_000));

  it("hops a damselfly from stem to stem of its bed, low, no faster than 1 m/s, and never rests off a stem", () => {
    const stems = bed();
    const d = createDragonflyBehaviour(layout({ stems }), SEED);
    // A damselfly's bed is the stems within 3 m of its own.
    const beds = stems.map((s) => stems.filter((t) => Math.hypot(t.x - s.x, t.z - s.z) <= 3));
    const was = stems.map(() => true);
    const from = stems.map((s) => ({ x: s.x, z: s.z }));
    const last = stems.map((s) => ({ x: s.x, y: s.y, z: s.z }));
    let hops = 0, off = 0, away = 0, lowest = Infinity, highest = -Infinity, longest = 0, shortest = Infinity, speed = 0;
    run(d, 0, 36_000, MIDDLE, [], ABOUT, () => {
      expect(d.count[KIND_DAMSELFLY]).toBe(12);
      for (let j = 0; j < 12; j++) {
        const p = d.poses[KIND_DAMSELFLY][j]!;
        if (p.id !== 2 * 4096 + j) throw new Error(`pose ${j} is unit ${p.id}`);
        if (was[j] && !p.perched) hops++;
        if (p.perched) {
          if (!beds[j]!.some((t) => t.x === p.x && t.y === p.y && t.z === p.z)) off++;
          if (!was[j]) {
            const hop = Math.hypot(p.x - from[j]!.x, p.z - from[j]!.z);
            longest = Math.max(longest, hop);
            shortest = Math.min(shortest, hop);
          }
          from[j] = { x: p.x, z: p.z };
        }
        was[j] = p.perched;
        away = Math.max(away, Math.hypot(p.x - stems[j]!.x, p.z - stems[j]!.z));
        lowest = Math.min(lowest, p.y);
        highest = Math.max(highest, p.y);
        speed = Math.max(speed, Math.hypot(p.x - last[j]!.x, p.y - last[j]!.y, p.z - last[j]!.z) / DT);
        last[j] = { x: p.x, y: p.y, z: p.z };
      }
    });
    expect(hops).toBe(677);
    expect(off).toBe(0);
    expect(away).toBeLessThanOrEqual(3.0000001);
    // Low among the stems: never under the lowest, never over the highest and a hop's lift of 0.15 m.
    expect(lowest).toBe(10.4);
    expect(highest).toBeLessThanOrEqual(10.7500001);
    expect(longest).toBeLessThanOrEqual(3.0000001);
    expect(shortest).toBeGreaterThanOrEqual(0.3);
    expect(speed).toBeLessThanOrEqual(1.0000001);
  }, timeLimit(20_000));

  it("keeps a damselfly on a stem with no other in its bed, left alone or flushed", () => {
    const stem = perch(0.3, 30.5, 10.4);
    // A second stem 3.5 m off: out of the first's bed.
    const d = createDragonflyBehaviour(layout({ stems: [stem, { ...stem, x: stem.x + 3.5 }] }), SEED);
    let off = 0;
    const where = (): void => {
      const p = d.poses[KIND_DAMSELFLY][0]!;
      if (!p.perched || p.x !== stem.x || p.y !== stem.y || p.z !== stem.z) off++;
    };
    const tick = run(d, 0, 36_000, MIDDLE, [], ABOUT, where);
    run(d, tick, 600, MIDDLE, [{ x: stem.x - 1, y: 10, z: stem.z }], ABOUT, where);
    expect(off).toBe(0);
  }, timeLimit(20_000));

  it("hops a flushed damselfly to the stem of its bed farthest from the player, and sits tight where none is farther", () => {
    const a = perch(0.3, 30.5, 10.4), b = { ...a, x: a.x - 2, y: 10.5 };
    const d = createDragonflyBehaviour(layout({ stems: [a, b] }), SEED);
    const mine = d.poses[KIND_DAMSELFLY][0]!, theirs = d.poses[KIND_DAMSELFLY][1]!;
    // A gale: nothing leaves a stem on its own.
    d.step(0, DT, MIDDLE.x, MIDDLE.y, MIDDLE.z, [], GROUNDED);
    // A player 1.9 m beyond the first stem: it hops to the second, 3.9 m from them.
    const tick = run(d, 1, 600, MIDDLE, [{ x: a.x + 1.9, y: 10, z: a.z }], GROUNDED);
    expect([mine.perched, mine.x, mine.y, mine.z]).toEqual([true, b.x, b.y, b.z]);
    // A player 0.5 m from the second stem, toward the first: both damselflies on the second hop to the first,
    // which is the farther from the player, and there, 1.5 m from them, sit tight, the second being nearer.
    run(d, tick, 600, MIDDLE, [{ x: b.x + 0.5, y: 10, z: b.z }], GROUNDED);
    for (const p of [mine, theirs]) expect([p.perched, p.x, p.y, p.z]).toEqual([true, a.x, a.y, a.z]);
  });

  it("flushes a skimmer or a damselfly perched within 2 m of a player, and none at 2.1 m", () => {
    // A damselfly's stem has another in its bed, 2 m farther from the player, to hop to.
    const stem = perch(0.3, 30.5, 10.4);
    const parts: [number, Partial<WaterLifeLayout>][] = [
      [KIND_SKIMMER, { perches: [perch(0, 31, 10.8, 0), perch(8 / 31, 31, 10.8, 1)] }],
      [KIND_DAMSELFLY, { stems: [stem, { ...stem, x: stem.x - 2 }] }],
    ];
    for (const [kind, part] of parts) {
      const d = createDragonflyBehaviour(layout(part), SEED);
      // A gale: nothing leaves a perch on its own, so only a player can flush it.
      d.step(0, DT, MIDDLE.x, MIDDLE.y, MIDDLE.z, [], GROUNDED);
      const pose = d.poses[kind]![0]!;
      expect(pose.perched, `kind ${kind}`).toBe(true);
      const x = pose.x, z = pose.z;
      const tick = run(d, 1, 600, MIDDLE, [{ x: x + 2.1, y: 10, z }], GROUNDED);
      expect([pose.perched, pose.x, pose.z], `kind ${kind}`).toEqual([true, x, z]);
      d.step(tick, DT, MIDDLE.x, MIDDLE.y, MIDDLE.z, [{ x: x + 1.9, y: 10, z }], GROUNDED);
      expect(pose.perched, `kind ${kind}`).toBe(false);
    }
  });

  it("sends a flushed skimmer to the nearest clear perch, and home once the player has gone", () => {
    const home = perch(0, 31, 10.8, 0), next = perch(8 / 31, 31, 10.8, 1), far = perch(-20 / 31, 31, 10.8, 2);
    const d = createDragonflyBehaviour(layout({ perches: [home, next, far] }), SEED);
    d.step(0, DT, MIDDLE.x, MIDDLE.y, MIDDLE.z, [], GROUNDED);
    const pose = d.poses[KIND_SKIMMER][0]!;
    const tick = run(d, 1, 600, MIDDLE, [{ x: home.x + 1.9, y: 10, z: home.z }], GROUNDED);
    expect([pose.perched, pose.x, pose.y, pose.z]).toEqual([true, next.x, next.y, next.z]);
    let frames = 0, back = -1;
    run(d, tick, 1_800, MIDDLE, [], ABOUT, () => {
      frames++;
      if (back < 0 && pose.perched && pose.x === home.x && pose.z === home.z) back = frames;
    });
    expect(back).toBe(164);
  });
});

describe("presence", () => {
  /** Runs the crowd for ten seconds under `w` at noon in a light breeze and returns it. */
  const under = (w: WeatherParams, cam = MIDDLE): Dragonflies => {
    const d = createDragonflyBehaviour(crowd(), SEED);
    run(d, 0, 600, cam, [], waterLifePresenceUnder(w, 12, 0.25));
    return d;
  };

  it("keeps the skimmers seen but perched under full cloud, the darners and damselflies in cover", () => {
    const l = crowd();
    const d = under({ ...WEATHER_PRESETS.clear, cloudCover: 1 });
    expect(d.count).toEqual([0, 16, 0]);
    for (let i = 0; i < 16; i++) {
      const p = d.poses[KIND_SKIMMER][i]!;
      const home = l.perches[i]!;
      expect([p.perched, p.x, p.y, p.z]).toEqual([true, home.x, home.y, home.z]);
    }
  });

  it("thins the darners and the damselflies as the cloud thickens, by the same units every time", () => {
    // Cloud 0.6 leaves a quarter of the sun: 1 − smoothstep(0.4, 0.7, 0.6) = 0.259.
    const d = under({ ...WEATHER_PRESETS.clear, cloudCover: 0.6 });
    expect(d.count).toEqual([2, 16, 6]);
    const again = under({ ...WEATHER_PRESETS.clear, cloudCover: 0.6 });
    for (const k of [KIND_DARNER, KIND_SKIMMER, KIND_DAMSELFLY]) {
      expect(again.poses[k]!.slice(0, again.count[k]).map((p) => p.id)).toEqual(d.poses[k]!.slice(0, d.count[k]).map((p) => p.id));
    }
  });

  it("shows only darners aloft, none sitting or roosting, at cloud 0.55 and at dread 0.4", () => {
    // Thirty-six beats, so that a share of a half is a crowd of them.
    const l = layout({ beats: Array.from({ length: 36 }, (_, i) => beat((i * 2 * Math.PI) / 36, (2 * Math.PI) / 36)) });
    const weathers: WeatherParams[] = [{ ...WEATHER_PRESETS.clear, cloudCover: 0.55 }, { ...WEATHER_PRESETS.clear, dread: 0.4 }];
    const counts: number[] = [];
    for (const w of weathers) {
      const d = createDragonflyBehaviour(l, SEED);
      let perched = 0;
      run(d, 0, 3_600, MIDDLE, [], waterLifePresenceUnder(w, 12, 0.25), () => {
        for (let j = 0; j < d.count[KIND_DARNER]; j++) if (d.poses[KIND_DARNER][j]!.perched) perched++;
      });
      counts.push(d.count[KIND_DARNER]);
      expect(perched).toBe(0);
    }
    expect(counts).toEqual([21, 21]);
  });

  it("puts every darner in cover in a gale, the skimmers perched on their perches and the damselflies on their stems", () => {
    const l = crowd();
    const d = createDragonflyBehaviour(l, SEED);
    let darners = 0, wrong = 0;
    run(d, 0, 3_600, MIDDLE, [], waterLifePresenceUnder(WEATHER_PRESETS.clear, 12, 1), () => {
      darners += d.count[KIND_DARNER];
      for (let j = 0; j < d.count[KIND_SKIMMER]; j++) {
        const q = d.poses[KIND_SKIMMER][j]!, home = l.perches[q.id - KIND_SKIMMER * 4096]!;
        if (!q.perched || q.x !== home.x || q.y !== home.y || q.z !== home.z) wrong++;
      }
      for (let j = 0; j < d.count[KIND_DAMSELFLY]; j++) {
        const q = d.poses[KIND_DAMSELFLY][j]!, home = l.stems[q.id - KIND_DAMSELFLY * 4096]!;
        if (!q.perched || q.x !== home.x || q.y !== home.y || q.z !== home.z) wrong++;
      }
    });
    expect(darners).toBe(0);
    expect(wrong).toBe(0);
    expect(d.count).toEqual([0, 16, 20]);
  });

  it("shows nothing at dread 0.5, and nothing rustles", () => {
    const l = crowd();
    // The camera right by a perch, where a skimmer's sally would rustle.
    const cam = { x: l.perches[0]!.x, y: 11, z: l.perches[0]!.z - 1 };
    const d = createDragonflyBehaviour(l, SEED);
    let rustles = 0;
    run(d, 0, 600, cam, [], waterLifePresenceUnder({ ...WEATHER_PRESETS.clear, dread: 0.5 }, 12, 0.25), () => {
      rustles += d.rustles.length;
    });
    expect(d.count).toEqual([0, 0, 0]);
    expect(rustles).toBe(0);
  });

  it("neither steps nor poses a unit more than 60 m from the camera", () => {
    // A darner whose beat's middle is 66.5 m off, a skimmer 61 m and a damselfly 61.5 m; then 2 m nearer.
    const l = layout({ beats: [beat(0)], perches: [perch(0, 31, 10.8)], stems: [perch(0, 30.5, 10.4)] });
    const d = createDragonflyBehaviour(l, SEED);
    run(d, 0, 600, { x: 92, y: 11, z: 0 }, [], ABOUT);
    expect(d.count).toEqual([0, 0, 0]);
    run(d, 600, 600, { x: 90, y: 11, z: 0 }, [], ABOUT);
    expect(d.count).toEqual([0, 1, 1]);
  });

  it("holds no NaN through jumps of the hour, the weather, the clock and the frame", () => {
    const l = crowd();
    const d = createDragonflyBehaviour(l, SEED);
    const players = [{ x: l.beats[0]!.points[2]!.x, y: 10, z: l.beats[0]!.points[2]!.z }, { x: l.perches[3]!.x, y: 10, z: l.perches[3]!.z }];
    const jumps: [number, WeatherParams, number][] = [
      [12, WEATHER_PRESETS.clear, 0.25], [22, WEATHER_PRESETS.clear, 0.25], [3, WEATHER_PRESETS.rain, 0.9],
      [12, WEATHER_PRESETS.eerie, 0.5], [6, WEATHER_PRESETS.overcast, 0.65], [18.5, WEATHER_PRESETS.mist, 0.1],
      [12, WEATHER_PRESETS.clear, 0.8], [9, WEATHER_PRESETS.clear, 0.25], [12, WEATHER_PRESETS.clear, 0.25],
    ];
    // Frames of no time, a long hitch, a nonsense length; the clock jumping ahead and back.
    const frames = [DT, 0, 5, Number.NaN, DT];
    const bad: string[] = [];
    let tick = 0;
    for (const [hour, w, wind] of jumps) {
      const p = waterLifePresenceUnder(w, hour, wind);
      for (let i = 0; i < 300; i++) {
        tick = i === 150 ? tick + 1_000_000 : i === 200 ? 0 : tick + 1;
        d.step(tick, frames[i % frames.length]!, MIDDLE.x, MIDDLE.y, MIDDLE.z, players, p);
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < d.count[k]!; j++) {
            const q = d.poses[k]![j]!;
            if (![q.x, q.y, q.z, q.yaw, q.pitch].every(Number.isFinite)) bad.push(`${hour} h, kind ${k}, unit ${q.id}`);
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(d.count).toEqual([9, 16, 20]);
  }, timeLimit(20_000));

  it("keeps every object it hands out, frame after frame", () => {
    const l = crowd();
    const d = createDragonflyBehaviour(l, SEED);
    const count = d.count, poses = d.poses, rustles = d.rustles;
    const lists = [...d.poses];
    const objects = d.poses.map((list) => [...list]);
    const events = new Set<object>();
    // Beside a beat's middle, where its darner passes, with a player walking the shore.
    const cam = at(SPAN / 2, 29, 11);
    const player = { x: 31, y: 10, z: 0 };
    const players = [player];
    let tick = 0;
    for (let i = 0; i < 7_200; i++) {
      const a = (i / 7_200) * 2 * Math.PI;
      player.x = 31 * Math.cos(a);
      player.z = 31 * Math.sin(a);
      d.step(tick++, DT, cam.x, cam.y, cam.z, players, ABOUT);
      for (const e of d.rustles) events.add(e);
    }
    expect(d.count).toBe(count);
    expect(d.poses).toBe(poses);
    expect(d.rustles).toBe(rustles);
    for (let k = 0; k < 3; k++) {
      expect(d.poses[k]).toBe(lists[k]);
      expect(d.poses[k]!.length).toBe(objects[k]!.length);
      for (let j = 0; j < objects[k]!.length; j++) expect(d.poses[k]![j]).toBe(objects[k]![j]);
    }
    // The rustles came from a fixed handful of event objects, not one a rustle.
    expect(events.size).toBeGreaterThan(0);
    expect(events.size).toBeLessThanOrEqual(8);
  });
});
