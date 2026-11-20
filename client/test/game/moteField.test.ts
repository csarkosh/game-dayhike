import { describe, expect, it } from "vitest";
import {
  MOTE_BOX, MOTE_CLOCK_RATE, MOTE_SALT, MOTE_SLOT_FLOATS, emptyMoteUniforms, moteAt, moteHash, moteRandom, moteShare, moteSlots, moteUniforms,
  motesShown, stepMoteTravel,
} from "@csarkosh/engine/game/moteField";
import { MOTE_ALPHA, MOTE_BOX_HALF, MOTE_CAPACITY, MOTE_SHARES, moteCapacity, motesUnder } from "@csarkosh/engine/game/motesParams";
import { WEATHER_PRESETS } from "@csarkosh/engine/game/weather";
import { windRecordUnder } from "@csarkosh/engine/game/windParams";

const AIR = { r: 0.4, g: 0.5, b: 0.6 };
const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
const NOON = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "medium", STILL);
const NIGHT = motesUnder(WEATHER_PRESETS.clear, 23, AIR, "medium", STILL);
const EYE = { x: 250, y: 76, z: -500 };

/** Every slot of the medium tier under `u`, as the stage places them. */
function field(u: ReturnType<typeof emptyMoteUniforms>, eye = EYE): ReturnType<typeof moteAt>[] {
  const slots = moteSlots("medium");
  if (slots === null) throw new Error("the medium tier has motes");
  const out = [];
  for (let i = 0; i < slots.count; i++) {
    const at = i * MOTE_SLOT_FLOATS;
    out.push(moteAt(slots.data[at] as number, slots.data[at + 1] as number, slots.data[at + 2] as number, u, eye));
  }
  return out;
}

describe("the motes' randoms", () => {
  it("mixes 32 bits as PCG's output step does, and stays in 32 bits", () => {
    // Worked by hand in 64-bit integers.
    const pcg = (n: bigint): bigint => {
      let h = (n * 747796405n + 2891336453n) & 0xffffffffn;
      h = (((h >> ((h >> 28n) + 4n)) ^ h) * 277803737n) & 0xffffffffn;
      return ((h >> 22n) ^ h) & 0xffffffffn;
    };
    for (const n of [0, 1, 2, 12345, 0x7fffffff, 0x80000000, 0xffffffff]) expect(moteHash(n), String(n)).toBe(Number(pcg(BigInt(n))));
  });

  it("draws numbers in [0, 1) that fill it evenly, a different one a slot, a life and a salt", () => {
    let sum = 0;
    const tenths = new Array<number>(10).fill(0);
    for (let slot = 0; slot < 4000; slot++) {
      const r = moteRandom(slot, 3, MOTE_SALT.x);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      sum += r;
      tenths[Math.floor(r * 10)] = (tenths[Math.floor(r * 10)] as number) + 1;
    }
    expect(sum / 4000).toBeCloseTo(0.5, 1);
    for (const n of tenths) expect(n).toBeGreaterThan(330);
    expect(moteRandom(7, 3, MOTE_SALT.x)).not.toBe(moteRandom(7, 4, MOTE_SALT.x));
    expect(moteRandom(7, 3, MOTE_SALT.x)).not.toBe(moteRandom(7, 3, MOTE_SALT.y));
    expect(moteRandom(7, 3, MOTE_SALT.x)).not.toBe(moteRandom(8, 3, MOTE_SALT.x));
    expect(new Set(Object.values(MOTE_SALT)).size).toBe(Object.keys(MOTE_SALT).length);
  });
});

