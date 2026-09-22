import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../src/sim/passes/index.js";
import { BLADE_ALBEDO, BLADE_CHARACTERS, BLADE_TIER_COUNTS, bladeClumpGeometry } from "../../src/game/bladeClump.js";
import { BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, bladeTierBands, createBladeCollector } from "../../src/game/bladeField.js";
import {
  BLADE_CANOPY_HEIGHT, BLADE_STRENGTH_HEIGHT, bladeMeshName, createBladeMeshes,
} from "../../src/game/bladeMeshes.js";
import { instanceMatrixFor, trampleFrame } from "../../src/game/clutterMeshes.js";
import { FoliagePlugin } from "../../src/game/foliagePlugin.js";

// The open-field census point: every tier and every character is present.
const SEED = 1;
const CAM = { x: 35, z: 21335 };

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

describe("createBladeMeshes", () => {
  it("builds one mesh per character and tier on three tier materials, opaque, shadowed, plugged", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    expect(blades.meshes.length).toBe(BLADE_CHARACTER_COUNT * 3);
    const materials = new Set<PBRMaterial>();
    const bands = bladeTierBands();
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      for (let t = 0; t < 3; t++) {
        const mesh = scene.getMeshByName(bladeMeshName(ch, t)) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        const g = bladeClumpGeometry(BLADE_CHARACTERS[ch]!, BLADE_TIER_COUNTS.high[ch]![t]!);
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
        expect([mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b]).toEqual([BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b]);
        const foliage = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
        expect(foliage).toBeInstanceOf(FoliagePlugin);
        expect(foliage.bladeEdges).toEqual(bands[t]);
        expect(mat.pluginManager!.getPlugin("FoliageLight")).not.toBeNull();
        expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
      }
    }
    // One material per tier, shared by its four characters.
    expect(materials.size).toBe(3);
    blades.dispose();
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) for (let t = 0; t < 3; t++) expect(scene.getMeshByName(bladeMeshName(ch, t))).toBeNull();
    for (const mat of materials) expect(scene.getMaterialByName(mat.name)).toBeNull();
    engine.dispose();
  });

  it("fills each bucket with its tier's cells of its character, nearest first, with the cards' matrix and tint and the strength", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    let checked = 0;
    for (let t = 0; t < 3; t++) {
      for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
        const cells = lists[t]!.filter((c) => c.character === ch);
        const mesh = scene.getMeshByName(bladeMeshName(ch, t)) as Mesh;
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
          // The matrix is the cards' own, with the strength's and the canopy's height folded in.
          const frame = trampleFrame(SEED, c);
          const heightScale = (BLADE_STRENGTH_HEIGHT[0] + (BLADE_STRENGTH_HEIGHT[1] - BLADE_STRENGTH_HEIGHT[0]) * c.strength) * (1 + (BLADE_CANOPY_HEIGHT - 1) * c.canopy);
          instanceMatrixFor(c, { height: frame.height * heightScale, lean: frame.lean, ax: frame.ax, az: frame.az, tint: frame.tint }, buf);
          for (let k = 0; k < 16; k++) expect(matrices[i * 16 + k]).toBeCloseTo(buf[k]!, 5);
          expect(tints[i * 4 + 3]).toBeCloseTo(1 - 0.5 * c.canopy, 5);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    spy.mockRestore();
    blades.dispose();
    engine.dispose();
  });

  it("rebuilds on a 1 m crossing and not inside one", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "medium" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceBufferUpdated");
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    const afterFirst = set.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    blades.update(CAM.x + 0.4, CAM.z + 0.4);
    expect(set.mock.calls.length + spy.mock.calls.length).toBe(afterFirst);
    blades.update(CAM.x + BLADE_REBUILD_CELL, CAM.z);
    expect(set.mock.calls.length + spy.mock.calls.length).toBeGreaterThan(afterFirst);
    spy.mockRestore();
    set.mockRestore();
    blades.dispose();
    engine.dispose();
  });

  it("uses the medium counts on medium", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "medium" });
    const mesh = scene.getMeshByName(bladeMeshName(0, 0)) as Mesh;
    const g = bladeClumpGeometry(BLADE_CHARACTERS[0]!, BLADE_TIER_COUNTS.medium[0]![0]!);
    expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
    blades.dispose();
    engine.dispose();
  });

  it("collapses a blade to one world point through the cell's matrix", () => {
    const g = bladeClumpGeometry(BLADE_CHARACTERS[0]!, 16);
    const cell = { cls: 6, x: 3, z: -7, groundH: 12, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0.37 };
    const buf = new Float32Array(16);
    instanceMatrixFor(cell, { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } }, buf);
    const m = Matrix.FromArray(buf);
    const root = Vector3.TransformCoordinates(new Vector3(g.blade[0]!, 0, g.blade[1]!), m);
    for (let v = 0; v < 7; v++) {
      const world = Vector3.TransformCoordinates(new Vector3(g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!), m);
      const collapsed = root.add(world.subtract(root).scale(0));
      expect(collapsed.subtract(root).length()).toBeLessThan(1e-6);
    }
  });
});
