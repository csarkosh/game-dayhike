/**
 * Where the admin page's numbers come from: the telemetry queries
 * (`tools/telemetry/queries/`) run over the dataset, and the open rooms. Two
 * sources: the server's admin routes, with the account's ID token on every
 * request (the shell's `fetchWithAuth`, `auth.ts`) and the viewer's zone (`tz`), so every
 * day a query reads is the viewer's; and the sample, a fixed data set
 * in the page's own shape (`sample.ts`), for the preview and for working on
 * the page offline.
 */

import { fetchWithAuth } from "./auth.js";
import { viewerZone } from "./timeline.js";

/** A date range the queries are scoped to, in calendar days of the viewer's zone back from today; 1 is today. */
export type Range = 1 | 7 | 30 | 90;

export type Row = Record<string, string | number | boolean | null>;

export type QueryName = "funnel" | "lobbies" | "progress" | "errors" | "health" | "paths" | "kpis" | "visitors";

/** What the signaling registry holds right now (`server/src/sharedRegistry.ts`). */
export type Live = {
  at: number;
  instances: { id: string; seenAt: number }[];
  rooms: { id: string; hostId: string; createdAt: number; hostDroppedAt: number | null; peers: number }[];
};

export interface Source {
  readonly kind: "sample" | "live";
  query(name: QueryName, range: Range): Promise<Row[]>;
  live(): Promise<Live>;
  /** One session's timeline: every row it sent, and its lobby's, in order. */
  session(sid: string): Promise<Row[]>;
  /** One visitor (a browser): every row of every session it had, in order. */
  visitor(vid: string): Promise<Row[]>;
  /** One match (a game): every row of every session that was in it, in order. */
  match(game: string): Promise<Row[]>;
}

/** A route's address with the zone its days are read in (`tz`), the viewer's at the moment of asking. */
export function zonedPath(path: string, zone: string = viewerZone()): string {
  return `${path}${path.includes("?") ? "&" : "?"}tz=${encodeURIComponent(zone)}`;
}

/** The admin routes on the telemetry service, with the signed-in account's ID token and the viewer's zone on every request. */
export function remoteSource(base: string): Source {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetchWithAuth(`${base}${zonedPath(path)}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  const rows = (path: string): Promise<Row[]> => get<{ rows: Row[] }>(path).then((r) => r.rows);
  return {
    kind: "live",
    query: (name, range) => rows(`/admin/query/${name}?days=${range}`),
    live: () => get<Live>("/admin/live"),
    session: (sid) => rows(`/admin/session/${encodeURIComponent(sid)}`),
    visitor: (vid) => rows(`/admin/visitor/${encodeURIComponent(vid)}`),
    match: (game) => rows(`/admin/match/${encodeURIComponent(game)}`),
  };
}
