import { describe, it, expect, vi, afterEach } from "vitest";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    // `getSize` mirrors the real `BaseTexture` surface `bindForSubMesh` reads
    // (`terrainReliefOn`'s placeholder-vs-real signature) — present here so a
    // future test that exercises binding fails on the plugin code, not on a
    // mock that is missing a method the real texture always has.
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));

// `createRenderer` builds a real WebGL `Engine`, which needs a canvas and a
// context this suite does not have. Substituted with `NullEngine` at the
// module boundary — same trick as the `groundMaps` mock above — so the test
// below can build a whole `Renderer` on each tier anyway.
const made = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  // Records the options each WebGL2 engine is made with.
  class Engine extends mod.NullEngine {
    constructor(_canvas: unknown, _antialias: unknown, options: unknown) {
      super();
      made.options.push(options);
    }
  }
  return { Engine };
});

// The terrain field lives behind the variant registry; a test that builds a
// forest without `app.ts` has to register the passes itself.
import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { buildProbeScene, measureOnRuleEngine, runProbeStep, type StepEngine } from "../../src/game/probeScene.js";
import type { ProbeReading } from "../../src/game/quality.js";
import { readFileSync } from "node:fs";
import { OVER_PLAY_Z, PROBE_SCREEN_LINE, showProbeScreen, timeIdleCadence } from "../../src/game/probeScreen.js";
import { timeLimit } from "../helpers/timeLimit.js";

const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;
/** A step's bound far ahead of the page's clock (`performance.now()`). */
const FAR = 1_000_000_000_000;

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
    expect(probe.renderer.scene.meshes.some((mesh) => mesh.name.startsWith("blade_clumps"))).toBe(true);
    probe.dispose();
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(60_000));
});

