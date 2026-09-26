# Summit Meshes Implementation Plan

**Goal:** Every placeholder shape the game still draws becomes a real model: the other hikers become park rangers, the Hollow becomes the antlered thing it was always meant to be with two red eyes, the body at the crest becomes the missing hiker draped over a dead trunk, the trailhead gets a ranger SUV and a roofed notice board, and the fork fingerposts get a real post, real arrow boards and text you can read that names where each branch leads. The poster post at the trailhead and the sandbox chaser models are removed.

**Architecture:** The models arrive in `client/assets/catalog.json` with the eleven ids below, committed through LFS with their credits in `CREDITS.md`, and the game code changes in `client/src/game/` (how each is drawn) and in a few `client/src/sim/` places (the trailhead props and the poster interactable, the fingerpost names, seeded place names). The sim stays deterministic and trig-free. Protocol 5 is unchanged; the level id moves on purpose (Decision 8).

**The model contract** (what the game may assume of each id; every output is `models/<id>.glb`, flat, because the URL glob is flat):

| Id | Kind | Origin, size, facing | Clips / roots |
|---|---|---|---|
| `ranger.nathan`, `ranger.eric`, `ranger.sophia`, `ranger.carla`, `ranger.claudia` | character | feet at the origin, 1.7–1.9 m tall, faces +Z | `idle`, `walk`, `attack`, `death`; the walk is in place |
| `hollow.antlered` | character | feet at the origin, 1.80 m tall (player height; the game scales it), faces +Z; its eye material is the one whose emissive factor is non-zero | `idle`, `walk`, `attack`, `death`; the walk is in place |
| `summit.body` | environment | pole base at the origin, about 4.3 m tall on a 4.0 m pole, the hiker's front faces +Z | static, `LOD0`–`LOD2` roots |
| `trailhead.car` | environment | footprint centre at the origin on the ground, 4.36 long (+Z forward) × 1.88 wide × 1.70 tall | static, `LOD0`–`LOD2` roots |
| `trailhead.kiosk` | prop | footprint centre at the origin, 2.2 wide × 2.5 tall × 1.1 deep, the poster faces +Z; the poster's material is the one with no base colour texture, and its primitive's UVs span 0–1 across the 2 × 1 m board (u from the left edge seen from +Z); the file's v runs top-down as glTF has it; the game flips it for its painter, whose canvas uploads its top row at v = 1; only the board's front face carries it | static, `LOD0`–`LOD2` roots |
| `sign.post` | prop | base at the origin, 2.21 m tall, 0.13 m square | static, `LOD0`–`LOD2` roots |
| `sign.arm` | prop | post end at the origin, 1.095 m long along +Z (arrow tip at +Z), 0.204 m tall, 0.038 m thick, faces normal ±X | static, `LOD0`–`LOD2` roots |

## Decisions

