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
import { activeTerrainVariant, setActiveTerrainVariant, type LakeSource } from "../../src/sim/terrain.js";
import { WATER_ROWS, lakeSkin, lakeWaterRow, waterSkinOffset } from "../../src/game/waterShading.js";
import { seedFromToken } from "../../src/game/seed.js";
import { LAKE_SURFACE_SPACING, WATER_UV_SCROLL, createWater, effectsGroupFor, lakeSurfaceShape, setEffectsGroup } from "../../src/game/renderer.js";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { createRain } from "../../src/game/rain.js";
import { createMotes } from "../../src/game/motes.js";
import { createMistMeshes } from "../../src/game/mistMeshes.js";
import { OCEAN_BOUND, WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE, waterRingSpacing } from "../../src/game/water.js";
import { WEBGPU_REQUIRED_LIMITS } from "../../src/game/engineChoice.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { WaterPlugin } from "../../src/game/waterPlugin.js";
import { POND_DISC_MARGIN, bedOriginFor } from "../../src/game/bedHeight.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { WATER_GROUP } from "../../src/game/waterFrame.js";
import { oceanFieldFor, swellPhases } from "../../src/game/oceanWaves.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";

// Whether the high tier's frame can be made is a question for the engine
// (WebGPU, a multisampled first pass), which NullEngine cannot answer yes to;
// the wiring past that answer is what these tests pin.
const frameSupport = vi.hoisted(() => ({ supported: false }));
vi.mock("../../src/game/waterFrame.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/waterFrame.js")>();
  return { ...actual, waterFrameSupported: () => frameSupport.supported };
});

setActiveTerrainVariant("olympic");

/** A lake as the variant lists it. */
function lake(over: Partial<LakeSource> = {}): LakeSource {
  return { kind: "lake", level: 42, x: 100, z: 50, radius: 30, murk: 1, lobe: null, ...over };
}

