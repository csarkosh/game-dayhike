import { describe, it, expect } from "vitest";
import {
  FALLBACK_NOTICE_MS,
  NOTICE_RESTARTED,
  answerFailures,
  coverWith,
  createSerial,
  type FailureDeps,
} from "../../src/game/engineFailure.js";
import { LOSS_BOUND_WINDOW_MS, createLossRecord, type LossNote } from "@csarkosh/engine/game/lossBound";

type Engine = { name: string };

/** Resolves when `resolve` is called: a switch or a rebuild still under way. */
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A hike on engine `gpu0`, answering its failures as a page would. Each
 * rebuild makes a new engine (`gpu1`, `gpu2`, …) on a fresh canvas (`c1`,
 * `c2`, …). The recorder notes the failure.
 */
function hike() {
  const log: string[] = [];
  /** What each rebuild was given: the bound on its wait for the new scene. */
  const bounds: unknown[][] = [];
  let engine: Engine = { name: "gpu0" };
  let alive = true;
  let canvases = 0;
  let rebuildGate: Promise<void> | null = null;
  let readyGate: Promise<void> | null = null;
  let rebuildThrows = false;
  const serial = createSerial();
  const deps: FailureDeps = {
    serial,
    alive: () => alive,
    running: () => engine,
    unwatch: () => void log.push(`unwatch ${engine.name}`),
    abandon: () => void log.push(`abandon ${engine.name}`),
    record: (reason) => void log.push(`record ${reason}`),
    cover: () => {
      log.push("cover");
      return () => void log.push("lift");
    },
    stopLoop: () => void log.push(`stop ${engine.name}`),
    rebuild: async (...given: unknown[]) => {
      bounds.push(given);
      log.push(`rebuild from ${engine.name}`);
      if (rebuildGate !== null) await rebuildGate;
      if (rebuildThrows) throw new Error("no tier builds");
      canvases += 1;
      engine = { name: `gpu${canvases}` };
      log.push(`on ${engine.name} (c${canvases})`);
      // The new scene getting ready, the new engine already running.
      if (readyGate !== null) await readyGate;
    },
    flash: (line) => void log.push(`flash ${line}`),
    log: () => undefined,
  };
  return {
    deps,
    log,
    bounds,
    serial,
    answer: answerFailures(deps),
    engine: () => engine,
    setEngine: (next: Engine) => (engine = next),
    end: () => (alive = false),
    holdRebuild: (gate: Promise<void>) => (rebuildGate = gate),
    holdReady: (gate: Promise<void>) => (readyGate = gate),
    failRebuild: () => (rebuildThrows = true),
  };
}

