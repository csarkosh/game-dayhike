import { describe, it, expect } from "vitest";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { hearEngineLog, tellEngineLog, type LoggerLevels } from "../../src/game/engineLog.js";
import { createTelemetry, type Fields, type TelemetryDeps } from "../../src/net/telemetry.js";

describe("the drawing library's log, heard for the telemetry", () => {
  const fakeLevels = (printed: string[]) => [
    {},
    { name: "Log", logFunc: (...a: unknown[]) => void printed.push(`L ${a.join(" ")}`) },
    { name: "Warn", logFunc: (...a: unknown[]) => void printed.push(`W ${a.join(" ")}`) },
    {},
    { name: "Error", logFunc: (...a: unknown[]) => void printed.push(`E ${a.join(" ")}`) },
  ];

  it("tells the warnings and the errors, each printed as before, leaves the other levels alone, and puts the levels back", () => {
    const printed: string[] = [];
    const levels = fakeLevels(printed);
    const originalLog = levels[1]!.logFunc;
    const originalWarn = levels[2]!.logFunc;
    const originalError = levels[4]!.logFunc;
    const heard: [string, unknown[]][] = [];
    const stop = hearEngineLog((severity, args) => void heard.push([severity, args]), levels);
    expect(levels[1]!.logFunc).toBe(originalLog);
    levels[1]!.logFunc!("BJS - [10:58:23]: a log line");
    levels[2]!.logFunc!("BJS - [10:58:23]: a warning", 1);
    levels[4]!.logFunc!("BJS - [10:58:24]: Unable to compile effect:");
    expect(printed).toEqual(["L BJS - [10:58:23]: a log line", "W BJS - [10:58:23]: a warning 1", "E BJS - [10:58:24]: Unable to compile effect:"]);
    expect(heard).toEqual([
      ["warn", ["BJS - [10:58:23]: a warning", 1]],
      ["error", ["BJS - [10:58:24]: Unable to compile effect:"]],
    ]);
    stop();
    expect(levels[2]!.logFunc).toBe(originalWarn);
    expect(levels[4]!.logFunc).toBe(originalError);
    levels[2]!.logFunc!("after");
    expect(heard).toHaveLength(2);
  });

  it("prints a line though its listener throws", () => {
    const printed: string[] = [];
    const levels = fakeLevels(printed);
    hearEngineLog(() => {
      throw new Error("the listener's own fault");
    }, levels);
    expect(() => levels[4]!.logFunc!("an error")).not.toThrow();
    expect(printed).toEqual(["E an error"]);
  });

  it("finds Babylon's own levels where it reads them: a warning and an error, each with the function that prints it", () => {
    // Babylon keeps them in a private static; a version that moves or renames them would leave its log unheard.
    const levels = (Logger as unknown as { _Levels: LoggerLevels })._Levels;
    expect(levels.filter((level) => typeof level.logFunc === "function").map((level) => level.name)).toEqual(["Log", "Warn", "Error"]);
  });
});

describe("the drawing library's log, told to the telemetry", () => {
  type Batch = { events: ({ n: string; t: number } & Fields)[] };
  /** A telemetry whose every send is recorded, and no timer runs. */
  function recorded(url: string | null) {
    const sent: Batch[] = [];
    const deps: TelemetryDeps = {
      now: () => 1000,
      send: (_url, body) => {
        sent.push(JSON.parse(body) as Batch);
        return Promise.resolve(true);
      },
      beacon: () => true,
      setTimer: () => 0,
      clearTimer: () => undefined,
    };
    return { t: createTelemetry(url, { sid: "s1", build: "abc1234", proto: 5, gen: 8 }, deps), sent };
  }

  it("hears Babylon's own log through the hook, without its clock, and stops hearing it", () => {
    const f = recorded("u");
    // The hook (`hearEngineLog`): it is handed how to tell the telemetry, and gives back what stops it.
    const log: { hear: ((severity: "error" | "warn", args: unknown[]) => void) | null } = { hear: null };
    const stop = tellEngineLog(f.t, (hear) => {
      log.hear = hear;
      return () => {
        log.hear = null;
      };
    });
    log.hear!("warn", ["BJS - [10:58:23]: [Frame 2707] WebGPU uncaptured error (1): [object GPUValidationError] - Binding type"]);
    log.hear!("error", ["BJS - [10:58:24]: Unable to compile effect:"]);
    f.t.flush();
    expect(f.sent[0]!.events.map((e) => [e.n, e.kind, e.msg])).toEqual([
      ["warn", "babylon", "[Frame 2707] WebGPU uncaptured error (1): [object GPUValidationError] - Binding type"],
      ["error", "babylon", "Unable to compile effect:"],
    ]);
    stop();
    expect(log.hear).toBeNull();
  });

  it("listens to nothing when telemetry is off", () => {
    let asked = false;
    tellEngineLog(recorded(null).t, () => {
      asked = true;
      return () => undefined;
    });
    expect(asked).toBe(false);
  });
});
