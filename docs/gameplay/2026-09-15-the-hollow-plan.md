# The Hollow Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The threat, end to end: one Hollow crawling down the stem from tick 0, the hunt on pick-up, one Hollow per hunted player with splits and merges, contact that kills for good, the stare that slows it and darkens the screen to death, the loss, and the placeholder silhouette.

**Architecture:** A Hollow is an `EnemyState` with three new `AiState` values, so the snapshot's enemy channel, cloning, the fingerprint and the enemy view carry it unchanged; every rule lives in `client/src/sim/hollow.ts` and the graph walk in `client/src/sim/trailRoute.ts`, both host-only inside `tickWorld`'s authoritative branch. The stare is one new byte per player on the wire (protocol 4). `game/` grows a black fog-free capsule, a stare term in the grade record, and two passages on the existing fade.

**Tech Stack:** TypeScript strict, Vitest 4 (node, no DOM tests), Babylon.js 9 (`MeshBuilder`, `PBRMaterial`, NullEngine in tests).

**Spec:** `docs/gameplay/2026-09-15-the-hollow.md` (parent: `docs/gameplay/2026-09-08-register-and-hollow.md` §6, §7, §12).

## Global Constraints

- `client/src/sim/` imports nothing outside itself; `client/src/net/` never imports `client/src/game/` (`client/test/architecture.test.ts` enforces both). The architecture test allow-lists every `Math.sin/cos/atan2/…` call in `sim/` by call text; this plan adds exactly one, `hollow.ts Math.atan2(`, with the argument the test's comment demands: it sets a Hollow's facing inside the authoritative branch, so it is never replayed on a client and cannot diverge two peers. Every other Hollow computation uses `Math.sqrt`, products and sums.
- Numbers from the spec, verbatim: `HOLLOW_CRAWL_SPEED` 0.8, `HOLLOW_HUNT_SPEED` 6.0, `HOLLOW_LOOK_FACTOR` 0.35, `HOLLOW_LOOK_COS` 0.9397 (20°), `HOLLOW_LOOK_RANGE` 120, `HOLLOW_STARE_FILL_S` 6, `HOLLOW_STARE_EMPTY_S` 3, `HOLLOW_CONTACT_MARGIN` 0.1, `HOLLOW_MERGE_RADIUS` 1, `HOLLOW_WAYPOINT_RADIUS` 1.5, `HOLLOW_APPROACH_RANGE` 25, `HOLLOW_LOST_SIGHT_S` 3, `HOLLOW_HEIGHT` 2.6, `LOSS_LANDING_MS` 8000, `PROTOCOL_VERSION` 3 → 4, players +1 byte (`stare`), `STARE_VIGNETTE` 3 (this plan's own, the extra vignette weight at a full stare).
- Existing constants this plan reads: `WALK_SPEED` 5.25, `SPRINT_SPEED` 7, `ENEMY_HALF` {0.4, 0.9, 0.4}, `PLAYER_HALF`, `PLAYER_EYE_OFFSET` 0.7, `ENEMY_MAX_HEALTH` 40, `EPSILON` 1e-6, `SIM_TICK_HZ` 60, `TICK_DT`. `ai.ts`'s `STUCK_SECONDS` 1.5, `UNSTICK_SECONDS` 0.7 and `STUCK_EPSILON` 0.01 become exports and are reused, not copied.
- Two host-only fields the spec did not name, both outside the wire and the fingerprint like `deathPos` and the stuck fields: `EnemyState.seen` (this Hollow was in some living player's view last tick) and `PlayerState.signedOut` (this player signed a hiker out since their hunt began). Both are set in this plan's tasks and documented at their declaration.
- `LOSS_LANDING_MS` is a screen timing, so it lives in `client/src/game/registerHud.ts` beside `WIN_LINE`, not in `sim/`.
- Permanent death holds on EVERY level, the sandbox included: `isDead` is `health <= 0`, `RESPAWN_SECONDS`, `pickRespawn` and the HUD's respawn line go.
- UI renderers use DOM APIs and `textContent` only; every screen is a pure model plus a dumb renderer. No new screen is added here: death and loss reuse `hud.fade` and `hud.setStatus`.
- Run from the repository root: `npx vitest run --root client <path>` for a file, `npx tsc -p client --noEmit` for types, `npx eslint .` for lint. Forest-building tests (`createForest`) cost about half a second per seed: keep sweeps in their own files with a 300 s timeout.
- Commit messages follow `.agents/skills/github-push/SKILL.md` (What/How), and never name anything private about how the work was done.

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/types.ts` | `AiState.Crawl/Hunt/Merge`, `Outcome.Lost`, `PlayerState.stare`/`signedOut`, `EnemyState` route fields |
| `client/src/sim/trailRoute.ts` | `stemNodes`, `route`: the stem as a node chain and memoised shortest paths |
| `client/src/sim/hollow.ts` | Constants, `spawnHollow`, `isHollowState`, `stepHollows` (crawl, hunt, merge, approach, stuck), `updateHollows` (contact, stare, releases, binding, merges, loss) |
| `client/src/sim/ai.ts` | Exports its stuck constants |
| `client/src/sim/world.ts` | `World.trail`; the first Hollow on a forest world; `updateDeaths`; the tick's Hollow branch; clone/serialize |
| `client/src/sim/register.ts` | `signOut` marks the player; `dead()` reads health only |
| `client/src/sim/director.ts` | `spawnEnemy` fills the new fields |
| `client/src/sim/constants.ts` | `RESPAWN_SECONDS` removed |
| `client/src/net/protocol.ts` | Protocol 4: `stare` |
| `client/src/net/hostSession.ts`, `clientSession.ts` | `stare` in the snapshot, reconciled and rendered |
| `client/src/game/entityViews.ts` | The Hollow's black fog-free capsule |
| `client/src/game/gradeParams.ts`, `post.ts`, `renderer.ts` | The stare in the grade |
| `client/src/game/registerHud.ts` | `DEATH_LINE`, `LOSS_LINE`, `LOSS_LANDING_MS` |
| `client/src/game/hud.ts`, `app.ts` | Respawn line removed; the death fade; the loss return |
| `client/test/architecture.test.ts` | The one new allow-listed call |
| `client/test/sim/trailRoute.test.ts`, `hollow.test.ts`, `hollowWalk.test.ts`, `respawn.test.ts` → `death.test.ts` | New and rewritten sim tests |

---

### Task 1: State and wire

**Files:**
- Modify: `client/src/sim/types.ts`
- Modify: `client/src/sim/world.ts` (`World`, `createWorld`, `createForestWorld`, `spawnPlayer`, `cloneWorldState`, `serializeWorldState`)
- Modify: `client/src/sim/director.ts` (`spawnEnemy`)
- Modify: `client/src/net/protocol.ts`, `client/src/net/hostSession.ts`, `client/src/net/clientSession.ts`
- Test: `client/test/sim/world.test.ts`, `client/test/net/protocol.test.ts`, `client/test/net/wireRange.test.ts`, `client/test/game/entityViews.test.ts`

**Interfaces:**
- Produces: `AiState.Crawl = 4`, `Hunt = 5`, `Merge = 6`; `Outcome.Lost = 2`; `PlayerState.stare: number`, `PlayerState.signedOut: boolean`; `EnemyState.route: number[]`, `routeAt: number`, `stemDir: number`, `approach: boolean`, `seen: boolean`; `World.trail: TrailGraph | null`; `SnapshotPlayer.stare`; `PROTOCOL_VERSION = 4`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/world.test.ts`:

```ts
describe("the stare and the graph", () => {
  it("starts with an empty stare and no sign-out, and fingerprints the stare", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    expect(p.stare).toBe(0);
    expect(p.signedOut).toBe(false);
    expect(w.trail).toBeNull();
    const before = serializeWorldState(w.state);
    p.stare = 0.5;
    expect(serializeWorldState(w.state)).not.toBe(before);
    expect(serializeWorldState(w.state)).toContain(",0.5");
  });

  it("clones a Hollow's route as its own array", () => {
    const w = createWorld(level, 1);
    w.state.enemies.set(9, {
      id: 9, pos: { x: 1, y: 2, z: 3 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: 40, ai: AiState.Crawl,
      targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
      route: [0, 1, 2], routeAt: 1, stemDir: -1, approach: false, seen: false,
    });
    const copy = cloneWorldState(w.state);
    copy.enemies.get(9)!.route.push(3);
    expect(w.state.enemies.get(9)!.route).toEqual([0, 1, 2]);
  });
});
```

Add `AiState` to the `types.js` import at the top of the file: `import { AiState, NO_ITEM, Outcome, type InputCommand, type ItemState } from "../../src/sim/types.js";`.

In `client/test/net/protocol.test.ts`, `sampleSnapshot()`: add `stare: i / 4,` after `signOutTicks: i === 2 ? 173 : 0,`. In the round-trip loop, after the `signOutTicks` assertion add:

```ts
      expect(Math.abs(actual.stare - expected.stare)).toBeLessThanOrEqual(0.5 / 255);
```

Change the budget test to:

```ts
  it("stays within the bandwidth budget", () => {
    // 774 bytes at 20 Hz is about 15 KB/s down per client, and 60 KB/s up for
    // a host serving four of them. That is protocol 3's 769 plus one byte per
    // player, the stare.
    expect(encodeSnapshot(sampleSnapshot()).byteLength).toBe(774);
  });
```

In `client/test/net/wireRange.test.ts`, the player literal in `throughTheWire` gains `stare: 0,` after `signOutTicks: 0,`. In `client/test/game/entityViews.test.ts`, every `PlayerState` literal (each has a `signOutTicks: 0,` line) gains `stare: 0, signedOut: false,` on the next line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/world.test.ts test/net/protocol.test.ts`
Expected: FAIL — `stare` undefined, byte length 769.

- [ ] **Step 3: The types**

In `client/src/sim/types.ts`:

```ts
export const enum AiState {
  Idle = 0,
  Chase = 1,
  Attack = 2,
  Dead = 3,
  /** The Hollow (hollow.ts), free: walking the stem, pad to crest to pad. */
  Crawl = 4,
  /** The Hollow bound to `targetId`, a player, and walking at them. */
  Hunt = 5,
  /** The Hollow released but not the last: walking to `targetId`, another Hollow, to be absorbed. */
  Merge = 6,
}
```

```ts
export const enum Outcome {
  Playing = 0,
  Won = 1,
  /** Every player dead. */
  Lost = 2,
}
```

In `PlayerState`, after `signOutTicks`:

```ts
  /**
   * The stare, 0 to 1: fills while a Hollow is in this player's view, empties
   * when it is not, and kills at 1 (hollow.ts). Host truth; rides the snapshot
   * as one byte so the screen's darkening and the death agree on every peer.
   */
  stare: number;
  /**
   * Set by the register on this player's sign-out, cleared when a hunt binds
   * to them: a hunt ends on the hunted player's own sign-out. Host-only, never
   * on the wire, outside the fingerprint.
   */
  signedOut: boolean;
```

Rewrite the `deathPos` comment:

```ts
  /**
   * Where this player fell. Set once, on the tick health reaches 0, and never
   * cleared: death is permanent, and `updateDeaths` uses it to know the drop
   * has been done.
   *
   * Host-only. The snapshot carries id, pos, vel, yaw, pitch, health,
   * respawnTimer and lamp, so this never reaches the wire and the codec is
   * untouched.
   */
  deathPos: Vec3 | null;
```

Rewrite the `respawnTimer` comment to: `/** Always 0 since death became permanent; kept so the snapshot's byte layout stands. */`.

In `EnemyState`, after `unstickTimer`:

```ts
  /**
   * The Hollow's walk (hollow.ts): the node route it is following, the index
   * of the next node, the stem direction of its crawl (+1 toward the crest,
   * -1 toward the pad), whether it has left the graph for its target, and
   * whether a living player had it in view last tick (which slows it).
   *
   * Host-only, like the stuck fields above: absent from the snapshot and the
   * fingerprint. Unused (empty, 0, -1, false, false) on a sandbox chaser.
   */
  route: number[];
  routeAt: number;
  stemDir: number;
  approach: boolean;
  seen: boolean;
```

- [ ] **Step 4: The world**

In `client/src/sim/world.ts` add `import type { TrailGraph } from "./trail.js";` and, in `World` after `register`:

```ts
  /**
   * The trail network for a forest world (`trail.ts`): the Hollow's map and
   * what `app.ts` paints signs from. Null for a hand-authored level.
   */
  trail: TrailGraph | null;
```

`createWorld` sets `trail: null,` after `register: null,`. In `createForestWorld`, hoist the graph above the literal and set it:

```ts
export function createForestWorld(forest: Forest, authoritative = true): World {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(forest.seed);
  const world: World = {
    level: { id: forest.levelId, brushes: [], playerSpawns: [], enemySpawns: [] },
    boxes: forest.grid,
    ground: createGroundField(forest.seed),
    forest,
    authoritative,
    maxEnemies: 0,
    waterLevel: variant.waterLevel ?? null,
    interactables: new Map(),
    register: null,
    trail: graph ?? null,
    state: { /* unchanged */ },
  };
  // The register stands where the trailhead pass put its post and its car,
  // and the book comes from the same seed on every peer.
  const roadCenterX = variant.roadCenterX;
  if (graph !== undefined && roadCenterX !== undefined) {
    /* unchanged */
  }
  return world;
}
```

(Delete the old `const graph = …` line inside the `if`.) `spawnPlayer`'s literal gains `stare: 0,` and `signedOut: false,` after `signOutTicks: 0,`. In `cloneWorldState` the enemy copy becomes:

```ts
    enemies.set(id, { ...e, pos: cloneVec3(e.pos), vel: cloneVec3(e.vel), route: [...e.route] });
```

In `serializeWorldState` the player line ends `…,${p.carrying},${p.signOutTicks},${p.stare}`.

In `client/src/sim/director.ts`, `spawnEnemy`'s literal gains, after `unstickTimer: 0,`: `route: [], routeAt: 0, stemDir: -1, approach: false, seen: false,`.

- [ ] **Step 5: The wire**

In `client/src/net/protocol.ts`: `PROTOCOL_VERSION = 4`; `SnapshotPlayer` gains

```ts
  /** The stare, 0 to 1, as one byte. */
  stare: number;
```

`PLAYER_BYTES = 31`. In `encodeSnapshot`, after the `signOutTicks` write:

```ts
    view.setUint8(o, clamp(Math.round(p.stare * 255), 0, 255));
    o += 1;
```

In `decodeSnapshot`, after `signOutTicks`:

```ts
    const stare = view.getUint8(o) / 255;
    o += 1;
```

and `stare,` in the pushed object. `hostSession.ts` `buildSnapshot`: `stare: p.stare,` after `signOutTicks`. `clientSession.ts`: in `reconcile`, `local.stare = authoritative.stare;` after `local.signOutTicks = …`; in `renderState`, the player entry gains `stare: p.stare,` and `signedOut: false,` (a client never reads it), and the enemy entry gains `route: [], routeAt: 0, stemDir: -1, approach: false, seen: false,`.

- [ ] **Step 6: Run the tests and the types**

Run: `npx tsc -p client --noEmit && npx vitest run --root client test/sim test/net test/game/entityViews.test.ts`
Expected: PASS. `tsc` names every remaining literal that lacks the new fields; fix each by adding them.

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/types.ts client/src/sim/world.ts client/src/sim/director.ts client/src/net/protocol.ts client/src/net/hostSession.ts client/src/net/clientSession.ts client/test/sim/world.test.ts client/test/net/protocol.test.ts client/test/net/wireRange.test.ts client/test/game/entityViews.test.ts
git commit -m "feat: the Hollow's state and the stare on the wire (protocol 4)"
```

(Write the full What/How body per the github-push skill; the one-line form here is the subject.)

---

### Task 2: Routes on the trail graph

**Files:**
- Create: `client/src/sim/trailRoute.ts`
- Test: `client/test/sim/trailRoute.test.ts`

**Interfaces:**
- Consumes: `TrailGraph` (`nodes`, `edges`, `stem`) from `trail.ts`.
- Produces: `stemNodes(graph): number[]` (pad first, crest last); `route(graph, from, to): readonly number[]` (both ends inclusive, `[from]` when equal, empty when unreachable, memoised per graph).

- [ ] **Step 1: Write the failing tests**

`client/test/sim/trailRoute.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { route, stemNodes } from "../../src/sim/trailRoute.js";
import { graph } from "./helpers/registerGraph.js";
import type { TrailEdge, TrailGraph } from "../../src/sim/trail.js";

/** A diamond: 0 → 1 → 3 and 0 → 2 → 3 are exactly the same length. */
function diamond(): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 10, z: 10, h: 0, u: 0 }, { x: 10, z: -10, h: 0, u: 0 }, { x: 20, z: 0, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number): TrailEdge =>
    ({ a, b, kind: "loop", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
  return {
    nodes, edges: [edge(0, 1), edge(1, 3), edge(0, 2), edge(2, 3)], trailhead: { x: 0, z: 0, u: 0 }, summit: 3,
    stem: [0, 1], loops: [], features: [], stemLen: 28.28, fallbacks: 0,
  };
}

describe("stemNodes", () => {
  it("reads the stem as a node chain, pad first, crest last", () => {
    expect(stemNodes(graph(2))).toEqual([0, 1, 2]);
  });
});

describe("route", () => {
  it("walks the stem from the pad to the crest and back", () => {
    expect(route(graph(1), 0, 2)).toEqual([0, 1, 2]);
    expect(route(graph(1), 2, 0)).toEqual([2, 1, 0]);
  });

  it("takes the loop when it is shorter than going round by the stem", () => {
    // 3 → 4 → 2 is 60 + 53.9 m; 3 → 1 → 2 would be 53.9 + 100 m.
    expect(route(graph(1), 3, 2)).toEqual([3, 4, 2]);
  });

  it("breaks an exact tie toward the lower node index", () => {
    expect(route(diamond(), 0, 3)).toEqual([0, 1, 3]);
  });

  it("is a single node from a node to itself, and empty when unreachable", () => {
    expect(route(graph(0), 1, 1)).toEqual([1]);
    const g = graph(0);
    g.nodes.push({ x: 999, z: 999, h: 0, u: 0 });
    expect(route(g, 0, 7)).toEqual([]);
  });

  it("memoises per graph, so the same question returns the same array", () => {
    const g = graph(1);
    expect(route(g, 0, 2)).toBe(route(g, 0, 2));
    expect(route(g, 0, 2)).not.toBe(route(graph(1), 0, 2));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/sim/trailRoute.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`client/src/sim/trailRoute.ts`:

```ts
/**
 * Routes on the trail graph, for the Hollow (hollow.ts): the stem as a node
 * chain, and the shortest node path between any two nodes. The graph never
 * changes for a world, so paths are memoised per graph.
 *
 * sim/ determinism rules: no trig, no Math.pow; `Math.sqrt` for lengths.
 */
import type { TrailEdge, TrailGraph, TrailNode } from "./trail.js";

/** The stem as nodes, pad first (node 0), crest last. */
export function stemNodes(graph: TrailGraph): number[] {
  const chain: number[] = [0];
  let at = 0;
  for (const ei of graph.stem) {
    const e = graph.edges[ei] as TrailEdge;
    at = e.a === at ? e.b : e.a;
    chain.push(at);
  }
  return chain;
}

function edgeLength(graph: TrailGraph, e: TrailEdge): number {
  const a = graph.nodes[e.a] as TrailNode;
  const b = graph.nodes[e.b] as TrailNode;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

const memo = new WeakMap<TrailGraph, Map<number, readonly number[]>>();

/**
 * The shortest node path from `from` to `to`, both inclusive: `[from]` when
 * they are the same node, `[]` when `to` cannot be reached. Dijkstra over
 * edge lengths; among equal distances the lower node index is settled first
 * and a later equal path never replaces an earlier one, so ties resolve
 * toward the lower index on every machine.
 */
export function route(graph: TrailGraph, from: number, to: number): readonly number[] {
  let table = memo.get(graph);
  if (table === undefined) {
    table = new Map();
    memo.set(graph, table);
  }
  const key = from * 65536 + to;
  const hit = table.get(key);
  if (hit !== undefined) return hit;

  const n = graph.nodes.length;
  const dist: number[] = new Array<number>(n).fill(Infinity);
  const prev: number[] = new Array<number>(n).fill(-1);
  const done: boolean[] = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (let round = 0; round < n; round++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || (dist[i] as number) === Infinity) continue;
      if (u === -1 || (dist[i] as number) < (dist[u] as number)) u = i;
    }
    if (u === -1 || u === to) break;
    done[u] = true;
    for (const e of graph.edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v === -1 || done[v]) continue;
      const d = (dist[u] as number) + edgeLength(graph, e);
      if (d < (dist[v] as number)) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }

  const path: number[] = [];
  if ((dist[to] as number) < Infinity) {
    for (let at = to; at !== -1; at = prev[at] as number) path.push(at);
    path.reverse();
  }
  const out: readonly number[] = Object.freeze(path);
  table.set(key, out);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root client test/sim/trailRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/trailRoute.ts client/test/sim/trailRoute.test.ts
git commit -m "feat: routes on the trail graph"
```

---

### Task 3: Death is permanent

**Files:**
- Modify: `client/src/sim/world.ts` (`isDead`, `updateRespawns` → `updateDeaths`, remove `pickRespawn`), `client/src/sim/register.ts` (`dead`), `client/src/sim/constants.ts` (`RESPAWN_SECONDS`), `client/src/game/hud.ts`, `client/src/app.ts`
- Test: rename `client/test/sim/respawn.test.ts` → `client/test/sim/death.test.ts`; modify `client/test/sim/registerRules.test.ts`

**Interfaces:**
- Produces: `isDead(p)` is `p.health <= 0`; a dead player's `deathPos` is set once and kept; nothing ever restores health.

- [ ] **Step 1: Rewrite the test**

`git mv client/test/sim/respawn.test.ts client/test/sim/death.test.ts`, then replace its contents with:

```ts
import { describe, it, expect } from "vitest";
import { createForestWorld, createWorld, spawnPlayer, tickWorld, isDead } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { depenetrate } from "../../src/sim/collision.js";
import { parseLevel } from "../../src/sim/level.js";
import { ENEMY_POPULATION_CAP, PLAYER_HALF } from "../../src/sim/constants.js";
import { AiState, type InputCommand } from "../../src/sim/types.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };

const level = parseLevel(sandbox01);

function input(over: Partial<InputCommand> = {}): InputCommand {
  return { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over };
}

describe("death is permanent", () => {
  it("marks where they fell on the tick health reaches zero, and starts no timer", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    p.health = 0;
    tickWorld(w, new Map());
    expect(isDead(p)).toBe(true);
    expect(p.respawnTimer).toBe(0);
    expect(p.deathPos).toEqual(p.pos);
  });

  it("ignores movement input while dead", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map()); // land first
    p.health = 0;
    tickWorld(w, new Map());

    const at = { ...p.pos };
    for (let i = 0; i < 30; i++) tickWorld(w, new Map([[p.id, input({ moveZ: 1 })]]));
    expect(p.pos.x).toBeCloseTo(at.x, 6);
    expect(p.pos.y).toBeCloseTo(at.y, 6);
    expect(p.pos.z).toBeCloseTo(at.z, 6);
  });

  it("still tracks view angles while dead, so the camera does not freeze", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    p.health = 0;
    tickWorld(w, new Map());
    tickWorld(w, new Map([[p.id, input({ yaw: 1.25, pitch: -0.5 })]]));
    expect(p.yaw).toBeCloseTo(1.25, 6);
    expect(p.pitch).toBeCloseTo(-0.5, 6);
  });

  it("never comes back: a minute later they are still dead where they fell", () => {
    const w = createWorld(level, 1);
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map());
    p.pos = { x: 20, y: 0.9, z: -20 };
    p.health = 0;
    for (let i = 0; i < 3600; i++) tickWorld(w, new Map([[p.id, input({ moveZ: 1 })]]));
    expect(p.health).toBe(0);
    expect(isDead(p)).toBe(true);
    expect(p.pos.x).toBeCloseTo(20, 6);
    expect(p.pos.z).toBeCloseTo(-20, 6);
    expect(p.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.deathPos).toEqual({ x: 20, y: 0.9, z: -20 });
  });

  it("holds in a non-authoritative world too, so a client cannot predict a return", () => {
    const w = createWorld(level, 1, false);
    const p = spawnPlayer(w);
    p.health = 0;
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(p.deathPos).toBeNull(); // the drop and the mark are the host's
  });

  it("does not simulate enemies in a non-authoritative world", () => {
    const w = createWorld(level, 1, false);
    spawnPlayer(w);
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(0);
  });
});

