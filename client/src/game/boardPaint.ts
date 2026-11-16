/**
 * The trailhead board's painted face on Babylon.js: the face's picture
 * (`boardDraw.ts`, which paints it and says what it carries) as a texture,
 * and the material that lays it over the board's planks.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { BOARD_TEXTURE } from "./boardFace.js";
import { BOARD_FACE_BIAS, BOARD_FACE_ROUGHNESS, drawBoard, loadBoardImage, whenImagesArrive, type BoardDrawing } from "./boardDraw.js";

// What the face carries and how it is painted are the board's own (`boardDraw.ts`); named from here too.
export { BOARD_FACE_BIAS, BOARD_SHORE_STEP, boardDrawingOf, paperCrop, portraitCrop, whenImagesArrive, wrap } from "./boardDraw.js";
export type { BoardDrawing, BoardSource } from "./boardDraw.js";

export type BoardPainter = (scene: Scene, name: string, drawing: BoardDrawing) => Material;

/** The face's material, without its texture: clear wherever the texture is, and drawn over the planks behind it. */
export function boardMaterial(scene: Scene, name: string): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.useAlphaFromAlbedoTexture = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  // The clear ground must stay clear: no reflection or highlight kept where
  // the alpha is zero, which would lay a sheen over the planks.
  material.useRadianceOverAlpha = false;
  material.useSpecularOverAlpha = false;
  material.backFaceCulling = true;
  // The slope's share of the bias, which is nothing where the face is
  // looked at square on, and the constant share, which holds there.
  material.zOffset = -1;
  material.zOffsetUnits = BOARD_FACE_BIAS;
  material.metallic = 0;
  material.roughness = BOARD_FACE_ROUGHNESS;
  return material;
}

/**
 * The face's material: drawn at once with stand-ins for the paper and the
 * photograph, and drawn again with the images when they arrive. An image
 * that arrives after the texture is disposed is dropped.
 */
export const paintedBoard: BoardPainter = (scene, name, drawing) => {
  // Mipmapped: the board is read from a few metres, where a 2048-wide
  // texture on a 2 m plane is heavily minified and would shimmer without.
  const texture = new DynamicTexture(name, { width: BOARD_TEXTURE.width, height: BOARD_TEXTURE.height }, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  drawBoard(ctx, drawing, { paper: null, portrait: null });
  texture.update(true);
  let disposed = false;
  texture.onDisposeObservable.add(() => {
    disposed = true;
  });
  void whenImagesArrive(drawing.urls, loadBoardImage, () => disposed, (images) => {
    drawBoard(ctx, drawing, images);
    texture.update(true);
  });
  const material = boardMaterial(scene, `${name}_mat`);
  material.albedoTexture = texture;
  return material;
};
