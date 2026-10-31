import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ADVANCE, TITLE_SHARE, TITLE_SPAN, TITLE_TRACK, cover, coverSvgs, titleLayout } from "../lib/cover.mjs";

function chunks(png) {
  const types = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const length = png.readUInt32BE(at);
    types.push(png.toString("latin1", at + 4, at + 8));
    at += 12 + length;
  }
  return types;
}

const mark = { title: "Day Hike", line: "Trail 14", titleAt: 0.4 };

describe("titleLayout", () => {
  it("sizes the title by the cover's shorter side, and narrower where its letters would overrun the width", () => {
    expect(titleLayout(1920, 1080, 0.4).size).toBe(Math.round(1080 * TITLE_SHARE));
    const portrait = titleLayout(1200, 1800, 0.4, 8);
    expect(portrait.size).toBeLessThan(Math.round(1200 * TITLE_SHARE));
    expect(8 * (ADVANCE + TITLE_TRACK) * portrait.size).toBeLessThanOrEqual(1200 * TITLE_SPAN + 8);
  });
  it("centres the title where `titleAt` says, its baseline below that middle", () => {
    const at = titleLayout(1920, 1080, 0.4);
    expect(at.centre).toBe(432);
    expect(at.baseline).toBeGreaterThan(at.centre);
  });
});

describe("coverSvgs", () => {
  it("sets the title and the line uppercase, escaped as text", () => {
    const words = coverSvgs(800, 450, { title: "Day <Hike>", line: "Trail & 14", titleAt: 0.5 }).words.toString();
    expect(words).toContain("DAY &lt;HIKE&gt;");
    expect(words).toContain("TRAIL &amp; 14");
  });
  it("leaves out the rule and the line when there is no line", () => {
    const words = coverSvgs(800, 450, { title: "Day Hike", titleAt: 0.5 }).words.toString();
    expect(words).not.toContain("<line");
  });
});

describe("cover", () => {
  for (const [width, height] of [[320, 180], [200, 300]]) {
    it(`keeps a ${width}x${height} still's size, opaque, with only the image's chunks, the same bytes each time`, async () => {
      const still = await sharp({ create: { width, height, channels: 3, background: "#7a8784" } }).png().toBuffer();
      const out = await cover(still, mark);
      const meta = await sharp(out).metadata();
      expect([meta.width, meta.height, meta.channels]).toEqual([width, height, 3]);
      expect(chunks(out).every((t) => ["IHDR", "IDAT", "IEND"].includes(t))).toBe(true);
      expect((await cover(still, mark)).equals(out)).toBe(true);
    });
  }
});
