import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { BoardDrawing } from "../../src/game/boardPaint.js";
import { boardText } from "../../src/game/boardFace.js";

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
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { createForest } from "../../src/sim/forest.js";
import { parseLevel, type Level } from "../../src/sim/level.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { createWorld } from "../../src/sim/world.js";
import { BLADE_MESH_PREFIX } from "../../src/game/bladeMeshes.js";
import { PROBE_SEED_TOKEN, probePose } from "../../src/game/frameProbe.js";
import { seedFromToken } from "../../src/game/seed.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };
import { createRenderer, type Renderer } from "../../src/game/renderer.js";
import { createBodyMesh } from "../../src/game/bodyMesh.js";
import { createSignMeshes } from "../../src/game/signMeshes.js";
import { createTrailheadMeshes } from "../../src/game/trailheadMeshes.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene as BabylonScene } from "@babylonjs/core/scene.js";
import {
  APPLY_SWAP_READY_MAX_MS,
  GOVERNOR_SWAP_READY_MAX_MS,
  buildFirstRenderer,
  buildOrUndo,
  swapRenderer,
  switchOutcome,
  whenSceneReady,
  type SwapBindings,
} from "../../src/game/rendererSwap.js";
import type { QualityTier } from "../../src/game/quality.js";
import { timeLimit } from "../helpers/timeLimit.js";

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

