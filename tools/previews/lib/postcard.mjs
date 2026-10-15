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
/** The postmark's ink: a postal blue-black, not quite opaque, so the picture shows through it. */
export const INK = "#26324a";
export const INK_ALPHA = 0.88;
/** A faint halo of the paper's colour behind the ink, so the mark reads over a dark picture. */
export const HALO_ALPHA = 0.38;
/** The postmark's ring, as a share of the card's width; its ring straddles the paper border at
 * the card's top right, as a cancellation crosses a stamp's edge. */
export const POSTMARK_SHARE = 0.3;
export const POSTMARK_INSET_PX = 6;

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

/** XML's five, escaped, so a title or a name is text in the mark and never markup. */
function escaped(text) {
  return String(text).replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]);
}

/**
 * A postmark as SVG, `size` px across its ring: the title over the top of the ring and the
 * site under its bottom, the author over the year in the middle, and the killer bars, five
 * waves running out to the left as a cancellation does over a stamp, every mark of ink on a
 * faint halo of the paper's colour so it reads over a dark picture. `mark` is
 * `{ title, author, site, year, line }`; `line` is one more line under the year (players, the
 * browser) or absent.
 */
export function postmarkSvg(mark, size) {
  const r = size / 2;
  const bars = size * 0.95;
  const width = size + bars;
  const cx = bars + r;
  const cy = r;
  const stroke = Math.max(2, size * 0.014);
  const ring = r - size * 0.15;
  const textR = r - size * 0.085;
  const font = "'Courier New', Courier, monospace";
  const halo = `paint-order="stroke" stroke="${PAPER}" stroke-opacity="${HALO_ALPHA}" stroke-width="${stroke * 1.6}" stroke-linejoin="round"`;
  const waves = [0.3, 0.4, 0.5, 0.6, 0.7].map((share) => {
    const y = cy - r * 0.5 + r * share * 1.25;
    const amp = size * 0.012;
    const step = size * 0.11;
    let d = `M ${bars - size * 0.08} ${y}`;
    for (let x = bars - size * 0.08; x > size * 0.02; x -= step) d += ` q ${-step / 2} ${-amp} ${-step} 0`;
    return (
      `<path d="${d}" fill="none" stroke="${PAPER}" stroke-opacity="${HALO_ALPHA}" stroke-width="${stroke * 2.4}" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round"/>`
    );
  });
  const upper = (text) => escaped(String(text).toUpperCase());
  // The ring's words, a letter at a time round the circle (the renderer draws no text on a
  // path): the title over the top, read left to right with the letters' feet to the centre, and
  // the site under the bottom, read left to right with their heads to the centre.
  const ringFont = size * 0.068;
  const advance = ringFont * 0.62 + size * 0.01;
  const letters = (text, bottom) => {
    const chars = [...String(text).toUpperCase()];
    const stepDeg = ((advance / textR) * 180) / Math.PI;
    return chars.map((ch, i) => {
      const offset = (i - (chars.length - 1) / 2) * stepDeg;
      const deg = bottom ? 90 - offset : -90 + offset;
      const rad = (deg * Math.PI) / 180;
      const x = cx + textR * Math.cos(rad);
      const y = cy + textR * Math.sin(rad) + (bottom ? -ringFont * 0.36 : ringFont * 0.36);
      return `<text x="${x}" y="${y}" transform="rotate(${bottom ? deg - 90 : deg + 90} ${x} ${y})" font-family="${font}" font-size="${ringFont}" font-weight="bold" fill="${INK}" ${halo} text-anchor="middle">${escaped(ch)}</text>`;
    }).join("");
  };
  const ringText = letters(mark.title, false) + letters(mark.site, true);
  const line = mark.line === undefined ? "" : `<text x="${cx}" y="${cy + size * 0.165}" font-family="${font}" font-size="${size * 0.05}" fill="${INK}" ${halo} text-anchor="middle" letter-spacing="${size * 0.004}">${upper(mark.line)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${width} ${size}">
<g opacity="${INK_ALPHA}">
<circle cx="${cx}" cy="${cy}" r="${r - stroke / 2}" fill="none" stroke="${PAPER}" stroke-opacity="${HALO_ALPHA}" stroke-width="${stroke * 2.6}"/>
<circle cx="${cx}" cy="${cy}" r="${ring}" fill="none" stroke="${PAPER}" stroke-opacity="${HALO_ALPHA}" stroke-width="${stroke * 2}"/>
<circle cx="${cx}" cy="${cy}" r="${r - stroke / 2}" fill="none" stroke="${INK}" stroke-width="${stroke}"/>
<circle cx="${cx}" cy="${cy}" r="${ring}" fill="none" stroke="${INK}" stroke-width="${stroke * 0.6}"/>
${ringText}
<text x="${cx}" y="${cy - size * 0.05}" font-family="${font}" font-size="${size * 0.072}" font-weight="bold" fill="${INK}" ${halo} text-anchor="middle" letter-spacing="${size * 0.006}">${upper(mark.author)}</text>
<text x="${cx}" y="${cy + size * 0.075}" font-family="${font}" font-size="${size * 0.12}" font-weight="bold" fill="${INK}" ${halo} text-anchor="middle" letter-spacing="${size * 0.02}">${upper(mark.year)}</text>
${line}
${waves.join("\n")}
</g>
</svg>`;
}

/**
 * The still (a PNG's bytes) as a postcard: bordered, tilted by `tiltFor(name)`, shadowed, on a
 * transparent ground, as a PNG with only its image chunks. With `mark` (`postmarkSvg`'s), the
 * card is postmarked at its top right before it tilts, as a stamp is cancelled on the card.
 * Deterministic for one still, name and mark.
 */
export async function postcard(still, name, mark) {
  let card = await sharp(still)
    .extend({ top: BORDER_PX, bottom: FOOT_PX, left: BORDER_PX, right: BORDER_PX, background: PAPER })
    .png()
    .toBuffer();
  if (mark !== undefined) {
    const { width } = await sharp(card).metadata();
    const size = Math.round(width * POSTMARK_SHARE);
    const svg = Buffer.from(postmarkSvg(mark, size));
    const { width: markWidth } = await sharp(svg).metadata();
    card = await sharp(card)
      .composite([{ input: svg, left: width - markWidth - POSTMARK_INSET_PX, top: POSTMARK_INSET_PX }])
      .png()
      .toBuffer();
  }
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
