import { describe, it, expect } from "vitest";
import {
  QUALITY,
  autoTier,
  recordMatches,
  tierFor,
  verdictFor,
  verdictHolds,
  withGovernorDrop,
  withProbeStarted,
  withVerdict,
  withinClass,
  containerPixels,
  type AutoRecord,
  type AutoVerdict,
  type Capabilities,
  type QualityTier,
} from "../../src/game/quality.js";
import { CLASS_TIERS, type GpuClass } from "../../src/game/gpuClass.js";

describe("QUALITY", () => {
  it("matches the quality tier table", () => {
    // Pins the specified values: hardware scaling, shadow map sizes, LOD
    // bias, and texture mip caps. Also pins cascade counts so
    // they cannot drift silently; note that `high`'s cascade count is a
    // tuning value, not a fixed requirement. It was 4 (Babylon's default)
    // until production measurement showed the old-growth canopy's
    // alpha-tested fragments across four 2048² cascade maps cost ~5 ms/frame
    // at a deep forest camera; 2 cascades restores a locked 60 fps.
    expect(QUALITY.low).toEqual({
      hardwareScaling: 1.5,
      shadowMapSize: 0,
      shadowCascades: 0,
      lodBias: 1,
      textureMipCap: 512,
    });
    expect(QUALITY.medium).toEqual({
      hardwareScaling: 1,
      shadowMapSize: 1024,
      shadowCascades: 1,
      lodBias: 0,
      textureMipCap: 1024,
    });
    expect(QUALITY.high).toEqual({
      hardwareScaling: 1,
      shadowMapSize: 2048,
      shadowCascades: 2,
      lodBias: 0,
      textureMipCap: 0,
    });
  });

  it("turns shadows off only at low", () => {
    expect(QUALITY.low.shadowMapSize).toBe(0);
    expect(QUALITY.medium.shadowMapSize).toBeGreaterThan(0);
    expect(QUALITY.high.shadowMapSize).toBeGreaterThan(QUALITY.medium.shadowMapSize);
  });
});

describe("tierFor", () => {
  const RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 };

  it("sends mobile to low regardless of reported cores", () => {
    expect(tierFor({ cores: 16, memoryGb: 16, mobile: true })).toBe("low");
  });

  it("gives a workstation high", () => {
    expect(tierFor({ cores: 16, memoryGb: 32, mobile: false })).toBe("high");
  });

  it("gives a weak laptop low", () => {
    expect(tierFor({ cores: 2, memoryGb: 4, mobile: false })).toBe("low");
  });

  it("never rewards weaker hardware with a higher tier", () => {
    // Catches ordering regressions that the point-example tests might miss. A
    // hand-written threshold ladder is easy to get non-monotonic, and the symptom
    // — one machine in a hundred picking the wrong tier — would never be noticed.
    // This depends on the point examples to rule out degenerate answers.
    const grid: Capabilities[] = [];
    for (const cores of [1, 2, 4, 6, 8, 12, 16, 32]) {
      for (const memoryGb of [1, 2, 4, 8, 16, 32]) {
        grid.push({ cores, memoryGb, mobile: false });
      }
    }
    for (const a of grid) {
      for (const b of grid) {
        if (a.cores <= b.cores && a.memoryGb <= b.memoryGb) {
          expect(RANK[tierFor(a)]).toBeLessThanOrEqual(RANK[tierFor(b)]);
        }
      }
    }
  });

  it("is deterministic", () => {
    const caps: Capabilities = { cores: 8, memoryGb: 8, mobile: false };
    expect(tierFor(caps)).toBe(tierFor(caps));
  });
});

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;
const SAFARI = "Apple GPU";

function rec(verdict: Partial<AutoVerdict> | null, over: Partial<AutoRecord> = {}): AutoRecord {
  return {
    v: 1,
    gpu: SAFARI,
    cls: "apple-unknown",
    browser: 26,
    attempts: 0,
    verdict: verdict === null ? null : { tier: "high", source: "probe", pixels: 2_073_600, at: NOW - DAY, ...verdict },
    ...over,
  };
}

function auto(record: AutoRecord | null, pixels = 2_073_600) {
  return autoTier({ cls: "apple-unknown", cores: 8, memoryGb: null, record, gpu: SAFARI, browser: 26, pixels, now: NOW });
}

