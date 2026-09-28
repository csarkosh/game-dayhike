/**
 * Waiting for a WebGPU frame that left no draw out while its render pipeline
 * was made (`asyncPipelines.ts`, `revealWhenWhole`): the start's hold on its
 * world, and a switch's cover. The page's side of it, apart from the engine,
 * so it can be shown without one; the WebGL2 path never calls either.
 */

/** What the start's hold does to the page. */
export type RevealHoldDeps = {
  /** Hides the world (its canvas), or shows it again. */
  hideWorld(hidden: boolean): void;
  /** Shows the hold's "Loading…" line, or takes it down. */
  showLine(shown: boolean): void;
  /** Lets go of the line for good, once the hold has lifted. */
  releaseLine(): void;
  /** The game HUD's own status line, "" when it says nothing. */
  status(): string;
  /** Calls `fn` after each frame; returns what stops it. */
  eachFrame(fn: () => void): () => void;
  /** Calls `lift` once a frame left nothing out, bounded
   * (`revealWhenWhole`); returns what stops waiting. */
  reveal(lift: () => void): () => void;
};

/**
 * Holds the start's world hidden until a frame leaves no draw out (the
 * reveal's own bound, 10 s after the first frame at most), with a "Loading…"
 * line shown only while the game's own HUD says nothing: a follower sees
 * "Connecting…" alone, and the line once that has gone. The line is let go
 * of however the hold lifts. Returns a function that lifts the hold at once
 * (a switch of tier, the game's end), and stops waiting; the hold lifts once,
 * whichever comes first.
 */
export function holdReveal(deps: RevealHoldDeps): () => void {
  let lifted = false;
  let lineShown = false;
  const matchLine = (): void => {
    const wanted = !lifted && deps.status() === "";
    if (wanted === lineShown) return;
    lineShown = wanted;
    deps.showLine(wanted);
  };
  deps.hideWorld(true);
  matchLine();
  const stopFrames = deps.eachFrame(matchLine);
  let stopReveal: () => void = () => undefined;
  const lift = (): void => {
    if (lifted) return;
    lifted = true;
    stopFrames();
    stopReveal();
    deps.hideWorld(false);
    matchLine();
    deps.releaseLine();
  };
  stopReveal = deps.reveal(lift);
  // A reveal that answered at once found nothing to stop yet.
  if (lifted) stopReveal();
  return lift;
}

/**
 * Resolves once `watch` calls its argument (a frame that left nothing out,
 * `revealWhenWhole`), or after `ms`, what is left of a cover's bound, and
 * stops watching either way; at once, watching nothing, where nothing is left.
 */
export function whenFrameWhole(watch: (lift: () => void) => () => void, ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let stop: () => void = () => undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(finish, ms);
    stop = watch(finish);
    if (done) stop();
  });
}
