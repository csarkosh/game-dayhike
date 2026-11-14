import { describe, it, expect } from "vitest";
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { hearEngineLog, type LoggerLevels } from "../../src/game/engineLog.js";

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
