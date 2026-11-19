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
deploys counted as visitors until the last two checks *(2026-10-22)*. The owner's own play is marked `tester` (and `owner`) at the server by address
(`TELEMETRY_IGNORE_IPS`, the same home addresses as csarko.sh's collector), and so are pages
on a preview channel (`preview`), so this exclusion leaves both out while their errors stay in
the table *(2026-10-26; before, the owner's batches were dropped unwritten)*; play from another
network counts unless that browser is marked a tester (`?telemetry=tester` once). The lookups (`session.sql`,
`visitor.sql`, `match.sql`, and `gpu.sql`, which is pasted and not on the page) are by id and exclude nothing, so a
tester's own session can still be opened.

**One kind of row comes back in two queries.** A person whose browser has hardware acceleration
off, or found no graphics card, is drawn by SwiftShader too, and is who the `turned_away` row
(reason `software` or `no-adapter`) was made for; `real` drops every row of theirs for the GPU's
name. So `funnel.sql` and `errors.sql` read one more CTE beside `real`, `software_away`, the
same text in both: the `turned_away` rows whose `gpu` names SwiftShader, from a browser that is
not automated (`wd` not true, no `HeadlessChrome` in `ua`) and is none of the rest `real` leaves
out (the verification, the testers, the stills shoot). The funnel counts such a session as
landed and turned away, by that row alone; the errors list has it among the players' warnings.
An automated browser on SwiftShader that sets neither mark would be counted with them. No other
row of such a session is read, and no other query reads the CTE: the session is in no count of
sessions, visitors or health.

## The range

Each query over a range reads the last seven calendar days (`kpis.sql` the last twelve
weeks, the length of the trends it feeds): the line marked `-- range` is the one to change,
and the admin page's server sets its days from the range chosen there (`server/src/admin.ts`;
1 is today, 7 today and the six days before), or to the twelve weeks for the index card.
Every day, week and window is by the dates of one zone. Pasted, that zone is New York's: the
files are written in `'America/New_York'`. The admin routes run them in the viewer's zone
instead *(2026-10-22)*: the page sends the browser's zone as `tz` on every request (and the
shared admin host's index sends one to `GET /admin/kpis`), and the server
(`server/src/adminQueries.ts` `forBigQuery`) turns every `'America/New_York'` in a file into
the `@tz` parameter, as it turns the range line's days into `@days`; a route given no `tz`
reads New York's, as a pasted query does. So write a query's zone as that literal, wherever a
date is read (`DATE(timestamp, 'America/New_York')`, `CURRENT_DATE('America/New_York')`), and
never another zone. `timestamp` is the event's own time for rows from the 2026-10-15 server
build on (older rows keep the time the batch arrived).

## The definitions, each once

- A **session** is a `sid`, one a page load; it counts where it has a `page` row.
- A **visitor** is a `vid`, one a browser; **returning** where it was seen on more than one
  calendar day (the zone's, above) in the last ninety.
- A **match** is a distinct `game` with a host's `match_start`; its **players** are the sessions
  with a `match_start` for it; its **length** is the longest of its sessions' own `match_end` or
  `outcome` minus `match_start`.
- The **funnel** nests per session over the whole range: landed (a `page` row), pressed Play,
  started a match, reached an outcome, each stage only of the one before. The builds are a
  breakdown; the `all` row is the headline. **Turned away** is a count beside the stages, not
  one of them: of the sessions that landed, those the page's load check turned away (a
  `turned_away` row), which could never press Play. A session with that row has landed, whether
  or not its `page` row is read (the shared exclusion, above).
- **Clean** is of the sessions that said goodbye (an `end` row), those whose `trouble` was 0;
  **unknown** is the sessions with no `end` row, its own count. Of the sessions that played and
  never said goodbye, one whose last `visibility` was `hidden` **went to the background**; the
  rest **ended silently**.
- **Errors** are `error`, `start_fail`, `connect_fail`, `engine_failed`, `webgpu_start_failed`
  (sent by builds that started an engine apart from the hike's renderer: no page sends it now, and
  the queries keep reading those builds' rows), `device_lost` (a hike's renderer lost its GPU device) and a `session_end` whose `why` is
  `device_lost` (the hike ended by the bound on rebuilds); **warnings** are `warn`,
  `tier_fallback` and `turned_away` (a visitor the load check turned away, its `reason` listed
  as the line's kind: `no-webgpu`, `no-adapter`, `software` or `short`, the last with what the
  adapter is short of in `short`). A `gpu_error` (a GPU error under a hike) is a warning where the picture held
  after it and an error where it broke, which its window's row says (`gpu_window`, `picture`:
  `held`, `broke` or `unknown`; unknown reads as a warning). Sessions are counted distinct per
  line and, in the two totals, distinct over the range. `kpis.sql` counts a session as erred by
  the same names, a broken picture's window among them.

