/**
 * The intro's playback as a pure model: the video's time, the world's
 * readiness, the player's hold and their click go in; one of five states
 * and what to show come out. Nothing here touches the DOM or the sim.
 *
 * The cut is always on a gesture: a completed hold while the film plays,
 * or the step-out click on the held last frame. Neither the world's
 * readiness nor the film's end cuts on its own, so the game never lands in
 * the pause menu with no click to have taken the pointer.
 */
export type IntroState = "playing" | "readyToSkip" | "holding" | "holdingLast" | "cut";

export type PlaybackView = {
  state: IntroState;
  /** 0 to 1 while a hold runs; 0 otherwise. */
  holdFraction: number;
  showSkip: boolean;
  showStepOut: boolean;
  /** The game's name over black, once, after the film ends. */
  titleCard: boolean;
};

/** How long a key, button or touch is held to skip (ms). */
export const HOLD_MS = 800;
/** How long the title card shows after the film's last frame (ms). */
export const TITLE_CARD_MS = 3000;

export type IntroPlayback = {
  tick(now: number, videoTime: number, ended: boolean): void;
  ready(): void;
  holdStart(now: number): void;
  holdEnd(now: number): void;
  /** The step-out click on the held last frame. */
  gesture(): void;
  hidden(on: boolean, now: number): void;
  state(): IntroState;
  view(): PlaybackView;
};

export function createIntroPlayback(input: { holdMs?: number }): IntroPlayback {
  const holdMs = input.holdMs ?? HOLD_MS;
  let state: IntroState = "playing";
  let isReady = false;
  let holdSince: number | null = null;
  let holdFraction = 0;
  let endedAt: number | null = null;
  let cardShown = false;
  let isHidden = false;

  const settle = (): void => {
    if (state === "cut") return;
    if (endedAt !== null) { state = "holdingLast"; return; }
    if (holdSince !== null && isReady) { state = "holding"; return; }
    state = isReady ? "readyToSkip" : "playing";
  };

  return {
    tick(now, _videoTime, ended) {
      if (state === "cut") return;
      if (ended && endedAt === null) { endedAt = now; holdSince = null; holdFraction = 0; }
      if (endedAt !== null && !cardShown && now - endedAt >= TITLE_CARD_MS) cardShown = true;
      if (isHidden) return;
      if (holdSince !== null && isReady && endedAt === null) {
        holdFraction = Math.min(1, (now - holdSince) / holdMs);
        if (holdFraction >= 1) { state = "cut"; return; }
      }
      settle();
    },
    ready() { isReady = true; settle(); },
    holdStart(now) {
      if (state === "cut" || endedAt !== null || isHidden) return;
      holdSince = now;
      holdFraction = 0;
      settle();
    },
    holdEnd() {
      if (state === "cut") return;
      holdSince = null;
      holdFraction = 0;
      settle();
    },
    gesture() {
      if (state === "holdingLast" && isReady && cardShown) state = "cut";
    },
    hidden(on) {
      isHidden = on;
      if (on) { holdSince = null; holdFraction = 0; }
      settle();
    },
    state: () => state,
    view() {
      return {
        state,
        holdFraction: state === "holding" ? holdFraction : 0,
        showSkip: state === "readyToSkip" || state === "holding",
        showStepOut: state === "holdingLast" && isReady && cardShown,
        titleCard: endedAt !== null && !cardShown,
      };
    },
  };
}