describe("a failure of the running WebGPU engine: a live rebuild, never a reload", () => {
  it("says one line on the HUD once the rebuild is done, for six seconds", () => {
    expect(NOTICE_RESTARTED).toBe("Graphics restarted after a GPU error.");
    expect(FALLBACK_NOTICE_MS).toBe(6_000);
  });

  it("rebuilds at once after a pipeline error: the watcher off first, the renderer's work on the engine ended, the cover lifted, the line shown", async () => {
    const h = hike();
    await h.answer(h.engine(), "pipeline");
    expect(h.log).toEqual([
      "unwatch gpu0",
      "abandon gpu0",
      "record pipeline",
      "cover",
      "stop gpu0",
      "rebuild from gpu0",
      "on gpu1 (c1)",
      "lift",
      `flash ${NOTICE_RESTARTED}`,
    ]);
  });

  it("waits the governor's 10 s for the rebuilt scene under its cover, a pipeline error and a lost device alike", async () => {
    // A rebuild nobody asked for, in the middle of play: the governor's bound
    // (`GOVERNOR_SWAP_READY_MAX_MS`), not the Settings Apply's 20 s.
    for (const reason of ["pipeline", "lost"] as const) {
      const h = hike();
      await h.answer(h.engine(), reason);
      expect(h.bounds, reason).toEqual([[10_000]]);
    }
  });

  it("says restarted after each lost device's rebuild, each on a new engine on a fresh canvas", async () => {
    const h = hike();
    await h.answer(h.engine(), "lost");
    expect(h.log.slice(-3)).toEqual(["on gpu1 (c1)", "lift", `flash ${NOTICE_RESTARTED}`]);
    h.log.length = 0;
    await h.answer(h.engine(), "lost");
    expect(h.log).toEqual([
      "unwatch gpu1",
      "abandon gpu1",
      "record lost",
      "cover",
      "stop gpu1",
      "rebuild from gpu1",
      "on gpu2 (c2)",
      "lift",
      `flash ${NOTICE_RESTARTED}`,
    ]);
  });

  it("waits for a Settings switch under way, and does nothing more when that switch has left the failed engine", async () => {
    const h = hike();
    const apply = deferred();
    void h.serial.track(apply.promise.then(() => void h.setEngine({ name: "gpu9" })));
    const answered = h.answer(h.engine(), "pipeline");
    await Promise.resolve();
    expect(h.log).toEqual(["unwatch gpu0", "abandon gpu0", "record pipeline"]);
    apply.resolve();
    await answered;
    // Recorded all the same; the renderer the switch built on another
    // engine, which has its own watcher, is not rebuilt.
    expect(h.log).toEqual(["unwatch gpu0", "abandon gpu0", "record pipeline"]);
    expect(h.engine().name).toBe("gpu9");
  });

  it("rebuilds after a Settings switch under way that did not leave the failed engine", async () => {
    const h = hike();
    const apply = deferred();
    void h.serial.track(apply.promise);
    const answered = h.answer(h.engine(), "pipeline");
    await Promise.resolve();
    h.log.push("switch settles");
    apply.resolve();
    await answered;
    expect(h.log.slice(3)).toEqual(["switch settles", "cover", "stop gpu0", "rebuild from gpu0", "on gpu1 (c1)", "lift", `flash ${NOTICE_RESTARTED}`]);
  });

  it("keeps a governor's drop out while the rebuild runs: one at a time", async () => {
    const h = hike();
    const gate = deferred();
    h.holdRebuild(gate.promise);
    const answered = h.answer(h.engine(), "pipeline");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.log.at(-1)).toBe("rebuild from gpu0");
    // What `lowerTier` and `applyTier` ask before they start.
    expect(h.serial.idle).toBe(false);
    gate.resolve();
    await answered;
    expect(h.serial.idle).toBe(true);
  });

  it("answers one failure of an engine once: a second report while the rebuild waits changes nothing", async () => {
    const h = hike();
    const gate = deferred();
    h.holdRebuild(gate.promise);
    const failed = h.engine();
    const first = h.answer(failed, "pipeline");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.answer(failed, "lost");
    gate.resolve();
    await first;
    expect(h.log.filter((line) => line.startsWith("record"))).toEqual(["record pipeline"]);
    expect(h.log.filter((line) => line.startsWith("rebuild"))).toEqual(["rebuild from gpu0"]);
  });

  it("answers the new engine's own failure while the first rebuild is still under way, after it: both recorded, two rebuilds, each cover lifted once", async () => {
    const h = hike();
    const ready = deferred();
    h.holdReady(ready.promise);
    const first = h.answer(h.engine(), "lost");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The rebuilt renderer runs on a new engine, its scene still getting ready.
    expect(h.engine()).toEqual({ name: "gpu1" });
    const second = h.answer(h.engine(), "pipeline");
    await Promise.resolve();
    ready.resolve();
    await first;
    await second;
    expect(h.log).toEqual([
      "unwatch gpu0",
      "abandon gpu0",
      "record lost",
      "cover",
      "stop gpu0",
      "rebuild from gpu0",
      "on gpu1 (c1)",
      "unwatch gpu1",
      "abandon gpu1",
      "record pipeline",
      "lift",
      `flash ${NOTICE_RESTARTED}`,
      "cover",
      "stop gpu1",
      "rebuild from gpu1",
      "on gpu2 (c2)",
      "lift",
      `flash ${NOTICE_RESTARTED}`,
    ]);
  });

  it("does not loop: a late report from the engine the rebuild left, once the new renderer runs on another, changes nothing", async () => {
    const h = hike();
    const failed = h.engine();
    await h.answer(failed, "pipeline");
    const before = [...h.log];
    // The old engine's device goes a moment later: it is no longer the
    // running one.
    await h.answer(failed, "lost");
    expect(h.log).toEqual(before);
    expect(h.engine()).toEqual({ name: "gpu1" });
  });

  it("lifts the cover on every outcome: a rebuild that throws shows no line", async () => {
    const h = hike();
    h.failRebuild();
    await h.answer(h.engine(), "pipeline");
    expect(h.log.slice(-2)).toEqual(["rebuild from gpu0", "lift"]);
    expect(h.log.some((line) => line.startsWith("flash"))).toBe(false);
  });

  it("lifts the cover and shows no line when the session ends during the rebuild", async () => {
    const h = hike();
    const gate = deferred();
    h.holdRebuild(gate.promise);
    const answered = h.answer(h.engine(), "pipeline");
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.end();
    gate.resolve();
    await answered;
    expect(h.log.slice(-2)).toEqual(["on gpu1 (c1)", "lift"]);
  });

  it("does nothing for a hike that is already gone but take its watcher off and end its work", async () => {
    const h = hike();
    h.end();
    await h.answer(h.engine(), "pipeline");
    expect(h.log).toEqual(["unwatch gpu0", "abandon gpu0"]);
  });
});

