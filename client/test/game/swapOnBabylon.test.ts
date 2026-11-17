import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { BoardDrawing } from "../../src/game/boardPaint.js";
import { boardText } from "../../src/game/boardFace.js";

// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
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
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// Every mirror and panorama a renderer makes for the lake, and how many times
// each was disposed, recorded on the way through to the real shells.
const lakeParts = vi.hoisted(() => [] as { kind: "mirror" | "panorama"; disposed: number }[]);
vi.mock("../../src/game/lakeMirror.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/lakeMirror.js")>();
  return {
    ...mod,
    createLakeMirror: (...args: Parameters<typeof mod.createLakeMirror>) => {
      const mirror = mod.createLakeMirror(...args);
      const record = { kind: "mirror" as const, disposed: 0 };
      lakeParts.push(record);
      const dispose = mirror.dispose.bind(mirror);
      mirror.dispose = () => {
        record.disposed += 1;
        dispose();
      };
      return mirror;
    },
  };
});
vi.mock("../../src/game/lakePanorama.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/lakePanorama.js")>();
  return {
    ...mod,
    createLakePanorama: (...args: Parameters<typeof mod.createLakePanorama>) => {
      const panorama = mod.createLakePanorama(...args);
      const record = { kind: "panorama" as const, disposed: 0 };
      lakeParts.push(record);
      const dispose = panorama.dispose.bind(panorama);
      panorama.dispose = () => {
        record.disposed += 1;
        dispose();
      };
      return panorama;
    },
  };
});

// The terrain field lives behind the variant registry; a test that builds a
// forest without `app.ts` has to register the passes itself.
import "../../src/sim/passes/index.js";
import { EngineStore } from "@babylonjs/core/Engines/engineStore.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { createForest } from "../../src/sim/forest.js";
import { parseLevel, type Level } from "../../src/sim/level.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { createWorld } from "../../src/sim/world.js";
import { BLADE_MESH_PREFIX } from "../../src/game/bladeMeshes.js";
import { PROBE_SEED_TOKEN, probePose } from "../../src/game/frameProbe.js";
import { seedFromToken } from "../../src/game/seed.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };
import { createRenderer, type Renderer, type SceneRenderer } from "../../src/game/renderer.js";
import { createBodyMesh } from "../../src/game/bodyMesh.js";
import { createSignMeshes } from "../../src/game/signMeshes.js";
import { createTrailheadMeshes } from "../../src/game/trailheadMeshes.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene as BabylonScene } from "@babylonjs/core/scene.js";
import {
  APPLY_SWAP_READY_MAX_MS,
  GOVERNOR_SWAP_READY_MAX_MS,
  swapRenderer,
  whenStandingSkyHeld,
  type SwapBindings,
} from "../../src/game/rendererSwap.js";
import { READY_WALK_SLICE_MS, walkSceneReady, whenSceneReady } from "../../src/game/sceneReady.js";
import { createEffectTurns, spaceEffects } from "../../src/game/effectTurns.js";
import type { QualityTier } from "../../src/game/quality.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { createSkyTable, type SkyTable } from "../../src/game/skyTable.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { Outcome, Phase, type WorldState } from "../../src/sim/types.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { LOOP_GAIN_RAMP_S, type AmbientAudio } from "../../src/game/ambientAudio.js";
import { MIDGE_NAME } from "../../src/game/midgeSwarms.js";
import { waterLifeLayout } from "../../src/game/waterLifeField.js";
import { HUM_FADE_S, HUM_RANGE, createWaterLifeAudio } from "../../src/game/waterLifeAudio.js";
import { lakeOf } from "../sim/helpers/lakes.js";


/**
 * The swap on the renderer on Babylon.js, built under a `NullEngine`, and
 * that renderer's wait for its scene (`sceneReady.ts`). The swap's order and
 * its ladders are held on stand-in renderers in `rendererSwap.test.ts`; this
 * file goes, whole, with the renderer on Babylon.js.
 */

