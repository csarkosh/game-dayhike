# WebGPU High and Medium Tier Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the high and medium tiers, draw with Babylon's `WebGPUEngine` wherever the browser offers a hardware adapter with the required limits, show the same picture as WebGL2 at every fixed pose on both tiers, fall back to WebGL2 by itself on any failure, and be faster than WebGL2 at native pixels at the canopy pose by more than the same-code noise floor on each tier it is switched on for (about 1.5 ms expected on high, reported, not a gate).

**Scope, amended 2026-09-26:** the rule covers the medium tier as well as high (`WEBGPU_TIERS = ["high", "medium"]`, design §4), and the switch is `WEBGPU_ENABLED`. The low tier and the landing backdrop stay WebGL2. Every compile check, diagnosis and gate from Task 2 on runs at `?tier=high` and again at `?tier=medium`; what medium draws differently is listed in design §7.1. A tier's WebGPU path turns on when it beats the same-code floor at the canopy pose at native, no standard pose is slower than its floor, and it passes parity on that tier (design §13.1, §16). Task 6 also waits on the live renderer swap the tier-detection work is building (design §5.5; Task 6's prerequisite below).

**Architecture:** The engine is chosen once, before the game starts, from the resolved tier (high or medium), the URL overrides, a remembered fallback and the adapter's limits (`engineChoice.ts`, pure; `gpuEngine.ts`, loaded by dynamic import on the WebGPU path only). Every material generates GLSL, which the engine translates at run time with the glslang and twgsl builds Babylon ships. Six WebGPU-only faults are fixed one commit each, with WebGL2's shader text pinned byte for byte. The impostor bake waits for readiness instead of a clock. The trail bed's colour difference is diagnosed, then fixed. The switch goes on by default only after the parity, frame, startup, memory, console and fallback gates. Then, separately, the blade field is culled per clump by a compute pass on WebGPU, on top of the grass frame filter. Nothing under `sim/`.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`WebGPUEngine`, `MaterialPluginBase`, `ComputeShader`, `StorageBuffer`), GLSL in template strings and `.fx` files, WGSL for the cull kernel, vitest 4 with `NullEngine`.

**Spec:** `docs/rendering/2026-09-26-webgpu-high-tier-design.md`

## Global Constraints

- The work is on a fresh branch from `origin/main` (`ba0fd95`). The spike's branch (`worktree-grass-webgpu-spike`, commits `781e4a2` and `996fb07`) is read and never merged; each piece it gives is cherry-picked or rewritten as the table below says.
- No file under `client/src/sim/` changes; `passHash` stays −311867473 (`client/test/sim/groundGradient.test.ts:700`); `PROTOCOL_VERSION` stays 5.
- From Task 2 Step 1 on, the WebGL2 identity pins (`client/test/game/webglIdentity.test.ts`) pass on every commit. Only Task 2C changes a pin, and Task 5 only if its finding cannot be fixed on the WebGPU path alone; each such commit carries a test that proves the one difference.
- `WEBGPU_ENABLED` stays `false` until Task 6's gates pass; before that, WebGPU is reached only with `?engine=webgpu`.
- No private Babylon member is used without a canary test that names it against the installed `@babylonjs/core`.
- Every numeric expectation in a test is a literal, never the constant it pins. vitest 4 takes a test's timeout as the third argument: `it("…", () => { … }, 20_000)`.
- GLSL rules (`client/test/game/shaderHygiene.test.ts`): no comment spelling a preprocessor directive, no semicolon inside a trailing comment on a code line; every `.fx` file keeps at least one line of real code; a new uniform goes on both the `getUniforms().ubo` list and the non-UBO `fragment` string.
- Before every commit: `npm run typecheck`, the touched test files (`cd client && npx vitest run <files>`), and `npx eslint <touched files>` green.
- Stage explicit paths only, never `git add -A` or `git add .`.
- Commit format: type-prefixed subject under 72 characters, a blank line, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then the repository's two attribution trailer lines (`<trailers>` below).
- Public repository: no code comment, doc or commit message describes how an asset was made or the process around the work; write for an engineer reading the code.
- Measurement patches are applied to a worktree for a gate and reverted after it, never committed: the pose patch (`__fcSet`, `__scene`, `__engine`, as in the near-grass verification §1), the dev server's port, and whatever the measuring browser injects before the page's scripts run (§13.6 of the design). `git status --porcelain` is clean before every commit.

## What the spike gives each task

| from the spike | task | taken as |
| --- | --- | --- |
| `docs/rendering/2026-09-26-grass-webgpu-spike.md` (`996fb07`) | 1 | cherry-picked, with one correction appended (design §3.2) |
| `client/src/app.ts`: `GameOptions.engine`, passed to `createRenderer` | 1 | applied from the diff, then `tier` added beside it |
| `client/src/game/renderer.ts`: `options.engine ?? new Engine(...)`, `Renderer.engine: AbstractEngine`, `RendererOptions.engine` | 1 | applied from the diff |
| `renderer.ts`: `bladeGpuMode`, its `?blades=` and `?bladecount=` switches, the `gpu:` option | — | not taken; Task 7 has no URL switch |
| `client/src/main.ts`: the render token, the dynamic import | 1 | rewritten: tier first, the probe, the limits, a catch, the watcher |
| `gpuEngine.ts`: the translators' `?url` imports and `initAsync` | 1 | taken into the rewrite |
| `gpuEngine.ts`: `forceGlslMaterials` (a prototype accessor) | 1 | replaced by `PBRBaseMaterial.ForceGLSL` and `StandardMaterial.ForceGLSL` |
| `gpuEngine.ts`: `skipUniformityAnalysis` (a private method replaced) | 2A | not taken; per shader, by Babylon's define |
| `gpuEngine.ts`: `setMaximumLimits` | 2D | replaced by the measured required limits |
| `gpuEngine.ts`: the Extensions side-effect import | 2F | taken |
| `webgpuGlsl.ts`: `HEX_MACROS` | 2B | the macro text taken as `HEX_FETCH_MACROS`; the string surgery not taken |
| `webgpuGlsl.ts`: `WGSL_RESERVED` | 2C | not taken; renamed at source |
| `terrainTexture.ts`: `_glsl()` | 2B | rewritten as the three-file assembly |
| `atmosphere.ts`: the gradient bound while off | 2E | taken without the `isWebGPU` guard |
| `forestMeshes.ts`: six times the bake's budget | 4 | not taken; the bake is event-driven |
| `bladeGpu.ts`: the hash bump | 3 | replaced by `offsetKeyedVertexBuffer` |
| `bladeGpu.ts`: the cull kernel, the interleaved layout, the indirect path | 7 | rewritten on the grass frame filter's collected buffers; S, F and the tail pass not taken |
| `bladeMeshes.ts`: the `gpu` hook | 7 | rewritten on the filter's bucket structure |
| `gpuEngine.test.ts`, `webgpuGlsl.test.ts`, `bladeGpu.test.ts`, the `renderer.test.ts` pin | 1, 2B, 7 | cases reused where they still describe the code |

Applying a piece of `781e4a2` to one file: `git show 781e4a2 -- <path> | git apply --3way`, then edit out what the table does not take. New files the table takes whole or in part are written fresh, with the spike's file open beside them.

## File map

| File | Task | Change |
| --- | --- | --- |
| `docs/rendering/2026-09-26-grass-webgpu-spike.md` | 1 | Brought over from the spike's branch; one correction appended |
| `docs/rendering/<date>-webgpu-high-tier-verification.md` (new) | 1–8 | Created by Task 1, dated the day it is written; one section per gate; closed by Task 8 |
| `client/src/game/engineChoice.ts` (new) | 1, 2D, 6 | Overrides, the rule, the limits check, the remembered fallback; `WEBGPU_ENABLED` |
| `client/src/game/gpuEngine.ts` (new) | 1, 2D, 2F | The adapter probe, the engine, the failure watcher; WebGPU only |
| `client/src/game/quality.ts` | 1 | `detectTier` moved here from `renderer.ts`, unchanged |
| `client/src/main.ts` | 1 | The engine resolved before `startGame`; failure handling |
| `client/src/app.ts` | 1 | `GameOptions.engine`, `GameOptions.tier`; the HUD line after a fallback reload |
| `client/src/game/renderer.ts` | 1 | The engine passthrough; `detectTier` gone |
| `client/src/game/lighting.ts` | 1 | The sky material constructed with `forceGLSL` |
| `client/src/game/post.ts` | 2A | `finishFragmentFor(webgpu)` |
| `client/src/game/shaders/groundHex.fragment.fx` | 2B | Lines 88–145 moved out |
| `client/src/game/shaders/groundHexFetch.fragment.fx` (new) | 2B | Lines 88–115 of the old include |
| `client/src/game/shaders/groundHexNoise.fragment.fx` (new) | 2B | Lines 116–145 of the old include |
| `client/src/game/terrainTexture.ts` | 2B, 2C | `terrainHexDefs(webgpu)`, `HEX_FETCH_MACROS`; `macro` → `macroRgb` |
| `client/src/game/atmosphere.ts` | 2E | The gradient bound whenever it exists |
| `client/src/game/webgpuVertexBuffer.ts` (new) | 3 | `offsetKeyedVertexBuffer` |
| `client/src/game/forestMeshes.ts` | 4 | The bake: no deadline, a warning, a failure path, an abort |
| (decided by the diagnosis) | 5 | The trail bed's fix |
| `client/src/game/bladeGpu.ts` (new), `bladeMeshes.ts`, `renderer.ts` | 7 | Build I |
| `ARCHITECTURE.md` | 1, 6, 7 | The engine sentence; build I |
| `tools/deploy/verify.mjs` and its test | 1 | The translators served, as WebAssembly |
| `client/test/game/engineChoice.test.ts` (new), `quality.test.ts`, `renderer.test.ts`, `client/test/architecture.test.ts` | 1, 2F | The rule; `detectTier`; the passthrough; the static import graph |
| `client/test/game/webglIdentity.test.ts` (new), `client/test/game/helpers/pluginText.ts` (new) | 2 | The identity pins |
| `client/test/game/post.test.ts`, `terrainTexture.test.ts`, `groundHex.test.ts`, `shaderHygiene.test.ts`, `atmosphere.test.ts`, `client/test/game/pluginBindings.test.ts` (new) | 2 | Per change |
| `client/test/game/webgpuVertexBuffer.test.ts` (new) | 3 | The workaround and its canaries |
| `client/test/game/forestMeshes.test.ts` | 4 | The bake's five cases |
| `client/test/game/bladeGpu.test.ts` (new), `bladeMeshes.test.ts` | 7 | Build I |

