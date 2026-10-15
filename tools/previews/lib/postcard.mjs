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
/** The stamp's ink, a postal blue-black, and its paper, a shade whiter than the card's. */
export const INK = "#26324a";
export const STAMP_PAPER = "#faf7f0";
/** The stamp's width as a share of the card's, its height over its width, its perforation's
 * pitch and hole radius (px at a 250 px stamp, scaled), and its inset from the card's top right. */
export const STAMP_SHARE = 0.2;
export const STAMP_ASPECT = 1.22;
export const PERF_PITCH = 14;
export const PERF_RADIUS = 4.2;
export const STAMP_INSET_PX = 40;
/** The share of the icon's canvas its art fills (`branding/dayhike.svg`: a tile in the middle
 * of a square, its glow round it), so the picture shows the art. */
export const ICON_ART = 0.42;

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

/** XML's five, escaped, so a title or a name is text on the stamp and never markup. */
function escaped(text) {
  return String(text).replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]);
}

/** A perforated edge's path, the rectangle at (x, y) of w by h with half-round holes bitten out
 * of every edge, `pitch` apart, `r` across: a postage stamp's outline. */
function perforated(x, y, w, h, pitch, r) {
  const edge = (from, to, along, across) => {
    // the holes along one edge, from `from` to `to` on the `along` axis at `across` on the other
    const length = to - from;
    const count = Math.floor(length / pitch);
    const first = from + (length - (count - 1) * pitch) / 2;
    let d = "";
    for (let i = 0; i < count; i++) {
      const c = first + i * pitch;
      const a = along === "x" ? `${c - r} ${across}` : `${across} ${c - r}`;
      const b = along === "x" ? `${c + r} ${across}` : `${across} ${c + r}`;
      d += ` L ${a} A ${r} ${r} 0 0 0 ${b}`;
    }
    return d;
  };
  // clockwise round the stamp, each edge's holes bitten inward (the arcs sweep through the inside)
  let d = `M ${x} ${y}`;
  d += edge(x, x + w, "x", y);
  d += ` L ${x + w} ${y}`;
  d += edge(y, y + h, "y", x + w).replace(/A (\S+) (\S+) 0 0 0/g, "A $1 $2 0 0 0");
  d += ` L ${x + w} ${y + h}`;
  // along the bottom and the left the holes are met in the other direction, so their sweep flips
  let bottom = "";
  {
    const length = w; const count = Math.floor(length / pitch); const first = x + (length - (count - 1) * pitch) / 2;
    for (let i = count - 1; i >= 0; i--) { const c = first + i * pitch; bottom += ` L ${c + r} ${y + h} A ${r} ${r} 0 0 0 ${c - r} ${y + h}`; }
  }
  d += bottom + ` L ${x} ${y + h}`;
  let left = "";
  {
    const length = h; const count = Math.floor(length / pitch); const first = y + (length - (count - 1) * pitch) / 2;
    for (let i = count - 1; i >= 0; i--) { const c = first + i * pitch; left += ` L ${x} ${c + r} A ${r} ${r} 0 0 0 ${x} ${c - r}`; }
  }
  d += left + " Z";
  return d;
}

/**
 * A postage stamp as SVG, `width` px across: perforated paper, a double frame, the title over
 * the picture (the icon, composited by `postcard` where `stampPicture` says), the author under
 * it, and a bottom row with the line at the left and the year at the right as the
 * denomination. `mark` is `{ title, author, year, line }`; `line` may be absent.
 */
