import { describe, it, expect, vi } from "vitest";
import { ADAPTER_TIMEOUT_MS, browserMajor, gatherSignals, isMobile, readRenderer, type WebGLLike } from "../../src/game/gpuSignals.js";

/** A WebGL2 context answering RENDERER (0x1F01) and, if given, the debug extension's 0x9246. */
function gl(renderer: string, unmasked: string | null) {
  const asked: string[] = [];
  let lost = 0;
  const ctx: WebGLLike = {
    RENDERER: 0x1f01,
    getParameter: (p) => (p === 0x1f01 ? renderer : p === 0x9246 ? unmasked : null),
    getExtension: (name) => {
      asked.push(name);
      if (name === "WEBGL_debug_renderer_info") return unmasked === null ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (name === "WEBGL_lose_context") return { loseContext: () => { lost += 1; } };
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

  it("says nothing when RENDERER is generic and the extension is absent", () => {
    expect(readRenderer(gl("WebKit WebGL", null).ctx)).toBe(null);
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
    const g = gl("WebKit WebGL", "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)");
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
          }),
        },
      },
      webgl: () => g.ctx,
    });
    expect(signals).toEqual({
      renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)",
      adapter: { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false },
      limits: { maxInterStageShaderVariables: 16, maxVertexBuffers: 8 },
      cores: 10,
      memoryGb: 16,
      mobile: false,
      browser: 153,
    });
  });

  it("reports what is missing as missing, never as a small number", async () => {
    const signals = await gatherSignals({
      navigator: { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15" },
      webgl: () => null,
    });
    expect(signals).toEqual({ renderer: null, adapter: null, limits: null, cores: null, memoryGb: null, mobile: false, browser: 26 });
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
  });

  it("gives up on an adapter that never answers", async () => {
    vi.useFakeTimers();
    try {
      const pending = gatherSignals({
        navigator: { userAgent: "", gpu: { requestAdapter: () => new Promise(() => undefined) } },
        webgl: () => null,
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect((await pending).adapter).toBe(null);
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
  });
});
