import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import "../../src/sim/passes/index.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { createChunkGrid, type ChunkGrid } from "../../src/sim/chunkGrid.js";
import { parseLevel, type Brush } from "../../src/sim/level.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { createPropMeshes, PROP_DRAWN_ELSEWHERE, PROP_MESH_RADIUS_CHUNKS } from "../../src/game/propMeshes.js";
import { CLIFF_MATERIAL } from "../../src/sim/passes/cliffs.js";
setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

let engine: NullEngine; let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

/**
 * The sandbox level's boxes as a chunk grid, each brush in the chunk holding
 * its centre, plus a car and a kiosk the way the trailhead pass emits them.
 * The sandbox's crates and pillars are drawn as boxes to this day, where a
 * seeded world's pad now holds only props other meshes draw.
 */
function sandboxGrid(): ChunkGrid {
  const props: Brush[] = [
    ...parseLevel(sandbox01).brushes.filter((b) => b.material === "crate" || b.material === "pillar"),
    { material: "car", box: { min: { x: 20, y: 0, z: -20 }, max: { x: 21.8, y: 1.6, z: -15.4 } } },
    { material: "kiosk", box: { min: { x: -24, y: 0, z: 22 }, max: { x: -21.8, y: 2.5, z: 23.1 } } },
  ];
  const chunkOf = (v: number): number => Math.floor(v / CHUNK_SIZE);
  return {
    chunkAt: (cx: number, cz: number) => ({
      props: props.filter((p) =>
        chunkOf((p.box.min.x + p.box.max.x) / 2) === cx && chunkOf((p.box.min.z + p.box.max.z) / 2) === cz),
    }),
  } as unknown as ChunkGrid;
}

describe("chunk props are drawn", () => {
  it("draws every box-drawn prop within range of the player, keyed by chunk, and drops them out of range", () => {
    const mat = new StandardMaterial("m", scene);
    const shadowed = new Set<AbstractMesh>();
    const props = createPropMeshes(scene, sandboxGrid(), () => mat, {
      add: (m) => shadowed.add(m), remove: (m) => shadowed.delete(m),
    });
    props.update(0, 0);
    // Two crates and three pillars; the car and the kiosk are the trailhead meshes'.
    expect(props.count()).toBe(5);
    expect(shadowed.size).toBe(5);
    const drawn = scene.meshes.filter((m) => m.name.startsWith("prop_"));
    expect(drawn.filter((m) => m.name.endsWith("_crate"))).toHaveLength(2);
    expect(drawn.filter((m) => m.name.endsWith("_pillar"))).toHaveLength(3);
    expect(drawn.filter((m) => m.name.endsWith("_car") || m.name.endsWith("_kiosk"))).toHaveLength(0);
    // The crate at (10..12, 0..1, 10..12): its own box, centred on it.
    const crate = drawn.find((m) => m.position.x === 11 && m.position.z === 11)!;
    expect(crate.position.y).toBe(0.5);
    expect(crate.getBoundingInfo().boundingBox.extendSize.asArray()).toEqual([1, 0.5, 1]);
    props.update(20 * CHUNK_SIZE, 0);                        // far away: the sandbox's props go
    expect(props.count()).toBe(0);
    expect(scene.meshes.filter((m) => m.name.startsWith("prop_"))).toHaveLength(0);
    expect(shadowed.size).toBe(0);
    props.update(0, 0);
    props.dispose();
    expect(scene.meshes.filter((m) => m.name.startsWith("prop_"))).toHaveLength(0);
    expect(shadowed.size).toBe(0);
  });

  it("leaves the car and the kiosk to the trailhead meshes", () => {
    expect(PROP_DRAWN_ELSEWHERE.has("car")).toBe(true);
    expect(PROP_DRAWN_ELSEWHERE.has("kiosk")).toBe(true);
  });

  it("leaves the fingerpost colliders to the sign meshes", () => {
    expect(PROP_DRAWN_ELSEWHERE.has("signpost")).toBe(true);
  });

  // The trailhead's props (kiosk, car) and clutter's rock sites are not
  // near the world origin (measured for seed 12345: kiosk/car at chunk
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
  // The cliff pass's boxes bound a leaning wall the cliff meshes already
  // draw; painted here they would stand as grey blocks around every module.
  // Asserted by name because the scan below, round the origin of one world,
  // need not meet a cliff at all.
  it("leaves the cliff colliders to the cliff meshes", () => {
    expect(PROP_DRAWN_ELSEWHERE.has(CLIFF_MATERIAL)).toBe(true);
  });

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
