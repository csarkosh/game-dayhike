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
 *
 * Where a card's height does change (a view never seen, a range whose height is another, "Right
 * now" as lobbies come and go), it eases there (`motion.ts` easeHeight) rather than snapping, and
 * what it remembers is always the height it ends at, never one from the middle of an ease. A card
 * not yet drawn (the skeletons before the first frame) takes its height at once: nothing was on
 * screen to move from.
 */

import { el } from "./charts.js";
import { easeHeight } from "./motion.js";

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

// The cards that have been on screen: they ease to a new height, the rest take it.
const drawn = new WeakSet<HTMLElement>();
function markDrawn(card: HTMLElement): boolean {
  if (drawn.has(card)) return true;
  // Two frames: the first runs before the paint that shows the card, the second after it.
  requestAnimationFrame(() => requestAnimationFrame(() => drawn.add(card)));
  return false;
}

// A height ease in flight on `card` itself, or with `within`, on anything in it (a fold, a list's
// glide). Running only: a finished ease with no fill draws nothing, so it is over.
const heightEases = (card: HTMLElement, within = false): Animation[] =>
  card.getAnimations({ subtree: within }).filter((a) => a.playState === "running" && a.effect instanceof KeyframeEffect && a.effect.getKeyframes().some((k) => "height" in k));

// From the height `card` is drawn at (`from`, read before the change) to the one it has now, when
// it has been on screen and the change is a pixel or more.
function easeTo(card: HTMLElement, from: number, ease: boolean): Animation | null {
  const to = card.getBoundingClientRect().height;
  return ease && Math.abs(to - from) >= 1 ? easeHeight(card, from, to) : null;
}

/**
 * Hold `card` at the height it last had in this view, else at `fallback` (its height before a
 * reload): exactly that height, the skeleton filled down to it with lines or clipped at it. A card
 * on screen eases from the height it is drawn at.
 */
export function hold(card: HTMLElement, id: string, fallback = 0): void {
  watching.get(card)?.disconnect();
  watching.delete(card);
  const height = recall(id) || fallback;
  if (!height) return;
  const ease = markDrawn(card);
  // The height drawn now, an ease in flight included; then that ease goes, so the one to come
  // starts from where the card is and nothing else holds it.
  const from = card.getBoundingClientRect().height;
  heightEases(card).forEach((a) => a.cancel());
  card.style.height = `${height}px`;
  card.style.overflow = "hidden";
  easeTo(card, from, ease);
  const shape = card.querySelector<HTMLElement>(".skeleton");
  if (shape === null) return;
  // As many text lines as fit between the skeleton's foot and the card's padding, at the height
  // it is going to (an ease draws it at another meanwhile).
  const probe = shape.appendChild(el("div", { class: "skel text" }));
  const style = getComputedStyle(probe);
  const step = probe.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  probe.remove();
  const room = card.getBoundingClientRect().top + height - parseFloat(getComputedStyle(card).paddingBottom) - shape.getBoundingClientRect().bottom;
  const n = step > 0 ? Math.max(0, Math.min(400, Math.floor(room / step))) : 0;
  for (let i = 0; i < n; i += 1) shape.append(el("div", { class: `skel text${i % 4 === 3 ? " short" : ""}` }));
}

/**
 * The content is in: let the card take its own height, and remember it for this view. It eases
 * there from `from`, the height it was drawn at before its content changed (by default the height
 * it has now: `hold()`'s, while it waited). The height is measured before the ease, and while
 * anything in the card eases its height, the readings after are skipped: what is remembered is
 * where the card ends, never a height from the middle of an ease.
 */
export function settle(card: HTMLElement, id: string, from = card.getBoundingClientRect().height): void {
  watching.get(card)?.disconnect();
  watching.delete(card);
  const ease = markDrawn(card);
  heightEases(card).forEach((a) => a.cancel());
  card.style.height = "";
  card.style.overflow = "";
  const key = holdKey(id);
  const keep = (): void => {
    const height = card.getBoundingClientRect().height;
    // Hidden (the sign-in gate is up) it measures 0, which is no height to come back to.
    if (!height) return;
    try {
      localStorage.setItem(key, String(Math.round(height * 100) / 100));
    } catch {
      // No storage: the next load falls back to the skeleton's shape.
    }
  };
  keep();
  const eased = easeTo(card, from, ease);
  if (typeof ResizeObserver !== "function") return;
  const watch = new ResizeObserver(() => {
    if (heightEases(card, true).length === 0) keep();
  });
  watch.observe(card);
  watching.set(card, watch);
  // The last frame of an ease draws the height it ends at, which the observer may not report again.
  eased?.finished.then(
    () => {
      if (watching.get(card) === watch) keep();
    },
    () => {},
  );
  setTimeout(() => {
    if (watching.get(card) === watch) {
      watch.disconnect();
      watching.delete(card);
    }
  }, SETTLING_MS);
}
