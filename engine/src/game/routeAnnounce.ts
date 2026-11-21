import { afterNextPaint } from "./paint.js";

export type RouteAnnouncer = {
  /** Announce the current route now. */
  now(): void;
  /**
   * Announce once the next frame has painted, unless another announcement is
   * asked for first — the later route is the one followers must go to, and
   * an earlier one arriving after it would send them somewhere stale.
   */
  afterPaint(): void;
};

/**
 * Tells followers where the host is, at the right moment.
 *
 * Entering a game builds the world in one long synchronous task, a second or
 * more and far longer on a slow machine. A follower told about the game route
 * inside that task sends its connection offer at once, and the offer waits
 * unread until the task ends; past the follower's ICE timeout the join fails.
 * Announcing after the first painted frame means the host's thread is free
 * by the time anyone is invited.
 */
export function createRouteAnnouncer(
  announce: () => void,
  schedule: (fn: () => void) => void = afterNextPaint,
): RouteAnnouncer {
  // Bumped by every request, so a deferred announcement can tell that a newer
  // one has superseded it.
  let generation = 0;
  return {
    now() {
      generation += 1;
      announce();
    },
    afterPaint() {
      generation += 1;
      const mine = generation;
      schedule(() => {
        if (mine === generation) announce();
      });
    },
  };
}