---

### Task 1: The engine chosen, the fallback, the overrides

**Files:**
- Create: `client/src/game/engineChoice.ts`, `client/src/game/gpuEngine.ts`, `client/test/game/engineChoice.test.ts`
- Create: `docs/rendering/<date>-webgpu-high-tier-verification.md`
- Bring over: `docs/rendering/2026-09-26-grass-webgpu-spike.md` (`git cherry-pick 996fb07`)
- Modify: `client/src/game/quality.ts` (`detectTier`), `client/src/game/renderer.ts` (the passthrough, `detectTier` removed), `client/src/app.ts`, `client/src/main.ts`, `client/src/game/lighting.ts` (`lighting.ts:165`), `tools/deploy/verify.mjs`, `ARCHITECTURE.md`
- Test: `client/test/game/quality.test.ts`, `client/test/game/renderer.test.ts`, `client/test/architecture.test.ts`, the deploy verify test

**Interfaces:**
- Consumes: `tierFor`, `QualityTier` (`quality.ts`); `WebGPUEngine`, `PBRBaseMaterial`, `StandardMaterial`, `AbstractEngine.Version`, `Logger.OnNewCacheEntry`.
- Produces (`engineChoice.ts`, pure, no Babylon import):
  - `export type EngineName = "webgl2" | "webgpu"`
  - `export const WEBGPU_ENABLED = false`
  - `export const WEBGPU_TIERS: readonly QualityTier[] = ["high", "medium"]`
  - `export const WEBGPU_REQUIRED_LIMITS: Readonly<Record<string, number>> = { maxInterStageShaderVariables: 17, maxVertexBuffers: 8 }` (Task 2D adds the measured rows)
  - `export function parseEngineOverride(search: string): EngineName | null`
  - `export function parseTierOverride(search: string): QualityTier | null`
  - `export type AdapterReport = { limits: Readonly<Record<string, number>>; isFallbackAdapter: boolean }`
  - `export function adapterFits(adapter: AdapterReport | null, required = WEBGPU_REQUIRED_LIMITS): { fits: boolean; why: string | null }`
  - `export type EngineInput = { tier: QualityTier; override: EngineName | null; remembered: boolean; on: boolean; fits: boolean | null }`
  - `export function chooseEngine(input: EngineInput, tiers = WEBGPU_TIERS): EngineName | "probe"` (`"probe"`: the answer needs the adapter)
  - `export type FallbackReason = "init" | "pipeline" | "lost"`
  - `export type FallbackRecord = { reason: FallbackReason; browser: number; babylon: string; at: number; losses: number }`
  - `export const FALLBACK_KEY = "dayhike.engine"`, `FALLBACK_NOTICE_KEY = "dayhike.engine.notice"`, `FALLBACK_DAYS = 30`, `LOSS_WINDOW_MS = 86_400_000`, `WEBGPU_FETCH_MS = 10_000`, `WEBGPU_START_MS = 10_000` (as built; first written as one 15 s budget), `STARTUP_QUIET_MS = 10_000`, `STARTUP_MAX_MS = 60_000`
  - `export function browserMajor(userAgent: string): number`
  - `export function recordFailure(prev: FallbackRecord | null, reason: FallbackReason, env: { browser: number; babylon: string }, now: number): FallbackRecord`
  - `export function fallbackHolds(record: FallbackRecord | null, env: { browser: number; babylon: string }, now: number): boolean`
  - `export function readFallback(storage: Storage | null): FallbackRecord | null` and `writeFallback(storage: Storage | null, record: FallbackRecord): boolean` (false where storage throws)
- Produces (`gpuEngine.ts`, imported only by `import()`):
  - `export async function probeAdapter(): Promise<AdapterReport | null>` (`IsSupportedAsync`, then `requestAdapter({ powerPreference: "high-performance" })`)
  - `export async function createWebGpuEngine(canvas: HTMLCanvasElement): Promise<WebGPUEngine>` (design §5.4; rejects on any failure)
  - `export function watchWebGpu(engine: WebGPUEngine, onFailure: (reason: "pipeline" | "lost", inStartup: boolean) => void): () => void`
- Produces (`quality.ts`): `export function detectTier(nav: { hardwareConcurrency?: number; deviceMemory?: number; userAgent?: string } | undefined): QualityTier`, the body of `renderer.ts:517–527` unchanged.
- Produces (`app.ts`): `GameOptions.engine?: AbstractEngine`, `GameOptions.tier?: QualityTier`.

- [ ] **Step 1: Bring the spike's note over**

```bash
git cherry-pick 996fb07
```

Append to the note, after its §4:

> **Correction, 2026-09-26.** The engine alone at native pixels is B against GL:
> −1.53 ms by lowest means (22.69 against 24.22) and −1.34 to −1.49 ms by the
> quiet pages' means, never in a pair round quiet on both pages. The summary's
> "about 2.5 ms faster at native pixels" for the engine alone is the WebGPU build
> with S (21.66 against 24.22, §4), as §6's criterion 3 correctly labels it. At
> four times the pixels the engine alone is −9.93 ms, as stated.

Commit the correction alone:

```bash
git add docs/rendering/2026-09-26-grass-webgpu-spike.md
git commit -F - <<'EOF_COMMIT'
docs: correct the spike's native figure for the engine alone

## What

The spike's summary gave the WebGPU build with the compute cull as the
engine alone at native pixels. The engine alone is about 1.5 ms there,
not 2.5; the four-times-pixels figure stands.

## How

- `docs/rendering/2026-09-26-grass-webgpu-spike.md` — a dated
  correction after its frames section.

<trailers>
EOF_COMMIT
```

- [ ] **Step 2: Write the failing tests**

