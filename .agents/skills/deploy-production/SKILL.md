---
name: deploy-production
description: Use when shipping this repository to production — "deploy", "deploy to prod", "push it live", "ship this to production", "release", or verifying that what is live matches main. Covers the signaling server on Cloud Run and the client on Firebase Hosting.
---

# Deploying to production

The game is live at **https://games.csarko.sh/dayhike**. Two independent things run there:

| Piece | Where | What ships it |
| --- | --- | --- |
| Client (`client/dist`) | Firebase Hosting, free CDN | `npm run deploy:client` |
| Signaling server (`server/`) | Cloud Run `fps-signaling`, `us-west1`, scales from zero; rooms in Firestore | `npm run deploy:server` |
| Telemetry service (the same image, `ROLE=telemetry`), with the admin routes | Cloud Run `fps-telemetry`, `us-west1`, scales from zero | `npm run deploy:server` (both services, one image) |
| The admin page (`client/admin/`) | Firebase Hosting, at `/dayhike/admin/`, built with the client | `npm run deploy:client` |

`npm run deploy` runs the server then the client. `npm run deploy:verify` checks the
result from outside — the live site, every deployed model and ground texture, the
signaling server's WebSocket handshake, the telemetry service taking a batch, every saved
telemetry query dry-run on BigQuery, and the desktop release manifest — against the real
public URLs. `node tools/telemetry/check-queries.mjs` is that dry run alone, for a change to
a query before it ships: Log Analytics' editor accepts names BigQuery's parser refuses.

Deploys are local scripts by choice. There is no CI, so **the gates below are the only
thing standing between a mistake and production.**

## The domain move (2026-09)

The site is `games.csarko.sh` with the game under `/dayhike`; `game.csarko.sh` is a
second custom domain on the same Firebase site and serves only the redirect page that
`tools/deploy/client.mjs` writes to the site root. The root itself, `games.csarko.sh/`,
is a 301 to the list of games at `https://csarko.sh/games` (`firebase.json` `redirects`,
2026-10-08); every other path outside `/dayhike` gets the redirect page, which sends
`game.csarko.sh` links on to the game and anything else to that list. Both domains are Terraform-managed
(`module.gcp_hosting` has `this` and `legacy`; `module.aws_dns` and `module.aws_dns_legacy`).

Adding a custom domain is a two-step apply: the certificate cannot issue until the CNAME
exists, and the CNAME target is an output of the domain. `wait_dns_verification = false`
lets the first apply finish; issuance completes minutes to hours later. Check with
`terraform output hosting_required_dns_updates` (empty once reconciled) or the Firebase
console. **Do not deploy the client to the new path until the certificate is ACTIVE** —
until then games.csarko.sh answers with a certificate error and the redirect from the
old host sends players into it.

## The sequence

```bash
git fetch origin && git status -sb    # 1. be on main, synced, clean
npm run typecheck && npm run lint && npm test
npm run deploy                        # 2. server first, then client
npm run deploy:verify                 # 3. prove it from outside
```

Every step earns its place:

**1. Commit first.** The image is tagged with the current commit so a Cloud Run revision
traces back to a source state, and the same tag is baked into the image and the client
build, so every telemetry row names the build on each side; the client's source maps are
stored under that tag in the downloads bucket (`sourcemaps/<sha>/`), which is what
`tools/telemetry/symbolicate.mjs` reads a stack against. A dirty tree tags
`<sha>-dirty`, which is how an untested local change announces itself. Never deploy a
dirty tree to production — commit, or stash.

Rebasing after building an image orphans that tag. If you rebase between deploying and
pushing, the revision points at a SHA no longer in history; redeploy or say so.

**2. `deploy` covers both halves, and they are independent.** Shipping only one is a
legitimate choice when only one changed — a server-only fix does not need the client
rebuilt. What is *not* legitimate is assuming which changed. Check the diff.

**3. Verify is not optional.** A client change can break production without any test
failing: nothing in the suite runs Babylon or loads a real bundle. `deploy:verify` catches
a bundle built without the signaling URL, an LFS pointer shipped in place of a model, and
a signaling server that answers HTTP but refuses a real WebSocket join.

## What the scripts need, and what they no longer need

The scripts read twelve values describing production: project, the two Cloud Run
services and their URLs, Artifact Registry path, Firebase site, public site URL,
`legacy_domain_name`, the downloads bucket and its URL, and the Firebase web API key the
admin page signs in with (`web_api_key`, not a secret).

They come from `tools/deploy/production.json`, which is **committed**, with Terraform
outputs taking precedence when its state is reachable. This matters for concurrent
sessions: **you can deploy from any worktree, and a deploy never depends on the
infrastructure tooling working.** If `tfOutput` warns that Terraform and the file
disagree, the infrastructure moved: update the file.

> This split exists because the original local state was lost. It was created inside a git
> worktree and deleted along with it when that branch merged — production untouched and
> healthy, Terraform with no record it existed, and no deploy possible. State now lives in
> the versioned bucket `gs://fps-csarko-tfstate`, so `terraform init` works from any
> checkout and the loss is recoverable. Shipping code no longer depends on any of that.

You still need, locally:

- **Docker running**, and the image built `--platform linux/amd64`. The script passes it.
  Cloud Run will not run an arm64 image, and Apple Silicon builds arm64 by default — the
  failure shows up as a container that will not start, far from its cause.
