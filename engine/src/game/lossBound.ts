/**
 * How many times a hike builds its renderer again after a lost device
 * before it stops.
 *
 * A lost device is answered by a new renderer on a new device, under a
 * cover over play (`answerFailures`). On a machine whose GPU keeps failing
 * that would cover the screen and build again without end, so the page
 * counts its losses: the loss that makes `LOSS_BOUND_COUNT` within
 * `LOSS_BOUND_WINDOW_MS` is not answered by another renderer, and the hike
 * ends with `lossEndedLine`, on its screen and then on the landing page.
 * Losses further apart than the window are each answered, however many.
 *
 * The record is the page's, not a hike's: the machine is the same in the
 * next hike. No engine and no clock of its own: the time is handed in.
 */
import { gameIdentity } from "../identity.js";

/** The loss that makes this many within the window ends the hike. */
export const LOSS_BOUND_COUNT = 3;
/** The window the losses are counted in (ms): ten minutes. */
export const LOSS_BOUND_WINDOW_MS = 600_000;

/** What a player reads when a hike is ended by the bound: on the hike's screen, then on the landing page. */
export function lossEndedLine(): string {
  return `The ${gameIdentity().session} ended: this device's graphics keep resetting. Restarting the browser may help.`;
}

/** What the record says of a loss as it notes it. */
export type LossNote = {
  /** Losses this page has had, this one included. */
  losses: number;
  /** Those within the window that ends at this one, this one included. */
  recent: number;
  /** How long since the loss before (ms); null for the first. */
  sinceMs: number | null;
  /** Whether the hike ends: this loss made `LOSS_BOUND_COUNT` within the window. */
  end: boolean;
};

export type LossRecord = {
  /** Notes a loss at `now` (ms, any clock that only goes forward) and says what the bound makes of it. */
  note(now: number): LossNote;
  /** Losses noted so far. */
  readonly losses: number;
};

export function createLossRecord(count: number = LOSS_BOUND_COUNT, windowMs: number = LOSS_BOUND_WINDOW_MS): LossRecord {
  let losses = 0;
  /** When the losses still inside a window ending now were, oldest first: the older ones are dropped as each is noted. */
  const recent: number[] = [];
  let last: number | null = null;
  return {
    get losses() {
      return losses;
    },
    note(now) {
      losses++;
      const sinceMs = last === null ? null : Math.max(0, now - last);
      last = now;
      while (recent.length > 0 && now - (recent[0] as number) > windowMs) recent.shift();
      recent.push(now);
      return { losses, recent: recent.length, sinceMs, end: recent.length >= count };
    },
  };
}
