/**
 * The saved queries (`tools/telemetry/queries/`), as the admin routes run
 * them: read from their files, the Log Analytics table name turned into the
 * linked dataset's, the `-- range` line's seven days turned into a parameter,
 * and the session query's `'SID'` into one. The files stay what a person
 * pastes into the console; this is the only translation.
 *
 * Pure over the file's text, so the rewriting is tested on the files
 * themselves.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const QUERY_NAMES = ["funnel", "lobbies", "progress", "errors", "health", "paths"] as const;
export type QueryName = (typeof QUERY_NAMES)[number];

export function isQueryName(name: string): name is QueryName {
  return (QUERY_NAMES as readonly string[]).includes(name);
}

/** The table a saved query names, as Log Analytics spells it. */
const CONSOLE_TABLE = /`([a-z0-9-]+)\.global\.dayhike-telemetry\._AllLogs`/g;
const RANGE_LINE = "INTERVAL 7 DAY) -- range";
const SESSION_LINE = "'SID' -- session";

/**
 * A saved query made runnable from BigQuery: the dataset's view for the
 * console's, and the range or the session as a query parameter.
 */
export function forBigQuery(sql: string, projectId: string, dataset: string): { sql: string; params: string[] } {
  const params: string[] = [];
  let out = sql.replace(CONSOLE_TABLE, () => `\`${projectId}.${dataset}._AllLogs\``);
  if (out.includes(RANGE_LINE)) {
    out = out.replaceAll(RANGE_LINE, "INTERVAL @days DAY)");
    params.push("days");
  }
  if (out.includes(SESSION_LINE)) {
    out = out.replaceAll(SESSION_LINE, "@sid");
    params.push("sid");
  }
  return { sql: out, params };
}

/** The saved queries' directory: beside the server in the repository, and in the image. */
export function queriesDir(root: string = process.cwd()): string {
  return join(root, "tools", "telemetry", "queries");
}

export function readQuery(name: QueryName | "session", dir: string = queriesDir()): string {
  return readFileSync(join(dir, `${name}.sql`), "utf8");
}
