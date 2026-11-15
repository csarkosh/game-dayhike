import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";

import type { Rgb } from "./colour.js";
import { MIST_TEX_SIZE, mistAlphaMap } from "./mistField.js";
import { createMistBanks, mistBankShown, type DrawnMistBank } from "./mistBanks.js";
import type { WeatherParams } from "./weather.js";
import type { QualityTier } from "./quality.js";
import type { WindRecord } from "./windParams.js";

export { MIST_CAP_BY_TIER, MIST_DRIFT, MIST_EDGE_FADE_SPAN, MIST_NEAR_FADE_SPAN, MIST_NEAR_FADE_START, MIST_WRAP_FADE } from "./mistBanks.js";

export type MistMeshes = {
  /** `seconds` is the raw render clock; the shell differences it itself to step
   * the drift, so callers pass the same clock every other renderer shell reads. */
  update(camX: number, camZ: number, w: WeatherParams, air: Rgb, wind: WindRecord, seconds: number): void;
  dispose(): void;
  meshes: readonly Mesh[];
};

/**
 * Twelve reusable billboard quads over one unlit alpha material. Placement is
 * `collectMistBanks`; this shell only positions, scales and fades. Depth write
 * is off (soft volumes must not occlude), fog stays ON so distant banks merge
 * into the haze, and the emissive colour is the fog gradient's middle,
 * handed in by the renderer each frame, so the banks sit inside the fog
 * rather than at its far end.
 */
export function createMistMeshes(scene: Scene, seed: number, tier: QualityTier): MistMeshes {
  const banks = createMistBanks(seed, tier);
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
  for (let i = 0; i < banks.drawn.length; i++) {
    const mesh = MeshBuilder.CreatePlane(`mist_${i}`, { size: 1 }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.setEnabled(false);
    meshes.push(mesh);
  }

  return {
    meshes,
    update(camX, camZ, w, air, wind, seconds) {
      if (!banks.update(camX, camZ, w, wind, seconds)) {
        for (const m of meshes) m.setEnabled(false);
        return;
      }
      mat.emissiveColor.set(air.r, air.g, air.b);
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i] as Mesh;
        const bank = banks.drawn[i] as DrawnMistBank;
        if (!bank.placed) {
          mesh.setEnabled(false);
          continue;
        }
        mesh.position.set(bank.x, bank.y, bank.z);
        mesh.scaling.set(bank.width, bank.height, 1);
        mesh.visibility = bank.visibility;
        mesh.setEnabled(mistBankShown(bank));
      }
    },
    dispose() {
      for (const m of meshes) m.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
