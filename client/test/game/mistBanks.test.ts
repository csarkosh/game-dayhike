import { describe, expect, it } from "vitest";
import { GRADIENT_MID_STEP, atmosphereUnder, fogGradientAt } from "../../src/game/atmosphereParams.js";
import {
  MIST_CAP_BY_TIER, MIST_DRIFT, MIST_EDGE_FADE_SPAN, MIST_INSTANCE_FLOATS, MIST_NEAR_FADE_SPAN, MIST_NEAR_FADE_START, MIST_SHOWN_FLOOR, MIST_WRAP_FADE,
  createMistBanks, emptyMistUniforms, mistBankShown, mistUniforms, writeMistInstances, type DrawnMistBank, type MistOrder,
} from "../../src/game/mistBanks.js";
import { skyStateFor } from "@csarkosh/engine/game/skyState";
import { skyFixture } from "./helpers/skyFixture.js";
import { MIST_CELL, MIST_RADIUS, collectMistBanks } from "../../src/game/mistField.js";
import { WEATHER_PRESETS, mistOpacityUnder } from "@csarkosh/engine/game/weather";
import { windRecordUnder } from "@csarkosh/engine/game/windParams";
// Terrain variants register via import side effects (see mistField.test.ts);
// collectMistBanks needs one active before it can sample elevation.
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";

setActiveTerrainVariant("olympic");

const SEED = 1;
const STILL = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
const wrap = (v: number): number => ((v + MIST_CELL / 2) % MIST_CELL + MIST_CELL) % MIST_CELL - MIST_CELL / 2;

function coastalOrigin(): { x: number; z: number } {
  for (let x = -350; x <= -100; x += 50) {
    for (let z = -400; z <= 400; z += 100) {
      if (collectMistBanks(SEED, x, z).length > 0) return { x, z };
    }
  }
  throw new Error("no banks on the coastal strip");
}

