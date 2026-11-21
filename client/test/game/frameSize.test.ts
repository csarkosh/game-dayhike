import { describe, expect, it } from "vitest";
import { createFrameFit, frameSizeFor, type FrameFitDeps } from "@csarkosh/engine/game/frameSize";
import { QUALITY } from "@csarkosh/engine/game/quality";
import { RENDER_SCALE_DROP_WINDOWS, RENDER_SCALE_SLOW_HZ, RENDER_SCALE_STEPS, RENDER_SCALE_WINDOW_S, renderScaleRuns } from "@csarkosh/engine/game/renderScale";

/** A canvas and a surface as the fit reads and sizes them. */
function page(width: number, height: number, ratio = 1): FrameFitDeps & { box: { width: number; height: number }; display: { ratio: number }; sets: [number, number][] } {
  const box = { width, height };
  const display = { ratio };
  const sets: [number, number][] = [];
  return { box, display, sets, clientWidth: () => box.width, clientHeight: () => box.height, ratio: () => display.ratio, set: (w, h) => void sets.push([w, h]) };
}

/** Feeds `seconds` of play at `hz`. */
function play(fit: { frame(seconds: number): boolean }, hz: number, seconds: number): number {
  let steps = 0;
  for (let i = 0; i < Math.round(seconds * hz); i++) if (fit.frame(1 / hz)) steps++;
  return steps;
}

describe("the frame's size", () => {
  it("is the canvas's box over the tier's scaling, cut to a whole pixel, as Babylon's resize has it", () => {
    // Babylon: setSize(clientWidth / level, clientHeight / level), each `| 0`.
    for (const [w, h] of [[1470, 956], [1200, 800], [1512, 982], [1920, 1080], [393, 852], [1, 1], [2559, 1439]] as const) {
      for (const tier of ["low", "medium", "high"] as const) {
        const level = QUALITY[tier].hardwareScaling;
        expect(frameSizeFor(w, h, level)).toEqual({ width: (w / level) | 0, height: (h / level) | 0 });
      }
    }
    expect(frameSizeFor(1470, 956, QUALITY.low.hardwareScaling)).toEqual({ width: 980, height: 637 });
    expect(frameSizeFor(1470, 956, QUALITY.medium.hardwareScaling)).toEqual({ width: 1470, height: 956 });
  });

  it("takes the render scale as Babylon's level does: the tier's scaling over the scale's share", () => {
    for (const scale of RENDER_SCALE_STEPS) {
      const level = QUALITY.medium.hardwareScaling / scale;
      expect(frameSizeFor(1470, 956, QUALITY.medium.hardwareScaling, scale)).toEqual({ width: (1470 / level) | 0, height: (956 / level) | 0 });
    }
    expect(frameSizeFor(1470, 956, 1, 0.87)).toEqual({ width: 1278, height: 831 });
    expect(frameSizeFor(1470, 956, 1, 0.75)).toEqual({ width: 1102, height: 717 });
  });

  it("does not read the display's pixel ratio: a display of 2 draws the box's CSS pixels", () => {
    const one = page(1470, 956, 1);
    const two = page(1470, 956, 2);
    createFrameFit("high", false, one).fit();
    createFrameFit("high", false, two).fit();
    expect(one.sets).toEqual([[1470, 956]]);
    expect(two.sets).toEqual([[1470, 956]]);
  });

  it("keeps the frame's pixels when the display's ratio moves under a running hike", () => {
    // Zoomed to 200 %: the box is half the CSS pixels and the ratio twice, and Babylon scales its level by the old ratio over the new.
    const p = page(1470, 956, 2);
    const fit = createFrameFit("low", false, p);
    expect(fit.fit()).toBe(true);
    expect(p.sets).toEqual([[980, 637]]);
    p.box.width = 735;
    p.box.height = 478;
    p.display.ratio = 4;
    expect(frameSizeFor(735, 478, 1.5, 1, 2 / 4)).toEqual({ width: (735 / (1.5 * (2 / 4))) | 0, height: (478 / (1.5 * (2 / 4))) | 0 });
    // The same pixels: nothing is sized again.
    expect(fit.fit()).toBe(false);
    expect(fit.size).toEqual({ width: 980, height: 637 });
    expect(p.sets.length).toBe(1);
    // Zoomed out to 50 % from the start: the box is twice the CSS pixels at half the ratio.
    p.box.width = 2940;
    p.box.height = 1912;
    p.display.ratio = 1;
    expect(fit.fit()).toBe(false);
    expect(fit.size).toEqual({ width: 980, height: 637 });
    // The window made smaller at that zoom is fewer pixels.
    p.box.width = 2400;
    expect(fit.fit()).toBe(true);
    expect(p.sets[1]).toEqual([800, 637]);
  });
});