describe("autoTier and the verdict", () => {
  it("takes a probe verdict that holds, at up to 1.5 times its window", () => {
    expect(auto(rec({}))).toEqual({ tier: "high", probeFrom: null });
    expect(auto(rec({}), 3_110_400)).toEqual({ tier: "high", probeFrom: null });
    expect(auto(rec({}), 3_110_401)).toEqual({ tier: "medium", probeFrom: "high" });
  });

  it("drops a verdict for another GPU, another browser, an old version, or after 30 days", () => {
    expect(auto(rec({}, { gpu: "Apple M1, or similar" }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({}, { browser: 27 }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({}, { v: 0 }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({ at: NOW - 30 * DAY }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({ at: NOW - 30 * DAY + 1 }))).toEqual({ tier: "high", probeFrom: null });
  });

  it("drops a verdict dated in the future", () => {
    expect(auto(rec({ at: NOW + DAY }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({ at: NOW + 1 }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({ at: NOW }))).toEqual({ tier: "high", probeFrom: null });
  });

  it("ignores a verdict made for another class of the same GPU, and keeps its attempts", () => {
    expect(auto(rec({}, { cls: "apple-base" }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec({}, { cls: "apple-base", attempts: 3 }))).toEqual({ tier: "medium", probeFrom: null });
    expect(auto(rec(null, { cls: "apple-base", attempts: 3 }))).toEqual({ tier: "medium", probeFrom: null });
  });

  it("stops probing a GPU whose class alternates between loads, after three attempts", () => {
    // An unnamed renderer, classed by its adapter on the loads where the
    // adapter answers in time and `unknown` where it does not. Each load that
    // probes writes its attempt as the probe does (the count up by one, on the
    // record of this GPU and browser, whatever its class).
    const gpu = "ANGLE (Intel, Intel(R) Graphics (0x00007D67) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    let record = null as AutoRecord | null;
    const probed: boolean[] = [];
    for (let load = 0; load < 8; load++) {
      const cls = load % 2 === 0 ? "integrated-unknown" : "unknown";
      const got = autoTier({ cls, cores: 8, memoryGb: 16, record, gpu, browser: 153, pixels: 2_073_600, now: NOW });
      probed.push(got.probeFrom !== null);
      if (got.probeFrom !== null) {
        record = { v: 1, gpu, cls, browser: 153, attempts: (record?.attempts ?? 0) + 1, verdict: record?.verdict ?? null };
      }
    }
    expect(probed).toEqual([true, true, true, false, false, false, false, false]);
    expect(record!.attempts).toBe(3);
  });

  it("stops probing after three attempts without a verdict", () => {
    expect(auto(rec(null, { attempts: 2 }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec(null, { attempts: 3 }))).toEqual({ tier: "medium", probeFrom: null });
  });

  it("counts no attempts from a record for another GPU", () => {
    expect(auto(rec(null, { attempts: 3, gpu: "Apple M1, or similar" }))).toEqual({ tier: "medium", probeFrom: "high" });
  });

  it("holds a governor drop at any window size, on a class that is never probed", () => {
    const rtx = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    const record = rec({ tier: "medium", source: "governor", pixels: 500_000 }, { gpu: rtx, cls: "discrete-modern", browser: 153 });
    const got = autoTier({ cls: "discrete-modern", cores: 16, memoryGb: 32, record, gpu: rtx, browser: 153, pixels: 8_000_000, now: NOW });
    expect(got).toEqual({ tier: "medium", probeFrom: null });
  });

  it("never takes a verdict above the class's ceiling", () => {
    const xe = "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    const record = rec({ tier: "high" }, { gpu: xe, cls: "integrated-unknown", browser: 153 });
    const got = autoTier({ cls: "integrated-unknown", cores: 8, memoryGb: 16, record, gpu: xe, browser: 153, pixels: 2_073_600, now: NOW });
    expect(got).toEqual({ tier: "medium", probeFrom: null });
  });

  it("never takes a verdict past the low cap", () => {
    const got = autoTier({ cls: "apple-unknown", cores: 2, memoryGb: null, record: rec({}), gpu: SAFARI, browser: 26, pixels: 2_073_600, now: NOW });
    expect(got).toEqual({ tier: "low", probeFrom: null });
  });

  it("matches a record by version, GPU and browser, and holds a verdict by age and size", () => {
    expect(recordMatches(rec({}), SAFARI, 26)).toBe(true);
    expect(recordMatches(rec({}), SAFARI, 25)).toBe(false);
    expect(recordMatches(rec({}, { cls: "apple-base" }), SAFARI, 26)).toBe(true);
    expect(recordMatches(null, SAFARI, 26)).toBe(false);
    expect(verdictFor(rec({}), "apple-unknown")).toEqual({ tier: "high", source: "probe", pixels: 2_073_600, at: NOW - DAY });
    expect(verdictFor(rec({}), "apple-base")).toBe(null);
    const v = rec({})!.verdict!;
    expect(verdictHolds(v, 3_110_400, NOW)).toBe(true);
    expect(verdictHolds(v, 3_110_401, NOW)).toBe(false);
    expect(verdictHolds({ ...v, source: "governor" }, 9_000_000, NOW)).toBe(true);
    expect(verdictHolds({ ...v, at: NOW + DAY }, 2_073_600, NOW)).toBe(false);
    expect(verdictHolds({ ...v, source: "governor", at: NOW + DAY }, 2_073_600, NOW)).toBe(false);
  });

  it("never gives less memory or fewer cores a higher tier", () => {
    const RANK = { low: 0, medium: 1, high: 2 } as const;
    const values = [1, 2, 4, 8, 16, 32];
    for (const cls of Object.keys(CLASS_TIERS) as GpuClass[]) {
      for (const c1 of values) for (const c2 of values) for (const m1 of values) for (const m2 of values) {
        if (c1 > c2 || m1 > m2) continue;
        const at = (cores: number, memoryGb: number) =>
          autoTier({ cls, cores, memoryGb, record: null, gpu: "", browser: 153, pixels: 2_073_600, now: NOW }).tier;
        expect(RANK[at(c1, m1)]).toBeLessThanOrEqual(RANK[at(c2, m2)]);
      }
    }
  });
});

describe("the record through a probe", () => {
  it("counts a started probe and clears the count with a verdict", () => {
    const started = withProbeStarted(null, "Apple GPU", 26, "apple-unknown");
    expect(started).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null });
    expect(withProbeStarted(started, "Apple GPU", 26, "apple-unknown").attempts).toBe(2);
    expect(withProbeStarted(started, "Apple GPU", 27, "apple-unknown").attempts).toBe(1);
    expect(withProbeStarted(started, "Apple GPU", 26, "apple-base").attempts).toBe(2);
    const verdict: AutoVerdict = { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000 };
    expect(withVerdict(started, "Apple GPU", 26, "apple-unknown", verdict)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0, verdict });
  });

  it("keeps a record's class and verdict while its probe runs", () => {
    const held = rec({ tier: "medium" }, { attempts: 0 });
    expect(withProbeStarted(held, SAFARI, 26, "apple-base")).toEqual({ ...held, attempts: 1 });
  });

  it("carries the count past a verdict that replaces another class's", () => {
    const verdict: AutoVerdict = { tier: "high", source: "probe", pixels: 2_073_600, at: NOW };
    const other = rec({ tier: "medium" }, { cls: "apple-base", attempts: 2 });
    expect(withVerdict(other, SAFARI, 26, "apple-unknown", verdict)).toEqual({ v: 1, gpu: SAFARI, cls: "apple-unknown", browser: 26, attempts: 2, verdict });
    const same = rec({ tier: "medium" }, { attempts: 2 });
    expect(withVerdict(same, SAFARI, 26, "apple-unknown", verdict)!.attempts).toBe(0);
    const empty = rec(null, { cls: "apple-base", attempts: 2 });
    expect(withVerdict(empty, SAFARI, 26, "apple-unknown", verdict)!.attempts).toBe(0);
    expect(withVerdict(other, SAFARI, 27, "apple-unknown", verdict)!.attempts).toBe(0);
  });

  it("refuses a verdict over no area, and measures the window one way", () => {
    const started = withProbeStarted(null, "Apple GPU", 26, "apple-unknown");
    expect(withVerdict(started, "Apple GPU", 26, "apple-unknown", { tier: "medium", source: "probe", pixels: 0, at: 1_790_000_000_000 })).toBe(null);
    expect(containerPixels({ clientWidth: 1920, clientHeight: 1080 })).toBe(2_073_600);
    expect(containerPixels({ clientWidth: 0, clientHeight: 1080 })).toBe(0);
    expect(containerPixels({ clientWidth: 1470, clientHeight: -1 })).toBe(0);
  });
});

describe("withinClass", () => {
  it("keeps a tier within the class's ceiling and the low cap", () => {
    expect(withinClass("high", "apple-base", 10, 16)).toBe("medium");
    expect(withinClass("high", "discrete-modern", 2, 16)).toBe("low");
    expect(withinClass("medium", "apple-unknown", 8, null)).toBe("medium");
    expect(withinClass("low", "discrete-modern", 16, 32)).toBe("low");
  });
});

describe("a build-failure verdict", () => {
  const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";

  it("holds at any window for 30 days, and starts Auto at the tier that did build", () => {
    const built: AutoVerdict = { tier: "medium", source: "build", pixels: 500_000, at: NOW - DAY };
    expect(verdictHolds(built, 9_000_000, NOW)).toBe(true);
    expect(verdictHolds({ ...built, at: NOW - 30 * DAY }, 2_073_600, NOW)).toBe(false);
    const record = rec({ tier: "medium", source: "build", pixels: 500_000 }, { gpu: RTX, cls: "discrete-modern", browser: 153 });
    expect(autoTier({ cls: "discrete-modern", cores: 16, memoryGb: 32, record, gpu: RTX, browser: 153, pixels: 8_000_000, now: NOW }))
      .toEqual({ tier: "medium", probeFrom: null });
  });

  it("caps a probed class at the tier that built, which is still measured below the cap, and never above it", () => {
    const build = (tier: QualityTier, cls: GpuClass) => rec({ tier, source: "build", pixels: 2_073_600 }, { cls });
    // Iris Xe's class starts low and is probed up to medium: medium did build, so the probe still runs, from medium.
    expect(autoTier({ cls: "integrated-unknown", cores: 8, memoryGb: 16, record: build("medium", "integrated-unknown"), gpu: SAFARI, browser: 26, pixels: 2_073_600, now: NOW }))
      .toEqual({ tier: "low", probeFrom: "medium" });
    // Probed up to high: high failed and medium built, so nothing above medium is measured.
    expect(autoTier({ cls: "apple-unknown", cores: 8, memoryGb: null, record: build("medium", "apple-unknown"), gpu: SAFARI, browser: 26, pixels: 2_073_600, now: NOW }))
      .toEqual({ tier: "medium", probeFrom: null });
    expect(autoTier({ cls: "integrated-unknown", cores: 8, memoryGb: 16, record: build("low", "integrated-unknown"), gpu: SAFARI, browser: 26, pixels: 2_073_600, now: NOW }))
      .toEqual({ tier: "low", probeFrom: null });
  });

  it("is kept whatever the window's area, which it does not certify", () => {
    const verdict: AutoVerdict = { tier: "low", source: "build", pixels: 0, at: NOW };
    expect(withVerdict(null, RTX, 153, "discrete-modern", verdict)).toEqual({ v: 1, gpu: RTX, cls: "discrete-modern", browser: 153, attempts: 0, verdict });
  });
});

describe("the record after a governor drop", () => {
  it("drops the running tier one step, for this class, at any window, and has nothing below low", () => {
    const got = withGovernorDrop(null, "Apple GPU", 26, "apple-unknown", "high", 2_073_600, 1_790_000_000_000);
    expect(got).toEqual({
      v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0,
      verdict: { tier: "medium", source: "governor", pixels: 2_073_600, at: 1_790_000_000_000 },
    });
    expect(withGovernorDrop(null, "Apple GPU", 26, "apple-unknown", "medium", 2_073_600, 1_790_000_000_000)!.verdict!.tier).toBe("low");
    expect(withGovernorDrop(null, "Apple GPU", 26, "apple-unknown", "low", 2_073_600, 1_790_000_000_000)).toBe(null);
  });

  it("is honoured by Auto at the next start, at any window, until it is 30 days old", () => {
    const record = withGovernorDrop(null, SAFARI, 26, "apple-unknown", "high", 500_000, NOW - DAY)!;
    expect(auto(record, 8_000_000)).toEqual({ tier: "medium", probeFrom: null });
    expect(autoTier({ cls: "apple-unknown", cores: 8, memoryGb: null, record, gpu: SAFARI, browser: 26, pixels: 2_073_600, now: NOW + 30 * DAY }))
      .toEqual({ tier: "medium", probeFrom: "high" });
  });
});

