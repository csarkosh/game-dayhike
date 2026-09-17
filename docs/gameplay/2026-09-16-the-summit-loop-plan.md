# The Summit Loop (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the register-and-count loop with the summit loop: a climb, then — from the tick the first living player finds the crucified hiker at the crest — a chase by one summit Hollow, with the road corridor as safe ground, an end rule that groups the survived and the perished, and escalation driven by the party's climb.

**Architecture:** A phase machine over the shipped parts. `WorldState` gains `phase` and each player a per-tick `safe`; items, carry and the sign-out are deleted, not disabled. `sim/register.ts` shrinks to the poster's hiker, the box, the car and the body's place at the crest; a new `sim/summit.ts` owns the phase flip, safety and the end rule; `sim/hollow.ts` keeps movement, contact and the stare and replaces crawl/bind/split/merge with Emerge → Hunt → Stand and the treeline clamp. Protocol 5 carries the phase and the safe bit and drops the items section; a new `Named` event lets every peer put a name to an entity id for the end screen. The client gets a poster panel, an end panel, a body placeholder mesh, and escalation's world input becomes the party's best stem progress.

**Tech Stack:** TypeScript, Babylon.js (client meshes/DOM screens), vitest, fast-check (the codec tests).

**Spec:** `docs/gameplay/2026-09-16-the-summit.md` §2 (the loop), §5.1 (the summit), §5.2 (safety), §6 (escalation), §7 (client and wire), §8 (architecture), §10 (verification). Parent docs for what is kept: `docs/gameplay/2026-09-15-the-hollow.md` (C: movement, contact, the stare), `docs/gameplay/2026-09-16-escalation-and-atmosphere.md` (D: the model).

## Rulings that amend the spec (recorded here; Task 10 writes them into the spec's Status line)

- The Poe passages live in `client/src/game/registerHud.ts` today (`DEATH_LINE`, `LOSS_LINE`, `WIN_LINE`), not `script.ts` (which is the `?cmd` script). They move to a new `client/src/game/passages.ts`; the end screen's three passages join them there.
- The roster is untouched: it is the lobby's party list and shows no dead-versus-living state today (that is P's, #14), so "a safe player shows in the roster the way a dead one does" has nothing to attach to. The end panel is where the groups show.
- `PlayerState.respawnTimer` leaves the wire and the state with this protocol bump (it has read 0 since death became permanent); the snapshot's player record becomes: id, pos, vel, yaw, pitch, health, grounded, lamp byte, flags byte (bit 0 = safe), stare.
- Names for the end screen: nothing maps a lobby member (peer id) to an entity id today. Protocol 5 adds a `Named { entityId, peerId }` event: the host sends a joining peer every current pairing (its own included) and tells everyone else the newcomer's; `app.ts` turns peer ids into names through the lobby's members. Solo play names the local player "You".
- A Hollow with no living, unsafe target stands where it is, facing the pad: a third state, `AiState.Stand`, rather than an Emerge with no timer. `AiState.Crawl` and `AiState.Merge` are deleted with the code that used them (their numbers 4 and 6 stay unused; the wire carries the byte, and no old peer is admitted).
- The wall line (`roadLine`) survives with the wall: on the climb it says "Not yet. Somebody is still up there."; in the chase, nothing — the corridor is safety, and reaching it is its own line on the end panel.
- The sign posts stay and read the summit as their one site; the trailhead board's lines become the poster's.

## Global Constraints

- Work in a fresh worktree off latest `origin/main`: `git fetch origin && git worktree add -b worktree-s1-summit .claude/worktrees/s1-summit origin/main`. Stage explicit paths only; never `git add -A`.
- Commit messages: Conventional Commits subject under 72 chars, a `## What` paragraph, a `## How` list led by file paths in backticks, entry point first; trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The repo is public: never cite any private process or tooling in code, comments, commits or docs.
- `client/src/sim/` never imports `net/`, `game/` or Babylon (ESLint). `sim/` determinism: no trig, no `Math.pow`, no `**`, no `Math.hypot` outside the host-only Hollow step (which already uses `Math.atan2` for a facing, by the same exemption `architecture.test.ts` grants); every draw from `nextRandom(state)`.
- Exact values from the spec: `DISCOVERY_RADIUS = 12` m; `SUMMIT_SPAWN_DIST = 6` m behind the body; `SUMMIT_REVEAL_S = 2`; `HOLLOW_HUNT_SPEED = 6.3`; `HOLLOW_LOOK_FACTOR = 0.6`; `HOLLOW_APPROACH_RANGE = 25` (unchanged); safety is `|u| < ROAD_CORRIDOR_HALF` (30 m) with `u` the road offset from `roadCenterX(seed, z)`; the end: no living unsafe player → `Won` if any player is safe, else `Lost`; the stare 6 s fill / 3 s empty / kills at 1 (unchanged); contact kills whoever it touches.
- Death is permanent; the dead stay as peers (unchanged).
- `PROTOCOL_VERSION = 5`. Nothing about the world crosses the wire beyond the snapshot and the events named here.
- Every screen is a pure model plus a dumb renderer, `textContent` only, CSS in a template literal, z-order below the pause menu (18) and the roster (20) — the register panel's 16 is the poster's and the end panel's.
- Run the focused tests per task; before Task 10's final commit run `npm run typecheck && npm run lint && npm test` from the repo root (the client suite has 227-seed sweeps; if the machine is loaded, re-run the client suite alone with `npx vitest run --root client --maxWorkers=2`).
- A test tolerance never rewrites a spec rule; fix the fixture. Placeholder screens and meshes are placeholders: primitives and `StandardMaterial` (a PBR material with fog off never compiles under the atmosphere plugin).

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/types.ts` | `Phase`; `AiState` minus Crawl/Merge, plus `Emerge`, `Stand`; `PlayerState` minus carrying/signOutTicks/signedOut/respawnTimer, plus `safe`; `WorldState` minus `items`, plus `phase`; `ItemState`, `NO_ITEM`, `NO_CARRIER` deleted. |
| `client/src/sim/register.ts` | The poster's hiker (one name), the body's place at the crest, the box and the car; the box interactable. No items, no rules. |
| `client/src/sim/summit.ts` (new) | `stepSummit`: safety per player, the discovery flip (spawns the summit Hollow), the end rule. `roadOffset`, `isOnCorridor`. |
| `client/src/sim/hollow.ts` | Movement, contact, the stare, `playerSees`; `Emerge` (timer → Hunt), `Hunt` (retarget on death/safety), `Stand`; the treeline clamp. Crawl, bind, split, merge deleted. |
| `client/src/sim/world.ts` | No Hollow at creation; `stepSummit` in the tick; `updateDeaths` without the drop; clone/fingerprint for the new fields. |
| `client/src/net/protocol.ts` | Protocol 5: player record 28 bytes, `phase` byte, no items; `MessageType.Named`. |
| `client/src/net/hostSession.ts`, `clientSession.ts` | Snapshot build/apply for the new fields; `Named` send and receive (`onNamed`). |
| `client/src/game/escalation.ts` | World input = the party's best stem progress, pinned 1 in Chase; `progressMax`; vignette clamp is in `atmosphereUnder` (dread ≤ 1). |
| `client/src/game/passages.ts` (new) | `DEATH_LINE`, `END_PASSAGES` (three), `roadLine`. Replaces `registerHud.ts`. |
| `client/src/game/posterPanel.ts` (new) | `posterModel(register)` + the panel. Replaces `registerPanel.ts`. |
| `client/src/game/endPanel.ts` (new) | `endPanelModel(outcome, players, localId, names)` + the panel: passage, survived, perished. |
| `client/src/game/bodyMesh.ts` (new) | The crucified hiker placeholder at `register.body`. |
| `client/src/game/entityViews.ts`, `renderer.ts` | Item meshes and the carried bundle deleted. |
| `client/src/app.ts` | The poster instead of the book; the end panel; the body mesh; names; signs from the one site; item audio gone. |
| Tests | `test/sim/summit.test.ts` (new), `test/sim/summitRun.test.ts` (new, the whole run), `hollow.test.ts`, `register*.test.ts`, `world.test.ts`, `death.test.ts`, `signsSweep.test.ts`, `test/net/protocol.test.ts`, `clientSession.test.ts`, `hostSession.test.ts`, `test/game/escalation.test.ts`, `passages.test.ts` (new), `posterPanel.test.ts` (new), `endPanel.test.ts` (new), `entityViews.test.ts`, `wildlifeAudio.test.ts` (the app wiring assertions). |

---

### Task 1: The state without the count — types, the register shrunk, the world

Removes items, carry, the sign-out and the crawl from the state and the sim so everything compiles with `phase` and `safe` in place. The Hollow's binding rules go here too (they read `carrying`); its new states come in Task 3. After this task the forest has no Hollow at all and no win: the world is a climb with nothing at the top yet.

**Files:**
- Modify: `client/src/sim/types.ts`
- Modify: `client/src/sim/register.ts`
- Modify: `client/src/sim/world.ts`
- Modify: `client/src/sim/hollow.ts` (delete `crawl`, `release`, the binding and merge blocks, `isHunted`'s `signedOut` use, `HOLLOW_CRAWL_SPEED`, `HOLLOW_MERGE_RADIUS`, `nearestOtherHollow`, `stemDir` uses)
- Modify: `client/src/game/escalation.ts` (only enough to compile: drop `retrievedCount`/`register`; Task 5 finishes it)
- Modify: `client/src/net/hostSession.ts`, `client/src/net/clientSession.ts`, `client/src/net/protocol.ts` (only the field removals needed to compile; Task 2 does the codec)
- Modify: `client/src/game/entityViews.ts`, `client/src/game/renderer.ts`, `client/src/app.ts` (delete the item meshes, the carried bundle, `syncRegisterAudio`, the `carrying`/`signOutTicks` reads in `syncPrompt`; Task 9 does the rest of `app.ts`)
- Tests: `client/test/sim/world.test.ts`, `client/test/sim/register.test.ts`, `client/test/sim/registerRules.test.ts` (delete), `client/test/sim/registerSweep.test.ts`, `client/test/sim/death.test.ts`, `client/test/sim/hollow.test.ts`, `client/test/game/escalation.test.ts`, `client/test/game/entityViews.test.ts`, `client/test/net/clientSession.test.ts`, `client/test/net/protocol.test.ts`, `client/test/game/registerPanel.test.ts` (delete), `client/test/game/registerHud.test.ts` (delete), `client/test/sim/signsSweep.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export const enum Phase { Climb = 0, Chase = 1 }
  export const enum AiState {
    Idle = 0, Chase = 1, Attack = 2, Dead = 3,
    /** The Hollow bound to `targetId`, a player, and walking at them. */
    Hunt = 5,
    /** The Hollow stepping out: still for `stateTimer` seconds, facing `targetId`, then Hunt. */
    Emerge = 7,
    /** The Hollow with nobody left to hunt: still where it stands, facing the pad. */
    Stand = 8,
  }
  // PlayerState: `safe: boolean` added ("On the road corridor this tick; never targeted, never killed. Host truth, one bit on the wire."); carrying, signOutTicks, signedOut, respawnTimer removed.
  // WorldState: `phase: Phase` added; `items` removed. ItemState, NO_ITEM, NO_CARRIER removed.
  ```
- Produces, in `register.ts`:
  ```ts
  export const BOX_RADIUS = 0.4; export const BOX_HEIGHT = 1; export const BOX_INTERACTABLE_ID = 2;
  export const enum InteractKind { Debug = 0, Register = 2 }
  export type Register = {
    /** The one missing hiker, as the poster names them. */
    hiker: { name: string };
    /** Where the body is found: the crest, facing the stem's arrival. */
    body: { pos: Vec3; yaw: number };
    box: Vec3;
    car: Vec3;
  };
  export type RegisterInput = { seed: number; graph: TrailGraph; groundH(x: number, z: number): number; box: { x: number; z: number }; car: { x: number; z: number } };
  export function buildRegister(input: RegisterInput): Register;
  export function installRegister(world: World, register: Register): void; // sets world.register, registers the box interactable with label "Read the poster"
  ```
  `landmarks` leaves `RegisterInput` (sites are gone).

- [ ] **Step 1: Types**

In `client/src/sim/types.ts`: replace the `AiState` enum with the one above (keep the comments' voice; Crawl and Merge go). Add after `Outcome`:

```ts
/** The match's two acts (docs/gameplay/2026-09-16-the-summit.md §2). Host truth, one byte on the wire. */
export const enum Phase {
  Climb = 0,
  Chase = 1,
}
```

Delete `NO_ITEM`, `NO_CARRIER` and the `ItemState` type. In `PlayerState` delete `respawnTimer`, `carrying`, `signOutTicks`, `signedOut`; add, after `stare`:

```ts
  /**
   * On the road corridor this tick — within ROAD_CORRIDOR_HALF of the road's
   * centreline (summit.ts). A safe player is never targeted and never killed,
   * and steps back into the woods a target again. Host truth; rides the
   * snapshot as one bit so every peer's end screen agrees.
   */
  safe: boolean;
