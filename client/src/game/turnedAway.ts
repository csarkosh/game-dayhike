/**
 * The page for a visitor who cannot play (`loadCheck.ts`): what is wrong
 * and what to do, in the landing page's type on the landing page's ground,
 * and nothing of the game. It paints a `TurnedAwayView`
 * (`turnedAwayModel.ts`), whose words are `turnedAwayWords.ts`'s.
 *
 * The title still stands behind it where one ships, as it stands behind the
 * landing page, with no loop: a visitor who cannot play is sent no film.
 * One column, as wide as a phone allows and no wider than the reading
 * measure; the text is real text in a `main` landmark under the page's one
 * heading, so a screen reader reads it top to bottom, and focus is put on
 * the heading as the page takes over, so that reading starts there when it
 * replaces a page already shown. Its controls are the download's link,
 * where there is one, and the credits at the foot, closed until asked for:
 * the still is a picture of the game, and the credit its works are owed has
 * to be within reach wherever it is shown, as it is from the landing page
 * (`credits.ts`). Tab reaches both and shows where it stands.
 *
 * Built with DOM APIs, never markup: a release's version and a GPU's
 * shortfall are text from outside the page.
 */
import type { Platform } from "@csarkosh/engine/net/desktopRelease";
import { creditItem, type CreditEntry } from "./credits.js";
import type { TurnedAwayView } from "./turnedAwayModel.js";

/** Shares the landing page's visual language: the same ground, type and cold cast. */
const STYLE = `
  .turned-away-bg {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; filter: blur(2px); transform: scale(1.03);
    opacity: 0;
  }
  .turned-away-bg.ready { opacity: 1; transition: opacity 900ms ease-in; }
  .turned-away {
    position: absolute; inset: 0; overflow-y: auto; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: safe center;
    gap: 0.75rem; padding: 1.5rem 1rem;
    /* The landing page's vignette, a shade deeper: this page is read, not glanced at. */
    background: radial-gradient(ellipse at center, rgba(16, 16, 20, 0.62) 0%, rgba(16, 16, 20, 0.88) 100%);
    font-family: ui-monospace, monospace; color: #fff;
    --edge-lit: rgba(214, 234, 234, 0.58);
  }
  .turned-away h1 {
    margin: 0 0 0.25rem; font-size: 2rem; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
  }
  .turned-away h1:focus { outline: none; }
  .turned-away p, .turned-away ul {
    margin: 0; max-width: 34rem; text-align: center; line-height: 1.5;
    color: rgba(255, 255, 255, 0.72); text-wrap: balance;
  }
  .turned-away .headline { color: #dbe2e2; font-size: 1.1rem; }
  .turned-away ul { list-style: none; padding: 0; color: rgba(255, 255, 255, 0.86); }
  .turned-away li + li { margin-top: 0.25rem; }
  .turned-away .browsers, .turned-away .app {
    display: flex; flex-direction: column; align-items: center; gap: 0.35rem; margin-top: 0.75rem;
  }
  .turned-away a.download {
    color: rgba(255, 255, 255, 0.9); text-decoration: underline; text-underline-offset: 0.2em;
  }
  .turned-away a.download:focus-visible { outline: 2px solid var(--edge-lit); outline-offset: 3px; }
  .turned-away .caption { font-size: 0.8rem; color: rgba(255, 255, 255, 0.5); }
  .turned-away .note { max-width: 22rem; }
  .turned-away .detail { margin-top: 1rem; font-size: 0.8rem; color: rgba(255, 255, 255, 0.5); overflow-wrap: anywhere; }
  .turned-away details { max-width: 34rem; font-size: 0.8rem; color: rgba(255, 255, 255, 0.5); text-align: center; }
  .turned-away summary { cursor: pointer; letter-spacing: 0.1em; text-transform: uppercase; }
  .turned-away summary:focus-visible { outline: 2px solid var(--edge-lit); outline-offset: 3px; }
  /* A work's name can be one long word (a file's): it breaks rather than widen the page past a narrow phone. */
  .turned-away details ul { margin-top: 0.5rem; font-size: 0.8rem; line-height: 1.6; color: rgba(255, 255, 255, 0.72); overflow-wrap: anywhere; }
  .turned-away details a { color: rgba(255, 255, 255, 0.9); text-decoration: underline; text-underline-offset: 0.2em; }
  .turned-away details a:focus-visible { outline: 2px solid var(--edge-lit); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .turned-away-bg.ready { transition: none; }
  }
  @media (max-width: 480px) {
    .turned-away { gap: 0.6rem; }
    .turned-away h1 { font-size: 1.4rem; letter-spacing: 0.1em; }
    .turned-away p, .turned-away ul { font-size: 0.85rem; max-width: 100%; }
    .turned-away .headline { font-size: 0.95rem; }
    .turned-away .caption, .turned-away .detail, .turned-away details, .turned-away details ul { font-size: 0.75rem; }
  }
`;