/** One turn of the event loop: a held sky's start has run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
    // The lake's mirror and panorama each bring a camera of their own.
    cameras: scene.cameras.length,
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
    build(r: SceneRenderer) {
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
    const bindings: SwapBindings<SceneRenderer> = {
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
    const drawn = (r: SceneRenderer, turn: number): string[] => {
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
    const bindings: SwapBindings<SceneRenderer> = {
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

describe("a swap and the lake's life, on NullEngine", () => {
  it("takes the old renderer's lake life down, and the hike's audio fades out its hums and stops them until the new one has stepped", () => {
    const forest = createForest(SEED);
    const marker = waterLifeLayout(SEED, lakeOf(SEED)).markers[0]!;
    const state: WorldState = {
      tick: 1, players: new Map(), enemies: new Map(), outcome: Outcome.Playing, phase: Phase.Climb, nextEntityId: 1, rngSeed: 1,
    };
    /** One frame by the first swarm at dusk, as the hike's loop draws it. */
    const atDusk = (r: Renderer): void => {
      r.setView(18.5, WEATHER_PRESETS.clear);
      r.setFreecam({ x: marker.x, y: marker.y, z: marker.z + 1, yaw: 0, pitch: 0 });
      r.sync(state, -1, 0, { dt: 1 / 60, sprinting: false });
    };
    // The hike's one water-life audio (`app.ts` builds it once and keeps it
    // across a swap) on a context's looping emitters, each recorded, and on a
    // clock of its own, in seconds.
    const emitters: { gain: number; max: number; stopped: boolean }[] = [];
    const ambient = {
      loopEmitter: (_build: unknown, _x: number, _y: number, _z: number, gain: number, _ref: number, max: number) => {
        const e = {
          gain, max, stopped: false,
          move() {},
          setGain(g: number) {
            e.gain = g;
          },
          stop() {
            e.stopped = true;
          },
        };
        emitters.push(e);
        return e;
      },
      onUnlock: (fn: () => void) => fn(),
    } as unknown as AmbientAudio;
    let clock = 0;
    const audio = createWaterLifeAudio(ambient, () => 0.5, () => clock);
    const hums = (): { gain: number; stopped: boolean }[] => emitters.filter((e) => e.max === HUM_RANGE);
    const humming = (): number => hums().filter((e) => !e.stopped && e.gain > 0).length;

    const current = { renderer: createRenderer(nullCanvas(), LEVEL, forest, { tier: "medium" }), canvas: nullCanvas() };
    const old = current.renderer;
    expect(old.hasWaterLife).toBe(true);
    atDusk(old);
    audio.update(old.waterLifeSound(), old.listener());
    expect(humming()).toBeGreaterThan(0);
    const midges = old.scene.meshes.filter((m) => m.material?.name === MIDGE_NAME);
    expect(midges).toHaveLength(1);
    const oldSound = old.waterLifeSound();
    const bindings: SwapBindings<SceneRenderer> = {
      build: (canvas, tier) => createRenderer(canvas, LEVEL, forest, { tier }),
      freshCanvas: nullCanvas,
      extras: { dispose: () => undefined, build: () => undefined },
      rebind: () => undefined,
      restore: () => undefined,
      loop: () => undefined,
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
    };
    const next = swapRenderer(current, { tier: "high", engine: null, fallbackTier: "medium" }, bindings).renderer;
    try {
      expect(old.scene.isDisposed).toBe(true);
      expect(midges[0]!.isDisposed()).toBe(true);
      // The old one fell silent as it went; the new renderer made its own.
      expect(oldSound.hums_n).toBe(0);
      expect(next.hasWaterLife).toBe(true);
      expect(next.waterLifeSound()).not.toBe(oldSound);
      expect(next.scene.meshes.filter((m) => m.material?.name === MIDGE_NAME)).toHaveLength(1);
      // The new renderer's life is silent until a frame has stepped it, so
      // the hums the old one left the audio fade out, are sent a gain of
      // nothing and stop once the emitters' gain has followed.
      clock += 1 / 60;
      audio.update(next.waterLifeSound(), next.listener());
      clock += HUM_FADE_S + 0.1;
      audio.update(next.waterLifeSound(), next.listener());
      expect(humming()).toBe(0);
      clock += LOOP_GAIN_RAMP_S;
      audio.update(next.waterLifeSound(), next.listener());
      expect(hums().every((e) => e.stopped)).toBe(true);
      atDusk(next);
      clock += 1 / 60;
      audio.update(next.waterLifeSound(), next.listener());
      expect(humming()).toBeGreaterThan(0);
    } finally {
      audio.dispose();
      next.dispose();
    }
    expect(humming()).toBe(0);
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(180_000));
});