```

In `WorldState` delete `items`; add `phase: Phase;` after `outcome` with the comment `/** Climb until the first living player finds the body; Chase from then on (summit.ts). */`.

- [ ] **Step 2: The register shrunk**

Rewrite `client/src/sim/register.ts` to exactly this (the module comment in the file's voice):

```ts
/**
 * The poster and the place: the one missing hiker the poster names, the box
 * on its post the poster hangs on, the car, and where the body is found.
 * All of it follows from the seed and the trail graph, so every peer reads
 * the same poster with nothing on the wire. The rules that turn the find into
 * the chase live in summit.ts.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { Vec3 } from "./types.js";
import { cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import { CAR_HALF } from "./passes/trailhead.js";
import { hikerNames } from "./hikerNames.js";

export const BOX_RADIUS = 0.4;
/** Chest height on the 1.2 m post, where the poster hangs. */
export const BOX_HEIGHT = 1;
export const BOX_INTERACTABLE_ID = 2;

export const enum InteractKind {
  Debug = 0,
  Register = 2,
}

export type Register = {
  /** The one missing hiker, as the poster names them. */
  hiker: { name: string };
  /** Where the body is found: the crest, facing the stem's arrival. `yaw` is the facing, as a player's. */
  body: { pos: Vec3; yaw: number };
  /** The box on its post: what the hand reaches for. */
  box: Vec3;
  /** The car's centre. */
  car: Vec3;
};

export type RegisterInput = {
  seed: number;
  graph: TrailGraph;
  groundH(x: number, z: number): number;
  /** The post's and the car's sites (`propSite` over PROPS[0] and PROPS[2]). */
  box: { x: number; z: number };
  car: { x: number; z: number };
};

/**
 * The body faces the way a climber arrives: from the crest back down the
 * stem's last edge. A facing needs no trig: `yaw` is what `aimDirection`
 * inverts, so it is written as atan2 would give it — but atan2 is trig, and
 * this runs on every peer. The direction is stored as a unit vector's yaw
 * computed by the caller-free rule below: yaw = 0 faces +z, and a quarter
 * turn per axis; on a stem the last edge is never degenerate.
 */
function facingYaw(dx: number, dz: number): number {
  // A piecewise-linear atan2 over eight octants is exact at the axes and
  // within 0.07 rad between them — enough for a body to read as facing the
  // trail, and bit-identical everywhere.
  const ax = dx < 0 ? -dx : dx, az = dz < 0 ? -dz : dz;
  const t = ax + az === 0 ? 0 : ax / (ax + az); // 0 on +z, 1 on +x
  const quarter = Math.PI / 2;
  let yaw = t * quarter; // first octant pair: +x, +z
  if (dz < 0) yaw = Math.PI - yaw;
  if (dx < 0) yaw = -yaw;
  return yaw;
}

/** The poster's hiker, the body's place, the box and the car, all from the seed. */
export function buildRegister(input: RegisterInput): Register {
  const { graph, groundH } = input;
  const crest = graph.nodes[graph.summit] as TrailNode;
  const lastEdge = graph.edges[graph.stem[graph.stem.length - 1] as number];
  const from = lastEdge === undefined ? crest : (graph.nodes[lastEdge.a === graph.summit ? lastEdge.b : lastEdge.a] as TrailNode);
  const body = {
    pos: { x: crest.x, y: groundH(crest.x, crest.z), z: crest.z },
    yaw: facingYaw(from.x - crest.x, from.z - crest.z),
  };
  return {
    hiker: { name: hikerNames(input.seed, 1)[0] as string },
    body,
    box: { x: input.box.x, y: groundH(input.box.x, input.box.z) + BOX_HEIGHT, z: input.box.z },
    car: { x: input.car.x, y: groundH(input.car.x, input.car.z) + CAR_HALF.y, z: input.car.z },
  };
}

/**
 * Registers the box as the one interactable the poster hangs on. Called on
 * the host's world and on a client's predicted world alike, so both resolve
 * the same thing in reach; reading the poster is the client's own screen.
 */
export function installRegister(world: World, register: Register): void {
  world.register = register;
  world.interactables.set(BOX_INTERACTABLE_ID, {
    id: BOX_INTERACTABLE_ID,
    pos: cloneVec3(register.box),
    radius: BOX_RADIUS,
    kind: InteractKind.Register,
    label: "Read the poster",
    onInteract: () => undefined,
  });
}
```

- [ ] **Step 3: The world**

In `client/src/sim/world.ts`: remove the `putDown`/`stepRegister` imports and the `spawnHollow`/`AiState`/`ENEMY_HALF` imports that no longer have a use; `createWorld` and `createForestWorld` initialise `state` with `phase: Phase.Climb` and no `items`; `createForestWorld` no longer spawns a Hollow (delete the block and its comment) and passes `buildRegister({ seed, graph, groundH, box: post, car })` (no `landmarks`); `spawnPlayer` initialises `safe: false` and drops the removed fields; `tickWorld`'s authoritative tail becomes:

```ts
  if (world.trail !== null) {
    // A forest has the Hollow and no director (hollow.ts).
    stepHollows(world, TICK_DT);
    updateHollows(world);
  } else {
    for (const enemy of world.state.enemies.values()) stepEnemy(enemy, world, TICK_DT);
    for (const [id, enemy] of world.state.enemies) if (isExpiredCorpse(enemy)) world.state.enemies.delete(id);
    updateDirector(world);
  }
  updateDeaths(world);
  updateLoss(world);
