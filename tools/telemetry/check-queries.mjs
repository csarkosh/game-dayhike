#!/usr/bin/env node
// Dry-run every saved telemetry query against BigQuery, as the admin routes
// run them. Free, and the one check that catches a query Log Analytics'
// editor accepts and BigQuery's parser does not.
//
//   node tools/telemetry/check-queries.mjs

import { tfOutput } from '../deploy/lib/preconditions.mjs';
import { checkQueries, dryRunQuery, QUERIES_DIR, savedQueries } from './lib/checkQueries.mjs';

const project = tfOutput('gcp_project_id');
const dataset = tfOutput('telemetry_dataset');
const queries = savedQueries(QUERIES_DIR);
const problems = await checkQueries(queries, project, dataset, (sql, params) => dryRunQuery(project, sql, params));
for (const { name } of queries) if (!problems.some((p) => p.startsWith(`${name}.sql`))) console.log(`  ✓ ${name}.sql runs`);
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} saved query(s) would not run:\n  ✗ ${problems.join('\n  ✗ ')}\n`);
  process.exit(1);
}
console.log(`\n✓ every saved query runs on BigQuery\n`);
