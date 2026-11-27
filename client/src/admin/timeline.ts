/**
 * A session read as a trail: the rows the session query answers
 * (`tools/telemetry/queries/session.sql`, and the visitor's and the match's,
 * which add a session column), turned into steps the drawer draws, one a row:
 * its wall clock, the segment it opens (landing, lobby, loading,
 * match, after), its payload as a short line of text, and whether it is one
 * of the route's samples (hidden until asked for). Pure over the rows, so the
 * reading is tested without a page; `views.ts` draws it.
 *
 * Everything is labelled in the viewer's own zone, the one the browser is
 * in (Cyrus, 2026-10-22: the page is read wherever its owner is, and a day or
 * a "7:05 PM" means the reader's): every clock and date here, and every day
 * the queries bucket by, since every request names the zone (`tz`,
 * `source.ts`). The labels name it by its short name (`PDT`, `zoneName`).
 */

import { payloadOf, type Payload } from "./payload.js";
import { sessionRuns } from "./profile.js";
import type { Row } from "./source.js";

/** A zone name's shape, the one the admin routes accept (the engine's server `src/adminQueries.ts` `zoneOf`). */
const ZONE_RE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;

/**
 * The browser's zone, an IANA name (`America/Los_Angeles`), or UTC where the
 * browser names none or one the routes would refuse (a legacy `EST5EDT`), so
 * the labels and the queries always agree.
 */
export function browserZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === "string" && zone.length <= 64 && ZONE_RE.test(zone) ? zone : "UTC";
}

let zone = browserZone();

/** The zone every time and day on the page is read in. */
export const viewerZone = (): string => zone;

/** Reads the page in another zone from here on: for the tests, which cannot choose the machine's. */
export function useZone(next: string): void {
  zone = next;
}

/** A formatter in the viewer's zone, made again if the zone changes. */
export function zoned(options: Intl.DateTimeFormatOptions): (ms: number) => string {
  let made: Intl.DateTimeFormat | null = null;
  let madeFor = "";
  return (ms) => {
    if (made === null || madeFor !== zone) {
      made = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone });
      madeFor = zone;
    }
    return made.format(ms);
  };
}

let nameFormat: Intl.DateTimeFormat | null = null;
let nameFor = "";
/** The viewer's zone by its short name at a moment (`PDT`, `PST`, `GMT+9`), which the labels name it by; now when no moment is given. */
export function zoneName(ms: number = Date.now()): string {
  if (nameFormat === null || nameFor !== zone) {
    nameFormat = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    nameFor = zone;
  }
  return nameFormat.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? zone;
}

const isoDate = zoned({ year: "numeric", month: "2-digit", day: "2-digit" });
/** 2026-10-14: the calendar date of a moment in the viewer's zone, as the queries' `DATE` columns read. */
export function calendarDate(ms: number): string {
  const [month, day, year] = isoDate(ms).split("/");
  return `${year}-${month}-${day}`;
}