describe("death in a generated forest", () => {
  it("keeps the fallen where they fell, on valid ground they were already on", () => {
    const w = createForestWorld(createForest(0xdead));
    const p = spawnPlayer(w);
    for (let i = 0; i < 240; i++) tickWorld(w, new Map());
    const diedAt = { ...p.pos };
    p.health = 0;
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(p.pos).toEqual(diedAt);
    expect(p.deathPos).toEqual(diedAt);
  });

  it("spawns a joining player on valid ground", () => {
    const w = createForestWorld(createForest(0xc0ffee));
    const p = spawnPlayer(w);
    const fixed = depenetrate(p.pos, PLAYER_HALF, w.boxes);
    expect(Math.abs(fixed.y - p.pos.y)).toBeLessThan(1e-9);
  });
});

/**
 * Generated worlds ship with `maxEnemies` at 0 and the director switched off.
 * This raises the ceiling explicitly to prove that what holds a generated
 * world's population is `targetPopulation`, not the ceiling.
 */
describe("the director in a generated forest", () => {
  it("spawns nothing even with the ceiling raised, while the director is off", () => {
    const w = createForestWorld(createForest(0x5eed1));
    w.maxEnemies = ENEMY_POPULATION_CAP;
    spawnPlayer(w);
    for (let i = 0; i < 600; i++) tickWorld(w, new Map());
    expect([...w.state.enemies.values()].filter((e) => e.ai === AiState.Chase || e.ai === AiState.Idle)).toEqual([]);
  });
});
```

In `client/test/sim/registerRules.test.ts`: drop `RESPAWN_SECONDS` from the constants import and change line 94 to `expect(p.respawnTimer).toBe(0);` with the test's name changed to `"drops the item where the player dies, and they stay dead"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/death.test.ts test/sim/registerRules.test.ts`
Expected: FAIL — the timer starts, the player respawns.

- [ ] **Step 3: The sim**

In `client/src/sim/world.ts`:

```ts
export function isDead(player: PlayerState): boolean {
  return player.health <= 0;
}

