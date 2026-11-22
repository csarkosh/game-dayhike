import { describe, expect, it } from "vitest";
import { BLUR_SIDE, DIFF_GAIN, difference, rounded, score, scoreLine } from "../lib/score.mjs";

/** A picture of one colour, `channels` bytes a pixel. */
function flat(width, height, [r, g, b], channels = 3) {
  const data = Buffer.alloc(width * height * channels, 255);
  for (let i = 0; i < width * height; i++) data.set([r, g, b], i * channels);
  return data;
}

/** `data` with the pixel at (x, y) set. */
function withPixel(data, width, x, y, [r, g, b], channels = 3) {
  const out = Buffer.from(data);
  out.set([r, g, b], (y * width + x) * channels);
  return out;
}

describe("score", () => {
  it("scores a picture against itself as nothing", () => {
    const size = { width: 12, height: 10, channels: 3 };
    const a = flat(12, 10, [40, 90, 200]);
    expect(score(a, a, size)).toEqual({ mean: 0, p99: 0, max: 0, over4: 0, over16: 0, blurMean: 0 });
  });

  it("scores a colour that differs everywhere the same before and after the blur", () => {
    const size = { width: 20, height: 15, channels: 3 };
    const s = score(flat(20, 15, [100, 100, 100]), flat(20, 15, [103, 100, 94]), size);
    // 3, 0 and 6 a pixel: a mean of 3 a channel, the pixel's difference its worst channel's.
    expect(s.mean).toBeCloseTo(3, 10);
    expect(s.blurMean).toBeCloseTo(3, 10);
    expect(s.p99).toBe(6);
    expect(s.max).toBe(6);
    expect(s.over4).toBe(1);
    expect(s.over16).toBe(0);
  });

  it("averages one stray pixel away under the blur", () => {
    const width = 30;
    const height = 30;
    const size = { width, height, channels: 3 };
    const a = flat(width, height, [50, 50, 50]);
    const b = withPixel(a, width, 15, 15, [140, 50, 50]);
    const s = score(a, b, size);
    expect(s.mean).toBeCloseTo(90 / (width * height * 3), 10);
    expect(s.max).toBe(90);
    // One pixel in 900 is under the 99th percentile.
    expect(s.p99).toBe(0);
    expect(s.over4).toBeCloseTo(1 / 900, 10);
    expect(s.over16).toBeCloseTo(1 / 900, 10);
    // Away from the edge the blur spreads the pixel over its box and loses none of it.
    expect(s.blurMean).toBeCloseTo(s.mean, 10);
  });

  it("tells an edge drawn a pixel aside from a colour: the blur takes most of the edge's difference", () => {
    const width = 40;
    const height = 20;
    const size = { width, height, channels: 3 };
    // Thin bright lines three pixels apart, and the same lines one pixel to the right.
    const lines = (shift) => {
      const data = flat(width, height, [0, 0, 0]);
      for (let y = 0; y < height; y++) for (let x = shift; x < width; x += 3) data.set([240, 240, 240], (y * width + x) * 3);
      return data;
    };
    const s = score(lines(0), lines(1), size);
    expect(s.mean).toBeGreaterThan(100);
    expect(s.blurMean).toBeLessThan(s.mean / 10);
    expect(s.over16).toBeGreaterThan(0.6);
  });

  it("puts the 99th percentile at the smallest difference 99 % of the pixels are within", () => {
    const width = 100;
    const height = 1;
    const size = { width, height, channels: 3 };
    const a = flat(width, height, [10, 10, 10]);
    // Two pixels in a hundred off by 30, the rest by 2: the 99th falls on the 30s.
    let b = flat(width, height, [12, 10, 10]);
    b = withPixel(b, width, 0, 0, [40, 10, 10]);
    b = withPixel(b, width, 99, 0, [10, 10, 40]);
    const two = score(a, b, size);
    expect(two.p99).toBe(30);
    expect(two.max).toBe(30);
    expect(two.over4).toBeCloseTo(0.02, 10);
    // One pixel in a hundred: 99 % are within 2.
    const one = score(a, withPixel(flat(width, height, [12, 10, 10]), width, 0, 0, [40, 10, 10]), size);
    expect(one.p99).toBe(2);
    expect(one.max).toBe(30);
  });

  it("counts over 4 and over 16 strictly", () => {
    const size = { width: 4, height: 1, channels: 3 };
    const a = flat(4, 1, [0, 0, 0]);
    let b = flat(4, 1, [4, 0, 0]);
    b = withPixel(b, 4, 1, 0, [0, 5, 0]);
    b = withPixel(b, 4, 2, 0, [0, 0, 16]);
    b = withPixel(b, 4, 3, 0, [17, 0, 0]);
    const s = score(a, b, size);
    expect(s.over4).toBe(0.75);
    expect(s.over16).toBe(0.25);
  });

  it("cuts the blur's box at the picture's edge", () => {
    // A picture smaller than the box: every pixel's box is the whole picture, so the blurred
    // difference is the picture's mean difference at every pixel.
    const side = BLUR_SIDE - 5;
    const size = { width: side, height: side, channels: 3 };
    const a = flat(side, side, [0, 0, 0]);
    const b = withPixel(a, side, 0, 0, [160, 0, 0]);
    expect(score(a, b, size).blurMean).toBeCloseTo(160 / (side * side) / 3, 10);
  });

  it("lets differences of opposite sign cancel under the blur, and only there", () => {
    const size = { width: 9, height: 9, channels: 3 };
    const a = flat(9, 9, [100, 100, 100]);
    // A checkerboard of +20 and -20 round the same grey.
    const b = Buffer.from(a);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) b.fill(100 + ((x + y) % 2 === 0 ? 20 : -20), (y * 9 + x) * 3, (y * 9 + x) * 3 + 3);
    const s = score(a, b, size);
    expect(s.mean).toBeCloseTo(20, 10);
    expect(s.blurMean).toBeLessThan(5);
  });

  it("never scores the alpha", () => {
    const size = { width: 6, height: 6, channels: 4 };
    const a = flat(6, 6, [10, 20, 30], 4);
    const b = flat(6, 6, [10, 20, 31], 4);
    for (let i = 0; i < 36; i++) b[i * 4 + 3] = 0;
    const s = score(a, b, size);
    expect(s.mean).toBeCloseTo(1 / 3, 10);
    expect(s.max).toBe(1);
  });

  it("refuses pictures that are not the size it is told", () => {
    const a = flat(4, 4, [0, 0, 0]);
    expect(() => score(a, flat(4, 3, [0, 0, 0]), { width: 4, height: 4, channels: 3 })).toThrow(/not 4 by 4 by 3/);
    expect(() => score(a, a, { width: 4, height: 4, channels: 2 })).toThrow(/3 or 4 channels/);
    expect(() => score(a, a, { width: 0, height: 4, channels: 3 })).toThrow(/width and a height/);
  });
});

describe("difference", () => {
  it("draws each channel's difference amplified, held at 255, black where the pictures agree", () => {
    const size = { width: 2, height: 1, channels: 4 };
    const a = Buffer.from([10, 10, 10, 255, 0, 0, 0, 255]);
    const b = Buffer.from([13, 10, 9, 255, 200, 0, 0, 0]);
    expect([...difference(a, b, size)]).toEqual([3 * DIFF_GAIN, 0, DIFF_GAIN, 255, 0, 0]);
    expect([...difference(a, a, size)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...difference(a, b, size, 1)]).toEqual([3, 0, 1, 200, 0, 0]);
  });
});

describe("a row's scores", () => {
  it("rounds the means to three places and the shares to five, and writes them as one line", () => {
    const s = rounded({ mean: 0.41234567, blurMean: 0.1049, p99: 6, max: 41, over4: 0.0131956, over16: 0.00081234 });
    expect(s).toEqual({ mean: 0.412, blurMean: 0.105, p99: 6, max: 41, over4: 0.0132, over16: 0.00081 });
    expect(scoreLine(s)).toBe("mean 0.412  blur 0.105  p99 6  max 41  >4 1.32 %  >16 0.08 %");
  });
});
