import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import {
  PROBE_MAX_MS,
  PROBE_MAX_STALLS,
  PROBE_READY_MAX_MS,
  PROBE_STEP_BUDGET_MS,
  START_FAILED_LINE,
  stepReadyMaxMs,
  autoPick,
  createProbeMeter,
  cutVerdict,
  idleCadenceMs,
  startFallbacks,
  startHike,
  nextProbeStep,
  probeHolds,
  probeStepCanSettle,
  probeStepEngine,
  WEBGPU_PROBE_STEPS_SETTLE,
  probePose,
  probeReadingLine,
  readEarlyMiss,
  readIntervals,
  readStallMiss,
  runProbe,
  startupTier,
  qualityLine,
  launchLine,
  LOADING_LINE,
  type StartupDeps,
} from "../../src/game/frameProbe.js";
import type { GpuSignals } from "../../src/game/gpuSignals.js";
import { WEBGPU_TIERS } from "../../src/game/engineChoice.js";
import { landingModel } from "../../src/game/landingModel.js";
import { autoTier, withGovernorDrop, type ProbeReading, type QualityTier, type VerdictEngine } from "../../src/game/quality.js";
import { readAutoRecord, writeAutoRecord } from "../../src/game/tierChoice.js";

const f = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);
const reading = (tier: QualityTier, meanMs: number): ProbeReading =>
  ({ tier, frames: 120, meanMs, p95Ms: meanMs, pixels: 2_073_600, engine: "webgl2" });

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

function throwingStorage(): Storage {
  const fail = () => { throw new Error("SecurityError"); };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

describe("readIntervals", () => {
  it("reads a steady 60 Hz run as capped at the budget", () => {
    const s = readIntervals(f(120, 16.667))!;
    expect(s.frames).toBe(120);
    expect(s.meanMs).toBeCloseTo(16.667, 3);
    expect(s.p95Ms).toBeCloseTo(16.667, 3);
  });

  it("reads missed vsyncs as the mean they make", () => {
    const run = Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 16.667 : 33.333));
    const s = readIntervals(run)!;
    expect(s.meanMs).toBeCloseTo(25, 3);
    expect(s.p95Ms).toBeCloseTo(33.333, 3);
  });

  it("drops stalls over 250 ms, and reads nothing from fewer than 100 frames", () => {
    expect(readIntervals([...f(100, 16.667), ...f(20, 400)])!.frames).toBe(100);
    expect(readIntervals([...f(100, 16.667), ...f(20, 400)])!.meanMs).toBeCloseTo(16.667, 3);
    expect(readIntervals([...f(99, 16.667), ...f(21, 400)])).toBe(null);
    expect(readIntervals([...f(119, 16.667), 250])!.frames).toBe(120);
  });

  it("drops intervals that are not a time", () => {
    expect(readIntervals([...f(100, 16.667), Number.NaN, -1, Number.POSITIVE_INFINITY])!.frames).toBe(100);
  });
});

describe("readEarlyMiss", () => {
  it("reads a miss once the kept intervals sum past 2,100 ms, from the frames measured", () => {
    expect(PROBE_STEP_BUDGET_MS).toBe(2100);
    expect(readEarlyMiss(f(9, 240))).toEqual({ frames: 9, meanMs: 240, p95Ms: 240, early: true });
    expect(readEarlyMiss(f(21, 100))).toBe(null);
    expect(readEarlyMiss(f(22, 100))).toEqual({ frames: 22, meanMs: 100, p95Ms: 100, early: true });
  });

  it("counts no stall toward the sum, so at most 250 ms a frame it needs 9 frames", () => {
    expect(readEarlyMiss(f(8, 250))).toBe(null);
    expect(readEarlyMiss([...f(8, 250), 400, 400, 400])).toBe(null);
    expect(readEarlyMiss([...f(8, 250), 400, 101])).toEqual({ frames: 9, meanMs: 2101 / 9, p95Ms: 250, early: true });
  });
});

describe("readStallMiss", () => {
  it("reads a miss once more than 20 intervals are over 250 ms, from every interval measured", () => {
    expect(PROBE_MAX_STALLS).toBe(20);
    expect(readStallMiss(f(20, 300))).toBe(null);
    expect(readStallMiss(f(21, 300))).toEqual({ frames: 21, meanMs: 300, p95Ms: 300, stalls: 21 });
    expect(readStallMiss([...f(50, 16), ...f(21, 400)])).toEqual({ frames: 71, meanMs: 9200 / 71, p95Ms: 400, stalls: 21 });
    expect(readStallMiss([...f(99, 16.667), ...f(20, 400)])).toBe(null);
  });
});

describe("probeHolds", () => {
  it("holds at or under 17.5 ms", () => {
    expect(probeHolds({ meanMs: 16.667 })).toBe(true);
    expect(probeHolds({ meanMs: 17.5 })).toBe(true);
    expect(probeHolds({ meanMs: 17.51 })).toBe(false);
  });
});

describe("nextProbeStep", () => {
  it("measures the ceiling, keeps a hold, steps once from high, and floors at low", () => {
    expect(nextProbeStep("high", [])).toEqual({ measure: "high" });
    expect(nextProbeStep("high", [reading("high", 16.7)])).toEqual({ verdict: "high" });
    expect(nextProbeStep("high", [reading("high", 23.96)])).toEqual({ measure: "medium" });
    expect(nextProbeStep("high", [reading("high", 23.96), reading("medium", 16.7)])).toEqual({ verdict: "medium" });
    expect(nextProbeStep("high", [reading("high", 23.96), reading("medium", 19)])).toEqual({ verdict: "low" });
    expect(nextProbeStep("medium", [])).toEqual({ measure: "medium" });
    expect(nextProbeStep("medium", [reading("medium", 19)])).toEqual({ verdict: "low" });
  });

  it("never measures low, and never steps up from a capped reading", () => {
    expect(nextProbeStep("low", [])).toEqual({ verdict: "low" });
    expect(nextProbeStep("medium", [reading("medium", 8.3)])).toEqual({ verdict: "medium" });
  });
});

