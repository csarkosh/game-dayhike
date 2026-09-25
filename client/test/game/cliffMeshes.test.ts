import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import "../../src/sim/passes/index.js";
import {
  CLIFF_CELL, CLIFF_FADE_BAND, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_WIDTH, CLIFF_MODELS, CLIFF_RINGS,
  cliffBands, cliffOrigin, collectCliffs,
} from "../../src/game/cliffField.js";
import { CLIFF_LOD_NODES, cliffMeshName, createCliffMeshes } from "../../src/game/cliffMeshes.js";
import { instanceMatrixFor, trampleFrame, writeFoliage } from "../../src/game/clutterMeshes.js";
import { CliffTintPlugin } from "../../src/game/cliffTintPlugin.js";
import { DistanceFadePlugin } from "../../src/game/distanceFadePlugin.js";

/** The scarp fixture, not one of the census worlds' worst discs: those have
 * no steep rock within 60 m of their own centres, so their LOD0 band is
 * empty (cliffField.test.ts measures both). Here all three bands are
 * populated, which is what a bucket fill has to be judged on. */
const SEED = 627994160;
const CAM = { x: -340, z: -897 };

/** The real GLBs, read from disk the way catalogModels.test.ts does. */
function loader(scene: Scene) {
  registerBuiltInLoaders();
  return (output: string) => {
    const bytes = readFileSync(new URL(`../../assets/${output}`, import.meta.url));
    return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
  };
}

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

describe("createCliffMeshes", () => {
  it("builds three buckets per model from the GLBs' LOD roots, tinted, shadowed, the far one dithering", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    expect(cliffs.meshes.length).toBe(0);
    await cliffs.ready;
    expect(cliffs.meshes.length).toBe(CLIFF_MODELS.length * 3);
    for (const [model] of CLIFF_MODELS.entries()) {
      const mats = new Set<PBRMaterial>();
      for (let lod = 0; lod < 3; lod++) {
        const mesh = scene.getMeshByName(cliffMeshName(model, lod)) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        expect(mesh.getTotalVertices()).toBeGreaterThan(0);
        expect(mesh.isPickable).toBe(false);
        expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
        expect(mesh.receiveShadows).toBe(true);
        // The LOD root's transform is baked away: the thin-instance matrix
        // is the only transform a module wears.
        expect(mesh.parent).toBeNull();
        const mat = mesh.material as PBRMaterial;
        mats.add(mat);
        expect(mat.pluginManager!.getPlugin("CliffTint")).toBeInstanceOf(CliffTintPlugin);
        if (lod === 2) expect(mat.pluginManager!.getPlugin("DistanceFade")).toBeInstanceOf(DistanceFadePlugin);
        else expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
      }
      // LOD0 and LOD1 share the GLB's material; the far bucket has its own.
      expect(mats.size).toBe(2);
    }
    // LOD0 and LOD1 cast; the far bucket does not.
    expect(cliffs.casterMeshes.length).toBe(CLIFF_MODELS.length * 2);
    for (const m of cliffs.casterMeshes) expect(/_l[01]$/.test(m.name)).toBe(true);
    cliffs.dispose();
    for (const [model] of CLIFF_MODELS.entries()) {
      for (let lod = 0; lod < 3; lod++) expect(scene.getMeshByName(cliffMeshName(model, lod))).toBeNull();
    }
    engine.dispose();
  });

  it("pins the model tables against the loaded LOD0 meshes", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    for (const [model] of CLIFF_MODELS.entries()) {
      const mesh = scene.getMeshByName(cliffMeshName(model, 0)) as Mesh;
      const b = mesh.getBoundingInfo().boundingBox;
      expect(b.maximum.x - b.minimum.x).toBeCloseTo(CLIFF_MODEL_WIDTH[model] as number, 1);
      expect(b.maximum.y - b.minimum.y).toBeCloseTo(CLIFF_MODEL_HEIGHT[model] as number, 1);
    }
    cliffs.dispose();
    engine.dispose();
  });

  it("fills each bucket with its band, matrices seated through the clutter writer, with tint and fade bands", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    cliffs.update(CAM.x, CAM.z);
    const rings = CLIFF_RINGS.high;
    const o = cliffOrigin(CAM.x, CAM.z);
    const bands = cliffBands(collectCliffs(SEED, CAM.x, CAM.z, rings[2]), o.x, o.z, rings);
    expect(bands[0].length).toBeGreaterThan(0);
    expect(bands[2].length).toBeGreaterThan(0);
    const mat = new Float32Array(16);
    const fol = new Float32Array(4);
    for (const [model] of CLIFF_MODELS.entries()) {
      for (let lod = 0; lod < 3; lod++) {
        const mesh = scene.getMeshByName(cliffMeshName(model, lod)) as Mesh;
        const want = bands[lod]!.filter((m) => m.variant === model);
        expect(mesh.thinInstanceCount).toBe(want.length);
        expect(mesh.isEnabled()).toBe(want.length > 0);
        if (want.length === 0) continue;
        const matrices = bufferFor(spy, mesh, "matrix")!;
        const tints = bufferFor(spy, mesh, "foliage")!;
        expect(matrices.length).toBe(want.length * 16);
        expect(tints.length).toBe(want.length * 4);
        for (const [i, m] of want.entries()) {
          instanceMatrixFor(m, trampleFrame(SEED, m), mat);
          expect(Array.from(matrices.subarray(i * 16, i * 16 + 16))).toEqual(Array.from(mat));
          writeFoliage(SEED, m, fol, 0, trampleFrame(SEED, m));
          expect(Array.from(tints.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(fol));
        }
        const fade = bufferFor(spy, mesh, "fadeBands");
        if (lod === 2) {
          expect(fade!.length).toBe(want.length * 4);
          expect(Array.from(fade!.subarray(0, 4))).toEqual([-2, -1, rings[2] - CLIFF_FADE_BAND, rings[2]]);
        } else {
          expect(fade).toBeNull();
        }
      }
    }
    spy.mockRestore();
    cliffs.dispose();
    engine.dispose();
  });

  it("rebuilds only when the snapped origin moves, and remembers the eye until the models land", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const cliffs = createCliffMeshes(scene, SEED, { quality: "medium", loader: loader(scene) });
    cliffs.update(CAM.x, CAM.z);
    expect(spy).not.toHaveBeenCalled();
    await cliffs.ready;
    const afterLoad = spy.mock.calls.length;
    expect(afterLoad).toBeGreaterThan(0);
    cliffs.update(CAM.x + CLIFF_CELL / 4, CAM.z);
    expect(spy.mock.calls.length).toBe(afterLoad);
    cliffs.update(CAM.x + CLIFF_CELL, CAM.z);
    expect(spy.mock.calls.length).toBeGreaterThan(afterLoad);
    spy.mockRestore();
    cliffs.dispose();
    engine.dispose();
  });

  it("names the LOD roots the models ship", () => {
    expect(CLIFF_LOD_NODES).toEqual(["LOD0", "LOD1", "LOD2"]);
  });
});
