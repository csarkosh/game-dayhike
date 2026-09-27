import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import {
  PROBE_MAX_MS,
  autoPick,
  nextProbeStep,
  probeHolds,
  probePose,
  probeReadingLine,
  readIntervals,
  runProbe,
  startupTier,
  type StartupDeps,
} from "../../src/game/frameProbe.js";
import type { GpuSignals } from "../../src/game/gpuSignals.js";
import type { ProbeReading, QualityTier } from "../../src/game/quality.js";
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

  it("counts a second attempt on the record of the first", async () => {
    const s = memoryStorage();
    const first = { v: 1, gpu: "Apple GPU", cls: "apple-unknown" as const, browser: 26, attempts: 1, verdict: null };
    await runProbe("high", "medium", first, KEY, { storage: s, runStep: async () => null, pixels: () => 2_073_600, now: () => 1_790_000_000_000 });
    expect(readAutoRecord(s)!.attempts).toBe(2);
  });
});

describe("startupTier", () => {
  const SAFARI: GpuSignals = {
    renderer: "Apple GPU", adapter: null, limits: null, adapterStatus: "none", cores: 8, memoryGb: null, mobile: false, browser: 26,
  };
  const M4: GpuSignals = {
    renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)",
    adapter: null, limits: null, adapterStatus: "none", cores: 10, memoryGb: 16, mobile: false, browser: 153,
  };

  /** Fakes for the page: steps answer from `answers`, the timer fires when told. */
  function fakes(answers: (tier: QualityTier) => ProbeReading | null, storage: Storage = memoryStorage()) {
    const steps: QualityTier[] = [];
    const lines: string[] = [];
    let screens = 0;
    let open = 0;
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
      log: (line) => void lines.push(line),
    };
    return { deps, storage, steps, lines, screens: () => screens, open: () => open, timer: () => timer };
  }
  const page = (search = "", choice: "auto" | QualityTier = "auto") => ({ search, choice, cancelled: () => false });

  it("probes a probed class from its ceiling behind the screen, and starts at the verdict", async () => {
    const t = fakes((tier) => reading(tier, tier === "high" ? 23.96 : 16.7));
    expect(await startupTier(SAFARI, page(), t.deps)).toEqual({ tier: "medium", source: "auto", cls: "apple-unknown" });
    expect(t.steps).toEqual(["high", "medium"]);
    expect(t.screens()).toBe(1);
    expect(t.open()).toBe(0);
    expect(t.timer()).toBe(null);
    expect(t.lines).toEqual([
      "quality probe: verdict medium (apple-unknown)",
      "quality: medium (auto, apple-unknown), engine webgl2",
    ]);
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
    expect(t.lines).toEqual(["quality: medium (auto, apple-base), engine webgl2"]);
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
    expect(t.lines[0]).toBe("quality probe: no verdict, starting at medium (apple-unknown)");
    expect(PROBE_MAX_MS).toBe(30_000);
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
      limits: {}, adapterStatus: "ok", cores: 8, memoryGb: 16, mobile: false, browser: 153,
    };
    const late: GpuSignals = { ...answered, adapter: null, limits: null, adapterStatus: "timed-out" };
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
    expect(chosen.lines).toEqual(["quality: low (choice, apple-unknown), engine webgl2", "quality: high (choice, apple-unknown), engine webgl2"]);
    const overridden = fakes(() => reading("high", 16.7));
    expect(await startupTier(SAFARI, page("?tier=medium", "low"), overridden.deps)).toEqual({ tier: "medium", source: "override", cls: "apple-unknown" });
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
  it("is Auto's tier and whether it will probe, before any hike", () => {
    const signals: GpuSignals = {
      renderer: "Apple GPU", adapter: null, limits: null, adapterStatus: "none", cores: 8, memoryGb: null, mobile: false, browser: 26,
    };
    expect(autoPick(signals, { record: null, pixels: 2_073_600, now: 1_790_000_000_000 })).toEqual({
      cls: "apple-unknown", gpu: "Apple GPU", tier: "medium", probeFrom: "high",
    });
  });
});
