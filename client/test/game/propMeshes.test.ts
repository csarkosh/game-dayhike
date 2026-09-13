import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import "../../src/sim/passes/index.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { createPropMeshes, PROP_DRAWN_ELSEWHERE, PROP_MESH_RADIUS_CHUNKS } from "../../src/game/propMeshes.js";
setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

let engine: NullEngine; let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

describe("chunk props are drawn", () => {
  it("draws every non-trunk prop within range of the player, keyed by chunk, and drops them out of range", () => {
    const seed = 0x5eed;
    const grid = createChunkGrid(seed);
    const th = bowlFor(seed).graph.trailhead;
    const mat = new StandardMaterial("m", scene);
    const props = createPropMeshes(scene, grid, () => mat);
    props.update(th.x, th.z);
    // Count the props the sim would collide with in the same window.
    const cx = Math.floor(th.x / CHUNK_SIZE), cz = Math.floor(th.z / CHUNK_SIZE);
    let expected = 0;
    for (let i = -PROP_MESH_RADIUS_CHUNKS; i <= PROP_MESH_RADIUS_CHUNKS; i++) for (let j = -PROP_MESH_RADIUS_CHUNKS; j <= PROP_MESH_RADIUS_CHUNKS; j++) {
      for (const p of grid.chunkAt(cx + i, cz + j).props) if (!PROP_DRAWN_ELSEWHERE.has(p.material)) expected++;
    }
    expect(expected).toBeGreaterThanOrEqual(3);              // car, post, sign
    expect(props.count()).toBe(expected);
    const car = scene.meshes.find((m) => m.name.startsWith("prop_") && m.name.includes("crate"));
    expect(car).toBeDefined();
    props.update(th.x + 20 * CHUNK_SIZE, th.z);              // far away: the pad's props go
    expect(scene.meshes.filter((m) => m.name.startsWith("prop_") && m.name.includes("crate"))).toHaveLength(0);
    props.dispose();
    expect(scene.meshes.filter((m) => m.name.startsWith("prop_"))).toHaveLength(0);
  });
  // The trailhead's props (pillar, crate) and clutter's rock sites are not
  // near the world origin (measured for seed 12345: pillar/crate at chunk
  // cx=-8, rock at [-1,-11]) — a single `update(0, 0)` window of radius
  // PROP_MESH_RADIUS_CHUNKS around the origin misses them. Tiling `update`
  // calls across the whole scan window, with a stride equal to the window's
  // own diameter so the tiles cover it with no gaps, is what actually
  // exercises "every prop material is drawn somewhere" against real chunk
  // data instead of assuming it all sits near (0, 0).
  // NAMED FOR WHAT IT ASSERTS: the `rock`
  // half passes purely via `PROP_DRAWN_ELSEWHERE.has(m)` — a DECLARED
  // EXEMPTION, not a check that a boulder mesh exists at that collider's
  // site. The exemption is correct (passes/clutter.ts emits `material:
  // "rock"` only for CLUTTER_BOULDER, and clutterMeshes.ts draws
  // clutter.boulder_a/b.glb for that class from the same deterministic
  // siting), but the old name — "every prop material is drawn here or
  // elsewhere" — read as if the test had been out and looked.
  it("leaves no collider without a mesh: every prop material is drawn here, or is on the declared exemption list", () => {
    const grid = createChunkGrid(12345);
    const seen = new Set<string>();
    for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) for (const p of grid.chunkAt(i, j).props) seen.add(p.material);
    const props = createPropMeshes(scene, grid, () => new StandardMaterial("n", scene));
    const drawn = new Set<string>();
    const stride = PROP_MESH_RADIUS_CHUNKS * 2 + 1;
    for (let i = -12; i <= 12; i += stride) {
      for (let j = -12; j <= 12; j += stride) {
        props.update(i * CHUNK_SIZE, j * CHUNK_SIZE);
        for (const mesh of scene.meshes) {
          if (!mesh.name.startsWith("prop_")) continue;
          for (const m of seen) if (mesh.name.includes(m)) drawn.add(m);
        }
      }
    }
    for (const m of seen) {
      expect(PROP_DRAWN_ELSEWHERE.has(m) || drawn.has(m), m).toBe(true);
    }
    props.dispose();
  });
});