/**
 * Host-only, and deliberately so: a client that predicted its own death and
 * had it revoked by the next snapshot would be far worse than a 100 ms delay
 * before the screen changes, so this never runs during reconciliation replay.
 *
 * Death is permanent. On the tick a player's health first reads 0 what they
 * carried drops where they stand (the register's rule) and the spot is
 * recorded; `deathPos` staying set is what stops this running twice, and
 * nothing anywhere restores health.
 */
function updateDeaths(world: World): void {
  for (const player of world.state.players.values()) {
    if (player.health > 0 || player.deathPos !== null) continue;
    putDown(world, player);
    player.vel = { x: 0, y: 0, z: 0 };
    player.deathPos = cloneVec3(player.pos);
  }
}
```

Delete `pickRespawn` and `updateRespawns`, call `updateDeaths(world)` where `updateRespawns(world)` was, and drop the now-unused imports (`ringSample`, `groundSpawn` if unused elsewhere in the file — `pickSpawn` uses only `spiralSpawn` — `ENEMY_DETECT_RANGE`, `RESPAWN_SECONDS`). Keep the old comment block above `updateDeaths` in spirit (the one explaining host-only).

In `client/src/sim/register.ts`: `function dead(p: PlayerState): boolean { return p.health <= 0; }` with the comment `/** \`isDead\` without importing world.ts, which imports this module. */` kept.

In `client/src/sim/constants.ts` delete `RESPAWN_SECONDS` and its comment.

- [ ] **Step 4: The HUD**

In `client/src/game/hud.ts`: remove `setRespawn` from the `Hud` type and the object, the `respawn` element (`root.append(fade, status)`), and the `.hud .respawn` rule from `STYLE`. In `client/src/app.ts` delete both `hud.setRespawn(self?.respawnTimer ?? null);` lines.

- [ ] **Step 5: Run the tests, types and lint**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client test/sim test/net`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/sim/world.ts client/src/sim/register.ts client/src/sim/constants.ts client/src/game/hud.ts client/src/app.ts client/test/sim/death.test.ts client/test/sim/registerRules.test.ts
git commit -m "feat: death is permanent"
```

---

### Task 4: The Hollow walks

**Files:**
- Create: `client/src/sim/hollow.ts`
- Modify: `client/src/sim/ai.ts` (export the stuck constants), `client/src/sim/world.ts` (the tick's Hollow branch, the first Hollow), `client/test/architecture.test.ts`
- Test: `client/test/sim/hollow.test.ts` (this task's `describe`s), `client/test/sim/death.test.ts` (the director test)

**Interfaces:**
- Consumes: `route`, `stemNodes` (Task 2); `nearestTrailNode`, `TrailGraph` (`trail.ts`); `stepMovement`; `hasLineOfSight`, `STUCK_SECONDS`, `UNSTICK_SECONDS`, `STUCK_EPSILON` (`ai.ts`).
- Produces: the constants in Global Constraints; `isHollowState(ai: AiState): boolean`; `isHollow(e: EnemyState): boolean`; `spawnHollow(world, at, ai, targetId = 0): EnemyState`; `stepHollows(world, dt)`; `nearestOtherHollow(world, h): EnemyState | null`; `horizontalDistSq(a, b)`; `clearRoute(h)`. Task 5 adds `updateHollows` to the same file.

- [ ] **Step 1: Write the failing tests**

`client/test/sim/hollow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createForestWorld, createWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { createForest } from "../../src/sim/forest.js";
import { parseLevel } from "../../src/sim/level.js";
import { AiState } from "../../src/sim/types.js";
import { ENEMY_HALF, TICK_DT } from "../../src/sim/constants.js";
import { HOLLOW_CRAWL_SPEED, HOLLOW_HUNT_SPEED, HOLLOW_LOOK_FACTOR, HOLLOW_LOST_SIGHT_S, spawnHollow } from "../../src/sim/hollow.js";
import { graph } from "./helpers/registerGraph.js";

type Brush = { min: [number, number, number]; max: [number, number, number]; material: string };
const FLOOR: Brush = { min: [-300, -1, -300], max: [300, 0, 300], material: "concrete" };
const level = (...walls: Brush[]) =>
  parseLevel({ id: "flat", brushes: [FLOOR, ...walls], playerSpawns: [[0, 0.9, 0], [0, 0.9, -5]], enemySpawns: [] });