describe("the motes' slots", () => {
  it("lists a slot a particle of the tier's two pools, a third of its capacity each, and none on low", () => {
    expect(moteSlots("low")).toBeNull();
    for (const tier of ["medium", "high"] as const) {
      const slots = moteSlots(tier);
      const each = Math.ceil(MOTE_CAPACITY[tier] / MOTE_SHARES);
      expect(moteCapacity(tier)).toBe(each);
      expect(slots?.count).toBe(each * 2);
      expect(slots?.data.length).toBe(each * 2 * MOTE_SLOT_FLOATS);
    }
    const { data, count } = moteSlots("medium") as { data: Float32Array; count: number };
    expect(count).toBe(400);
    // Its number, its species (the pollen's slots, then the frost's), and its rank among its species' slots.
    expect([data[0], data[1]]).toEqual([0, 0]);
    expect(data[2]).toBeCloseTo(0.5 / 200, 6);
    const last = (count - 1) * MOTE_SLOT_FLOATS;
    expect([data[last], data[last + 1]]).toEqual([399, 1]);
    expect(data[last + 2]).toBeCloseTo(199.5 / 200, 6);
    expect(data[200 * MOTE_SLOT_FLOATS + 1]).toBe(1);
    expect(data[199 * MOTE_SLOT_FLOATS + 1]).toBe(0);
  });

  it("shows the share of a pool its rate keeps alive: the rate times the mean life, a full pool at most", () => {
    const s = NOON.species.pollen;
    expect(s.rate).toBeCloseTo(70, 9);
    // 70 a unit for a mean life of 6 would keep 420 alive: the pool of 200 is full.
    expect(moteShare(s, 200)).toBe(1);
    expect(moteShare({ ...s, rate: 10 }, 200)).toBeCloseTo((10 * 6) / 200, 12);
    expect(moteShare({ ...s, rate: 0 }, 200)).toBe(0);
    expect(moteShare(s, 0)).toBe(0);
  });
});

describe("the motes' uniforms", () => {
  it("names the particles' clock, the wind's carry, each species' spans and drift, the colour and the display curve", () => {
    const u = moteUniforms(NOON, "medium", 100, { x: 3, z: -4 }, 1.2, 1.1);
    expect(Object.keys(u)).toEqual(Object.keys(emptyMoteUniforms()));
    expect(u.moteClock[0]).toBeCloseTo(100 * MOTE_CLOCK_RATE, 9);
    expect(MOTE_CLOCK_RATE).toBe(0.6);
    expect(u.moteTravel).toEqual([3, -4]);
    const p = NOON.species.pollen;
    expect(u.motePollenSpan).toEqual([p.minSize, p.maxSize, p.minLife, p.maxLife]);
    expect(u.motePollenDrift).toEqual([p.rise, p.jitter, 1, 0]);
    // By day no frost is shown, and by night no pollen.
    expect(u.moteFrostDrift[2]).toBe(0);
    expect(motesShown(u)).toBe(true);
    const night = moteUniforms(NIGHT, "medium", 0, { x: 0, z: 0 }, 1, 1.1);
    expect([night.motePollenDrift[2], night.moteFrostDrift[2]]).toEqual([0, 1]);
    expect(u.moteColour).toEqual([AIR.r, AIR.g, AIR.b, MOTE_ALPHA]);
    expect([u.moteExposure[0], u.moteContrast[0]]).toEqual([1.2, 1.1]);
    // Rain washes the air clean: nothing is shown.
    expect(motesShown(moteUniforms(motesUnder(WEATHER_PRESETS.rain, 12, AIR, "medium", STILL), "medium", 0, { x: 0, z: 0 }, 1, 1.1))).toBe(false);
  });

  it("carries the field with the wind on the particles' clock, a second a step at most, within a box", () => {
    const travel = { x: 0, z: 0 };
    stepMoteTravel(travel, { x: 0.5, z: -0.25 }, 0.5);
    expect(travel.x).toBeCloseTo(0.5 * 0.5 * MOTE_CLOCK_RATE, 12);
    expect(travel.z).toBeCloseTo(-0.25 * 0.5 * MOTE_CLOCK_RATE, 12);
    stepMoteTravel(travel, { x: 0.5, z: -0.25 }, 60);
    expect(travel.x).toBeCloseTo(0.5 * 1.5 * MOTE_CLOCK_RATE, 12);
    stepMoteTravel(travel, { x: 0.5, z: -0.25 }, -3);
    expect(travel.x).toBeCloseTo(0.5 * 1.5 * MOTE_CLOCK_RATE, 12);
    for (let i = 0; i < 400; i++) stepMoteTravel(travel, { x: 0.5, z: -0.25 }, 1);
    expect(Math.abs(travel.x)).toBeLessThan(MOTE_BOX[0]);
    expect(Math.abs(travel.z)).toBeLessThan(MOTE_BOX[2]);
  });
});

