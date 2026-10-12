# Telemetry queries

Saved Log Analytics queries over the telemetry bucket
(`docs/telemetry/2026-10-12-telemetry-design.md`). Paste one into Log Analytics in the
console (Logging → Log Analytics, project `fps-csarko`), or run it from BigQuery against
the linked dataset by replacing the table with `` `fps-csarko.dayhike_telemetry._AllLogs` ``.

Every query groups by `build` and `world`, so a number is always a number for one version,
and leaves out the deploy's verification rows (`build = 'verify'`).

| File | Answers |
|---|---|
| `funnel.sql` | Of the sessions that landed, how many pressed Play, started a match, and reached an outcome. |
| `lobbies.sql` | How many parties formed, how big they were, and how joins failed. |
| `progress.sql` | How far each party got, which acts they reached, and how each match ended. |
| `errors.sql` | What threw, where, on which build, and how many sessions it touched. |
| `health.sql` | Load times by tier and engine, frame rates, and sessions that ended without saying so. |
| `paths.sql` | Every position sample, for a heat map. |
