// How far apart two pictures of one view are, as arithmetic on their bytes: no file, no browser.
// A picture here is its raw pixels, row by row, `channels` bytes a pixel (red, green, blue, and an
// alpha that is never scored).

/** The side of the box both pictures are blurred with for `blurMean`, in pixels. */
export const BLUR_SIDE = 9;
/** What the difference picture multiplies each channel's difference by, so a few levels show. */
export const DIFF_GAIN = 8;

function check(a, b, { width, height, channels }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`a picture needs a width and a height, got ${width} by ${height}`);
  if (channels !== 3 && channels !== 4) throw new Error(`a picture has 3 or 4 channels, got ${channels}`);
  const bytes = width * height * channels;
  if (a.length !== bytes || b.length !== bytes) {
    throw new Error(`the pictures are not ${width} by ${height} by ${channels}: ${a.length} and ${b.length} bytes, not ${bytes}`);
  }
}

/**
 * The scores of picture `b` against picture `a`, each `width` by `height`, on the 0..255 scale:
 *
 * - `mean`: the mean absolute difference over every pixel's red, green and blue;
 * - `p99`, `max`: the 99th percentile and the largest of the pixels' differences, a pixel's
 *   difference being its worst channel's;
 * - `over4`, `over16`: the share of pixels (0..1) whose difference is over 4 and over 16;
 * - `blurMean`: `mean` again after both pictures are blurred with a `BLUR_SIDE` box (the window cut
 *   at the picture's edge). An edge drawn a fraction of a pixel aside is a large difference on a
 *   few pixels that the blur averages away; a colour that differs over an area stays what it was.
 *   So a `mean` well above its `blurMean` is edges, and the two alike is colour.
 */
export function score(a, b, size) {
  check(a, b, size);
  const { width, height, channels } = size;
  const pixels = width * height;
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, at = 0; i < pixels; i++, at += channels) {
    const dr = Math.abs(a[at] - b[at]);
    const dg = Math.abs(a[at + 1] - b[at + 1]);
    const db = Math.abs(a[at + 2] - b[at + 2]);
    sum += dr + dg + db;
    histogram[Math.max(dr, dg, db)]++;
  }
  // The percentile: the smallest difference at or under which 99 % of the pixels lie.
  const need = Math.ceil(pixels * 0.99);
  let p99 = 0;
  let max = 0;
  let over4 = 0;
  let over16 = 0;
  for (let d = 0, seen = 0; d < 256; d++) {
    const n = histogram[d];
    if (n === 0) continue;
    if (seen < need) p99 = d;
    seen += n;
    max = d;
    if (d > 4) over4 += n;
    if (d > 16) over16 += n;
  }
  return {
    mean: sum / (pixels * 3),
    p99,
    max,
    over4: over4 / pixels,
    over16: over16 / pixels,
    blurMean: blurredMean(a, b, size),
  };
}

/** The mean absolute difference of the two pictures after the box blur of each. The blur is a sum,
 * so the blurred pictures' difference is the blur of their difference, which is what is summed:
 * one channel at a time, along the rows and then down the columns. */
function blurredMean(a, b, { width, height, channels }) {
  const reach = (BLUR_SIDE - 1) / 2;
  const plane = new Int32Array(width * height);
  const rows = new Int32Array(width * height);
  const prefix = new Int32Array(Math.max(width, height) + 1);
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    for (let i = 0, at = c; i < plane.length; i++, at += channels) plane[i] = a[at] - b[at];
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) prefix[x + 1] = prefix[x] + plane[row + x];
      for (let x = 0; x < width; x++) rows[row + x] = prefix[Math.min(width, x + reach + 1)] - prefix[Math.max(0, x - reach)];
    }
    for (let x = 0; x < width; x++) {
      const across = Math.min(width, x + reach + 1) - Math.max(0, x - reach);
      for (let y = 0; y < height; y++) prefix[y + 1] = prefix[y] + rows[y * width + x];
      for (let y = 0; y < height; y++) {
        const from = Math.max(0, y - reach);
        const to = Math.min(height, y + reach + 1);
        sum += Math.abs(prefix[to] - prefix[from]) / (across * (to - from));
      }
    }
  }
  return sum / (width * height * 3);
}

/** The scores as a row carries them: the means to three places, the shares to five. */
export function rounded(s) {
  const to = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
  return { mean: to(s.mean, 3), blurMean: to(s.blurMean, 3), p99: s.p99, max: s.max, over4: to(s.over4, 5), over16: to(s.over16, 5) };
}

/** The scores as one line's text: `mean 0.412  blur 0.105  p99 6  max 41  >4 1.32 %  >16 0.08 %`. */
export function scoreLine(s) {
  const share = (v) => `${(v * 100).toFixed(2)} %`;
  return `mean ${s.mean.toFixed(3)}  blur ${s.blurMean.toFixed(3)}  p99 ${s.p99}  max ${s.max}  >4 ${share(s.over4)}  >16 ${share(s.over16)}`;
}

/** The picture of the difference: each channel's absolute difference times `gain`, held at 255,
 * three bytes a pixel. Black where the two pictures agree. */
export function difference(a, b, size, gain = DIFF_GAIN) {
  check(a, b, size);
  const { width, height, channels } = size;
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0, at = 0, to = 0; i < width * height; i++, at += channels, to += 3) {
    out[to] = Math.min(255, Math.abs(a[at] - b[at]) * gain);
    out[to + 1] = Math.min(255, Math.abs(a[at + 1] - b[at + 1]) * gain);
    out[to + 2] = Math.min(255, Math.abs(a[at + 2] - b[at + 2]) * gain);
  }
  return out;
}
