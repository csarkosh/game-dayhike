import { describe, it, expect, vi } from "vitest";
import {
  ADAPTER_TIMEOUT_MS,
  browserMajor,
  gatherSignals,
  hostOs,
  isChromeOrEdge,
  readSignals,
  isMobile,
  readRenderer,
  type NavigatorLike,
  type WebGLLike,
} from "../../src/game/gpuSignals.js";

/** A WebGL2 context answering RENDERER (0x1F01), if given the debug extension's
 * 0x9246, and `KHR_parallel_shader_compile` when `parallel` is set. */
function gl(renderer: string, unmasked: string | null, parallel = false) {
  const asked: string[] = [];
  let lost = 0;
  const ctx: WebGLLike = {
    RENDERER: 0x1f01,
    getParameter: (p) => (p === 0x1f01 ? renderer : p === 0x9246 ? unmasked : null),
    getExtension: (name) => {
      asked.push(name);
      if (name === "WEBGL_debug_renderer_info") return unmasked === null ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (name === "WEBGL_lose_context") return { loseContext: () => { lost += 1; } };
      if (name === "KHR_parallel_shader_compile") return parallel ? { COMPLETION_STATUS_KHR: 0x91b1 } : null;
      return null;
    },
  };
  return { ctx, asked, lost: () => lost };
}

describe("readRenderer", () => {
  it("unmasks Chrome's and Safari's generic RENDERER through the debug extension", () => {
    const g = gl("WebKit WebGL", "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)");
    expect(readRenderer(g.ctx)).toBe("ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)");
    expect(g.lost()).toBe(1);
  });

  it("takes Firefox's sanitised RENDERER as it is and never asks for the deprecated extension", () => {
    const g = gl("Apple M1, or similar", null);
    expect(readRenderer(g.ctx)).toBe("Apple M1, or similar");
    expect(g.asked).not.toContain("WEBGL_debug_renderer_info");
    expect(g.lost()).toBe(1);
  });

  it("says nothing when RENDERER is generic and the extension is absent, and still loses the context", () => {
    const g = gl("WebKit WebGL", null);
    expect(readRenderer(g.ctx)).toBe(null);
    expect(g.lost()).toBe(1);
  });

  it("asks the extension when RENDERER is empty", () => {
    const g = gl("", "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)");
    expect(readRenderer(g.ctx)).toBe("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)");
    expect(g.asked).toContain("WEBGL_debug_renderer_info");
    expect(g.lost()).toBe(1);
  });

  it("says nothing when getParameter throws, and still loses the context", () => {
    const g = gl("WebKit WebGL", null);
    const ctx: WebGLLike = { ...g.ctx, getParameter: () => { throw new Error("context lost"); } };
    expect(readRenderer(ctx)).toBe(null);
    expect(g.lost()).toBe(1);
  });

  it("survives a context whose lose extension throws", () => {
    const ctx: WebGLLike = {
      RENDERER: 0x1f01,
      getParameter: () => "Apple M1, or similar",
      getExtension: () => { throw new Error("gone"); },
    };
    expect(readRenderer(ctx)).toBe("Apple M1, or similar");
  });
});

