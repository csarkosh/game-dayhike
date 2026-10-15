/**
 * The telemetry route: `POST /t`, a batch of events from one page, written
 * out as one log row an event (`log.ts`).
 *
 * The page sends a batch every half minute and on its way out, each a JSON
 * object: an envelope naming the page (its session, the build it runs, the
 * world it is in) and a list of events, each a name, a time and a few fields
 * (`client/src/net/telemetry.ts`). The route does four things and no more:
 * refuses what is not a well-formed batch from an allowed origin within the
 * size and rate limits; drops, unread, a batch from an address on the ignore
 * list (the owner's own); flattens the envelope onto every event so each row
 * stands alone in a query, with no join back to a session row that may never
 * have arrived; and writes the rows, each dated at the event rather than the
 * batch. It holds nothing between requests but the rate limiter, which is
 * why it can run on as many instances as a spike needs while the signaling
 * service stays at its one.
 *
 * Everything that reads the request is a pure function over strings and
 * objects, so the limits are tested without a socket.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { anyIpInRanges, clientIpOf, isAllowedOrigin, type IpRange } from "./admission.js";
import { row, type LogRow, type LogSink, type Severity } from "./log.js";
import { TokenBucket } from "./tokenBucket.js";

/** The one path. Short and plain on purpose: the request is a beacon from a
 * page, and a path naming what it carries invites a content blocker's list to
 * match it, which would make the page's errors the hardest thing to hear
 * about from exactly the browsers that block most. */
export const TELEMETRY_PATH = "/t";

/**
 * The most one batch may weigh. The page flushes at fifty events, and the
 * largest event it makes — an error with its stack — is about a kilobyte, so a
 * real batch is tens of kilobytes at the very most. The cap is there for the
 * same reason `MAX_PAYLOAD_BYTES` is on the socket: the body is buffered and
 * parsed in this process's heap, and the request is unauthenticated.
 */
export const MAX_BATCH_BYTES = 64 * 1024;
/** Events a batch may hold; the page sends at most fifty. */
export const MAX_EVENTS_PER_BATCH = 200;
/** Fields an event or the envelope may carry, beyond which the rest are dropped. */
export const MAX_FIELDS = 40;
/** A string field is cut here. A stack trace is the longest the page sends, at 2,000. */
export const MAX_STRING_LENGTH = 2000;
/** Entries an array field may hold. The page's longest is a path sample. */
export const MAX_ARRAY_LENGTH = 256;
/** The batch format this route reads. */
export const BATCH_VERSION = 1;
/**
 * The furthest back an event may be dated from its batch's arrival. A page
 * holds a batch half a minute, or until it is next shown after a long sleep
 * in the background; a day covers a laptop closed overnight and opened once
 * more. Past it, `st - t` is not an age but a clock the page got wrong.
 */
export const MAX_EVENT_AGE_MS = 86_400_000;

/** The event names the page may send: lowercase words, so a row's name is a
 * safe column value and never a surprise in a query. */
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

export type Primitive = string | number | boolean;
export type FieldValue = Primitive | Primitive[];
export type Fields = Record<string, FieldValue>;

export type TelemetryEvent = { n: string; t: number; fields: Fields };

export type Batch = {
  /** The envelope: every field the page sent beside the events, flattened. */
  envelope: Fields;
  events: TelemetryEvent[];
  /**
   * The page's clock (`t`) as the batch was serialised (`st`), so each
   * event's age at arrival is `sentAt - t` whatever the page's wall clock
   * says. Absent from a page that does not send it.
   */
  sentAt?: number;
};

export type BatchProblem = "not_json" | "not_object" | "bad_version" | "no_session" | "no_events" | "too_many_events";

/** The envelope keys this route insists on, and their shapes. */
function sessionIdOf(envelope: Fields): string | null {
  const sid = envelope.sid;
  return typeof sid === "string" && sid.length > 0 && sid.length <= 64 ? sid : null;
}

function cleanString(value: string): string {
  return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
}

function cleanPrimitive(value: unknown): Primitive | null {
  if (typeof value === "string") return cleanString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}

/**
 * The fields of an object the row format accepts: strings cut to length,
 * finite numbers, booleans, and arrays of those, bounded. Anything nested
 * deeper, and any other type, is dropped rather than refused, so one odd field
 * costs itself and not the batch. `skip` names keys the caller handles itself.
 */
export function cleanFields(source: Record<string, unknown>, skip: readonly string[] = []): Fields {
  const out: Fields = {};
  let count = 0;
  for (const [key, raw] of Object.entries(source)) {
    if (skip.includes(key) || !KEY_RE.test(key)) continue;
    if (count >= MAX_FIELDS) break;
    if (Array.isArray(raw)) {
      const items: Primitive[] = [];
      for (const item of raw) {
        if (items.length >= MAX_ARRAY_LENGTH) break;
        const clean = cleanPrimitive(item);
        if (clean !== null) items.push(clean);
      }
      out[key] = items;
      count += 1;
      continue;
    }
    const clean = cleanPrimitive(raw);
    if (clean === null) continue;
    out[key] = clean;
    count += 1;
  }
  return out;
}