- **`gcloud` authenticated**, with the active project set to `fps-csarko`. The script
  refuses to run when the active project differs, because a deploy that targets the wrong
  project fails in ways that look like success.
- **Git LFS materialized.** The `.glb` models under `client/assets/models/` are LFS
  objects. Unfetched, the working tree holds ~130-byte pointer files, `vite build` hashes
  and emits those into `dist` exactly as if they were models, and the game silently falls
  back to capsules with no error anywhere. `deploy:verify` finds each model's hashed URL in
  the deployed bundle and checks the bytes behind it start with the ASCII magic `glTF`; the
  fix is `git lfs install && git lfs pull`.

## Things that will surprise you

**A deploy deletes every revision it supersedes, on purpose.** Cloud Run *drains*
WebSockets across a revision swap rather than closing them, so an old revision keeps
serving its established sockets. When the rooms lived in process memory that meant a
second, disjoint room registry per revision, and two rooms could share one id for up to an
hour. The rooms are in Firestore now, shared across revisions, so a drained revision is
only untidy; `tools/deploy/lib/revisions.mjs` still deletes the superseded revisions once
the new one is healthy: their instances seat their peers out on SIGTERM, every peer
reconnects onto the one revision serving traffic, and a returning host reclaims its room
from the store.

This means **a deploy briefly interrupts signaling for anyone connected**. That is
deliberate and it is safe: the match itself runs peer-to-peer over WebRTC data channels, so
a dropped signaling socket is not fatal — the client reconnects signaling in the background
and a returning host reclaims its room within its grace window. Do not "fix" this by keeping
old revisions around; keeping them is the bug.

**The health path is `/healthcheck`, never `/healthz`.** On `*.run.app`, Google's frontend
intercepts that exact literal and answers it itself; the request never reaches the
container. The Cloud Run startup probe still passes, because it hits the container directly
and bypasses the public edge — so the revision goes healthy and serves traffic while every
external check reads a response the container never wrote. Renaming it back looks like
tidying and costs a debugging session.

**The admin page's sign-in has two steps by hand, once.** Terraform creates Firebase Auth and
the web app, but the Google sign-in provider needs an OAuth client that only the Firebase
console creates: Authentication → Sign-in method → Google → Enable → Save. That client then
needs the site's handler as a redirect, which only the Google Cloud console edits: APIs &
Services → Credentials → "Web client (auto created by Google Service)" → add
`https://games.csarko.sh/__/auth/handler` to the redirect URIs and `https://games.csarko.sh`
to the JavaScript origins → Save; without it Google answers "redirect_uri_mismatch". The
accounts that may read the page are `admin_emails` in the git-ignored `terraform.tfvars`; an
empty list serves no admin routes. Both steps are done (2026-10-12).

**Terraform owns the service's shape; the deploy script owns only the image tag.** Never
change Cloud Run settings with `gcloud`. If you do touch Terraform, a container-field
change is validated against the *currently live* image, so `terraform apply` must be
followed immediately by `npm run deploy:server` — the failed intermediate revision is
expected, not a rollback signal.

**`max_instance_count` is a cost ceiling** (`signaling_max_instances`, 3 by default), now
that rooms live in Firestore. It must be 1 only under `REGISTRY=memory`, which production
does not run.

## Rolling back

**Not by routing traffic.** A deploy deletes superseded revisions, so the revision you
would roll back to no longer exists — `update-traffic --to-revisions` has nothing to point
at. Roll back by redeploying an older **image**, which Artifact Registry keeps tagged by
commit:

```bash
gcloud artifacts docker tags list \
  us-west1-docker.pkg.dev/fps-csarko/signaling/signaling --project fps-csarko
gcloud run deploy fps-signaling --region us-west1 --project fps-csarko \
  --image us-west1-docker.pkg.dev/fps-csarko/signaling/signaling:<commit-sha>
```

No rebuild — the image already exists — so this costs a rollout, not a build. A `-dirty`
suffix on a tag means that image was built from an uncommitted tree; prefer a clean sha.

The registry's cleanup policies **KEEP the 10 most recent versions**, which is the real
bound on how far back you can roll. If you need to go further, rebuild from the commit.

Follow up by getting `main` back to a good state — a rolled-back service that nobody fixes
is one deploy away from undoing the rollback.

The client has no CLI rollback — there is no `firebase hosting:rollback`, whatever it
sounds like there should be. Two real options:

- **The console.** Hosting → Release history → the three-dot menu on a prior release →
  Rollback. Fastest, and the one to reach for when the site is broken right now.
- **Rebuild the old commit.** `git checkout <good-sha> -- .` (or check out the commit),
  then `npm run deploy:client`. Slower, but it leaves the working tree and the deployed
  bytes agreeing with each other.

`firebase hosting:disable` also exists and takes the site down to a placeholder. That is
for "this must not be public right now", not for rollback.

## After deploying

Report what actually shipped: the revision name, the commit, and the `deploy:verify`
result. If a check failed, say which one and what it means — never report a deploy as done
on the strength of the scripts exiting zero.

A client deploy is also the desktop update: the shell loads the site, so installed desktop
apps pick up the new client on their next launch.

The Windows CI smoke now loads the client over the network from Firebase on a GPU-less
runner; on the first release after the thin launcher a timeout there is more likely a slow
first load than an artifact defect — the script's single automatic re-dispatch is the net.
