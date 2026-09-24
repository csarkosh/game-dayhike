import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../src/sim/passes/index.js";
import { activeTerrainVariant } from "../../src/sim/terrain.js";
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

  it("fills each bucket with its tier's cells of its character, nearest first, with the cards' rotation, scale, XZ, tint and strength", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "high" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    duff.update(CAM.x, CAM.z);
    const tiers = createDuffCollector(SEED).collect(CAM.x, CAM.z, DUFF_REACH.high);
    const lists = [tiers.near, tiers.far];
    const variant = activeTerrainVariant();
    const buf = new Float32Array(16);
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
        for (let i = 0; i < Math.min(cells.length, 20); i++) {
          const c = cells[i]!;
          expect(strengths[i]).toBe(Math.fround(c.strength));
          expect(c.strength).toBeLessThanOrEqual(1);
          // Rotation, ground-normal seating and scale (indices 0-11 and the
          // homogeneous 15) still come straight from the cards' own
          // `instanceMatrixFor` — only the Y translation (13) was ever the
          // sink bug's own territory, so only it is checked against the sim's
          // ground height instead, below. Checking every OTHER element
          // against the helper here is what the matrix-equality version of
          // this test used to buy and what dropping to XZ-only quietly gave
          // up — litter is in `TILTED`, so a wrong ground normal or a wrong
          // scale would pass unnoticed without this.
          const frame = trampleFrame(SEED, c);
          instanceMatrixFor(c, frame, buf);
          for (let k = 0; k < 12; k++) expect(matrices[i * 16 + k]).toBeCloseTo(buf[k]!, 5);
          expect(matrices[i * 16 + 15]).toBeCloseTo(buf[15]!, 5);
          expect(matrices[i * 16 + 12]).toBeCloseTo(c.x, 4);
          expect(matrices[i * 16 + 14]).toBeCloseTo(c.z, 4);
          const groundH = variant.sample(SEED, c.x, c.z).h;
          expect(matrices[i * 16 + 13]).toBeCloseTo(groundH, 4);
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

  it("never sinks an instance below the sim's own ground height at its exact x/z", () => {
    // The regression this guards: `instanceMatrixFor` sinks every non-boulder
    // instance CLUTTER_SINK (2 cm) below ground, a margin `bladeMeshes.ts`'s
    // own blades and a rock's flattened underside absorb invisibly, but the
    // leaf-cluster character never rises above 6 mm (duffClump.ts) — sunk
    // by the full 2 cm, the whole clump used to render entirely underground.
    // Deliberately does NOT call `instanceMatrixFor` or re-derive the
    // expectation from any code in `duffMeshes.ts`: it samples the terrain
    // the same way `duffField.ts` did when it built the cell, an oracle
    // outside the module under test, so a defect in how `duffMeshes.ts` uses
    // the sink cannot also be baked into the check that is supposed to catch
    // it — the exact way the matrix-equality version of this test agreed
    // with the bug it should have caught.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "high" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    duff.update(CAM.x, CAM.z);
    const tiers = createDuffCollector(SEED).collect(CAM.x, CAM.z, DUFF_REACH.high);
    const lists = [tiers.near, tiers.far];
    const variant = activeTerrainVariant();
    let checked = 0;
    for (let t = 0; t < 2; t++) {
      for (let ch = 0; ch < DUFF_CHARACTER_COUNT; ch++) {
        const cells = lists[t]!.filter((c) => c.character === ch);
        if (cells.length === 0) continue;
        const mesh = scene.getMeshByName(duffMeshName(ch, t)) as Mesh;
        const matrices = bufferFor(spy, mesh, "matrix")!;
        for (let i = 0; i < Math.min(cells.length, 20); i++) {
          const c = cells[i]!;
          const groundH = variant.sample(SEED, c.x, c.z).h;
          const worldY = matrices[i * 16 + 13]!;
          // Exactly at ground, not merely "not sunk": `groundH + DUFF_HEIGHT_MAX`
          // as an upper bound would admit any spurious lift up to 12 cm and
          // never fail, which is not the invariant this test is named for.
          expect(worldY).toBeCloseTo(groundH, 4);
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

  it("uses the medium counts and medium's own tier bands, not high's, on medium", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const duff = createDuffMeshes(scene, SEED, { quality: "medium" });
    const mesh = scene.getMeshByName(duffMeshName(0, 0)) as Mesh;
    const g = duffClumpGeometry(DUFF_CHARACTERS[0]!, DUFF_TIER_COUNTS.medium[0]!);
    expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
    // `high` and `medium` reach different distances (12 m / 8 m), so each
    // quality's own material must carry ITS reach's bands, not high's —
    // unasserted before this case, which only ever built `quality: "high"`.
    const bands = duffTierBands(DUFF_REACH.medium);
    for (let t = 0; t < 2; t++) {
      const tierMesh = scene.getMeshByName(duffMeshName(0, t)) as Mesh;
      const foliage = (tierMesh.material as PBRMaterial).pluginManager!.getPlugin("Foliage") as FoliagePlugin;
      expect(foliage.bladeEdges).toEqual(bands[t]);
    }
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
