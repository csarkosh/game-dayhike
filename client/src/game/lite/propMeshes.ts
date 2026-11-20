/**
 * The chunk props the simulation collides with on Babylon Lite: a box a
 * prop, in the chunks round the camera, for every prop no other shell draws
 * by a mesh of its own (`propBoxes.ts` has the window, the boxes and the
 * list of those; a world as the game makes it today emits none that is
 * drawn here, so nothing is made).
 *
 * A box is a mesh of its own, standing where the prop stands, in a material
 * a prop material's name: Lite's PBR in the name's colour, matt, soaked by
 * the weather at a prop's cap and under the air. The chunks round a new
 * place are made when the camera crosses into another chunk: as a job of
 * the renderer's scheduler for a step into the next chunk at a walk, a
 * chunk a slice (`syncJobs.ts`, `rebuildJobs.ts`), and at once, in the call,
 * for the first build and a jump, or a chunk a slice by the loader of first
 * builds while the intro's film covers the hike (`firstBuilds.ts`). A chunk
 * is the simulation's generation of it, which cannot be cut, so a slice is
 * a chunk at the least; a box is made in the same slice as its chunk. A
 * chunk that has left the window goes with its meshes as the job begins to
 * run. Until a chunk's boxes are made its props are not drawn, and they are
 * the ones past the camera's walk, three chunks (96 m) out.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene,
  type EngineContext, type MaterialPlugin, type PluginUniformBlock, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import type { ChunkGrid } from "../../sim/chunkGrid.js";
import type { FirstBuilds } from "@csarkosh/engine/game/firstBuilds";
import { PROP_ROUGHNESS, chunkPropBoxes, propBoxGeometry, propChunk, propChunkKey, propColour, propWindow } from "../propBoxes.js";
import type { Slices, SyncJobs } from "@csarkosh/engine/game/syncJobs";
import type { WetUniforms } from "../wetSurface.js";
import { DRAW_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import type { CoverRegistry } from "./rainMap.js";
import { cellOrigin, createRebuilds } from "@csarkosh/engine/game/lite/rebuildJobs";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";

export type PropMeshes = {
  /** Follows the camera: the chunks round it are made, and the ones left behind go, when it crosses into another chunk. */
  update(x: number, z: number): void;
  /** The boxes drawn now. */
  count(): number;
  dispose(): void;
};

export type PropMeshOptions = {
  /** The wet look's uniforms at a prop's cap (`wetUniforms`): filled in place each frame. */
  wet: WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
  /** The frame's block, which every material reads the wind, the eye, the wet line and the air from (`frameBlock.ts`). */
  shared: PluginUniformBlock;
  /** The loader of first builds, while the intro's film covers the hike: the chunks round a new place are made a chunk a slice by it. */
  firstBuilds?: FirstBuilds;
  /** The renderer's scheduler: given it, a step into the next chunk at a walk is a job, a chunk a slice. */
  jobs?: SyncJobs;
  /** The renderer's record of its uploads, and its budget for the streamed ones (`frameUploads.ts`). */
  uploads?: FrameUploads;
  /** The rain's cover map: every box drawn is hard cover, from when it is built until it is let go (`rainMap.ts`). */
  cover?: CoverRegistry;
};

export function createPropMeshes(engine: EngineContext, scene: SceneContext, grid: ChunkGrid, options: PropMeshOptions): PropMeshes {
  /** A chunk's meshes by its key. */
  const live = new Map<string, Mesh[]>();
  const materials = new Map<string, PbrMaterialProps>();
  let disposed = false;
  /** The chunks the newest view wants, by key: a fill never makes one that is no longer wanted. */
  let want = new Set<string>();

  /**
   * The rebuild for a camera at (x, z), as slices: the chunks of its window not yet made, in the window's order,
   * one a slice (a chunk is the simulation's generation of it and its boxes), and the chunks of the last window
   * that it does not want let go as it begins.
   */
  function* rebuild(x: number, z: number): Slices {
    const [cx, cz] = propChunk(x, z);
    want = new Set<string>();
    const missing: [number, number][] = [];
    for (const chunk of propWindow(cx, cz)) {
      const key = propChunkKey(chunk[0], chunk[1]);
      want.add(key);
      if (!live.has(key)) missing.push(chunk);
    }
    for (const [key, meshes] of live) {
      if (want.has(key)) continue;
      drop(meshes);
      live.delete(key);
    }
    for (const [mx, mz] of missing) {
      const key = propChunkKey(mx, mz);
      if (!disposed && want.has(key) && !live.has(key)) live.set(key, build(mx, mz));
      yield;
    }
  }

  /** The material of the prop material named `name`: one a name, made at its first box. */
  function materialFor(name: string): PbrMaterialProps {
    let made = materials.get(name);
    if (made === undefined) {
      const colour = propColour(name);
      made = createPbrMaterial({ baseColorFactor: [colour[0], colour[1], colour[2], 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
      made.plugins = [baseColourPlugin(), surfaceWetPlugin(options.wet, options.shared), options.air()];
      materials.set(name, made);
    }
    return made;
  }

  function build(cx: number, cz: number): Mesh[] {
    return chunkPropBoxes(grid, cx, cz).map((box) => {
      const geometry = propBoxGeometry(box);
      const mesh = createMeshFromData(engine, box.name, geometry.positions, geometry.normals, geometry.indices);
      options.uploads?.stream("geometry", geometry.positions.byteLength + geometry.normals.byteLength + geometry.indices.byteLength, 3);
      options.uploads?.made();
      mesh.material = materialFor(box.material);
      // The boxes' materials are one stack, drawn by one pipeline: they share a place.
      mesh.renderOrder = DRAW_ORDER.props;
      addToScene(scene, mesh);
      options.cover?.add(mesh);
      return mesh;
    });
  }

  function drop(meshes: readonly Mesh[]): void {
    for (const mesh of meshes) {
      options.cover?.remove(mesh);
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
      options.uploads?.dropped();
    }
  }

  // A step into the next chunk at a walk is a job; the first build and a jump are made at once, or by the loader.
  const rebuilds = createRebuilds({
    name: "props",
    cell: CHUNK_SIZE,
    origin: cellOrigin(CHUNK_SIZE),
    rebuild,
    jobs: options.jobs,
    firstBuilds: options.firstBuilds,
  });

  return {
    update(x, z) {
      if (disposed) return;
      rebuilds.update(x, z);
    },
    count() {
      let n = 0;
      for (const meshes of live.values()) n += meshes.length;
      return n;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rebuilds.dispose();
      for (const meshes of live.values()) drop(meshes);
      live.clear();
      materials.clear();
    },
  };
}