/** A flat world with the one-loop hand graph as its trail, plus any walls; nothing else in it. */
function world(...walls: Brush[]) {
  const w = createWorld(level(...walls), 1);
  w.trail = graph(1);
  return w;
}
const tick = (w: ReturnType<typeof world>, n: number) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

describe("the crawl", () => {
  it("walks the stem from the crest to the pad, then turns and walks back up", () => {
    const w = world();
    const h = spawnHollow(w, { x: 200, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    const budget = Math.ceil((200 / HOLLOW_CRAWL_SPEED / TICK_DT) * 1.3);
    let t = 0;
    while (t < budget && h.pos.x > 2) { tickWorld(w, new Map()); t++; }
    expect(h.pos.x, `still at x=${h.pos.x} after ${t} ticks`).toBeLessThanOrEqual(2);
    expect(h.stemDir).toBe(-1);
    tick(w, 600);
    expect(h.stemDir).toBe(1);
    expect(h.pos.x).toBeGreaterThan(4);
  });

  it("crawls at the crawl speed", () => {
    const w = world();
    const h = spawnHollow(w, { x: 150, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    tick(w, 120); // settle
    const before = h.pos.x;
    tick(w, 600);
    expect(before - h.pos.x).toBeCloseTo(HOLLOW_CRAWL_SPEED * 10, 0);
  });
});

describe("the hunt", () => {
  it("routes along the graph to the node nearest its target, then walks straight at them", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 }; // nearest node is 3 (120, 50)
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    tickWorld(w, new Map());
    expect(h.route).toEqual([0, 1, 3]);
    expect(h.approach).toBe(false);
    const budget = Math.ceil((260 / HOLLOW_HUNT_SPEED / TICK_DT) * 1.5);
    let t = 0;
    while (t < budget && !h.approach) { tickWorld(w, new Map()); t++; }
    expect(h.approach, `never left the graph in ${t} ticks`).toBe(true);
    while (t < budget && dist(h.pos, p.pos) > 1.5) { tickWorld(w, new Map()); t++; }
    expect(dist(h.pos, p.pos)).toBeLessThanOrEqual(1.5);
  });

  it("re-routes when the target's nearest node changes", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    tickWorld(w, new Map());
    expect(h.route).toEqual([0, 1, 3]);
    p.pos = { x: 200, y: 0.9, z: -40 }; // nearest node is now 2, the crest
    tickWorld(w, new Map());
    expect(h.route[h.route.length - 1]).toBe(2);
  });

  it("gives up a straight approach after losing sight for HOLLOW_LOST_SIGHT_S and re-routes", () => {
    // A wall between them.
    const w = world({ min: [130, 0, 68], max: [170, 4, 70], material: "concrete" });
    const p = spawnPlayer(w);
    p.pos = { x: 150, y: 0.9, z: 80 };
    const h = spawnHollow(w, { x: 150, y: ENEMY_HALF.y, z: 60 }, AiState.Hunt, p.id);
    h.approach = true;
    tick(w, Math.ceil(HOLLOW_LOST_SIGHT_S / TICK_DT) + 2);
    expect(h.approach).toBe(false);
    expect(h.route.length).toBeGreaterThan(0);
  });

  it("moves at the look factor while seen", () => {
    // The player stands 100 m up the z axis, inside the look range. Facing
    // away (yaw 0 is +z) for the free window, then turned round to look at
    // it for the slowed one — so the test holds whether `seen` is set by
    // hand (this task) or recomputed from the view each tick (Task 5).
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 100 };
    p.yaw = 0;
    const a = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    a.approach = true;
    tick(w, 60);
    const free = a.pos.z;
    p.yaw = Math.PI;
    a.seen = true;
    const at = a.pos.z;
    tick(w, 60);
    const slowed = a.pos.z - at;
    expect(slowed / free).toBeCloseTo(HOLLOW_LOOK_FACTOR, 1);
  });
});

