/**
 * The page's marks, in plain SVG and DOM: a column chart, a histogram and a
 * horizontal funnel, each with a hover tooltip and a table beneath; stat
 * tiles; and the table every number is also reachable through. One series a
 * chart, so the series colour is the one token and no legend is needed.
 */

import { accordion } from "./motion.js";

const SVG = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 1,284 / 12.9K / 4.2M, the stat tile's compact figure. */
export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function tile(label: string, value: string, delta?: { text: string; tone?: "good" | "bad" }): HTMLElement {
  const node = el("div", { class: "tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value));
  if (delta !== undefined) node.append(el("div", { class: `delta${delta.tone ? ` ${delta.tone}` : ""}` }, delta.text));
  return node;
}

export type Column = { key: string; label: string; num?: boolean; when?: boolean; render?: (value: unknown, row: Record<string, unknown>) => Node | string };

/** A table of rows. Cells are text, never markup: the data is the queries' and the pages'. */
export function table(columns: Column[], rows: Record<string, unknown>[], empty = "Nothing in this range."): HTMLElement {
  if (rows.length === 0) return el("div", { class: "empty" }, empty);
  const head = el("tr", {}, ...columns.map((c) => el("th", c.num ? { class: "num" } : {}, c.label)));
  const body = rows.map((row) =>
    el(
      "tr",
      {},
      ...columns.map((c) => {
        const value = row[c.key];
        const shown = c.render ? c.render(value, row) : value === null || value === undefined ? "" : String(value);
        return el("td", c.num ? { class: "num" } : c.when ? { class: "when" } : {}, shown);
      }),
    ),
  );
  // In a wrapper that scrolls sideways on its own, so a wide table never widens the page.
  return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)));
}

/**
 * A folded table, `details.table`, that opens and closes as an accordion (`motion.ts`): still a
 * <details>, so the keyboard, screen readers and find-in-page work as before. `open` starts it open.
 */
export function folded(summary: string, body: Node, open = false): HTMLDetailsElement {
  const node = el("details", open ? { class: "table", open: "" } : { class: "table" }, el("summary", {}, summary), body);
  accordion(node);
  return node;
}

/** The table view behind a chart, folded. */
export function tableView(columns: Column[], rows: Record<string, unknown>[]): HTMLElement {
  return folded("Table", table(columns, rows));
}

type Tip = { show(x: number, y: number, lines: { v: string; k: string }[]): void; hide(): void; node: HTMLElement };

/**
 * A tooltip's coming and going (`.tooltip.on` in `admin.css`): it fades and lifts 4 px in and
 * fades out quicker; moving from one mark to the next glides it there (`.glide`) instead of
 * fading it out and in again, so a hide is held for a frame in case a show follows straight away,
 * as it does between neighbouring marks. `show()` before measuring it: it is laid out only when on.
 * A tooltip placed at the pointer rather than at a mark (the paths card's map) takes `glide: false`:
 * it follows the pointer directly, as anything that tracks the pointer does, and only fades.
 */
export function tipMotion(node: HTMLElement, { glide = true }: { glide?: boolean } = {}): { show(): void; hide(): void } {
  let leaving = 0;
  return {
    show() {
      cancelAnimationFrame(leaving);
      node.classList.toggle("glide", glide && node.classList.contains("on"));
      node.classList.add("on");
    },
    hide() {
      cancelAnimationFrame(leaving);
      leaving = requestAnimationFrame(() => node.classList.remove("on", "glide"));
    },
  };
}

function tooltip(host: HTMLElement): Tip {
  const node = el("div", { class: "tooltip" });
  host.append(node);
  const motion = tipMotion(node);
  return {
    node,
    show(x, y, lines) {
      node.replaceChildren(
        ...lines.map((line) => el("div", {}, el("span", { class: "key" }), el("span", { class: "v" }, line.v), " ", el("span", { class: "k" }, line.k))),
      );
      motion.show();
      const w = host.clientWidth;
      node.style.left = `${Math.max(0, Math.min(x + 12, w - node.offsetWidth - 4))}px`;
      node.style.top = `${Math.max(0, y - node.offsetHeight - 10)}px`;
    },
    hide: motion.hide,
  };
}

/** Clean ticks: a step of 1, 2 or 5 times a power of ten, about four of them, the top at or past the data. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export type Bar = { label: string; value: number; detail?: string };

/**
 * Columns from a single baseline: thin marks capped at 24px, rounded at the
 * data end, a 2px surface gap between neighbours, the extreme labelled, the
 * rest on the axis and in the tooltip.
 */
export function columns(bars: Bar[], options: { height?: number; width?: number; unit?: string } = {}): HTMLElement {
  const host = el("div", { class: "chart" });
  const tip = tooltip(host);
  // The drawing's width in its own units is the width it is shown at, so the
  // text renders at its size at every width: a fixed width scaled down to a
  // phone's card drew 11px ticks at 3px (seen 2026-10-13). `width` is the
  // first guess, before the card is on the page; the observer redraws at the
  // real width, and again whenever the card changes size.
  let drawn = 0;
  const draw = (W: number): void => {
    drawn = W;
    host.querySelector("svg")?.remove();
    host.append(drawColumns(bars, W, options.height ?? 180, options.unit, tip, host));
  };
  draw(options.width ?? 640);
  new ResizeObserver(() => {
    const W = Math.round(host.clientWidth);
    if (W > 0 && W !== drawn) draw(W);
  }).observe(host);
  return host;
}

