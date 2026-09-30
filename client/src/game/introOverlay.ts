/**
 * The intro over the start: the video letterboxed on black, the caption
 * under it driven by the video's own clock, the loading bar and its line in
 * the lower band, `hold to skip` once the world is ready, the title card
 * over black after the last shot, then the last frame held with `click to
 * step out`. A dumb renderer of two pure models: the playback
 * (`introPlayback.ts`: what the hold, the end and the gestures mean) and the
 * load (`loadProgress.ts`: what the bar and the line say). Everything
 * written to the page is `textContent`, never markup.
 */
import { createIntroPlayback, type IntroPlayback } from "./introPlayback.js";
import { createLoadProgress, type LoadProgress } from "./loadProgress.js";

/** One caption: shown while the video's time is in [from, to), seconds. A
 * `\n` in the text is its second line. */
export type Caption = { from: number; to: number; text: string; radio: boolean };

/** Why the intro cut to the game: a full hold or the step-out click (both
 * gestures, so the cut can take the pointer), or the video failing, which
 * starts the game as a start with no intro does. */
export type CutReason = "hold" | "stepOut" | "error";

export type IntroOverlay = {
  video: HTMLVideoElement;
  progress: LoadProgress;
  playback: IntroPlayback;
  /** Puts the overlay in `container`, or moves it there: the page the Play
   * click made it on is replaced by the game's. */
  mount(container: HTMLElement): void;
  /** Starts the video; call inside the Play click's own task so it plays with sound. */
  play(): Promise<void>;
  /** Seconds of video buffered past the current time. */
  bufferedAhead(): number;
  /** The world is ready: `hold to skip` may show, and the held last frame may be stepped out of. */
  ready(): void;
  /** Draws the models' state; `now` in ms on the page's clock, as an animation frame gives it. */
  render(now?: number): void;
  /** The start failed: the video stops and the overlay goes, leaving the container to the panel. */
  stop(): void;
  dispose(): void;
};

export type IntroOverlayDeps = {
  /** The video element, made by the document. */
  video(): HTMLVideoElement;
  /** The page's clock (ms), the one animation frames are stamped with. */
  now(): number;
};

/** The video above the pause menu, the roster and the probe's screen, which
 * all belong to the hike it covers. */
const INTRO_Z = 30;

const STYLE = `
  /* The bands above and below the film hold the caption (two lines and its
     margin), the bar and the line: never under --band, so a wide viewport,
     where the film at full width would leave them 1/18 of it, pillarboxes
     the film instead. */
  .intro { --band: clamp(110px, 12vh, 160px); position: absolute; inset: 0; background: #000; display: grid; grid-template-rows: minmax(var(--band), 1fr) auto minmax(var(--band), 1fr); z-index: ${INTRO_Z}; user-select: none; }
  .intro video { grid-column: 1; grid-row: 2; justify-self: center; width: min(100%, calc((100vh - 2 * var(--band)) * 2)); aspect-ratio: 2 / 1; display: block; }
  /* The caption and the bar share the lower band: both in the one column,
     or the grid would place the second in an implicit column of its own. */
  .intro-caption { grid-column: 1; grid-row: 3; align-self: start; margin: 14px auto 0; max-width: 44ch; text-align: center; white-space: pre-line; color: #eee; font: 500 clamp(16px, 2.4vh, 26px)/1.35 system-ui, sans-serif; }
  .intro-caption.radio { font-style: italic; }
  .intro-caption.radio::before { content: "Dispatch (radio): "; font-style: normal; opacity: 0.7; }
  .intro-bar { grid-column: 1; grid-row: 3; align-self: end; margin: 0 16px 10px; height: 2px; background: rgba(255,255,255,0.15); }
  .intro-bar-fill { height: 100%; width: 0%; background: rgba(255,255,255,0.7); transition: width 300ms linear; }
  .intro-line { position: absolute; right: 16px; bottom: 16px; color: rgba(255,255,255,0.55); font: 12px/1.4 system-ui, sans-serif; }
  .intro-skip, .intro-stepout { position: absolute; left: 16px; bottom: 16px; color: rgba(255,255,255,0.7); font: 12px/1.4 system-ui, sans-serif; opacity: 0; transition: opacity 400ms; }
  .intro-skip.shown, .intro-stepout.shown { opacity: 1; }
  .intro-ring { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.35); margin-right: 8px; vertical-align: -2px; }
  .intro-sound { position: absolute; top: 16px; right: 16px; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.35); border-radius: 4px; background: rgba(0,0,0,0.35); color: rgba(255,255,255,0.85); font: 12px/1.4 system-ui, sans-serif; cursor: pointer; opacity: 0.3; transition: opacity 400ms; }
  .intro-sound.muted { opacity: 1; }
  .intro-sound:hover { opacity: 1; }
  .intro-title { position: absolute; inset: 0; display: grid; place-items: center; color: #ddd; font: 300 clamp(28px, 6vw, 64px)/1 system-ui, sans-serif; letter-spacing: 0.3em; background: #000; opacity: 0; transition: opacity 600ms; pointer-events: none; }
  .intro-title.shown { opacity: 1; }
`;

/**
 * The captions of the film's call, against the video's clock, until the
 * staged scene's own caption track replaces them: each line at the shot the
 * spec puts it in, dispatch's lines marked as heard through the radio.
 */
