---
name: github-push
description: Use when pushing work to the game-dayhike GitHub repository at github.com/csarkosh/game-dayhike — "push this", "push it up", "commit and push", "ship it", or any push to origin. Also use before writing a commit message for work that is going to be pushed.
---

# Pushing to GitHub

`github.com/csarkosh/game-dayhike` is a public, open-source repository with no reviewers. CI
runs the tests on a push, which says whether a change works but never why it was made, so the
commit message is the only record of why a change exists. It is written for the person reading `git log` months later with no memory of this
session — usually the author — and anyone on the internet can read it too, so it describes the
change and never anything private about how the work was done.

Remote: `origin` → `git@github.com:csarkosh/game-dayhike.git` (SSH; `gh auth` is configured for it).
Default branch: `main`.

## The commit message

Every commit message is three parts, in this order.

**1. Subject line.** Conventional Commits type, imperative mood, no trailing period, under
72 characters. The types already in this history: `feat`, `fix`, `chore`, `docs`, `refactor`,
`test`.

**2. A `## What` section.** Prose, one short paragraph. What the change is meant to
accomplish — the outcome in the running game or the codebase, stated so it makes sense to
someone who has not seen the diff. This is the part `git log` readers actually read.

**3. A `## How` section.** A list, one entry per meaningful change, **sequenced logically
from beginning to end**. Sequence means the order a reader would trace the change through
the system — entry point first, then what it calls, then what that touches, then tests.
Not alphabetical, not the order `git status` happens to print. Lead each entry with the
file path in backticks.

Full shape:

```
<type>: <subject under 72 chars>

## What

<One paragraph: what this change is meant to accomplish.>

## How

- `path/to/entry-point.ts` — <what this change does>
- `path/to/next-thing.ts` — <what this change does>
- `path/to/thing.test.ts` — <what this covers>
```

### Worked example

The commit that added enemy AI to the simulation:

```
feat: add enemy AI state machine and spawn director

## What

Enemies were inert entities that the world tracked but never moved. They now
hunt: an enemy detects a player in range and line of sight, chases them,
attacks in melee, and leaves a corpse that expires. A director keeps the live
population scaled to the number of players in the session, so a room stays
populated as players join and leave.

## How

- `client/src/sim/world.ts` — steps every enemy each tick, sweeps expired
  corpses, then runs the director. Ordering matters: the director counts live
  enemies, so it must run after deaths are resolved.
- `client/src/sim/ai.ts` — the per-enemy state machine (Idle, Chase, Attack,
  Dead). Movement is synthesized as an input command through `stepMovement`
  rather than reimplemented, so enemies inherit wall sliding and step-up.
  Chase and Attack use range hysteresis to stop state flicker at the boundary.
- `client/src/sim/director.ts` — target population from player count, and
  spawn placement that refuses points too close to a player. Capped attempts
  per tick so a player camping every spawn cannot hang the tick.
- `client/src/app.ts` — adds a `__probe` global exposing enemy counts and
  per-state samples for debugging AI in the browser console.
- `client/test/sim/ai.test.ts` — covers sightlines through real level brushes,
  target acquisition, every state transition, and director population scaling.
```

Note what the `How` entries carry: not "added a function", but what the change does and,
where it is not obvious, why it is that way. The tick-ordering constraint and the
"synthesized input, not a second movement implementation" decision are the two things a
future reader would otherwise have to rediscover from the code.

## One commit per concern

Unrelated work gets its own commit even when it is pushed in the same breath. A tooling
or skill change riding inside a gameplay commit makes the gameplay commit unrevertable
without collateral damage.

## Before pushing

These are the gates:

```bash
npm run typecheck && npm run lint && npm test
```

Run them and read the output. A failing gate is reported to the user before pushing, not
after.

The `test` workflow (`.github/workflows/test.yml`) runs the same commands on GitHub's runners
for every push to `main`, to a `worktree-**` or `ci/**` branch, and for every pull request:
typecheck and lint in one job, the server and tools suites in another, the client suite split
across shards, and a final `gates` job that fails unless every other job passed. `gates` is the
one result to read. What the workflow adds is a clean Linux checkout, and the long client suite
run somewhere other than this machine, which then stays quiet for frame-time measurements.
It is a pass-or-fail check; nothing it times means anything, because the runners are shared
machines. Two things differ from a local run for that reason:

