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
 *   shader compiled, a tier being switched) or a stall over **250 ms** is
 *   void: it neither counts nor breaks a run, as the probe's meter ignores the
 *   frames around a known hitch;
 * - a window whose mean interval is over **20.8 ms** (1.25 × the 60 Hz budget,
 *   48 fps) counts, one at or under resets the run;
 * - **three** counting windows in a row (30 s of play under 48 fps, after the
 *   grace) and the verdict is a drop, latched: once per hike, and never a raise.
 *
 * Brief spikes cannot trip it: a 200 ms hitch lifts its window's mean by
 * 0.02 ms per second of window. Pure: the page feeds it `frame` and reads
 * `verdict`.
 */
import type { QualityTier } from "./quality.js";
import type { TierSource } from "./tierChoice.js";

export const GOVERNOR_START_MS = 30_000;
export const GOVERNOR_WINDOW_MS = 10_000;
export const GOVERNOR_LIMIT_MS = 20.8;
export const GOVERNOR_WINDOWS = 3;
export const GOVERNOR_STALL_MS = 250;
/** How long its HUD line shows. */
export const GOVERNOR_LINE_MS = 6_000;

const NAMES: Record<QualityTier, string> = { high: "High", medium: "Medium", low: "Low" };
const BELOW: Record<QualityTier, QualityTier | null> = { high: "medium", medium: "low", low: null };

export type Governor = {
  /** One frame's interval at `now`; `steady` false for a frame that is not
   * steady play, which voids its window. */
  frame(intervalMs: number, now: number, steady?: boolean): void;
  /** A new grace from `now` (the hike's session starting, a tier switched),
   * the run cleared; a drop once made is kept. */
  restart(now: number): void;
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

  return {
    frame(intervalMs, now, steady = true) {
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
 * frame, no tier being switched. */
export function steadyFrame(frame: {
  engaged: boolean;
  menuOpen: boolean;
  visible: boolean;
  waitingItems: number;
  compiled: boolean;
  switching: boolean;
}): boolean {
  return frame.engaged && !frame.menuOpen && frame.visible && frame.waitingItems === 0 && !frame.compiled && !frame.switching;
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
