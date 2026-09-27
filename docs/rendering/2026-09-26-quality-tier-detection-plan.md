# Quality Tier Detection Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every player starts on the highest tier their GPU holds at 60 Hz at the standard poses, confirmed by the frame where the browser will not name the GPU; the player can see and change the tier from the title and pause screens, and a change made mid-hike is applied live without a reload or a dropped session.

**Architecture:** One function gathers the browser's GPU signals; an ordered rule table turns them into a GPU class; each class has a start tier, a ceiling and a probe flag. A probed class with no stored verdict gets a short measurement of the canopy pose before its first hike. A shared Settings screen on the title and pause screens stores the player's choice; from the pause screen Apply rebuilds the renderer on a fresh canvas behind an "Applying…" screen while the session runs on. A governor lowers the next hike's tier after a sustained low frame rate. Nothing under `sim/`.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`Engine`, `NullEngine` in tests), WebGL2 and WebGPU browser APIs, vitest 4.

**Spec:** `docs/rendering/2026-09-26-quality-tier-detection-design.md`

## Global Constraints

- No file under `client/src/sim/` or `client/src/net/` changes; the level id does not move (`passHash` −311867473, pinned in `client/test/sim/groundGradient.test.ts:700`); `PROTOCOL_VERSION` stays 5.
- Every numeric or string expectation in a test is a literal, never the constant it pins. vitest 4 takes a test's timeout as the third argument: `it("…", () => { … }, 20_000)`.
- The pure modules (`gpuSignals.ts`, `gpuClass.ts`, `quality.ts`, `tierChoice.ts`, `frameProbe.ts`, `governor.ts`, `settings.ts`) import nothing from `@babylonjs`; each new one is added to `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`.
- Every `localStorage` / `sessionStorage` access is inside `try`/`catch`, as `playerName.ts` does it.
- DOM is built with `createElement` and `textContent`, never `innerHTML` (`landing.ts`'s and `pauseMenu.ts`'s rule).
- Before every commit: `npm run typecheck`, the touched test files (`cd client && npx vitest run <files>`), and `npx eslint <touched files>` green.
- Stage explicit paths only, never `git add -A` or `git add .`.
- Commit format: type-prefixed subject under 72 characters, a blank line, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then the repository's two attribution trailer lines (shown below as `<trailers>`).
- Public repository: no code comment, doc or commit message describes how an asset was made or the process around the work; write for an engineer reading the code.
- Measurement patches (Task 7) are applied for a gate and reverted after it; `git status --porcelain` is clean before any commit.
- **The WebGPU work** lives on its own branch and may land before or after this. Steps marked **(WebGPU)** apply only once `client/src/game/engineChoice.ts` is on `main`. Where this plan and that branch both define a thing (`parseTierOverride`, `browserMajor`, the adapter request, `RendererOptions.engine`, `GameOptions.tier`), whichever lands second deletes its own copy and imports the other's.

## File map

| File | Task | Change |
| --- | --- | --- |
| `client/src/game/gpuSignals.ts` (new) | 1 | `GpuSignals`, `AdapterInfo`, `gatherSignals`, `readRenderer`, `isMobile`, `browserMajor`, `browserEnv` |
| `client/src/game/gpuClass.ts` (new) | 1, 2 | `GpuClass`, `classifyGpu`, `gpuIdentity`; `CLASS_TIERS` |
| `client/test/game/gpuFixtures.ts` (new) | 1 | The renderer strings and adapter infos every matrix reads |
| `client/test/game/gpuSignals.test.ts`, `gpuClass.test.ts` (new) | 1, 2 | Gathering with fakes; the class and tier matrices |
| `client/src/game/quality.ts` | 2 | `tierFor` and `Capabilities` removed; `autoTier`, `AutoRecord`, `AutoVerdict`, `DETECT_VERSION`, `verdictHolds` |
| `client/src/game/tierChoice.ts` (new) | 2, 3, 4 | `parseTierOverride`, `parseProbeOverride`, `resolveTier`, the Auto record's read and write; the player's choice's read and write |
| `client/src/game/renderer.ts` | 2, 5 | `detectTier` removed, `tier ?? "low"`; `loseContextOnDispose`; `RendererOptions.engine` |
| `client/src/main.ts` | 2, 3, 4, 5 | Signals at load; the tier resolved before `startGame`; the probe; the Settings panel; the engine hook (WebGPU) |
| `client/src/app.ts` | 2, 4, 5, 6 | `GameOptions.tier` and `quality`; the pause Settings; the live swap; the governor |
| `client/test/game/quality.test.ts`, `tierChoice.test.ts` (new), `tierDeterminism.test.ts` (new) | 2 | `autoTier` and the record; precedence; the determinism pin |
| `ARCHITECTURE.md` | 2, 4, 5 | The detection sentence; the Settings screen; the live swap |
| `client/src/game/frameProbe.ts`, `probeScene.ts`, `probeScreen.ts` (new) | 3 | The probe's arithmetic, its scene, its screen |
| `client/test/game/frameProbe.test.ts`, `probeScene.test.ts` (new) | 3 | |
| `client/src/game/settings.ts` (new) | 4, 5 | `settingsModel`, `renderSettings` |
| `client/src/game/landingModel.ts`, `landing.ts`, `router.ts` | 4 | The Settings entry, panel and route |
| `client/src/game/pauseMenu.ts` | 4, 5 | `pauseMenuModel`; the Settings button and panel; Apply |
| `client/test/game/settings.test.ts`, `pauseMenu.test.ts` (new); `landingModel.test.ts`, `router.test.ts` | 4, 5 | |
| `client/src/game/canvasBinding.ts`, `rendererSwap.ts` (new); `input.ts`, `touchControls.ts` | 5 | `bindCanvas`; `swapRenderer`; `rebind` on the sampler and the touch layer |
| `client/test/game/canvasBinding.test.ts`, `rendererSwap.test.ts` (new); `input.test.ts`; `client/test/net/sessionStall.test.ts` (new) | 5 | The leak, order, fallback, rebind and co-op tests |
| `client/src/game/governor.ts`, `client/test/game/governor.test.ts` (new) | 6 | |
| `client/test/architecture.test.ts` | 1–6 | The new pure files; the new modules kept out of `sim/` and `net/` |
| `docs/rendering/<date>-quality-tier-detection-verification.md` (new), dated the day the gate runs | 7 | The gate |

---

### Task 1: Gather the signals and name the GPU class

**Files:**
- Create: `client/src/game/gpuSignals.ts`, `client/src/game/gpuClass.ts`
- Create: `client/test/game/gpuFixtures.ts`, `client/test/game/gpuSignals.test.ts`, `client/test/game/gpuClass.test.ts`
- Modify: `client/test/architecture.test.ts` (`BABYLON_FREE_FILES` gains `gpuSignals.ts`, `gpuClass.ts`)

**Interfaces:**
- Consumes: nothing of the game.
- Produces:

```ts
// gpuSignals.ts
export type AdapterInfo = { vendor: string; architecture: string; device: string; description: string; isFallbackAdapter: boolean };
export type GpuSignals = {
  renderer: string | null;
  adapter: AdapterInfo | null;
  limits: Readonly<Record<string, number>> | null;
  cores: number | null;
  memoryGb: number | null;
  mobile: boolean;
  browser: number;
};
export type WebGLLike = { readonly RENDERER: number; getParameter(p: number): unknown; getExtension(name: string): unknown };
export type NavigatorLike = {
  userAgent?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
  gpu?: { requestAdapter(options: { powerPreference: "high-performance" }): Promise<unknown> };
};
export type SignalEnv = { navigator: NavigatorLike | undefined; webgl(): WebGLLike | null };
export const ADAPTER_TIMEOUT_MS = 2000;
export function readRenderer(gl: WebGLLike): string | null;
export function isMobile(nav: NavigatorLike | undefined): boolean;
export function browserMajor(userAgent: string): number;
export function gatherSignals(env: SignalEnv): Promise<GpuSignals>;
/** The page's environment: `globalThis.navigator`, and a throwaway canvas's "webgl2" context. */
export function browserEnv(): SignalEnv;

// gpuClass.ts
export type GpuClass =
  | "mobile" | "software" | "discrete-legacy" | "integrated-older" | "integrated-unknown"
  | "integrated-modern" | "apple-base" | "discrete-older" | "unknown" | "apple-unknown"
  | "discrete-unknown" | "apple-large" | "discrete-modern";
export function classifyGpu(signals: Pick<GpuSignals, "renderer" | "adapter" | "mobile">): GpuClass;
export function gpuIdentity(signals: Pick<GpuSignals, "renderer" | "adapter">): string;
```

- [ ] **Step 1: Write the fixtures**

`client/test/game/gpuFixtures.ts` (a helper, no `it`):

```ts
import type { AdapterInfo } from "../../src/game/gpuSignals.js";

export const M4 = "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)";
export const M3_MAX = "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)";
export const M2_PRO = "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)";
export const SAFARI = "Apple GPU";
export const FF_APPLE = "Apple M1, or similar";
export const RTX_3060 = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const GTX_1060 = "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x00001C03) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const GT_730 = "ANGLE (NVIDIA, NVIDIA GeForce GT 730 (0x00001287) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const FF_NVIDIA = "ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar";
export const RX_6700 = "ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const RX_580 = "ANGLE (AMD, Radeon RX 580 Series (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const RADEON_780M = "ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const RADEON_BARE = "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const UHD_620 = "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const IRIS_XE = "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const ARC_IGPU = "ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const ARC_A770 = "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)";
export const IRIS_PLUS_MAC = "ANGLE (Intel, ANGLE Metal Renderer: Intel(R) Iris(TM) Plus Graphics 655, Unspecified Version)";
export const FF_INTEL = "ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar";
export const FF_AMD = "ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar";
export const SWIFTSHADER = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
export const LLVMPIPE = "llvmpipe (LLVM 15.0.7, 256 bits)";
export const ADRENO_X1 = "ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)";

export function adapter(vendor: string, architecture: string, isFallbackAdapter = false): AdapterInfo {
  return { vendor, architecture, device: "", description: "", isFallbackAdapter };
}
```

- [ ] **Step 2: Write the failing tests**

`client/test/game/gpuSignals.test.ts`:

```ts
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
```

`client/test/game/gpuClass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyGpu, gpuIdentity, type GpuClass } from "../../src/game/gpuClass.js";
import type { AdapterInfo } from "../../src/game/gpuSignals.js";
import * as F from "./gpuFixtures.js";

type Row = [label: string, renderer: string | null, adapter: AdapterInfo | null, mobile: boolean, want: GpuClass];

export const CLASS_ROWS: Row[] = [
  ["Chrome, Apple M4", F.M4, null, false, "apple-base"],
  ["Chrome, Apple M3 Max", F.M3_MAX, null, false, "apple-large"],
  ["Chrome, Apple M2 Pro", F.M2_PRO, null, false, "apple-large"],
  ["Safari", F.SAFARI, null, false, "apple-unknown"],
  ["Firefox, any Apple GPU", F.FF_APPLE, null, false, "apple-unknown"],
  ["RTX 3060", F.RTX_3060, null, false, "discrete-modern"],
  ["GTX 1060", F.GTX_1060, null, false, "discrete-older"],
  ["GT 730", F.GT_730, null, false, "discrete-legacy"],
  ["Firefox, NVIDIA 900 series and up", F.FF_NVIDIA, null, false, "discrete-unknown"],
  ["RX 6700 XT", F.RX_6700, null, false, "discrete-modern"],
  ["RX 580", F.RX_580, null, false, "discrete-older"],
  ["Radeon 780M", F.RADEON_780M, null, false, "integrated-modern"],
  ["bare Radeon Graphics, RDNA 2", F.RADEON_BARE, F.adapter("amd", "rdna-2"), false, "integrated-modern"],
  ["bare Radeon Graphics, GCN 5", F.RADEON_BARE, F.adapter("amd", "gcn-5"), false, "integrated-older"],
  ["bare Radeon Graphics, no adapter", F.RADEON_BARE, null, false, "integrated-unknown"],
  ["UHD 620", F.UHD_620, null, false, "integrated-older"],
  ["Iris Xe", F.IRIS_XE, null, false, "integrated-unknown"],
  ["Arc integrated", F.ARC_IGPU, null, false, "integrated-modern"],
  ["Arc A770", F.ARC_A770, null, false, "discrete-modern"],
  ["an Intel Mac's Iris Plus 655", F.IRIS_PLUS_MAC, null, false, "integrated-older"],
  ["Firefox, Intel", F.FF_INTEL, null, false, "integrated-unknown"],
  ["Firefox, AMD", F.FF_AMD, null, false, "unknown"],
  ["SwiftShader", F.SWIFTSHADER, null, false, "software"],
  ["llvmpipe", F.LLVMPIPE, null, false, "software"],
  ["Snapdragon X", F.ADRENO_X1, null, false, "integrated-modern"],
  ["adapter only, Ampere", null, F.adapter("nvidia", "ampere"), false, "discrete-modern"],
  ["adapter only, Turing", null, F.adapter("nvidia", "turing"), false, "discrete-unknown"],
  ["adapter only, Apple", null, F.adapter("apple", "common-3"), false, "apple-unknown"],
  ["adapter only, fallback", null, F.adapter("google", "swiftshader", true), false, "software"],
  ["adapter only, Gen 12 LP", null, F.adapter("intel", "gen-12lp"), false, "integrated-unknown"],
  ["nothing at all", null, null, false, "unknown"],
  ["a phone", F.SAFARI, null, true, "mobile"],
  ["a fallback adapter beside a real renderer", F.RTX_3060, F.adapter("google", "swiftshader", true), false, "discrete-modern"],
];

describe("classifyGpu", () => {
  it.each(CLASS_ROWS)("%s", (_label, renderer, adapter, mobile, want) => {
    expect(classifyGpu({ renderer, adapter, mobile })).toBe(want);
  });
});

describe("gpuIdentity", () => {
  it("is the renderer, else vendor/architecture, else empty", () => {
    expect(gpuIdentity({ renderer: F.M4, adapter: F.adapter("apple", "common-3") })).toBe(F.M4);
    expect(gpuIdentity({ renderer: null, adapter: F.adapter("nvidia", "ampere") })).toBe("nvidia/ampere");
    expect(gpuIdentity({ renderer: null, adapter: null })).toBe("");
  });
});
```

