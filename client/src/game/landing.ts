/** Shares the pause menu's visual language: same ground, type, and buttons. */
const STYLE = `
  .landing-bg {
    position: absolute; inset: 0; width: 100%; height: 100%;
    filter: blur(6px);
    /* Blur samples past the edges; scaling hides the resulting bright rim. */
    transform: scale(1.08);
    /* Hidden until the scene reports ready. Babylon skips a mesh whose shader
       is still compiling, so the first frames draw the sky alone — the
       brightest thing in the scene — and that reads as a flash on load. The
       page background shows through meanwhile, which is already the dark grey
       the settled scene resolves to. */
    opacity: 0;
  }
  /* The transition lives on the revealed state, not on the base rule: the
     canvas enters the DOM before this stylesheet does, so a transition there
     would animate the initial 1 -> 0 and fade the bright frames out in view
     instead of never showing them. */
  .landing-bg.ready { opacity: 1; transition: opacity 900ms ease-in; }
  .landing {
    /* The positioning context for the two panels below; they carry the layout
       and the scrolling, because each panel is now the box that holds the
       content a short viewport has to scroll. */
    position: relative; height: 100%;
    /* Translucent vignette over the scenery; reads as the old flat #101014
       when WebGL is unavailable and no backdrop renders behind it. */
    background: radial-gradient(
      ellipse at center,
      rgba(16, 16, 20, 0.35) 0%,
      rgba(16, 16, 20, 0.78) 100%
    );
    font-family: ui-monospace, monospace; color: #fff;
  }
  /* Two panels in the same box: home slides out to the left as credits slides
     in from the right, and back reverses it. Both are absolutely positioned
     so the swap never shifts layout. */
  /* Each panel scrolls itself. index.html hides the document's overflow, so a
     viewport too short for the stacked download cards — a phone held sideways
     at 667x375 — clipped them with nothing to scroll. A panel is exactly one
     viewport tall (inset: 0 on a full-height parent) and takes the overflow,
     and the safe keyword keeps the centred layout wherever there is room while
     falling back to flex-start when there is not, so the top stays reachable
     rather than scrolled off. (No backticks in here: this is a template
     literal.) */
  .landing .panel {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center;
    justify-content: safe center; gap: 0.75rem;
    overflow-y: auto; box-sizing: border-box; padding: 1rem 0;
    transition: opacity 240ms ease-out, transform 240ms ease-out;
  }
  .landing .panel.home { opacity: 1; transform: translateX(0); }
  .landing.show-downloads .panel.home, .landing.show-credits .panel.home {
    opacity: 0; transform: translateX(-24px); pointer-events: none;
  }
  .landing .panel.downloads, .landing .panel.credits { opacity: 0; transform: translateX(24px); pointer-events: none; }
  .landing.show-downloads .panel.downloads, .landing.show-credits .panel.credits {
    opacity: 1; transform: translateX(0); pointer-events: auto;
  }
  .landing .panel.downloads h2, .landing .panel.credits h2 {
    margin: 0; font-size: 1.4rem; letter-spacing: 0.1em; text-transform: uppercase;
  }
  /* The list scrolls, and at 1080p it shows about half of itself. macOS draws
     overlay scrollbars — nothing at all until something scrolls — so there was
     no cue that the rest existed, and the rows a licence actually REQUIRES were
     among the ones below the fold, so credits.ts now floats those to the top
     as well. The cue that does the work is the soft fade at
     the bottom edge, which reads as "this continues"; the trailing padding is
     what it eats when the list is scrolled to its end, so the last credit is
     never the thing being faded out. The scrollbar-width and scrollbar-gutter
     properties are asked for as well, but they are a REQUEST: macOS draws overlay
     scrollbars that ignore both and stay invisible until something scrolls, and
     that is the OS's call, not ours. Verified at 1920x1080 — the fade is
     present, the scrollbar is not. */
  .landing ul.credits {
    list-style: none; margin: 0; padding: 0 1rem 1.5rem; max-width: 40rem; max-height: 60vh;
    overflow-y: auto; font-size: 0.85rem; line-height: 1.6; color: rgba(255, 255, 255, 0.75);
    scrollbar-width: thin; scrollbar-gutter: stable;
    scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 1.5rem), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - 1.5rem), transparent 100%);
  }
  .landing ul.credits a { color: rgba(255, 255, 255, 0.9); text-decoration: underline; text-underline-offset: 0.2em; }
  /* The list is a tab stop (credits.ts sets tabIndex) so it can be scrolled
     from the keyboard; that stop has to be visible when it is reached. */
  .landing ul.credits:focus-visible { outline: 1px solid rgba(255, 255, 255, 0.5); outline-offset: 4px; }
  .landing button.secondary { margin-top: 0.25rem; padding: 0.4rem 1.25rem; font-size: 0.85rem;
    background: rgba(255, 255, 255, 0.18); border-color: rgba(255, 255, 255, 0.18); color: #fff; }
  .landing h1 {
    margin: 0 0 0.25rem; font-size: 2rem; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
  }
  .landing p {
    margin: 0; max-width: 32rem; text-align: center;
    /* Alpha lives in the colour rather than in the opacity property: the
       emphasised span below has to reach full white, and a parent opacity
       would cap it. */
    color: rgba(255, 255, 255, 0.62);
    /* Display copy: balance the rag rather than filling line one greedily. */
    text-wrap: balance;
  }
  /* The turn in the sentence. Lifted above the innocent opening it
     interrupts, but by cast rather than by weight: a cold tint, letters drawn
     slightly apart, and a pale bloom that reads as mist-light caught on the
     words. The second, dark shadow is the legibility floor — the backdrop
     brightens and darkens as the camera pans. */
  .landing .dread {
    color: #dbe2e2; font-weight: 500; letter-spacing: 0.05em;
    /* An explicit angle rather than plain italic: a true mono italic lands
       near 14 degrees, which reads as quotation. A quarter of that is felt
       before it is seen. */
    font-style: oblique 4deg;
    text-shadow:
      0 0 14px rgba(198, 222, 222, 0.55),
      0 2px 8px rgba(0, 0, 0, 0.85);
    animation: dread-breathe 7s ease-in-out infinite;
  }
  /* Slow and shallow: the phrase should seem to surface and recede in the
     fog, never to blink. */
  @keyframes dread-breathe {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .landing .dread { animation: none; }
    /* Still hidden until ready — that is flash suppression, not decoration —
       but revealed without the cross-fade. */
    .landing-bg.ready { transition: none; }
    .landing .panel { transition: none; }
  }
  /* Filled with the subtitle's colour, held below its alpha: as a solid slab
     that colour reads far heavier than it does as thin monospace glyphs, and
     the button should not outshout the title. The label takes the page's
     ground colour to stay legible on it, and the border matches the fill so
     the shape reads as a slab rather than an outline with something inside. */
  .landing button {
    margin-top: 1.25rem; padding: 0.6rem 2rem; font: inherit; font-size: 1rem;
    cursor: pointer; color: #101014;
    background: rgba(255, 255, 255, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.45); border-radius: 4px;
  }
  .landing button:hover {
    background: rgba(255, 255, 255, 0.65);
    border-color: rgba(255, 255, 255, 0.65);
  }
  /* A finger gets no hover: the press itself has to show, and so does the
     wait that follows it. */
  .landing button:active { background: rgba(255, 255, 255, 0.85); border-color: rgba(255, 255, 255, 0.85); }
  .landing button:disabled {
    cursor: default; color: rgba(16, 16, 20, 0.7);
    background: rgba(255, 255, 255, 0.28); border-color: rgba(255, 255, 255, 0.28);
  }
  .landing a.download, .landing a.update {
    margin-top: 0.5rem; color: rgba(255, 255, 255, 0.85);
    text-decoration: underline; text-underline-offset: 0.2em;
  }
  .landing .caption { font-size: 0.8rem; color: rgba(255, 255, 255, 0.45); }
  .landing .note { max-width: 20rem; margin-top: 0.25rem; }
  .landing .downloads { display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem; margin-top: 0.75rem; }
  .landing .card { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; max-width: 20rem; }
  .landing .icon { width: 2rem; height: 2rem; color: rgba(255, 255, 255, 0.75); }
  .landing form.join { display: flex; gap: 0.5rem; margin-top: 1rem; }
  .landing form.join input {
    width: 24rem; max-width: 70vw; padding: 0.5rem 0.75rem; font: inherit;
    color: #fff; background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 4px;
  }
  .landing form.join button { margin-top: 0; padding: 0.5rem 1.25rem; }
  .landing .join-error { color: #ff8a7d; font-size: 0.9rem; }
  .landing .version {
    position: absolute; right: 0.75rem; bottom: 0.5rem;
    font-size: 0.75rem; color: rgba(255, 255, 255, 0.35);
  }
  .landing .waiting { color: rgba(255, 255, 255, 0.62); margin-top: 1.25rem; }
  .landing .empty { color: rgba(255, 255, 255, 0.45); }
  /* Phone widths: the title, copy and buttons scale to a 400 px screen with
     16 px gutters and nothing wider than the viewport. */
  @media (max-width: 480px) {
    /* The roster is a fixed full-width panel at the bottom here (roster.ts),
       and publishes its height; leaving that much room keeps every panel's
       last control — Back, the last credit — above it however big the party. */
    .landing .panel { padding: 1rem 1rem calc(var(--roster-height, 0px) + 1.5rem); gap: 0.6rem; }
    .landing h1 { font-size: 1.4rem; letter-spacing: 0.1em; }
    .landing p { font-size: 0.85rem; max-width: 100%; }
    .landing button { width: 100%; max-width: 20rem; margin-top: 0.75rem; }
    .landing button.secondary { width: auto; }
    .landing form.join { width: 100%; max-width: 20rem; }
    .landing form.join input { width: 100%; max-width: none; min-width: 0; }
  }
`;

