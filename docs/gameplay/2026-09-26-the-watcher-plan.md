# The Watcher (S2) Implementation Plan

**Goal:** Give the climb its stalker. One Hollow that stands off the trail at the edge of sight, closer with every sighting as the party climbs, never moves, never touches, and hides when you look away or come close. The stare drains while you look at it: the climb's danger is your own curiosity. It is removed for good when the body is found; the summit Hollow is a separate spawn.

**Architecture:** Host-only, off the wire. A new `sim/watcher.ts` owns the watcher's record (whether it is shown, the rest between showings, its own random stream) and its three rules: who the lead is, where it may stand, and when it hides. `sim/hollow.ts` gains `AiState.Watch` as a Hollow state that stands and faces the lead, is seen and stared at like any Hollow, but is never prey-driven and never touches. `world.ts` runs the watcher each Climb tick before the Hollows move; `summit.ts` removes it on the flip. Peers receive it as an enemy in the snapshot they already get, drawn by the entity views as the shipped Hollow shape; nothing new crosses the wire.

**Spec:** `docs/gameplay/2026-09-16-the-summit.md` §4 (the watcher), §5.1 (the stare and the look test), §6 and §7 (the lens reads it as a Hollow; the wire carries its state byte), §10 (verification). What S1 and S3 shipped for it: `hollow.ts` (`playerSees`, `HOLLOW_LOOK_COS`, `HOLLOW_LOOK_RANGE`, the stare in `updateHollows`, `faceToward`, `hollowsOf`, `isHollowState`), `trailRoute.ts` (`stemProgress`), `trail.ts` (`trailDistance`, `TrailGraph.forks`), `spawn.ts` (`groundSpawn`: a hull position on the ground, or null in water or inside a prop; it samples the terrain with the forest's seed and needs the terrain variant active), `ground.ts` (`normalAt(x, z, out)`), `ai.ts` (`hasLineOfSight(from, to, boxes, ground)`), `view.ts` (`aimDirection`, the one place the sim may use sine and cosine), `containment.ts`.

**Measured on the seed `hollow` before the build:** `stemProgress` is 1 at the pad and 0 at the crest (`trailRoute.ts` returns `1 − arc/total`; §6 and the escalation take `1 − stemProgress`), so the plan works in **climb** = `1 − stemProgress`. The stem has 39 nodes, crest node 36. Forks `[2, 22, 37, 78, 79]` stand at climb 0.1093, 0.6239, 0.7510, 0.3246, 0.3221: the top fork is 37 at 0.7510. The stem nodes nearest climb 0, 0.25, 0.5 and 0.75 are 0, 6, 18 and 37. Per-try admission of a placement (200 tries each, the lead facing up the stem / across it): pad 11 / 2 of 200 (the corridor and the sightline reject most), node 6 3 / 67, node 18 17 / 48, the top fork 147 (the sightline rejects 53). The sightline is the dominant rejection everywhere (35–85 %), the corridor at the pad.

## Decisions that amend or sharpen the spec (the last task writes them into the spec)

- **The lead and the reach are measured in climb.** `climbOf(graph, x, z) = 1 − stemProgress(graph, x, z)`; the lead is the living player with the greatest climb (ties to the lower id); the top fork's climb is the greatest climb over `graph.forks` (1 when the graph has no fork); the reach is the lead's climb over the top fork's, clamped to [0, 1]. This is what §4 and §6 mean by "progress"; the spec's word is kept and defined.
- **The watcher draws from its own random stream, not the world's.** S3's guide is drawn from the world RNG on the flip tick, and its shape on a seed is pinned in tests and in the spec's measurements. Nothing on a forest climb draws from the world RNG today; a watcher that did would move the guide by however many ticks the climb took. The watcher's record carries its own seed, `worldSeed ^ WATCH_SALT`, stepped with `nextRandom` on that record. It is host truth anyway; no client ever draws it. §7's determinism paragraph is amended to say so.
- **"In view" for the hide rule is a wide cone, not the stare cone.** The spec places the watcher 30°–70° off the lead's look direction, outside the 20° cone the stare uses, so `playerSees` is false at the moment it shows and it would hide on its first tick. The camera's field of view is 1.4 rad tall (about 112° across at a wide screen). The watcher hides on the first tick no living player has it within `WATCH_VIEW_COS` (cos 80°, 0.1736) of their aim, within `HOLLOW_LOOK_RANGE`, with a clear sightline; `playerSees` (20°) still decides the stare. On a straight climb it hides through the flee radius, a trunk crossing the sightline, or its bearing passing 80° as the lead walks abeam; a sighting you never centre never costs you. A lead aiming steeply down can fail the wide test on the tick after a showing and never see it: accepted. A lead standing safe on the pad is stalked like anyone (§4 excludes nobody; the stare kills on safe ground as S1 ruled).
- **The bearing is drawn without trigonometry.** The look direction is `aimDirection(yaw, 0)` = `(sin yaw, cos yaw)` on the XZ plane. `R(look, c, s, side) = (x·c − side·z·s, side·x·s + z·c)` rotates by the angle whose cosine and sine are `c, s`; with `side = +1` it turns to the lead's left (`R((0, 1), 30°, +1) = (−0.5, 0.866) = aimDirection(−30°)`). The two band edges use constants (cos 30° 0.866, sin 30° 0.5; cos 70° 0.342, sin 70° 0.9397); the drawn bearing is the normalised mix `(1 − u)·R30 + u·R70` for a draw `u`. The two edge vectors are 40° apart, so every mix is a chord of the minor arc with length at least cos 20°, never zero, and normalising lands inside the band for every `u`. The rounded constants make `R30`'s length 0.99998, so a test bounds the cosine at 0.8661, not 0.866. Not uniform in angle, which nothing needs; rejection sampling a 40° wedge would waste most draws.
- **Walkable ground is what a hull can stand on.** A placement is `groundSpawn(world.boxes, world.forest.seed, x, z, ENEMY_HALF)` (not in water, not inside a prop) with the ground's normal `y ≥ WATCH_SLOPE_NY` (0.74, the same 0.9 gradient the trail treats as hard; `normalAt` writes into an out vector), and off the road corridor (safe ground is never stalked from). `WATCH_TRAIL_CLEAR` is measured to the trail's centreline (`trailDistance`), so 6 m stands just inside the 7 m cleared strip.
- **The first rest.** The spec draws a rest only on hide. The record's first rest is drawn when the record is made from the same band, so the watcher does not show on tick one.
- **The lead is re-read every tick** for the facing and for the show placement; a dead lead is simply no longer the lead. No draw is spent on a tick with no living player.
- **Every showing spends an entity id.** The summit and fork Hollows' ids then depend on how many showings the climb had; nothing pinned in S3's tests is an id (they pin nodes, edges and `rngSeed`), and the whole run holds with the id sequence shifted by one and by two. Id parity picks a stuck Hollow's sidestep side; that is allowed to vary.
- **The watcher counts as a Hollow everywhere a Hollow is read**: the lens's nearness, the renderer's nearest-Hollow reading, and the wildlife's quiet within `HOLLOW_QUIET`. Intended: the woods go quiet when it shows.

## Global Constraints

- Work in the worktree `.claude/worktrees/the-watcher` on `worktree-the-watcher`, branched from `origin/main` at eec09fd. Stage explicit paths only.
- Commit messages: Conventional Commits subject under 72 characters, a `## What` paragraph, a `## How` list led by file paths in backticks, entry point first.
- `client/src/sim/` never imports `net/`, `game/` or Babylon (ESLint). `sim/` determinism: no trig, no `Math.pow`, no `**`, no `Math.hypot`; `Math.sqrt` only; the only sine and cosine are `view.ts`'s and the only `Math.atan2` calls are those already allowlisted in `client/test/architecture.test.ts` (reuse `faceToward`, which is private to `hollow.ts`, so the `Watch` facing lives there; add no new call); every draw from `nextRandom` on the watcher's own record; no `Date`, no `performance`.
- Exact values from the spec: `WATCH_TRAIL_CLEAR = 6`; `WATCH_RANGE_FAR = 90`; `WATCH_RANGE_NEAR = 25`; `WATCH_BEARING_MIN = 30°`, `WATCH_BEARING_MAX = 70°` (as the four constants above); `WATCH_FLEE_RADIUS = 15`; `WATCH_PLACE_TRIES = 8`; `WATCH_REST_MIN = 20`, `WATCH_REST_MAX = 60`; `WATCH_REST_NEAR_SCALE = 0.4`. New here: `WATCH_VIEW_COS = 0.1736`, `WATCH_SLOPE_NY = 0.74`, `WATCH_SALT`.
- `PROTOCOL_VERSION` stays 5. `AiState.Watch = 9` rides the enemy byte the wire already carries (no validation on the byte; the client casts). The watcher's record never reaches the wire or the fingerprint; the watcher entity itself is in the snapshot and the fingerprint like any enemy.
- Every numeric expectation in a test is a literal. A test tolerance never rewrites a spec rule; fix the fixture.
- Run the focused tests per task; the seed sweep (Task 3) runs alone, once, after everything else is green; before the final commit `npm run typecheck && npm run lint && npm test` from the repo root.

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/watcher.ts` (new) | `WatcherRecord`; the constants; `climbOf`, `leadOf`, `topForkClimb`, `reachOf`; `placeWatcher` (the placement rule); `spawnWatcher`, `hideWatcher`; `stepWatcher` (show, hide, rest). |
| `client/src/sim/types.ts` | `AiState.Watch = 9`. |
| `client/src/sim/hollow.ts` | `Watch` is a Hollow state: stands facing its target; skipped by contact and by the prey pass; `playerHasInView(player, hollow, world, cosLimit)` with `playerSees` as its 20° case; the state list in the header. |
| `client/src/sim/world.ts` | `World.watcher: WatcherRecord \| null` (host-only, set only when the forest built a trail); `stepWatcher` in the tick before the Hollows move. |
| `client/src/sim/summit.ts` | Removes the watcher on the flip. |
| `client/src/game/renderer.ts` | The state list in its nearest-Hollow comment. |
| `client/src/game/entityViews.ts` | Nothing: `isHollowState` includes `Watch`, so the capsule path draws it. |
| `docs/gameplay/2026-09-16-the-summit.md` | Status line, §4 and §7 amendments; the §9 row. |
| Tests | `test/sim/watcher.test.ts` (new), `test/sim/watcherSweep.test.ts` (new, the seed gate), `test/sim/hollow.test.ts`, `test/sim/summitRun.test.ts` (the climb assertions), `test/game/escalation.test.ts` (nearness reads `Watch`), `test/sim/world.test.ts` and `test/net/protocol.test.ts` (if a state list is pinned). |

---

### Task 1: The state and the placement rule

**Files:** modify `client/src/sim/types.ts`, `client/src/sim/hollow.ts`, `client/src/sim/world.ts` (the field only), `client/src/game/renderer.ts` (a comment); create `client/src/sim/watcher.ts` (everything but `stepWatcher`); test `client/test/sim/watcher.test.ts` (new), `client/test/sim/hollow.test.ts`, `client/test/game/escalation.test.ts`.

**Interfaces:**

```ts
// types.ts
/** The watcher: stands off the trail facing the lead, never walks, never touches; the stare still fills. */
Watch = 9,

// hollow.ts
/** `playerSees` with the cone as a parameter: the stare's 20° cone, or the watcher's wide 80° one. */
export function playerHasInView(player: PlayerState, hollow: EnemyState, world: World, cosLimit: number): boolean;

// watcher.ts
export const WATCH_TRAIL_CLEAR = 6;
export const WATCH_RANGE_FAR = 90;
export const WATCH_RANGE_NEAR = 25;
export const WATCH_BEARING_MIN_COS = 0.866;   // 30°
export const WATCH_BEARING_MIN_SIN = 0.5;
export const WATCH_BEARING_MAX_COS = 0.342;   // 70°
export const WATCH_BEARING_MAX_SIN = 0.9397;
export const WATCH_FLEE_RADIUS = 15;
export const WATCH_PLACE_TRIES = 8;
export const WATCH_REST_MIN = 20;
export const WATCH_REST_MAX = 60;
export const WATCH_REST_NEAR_SCALE = 0.4;
export const WATCH_VIEW_COS = 0.1736;
export const WATCH_SLOPE_NY = 0.74;
export const WATCH_SALT = 0x57a7c4;

/** Host-only. Off the wire, outside the fingerprint. */
export type WatcherRecord = {
  /** The entity id while shown, or -1. */
  id: number;
  /** Seconds until the next showing while hidden. */
  rest: number;
  /** The watcher's own random stream, seeded from the world's seed. */
  rng: { rngSeed: number };
};

/** The record with its stream seeded and its first rest drawn from the band. */
export function createWatcherRecord(seed: number): WatcherRecord;

/** How far up the stem a point is: 1 − stemProgress, 0 at the pad, 1 at the crest. */
export function climbOf(graph: TrailGraph, x: number, z: number): number;

/** The living player farthest up the stem by climb, ties to the lower id; null when none lives. */
export function leadOf(world: World): PlayerState | null;

/** The greatest climb over the graph's forks, or 1 when it has none. */
export function topForkClimb(graph: TrailGraph): number;

/** The lead's climb over the top fork's, clamped to [0, 1]. */
export function reachOf(world: World, lead: PlayerState): number;

/**
 * One placement attempt from the record's stream: a point at the reach's range from the lead, on a
 * drawn side, in the bearing band off the lead's horizontal look; null unless it is at least
 * WATCH_TRAIL_CLEAR from every trail centreline, standable (`groundSpawn` with ENEMY_HALF, ground
 * normal y ≥ WATCH_SLOPE_NY), off the road corridor, at least WATCH_FLEE_RADIUS from every living
 * player, and in a clear sightline from the lead's eye to the watcher's centre. Null at once on a
 * world without forest, ground or trail. Always spends its two draws.
 */
export function placeWatcher(world: World, lead: PlayerState, reach: number): Vec3 | null;

/** Spawns the watcher at `at`, facing `leadId`, and records its id. */
export function spawnWatcher(world: World, at: Vec3, leadId: number): EnemyState;
/** Removes the watcher entity, if shown, and clears the id. */
export function hideWatcher(world: World): void;
```

**Rules, precisely.**

- `hollow.ts`: `isHollowState` includes `Watch`. `stepHollow`'s `Watch` case: `faceToward` the player `targetId` when alive, nothing else (never `walkToward`); `spawnWatcher` leaves `yaw` 0 and the first `stepHollow` sets it the same tick. `updateHollows`: the contact loop skips a `Watch` Hollow (it never touches); the prey pass skips it (as it skips `Emerge`; this one is load-bearing, the prey pass would otherwise turn it into `Hunt` on its first tick). The look pass and the stare are unchanged, so the watcher is seen through `playerSees` and fills the stare like any Hollow. `playerSees(p, h, w)` becomes `playerHasInView(p, h, w, HOLLOW_LOOK_COS)`. The header's state list names `Watch`.
- `placeWatcher`: returns null unless `world.forest`, `world.ground` and `world.trail` are set. Draws, in order, `side` (u < 0.5 → −1 else +1) and `mix` from the record's stream, two draws per attempt always. `look = aimDirection(lead.yaw, 0)`. `bearing` = normalised `(1 − mix)·R(look, 0.866, 0.5, side) + mix·R(look, 0.342, 0.9397, side)`. `range = WATCH_RANGE_FAR + (WATCH_RANGE_NEAR − WATCH_RANGE_FAR) · reach`. Candidate `(x, z) = lead.pos + bearing · range`. Checks in this order, each returning null: `trailDistance(graph, x, z) < WATCH_TRAIL_CLEAR`; `groundSpawn(world.boxes, world.forest.seed, x, z, ENEMY_HALF)` null; `normalAt(x, z, n)` with `n.y < WATCH_SLOPE_NY`; `isOnCorridor(world, x, z)`; any living player within `WATCH_FLEE_RADIUS` (horizontal); `!hasLineOfSight(leadEye, centre, world.boxes, world.ground)` with `leadEye = lead.pos + PLAYER_EYE_OFFSET` and `centre` the hull position `groundSpawn` returned. The returned point is that hull position.
- `spawnWatcher` builds an `EnemyState` like `spawnHollow` (`ai: Watch`, `targetId: leadId`, `stateTimer: 0`, `emergeTo: null`, `route: []`) and sets `record.id`. `hideWatcher` deletes the entity by id and sets `id = -1`.
- `world.ts`: `watcher: null` in `createWorld`; `createForestWorld` sets `createWatcherRecord(seed)` only when the forest built a trail (the same guard as `trail`). Not cloned, not fingerprinted; the comment says why it lives on `World`, as `cut` does.

**Tests** (`watcher.test.ts`, seed `hollow` forest world): `climbOf` is 0 (±0.01) at node 0 and 1 at node 36; `leadOf` picks the living player with the greatest climb among three at nodes 0, 18 and 37, and the next when the lead is killed; `topForkClimb` is 0.751 (±0.001) and `reachOf` is 0 (±0.01) at the pad and 1 at node 37; `placeWatcher` over 200 attempts from a record built by hand, `{ id: -1, rest: 0, rng: { rngSeed: (seed ^ WATCH_SALT) | 0 } }` (`createWatcherRecord` spends a draw on the first rest, which would shift the sequence), the lead the only player in the world, standing at the node with `y = heightAt + 0.9` and facing the next stem node up, at reach 0 (node 0) and at reach 1 (node 37): every non-null point is ≥ 6 m from the trail centreline, off the corridor, ≥ 15 m from the lead, standable, in a clear sightline, at range 90 (±0.5) or 25 (±0.5), at a bearing whose cosine against the look lies in [0.342, 0.8661] by dot product; the counts that land are pinned (measured 11 and 147 of 200); the same record and world give the same sequence twice; a second player standing 10 m from a known admitted spot makes that attempt null. On the flat world in `hollow.test.ts` (the honest fixture there is `spawnHollow(w, at, p.id, 0)` then `h.ai = AiState.Watch`; that file has no record): a `Watch` Hollow at 5 m never moves and never kills over 300 ticks while the player stands still; it faces the player; the stare fills while the player looks at it and empties when they look away; the prey pass never turns it into `Hunt`. `escalation.test.ts`: a `Watch` enemy feeds the nearness term like a `Hunt` one.

- [ ] Step 1: tests. Step 2: implement. Step 3: `npx vitest run --root client test/sim/watcher.test.ts test/sim/hollow.test.ts test/sim/summit.test.ts test/sim/world.test.ts test/net/protocol.test.ts test/game/escalation.test.ts test/architecture.test.ts test/smoke.test.ts`; typecheck; eslint. Step 4: commit.

---

### Task 2: The watcher in the tick

**Files:** modify `client/src/sim/watcher.ts` (`stepWatcher`), `client/src/sim/world.ts` (the tick), `client/src/sim/summit.ts` (the flip); test `client/test/sim/watcher.test.ts`.

**Interfaces:**

```ts
/**
 * The watcher's tick, host only, on a forest world during the climb: while hidden the rest counts
 * down and, at zero, up to WATCH_PLACE_TRIES placements are tried for the lead; while shown it hides
 * the first tick a living player is within WATCH_FLEE_RADIUS or no living player has it in the wide
 * view (WATCH_VIEW_COS, HOLLOW_LOOK_RANGE, a clear sightline), and a new rest is drawn, scaled by the
 * lead's reach. Its facing follows the lead through `stepHollow`.
 */
export function stepWatcher(world: World, dt: number): void;
```

**Rules.** In `tickWorld`, after `updateSafety` and before `stepHollows`, when `world.authoritative && world.watcher !== null && world.trail !== null && state.phase === Climb && state.outcome === Playing`. Hidden: `rest -= dt`; when `rest ≤ 0`: `lead = leadOf(world)`; none → return (no draw); `reach = reachOf`; up to `WATCH_PLACE_TRIES` calls of `placeWatcher`; the first non-null spawns; none → return (retry next tick, the stream having advanced). Shown: read the entity; if it is gone treat as hidden; `flee` = any living player within `WATCH_FLEE_RADIUS`; `inView` = any living player with `playerHasInView(p, w, world, WATCH_VIEW_COS)`; if `flee || !inView`: `hideWatcher`, then `rest = (WATCH_REST_MIN + u · (WATCH_REST_MAX − WATCH_REST_MIN)) · (1 − (1 − WATCH_REST_NEAR_SCALE) · reach)` with one draw `u` and `reach` from the current lead (0 if none). Else keep `targetId = lead.id` current. `stepSummit`'s flip: `hideWatcher(world)` before `spawnHollow`. A showing on the flip tick is removed at the tail the same tick, one id spent, harmless; deleting there is safe because `updateDeaths` and `updateLoss` ran before it and the snapshot is built after the tick.

**Tests** (extend `watcher.test.ts`, seed `hollow`, the player teleported, driven by `tickWorld`, the record's rest set by hand so no test waits 20–60 s): shows on the tick the rest reaches zero when a placement fits (`enemies` gains one `Watch` at a valid point; `record.id` set); hides on the first tick the lead turns away (turn the yaw by π: a quarter turn toward its side would leave it inside the 80° cone; next tick the entity is gone and `rest` is in the band scaled by the pinned reach); hides on the first tick a player comes within 15 m; the stare fills only while the lead looks (20°) at it, and on the hide tick it has already fallen by 1/180 (`toBeCloseTo(before − 1/180, 12)`: the stare is a float sum; the look pass runs after `stepWatcher` and finds nothing), strictly falling after; never shows once the phase has flipped (teleport to the crest, flip, run 2000 ticks with the rest at zero: no `Watch` entity ever, the summit Hollow alone); removed on the flip tick (shown, then flip: entity gone, summit Hollow present); the lead is re-read when the lead dies (two players; kill the lead; the facing target and the next placement use the survivor); the rest scales with reach (the rest drawn at reach 0 and at reach 1 from the same stream state: the second is 0.4 of the first); a non-authoritative world never shows.

- [ ] Step 1: tests. Step 2: implement. Step 3: `npx vitest run --root client test/sim/watcher.test.ts test/sim/summit.test.ts test/sim/summitRun.test.ts test/sim/cut.test.ts test/sim/hollow.test.ts test/architecture.test.ts`; typecheck; eslint. Step 4: commit.

---

### Task 3: The whole run, the seed gate, the spec

**Files:** modify `client/test/sim/summitRun.test.ts`; create `client/test/sim/watcherSweep.test.ts`; modify `docs/gameplay/2026-09-16-the-summit.md`.

**The whole run.** The climb loop's "no enemies" assertion becomes: during the climb every enemy is `Watch` and there is at most one; the run holds the player at stem nodes 6 and 37, facing the next stem node up, with the record's rest at zero for up to 120 ticks and asserts a showing at each (range within the reach band for that node, pinned), then turns the player by π and asserts the hide; on the flip tick no `Watch` remains and the summit Hollow is the only enemy; the S3 guide literals (54 nodes, 2012.78 m, the fork order and closures) are unchanged, which is the watcher's own stream at work.

**The seed gate** (`watcherSweep.test.ts`, the fifty seeds `hollow0..49`, the `hollowWalk` timeout): for every seed, the lead at the stem nodes nearest climb 0, 0.25, 0.5, 0.75 and at the top fork, facing four ways (up the stem, down it, and the two perpendiculars), the record's rest at zero: run `stepWatcher` for up to 120 ticks (960 tries) and, for every placement made, assert every constraint (trail clearance, corridor, flee radius, slope, sightline, range for the reach, bearing band). Record as measured floors asserted as literals: the share of (seed, node, yaw) cases that show within 120 ticks, the per-try admission share over a fixed 200 `placeWatcher` calls per case (100 if the sweep cannot hold the 300 s budget; say which), and the range of ranges; record the rejection breakdown (sightline, corridor, ground, clearance) in the Status line, since it is the argument for tuning the 90 m range later.

**The spec.** The Status line records what S2 built and measured (built 2026-09-26; the showing share and the rejection breakdown); §4 gets the Decisions as dated sentences in the spec's voice (climb as `1 − stemProgress`, the own stream replacing "from the world RNG", the wide view cone with the number, the trig-free bearing, walkable ground and the centreline clearance, the first rest, the levers living in `watcher.ts` rather than `hollow.ts`); §7's determinism paragraph says the watcher's placement draws from its own stream; the §9 row becomes "Built 2026-09-26 (docs/gameplay/2026-09-26-the-watcher-plan.md)".

- [ ] Step 1: the whole run. Step 2: the sweep, alone: `npx vitest run --root client test/sim/watcherSweep.test.ts`. Step 3: the spec; the docs file-name test. Step 4: commit.

---

### Task 4: The last read, the full suite, the browser pass

- A fresh read of the whole branch against the spec and this plan; what it finds is fixed and read again.
- `npm run typecheck && npm run lint && npm test` from the repo root.
- The browser pass, two pages on seed `hollow`, headlamps on, on the climb: the record's rest forced short through the debug hooks; see the watcher appear off the trail ahead; centre it and watch the stare fill; look away past 80° and see it gone; climb on and see it again, closer; hold the look until the stare kills; then the flip with no watcher left. Frames archived with the run's records.
- Push and deploy when the release is called.

## Checks on this plan

- Every §4 rule has a home: the lead and the range/bearing/clearance/sightline placement (Task 1), the tries, the flee radius, the wide-view hide, the rest and its near scale (Task 2), removal on discovery (Task 2), the stare as shipped (Task 1's `Watch` in the look pass), the nearness (Task 1's escalation case), the tests §4 names (Tasks 1–3).
- The deviations from the spec's letter are all in the Decisions and reach the spec in Task 3.
- No protocol change: `Watch` rides the enemy byte; the record is host-only.
- Determinism: the watcher's draws come from its own seeded stream; the guide and the cuts are untouched; no new trig outside `view.ts`; entity ids may shift by the showing count and nothing pinned is an id.
- The S3 literals stay pinned, which is the test that the own stream works.
