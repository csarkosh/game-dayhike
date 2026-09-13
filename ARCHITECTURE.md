# Architecture

## Layers

`client/src` has three layers with one direction of dependency, `game/ → net/ → sim/`:

- **`sim/`** — the deterministic simulation: movement, collision, interact, AI, and the seeded world (terrain, forest, clutter, trails). Pure TypeScript with no Babylon, no DOM and no wall-clock reads. ESLint forbids `sim/` importing Babylon, `net/` or `game/`, and `client/test/architecture.test.ts` names any file that does.
- **`net/`** — the versioned binary protocol, the WebRTC transport, and the host and client sessions. The host is authoritative; clients predict their own input and reconcile against host snapshots.
- **`game/`** — Babylon.js: the scene, meshes, materials and shaders, camera, HUD, audio and input sampling. It reads `sim/` state and never writes it except through input commands. Ambient wildlife placement lives here rather than in `sim/`: it is cosmetic, so peers need not agree on it byte-for-byte.

`server/` is the signaling server (Node, `ws`): it introduces peers in a room and steps out. `desktop/` is an Electron launcher that loads the hosted site.

## Determinism

The simulation runs at a fixed 60 Hz from a seeded RNG. The world is derived from the level id and seed alone, so every peer builds the same world locally and nothing about it crosses the wire. A test serializes two runs of the world from identical inputs and asserts they match; client prediction depends on it.

## Rendering

The world streams around the camera in rings: full geometry near, cheaper levels of detail further out, and a far field beyond. Quality tiers (`low`, `medium`, `high`, `client/src/game/quality.ts`) set hardware scaling, shadow map sizes and LOD bias; the tier is auto-detected from the device's CPU core count, memory and whether it looks like a mobile browser.

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
