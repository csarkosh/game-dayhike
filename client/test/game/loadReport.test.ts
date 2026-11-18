import { afterEach, describe, expect, it } from "vitest";
import { createLoadProgress, type LoadProgress, type Stage } from "../../src/game/loadProgress.js";
import { GROUND_STAGE_TOTAL, MODEL_TOTAL, reportLayer, reportProgress, setLoadProgress } from "../../src/game/loadReport.js";
import * as groundMaps from "../../src/game/groundLayers.js";

/** A progress model that says what it was told. */
function told(): LoadProgress & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    total: (stage: Stage, n: number) => void log.push(`total ${stage} ${n}`),
    start: (stage: Stage, id: string) => void log.push(`start ${stage} ${id}`),
    bytes: () => undefined,
    done: (stage: Stage, id: string) => void log.push(`done ${stage} ${id}`),
    gate: () => undefined,
    view: () => ({ bar: 0, lines: [], ready: false }),
  };
}

describe("where the loads report to", () => {
  afterEach(() => setLoadProgress(null));

  it("is nothing until a bar is up, and every hook is quiet then", () => {
    expect(reportProgress()).toBeNull();
    reportLayer("start", "normal.grass");
    reportLayer("done", "normal.grass");
    expect(reportProgress()).toBeNull();
  });

  it("tells the bar the models' total as it is set, and hands it to the other hooks", () => {
    const p = told();
    setLoadProgress(p);
    expect(reportProgress()).toBe(p);
    expect(p.log).toEqual([`total models ${MODEL_TOTAL}`]);
    expect(MODEL_TOTAL).toBeGreaterThan(0);
  });

  it("tells the ground's stage of 24 by name: twelve maps, six albedos and six calls", () => {
    const p = told();
    setLoadProgress(p);
    reportLayer("start", "call.elk_bugle");
    reportLayer("done", "call.elk_bugle");
    expect(p.log.slice(1)).toEqual([`total ground ${GROUND_STAGE_TOTAL}`, "start ground call.elk_bugle", `total ground ${GROUND_STAGE_TOTAL}`, "done ground call.elk_bugle"]);
    expect(GROUND_STAGE_TOTAL).toBe(groundMaps.GROUND_LAYERS * 2 + groundMaps.GROUND_LAYERS + 6);
    // And the bar's own model takes them: a stage part done.
    const bar = createLoadProgress();
    setLoadProgress(bar);
    reportLayer("start", "a");
    reportLayer("done", "a");
    expect(bar.view().lines).toContain(`ground and sound 1 of ${GROUND_STAGE_TOTAL}`);
  });
});
