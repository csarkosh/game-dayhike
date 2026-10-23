# Telemetry queries

Saved Log Analytics queries over the telemetry bucket
(`docs/telemetry/2026-10-12-telemetry-design.md`, and the timeline's contract,
`docs/telemetry/2026-10-15-timeline-design.md`). Paste one into Log Analytics in the console
(Logging → Log Analytics, project `fps-csarko`), or run it from BigQuery against the linked
dataset by replacing the table with `` `fps-csarko.dayhike_telemetry._AllLogs` ``.

Before changing a query, know that the admin page runs these on BigQuery, whose parser is
stricter than the Log Analytics editor: `rows` is a reserved word there, for one.
`node tools/telemetry/check-queries.mjs` dry-runs every file as the page's routes run it, and
`npm run deploy:verify` does the same.

## The shared exclusion

Every query over a range begins with the same CTE, `real`, the same text in each file (the
server's tests compare them): the rows that are real play. It drops the deploy's
verification (`build = 'verify'` on a page's rows, `verify` (on signaling rows written since 2026-10-15; older verification rooms stay in the counts) on the signaling rows of a room a
verification opened), the owner's test browsers (`tester`), every session of the README's
stills shoot (a session with a `cmd` row, looked for over the last ninety days), and headless
or automated browsers: a `gpu` naming SwiftShader, a `ua` naming HeadlessChrome, or `wd` true
(the page's `navigator.webdriver`). Headless Chrome on a machine with a real GPU names that GPU
(an NVIDIA L4, an Apple M4), not SwiftShader: eleven such sessions around the 2026-10-19
deploys counted as visitors until the last two checks *(2026-10-22)*. The owner's own play
never reaches the table: the server drops it by address (`TELEMETRY_IGNORE_IPS`, the same
home addresses as csarko.sh's collector), so play from another network counts unless that
browser is marked a tester (`?telemetry=tester` once). The three lookups (`session.sql`,
`visitor.sql`, `match.sql`) are by id and exclude nothing, so a tester's own session can
still be opened.

## The range

Each query over a range reads the last seven New York calendar days (`kpis.sql` the last
twelve weeks, the length of the trends it feeds): the line marked `-- range` is the one to
change, and the admin page's server sets its days from the range chosen there
(`server/src/admin.ts`; 1 is today in New York, 7 today and the six days before), or to the
twelve weeks for the index card. Every day, week and window is by `America/New_York` dates,
and `timestamp` is the event's own time for rows from the 2026-10-15 server build on (older
rows keep the time the batch arrived).

## The definitions, each once

- A **session** is a `sid`, one a page load; it counts where it has a `page` row.
- A **visitor** is a `vid`, one a browser; **returning** where it was seen on more than one New
  York day in the last ninety.
- A **match** is a distinct `game` with a host's `match_start`; its **players** are the sessions
  with a `match_start` for it; its **length** is the longest of its sessions' own `match_end` or
  `outcome` minus `match_start`.
- The **funnel** nests per session over the whole range: landed (a `page` row), pressed Play,
  started a match, reached an outcome, each stage only of the one before. The builds are a
  breakdown; the `all` row is the headline.
- **Clean** is of the sessions that said goodbye (an `end` row), those whose `trouble` was 0;
  **unknown** is the sessions with no `end` row, its own count. Of the sessions that played and
  never said goodbye, one whose last `visibility` was `hidden` **went to the background**; the
  rest **ended silently**.
- **Errors** are `error`, `start_fail`, `connect_fail`, `engine_failed` and `webgpu_start_failed`;
  **warnings** are `warn` and `tier_fallback`. Sessions are counted distinct per line and, in
  the two totals, distinct over the range.

| File | Answers |
|---|---|
| `funnel.sql` | Of the sessions that landed, how many pressed Play, started a match, and reached an outcome; one line `all`, and one a build. |
| `lobbies.sql` | How many parties formed, how big they were, and how joins failed, by New York day. |
| `progress.sql` | One line a match: its host's session, its players, how far they got, which acts they reached, and how it ended. |
| `errors.sql` | What threw, where, on which build, and how many sessions it touched, errors before warnings, with the distinct totals. |
| `health.sql` | Load times by tier and engine, frame rates, and how sessions ended: clean, troubled, unknown, silent, or to the background. |
| `paths.sql` | Every position sample and the route's events, one world at a time: what the admin page draws over the trail. |
| `kpis.sql` | The index card on the shared admin host (`GET /admin/kpis`) and the page's Visitors card: sessions, matches, clean sessions, sessions with an error, visitors and returning visitors, by ISO week, for the last seven days against the seven before, and for the whole range. |
| `visitors.sql` | One line a browser over the range: its sessions, days, matches, last build and machine, and the last session to open. |
| `session.sql` | One session's trail: every row the page sent with its payload, and its lobby's signaling rows, ordered by `timestamp`, read over a window a day either side of the session's own span. Replace `SID`. |
| `visitor.sql` | Every row of every session of one browser, in order, each with its session, match and lobby ids. Replace `VID`. |
| `match.sql` | Every row of every session that was in one match, in order, the sessions side by side. Replace `GAME`. |