describe("the merge walk", () => {
  it("walks to the nearest other Hollow", () => {
    const w = world();
    const target = spawnHollow(w, { x: 100, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    const m = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Merge, target.id);
    const before = dist(m.pos, target.pos);
    tick(w, 120);
    expect(dist(m.pos, target.pos)).toBeLessThan(before - 5);
  });
});

describe("the first Hollow", () => {
  it("stands on the crest of a forest world, crawling, on the host only", () => {
    const forest = createForest(0x5eed);
    const host = createForestWorld(forest);
    const hollows = [...host.state.enemies.values()];
    expect(hollows).toHaveLength(1);
    const h = hollows[0]!;
    expect(h.ai).toBe(AiState.Crawl);
    const crest = host.trail!.nodes[host.trail!.summit]!;
    expect(dist(h.pos, crest)).toBeLessThan(1);
    expect(h.stemDir).toBe(-1);
    expect(createForestWorld(forest, false).state.enemies.size).toBe(0);
  });
});
```

Note for the look-factor test: `free` is the distance covered in the first 60 ticks from z = 0 and `slowed` the next 60 from `at`, so the ratio compares two equal windows; acceleration to speed happens in the first few ticks of each and the 1-decimal tolerance absorbs it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/sim/hollow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Export the stuck constants**

In `client/src/sim/ai.ts`, prefix `STUCK_SECONDS`, `UNSTICK_SECONDS` and `STUCK_EPSILON` with `export` (comments unchanged).

- [ ] **Step 4: Write the module**

`client/src/sim/hollow.ts`:

```ts
/**
 * The Hollow (docs/gameplay/2026-09-15-the-hollow.md): the figure that walks
 * the trail from the first tick. Free, it crawls the stem pad to crest to pad;
 * bound to a player by their pick-up, it hunts them; released while another
 * Hollow exists, it walks to that one and merges. It cannot be killed. Contact
 * kills, and being looked at slows it at the price of the looker's stare.
 *
 * A Hollow is an `EnemyState` whose `ai` is Crawl, Hunt or Merge, so the
 * snapshot's enemy channel carries it as it carries any enemy. Everything
 * here runs inside `tickWorld`'s authoritative branch: host-only, never
 * replayed on a client. That is why `Math.atan2` for the facing is allowed
 * (architecture.test.ts) — an engine difference cannot diverge two peers.
 * The walk itself passes its direction as a world-axis wish through
 * `stepMovement` with yaw 0, so movement needs no trig at all.
 */
import type { EnemyState, Vec3 } from "./types.js";
import { AiState, Button, cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import { nearestTrailNode } from "./trail.js";
import { route, stemNodes } from "./trailRoute.js";
import { stepMovement } from "./movement.js";
import { STUCK_EPSILON, STUCK_SECONDS, UNSTICK_SECONDS, hasLineOfSight } from "./ai.js";
import { ENEMY_HALF, ENEMY_MAX_HEALTH, EPSILON, SPRINT_SPEED, WALK_SPEED } from "./constants.js";

/** Free: the stem pendulum, m/s. A 600 m stem takes about twelve minutes one way. */
export const HOLLOW_CRAWL_SPEED = 0.8;
/** Bound or merging, m/s: above WALK_SPEED 5.25, below SPRINT_SPEED 7. */
export const HOLLOW_HUNT_SPEED = 6;
/** Its speed while a living player has it in view. */
export const HOLLOW_LOOK_FACTOR = 0.35;
/** cos 20°: it must be near the centre of the view, not the edge. */
export const HOLLOW_LOOK_COS = 0.9397;
/** Metres from the eye within which looking counts. */
export const HOLLOW_LOOK_RANGE = 120;
/** Seconds of continuous looking that fill the stare from 0 to 1. */
export const HOLLOW_STARE_FILL_S = 6;
/** Seconds of looking away that empty it from 1 to 0. */
export const HOLLOW_STARE_EMPTY_S = 3;
/** Added to the two half-widths: the hulls need not interpenetrate to touch. */
export const HOLLOW_CONTACT_MARGIN = 0.1;
/** A merging Hollow within this of another is absorbed. */
export const HOLLOW_MERGE_RADIUS = 1;
/** Horizontal metres within which a route node counts as reached. */
export const HOLLOW_WAYPOINT_RADIUS = 1.5;
/** Within this of its target, with line of sight, it leaves the graph. */
export const HOLLOW_APPROACH_RANGE = 25;
/** Off the graph and blind to its target this long, it re-routes. */
export const HOLLOW_LOST_SIGHT_S = 3;
/** The placeholder's height, metres (entityViews.ts). */
export const HOLLOW_HEIGHT = 2.6;

export function isHollowState(ai: AiState): boolean {
  return ai === AiState.Crawl || ai === AiState.Hunt || ai === AiState.Merge;
}

export function isHollow(e: EnemyState): boolean {
  return isHollowState(e.ai);
}

export function spawnHollow(world: World, at: Vec3, ai: AiState, targetId = 0): EnemyState {
  const hollow: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai,
    targetId,
    stateTimer: 0,
    attackCooldown: 0,
    lastDistSq: Infinity,
    stuckTimer: 0,
    unstickTimer: 0,
    route: [],
    routeAt: 0,
    stemDir: -1,
    approach: false,
    seen: false,
  };
  world.state.enemies.set(hollow.id, hollow);
  return hollow;
}

export function horizontalDistSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Every Hollow, in id order (the map inserts in id order and never reorders). */
export function hollowsOf(world: World): EnemyState[] {
  const out: EnemyState[] = [];
  for (const e of world.state.enemies.values()) if (isHollow(e)) out.push(e);
  return out;
}

export function clearRoute(h: EnemyState): void {
  h.route = [];
  h.routeAt = 0;
  h.approach = false;
  h.stateTimer = 0;
  h.lastDistSq = Infinity;
}

/** The nearest Hollow other than `h` by horizontal distance, ties to the lower id; null when alone. */
export function nearestOtherHollow(world: World, h: EnemyState): EnemyState | null {
  let best: EnemyState | null = null;
  let bestSq = Infinity;
  for (const o of hollowsOf(world)) {
    if (o === h) continue;
    const sq = horizontalDistSq(o.pos, h.pos);
    if (sq < bestSq) {
      bestSq = sq;
      best = o;
    }
  }
  return best;
}

function speedOf(h: EnemyState): number {
  const base = h.ai === AiState.Crawl ? HOLLOW_CRAWL_SPEED : HOLLOW_HUNT_SPEED;
  return h.seen ? base * HOLLOW_LOOK_FACTOR : base;
}

/**
 * One movement step toward (tx, tz) at `speed`, through `stepMovement` with
 * the enemy hull, so the Hollow inherits sliding, step-up, ground following
 * and wading. The direction rides as a world-axis wish with yaw 0; `yaw`
 * itself is written only for the view. Above the walk the wish carries the
 * Sprint bit, since a wish longer than 1 is clamped inside `wishDirection`.
 *
 * Stuck handling is `ai.ts`'s: no progress on the squared distance for
 * STUCK_SECONDS starts a sidestep that holds until progress resumes.
 */
function walkToward(h: EnemyState, world: World, dt: number, tx: number, tz: number, speed: number): void {
  const dx = tx - h.pos.x;
  const dz = tz - h.pos.z;
  const distSq = dx * dx + dz * dz;
  const dist = Math.sqrt(distSq);
  if (dist < EPSILON) return;
  h.yaw = Math.atan2(dx, dz);

  if (distSq < h.lastDistSq - STUCK_EPSILON) h.stuckTimer = 0;
  else h.stuckTimer += dt;
  h.lastDistSq = distSq;
  if (h.stuckTimer > STUCK_SECONDS) h.unstickTimer = UNSTICK_SECONDS;

  let ux = dx / dist;
  let uz = dz / dist;
  if (h.unstickTimer > 0) {
    h.unstickTimer = Math.max(0, h.unstickTimer - dt);
    // A quarter turn, odd and even ids opposite ways, as the chaser does.
    const side = (h.id & 1) === 0 ? 1 : -1;
    const sx = side * uz;
    const sz = -side * ux;
    ux = sx;
    uz = sz;
  }

  const top = speed > WALK_SPEED ? SPRINT_SPEED : WALK_SPEED;
  const wish = speed / top;
  const result = stepMovement(
    { pos: h.pos, vel: h.vel, grounded: true },
    { seq: 0, moveX: ux * wish, moveZ: uz * wish, yaw: 0, pitch: 0, buttons: top === SPRINT_SPEED ? Button.Sprint : 0 },
    dt,
    world.boxes,
    ENEMY_HALF,
    world.waterLevel,
    world.ground,
  );
  h.pos = result.pos;
  h.vel = result.vel;
}

/** Walks the current route; true once every node has been reached. */
function followRoute(h: EnemyState, world: World, graph: TrailGraph, dt: number, speed: number): boolean {
  while (h.routeAt < h.route.length) {
    const node = graph.nodes[h.route[h.routeAt] as number] as TrailNode;
    if (horizontalDistSq(h.pos, node) <= HOLLOW_WAYPOINT_RADIUS * HOLLOW_WAYPOINT_RADIUS) {
      h.routeAt++;
      h.lastDistSq = Infinity;
      continue;
    }
    walkToward(h, world, dt, node.x, node.z, speed);
    return false;
  }
  return true;
}

/** The stem node nearest `h`, as an index into the chain. */
function nearestStemIndex(h: EnemyState, graph: TrailGraph, chain: number[]): number {
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < chain.length; i++) {
    const n = graph.nodes[chain[i] as number] as TrailNode;
    const sq = horizontalDistSq(h.pos, n);
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return best;
}

/** The pendulum: at either end of the stem the direction flips and the chain is walked back. */
function crawl(h: EnemyState, world: World, graph: TrailGraph, dt: number): void {
  if (h.routeAt >= h.route.length) {
    const chain = stemNodes(graph);
    // A finished route means an end was reached: turn. An empty one is a
    // fresh start (birth, or a release), which keeps its direction.
    if (h.route.length > 0) h.stemDir = -h.stemDir;
    const k = nearestStemIndex(h, graph, chain);
    h.route = h.stemDir > 0 ? chain.slice(k) : chain.slice(0, k + 1).reverse();
    h.routeAt = 0;
    h.lastDistSq = Infinity;
  }
  followRoute(h, world, graph, dt, speedOf(h));
}

/**
 * Hunt and Merge share this: the graph to the node nearest the target, then
 * straight at it. Off the graph, losing sight of the target for
 * HOLLOW_LOST_SIGHT_S drops the approach and re-routes from wherever it is.
 */
function pursue(h: EnemyState, world: World, graph: TrailGraph, dt: number, target: Vec3): void {
  const speed = speedOf(h);
  if (!h.approach) {
    const targetNode = nearestTrailNode(graph, target.x, target.z);
    if (h.routeAt >= h.route.length || h.route[h.route.length - 1] !== targetNode) {
      h.route = [...route(graph, nearestTrailNode(graph, h.pos.x, h.pos.z), targetNode)];
      h.routeAt = 0;
      h.lastDistSq = Infinity;
    }
    const near =
      horizontalDistSq(h.pos, target) <= HOLLOW_APPROACH_RANGE * HOLLOW_APPROACH_RANGE &&
      hasLineOfSight(h.pos, target, world.boxes, world.ground);
    if (near || followRoute(h, world, graph, dt, speed)) {
      h.approach = true;
      h.stateTimer = 0;
      h.lastDistSq = Infinity;
    }
    // The approach starts next tick: this one either walked the route or
    // just decided, and a Hollow moves once per tick.
    return;
  }
  if (hasLineOfSight(h.pos, target, world.boxes, world.ground)) {
    h.stateTimer = 0;
  } else {
    h.stateTimer += dt;
    if (h.stateTimer >= HOLLOW_LOST_SIGHT_S) {
      clearRoute(h);
      return;
    }
  }
  walkToward(h, world, dt, target.x, target.z, speed);
}

function stepHollow(h: EnemyState, world: World, graph: TrailGraph, dt: number): void {
  switch (h.ai) {
    case AiState.Crawl:
      crawl(h, world, graph, dt);
      return;
    case AiState.Hunt: {
      const target = world.state.players.get(h.targetId);
      if (target !== undefined) pursue(h, world, graph, dt, target.pos);
      return;
    }
    case AiState.Merge: {
      const other = nearestOtherHollow(world, h);
      if (other !== null) pursue(h, world, graph, dt, other.pos);
      return;
    }
    default:
      return;
  }
}

/** Every Hollow's movement for one tick. Host only; a no-op without a trail. */
export function stepHollows(world: World, dt: number): void {
  const graph = world.trail;
  if (graph === null) return;
  for (const h of hollowsOf(world)) stepHollow(h, world, graph, dt);
}
```

`horizontalDistSq` takes `{x, z}` objects so a `TrailNode` (no `y`) passes without a cast. Task 5 adds the imports its rules need; this file must lint clean now, so nothing unused is imported yet.

- [ ] **Step 5: The tick and the first Hollow**

In `client/src/sim/world.ts`, import `{ spawnHollow, stepHollows } from "./hollow.js"` and `ENEMY_HALF` from constants. Replace the authoritative tail of `tickWorld`:

```ts
  if (!world.authoritative) return;

  if (world.trail !== null) {
    // A forest has the Hollow and no director (hollow.ts).
    stepHollows(world, TICK_DT);
  } else {
    for (const enemy of world.state.enemies.values()) {
      stepEnemy(enemy, world, TICK_DT);
    }
    for (const [id, enemy] of world.state.enemies) {
      if (isExpiredCorpse(enemy)) world.state.enemies.delete(id);
    }
    updateDirector(world);
  }
  updateDeaths(world);
  stepRegister(world, inputs);
```

In `createForestWorld`, after `installRegister(…)` inside the same `if`:

```ts
    // The Hollow starts on the crest, crawling down. Host only: a client's
    // predicted world takes every enemy from snapshots.
    if (authoritative) {
      const crest = graph.nodes[graph.summit] as TrailNode;
      spawnHollow(
        world,
        { x: crest.x, y: elevationAt(forest.seed, crest.x, crest.z) + ENEMY_HALF.y, z: crest.z },
        AiState.Crawl,
      );
    }
```

with `import type { TrailGraph, TrailNode } from "./trail.js";` and `AiState` added to the `types.js` import.

- [ ] **Step 6: The allow-list**

In `client/test/architecture.test.ts`, add `"hollow.ts Math.atan2(",` between the `ai.ts` and `movement.ts` entries of `EXPECTED`, and add to the comment's list: `- \`hollow.ts\` — the Hollow's facing, written inside the authoritative branch (\`stepHollows\`) and never replayed; render-only downstream.`

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client test/sim/hollow.test.ts test/sim/death.test.ts test/sim/ai.test.ts test/architecture.test.ts`
Expected: PASS. If the crawl test times out on the budget, print `h.pos` per 600 ticks and check `stemDir`, the route and `stuckTimer` before touching the constants.

- [ ] **Step 8: Commit**

```bash
git add client/src/sim/hollow.ts client/src/sim/ai.ts client/src/sim/world.ts client/test/architecture.test.ts client/test/sim/hollow.test.ts client/test/sim/death.test.ts
git commit -m "feat: the Hollow walks the trail"
```

---

### Task 5: The rules — contact, the stare, binding, splits, merges, the loss

**Files:**
- Modify: `client/src/sim/hollow.ts` (`updateHollows`, `playerSees`), `client/src/sim/world.ts` (call it), `client/src/sim/register.ts` (`signOut`)
- Test: `client/test/sim/hollow.test.ts` (this task's `describe`s)

**Interfaces:**
- Produces: `updateHollows(world)`; `playerSees(player, hollow, world): boolean`; `isHunted(world, playerId): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/hollow.test.ts` (add `spawnPlayer`-side imports: `Button, NO_ITEM, Outcome` from types; `installRegister, SIGN_OUT_TICKS, type Register` from register; `serializeWorldState` from world; and the constants `HOLLOW_STARE_FILL_S, HOLLOW_STARE_EMPTY_S, HOLLOW_LOOK_RANGE, HOLLOW_MERGE_RADIUS, isHunted, playerSees` from hollow):

```ts
/** One hiker at (40, 0, 0); the box at (0, 1, -20). */
function register(): Register {
  return {
    hikers: [{ id: 0, name: "Owen Marsh", site: { kind: "meadow", name: "the meadow", x: 40, y: 0, z: 0, progress: 1 } }],
    box: { x: 0, y: 1, z: -20 },
    car: { x: 30, y: 0.8, z: -20 },
  };
}
const holding = (id: number) => new Map([[id, { seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: Button.Interact }]]);

describe("contact", () => {
  it("kills a player it touches, hunted or not, and the dead stay dead with the item at their feet", () => {
    const w = world();
    installRegister(w, register());
    const hunted = spawnPlayer(w);
    const other = spawnPlayer(w);
    hunted.pos = { x: 100, y: 0.9, z: 0 };
    other.pos = { x: 100, y: 0.9, z: 1 };
    hunted.carrying = 0;
    w.state.items[0]!.carrier = hunted.id;
    spawnHollow(w, { x: 100.5, y: ENEMY_HALF.y, z: 0.5 }, AiState.Hunt, hunted.id);
    tickWorld(w, new Map());
    expect(hunted.health).toBe(0);
    expect(other.health).toBe(0);
    expect(hunted.carrying).toBe(NO_ITEM);
    expect(w.state.items[0]!.pos.x).toBeCloseTo(100, 6);
    tick(w, 600);
    expect(hunted.health).toBe(0);
  });

  it("does not reach a player standing two metres away", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 0 };
    spawnHollow(w, { x: 102, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl); // crawls a centimetre this tick
    tickWorld(w, new Map());
    expect(p.health).toBe(100);
  });
});