describe("probeStepCanSettle", () => {
  it("settles a WebGL2 step only where programs link off the page's thread, and a WebGPU step not until it is measured to", () => {
    // Babylon translates a WebGPU effect's shaders on the page's thread
    // (glslang, then Tint) and makes each pipeline at its first draw, so a
    // WebGPU step is no quieter than a WebGL2 one without the extension.
    const table = [
      { parallelCompile: true, engine: "webgl2", settles: true },
      { parallelCompile: false, engine: "webgl2", settles: false },
      { parallelCompile: null, engine: "webgl2", settles: false },
      { parallelCompile: true, engine: "webgpu", settles: false },
      { parallelCompile: false, engine: "webgpu", settles: false },
      { parallelCompile: null, engine: "webgpu", settles: false },
    ] as const;
    for (const row of table) expect(probeStepCanSettle(row.parallelCompile, row.engine)).toBe(row.settles);
  });

  it("settles a WebGPU step once one is measured to, Firefox's too, and an engine not known only where both engines settle", () => {
    // The safe value until a browser measures a WebGPU step's settling.
    expect(WEBGPU_PROBE_STEPS_SETTLE).toBe(false);
    // With that measurement in, Firefox without the extension probes its
    // WebGPU steps and still not its WebGL2 ones.
    expect(probeStepCanSettle(false, "webgpu", true)).toBe(true);
    expect(probeStepCanSettle(false, "webgl2", true)).toBe(false);
    expect(probeStepCanSettle(false, null, true)).toBe(false);
    expect(probeStepCanSettle(true, null, true)).toBe(true);
    expect(probeStepCanSettle(true, null, false)).toBe(false);
  });

  it("measures on WebGL2 while a WebGPU step cannot settle, whatever the rule gives the probed tiers", () => {
    expect(probeStepEngine({ adapterStatus: "ok" }, "webgpu")).toBe("webgl2");
    expect(probeStepEngine({ adapterStatus: "timed-out" }, "webgpu")).toBe("webgl2");
    expect(probeStepEngine({ adapterStatus: "timed-out" }, "webgl2")).toBe("webgl2");
    expect(probeStepEngine({ adapterStatus: "ok" }, undefined)).toBe("webgl2");
    // Once a WebGPU step is measured to settle, the steps draw on the rule's
    // engine again, and on either while the adapter has not answered.
    expect(probeStepEngine({ adapterStatus: "ok" }, "webgpu", true)).toBe("webgpu");
    expect(probeStepEngine({ adapterStatus: "timed-out" }, "webgpu", true)).toBe(null);
    expect(probeStepEngine({ adapterStatus: "ok" }, "webgl2", true)).toBe("webgl2");
    // The probed tiers share the rule's engine, so the first step's answer is
    // the second's; a step that ends on another engine is asked as it runs
    // (`measureOnRuleEngine`).
    expect(WEBGPU_TIERS).toEqual(["high", "medium"]);
  });
});

describe("probePose", () => {
  it("is every rendering note's canopy pose, the eye 1.6 m over the ground", () => {
    const p = probePose();
    expect(p.x).toBe(123);
    expect(p.z).toBe(-105.5);
    expect(p.y).toBeCloseTo(110.87, 2);
    expect(p.yaw).toBe(1.571);
    expect(p.pitch).toBe(0.3);
  });
});

describe("probeReadingLine", () => {
  it("names the tier, the mean, the p95, the frames, the window, the engine and the answer", () => {
    expect(probeReadingLine({ tier: "high", frames: 120, meanMs: 23.96, p95Ms: 33.4, pixels: 2_073_600, engine: "webgl2" }, 1920, 1080))
      .toBe("quality probe: high 23.96 ms mean, 33.4 p95, 120 frames, 1920×1080, webgl2 → misses");
    expect(probeReadingLine({ tier: "medium", frames: 118, meanMs: 16.667, p95Ms: 16.9, pixels: 1_405_320, engine: "webgl2" }, 1470, 956))
      .toBe("quality probe: medium 16.67 ms mean, 16.9 p95, 118 frames, 1470×956, webgl2 → holds");
    expect(probeReadingLine({ tier: "high", frames: 22, meanMs: 100, p95Ms: 100, pixels: 1_045_960, engine: "webgl2", early: true }, 1324, 790))
      .toBe("quality probe: high 100.00 ms mean, 100 p95, 22 frames (ended early), 1324×790, webgl2 → misses");
    expect(probeReadingLine({ tier: "high", frames: 21, meanMs: 300, p95Ms: 300, pixels: 1_045_960, engine: "webgl2", stalls: 21 }, 1324, 790))
      .toBe("quality probe: high 300.00 ms mean, 300 p95, 21 frames (21 over 250 ms), 1324×790, webgl2 → misses");
  });
});

describe("runProbe and the Auto record", () => {
  const KEY = { gpu: "Apple GPU", browser: 26, cls: "apple-unknown" } as const;

  it("never probes where the attempt cannot be written", async () => {
    let steps = 0;
    const deps = { storage: throwingStorage(), runStep: async () => { steps += 1; return null; }, pixels: () => 2_073_600, now: () => 1_790_000_000_000 };
    expect(await runProbe("high", "medium", null, KEY, deps)).toBe("medium");
    expect(steps).toBe(0);
  });

  it("writes the attempt before the first step starts", () => {
    const s = memoryStorage();
    const deps = { storage: s, runStep: () => new Promise<ProbeReading | null>(() => undefined), pixels: () => 2_073_600, now: () => 1_790_000_000_000 };
    void runProbe("high", "medium", null, KEY, deps);
    expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null });
  });

  it("never probes a window with no area, and writes nothing for one", async () => {
    const s = memoryStorage();
    let steps = 0;
    const deps = { storage: s, runStep: async () => { steps += 1; return reading("high", 16.7); }, pixels: () => 0, now: () => 1_790_000_000_000 };
    expect(await runProbe("high", "medium", null, KEY, deps)).toBe("medium");
    expect(steps).toBe(0);
    expect(readAutoRecord(s)).toBe(null);
  });

  it("writes the verdict with the window the steps measured", async () => {
    const s = memoryStorage();
    const deps = { storage: s, runStep: async (tier: QualityTier) => reading(tier, tier === "high" ? 23.96 : 16.7), pixels: () => 2_073_600, now: () => 1_790_000_000_000 };
    expect(await runProbe("high", "medium", null, KEY, deps)).toBe("medium");
    expect(readAutoRecord(s)!.verdict).toEqual({ tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000,
      readings: [reading("high", 23.96), reading("medium", 16.7)] });
    expect(readAutoRecord(s)!.attempts).toBe(0);
  });

  it("abandons on a step that reads nothing or throws, the attempt standing", async () => {
    for (const runStep of [async () => null, async () => { throw new Error("context lost"); }]) {
      const s = memoryStorage();
      expect(await runProbe("high", "medium", null, KEY, { storage: s, runStep, pixels: () => 2_073_600, now: () => 1_790_000_000_000 })).toBe("medium");
      expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null });
    }
  });

  it("keeps what a miss taught when a later step reads nothing: the tier below, never above the start", async () => {
    for (const runStep of [
      async (tier: QualityTier) => (tier === "high" ? reading("high", 34.3) : null),
      async (tier: QualityTier) => {
        if (tier === "high") return reading("high", 34.3);
        throw new Error("context lost");
      },
    ]) {
      const s = memoryStorage();
      expect(await runProbe("high", "medium", null, KEY, { storage: s, runStep, pixels: () => 2_073_600, now: () => 1_790_000_000_000 })).toBe("medium");
      // The verdict of a probe cut short keeps the attempt it spent.
      expect(readAutoRecord(s)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1,
        verdict: { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000, readings: [reading("high", 34.3)] } });
    }
    // A class that starts at low keeps low, not the medium below the miss.
    const s = memoryStorage();
    const runStep = async (tier: QualityTier) => (tier === "high" ? reading("high", 34.3) : null);
    expect(await runProbe("high", "low", null, KEY, { storage: s, runStep, pixels: () => 2_073_600, now: () => 1_790_000_000_000 })).toBe("low");
    expect(readAutoRecord(s)!.verdict!.tier).toBe("low");
  });

  it("counts a second attempt on the record of the first", async () => {
    const s = memoryStorage();
    const first = { v: 1, gpu: "Apple GPU", cls: "apple-unknown" as const, browser: 26, attempts: 1, verdict: null };
    await runProbe("high", "medium", first, KEY, { storage: s, runStep: async () => null, pixels: () => 2_073_600, now: () => 1_790_000_000_000 });
    expect(readAutoRecord(s)!.attempts).toBe(2);
  });
});

