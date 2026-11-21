/**
 * The page's sections, one a query plus the live rooms: each takes its rows
 * and returns a card. The forms follow the data's job: the funnel is a
 * flow, and who is playing now one mark beside the range; where players are
 * is a bar a city; the players are one table, a line a person, over two
 * verdict bars (how far they got, how the game ran); errors are a table, with
 * a status mark beside a word where a state is the point; paths
 * are a drawing; a session is a trail (`timeline.ts`), in a drawer.
 *
 * Every time shown is in the viewer's own zone (`timeline.ts`): the relative
 * "12 min ago" and, beside it, the wall clock there, which is the clock the
 * queries bucket by; a label names the zone by its short name (`PDT`).
 */

import { ago, compact, el, folded, funnel, table, tile, type Column } from "./charts.js";
import { worldMap, type MapPlace } from "./worldMap.js";
import { accordion, easeHeight, fadeIn, look, parseDuration, play, rootToken, settled, tokens } from "./motion.js";
import type { Live, Row } from "./source.js";
import { clock, dayOf, delta, duration, envelopeLine, fullWhen, sessionsOf, trailOf, when as wallWhen, zoneName, type Segment, type Step } from "./timeline.js";

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const bool = (v: unknown): boolean => v === true || v === "true";
const shortId = (id: string): string => id.slice(0, 8);
/** A session id as the link that opens its timeline (`main.ts` listens for `data-sid`). */
const sidLink = (sid: string): Node => el("a", { href: "#", class: "mono", "data-sid": sid, title: `Open session ${sid}` }, shortId(sid));
/** A visitor id as the link that lists the browser's sessions (`data-vid`). */
const vidLink = (vid: string, text = shortId(vid)): Node => el("a", { href: "#", class: "mono", "data-vid": vid, title: `Every session of visitor ${vid}` }, text);
/** A game id as the link that lists the match's sessions side by side (`data-game`). */
const gameLink = (game: string, text = shortId(game)): Node => el("a", { href: "#", class: "mono", "data-game": game, title: `Every session of match ${game}` }, text);
/** A time column: how long ago, and the viewer's wall clock beside it; the full moment, its zone named, as the title. */
const when = (v: unknown): Node | string => {
  if (typeof v !== "string" || v === "") return "";
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return "";
  return el("span", { title: fullWhen(ms) }, `${ago(ms)} · ${wallWhen(ms)}`);
};

export function card(title: string, sub: string, cls = "", ...body: Node[]): HTMLElement {
  return el("section", { class: `card ${cls}`.trim() }, el("h2", {}, title), el("p", { class: "sub" }, sub), ...body);
}

/** What a waiting card stands in for: stat `tiles` (`tile` px tall), a `chart` this many px tall, `rows` of a table (`row` px apart), `folds` folded tables. */
export type Shape = { tiles?: number; tile?: number; chart?: number; rows?: number; row?: number; folds?: number };

/**
 * The card as it waits for its query: the same title and copy over a skeleton the shape
 * of what is coming, in the host's Material skeleton (`/theme.css`: each part the shape of
 * the content it stands for, in a tint of the text colour that pulses; Cyrus, 2026-10-29).
 * Busy for a screen reader, which hears "Loading"; the shapes are hidden from it. The page
 * holds it at the height the card last had (`hold.ts`), so nothing moves when it fills.
 */
