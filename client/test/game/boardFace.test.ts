import { describe, expect, it } from "vitest";
import { BOARD_FACE, BOARD_TEXTURE, DISTANCE, SHEETS, TITLE, boardText, miles, sheet, sheetCentre } from "../../src/game/boardFace.js";

describe("the board's face", () => {
  it("is twice as wide as tall, on the texture and on the board", () => {
    expect(BOARD_TEXTURE).toEqual({ width: 2048, height: 1024 });
    expect(BOARD_FACE).toEqual({ width: 2, height: 1, centreY: 1.37, front: 0.159 });
  });

  it("lays the map over the left half, the poster and the rules to its right, a torn corner below", () => {
    expect(SHEETS.map((s) => s.name)).toEqual(["torn", "map", "poster", "rules"]);
    expect(sheet("map").rect).toMatchObject({ x: 72, y: 236, width: 1024, height: 748 });
    expect(sheet("poster").rect).toMatchObject({ x: 1167, y: 246, width: 451, height: 635 });
    expect(sheet("rules").rect).toMatchObject({ x: 1659, y: 276, width: 338, height: 532 });
    expect(sheet("torn").rect).toMatchObject({ x: 1229, y: 901, width: 123, height: 72 });
    expect(sheet("map").rect.turn).toBeCloseTo(-0.006981317007977318, 12);
    expect(sheet("poster").rect.turn).toBeCloseTo(0.020943951023931952, 12);
    expect(sheet("torn").staples).toBe(false);
    expect(sheet("poster").staples).toBe(true);
  });

  it("keeps every sheet on the face and below the routed lines", () => {
    for (const s of SHEETS) {
      expect(s.rect.x, s.name).toBeGreaterThanOrEqual(0);
      expect(s.rect.x + s.rect.width, s.name).toBeLessThanOrEqual(2048);
      expect(s.rect.y, s.name).toBeGreaterThanOrEqual(200);
      expect(s.rect.y + s.rect.height, s.name).toBeLessThanOrEqual(1024);
    }
    expect(TITLE).toEqual({ centreX: 1024, centreY: 87, height: 102 });
    expect(DISTANCE).toEqual({ centreX: 1024, centreY: 179, height: 41 });
  });

  it("puts the poster's centre 0.36 m right of the face's and 1.32 m above the board's foot", () => {
    const c = sheetCentre("poster");
    expect(c.along).toBeCloseTo(0.36, 2);
    expect(c.height).toBeCloseTo(1.32, 2);
    expect(sheetCentre("map").along).toBeCloseTo(-0.43, 2);
  });

  it("refuses a sheet it does not have", () => {
    expect(() => sheet("notice" as never)).toThrow();
  });
});

describe("the board's words", () => {
  it("reads a trail's length in miles", () => {
    expect(miles(1274)).toBe("0.8");
    expect(miles(1609.344)).toBe("1.0");
    expect(miles(3300)).toBe("2.1");
    expect(miles(100)).toBe("0.1");
    expect(miles(0)).toBe("0.1");
    expect(miles(16093.44)).toBe("10.0");
  });

  it("says everything the board says", () => {
    expect(boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274)).toEqual({
      title: "TRAIL 14",
      distance: "SUMMIT 0.8 MI",
      mapHeading: "TRAIL 14 · TRAILS",
      poster: { title: "MISSING", name: "Hugh Kowalski", lines: ["Last seen at Trail 14.", "If you have seen them, call the ranger station."] },
      rules: {
        heading: "BEFORE YOU GO",
        lines: ["STAY ON THE TRAIL", "BE OFF THE MOUNTAIN BY DARK", "PACK IT IN, PACK IT OUT"],
        small: ["No fires. No camping.", "Tell someone where you are going."],
      },
    });
  });

  it("lays out any hiker's name", () => {
    expect(boardText("Trail 14", "", "Last seen at Trail 14.", 1274).poster.name).toBe("");
    expect(boardText("Trail 14", "Bartholomew Featherstonehaugh-Cholmondeley", "x", 1).poster.name).toBe("Bartholomew Featherstonehaugh-Cholmondeley");
  });
});