export const INTRO_CAPTIONS: readonly Caption[] = [
  { from: 15.0, to: 16.4, text: "Four-one, dispatch.", radio: true },
  { from: 16.4, to: 17.8, text: "Four-one. Go ahead.", radio: false },
  { from: 17.8, to: 20.9, text: "We've had reports of a missing hiker.\nLast seen at Trail 14.", radio: true },
  { from: 20.9, to: 22.6, text: "Copy. Anyone see them come down?", radio: false },
  { from: 22.6, to: 26.0, text: "Last sighting was near the summit.\nThe caller didn't leave a name.", radio: true },
  { from: 26.0, to: 28.0, text: "All right. Who's meeting me out there?", radio: false },
  { from: 28.0, to: 29.5, text: "I've got nobody else to send.", radio: true },
  { from: 29.5, to: 33.0, text: "Figures. I'm ten minutes out.\nUp to the summit and back before dark.", radio: false },
  { from: 33.0, to: 35.8, text: "Four-one, be advised,\nradio won't carry past the road.", radio: true },
  { from: 35.8, to: 37.8, text: "If anything... ...get back to the road.", radio: true },
  { from: 37.8, to: 40.4, text: "Dispatch, you're breaking up.\n...Dispatch?", radio: false },
];

const defaultDeps = (): IntroOverlayDeps => ({
  video: () => document.createElement("video"),
  now: () => performance.now(),
});

export function createIntroOverlay(
  container: HTMLElement,
  input: {
    src: string;
    captions: readonly Caption[];
    /** Start with the sound off: a page moved to the hike by another's Play
     * has no gesture of its own, and a browser plays a video without one
     * only muted. The sound button, plain while muted, turns it on. */
    muted?: boolean;
    onCut(reason: CutReason): void;
  },
  deps: IntroOverlayDeps = defaultDeps(),
): IntroOverlay {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "intro";
  const video = deps.video();
  video.setAttribute("src", input.src);
  video.setAttribute("playsinline", "");
  video.setAttribute("preload", "auto");
  video.muted = input.muted === true;
  const sound = document.createElement("button");
  sound.className = "intro-sound";
  sound.setAttribute("type", "button");
  const caption = document.createElement("div");
  caption.className = "intro-caption";
  const bar = document.createElement("div");
  bar.className = "intro-bar";
  const fill = document.createElement("div");
  fill.className = "intro-bar-fill";
  fill.style.width = "0%";
  bar.append(fill);
  const line = document.createElement("div");
  line.className = "intro-line";
  const skip = document.createElement("div");
  skip.className = "intro-skip";
  const ring = document.createElement("span");
  ring.className = "intro-ring";
  skip.append(ring, "hold to skip");
  const stepOut = document.createElement("div");
  stepOut.className = "intro-stepout";
  stepOut.textContent = "click to step out";
  const title = document.createElement("div");
  title.className = "intro-title";
  title.textContent = "DAY HIKE";
  root.append(video, caption, bar, line, skip, stepOut, sound, title);
  container.append(style, root);

  const progress = createLoadProgress();
  const playback = createIntroPlayback({});
  let cut = false;
  const doCut = (reason: CutReason): void => {
    if (cut) return;
    cut = true;
    input.onCut(reason);
  };
  const holdStart = (): void => playback.holdStart(deps.now());
  // A release after a full hold is the cut, here in the release's own
  // event so the game takes the pointer on it.
  const holdEnd = (): void => {
    playback.holdEnd(deps.now());
    if (playback.state() === "cut") doCut("hold");
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!e.repeat) holdStart();
  };
  // The step-out click is a gesture on the held last frame; before that a
  // press is the start of a hold.
  const onPointerDown = (e: Event): void => {
    // The sound button's press is its own, not a hold.
    if (e.target === sound) return;
    if (playback.view().showStepOut) {
      playback.gesture();
      // Cut here, in the click's own task, so the game takes the pointer on it.
      if (playback.state() === "cut") doCut("stepOut");
    } else holdStart();
  };
  const onVisibility = (): void => {
    const hidden = document.visibilityState === "hidden";
    playback.hidden(hidden, deps.now());
    if (hidden) video.pause();
    else if (!video.ended) void video.play().catch(() => undefined);
  };
  const onError = (): void => {
    stop();
    doCut("error");
  };
  const onSoundClick = (): void => {
    video.muted = !video.muted;
    drawSound();
  };
  const drawSound = (): void => {
    sound.classList.toggle("muted", video.muted);
    sound.textContent = video.muted ? "sound off" : "sound on";
  };
  drawSound();
  sound.addEventListener("click", onSoundClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", holdEnd);
  window.addEventListener("pointerup", holdEnd);
  root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("visibilitychange", onVisibility);
  video.addEventListener("error", onError);

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    root.remove();
    style.remove();
  }

  return {
    video,
    progress,
    playback,
    mount(next) {
      if (!stopped) next.append(style, root);
    },
    play: () => video.play(),
    bufferedAhead() {
      const t = video.currentTime;
      const ranges = video.buffered;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= t && t <= ranges.end(i)) return ranges.end(i) - t;
      }
      return 0;
    },
    ready: () => playback.ready(),
    render(now = deps.now()) {
      if (stopped) return;
      const t = video.currentTime;
      playback.tick(now, t, video.ended);
      const pv = playback.view();
      const c = input.captions.find((x) => x.from <= t && t < x.to);
      caption.textContent = c?.text ?? "";
      caption.classList.toggle("radio", c?.radio ?? false);
      const g = progress.view();
      fill.style.width = `${Math.round(g.bar * 100)}%`;
      line.textContent = g.line;
      skip.classList.toggle("shown", pv.showSkip);
      ring.style.background = `conic-gradient(rgba(255,255,255,0.9) ${Math.round(pv.holdFraction * 360)}deg, transparent 0)`;
      stepOut.classList.toggle("shown", pv.showStepOut);
      title.classList.toggle("shown", pv.titleCard);
      drawSound();
    },
    stop,
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", holdEnd);
      window.removeEventListener("pointerup", holdEnd);
      document.removeEventListener("visibilitychange", onVisibility);
      video.removeEventListener("error", onError);
      stop();
    },
  };
}
