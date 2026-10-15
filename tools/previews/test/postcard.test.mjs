import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MARGIN_PX, TILT_MAX_DEG, TILT_MIN_DEG, postcard, tiltFor } from "../lib/postcard.mjs";

const NAMES = ["trailhead", "forest", "tarn", "meadow", "crest", "beach"];

describe("tiltFor", () => {
  it("leans each still by its name alone, between the least and the most, never flat", () => {
    for (const name of NAMES) {
      const tilt = tiltFor(name);
      expect(tilt).toBe(tiltFor(name));
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(TILT_MIN_DEG);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(TILT_MAX_DEG);
    }
    // the README's six lean both ways
    expect(NAMES.map((name) => Math.sign(tiltFor(name)))).toContain(1);
    expect(NAMES.map((name) => Math.sign(tiltFor(name)))).toContain(-1);
  });
});

function chunks(png) {
  const types = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const length = png.readUInt32BE(at);
    types.push(png.toString("latin1", at + 4, at + 8));
    at += 12 + length;
  }
  return types;
}

describe("postcard", () => {
  it("borders, tilts and shadows the still on a transparent ground, and keeps only the image's chunks", async () => {
    const still = await sharp({ create: { width: 160, height: 90, channels: 3, background: "#406080" } }).png().toBuffer();
    const card = await postcard(still, "tarn");
    const meta = await sharp(card).metadata();
    expect(meta.channels).toBe(4);
    expect(meta.width).toBeGreaterThan(160 + 2 * MARGIN_PX);
    expect(meta.height).toBeGreaterThan(90 + 2 * MARGIN_PX);
    const types = chunks(card);
    expect(types[0]).toBe("IHDR");
    expect(types[types.length - 1]).toBe("IEND");
    expect(new Set(types.filter((t) => t !== "IDAT"))).toEqual(new Set(["IHDR", "IEND"]));
    // the corner is ground, the middle is the still
    const { data, info } = await sharp(card).raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
    expect(at(0, 0)[3]).toBe(0);
    const mid = at(Math.floor(info.width / 2), Math.floor(info.height / 2));
    expect([mid[0], mid[1], mid[2], mid[3]]).toEqual([0x40, 0x60, 0x80, 255]);
    // the same still and name give the same bytes
    expect((await postcard(still, "tarn")).equals(card)).toBe(true);
  });
});