/**
 * A batch from its body, or why it is not one. Strict about the shape that
 * makes a row queryable — the version, a session id, named events with a
 * time — and lenient about everything else (`cleanFields`).
 */
export function parseBatch(raw: string): { ok: true; batch: Batch } | { ok: false; problem: BatchProblem } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: "not_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, problem: "not_object" };
  const body = parsed as Record<string, unknown>;
  if (body.v !== BATCH_VERSION) return { ok: false, problem: "bad_version" };
  if (!Array.isArray(body.events)) return { ok: false, problem: "no_events" };
  if (body.events.length > MAX_EVENTS_PER_BATCH) return { ok: false, problem: "too_many_events" };

  // `st` is the batch's, read for `rowsOf` and kept off the rows like `v`.
  // A page that sends none, or nonsense, dates its events at arrival.
  const envelope = cleanFields(body, ["events", "v", "st"]);
  if (sessionIdOf(envelope) === null) return { ok: false, problem: "no_session" };
  const sentAt = typeof body.st === "number" && Number.isFinite(body.st) && body.st >= 0 ? body.st : undefined;

  const events: TelemetryEvent[] = [];
  for (const entry of body.events) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.n !== "string" || !EVENT_NAME_RE.test(e.n)) continue;
    if (typeof e.t !== "number" || !Number.isFinite(e.t)) continue;
    events.push({ n: e.n, t: e.t, fields: cleanFields(e, ["n", "t"]) });
  }
  return { ok: true, batch: { envelope, events, ...(sentAt === undefined ? {} : { sentAt }) } };
}

/** What the row says of the request itself, beside what the page said. */
export type ReceiptMeta = {
  /** The server's own build, so a row names both halves' versions. */
  serverBuild: string;
  /** When the batch arrived, epoch milliseconds. */
  receivedAt: number;
};

/** An event's severity: its name says. Errors and warnings the page caught
 * surface in the Logs Explorer's severity column without a query. */
export function severityOf(name: string): Severity {
  if (name === "error") return "ERROR";
  if (name === "warn") return "WARNING";
  return "INFO";
}

/**
 * When an event happened, by the server's clock: its batch's arrival less
 * how long the page had held it (`st - t`, both the page's own `t()`, so
 * its wall clock is never trusted). An age that is negative or past
 * `MAX_EVENT_AGE_MS` is a page with no `st` or a broken one, and the event
 * is dated at arrival, as every row was before `st` existed.
 */
export function eventTimeOf(event: TelemetryEvent, batch: Batch, receivedAt: number): number {
  if (batch.sentAt === undefined) return receivedAt;
  const age = batch.sentAt - event.t;
  return age >= 0 && age <= MAX_EVENT_AGE_MS ? receivedAt - age : receivedAt;
}

/**
 * The rows of a batch: the envelope flattened onto every event, so each is
 * its own record of which page, which build and which world it came from. An
 * event's own field of the same name wins over the envelope's, which is
 * what lets a late-arriving `world` ride on the event that learned it. Each
 * row's `timestamp` is the event's time (`eventTimeOf`), which Cloud Logging
 * takes as the entry's; `at` stays the batch's arrival.
 */
export function rowsOf(batch: Batch, meta: ReceiptMeta): LogRow[] {
  return batch.events.map((event) => {
    const fields = { ...batch.envelope, ...event.fields, t: event.t, at: meta.receivedAt, sbuild: meta.serverBuild, svc: "telemetry" };
    // An error's text in the summary column, so a scan of the log reads the
    // failures without opening a row.
    const text = typeof event.fields.msg === "string" ? `${event.n}: ${event.fields.msg}` : event.n;
    return row(severityOf(event.n), event.n, fields, text, new Date(eventTimeOf(event, batch, meta.receivedAt)).toISOString());
  });
}

export type PostLimiterOptions = {
  /** Batches one address may send in a burst. */
  capacity?: number;
  /** Batches a second one address earns back. */
  refillPerSecond?: number;
  /** Hard ceiling on how many addresses are tracked at once. */
  maxTrackedIps?: number;
  /** Idle time after which an address's bucket is dropped by `prune`. */
  idleMs?: number;
  now?: () => number;
};

/**
 * One token bucket an address: a page sends two batches a minute and a few
 * more at its transitions, a household behind one address sends five times
 * that, and anything past the budget is not a page. The table is bounded the
 * way `ConnectionLimiter`'s is and for the same reason — the key is a header
 * the sender controls — and once full, unknown addresses go untracked rather
 * than unserved.
 */
