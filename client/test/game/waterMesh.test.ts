import { describe, it, expect, afterEach } from "vitest";
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

setActiveTerrainVariant("olympic");

describe("createWater under NullEngine", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("builds one alpha-blended mesh per ring and survives update/dispose", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 0x5eed, 0);
    expect(water.meshes.length).toBe(WATER_RING_COUNT);
    for (const m of water.meshes) {
      expect(m.getTotalVertices()).toBeGreaterThan(0);
      expect(m.hasVertexAlpha).toBe(true);
      expect((m.material as PBRMaterial).transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
      expect(m.receiveShadows).toBe(false);
    }
    water.update(-500, 300); // must re-emit without throwing
    water.dispose();
  });

  it("adds one depth-shaded disc per pond, sharing the water material, and disposes it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [{ x: 100, z: 50, radius: 30, height: 42 }]);
    const pond = scene.getMeshByName("pond_0");
    expect(pond).not.toBeNull();
    expect(pond!.position.y).toBeCloseTo(42.02, 5);
    // Babylon's default bounding sphere is fit around the AABB (radius =
    // half the box diagonal, R·√2 for a flat disc), not the mesh's actual
    // circumradius — the box extent is the honest read of "radius ≈ 31"
    // (pond.radius + 1, the CreateDisc argument).
    expect(pond!.getBoundingInfo().boundingBox.extendSizeWorld.x).toBeCloseTo(31, 0);
    expect(pond!.material).toBe(scene.getMaterialByName("mat_water"));
    water.dispose();
    expect(scene.getMeshByName("pond_0")).toBeNull();
  });
});