export function waitingCard(title: string, sub: string, cls: string, shape: Shape): HTMLElement {
  const sk = (c: string, style = ""): HTMLElement => el("div", style === "" ? { class: `skel ${c}` } : { class: `skel ${c}`, style });
  const parts: HTMLElement[] = [];
  if (shape.tiles) {
    parts.push(el("div", { class: "skel-tiles" }, ...Array.from({ length: shape.tiles }, () =>
      el("div", { class: "skel-tile", style: `height:${shape.tile ?? 98}px` }, sk("text label"), sk("text figure"), ...((shape.tile ?? 98) >= 110 ? [sk("text short")] : [])))));
  }
  if (shape.chart) parts.push(sk("rect chart", `height:${shape.chart}px`));
  if (shape.rows) {
    parts.push(el("div", { class: "skel-list" }, sk("text head"), ...Array.from({ length: shape.rows }, (_, i) =>
      el("div", { class: "skel-trow", style: `height:${shape.row ?? 33}px` }, sk(`text${i % 3 === 2 ? " short" : ""}`), sk("text num"), sk("text num")))));
  }
  for (let i = 0; i < (shape.folds ?? 0); i += 1) parts.push(sk("text fold"));
  const body = el("div", { class: "body", "aria-busy": "true" }, el("p", { class: "sr-only" }, "Loading"), el("div", { class: "skeleton", "aria-hidden": "true" }, ...parts));
  return card(title, sub, cls, body);
}

/** The card when its query failed: the same title and copy over the error, so the rest of the page stands. */
export function failedCard(title: string, sub: string, cls: string, message: string): HTMLElement {
  return card(title, sub, cls, el("p", { class: "error", role: "status" }, `Could not be read. ${message}`));
}

/**
 * Who is playing now, as one small mark beside the range: a dot, lit while
 * anyone is in a match, and how many are. Playing is a session whose heartbeat
 * was heard in the last two minutes (`now.sql`), so a solo hike counts though
 * it opens no lobby; an open lobby adds "1 lobby open", the one thing about
 * lobbies worth seeing at a glance. Its title names each session: its build,
 * tier, how far up it is and its frame rate. Null `playing` (that read failed)
 * says the lobbies alone.
 */
export function nowIndicator(live: Live): HTMLElement {
  const playing = live.playing ?? [];
  const lobbies = live.rooms.length;
  const count = playing.length;
  const words = live.playing === null ? "Playing now unknown" : count === 0 ? "No one playing" : `${count} playing now`;
  const lobbyWords = lobbies === 0 ? "" : ` · ${lobbies} lobb${lobbies === 1 ? "y" : "ies"} open`;
  const lines = playing.map((r) => {
    const parts = [shortId(str(r.vid) || str(r.sid)), str(r.tier), r.p === null || r.p === undefined ? "" : `${Math.round(num(r.p) * 100)}% up`, r.fps === null || r.fps === undefined ? "" : `${Math.round(num(r.fps))} fps`, str(r.build)];
    return parts.filter(Boolean).join(" · ");
  });
  const title = [`Sessions heard from in the last two minutes, as of ${new Date(live.at).toLocaleTimeString()}`, ...lines].join("\n");
  return el("span", { class: `now${count > 0 ? " on" : ""}`, role: "status", title }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "words" }, words + lobbyWords));
}

/**
 * The line under the funnel's title: the sessions and the builds, and, of
 * the sessions that landed, how many the load check turned away (a browser
 * or a GPU that cannot play: `turned_away`), who could never press Play and
 * so stand between the first stage and the second. A query from before the
 * count (no such column) says nothing of them.
 */
export function funnelLine(all: Row, builds: number): string {
  const turned = num(all.turned_away);
  const away = all.turned_away === undefined || all.turned_away === null ? "" : `; ${turned} of those that landed could not play here and were turned away`;
  return `${num(all.sessions)} sessions on ${builds} build${builds === 1 ? "" : "s"}, each stage's share of the one before${away}`;
}

/**
 * The funnel is the query's `all` row, every build together, drawn as a
 * funnel; the per-build rows only count the builds in the line under the
 * title. The stages nest per session (a session counts at a stage only where
 * it counted at the one before), so the shares read as shares. The sessions
 * the load check turned away are a count beside the stages, not one of them:
 * they landed and could go no further.
 */
