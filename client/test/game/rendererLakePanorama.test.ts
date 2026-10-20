// The lake's reflection in a whole renderer, its second half: the calm's
// fades and the medium tier's panorama, captured again as the sky, the target
// and the forest come ready and moved to a second lake, and none of it in a
// world without a lake. The first half, the targets each tier makes and the
// high tier's mirror, is `rendererLakeMirror.test.ts`: vitest hands out
// files, not tests, and the whole describe, about 155 s on a CI runner, made
// `renderer.test.ts` one of the floors under the client suite.
import { describe, it, expect, afterEach, vi } from "vitest";

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
// module boundary — same trick as the `groundMaps` mock above — so the tests
// below can build whole renderers anyway.
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>(
    "@babylonjs/core/Engines/nullEngine.js",
  );
  return { Engine: mod.NullEngine };
});

// Every mirror and panorama the renderer makes for the lake, recorded on the
// way through to the real shells: each mirror update's inputs and its answer,
// each panorama's re-arms and steps, and each one's disposal.
type MirrorUpdate = { inView: boolean; share: number; armed: boolean };
const lakeReflections = vi.hoisted(() => ({
  mirrors: [] as { updates: MirrorUpdate[]; disposed: number; texture: unknown }[],
  panoramas: [] as { rearms: number; updates: number; disposed: number }[],
}));
vi.mock("../../src/game/lakeMirror.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/lakeMirror.js")>();
  return {
    ...mod,
    createLakeMirror: (...args: Parameters<typeof mod.createLakeMirror>) => {
      const mirror = mod.createLakeMirror(...args);
      const record = { updates: [] as MirrorUpdate[], disposed: 0, texture: mirror.texture as unknown };
      lakeReflections.mirrors.push(record);
      const update = mirror.update.bind(mirror);
      mirror.update = (camera, inView, share) => {
        const armed = update(camera, inView, share);
        record.updates.push({ inView, share, armed });
        return armed;
      };
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
      const record = { rearms: 0, updates: 0, disposed: 0 };
      lakeReflections.panoramas.push(record);
      const rearm = panorama.rearm.bind(panorama);
      panorama.rearm = () => {
        record.rearms += 1;
        rearm();
      };
      const update = panorama.update.bind(panorama);
      panorama.update = () => {
        record.updates += 1;
        return update();
      };
      const dispose = panorama.dispose.bind(panorama);
      panorama.dispose = () => {
        record.disposed += 1;
        dispose();
      };
      return panorama;
    },
  };
});

// Every forest shell the renderer makes, recorded on the way through to the
// real one, and its first fill held on `gate` for as long as a test sets one.
const forestShells = vi.hoisted(() => ({ made: [] as unknown[], gate: null as Promise<void> | null }));
vi.mock("../../src/game/forestMeshes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/forestMeshes.js")>();
  return {
    ...mod,
    createForestMeshes: (...args: Parameters<typeof mod.createForestMeshes>) => {
      const forest = mod.createForestMeshes(...args);
      forestShells.made.push(forest);
      if (forestShells.gate !== null) (forest as { ready: Promise<void> }).ready = forestShells.gate;
      return forest;
    },
  };
});

