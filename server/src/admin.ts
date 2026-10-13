/**
 * The admin routes, on the telemetry service: what the admin page
 * (`client/src/admin/`, served from the shared admin host) reads, and what
 * that host's index reads of this app, behind the allowlist (`adminAuth.ts`).
 *
 *   GET /admin/live                  the open rooms and the instances up
 *   GET /admin/query/<name>?days=N   one of the saved queries, over N days
 *   GET /admin/session/<sid>         one session's timeline
 *   GET /admin/kpis                  the index card: four numbers with their
 *                                    trends, and a health reading (`adminKpis.ts`)
 *
 * Each answers JSON, or 401 to an account that is not on the list, 404 to a query
 * that does not exist, and 429 past the per-address budget. The origins the
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
import { isQueryName, type QueryName } from "./adminQueries.js";
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
  query(name: QueryName, days: number): Promise<Row[]>;
  session(sid: string): Promise<Row[]>;
  /** The index card's numbers: the `kpis` query shaped, and the open lobbies from the live view. */
  kpis(): Promise<Kpis>;
}

export type AdminRouteOptions = {
  auth: AdminAuth;
  data: AdminData;
  allowedOrigins: readonly string[];
  limiter: PostLimiter;
  now?: () => number;
};

const DAYS = new Set([1, 7, 30, 90]);
const SID_RE = /^[A-Za-z0-9-]{1,64}$/;

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
      try {
        const body = await handle(options.data, path, search);
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

async function handle(data: AdminData, path: string, search: URLSearchParams): Promise<Json | null> {
  if (path === "/admin/live") return data.live();
  if (path === "/admin/kpis") return data.kpis();
  const query = /^\/admin\/query\/([a-z]+)$/.exec(path);
  if (query !== null) {
    const name = query[1] ?? "";
    if (!isQueryName(name)) return null;
    const days = Number(search.get("days") ?? "7");
    return { rows: await data.query(name, DAYS.has(days) ? days : 7) };
  }
  const session = /^\/admin\/session\/([^/]+)$/.exec(path);
  if (session !== null) {
    const sid = decodeURIComponent(session[1] ?? "");
    if (!SID_RE.test(sid)) return null;
    return { rows: await data.session(sid) };
  }
  return null;
}
