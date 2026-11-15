/**
 * The chunk props the simulation collides with on Babylon Lite: a box a
 * prop, in the chunks round the camera, for every prop no other shell draws
 * by a mesh of its own (`propBoxes.ts` has the window, the boxes and the
 * list of those; a world as the game makes it today emits none that is
 * drawn here, so nothing is made).
 *
 * A box is a mesh of its own, standing where the prop stands, in a material
 * a prop material's name: Lite's PBR in the name's colour, matt, soaked by
 * the weather at a prop's cap and under the air. The chunks are made whole
 * when the camera crosses into another chunk, and a chunk that has left the
 * window goes with its meshes.
 */
import {
  addToScene, createMeshFromData, createPbrMaterial, disposeMeshGpu, markMaterialUboDirty, removeFromScene,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext,
} from "@babylonjs/lite";
import type { ChunkGrid } from "../../sim/chunkGrid.js";
import { PROP_ROUGHNESS, chunkPropBoxes, propBoxGeometry, propChunk, propChunkKey, propColour, propWindow } from "../propBoxes.js";
import type { WetUniforms } from "../wetSurface.js";
import { baseColourPlugin, surfaceWetPlugin } from "./forestPlugins.js";

export type PropMeshes = {
  /** Follows the camera: the chunks round it are made, and the ones left behind go, when it crosses into another chunk. */
  update(x: number, z: number): void;
  /** Once a frame: every material's uniforms are written again, for the wet line and the air move. */
  frame(): void;
  /** The boxes drawn now. */
  count(): number;
  dispose(): void;
};

export type PropMeshOptions = {
  /** The wet look's uniforms at a prop's cap (`wetUniforms`): filled in place each frame. */
  wet: WetUniforms;
  /** The air's plugin, one a material. */
  air: () => MaterialPlugin;
};

export function createPropMeshes(engine: EngineContext, scene: SceneContext, grid: ChunkGrid, options: PropMeshOptions): PropMeshes {
  /** A chunk's meshes by its key. */
  const live = new Map<string, Mesh[]>();
  const materials = new Map<string, PbrMaterialProps>();
  let lastCx = Number.NaN;
  let lastCz = Number.NaN;
  let disposed = false;

  /** The material of the prop material named `name`: one a name, made at its first box. */
  function materialFor(name: string): PbrMaterialProps {
    let made = materials.get(name);
    if (made === undefined) {
      const colour = propColour(name);
      made = createPbrMaterial({ baseColorFactor: [colour[0], colour[1], colour[2], 1], metallicFactor: 0, roughnessFactor: PROP_ROUGHNESS, usePhysicalLightFalloff: true });
      made.plugins = [baseColourPlugin(), surfaceWetPlugin(options.wet), options.air()];
      materials.set(name, made);
    }
    return made;
  }

  function build(cx: number, cz: number): Mesh[] {
    return chunkPropBoxes(grid, cx, cz).map((box) => {
      const geometry = propBoxGeometry(box);
      const mesh = createMeshFromData(engine, box.name, geometry.positions, geometry.normals, geometry.indices);
      mesh.material = materialFor(box.material);
      addToScene(scene, mesh);
      return mesh;
    });
  }

  function drop(meshes: readonly Mesh[]): void {
    for (const mesh of meshes) {
      removeFromScene(scene, mesh);
      disposeMeshGpu(mesh);
    }
  }

  return {
    update(x, z) {
      if (disposed) return;
      const [cx, cz] = propChunk(x, z);
      if (cx === lastCx && cz === lastCz) return;
      lastCx = cx;
      lastCz = cz;
      const want = new Set<string>();
      for (const [wx, wz] of propWindow(cx, cz)) {
        const key = propChunkKey(wx, wz);
        want.add(key);
        if (!live.has(key)) live.set(key, build(wx, wz));
      }
      for (const [key, meshes] of live) {
        if (want.has(key)) continue;
        drop(meshes);
        live.delete(key);
      }
    },
    frame() {
      for (const made of materials.values()) markMaterialUboDirty(made);
    },
    count() {
      let n = 0;
      for (const meshes of live.values()) n += meshes.length;
      return n;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const meshes of live.values()) drop(meshes);
      live.clear();
      materials.clear();
    },
  };
}
