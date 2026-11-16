import { describe, it, expect } from "vitest";
import { LIP_SPEED_MAX, LIP_SPEED_MIN, type LipTracker } from "../../src/game/oceanBreaker.js";
import { WIND_SEA_U_PER_WIND } from "../../src/game/oceanWindSea.js";
import {
  SURF_SPRAY_BURSTS, SURF_SPRAY_LIFE_S, SURF_SPRAY_NEVER_AGE, SURF_SPRAY_PER_BURST, SURF_SPRAY_RANGE_M, SURF_SPRAY_SLOT_FLOATS, SURF_SPRAY_THROW,
  createSprayBursts, createSprayThrow, sprayColour, spraySlots, sprayWind,
} from "../../src/game/sprayField.js";
import { SWASH_G } from "../../src/game/swashRunUp.js";
import type { SwashCove } from "../../src/game/swashTable.js";
import { OCEAN_FOAM_ALBEDO } from "../../src/game/waterShading.js";

const COVE: SwashCove = { z0: 0, halfWidth: 90, toeD: -30, faceGrade: 0.1, coastX: (z) => -400 + 0.1 * z };

/** A tracker's plunges for a frame: (d, z, height) each. */
function plunging(...rows: [number, number, number][]): LipTracker {
  const d = new Float32Array(32);
  const z = new Float32Array(32);
  const height = new Float32Array(32);
  rows.forEach((row, i) => {
    d[i] = row[0];
    z[i] = row[1];
    height[i] = row[2];
  });
  return { plunges: { count: rows.length, d, z, height } } as unknown as LipTracker;
}

describe("the surf's spray", () => {
  it("keeps its bursts in slots: none alive until one is thrown, each aged from its start and dead past the longest life", () => {
    const bursts = createSprayBursts();
    expect(bursts.data.length).toBe(SURF_SPRAY_BURSTS * SURF_SPRAY_SLOT_FLOATS);
    expect(bursts.age(100)).toBe(false);
    for (let s = 0; s < SURF_SPRAY_BURSTS; s++) expect(bursts.data[s * SURF_SPRAY_SLOT_FLOATS + 3]).toBe(SURF_SPRAY_NEVER_AGE);
    bursts.burst(1, 2, 3, 0, 4, 5, 100);
    expect(Array.from(bursts.data.subarray(0, 8))).toEqual([1, 2, 3, 0, 0, 1, 5, 0]);
    expect(bursts.age(100.5)).toBe(true);
    expect(bursts.data[3]).toBe(0.5);
    expect(bursts.age(100 + SURF_SPRAY_LIFE_S[1])).toBe(false);
    // A value that is not a finite number throws nothing.
    bursts.burst(Number.NaN, 0, 0, 1, 0, 1, 200);
    expect(bursts.age(200.1)).toBe(false);
  });

  it("takes the slot started longest ago, one never started first, in an array it is handed", () => {
    const data = new Float32Array(SURF_SPRAY_BURSTS * SURF_SPRAY_SLOT_FLOATS);
    const bursts = createSprayBursts(data);
    expect(bursts.data).toBe(data);
    for (let s = 0; s < SURF_SPRAY_BURSTS; s++) bursts.burst(s, 0, 0, 1, 0, 1, 10 + s);
    for (let s = 0; s < SURF_SPRAY_BURSTS; s++) expect(data[s * SURF_SPRAY_SLOT_FLOATS]).toBe(s);
    bursts.burst(99, 0, 0, 1, 0, 1, 20);
    expect(data[0]).toBe(99);
    expect(() => createSprayBursts(new Float32Array(3))).toThrow();
  });

  it("gives each sprite its slot, a burst's worth to a slot", () => {
    const slots = spraySlots(SURF_SPRAY_BURSTS * SURF_SPRAY_PER_BURST);
    expect(slots[0]).toBe(0);
    expect(slots[SURF_SPRAY_PER_BURST - 1]).toBe(0);
    expect(slots[SURF_SPRAY_PER_BURST]).toBe(1);
    expect(slots[slots.length - 1]).toBe(SURF_SPRAY_BURSTS - 1);
  });

  it("is carried by the sea's reading of the wind and coloured the foam's white under the lights' sum", () => {
    const wind = { dirX: 0.6, dirZ: -0.8, speed: 0.5, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
    const w = sprayWind(wind, [0, 0]);
    expect(w[0]).toBeCloseTo(0.6 * 0.5 * WIND_SEA_U_PER_WIND, 9);
    expect(w[1]).toBeCloseTo(-0.8 * 0.5 * WIND_SEA_U_PER_WIND, 9);
    expect(sprayWind({ ...wind, speed: Number.NaN }, [1, 1]).map(Math.abs)).toEqual([0, 0]);
    const colour = sprayColour([{ r: 1, g: 0.5, b: 0.25, intensity: 2 }, { r: 0.2, g: 0.2, b: 0.2, intensity: 0.5 }], [0, 0, 0]);
    expect(colour[0]).toBeCloseTo(OCEAN_FOAM_ALBEDO * 2.1, 9);
    expect(colour[1]).toBeCloseTo(OCEAN_FOAM_ALBEDO * 1.1, 9);
    expect(colour[2]).toBeCloseTo(OCEAN_FOAM_ALBEDO * 0.6, 9);
  });

  it("throws a frame's plunges nearest the camera first, from the crest's top at the lip's speed, none past its range", () => {
    expect(SURF_SPRAY_THROW).toBe((LIP_SPEED_MIN + LIP_SPEED_MAX) / 2);
    const tracker = plunging([-10, 50, 1.2], [-12, 5, 0.8], [-9, SURF_SPRAY_RANGE_M + 80, 1]);
    const throwSpray = createSprayThrow(tracker, COVE, 0.25);
    const thrown: number[][] = [];
    throwSpray(false, [0.8, 0.6], -390, 0, 42, (...args) => void thrown.push(args));
    expect(thrown.length).toBe(2);
    // The nearer plunge first: at z = 5, from the crest's top over the level, along the face's landward normal.
    expect(thrown[0]!.slice(0, 3)).toEqual([COVE.coastX(5) - 12, 0.25 + Math.fround(0.8), 5]);
    expect(thrown[0]![3]).toBe(1);
    expect(thrown[0]![4]).toBeCloseTo(-0.1, 9);
    expect(thrown[0]![5]).toBeCloseTo(SURF_SPRAY_THROW * Math.sqrt(SWASH_G * 0.8), 6);
    expect(thrown[0]![6]).toBe(42);
    expect(thrown[1]![2]).toBe(50);
    // While the curl is shown the throw is along the swell's travel.
    thrown.length = 0;
    throwSpray(true, [0.8, 0.6], -390, 0, 43, (...args) => void thrown.push(args));
    expect(thrown[0]!.slice(3, 5)).toEqual([0.8, 0.6]);
  });

  it("throws no more bursts a frame than there are slots", () => {
    const rows: [number, number, number][] = [];
    for (let i = 0; i < SURF_SPRAY_BURSTS + 3; i++) rows.push([-10, i * 4, 1]);
    const throwSpray = createSprayThrow(plunging(...rows), COVE, 0);
    let count = 0;
    throwSpray(false, [1, 0], -400, 0, 1, () => void count++);
    expect(count).toBe(SURF_SPRAY_BURSTS);
  });
});
