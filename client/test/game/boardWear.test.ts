import { describe, expect, it } from "vitest";
import { SHEETS, sheet } from "../../src/game/boardFace.js";
import { SHEET_INK, sheetWear } from "../../src/game/boardWear.js";

describe("sheetWear", () => {
  it("is the same for the same world and sheet, and differs for another world or another sheet", () => {
    const a = sheetWear(2032433950, "poster", sheet("poster").rect);
    expect(sheetWear(2032433950, "poster", sheet("poster").rect)).toEqual(a);
    expect(sheetWear(1, "poster", sheet("poster").rect)).not.toEqual(a);
    expect(sheetWear(2032433950, "rules", sheet("poster").rect)).not.toEqual(a);
  });

  it("wears the poster of the world hollow as it always will", () => {
    const w = sheetWear(2032433950, "poster", sheet("poster").rect);
    expect(w.stain.x).toBeCloseTo(134.8957, 3);
    expect(w.stain.y).toBeCloseTo(330.7305, 3);
    expect(w.stain.r).toBeCloseTo(127.6467, 3);
    expect(w.bleach.corner).toBe(3);
    expect(w.rust).toHaveLength(4);
    expect(w.rust[0]!.run).toBeCloseTo(29.4825, 3);
    expect(w.fades).toHaveLength(3);
    expect(w.ink).toBeCloseTo(0.7629, 3);
  });

  it("keeps every mark inside its sheet and the print strong enough to read, over 500 worlds", () => {
    expect(SHEET_INK).toEqual({ min: 0.62, max: 0.8 });
    for (let seed = 0; seed < 500; seed++) {
      for (const s of SHEETS) {
        const w = sheetWear(seed, s.name, s.rect);
        for (const m of [w.stain, ...w.fades]) {
          expect(m.x - m.r, `seed ${seed} ${s.name}`).toBeGreaterThanOrEqual(-1e-9);
          expect(m.x + m.r, `seed ${seed} ${s.name}`).toBeLessThanOrEqual(s.rect.width + 1e-9);
          expect(m.y - m.r, `seed ${seed} ${s.name}`).toBeGreaterThanOrEqual(-1e-9);
          expect(m.y + m.r, `seed ${seed} ${s.name}`).toBeLessThanOrEqual(s.rect.height + 1e-9);
        }
        expect(w.ink).toBeGreaterThanOrEqual(0.62);
        expect(w.ink).toBeLessThanOrEqual(0.8);
        expect(w.fades.length).toBeGreaterThanOrEqual(3);
        expect(w.fades.length).toBeLessThanOrEqual(5);
        for (const r of w.rust) expect(r.run).toBeLessThanOrEqual(0.07 * s.rect.height + 1e-9);
      }
    }
  });
});