In `client/test/architecture.test.ts`, add `join(SRC, "game", "gpuSignals.ts")` and `join(SRC, "game", "gpuClass.ts")` to `BABYLON_FREE_FILES`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/gpuSignals.test.ts test/game/gpuClass.test.ts test/architecture.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Implement**

`gpuSignals.ts`:

- `readRenderer(gl)`: `const plain = gl.getParameter(gl.RENDERER)`; a string other than `"WebKit WebGL"` is returned as it is. Otherwise `gl.getExtension("WEBGL_debug_renderer_info")`; if it answers, `gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)` when that is a non-empty string, else null. In a `finally`, `gl.getExtension("WEBGL_lose_context")?.loseContext()`, so the context is lost on every path.
- `isMobile(nav)`: `nav?.userAgentData?.mobile === true`, or the user agent matches `/Mobi|Android|iPhone|iPad/`, or it matches `/Macintosh/` with `(nav.maxTouchPoints ?? 0) > 1`.
- `browserMajor(ua)`: the first of `Chrome/`, `Firefox/`, `Version/` followed by digits, else 0.
- `gatherSignals(env)`: the renderer from `env.webgl()` in a `try` (a null context or a throw → null); the adapter by `Promise.race` of `nav.gpu.requestAdapter({ powerPreference: "high-performance" })` against a `setTimeout(…, ADAPTER_TIMEOUT_MS)` resolving null, all inside `try`, the timer cleared after; from an adapter: the four `info` strings (missing → `""`), `isFallbackAdapter` from `info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false`, and every numeric limit by `for (const name in adapter.limits)`; `cores` and `memoryGb` where `typeof` is `"number"`, else null; `mobile`, `browser` as above.
- `browserEnv()`: `{ navigator: globalThis.navigator, webgl: () => document.createElement("canvas").getContext("webgl2") }`.

`gpuClass.ts`: `classifyGpu` is design §5.2's 27 rows in order: mobile, then the software pattern (case-insensitive), then the `, or similar` buckets (rows 3–8), then one list of `[RegExp, GpuClass | ((adapter: AdapterInfo | null) => GpuClass)]` for rows 9–25, then the adapter rows (26) when the renderer is null or matched nothing, then `"unknown"`. `gpuIdentity` as tested.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/gpuSignals.test.ts test/game/gpuClass.test.ts test/architecture.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/gpuSignals.ts client/src/game/gpuClass.ts client/test/game/gpuFixtures.ts client/test/game/gpuSignals.test.ts client/test/game/gpuClass.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: read the GPU the browser names and sort it into a class

## What

