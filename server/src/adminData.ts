/**
 * The admin routes' data on Google Cloud (`admin.ts` `AdminData`): the saved
 * queries run as BigQuery jobs against the linked dataset, and the open rooms
 * read from the store the signaling instances share. The service account
 * holds `bigquery.jobUser`, `logging.viewAccessor` and `datastore.viewer`
 * for exactly these (`_infra/modules/gcp-telemetry`).
 *
 * BigQuery's first TiB of queries a month is free; a query here scans the
 * range it is given, kilobytes to megabytes.
 */

import { BigQuery } from "@google-cloud/bigquery";
import type { AdminData, Json, LiveView, Row } from "./admin.js";
import { KPI_WEEKS, shapeKpis } from "./adminKpis.js";
import { forBigQuery, readQuery, type QueryName } from "./adminQueries.js";
import type { Store } from "./store.js";

export type AdminDataOptions = {
  projectId: string;
  /** The linked dataset the telemetry bucket is read through. */
  dataset: string;
  /** The store the rooms live in; null answers the live view with nothing. */
  store: Store | null;
  queriesDir?: string;
  now?: () => number;
};

/** BigQuery's typed values as plain JSON: its timestamps, dates and wrapped integers as strings and numbers. */
export function plain(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const v = value as { value?: unknown; toJSON?: () => unknown };
    if ("value" in v && typeof v.value !== "object") return plain(v.value);
    if (typeof v.toJSON === "function") return plain(v.toJSON());
    const out: Record<string, Json> = {};
    for (const [k, inner] of Object.entries(value as Record<string, unknown>)) out[k] = plain(inner);
    return out;
  }
  return String(value);
}

export function createAdminData(options: AdminDataOptions): AdminData {
  const bq = new BigQuery({ projectId: options.projectId });
  const now = options.now ?? (() => Date.now());
  const run = async (name: QueryName | "session", values: Record<string, number | string>): Promise<Row[]> => {
    const prepared = forBigQuery(readQuery(name, options.queriesDir), options.projectId, options.dataset);
    const params: Record<string, number | string> = {};
    for (const p of prepared.params) params[p] = values[p] ?? "";
    const [rows] = await bq.query({ query: prepared.sql, params, useLegacySql: false });
    return (rows as Record<string, unknown>[]).map((row) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(row)) out[k] = plain(v);
      return out;
    });
  };
  const live = async (): Promise<LiveView> => {
    const at = now();
    if (options.store === null) return { at, instances: [], rooms: [] };
    const [rooms, instances] = await Promise.all([options.store.listRooms(), options.store.listInstances()]);
    return {
      at,
      instances,
      rooms: rooms.map(({ id, doc }) => ({ id, hostId: doc.hostId, createdAt: doc.createdAt, hostDroppedAt: doc.hostDroppedAt, peers: Object.keys(doc.peers).length })),
    };
  };
  return {
    query: (name, days) => run(name, { days }),
    session: (sid) => run("session", { sid }),
    live,
    // The index card: the `kpis` query over the weeks its trends span, and the
    // lobbies open now from the same store the live view reads.
    async kpis() {
      const [rows, view] = await Promise.all([run("kpis", { days: KPI_WEEKS * 7 }), live()]);
      return shapeKpis(rows, view.rooms.length, now());
    },
  };
}