// The terrain field lives behind the variant registry, and `activeTerrainVariant`
// throws until something has registered one. `app.ts` gets that transitively
// through `forest.ts`; a renderer-only test has to ask for it.
import "../../src/sim/passes/index.js";
import { createRenderer, SILENT_WATER_LIFE } from "../../src/game/renderer.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import type { Level } from "../../src/sim/level.js";
import { createForest } from "../../src/sim/forest.js";
import { activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { stadiumLake } from "../helpers/lakeShapes.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { EMPTY_LEVEL, windTestPlayer, windTestState } from "./helpers/rendererWorld.js";
import { lakeOf } from "../sim/helpers/lakes.js";
import { rayToShore } from "../../src/sim/lakeShape.js";
import { WaterPlugin } from "../../src/game/waterPlugin.js";
import type { ForestMeshes } from "../../src/game/forestMeshes.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";

describe("the lake's reflection in a renderer", () => {
  const SEED = 388817;
  const LEVEL: Level = { id: "lake-mirror-test", brushes: [], playerSpawns: [], enemySpawns: [] };
  const FAKE_CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;
  /** 2 m out from the lake's east shore, eyes 1.6 m over the ground, looking `facing` and a little down. */
  function shore(facing: number) {
    const lake = lakeOf(SEED);
    const x = lake.x + rayToShore(lake.shape, lake.x, lake.z, 1, 0, 0, lake.bound) + 2;
    return { x, y: elevationAt(SEED, x, lake.z) + 1.6, z: lake.z, yaw: facing, pitch: 0.2 };
  }
  const WEST = 4.712;

  afterEach(() => {
    vi.restoreAllMocks();
    lakeReflections.mirrors.length = 0;
    lakeReflections.panoramas.length = 0;
  });

  it("fades the calm to a new preset over the weather's seconds, frame by frame", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    const calm = vi.spyOn(WaterPlugin.prototype, "setCalm");
    try {
      // Half a second a frame.
      vi.spyOn(renderer.engine, "getDeltaTime").mockReturnValue(500);
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      // The page's start is the default preset's: bright, glass at 06:15.
      renderer.sync(windTestState(), 1, 0, { dt: 0.5, sprinting: false });
      const shares = [calm.mock.lastCall![0]];
      renderer.setWeatherName("overcast");
      for (let i = 0; i < 7; i++) {
        renderer.sync(windTestState(), 1, 0, { dt: 0.5, sprinting: false });
        shares.push(calm.mock.lastCall![0]);
      }
      expect(shares).toEqual([1, 0.8833333333333333, 0.7666666666666667, 0.65, 0.5333333333333334, 0.41666666666666663, 0.3, 0.3]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("captures the panorama again whenever the sky's probe is, a sector a frame", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    try {
      const panorama = lakeReflections.panoramas[0]!;
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      for (let i = 0; i < 3; i++) renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect([panorama.rearms, panorama.updates]).toEqual([1, 3]);
      // The hour moves: the probe is captured again, and the panorama with it.
      renderer.setView(18.5, WEATHER_PRESETS.clear);
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect([panorama.rearms, panorama.updates]).toEqual([2, 4]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("captures the panorama once more when its target is first ready to render, and only then", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    try {
      const panorama = lakeReflections.panoramas[0]!;
      const target = renderer.scene.getTextureByName("lake_panorama")!;
      // NullEngine compiles no effect, so the stand-in never reads as ready on its own.
      const ready = vi.spyOn(target as unknown as { isReadyForRendering(): boolean }, "isReadyForRendering").mockReturnValue(false);
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(panorama.rearms).toBe(1);
      ready.mockReturnValue(true);
      for (let i = 0; i < 3; i++) renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(panorama.rearms).toBe(2);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("takes a fade over mid-way from the share it had reached, never from the preset it was fading to", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    const calm = vi.spyOn(WaterPlugin.prototype, "setCalm");
    try {
      // Half a second a frame, at 06:00: clear's 1, overcast's 0.3, rain's 0.
      vi.spyOn(renderer.engine, "getDeltaTime").mockReturnValue(500);
      renderer.setView(6, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      renderer.setWeatherName("clear", 0);
      const shares: number[] = [];
      const frame = (): void => {
        renderer.sync(windTestState(), 1, 0, { dt: 0.5, sprinting: false });
        shares.push(calm.mock.lastCall![0]);
      };
      frame();
      renderer.setWeatherName("overcast");
      for (let i = 0; i < 3; i++) frame();
      // Half-way to overcast, then rain: on down from 0.65, a sixth a frame.
      renderer.setWeatherName("rain");
      for (let i = 0; i < 2; i++) frame();
      expect(shares).toEqual([1, 0.8833333333333333, 0.7666666666666667, 0.65, 0.5416666666666667, 0.43333333333333335]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("captures the panorama again once the forest's first fill has settled, and when a billboard is added to it late", async () => {
    let release = (): void => undefined;
    forestShells.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    forestShells.made.length = 0;
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    forestShells.gate = null;
    try {
      const panorama = lakeReflections.panoramas[0]!;
      const target = renderer.scene.getTextureByName("lake_panorama")!;
      vi.spyOn(target as unknown as { isReadyForRendering(): boolean }, "isReadyForRendering").mockReturnValue(true);
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      const frame = (): void => renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      frame();
      frame();
      // The first sky and the first readiness, in one frame: one capture.
      expect(panorama.rearms).toBe(1);
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      frame();
      frame();
      expect(panorama.rearms).toBe(2);
      // A billboard lands after the fill.
      const forest = forestShells.made[0] as ForestMeshes;
      (forest.impostorMeshes as Mesh[]).push(MeshBuilder.CreatePlane("forest_impostor_late", { size: 1 }, renderer.scene));
      frame();
      frame();
      expect(panorama.rearms).toBe(3);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("walks the panorama's readiness only while a capture waits on it, not every frame of the hike", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    try {
      const panorama = lakeReflections.panoramas[0]!;
      const target = renderer.scene.getTextureByName("lake_panorama")!;
      const ready = vi.spyOn(target as unknown as { isReadyForRendering(): boolean }, "isReadyForRendering").mockReturnValue(true);
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      // The first frame asks once, and the turn's sixteen sectors each ask
      // before they draw; the frame after the turn asks nothing.
      for (let i = 0; i < 17; i++) renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect([panorama.rearms, ready.mock.calls.length]).toEqual([1, 17]);
      for (let i = 0; i < 5; i++) renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect([panorama.rearms, ready.mock.calls.length]).toEqual([1, 17]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("moves the panorama and the life heard to a second lake once the camera stands 20 m nearer it", () => {
    const lake = lakeOf(SEED);
    // A second lake 700 m east of the first, on the variant's list for this test.
    const second = stadiumLake({ cx: lake.x + 700, cz: lake.z, halfLen: 0.5, w: 20, level: lake.level, murk: 1 });
    const variant = activeTerrainVariant();
    const bodies = variant.waterBodies!;
    vi.spyOn(variant, "waterBodies").mockImplementation((seed: number) => [...bodies(seed), second]);
    const read = vi.spyOn(WaterPlugin.prototype, "setPanorama");
    const body = vi.spyOn(WaterPlugin.prototype, "setLakeBody");
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "medium", skyTable: skyFixture() });
    try {
      // Each lake's own cylinder; the panorama on the first.
      expect(body.mock.calls.map((c) => c[0])).toEqual([lake.x, lake.x + 700]);
      expect(read.mock.calls).toHaveLength(1);
      const first = read.mock.contexts[0];
      renderer.setView(18.5, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      const near = renderer.waterLifeSound();
      expect(near).not.toBe(SILENT_WATER_LIFE);
      expect(read.mock.calls).toHaveLength(1);
      // Over the second lake, 594.7 m past the first's bound: the first's
      // material lets the panorama go and the second's reads it, its eye moved there.
      renderer.setFreecam({ x: lake.x + 700, y: lake.level + 2, z: lake.z, yaw: 0, pitch: 0 });
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(read.mock.calls.slice(1).map((c) => c[0] === null)).toEqual([true, false]);
      expect(read.mock.contexts[1]).toBe(first);
      expect(read.mock.contexts[2]).not.toBe(first);
      expect(renderer.scene.getCameraByName("lake_panorama_cam")!.position.x).toBe(lake.x + 700);
      // The life heard is the second lake's own.
      expect(renderer.waterLifeSound()).not.toBe(near);
      expect(renderer.waterLifeSound()).not.toBe(SILENT_WATER_LIFE);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("makes nothing of it in a world without a lake, or without a forest, and hands the water nothing", () => {
    const setters = (["setCalm", "setSkyline", "setLakeBody", "setMirror", "setPanorama"] as const).map((name) =>
      vi.spyOn(WaterPlugin.prototype, name),
    );
    for (const tier of ["high", "medium", "low"] as const) {
      // 4242's world has no lake.
      const dry = createRenderer(FAKE_CANVAS, LEVEL, createForest(4242), { tier, skyTable: skyFixture() });
      try {
        dry.setView(6.25, WEATHER_PRESETS.clear);
        dry.setFreecam({ x: 0, y: 60, z: 0, yaw: 0, pitch: 0 });
        dry.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      } finally {
        dry.dispose();
      }
    }
    const bare = createRenderer(FAKE_CANVAS, EMPTY_LEVEL, null, { tier: "high", skyTable: skyFixture() });
    try {
      bare.sync(windTestState(windTestPlayer(1)), 1, 0, { dt: 1 / 60, sprinting: false });
    } finally {
      bare.dispose();
    }
    expect([lakeReflections.mirrors.length, lakeReflections.panoramas.length]).toEqual([0, 0]);
    expect(setters.map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
  }, timeLimit(180_000));
});