describe("isMobile", () => {
  it("reads the client hint, the user agent, and an iPad's Mac user agent with touch", () => {
    expect(isMobile({ userAgentData: { mobile: true }, userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(true);
    expect(isMobile({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)" })).toBe(true);
    expect(isMobile({ userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10)" })).toBe(true);
    expect(isMobile({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
    expect(isMobile({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe(false);
    expect(isMobile({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 10 })).toBe(false);
    expect(isMobile(undefined)).toBe(false);
  });
});

describe("browserMajor", () => {
  it("reads Chrome, Firefox and Safari's majors", () => {
    expect(browserMajor("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36")).toBe(153);
    expect(browserMajor("Mozilla/5.0 (Macintosh; rv:145.0) Gecko/20100101 Firefox/145.0")).toBe(145);
    expect(browserMajor("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15")).toBe(26);
    expect(browserMajor("")).toBe(0);
  });
});

describe("isChromeOrEdge and hostOs, the browser and platform the WebGPU rule reads", () => {
  const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
  const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
  const EDGE_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0";
  const EDGE_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0";
  // The desktop launcher: Electron's default user agent (the app's name and
  // version, `Chrome/`, `Electron/`) with `DayHike/<version>` appended
  // (`desktop/main.cjs`).
  const LAUNCHER_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) day-hike-desktop/0.3.0 Chrome/152.0.0.0 Electron/44.1.1 Safari/537.36 DayHike/0.3.0";
  const LAUNCHER_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) day-hike-desktop/0.3.0 Chrome/152.0.0.0 Electron/44.1.1 Safari/537.36 DayHike/0.3.0";
  const OPERA_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/125.0.0.0";
  const VIVALDI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Vivaldi/7.9.3970.41";
  const BRAVE_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Brave/154";
  const SAMSUNG_ANDROID = "Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/136.0.0.0 Mobile Safari/537.36";
  const YANDEX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 YaBrowser/25.10.0.0 Safari/537.36";
  const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0";
  const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0";
  const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
  const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
  const CHROME_OS = "Mozilla/5.0 (X11; CrOS x86_64 16433.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
  const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1";

  it("reads the user agent where there is no client hint (Safari, Firefox, a page not served securely)", () => {
    const rows: [string, boolean, "mac" | "windows" | "other"][] = [
      [CHROME_MAC, true, "mac"],
      [CHROME_WINDOWS, true, "windows"],
      [EDGE_WINDOWS, true, "windows"],
      [EDGE_MAC, true, "mac"],
      [LAUNCHER_MAC, false, "mac"],
      [LAUNCHER_WINDOWS, false, "windows"],
      [OPERA_WINDOWS, false, "windows"],
      [VIVALDI_MAC, false, "mac"],
      [BRAVE_WINDOWS, false, "windows"],
      [SAMSUNG_ANDROID, false, "other"],
      [YANDEX_WINDOWS, false, "windows"],
      [SAFARI_MAC, false, "mac"],
      [FIREFOX_WINDOWS, false, "windows"],
      [FIREFOX_MAC, false, "mac"],
      // Chrome by name, on a platform the rule turns away.
      [CHROME_ANDROID, true, "other"],
      [CHROME_LINUX, true, "other"],
      [CHROME_OS, true, "other"],
      // Chrome on iOS is WebKit underneath, and names no `Chrome/`.
      [CHROME_IOS, false, "other"],
    ];
    for (const [userAgent, chromeOrEdge, os] of rows) {
      expect(isChromeOrEdge({ userAgent })).toBe(chromeOrEdge);
      expect(hostOs({ userAgent })).toBe(os);
    }
  });

  it("reads the client hint's brands where it lists any: Google Chrome or Microsoft Edge by name, and no other", () => {
    const grease = { brand: "Not)A;Brand" };
    const chromium = { brand: "Chromium" };
    expect(isChromeOrEdge({ userAgent: "", userAgentData: { brands: [grease, chromium, { brand: "Google Chrome" }] } })).toBe(true);
    expect(isChromeOrEdge({ userAgent: "", userAgentData: { brands: [grease, chromium, { brand: "Microsoft Edge" }] } })).toBe(true);
    // Brave, Opera and the launcher (an Electron build, which names no
    // product brand) are refused by their brands even with Chrome's user agent.
    expect(isChromeOrEdge({ userAgent: CHROME_WINDOWS, userAgentData: { brands: [grease, chromium, { brand: "Brave" }] } })).toBe(false);
    expect(isChromeOrEdge({ userAgent: CHROME_WINDOWS, userAgentData: { brands: [grease, chromium, { brand: "Opera" }] } })).toBe(false);
    expect(isChromeOrEdge({ userAgent: CHROME_MAC, userAgentData: { brands: [grease, chromium] } })).toBe(false);
    expect(isChromeOrEdge({ userAgent: LAUNCHER_MAC, userAgentData: { brands: [chromium, grease] } })).toBe(false);
    // A list present but empty says nothing, and the user agent is read.
    expect(isChromeOrEdge({ userAgent: CHROME_MAC, userAgentData: { brands: [] } })).toBe(true);
    expect(isChromeOrEdge({ userAgent: EDGE_WINDOWS, userAgentData: { brands: [] } })).toBe(true);
    expect(isChromeOrEdge({ userAgent: LAUNCHER_WINDOWS, userAgentData: { brands: [] } })).toBe(false);
    expect(isChromeOrEdge({ userAgent: OPERA_WINDOWS, userAgentData: { brands: [] } })).toBe(false);
  });

  it("prefers the client hint's platform where it names one", () => {
    expect(hostOs({ userAgent: CHROME_LINUX, userAgentData: { platform: "macOS" } })).toBe("mac");
    expect(hostOs({ userAgent: CHROME_MAC, userAgentData: { platform: "Windows" } })).toBe("windows");
    expect(hostOs({ userAgent: CHROME_MAC, userAgentData: { platform: "Linux" } })).toBe("other");
    expect(hostOs({ userAgent: CHROME_MAC, userAgentData: { platform: "Android" } })).toBe("other");
    expect(hostOs({ userAgent: CHROME_MAC, userAgentData: { platform: "Chrome OS" } })).toBe("other");
    expect(hostOs({ userAgent: CHROME_MAC, userAgentData: { platform: "" } })).toBe("mac");
  });

  it("is neither without a navigator, and never throws", () => {
    expect(isChromeOrEdge(undefined)).toBe(false);
    expect(hostOs(undefined)).toBe("other");
    const throwing = {
      get userAgent(): string {
        throw new Error("denied");
      },
      get userAgentData(): undefined {
        throw new Error("denied");
      },
    } as NavigatorLike;
    expect(isChromeOrEdge(throwing)).toBe(false);
    expect(hostOs(throwing)).toBe("other");
  });
});

describe("gatherSignals", () => {
  /** Limits as a browser has them: getters on the prototype, invisible to Object.keys. */
  function limits(): object {
    const proto = {
      get maxInterStageShaderVariables() { return 16; },
      get maxVertexBuffers() { return 8; },
    };
    return Object.create(proto) as object;
  }

  it("reads everything a desktop Chrome offers", async () => {
    const g = gl("WebKit WebGL", "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)", true);
    const signals = await gatherSignals({
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36",
        hardwareConcurrency: 10,
        deviceMemory: 16,
        maxTouchPoints: 0,
        userAgentData: { mobile: false },
        gpu: {
          requestAdapter: async () => ({
            info: { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false },
            limits: limits(),
            features: new Set(["texture-compression-bc", "timestamp-query"]),
          }),
        },
      },
      webgl: () => g.ctx,
    });
    expect(signals).toEqual({
      renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)",
      adapter: { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false },
      limits: { maxInterStageShaderVariables: 16, maxVertexBuffers: 8 },
      features: ["texture-compression-bc", "timestamp-query"],
      adapterStatus: "ok",
      parallelCompile: true,
      cores: 10,
      memoryGb: 16,
      mobile: false,
      browser: 153,
    });
  });

  it("reads whether the one WebGL2 context compiles off the page's thread, before the context is lost", async () => {
    // Firefox 156 answers the extension with null: every program links on the page's thread.
    const firefox = gl("Apple M1, or similar", null);
    let contexts = 0;
    const absent = await gatherSignals({ navigator: { userAgent: "" }, webgl: () => { contexts += 1; return firefox.ctx; } });
    expect(absent.parallelCompile).toBe(false);
    expect(absent.renderer).toBe("Apple M1, or similar");
    expect(contexts).toBe(1);
    expect(firefox.lost()).toBe(1);
    const chrome = gl("WebKit WebGL", "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)", true);
    const present = await gatherSignals({ navigator: { userAgent: "" }, webgl: () => chrome.ctx });
    expect(present.parallelCompile).toBe(true);
    expect(chrome.asked.indexOf("KHR_parallel_shader_compile")).toBeLessThan(chrome.asked.indexOf("WEBGL_lose_context"));
    expect(chrome.lost()).toBe(1);
  });

  it("knows nothing of parallel compiling without a WebGL2 context, or when getExtension throws", async () => {
    expect((await gatherSignals({ navigator: { userAgent: "" }, webgl: () => null })).parallelCompile).toBe(null);
    expect((await gatherSignals({ navigator: { userAgent: "" }, webgl: () => { throw new Error("no context"); } })).parallelCompile).toBe(null);
    const refusing: WebGLLike = {
      RENDERER: 0x1f01,
      getParameter: () => "Apple M1, or similar",
      getExtension: () => { throw new Error("gone"); },
    };
    const signals = await gatherSignals({ navigator: { userAgent: "" }, webgl: () => refusing });
    expect(signals.parallelCompile).toBe(null);
    expect(signals.renderer).toBe("Apple M1, or similar");
  });

  it("reports what is missing as missing, never as a small number", async () => {
    const signals = await gatherSignals({
      navigator: { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15" },
      webgl: () => null,
    });
    expect(signals).toEqual({
      renderer: null, adapter: null, limits: null, features: null, adapterStatus: "none", parallelCompile: null, cores: null, memoryGb: null, mobile: false, browser: 26,
    });
  });

  it("reads a fallback adapter from the legacy attribute when the info has none", async () => {
    const signals = await gatherSignals({
      navigator: {
        userAgent: "",
        gpu: {
          requestAdapter: async () => ({
            isFallbackAdapter: true,
            info: { vendor: "google", architecture: "swiftshader", device: "", description: "" },
            limits: {},
          }),
        },
      },
      webgl: () => null,
    });
    expect(signals.adapter).toEqual({ vendor: "google", architecture: "swiftshader", device: "", description: "", isFallbackAdapter: true });
    expect(signals.adapterStatus).toBe("ok");
  });

  it("gives up on an adapter that never answers", async () => {
    vi.useFakeTimers();
    try {
      const pending = gatherSignals({
        navigator: { userAgent: "", gpu: { requestAdapter: () => new Promise(() => undefined) } },
        webgl: () => null,
      });
      await vi.advanceTimersByTimeAsync(2000);
      const signals = await pending;
      expect(signals.adapter).toBe(null);
      expect(signals.adapterStatus).toBe("timed-out");
      expect(ADAPTER_TIMEOUT_MS).toBe(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a throwing requestAdapter and a null adapter", async () => {
    const answers = [async () => { throw new Error("refused"); }, async () => null];
    for (const requestAdapter of answers) {
      const signals = await gatherSignals({ navigator: { userAgent: "", gpu: { requestAdapter } }, webgl: () => null });
      expect(signals.adapter).toBe(null);
      expect(signals.limits).toBe(null);
    }
    const rejected = await gatherSignals({ navigator: { userAgent: "", gpu: { requestAdapter: answers[0]! } }, webgl: () => null });
    expect(rejected.adapterStatus).toBe("rejected");
    const none = await gatherSignals({ navigator: { userAgent: "", gpu: { requestAdapter: answers[1]! } }, webgl: () => null });
    expect(none.adapterStatus).toBe("none");
  });

  it("survives a requestAdapter that throws before it returns a promise", async () => {
    const signals = await gatherSignals({
      navigator: { userAgent: "", gpu: { requestAdapter: () => { throw new Error("not allowed"); } } },
      webgl: () => null,
    });
    expect(signals.adapter).toBe(null);
    expect(signals.limits).toBe(null);
    expect(signals.adapterStatus).toBe("rejected");
  });

  it("survives an adapter whose info cannot be read", async () => {
    const adapter = Object.defineProperty({}, "info", { get() { throw new Error("denied"); } });
    const signals = await gatherSignals({ navigator: { userAgent: "", gpu: { requestAdapter: async () => adapter } }, webgl: () => null });
    expect(signals.adapter).toBe(null);
    expect(signals.limits).toBe(null);
    expect(signals.adapterStatus).toBe("rejected");
  });

  it("survives a webgl() that throws", async () => {
    const signals = await gatherSignals({ navigator: { userAgent: "" }, webgl: () => { throw new Error("no context"); } });
    expect(signals.renderer).toBe(null);
  });

  it("survives a navigator whose every getter throws", async () => {
    const refuse = { get() { throw new Error("denied"); } };
    const nav = Object.defineProperties({}, {
      userAgent: refuse, hardwareConcurrency: refuse, deviceMemory: refuse, maxTouchPoints: refuse, userAgentData: refuse, gpu: refuse,
    }) as NavigatorLike;
    const signals = await gatherSignals({ navigator: nav, webgl: () => null });
    expect(signals).toEqual({
      renderer: null, adapter: null, limits: null, features: null, adapterStatus: "rejected", parallelCompile: null, cores: null, memoryGb: null, mobile: false, browser: 0,
    });
  });

  it("reads zero, negative and non-finite cores and memory as not reported", async () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const signals = await gatherSignals({ navigator: { userAgent: "", hardwareConcurrency: value, deviceMemory: value }, webgl: () => null });
      expect(signals.cores).toBe(null);
      expect(signals.memoryGb).toBe(null);
    }
    const small = await gatherSignals({ navigator: { userAgent: "", hardwareConcurrency: 2, deviceMemory: 0.25 }, webgl: () => null });
    expect(small.cores).toBe(2);
    expect(small.memoryGb).toBe(0.25);
  });
});

describe("the page's one adapter request", () => {
  const report = { limits: { maxVertexBuffers: 8 }, isFallbackAdapter: false, features: ["texture-compression-bc"] };
  const adapter = () => ({
    info: { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false },
    limits: { maxVertexBuffers: 8 },
    features: new Set(["texture-compression-bc"]),
  });

  it("gives the engine rule the signals' own adapter, asked for once", async () => {
    let asked = 0;
    const read = readSignals({
      navigator: { userAgent: "", gpu: { requestAdapter: async () => (asked++, adapter()) } },
      webgl: () => null,
    });
    expect((await read.signals).adapterStatus).toBe("ok");
    expect(await read.adapter).toEqual(report);
    expect(asked).toBe(1);
  });

  it("keeps waiting on the same request after the signals have gone without it", async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      const read = readSignals({
        navigator: {
          userAgent: "",
          gpu: { requestAdapter: () => (asked++, new Promise((resolve) => setTimeout(() => resolve(adapter()), 3000))) },
        },
        webgl: () => null,
      });
      let late: unknown = "pending";
      void read.adapter.then((answer) => (late = answer));
      await vi.advanceTimersByTimeAsync(2000);
      // "timed-out": not known yet, and the request is still the one running.
      expect((await read.signals).adapterStatus).toBe("timed-out");
      expect(late).toBe("pending");
      await vi.advanceTimersByTimeAsync(1000);
      expect(late).toEqual(report);
      expect(asked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers null for no WebGPU, no adapter, a failed request or an adapter it cannot read", async () => {
    const cases: NavigatorLike[] = [
      { userAgent: "" },
      { userAgent: "", gpu: { requestAdapter: async () => null } },
      { userAgent: "", gpu: { requestAdapter: async () => { throw new Error("refused"); } } },
      { userAgent: "", gpu: { requestAdapter: async () => Object.defineProperty({}, "info", { get() { throw new Error("denied"); } }) } },
    ];
    for (const navigator of cases) expect(await readSignals({ navigator, webgl: () => null }).adapter).toBe(null);
  });
});

