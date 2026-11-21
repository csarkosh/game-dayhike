import { describe, it, expect, vi } from "vitest";
import { windSeaStateFor } from "@csarkosh/engine/game/oceanWindSea";
import {
  OCEAN_GPU_DEADLINE, OCEAN_GPU_FRAME_MAX, WIND_SEA_RESPECTRUM_U, cascadeStats, createWindSeaField, needsRespectrum,
  type WindSeaFftField, type WindSeaFieldMakers, type WindSeaLoopField,
} from "@csarkosh/engine/game/windSeaField";

const SEED = 0x5eed;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** An FFT that records what it is asked, its status the test's to set. */
function fakeFft(start: "compiling" | "running" | "failed" = "running") {
  let status = start;
  return {
    disp: "disp", slope: "slope",
    setSpectrum: vi.fn<WindSeaFftField<string>["setSpectrum"]>(),
    step: vi.fn<WindSeaFftField<string>["step"]>(),
    status: () => status,
    dispose: vi.fn<() => void>(),
    set(next: "compiling" | "running" | "failed"): void {
      status = next;
    },
  };
}

/** Makers whose loop lands when the test says and whose FFT is the one handed. */
function makers(fft: WindSeaFftField<string> | null | "none") {
  let land: ((loop: WindSeaLoopField<string>) => void) | null = null;
  const dropped: string[] = [];
  const made: WindSeaFieldMakers<string> = {
    loop: vi.fn(() => new Promise<WindSeaLoopField<string>>((resolve) => {
      land = resolve;
    })),
    fft: vi.fn(() => (fft === "none" ? Promise.reject(new Error("no compute")) : Promise.resolve(fft))),
    dropLoop: (texture) => void dropped.push(texture),
  };
  return { made, dropped, land: () => land?.({ texture: "loop", heightStd: 0.8, slopeVar: 0.03 }) };
}

const wind = (speed: number) => windSeaStateFor(speed, [1, 0], 12);

describe("which field draws the wind sea", () => {
  it("asks for nothing on the tier with no field, and draws none", async () => {
    const m = makers(null);
    const field = createWindSeaField(SEED, "low", m.made);
    await settle();
    field.update(wind(0.5), 1);
    expect(m.made.loop).not.toHaveBeenCalled();
    expect(m.made.fft).not.toHaveBeenCalled();
    expect([field.mode, field.disp, field.slope]).toEqual([0, null, null]);
  });

  it("draws the loop once its bake lands on the tier that bakes one, scaled to the sea's wind", async () => {
    const m = makers(null);
    const field = createWindSeaField(SEED, "medium", m.made);
    expect(m.made.loop).toHaveBeenCalledTimes(1);
    expect(m.made.fft).not.toHaveBeenCalled();
    field.update(wind(0.5), 1);
    expect(field.mode).toBe(0);
    m.land();
    await settle();
    const sea = field.update(wind(0.5), 2);
    expect([field.mode, field.disp, field.slope]).toEqual([1, "loop", null]);
    expect(field.stats[0]).toBeCloseTo(0.8 * sea.loopScale, 6);
    expect(field.stats.slice(1)).toEqual([0.03, 0, 0]);
    expect(field.loopTime).toBeGreaterThan(0);
  });

  it("draws the FFT once it runs, its spectrum rebuilt only when the sea's wind has moved by half a metre a second", async () => {
    expect(WIND_SEA_RESPECTRUM_U).toBe(0.5);
    expect(needsRespectrum(null, 3)).toBe(true);
    expect(needsRespectrum(3, 3.4)).toBe(false);
    expect(needsRespectrum(3, 3.5)).toBe(true);
    const fft = fakeFft("compiling");
    const m = makers(fft);
    const field = createWindSeaField(SEED, "high", m.made);
    await settle();
    const sea = field.update(wind(0.5), 1);
    expect(fft.setSpectrum).toHaveBeenCalledTimes(1);
    expect(fft.setSpectrum).toHaveBeenCalledWith({ u10: sea.u10, dir: [1, 0] }, SEED);
    expect(fft.step).toHaveBeenCalledWith(1);
    expect(field.mode).toBe(0);
    fft.set("running");
    field.update(wind(0.5), 1.1);
    expect([field.mode, field.disp, field.slope]).toEqual([2, "disp", "slope"]);
    expect(Array.from(field.stats)).toEqual(cascadeStats(sea.u10));
    expect(fft.setSpectrum).toHaveBeenCalledTimes(1);
    expect(m.made.loop).not.toHaveBeenCalled();
  });

  it("steps the FFT only on a frame that draws the sea", async () => {
    const fft = fakeFft();
    const field = createWindSeaField(SEED, "high", makers(fft).made);
    await settle();
    field.update(wind(0.5), 1, false);
    expect(fft.step).not.toHaveBeenCalled();
    field.update(wind(0.5), 1.1, true);
    expect(fft.step).toHaveBeenCalledTimes(1);
    field.update(wind(0.5), 1.2);
    expect(fft.step).toHaveBeenCalledTimes(2);
  });

  it("draws the loop where the FFT is not to be had, fails, or is still compiling past its deadline of drawn frames", async () => {
    const none = makers(null);
    createWindSeaField(SEED, "high", none.made);
    await settle();
    expect(none.made.loop).toHaveBeenCalledTimes(1);

    const refused = makers("none");
    createWindSeaField(SEED, "high", refused.made);
    await settle();
    expect(refused.made.loop).toHaveBeenCalledTimes(1);

    const failing = fakeFft("running");
    const failed = makers(failing);
    const field = createWindSeaField(SEED, "high", failed.made);
    await settle();
    field.update(wind(0.5), 1);
    expect(field.mode).toBe(2);
    failing.set("failed");
    field.update(wind(0.5), 1.1);
    expect(failing.dispose).toHaveBeenCalledTimes(1);
    expect(field.mode).toBe(0);
    failed.land();
    await settle();
    field.update(wind(0.5), 1.2);
    expect([field.mode, field.disp]).toEqual([1, "loop"]);

    const slow = fakeFft("compiling");
    const late = makers(slow);
    const waiting = createWindSeaField(SEED, "high", late.made);
    await settle();
    let seconds = 0;
    const frames = Math.ceil(OCEAN_GPU_DEADLINE / OCEAN_GPU_FRAME_MAX);
    // Frames that do not draw the sea count nothing toward the deadline.
    for (let i = 0; i < frames + 4; i++) waiting.update(wind(0.5), (seconds += 1), false);
    expect(late.made.loop).not.toHaveBeenCalled();
    for (let i = 0; i < frames; i++) waiting.update(wind(0.5), (seconds += 1), true);
    expect(late.made.loop).not.toHaveBeenCalled();
    waiting.update(wind(0.5), (seconds += 1), true);
    expect(late.made.loop).toHaveBeenCalledTimes(1);
    expect(slow.dispose).toHaveBeenCalledTimes(1);
  });

  it("lets go of what it holds, and of a loop that lands after it has gone", async () => {
    const fft = fakeFft();
    const m = makers(fft);
    const field = createWindSeaField(SEED, "high", m.made);
    await settle();
    field.update(wind(0.5), 1);
    field.dispose();
    expect(fft.dispose).toHaveBeenCalledTimes(1);
    expect([field.mode, field.disp, field.slope]).toEqual([0, null, null]);

    const late = makers(null);
    const gone = createWindSeaField(SEED, "medium", late.made);
    gone.dispose();
    late.land();
    await settle();
    expect(late.dropped).toEqual(["loop"]);
    expect(gone.mode).toBe(0);
  });
});
