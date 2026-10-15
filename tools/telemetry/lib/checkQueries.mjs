// The saved queries (tools/telemetry/queries/), dry-run against BigQuery as
// the admin routes run them: the same three rewrites the server makes
// (server/src/adminQueries.ts), then a job BigQuery plans but does not
// execute, which costs nothing and refuses a query it could not run. Log
// Analytics' editor accepts what BigQuery's parser does not (`rows` as a
// name, found on the first sign-in), so the engine is the only judge.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The server's rewrites, in one place for the check: the dataset's view, the
 * range and the three lookups' ids. The range line's days are whatever the
 * file reads when pasted (seven for most, twelve weeks for `kpis.sql`), as
 * the server takes them; the session's `'SID'`, the visitor's `'VID'` and the
 * match's `'GAME'` become parameters.
 */
export function forBigQuery(sql, projectId, dataset) {
  const params = {};
  let out = sql.replace(/`([a-z0-9-]+)\.global\.dayhike-telemetry\._AllLogs`/g, `\`${projectId}.${dataset}._AllLogs\``);
  const ranged = out.replace(/INTERVAL \d+ DAY\), 'America\/New_York'\) -- range/g, "INTERVAL @days DAY), 'America/New_York')");
  if (ranged !== out) {
    out = ranged;
    params.days = 7;
  }
  for (const [marker, name] of [["'SID' -- session", 'sid'], ["'VID' -- visitor", 'vid'], ["'GAME' -- match", 'game']]) {
    if (!out.includes(marker)) continue;
    out = out.replaceAll(marker, `@${name}`);
    params[name] = 'x';
  }
  return { sql: out, params };
}

/** Every `.sql` in the directory, by name. */
export function savedQueries(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name: name.replace(/\.sql$/, ''), sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * Dry-runs each query through `dryRun(sql, params)`, which resolves on a
 * query BigQuery would run and rejects with its message otherwise. Returns
 * the problems, one line a query, empty when every query runs.
 */
export async function checkQueries(queries, projectId, dataset, dryRun) {
  const problems = [];
  for (const { name, sql } of queries) {
    const prepared = forBigQuery(sql, projectId, dataset);
    try {
      await dryRun(prepared.sql, prepared.params);
    } catch (error) {
      problems.push(`${name}.sql: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

/** The saved queries' directory, beside this file. */
export const QUERIES_DIR = new URL('../queries/', import.meta.url).pathname;

/**
 * A dry run on BigQuery: the job is planned under the deployer's credentials
 * and never executed, so it is free and answers only "would this run".
 */
export async function dryRunQuery(projectId, sql, params) {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const bq = new BigQuery({ projectId });
  await bq.createQueryJob({ query: sql, params, useLegacySql: false, dryRun: true });
}