describe("a swap and the lake's reflections, on NullEngine", () => {
  it("disposes the old renderer's mirror or panorama, and its skyline, swap after swap, and makes the new tier's", () => {
    const forest = createForest(SEED);
    lakeParts.length = 0;
    const made = (): string[] => lakeParts.map((p) => `${p.kind} ${p.disposed}`);
    let current = { renderer: createRenderer(nullCanvas(), LEVEL, forest, { tier: "high" }), canvas: nullCanvas() };
    const bindings: SwapBindings<SceneRenderer> = {
      build: (canvas, tier) => createRenderer(canvas, LEVEL, forest, { tier }),
      freshCanvas: nullCanvas,
      extras: { dispose: () => undefined, build: () => undefined },
      rebind: () => undefined,
      restore: () => undefined,
      loop: () => undefined,
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
    };
    expect(made()).toEqual(["mirror 0"]);
    const after: string[][] = [];
    const skylines: (number | null)[] = [];
    for (const tier of ["medium", "low", "high"] as const) {
      const old = current.renderer;
      const skyline = old.scene.getTextureByName("lake_skyline");
      current = swapRenderer(current, { tier, engine: null, fallbackTier: "medium" }, bindings);
      after.push(made());
      // The old skyline's texture has gone with it, where it had one.
      skylines.push(skyline === null ? null : skyline.getInternalTexture() === null ? 0 : 1);
      expect(old.scene.isDisposed).toBe(true);
    }
    expect(after).toEqual([
      ["mirror 1", "panorama 0"],
      ["mirror 1", "panorama 1"],
      ["mirror 1", "panorama 1", "mirror 0"],
    ]);
    expect(skylines).toEqual([null, 0, 0]);
    current.renderer.dispose();
    expect(made()).toEqual(["mirror 1", "panorama 1", "mirror 1"]);
    expect(EngineStore.Instances.length).toBe(0);
  }, timeLimit(180_000));
});

describe("a swap keeps the hike's sky", () => {
  it("hands the new renderer the table the old one read, which the old one lets go of and nothing disposes", async () => {
    const fixture = skyFixture();
    let listening = 0;
    // The fixture's table, counting who listens to it.
    const table: SkyTable = {
      add: (slice) => fixture.add(slice),
      get count() {
        return fixture.count;
      },
      has: (altitudeDeg) => fixture.has(altitudeDeg),
      blendAt: (altitudeDeg) => fixture.blendAt(altitudeDeg),
      whenReady: (altitudeDeg) => fixture.whenReady(altitudeDeg),
      onChange(listener) {
        listening += 1;
        const off = fixture.onChange(listener);
        return () => {
          listening -= 1;
          off();
        };
      },
    };
    const current = { renderer: createRenderer(nullCanvas(), LEVEL, null, { tier: "medium", skyTable: table }), canvas: nullCanvas() };
    expect(listening).toBe(1);
    const bindings: SwapBindings<SceneRenderer> = {
      build: (canvas, tier) => createRenderer(canvas, LEVEL, null, { tier, skyTable: table }),
      freshCanvas: nullCanvas,
      extras: { dispose: () => undefined, build: () => undefined },
      rebind: () => undefined,
      restore: () => undefined,
      loop: () => undefined,
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
    };
    const next = swapRenderer(current, { tier: "low", engine: null, fallbackTier: "medium" }, bindings);
    try {
      // The old lighting stopped listening; the new one listens to the same table.
      expect(listening).toBe(1);
      await expect(next.renderer.skyReady()).resolves.toBeUndefined();
      // The fixture's 17 slices, none made again.
      expect(table.count).toBe(17);
    } finally {
      next.renderer.dispose();
    }
    expect(listening).toBe(0);
  }, timeLimit(120_000));
});

