// The pictures as files: a still's PNG read to its pixels, and the sheet that lays two stills and
// their difference side by side.
import sharp from "sharp";
import { difference } from "./score.mjs";

/** The dark gap between the sheet's three panels, in pixels. */
const GAP = 8;

/** A PNG's pixels, red, green and blue: `{ data, width, height, channels: 3 }`. */
export async function pixels(png) {
  const { data, info } = await sharp(png).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** The difference sheet of two pictures of one size (`pixels`' shape): A, B and their absolute
 * difference amplified (`difference`), left to right, as a JPEG's bytes. The chroma is kept at
 * every pixel, so a one-pixel difference keeps its colour. */
export async function sheet(a, b) {
  const { width, height } = a;
  const raw = { width, height, channels: 3 };
  const panels = [a.data, b.data, difference(a.data, b.data, a)];
  return sharp({ create: { width: width * 3 + GAP * 2, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(panels.map((input, i) => ({ input, raw, left: i * (width + GAP), top: 0 })))
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
