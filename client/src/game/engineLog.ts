/**
 * The warnings and errors of Babylon.js, for the page's telemetry
 * (`net/telemetry.ts`).
 *
 * Babylon takes `console.warn` and `console.error` into its logger's levels
 * (`Logger._Levels`) when its module loads, before the page's wrap of the
 * console exists (`installErrorCapture`), so its warnings and errors (a GPU
 * validation error, an effect that would not compile) never pass through
 * that wrap; the levels' own functions are wrapped instead (`hearEngineLog`),
 * and what they print is told to the telemetry from here (`tellEngineLog`).
 * No page draws with Babylon.js, so no page calls either.
 */
import { Logger } from "@babylonjs/core/Misc/logger.js";
import { stackOf, textOf, type Telemetry } from "../net/telemetry.js";

/** The logger's levels: each a name and the function that prints at it. */
export type LoggerLevels = ReadonlyArray<{ name?: string; logFunc?: (...args: unknown[]) => void }>;

/**
 * Tells `hear` each warning and error the library prints from now on, with
 * what it printed, after it is printed as before; the function returned puts
 * the levels back as they were. The other levels are left alone. `levels` is
 * Babylon's own unless a test hands in its own.
 */
export function hearEngineLog(
  hear: (severity: "error" | "warn", args: unknown[]) => void,
  levels: LoggerLevels = (Logger as unknown as { _Levels: LoggerLevels })._Levels,
): () => void {
  const undo: Array<() => void> = [];
  for (const level of levels) {
    const original = level.logFunc;
    const severity = level.name === "Error" ? "error" : level.name === "Warn" ? "warn" : null;
    if (original === undefined || severity === null) continue;
    const mutable = level as { logFunc?: (...args: unknown[]) => void };
    mutable.logFunc = (...args: unknown[]) => {
      original(...args);
      try {
        hear(severity, args);
      } catch {
        // A listener must never be the page's next error.
      }
    };
    undo.push(() => {
      mutable.logFunc = original;
    });
  }
  return () => {
    for (const step of undo.reverse()) step();
  };
}

/**
 * Babylon's own log, heard: given `hear`, it tells it each warning and error
 * Babylon prints from then on, with what was printed, and returns what stops
 * it (`hearEngineLog`).
 */
export type EngineLog = (hear: (severity: "error" | "warn", args: unknown[]) => void) => () => void;

/** What Babylon puts before every line it logs: its name and the wall clock,
 * which would make every repeat of a line a new one. */
const BABYLON_PREFIX = /^BJS - \[\d{2}:\d{2}:\d{2}\]: /;

/**
 * Tells the page's telemetry each warning and error Babylon prints from now
 * on (kind `babylon`), without the clock Babylon puts before the line; the
 * function returned stops it. Nothing is listened to where the telemetry is
 * off. `log` is how Babylon's log is heard, its own unless a test hands in
 * another.
 */
export function tellEngineLog(telemetry: Pick<Telemetry, "enabled" | "error" | "warn">, log: EngineLog = hearEngineLog): () => void {
  if (!telemetry.enabled) return () => undefined;
  return log((severity, args) => telemetry[severity]("babylon", textOf(args).replace(BABYLON_PREFIX, ""), stackOf(args)));
}
