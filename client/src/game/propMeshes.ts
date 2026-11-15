import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { ChunkGrid } from "../sim/chunkGrid.js";
import { chunkPropBoxes, propChunk, propChunkKey, propWindow } from "./propBoxes.js";
import { attachWet, WET_CAP } from "./wetPlugin.js";
import { buildAtOnce, type FirstBuilds } from "./firstBuilds.js";
import type { Slices } from "./syncJobs.js";

/**
 * Every chunk prop the sim collides with is drawn: the
 * invisible wall at the pad was the trailhead's placeholder car, emitted as a
 * collision box and never rendered. Boxes follow the player by chunk, like
 * the collision broadphase; the window is a square of chunks.
 *
 * Which chunks are drawn round a place, which of a chunk's props are a box
 * here and which another shell draws by a mesh of its own (the six
 * materials of `PROP_DRAWN_ELSEWHERE`), and each box's place and size are
 * `propBoxes.ts`'s, which loads no engine; this shell keeps the meshes.
 */
export { PROP_DRAWN_ELSEWHERE, PROP_MESH_RADIUS_CHUNKS } from "./propBoxes.js";

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
export type MeshRegistry = { add(mesh: Mesh): void; remove(mesh: Mesh): void };
export type PropShadows = MeshRegistry;

/**
 * `cover` is the rain's cover map (`rainMap.ts`), the same shape: every prop
 * drawn here is hard cover, registered as it is built and taken out before
 * it is disposed, since a render target's list is not told of a dispose.
 */
export function createPropMeshes(
  scene: Scene,
  grid: ChunkGrid,
  materialFor: (name: string) => Material,
  shadows?: PropShadows,
  cover?: MeshRegistry,
  /** The loader of first builds, while the intro's film covers the hike (`firstBuilds.ts`): the
   * chunks around a new place are made a chunk a slice by it. Absent, in the call, as always. */
  firstBuilds?: FirstBuilds,
): PropMeshes {
  const live = new Map<string, Mesh[]>(); // "cx,cz" → that chunk's meshes
  let lastCx = Number.NaN, lastCz = Number.NaN;
  /** This shell, as the loader knows it. */
  const owner = {};
  /** The chunks the newest view wants, by key: a fill never makes one that is no longer wanted. */
  let want = new Set<string>();
  /** The chunks named, made one a slice: a chunk is the sim's generation of it and its boxes. */
  function* fill(missing: readonly (readonly [number, number])[]): Slices {
    for (const [cx, cz] of missing) {
      const key = propChunkKey(cx, cz);
      if (want.has(key) && !live.has(key)) live.set(key, build(cx, cz));
      yield;
    }
  }
  function build(cx: number, cz: number): Mesh[] {
    const out: Mesh[] = [];
    for (const box of chunkPropBoxes(grid, cx, cz)) {
      const mesh = MeshBuilder.CreateBox(box.name, { width: box.width, height: box.height, depth: box.depth }, scene);
      mesh.position.set(box.x, box.y, box.z);
      mesh.material = materialFor(box.material);
      // The weather soaks a prop: the renderer's own wetness scale leaves a
      // material with a cap to this rule (`applyWetness`).
      attachWet(mesh.material, WET_CAP.prop);
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      shadows?.add(mesh);
      cover?.add(mesh);
      out.push(mesh);
    }
    return out;
  }
  return {
    update(x, z) {
      const [cx, cz] = propChunk(x, z);
      if (cx === lastCx && cz === lastCz) return;
      lastCx = cx; lastCz = cz;
      want = new Set<string>();
      const missing: [number, number][] = [];
      for (const chunk of propWindow(cx, cz)) {
        const key = propChunkKey(chunk[0], chunk[1]);
        want.add(key);
        if (!live.has(key)) missing.push(chunk);
      }
      // A fill still queued for the last place gives way to this one's.
      firstBuilds?.cancel(owner);
      if (missing.length > 0) buildAtOnce(firstBuilds, owner, fill(missing), "props");
      for (const [key, meshes] of live) {
        if (want.has(key)) continue;
        for (const m of meshes) {
          shadows?.remove(m);
          cover?.remove(m);
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
      firstBuilds?.cancel(owner);
      for (const meshes of live.values()) {
        for (const m of meshes) {
          shadows?.remove(m);
          cover?.remove(m);
          m.dispose();
        }
      }
      live.clear();
    },
  };
}