1. **Remote players are drawn from a fixed list of the five `ranger.*` ids**, indexed by `id % 5` (not catalog order) so every peer sees the same ranger for the same player. The local player stays first-person and bodiless as today. The remote lamp sits at feet + `PLAYER_HALF.y` + `PLAYER_EYE_OFFSET` (the model's node is at the feet, the capsule's was at the hull centre).
2. **Sprint reuses the walk clip:** a ranger plays `walk` when the horizontal length of the snapshot's `vel` exceeds 0.3 m/s, else `idle`; the walk's speed ratio is that speed ÷ `RANGER_WALK_CLIP_SPEED` (1.5 m/s to start, measured on the first browser pass), clamped to [0.5, 2.5]. There is no crouch in the sim, so nothing to draw for it.
3. **The Hollow is drawn at `HOLLOW_SCALE = 2` times its 1.80 m model** (twice the player), a knob in `hollowLook.ts` that may go to 3; its hull, its stare and its contact are unchanged, so only the picture grows. Its node sits at `pos.y − ENEMY_HALF.y`.
4. **The Hollow's clip follows its measured speed in every state** (it walks during Emerge too): node displacement ÷ frame time, one frame counting for at most 10 m/s (`HOLLOW_MAX_MEASURED_SPEED`, so a teleport or a stalled frame cannot spike it), smoothed over 0.25 s, `walk` above 0.3 m/s with ratio speed ÷ (`HOLLOW_WALK_CLIP_SPEED` × `HOLLOW_SCALE`), else `idle`. Its eye material gets `HOLLOW_EYE_COLOR` at `HOLLOW_EYE_INTENSITY`; the rest of the model keeps its own maps and takes the atmosphere like every other lit surface. `HOLLOW_ALBEDO` and the fog-off rule now apply only to the capsule fallback, which remains for a missing model with today's material.
5. **Once-placed models load then place**, safe if disposed before the load finishes, and fall back to today's shape when the load fails (the box for the car and the kiosk, the capsule for a player or the Hollow, the three boxes for the body) so no collider is ever invisible. Every static drawer enables `LOD0` only.
6. **Fingerposts name the two nearest places beyond each arm**, ordered by trail distance (Dijkstra over `Math.sqrt` node-to-node lengths from the neighbour, the junction excluded; ties by lower node id), instead of everything reachable; "Trailhead" is a candidate like any other, so a loop's fork reads the loop's place on both arms. The summit's label becomes "Summit".
7. **Places are seeded:** every pond and meadow feature gets a name drawn from its own stream (`worldSeed ^ NAMES_SALT`, `NAMES_SALT = 0x504c4143`, distinct from the hiker names' salt) so no existing draw moves; a "<First>'s" name never uses the missing hiker's first name.
8. **The sim keeps boxes for collision** and the drawn models stand on them: the car keeps `CAR_HALF`, the kiosk gets `KIOSK_HALF` (its clearance from the trail bed rises from 1.85 to 2.35 m, 0.5 m more, under the measured worst margin of 0.78 m, so no seed's mirror choice changes and the kiosk's worst margin is 0.28 m), the poster post is dropped and the "Read the poster" interactable moves to the kiosk's poster face; props are looked up by material, never by index. Pass 8's tunables change, so the level id moves: the pinned pass hash is re-baselined with a dated comment.
9. **Sign text is painted on thin planes, one per arm face**, from a 1024 × 192 dynamic texture with a dark carved-looking font sized to fit two names, transparent elsewhere; the arm mesh itself is not repainted. Arms sit at a 1.8 m base (the lowest board's bottom edge above the 1.6 m eye, since arms have no collider); an arm within 30° of a lower one steps up 0.21 m, capped at one step so the raised board stays under the 2.221 m post top; a rare third near-parallel arm shares the raised height.
10. **The body at the crest is the model:** `createBodyMesh` places `summit.body` at the register's body position and yaw.
11. **The chaser path goes:** `enemy.grunt` and `enemy.skeleton` leave the catalog, the credits and the deploy tooling; `enemyModel.ts` becomes the general character pool; the violet `enemy_<id>` fallback is deleted; the sim's dormant director is untouched (population 0, a later cleanup).

## Global Constraints

- Worktree `.claude/worktrees/the-meshes` on `worktree-the-meshes`. Stage explicit paths; never `git add -A`; never a bare `git stash`.
- `sim/` imports no `net/`, `game/` or Babylon; no trig, `Math.pow`, `**` or `Math.hypot` (`Math.sqrt` only); every draw goes through `nextRandom(state)`. `client/test/architecture.test.ts` enforces it.
- Every numeric expectation in a test is a literal. Tests run with real `NullEngine` scenes, which cannot paint: text tests assert the injected painter's arguments. Model-loading tests read the catalog GLB bytes from `client/assets/models/` through a byte-loader seam like `cliffMeshes.test.ts` uses.
- Commit format: `<type>: <subject>` under 72 characters, a `## What` paragraph, a `## How` list with backticked paths, entry point first, and the two trailers the repository's commit convention requires.
- Gates before a push: `npm run typecheck && npm run lint && npm test` (re-run a failing file alone with `--maxWorkers=2`; zero assertion failures is the bar) and the repository's pre-push scan printing `0 failing`. Push and deploy only when asked.

## File structure

- `client/src/sim/passes/trailhead.ts` — `PROPS` loses the poster post; materials `car` and `kiosk`; `KIOSK_HALF`; tunables renamed.
- `client/src/sim/world.ts`, `client/src/sim/register.ts` — props found by material; the poster interactable on the kiosk face.
- `client/src/sim/signs.ts` — distance-ordered names, two per arm.
- `client/src/sim/placeNames.ts` — new: seeded names for pond and meadow features.
- `client/src/app.ts` — the sign sites (summit plus every named feature); board lookup by material; the body and trailhead views.
- `client/src/game/characterModel.ts` — renamed from `enemyModel.ts`: a pool keyed by asset id, `setSpeed(ratio)` on the instance, a byte-loader seam.
- `client/src/game/entityViews.ts` — rangers and the Hollow from the pool; the eye tell; the lamp height; the fallbacks.
- `client/src/game/hollowLook.ts` — gains `HOLLOW_SCALE`, `HOLLOW_EYE_COLOR`, `HOLLOW_EYE_INTENSITY`, `HOLLOW_WALK_CLIP_SPEED`.
- `client/src/game/trailheadMeshes.ts` — new: the car and the kiosk placed once from their sites, the poster painted on the kiosk.
- `client/src/game/bodyMesh.ts` — the model.
- `client/src/game/signMeshes.ts` — post and arm models, a transparent text painter, no board.
- `client/src/game/propMeshes.ts` — `PROP_DRAWN_ELSEWHERE` gains `car`, `kiosk`, `signpost`.
- `client/src/game/renderer.ts`, `creatureModel.ts` — the pool's new name.
- `tools/deploy/lib/buildClient.mjs`, `tools/deploy/verify.mjs` — the sampled models become `ranger.nathan` and `hollow.antlered`; `clutter.fungus_b` stays.
- `ARCHITECTURE.md` (kinds gain `environment`; the character pool; the hue band retired in favour of the red-eye convention), `README.md` (what a missing model falls back to).
- `client/assets/catalog.json`, `client/assets/models/*.glb`, `CREDITS.md` — the models.
- Tests beside each module under `client/test/sim/`, `client/test/game/`, `tools/deploy/test/`.

### Task 1: The sim: trailhead props, the poster, place names, sign names

- [ ] `trailhead.ts`: remove the `POST_*` prop and tunables; the board's material `pillar` → `kiosk` with `KIOSK_HALF = { x: 1.1, y: 1.25, z: 0.55 }` at the same site; the car's `crate` → `car`, `CAR_HALF` unchanged; tunables become `CAR_HALF_*`, `KIOSK_HALF_*`, `CAR_ROAD_U/Z`, `SIGN_ROAD_U/Z`; the `PROBE_CHUNKS` comment in `forest.ts` updated. `world.ts` and `app.ts` find props by material; `register.ts`'s poster box moves to kiosk site + facing × (`KIOSK_HALF.z` + 0.05) at ground + 1.4 m, its doc and `BOX_HEIGHT` updated. `sandbox01.json` and `MATERIAL_COLORS` keep `crate`/`pillar`.
- [ ] Tests: `trailhead.test.ts` (two props, materials, boxes, the 227-seed sweep still passes), `registerSweep.test.ts` (sites by material), a `register.test.ts` case where `resolveInteract` finds the poster from a player in front of it, `groundGradient.test.ts` re-pinned with a dated comment.
- [ ] The features come from `graph.features`, which the trail graph already carries (the same list `bowlFor(seed).features` returns); `placeNames` takes only the ponds and meadows.
- [ ] `placeNames.ts`: `placeNames(worldSeed, features, hikerFirstName): Map<featureId, string>` — ponds from `["Old Lake", "Mirror Pond", "Still Lake", "Black Tarn", "Hidden Lake", "<First>'s Pond"]`, meadows from `["High Meadow", "Bear Meadow", "Long Meadow", "Fern Meadow", "Deer Meadow", "<First>'s Meadow"]`, first names from `hikerNames.ts` excluding the hiker's, no name used twice, drawn from a private state seeded `worldSeed ^ NAMES_SALT`. Test: literal names for `hollow` and one other seed; the world's `rngSeed` is unchanged by naming.
- [ ] `signs.ts`: each arm's `names` are the two nearest sites by trail distance beyond that arm (Decision 6). Tests: on a graph with a loop both fork arms name the loop's place; `signs.test.ts` literals (two names, "Summit").
- [ ] `app.ts`: sites = "Summit" at the body plus every named feature at its centre.
- [ ] Scoped suite green; commit `feat: seed place names and trim the fingerposts to two names`.

### Task 2: The models land

- [ ] Commit the catalog, the eleven GLBs (LFS) and `CREDITS.md` as they arrive: `assets: ship the summit models`. `catalogModels.test.ts` and `credits.test.ts` pass; `git lfs status` reads `LFS:` for every model. `tools/deploy/lib/buildClient.mjs` and `tools/deploy/verify.mjs` sample `ranger.nathan` and `hollow.antlered` instead of the removed ids, their tests updated.

### Task 3: Rangers and the Hollow

- [ ] `characterModel.ts` (from `enemyModel.ts`): `createCharacterPool(source, loader)` with `load(scene, assetIds)`, `has(assetId)`, `acquire(key, assetId)`, `release(key)`, `dispose()`; instances expose `play(role)` and `setSpeed(ratio)`; clip lookup by the catalog's `animations` map; the orientation wrapper kept; `creatureModel.ts` and `renderer.ts` follow the rename. Pool keys are entity ids, which players and enemies never share.
- [ ] `entityViews.ts`: remote players acquire their ranger (Decision 1) at `pos.y − PLAYER_HALF.y`, `rotation.y = yaw`, idle/walk and ratio from `vel` (Decision 2), lamp at the new height; Hollows acquire `hollow.antlered` at `pos.y − ENEMY_HALF.y` scaled by `HOLLOW_SCALE`, clip and ratio from measured displacement (Decision 4), the eye material coloured. Delete the `enemy_<id>` fallback and `mat_enemy`; keep the capsule fallbacks.
- [ ] Tests: `characterModel.test.ts` (real GLB bytes through the seam: acquire, clip names, `setSpeed`, release), `enemyOrientation.test.ts` renamed, `entityViews.test.ts` (a ranger for a remote player and not the local one; walk vs idle at 0.3 m/s; the lamp height literal; the Hollow's eye material, scaling 2, walk ratio; both fallbacks), `hollowLook.test.ts` literals.
- [ ] Commit `feat: draw rangers and the antlered Hollow`.

### Task 4: The trailhead and the body

- [ ] `trailheadMeshes.ts`: `createTrailheadMeshes(scene, sites, groundH, deps)` places `trailhead.car` at its site with yaw 0 or π (axis-aligned like its hull) and `trailhead.kiosk` facing the board's `facing`, load-then-place with the box fallback (Decision 5), `LOD0` only; the poster mesh's material is replaced by a painted material with the board lines at 1024 × 512. `propMeshes.ts` skips `car` and `kiosk`; the board plane leaves `signMeshes.ts` (`createSignMeshes` loses `board`).
- [ ] `bodyMesh.ts`: `summit.body` at `body.pos`, `rotation.y = body.yaw`, `LOD0` only, the three boxes as the fallback; `bodyMesh.test.ts` rewritten.
- [ ] Tests: `trailheadMeshes.test.ts` (positions, the poster material swap, the fallback), `propMeshes.test.ts` rewritten against `sandbox01` (the trailhead window may now hold no box-drawn prop).
- [ ] Commit `feat: park the ranger SUV and raise the kiosk and the body`.

### Task 5: Fingerposts you can read

- [ ] `signMeshes.ts`: `sign.post` per post, `sign.arm` per arm at `ARM_ABOVE_GROUND` 1.8 m yawed by `armYaw` (`ARM_LENGTH` becomes the model's 1.095), an arm within 30° of a lower one raised one 0.21 m step (at most one); for every arm, two text planes (1.0 × 0.19 m, 1 mm off each face, single-sided so neither reads mirrored) painted by a new transparent-ground painter from `arm.names.join(" · ")` on a 1024 × 192 texture. `propMeshes.ts` skips `signpost`; the post box fallback when the model fails.
- [ ] Tests: `signMeshes.test.ts` (instances per post and arm, two planes per arm, the painter's arguments, the fallback).
- [ ] Commit `feat: real fingerposts with legible names`.

### Task 6: The last read, the full suite, the browser pass

- [ ] Read the whole branch against this plan; fix what differs. `ARCHITECTURE.md` and `README.md` updated.
- [ ] `npm run typecheck && npm run lint && npm test`; the pre-push scan `0 failing`.
- [ ] Two-page pass on seed `hollow`: the other page's ranger walks and idles with a hat at a believable foot speed (set `RANGER_WALK_CLIP_SPEED`); the Hollow's red eyes at the summit and at fork 37 at twice the player's height; the fingerpost at node 37 reads its two names; the kiosk poster reads the hiker's name and "Read the poster" works from in front of it; the SUV on the road; the body over the pole at the crest. Screenshots archived; a "Measured" section appended to this document.

## Checks on this plan

- No sim change moves an existing RNG draw (names use their own stream; the props and signs draw nothing); the level id moves once, on purpose, and is re-pinned.
- Every model id in the contract is exercised by a test that loads its bytes.
- No collider is ever invisible: every drawer has a fallback.
