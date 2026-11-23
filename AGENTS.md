# game-dayhike — working context

Day Hike, a browser-based co-op game for 1–5 players (Babylon Lite on WebGPU, TypeScript), played at
[games.csarko.sh/dayhike](https://games.csarko.sh/dayhike). A Node signaling server
introduces peers and steps out; the match itself runs peer-to-peer over WebRTC. See
[`README.md`](README.md) for what the game is and [`ARCHITECTURE.md`](ARCHITECTURE.md) for
how it's built.

## Starting development work

Before writing code for a new task, create a fresh git worktree branched from the latest
`origin/main`:

```bash
git fetch origin
git worktree add -b worktree-<name> .claude/worktrees/<name> origin/main
```

- Always branch from freshly fetched `origin/main` — never from the local checkout's HEAD, and never reuse an existing worktree or branch for new work.
- One worktree per task; convention is directory `.claude/worktrees/<name>` on branch `worktree-<name>`.
- The default branch is `main` (there is no `master`).
- `.claude/worktrees/` is gitignored. Skills live in `.agents/skills/`; `.claude/skills` is a symlink to it so Claude Code discovers them.

**Starting graphics work** (shaders, frame times, captures): the
slow steps first, before any code, so they run while the work goes on *(Cyrus, 2026-10-29)*.
`tools/rig/session.sh up <N> [--channel <name>]` makes N rented GPU rigs from their image (about 8
minutes to a Chrome answering on 127.0.0.1:9333, 9334, …) and publishes a preview channel
meanwhile if one is named; it is run with the
owner's go-ahead, since a rig costs $0.715 an hour. `session.sh down` ends the rigs when the work is
done, and a rig ends itself, disk and all, fifteen minutes after the last harness and forward left
it: **everything scales to zero, and idle is free** *(Cyrus, 2026-10-29)*: between sessions the
account holds the rig's image alone, and every service runs at zero instances. Never add a
resource that bills while idle without saying so.

**Load-sensitive work runs in the cloud, never on this Mac** *(Cyrus, 2026-10-31)*: other
workstreams always run on it, so it is never quiet enough for timed work. The client suite (its
time limits), the wall-clock tests, frame times and captures run on GitHub's runners or the rented
rigs; this machine runs only what load cannot fail (lint, the tools suites, a build, the previews
shoot), and anything else only when Cyrus asks for it by name. Before pushing, `npm run gate`
decides: a change confined to tooling, docs or branding is gated here in seconds; any other is
gated by the `test` workflow, which the gate dispatches on the pushed branch (the `github-push`
skill). Never answer a timing failure on this machine by running it again here.

**Large and flat-file output goes on the external SSD**, `/Volumes/CyrusExtSSD/dayhike-lab/`
(`ENGINE_LAB`; the old name `DAYHIKE_LAB` is still read for now), never the MacBook's own disk *(Cyrus, 2026-10-29)*: shader recordings, captures,
renders, frame-time and rig logs, probe output. The rig scripts refuse to run without it; if it is
not mounted, ask. Nothing of the repository lives there: no worktree, symlink or `node_modules`.

## Layout

| Path | What |
|---|---|
| `client/` | The game: `src/{game,net,sim}` (rendering with Babylon Lite on WebGPU, WebRTC networking, deterministic simulation; the WGSL it draws with is in `.wgsl` files under `src/game/shaders/`, a folder to a module, imported where it is used with `?raw` and filled through `shaders/shaderText.ts`: a module holds no static shader text, which the architecture test holds), `index.html`, `levels/`, `admin/` and `src/admin/` (the admin page, served from the shared admin host at `admin.csarko.sh/game-dayhike/` by the csarko.sh repository's `admin/`: a Vite build of its own, `vite.admin.config.ts` → `dist-admin/`, sharing nothing with the game's bundle and importing the host's `/auth.js` token gate and `/theme.css`; `docs/admin/`), `public/` (favicons, in csarko.sh's colours, the vendored KTX2 decoder, and `libs/visits/visits.min.js`, lib-visits' client vendored by `tools/vendor-visits.mjs` from a tag of `~/Projects/lib-visits`: `index.html` loads it and posts to csarko.sh's collector with this origin, so a visit that began on csarko.sh carries on here, and the engine's shell (`src/shell.ts` of the package) reports each route with `visits.page()`; the owner's addresses are dropped at that collector, so his own play is in no journey), tests under `test/`. |
| `client/assets/` | Shipped models, ground textures and wildlife calls, committed through Git LFS. `client/assets/catalog.json` lists every one. The engine's own stand in the package's `assets/`, with their own `catalog.json`. [`CREDITS.md`](CREDITS.md) credits the third-party work that is Day Hike's own; the engine's are credited in the package's `CREDITS.md`, and the Credits screen shows both lists as one. |
| `branding/` | `previews/`, the stills the README shows (PNG, 1200×675, through Git LFS; not under `docs/`, whose names are dated) and beside each its postcard (`<name>.card.png`: the still on an aged paper border, worn as old mail is, tilted by its name, shadowed, on a transparent ground, which the README lays out at different widths and sides; the trailhead's carries a postage stamp whose picture is the `range` still, the massif's crest from the title's summit shot); and `cover/`, the game's cover, the README's title picture and the picture wherever the game is listed: `landscape.png` (1920×1080) and `portrait.png` (1200×1800), each from a still of its own shot at its own size (`<shape>.still.png` beside it: the trailhead towards evening under the game's `mist` weather with the ground cloud held, so neither shape is a crop of the other), graded cold, a fog bank laid where the title sits, and the title and `Trail 14` in the landing page's spaced monospace (the engine's `tools/previews/lib/cover.mjs`). Never shot or drawn by hand: `npm run previews` (the engine's `tools/previews/`) makes every still again from the places in `tools/previews/stills.json` and every card from the stills, the stamp's words and picture from `stamp` there, and the cover's shapes from `cover` there, all of it the same bytes for the same stills, so a change to the look is followed by one run (`--base https://games.csarko.sh/dayhike` once the change is live); `npm run previews -- --cards` remakes the postcards alone from the stills on disk, `npm run previews -- --cover` the cover alone from its stills on disk, and `npm run previews -- cover` shoots the cover's stills again and the cover from them. |
| `server/` | Day Hike's part of the signaling and telemetry server, and nothing else: `game.json` (the game it serves: its admin app id, telemetry dataset and log bucket, the origins allowed where `ALLOWED_ORIGINS` names none, and `queries`, where its saved telemetry queries are, `tools/telemetry/queries/`), `package.json` and the `Dockerfile`. The server's code is the engine's, `@csarkosh/engine-server` (the Node `ws` server: introduces peers in a room, then steps out; in its `telemetry` role takes pages' event batches on `POST /t` and serves the admin routes under `/admin/`), installed from the release named in `server/package.json`; moving to a new release is editing that address and running `npm install`. Its README (`node_modules/@csarkosh/engine-server/README.md`) lists the settings and the environment variables (`PORT`, `ROLE`, `REGISTRY=memory` by default in development and `firestore` in production, `ADMIN_EMAILS`, `ADMIN_AUTH_PROJECT`, `BUILD_SHA` and the rest). `npm run dev:server` runs it with Node's `--watch` from `node_modules`; the image installs it with `npm ci --omit=dev` and copies `game.json` and the queries beside it, with no build. `server/game.json` is held to its values by `tools/deploy/test/serverSettings.test.mjs`. |
| `desktop/` | Electron launcher (macOS and Windows) that loads the hosted site. |
| `_infra/` | Terraform for hosting, DNS and the signaling service. One pattern throughout: a root holds the backend, the providers and `module` calls (`main.tf`, `variables.tf`, `outputs.tf`), and the resources are in `_infra/modules/<provider>-<purpose>[-<details>]/` (see [Infrastructure names](#infrastructure-names)) (each with `main.tf`, `variables.tf`, `outputs.tf`, and no backend or provider block). `_infra/`'s own root calls `aws-dns`, `gcp-hosting`, `gcp-signaling` (the service, its image repository and the Firestore database its rooms live in), `gcp-telemetry` (the telemetry service, its log bucket, sink and linked dataset, the admin routes' read roles and the allowlist and sign-in project they check, and an optional budget) and `gcp-downloads`; each test machine below is a root of its own that calls its one module. |
| `_infra/test-rig-aws-windows/` | Terraform for a rented Windows machine with an NVIDIA GPU on AWS, run only on the days frame times are measured on it. The root a person runs: backend, provider, one call of `_infra/modules/aws-test-rig-windows/` (the resources and the start-up script), `moved.tf` (the addresses from before the resources moved there), the probe for its first run and the tests. Its own state, not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources. |
| `_infra/test-rig-gcp-windows/` | Terraform for a rented Windows machine with an NVIDIA GPU on Google Cloud, run only on the days frame times are measured on it. The root a person runs: backend, providers, one call of `_infra/modules/gcp-test-rig-windows/` (the resources and the start-up script), `moved.tf` (the addresses from before the resources moved there), the probe for its first run and the tests. Its own state, not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources. |
| `_infra/test-rig-scaleway-mac/` | **Incomplete, never applied.** Terraform for Apple silicon Macs rented by the day from Scaleway. The root a person runs: backend, provider, one call of `_infra/modules/scaleway-test-rig-mac/` (the resources, the set-up script and the script that asks Scaleway's API directly), and the probe for its first day. Its README's first section says where it stands, the known gaps and how to pick it up; `plan` refuses to run until `acknowledge_incomplete` is set. Its own state (it holds each Mac's admin password), not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources or either Windows machine. |
| `docs/` | Research notes, specs, design docs and verification notes, grouped by subject (`docs/rendering/`, …). Every file is named `YYYY-MM-DD-<topic>.md`; see [Docs](#docs). |
| `tools/` | `deploy/` (deploy and verify scripts, and `site.rules.json`, the site's redirects, rewrites and headers for `/dayhike` and the root; `deploy:client` and the preview channels publish with the engine's `tools/site`, never `firebase deploy`; `admin.mjs` builds the admin page and uploads it to the downloads bucket's `admin/latest/` for the csarko.sh repository's `admin/deploy.sh` to publish), `frame-budget/` and `previews/` (Day Hike's own lists the engine's scripts read: `frame-budget/views.json` and `budgets.json`, `previews/stills.json`), `telemetry/` (`queries/`, the saved Log Analytics queries the admin page's routes also run, with their README; `symbolicate.mjs`, a telemetry stack read back to source against the build's stored maps), `rig/session.sh` (a graphics session's rigs: `up` makes them from the image, `status`, `down` ends them), `vite/` (`engineTypes.test.mjs`, which holds that the client's `tsconfig.json` includes the installed engine's `env.d.ts`), `vendor-visits.mjs` (lib-visits' client, above), `docs/` (the docs file-name test), and their tests. |
| `.agents/skills/` | Agent skills. `.claude/skills` is a symlink to it so Claude Code discovers them. |
| `.claude/settings.json` | Imports the shared skill plugins from [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general); see [Skills](#skills). |
| `.github/` | CI workflows, **both started by hand only** *(Cyrus, 2026-10-13: no push or pull request starts a run; runner minutes cost time and money)*: `test.yml` runs typecheck, lint and the test suites, and builds the client as the deploy does, with the client suite's test time limits scaled by `TEST_TIME_SCALE` and the `wall-clock` tests left out (a local `npm test` runs them; `npm run test:wall-clock` runs only them); `npm run gate` dispatches it on the pushed branch for every change outside tooling, docs and branding, and follows it (the `github-push` skill), and an agent starts it by hand with `gh workflow run test.yml --ref <branch>` when Cyrus asks. The Windows desktop smoke test is the release script's. |
| `AGENTS.md` | This file. `CLAUDE.md` points here. |
| `README.md` | Human-facing overview of the game. |
| `LICENSE` | GPL-3.0, since 2026-10-13 (the repo had no licence before). `package.json` says `GPL-3.0-only`. |
| `ARCHITECTURE.md` | The layering, determinism, rendering, asset and hosting details. |
| `CREDITS.md` | Credits for Day Hike's own third-party assets, rendered by the in-game Credits screen beside the engine's (`client/src/game/hikeCredits.ts`). |
| `package.json`, `package-lock.json` | npm workspaces root (`client`, `server`; the engine is a dependency of the client and its server of `server/`, in the lockfile with its release's hash); scripts for dev, build, test, lint, typecheck and deploy. |
| `tsconfig.base.json` | Shared TypeScript compiler options extended by `client/`. |
| `eslint.config.js` | Flat ESLint config, including the `sim/` layering rule. |
| `.dockerignore` | Build context excludes for the signaling server's Docker image. |
| `.gitattributes` | Git LFS tracking for shipped binaries; `\n` line endings for text and shader files. |
| `.gitignore` | Build output, local state and worktrees excluded from version control. |

The engine is its own repository, `csarkosh/engine` (checked out beside this one at `~/Projects/engine` when working on both), and Day Hike installs it as a release's tarball: `client/package.json` names the address under `https://github.com/csarkosh/engine/releases/`, and the package's modules are imported as `@csarkosh/engine/<path>`. Moving to a new engine version is editing that address and running `npm install` (commit the lockfile). The engine's scripts (the push gate, previews, frame-budget, compare) run from the installed package's `node_modules/@csarkosh/engine/tools`, through the root `package.json`'s scripts, and read `ENGINE_GATE` and `ENGINE_LAB`. To try an engine change here before it is released, pack it there (`npm pack`) and install the tarball by path (`npm install ../engine/csarkosh-engine-<version>.tgz -w client`), and never commit that: the committed address is always a release's. The engine's own tests, the empty game and the Rust field kernel stand in its repository.

## Hosting

`games.csarko.sh` is one Firebase Hosting site (`fps-csarko`) that several games share. This repository owns `/dayhike` and the site's root: the redirect page, favicon and `robots.txt` at `/` (`tools/deploy/lib/site.mjs`), the root's redirects and the catch-all `**` rewrite, all in `tools/deploy/site.rules.json`. `robots.txt` names the game's sitemap, `/dayhike/sitemap.xml`, which the deploy writes from the site URL. There is deliberately no `/sitemap.xml`: csarko.sh's admin judges every visited path of a host against that file, so one naming only the game would report each party and game route, and every other game's page, as a 404. A game that wants its own sitemap adds a `Sitemap:` line to `robots.txt` here. Other games own their own paths (Cape Sorrow, `/capesorrow`, from its own repository). Every game deploys with the engine's `tools/site` (`node_modules/@csarkosh/engine/tools/site/deploy.mjs`), which clones the live version and replaces only what its deploy owns, and refuses to release if another game's file would change; `npm run deploy:client` and `npm run preview:channel` run it with this repository's arguments (`tools/deploy/lib/siteDeploy.mjs`). **Nobody runs `firebase deploy` on this site**: a Firebase deploy replaces the whole site, and every other game with it. There is no `firebase.json` here for that reason.

## Infrastructure names

Directories of Terraform under `_infra/` are named in one of two formats, by where they are. Both are lowercase, words joined by single hyphens.

**A module, in `_infra/modules/`: `<provider>-<purpose>[-<details>]`.**

- `<provider>` is the cloud provider the resources are made at: `aws`, `gcp`, `scaleway`.
- `<purpose>` is what the resources are for: `dns`, `hosting`, `auth`, `signaling`, `telemetry`, `downloads`, `test-rig`.
- `<details>` is optional and comes last: whatever tells two modules of one provider and purpose apart. For a test machine it is the operating system it runs: `windows`, `mac`, or `windows-mac` for one that holds both.

So `aws-dns`, `gcp-hosting`, `aws-test-rig-windows`, `gcp-test-rig-windows`, `scaleway-test-rig-mac`.

**A root of its own, in `_infra/` beside the main root: `<purpose>-<provider>[-<details>]`.** The purpose comes first, so that the roots of one purpose sort together and apart from `modules/`; the provider and the details are the module's. So `test-rig-aws-windows` (calls `modules/aws-test-rig-windows`), `test-rig-gcp-windows`, `test-rig-scaleway-mac`.

A directory's name is not its state's address. Renaming a directory changes no resource; changing a backend's `prefix`, a resource's name or a `module` call's name does, so leave those as they are when a directory is renamed.

## Docs

Every file committed under `docs/` is named `YYYY-MM-DD-<topic>.md`:

- `YYYY-MM-DD` is the date the doc was written, which is today's date for a new doc. Keep the original date when you revise the doc later.
- `<topic>` is lowercase kebab-case: letters, digits and single hyphens.
- Group docs into a folder by subject, such as `docs/rendering/2026-09-14-stylized-shader-looks.md`.

`tools/docs/test/docNames.test.mjs` fails `npm test` if any file under `docs/` breaks this rule.

A doc describes the game and how it is built, never how the work on it was organised. Implementation plans, step lists and working notes are not committed: keep them under `docs/superpowers/` (research, `plans/`, `specs/`, and the agents' `brainstorm/` and `sdd/` runs), which its own `.gitignore` keeps out of the repository and the file-name test skips. A design doc records what was built in its own terms (an "As built" section, or the amendments as they landed), never by pointing at a step of a plan.

## Skills

This repository's own skills, in `.agents/skills/`:

- `deploy-production` — shipping this repository to production: deploying the client to Firebase Hosting and the signaling and telemetry services to Cloud Run, and verifying what's live matches `main`.
- `github-push` — pushing work to the `game-dayhike` GitHub repository, and writing the commit message before a push.

Shared skills, imported from the [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general) plugin marketplace rather than copied here:

- `general:doc-preview` — opening a repo document (spec, research note, design doc) as a styled page in Chrome on this machine, without publishing it. Claude Code and Codex.
- `general-claude:doc-artifact` — publishing a repo document as a claude.ai Artifact. Claude Code only.

To change a shared skill, change it in `skills-general`, not here. Claude Code reads the import from `.claude/settings.json`; on a machine that has never installed the plugins, run `claude plugin install general@csarkosh` and `claude plugin install general-claude@csarkosh` once. Codex has no per-repository import, so install once per machine with `codex plugin marketplace add csarkosh/skills-general` and `codex plugin add general@csarkosh`.

Read a skill's `SKILL.md` before using it.