describe("looking", () => {
  it("sees a Hollow inside the cone, in range, with line of sight, and not otherwise", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 }; p.yaw = 0; p.pitch = 0; // facing +z
    const ahead = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 30 }, AiState.Crawl);
    expect(playerSees(p, ahead, w)).toBe(true);
    ahead.pos.x = 30; // 45° off the aim
    expect(playerSees(p, ahead, w)).toBe(false);
    ahead.pos.x = 0; ahead.pos.z = HOLLOW_LOOK_RANGE + 5;
    expect(playerSees(p, ahead, w)).toBe(false);
    ahead.pos.z = 30;
    expect(playerSees(p, ahead, w)).toBe(true);
    const walled = world({ min: [-5, 0, 10], max: [5, 4, 11], material: "concrete" });
    const q = spawnPlayer(walled);
    q.pos = { x: 0, y: 0.9, z: 0 }; q.yaw = 0; q.pitch = 0;
    const behind = spawnHollow(walled, { x: 0, y: ENEMY_HALF.y, z: 30 }, AiState.Crawl);
    expect(playerSees(q, behind, walled)).toBe(false);
  });

  it("fills the stare over HOLLOW_STARE_FILL_S, empties it over HOLLOW_STARE_EMPTY_S, and kills at 1", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: 0 };
    // It crawls toward the pad, straight down the player's aim, 0.8 m/s: in range and in the cone throughout.
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 100 }, AiState.Crawl);
    const fillTicks = Math.round(HOLLOW_STARE_FILL_S / TICK_DT);
    tick(w, Math.floor(fillTicks / 2));
    expect(p.stare).toBeCloseTo(0.5, 2);
    expect(h.seen).toBe(true);
    p.yaw = Math.PI; // look away
    tick(w, Math.round((HOLLOW_STARE_EMPTY_S / TICK_DT) / 2));
    expect(p.stare).toBeCloseTo(0, 2);
    expect(h.seen).toBe(false);
    p.yaw = 0;
    tick(w, fillTicks + 1);
    expect(p.stare).toBe(1);
    expect(p.health).toBe(0);
  });
});

describe("binding and release", () => {
  it("binds the nearest free Hollow on a player's first pick-up", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 0 };
    const far = spawnHollow(w, { x: 200, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl); // 100 m off, the lower id
    const near = spawnHollow(w, { x: 30, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl); // 70 m off
    p.carrying = 0;
    tickWorld(w, new Map());
    expect(near.ai).toBe(AiState.Hunt);
    expect(near.targetId).toBe(p.id);
    expect(far.ai).toBe(AiState.Crawl);
    expect(isHunted(w, p.id)).toBe(true);
    expect(p.signedOut).toBe(false);
  });

  it("splits a new Hollow out of the nearest one for a second carrier, and never for a second pick-up", () => {
    const w = world();
    const a = spawnPlayer(w);
    const b = spawnPlayer(w);
    a.pos = { x: 100, y: 0.9, z: 0 };
    b.pos = { x: 100, y: 0.9, z: 40 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    a.carrying = 0;
    tickWorld(w, new Map());
    expect(h.targetId).toBe(a.id);
    a.carrying = 1; // put one down, picked another up: still one Hollow
    tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(1);
    b.carrying = 0;
    tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(2);
    const split = [...w.state.enemies.values()].find((e) => e.id !== h.id)!;
    expect(split.ai).toBe(AiState.Hunt);
    expect(split.targetId).toBe(b.id);
    expect(dist(split.pos, h.pos)).toBeLessThan(HOLLOW_HUNT_SPEED * TICK_DT * 2);
  });

  it("releases nothing on a put-down", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    p.carrying = 0;
    tickWorld(w, new Map());
    p.carrying = NO_ITEM;
    tick(w, 60);
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);
  });

  it("releases on the hunted player's own sign-out, and the last Hollow goes back to crawling", () => {
    const w = world();
    installRegister(w, register());
    const p = spawnPlayer(w);
    p.pos = { x: 0, y: 0.9, z: -18 }; p.yaw = Math.PI; p.pitch = 0.2; // at the box, facing it
    const h = spawnHollow(w, { x: 200, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    p.carrying = 0;
    w.state.items[0]!.carrier = p.id;
    tickWorld(w, new Map());
    expect(h.ai).toBe(AiState.Hunt);
    for (let i = 0; i < SIGN_OUT_TICKS + 2; i++) tickWorld(w, holding(p.id));
    expect(w.state.items[0]!.signedOut).toBe(true);
    expect(h.ai).toBe(AiState.Crawl);
    expect(h.targetId).toBe(0);
    expect(isHunted(w, p.id)).toBe(false);
  });

  it("releases on the hunted player's death", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 0 };
    const h = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    p.carrying = 0;
    tickWorld(w, new Map());
    p.health = 0;
    tickWorld(w, new Map());
    expect(h.ai).toBe(AiState.Crawl);
  });

  it("a released Hollow with another present merges into it and is removed", () => {
    const w = world();
    const p = spawnPlayer(w);
    p.pos = { x: 100, y: 0.9, z: 0 };
    const keeper = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    const bound = spawnHollow(w, { x: 20, y: ENEMY_HALF.y, z: 0 }, AiState.Hunt, p.id);
    p.health = 0;
    tickWorld(w, new Map());
    expect(bound.ai).toBe(AiState.Merge);
    tick(w, 600);
    expect(w.state.enemies.has(bound.id)).toBe(false);
    expect(w.state.enemies.has(keeper.id)).toBe(true);
  });

  it("never merges the last two into none", () => {
    const w = world();
    const a = spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Merge);
    const b = spawnHollow(w, { x: HOLLOW_MERGE_RADIUS / 2, y: ENEMY_HALF.y, z: 0 }, AiState.Merge);
    tickWorld(w, new Map());
    expect(w.state.enemies.size).toBe(1);
    const left = [...w.state.enemies.values()][0]!;
    expect([a.id, b.id]).toContain(left.id);
    expect(left.ai).toBe(AiState.Crawl);
  });
});