`client/test/game/engineChoice.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  adapterFits, browserMajor, chooseEngine, fallbackHolds, parseEngineOverride, parseTierOverride,
  readFallback, recordFailure, writeFallback, WEBGPU_ENABLED, WEBGPU_REQUIRED_LIMITS,
} from "../../src/game/engineChoice.js";

describe("the overrides", () => {
  it("read engine= and tier= and nothing else", () => {
    expect(parseEngineOverride("?engine=webgpu")).toBe("webgpu");
    expect(parseEngineOverride("?cmd=freecam&engine=webgl2")).toBe("webgl2");
    expect(parseEngineOverride("?engine=webgl")).toBeNull();
    expect(parseEngineOverride("")).toBeNull();
    expect(parseTierOverride("?tier=high")).toBe("high");
    expect(parseTierOverride("?tier=ultra")).toBeNull();
    expect(parseTierOverride("?engine=webgpu")).toBeNull();
  });
});

describe("chooseEngine", () => {
  const high = { tier: "high" as const, override: null, remembered: false, on: true, fits: null };
  it("probes only where WebGPU could be the answer", () => {
    expect(chooseEngine(high)).toBe("probe");
    expect(chooseEngine({ ...high, fits: true })).toBe("webgpu");
    expect(chooseEngine({ ...high, fits: false })).toBe("webgl2");
    expect(chooseEngine({ ...high, tier: "medium" })).toBe("probe");
    expect(chooseEngine({ ...high, tier: "low" })).toBe("webgl2");
    expect(chooseEngine({ ...high, on: false })).toBe("webgl2");
    expect(chooseEngine({ ...high, remembered: true })).toBe("webgl2");
    expect(chooseEngine({ ...high, override: "webgl2", fits: true })).toBe("webgl2");
  });
  it("lets ?engine=webgpu past the tier, the switch and the memory, never past the adapter", () => {
    const forced = { tier: "low" as const, override: "webgpu" as const, remembered: true, on: false, fits: null };
    expect(chooseEngine(forced)).toBe("probe");
    expect(chooseEngine({ ...forced, fits: true })).toBe("webgpu");
    expect(chooseEngine({ ...forced, fits: false })).toBe("webgl2");
  });
  it("ships switched off", () => {
    expect(WEBGPU_ENABLED).toBe(false);
  });
});

describe("adapterFits", () => {
  it("wants 17 inter-stage variables, 8 vertex buffers and a hardware adapter", () => {
    expect(WEBGPU_REQUIRED_LIMITS).toEqual({ maxInterStageShaderVariables: 17, maxVertexBuffers: 8 });
    const defaults = { maxInterStageShaderVariables: 16, maxVertexBuffers: 8 };
    const reference = { maxInterStageShaderVariables: 28, maxVertexBuffers: 8 };
    expect(adapterFits({ limits: defaults, isFallbackAdapter: false }))
      .toEqual({ fits: false, why: "maxInterStageShaderVariables 16 < 17" });
    expect(adapterFits({ limits: reference, isFallbackAdapter: false })).toEqual({ fits: true, why: null });
    expect(adapterFits({ limits: reference, isFallbackAdapter: true })).toEqual({ fits: false, why: "fallback adapter" });
    expect(adapterFits(null)).toEqual({ fits: false, why: "no adapter" });
  });
});

describe("the remembered fallback", () => {
  const env = { browser: 153, babylon: "9.18.0" };
  const t0 = 1_790_000_000_000;
  it("holds after a deterministic failure until the browser or Babylon moves, or 30 days pass", () => {
    const r = recordFailure(null, "pipeline", env, t0);
    expect(r).toEqual({ reason: "pipeline", browser: 153, babylon: "9.18.0", at: t0, losses: 0 });
    expect(fallbackHolds(r, env, t0 + 1_000)).toBe(true);
    expect(fallbackHolds(r, { browser: 154, babylon: "9.18.0" }, t0)).toBe(false);
    expect(fallbackHolds(r, { browser: 153, babylon: "9.19.0" }, t0)).toBe(false);
    expect(fallbackHolds(r, env, t0 + 2_592_000_000)).toBe(false);
    expect(fallbackHolds(null, env, t0)).toBe(false);
  });
  it("gives a lost device one retry a day", () => {
    const one = recordFailure(null, "lost", env, t0);
    expect(one.losses).toBe(1);
    expect(fallbackHolds(one, env, t0)).toBe(false);
    const two = recordFailure(one, "lost", env, t0 + 3_600_000);
    expect(two.losses).toBe(2);
    expect(fallbackHolds(two, env, t0 + 3_600_000)).toBe(true);
    const nextDay = recordFailure(one, "lost", env, t0 + 90_000_000);
    expect(nextDay.losses).toBe(1);
    expect(fallbackHolds(nextDay, env, t0 + 90_000_000)).toBe(false);
  });
  it("survives storage that throws, and says it could not write", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } as unknown as Storage;
    expect(readFallback(throwing)).toBeNull();
    expect(writeFallback(throwing, recordFailure(null, "init", env, t0))).toBe(false);
    expect(readFallback(null)).toBeNull();
  });
  it("reads the browser's major version from navigator.userAgent", () => {
    expect(browserMajor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7310.4 Safari/537.36")).toBe(153);
    expect(browserMajor("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0")).toBe(145);
    expect(browserMajor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15")).toBe(26);
    expect(browserMajor("")).toBe(0);
  });
});
```

`client/test/game/quality.test.ts`, beside the `tierFor` tests:

```ts
  it("detects medium at best on a desktop that reports 8 GB, and low where memory goes unreported", () => {
    // An 8 GB report (all Chromium gave before Chrome 147) is medium at most.
    expect(detectTier({ hardwareConcurrency: 12, deviceMemory: 8, userAgent: "Chrome/153" })).toBe("medium");
    // No deviceMemory at all (the API is Chromium's alone) reads the default 4.
    expect(detectTier({ hardwareConcurrency: 12, userAgent: "Version/26.0 Safari/605.1.15" })).toBe("low");
    expect(detectTier({ hardwareConcurrency: 12, deviceMemory: 8, userAgent: "iPhone" })).toBe("low");
    expect(detectTier(undefined)).toBe("low");
  });
```

`client/test/game/renderer.test.ts`, in `"world shell wiring"`:

```ts
  it("draws on an engine it is given, and makes WebGL2's own otherwise", () => {
    expect(src).toContain("const engine = options.engine ?? new Engine(canvas, true, { stencil: true }, true);");
    expect(src).toMatch(/engine: AbstractEngine;/);
    expect(src).not.toContain("function detectTier(");
  });
```

