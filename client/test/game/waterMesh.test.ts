import { describe, it, expect, afterEach, vi } from "vitest";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { elevationAt } from "../../src/sim/terrain.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
// Importing `sim/olympic.js` registers all four variants (via its `montane.js`
// import). Olympic is now the default, so the explicit pin below changes
// nothing at runtime — it is kept as self-documentation: the water rings read
// the ACTIVE variant, and this test states which one it means to exercise.
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { createWater } from "../../src/game/renderer.js";
import { WATER_RING_COUNT } from "../../src/game/water.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { WaterPlugin } from "../../src/game/waterPlugin.js";
import { bedOriginFor } from "../../src/game/bedHeight.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { WATER_GROUP } from "../../src/game/waterFrame.js";

// Whether the high tier's frame can be made is a question for the engine
// (WebGPU, a multisampled first pass), which NullEngine cannot answer yes to;
// the wiring past that answer is what these tests pin.
const frameSupport = vi.hoisted(() => ({ supported: false }));
vi.mock("../../src/game/waterFrame.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/waterFrame.js")>();
  return { ...actual, waterFrameSupported: () => frameSupport.supported };
});

setActiveTerrainVariant("olympic");

describe("createWater under NullEngine", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("builds one alpha-blended mesh per ring carrying bedDepth, no vertex colours, with the water plugin", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 0x5eed, 0);
    expect(water.meshes.length).toBe(WATER_RING_COUNT);
    for (const m of water.meshes) {
      expect(m.getTotalVertices()).toBeGreaterThan(0);
      expect(m.isVerticesDataPresent("bedDepth")).toBe(true);
      expect(m.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
      expect(m.useVertexColors).toBe(false);
      expect((m.metadata as { waterLevel: number }).waterLevel).toBe(0);
      const mat = m.material as PBRMaterial;
      expect(mat.name).toBe("mat_water_sea");
      expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
      expect(mat.pluginManager?.getPlugin("Water")).toBeInstanceOf(WaterPlugin);
      expect(m.receiveShadows).toBe(false);
    }
    water.update(-500, 300, 1); // must re-emit and re-bake without throwing
    water.dispose();
  }, timeLimit(30_000));

  it("adds one disc per pond on the lake material at the pond's level, and disposes it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [{ x: 100, z: 50, radius: 30, height: 42 }]);
    const pond = scene.getMeshByName("pond_0")!;
    expect(pond.position.y).toBeCloseTo(42.02, 5);
    // Babylon's default bounding sphere is fit around the AABB, not the mesh's
    // circumradius; the box extent is the honest read of "radius ~ 31".
    expect(pond.getBoundingInfo().boundingBox.extendSizeWorld.x).toBeCloseTo(31, 0);
    expect(pond.material).toBe(scene.getMaterialByName("mat_water_lake"));
    expect((pond.metadata as { waterLevel: number }).waterLevel).toBe(42);
    expect(pond.isVerticesDataPresent("bedDepth")).toBe(true);
    expect(pond.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
    water.dispose();
    expect(scene.getMeshByName("pond_0")).toBeNull();
    expect(scene.getMaterialByName("mat_water_lake")).toBeNull();
  }, timeLimit(30_000));

  it("the mechanism fired: the bed texture is uploaded after the first update and the plugin points at it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 7, 0, [], "low");
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    expect(plugin.bedTexture).not.toBeNull();
    expect(plugin.bedTexels).toBe(128);
    expect(plugin.bedSpacing).toBe(2);
    expect(plugin.bedOrigin).toEqual([bedOriginFor(0, 128, 2), bedOriginFor(0, 128, 2)]);
    expect(plugin.octaves).toBe(1);
    water.setWind(1, [0, 1]);
    expect((water.meshes[0]!.material as PBRMaterial).roughness).toBeGreaterThan(0.5);
    water.dispose();
  }, timeLimit(30_000));

  it("uploads the bed at creation, before any frame, at the camera's start", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 7, 0, [], "low", 900, -400);
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    expect(plugin.bedTexture).not.toBeNull();
    expect(plugin.bedOrigin).toEqual([bedOriginFor(900, 128, 2), bedOriginFor(-400, 128, 2)]);
    water.dispose();
  }, timeLimit(30_000));

  it("re-centres the bed a row a frame: nothing is uploaded mid-bake, one upload holds the new bake", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 7, 0, [], "low");
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const upload = vi.spyOn(plugin.bedTexture as RawTexture, "update");
    const origin0 = [...plugin.bedOrigin];
    water.update(60, 0, 0); // inside the inner half [-64, 64): no bake, no upload
    expect(upload).not.toHaveBeenCalled();
    let calls = 0;
    while (upload.mock.calls.length === 0) {
      water.update(500, 500, 0);
      calls++;
      if (upload.mock.calls.length === 0) expect(plugin.bedOrigin).toEqual(origin0);
      expect(calls).toBeLessThanOrEqual(128);
    }
    expect(calls).toBe(128); // 128 rows at one a frame
    expect(upload).toHaveBeenCalledTimes(1);
    const o = bedOriginFor(500, 128, 2);
    expect(plugin.bedOrigin).toEqual([o, o]);
    const heights = upload.mock.calls[0]![0] as Float32Array;
    expect(heights[0]).toBeCloseTo(elevationAt(7, o + 1, o + 1), 4);
    water.dispose();
  }, timeLimit(30_000));

  it("on the high tier draws the water opaque in group 1, reading the frame, near and far from the camera each frame", () => {
    frameSupport.supported = true;
    engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("c", Vector3.Zero(), scene);
    camera.minZ = 0.05;
    camera.maxZ = 10000;
    const water = createWater(scene, 7, 0, [{ x: 100, z: 50, radius: 30, height: 42 }], "high");
    expect(water.high).toBe(true);
    const pond = scene.getMeshByName("pond_0")!;
    for (const m of [...water.meshes, pond]) {
      expect(m.renderingGroupId).toBe(WATER_GROUP);
      const mat = m.material as PBRMaterial;
      expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_OPAQUE);
      expect(mat.needDepthPrePass).toBe(false);
      const plugin = mat.pluginManager!.getPlugin("Water") as WaterPlugin;
      expect(plugin.sceneTexture).not.toBeNull();
      expect(plugin.depthTexture).not.toBeNull();
      expect(plugin.screen).toEqual([1 / engine.getRenderWidth(), 1 / engine.getRenderHeight()]);
      expect(plugin.depthLinear).toBe(0);
    }
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    water.update(0, 0, 1);
    expect(plugin.nearFar).toEqual([0.05, 10000]);
    camera.maxZ = 5000;
    water.update(0, 0, 2);
    expect(plugin.nearFar).toEqual([0.05, 5000]);
    const clear = (scene as unknown as { _renderingManager: { _autoClearDepthStencil: Record<number, { autoClear: boolean }> } })._renderingManager._autoClearDepthStencil;
    expect(clear[WATER_GROUP]?.autoClear).toBe(false);
    water.dispose();
    expect(clear[WATER_GROUP]?.autoClear).toBe(true);
    frameSupport.supported = false;
  }, timeLimit(30_000));

  it("on the high tier without the frame's support keeps the blended water in group 0", () => {
    frameSupport.supported = false;
    engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("c", Vector3.Zero(), scene);
    const water = createWater(scene, 7, 0, [], "high");
    expect(water.high).toBe(false);
    const mat = water.meshes[0]!.material as PBRMaterial;
    expect(water.meshes[0]!.renderingGroupId).toBe(0);
    expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
    const plugin = mat.pluginManager!.getPlugin("Water") as WaterPlugin;
    expect(plugin.sceneTexture).toBeNull();
    expect(plugin.depthTexture).toBeNull();
    water.dispose();
  }, timeLimit(30_000));
});
