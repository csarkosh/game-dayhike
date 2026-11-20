import { describe, expect, it } from "vitest";
import { gpuTimeLine } from "@csarkosh/engine/game/gpuTimeReport";
import { taskTimeReport } from "@csarkosh/engine/game/gpuTimeTasks";

const base = { build: "dev", renderWidth: 1470, renderHeight: 956 };

describe("the GPU's time from a frame timed task by task", () => {
  it("says unsupported and counts nothing where the device has no timestamp queries", () => {
    const report = taskTimeReport({ ...base, supported: false, frameMs: 3, frame: { available: true, tasks: [{ index: 0, name: "scene", durationMs: 2 }] } });
    expect(report).toEqual({ supported: false, build: "dev", renderWidth: 1470, renderHeight: 956, frameMs: null, mainMs: null, targets: [], missed: [] });
    expect(gpuTimeLine(report)).toBe("gpu time: unsupported");
  });

  it("has no reading before the first frame is read back", () => {
    const report = taskTimeReport({ ...base, supported: true, frameMs: 0, frame: { available: false, tasks: [] } });
    expect(report.frameMs).toBeNull();
    expect(report.mainMs).toBeNull();
    expect(report.targets).toEqual([]);
    expect(gpuTimeLine(report)).toBe("gpu n/a · main n/a");
    expect(taskTimeReport({ ...base, supported: true, frameMs: 0, frame: null }).mainMs).toBeNull();
  });

  it("takes the frame's last task as the one that ends on the canvas, and the tasks before it as its targets", () => {
    const report = taskTimeReport({
      ...base, supported: true, frameMs: 6.12345,
      // Handed over in any order: the frame's order is each task's place.
      frame: { available: true, tasks: [{ index: 2, name: "post", durationMs: 1.50049 }, { index: 0, name: "shade_mask", durationMs: 0.25 }, { index: 1, name: "scene", durationMs: 3.2 }] },
      sizes: { shade_mask: [512, 512] },
    });
    expect(report.frameMs).toBe(6.123);
    expect(report.mainMs).toBe(1.5);
    expect(report.targets).toEqual([
      { name: "shade_mask", ms: 0.25, width: 512, height: 512, drewLastFrame: true },
      { name: "scene", ms: 3.2, width: 0, height: 0, drewLastFrame: true },
    ]);
    expect(report.missed).toEqual([]);
    expect(gpuTimeLine(report)).toBe("gpu 6.123 ms · main 1.500 ms");
  });

  it("is the scene's own pass alone on a tier with no chain", () => {
    const report = taskTimeReport({ ...base, supported: true, frameMs: 2, frame: { available: true, tasks: [{ index: 0, name: "scene", durationMs: 1.75 }] } });
    expect(report.mainMs).toBe(1.75);
    expect(report.targets).toEqual([]);
  });

  it("tells two tasks of one name apart by their place in the frame", () => {
    const report = taskTimeReport({
      ...base, supported: true, frameMs: 2,
      frame: { available: true, tasks: [{ index: 0, name: "sector", durationMs: 0.1 }, { index: 1, name: "sector", durationMs: 0.2 }, { index: 2, name: "scene", durationMs: 1 }] },
    });
    expect(report.targets.map((t) => t.name)).toEqual(["sector#0", "sector#1"]);
  });
});
