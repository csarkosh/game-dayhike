import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Scene } from "@babylonjs/core/scene.js";

import { CAR_HALF, CAR_MATERIAL, KIOSK_HALF, KIOSK_MATERIAL } from "../sim/passes/trailhead.js";
import type { Vec3 } from "../sim/types.js";
import type { PropShadows } from "./propMeshes.js";
import { armYaw, paintedMaterial, type Painter } from "./signMeshes.js";
import { defaultModelLoader, placeStaticModel, type ModelLoader, type PlacedModel } from "./staticModel.js";

export const TRAILHEAD_CAR_OUTPUT = "models/trailhead.car.glb";
export const TRAILHEAD_KIOSK_OUTPUT = "models/trailhead.kiosk.glb";
/** The poster's painted texture: the board is 2 m by 1 m, so twice as wide as tall. */
export const POSTER_TEXTURE = { width: 1024, height: 512 } as const;

type Site = { x: number; z: number };

export type TrailheadSites = {
  /** The car's footprint centre, and the trailhead it is parked beside. */
  car: { site: Site; trailhead: Site };
  /** The kiosk's footprint centre, and the way its poster faces (`kioskFacing`). */
  kiosk: { site: Site; facing: { dx: number; dz: number } };
};

export type TrailheadDeps = {
  /** The box material by prop name — `terrainMaterialFor`, as the prop boxes use. */
  materialFor(name: string): Material;
  /** The poster's lines, top to bottom. */
  lines: readonly string[];
  paint?: Painter;
  shadows?: PropShadows;
  loader?: ModelLoader;
};

export type TrailheadMeshes = {
  /** Resolves once both models have settled, loaded or failed. */
  readonly ready: Promise<void>;
  dispose(): void;
};

/**
 * The car's yaw: 0 or PI only, so the model stays square to the box the sim
 * collides with, turned so its nose points along the road toward the
 * trailhead it is parked beside — the way a ranger pulls in.
 */
export function carYaw(site: Site, trailhead: Site): number {
  return trailhead.z >= site.z ? 0 : Math.PI;
}

/**
 * The kiosk's poster material: the one material in the model with no base
 * colour texture. Null unless there is exactly one, so a model that breaks the
 * rule shows its own board rather than paint on the wrong part.
 */
export function posterMaterial(container: AssetContainer): Material | null {
  const bare = container.materials.filter((m) => m instanceof PBRMaterial && m.albedoTexture === null);
  return bare.length === 1 ? (bare[0] as Material) : null;
}

/**
 * Turns a glTF texture coordinate's v (0 at the image's top) into Babylon's
 * (0 at the bottom). The loader keeps glTF's v as it is and uploads the file's
 * own textures unflipped to match, but a painted canvas is uploaded the other
 * way up, its top row at v = 1 — as it is on every other painted surface in
 * the game. Without this the poster would hang upside down.
 */
function flipPosterV(mesh: AbstractMesh): void {
  const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
  if (uvs === null) return;
  const flipped = new Float32Array(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    flipped[i] = uvs[i] as number;
    flipped[i + 1] = 1 - (uvs[i + 1] as number);
  }
  (mesh as Mesh).setVerticesData(VertexBuffer.UVKind, flipped, false);
}

/**
 * The trailhead's two models, placed once from the seed's sites: the ranger's
 * SUV on the shoulder and the roofed kiosk with the missing hiker's poster.
 * Each stands on the box the sim collides with and, until its model arrives
 * (or for good, if it never does), that box is drawn instead, exactly as the
 * prop boxes elsewhere are — so the pad never holds an invisible wall.
 */
export function createTrailheadMeshes(
  scene: Scene,
  sites: TrailheadSites,
  groundH: (x: number, z: number) => number,
  deps: TrailheadDeps,
): TrailheadMeshes {
  const load = deps.loader ?? defaultModelLoader(scene);
  const paint = deps.paint ?? paintedMaterial;
  let disposed = false;
  const placed: PlacedModel[] = [];
  const painted: Material[] = [];

  function fallbackBox(material: string, site: Site, half: Vec3): Mesh {
    const ground = groundH(site.x, site.z);
    const mesh = MeshBuilder.CreateBox(
      `trailhead_${material}_box`,
      { width: 2 * half.x, height: 2 * half.y, depth: 2 * half.z },
      scene,
    );
    mesh.position.set(site.x, ground + half.y, site.z);
    mesh.material = deps.materialFor(material);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    deps.shadows?.add(mesh);
    return mesh;
  }
  function dropBox(box: Mesh): void {
    if (box.isDisposed()) return;
    deps.shadows?.remove(box);
    box.dispose();
  }

  const carBox = fallbackBox(CAR_MATERIAL, sites.car.site, CAR_HALF);
  const kioskBox = fallbackBox(KIOSK_MATERIAL, sites.kiosk.site, KIOSK_HALF);

  async function place(
    output: string, name: string, site: Site, yaw: number, box: Mesh,
    dress?: (container: AssetContainer) => void,
  ): Promise<void> {
    let container: AssetContainer;
    try {
      container = await load(output);
    } catch {
      // A missing model costs the look, never the collider: the box stays.
      return;
    }
    // Disposed while the file was in flight: nothing will ever draw it.
    if (disposed) {
      container.dispose();
      return;
    }
    let model: PlacedModel;
    try {
      dress?.(container);
      model = placeStaticModel(container, name, site.x, groundH(site.x, site.z), site.z, yaw);
    } catch {
      container.dispose();
      return;
    }
    for (const m of model.meshes) deps.shadows?.add(m);
    placed.push(model);
    dropBox(box);
  }

  function dressKiosk(container: AssetContainer): void {
    const board = posterMaterial(container);
    if (board === null) return;
    const poster = paint(scene, "mat_poster", deps.lines, POSTER_TEXTURE.width, POSTER_TEXTURE.height);
    painted.push(poster);
    for (const mesh of container.meshes) {
      if (mesh.material !== board) continue;
      flipPosterV(mesh);
      mesh.material = poster;
    }
    container.materials.splice(container.materials.indexOf(board), 1);
    board.dispose();
  }

  const ready = Promise.all([
    place(TRAILHEAD_CAR_OUTPUT, "trailhead_car", sites.car.site, carYaw(sites.car.site, sites.car.trailhead), carBox),
    place(
      TRAILHEAD_KIOSK_OUTPUT, "trailhead_kiosk", sites.kiosk.site,
      // The model's poster faces +Z; turn +Z onto the facing.
      armYaw(sites.kiosk.facing), kioskBox, dressKiosk,
    ),
  ]).then(() => undefined);

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      dropBox(carBox);
      dropBox(kioskBox);
      for (const model of placed) {
        for (const m of model.meshes) deps.shadows?.remove(m);
        model.dispose();
      }
      placed.length = 0;
      for (const m of painted) m.dispose(true, true);
      painted.length = 0;
    },
  };
}
