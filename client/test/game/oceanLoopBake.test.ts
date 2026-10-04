// client/test/game/oceanLoopBake.test.ts
import { describe, it, expect, vi } from "vitest";
import { LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE, cascadeBands, windSeaH0 } from "../../src/game/oceanSpectrum.js";
import { WIND_SEA_CHOPPINESS, windSeaFields } from "../../src/game/oceanFft.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import {
  bakeWindSeaLoop, fromHalf, loopFrame, loopSpectrum, loopStats, toHalf, windSeaBandStats, type LoopReply,
} from "../../src/game/oceanLoopBake.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 0x5eed;

/** A frame's heights, decoded, scaled. */
function heights(data: Uint16Array, frame: number, scale: number): Float64Array {
  const n = LOOP_N * LOOP_N;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fromHalf(data[(frame * n + i) * 4] as number) * scale;
  return out;
}

function std(values: ArrayLike<number>): number {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    sumSq += (values[i] as number) * (values[i] as number);
  }
  const mean = sum / values.length;
  return Math.sqrt(sumSq / values.length - mean * mean);
}

describe("half floats", () => {
  it("round to nearest, ties to even, and read back", () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(70000)).toBe(0x7c00);
    expect(toHalf(0.1)).toBe(0x2e66);
    expect(fromHalf(0x2e66)).toBe(0.0999755859375);
    expect(toHalf(2 ** -24)).toBe(1);
    expect(toHalf(1e-7)).toBe(2);
    expect(toHalf(0)).toBe(0);
    for (const v of [0.5, -1.25, 3.14159, 2.7, -0.001]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) * 2 ** -11);
  });
});

describe("the medium tier's loop", () => {
  it("closes: the frame at LOOP_SECONDS is the first, within half-float precision", () => {
    const spectrum = loopSpectrum(SEED);
    const first = loopFrame(spectrum, 0);
    const last = loopFrame(spectrum, LOOP_SECONDS);
    let largest = 0;
    let apart = 0;
    let sameHalf = 0;
    for (let i = 0; i < first.length; i++) {
      largest = Math.max(largest, Math.abs(first[i] as number));
      apart = Math.max(apart, Math.abs((first[i] as number) - (last[i] as number)));
      if (toHalf(first[i] as number) === toHalf(last[i] as number)) sameHalf++;
    }
    // Metres of sea, not a flat field: the bake draws waves.
    expect(largest).toBeGreaterThan(1);
    // Half precision at a metre is a thousandth; the frames differ by a hundredth of that.
    expect(apart).toBeLessThan(1e-4);
    expect(sameHalf / first.length).toBeGreaterThan(0.99);
  }, timeLimit(60_000));

  it("bakes LOOP_FRAMES frames of LOOP_N² texels, (height, dx, dz, 0) in half floats, frame f at f·LOOP_SECONDS/LOOP_FRAMES", () => {
    const data = bakeWindSeaLoop(SEED);
    expect(data.length).toBe(LOOP_FRAMES * LOOP_N * LOOP_N * 4);
    expect(data.length).toBe(4_194_304);
    const spectrum = loopSpectrum(SEED);
    const layer = LOOP_N * LOOP_N * 4;
    for (const f of [0, 17, 63]) {
      const frame = loopFrame(spectrum, (f * LOOP_SECONDS) / LOOP_FRAMES);
      for (const i of [0, 1, 2, 3, 4097, 30001, layer - 1]) expect(data[f * layer + i], `frame ${f}, ${i}`).toBe(toHalf(frame[i] as number));
    }
    for (let i = 3; i < data.length; i += 4 * 997) expect(data[i]).toBe(0);
  }, timeLimit(60_000));

  it("serves every wind: scaled to 15 m/s it has the significant height of the sea made at 15 m/s on the scaled tile, within 10 %", () => {
    const state = windSeaStateFor(15 / 12, [1, 0], 12);
    expect(state.u10).toBe(15);
    expect(state.loopScale).toBe(2.25);
    const baked = 4 * std(heights(bakeWindSeaLoop(SEED), 0, state.loopScale));
    const size = LOOP_SIZE * state.loopScale;
    const band = cascadeBands([size], LOOP_N)[0] as { kMin: number; kMax: number };
    const h0 = windSeaH0(LOOP_N, size, { u10: 15, dir: [1, 0] }, band, SEED, LOOP_SECONDS);
    const direct = 4 * std(windSeaFields(h0, LOOP_N, size, 0, WIND_SEA_CHOPPINESS).height);
    expect(direct).toBeGreaterThan(1);
    expect(Math.abs(baked / direct - 1)).toBeLessThan(0.1);
  }, timeLimit(60_000));

  it("measures the height and the slope the shaders draw: a sinusoid's standard deviation and its central differences", () => {
    const data = new Uint16Array(LOOP_N * LOOP_N * 4);
    for (let row = 0; row < LOOP_N; row++) {
      for (let col = 0; col < LOOP_N; col++) data[(row * LOOP_N + col) * 4] = toHalf(Math.cos((2 * Math.PI * 4 * col) / LOOP_N));
    }
    const stats = loopStats(data, 0);
    expect(stats.heightStd).toBeCloseTo(0.70713, 4);
    // ½ (sin(kΔ)/Δ)², k = 2π·4/LOOP_SIZE, Δ = LOOP_SIZE/LOOP_N: a hair under ½k².
    expect(stats.slopeVar).toBeCloseTo(0.086614, 5);
  });
});