describe("the loss", () => {
  it("is declared when the last living player dies, and not while one lives, and never with no players", () => {
    const empty = world();
    spawnHollow(empty, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    tick(empty, 10);
    expect(empty.state.outcome).toBe(Outcome.Playing);

    const w = world();
    spawnHollow(w, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    const a = spawnPlayer(w);
    const b = spawnPlayer(w);
    a.health = 0;
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Playing);
    b.health = 0;
    tickWorld(w, new Map());
    expect(w.state.outcome).toBe(Outcome.Lost);
  });
});

describe("determinism", () => {
  it("two worlds with a hunt on a moving player stay byte-identical for 600 ticks", () => {
    const a = world();
    const b = world();
    const pa = spawnPlayer(a);
    const pb = spawnPlayer(b);
    pa.pos = { x: 100, y: 0.9, z: 10 }; pb.pos = { x: 100, y: 0.9, z: 10 };
    spawnHollow(a, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    spawnHollow(b, { x: 0, y: ENEMY_HALF.y, z: 0 }, AiState.Crawl);
    pa.carrying = 0; pb.carrying = 0;
    for (let t = 0; t < 600; t++) {
      const cmd = { seq: t, moveX: t % 90 < 45 ? 1 : -1, moveZ: 1, yaw: t * 0.02, pitch: 0.1, buttons: 0 };
      tickWorld(a, new Map([[pa.id, cmd]]));
      tickWorld(b, new Map([[pb.id, cmd]]));
    }
    expect(serializeWorldState(a.state)).toBe(serializeWorldState(b.state));
    expect(a.state.enemies.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/hollow.test.ts`
Expected: FAIL — `updateHollows`, `playerSees`, `isHunted` missing; nobody dies.

- [ ] **Step 3: The rules**

Append to `client/src/sim/hollow.ts`, extending its imports: `PlayerState` (type) and `NO_ITEM`, `Outcome` from `./types.js`; `aimDirection` from `./view.js`; `PLAYER_EYE_OFFSET`, `PLAYER_HALF`, `SIM_TICK_HZ` from `./constants.js`:

```ts
/** Whether any Hollow hunts this player. */
export function isHunted(world: World, playerId: number): boolean {
  for (const e of world.state.enemies.values()) {
    if (e.ai === AiState.Hunt && e.targetId === playerId) return true;
  }
  return false;
}

/**
 * The look test: the Hollow's centre within HOLLOW_LOOK_COS of the player's
 * aim ray, within HOLLOW_LOOK_RANGE of the eye, and nothing in between.
 */
export function playerSees(player: PlayerState, hollow: EnemyState, world: World): boolean {
  const eye: Vec3 = { x: player.pos.x, y: player.pos.y + PLAYER_EYE_OFFSET, z: player.pos.z };
  const dx = hollow.pos.x - eye.x;
  const dy = hollow.pos.y - eye.y;
  const dz = hollow.pos.z - eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < EPSILON || dist > HOLLOW_LOOK_RANGE) return false;
  const dir = aimDirection(player.yaw, player.pitch);
  if ((dx * dir.x + dy * dir.y + dz * dir.z) / dist < HOLLOW_LOOK_COS) return false;
  return hasLineOfSight(eye, hollow.pos, world.boxes, world.ground);
}

function nearestTo(candidates: EnemyState[], pos: Vec3): EnemyState | null {
  let best: EnemyState | null = null;
  let bestSq = Infinity;
  for (const h of candidates) {
    const sq = horizontalDistSq(h.pos, pos);
    if (sq < bestSq) {
      bestSq = sq;
      best = h;
    }
  }
  return best;
}

function release(world: World, h: EnemyState): void {
  h.targetId = 0;
  clearRoute(h);
  h.ai = hollowsOf(world).length > 1 ? AiState.Merge : AiState.Crawl;
}

/**
 * The per-tick rules, host only, after every Hollow has moved: contact
 * kills; the look test, which slows a seen Hollow next tick and fills or
 * empties each player's stare; releases; binding on new carriers, with a
 * split when no Hollow is free; merges; and the loss.
 */
export function updateHollows(world: World): void {
  if (world.trail === null) return;
  const state = world.state;

  // Contact.
  const reach = PLAYER_HALF.x + ENEMY_HALF.x + HOLLOW_CONTACT_MARGIN;
  const tall = PLAYER_HALF.y + ENEMY_HALF.y;
  for (const h of hollowsOf(world)) {
    for (const p of state.players.values()) {
      if (p.health <= 0) continue;
      const dy = p.pos.y - h.pos.y;
      if (horizontalDistSq(p.pos, h.pos) <= reach * reach && Math.abs(dy) <= tall) p.health = 0;
    }
  }

  // Looking and the stare.
  const all = hollowsOf(world);
  for (const h of all) h.seen = false;
  const fill = 1 / (HOLLOW_STARE_FILL_S * SIM_TICK_HZ);
  const empty = 1 / (HOLLOW_STARE_EMPTY_S * SIM_TICK_HZ);
  for (const p of state.players.values()) {
    if (p.health <= 0) continue;
    let sees = false;
    for (const h of all) {
      if (playerSees(p, h, world)) {
        h.seen = true;
        sees = true;
      }
    }
    p.stare = sees ? Math.min(1, p.stare + fill) : Math.max(0, p.stare - empty);
    if (p.stare >= 1) p.health = 0;
  }

  // Releases: the hunted player is gone, dead, or signed a hiker out.
  for (const h of all) {
    if (h.ai !== AiState.Hunt) continue;
    const p = state.players.get(h.targetId);
    if (p === undefined || p.health <= 0 || p.signedOut) release(world, h);
  }

  // Binding: a living carrier nobody hunts takes the nearest free Hollow, or
  // a new one steps out of the nearest Hollow of any state.
  for (const p of state.players.values()) {
    if (p.health <= 0 || p.carrying === NO_ITEM || isHunted(world, p.id)) continue;
    p.signedOut = false;
    const live = hollowsOf(world);
    const free = nearestTo(live.filter((h) => h.ai !== AiState.Hunt), p.pos);
    if (free !== null) {
      free.ai = AiState.Hunt;
      free.targetId = p.id;
      clearRoute(free);
      continue;
    }
    const near = nearestTo(live, p.pos);
    if (near !== null) spawnHollow(world, near.pos, AiState.Hunt, p.id);
  }

  // Merges: on touch, and never down to none.
  for (const h of hollowsOf(world)) {
    if (h.ai !== AiState.Merge) continue;
    const other = nearestOtherHollow(world, h);
    if (other === null) {
      h.ai = AiState.Crawl;
      clearRoute(h);
      continue;
    }
    if (horizontalDistSq(h.pos, other.pos) <= HOLLOW_MERGE_RADIUS * HOLLOW_MERGE_RADIUS) {
      state.enemies.delete(h.id);
      if (hollowsOf(world).length === 1) {
        const last = hollowsOf(world)[0] as EnemyState;
        if (last.ai === AiState.Merge) {
          last.ai = AiState.Crawl;
          clearRoute(last);
        }
      }
    }
  }

  // The loss.
  if (state.outcome === Outcome.Playing && state.players.size > 0) {
    let living = 0;
    for (const p of state.players.values()) if (p.health > 0) living++;
    if (living === 0) state.outcome = Outcome.Lost;
  }
}
```

In `client/src/sim/world.ts`, the Hollow branch becomes `stepHollows(world, TICK_DT); updateHollows(world);` (import `updateHollows`). In `client/src/sim/register.ts`, `signOut` gains `player.signedOut = true;` after `player.signOutTicks = 0;` with the comment `// The Hollow bound to this player lets go (hollow.ts).`

- [ ] **Step 4: Run the tests, types and lint**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client test/sim`
Expected: PASS. Two likely surprises: (1) the "never merges the last two into none" test — the first Merge Hollow deletes itself and the guard turns the survivor to Crawl; (2) the sign-out release test needs the player's aim on the box (`yaw: Math.PI` faces −z from z = −18 toward the box at z = −20; `pitch 0.2` looks slightly down at y = 1 from an eye at 1.6) — if the prompt-less hold never signs out, print `resolveInteract(w, p)` and adjust the pitch, not the rule.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/hollow.ts client/src/sim/world.ts client/src/sim/register.ts client/test/sim/hollow.test.ts
git commit -m "feat: the Hollow's rules"
```

---

### Task 6: The stem is walkable — a seed sweep

**Files:**
- Test: `client/test/sim/hollowWalk.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { TICK_DT } from "../../src/sim/constants.js";
import { HOLLOW_HUNT_SPEED, hollowsOf } from "../../src/sim/hollow.js";

/**
 * The trail is walkable by `stepMovement` at the enemy hull: a Hollow bound
 * to a carrier standing at the pad comes down the whole stem from the crest
 * and reaches them. The player looks at the ground so the stare cannot end
 * the run first, and the loop stops on contact.
 */
describe("the Hollow walks the stem on real terrain", () => {
  it("reaches a carrier at the pad from the crest on 50 seeds", () => {
    for (let i = 0; i < 50; i++) {
      const token = `hollow${i}`;
      const w = createForestWorld(createForest(seedFromToken(token)));
      const p = spawnPlayer(w);
      p.pitch = 1.4;
      p.carrying = 0;
      const graph = w.trail!;
      const budget = Math.ceil(((graph.stemLen * 1.8 + 100) / HOLLOW_HUNT_SPEED) / TICK_DT);
      let t = 0;
      while (t < budget && p.health > 0) {
        tickWorld(w, new Map());
        t++;
      }
      const h = hollowsOf(w)[0]!;
      const d = Math.sqrt((h.pos.x - p.pos.x) ** 2 + (h.pos.z - p.pos.z) ** 2);
      expect(d, `seed ${token}: the Hollow stands ${d.toFixed(1)} m from the pad after ${t} ticks (stem ${graph.stemLen.toFixed(0)} m)`).toBeLessThan(3);
    }
  }, 300_000);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --root client test/sim/hollowWalk.test.ts`
Expected: PASS. A failing seed is a finding, not a test to loosen: print the Hollow's position, `stuckTimer` and route every 600 ticks for that seed and look at what it is wedged on (a trunk box on the corridor edge, a step the enemy hull cannot climb); the fix belongs in the walk (`walkToward`'s sidestep) or is a trail-system defect to report, never in the constants.

- [ ] **Step 3: Commit**

```bash
git add client/test/sim/hollowWalk.test.ts
git commit -m "test: the Hollow walks the stem on fifty seeds"
```

---

### Task 7: The screen — the silhouette, the stare, the passages

**Files:**
- Modify: `client/src/game/entityViews.ts`, `client/src/game/gradeParams.ts`, `client/src/game/post.ts`, `client/src/game/renderer.ts`, `client/src/game/registerHud.ts`, `client/src/app.ts`
- Test: `client/test/game/entityViews.test.ts`, `client/test/game/gradeParams.test.ts`, `client/test/game/registerHud.test.ts`

**Interfaces:**
- Consumes: `isHollowState`, `HOLLOW_HEIGHT` (`sim/hollow.ts`); `PlayerState.stare`; `Outcome.Lost`.
- Produces: `gradeRecordUnder(w, hour, unsettle, timeSeconds = 0, stare = 0)`; `STARE_VIGNETTE = 3`; `Post.update(weather, hour, unsettle, stare)`; `DEATH_LINE`, `LOSS_LINE`, `LOSS_LANDING_MS` in `registerHud.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/registerHud.test.ts` (extend the import with `DEATH_LINE, LOSS_LINE, LOSS_LANDING_MS`):

```ts
describe("the passages", () => {
  it("closes a player's story on death, and the match on the loss", () => {
    expect(DEATH_LINE).toBe("The woods had counted you among the missing before you knew that you were lost.");
    expect(LOSS_LINE).toBe("Nobody signed out. The book was closed from the bottom, by a hand that was not a hand, and the woods went back to counting.");
    expect(LOSS_LANDING_MS).toBe(8000);
  });
});
```

Append to `client/test/game/gradeParams.test.ts` (add `STARE_VIGNETTE` to the import):

```ts
describe("the stare", () => {
  it("leaves the record untouched at 0, darkens monotonically, and is black at 1", () => {
    expect(gradeRecordUnder(CLEAR, 12, 1, 0, 0)).toEqual(gradeRecordUnder(CLEAR, 12, 1));
    let lastExposure = Infinity;
    let lastVignette = -Infinity;
    for (const stare of [0, 0.25, 0.5, 0.75, 1]) {
      const r = gradeRecordUnder(EERIE, 12, 1, 0, stare);
      expect(r.exposure).toBeLessThanOrEqual(lastExposure);
      expect(r.vignetteWeight).toBeGreaterThanOrEqual(lastVignette);
      lastExposure = r.exposure;
      lastVignette = r.vignetteWeight;
    }
    expect(gradeRecordUnder(EERIE, 12, 1, 0, 1).exposure).toBe(0);
    expect(gradeRecordUnder(EERIE, 12, 1, 0, 1).vignetteWeight).toBeCloseTo(gradeRecordUnder(EERIE, 12, 1).vignetteWeight + STARE_VIGNETTE, 9);
  });
});
```

Append to `client/test/game/entityViews.test.ts`, inside the existing NullEngine `describe` (reuse its `scene` and the file's `state(...players)` helper, which builds an empty `WorldState`):

```ts
  it("draws a Hollow as a black, unlit, fog-free capsule and never as a chaser", () => {
    const views = new EntityViews(scene);
    const world = state();
    world.enemies.set(7, {
      id: 7, pos: { x: 1, y: 0.9, z: 2 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.5, health: 40, ai: AiState.Crawl,
      targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
      route: [], routeAt: 0, stemDir: -1, approach: false, seen: false,
    });
    views.sync(world, 99, 0);
    const mesh = scene.getMeshByName("hollow_7")!;
    expect(mesh).not.toBeNull();
    expect(scene.getMeshByName("enemy_7")).toBeNull();
    const material = mesh.material as PBRMaterial;
    expect(material.fogEnabled).toBe(false);
    expect(material.unlit).toBe(true);
    expect(mesh.rotation.y).toBeCloseTo(0.5, 9);
    // The hull centre is 0.9 m up; the 2.6 m capsule's centre sits 0.4 m higher so its feet meet the hull's.
    expect(mesh.position.y).toBeCloseTo(0.9 + (HOLLOW_HEIGHT / 2 - ENEMY_HALF.y), 6);
    views.dispose();
  });
```

(Import `HOLLOW_HEIGHT` from `sim/hollow.js`; `ENEMY_HALF` joins the existing constants import.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/game/registerHud.test.ts test/game/gradeParams.test.ts test/game/entityViews.test.ts`
Expected: FAIL.

- [ ] **Step 3: The passages**

In `client/src/game/registerHud.ts`, after `WIN_LINE`:

```ts
/** A player's death: their story closes on this line, and the view holds it. */
export const DEATH_LINE = "The woods had counted you among the missing before you knew that you were lost.";
/** Every player dead: the match's last line, then the landing. */
export const LOSS_LINE = "Nobody signed out. The book was closed from the bottom, by a hand that was not a hand, and the woods went back to counting.";
/** After the loss, the return to the landing. The win takes 5000. */
export const LOSS_LANDING_MS = 8000;
```

- [ ] **Step 4: The stare in the grade**

In `client/src/game/gradeParams.ts`:

```ts
/** Vignette weight added at a full stare, on top of the weather's. */
export const STARE_VIGNETTE = 3;
```

Change the signature to `export function gradeRecordUnder(w: WeatherParams, hour: number, unsettle: number, timeSeconds = 0, stare = 0): GradeRecord` and, inside, `const sight = (1 - clamp01(stare)) * (1 - clamp01(stare));` then `exposure: exposureUnder(w, altitude) * sight,` and `vignetteWeight: restingVignette * breath + STARE_VIGNETTE * clamp01(stare),`. Extend the doc comment: `\`stare\` (hollow.ts) darkens the image toward black at 1 and closes the vignette.`

In `client/src/game/post.ts`: `update(weather: WeatherParams, hour: number, unsettle: number, stare: number): void;` and `record = gradeRecordUnder(weather, hour, unsettle, seconds, stare);`.

In `client/src/game/renderer.ts`: beside `let unsettle = 1;` add `let stare = 0;`; at the top of `sync`, before `post.update`, `stare = state.players.get(localId)?.stare ?? 0;`; and `post.update(weather, lighting.hour, unsettle, stare);`. Any other `post.update` caller (grep) passes `0`.

- [ ] **Step 5: The silhouette**

In `client/src/game/entityViews.ts`: import `{ HOLLOW_HEIGHT, isHollowState } from "../sim/hollow.js"`; add `private readonly hollowMaterial: PBRMaterial;` and in the constructor:

```ts
    // The Hollow's placeholder: black, unlit, and outside the fog, so it stays
    // a silhouette at any distance in mist — findable in hindsight from far off.
    this.hollowMaterial = new PBRMaterial("mat_hollow", scene);
    this.hollowMaterial.albedoColor = new Color3(0, 0, 0);
    this.hollowMaterial.unlit = true;
    this.hollowMaterial.fogEnabled = false;
```

At the top of the `for (const [id, enemy] of state.enemies)` loop:

```ts
      if (isHollowState(enemy.ai)) {
        const view = this.ensure(this.enemies, id, enemy.pos, () => this.makeHollow(`hollow_${id}`));
        view.node.setEnabled(true);
        // The capsule is taller than the hull: lift it so both stand on the same feet.
        this.advance(view, enemy.pos.x, enemy.pos.y + (HOLLOW_HEIGHT / 2 - ENEMY_HALF.y), enemy.pos.z, clamped);
        view.node.rotation.y = enemy.yaw;
        continue;
      }
```

and the method:

```ts
  private makeHollow(name: string): Mesh {
    const mesh = MeshBuilder.CreateCapsule(name, { height: HOLLOW_HEIGHT, radius: ENEMY_HALF.x }, this.scene);
    mesh.material = this.hollowMaterial;
    return mesh;
  }
```

`dispose()` disposes `hollowMaterial` beside the others. The `ensure` helper's `placeView` puts the first frame at `enemy.pos` (unlifted) — the next `advance` corrects it; acceptable, one frame.

- [ ] **Step 6: Death and the loss on screen**

In `client/src/app.ts`, import `DEATH_LINE, LOSS_LINE, LOSS_LANDING_MS` beside `WIN_LINE`. Replace `syncOutcome` and add `syncDeath`:

```ts
  let dead = false;
  /**
   * Death, once: input off, the book closed, the view faded onto the passage.
   * The session stays and the scene keeps rendering under the fade — the
   * pause menu opens on Escape as ever, and preview mode will lift the fade.
   */
  function syncDeath(self: PlayerState | undefined): void {
    if (dead || self === undefined || self.health > 0) return;
    dead = true;
    input.setSuppressed(true);
    registerPanel.hide();
    hud.fade(true);
    hud.setStatus(DEATH_LINE);
  }

  let ended = false;
  /** The end, once: the view fades to one line and the match returns to the landing. */
  function syncOutcome(state: WorldState): void {
    if (ended || state.outcome === Outcome.Playing) return;
    ended = true;
    const won = state.outcome === Outcome.Won;
    input.setSuppressed(true);
    registerPanel.hide();
    hud.fade(true);
    hud.setStatus(won ? WIN_LINE : LOSS_LINE);
    if (landingTimer !== null) clearTimeout(landingTimer);
    landingTimer = setTimeout(navigateToLanding, won ? 5000 : LOSS_LANDING_MS);
  }
```

In both render loops call `syncDeath(self);` immediately before `syncOutcome(state);`. In `syncPrompt`, extend the first guard: `if (self === undefined || self.health <= 0 || freecam !== null || !input.engaged)`.

- [ ] **Step 7: Run the tests, types and lint**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client test/game`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/entityViews.ts client/src/game/gradeParams.ts client/src/game/post.ts client/src/game/renderer.ts client/src/game/registerHud.ts client/src/app.ts client/test/game/entityViews.test.ts client/test/game/gradeParams.test.ts client/test/game/registerHud.test.ts
git commit -m "feat: the Hollow on screen, the stare's darkening and the passages"
```

---

### Task 8: The browser, then the record

**Files:**
- Modify: `docs/gameplay/2026-09-15-the-hollow.md` (Status), `docs/gameplay/2026-09-08-register-and-hollow.md` (§17 row)

- [ ] **Step 1: The full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. Under machine load several sim files can fail on 5 s timeouts; re-run those files alone before reading anything into it.

- [ ] **Step 2: Play it**

With the dev stack on the default ports and a headed isolated `chrome-devtools` daemon, on seed `hollow` (two hikers; the register play rig's hooks — `__host`, `__tp` for any player, `__scene`), check and screenshot:

1. At tick 0 from the pad: a black upright silhouette on the stem, far up (`/freecam` and `weather clear` to find it; it is at the crest, crawling).
2. Teleport the host near the pond item, pick it up: within a few seconds the Hollow's `ai` reads Hunt (`__host.world.state.enemies`), and its route's last node is the player's nearest node.
3. Stand and stare at it as it comes: the vignette closes and the image darkens; look away and it recovers; hold the stare to 1 and the view fades to the death passage; the party roster is still there; Escape opens the pause menu.
4. Two carriers on two pages: two Hollows; the second steps out of the first; sign one out at the box (the hunt ends), and the released one walks to the other and vanishes on contact.
5. Let it reach a player: contact kills; the item lies at their feet; the survivor plays on.
6. Both dead: the loss passage on both pages, the landing after 8 s.

Record what each showed in the Status line of the spec.

- [ ] **Step 3: Record**

Spec Status: `**Status:** Built <date> (\`docs/gameplay/2026-09-15-the-hollow-plan.md\`). Numbers that moved in execution: …` — list every constant or rule that changed and why, or "none". Parent §17 C row: "built <date>". Commit:

```bash
git add docs/gameplay/2026-09-15-the-hollow.md docs/gameplay/2026-09-08-register-and-hollow.md
git commit -m "docs: record the Hollow as built"
```

Then `npm run typecheck && npm run lint && npm test`, the leak scan, push, `npm run deploy:client`, `npm run deploy:verify` (client only: `server/` is untouched).

## Self-review notes

- **Spec coverage.** §1.1–1.11 → Tasks 4 (crawl, pendulum, off-graph approach), 5 (binding, splits, put-down, release on sign-out/death, merges), 3 and 7 (permanent death and the passage), 5 and 7 (the stare), 1 (the enemy channel). §2.6 dials → Task 4's constants; `LOSS_LANDING_MS` → Task 7 per the Global Constraints note. §3 → Tasks 2 and 4. §4 → Tasks 1, 3, 4, 5. §5 → Task 7. §6 → each task's tests; the browser list → Task 8. §7 boundaries are untouched by any task.
- **Two fields beyond the spec.** `EnemyState.seen` and `PlayerState.signedOut`, both host-only, both named in Global Constraints; the spec's §4.1/§4.2 should gain them when Task 8 records what shipped.
- **Type consistency.** `spawnHollow(world, at, ai, targetId)`, `stepHollows(world, dt)`, `updateHollows(world)`, `hollowsOf(world)`, `isHunted(world, id)`, `playerSees(player, hollow, world)`, `nearestOtherHollow(world, h)`, `clearRoute(h)`, `route(graph, from, to)`, `stemNodes(graph)` are used with those shapes in every task. `horizontalDistSq` takes `{x, z}` objects per Task 4's note, so `TrailNode` needs no cast.
- **The look-factor test** measures two equal windows and compares displacement; acceleration to speed inside `stepMovement` affects both windows the same way.
- **Placeholder scan:** none; every step carries its code.