export type TurnedAwayHandle = {
  /** Repaints what follows the view: the app's release lands after the page is up. */
  setView(view: TurnedAwayView): void;
  dispose(): void;
};

/**
 * Puts the page in `container`, over `still` where there is one, and gives
 * the heading the focus. `credits` are the works credited at the foot
 * (`creditsEntries`); `onDownload` hears the download's link followed.
 */
export function renderTurnedAway(
  container: HTMLElement,
  view: TurnedAwayView,
  options: { still: string | null; credits: readonly CreditEntry[]; onDownload?(platform: Platform): void },
): TurnedAwayHandle {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const ground = options.still === null ? null : document.createElement("img");
  if (ground !== null && options.still !== null) {
    ground.className = "turned-away-bg";
    ground.setAttribute("alt", "");
    ground.setAttribute("decoding", "async");
    ground.addEventListener("load", () => ground.classList.add("ready"), { once: true });
    ground.setAttribute("src", options.still);
  }

  const root = document.createElement("main");
  root.className = "turned-away";
  const title = document.createElement("h1");
  title.id = "turned-away-title";
  // Focusable from here, not from the keyboard: where reading starts.
  title.tabIndex = -1;
  root.setAttribute("aria-labelledby", title.id);
  const body = document.createElement("div");
  body.style.display = "contents";
  // The credits, made once and closed: a repaint of what is above them leaves them as the visitor has them.
  const credits = document.createElement("details");
  const creditsWord = document.createElement("summary");
  const creditsList = document.createElement("ul");
  for (const e of options.credits) creditsList.append(creditItem(e));
  credits.append(creditsWord, creditsList);
  root.append(title, body);
  if (options.credits.length > 0) root.append(credits);

  const line = (className: string, text: string): HTMLParagraphElement => {
    const p = document.createElement("p");
    if (className !== "") p.className = className;
    p.textContent = text;
    return p;
  };

  function paint(v: TurnedAwayView): void {
    // The reason as data on the landmark (`data-reason`): shown nowhere, read by the desktop app's check of itself.
    root.dataset.reason = v.reason;
    title.textContent = v.title;
    creditsWord.textContent = v.credits;
    const parts: Node[] = [line("headline", v.headline), ...v.advice.map((text) => line("", text))];
    if (v.browsers !== null) {
      const browsers = document.createElement("div");
      browsers.className = "browsers";
      const list = document.createElement("ul");
      for (const text of v.browsers.lines) {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
      }
      browsers.append(line("", v.browsers.intro), list);
      parts.push(browsers);
    }
    if (v.app !== null) {
      const { card } = v.app;
      const app = document.createElement("div");
      app.className = "app";
      const link = document.createElement("a");
      link.className = "download";
      link.href = card.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = card.label;
      link.addEventListener("click", () => options.onDownload?.(card.platform));
      app.append(line("", v.app.intro), link, line("caption", card.caption), line("caption note", card.note));
      parts.push(app);
    }
    parts.push(line("detail", v.detail));
    body.replaceChildren(...parts);
  }

  paint(view);
  if (ground !== null) container.append(ground);
  container.append(style, root);
  title.focus({ preventScroll: true });

  return {
    setView: paint,
    dispose() {
      root.remove();
      style.remove();
      ground?.remove();
    },
  };
}
