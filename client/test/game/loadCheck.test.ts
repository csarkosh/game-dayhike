import { describe, expect, it, vi } from "vitest";
import { REQUIRED_FEATURES, REQUIRED_LIMITS, TURNED_AWAY_REASONS, adapterVerdict, loadVerdict } from "@csarkosh/engine/game/loadCheck";
import { gatherSignals, readSignals, type AdapterReading, type GpuSignals } from "@csarkosh/engine/game/gpuSignals";

/** WebGPU's default limits, as its specification gives them: what a device made with no limit raised has. */
const DEFAULTS: Record<string, number> = {
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindGroupsPlusVertexBuffers: 24,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728,
  minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256,
  maxVertexBuffers: 8,
  maxBufferSize: 268435456,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxInterStageShaderVariables: 16,
  maxColorAttachments: 8,
  maxColorAttachmentBytesPerSample: 32,
  maxComputeWorkgroupStorageSize: 16384,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
};

/** An adapter as the page reads one: the defaults, hardware, the features given. */
const adapter = (over: Partial<AdapterReading> = {}): AdapterReading => ({ limits: DEFAULTS, isFallbackAdapter: false, features: [...REQUIRED_FEATURES], ...over });

type Read = Pick<GpuSignals, "adapterStatus" | "adapter" | "limits" | "features">;
const INFO = { vendor: "apple", architecture: "metal-3", device: "", description: "", isFallbackAdapter: false };
/** The signals of a page whose adapter request answered with an adapter. */
const ok = (over: Partial<Read> = {}): Read => ({ adapterStatus: "ok", adapter: INFO, limits: DEFAULTS, features: [...REQUIRED_FEATURES], ...over });

describe("the load check's requirements", () => {
  it("asks of an adapter no more than WebGPU's defaults, which the renderer's device is made with", () => {
    // The device is made with no limit raised, so a need above a default could not be met by any adapter:
    // each named limit is the default itself, and an adapter that implements WebGPU in full is never short.
    for (const [name, need] of Object.entries(REQUIRED_LIMITS)) expect(need, name).toBe(DEFAULTS[name]);
    expect(Object.keys(REQUIRED_LIMITS).length).toBeGreaterThan(0);
    expect(adapterVerdict(adapter())).toEqual({ play: true });
  });

  it("names its reasons once, in the order they are looked for", () => {
    expect(TURNED_AWAY_REASONS).toEqual(["no-webgpu", "no-adapter", "software", "short"]);
  });
});

describe("the verdict on an adapter", () => {
  it("lets an adapter with the defaults and more play", () => {
    expect(adapterVerdict(adapter({ limits: { ...DEFAULTS, maxTextureDimension2D: 16384, maxSampledTexturesPerShaderStage: 48 } }))).toEqual({ play: true });
  });

  it("turns away no adapter, and a software one whatever it offers", () => {
    expect(adapterVerdict(null)).toEqual({ play: false, reason: "no-adapter", short: null });
    expect(adapterVerdict(adapter({ isFallbackAdapter: true }))).toEqual({ play: false, reason: "software", short: null });
    // The software adapter's own shortfall is not what is said of it.
    expect(adapterVerdict(adapter({ isFallbackAdapter: true, limits: { ...DEFAULTS, maxBindGroups: 1 } }))).toEqual({ play: false, reason: "software", short: null });
  });

  it("names the limit an adapter reports under the game's need, with both numbers", () => {
    for (const [name, need] of Object.entries(REQUIRED_LIMITS)) {
      expect(adapterVerdict(adapter({ limits: { ...DEFAULTS, [name]: need - 1 } })), name).toEqual({ play: false, reason: "short", short: `${name} ${need - 1} < ${need}` });
      expect(adapterVerdict(adapter({ limits: { ...DEFAULTS, [name]: need } })), name).toEqual({ play: true });
    }
    // The first short limit in the list's order is the one named.
    const [first, second] = Object.keys(REQUIRED_LIMITS) as [string, string];
    const both = adapterVerdict(adapter({ limits: { ...DEFAULTS, [second]: 0, [first]: 0 } }));
    expect(both).toEqual({ play: false, reason: "short", short: `${first} 0 < ${REQUIRED_LIMITS[first]}` });
  });

  it("does not count a limit the adapter does not report as short", () => {
    // A browser that names a newer limit later, or reads none at all, is not turned away for it.
    const older = Object.fromEntries(Object.entries(DEFAULTS).filter(([name]) => name !== "maxInterStageShaderVariables"));
    expect(older.maxInterStageShaderVariables).toBeUndefined();
    expect(adapterVerdict(adapter({ limits: older }))).toEqual({ play: true });
    expect(adapterVerdict(adapter({ limits: {} }))).toEqual({ play: true });
  });

  it("names a required feature the adapter lacks, and none where nothing is required", () => {
    for (const feature of REQUIRED_FEATURES) {
      const without = REQUIRED_FEATURES.filter((f) => f !== feature);
      expect(adapterVerdict(adapter({ features: without })), feature).toEqual({ play: false, reason: "short", short: feature });
    }
    // The features the renderer only asks for where they are offered are not required.
    expect(adapterVerdict(adapter({ features: [...REQUIRED_FEATURES] }))).toEqual({ play: true });
    for (const optional of ["texture-compression-astc", "texture-compression-bc", "texture-compression-etc2", "timestamp-query", "primitive-index"]) {
      expect(REQUIRED_FEATURES, optional).not.toContain(optional);
    }
  });
});

