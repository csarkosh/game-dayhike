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
6. **Fingerposts carry one place per plank, each place once per post, on the arm with the shortest trail to it.** The distance to a place by an arm is the junction-to-neighbour edge plus the shortest walk from the neighbour that never crosses back through the junction (Dijkstra over `Math.sqrt` node-to-node lengths); every place reachable that way — "Trailhead", "Summit" and every named pond and meadow — goes on its shortest arm, ties to the arm whose neighbour has the lower node id. The Summit is therefore on every post that can reach it, on its nearest arm. A place at a junction's own node is never named on that junction's post, so a junction on the Summit's own node would carry no Summit plank; none stands there on the 227 sweep seeds. No arm is left bare: an arm that wins no place gets one plank naming the nearest place down it other than the Summit, the only way a name repeats on a post (on any number of such arms). An arm with no such place beyond it — a dead end, or a branch that reaches only the Summit — names the nearest other place a walk from its neighbour finds by way of the junction; only where no other place can be reached at all does it name the Summit, so the Summit points only down its shortest way. On the 227 sweep seeds no arm is a dead end, 33 arms reach only the Summit and take the walk through the junction, and none falls back to the Summit. The Summit's plank is the post's top one; the rest follow nearest first (`SignArm.ranks`). The summit's label is "Summit".
7. **Places are seeded:** every pond and meadow feature gets a name drawn from its own stream (`worldSeed ^ NAMES_SALT`, `NAMES_SALT = 0x504c4143`, distinct from the hiker names' salt) so no existing draw moves; a "<First>'s" name never uses the missing hiker's first name.
8. **The sim keeps boxes for collision** and the drawn models stand on them: the car keeps `CAR_HALF`, the kiosk gets `KIOSK_HALF` (its clearance from the trail bed rises from 1.85 to 2.35 m, 0.5 m more, under the measured worst margin of 0.78 m, so no seed's mirror choice changes and the kiosk's worst margin is 0.28 m), the poster post is dropped and the "Read the poster" interactable moves to the kiosk's poster face; props are looked up by material, never by index. Pass 8's tunables change, so the level id moves: the pinned pass hash is re-baselined with a dated comment.
9. **Sign text is painted on thin planes, one per plank face**, from a 1024 × 192 dynamic texture with a dark carved-looking font, one name to a plank and one texture per place name, shared by every plank naming it, worn so the trail reads as neglected (`labelWear`: faded, uneven ink with one or two fainter letters, flakes, chips and grain-wise scratches knocked out, under 12% of the ink box, all drawn from a generator seeded by the name so every peer sees the same wear), transparent elsewhere; the arm mesh itself is not repainted. Every plank of a post has its own height, in the post's order from the top down, so no two boards cross whichever ways they point: the bottom plank's centre at 1.75 m (its lower edge, 1.648 m, above the 1.6 m eye, since planks have no collider) and a 0.215 m step up to each next. Each plank's post end, a V notch 0.1285 m deep, is pushed 0.092 m past the post's axis, so the notch's apex sits at least 5 mm inside the post's 0.054 m shaft in every direction and no sky shows through it; the notch is deeper than the post is wide, so its two points come out of the far face by up to 0.049 m. The lettering is a 0.76 × 0.1425 m plane centred on the board seen between the post and the arrow's point. The post model is stretched upward per post so its top stands 0.1 m above the highest plank's top edge, never shorter than its natural 2.221 m.
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
- `client/src/sim/signs.ts` — one place per plank, each place once per post on its shortest arm, the Summit on top.
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
- [ ] `signs.ts`: each place on a post once, on the arm with the shortest trail to it, an arm that wins none filled with its nearest place other than the Summit, the planks ordered Summit first then nearest first (`SignArm.ranks`) (Decision 6). Tests: `signs.test.ts` literals on hand-built graphs (the nearer arm, the Summit on top, the filled arm, the dead end, the tie), "Summit".
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

- [ ] `signMeshes.ts`: `sign.post` per post, stretched to stand 0.1 m over its highest plank (never under its 2.221 m); `sign.arm` per plank yawed by `armYaw` (`ARM_LENGTH` becomes the model's 1.095), each plank at its own height in the post's order from the top (`PLANK_BASE` 1.75 m, `PLANK_STEP` 0.215 m); for every plank, two text planes (1.0 × 0.19 m, 1 mm off each face, single-sided so neither reads mirrored) painted by a new transparent-ground painter with its one name on a 1024 × 192 texture. `propMeshes.ts` skips `signpost`; the post box fallback when the model fails.
- [ ] Tests: `signMeshes.test.ts` (instances per post and plank, the plank heights and the post stretch, two planes per plank, one name per painter call, the fallback).
- [ ] Commit `feat: real fingerposts with legible names`.

### Task 6: The last read, the full suite, the browser pass

- [ ] Read the whole branch against this plan; fix what differs. `ARCHITECTURE.md` and `README.md` updated.
- [ ] `npm run typecheck && npm run lint && npm test`; the pre-push scan `0 failing`.
- [ ] Two-page pass on seed `hollow`: the other page's ranger walks and idles with a hat at a believable foot speed (set `RANGER_WALK_CLIP_SPEED`); the Hollow's red eyes at the summit and at fork 37 at twice the player's height; the fingerpost at node 37 reads its two names; the kiosk poster reads the hiker's name and "Read the poster" works from in front of it; the SUV on the road; the body over the pole at the crest. Screenshots archived; a "Measured" section appended to this document.

## Checks on this plan

- No sim change moves an existing RNG draw (names use their own stream; the props and signs draw nothing); the level id moves once, on purpose, and is re-pinned.
- Every model id in the contract is exercised by a test that loads its bytes.
- No collider is ever invisible: every drawer has a fallback.

## Measured

Two-page pass on seed `hollow`, one host and one follower, 2026-09-26. Screenshots in the archive folder named in the plan's tasks.

- **Rangers.** The follower stands on the pad as a hatted ranger, grounded, and plays the walk clip while strafing (host's view). The follower's own page shows the host as a second ranger with the hat. The five bodies are picked by player id: the host draws as the second body, the follower as the third.
- **Trailhead.** The kiosk stands at its site with the notice upright and readable from nine metres ("MISSING / Hugh Kowalski / Last seen on the summit trail."), the SUV parked nose to the pad with the green PARK RANGER stripe on its flank, and "Read the poster" appears from the interact point in front of the kiosk face.
- **Fingerposts.** The post at the first fork carries two arrow boards at 1.8 m reading "Trailhead" and "Old Lake · Summit", legible from three metres.
- **The body.** From fourteen metres below the crest, the missing hiker hangs folded over the pole against the sky, arms toward the arriving player.
- **The Hollow.** After the flip it stands seventeen metres off in the rain as a dark antlered silhouette with a faint eye dot. Under the headlamp at nine metres it fills the view at twice a hiker's height: skull, antlers, ribs, claws, and two glowing eyes. At intensity 4 the eye cores bloom to near white close up and read as a small red dot at range; `HOLLOW_EYE_INTENSITY` and `HOLLOW_EYE_COLOR` are the knobs.
- **Clip speeds.** The walk plays at a believable pace at 5.3 m/s with `RANGER_WALK_CLIP_SPEED` 1.5; a still cannot judge foot sliding, so both clip speeds stay at 1.5 pending play.
- **Sweeps.** The watcher's fifty-seed sweep shows on 875 of 936 stands instead of 881: the kiosk's wider hull blocks six sightlines from the pad. The pass hash moved once with the trailhead props and is re-pinned.