/** 7:05:51 PM, the wall clock in the viewer's zone. */
export const clock = zoned({ hour: "numeric", minute: "2-digit", second: "2-digit" });
/** Wed, Oct 14, 2026. */
export const dayOf = zoned({ weekday: "short", month: "short", day: "numeric", year: "numeric" });
/** Oct 14, 7:05 PM: the absolute time beside a relative one. */
export const when = zoned({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Oct 14, 2026, 7:05:51 PM PDT, for a title: it names the zone itself. */
export const fullWhen = zoned({ month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

/** 0.0 s, 12.4 s, 3 min 2 s, 1 h 4 min: a length of time, short. */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s - m * 60)} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m - h * 60} min`;
}

/** The Δt column: the time since the step before, `+` and short; empty for the first. */
export function delta(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  if (ms < 0) return `-${duration(-ms)}`;
  return `+${duration(ms)}`;
}

/** The stretches of a session the trail is headed by, in the order a session passes them. */
export type Segment = "landing" | "lobby" | "loading" | "match" | "after";

/**
 * The segment an event opens, or null where it opens none: the first row
 * opens the landing; a lobby begun or joined (or the party route rendered)
 * opens the lobby; Play opens the loading; `match_start` the match; a way out
 * of the match (`match_end`, `exit`, the session ending) the after. An
 * `outcome` is the match's; the `match_end` that follows closes it.
 */
export function opens(current: Segment | null, n: string, kind: string): Segment | null {
  if (current === null) return "landing";
  if (n === "invite" || n === "join" || n === "lobby_joined" || (n === "page" && kind === "party")) return current === "lobby" ? null : "lobby";
  if (n === "play") return "loading";
  if (n === "match_start") return "match";
  if ((n === "match_end" || n === "exit" || n === "session_end" || n === "host_session_end") && current !== "after") return "after";
  return null;
}

/** The route's samples and transitions: drawn by the paths card, folded in the trail until asked for. */
const TRACE = new Set(["pos", "edge", "fork", "place", "offtrail", "ontrail", "lamp", "cut"]);
export const isTrace = (n: string): boolean => TRACE.has(n);

/** The envelope's keys, which every row carries and the default text leaves out. */
const ENVELOPE = new Set([
  "at", "dh", "message", "sbuild", "svc", "sid", "vid", "build", "lite", "proto", "gen", "desktop", "shell", "os", "browser", "touch", "gpu", "adapter", "cores", "mem", "mobile", "t", "severity",
  "world", "seed", "game", "lobby", "n", "ref", "path", "lang", "tz", "vw", "vh", "ua", "wd", "tester", "timestamp", "room", "stack",
]);

export { payloadOf, type Payload };

/** Why the load check turned a visitor away (`game/loadCheck.ts`, `TurnedAwayReason`), in words. */
const TURNED_AWAY: Readonly<Record<string, string>> = {
  "no-webgpu": "the browser has no WebGPU",
  "no-adapter": "the browser gave no adapter",
  software: "a software adapter",
  short: "the adapter is short of what the game needs",
};

const has = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
const str = (v: unknown): string => (has(v) ? String(v) : "");
const num = (v: unknown): number | null => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null);
/** 92% up: the party's climb, 0 at the trailhead and 1 at the crest. */
const climb = (p: unknown): string => {
  const v = num(p);
  return v === null ? "" : `${Math.round(v * 100)}% up`;
};
const ms = (v: unknown): string => {
  const n = num(v);
  return n === null ? "" : `${Math.round(n)} ms`;
};
const join = (...parts: string[]): string => parts.filter((p) => p !== "").join(", ");
const yes = (v: unknown): boolean => v === true || v === "true";

/**
 * What a hike's renderer and the hike said was happening when a row about
 * the GPU was made (`game/gpuFaults.ts`): the tier and which of the hike's
 * renderers, whether it stood and for how long, then only what was out of
 * the ordinary: the world not yet in, a switch or a rebuild under way, the
 * intro's film over the hike, the page hidden or just shown again, a scene
 * or an ending with the frame, rain, the night, water in view.
 */
function happening(p: Payload): string {
  const stood = num(p.stoodMs);
  const shown = num(p.shownMs);
  const frames = num(p.frames);
  const state = str(p.state);
  return join(
    [str(p.tier), has(p.r) ? `renderer ${str(p.r)}` : ""].filter((s) => s !== "").join(" "),
    state === "standing" ? (stood === null ? "" : `stood ${duration(stood)}`) : state === "" ? "" : `the renderer ${state}`,
    frames === null ? "" : `${frames} frames`,
    has(p.ready) && !yes(p.ready) ? "the world still loading" : "",
    has(p.busy) ? `a ${str(p.busy)} under way` : "",
    yes(p.film) ? "under the intro's film" : "",
    yes(p.hidden) ? "the page hidden" : shown !== null && shown < 10_000 ? `the page shown ${duration(shown)} before` : "",
    yes(p.scene) ? "a scene playing" : "",
    yes(p.ending) ? "an ending playing" : "",
    (num(p.rain) ?? 0) > 0.05 ? "rain" : "",
    (num(p.night) ?? 0) > 0.5 ? "night" : "",
    (num(p.lakes) ?? 0) > 0 ? "a lake in view" : "",
    yes(p.sea) ? "the sea in view" : "",
    climb(p.p),
  );
}

/**
 * One line of text for an event's payload, by its name: the few fields a
 * reader wants of each, in words; a name this does not know lists what it
 * carried beyond the envelope.
 */
export function describe(n: string, p: Payload): string {
  switch (n) {
    case "page":
      return str(p.kind);
    case "play":
      return has(p.party) ? `party of ${str(p.party)}` : "";
    case "invite":
    case "join":
    case "invite_copied":
    case "reconnect":
      return "";
    case "lobby_joined":
      return join(str(p.kind), has(p.role) ? `as ${str(p.role)}` : "", has(p.members) ? `${str(p.members)} in` : "", ms(p.ms));
    case "lobby_change":
      return join(has(p.members) ? `${str(p.members)} members` : "", num(p.joined) ? `${str(p.joined)} joined` : "", num(p.left) ? `${str(p.left)} left` : "");
    case "lobby_end":
      return join(str(p.reason), has(p.members) ? `${str(p.members)} were in` : "");
    case "lobby_error":
      return join(`${str(p.kind)}: ${str(p.code)}`, ms(p.ms));
    case "load":
      return join(
        [str(p.tier), has(p.engine) ? `on ${str(p.engine)}` : "", has(p.source) ? `(${str(p.source)})` : ""].filter((s) => s !== "").join(" "),
        has(p.decideMs) ? `decide ${ms(p.decideMs)}` : "",
        has(p.introMs) ? `intro ${ms(p.introMs)}` : "",
        has(p.engineMs) ? `engine ${ms(p.engineMs)}` : "",
        has(p.buildMs) ? `build ${ms(p.buildMs)}` : "",
      );
    case "start_fail":
      return join(str(p.msg), has(p.decideMs) ? `decide ${ms(p.decideMs)}` : "", has(p.engineMs) ? `engine ${ms(p.engineMs)}` : "", has(p.buildMs) ? `build ${ms(p.buildMs)}` : "");
    case "ready":
      return has(p.ms) ? `${ms(p.ms)} from launch` : "";
    case "intro":
      return str(p.reason);
    case "match_start":
      return join(str(p.role), has(p.party) ? `party of ${str(p.party)}` : "");
    case "act":
      return join(str(p.act), climb(p.p));
    case "phase":
      return join(str(p.phase), climb(p.p));
    case "hb":
      return join(has(p.fps) ? `${str(p.fps)} fps` : "", num(p.rtt) ? `rtt ${ms(p.rtt)}` : "", has(p.worst) ? `worst frame ${ms(p.worst)}` : "", num(p.stalls) ? `${str(p.stalls)} stalls` : "", climb(p.p));
    case "death":
      return join(str(p.cause), climb(p.p), has(p.phase) ? `in the ${str(p.phase)}` : "");
    case "outcome":
      return join(str(p.result), str(p.self), has(p.alive) && has(p.players) ? `${str(p.alive)} alive of ${str(p.players)}` : "");
    case "match_end":
      return join(climb(p.p), p.ended === true || p.ended === "true" ? "ended" : "", p.dead === true || p.dead === "true" ? "dead" : "");
    case "end": {
      const dur = num(p.dur);
      return join(str(p.reason), dur === null ? "" : `after ${duration(dur)}`, has(p.trouble) ? `trouble ${str(p.trouble)}` : "", num(p.failed) ? `${str(p.failed)} batches failed` : "", num(p.dropped) ? `${str(p.dropped)} dropped` : "");
    }
    case "tier_change":
      return join(`${str(p.from)} to ${str(p.to)}`, has(p.source) ? `(${str(p.source)})` : "", p.fellBack === true || p.fellBack === "true" ? "fell back" : "");
    case "tier_fallback":
      return join(has(p.attempted) ? `attempted ${str(p.attempted)}` : "", has(p.built) ? `built ${str(p.built)}` : "", has(p.source) ? `(${str(p.source)})` : "");
    case "engine_failed":
    case "webgpu_start_failed":
      return str(p.reason);
    case "turned_away":
      return join(TURNED_AWAY[str(p.reason)] ?? str(p.reason), has(p.short) ? `short of ${str(p.short)}` : "", has(p.adapter) ? `adapter ${str(p.adapter)}` : "");
    case "gpu_error":
      return join([str(p.kind), p.src === "scope" ? "(caught by a scope)" : ""].filter((s) => s !== "").join(" "), str(p.msg).trim(), has(p.labels) ? `names ${str(p.labels)}` : "", happening(p));
    case "gpu_window": {
      const length = num(p.ms);
      const luma = num(p.luma);
      const black = num(p.black);
      return join(
        `picture ${str(p.picture) || "unknown"}`,
        has(p.unread) ? `not read: ${str(p.unread)}` : "",
        luma === null ? "" : `luminance ${luma} of 255`,
        black === null ? "" : `${Math.round(black * 100)}% black`,
        has(p.spread) ? `spread ${str(p.spread)}` : "",
        has(p.frames) ? `${str(p.frames)} frames drawn${length === null ? "" : ` in ${duration(length)}`}` : "",
        has(p.errors) ? `${str(p.errors)} errors, ${str(p.distinct)} distinct` : "",
        has(p.total) && str(p.total) !== str(p.errors) ? `${str(p.total)} this hike` : "",
        yes(p.scene) ? "a scene playing" : "",
        yes(p.ending) ? "an ending playing" : "",
        yes(p.hidden) ? "the page hidden" : "",
        has(p.state) && str(p.state) !== "standing" ? `the renderer ${str(p.state)}` : "",
      );
    }
    case "device_lost": {
      const since = num(p.sinceMs);
      return join(
        [str(p.reason) || "no reason given", str(p.msg).trim()].filter((s) => s !== "").join(": "),
        has(p.losses) ? `loss ${str(p.losses)} of this page, ${str(p.recent)} within the bound` : "",
        since === null ? "" : `${duration(since)} after the last`,
        p.verdict === "end" ? "the hike ends" : has(p.verdict) ? "rebuilt" : "",
        happening(p),
        has(p.bufs) ? `held ${str(p.bufs)} buffers (${str(p.bufMB)} MB) and ${str(p.texs)} textures (${str(p.texMB)} MB)` : "",
        has(p.heapMB) ? `heap ${str(p.heapMB)} MB` : "",
        (num(p.errors) ?? 0) > 0 ? `${str(p.errors)} GPU errors before it` : "",
      );
    }
    case "engine_rebuilt": {
      const took = num(p.ms);
      const stood = p.ok === false || p.ok === "false" ? `did not stand${has(p.state) ? ` (${str(p.state)})` : ""}` : p.state === "making" ? "still being made as the cover lifted" : "stood again";
      return join(
        [stood, has(p.reason) ? `after ${str(p.reason)}` : ""].filter((s) => s !== "").join(" "),
        [str(p.tier), has(p.engine) ? `on ${str(p.engine)}` : "", has(p.r) ? `renderer ${str(p.r)}` : ""].filter((s) => s !== "").join(" "),
        has(p.frames) ? `${str(p.frames)} frames under the cover` : "",
        took === null ? "" : `in ${duration(took)}`,
        str(p.why),
      );
    }
    case "governor_drop":
      return has(p.running) ? `running ${str(p.running)}` : "";
    case "error":
    case "warn":
      return join([str(p.kind), has(p.where) ? `at ${str(p.where)}` : ""].filter((s) => s !== "").join(" "), str(p.msg));
    case "session_end":
      return join(str(p.msg), p.why === "device_lost" ? `ended by lost devices: ${str(p.losses)} this page, ${str(p.recent)} within the bound` : str(p.why), climb(p.p));
    case "connect_fail":
      return str(p.msg);
    case "host_session_end":
      return str(p.kind);
    case "settings":
      return str(p.choice);
    case "download":
      return str(p.platform);
    case "visibility":
      return str(p.state);
    case "cmd":
      return str(p.names);
    case "pause":
    case "resume":
    case "offtrail":
    case "ontrail":
    case "hollow_seen":
    case "poster":
      return climb(p.p);
    case "pos":
      return join(climb(p.p), has(p.hp) ? `hp ${str(p.hp)}` : "");
    case "edge":
      return join(has(p.edge) ? `edge ${str(p.edge)}` : "", str(p.kind), climb(p.p));
    case "fork":
      return join(has(p.node) ? `node ${str(p.node)}` : "", climb(p.p));
    case "place":
      return join([str(p.kind), str(p.name)].filter((s) => s !== "").join(" "), p.in === true || p.in === "true" ? "entered" : "left");
    case "lamp":
      return p.on === true || p.on === "true" ? "on" : "off";
    case "cut":
      return join(has(p.node) ? `node ${str(p.node)}` : "", has(p.open) ? `open ${str(p.open)}` : "");
    case "room_create":
      return has(p.peers) ? `${str(p.peers)} peer` : "";
    case "room_join":
      return has(p.peers) ? `${str(p.peers)} peers` : "";
    case "room_leave":
      return join(p.host === true || p.host === "true" ? "the host" : "a peer", has(p.peers) ? `${str(p.peers)} left in` : "");
    case "room_end": {
      const life = num(p.lifeMs);
      return join(str(p.reason), life === null ? "" : `lived ${duration(life)}`);
    }
    case "room_refused":
      return `${str(p.verb)}: ${str(p.code)}`;
    default:
      return Object.entries(p)
        .filter(([k, v]) => !ENVELOPE.has(k) && has(v) && typeof v !== "object")
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(", ");
  }
}

/**
 * The mark beside an event: the page's status classes. Of what the GPU did
 * under a hike: a lost device, a rebuild that did not stand and a hike
 * ended by its lost devices are errors; a window of GPU errors is an error
 * where the picture broke and a warning where it held or could not be
 * judged; a GPU error by itself is a warning, which `trailOf` makes an
 * error where the window it fell in says the picture broke. A visitor the
 * load check turned away is a warning: nothing failed, and a visitor could
 * not play.
 */
export function toneOf(n: string, p: Payload): "" | "error" | "warn" | "won" | "lost" {
  if (n === "error" || n === "start_fail" || n === "connect_fail" || n === "engine_failed" || n === "webgpu_start_failed" || n === "lobby_error" || n === "device_lost") return "error";
  if (n === "warn" || n === "tier_fallback" || n === "governor_drop" || n === "room_refused" || n === "gpu_error" || n === "turned_away") return "warn";
  if (n === "gpu_window") return p.picture === "broke" ? "error" : "warn";
  if (n === "engine_rebuilt") return p.ok === false || p.ok === "false" ? "error" : "";
  if (n === "session_end") return p.why === "device_lost" ? "error" : "";
  if (n === "outcome") return p.result === "won" ? "won" : p.result === "lost" ? "lost" : "";
  if (n === "death") return "lost";
  if (n === "end") return (num(p.trouble) ?? 0) > 0 ? "warn" : "";
  return "";
}

export type Step = {
  row: Row;
  /** The event's time, epoch ms, from the row's `timestamp`. */
  at: number;
  n: string;
  signaling: boolean;
  /** The segment this step opens, where it does; a heading in the trail. */
  opens: Segment | null;
  text: string;
  tone: "" | "error" | "warn" | "won" | "lost";
  trace: boolean;
  stack: string;
};

export type Trail = {
  steps: Step[];
  /** The session's rows (the signaling rows aside), the first of them the envelope's. */
  first: Payload | null;
  sid: string;
  vid: string;
  build: string;
  /** The match and the lobby the session named, if any. */
  game: string;
  lobby: string;
  startedAt: number;
  endedAt: number;
  trace: number;
};

/** The rows of one session as the trail the drawer draws. */
export function trailOf(rows: Row[]): Trail {
  const steps: Step[] = [];
  let current: Segment | null = null;
  let first: Payload | null = null;
  let game = "";
  let lobby = "";
  let vid = "";
  let sid = "";
  let build = "";
  let startedAt = Infinity;
  let endedAt = -Infinity;
  let trace = 0;
  /** The windows that found the picture broken, each by its match and its number in the hike, and each GPU error's step by the window it fell in. */
  const broke = new Set<string>();
  const gpuErrors: { step: Step; window: string }[] = [];
  for (const row of rows) {
    const n = str(row.n);
    const p = payloadOf(row);
    const signaling = row.svc === "signaling";
    const at = Date.parse(str(row.timestamp));
    let open: Segment | null = null;
    if (!signaling) {
      if (first === null) first = p;
      sid ||= str(row.sid) || str(p.sid);
      vid ||= str(row.vid) || str(p.vid);
      build ||= str(row.build) || str(p.build);
      game ||= str(row.game) || str(p.game);
      lobby ||= str(row.lobby) || str(p.lobby);
      if (Number.isFinite(at)) {
        startedAt = Math.min(startedAt, at);
        endedAt = Math.max(endedAt, at);
      }
      open = opens(current, n, str(row.kind) || str(p.kind));
      if (open !== null) current = open;
    }
    const isTraceRow = !signaling && isTrace(n);
    if (isTraceRow) trace += 1;
    const step: Step = { row, at, n, signaling, opens: open, text: describe(n, p), tone: toneOf(n, p), trace: isTraceRow, stack: str(row.stack) || str(p.stack) };
    steps.push(step);
    if (n === "gpu_window" && p.picture === "broke") broke.add(`${str(p.game)}/${str(p.w)}`);
    if (n === "gpu_error" && has(p.w)) gpuErrors.push({ step, window: `${str(p.game)}/${str(p.w)}` });
  }
  // A GPU error reads by how its picture came out: an error where the window it fell in (`w`) says it broke.
  for (const { step, window } of gpuErrors) if (broke.has(window)) step.tone = "error";
  return { steps, first, sid, vid, build, game, lobby, startedAt: Number.isFinite(startedAt) ? startedAt : NaN, endedAt: Number.isFinite(endedAt) ? endedAt : NaN, trace };
}

/** The envelope's facts a reader wants over a trail: the machine, the page, the viewport, the zone. */
export function envelopeLine(p: Payload | null): string {
  if (p === null) return "";
  const parts: string[] = [];
  const machine = [str(p.os), str(p.browser)].filter((s) => s !== "").join(" ");
  if (machine !== "") parts.push(machine);
  if (has(p.gpu)) parts.push(str(p.gpu).slice(0, 60));
  if (has(p.vw) && has(p.vh)) parts.push(`${str(p.vw)}×${str(p.vh)}`);
  if (has(p.lang)) parts.push(str(p.lang));
  if (has(p.tz)) parts.push(str(p.tz));
  if (has(p.path)) parts.push(str(p.path));
  if (has(p.ref)) parts.push(`from ${str(p.ref)}`);
  if (p.tester === true || p.tester === "true") parts.push("tester");
  if (p.wd === true || p.wd === "true") parts.push("webdriver");
  return parts.join(" · ");
}

/** One session among a visitor's or a match's: what the list of sessions shows of it before it is opened. */
export type SessionLine = {
  sid: string;
  vid: string;
  build: string;
  startedAt: number;
  endedAt: number;
  rows: number;
  role: string;
  game: string;
  lobby: string;
  /** How it ended: the outcome, else the end's reason, else nothing was heard. */
  end: string;
  tone: "" | "won" | "lost" | "warn";
  errors: number;
  /** The tier in words, "High then Medium" when it changed; "" with none. */
  tier: string;
  /** The median frame rate of its heartbeats; null with none. */
  fps: number | null;
  warnings: number;
};

/** The sessions among the rows of a visitor or a match, each summarised, in the order they began. */
export function sessionsOf(rows: Row[]): SessionLine[] {
  const by = new Map<string, SessionLine>();
  for (const row of rows) {
    if (row.svc === "signaling") continue;
    const sid = str(row.sid);
    if (sid === "") continue;
    const p = payloadOf(row);
    const at = Date.parse(str(row.timestamp));
    let line = by.get(sid);
    if (line === undefined) {
      line = { sid, vid: "", build: "", startedAt: Infinity, endedAt: -Infinity, rows: 0, role: "", game: "", lobby: "", end: "", tone: "", errors: 0, tier: "", fps: null, warnings: 0 };
      by.set(sid, line);
    }
    line.rows += 1;
    line.vid ||= str(row.vid) || str(p.vid);
    line.build ||= str(row.build) || str(p.build);
    line.game ||= str(row.game) || str(p.game);
    line.lobby ||= str(row.lobby) || str(p.lobby);
    if (Number.isFinite(at)) {
      line.startedAt = Math.min(line.startedAt, at);
      line.endedAt = Math.max(line.endedAt, at);
    }
    const n = str(row.n);
    if (n === "match_start") line.role = str(p.role) || line.role;
    if (n === "error" || n === "start_fail" || n === "connect_fail" || n === "device_lost" || (n === "gpu_window" && p.picture === "broke")) line.errors += 1;
    if (n === "warn") line.warnings += 1;
    if (n === "outcome") {
      line.end = str(p.result);
      line.tone = p.result === "won" ? "won" : "lost";
    } else if (n === "end" && line.end === "") {
      line.end = `left (${str(p.reason) || "end"})`;
    }
  }
  const lines = [...by.values()];
  const runs = sessionRuns(rows);
  for (const line of lines) {
    const run = runs.get(line.sid);
    if (run !== undefined) Object.assign(line, run);
    if (line.end === "") {
      line.end = "no goodbye";
      line.tone = "warn";
    }
  }
  return lines.sort((a, b) => a.startedAt - b.startedAt);
}