The tier was picked from cores and memory, which say nothing about the
GPU. This reads what each browser will say about it (the WebGL renderer
string, the WebGPU adapter's info and limits, cores, memory, mobile)
and sorts it into one of thirteen classes by an ordered rule table,
with a class of its own wherever a browser masks or buckets the name.

## How

- `client/src/game/gpuSignals.ts` — `gatherSignals` behind a plain
  environment; the throwaway context is lost; the adapter waits 2 s.
- `client/src/game/gpuClass.ts` — `classifyGpu`, `gpuIdentity`.
- `client/test/game/gpuFixtures.ts`, `gpuSignals.test.ts`,
  `gpuClass.test.ts` — real renderer strings, one row per rule.
- `client/test/architecture.test.ts` — both modules Babylon-free.

<trailers>
EOF
```

---

### Task 2: From class to tier, the verdict, and the determinism pin

**Files:**
- Modify: `client/src/game/gpuClass.ts` (`CLASS_TIERS`)
- Modify: `client/src/game/quality.ts` (remove `tierFor`, `Capabilities`; add `autoTier` and the record)
- Create: `client/src/game/tierChoice.ts` (the override, the record's storage, `resolveTier`)
- Modify: `client/src/game/renderer.ts` (remove `detectTier` at 512–526 and its `tierFor` import; `const tier = options.tier ?? "low";` at 690)
- Modify: `client/src/app.ts` (`GameOptions.tier`, passed to `createRenderer` at 153)
- Modify: `client/src/main.ts` (signals at load; the tier resolved before `startGame`; `render` becomes token-guarded)
- Modify: `ARCHITECTURE.md` (the detection sentence, line 23)
- Test: `client/test/game/quality.test.ts`, `client/test/game/gpuClass.test.ts`, `client/test/game/tierChoice.test.ts` (new), `client/test/game/tierDeterminism.test.ts` (new), `client/test/architecture.test.ts`

**Interfaces:**
- Consumes: `classifyGpu`, `gpuIdentity`, `GpuSignals` (Task 1).
- Produces:

```ts
// gpuClass.ts
export type ClassTiers = { start: QualityTier; ceiling: QualityTier; probe: boolean };
export const CLASS_TIERS: Readonly<Record<GpuClass, ClassTiers>>;

// quality.ts
export const DETECT_VERSION = 1;
export const VERDICT_DAYS = 30;
export const PROBE_PIXEL_SLACK = 1.5;
export const PROBE_ATTEMPTS = 3;
export type ProbeReading = { tier: QualityTier; frames: number; meanMs: number; p95Ms: number; pixels: number; engine: "webgl2" | "webgpu" };
export type AutoVerdict = { tier: QualityTier; source: "probe" | "governor"; pixels: number; at: number; readings?: ProbeReading[] };
export type AutoRecord = { v: number; gpu: string; cls: GpuClass; browser: number; attempts: number; verdict: AutoVerdict | null };
export type AutoInput = { cls: GpuClass; cores: number | null; memoryGb: number | null; record: AutoRecord | null; gpu: string; browser: number; pixels: number; now: number };
export function recordMatches(record: AutoRecord | null, gpu: string, browser: number, cls: GpuClass): boolean;
export function verdictHolds(verdict: AutoVerdict, pixels: number, now: number): boolean;
export function autoTier(input: AutoInput): { tier: QualityTier; probeFrom: QualityTier | null };

// tierChoice.ts
export const AUTO_KEY = "dayhike.quality.auto";
export function parseTierOverride(search: string): QualityTier | null;
export function readAutoRecord(storage: Storage | null): AutoRecord | null;
export function writeAutoRecord(storage: Storage | null, record: AutoRecord): boolean;
export type TierSource = "override" | "choice" | "auto";
export function resolveTier(input: { override: QualityTier | null; choice: "auto" | QualityTier; auto: QualityTier }): { tier: QualityTier; source: TierSource };

// app.ts
export type GameOptions = { /* … */ tier: QualityTier };
```

- [ ] **Step 1: Write the failing tests**

`client/test/game/gpuClass.test.ts` — import `CLASS_TIERS` and `autoTier`, and add:

```ts
describe("CLASS_TIERS", () => {
  it("gives every class its start, ceiling and probe flag", () => {
    expect(CLASS_TIERS).toEqual({
      mobile: { start: "low", ceiling: "low", probe: false },
      software: { start: "low", ceiling: "low", probe: false },
      "discrete-legacy": { start: "low", ceiling: "low", probe: false },
      "integrated-older": { start: "low", ceiling: "low", probe: false },
      "integrated-unknown": { start: "low", ceiling: "medium", probe: true },
      "integrated-modern": { start: "medium", ceiling: "medium", probe: false },
      "apple-base": { start: "medium", ceiling: "medium", probe: false },
      "discrete-older": { start: "medium", ceiling: "medium", probe: false },
      unknown: { start: "medium", ceiling: "high", probe: true },
      "apple-unknown": { start: "medium", ceiling: "high", probe: true },
      "discrete-unknown": { start: "medium", ceiling: "high", probe: true },
      "apple-large": { start: "high", ceiling: "high", probe: false },
      "discrete-modern": { start: "high", ceiling: "high", probe: false },
    });
  });
});

/** Auto's tier and probe start for each CLASS_ROWS input, in that order, with no record. */
const TIER_WANT: [QualityTier, QualityTier | null][] = [
  ["medium", null], ["high", null], ["high", null], ["medium", "high"], ["medium", "high"],
  ["high", null], ["medium", null], ["low", null], ["medium", "high"], ["high", null],
  ["medium", null], ["medium", null], ["medium", null], ["low", null], ["low", "medium"],
  ["low", null], ["low", "medium"], ["medium", null], ["high", null], ["low", null],
  ["low", "medium"], ["medium", "high"], ["low", null], ["low", null], ["medium", null],
  ["high", null], ["medium", "high"], ["medium", "high"], ["low", null], ["low", "medium"],
  ["medium", "high"], ["low", null], ["high", null],
];

describe("the detection matrix, signals to tier", () => {
  it.each(CLASS_ROWS.map((row, i) => [...row, ...TIER_WANT[i]!] as const))(
    "%s",
    (_label, renderer, adapter, mobile, _cls, tier, probeFrom) => {
      const cls = classifyGpu({ renderer, adapter, mobile });
      const got = autoTier({ cls, cores: null, memoryGb: null, record: null, gpu: "", browser: 153, pixels: 2_073_600, now: 1_790_000_000_000 });
      expect(got).toEqual({ tier, probeFrom });
    },
  );

  it("caps a class at low on two cores or two gigabytes, and does not probe it", () => {
    const base = { record: null, gpu: "", browser: 153, pixels: 2_073_600, now: 1_790_000_000_000 };
    expect(autoTier({ ...base, cls: "discrete-modern", cores: 2, memoryGb: 16 })).toEqual({ tier: "low", probeFrom: null });
    expect(autoTier({ ...base, cls: "apple-base", cores: 10, memoryGb: 2 })).toEqual({ tier: "low", probeFrom: null });
    expect(autoTier({ ...base, cls: "apple-unknown", cores: 2, memoryGb: null })).toEqual({ tier: "low", probeFrom: null });
  });
});
```

`client/test/game/quality.test.ts` — keep the `QUALITY` block; replace the `tierFor` block with:

```ts
import { autoTier, recordMatches, verdictHolds, type AutoRecord, type AutoVerdict } from "../../src/game/quality.js";

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;
const SAFARI = "Apple GPU";

function rec(verdict: Partial<AutoVerdict> | null, over: Partial<AutoRecord> = {}): AutoRecord {
  return {
    v: 1,
    gpu: SAFARI,
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

  it("stops probing after three attempts without a verdict", () => {
    expect(auto(rec(null, { attempts: 2 }))).toEqual({ tier: "medium", probeFrom: "high" });
    expect(auto(rec(null, { attempts: 3 }))).toEqual({ tier: "medium", probeFrom: null });
  });

  it("holds a governor drop at any window size, on a class that is never probed", () => {
    const rtx = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    const record = rec({ tier: "medium", source: "governor", pixels: 500_000 }, { gpu: rtx, browser: 153 });
    const got = autoTier({ cls: "discrete-modern", cores: 16, memoryGb: 32, record, gpu: rtx, browser: 153, pixels: 8_000_000, now: NOW });
    expect(got).toEqual({ tier: "medium", probeFrom: null });
  });

  it("never takes a verdict above the class's ceiling", () => {
    const xe = "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)";
    const record = rec({ tier: "high" }, { gpu: xe, browser: 153 });
    const got = autoTier({ cls: "integrated-unknown", cores: 8, memoryGb: 16, record, gpu: xe, browser: 153, pixels: 2_073_600, now: NOW });
    expect(got).toEqual({ tier: "medium", probeFrom: null });
  });

  it("matches a record by version, GPU and browser, and holds a verdict by age and size", () => {
    expect(recordMatches(rec({}), SAFARI, 26)).toBe(true);
    expect(recordMatches(rec({}), SAFARI, 25)).toBe(false);
    expect(recordMatches(null, SAFARI, 26)).toBe(false);
    const v = rec({})!.verdict!;
    expect(verdictHolds(v, 3_110_400, NOW)).toBe(true);
    expect(verdictHolds(v, 3_110_401, NOW)).toBe(false);
    expect(verdictHolds({ ...v, source: "governor" }, 9_000_000, NOW)).toBe(true);
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
```

(`CLASS_TIERS` and `GpuClass` imported from `gpuClass.js` in this file too.)

`client/test/game/tierChoice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTierOverride, readAutoRecord, resolveTier, writeAutoRecord } from "../../src/game/tierChoice.js";
import type { AutoRecord } from "../../src/game/quality.js";

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

const RECORD: AutoRecord = {
  v: 1, gpu: "Apple GPU", browser: 26, attempts: 1,
  verdict: { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000,
    readings: [{ tier: "high", frames: 120, meanMs: 23.96, p95Ms: 33.4, pixels: 2_073_600, engine: "webgl2" }] },
};

describe("the override", () => {
  it("reads ?tier= and nothing else", () => {
    expect(parseTierOverride("?tier=high")).toBe("high");
    expect(parseTierOverride("?cmd=seed%20atmo&tier=low")).toBe("low");
    expect(parseTierOverride("?tier=ultra")).toBe(null);
    expect(parseTierOverride("")).toBe(null);
  });
});

describe("the Auto record's storage", () => {
  it("round-trips a record under dayhike.quality.auto", () => {
    const s = memoryStorage();
    expect(writeAutoRecord(s, RECORD)).toBe(true);
    expect(s.getItem("dayhike.quality.auto")).not.toBe(null);
    expect(readAutoRecord(s)).toEqual(RECORD);
  });

  it("reads nothing from bad JSON, a record of another shape, no storage, or a storage that throws", () => {
    const s = memoryStorage();
    s.setItem("dayhike.quality.auto", "{not json");
    expect(readAutoRecord(s)).toBe(null);
    s.setItem("dayhike.quality.auto", JSON.stringify({ v: 1, gpu: "x" }));
    expect(readAutoRecord(s)).toBe(null);
    expect(readAutoRecord(null)).toBe(null);
    expect(readAutoRecord(throwingStorage())).toBe(null);
    expect(writeAutoRecord(throwingStorage(), RECORD)).toBe(false);
    expect(writeAutoRecord(null, RECORD)).toBe(false);
  });
});

describe("resolveTier", () => {
  it("puts the override over the choice and the choice over Auto", () => {
    expect(resolveTier({ override: "low", choice: "high", auto: "medium" })).toEqual({ tier: "low", source: "override" });
    expect(resolveTier({ override: null, choice: "high", auto: "medium" })).toEqual({ tier: "high", source: "choice" });
    expect(resolveTier({ override: null, choice: "auto", auto: "medium" })).toEqual({ tier: "medium", source: "auto" });
  });
});
```

`client/test/game/tierDeterminism.test.ts` — the two `vi.mock` blocks at the top of `renderer.test.ts` (the `groundMaps.js` stub and `engine.js` → `NullEngine`), copied as they are, then:

```ts
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, serializeWorldState, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { Level } from "../../src/sim/level.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { QualityTier } from "../../src/game/quality.js";

const LEVEL: Level = { id: "tier-determinism", brushes: [], playerSpawns: [], enemySpawns: [] };
const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;
const ATMO = 627994160;

function run(tier: QualityTier | null): { state: string; passHash: number } {
  const forest = createForest(ATMO);
  const world = createForestWorld(forest);
  const player = spawnPlayer(world);
  const renderer = tier === null ? null : createRenderer(FAKE_CANVAS, LEVEL, forest, { tier });
  try {
    for (let t = 0; t < 120; t++) {
      tickWorld(world, new Map([[player.id, { seq: t + 1, moveX: 0, moveZ: 1, yaw: 0.3, pitch: 0, buttons: 0 }]]));
      renderer?.sync(world.state, player.id, 0.5, { dt: 1 / 60, sprinting: false });
    }
    return { state: serializeWorldState(world.state), passHash: forest.passHash };
  } finally {
    renderer?.dispose();
  }
}

describe("the tier is drawing only", () => {
  it("steps one world, to the byte, whatever tier draws it or none", () => {
    const bare = run(null);
    expect(bare.passHash).toBe(-311867473);
    for (const tier of ["low", "medium", "high"] as const) expect(run(tier)).toEqual(bare);
  }, 120_000);
});
```

`client/test/architecture.test.ts`:

- `BABYLON_FREE_FILES` gains `tierChoice.ts`.
- Add:

```ts
  it("keeps the quality modules out of sim/ and net/", () => {
    const quality = /game\/(quality|gpuSignals|gpuClass|tierChoice|frameProbe|governor|rendererSwap|settings)(\.js)?$/;
    expect(violations(join(SRC, "sim"), [quality])).toEqual([]);
    expect(violations(join(SRC, "net"), [quality])).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/gpuClass.test.ts test/game/quality.test.ts test/game/tierChoice.test.ts test/game/tierDeterminism.test.ts test/architecture.test.ts`
Expected: FAIL — `CLASS_TIERS`, `autoTier` and `tierChoice.ts` do not exist; `createRenderer` still detects (the determinism test passes already for the right reason and is kept as the pin).

- [ ] **Step 3: Implement**

`gpuClass.ts`: `CLASS_TIERS` as the test's literal, with the design §6.1 "why" column as a comment per row. It takes `QualityTier` by `import type`, so `quality.ts` importing `CLASS_TIERS` makes no runtime cycle.

`quality.ts`:

- Delete `Capabilities` and `tierFor` and their doc comment. The file's header comment says the tier is chosen from the GPU (`gpuClass.ts`), confirmed by a probe where the GPU cannot be named, and chosen by the player in Settings.
- `recordMatches(r, gpu, browser)`: `r !== null && r.v === DETECT_VERSION && r.gpu === gpu && r.browser === browser`.
- `verdictHolds(v, pixels, now)`: `now - v.at < VERDICT_DAYS * 86_400_000 && (v.source === "governor" || pixels <= v.pixels * PROBE_PIXEL_SLACK)`.
- `autoTier(input)`: `row = CLASS_TIERS[input.cls]`; `capped = (cores !== null && cores <= 2) || (memoryGb !== null && memoryGb <= 2)`; `ceiling = capped ? "low" : row.ceiling`; `start = min(row.start, ceiling)`. If `recordMatches` and the verdict holds: `{ tier: min(verdict.tier, ceiling), probeFrom: null }`. Else, if `row.probe && ceiling !== start && attempts < PROBE_ATTEMPTS` (attempts from a matching record, else 0): `{ tier: start, probeFrom: ceiling }`. Else `{ tier: start, probeFrom: null }`. `min` over the order low < medium < high.

`tierChoice.ts`: `AUTO_KEY`; `parseTierOverride` (`URLSearchParams(search).get("tier")`, one of the three or null); `readAutoRecord` (`getItem` → `JSON.parse` → a shape check of every field, `verdict` null or complete, `readings` absent or an array; any throw → null); `writeAutoRecord` (`setItem(AUTO_KEY, JSON.stringify(r))`, false on null storage or a throw); `resolveTier` as tested.

`renderer.ts`: delete `detectTier` (512–526) and the `tierFor` import; at 690 `const tier = options.tier ?? "low";` with the comment "A caller that has decided nothing gets low, as the landing backdrop asks for anyway; the page always decides (`main.ts`)."

`app.ts`: `GameOptions` gains `tier: QualityTier` (documented: "The tier `main.ts` resolved: `?tier=`, the player's choice, or Auto."); `createRenderer(canvas, level, forest, { tier: options.tier })`.

`main.ts`:

- At module load, beside `selfId`: `const signalsReady: Promise<GpuSignals> = gatherSignals(browserEnv());` and `let signals: GpuSignals | null = null; void signalsReady.then((s) => { signals = s; });`.
- Storage through `pageStorage()` from `tierChoice.ts`, the one guarded `localStorage` accessor (the WebGPU branch has the same as `safeStorage`; whichever lands second keeps one, see Global Constraints).
- `function pageTier(s: GpuSignals, container: HTMLElement): { tier: QualityTier; source: TierSource; cls: GpuClass; probeFrom: QualityTier | null }`: `cls = classifyGpu(s)`, `gpu = gpuIdentity(s)`, `auto = autoTier({ cls, cores: s.cores, memoryGb: s.memoryGb, record: readAutoRecord(pageStorage()), gpu, browser: s.browser, pixels: containerPixels(container), now: Date.now() })`, `resolveTier({ override: parseTierOverride(location.search), choice: "auto", auto: auto.tier })`.
- `render`: a module-level `let renderToken = 0`, bumped at the top of `render`. The game branch awaits `signalsReady` and returns if the token moved; then `const { tier, source, cls } = pageTier(…)`, `console.info(\`quality: ${tier} (${source}, ${cls}), engine webgl2\`)`, and `startGame(canvas, route.token, { …, tier })`. **(WebGPU)** `launch` takes this `tier` in place of `parseTierOverride(location.search) ?? detectTier(navigator)`; the log line names the engine the rule chose; `detectTier` in `quality.ts` is deleted with its test.

`ARCHITECTURE.md` line 23: "the tier is auto-detected from the device's CPU core count, memory and whether it looks like a mobile browser" becomes "the tier is chosen from the GPU the browser names (`gpuSignals.ts`, `gpuClass.ts`), confirmed by a short measurement where the browser will not name it."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/gpuClass.test.ts test/game/quality.test.ts test/game/tierChoice.test.ts test/game/tierDeterminism.test.ts test/game/renderer.test.ts test/architecture.test.ts`
Expected: all pass. `renderer.test.ts`'s low-tier assertions (wildlife at the low tier's radius) hold, because a renderer with no tier is low as it was under Node, where `detectTier` read no memory.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/gpuClass.ts client/src/game/quality.ts client/src/game/tierChoice.ts client/src/game/renderer.ts client/src/app.ts client/src/main.ts ARCHITECTURE.md client/test/game/gpuClass.test.ts client/test/game/quality.test.ts client/test/game/tierChoice.test.ts client/test/game/tierDeterminism.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: choose the starting tier from the GPU class

## What

Cores and memory put the same machine on three tiers depending on the
browser: high on a recent Chrome whatever its GPU, low on every Safari
and Firefox. The tier now follows the GPU class, with a start tier and
a ceiling per class, a stored verdict that holds per GPU and browser,
and ?tier= over everything for testing. A test pins that the tier never
reaches the simulation.

## How

- `client/src/game/gpuClass.ts` — `CLASS_TIERS`.
- `client/src/game/quality.ts` — `autoTier`, the Auto record and when
  its verdict holds; `tierFor` removed.
- `client/src/game/tierChoice.ts` — the override, the record's storage,
  `resolveTier`.
- `client/src/main.ts`, `client/src/app.ts`, `client/src/game/renderer.ts`
  — the tier resolved before the game is built and logged once.
- `client/test/game/tierDeterminism.test.ts` — one world, one state, on
  every tier.
- `client/test/game/gpuClass.test.ts`, `quality.test.ts`,
  `tierChoice.test.ts`, `client/test/architecture.test.ts`,
  `ARCHITECTURE.md`.

<trailers>
EOF
```

---

### Task 3: The startup probe

**Files:**
- Create: `client/src/game/frameProbe.ts` (the arithmetic and `runProbe`, the probe's order of record writes, pure), `client/src/game/probeScene.ts` (the scene, Babylon), `client/src/game/probeScreen.ts` (the "Setting up graphics…" screen, DOM)
- Modify: `client/src/game/quality.ts` (`containerPixels`, `withProbeStarted`, `withVerdict`)
- Modify: `client/src/game/tierChoice.ts` (`parseProbeOverride`)
- Modify: `client/src/main.ts` (the probe before `startGame`)
- Test: `client/test/game/frameProbe.test.ts` (new), `client/test/game/probeScene.test.ts` (new), `client/test/game/quality.test.ts`, `client/test/game/tierChoice.test.ts`, `client/test/architecture.test.ts` (`frameProbe.ts` Babylon-free)

**Interfaces:**
- Consumes: `autoTier`, `AutoRecord`, `ProbeReading` (Task 2); `createRenderer`; `createForest`, `createWorld`, `parseLevel`, `setActiveTerrainVariant`, `elevationAt` (sim); `seedFromToken`; `WEATHER_PRESETS`.
- Produces:

```ts
// frameProbe.ts
export const PROBE_HOLD_MS = 17.5;
export const PROBE_WARMUP_FRAMES = 60;
export const PROBE_FRAMES = 120;
export const PROBE_MIN_FRAMES = 100;
export const PROBE_STALL_MS = 250;
export const PROBE_QUIET_MS = 1500;
export const PROBE_READY_MAX_MS = 15_000;
export const PROBE_MAX_MS = 30_000;
export const PROBE_SEED_TOKEN = "atmo";
export const PROBE_HOUR = 12;
export type ProbeStats = { frames: number; meanMs: number; p95Ms: number };
export function readIntervals(intervals: readonly number[]): ProbeStats | null;
export function probeHolds(stats: { meanMs: number }): boolean;
export function nextProbeStep(ceiling: QualityTier, readings: readonly ProbeReading[]): { measure: QualityTier } | { verdict: QualityTier };
export function probePose(): { x: number; y: number; z: number; yaw: number; pitch: number };
export type ProbeKey = { gpu: string; browser: number; cls: GpuClass };
export type ProbeDeps = {
  storage: Storage | null;
  runStep(tier: QualityTier): Promise<ProbeReading | null>;
  pixels(): number;   // containerPixels(container)
  now(): number;
};
/** The tier to start the hike at: the verdict, or `start` when the probe cannot run or is abandoned. */
export function runProbe(from: QualityTier, start: QualityTier, record: AutoRecord | null, key: ProbeKey, deps: ProbeDeps): Promise<QualityTier>;

// quality.ts
/** The game container's CSS area, the one measure of the window for a verdict's `pixels` and `AutoInput.pixels`. */
export function containerPixels(container: { clientWidth: number; clientHeight: number }): number;
export function withProbeStarted(prev: AutoRecord | null, gpu: string, browser: number, cls: GpuClass): AutoRecord;
/** Null for a verdict with `pixels <= 0`: an area of nothing certifies nothing, and would never hold again. */
export function withVerdict(prev: AutoRecord | null, gpu: string, browser: number, cls: GpuClass, verdict: AutoVerdict): AutoRecord | null;

// tierChoice.ts
export function parseProbeOverride(search: string): QualityTier | null; // ?probe=high|medium

// probeScene.ts
export function buildProbeScene(canvas: HTMLCanvasElement, tier: QualityTier, engine?: AbstractEngine): { renderer: Renderer; frame(): void; dispose(): void };
export function runProbeStep(container: HTMLElement, tier: QualityTier, opts: { engine?: AbstractEngine; cancelled(): boolean }): Promise<ProbeReading | null>;

// probeScreen.ts
export function showProbeScreen(container: HTMLElement): { dispose(): void };
```

- [ ] **Step 1: Write the failing tests**

`client/test/game/frameProbe.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { nextProbeStep, probeHolds, probePose, readIntervals } from "../../src/game/frameProbe.js";
import type { ProbeReading } from "../../src/game/quality.js";

const f = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);
const reading = (tier: "high" | "medium", meanMs: number): ProbeReading =>
  ({ tier, frames: 120, meanMs, p95Ms: meanMs, pixels: 2_073_600, engine: "webgl2" });

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
```

`client/test/game/quality.test.ts` — add:

```ts
describe("the record through a probe", () => {
  it("counts a started probe and clears the count with a verdict", () => {
    const started = withProbeStarted(null, "Apple GPU", 26, "apple-unknown");
    expect(started).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 1, verdict: null });
    expect(withProbeStarted(started, "Apple GPU", 26, "apple-unknown").attempts).toBe(2);
    expect(withProbeStarted(started, "Apple GPU", 27, "apple-unknown").attempts).toBe(1);
    expect(withProbeStarted(started, "Apple GPU", 26, "apple-base").attempts).toBe(1);
    const verdict: AutoVerdict = { tier: "medium", source: "probe", pixels: 2_073_600, at: 1_790_000_000_000 };
    expect(withVerdict(started, "Apple GPU", 26, "apple-unknown", verdict)).toEqual({ v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0, verdict });
  });

  it("refuses a verdict over no area, and measures the window one way", () => {
    const started = withProbeStarted(null, "Apple GPU", 26, "apple-unknown");
    expect(withVerdict(started, "Apple GPU", 26, "apple-unknown", { tier: "medium", source: "probe", pixels: 0, at: 1_790_000_000_000 })).toBe(null);
    expect(containerPixels({ clientWidth: 1920, clientHeight: 1080 })).toBe(2_073_600);
    expect(containerPixels({ clientWidth: 0, clientHeight: 1080 })).toBe(0);
  });
});
```

`client/test/game/frameProbe.test.ts` — also add, with `memoryStorage` and `throwingStorage` as in `tierChoice.test.ts`:

```ts
describe("runProbe and the Auto record", () => {
  const KEY = { gpu: "Apple GPU", browser: 26, cls: "apple-unknown" } as const;
  const reading = (tier: QualityTier, meanMs: number): ProbeReading =>
    ({ tier, frames: 120, meanMs, p95Ms: meanMs, pixels: 2_073_600, engine: "webgl2" });

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
});
```

`client/test/game/tierChoice.test.ts` — add:

```ts
describe("the probe override", () => {
  it("reads ?probe=high or medium", () => {
    expect(parseProbeOverride("?probe=high")).toBe("high");
    expect(parseProbeOverride("?probe=medium")).toBe("medium");
    expect(parseProbeOverride("?probe=low")).toBe(null);
    expect(parseProbeOverride("")).toBe(null);
  });
});
```

`client/test/game/probeScene.test.ts` — the two `vi.mock` blocks from `renderer.test.ts`, then:

```ts
import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { buildProbeScene } from "../../src/game/probeScene.js";

const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

describe("buildProbeScene", () => {
  it("puts the camera on the canopy pose at the tier asked, and leaves no engine behind", () => {
    const probe = buildProbeScene(FAKE_CANVAS, "medium");
    probe.frame();
    const cam = probe.renderer.camera;
    expect(cam.position.x).toBeCloseTo(123, 6);
    expect(cam.position.z).toBeCloseTo(-105.5, 6);
    expect(cam.position.y).toBeCloseTo(110.87, 2);
    expect(cam.rotation.y).toBeCloseTo(1.571, 6);
    expect(cam.rotation.x).toBeCloseTo(0.3, 6);
    probe.dispose();
    expect(EngineStore.Instances.length).toBe(0);
  }, 60_000);
});
```

`client/test/architecture.test.ts`: `BABYLON_FREE_FILES` gains `frameProbe.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/frameProbe.test.ts test/game/probeScene.test.ts test/game/quality.test.ts test/game/tierChoice.test.ts test/architecture.test.ts`
Expected: FAIL — the modules and functions do not exist.

- [ ] **Step 3: Implement**

`frameProbe.ts`: the constants; `readIntervals` (drop `> PROBE_STALL_MS`; fewer than `PROBE_MIN_FRAMES` left → null; the mean; `p95` the sorted value at `Math.ceil(0.95 * n) - 1`); `probeHolds` (`meanMs <= PROBE_HOLD_MS`); `nextProbeStep` (design §7.5); `probePose()` (`seed = seedFromToken(PROBE_SEED_TOKEN)`, `y = elevationAt(seed, 123, -105.5) + 1.6`; the comment names the pose as every rendering note's canopy pose).

`quality.ts`: `containerPixels` (`clientWidth * clientHeight`, 0 for a container not laid out); `withProbeStarted` (a record matching by `recordMatches` with `attempts + 1`, else a fresh `{ v: DETECT_VERSION, gpu, cls, browser, attempts: 1, verdict: null }`); `withVerdict` (null when `verdict.pixels <= 0`; else the same identity, `attempts: 0`, the verdict).

`frameProbe.ts`, `runProbe`, in this order, each pinned by a test above:

1. `pixels = deps.pixels()`; `pixels <= 0` returns `start` with nothing written (a window with no area certifies nothing, and its verdict would never hold again).
2. `writeAutoRecord(deps.storage, withProbeStarted(record, …key))` **before the first `await`**, so a tab closed mid-probe has still spent its attempt. A write that returns false returns `start` without a single step: a storage that refuses writes reads back no attempts on every load, and would otherwise probe before every hike.
3. The steps: `nextProbeStep(from, readings)`, `await deps.runStep(tier)` for each `measure`; a null reading abandons, returning `start` with the attempt standing.
4. The verdict: `withVerdict(started, …key, { tier, source: "probe", pixels, at: deps.now(), readings })`, the same `pixels` as step 1 (`containerPixels`, as `AutoInput.pixels` reads it, so the verdict holds on the next load at the same window), written when non-null; the verdict's tier returned.

`tierChoice.ts`: `parseProbeOverride`.

`probeScene.ts`:

- `buildProbeScene(canvas, tier, engine?)`: `setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT)`; `seed = seedFromToken(PROBE_SEED_TOKEN)`; the forest, the stub level and a non-authoritative world as `landingScene.ts` builds them; `createRenderer(canvas, level, forest, { tier, engine })`; `setWeather(WEATHER_PRESETS.mist, 0)`, `setHour(PROBE_HOUR)`; `frame()` sets the free camera to `probePose()`, `sync(world.state, -1, 0)`, `scene.render()`; `dispose()` disposes the renderer.
- `runProbeStep(container, tier, opts)`: a fresh canvas appended to `container`; `buildProbeScene`; `engine.runRenderLoop` with a callback that records `performance.now()` deltas once warm; the ready check each frame (`scene.isReady()`, `scene.getWaitingItemsCount() === 0`, `PROBE_QUIET_MS` since the last `onAfterShaderCompilationObservable`), abandoned at `PROBE_READY_MAX_MS`; `PROBE_WARMUP_FRAMES` skipped, `PROBE_FRAMES` recorded; `readIntervals` → the reading (`pixels` the container's CSS area, `engine` from the engine's class) or null; the renderer disposed and the canvas removed in a `finally`; `opts.cancelled()` checked every frame.

`probeScreen.ts`: one `STYLE` literal (full cover over the container, `z-index` above the canvas, the landing's flat ground `#101014`, the pause menu's monospace type) and one line, "Setting up graphics…"; `dispose` removes both.

`main.ts`, in the game branch after the tier is resolved (Task 2):

```ts
const forced = parseProbeOverride(location.search);
const from = decided.source === "auto" ? (forced ?? decided.probeFrom) : null;
if (from !== null) {
  tier = await probeTier(container, from, s, decided);   // below
  if (token !== renderToken) return;
}
```

`probeTier`: `showProbeScreen(container)`; a `setTimeout(PROBE_MAX_MS)` that sets a `cancelled` flag; `runProbe(from, start, record, { gpu, browser, cls }, { storage: pageStorage(), runStep: (tier) => runProbeStep(container, tier, { cancelled }), pixels: () => containerPixels(container), now: Date.now })`, where `runProbeStep` answers null on a cancel or a throw (so the attempt stands and the hike starts at the class's start tier). One `console.info` per reading (`quality probe: high 23.96 ms mean, 33.4 p95, 120 frames, 1920×1080, webgl2 → misses`) and one for the verdict (`quality probe: verdict medium (apple-unknown)`). The screen is disposed in a `finally`. **(WebGPU)** each `runProbeStep` gets the engine the rule gives its tier, made on the step's canvas; a failure there is the rule's `init` failure and the step runs on WebGL2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/frameProbe.test.ts test/game/probeScene.test.ts test/game/quality.test.ts test/game/tierChoice.test.ts test/architecture.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/frameProbe.ts client/src/game/probeScene.ts client/src/game/probeScreen.ts client/src/game/quality.ts client/src/game/tierChoice.ts client/src/main.ts client/test/game/frameProbe.test.ts client/test/game/probeScene.test.ts client/test/game/quality.test.ts client/test/game/tierChoice.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: measure the canopy pose once where the GPU has no name

## What

Safari, Firefox and a few unrecognised GPUs give no name good enough to
pick a tier from. Before such a machine's first hike, the heaviest
standard view is rendered for a few seconds behind a "Setting up
graphics…" screen, from the class's ceiling down, and the first tier
whose mean frame holds 60 Hz is remembered for that GPU and browser.

## How

- `client/src/game/frameProbe.ts` — the reading, the 17.5 ms hold, the
  steps, the pose.
- `client/src/game/probeScene.ts`, `probeScreen.ts` — the scene on a
  fresh canvas, the screen over it.
- `client/src/game/quality.ts`, `tierChoice.ts` — the attempt count and
  the verdict; `?probe=` for the gate.
- `client/src/main.ts` — the probe runs before the game is built.
- `client/test/game/frameProbe.test.ts`, `probeScene.test.ts`,
  `quality.test.ts`, `tierChoice.test.ts`, `client/test/architecture.test.ts`.

<trailers>
EOF
```

---

### Task 4: The Settings screen, on the title and the pause screens

This task ships the screen with the pause screen saving a choice for the next hike; Task 5 replaces that with Apply.

**Files:**
- Create: `client/src/game/settings.ts` (`settingsModel`, `renderSettings`)
- Modify: `client/src/game/tierChoice.ts` (`TierChoice`, `QUALITY_KEY`, `readChoice`, `writeChoice`; `resolveTier` takes a `TierChoice`)
- Modify: `client/src/game/landingModel.ts` (`LandingInput.quality`, `LandingView.settings`, `LandingView.settingsPage`)
- Modify: `client/src/game/landing.ts` (`LandingPanel` gains `"settings"`; the Settings button between Downloads and Credits; the Settings panel; the panel CSS selectors at 42–49 gain `.panel.settings`)
- Modify: `client/src/game/router.ts` (`Panel` and `Route` gain `settings`; `parseRoute` routes `/settings`)
- Modify: `client/src/game/pauseMenu.ts` (`pauseMenuModel`; the Settings button; the Settings panel; Escape)
- Modify: `client/src/main.ts` (`isLandingRoute`, `panelFor`, the handlers; the choice in `pageTier` and in `landingInput`)
- Modify: `client/src/app.ts` (`GameOptions.quality`; the pause menu's settings)
- Modify: `ARCHITECTURE.md` (one sentence on the Settings screen)
- Test: `client/test/game/settings.test.ts` (new), `client/test/game/pauseMenu.test.ts` (new), `client/test/game/landingModel.test.ts`, `client/test/game/router.test.ts`, `client/test/game/tierChoice.test.ts`, `client/test/architecture.test.ts` (`settings.ts` Babylon-free)

**Interfaces:**
- Consumes: `resolveTier`, `autoTier`, `QualityTier`.
- Produces:

```ts
// tierChoice.ts
export type TierChoice = "auto" | QualityTier;
export const QUALITY_KEY = "dayhike.quality";
export function readChoice(storage: Storage | null): { choice: TierChoice; stored: boolean };
export function writeChoice(storage: Storage | null, choice: TierChoice): boolean;

// settings.ts
export const TIER_CHOICES: readonly TierChoice[]; // ["auto", "high", "medium", "low"]
export type AutoSummary = { tier: QualityTier; probePending: boolean };
export type SettingsInput = {
  context: "title" | "pause";
  choice: TierChoice;
  auto: AutoSummary | null;
  running?: QualityTier;
  override: QualityTier | null;
  stored: boolean;
};
export type SettingsView = {
  heading: string;
  group: string;
  choices: { choice: TierChoice; label: string; selected: boolean; disabled: boolean }[];
  lines: string[];
  back: { label: string; disabled: boolean };
};
export function settingsModel(input: SettingsInput): SettingsView;
export function renderSettings(root: HTMLElement, view: SettingsView, handlers: { onChoose(choice: TierChoice): void; onBack(): void }): { setView(view: SettingsView): void; dispose(): void };

// landingModel.ts
export type LandingInput = { /* … */ quality?: Omit<SettingsInput, "context" | "running"> };
export type LandingView = { /* … */ settings: { label: string }; settingsPage: SettingsView };

// pauseMenu.ts
export function pauseMenuModel(): { title: string; buttons: { id: "resume" | "settings" | "exit"; label: string }[] };
export function createPauseMenu(container: HTMLElement, options: {
  onResume(): void;
  onExit(): void;
  settings: { view(): SettingsView; onChoose(choice: TierChoice): void };
}): PauseMenu;

// app.ts
export type GameOptions = { /* … */ quality: {
  choice(): TierChoice; stored(): boolean; auto(): AutoSummary | null; override: QualityTier | null; save(choice: TierChoice): void;
} };
```

- [ ] **Step 1: Write the failing tests**

`client/test/game/settings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TIER_CHOICES, settingsModel } from "../../src/game/settings.js";

const CHOICES = (selected: string) => [
  { choice: "auto", label: "Auto (Recommended)", selected: selected === "auto", disabled: false },
  { choice: "high", label: "High", selected: selected === "high", disabled: false },
  { choice: "medium", label: "Medium", selected: selected === "medium", disabled: false },
  { choice: "low", label: "Low", selected: selected === "low", disabled: false },
];

describe("settingsModel", () => {
  it("offers Auto first, then High, Medium and Low, and names what Auto picked", () => {
    expect(TIER_CHOICES).toEqual(["auto", "high", "medium", "low"]);
    expect(
      settingsModel({ context: "title", choice: "auto", auto: { tier: "medium", probePending: false }, override: null, stored: true }),
    ).toEqual({
      heading: "Settings",
      group: "Graphics",
      choices: CHOICES("auto"),
      lines: ["Auto picks Medium on this computer."],
      back: { label: "Back", disabled: false },
    });
  });

  it("says when Auto will test the machine, and says nothing of Auto before the signals land", () => {
    const pending = settingsModel({ context: "title", choice: "high", auto: { tier: "medium", probePending: true }, override: null, stored: true });
    expect(pending.choices).toEqual(CHOICES("high"));
    expect(pending.lines).toEqual(["Auto tests this computer when your next hike starts."]);
    expect(settingsModel({ context: "title", choice: "auto", auto: null, override: null, stored: true }).lines).toEqual([]);
  });

  it("puts the override first and the storage line last", () => {
    const v = settingsModel({ context: "title", choice: "low", auto: { tier: "high", probePending: false }, override: "high", stored: false });
    expect(v.lines).toEqual([
      "The address sets High (?tier=high), which overrides this setting.",
      "Auto picks High on this computer.",
      "This browser is not keeping settings, so this choice lasts until the page closes.",
    ]);
  });

  it("on the pause screen, names the running tier and when a change applies", () => {
    const v = settingsModel({ context: "pause", choice: "auto", auto: { tier: "medium", probePending: false }, running: "high", override: null, stored: true });
    expect(v.lines).toEqual([
      "Auto picks Medium on this computer.",
      "This hike is using High.",
      "Applies the next time you start a hike.",
    ]);
  });
});
```

`client/test/game/pauseMenu.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pauseMenuModel } from "../../src/game/pauseMenu.js";

describe("pauseMenuModel", () => {
  it("offers Resume, Settings and Exit, in that order", () => {
    expect(pauseMenuModel()).toEqual({
      title: "Paused",
      buttons: [
        { id: "resume", label: "Resume" },
        { id: "settings", label: "Settings" },
        { id: "exit", label: "Exit" },
      ],
    });
  });
});
```

`client/test/game/landingModel.test.ts` — add:

```ts
describe("the Settings entry", () => {
  it("is on every build, for a follower too, and carries the title screen's Settings page", () => {
    const inputs = [
      { desktop: false, host: "darwin-arm64" as const, latest: null },
      { desktop: true, host: "win32-x64" as const, latest: null, appVersion: "1.2.0" },
      { desktop: false, host: "other" as const, latest: null, touch: true },
      { desktop: false, host: "darwin-arm64" as const, latest: null, follower: true },
    ];
    for (const input of inputs) {
      const view = landingModel(input);
      expect(view.settings).toEqual({ label: "Settings" });
      expect(view.settingsPage.heading).toBe("Settings");
      expect(view.settingsPage.choices.map((c) => c.selected)).toEqual([true, false, false, false]);
    }
  });

  it("paints the player's choice and Auto's pick on the Settings page", () => {
    const view = landingModel({
      desktop: false, host: "darwin-arm64", latest: null,
      quality: { choice: "low", auto: { tier: "medium", probePending: false }, override: null, stored: true },
    });
    expect(view.settingsPage.choices.map((c) => c.selected)).toEqual([false, false, false, true]);
    expect(view.settingsPage.lines).toEqual(["Auto picks Medium on this computer."]);
  });
});
```

`client/test/game/router.test.ts` — in `describe("parseRoute")`:

```ts
  it("routes /settings to the Settings panel", () => {
    expect(parseRoute("/settings", "/")).toEqual({ kind: "settings" });
    expect(parseRoute("/dayhike/settings/", BASE)).toEqual({ kind: "settings" });
  });
```

`client/test/game/tierChoice.test.ts` — add:

```ts
describe("the player's choice", () => {
  it("is Auto until one is saved, and round-trips under dayhike.quality", () => {
    const s = memoryStorage();
    expect(readChoice(s)).toEqual({ choice: "auto", stored: true });
    expect(writeChoice(s, "high")).toBe(true);
    expect(s.getItem("dayhike.quality")).toBe("high");
    expect(readChoice(s)).toEqual({ choice: "high", stored: true });
    s.setItem("dayhike.quality", "ultra");
    expect(readChoice(s)).toEqual({ choice: "auto", stored: true });
  });

  it("falls back to Auto, not remembered, where storage is missing or throws", () => {
    expect(readChoice(null)).toEqual({ choice: "auto", stored: false });
    expect(readChoice(throwingStorage())).toEqual({ choice: "auto", stored: false });
    expect(writeChoice(throwingStorage(), "low")).toBe(false);
  });
});
```

`client/test/architecture.test.ts`: `BABYLON_FREE_FILES` gains `settings.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/settings.test.ts test/game/pauseMenu.test.ts test/game/landingModel.test.ts test/game/router.test.ts test/game/tierChoice.test.ts test/architecture.test.ts`
Expected: FAIL — `settings.ts`, `pauseMenuModel`, `readChoice`, the settings route and the landing fields do not exist.

- [ ] **Step 3: Implement**

`tierChoice.ts`: `TierChoice`, `QUALITY_KEY`; `readChoice` (`getItem(QUALITY_KEY)`; one of the four strings → it, anything else → `"auto"`; `stored: true` unless the storage is null or throws); `writeChoice` (`setItem`, false on null or a throw). `resolveTier`'s `choice` becomes `TierChoice`.

`settings.ts`:

- `TIER_CHOICES`; labels `{ auto: "Auto (Recommended)", high: "High", medium: "Medium", low: "Low" }`; a capitalised tier name for the lines.
- `settingsModel` builds the lines in design §8.2's order: the override line when `override !== null`; `Auto tests this computer when your next hike starts.` when `auto?.probePending`, else `Auto picks ${Tier} on this computer.` when `auto !== null`; on `pause`, `This hike is using ${Tier}.` then `Applies the next time you start a hike.`; the storage line when `!stored`.
- `renderSettings(root, view, handlers)`: an `h2` (the heading, as the landing's panels head theirs), a `p.group` for the group label, a `div.choices` of four `<button type="button" class="choice">` with `aria-pressed` for `selected`, one `p.line` per line, a Back `<button>`; `setView` rebuilds the choices and lines in place (the heading does not flicker, as `renderLanding` keeps its title). One `STYLE` literal for what is the component's own: `.settings .choices` a wrapping row with the host's gap; `.settings button.choice[aria-pressed="true"]` in `var(--btn-fill-lit)` and `var(--btn-edge-lit)`; `.settings .line` in the landing's caption colour `rgba(255, 255, 255, 0.62)`. The buttons take the host's `button` rules and tokens; nothing else is restyled.

`landingModel.ts`: `quality` defaults to `{ choice: "auto", auto: null, override: null, stored: true }`; `view.settings = { label: "Settings" }` always; `view.settingsPage = settingsModel({ context: "title", ...quality })`.

`landing.ts`: the Settings panel `div.panel.settings` built once like Credits, painted by `renderSettings` with `onChoose: handlers.onChooseTier` and `onBack: handlers.onBack`, repainted from `v.settingsPage` in `paint`; the home panel's Settings button (`class="secondary settings"`) after Downloads and before Credits; `showPanel` toggles `show-settings`; every `.panel.downloads, .panel.credits` selector in the style literal gains `.panel.settings`, and every `.show-downloads, .show-credits` gains `.show-settings`. The handlers gain `onSettings()` and `onChooseTier(choice)`.

`router.ts`: `Panel` gains `"settings"`, `Route` gains `{ kind: "settings" }`, `parseRoute` maps `/settings`.

`main.ts`: `isLandingRoute` and `panelFor` take `settings`; `onSettings: () => navigateToPanel("settings")`; `onChooseTier: (c) => { saveChoice(c); repaintLanding(); }`, where `saveChoice` writes through `writeChoice` and, when that fails, keeps `c` in a module-level `sessionChoice`; `currentChoice()` is `sessionChoice ?? readChoice(pageStorage()).choice`. `pageTier` resolves with `choice: currentChoice()`, and the probe runs only on Auto (it already checks `source === "auto"`). `landingInput` passes `quality: { choice: currentChoice(), auto: autoSummary(), override: parseTierOverride(location.search), stored }`, with `autoSummary()` null until the signals land and then `{ tier, probePending: probeFrom !== null }` from `autoTier`; the landing repaints when `signalsReady` resolves. `startGame` gets `quality` with the same five members.

`pauseMenu.ts`: `pauseMenuModel` as tested, and `createPauseMenu` builds its buttons from it. The root holds two panels, the existing one as `.panel.main` and a `.panel.settings` painted by `renderSettings`; `show-settings` on the root swaps them with the fade the landing's panels use, carried into this file's own `STYLE` literal; the Settings button repaints the panel from `settings.view()` and shows it; `onChoose` calls `settings.onChoose` and repaints; Back returns to `.panel.main`. `show()` always opens on `.panel.main`. Escape: with the Settings panel showing, it goes back; otherwise it resumes, as now.

`app.ts`: `GameOptions.quality`; `createPauseMenu(container, { onResume, onExit, settings: { view: () => settingsModel({ context: "pause", choice: options.quality.choice(), auto: options.quality.auto(), running: tier, override: options.quality.override, stored: options.quality.stored() }), onChoose: options.quality.save } })`, where `tier` is `options.tier`.

`ARCHITECTURE.md`, after the quality-tier sentence: "The player can set the tier in Settings, on the title screen and the pause screen (`settings.ts`); Auto is the default."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/settings.test.ts test/game/pauseMenu.test.ts test/game/landingModel.test.ts test/game/router.test.ts test/game/tierChoice.test.ts test/architecture.test.ts`
Expected: all pass; the existing `landingModel` tests pass unchanged, `quality` being optional.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/settings.ts client/src/game/tierChoice.ts client/src/game/landingModel.ts client/src/game/landing.ts client/src/game/router.ts client/src/game/pauseMenu.ts client/src/main.ts client/src/app.ts ARCHITECTURE.md client/test/game/settings.test.ts client/test/game/pauseMenu.test.ts client/test/game/landingModel.test.ts client/test/game/router.test.ts client/test/game/tierChoice.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: add a Settings screen to choose the graphics tier

## What

Nothing let a player see or change the tier. Settings on the title
screen and on the pause screen now open one screen with Auto
(Recommended), High, Medium and Low, a line naming what Auto picked,
and the choice kept in localStorage. From the title screen it applies
to the hike Play starts; from the pause screen, to the next hike.

## How

- `client/src/game/settings.ts` — `settingsModel`, `renderSettings`.
- `client/src/game/tierChoice.ts` — the choice under dayhike.quality.
- `client/src/game/landingModel.ts`, `landing.ts`, `router.ts` — the
  entry, the panel and /settings.
- `client/src/game/pauseMenu.ts` — `pauseMenuModel`; the panel.
- `client/src/main.ts`, `client/src/app.ts`, `ARCHITECTURE.md`.
- `client/test/game/settings.test.ts`, `pauseMenu.test.ts`,
  `landingModel.test.ts`, `router.test.ts`, `tierChoice.test.ts`,
  `client/test/architecture.test.ts`.

<trailers>
EOF
```

---

### Task 5: Apply a tier mid-hike by rebuilding the renderer

**Files:**
- Create: `client/src/game/canvasBinding.ts` (`bindCanvas`), `client/src/game/rendererSwap.ts` (`swapRenderer`, `whenSceneReady`)
- Modify: `client/src/game/input.ts` (the canvas listeners through `bindCanvas`; `InputSampler.rebind`)
- Modify: `client/src/game/touchControls.ts` (the same; `TouchLayer.rebind`)
- Modify: `client/src/game/renderer.ts` (`new Engine(canvas, true, { stencil: true, loseContextOnDispose: true }, true)` at 647; `RendererOptions.engine`, used in place of a new `Engine` when given)
- Modify: `client/src/game/settings.ts` (the pending selection, Apply, the applying state; the "Applies the next time…" line goes)
- Modify: `client/src/game/pauseMenu.ts` (Apply; the opaque ground while applying; Escape and Back ignored while applying)
- Modify: `client/src/app.ts` (`renderer` and `canvas` become `let`; the mirrors; the named loop; the scene extras; `applyTier`)
- Modify: `client/src/main.ts` (**(WebGPU)** `GameOptions.engineFor`)
- Modify: `ARCHITECTURE.md` (the live swap, one sentence)
- Test: `client/test/game/canvasBinding.test.ts` (new), `client/test/game/rendererSwap.test.ts` (new), `client/test/net/sessionStall.test.ts` (new), `client/test/game/input.test.ts`, `client/test/game/settings.test.ts`

**Interfaces:**
- Consumes: `createRenderer`, `Renderer`; `createBodyMesh`, `createSignMeshes` (for the leak test); `FixedStepAccumulator`; `resolveTier`.
- Produces:

```ts
// canvasBinding.ts
export type CanvasBinding = { readonly canvas: HTMLCanvasElement; rebind(next: HTMLCanvasElement): void; dispose(): void };
export function bindCanvas(canvas: HTMLCanvasElement, listeners: Readonly<Record<string, EventListener>>): CanvasBinding;

// input.ts, touchControls.ts
export type InputSampler = { /* … */ rebind(canvas: HTMLCanvasElement): void };
export type TouchLayer = { /* … */ rebind(canvas: HTMLCanvasElement): void };

// rendererSwap.ts
export const SWAP_READY_MAX_MS = 10_000;
export type Swappable = { renderer: Renderer; canvas: HTMLCanvasElement };
export type SwapBindings = {
  build(canvas: HTMLCanvasElement, tier: QualityTier, engine: AbstractEngine | null): Renderer;
  freshCanvas(): HTMLCanvasElement;
  extras: { dispose(): void; build(renderer: Renderer): void };
  rebind(canvas: HTMLCanvasElement): void;
  restore(renderer: Renderer): void;
  loop(): void;
};
export function swapRenderer(
  current: Swappable,
  target: { tier: QualityTier; engine: AbstractEngine | null; fallbackTier: QualityTier },
  bindings: SwapBindings,
): Swappable & { tier: QualityTier; fellBack: boolean };
export function whenSceneReady(scene: Scene, maxMs?: number): Promise<void>;

// settings.ts
export type SettingsInput = { /* … */ pending?: TierChoice; selectionTier?: QualityTier; applying?: boolean };
export type SettingsView = { /* … */ apply?: { label: string; disabled: boolean }; applying: boolean };

// pauseMenu.ts
settings: { view(): SettingsView; onChoose(choice: TierChoice): void; onApply(): void };

// app.ts (WebGPU)
export type GameOptions = { /* … */ engineFor?(tier: QualityTier, canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; watch(onFailure: (reason: "pipeline" | "lost", inStartup: boolean) => void): () => void } | null> };
```

- [ ] **Step 1: Write the failing tests**

`client/test/game/canvasBinding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bindCanvas } from "../../src/game/canvasBinding.js";

function target() {
  const live = new Map<string, EventListener>();
  return {
    live,
    addEventListener: (type: string, fn: EventListener) => void live.set(type, fn),
    removeEventListener: (type: string, fn: EventListener) => {
      if (live.get(type) === fn) live.delete(type);
    },
  };
}

describe("bindCanvas", () => {
  it("moves every listener to the new canvas and off the old one", () => {
    const a = target();
    const b = target();
    const down: EventListener = () => undefined;
    const click: EventListener = () => undefined;
    const binding = bindCanvas(a as unknown as HTMLCanvasElement, { pointerdown: down, click });
    expect([...a.live.keys()]).toEqual(["pointerdown", "click"]);
    binding.rebind(b as unknown as HTMLCanvasElement);
    expect(a.live.size).toBe(0);
    expect(b.live.get("pointerdown")).toBe(down);
    expect(b.live.get("click")).toBe(click);
    expect(binding.canvas).toBe(b);
    binding.dispose();
    expect(b.live.size).toBe(0);
  });
});
```

`client/test/game/input.test.ts` — add:

```ts
describe("rebinding to a fresh canvas", () => {
  it("keeps the aim and the held keys, and follows the pointer lock to the new canvas", () => {
    const { input, canvas } = sampler();
    lockPointer(canvas);
    fire("mousemove", { movementX: 100, movementY: 0 });
    fire("keydown", { code: "KeyW", preventDefault() {} });
    const before = input.sample(1);
    // The old canvas leaves the page and the browser drops the lock with it.
    const doc = (globalThis as Record<string, unknown>).document as { pointerLockElement: unknown };
    doc.pointerLockElement = null;
    fire("pointerlockchange", {});
    expect(input.engaged).toBe(false);
    const fresh = { ...fakeTarget(), requestPointerLock: () => undefined };
    input.rebind(fresh as unknown as HTMLCanvasElement);
    lockPointer(fresh);
    expect(input.engaged).toBe(true);
    const after = input.sample(2);
    expect(after.yaw).toBe(before.yaw);
    expect(after.moveZ).toBe(1);
  });
});
```

`client/test/game/rendererSwap.test.ts` — the two `vi.mock` blocks from `renderer.test.ts`, then:

```ts
import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { createForest } from "../../src/sim/forest.js";
import type { Level } from "../../src/sim/level.js";
import { createRenderer, type Renderer } from "../../src/game/renderer.js";
import { createBodyMesh } from "../../src/game/bodyMesh.js";
import { createSignMeshes } from "../../src/game/signMeshes.js";
import { swapRenderer, type SwapBindings } from "../../src/game/rendererSwap.js";
import type { QualityTier } from "../../src/game/quality.js";

// ---- the order, with stubs --------------------------------------------------

function stubRenderer(id: string, log: string[]): Renderer {
  return {
    id,
    engine: { stopRenderLoop: () => log.push(`stop ${id}`), runRenderLoop: () => log.push(`run ${id}`) },
    scene: { id },
    dispose: () => log.push(`dispose ${id}`),
  } as unknown as Renderer;
}

function stubCanvas(id: string, log: string[]): HTMLCanvasElement {
  return {
    id,
    style: {},
    replaceWith: (next: { id: string }) => log.push(`replace ${id} with ${next.id}`),
  } as unknown as HTMLCanvasElement;
}

const idOf = (x: unknown): string => (x as { id: string }).id;

function stubBindings(log: string[], failing: ReadonlySet<QualityTier> = new Set()): SwapBindings {
  let n = 0;
  return {
    freshCanvas: () => {
      n += 1;
      log.push(`fresh c${n}`);
      return stubCanvas(`c${n}`, log);
    },
    build: (canvas, tier, engine) => {
      log.push(`build ${idOf(canvas)} ${tier} ${engine === null ? "webgl2" : "given"}`);
      if (failing.has(tier)) throw new Error(`no ${tier}`);
      return stubRenderer(`${tier}@${idOf(canvas)}`, log);
    },
    extras: { dispose: () => log.push("extras dispose"), build: (r) => log.push(`extras build ${idOf(r)}`) },
    rebind: (canvas) => log.push(`rebind ${idOf(canvas)}`),
    restore: (r) => log.push(`restore ${idOf(r)}`),
    loop: () => undefined,
  };
}

describe("swapRenderer's order", () => {
  it("tears the old renderer down first, then builds on a fresh canvas and rebinds", () => {
    const log: string[] = [];
    const got = swapRenderer(
      { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
      { tier: "high", engine: null, fallbackTier: "medium" },
      stubBindings(log),
    );
    expect(got.tier).toBe("high");
    expect(got.fellBack).toBe(false);
    expect((got.canvas as unknown as { style: { touchAction?: string } }).style.touchAction).toBe("none");
    expect(log).toEqual([
      "stop medium@c0",
      "extras dispose",
      "dispose medium@c0",
      "fresh c1",
      "replace c0 with c1",
      "build c1 high webgl2",
      "restore high@c1",
      "extras build high@c1",
      "rebind c1",
      "run high@c1",
    ]);
  });

  it("rebuilds the running tier on WebGL2 when the new build throws, and throws on a second failure", () => {
    const log: string[] = [];
    const engine = { dispose: () => log.push("dispose given engine") } as unknown as AbstractEngine;
    const got = swapRenderer(
      { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
      { tier: "high", engine, fallbackTier: "medium" },
      stubBindings(log, new Set<QualityTier>(["high"])),
    );
    expect(got.tier).toBe("medium");
    expect(got.fellBack).toBe(true);
    expect(log.slice(3)).toEqual([
      "fresh c1",
      "replace c0 with c1",
      "build c1 high given",
      "dispose given engine",
      "fresh c2",
      "replace c1 with c2",
      "build c2 medium webgl2",
      "restore medium@c2",
      "extras build medium@c2",
      "rebind c2",
      "run medium@c2",
    ]);
    const log2: string[] = [];
    expect(() =>
      swapRenderer(
        { renderer: stubRenderer("medium@c0", log2), canvas: stubCanvas("c0", log2) },
        { tier: "high", engine: null, fallbackTier: "medium" },
        stubBindings(log2, new Set<QualityTier>(["high", "medium"])),
      ),
    ).toThrow("no medium");
  });
});

// ---- nothing of the old scene survives, on NullEngine -----------------------

const LEVEL: Level = { id: "swap-leak", brushes: [], playerSpawns: [], enemySpawns: [] };
const SEED = 388817;
const BODY = { pos: { x: 10, y: 2, z: 10 }, yaw: 0 };
const POSTS = [{ x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Trailhead"] }] }];
const never = (): Promise<AssetContainer> => new Promise(() => undefined);

function nullCanvas(): HTMLCanvasElement {
  return { renderWidth: 1600, renderHeight: 900, style: {}, replaceWith: () => undefined } as unknown as HTMLCanvasElement;
}

function census(scene: Scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    transformNodes: scene.transformNodes.length,
    lights: scene.lights.length,
    particleSystems: scene.particleSystems.length,
    beforeRender: scene.onBeforeRenderObservable.observers.length,
    afterRender: scene.onAfterRenderObservable.observers.length,
  };
}

/** What app.ts builds into the scene outside the renderer: the body and the signs. */
function sceneExtras() {
  let live: { dispose(): void }[] = [];
  return {
    build(r: Renderer) {
      live = [
        createBodyMesh(r.scene, BODY, { shadows: r.shadows, loader: never }),
        createSignMeshes(r.scene, POSTS, () => 2, {
          materialFor: (name) => new StandardMaterial(`box_${name}`, r.scene),
          paint: (s, name) => new PBRMaterial(name, s),
          shadows: r.shadows,
          loader: never,
        }),
      ];
    },
    dispose() {
      for (const x of live) x.dispose();
      live = [];
    },
  };
}

describe("swapRenderer on NullEngine", () => {
  it("leaves no object, engine or plugin registration of the old renderer alive, swap after swap", () => {
    const forest = createForest(SEED);
    const fresh = new Map<QualityTier, ReturnType<typeof census>>();
    for (const tier of ["high", "low", "medium"] as const) {
      const r = createRenderer(nullCanvas(), LEVEL, forest, { tier });
      const x = sceneExtras();
      x.build(r);
      fresh.set(tier, census(r.scene));
      x.dispose();
      r.dispose();
    }
    expect(EngineStore.Instances.length).toBe(0);

    const extras = sceneExtras();
    let current = { renderer: createRenderer(nullCanvas(), LEVEL, forest, { tier: "medium" }), canvas: nullCanvas() };
    extras.build(current.renderer);
    const bindings: SwapBindings = {
      build: (canvas, tier) => createRenderer(canvas, LEVEL, forest, { tier }),
      freshCanvas: nullCanvas,
      extras,
      rebind: () => undefined,
      restore: () => undefined,
      loop: () => undefined,
    };
    for (const tier of ["high", "low", "medium"] as const) {
      const old = current.renderer;
      const next = swapRenderer(current, { tier, engine: null, fallbackTier: "medium" }, bindings);
      expect(old.scene.isDisposed).toBe(true);
      expect(old.engine.isDisposed).toBe(true);
      expect(EngineStore.Instances.length).toBe(1);
      expect(census(next.renderer.scene)).toEqual(fresh.get(tier));
      // A material made after the swap (a model still loading) still gets
      // the atmosphere, which a build-first order would have unregistered.
      const late = new PBRMaterial("late", next.renderer.scene);
      expect(late.pluginManager?.getPlugin("Atmosphere") ?? null).not.toBe(null);
      late.dispose();
      current = next;
    }
    extras.dispose();
    current.renderer.dispose();
    expect(EngineStore.Instances.length).toBe(0);
  }, 180_000);
});
```

`client/test/net/sessionStall.test.ts` — the `input`, `harness`, `drive` and `distance` helpers of `clientSession.test.ts`, copied, then:

```ts
import { FixedStepAccumulator } from "../../src/game/loop.js";
import type { SessionEnd } from "../../src/net/clientSession.js";

describe("a renderer rebuild's stall", () => {
  it("keeps a follower connected and converging through the host's 1.5 s stall", () => {
    const h = harness({ latencyMs: 50, jitterMs: 0, lossRate: 0 }, 5150);
    const ended: SessionEnd[] = [];
    h.client.onSessionEnd((e) => ended.push(e));
    drive(h, 120, (t) => input({ seq: t + 1, moveZ: 1 }));

    // The host's page is busy: the follower ticks and sends for 90 ticks, the host not at all.
    for (let t = 0; t < 90; t++) {
      h.client.tick(input({ seq: 200 + t, moveZ: 1 }));
      h.net.advance(TICK_MS);
    }
    // Its first frame after runs the accumulator's cap and drops the rest.
    const burst = new FixedStepAccumulator().advance(1.5);
    expect(burst).toBe(15);
    for (let i = 0; i < burst; i++) h.host.tick(input({ seq: 0 }));

    const before = h.client.stats.snapshotsReceived;
    drive(h, 6, (t) => input({ seq: 300 + t, moveZ: 1 }));
    expect(h.client.stats.snapshotsReceived).toBeGreaterThan(before);

    drive(h, 240, (t) => input({ seq: 400 + t, moveZ: 1 }));
    h.net.advance(500);
    for (let i = 0; i < 90; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);
    expect(ended).toEqual([]);
    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    expect(distance(hostPos, h.client.localPlayer()!.pos)).toBeLessThan(1.0);
  });

  it("lets a follower stall 1.5 s and reconcile with the host that went on", () => {
    const h = harness({ latencyMs: 50, jitterMs: 0, lossRate: 0 }, 5151);
    const ended: SessionEnd[] = [];
    h.client.onSessionEnd((e) => ended.push(e));
    drive(h, 120, (t) => input({ seq: t + 1, moveZ: 1 }));

    // The follower's page is busy: the host goes on, and nothing reaches the follower's page…
    for (let t = 0; t < 90; t++) h.host.tick(input({ seq: 0 }));
    // …until it is free, when everything queued is handled at once.
    h.net.advance(1500);
    const burst = new FixedStepAccumulator().advance(1.5);
    for (let i = 0; i < burst; i++) h.client.tick(input({ seq: 200 + i, moveZ: 1 }));

    drive(h, 240, (t) => input({ seq: 400 + t, moveZ: 1 }));
    h.net.advance(500);
    for (let i = 0; i < 90; i++) {
      h.host.tick(input({ seq: 0 }));
      h.net.advance(TICK_MS);
    }
    h.net.advance(500);
    expect(ended).toEqual([]);
    const hostPos = h.host.world.state.players.get(h.peerEntityId)!.pos;
    expect(distance(hostPos, h.client.localPlayer()!.pos)).toBeLessThan(1.0);
  });
});
```

`client/test/game/settings.test.ts` — Task 4's literals gain `applying: false`; the pause test loses `Applies the next time you start a hike.`; add:

```ts
describe("Apply on the pause screen", () => {
  const base = {
    context: "pause" as const,
    choice: "auto" as const,
    auto: { tier: "medium" as const, probePending: false },
    running: "medium" as const,
    override: null,
    stored: true,
  };

  it("applies a selection that changes the tier, and only such a one", () => {
    const v = settingsModel({ ...base, pending: "low", selectionTier: "low" });
    expect(v.choices.map((c) => c.selected)).toEqual([false, false, false, true]);
    expect(v.apply).toEqual({ label: "Apply", disabled: false });
    expect(v.lines).toEqual(["Auto picks Medium on this computer.", "This hike is using Medium."]);
    expect(settingsModel({ ...base, pending: "medium", selectionTier: "medium" }).apply).toEqual({ label: "Apply", disabled: true });
    expect(settingsModel({ ...base, selectionTier: "medium" }).apply).toEqual({ label: "Apply", disabled: true });
    // Auto's pick moved under a running hike (the governor): Apply switches to it.
    expect(settingsModel({ ...base, auto: { tier: "low", probePending: false }, selectionTier: "low" }).apply).toEqual({ label: "Apply", disabled: false });
    expect(settingsModel({ ...base, override: "high", pending: "low", selectionTier: "high" }).apply).toEqual({ label: "Apply", disabled: true });
  });

  it("locks the screen while applying", () => {
    const v = settingsModel({ ...base, pending: "low", selectionTier: "low", applying: true });
    expect(v.applying).toBe(true);
    expect(v.apply).toEqual({ label: "Applying…", disabled: true });
    expect(v.back).toEqual({ label: "Back", disabled: true });
    expect(v.choices.every((c) => c.disabled)).toBe(true);
  });

  it("has no Apply on the title screen", () => {
    expect(settingsModel({ context: "title", choice: "auto", auto: null, override: null, stored: true }).apply).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/canvasBinding.test.ts test/game/input.test.ts test/game/rendererSwap.test.ts test/game/settings.test.ts test/net/sessionStall.test.ts`
Expected: FAIL — `canvasBinding.ts`, `rendererSwap.ts`, `rebind` and Apply do not exist. `sessionStall.test.ts` passes already: it pins, rather than changes, what the sessions tolerate, and stays as the co-op pin.

- [ ] **Step 3: Implement the pieces**

`canvasBinding.ts`: `bindCanvas` adds every listener; `rebind` removes them from the current canvas, adds them to the next, and makes it current; `dispose` removes them.

`input.ts`: the two canvas listeners (`pointerdown`, `click`) go through one `bindCanvas`; every `canvas` reference becomes `binding.canvas` (the lock identity at 119, `requestPointerLock` at 151 and 191); `rebind(next)` is `binding.rebind(next)` followed by re-reading `locked` and announcing a change through `onEngagedChange`, exactly as `onLockChange` does; `dispose` disposes the binding.

`touchControls.ts`: the four canvas listeners through one `bindCanvas`, `setPointerCapture` on `binding.canvas`; `rebind(next)` on the layer.

`renderer.ts`: the engine made with `loseContextOnDispose: true`; `RendererOptions.engine` (an engine made elsewhere is used, owned and disposed by the renderer). **(WebGPU)** already present; keep one.

`rendererSwap.ts`: `swapRenderer` does design §9.3's seven steps in the order the test pins: `stopRenderLoop`; `extras.dispose()`; `renderer.dispose()`; `freshCanvas()`, `canvas.replaceWith(fresh)`, `fresh.style.touchAction = "none"`; `build(fresh, tier, engine)`, and on a throw: `engine?.dispose()` in its own `try`, `console.error`, a second `freshCanvas()` replacing the first, `build(second, fallbackTier, null)` (a second throw goes up); then `restore`, `extras.build`, `rebind`, `runRenderLoop(loop)`. `whenSceneReady(scene, maxMs = SWAP_READY_MAX_MS)` resolves on `scene.executeWhenReady` with `scene.getWaitingItemsCount() === 0`, or after `maxMs`.

`settings.ts`: `selected` is `pending ?? choice`; on `pause`, `apply = { label: applying ? "Applying…" : "Apply", disabled: applying || override !== null || selectionTier === running }`; while applying every choice and Back are disabled; the "Applies the next time…" line is removed; `applying` is on every view (`false` unless set).

`pauseMenu.ts`: the Settings panel renders Apply (a plain `button` after the lines, before Back) calling `settings.onApply`; `root.classList.toggle("applying", view.applying)`; `.pausemenu.applying` in the style literal sets the ground to `rgb(8, 9, 12)` (the vignette's outer colour, opaque) with the menu's 220 ms opacity ease; Escape and Back do nothing while applying.

- [ ] **Step 4: Rebuild app.ts around a replaceable renderer**

In `startGame`:

1. `let renderer = createRenderer(canvas, …)`, and the parameter `canvas` copied to `let canvas`. Every reader already reads the binding at call time.
2. Mirrors for what `applyView` pushes and nothing keeps: `let bobScale = DEFAULT_BOB_SCALE`, `let unsettleLevel = 1`, `let windOverride: number | null = null`, `let lastFreecamView: FreecamView | null = null` (written where `stepFreecamView` and `applyView` call `setFreecam`). `restore(r)`: `r.setHour(appliedHour)`, `r.setWeather(appliedWeather, 0)`, `r.setWireframe(wireframe)`, `r.setSkinShading(skin)`, `r.setBobScale(bobScale)`, `r.setUnsettle(unsettleLevel)`, `r.setWindOverride(windOverride)`, `r.setFreecam(lastFreecamView)`; `cameraOnPlayer = false`.
3. The loop body at 1039 becomes `function loop(): void`, passed to `runRenderLoop`.
4. `let activeWorld: World | null`, set where `runAsHost` and `runAsClient` build signs and body; `extras = { dispose: () => { signs?.dispose(); body?.dispose(); signs = body = null; }, build: (r) => { if (activeWorld) { signs = createSigns(activeWorld); body = …createBodyMesh(r.scene, …) } } }` (`createSigns` reads `renderer`, which is the new one by then).
5. `rebind(next)`: `input.rebind(next)`, `touchLayer.rebind(next)`, `touchModel.resize({ width: next.clientWidth, height: next.clientHeight })`, `touchLayer.measure()`.
6. `let tier = options.tier`; `let pending: TierChoice | null = null; let applying = false`. The pause settings' `view()` passes `pending`, `selectionTier: resolveTier({ override, choice: pending ?? choice(), auto: auto()?.tier ?? tier }).tier`, `applying`, `running: tier`; `onChoose(c)` sets `pending = c`; Back and `menu.show()` clear it.
7. `async function applyTier()`: `const target = selectionTier`; return if equal to `tier`; `options.quality.save(pending ?? choice())`; `applying = true`, repaint; **(WebGPU)** `made = await options.engineFor?.(target, first)` on a fresh canvas `first`, which the bindings' `freshCanvas` then hands out first (null → WebGL2; a rejection is remembered as `init` by the hook and gives null, and `first` is dropped, since it may hold a WebGPU context); `await new Promise((r) => afterNextPaint(r))`; `const got = swapRenderer({ renderer, canvas }, { tier: target, engine: made?.engine ?? null, fallbackTier: tier }, bindings)`; `renderer = got.renderer; canvas = got.canvas; tier = got.tier`; **(WebGPU)** the old watcher removed, `made.watch(onGpuFailure)` attached, where a `pipeline` failure in the startup window calls `applyTier` again on WebGL2 at the same tier (design §9.4); `console.info(\`quality: ${tier} (choice), engine …\`)`; `await whenSceneReady(renderer.scene)`; `applying = false; pending = null`, repaint.
8. `dispose` disposes whichever renderer and canvas are current.

`main.ts` **(WebGPU)**: `engineFor(tier, canvas)` runs the rule (`chooseEngine` with the running page's override and remembered record) and, for WebGPU, `createWebGpuEngine(canvas)`; a rejection is `rememberFailure("init")` and null. `launch`'s own `watchWebGpu` moves into `app.ts` with the engine it watches.

`ARCHITECTURE.md`: "A tier chosen mid-hike is applied at once: the renderer is disposed and rebuilt on a fresh canvas behind the pause screen (`rendererSwap.ts`), while the session and its connections carry on."

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/canvasBinding.test.ts test/game/input.test.ts test/game/rendererSwap.test.ts test/game/settings.test.ts test/net/sessionStall.test.ts test/game/renderer.test.ts test/game/touchControls.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/canvasBinding.ts client/src/game/rendererSwap.ts client/src/game/input.ts client/src/game/touchControls.ts client/src/game/renderer.ts client/src/game/settings.ts client/src/game/pauseMenu.ts client/src/app.ts client/src/main.ts ARCHITECTURE.md client/test/game/canvasBinding.test.ts client/test/game/input.test.ts client/test/game/rendererSwap.test.ts client/test/game/settings.test.ts client/test/net/sessionStall.test.ts
git commit -F - <<'EOF'
feat: apply a new graphics tier mid-hike without a reload

## What

A tier chosen on the pause screen waited for the next hike, because the
tier is fixed when the renderer is made. Apply now disposes the renderer
and builds the new one on a fresh canvas behind an opaque "Applying…"
screen, while the session, its connections, the player's aim and the
HUD carry on; a build that fails falls back to the running tier.

## How

- `client/src/game/rendererSwap.ts` — dispose first, then build on a
  fresh canvas, restore, rebuild the signs and body, rebind, run.
- `client/src/game/canvasBinding.ts`, `input.ts`, `touchControls.ts` —
  the canvas listeners move to the new canvas; aim and keys are kept.
- `client/src/game/renderer.ts` — the old context is lost on dispose.
- `client/src/game/settings.ts`, `pauseMenu.ts`, `client/src/app.ts`,
  `client/src/main.ts`, `ARCHITECTURE.md` — Apply and its screen.
- `client/test/game/rendererSwap.test.ts` — the order, the fallback, and
  nothing of the old scene alive on NullEngine.
- `client/test/net/sessionStall.test.ts` — a host's and a follower's
  1.5 s stall, with the session kept and the players converging.
- `client/test/game/canvasBinding.test.ts`, `input.test.ts`,
  `settings.test.ts`.

<trailers>
EOF
```

---

### Task 6: The governor

**Files:**
- Create: `client/src/game/governor.ts`
- Modify: `client/src/game/quality.ts` (`withGovernorDrop`)
- Modify: `client/src/app.ts` (fed from both loops; restarted after a swap; the drop's record, HUD line and log)
- Modify: `client/src/main.ts` (`GameOptions.quality.source` and `governorDrop`)
- Test: `client/test/game/governor.test.ts` (new), `client/test/game/quality.test.ts`, `client/test/architecture.test.ts` (`governor.ts` Babylon-free)

**Interfaces:**
- Consumes: `AutoRecord`, `withVerdict` (Tasks 2–3); `hud.flash`.
- Produces:

```ts
// governor.ts
export const GOVERNOR_START_MS = 30_000;
export const GOVERNOR_WINDOW_MS = 10_000;
export const GOVERNOR_LIMIT_MS = 20.8;
export const GOVERNOR_WINDOWS = 3;
export const GOVERNOR_STALL_MS = 250;
export const GOVERNOR_LINE_MS = 6_000;
export type Governor = { frame(intervalMs: number, now: number): void; restart(now: number): void; readonly verdict: "none" | "drop" };
export function createGovernor(start: number): Governor;
export function governorLine(next: QualityTier): string;

// quality.ts
export function withGovernorDrop(prev: AutoRecord | null, gpu: string, browser: number, cls: GpuClass, running: QualityTier, pixels: number, now: number): AutoRecord | null;
```

- [ ] **Step 1: Write the failing tests**

`client/test/game/governor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  GOVERNOR_LIMIT_MS, GOVERNOR_START_MS, GOVERNOR_STALL_MS, GOVERNOR_WINDOW_MS, GOVERNOR_WINDOWS,
  createGovernor, governorLine, type Governor,
} from "../../src/game/governor.js";

/** Frames of `ms` each, from `from` until the clock reaches `until`; returns the clock. */
function feed(g: Governor, from: number, until: number, ms: number): number {
  let t = from;
  while (t < until) {
    t += ms;
    g.frame(ms, t);
  }
  return t;
}

describe("the governor", () => {
  it("pins its numbers", () => {
    expect([GOVERNOR_START_MS, GOVERNOR_WINDOW_MS, GOVERNOR_LIMIT_MS, GOVERNOR_WINDOWS, GOVERNOR_STALL_MS])
      .toEqual([30_000, 10_000, 20.8, 3, 250]);
  });

  it("stays quiet for five minutes on a machine that holds 60 Hz", () => {
    const g = createGovernor(0);
    feed(g, 0, 300_000, 16.667);
    expect(g.verdict).toBe("none");
  });

  it("drops after the 30 s grace and three slow 10 s windows, and not a frame before", () => {
    const g = createGovernor(0);
    feed(g, 0, 59_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 60_000);
    expect(g.verdict).toBe("drop");
  });

  it("lets a stalled window neither count nor break the run", () => {
    const g = createGovernor(0);
    feed(g, 0, 45_000, 25);
    g.frame(300, 45_300);
    feed(g, 45_300, 69_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 70_000);
    expect(g.verdict).toBe("drop");
  });

  it("starts the run again after a window at or under the limit", () => {
    const g = createGovernor(0);
    feed(g, 0, 50_000, 25);
    feed(g, 50_000, 60_000, 20);
    feed(g, 60_000, 89_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 90_000);
    expect(g.verdict).toBe("drop");
  });

  it("takes a new grace after a swap, and keeps a drop once made", () => {
    const g = createGovernor(0);
    feed(g, 0, 50_000, 25);
    g.restart(50_000);
    feed(g, 50_000, 109_975, 25);
    expect(g.verdict).toBe("none");
    g.frame(25, 110_000);
    expect(g.verdict).toBe("drop");
    g.restart(110_000);
    expect(g.verdict).toBe("drop");
  });

  it("says what it did in one line", () => {
    expect(governorLine("medium")).toBe("Running slowly: your next hike uses Medium. Settings can switch now.");
    expect(governorLine("low")).toBe("Running slowly: your next hike uses Low. Settings can switch now.");
  });
});
```

`client/test/game/quality.test.ts` — add:

```ts
describe("the record after a governor drop", () => {
  it("drops the running tier one step, at any window, and has nothing below low", () => {
    const got = withGovernorDrop(null, "Apple GPU", 26, "apple-unknown", "high", 2_073_600, 1_790_000_000_000);
    expect(got).toEqual({
      v: 1, gpu: "Apple GPU", cls: "apple-unknown", browser: 26, attempts: 0,
      verdict: { tier: "medium", source: "governor", pixels: 2_073_600, at: 1_790_000_000_000 },
    });
    expect(withGovernorDrop(null, "Apple GPU", 26, "apple-unknown", "medium", 2_073_600, 1_790_000_000_000)!.verdict!.tier).toBe("low");
    expect(withGovernorDrop(null, "Apple GPU", 26, "apple-unknown", "low", 2_073_600, 1_790_000_000_000)).toBe(null);
  });
});
```

`client/test/architecture.test.ts`: `BABYLON_FREE_FILES` gains `governor.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/governor.test.ts test/game/quality.test.ts test/architecture.test.ts`
Expected: FAIL — `governor.ts` and `withGovernorDrop` do not exist.

- [ ] **Step 3: Implement**

`governor.ts`: state `graceUntil = start + GOVERNOR_START_MS`, `windowStart | null`, `sum`, `count`, `void`, `run`, `verdict`. `frame(ms, now)`: nothing before `graceUntil` or once `verdict` is `drop`; the first frame after it opens a window at `graceUntil`; a frame with `now >= windowStart + GOVERNOR_WINDOW_MS` first closes the window (void → skipped; `sum / count > GOVERNOR_LIMIT_MS` → `run += 1`; else `run = 0`; `run >= GOVERNOR_WINDOWS` → `verdict = "drop"`), then opens the next at `windowStart + GOVERNOR_WINDOW_MS` and counts the frame in it; `ms > GOVERNOR_STALL_MS` voids its window. `restart(now)`: `graceUntil = now + GOVERNOR_START_MS`, window and run cleared, a drop kept. `governorLine` as tested.

`quality.ts`: `withGovernorDrop` (null on low; else `withVerdict` with the tier one step down, `source: "governor"`).

`app.ts`: `const governor = createGovernor(performance.now())`; in both loops, after `const dt = frameSeconds()`, `governor.frame(dt * 1000, performance.now())`; once per hike, when `governor.verdict === "drop"` and `options.quality.source() === "auto"` and `tier !== "low"`: `options.quality.governorDrop(tier)` (which writes `withGovernorDrop` through `writeAutoRecord` and returns the new tier), `hud.flash(governorLine(next), GOVERNOR_LINE_MS)`, and `console.info(\`quality governor: ${tier} → ${next} from the next hike\`)`. `applyTier` calls `governor.restart(performance.now())` after the swap. The Settings screen reads `auto()` fresh each time it paints, so its Auto line names the new pick and Apply is enabled.

`main.ts`: `quality.source()` (the source `pageTier` resolved, changed to `"choice"` when a non-Auto choice is applied) and `quality.governorDrop(running)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/governor.test.ts test/game/quality.test.ts test/architecture.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/governor.ts client/src/game/quality.ts client/src/app.ts client/src/main.ts client/test/game/governor.test.ts client/test/game/quality.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: lower the next hike's tier after a sustained slow frame

## What

A class the table names can still be wrong for one machine or window.
On Auto, three 10 s windows in a row averaging under 48 fps, after a
30 s grace, now lower the next hike's tier by one, once, and say so in
one HUD line; Settings shows the new pick and can apply it at once. It
never raises a tier and never touches a tier the player chose.

## How

- `client/src/game/governor.ts` — the windows, the stall rule, the line.
- `client/src/game/quality.ts` — `withGovernorDrop`.
- `client/src/app.ts`, `client/src/main.ts` — fed from both loops,
  restarted by a swap, remembered as a governor verdict.
- `client/test/game/governor.test.ts`, `quality.test.ts`,
  `client/test/architecture.test.ts`.

<trailers>
EOF
```

---

### Task 7: The gate

No code. Everything below is on the reference machine (Apple M4, 8-core GPU, 16 GB) with this branch built and served; the frame rounds in headless Chrome as every earlier note, the rest in a windowed Chrome. The design's §13 is the bar; this task is how.

**Files:**
- Create: `docs/rendering/<date>-quality-tier-detection-verification.md`, dated the day the gate runs.

**Interfaces:**
- Consumes: the measurement patch of the near-grass plan's Task 1 Step 1, item 1 only (`__fcSet`, `__scene`, `__engine`; `?tier=` is committed now), applied for the gate and reverted after it; the isolated `chrome-devtools` CLI (`start --isolated=true`, `new_page`, `evaluate_script`, `take_screenshot`, `resize_page`, `emulate`, `close_page`, `stop`).
- Produces: the note.

- [ ] **Step 1: Detection**

A fresh profile, `/dayhike/`. Record from `evaluate_script`: `navigator.deviceMemory`, `navigator.hardwareConcurrency`, the renderer string (a `webgl2` context, `RENDERER`, then the debug extension), `(await (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })).info)`; and from the console the page's line `quality: … (auto, …)`. Expected: class `apple-base`, tier `medium`. Then `/dayhike/game/<fresh uuid>?probe=high`, three page loads in a 1920 × 1080 window and three in 1200 × 2029: every `quality probe:` line. **Bar:** one verdict on all three loads at 1920 × 1080, and it equals the class table's tier for the machine; if not, the `apple-base` row and its literal in `gpuClass.test.ts` move to the verdict in their own commit, and this step is run again.

- [ ] **Step 2: The probe reads what the pair method reads**

For each tier the probe measured at 1920 × 1080: the pair method's page rule (the canopy pose, 3 s to settle, 8 s of `onAfterRenderObservable` intervals, mean and p95) on `?tier=<that tier>` with the pose patch. **Bar:** within 1.0 ms of the probe's mean.

- [ ] **Step 3: The frame per tier**

Seed `atmo`, `weather mist`, `time 12`: `?cmd=seed%20atmo;freecam;weather%20mist;time%2012&tier=<tier>`, each of low, medium and high, at the canopy pose `__fcSet(123, 110.87, -105.5, 1.571, 0.3)` and the meadow pose `__fcSet(369, 51.01, -855, 0, 0.3)`, in both windows; one browser start per round, a discarded warm-up page, quiet pages only (within 0.5 ms of the build's lowest mean at that pose); at least two quiet pages per cell. **(WebGPU)** again with `&engine=webgpu` for medium and high. **Bar:** at 1920 × 1080 the tier Auto picks holds at both poses (mean ≤ 16.7 ms) and the next one up does not. The table is the note's first current medium and low figures.

- [ ] **Step 4: The settings**

A fresh profile, windowed:

1. The title screen's buttons in order (Play, Downloads, Settings, Credits); Settings opens `/settings`, the browser's Back returns. The four choices, Auto pressed, the line `Auto picks Medium on this computer.`
2. High, reload: High still pressed. Play: the console line `quality: high (choice, apple-base), engine …`; **(WebGPU)** the engine the rule gives high. Low, Play: `quality: low (choice, …), engine webgl2`.
3. In a hike, Escape: Resume, Settings, Exit; Settings opens the same screen with `This hike is using Low.`; Escape goes back to the pause panel; Escape again resumes.
4. `?tier=high` on the title screen: the override line; in a hike, Apply disabled.
5. A private window: the storage line; a choice lasts until the window closes.

- [ ] **Step 5: The live swap**

In a solo hike, pause, Settings: High → Apply, Low → Apply, Medium → Apply. For each swap:

- the stall: a `PerformanceObserver` for `longtask` registered by `evaluate_script` before Apply; the long task's duration, and the time from Apply to the ground lifting; then again under `emulate` with 6× CPU throttling;
- after the ground lifts: `__scene.meshes.length`, `materials.length`, `textures.length`, `onBeforeRenderObservable.observers.length`, and `BABYLON.EngineStore.Instances.length` through the patch, against a fresh page at that tier at the same place (bar: engines 1; the rest equal within what the streaming rebuilt, reported);
- two stills 1 s apart after the ground lifts: nothing appears or vanishes;
- Resume: the first click locks the pointer and the view faces where it did; then, under `emulate` with touch, the stick moves and the look turns.

Then a party: two isolated browser instances, one hosting and inviting, the other joining by the link. The host makes the three swaps; then the follower does. **Bar:** the follower never shows `Reconnecting…` or a session end; after each host swap the follower's figure moves on the host's screen within 1 s of the ground lifting. **(WebGPU)** the whole step again with `?engine=webgpu`, crossing engines (High → Low is WebGPU → WebGL2). Zero console errors throughout.

- [ ] **Step 6: The governor**

On Auto at medium, the canopy pose, `__engine.setHardwareScalingLevel(0.5)` (the frame is then about twice the budget): the console's `quality governor: medium → low …` between 60 and 61 s after the hike's first frame; the HUD line once for 6 s; Settings says `Auto picks Low on this computer.` and Apply switches; a reload starts at low (`quality: low (auto, apple-base)`). Without the scaling, at a pose Step 3 found holding 60 Hz at that tier: nothing in 5 min.

- [ ] **Step 7: Safari and Firefox**

On the reference machine, a fresh profile each: the class `apple-unknown`; the probe on the first hike (`Setting up graphics…`), its lines and verdict; the second hike starts at the verdict with no probe. Not a frame gate.

- [ ] **Step 8: Write the note and commit**

The note: §1 Method (the patch in words, the windows, the CLI); §2 Detection (the values read, the class, the probe's readings and verdicts); §3 The probe against the pair method; §4 Frame per tier (the table by tier, pose, window, engine); §5 Settings; §6 The live swap (stalls at 1× and 6×, the counts, the party); §7 The governor; §8 Safari and Firefox; §9 Close (each bar of design §13, met or missed, and what moved). Revert the patch; `git status --porcelain` shows only the note.

```bash
git add docs/rendering/<date>-quality-tier-detection-verification.md
git commit -F - <<'EOF'
docs: gate tier detection, the Settings screen and the live swap

## What

What the reference machine reports and which tier Auto picks there, the
probe's verdicts against the pair method, the first current frame
figures for all three tiers at both standard poses, the Settings screen
from both entries, the live swap's stall and leak counts solo and in a
party, and the governor's drop.

## How

- `docs/rendering/<date>-quality-tier-detection-verification.md` — the
  method and every measurement.

<trailers>
EOF
```
