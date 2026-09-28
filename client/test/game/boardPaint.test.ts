import { describe, expect, it } from "vitest";
import { boardText } from "../../src/game/boardFace.js";
import { boardDrawingOf, paperCrop, whenImagesArrive, wrap } from "../../src/game/boardPaint.js";

describe("wrap", () => {
  const width = (s: string): number => s.length * 10;

  it("breaks a line at its spaces to fit a width", () => {
    expect(wrap("BE OFF THE MOUNTAIN BY DARK", 150, width)).toEqual(["BE OFF THE", "MOUNTAIN BY", "DARK"]);
    expect(wrap("STAY ON THE TRAIL", 400, width)).toEqual(["STAY ON THE TRAIL"]);
  });

  it("leaves a word longer than the width on a line of its own", () => {
    expect(wrap("A Featherstonehaugh-Cholmondeley B", 100, width)).toEqual(["A", "Featherstonehaugh-Cholmondeley", "B"]);
  });

  it("gives no lines for no words", () => {
    expect(wrap("", 100, width)).toEqual([]);
    expect(wrap("   ", 100, width)).toEqual([]);
  });
});

describe("paperCrop", () => {
  it("cuts each sheet from its own part of the paper, in the sheet's proportions, inside the image", () => {
    const map = paperCrop("map", { width: 1024, height: 748 }, 512);
    expect(map.width / map.height).toBeCloseTo(1024 / 748, 9);
    const poster = paperCrop("poster", { width: 451, height: 635 }, 512);
    expect(poster.width / poster.height).toBeCloseTo(451 / 635, 9);
    for (const c of [map, poster, paperCrop("rules", { width: 338, height: 532 }, 512), paperCrop("torn", { width: 123, height: 72 }, 512)]) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(512);
      expect(c.y + c.height).toBeLessThanOrEqual(512);
    }
    expect(paperCrop("map", { width: 1024, height: 748 }, 512)).toEqual(map);
    expect([poster.x, poster.y]).not.toEqual([map.x, map.y]);
  });
});

describe("whenImagesArrive", () => {
  const both = { paper: "paper.webp", portrait: "portrait.webp" };

  it("draws once more when an image arrives", async () => {
    const drawn: unknown[] = [];
    await whenImagesArrive(both, async (url) => (url === "paper.webp" ? "PAPER" : null), () => false, (images) => drawn.push(images));
    expect(drawn).toEqual([{ paper: "PAPER", portrait: null }]);
  });

  it("draws nothing more when there are no images or none arrives", async () => {
    const drawn: unknown[] = [];
    const asked: string[] = [];
    await whenImagesArrive({ paper: null, portrait: null }, async (url) => { asked.push(url); return "X"; }, () => false, (images) => drawn.push(images));
    expect(asked).toEqual([]);
    await whenImagesArrive(both, async () => null, () => false, (images) => drawn.push(images));
    expect(drawn).toEqual([]);
  });

  it("drops an image that arrives after disposal", async () => {
    const drawn: unknown[] = [];
    let gone = false;
    const waiting = whenImagesArrive(both, async () => "X", () => gone, (images) => drawn.push(images));
    gone = true;
    await waiting;
    expect(drawn).toEqual([]);
  });
});

describe("boardDrawingOf", () => {
  it("gathers what the painter draws from the world's own graph, names and seed", () => {
    const d = boardDrawingOf({
      seed: 7,
      trailName: "Trail 14",
      hikerName: "Hugh Kowalski",
      lastSeen: "Last seen at Trail 14.",
      graph: {
        nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
        edges: [{ a: 0, b: 1, kind: "stem" }],
        features: [{ kind: "peak", x: 100, z: 0, radius: 50 }],
        shortestHome: 1274,
      },
      places: [{ name: "Summit", x: 100, z: 0 }],
      summitName: "Summit",
      roadCenterX: () => -9,
      urls: { paper: null, portrait: null },
    });
    expect(d.seed).toBe(7);
    expect(d.text).toEqual(boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274));
    expect(d.map.nodes).toEqual([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
    expect(d.map.edges).toEqual([{ a: 0, b: 1, kind: "stem" }]);
    // The road sampled every 25 m from 60 m before the trails' least z to 60 m past their most.
    expect(d.map.road.map((r) => r.z)).toEqual([-60, -35, -10, 15, 40]);
    expect(d.map.road.every((r) => r.x === -9)).toBe(true);
    expect(d.map.places).toEqual([{ name: "Summit", x: 100, z: 0 }]);
    expect(d.urls).toEqual({ paper: null, portrait: null });
  });
});
