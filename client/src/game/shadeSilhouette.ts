/**
 * The soft figure in the mist (docs/gameplay/2026-10-06-the-mist-shades.md):
 * the haunt's shades and lunges are not drawn into the frame as the Hollow
 * is. They are drawn into a mask of their own, a render target of their
 * silhouettes, which the grade pass reads back through a wide blur and
 * darkens the frame by. What the player sees is a dark blur in the mist,
 * the shape of a figure, that comes in from nothing and goes out to
 * nothing. A lunge resolves: as it closes, its share of the mask moves from
 * the red (the shade, a little darker than the mist) to the blue (the real
 * thing, near black), and its eyes alone come onto the frame, dulled; the
 * model's own surface is never drawn.
 *
 * The mask is a render target on a camera of its own that copies the
 * player's every frame and sees only SHADE_LAYER (the main camera does not
 * see that bit). Each shade's meshes are on that layer and, while it
 * resolves, on the main layer too; the mask draws them with a flat material
 * whose red is the shade's softness (fainter far off), blue what has
 * resolved, and green how far gone it is, and the mesh's `visibility` is set
 * for each pass as the target renders and restores after: the mask's alpha
 * is the fade; on the frame the body is nothing and the eyes their level.
 *
 * The low tier has no grade pass: there the shades are the Hollow, fading
 * in and out by `visibility` alone (entityViews.ts).
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";

/** The layer bit the mask's camera sees and the main camera (Babylon's default mask, 0x0FFFFFFF) does not. */
export const SHADE_LAYER = 0x10000000;
/** The main camera's layer, Babylon's default. */
export const MAIN_LAYER = 0x0fffffff;
/** The mask's size as a share of the frame: a blurred figure wants no more. */
export const SHADE_MASK_RATIO = 0.5;

/** One figure in the mask: its node, how far in it is (0 to 1), how soft (1 a blur in the mist, 0 the Hollow itself), and how near (1 close, less far off: a far figure is fainter in the mist). */
/**
 * `gone` is how far a going shade has gone, 0 to 1: the mask's green, which the grade dissolves it by, patch by patch.
 * `eyes` are the meshes that are the figure's eyes, let onto the frame at `eyeLevel` (their glow, dulled) as it resolves; the body never is: the real thing is a darker shadow in the same mask, its blue.
 */
export type ShadeEntry = { node: TransformNode; fade: number; soft: number; near: number; gone: number; eyes: readonly AbstractMesh[]; eyeLevel: number };

export type ShadeSilhouette = {
  /** The mask, for the grade pass to read. */
  readonly texture: RenderTargetTexture;
  /** One frame: the figures to draw into the mask, and which layer each is on. */
  sync(entries: readonly ShadeEntry[]): void;
  /** Whether any figure is in the mask this frame, for the pass to skip its taps when none is. */
  any(): boolean;
  dispose(): void;
};

export function createShadeSilhouette(scene: Scene, camera: Camera): ShadeSilhouette {
  const texture = new RenderTargetTexture("shade_mask", { ratio: SHADE_MASK_RATIO }, scene, {
    generateMipMaps: false,
    samplingMode: Texture.BILINEAR_SAMPLINGMODE,
    generateDepthBuffer: true,
  });
  texture.renderList = [];
  texture.renderParticles = false;
  texture.renderSprites = false;
  texture.clearColor = new Color4(0, 0, 0, 0);
  // The mask's camera: the player's, copied each frame, seeing the shade layer alone.
  const maskCamera = new FreeCamera("shade_mask_cam", new Vector3(0, 0, 0), scene, false);
  maskCamera.layerMask = SHADE_LAYER;
  maskCamera.minZ = camera.minZ;
  maskCamera.maxZ = camera.maxZ;
  texture.activeCamera = maskCamera;
  scene.customRenderTargets.push(texture);

  /** Each figure's flat material for the mask: unlit, its red the softness. */
  const materials = new Map<TransformNode, StandardMaterial>();
  let current: readonly ShadeEntry[] = [];
  let anyNow = false;

  function meshesOf(node: TransformNode): AbstractMesh[] {
    return node.getChildMeshes(false);
  }

  texture.onBeforeRenderObservable.add(() => {
    maskCamera.position.copyFrom(camera.position);
    const rotation = (camera as FreeCamera).rotation;
    if (rotation !== undefined) maskCamera.rotation.copyFrom(rotation);
    maskCamera.fov = camera.fov;
    maskCamera.minZ = camera.minZ;
    maskCamera.maxZ = camera.maxZ;
    for (const e of current) for (const m of meshesOf(e.node)) m.visibility = e.fade;
  });
  texture.onAfterRenderObservable.add(() => {
    for (const e of current) {
      for (const m of meshesOf(e.node)) m.visibility = 0;
      for (const m of e.eyes) m.visibility = e.eyeLevel;
    }
  });

  return {
    texture,
    sync(entries) {
      const list = texture.renderList;
      if (list === null) return;
      // Figures gone since last frame leave the mask and the shade layer.
      const live = new Set(entries.map((e) => e.node));
      for (const [node, material] of materials) {
        if (live.has(node)) continue;
        for (const m of meshesOf(node)) {
          m.layerMask = MAIN_LAYER;
          m.visibility = 1;
          texture.setMaterialForRendering(m, undefined);
          const at = list.indexOf(m);
          if (at >= 0) list.splice(at, 1);
        }
        material.dispose();
        materials.delete(node);
      }
      anyNow = false;
      for (const e of entries) {
        let material = materials.get(e.node);
        if (material === undefined) {
          material = new StandardMaterial(`mat_shade_mask_${materials.size}`, scene);
          material.disableLighting = true;
          material.emissiveColor = new Color3(1, 0, 0);
          material.diffuseColor = new Color3(0, 0, 0);
          material.specularColor = new Color3(0, 0, 0);
          material.backFaceCulling = false;
          materials.set(e.node, material);
          for (const m of meshesOf(e.node)) {
            if (!list.includes(m)) list.push(m);
            texture.setMaterialForRendering(m, material);
          }
        }
        // Red the shade (fainter far off), blue the real thing resolved out of it, green how far gone.
        material.emissiveColor.r = e.soft * e.near;
        material.emissiveColor.g = e.gone;
        material.emissiveColor.b = 1 - e.soft;
        // The body is in the mask alone; the eyes are on the frame too, dulled, as it resolves.
        for (const m of meshesOf(e.node)) {
          m.layerMask = SHADE_LAYER;
          m.visibility = 0;
        }
        for (const m of e.eyes) {
          m.layerMask = SHADE_LAYER | MAIN_LAYER;
          m.visibility = e.eyeLevel;
        }
        if (e.fade > 0) anyNow = true;
      }
      current = entries;
      texture.refreshRate = anyNow ? RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    },
    any() {
      return anyNow;
    },
    dispose() {
      const at = scene.customRenderTargets.indexOf(texture);
      if (at >= 0) scene.customRenderTargets.splice(at, 1);
      for (const material of materials.values()) material.dispose();
      materials.clear();
      texture.dispose();
      maskCamera.dispose();
    },
  };
}