describe("the frame's fit", () => {
  it("sizes the surface once, and again only when the box, the ratio or the scale moves", () => {
    const p = page(1470, 956);
    const fit = createFrameFit("medium", false, p);
    expect(fit.size).toBeNull();
    expect(fit.fit()).toBe(true);
    expect(fit.fit()).toBe(false);
    expect(fit.fit()).toBe(false);
    expect(p.sets).toEqual([[1470, 956]]);
    expect(fit.size).toEqual({ width: 1470, height: 956 });
    p.box.width = 1200;
    p.box.height = 800;
    expect(fit.fit()).toBe(true);
    expect(p.sets).toEqual([[1470, 956], [1200, 800]]);
  });

  it("leaves a canvas with no box as it is, and sizes it when it has one", () => {
    const p = page(0, 0);
    const fit = createFrameFit("low", false, p);
    expect(fit.fit()).toBe(false);
    expect(p.sets).toEqual([]);
    p.box.width = 900;
    p.box.height = 600;
    expect(fit.fit()).toBe(true);
    expect(p.sets).toEqual([[600, 400]]);
  });

  it("does not size the surface again for a box that moved to the same pixels", () => {
    const p = page(1470, 956);
    const fit = createFrameFit("low", false, p);
    fit.fit();
    p.box.width = 1471;
    expect(fit.fit()).toBe(false);
    expect(p.sets).toEqual([[980, 637]]);
  });

  it("reads everything again when asked to", () => {
    const p = page(1470, 956);
    const fit = createFrameFit("medium", false, p);
    fit.fit();
    fit.refit();
    // Nothing moved: read again, and the same size is not set twice.
    expect(fit.fit()).toBe(false);
    expect(p.sets.length).toBe(1);
  });

  it("holds the scale at full where it does not run, however slow the frames", () => {
    const p = page(1470, 956);
    const fit = createFrameFit("medium", false, p);
    fit.fit();
    expect(play(fit, RENDER_SCALE_SLOW_HZ - 20, RENDER_SCALE_WINDOW_S * (RENDER_SCALE_DROP_WINDOWS + 2))).toBe(0);
    expect(fit.scale).toBe(1);
    expect(fit.fit()).toBe(false);
  });

  it("steps the scale down while the frames are slow, and the next fit draws fewer pixels into the same box", () => {
    const p = page(1470, 956);
    const fit = createFrameFit("medium", true, p);
    fit.fit();
    expect(play(fit, RENDER_SCALE_SLOW_HZ - 20, RENDER_SCALE_WINDOW_S * RENDER_SCALE_DROP_WINDOWS + 0.5)).toBe(1);
    expect(fit.scale).toBe(RENDER_SCALE_STEPS[1]);
    // Nothing is sized by the step itself: the frame drawn next fits it.
    expect(p.sets.length).toBe(1);
    expect(fit.fit()).toBe(true);
    expect(p.sets[1]).toEqual([1278, 831]);
    expect(fit.fit()).toBe(false);
  });
});

describe("where the render scale runs", () => {
  it("is where a paint pass draws, and never in the measurement mode", () => {
    expect(renderScaleRuns(0, false)).toBe(false);
    expect(renderScaleRuns(3, false)).toBe(true);
    expect(renderScaleRuns(3, true)).toBe(false);
    expect(renderScaleRuns(0, true)).toBe(false);
  });
});