describe("a probe step's engine", () => {
  it("loses its context on dispose, as the game's does: WebGL2's by its option, WebGPU's by its device", () => {
    made.options.length = 0;
    const probe = buildProbeScene(FAKE_CANVAS, "low");
    probe.dispose();
    expect(made.options).toEqual([{ stencil: true, loseContextOnDispose: true }]);
    // WebGPU has no option for it: its dispose destroys the device (a canary
    // on the installed engine).
    const webgpu = readFileSync(new URL("../../../node_modules/@babylonjs/core/Engines/webgpuEngine.pure.js", import.meta.url), "utf8");
    expect(webgpu).toContain("        this._depthTexture?.destroy();\n        this._textureHelper.destroyDeferredTextures();\n        this._bufferManager.destroyDeferredBuffers();\n        this._device.destroy();");
  }, timeLimit(60_000));

  it("draws on the engine it is given, and a failure the step's own watcher hears ends it with the engine's fault", async () => {
    const engine = new NullEngine();
    let heard: ((reason: "pipeline" | "lost") => void) | null = null;
    let watching = false;
    const on: StepEngine = {
      canvas: FAKE_CANVAS,
      engine,
      watch: (watched, onFailure) => {
        expect(watched).toBe(engine);
        heard = onFailure;
        watching = true;
        return () => {
          // Taken off before the engine is disposed, so a disposed engine
          // is never heard from.
          expect(engine.isDisposed).toBe(false);
          watching = false;
        };
      },
    };
    const appended: unknown[] = [];
    const container = { appendChild: (c: unknown) => void appended.push(c), clientWidth: 1600, clientHeight: 900 } as unknown as HTMLElement;
    (FAKE_CANVAS as unknown as { remove(): void }).remove = () => undefined;
    const step = runProbeStep(container, "medium", { cancelled: () => false, on });
    expect(appended).toEqual([FAKE_CANVAS]);
    expect(watching).toBe(true);
    heard!("lost");
    expect(await step).toBe("engine-failed");
    expect(watching).toBe(false);
    expect(engine.isDisposed).toBe(true);
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(60_000));
});

describe("a probe step on the engine the rule gives its tier", () => {
  const webgl2 = (): StepEngine => ({ canvas: {} as HTMLCanvasElement, engine: null, watch: null });
  const reading = (engine: "webgl2" | "webgpu"): ProbeReading => ({ tier: "high", frames: 120, meanMs: 16.7, p95Ms: 16.7, pixels: 2_073_600, engine });

  it("measures on the engine made for the tier when nothing fails", async () => {
    const on: StepEngine = { canvas: {} as HTMLCanvasElement, engine: new NullEngine(), watch: () => () => undefined };
    const measured: StepEngine[] = [];
    let failures = 0;
    const got = await measureOnRuleEngine("high", () => false, {
      engineFor: async () => on,
      failed: () => void failures++,
      measure: async (_tier, engine) => (measured.push(engine), reading("webgpu")),
      webgl2,
      settles: () => true,
    }, FAR);
    expect(got).toEqual(reading("webgpu"));
    expect(measured).toEqual([on]);
    expect(failures).toBe(0);
    on.engine!.dispose();
  });

  it("counts a WebGPU step that fails as the rule's start failure, and measures the step again on WebGL2", async () => {
    const on: StepEngine = { canvas: {} as HTMLCanvasElement, engine: new NullEngine(), watch: () => () => undefined };
    const measured: (AbstractEngineLike | null)[] = [];
    let failures = 0;
    const got = await measureOnRuleEngine("high", () => false, {
      engineFor: async () => on,
      failed: () => void failures++,
      measure: async (_tier, engine) => {
        measured.push(engine.engine);
        return engine.engine === null ? reading("webgl2") : "engine-failed";
      },
      webgl2,
      settles: () => true,
    }, FAR);
    expect(got).toEqual(reading("webgl2"));
    expect(measured).toEqual([on.engine, null]);
    expect(failures).toBe(1);
    on.engine!.dispose();
  });

  it("measures nothing, and lets the engine go, when the page moves on while it is made", async () => {
    const engine = new NullEngine();
    let measures = 0;
    const got = await measureOnRuleEngine("high", () => true, {
      engineFor: async () => ({ canvas: {} as HTMLCanvasElement, engine, watch: () => () => undefined }),
      failed: () => undefined,
      measure: async () => (measures++, null),
      webgl2,
      settles: () => true,
    }, FAR);
    expect(got).toBe(null);
    expect(measures).toBe(0);
    expect(engine.isDisposed).toBe(true);
  });
});

describe("a probe step that cannot settle on the engine it got", () => {
  const webgl2 = (): StepEngine => ({ canvas: {} as HTMLCanvasElement, engine: null, watch: null });

  it("is not measured where a failed WebGPU start left it WebGL2 and WebGL2 cannot settle: no reading, at once", async () => {
    const asked: string[] = [];
    let measures = 0;
    const got = await measureOnRuleEngine("high", () => false, {
      engineFor: async () => webgl2(),
      failed: () => undefined,
      measure: async () => (measures++, null),
      webgl2,
      settles: (engine) => (asked.push(engine), engine !== "webgl2"),
    }, FAR);
    expect(got).toBe(null);
    expect(measures).toBe(0);
    expect(asked).toEqual(["webgl2"]);
  });

  it("is not measured again on WebGL2 after its WebGPU engine failed, where WebGL2 cannot settle", async () => {
    const on: StepEngine = { canvas: {} as HTMLCanvasElement, engine: new NullEngine(), watch: () => () => undefined };
    const asked: string[] = [];
    const measured: (AbstractEngineLike | null)[] = [];
    let failures = 0;
    const got = await measureOnRuleEngine("high", () => false, {
      engineFor: async () => on,
      failed: () => void failures++,
      measure: async (_tier, engine) => (measured.push(engine.engine), "engine-failed"),
      webgl2,
      settles: (engine) => (asked.push(engine), engine === "webgpu"),
    }, FAR);
    expect(got).toBe(null);
    expect(measured).toEqual([on.engine]);
    expect(failures).toBe(1);
    expect(asked).toEqual(["webgpu", "webgl2"]);
    on.engine!.dispose();
  });

  it("gives both measurements the step's one bound: the WebGL2 one after a WebGPU failure takes what is left", async () => {
    const on: StepEngine = { canvas: {} as HTMLCanvasElement, engine: new NullEngine(), watch: () => () => undefined };
    const bounds: number[] = [];
    const got = await measureOnRuleEngine(
      "high",
      () => false,
      {
        engineFor: async () => on,
        failed: () => undefined,
        measure: async (_tier, engine, readyBy) => (bounds.push(readyBy), engine.engine === null ? null : "engine-failed"),
        webgl2,
        settles: () => true,
      },
      FAR,
    );
    expect(got).toBe(null);
    expect(bounds).toEqual([FAR, FAR]);
    on.engine!.dispose();
  });

  it("does not build the WebGL2 re-measure when the step's bound has already passed", async () => {
    const on: StepEngine = { canvas: {} as HTMLCanvasElement, engine: new NullEngine(), watch: () => () => undefined };
    let measures = 0;
    const got = await measureOnRuleEngine(
      "high",
      () => false,
      {
        engineFor: async () => on,
        failed: () => undefined,
        measure: async () => (measures++, "engine-failed"),
        webgl2,
        settles: () => true,
      },
      // A bound already behind the clock: the page's clock is past 0.
      0,
    );
    expect(got).toBe(null);
    expect(measures).toBe(1);
    on.engine!.dispose();
  });

  it("lets its WebGPU engine go unmeasured where a WebGPU step cannot settle", async () => {
    const engine = new NullEngine();
    let measures = 0;
    const got = await measureOnRuleEngine("medium", () => false, {
      engineFor: async () => ({ canvas: {} as HTMLCanvasElement, engine, watch: () => () => undefined }),
      failed: () => undefined,
      measure: async () => (measures++, null),
      webgl2,
      settles: () => false,
    }, FAR);
    expect(got).toBe(null);
    expect(measures).toBe(0);
    expect(engine.isDisposed).toBe(true);
  });
});

type AbstractEngineLike = StepEngine["engine"];

describe("the probe screen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says what the wait is for", () => {
    expect(PROBE_SCREEN_LINE).toBe("Setting up graphics…");
  });

  /** The screen's elements, built against a stand-in document. */
  function shown(layer?: number): { className: string; style: { zIndex: string } }[] {
    const made: { className: string; style: { zIndex: string } }[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const el = { className: "", textContent: "", style: { zIndex: "" }, setAttribute() {}, remove() {} };
        made.push(el);
        return el;
      },
    });
    const container = { append() {} } as unknown as HTMLElement;
    (layer === undefined ? showProbeScreen(container) : showProbeScreen(container, layer)).dispose();
    return made.filter((el) => el.className === "probe-screen");
  }

  it("sits over the probe's canvas, and over the play HUD when the governor raises it", () => {
    expect(shown().map((el) => el.style.zIndex)).toEqual(["1"]);
    expect(shown(OVER_PLAY_Z).map((el) => el.style.zIndex)).toEqual(["21"]);
  });

  it("stays above the touch layer, the interact prompt and the roster", () => {
    const zOf = (file: string): string[] =>
      [...readFileSync(new URL(`../../src/game/${file}`, import.meta.url), "utf8").matchAll(/z-index: (\d+);/g)].map((m) => m[1] as string);
    expect(zOf("touchControls.ts")).toEqual(["15"]);
    expect(zOf("interactPrompt.ts")).toEqual(["12"]);
    expect(zOf("roster.ts")).toEqual(["20"]);
    expect(OVER_PLAY_Z).toBe(21);
  });
});

describe("the page's idle cadence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A page whose frames come every `ms`, after one first frame `firstMs` late. */
  function frames(ms: number, firstMs: number): { count(): number } {
    let t = 1_000;
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
      n += 1;
      const step = n === 2 ? firstMs : ms;
      queueMicrotask(() => {
        t += step;
        cb(t);
      });
      return n;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    return { count: () => n };
  }

  it("is the median of 30 intervals, the first dropped", async () => {
    const page = frames(33.25, 100);
    expect(await timeIdleCadence(new AbortController().signal)).toBe(33.25);
    expect(page.count()).toBe(32);
  });

  it("is null when it is stopped before it is done, or was never started", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const stop = new AbortController();
    const timing = timeIdleCadence(stop.signal);
    stop.abort();
    expect(await timing).toBe(null);
    expect(await timeIdleCadence(stop.signal)).toBe(null);
  });
});
