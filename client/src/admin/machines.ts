/**
 * The Machines and tiers card: each kind of graphics chip (phone or not)
 * against each quality tier it ran on, from `machines.sql`. A line a chip, a
 * cell a tier, the cell's mark the frame rate's verdict. Its figures arrive
 * as BigQuery sends them, numbers and booleans possibly as strings.
 */

import { card } from "./views.js";
import { el, folded, table } from "./charts.js";
import { FPS_WORDS, TIERS, TIER_WORDS, type TierName } from "./profile.js";
import { fpsVerdict, gpuName, osName, present, type Verdict } from "./verdicts.js";
import type { Row } from "./source.js";

const UNKNOWN = "not shared by the browser";
const SHOWN = 12;

export type Cell = { tier: TierName; sessions: number; fps: number | null; verdict: Verdict | null; title: string } | null; // null: not played
export type MachineLine = { name: string; players: number; cells: Record<TierName, Cell>; title: string };

const count = (v: unknown): number => present(v) ?? 0;
const isTier = (v: unknown): v is TierName => (TIERS as readonly unknown[]).includes(v);

type Held = { cell: NonNullable<Cell>; counts: [number, number, number, number]; auto: number; loadMs: number | null };

function titleOf(sessions: number, [good, slow, bad]: [number, number, number, number], loadMs: number | null, auto: number): string {
  const marks = [`${good} ${FPS_WORDS.good}`, `${slow} ${FPS_WORDS.slow}`, `${bad} ${FPS_WORDS.bad}`].filter((_, i) => [good, slow, bad][i]! > 0);
  const parts = [marks.length === 0 ? "no frames measured" : marks.join(", ")];
  if (loadMs !== null) parts.push(`median load ${(loadMs / 1000).toFixed(1)} s`);
  parts.push(`${auto} put here by auto`);
  return `${sessions} session${sessions === 1 ? "" : "s"}: ${parts.join("; ")}`;
}

function heldOf(row: Row, tier: TierName): Held {
  const fps = present(row.fps);
  const sessions = count(row.sessions);
  const counts: [number, number, number, number] = [count(row.good), count(row.slow), count(row.bad), count(row.no_frames)];
  const loadMs = present(row.load_ms);
  const auto = count(row.auto_sessions);
  return { cell: { tier, sessions, fps, verdict: fpsVerdict(fps), title: titleOf(sessions, counts, loadMs, auto) }, counts, auto, loadMs };
}

/** Two rows of one chip on one tier (names that merge under `gpuName`): the figures of the one with more sessions, the counts of both. */
function merge(a: Held, b: Held): Held {
  const [big, small] = a.cell.sessions >= b.cell.sessions ? [a, b] : [b, a];
  const counts = big.counts.map((n, i) => n + small.counts[i]!) as Held["counts"];
  const auto = big.auto + small.auto;
  const sessions = big.cell.sessions + small.cell.sessions;
  return { cell: { ...big.cell, sessions, title: titleOf(sessions, counts, big.loadMs, auto) }, counts, auto, loadMs: big.loadMs };
}

function describeMachine(rows: Row[]): string {
  const biggest = rows.reduce((a, b) => (count(b.sessions) > count(a.sessions) ? b : a));
  const cores = present(biggest.cores);
  const mem = present(biggest.mem);
  const oses = [...new Set(rows.flatMap((r) => String(r.oses ?? "").split(",")).map((o) => osName(o.trim())).filter((o) => o !== ""))];
  const memory = mem === null || mem <= 0 ? `${UNKNOWN} memory` : mem >= 8 ? "8 GB or more" : `${mem} GB`;
  const core = cores === null || cores <= 0 ? `${UNKNOWN} cores` : `${cores} cores`;
  return `${core}, ${memory}${oses.length === 0 ? "" : `; ${oses.join(", ")}`}`;
}

export function machineLines(rows: Row[]): MachineLine[] {
  const by = new Map<string, { name: string; rows: Row[]; players: Partial<Record<TierName, number>>; held: Partial<Record<TierName, Held>> }>();
  for (const row of rows) {
    const tier = row.tier;
    if (!isTier(tier)) continue;
    const phone = row.mobile === true || row.mobile === "true";
    const base = gpuName(String(row.gpu ?? ""));
    const name = `${base === "" ? "Not shared by the browser" : base}${phone ? " (phone)" : ""}`;
    const line = by.get(name) ?? { name, rows: [], players: {}, held: {} };
    by.set(name, line);
    line.rows.push(row);
    // Players across the merged rows of a tier are not known to be distinct: the most of them stands.
    line.players[tier] = Math.max(line.players[tier] ?? 0, count(row.players));
    const held = heldOf(row, tier);
    const prior = line.held[tier];
    line.held[tier] = prior === undefined ? held : merge(prior, held);
  }
  return [...by.values()]
    .map((l) => ({
      name: l.name,
      players: Math.max(0, ...Object.values(l.players)),
      cells: { high: l.held.high?.cell ?? null, medium: l.held.medium?.cell ?? null, low: l.held.low?.cell ?? null },
      title: describeMachine(l.rows),
    }))
    .sort((a, b) => b.players - a.players);
}

export function cellText(cell: Cell): string {
  if (cell === null) return "not played";
  if (cell.fps === null) return "no frames measured";
  return `${FPS_WORDS[cell.verdict ?? "bad"]}, ${Math.round(cell.fps)} fps`;
}

function cellNode(cell: Cell): Node {
  if (cell === null) return el("span", { class: "faint" }, cellText(cell));
  return el("span", { class: `status ${cell.verdict ?? ""}`.trim(), title: cell.title }, cellText(cell));
}

export function machinesView(rows: Row[]): HTMLElement {
  const lines = machineLines(rows);
  const columns = [
    { key: "name", label: "Graphics", render: (_v: unknown, row: Record<string, unknown>) => el("span", { title: String(row.title) }, String(row.name)) },
    { key: "players", label: "Players", num: true },
    ...TIERS.map((tier) => ({ key: tier, label: TIER_WORDS[tier], render: (v: unknown) => cellNode(v as Cell) })),
  ];
  const flat = (ls: MachineLine[]): Record<string, unknown>[] => ls.map((l) => ({ name: l.name, title: l.title, players: l.players, ...l.cells }));
  const body: Node[] = [table(columns, flat(lines.slice(0, SHOWN)), "No hikes in this range.")];
  if (lines.length > SHOWN) body.push(folded(`All ${lines.length} graphics chips`, table(columns, flat(lines))));
  return card("Machines and tiers", "How each kind of graphics chip ran on each tier, over this range", "machines", ...body);
}