describe("createWater under NullEngine", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("builds one alpha-blended mesh per ring carrying bedDepth, no vertex colours, with the water plugin", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 0x5eed, 0);
    expect(water.meshes.length).toBe(WATER_RING_COUNT);
    expect(WATER_RING_COUNT).toBe(7);
    water.meshes.forEach((m) => {
      expect(m.getTotalVertices()).toBeGreaterThan(0);
      expect(m.isVerticesDataPresent("bedDepth")).toBe(true);
      expect(m.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
      expect(m.useVertexColors).toBe(false);
      expect((m.metadata as { waterLevel: number }).waterLevel).toBe(0);
      // the stitch: a float and an (x, z) per vertex
      expect(m.getVertexBuffer("oceanMorph")!.getSize()).toBe(1);
      expect(m.getVertexBuffer("oceanCoarse")!.getSize()).toBe(2);
      expect(m.getVerticesData("oceanMorph")!.length).toBe(m.getTotalVertices());
      // one vertex buffer a kind: six, inside the eight the WebGPU device is made with
      expect(m.getVerticesDataKinds().sort()).toEqual(["bedDepth", "normal", "oceanCoarse", "oceanMorph", "position", "uv"]);
      expect(m.getVerticesDataKinds().length).toBeLessThanOrEqual(WEBGPU_REQUIRED_LIMITS.maxVertexBuffers as number);
      // the vertices are world positions: the vertex stage's position is the world's
      expect(m.computeWorldMatrix(true).isIdentity()).toBe(true);
      const mat = m.material as PBRMaterial;
      expect(mat.name).toBe("mat_water_sea");
      expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
      expect(mat.pluginManager?.getPlugin("Water")).toBeInstanceOf(WaterPlugin);
      expect(m.receiveShadows).toBe(false);
    });
    expect(WEBGPU_REQUIRED_LIMITS.maxVertexBuffers).toBe(8);
    water.update(-500, 300, 1); // must re-emit and re-bake without throwing
    water.dispose();
  }, timeLimit(30_000));

  it("scrolls the ripple by the clock it is handed, not by the wall clock, so a held frame holds its water", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    let ms = 1000;
    // The low tier's sea carries the bump; on high and medium its normal is its waves'.
    const water = createWater(scene, 0x5eed, 0, [], "low", 0, 0, () => ms);
    const bump = (water.meshes[0]?.material as PBRMaterial).bumpTexture as Texture;
    const u0 = bump.uOffset;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(bump.uOffset).toBe(u0);
    ms = 1500;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(bump.uOffset).toBeCloseTo(u0 + 0.5 * WATER_UV_SCROLL[0], 9);
    water.dispose();
  });

  it("keeps PBR's bump on the sea on the low tier alone, the sea's normal its waves' elsewhere, and on every lake", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    for (const tier of ["high", "medium", "low"] as const) {
      const water = createWater(scene, 0x5eed, 0, [lake()], tier);
      const sea = water.meshes[0]!.material as PBRMaterial;
      expect(sea.bumpTexture !== null, tier).toBe(tier === "low");
      expect((water.lakeMeshes[0]!.material as PBRMaterial).bumpTexture, tier).not.toBeNull();
      water.dispose();
    }
  }, timeLimit(60_000));

  it("adds one surface per lake on its own material, at its level, with its murk's water, and disposes both", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [lake({ murk: 1 })]);
    const pond = scene.getMeshByName("pond_0")!;
    expect(pond.position.y).toBeCloseTo(42.02, 5);
    expect(pond.getBoundingInfo().boundingBox.extendSizeWorld.x).toBeCloseTo(31, 0);
    const mat = scene.getMaterialByName("mat_water_lake_0") as PBRMaterial;
    expect(pond.material).toBe(mat);
    const row = lakeWaterRow(1);
    // murk 1 is the lowland lake's row
    for (let c = 0; c < 3; c++) expect(row.lInf[c]).toBeCloseTo(WATER_ROWS.lowlandLake.lInf[c]!, 9);
    for (let c = 0; c < 3; c++) expect(mat.albedoColor.asArray()[c]).toBeCloseTo(row.lInf[c]!, 6);
    expect((mat.pluginManager!.getPlugin("Water") as WaterPlugin).row).toEqual(row);
    expect((pond.metadata as { waterLevel: number }).waterLevel).toBe(42);
    expect(pond.isVerticesDataPresent("bedDepth")).toBe(true);
    expect(pond.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
    expect((mat.pluginManager!.getPlugin("Water") as WaterPlugin).skin).toEqual([lakeSkin(1), waterSkinOffset(1)]);
    expect(lakeSkin(1)).toBe(1);
    const sea = water.meshes[0]!.material as PBRMaterial;
    // the sea's skin stays off; its offset seeds the white water's pattern
    expect((sea.pluginManager!.getPlugin("Water") as WaterPlugin).skin).toEqual([0, waterSkinOffset(1)]);
    water.dispose();
    expect(scene.getMeshByName("pond_0")).toBeNull();
    expect(scene.getMaterialByName("mat_water_lake_0")).toBeNull();
  }, timeLimit(30_000));

  it("makes no lake material and no lake surface in a world with no lake", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, []);
    expect(scene.getMeshByName("pond_0")).toBeNull();
    expect(scene.materials.some((m) => m.name.startsWith("mat_water_lake"))).toBe(false);
    water.dispose();
  });

  it("gives a lake surface's vertices the depth of the sim's own ground under them", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const seed = 1;
    const water = createWater(scene, seed, 0, [lake({ level: 10_000 })]);
    const pond = scene.getMeshByName("pond_0")!;
    const positions = pond.getVerticesData(VertexBuffer.PositionKind)!;
    const depths = pond.getVerticesData("bedDepth")!;
    expect(depths.length).toBe(positions.length / 3);
    for (const i of [0, Math.floor(depths.length / 2), depths.length - 1]) {
      const wx = 100 + positions[i * 3]!, wz = 50 + positions[i * 3 + 2]!;
      expect(depths[i]).toBeCloseTo(10_000 - elevationAt(seed, wx, wz), 1);
    }
    // the rings' texture coordinates, from the vertex's world position, so the
    // ripple bump samples a real tile
    expect(pond.isVerticesDataPresent(VertexBuffer.UVKind)).toBe(true);
    const uvs = pond.getVerticesData(VertexBuffer.UVKind)!;
    expect(uvs.length).toBe((positions.length / 3) * 2);
    for (const i of [0, Math.floor(depths.length / 2), depths.length - 1]) {
      expect(uvs[i * 2]).toBeCloseTo((100 + positions[i * 3]!) / WATER_UV_SCALE, 6);
      expect(uvs[i * 2 + 1]).toBeCloseTo((50 + positions[i * 3 + 2]!) / WATER_UV_SCALE, 6);
    }
    // a disc, not a square: no vertex past the rim plus the margin, where the
    // basin's apron may lie below the level outside the lake
    const ext = 30 + POND_DISC_MARGIN;
    let farthest = 0;
    for (let i = 0; i < positions.length / 3; i++) {
      farthest = Math.max(farthest, Math.hypot(positions[i * 3]!, positions[i * 3 + 2]!));
    }
    expect(farthest).toBeLessThanOrEqual(ext + 1e-6);
    expect(farthest).toBeGreaterThan(ext - 1e-3);
    const { rings, segments } = lakeSurfaceShape(ext);
    expect(rings).toBe(Math.ceil(ext / LAKE_SURFACE_SPACING));
    expect(segments).toBe(Math.ceil((2 * Math.PI * ext) / LAKE_SURFACE_SPACING));
    expect(positions.length / 3).toBe(rings * segments + 1);
    // wound as CreateGround winds its faces: the first triangle's cross
    // product points down in Babylon's left-handed frame
    const idx = pond.getIndices()!;
    const p = (v: number): number[] => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
    const [a, b, c] = [p(idx[0]!), p(idx[1]!), p(idx[2]!)];
    const crossY = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!);
    expect(crossY).toBeLessThan(0);
    water.dispose();
  }, timeLimit(30_000));

  it("gives no depth to a vertex over ground above the water", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [lake({ level: -1000 })]);
    const depths = scene.getMeshByName("pond_0")!.getVerticesData("bedDepth")!;
    expect(depths.length).toBeGreaterThan(0);
    for (const d of depths) expect(d).toBe(0);
    water.dispose();
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

  it("gives the sea's material the sea's waves and no lake's: OCEAN on the sea alone", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [lake({ murk: 1 }), lake({ x: -300, z: 200, murk: 0 })], "low");
    const pluginOf = (m: AbstractMesh): WaterPlugin => (m.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const oceanDefine = (p: WaterPlugin): unknown => {
      const d: Record<string, unknown> = {};
      p.prepareDefines(d as never, scene, undefined as never);
      return d.OCEAN;
    };
    const sea = pluginOf(water.meshes[0]!);
    for (const m of water.meshes) expect(pluginOf(m)).toBe(sea);
    expect(sea.ocean ?? null).not.toBeNull();
    expect(oceanDefine(sea)).toBe(true);
    // the low tier draws the swell's eight largest components; the coastline row about z = 0
    expect(sea.ocean!.coast).toEqual([-6240, 12, 8, 0]);
    expect(sea.ocean!.atlas.getSize()).toEqual({ width: 1040, height: 28 });
    expect(water.lakeMeshes).toHaveLength(2);
    for (const pond of water.lakeMeshes) {
      expect(pluginOf(pond)).not.toBe(sea);
      expect(pluginOf(pond).ocean).toBeNull();
      expect(oceanDefine(pluginOf(pond))).toBe(false);
    }
    const atlas = sea.ocean!.atlas;
    water.dispose();
    expect(atlas.getInternalTexture()).toBeNull();
  }, timeLimit(30_000));

  it("hands the sea's waves the clock's seconds, the wind setWind last had and the hour, noon when none is given", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [], "medium");
    const sea = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const field = oceanFieldFor(1, 12);
    water.setWind(0.9, [0, 1]);
    water.update(0, 0, 42.5, 15);
    expect(Array.from(sea.ocean!.phases)).toEqual(Array.from(swellPhases(field, 42.5)));
    const afternoon = windSeaStateFor(0.9, [0, 1], 15);
    expect(sea.ocean!.windDir).toEqual([afternoon.dir[0], afternoon.dir[1], afternoon.u10, afternoon.onshoreWeight]);
    water.update(0, 0, 43);
    const noon = windSeaStateFor(0.9, [0, 1], 12);
    expect(sea.ocean!.windDir).toEqual([noon.dir[0], noon.dir[1], noon.u10, noon.onshoreWeight]);
    // the hour reached it: the afternoon's sea breeze is the stronger wind
    expect(afternoon.u10).toBeGreaterThan(noon.u10);
    water.dispose();
  }, timeLimit(30_000));

  it("hands the rain to every plugin, the sea's and each lake's", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [lake({ murk: 1 }), lake({ x: -300, z: 200, murk: 0 })]);
    const plugins = [...water.meshes, ...water.lakeMeshes].map(
      (m) => (m.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin,
    );
    expect(new Set(plugins).size).toBe(3);
    for (const p of plugins) expect(p.rain).toBe(0);
    water.setRain(0.3);
    for (const p of plugins) expect(p.rain).toBe(0.3);
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
    // a pond by (500, 500), so the square there is one a body reaches
    const water = createWater(scene, 7, 0, [lake({ x: 520, z: 480, radius: 10, level: 0 })], "low");
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

  it("begins no bake where no body reaches the new square, and keeps the bed it has", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    // level 0 on seed 7: the square around (500, 500) is dry at all nine points
    const water = createWater(scene, 7, 0, [], "low");
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const upload = vi.spyOn(plugin.bedTexture as RawTexture, "update");
    const origin0 = [...plugin.bedOrigin];
    water.update(0, 0, 0); // the first update: the creation grid is already here
    for (let i = 0; i < 300; i++) water.update(500, 500, 0);
    expect(upload).not.toHaveBeenCalled();
    expect(plugin.bedOrigin).toEqual(origin0);
    water.dispose();
  }, timeLimit(30_000));

  it("drops a bake whose square the camera left mid-bake (a 500 m jump) and bakes the new square", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    // a level far above the ground: every square is under water
    const water = createWater(scene, 7, 10_000, [], "low");
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const upload = vi.spyOn(plugin.bedTexture as RawTexture, "update");
    water.update(0, 0, 0); // the first update: the creation grid is already here
    for (let i = 0; i < 50; i++) water.update(500, 0, 0); // 50 of 128 rows
    expect(upload).not.toHaveBeenCalled();
    let calls = 0;
    while (upload.mock.calls.length === 0) {
      water.update(1000, 0, 0);
      calls++;
      expect(calls).toBeLessThanOrEqual(128);
    }
    // a fresh bake from row 0, not the 78 rows left of the old one
    expect(calls).toBe(128);
    expect(upload).toHaveBeenCalledTimes(1);
    const ox = bedOriginFor(1000, 128, 2);
    const oz = bedOriginFor(0, 128, 2);
    expect(plugin.bedOrigin).toEqual([ox, oz]);
    const heights = upload.mock.calls[0]![0] as Float32Array;
    expect(heights[0]).toBeCloseTo(elevationAt(7, ox + 1, oz + 1), 4);
    expect(heights[127]).toBeCloseTo(elevationAt(7, ox + 255, oz + 1), 4);
    water.dispose();
  }, timeLimit(30_000));

  it("keeps a bake while the camera stays in its square, past the inner half (a 40 m move)", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 7, 10_000, [], "low");
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const upload = vi.spyOn(plugin.bedTexture as RawTexture, "update");
    water.update(0, 0, 0);
    // a bake for (500, 0): the square [320, 576) x [-128, 128), inner half [384, 512) x [-64, 64)
    const ox = bedOriginFor(500, 128, 2);
    const oz = bedOriginFor(0, 128, 2);
    expect([ox, oz]).toEqual([320, -128]);
    for (let i = 0; i < 50; i++) water.update(500, 0, 0); // 50 of 128 rows
    let calls = 0;
    while (upload.mock.calls.length === 0) {
      water.update(540, 0, 0); // out of the inner half, in the square
      calls++;
      expect(calls).toBeLessThanOrEqual(128);
    }
    // the 78 rows left, not a fresh 128, and for the square it was begun for
    expect(calls).toBe(78);
    expect(plugin.bedOrigin).toEqual([ox, oz]);
    const heights = upload.mock.calls[0]![0] as Float32Array;
    expect(heights[0]).toBeCloseTo(elevationAt(7, ox + 1, oz + 1), 4);
    water.dispose();
  }, timeLimit(30_000));

  it("drops a bake when the camera leaves its square (a 300 m move) and bakes the new one from row 0", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 7, 10_000, [], "low");
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const upload = vi.spyOn(plugin.bedTexture as RawTexture, "update");
    water.update(0, 0, 0);
    for (let i = 0; i < 50; i++) water.update(500, 0, 0);
    let calls = 0;
    while (upload.mock.calls.length === 0) {
      water.update(800, 0, 0); // past the square's east edge at 576
      calls++;
      expect(calls).toBeLessThanOrEqual(128);
    }
    expect(calls).toBe(128);
    expect(plugin.bedOrigin).toEqual([bedOriginFor(800, 128, 2), bedOriginFor(0, 128, 2)]);
    water.dispose();
  }, timeLimit(30_000));

  describe("rings without water are off, and a wet ring's bounds are its wet cells (seed atmo)", () => {
    // The olympic variant's sea is at level 0; on seed atmo the coast at z = 0
    // is near x = -372, and pond_0 sits on high ground at (249.6, 84), about
    // 620 m inland. Ring 3 is 1,024 m across, so it and the three inside it
    // hold no sea only with the camera more than 512 m from the coast.
    const seed = seedFromToken("atmo");
    const pondCam = { x: 249.6, z: 84 };

    it("inland: rings 0 to 3 are disabled, ring 4's box ends at the coast, the pond disc stays on", () => {
      engine = new NullEngine();
      const scene = new Scene(engine);
      const level = activeTerrainVariant().waterLevel!;
      expect(level).toBe(0);
      const lakes = activeTerrainVariant().waterBodies!(seed).filter((b): b is LakeSource => b.kind === "lake");
      expect(lakes[0]!.x).toBeCloseTo(pondCam.x, 0);
      const water = createWater(scene, seed, level, lakes, "medium", pondCam.x, pondCam.z);
      const check = (): void => {
        for (const ring of water.meshes.slice(0, 4)) expect(ring.isEnabled()).toBe(false);
        const ring4 = water.meshes[4]!;
        expect(ring4.isEnabled()).toBe(true);
        const box = ring4.getBoundingInfo().boundingBox;
        // the whole plane would reach 1,024 m east of the camera
        const planeMaxX = box.minimumWorld.x + OCEAN_BOUND + waterRingSpacing(4) + WATER_RING_CELLS * waterRingSpacing(4);
        expect(planeMaxX).toBeGreaterThan(pondCam.x);
        // the ring's east-most wet vertex is on the coast, and the box ends one
        // 16 m cell past it, and past that the waves' 12 m and the stitch's
        // move of a vertex, up to a cell, 16 m
        const pos = ring4.getVerticesData(VertexBuffer.PositionKind)!;
        const depth = ring4.getVerticesData("bedDepth")!;
        let wetMaxX = -Infinity;
        for (let i = 0; i < depth.length; i++) if ((depth[i] as number) > 0) wetMaxX = Math.max(wetMaxX, pos[i * 3] as number);
        expect(wetMaxX).toBeLessThan(-360);
        expect(box.maximumWorld.x).toBeGreaterThanOrEqual(wetMaxX + 12 + 16);
        expect(box.maximumWorld.x).toBeLessThanOrEqual(wetMaxX + 16 + 12 + 16);
        // the crest above the level and the trough below it
        expect(box.minimumWorld.y).toBe(level - 12);
        expect(box.maximumWorld.y).toBe(level + 12);
        expect(scene.getMeshByName("pond_0")!.isEnabled()).toBe(true);
      };
      check();
      // a re-emit (the rings moved) sets the same again, never the whole plane back
      water.update(pondCam.x + 40, pondCam.z + 40, 0);
      water.update(pondCam.x, pondCam.z, 0);
      check();
      water.dispose();
    }, timeLimit(30_000));

    it("culls every ring by its wet box: none is active looking inland from the pond, one is looking to the coast", () => {
      engine = new NullEngine();
      const scene = new Scene(engine);
      const lakes = activeTerrainVariant().waterBodies!(seed).filter((b): b is LakeSource => b.kind === "lake");
      // pond_0's west bank, at eye height over it
      const camera = new FreeCamera("c", new Vector3(209.6, 87.5, 84), scene);
      camera.maxZ = 10_000;
      const water = createWater(scene, seed, 0, lakes, "medium", 209.6, 84);
      water.update(209.6, 84, 0);
      const activeRings = (): string[] => {
        const active = scene.getActiveMeshes();
        const names: string[] = [];
        for (let i = 0; i < active.length; i++) {
          const name = (active.data[i] as { name: string }).name;
          if (name.startsWith("water_")) names.push(name);
        }
        return names;
      };
      // inland, east: the camera is inside ring 4's wet box's bounding sphere,
      // so only the box test can cull it
      camera.setTarget(new Vector3(1209.6, 87.5, 84));
      scene.render();
      expect(water.meshes[4]!.isEnabled()).toBe(true);
      const sphere = water.meshes[4]!.getBoundingInfo().boundingSphere;
      expect(Vector3.Distance(camera.position, sphere.centerWorld)).toBeLessThan(sphere.radiusWorld);
      expect(activeRings()).toEqual([]);
      // west, toward the coast
      camera.setTarget(new Vector3(-790.4, 87.5, 84));
      scene.render();
      expect(activeRings().length).toBeGreaterThan(0);
      water.dispose();
    }, timeLimit(30_000));

    it("at the coast: ring 0 is enabled", () => {
      engine = new NullEngine();
      const scene = new Scene(engine);
      const water = createWater(scene, seed, 0, [], "medium", -374, 0);
      expect(water.meshes[0]!.isEnabled()).toBe(true);
      const box = water.meshes[0]!.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.x).toBeLessThan(-374);
      // ring 0 is 128 m across: its box, grown by the waves' 12 m and the stitch's 1 m, starts at most 77 m west of the camera
      expect(box.minimumWorld.x).toBeGreaterThanOrEqual(-374 - 77);
      expect(box.minimumWorld.y).toBe(-12);
      expect(box.maximumWorld.y).toBe(12);
      water.dispose();
    }, timeLimit(30_000));
  });

  it("on the high tier draws the water opaque in group 1, reading the frame, near and far from the camera each frame", () => {
    frameSupport.supported = true;
    engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("c", Vector3.Zero(), scene);
    camera.minZ = 0.05;
    camera.maxZ = 10000;
    const water = createWater(scene, 7, 0, [lake()], "high");
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
    }
    const plugin = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    // before any copy: the frame's 1×1 far depth, and ready as soon as the bed is
    // (NullEngine never uploads, so the bed's readiness is set by hand)
    expect(plugin.depthTexture).toBeInstanceOf(RawTexture);
    expect(plugin.depthTexture!.getSize()).toEqual({ width: 1, height: 1 });
    plugin.bedTexture!.getInternalTexture()!.isReady = true;
    expect(plugin.isReadyForSubMesh()).toBe(true);
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

  it("on the high tier asks the frame for its copy only while a water mesh is among the frame's active meshes", () => {
    frameSupport.supported = true;
    engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("c", new Vector3(0, 5, 0), scene);
    // something else in group 1 (rain, motes, mist stand in), so the group renders without the water
    const box = MeshBuilder.CreateBox("b", { size: 1 }, scene);
    box.material = new StandardMaterial("m", scene);
    box.position.set(0, 5, 5);
    box.renderingGroupId = WATER_GROUP;
    const water = createWater(scene, 7, 0, [], "high");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // no water mesh active: no copy is asked for, so NullEngine's missing target is never a miss
      for (const m of water.meshes) m.setEnabled(false);
      for (let i = 0; i < 200; i++) scene.render();
      expect(scene.getActiveMeshes().contains(box)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      // water in view: every frame asks, and NullEngine can never copy, so it says so at 120
      for (const m of water.meshes) m.setEnabled(true);
      for (let i = 0; i < 120; i++) scene.render();
      expect(scene.getActiveMeshes().contains(water.meshes[0]!)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      water.dispose();
      frameSupport.supported = false;
    }
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

  it.each([
    [true, WATER_GROUP],
    [false, 0],
  ])("puts rain, motes and mist in the water's group when its high path is on (%s: group %i)", (supported, group) => {
    frameSupport.supported = supported;
    engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera("c", Vector3.Zero(), scene);
    const water = createWater(scene, 7, 0, [], "high");
    const rain = createRain(scene, "high");
    const motes = createMotes(scene, "high");
    const mist = createMistMeshes(scene, 7, "high");
    setEffectsGroup(effectsGroupFor(water), { rain, splash: null, motes, mist });
    expect(motes).not.toBeNull();
    expect(mist.meshes.length).toBeGreaterThan(0);
    expect(rain.mesh.renderingGroupId).toBe(group);
    expect(rain.drips?.renderingGroupId).toBe(group);
    for (const system of motes!.systems) expect(system.renderingGroupId).toBe(group);
    for (const mesh of mist.meshes) expect(mesh.renderingGroupId).toBe(group);
    expect(effectsGroupFor(null)).toBe(0);
    mist.dispose();
    motes!.dispose();
    rain.dispose();
    water.dispose();
    frameSupport.supported = false;
  }, timeLimit(30_000));
});
