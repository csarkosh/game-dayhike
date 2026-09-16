import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";

import { clamp01, type Rgb } from "./colour.js";
import {
  collectMistBanks, MIST_CELL, MIST_RADIUS, MIST_TEX_SIZE, mistAlphaMap,
  type MistBank,
} from "./mistField.js";
import { mistOpacityUnder, type WeatherParams } from "./weather.js";
import type { QualityTier } from "./quality.js";
import type { WindRecord } from "./windParams.js";

/** Below this distance a bank fades out so the camera can pass through it. */
export const MIST_NEAR_FADE_START = 25;
export const MIST_NEAR_FADE_SPAN = 40;
/** Fade span inside the collection radius so the 12th bank never pops. */
export const MIST_EDGE_FADE_SPAN = 150;
/** Drift speed, m/s, at wind speed 1. */
export const MIST_DRIFT = 0.25;
/** Span, metres, over which a bank dissolves as it nears its own wrap boundary. */
export const MIST_WRAP_FADE = 8;

/**
 * Wraps a drift offset into ±MIST_CELL/2 so a bank wanders but never leaves
 * its cell. Every bank rides the same drift clock (`off`, below); wrapping it
 * unmodified would put every bank's own wrap boundary at the same `off`
 * value, so all twelve would cross it — and teleport by a full MIST_CELL —
 * in the same frame. The update loop instead wraps `off + bank.hash *
 * MIST_CELL`: folding in a per-bank hash before the modulus staggers each
 * bank onto its own phase of the 96 m cycle, so they wrap one at a time; the
 * near-boundary fade below still hides the jump itself.
 */
function wrap(v: number): number {
  return ((v + MIST_CELL / 2) % MIST_CELL + MIST_CELL) % MIST_CELL - MIST_CELL / 2;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Fades a bank to invisible as its wrapped offset nears ±MIST_CELL/2, so it
 * dissolves before it would otherwise snap back a cell. */
function wrapFadeAt(offset: number): number {
  return 1 - smoothstep(MIST_CELL / 2 - MIST_WRAP_FADE, MIST_CELL / 2, Math.abs(offset));
}

/**
 * Billboard quad cap by quality tier. `collectMistBanks` always
 * returns up to `MIST_CAP` banks nearest-first, so a lower cap here simply
 * drives fewer of the nearest banks — no change needed in `mistField.ts`.
 */
export const MIST_CAP_BY_TIER: Record<QualityTier, number> = { low: 6, medium: 12, high: 12 };

export type MistMeshes = {
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
    update(camX, camZ, w, air, wind, seconds) {
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
      mat.emissiveColor.set(air.r, air.g, air.b);
      const off = MIST_DRIFT * wind.speed * seconds;
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i] as Mesh;
        const bank = banks[i];
        if (!bank) {
          mesh.setEnabled(false);
          continue;
        }
        const offset = wrap(off + bank.hash * MIST_CELL);
        mesh.position.set(bank.x + offset * wind.dirX, bank.y, bank.z + offset * wind.dirZ);
        mesh.scaling.set(bank.width, bank.height, 1);
        const d = Math.sqrt((bank.x - camX) ** 2 + (bank.z - camZ) ** 2);
        const nearFade = clamp01((d - MIST_NEAR_FADE_START) / MIST_NEAR_FADE_SPAN);
        const edgeFade = clamp01((MIST_RADIUS - d) / MIST_EDGE_FADE_SPAN);
        const wrapFade = wrapFadeAt(offset);
        const visibility = opacity * nearFade * edgeFade * wrapFade;
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
