# The Register and the Count Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The objective, end to end: a book of missing hikers derived from the seed, their items lying on the trail, carrying, the five-second sign-out at the register box, the win at the car, sign posts at every fork, and the invisible wall at the road.

**Architecture:** The book, the items and the carry state are host world state in `client/src/sim/`, replicated in every snapshot (protocol 3) and reconciled like players are; sites, names, sign posts and the wall are pure functions of the seed and the trail graph, so nothing about them crosses the wire. `game/` grows a register panel, prompt labels with a hold ring, item and sign-post meshes, and an objects audio bus, each as a pure model plus a plain renderer.

**Tech Stack:** TypeScript strict, Vitest 4 (node, no DOM tests), Babylon.js 9 (`DynamicTexture`, `MeshBuilder`), Web Audio.

**Spec:** `docs/gameplay/2026-09-15-register-and-count.md` (parent: `docs/gameplay/2026-09-08-register-and-hollow.md`).

## Global Constraints

- `client/src/sim/` imports nothing outside itself; `client/src/net/` never imports `client/src/game/` (`client/test/architecture.test.ts` enforces both). New sim code adds **no** `Math.sin/cos/tan/atan2/pow/exp/log/hypot` call and no `**` operator: the architecture test lists every allowed site. Directions are unit vectors, never angles, inside sim.
- UI renderers use DOM APIs and `textContent` only, never `innerHTML`; each renderer's CSS is a `STYLE` template literal with no backtick inside; class roots already taken: `landing`, `roster`, `touch`, `cmdbar`, `hud`, `netgraph`, `pausemenu`, `prompt`, `connectfail`.
- Every screen is a pure model (tested) plus a dumb renderer (untested); decisions live in the model. Babylon-free `game/` modules are listed in `client/test/architecture.test.ts` `BABYLON_FREE_FILES`; add each new pure module there.
- Numbers from the spec, verbatim: `SIGN_OUT_TICKS` 300, `CAR_RADIUS` 4, `PROTOCOL_VERSION` 2 → 3, items 16 bytes each (id 1, position 12, carrier 2, flags 1), players +3 bytes (`carrying` 1, `signOutTicks` 2), reach and cone are `resolveInteract`'s (`INTERACT_REACH` 2.5 m, 35°). This plan adds: `NO_ITEM` 255, `NO_CARRIER` 0, `ITEM_RADIUS` 0.35, `BOX_RADIUS` 0.4, `ROAD_WALL_U` = `ROAD_BED_HALF + 0.5 + PLAYER_HALF.x` (6.4 m), `GEN_VERSION` 4 → 5, `SIGN_POST_OFFSET` = `TRAIL_BED_HALF + 1` (2 m).
- Entity ids start at 1 (`createWorld`), so `NO_CARRIER = 0` can never name a player. Item ids are the hiker's index, 0 to 3; item interactable ids are `ITEM_INTERACTABLE_BASE + id` (10 to 13) and the box is `BOX_INTERACTABLE_ID` (2), so none collides with the debug marker (1).
- Permanent death is NOT in this plan (spec §6): a dead player still respawns after `RESPAWN_SECONDS`, and "living" means `!isDead(player)` this tick.
- Run from the repository root: `npx vitest run --root client <path>` for a file, `npx tsc -p client --noEmit` for types, `npx eslint .` for lint. Forest-building tests (`createForest`, `bowlFor`) cost about half a second per seed: keep sweeps in their own files with a 300 s timeout, and probe seeds `[0x5eed, 1, 12345]` elsewhere.
- Commit messages follow `.agents/skills/github-push/SKILL.md` (What/How), and never name anything private about how the work was done.

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/types.ts` | `ItemState`, `Outcome`, `NO_ITEM`, `NO_CARRIER`; `PlayerState.carrying`/`signOutTicks`; `WorldState.items`/`outcome` |
| `client/src/sim/interact.ts` | `Interactable.enabled` and `.label`; `resolveInteract` skips disabled |
| `client/src/sim/hikerNames.ts` | The name tables and the seeded draw |
| `client/src/sim/register.ts` | Sites, the book, the items, the rules (pick up, put down, sign out, death drop, the win), the counts |
| `client/src/sim/containment.ts` | The wall at the road |
| `client/src/sim/signs.ts` | Junction posts and their arms |
| `client/src/sim/passes/signs.ts` | Pass 9: the post's collision box |
| `client/src/sim/world.ts` | `World.register`; the register installed for forest worlds; clone/serialize; the wall in `applyMove`; `stepRegister` in the authoritative tick; the death drop |
| `client/src/sim/terrain.ts`, `olympic.ts` | `sceneryLandmarks` variant hook |
| `client/src/sim/forest.ts` | `GEN_VERSION` 5 |
| `client/src/net/protocol.ts` | Protocol 3: items, outcome, the two player fields |
| `client/src/net/hostSession.ts` | Snapshot fields; put-down on an Interact edge with no target |
| `client/src/net/clientSession.ts` | Reconcile the two player fields; items and outcome in the render state; item interactables synced from snapshots |
| `client/src/game/interactPrompt.ts` | Labels from the interactable, the register's two labels, the hold ring |
| `client/src/game/registerPanel.ts` | The book: model + panel |
| `client/src/game/registerHud.ts` | Pure: the road line and the win line |
| `client/src/game/hud.ts` | `flash`, `fade` |
| `client/src/game/entityViews.ts` | Item meshes on the ground and on remote carriers |
| `client/src/game/renderer.ts` | The local carried bundle; the `signpost`/`item` materials |
| `client/src/game/signMeshes.ts` | Arms with painted names; the trailhead board |
| `client/src/game/ambientAudio.ts` | The objects bus; pick-up, put-down and pen sounds |
| `client/src/app.ts` | Wires all of the above into both loops |

---

### Task 1: State and wire

**Files:**
- Modify: `client/src/sim/types.ts`
- Modify: `client/src/sim/interact.ts`
- Modify: `client/src/sim/world.ts` (createWorld, createForestWorld, spawnPlayer, cloneWorldState, serializeWorldState)
- Modify: `client/src/net/protocol.ts`
- Modify: `client/src/net/hostSession.ts` (buildSnapshot)
- Modify: `client/src/net/clientSession.ts` (reconcile, blend, renderState)
- Modify: `client/test/net/protocol.test.ts`, `client/test/net/wireRange.test.ts`, `client/test/game/entityViews.test.ts`, `client/test/sim/world.test.ts`, `client/test/net/clientSession.test.ts`

**Interfaces:**
- Produces: `ItemState`, `Outcome`, `NO_ITEM`, `NO_CARRIER` (types.ts); `SnapshotItem`, `Snapshot.items`, `Snapshot.outcome`, `SnapshotPlayer.carrying`, `SnapshotPlayer.signOutTicks` (protocol.ts); `Interactable.enabled?`, `Interactable.label?`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/world.test.ts`:

```ts
import { NO_ITEM, Outcome, type ItemState } from "../../src/sim/types.js";

describe("items in world state", () => {
  const item = (): ItemState => ({ id: 0, pos: { x: 1, y: 2, z: 3 }, carrier: 0, pickedUp: false, signedOut: false });

  it("starts with no items, a playing outcome and empty hands", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    expect(w.state.items).toEqual([]);
    expect(w.state.outcome).toBe(Outcome.Playing);
    expect(p.carrying).toBe(NO_ITEM);
    expect(p.signOutTicks).toBe(0);
  });

  it("clones items deeply and fingerprints them", () => {
    const w = createWorld(level, 1);
    w.state.items = [item()];
    const copy = cloneWorldState(w.state);
    copy.items[0]!.pos.x = 99;
    copy.items[0]!.pickedUp = true;
    expect(w.state.items[0]!.pos.x).toBe(1);
    expect(w.state.items[0]!.pickedUp).toBe(false);
    expect(serializeWorldState(copy)).not.toBe(serializeWorldState(w.state));
    expect(serializeWorldState(w.state)).toContain("I0:1,2,3,0,0,0");
  });

  it("fingerprints the carry fields and the outcome", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    const before = serializeWorldState(w.state);
    p.carrying = 2;
    expect(serializeWorldState(w.state)).not.toBe(before);
    p.carrying = NO_ITEM;
    p.signOutTicks = 7;
    expect(serializeWorldState(w.state)).not.toBe(before);
    p.signOutTicks = 0;
    w.state.outcome = Outcome.Won;
    expect(serializeWorldState(w.state)).not.toBe(before);
  });
});
```

In `client/test/net/protocol.test.ts`, change `sampleSnapshot()` so every player carries the new fields and the snapshot carries four items and an outcome:

```ts
    players: Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      pos: { x: i * 3.25, y: 0.9, z: -i * 7.5 },
      vel: { x: i * 1.5, y: -2.25, z: i * -0.75 },
      yaw: i * 1.1,
      pitch: -0.3 + i * 0.1,
      health: 100 - i * 7,
      grounded: i % 2 === 0,
      respawnTimer: i === 3 ? 2.5 : 0,
      lamp: { on: i % 2 === 1, charge: i / 4 },
      carrying: i === 2 ? 1 : 255,
      signOutTicks: i === 2 ? 173 : 0,
    })),
    enemies: /* unchanged */,
    items: Array.from({ length: 4 }, (_, i) => ({
      id: i,
      pos: { x: -400 + i * 130.5, y: 60 + i, z: 900 - i * 45.25 },
      carrier: i === 1 ? 3 : 0,
      pickedUp: i <= 1,
      signedOut: i === 0,
    })),
    outcome: 1,
```

Extend the round-trip assertions and the size:

```ts
    for (const [i, expected] of snap.players.entries()) {
      const actual = back.players[i]!;
      // ...existing assertions...
      expect(actual.carrying).toBe(expected.carrying);
      expect(actual.signOutTicks).toBe(expected.signOutTicks);
    }
    expect(back.outcome).toBe(1);
    expect(back.items).toHaveLength(4);
    for (const [i, expected] of snap.items.entries()) {
      const actual = back.items[i]!;
      expect(actual.id).toBe(expected.id);
      expect(actual.carrier).toBe(expected.carrier);
      expect(actual.pickedUp).toBe(expected.pickedUp);
      expect(actual.signedOut).toBe(expected.signedOut);
      expect(Math.abs(actual.pos.x - expected.pos.x)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(Math.abs(actual.pos.y - expected.pos.y)).toBeLessThanOrEqual(POSITION_PRECISION);
      expect(Math.abs(actual.pos.z - expected.pos.z)).toBeLessThanOrEqual(POSITION_PRECISION);
    }
```

```ts
  it("stays within the bandwidth budget", () => {
    // 769 bytes at 20 Hz is about 15 KB/s down per client. That is protocol
    // 2's 688 plus three bytes per player (carrying, sign-out ticks), one byte
    // of outcome, one byte of item count and 16 bytes per item, four here.
    expect(encodeSnapshot(sampleSnapshot()).byteLength).toBe(769);
  });

  it("round-trips an empty world", () => {
    const back = decodeSnapshot(encodeSnapshot({ tick: 1, lastProcessedInput: 0, players: [], enemies: [], items: [], outcome: 0 }));
    expect(back.players).toEqual([]);
    expect(back.enemies).toEqual([]);
    expect(back.items).toEqual([]);
    expect(back.outcome).toBe(0);
  });
```

(Every other `Snapshot` literal in that file gains `items: [], outcome: 0`, and every `SnapshotPlayer` literal gains `carrying: 255, signOutTicks: 0`; same for `client/test/net/wireRange.test.ts`'s `throughTheWire`. In `client/test/game/entityViews.test.ts`'s `player()` fixture add `carrying: NO_ITEM, signOutTicks: 0` and import `NO_ITEM` from `../../src/sim/types.js`; its `state()` fixture gains `items: [], outcome: Outcome.Playing`.)

Append to `client/test/net/clientSession.test.ts`, using its `harness()` and `drive()` helpers (`h.net.now` is a getter):

```ts
import { NO_ITEM, Outcome } from "../../src/sim/types.js";

describe("items and outcome", () => {
  it("carries items and the outcome into the render state, and the carry fields onto the local player", () => {
    const h = harness();
    const me = h.peerEntityId;
    h.host.world.state.items = [
      { id: 0, pos: { x: 5, y: 1, z: 5 }, carrier: 0, pickedUp: false, signedOut: false },
      { id: 1, pos: { x: 0, y: 0, z: 0 }, carrier: me, pickedUp: true, signedOut: false },
    ];
    h.host.world.state.players.get(me)!.carrying = 1;
    h.host.world.state.players.get(me)!.signOutTicks = 42;
    h.host.world.state.outcome = Outcome.Won;
    drive(h, 6, (t) => input({ seq: t + 1 }));
    const state = h.client.renderState(h.net.now);
    expect(state.items.map((i) => [i.id, i.carrier, i.pickedUp, i.signedOut])).toEqual([[0, 0, false, false], [1, me, true, false]]);
    expect(state.outcome).toBe(Outcome.Won);
    expect(h.client.localPlayer()!.carrying).toBe(1);
    expect(h.client.localPlayer()!.signOutTicks).toBe(42);
    expect(state.players.get(me)!.carrying).toBe(1);
  });

  it("starts empty-handed with no items before any snapshot", () => {
    const h = harness();
    const state = h.client.renderState(h.net.now);
    expect(state.items).toEqual([]);
    expect(state.outcome).toBe(Outcome.Playing);
    expect(h.client.localPlayer()!.carrying).toBe(NO_ITEM);
  });
});
```

