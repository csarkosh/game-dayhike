import { describe, expect, it } from "vitest";
import { gpuTimeLine, gpuTimeReport } from "../../src/game/gpuTimeReport.js";

const raw = {
  supported: true, build: "abc1234", frameId: 100, renderWidth: 1470, renderHeight: 956,
  frameNs: 12_345_000, mainNs: 8_100_000,
  targets: [
    { name: "shadow_near", ns: 1_500_000, lastFrameId: 100, width: 2048, height: 2048 },
    { name: "lake_mirror", ns: 900_000, lastFrameId: 97, width: 735, height: 478 },
    { name: "early", ns: null, lastFrameId: null, width: 1470, height: 956 },
  ],
};

describe("gpuTimeReport", () => {
  it("turns nanoseconds into milliseconds, marks what drew in the last frame, and lists what was never counted", () => {
    const r = gpuTimeReport(raw);
    expect(r.frameMs).toBe(12.345);
    expect(r.mainMs).toBe(8.1);
    expect(r.targets).toEqual([
      { name: "shadow_near", ms: 1.5, width: 2048, height: 2048, drewLastFrame: true },
      { name: "lake_mirror", ms: 0.9, width: 735, height: 478, drewLastFrame: false },
    ]);
    expect(r.missed).toEqual(["early"]);
  });
  it("never marks a target that never drew as drawn, in the first frames too", () => {
    const first = gpuTimeReport({ ...raw, frameId: -1, targets: [{ name: "mirror", ns: 0, lastFrameId: -1, width: 1, height: 1 }] });
    expect(first.targets[0]?.drewLastFrame).toBe(false);
  });
  it("says so when unsupported", () => {
    const r = gpuTimeReport({ ...raw, supported: false, frameNs: null, mainNs: null, targets: [] });
    expect(r.supported).toBe(false);
    expect(r.frameMs).toBeNull();
    expect(gpuTimeLine(r)).toBe("gpu time: unsupported");
  });
  it("writes the line the corner shows", () => {
    expect(gpuTimeLine(gpuTimeReport(raw))).toBe("gpu 12.345 ms · main 8.100 ms");
  });
  it("writes n/a for a frame the browser does not time", () => {
    expect(gpuTimeLine(gpuTimeReport({ ...raw, frameNs: null }))).toBe("gpu n/a · main 8.100 ms");
  });
});
