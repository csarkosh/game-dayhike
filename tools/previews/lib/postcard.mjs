// A README still as a postcard that has been through the mail: the frame on an aged paper border,
// the picture faded and warmed, grain over the whole card and foxing on its border, a grime band
// creeping in from its edge, its corners rounded, tilted a few degrees one way or the other by its name alone, so
// the same still always lies at the same angle, with a soft shadow under it on a transparent
// ground. The README lays the cards out at different widths and sides, like postcards picked up
// at the trailhead and dropped on a table. One carries a postage stamp, worn the same way.
import sharp from "sharp";
import { stripPng } from "./still.mjs";

/** The border's width (px) at the sides and top, and at the foot, where a print's is wider. */
export const BORDER_PX = 22;
export const FOOT_PX = 30;
/** The paper: an aged warm white, so the card reads as old card against GitHub's white and dark pages. */
export const PAPER = "#ece3cf";
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
/** The picture's fade: its saturation, its contrast about mid grey, the lift under its blacks,
 * the warmth (the green's and the blue's share against the red's) and the softening blur. */
export const FADE_SATURATION = 0.8;
export const FADE_CONTRAST = 0.88;
export const FADE_LIFT = 14;
export const FADE_WARM = [1, 0.975, 0.92];
export const FADE_BLUR = 0.5;
/** The wear over the whole card: the card's corner radius; the grime band creeping in from the
 * edge, its width (px), its colour and its darkness, and the darker line at the very edge; the
 * foxing on the paper border, heavier than the grain over the picture; and the grain's seed. */
export const CORNER_RADIUS_PX = 6;
export const EDGE_BAND_PX = 20;
export const EDGE_COLOUR = "#5e4524";
export const EDGE_ALPHA = 0.28;
export const EDGE_LINE_ALPHA = 0.34;
export const FOXING_ALPHA = 0.55;
export const GRAIN_SEED = 11;
/** The stamp's ink, a postal blue-black, faded, and its paper, yellowed a shade past the card's. */
export const INK = "#2b3650";
export const INK_ALPHA = 0.74;
export const INK_BLUR = 0.45;
export const STAMP_PAPER = "#e9dfc6";
/** The stamp's width as a share of the card's, its picture window's width over its height (a
 * landscape stamp, for a range), its perforation's pitch and hole radius (px at a 250 px stamp,
 * scaled), its inset from the card's top right and its lean (degrees), stuck on a little crooked. */
export const STAMP_SHARE = 0.19;
export const WINDOW_ASPECT = 1.62;
export const PERF_PITCH = 14;
export const PERF_RADIUS = 4.2;
export const STAMP_INSET_PX = 44;
export const STAMP_LEAN_DEG = -3.5;

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
  const holes = (from, length) => {
    const count = Math.floor(length / pitch);
    const first = from + (length - (count - 1) * pitch) / 2;
    return Array.from({ length: count }, (_, i) => first + i * pitch);
  };
  let d = `M ${x} ${y}`;
  for (const c of holes(x, w)) d += ` L ${c - r} ${y} A ${r} ${r} 0 0 0 ${c + r} ${y}`;
  d += ` L ${x + w} ${y}`;
  for (const c of holes(y, h)) d += ` L ${x + w} ${c - r} A ${r} ${r} 0 0 0 ${x + w} ${c + r}`;
  d += ` L ${x + w} ${y + h}`;
  for (const c of holes(x, w).reverse()) d += ` L ${c + r} ${y + h} A ${r} ${r} 0 0 0 ${c - r} ${y + h}`;
  d += ` L ${x} ${y + h}`;
  for (const c of holes(y, h).reverse()) d += ` L ${x} ${c + r} A ${r} ${r} 0 0 0 ${x} ${c - r}`;
  return `${d} Z`;
}

/** Where the stamp's picture goes, at a stamp `width` px across: the window's size and its
 * offset from the stamp's top left, under the title and over the author's line, as wide as the
 * frame allows and WINDOW_ASPECT wide for its height. */
export function stampPicture(width) {
  const k = width / 250;
  const m = Math.round(8 * k);
  const inset = 11 * k;
  const pictureWidth = Math.round(width - 2 * inset - 12 * k);
  const pictureHeight = Math.round(pictureWidth / WINDOW_ASPECT);
  return { width: pictureWidth, height: pictureHeight, left: m + Math.round((width - pictureWidth) / 2), top: m + Math.round(inset + 32 * k) };
}

/** The stamp's height at a stamp `width` px across: the title's band, the picture and the
 * author's band with the bottom row, inside the frame's insets. */
