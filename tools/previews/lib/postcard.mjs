// A README still as a postcard: the frame on a paper-white border, tilted a few degrees one way
// or the other by its name alone, so the same still always lies at the same angle, with a soft
// shadow under it on a transparent ground. The README lays the cards out at different widths and
// sides, like postcards picked up at the trailhead and dropped on a table.
import sharp from "sharp";
import { stripPng } from "./still.mjs";

/** The border's width (px) at the sides and top, and at the foot, where a print's is wider. */
export const BORDER_PX = 22;
export const FOOT_PX = 30;
/** The paper: a warm white, so the card reads as card against GitHub's white and dark pages. */
export const PAPER = "#f4efe6";
/** The tilt's range (degrees): never flat, never past a few degrees. */
export const TILT_MIN_DEG = 1.5;
export const TILT_MAX_DEG = 4;
/** The shadow: its offset (px), its blur and its darkness. */
export const SHADOW_DX = 8;
export const SHADOW_DY = 12;
export const SHADOW_BLUR = 14;
export const SHADOW_ALPHA = 0.5;
/** The transparent margin round the tilted card, room for the shadow. */
export const MARGIN_PX = 36;

/** FNV-1a of the name, so a still's tilt follows its name and nothing else. */
function hashOf(name) {
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** The card's tilt for a still's name, in degrees: TILT_MIN_DEG to TILT_MAX_DEG in size, its
 * sign by the name's hash too, so neighbouring cards lean different ways more often than not. */
export function tiltFor(name) {
  const h = hashOf(name);
  const unit = (h % 10007) / 10006;
  const size = TILT_MIN_DEG + (TILT_MAX_DEG - TILT_MIN_DEG) * unit;
  return ((h >>> 16) & 1) === 0 ? -size : size;
}

/**
 * The still (a PNG's bytes) as a postcard: bordered, tilted by `tiltFor(name)`, shadowed, on a
 * transparent ground, as a PNG with only its image chunks. Deterministic for one still and name.
 */
export async function postcard(still, name) {
  const card = await sharp(still)
    .extend({ top: BORDER_PX, bottom: FOOT_PX, left: BORDER_PX, right: BORDER_PX, background: PAPER })
    .png()
    .toBuffer();
  const tilted = await sharp(card)
    .rotate(tiltFor(name), { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width, height } = await sharp(tilted).metadata();
  // The shadow: the card's own shape, black, blurred, half transparent, laid under it and offset.
  const shadow = await sharp(tilted)
    .ensureAlpha()
    .modulate({ brightness: 0 })
    .blur(SHADOW_BLUR)
    .linear([1, 1, 1, SHADOW_ALPHA], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const out = await sharp({
    create: { width: width + 2 * MARGIN_PX, height: height + 2 * MARGIN_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: shadow, left: MARGIN_PX + SHADOW_DX, top: MARGIN_PX + SHADOW_DY },
      { input: tilted, left: MARGIN_PX, top: MARGIN_PX },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return stripPng(out);
}
