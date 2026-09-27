import { describe, expect, it } from "vitest";
import { FAINT_LETTER_MIN, WEAR_ALPHA, WEAR_AREA_CAP, knockedOutArea, labelWear, nameHash, type InkBox, type LabelWear } from "../../src/game/labelWear.js";
import { MEADOW_NAMES, POND_NAMES } from "../../src/sim/placeNames.js";

/** A name's ink box in the 1024 x 192 label texture, as the painter measures it. */
const BOX: InkBox = { x: 100, y: 40, width: 500, height: 120 };
const TEXTURE = { width: 1024, height: 192 };
const NAMES = ["Summit", "Trailhead", ...POND_NAMES, ...MEADOW_NAMES].map((n) => n.replace("<First>", "Ada"));

/** Every point a mark reaches: circles by their bounds, scratches by their ends and half their width. */
function reach(w: LabelWear): { x: number; y: number }[] {
  return [
    ...w.patches.flatMap((p) => [{ x: p.x - p.r, y: p.y - p.r }, { x: p.x + p.r, y: p.y + p.r }]),
    ...w.specks.flatMap((s) => [{ x: s.x - s.r, y: s.y - s.r }, { x: s.x + s.r, y: s.y + s.r }]),
    ...w.chips.flatMap((c) => c.points),
    ...w.scratches.flatMap((s) => [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }]),
  ];
}

describe("labelWear", () => {
  it("seeds from a hash of the name", () => {
    expect(nameHash("Summit")).toBe(820770722);
    expect(nameHash("Trailhead")).toBe(1269033433);
    expect(nameHash("")).toBe(0x811c9dc5);
  });

  it("wears the same name the same way every time, and different names differently", () => {
    expect(labelWear("Summit", BOX)).toEqual(labelWear("Summit", BOX));
    const summit = labelWear("Summit", BOX);
    const trailhead = labelWear("Trailhead", BOX);
    expect(summit.alpha).not.toBe(trailhead.alpha);
    expect(summit.specks[0]).not.toEqual(trailhead.specks[0]);
    // Pinned: the Summit's plank.
    expect(+summit.alpha.toFixed(4)).toBe(0.8262);
    expect(summit.letters.map((l) => +l.toFixed(3))).toEqual([0.906, 0.557, 0.944, 0.871, 0.976, 0.987]);
    expect([summit.patches.length, summit.specks.length, summit.chips.length, summit.scratches.length]).toEqual([5, 35, 2, 2]);
    expect(+(knockedOutArea(summit) / (BOX.width * BOX.height)).toFixed(4)).toBe(0.0156);
  });

  it("fades the ink but keeps it dark, with one or two letters well under the rest", () => {
    for (const name of NAMES) {
      const w = labelWear(name, BOX);
      expect(w.alpha, name).toBeGreaterThanOrEqual(WEAR_ALPHA.min);
      expect(w.alpha, name).toBeLessThanOrEqual(WEAR_ALPHA.max);
      expect(w.letters, name).toHaveLength(Array.from(name).length);
      const faint = w.letters.filter((l) => l < 0.86);
      expect(faint.length, name).toBeGreaterThanOrEqual(1);
      expect(faint.length, name).toBeLessThanOrEqual(2);
      for (const l of w.letters) expect(l, name).toBeGreaterThanOrEqual(FAINT_LETTER_MIN);
      // The faintest letter keeps at least 0.78 x 0.5 of full ink.
      expect(Math.min(...w.letters) * w.alpha, name).toBeGreaterThanOrEqual(0.39);
    }
  });

  it("keeps every mark inside the ink box, and so inside the texture", () => {
    expect(BOX.x + BOX.width).toBeLessThanOrEqual(TEXTURE.width);
    expect(BOX.y + BOX.height).toBeLessThanOrEqual(TEXTURE.height);
    for (const name of NAMES) {
      for (const p of reach(labelWear(name, BOX))) {
        expect(p.x, name).toBeGreaterThanOrEqual(BOX.x - 1e-9);
        expect(p.x, name).toBeLessThanOrEqual(BOX.x + BOX.width + 1e-9);
        expect(p.y, name).toBeGreaterThanOrEqual(BOX.y - 1e-9);
        expect(p.y, name).toBeLessThanOrEqual(BOX.y + BOX.height + 1e-9);
      }
    }
  });

  it("knocks out under 12% of the ink box, even on a short name's small box", () => {
    expect(WEAR_AREA_CAP).toBe(0.12);
    for (const box of [BOX, { x: 400, y: 50, width: 60, height: 100 }]) {
      for (const name of NAMES) {
        expect(knockedOutArea(labelWear(name, box)), name).toBeLessThanOrEqual(0.12 * box.width * box.height);
      }
    }
  });
});
