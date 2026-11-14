import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { score } from "../lib/score.mjs";
import { pixels, sheet } from "../lib/sheet.mjs";

/** A PNG of one colour, with an alpha as a screenshot's has. */
const png = (width, height, [r, g, b]) => sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();

describe("the pictures as files", () => {
  it("reads a PNG to its red, green and blue as they were written", async () => {
    const p = await pixels(await png(5, 3, [12, 130, 250]));
    expect({ width: p.width, height: p.height, channels: p.channels }).toEqual({ width: 5, height: 3, channels: 3 });
    expect(p.data.length).toBe(5 * 3 * 3);
    expect([...p.data.subarray(0, 3)]).toEqual([12, 130, 250]);
    expect(score(p.data, p.data, p).max).toBe(0);
  });

  it("lays A, B and their difference side by side", async () => {
    const a = await pixels(await png(32, 16, [200, 40, 40]));
    const b = await pixels(await png(32, 16, [40, 40, 200]));
    const out = sharp(await sheet(a, b));
    const meta = await out.metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.height).toBe(16);
    // Three panels and the two gaps between them.
    expect(meta.width).toBe(32 * 3 + 16);
    const { data } = await out.raw().toBuffer({ resolveWithObject: true });
    const at = (x) => [...data.subarray((8 * meta.width + x) * 3, (8 * meta.width + x) * 3 + 3)];
    const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) <= 6);
    expect(near(at(16), [200, 40, 40])).toBe(true);
    expect(near(at(32 + 8 + 16), [40, 40, 200])).toBe(true);
    // 160 apart in red and blue, amplified to the top; green the same in both.
    expect(near(at(2 * (32 + 8) + 16), [255, 0, 255])).toBe(true);
  });
});
