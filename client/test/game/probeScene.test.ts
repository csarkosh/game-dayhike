import { describe, it, expect, vi, afterEach } from "vitest";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
vi.mock("../../src/game/groundMaps.js", () => ({
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
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// The terrain field lives behind the variant registry; a test that builds a
// forest without `app.ts` has to register the passes itself.
import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { buildProbeScene } from "../../src/game/probeScene.js";
import { readFileSync } from "node:fs";
import { OVER_PLAY_Z, PROBE_SCREEN_LINE, showProbeScreen, timeIdleCadence } from "../../src/game/probeScreen.js";
import { timeLimit } from "../helpers/timeLimit.js";

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
    expect(probe.renderer.scene.meshes.some((mesh) => mesh.name.startsWith("blade_clumps"))).toBe(true);
    probe.dispose();
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(60_000));
});

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