describe("the mist banks as a frame draws them", () => {
  it("has a quad a bank of the tier's cap, none placed before a frame", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const banks = createMistBanks(SEED, tier);
      expect(banks.drawn.length).toBe(MIST_CAP_BY_TIER[tier]);
      expect(banks.drawn.some(mistBankShown)).toBe(false);
    }
  });

  it("draws nothing in a weather with no mist, and leaves its quads as they were", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    expect(banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0)).toBe(true);
    const before = banks.drawn.map((bank) => ({ ...bank }));
    expect(banks.update(x, z, WEATHER_PRESETS.clear, STILL, 0)).toBe(false);
    expect(banks.drawn).toEqual(before);
  });

  it("places the nearest banks first, each where its own phase of the drift carries it, at its size", () => {
    const banks = createMistBanks(SEED, "low");
    const { x, z } = coastalOrigin();
    banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0);
    const placed = collectMistBanks(SEED, x, z);
    banks.drawn.forEach((quad, i) => {
      const bank = placed[i];
      expect(quad.placed).toBe(bank !== undefined);
      if (bank === undefined) return;
      // A bank's own phase stands it off its seeded place along the wind's direction, even at a speed of none.
      expect(quad.x).toBeCloseTo(bank.x + wrap(bank.hash * MIST_CELL) * STILL.dirX, 9);
      expect(quad.z).toBeCloseTo(bank.z + wrap(bank.hash * MIST_CELL) * STILL.dirZ, 9);
      expect([quad.y, quad.width, quad.height]).toEqual([bank.y, bank.width, bank.height]);
    });
  });

  it("fades a bank by the weather's opacity, the near ring, the rim of the radius and its own wrap boundary", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    const wind = { ...windRecordUnder(WEATHER_PRESETS.mist, 0, 1), dirX: 1, dirZ: 0 };
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 0);
    const opacity = mistOpacityUnder(WEATHER_PRESETS.mist);
    const placed = collectMistBanks(SEED, x, z);
    let some = 0;
    banks.drawn.forEach((quad, i) => {
      const bank = placed[i];
      if (bank === undefined) return;
      const offset = wrap(bank.hash * MIST_CELL);
      const d = Math.hypot(quad.x - x, quad.z - z);
      const near = Math.min(1, Math.max(0, (d - MIST_NEAR_FADE_START) / MIST_NEAR_FADE_SPAN));
      const edge = Math.min(1, Math.max(0, (MIST_RADIUS - d) / MIST_EDGE_FADE_SPAN));
      const t = Math.min(1, Math.max(0, (Math.abs(offset) - (MIST_CELL / 2 - MIST_WRAP_FADE)) / MIST_WRAP_FADE));
      expect(quad.visibility).toBeCloseTo(opacity * near * edge * (1 - t * t * (3 - 2 * t)), 12);
      expect(mistBankShown(quad)).toBe(quad.visibility > MIST_SHOWN_FLOOR);
      if (mistBankShown(quad)) some++;
    });
    expect(some).toBeGreaterThan(0);
  });

  it("integrates the drift from the clock, a second of wind a step at most", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    const wind = { ...windRecordUnder(WEATHER_PRESETS.mist, 0, 1), dirX: 1, dirZ: 0 };
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 0);
    const at = banks.drawn.map((quad) => quad.x);
    // The clock is stepped in a weather with no mist too.
    banks.update(x, z, WEATHER_PRESETS.clear, wind, 0.5);
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 1);
    banks.drawn.forEach((quad, i) => {
      if (quad.placed) expect(wrap(quad.x - (at[i] as number))).toBeCloseTo(MIST_DRIFT * wind.speed, 9);
    });
    // A minute's gap carries a second of it, and a clock that has not moved carries nothing.
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 61);
    banks.update(x, z, WEATHER_PRESETS.mist, wind, 61);
    banks.drawn.forEach((quad, i) => {
      if (quad.placed) expect(wrap(quad.x - (at[i] as number))).toBeCloseTo(2 * MIST_DRIFT * wind.speed, 9);
    });
  });

  it("collects again when the camera crosses a cell, and when the mist returns", () => {
    const banks = createMistBanks(SEED, "high");
    const { x, z } = coastalOrigin();
    banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0);
    const here = banks.drawn.filter((quad) => quad.placed).map((quad) => [quad.x, quad.z]);
    banks.update(x + 3 * MIST_CELL, z, WEATHER_PRESETS.mist, STILL, 0);
    const there = collectMistBanks(SEED, x + 3 * MIST_CELL, z);
    banks.drawn.forEach((quad, i) => {
      expect(quad.placed).toBe(there[i] !== undefined);
      if (there[i] !== undefined) expect(quad.y).toBe(there[i]?.y);
    });
    banks.update(x + 3 * MIST_CELL, z, WEATHER_PRESETS.clear, STILL, 0);
    banks.update(x, z, WEATHER_PRESETS.mist, STILL, 0);
    expect(banks.drawn.filter((quad) => quad.placed).map((quad) => [quad.x, quad.z])).toEqual(here);
  });
});

const quad = (x: number, y: number, z: number, visibility: number, placed = true): DrawnMistBank => ({ placed, x, y, z, width: 80, height: 20, visibility });

