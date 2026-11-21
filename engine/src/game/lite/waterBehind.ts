/**
 * The frame behind the water on Babylon Lite: what the surface reads on the
 * tier that draws its water opaque over the frame the opaque draws left:
 * the frame's colour and its depth, kept as the scene's pass is broken
 * before the water.
 *
 * Here the scene's pass is broken by Lite before the meshes marked for it
 * (`enableRenderTaskBreak`, `postChain.ts`), only on a frame that shows one,
 * and what it keeps are the two pictures: the colour as the first half drew
 * it, which is that half's own resolve and so costs no copy, and the depth
 * as stored, one sample a pixel. Lite makes both again whenever the frame's
 * passes are recorded, and builds a marked mesh's bindings after it, so the
 * water's plugins ask for them as they then stand.
 *
 * The colour is read through a sampler of the water's own, filtering and
 * clamped, as the game's copy is read; the depth at a whole texel. Before
 * the pass is first recorded there is neither, and a texel of nothing stands
 * in for each: no draw reads them then.
 */
import { createRenderTexture2D, createTexture2DFromPixels, getGpuDevice, type EngineContext, type RenderTaskBreak, type Texture2D } from "@babylonjs/lite";

/** The kept frame's format: the scene's own, half floats. */
export const BEHIND_FORMAT = "rgba16float";
/** The kept depth's format: the depth as stored, one 32-bit float a pixel. */
export const BEHIND_DEPTH_FORMAT = "r32float";

/** The frame behind the water, as the water's plugins bind it. */
export type WaterBehind = {
  /** The colour the opaque draws left, as it now stands, with the water's sampler. */
  colour(): Texture2D;
  /** The depth the opaque draws left, as it now stands. */
  depth(): Texture2D;
  /** Frames drawn in two halves since it was made. */
  readonly breaks: number;
};

/** What `kept` holds, for the water's plugins to bind. */
export function createWaterBehind(engine: EngineContext, kept: RenderTaskBreak): WaterBehind {
  const sampler = getGpuDevice(engine).createSampler({ label: "water_behind", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear" });
  const noColour: Texture2D = { ...createTexture2DFromPixels(engine, new Uint8Array([0, 0, 0, 255]), 1, 1), sampler };
  const noDepth = createRenderTexture2D(engine, 1, 1, { format: BEHIND_DEPTH_FORMAT, minFilter: "nearest", magFilter: "nearest" });
  let of: Texture2D | null = null;
  let wrapped: Texture2D = noColour;
  return {
    colour() {
      const now = kept.texture;
      if (now === null) return noColour;
      if (now !== of) {
        of = now;
        wrapped = { ...now, sampler };
      }
      return wrapped;
    },
    depth: () => kept.depthTexture ?? noDepth,
    get breaks() {
      return kept.breaks;
    },
  };
}
