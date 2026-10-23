/**
 * The admin routes, on the telemetry service: what the admin page
 * (`client/src/admin/`, served from the shared admin host) reads, and what
 * that host's index reads of this app, behind the allowlist (`adminAuth.ts`).
 *
 *   GET /admin/live                  the open rooms and the instances up
 *   GET /admin/query/<name>?days=N   one of the saved queries, over the last N
 *                                    calendar days in the caller's zone (1 is
 *                                    today)
 *   GET /admin/session/<sid>         one session's timeline
 *   GET /admin/visitor/<vid>         every session of one browser, in order
 *   GET /admin/match/<game>          every session of one match, side by side
 *   GET /admin/kpis                  the index card: four numbers with their
 *                                    trends, and a health reading (`adminKpis.ts`)
 *
 * Every route takes `tz`, the caller's IANA zone (`?tz=America/Los_Angeles`):
 * every calendar day, week and "today" a route reads is that zone's. Absent,
 * it is New York's, the zone the saved queries are written in, so an older
 * caller and a pasted query agree.
 *
 * Each answers JSON, or 401 to an account that is not on the list, 400 to a
 * `tz` that is not a zone, 404 to a query that does not exist (or an id that
 * is not the shape of one), and 429 past the per-address budget. The origins the
 * page may call from are the server's one list (`admission.ts`
 * `DEFAULT_ALLOWED_ORIGINS`, or `ALLOWED_ORIGINS`), the same one the socket
 * and the batch route check, so the admin host is listed once. The data behind
 * the routes is an interface (`AdminData`), so the routes are tested with a
 * fake and the BigQuery and Firestore readers are thin.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIpOf, isAllowedOrigin } from "./admission.js";
import type { AdminAuth } from "./adminAuth.js";
import type { Kpis } from "./adminKpis.js";
import { isQueryName, zoneOf, type LookupName, type QueryName } from "./adminQueries.js";
import type { PostLimiter } from "./telemetry.js";

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Row = Record<string, Json>;

export type LiveView = {
  at: number;
  instances: { id: string; seenAt: number }[];
  rooms: { id: string; hostId: string; createdAt: number; hostDroppedAt: number | null; peers: number }[];
};

export interface AdminData {
  live(): Promise<LiveView>;
  /** A saved query over the last `days` calendar days of `zone` (an IANA name). */
  query(name: QueryName, days: number, zone: string): Promise<Row[]>;
  /** One session's rows and its lobby's, one visitor's every session, or one match's every session (`session.sql`, `visitor.sql`, `match.sql`). */
  lookup(name: LookupName, id: string): Promise<Row[]>;
  /** The index card's numbers, its weeks and windows by `zone`'s calendar: the `kpis` query shaped, and the open lobbies from the live view. */
  kpis(zone: string): Promise<Kpis>;
}

export type AdminRouteOptions = {
  auth: AdminAuth;
  data: AdminData;
  allowedOrigins: readonly string[];
  limiter: PostLimiter;
  now?: () => number;
};

const DAYS = new Set([1, 7, 30, 90]);
/** A session, visitor or game id: what the page makes (a UUID, or `boot-` and one), and nothing that is not. */
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** The lookups' routes, each by the name of its saved query. */
const LOOKUPS: Record<string, LookupName> = { session: "session", visitor: "visitor", match: "match" };

function answer(res: ServerResponse, status: number, headers: Record<string, string>, body: string, type = "text/plain"): void {
  res.writeHead(status, { "content-type": type, "content-length": String(Buffer.byteLength(body)), "cache-control": "no-store", ...headers });
  res.end(body);
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  if (origin === undefined) return {};
  return { "access-control-allow-origin": origin, vary: "origin" };
}

/** The route, or false when the request is not for it. */
export function adminRoute(options: AdminRouteOptions): (req: IncomingMessage, res: ServerResponse, path: string, search: URLSearchParams) => boolean {
  return (req, res, path, search) => {
    if (!path.startsWith("/admin/")) return false;
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, options.allowedOrigins)) {
      answer(res, 403, {}, "forbidden");
      return true;
    }
    const cors = corsHeaders(origin);
    if (req.method === "OPTIONS") {
      // The bearer token makes the request one the browser asks about first.
      answer(res, 204, { ...cors, "access-control-allow-methods": "GET", "access-control-allow-headers": "authorization", "access-control-max-age": "86400" }, "");
      return true;
    }
    if (req.method !== "GET") {
      answer(res, 405, { ...cors, allow: "GET, OPTIONS" }, "method not allowed");
      return true;
    }
    if (!options.limiter.allow(clientIpOf(req.headers["x-forwarded-for"], req.socket.remoteAddress))) {
      answer(res, 429, cors, "too many requests");
      return true;
    }
    void (async () => {
      const who = await options.auth.verify(req.headers.authorization);
      if (who === null) {
        answer(res, 401, cors, "sign in with an account on the list");
        return;
      }
      const zone = zoneOf(search.get("tz"));
      if (zone === null) {
        answer(res, 400, cors, "tz is not a time zone");
        return;
      }
      try {
        const body = await handle(options.data, path, search, zone);
        if (body === null) answer(res, 404, cors, "not found");
        else answer(res, 200, cors, JSON.stringify(body), "application/json");
      } catch (error) {
        // The cause goes to the log, where it can be read later; the page
        // gets the message.
        console.error(`admin: ${path} failed`, error);
        answer(res, 500, cors, error instanceof Error ? error.message : String(error));
      }
    })();
    return true;
  };
}

async function handle(data: AdminData, path: string, search: URLSearchParams, zone: string): Promise<Json | null> {
  if (path === "/admin/live") return data.live();
  if (path === "/admin/kpis") return data.kpis(zone);
  const query = /^\/admin\/query\/([a-z]+)$/.exec(path);
  if (query !== null) {
    const name = query[1] ?? "";
    if (!isQueryName(name)) return null;
    const days = Number(search.get("days") ?? "7");
    return { rows: await data.query(name, DAYS.has(days) ? days : 7, zone) };
  }
  const lookup = /^\/admin\/(session|visitor|match)\/([^/]+)$/.exec(path);
  if (lookup !== null) {
    const name = LOOKUPS[lookup[1] ?? ""];
    const id = decodeURIComponent(lookup[2] ?? "");
    if (name === undefined || !ID_RE.test(id)) return null;
    return { rows: await data.lookup(name, id) };
  }
  return null;
}
