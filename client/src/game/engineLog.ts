/**
 * The warnings and errors of the library the game draws with, for the page's
 * telemetry (`installErrorCapture`, `net/telemetry.ts`).
 *
 * Babylon takes `console.warn` and `console.error` into its logger's levels
 * (`Logger._Levels`) when its module loads, before the page's wrap of the
 * console exists, so its warnings and errors (a GPU validation error, an
 * effect that would not compile) never pass through that wrap; the levels'
 * own functions are wrapped instead.
 */
import { Logger } from "@babylonjs/core/Misc/logger.js";

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
