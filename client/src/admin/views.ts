/**
 * The page's sections, one a query plus the live rooms: each takes its rows
 * and returns a card. The forms follow the data's job: the funnel and the
 * live counts are figures; lobbies a day and how far parties got are
 * magnitudes, so single-hue columns; matches, errors and health are tables,
 * with a status mark beside a word where a state is the point; paths are a
 * drawing.
 */

import { ago, columns, compact, el, funnel, histogram, table, tableView, tile, type Column } from "./charts.js";
import type { Live, Row } from "./source.js";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const shortId = (id: string): string => id.slice(0, 8);
/** A session id as the link that opens its timeline (`main.ts` listens for `data-sid`). */
const sidLink = (sid: string): Node => el("a", { href: "#", class: "mono", "data-sid": sid, title: "Open this session's timeline" }, shortId(sid));
const when = (v: unknown): string => (typeof v === "string" && v !== "" ? ago(Date.parse(v)) : "");

function card(title: string, sub: string, cls = "", ...body: Node[]): HTMLElement {
  return el("section", { class: `card ${cls}`.trim() }, el("h2", {}, title), el("p", { class: "sub" }, sub), ...body);
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

export function funnelView(rows: Row[]): HTMLElement {
  const latest = rows[0];
  const stages = latest === undefined ? [] : [
    { name: "Landed", value: num(latest.landed) },
    { name: "Pressed Play", value: num(latest.pressed_play) },
    { name: "Started a match", value: num(latest.started) },
    { name: "Reached an end", value: num(latest.finished) },
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
    latest === undefined ? "Sessions by what they reached" : `Sessions on build ${str(latest.build)}, by what they reached; every build in the table`,
    "half",
    latest === undefined ? el("div", { class: "empty" }, "No sessions in this range.") : funnel(stages),
    tableView(cols, rows),
  );
}

export function lobbiesView(rows: Row[]): HTMLElement {
  const bars = rows.map((r) => ({ label: str(r.day).slice(5), value: num(r.lobbies), detail: `${str(r.day)} · ${num(r.lobbies_joined)} joined · largest ${str(r.largest) || "–"}` }));
  const refused = rows.reduce((n, r) => n + num(r.refused_full) + num(r.refused_stale_invite) + num(r.refused_host_away), 0);
  const lost = rows.reduce((n, r) => n + num(r.hosts_lost), 0);
  const cols: Column[] = [
    { key: "day", label: "Day" },
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

export function progressView(rows: Row[]): HTMLElement {
  const values = rows.map((r) => num(r.farthest));
  const won = rows.filter((r) => r.result === "won").length;
  const lost = rows.filter((r) => r.result === "lost").length;
  const tiles = el(
    "div",
    { class: "tiles" },
    tile("Matches", String(rows.length)),
    tile("Reached the crest", String(rows.filter((r) => r.summit === true).length)),
    tile("Won", String(won), { text: rows.length ? `${Math.round((won / rows.length) * 100)}% of matches` : "" }),
    tile("Lost", String(lost)),
  );
  const cols: Column[] = [
    { key: "started_at", label: "Started", when: true, render: when },
    { key: "sid", label: "Session", render: (v) => sidLink(str(v)) },
    { key: "role", label: "Role" },
    { key: "party", label: "Party", num: true },
    { key: "farthest", label: "Farthest", num: true, render: (v) => `${Math.round(num(v) * 100)}%` },
    { key: "wet", label: "Acts", render: (_, row) => acts(row) },
    {
      key: "result",
      label: "End",
      render: (v, row) => {
        const result = str(v);
        if (result === "") return el("span", { class: "status" }, str(row.left_by) || "still playing");
        return el("span", { class: `status ${result}` }, `${result}${row.self_at_end === "dead" ? ", died" : ""}`);
      },
    },
    { key: "minutes", label: "Minutes", num: true },
    { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
  ];
  return card(
    "How far parties got",
    "Each match's farthest climb, 0 at the trailhead and 1 at the crest; the night falls from 30%",
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
        const tone = n === "error" || n === "start_fail" || n === "connect_fail" ? "error" : "warn";
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
  const sessions = rows.reduce((n, r) => n + num(r.sessions), 0);
  return card("What went wrong", `${rows.length} distinct problems across ${sessions} sessions in this range; grouped by their first hundred characters`, "", table(cols, rows, "Nothing went wrong in this range."));
}

export function healthView(rows: Row[]): HTMLElement {
  const sessions = rows.reduce((n, r) => n + num(r.sessions), 0);
  const clean = rows.reduce((n, r) => n + num(r.clean), 0);
  const silent = rows.reduce((n, r) => n + num(r.ended_silently), 0);
  const tiles = el(
    "div",
    { class: "tiles" },
    tile("Sessions", compact(sessions)),
    tile("Clean sessions", compact(clean), { text: sessions ? `${Math.round((clean / sessions) * 100)}% ended with no error` : "", tone: "good" }),
    tile("Ended silently", String(silent), { text: "played, then no goodbye", tone: silent > 0 ? "bad" : undefined }),
  );
  const cols: Column[] = [
    { key: "build", label: "Build", render: (v) => el("span", { class: "mono" }, str(v)) },
    { key: "tier", label: "Tier" },
    { key: "engine", label: "Engine" },
    { key: "sessions", label: "Sessions", num: true },
    { key: "played", label: "Played", num: true },
    { key: "clean", label: "Clean", num: true },
    { key: "ended_silently", label: "Silent", num: true },
    { key: "p50_start_ms", label: "Start p50 (ms)", num: true },
    { key: "p90_start_ms", label: "Start p90 (ms)", num: true },
    { key: "p50_ready_ms", label: "Ready p50 (ms)", num: true },
    { key: "p50_fps", label: "fps p50", num: true },
    { key: "p90_worst_frame_ms", label: "Worst frame p90 (ms)", num: true },
  ];
  return card("Load times and frame rates", "By build, tier and engine; the start is the tier's decision, the engine and the build, the ready is the world's first whole frame", "", tiles, table(cols, rows));
}

/** The position samples of one world, drawn on a canvas: every sample a faint dot, so where parties went reads as density. */
export function pathsView(rows: Row[]): HTMLElement {
  const worlds = [...new Set(rows.map((r) => `${str(r.world)} · seed ${str(r.seed)}`))];
  const select = el("select", {}, ...worlds.map((w) => el("option", { value: w }, w)));
  const canvas = el("canvas", { width: "560", height: "560" });
  const side = el("div", { class: "side" });
  const draw = (): void => {
    const chosen = select.value;
    const points = rows.filter((r) => `${str(r.world)} · seed ${str(r.seed)}` === chosen);
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length === 0) return;
    const xs = points.map((p) => num(p.x));
    const zs = points.map((p) => num(p.z));
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const pad = 24;
    const scale = (canvas.width - pad * 2) / span;
    const series = getComputedStyle(document.documentElement).getPropertyValue("--series").trim() || "#2a78d6";
    const critical = getComputedStyle(document.documentElement).getPropertyValue("--critical").trim() || "#d03b3b";
    ctx.globalAlpha = 0.22;
    for (const p of points) {
      const x = pad + (num(p.x) - minX) * scale;
      const y = pad + (num(p.z) - minZ) * scale;
      ctx.fillStyle = num(p.hp) <= 0 ? critical : series;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sessions = new Set(points.map((p) => str(p.sid))).size;
    const deaths = points.filter((p) => num(p.hp) <= 0).length;
    side.replaceChildren(
      el("div", { class: "tiles" }, tile("Sessions", String(sessions)), tile("Samples", compact(points.length)), tile("Deaths", String(deaths))),
      el("p", { class: "sub" }, "Each dot is one player's position, sampled every five seconds; a red dot is a death. Darker means more parties passed there. North is up; the crest is at the top."),
    );
  };
  select.addEventListener("change", draw);
  queueMicrotask(draw);
  return card("Where parties went", "One world at a time, since positions are the world's own frame", "", el("div", { class: "paths" }, canvas, el("div", { class: "side" }, el("p", {}, select), side)));
}

/**
 * One session's timeline, as a drawer over the page: every row in order with
 * its time from the page's load, the signaling rows of its lobby among them,
 * an error's message and stack in full. Closed by its button, the backdrop,
 * or Escape.
 */
export function sessionDrawer(sid: string, rows: Promise<Row[]>): HTMLElement {
  const close = el("button", { class: "ghost", type: "button" }, "Close");
  const body = el("div", { class: "drawer-body" }, el("p", { class: "sub" }, "Loading…"));
  const panel = el("div", { class: "drawer" }, el("div", { class: "drawer-top" }, el("h2", {}, "Session ", el("span", { class: "mono" }, sid)), close), body);
  const backdrop = el("div", { class: "backdrop" }, panel);
  const dismiss = (): void => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") dismiss();
  };
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dismiss();
  });
  document.addEventListener("keydown", onKey);
  rows.then(
    (list) => {
      if (list.length === 0) {
        body.replaceChildren(el("div", { class: "empty" }, "No rows for this session."));
        return;
      }
      const first = list.find((r) => r.svc === "telemetry");
      const summary = first === undefined ? "" : `Build ${str(first.build)}`;
      const cols: Column[] = [
        { key: "t", label: "At", num: true, render: (v, row) => (typeof v === "number" ? `${(v / 1000).toFixed(1)} s` : new Date(str(row.timestamp)).toLocaleTimeString()) },
        {
          key: "n",
          label: "Event",
          render: (v, row) => {
            const n = str(v);
            const tone = n === "error" ? "error" : n === "warn" ? "warn" : row.svc === "signaling" ? "" : "";
            return el("span", { class: `status ${tone}` }, row.svc === "signaling" ? `${n} (signaling)` : n);
          },
        },
        { key: "at_page", label: "Where" },
        { key: "kind", label: "Kind" },
        {
          key: "msg",
          label: "Message",
          render: (v, row) => {
            const text = str(v);
            const stack = str(row.stack);
            if (stack === "") return text;
            return el("details", {}, el("summary", {}, text), el("pre", { class: "stack" }, stack));
          },
        },
      ];
      body.replaceChildren(el("p", { class: "sub" }, `${list.length} rows · ${summary}`), table(cols, list));
    },
    (error: unknown) => {
      body.replaceChildren(el("div", { class: "empty" }, `Could not read the session: ${error instanceof Error ? error.message : String(error)}`));
    },
  );
  return backdrop;
}