import type { Platform } from "../net/desktopRelease.js";
import { creditsEntries, renderCredits } from "./credits.js";
import type { LandingView } from "./landingModel.js";

/** Which panel is showing. The route decides; see main.ts. */
export type LandingPanel = "home" | "downloads" | "credits";

export type LandingHandle = {
  setView(view: LandingView): void;
  /** Swaps panels in place. main.ts calls this instead of rebuilding the page,
   * because a rebuild would replace the nodes mid-transition and kill it. */
  setPanel(panel: LandingPanel): void;
  dispose(): void;
};

/**
 * The platform marks, as inline SVG. Drawn here rather than fetched: the site
 * runs under a CSP, and a card whose glyph silently fails to load is worse
 * than no glyph at all.
 */
const SVG = "http://www.w3.org/2000/svg";
const GLYPH_PATHS: Record<Platform, string> = {
  // A simplified apple silhouette (leaf + body), 24x24 viewBox.
  "darwin-arm64":
    "M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.8 3-.8s1.8.8 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.7zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z",
  // Four panes, 24x24 viewBox.
  "win32-x64": "M3 5.5l7.5-1v7H3v-6zm8.5-1.2L21 3v8.5h-9.5v-7.2zM3 12.5h7.5v7L3 18.5v-6zm8.5 0H21V21l-9.5-1.3v-7.2z",
};