```

(`stepSummit` is added by Task 4.) `updateDeaths` no longer calls `putDown`. `cloneWorldState` drops `items`, copies `phase`; `serializeWorldState` writes `ph:${state.phase}` after `o:`, drops the `I…` lines, and the player line becomes `…,${p.lamp.on ? 1 : 0},${Math.round(p.lamp.charge * 127)},${p.safe ? 1 : 0},${p.stare}` (respawnTimer, carrying, signOutTicks gone).

- [ ] **Step 4: The Hollow stripped**

In `client/src/sim/hollow.ts`: delete `HOLLOW_CRAWL_SPEED`, `HOLLOW_MERGE_RADIUS`, `nearestOtherHollow`, `crawl`, `nearestStemIndex`, `release`, `nearestTo`, the Merge case of `stepHollow`, and in `updateHollows` everything after the stare block (releases, binding, merges). `isHollowState` becomes `ai === AiState.Hunt || ai === AiState.Emerge || ai === AiState.Stand`. `speedOf` becomes `const base = HOLLOW_HUNT_SPEED; return h.seen ? base * HOLLOW_LOOK_FACTOR : base;`. `spawnHollow` drops `stemDir` from the record (delete the field from `EnemyState` in `types.ts` too, and from `clientSession.ts`'s enemy construction). `isHunted` stays. `stepHollow`'s Hunt case stays; Emerge and Stand cases are Task 3's (for now `default: return`). The module comment's first paragraph becomes: "The Hollow (docs/gameplay/2026-09-16-the-summit.md §5): the figure that steps out at the crest when the body is found and hunts the party down the mountain. It cannot be killed. Contact kills, and being looked at slows it at the price of the looker's stare."

- [ ] **Step 5: Compile the rest**

`client/src/game/escalation.ts`: `escalationTargets(state, localId, graph, boxes, ground)` — drop the `register` parameter and the `floor`; `world = creep` for now (Task 5 rewrites it). `client/src/net/protocol.ts`: remove `respawnTimer`, `carrying`, `signOutTicks` from `SnapshotPlayer`, `SnapshotItem` and `items` from `Snapshot`, and their bytes from the codec; add `phase: number` to `Snapshot` after `outcome` and encode/decode it as one byte after the outcome byte (the full layout and `PROTOCOL_VERSION = 5` are Task 2's; do the minimum here so it compiles and round-trips). `hostSession.ts` `buildSnapshot`: drop the removed fields, add `phase: world.state.phase`, and a player `safe: p.safe`. `clientSession.ts`: drop `respawnTimer`/`carrying`/`signOutTicks`/`items`/`syncItemInteractables`; copy `safe` onto the local player and remote players; `predicted.state.phase = snapshot.phase`; `renderState` returns `phase: latest?.phase ?? Phase.Climb`. `entityViews.ts`: delete `items`, `itemMaterial`, the item loop and disposal, the `NO_CARRIER` import. `renderer.ts`: delete the carried bundle (the mesh around line 660 and its `setEnabled` at ~978) and the `NO_ITEM` import. `app.ts`: delete `syncRegisterAudio`, `lastCarriers`, the `syncRoadLine`'s `state.items` reads (make it `if (self === undefined || roadCenterX === undefined) return; const line = roadLine(u, state.phase);` — `roadLine`'s new signature is Task 7's; for now pass `state.phase === Phase.Chase` to the existing boolean and rename nothing else), `syncPrompt`'s `carrying`/`hold` (pass `{ carrying: null, hold: 0 }` for now — Task 9 removes the option from the prompt model), `syncBook`'s `self.carrying !== NO_ITEM` guard, and the `NO_CARRIER`/`NO_ITEM` imports. `client/src/game/interactPrompt.ts`: leave for Task 9.

- [ ] **Step 6: Tests — delete, then fix**

Delete `client/test/sim/registerRules.test.ts`, `client/test/game/registerPanel.test.ts`, `client/test/game/registerHud.test.ts` (their replacements come with Tasks 7–8). In `client/test/sim/hollow.test.ts` delete `describe("the crawl")`, and every test of binding, splitting, merging, the release on sign-out and `HOLLOW_CRAWL_SPEED`/`HOLLOW_MERGE_RADIUS`; keep the contact, look, stare and hunt-movement tests (spawn with `AiState.Hunt` and a `targetId` directly). In `client/test/sim/world.test.ts` replace `describe("items in world state")` with:

```ts
describe("the phase and safety in world state", () => {
  it("starts on the climb, playing, unsafe", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    expect(w.state.phase).toBe(Phase.Climb);
    expect(w.state.outcome).toBe(Outcome.Playing);
    expect(p.safe).toBe(false);
  });

  it("clones the phase and fingerprints the phase and safety", () => {
    const w = createWorld(flat, 1);
    const p = spawnPlayer(w);
    w.state.phase = Phase.Chase;
    const copy = cloneWorldState(w.state);
    expect(copy.phase).toBe(Phase.Chase);
    const a = serializeWorldState(w.state);
    p.safe = true;
    const b = serializeWorldState(w.state);
    expect(a).not.toBe(b);
    expect(b).toContain("ph:1");
  });
});
```

(`flat`, `spawnPlayer`, `cloneWorldState`, `serializeWorldState` are already in that file.) `client/test/sim/register.test.ts` and `registerSweep.test.ts`: replace their bodies with Task 4's register tests (Step 6 there) — for this task, delete every test that references `hikers`, `items`, `sites`, `MIN_SITES`; keep the file with one test:

```ts
it("names one hiker and puts the body on the crest facing down the stem", () => {
  const g = graph(1);
  const r = buildRegister({ seed: 7, graph: g, groundH: () => 0, box: { x: 0, z: -20 }, car: { x: 30, z: -20 } });
  expect(r.hiker.name.length).toBeGreaterThan(0);
  expect(r.body.pos).toEqual({ x: 200, y: 0, z: 0 });
  // The stem's last edge runs +x from node 1 to the crest, so the body faces -x: yaw = -pi/2.
  expect(r.body.yaw).toBeCloseTo(-Math.PI / 2, 6);
  expect(r.box).toEqual({ x: 0, y: 1, z: -20 });
});
```

`client/test/sim/death.test.ts`: delete the assertion that a carried item drops on death (keep the rest). `client/test/game/escalation.test.ts`: change `targetsOf` to `escalationTargets(w.state, id, w.trail!, w.boxes, w.ground)` and delete the two tests about the retrieval floor ("floors on hikers picked up…", "takes the greater of the floor and the creep") — Task 5 writes the new world tests. `client/test/game/entityViews.test.ts`: delete `describe("EntityViews items")` and the `items:` field in its `state()` helper; add `phase: Phase.Climb`. `client/test/net/clientSession.test.ts`: delete `describe("items and outcome")` and the item test at ~549; Task 2 adds the phase/safe test. `client/test/net/protocol.test.ts`: remove `items`, `respawnTimer`, `carrying`, `signOutTicks` from `sampleSnapshot()` and the round-trip assertions; add `phase: 1` and `safe: i === 3`; change the size pin to the value Task 2 fixes (`695`) — for this task the exact number is whatever the codec now produces; Task 2 pins it. `client/test/sim/signsSweep.test.ts`: `signPosts(graph, [{ name: "the summit", x: crest.x, z: crest.z }])` with `const crest = graph.nodes[graph.summit]!`, and the site-name assertion checks "the summit" only.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint` from the repo root, then `cd client && npx vitest run test/sim/world.test.ts test/sim/register.test.ts test/sim/hollow.test.ts test/sim/death.test.ts test/game/escalation.test.ts test/game/entityViews.test.ts test/net/protocol.test.ts test/net/clientSession.test.ts test/net/hostSession.test.ts`
Expected: typecheck and lint clean; every listed file green.

- [ ] **Step 8: Commit**

```bash
git add client/src/sim/types.ts client/src/sim/register.ts client/src/sim/world.ts client/src/sim/hollow.ts client/src/game/escalation.ts client/src/net/protocol.ts client/src/net/hostSession.ts client/src/net/clientSession.ts client/src/game/entityViews.ts client/src/game/renderer.ts client/src/app.ts client/test
git commit -m "refactor: drop the count — items, carry and the sign-out leave the sim"
```

---

### Task 2: Protocol 5

**Files:**
- Modify: `client/src/net/protocol.ts`
- Modify: `client/src/net/hostSession.ts`, `client/src/net/clientSession.ts`
- Test: `client/test/net/protocol.test.ts`, `client/test/net/clientSession.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PROTOCOL_VERSION = 5;
  export type SnapshotPlayer = { id; pos; vel; yaw; pitch; health; grounded; lamp; safe: boolean; stare: number };
  export type Snapshot = { tick; lastProcessedInput; players; enemies; outcome: number; phase: number };
  export const enum MessageType { …, SessionEnded = 10, Named = 11 }
  // NetEvent gains { t: MessageType.Named; entityId: number; peerId: string }
  export function encodeFlagsByte(p: { safe: boolean }): number; export function decodeFlagsByte(b: number): { safe: boolean };
  ```
  `PLAYER_BYTES = 28`; the sample 5-player, 30-enemy snapshot encodes to **695** bytes (1+4+4+2 + 5·28 + 2 + 30·18 + 1 + 1).
