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
| `client/` | The game: `src/{game,net,sim}` (Babylon.js rendering, WebRTC networking, deterministic simulation), `index.html`, `levels/`, `shaders/corpus/` (the recorded shader corpus, below), `public/` (favicons, in csarko.sh's colours, and the vendored KTX2 decoder), tests under `test/`. |
| `client/shaders/corpus/` | The GLSL stages the build translates to WGSL ahead (`tools/wgsl/`), so the WebGPU path finds its shaders on a first visit: one GLSL file a stage, `<h>/<id>.<stage>[.uniformity-off].glsl`, its bytes the stage's exact text and its name a hash of them, so a file edited, reformatted by an editor (a final newline added, whitespace trimmed) or renamed is refused by the tools. Recorded, never written by hand: `tools/wgsl/merge-corpus.mjs` adds the stages of a page recorded with `?wgsl=record` (one JSON download, never committed) and writes `tiers.json`, the index of the quality tiers each stage was recorded on. The ten stages made under Node (`tools/wgsl/node-corpus.mjs`), which no browser asks for, are the tests' fixture in `tools/wgsl/test/fixtures/node-corpus/`, in the same layout, not shipped. The maps the build makes of it, one a tier of the stages recorded on that tier (`dayhike-wgsl-map/2`: each distinct line of WGSL once, each stage as runs of those lines, read back from its file with the page's own reader and compared with every translation before it ships; see `docs/rendering/2026-10-01-wgsl-map-per-tier-design.md`) go to `client/shaders/map/`, not committed. |
| `client/assets/` | Shipped models, ground textures and wildlife calls, committed through Git LFS. `client/assets/catalog.json` lists every one; [`CREDITS.md`](CREDITS.md) credits the third-party work. |
| `branding/` | The Day Hike icon (`dayhike.svg`) shown at the top of the README. |
| `server/` | The Node (`ws`) signaling server: introduces peers in a room, then steps out. |
| `desktop/` | Electron launcher (macOS and Windows) that loads the hosted site. |
| `_infra/` | Terraform for hosting, DNS and the signaling service. One pattern throughout: a root holds the backend, the providers and `module` calls (`main.tf`, `variables.tf`, `outputs.tf`), and the resources are in `_infra/modules/<provider>-<purpose>[-<details>]/` (see [Infrastructure names](#infrastructure-names)) (each with `main.tf`, `variables.tf`, `outputs.tf`, and no backend or provider block). `_infra/`'s own root calls `aws-dns`, `gcp-hosting`, `gcp-signaling` and `gcp-downloads`; each test machine below is a root of its own that calls its one module. |
| `_infra/test-rig-aws-windows/` | Terraform for a rented Windows machine with an NVIDIA GPU on AWS, run only on the days frame times are measured on it. The root a person runs: backend, provider, one call of `_infra/modules/aws-test-rig-windows/` (the resources and the start-up script), `moved.tf` (the addresses from before the resources moved there), the probe for its first run and the tests. Its own state, not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources. |
| `_infra/test-rig-gcp-windows/` | Terraform for a rented Windows machine with an NVIDIA GPU on Google Cloud, run only on the days frame times are measured on it. The root a person runs: backend, providers, one call of `_infra/modules/gcp-test-rig-windows/` (the resources and the start-up script), `moved.tf` (the addresses from before the resources moved there), the probe for its first run and the tests. Its own state, not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources. |
| `_infra/test-rig-scaleway-mac/` | **Incomplete, never applied.** Terraform for Apple silicon Macs rented by the day from Scaleway. The root a person runs: backend, provider, one call of `_infra/modules/scaleway-test-rig-mac/` (the resources, the set-up script and the script that asks Scaleway's API directly), and the probe for its first day. Its README's first section says where it stands, the known gaps and how to pick it up; `plan` refuses to run until `acknowledge_incomplete` is set. Its own state (it holds each Mac's admin password), not called from `_infra/main.tf`: nothing in it can touch `_infra/`'s resources or either Windows machine. |
| `docs/` | Research notes, specs, design docs and verification notes, grouped by subject (`docs/rendering/`, …). Every file is named `YYYY-MM-DD-<topic>.md`; see [Docs](#docs). |
| `tools/` | `deploy/` (deploy and verify scripts), `wgsl/` (the shader corpus translated to the WGSL maps the build ships, one a quality tier, and merged from recorded pages; every tool reads the corpus's files and its index of tiers through `wgsl/lib/corpus.mjs`, which checks each file's name against its bytes and the index against the files; the dev server makes the maps as it starts unless `DAYHIKE_SKIP_WGSL_MAP` is set), `vendor-ktx2.mjs`, `docs/` (the docs file-name test), and their tests. |
| `.agents/skills/` | Agent skills. `.claude/skills` is a symlink to it so Claude Code discovers them. |
| `.claude/settings.json` | Imports the shared skill plugins from [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general); see [Skills](#skills). |
| `.github/` | CI workflows: `test.yml` runs typecheck, lint and the three test suites, and builds the client as the deploy does and checks the built WGSL maps (`tools/wgsl/check-build.mjs`), on every push to `main` and to `worktree-**`/`ci/**` branches and on pull requests, with the client suite's test time limits scaled by `TEST_TIME_SCALE` and the `wall-clock` tests left out (a local `npm test` runs them; `npm run test:wall-clock` runs only them); the Windows desktop smoke test is started by hand. |
| `AGENTS.md` | This file. `CLAUDE.md` points here. |
| `README.md` | Human-facing overview of the game. |
| `ARCHITECTURE.md` | The layering, determinism, rendering, asset and hosting details. |
| `CREDITS.md` | Credits for third-party assets, rendered by the in-game Credits screen. |
| `package.json`, `package-lock.json` | npm workspaces root (`client`, `server`); scripts for dev, build, test, lint, typecheck and deploy. |
| `tsconfig.base.json` | Shared TypeScript compiler options extended by `client/` and `server/`. |
| `eslint.config.js` | Flat ESLint config, including the `sim/` layering rule. |
| `firebase.json`, `.firebaserc` | Firebase Hosting config for the client. |
| `.dockerignore` | Build context excludes for the signaling server's Docker image. |
| `.gitattributes` | Git LFS tracking for shipped binaries; `\n` line endings for text and shader files; the shader corpus marked generated. |
| `.gitignore` | Build output, local state and worktrees excluded from version control. |

## Infrastructure names

Directories of Terraform under `_infra/` are named in one of two formats, by where they are. Both are lowercase, words joined by single hyphens.

**A module, in `_infra/modules/`: `<provider>-<purpose>[-<details>]`.**

- `<provider>` is the cloud provider the resources are made at: `aws`, `gcp`, `scaleway`.
- `<purpose>` is what the resources are for: `dns`, `hosting`, `signaling`, `downloads`, `test-rig`.
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

- `deploy-production` — shipping this repository to production: deploying the client to Firebase Hosting and the signaling server to Cloud Run, and verifying what's live matches `main`.
- `github-push` — pushing work to the `game-dayhike` GitHub repository, and writing the commit message before a push.

Shared skills, imported from the [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general) plugin marketplace rather than copied here:

- `general:doc-preview` — opening a repo document (spec, research note, design doc) as a styled page in Chrome on this machine, without publishing it. Claude Code and Codex.
- `general-claude:doc-artifact` — publishing a repo document as a claude.ai Artifact. Claude Code only.

To change a shared skill, change it in `skills-general`, not here. Claude Code reads the import from `.claude/settings.json`; on a machine that has never installed the plugins, run `claude plugin install general@csarkosh` and `claude plugin install general-claude@csarkosh` once. Codex has no per-repository import, so install once per machine with `codex plugin marketplace add csarkosh/skills-general` and `codex plugin add general@csarkosh`.

Read a skill's `SKILL.md` before using it.
