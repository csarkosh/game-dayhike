import { describe, expect, it, vi } from "vitest";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { MODEL_TOTAL, setLoadProgress, reportProgress } from "../../src/game/modelLoad.js";
import { reportLayer } from "../../src/game/groundMaps.js";
import { reportCall } from "../../src/game/wildlifeAudio.js";
import { reportPipelines } from "../../src/game/asyncPipelines.js";
import { stepSlices } from "../../src/game/syncJobs.js";

/** A progress model with every model landed, so the line reads the next stage. */
function afterModels() {
  const p = createLoadProgress();
  setLoadProgress(p);
  for (let i = 0; i < MODEL_TOTAL; i++) {
    p.start("models", `m${i}`);
    p.done("models", `m${i}`);
  }
  return p;
}

describe("the loading hooks", () => {
  it("count the ground maps and the calls as one stage of 24", () => {
    const p = afterModels();
    reportLayer("start", "ground.grass.normal");
    reportLayer("done", "ground.grass.normal");
    reportCall("start", "call.elk_bark");
    reportCall("done", "call.elk_bark");
    expect(reportProgress()).toBe(p);
    expect(p.view().lines).toContain("ground and sound 2 of 24");
    setLoadProgress(null);
  });

  it("report pipelines landed of asked", () => {
    const p = afterModels();
    reportPipelines({ asked: 60, landed: 40 });
    expect(p.view().lines).toContain("pipelines 40 of 60");
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

  it("stop stepping, without a throw, once `stopped` says so between slices", async () => {
    let ran = 0;
    let stopped = false;
    function* work(): Generator<number, string, void> {
      for (let i = 0; i < 10; i++) { ran++; if (i === 2) stopped = true; yield i; }
      return "done";
    }
    const out = await stepSlices(work(), 1, () => stopped, () => 0);
    expect(out).toBeUndefined();
    expect(ran).toBe(3);
  });

  it("give the thread back whenever sliceMs have passed, however many slices that is, and return the slices' value", async () => {
    let clock = 0;
    let handBacks = 0;
    const real = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (f: () => void, ms?: number) => { handBacks++; return real(f, ms); });
    function* work(): Generator<void, string, void> {
      for (let i = 0; i < 10; i++) { clock += 3; yield; }
      return "done";
    }
    const out = await stepSlices(work(), 8, () => false, () => clock);
    vi.unstubAllGlobals();
    expect(out).toBe("done");
    // 3 ms a slice against 8: a hand-back after every third slice (9 ms), three in ten slices.
    expect(handBacks).toBe(3);
  });

  it("run one slice longer than sliceMs to its end, then give the thread back", async () => {
    let clock = 0;
    let handBacks = 0;
    const real = globalThis.setTimeout;
    vi.stubGlobal("setTimeout", (f: () => void, ms?: number) => { handBacks++; return real(f, ms); });
    // A ring's sampling is one slice of about 70 ms on a phone.
    function* rings(): Generator<void, void, void> {
      for (let i = 0; i < 7; i++) { clock += 70; yield; }
    }
    await stepSlices(rings(), 8, () => false, () => clock);
    vi.unstubAllGlobals();
    expect(handBacks).toBe(7);
  });
});
