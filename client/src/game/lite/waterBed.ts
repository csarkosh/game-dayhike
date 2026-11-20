/**
 * The bed's square on Babylon Lite: the heights of the ground round the
 * world's centre that every body of water reads its depth from, the sea
 * and each lake alike (`bedFollow.ts` follows the camera with no engine;
 * `bedHeight.ts` has the grid). One texture of 32-bit floats, read at a
 * whole texel, sent again whole when the camera's square changes and a body
 * of water can reach the new one, as the game sends it.
 */
import { createRenderTexture2D, updateTextureRegion, type EngineContext, type Texture2D } from "@babylonjs/lite";
import { createBedFollow } from "../bedFollow.js";
import type { BedGrid, BedPond } from "../bedHeight.js";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";

export type LiteWaterBed = {
  /** The heights, one 32-bit float a texel. */
  readonly texture: Texture2D;
  /** The square's texels a side and their spacing (m): the tier's. */
  readonly texels: number;
  readonly spacing: number;
  /** The low corner of the square the texture now holds. */
  readonly originX: number;
  readonly originZ: number;
  /** Times the square was sent: a material that keeps the origin reads it again when this moves. */
  readonly sent: number;
  /** A frame with the world centred at (x, z): the square baked on, and sent when it has changed. */
  step(x: number, z: number): void;
};

/**
 * The bed for `tier` in world `seed`, first filled round (startX, startZ)
 * unless it came baked ahead (`bakedAhead`). `ponds` are the world's lakes
 * and `waterLevel` its sea's.
 */
export function createLiteWaterBed(
  engine: EngineContext, tier: QualityTier, seed: number, ponds: readonly BedPond[], waterLevel: number, startX: number, startZ: number,
  bakedAhead: BedGrid | null, uploads?: FrameUploads,
): LiteWaterBed {
  const bed = createBedFollow(tier, seed, ponds, waterLevel, startX, startZ, bakedAhead);
  const texture = createRenderTexture2D(engine, bed.texels, bed.texels, { format: "r32float", minFilter: "nearest", magFilter: "nearest" });
  const region = { width: bed.texels, height: bed.texels, bytesPerRow: bed.texels * 4 };
  let sent = 0;
  let originX = 0;
  let originZ = 0;
  function send(): void {
    const grid = bed.grid;
    updateTextureRegion(engine, texture, grid.heights, region);
    uploads?.stream("textures", grid.heights.byteLength);
    originX = grid.originX;
    originZ = grid.originZ;
    sent++;
  }
  send();
  return {
    texture,
    texels: bed.texels,
    spacing: bed.spacing,
    get originX() {
      return originX;
    },
    get originZ() {
      return originZ;
    },
    get sent() {
      return sent;
    },
    step(x, z) {
      if (bed.step(x, z)) send();
    },
  };
}
