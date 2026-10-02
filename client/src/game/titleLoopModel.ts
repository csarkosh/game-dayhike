/**
 * The title page's loop, decided (`docs/gameplay/2026-10-01-title-loop.md` §4): the still alone, or
 * the still until the loop can play through, then the loop. Pure; `titleLoop.ts` draws it.
 */
export type TitleLoopEnv = { saveData: boolean; effectiveType: string | null; reducedMotion: boolean; hasFilm: boolean };
export type TitleLoopPhase = "still" | "waiting" | "loading" | "showing" | "stopped";
export type TitleLoopState = { phase: TitleLoopPhase; hidden: boolean };
export type TitleLoopEvent = "load" | "canplaythrough" | "error" | "refused" | "play" | "hidden" | "visible";
export type TitleLoopView = { src: boolean; playing: boolean; still: boolean };

/** The connections too slow for the loop; a browser that does not say counts as fast. */
const SLOW = new Set(["slow-2g", "2g", "3g"]);

export function titleLoopStart(env: TitleLoopEnv): TitleLoopState {
  const still = !env.hasFilm || env.saveData || env.reducedMotion || (env.effectiveType !== null && SLOW.has(env.effectiveType));
  return { phase: still ? "still" : "waiting", hidden: false };
}

export function titleLoopNext(state: TitleLoopState, event: TitleLoopEvent): TitleLoopState {
  if (event === "hidden" || event === "visible") return { ...state, hidden: event === "hidden" };
  if (state.phase === "still" || state.phase === "stopped") return state;
  if (event === "play") return { ...state, phase: "stopped" };
  if (event === "error" || event === "refused") return { ...state, phase: "still" };
  if (event === "load" && state.phase === "waiting") return { ...state, phase: "loading" };
  if (event === "canplaythrough" && state.phase === "loading") return { ...state, phase: "showing" };
  return state;
}

export function titleLoopView(state: TitleLoopState): TitleLoopView {
  const showing = state.phase === "showing";
  return { src: state.phase === "loading" || showing, playing: showing && !state.hidden, still: !showing };
}
