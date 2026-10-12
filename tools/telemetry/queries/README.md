# Telemetry queries

Saved Log Analytics queries over the telemetry bucket
(`docs/telemetry/2026-10-12-telemetry-design.md`). Paste one into Log Analytics in the
console (Logging → Log Analytics, project `fps-csarko`), or run it from BigQuery against
the linked dataset by replacing the table with `` `fps-csarko.dayhike_telemetry._AllLogs` ``.

Before changing a query, know that the admin page runs these on BigQuery, whose parser is
stricter than the Log Analytics editor: `rows` is a reserved word there, for one.
`node tools/telemetry/check-queries.mjs` dry-runs every file as the page's routes run it, and
`npm run deploy:verify` does the same.

Every query groups by `build` and `world`, so a number is always a number for one version,
and leaves out the deploy's verification rows (`build = 'verify'`). Each reads the last seven
days: the line marked `-- range` is the one to change, and the admin page's server sets it
from the range chosen there (`server/src/admin.ts`).

| File | Answers |
|---|---|
| `funnel.sql` | Of the sessions that landed, how many pressed Play, started a match, and reached an outcome. |
| `lobbies.sql` | How many parties formed, how big they were, and how joins failed. |
| `progress.sql` | How far each party got, which acts they reached, and how each match ended. |
| `errors.sql` | What threw, where, on which build, and how many sessions it touched. |
| `health.sql` | Load times by tier and engine, frame rates, and sessions that ended without saying so. |
| `paths.sql` | Every position sample, for a heat map. |
| `session.sql` | One session's timeline: every row the page sent, and its lobby's signaling rows, in order. Replace `SID`. |