export class PostLimiter {
  private readonly entries = new Map<string, { bucket: TokenBucket; lastSeen: number }>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxTrackedIps: number;
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(options: PostLimiterOptions = {}) {
    this.capacity = options.capacity ?? 60;
    this.refillPerSecond = options.refillPerSecond ?? 1;
    this.maxTrackedIps = options.maxTrackedIps ?? 4096;
    this.idleMs = options.idleMs ?? 120_000;
    this.now = options.now ?? (() => Date.now());
  }

  get tracked(): number {
    return this.entries.size;
  }

  /** Whether `ip` may send one more batch now. */
  allow(ip: string): boolean {
    const now = this.now();
    let entry = this.entries.get(ip);
    if (entry === undefined) {
      if (this.entries.size >= this.maxTrackedIps) return true;
      entry = { bucket: new TokenBucket(this.capacity, this.refillPerSecond, this.now), lastSeen: now };
      this.entries.set(ip, entry);
    }
    entry.lastSeen = now;
    return entry.bucket.tryConsume();
  }

  /** Drops addresses not heard from within `idleMs`, which is what returns the table's memory. */
  prune(): void {
    const now = this.now();
    for (const [ip, entry] of this.entries) {
      if (now - entry.lastSeen >= this.idleMs) this.entries.delete(ip);
    }
  }
}

export type TelemetryRouteOptions = {
  allowedOrigins: readonly string[];
  limiter: PostLimiter;
  log: LogSink;
  serverBuild: string;
  /**
   * Addresses whose batches are taken and thrown away: the owner's own, so
   * their play is no part of the numbers (`TELEMETRY_IGNORE_IPS`). Answered
   * 204 as an accepted batch is, so the page never retries and never knows,
   * and before the limiter, so they are not counted either.
   */
  ignore?: readonly IpRange[];
  now?: () => number;
  maxBatchBytes?: number;
};

/**
 * CORS for a beacon. The page sends the batch as `text/plain`, which is a
 * simple request: the browser sends it without a preflight whatever this
 * server says, so the headers here decide only whether the page may read the
 * answer — which it wants to, to know whether to send the batch again. An
 * origin not on the list is refused outright, the same rule as the socket's
 * (`isAllowedOrigin`): a missing origin is a probe or a test and is let
 * through, a present and unlisted one is somebody else's page.
 */
function corsHeaders(origin: string | undefined): Record<string, string> {
  if (origin === undefined) return {};
  return { "access-control-allow-origin": origin, vary: "origin" };
}

/**
 * Reads the body up to `maxBytes`, resolving null past it: the request is
 * destroyed at the cap, so an oversized body costs the cap and no more.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function answer(res: ServerResponse, status: number, headers: Record<string, string>, body = ""): void {
  res.writeHead(status, { "content-type": "text/plain", "content-length": String(Buffer.byteLength(body)), ...headers });
  res.end(body);
}

/**
 * The route itself. Returns false when the request is not for it, so the
 * server's own dispatch carries on to its 404.
 */
export function telemetryRoute(options: TelemetryRouteOptions): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  const now = options.now ?? (() => Date.now());
  const maxBytes = options.maxBatchBytes ?? MAX_BATCH_BYTES;
  return (req, res, path) => {
    if (path !== TELEMETRY_PATH) return false;
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, options.allowedOrigins)) {
      answer(res, 403, {}, "forbidden");
      return true;
    }
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") {
      // A preflight, should a browser ever send one (a header the page does
      // not set today would make it): answered so the beacon that follows is
      // not refused for a reason the page cannot see.
      answer(res, 204, {
        ...cors,
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      });
      return true;
    }
    if (req.method !== "POST") {
      answer(res, 405, { ...cors, allow: "POST, OPTIONS" }, "method not allowed");
      return true;
    }
    const ip = clientIpOf(req.headers["x-forwarded-for"], req.socket.remoteAddress);
    if (options.ignore !== undefined && anyIpInRanges(req.headers["x-forwarded-for"], req.socket.remoteAddress, options.ignore)) {
      answer(res, 204, cors);
      return true;
    }
    if (!options.limiter.allow(ip)) {
      answer(res, 429, cors, "too many requests");
      return true;
    }
    void readBody(req, maxBytes).then((body) => {
      if (body === null) {
        if (!res.destroyed) answer(res, 413, cors, "too large");
        return;
      }
      const parsed = parseBatch(body);
      if (!parsed.ok) {
        answer(res, 400, cors, parsed.problem);
        return;
      }
      const meta: ReceiptMeta = { serverBuild: options.serverBuild, receivedAt: now() };
      for (const entry of rowsOf(parsed.batch, meta)) options.log(entry);
      answer(res, 204, cors);
    });
    return true;
  };
}
