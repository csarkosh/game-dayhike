# The admin page

**Date:** 2026-10-12
**Status:** Built 2026-10-12.
**Parent:** [`../telemetry/2026-10-12-telemetry-design.md`](../telemetry/2026-10-12-telemetry-design.md),
whose rows this page reads, and [`../signaling/2026-10-12-shared-rooms-design.md`](../signaling/2026-10-12-shared-rooms-design.md),
whose rooms it shows live.

## 0. What this is

A page beside the game, at `/dayhike/admin/`, for whoever runs it: who is playing right now,
and what the telemetry says of the last day, week, month or quarter. It is behind a Google
sign-in and an allowlist of accounts, one today, so a collaborator met at a meetup is an
address added to a list and not a deploy.

The page reads the six saved queries (`tools/telemetry/queries/`) and the open rooms, and
opens any session's timeline in a drawer, which is how an error is read back to its cause.

## 1. The shape

```
browser ──/dayhike/admin/──▶ Firebase Hosting (the page, its own bundle)
   │  sign in with Google through Firebase Auth; the ID token
   ▼
fps-telemetry  GET /admin/live            Firestore: the rooms and instances
               GET /admin/query/<name>    BigQuery: a saved query over the linked dataset
               GET /admin/session/<sid>   BigQuery: one session's rows, and its lobby's
```

**The page** (`client/src/admin/`) is a second Vite entry, `client/admin/index.html`, built
beside the game and sharing nothing with its bundle: the game carries none of the Firebase
library, and the page carries none of Babylon. Plain DOM and SVG, no chart library; the
palette, marks and interaction follow one method (single-hue columns for magnitude, an
ordinal ramp for the funnel, status marks beside words, hairline grids, a hover tooltip on
every bar, a table beneath every chart), selected for light and dark.

**Sign-in** (`client/src/admin/auth.ts`) is Firebase Auth's Google provider in a popup.
Firebase Hosting serves the handler on the site's own host (`/__/auth/`), so the auth domain
is `games.csarko.sh` and no third-party cookie is involved. The build bakes the web app's API
key, which names the project and is not a secret; the allowlist on the server is the guard.

**The routes** (`server/src/admin.ts`) are on the telemetry service, which scales from zero
and holds nothing. Each request carries the ID token as a bearer; the server verifies it
against Google's `securetoken` keys with the project as issuer and audience, and admits a
verified email on the allowlist (`server/src/adminAuth.ts`), which is the service's
`ADMIN_EMAILS` environment variable, set by Terraform from `admin_emails` in the git-ignored
`terraform.tfvars`. No list, no routes. The same origin allowlist and per-address budget as
the batch route apply.

**The queries** are the saved files, read from the image (`server/src/adminQueries.ts`): the
Log Analytics table name becomes the linked dataset's, the line marked `-- range` becomes a
`@days` parameter, and the session query's `'SID'` becomes `@sid`. The files stay what a
person pastes into the console. BigQuery returns its typed values; the server flattens them to
JSON. The live view reads the rooms and the instances from the store the signaling instances
share, so it is right across instances.

**The service account** gains three read-only roles for this: `bigquery.jobUser`,
`logging.viewAccessor` (the linked dataset is a view over the log bucket), and
`datastore.viewer`.

## 2. What the page shows

| Section | Form | Query |
|---|---|---|
| Right now | tiles and a table, refreshed every 10 s | `/admin/live` |
| From landing to the end | the funnel for the latest build; every build in the folded table | `funnel` |
| Lobbies a day | columns; refusals and lost hosts in the subtitle and the table | `lobbies` |
| How far parties got | tiles, a histogram of each match's farthest climb, the latest matches | `progress` |
| What went wrong | a table, grouped, with a representative machine and a session to open | `errors` |
| Load times and frame rates | tiles and the table by build, tier and engine | `health` |
| Where parties went | a density drawing of position samples for one world | `paths` |

A range row above scopes every query to today, 7, 30 or 90 days. Any session id on the page
opens the session drawer: every row the page sent and its lobby's signaling rows, in order,
with an error's message and full stack behind a fold.

`?preview` shows the page over a fixed sample data set with no sign-in, marked by a badge;
`?theme=light|dark` overrides the OS scheme; `?preview&session=<id>` opens a sample drawer.

## 3. Reading an error back to its cause

Four things, built with this page, make a stored error traceable
(`../telemetry/2026-10-12-telemetry-design.md` §8):

- **Source maps.** The build writes hidden source maps; the client deploy keeps them out of
  the site and stores them in the downloads bucket under `sourcemaps/<build sha>/`.
  `node tools/telemetry/symbolicate.mjs <build> stack.txt` rewrites each frame to its source
  file, line and column.
- **A longer stack and finer breadcrumbs.** Two thousand characters of stack, and `where`
  names the step of the start (`start:decide`, `start:engine`, `start:build`) and the
  loading stage in progress (`load:models`, `load:shaders`, ...).
- **The early catch.** An inline script in the page's HTML queues errors before the bundle
  runs and hands them to telemetry once it is up; if the bundle never runs, the script
  beacons the queue itself fifteen seconds in, under a `boot-` session id.
- **The session timeline**, the seventh saved query and the drawer.

## 4. The two steps by hand

*Amended 2026-10-12, after the first sign-in.* The Google sign-in provider needs an OAuth
client, which the Firebase console creates when the provider is switched on and which no API
or Terraform resource creates or edits. After the first apply:

1. Firebase console → Authentication → Sign-in method → Google → Enable → Save. Until then
   the sign-in button answers with Firebase's "operation not allowed".
2. The client that step made lists only Firebase's own hostname as a redirect, and the page
   sends the sign-in to the handler on the site's host. Google Cloud console → APIs &
   Services → Credentials → the OAuth 2.0 client "Web client (auto created by Google
   Service)" → add `https://games.csarko.sh/__/auth/handler` to the authorised redirect
   URIs and `https://games.csarko.sh` to the authorised JavaScript origins → Save. Until
   then Google answers the sign-in with "Error 400: redirect_uri_mismatch". The change can
   take a few minutes to apply.

## 5. Cost

Nothing fixed. Firebase Auth's Google sign-in is free. A query is a BigQuery job over the
range's rows, kilobytes to megabytes against the free TiB a month. The live view is two
Firestore reads every 10 s while the page is open, against the free 50,000 a day; a page left
open all day is about 17,000, so leave it open on one screen, not five.
