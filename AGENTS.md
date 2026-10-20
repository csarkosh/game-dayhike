# game-dayhike — working context

Day Hike, a browser-based co-op game for 1–5 players (Babylon.js, TypeScript), played at
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

## Layout

| Path | What |
|---|---|
| `client/` | The game: `src/{game,net,sim}` (Babylon.js rendering, WebRTC networking, deterministic simulation), `index.html`, `levels/`, `admin/` and `src/admin/` (the admin page, served from the shared admin host at `admin.csarko.sh/game-dayhike/` by the csarko.sh repository's `admin/`: a Vite build of its own, `vite.admin.config.ts` → `dist-admin/`, sharing nothing with the game's bundle and importing the host's `/auth.js` token gate and `/theme.css`; `docs/admin/`), `shaders/corpus/` (the recorded shader corpus, below), `public/` (favicons, in csarko.sh's colours, and the vendored KTX2 decoder), tests under `test/`. |
| `client/shaders/corpus/` | The GLSL stages the build translates to WGSL ahead (`tools/wgsl/`), so the WebGPU path finds its shaders on a first visit: one GLSL file a stage, `<h>/<id>.<stage>[.uniformity-off].glsl`, its bytes the stage's exact text and its name a hash of them, so a file edited, reformatted by an editor (a final newline added, whitespace trimmed) or renamed is refused by the tools. Recorded, never written by hand: `tools/wgsl/merge-corpus.mjs` adds the stages of a page recorded with `?wgsl=record` (one JSON download, never committed) and writes `tiers.json`, the index of the quality tiers each stage was recorded on. The ten stages made under Node (`tools/wgsl/node-corpus.mjs`), which no browser asks for, are the tests' fixture in `tools/wgsl/test/fixtures/node-corpus/`, in the same layout, not shipped. The maps the build makes of it, one a tier of the stages recorded on that tier (`dayhike-wgsl-map/2`: each distinct line of WGSL once, each stage as runs of those lines, read back from its file with the page's own reader and compared with every translation before it ships; see `docs/rendering/2026-10-01-wgsl-map-per-tier-design.md`) go to `client/shaders/map/`, not committed. |
| `client/assets/` | Shipped models, ground textures and wildlife calls, committed through Git LFS. `client/assets/catalog.json` lists every one; [`CREDITS.md`](CREDITS.md) credits the third-party work. |
| `branding/` | `previews/`, the stills the README shows (PNG, 1200×675, through Git LFS; not under `docs/`, whose names are dated) and beside each its postcard (`<name>.card.png`: the still on an aged paper border, worn as old mail is, tilted by its name, shadowed, on a transparent ground, which the README lays out at different widths and sides; the trailhead's carries a postage stamp whose picture is the `range` still, the massif's crest from the title's summit shot) and `postcards.png`, the README's title picture: the trailhead's card large over the five others, laid as `collage` in the stills list says. Never shot or drawn by hand: `npm run previews` (`tools/previews/`) makes every still again from the places in `tools/previews/stills.json` and every card from the stills, the stamp's words and picture from `stamp` there, all of it the same bytes for the same stills, so a change to the look is followed by one run (`--base https://games.csarko.sh/dayhike` once the change is live); `npm run previews -- --cards` remakes the postcards alone from the stills on disk. |
| `server/` | The Node (`ws`) signaling server: introduces peers in a room, then steps out. Rooms live in a `Registry`: this process's memory (`REGISTRY=memory`, development's default, one instance only) or Firestore shared by every instance (`REGISTRY=firestore`, production). In its `telemetry` role (`ROLE=telemetry`), the same image takes pages' event batches on `POST /t` and writes one log row an event, and serves the admin page's routes under `/admin/` (and `GET /admin/kpis`, the shared admin host's index card) to the accounts in `ADMIN_EMAILS`, signed in with Google on the admin host's Firebase project `ADMIN_AUTH_PROJECT` (`csarko-sh`, not this one; no accounts, no admin routes); `ROLE` unset, a process serves both roles. |
| `desktop/` | Electron launcher (macOS and Windows) that loads the hosted site. |
| `_infra/` | Terraform for hosting, DNS and the signaling service. One pattern throughout: a root holds the backend, the providers and `module` calls (`main.tf`, `variables.tf`, `outputs.tf`), and the resources are in `_infra/modules/<provider>-<purpose>[-<details>]/` (see [Infrastructure names](#infrastructure-names)) (each with `main.tf`, `variables.tf`, `outputs.tf`, and no backend or provider block). `_infra/`'s own root calls `aws-dns`, `gcp-hosting`, `gcp-signaling` (the service, its image repository and the Firestore database its rooms live in), `gcp-telemetry` (the telemetry service, its log bucket, sink and linked dataset, the admin routes' read roles and the allowlist and sign-in project they check, and an optional budget) and `gcp-downloads`; each test machine below is a root of its own that calls its one module. |
| `_infra/test-rig-aws-windows/` | Terraform for a rented Windows machine with an NVIDIA GPU on AWS, run only on the days frame times are measured on it. The root a person runs: backend, provider, one call of `_infra/modules/aws-test-rig-windows/` (the resources and the start-up script), `moved.tf` (the addresses from before the resources moved there), the probe for its first run and the tests. Its own state, not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources. |
| `_infra/test-rig-gcp-windows/` | Terraform for a rented Windows machine with an NVIDIA GPU on Google Cloud, run only on the days frame times are measured on it. The root a person runs: backend, providers, one call of `_infra/modules/gcp-test-rig-windows/` (the resources and the start-up script), `moved.tf` (the addresses from before the resources moved there), the probe for its first run and the tests. Its own state, not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources. |
| `_infra/test-rig-scaleway-mac/` | **Incomplete, never applied.** Terraform for Apple silicon Macs rented by the day from Scaleway. The root a person runs: backend, provider, one call of `_infra/modules/scaleway-test-rig-mac/` (the resources, the set-up script and the script that asks Scaleway's API directly), and the probe for its first day. Its README's first section says where it stands, the known gaps and how to pick it up; `plan` refuses to run until `acknowledge_incomplete` is set. Its own state (it holds each Mac's admin password), not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources or either Windows machine. |
| `docs/` | Research notes, specs, design docs and verification notes, grouped by subject (`docs/rendering/`, …). Every file is named `YYYY-MM-DD-<topic>.md`; see [Docs](#docs). |
| `tools/` | `deploy/` (deploy and verify scripts; `admin.mjs` builds the admin page and uploads it to the downloads bucket's `admin/latest/` for the csarko.sh repository's `admin/deploy.sh` to publish), `previews/` (`shoot.mjs` shoots the README's stills over Chrome's debugging protocol, each a place in a named world from `stills.json`, the free camera there under the conditions the game starts with and the roster hidden, written to `branding/previews/` at 1200×675 with every PNG chunk but the image dropped; from the dev server by default, `--base https://games.csarko.sh/dayhike` for the live site), `wgsl/` (the shader corpus translated to the WGSL maps the build ships, one a quality tier, on worker threads, and merged from recorded pages; every tool reads the corpus's files and its index of tiers through `wgsl/lib/corpus.mjs`, which checks each file's name against its bytes and the index against the files; the dev server makes the maps as it starts unless `DAYHIKE_SKIP_WGSL_MAP` is set), `telemetry/` (`queries/`, the saved Log Analytics queries the admin page's routes also run, with their README; `symbolicate.mjs`, a telemetry stack read back to source against the build's stored maps), `vendor-ktx2.mjs`, `docs/` (the docs file-name test), and their tests. |
| `.agents/skills/` | Agent skills. `.claude/skills` is a symlink to it so Claude Code discovers them. |
| `.claude/settings.json` | Imports the shared skill plugins from [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general); see [Skills](#skills). |
| `.github/` | CI workflows, **both started by hand only** *(Cyrus, 2026-10-13: no push or pull request starts a run; runner minutes cost time and money)*: `test.yml` runs typecheck, lint and the three test suites, and builds the client as the deploy does and checks the built WGSL maps (`tools/wgsl/check-build.mjs`), with the client suite's test time limits scaled by `TEST_TIME_SCALE` and the `wall-clock` tests left out (a local `npm test` runs them; `npm run test:wall-clock` runs only them); an agent starts it with `gh workflow run test.yml --ref <branch>` when the `github-push` skill says so (a local gate that could not run in full, a change to the build itself, or Cyrus asking). The Windows desktop smoke test is the release script's. |
| `AGENTS.md` | This file. `CLAUDE.md` points here. |
| `README.md` | Human-facing overview of the game. |
| `LICENSE` | GPL-3.0, since 2026-10-13 (the repo had no licence before). `package.json` says `GPL-3.0-only`. |
| `ARCHITECTURE.md` | The layering, determinism, rendering, asset and hosting details. |
| `CREDITS.md` | Credits for third-party assets, rendered by the in-game Credits screen. |
| `package.json`, `package-lock.json` | npm workspaces root (`client`, `server`); scripts for dev, build, test, lint, typecheck and deploy. |
| `tsconfig.base.json` | Shared TypeScript compiler options extended by `client/` and `server/`. |
| `eslint.config.js` | Flat ESLint config, including the `sim/` layering rule. |
| `firebase.json`, `.firebaserc` | Firebase Hosting config for the client, with the 301s from the root to the list of games and from the admin page's old address (`/dayhike/admin/`) to the shared admin host. |
| `.dockerignore` | Build context excludes for the signaling server's Docker image. |
| `.gitattributes` | Git LFS tracking for shipped binaries; `\n` line endings for text and shader files; the shader corpus marked generated. |
| `.gitignore` | Build output, local state and worktrees excluded from version control. |

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

A doc describes the game and how it is built, never how the work on it was organised. Implementation plans, step lists and working notes are not committed: keep them under `.superpowers/`, which is gitignored. A design doc records what was built in its own terms (an "As built" section, or the amendments as they landed), never by pointing at a step of a plan.

## Skills

This repository's own skills, in `.agents/skills/`:

- `deploy-production` — shipping this repository to production: deploying the client to Firebase Hosting and the signaling and telemetry services to Cloud Run, and verifying what's live matches `main`.
- `github-push` — pushing work to the `game-dayhike` GitHub repository, and writing the commit message before a push.

Shared skills, imported from the [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general) plugin marketplace rather than copied here:

- `general:doc-preview` — opening a repo document (spec, research note, design doc) as a styled page in Chrome on this machine, without publishing it. Claude Code and Codex.
- `general-claude:doc-artifact` — publishing a repo document as a claude.ai Artifact. Claude Code only.

To change a shared skill, change it in `skills-general`, not here. Claude Code reads the import from `.claude/settings.json`; on a machine that has never installed the plugins, run `claude plugin install general@csarkosh` and `claude plugin install general-claude@csarkosh` once. Codex has no per-repository import, so install once per machine with `codex plugin marketplace add csarkosh/skills-general` and `codex plugin add general@csarkosh`.

Read a skill's `SKILL.md` before using it.
