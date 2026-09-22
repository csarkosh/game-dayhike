import type { Register } from "../sim/register.js";

export type PosterView = { title: string; name: string; lines: string[] };

/** The poster as data: the one missing hiker it names, and where. */
export function posterModel(register: Register): PosterView {
  return {
    title: "MISSING",
    name: register.hiker.name,
    lines: ["Last seen on the summit trail.", "If you have seen them, call the ranger station."],
  };
}

const STYLE = `
  .poster {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    /* Above the touch layer (touchControls.ts, 15), below the end panel
       (endPanel.ts, 17), the pause menu (pauseMenu.ts, 18) and the roster
       (roster.ts, 20). */
    z-index: 16; pointer-events: none;
    font-family: ui-monospace, monospace; color: #f2ead8;
  }
  .poster.open { display: flex; }
  .poster .page {
    min-width: 18rem; max-width: 26rem; padding: 1rem 1.25rem;
    background: rgba(28, 24, 18, 0.92); border: 1px solid rgba(242, 234, 216, 0.25); border-radius: 4px;
  }
  .poster h1 { margin: 0 0 0.75rem; font-size: 0.85rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }
  .poster .name { display: block; margin: 0 0 0.6rem; font-size: 1.05rem; }
  .poster p { margin: 0 0 0.4rem; font-size: 0.85rem; opacity: 0.85; }
  .poster p:last-child { margin-bottom: 0; }
`;

export type PosterPanel = {
  show(view: PosterView): void;
  hide(): void;
  readonly isOpen: boolean;
  dispose(): void;
};

/**
 * The poster, read at the box. Built with DOM APIs and `textContent`: the
 * name comes from the seed today and could come from a player tomorrow, and
 * neither may become markup.
 */
export function createPosterPanel(container: HTMLElement): PosterPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "poster";
  const page = document.createElement("div");
  page.className = "page";
  const title = document.createElement("h1");
  const name = document.createElement("span");
  name.className = "name";
  const lines = document.createElement("div");
  page.append(title, name, lines);
  root.append(page);
  container.append(style, root);
  let isOpen = false;
  return {
    show(view) {
      title.textContent = view.title;
      name.textContent = view.name;
      lines.replaceChildren(
        ...view.lines.map((text) => {
          const p = document.createElement("p");
          p.textContent = text;
          return p;
        }),
      );
      isOpen = true;
      root.classList.add("open");
    },
    hide() {
      isOpen = false;
      root.classList.remove("open");
    },
    get isOpen() {
      return isOpen;
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
