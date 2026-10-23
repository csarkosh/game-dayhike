# Telemetry that holds a timeline (2026-10-15)

An audit of the first four days of rows found that one player's session cannot be read back
as a timeline: every event in a batch carries the batch's arrival time, the match and lobby
ids are stamped per batch rather than per event, 85% of sessions are the stills shoot or the
owner, and the admin page counts a match three different ways. This note fixes the wire
format, the server and the queries together, and is the contract between the three. The design it extends is `2026-10-12-telemetry-design.md`.

## 1. The wire (batch version 1, additive)

- **`st`** on every batch: the page's `t()` at the moment the batch was serialised. The server
  recovers each event's time as `at - (st - t)` with no trust in the client's clock.
- **Context rides on each event, not the envelope.** `game`, `world`, `seed` and `lobby` are
  copied onto an event when it is queued (`telemetry.context(fields)`; a `null` clears a key).
  `match_end` clears `game`, `world`, `seed`; `lobby_end` clears `lobby`. The envelope no longer
  carries them, so a row names a match only while one is running.
- **The page's facts, in the envelope from the start:** `ref` (the referrer's origin and path,
  200 chars at most, "" for none), `path` (`location.pathname`), `lang`, `tz` (the IANA zone),
  `vw` and `vh` (the viewport), `ua` (the user agent's first 120 chars), `wd` (true when
  `navigator.webdriver`), `tester` (true when `?telemetry=tester` was ever given to this
  browser; `?telemetry=on` forgets it, as it forgets `off`).
- **New events:** `visibility {state}` on every `visibilitychange` (`hidden` or `visible`; the
  last `hidden` is "last seen" when no `end` arrives); `settings {choice}` when a graphics
  choice is saved; `download {platform}` on a landing-page download link; `invite_copied`;
  `lobby_change` gains `joined` and `left` counts beside `members`. `end` stays as it is, on
  `pagehide` only.

## 2. The server

- `parseBatch` reads `st` (a finite number) and keeps it off the rows, like `v`.
- `rowsOf` gives every row a top-level **`timestamp`**, RFC 3339 with milliseconds:
  `receivedAt - (st - t)` when `st` is known and `0 <= st - t <= 86_400_000`, else
  `receivedAt`. Cloud Logging takes that field as the entry's time, so BigQuery's `timestamp`
  becomes the event's. `at` stays the time of receipt.
- **`TELEMETRY_IGNORE_IPS`**: a comma-separated list of addresses or CIDR prefixes (v4 and v6).
  A batch from one of them is read and checked like any other (a bad one is still refused,
  so a deploy verified from the owner's machine still proves the route), and a good one is
  answered 204 and never written. Terraform: module variable `ignore_ips` (list of strings,
  sensitive, default empty) into that env; root variable `telemetry_ignore_ips`, set only in
  the git-ignored `_infra/terraform.tfvars` (the repo is public).
- Signaling rows of a room created by a deploy verification (peer id `verify-…`) carry
  `verify: true`, so the lobby counts can leave them out. Rows from before this build carry
  no mark and are not special-cased, like their arrival-time timestamps.

## 3. The queries and the admin page

- `timestamp` is the event's time for rows from this server build on; older rows keep their
  arrival time and are not special-cased.
- One exclusion, the same in every query: `build != 'verify'`, `tester` not `'true'`, no
  session with a `cmd` row (the stills shoot), no `gpu` containing `SwiftShader`, and no
  signaling row with `verify`. The owner's own play is dropped at the server by address.
- Definitions, each once: a **match** is a distinct `game` with a host's `match_start`;
  **players** are the distinct sessions with a `match_start` for it; its **length** is its
  `match_end` or `outcome` minus its `match_start` within one session; the **funnel** nests
  per session over the whole range (landed, pressed Play, started, finished), with the build
  a breakdown rather than the headline; **clean** is of the sessions that said goodbye, with
  "unknown" its own number; **visitors** are distinct `vid`, **returning** those seen on more
  than one New York day.
- Everything buckets and labels in `America/New_York`; "Today" is that calendar day.
  *(Amended 2026-10-22: in the viewer's own zone instead, the browser's, which the admin page
  sends as `tz` on every request; the saved queries stay written in New York's, the default
  when a caller names none, and the server makes the zone a parameter. See
  `../admin/2026-10-12-admin-page-design.md` §8.)*
- `session.sql` is the timeline: every row the page sent with its payload (`vid`, `game`,
  `lobby`, `reason`, `result`, `act`, `phase`, `tier`, `fps`, `dur`, `trouble`, `msg`), ordered
  by `timestamp`, over a window around the session's own span; `visitor.sql` is every session
  of one `vid` in order with its lobby and game ids; `match.sql` is every session of one
  `game` side by side. The page shows a visitor's trail: New York wall clock and a Δt column,
  the payload as text, the segments (landing, lobby, loading, match, after), links from a
  lobby to its other members and from a visitor to their other sessions.