- `clientSession` gains `onNamed(handler: (e: { entityId: number; peerId: string }) => void): void`; `hostSession.addPeer` sends the newcomer every current pairing (the host's own as `{ entityId: localEntityId, peerId: hostPeerId }`) and every other peer the newcomer's. `createHostSession` takes `hostPeerId: string` in its options (`{ forest, hostPeerId }`; `app.ts` passes `lobby?.state.hostId ?? "host"`).

- [ ] **Step 1: Write the failing tests**

In `client/test/net/protocol.test.ts`, `sampleSnapshot()` players carry `safe: i === 3`, no items, `phase: 1`; the round-trip asserts `actual.safe === expected.safe` and `back.phase === 1`; the budget test:

```ts
  it("stays within the bandwidth budget", () => {
    // 695 bytes at 20 Hz is about 14 KB/s down per client, and 56 KB/s up for
    // a host serving four of them: protocol 4's 774 less the items section
    // (65 bytes for four), less four bytes per player (the respawn timer, the
    // carried item and the sign-out ticks), plus the flags byte per player
    // and the phase byte.
    expect(encodeSnapshot(sampleSnapshot()).byteLength).toBe(695);
  });
```

Add to the events describe:

```ts
  it("round-trips Named with a peer id up to 255 bytes", () => {
    const e = { t: MessageType.Named as const, entityId: 7, peerId: "a0b1c2d3-e4f5-6789-abcd-ef0123456789" };
    expect(decodeEvent(encodeEvent(e))).toEqual(e);
  });
```

In `client/test/net/clientSession.test.ts`, replace the deleted items describe with:

```ts
describe("the phase and safety", () => {
  it("carries the phase and each player's safety into the render state and onto the local player", () => {
    const h = harness();
    const me = h.client.localEntityId;
    h.host.world.state.phase = Phase.Chase;
    h.host.world.state.players.get(me)!.safe = true;
    drive(h, 2);
    const state = h.client.renderState(h.net.now);
    expect(state.phase).toBe(Phase.Chase);
    expect(h.client.localPlayer()!.safe).toBe(true);
    expect(state.players.get(me)!.safe).toBe(true);
  });

  it("starts on the climb before any snapshot", () => {
    const h = harness();
    expect(h.client.renderState(h.net.now).phase).toBe(Phase.Climb);
  });

  it("learns every peer's name pairing on join, and the next joiner's", () => {
    const h = harness();
    const named: Array<{ entityId: number; peerId: string }> = [];
    h.client.onNamed((e) => named.push(e));
    drive(h, 1);
    expect(named).toContainEqual({ entityId: h.host.localEntityId, peerId: "host" });
    expect(named).toContainEqual({ entityId: h.client.localEntityId, peerId: h.peerId });
  });
});
```

(Use the file's existing `harness()`/`drive()` helpers; if `harness()` does not expose the client's peer id, add `peerId` to what it returns — it already passes one to `addPeer`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/net/protocol.test.ts test/net/clientSession.test.ts`
Expected: FAIL — the size is not 695, `Named` does not exist, `onNamed` is not a function.

- [ ] **Step 3: The codec**

In `client/src/net/protocol.ts`: `PROTOCOL_VERSION = 5` with the version comment's first clause updated ("most recently: the summit loop — the phase, one byte; each player's flags byte, whose bit 0 is safety; the items section, the respawn timer, the carried item and the sign-out ticks gone; the Named event"). Add `Named = 11` to `MessageType` and the `NetEvent` member. Delete `RESPAWN_SCALE`, `SnapshotItem`, `ITEM_BYTES`. Add:

```ts
/** Per-player flags in one byte: bit 0 is `safe` (on the road corridor). Bits 1-7 are free. */
export function encodeFlagsByte(p: { safe: boolean }): number {
  return p.safe ? 1 : 0;
}
export function decodeFlagsByte(b: number): { safe: boolean } {
  return { safe: (b & 1) !== 0 };
}
```

`PLAYER_BYTES = 28`. In `encodeSnapshot`, the player loop writes after `grounded`: `view.setUint8(o, encodeLampByte(p.lamp)); o += 1; view.setUint8(o, encodeFlagsByte(p)); o += 1; view.setUint8(o, clamp(Math.round(p.stare * 255), 0, 255)); o += 1;` and nothing else; after the enemies: `view.setUint8(o, snapshot.outcome & 0xff); o += 1; view.setUint8(o, snapshot.phase & 0xff); o += 1;`; the size sum is `1 + 4 + 4 + 2 + players * PLAYER_BYTES + 2 + enemies * ENEMY_BYTES + 1 + 1`. `decodeSnapshot` mirrors it (`const { safe } = decodeFlagsByte(view.getUint8(o))`). `encodeEvent`/`decodeEvent` for `Named`: `[type u8][entityId u16 LE][len u8][peerId utf8]` — the same shape as `SessionEnded` with the entity id in front; bound the length read to the buffer like `Welcome` does.

- [ ] **Step 4: The sessions**

`hostSession.ts`: `createHostSession(level, seed, clock, options: { forest?: Forest; hostPeerId?: string })` — store `const hostPeerId = options.hostPeerId ?? "host"`. In `addPeer`, after the `Welcome`:

```ts
      // Who is who, for the end screen's names: every pairing so far to the
      // newcomer (the host's own first), the newcomer's to everyone else.
      transport.sendEvent(encodeEvent({ t: MessageType.Named, entityId: localPlayer.id, peerId: hostPeerId }));
      for (const other of peers.values()) {
        transport.sendEvent(encodeEvent({ t: MessageType.Named, entityId: other.entityId, peerId: other.peerId }));
        if (other.peerId === peerId) continue;
        other.transport.sendEvent(encodeEvent({ t: MessageType.PlayerJoined, entityId: player.id }));
        other.transport.sendEvent(encodeEvent({ t: MessageType.Named, entityId: player.id, peerId }));
      }
```

(replacing the existing `PlayerJoined` loop; the newcomer's own record is already in `peers`, so it receives its own pairing too). `buildSnapshot` players: `{ id, pos, vel, yaw, pitch, health, grounded, lamp, safe: p.safe, stare: p.stare }`, and `phase: world.state.phase`.

`clientSession.ts`: a `namedHandler` beside `interactedHandler`; `case MessageType.Named: namedHandler?.({ entityId: event.entityId, peerId: event.peerId }); break;`; `onNamed(handler) { namedHandler = handler; }` on the returned object and its type. The snapshot apply copies `local.safe = authoritative.safe` and `predicted.state.phase = snapshot.phase`; `renderState` builds remote players with `safe: p.safe` and returns `phase`.

- [ ] **Step 5: Run the tests**

Run: `cd client && npx vitest run test/net/protocol.test.ts test/net/clientSession.test.ts test/net/hostSession.test.ts test/net/wireRange.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/net/protocol.ts client/src/net/hostSession.ts client/src/net/clientSession.ts client/test/net/protocol.test.ts client/test/net/clientSession.test.ts client/test/net/hostSession.test.ts
git commit -m "feat: protocol 5 — the phase, the safe bit and who is who"
```

---

### Task 3: The Hollow's three states and the treeline

**Files:**
- Modify: `client/src/sim/hollow.ts`
- Modify: `client/src/sim/containment.ts` (the corridor test)
- Test: `client/test/sim/hollow.test.ts`

**Interfaces:**
- Produces, in `containment.ts`:
  ```ts
  /** The road offset of a point, or null on a world with no road: `x − roadCenterX(seed, z)`. */
  export function roadOffset(world: World, x: number, z: number): number | null;
  /** On the road corridor: within ROAD_CORRIDOR_HALF of the centreline. False with no road. */
  export function isOnCorridor(world: World, x: number, z: number): boolean;
  ```
  (`ROAD_CORRIDOR_HALF` is imported from `./road.js`; `roadCenterX` from `activeTerrainVariant()`, as `world.ts`'s `applyMove` does.)
- Produces, in `hollow.ts`:
  ```ts
  export const HOLLOW_HUNT_SPEED = 6.3;
  export const HOLLOW_LOOK_FACTOR = 0.6;
  export const SUMMIT_REVEAL_S = 2;
  /** Spawns a Hollow at `at` in Emerge for `revealS` seconds, then it hunts `targetId`. */
  export function spawnHollow(world: World, at: Vec3, targetId: number, revealS: number): EnemyState;
  /** The living, unsafe player nearest `pos`, ties to the lower id; null when there is none. */
  export function nearestPrey(world: World, pos: Vec3): PlayerState | null;
  ```
  Rules: **Emerge** — still, `yaw` toward its target, `stateTimer` counts down by `dt`; at 0 → Hunt. **Hunt** — `pursue` its target; when the target is dead, gone or safe → `nearestPrey`, else → Stand. **Stand** — still; each tick, if `nearestPrey` finds someone → Hunt them. **Treeline:** a Hollow's step that would land it on the corridor is refused (position and velocity restored), and it faces the pad (yaw toward the trailhead). **Contact** kills any living unsafe player it touches. The stare unchanged, but a safe player's stare still fills (looking back from the road is allowed to hurt) — no: rule it simply: the stare rules are unchanged for everyone, safe or not; contact never touches a safe player.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/hollow.test.ts` (the file's `world()`, `tick`, `dist` helpers exist; a world with a road needs a forest world — use the road-less flat world for the states and `test/sim/summit.test.ts` (Task 4) for the corridor on a real forest):

```ts
describe("emerge, hunt, stand", () => {
  it("stands still for the reveal, facing its target, then hunts", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 20 };
    const h = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, p.id, SUMMIT_REVEAL_S);
    expect(h.ai).toBe(AiState.Emerge);
    tick(w, Math.round(SUMMIT_REVEAL_S / TICK_DT) - 2);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.pos).toEqual({ x: 100, y: expect.any(Number), z: 0 });
    expect(Math.abs(h.yaw)).toBeLessThan(0.01); // facing +z, toward the player
    tick(w, 4);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
    tick(w, 30);
    expect(h.pos.z).toBeGreaterThan(1);
  });

  it("hunts at the hunt speed, slowed to the look factor while seen", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 200, y: 0.9, z: 0 };
    p.yaw = Math.PI; // facing -z, away from the Hollow at +x... set below
    const h = spawnHollow(w, { x: 20, y: ENEMY_HALF.y, z: 0 }, p.id, 0);
    tick(w, 1);
    const x0 = h.pos.x;
    tick(w, 60);
    expect(h.pos.x - x0).toBeCloseTo(HOLLOW_HUNT_SPEED, 0);
    // Now look straight at it: yaw = atan2(dx, dz) with dx < 0, dz = 0 → -pi/2.
    p.yaw = -Math.PI / 2;
    tick(w, 1);
    const x1 = h.pos.x;
    tick(w, 60);
    expect(h.pos.x - x1).toBeCloseTo(HOLLOW_HUNT_SPEED * HOLLOW_LOOK_FACTOR, 0);
  });

  it("retargets the nearest living, unsafe player when its target dies, and stands when nobody is left", () => {
    const w = world();
    const a = spawnPlayer(w), b = spawnPlayer(w);
    a.pos = { x: 60, y: 0.9, z: 0 };
    b.pos = { x: 120, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, a.id, 0);
    tick(w, 2);
    a.health = 0;
    tick(w, 2);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(b.id);
    b.safe = true;
    tick(w, 2);
    expect(h.ai).toBe(AiState.Stand);
    const standing = { ...h.pos };
    tick(w, 30);
    expect(h.pos.x).toBeCloseTo(standing.x, 3);
    b.safe = false;
    tick(w, 2);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(b.id);
  });

  it("kills any living, unsafe player it touches — target or not — and never a safe one", () => {
    const w = world();
    const a = spawnPlayer(w), b = spawnPlayer(w);
    a.pos = { x: 200, y: 0.9, z: 0 };
    b.pos = { x: 0.5, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, a.id, 0);
    tick(w, 2);
    expect(b.health).toBe(0);
    const c = spawnPlayer(w);
    c.pos = { x: 0.5, y: 0.9, z: 0 };
    c.safe = true;
    tick(w, 2);
    expect(c.health).toBeGreaterThan(0);
  });
});
```

Adjust the second test's first `p.yaw` line: delete it (the player at +x facing +z does not see a Hollow at −x; the comment is enough).

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/sim/hollow.test.ts`
Expected: FAIL — `spawnHollow` has the old signature; `Emerge`/`Stand` unhandled; `nearestPrey` missing.

- [ ] **Step 3: Implement**

`client/src/sim/containment.ts` — add (imports: `ROAD_CORRIDOR_HALF` from `./road.js`, `activeTerrainVariant` from `./terrain.js`, `World` type):

```ts
/** The road offset of (x, z): `x - roadCenterX(seed, z)`, or null on a world with no road. */
export function roadOffset(world: World, x: number, z: number): number | null {
  if (world.forest === null) return null;
  const roadCenterX = activeTerrainVariant().roadCenterX;
  if (roadCenterX === undefined) return null;
  return x - roadCenterX(world.forest.seed, z);
}

/**
 * The road corridor: the cleared strip ROAD_CORRIDOR_HALF either side of
 * the centreline, where the pad and the car stand. Safe ground (summit.ts):
 * a player on it is never targeted and a Hollow never steps onto it.
 */
export function isOnCorridor(world: World, x: number, z: number): boolean {
  const u = roadOffset(world, x, z);
  return u !== null && (u < 0 ? -u : u) < ROAD_CORRIDOR_HALF;
}
```

`client/src/sim/hollow.ts`:

```ts
export const HOLLOW_HUNT_SPEED = 6.3;   // a touch under SPRINT_SPEED 7: walking, stopping or turning back is what closes the gap
export const HOLLOW_LOOK_FACTOR = 0.6;  // slowed while seen, less than C's 0.35: a glance back buys distance and costs the screen
export const SUMMIT_REVEAL_S = 2;

export function spawnHollow(world: World, at: Vec3, targetId: number, revealS: number): EnemyState {
  const hollow: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at), vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: ENEMY_MAX_HEALTH,
    ai: revealS > 0 ? AiState.Emerge : AiState.Hunt, targetId, stateTimer: revealS, attackCooldown: 0,
    lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0, route: [], routeAt: 0, approach: false, seen: false,
  };
  world.state.enemies.set(hollow.id, hollow);
  return hollow;
}

/** The living, unsafe player nearest `pos`, ties to the lower id; null when there is none. */
export function nearestPrey(world: World, pos: Vec3): PlayerState | null {
  let best: PlayerState | null = null;
  let bestSq = Infinity;
  for (const p of world.state.players.values()) {
    if (p.health <= 0 || p.safe) continue;
    const sq = horizontalDistSq(p.pos, pos);
    if (sq < bestSq || (sq === bestSq && best !== null && p.id < best.id)) { bestSq = sq; best = p; }
  }
  return best;
}

/** The facing toward (tx, tz), for a Hollow that is not walking. Host-only, so atan2 is allowed. */
function faceToward(h: EnemyState, tx: number, tz: number): void {
  const dx = tx - h.pos.x, dz = tz - h.pos.z;
  if (dx * dx + dz * dz > EPSILON * EPSILON) h.yaw = Math.atan2(dx, dz);
}
```

`walkToward` gains the treeline clamp: after `stepMovement`, `if (isOnCorridor(world, result.pos.x, result.pos.z)) { h.vel = { x: 0, y: 0, z: 0 }; const th = world.trail?.trailhead; if (th !== undefined) faceToward(h, th.x, th.z); return; }` before assigning `h.pos`/`h.vel` (the Hollow keeps its place at the treeline; the comment: "THE HOLLOW STAYS IN THE WOODS: a step onto the road corridor is refused and it stands at the treeline facing the pad. Safety is the corridor, not the car."). `stepHollow`:

```ts
function stepHollow(h: EnemyState, world: World, graph: TrailGraph, dt: number): void {
  switch (h.ai) {
    case AiState.Emerge: {
      const target = world.state.players.get(h.targetId);
      if (target !== undefined) faceToward(h, target.pos.x, target.pos.z);
      h.stateTimer -= dt;
      if (h.stateTimer <= 0) { h.ai = AiState.Hunt; clearRoute(h); }
      return;
    }
    case AiState.Hunt: {
      const target = world.state.players.get(h.targetId);
      if (target !== undefined) pursue(h, world, graph, dt, target.pos);
      return;
    }
    case AiState.Stand: {
      const th = graph.trailhead;
      faceToward(h, th.x, th.z);
      return;
    }
    default:
      return;
  }
}
```

In `updateHollows`, the contact loop skips `p.safe`; after the stare block, the retargeting replaces the old release/bind/merge blocks:

```ts
  // Prey: a hunting Hollow whose target is dead, gone or safe takes the
  // nearest living, unsafe player, or stands; a standing one takes the
  // first prey that appears. A Hollow never merges and never leaves: the
  // pack only grows (summit.ts spawns; S3 adds the forks).
  for (const h of all) {
    if (h.ai === AiState.Emerge) continue;
    const target = state.players.get(h.targetId);
    const lost = target === undefined || target.health <= 0 || target.safe;
    if (h.ai === AiState.Hunt && !lost) continue;
    const prey = nearestPrey(world, h.pos);
    if (prey === null) {
      if (h.ai !== AiState.Stand) { h.ai = AiState.Stand; h.targetId = 0; clearRoute(h); }
      continue;
    }
    if (h.ai !== AiState.Hunt || h.targetId !== prey.id) { h.ai = AiState.Hunt; h.targetId = prey.id; clearRoute(h); }
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd client && npx vitest run test/sim/hollow.test.ts test/sim/hollowWalk.test.ts test/sim/containment.test.ts`
Expected: PASS (`hollowWalk.test.ts` may spawn with the old signature — update its call to `spawnHollow(w, at, targetId, 0)`).

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/hollow.ts client/src/sim/containment.ts client/src/sim/types.ts client/test/sim/hollow.test.ts client/test/sim/hollowWalk.test.ts
git commit -m "feat: the Hollow emerges, hunts, stands, and stays in the woods"
```

---

### Task 4: The summit — discovery, safety, the end

**Files:**
- Create: `client/src/sim/summit.ts`
- Modify: `client/src/sim/world.ts` (call `stepSummit`)
- Test: `client/test/sim/summit.test.ts` (new), `client/test/sim/register.test.ts`, `client/test/sim/registerSweep.test.ts`

**Interfaces:**
- Consumes: Task 3's `spawnHollow(world, at, targetId, revealS)`, `SUMMIT_REVEAL_S`, `isOnCorridor`; Task 1's `Register.body`, `Phase`, `safe`.
- Produces:
  ```ts
  export const DISCOVERY_RADIUS = 12;
  export const SUMMIT_SPAWN_DIST = 6;
  /** Host only, every tick after the Hollows: safety, the discovery, the end. */
  export function stepSummit(world: World): void;
  ```
  Order inside: (1) `safe` for every player from `isOnCorridor`; (2) on Climb, the first living player within `DISCOVERY_RADIUS` of `register.body.pos` flips `phase` to Chase and spawns the summit Hollow `SUMMIT_SPAWN_DIST` behind the body on the far side from that player (`body.pos + SUMMIT_SPAWN_DIST × unit(body.pos − player.pos)`, y = ground + `ENEMY_HALF.y`), in Emerge for `SUMMIT_REVEAL_S`, targeting that player — the tie among several players in reach on one tick goes to the lowest id; (3) on Chase, the end: no living unsafe player → `Won` if any player is `safe`, else `Lost` (this replaces `updateLoss`'s job on forest worlds; `updateLoss` keeps running for the sandbox, and on a forest a match with every player dead reaches `Lost` by either path).

- [ ] **Step 1: Write the failing tests**

Create `client/test/sim/summit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt, activeTerrainVariant } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import { ENEMY_HALF, TICK_DT } from "../../src/sim/constants.js";
import { DISCOVERY_RADIUS, SUMMIT_SPAWN_DIST } from "../../src/sim/summit.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");

function forestWorld() {
  const w = createForestWorld(createForest(seed));
  const p = spawnPlayer(w);
  return { w, p };
}
const tick = (w: ReturnType<typeof forestWorld>["w"], n: number) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
/** Stands a player on the ground at (x, z). */
const standAt = (p: { pos: { x: number; y: number; z: number } }, x: number, z: number) => { p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z }; };

describe("the climb", () => {
  it("starts with no Hollow, on the climb, and the pad is safe ground", () => {
    const { w, p } = forestWorld();
    expect(w.state.enemies.size).toBe(0);
    expect(w.state.phase).toBe(Phase.Climb);
    tick(w, 1);
    expect(p.safe).toBe(true); // the pad is 9 m from the road's centreline
    const body = w.register!.body.pos;
    standAt(p, body.x - 40, body.z);
    tick(w, 1);
    expect(p.safe).toBe(false);
    expect(w.state.phase).toBe(Phase.Climb);
  });
});

describe("the discovery", () => {
  it("flips the phase for everyone when the first living player reaches the body, and the Hollow steps out behind it", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w);
    const body = w.register!.body.pos;
    standAt(p, body.x - (DISCOVERY_RADIUS - 1), body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    const hollows = [...w.state.enemies.values()];
    expect(hollows).toHaveLength(1);
    const h = hollows[0]!;
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.targetId).toBe(p.id);
    // Behind the body, on the far side from the player: +x of the body by SUMMIT_SPAWN_DIST.
    expect(h.pos.x).toBeCloseTo(body.x + SUMMIT_SPAWN_DIST, 1);
    expect(h.pos.z).toBeCloseTo(body.z, 1);
    expect(h.pos.y).toBeCloseTo(elevationAt(seed, h.pos.x, h.pos.z) + ENEMY_HALF.y, 1);
    // The phase never flips back, and a second player arriving spawns nothing more.
    standAt(q, body.x - 5, body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    expect(w.state.enemies.size).toBe(1);
    tick(w, Math.round(SUMMIT_REVEAL_S / TICK_DT) + 2);
    expect(h.ai).toBe(AiState.Hunt);
  });

  it("does not flip for a dead player at the body", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    p.health = 0;
    standAt(p, body.x, body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Climb);
    expect(w.state.enemies.size).toBe(0);
  });
});

describe("the end", () => {
  it("wins when every living player is on the corridor, once the chase has begun", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    expect(w.state.phase).toBe(Phase.Chase);
    const th = w.trail!.trailhead;
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Won);
  });

  it("is a win with one safe and one dead, and a loss with everyone dead", () => {
    const { w, p } = forestWorld();
    const q = spawnPlayer(w);
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    q.health = 0;
    const th = w.trail!.trailhead;
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(w.state.outcome).toBe(Outcome.Won);

    const two = forestWorld();
    standAt(two.p, two.w.register!.body.pos.x - 5, two.w.register!.body.pos.z);
    tick(two.w, 1);
    two.p.health = 0;
    tick(two.w, 1);
    expect(two.w.state.outcome).toBe(Outcome.Lost);
  });

  it("does not end on the climb: a player on the pad before the discovery is safe but still out", () => {
    const { w, p } = forestWorld();
    tick(w, 2);
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Playing);
  });

  it("a Hollow chasing a player onto the corridor stops at the treeline and stands", () => {
    const { w, p } = forestWorld();
    const body = w.register!.body.pos;
    standAt(p, body.x - 5, body.z);
    tick(w, 1);
    const h = [...w.state.enemies.values()][0]!;
    const th = w.trail!.trailhead;
    const roadX = activeTerrainVariant().roadCenterX!(seed, th.z);
    // Put the Hollow just inside the woods, hunting, and the player on the pad.
    h.ai = AiState.Hunt; h.stateTimer = 0;
    h.pos = { x: roadX + ROAD_CORRIDOR_HALF + 3, y: elevationAt(seed, roadX + ROAD_CORRIDOR_HALF + 3, th.z) + ENEMY_HALF.y, z: th.z };
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(p.safe).toBe(true);
    tick(w, 60);
    expect(h.pos.x - roadX).toBeGreaterThanOrEqual(ROAD_CORRIDOR_HALF - 0.01);
    expect(h.ai).toBe(AiState.Stand);
    expect(w.state.outcome).toBe(Outcome.Won);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/sim/summit.test.ts`
Expected: FAIL — `summit.js` does not exist.

- [ ] **Step 3: Implement**

Create `client/src/sim/summit.ts`:

```ts
/**
 * The summit (docs/gameplay/2026-09-16-the-summit.md §2, §5.1, §5.2): the
 * match's two acts and the rules that turn one into the other. Every tick,
 * host only, after the Hollows have moved: who is on the road corridor (safe
 * ground), whether the first living player has found the body (the phase
 * flips for everyone and the summit Hollow steps out), and whether the match
 * is over (no living player still out).
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { PlayerState, Vec3 } from "./types.js";
import { Outcome, Phase } from "./types.js";
import type { World } from "./world.js";
import { isOnCorridor } from "./containment.js";
import { SUMMIT_REVEAL_S, spawnHollow } from "./hollow.js";
import { ENEMY_HALF } from "./constants.js";

/** Metres from the body within which a living player has found it: inside the 25 m crest disc. */
export const DISCOVERY_RADIUS = 12;
/** Metres behind the body, on the far side from the finder, where the Hollow steps out. */
export const SUMMIT_SPAWN_DIST = 6;

function dead(p: PlayerState): boolean {
  return p.health <= 0;
}

/** The living player within DISCOVERY_RADIUS of the body, lowest id first; null when none. */
function finder(world: World, body: Vec3): PlayerState | null {
  let best: PlayerState | null = null;
  for (const p of world.state.players.values()) {
    if (dead(p)) continue;
    const dx = p.pos.x - body.x, dz = p.pos.z - body.z;
    if (dx * dx + dz * dz > DISCOVERY_RADIUS * DISCOVERY_RADIUS) continue;
    if (best === null || p.id < best.id) best = p;
  }
  return best;
}

/** Where the Hollow steps out: SUMMIT_SPAWN_DIST past the body along the line from the finder through it. */
function emergePoint(world: World, body: Vec3, finder: PlayerState): Vec3 {
  let dx = body.x - finder.pos.x, dz = body.z - finder.pos.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 1e-9) { dx /= len; dz /= len; } else { dx = 1; dz = 0; }
  const x = body.x + dx * SUMMIT_SPAWN_DIST, z = body.z + dz * SUMMIT_SPAWN_DIST;
  const groundY = world.ground !== null ? world.ground.heightAt(x, z) : body.y;
  return { x, y: groundY + ENEMY_HALF.y, z };
}

export function stepSummit(world: World): void {
  const register = world.register;
  const state = world.state;
  if (register === null || world.trail === null) return;

  // Safety is a state of the ground, read fresh every tick.
  for (const p of state.players.values()) p.safe = isOnCorridor(world, p.pos.x, p.pos.z);

  if (state.phase === Phase.Climb) {
    const who = finder(world, register.body.pos);
    if (who === null) return;
    state.phase = Phase.Chase;
    spawnHollow(world, emergePoint(world, register.body.pos, who), who.id, SUMMIT_REVEAL_S);
    return;
  }

  if (state.outcome !== Outcome.Playing) return;
  let out = 0, safe = 0;
  for (const p of state.players.values()) {
    if (dead(p)) continue;
    if (p.safe) safe++;
    else out++;
  }
  if (out > 0) return;
  state.outcome = safe > 0 ? Outcome.Won : Outcome.Lost;
}
```

`world.ground.heightAt(x, z)` is `GroundField`'s surface height, the same accessor `movement.ts` uses for the player's feet. In `world.ts`'s tick, after `updateLoss(world);` add `stepSummit(world);` (import from `./summit.js`).

- [ ] **Step 4: The register on the sweep**

Replace `client/test/sim/registerSweep.test.ts`'s tests with:

```ts
  it("names one hiker on every world and puts the body on the crest, facing back down the stem", () => {
    for (const seed of SEEDS) {
      const { graph } = bowlFor(seed);
      const site = (i: number) => propSite(graph, activeTerrainVariant().roadCenterX!, seed, PROPS[i]!);
      const r = buildRegister({ seed, graph, groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2) });
      expect(r.hiker.name.length, `seed ${seed}`).toBeGreaterThan(0);
      const crest = graph.nodes[graph.summit]!;
      expect(r.body.pos.x).toBe(crest.x);
      expect(r.body.pos.z).toBe(crest.z);
      expect(Number.isFinite(r.body.yaw)).toBe(true);
    }
  });
```

- [ ] **Step 5: Run the tests**

Run: `cd client && npx vitest run test/sim/summit.test.ts test/sim/register.test.ts test/sim/world.test.ts test/sim/hollow.test.ts && npx vitest run test/sim/registerSweep.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/sim/summit.ts client/src/sim/world.ts client/test/sim/summit.test.ts client/test/sim/register.test.ts client/test/sim/registerSweep.test.ts
git commit -m "feat: the summit — the find flips the match into the chase"
```

---

### Task 5: Escalation from the climb

**Files:**
- Modify: `client/src/game/escalation.ts`
- Test: `client/test/game/escalation.test.ts`

**Interfaces:**
- Produces: `escalationTargets(state, localId, graph, boxes, ground)` where `world` = the greatest `stemProgress`-from-the-pad of any living player (`1 - stemProgress(graph, x, z)`, since `stemProgress` counts from the crest), or 1 when `state.phase === Phase.Chase`; `EscalationState.progressMax` (renamed from `creepMax`); `atmosphereUnder` clamps the lifted dread to 1.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/escalation.test.ts` add to `describe("escalationTargets")`:

```ts
  it("rises with the party's best living climber up the stem, and pins at 1 in the chase", () => {
    const { w, p } = world();
    const q = spawnPlayer(w);
    p.pos = { x: 50, y: 0.9, z: 0 };   // a quarter of the way up the 200 m stem
    q.pos = { x: 150, y: 0.9, z: 0 };  // three quarters
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.75, 6);
    q.health = 0;
    expect(targetsOf(w, p.id).world).toBeCloseTo(0.25, 6);
    w.state.phase = Phase.Chase;
    expect(targetsOf(w, p.id).world).toBe(1);
  });
```

and to `describe("stepEscalation")`: rename the ratchet test's field to `progressMax` and add the assertion `expect(stepEscalation(ESCALATION_REST, { world: 0.6, offTrail: 0, near: 0, dead: false }, 1).progressMax).toBe(0.6);`. To `describe("atmosphereUnder")`: `it("never lifts dread past 1", () => { const a = atmosphereUnder({ weather: { ...WEATHER_PRESETS.eerie, dread: 1 }, hour: 12 }, { progressMax: 1, spike: 1, world: 1, lens: 1.4 }); expect(a.weather.dread).toBe(1); });`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/game/escalation.test.ts`
Expected: FAIL — `world` reads the Hollow's creep; `progressMax` undefined.

- [ ] **Step 3: Implement**

`escalation.ts`: the module comment's world sentence becomes "The world — shared, never falling — is how far up the stem the party's best living climber has reached, and 1 once the chase has begun". `EscalationState.creepMax` → `progressMax` (the comment: "The highest world target seen: the sky never brightens."). In `escalationTargets`:

```ts
  let world = 0;
  if (state.phase === Phase.Chase) world = 1;
  else {
    for (const p of state.players.values()) {
      if (p.health <= 0) continue;
      const progress = 1 - stemProgress(graph, p.pos.x, p.pos.z);
      if (progress > world) world = progress;
    }
  }
```

(the Hollow loop stays for `near`, without the `creep`). `atmosphereUnder`: `dread: Math.min(1, Math.max(weather.dread, lens))`. `ESCALATION_REST` uses `progressMax: 0`.

- [ ] **Step 4: Run the tests**

Run: `cd client && npx vitest run test/game/escalation.test.ts test/game/wildlifeAudio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/escalation.ts client/test/game/escalation.test.ts
git commit -m "feat: the light goes as the party climbs"
```

---

### Task 6: The passages and the poster

**Files:**
- Create: `client/src/game/passages.ts`, `client/src/game/posterPanel.ts`
- Delete: `client/src/game/registerHud.ts`, `client/src/game/registerPanel.ts`
- Test: `client/test/game/passages.test.ts`, `client/test/game/posterPanel.test.ts` (new)

**Interfaces:**
- Produces, `passages.ts`:
  ```ts
  export const DEATH_LINE = "The woods had counted you among the missing before you knew that you were lost.";
  /** The end, by who came down: all, some, none. */
  export const END_PASSAGES = {
    all: "You came down out of the woods with the last of the light, every one of you, and the trees let you go. They will count again tomorrow.",
    some: "Not all of you came down. The woods kept what they kept, and those who reached the road did not look back; those who did are looking still.",
    none: "Nobody came down. The woods went back to counting, and the road ran on to a car that nobody drove home.",
  } as const;
  export const LOSS_LANDING_MS = 8000;
  export const WIN_LANDING_MS = 8000;
  export const ROAD_LINE_U = ROAD_WALL_U + 0.5;
  /** What a player at road offset `u` is told at the wall, or null: on the climb, somebody is still up there; in the chase, nothing. */
  export function roadLine(u: number, phase: Phase): string | null;
  ```
- Produces, `posterPanel.ts`:
  ```ts
  export type PosterView = { title: string; name: string; lines: string[] };
  export function posterModel(register: Register): PosterView; // { title: "MISSING", name, lines: ["Last seen on the summit trail.", "If you have seen them, call the ranger station."] }
  export type PosterPanel = { show(view: PosterView): void; hide(): void; readonly isOpen: boolean; dispose(): void };
  export function createPosterPanel(container: HTMLElement): PosterPanel;
  ```

- [ ] **Step 1: Write the failing tests**

`client/test/game/passages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEATH_LINE, END_PASSAGES, ROAD_LINE_U, roadLine } from "../../src/game/passages.js";
import { Phase } from "../../src/sim/types.js";

describe("the passages", () => {
  it("closes a player's story on death, and the match by who came down", () => {
    expect(DEATH_LINE).toMatch(/missing/);
    expect(END_PASSAGES.all).toMatch(/every one of you/);
    expect(END_PASSAGES.some).toMatch(/Not all of you/);
    expect(END_PASSAGES.none).toMatch(/Nobody came down/);
  });
});

describe("roadLine", () => {
  it("speaks within half a metre of the wall on the climb, and never in the chase", () => {
    expect(roadLine(ROAD_LINE_U + 0.01, Phase.Climb)).toBeNull();
    expect(roadLine(ROAD_LINE_U, Phase.Climb)).toBe("Not yet. Somebody is still up there.");
    expect(roadLine(ROAD_LINE_U - 1, Phase.Chase)).toBeNull();
  });
});
```

`client/test/game/posterPanel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { posterModel } from "../../src/game/posterPanel.js";

describe("posterModel", () => {
  it("reads MISSING, the name, and where they were last seen", () => {
    const view = posterModel({ hiker: { name: "Dana Whitcombe" }, body: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, box: { x: 0, y: 1, z: 0 }, car: { x: 0, y: 0, z: 0 } });
    expect(view.title).toBe("MISSING");
    expect(view.name).toBe("Dana Whitcombe");
    expect(view.lines).toEqual(["Last seen on the summit trail.", "If you have seen them, call the ranger station."]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/game/passages.test.ts test/game/posterPanel.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`passages.ts` as the interface block, with `roadLine`:

```ts
export function roadLine(u: number, phase: Phase): string | null {
  if (phase === Phase.Chase || u > ROAD_LINE_U) return null;
  return "Not yet. Somebody is still up there.";
}
```

`posterPanel.ts`: `posterModel` as specified; the panel is `registerPanel.ts`'s DOM shape with the class `.poster`, a `h1` title, a `.name` line, and one `p` per line, `textContent` only, the same z-index 16 comment, the same show/hide/isOpen/dispose. Delete `registerHud.ts` and `registerPanel.ts`; `app.ts` imports switch in Task 9 — for this task, update `app.ts`'s two import lines to the new modules and rename `registerPanel`/`createRegisterPanel`/`registerPanelModel` uses to `posterPanel`/`createPosterPanel`/`posterModel(world.register)` so it compiles (Task 9 finishes the wiring).

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd client && npx vitest run test/game/passages.test.ts test/game/posterPanel.test.ts && cd .. && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/passages.ts client/src/game/posterPanel.ts client/src/app.ts client/test/game/passages.test.ts client/test/game/posterPanel.test.ts
git rm client/src/game/registerHud.ts client/src/game/registerPanel.ts
git commit -m "feat: the poster and the passages"
```

---

### Task 7: The end panel

**Files:**
- Create: `client/src/game/endPanel.ts`
- Test: `client/test/game/endPanel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EndPlayer = { id: number; name: string; safe: boolean; dead: boolean };
  export type EndView = { passage: string; survived: string[]; perished: string[] };
  /** The groups and the passage. `outcome` decides nothing here: the groups do (all / some / none survived). */
  export function endPanelModel(players: readonly EndPlayer[]): EndView;
  export type EndPanel = { show(view: EndView): void; hide(): void; dispose(): void };
  export function createEndPanel(container: HTMLElement): EndPanel;
  ```
  Survived = `safe && !dead`; perished = `dead`; a player neither (still out when the match ended) cannot happen by the end rule, but is listed under perished with the name — say so in a comment. Names sorted by id (join order).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { endPanelModel } from "../../src/game/endPanel.js";
import { END_PASSAGES } from "../../src/game/passages.js";

describe("endPanelModel", () => {
  const p = (id: number, name: string, safe: boolean, dead: boolean) => ({ id, name, safe, dead });
  it("groups the survived and the perished in join order and picks the passage by the groups", () => {
    const view = endPanelModel([p(3, "Wren", true, false), p(1, "You", false, true), p(2, "Ash", true, false)]);
    expect(view.survived).toEqual(["Ash", "Wren"]);
    expect(view.perished).toEqual(["You"]);
    expect(view.passage).toBe(END_PASSAGES.some);
  });
  it("reads all when nobody died and none when nobody came down", () => {
    expect(endPanelModel([p(1, "You", true, false)]).passage).toBe(END_PASSAGES.all);
    expect(endPanelModel([p(1, "You", false, true), p(2, "Ash", false, true)]).passage).toBe(END_PASSAGES.none);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd client && npx vitest run test/game/endPanel.test.ts` — FAIL, module missing.

- [ ] **Step 3: Implement** — the model as specified; the panel: a `.end` root at z-index 17 (above the poster, below the pause menu), a `p.passage`, two `section`s each with an `h2` ("Came down" / "Did not") and a `ul` of names; `textContent` only; `show` replaces children; hidden by default; the same STYLE conventions as the poster (monospace, the dark page).

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add client/src/game/endPanel.ts client/test/game/endPanel.test.ts && git commit -m "feat: the end panel groups who came down"`.

---

### Task 8: The body

**Files:**
- Create: `client/src/game/bodyMesh.ts`
- Test: `client/test/game/bodyMesh.test.ts` (NullEngine, as `entityViews.test.ts` does)

**Interfaces:**
- Produces: `export function createBodyMesh(scene: Scene, body: { pos: Vec3; yaw: number }): { node: TransformNode; dispose(): void }` — a `TransformNode` at `body.pos` rotated `body.yaw` about y, holding two boxes (the upright 0.25 × 3.2 × 0.25, its centre 1.6 up; the crossbar 2.0 × 0.25 × 0.25 at 2.4 up) and a capsule (height 1.7, radius 0.25, centre 1.75 up, hung 0.15 in front of the upright) — all `StandardMaterial`, dark timber `(0.16, 0.11, 0.07)` for the wood, pale `(0.72, 0.66, 0.6)` for the figure, `fogEnabled` left ON (the body should fade into the mist like everything else; only the Hollow is a silhouette).

- [ ] **Step 1: Test** — `it("stands at the body's place, facing its yaw, with three parts", ...)`: create with `NullEngine`, assert `node.position` equals `body.pos`, `node.rotation.y === body.yaw`, `node.getChildMeshes()` has length 3, every material is a `StandardMaterial`; `dispose()` removes the node from the scene.
- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement.** **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git add client/src/game/bodyMesh.ts client/test/game/bodyMesh.test.ts && git commit -m "feat: the body at the crest, as a placeholder"`.

---

### Task 9: Wiring the client

**Files:**
- Modify: `client/src/app.ts`, `client/src/game/interactPrompt.ts` (drop the `carrying`/`hold` options from `promptModel`), `client/src/game/ambientAudio.ts` (delete `setPen` and the objects bus if nothing else uses them — check `grep -rn "objectSound\|setPen" client/src`; if only `app.ts` did, delete them and their test)
- Test: `client/test/game/wildlifeAudio.test.ts` (the app wiring assertions still hold), `client/test/game/interactPrompt.test.ts`, `client/test/game/ambientAudio.test.ts`

**Interfaces:**
- Consumes: `posterModel`/`createPosterPanel` (Task 6), `createEndPanel`/`endPanelModel` (Task 7), `createBodyMesh` (Task 8), `client.onNamed` and `createHostSession(..., { forest, hostPeerId })` (Task 2), `roadLine(u, phase)`, `DEATH_LINE`, `LOSS_LANDING_MS`, `WIN_LANDING_MS`.

- [ ] **Step 1: The wiring**

In `app.ts`:
- `createHostSession(level, seed, () => performance.now(), { forest, hostPeerId: lobby?.state.hostId ?? "host" })`.
- Names: `const names = new Map<number, string>();` filled by `client.onNamed((e) => names.set(e.entityId, nameOf(e.peerId)))` and, on the host, directly for the local player and in `host.addPeer`'s callers (the host knows: after `host.addPeer(from, …)` returns the entity id, `names.set(id, nameOf(from))`; the host's own: `names.set(host.localEntityId, "You")`). `nameOf(peerId)` = the lobby member's name, or "You" for the local peer, or `peerId.slice(0, 8)`. In solo play the local player is "You".
- The poster: `syncBook` → `syncPoster`: the same open/close logic without the `carrying` guard, `posterPanel.show(posterModel(world.register))`.
- The prompt: `promptModel(target, projected, size, touchStart)` without the carry options.
- The body: after `signs = createSigns(...)` in both loops, `body = world.register === null ? null : createBodyMesh(renderer.scene, world.register.body)`; disposed with the signs.
- The signs: `signPosts(graph, [{ name: "the summit", x: register.body.pos.x, z: register.body.pos.z }])` and the board `lines: ["MISSING", register.hiker.name, "Last seen on the summit trail."]`.
- The road line: `roadLine(u, state.phase)`.
- The end: `syncOutcome` shows the end panel instead of the status line:
  ```ts
  const players = [...state.players.values()].sort((a, b) => a.id - b.id).map((p) => ({ id: p.id, name: names.get(p.id) ?? `Hiker ${p.id}`, safe: p.safe, dead: p.health <= 0 }));
  input.setSuppressed(true); posterPanel.hide(); hud.fade(true); endPanel.show(endPanelModel(players));
  landingTimer = setTimeout(navigateToLanding, won ? WIN_LANDING_MS : LOSS_LANDING_MS);
  ```
- `syncDeath` keeps `DEATH_LINE` on the status line.
- Delete `syncRegisterAudio` remnants and the `ambient.setPen`/`objectSound` calls.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run lint`, then `cd client && npx vitest run test/game` (the app wiring assertions in `wildlifeAudio.test.ts` must still hold; if `interactPrompt.test.ts` or `ambientAudio.test.ts` reference the removed options, update them to the new signatures).

- [ ] **Step 3: Commit** — `git add client/src/app.ts client/src/game/interactPrompt.ts client/src/game/ambientAudio.ts client/test/game && git commit -m "feat: wire the poster, the body, the names and the end panel"`.

---

### Task 10: The whole run, the docs, the full suite

**Files:**
- Create: `client/test/sim/summitRun.test.ts`
- Modify: `docs/gameplay/2026-09-16-the-summit.md` (Status line, §9 S1 row, the rulings above), `ARCHITECTURE.md` (line ~17: the register paragraph now describes items, carry, sign-out and protocol 4 — rewrite it for the poster, the phase, safety and protocol 5), `README.md` (grep `-n "sign out\|hikers\|register"` and correct any sentence that describes the old loop)

- [ ] **Step 1: The whole run**

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import { TICK_DT } from "../../src/sim/constants.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { escalationTargets } from "../../src/game/escalation.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("one run on the seed `hollow`", () => {
  it("climbs the stem, finds the body, is hunted, reaches the road, and wins", () => {
    const seed = seedFromToken("hollow");
    const w = createForestWorld(createForest(seed));
    const p = spawnPlayer(w);
    const graph = w.trail!;
    const chain = stemNodes(graph);
    const at = (n: number) => { const node = graph.nodes[n]!; p.pos = { x: node.x, y: elevationAt(seed, node.x, node.z) + 0.9, z: node.z }; };
    // Up the stem, node by node: the world input rises and nothing hunts.
    let last = -1;
    for (const n of chain.slice(0, -1)) {
      at(n);
      tickWorld(w, new Map());
      const world = escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world;
      expect(world).toBeGreaterThanOrEqual(last);
      last = world;
      expect(w.state.phase).toBe(Phase.Climb);
      expect(w.state.enemies.size).toBe(0);
    }
    // The crest: the find.
    at(chain[chain.length - 1]!);
    tickWorld(w, new Map());
    expect(w.state.phase).toBe(Phase.Chase);
    expect(escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world).toBe(1);
    const h = [...w.state.enemies.values()][0]!;
    expect(h.ai).toBe(AiState.Emerge);
    for (let i = 0; i < Math.round(SUMMIT_REVEAL_S / TICK_DT) + 1; i++) tickWorld(w, new Map());
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
    // Home: the pad is on the corridor.
    at(0);
    tickWorld(w, new Map());
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Won);
    expect(p.health).toBeGreaterThan(0);
  });
});
```

Run: `cd client && npx vitest run test/sim/summitRun.test.ts` — PASS.

- [ ] **Step 2: Docs** — the spec's `**Status:**` line gains "S1 built <date>" and the rulings listed at the top of this plan, each in one sentence; §9's S1 row → `Built <date> (docs/gameplay/2026-09-16-the-summit-loop-plan.md)`; `ARCHITECTURE.md` and `README.md` corrected as above.

- [ ] **Step 3: The full suite** — from the repo root `npm run typecheck && npm run lint && npm test`; on load, the client suite alone with `--maxWorkers=2`. All green.

- [ ] **Step 4: Commit** — `git add client/test/sim/summitRun.test.ts docs/gameplay/2026-09-16-the-summit.md ARCHITECTURE.md README.md && git commit -m "docs: record the summit loop as built"`.

---

## Self-review

**Spec coverage.** §2: phases (T1, T4), safety as a state of the ground (T3 `isOnCorridor`, T4), the end rule (T4), one-and-five-players (T4's tests), what goes (T1), what stands from C (T1 keeps contact/stare; T3). §5.1: the body placeholder (T8), `summitBody` as `register.body` (T1), discovery at 12 m (T4), the summit Hollow 6 m behind, 2 s reveal, 6.3 m/s, retarget, contact kills anyone, look factor 0.6 (T3, T4). §5.2: the treeline clamp, `safe` on the wire (T2, T3). §6: the world input, `progressMax`, the vignette clamp (T5). §7: the poster (T6), the end panel with the third passage set (T6, T7), the body mesh (T8), no new Hollow rendering (T1 keeps the capsule; `isHollowState` covers Emerge/Stand), protocol 5 (T2), determinism (every rule reads state; the only draw-free randomness is none), the whole-run test (T10), the browser pass (after the plan, by the controller). §8's table maps to the file structure. Gaps: none found; the roster item is ruled out above.

**Placeholder scan.** No TBDs; every step carries its code, command or exact wording.

**Type consistency.** `spawnHollow(world, at, targetId, revealS)` in T3, used by T4; `Register.body: { pos, yaw }` in T1, read by T4, T8, T9; `escalationTargets(state, localId, graph, boxes, ground)` in T1/T5, used by T10; `roadLine(u, phase)` in T6, used by T9; `EndPlayer`/`endPanelModel(players)` in T7, used by T9; `onNamed`/`hostPeerId` in T2, used by T9; `Phase` in T1 everywhere.
