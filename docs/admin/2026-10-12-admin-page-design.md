# The admin page

**Date:** 2026-10-12
**Status:** Built 2026-10-12. Moved to the shared admin host the same day: §6 amends §0, §1
and §4, which stand as the page was first built.
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
| Where parties went | the trail rebuilt from the seed, each session's path over it, marks and a scrubber (telemetry doc §9) | `paths` |

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

## 6. Moved to the shared admin host (amended 2026-10-12)

*Cyrus approved the csarko.sh admin dashboard design on 2026-10-12
(`csarko.sh/docs/superpowers/specs/2026-10-12-admin-dashboard-design.md`, Parts 2.1, 2.3,
2.6 and 2.8): one host, https://admin.csarko.sh, for every app's dashboard, behind one
sign-in. This page is now that host's `/game-dayhike/`. What changed here:*

**The page is a build of its own, for another host.** `client/vite.admin.config.ts` builds
`admin/index.html` alone, under `base: "/game-dayhike/"`, to `client/dist-admin/` (the game's
build no longer has the admin entry; the dev server still serves it at `/dayhike/admin/`).
`npm run deploy:admin` (`tools/deploy/admin.mjs`) builds it, uploads the folder without its
source maps to `gs://fps-csarko-downloads/admin/latest/` (the maps go under
`sourcemaps/<build sha>/` with the game's), and runs the csarko.sh repository's
`admin/deploy.sh` when that checkout is at `~/Projects/csarko.sh`, which pulls the folder
into the host and publishes it. The old address, `/dayhike/admin/`, 301s to the new one
(`firebase.json`), and `deploy:verify` checks that redirect and that `/admin/live` and
`/admin/kpis` answer 401 to a request with no sign-in.

**Access is the host's sign-in: the same Google sign-in and allowlist as before, on another
project.** *(Amended 2026-10-13: the sign-in moved with the page to the admin host, Google
through Firebase Auth on the csarko.sh project, `csarko-sh`, so one sign-in opens every
app's page.)* The host
serves `/auth.js` at its root: `requireSession(root, onReady)` rendering the "Sign in with
Google" gate and calling `onReady({ email })`, `fetchWithAuth` sending a fresh ID token as
the bearer and dispatching `admin:unauthorized` (detail `{ email }`) on a 401, `user()` and
`signOut()`. The page imports that module (`client/src/admin/auth.ts` re-exports it; the
build leaves it external and the dev server proxies it to the shell's preview on
`localhost:8788`), so the `firebase` dependency is gone from this repository: the header
shows the signed-in email and a "Sign out", and on `admin:unauthorized` the shell's gate
comes back with "<email> is not on the list." and a Sign out, while the page only stops its
live refresh. On the server (`server/src/adminAuth.ts`) the check is what §2 described,
`jose` verifying the ID token against Google's `securetoken` keys and the allowlist, with one
change: the issuer and audience are `ADMIN_AUTH_PROJECT`, the admin host's project
(`csarko-sh`), not this service's, since that is where the account signs in; a token this
project issued is refused. `ADMIN_EMAILS` is the allowlist as before, and no list serves no
routes. Both are the service's environment from Terraform (`admin_emails` in the git-ignored
`terraform.tfvars`, `admin_auth_project` defaulting to `csarko-sh`,
`_infra/modules/gcp-telemetry`); nothing here uses Secret Manager. The `gcp-auth` module,
the Firebase Auth config and the web app are removed all the same: the sign-in lives in the
csarko.sh repository now, and this page was their only consumer here.
`DEFAULT_ALLOWED_ORIGINS` gained `https://admin.csarko.sh` and `http://localhost:8788`, so
the routes' CORS, which reads the same list, admits the host.

**The page is a csarko.sh page.** `admin/index.html` loads the host's `/theme.css` before
its own stylesheet, and `admin.css` names no colour of its own any more: every token it had
(`--page`, `--ink`, `--series`, the ordinal ramp, `--good`, `--serious`, `--critical`,
`--de`, the grid, ring and shadow) is one of the site's tokens (`--bg`, `--surface`,
`--surface-2`, `--text`, `--muted`, `--faint`, `--accent`, `--accent-hover`, `--warning`)
or a `color-mix()` of them, so the page follows the site in both schemes. The palette has no
red, so the error states are steps from the warning yellow toward the text, and the word
beside each mark says which. Inter and JetBrains Mono come from the host. `?preview` and
`?theme=` work as before; `?theme=` sets `data-theme` on the root for the host's stylesheet
to read.

**The index card.** `GET /admin/kpis` is new, for the host's front page: `{ app, at, kpis,
health }` with four `{ key, label, value, prev, unit, trend }` entries (sessions and matches
started over the last 7 days against the 7 before, the clean share of sessions that ended, and
lobbies open now from the live view) and a health reading. One saved query, `kpis.sql`, answers
it: one row an ISO week over twelve weeks (the sparklines) and one each for the two windows;
`server/src/adminKpis.ts` shapes the rows. Health is critical when the share of sessions that
hit an error more than doubled week over week and is above 5%, a warning when it rose, good
otherwise, with the numbers in the note. The query is a saved query like the others
(`/admin/query/kpis` serves its rows too), so the deploy's dry run covers it; its range line
reads 84 days when pasted, and the server's rewrite now takes whatever days a range line says.