describe("the motes as the stage places them", () => {
  it("shows the day's pool whole by day and the night's by night, each mote of the species' size and the air's colour", () => {
    const day = field(moteUniforms(NOON, "medium", 40, { x: 0, z: 0 }, 1, 1.1));
    expect(day.filter((m) => m.shown).length).toBe(200);
    expect(day.slice(200).some((m) => m.shown)).toBe(false);
    for (const m of day.slice(0, 200)) {
      expect(m.size).toBeGreaterThanOrEqual(0.02);
      expect(m.size).toBeLessThanOrEqual(0.05);
      expect(m.colour).toEqual(AIR);
    }
    const night = field(moteUniforms(NIGHT, "medium", 40, { x: 0, z: 0 }, 1, 1.1));
    expect(night.slice(0, 200).some((m) => m.shown)).toBe(false);
    expect(night.slice(200).filter((m) => m.shown).length).toBe(200);
    for (const m of night.slice(200)) {
      expect(m.size).toBeGreaterThanOrEqual(0.03);
      expect(m.size).toBeLessThanOrEqual(0.08);
    }
  });

  it("shows fewer under a low rate, the lowest ranks first", () => {
    const thin = { ...NOON, species: { ...NOON.species, pollen: { ...NOON.species.pollen, rate: 10 } } };
    const shown = field(moteUniforms(thin, "medium", 40, { x: 0, z: 0 }, 1, 1.1)).map((m) => m.shown);
    expect(shown.filter(Boolean).length).toBe(60);
    expect(shown.indexOf(false)).toBe(60);
  });

  it("spreads the motes through the emitter's box round the eye, as far out as a life's drift carries them and no further", () => {
    const u = moteUniforms(NOON, "medium", 40, { x: 0, z: 0 }, 1, 1.1);
    const day = field(u).slice(0, 200);
    const p = NOON.species.pollen;
    const reach = p.jitter * p.maxLife;
    let sx = 0, sz = 0, sy = 0;
    for (const m of day) {
      expect(Math.abs(m.x - EYE.x)).toBeLessThanOrEqual(MOTE_BOX_HALF + reach);
      expect(Math.abs(m.z - EYE.z)).toBeLessThanOrEqual(MOTE_BOX_HALF + reach);
      expect(m.y - EYE.y).toBeLessThanOrEqual(MOTE_BOX_HALF * 0.5 + (p.rise + 0.5 * p.jitter) * p.maxLife);
      expect(m.y - EYE.y).toBeGreaterThanOrEqual(-MOTE_BOX_HALF * 0.5 + (p.rise - 0.5 * p.jitter) * p.maxLife);
      sx += Math.abs(m.x - EYE.x);
      sz += Math.abs(m.z - EYE.z);
      sy += Math.abs(m.y - EYE.y);
    }
    // Evenly through the box: a quarter of its width from the middle on average, on each axis.
    expect(sx / 200).toBeGreaterThan(4);
    expect(sx / 200).toBeLessThan(6);
    expect(sz / 200).toBeGreaterThan(4);
    expect(sz / 200).toBeLessThan(6);
    expect(sy / 200).toBeGreaterThan(2);
    expect(sy / 200).toBeLessThan(3.1);
  });

  it("lives a life of the species' length, the long ones the more, and fades from the motes' alpha to nothing over it", () => {
    const day = field(moteUniforms(NOON, "medium", 40, { x: 0, z: 0 }, 1, 1.1)).slice(0, 200);
    let lives = 0, alphas = 0;
    for (const m of day) {
      expect(m.life).toBeGreaterThanOrEqual(4);
      expect(m.life).toBeLessThanOrEqual(8);
      expect(m.age).toBeGreaterThanOrEqual(0);
      expect(m.age).toBeLessThan(m.life);
      expect(m.alpha).toBeCloseTo(MOTE_ALPHA * (1 - m.age / m.life), 12);
      lives += m.life;
      alphas += m.alpha;
    }
    // Lengths between 4 and 8 weighted by length average 6.22, not the 6 of an even draw.
    expect(lives / 200).toBeGreaterThan(6.05);
    expect(lives / 200).toBeLessThan(6.4);
    // The slots are at every age: half the alpha on average.
    expect(alphas / 200).toBeCloseTo(MOTE_ALPHA / 2, 1);
  });

  it("drifts a mote by its own jitter through a life, then gives the slot a new place", () => {
    const at = (seconds: number): ReturnType<typeof moteAt> => moteAt(5, 0, 0.0275, moteUniforms(NOON, "medium", seconds, { x: 0, z: 0 }, 1, 1.1), EYE);
    const first = at(0);
    const left = (first.life - first.age) / MOTE_CLOCK_RATE;
    const later = at(left * 0.5);
    const p = NOON.species.pollen;
    const dt = left * 0.5 * MOTE_CLOCK_RATE;
    expect(later.age).toBeCloseTo(first.age + dt, 9);
    expect(Math.abs(later.x - first.x)).toBeLessThanOrEqual(p.jitter * dt + 1e-9);
    expect(later.y - first.y).toBeGreaterThanOrEqual((p.rise - 0.5 * p.jitter) * dt - 1e-9);
    expect(later.y - first.y).toBeLessThanOrEqual((p.rise + 0.5 * p.jitter) * dt + 1e-9);
    expect(later.size).toBe(first.size);
    const next = at(left + 0.01);
    expect(next.age).toBeLessThan(0.1);
    expect(next.alpha).toBeGreaterThan(MOTE_ALPHA * 0.98);
    expect(Math.hypot(next.x - first.x, next.z - first.z)).toBeGreaterThan(0.5);
  });

  it("stands the field in the world: an eye that moves leaves a mote where it was, until the box round it passes the mote by", () => {
    const u = moteUniforms(NOON, "medium", 40, { x: 0, z: 0 }, 1, 1.1);
    const here = field(u, EYE).slice(0, 200);
    const there = field(u, { x: EYE.x + 1, y: EYE.y, z: EYE.z }).slice(0, 200);
    let stayed = 0;
    here.forEach((m, i) => {
      const moved = Math.hypot((there[i] as { x: number }).x - m.x, (there[i] as { z: number }).z - m.z);
      if (moved < 1e-6) stayed++;
      // One that the box left behind comes in a box's width ahead.
      else expect(moved).toBeCloseTo(MOTE_BOX[0], 6);
    });
    expect(stayed).toBeGreaterThan(180);
    expect(stayed).toBeLessThan(200);
  });

  it("carries every mote alike with the wind", () => {
    const calm = field(moteUniforms(NOON, "medium", 40, { x: 0, z: 0 }, 1, 1.1)).slice(0, 200);
    const blown = field(moteUniforms(NOON, "medium", 40, { x: 0.5, z: 0 }, 1, 1.1)).slice(0, 200);
    let carried = 0;
    calm.forEach((m, i) => {
      if (Math.abs((blown[i] as { x: number }).x - m.x - 0.5) < 1e-6) carried++;
    });
    expect(carried).toBeGreaterThan(180);
  });
});