export function stampHeight(width) {
  const k = width / 250;
  const picture = stampPicture(width);
  return Math.round(11 * k + 32 * k + picture.height + 40 * k + 11 * k);
}

/**
 * A postage stamp as SVG, `width` px across and `stampHeight` high: perforated paper with a
 * window where the picture goes (`stampPicture`, the picture laid under it), a double frame, the
 * title over the picture, the author under it, and a bottom row with the line at the left and
 * the year at the right as the denomination. The ink is faded and a little soft, and the paper mottled,
 * as old mail is. `mark` is `{ title, author, year, line }`; `line` may be absent.
 */
export function stampSvg(mark, width) {
  const k = width / 250;
  const height = stampHeight(width);
  const m = Math.round(8 * k);
  const pitch = PERF_PITCH * k;
  const r = PERF_RADIUS * k;
  const font = "'Courier New', Courier, monospace";
  const upper = (text) => escaped(String(text).toUpperCase());
  const outline = perforated(m, m, width, height, pitch, r);
  const picture = stampPicture(width);
  const window = `M ${picture.left} ${picture.top} h ${picture.width} v ${picture.height} h ${-picture.width} Z`;
  const inset = 11 * k;
  const line = mark.line === undefined ? "" : `<text x="${m + inset + 7 * k}" y="${m + height - inset - 8 * k}" font-family="${font}" font-size="${9.5 * k}" fill="${INK}" text-anchor="start">${upper(mark.line)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + 2 * m}" height="${height + 2 * m}" viewBox="0 0 ${width + 2 * m} ${height + 2 * m}">
<defs>
<filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${INK_BLUR * k}"/></filter>
<filter id="mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${0.06 / k}" numOctaves="3" seed="${GRAIN_SEED}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0.18 0 0 0 0.82  0 0.18 0 0 0.79  0 0 0.24 0 0.7  0 0 0 0 1"/></filter>
</defs>
<path d="${outline} ${window}" fill-rule="evenodd" fill="#000" fill-opacity="0.22" transform="translate(${2 * k} ${3 * k})"/>
<path d="${outline} ${window}" fill-rule="evenodd" fill="${STAMP_PAPER}"/>
<path d="${outline} ${window}" fill-rule="evenodd" filter="url(#mottle)" style="mix-blend-mode:multiply" opacity="0.6"/>
<g opacity="${INK_ALPHA}" filter="url(#soft)">
<rect x="${m + inset}" y="${m + inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" fill="none" stroke="${INK}" stroke-width="${1.8 * k}"/>
<rect x="${m + inset + 3.5 * k}" y="${m + inset + 3.5 * k}" width="${width - 2 * inset - 7 * k}" height="${height - 2 * inset - 7 * k}" fill="none" stroke="${INK}" stroke-width="${0.8 * k}"/>
<text x="${m + width / 2}" y="${m + inset + 27 * k}" font-family="${font}" font-size="${21 * k}" font-weight="bold" fill="${INK}" text-anchor="middle" letter-spacing="${2.5 * k}">${upper(mark.title)}</text>
<text x="${m + width / 2}" y="${m + height - inset - 24 * k}" font-family="${font}" font-size="${12.5 * k}" font-weight="bold" fill="${INK}" text-anchor="middle" letter-spacing="${1 * k}">${upper(mark.author)}</text>
${line}
<text x="${m + width - inset - 7 * k}" y="${m + height - inset - 8 * k}" font-family="${font}" font-size="${13 * k}" font-weight="bold" fill="${INK}" text-anchor="end">${upper(mark.year)}</text>
</g>
</svg>`;
}

/** The wear over a whole card of `width` by `height`, as SVGs: the grain and foxing to lay over
 * it multiplied (the foxing heavier on the paper border round the picture than over the picture),
 * the grime band and the dark line at the edge to lay over it plainly, and the rounded mask. */