export function stampSvg(mark, width) {
  const k = width / 250;
  const height = Math.round(width * STAMP_ASPECT);
  const m = Math.round(8 * k);
  const pitch = PERF_PITCH * k;
  const r = PERF_RADIUS * k;
  const font = "'Courier New', Courier, monospace";
  const upper = (text) => escaped(String(text).toUpperCase());
  const outline = perforated(m, m, width, height, pitch, r);
  const inset = 11 * k;
  const line = mark.line === undefined ? "" : `<text x="${m + inset + 7 * k}" y="${m + height - inset - 8 * k}" font-family="${font}" font-size="${9.5 * k}" fill="${INK}" text-anchor="start">${upper(mark.line)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 2 * m}" height="${height + 2 * m}" viewBox="0 0 ${width + 2 * m} ${height + 2 * m}">
<path d="${outline}" fill="#000" fill-opacity="0.22" transform="translate(${2 * k} ${3 * k})"/>
<path d="${outline}" fill="${STAMP_PAPER}"/>
<rect x="${m + inset}" y="${m + inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" fill="none" stroke="${INK}" stroke-width="${1.8 * k}"/>
<rect x="${m + inset + 3.5 * k}" y="${m + inset + 3.5 * k}" width="${width - 2 * inset - 7 * k}" height="${height - 2 * inset - 7 * k}" fill="none" stroke="${INK}" stroke-width="${0.8 * k}"/>
<text x="${m + width / 2}" y="${m + inset + 27 * k}" font-family="${font}" font-size="${21 * k}" font-weight="bold" fill="${INK}" text-anchor="middle" letter-spacing="${2.5 * k}">${upper(mark.title)}</text>
<text x="${m + width / 2}" y="${m + height - inset - 24 * k}" font-family="${font}" font-size="${12.5 * k}" font-weight="bold" fill="${INK}" text-anchor="middle" letter-spacing="${1 * k}">${upper(mark.author)}</text>
${line}
<text x="${m + width - inset - 7 * k}" y="${m + height - inset - 8 * k}" font-family="${font}" font-size="${13 * k}" font-weight="bold" fill="${INK}" text-anchor="end">${upper(mark.year)}</text>
</svg>`;
}

/** Where the stamp's picture goes, at a stamp `width` px across: the square's side and its
 * offset from the stamp's top left, between the title and the author. */
export function stampPicture(width) {
  const k = width / 250;
  const height = Math.round(width * STAMP_ASPECT);
  const m = Math.round(8 * k);
  const side = Math.round(width * 0.6);
  return { side, left: m + Math.round((width - side) / 2), top: m + Math.round(11 * k + 40 * k + ((height - 22 * k - 40 * k - 40 * k) - side) / 2) };
}

/**
 * The still (a PNG's bytes) as a postcard: bordered, tilted by `tiltFor(name)`, shadowed, on a
 * transparent ground, as a PNG with only its image chunks. With `mark` (`stampSvg`'s, and
 * `icon`, an SVG's bytes for its picture), a postage stamp is stuck at the card's top right
 * before it tilts. Deterministic for one still, name and mark.
 */
export async function postcard(still, name, mark) {
  let card = await sharp(still)
    .extend({ top: BORDER_PX, bottom: FOOT_PX, left: BORDER_PX, right: BORDER_PX, background: PAPER })
    .png()
    .toBuffer();
  if (mark !== undefined) {
    const { width } = await sharp(card).metadata();
    const stampWidth = Math.round(width * STAMP_SHARE);
    const svg = Buffer.from(stampSvg(mark, stampWidth));
    const { width: svgWidth } = await sharp(svg).metadata();
    const left = width - svgWidth - STAMP_INSET_PX;
    const top = STAMP_INSET_PX;
    const picture = stampPicture(stampWidth);
    const layers = [{ input: svg, left, top }];
    if (mark.icon !== undefined) {
      // The icon's art fills ICON_ART of its canvas, the rest its glow's room: drawn at the size
      // that makes the art the picture, then the picture cut from its middle.
      const drawn = Math.round(picture.side / ICON_ART);
      const cut = Math.round((drawn - picture.side) / 2);
      const icon = await sharp(mark.icon)
        .resize(drawn, drawn)
        .extract({ left: cut, top: cut, width: picture.side, height: picture.side })
        .png()
        .toBuffer();
      layers.push({ input: icon, left: left + picture.left, top: top + picture.top });
    }
    card = await sharp(card).composite(layers).png().toBuffer();
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
