# The Cut (S3) Implementation Plan

**Goal:** Make the descent a maze with teeth. On the discovery tick the host draws a hidden guide route crest → pad. As the party comes down, every fork it reaches is cut once, for everyone, for the rest of the match: one branch stays open, every other branch is closed by a Hollow that steps out of it and joins the hunt. A closed branch is a Hollow, not a wall; the crest stays the world's only dead end. With it, a minimal change to how a Hollow is drawn, so the pack can be seen at all in the dark it hunts in.

**Architecture:** Host-only, off the wire. A new `sim/cut.ts` owns the record (the guide, the cuts, the closed edges) and the pure rules (which branch the player arrived by, which branch stays open, where a closed branch's Hollow steps out). `sim/summit.ts` draws the guide on the flip and runs the cut each Chase tick. `sim/hollow.ts` gains the walking form of `Emerge` the fork Hollows need. Nothing new crosses the wire: fork Hollows are enemies on the channel peers already receive, in a state (`Emerge`) the protocol already carries. The client learns nothing about cuts; it only gets a Hollow material that lighting can touch.

**Spec:** `docs/gameplay/2026-09-16-the-summit.md` §5.3 (the cut), §5.1 (the summit Hollow's rules the fork Hollows inherit), §5.2 (safety, the treeline), §7 (the wire: nothing new), §10 (verification). What T2 shipped for it: `trailRoute.ts` (`guideWalk`, `route`, `homeDistances`, `forksOf`, `pathLength`), `trail.ts` (`segmentDistance`, `nearestTrailNode`, `TrailGraph.forks`, `homeDist`, `shortestHome`, `TRAIL_CORRIDOR_HALF`). What S1 shipped for it: `hollow.ts` (`spawnHollow`, `Emerge`, `Hunt`, `Stand`, the treeline, the corridor walk-out), `summit.ts` (the flip, safety, the end), `containment.ts` (`roadOffset`, `isOnCorridor`).

**Measured on the seed `hollow` before the build** (the literals below come from here): 80 nodes, 82 edges, forks `[2, 22, 37, 78, 79]` (22 is a four-way hub), crest node 36, no fork on the corridor. The guide drawn from the world RNG at the flip runs 36 → … → 0 over 54 nodes and 2013 m (1.58 × `shortestHome` 1274.2, in band), visits no node twice, and meets its forks in the order 37, 22, 79, 78, 2; walking it closes six edges, so the pack at the pad is seven with the summit Hollow. Every closed edge is at least 15.9 m long, so every spawn stands 12 m in. Across the fifty seeds `hollow0..49`: the guide is in band on 29; a fork the guide visits twice occurs on 2 (both four-way hubs); a fork on the corridor on 1 (`hollow29`); closed edges along the guide 0–10, median 5; the nearest pair of forks 15.8 m apart (`hollow35`); the shortest fork-incident edge 4.9 m (`hollow37`).

## Decisions that amend or sharpen the spec (the last task writes them into the spec)

- **Density stays as it is.** The cut ships on today's trails. The sweep records the pack size it actually produces; raising the fork count is a separate follow-up.
- **The trigger must be on a branch of the fork, not merely near it.** Thirty metres reaches forks from trail that does not touch them (42 such cases across the fifty seeds), where "the edge the player is on" is not one of the fork's edges. A living, unsafe player triggers a fork when they are within `FORK_CUT_RADIUS` (30 m) of the node **and** within `TRAIL_CORRIDOR_HALF` (7 m) of one of its incident edges; that edge is the arrival. A player standing on the node itself is at distance 0 from every incident edge; their previous position is not tracked, so the tie goes to the lower edge index, and the tests approach every fork along its in-edge so the arrival is unambiguous.
- **The guide visits no node twice.** `guideWalk` refuses a step onto a node already on the walk (it already refuses a repeated edge); a walk that runs out of options for it simply fails that try. "The guide's edge into a fork" and "out of it" are then unique, as §5.3 assumes. The filter can change which options a try sees, so every `hollow` literal in this plan that depends on the draw (the guide's node count, length, RNG advance, fork order and closures) is re-measured after the change and pinned then; the band share is re-measured in the sweep, and §3.5's floor is amended with the measured share if it slips, never the test loosened.
- **A closed edge is closed at both ends.** An edge can join two forks (on `hollow` the rung between 79 and 78). The open-branch rule never considers an edge already closed, and the closure never closes one twice.
- **No Hollow ever steps out on safe ground, or on a player.** A fork that itself stands on the road corridor is never cut (it is safe ground; nobody is hunted there). For a closed branch the Hollow steps out `FORK_SPAWN_DIST` (12 m) into it, or, when the branch enters the corridor sooner, `FORK_SPAWN_CLEAR` (1 m) short of where it does; and never within `FORK_SPAWN_PLAYER_CLEAR` (2 m) of any living player — the spawn steps further along the bed until it is, within the same limits. A branch with no such point in its first `FORK_SPAWN_MIN` (2 m) or beyond cannot be closed and stays open. A fork left with nothing to close is still recorded as cut (open neighbour `-1`), so it is judged once.
- **A fork is never a trap at the moment it is cut.** The open branch always reaches the pad on the residual graph at cut time; if no branch but the arrival does, the fork is recorded as cut with nothing closed. Later cuts elsewhere can put a Hollow on that route (two players on different branches can arrange it), never remove the trail: a closed branch is walkable. The spec's sentence claiming more is reworded to this.
- **The rejoin tie-break reads distance to the guide.** Every route home ends on the guide's tail, so "reaches a guide node" cannot discriminate. Among near-ties (within `GUIDE_REJOIN_SLACK`, 60 m, of the cheapest) the open branch is the one whose residual route home reaches its first guide node in the fewest metres from the fork; ties to the lower edge index.
- **The fork Hollow's walk to the mouth is `Emerge` with a destination, and it is bounded.** `EnemyState` gains a host-only `emergeTo: Vec3 | null`: while set, an emerging Hollow walks toward it at hunt speed (not slowed by being looked at: it is the reveal, not the hunt) and, on reaching it — or once it has been stuck for `STUCK_SECONDS`, or after `FORK_EMERGE_MAX_S` (6 s) of walking — stands `FORK_REVEAL_S` (1 s) where it is, facing whoever triggered the cut, then hunts them. The summit Hollow has `emergeTo: null` and is unchanged. Contact and the stare apply throughout, as to any Hollow.
- **The Hollow is drawn as a very dark, lit shape rather than an unlit black one.** A `PBRMaterial` with fog off that the atmosphere plugin leaves alone, so it takes the headlamp, the sun and the image lighting on the same falloff as everything else (the lamp's 400 is tuned for that falloff; a lit `StandardMaterial` blows out white under it). Near-black albedo, a faint emissive floor, full roughness, no metal. The colours are knobs in a Babylon-free `game/hollowLook.ts`.

## Global Constraints

- Work in the worktree `.claude/worktrees/the-cut` on `worktree-the-cut`, branched from `origin/main` at b579cd4. Stage explicit paths only.
- Commit messages: Conventional Commits subject under 72 characters, a `## What` paragraph, a `## How` list led by file paths in backticks, entry point first.
- `client/src/sim/` never imports `net/`, `game/` or Babylon (ESLint). `sim/` determinism: no trig, no `Math.pow`, no `**`, no `Math.hypot`; `Math.sqrt` only; the only `Math.atan2` calls are the two host-only facings allowlisted in `client/test/architecture.test.ts`; every random draw from `nextRandom(state)`; no `Date`, no `performance`.
- Exact values from the spec: `FORK_CUT_RADIUS = 30`; `FORK_SPAWN_DIST = 12`; `FORK_REVEAL_S = 1`; `GUIDE_REJOIN_SLACK = 60`; `GUIDE_MIN`/`GUIDE_MAX`/`GUIDE_TRIES` as shipped (1.5, 2.5, 64). New here: `FORK_SPAWN_CLEAR = 1`, `FORK_SPAWN_MIN = 2`, `FORK_SPAWN_PLAYER_CLEAR = 2`, `FORK_EMERGE_MAX_S = 6`.
- `PROTOCOL_VERSION` stays 5. The cut record and `emergeTo` never reach the wire or the fingerprint (`serializeWorldState`).
- Every numeric expectation in a test is a literal. A test tolerance never rewrites a spec rule; fix the fixture.
- Run the focused tests per task; the seed sweep (Task 5) runs alone, once, after everything else is green; before the final commit `npm run typecheck && npm run lint && npm test` from the repo root.

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/cut.ts` (new) | `CutRecord`; `drawGuide`; the pure rules `triggerEdge`, `openBranch`, `forkSpawn`; `stepCuts` (the per-tick trigger, the record, the spawns). |
| `client/src/sim/trailRoute.ts` | `guideWalk` visits no node twice. |
| `client/src/sim/world.ts` | `World.cut: CutRecord \| null` (host-only, null until the flip; not cloned, not fingerprinted); `cloneWorldState` copies `emergeTo`. |
| `client/src/sim/summit.ts` | Draws the guide on the flip; runs `stepCuts` each Chase tick before the end rule. |
| `client/src/sim/hollow.ts` | `Emerge` with `emergeTo`, bounded; `spawnForkHollow`; `FORK_REVEAL_S` and `FORK_EMERGE_MAX_S` live here beside `SUMMIT_REVEAL_S`, so `cut.ts` depends on `hollow.ts` and never the reverse. |
| `client/src/sim/types.ts` | `EnemyState.emergeTo`. |
| `client/src/sim/director.ts`, `client/src/net/clientSession.ts` | Construct enemies with `emergeTo: null`. |
| `client/src/game/hollowLook.ts` (new) | The Hollow's colours and roughness as knobs. |
| `client/src/game/entityViews.ts`, `client/src/game/atmosphere.ts` | The Hollow material lit, from the knobs; the plugin leaves it alone. |
| `docs/gameplay/2026-09-16-the-summit.md` | Status line and §5.3 amendments. |
| Tests | `test/sim/cut.test.ts` (new), `test/sim/cutSweep.test.ts` (new, the seed gate), `test/sim/trailRoute.test.ts`, `test/sim/trailSystem.test.ts` (the guide band), `test/sim/hollow.test.ts`, `test/sim/world.test.ts`, `test/sim/summitRun.test.ts` (the whole run, extended), `test/game/entityViews.test.ts`, `test/game/renderer.test.ts`, `test/game/atmosphere.test.ts`, `test/game/hollowLook.test.ts` (new). |

---

### Task 1: The record and the three rules

**Files:** create `client/src/sim/cut.ts`; modify `client/src/sim/world.ts` (the field only), `client/src/sim/trailRoute.ts` (`guideWalk`); test `client/test/sim/cut.test.ts` (new), `client/test/sim/trailRoute.test.ts`, `client/test/sim/trailSystem.test.ts` (if a guide literal moves, re-measure and pin the new one).

**Interfaces:**

```ts
export const FORK_CUT_RADIUS = 30;
export const FORK_SPAWN_DIST = 12;
export const FORK_SPAWN_CLEAR = 1;
export const FORK_SPAWN_MIN = 2;
export const FORK_SPAWN_PLAYER_CLEAR = 2;
export const FORK_REVEAL_S = 1;
export const FORK_EMERGE_MAX_S = 6;
export const GUIDE_REJOIN_SLACK = 60;

/** Host-only: the guide, what has been cut, and which edges are closed. Off the wire, outside the fingerprint. */
export type CutRecord = {
  /** Node path crest → pad (`guideWalk`), drawn on the discovery tick; no node twice. */
  guide: readonly number[];
  /** Fork node → the neighbour node its open branch leads to, or -1 when nothing closed. A fork recorded here is judged once. */
  cuts: Map<number, number>;
  /** Edge indices closed so far: the residual graph is every other edge. */
  closed: Set<number>;
};

/** Draws the guide from the world RNG. Called once, on the flip. */
export function drawGuide(world: World): CutRecord;

/**
 * The incident edge of `fork` a player at (x, z) is on: the nearest by segmentDistance, ties to the
 * lower edge index, or -1 when the nearest is farther than TRAIL_CORRIDOR_HALF (the player is near the
 * fork but on trail that is not one of its branches).
 */
export function triggerEdge(graph: TrailGraph, fork: number, x: number, z: number): number;

/**
 * Which incident edge of `fork` stays open, given the edge the player arrived by, or -1 when no
 * other open edge reaches the pad on the residual graph. Never an edge already closed.
 */
export function openBranch(graph: TrailGraph, record: CutRecord, fork: number, arrival: number): number;

/**
 * Where a Hollow steps out of the closed edge `edge` leaving `fork`, or null when no point on the
 * branch is off the corridor, at least FORK_SPAWN_PLAYER_CLEAR from every living player, and at
 * least FORK_SPAWN_MIN from the fork: such a branch cannot close. `y` is the Hollow's centre.
 */
export function forkSpawn(world: World, fork: number, edge: number): Vec3 | null;
```

**Rules, precisely.**

- `guideWalk` (`trailRoute.ts`): alongside the `used` edge set, a `seen` node set; an option whose far node is already on the walk is skipped. Nothing else changes. `trailRoute.test.ts` gains "visits no node twice" on a hand graph with a four-way hub where a revisit was possible; `trailSystem.test.ts`'s guide-band gate is re-run and its literal re-pinned if it moved.
- `openBranch`. Let `i` be the guide's index of `fork` if it is on the guide (unique now). If the arrival edge joins `guide[i-1]` and `fork`, the open edge is the one joining `fork` and `guide[i+1]` (the guide runs crest → pad; `i+1` exists because the pad is degree one and the crest is the only dead end). Otherwise: candidates are the incident edges of `fork` that are neither the arrival nor in `record.closed`; `residual` is `graph.edges` with every index in `record.closed` removed (keep a parallel array of original indices); `dist = homeDistances(graph.nodes, residual)`; `cost(e) = len(e) + dist[far(e)]`; drop the infinite; none → -1. With `m` the minimum, the near-ties are those with `cost ≤ m + GUIDE_REJOIN_SLACK`; for each, `rejoin(e)` = the metres from `fork` along `e` and then along `route({ ...graph, edges: residual }, far(e), 0)` to the first node on the guide (`Infinity` if none — cannot happen, the pad is on the guide); the open edge is the near-tie with the least `rejoin`, ties to the lower cost, then the lower edge index.
- `forkSpawn`. Walk from the fork node along the straight bed toward the far node in steps of 0.25 m; the bed is straight in XZ between graph nodes and the node's `x, z` is the centreline. The candidate distance is `FORK_SPAWN_DIST`, capped at `len − FORK_SPAWN_CLEAR` (never on the far node, which may be another fork). If some sample at `d ≤ candidate` is on the corridor (`isOnCorridor`), the candidate becomes `d − FORK_SPAWN_CLEAR` for the first such `d`. Then, while the point at the candidate is within `FORK_SPAWN_PLAYER_CLEAR` (horizontal) of any living player, the candidate moves one step further along the bed, never past the cap and never within `FORK_SPAWN_CLEAR` of the corridor; if that fails, or the candidate is under `FORK_SPAWN_MIN`, null. `y` is `ground.heightAt(x, z) + ENEMY_HALF.y` on a forest, or the interpolated node `h` + `ENEMY_HALF.y` on a world without ground.
- `drawGuide` is `{ guide: guideWalk(graph, () => nextRandom(world.state)).path, cuts: new Map(), closed: new Set() }`.

**Tests** (`cut.test.ts`): a hand-built `TrailGraph` on a road-less world (pad 0; a stem node; a fork with three branches; a second fork sharing an edge with the first; a dead end; a branch that rejoins the guide sooner than a cheaper one) exercises: `triggerEdge` ties and its -1 when off every branch; `openBranch` on the guide (arrival by the guide's in-edge → the guide's out-edge) and off it (residual shortest; the rejoin tie-break choosing the branch that meets the guide sooner over a cheaper one within 60 m; the lower-index tie); `openBranch` never returning a closed edge and returning -1 once every non-arrival edge is closed or unreachable; the shared edge closed at the first fork and not a candidate at the second. On the seed `hollow`: `drawGuide` starts at 36, ends at 0, has 54 nodes, 2013 m (±1), no node twice, and advances `rngSeed` from 2032433950 to 1201198389; `forkSpawn` for every fork and incident edge is off the corridor, at distance 12 m (±0.3) from the fork on every fork-incident edge of `hollow` except fork 37's loop edge 42 (10.0 m long), whose spawn stands 9 m in, `y` = ground + 0.9; a player standing 12 m down a branch moves the spawn to at least 2 m past them; a synthetic branch on the corridor from the fork returns null.

- [ ] Step 1: write the failing tests. Step 2: implement. Step 3: `npx vitest run --root client test/sim/cut.test.ts test/sim/trailRoute.test.ts test/sim/world.test.ts test/architecture.test.ts test/smoke.test.ts`, then `test/sim/trailSystem.test.ts` alone; typecheck; eslint. Step 4: commit.

---

### Task 2: `Emerge` with a destination, and the fork Hollow's spawn

**Files:** modify `client/src/sim/types.ts`, `client/src/sim/hollow.ts`, `client/src/sim/director.ts`, `client/src/net/clientSession.ts` (construct `emergeTo: null`), `client/src/sim/world.ts` (`cloneWorldState` clones `emergeTo` with `cloneVec3`); the `EnemyState` literals in `client/test/sim/world.test.ts`, `client/test/game/entityViews.test.ts`, `client/test/game/renderer.test.ts`; test `client/test/sim/hollow.test.ts`.

**Interfaces:**

```ts
// types.ts, EnemyState: host-only, beside `route`.
/** Where an emerging Hollow walks before its reveal, or null for one that stands where it spawned. */
emergeTo: Vec3 | null;

// hollow.ts
/**
 * A Hollow stepping out of a closed branch: spawned at `at` in Emerge, walks to `mouth` at hunt
 * speed, stands FORK_REVEAL_S facing `targetId`, then hunts them. The walk ends early where it
 * stands once it has been stuck STUCK_SECONDS or walked FORK_EMERGE_MAX_S.
 */
export function spawnForkHollow(world: World, at: Vec3, mouth: Vec3, targetId: number): EnemyState;
```

**Rules.** In `stepHollow`'s `Emerge` case: if `emergeTo !== null`, `walkToward(h, world, dt, emergeTo.x, emergeTo.z, HOLLOW_HUNT_SPEED)` while `stateTimer` counts down from `FORK_EMERGE_MAX_S`; when `horizontalDistSq(h.pos, emergeTo) ≤ HOLLOW_WAYPOINT_RADIUS²`, or `h.stuckTimer > STUCK_SECONDS`, or `stateTimer` reaches 0, set `emergeTo = null` and `stateTimer = FORK_REVEAL_S`; the reveal then counts down as today. One field, two meanings in sequence, and `emergeTo` says which. `spawnHollow` sets `emergeTo: null`; `spawnForkHollow` sets it to `mouth` and `stateTimer` to `FORK_EMERGE_MAX_S`. `updateHollows`' prey pass skips `Emerge` as today, so an emerging Hollow keeps its trigger target through the walk.

**Tests** (append to `hollow.test.ts`, road-less flat world): a fork Hollow spawned 12 m from its mouth walks there at the hunt speed (after a 15-tick settle, `toBeCloseTo(6.3, 3)` m/s over the next 60 ticks, as the hunt test measures), is still `Emerge` on arrival, stands exactly `FORK_REVEAL_S` (still Emerge 58 ticks after arrival, Hunt at 62) facing its target, then closes on it; a player looking at it during the walk does not slow it; contact during the walk kills; a wall of boxes across the mouth leaves it stuck, and it reveals where it stands within `STUCK_SECONDS + FORK_REVEAL_S` (literal ticks) and hunts; a mouth 100 m away reveals after `FORK_EMERGE_MAX_S`; `spawnHollow` leaves `emergeTo` null and the summit reveal is unchanged; `cloneWorldState` clones `emergeTo` deeply; a Hollow's fingerprint is identical with `emergeTo` set and null.

- [ ] Step 1: tests. Step 2: implement. Step 3: `npx vitest run --root client test/sim/hollow.test.ts test/sim/summit.test.ts test/sim/world.test.ts test/net/clientSession.test.ts test/game/entityViews.test.ts test/game/renderer.test.ts test/architecture.test.ts`; typecheck; eslint. Step 4: commit.

---

### Task 3: The cut in the tick

**Files:** modify `client/src/sim/cut.ts` (`stepCuts`), `client/src/sim/summit.ts`; test `client/test/sim/cut.test.ts`.

**Interfaces:**

```ts
/**
 * The cut, host only, each Chase tick: every uncut fork is judged once the first tick a living,
 * unsafe player is within FORK_CUT_RADIUS of it and on one of its branches (`triggerEdge`); the
 * nearest such player (ties to the lower id) is the trigger, their arrival edge is never closed, one
 * more branch stays open (`openBranch`), and every other open branch closes with a Hollow stepping
 * out of it (`forkSpawn`, `spawnForkHollow`) that walks to the fork and hunts the trigger. A fork on
 * the corridor, or one with nothing to close, is recorded as cut with -1.
 */
export function stepCuts(world: World): void;
```

**Where it runs.** `stepSummit`'s Chase branch, before the end rule: the flip's tick spawns the summit Hollow and draws the guide (`world.cut = drawGuide(world)`), and every later Chase tick runs `stepCuts(world)`. Forks are judged in ascending node order (`graph.forks`), so two forks reached on the same tick resolve deterministically, and the second sees the first's closures in the residual graph. A branch that `forkSpawn` cannot host stays open and is not added to `closed`. The spawned Hollow's `mouth` is the fork node's bed point (`x`, `z` of the node; `y` = ground + `ENEMY_HALF.y`).

**Tests** (extend `cut.test.ts`, seed `hollow`, a real forest world, the player teleported; every approach stands on the in-edge, `FORK_CUT_RADIUS − 1` m short of the fork, for one tick before the node, because on the node every incident edge ties at distance 0): the flip draws the guide (`world.cut` null during the climb, set on the flip tick, unchanged afterwards); a living unsafe player 31 m along edge 36 from fork 37 does not cut it, at 29 m does; the cut fires once; arriving at 37 along the guide closes exactly edge 28 and one Hollow spawns, `Emerge`, targeting the trigger, `emergeTo` at fork 37, off the corridor, 12 m (±0.3) along edge 28; the hub 22 arrived along the guide closes two edges and spawns two; a player 25 m from a fork but 20 m off every branch triggers nothing; a dead player and a safe player trigger nothing; a fork on the corridor (`hollow29`, fork 1) is recorded with -1 and no spawn; a client world (`authoritative = false`) with the same state never cuts.

- [ ] Step 1: tests. Step 2: implement. Step 3: `npx vitest run --root client test/sim/cut.test.ts test/sim/summit.test.ts test/sim/summitRun.test.ts test/sim/hollow.test.ts test/architecture.test.ts`; typecheck; eslint. Step 4: commit.

---

### Task 4: The Hollow's look

**Files:** create `client/src/game/hollowLook.ts`; modify `client/src/game/entityViews.ts`, `client/src/game/atmosphere.ts`; test `client/test/game/hollowLook.test.ts` (new), `client/test/game/entityViews.test.ts`, `client/test/game/atmosphere.test.ts`.

**Interfaces:**

```ts
// hollowLook.ts — Babylon-free.
export type Rgb = { r: number; g: number; b: number };
/** Near-black: what the sun, the moon and a headlamp can catch. */
export const HOLLOW_ALBEDO: Rgb = { r: 0.03, g: 0.03, b: 0.035 };
/** A floor so the shape has an edge against a black sky. */
export const HOLLOW_EMISSIVE: Rgb = { r: 0.006, g: 0.007, b: 0.009 };
/** Fully rough: form under the lamp, never a highlight. */
export const HOLLOW_ROUGHNESS = 1;
/** The material name the atmosphere plugin leaves alone. */
export const HOLLOW_MATERIAL = "mat_hollow";
```

**Rules.** `entityViews.ts`'s material becomes a `PBRMaterial` named `HOLLOW_MATERIAL` with `fogEnabled = false`, `albedoColor`/`emissiveColor`/`roughness` from the knobs, `metallic = 0`. `atmosphere.ts`'s plugin factory returns null for a material with that name, so the fog anchor it rewrites (which a fog-off material never emits) is never sought and the material compiles. The comment over the material says why the lamp must touch it and why the plugin must not. The three light-facing knobs are the only values a tuning pass should move.

**Tests.** `hollowLook.test.ts`: each albedo and emissive channel within (0, 0.1] and roughness 1. `entityViews.test.ts`: the material is a `PBRMaterial`, fog off, lit, carrying the knobs (the assertions on `disableLighting`, black diffuse and black emissive are replaced). `atmosphere.test.ts`: the factory returns null for a material named `HOLLOW_MATERIAL` and attaches to any other PBR material as before.

- [ ] Step 1: tests. Step 2: implement. Step 3: `npx vitest run --root client test/game/hollowLook.test.ts test/game/entityViews.test.ts test/game/atmosphere.test.ts test/game/renderer.test.ts`; typecheck; eslint. Step 4: commit.

---

### Task 5: The whole run, the seed gate, the spec

**Files:** modify `client/test/sim/summitRun.test.ts`; create `client/test/sim/cutSweep.test.ts`; modify `docs/gameplay/2026-09-16-the-summit.md`.

**The whole run.** After the flip, the test walks the guide crest → pad by teleport: for every guide node, one tick standing on the in-edge `FORK_CUT_RADIUS − 1` m short of it (or its full length when shorter), then one tick on the node, the player unsafe until the pad. It asserts a cut at every guide fork (37, 22, 79, 78, 2) with the open neighbour equal to the guide's next node, six closed edges, every fork Hollow `Emerge` on its tick then `Hunt` later, the pack at the pad seven, no Hollow ever on the corridor, and the win at the pad.

**The seed gate** (`cutSweep.test.ts`, the fifty seeds `hollow0..49` and the timeout `hollowWalk.test.ts` uses): for every seed, draw the guide and walk it as above; assert on every seed: the guide reaches the pad and visits no node twice; every guide fork is cut with its open branch on the guide; at every cut, the open branch's far node reaches the pad on the residual graph at that moment; no spawn on the corridor or within 2 m of the player; every spawn between 2 and 12 m from its fork. Record, as measured floors asserted as literals: the share of seeds whose guide is in band (29 of 50 before the no-revisit rule; re-measured), the median and maximum pack size, and the seeds with a fork on the corridor.

**The spec.** The Status line records what S3 built and measured; §5.3 gets the amendments from this plan's Decisions as dated sentences in the spec's own voice, including the reworded route-home claim.

- [ ] Step 1: extend the whole run. Step 2: the sweep, run alone: `npx vitest run --root client test/sim/cutSweep.test.ts`. Step 3: the spec edits; the docs file-name test. Step 4: commit.

---

### Task 6: The last read, the full suite, the browser pass

- A fresh read of the whole branch against the spec and this plan; what it finds is fixed and read again.
- `npm run typecheck && npm run lint && npm test` from the repo root.
- The browser pass, two pages on seed `hollow` with headlamps on: the Hollow at the crest under the lamp at 3 m and 20 m, and against the night sky; teleport the host to fork 37's in-edge and watch the branch's Hollow step out, walk to the mouth and stand; the pack following down the guide; the end panel on both pages.
- Push and deploy when the release is called.

## Checks on this plan

- Every §5.3 rule has a home: the guide (Task 1), the trigger and the once-per-fork record (Task 3), arrival never closed and the open-branch rule (Task 1), the fork Hollow's emerge-walk-stand-hunt (Task 2), pack size measured (Task 5), state host-only (Tasks 1, 3).
- The deviations from the spec's letter are all in the Decisions and reach the spec in Task 5.
- No protocol change: `Emerge` is already a wire state; `emergeTo` and the record are host-only and outside `serializeWorldState`.
- Determinism: the only draw is `guideWalk` from the world RNG on the flip tick; forks judged in ascending order; ties everywhere to the lower index or id.
- The corridor walk-out shipped on 2026-09-25 remains the safety net; this plan never relies on it.