describe("cutVerdict", () => {
  it("is the tier below the last miss, never above the start, and nothing without a reading", () => {
    expect(cutVerdict([reading("high", 34.3)], "medium")).toBe("medium");
    expect(cutVerdict([reading("high", 34.3)], "low")).toBe("low");
    expect(cutVerdict([reading("medium", 19)], "medium")).toBe("low");
    expect(cutVerdict([], "medium")).toBe(null);
  });
});

describe("startupTier", () => {
  const SAFARI: GpuSignals = {
    renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
  };
  const M4: GpuSignals = {
    renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)",
    adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 10, memoryGb: 16, mobile: false, browser: 153,
  };

  /** Fakes for the page: steps answer from `answers`, the timer fires when told,
   * the page is visible and draws at 60 Hz unless told otherwise. */
  function fakes(
    answers: (tier: QualityTier) => ProbeReading | null,
    storage: Storage = memoryStorage(),
    page: { cadence?: number | null; visible?: () => Promise<boolean> } = {},
  ) {
    const steps: QualityTier[] = [];
    const lines: string[] = [];
    let screens = 0;
    let open = 0;
    let waits = 0;
    let timer: { fn: () => void; ms: number } | null = null;
    const deps: StartupDeps = {
      storage,
      pixels: () => 2_073_600,
      now: () => 1_790_000_000_000,
      runStep: async (tier, cancelled) => {
        steps.push(tier);
        const answer = answers(tier);
        return cancelled() ? null : answer;
      },
      showScreen: () => {
        screens += 1;
        open += 1;
        return { dispose: () => { open -= 1; } };
      },
      setTimer: (fn, ms) => {
        timer = { fn, ms };
        return () => { timer = null; };
      },
      whenVisible: () => {
        waits += 1;
        return (page.visible ?? (async () => true))();
      },
      idleCadence: async () => {
        waits += 1;
        return page.cadence === undefined ? 16.7 : page.cadence;
      },
      log: (line) => void lines.push(line),
    };
    return { deps, storage, steps, lines, screens: () => screens, open: () => open, timer: () => timer, waits: () => waits };
  }
  const page = (search = "", choice: "auto" | QualityTier = "auto") => ({ search, choice, cancelled: () => false });

  it("probes a probed class from its ceiling behind the screen, and starts at the verdict", async () => {
    const t = fakes((tier) => reading(tier, tier === "high" ? 23.96 : 16.7));
    expect(await startupTier(SAFARI, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(t.steps).toEqual(["high", "medium"]);
    expect(t.screens()).toBe(1);
    expect(t.open()).toBe(0);
    expect(t.timer()).toBe(null);
    // The tier's own line is the launch's, once the engine is known (`qualityLine`).
    expect(t.lines).toEqual(["quality probe: verdict medium (apple-unknown)"]);
    expect(readAutoRecord(t.storage)!.verdict!.tier).toBe("medium");
  });

  it("does not probe again once the verdict holds", async () => {
    const t = fakes((tier) => reading(tier, 16.7));
    await startupTier(SAFARI, page(), t.deps);
    const again = fakes(() => reading("high", 16.7), t.storage);
    expect(await startupTier(SAFARI, page(), again.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(again.steps).toEqual([]);
    expect(again.screens()).toBe(0);
  });

  it("starts a named class at its tier with no probe", async () => {
    const t = fakes(() => reading("high", 16.7));
    expect(await startupTier(M4, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-base" });
    expect(t.steps).toEqual([]);
    expect(t.lines).toEqual([]);
  });

  it("probes any class from ?probe=, and never under ?tier=", async () => {
    const forced = fakes((tier) => reading(tier, 23.96));
    expect(await startupTier(M4, page("?probe=high"), forced.deps)).toEqual({ tier: "low", source: "auto", cls: "apple-base" });
    expect(forced.steps).toEqual(["high", "medium"]);
    const capped = fakes((tier) => reading(tier, 16.7));
    expect(await startupTier(M4, page("?probe=high"), capped.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-base" });
    expect(capped.lines[0]).toBe("quality probe: verdict high (apple-base)");
    const overridden = fakes(() => reading("high", 16.7));
    expect(await startupTier(SAFARI, page("?tier=low&probe=high"), overridden.deps)).toEqual({ tier: "low", source: "override", cls: "apple-unknown" });
    expect(overridden.steps).toEqual([]);
    expect(overridden.screens()).toBe(0);
  });

  it("gives up at 30 s: the class's start tier, the attempt spent, the screen gone", async () => {
    let t: ReturnType<typeof fakes> | null = null;
    t = fakes((tier) => {
      t!.timer()!.fn();
      return reading(tier, 16.7);
    });
    expect(await startupTier(SAFARI, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(t.open()).toBe(0);
    expect(readAutoRecord(t.storage)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null });
    expect(t.lines[0]).toBe("quality probe: no verdict; starting at medium (apple-unknown)");
    expect(PROBE_MAX_MS).toBe(30_000);
  });

  it("keeps the miss when the 30 s cap cuts the second step, and does not probe again", async () => {
    let t: ReturnType<typeof fakes> | null = null;
    t = fakes((tier) => {
      if (tier === "medium") t!.timer()!.fn();
      return reading(tier, 34.3);
    });
    expect(await startupTier(SAFARI, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(t.steps).toEqual(["high", "medium"]);
    expect(t.open()).toBe(0);
    expect(t.lines[0]).toBe("quality probe: cut short after high missed, verdict medium; starting at medium (apple-unknown)");
    expect(readAutoRecord(t.storage)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1,
      verdict: { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000, readings: [reading("high", 34.3)] } });
    const next = fakes((tier) => reading(tier, 34.3), t.storage);
    expect(await startupTier(SAFARI, page(), next.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(next.steps).toEqual([]);
  });

  it("stops at once when the page moves on", async () => {
    let left = false;
    const t = fakes((tier) => {
      left = true;
      return reading(tier, 16.7);
    });
    await startupTier(SAFARI, { search: "", choice: "auto", cancelled: () => left }, t.deps);
    expect(t.steps).toEqual(["high"]);
    expect(t.open()).toBe(0);
  });

  it("probes a GPU whose class alternates a bounded number of times, verdicts or none", async () => {
    // An unnamed renderer: its adapter classes it `integrated-unknown` on the
    // loads where it answers in time, and it is `unknown` on the others. Each
    // class ignores the other's verdict; the attempts carry across both.
    const gpu = "ANGLE (Intel, Intel(R) Graphics (0x00007D67) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    const answered: GpuSignals = {
      renderer: gpu, adapter: { vendor: "intel", architecture: "gen-12lp", device: "", description: "", isFallbackAdapter: false },
      limits: {}, features: [], adapterStatus: "ok", parallelCompile: true, cores: 8, memoryGb: 16, mobile: false, browser: 153,
    };
    const late: GpuSignals = { ...answered, adapter: null, limits: null, features: null, adapterStatus: "timed-out" };
    async function alternate(answer: (tier: QualityTier) => ProbeReading | null): Promise<boolean[]> {
      const s = memoryStorage();
      const probed: boolean[] = [];
      for (let load = 0; load < 8; load++) {
        const t = fakes(answer, s);
        await startupTier(load % 2 === 0 ? answered : late, page(), t.deps);
        probed.push(t.steps.length > 0);
      }
      return probed;
    }
    expect(await alternate((tier) => reading(tier, 16.7))).toEqual([true, true, true, true, false, false, false, false]);
    expect(await alternate(() => null)).toEqual([true, true, true, false, false, false, false, false]);
  });

  it("builds a chosen tier with no probe, and puts ?tier= over the choice", async () => {
    const chosen = fakes(() => reading("high", 16.7));
    expect(await startupTier(SAFARI, page("", "low"), chosen.deps)).toEqual({ tier: "low", source: "choice", cls: "apple-unknown" });
    expect(await startupTier(SAFARI, page("?probe=high", "high"), chosen.deps)).toEqual({ tier: "high", source: "choice", cls: "apple-unknown" });
    expect(chosen.steps).toEqual([]);
    expect(chosen.lines).toEqual([]);
    const overridden = fakes(() => reading("high", 16.7));
    expect(await startupTier(SAFARI, page("?tier=medium", "low"), overridden.deps)).toEqual({ tier: "medium", source: "override", cls: "apple-unknown" });
  });

  it("never probes where the display or the browser draws below 60 Hz, and writes nothing", async () => {
    // Safari halves its frame rate in Low Power Mode and when the Mac runs
    // hot: every tier would read 33 ms, and low would be kept for 30 days.
    const throttled = fakes((tier) => reading(tier, 33.3), memoryStorage(), { cadence: 33.3 });
    expect(await startupTier(SAFARI, page(), throttled.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(throttled.steps).toEqual([]);
    expect(readAutoRecord(throttled.storage)).toBe(null);
    expect(throttled.open()).toBe(0);
    expect(throttled.lines[0]).toBe("quality probe: skipped, the page draws below 60 Hz (33.3 ms a frame); starting at medium (apple-unknown)");
    const unread = fakes((tier) => reading(tier, 16.7), memoryStorage(), { cadence: null });
    expect(await startupTier(SAFARI, page(), unread.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(unread.steps).toEqual([]);
    expect(readAutoRecord(unread.storage)).toBe(null);
    const smooth = fakes((tier) => reading(tier, 16.7), memoryStorage(), { cadence: 16.7 });
    expect(await startupTier(SAFARI, page(), smooth.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(smooth.steps).toEqual(["high"]);
  });

  it("waits for the tab to be seen before it spends an attempt, and spends none if the page leaves first", async () => {
    let show: (seen: boolean) => void = () => undefined;
    const hidden = fakes((tier) => reading(tier, 16.7), memoryStorage(), { visible: () => new Promise((resolve) => { show = resolve; }) });
    const pending = startupTier(SAFARI, page(), hidden.deps);
    await Promise.resolve();
    expect(readAutoRecord(hidden.storage)).toBe(null);
    expect(hidden.timer()).toBe(null);
    show(true);
    expect(await pending).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(readAutoRecord(hidden.storage)!.attempts).toBe(0);
    const left = fakes((tier) => reading(tier, 16.7), memoryStorage(), { visible: async () => false });
    expect(await startupTier(SAFARI, page(), left.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(left.steps).toEqual([]);
    expect(readAutoRecord(left.storage)).toBe(null);
    expect(left.open()).toBe(0);
  });

  // Firefox 156 on an Apple M4: no KHR_parallel_shader_compile, so a step
  // never sees 1.5 s without a compile inside its 15 s.
  const FIREFOX: GpuSignals = {
    renderer: "Apple M1, or similar", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: false,
    cores: 10, memoryGb: null, mobile: false, browser: 156,
  };
  const contents = (s: Storage): string => JSON.stringify(Array.from({ length: s.length }, (_, i) => [s.key(i), s.getItem(s.key(i)!)]));

  it("skips the probe where shaders compile on the page's thread: no screen, no wait, nothing written", async () => {
    const earlier = memoryStorage();
    writeAutoRecord(earlier, { v: 1, gpu: "Apple M1, or similar", cls: "apple-unknown", browser: 156, attempts: 2, verdict: null });
    for (const storage of [memoryStorage(), earlier]) {
      const before = contents(storage);
      const t = fakes((tier) => reading(tier, 16.7), storage);
      expect(await startupTier(FIREFOX, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
      expect(t.screens()).toBe(0);
      expect(t.waits()).toBe(0);
      expect(t.steps).toEqual([]);
      expect(t.timer()).toBe(null);
      expect(contents(storage)).toBe(before);
      expect(t.lines).toEqual([
        "quality probe: skipped, this browser compiles shaders on the page's thread; starting at medium (apple-unknown)",
      ]);
    }
    expect(readAutoRecord(earlier)!.attempts).toBe(2);
  });

  it("probes tiers that draw on WebGPU on WebGL2, and the verdict holds for WebGPU", async () => {
    const storage = memoryStorage();
    const t = fakes((tier) => reading(tier, 16.7), storage);
    expect(await startupTier(SAFARI, { ...page(), engine: "webgpu" }, t.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(t.screens()).toBe(1);
    expect(t.steps).toEqual(["high"]);
    expect(t.lines).toEqual(["quality probe: verdict high (apple-unknown)"]);
    // A WebGL2 verdict, read for a WebGPU start: no second probe.
    expect(readAutoRecord(storage)!.verdict).not.toHaveProperty("engine");
    expect(readAutoRecord(storage)!.attempts).toBe(0);
    const again = fakes((tier) => reading(tier, 16.7), storage);
    expect(await startupTier(SAFARI, { ...page(), engine: "webgpu" }, again.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(again.screens()).toBe(0);
  });

  it("shows the probe's screen exactly where Settings says a probe is pending, for each engine a step may draw with", async () => {
    const cases: [string, GpuSignals, VerdictEngine][] = [
      ["WebGL2, linked in parallel", SAFARI, "webgl2"],
      ["WebGL2, linked on the page's thread", FIREFOX, "webgl2"],
      ["WebGPU, the adapter known", SAFARI, "webgpu"],
      ["WebGPU without the WebGL2 extension", FIREFOX, "webgpu"],
      ["WebGPU, the adapter not known yet", { ...SAFARI, adapterStatus: "timed-out" }, "webgpu"],
      ["WebGPU, a WebGL2 verdict holding", SAFARI, "webgpu"],
    ];
    const seen: [string, boolean, boolean][] = [];
    for (const [name, signals, engine] of cases) {
      // The last case holds a WebGL2 verdict of the tier detection release's shape.
      const storage = memoryStorage();
      if (name === "WebGPU, a WebGL2 verdict holding") {
        writeAutoRecord(storage, {
          v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0,
          verdict: { tier: "high", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000 - 86_400_000 },
        });
      }
      const t = fakes((tier) => reading(tier, 16.7), storage);
      // The page's summary for Settings (`autoSummary` in main.ts).
      const record = readAutoRecord(storage);
      const pending = autoPick(signals, { record, pixels: 2_073_600, now: 1_790_000_000_000, engine }).probeFrom !== null;
      await startupTier(signals, { ...page(), engine }, t.deps);
      seen.push([name, pending, t.screens() === 1]);
    }
    expect(seen).toEqual([
      ["WebGL2, linked in parallel", true, true],
      ["WebGL2, linked on the page's thread", false, false],
      ["WebGPU, the adapter known", true, true],
      ["WebGPU without the WebGL2 extension", false, false],
      ["WebGPU, the adapter not known yet", true, true],
      ["WebGPU, a WebGL2 verdict holding", false, false],
    ]);
  });

  it("says the probe is skipped for want of a WebGL2 context where none could be made", async () => {
    const storage = memoryStorage();
    const t = fakes((tier) => reading(tier, 16.7), storage);
    expect(await startupTier({ ...FIREFOX, parallelCompile: null }, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(t.screens()).toBe(0);
    expect(t.waits()).toBe(0);
    expect(t.steps).toEqual([]);
    expect(contents(storage)).toBe("[]");
    expect(t.lines).toEqual([
      "quality probe: skipped, no WebGL2 context could be made to measure with; starting at medium (apple-unknown)",
    ]);
  });

  it("still honours a holding verdict where shaders compile on the page's thread", async () => {
    const s = memoryStorage();
    writeAutoRecord(s, {
      v: 1, gpu: "Apple M1, or similar", cls: "apple-unknown", browser: 156, attempts: 0,
      verdict: { tier: "high", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000 - 86_400_000 },
    });
    const t = fakes((tier) => reading(tier, 16.7), s);
    expect(await startupTier(FIREFOX, page(), t.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(t.screens()).toBe(0);
    // The tier's own line is the launch's, once the engine is known.
    expect(t.lines).toEqual([]);
  });

  it("still probes from ?probe= where shaders compile on the page's thread", async () => {
    const t = fakes((tier) => reading(tier, 16.7));
    expect(await startupTier(FIREFOX, page("?probe=high"), t.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(t.steps).toEqual(["high"]);
    expect(t.screens()).toBe(1);
    expect(t.lines).toEqual(["quality probe: verdict high (apple-unknown)"]);
    expect(readAutoRecord(t.storage)!.verdict!.tier).toBe("high");
  });

  it("probes as before where the browser links shaders off the page's thread", async () => {
    const attempts: number[] = [];
    const t = fakes((tier) => {
      attempts.push(readAutoRecord(t.storage)!.attempts);
      return reading(tier, 16.7);
    });
    expect(await startupTier({ ...FIREFOX, parallelCompile: true }, page(), t.deps)).toEqual({ tier: "high", source: "auto", cls: "apple-unknown" });
    expect(t.screens()).toBe(1);
    expect(t.waits()).toBe(2);
    expect(t.steps).toEqual(["high"]);
    expect(attempts).toEqual([1]);
    expect(readAutoRecord(t.storage)!.verdict!.tier).toBe("high");
    expect(t.lines).toEqual(["quality probe: verdict high (apple-unknown)"]);
  });

  it("stops probing after three attempts without a verdict", async () => {
    const s = memoryStorage();
    writeAutoRecord(s, { v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 3, verdict: null });
    const t = fakes(() => reading("high", 16.7), s);
    expect(await startupTier(SAFARI, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(t.steps).toEqual([]);
  });
});

describe("autoPick", () => {
  it("asks whether the probe's first step can settle on the engine it will draw with", () => {
    const signals = (parallelCompile: boolean | null, adapterStatus: GpuSignals["adapterStatus"]): GpuSignals => ({
      renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus, parallelCompile, cores: 8, memoryGb: null, mobile: false, browser: 26,
    });
    const probe = (read: GpuSignals, engine: "webgl2" | "webgpu") => {
      const pick = autoPick(read, { record: null, pixels: 2_073_600, now: 1_790_000_000_000, engine });
      return { probeFrom: pick.probeFrom, probeSkipped: pick.probeSkipped };
    };
    const probed = { probeFrom: "high", probeSkipped: false };
    const skipped = { probeFrom: null, probeSkipped: true };
    // WebGL2 steps, as with the switch off: the tier detection branch's rule.
    expect(probe(signals(true, "none"), "webgl2")).toEqual(probed);
    expect(probe(signals(false, "none"), "webgl2")).toEqual(skipped);
    // Tiers that draw on WebGPU, whose steps cannot settle there: measured on
    // WebGL2 where a WebGL2 step can settle, the adapter known or not.
    expect(probe(signals(true, "none"), "webgpu")).toEqual(probed);
    expect(probe(signals(true, "timed-out"), "webgpu")).toEqual(probed);
    // Where WebGL2 cannot settle either (Firefox): skipped.
    expect(probe(signals(false, "none"), "webgpu")).toEqual(skipped);
    expect(probe(signals(false, "timed-out"), "webgpu")).toEqual(skipped);
  });

  it("is Auto's tier and whether it will probe, before any hike", () => {
    const signals: GpuSignals = {
      renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
    };
    expect(autoPick(signals, { record: null, pixels: 2_073_600, now: 1_790_000_000_000 })).toEqual({
      cls: "apple-unknown", gpu: "Apple GPU", tier: "medium", probeFrom: "high", probeSkipped: false, ceiling: "high",
    });
    expect(autoPick({ ...signals, parallelCompile: false }, { record: null, pixels: 2_073_600, now: 1_790_000_000_000 })).toEqual({
      cls: "apple-unknown", gpu: "Apple GPU", tier: "medium", probeFrom: null, probeSkipped: true, ceiling: "high",
    });
    expect(autoPick({ ...signals, cores: 2 }, { record: null, pixels: 2_073_600, now: 1_790_000_000_000 }).ceiling).toBe("low");
  });
});

describe("idleCadenceMs", () => {
  it("is the median interval of an idle run, the first dropped", () => {
    expect(idleCadenceMs([400, ...f(30, 16.7)])).toBeCloseTo(16.7, 6);
    expect(idleCadenceMs([16.7, ...f(30, 33.3)])).toBeCloseTo(33.3, 6);
    expect(idleCadenceMs([16.7, ...f(29, 16.7), 120])).toBeCloseTo(16.7, 6);
  });

  it("reads nothing from a run too short or all stalls", () => {
    expect(idleCadenceMs(f(10, 16.7))).toBe(null);
    expect(idleCadenceMs([16.7, ...f(30, 300)])).toBe(null);
  });
});

describe("createProbeMeter", () => {
  /** Frames at `ms` until the meter answers, from `t`; returns the answer and the frames it took. */
  function run(meter: ReturnType<typeof createProbeMeter>, t: { now: number }, ms: number, limit = 1000) {
    for (let n = 1; n <= limit; n++) {
      t.now += ms;
      const step = meter.frame(t.now, true);
      if (step.done) return { stats: step.stats, frames: n };
    }
    return { stats: undefined, frames: limit };
  }

  it("waits for the scene to be quiet, discards the warm-up, and measures 120 frames", () => {
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    const got = run(meter, t, 16.667);
    // 1.5 s of quiet (90 frames, the last of which reads ready), 60 warm, 120 measured.
    expect(got.frames).toBe(90 + 60 + 120);
    expect(got.stats!.frames).toBe(120);
    expect(got.stats!.meanMs).toBeCloseTo(16.667, 3);
  });

  it("restarts the warm-up when a shader compiles after the scene is ready, so its hitch is never measured", () => {
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    for (let n = 0; n < 90 + 60 + 50; n++) {
      t.now += 16.667;
      expect(meter.frame(t.now, true).done).toBe(false);
    }
    meter.compiled(t.now + 1);
    t.now += 200;
    expect(meter.frame(t.now, true).done).toBe(false);
    const got = run(meter, t, 16.667);
    expect(got.frames).toBe(59 + 120);
    expect(got.stats!.meanMs).toBeCloseTo(16.667, 3);
    expect(got.stats!.p95Ms).toBeCloseTo(16.667, 3);
  });

  it("ends a slow step as a miss at 2,100 ms of measured frames, its warm-up bounded by the same", () => {
    // 100 ms a frame: ready at 1.5 s (15 frames); the warm-up ends 2,100 ms
    // after it began (20 frames, not 60); the 22nd measured interval takes the
    // sum past 2,100 ms. Before, this step took 15 + 60 + 120 frames, 19.5 s.
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    const got = run(meter, t, 100);
    expect(got.frames).toBe(15 + 20 + 22);
    expect(got.stats).toEqual({ frames: 22, meanMs: 100, p95Ms: 100, early: true });
  });

  it("ends a step under 4 frames a second as a miss at its 21st stall, which the early end cannot see", () => {
    // 300 ms a frame: ready at 1.5 s (5 frames), the warm-up bounded at
    // 2,100 ms of intervals counted at most 250 ms each (8 frames), then every
    // interval a stall. Before, the stalls were dropped, the sum never grew,
    // and the cap cut the step unread.
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    const got = run(meter, t, 300);
    expect(got.frames).toBe(5 + 8 + 21);
    expect(got.stats).toEqual({ frames: 21, meanMs: 300, p95Ms: 300, stalls: 21 });
  });

  it("counts a hidden tab's gap in the warm-up as 250 ms, so the warm-up is not cut short by it", () => {
    // 60 Hz: ready at frame 90; 10 warm-up frames, then the tab hidden for
    // 3 s, then the rest. Counted by the clock, the gap spent the whole
    // 2,100 ms bound: the warm-up ended at once and the frames just after
    // the tab came back were measured.
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    for (let n = 0; n < 90 + 10; n++) {
      t.now += 16.667;
      expect(meter.frame(t.now, true).done).toBe(false);
    }
    t.now += 3000;
    expect(meter.frame(t.now, true).done).toBe(false);
    const got = run(meter, t, 16.667);
    expect(got.frames).toBe(49 + 120);
    expect(got.stats!.frames).toBe(120);
    expect(got.stats!.meanMs).toBeCloseTo(16.667, 3);
  });

  it("measures all 120 frames of a step that holds at the bar exactly", () => {
    // 17.5 ms: 60 warm-up frames take 1,050 ms, and 120 measured sum to
    // 2,100 ms, which is not past the budget.
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    const got = run(meter, t, 17.5);
    expect(got.frames).toBe(86 + 60 + 120);
    expect(got.stats).toEqual({ frames: 120, meanMs: 17.5, p95Ms: 17.5 });
  });

  it("gives a step what the cap leaves it to be ready, less the frames it needs", () => {
    // Uncapped: the 15 s is counted after the step's build, where the page
    // takes the lesser of the two.
    expect(stepReadyMaxMs(30_000)).toBe(25_800);
    expect(stepReadyMaxMs(16_700)).toBe(12_500);
    expect(stepReadyMaxMs(13_760)).toBe(9_560);
    expect(stepReadyMaxMs(4_200)).toBe(0);
    const t = { now: 0 };
    const meter = createProbeMeter(t.now, 9_560);
    let answer: { done: boolean; stats?: unknown } = { done: false };
    while (!answer.done) {
      t.now += 50;
      answer = meter.frame(t.now, false);
    }
    expect(answer).toEqual({ done: true, stats: null });
    expect(t.now).toBe(9_600);
  });

  it("gives up on a scene that is never ready in 15 s", () => {
    const t = { now: 0 };
    const meter = createProbeMeter(t.now);
    let answer: { done: boolean; stats?: unknown } = { done: false };
    let frames = 0;
    while (!answer.done && frames < 2000) {
      t.now += 16.667;
      frames += 1;
      answer = meter.frame(t.now, false);
    }
    expect(answer).toEqual({ done: true, stats: null });
    expect(t.now).toBeGreaterThan(15_000);
    expect(t.now).toBeLessThan(15_020);
  });
});

describe("startHike", () => {
  const SAFARI: GpuSignals = {
    renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
  };
  const DECIDED = { tier: "medium" as const, source: "auto" as const, cls: "apple-unknown" as const };

  function page(over: Partial<Parameters<typeof startHike<string>>[0]> = {}) {
    const events: string[] = [];
    let current = true;
    const deps: Parameters<typeof startHike<string>>[0] = {
      signals: Promise.resolve(SAFARI),
      current: () => current,
      showLoading: () => {
        events.push("loading");
        return { dispose: () => void events.push("loading gone") };
      },
      decide: async () => {
        events.push("decide");
        return DECIDED;
      },
      engine: async (decided) => {
        events.push(`engine ${decided.tier}`);
        return "webgl2";
      },
      discard: (engine) => void events.push(`discard ${engine}`),
      build: (decided, engine) => void events.push(`build ${decided.tier} on ${engine}`),
      fail: (error) => void events.push(`fail ${String(error)}`),
      ...over,
    };
    return { deps, events, leave: () => { current = false; } };
  }

  it("says Loading… from the start of the wait until the hike is built: the signals, the tier, then the engine", async () => {
    let signal: (s: GpuSignals) => void = () => undefined;
    const p = page({ signals: new Promise((resolve) => { signal = resolve; }) });
    const started = startHike(p.deps);
    expect(p.events).toEqual(["loading"]);
    signal(SAFARI);
    await started;
    expect(p.events).toEqual(["loading", "decide", "engine medium", "loading gone", "build medium on webgl2"]);
  });

  it("hands Loading… over to the probe's screen, and says it again while the engine is made", async () => {
    const p = page({
      decide: async (_signals, hideLoading) => {
        hideLoading();
        p.events.push("probe screen");
        return DECIDED;
      },
    });
    await startHike(p.deps);
    expect(p.events).toEqual(["loading", "loading gone", "probe screen", "loading", "engine medium", "loading gone", "build medium on webgl2"]);
  });

  it("chooses the engine for the tier decided, after it is decided, from the signals", async () => {
    const seen: string[] = [];
    const p = page({
      decide: async () => ({ ...DECIDED, tier: "high" }),
      engine: async (decided, signals) => {
        seen.push(`${decided.tier} ${signals.renderer}`);
        return "webgpu";
      },
    });
    await startHike(p.deps);
    expect(seen).toEqual(["high Apple GPU"]);
    expect(p.events.at(-1)).toBe("build high on webgpu");
  });

  it("says the hike could not start when the engine or the build throws, rather than leaving a blank page", async () => {
    const building = page({ build: () => { throw new Error("no WebGL2"); } });
    await startHike(building.deps);
    expect(building.events).toEqual(["loading", "decide", "engine medium", "loading gone", "fail Error: no WebGL2"]);
    const engine = page({ engine: async () => { throw new Error("no canvas"); } });
    await startHike(engine.deps);
    expect(engine.events).toEqual(["loading", "decide", "loading gone", "fail Error: no canvas"]);
    expect(START_FAILED_LINE).toBe("This browser could not start the game.");
  });

  it("builds nothing and says nothing once the page has moved on, and lets go of an engine made meanwhile", async () => {
    const decided = page({
      decide: async () => {
        decided.leave();
        return DECIDED;
      },
    });
    await startHike(decided.deps);
    expect(decided.events).toEqual(["loading", "loading gone"]);
    const made = page({
      engine: async () => {
        made.leave();
        return "webgpu";
      },
    });
    await startHike(made.deps);
    expect(made.events).toEqual(["loading", "decide", "loading gone", "discard webgpu"]);
  });
});

describe("the start's wait line", () => {
  it("is Loading…, the word the landing's Play button shows as the hike starts", () => {
    expect(LOADING_LINE).toBe("Loading…");
    const launching = landingModel({ desktop: false, host: "darwin-arm64", latest: null, launching: true });
    expect(launching.play?.label).toBe(LOADING_LINE);
  });
});

describe("the line a launch logs", () => {
  it("names the tier the first renderer built at and the engine it draws with, the source `fallback` where it fell back", () => {
    const decided = { tier: "high" as const, source: "auto" as const, cls: "apple-unknown" as const };
    expect(launchLine(decided, { tier: "high", engine: "webgpu" })).toBe("quality: high (auto, apple-unknown), engine webgpu");
    expect(launchLine(decided, { tier: "medium", engine: "webgl2" })).toBe("quality: medium (fallback, apple-unknown), engine webgl2");
  });
});

describe("the quality line", () => {
  it("names the tier, where it came from, the class and the engine in use", () => {
    expect(qualityLine("medium", "auto", "apple-unknown", "webgl2")).toBe("quality: medium (auto, apple-unknown), engine webgl2");
    expect(qualityLine("high", "choice", "apple-base", "webgpu")).toBe("quality: high (choice, apple-base), engine webgpu");
  });
});

describe("autoPick's recommendation", () => {
  const SAFARI_SIGNALS: GpuSignals = {
    renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
  };
  const at = (record: import("../../src/game/quality.js").AutoRecord | null) =>
    autoPick(SAFARI_SIGNALS, { record, pixels: 2_073_600, now: 1_790_000_000_000 });

  it("is what the frame measured once a verdict holds, else the class's ceiling", () => {
    expect(at(null).ceiling).toBe("high");
    const measured = {
      v: 1, gpu: "Apple GPU", cls: "apple-unknown" as const, browser: 26, attempts: 0,
      verdict: { tier: "medium" as const, source: "probe" as const, pixels: 2_073_600, at: 1_790_000_000_000 - 86_400_000 },
    };
    expect(at(measured)).toEqual({ cls: "apple-unknown", gpu: "Apple GPU", tier: "medium", probeFrom: null, probeSkipped: false, ceiling: "medium" });
    // A verdict that no longer holds (another class, or too old) recommends nothing.
    expect(at({ ...measured, cls: "apple-base" }).ceiling).toBe("high");
    expect(at({ ...measured, verdict: { ...measured.verdict, at: 1_790_000_000_000 - 31 * 86_400_000 } }).ceiling).toBe("high");
  });
});

describe("startFallbacks", () => {
  it("is the class's start tier, then low, only below the tier asked for", () => {
    expect(startFallbacks("high", "discrete-modern", 16, 32)).toEqual(["low"]);
    expect(startFallbacks("high", "apple-unknown", 8, null)).toEqual(["medium", "low"]);
    expect(startFallbacks("medium", "apple-unknown", 8, null)).toEqual(["low"]);
    expect(startFallbacks("low", "apple-unknown", 8, null)).toEqual([]);
    expect(startFallbacks("high", "discrete-modern", 2, 32)).toEqual(["low"]);
  });
});

describe("a governor's drop at the next start", () => {
  it("starts the hike one tier down, for Auto only", async () => {
    const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    const signals: GpuSignals = {
      renderer: RTX, adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 16, memoryGb: 32, mobile: false, browser: 153,
    };
    const s = memoryStorage();
    writeAutoRecord(s, {
      v: 1, gpu: RTX, cls: "discrete-modern", browser: 153, attempts: 0,
      verdict: { tier: "medium", source: "governor", pixels: 500_000, at: 1_790_000_000_000 - 1 },
    });
    const deps: StartupDeps = {
      storage: s, pixels: () => 8_000_000, now: () => 1_790_000_000_000, runStep: async () => null,
      showScreen: () => ({ dispose: () => undefined }), setTimer: () => () => undefined,
      whenVisible: async () => true, idleCadence: async () => 16.7, log: () => undefined,
    };
    expect(await startupTier(signals, { search: "", choice: "auto", cancelled: () => false }, deps))
      .toEqual({ tier: "medium", source: "auto", cls: "discrete-modern" });
    expect(await startupTier(signals, { search: "", choice: "high", cancelled: () => false }, deps))
      .toEqual({ tier: "high", source: "choice", cls: "discrete-modern" });
  });
});

describe("the engine a probe's verdict was measured with", () => {
  const KEY = { gpu: "Apple GPU", browser: 26, cls: "apple-unknown" } as const;
  const onGpu = (tier: QualityTier, meanMs: number): ProbeReading => ({ ...reading(tier, meanMs), engine: "webgpu" });
  const SAFARI: GpuSignals = {
    renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
  };

  it("writes the engine the deciding reading drew with, and no engine for WebGL2", async () => {
    const gpu = memoryStorage();
    await runProbe("high", "medium", null, KEY, { storage: gpu, runStep: async (tier) => onGpu(tier, 16.7), pixels: () => 2_073_600, now: () => 1_790_000_000_000 });
    expect(readAutoRecord(gpu)!.verdict!.engine).toBe("webgpu");
    const gl = memoryStorage();
    await runProbe("high", "medium", null, KEY, { storage: gl, runStep: async (tier) => reading(tier, 16.7), pixels: () => 2_073_600, now: () => 1_790_000_000_000 });
    expect(readAutoRecord(gl)!.verdict).not.toHaveProperty("engine");
  });

  it("reads a verdict only for the engine the probed tiers would draw with now", () => {
    const record = { v: 1, gpu: "Apple GPU", cls: "apple-unknown" as const, browser: 26, attempts: 0,
      verdict: { tier: "high" as const, source: "probe" as const, pixels: 2_073_600, at: 1_790_000_000_000 - 1 } };
    const at = { record, pixels: 2_073_600, now: 1_790_000_000_000 };
    expect(autoPick(SAFARI, at)).toMatchObject({ tier: "high", probeFrom: null });
    expect(autoPick(SAFARI, { ...at, engine: "webgl2" })).toMatchObject({ tier: "high", probeFrom: null });
    // A WebGL2 verdict holds for WebGPU too: it is a floor there.
    expect(autoPick(SAFARI, { ...at, engine: "webgpu" })).toMatchObject({ tier: "high", probeFrom: null });
  });
});

describe("the probe's attempts when its verdict is for another engine than the one it is looked up under", () => {
  /**
   * Six loads of one page: each asks Auto with `key` (the engine the rule
   * gives the probed tiers when the load starts) and, when Auto probes, runs
   * the probe with steps that draw on `drawn`. With the adapter not known
   * yet the key is WebGPU, and the steps can still end on WebGL2 with
   * nothing remembered (an unfit adapter answering late, a translator fetch
   * that runs out): the verdict is then WebGL2's, which a WebGPU key never
   * reads.
   */
  async function loads(key: VerdictEngine, drawn: VerdictEngine): Promise<boolean[]> {
    const storage = memoryStorage();
    const KEY = { gpu: "Apple GPU", browser: 26, cls: "apple-unknown" as const, engine: key };
    const probed: boolean[] = [];
    for (let load = 0; load < 6; load++) {
      const record = readAutoRecord(storage);
      const now = 1_790_000_000_000 + load * 60_000;
      const auto = autoTier({ cls: "apple-unknown", cores: 8, memoryGb: null, record, gpu: "Apple GPU", browser: 26, pixels: 2_073_600, now, engine: key });
      probed.push(auto.probeFrom !== null);
      if (auto.probeFrom === null) continue;
      await runProbe(auto.probeFrom, auto.tier, record, KEY, {
        storage,
        runStep: async (tier) => ({ ...reading(tier, 16.7), engine: drawn }),
        pixels: () => 2_073_600,
        now: () => now,
      });
    }
    return probed;
  }

  it("probes at most three times where the key never reads the verdict: a WebGPU verdict under a WebGL2 key", async () => {
    expect(await loads("webgl2", "webgpu")).toEqual([true, true, true, false, false, false]);
  });

  it("probes once and stops where the key reads the verdict: its own engine's, or WebGL2's under WebGPU", async () => {
    expect(await loads("webgl2", "webgl2")).toEqual([true, false, false, false, false, false]);
    expect(await loads("webgpu", "webgpu")).toEqual([true, false, false, false, false, false]);
    expect(await loads("webgpu", "webgl2")).toEqual([true, false, false, false, false, false]);
  });
});


describe("Safari on a Mac slower than the reference machine, hike after hike", () => {
  // Every probe step's scene takes `loadMs` to build and load, then 1.5 s to
  // fall quiet; high draws at 70 ms a frame, medium at 50 and low at 30, all
  // under the governor's 48 fps. Each hike is followed by a minute of play,
  // after which the governor drops any tier played under 48 fps.
  const SLOW_MAC: GpuSignals = {
    renderer: "Apple GPU", adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: true, cores: 8, memoryGb: null, mobile: false, browser: 26,
  };
  const FRAME_MS: Record<QualityTier, number> = { high: 70, medium: 50, low: 30 };
  const DAY = 86_400_000;
  const BASE = 1_790_000_000_000;

  async function hikes(loadMs: number, days: readonly number[], frameMs: Record<QualityTier, number> = FRAME_MS, buildMs = 0) {
    const storage = memoryStorage();
    const clock = { now: BASE };
    let timer: { at: number; fn: () => void } | null = null;
    const probes: QualityTier[][] = [];
    const tiers: QualityTier[] = [];
    const screens: number[] = [];
    let drops = 0;
    for (const day of days) {
      clock.now = Math.max(clock.now + 600_000, BASE + day * DAY);
      const steps: QualityTier[] = [];
      const deps: StartupDeps = {
        storage,
        pixels: () => 1_045_960,
        now: () => clock.now,
        runStep: async (tier, cancelled, readyMaxMs) => {
          steps.push(tier);
          // As the page does: the build blocks, then the step has 15 s from
          // its end, or what the cap left it from the call, whichever is sooner.
          const called = clock.now;
          clock.now += buildMs;
          const begin = clock.now;
          const meter = createProbeMeter(begin, Math.min(PROBE_READY_MAX_MS, called + readyMaxMs - begin));
          let compiled = false;
          for (;;) {
            clock.now += frameMs[tier];
            const due: { at: number; fn: () => void } | null = timer;
            if (due !== null && clock.now >= due.at) due.fn();
            if (cancelled()) return null;
            const loaded = clock.now - begin >= loadMs;
            if (loaded && !compiled) {
              compiled = true;
              meter.compiled(clock.now);
            }
            const step = meter.frame(clock.now, loaded);
            if (step.done) return step.stats === null ? null : { tier, ...step.stats, pixels: 1_045_960, engine: "webgl2" };
          }
        },
        showScreen: () => {
          const shown = clock.now;
          return { dispose: () => void screens.push(clock.now - shown) };
        },
        setTimer: (fn, ms) => {
          timer = { at: clock.now + ms, fn };
          return () => {
            timer = null;
          };
        },
        whenVisible: async () => true,
        idleCadence: async () => {
          clock.now += 500;
          return 16.7;
        },
        log: () => undefined,
      };
      const started = await startupTier(SLOW_MAC, { search: "", choice: "auto", cancelled: () => false }, deps);
      tiers.push(started.tier);
      if (steps.length > 0) probes.push(steps);
      clock.now += 60_000;
      if (frameMs[started.tier] > 20.8) {
        const next = withGovernorDrop(readAutoRecord(storage), "Apple GPU", 26, "apple-unknown", started.tier, 1_045_960, clock.now);
        if (next !== null) {
          writeAutoRecord(storage, next);
          drops += 1;
        }
      }
    }
    return { storage, probes, tiers, screens, drops };
  }

  it("probes once, reads low inside the cap, and is not probed or dropped again in 30 days", async () => {
    // 9 s to be ready. Before a step could end early this probe took 21.7 s
    // over high alone, the cap cut medium, and the sequence ran: three hikes of
    // 30 s of screen with no verdict, the governor's drop to low, and once that
    // lapsed after 7 days, the probes again.
    const got = await hikes(7_500, [0, 0, 0, 0, 1, 7, 8, 14, 29]);
    expect(got.probes).toEqual([["high", "medium"]]);
    expect(got.screens).toEqual([27_000]);
    expect(got.tiers).toEqual(["low", "low", "low", "low", "low", "low", "low", "low", "low"]);
    expect(got.drops).toBe(0);
    const verdict = readAutoRecord(got.storage)!.verdict!;
    expect(verdict.tier).toBe("low");
    expect(verdict.source).toBe("probe");
    expect(verdict.readings!.map((r) => [r.tier, r.frames, r.meanMs, r.early])).toEqual([["high", 31, 70, true], ["medium", 43, 50, true]]);
  });

  it("gives the first step its 15 s to be ready from after a slow build: one reading, a verdict", async () => {
    // A 6 s build, then 11 s to be ready, and high holding at 16 ms a frame:
    // one step. Counted from before the build, the step had 9 s after it and
    // read nothing, on three hikes, and then the class's start tier stood.
    const got = await hikes(9_500, [0, 1, 7, 14, 29], { high: 16, medium: 16, low: 16 }, 6_000);
    expect(got.probes).toEqual([["high"]]);
    expect(got.screens).toEqual([20_388]);
    expect(got.tiers).toEqual(["high", "high", "high", "high", "high"]);
    const verdict = readAutoRecord(got.storage)!.verdict!;
    expect(verdict.source).toBe("probe");
    expect(verdict.readings!.map((r) => [r.tier, r.frames, r.meanMs])).toEqual([["high", 120, 16]]);
  });

  it("probes at most three times over nine weeks where the cap always cuts the second step", async () => {
    // 12 s to be ready: high misses at about 16 s and the cap cuts medium, so
    // each probe's verdict is medium, unmeasured; medium plays under 48 fps
    // and the governor drops to low, a verdict that lapses after 7 days. A
    // cut verdict that cleared the count gave this machine a probe every week.
    const got = await hikes(10_500, [0, 1, 8, 16, 24, 32, 40, 48, 56, 62]);
    expect(got.probes).toEqual([["high", "medium"], ["high", "medium"], ["high", "medium"]]);
    expect(got.tiers).toEqual(["medium", "low", "medium", "medium", "medium", "medium", "medium", "medium", "medium", "low"]);
    expect(readAutoRecord(got.storage)!.attempts).toBe(3);
    // High ends 16.24 s into the cap, leaving medium 9.56 s to be ready where
    // it needs 12 s: it gives up there, not at the cap's 30 s.
    expect(got.screens).toEqual([26_340, 26_340, 26_340]);
  });
});