describe("the hike's start across a swap, on NullEngine", () => {
  it("is not stranded by a swap made before the sky's slices arrive: it waits for the new renderer's sky, whose loop runs, and the old one's never", async () => {
    const table = createSkyTable();
    const loop = (): void => undefined;
    const first = createRenderer(nullCanvas(), LEVEL, null, { tier: "medium", skyTable: table });
    const firstRuns = vi.spyOn(first.engine, "runRenderLoop").mockImplementation(() => undefined);
    let nextRuns: ReturnType<typeof vi.spyOn> | null = null;
    // As the app holds them: the renderer standing, and who to tell at a swap.
    let standing: Renderer = first;
    const listeners = new Set<() => void>();
    const nextSwap = (): Promise<void> => new Promise((resolve) => void listeners.add(resolve));
    let ready = false;
    void whenStandingSkyHeld(() => standing, nextSwap).then(() => {
      if (standing === first) first.engine.runRenderLoop(loop);
      ready = true;
    });
    const bindings: SwapBindings<SceneRenderer> = {
      build: (canvas, tier) => {
        const made = createRenderer(canvas, LEVEL, null, { tier, skyTable: table });
        nextRuns = vi.spyOn(made.engine, "runRenderLoop").mockImplementation(() => undefined);
        return made;
      },
      freshCanvas: nullCanvas,
      extras: { dispose: () => undefined, build: () => undefined },
      rebind: () => undefined,
      restore: () => undefined,
      loop,
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
    };
    const got = swapRenderer({ renderer: first, canvas: nullCanvas() }, { tier: "low", engine: null, fallbackTier: "medium" }, bindings);
    standing = got.renderer;
    for (const tell of listeners) tell();
    listeners.clear();
    try {
      await flush();
      expect(ready).toBe(false);
      const fixture = skyFixture();
      table.add(fixture.blendAt(74));
      table.add(fixture.blendAt(76));
      await flush();
      expect(ready).toBe(true);
      expect(nextRuns).not.toBeNull();
      expect(nextRuns!).toHaveBeenCalledTimes(1);
      expect(nextRuns!).toHaveBeenCalledWith(loop);
      expect(firstRuns).not.toHaveBeenCalled();
    } finally {
      got.renderer.dispose();
    }
  }, timeLimit(120_000));

  it("ends with the first renderer's sky when no swap comes", async () => {
    const table = createSkyTable();
    const first = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: table });
    try {
      let ready = false;
      void whenStandingSkyHeld(() => first, () => new Promise<void>(() => undefined)).then(() => {
        ready = true;
      });
      await flush();
      expect(ready).toBe(false);
      const fixture = skyFixture();
      table.add(fixture.blendAt(74));
      table.add(fixture.blendAt(76));
      await flush();
      expect(ready).toBe(true);
    } finally {
      first.dispose();
    }
  }, timeLimit(60_000));
});

