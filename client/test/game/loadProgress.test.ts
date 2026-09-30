import { describe, expect, it } from "vitest";
import { createLoadProgress } from "../../src/game/loadProgress.js";

describe("the loading bar's model", () => {
  it("starts empty and reads nothing", () => {
    const p = createLoadProgress();
    expect(p.view()).toEqual({ bar: 0, line: "", ready: false });
  });

  it("counts models of a total, and weighs the bar by bytes when it knows them", () => {
    const p = createLoadProgress();
    p.total("models", 4);
    p.start("models", "a", 1000);
    p.start("models", "b", 3000);
    p.bytes("models", "a", 1000, 1000);
    p.done("models", "a");
    expect(p.view().line).toBe("downloading models 1 of 4, 0.0 of 0.0 MB");
    p.bytes("models", "b", 1500, 3000);
    // 2500 of the 4000 bytes of the two models started, and two of the four
    // started: the stage is 0.625 · 0.5 through, and it is 0.6 of the bar.
    expect(p.view().bar).toBeCloseTo(0.1875, 6);
  });

  it("reports a count and no percentage where there is no total", () => {
    const p = createLoadProgress();
    p.start("shaders", "x");
    p.done("shaders", "x");
    p.start("shaders", "y");
    p.done("shaders", "y");
    expect(p.view().line).toBe("compiling shaders 2");
    expect(p.view().line).not.toContain("%");
    // A stage with no total contributes nothing to the bar until the gate.
    expect(p.view().bar).toBe(0);
  });

  it("names one stage at a time, the first that is not finished", () => {
    const p = createLoadProgress();
    p.total("models", 1);
    p.total("ground", 2);
    p.start("models", "a");
    p.start("ground", "g1");
    p.done("ground", "g1");
    expect(p.view().line).toBe("downloading models 0 of 1");
    p.done("models", "a");
    expect(p.view().line).toBe("ground and sound 1 of 2");
  });

  it("never moves the bar backward", () => {
    const p = createLoadProgress();
    p.total("models", 2);
    p.start("models", "a", 100);
    p.bytes("models", "a", 100, 100);
    const before = p.view().bar;
    p.start("models", "b", 100_000);
    expect(p.view().bar).toBeGreaterThanOrEqual(before);
  });

  it("is ready only when the gate says so, and then reads ready with a full bar", () => {
    const p = createLoadProgress();
    p.total("models", 1);
    p.start("models", "a");
    p.done("models", "a");
    expect(p.view().ready).toBe(false);
    p.gate();
    expect(p.view()).toEqual({ bar: 1, line: "ready", ready: true });
  });
});
