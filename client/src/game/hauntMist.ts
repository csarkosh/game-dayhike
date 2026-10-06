/**
 * The haunt's mist (docs/gameplay/2026-10-06-the-mist-shades.md): two pale
 * banks that ride at the player's left and right while the haunt is on,
 * the ground the shades stand against. The night's own mist is the sky's
 * dark; this is lit from within, a grey the figures are darker than, as
 * the fog of Silent Hill is. It comes in with the haunt and goes with it.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { mistAlphaMap, MIST_TEX_SIZE } from "./mistField.js";

/** Metres the banks sit to each side of the eye and ahead of it, their size, and their slow sway. */
export const HAUNT_MIST_SIDE = 7;
export const HAUNT_MIST_AHEAD = 5;
export const HAUNT_MIST_SIZE = 16;
export const HAUNT_MIST_SWAY = 1.2;
/** The banks' grey, lit from within, and their opacity at a full haunt. */
export const HAUNT_MIST_GREY = 0.36;
export const HAUNT_MIST_ALPHA = 0.6;

export type HauntMist = {
  /** One frame: the haunt's level (escalation.ts), the night (0 to 1), and the clock the sway rides. */
  update(camera: Camera, haunt: number, night: number, seconds: number): void;
  dispose(): void;
};

export function createHauntMist(scene: Scene): HauntMist {
  const tex = RawTexture.CreateRGBATexture(mistAlphaMap(), MIST_TEX_SIZE, MIST_TEX_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE);
  tex.hasAlpha = true;
  const mat = new StandardMaterial("mat_haunt_mist", scene);
  mat.disableLighting = true;
  mat.opacityTexture = tex;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.emissiveColor = new Color3(HAUNT_MIST_GREY, HAUNT_MIST_GREY, HAUNT_MIST_GREY * 1.05);
  mat.alpha = 0;
  const banks = [-1, 1].map((side) => {
    const mesh = MeshBuilder.CreatePlane(`haunt_mist_${side < 0 ? "left" : "right"}`, { size: HAUNT_MIST_SIZE }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.setEnabled(false);
    return { mesh, side };
  });
  return {
    update(camera, haunt, night, seconds) {
      const level = Math.max(0, Math.min(1, haunt)) * Math.max(0, Math.min(1, night));
      mat.alpha = HAUNT_MIST_ALPHA * level;
      if (level <= 0.002) {
        for (const b of banks) b.mesh.setEnabled(false);
        return;
      }
      const forward = camera.getDirection(new (camera.position.constructor as new (x: number, y: number, z: number) => typeof camera.position)(0, 0, 1));
      const fx = forward.x, fz = forward.z;
      const fl = Math.hypot(fx, fz) || 1;
      const rx = fz / fl, rz = -fx / fl;
      for (const b of banks) {
        const sway = Math.sin(seconds * 0.37 + b.side) * HAUNT_MIST_SWAY;
        b.mesh.position.set(
          camera.position.x + rx * (b.side * HAUNT_MIST_SIDE + sway) + (fx / fl) * HAUNT_MIST_AHEAD,
          camera.position.y + 1,
          camera.position.z + rz * (b.side * HAUNT_MIST_SIDE + sway) + (fz / fl) * HAUNT_MIST_AHEAD,
        );
        b.mesh.setEnabled(true);
      }
    },
    dispose() {
      for (const b of banks) b.mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
