/**
 * The trailhead board's face as data: where each part lies on the face's
 * texture, and every word on it. Pure: no canvas, no Babylon. The painter
 * (`boardPaint.ts`) draws what this says.
 */

/** The face's texture: the face is 2 m by 1 m, so twice as wide as tall, about a pixel a millimetre. */
export const BOARD_TEXTURE = { width: 2048, height: 1024 } as const;

/** The face in the board's own space: its size, and its centre above the board's foot and in front of its centre plane. */
export const BOARD_FACE = { width: 2, height: 1, centreY: 1.37, front: 0.159 } as const;

/** A rectangle on the texture, in pixels from its top-left corner, turned about its own centre. */
export type Rect = { x: number; y: number; width: number; height: number; turn: number };

export type SheetName = "map" | "poster" | "rules" | "torn";
export type Sheet = { name: SheetName; rect: Rect; staples: boolean };

const DEGREE = Math.PI / 180;

/** The sheets, bottom to top: the map over the left half, the poster and the rules to its right, a torn corner below. */
export const SHEETS: readonly Sheet[] = [
  { name: "torn", rect: { x: 1229, y: 901, width: 123, height: 72, turn: 3 * DEGREE }, staples: false },
  { name: "map", rect: { x: 72, y: 236, width: 1024, height: 748, turn: -0.4 * DEGREE }, staples: true },
  { name: "poster", rect: { x: 1167, y: 246, width: 451, height: 635, turn: 1.2 * DEGREE }, staples: true },
  { name: "rules", rect: { x: 1659, y: 276, width: 338, height: 532, turn: -1 * DEGREE }, staples: true },
];

/** The routed lines across the top: each line's centre and its capitals' height, in pixels. */
export const TITLE = { centreX: 1024, centreY: 87, height: 102 } as const;
export const DISTANCE = { centreX: 1024, centreY: 179, height: 41 } as const;

export function sheet(name: SheetName): Sheet {
  const found = SHEETS.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no sheet named "${name}"`);
  return found;
}

/** Where a sheet's centre lies on the board: metres right of the face's centre, and metres above the board's foot. */
export function sheetCentre(name: SheetName): { along: number; height: number } {
  const r = sheet(name).rect;
  const u = (r.x + r.width / 2) / BOARD_TEXTURE.width;
  const v = (r.y + r.height / 2) / BOARD_TEXTURE.height;
  return {
    along: (u - 0.5) * BOARD_FACE.width,
    height: BOARD_FACE.centreY + (0.5 - v) * BOARD_FACE.height,
  };
}

const METRES_PER_MILE = 1609.344;

/** A trail's length in miles to one decimal place, never less than 0.1. */
export function miles(metres: number): string {
  const tenths = Math.max(1, Math.round((metres / METRES_PER_MILE) * 10));
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export type BoardText = {
  title: string;
  distance: string;
  mapHeading: string;
  poster: { title: string; name: string; lines: string[] };
  rules: { heading: string; lines: string[]; small: string[] };
};

/** Every word on the board, for a trail's name, a hiker's name and the trail's length to the summit. */
export function boardText(trailName: string, hikerName: string, lastSeen: string, summitMetres: number): BoardText {
  return {
    title: trailName.toUpperCase(),
    distance: `SUMMIT ${miles(summitMetres)} MI`,
    mapHeading: `${trailName.toUpperCase()} · TRAILS`,
    poster: {
      title: "MISSING",
      name: hikerName,
      lines: [lastSeen, "If you have seen them, call the ranger station."],
    },
    rules: {
      heading: "BEFORE YOU GO",
      lines: ["STAY ON THE TRAIL", "BE OFF THE MOUNTAIN BY DARK", "PACK IT IN, PACK IT OUT"],
      small: ["No fires. No camping.", "Tell someone where you are going."],
    },
  };
}