`client/test/architecture.test.ts`, a new `it` in `"layer boundaries"`, with a reader of the static imports a bundle keeps (not `import(`, which the file's `importsOf` can match, and not `import type`, which the compiler erases):

```ts
  it("reaches the WebGPU engine from main.ts only through a dynamic import", () => {
    const staticImports = (file: string): string[] =>
      [...readFileSync(file, "utf8").matchAll(/^\s*import\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1] as string);
    const seen = new Set<string>();
    const stack = [join(SRC, "main.ts")];
    const bad: string[] = [];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of staticImports(file)) {
        if (/^@babylonjs\/core\/Engines\/(?:webgpuEngine|WebGPU\/)/.test(spec)) bad.push(`${file} imports ${spec}`);
        if (spec.startsWith(".") && spec.endsWith(".js")) stack.push(join(file, "..", spec.replace(/\.js$/, ".ts")));
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("keeps the engine choice out of sim/ and net/", () => {
    const named = [/engineChoice/, /gpuEngine/, /webgpuVertexBuffer/];
    expect(violations(join(SRC, "sim"), named)).toEqual([]);
    expect(violations(join(SRC, "net"), named)).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/engineChoice.test.ts test/game/quality.test.ts test/game/renderer.test.ts test/architecture.test.ts`
Expected: FAIL: `engineChoice.js` and `detectTier` do not exist; the renderer makes its own engine unconditionally. The static-import test passes already (nothing imports the WebGPU engine yet) and must still pass after Step 4.

- [ ] **Step 4: Implement**

`client/src/game/engineChoice.ts`: the interfaces above. `chooseEngine`, in order: `override === "webgl2"` → `"webgl2"`; `override === "webgpu"` → `fits === null ? "probe" : fits ? "webgpu" : "webgl2"`; `!tiers.includes(tier) || !on || remembered` → `"webgl2"`; else as the override case. `adapterFits`: `null` → "no adapter"; `isFallbackAdapter` → "fallback adapter"; else the first required limit the adapter's is under, as `"<name> <have> < <need>"`. `recordFailure`: a `lost` after a `lost` less than `LOSS_WINDOW_MS` old counts up, any other `lost` starts at 1, `init` and `pipeline` carry `losses: 0`. `fallbackHolds`: false for `null`, for a `lost` record under 2 losses, on a browser or Babylon mismatch, and at or past `FALLBACK_DAYS`. `readFallback` and `writeFallback` wrap every access in `try`, as `playerName.ts` does. `browserMajor`: the first of `Chrome/`, `Firefox/`, `Version/` followed by digits, else 0.

`client/src/game/quality.ts`: `detectTier(nav)` with the body of `renderer.ts:517–527`, reading `nav` instead of `globalThis.navigator`.

`client/src/game/gpuEngine.ts`, written fresh with the spike's file beside it:
- the translators: `import glslangJs from "@babylonjs/core/assets/glslang/glslang.js?url"` and the other three, as the spike has them;
- `probeAdapter`: `navigator.gpu` absent or `await WebGPUEngine.IsSupportedAsync` false → `null`; else `requestAdapter({ powerPreference: "high-performance" })` and `{ limits: <every numeric field of adapter.limits>, isFallbackAdapter: adapter.info?.isFallbackAdapter ?? false }`;
- `createWebGpuEngine`: `PBRBaseMaterial.ForceGLSL = true; StandardMaterial.ForceGLSL = true;` then `new WebGPUEngine(canvas, { antialias: true, stencil: true, adaptToDeviceRatio: true, powerPreference: "high-performance", deviceDescriptor: { requiredLimits: { ...WEBGPU_REQUIRED_LIMITS } } })` and `await engine.initAsync({ jsPath: glslangJs, wasmPath: glslangWasm }, { jsPath: twgslJs, wasmPath: twgslWasm })`, raced against `WEBGPU_START_MS`; on a timeout or a throw, `engine.dispose()` and reject;
- `watchWebGpu`: `engine.onEffectErrorObservable` and a chained `Logger.OnNewCacheEntry` (the previous handler still called) whose entry contains `WebGPU uncaptured error` → `onFailure("pipeline", inStartup)`; `engine.onContextLostObservable` → `onFailure("lost", inStartup)`; `inStartup` true until `STARTUP_QUIET_MS` pass after the first frame with no `onAfterShaderCompilationObservable` notification, or `STARTUP_MAX_MS` after creation; returns a function that removes every observer and restores `Logger.OnNewCacheEntry`.

`client/src/game/renderer.ts`: apply the spike's hunks for `createRenderer` (`git show 781e4a2 -- client/src/game/renderer.ts | git apply --3way`), then remove the `BladeGpuCountMode` import, `bladeGpuMode` and the `gpu:` option, and remove `detectTier` in favour of `detectTier(globalThis.navigator)` from `quality.ts`. The `RendererOptions.engine` comment: an engine already made for the canvas, WebGPU on the tiers of `WEBGPU_TIERS` where it fits (`engineChoice.ts`); absent, WebGL2 is made here as always.

`client/src/game/lighting.ts:165`: `new SkyMaterial("skyMaterial", scene, true)`, with a comment: GLSL on every engine, so the sky is one source on both; a no-op on WebGL2.

`client/src/app.ts`: apply the spike's hunk; add `tier` beside `engine` and pass `{ engine: options.engine, tier: options.tier }`. On start, if `sessionStorage[FALLBACK_NOTICE_KEY]` holds a line (wrapped in `try`), remove it and show it with `hud.setStatus` for 6 s.

`client/src/main.ts`, in `render` where the game starts (`main.ts:484–499`): keep the spike's render token. Resolve `tier = parseTierOverride(location.search) ?? detectTier(navigator)`, `override`, `remembered = fallbackHolds(readFallback(safeLocal()), env, Date.now())` with `env = { browser: browserMajor(navigator.userAgent), babylon: AbstractEngine.Version }`, then `chooseEngine`. On `"probe"`: `import("./game/gpuEngine.js")`, `probeAdapter()`, `adapterFits`, and `chooseEngine` again with `fits`; a `"webgpu"` answer calls `createWebGpuEngine(canvas)`. Any rejection: `writeFallback(..., recordFailure(prev, "init", env, now))`, one `console.warn` naming the reason, and WebGL2. A `?engine=webgpu` that does not fit: WebGL2 and one `console.warn` with `why`. Start the game with `{ engine, tier }`; on WebGPU, `watchWebGpu(engine, onFailure)`, where `onFailure` writes `recordFailure(...)` and, for `lost` or an `inStartup` failure, sets the notice line ("Graphics switched to WebGL2 after a GPU error." if the new record holds, else "Graphics restarted after a GPU error.") and reloads: `location.reload()` if the record was written, else `location.replace` with `engine=webgl2` added to the query. Otherwise one `console.error` and no reload. A superseded render disposes an engine that arrives late, as the spike does.

`tools/deploy/verify.mjs`: every `/assets/…-<hash>.wasm` URL the built JS names is fetched and must answer 200 with `application/wasm` and begin with the WebAssembly magic `00 61 73 6d`; its test gains the case.

`ARCHITECTURE.md`, in the tiers sentence: the tier can be forced with `?tier=`, and the engine with `?engine=webgl2|webgpu`, which today is the only way onto WebGPU (`engineChoice.ts`, `gpuEngine.ts`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/engineChoice.test.ts test/game/quality.test.ts test/game/renderer.test.ts test/architecture.test.ts test/game/lighting.test.ts test/game/post.test.ts`, then `npx vitest run --root tools`.
Expected: all pass; `npm run typecheck` green (`Renderer.engine` is now `AbstractEngine`; `landingScene.ts` uses only `runRenderLoop` and `stopRenderLoop`).

- [ ] **Step 6: Commit**

```bash
git add client/src/game/engineChoice.ts client/src/game/gpuEngine.ts client/src/game/quality.ts client/src/game/renderer.ts client/src/game/lighting.ts client/src/app.ts client/src/main.ts tools/deploy/verify.mjs <verify test> ARCHITECTURE.md client/test/game/engineChoice.test.ts client/test/game/quality.test.ts client/test/game/renderer.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF_COMMIT'
feat: choose the engine before the game starts, with a fallback

## What

The high tier can now run on Babylon's WebGPU engine, reached for now
only with ?engine=webgpu, and every way that engine can fail ends on
WebGL2: before the game starts in the same load, after it by a reload
the page remembers. The tier can be forced with ?tier=, which the
rendering gates have needed and detection never reaches high.

## How

- `client/src/game/engineChoice.ts` — the overrides, the rule, the
  limits check and the remembered fallback, pure.
- `client/src/game/gpuEngine.ts` — the adapter probe, the engine with
  GLSL forced through Babylon's public switches and the shipped
  translators, the failure watcher; loaded by dynamic import only.
- `client/src/main.ts`, `app.ts`, `renderer.ts`, `quality.ts` — the tier
  and engine resolved first and passed through; `detectTier` moved.
- `client/src/game/lighting.ts` — the sky material on GLSL everywhere.
- `tools/deploy/verify.mjs` — the translators served as WebAssembly.
- `client/test/…` — the rule over literal inputs, detection, the
  passthrough, no static route to the WebGPU engine.

<trailers>
EOF_COMMIT
```

- [ ] **Step 7: Gate**

On the branch, against `main` for the WebGL2 rows:

1. **WebGL2 unchanged.** The frame at the canopy pose (design §13.1's method, `?tier=high` on the branch, the tier patch on `main`), branch WebGL2 against `main`: within the same-code floor. Zero console errors.
2. **The fallback on real failures.** `?engine=webgpu&tier=high` at the canopy pose: the translation faults of design §3.3 fire, and the page ends on WebGL2 each time: a reload with the HUD line, the record in `localStorage`, the next load on WebGL2, and with the record deleted, the same again. Design §13.6 items 1, 2 and 5 as written there.
3. **The bundle.** `npm run build`: the main chunk's size against `main`'s, and the WebGPU chunk and the two `.wasm` files listed separately.

Create the verification note: §1 Method (the builds, the page, the patches in words, the pair method, the quiet rule, the injections), §2 Task 1's gate. Commit the note alone (`docs: record the engine choice gate`).

---

### Task 2: The six compatibility changes

Six commits after one commit of pins, labelled as the design's §6.1–§6.6 (2A–2F) and taken in the order 2A, 2B, 2C, 2E, 2F, 2D. Each change's failing test is written first.

**Files:** as the file map, rows marked 2.

**Interfaces:**
- Produces: `finishFragmentFor(webgpu: boolean): string` (`post.ts`); `terrainHexDefs(webgpu: boolean): string` and `HEX_FETCH_MACROS: string` (`terrainTexture.ts`); `WEBGPU_REQUIRED_LIMITS` with its measured rows (`engineChoice.ts`); `pluginTexts(): Record<string, string>` (`client/test/game/helpers/pluginText.ts`).

- [ ] **Step 1: The WebGL2 identity pins**

`client/test/game/helpers/pluginText.ts`: builds, on one `NullEngine` and scene, each of the nine plugins (`SkinShadingPlugin`, `TerrainTexturePlugin` with road, trail and features enabled for seed `atmo` the way `terrainTexture.test.ts` builds them, `AtmospherePlugin`, `DistanceFadePlugin`, `FoliageLightPlugin`, `GroundConformPlugin`, `FoliagePlugin` for each `FOLIAGE_PROFILES` entry, `WingPlugin`, `CliffTintPlugin`) the way each one's own test file does, moving those builders here so both use one; returns `"<name>[.<profile>].<vertex|fragment>"` (`terrain.fragment`, `foliage.BLADES.vertex`, …) → the entries of `getCustomCode(type)` in sorted key order, each as its key on a line of its own and then its code, raw (not JSON, whose escapes would hide a name at the start of a line from the scans below), plus `"post.grade"`, `"post.finish"`, `"post.halationExtract"` → the stored shader text.

`client/test/game/webglIdentity.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pluginTexts } from "./helpers/pluginText.js";
import groundHexFx from "../../src/game/shaders/groundHex.fragment.fx?raw";
import finishFx from "../../src/game/shaders/finish.fragment.fx?raw";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

// WebGL2's shader text at the branch's base (ba0fd95), one hash per text.
// A change here is a change to what every WebGL2 player compiles.
const PINS: Record<string, string> = {
  // written in by Step 1 from the unchanged base; one line per key of pluginTexts()
};

describe("WebGL2's shader text", () => {
  it("is byte for byte what it was", () => {
    const texts = pluginTexts();
    expect(Object.keys(texts).sort()).toEqual(Object.keys(PINS).sort());
    for (const [key, text] of Object.entries(texts)) expect(sha(text), key).toBe(PINS[key]);
  });

  it("pins the hex include and the finish pass as files", () => {
    expect(sha(groundHexFx)).toBe("21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb");
    expect(sha(finishFx)).toBe("4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5");
  });
});
```

Run it once on the unchanged base with a temporary `console.log(key, sha(text))` in the loop, copy each hash in as its literal, remove the log, run again: PASS. Commit the helper, the test and the builders moved out of the plugin test files (`test: pin the WebGL2 shader text before the WebGPU changes`).

- [ ] **Step 2 (2A): The finish pass, and no global uniformity override**

Test first, in `client/test/game/post.test.ts`:

```ts
import { createHash } from "node:crypto";
import finishFx from "../../src/game/shaders/finish.fragment.fx?raw";
import { finishFragmentFor } from "../../src/game/post.js";

describe("the finish pass's text per engine", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  it("is the file itself on WebGL2", () => {
    expect(sha(finishFragmentFor(false))).toBe("4465c9bf20695c3a2abd6e7a11ac1fac0a71d2ea5e4f15efe306fc84cf45a1a5");
  });
  it("turns uniformity analysis off for itself alone on WebGPU", () => {
    // Its second read of the scene sits inside a branch on vUV. The target has
    // one mip level, so the implicit LOD it gives up cannot pick another.
    expect(finishFragmentFor(true)).toBe("#define DISABLE_UNIFORMITY_ANALYSIS\n" + finishFx);
  });
});
```

and in `client/test/architecture.test.ts`: no file under `client/src` contains `_createPipelineStageDescriptor`.

Implement: `export function finishFragmentFor(webgpu: boolean): string`, and `Effect.ShadersStore["finishFragmentShader"] = finishFragmentFor(engine.isWebGPU)` (`post.ts:104`). Run `post.test.ts`, `webglIdentity.test.ts`, `architecture.test.ts`: PASS. Commit (`fix: let the finish pass read in divergent flow on WebGPU`).

- [ ] **Step 3 (2B): The hex fetches as macros on WebGPU**

Test first, in `client/test/game/groundHex.test.ts`:

```ts
import { createHash } from "node:crypto";
import head from "../../src/game/shaders/groundHex.fragment.fx?raw";
import fetches from "../../src/game/shaders/groundHexFetch.fragment.fx?raw";
import noise from "../../src/game/shaders/groundHexNoise.fragment.fx?raw";
import { HEX_FETCH_MACROS, terrainHexDefs } from "../../src/game/terrainTexture.js";

