import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ChunkGrid } from "../sim/chunkGrid.js";
import { CHUNK_SIZE } from "../sim/forestConstants.js";

/**
 * Every chunk prop the sim collides with is drawn: the
 * invisible wall at the pad was the trailhead's placeholder car, emitted as a
 * collision box and never rendered. Boxes follow the player by chunk, like
 * the collision broadphase; the window is a square of chunks.
 *
 * Six materials are the exception, each already drawn by a mesh elsewhere:
 * `trunk` — the forest meshes draw the tree the box belongs to; `rock` — the
 * clutter meshes draw the boulder's own GLB (`clutterMeshes.ts`, sited by the
 * same deterministic function over the same seed); `cliff` — the cliff
 * meshes draw the rock-wall module a row of boxes belongs to
 * (`cliffMeshes.ts`, from the same `cliffCellRuns` the collider pass reads);
 * `car` and `kiosk` — the trailhead meshes draw the SUV and the kiosk standing
 * on those two boxes, and the box itself while a model is missing
 * (`trailheadMeshes.ts`); `signpost` — the sign meshes draw the fingerpost
 * that stands on it, and the box while the post model is missing
 * (`signMeshes.ts`).
 * Without this exception a `rock` box would paint a flat-topped grey slab
 * over every boulder in the game: the collider's square footprint and
 * peak-height top do not follow the mesh's true (round, often domed)
 * silhouette, so the box protrudes past the boulder's curved surface almost
 * everywhere except at the peak itself — and a `cliff` box, which bounds a
 * leaning wall, would stand as a grey block around every module.
 */
export const PROP_MESH_RADIUS_CHUNKS = 3;
export const PROP_DRAWN_ELSEWHERE: ReadonlySet<string> = new Set(["trunk", "rock", "cliff", "car", "kiosk", "signpost"]);

export type PropMeshes = {
  update(x: number, z: number): void;
  count(): number;
  dispose(): void;
};

/**
 * Shadow-registry hook, satisfied by `lighting.addShadowMesh` /
 * `removeShadowMesh` (see `wildlifeMeshes.ts` for the same pattern). Optional:
 * a test with no `Lighting` in the loop simply builds meshes that never enter
 * a shadow map.
 */
export type PropShadows = { add(mesh: Mesh): void; remove(mesh: Mesh): void };

export function createPropMeshes(
  scene: Scene,
  grid: ChunkGrid,
  materialFor: (name: string) => Material,
  shadows?: PropShadows,
): PropMeshes {
  const live = new Map<string, Mesh[]>(); // "cx,cz" → that chunk's meshes
  let lastCx = Number.NaN, lastCz = Number.NaN;
  function build(cx: number, cz: number): Mesh[] {
    const out: Mesh[] = [];
    const chunk = grid.chunkAt(cx, cz);
    for (const [i, p] of chunk.props.entries()) {
      if (PROP_DRAWN_ELSEWHERE.has(p.material)) continue;
      const sx = p.box.max.x - p.box.min.x, sy = p.box.max.y - p.box.min.y, sz = p.box.max.z - p.box.min.z;
      const mesh = MeshBuilder.CreateBox(`prop_${cx}_${cz}_${i}_${p.material}`, { width: sx, height: sy, depth: sz }, scene);
      mesh.position.set(p.box.min.x + sx / 2, p.box.min.y + sy / 2, p.box.min.z + sz / 2);
      mesh.material = materialFor(p.material);
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      shadows?.add(mesh);
      out.push(mesh);
    }
    return out;
  }
  return {
    update(x, z) {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      if (cx === lastCx && cz === lastCz) return;
      lastCx = cx; lastCz = cz;
      const want = new Set<string>();
      for (let i = -PROP_MESH_RADIUS_CHUNKS; i <= PROP_MESH_RADIUS_CHUNKS; i++) {
        for (let j = -PROP_MESH_RADIUS_CHUNKS; j <= PROP_MESH_RADIUS_CHUNKS; j++) {
          const key = `${cx + i},${cz + j}`;
          want.add(key);
          if (!live.has(key)) live.set(key, build(cx + i, cz + j));
        }
      }
      for (const [key, meshes] of live) {
        if (want.has(key)) continue;
        for (const m of meshes) {
          shadows?.remove(m);
          m.dispose();
        }
        live.delete(key);
      }
    },
    count() {
      let n = 0;
      for (const m of live.values()) n += m.length;
      return n;
    },
    dispose() {
      for (const meshes of live.values()) {
        for (const m of meshes) {
          shadows?.remove(m);
          m.dispose();
        }
      }
      live.clear();
    },
  };
}
