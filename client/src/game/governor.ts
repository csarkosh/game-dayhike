/**
 * The governor: on Auto, a hike whose frames stay slow is lowered one tier,
 * once, live (design §10). The class table and the probe start a machine on
 * the highest tier it should hold; the governor catches the machine, or the
 * window, for which that was wrong.
 *
 * Conservative on purpose, since a drop costs the player a rebuild:
 *
 * - nothing for **30 s** after the hike starts or a tier changes, while models
 *   stream in and shaders compile;
 * - frame intervals gathered in **10 s** windows. A window holding a frame
 *   that is not steady play (paused, a hidden tab, models still loading, a
 *   shader compiled, a tier being switched, the free camera) or a stall over
 *   **250 ms** is void: it neither counts nor breaks a run, as the probe's
 *   meter ignores the frames around a known hitch;
 * - a window whose mean interval is over **20.8 ms** (1.25 × the 60 Hz budget,
 *   48 fps) counts, one at or under resets the run;
 * - **three** counting windows in a row (30 s of play under 48 fps, after the
 *   grace) and the verdict is a drop, latched: once per hike, and never a raise;
 * - the drop is acted on at the first steady frame from the one that made it,
 *   never under the pause screen, and nothing at all once the session ends.
 *
 * Brief spikes cannot trip it: at 60 Hz a 200 ms hitch lifts its 10 s
 * window's mean by about 0.3 ms, against 4.1 ms of room to the limit. Pure:
 * the page feeds it `frame` and reads `verdict`.
 *
 * Before a drop is acted on, the page's own frame rate is timed with nothing
 * drawn (`actOnDrop`): a browser that draws below 60 Hz whatever the GPU
 * (Safari in Low Power Mode, a Mac running hot) is slow on every tier, and a
 * lower one would buy nothing.
 */
import { PROBE_HOLD_MS } from "./frameProbe.js";
import type { QualityTier } from "./quality.js";
import type { TierSource } from "./tierChoice.js";

export const GOVERNOR_START_MS = 30_000;
export const GOVERNOR_WINDOW_MS = 10_000;
export const GOVERNOR_LIMIT_MS = 20.8;
export const GOVERNOR_WINDOWS = 3;
export const GOVERNOR_STALL_MS = 250;
/** How long its HUD line shows. */
export const GOVERNOR_LINE_MS = 6_000;
/** The longest it times the page's idle frames before it stands down. */
export const GOVERNOR_IDLE_MAX_MS = 2_000;

const NAMES: Record<QualityTier, string> = { high: "High", medium: "Medium", low: "Low" };
const BELOW: Record<QualityTier, QualityTier | null> = { high: "medium", medium: "low", low: null };

export type Governor = {
  /** One frame's interval at `now`; `steady` false for a frame that is not
   * steady play, which voids its window. True on the one frame the drop is to
   * be acted on: the first steady frame from the one that made it, so a drop
   * made as the pause screen opens waits for play to resume. */
  frame(intervalMs: number, now: number, steady?: boolean): boolean;
  /** A new grace from `now` (the hike's session starting, a tier switched),
   * the run cleared; a drop once made, or acted on, is kept. */
  restart(now: number): void;
  /** The hike's session has ended: nothing more is counted or acted on. */
  stop(): void;
  readonly verdict: "none" | "drop";
};

export function createGovernor(start: number): Governor {
  let graceUntil = start + GOVERNOR_START_MS;
  let windowStart: number | null = null;
  let sum = 0;
  let count = 0;
  let voided = false;
  let run = 0;
  let verdict: "none" | "drop" = "none";
  let acted = false;
  let stopped = false;

  /** Closes the window: counts it, resets the run, or skips it when void.
   * True when that makes the verdict a drop. */
  const close = (): boolean => {
    if (!voided && count > 0) {
      if (sum / count > GOVERNOR_LIMIT_MS) run += 1;
      else run = 0;
    }
    sum = 0;
    count = 0;
    voided = false;
    if (run < GOVERNOR_WINDOWS) return false;
    verdict = "drop";
    return true;
  };

  /** Counts one frame toward the windows, until a drop is made. */
  const gather = (intervalMs: number, now: number, steady: boolean): void => {
    if (verdict === "drop" || now < graceUntil) return;
    if (windowStart === null) windowStart = graceUntil;
    while (now >= windowStart + GOVERNOR_WINDOW_MS) {
      windowStart += GOVERNOR_WINDOW_MS;
      if (close()) return;
    }
    if (!steady || !Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > GOVERNOR_STALL_MS) {
      voided = true;
      return;
    }
    sum += intervalMs;
    count += 1;
  };

  return {
    frame(intervalMs, now, steady = true) {
      if (stopped) return false;
      gather(intervalMs, now, steady);
      if (verdict !== "drop" || acted || !steady) return false;
      acted = true;
      return true;
    },
    stop() {
      stopped = true;
    },
    restart(now) {
      graceUntil = now + GOVERNOR_START_MS;
      windowStart = null;
      sum = 0;
      count = 0;
      voided = false;
      run = 0;
    },
    get verdict() {
      return verdict;
    },
  };
}