describe("a swap that fails at every tier, on NullEngine", () => {
  it("leaves no engine and no atmosphere registration behind", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const forest = createForest(SEED);
      const current = { renderer: createRenderer(nullCanvas(), LEVEL, forest, { tier: "medium" }), canvas: nullCanvas() };
      const bindings: SwapBindings<SceneRenderer> = {
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
  const readyScene = { isDisposed: false, meshes: [], isReady: () => true, getWaitingItemsCount: () => 0 } as unknown as Scene;

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

  it("waits for the effects still in the engine's queue, which the scene's own check cannot see", async () => {
    // A PBR material draws with the effect it had while its new one waits its turn, so the scene
    // says ready; the wait goes on until the queue is empty.
    const runs: (() => void)[] = [];
    const turns = createEffectTurns({ turn: (run) => void runs.push(run) });
    const engine = {
      createEffect(_name: string, options: { extraInitializationsAsync?: () => Promise<void> }): object {
        void options.extraInitializationsAsync?.();
        return { isDisposed: false };
      },
    };
    spaceEffects(engine, turns);
    engine.createEffect("pbr", { attributes: [] } as never);
    const scene = { ...readyScene, getEngine: () => engine } as unknown as Scene;
    const lifted = whenSceneReady(scene, 10_000);
    expect(await settledAfter(lifted, 300)).toBe(false);
    runs.shift()?.();
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

describe("the readiness walk", () => {
  const engines: NullEngine[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const e of engines.splice(0)) e.dispose();
  });

  /**
   * A scene of `count` boxes whose own check costs 40 ms of a clock the test holds the first time it is asked
   * (an effect made) and nothing after, with the turns the walk takes counted.
   */
  function costlyScene(count: number) {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new BabylonScene(engine);
    const clock = { ms: 0 };
    const turns = { taken: 0, before: () => undefined as void };
    /** Each mesh's checks: the turn it was asked in and what it was asked with. */
    const asked = new Map<string, { turn: number; complete: unknown }[]>();
    const add = (name: string): Mesh => {
      const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
      asked.set(name, []);
      vi.spyOn(mesh, "isReady").mockImplementation((complete?: boolean) => {
        const calls = asked.get(name)!;
        if (calls.length === 0) clock.ms += 40;
        calls.push({ turn: turns.taken, complete });
        return true;
      });
      return mesh;
    };
    const meshes = Array.from({ length: count }, (_, i) => add(`box${i}`));
    const deps = {
      now: () => clock.ms,
      turn: () => {
        turns.before();
        turns.taken++;
        return Promise.resolve();
      },
    };
    return { scene, meshes, asked, turns, deps, add };
  }

  it("asks every mesh as the scene's own check would, and makes no two effects in one task", async () => {
    const { scene, asked, turns, deps } = costlyScene(6);
    await walkSceneReady(scene, deps);
    expect(READY_WALK_SLICE_MS).toBe(8);
    // Each asked once, with the complete check, and each costly check in a turn of its own.
    expect([...asked.values()].map((calls) => calls.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect([...asked.values()].every((calls) => calls[0]!.complete === true)).toBe(true);
    expect([...asked.values()].map((calls) => calls[0]!.turn)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(turns.taken).toBe(6);
    // A scene whose meshes are ready already is walked in the one task.
    await walkSceneReady(scene, deps);
    expect(turns.taken).toBe(6);
    expect([...asked.values()].map((calls) => calls.length)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("checks under the camera's render pass and puts the engine's own back", async () => {
    const { scene, meshes, deps } = costlyScene(1);
    const engine = scene.getEngine();
    const camera = new FreeCamera("cam", Vector3.Zero(), scene);
    scene.activeCamera = camera;
    engine.currentRenderPassId = 77;
    let during = -1;
    vi.spyOn(meshes[0]!, "isReady").mockImplementation(() => {
      during = engine.currentRenderPassId;
      return true;
    });
    await walkSceneReady(scene, deps);
    expect(during).toBe(camera.renderPassId);
    expect(engine.currentRenderPassId).toBe(77);
    // A check that throws leaves the pass as it was too, and the walk goes on.
    vi.spyOn(meshes[0]!, "isReady").mockImplementation(() => {
      throw new Error("not this frame");
    });
    await expect(walkSceneReady(scene, deps)).resolves.toBeUndefined();
    expect(engine.currentRenderPassId).toBe(77);
  });

  it("leaves out a mesh disposed between two turns, and ends on a scene disposed between two", async () => {
    const a = costlyScene(4);
    a.turns.before = () => {
      if (a.turns.taken === 0) a.meshes[2]!.dispose();
    };
    await walkSceneReady(a.scene, a.deps);
    expect([...a.asked.values()].map((calls) => calls.length)).toEqual([1, 1, 0, 1]);
    const b = costlyScene(4);
    b.turns.before = () => {
      if (b.turns.taken === 1) b.scene.dispose();
    };
    await walkSceneReady(b.scene, b.deps);
    expect([...b.asked.values()].map((calls) => calls.length)).toEqual([1, 1, 0, 0]);
  });

  it("is walked before the scene is asked whether it is ready, every poll", async () => {
    const { scene, asked, deps, add } = costlyScene(3);
    /** How many meshes had been asked each time the scene itself was. */
    const askedAtScene: number[] = [];
    let ready = false;
    vi.spyOn(scene, "isReady").mockImplementation(() => {
      askedAtScene.push([...asked.values()].filter((calls) => calls.length > 0).length);
      return ready;
    });
    const lifted = whenSceneReady(scene, 10_000, Promise.resolve(), deps);
    // The first poll finds the layers not yet in and asks nothing; the second, 100 ms on, walks and asks.
    await vi.waitFor(() => expect(askedAtScene).toEqual([3]), { timeout: timeLimit(2_000), interval: 10 });
    // A model lands between two polls: the next poll walks it too, and only then asks the scene.
    add("late");
    ready = true;
    await lifted;
    expect(askedAtScene).toEqual([3, 4]);
    expect(asked.get("late")).toHaveLength(1);
  });

  it("lifts at its cap though the walk is between two turns, and asks no more of the scene", async () => {
    const { scene, asked } = costlyScene(3);
    const sceneAsked = vi.spyOn(scene, "isReady");
    let clock = 0;
    // A turn that never comes back: the page went on to something that never yields to the walk.
    const lifted = whenSceneReady(scene, 200, Promise.resolve(), { now: () => (clock += 40), turn: () => new Promise(() => undefined) });
    await lifted;
    expect([...asked.values()].map((calls) => calls.length)).toEqual([1, 0, 0]);
    expect(sceneAsked).not.toHaveBeenCalled();
  });
  it("walks no further once the wait has lifted at its cap, asks the scene nothing and arms no poll", async () => {
    const { scene, asked } = costlyScene(4);
    const sceneAsked = vi.spyOn(scene, "isReady");
    let clock = 0;
    // The turns the walk waits for, given when the test says: here, only after the cap.
    const waiting: (() => void)[] = [];
    const lifted = whenSceneReady(scene, 200, Promise.resolve(), {
      now: () => (clock += 40),
      turn: () => new Promise<void>((given) => waiting.push(given)),
    });
    await lifted;
    expect([...asked.values()].map((calls) => calls.length)).toEqual([1, 0, 0, 0]);
    // The page comes back to the walk after the cover has lifted: it makes no more effects under play.
    for (const given of waiting.splice(0)) given();
    await new Promise((r) => setTimeout(r, 250));
    expect([...asked.values()].map((calls) => calls.length)).toEqual([1, 0, 0, 0]);
    expect(waiting).toHaveLength(0);
    expect(sceneAsked).not.toHaveBeenCalled();
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
      meshes: [],
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
