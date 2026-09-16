# Architecture

## Layers

`client/src` has three layers with one direction of dependency, `game/ → net/ → sim/`:

- **`sim/`** — the deterministic simulation: movement, collision, interact, AI, and the seeded world (terrain, forest, clutter, trails). Pure TypeScript with no Babylon, no DOM and no wall-clock reads. ESLint forbids `sim/` importing Babylon, `net/` or `game/`, and `client/test/architecture.test.ts` names any file that does.
- **`net/`** — the versioned binary protocol, the WebRTC transport, and the host and client sessions. The host is authoritative; clients predict their own input and reconcile against host snapshots.
- **`game/`** — Babylon.js: the scene, meshes, materials and shaders, camera, HUD, audio and input sampling. It reads `sim/` state and never writes it except through input commands. Ambient wildlife placement lives here rather than in `sim/`: it is cosmetic, so peers need not agree on it byte-for-byte.

`server/` is the signaling server (Node, `ws`): it introduces peers in a room and steps out. `desktop/` is an Electron launcher that loads the hosted site.

## Determinism

The simulation runs at a fixed 60 Hz from a seeded RNG. The world is derived from the level id and seed alone, so every peer builds the same world locally and nothing about it crosses the wire. A test serializes two runs of the world from identical inputs and asserts they match; client prediction depends on it. The trail bench's sink and width and the litter class are part of the level id through their tunables, so a client on an older build cannot join a newer host.

The register (`client/src/sim/register.ts`) follows the same split. The missing hikers' sites and names, the sign posts at the trail's forks and the wall at the road's edge are all derived from the seed and the trail graph on every peer; the items, who carries what, the sign-out hold and the match outcome are host state that rides every snapshot (protocol 4), and the wall clamps inside the movement step so a client predicts it exactly. That graph is built by `client/src/sim/trailBuild.ts` on the shared routing plumbing in `client/src/sim/trailPlan.ts` — a stem from the pad to the crest with its seeded loops, and below the crest a web of parallel strands cross-linked by rungs (`client/src/sim/trailBraid.ts`) — and carries its junctions and every node's trail distance home as `forks` and `homeDist`.

The Hollow (`client/src/sim/hollow.ts`) is one `EnemyState` with three `AiState` values — Crawl, Hunt and Merge — so the snapshot's existing enemy channel carries it unchanged, no new wire shape needed. Its rules and the routes it walks (`client/src/sim/trailRoute.ts`) run host-only, inside the same authoritative tick as everything else in `sim/`. Each player's stare at it rides the snapshot as one byte. Death, on every level, is permanent: there is no respawn.

## Rendering

The world streams around the camera in rings: full geometry near, cheaper levels of detail further out, and a far field beyond. Quality tiers (`low`, `medium`, `high`, `client/src/game/quality.ts`) set hardware scaling, shadow map sizes and LOD bias; the tier is auto-detected from the device's CPU core count, memory and whether it looks like a mobile browser.

The look is an identity layer over PBR: a material plugin (`client/src/game/atmosphere.ts`) replaces Babylon's fog with height fog, a distance gradient and sun inscatter. On the high tier only, the chain runs `scene` (a full-resolution pass the halation extract reads from) → halation extract and blur → `grade` (AgX tone map, per-hour white point, a night Purkinje shift, the split-tone grade, vignette, halation) → chromatic aberration and FXAA passes built directly (there is no `DefaultRenderingPipeline`) → `finish` (peripheral overlap, luminance grain, dither); medium drops the halation chain and starts at `grade`. Every value is a uniform computed by the pure `*Params.ts` modules from the weather, the hour and `/unsettle`; the low tier has no passes and carries the same intent through Babylon's in-material image processing. Airborne motes (`motes.ts`) follow the sun's altitude and the wind. One wind field (`client/src/game/windParams.ts`) moves the ground cover, the crowns, the motes, the mist and the rain, and swells the ambient wind bed; the foliage plugin (`foliagePlugin.ts`) also tints every card to the ground it stands on from a per-instance attribute the clutter rebuild writes. The grass floor is hex-tiled from the 2 m grass texture (`groundHexParams.ts`, `shaders/groundHex.fragment.fx`), gains a finer normal and a between-blades occlusion near the eye, and carries a lush-to-dry macro tint the tufts share. The trail is a footpath sunk into the sim's ground (`sim/trail.ts`), painted per fragment from a two-row segment table as four bands that wander with the lattice noise, wear along their length and go wet with the weather (`trailPaint.ts`, `trailBenchParams.ts`), with litter along its margin and the grass beside it trampled at rebuild.

## Assets

- `client/assets/models/*.glb`, `client/assets/textures/*.webp` and `client/assets/audio/*.mp3` are committed through Git LFS.
- `client/assets/catalog.json` has three lists: `assets` (models — `id`, `kind` of `character`, `creature` or `prop`, `output`, and for animated models an `animations` map from the role the game asks for (`idle`, `walk`, `attack`, `death`, `graze`, `run`, `alert`) to the clip name in the file), `textures` (ground layers — `id`, `output`), and `audio` (wildlife calls — `id`, `output`).
- Assets are imported with Vite `?url` globs (`client/src/game/assetUrls.ts`), so production URLs are content-hashed and cached as immutable. A catalog `output` with no file behind it throws at startup rather than 404ing into a missing mesh.
- `CREDITS.md` credits third-party work; `client/src/game/credits.ts` parses it for the in-game Credits screen.

### Model conventions

What the game assumes of every model file:

- Units are metres; the origin is at the model's feet (or base), and forward is +Z.
- Models streamed by distance have `LOD0`, `LOD1` and `LOD2` root nodes, each holding that level's meshes; the game finds them by those names.
- Clip names are the ones the catalog's `animations` map gives.
- Hue 280–340 is reserved for enemies, so they never camouflage against the world.

## Hosting

The site is on Firebase Hosting at `games.csarko.sh/dayhike`; the signaling server is a single Cloud Run instance, because rooms live in its memory. Terraform in `_infra/` owns both, plus DNS. `tools/deploy/` builds and ships them and verifies production independently.

## Testing

Vitest runs three roots — `client`, `server`, `tools` — all headless. Babylon code is tested under `NullEngine`; `client/test/game/catalogModels.test.ts` loads every catalog model and checks its clips and LOD roots.
