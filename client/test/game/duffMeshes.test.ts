import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../src/sim/passes/index.js";
import { DUFF_ALBEDO, DUFF_CHARACTER_COUNT, DUFF_CHARACTERS, DUFF_TIER_COUNTS, duffClumpGeometry } from "../../src/game/duffClump.js";
import { DUFF_REACH, DUFF_REBUILD_CELL, createDuffCollector, duffTierBands } from "../../src/game/duffField.js";
import { createDuffMeshes, duffMeshName } from "../../src/game/duffMeshes.js";
import { instanceMatrixFor, trampleFrame } from "../../src/game/clutterMeshes.js";
import { FoliagePlugin } from "../../src/game/foliagePlugin.js";

// The forest-interior census point duffField.test.ts uses: deep under
// canopy, off the trail, where the ground-cover field's duff clears the
// floor across a wide neighbourhood, so every tier and character is present.
const SEED = 1;
const CAM = { x: 480, z: -600 };

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

describe("createDuffMeshes", () => {
  it("builds one mesh per character and tier on two tier materials, opaque, shadowed, plugged", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "high" });
    expect(duff.meshes.length).toBe(DUFF_CHARACTER_COUNT * 2);
    const materials = new Set<PBRMaterial>();
    const bands = duffTierBands(DUFF_REACH.high);
    for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
      for (let t = 0; t < 2; t++) {
        const mesh = scene.getMeshByName(duffMeshName(ch, t)) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        const g = duffClumpGeometry(DUFF_CHARACTERS[ch]!, DUFF_TIER_COUNTS.high[t]!);
        expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
        expect(mesh.getVerticesData("blade")).not.toBeNull();
        expect(mesh.receiveShadows).toBe(true);
        expect(mesh.isPickable).toBe(false);
        expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
        const mat = mesh.material as PBRMaterial;
        materials.add(mat);
        expect(mat.needAlphaTesting()).toBe(false);
        expect(mat.needAlphaBlending()).toBe(false);
        expect(mat.backFaceCulling).toBe(false);
        expect([mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b]).toEqual([DUFF_ALBEDO.r, DUFF_ALBEDO.g, DUFF_ALBEDO.b]);
        const foliage = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
        expect(foliage).toBeInstanceOf(FoliagePlugin);
        expect(foliage.bladeEdges).toEqual(bands[t]);
        expect(mat.pluginManager!.getPlugin("FoliageLight")).not.toBeNull();
        expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
      }
    }
    // One material per tier, shared by its three character buckets.
    expect(materials.size).toBe(2);
    duff.dispose();
    for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
      for (let t = 0; t < 2; t++) expect(scene.getMeshByName(duffMeshName(ch, t))).toBeNull();
    }
    for (const mat of materials) expect(scene.getMaterialByName(mat.name)).toBeNull();
    engine.dispose();
  });

  it("fills each bucket with its tier's cells of its character, nearest first, with the cards' matrix and tint and the strength", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "high" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    duff.update(CAM.x, CAM.z);
    const tiers = createDuffCollector(SEED).collect(CAM.x, CAM.z, DUFF_REACH.high);
    const lists = [tiers.near, tiers.far];
    let checked = 0;
    for (let t = 0; t < 2; t++) {
      for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
        const cells = lists[t]!.filter((c) => c.character === ch);
        const mesh = scene.getMeshByName(duffMeshName(ch, t)) as Mesh;
        expect(mesh.thinInstanceCount).toBe(cells.length);
        if (cells.length === 0) continue;
        const matrices = bufferFor(spy, mesh, "matrix")!;
        const tints = bufferFor(spy, mesh, "foliage")!;
        const strengths = bufferFor(spy, mesh, "bladeStrength")!;
        expect(bufferFor(spy, mesh, "fadeBands")).toBeNull();
        const buf = new Float32Array(16);
        for (let i = 0; i < Math.min(cells.length, 20); i++) {
          const c = cells[i]!;
          expect(strengths[i]).toBe(Math.fround(c.strength));
          expect(c.strength).toBeLessThanOrEqual(1);
          // The litter class is not trampled, so the frame is the identity —
          // the matrix is exactly the cards' own, with no height scaling.
          const frame = trampleFrame(SEED, c);
          instanceMatrixFor(c, frame, buf);
          for (let k = 0; k < 16; k++) expect(matrices[i * 16 + k]).toBeCloseTo(buf[k]!, 5);
          expect(tints[i * 4 + 3]).toBeCloseTo(1 - 0.5 * c.canopy, 5);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    spy.mockRestore();
    duff.dispose();
    engine.dispose();
  });

  it("routes each cell to the bucket of its character and tier", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "high" });
    duff.update(CAM.x, CAM.z);
    const tiers = createDuffCollector(SEED).collect(CAM.x, CAM.z, DUFF_REACH.high);
    const lists = [tiers.near, tiers.far];
    for (let t = 0; t < 2; t++) {
      for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
        const want = lists[t]!.filter((c) => c.character === ch).length;
        const mesh = scene.getMeshByName(duffMeshName(ch, t)) as Mesh;
        expect(mesh.thinInstanceCount).toBe(want);
      }
    }
    duff.dispose();
    engine.dispose();
  });

  it("rebuilds on a 1 m crossing and not inside one", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "medium" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceBufferUpdated");
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    duff.update(CAM.x, CAM.z);
    const afterFirst = set.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    duff.update(CAM.x + 0.4, CAM.z + 0.4);
    expect(set.mock.calls.length + spy.mock.calls.length).toBe(afterFirst);
    duff.update(CAM.x + DUFF_REBUILD_CELL + 0.1, CAM.z);
    expect(set.mock.calls.length + spy.mock.calls.length).toBeGreaterThan(afterFirst);
    spy.mockRestore();
    set.mockRestore();
    duff.dispose();
    engine.dispose();
  });

  it("uses the medium counts on medium", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "medium" });
    const mesh = scene.getMeshByName(duffMeshName(0, 0)) as Mesh;
    const g = duffClumpGeometry(DUFF_CHARACTERS[0]!, DUFF_TIER_COUNTS.medium[0]!);
    expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
    duff.dispose();
    engine.dispose();
  });

  it("disposes every duff_clumps mesh and its materials, leaving none in the scene", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "high" });
    duff.update(CAM.x, CAM.z);
    expect(scene.meshes.some((m) => m.name.startsWith("duff_clumps"))).toBe(true);
    duff.dispose();
    expect(scene.meshes.some((m) => m.name.startsWith("duff_clumps"))).toBe(false);
    engine.dispose();
  });
});