describe("the hex include, per engine", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  it("joins back into the original include, byte for byte", () => {
    expect(sha(head + fetches + noise)).toBe("21a6e1061ff6d1a66c384400f5eae5538cec24b17e7f551c647aa825c710f9bb");
    expect(terrainHexDefs(false)).toContain(head + fetches + noise);
  });
  it("gives WebGPU the two fetches as macros and no function taking a sampler", () => {
    const gpu = terrainHexDefs(true);
    expect(gpu).toContain(head + HEX_FETCH_MACROS + noise);
    expect(gpu).not.toMatch(/\w+\s+\w+\s*\([^)]*\bsampler2D(?:Array)?\b[^)]*\)\s*\{/);
    expect(gpu).toContain("#define hexFetch2D(tex, u1, u2, u3, s, dx, dy)");
    expect(gpu).toContain("#define hexFetchArray(tex, u1, u2, u3, s, layer, dx, dy)");
  });
  it("fetches with the same six terms either way", () => {
    const terms = (s: string) =>
      [...s.matchAll(/textureGrad\(tex, (?:vec3\()?u[123](?:, layer\))?, dx, dy\)\.rgb \* \(?s\)?\.[xyz]/g)]
        .map((m) => m[0].replace("(s)", "s"));
    expect(terms(fetches)).toHaveLength(6);
    expect(terms(HEX_FETCH_MACROS)).toEqual(terms(fetches));
  });
});
```

The lockstep tests in that file, which read `groundHexFx`, read `head + fetches + noise`.

Implement: split `groundHex.fragment.fx` at lines 88 and 116 (`sed -n 88,115p` and `sed -n 116,145p` into the two new files, `sed -i '' 88,145d` on the original), adding no line to any of the three, since their join must be the original; `HEX_FETCH_MACROS` is the spike's `HEX_MACROS` text; `terrainHexDefs(webgpu)` returns the wrapper `TERRAIN_HEX_DEFS` has today (`terrainTexture.ts:337–340`) around `head + (webgpu ? HEX_FETCH_MACROS : fetches) + noise`; `getCustomCode` calls it with `this._material.getScene().getEngine().isWebGPU`. Run `groundHex.test.ts`, `terrainTexture.test.ts`, `shaderHygiene.test.ts`, `webglIdentity.test.ts`: PASS (the identity pin on the terrain fragment does not move). Commit (`fix: fetch the hex tiles through macros on WebGPU`).

- [ ] **Step 4 (2C): The reserved word**

Test first, in `client/test/game/terrainTexture.test.ts` (or a new `wgslNames.test.ts`):

```ts
// WGSL's keywords and reserved words (the WGSL specification's lists). A GLSL
// name the translation carries through as one fails to parse on WebGPU.
const WGSL_RESERVED = new Set([
  "alias", "break", "case", "const", "const_assert", "continue", "continuing", "default", "diagnostic",
  "discard", "else", "enable", "false", "fn", "for", "if", "let", "loop", "override", "requires", "return",
  "struct", "switch", "true", "var", "while",
  "NULL", "Self", "abstract", "active", "alignas", "alignof", "as", "asm", "asm_fragment", "async",
  "attribute", "auto", "await", "become", "cast", "catch", "class", "co_await", "co_return", "co_yield",
  "coherent", "column_major", "common", "compile", "compile_fragment", "concept", "const_cast", "consteval",
  "constexpr", "constinit", "crate", "debugger", "decltype", "delete", "demote", "demote_to_helper", "do",
  "dynamic_cast", "enum", "explicit", "export", "extends", "extern", "external", "fallthrough", "filter",
  "final", "finally", "friend", "from", "fxgroup", "get", "goto", "groupshared", "highp", "impl",
  "implements", "import", "inline", "instanceof", "interface", "layout", "lowp", "macro", "macro_rules",
  "match", "mediump", "meta", "mod", "module", "move", "mut", "mutable", "namespace", "new", "nil",
  "noexcept", "noinline", "nointerpolation", "non_coherent", "noncoherent", "noperspective", "null",
  "nullptr", "of", "operator", "package", "packoffset", "partition", "pass", "patch", "pixelfragment",
  "precise", "precision", "premerge", "priv", "protected", "pub", "public", "readonly", "ref",
  "regardless", "register", "reinterpret_cast", "require", "resource", "restrict", "self", "set", "shared",
  "sizeof", "smooth", "snorm", "static", "static_assert", "static_cast", "std", "subroutine", "super",
  "target", "template", "this", "thread_local", "throw", "trait", "try", "type", "typedef", "typeid",
  "typename", "typeof", "union", "unless", "unorm", "unsafe", "unsized", "use", "using", "varying",
  "virtual", "volatile", "wgsl", "where", "with", "writeonly", "yield",
]);
const TYPES = "(?:void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?|sampler2D(?:Array)?(?:Shadow)?)";

function declaredNames(glsl: string): string[] {
  return [...glsl.matchAll(new RegExp(`\\b${TYPES}\\s+([A-Za-z_]\\w*)`, "g"))].map((m) => m[1] as string);
}

it("declares no name WGSL reserves, on either assembly", () => {
  const texts = { ...pluginTexts(), "terrain.hex.webgpu": terrainHexDefs(true), "post.finish.webgpu": finishFragmentFor(true) };
  for (const [key, text] of Object.entries(texts)) {
    expect(declaredNames(text).filter((n) => WGSL_RESERVED.has(n)), key).toEqual([]);
  }
});
```

Run: FAIL on `macro` in the terrain fragment. Implement: `vec3 macro` → `vec3 macroRgb` and its use (`terrainTexture.ts:558–559`). In `webglIdentity.test.ts`, re-pin the terrain fragment's key to the new hash and add:

```ts
  it("changes the terrain fragment by one renamed identifier and nothing else", () => {
    const text = pluginTexts()["terrain.fragment"] as string;
    // The WGSL-reserved local `macro` renamed at source on both engines. The
    // word survives only in the hex include's comments, which glslang drops.
    expect(text).toContain("vec3 macroRgb = macroTint(");
    expect(text).not.toContain("vec3 macro =");
    expect(sha(text.replaceAll("macroRgb", "macro"))).toBe("<the terrain.fragment literal from Step 1>");
  });
```

Run the scan, `webglIdentity.test.ts`, `terrainTexture.test.ts`: PASS. Commit (`fix: rename a terrain local that WGSL reserves`).

- [ ] **Step 5 (2E): Every declared sampler bound**

Test first, `client/test/game/pluginBindings.test.ts`:

```ts
it("binds every sampler a plugin declares, in every state it is bound in", () => {
  for (const { name, plugin, states, scene, engine, subMesh } of pluginsInStates()) {
    for (const enter of states) {
      enter();
      const declared: string[] = [];
      plugin.getSamplers(declared);
      const bound = new Set<string>();
      const ubo = new Proxy({}, {
        get: (_t, key) => (key === "setTexture" ? (n: string) => bound.add(n) : () => undefined),
      }) as unknown as UniformBuffer;
      plugin.bindForSubMesh(ubo, scene, engine, subMesh);
      expect(declared.filter((s) => !bound.has(s)), name).toEqual([]);
    }
  }
});
```

`pluginsInStates()` lives beside `pluginTexts()`; the atmosphere's states are "before its first `update`" and "after it", the terrain's are its plain and fully enabled states. Run: FAIL on `atmGradient` before the first update. Implement: `atmosphere.ts:79–95`, `if (gradientTexture !== null) uniformBuffer.setTexture("atmGradient", gradientTexture);` first, and the later bind removed. Run with `atmosphere.test.ts` and `webglIdentity.test.ts`: PASS. Commit (`fix: bind the atmosphere's gradient whenever it exists`).

