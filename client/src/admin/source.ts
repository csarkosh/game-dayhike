/**
 * Where the admin page's numbers come from: the telemetry queries
 * (`tools/telemetry/queries/`) run over the dataset, and the open rooms. Two
 * sources: the server's admin routes, with the signed-in account's token on
 * every request; and the sample, a fixed data set in the page's own shape
 * (`sample.ts`), for the preview and for working on the page offline.
 */

/** A date range the queries are scoped to, in days back from now; 0 is today. */
export type Range = 1 | 7 | 30 | 90;

export type Row = Record<string, string | number | boolean | null>;

export type QueryName = "funnel" | "lobbies" | "progress" | "errors" | "health" | "paths";

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
}

/** The admin routes on the telemetry service, with the account's token. */
export function remoteSource(base: string, token: () => Promise<string>): Source {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${await token()}` } });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    kind: "live",
    query: (name, range) => get<{ rows: Row[] }>(`/admin/query/${name}?days=${range}`).then((r) => r.rows),
    live: () => get<Live>("/admin/live"),
    session: (sid) => get<{ rows: Row[] }>(`/admin/session/${encodeURIComponent(sid)}`).then((r) => r.rows),
  };
}
