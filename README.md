<p align="center">
  <img src="./branding/dayhike.svg" alt="Day Hike" width="128" />
</p>

<h1 align="center">Day Hike</h1>

<p align="center">
  <em>A mild morning; an easy trail;
  <br>and the peculiar conviction that the woods were counting us.</em>
</p>

<br>

One hiker is missing, last seen on the summit trail, and the poster at the trailhead is the whole briefing.

Play as a park ranger sent to find them. Lead a search party of up to five up the trail to the crest, where the hiker is waiting — and so is whatever left them there. Then get everyone back down to the road.

Somewhere past the last strip of flagging tape the birds go quiet, and the light goes with them. The climb is watched, and only watched: something stands off the trail at the edge of sight, closer each time you look, and it costs you only if you keep looking. The descent is not a feeling: something comes down off the crest behind you, faster than you walk and slower than you can run, and it does not lose the trail. The road is the only ground it will not cross.

**Play it: [games.csarko.sh/dayhike](https://games.csarko.sh/dayhike)**

---

## Under the hood

Three layers, one direction of dependency: `game/ → net/ → sim/`.

```
game/   Babylon.js — scene, meshes, camera, HUD, input sampling
net/    Binary protocol, WebRTC transport, host & client sessions
sim/    Movement, collision, interact, AI, and the seeded world — pure functions, zero dependencies
```

The load-bearing rule is that **`sim/` never imports Babylon** — enforced by both ESLint and a test that names the offending file. That one constraint buys headless netcode tests, deterministic replay, and a future Node-hosted authority for free.

Everything else follows from it: a fixed 60 Hz simulation with a seeded RNG and no wall-clock reads, so replaying identical inputs yields bit-identical results. Prediction only works if that's true, so a test serializes two runs of the world and asserts they match.

**Solo play is a host with zero peers.** No offline mode, no second code path.

More in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Assets

Models, ground textures and wildlife calls live under `client/assets/` and are committed through Git LFS. `client/assets/catalog.json` lists every one of them, and [`CREDITS.md`](CREDITS.md) credits the third-party work, which the in-game Credits screen renders. If a model is missing the game draws a stand-in and still runs: a capsule for a hiker or the Hollow, a plain box for the car, the kiosk and a sign post, a timber cross for the body at the crest.

## Stack

TypeScript (strict) · Babylon.js 9 · Vite 8 · Vitest 4 · WebRTC · `ws`

## Run it

```bash
npm install     # Node >= 22.13
git lfs install # required: models are LFS objects
npm run dev     # signaling server + Vite, together
```

Then open http://localhost:5173. Press **F3** or **`** in game for the netgraph — frame rate, RTT, snapshot rate, bandwidth, unacknowledged inputs, and a prediction-error meter that turns red when reconciliation starts correcting more than the eye can miss.

Add `?net=lat:200,jitter:50,loss:10` to a URL to play that tab over a deliberately bad connection.

```bash
npm test          # headless — determinism, movement, collision, codecs, netcode, models
npm run lint
npm run typecheck
```

> **Without `git-lfs`** the model files clone as text pointers, and every model silently falls back to its stand-in: capsules for the hikers and the Hollow, plain boxes at the trailhead and the sign posts.

## Where it lives

[games.csarko.sh/dayhike](https://games.csarko.sh/dayhike), at no fixed monthly cost — which is the same promise as *no server bill*, kept. Two origins, because putting both behind one would mean a load balancer, and GCP bills ~$18/month per project for a forwarding rule whether traffic flows through it or not:

```
games.csarko.sh/dayhike   Firebase Hosting — free global CDN, free managed cert
wss://…run.app/ws         Cloud Run — scales to zero, 60-minute request cap
```

`game.csarko.sh` redirects there, path and all, so old links still work.

The signaling server is pinned to **one instance**. That is correctness, not thrift: rooms live in the signaling process's memory, so a second instance would split a room in half and its peers would never find each other. One instance holds 250 sockets — 50 full games — and the match itself is peer-to-peer anyway, so the ceiling that matters is not this one.

Cloud Run closes every socket it holds after 60 minutes, on every scale-down, and on every deploy. A match survives all three: the data channels are untouched, the client reconnects signaling in the background, and a host that comes back within a minute reclaims its room without the other players seeing anything.

```bash
npm run deploy         # server image, then client built against its live URL
npm run deploy:verify  # independent proof against production, not against the deploy's exit code
```

Infrastructure is Terraform in [`_infra/`](_infra/) — Artifact Registry and Cloud Run, the Firebase Hosting site and its custom domain, and the Route53 CNAME. State is local and gitignored; `npm run infra:check` formats and validates it.

A desktop build for macOS and Windows lives in [`desktop/`](desktop/): a thin launcher that loads the site.

## Out of scope

Host migration, TURN relay, navmesh pathfinding, anti-cheat, PvP, lobby browser, persistence, mobile input, physics props.
