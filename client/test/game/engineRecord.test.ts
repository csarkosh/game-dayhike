import { describe, it, expect } from "vitest";
import {
  NOTICE_SWITCHED,
  fallbackHolds,
  pinsAfterFailure,
  readFallback,
  recordEngineFailure,
  recordStartFailure,
  startOnEngine,
  type StartCanvas as EngineOnCanvas,
} from "../../src/game/engineChoice.js";

/**
 * The engine rule's record of a failure and its second start on another
 * engine (`engineChoice.ts`). No page calls either: a hike is drawn by a
 * renderer that makes its own engine, and its failures are answered by
 * `answerFailures` (`engineFailure.test.ts`). These go with the rule.
 */

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

describe("the page's record of a failure", () => {
  it("pins engine=webgl2 in the URL where storage refuses the record, so the rule gives WebGL2", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } as unknown as Storage;
    let pinned = 0;
    expect(recordEngineFailure("lost", { storage: throwing, env: ENV, now: T0, override: null, pin: () => void pinned++ })).toBe(NOTICE_SWITCHED);
    expect(pinned).toBe(1);
    expect(recordEngineFailure("pipeline", { storage: memoryStorage(), env: ENV, now: T0, override: "webgpu", pin: () => void pinned++ })).toBe(NOTICE_SWITCHED);
    expect(pinned).toBe(2);
  });

  it("pins every path that ends on WebGL2 after a failure by one rule: storage refused, or ?engine=webgpu over the record", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } as unknown as Storage;
    /** Whether each path pinned, for a page whose storage is `storage` and whose address says `override`. */
    const paths = (storage: () => Storage | null, override: "webgpu" | null): Record<string, boolean> => {
      const out: Record<string, boolean> = {};
      const run = (name: string, act: (pin: () => void) => void): void => {
        let pinned = false;
        act(() => (pinned = true));
        out[name] = pinned;
      };
      // A failed start: the first load's, a switch's, a probe step's, a lost device's retry.
      run("init", (pin) => void recordStartFailure("init", { storage: storage(), env: ENV, now: T0, override, current: true, pin }));
      run("pipeline", (pin) => void recordEngineFailure("pipeline", { storage: storage(), env: ENV, now: T0, override, pin }));
      // A second lost device in 24 h, on the storage the first one wrote to.
      run("lost twice", (pin) => {
        const kept = storage();
        recordEngineFailure("lost", { storage: kept, env: ENV, now: T0, override, pin: () => undefined });
        recordEngineFailure("lost", { storage: kept, env: ENV, now: T0 + HOUR, override, pin });
      });
      // A first lost device retries on WebGPU: nothing to pin.
      run("lost once", (pin) => void recordEngineFailure("lost", { storage: storage(), env: ENV, now: T0, override, pin }));
      // A start that ran out of time: a lone one tries WebGPU again, nothing to pin…
      run("timeout once", (pin) => void recordStartFailure("timeout", { storage: storage(), env: ENV, now: T0, override, current: true, pin }));
      // …a second in 24 h, on the storage the first one wrote to, holds.
      run("timeout twice", (pin) => {
        const kept = storage();
        recordStartFailure("timeout", { storage: kept, env: ENV, now: T0, override, current: true, pin: () => undefined });
        recordStartFailure("timeout", { storage: kept, env: ENV, now: T0 + HOUR, override, current: true, pin });
      });
      return out;
    };
    expect(paths(memoryStorage, null)).toEqual({ init: false, pipeline: false, "lost twice": false, "lost once": false, "timeout once": false, "timeout twice": false });
    expect(paths(memoryStorage, "webgpu")).toEqual({ init: true, pipeline: true, "lost twice": true, "lost once": false, "timeout once": false, "timeout twice": true });
    expect(paths(() => throwing, null)).toEqual({ init: true, pipeline: true, "lost twice": true, "lost once": true, "timeout once": true, "timeout twice": true });
    expect(pinsAfterFailure({ stored: true, override: null })).toBe(false);
    expect(pinsAfterFailure({ stored: true, override: "webgl2" })).toBe(false);
    expect(pinsAfterFailure({ stored: true, override: "webgpu" })).toBe(true);
    expect(pinsAfterFailure({ stored: false, override: null })).toBe(true);
  });

  it("records a failed start as init, and leaves the address alone where the page no longer wants the engine", () => {
    const storage = memoryStorage();
    let pinned = 0;
    const got = recordStartFailure("init", { storage, env: ENV, now: T0, override: "webgpu", current: false, pin: () => void pinned++ });
    expect(got).toEqual({ stored: true, holds: true });
    expect(readFallback(storage)).toEqual({ reason: "init", browser: 153, babylon: "9.18.0", at: T0, losses: 0 });
    expect(pinned).toBe(0);
  });

  it("records a start that ran out of time as a timeout: a lone one does not hold, a second in 24 h holds a day", () => {
    const storage = memoryStorage();
    const pins: string[] = [];
    const first = recordStartFailure("timeout", { storage, env: ENV, now: T0, override: null, current: true, pin: () => void pins.push("first") });
    expect(first).toEqual({ stored: true, holds: false });
    expect(readFallback(storage)).toEqual({ reason: "timeout", browser: 153, babylon: "9.18.0", at: T0, losses: 1 });
    const second = recordStartFailure("timeout", { storage, env: ENV, now: T0 + HOUR, override: null, current: true, pin: () => void pins.push("second") });
    expect(second).toEqual({ stored: true, holds: true });
    expect(readFallback(storage)).toEqual({ reason: "timeout", browser: 153, babylon: "9.18.0", at: T0 + HOUR, losses: 2 });
    expect(fallbackHolds(readFallback(storage), ENV, T0 + HOUR + 86_399_999)).toBe(true);
    expect(fallbackHolds(readFallback(storage), ENV, T0 + HOUR + 86_400_000)).toBe(false);
    expect(pins).toEqual([]);
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