describe("the mist banks as instances of one quad", () => {
  it("writes a shown bank's matrix: scaled to the bank, turned about the vertical to the camera's yaw, its visibility in the last float", () => {
    const yaw = 0.7;
    const matrices = new Float32Array(MIST_INSTANCE_FLOATS);
    expect(writeMistInstances([quad(10, 20, 30, 0.4)], { x: 0, y: 0, z: 0 }, yaw, matrices)).toBe(1);
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const want = [80 * c, 0, -80 * s, 0, 0, 20, 0, 0, s, 0, c, 0, 10, 20, 30, 0.4];
    want.forEach((v, i) => expect(matrices[i], `float ${i}`).toBeCloseTo(v, 5));
    // The quad's width lies along the camera's right, (cos yaw, 0, -sin yaw), and its face along the view.
    const right = [matrices[0] as number, matrices[1] as number, matrices[2] as number];
    const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
    expect(right[0]! * forward[0]! + right[2]! * forward[2]!).toBeCloseTo(0, 5);
    expect([matrices[8], matrices[9], matrices[10]].map((v) => +(v as number).toFixed(5))).toEqual(forward.map((v) => +v.toFixed(5)));
  });

  it("writes the farthest first from the eye, in all three axes, and leaves out a bank not placed or faded out", () => {
    const drawn = [
      quad(0, 0, 100, 0.3), quad(0, 0, 300, 0.2), quad(0, 0, 50, MIST_SHOWN_FLOOR), quad(0, 0, 200, 0.5, false), quad(0, 400, 0, 0.1), quad(0, 0, -150, 0.25),
    ];
    const matrices = new Float32Array(drawn.length * MIST_INSTANCE_FLOATS);
    const count = writeMistInstances(drawn, { x: 0, y: 0, z: 0 }, 0, matrices);
    expect(count).toBe(4);
    const order = [0, 1, 2, 3].map((n) => +(matrices[n * MIST_INSTANCE_FLOATS + 15] as number).toFixed(2));
    expect(order).toEqual([0.1, 0.2, 0.25, 0.3]);
    // From an eye among them the order turns round.
    writeMistInstances(drawn, { x: 0, y: 0, z: 280 }, 0, matrices);
    expect([0, 1, 2, 3].map((n) => +(matrices[n * MIST_INSTANCE_FLOATS + 15] as number).toFixed(2))).toEqual([0.1, 0.25, 0.3, 0.2]);
  });

  it("keeps the list's order for two banks at one distance, and writes nothing past the shown ones", () => {
    const drawn = [quad(100, 0, 0, 0.11), quad(-100, 0, 0, 0.22), quad(0, 0, 100, 0.33)];
    const matrices = new Float32Array(4 * MIST_INSTANCE_FLOATS).fill(7);
    expect(writeMistInstances(drawn, { x: 0, y: 0, z: 0 }, 0, matrices)).toBe(3);
    expect([0, 1, 2].map((n) => +(matrices[n * MIST_INSTANCE_FLOATS + 15] as number).toFixed(2))).toEqual([0.11, 0.22, 0.33]);
    expect([...matrices.subarray(3 * MIST_INSTANCE_FLOATS)]).toEqual(new Array(MIST_INSTANCE_FLOATS).fill(7));
    expect(writeMistInstances([], { x: 0, y: 0, z: 0 }, 0, matrices)).toBe(0);
  });
});

describe("the scratch the banks are ordered in", () => {
  it("is the caller's to keep: a frame orders in it and makes no record once it has held as many", () => {
    const drawn = [quad(0, 0, 100, 0.3), quad(0, 0, 300, 0.2), quad(0, 0, 200, 0.4)];
    const matrices = new Float32Array(drawn.length * MIST_INSTANCE_FLOATS);
    const order: MistOrder = [];
    expect(writeMistInstances(drawn, { x: 0, y: 0, z: 0 }, 0, matrices, order)).toBe(3);
    expect(order.map((o) => o.index)).toEqual([1, 2, 0]);
    const records = new Set(order);
    expect(writeMistInstances(drawn, { x: 0, y: 0, z: 400 }, 0, matrices, order)).toBe(3);
    expect(order.map((o) => o.index)).toEqual([0, 2, 1]);
    expect(new Set(order).size).toBe(3);
    expect(order.every((o) => records.has(o))).toBe(true);
    // Fewer shown: the first places are the shown ones, and the rest are kept for a later frame.
    expect(writeMistInstances([drawn[0] as DrawnMistBank, quad(0, 0, 300, 0), drawn[2] as DrawnMistBank], { x: 0, y: 0, z: 0 }, 0, matrices, order)).toBe(2);
    expect(order.slice(0, 2).map((o) => o.index)).toEqual([2, 0]);
    expect(new Set(order).size).toBe(3);
  });
});

describe("the mist banks' uniforms", () => {
  it("names the banks' colour, the scene's distance fog and the display curve", () => {
    expect(Object.keys(emptyMistUniforms())).toEqual(["mistEmissive", "mistFogColour", "mistFogDensity", "mistExposure", "mistContrast"]);
    const sky = skyStateFor(skyFixture(), 12, WEATHER_PRESETS.mist);
    const air = atmosphereUnder(WEATHER_PRESETS.mist, sky, 900);
    const colour = fogGradientAt(sky, GRADIENT_MID_STEP);
    const out = emptyMistUniforms();
    expect(mistUniforms(colour, air, 1.3, 1.1, out)).toBe(out);
    expect(out.mistEmissive).toEqual([colour.r, colour.g, colour.b]);
    // The fog the banks fade into is the scene's: toward the gradient's far end, at the air's density.
    expect(out.mistFogColour).toEqual([sky.mistAir.r, sky.mistAir.g, sky.mistAir.b]);
    expect(out.mistFogDensity).toEqual([air.baseDensity]);
    expect(out.mistExposure).toEqual([1.3]);
    expect(out.mistContrast).toEqual([1.1]);
  });
});
