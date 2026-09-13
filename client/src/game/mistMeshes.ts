import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";

import { clamp01 } from "./colour.js";
import {
  collectMistBanks, MIST_CELL, MIST_RADIUS, MIST_TEX_SIZE, mistAlphaMap,
  type MistBank,
} from "./mistField.js";
import { mistOpacityUnder, type WeatherParams } from "./weather.js";
import type { QualityTier } from "./quality.js";

/** Below this distance a bank fades out so the camera can pass through it. */
export const MIST_NEAR_FADE_START = 25;
export const MIST_NEAR_FADE_SPAN = 40;
/** Fade span inside the collection radius so the 12th bank never pops. */
export const MIST_EDGE_FADE_SPAN = 150;

/**
 * Billboard quad cap by quality tier. `collectMistBanks` always
 * returns up to `MIST_CAP` banks nearest-first, so a lower cap here simply
 * drives fewer of the nearest banks — no change needed in `mistField.ts`.
 */
export const MIST_CAP_BY_TIER: Record<QualityTier, number> = { low: 6, medium: 12, high: 12 };

export type MistMeshes = {
  update(camX: number, camZ: number, w: WeatherParams): void;
  dispose(): void;
  meshes: readonly Mesh[];
};

/**
 * Twelve reusable billboard quads over one unlit alpha material. Placement is
 * `collectMistBanks`; this shell only positions, scales and fades. Depth write
 * is off (soft volumes must not occlude), fog stays ON so distant banks merge
 * into the haze, and the emissive colour tracks `scene.fogColor` so the banks
 * are always the colour of the air.
 */
export function createMistMeshes(scene: Scene, seed: number, tier: QualityTier): MistMeshes {
  const cap = MIST_CAP_BY_TIER[tier];
  const data = mistAlphaMap();
  const tex = RawTexture.CreateRGBATexture(
    data, MIST_TEX_SIZE, MIST_TEX_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE,
    Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;

  const mat = new StandardMaterial("mat_mist", scene);
  mat.disableLighting = true;
  mat.opacityTexture = tex;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;

  const meshes: Mesh[] = [];
  for (let i = 0; i < cap; i++) {
    const mesh = MeshBuilder.CreatePlane(`mist_${i}`, { size: 1 }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.setEnabled(false);
    meshes.push(mesh);
  }

  let banks: MistBank[] = [];
  let lastCellX: number | null = null;
  let lastCellZ: number | null = null;

  return {
    meshes,
    update(camX, camZ, w) {
      const opacity = mistOpacityUnder(w);
      if (opacity <= 0) {
        for (const m of meshes) m.setEnabled(false);
        lastCellX = null; // force a recollect when mist returns
        return;
      }
      const cellX = Math.floor(camX / MIST_CELL);
      const cellZ = Math.floor(camZ / MIST_CELL);
      if (cellX !== lastCellX || cellZ !== lastCellZ) {
        banks = collectMistBanks(seed, camX, camZ);
        lastCellX = cellX;
        lastCellZ = cellZ;
      }
      mat.emissiveColor.copyFrom(scene.fogColor);
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i] as Mesh;
        const bank = banks[i];
        if (!bank) {
          mesh.setEnabled(false);
          continue;
        }
        mesh.position.set(bank.x, bank.y, bank.z);
        mesh.scaling.set(bank.width, bank.height, 1);
        const d = Math.sqrt((bank.x - camX) ** 2 + (bank.z - camZ) ** 2);
        const nearFade = clamp01((d - MIST_NEAR_FADE_START) / MIST_NEAR_FADE_SPAN);
        const edgeFade = clamp01((MIST_RADIUS - d) / MIST_EDGE_FADE_SPAN);
        const visibility = opacity * nearFade * edgeFade;
        mesh.visibility = visibility;
        mesh.setEnabled(visibility > 0.01);
      }
    },
    dispose() {
      for (const m of meshes) m.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
