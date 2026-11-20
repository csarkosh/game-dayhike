/**
 * A hike's extras (the signs and the board at the trailhead, the body at the
 * crest) built in a task after the one that asked. Under the intro's film no
 * frame shows them, and making them was a tenth of the build's one task on a
 * phone; the task after the build makes them instead, long before the world
 * is called ready.
 *
 * `build` runs once, in that task, and only if `still()` then says the hike
 * and its renderer are the ones that asked and nothing has built the extras
 * meanwhile (a swap of the renderer builds its own); `cancel` drops a build
 * still to come. A throw in `build` goes to `failed` and nowhere else: the
 * task is outside the start's own catch, and a hike without its signs goes on.
 */
export function extrasLater(deps: {
  build: () => void;
  still: () => boolean;
  failed: (error: unknown) => void;
  /** How the task is asked for: a `setTimeout(0)` when absent. For the tests. */
  later?: (run: () => void) => void;
}): { cancel(): void } {
  const later = deps.later ?? ((run: () => void): void => void setTimeout(run, 0));
  let cancelled = false;
  later(() => {
    if (cancelled || !deps.still()) return;
    try {
      deps.build();
    } catch (error) {
      deps.failed(error);
    }
  });
  return {
    cancel() {
      cancelled = true;
    },
  };
}
