/**
 * Cards never jump (Cyrus, 2026-10-29), as on the host's other dashboards (csarko.sh
 * `admin/public/charts.js`, `hold` and `settle`, which this mirrors and whose storage it
 * shares). A card's content is the size of its data, which no skeleton can know, so each
 * card remembers the height it last had in this view (the page, its query, so the range,
 * and the window's width to 40 px) in this browser's localStorage. `hold()` gives a waiting
 * card exactly that height, its skeleton filled down to it with lines or clipped at it;
 * `settle()`, once the content is in, lets it go and remembers the new height, again as the
 * content settles for a moment after. A view seen before therefore loads in place; a view
 * never seen falls back to the skeleton's own shape. Storage refused costs only the memory.
 */

import { el } from "./charts.js";

const PREFIX = "admin:hold:";
const SETTLING_MS = 1500;
const watching = new WeakMap<HTMLElement, ResizeObserver>();

/** This view's key for a card: the page, the card, the query's parameters sorted, the width to 40 px. */
export function holdKey(id: string, where: { pathname: string; search: string } = location, width: number = innerWidth): string {
  const params = [...new URLSearchParams(where.search)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  return `${PREFIX}${where.pathname}|${id}|${params}|${Math.round(width / 40)}`;
}

function recall(id: string): number {
  try {
    return Number(localStorage.getItem(holdKey(id))) || 0;
  } catch {
    return 0;
  }
}

/** Hold `card` at the height it last had in this view, else at `fallback` (its height before a reload). */
export function hold(card: HTMLElement, id: string, fallback = 0): void {
  watching.get(card)?.disconnect();
  const height = recall(id) || fallback;
  if (!height) return;
  card.style.height = `${height}px`;
  card.style.overflow = "hidden";
  const shape = card.querySelector<HTMLElement>(".skeleton");
  if (shape === null) return;
  // As many text lines as fit between the skeleton's foot and the card's padding.
  const probe = shape.appendChild(el("div", { class: "skel text" }));
  const style = getComputedStyle(probe);
  const step = probe.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  probe.remove();
  const room = card.getBoundingClientRect().bottom - parseFloat(getComputedStyle(card).paddingBottom) - shape.getBoundingClientRect().bottom;
  const n = step > 0 ? Math.max(0, Math.min(400, Math.floor(room / step))) : 0;
  for (let i = 0; i < n; i += 1) shape.append(el("div", { class: `skel text${i % 4 === 3 ? " short" : ""}` }));
}

/** The content is in: let the card take its own height, and remember it for this view. */
export function settle(card: HTMLElement, id: string): void {
  card.style.height = "";
  card.style.overflow = "";
  const key = holdKey(id);
  const keep = (): void => {
    try {
      localStorage.setItem(key, String(Math.round(card.getBoundingClientRect().height * 100) / 100));
    } catch {
      // No storage: the next load falls back to the skeleton's shape.
    }
  };
  keep();
  if (typeof ResizeObserver !== "function") return;
  watching.get(card)?.disconnect();
  const watch = new ResizeObserver(keep);
  watch.observe(card);
  watching.set(card, watch);
  setTimeout(() => {
    if (watching.get(card) === watch) {
      watch.disconnect();
      watching.delete(card);
    }
  }, SETTLING_MS);
}