/** Whether a frame is steady play the governor may count: engaged, the menu
 * closed, the tab seen, nothing loading, no shader compiled since the last
 * frame, no tier being switched, and not the free camera, whose flight
 * rebuilds the fields every frame as walking never does. */
export function steadyFrame(frame: {
  engaged: boolean;
  menuOpen: boolean;
  visible: boolean;
  waitingItems: number;
  compiled: boolean;
  switching: boolean;
  freecam: boolean;
}): boolean {
  return (
    frame.engaged &&
    !frame.menuOpen &&
    frame.visible &&
    frame.waitingItems === 0 &&
    !frame.compiled &&
    !frame.switching &&
    !frame.freecam
  );
}

/** What a verdict does to the running tier: on Auto only (never a tier the
 * player chose, never under `?tier=`), and above low only, one step down. */
export function governorDecision(
  verdict: "none" | "drop",
  running: QualityTier,
  source: TierSource,
): { next: QualityTier } | null {
  if (verdict !== "drop" || source !== "auto") return null;
  const next = BELOW[running];
  return next === null ? null : { next };
}

/** The HUD line when it has acted. */
export function governorLine(next: QualityTier): string {
  return `Graphics lowered to ${NAMES[next]} to keep the game smooth.`;
}

/** What acting on a drop needs from the page. */
export type DropDeps = {
  /** Covers the game with an opaque screen and holds the controls; the
   * function returned lifts both. */
  cover(): () => void;
  /** Stops the render loop; the function returned runs it again. */
  stopLoop(): () => void;
  /** The page's idle frame interval with the loop stopped (`timeIdleCadence`,
   * bounded at `GOVERNOR_IDLE_MAX_MS`), or null when it could not be timed. */
  idleCadence(): Promise<number | null>;
  /** Writes the governor's verdict for the next start, from the running tier. */
  record(running: QualityTier): void;
  /** The live switch; the tier it reached. Rejects when no tier built, having
   * ended the hike. */
  switchTo(next: QualityTier): Promise<QualityTier>;
  flash(line: string, ms: number): void;
  log(line: string): void;
  /** False once the game is gone, its renderer broken or its session ended. */
  alive(): boolean;
  /** Calls `fn` when the hike's session ends; the function returned stops
   * that. */
  whenEnded(fn: () => void): () => void;
};

/**
 * Acts on a drop from `running` to `next`, under the cover. The loop stops and
 * the page's idle frames are timed first: when the page itself draws below
 * 60 Hz (over `PROBE_HOLD_MS`, the probe's bar), or its frames cannot be
 * timed, the governor stands down, writing nothing, with one line, and the
 * loop runs again. Otherwise the verdict is written, then the switch runs,
 * and the HUD line shows once the cover is lifted, only if the switch reached
 * `next`. The loop runs again whenever the switch was not reached, a throw
 * included; a switch that ran owns it. The cover lifts once: at the end, or
 * the moment the session ends, so the end of the hike is never hidden.
 */
export async function actOnDrop(
  running: QualityTier,
  next: QualityTier,
  deps: DropDeps,
): Promise<"lowered" | "fell-back" | "failed" | "held" | "gone"> {
  const cover = deps.cover();
  let lifted = false;
  const lift = (): void => {
    if (lifted) return;
    lifted = true;
    cover();
  };
  const unwatch = deps.whenEnded(lift);
  let resume: (() => void) | null = null;
  let switched = false;
  let outcome: "lowered" | "fell-back" | "failed" | "held" | "gone";
  try {
    resume = deps.stopLoop();
    const cadence = await deps.idleCadence();
    // Nothing written or switched; an ended session's last seconds still draw.
    if (!deps.alive()) return "gone";
    if (cadence === null || cadence > PROBE_HOLD_MS) {
      deps.log(
        cadence === null
          ? `quality governor: held at ${running}, the page's idle frames could not be timed`
          : `quality governor: held at ${running}, the page itself draws below 60 Hz (${cadence.toFixed(1)} ms a frame)`,
      );
      return "held";
    }
    deps.record(running);
    deps.log(`quality governor: ${running} → ${next}, 30 s of play under ${Math.floor(1000 / GOVERNOR_LIMIT_MS)} fps`);
    switched = true;
    try {
      outcome = (await deps.switchTo(next)) === next ? "lowered" : "fell-back";
    } catch {
      outcome = "failed";
    }
  } finally {
    unwatch();
    if (!switched) resume?.();
    lift();
  }
  if (outcome === "lowered" && deps.alive()) deps.flash(governorLine(next), GOVERNOR_LINE_MS);
  return outcome;
}
