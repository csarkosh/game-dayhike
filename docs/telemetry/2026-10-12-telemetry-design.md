# Telemetry

**Date:** 2026-10-12
**Status:** Built 2026-10-12. Amended the same day: a stored error is traceable to its cause (§8), and the trace of where a player went and what they chose (§9). Amended 2026-10-15 so a session reads back as a timeline (`2026-10-15-timeline-design.md`): each batch says the page's clock (`st`), the match and the lobby ride on each event rather than the envelope, the envelope says the page's facts from the start, and four events were added (§2). Amended 2026-10-22: the admin page dates the worlds in the viewer's zone, not New York's (§9).

## 0. What this is

The game had no way to tell whether anyone played it, how far they got, or whether it
broke. Now each page reports what it does — it landed, Play was pressed, a lobby formed,
the world was built, the night fell, the party won or died, something threw — and the
signaling server reports what it sees of its rooms. The rows land in a log bucket of their
own on Google Cloud, queried by SQL in the console and through a BigQuery dataset, with
every row naming the build and the world version that produced it.

Three rules shaped it:

- **Nothing runs a frame.** An event is one small object pushed on an array at a transition
  the game already branches on. Serialising and sending happen in a timer, once a flush.
- **No new bill.** No SDK, no database, no instance that sits idle. The ingest is a Cloud
  Run service that scales from zero; the store is Cloud Logging, whose first 50 GiB a
  month and every Log Analytics query are free.
- **Every row stands alone.** The envelope naming the page, the build and the world is
  flattened onto each row by the server, so no query needs a join to say which version of
  the game it is counting.

## 1. The shape

```
page ──POST /t──▶ fps-telemetry (Cloud Run, 0..5 instances) ──stdout──▶ Cloud Logging
                                                                          │ sink: jsonPayload.dh=1
fps-signaling (Cloud Run, 1 instance) ───────── room rows ─── stdout ────▶ bucket dayhike-telemetry
                                                                          │ Log Analytics on
                                                                          ▼
                                                               BigQuery dataset dayhike_telemetry
```

**The page** (`client/src/net/telemetry.ts`) holds a bounded queue of events. Every 30 s
(`FLUSH_MS`), or at 50 queued (`FLUSH_AT_EVENTS`), a timer serialises the queue into one
batch and sends it with a keepalive `fetch` as `text/plain`, which is a simple request
with no preflight. On `pagehide` the page sends an `end` event with its counts and
everything held by `navigator.sendBeacon`; a tab going hidden flushes by beacon too. A
batch the server did not take goes back to the front of the queue for the next flush. The
queue holds 500 events; past that the oldest are dropped and counted. Errors and warnings
are capped at 20 a session and deduplicated on their first hundred characters; the rest are
counted as `suppressed`.

**The server** (`server/src/telemetry.ts`) is the signaling server's own image in a second
role. `ROLE=telemetry` serves `POST /t` and refuses the WebSocket; `ROLE=signaling` is the
one-instance service as before; unset, as in development, a process serves both and the dev
server proxies `/t` beside `/ws`. The route checks the origin against the same allowlist as
the socket, rate-limits by address with a token bucket (60 batches burst, one a second),
caps the body at 64 KB and a batch at 200 events, drops any field that is not a primitive
or an array of primitives, flattens the envelope onto each event, and writes one JSON line
an event to stdout (`server/src/log.ts`). It holds nothing between requests.

