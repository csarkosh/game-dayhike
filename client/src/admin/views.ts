/**
 * The page's sections, one a query plus the live rooms: each takes its rows
 * and returns a card. The forms follow the data's job: the funnel and the
 * live counts are figures; lobbies a day and how far parties got are
 * magnitudes, so single-hue columns; matches, errors, health and visitors are
 * tables, with a status mark beside a word where a state is the point; paths
 * are a drawing; a session is a trail (`timeline.ts`), in a drawer.
 *
 * Every time shown is New York's: the relative "12 min ago" and, beside it,
 * the wall clock there, which is the clock the queries bucket by.
 */

import { ago, columns, compact, el, funnel, histogram, table, tableView, tile, type Column } from "./charts.js";
import type { Live, Row } from "./source.js";
import { clock, dayOf, delta, duration, envelopeLine, fullWhen, sessionsOf, trailOf, when as nyWhen, type Segment, type Step } from "./timeline.js";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const shortId = (id: string): string => id.slice(0, 8);
/** A session id as the link that opens its timeline (`main.ts` listens for `data-sid`). */
const sidLink = (sid: string): Node => el("a", { href: "#", class: "mono", "data-sid": sid, title: `Open session ${sid}` }, shortId(sid));
/** A visitor id as the link that lists the browser's sessions (`data-vid`). */
const vidLink = (vid: string, text = shortId(vid)): Node => el("a", { href: "#", class: "mono", "data-vid": vid, title: `Every session of visitor ${vid}` }, text);
/** A game id as the link that lists the match's sessions side by side (`data-game`). */
const gameLink = (game: string, text = shortId(game)): Node => el("a", { href: "#", class: "mono", "data-game": game, title: `Every session of match ${game}` }, text);
/** A time column: how long ago, and the New York wall clock beside it; the full moment as the title. */
const when = (v: unknown): Node | string => {
  if (typeof v !== "string" || v === "") return "";
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return "";
  return el("span", { title: `${fullWhen(ms)} (New York)` }, `${ago(ms)} · ${nyWhen(ms)}`);
};

export function card(title: string, sub: string, cls = "", ...body: Node[]): HTMLElement {
  return el("section", { class: `card ${cls}`.trim() }, el("h2", {}, title), el("p", { class: "sub" }, sub), ...body);
}

/**
 * The card as it waits for its query: the same title and copy over a skeleton the shape
 * of what is coming (`tiles` stat tiles, a `chart`, `lines` of a table), the host's
 * classes (`/theme.css`). Busy for a screen reader, which hears "Loading"; the shapes
 * are hidden from it.
 */
export function waitingCard(title: string, sub: string, cls: string, shape: { tiles?: number; chart?: boolean; lines?: number }): HTMLElement {
  const parts: HTMLElement[] = [];
  if (shape.tiles) parts.push(el("div", { class: "skel-tiles" }, ...Array.from({ length: shape.tiles }, () => el("div", { class: "skel tile" }))));
  if (shape.chart) parts.push(el("div", { class: "skel chart" }));
  for (let i = 0; i < (shape.lines ?? 0); i += 1) parts.push(el("div", { class: `skel line${i % 3 === 2 ? " short" : ""}` }));
  const body = el("div", { class: "body", "aria-busy": "true" }, el("p", { class: "sr-only" }, "Loading"), el("div", { class: "skeleton", "aria-hidden": "true" }, ...parts));
  return card(title, sub, cls, body);
}

/** The card when its query failed: the same title and copy over the error, so the rest of the page stands. */
export function failedCard(title: string, sub: string, cls: string, message: string): HTMLElement {
  return card(title, sub, cls, el("p", { class: "error", role: "status" }, `Could not be read. ${message}`));
}

export function liveView(live: Live): HTMLElement {
  const players = live.rooms.reduce((n, r) => n + r.peers, 0);
  const tiles = el(
    "div",
    { class: "tiles" },
    tile("Open lobbies", String(live.rooms.length)),
    tile("Players in lobbies", String(players)),
    tile("Instances up", String(live.instances.length), { text: live.instances.length === 0 ? "scaled to zero" : `last heard ${ago(Math.max(...live.instances.map((i) => i.seenAt)), live.at)}` }),
  );
  const columns: Column[] = [
    { key: "id", label: "Lobby", render: (v) => el("span", { class: "mono" }, shortId(str(v))) },
    { key: "hostId", label: "Host", render: (v) => el("span", { class: "mono" }, str(v)) },
    { key: "peers", label: "Players", num: true },
    {
      key: "hostDroppedAt",
      label: "State",
      render: (v, row) => {
        const away = typeof v === "number";
        return el("span", { class: `status ${away ? "away" : "hosting"}` }, away ? `host away ${ago(v, live.at)}` : row.peers === 1 ? "waiting for players" : "hosting");
      },
    },
    { key: "createdAt", label: "Open for", render: (v) => ago(num(v), live.at).replace(" ago", "") },
  ];
  return card("Right now", `What signaling holds this moment, refreshed every 10 s · ${new Date(live.at).toLocaleTimeString()}`, "", tiles, table(columns, live.rooms, "No lobby is open."));
}