describe("the verdict as the page loads", () => {
  it("turns away a browser with no WebGPU at once, before the signals are in", () => {
    expect(loadVerdict(false, null)).toEqual({ play: false, reason: "no-webgpu", short: null });
    // Whatever the signals then say: there is nothing to ask an adapter of.
    expect(loadVerdict(false, { adapterStatus: "none", adapter: null, limits: null, features: null })).toEqual({ play: false, reason: "no-webgpu", short: null });
  });

  it("is not known until the signals are in", () => {
    expect(loadVerdict(true, null)).toBeNull();
  });

  it("reads the signals' adapter: play, software, or short by name", () => {
    expect(loadVerdict(true, ok())).toEqual({ play: true });
    expect(loadVerdict(true, ok({ adapter: { ...INFO, isFallbackAdapter: true } }))).toEqual({ play: false, reason: "software", short: null });
    expect(loadVerdict(true, ok({ limits: { ...DEFAULTS, maxTextureDimension2D: 4096 } }))).toEqual({ play: false, reason: "short", short: "maxTextureDimension2D 4096 < 8192" });
    // Features the signals could not read are none, not a failure of the read.
    expect(loadVerdict(true, ok({ features: null }))).toEqual(REQUIRED_FEATURES.length === 0 ? { play: true } : { play: false, reason: "short", short: REQUIRED_FEATURES[0] });
  });

  it("turns away a browser that has WebGPU and gave no adapter, or whose request failed", () => {
    const none = { adapter: null, limits: null, features: null };
    expect(loadVerdict(true, { adapterStatus: "none", ...none })).toEqual({ play: false, reason: "no-adapter", short: null });
    expect(loadVerdict(true, { adapterStatus: "rejected", ...none })).toEqual({ play: false, reason: "no-adapter", short: null });
  });

  it("never refuses on a request that has not answered: the verdict is not known, and the later answer decides", () => {
    expect(loadVerdict(true, { adapterStatus: "timed-out", adapter: null, limits: null, features: null })).toBeNull();
    expect(adapterVerdict(adapter())).toEqual({ play: true });
    expect(adapterVerdict(null)).toEqual({ play: false, reason: "no-adapter", short: null });
  });
});

describe("the load check on the page's own signals", () => {
  const gpu = (requestAdapter: () => Promise<unknown>) => ({ navigator: { userAgent: "", gpu: { requestAdapter } }, webgl: () => null });
  const real = (over: Record<string, unknown> = {}) => ({ info: { vendor: "nvidia", architecture: "ampere", isFallbackAdapter: false }, limits: DEFAULTS, features: new Set(REQUIRED_FEATURES), ...over });

  it("reads one request's answer through the signals, from a hardware adapter to none", async () => {
    expect(loadVerdict(true, await gatherSignals(gpu(async () => real())))).toEqual({ play: true });
    expect(loadVerdict(true, await gatherSignals(gpu(async () => real({ info: { isFallbackAdapter: true } }))))).toMatchObject({ play: false, reason: "software" });
    // An older browser says it on the adapter itself.
    expect(loadVerdict(true, await gatherSignals(gpu(async () => real({ info: {}, isFallbackAdapter: true }))))).toMatchObject({ play: false, reason: "software" });
    expect(loadVerdict(true, await gatherSignals(gpu(async () => null)))).toMatchObject({ play: false, reason: "no-adapter" });
    expect(loadVerdict(true, await gatherSignals(gpu(async () => { throw new Error("refused"); })))).toMatchObject({ play: false, reason: "no-adapter" });
  });

  it("waits on the same request where the signals went on without it, and asks for no second adapter", async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      const software = real({ info: { isFallbackAdapter: true } });
      const read = readSignals(gpu(() => (asked++, new Promise((resolve) => setTimeout(() => resolve(software), 3000)))));
      await vi.advanceTimersByTimeAsync(2000);
      const signals = await read.signals;
      // Not known yet: nothing is refused on the two seconds alone.
      expect(signals.adapterStatus).toBe("timed-out");
      expect(loadVerdict(true, signals)).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      // The same request's answer, when it comes, decides.
      expect(adapterVerdict(await read.adapter)).toEqual({ play: false, reason: "software", short: null });
      expect(asked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
