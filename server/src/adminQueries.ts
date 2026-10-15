/**
 * The saved queries (`tools/telemetry/queries/`), as the admin routes run
 * them: read from their files, the Log Analytics table name turned into the
 * linked dataset's, the `-- range` line's days turned into a parameter, and
 * the lookups' ids (the session query's `'SID'`, the visitor's `'VID'`, the
 * match's `'GAME'`) into one each. The files stay what a person pastes into
 * the console; this is the only translation.
 *
 * Pure over the file's text, so the rewriting is tested on the files
 * themselves.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The queries over a range, each a card on the page (`kpis` is the index card too). */
export const QUERY_NAMES = ["funnel", "lobbies", "progress", "errors", "health", "paths", "kpis", "visitors"] as const;
export type QueryName = (typeof QUERY_NAMES)[number];

/** The queries over one id: a session, a visitor (a browser) or a match (a game). */
export const LOOKUP_NAMES = ["session", "visitor", "match"] as const;
export type LookupName = (typeof LOOKUP_NAMES)[number];

export function isQueryName(name: string): name is QueryName {
  return (QUERY_NAMES as readonly string[]).includes(name);
}

/** The table a saved query names, as Log Analytics spells it. */
const CONSOLE_TABLE = /`([a-z0-9-]+)\.global\.dayhike-telemetry\._AllLogs`/g;
/**
 * The range line: the days a query reads when pasted, which become the
 * parameter here. Most read seven; `kpis.sql` reads the twelve weeks its
 * trends need, so the count is whatever the file says, not a fixed seven.
 */
const RANGE_LINE = /INTERVAL \d+ DAY\), 'America\/New_York'\) -- range/g;
/** Each lookup's placeholder, a string literal when pasted, and the parameter it becomes. */
const LOOKUP_LINES: readonly { marker: string; param: LookupParam }[] = [
  { marker: "'SID' -- session", param: "sid" },
  { marker: "'VID' -- visitor", param: "vid" },
  { marker: "'GAME' -- match", param: "game" },
];
export type LookupParam = "sid" | "vid" | "game";

/**
 * A saved query made runnable from BigQuery: the dataset's view for the
 * console's, and the range or the lookup's id as a query parameter. A
 * placeholder may stand in a file more than once (the span and the rows of a
 * lookup); the parameter is named once.
 */
export function forBigQuery(sql: string, projectId: string, dataset: string): { sql: string; params: string[] } {
  const params: string[] = [];
  let out = sql.replace(CONSOLE_TABLE, () => `\`${projectId}.${dataset}._AllLogs\``);
  const ranged = out.replace(RANGE_LINE, "INTERVAL @days DAY), 'America/New_York')");
  if (ranged !== out) {
    out = ranged;
    params.push("days");
  }
  for (const { marker, param } of LOOKUP_LINES) {
    if (!out.includes(marker)) continue;
    out = out.replaceAll(marker, `@${param}`);
    params.push(param);
  }
  return { sql: out, params };
}

/** The saved queries' directory: beside the server in the repository, and in the image. */
export function queriesDir(root: string = process.cwd()): string {
  return join(root, "tools", "telemetry", "queries");
}

export function readQuery(name: QueryName | LookupName, dir: string = queriesDir()): string {
  return readFileSync(join(dir, `${name}.sql`), "utf8");
}
