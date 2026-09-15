import type { Register } from "../sim/register.js";
import type { ItemState } from "../sim/types.js";
import { NO_CARRIER } from "../sim/types.js";

export type RegisterRow = { name: string; site: string; status: string };
export type RegisterPanelView = { title: string; rows: RegisterRow[]; footer: string };

/** The book as data: one row per hiker in book order, and the count. */
export function registerPanelModel(
  register: Register,
  items: readonly ItemState[],
  playerNames: ReadonlyMap<number, string>,
): RegisterPanelView {
  const rows = register.hikers.map((h) => {
    const item = items[h.id];
    let status = "missing";
    if (item !== undefined && item.signedOut) status = "signed out";
    else if (item !== undefined && item.carrier !== NO_CARRIER) {
      const who = playerNames.get(item.carrier);
      status = who === undefined ? "carried" : `with ${who}`;
    }
    return { name: h.name, site: `last seen at ${h.site.name}`, status };
  });
  const signed = rows.filter((r) => r.status === "signed out").length;
  return { title: "Trailhead register", rows, footer: `${signed} of ${rows.length} signed out` };
}

const STYLE = `
  .register {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    /* Above the touch layer (touchControls.ts, 15), below the pause menu
       (pauseMenu.ts, 18) and the roster (roster.ts, 20). */
    z-index: 16; pointer-events: none;
    font-family: ui-monospace, monospace; color: #f2ead8;
  }
  .register.open { display: flex; }
  .register .page {
    min-width: 18rem; max-width: 26rem; padding: 1rem 1.25rem;
    background: rgba(28, 24, 18, 0.92); border: 1px solid rgba(242, 234, 216, 0.25); border-radius: 4px;
  }
  .register h1 { margin: 0 0 0.75rem; font-size: 0.85rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }
  .register ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .register li { display: flex; flex-direction: column; gap: 0.1rem; }
  .register .name { font-size: 1.05rem; }
  .register .site { font-size: 0.85rem; opacity: 0.7; }
  .register .status { font-size: 0.8rem; opacity: 0.85; }
  .register li.out .name { text-decoration: line-through; opacity: 0.6; }
  .register .footer { margin-top: 0.9rem; font-size: 0.8rem; opacity: 0.7; }
`;

export type RegisterPanel = {
  show(view: RegisterPanelView): void;
  hide(): void;
  readonly isOpen: boolean;
  dispose(): void;
};

/**
 * The book, opened at the box with empty hands. Built with DOM APIs and
 * `textContent`: the names come from the seed today and could come from
 * players tomorrow, and neither may become markup.
 */
export function createRegisterPanel(container: HTMLElement): RegisterPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "register";
  const page = document.createElement("div");
  page.className = "page";
  const title = document.createElement("h1");
  const list = document.createElement("ul");
  const footer = document.createElement("div");
  footer.className = "footer";
  page.append(title, list, footer);
  root.append(page);
  container.append(style, root);
  let isOpen = false;
  return {
    show(view) {
      title.textContent = view.title;
      list.replaceChildren(
        ...view.rows.map((r) => {
          const li = document.createElement("li");
          li.classList.toggle("out", r.status === "signed out");
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = r.name;
          const site = document.createElement("span");
          site.className = "site";
          site.textContent = r.site;
          const status = document.createElement("span");
          status.className = "status";
          status.textContent = r.status;
          li.append(name, site, status);
          return li;
        }),
      );
      footer.textContent = view.footer;
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