/**
 * The funnel's headline is the query's `all` row, every build together; the
 * builds are the breakdown in the table. The stages nest per session (a
 * session counts at a stage only where it counted at the one before), so the
 * shares read as shares.
 */
export function funnelView(rows: Row[]): HTMLElement {
  const all = rows.find((r) => r.build === "all");
  const builds = rows.filter((r) => r.build !== "all");
  const stages = all === undefined ? [] : [
    { name: "Landed", value: num(all.landed) },
    { name: "Pressed Play", value: num(all.pressed_play) },
    { name: "Started a match", value: num(all.started) },
    { name: "Reached an end", value: num(all.finished) },
  ];
  const cols: Column[] = [
    { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
    { key: "sessions", label: "Sessions", num: true },
    { key: "landed", label: "Landed", num: true },
    { key: "pressed_play", label: "Pressed Play", num: true },
    { key: "started", label: "Started", num: true },
    { key: "finished", label: "Reached an end", num: true },
    { key: "last_seen", label: "Last seen", when: true, render: when },
  ];
  return card(
    "From landing to the end",
    all === undefined ? "Sessions by what they reached" : `${num(all.sessions)} sessions on ${builds.length} build${builds.length === 1 ? "" : "s"}, each stage of the one before; every build in the table`,
    "half",
    all === undefined || num(all.landed) === 0 ? el("div", { class: "empty" }, "No sessions in this range.") : funnel(stages),
    tableView(cols, builds),
  );
}

export function lobbiesView(rows: Row[]): HTMLElement {
  const bars = rows.map((r) => ({ label: str(r.day).slice(5), value: num(r.lobbies), detail: `${str(r.day)} · ${num(r.lobbies_joined)} joined · largest ${str(r.largest) || "–"}` }));
  const refused = rows.reduce((n, r) => n + num(r.refused_full) + num(r.refused_stale_invite) + num(r.refused_host_away), 0);
  const lost = rows.reduce((n, r) => n + num(r.hosts_lost), 0);
  const cols: Column[] = [
    { key: "day", label: "Day (New York)" },
    { key: "lobbies", label: "Lobbies", num: true },
    { key: "lobbies_joined", label: "Joined", num: true },
    { key: "largest", label: "Largest", num: true },
    { key: "median_life_min", label: "Median life (min)", num: true },
    { key: "refused_full", label: "Full", num: true },
    { key: "refused_stale_invite", label: "Stale invite", num: true },
    { key: "refused_host_away", label: "Host away", num: true },
    { key: "hosts_lost", label: "Hosts lost", num: true },
  ];
  return card(
    "Lobbies a day",
    `From signaling's own rows · ${refused} joins refused, ${lost} hosts lost in this range`,
    "half",
    rows.length === 0 ? el("div", { class: "empty" }, "No lobbies in this range.") : columns(bars, { height: 170, width: 520 }),
    tableView(cols, rows),
  );
}

const acts = (row: Record<string, unknown>): Node =>
  el(
    "span",
    {},
    ...(["wet", "dusk", "mist", "summit", "chase"] as const).map((a) => el("span", { class: `chip${row[a] === true ? " on" : ""}` }, a)),
  );

/** How long a match may go unheard before it no longer counts as still playing: four of the page's 30 s heartbeats. */
const QUIET_MS = 120_000;

/**
 * A match's End column: its outcome (and whether anyone died), else the first
 * way out any of its sessions reported, else "still playing" while it is still
 * heard from and "ended silently" once it is not (a page that died, or was
 * closed with no `pagehide`).
 */
export function matchEnd(row: Record<string, unknown>, now: number): { text: string; tone: string } {
  const result = str(row.result);
  if (result !== "") return { text: `${result}${row.died === true ? ", died" : ""}`, tone: result };
  const left = str(row.left_by);
  if (left !== "") return { text: left, tone: "" };
  const heard = Date.parse(str(row.last_seen) || str(row.started_at));
  if (Number.isFinite(heard) && now - heard < QUIET_MS) return { text: "still playing", tone: "" };
  return { text: "ended silently", tone: "warn" };
}

export function progressView(rows: Row[]): HTMLElement {
  const values = rows.map((r) => num(r.farthest));
  const won = rows.filter((r) => r.result === "won").length;
  const lost = rows.filter((r) => r.result === "lost").length;
  const silent = rows.filter((r) => matchEnd(r, Date.now()).text === "ended silently").length;
  const tiles = el(
    "div",
    { class: "tiles" },
    tile("Matches", String(rows.length), { text: `${rows.reduce((n, r) => n + num(r.players), 0)} players in them` }),
    tile("Reached the crest", String(rows.filter((r) => r.summit === true).length)),
    tile("Won", String(won), { text: rows.length ? `${Math.round((won / rows.length) * 100)}% of matches` : "" }),
    tile("Lost", String(lost)),
    tile("Ended silently", String(silent), { text: "no outcome, no way out", tone: silent > 0 ? "bad" : undefined }),
  );
  const cols: Column[] = [
    { key: "started_at", label: "Started", when: true, render: when },
    { key: "sid", label: "Host", render: (v) => sidLink(str(v)) },
    { key: "players", label: "Players", num: true, render: (v, row) => gameLink(str(row.game), `${num(v)} of ${num(row.party) || num(v)}`) },
    { key: "farthest", label: "Farthest", num: true, render: (v) => `${Math.round(num(v) * 100)}%` },
    { key: "wet", label: "Acts", render: (_, row) => acts(row) },
    {
      key: "result",
      label: "End",
      render: (_, row) => {
        const end = matchEnd(row, Date.now());
        return el("span", { class: `status ${end.tone}`.trim() }, end.text);
      },
    },
    { key: "minutes", label: "Minutes", num: true },
    { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
  ];
  return card(
    "How far parties got",
    "One line a match (a game with a host's match_start); each match's farthest climb, 0 at the trailhead and 1 at the crest; the night falls from 30%",
    "",
    tiles,
    rows.length === 0 ? el("div", { class: "empty" }, "No matches in this range.") : histogram(values, 10, (lo, hi) => `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, 1100),
    el("details", { class: "table", open: "" }, el("summary", {}, `Matches, the latest ${Math.min(rows.length, 12)} of ${rows.length}`), table(cols, rows.slice(0, 12))),
  );
}

export function errorsView(rows: Row[]): HTMLElement {
  const cols: Column[] = [
    {
      key: "n",
      label: "What",
      render: (v, row) => {
        const n = str(v);
        const tone = row.level === "warning" ? "warn" : "error";
        return el("span", { class: `status ${tone}` }, n === "error" || n === "warn" ? `${n} · ${str(row.kind)}` : n);
      },
    },
    { key: "msg", label: "Message" },
    { key: "at_page", label: "Where" },
    { key: "a_session", label: "A session", render: (v) => (str(v) === "" ? "" : sidLink(str(v))) },
    { key: "sessions", label: "Sessions", num: true },
    { key: "times", label: "Times", num: true },
    { key: "a_machine", label: "A machine" },
    { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
    { key: "last_seen", label: "Last seen", when: true, render: when },
  ];
  // The totals are distinct over the range, the same on every row: a session
  // with two problems is one session here.
  const first = rows[0];
  const erred = first === undefined ? 0 : num(first.sessions_with_errors);
  const warned = first === undefined ? 0 : num(first.sessions_with_warnings);
  const problems = rows.filter((r) => r.level !== "warning").length;
  const warnings = rows.length - problems;
  const sub =
    rows.length === 0
      ? "Problems in this range, grouped by their first hundred characters"
      : `${problems} distinct error${problems === 1 ? "" : "s"} in ${erred} session${erred === 1 ? "" : "s"}, ${warnings} distinct warning${warnings === 1 ? "" : "s"} in ${warned}; grouped by their first hundred characters`;
  return card("What went wrong", sub, "", table(cols, rows, "Nothing went wrong in this range."));
}

/**
 * Clean is of the sessions that said goodbye (an `end` row), unknown is the
 * sessions that did not, its own number and not a dirty one. Of the sessions
 * that played and never said goodbye, one whose tab went hidden and never
 * came back went to the background; the rest ended silently.
 */
export function healthView(rows: Row[]): HTMLElement {
  const sum = (key: string): number => rows.reduce((n, r) => n + num(r[key]), 0);
  const sessions = sum("sessions");
  const ended = sum("ended");
  const clean = sum("clean");
  const unknown = sum("unknown");
  const silent = sum("ended_silently");
  const backgrounded = sum("backgrounded");
  const tiles = el(
    "div",
    { class: "tiles" },
    tile("Sessions", compact(sessions)),
    tile("Clean", compact(clean), { text: ended ? `${Math.round((clean / ended) * 100)}% of the ${ended} that said goodbye` : "none said goodbye yet", tone: ended ? "good" : undefined }),
    tile("Unknown", compact(unknown), { text: "no goodbye, so no verdict" }),
    tile("Ended silently", String(silent), { text: "played, then nothing", tone: silent > 0 ? "bad" : undefined }),
    tile("Went to the background", String(backgrounded), { text: "played, then the tab went hidden" }),
  );
  const cols: Column[] = [
    { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
    { key: "tier", label: "Tier" },
    { key: "engine", label: "Engine" },
    { key: "sessions", label: "Sessions", num: true },
    { key: "played", label: "Played", num: true },
    { key: "ended", label: "Said goodbye", num: true },
    { key: "clean", label: "Clean", num: true },
    { key: "troubled", label: "Troubled", num: true },
    { key: "unknown", label: "Unknown", num: true },
    { key: "ended_silently", label: "Silent", num: true },
    { key: "backgrounded", label: "Background", num: true },
    { key: "p50_start_ms", label: "Start p50 (ms)", num: true },
    { key: "p90_start_ms", label: "Start p90 (ms)", num: true },
    { key: "p50_ready_ms", label: "Ready p50 (ms)", num: true },
    { key: "p50_fps", label: "fps p50", num: true },
    { key: "p90_worst_frame_ms", label: "Worst frame p90 (ms)", num: true },
  ];
  return card("Load times and frame rates", "By build, tier and engine; the start is the tier's decision, the engine and the build, the ready is the world's first whole frame", "", tiles, table(cols, rows));
}

/**
 * Visitors: distinct browsers (`vid`) over the range and how many came back
 * (seen on more than one New York day in the last ninety), from the `kpis`
 * query's range row; the last seven New York days against the seven before
 * from its window rows; and the browsers themselves, the most recently seen
 * first, from the `visitors` query, each a link to its sessions.
 */
export function visitorsView(kpis: Row[], visitors: Row[]): HTMLElement {
  const range = kpis.find((r) => r.kind === "range");
  const current = kpis.find((r) => r.kind === "window" && r.period === "current");
  const previous = kpis.find((r) => r.kind === "window" && r.period === "previous");
  const unique = range === undefined ? 0 : num(range.visitors);
  const returning = range === undefined ? 0 : num(range.returning);
  const sessions = range === undefined ? 0 : num(range.sessions);
  // The windows are the last seven days and the seven before, inside the range: a range
  // shorter than fourteen days cuts them, so the trend is shown only when both are whole.
  const trend = (key: string): { text: string; tone?: "good" | "bad" } | undefined => {
    if (current === undefined || previous === undefined || num(previous.sessions) === 0) return undefined;
    const now = num(current[key]);
    const before = num(previous[key]);
    return { text: `${now} in the last 7 days, ${before} the 7 before`, tone: now > before ? "good" : now < before ? "bad" : undefined };
  };
  const tiles = el(
    "div",
    { class: "tiles" },
    tile("Visitors", compact(unique), trend("visitors")),
    tile("Returning", compact(returning), { text: unique ? `${Math.round((returning / unique) * 100)}% came back on another day` : "seen on more than one day" }),
    tile("Sessions a visitor", unique ? (sessions / unique).toFixed(1) : "0"),
  );
  const cols: Column[] = [
    { key: "vid", label: "Visitor", render: (v) => vidLink(str(v)) },
    { key: "sessions", label: "Sessions", num: true },
    { key: "days", label: "Days", num: true },
    { key: "played", label: "Played", num: true },
    { key: "finished", label: "Reached an end", num: true },
    { key: "machine", label: "Machine" },
    { key: "build", label: "Last build", render: (v) => el("span", { class: "mono" }, str(v)) },
    { key: "last_sid", label: "Last session", render: (v) => (str(v) === "" ? "" : sidLink(str(v))) },
    { key: "last_seen", label: "Last seen", when: true, render: when },
  ];
  const shown = visitors.slice(0, 12);
  return card(
    "Visitors",
    "Distinct browsers in this range; returning is one seen on more than one New York day in the last ninety",
    "",
    tiles,
    el("details", { class: "table", open: "" }, el("summary", {}, `Visitors, the latest ${shown.length} of ${visitors.length}`), table(cols, shown, "No visitors in this range.")),
  );
}

/** A drawer over the page, closed by its button, the backdrop or Escape; the body is the caller's to fill. */
function drawer(title: (Node | string)[], body: HTMLElement): HTMLElement {
  const close = el("button", { class: "ghost", type: "button" }, "Close");
  const panel = el("div", { class: "drawer" }, el("div", { class: "drawer-top" }, el("h2", {}, ...title), close), body);
  const backdrop = el("div", { class: "backdrop" }, panel);
  const dismiss = (): void => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      // The topmost drawer takes the key.
      const open = document.querySelectorAll(".backdrop");
      if (open[open.length - 1] === backdrop) dismiss();
    }
  };
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dismiss();
  });
  document.addEventListener("keydown", onKey);
  return backdrop;
}

const SEGMENT_WORDS: Record<Segment, string> = { landing: "Landing", lobby: "Lobby", loading: "Loading", match: "Match", after: "After" };

/**
 * The trail's rows: a heading where a step opens a segment (the lobby's and
 * the match's carrying the ids, linked to the party's other sessions), then
 * the step with its New York clock, the time since the step before it shown,
 * its name and its text, an error's stack behind a fold.
 */
function trailRows(steps: Step[], game: string, lobby: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let previous: number | null = null;
  for (const step of steps) {
    if (step.opens !== null) {
      const heading: (Node | string)[] = [SEGMENT_WORDS[step.opens]];
      if (step.opens === "lobby" && lobby !== "") heading.push(" ", game !== "" ? gameLink(game, lobby) : el("span", { class: "mono" }, lobby), game !== "" ? " · the party's sessions" : "");
      if (step.opens === "match" && game !== "") heading.push(" ", gameLink(game, game), " · every session in it");
      out.push(el("tr", { class: "segment" }, el("td", { colspan: "4" }, ...heading)));
    }
    const gap = previous === null || !Number.isFinite(step.at) ? null : step.at - previous;
    if (Number.isFinite(step.at)) previous = step.at;
    const name = el("span", { class: `status ${step.tone}`.trim() }, step.signaling ? `${step.n} (signaling)` : step.n);
    const text: Node | string = step.stack === "" ? step.text : el("details", {}, el("summary", {}, step.text), el("pre", { class: "stack" }, step.stack));
    out.push(
      el(
        "tr",
        { class: `step${step.trace ? " trace" : ""}${step.signaling ? " signal" : ""}` },
        el("td", { class: "when", title: Number.isFinite(step.at) ? `${fullWhen(step.at)} (New York)` : "" }, Number.isFinite(step.at) ? clock(step.at) : ""),
        el("td", { class: "num dt" }, delta(gap)),
        el("td", {}, name),
        el("td", { class: "what" }, text),
      ),
    );
  }
  return out;
}

/**
 * One session's trail, as a drawer over the page: the envelope's facts, then
 * every row in order under the segment it falls in, with the New York wall
 * clock and the time since the row before, the payload as a line of text, the
 * signaling rows of its lobby among them, an error's stack in full behind a
 * fold. The route's samples (position and edge rows, every two seconds of a
 * walk) are folded until asked for, since the paths card draws them. The vid
 * links to the visitor's other sessions, the lobby to the party's.
 */
export function sessionDrawer(sid: string, rows: Promise<Row[]>): HTMLElement {
  const body = el("div", { class: "drawer-body" }, el("p", { class: "sub" }, "Loading…"));
  const backdrop = drawer(["Session ", el("span", { class: "mono" }, sid)], body);
  rows.then(
    (list) => {
      if (list.length === 0) {
        body.replaceChildren(el("div", { class: "empty" }, "No rows for this session."));
        return;
      }
      const trail = trailOf(list);
      const facts: (Node | string)[] = [];
      if (Number.isFinite(trail.startedAt)) facts.push(`${dayOf(trail.startedAt)}, New York`);
      if (Number.isFinite(trail.startedAt) && Number.isFinite(trail.endedAt)) facts.push(` · ${duration(trail.endedAt - trail.startedAt)}`);
      facts.push(` · ${list.length} rows`);
      if (trail.build !== "") facts.push(" · build ", el("span", { class: "mono" }, trail.build));
      if (trail.vid !== "") facts.push(" · visitor ", vidLink(trail.vid), " (their other sessions)");
      const machine = envelopeLine(trail.first);
      const head = el("p", { class: "sub" }, ...facts);
      const tbody = el("tbody", {});
      const draw = (withTrace: boolean): void => {
        tbody.replaceChildren(...trailRows(withTrace ? trail.steps : trail.steps.filter((s) => !s.trace), trail.game, trail.lobby));
      };
      const toggle = el("input", { type: "checkbox" });
      toggle.addEventListener("change", () => draw(toggle.checked));
      const traceLine = trail.trace === 0 ? el("span", {}) : el("label", { class: "trace-toggle" }, toggle, ` Show the route's ${trail.trace} samples (pos, edge, fork, place, lamp)`);
      draw(false);
      const table = el(
        "table",
        { class: "trail" },
        el("thead", {}, el("tr", {}, el("th", {}, "New York"), el("th", { class: "num" }, "Δt"), el("th", {}, "Event"), el("th", {}, "What"))),
        tbody,
      );
      body.replaceChildren(head, machine === "" ? el("span", {}) : el("p", { class: "sub" }, machine), traceLine, el("div", { class: "table-wrap" }, table));
    },
    (error: unknown) => {
      body.replaceChildren(el("div", { class: "empty" }, `Could not read the session: ${error instanceof Error ? error.message : String(error)}`));
    },
  );
  return backdrop;
}

/**
 * A visitor's or a match's sessions, as a drawer: one line a session in the
 * order they began, each a link that opens its trail over this drawer. The
 * visitor's are every session of one browser; the match's are the party's,
 * side by side.
 */
export function sessionsDrawer(kind: "visitor" | "match", id: string, rows: Promise<Row[]>): HTMLElement {
  const body = el("div", { class: "drawer-body" }, el("p", { class: "sub" }, "Loading…"));
  const backdrop = drawer([kind === "visitor" ? "Visitor " : "Match ", el("span", { class: "mono" }, id)], body);
  rows.then(
    (list) => {
      const lines = sessionsOf(list);
      if (lines.length === 0) {
        body.replaceChildren(el("div", { class: "empty" }, kind === "visitor" ? "No sessions for this visitor." : "No sessions for this match."));
        return;
      }
      const first = lines[0]!;
      const last = lines[lines.length - 1]!;
      const days = new Set(lines.map((l) => dayOf(l.startedAt))).size;
      const cols: Column[] = [
        { key: "startedAt", label: "Began (New York)", when: true, render: (v) => el("span", { title: `${fullWhen(num(v))} (New York)` }, nyWhen(num(v))) },
        { key: "sid", label: "Session", render: (v) => sidLink(str(v)) },
        { key: "role", label: "Role" },
        { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
        { key: "rows", label: "Rows", num: true },
        { key: "endedAt", label: "Lasted", num: true, render: (v, row) => duration(num(v) - num(row.startedAt)) },
        { key: "end", label: "End", render: (v, row) => el("span", { class: `status ${str(row.tone)}`.trim() }, str(v)) },
        { key: "errors", label: "Errors", num: true },
        ...(kind === "visitor" ? [{ key: "game", label: "Match", render: (v: unknown) => (str(v) === "" ? "" : gameLink(str(v))) } satisfies Column] : [{ key: "vid", label: "Visitor", render: (v: unknown) => (str(v) === "" ? "" : vidLink(str(v))) } satisfies Column]),
      ];
      const sub =
        kind === "visitor"
          ? `${lines.length} session${lines.length === 1 ? "" : "s"} on ${days} New York day${days === 1 ? "" : "s"}, ${nyWhen(first.startedAt)} to ${nyWhen(last.endedAt)}; open one for its trail`
          : `${lines.length} session${lines.length === 1 ? "" : "s"} in the match, ${nyWhen(first.startedAt)} to ${nyWhen(last.endedAt)}; open one for its trail`;
      body.replaceChildren(el("p", { class: "sub" }, sub), table(cols, lines as unknown as Record<string, unknown>[]));
    },
    (error: unknown) => {
      body.replaceChildren(el("div", { class: "empty" }, `Could not read the ${kind}: ${error instanceof Error ? error.message : String(error)}`));
    },
  );
  return backdrop;
}