- [ ] **Step 6 (2F): The WebGPU engine's extensions**

Test first, in `architecture.test.ts`: `readFileSync(join(SRC, "game/gpuEngine.ts"), "utf8")` contains `import "@babylonjs/core/Engines/WebGPU/Extensions/index.js";`; the static-graph test of Task 1 still passes. Implement: the import, with the spike's comment (the WebGPU engine's own dynamic texture, compute and multi-render extensions, which the WebGL2 imports never reach; the signs' painted textures throw without them). Run: PASS. Commit (`fix: load the WebGPU engine's extensions with it`).

- [ ] **Step 7 (2D): The required limits, measured**

Taken last of the six, because its measurement needs every other fault out of the way.

Measure first, on the branch at this commit, `?engine=webgpu&tier=high` and again `?engine=webgpu&tier=medium` (medium builds its own shadow and post-chain variants: one cascade, the grade pass first and multisampled), with the sweep of Step 8 at every pose of design §7.1 and the spawn view: with `requiredLimits` holding only `maxInterStageShaderVariables: 17` and `maxVertexBuffers: 8`, every validation error names the limit a pipeline exceeds; raise that limit to the smallest value that clears it and repeat until the sweep is clean on both tiers, each limit the larger of the two tiers' values. Record in the note each limit's required value, the pipeline and the tier that set it, and the reference adapter's own value. If a Windows adapter's `adapter.limits` can be read, record its inter-stage variables too (design §5.2).

Then the test, in `engineChoice.test.ts`: `WEBGPU_REQUIRED_LIMITS` toEqual the measured object as a literal; the WebGPU defaults fail on the first limit they are short of; the reference adapter's recorded limits pass. Implement: the measured rows in `WEBGPU_REQUIRED_LIMITS`. Run: PASS. Commit (`fix: ask WebGPU for exactly the limits the scene needs`), the note's measurement in the same commit.

- [ ] **Step 8: Gate: the sweep**

A measurement patch, never committed, run once the scene settles on `?engine=webgpu&tier=high`, and all of it again on `?engine=webgpu&tier=medium`: every mesh with a material is compiled for the main pass with `material.forceCompilationAsync(mesh)`; the lamp is switched on and the compile repeated; `weather rain` and again; `weather eerie`, `time 21` and again. At every pose of design §7.1, the spawn view and the trailhead with the rangers in view. **Bar, on each tier:** zero `engine.onEffectErrorObservable` notifications, zero `WebGPU uncaptured error` entries, zero console errors; every translated shader that needed the finish pass's treatment named, with its reason and tier. On WebGL2 at the same poses and tiers: zero errors, as before.

Append `## 3. The six changes` to the note: each change, its commit, its test; the sweep's list; the measured limits. Commit the note alone.

---

### Task 3: The pipeline-cache workaround, pinned, and the draft upstream issue

**Files:**
- Create: `client/src/game/webgpuVertexBuffer.ts`, `client/test/game/webgpuVertexBuffer.test.ts`
- Modify: the verification note (the draft issue, as design Appendix A)

**Interfaces:**
- Produces: `export const OFFSET_HASH_SHIFT = 2 ** 24`; `export function offsetKeyedVertexBuffer(buffer: Buffer, kind: string, offset: number, size: number, instanced?: boolean): VertexBuffer` (offset and size in floats, as `Buffer.createVertexBuffer`).

- [ ] **Step 1: Write the failing tests**

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Buffer } from "@babylonjs/core/Buffers/buffer.js";
import { OFFSET_HASH_SHIFT, offsetKeyedVertexBuffer } from "../../src/game/webgpuVertexBuffer.js";

const require = createRequire(import.meta.url);
let engine: NullEngine;
let buffer: Buffer;
beforeEach(() => {
  engine = new NullEngine();
  buffer = new Buffer(engine, new Float32Array(24 * 8), false, 8);
});
afterEach(() => engine.dispose());

describe("Babylon's WebGPU pipeline cache (canaries: when one fails, a fixed Babylon is installed; remove the workaround and its callers in the upgrade's own commit)", () => {
  it("still hashes two vertex buffers alike when only their offset differs", () => {
    const a = buffer.createVertexBuffer("tint", 0, 4);
    const b = buffer.createVertexBuffer("tint", 4, 4);
    expect([a.byteOffset, b.byteOffset]).toEqual([0, 16]);
    expect(a.hashCode).toBe(b.hashCode);
  });
  it("still keys an attribute's vertex state by that hash and its location only", () => {
    const src = readFileSync(require.resolve("@babylonjs/core/Engines/WebGPU/webgpuCacheRenderPipeline.js"), "utf8");
    expect(src).toContain("const vid = vertexBuffer.hashCode + (location << 7);");
  });
});

