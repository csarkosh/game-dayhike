/**
 * The size of the frame a hike is drawn into, in the engine's pixels, and
 * when it is sized again.
 *
 * The rule is the game's on Babylon.js, as arithmetic. There the engine's
 * hardware scaling level is set to the tier's (`QUALITY`, by the lighting),
 * which replaces what the display's pixel ratio had made it: the frame is
 * the canvas's box in CSS pixels over the level, whatever the display. The
 * render scale under the paint (`renderScale.ts`) divides the level by its
 * share, so a step down draws fewer pixels into the same box. And when the
 * display's ratio moves while a hike runs (the page zoomed, the window
 * dragged to another display), Babylon multiplies the level by the old ratio
 * over the new, so the frame keeps the pixels it had: the box's CSS pixels
 * have changed by exactly that share.
 *
 * One thing differs from Babylon.js, on purpose: there a step of the render
 * scale sets the level afresh and so forgets a zoom made since the hike
 * began; here the ratio the hike began at is kept for the hike's life.
 *
 * No engine: the canvas's box, the display's ratio and the surface that is
 * sized come in as functions, so the rule runs under Node.
 */
import { QUALITY, type QualityTier } from "./quality.js";
import { createRenderScale, type RenderScale } from "./renderScale.js";

/**
 * The frame's size for a canvas box of `clientWidth` by `clientHeight` CSS
 * pixels: each over the level, cut to a whole pixel as Babylon cuts it. The
 * level is the tier's `hardwareScaling` over the render scale's share, times
 * `ratioChange`: the display's ratio at the hike's start over its ratio now.
 */
export function frameSizeFor(clientWidth: number, clientHeight: number, hardwareScaling: number, renderScale = 1, ratioChange = 1): { width: number; height: number } {
  const level = (hardwareScaling / renderScale) * ratioChange;
  return { width: (clientWidth / level) | 0, height: (clientHeight / level) | 0 };
}

/** What the frame is sized from and what is sized: the canvas's box in CSS pixels, the display's pixel ratio, and the surface. */
export type FrameFitDeps = {
  clientWidth(): number;
  clientHeight(): number;
  ratio(): number;
  /** Sizes the surface, in the engine's pixels. Called only with a size that differs from the last one set. */
  set(width: number, height: number): void;
};

export type FrameFit = {
  /** The render scale now: 1 where the tier has none, or it is held. */
  readonly scale: number;
  /** The size last set, in the engine's pixels; null before the first. */
  readonly size: { width: number; height: number } | null;
  /** Feeds one frame's seconds to the render scale; true when it stepped, and the next `fit` sizes the frame again. */
  frame(seconds: number): boolean;
  /**
   * Sizes the frame where the canvas's box, the display's ratio or the render
   * scale has moved since it was last sized; true when the size changed. A
   * canvas with no box yet (not laid out) is left as it is.
   */
  fit(): boolean;
  /** The next `fit` reads everything again, whatever it last saw. */
  refit(): void;
};

/**
 * The frame's fit for a renderer at `tier`. `scaled` says whether the render
 * scale runs (`renderScaleRuns`); where it does not, the frame is the tier's
 * full size for the renderer's life.
 */
export function createFrameFit(tier: QualityTier, scaled: boolean, deps: FrameFitDeps): FrameFit {
  const hardwareScaling = QUALITY[tier].hardwareScaling;
  const renderScale: RenderScale | null = scaled ? createRenderScale() : null;
  /** The display's ratio when the hike began: the frame keeps its pixels through a zoom made after. */
  let startRatio: number | null = null;
  let seenWidth = -1;
  let seenHeight = -1;
  let seenRatio = -1;
  let seenScale = -1;
  let size: { width: number; height: number } | null = null;
  return {
    get scale() {
      return renderScale?.scale ?? 1;
    },
    get size() {
      return size;
    },
    frame(seconds) {
      return renderScale !== null && renderScale.frame(seconds);
    },
    fit() {
      const width = deps.clientWidth();
      const height = deps.clientHeight();
      const read = deps.ratio();
      const ratio = read > 0 ? read : 1;
      const scale = renderScale?.scale ?? 1;
      if (width === seenWidth && height === seenHeight && ratio === seenRatio && scale === seenScale) return false;
      if (!(width > 0 && height > 0)) return false;
      seenWidth = width;
      seenHeight = height;
      seenRatio = ratio;
      seenScale = scale;
      startRatio ??= ratio;
      const next = frameSizeFor(width, height, hardwareScaling, scale, startRatio / ratio);
      if (!(next.width > 0 && next.height > 0)) return false;
      if (size !== null && size.width === next.width && size.height === next.height) return false;
      size = next;
      deps.set(next.width, next.height);
      return true;
    },
    refit() {
      seenWidth = -1;
    },
  };
}