**The signaling server** writes rows of its own as rooms come and go: `room_create`,
`room_join`, `room_leave`, `room_drop` (a socket died), `room_refused` (with the code) and
`room_end` (with the reason and the room's lifetime). These are the ground truth of how many
parties formed and how big they were: no page has to report them and no blocker can keep
them from arriving.

**The store** (`_infra/modules/gcp-telemetry`) is a log bucket, `dayhike-telemetry`, fed
by a project sink on `resource.type="cloud_run_revision" AND jsonPayload.dh=1`, which both
services' rows carry and nothing else in the project does. Log Analytics is on, which
cannot be undone on a bucket, so the bucket is the rows' own and `_Default` is untouched.
Retention is 400 days. An exclusion keeps the same rows and the telemetry service's
successful request-log entries out of `_Default`, which halves the volume at a spike. The
bucket is linked as the read-only BigQuery dataset `dayhike_telemetry`.

**The budget**, optional, alerts on Cloud Run and Cloud Logging spend at half and all of
$10 a month, and on the forecast. It is created only with `billing_account_id` set in the
git-ignored `terraform.tfvars`.

## 2. What a row says

Every row carries the envelope the page sent:

| Field | What |
|---|---|
| `sid` | The session: one a page load. |
| `vid` | The visitor: one a browser, kept in localStorage, so a returning player counts once. Empty where storage refuses. |
| `build` | The client's git short sha, `-dirty` where the tree was, baked in by the deploy's build (`VITE_BUILD_SHA`); `dev` in development. |
| `proto`, `gen` | `PROTOCOL_VERSION` and `GEN_VERSION`, the two constants that decide whether two pages can play together. |
| `desktop`, `shell`, `os`, `browser`, `touch` | The platform, from `game/platform.ts`. |
| `ref` | The referrer's origin and path, 200 characters at most; "" for none (`referrerOf`). |
| `path` | `location.pathname` as the page loaded. |
| `lang`, `tz` | `navigator.language` and the IANA zone the browser keeps time in. |
| `vw`, `vh` | The viewport, in CSS pixels, as the page loaded. |
| `ua` | The user agent's first 120 characters. |
| `wd` | True when `navigator.webdriver` is: a robot drives the page. |
| `tester` | True when `?telemetry=tester` was ever given to this browser (§5), so the queries can leave a tester's sessions out. |
| `gpu`, `adapter`, `cores`, `mem`, `mobile` | The GPU's signals, once read. |

the context the page copies onto each event as it is queued (`telemetry.context`), so a
row names a match or a lobby only while one was running:

| Field | What |
|---|---|
| `world`, `seed`, `game` | From the world's build to `match_end`: the level id with its seed taken out, the seed, and the game token. The level id reads `forest/<gen>/<variant>/<seed>/<fieldHash>/<passHash>`; the field hash and the pass hash digest the generator's code and tunables, so `world` moves whenever the world would, whether or not `GEN_VERSION` was bumped (`worldVersionOf`). |
| `lobby` | The lobby id, from the moment one is joined or made to `lobby_end`, which is the room id in the signaling rows. |

and what the server adds: `t` (ms since the page loaded), `at` (epoch ms received),
`timestamp` (when the event happened, from `at` and the page's clock as the batch was
made, `st`, which the page sends on every batch and the server keeps off the rows),
`sbuild` (the server's own sha, from the image), `svc` (`telemetry` or `signaling`),
`severity` (`ERROR` and `WARNING` for `error` and `warn` rows) and `message`.

The events, in the order a session makes them:

| Event | Fields | Fired from |
|---|---|---|
| `page` | `kind`: landing, downloads, credits, settings, party, game, scene | every render of a route |
| `visibility` | `state`: hidden, visible | every `visibilitychange`; the last `hidden` is "last seen" for a page that never sends `end` |
| `settings` | `choice` | a graphics choice saved |
| `download` | `platform` | a download link on the landing page followed |
| `play` | `party` | Play pressed |
| `invite`, `join` | | an attempt to make or join a lobby begins |
| `lobby_joined` | `kind`, `ms`, `members`, `role` | the lobby answered |
| `lobby_error` | `kind`, `code`, `ms` | it did not: `no_such_lobby`, `room_full`, `host_away`, `lobby_taken`, or the socket's own error |
| `invite_copied` | | the invite link reached the clipboard |
| `lobby_change` | `members`, `joined`, `left` | the roster changed: who came and who went, by count |
| `lobby_end` | `reason`, `members` | `host_gone` or `left` |
| `load` | `decideMs`, `introMs`, `engineMs`, `buildMs`, `tier`, `source`, `engine` | the start chain finished (`startHike`) |
| `start_fail` | the laps so far, `msg` | it did not |
| `ready` | `ms` | the world ready to be looked at, from the launch |
| `match_start` | `role`, `party`, `lobby` | the host session, or a follower's once connected |
| `act` | `act`: wet, dusk, mist; `p`; `tick` | the climb's ratchet passed the mark (`sim/acts.ts`) |
| `phase` | `phase`: scene, chase; `p`; `tick` | the host's phase flipped |
| `pos` | `tick`, `x`, `z`, `yaw`, `p`, `hp`, `lamp`, `sprint`, `off`, `lens`, `near`, `stare` | every 120 ticks while the player moved (§9) |
| `edge`, `fork`, `place`, `offtrail`, `ontrail`, `lamp`, `cut` | the route's transitions (§9) | on the sample, when the value changed |
| `hollow_seen`, `poster`, `pause`, `resume`, `tier_change`, `intro`, `cmd` | what happened and what was chosen (§9) | once each, as it happens |
| `death` | `tick`, `p`, `phase`, `cause`, `near`, `x`, `z` | this player died: the Hollow's reach is the one cause |
| `outcome` | `result`, `self`, `alive`, `players`, `tick`, `p` | the match ended |
| `hb` | `fps`, `worst`, `stalls`, `rtt`, `pe`, `p`, `dropped`, `failed` | every flush while a match runs |
| `session_end`, `host_session_end` | `msg` or `kind` | the session ended short of an outcome |
| `connect_fail`, `reconnect` | `msg` | a follower's handshake failed, or its channel dropped |
| `tier_fallback`, `governor_drop`, `engine_failed`, `webgpu_start_failed` | the reason | the graphics ladders |
| `exit`, `continue_offline`, `match_end` | | leaving |
| `error`, `warn` | `kind`, `msg`, `stack`, `where` | an uncaught throw, an unhandled rejection, or the page's own `console.error`/`warn` |
| `end` | `reason`, `dropped`, `trouble`, `suppressed`, `sent`, `failed`, `dur` | the page is leaving |

"Did it run without errors" is answered by the last row of a session: an `end` with
`trouble: 0` was a clean session; a last `hb` with no `end` after it is a page that died
without saying so, and `t` says when. `where` on an error is the breadcrumb the page last
set: the route, `start` while loading, `game` once running.

The `p` on every match row is the party's climb, 0 at the trailhead and 1 at the crest, the
same ratchet the acts and the sky read, so "how far did they get" is one number.

## 3. What it costs the page

- No per-frame work: the acts and the phase are compared against the last reported value
  inside a function that already runs each frame; a position is three numbers copied every
  300 ticks; the worst-frame and stall counters are one comparison each in `frameSeconds`.
- No work on the render thread beyond an array push. Serialising a batch is under a
  millisecond, once every 30 s, in a timer.
- About 2 KB of code and no library. One 200-byte request at page load, a few KB every
  30 s, nothing on the WebRTC channels.
- Bounded memory: 500 events at most, errors capped at 20.

## 4. Reading it

**Live, during a session:** the Logs Explorer with the filter `jsonPayload.dh=1`, or

```bash
gcloud logging tail 'jsonPayload.dh=1' --project fps-csarko --format='value(jsonPayload)'
```

**Queries:** Log Analytics in the console, over the bucket's `_AllLogs` view, free. The
saved queries in `tools/telemetry/queries/` answer the first questions: the funnel from
landing to playing, lobbies and their sizes, how far parties got and how the night went,
the errors, and load times by tier and engine. Each groups by `build` and `world`, so a
number is always a number for one version.

**The dataset:** `fps-csarko.dayhike_telemetry._AllLogs` from BigQuery or Looker Studio,
for charts without code. The first TiB of queries a month is free.

## 5. Switches and limits

- `?telemetry=off` on the site turns a page silent and is remembered in localStorage, so a
  developer's own machine stays out of the numbers; `?telemetry=on` forgets it. Development
  sends nothing unless `?telemetry=on`, which goes to the dev server's own origin.
- `?telemetry=tester` marks the browser a tester's, also in localStorage: its pages send as
  usual with `tester: true` in the envelope, and the queries leave them out. `?telemetry=on`
  forgets that mark too.
- The telemetry service scales to five instances at most, a thousand batches in flight
  each. That is a cost ceiling: one instance handles a forum-sized spike.
- Rows from the deploy's verification carry `build: verify` and the event `verify`; a
  query leaves them out by that.
- Nothing personal is recorded: no player name, and no address of ours. Cloud Run's own
  request log, which does carry the address, is dropped for successful batches.

## 6. Cost at scale

Under Cloud Run's request-based billing in `us-west1`, with the monthly free tiers (two
million requests, 180,000 vCPU-seconds, 50 GiB of logging):

| Scenario | Batches | Cloud Run | Cloud Logging |
|---|---|---|---|
| A test party, 20 players, 3 hours | ~7,000 | $0 | $0 |
| A showcase day, 500 concurrent, 10 hours | ~600,000 | $0 | $0, about 1.2 GB |
| A viral spike, 5,000 concurrent, 10 hours | ~6,000,000 | about $2 | about $12 |

An instance costs about nine cents a busy hour; a batch is about 2 KB of rows.

## 7. Not built

- **The admin page.** Built the same day, after this:
  [`../admin/2026-10-12-admin-page-design.md`](../admin/2026-10-12-admin-page-design.md).
- **Signaling on more than one instance.** Built the same day, after this:
  [`../signaling/2026-10-12-shared-rooms-design.md`](../signaling/2026-10-12-shared-rooms-design.md).

## 8. Reading an error back to its cause

*Amended 2026-10-12, with the admin page.* An error row named the session, the build, the
world, the platform and the GPU from the first day; four things were missing for a cause.

- **Source maps.** The build writes hidden maps (`sourcemap: "hidden"` in
  `client/vite.config.ts`): beside the chunks, unreferenced by them. The client deploy keeps
  them out of the site and stores them in the downloads bucket under `sourcemaps/<build
  sha>/assets/`, public as the repository is. `node tools/telemetry/symbolicate.mjs <build>
  [stack.txt]` rewrites every frame a map knows to `<source>:<line>:<column> (<name>) ←
  <chunk>:<line>:<column>` and leaves the rest.
- **The stack and the breadcrumb.** `MAX_STACK_LENGTH` is 2,000 characters, a dozen or more
  minified frames; the server's string cap matches. `where` names the step of the start
  (`start:decide`, `start:engine`, `start:build`) and, through `markedProgress`
  (`game/loadProgress.ts`), the loading stage whose first item has begun (`load:models`,
  `load:ground`, `load:shaders`, `load:pipelines`, `load:world`), whether or not an intro's
  bar is showing.
- **The early catch.** An inline script at the top of `client/index.html` listens for
  `error` and `unhandledrejection` from the first byte, queuing what it hears on
  `window.__dh` until the bundle's telemetry takes the queue and the listeners over
  (`EarlyCatch`). If nothing takes them over within fifteen seconds and something was heard,
  the script beacons the queue itself under a `boot-` session id with `kind: boot:<kind>` and
  the user agent: the page that never started still says so. Vite substitutes the telemetry
  URL and the build sha into the script; in development they stay as written and nothing is
  sent.
- **The session timeline.** `tools/telemetry/queries/session.sql`, every row a session sent
  and its lobby's signaling rows in order; the admin page opens it as a drawer from any
  session id.

## 9. The trace: where a player went and what they chose

*Amended 2026-10-12, for an unwatched playtest.* The first day's `pos` every five seconds
gave a heat map and "how far"; it could not say which branch a party took at a fork, when
they left the trail, whether they used the lamp, or what they read. `game/trace.ts` gives
each match a trace, made at its start from the world's trail graph and the names of its
places, and stepped from both loops after the outcome:

- **One integer compare a frame**, until `TRACE_EVERY_TICKS` (120, two seconds) have
  passed. Then, if the player has moved `TRACE_MIN_MOVE` (a metre) since the last sample, a
  `pos` row: position, yaw, the party's climb, health, the lamp, sprinting, how far off the
  trail (the escalation's own reading), the dread lens, the nearest Hollow's closeness, and
  the stare. A player standing still sends nothing.
- **On that sample, the route's transitions, each once when the value changes:** `edge`,
  the nearest trail edge by point-to-segment distance over the graph's few dozen edges,
  with its kind (stem, loop, strand, rung), which is the branch taken; `fork`, a junction
  node within six metres; `place`, a feature's disc entered or left, by its sign-post name;
  `offtrail` and `ontrail`; `lamp`, on or off, movement or not; and on the host, `cut`,
  each fork the chase has cut, from the sim's own record.
- **As they happen:** `hollow_seen`, the first frame a Hollow is in the state; `poster`,
  the trailhead board read; `pause` and `resume`; `tier_change` with the tiers and the
  source; `intro` with how it ended (watched, cut early, failed); `cmd`, the names of any
  `?cmd=` overrides the session started with, so a debug session is told apart; and
  `death` with the tick, the cause, the Hollow's closeness and the place.

Nothing is computed per frame beyond the compare: the geometry runs on the sample, the
escalation's readings are the ones it already makes for the lens and the sky, and the sim
is read and never written. A player-hour of walking is about 1,800 samples, some 100 KB.

**The drawing.** The admin page's "Where parties went" card rebuilds the trail from the
world's seed in a worker (`client/src/admin/trail.ts`, the same generator the game runs,
about half a second) and draws each session's samples as a line over it, with the forks
numbered, the named places as discs, a × at a death, a ◇ at the Hollow's first showing, a
□ at the poster, a scrubber over sim time, a hover readout on any moment, and a session
list of who walked a loop, left the trail, used the lamp, or died. The card shows one
world at a time, chosen from a list of every world in the range, newest party first, each
entry dated in New York time by its earliest row (when the party set out) and naming the
world and its seed *(amended 2026-10-22: dated in the viewer's own zone, the browser's, as
every time on the admin page is; `../admin/2026-10-12-admin-page-design.md` §8)*. A world of another generation of the generator is drawn with a note,
since its trail may have differed.