describe("offsetKeyedVertexBuffer", () => {
  it("keys its hash by the byte offset, above the stride's bits", () => {
    expect(OFFSET_HASH_SHIFT).toBe(16_777_216);
    const a = offsetKeyedVertexBuffer(buffer, "tint", 0, 4);
    const b = offsetKeyedVertexBuffer(buffer, "tint", 4, 4);
    expect(b.hashCode - a.hashCode).toBe(268_435_456);
  });
  it("keeps the offset term when Babylon recomputes the hash", () => {
    const b = offsetKeyedVertexBuffer(buffer, "tint", 4, 4);
    b.instanceDivisor = 1; // the setter recomputes the hash when instancing flips
    const plain = buffer.createVertexBuffer("tint", 4, 4, undefined, true);
    expect(b.hashCode - plain.hashCode).toBe(268_435_456);
  });
});
```

and in `architecture.test.ts`: outside `webgpuVertexBuffer.ts`, no file under `client/src` contains `createVertexBuffer(` or `new VertexBuffer(`.

- [ ] **Step 2: Run to verify they fail** — `cd client && npx vitest run test/game/webgpuVertexBuffer.test.ts`: the canaries PASS (they describe Babylon 9.18.0 as it is); the workaround's tests FAIL (the module does not exist).

- [ ] **Step 3: Implement**

`webgpuVertexBuffer.ts`: `buffer.createVertexBuffer(kind, offset, size, undefined, instanced)`; then on that instance, `_computeHashCode` replaced by a function that calls the original and adds `vb.byteOffset * OFFSET_HASH_SHIFT` to `hashCode`, and called once. The module comment says what the bug is, where (`buffer.pure.js:337–345`, `webgpuCacheRenderPipeline.js:720` and `794–834`), why the replacement is per instance (the `instanceDivisor` setter recomputes, `buffer.pure.js:234–239`), and that the canaries above say when it can go.

- [ ] **Step 4: Run** — the file and `architecture.test.ts`: PASS.

- [ ] **Step 5: Commit** (`fix: key interleaved vertex buffers by offset on WebGPU`), the module, its test and `architecture.test.ts`.

- [ ] **Step 6: The draft issue**

Append `## 4. The pipeline-cache bug` to the note: design Appendix A's title and body, and above them one line: filing it is a manual step outside this plan; nothing here files it. Commit the note alone. This task stops at the draft.

---

### Task 4: The impostor bake, event-driven

**Files:**
- Modify: `client/src/game/forestMeshes.ts` (`defaultBakeImpostor`, `ForestMeshesOptions.bakeImpostor`, `adoptBake`, `dispose`)
- Test: `client/test/game/forestMeshes.test.ts`

**Interfaces:**
- Produces: `export const IMPOSTOR_BAKE_WARN_MS = 30_000`; `export type BakeOptions = { signal?: AbortSignal; warnMs?: number }`; `defaultBakeImpostor(mesh, scene, options?: BakeOptions, pose?: Quaternion): Promise<Texture | null>`. The injected `bakeImpostor`'s third parameter changes type the same way; its callers pass `{ signal }` from an `AbortController` the forest aborts in `dispose`.

- [ ] **Step 1: Write the failing tests**

In `describe("defaultBakeImpostor readiness gate")`, replace `"a gate that never opens times out to null and disposes the blank RTT"` with:

```ts
  it("waits past the old five seconds, warns once at thirty, and bakes when the gate opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const { scene, mesh } = bakeScene();
    let polls = 0;
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockImplementation(() => ++polls > 2_500);
    vi.spyOn(RenderTargetTexture.prototype, "render").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = defaultBakeImpostor(mesh, scene);
    await vi.advanceTimersByTimeAsync(41_000);
    expect(await pending).not.toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toContain("s0_lod1");
    vi.useRealTimers();
  });

  it("resolves null on a shader error, and says so", async () => {
    const { scene, mesh } = bakeScene();
    vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
    vi.spyOn(SubMesh.prototype, "_getDrawWrapper").mockReturnValue(
      { effect: { getCompilationError: () => "ERROR: 0:1: 'x' : undeclared identifier" } } as never,
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await defaultBakeImpostor(mesh, scene)).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });

  it("stops polling when aborted, disposes the target, and logs nothing", async () => {
    const { scene, mesh } = bakeScene();
    const gate = vi.spyOn(RenderTargetTexture.prototype, "isReadyForRendering").mockReturnValue(false);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const abort = new AbortController();
    const pending = defaultBakeImpostor(mesh, scene, { signal: abort.signal });
    await new Promise((r) => setTimeout(r, 50));
    abort.abort();
    expect(await pending).toBeNull();
    const calls = gate.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(gate.mock.calls.length).toBe(calls);
    expect(errors).not.toHaveBeenCalled();
    expect(scene.textures.some((t) => t.name === "forest_impostor_bake")).toBe(false);
  });
```

and, through `createForestMeshes` with the file's `build()` and a `bakeImpostor` stub that resolves `null`: one `console.error` whose text names the billboard (`forest_impostor_<name>`); with a stub whose promise is still pending when `dispose` runs, the stub's `signal` is aborted.

The existing call that passes `5000` as the third argument (`forestMeshes.test.ts:1225`) passes `undefined` instead; the one that passes `40` (`:1281`) goes with the test it belonged to.

- [ ] **Step 2: Run to verify they fail** — `cd client && npx vitest run test/game/forestMeshes.test.ts`: the old code resolves null at 5 s, logs nothing, and cannot be aborted.

- [ ] **Step 3: Implement**

`defaultBakeImpostor`: the loop polls `rtt.isReadyForRendering()` every 16 ms with no deadline. Each poll, first: `options.signal?.aborted` → dispose the camera and target, resolve null; any clone's submesh with `_getDrawWrapper(rtt.renderPassId)?.effect?.getCompilationError()` non-empty → one `console.error("forest impostor bake failed: " + mesh.name + ": " + error)`, dispose, resolve null. Once past `warnMs ?? IMPOSTOR_BAKE_WARN_MS` still unready, one `console.error("forest impostor bake still waiting after 30 s: " + mesh.name)`. The function comment's last two paragraphs rewritten: no deadline; the three ways it ends; why no budget (a guess per engine and per machine, and a slow machine on WebGL2 missed the old one too). `adoptBake`: a null that was not an abort logs `console.error("forest impostor: no bake for forest_impostor_" + name)`. `createForestMeshes`: one `AbortController`, its signal passed to every bake, aborted first thing in `dispose`.

- [ ] **Step 4: Run** — `forestMeshes.test.ts`, then `renderer.test.ts`: PASS.

- [ ] **Step 5: Commit** (`fix: let the impostor bake finish however long its shaders take`).

- [ ] **Step 6: Gate**

On both engines, cold (a fresh browser profile), at the canopy pose and at cliff face-80m: all five billboards land (their buckets enabled; the far forest visible past `NEAR_RADIUS`), with the time each landed. Zero console errors on WebGL2; on WebGPU the 30 s warning, if it fires, is recorded with the model it names. Append `## 5. The impostor bake`; commit the note alone.

---

### Task 5: The trail bed, diagnosed and fixed

The design gives the reading (§8.2), the ranked mechanisms (§8.3) and the first step (§8.4). The fix is not written until the diagnosis names its cause.

**Files:**
- Modify: the verification note; then the files the finding names.
- Test: the test that pins the finding's fix (below).

- [ ] **Step 1: The first diagnostic step**

On the branch, one build, canopy pose, mist, noon, `?tier=high`, each engine; then all of this step again at `?tier=medium`, where the environment probe, the one-cascade shadow and the grade pass drawing the scene target are the medium tier's own (design §7.1), so the difference may not be the same size or have the same cause. Place the **bed crop** on the canopy still on the trail's bed 4–12 m out, and a **sky crop** at the top of the frame, both drawn back onto the still; record them as literals. Three stills per engine, each on its own fresh page: (a) as is; (b) `__scene.environmentIntensity = 0` and every material's `reflectionTexture` and the scene's environment set to null, 1.5 s, then the still; (c) `weather clear`. For each: the bed crop's mean linear RGB, its CIELAB, its luminance; the sky crop's the same. Two WebGL2 loads of (a) give the floor.

- If (b) closes the gap to within the design's §7.3 bar: the environment chain. Next, on each engine, read the probe's six faces back (`probe.cubeTexture.readPixels(face, 0)`) and compare them face by face; compare the sky crops; compare the BRDF lookup (`scene.environmentBRDFTexture.readPixels()`).
- If (b) does not close it: an uncommitted patch replaces the bed's final `surfaceAlbedo = tCol;` (`trailPaint.ts:474`) with `surfaceAlbedo = vec3(tSnow, terrainWet, clamp(vTerrainW2.w, 0.0, 1.0));`, and sets `WebGPUCacheRenderPipeline.LogErrorIfNoVertexBuffer = true` before the scene is built; stills (a) on each engine; the three channels compared.

- [ ] **Step 2: Record the finding**

Append `## 6. The trail bed` to the note: the stills, the crops, the numbers, the branch of the ladder taken, and the cause as found. Commit the note alone before any fix.

- [ ] **Step 3: The failing test, then the fix**

Per finding, in the design's order of preference (a change only the WebGPU path takes):
- **The probe** (its faces differ): the probe made with an explicit format and gamma on WebGPU, or its mips generated by the same path on both. Test: `lighting.test.ts` pins the probe's construction on a stubbed WebGPU engine and unchanged on `NullEngine`.
- **The sky** (the sky crop differs with the probe's faces): the sky constructed without `forceGLSL` on WebGPU, so Babylon's own WGSL sky draws it (`lighting.ts:165`); or the diverging sky parameter clamped in `skyMaterialParamsUnder`. Test: the constructor argument pinned per engine; or the parameter's clamp as literals in `lighting.test.ts`.
- **A trail input**: the binding fixed where the finding points. Test: the binding pinned in `terrainTexture.test.ts`.

Each: write the test, run it to see it fail, make the change, run the file with `webglIdentity.test.ts`: PASS. Commit (`fix: <what the finding was>`), one commit per cause.

- [ ] **Step 4: Gate**

The canopy pose's bed and sky crops and the four trail poses of design §7.1, both engines, at `?tier=high` and at `?tier=medium`, by §7.3's bar on each tier, with the verdict in words; the WebGL2 stills at the trail poses against `main` on both tiers, inside the floor. Append the gate to the note's §6; commit the note alone. If the bar is missed, back to Step 1 with the difference that remains.

---

### Task 6: The full gates, and the switch turned on

**Prerequisite: the live renderer swap.** Before the switch goes on, a WebGPU failure after the game has started must fall back without reloading: the renderer rebuilt live onto a fresh WebGL2 canvas, the world, the session and the lobby kept (design §5.5), because a fallback reload in the startup window ends a host's room and strands a follower. The tier-detection work, its own design, is building that rebuild (tier changes applied mid-hike without a reload, a change of engine on a fresh canvas included). Task 6 starts only once it has landed, with a commit that routes `main.ts`'s failure paths through it, with its test, as design §5.5 says: a pipeline failure or an uncaptured error, in the startup window or after it, swaps now onto a fresh WebGL2 canvas and is remembered; a first lost device in 24 h rebuilds on a new WebGPU engine on a fresh canvas (one retry, counted); a second swaps onto WebGL2 and is remembered. The record, the lost-device count and the pin in the URL stay as Task 1 built them. Steps 1–3 may be measured before it lands; Step 4 runs after it; Step 6 may not be taken before.

**Files:**
- Modify: `client/src/game/engineChoice.ts` (`WEBGPU_ENABLED`), `client/test/game/engineChoice.test.ts`, `ARCHITECTURE.md`, the verification note

- [ ] **Step 1: Parity** — design §7, all nine poses, both engines, one build, at `?tier=high` and again at `?tier=medium` (the same poses and crops; medium draws a 1024² shadow map with one cascade, half the high tier's blades floored at four a clump, the duff to 16 m, cliff rings to 250 m, no scene pass or halation so the grade pass is first and multisampled, mips capped at 1024, and fewer rain and mote particles; design §7.1): every crop's measures and each tier's own same-engine floor, every pose's verdict per tier; accepted crops with their reasons. Bar: design §7.3–§7.4, on each tier.

- [ ] **Step 2: Frame** — design §13.1, at `?tier=high` and again at `?tier=medium`, each tier with its own same-code floors: the canopy pose at native against the one bar (WebGPU faster than WebGL2 by more than the larger of the two engines' floors), the high tier's delta also reported against its 1.5 ms expectation; every other pose against the guard (WebGPU − WebGL2 no larger than the larger of the two engines' floors; a regression at any pose blocks that tier), its gain reported; the 4× and 1920 × 1080 rows, JS frame time and draw calls; WebGL2 branch against `main` once per tier. Per design §16, with Step 1's parity, a tier passes on bar, guard and parity together: both tiers pass, both on; one passes, `WEBGPU_TIERS` becomes that tier alone in its own commit with its test before Step 6; neither, the switch stays off. If the grass frame filter is on `main` by now, rebase first: both engines carry it, and its own invisibility check and turn (its design §12.1, §12.4) are rerun on WebGPU at the canopy pose.

- [ ] **Step 3: Startup, memory, console** — design §13.3, §13.4, §13.5; the console bar on every page of both tiers.

- [ ] **Step 4: The fallback** — after the live swap has landed: design §13.6, items 1, 2, 3′–5′ (the swap, each with a second page following as a party member), 7 and 8, on the branch as it now stands.

- [ ] **Step 5: Record** — append `## 7. The gates` to the note with every table, and commit the note alone. If a startup, memory, console or fallback bar is missed, design §16's fallback for it, in its own commit with its test, and the affected gate re-run; the switch is not turned on with one of those missed. The frame and parity gates decide per tier (Step 2).

- [ ] **Step 6: Turn the switch on**

Test first: `expect(WEBGPU_ENABLED).toBe(true);` in `engineChoice.test.ts` (was `false`). Run: FAIL. Implement: `export const WEBGPU_ENABLED = true;`, its comment naming the note's §7. `ARCHITECTURE.md`, in the rendering section: on the tiers of `WEBGPU_TIERS` (the high and medium tiers, unless Step 2 narrowed it) the scene is drawn with Babylon's WebGPU engine where the browser offers a hardware adapter with the limits `engineChoice.ts` names, its GLSL translated at run time, and with WebGL2 everywhere else and after any failure (`gpuEngine.ts`); a failure is remembered per browser and Babylon version. Run: PASS.

```bash
git add client/src/game/engineChoice.ts client/test/game/engineChoice.test.ts ARCHITECTURE.md
git commit -F - <<'EOF_COMMIT'
feat: draw the high and medium tiers with WebGPU where it can

## What

On the high and medium tiers the scene now draws with Babylon's WebGPU engine
wherever the browser offers a hardware adapter with the limits the
scene needs, and with WebGL2 everywhere else and after any failure. It
draws the same picture at every pose the gates know, on both tiers, and is
faster at the canopy pose by the margins the verification note records.

## How

- `client/src/game/engineChoice.ts` — `WEBGPU_ENABLED` on.
- `ARCHITECTURE.md` — the engine on those tiers, and the fallback.
- `client/test/game/engineChoice.test.ts` — the switch pinned.

<trailers>
EOF_COMMIT
```

---

### Task 7: The compute-culled blades (build I), against the grass frame filter

Starts only once Task 6 has merged (the engine path on `main`, by default or behind the override per design §16) and the grass frame filter's step 1a has merged.

**Files:**
- Create: `client/src/game/bladeGpu.ts`, `client/test/game/bladeGpu.test.ts`
- Modify: `client/src/game/bladeMeshes.ts` (the collected buffers handed over; `cull` skipped on the blade buckets while I runs), `client/src/game/renderer.ts` (I made on WebGPU on the tiers that draw blades), `client/src/game/engineChoice.ts` (`maxStorageBuffersPerShaderStage: 6`, and `indirect-first-instance` if the layout below needs it), `ARCHITECTURE.md`
- Test: `client/test/game/bladeMeshes.test.ts`, `client/test/game/renderer.test.ts`, `engineChoice.test.ts`

**Interfaces:**
- Consumes: the filter's per-bucket collected `buf`, `foliage`, `strength` and count (`bladeMeshes.ts` on the grass frame branch), `bladeTierBands()` (`bladeField.ts`), `offsetKeyedVertexBuffer` (Task 3), `ComputeShader`, `StorageBuffer`.
- Produces: `export const BLADE_GPU_CANDIDATE_FLOATS = 28`, `BLADE_GPU_INSTANCE_FLOATS = 24`, `BLADE_GPU_TIER_BUCKETS = 12`, `BLADE_GPU_SWAY_PAD = 0.25`; `export function createBladeGpu(scene: Scene, bands: readonly BladeEdges[]): BladeGpu` with `upload(buckets)`, `stats()`, `dispose()`.

- [ ] **Step 1: The layout decided** — on the reference adapter, is `indirect-first-instance` offered? If yes, the contiguous layout of design §12.2 (every bucket bound at offset zero; no workaround needed); if not, the spike's interleaved layout through `offsetKeyedVertexBuffer`. Record which in the note.

  Two rules for the layout, whichever it is (from Task 3's workaround, design §10):
  - **One attribute-to-buffer pattern per material.** Every mesh that shares a blade material binds its instance attributes to GPU buffers in the same pattern: the same attributes read from one buffer, in the same order. The pipeline cache keys neither the offset (the workaround adds it) nor which consecutive attributes share a GPU buffer (nothing adds it), and a mismatch goes one of two ways by draw order: a mesh that binds two buffers, drawn with a pipeline built for one, reads its second attribute from its first buffer, silently; the reverse fails validation. The test: in `bladeGpu.test.ts`, every bucket's vertex buffers for one material share the same (kind, buffer-slot) sequence.
  - **Offsets inside the stride.** The workaround keys by the raw `byteOffset`. For an attribute whose offset lies beyond the stride, Babylon binds the offset at `setVertexBuffer` and bakes 0 into the layout, so each distinct offset would still make its own, identical pipeline: correct, but a layout that binds many sub-ranges by offset would multiply pipelines. The interleaved layout keeps every offset inside the stride (1,152 bytes); a layout that binds per-chunk sub-ranges keys by the baked offset instead.

- [ ] **Step 2: Write the failing tests**

`bladeGpu.test.ts`: the record sizes and the per-tier stride (1,152 bytes, under 2,048) as literals, as the spike's test; the kernel's text contains the band test in the foliage plugin's eye distance (`distance(vec2<f32>(cand[c + 12u], cand[c + 14u]), params.eye.xz)`, `d <= band.x || d >= band.w`) and the sphere test against six planes; the kernel reads its bands from `bladeTierBands()`'s literals; three canaries, one per private member I uses, each asserting the name in the installed Babylon's source (`_renderEncoder`, `_endCurrentRenderPass`, and `_getDrawWrapper` with `drawContext.indirectDrawBuffer`). `bladeMeshes.test.ts`: with I on, the blade buckets' `cull` is not called and the collected buffers reach `upload` in bucket order. `renderer.test.ts`: I is made only when `engine.isWebGPU` and the tier draws blades, with no URL read. `engineChoice.test.ts`: the added limit as a literal.

- [ ] **Step 3: Run to verify they fail.**

- [ ] **Step 4: Implement** — the spike's `bladeGpu.ts` rewritten: candidates from the collected buffers on each rebuild; per frame, on the filter's hook (`scene.onBeforeActiveMeshesEvaluationObservable`, the camera's final pose), the cull pass with the camera's exact planes (`Frustum.GetPlanesToRef(scene.getTransformMatrix())`), then the counts copied into each bucket's indirect arguments; no S, no F, no tail pass; `forcedInstanceCount` at the bucket's total so the engine never rewrites the arguments from the CPU. Run: PASS. Commit (`feat: cull the blade field on the GPU under WebGPU`).

- [ ] **Step 5: Gate** — design §12.3 against B′ (WebGPU with the filter on the blades and the grass class, the same build with I switched off by an uncommitted patch): the frame at native and 4×, cover at both poses, the grass frame's turn and sweep, draw calls, JS frame time; and a WebGPU Inspector capture showing the scene target's render passes per frame on I and on B′ (design §12.4). Append `## 8. Build I`; commit the note alone. If I misses its bar, revert its feature commit (`git revert`) and record why; the filter stays the blades' path.

---

### Task 8: Close the verification note and the design

**Files:**
- Modify: the verification note, `docs/rendering/2026-09-26-webgpu-high-tier-design.md` (the "As built" paragraph only)

- [ ] **Step 1: The summary** — a closing section: what shipped, with its values (the required limits, the fallback's constants, the frame deltas at every pose, the parity table, startup, memory); whether build I shipped; the draft issue's state (filed or not); what is left (design §17).
- [ ] **Step 2: The design's opening** — rewrite the **As built** paragraph to say what shipped and link the note; leave the rest as written.
- [ ] **Step 3: Checks and commit**

Run: `npx vitest run --root tools` (the doc-name test) and `git status --porcelain` (no measurement patch left).

```bash
git add docs/rendering/<date>-webgpu-high-tier-verification.md docs/rendering/2026-09-26-webgpu-high-tier-design.md
git commit -F - <<'EOF_COMMIT'
docs: say what the WebGPU high tier shipped and measured

## What

The WebGPU high tier's gates closed: what shipped, the frame and
parity figures at every pose, startup and memory, the fallback
exercised, and whether the compute-culled blades beat the filter.

## How

- `docs/rendering/<date>-webgpu-high-tier-verification.md` — the
  summary.
- `docs/rendering/2026-09-26-webgpu-high-tier-design.md` — the as-built
  paragraph.

<trailers>
EOF_COMMIT
```