(The host's `tick` keeps `signOutTicks` at 42 only until Task 3 adds `stepRegister`, which zeroes it for a player who is not holding Interact at the box; when Task 3 lands, change the expectation to `0` or set the host player up at the box.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/world.test.ts test/net/protocol.test.ts test/net/clientSession.test.ts`
Expected: FAIL — type errors on the new fields, `items` undefined, size 688.

- [ ] **Step 3: Types and the interactable**

In `client/src/sim/types.ts`, after `Button`:

```ts
/**
 * `PlayerState.carrying` when the hands are empty. It rides the wire as one
 * byte, so it is that byte's ceiling rather than -1.
 */
export const NO_ITEM = 255;
/**
 * `ItemState.carrier` when the item lies on the ground. Entity ids start at 1
 * (`createWorld`), so 0 can never name a player.
 */
export const NO_CARRIER = 0;

export const enum Outcome {
  Playing = 0,
  Won = 1,
}

/**
 * One missing hiker's item: what is left of them, lying at their site until
 * somebody carries it to the register. Host state, sent in every snapshot.
 */
export type ItemState = {
  /** The hiker's index in the book, 0 to 3. */
  id: number;
  /** Where it lies. Meaningless while carried: the carrier's position is the truth then. */
  pos: Vec3;
  /** The player holding it, or NO_CARRIER. */
  carrier: number;
  /** Set on the first pick-up and never cleared: the escalation count reads this. */
  pickedUp: boolean;
  /** Signed out at the register box; the item has left the world. */
  signedOut: boolean;
};
```

Add to `PlayerState` after `lamp`:

```ts
  /** The item in this player's hands, or NO_ITEM. Rides the snapshot as one byte. */
  carrying: number;
  /**
   * Ticks of Interact held at the register box while carrying, 0 to
   * SIGN_OUT_TICKS (register.ts). Back to 0 the moment the hold breaks. Rides
   * the snapshot as a uint16 so the client can draw the ring.
   */
  signOutTicks: number;
```

Add to `WorldState`:

```ts
  /** The missing hikers' items, by hiker index. Empty for a world with no register. */
  items: ItemState[];
  outcome: Outcome;
```

In `client/src/sim/interact.ts`, extend the type and the resolver:

```ts
export type Interactable = {
  id: number;
  pos: Vec3;
  /** Half-extent of the thing, so reach is measured to its surface. */
  radius: number;
  kind: number;
  /**
   * What the prompt says, when the verb depends on the thing ("Pick up Dana
   * Whitcombe") rather than only on its kind. Absent: the kind's own label.
   */
  label?: string;
  /**
   * False while the thing cannot be acted on — an item somebody is carrying,
   * an item already signed out. Absent means enabled.
   */
  enabled?: boolean;
  onInteract: (playerId: number) => void;
};
```

and in the loop of `resolveInteract`, first line: `if (it.enabled === false) continue;`.

- [ ] **Step 4: World state**

In `client/src/sim/world.ts`: import `NO_ITEM, Outcome` from `./types.js`. Both `createWorld` and `createForestWorld` state literals gain `items: [], outcome: Outcome.Playing`. `spawnPlayer`'s literal gains `carrying: NO_ITEM, signOutTicks: 0`. `cloneWorldState` returns `items` and `outcome`:

```ts
  const items = state.items.map((it) => ({ ...it, pos: cloneVec3(it.pos) }));
  return {
    tick: state.tick,
    players,
    enemies,
    items,
    outcome: state.outcome,
    nextEntityId: state.nextEntityId,
    rngSeed: state.rngSeed,
  };
```

`serializeWorldState`: the header gains `o:${state.outcome}`; the player line gains `,${p.carrying},${p.signOutTicks}` at its end; after the enemies:

```ts
  for (const it of state.items) {
    parts.push(
      `I${it.id}:${it.pos.x},${it.pos.y},${it.pos.z},${it.carrier},${it.pickedUp ? 1 : 0},${it.signedOut ? 1 : 0}`,
    );
  }
```

- [ ] **Step 5: The codec**

In `client/src/net/protocol.ts`: `PROTOCOL_VERSION = 3`, and extend its doc comment: "(most recently: the register — items, the match outcome, and a player's carried item and sign-out ticks; before that, int32 positions and uint32 seqs)". Types:

```ts
export type SnapshotPlayer = {
  // ...existing fields...
  /** The carried item's id, or 255 (NO_ITEM). One byte. */
  carrying: number;
  /** Ticks of Interact held at the box, uint16. */
  signOutTicks: number;
};

export type SnapshotItem = {
  id: number;
  pos: Vec3;
  /** The carrying player's entity id, or 0. */
  carrier: number;
  pickedUp: boolean;
  signedOut: boolean;
};

export type Snapshot = {
  tick: number;
  lastProcessedInput: number;
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  items: SnapshotItem[];
  /** `Outcome` as a byte. */
  outcome: number;
};
```

Sizes: `const PLAYER_BYTES = 30; const ENEMY_BYTES = 18; const ITEM_BYTES = 16;`. In `encodeSnapshot`, size becomes

```ts
  const size =
    1 + 4 + 4 +
    2 + snapshot.players.length * PLAYER_BYTES +
    2 + snapshot.enemies.length * ENEMY_BYTES +
    1 + 1 + snapshot.items.length * ITEM_BYTES;
```

After each player's lamp byte:

```ts
    view.setUint8(o, clamp(p.carrying, 0, 255));
    o += 1;
    view.setUint16(o, clamp(p.signOutTicks, 0, 65535), true);
    o += 2;
```

After the enemies loop:

```ts
  view.setUint8(o, snapshot.outcome & 0xff);
  o += 1;
  view.setUint8(o, snapshot.items.length & 0xff);
  o += 1;
  for (const it of snapshot.items) {
    view.setUint8(o, it.id & 0xff);
    o += 1;
    view.setInt32(o, quantizePosition(it.pos.x), true);
    o += 4;
    view.setInt32(o, quantizePosition(it.pos.y), true);
    o += 4;
    view.setInt32(o, quantizePosition(it.pos.z), true);
    o += 4;
    view.setUint16(o, it.carrier, true);
    o += 2;
    view.setUint8(o, (it.pickedUp ? 1 : 0) | (it.signedOut ? 2 : 0));
    o += 1;
  }
```

`decodeSnapshot` mirrors it: after the lamp byte read `carrying = view.getUint8(o); o += 1; signOutTicks = view.getUint16(o, true); o += 2;` and push both; after the enemies loop:

```ts
  const outcome = view.getUint8(o);
  o += 1;
  const itemCount = view.getUint8(o);
  o += 1;
  const items: SnapshotItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const id = view.getUint8(o);
    o += 1;
    const x = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const y = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const z = dequantizePosition(view.getInt32(o, true));
    o += 4;
    const carrier = view.getUint16(o, true);
    o += 2;
    const flags = view.getUint8(o);
    o += 1;
    items.push({ id, pos: { x, y, z }, carrier, pickedUp: (flags & 1) !== 0, signedOut: (flags & 2) !== 0 });
  }
  return { tick, lastProcessedInput, players, enemies, items, outcome };
```

- [ ] **Step 6: The sessions pass it through**

`client/src/net/hostSession.ts` `buildSnapshot`: each player gains `carrying: p.carrying, signOutTicks: p.signOutTicks`; the returned object gains

```ts
      items: world.state.items.map((it) => ({
        id: it.id,
        pos: it.pos,
        carrier: it.carrier,
        pickedUp: it.pickedUp,
        signedOut: it.signedOut,
      })),
      outcome: world.state.outcome,
```

`client/src/net/clientSession.ts`:
- import `NO_ITEM, Outcome` alongside `AiState, cloneVec3`;
- in `reconcile`, after the lamp line: `local.carrying = authoritative.carrying; local.signOutTicks = authoritative.signOutTicks;` and after `predicted.state.tick = snapshot.tick;`: `predicted.state.items = snapshot.items.map((it) => ({ ...it, pos: cloneVec3(it.pos) })); predicted.state.outcome = snapshot.outcome;`
- in `blend`, the returned object gains `items: b.items, outcome: b.outcome` (items are not interpolated: the newer snapshot's are the truth);
- in `renderState`, each remote player gains `carrying: p.carrying, signOutTicks: p.signOutTicks`, and the returned state gains

```ts
        items: (latest?.items ?? []).map((it) => ({ ...it, pos: cloneVec3(it.pos) })),
        outcome: latest?.outcome ?? Outcome.Playing,
```

(`latest` is the newest decoded snapshot; items need no interpolation.)

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx vitest run --root client test/sim test/net test/game/entityViews.test.ts && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS. If `architecture.test.ts`'s Math allowlist fails, a trig call crept into sim: remove it.

- [ ] **Step 8: Commit**

```bash
git add client/src/sim/types.ts client/src/sim/interact.ts client/src/sim/world.ts client/src/net/protocol.ts client/src/net/hostSession.ts client/src/net/clientSession.ts client/test/sim/world.test.ts client/test/net/protocol.test.ts client/test/net/wireRange.test.ts client/test/net/clientSession.test.ts client/test/game/entityViews.test.ts
git commit -m "feat: carry the register's items and the match outcome on the wire"
```

---

### Task 2: The book — sites, names and items from the seed

**Files:**
- Create: `client/src/sim/hikerNames.ts`
- Create: `client/src/sim/register.ts` (this task: types, `buildRegister`, `installRegister`, `syncItemInteractables`; the rules come in Task 3)
- Modify: `client/src/sim/terrain.ts` (`sceneryLandmarks` hook), `client/src/sim/olympic.ts` (provide it)
- Modify: `client/src/sim/world.ts` (`World.register`; `createForestWorld` installs it)
- Test: `client/test/sim/hikerNames.test.ts`, `client/test/sim/register.test.ts`, `client/test/sim/registerSweep.test.ts`

**Interfaces:**
- Consumes: `ItemState`, `NO_CARRIER` (Task 1); `TrailGraph` (`nodes`, `edges`, `summit`, `loops`, `features`), `Landmark`, `propSite`/`PROPS` (`sim/passes/trailhead.ts`), `elevationAt`.
- Produces: `Register`, `Hiker`, `Site`, `SiteKind`, `buildRegister(input)`, `installRegister(world, register)`, `syncItemInteractables(world)`, `InteractKind`, `ITEM_RADIUS`, `BOX_RADIUS`, `BOX_INTERACTABLE_ID`, `ITEM_INTERACTABLE_BASE`, `MIN_SITES`, `MAX_SITES`, `siteDisplayName`; `World.register: Register | null`.

- [ ] **Step 1: Write the failing tests**

`client/test/sim/hikerNames.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FIRST_NAMES, LAST_NAMES, hikerNames } from "../../src/sim/hikerNames.js";

describe("hikerNames", () => {
  it("draws the same names for the same seed and different ones for another", () => {
    const a = hikerNames(1234, 4);
    const b = hikerNames(1234, 4);
    const c = hikerNames(4321, 4);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(4);
  });

  it("never repeats a surname within one book", () => {
    for (let seed = 0; seed < 200; seed++) {
      const names = hikerNames(seed, 4);
      const surnames = names.map((n) => n.split(" ")[1]);
      expect(new Set(surnames).size).toBe(4);
    }
  });

  it("draws only from the tables", () => {
    for (const name of hikerNames(77, 4)) {
      const [first, last] = name.split(" ");
      expect(FIRST_NAMES).toContain(first);
      expect(LAST_NAMES).toContain(last);
    }
  });
});
```

`client/test/sim/register.test.ts` (a hand-built graph, no forest):

```ts
import { describe, expect, it } from "vitest";
import type { TrailGraph, TrailEdge } from "../../src/sim/trail.js";
import type { Landmark } from "../../src/sim/landmarks.js";
import {
  BOX_INTERACTABLE_ID, ITEM_INTERACTABLE_BASE, ITEM_RADIUS, InteractKind, MIN_SITES,
  buildRegister, installRegister, siteDisplayName, syncItemInteractables,
} from "../../src/sim/register.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { NO_CARRIER } from "../../src/sim/types.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0]],
  enemySpawns: [],
});

/** Straight stem 0→1→2 along +x (progress 0, 0.5, 1); one loop 1→3→4→2 round a meadow at (150, 0, 60). */
function graph(loops: 0 | 1 | 2): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 200, z: 0, h: 0, u: 0 },
    { x: 120, z: 50, h: 0, u: 0 }, { x: 180, z: 50, h: 0, u: 0 },
    { x: 120, z: -50, h: 0, u: 0 }, { x: 180, z: -50, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number, kind: TrailEdge["kind"], p0: number, p1: number): TrailEdge =>
    ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: p0, progress1: p1 });
  const edges = [edge(0, 1, "stem", 0, 0.5), edge(1, 2, "stem", 0.5, 1)];
  const g: TrailGraph = {
    nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1], loops: [], stemLen: 200,
    features: [{ id: 0, kind: "peak", x: 200, z: 0, radius: 300, height: 60 }], fallbacks: 0,
  };
  if (loops >= 1) {
    edges.push(edge(1, 3, "loop", 0.5, 0.5), edge(3, 4, "loop", 0.5, 0.5), edge(4, 2, "loop", 1, 1));
    g.features.push({ id: 1, kind: "meadow", x: 150, z: 60, radius: 60, height: 0 });
    g.loops.push({ kind: "meadow", featureId: 1, edges: [2, 3, 4], junctionA: 1, junctionB: 2 });
  }
  if (loops >= 2) {
    edges.push(edge(1, 5, "loop", 0.5, 0.5), edge(5, 6, "loop", 0.5, 0.5), edge(6, 2, "loop", 1, 1));
    g.features.push({ id: 2, kind: "meadow", x: 150, z: -60, radius: 60, height: 0 });
    g.loops.push({ kind: "meadow", featureId: 2, edges: [5, 6, 7], junctionA: 1, junctionB: 2 });
  }
  return g;
}
const stand: Landmark = { type: "stand", x: 60, z: 30, carved: false, discX: 60, discZ: 30 };
const talus: Landmark = { type: "talus", x: 140, z: -40, carved: true, discX: 140, discZ: -70 };
const input = (g: TrailGraph, landmarks: Landmark[]) => ({
  seed: 99, graph: g, landmarks, groundH: () => 10, box: { x: -5, z: -7 }, car: { x: -8, z: 12 },
});

describe("buildRegister", () => {
  it("makes the summit a site and one site per built loop, items on the loop's nearest point to its feature", () => {
    const r = buildRegister(input(graph(1), [stand, talus]));
    expect(r.hikers.map((h) => h.site.kind)).toEqual(["summit", "meadow"]);
    expect(r.hikers[0]!.site).toMatchObject({ x: 200, z: 0, y: 10, progress: 1 });
    // The meadow at (150, 60): the loop's top edge 3→4 runs z = 50, so the
    // nearest point is (150, 50).
    expect(r.hikers[1]!.site).toMatchObject({ x: 150, z: 50, y: 10 });
  });

  it("falls back to the stand, then the talus, to reach two sites, on the trail's nearest point", () => {
    const withStand = buildRegister(input(graph(0), [stand, talus]));
    expect(withStand.hikers).toHaveLength(MIN_SITES);
    expect(withStand.hikers[1]!.site).toMatchObject({ kind: "stand", x: 60, z: 0 });
    const talusOnly = buildRegister(input(graph(0), [talus]));
    expect(talusOnly.hikers[1]!.site).toMatchObject({ kind: "talus", x: 140, z: 0 });
    expect(buildRegister(input(graph(1), [stand, talus])).hikers.map((h) => h.site.kind)).not.toContain("stand");
  });

  it("tells two sites of one kind apart by their place along the stem", () => {
    const r = buildRegister(input(graph(2), []));
    const names = r.hikers.map((h) => h.site.name);
    expect(names).toEqual(["the summit", "the lower meadow", "the upper meadow"]);
  });

  it("names every site for the book", () => {
    expect(siteDisplayName("summit", 0, 1)).toBe("the summit");
    expect(siteDisplayName("pond", 0, 1)).toBe("the pond");
    expect(siteDisplayName("stand", 0, 1)).toBe("the old stand");
    expect(siteDisplayName("talus", 0, 1)).toBe("the talus field");
    expect(siteDisplayName("meadow", 1, 3)).toBe("the middle meadow");
  });

  it("gives every hiker a seeded name, the same on every machine", () => {
    const a = buildRegister(input(graph(1), []));
    const b = buildRegister(input(graph(1), []));
    expect(a.hikers.map((h) => h.name)).toEqual(b.hikers.map((h) => h.name));
    expect(a.hikers[0]!.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("places the box at chest height on the post and the car at its centre", () => {
    const r = buildRegister(input(graph(1), []));
    expect(r.box).toEqual({ x: -5, y: 11, z: -7 });
    expect(r.car).toEqual({ x: -8, y: 10.8, z: 12 });
  });
});

describe("installRegister", () => {
  it("lays one item per hiker at its site and registers the box and the items as interactables", () => {
    const world = createWorld(flat, 1);
    const r = buildRegister(input(graph(1), []));
    installRegister(world, r);
    expect(world.register).toBe(r);
    expect(world.state.items).toHaveLength(2);
    expect(world.state.items[1]).toEqual({ id: 1, pos: { x: 150, y: 10 + ITEM_RADIUS, z: 50 }, carrier: NO_CARRIER, pickedUp: false, signedOut: false });
    const box = world.interactables.get(BOX_INTERACTABLE_ID)!;
    expect(box.kind).toBe(InteractKind.Register);
    expect(box.label).toBe("Read the register");
    const item = world.interactables.get(ITEM_INTERACTABLE_BASE + 1)!;
    expect(item.kind).toBe(InteractKind.Item);
    expect(item.label).toBe(`Pick up ${r.hikers[1]!.name}`);
    expect(item.enabled).toBe(true);
  });

  it("disables a carried or signed-out item's interactable and moves it with the item", () => {
    const world = createWorld(flat, 1);
    installRegister(world, buildRegister(input(graph(1), [])));
    world.state.items[0]!.carrier = 7;
    world.state.items[1]!.pos = { x: 1, y: 2, z: 3 };
    syncItemInteractables(world);
    expect(world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
    expect(world.interactables.get(ITEM_INTERACTABLE_BASE + 1)!.pos).toEqual({ x: 1, y: 2, z: 3 });
    world.state.items[0]!.carrier = NO_CARRIER;
    world.state.items[0]!.signedOut = true;
    syncItemInteractables(world);
    expect(world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
  });
});
```

`client/test/sim/registerSweep.test.ts` (the real worlds):

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { PROPS, propSite } from "../../src/sim/passes/trailhead.js";
import { MAX_SITES, MIN_SITES, buildRegister } from "../../src/sim/register.js";
import { SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("the register over the 227-seed sweep", { timeout: 300_000 }, () => {
  const v = activeTerrainVariant();
  const registers = SEEDS.map((seed) => {
    const bowl = bowlFor(seed);
    const site = (i: number) => propSite(bowl.graph, v.roadCenterX!, seed, PROPS[i]!);
    return {
      seed,
      graph: bowl.graph,
      register: buildRegister({
        seed, graph: bowl.graph, landmarks: bowl.landmarks,
        groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2),
      }),
    };
  });

  it("gives every world 2 to 4 hikers, one per built loop plus the summit", () => {
    let fallbacks = 0;
    for (const { seed, graph, register } of registers) {
      const n = register.hikers.length;
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_SITES);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(MAX_SITES);
      if (graph.loops.length === 0) {
        fallbacks++;
        expect(register.hikers.map((h) => h.site.kind), `seed ${seed}`).toEqual(["summit", expect.stringMatching(/^(stand|talus)$/)]);
      } else {
        expect(n, `seed ${seed}`).toBe(1 + graph.loops.length);
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
  });

  it("lays every item on the trail bed, and no two hikers at one site", () => {
    for (const { seed, graph, register } of registers) {
      for (const h of register.hikers) {
        expect(trailDistance(graph, h.site.x, h.site.z), `seed ${seed} ${h.site.name}`).toBeLessThanOrEqual(TRAIL_BED_HALF + 1e-6);
      }
      for (let i = 0; i < register.hikers.length; i++) {
        for (let j = i + 1; j < register.hikers.length; j++) {
          const a = register.hikers[i]!.site, b = register.hikers[j]!.site;
          const dx = a.x - b.x, dz = a.z - b.z;
          expect(Math.sqrt(dx * dx + dz * dz), `seed ${seed} ${a.name} vs ${b.name}`).toBeGreaterThan(20);
        }
      }
    }
  });

  it("reads the same book twice and never repeats a site name in one world", () => {
    for (const { seed, graph, register } of registers) {
      const bowl = bowlFor(seed);
      const again = buildRegister({
        seed, graph, landmarks: bowl.landmarks, groundH: (x, z) => elevationAt(seed, x, z),
        box: propSite(graph, v.roadCenterX!, seed, PROPS[0]!), car: propSite(graph, v.roadCenterX!, seed, PROPS[2]!),
      });
      expect(again.hikers.map((h) => [h.name, h.site.name])).toEqual(register.hikers.map((h) => [h.name, h.site.name]));
      expect(new Set(register.hikers.map((h) => h.site.name)).size).toBe(register.hikers.length);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/hikerNames.test.ts test/sim/register.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: The names**

`client/src/sim/hikerNames.ts`:

```ts
import { nextRandom } from "./types.js";

/**
 * The missing hikers' names, drawn from two fixed tables by the world seed so
 * every peer reads the same book. Plain, period-neutral names: the register is
 * a real trailhead's, not a horror prop.
 */
export const FIRST_NAMES: readonly string[] = [
  "Dana", "Ruth", "Owen", "Miles", "Clara", "Elias", "June", "Theo", "Nora", "Hugh",
  "Iris", "Silas", "Mara", "Reuben", "Tessa", "Abel", "Wren", "Cyrus", "Lena", "Jonah",
  "Ada", "Felix", "Greta", "Amos", "Ines", "Rafe", "Sylvie", "Boyd", "Edith", "Callum",
  "Maeve", "Ansel",
];
export const LAST_NAMES: readonly string[] = [
  "Whitcombe", "Harlan", "Petersen", "Okafor", "Lindqvist", "Marsh", "Delacroix", "Reyes",
  "Thornbury", "Kowalski", "Abernathy", "Nakamura", "Fenwick", "Oyelaran", "Castellano", "Brandt",
  "Halvorsen", "Mbeki", "Ashdown", "Ferreira", "Quennell", "Tanaka", "Voss", "Ellery",
  "Ibarra", "Rostova", "Gallagher", "Sato", "Whitlock", "Duran", "Kessler", "Pryor",
];

const NAME_SALT = 0x4e414d45;

/** `count` names, first and last, no surname repeated. Deterministic in `seed`. */
export function hikerNames(seed: number, count: number): string[] {
  const rng = { rngSeed: (seed ^ NAME_SALT) | 0 };
  const lasts = [...LAST_NAMES];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[Math.floor(nextRandom(rng) * FIRST_NAMES.length)] as string;
    const at = Math.floor(nextRandom(rng) * lasts.length);
    const last = lasts.splice(at, 1)[0] as string;
    out.push(`${first} ${last}`);
  }
  return out;
}
```

- [ ] **Step 4: The variant hook**

`client/src/sim/terrain.ts`, in `TerrainVariant` after `trailGraph`:

```ts
  /** The two scenery landmarks (the stand, the talus) beside the trail, for
   * the register's fallback site. Absent = none. */
  sceneryLandmarks?: (seed: number) => readonly Landmark[];
```

with `import type { Landmark, LandmarkMask } from "./landmarks.js";`. In `client/src/sim/olympic.ts`'s variant record, after `trailGraph: trailGraphHook,`: `sceneryLandmarks: (seed) => bowlFor(seed).landmarks,`.

- [ ] **Step 5: The register**

`client/src/sim/register.ts`:

```ts
/**
 * The register and the count: the book of missing hikers, their items, and
 * the rules that move them. Sites and names follow from the seed and the
 * trail graph (`buildRegister`), so every peer reads the same book with
 * nothing on the wire; the items' state is host world state in the snapshot.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { Vec3 } from "./types.js";
import { NO_CARRIER, cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import type { Landmark } from "./landmarks.js";
import { PLAYER_HALF } from "./constants.js";
import { CAR_HALF } from "./passes/trailhead.js";
import { hikerNames } from "./hikerNames.js";

export const SIGN_OUT_TICKS = 300;
export const CAR_RADIUS = 4;
export const ITEM_RADIUS = 0.35;
export const BOX_RADIUS = 0.4;
/** Chest height on the 1.2 m post, where a hand opens the box. */
export const BOX_HEIGHT = 1;
export const MIN_SITES = 2;
export const MAX_SITES = 4;
export const BOX_INTERACTABLE_ID = 2;
export const ITEM_INTERACTABLE_BASE = 10;

export const enum InteractKind {
  Debug = 0,
  Item = 1,
  Register = 2,
}

export type SiteKind = "summit" | "meadow" | "pond" | "stand" | "talus";
export type Site = {
  kind: SiteKind;
  /** As the book reads it: "the summit", "the lower meadow". */
  name: string;
  x: number;
  /** The ground at (x, z). */
  y: number;
  z: number;
  /** Stem progress, 0 at the pad to 1 at the crest: orders two sites of one kind. */
  progress: number;
};
export type Hiker = { id: number; name: string; site: Site };
export type Register = {
  hikers: Hiker[];
  /** The register box on its post: what the hand reaches for. */
  box: Vec3;
  /** The car's centre, for the win. */
  car: Vec3;
};

export type RegisterInput = {
  seed: number;
  graph: TrailGraph;
  landmarks: readonly Landmark[];
  groundH(x: number, z: number): number;
  /** The post's and the car's sites (`propSite` over PROPS[0] and PROPS[2]). */
  box: { x: number; z: number };
  car: { x: number; z: number };
};

const KIND_NAMES: Record<SiteKind, string> = {
  summit: "the summit",
  meadow: "the meadow",
  pond: "the pond",
  stand: "the old stand",
  talus: "the talus field",
};
const ORDINALS = ["lower", "middle", "upper"];

/** `rank` among `count` sites of this kind, ordered by stem progress. */
export function siteDisplayName(kind: SiteKind, rank: number, count: number): string {
  const base = KIND_NAMES[kind];
  if (count <= 1) return base;
  const word = count === 2 ? (rank === 0 ? "lower" : "upper") : (ORDINALS[rank] ?? "upper");
  return base.replace("the ", `the ${word} `);
}

/** The nearest point on any of `edgeIds` to (x, z), with the stem progress there. */
function nearestPointOnEdges(
  graph: TrailGraph,
  edgeIds: readonly number[],
  x: number,
  z: number,
): { x: number; z: number; progress: number } {
  let best = { x, z, progress: 0 };
  let bestSq = Infinity;
  for (const id of edgeIds) {
    const e = graph.edges[id];
    if (e === undefined) continue;
    const a = graph.nodes[e.a] as TrailNode;
    const b = graph.nodes[e.b] as TrailNode;
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / L2)) : 0;
    const px = a.x + t * ex, pz = a.z + t * ez;
    const sq = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (sq < bestSq) {
      bestSq = sq;
      best = { x: px, z: pz, progress: e.progress0 + (e.progress1 - e.progress0) * t };
    }
  }
  return best;
}

export function buildRegister(input: RegisterInput): Register {
  const { graph, groundH } = input;
  const sites: Site[] = [];
  const crest = graph.nodes[graph.summit] as TrailNode;
  sites.push({ kind: "summit", name: "", x: crest.x, y: groundH(crest.x, crest.z), z: crest.z, progress: 1 });
  for (const loop of graph.loops) {
    const feature = graph.features.find((f) => f.id === loop.featureId);
    if (feature === undefined) continue;
    const p = nearestPointOnEdges(graph, loop.edges, feature.x, feature.z);
    sites.push({ kind: loop.kind, name: "", x: p.x, y: groundH(p.x, p.z), z: p.z, progress: p.progress });
  }
  if (sites.length < MIN_SITES) {
    const every = graph.edges.map((_, i) => i);
    for (const type of ["stand", "talus"] as const) {
      const landmark = input.landmarks.find((l) => l.type === type);
      if (landmark === undefined) continue;
      const p = nearestPointOnEdges(graph, every, landmark.x, landmark.z);
      sites.push({ kind: type, name: "", x: p.x, y: groundH(p.x, p.z), z: p.z, progress: p.progress });
      break;
    }
  }
  // Names by kind, ordinals by stem progress among a kind.
  for (const kind of Object.keys(KIND_NAMES) as SiteKind[]) {
    const ofKind = sites.filter((s) => s.kind === kind).sort((a, b) => a.progress - b.progress);
    for (const [rank, s] of ofKind.entries()) s.name = siteDisplayName(kind, rank, ofKind.length);
  }
  const names = hikerNames(input.seed, sites.length);
  const hikers = sites.map((site, id) => ({ id, name: names[id] as string, site }));
  return {
    hikers,
    box: { x: input.box.x, y: groundH(input.box.x, input.box.z) + BOX_HEIGHT, z: input.box.z },
    car: { x: input.car.x, y: groundH(input.car.x, input.car.z) + CAR_HALF.y, z: input.car.z },
  };
}

/**
 * Lays the items at their sites and registers the box and the items as
 * interactables. Called on the host's world and on a client's predicted
 * world alike, from the same seed, so both resolve the same things in reach;
 * only the host's `onInteract` has effect (`sim/world.ts`).
 */
export function installRegister(world: World, register: Register): void {
  world.register = register;
  world.state.items = register.hikers.map((h) => ({
    id: h.id,
    pos: { x: h.site.x, y: h.site.y + ITEM_RADIUS, z: h.site.z },
    carrier: NO_CARRIER,
    pickedUp: false,
    signedOut: false,
  }));
  world.interactables.set(BOX_INTERACTABLE_ID, {
    id: BOX_INTERACTABLE_ID,
    pos: cloneVec3(register.box),
    radius: BOX_RADIUS,
    kind: InteractKind.Register,
    label: "Read the register",
    // Reading is the client's own screen and signing out is a hold
    // (`stepRegister`), so a press on the box does nothing in the world.
    onInteract: () => undefined,
  });
  for (const item of world.state.items) {
    const hiker = register.hikers[item.id] as Hiker;
    world.interactables.set(ITEM_INTERACTABLE_BASE + item.id, {
      id: ITEM_INTERACTABLE_BASE + item.id,
      pos: cloneVec3(item.pos),
      radius: ITEM_RADIUS,
      kind: InteractKind.Item,
      label: `Pick up ${hiker.name}`,
      enabled: true,
      onInteract: (playerId) => pickUp(world, playerId, item.id),
    });
  }
  syncItemInteractables(world);
}

/** The interactables follow the items: position, and whether anyone can reach for them. */
export function syncItemInteractables(world: World): void {
  for (const item of world.state.items) {
    const it = world.interactables.get(ITEM_INTERACTABLE_BASE + item.id);
    if (it === undefined) continue;
    it.pos.x = item.pos.x;
    it.pos.y = item.pos.y;
    it.pos.z = item.pos.z;
    it.enabled = item.carrier === NO_CARRIER && !item.signedOut;
  }
}

/** Task 3 fills this in; a stub keeps `installRegister` compiling. */
export function pickUp(world: World, playerId: number, itemId: number): void {
  void world; void playerId; void itemId;
}

export { PLAYER_HALF as _playerHalfForTask3 };
```

(The last export is a placeholder so the unused import does not fail lint; Task 3 removes it when `putDown` uses `PLAYER_HALF`.)

- [ ] **Step 6: The world owns a register**

`client/src/sim/world.ts`: add `register: Register | null` to `World` (doc: "The book, the box and the car for a forest world; null for a hand-authored level."), `register: null` in `createWorld`, and in `createForestWorld` build and install it. Imports: `import { buildRegister, installRegister, type Register } from "./register.js";`, `import { PROPS, propSite } from "./passes/trailhead.js";`, `import { activeTerrainVariant, elevationAt } from "./terrain.js";`.

```ts
export function createForestWorld(forest: Forest, authoritative = true): World {
  const world: World = {
    // ...the existing literal, plus `register: null` and the Task 1 state fields...
  };
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(forest.seed);
  const roadCenterX = variant.roadCenterX;
  if (graph !== undefined && roadCenterX !== undefined) {
    const post = propSite(graph, roadCenterX, forest.seed, PROPS[0] as RoadProp);
    const car = propSite(graph, roadCenterX, forest.seed, PROPS[2] as RoadProp);
    installRegister(world, buildRegister({
      seed: forest.seed,
      graph,
      landmarks: variant.sceneryLandmarks?.(forest.seed) ?? [],
      groundH: (x, z) => elevationAt(forest.seed, x, z),
      box: post,
      car,
    }));
  }
  return world;
}
```

(`RoadProp` is exported from `passes/trailhead.ts`.) `register.ts` imports `type World` from `world.ts` and `world.ts` imports functions from `register.ts`: a type-only import on one side, so there is no runtime cycle.

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx vitest run --root client test/sim/hikerNames.test.ts test/sim/register.test.ts test/sim/registerSweep.test.ts test/sim/world.test.ts test/net && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS. The sweep takes about two minutes.

- [ ] **Step 8: Commit**

```bash
git add client/src/sim/hikerNames.ts client/src/sim/register.ts client/src/sim/terrain.ts client/src/sim/olympic.ts client/src/sim/world.ts client/test/sim/hikerNames.test.ts client/test/sim/register.test.ts client/test/sim/registerSweep.test.ts
git commit -m "feat: derive the register's sites, names and items from the seed"
```

---

### Task 3: The rules — pick up, put down, sign out, death, the win

**Files:**
- Modify: `client/src/sim/register.ts` (replace the `pickUp` stub; add `putDown`, `stepRegister`, `retrievedCount`, `signedOutCount`)
- Modify: `client/src/sim/world.ts` (`tickWorld` calls `stepRegister`; `updateRespawns` drops the carried item on death)
- Modify: `client/src/net/hostSession.ts` (an Interact edge with nothing in reach puts the item down)
- Test: `client/test/sim/registerRules.test.ts`, `client/test/net/hostSession.test.ts`

**Interfaces:**
- Consumes: `resolveInteract`, `Button.Interact`, `isDead` semantics (health ≤ 0 or respawnTimer > 0), Task 2's register.
- Produces: `pickUp(world, playerId, itemId)`, `putDown(world, player)`, `stepRegister(world, inputs)`, `retrievedCount(state)`, `signedOutCount(state)`.

- [ ] **Step 1: Write the failing tests**

`client/test/sim/registerRules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { Button, NO_CARRIER, NO_ITEM, Outcome, type InputCommand } from "../../src/sim/types.js";
import { PLAYER_HALF, RESPAWN_SECONDS, TICK_DT } from "../../src/sim/constants.js";
import {
  CAR_RADIUS, ITEM_INTERACTABLE_BASE, ITEM_RADIUS, SIGN_OUT_TICKS,
  installRegister, pickUp, putDown, retrievedCount, signedOutCount, type Register,
} from "../../src/sim/register.js";
import { resolveInteract } from "../../src/sim/interact.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-200, -1, -200], max: [200, 0, 200], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0], [0, 0.9, -5]],
  enemySpawns: [],
});
const input = (over: Partial<InputCommand> = {}): InputCommand =>
  ({ seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over });

/** Two hikers: one at (0, 0, 20), one at (40, 0, 0); the box at (0, 1, -20), the car at (30, 0.8, -20). */
function register(): Register {
  const site = (kind: "summit" | "meadow", name: string, x: number, z: number) =>
    ({ kind, name, x, y: 0, z, progress: 1 });
  return {
    hikers: [
      { id: 0, name: "Dana Whitcombe", site: site("summit", "the summit", 0, 20) },
      { id: 1, name: "Owen Marsh", site: site("meadow", "the meadow", 40, 0) },
    ],
    box: { x: 0, y: 1, z: -20 },
    car: { x: 30, y: 0.8, z: -20 },
  };
}

function world() {
  const w = createWorld(flat, 1);
  installRegister(w, register());
  const p = spawnPlayer(w);
  for (let i = 0; i < 120; i++) tickWorld(w, new Map()); // land
  return { w, p };
}
/** Stands the player facing +z at (x, z), on the ground. */
function standAt(p: { pos: { x: number; y: number; z: number }; yaw: number; pitch: number }, x: number, z: number, yaw = 0) {
  p.pos = { x, y: 0.9, z }; p.yaw = yaw; p.pitch = 0;
}

describe("pick up and put down", () => {
  it("picks an item up when it is in reach and the hands are empty, and marks it retrieved once", () => {
    const { w, p } = world();
    standAt(p, 0, 18); // the summit item at z = 20 is 2 m ahead
    const target = resolveInteract(w, p);
    expect(target?.id).toBe(ITEM_INTERACTABLE_BASE);
    target!.onInteract(p.id);
    expect(p.carrying).toBe(0);
    expect(w.state.items[0]).toMatchObject({ carrier: p.id, pickedUp: true });
    expect(retrievedCount(w.state)).toBe(1);
    // Carried: nobody else can reach for it.
    tickWorld(w, new Map());
    expect(w.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
  });

  it("refuses a second item while carrying, and a dead player altogether", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    pickUp(w, p.id, 1);
    expect(p.carrying).toBe(0);
    expect(w.state.items[1]!.carrier).toBe(NO_CARRIER);
    putDown(w, p);
    p.health = 0;
    pickUp(w, p.id, 1);
    expect(p.carrying).toBe(NO_ITEM);
  });

  it("puts the item down at the feet, where anyone can pick it up again without raising the count", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 7, -3);
    putDown(w, p);
    expect(p.carrying).toBe(NO_ITEM);
    expect(w.state.items[0]).toMatchObject({ carrier: NO_CARRIER, pos: { x: 7, y: 0.9 - PLAYER_HALF.y + ITEM_RADIUS, z: -3 } });
    const other = spawnPlayer(w);
    pickUp(w, other.id, 0);
    expect(other.carrying).toBe(0);
    expect(retrievedCount(w.state)).toBe(1);
  });

  it("drops the carried item where a player dies", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 12, 12);
    p.signOutTicks = 40;
    p.health = 0;
    tickWorld(w, new Map());
    expect(p.respawnTimer).toBeCloseTo(RESPAWN_SECONDS, 6);
    expect(p.carrying).toBe(NO_ITEM);
    expect(p.signOutTicks).toBe(0);
    expect(w.state.items[0]!.carrier).toBe(NO_CARRIER);
    expect(w.state.items[0]!.pos.x).toBeCloseTo(12, 6);
    expect(w.state.items[0]!.pos.z).toBeCloseTo(12, 6);
  });
});

describe("the sign-out", () => {
  const holding = (id: number) => new Map([[id, input({ buttons: Button.Interact })]]);

  it("signs the hiker out after SIGN_OUT_TICKS of Interact held at the box while carrying", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 0, -22); // the box at z = -20 is 2 m ahead, at chest height
    for (let i = 0; i < SIGN_OUT_TICKS - 1; i++) tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(SIGN_OUT_TICKS - 1);
    expect(w.state.items[0]!.signedOut).toBe(false);
    tickWorld(w, holding(p.id));
    expect(w.state.items[0]!.signedOut).toBe(true);
    expect(p.carrying).toBe(NO_ITEM);
    expect(p.signOutTicks).toBe(0);
    expect(signedOutCount(w.state)).toBe(1);
    // Gone from the world: nothing to reach for.
    expect(w.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
  });

  it("resets the hold when Interact is released, when the box leaves reach, and with empty hands", () => {
    const { w, p } = world();
    pickUp(w, p.id, 0);
    standAt(p, 0, -22);
    for (let i = 0; i < 100; i++) tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(100);
    tickWorld(w, new Map([[p.id, input()]]));
    expect(p.signOutTicks).toBe(0);
    for (let i = 0; i < 100; i++) tickWorld(w, holding(p.id));
    standAt(p, 0, -30);
    tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(0);
    standAt(p, 0, -22);
    putDown(w, p);
    for (let i = 0; i < 10; i++) tickWorld(w, holding(p.id));
    expect(p.signOutTicks).toBe(0);
  });
});

describe("the win", () => {
  it("is every hiker signed out and every living player at the car, and not before", () => {
    const { w, p } = world();
    const other = spawnPlayer(w);
    for (const item of w.state.items) item.signedOut = true;
    standAt(p, 30, -22);
    standAt(other, 100, 100);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
    standAt(other, 30 + CAR_RADIUS - 0.5, -20);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Won);
  });

  it("does not wait for the dead, and needs at least one living player", () => {
    const { w, p } = world();
    const other = spawnPlayer(w);
    for (const item of w.state.items) item.signedOut = true;
    standAt(p, 30, -22);
    other.health = 0;
    standAt(other, 100, 100);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Won);
    const { w: w2, p: p2 } = world();
    for (const item of w2.state.items) item.signedOut = true;
    p2.health = 0;
    tickWorld(w2, new Map());
    expect(w2.state.outcome).toBe(Outcome.Playing);
  });

  it("needs every hiker, not most of them", () => {
    const { w, p } = world();
    w.state.items[0]!.signedOut = true;
    standAt(p, 30, -22);
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
  });
});

describe("a client's predicted world", () => {
  it("never runs the rules: the host decides who holds what", () => {
    const w = createWorld(flat, 1, false);
    installRegister(w, register());
    const p = spawnPlayer(w);
    pickUp(w, p.id, 0);
    standAt(p, 0, -22);
    for (let i = 0; i < SIGN_OUT_TICKS + 5; i++) tickWorld(w, new Map([[p.id, input({ buttons: Button.Interact })]]));
    expect(w.state.items[0]!.signedOut).toBe(false);
    expect(p.signOutTicks).toBe(0);
  });
});
```

Append to `client/test/net/hostSession.test.ts`:

```ts
import { installRegister, ITEM_INTERACTABLE_BASE } from "../../src/sim/register.js";
import { NO_ITEM } from "../../src/sim/types.js";

describe("the register on the host", () => {
  it("puts a carried item down on an Interact press with nothing in reach", () => {
    const host = createHostSession(flat, 1);
    installRegister(host.world, {
      hikers: [{ id: 0, name: "Dana Whitcombe", site: { kind: "summit", name: "the summit", x: 0, y: 0, z: 20, progress: 1 } }],
      box: { x: 0, y: 1, z: -20 },
      car: { x: 30, y: 0.8, z: -20 },
    });
    const me = host.world.state.players.get(host.localEntityId)!;
    for (let i = 0; i < 120; i++) host.tick(input());
    me.pos = { x: 0, y: 0.9, z: 18 }; me.yaw = 0; me.pitch = 0;
    host.tick(input({ buttons: Button.Interact })); // picks up
    expect(me.carrying).toBe(0);
    host.tick(input());
    me.pos = { x: 5, y: 0.9, z: 5 };
    host.tick(input({ buttons: Button.Interact })); // nothing ahead: puts down
    expect(me.carrying).toBe(NO_ITEM);
    expect(host.world.state.items[0]!.pos.x).toBeCloseTo(5, 6);
    // The interactables are synced inside the tick, before the press edges
    // are applied, so the dropped item is reachable from the next tick on.
    host.tick(input());
    expect(host.world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/registerRules.test.ts test/net/hostSession.test.ts`
Expected: FAIL — `putDown` and `stepRegister` do not exist; nothing signs out.

- [ ] **Step 3: The rules in `register.ts`**

Replace the `pickUp` stub and the placeholder export with:

```ts
import type { InputCommand, ItemState, PlayerState, WorldState } from "./types.js";
import { Button, NO_ITEM, Outcome } from "./types.js";
import { resolveInteract } from "./interact.js";

/** `isDead` without importing world.ts (which imports this module). */
function dead(p: PlayerState): boolean {
  return p.health <= 0 || p.respawnTimer > 0;
}

/**
 * An Interact press on an item in reach. Empty hands only, one item at a
 * time; the first pick-up of a hiker is what raises the escalation count,
 * and a second never adds to it.
 */
export function pickUp(world: World, playerId: number, itemId: number): void {
  const player = world.state.players.get(playerId);
  const item = world.state.items[itemId];
  if (player === undefined || item === undefined) return;
  if (dead(player) || player.carrying !== NO_ITEM) return;
  if (item.carrier !== NO_CARRIER || item.signedOut) return;
  item.carrier = playerId;
  item.pickedUp = true;
  player.carrying = itemId;
  player.signOutTicks = 0;
}

/** Sets the carried item down at the player's feet — on a press with nothing in reach, and on death. */
export function putDown(world: World, player: PlayerState): void {
  if (player.carrying === NO_ITEM) return;
  const item = world.state.items[player.carrying];
  player.carrying = NO_ITEM;
  player.signOutTicks = 0;
  if (item === undefined) return;
  item.carrier = NO_CARRIER;
  item.pos = { x: player.pos.x, y: player.pos.y - PLAYER_HALF.y + ITEM_RADIUS, z: player.pos.z };
}

function signOut(world: World, player: PlayerState): void {
  const item = world.state.items[player.carrying];
  player.carrying = NO_ITEM;
  player.signOutTicks = 0;
  if (item === undefined) return;
  item.carrier = NO_CARRIER;
  item.signedOut = true;
}

/**
 * The per-tick rules, host only (`tickWorld` calls this in its authoritative
 * branch): the sign-out hold, the item interactables, and the win.
 *
 * The hold is read from this tick's command rather than from press edges: a
 * hold is a level, and it breaks the tick the level drops, the tick the box
 * leaves reach, and the tick the player dies or empties their hands.
 */
export function stepRegister(world: World, inputs: ReadonlyMap<number, InputCommand>): void {
  if (world.register === null) return;
  for (const player of world.state.players.values()) {
    if (player.carrying === NO_ITEM || dead(player)) {
      player.signOutTicks = 0;
      continue;
    }
    const cmd = inputs.get(player.id);
    const held = cmd !== undefined && (cmd.buttons & Button.Interact) !== 0;
    const target = held ? resolveInteract(world, player) : null;
    if (target === null || target.kind !== InteractKind.Register) {
      player.signOutTicks = 0;
      continue;
    }
    player.signOutTicks++;
    if (player.signOutTicks >= SIGN_OUT_TICKS) signOut(world, player);
  }
  syncItemInteractables(world);
  updateOutcome(world);
}

/** Every hiker signed out, and every living player within CAR_RADIUS of the car. */
function updateOutcome(world: World): void {
  const register = world.register;
  const state = world.state;
  if (register === null || state.outcome !== Outcome.Playing) return;
  if (state.items.length === 0 || !state.items.every((it) => it.signedOut)) return;
  let living = 0;
  for (const p of state.players.values()) {
    if (dead(p)) continue;
    living++;
    const dx = p.pos.x - register.car.x;
    const dz = p.pos.z - register.car.z;
    if (dx * dx + dz * dz > CAR_RADIUS * CAR_RADIUS) return;
  }
  if (living === 0) return;
  state.outcome = Outcome.Won;
}

/** Hikers picked up at least once: the escalation count (D reads this). */
export function retrievedCount(state: WorldState): number {
  let n = 0;
  for (const it of state.items) if (it.pickedUp) n++;
  return n;
}

export function signedOutCount(state: WorldState): number {
  let n = 0;
  for (const it of state.items) if (it.signedOut) n++;
  return n;
}

export type { ItemState };
```

(Remove the `_playerHalfForTask3` placeholder export; `PLAYER_HALF` is now used.)

- [ ] **Step 4: The world runs them**

`client/src/sim/world.ts`:
- import `putDown, stepRegister` from `./register.js`;
- in `tickWorld`'s authoritative branch, after `updateRespawns(world);` add `stepRegister(world, inputs);`;
- in `updateRespawns`, inside `if (player.health <= 0) {` before `player.respawnTimer = RESPAWN_SECONDS;` add `putDown(world, player);` with the comment: "What they carried stays where they fell: the item is dropped at the corpse before the respawn timer starts, so the position it lands on is the death position."

- [ ] **Step 5: The host's press with nothing in reach**

`client/src/net/hostSession.ts`, import `putDown` from `../sim/register.js`, and in the edges loop replace the Interact branch:

```ts
        if ((bits & Button.Interact) !== 0) {
          const target = resolveInteract(world, player);
          if (target === null) {
            // A press at nothing is the put-down: the carried item lands at
            // the player's feet (register.ts). No event: the next snapshot
            // carries the item where it fell.
            putDown(world, player);
          } else {
            target.onInteract(id);
            const peer = peerForEntity(id);
            const event = { t: MessageType.Interacted as const, entityId: id, targetId: target.id };
            if (peer === undefined) interactedHandler?.(event);
            else peer.transport.sendEvent(encodeEvent(event));
          }
        }
```

- [ ] **Step 6: Run the tests, types and lint**

Run: `npx vitest run --root client test/sim test/net && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS. (`clientSession.test.ts`'s "items and outcome" case: the host's `stepRegister` now zeroes a stray `signOutTicks`, so expect `0` there, per Task 1's note.)

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/register.ts client/src/sim/world.ts client/src/net/hostSession.ts client/test/sim/registerRules.test.ts client/test/net/hostSession.test.ts client/test/net/clientSession.test.ts
git commit -m "feat: pick up, put down and sign out the missing hikers, and win at the car"
```

---

### Task 4: The wall at the road

**Files:**
- Create: `client/src/sim/containment.ts`
- Modify: `client/src/sim/world.ts` (`applyMove`), `client/src/sim/forest.ts` (`GEN_VERSION` 5)
- Test: `client/test/sim/containment.test.ts`

**Interfaces:**
- Produces: `ROAD_WALL_U`, `containAtRoad(pos, vel, roadCenterX): boolean`.

- [ ] **Step 1: Write the failing tests**

`client/test/sim/containment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { ROAD_WALL_U, containAtRoad } from "../../src/sim/containment.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { PLAYER_HALF, TICK_DT } from "../../src/sim/constants.js";
import { createForest, GEN_VERSION } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { CAR_HALF, CAR_ROAD_U } from "../../src/sim/passes/trailhead.js";
import { CAR_RADIUS } from "../../src/sim/register.js";
import type { InputCommand } from "../../src/sim/types.js";

const input = (over: Partial<InputCommand> = {}): InputCommand =>
  ({ seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over });

describe("containAtRoad", () => {
  it("is the pavement's edge plus half a metre plus the hull's half-width", () => {
    expect(ROAD_WALL_U).toBeCloseTo(ROAD_BED_HALF + 0.5 + PLAYER_HALF.x, 9);
  });

  it("clamps a hull inside the wall back to it and cancels the velocity into it", () => {
    const pos = { x: 100 + ROAD_WALL_U - 0.7, y: 1, z: 0 };
    const vel = { x: -3, y: 0, z: 2 };
    expect(containAtRoad(pos, vel, 100)).toBe(true);
    expect(pos.x).toBeCloseTo(100 + ROAD_WALL_U, 9);
    expect(vel).toEqual({ x: 0, y: 0, z: 2 });
  });

  it("leaves a hull inland of the wall alone, velocity included", () => {
    const pos = { x: 100 + ROAD_WALL_U + 0.01, y: 1, z: 0 };
    const vel = { x: -3, y: 0, z: 0 };
    expect(containAtRoad(pos, vel, 100)).toBe(false);
    expect(vel.x).toBe(-3);
  });
});

describe("the wall in a forest world", { timeout: 120_000 }, () => {
  it("never lets a player onto the pavement from any direction, and the car stays within reach of the win", () => {
    const v = activeTerrainVariant();
    for (const seed of [0x5eed, 1, 12345]) {
      const world = createForestWorld(createForest(seed));
      const roadX = (z: number) => v.roadCenterX!(seed, z);
      // Eight headings; yaw 0 faces +z, PI/2 faces +x, so -PI/2 walks toward the road.
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * Math.PI * 2;
        const p = spawnPlayer(world);
        for (let t = 0; t < 900; t++) {
          tickWorld(world, new Map([[p.id, input({ seq: t + 1, moveZ: 1, yaw })]]));
          expect(p.pos.x - roadX(p.pos.z), `seed ${seed} heading ${k} tick ${t}`).toBeGreaterThanOrEqual(ROAD_WALL_U - 1e-6);
        }
        world.state.players.delete(p.id);
      }
      // Standing against the car's inland face is inside the win radius.
      const car = world.register!.car;
      const p = spawnPlayer(world);
      p.pos = { x: car.x + CAR_HALF.x + PLAYER_HALF.x + 0.05, y: elevationAt(seed, car.x, car.z) + PLAYER_HALF.y, z: car.z };
      for (let t = 0; t < 60; t++) tickWorld(world, new Map([[p.id, input({ seq: t + 1 })]]));
      const dx = p.pos.x - car.x, dz = p.pos.z - car.z;
      expect(Math.sqrt(dx * dx + dz * dz), `seed ${seed} car`).toBeLessThan(CAR_RADIUS);
      expect(p.pos.x - roadX(p.pos.z)).toBeGreaterThanOrEqual(ROAD_WALL_U - 1e-6);
      expect(CAR_ROAD_U - CAR_HALF.x).toBeCloseTo(ROAD_BED_HALF + 0.5, 9);
    }
    expect(GEN_VERSION).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/sim/containment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The wall**

`client/src/sim/containment.ts`:

```ts
import type { Vec3 } from "./types.js";
import { ROAD_BED_HALF } from "./road.js";
import { PLAYER_HALF } from "./constants.js";

/**
 * The invisible wall at the road: the one place the design admits one
 * (parent §16, B §1.12). The road runs along z with the forest on its +x
 * side (`TRAILHEAD_U` is +9), so the wall is a floor on the hull's road
 * offset u = x − roadCenterX(z).
 *
 * The hull's centre may come no nearer than the pavement's edge, half a metre
 * of shoulder, and its own half-width — so its road-side face stops exactly
 * where the car's does (`CAR_ROAD_U − CAR_HALF.x`), and the car on the
 * shoulder stays a thing you can stand against, not a thing behind glass.
 *
 * Runs inside the movement step on both sides, so a client predicts the
 * wall exactly and never rubber-bands off it.
 */
export const ROAD_WALL_U = ROAD_BED_HALF + 0.5 + PLAYER_HALF.x;

/** Clamps `pos` to the wall and cancels the velocity into it. Returns whether it acted. */
export function containAtRoad(pos: Vec3, vel: Vec3, roadCenterX: number): boolean {
  const wall = roadCenterX + ROAD_WALL_U;
  if (pos.x >= wall) return false;
  pos.x = wall;
  if (vel.x < 0) vel.x = 0;
  return true;
}
```

`client/src/sim/world.ts` `applyMove`, after `stepMovement`:

```ts
  // The wall at the road (containment.ts): a forest world with a road keeps
  // every hull off the pavement. After the step, on the settled position, so
  // the box sweep and the ground have already had their say.
  if (world.forest !== null) {
    const roadCenterX = activeTerrainVariant().roadCenterX;
    if (roadCenterX !== undefined) {
      containAtRoad(after.pos, after.vel, roadCenterX(world.forest.seed, after.pos.z));
    }
  }
  player.pos = after.pos;
  player.vel = after.vel;
  player.grounded = after.grounded;
```

`client/src/sim/forest.ts`: `GEN_VERSION = 5`, and add to its comment: "Bumped to 5 for the wall at the road: the ground is untouched, and a peer without the wall would walk through it."

- [ ] **Step 4: Run the tests, types and lint**

Run: `npx vitest run --root client test/sim/containment.test.ts test/sim/world.test.ts test/sim/respawn.test.ts test/net/clientSession.test.ts test/sim/forest.test.ts && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS. `forest.test.ts` may pin `GEN_VERSION` or a level id string: update that expectation to 5 in the same commit.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/containment.ts client/src/sim/world.ts client/src/sim/forest.ts client/test/sim/containment.test.ts client/test/sim/forest.test.ts
git commit -m "feat: keep every player off the highway with a wall at the road"
```

---

### Task 5: The client keeps its item interactables in step

**Files:**
- Modify: `client/src/net/clientSession.ts` (`reconcile` syncs the item interactables)
- Test: `client/test/net/clientSession.test.ts`

**Interfaces:**
- Consumes: `syncItemInteractables`, `installRegister` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `client/test/net/clientSession.test.ts`:

```ts
import { installRegister, ITEM_INTERACTABLE_BASE, pickUp, type Register } from "../../src/sim/register.js";

describe("the client's item interactables", () => {
  const register = (): Register => ({
    hikers: [{ id: 0, name: "Dana Whitcombe", site: { kind: "summit", name: "the summit", x: 0, y: 0, z: 20, progress: 1 } }],
    box: { x: 0, y: 1, z: -20 },
    car: { x: 30, y: 0.8, z: -20 },
  });

  it("follows the snapshot: a carried item cannot be reached for, a dropped one can, where it fell", () => {
    const h = harness();
    installRegister(h.host.world, register());
    installRegister(h.client.world, register());
    drive(h, 3, (t) => input({ seq: t + 1 }));
    expect(h.client.world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(true);
    pickUp(h.host.world, h.host.localEntityId, 0);
    drive(h, 6, (t) => input({ seq: t + 4 }));
    expect(h.client.world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
    const me = h.host.world.state.players.get(h.host.localEntityId)!;
    me.pos = { x: 9, y: 0.9, z: 9 };
    // The host's own put-down: register.ts's function, as hostSession calls it.
    h.host.world.state.items[0]!.carrier = 0;
    h.host.world.state.items[0]!.pos = { x: 9, y: 0.35, z: 9 };
    me.carrying = 255;
    drive(h, 6, (t) => input({ seq: t + 10 }));
    const it = h.client.world.interactables.get(ITEM_INTERACTABLE_BASE)!;
    expect(it.enabled).toBe(true);
    expect(it.pos.x).toBeCloseTo(9, 2);
    expect(it.pos.z).toBeCloseTo(9, 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/net/clientSession.test.ts`
Expected: FAIL — the client's interactable stays enabled.

- [ ] **Step 3: Sync after every snapshot**

`client/src/net/clientSession.ts`: import `syncItemInteractables` from `../sim/register.js`, and in `reconcile`, right after `predicted.state.outcome = snapshot.outcome;`, add `syncItemInteractables(predicted);` with the comment: "The prompt resolves against the predicted world's interactables, so they follow the host's items: a carried item is not there to reach for, a dropped one is where it fell."

- [ ] **Step 4: Run the tests, types and lint**

Run: `npx vitest run --root client test/net && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/net/clientSession.ts client/test/net/clientSession.test.ts
git commit -m "feat: a client reaches only for the items the host says are there"
```

---

### Task 6: Sign posts at every fork

**Files:**
- Create: `client/src/sim/signs.ts`
- Create: `client/src/sim/passes/signs.ts` (pass 9)
- Modify: `client/src/sim/passes/index.ts` (import the pass; update its comment)
- Modify: `client/src/game/renderer.ts` (`MATERIAL_COLORS.signpost`)
- Test: `client/test/sim/signs.test.ts`, `client/test/sim/signsSweep.test.ts`

**Interfaces:**
- Consumes: `TrailGraph`, `trailDistance`, `nearestTrailNode`, `TRAIL_BED_HALF`; `Register.hikers[].site` (Task 2).
- Produces: `SignPost`, `SignArm`, `signPosts(graph, sites)`, `SIGN_POST_OFFSET`, `SIGN_POST_HALF`, `TRAILHEAD_LABEL`; chunk props with material `signpost`.

- [ ] **Step 1: Write the failing tests**

`client/test/sim/signs.test.ts` (reuse the `graph()` builder from `register.test.ts` — copy it; tests do not import each other):

```ts
import { describe, expect, it } from "vitest";
import { SIGN_POST_OFFSET, TRAILHEAD_LABEL, signPosts } from "../../src/sim/signs.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
// graph(loops) exactly as in register.test.ts

const sites = (g: ReturnType<typeof graph>) => [
  { name: "the summit", x: 200, z: 0 },
  ...(g.loops.length >= 1 ? [{ name: "the meadow", x: 150, z: 50 }] : []),
];

describe("signPosts", () => {
  it("stands one post at every junction, with one arm per branch naming what lies down it", () => {
    const g = graph(1);
    const posts = signPosts(g, sites(g));
    // Only node 1 has three branches: the loop rejoins at the summit node,
    // whose degree is two.
    expect(posts).toHaveLength(1);
    const atJunction = posts.find((p) => Math.abs(p.x - 100) < SIGN_POST_OFFSET + 0.01 && Math.abs(p.z) < SIGN_POST_OFFSET + 0.01)!;
    expect(atJunction.arms).toHaveLength(3);
    const byNames = new Map(atJunction.arms.map((a) => [a.names.join("|"), a]));
    expect(byNames.has(TRAILHEAD_LABEL)).toBe(true);
    expect(byNames.has("the summit")).toBe(true);
    expect(byNames.get("the meadow")!.dz).toBeGreaterThan(0.7); // the loop leaves toward +z
    const toPad = byNames.get(TRAILHEAD_LABEL)!;
    expect(toPad.dx).toBeCloseTo(-1, 6);
  });

  it("names every site a branch reaches, nearest first", () => {
    const g = graph(2);
    const posts = signPosts(g, [{ name: "the summit", x: 200, z: 0 }, { name: "the lower meadow", x: 150, z: 50 }, { name: "the upper meadow", x: 150, z: -50 }]);
    const atJunction = posts.find((p) => Math.abs(p.x - 100) < 3)!;
    // Down the stem from node 1 everything is reachable: the summit and, round the loops, both meadows.
    const stem = atJunction.arms.find((a) => a.dx > 0.99)!;
    expect(stem.names).toEqual(["the summit", "the lower meadow", "the upper meadow"]);
  });

  it("stands the post off the bed", () => {
    const g = graph(1);
    for (const p of signPosts(g, sites(g))) {
      expect(trailDistance(g, p.x, p.z)).toBeGreaterThanOrEqual(TRAIL_BED_HALF);
    }
  });

  it("stands no post on a world with no junction", () => {
    const g = graph(0);
    expect(signPosts(g, sites(g))).toEqual([]);
  });
});
```

`client/test/sim/signsSweep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { PROPS, propSite } from "../../src/sim/passes/trailhead.js";
import { buildRegister } from "../../src/sim/register.js";
import { signPosts, SIGN_POST_HALF } from "../../src/sim/signs.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { PROBE_SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("sign posts on real worlds", { timeout: 120_000 }, () => {
  it("names every site on some arm, keeps every post off the bed, and emits each post once as a prop", () => {
    const v = activeTerrainVariant();
    for (const seed of PROBE_SEEDS) {
      const { graph, landmarks } = bowlFor(seed);
      const site = (i: number) => propSite(graph, v.roadCenterX!, seed, PROPS[i]!);
      const register = buildRegister({ seed, graph, landmarks, groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2) });
      const posts = signPosts(graph, register.hikers.map((h) => h.site));
      const degree = new Map<number, number>();
      for (const e of graph.edges) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }
      const junctions = [...degree.values()].filter((d) => d >= 3).length;
      expect(posts, `seed ${seed}`).toHaveLength(junctions);
      if (junctions > 0) {
        const named = new Set(posts.flatMap((p) => p.arms.flatMap((a) => a.names)));
        for (const h of register.hikers) expect(named.has(h.site.name), `seed ${seed} ${h.site.name}`).toBe(true);
      }
      const grid = createChunkGrid(seed);
      for (const p of posts) {
        expect(trailDistance(graph, p.x, p.z), `seed ${seed}`).toBeGreaterThanOrEqual(TRAIL_BED_HALF);
        const chunk = grid.chunkAt(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
        const emitted = chunk.props.filter((b) => b.material === "signpost" && Math.abs(b.box.min.x + SIGN_POST_HALF.x - p.x) < 1e-6);
        expect(emitted, `seed ${seed} post at ${p.x},${p.z}`).toHaveLength(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/signs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: The posts**

`client/src/sim/signs.ts`:

```ts
/**
 * Wooden sign posts at every junction of the trail graph, one arm per branch,
 * each arm naming the sites that branch leads to (B §2.5). Pure geometry over
 * the graph: the pass emits the post's collision box, `game/signMeshes.ts`
 * paints the arms.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot. Arms carry
 * unit directions, never angles.
 */
import type { TrailGraph, TrailNode } from "./trail.js";
import { TRAIL_BED_HALF, nearestTrailNode, trailDistance } from "./trail.js";
import type { Vec3 } from "./types.js";

export type SignArm = {
  /** Unit direction the arm points, from the post. */
  dx: number;
  dz: number;
  /** Nearest first. */
  names: string[];
};
export type SignPost = { x: number; z: number; arms: SignArm[] };

export const TRAILHEAD_LABEL = "Trailhead";
/** Metres from the junction node to the post: off the bed, on the shoulder. */
export const SIGN_POST_OFFSET = TRAIL_BED_HALF + 1;
export const SIGN_POST_HALF: Vec3 = { x: 0.1, y: 1.1, z: 0.1 };

const R2 = Math.SQRT1_2;
const COMPASS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2],
];

type NamedSite = { name: string; x: number; z: number };

/** Nodes reachable from `start` without passing through `avoid`, by graph distance order. */
function reachable(adjacency: number[][], start: number, avoid: number): number[] {
  const seen = new Set<number>([avoid, start]);
  const order = [start];
  for (let i = 0; i < order.length; i++) {
    for (const n of adjacency[order[i] as number] ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      order.push(n);
    }
  }
  return order;
}

export function signPosts(graph: TrailGraph, sites: readonly NamedSite[]): SignPost[] {
  const adjacency: number[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    (adjacency[e.a] as number[]).push(e.b);
    (adjacency[e.b] as number[]).push(e.a);
  }
  // Each site is read at its nearest node; a branch names the sites whose
  // node it reaches. Nearest first along the branch is the BFS order.
  const siteNode = sites.map((s) => nearestTrailNode(graph, s.x, s.z));

  const posts: SignPost[] = [];
  for (let j = 0; j < graph.nodes.length; j++) {
    const neighbours = adjacency[j] as number[];
    if (neighbours.length < 3) continue;
    const here = graph.nodes[j] as TrailNode;
    const arms: SignArm[] = [];
    for (const n of neighbours) {
      const there = graph.nodes[n] as TrailNode;
      const ex = there.x - here.x, ez = there.z - here.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      const order = reachable(adjacency, n, j);
      const names: string[] = [];
      for (const node of order) {
        if (node === 0) names.push(TRAILHEAD_LABEL);
        for (const [i, s] of sites.entries()) if (siteNode[i] === node && !names.includes(s.name)) names.push(s.name);
      }
      arms.push({ dx: len > 0 ? ex / len : 1, dz: len > 0 ? ez / len : 0, names });
    }
    // The post stands SIGN_POST_OFFSET from the node in whichever of eight
    // compass directions is farthest from every edge — never on the bed,
    // whatever angles the branches leave at.
    let best = COMPASS[0] as readonly [number, number];
    let bestD = -1;
    for (const dir of COMPASS) {
      const d = trailDistance(graph, here.x + dir[0] * SIGN_POST_OFFSET, here.z + dir[1] * SIGN_POST_OFFSET);
      if (d > bestD) { bestD = d; best = dir; }
    }
    posts.push({ x: here.x + best[0] * SIGN_POST_OFFSET, z: here.z + best[1] * SIGN_POST_OFFSET, arms });
  }
  return posts;
}
```

- [ ] **Step 4: Pass 9**

`client/src/sim/passes/signs.ts`:

```ts
import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import { SIGN_POST_HALF, SIGN_POST_OFFSET, signPosts } from "../signs.js";

/** Pass 9. The sign posts' collision boxes, one per junction, emitted into the
 * chunk holding the post's centre, like the trailhead pass. The arms and
 * their names are render-only (`game/signMeshes.ts`), so the pass needs the
 * graph and nothing about the book. */
registerPass({
  id: 9,
  name: "signs",
  get tunables() {
    return { SIGN_POST_OFFSET, SIGN_POST_HALF_X: SIGN_POST_HALF.x, SIGN_POST_HALF_Y: SIGN_POST_HALF.y };
  },
  run(chunk, worldSeed) {
    const graph = activeTerrainVariant().trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE, minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
    for (const p of signPosts(graph, [])) {
      if (p.x < minX || p.x >= maxX || p.z < minZ || p.z >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, p.x, p.z).h;
      chunk.props.push({
        material: "signpost",
        box: {
          min: { x: p.x - SIGN_POST_HALF.x, y: ground, z: p.z - SIGN_POST_HALF.z },
          max: { x: p.x + SIGN_POST_HALF.x, y: ground + 2 * SIGN_POST_HALF.y, z: p.z + SIGN_POST_HALF.z },
        },
      });
    }
  },
});
```

`client/src/sim/passes/index.ts`: add `import "./signs.js";` after the trailhead import and extend the comment: "Pass 9, signs, emits the sign posts at the trail's junctions." `client/src/game/renderer.ts` `MATERIAL_COLORS`: add `signpost: [0.45, 0.33, 0.2],`.

- [ ] **Step 5: Run the tests, types and lint**

Run: `npx vitest run --root client test/sim/signs.test.ts test/sim/signsSweep.test.ts test/sim/forest.test.ts test/sim/passes.test.ts && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS. (`forest.test.ts` proves every pass moves the digest; pass 9 must too — it does, through its tunables and emitted props.)

- [ ] **Step 6: Commit**

```bash
git add client/src/sim/signs.ts client/src/sim/passes/signs.ts client/src/sim/passes/index.ts client/src/game/renderer.ts client/test/sim/signs.test.ts client/test/sim/signsSweep.test.ts
git commit -m "feat: stand a sign post at every fork of the trail"
```

---

### Task 7: The screens — prompt labels and the hold ring, the book, the road line, the win

**Files:**
- Modify: `client/src/game/interactPrompt.ts`
- Create: `client/src/game/registerPanel.ts`, `client/src/game/registerHud.ts`
- Modify: `client/src/game/hud.ts`
- Modify: `client/src/app.ts`
- Modify: `client/test/architecture.test.ts` (`registerHud.ts` joins `BABYLON_FREE_FILES`)
- Test: `client/test/game/interactPrompt.test.ts`, `client/test/game/registerPanel.test.ts`, `client/test/game/registerHud.test.ts`

**Interfaces:**
- Consumes: `Interactable.label`, `InteractKind`, `SIGN_OUT_TICKS`, `Register`, `ItemState`, `ROAD_WALL_U`, `Outcome`.
- Produces: `promptModel(target, projected, viewport, touch, ctx)` with `ctx = { carrying: string | null; hold: number }` and `PromptView.hold`; `registerPanelModel(register, items, playerNames)`, `createRegisterPanel(container)`; `roadLine(u, allSignedOut)`, `ROAD_LINE_U`, `WIN_LINE`; `hud.flash(text, ms)`, `hud.fade(on)`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/interactPrompt.test.ts` (read its existing calls to `promptModel` first and add the fifth argument `{ carrying: null, hold: 0 }` to each):

```ts
import { InteractKind } from "../../src/sim/register.js";

describe("promptModel with the register", () => {
  const vp = { width: 800, height: 600 };
  const at = { x: 100, y: 100, depth: 1.5 };

  it("names the item from the interactable's label, on every device", () => {
    const target = { kind: InteractKind.Item, label: "Pick up Dana Whitcombe" };
    expect(promptModel(target, at, vp, false, { carrying: null, hold: 0 })?.label).toBe("Pick up Dana Whitcombe");
    expect(promptModel(target, at, vp, true, { carrying: null, hold: 0 })?.label).toBe("Pick up Dana Whitcombe");
  });

  it("offers the book with empty hands and the sign-out while carrying", () => {
    const box = { kind: InteractKind.Register, label: "Read the register" };
    expect(promptModel(box, at, vp, false, { carrying: null, hold: 0 })?.label).toBe("Read the register");
    expect(promptModel(box, at, vp, false, { carrying: "Dana Whitcombe", hold: 0 })?.label).toBe("Sign out Dana Whitcombe — hold");
  });

  it("carries the hold, clamped, only at the box", () => {
    const box = { kind: InteractKind.Register, label: "Read the register" };
    expect(promptModel(box, at, vp, false, { carrying: "Dana Whitcombe", hold: 0.4 })?.hold).toBe(0.4);
    expect(promptModel(box, at, vp, false, { carrying: "Dana Whitcombe", hold: 1.7 })?.hold).toBe(1);
    expect(promptModel({ kind: InteractKind.Item, label: "Pick up X" }, at, vp, false, { carrying: null, hold: 0.4 })?.hold).toBe(0);
  });

  it("still says Click to interact for the plain kind on a mouse", () => {
    expect(promptModel({ kind: 0 }, at, vp, false, { carrying: null, hold: 0 })?.label).toBe("Click to interact");
  });
});
```

`client/test/game/registerPanel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { registerPanelModel } from "../../src/game/registerPanel.js";
import type { Register } from "../../src/sim/register.js";
import { NO_CARRIER, type ItemState } from "../../src/sim/types.js";

const register: Register = {
  hikers: [
    { id: 0, name: "Dana Whitcombe", site: { kind: "summit", name: "the summit", x: 0, y: 0, z: 0, progress: 1 } },
    { id: 1, name: "Owen Marsh", site: { kind: "meadow", name: "the meadow", x: 0, y: 0, z: 0, progress: 0.5 } },
    { id: 2, name: "Ruth Petersen", site: { kind: "pond", name: "the pond", x: 0, y: 0, z: 0, progress: 0.7 } },
  ],
  box: { x: 0, y: 1, z: 0 },
  car: { x: 0, y: 0, z: 0 },
};
const item = (id: number, over: Partial<ItemState> = {}): ItemState =>
  ({ id, pos: { x: 0, y: 0, z: 0 }, carrier: NO_CARRIER, pickedUp: false, signedOut: false, ...over });

describe("registerPanelModel", () => {
  it("lists every hiker in book order with where they were last seen and their state", () => {
    const view = registerPanelModel(register, [item(0, { signedOut: true, pickedUp: true }), item(1, { carrier: 7, pickedUp: true }), item(2)], new Map([[7, "Hiker-8097"]]));
    expect(view.title).toBe("Trailhead register");
    expect(view.rows).toEqual([
      { name: "Dana Whitcombe", site: "last seen at the summit", status: "signed out" },
      { name: "Owen Marsh", site: "last seen at the meadow", status: "with Hiker-8097" },
      { name: "Ruth Petersen", site: "last seen at the pond", status: "missing" },
    ]);
    expect(view.footer).toBe("1 of 3 signed out");
  });

  it("reads 'carried' when the carrier has no name", () => {
    const view = registerPanelModel(register, [item(0, { carrier: 9 }), item(1), item(2)], new Map());
    expect(view.rows[0]!.status).toBe("carried");
  });
});
```

`client/test/game/registerHud.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ROAD_LINE_U, WIN_LINE, roadLine } from "../../src/game/registerHud.js";
import { ROAD_WALL_U } from "../../src/sim/containment.js";

describe("roadLine", () => {
  it("speaks within half a metre of the wall and not beyond", () => {
    expect(ROAD_LINE_U).toBeCloseTo(ROAD_WALL_U + 0.5, 9);
    expect(roadLine(ROAD_WALL_U, false)).toBe("I need to find those missing hikers first.");
    expect(roadLine(ROAD_WALL_U + 0.49, false)).not.toBeNull();
    expect(roadLine(ROAD_WALL_U + 0.51, false)).toBeNull();
  });

  it("points at the car once every hiker is signed out", () => {
    expect(roadLine(ROAD_WALL_U, true)).toBe("Get to the car.");
  });

  it("has the win line", () => {
    expect(WIN_LINE).toBe("You signed them out.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/game/interactPrompt.test.ts test/game/registerPanel.test.ts test/game/registerHud.test.ts`
Expected: FAIL.

- [ ] **Step 3: The prompt**

`client/src/game/interactPrompt.ts`:

```ts
import { INTERACT_REACH } from "../sim/interact.js";
import { InteractKind } from "../sim/register.js";

export type PromptView = { x: number; y: number; label: string; scale: number; hold: number };
export type PromptContext = {
  /** The carried hiker's name, or null with empty hands. */
  carrying: string | null;
  /** The sign-out hold, 0 to 1. */
  hold: number;
};

/** The verb for an interactable's `kind`, when it carries no label of its own. */
export function promptLabel(kind: number): string {
  return LABELS[kind] ?? "Interact";
}

export function promptModel(
  target: { kind: number; label?: string } | null,
  projected: Projected | null,
  viewport: { width: number; height: number },
  touch: boolean,
  ctx: PromptContext,
): PromptView | null {
  if (target === null || projected === null) return null;
  let label: string;
  let hold = 0;
  if (target.kind === InteractKind.Register) {
    if (ctx.carrying === null) label = target.label ?? "Read the register";
    else {
      label = `Sign out ${ctx.carrying} — hold`;
      hold = Math.min(1, Math.max(0, ctx.hold));
    }
  } else if (target.label !== undefined) {
    // A named thing reads the same on every device: "Click to pick up dana
    // whitcombe" would lowercase a name.
    label = target.label;
  } else {
    label = touch ? promptLabel(target.kind) : `Click to ${promptLabel(target.kind).toLowerCase()}`;
  }
  const t = Math.min(1, Math.max(0, (projected.depth - NEAR_M) / (INTERACT_REACH - NEAR_M)));
  const scale = 1 - (1 - FAR_SCALE) * t;
  return {
    x: Math.min(viewport.width - EDGE_PX, Math.max(EDGE_PX, projected.x)),
    y: Math.min(viewport.height - EDGE_PX, Math.max(EDGE_PX, projected.y)),
    label,
    scale,
    hold,
  };
}
```

The ring: in `STYLE`, make the dot's ring a conic gradient driven by a custom property, and paint it in `sync`:

```css
  .prompt .dot {
    width: 12px; height: 12px; border-radius: 50%; position: relative;
    background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
    animation: prompt-drift 3s ease-in-out infinite;
  }
  /* The sign-out hold: a ring that fills clockwise round the dot over five
     seconds and empties the instant the hold breaks — no transition, so an
     interrupted ritual is unmistakable. */
  .prompt .dot::after {
    content: ""; position: absolute; inset: -6px; border-radius: 50%;
    background: conic-gradient(rgba(255, 255, 255, 0.9) calc(var(--hold, 0) * 360deg), rgba(255, 255, 255, 0.15) 0);
    -webkit-mask: radial-gradient(circle, transparent 9px, #000 10px);
    mask: radial-gradient(circle, transparent 9px, #000 10px);
    opacity: 0;
  }
  .prompt.holding .dot::after { opacity: 1; }
```

and in `sync(view)` after the label: `root.classList.toggle("holding", view.hold > 0); root.style.setProperty("--hold", String(view.hold));`.

- [ ] **Step 4: The book panel**

`client/src/game/registerPanel.ts`:

```ts
import type { Register } from "../sim/register.js";
import type { ItemState } from "../sim/types.js";
import { NO_CARRIER } from "../sim/types.js";

export type RegisterRow = { name: string; site: string; status: string };
export type RegisterPanelView = { title: string; rows: RegisterRow[]; footer: string };

/** The book as data: one row per hiker in book order, and the count. */
export function registerPanelModel(
  register: Register,
  items: readonly ItemState[],
  playerNames: ReadonlyMap<number, string>,
): RegisterPanelView {
  const rows = register.hikers.map((h) => {
    const item = items[h.id];
    let status = "missing";
    if (item !== undefined && item.signedOut) status = "signed out";
    else if (item !== undefined && item.carrier !== NO_CARRIER) {
      const who = playerNames.get(item.carrier);
      status = who === undefined ? "carried" : `with ${who}`;
    }
    return { name: h.name, site: `last seen at ${h.site.name}`, status };
  });
  const signed = rows.filter((r) => r.status === "signed out").length;
  return { title: "Trailhead register", rows, footer: `${signed} of ${rows.length} signed out` };
}

const STYLE = `
  .register {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    /* Above the touch layer (15), below the pause menu (18) and the roster (20). */
    z-index: 16; pointer-events: none;
    font-family: ui-monospace, monospace; color: #f2ead8;
  }
  .register.open { display: flex; }
  .register .page {
    min-width: 18rem; max-width: 26rem; padding: 1rem 1.25rem;
    background: rgba(28, 24, 18, 0.92); border: 1px solid rgba(242, 234, 216, 0.25); border-radius: 4px;
  }
  .register h1 { margin: 0 0 0.75rem; font-size: 0.85rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }
  .register ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .register li { display: flex; flex-direction: column; gap: 0.1rem; }
  .register .name { font-size: 1.05rem; }
  .register .site { font-size: 0.85rem; opacity: 0.7; }
  .register .status { font-size: 0.8rem; opacity: 0.85; }
  .register li.out .name { text-decoration: line-through; opacity: 0.6; }
  .register .footer { margin-top: 0.9rem; font-size: 0.8rem; opacity: 0.7; }
`;

export type RegisterPanel = {
  show(view: RegisterPanelView): void;
  hide(): void;
  readonly isOpen: boolean;
  dispose(): void;
};

/** Built with DOM APIs and `textContent`: names come from the seed today, from players tomorrow. */
export function createRegisterPanel(container: HTMLElement): RegisterPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "register";
  const page = document.createElement("div");
  page.className = "page";
  const title = document.createElement("h1");
  const list = document.createElement("ul");
  const footer = document.createElement("div");
  footer.className = "footer";
  page.append(title, list, footer);
  root.append(page);
  container.append(style, root);
  let isOpen = false;
  return {
    show(view) {
      title.textContent = view.title;
      list.replaceChildren(
        ...view.rows.map((r) => {
          const li = document.createElement("li");
          li.classList.toggle("out", r.status === "signed out");
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = r.name;
          const site = document.createElement("span");
          site.className = "site";
          site.textContent = r.site;
          const status = document.createElement("span");
          status.className = "status";
          status.textContent = r.status;
          li.append(name, site, status);
          return li;
        }),
      );
      footer.textContent = view.footer;
      isOpen = true;
      root.classList.add("open");
    },
    hide() {
      isOpen = false;
      root.classList.remove("open");
    },
    get isOpen() {
      return isOpen;
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
```

- [ ] **Step 5: The lines and the HUD**

`client/src/game/registerHud.ts` (Babylon-free; add it to `BABYLON_FREE_FILES`):

```ts
import { ROAD_WALL_U } from "../sim/containment.js";

/** Within this of the wall, the line speaks. */
export const ROAD_LINE_U = ROAD_WALL_U + 0.5;
export const WIN_LINE = "You signed them out.";

/** What a player at road offset `u` is told, or null when they are not at the wall. */
export function roadLine(u: number, allSignedOut: boolean): string | null {
  if (u > ROAD_LINE_U) return null;
  return allSignedOut ? "Get to the car." : "I need to find those missing hikers first.";
}
```

`client/src/game/hud.ts`: a fade layer and a timed line.

```css
  .hud .fade {
    position: absolute; inset: 0; background: #000; opacity: 0;
    transition: opacity 1.5s ease-in;
  }
  .hud .fade.on { opacity: 1; }
  .hud .status { /* unchanged, but ensure it paints above the fade: */ z-index: 1; }
```

(The fade `div` is appended before `status` so the status line sits above it.) API:

```ts
export type Hud = {
  setStatus(text: string | null): void;
  /** A line that clears itself after `ms`, unless something replaces it first. */
  flash(text: string, ms: number): void;
  /** Darkens the whole view over 1.5 s; the status line stays readable on top. */
  fade(on: boolean): void;
  setRespawn(seconds: number | null): void;
  dispose(): void;
};
```

Implementation: `let flashTimer: ReturnType<typeof setTimeout> | null = null;` — `setStatus` clears any pending flash timer; `flash(text, ms)` sets the status, clears the timer, and sets a new one that blanks the status only if it still reads `text`; `fade(on)` toggles the `on` class; `dispose` clears the timer.

- [ ] **Step 6: Wire the app**

`client/src/app.ts`:

- Imports: `createRegisterPanel, registerPanelModel` from `./game/registerPanel.js`; `roadLine, WIN_LINE` from `./game/registerHud.js`; `InteractKind, SIGN_OUT_TICKS` from `./sim/register.js`; `NO_ITEM, Outcome` from `./sim/types.js`; `pressedEdges` from `./sim/interact.js`.
- After `const prompt = createInteractPrompt(...)`: `const registerPanel = createRegisterPanel(container);`
- `syncPrompt(world, self)` gains the context:

```ts
    const carrying =
      self !== undefined && self.carrying !== NO_ITEM ? (world.register?.hikers[self.carrying]?.name ?? null) : null;
    prompt.sync(
      promptModel(target, projected, { width: canvas.clientWidth, height: canvas.clientHeight }, touchStart, {
        carrying,
        hold: self === undefined ? 0 : self.signOutTicks / SIGN_OUT_TICKS,
      }),
    );
```

- A local Interact edge opens or closes the book. Both loops already build the tick's commands (`input.sample(++seq)`); keep the last command per frame in a `let lastButtons = 0;` and after each tick's sample:

```ts
  /**
   * The book is this player's own screen: it opens on an Interact press at
   * the box with empty hands, and closes on the next press or the first step.
   * Local only — the host resolves the same press and does nothing with it.
   */
  function syncBook(world: World, self: PlayerState | undefined, cmd: InputCommand, state: WorldState): void {
    const edges = pressedEdges(lastButtons, cmd.buttons);
    lastButtons = cmd.buttons;
    if (self === undefined || world.register === null) return;
    if (registerPanel.isOpen) {
      if ((edges & Button.Interact) !== 0 || cmd.moveX !== 0 || cmd.moveZ !== 0) registerPanel.hide();
      return;
    }
    if ((edges & Button.Interact) === 0 || self.carrying !== NO_ITEM) return;
    const target = resolveInteract(world, self);
    if (target === null || target.kind !== InteractKind.Register) return;
    // No carrier names yet: lobby members are keyed by signaling peer id and
    // the items by entity id, and nothing in the game maps one to the other.
    // A carried item reads "carried"; naming the carrier is a follow-up.
    registerPanel.show(registerPanelModel(world.register, state.items, new Map()));
  }
```

  Call it once per frame in both loops with the last sampled command (`const cmd = input.sample(seq)` is already how freecam re-reads the aim; reuse that value rather than sampling again).

- The road line, once per frame in both loops after `renderer.sync`:

```ts
  let roadLineAt = -Infinity;
  function syncRoadLine(self: PlayerState | undefined, state: WorldState): void {
    const roadCenterX = activeTerrainVariant().roadCenterX;
    if (self === undefined || roadCenterX === undefined || state.items.length === 0) return;
    const u = self.pos.x - roadCenterX(seed, self.pos.z);
    const line = roadLine(u, state.items.every((it) => it.signedOut));
    const now = performance.now();
    if (line === null || now - roadLineAt < 4000) return;
    roadLineAt = now;
    hud.flash(line, 3000);
  }
```

- The win, once: 

```ts
  let won = false;
  function syncOutcome(state: WorldState): void {
    if (won || state.outcome !== Outcome.Won) return;
    won = true;
    input.setSuppressed(true);
    hud.fade(true);
    hud.setStatus(WIN_LINE);
    if (landingTimer !== null) clearTimeout(landingTimer);
    landingTimer = setTimeout(navigateToLanding, 5000);
  }
```

- `dispose()`: `registerPanel.dispose();` beside `prompt.dispose()`.

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx vitest run --root client test/game test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/interactPrompt.ts client/src/game/registerPanel.ts client/src/game/registerHud.ts client/src/game/hud.ts client/src/app.ts client/test/architecture.test.ts client/test/game/interactPrompt.test.ts client/test/game/registerPanel.test.ts client/test/game/registerHud.test.ts
git commit -m "feat: the book, the sign-out ring, the line at the road and the win on screen"
```

---

### Task 8: Items, the carried bundle and the painted arms

**Files:**
- Modify: `client/src/game/entityViews.ts` (item meshes)
- Modify: `client/src/game/renderer.ts` (the local carried bundle; `MATERIAL_COLORS.item`)
- Create: `client/src/game/signMeshes.ts`
- Modify: `client/src/app.ts` (create and dispose the sign meshes)
- Test: `client/test/game/entityViews.test.ts`, `client/test/game/signMeshes.test.ts`

**Interfaces:**
- Consumes: `ItemState`, `NO_CARRIER`, `ITEM_RADIUS`, `SignPost`, `signPosts`, `Register`, `PROPS`/`propSite`, `SIGN_HALF`.
- Produces: `createSignMeshes(scene, posts, board, materialFor)`, `SignBoard`; `Renderer.sync` shows the bundle when `state.players.get(localId).carrying !== NO_ITEM`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/entityViews.test.ts`:

```ts
import { ITEM_RADIUS } from "../../src/sim/register.js";
import { NO_CARRIER, type ItemState } from "../../src/sim/types.js";

describe("EntityViews items", () => {
  const item = (id: number, over: Partial<ItemState> = {}): ItemState =>
    ({ id, pos: { x: 10 + id, y: 0.35, z: 20 }, carrier: NO_CARRIER, pickedUp: false, signedOut: false, ...over });

  it("draws an item on the ground where it lies, hides a signed-out one, and shows a remote carrier's at their front", () => {
    const views = new EntityViews(scene);
    const s = { ...state(player(1, false), { ...player(2, false), pos: { x: 0, y: 0.9, z: 0 }, yaw: 0 }), items: [item(0), item(1, { signedOut: true, pickedUp: true }), item(2, { carrier: 2, pickedUp: true })] };
    views.sync(s, 1, 1);
    const onGround = scene.getMeshByName("item_0")!;
    expect(onGround.isEnabled()).toBe(true);
    expect(onGround.position.asArray()).toEqual([10, 0.35, 20]);
    expect(scene.getMeshByName("item_1")!.isEnabled()).toBe(false);
    const carried = scene.getMeshByName("item_2")!;
    expect(carried.isEnabled()).toBe(true);
    // Half a metre ahead of the capsule (yaw 0 faces +z), a little above its centre.
    expect(carried.position.x).toBeCloseTo(0, 6);
    expect(carried.position.z).toBeCloseTo(0.5, 6);
    expect(carried.position.y).toBeCloseTo(0.9 + 0.2, 6);
    views.dispose();
  });

  it("hides the local player's own carried item: the camera bundle shows it instead", () => {
    const views = new EntityViews(scene);
    const s = { ...state(player(1, false)), items: [item(0, { carrier: 1, pickedUp: true })] };
    views.sync(s, 1, 1);
    expect(scene.getMeshByName("item_0")!.isEnabled()).toBe(false);
    views.dispose();
    expect(ITEM_RADIUS).toBe(0.35);
  });
});
```

`client/test/game/signMeshes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createSignMeshes, armYaw } from "../../src/game/signMeshes.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

describe("signMeshes", () => {
  it("turns an arm's unit direction into the yaw the sim convention uses (0 faces +z, PI/2 faces +x)", () => {
    expect(armYaw({ dx: 0, dz: 1 })).toBeCloseTo(0, 9);
    expect(armYaw({ dx: 1, dz: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(armYaw({ dx: -1, dz: 0 })).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("builds one arm per branch at the post, and one board, all disposable", () => {
    const before = scene.meshes.length;
    const signs = createSignMeshes(
      scene,
      [{ x: 100, z: 0, arms: [{ dx: 1, dz: 0, names: ["the summit"] }, { dx: -1, dz: 0, names: ["Trailhead"] }] }],
      { x: 5, z: 7, facing: { dx: 0, dz: -1 }, lines: ["Dana Whitcombe — last seen at the summit"] },
      () => 1.8,
    );
    expect(scene.meshes.length - before).toBe(3);
    const arm = scene.getMeshByName("sign_0_arm_0")!;
    expect(arm.position.x).toBeGreaterThan(100);
    expect(arm.position.y).toBeCloseTo(1.8 + 1.8, 6);
    signs.dispose();
    expect(scene.meshes.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/game/entityViews.test.ts test/game/signMeshes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Item meshes**

`client/src/game/entityViews.ts`: import `NO_CARRIER` from `../sim/types.js` and `ITEM_RADIUS` from `../sim/register.js`; add `private readonly items = new Map<number, Mesh>();` and `private readonly itemMaterial: PBRMaterial;` (albedo `(0.85, 0.8, 0.7)`, metallic 0, roughness 0.9, built in the constructor beside the others). In `sync`, after the enemy block:

```ts
    for (const item of state.items) {
      let mesh = this.items.get(item.id);
      if (mesh === undefined) {
        // A pale bundle about the size of a pack: the placeholder for what is
        // left of a hiker, lit like everything else so the lamp finds it.
        mesh = MeshBuilder.CreateBox(`item_${item.id}`, { width: 0.5, height: 2 * ITEM_RADIUS, depth: 0.35 }, this.scene);
        mesh.material = this.itemMaterial;
        this.items.set(item.id, mesh);
      }
      if (item.signedOut || item.carrier === localId) {
        // Gone, or in this player's own hands: the renderer's camera bundle draws that one.
        mesh.setEnabled(false);
        continue;
      }
      const carrier = item.carrier === NO_CARRIER ? undefined : this.players.get(item.carrier);
      if (carrier !== undefined) {
        // Held against the front of the carrier's body: half a metre ahead
        // along their facing, a little above the hull's centre.
        const yaw = carrier.node.rotation.y;
        mesh.position.set(
          carrier.node.position.x + Math.sin(yaw) * 0.5,
          carrier.node.position.y + 0.2,
          carrier.node.position.z + Math.cos(yaw) * 0.5,
        );
        mesh.rotation.y = yaw;
      } else if (item.carrier === NO_CARRIER) {
        mesh.position.set(item.pos.x, item.pos.y, item.pos.z);
        mesh.rotation.y = 0;
      } else {
        // Carried by someone this frame's state does not hold (a joiner
        // between snapshots): nothing to attach to, so nothing to draw.
        mesh.setEnabled(false);
        continue;
      }
      mesh.setEnabled(true);
    }
    for (const [id, mesh] of this.items) {
      if (!state.items.some((it) => it.id === id)) {
        mesh.dispose();
        this.items.delete(id);
      }
    }
```

`dispose()` disposes every item mesh and clears the map.

- [ ] **Step 4: The bundle in the local player's hands**

`client/src/game/renderer.ts`: import `NO_ITEM` from `../sim/types.js`. After `localLamp`:

```ts
  // What this player carries, held low in view and riding the camera — and so
  // the walking cue — like the lamp does. Enabled only while `carrying` is set.
  const carried = MeshBuilder.CreateBox("carried_item", { width: 0.5, height: 0.35, depth: 0.35 }, scene);
  carried.parent = camera;
  carried.position.set(0.28, -0.32, 0.6);
  carried.rotation.set(0.15, -0.35, 0);
  carried.material = terrainMaterialFor(scene, "item");
  carried.setEnabled(false);
```

`MATERIAL_COLORS`: `item: [0.85, 0.8, 0.7],`. In `sync`, in the `if (local)` branch after `setLamp(localLamp, local.lamp.on);`: `carried.setEnabled(local.carrying !== NO_ITEM);` and in the freecam branch `carried.setEnabled(false);`. `dispose()` disposes it.

- [ ] **Step 5: The arms and the board**

`client/src/game/signMeshes.ts`:

```ts
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { SignPost } from "../sim/signs.js";
import { SIGN_POST_HALF } from "../sim/signs.js";

/** The trailhead board: the sign beside the car, with the book painted on the face toward the pad. */
export type SignBoard = { x: number; z: number; facing: { dx: number; dz: number }; lines: string[] };

export type SignMeshes = { dispose(): void };

/** The yaw that turns +z onto a unit direction, in the sim's convention (yaw 0 faces +z, PI/2 faces +x). */
export function armYaw(dir: { dx: number; dz: number }): number {
  return Math.atan2(dir.dx, dir.dz);
}

const ARM_LENGTH = 0.9;
const ARM_HEIGHT = 0.16;
const ARM_ABOVE_GROUND = 1.8;
const WOOD = "#6b4f2a";
const PAINT = "#f2ead8";

/**
 * Painted wood: the words are drawn into a texture on the arm rather than
 * floated in the air, so they are read the way a sign is — by walking up to
 * it with a lamp. One texture per arm and one for the board; a handful per
 * world, never rebuilt.
 */
function paintedMaterial(scene: Scene, name: string, lines: readonly string[], width: number, height: number): PBRMaterial {
  const texture = new DynamicTexture(name, { width, height }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = WOOD;
  ctx.fillRect(0, 0, width, height);
  const size = Math.round(Math.min(height * 0.45, (height / (lines.length + 1)) * 0.8));
  ctx.font = `bold ${size}px ui-monospace, monospace`;
  ctx.fillStyle = PAINT;
  for (const [i, line] of lines.entries()) {
    ctx.fillText(line, size * 0.5, size * 1.2 + i * size * 1.3);
  }
  texture.update(true);
  const material = new PBRMaterial(`${name}_mat`, scene);
  material.albedoTexture = texture;
  material.metallic = 0;
  material.roughness = 0.9;
  return material;
}

export function createSignMeshes(
  scene: Scene,
  posts: readonly SignPost[],
  board: SignBoard,
  groundH: (x: number, z: number) => number,
): SignMeshes {
  const meshes: Mesh[] = [];
  for (const [p, post] of posts.entries()) {
    const base = groundH(post.x, post.z);
    for (const [a, arm] of post.arms.entries()) {
      const mesh = MeshBuilder.CreateBox(`sign_${p}_arm_${a}`, { width: 0.05, height: ARM_HEIGHT, depth: ARM_LENGTH }, scene);
      // The arm's near end at the post's face, its length along the direction it names.
      const along = SIGN_POST_HALF.x + ARM_LENGTH / 2;
      mesh.position.set(post.x + arm.dx * along, base + ARM_ABOVE_GROUND, post.z + arm.dz * along);
      mesh.rotation.y = armYaw(arm);
      mesh.material = paintedMaterial(scene, `sign_${p}_arm_${a}_tex`, [arm.names.join(" · ")], 512, 96);
      mesh.isPickable = false;
      meshes.push(mesh);
    }
  }
  // The board: a plane a hair off the sign's face, the book painted on it.
  const boardMesh = MeshBuilder.CreatePlane("sign_board", { width: 1.15, height: 1.9 }, scene);
  boardMesh.position.set(board.x + board.facing.dx * 0.11, groundH(board.x, board.z) + 1.0, board.z + board.facing.dz * 0.11);
  // A plane faces -z by default; turn it to face along `facing`.
  boardMesh.rotation.y = armYaw(board.facing) + Math.PI;
  boardMesh.material = paintedMaterial(scene, "sign_board_tex", board.lines, 512, 850);
  boardMesh.isPickable = false;
  meshes.push(boardMesh);
  return {
    dispose() {
      for (const m of meshes) {
        m.material?.dispose(true, true);
        m.dispose();
      }
      meshes.length = 0;
    },
  };
}
```

- [ ] **Step 6: Wire the app**

`client/src/app.ts`, once the session's world exists (in both `runAsHost` and `runAsClient`, right after `registerInteractables(...)`):

```ts
    signs = createSigns(world);
```

with, near the other helpers:

```ts
  let signs: SignMeshes | null = null;
  /** Junction posts and the trailhead board, from the same seed the sim used. */
  function createSigns(world: World): SignMeshes | null {
    const register = world.register;
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(seed);
    const roadCenterX = variant.roadCenterX;
    if (register === null || graph === undefined || roadCenterX === undefined) return null;
    const sign = propSite(graph, roadCenterX, seed, PROPS[1] as RoadProp);
    // The face toward the pad: the sign stands SIGN_ROAD_Z along the road from the trailhead.
    const facing = { dx: 0, dz: sign.z > graph.trailhead.z ? -1 : 1 };
    return createSignMeshes(
      renderer.scene,
      signPosts(graph, register.hikers.map((h) => h.site)),
      { x: sign.x, z: sign.z, facing, lines: ["TRAILHEAD REGISTER", ...register.hikers.map((h) => `${h.name} — ${h.site.name}`)] },
      (x, z) => elevationAt(seed, x, z),
    );
  }
```

`dispose()`: `signs?.dispose();`.

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx vitest run --root client test/game && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/entityViews.ts client/src/game/renderer.ts client/src/game/signMeshes.ts client/src/app.ts client/test/game/entityViews.test.ts client/test/game/signMeshes.test.ts
git commit -m "feat: draw the hikers' items, the carried bundle and the painted sign arms"
```

---

### Task 9: Three sounds on their own bus

**Files:**
- Modify: `client/src/game/ambientAudio.ts` (objects bus; `objectSound`, `setPen`)
- Modify: `client/src/app.ts` (transitions → sounds)
- Test: `client/test/game/ambientAudio.test.ts`

**Interfaces:**
- Produces: `OBJECTS_LEVEL`, `AmbientAudio.objectSound(kind, x, y, z)`, `AmbientAudio.setPen(on)`.

- [ ] **Step 1: Write the failing test**

`client/test/game/ambientAudio.test.ts` builds a fake `AudioContext` (`fakeCtx()`, recording `created.gains`, `created.sources`, `created.panners`, `created.filters`) and passes it as `createAmbientAudio(() => ctx)`. Its first case asserts the graph built on unlock: change its gain count from 6 to 7 and its comment to "... + wildlife + objects = 7". Then append:

```ts
import { OBJECTS_LEVEL } from "../../src/game/ambientAudio.js";

describe("the objects bus", () => {
  it("mixes a pick-up through its own bus under the master, positioned and filtered", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    const destination = (ctx as unknown as { destination: unknown }).destination;
    const master = created.gains.find((g) => g.connections.includes(destination))!;
    const objects = created.gains.find((g) => g.gain.value === OBJECTS_LEVEL)!;
    expect(objects.connections).toContain(master);
    const before = { gains: created.gains.length, sources: created.sources.length, panners: created.panners.length, filters: created.filters };
    expect(audio.objectSound("pickup", 1, 2, 3)).toBe(true);
    expect(created.sources.length).toBe(before.sources + 1);
    expect(created.panners.length).toBe(before.panners + 1);
    expect(created.filters).toBe(before.filters + 1);
    // The per-call gain feeds the objects bus, never the wildlife one.
    const g = created.gains[created.gains.length - 1]!;
    expect(created.gains.length).toBe(before.gains + 1);
    expect(g.connections).toContain(objects);
    const panner = created.panners[created.panners.length - 1]!;
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([1, 2, 3]);
    audio.dispose();
  });

  it("does nothing before unlock", () => {
    const { ctx } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    expect(audio.objectSound("putdown", 0, 0, 0)).toBe(false);
    expect(() => audio.setPen(true)).not.toThrow();
  });

  it("starts the pen on and stops it off, once each", () => {
    const { ctx, created } = fakeCtx();
    const audio = createAmbientAudio(() => ctx);
    audio.unlock();
    audio.setPen(true);
    audio.setPen(true);
    const loops = created.sources.filter((s) => s.loop);
    expect(loops).toHaveLength(1);
    audio.setPen(false);
    expect(loops[0]!.stopped).toBe(true);
    audio.setPen(false);
    expect(created.sources.filter((s) => s.loop)).toHaveLength(1);
    audio.dispose();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/ambientAudio.test.ts`
Expected: FAIL — `objectSound` is not a function.

- [ ] **Step 3: The bus and the sounds**

`client/src/game/ambientAudio.ts`:

```ts
/** The bus for the world's small object sounds: an item picked up or set down, the pen at the box. */
export const OBJECTS_LEVEL = 0.6;
export type ObjectSound = "pickup" | "putdown";
```

Type additions:

```ts
  /**
   * One positioned object sound, synthesized: a short low thud for a
   * put-down, a brighter rustle for a pick-up. Coordinates in Web Audio's
   * right-handed frame, like `emitter`. False before `unlock()`.
   */
  objectSound(kind: ObjectSound, x: number, y: number, z: number): boolean;
  /** The pen's scratch while a sign-out is held: on starts it looping, off stops it. */
  setPen(on: boolean): void;
```

In `unlock()`, after the wildlife bus: `objectsGain = ctx.createGain(); objectsGain.gain.value = OBJECTS_LEVEL; objectsGain.connect(master);`. A noise buffer helper, built once per context:

```ts
  function noise(seconds: number): AudioBuffer {
    const c = ctx as AudioContext;
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
    const data = buffer.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < data.length; i++) {
      // xorshift: deterministic, no Math.random, so two runs sound alike.
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
    return buffer;
  }
```

`objectSound`:

```ts
    objectSound(kind, x, y, z) {
      if (!ctx || !objectsGain) return false;
      const src = ctx.createBufferSource();
      src.buffer = noise(kind === "pickup" ? 0.12 : 0.08);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = kind === "pickup" ? 2400 : 320;
      filter.Q.value = 1.2;
      const panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = 2;
      panner.maxDistance = 40;
      panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
      const g = ctx.createGain();
      g.gain.setValueAtTime(kind === "pickup" ? 0.5 : 0.8, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (kind === "pickup" ? 0.12 : 0.08));
      src.connect(filter); filter.connect(panner); panner.connect(g); g.connect(objectsGain);
      src.start();
      return true;
    },
```

`setPen`:

```ts
    setPen(on) {
      if (!ctx || !objectsGain) return;
      if (on === (pen !== null)) return;
      if (!on) {
        try { pen?.stop(); } catch { /* ended */ }
        pen = null;
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = noise(0.5);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      filter.Q.value = 3;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      src.connect(filter); filter.connect(g); g.connect(objectsGain);
      src.start();
      pen = src;
    },
```

with `let objectsGain: GainNode | null = null; let pen: AudioBufferSourceNode | null = null;` beside the other nodes, both nulled in `dispose()`.

- [ ] **Step 4: Wire the app**

`client/src/app.ts`: keep `let lastCarriers: number[] = [];` and, once per frame in both loops after `renderer.sync` (where `state` is the frame's world state and `self` the local player):

```ts
  /** Item carrier transitions → sounds; the pen while this player's hold runs. */
  function syncRegisterAudio(state: WorldState, self: PlayerState | undefined): void {
    for (const item of state.items) {
      const was = lastCarriers[item.id];
      if (was === undefined) continue;
      if (was === NO_CARRIER && item.carrier !== NO_CARRIER) {
        const p = state.players.get(item.carrier);
        if (p) ambient.objectSound("pickup", p.pos.x, p.pos.y, -p.pos.z);
      } else if (was !== NO_CARRIER && item.carrier === NO_CARRIER && !item.signedOut) {
        ambient.objectSound("putdown", item.pos.x, item.pos.y, -item.pos.z);
      }
    }
    lastCarriers = state.items.map((it) => it.carrier);
    ambient.setPen(self !== undefined && self.signOutTicks > 0);
  }
```

(Web Audio's frame is right-handed: `-z`, as `wildlifeAudio.ts` mirrors it.)

- [ ] **Step 5: Run the tests, types and lint**

Run: `npx vitest run --root client test/game/ambientAudio.test.ts && npx tsc -p client --noEmit && npx eslint .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/ambientAudio.ts client/src/app.ts client/test/game/ambientAudio.test.ts
git commit -m "feat: an objects bus with the pick-up, the put-down and the pen"
```

---

### Task 10: Record what shipped

**Files:**
- Modify: `docs/gameplay/2026-09-08-register-and-hollow.md` (§17: B built), `docs/gameplay/2026-09-15-register-and-count.md` (Status line)
- Modify: `ARCHITECTURE.md` (a paragraph on the register under the sim/net layering)

- [ ] **Step 1: Docs**

- Parent §17, B's row: status "built <date>" once the branch merges; leave the containment note as is.
- The spec's `**Status:**` line: "Built <date>." plus any number that moved in execution, stated as a fact.
- `ARCHITECTURE.md`: under the determinism/networking section, three sentences: the register's sites and names are derived from the seed on every peer; items, carry state and the outcome are host state in every snapshot (protocol 3); the wall at the road runs inside the movement step so it predicts exactly.

- [ ] **Step 2: The gates and the check in the game**

Run: `npm run typecheck && npm run lint && npm test` from the repository root (the full suite; the two new sweeps add about three minutes). Then, on a local stack with two pages:

1. Both pages in one party; the host presses Play. Both see two to four items on the trail and a sign post at every fork; the trailhead board lists the book.
2. Page A walks to a site, is prompted "Pick up <name>", presses; the bundle appears low in A's view and against A's capsule on B. B's register panel (press at the box with empty hands) reads that hiker as "carried".
3. A returns, is prompted "Sign out <name> — hold", holds: the ring fills over five seconds; releasing at three empties it; a full hold signs the hiker out and the panel strikes them through.
4. B picks up a hiker, drops it with a press at nothing (the bundle lands at B's feet), A picks that one up and signs it out.
5. A walks at the road: stops short of the pavement, sees the line; after the last sign-out the line reads "Get to the car."; with every living player at the car the screen fades to "You signed them out." and returns to the landing.
6. Close B's tab mid-carry: B's item drops where B stood (A sees it) once the host removes B.

- [ ] **Step 3: Commit**

```bash
git add docs/gameplay/2026-09-08-register-and-hollow.md docs/gameplay/2026-09-15-register-and-count.md ARCHITECTURE.md
git commit -m "docs: record the register and the count as built"
```

## Self-review notes

- **Spec coverage.** §1 decisions 1–2 → Task 2 (`buildRegister`, the two-site floor); 3, 5 → the book never grows (no code adds names; Task 7's panel lists `register.hikers` only); 4 → Task 3 drops on death, Task 10's boundary; 6 → Task 6 and Task 8; 7 → Task 3 (`stepRegister`); 8–10 → Task 3 (`pickUp`, `putDown`, the death drop); 11 → Task 3 (`updateOutcome`); 12 → Task 4; 13 → Tasks 1 and 5; 14 → `pickedUp` set once (Task 3) and `retrievedCount`. §2.3 items on the bed → Task 2's sweep. §3.6 wire sizes → Task 1's 769-byte assertion. §4 prompt, panel, road line, win, sounds, no new lights → Tasks 7–9. §5 tests → each task's test file; the in-game check → Task 10.
- **Type consistency.** `ItemState.carrier` is an entity id with `NO_CARRIER = 0`; `PlayerState.carrying` is an item id with `NO_ITEM = 255`; the snapshot carries both as written. `InteractKind` lives in `sim/register.ts` and is imported by `game/interactPrompt.ts`, which stays legal (game may import sim). `Register.box`/`car` are `Vec3` with the ground folded in; `RegisterInput.box`/`car` are `{ x, z }`.
- **Death drop timing.** `putDown` runs in `updateRespawns` when `health <= 0` is first seen, before the respawn timer starts, so the drop position is the death position; `stepRegister` afterwards zeroes a dead player's hold.
- **Sync order on the host.** `stepRegister` (and its `syncItemInteractables`) runs inside `tickWorld`, before `hostSession` applies the tick's press edges, so an item dropped this tick is reachable from the next tick — Task 3's host test spends one tick on that.
- **Clients.** The predicted world never runs `stepRegister` (non-authoritative); its items, carry fields and interactables come from snapshots (Tasks 1 and 5).
- **Level id.** Pass 9 and `GEN_VERSION` 5 both move the level id, so a client on the old build is refused in words; a test pinning a level id string will need its expectation updated in Task 4 or 6.