describe("a lost device that is one too many: the hike ends, with no rebuild", () => {
  /** A hike whose losses are counted against a bound (`lossBound.ts`), as the page counts them. */
  function bounded() {
    const h = hike();
    const record = createLossRecord();
    let last: LossNote | null = null;
    const said: string[] = [];
    const deps: FailureDeps = {
      ...h.deps,
      log: (line) => void said.push(line),
      ends: (reason) => reason === "lost" && last?.end === true,
      end: () => void h.log.push("end"),
      rebuilt: (reason, failure) => void h.log.push(`rebuilt ${reason}: ${failure ?? "stands"}`),
    };
    const answer = answerFailures(deps);
    /** The device of the running engine is lost at `at` ms: noted as the renderer tells of it, then answered. */
    const lose = (at: number): Promise<void> => {
      last = record.note(at);
      return answer(h.engine(), "lost");
    };
    return { h, lose, answer, said };
  }

  it("answers two losses by a rebuild each and ends at the third inside ten minutes: remembered, no cover, no rebuild, no line", async () => {
    const { h, lose, said } = bounded();
    await lose(0);
    await lose(60_000);
    expect(h.log.filter((line) => line.startsWith("rebuild from"))).toEqual(["rebuild from gpu0", "rebuild from gpu1"]);
    const before = h.log.length;
    await lose(120_000);
    expect(h.log.slice(before)).toEqual(["unwatch gpu2", "abandon gpu2", "record lost", "end"]);
    expect(said.at(-1)).toBe("WebGPU: the device was lost once too often; ending the hike.");
    expect(h.serial.idle).toBe(true);
  });

  it("goes on rebuilding where the losses are spread wider than the window, by the clock handed in", async () => {
    const { h, lose } = bounded();
    for (let i = 0; i < 5; i++) await lose(i * (LOSS_BOUND_WINDOW_MS / 2 + 1));
    expect(h.log.filter((line) => line.startsWith("rebuild from"))).toHaveLength(5);
    expect(h.log).not.toContain("end");
  });

  it("is a lost device's alone: a GPU error on the same hike is still answered by a rebuild", async () => {
    const { h, lose, answer } = bounded();
    await lose(0);
    await lose(1);
    await lose(2);
    expect(h.log.at(-1)).toBe("end");
    // The page would be on its way to the landing by now; a hike that went on answers a pipeline error as ever.
    h.setEngine({ name: "gpu9" });
    await answer(h.engine(), "pipeline");
    expect(h.log.slice(-5)).toEqual(["rebuild from gpu9", "on gpu3 (c3)", "lift", "rebuilt pipeline: stands", `flash ${NOTICE_RESTARTED}`]);
  });

  it("does not end a hike that is already gone", async () => {
    const { h, lose } = bounded();
    await lose(0);
    await lose(1);
    h.end();
    await lose(2);
    expect(h.log).not.toContain("end");
  });
});

describe("how a rebuild came out", () => {
  it("is told once the rebuild has run to its end, before the line, and with the throw where no tier builds", async () => {
    const h = hike();
    const answer = answerFailures({ ...h.deps, rebuilt: (reason, failure) => void h.log.push(`rebuilt ${reason}: ${failure ?? "stands"}`) });
    await answer(h.engine(), "lost");
    expect(h.log.slice(-4)).toEqual(["on gpu1 (c1)", "lift", "rebuilt lost: stands", `flash ${NOTICE_RESTARTED}`]);
    h.failRebuild();
    await answer(h.engine(), "lost");
    expect(h.log.slice(-3)).toEqual(["rebuild from gpu1", "rebuilt lost: Error: no tier builds", "lift"]);
  });

  it("is told of nothing where the failure was not answered", async () => {
    const h = hike();
    const told: string[] = [];
    const answer = answerFailures({ ...h.deps, rebuilt: (reason) => void told.push(reason) });
    h.end();
    await answer(h.engine(), "lost");
    expect(told).toEqual([]);
  });
});

describe("the cover over play", () => {
  it("lifts once, when told or when the session ends, and frees the controls", () => {
    const log: string[] = [];
    let ended: (() => void) | null = null;
    const deps = {
      show: () => ({ dispose: () => void log.push("screen gone") }),
      hold: () => () => void log.push("controls free"),
      whenEnded: (lift: () => void) => {
        ended = lift;
        return () => {
          ended = null;
          log.push("not listening");
        };
      },
    };
    const lift = coverWith(deps);
    lift();
    lift();
    expect(log).toEqual(["not listening", "screen gone", "controls free"]);
    log.length = 0;
    coverWith(deps);
    (ended as unknown as () => void)();
    expect(log).toEqual(["not listening", "screen gone", "controls free"]);
  });
});