function funnelPart(rows: Row[]): HTMLElement {
  const all = rows.find((r) => r.build === "all");
  const builds = rows.filter((r) => r.build !== "all");
  const stages = all === undefined ? [] : [
    { name: "Landed", value: num(all.landed) },
    { name: "Pressed Play", value: num(all.pressed_play) },
    { name: "Started a match", value: num(all.started) },
    { name: "Reached an end", value: num(all.finished) },
  ];
  return el(
    "div",
    { class: "part" },
    el("h3", {}, "From landing to the end"),
    el("p", { class: "sub" }, all === undefined ? "Sessions by what they reached" : funnelLine(all, builds.length)),
    all === undefined || num(all.landed) === 0 ? el("div", { class: "empty" }, "No sessions in this range.") : funnel(stages),
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
    // The owner's own sessions are out of every count on the page, but the errors they meet are
    // the first anyone sees, so the query keeps them on rows of their own, marked here.
    { key: "whose", label: "Whose", render: (v) => (str(v) === "you" ? el("span", { class: "status warn" }, "you") : "players") },
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
  const players = rows.filter((r) => str(r.whose) !== "you");
  const own = rows.length - players.length;
  const problems = players.filter((r) => r.level !== "warning").length;
  const warnings = players.length - problems;
  const sub =
    rows.length === 0
      ? "Problems in this range, grouped by their first hundred characters"
      : `${problems} distinct error${problems === 1 ? "" : "s"} in ${erred} session${erred === 1 ? "" : "s"}, ${warnings} distinct warning${warnings === 1 ? "" : "s"} in ${warned}${own > 0 ? `, and ${own} of your own` : ""}; grouped by their first hundred characters`;
  return card("What went wrong", sub, "", table(cols, rows, "Nothing went wrong in this range."));
}

/** An operating system as people say it, from the page's `os` (`darwin-arm64`, `win32-x64`, `android-arm64`). */
export function osName(raw: string): string {
  const os = raw.split(/[-\s]/)[0]?.toLowerCase() ?? "";
  return ({ darwin: "macOS", win32: "Windows", linux: "Linux", android: "Android", ios: "iOS", cros: "ChromeOS" } as Record<string, string>)[os] ?? (raw === "" ? "" : "Other");
}

/** The machine column: the GPU as people say it, else the operating system; the details in its title. */
const machineColumn: Column = {
  key: "gpu",
  label: "Machine",
  render: (v, row) => {
    const gpu = gpuName(str(v));
    // A browser that hides its GPU names itself there (Brave); the system says more then.
    const name = gpu !== "" && !/^(Brave|Apple GPU)$/.test(gpu) ? gpu : [gpu === "Apple GPU" ? "Apple GPU" : "", osName(str(row.os) || str(row.machine))].filter(Boolean).join(", ");
    return el("span", { title: [str(v), str(row.os) || str(row.machine), str(row.tier) && `${str(row.tier)} tier`, str(row.engine)].filter(Boolean).join(" · ") }, name || "–");
  },
};

/** Where a player is, by city (`geo` rows; `placeName`); a dash where the collector had not placed them yet. */
const whereColumn: Column = {
  key: "city",
  label: "Where",
  render: (_, row) => {
    const where = placeName(row);
    return where === "" ? el("span", { class: "faint", title: "Not placed: from before places were recorded, or the address was unknown" }, "–") : el("span", { class: "where" }, where);
  },
};

/** How far a visitor got in the range: finished a hike, played one, or only looked. */
type Reach = "finished" | "played" | "looked";
const REACHES: Reach[] = ["finished", "played", "looked"];
const REACH_WORDS: Record<Reach, string> = { finished: "Finished", played: "Played", looked: "Only looked" };
const REACH_TONE: Record<Reach, string> = { finished: "good", played: "played", looked: "looked" };
export function reachOf(row: Record<string, unknown>): Reach {
  return num(row.finished) > 0 ? "finished" : num(row.played) > 0 ? "played" : "looked";
}

/**
 * How a player's game went, by the two things a player feels: how long it took
 * to load (from Play to the world's first whole frame, `health.sql`) and how
 * smoothly it ran (the median frame rate in a match). Each is good, slow or bad against the marks below;
 * a player's verdict is the worse of the two, and a player with neither (gone
 * before the world was in) has none.
 */
export const LOAD_MS = { good: 15_000, slow: 30_000 } as const;
export const FPS = { good: 50, slow: 30 } as const;
export type Verdict = "good" | "slow" | "bad";
const RANK: Record<Verdict, number> = { good: 0, slow: 1, bad: 2 };
const WORDS: Record<Verdict, string> = { good: "Good", slow: "Slow", bad: "Bad" };

export function loadVerdict(ms: number | null): Verdict | null {
  if (ms === null) return null;
  return ms <= LOAD_MS.good ? "good" : ms <= LOAD_MS.slow ? "slow" : "bad";
}
export function fpsVerdict(fps: number | null): Verdict | null {
  if (fps === null) return null;
  return fps >= FPS.good ? "good" : fps >= FPS.slow ? "slow" : "bad";
}
export function playerVerdict(row: Record<string, unknown>): Verdict | null {
  const marks = [loadVerdict(present(row.load_ms)), fpsVerdict(present(row.fps))].filter((v): v is Verdict => v !== null);
  return marks.length === 0 ? null : marks.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}
/** A number from a row, or null where the row has none (a session that never reached that point). */
function present(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** A GPU's name as people say it: the renderer string's ANGLE wrapping and driver text dropped. */
export function gpuName(raw: string): string {
  const angle = /^ANGLE \([^,]*,\s*([^,]+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|,|\)$)/i.exec(raw);
  // A driver's own words in brackets at the end (`(radeonsi navi22 LLVM 17.0.6)`) go too.
  // and so do ANGLE's renderer label (`ANGLE Metal Renderer: Apple M3 Max`) and a GL bus suffix (`/PCIe/SSE2`).
  return (angle?.[1] ?? raw)
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/^ANGLE [A-Za-z0-9]+ Renderer:\s*/, "")
    .replace(/\/PCIe\/SSE2$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const mark = (verdict: Verdict | null, text: string): Node =>
  verdict === null ? el("span", { class: "faint" }, "–") : el("span", { class: `status ${verdict}` }, text);

/** A country's English name from its ISO code, the code itself where the runtime has no name. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A place as people say it: the city and its region, then the country, leaving out whatever the database did not know. */
export function placeName(row: Record<string, unknown>): string {
  const city = str(row.city);
  const region = str(row.region);
  const country = str(row.country);
  const local = [city, region !== city ? region : ""].filter(Boolean).join(", ");
  if (local === "") return country === "" ? "" : countryName(country);
  return country === "" ? local : `${local} · ${country}`;
}

/**
 * Where Day Hike's visitors are (`places.sql`, from csarko.sh's analytics): a flat map of the world
 * with a mark a city (`worldMap.ts`), and beside it the most visited cities with their counts, the ones that
 * reached a game first in each pair. Visits the collector could not place (any from before it had
 * the city database) are a line under the list; a city with no coordinates is in the list and not
 * on the map. DB-IP's licence asks for its name and a link wherever its places are shown, so the
 * part ends with both.
 */
function placesPart(rows: Row[]): HTMLElement {
  const placed = rows.filter((r) => placeName(r) !== "");
  const unplaced = rows.filter((r) => placeName(r) === "");
  const visits = rows.reduce((n, r) => n + num(r.visits), 0);
  const played = rows.reduce((n, r) => n + num(r.played), 0);
  const countries = new Set(placed.map((r) => str(r.country)).filter(Boolean)).size;
  const onMap: MapPlace[] = placed
    .filter((r) => present(r.lat) !== null && present(r.lon) !== null)
    .map((r) => ({ name: placeName(r), lat: num(r.lat), lon: num(r.lon), visits: num(r.visits), played: num(r.played) }));
  const top = placed.slice(0, 8);
  const away = unplaced.reduce((n, r) => n + num(r.visits), 0);
  const list = el(
    "div",
    { class: "place-list" },
    el("div", { class: "verdict-key places-key" }, el("span", { class: "key played" }, "reached a game"), el("span", { class: "key landed" }, "only the landing page")),
    ...top.map((r) =>
      el(
        "div",
        { class: "place-line" },
        el("span", { class: "name" }, placeName(r)),
        el("span", { class: "n" }, el("b", {}, String(num(r.visits))), el("span", { class: "share" }, `${num(r.played)} played`)),
      ),
    ),
    ...(placed.length > top.length ? [el("p", { class: "faint more" }, `and ${placed.length - top.length} more on the map`)] : []),
    ...(away > 0 ? [el("p", { class: "faint more" }, `${away} visit${away === 1 ? "" : "s"} with no place recorded`)] : []),
  );
  const sub =
    visits === 0
      ? "Day Hike's visits by city, from csarko.sh's analytics"
      : `${visits} visit${visits === 1 ? "" : "s"} from ${placed.length} place${placed.length === 1 ? "" : "s"} in ${countries} countr${countries === 1 ? "y" : "ies"}; ${played} reached a game`;
  return el(
    "div",
    { class: "part" },
    el("h3", {}, "Where players are"),
    el("p", { class: "sub" }, sub),
    rows.length === 0 ? el("div", { class: "empty" }, "No visits in this range.") : el("div", { class: "places-map" }, worldMap(onMap), list),
    el("p", { class: "attribution" }, "Places by city, never by address: ", el("a", { href: "https://db-ip.com", rel: "noopener" }, "IP Geolocation by DB-IP")),
  );
}

/**
 * The Overview card (Cyrus, 2026-11-21: one card for the completion funnel and where players
 * are): how far sessions got, from landing to the end of a hike (`funnel.sql`), and where the
 * visitors came from (`places.sql`), one part under the other.
 */
export function overviewView(funnelRows: Row[], placeRows: Row[]): HTMLElement {
  return card("Overview", "How far sessions got, from landing to the end of a hike, and where the visitors came from", "overview", funnelPart(funnelRows), placesPart(placeRows));
}

/** A verdict bar with its key under it: one segment a kind, as long as its count, in its tone. */
function verdictStrip(label: string, parts: { key: string; words: string; tone: string; count: number }[]): HTMLElement {
  return el(
    "div",
    { class: "verdicts" },
    el("div", { class: "verdict-label" }, label),
    el(
      "div",
      { class: "verdict-bar", role: "img", "aria-label": `${label}: ${parts.map((p) => `${p.count} ${p.words}`).join(", ")}` },
      ...parts.filter((p) => p.count > 0).map((p) => el("span", { class: `seg ${p.tone}`, style: `flex-grow:${p.count}`, title: `${p.count} ${p.words}` })),
    ),
    el("div", { class: "verdict-key" }, ...parts.map((p) => el("span", { class: `status ${p.tone}` }, el("b", {}, String(p.count)), ` ${p.words}`))),
  );
}

/**
 * The climb column: how far a player got and how it ended. A bar to their farthest point (0 at
 * the trailhead, the crest at its end) with the share, and "won" or "lost" where a match of
 * theirs reached an outcome (won before lost); "didn't play" where none of their sessions
 * started a match. Its title has the counts behind it.
 */
const climbColumn: Column = {
  key: "farthest",
  label: "Climb",
  render: (v, row) => {
    const played = num(row.played);
    const title = `${played} of ${num(row.sessions)} session${num(row.sessions) === 1 ? "" : "s"} played, ${num(row.finished)} reached an end${row.died === true ? "; died at least once" : ""}${num(row.party) > 1 ? `; played in a party of up to ${num(row.party)}` : ""}`;
    if (played === 0) return el("span", { class: "faint", title }, "didn't play");
    const far = Math.max(0, Math.min(1, num(v)));
    const result = str(row.result);
    return el(
      "span",
      { class: "climb", title },
      el("span", { class: "climb-track" }, el("span", { class: "climb-fill", style: `width:${far * 100}%` })),
      el("span", { class: "climb-n" }, `${Math.round(far * 100)}%`),
      result === "" ? "" : el("span", { class: `status ${result === "won" ? "good" : "ended"}` }, result),
    );
  },
};

/**
 * Players: everything the page says of one person, once. Over the range, the players and how
 * many came back (the `kpis` query, its last seven days against the seven before), and two bars:
 * how far they got (finished a hike, played, only looked) and how the game ran for them (good,
 * slow or bad, the worse of their load and frame rate). Then one line a player (`players.sql`),
 * the most recently seen first: who and where, on what machine, how often they came, how far
 * they climbed and how it ended, their load time and their frame rate, each load and frame rate
 * marked good, slow or bad against `LOAD_MS` and `FPS`. The player's link opens every session.
 * Last, `went`: where they went on the trail, with the world to show chosen at the card's bottom
 * (`paths.ts`, pathsSection).
 */
export function playersView(kpis: Row[], players: Row[], went: HTMLElement | null = null): HTMLElement {
  const range = kpis.find((r) => r.kind === "range");
  const current = kpis.find((r) => r.kind === "window" && r.period === "current");
  const previous = kpis.find((r) => r.kind === "window" && r.period === "previous");
  const unique = range === undefined ? players.length : num(range.visitors);
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
    tile("Players", compact(unique), trend("visitors")),
    tile("Returning", compact(returning), { text: unique ? `${Math.round((returning / unique) * 100)}% came back on another day` : "seen on more than one day" }),
    tile("Sessions a player", unique ? (sessions / unique).toFixed(1) : "0"),
  );
  const reach = { finished: 0, played: 0, looked: 0 } as Record<Reach, number>;
  const ran = { good: 0, slow: 0, bad: 0 } as Record<Verdict, number>;
  for (const r of players) {
    reach[reachOf(r)]++;
    const v = playerVerdict(r);
    if (v !== null) ran[v]++;
  }
  const strips = el(
    "div",
    { class: "strips" },
    verdictStrip("How far they got", REACHES.map((k) => ({ key: k, words: REACH_WORDS[k].toLowerCase(), tone: REACH_TONE[k], count: reach[k] }))),
    verdictStrip("How the game ran for them", (["good", "slow", "bad"] as const).map((k) => ({ key: k, words: WORDS[k].toLowerCase(), tone: k, count: ran[k] }))),
  );
  const cols: Column[] = [
    { key: "vid", label: "Player", render: (v) => vidLink(str(v)) },
    whereColumn,
    machineColumn,
    {
      key: "sessions",
      label: "Came",
      render: (v, row) => {
        const days = num(row.days);
        // Returning is the 90-day test the Returning tile counts (`players.sql`), whatever the range.
        const back = bool(row.returning) ? el("span", { class: "chip on" }, "returning") : "";
        return el("span", { class: "came", title: `${num(v)} session${num(v) === 1 ? "" : "s"} on ${days} day${days === 1 ? "" : "s"} in this range${bool(row.returning) ? "; seen on more than one day in the last ninety" : ""}` }, `${num(v)} session${num(v) === 1 ? "" : "s"} `, back);
      },
    },
    climbColumn,
    {
      key: "load_ms",
      label: "Load",
      num: true,
      render: (v) => {
        const ms = present(v);
        return mark(loadVerdict(ms), ms === null ? "" : `${(ms / 1000).toFixed(1)} s`);
      },
    },
    {
      key: "fps",
      label: "Frame rate",
      num: true,
      render: (v, row) => {
        const fps = present(v);
        const worst = present(row.worst_frame_ms);
        return el("span", { title: worst === null ? "" : `Worst frame ${worst} ms` }, mark(fpsVerdict(fps), fps === null ? "" : `${Math.round(fps)} fps`));
      },
    },
    // How long ago alone, the moment in its title: the line is long enough already.
    { key: "last_seen", label: "Seen", when: true, render: (v) => el("span", { title: fullWhen(Date.parse(str(v))) }, ago(Date.parse(str(v)))) },
  ];
  const shown = players.slice(0, 20);
  return card(
    "Players",
    `Each person in this range (a browser), how far they got and how the game ran for them; load ${LOAD_MS.good / 1000} s or less is good and past ${LOAD_MS.slow / 1000} s bad, ${FPS.good} fps or more good and under ${FPS.slow} bad; returning is seen on more than one day (${zoneName()}) in the last ninety`,
    "",
    tiles,
    ...(players.length > 0 ? [strips] : []),
    shown.length < players.length
      ? folded(`Players, the latest ${shown.length} of ${players.length}`, table(cols, shown), true)
      : table(cols, shown, "No one in this range."),
    ...(went === null ? [] : [went]),
  );
}

/**
 * How long a drawer takes to leave, in ms: the host's short4 token (`/theme.css`), read through
 * `parseDuration`; 0 under reduced motion or without the token, when it goes at once. `read` is
 * the token reader, :root's computed style by default.
 */
export function drawerExitMs(read: (name: string) => string = rootToken): number {
  return parseDuration(read("--md-duration-short4"));
}

/**
 * A drawer over the page, closed by its button, the backdrop or Escape; the body is the caller's
 * to fill (`fillDrawer`). It slides in from the right edge (medium4, emphasized decelerate) over
 * a scrim that fades in (medium2), as soon as the caller has put it on the page; one opened from
 * inside another slides over it the same way. Every way of closing it is the one exit: it slides
 * out and the scrim fades (`drawerExitMs`, emphasized accelerate), from wherever its entrance had
 * got to, and it is removed once that is done. Meanwhile it is inert, so the page or the drawer
 * under it takes the clicks and Escape goes to the next drawer down.
 */
function drawer(title: (Node | string)[], body: HTMLElement): HTMLElement {
  const close = el("button", { class: "ghost", type: "button" }, "Close");
  const panel = el("div", { class: "drawer" }, el("div", { class: "drawer-top" }, el("h2", {}, ...title), close), body);
  const backdrop = el("div", { class: "backdrop" }, panel);
  let entering: Animation[] = [];
  // Its entrance, once the caller has appended it (the same task, so no frame shows it still).
  queueMicrotask(() => {
    if (!backdrop.isConnected || backdrop.hasAttribute("data-closing")) return;
    const t = tokens();
    entering = [
      play(panel, [{ transform: "translateX(100%)" }, { transform: "none" }], { duration: t.medium4, easing: t.decelerate }),
      play(backdrop, [{ backgroundColor: "transparent" }, { backgroundColor: getComputedStyle(backdrop).backgroundColor }], { duration: t.medium2, easing: t.decelerate }),
    ].filter((a): a is Animation => a !== null);
  });
  const dismiss = (): void => {
    if (backdrop.hasAttribute("data-closing")) return;
    backdrop.setAttribute("data-closing", "");
    backdrop.inert = true;
    document.removeEventListener("keydown", onKey);
    const t = tokens();
    const ms = drawerExitMs();
    // As drawn now, an entrance in flight included; then that entrance goes.
    const slid = look(panel).transform;
    const scrim = getComputedStyle(backdrop).backgroundColor;
    entering.forEach((a) => a.cancel());
    entering = [];
    const leaving = [
      play(panel, [{ transform: slid }, { transform: "translateX(100%)" }], { duration: ms, easing: t.accelerate, fill: "forwards" }),
      play(backdrop, [{ backgroundColor: scrim }, { backgroundColor: "transparent" }], { duration: ms, easing: t.accelerate, fill: "forwards" }),
    ].filter((a): a is Animation => a !== null);
    if (leaving.length === 0) backdrop.remove();
    else void settled(leaving).then(() => backdrop.remove());
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      // The topmost drawer that is not already leaving takes the key.
      const open = document.querySelectorAll(".backdrop:not([data-closing])");
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

/**
 * A drawer's body takes its content (the loading line's place): the content fades in and the body
 * eases from the height it had to its new one.
 */
function fillDrawer(body: HTMLElement, ...nodes: Node[]): void {
  const from = body.getBoundingClientRect().height;
  body.replaceChildren(...nodes);
  fadeIn(body);
  easeHeight(body, from, body.getBoundingClientRect().height);
}

const SEGMENT_WORDS: Record<Segment, string> = { landing: "Landing", lobby: "Lobby", loading: "Loading", match: "Match", after: "After" };

/**
 * The trail's rows: a heading where a step opens a segment (the lobby's and
 * the match's carrying the ids, linked to the party's other sessions), then
 * the step with its wall clock, the time since the step before it shown,
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
    let text: Node | string = step.text;
    if (step.stack !== "") {
      const fold = el("details", {}, el("summary", {}, step.text), el("pre", { class: "stack" }, step.stack));
      accordion(fold);
      text = fold;
    }
    out.push(
      el(
        "tr",
        { class: `step${step.trace ? " trace" : ""}${step.signaling ? " signal" : ""}` },
        el("td", { class: "when", title: Number.isFinite(step.at) ? fullWhen(step.at) : "" }, Number.isFinite(step.at) ? clock(step.at) : ""),
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
 * every row in order under the segment it falls in, with the viewer's wall
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
        fillDrawer(body, el("div", { class: "empty" }, "No rows for this session."));
        return;
      }
      const trail = trailOf(list);
      const facts: (Node | string)[] = [];
      if (Number.isFinite(trail.startedAt)) facts.push(`${dayOf(trail.startedAt)}, ${zoneName(trail.startedAt)}`);
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
      // The samples in or out: the trail fades to its new rows and the body eases to its new height.
      toggle.addEventListener("change", () => {
        const from = body.getBoundingClientRect().height;
        draw(toggle.checked);
        fadeIn(tbody, tokens().short4);
        easeHeight(body, from, body.getBoundingClientRect().height);
      });
      const traceLine = trail.trace === 0 ? el("span", {}) : el("label", { class: "trace-toggle" }, toggle, ` Show the route's ${trail.trace} samples (pos, edge, fork, place, lamp)`);
      draw(false);
      const table = el(
        "table",
        { class: "trail" },
        el("thead", {}, el("tr", {}, el("th", {}, zoneName()), el("th", { class: "num" }, "Δt"), el("th", {}, "Event"), el("th", {}, "What"))),
        tbody,
      );
      fillDrawer(body, head, machine === "" ? el("span", {}) : el("p", { class: "sub" }, machine), traceLine, el("div", { class: "table-wrap" }, table));
    },
    (error: unknown) => {
      fillDrawer(body, el("div", { class: "empty" }, `Could not read the session: ${error instanceof Error ? error.message : String(error)}`));
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
        fillDrawer(body, el("div", { class: "empty" }, kind === "visitor" ? "No sessions for this visitor." : "No sessions for this match."));
        return;
      }
      const first = lines[0]!;
      const last = lines[lines.length - 1]!;
      const days = new Set(lines.map((l) => dayOf(l.startedAt))).size;
      const cols: Column[] = [
        { key: "startedAt", label: `Began (${zoneName()})`, when: true, render: (v) => el("span", { title: fullWhen(num(v)) }, wallWhen(num(v))) },
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
          ? `${lines.length} session${lines.length === 1 ? "" : "s"} on ${days} day${days === 1 ? "" : "s"} (${zoneName()}), ${wallWhen(first.startedAt)} to ${wallWhen(last.endedAt)}; open one for its trail`
          : `${lines.length} session${lines.length === 1 ? "" : "s"} in the match, ${wallWhen(first.startedAt)} to ${wallWhen(last.endedAt)}; open one for its trail`;
      fillDrawer(body, el("p", { class: "sub" }, sub), table(cols, lines as unknown as Record<string, unknown>[]));
    },
    (error: unknown) => {
      fillDrawer(body, el("div", { class: "empty" }, `Could not read the ${kind}: ${error instanceof Error ? error.message : String(error)}`));
    },
  );
  return backdrop;
}