| File | Answers |
|---|---|
| `funnel.sql` | Of the sessions that landed, how many pressed Play, started a match, and reached an outcome, and how many the load check turned away; one line `all`, and one a build. |
| `lobbies.sql` | How many parties formed, how big they were, and how joins failed, by calendar day (New York's pasted, the viewer's on the page). |
| `progress.sql` | One line a match: its host's session, its players, how far they got, which acts they reached, and how it ended. |
| `errors.sql` | What threw, where, on which build, and how many sessions it touched, errors before warnings, with the distinct totals. |
| `health.sql` | Load times by tier and engine, frame rates, and how sessions ended: clean, troubled, unknown, silent, or to the background. |
| `paths.sql` | Every position sample and the route's events, one world at a time: what the admin page draws over the trail. |
| `kpis.sql` | The index card on the shared admin host (`GET /admin/kpis`) and the page's Visitors card: sessions, matches, clean sessions, sessions with an error, visitors and returning visitors, by ISO week, for the last seven days against the seven before, and for the whole range. |
| `visitors.sql` | One line a browser over the range: its sessions, days, matches, last build and machine, and the last session to open. |
| `session.sql` | One session's trail: every row the page sent with its payload, and its lobby's signaling rows, ordered by `timestamp`, read over a window a day either side of the session's own span. Replace `SID`. |
| `visitor.sql` | Every row of every session of one browser, in order, each with its session, match and lobby ids. Replace `VID`. |
| `match.sql` | Every row of every session that was in one match, in order, the sessions side by side. Replace `GAME`. |
| `gpu.sql` | One session's GPU failures, in order: each GPU error with the window that judged the picture after it, each lost device with what the device said, what was happening and what it held, how its rebuild came out, and the end where the losses ended the hike. Replace `SID`. Pasted, not on the page: the session's trail there names the same rows. |

## A GPU failure, read back

A hike's renderer tells the page of every error its GPU device reports and of a device lost under
it (`client/src/game/gpuFaults.ts`). The rows, each with what was happening when it was made:

- `gpu_error`, at once, for each distinct error up to six a hike: `kind` (`validation`,
  `out-of-memory`, `internal`), `src` (`uncaptured`, or `scope` for one an error scope handed
  back), `msg` (the engine's text, to 1,000 characters), `labels` (the passes, pipelines,
  textures and buffers it names), `nth` (which of the hike's distinct errors), `w` (the window
  it fell in, so each error is read by the picture that followed it; none once the hike's
  windows are spent).
- `gpu_window`, five seconds after an error that opened one (three a hike): `w` (which of
  the hike's windows), `errors` and
  `distinct` in the window, `total` and `totalDistinct` for the hike, `frames` drawn in it, and
  the picture read at 32 by 18: `luma` (mean luminance of 255), `black` (the share of black
  pixels), `spread` (of its luminance), and `picture`, `held`, `broke` (no frame was drawn, or
  the picture is black or one flat colour) or `unknown`, with `unread` saying why where it
  could not be read (the page hidden, the renderer gone, a browser that hands a 2D canvas
  nothing of a WebGPU one).
- `device_lost`, for each loss the game did not ask for: `reason` and `msg` (the browser's
  `GPUDeviceLostInfo`), `losses` (this page's), `recent` (within the bound's ten minutes),
  `sinceMs` (since the loss before), `verdict` (`rebuild`, or `end` at the third in the
  window), `errors` (GPU errors the renderer had told of), and what the device held: `bufs`,
  `bufMB`, `texs`, `texMB` (asked for and not let go, by arithmetic) and `heapMB` (the page's
  JS heap, in Chrome). `t`, on every row, is the milliseconds since the page loaded.
- `engine_rebuilt`, after the hike's answer to a failure: `ok`, `state` (`standing`, or
  `failed` where no device could be made again), `frames` drawn under the cover, `ms`.
- On all of them: `r` (which of the hike's renderers, 1 the first), `tier`, `state`, `frames`
  and `stoodMs` (how long the renderer had stood), `ready` (the world was in), `busy`
  (`switch`, `drop` or `rebuild` under way), `film`, `hidden`, `shownMs` (since the page was
  last shown), `scene`, `ending`, `dark`, `rain`, `wet`, `night`, `hour`, `lakes`, `sea`, `p`,
  `tick`.

A loss forced by destroying the device, as the tests force one, says `reason: destroyed`, the
same as the game's own letting go of a renderer, which sends no row: the two are told apart by
who asked. A loss the browser makes (a driver reset, the GPU process gone) says `unknown`.

## The errors testing met

`errors.sql` is the players' errors, and the owner's own beside them *(2026-11-01, Cyrus: "I still
want my errors sent to the dashboard when I play the game")*: it reads `real` and, apart from it,
every row the server marked `owner`, and each row of its result says `whose` it is, `players` or
`you`; the owner's rows stay out of its totals (`sessions_with_errors`, `sessions_with_warnings`),
as they are out of every other query. Preview channels' pages and other testers' browsers are
still left out with the rest of `tester`, and are in the table all the same (above). Their
errors, pasted into BigQuery as written:

```sql
SELECT timestamp, JSON_VALUE(json_payload.sid) AS sid, JSON_VALUE(json_payload.build) AS build,
  JSON_VALUE(json_payload.n) AS n, JSON_VALUE(json_payload.kind) AS kind,
  JSON_VALUE(json_payload.owner) AS owner, JSON_VALUE(json_payload.preview) AS preview,
  JSON_VALUE(json_payload.msg) AS msg, JSON_VALUE(json_payload.reason) AS reason
FROM `fps-csarko.dayhike_telemetry._AllLogs`
WHERE JSON_VALUE(json_payload.svc) = 'telemetry'
  AND JSON_VALUE(json_payload.tester) = 'true'
  AND JSON_VALUE(json_payload.n) IN ('error', 'warn', 'engine_failed', 'webgpu_start_failed', 'tier_fallback', 'turned_away', 'start_fail', 'connect_fail', 'gpu_error', 'gpu_window', 'device_lost')
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
ORDER BY timestamp DESC;
```