function stubBindings(
  log: string[],
  failing: ReadonlySet<QualityTier> = new Set(),
  restoreFailing: ReadonlySet<QualityTier> = new Set(),
  givenFailing: ReadonlySet<QualityTier> = new Set(),
): SwapBindings {
  let n = 0;
  return {
    freshCanvas: () => {
      n += 1;
      log.push(`fresh c${n}`);
      return stubCanvas(`c${n}`, log);
    },
    build: (canvas, tier, engine) => {
      log.push(`build ${idOf(canvas)} ${tier} ${engine === null ? "webgl2" : "given"}`);
      if (failing.has(tier) || (engine !== null && givenFailing.has(tier))) {
        // As `createRenderer` does: a build that throws releases the engine
        // it was given (`releaseEngine`), so nothing after it may again.
        engine?.dispose();
        throw new Error(`no ${tier}`);
      }
      return stubRenderer(`${tier}@${idOf(canvas)}`, log);
    },
    unwatch: () => log.push("unwatch"),
    watch: (r) => log.push(`watch ${idOf(r)}`),
    engineFailed: (error) => log.push(`engine failed: ${(error as Error).message}`),
    extras: { dispose: () => log.push("extras dispose"), build: (r) => log.push(`extras build ${idOf(r)}`) },
    rebind: (canvas) => log.push(`rebind ${idOf(canvas)}`),
    restore: (r) => {
      log.push(`restore ${idOf(r)}`);
      const tier = idOf(r).split("@")[0] as QualityTier;
      if (restoreFailing.has(tier)) throw new Error(`restore ${tier}`);
    },
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
      "unwatch",
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
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const engine = { dispose: () => log.push("dispose given engine") } as unknown as AbstractEngine;
      const got = swapRenderer(
        { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
        { tier: "high", engine, fallbackTier: "medium" },
        stubBindings(log, new Set<QualityTier>(["high"])),
      );
      expect(got.tier).toBe("medium");
      expect(got.fellBack).toBe(true);
      // The given engine's rung failing may be the engine's fault: its tier
      // is tried again on WebGL2 before the ladder goes down. It fails there
      // too, so the fault is the tier's, and nothing is held against the
      // engine.
      expect(log.slice(4)).toEqual([
        "fresh c1",
        "replace c0 with c1",
        "build c1 high given",
        "dispose given engine",
        "fresh c2",
        "replace c1 with c2",
        "build c2 high webgl2",
        "fresh c3",
        "replace c2 with c3",
        "build c3 medium webgl2",
        "restore medium@c3",
        "extras build medium@c3",
        "rebind c3",
        "run medium@c3",
      ]);
      // The running tier fails too: one more try at low, the tier least likely to fail.
      const log2: string[] = [];
      const low = swapRenderer(
        { renderer: stubRenderer("medium@c0", log2), canvas: stubCanvas("c0", log2) },
        { tier: "high", engine: null, fallbackTier: "medium" },
        stubBindings(log2, new Set<QualityTier>(["high", "medium"])),
      );
      expect(low.tier).toBe("low");
      expect(low.fellBack).toBe(true);
      expect(log2.slice(-5)).toEqual(["build c3 low webgl2", "restore low@c3", "extras build low@c3", "rebind c3", "run low@c3"]);
      const log3: string[] = [];
      expect(() =>
        swapRenderer(
          { renderer: stubRenderer("medium@c0", log3), canvas: stubCanvas("c0", log3) },
          { tier: "high", engine: null, fallbackTier: "medium" },
          stubBindings(log3, new Set<QualityTier>(["high", "medium", "low"])),
        ),
      ).toThrow("no low");
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("a swap onto a given engine", () => {
  const engine = (log: string[]) => ({ dispose: () => log.push("dispose given engine") }) as unknown as AbstractEngine;
  const detector = () => () => undefined;

  it("listens to the new engine once its rung stands, never to a rung that failed", () => {
    const log: string[] = [];
    const got = swapRenderer(
      { renderer: stubRenderer("low@c0", log), canvas: stubCanvas("c0", log) },
      { tier: "high", engine: engine(log), watch: detector, fallbackTier: "low" },
      stubBindings(log),
    );
    expect([got.tier, got.fellBack, got.engineFellBack]).toEqual(["high", false, false]);
    expect(log.slice(-3)).toEqual(["rebind c1", "run high@c1", "watch high@c1"]);
  });

  it("takes a given engine's failure as the engine's: remembered, and the same tier built on WebGL2, no tier fallback", () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const got = swapRenderer(
        { renderer: stubRenderer("low@c0", log), canvas: stubCanvas("c0", log) },
        { tier: "high", engine: engine(log), watch: detector, fallbackTier: "low" },
        stubBindings(log, new Set(), new Set(), new Set<QualityTier>(["high"])),
      );
      expect([got.tier, got.fellBack, got.engineFellBack]).toEqual(["high", false, true]);
      expect(log.filter((line) => line.startsWith("watch"))).toEqual([]);
      expect(log.filter((line) => line.startsWith("engine failed"))).toEqual(["engine failed: no high"]);
      // Held against the engine once the same tier has stood on WebGL2.
      expect(log.slice(4)).toEqual([
        "fresh c1",
        "replace c0 with c1",
        "build c1 high given",
        "dispose given engine",
        "fresh c2",
        "replace c1 with c2",
        "build c2 high webgl2",
        "restore high@c2",
        "extras build high@c2",
        "rebind c2",
        "run high@c2",
        "engine failed: no high",
      ]);
    } finally {
      quiet.mockRestore();
    }
  });

  it("starts the hike on a given engine the same way: its failure is the engine's, and the tier is built again on WebGL2", () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const b = stubBindings(log, new Set(), new Set(), new Set<QualityTier>(["high"]));
      const got = buildFirstRenderer(stubCanvas("c0", log), ["high", "medium", "low"], b, { engine: engine(log), watch: detector });
      expect([got.tier, got.fellBack, got.engineFellBack, idOf(got.canvas)]).toEqual(["high", false, true, "c1"]);
      expect(log).toEqual(["build c0 high given", "dispose given engine", "fresh c1", "replace c0 with c1", "build c1 high webgl2", "engine failed: no high"]);
      // A tier that fails on WebGL2 as well is the tier's fault: no record
      // against the engine, and the ladder goes down.
      const both: string[] = [];
      const lower = buildFirstRenderer(stubCanvas("c0", both), ["high", "medium"], stubBindings(both, new Set<QualityTier>(["high"])), { engine: engine(both), watch: detector });
      expect([lower.tier, lower.fellBack]).toEqual(["medium", true]);
      expect(both.filter((line) => line.startsWith("engine failed"))).toEqual([]);
      const watched: string[] = [];
      const standing = buildFirstRenderer(stubCanvas("c0", watched), ["high", "low"], stubBindings(watched), { engine: engine(watched), watch: detector });
      expect([standing.tier, standing.engineFellBack]).toEqual(["high", false]);
      expect(watched).toEqual(["build c0 high given", "watch high@c0"]);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("a swap that throws before its first rung", () => {
  it("disposes the engine made for it, once, when the old renderer's dispose or the fresh canvas throws", () => {
    for (const where of ["old dispose", "fresh canvas"] as const) {
      const log: string[] = [];
      const given = { dispose: () => log.push("dispose given engine") } as unknown as AbstractEngine;
      const old = stubRenderer("low@c0", log);
      const bindings = stubBindings(log);
      if (where === "old dispose") {
        (old as unknown as { dispose(): void }).dispose = () => {
          throw new Error("old dispose");
        };
      } else {
        bindings.freshCanvas = () => {
          throw new Error("fresh canvas");
        };
      }
      expect(() =>
        swapRenderer({ renderer: old, canvas: stubCanvas("c0", log) }, { tier: "high", engine: given, fallbackTier: "low" }, bindings),
      ).toThrow(where);
      expect(log.filter((line) => line === "dispose given engine")).toEqual(["dispose given engine"]);
      expect(log.some((line) => line.startsWith("build"))).toBe(false);
    }
  });
});

describe("a throw after the build", () => {
  it("disposes the renderer just built, with what was built into its scene, and falls back", () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const got = swapRenderer(
        { renderer: stubRenderer("medium@c0", log), canvas: stubCanvas("c0", log) },
        { tier: "high", engine: null, fallbackTier: "medium" },
        stubBindings(log, new Set(), new Set<QualityTier>(["high"])),
      );
      expect(got.tier).toBe("medium");
      expect(log.slice(4)).toEqual([
        "fresh c1",
        "replace c0 with c1",
        "build c1 high webgl2",
        "restore high@c1",
        "extras dispose",
        "dispose high@c1",
        "fresh c2",
        "replace c1 with c2",
        "build c2 medium webgl2",
        "restore medium@c2",
        "extras build medium@c2",
        "rebind c2",
        "run medium@c2",
      ]);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("switchOutcome", () => {
  it("keeps a choice the switch reached, and keeps the choice as it was after a fallback", () => {
    expect(switchOutcome("high", { tier: "high", fellBack: false })).toEqual({ save: "high", line: null });
    expect(switchOutcome("high", { tier: "medium", fellBack: true })).toEqual({ save: null, line: "Could not switch; still using Medium." });
    expect(switchOutcome("auto", { tier: "low", fellBack: true })).toEqual({ save: null, line: "Could not switch; still using Low." });
  });
});

describe("buildFirstRenderer", () => {
  it("builds the tier asked for on the page's canvas, and each fallback on a fresh one", () => {
    const log: string[] = [];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const b = stubBindings(log, new Set<QualityTier>(["high"]));
      const got = buildFirstRenderer(stubCanvas("c0", log), ["high", "medium", "low"], b);
      expect(got.tier).toBe("medium");
      expect(got.fellBack).toBe(true);
      expect(idOf(got.canvas)).toBe("c1");
      expect((got.canvas as unknown as { style: { touchAction?: string } }).style.touchAction).toBe("none");
      expect(log).toEqual(["build c0 high webgl2", "fresh c1", "replace c0 with c1", "build c1 medium webgl2"]);
      const straight: string[] = [];
      const first = buildFirstRenderer(stubCanvas("c0", straight), ["high", "low"], stubBindings(straight));
      expect([first.tier, first.fellBack, idOf(first.canvas)]).toEqual(["high", false, "c0"]);
      expect(straight).toEqual(["build c0 high webgl2"]);
      expect(() => buildFirstRenderer(stubCanvas("c0", []), ["high", "low"], stubBindings([], new Set<QualityTier>(["high", "low"])))).toThrow("no low");
    } finally {
      quiet.mockRestore();
    }
  });
});

describe("buildOrUndo", () => {
  it("undoes what a build made, newest first, when it throws, and nothing when it returns", () => {
    const undone: string[] = [];
    expect(() =>
      buildOrUndo((made) => {
        made(() => undone.push("engine"));
        made(() => {
          undone.push("listener");
          throw new Error("undo failed");
        });
        made(() => undone.push("audio"));
        throw new Error("build failed");
      }),
    ).toThrow("build failed");
    expect(undone).toEqual(["audio", "listener", "engine"]);
    const kept: string[] = [];
    expect(buildOrUndo((made) => {
      made(() => kept.push("x"));
      return 7;
    })).toBe(7);
    expect(kept).toEqual([]);
  });
});

// ---- nothing of the old scene survives, on NullEngine -----------------------

const LEVEL: Level = { id: "swap-leak", brushes: [], playerSpawns: [], enemySpawns: [] };
const SEED = 388817;
const BODY = { pos: { x: 10, y: 2, z: 10 }, yaw: 0 };
/** A junction post, and the one-plank sign at the trail's entrance. */
const POSTS = [
  { x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Trailhead"], ranks: [0] }] },
  { x: 4, z: 0, arms: [{ dx: 1, dz: 0, names: ["Trail 14"], ranks: [0] }] },
];
/** What the board's face carries: enough for a painter that draws nothing. */
const BOARD: BoardDrawing = {
  seed: 1,
  text: boardText("Trail 14", "Dana Whitcombe", "Last seen at Trail 14.", 1274),
  map: { nodes: [{ x: 0, z: 0 }], edges: [], road: [], features: [], places: [], summitName: "Summit" },
  urls: { paper: null, portrait: null },
};
/** The car on the road and the notice board by the trail. */
const TRAILHEAD = {
  car: { site: { x: 10, z: 20 }, trailhead: { x: 1, z: 32 } },
  board: { x: 6, z: 39, fx: 0, fz: -1, ax: 1, az: 0 },
};
const never = (): Promise<AssetContainer> => new Promise(() => undefined);

function nullCanvas(): HTMLCanvasElement {
  return { renderWidth: 1600, renderHeight: 900, style: {}, replaceWith: () => undefined } as unknown as HTMLCanvasElement;
}

function census(scene: Scene) {
  return {
    postProcesses: scene.postProcesses.length,
    renderTargets: scene.customRenderTargets.length,
    shadowGenerators: scene.lights.filter((light) => light.getShadowGenerator() !== null).length,
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    transformNodes: scene.transformNodes.length,
    lights: scene.lights.length,
    particleSystems: scene.particleSystems.length,
    beforeRender: scene.onBeforeRenderObservable.observers.length,
    afterRender: scene.onAfterRenderObservable.observers.length,
    // The grass cull's hook, which a swapped scene needs as a fresh one does.
    beforeActiveMeshes: scene.onBeforeActiveMeshesEvaluationObservable.observers.length,
  };
}

/** What app.ts builds into the scene outside the renderer: the body, the
 * signs, and the trailhead's car and notice board. */
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
        createTrailheadMeshes(r.scene, TRAILHEAD, () => 2, {
          materialFor: (name) => new StandardMaterial(`box_${name}`, r.scene),
          board: BOARD,
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
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
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
  }, timeLimit(180_000));
});

describe("the grass cull after a swap, on NullEngine", () => {
  it("cuts the blades and the grass to the view on a swapped renderer as on a fresh one", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const seed = seedFromToken(PROBE_SEED_TOKEN);
    const level = parseLevel(sandbox01);
    const forest = createForest(seed);
    const world = createWorld(level, seed, false);
    const pose = probePose();
    /** One frame at the canopy pose turned by `turn`: every thin-instanced
     * mesh and the instances it draws, which the cull hook cuts. */
    const drawn = (r: Renderer, turn: number): string[] => {
      r.setFreecam({ ...pose, yaw: pose.yaw + turn });
      r.sync(world.state, -1, 0);
      r.scene.render();
      return r.scene.meshes
        .filter((m): m is Mesh => m instanceof Mesh && m.hasThinInstances)
        .map((m) => `${m.name} ${m.isEnabled() ? m.thinInstanceCount : 0}`)
        .sort();
    };
    const blades = (lines: string[]): number =>
      lines.filter((l) => l.startsWith(BLADE_MESH_PREFIX)).reduce((n, l) => n + Number(l.split(" ").pop()), 0);

    const fresh = createRenderer(nullCanvas(), level, forest, { tier: "medium" });
    const want = drawn(fresh, 0);
    fresh.dispose();
    expect(blades(want)).toBeGreaterThan(0);

    const current = { renderer: createRenderer(nullCanvas(), level, forest, { tier: "high" }), canvas: nullCanvas() };
    const bindings: SwapBindings = {
      build: (canvas, tier) => createRenderer(canvas, level, forest, { tier }),
      freshCanvas: nullCanvas,
      extras: { dispose: () => undefined, build: () => undefined },
      rebind: () => undefined,
      restore: () => undefined,
      loop: () => undefined,
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
    };
    const swapped = swapRenderer(current, { tier: "medium", engine: null, fallbackTier: "high" }, bindings).renderer;
    try {
      expect(drawn(swapped, 0)).toEqual(want);
      // Turned about, the cut follows the swapped camera.
      expect(blades(drawn(swapped, Math.PI))).not.toBe(blades(want));
    } finally {
      swapped.dispose();
    }
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(180_000));
});

describe("a swap that fails at every tier, on NullEngine", () => {
  it("leaves no engine and no atmosphere registration behind", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const forest = createForest(SEED);
      const current = { renderer: createRenderer(nullCanvas(), LEVEL, forest, { tier: "medium" }), canvas: nullCanvas() };
      const bindings: SwapBindings = {
        build: (canvas, tier) => createRenderer(canvas, LEVEL, forest, { tier }),
        freshCanvas: nullCanvas,
        extras: { dispose: () => undefined, build: () => undefined },
        rebind: () => undefined,
        restore: () => {
          throw new Error("restore failed");
        },
        loop: () => undefined,
        unwatch: () => undefined,
        watch: () => undefined,
        engineFailed: () => undefined,
      };
      expect(() => swapRenderer(current, { tier: "high", engine: null, fallbackTier: "medium" }, bindings)).toThrow("restore failed");
      expect(EngineStore.Instances.length).toBe(0);
      const engine = new NullEngine();
      try {
        const late = new PBRMaterial("after", new BabylonScene(engine));
        expect(late.pluginManager?.getPlugin("Atmosphere") ?? null).toBe(null);
      } finally {
        engine.dispose();
      }
    } finally {
      quiet.mockRestore();
    }
  }, timeLimit(120_000));
});

describe("whenSceneReady", () => {
  /** A scene that is ready, with nothing waiting to load. */
  const readyScene = { isDisposed: false, isReady: () => true, getWaitingItemsCount: () => 0 } as unknown as Scene;

  /** Whether `p` has settled after `ms`. */
  async function settledAfter(p: Promise<unknown>, ms: number): Promise<boolean> {
    let done = false;
    void p.then(() => { done = true; });
    await new Promise((r) => setTimeout(r, ms));
    return done;
  }

  it("waits for the streamed layers' first fill as well as the scene", async () => {
    let fill!: () => void;
    const layers = new Promise<void>((resolve) => { fill = resolve; });
    const lifted = whenSceneReady(readyScene, 10_000, layers);
    expect(await settledAfter(lifted, 300)).toBe(false);
    fill();
    expect(await settledAfter(lifted, 250)).toBe(true);
  });

  it("takes a layer that failed as settled", async () => {
    const lifted = whenSceneReady(readyScene, 10_000, Promise.reject(new Error("no forest")));
    expect(await settledAfter(lifted, 250)).toBe(true);
  });

  it("lifts at its cap when the layers never settle", async () => {
    const lifted = whenSceneReady(readyScene, 300, new Promise(() => undefined));
    expect(await settledAfter(lifted, 100)).toBe(false);
    expect(await settledAfter(lifted, 350)).toBe(true);
  });
});

describe("whenSceneReady's cap", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A ready scene with nothing waiting, counting the polls that look at it
   * (each reads `isDisposed` first). */
  function countingScene(): { scene: Scene; asked: () => number } {
    let n = 0;
    const scene = {
      get isDisposed() {
        n += 1;
        return false;
      },
      isReady: () => true,
      getWaitingItemsCount: () => 0,
    } as unknown as Scene;
    return { scene, asked: () => n };
  }

  /** Whether `p` has settled yet. */
  function tracked(p: Promise<unknown>): { done: () => boolean } {
    let done = false;
    void p.then(() => { done = true; });
    return { done: () => done };
  }

  it("is 20 s for the Settings Apply and 10 s for the governor's drop", () => {
    expect(APPLY_SWAP_READY_MAX_MS).toBe(20_000);
    expect(GOVERNOR_SWAP_READY_MAX_MS).toBe(10_000);
  });

  it("outlasts, on the Apply's bound, a forest that settles 16 s in, and lifts at the first poll after it", async () => {
    // At 6× CPU the forest was whole up to 16.1 s after the renderer's build.
    const layers = new Promise<void>((resolve) => setTimeout(resolve, 16_000));
    const lifted = tracked(whenSceneReady(countingScene().scene, APPLY_SWAP_READY_MAX_MS, layers));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lifted.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(5_900);
    expect(lifted.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(lifted.done()).toBe(true);
  });

  it("still lifts at the Apply's 20 s when a layer never settles, once, and stops polling", async () => {
    const { scene, asked } = countingScene();
    const lifted = tracked(whenSceneReady(scene, APPLY_SWAP_READY_MAX_MS, new Promise(() => undefined)));
    await vi.advanceTimersByTimeAsync(19_900);
    expect(lifted.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(lifted.done()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const polls = asked();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(asked()).toBe(polls);
  });
});
