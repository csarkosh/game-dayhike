import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MARGIN_PX, STAMP_ASPECT, TILT_MAX_DEG, TILT_MIN_DEG, postcard, stampPicture, stampSvg, tiltFor, wearSvgs } from "../lib/postcard.mjs";

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
    // the still's blue, faded and warmed but still blue, under the grain
    const mid = at(Math.floor(info.width / 2), Math.floor(info.height / 2));
    expect(mid[3]).toBe(255);
    expect(mid[2]).toBeGreaterThan(mid[0]);
    expect(Math.abs(mid[2] - 0x80)).toBeLessThan(40);
    // the same still and name give the same bytes
    expect((await postcard(still, "tarn")).equals(card)).toBe(true);
  });
});

describe("stampSvg", () => {
  const mark = { title: "Day Hike", author: "Cyrus Sarkosh", year: "2026", line: "1 to 5 players" };
  it("carries the title, the author, the line and the year in upper case on a perforated, double-framed stamp", () => {
    const svg = stampSvg(mark, 250);
    for (const word of ["DAY HIKE", "CYRUS SARKOSH", "1 TO 5 PLAYERS", "2026"]) expect(svg).toContain(`>${word}</text>`);
    // the outline three times (the shadow, the paper, its mottle), each with the picture's window, its edges bitten by arcs; the frame twice
    expect(svg.match(/<path d="M /g)).toHaveLength(3);
    expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(3);
    expect(svg.match(/ A /g).length).toBeGreaterThan(40);
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });
  it("escapes the mark's text, so a title is never markup, and leaves the line out when there is none", () => {
    expect(stampSvg({ ...mark, title: "<b>&" }, 250)).toContain(">&lt;B&gt;&amp;</text>");
    expect(stampSvg({ ...mark, line: undefined }, 250)).not.toContain("PLAYERS");
  });
  it("puts the picture between the title and the author, inside the stamp", () => {
    const { side, left, top } = stampPicture(250);
    expect(side).toBe(150);
    expect(left).toBeGreaterThan(8);
    expect(left + side).toBeLessThan(258);
    expect(top).toBeGreaterThan(8 + 11 + 27);
    expect(top + side).toBeLessThan(8 + Math.round(250 * STAMP_ASPECT) - 11 - 40);
  });
  it("sticks the stamp on the card it is asked for, its picture the still's middle, and the same still and mark give the same bytes", async () => {
    // a blue still with a red middle: the red is what the stamp's window shows
    const still = await sharp({ create: { width: 480, height: 270, channels: 3, background: "#406080" } })
      .composite([{ input: await sharp({ create: { width: 160, height: 160, channels: 3, background: "#e03030" } }).png().toBuffer(), left: 160, top: 55 }])
      .png()
      .toBuffer();
    const plain = await postcard(still, "trailhead");
    const marked = await postcard(still, "trailhead", mark);
    expect(marked.equals(plain)).toBe(false);
    expect((await postcard(still, "trailhead", mark)).equals(marked)).toBe(true);
    expect([(await sharp(marked).metadata()).width, (await sharp(marked).metadata()).height]).toEqual([
      (await sharp(plain).metadata()).width,
      (await sharp(plain).metadata()).height,
    ]);
    // the still's red middle shows in the stamp's window: in the top right quarter, reddish pixels
    const { data, info } = await sharp(marked).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let y = 0; y < info.height / 2; y++) for (let x = Math.floor(info.width / 2); x < info.width; x++) {
      const at = (y * info.width + x) * 4;
      if (data[at] > data[at + 2] + 60 && data[at + 3] === 255) red++;
    }
    expect(red).toBeGreaterThan(100);
  });
});

describe("wearSvgs", () => {
  it("gives the grain and the border's foxing to multiply over the card, the grime band and the edge's line to lay over it, and the rounded mask", () => {
    const wear = wearSvgs(400, 300);
    expect(wear.grain.toString().match(/feTurbulence/g)).toHaveLength(2);
    // the foxing's path is the border: the card's rectangle with the picture's cut out
    expect(wear.grain.toString()).toContain('d="M 0 0 h 400 v 300 h -400 Z M 22 22 h 356 v 248 h -356 Z" fill-rule="evenodd" filter="url(#foxing)"');
    expect(wear.marks.toString()).not.toContain("<circle");
    expect(wear.marks.toString().match(/<rect /g)).toHaveLength(2);
    expect(wear.marks.toString()).toContain('filter="url(#band)"');
    expect(wear.mask.toString()).toContain('rx="6"');
  });
});