/** About how wide a tick label runs: 11px JetBrains Mono is 0.6em a character, plus a gap. */
const tickWidth = (label: string): number => label.length * 6.6 + 8;

function drawColumns(bars: Bar[], W: number, H: number, unit: string | undefined, tip: Tip, host: HTMLElement): SVGSVGElement {
  const pad = { l: 36, r: 8, t: 14, b: 26 };
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  // Its own height, whatever the width it was drawn at: the first draw (at 640, before the
  // host is measured) would otherwise scale to the card's width for a frame, and move every
  // card under it (2026-10-29).
  root.style.height = `${H}px`;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const ticks = ticksFor(Math.max(0, ...bars.map((b) => b.value)));
  const max = ticks[ticks.length - 1] ?? 1;
  const y = (v: number): number => pad.t + innerH - (v / max) * innerH;
  for (const [i, v] of ticks.entries()) {
    const line = svg("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: i === 0 ? "axis-line" : "grid-line" });
    root.append(line);
    const tick = svg("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", class: "tick" });
    tick.textContent = compact(v);
    root.append(tick);
  }
  const slot = innerW / Math.max(1, bars.length);
  const thick = Math.min(24, Math.max(4, slot - 2));
  // Every label when they fit, else every second, third…: as many as the
  // width holds without two touching, and never more than seven past fourteen bars.
  const widest = Math.max(0, ...bars.map((b) => tickWidth(b.label)));
  const every = Math.max(1, Math.ceil(widest / slot), bars.length > 14 ? Math.ceil(bars.length / 7) : 1);
  const best = bars.reduce((m, b, i) => (b.value > (bars[m]?.value ?? -1) ? i : m), 0);
  bars.forEach((bar, i) => {
    const x = pad.l + slot * i + (slot - thick) / 2;
    const top = y(bar.value);
    const h = Math.max(0, pad.t + innerH - top);
    const rect = svg("path", {
      class: "bar",
      d: h <= 0 ? "" : `M${x},${top + 4} a4,4 0 0 1 4,-4 h${thick - 8} a4,4 0 0 1 4,4 v${h - 4} h${-thick} z`,
    });
    root.append(rect);
    if (i === best && bar.value > 0) {
      const label = svg("text", { x: x + thick / 2, y: top - 4, "text-anchor": "middle", class: "dlabel" });
      label.textContent = compact(bar.value);
      root.append(label);
    }
    if (i % every === 0) {
      const tick = svg("text", { x: x + thick / 2, y: H - 8, "text-anchor": "middle", class: "tick" });
      tick.textContent = bar.label;
      root.append(tick);
    }
    const hit = svg("rect", { class: "hit", x: pad.l + slot * i, y: pad.t, width: slot, height: innerH, tabindex: 0 });
    const show = (): void => {
      rect.classList.add("hover");
      const scale = host.clientWidth / W;
      tip.show((x + thick / 2) * scale, top * scale, [{ v: `${bar.value.toLocaleString()}${unit ?? ""}`, k: bar.detail ?? bar.label }]);
    };
    const hide = (): void => {
      rect.classList.remove("hover");
      tip.hide();
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    root.append(hit);
  });
  return root;
}

export type Stage = { name: string; value: number };

/** A funnel as horizontal bars on the ordinal ramp, each stage's share of the first at its tip. */
export function funnel(stages: Stage[]): HTMLElement {
  const first = stages[0]?.value ?? 0;
  const ramp = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)"];
  return el(
    "div",
    { class: "funnel" },
    ...stages.map((stage, i) => {
      const share = first > 0 ? stage.value / first : 0;
      const fill = el("div", { class: "fill", style: `width:${Math.max(share * 100, stage.value > 0 ? 1 : 0)}%;background:${ramp[Math.min(i, 3)]}`, title: `${stage.value.toLocaleString()} ${stage.name}` });
      return el(
        "div",
        { class: "row" },
        el("span", { class: "name" }, stage.name),
        el("div", { class: "track" }, fill),
        el("span", { class: "n" }, `${stage.value.toLocaleString()}${i === 0 ? "" : ` · ${Math.round(share * 100)}%`}`),
      );
    }),
  );
}

/** Values binned into `bins` equal bins over [0, 1], as columns. */
export function histogram(values: number[], bins: number, labelOf: (lo: number, hi: number) => string, width?: number): HTMLElement {
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]! += 1;
  return columns(
    counts.map((value, i) => ({ label: labelOf(i / bins, (i + 1) / bins), value, detail: `${labelOf(i / bins, (i + 1) / bins)} of the way` })),
    { height: 160, ...(width === undefined ? {} : { width }) },
  );
}

/** Minutes ago, hours ago, or days ago, for a time column. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