- **Time limits are scaled.** A test's time limit guards against a hang, not a bar on speed.
  Every explicit limit is written `timeLimit(<ms>)` (`client/test/helpers/timeLimit.ts`), which
  multiplies it by `TEST_TIME_SCALE`; unset, locally, the factor is exactly 1. The workflow sets
  2. The architecture test fails on a limit written as a bare number.
- **Wall-clock tests are left out.** A test that asserts on elapsed time carries the
  `wall-clock` tag, and the workflow skips the tag. `npm test` still runs them here;
  `npm run test:wall-clock` runs only them, and they are only meaningful on a quiet machine.
  The architecture test fails on a test that reads a clock without the tag, unless it is on
  its list of tests that print a timing without asserting on it.

A work branch may be pushed to run the gates remotely before it is finished. Then:

```bash
gh run list --branch <branch> --workflow test.yml --limit 3   # the run for the pushed commit
gh run watch <run-id> --exit-status                          # follow it; exits non-zero on failure
gh run view <run-id> --log-failed                            # only the failing steps' output
```

Every push, finished work or not, must pass the repository's pre-push scan first: the
repository is public, so an unfinished commit is as visible as a finished one. The local
pre-push hook runs the scan and refuses the push on a hit; never bypass it with `--no-verify`.

The workflow keeps the Git LFS objects in the Actions cache, keyed on their object ids, so a
run downloads them from LFS only when the set of objects changes (and once more for a branch
whose set `main` has not cached yet).

## Never push a large or binary file into git history

Git history is append-only in practice. A binary committed by accident is still in every
clone forever, and removing it means rewriting history that has already been pushed. This
has already gone wrong once here: `git add -A` swept unrelated in-flight work into three
commits. **Stage explicit paths. Never `git add -A`, never `git add .`.**

Three layers stop this, and the third is the one that actually catches mistakes:

1. **`.gitignore`** — `node_modules/`, build output (`dist/`, `site/`), archives (`.zip`,
   `.7z`, `.rar`, `.tar`, `.tar.gz`, `.tgz`, `.dmg`), and Terraform's local state.
2. **`.gitattributes`** — `.glb`, `.webp`, `.mp3`, `.wasm`, `.png`, `.jpg` and `.ico` are tracked
   through **Git LFS**, so the object database stores a ~130-byte pointer instead of the
   file. That covers every binary under `client/assets/` (models, ground textures, wildlife
   calls), the vendored KTX2 decoder's wasm, and the favicons under `client/public/`.
3. **The check below** — run it before every push. `.gitignore` does not protect against
   `git add -f` or against a file that was already tracked before a rule existed.

```bash
# Anything large or binary about to leave the machine. Empty output means clean.
git rev-list --objects origin/main..HEAD |
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
  awk '$1=="blob" && $3 > 262144 {printf "%8.1f KB  %s\n", $3/1024, $4}' | sort -rn
```

A hit is not automatically wrong — `package-lock.json` is a legitimate ~127 KB of text.
Judge it: **text is fine, binary is not.** A binary in that list means it escaped LFS, so
check `.gitattributes` covers its extension and confirm with:

```bash
git lfs status          # binaries must read "LFS:", never "Git:"
git lfs ls-files        # what LFS is actually tracking
```

If a binary was staged as `Git:`, unstage it, fix `.gitattributes`, and re-add. Once it is
committed and pushed, the fix is `git lfs migrate`, which rewrites history — report that to
the user rather than doing it.

### Git LFS facts worth knowing before adding more assets

- Free/Pro accounts include **10 GiB of LFS storage and 10 GiB of bandwidth per month**;
  Team/Enterprise get 250 GiB of each. Billing is metered — the old pre-paid data packs are
  gone. Bandwidth is charged on *download* (clones, pulls, CI fetches), never on upload.
- Models range from a few KB up to ~3 MB each; every LFS-tracked asset in the repo today
  (models, ground textures, wildlife calls, 77 objects) totals ~61 MiB. Nowhere near either limit.
- **LFS storage counts every version ever pushed and there is no clean per-object delete.**
  Replacing a model's bytes adds a new object permanently. That is a reason to make asset
  updates deliberate, not a reason to avoid updating them.
- `git-lfs` must be installed on any machine that clones, or the working tree gets pointer
  files where the models should be. `brew install git-lfs && git lfs install`.

## Pushing is not shipping

A push, to `main` or to a work branch, puts nothing in front of players: nothing reaches them
until `main` is deployed. Deployment and rollback are the `deploy-production` skill's. The
commit format above is what makes a rollback target identifiable there.
