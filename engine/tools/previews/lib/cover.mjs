// The game's cover: one still, shot at the cover's own shape (landscape or portrait, so neither is
// a crop of the other), graded cold and dark, a bank of ground fog laid across it where the title
// sits, the edges sunk in shadow, grain over the whole, and the title in the game's own type (the
// landing page's: a spaced, uppercase monospace in a pale mist white) with a rule and a line under
// it. Nothing is drawn but the light and the words: the place is the game's frame as it renders.
import sharp from "sharp";
import { stripPng } from "./still.mjs";

/** The grade: the picture's saturation, its contrast about mid grey, the cold cast (the red's,
 * the green's and the blue's share) and the fall of its brightness. */
export const GRADE_SATURATION = 0.72;
export const GRADE_CONTRAST = 1.06;
export const GRADE_COLD = [0.93, 0.98, 1.02];
export const GRADE_BRIGHTNESS = 0.97;
/** The vignette: how dark the corners fall, and the share of the half-diagonal it starts at. */
export const VIGNETTE_ALPHA = 0.5;
export const VIGNETTE_START = 0.45;
/** The weight of the sky: a darkening down from the top edge, over this share of the height. */
export const SKY_ALPHA = 0.18;
export const SKY_SHARE = 0.38;
/** The fog bank: its colour, its strongest opacity and its half-height as a share of the cover's
 * height, centred on the title. */
export const FOG = "#c3cbca";
export const FOG_ALPHA = 0.24;
export const FOG_SHARE = 0.3;
/** The grain's strength (its multiply's floor: 1 is none) and its seed. */
export const GRAIN_FLOOR = 0.86;
export const GRAIN_SEED = 14;
/** The type: the family (the landing page's monospace) and its advance (a monospace letter's width
 * as a share of its size), the ink, the title's weight, its size as a share of the cover's shorter
 * side and the most of the width it may span, its letter spacing as a share of its size, and the
 * line's. */
export const FONT = "Menlo, 'SF Mono', 'Courier New', monospace";
export const ADVANCE = 0.602;
export const INK = "#e3e9e8";
export const TITLE_WEIGHT = 400;
export const TITLE_SPAN = 0.8;
export const TITLE_SHARE = 0.135;
export const TITLE_TRACK = 0.3;
export const LINE_SHARE = 0.026;
export const LINE_TRACK = 0.55;

/** XML's five, escaped, so the words are text and never markup. */
function escaped(text) {
  return String(text).replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]);
}

/** Where the title's baseline falls on a cover of `width` by `height`, and its size: `titleAt`
 * is the share of the height down to the title's middle. */
export function titleLayout(width, height, titleAt, letters = 8) {
  const fits = (width * TITLE_SPAN) / (letters * (ADVANCE + TITLE_TRACK));
  const size = Math.round(Math.min(Math.min(width, height) * TITLE_SHARE, fits));
  const centre = Math.round(height * titleAt);
  return { size, centre, baseline: Math.round(centre + size * 0.36) };
}

/**
 * The cover's light and words as SVGs for a cover of `width` by `height`: `shade` (the sky's
 * weight, the fog bank and the vignette, laid over the picture plainly), `grain` (multiplied) and
 * `words` (the title, its rule and its line). `mark` is `{ title, line, titleAt }`; `line` may be
 * absent.
 */
export function coverSvgs(width, height, mark) {
  const { size, centre, baseline } = titleLayout(width, height, mark.titleAt, String(mark.title).length);
  const fogHalf = height * FOG_SHARE;
  const pc = (share) => `${(Math.min(1, Math.max(0, share)) * 100).toFixed(2)}%`;
  // the bank's opacity eased (smoothstep) from nothing at its edges to FOG_ALPHA at the title, so it has no edge
  const fogStops = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const s = 1 - Math.abs(t);
      return `<stop offset="${pc((centre + t * fogHalf) / height)}" stop-color="${FOG}" stop-opacity="${(FOG_ALPHA * s * s * (3 - 2 * s)).toFixed(4)}"/>`;
    })
    .join("");
  const shade = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#05080a" stop-opacity="${SKY_ALPHA}"/><stop offset="${SKY_SHARE}" stop-color="#05080a" stop-opacity="0"/>
</linearGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
${fogStops}
</linearGradient>
<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.71">
<stop offset="${VIGNETTE_START}" stop-color="#030506" stop-opacity="0"/><stop offset="1" stop-color="#030506" stop-opacity="${VIGNETTE_ALPHA}"/>
</radialGradient>
</defs>
<rect width="${width}" height="${height}" fill="url(#sky)"/>
<rect width="${width}" height="${height}" fill="url(#fog)"/>
<rect width="${width}" height="${height}" fill="url(#vignette)"/>
</svg>`;
  const lo = GRAIN_FLOOR;
  const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${GRAIN_SEED}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0 1"/><feComponentTransfer><feFuncR type="table" tableValues="${lo} 1"/><feFuncG type="table" tableValues="${lo} 1"/><feFuncB type="table" tableValues="${lo} 1"/></feComponentTransfer></filter></defs>
<rect width="${width}" height="${height}" filter="url(#grain)"/>
</svg>`;
  const lineSize = Math.max(10, Math.round(Math.min(width, height) * LINE_SHARE));
  const titleText = escaped(String(mark.title).toUpperCase());
  // letter-spacing adds after the last letter too; nudge the centre left by half of it
  const titleNudge = (size * TITLE_TRACK) / 2;
  const lineNudge = (lineSize * LINE_TRACK) / 2;
  const ruleY = baseline + Math.round(size * 0.42);
  const ruleHalf = Math.round(size * 0.9);
  const lineY = ruleY + Math.round(lineSize * 2.1);
  // the rule and the line, drawn in `paint` (the ink, or the halo's dark)
  const lineIn = (paint) =>
    mark.line === undefined
      ? ""
      : `<line x1="${width / 2 - ruleHalf}" y1="${ruleY}" x2="${width / 2 + ruleHalf}" y2="${ruleY}" stroke="${paint}" stroke-opacity="0.7" stroke-width="${Math.max(1, size / 50)}"/>
<text x="${width / 2 + lineNudge}" y="${lineY}" font-family="${FONT}" font-size="${lineSize}" fill="${paint}" fill-opacity="0.92" text-anchor="middle" letter-spacing="${lineSize * LINE_TRACK}">${escaped(String(mark.line).toUpperCase())}</text>`;
  const text = `<text x="${width / 2 + titleNudge}" y="${baseline}" font-family="${FONT}" font-size="${size}" font-weight="${TITLE_WEIGHT}" text-anchor="middle" letter-spacing="${size * TITLE_TRACK}">${titleText}</text>`;
  // a soft dark halo under the words, so they hold over pale fog as over dark trunks
  const words = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<filter id="halo" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="${size * 0.18}"/></filter>
<filter id="haloLine" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="${lineSize * 0.5}"/></filter>
</defs>
<g filter="url(#halo)" opacity="0.55" fill="#05080a">${text}</g>
<g filter="url(#haloLine)" opacity="0.7">${lineIn("#05080a")}</g>
<g fill="${INK}">${text}</g>
${lineIn(INK)}
</svg>`;
  return { shade: Buffer.from(shade), grain: Buffer.from(grain), words: Buffer.from(words) };
}

/**
 * The cover from a still (a PNG's bytes, already the cover's size and shape): graded, shaded,
 * grained and titled, as an opaque PNG with only its image chunks. Deterministic for one still
 * and mark.
 */
export async function cover(still, mark) {
  const { width, height } = await sharp(still).metadata();
  const graded = await sharp(still)
    .removeAlpha()
    .modulate({ saturation: GRADE_SATURATION, brightness: GRADE_BRIGHTNESS })
    .linear(
      GRADE_COLD.map((cold) => GRADE_CONTRAST * cold),
      GRADE_COLD.map((cold) => 128 * (1 - GRADE_CONTRAST * cold)),
    )
    .png()
    .toBuffer();
  const svgs = coverSvgs(width, height, mark);
  const out = await sharp(graded)
    .composite([
      { input: svgs.shade, blend: "over" },
      { input: svgs.grain, blend: "multiply" },
      { input: svgs.words, blend: "over" },
    ])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  return stripPng(out);
}
