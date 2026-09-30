import { describe, expect, it } from "vitest";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { setLoadProgress, reportProgress } from "../../src/game/modelLoad.js";
import { reportLayer } from "../../src/game/groundMaps.js";
import { reportCall } from "../../src/game/wildlifeAudio.js";
import { reportPipelines } from "../../src/game/asyncPipelines.js";
import { stepSlices } from "../../src/game/syncJobs.js";

describe("the loading hooks", () => {
  it("count the ground maps and the calls as one stage of 24", () => {
    const p = createLoadProgress();
    setLoadProgress(p);
    reportLayer("start", "ground.grass.normal");
    reportLayer("done", "ground.grass.normal");
    reportCall("start", "call.elk_bark");
    reportCall("done", "call.elk_bark");
    expect(reportProgress()).toBe(p);
    expect(p.view().line).toBe("ground and sound 2 of 24");
    setLoadProgress(null);
  });

  it("report pipelines landed of asked", () => {
    const p = createLoadProgress();
    setLoadProgress(p);
    reportPipelines({ asked: 60, landed: 40 });
    expect(p.view().line).toBe("pipelines 40 of 60");
    setLoadProgress(null);
  });

  it("report nothing when no progress model is set", () => {
    setLoadProgress(null);
    expect(() => {
      reportLayer("start", "x");
      reportCall("done", "y");
      reportPipelines({ asked: 1, landed: 1 });
    }).not.toThrow();
  });

  it("step a generator of slices with a macrotask between every N, and return its value", async () => {
    const yields: number[] = [];
    function* work(): Generator<number, string, void> {
      for (let i = 0; i < 7; i++) { yields.push(i); yield i; }
      return "done";
    }
    let macrotasks = 0;
    const tick = setInterval(() => macrotasks++, 0);
    const out = await stepSlices(work(), 3);
    clearInterval(tick);
    expect(out).toBe("done");
    expect(yields).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Seven slices with a pause every three: two pauses, each letting the timer run at least once.
    expect(macrotasks).toBeGreaterThanOrEqual(2);
  });
});
