import { describe, it, expect } from "vitest";
import {
  NOTICE_RESTARTED,
  NOTICE_SWITCHED,
  chooseEngine,
  fallbackHolds,
  readFallback,
} from "../../src/game/engineChoice.js";
import {
  answerFailures,
  coverWith,
  createSerial,
  recordEngineFailure,
  startOnEngine,
  type FailureDeps,
} from "../../src/game/engineFailure.js";
import type { EngineOnCanvas } from "../../src/game/rendererSwap.js";

const ENV = { browser: 153, babylon: "9.18.0" };
const T0 = 1_790_000_000_000;
const HOUR = 3_600_000;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage;
}

type Engine = { name: string; webgpu: boolean };

/** Resolves when `resolve` is called: a switch or a rebuild still under way. */
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * A hike on engine `first`, with the page's real record (`recordEngineFailure`
 * over a memory storage and a URL) and the real WebGPU rule deciding each
 * rebuild's engine (switch on, adapter fitting, high tier). A rebuild makes a
 * new engine on a fresh canvas (`c1`, `c2`, …), or WebGL2's where the rule
 * says so, or where `webgpuStarts` says the WebGPU start fails (recorded as
 * `init`, as `resolveWebGpu` does).
 */
function hike(first: Engine = { name: "gpu0", webgpu: true }) {
  const log: string[] = [];
  const storage = memoryStorage();
  const page = { url: null as "webgl2" | null, now: T0 };
  let engine = first;
  let alive = true;
  let canvases = 0;
  let rebuildGate: Promise<void> | null = null;
  let readyGate: Promise<void> | null = null;
  let rebuildThrows = false;
  let webgpuStarts = true;
  const serial = createSerial();
  const rule = (): "webgl2" | "webgpu" | "probe" =>
    chooseEngine({ tier: "high", override: page.url, remembered: fallbackHolds(readFallback(storage), ENV, page.now), on: true, fits: true });
  const deps: FailureDeps = {
    serial,
    alive: () => alive,
    running: () => engine,
    runningOnWebGpu: () => engine.webgpu,
    unwatch: () => void log.push(`unwatch ${engine.name}`),
    record: (reason) => {
      const line = recordEngineFailure(reason, { storage, env: ENV, now: page.now, override: null, pin: () => (page.url = "webgl2") });
      log.push(`record ${reason}: ${line}`);
      return line;
    },
    cover: () => {
      log.push("cover");
      return () => void log.push("lift");
    },
    stopLoop: () => void log.push(`stop ${engine.name}`),
    rebuild: async () => {
      log.push(`rebuild from ${engine.name}`);
      if (rebuildGate !== null) await rebuildGate;
      if (rebuildThrows) throw new Error("no tier builds");
      canvases += 1;
      if (rule() !== "webgl2" && webgpuStarts) {
        engine = { name: `gpu${canvases}`, webgpu: true };
      } else {
        if (rule() !== "webgl2") recordEngineFailure("pipeline" as const, { storage, env: ENV, now: page.now, override: null, pin: () => undefined });
        engine = { name: `gl${canvases}`, webgpu: false };
      }
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
    storage,
    page,
    serial,
    answer: answerFailures(deps),
    engine: () => engine,
    setEngine: (next: Engine) => (engine = next),
    end: () => (alive = false),
    holdRebuild: (gate: Promise<void>) => (rebuildGate = gate),
    holdReady: (gate: Promise<void>) => (readyGate = gate),
    failRebuild: () => (rebuildThrows = true),
    failWebGpuStart: () => (webgpuStarts = false),
  };
}

describe("a failure of the running WebGPU engine: a live rebuild, never a reload", () => {
  it("swaps a pipeline error onto WebGL2 at once: the watcher off first, the cover lifted, the line", async () => {
    const h = hike();
    await h.answer(h.engine(), "pipeline");
    expect(h.log).toEqual([
      "unwatch gpu0",
      `record pipeline: ${NOTICE_SWITCHED}`,
      "cover",
      "stop gpu0",
      "rebuild from gpu0",
      "on gl1 (c1)",
      "lift",
      `flash ${NOTICE_SWITCHED}`,
    ]);
    expect(readFallback(h.storage)).toEqual({ reason: "pipeline", browser: 153, babylon: "9.18.0", at: T0, losses: 0 });
  });

  it("retries a first lost device once on a new WebGPU engine on a fresh canvas, and a second within 24 h swaps to WebGL2", async () => {
    const h = hike();
    await h.answer(h.engine(), "lost");
    expect(h.log.slice(-3)).toEqual(["on gpu1 (c1)", "lift", `flash ${NOTICE_RESTARTED}`]);
    h.log.length = 0;
    h.page.now = T0 + HOUR;
    await h.answer(h.engine(), "lost");
    expect(h.log).toEqual([
      "unwatch gpu1",
      `record lost: ${NOTICE_SWITCHED}`,
      "cover",
      "stop gpu1",
      "rebuild from gpu1",
      "on gl2 (c2)",
      "lift",
      `flash ${NOTICE_SWITCHED}`,
    ]);
    expect(readFallback(h.storage)?.losses).toBe(2);
  });

  it("says switched, not restarted, when a lost device's retry could not start on WebGPU and ended on WebGL2", async () => {
    const h = hike();
    h.failWebGpuStart();
    await h.answer(h.engine(), "lost");
    expect(h.log.slice(-3)).toEqual(["on gl1 (c1)", "lift", `flash ${NOTICE_SWITCHED}`]);
  });

  it("waits for a Settings switch under way, and does nothing more when that switch has left the failed engine", async () => {
    const h = hike();
    const apply = deferred();
    void h.serial.track(apply.promise.then(() => void h.setEngine({ name: "gpu9", webgpu: true })));
    const answered = h.answer(h.engine(), "pipeline");
    await Promise.resolve();
    expect(h.log).toEqual(["unwatch gpu0", `record pipeline: ${NOTICE_SWITCHED}`]);
    apply.resolve();
    await answered;
    // Remembered for the engines the rule gives from now on (the next load
    // takes WebGL2); the renderer the switch built on another engine, which
    // has its own watcher, is not rebuilt.
    expect(h.log).toEqual(["unwatch gpu0", `record pipeline: ${NOTICE_SWITCHED}`]);
    expect(readFallback(h.storage)).toEqual({ reason: "pipeline", browser: 153, babylon: "9.18.0", at: T0, losses: 0 });
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
    expect(h.log.slice(2)).toEqual(["switch settles", "cover", "stop gpu0", "rebuild from gpu0", "on gl1 (c1)", "lift", `flash ${NOTICE_SWITCHED}`]);
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
    expect(h.log.filter((line) => line.startsWith("record"))).toEqual([`record pipeline: ${NOTICE_SWITCHED}`]);
    expect(h.log.filter((line) => line.startsWith("rebuild"))).toEqual(["rebuild from gpu0"]);
  });

  it("answers the new engine's own failure while the first rebuild is still under way, after it: both recorded, two rebuilds, each cover lifted once", async () => {
    const h = hike();
    const ready = deferred();
    h.holdReady(ready.promise);
    const first = h.answer(h.engine(), "lost");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The retry runs on a new WebGPU engine, its scene still getting ready.
    expect(h.engine()).toEqual({ name: "gpu1", webgpu: true });
    const second = h.answer(h.engine(), "pipeline");
    await Promise.resolve();
    ready.resolve();
    await first;
    await second;
    expect(h.log).toEqual([
      "unwatch gpu0",
      `record lost: ${NOTICE_RESTARTED}`,
      "cover",
      "stop gpu0",
      "rebuild from gpu0",
      "on gpu1 (c1)",
      "unwatch gpu1",
      `record pipeline: ${NOTICE_SWITCHED}`,
      "lift",
      `flash ${NOTICE_RESTARTED}`,
      "cover",
      "stop gpu1",
      "rebuild from gpu1",
      "on gl2 (c2)",
      "lift",
      `flash ${NOTICE_SWITCHED}`,
    ]);
  });

  it("does not loop: a late report from the engine the rebuild left, once the new renderer runs on WebGL2, changes nothing", async () => {
    const h = hike();
    const failed = h.engine();
    await h.answer(failed, "pipeline");
    const before = [...h.log];
    // The old engine's device goes a moment later; the WebGL2 renderer's
    // engine is never watched (`rendererSwap.test.ts`), so nothing else can
    // report.
    await h.answer(failed, "lost");
    expect(h.log).toEqual(before);
    expect(h.engine()).toEqual({ name: "gl1", webgpu: false });
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
    expect(h.log.slice(-2)).toEqual(["on gl1 (c1)", "lift"]);
  });

  it("does nothing for a hike that is already gone but take its watcher off", async () => {
    const h = hike();
    h.end();
    await h.answer(h.engine(), "pipeline");
    expect(h.log).toEqual(["unwatch gpu0"]);
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

describe("the page's record of a failure", () => {
  it("pins engine=webgl2 in the URL where storage refuses the record, so the rule gives WebGL2", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } as unknown as Storage;
    let pinned = 0;
    expect(recordEngineFailure("lost", { storage: throwing, env: ENV, now: T0, override: null, pin: () => void pinned++ })).toBe(NOTICE_SWITCHED);
    expect(pinned).toBe(1);
    expect(recordEngineFailure("pipeline", { storage: memoryStorage(), env: ENV, now: T0, override: "webgpu", pin: () => void pinned++ })).toBe(NOTICE_SWITCHED);
    expect(pinned).toBe(2);
  });
});

describe("a hike that cannot be started on its WebGPU engine", () => {
  type Game = { on: string; lines: string[]; notify(line: string): void };
  const game = (on: string): Game => {
    const g: Game = { on, lines: [], notify: (line) => void g.lines.push(line) };
    return g;
  };
  const gpu: EngineOnCanvas = { canvas: { id: "c0" } as unknown as HTMLCanvasElement, engine: {} as never, watchers: null };

  function page(starts: ((onCanvas: EngineOnCanvas, engineFailed: (reason: "pipeline" | "lost") => string) => Game)[]) {
    const log: string[] = [];
    let n = 0;
    return {
      log,
      deps: {
        start: (onCanvas: EngineOnCanvas, engineFailed: (reason: "pipeline" | "lost") => string) => {
          log.push(`start on ${(onCanvas.canvas as unknown as { id: string }).id} ${onCanvas.engine === null ? "webgl2" : "webgpu"}`);
          return (starts[n++] as (typeof starts)[number])(onCanvas, engineFailed);
        },
        engineFailed: (reason: "pipeline" | "lost") => {
          log.push(`record ${reason}`);
          return NOTICE_SWITCHED;
        },
        freshCanvas: () => ({ id: "c9" }) as unknown as HTMLCanvasElement,
        place: (canvas: HTMLCanvasElement) => void log.push(`place ${(canvas as unknown as { id: string }).id}, every other canvas gone`),
        log: () => undefined,
      },
    };
  }
  const throws = (): never => {
    throw new Error("the signs could not be painted");
  };

  it("starts it again on WebGL2 on a fresh canvas in the page, and holds the throw against the engine once that stands", () => {
    const p = page([throws, () => game("gl")]);
    const started = startOnEngine(gpu, p.deps);
    expect(started.on).toBe("gl");
    expect(p.log).toEqual(["start on c0 webgpu", "place c9, every other canvas gone", "start on c9 webgl2", "record pipeline"]);
    expect(started.lines).toEqual([NOTICE_SWITCHED]);
  });

  it("records it once when the first start's own ladder already did", () => {
    const p = page([
      (_on, engineFailed) => {
        engineFailed("pipeline");
        return throws();
      },
      () => game("gl"),
    ]);
    const started = startOnEngine(gpu, p.deps);
    expect(p.log.filter((line) => line.startsWith("record"))).toEqual(["record pipeline"]);
    expect(started.lines).toEqual([NOTICE_SWITCHED]);
  });

  it("hands the game a recorder that, once the start has returned, records every failure of the hike", () => {
    let recorder: ((reason: "pipeline" | "lost") => string) | null = null;
    const p = page([
      (_on, engineFailed) => {
        recorder = engineFailed;
        return game("gpu");
      },
    ]);
    startOnEngine(gpu, p.deps);
    const record = recorder as unknown as (reason: "pipeline" | "lost") => string;
    record("pipeline");
    record("lost");
    record("pipeline");
    expect(p.log.filter((line) => line.startsWith("record"))).toEqual(["record pipeline", "record lost", "record pipeline"]);
  });

  it("holds nothing against the engine when WebGL2 fails too: the throw goes up", () => {
    const p = page([throws, throws]);
    expect(() => startOnEngine(gpu, p.deps)).toThrow("the signs could not be painted");
    expect(p.log.filter((line) => line.startsWith("record"))).toEqual([]);
  });

  it("lets a throw on WebGL2 go up as it always has", () => {
    const p = page([throws]);
    expect(() => startOnEngine({ ...gpu, engine: null }, p.deps)).toThrow("the signs could not be painted");
    expect(p.log).toEqual(["start on c0 webgl2"]);
  });
});
