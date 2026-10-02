/**
 * The title page's backdrop: the loop behind its still, drawn as `titleLoopModel.ts` says. The video
 * is muted, inline and looping, with no source until the page has loaded; the still fades when the
 * loop can play through and comes back for good on an error or a refused play. Each is drawn only
 * once it ships.
 */
import { titleLoopNext, titleLoopStart, titleLoopView, type TitleLoopEnv, type TitleLoopEvent } from "./titleLoopModel.js";

export type TitleLoop = { stop(): void; dispose(): void };

export function createTitleLoop(container: HTMLElement, still: string | null, video: string | null, env: Omit<TitleLoopEnv, "hasFilm">): TitleLoop {
  const el = video === null ? null : document.createElement("video");
  if (el !== null) {
    for (const a of ["muted", "playsinline", "loop", "disablepictureinpicture", "disableremoteplayback"]) el.setAttribute(a, "");
    el.muted = true;
    el.setAttribute("preload", "none");
    el.setAttribute("aria-hidden", "true");
    el.className = "landing-loop";
    container.append(el);
  }
  const img = still === null ? null : document.createElement("img");
  if (img !== null && still !== null) {
    img.className = "landing-bg ready";
    img.setAttribute("src", still);
    img.setAttribute("alt", "");
    img.setAttribute("decoding", "async");
    container.append(img);
  }

  let state = titleLoopStart({ ...env, hasFilm: el !== null });
  const apply = (): void => {
    const view = titleLoopView(state);
    if (el !== null && video !== null) {
      if (view.src && el.getAttribute("src") === null) {
        el.setAttribute("src", video);
        el.setAttribute("preload", "auto");
      } else if (!view.src && el.getAttribute("src") !== null) {
        el.removeAttribute("src");
        el.load(); // drops the download in flight
      }
      if (view.playing) el.play().catch(() => send("refused"));
      else if (!el.paused) el.pause();
    }
    if (img !== null) img.className = view.still ? "landing-bg ready" : "landing-bg ready gone";
  };
  const send = (event: TitleLoopEvent): void => {
    state = titleLoopNext(state, event);
    apply();
  };
  const onLoad = (): void => send("load");
  const onCan = (): void => send("canplaythrough");
  const onError = (): void => send("error");
  const onVisibility = (): void => send(document.visibilityState === "hidden" ? "hidden" : "visible");
  el?.addEventListener("canplaythrough", onCan);
  el?.addEventListener("error", onError);
  document.addEventListener("visibilitychange", onVisibility);
  // A page opened in a background tab starts hidden, and no event says so.
  if (document.visibilityState === "hidden") send("hidden");
  if (document.readyState === "complete") send("load");
  else window.addEventListener("load", onLoad);
  apply();

  return {
    stop: () => send("play"),
    dispose: () => {
      send("play");
      el?.removeEventListener("canplaythrough", onCan);
      el?.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("load", onLoad);
      el?.remove();
      img?.remove();
    },
  };
}

/** What the browser says of the connection and the visitor's settings. */
export function titleLoopEnv(): Omit<TitleLoopEnv, "hasFilm"> {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}
