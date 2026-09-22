import { END_PASSAGES } from "./passages.js";

export type EndPlayer = { id: number; name: string; safe: boolean; dead: boolean };
export type EndView = { passage: string; survived: string[]; perished: string[] };

/**
 * The groups and the passage. `outcome` decides nothing here: the groups
 * do (all / some / none survived).
 *
 * Survived = `safe && !dead`; perished = `dead`. A player who is neither —
 * still out when the match ended — cannot happen under the end rule (the
 * match ends only once nobody is still out), but is listed under perished
 * by name rather than dropped, so an unexpected state is still visible
 * rather than silently missing a player. Names sort by id (join order).
 */
export function endPanelModel(players: readonly EndPlayer[]): EndView {
  const byId = [...players].sort((a, b) => a.id - b.id);
  const survived = byId.filter((p) => p.safe && !p.dead).map((p) => p.name);
  const perished = byId.filter((p) => !(p.safe && !p.dead)).map((p) => p.name);
  const passage =
    perished.length === 0 ? END_PASSAGES.all : survived.length === 0 ? END_PASSAGES.none : END_PASSAGES.some;
  return { passage, survived, perished };
}

const STYLE = `
  .end {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    /* Above the poster (posterPanel.ts, 16), below the pause menu
       (pauseMenu.ts, 18) and the roster (roster.ts, 20). */
    z-index: 17; pointer-events: none;
    font-family: ui-monospace, monospace; color: #f2ead8;
  }
  .end.open { display: flex; }
  .end .page {
    min-width: 18rem; max-width: 26rem; padding: 1rem 1.25rem;
    background: rgba(28, 24, 18, 0.92); border: 1px solid rgba(242, 234, 216, 0.25); border-radius: 4px;
  }
  .end .passage { margin: 0 0 1rem; font-size: 0.9rem; line-height: 1.4; opacity: 0.9; }
  .end section + section { margin-top: 0.75rem; }
  .end h2 { margin: 0 0 0.4rem; font-size: 0.8rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.7; }
  .end ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .end li { font-size: 0.95rem; }
`;

export type EndPanel = {
  show(view: EndView): void;
  hide(): void;
  dispose(): void;
};

/**
 * The end-of-match screen: the passage and who came down. Built with DOM
 * APIs and `textContent`: names come from the seed today and could come
 * from players tomorrow, and neither may become markup.
 */
export function createEndPanel(container: HTMLElement): EndPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "end";
  const page = document.createElement("div");
  page.className = "page";
  const passage = document.createElement("p");
  passage.className = "passage";

  const survivedSection = document.createElement("section");
  const survivedHeading = document.createElement("h2");
  survivedHeading.textContent = "Came down";
  const survivedList = document.createElement("ul");
  survivedSection.append(survivedHeading, survivedList);

  const perishedSection = document.createElement("section");
  const perishedHeading = document.createElement("h2");
  perishedHeading.textContent = "Did not";
  const perishedList = document.createElement("ul");
  perishedSection.append(perishedHeading, perishedList);

  page.append(passage, survivedSection, perishedSection);
  root.append(page);
  container.append(style, root);

  function fill(list: HTMLUListElement, names: readonly string[]): void {
    list.replaceChildren(
      ...names.map((name) => {
        const li = document.createElement("li");
        li.textContent = name;
        return li;
      }),
    );
  }

  return {
    show(view) {
      passage.textContent = view.passage;
      fill(survivedList, view.survived);
      fill(perishedList, view.perished);
      root.classList.add("open");
    },
    hide() {
      root.classList.remove("open");
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