export function wearSvgs(width, height) {
  const photo = { left: BORDER_PX, top: BORDER_PX, width: width - 2 * BORDER_PX, height: height - BORDER_PX - FOOT_PX };
  const border = `M 0 0 h ${width} v ${height} h ${-width} Z M ${photo.left} ${photo.top} h ${photo.width} v ${photo.height} h ${-photo.width} Z`;
  const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="4" seed="${GRAIN_SEED}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0.14 0 0 0 0.86  0 0.14 0 0 0.85  0 0 0.2 0 0.8  0 0 0 0 1"/></filter>
<filter id="foxing" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="${GRAIN_SEED + 1}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0.45 0 0 0 0.62  0 0.4 0 0 0.6  0 0 0.3 0 0.5  0 0 0 0 1"/></filter>
</defs>
<rect width="${width}" height="${height}" filter="url(#grain)"/>
<path d="${border}" fill-rule="evenodd" filter="url(#foxing)" opacity="${FOXING_ALPHA}"/>
</svg>`;
  const marks = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><filter id="band" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${EDGE_BAND_PX / 3}"/></filter></defs>
<rect x="${-EDGE_BAND_PX / 2}" y="${-EDGE_BAND_PX / 2}" width="${width + EDGE_BAND_PX}" height="${height + EDGE_BAND_PX}" fill="none" stroke="${EDGE_COLOUR}" stroke-opacity="${EDGE_ALPHA}" stroke-width="${EDGE_BAND_PX * 2}" filter="url(#band)"/>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="${EDGE_COLOUR}" stroke-opacity="${EDGE_LINE_ALPHA}" stroke-width="3"/>
</svg>`;
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${CORNER_RADIUS_PX}" fill="#fff"/></svg>`;
  return { grain: Buffer.from(grain), marks: Buffer.from(marks), mask: Buffer.from(mask) };
}

/**
 * The still (a PNG's bytes) as a postcard that has been through the mail: faded, bordered,
 * worn, tilted by `tiltFor(name)`, shadowed, on a transparent ground, as a PNG with only its
 * image chunks. With `mark` (`stampSvg`'s, and `picture`, a PNG's bytes, the still the stamp
 * shows, which fills its window whole, cropped only to the window's shape; the card's own still
 * without it), a postage stamp is stuck at the card's top right before the wear and the tilt.
 * Deterministic for one still, name and mark.
 */
export async function postcard(still, name, mark) {
  const faded = await sharp(still)
    .modulate({ saturation: FADE_SATURATION })
    .linear(
      FADE_WARM.map((warm) => FADE_CONTRAST * warm),
      FADE_WARM.map((warm) => 128 * (1 - FADE_CONTRAST * warm) + FADE_LIFT),
    )
    .blur(FADE_BLUR)
    .png()
    .toBuffer();
  let card = await sharp(faded)
    .extend({ top: BORDER_PX, bottom: FOOT_PX, left: BORDER_PX, right: BORDER_PX, background: PAPER })
    .png()
    .toBuffer();
  const { width, height } = await sharp(card).metadata();
  if (mark !== undefined) {
    const stampWidth = Math.round(width * STAMP_SHARE);
    const svg = Buffer.from(stampSvg(mark, stampWidth));
    const { width: svgWidth, height: svgHeight } = await sharp(svg).metadata();
    const picture = stampPicture(stampWidth);
    // the stamp's picture: the still it was given (the card's own without one), filling the
    // window whole, cropped to the window's shape about its middle, faded further
    const cut = await sharp(mark.picture ?? still)
      .resize(picture.width, picture.height, { fit: "cover", position: "centre" })
      .modulate({ saturation: 0.55, brightness: 1.04 })
      .blur(0.6)
      .png()
      .toBuffer();
    const stamp = await sharp({ create: { width: svgWidth, height: svgHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cut, left: picture.left, top: picture.top }, { input: svg, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const leaned = await sharp(stamp).rotate(STAMP_LEAN_DEG, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const { width: leanedWidth } = await sharp(leaned).metadata();
    card = await sharp(card).composite([{ input: leaned, left: width - leanedWidth - STAMP_INSET_PX, top: STAMP_INSET_PX }]).png().toBuffer();
  }
  const wear = wearSvgs(width, height);
  card = await sharp(card)
    .composite([
      { input: wear.grain, blend: "multiply" },
      { input: wear.marks, blend: "over" },
      { input: wear.mask, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
  const tilted = await sharp(card)
    .rotate(tiltFor(name), { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const tiltedMeta = await sharp(tilted).metadata();
  // The shadow: the card's own shape, black, blurred, half transparent, laid under it and offset.
  const shadow = await sharp(tilted)
    .ensureAlpha()
    .modulate({ brightness: 0 })
    .blur(SHADOW_BLUR)
    .linear([1, 1, 1, SHADOW_ALPHA], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const out = await sharp({
    create: { width: tiltedMeta.width + 2 * MARGIN_PX, height: tiltedMeta.height + 2 * MARGIN_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: shadow, left: MARGIN_PX + SHADOW_DX, top: MARGIN_PX + SHADOW_DY },
      { input: tilted, left: MARGIN_PX, top: MARGIN_PX },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return stripPng(out);
}
