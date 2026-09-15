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
| `client/` | The game: `src/{game,net,sim}` (Babylon.js rendering, WebRTC networking, deterministic simulation), `index.html`, `levels/`, `public/` (favicons, in csarko.sh's colours, and the vendored KTX2 decoder), tests under `test/`. |
| `client/assets/` | Shipped models, ground textures and wildlife calls, committed through Git LFS. `client/assets/catalog.json` lists every one; [`CREDITS.md`](CREDITS.md) credits the third-party work. |
| `branding/` | The Day Hike icon (`dayhike.svg`) shown at the top of the README. |
| `server/` | The Node (`ws`) signaling server: introduces peers in a room, then steps out. |
| `desktop/` | Electron launcher (macOS and Windows) that loads the hosted site. |
| `_infra/` | Terraform for hosting, DNS and the signaling service. |
| `docs/` | Research notes, specs, plans and design docs, grouped by subject (`docs/rendering/`, …). Every file is named `YYYY-MM-DD-<topic>.md`; see [Docs](#docs). |
| `tools/` | `deploy/` (deploy and verify scripts), `vendor-ktx2.mjs`, `docs/` (the docs file-name test), and their tests. |
| `.agents/skills/` | Agent skills. `.claude/skills` is a symlink to it so Claude Code discovers them. |
| `.claude/settings.json` | Imports the shared skill plugins from [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general); see [Skills](#skills). |
| `.github/` | CI workflow: the Windows desktop smoke test. |
| `AGENTS.md` | This file. `CLAUDE.md` points here. |
| `README.md` | Human-facing overview of the game. |
| `ARCHITECTURE.md` | The layering, determinism, rendering, asset and hosting details. |
| `CREDITS.md` | Credits for third-party assets, rendered by the in-game Credits screen. |
| `package.json`, `package-lock.json` | npm workspaces root (`client`, `server`); scripts for dev, build, test, lint, typecheck and deploy. |
| `tsconfig.base.json` | Shared TypeScript compiler options extended by `client/` and `server/`. |
| `eslint.config.js` | Flat ESLint config, including the `sim/` layering rule. |
| `firebase.json`, `.firebaserc` | Firebase Hosting config for the client. |
| `.dockerignore` | Build context excludes for the signaling server's Docker image. |
| `.gitattributes` | Git LFS tracking for shipped binaries. |
| `.gitignore` | Build output, local state and worktrees excluded from version control. |

## Docs

Every file committed under `docs/` is named `YYYY-MM-DD-<topic>.md`:

- `YYYY-MM-DD` is the date the doc was written, which is today's date for a new doc. Keep the original date when you revise the doc later.
- `<topic>` is lowercase kebab-case: letters, digits and single hyphens.
- Group docs into a folder by subject, such as `docs/rendering/2026-09-14-stylized-shader-looks.md`.

`tools/docs/test/docNames.test.mjs` fails `npm test` if any file under `docs/` breaks this rule.

## Skills

This repository's own skills, in `.agents/skills/`:

- `deploy-production` — shipping this repository to production: deploying the client to Firebase Hosting and the signaling server to Cloud Run, and verifying what's live matches `main`.
- `github-push` — pushing work to the `game-dayhike` GitHub repository, and writing the commit message before a push.

Shared skills, imported from the [`csarkosh/skills-general`](https://github.com/csarkosh/skills-general) plugin marketplace rather than copied here:

- `general:doc-preview` — opening a repo document (spec, plan, research note, design doc) as a styled page in Chrome on this machine, without publishing it. Claude Code and Codex.
- `general-claude:doc-artifact` — publishing a repo document as a claude.ai Artifact. Claude Code only.

To change a shared skill, change it in `skills-general`, not here. Claude Code reads the import from `.claude/settings.json`; on a machine that has never installed the plugins, run `claude plugin install general@csarkosh` and `claude plugin install general-claude@csarkosh` once. Codex has no per-repository import, so install once per machine with `codex plugin marketplace add csarkosh/skills-general` and `codex plugin add general@csarkosh`.

Read a skill's `SKILL.md` before using it.