function glyph(platform: Platform): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", GLYPH_PATHS[platform]);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

/**
 * Built with DOM APIs rather than innerHTML on purpose. The view carries
 * server-supplied text (disconnect reasons, error codes), and bucket-supplied
 * text (a release version), and textContent makes injection structurally
 * impossible instead of depending on every future caller remembering to escape.
 *
 * Paints a `LandingView` and repaints on `setView`: latest.json arrives after
 * the page is up, and a failed join reports inline, so the page changes while
 * it is showing. Everything below the title is rebuilt each time; the title
 * and the blurb are not, so they never flicker.
 */
export function renderLanding(
  container: HTMLElement,
  view: LandingView,
  handlers: { onCreate(): void; onJoin(text: string): void; onDownloads(): void; onCredits(): void; onBack(): void },
  panel: LandingPanel = "home",
): LandingHandle {
  // Appends rather than clearing: main.ts owns the container and may have
  // already placed the scenery canvas this overlay sits on.
  const style = document.createElement("style");
  style.textContent = STYLE;

  const root = document.createElement("div");
  root.className = "landing";

  const title = document.createElement("h1");
  title.textContent = "Day Hike";

  // Two nodes rather than innerHTML, keeping this file's no-markup rule: the
  // sentence turns at "the woods", and the turn is styled to recede.
  const blurb = document.createElement("p");
  const dread = document.createElement("span");
  dread.className = "dread";
  dread.textContent = "the woods were counting us.";
  blurb.append("A mild morning; an easy trail; and the peculiar conviction that ", dread);

  const dynamic = document.createElement("div");
  dynamic.style.display = "contents";

  const home = document.createElement("div");
  home.className = "panel home";
  home.append(title, blurb, dynamic);

  // Built once, up front: the entries come from a build-time import, so there
  // is nothing to wait for, and having the panel already in the DOM is what
  // lets the class toggle animate rather than pop.
  const credits = document.createElement("div");
  credits.className = "panel credits";
  renderCredits(credits, creditsEntries(), handlers.onBack);

  // The downloads panel's body is repainted with the view (latest.json lands
  // after the page is up), but the panel itself exists from the start so the
  // class toggle animates rather than pops.
  const downloads = document.createElement("div");
  downloads.className = "panel downloads";
  const downloadsHeading = document.createElement("h2");
  downloadsHeading.textContent = "Downloads";
  const downloadsBody = document.createElement("div");
  downloadsBody.style.display = "contents";
  const downloadsBack = document.createElement("button");
  downloadsBack.type = "button";
  downloadsBack.textContent = "Back";
  downloadsBack.addEventListener("click", handlers.onBack);
  downloads.append(downloadsHeading, downloadsBody, downloadsBack);

  root.append(home, downloads, credits);
  function showPanel(next: LandingPanel): void {
    root.classList.toggle("show-downloads", next === "downloads");
    root.classList.toggle("show-credits", next === "credits");
  }
  showPanel(panel);

  function paint(v: LandingView): void {
    const parts: Node[] = [];

    if (v.play !== undefined) {
      const button = document.createElement("button");
      button.id = "create";
      button.type = "button";
      button.textContent = v.play.label;
      button.disabled = v.play.busy === true;
      button.addEventListener("click", handlers.onCreate);
      parts.push(button);
    }
    if (v.waiting !== undefined) {
      const waiting = document.createElement("p");
      waiting.className = "waiting";
      waiting.textContent = v.waiting;
      parts.push(waiting);
    }

    if (v.join !== undefined) {
      const form = document.createElement("form");
      form.className = "join";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "join";
      input.placeholder = v.join.placeholder;
      input.autocomplete = "off";
      input.spellcheck = false;
      const join = document.createElement("button");
      join.type = "submit";
      join.textContent = "Join";
      form.append(input, join);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        handlers.onJoin(input.value);
      });
      parts.push(form);
      if (v.join.error !== undefined) {
        const error = document.createElement("p");
        error.className = "join-error";
        error.textContent = v.join.error;
        parts.push(error);
      }
    }

    // Beneath the primary action — Play on the web, the join form on desktop.
    // Downloads before Credits: the intended
    // ordering, Play → Downloads → Credits.
    if (v.downloadsPage !== undefined) {
      const downloadsButton = document.createElement("button");
      downloadsButton.type = "button";
      downloadsButton.className = "secondary downloads";
      downloadsButton.textContent = v.downloadsPage.label;
      downloadsButton.addEventListener("click", handlers.onDownloads);
      parts.push(downloadsButton);
    }
    const creditsButton = document.createElement("button");
    creditsButton.type = "button";
    creditsButton.className = "secondary credits";
    creditsButton.textContent = v.credits.label;
    creditsButton.addEventListener("click", handlers.onCredits);
    parts.push(creditsButton);

    if (v.update !== undefined) {
      const link = document.createElement("a");
      link.className = "update";
      link.href = v.update.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = v.update.label;
      parts.push(link);
    }

    if (v.versionLabel !== undefined) {
      const version = document.createElement("p");
      version.className = "version";
      version.textContent = v.versionLabel;
      parts.push(version);
    }

    dynamic.replaceChildren(...parts);

    // The downloads panel body: the cards, or the one-line reason there are none.
    const body: Node[] = [];
    if (v.downloadsPage !== undefined) {
      if (v.downloadsPage.empty !== undefined) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = v.downloadsPage.empty;
        body.push(empty);
      } else {
        const row = document.createElement("div");
        row.className = "downloads";
        for (const d of v.downloadsPage.cards) {
          const card = document.createElement("div");
          card.className = "card";
          card.append(glyph(d.platform));
          // target=_blank: on the web the browser downloads it in a new tab; in
          // the shell (where this never renders) window.open goes to the system
          // browser. rel=noreferrer for the usual reasons.
          const link = document.createElement("a");
          link.className = "download";
          link.href = d.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = d.label;
          const caption = document.createElement("p");
          caption.className = "caption";
          caption.textContent = d.caption;
          const note = document.createElement("p");
          note.className = "caption note";
          note.textContent = d.note;
          card.append(link, caption, note);
          row.append(card);
        }
        body.push(row);
      }
    }
    downloadsBody.replaceChildren(...body);
  }

  paint(view);
  container.append(style, root);

  return {
    setView: paint,
    setPanel(next) {
      showPanel(next);
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
