import { PENDING_AFTER_MS, OVERRUN_MS, type RosterAttempt } from "./rosterModel.js";

/**
 * How often the pending bar moves. Fast enough to read as motion, slow enough
 * that it costs nothing next to the scene behind it; the renderer's 120 ms CSS
 * transition smooths the steps between.
 */
export const ATTEMPT_TICK_MS = 100;

export type AttemptClock = {
  /** The attempt as `rosterModel` wants it, recomputed on every read. */
  readonly attempt: RosterAttempt;
  /** The socket came up. The first call wins; later ones are reconnects. */
  connected(): void;
  stop(): void;
};

/**
 * The clock behind the roster's pending bar.
 *
 * Splits its callbacks in two because the panel is rebuilt wholesale by
 * `Roster.setView`: `onRepaint` fires only at the three moments the panel's
 * structure actually changes — the bar appearing, the stage label changing,
 * the Retry row arriving — while `onTick` fires ten times a second for the bar
 * alone, which the renderer moves without touching the DOM around it. Doing it
 * all through `onRepaint` would tear the Retry button out from under a
 * keyboard user every 100 ms.
 *
 * `now` is injectable so the schedule can be tested against fake timers.
 */
export function startAttemptClock(options: {
  kind: RosterAttempt["kind"];
  onRepaint(): void;
  onTick(): void;
  now?: () => number;
}): AttemptClock {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let connectedAt: number | null = null;

  // The two structural moments that are pure functions of time. The third —
  // the stage label changing — is an event, and arrives through `connected`.
  const timers = [
    setTimeout(options.onRepaint, PENDING_AFTER_MS),
    setTimeout(options.onRepaint, OVERRUN_MS),
  ];
  // Started now rather than at PENDING_AFTER_MS: before the bar exists the
  // renderer's `setPendingProgress` is a no-op, which is cheaper than a second
  // timer to schedule this one.
  const tick = setInterval(options.onTick, ATTEMPT_TICK_MS);

  return {
    get attempt(): RosterAttempt {
      return {
        kind: options.kind,
        elapsedMs: now() - startedAt,
        connectedAtMs: connectedAt === null ? null : connectedAt - startedAt,
      };
    },
    connected() {
      // A socket that drops and comes back mid-attempt must not rewind the
      // bar to "Connecting" or restart the stage it is already past.
      if (connectedAt !== null) return;
      connectedAt = now();
      options.onRepaint();
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      clearInterval(tick);
    },
  };
}