describe("the wind sea's band shares", () => {
  it("are the spectrum's: below 1 Hz at 10 m/s the whole sea, (Hs/4)²; the cascades' three add to their span", () => {
    const below1Hz = windSeaBandStats(10, { kMin: 0, kMax: (2 * Math.PI) ** 2 / 9.81 });
    expect(below1Hz.heightVar).toBeCloseTo(0.50908, 4);
    expect(Math.abs(below1Hz.heightVar / 0.509164 - 1)).toBeLessThan(0.001);
    expect(below1Hz.slopeVar).toBeCloseTo(0.011626, 5);
    const bands = cascadeBands([1000, 150, 25], 256);
    const each = bands.map((band) => windSeaBandStats(10, band));
    const whole = windSeaBandStats(10, { kMin: 0, kMax: (bands[2] as { kMax: number }).kMax });
    expect(each.reduce((s, b) => s + b.heightVar, 0)).toBeCloseTo(whole.heightVar, 5);
    expect(each.reduce((s, b) => s + b.slopeVar, 0)).toBeCloseTo(whole.slopeVar, 5);
    expect(windSeaBandStats(0, bands[0] as { kMin: number; kMax: number })).toEqual({ heightVar: 0, slopeVar: 0 });
  });
});

describe("the loop's worker", () => {
  it("answers a seed with the loop and its numbers, the buffer transferred", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("self", { postMessage });
    try {
      await import("../../src/game/oceanLoop.worker.js");
      const scope = (globalThis as unknown as { self: { onmessage: (event: { data: { seed: number } }) => void } }).self;
      scope.onmessage({ data: { seed: 7 } });
      expect(postMessage).toHaveBeenCalledTimes(1);
      const [reply, options] = postMessage.mock.calls[0] as [LoopReply, { transfer: ArrayBuffer[] }];
      expect(Object.keys(reply).sort()).toEqual(["data", "frames", "heightStd", "n", "seed", "size", "slopeVar"]);
      expect([reply.seed, reply.frames, reply.n, reply.size]).toEqual([7, LOOP_FRAMES, LOOP_N, LOOP_SIZE]);
      expect(reply.data.length).toBe(4_194_304);
      expect(reply.heightStd).toBeGreaterThan(0);
      expect(reply.slopeVar).toBeGreaterThan(0);
      const measured = loopStats(reply.data, 0);
      expect([reply.heightStd, reply.slopeVar]).toEqual([measured.heightStd, measured.slopeVar]);
      expect(options.transfer).toHaveLength(1);
      expect(options.transfer[0]).toBe(reply.data.buffer);
    } finally {
      vi.unstubAllGlobals();
    }
  }, timeLimit(60_000));
});
