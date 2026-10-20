// The lake's reflection in a whole renderer, its first half: the targets each
// tier makes, what they draw and how the water lets them go, and the high
// tier's mirror armed and disarmed. The second half, the calm's fades and the
// medium tier's panorama, is `rendererLakePanorama.test.ts`: vitest hands out
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

// Every cliff shell the renderer makes, recorded on the way through to the
// real one: a test may hand a shell bucket meshes of its own.
const cliffShells = vi.hoisted(() => ({ made: [] as { meshes: readonly unknown[] }[] }));
vi.mock("../../src/game/cliffMeshes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/cliffMeshes.js")>();
  return {
    ...mod,
    createCliffMeshes: (...args: Parameters<typeof mod.createCliffMeshes>) => {
      const cliffs = mod.createCliffMeshes(...args);
      cliffShells.made.push(cliffs);
      return cliffs;
    },
  };
});

// The terrain field lives behind the variant registry, and `activeTerrainVariant`
// throws until something has registered one. `app.ts` gets that transitively
// through `forest.ts`; a renderer-only test has to ask for it.
import "../../src/sim/passes/index.js";
import { createRenderer } from "../../src/game/renderer.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import type { Level } from "../../src/sim/level.js";
import { createForest } from "../../src/sim/forest.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { windTestState } from "./helpers/rendererWorld.js";
import { lakeOf } from "../sim/helpers/lakes.js";
import { rayToShore } from "../../src/sim/lakeShape.js";
import { WaterPlugin } from "../../src/game/waterPlugin.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { cliffMeshName } from "../../src/game/cliffMeshes.js";

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
  const EAST = 1.571;
  /** Two frames with a render between, so the second reads the first's culling. */
  function look(renderer: ReturnType<typeof createRenderer>): void {
    renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
    renderer.scene.render();
    renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    lakeReflections.mirrors.length = 0;
    lakeReflections.panoramas.length = 0;
  });

  it("draws the clipmap's five inner rings, to the ridges past 512 m, through the ground's stand-in in the high mirror and the medium panorama", () => {
    const listed: Record<string, string[]> = {};
    for (const tier of ["high", "medium"] as const) {
      const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier, skyTable: skyFixture() });
      try {
        const target = renderer.scene.getTextureByName(tier === "high" ? "lake_mirror" : "lake_panorama") as RenderTargetTexture;
        const rings = (target.renderList ?? []).filter((m) => m.name.startsWith("clipmap_"));
        listed[tier] = rings.map((m) => `${m.name} ${m.getMaterialForRenderPass(target.renderPassId)?.name}`);
      } finally {
        renderer.dispose();
      }
    }
    const rings = [0, 1, 2, 3, 4].map((level) => `clipmap_${level} lake_mirror_terrain`);
    expect(listed).toEqual({ high: rings, medium: rings });
  }, timeLimit(120_000));

  it("draws the cliffs' LOD1 buckets in the high mirror on their own material, and the far buckets alone in the medium panorama", () => {
    const listed: Record<string, string[]> = {};
    for (const tier of ["high", "medium"] as const) {
      const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier, skyTable: skyFixture() });
      try {
        // A model's three buckets, as its GLB would land them.
        const buckets = [0, 1, 2].map((lod) => MeshBuilder.CreateBox(cliffMeshName(9, lod), { size: 1 }, renderer.scene));
        (cliffShells.made.at(-1)!.meshes as Mesh[]).push(...buckets);
        renderer.setView(6.25, WEATHER_PRESETS.clear);
        renderer.setFreecam(shore(WEST));
        renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
        const target = renderer.scene.getTextureByName(tier === "high" ? "lake_mirror" : "lake_panorama") as RenderTargetTexture;
        listed[tier] = (target.renderList ?? []).map((m) => m.name).filter((name) => name.startsWith("cliff_m9_"));
        // Each on its own material in the pass, never a stand-in.
        for (const bucket of buckets) expect(bucket.getMaterialForRenderPass(target.renderPassId), bucket.name).toBe(undefined);
      } finally {
        renderer.dispose();
      }
    }
    expect(listed).toEqual({ high: ["cliff_m9_l1", "cliff_m9_l2"], medium: ["cliff_m9_l2"] });
  }, timeLimit(120_000));

  it("makes the mirror on high, the panorama and the skyline on medium, the skyline alone on low, and disposes each with itself", () => {
    const made: string[] = [];
    for (const tier of ["high", "medium", "low"] as const) {
      lakeReflections.mirrors.length = 0;
      lakeReflections.panoramas.length = 0;
      const skyline = vi.spyOn(WaterPlugin.prototype, "setSkyline");
      const body = vi.spyOn(WaterPlugin.prototype, "setLakeBody");
      const mirror = vi.spyOn(WaterPlugin.prototype, "setMirror");
      const panorama = vi.spyOn(WaterPlugin.prototype, "setPanorama");
      const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier, skyTable: skyFixture() });
      let texture: BaseTexture | null = null;
      try {
        renderer.setView(6.25, WEATHER_PRESETS.clear);
        renderer.setFreecam(shore(WEST));
        renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
        // The lake's centre at its level, and its mean radius: the cylinder its shore is read on.
        expect(body.mock.calls).toEqual([[31.619719323244347, 153.0251604265237, -28.22147609112244, 33.85620944900402]]);
        texture = skyline.mock.lastCall?.[0] ?? null;
        made.push(
          `${tier}: ${lakeReflections.mirrors.length} mirror, ${lakeReflections.panoramas.length} panorama, ` +
          `skyline ${texture === null ? "none" : texture.getSize().width}, ` +
          `mirror read ${mirror.mock.calls.length > 0 ? "set" : "none"}, ` +
          `panorama read ${panorama.mock.calls.length}`,
        );
      } finally {
        renderer.dispose();
        // A spy on the class's method is the same spy for every renderer: one a tier.
        vi.restoreAllMocks();
      }
      expect(lakeReflections.mirrors.map((m) => m.disposed)).toEqual(tier === "high" ? [1] : []);
      expect(lakeReflections.panoramas.map((p) => p.disposed)).toEqual(tier === "medium" ? [1] : []);
      if (texture !== null) expect(texture.getInternalTexture()).toBe(null);
    }
    expect(made).toEqual([
      "high: 1 mirror, 0 panorama, skyline none, mirror read set, panorama read 0",
      "medium: 0 mirror, 1 panorama, skyline 512, mirror read none, panorama read 1",
      "low: 0 mirror, 0 panorama, skyline 512, mirror read none, panorama read 0",
    ]);
  }, timeLimit(180_000));

  it("lets the water go of each target before it is disposed", () => {
    for (const tier of ["high", "medium", "low"] as const) {
      // Each target's disposals at the last time the water was handed null for it.
      const released: Record<string, number> = {};
      let renderer: ReturnType<typeof createRenderer> | null = null;
      vi.spyOn(WaterPlugin.prototype, "setMirror").mockImplementation((texture) => {
        if (texture === null) released.mirror = lakeReflections.mirrors.at(-1)!.disposed;
      });
      vi.spyOn(WaterPlugin.prototype, "setPanorama").mockImplementation((texture) => {
        if (texture === null) released.panorama = lakeReflections.panoramas.at(-1)!.disposed;
      });
      vi.spyOn(WaterPlugin.prototype, "setSkyline").mockImplementation((texture) => {
        if (texture === null) released.skyline = renderer!.scene.getTextureByName("lake_skyline")!.getInternalTexture() === null ? 1 : 0;
      });
      renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier, skyTable: skyFixture() });
      renderer.setView(12, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(WEST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      renderer.dispose();
      vi.restoreAllMocks();
      // Each let go of while its target is still whole.
      expect(released, tier).toEqual({ high: { mirror: 0 }, medium: { panorama: 0, skyline: 0 }, low: { skyline: 0 } }[tier]);
      lakeReflections.mirrors.length = 0;
      lakeReflections.panoramas.length = 0;
    }
  }, timeLimit(180_000));

  it("arms the mirror at 06:15 under a clear sky with the lake in view, and not at noon, nor with the lake behind the camera", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "high", skyTable: skyFixture() });
    const calm = vi.spyOn(WaterPlugin.prototype, "setCalm");
    const read = vi.spyOn(WaterPlugin.prototype, "setMirror");
    try {
      const mirror = lakeReflections.mirrors[0]!;
      const updates = mirror.updates;
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setWeatherName("clear", 0);
      renderer.setFreecam(shore(WEST));
      look(renderer);
      expect(updates.at(-1)).toEqual({ inView: true, share: 1, armed: true });
      // The share, the weight and a full paw's smear at 900 px (the shader
      // scales it by the paw mask, none on glass); the target read.
      expect(calm.mock.lastCall).toEqual([1, 1, 89.75979010256552]);
      expect(read.mock.lastCall![0]).toBe(mirror.texture);
      renderer.setView(12, WEATHER_PRESETS.clear);
      look(renderer);
      expect(updates.at(-1)).toEqual({ inView: true, share: 0, armed: false });
      expect(calm.mock.lastCall).toEqual([0, 0, 89.75979010256552]);
      expect(read.mock.lastCall![0]).toBe(null);
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setFreecam(shore(EAST));
      look(renderer);
      expect(updates.at(-1)).toEqual({ inView: false, share: 1, armed: false });
      expect(calm.mock.lastCall).toEqual([1, 0, 89.75979010256552]);
      expect(read.mock.lastCall![0]).toBe(null);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("reads the lake in view from this frame's camera: turned toward it, one sync arms the mirror with no render between", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "high", skyTable: skyFixture() });
    try {
      const updates = lakeReflections.mirrors[0]!.updates;
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setWeatherName("clear", 0);
      renderer.setFreecam(shore(EAST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(updates.at(-1)).toEqual({ inView: false, share: 1, armed: false });
      renderer.setFreecam(shore(WEST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(updates.at(-1)).toEqual({ inView: true, share: 1, armed: true });
      renderer.setFreecam(shore(EAST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(updates.at(-1)).toEqual({ inView: false, share: 1, armed: false });
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("disarms the mirror in a frame with no local player and reads none of it", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "high", skyTable: skyFixture() });
    const calm = vi.spyOn(WaterPlugin.prototype, "setCalm");
    const read = vi.spyOn(WaterPlugin.prototype, "setMirror");
    try {
      const mirror = lakeReflections.mirrors[0]!;
      renderer.setView(6.25, WEATHER_PRESETS.clear);
      renderer.setWeatherName("clear", 0);
      renderer.setFreecam(shore(WEST));
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(mirror.updates.at(-1)).toEqual({ inView: true, share: 1, armed: true });
      expect(renderer.scene.customRenderTargets).toContain(mirror.texture);
      // The free camera off and no player of this id: no eye this frame.
      renderer.setFreecam(null);
      renderer.sync(windTestState(), 1, 0, { dt: 1 / 60, sprinting: false });
      expect(mirror.updates.at(-1)).toEqual({ inView: false, share: 1, armed: false });
      expect(renderer.scene.customRenderTargets).not.toContain(mirror.texture);
      expect(calm.mock.lastCall).toEqual([1, 0, 89.75979010256552]);
      expect(read.mock.lastCall![0]).toBe(null);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));

  it("leaves the mirror off in rain, with no weight and the paws over the whole lake", () => {
    const renderer = createRenderer(FAKE_CANVAS, LEVEL, createForest(SEED), { tier: "high", skyTable: skyFixture() });
    const calm = vi.spyOn(WaterPlugin.prototype, "setCalm");
    const cover = vi.spyOn(WaterPlugin.prototype, "setPawCover");
    try {
      renderer.setView(6.25, WEATHER_PRESETS.rain);
      renderer.setWeatherName("rain", 0);
      renderer.setFreecam(shore(WEST));
      look(renderer);
      expect(lakeReflections.mirrors[0]!.updates.at(-1)).toEqual({ inView: true, share: 0, armed: false });
      expect(calm.mock.lastCall).toEqual([0, 0, 89.75979010256552]);
      expect(cover.mock.lastCall).toEqual([1]);
    } finally {
      renderer.dispose();
    }
  }, timeLimit(120_000));
});
