# Trail 14 Trailhead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player arrives on the pad facing the trail, with the car behind them and a sign reading "Trail 14" at the trail's entrance turned toward them; the trail's name replaces "the summit trail" wherever a player reads it; and the code that holds the poster, the body's place and the car is renamed from `register` to `search`.

**Architecture:** Everything is derived from the seed and the trail graph on every peer, with nothing new on the wire. The car's place, the entrance and the spawn's gap live with the trailhead pass (`sim/passes/trailhead.ts`), the player's place and facing in `sim/spawn.ts`, the sign in `sim/signs.ts`, and two small pure modules carry the geometry (`sim/boxGap.ts`) and the trig-free facing (`sim/facing.ts`). The game gives the input sampler the spawn's facing, because a player's yaw is whatever their input says.

**Tech Stack:** TypeScript, vitest, Babylon.js (the game layer only). `sim/` determinism rules: no trig, no `Math.pow`, no `**`, no `Math.hypot` in `sim/`; `Math.sqrt` for lengths; directions as unit vectors.

**Spec:** `docs/trail/2026-09-28-trail-14-trailhead.md`. Read it first; this plan argues from it.

## Global Constraints

- Work in the worktree `.claude/worktrees/trail-14-trailhead` on branch `worktree-trail-14-trailhead`. Stage explicit paths only; never `git add -A` or `git add .`. Never use bare `git stash`.
- Commit messages use the repository's `## What` / `## How` shape (`.agents/skills/github-push/SKILL.md`): a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list with backticked paths, then the trailers the harness gives.
- The repository is public. Code, comments, test names, docs and commit messages describe the change and its measurements, and nothing about how the work was organised.
- The repository's pre-push scan runs after every commit and must report nothing failing.
- No push and no deploy without a go-ahead.
- Every numeric test expectation is a literal, never computed from the code under test.
- Every explicit test time limit goes through `timeLimit(<ms>)` from `client/test/helpers/timeLimit.ts`.
- `sim/` never imports `net/`, `game/` or Babylon (ESLint enforces it).
- Protocol 5 stands: no number on the wire changes. `InteractKind.Poster` is 2 and `POSTER_INTERACTABLE_ID` is 2.
- The trail builder, the pad's size, the road wall and the notice board's site do not change.
- The trail's name is exactly `Trail 14`. The poster's line is exactly `Last seen at Trail 14.`
- Constants, copied from the spec: `CAR_ROAD_Z` 0, `CAR_BED_CLEAR` 1.15 m, `CAR_SLIDE_STEP` 0.5 m, `CAR_SLIDE_MAX` 8 m, `SPAWN_GAP` 2.5 m, `SIGN_POST_OFFSET` 1.75 m (unchanged), `GEN_VERSION` 7.
- On this machine run `npm run typecheck`, `npm run lint` and the test files a task names. The full suites run once, in Task 9.
- A pinned value that moves is read from a run of the changed code and written as a literal, with a dated comment saying what it was and why it moved, as `client/test/sim/groundGradient.test.ts` already does.

## Review Focus

Inputs the spec implies and a person will meet. Each has its test in the task that owns the code.

1. **A player who joins a match already running, or follows a host in.** They must face the trail as the host did. `trailheadStart(seed)` is a pure function of the seed, called by the sim and by the game alike (Task 5, "gives every caller the same start"; Task 10 looks at two players).
2. **A world with no trail graph** (the `montane` terrain). The player spawns as before and faces yaw 0; nothing throws (Task 5, "has no start on a world with no trail").
3. **Controls held at the first sample** (the pause menu is up, or the pointer is not yet locked). The first command must still carry the starting yaw, or the view snaps to the road when controls engage (Task 7, "carries the starting yaw while suppressed").
4. **A touch device.** The starting yaw and the first touch look add; the look does not replace it (Task 7, "adds a touch look to the starting yaw").
5. **A trail that never clears the car**, however far the car slides. The slide stops at `CAR_SLIDE_MAX` and returns a place; it never loops (Task 4, "stops sliding at 8 m").

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/facing.ts` | New. The trig-free yaw of a direction. |
| `client/src/sim/boxGap.ts` | New. Ground-plane distances: point to box, point to segment, segment to box. |
| `client/src/sim/passes/trailhead.ts` | The trailhead's constants; `trailEntrance`, `bedGap`, `carSite`, `trailheadSite`; pass 8. |
| `client/src/sim/spawn.ts` | `trailheadSpawn`, `trailheadStart`. |
| `client/src/sim/world.ts` | `pickSpawn` returns a place and a yaw; `spawnPlayer` sets both. |
| `client/src/sim/signs.ts` | `TRAIL_NAME`, `trailSignSite`, `trailSign`, `allSignPosts`. |
| `client/src/sim/passes/signs.ts` | Pass 9 also emits the trail sign's box. |
| `client/src/sim/search.ts` | Renamed from `register.ts`. |
| `client/src/game/input.ts` | `InputOptions.startYaw`. |
| `client/src/game/posterPanel.ts` | `POSTER_LAST_SEEN`, `posterBoardLines`. |
| `client/src/app.ts` | Gives the input the start's yaw; draws every post; paints the board from the panel's lines. |

---

### Task 1: Print the watcher sweep's readings

The watcher sweep is re-measured in Task 9, and its changes have to be explained stand by stand. The sweep prints its readings only when it fails. This task makes it print them always, and records them before anything moves.

**Files:**
- Modify: `client/test/sim/watcherSweep.test.ts` (inside the test "stands only where every rule holds…")

**Interfaces:**
- Consumes: nothing.
- Produces: the sweep's summary on the console, read again in Task 9.

- [ ] **Step 1: Print the summary**

In `client/test/sim/watcherSweep.test.ts`, find the line `].join("\n");` that ends the `summary` constant and add one line after it:

```ts
    ].join("\n");
    console.info(`[watcher sweep]\n${summary}`);
```

- [ ] **Step 2: Run it and keep the output**

Run: `npx vitest run --root client test/sim/watcherSweep.test.ts 2>&1 | tee watcher-before.txt`
Expected: PASS, and the output holds a block starting `[watcher sweep]` with `875 of 936 stands shown within 120 ticks` and a `never shown:` line.

Move `watcher-before.txt` out of the repository (it is a working file, never committed).

- [ ] **Step 3: Commit**

```bash
git add client/test/sim/watcherSweep.test.ts
git commit
```

Message:

```
test: print the watcher sweep's readings on every run

## What

The watcher sweep measured its 936 stands and showed the readings only when
it failed. It prints them on every run now, so a change that moves a stand
can be read against the run before it.

## How

- `client/test/sim/watcherSweep.test.ts` — prints the summary (stands shown,
  tries admitted and refused by cause, the range, each slot, and the stands
  never shown) before its assertions.
```

---

### Task 2: Rename `register` to `search`

No behaviour changes. No number changes.

**Files:**
- Rename: `client/src/sim/register.ts` → `client/src/sim/search.ts`
- Rename: `client/test/sim/register.test.ts` → `client/test/sim/search.test.ts`
- Rename: `client/test/sim/registerSweep.test.ts` → `client/test/sim/searchSweep.test.ts`
- Rename: `client/test/sim/helpers/registerGraph.ts` → `client/test/sim/helpers/stemGraph.ts`
- Modify: every importer, and the comments listed in Step 4.

**Interfaces:**
- Consumes: nothing.
- Produces: `client/src/sim/search.ts` exporting `Search`, `SearchInput`, `buildSearch(input: SearchInput): Search`, `installSearch(world: World, search: Search): void`, `InteractKind.Poster` (2), `POSTER_RADIUS` (0.4), `POSTER_HEIGHT` (1.4), `POSTER_STANDOFF` (0.05), `POSTER_INTERACTABLE_ID` (2); `Search` has fields `hiker`, `body`, `poster`, `car`; `World.search: Search | null`; the test helper `graph(loops)` in `client/test/sim/helpers/stemGraph.ts`.

- [ ] **Step 1: Move the files**

```bash
git mv client/src/sim/register.ts client/src/sim/search.ts
git mv client/test/sim/register.test.ts client/test/sim/search.test.ts
git mv client/test/sim/registerSweep.test.ts client/test/sim/searchSweep.test.ts
git mv client/test/sim/helpers/registerGraph.ts client/test/sim/helpers/stemGraph.ts
```

- [ ] **Step 2: Rename the identifiers**

Run from the worktree's root:

```bash
FILES=$(grep -rlE "register|Register|BOX_(RADIUS|HEIGHT|INTERACTABLE_ID)" client/src client/test ARCHITECTURE.md)
perl -pi -e '
  s/\bbuildRegister\b/buildSearch/g;
  s/\binstallRegister\b/installSearch/g;
  s/\bRegisterInput\b/SearchInput/g;
  s/\bInteractKind\.Register\b/InteractKind.Poster/g;
  s/\bRegister = 2\b/Poster = 2/g;
  s/\bBOX_INTERACTABLE_ID\b/POSTER_INTERACTABLE_ID/g;
  s/\bBOX_RADIUS\b/POSTER_RADIUS/g;
  s/\bBOX_HEIGHT\b/POSTER_HEIGHT/g;
  s#sim/register\.(js|ts)#sim/search.$1#g;
  s#"\./register\.js"#"./search.js"#g;
  s#helpers/registerGraph\.js#helpers/stemGraph.js#g;
  s/\.register\b(?!\()/.search/g;
  s/\bconst register = /const search = /g;
  s/\bregister\.(hiker|body|box|car)\b/search.$1/g;
  s/\bregister === null\b/search === null/g;
  s/\bregister: null\b/search: null/g;
  s/\bregister: Register \| null\b/search: Search | null/g;
  s/\btype Register\b/type Search/g;
  s/\bsearch\.box\b/search.poster/g;
  s/\br\.box\b/r.poster/g;
' $FILES
```

- [ ] **Step 3: Finish `search.ts` and the fixtures by hand**

In `client/src/sim/search.ts`:

```ts
export type Search = {
  /** The one missing hiker, as the poster names them. */
  hiker: { name: string };
  /** Where the body is found: the crest, facing the stem's arrival. `yaw` is the facing, as a player's. */
  body: { pos: Vec3; yaw: number };
  /** The poster's centre on the notice board's face: what the hand reaches for. */
  poster: Vec3;
  /** The car's centre. */
  car: Vec3;
};
```

In `buildSearch`, the returned object's field `box: posterPoint(...)` becomes `poster: posterPoint(...)`.

`installSearch` becomes:

```ts
/**
 * Installs the poster as the one interactable on the notice board. Called on
 * the host's world and on a client's predicted world alike, so both resolve
 * the same thing in reach; reading the poster is the client's own screen.
 */
export function installSearch(world: World, search: Search): void {
  world.search = search;
  world.interactables.set(POSTER_INTERACTABLE_ID, {
    id: POSTER_INTERACTABLE_ID,
    pos: cloneVec3(search.poster),
    radius: POSTER_RADIUS,
    kind: InteractKind.Poster,
    label: "Read the poster",
    onInteract: () => undefined,
  });
}
```

Every remaining `Register` in `client/src/sim/search.ts`, `client/src/sim/world.ts` and `client/src/game/posterPanel.ts` that names the type becomes `Search`. In `client/src/game/posterPanel.ts` the parameter `register: Register` becomes `search: Search`, and `register.hiker.name` becomes `search.hiker.name`.

In `client/test/game/posterPanel.test.ts` the fixture's field `box: { x: 0, y: 1, z: 0 }` becomes `poster: { x: 0, y: 1, z: 0 }`.

In `client/test/sim/search.test.ts`: `describe("buildRegister"` → `describe("buildSearch"`, `describe("installRegister"` → `describe("installSearch"`, and the test name `"registers the box as the one interactable the poster hangs on"` → `"installs the poster as the one interactable on the board"`; in it, `const box = world.interactables.get(...)` → `const poster = ...` and the three lines that read `box.` read `poster.`.

In `client/test/sim/searchSweep.test.ts`: the doc comment's first sentence becomes `The search on real worlds. \`search.test.ts\` pins the rule at known numbers on a hand-built graph;` and `describe("the register over the 227-seed sweep"` becomes `describe("the search over the 227-seed sweep"`.

- [ ] **Step 4: Rewrite the comments that name the book**

Each comment says what the code does now.

| File | Today | After |
| --- | --- | --- |
| `client/src/net/protocol.ts` (the `PROTOCOL_VERSION` comment) | `the items section, the respawn timer, the carried item and the sign-out ticks gone; the Named event; before that, the stare, one byte per player; before that, the register — the hikers' items, the match outcome, and each player's carried item and sign-out ticks;` | `the items section and three bytes per player gone; the Named event; before that, the stare, one byte per player; before that, the match outcome and the items;` |
| `client/test/net/protocol.test.ts` (above the 695-byte expectation) | `the items section and three bytes per player (the respawn timer, the carried item and the sign-out ticks) left with the count,` | `the items section and three bytes per player left,` |
| `client/src/game/interactPrompt.ts` | `Every interactable the summit loop has — the box at the trailhead — carries its own label (\`register.ts\`)` | `Every interactable the summit loop has — the poster on the notice board — carries its own label (\`search.ts\`)` |
| `client/src/sim/interact.ts` | `it — the register's box and other interactables —` | `it — the poster and other interactables —` |
| `client/src/sim/trailBuild.ts` | `so \`nearestPointOnEdges\` (register.ts) reads something sane on them.` | `so a reader of stem progress reads something sane on them.` |
| `client/src/sim/terrain.ts` | `beside the trail, for the register's fallback site. Absent = none.` | `beside the trail. Absent = none.` |
| `client/src/sim/passes/signs.ts` | `so the pass needs the graph and nothing about the book.` | `so the pass needs the graph and nothing else.` |
| `client/src/sim/world.ts` | `The poster, the box and the car for a forest world (\`register.ts\`)` | `The missing hiker, the poster, the body's place and the car for a forest world (\`search.ts\`)` |
| `client/src/sim/signs.ts` | `and one plank per place (B §2.5): each place` | `and one plank per place: each place` |
| `client/src/sim/hikerNames.ts` | `so every peer reads the same book. Plain, period-neutral names: the register is a real trailhead's, not a horror prop.` | `so every peer reads the same poster. Plain, period-neutral names: the poster is a real trailhead's, not a horror prop.` |
| `client/test/sim/groundGradient.test.ts` | `the register's sign posts are pass 9` | `the fork sign posts are pass 9` |
| `client/src/app.ts` (in the atmosphere's sync) | `so a world without a register behaves` | `so a world without a search behaves` |
| `client/src/sim/world.ts` (the watcher's field) | ``like `register` and `trail` beside it.`` | ``like `search` and `trail` beside it.`` |
| `client/test/game/interactPrompt.test.ts` | `The box is the one Register-kind interactable there is` | `The poster is the one Poster-kind interactable there is` |

- [ ] **Step 5: Check nothing is left**

Run:

```bash
grep -rnE "\bRegister\b|\.register\b|the register|a register\b|register's|\`register\`|register\.ts|registerGraph|BOX_(RADIUS|HEIGHT|INTERACTABLE_ID)|sign-out|the book\b|same book" client/src client/test ARCHITECTURE.md
```

Expected: no output. If a line prints, it is a missed rename or a comment to rewrite by the rule of Step 4. The verb is untouched: `registerPass`, "passes register at import" and the like stay as they are.

- [ ] **Step 6: Typecheck, lint and the touched tests**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

Run: `npx vitest run --root client test/sim/search.test.ts test/sim/searchSweep.test.ts test/sim/summit.test.ts test/sim/cut.test.ts test/sim/containment.test.ts test/sim/watcher.test.ts test/sim/signs.test.ts test/sim/trailRoute.test.ts test/sim/hollow.test.ts test/game/posterPanel.test.ts test/game/interactPrompt.test.ts test/game/escalation.test.ts test/net/protocol.test.ts`
Expected: PASS, with the same number of tests as before the rename.

- [ ] **Step 7: Commit**

```bash
git add client/src client/test ARCHITECTURE.md
git status --short   # every path listed must be one this task changed
git commit
```

`git add client/src client/test ARCHITECTURE.md` names directories this task changed throughout; check the status before committing and unstage anything that is not part of the rename.

Message:

```
refactor: name the poster's module for the search, not a register

## What

The module that holds the missing hiker, the poster's place, the body's place
and the car was named for a register the game no longer has. It is named for
the search now, and the comments that described a book say what the code
does. Nothing behaves differently and no number on the wire changes: the
poster's interactable keeps kind 2 and id 2.

## How

- `client/src/sim/search.ts` — was `register.ts`. `Search`, `SearchInput`,
  `buildSearch`, `installSearch`, `InteractKind.Poster`, and the poster's
  constants `POSTER_RADIUS`, `POSTER_HEIGHT`, `POSTER_INTERACTABLE_ID`; the
  field `box` is `poster`.
- `client/src/sim/world.ts` — `World.search`.
- `client/src/sim/summit.ts`, `client/src/app.ts`,
  `client/src/game/posterPanel.ts` — read `world.search`.
- `client/src/net/protocol.ts`, `client/src/sim/signs.ts`,
  `client/src/sim/hikerNames.ts`, `client/src/sim/interact.ts`,
  `client/src/sim/terrain.ts`, `client/src/sim/trailBuild.ts`,
  `client/src/sim/passes/signs.ts`, `client/src/game/interactPrompt.ts` —
  comments only.
- `client/test/sim/search.test.ts`, `client/test/sim/searchSweep.test.ts`,
  `client/test/sim/helpers/stemGraph.ts` — renamed with it; the other tests
  follow the new names.
- `ARCHITECTURE.md` — the module's path.
```

---

### Task 3: The trig-free facing, in a module of its own

**Files:**
- Create: `client/src/sim/facing.ts`
- Create: `client/test/sim/facing.test.ts`
- Modify: `client/src/sim/search.ts` (remove its private `facingYaw`, import the shared one)

**Interfaces:**
- Consumes: nothing.
- Produces: `facingYaw(dx: number, dz: number): number` — the yaw that faces the direction `(dx, dz)`; yaw 0 faces +z, π/2 faces +x; exact on the eight compass points, within 0.072 rad of `Math.atan2(dx, dz)` elsewhere; `facingYaw(0, 0)` is 0.

- [ ] **Step 1: Write the failing test**

`client/test/sim/facing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { facingYaw } from "../../src/sim/facing.js";

describe("facingYaw", () => {
  it("is exact on the eight compass points", () => {
    expect(facingYaw(0, 1)).toBe(0);
    expect(facingYaw(1, 1)).toBe(0.7853981633974483);
    expect(facingYaw(1, 0)).toBe(1.5707963267948966);
    expect(facingYaw(1, -1)).toBe(2.356194490192345);
    expect(facingYaw(0, -1)).toBe(3.141592653589793);
    expect(facingYaw(-1, -1)).toBe(-2.356194490192345);
    expect(facingYaw(-1, 0)).toBe(-1.5707963267948966);
    expect(facingYaw(-1, 1)).toBe(-0.7853981633974483);
  });

  it("reads the same whatever the direction's length", () => {
    expect(facingYaw(1, 2)).toBe(0.5235987755982988);
    expect(facingYaw(10, 20)).toBe(0.5235987755982988);
    expect(facingYaw(-3, -1)).toBe(-1.9634954084936207);
  });

  it("faces +z when it is given no direction", () => {
    expect(facingYaw(0, 0)).toBe(0);
  });

  it("stays within 0.072 rad of the true angle all the way round", () => {
    let worst = 0;
    for (let i = 0; i < 36000; i++) {
      const a = (i / 36000) * 2 * Math.PI - Math.PI;
      const dx = Math.sin(a), dz = Math.cos(a);
      let d = Math.abs(facingYaw(dx, dz) - Math.atan2(dx, dz));
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > worst) worst = d;
    }
    expect(worst).toBeLessThan(0.072);
    expect(worst).toBeGreaterThan(0.07);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/sim/facing.test.ts`
Expected: FAIL, the module `../../src/sim/facing.js` cannot be found.

- [ ] **Step 3: Write the module**

`client/src/sim/facing.ts`:

```ts
/**
 * The yaw that faces a direction, without trigonometry: a piecewise-linear
 * atan2 over eight octants. It is exact on the eight compass points and
 * within 0.072 rad between them, and bit-identical on every peer because it
 * uses no function a browser is free to implement its own way. Yaw 0 faces
 * +z and PI/2 faces +x, as a player's does. No direction at all faces +z.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
export function facingYaw(dx: number, dz: number): number {
  const ax = dx < 0 ? -dx : dx, az = dz < 0 ? -dz : dz;
  const t = ax + az === 0 ? 0 : ax / (ax + az); // 0 on +z, 1 on +x
  const quarter = Math.PI / 2;
  let yaw = t * quarter; // first octant pair: +x, +z
  if (dz < 0) yaw = Math.PI - yaw;
  if (dx < 0) yaw = -yaw;
  return yaw;
}
```

In `client/src/sim/search.ts`, delete the private `facingYaw` function and its doc comment, and add the import:

```ts
import { facingYaw } from "./facing.js";
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/sim/facing.test.ts test/sim/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/facing.ts client/test/sim/facing.test.ts client/src/sim/search.ts
git commit
```

Message:

```
refactor: give the trig-free facing a module of its own

## What

The yaw that faces a direction, worked out without trigonometry so every
peer gets the same bits, lived inside the search module and served only the
body. It has its own module and its own tests now, so that a player's
starting direction can use it too. Its worst error against the true angle,
0.0711 rad, is pinned.

## How

- `client/src/sim/facing.ts` — `facingYaw(dx, dz)`, moved unchanged.
- `client/src/sim/search.ts` — imports it.
- `client/test/sim/facing.test.ts` — the eight compass points exactly, a
  direction's length not mattering, no direction facing +z, and the error
  all the way round between 0.07 and 0.072 rad.
```

---

### Task 4: The car's place

**Files:**
- Create: `client/src/sim/boxGap.ts`
- Create: `client/test/sim/boxGap.test.ts`
- Modify: `client/src/sim/passes/trailhead.ts`
- Modify: `client/src/sim/world.ts:166-167` (the two `propSite` calls)
- Modify: `client/src/app.ts:461-462` (the two `propSite` calls)
- Modify: `client/src/sim/forest.ts:40` (`GEN_VERSION`)
- Modify: `client/test/sim/trailhead.test.ts`
- Modify: `client/test/sim/searchSweep.test.ts`
- Modify: `client/test/sim/containment.test.ts` (the `GEN_VERSION` literal)
- Modify: `client/test/sim/groundGradient.test.ts` (the pass hash)

**Interfaces:**
- Consumes: `TRAIL_BED_HALF` (0.75) from `sim/trail.ts`; `PLAYER_HALF` from `sim/constants.ts`; `TRAILHEAD_RADIUS` (8) from `sim/bowl.ts`.
- Produces, from `client/src/sim/boxGap.ts`:
  - `type Ground = { x: number; z: number }`
  - `pointBoxGap(px: number, pz: number, centre: Ground, half: Ground): number`
  - `pointSegmentGap(px: number, pz: number, a: Ground, b: Ground): number`
  - `segmentBoxGap(a: Ground, b: Ground, centre: Ground, half: Ground): number`
- Produces, from `client/src/sim/passes/trailhead.ts`:
  - `CAR_ROAD_Z = 0`, `CAR_BED_CLEAR = 1.15`, `CAR_SLIDE_STEP = 0.5`, `CAR_SLIDE_MAX = 8`, `SPAWN_GAP = 2.5`
  - `type EntranceGraph = Pick<TrailGraph, "nodes" | "edges" | "stem" | "trailhead">`
  - `trailEntrance(graph: EntranceGraph): { x: number; z: number; dx: number; dz: number }`
  - `bedGap(graph: Pick<TrailGraph, "nodes" | "edges">, centre: Ground, half: Ground): number`
  - `carSite(graph: EntranceGraph, roadCenterX: (seed: number, z: number) => number, seed: number): Ground`
  - `trailheadSite(graph: EntranceGraph, roadCenterX: (seed: number, z: number) => number, seed: number, material: string): Ground` — the car by `carSite`, anything else by `propSite`.

- [ ] **Step 1: Write the failing geometry test**

`client/test/sim/boxGap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pointBoxGap, pointSegmentGap, segmentBoxGap } from "../../src/sim/boxGap.js";

const unit = { x: 1, z: 1 };
const origin = { x: 0, z: 0 };

describe("pointBoxGap", () => {
  it("is 0 inside the box, the face's distance beside it, the corner's beyond it", () => {
    expect(pointBoxGap(0.5, 0.5, origin, unit)).toBe(0);
    expect(pointBoxGap(3, 0, origin, unit)).toBe(2);
    expect(pointBoxGap(3, 4, origin, unit)).toBeCloseTo(3.605551275463989, 12);
  });
});

describe("pointSegmentGap", () => {
  it("measures to the segment's line within its ends and to an end beyond them", () => {
    expect(pointSegmentGap(0, 3, { x: -1, z: 0 }, { x: 1, z: 0 })).toBe(3);
    expect(pointSegmentGap(4, 4, { x: -1, z: 0 }, { x: 1, z: 0 })).toBe(5);
  });

  it("treats a segment of no length as a point", () => {
    expect(pointSegmentGap(2, 2, origin, origin)).toBeCloseTo(2.8284271247461903, 12);
  });
});

describe("segmentBoxGap", () => {
  it("is 0 for a segment that crosses the box or lies inside it", () => {
    expect(segmentBoxGap({ x: -5, z: 0 }, { x: 5, z: 0.5 }, origin, unit)).toBe(0);
    expect(segmentBoxGap({ x: -0.2, z: 0 }, { x: 0.2, z: 0 }, origin, unit)).toBe(0);
  });

  it("measures from a face, from a corner, and from the segment's own end", () => {
    expect(segmentBoxGap({ x: 3, z: -5 }, { x: 3, z: 5 }, origin, unit)).toBe(2);
    expect(segmentBoxGap({ x: 2, z: 4 }, { x: 4, z: 2 }, origin, unit)).toBeCloseTo(2.8284271247461903, 12);
    expect(segmentBoxGap({ x: 4, z: 0 }, { x: 9, z: 0 }, origin, { x: 1, z: 2 })).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/sim/boxGap.test.ts`
Expected: FAIL, the module `../../src/sim/boxGap.js` cannot be found.

- [ ] **Step 3: Write `boxGap.ts`**

`client/src/sim/boxGap.ts`:

```ts
/**
 * Distances in the ground plane between a point, a segment and an
 * axis-aligned box, for placing things beside the trail. A box is its centre
 * and its half-extents along x and z.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
export type Ground = { x: number; z: number };

/** From a point to a box; 0 inside it. */
export function pointBoxGap(px: number, pz: number, centre: Ground, half: Ground): number {
  const ex = (px < centre.x ? centre.x - px : px - centre.x) - half.x;
  const ez = (pz < centre.z ? centre.z - pz : pz - centre.z) - half.z;
  const gx = ex > 0 ? ex : 0, gz = ez > 0 ? ez : 0;
  return Math.sqrt(gx * gx + gz * gz);
}

/** From a point to the segment a→b; a segment of no length is a point. */
export function pointSegmentGap(px: number, pz: number, a: Ground, b: Ground): number {
  const sx = b.x - a.x, sz = b.z - a.z;
  const len2 = sx * sx + sz * sz;
  let t = len2 === 0 ? 0 : ((px - a.x) * sx + (pz - a.z) * sz) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (a.x + sx * t), dz = pz - (a.z + sz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Whether the segment a→b touches the box: a slab clip on each axis. */
function segmentCrossesBox(a: Ground, b: Ground, centre: Ground, half: Ground): boolean {
  let t0 = 0, t1 = 1;
  const axes: ReadonlyArray<readonly [number, number, number]> = [
    [a.x - centre.x, b.x - a.x, half.x],
    [a.z - centre.z, b.z - a.z, half.z],
  ];
  for (const [p, d, h] of axes) {
    if (d === 0) {
      if (p < -h || p > h) return false;
      continue;
    }
    let lo = (-h - p) / d, hi = (h - p) / d;
    if (lo > hi) {
      const s = lo;
      lo = hi;
      hi = s;
    }
    if (lo > t0) t0 = lo;
    if (hi < t1) t1 = hi;
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * From the segment a→b to a box; 0 where they touch. Two convex shapes that
 * do not touch are nearest at a corner of one of them, so the least of the
 * segment's two ends to the box and the box's four corners to the segment is
 * the answer.
 */
export function segmentBoxGap(a: Ground, b: Ground, centre: Ground, half: Ground): number {
  if (segmentCrossesBox(a, b, centre, half)) return 0;
  let gap = pointBoxGap(a.x, a.z, centre, half);
  const end = pointBoxGap(b.x, b.z, centre, half);
  if (end < gap) gap = end;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = pointSegmentGap(centre.x + sx * half.x, centre.z + sz * half.z, a, b);
      if (g < gap) gap = g;
    }
  }
  return gap;
}
```

- [ ] **Step 4: Run the geometry test**

Run: `npx vitest run --root client test/sim/boxGap.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing tests for the car's place**

In `client/test/sim/trailhead.test.ts`:

Change the import from the pass to:

```ts
import {
  CAR_HALF, PROPS, bedGap, carSite, propSite, roadProp, trailEntrance, trailheadSite,
} from "../../src/sim/passes/trailhead.js";
```

Remove `TRAILHEAD_RADIUS` from the `bowl.js` import (nothing here reads it after this step), and add:

```ts
import type { TrailGraph, TrailEdge } from "../../src/sim/trail.js";
```

Add these helpers above `describe("the trailhead pass"`:

```ts
/** A graph of bare nodes and edges with its pad at the origin, 9 m from a road along z at x = -9. */
function padGraph(nodes: Array<[number, number]>, edges: Array<[number, number, TrailEdge["kind"]]>): TrailGraph {
  return {
    nodes: nodes.map(([x, z]) => ({ x, z, h: 0, u: 0 })),
    edges: edges.map(([a, b, kind]) => ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: 0, progress1: 1 })),
    trailhead: { x: 0, z: 0, u: 9 }, summit: 1, stem: [0], loops: [], features: [], stemLen: 100, fallbacks: 0,
    forks: [], homeDist: [], shortestHome: 100,
  };
}
const straightRoad = (): number => -9;
```

Add a new `describe` block at the end of the file:

```ts
describe("the car's place", () => {
  it("finds the entrance where the stem's first edge crosses the pad's rim", () => {
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    expect(trailEntrance(g)).toEqual({ x: 8, z: 0, dx: 1, dz: 0 });
  });

  it("stands the car on the shoulder at the pad when the trail leaves straight inland", () => {
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    const car = carSite(g, straightRoad, 1);
    expect(car.x).toBeCloseTo(-2.1, 9);
    expect(car.z).toBe(0);
    expect(bedGap(g, car, CAR_HALF)).toBeCloseTo(1.2, 9);
  });

  it("slides the car away from the way the trail heads until the bed clears it", () => {
    // The trail leaves along +z, leaning 5.7 degrees toward the road: at the
    // pad the bed is 0.9652 m from the car's box, and 1.1642 m once the car
    // has slid 2 m toward -z.
    const g = padGraph([[0, 0], [-10, 100]], [[0, 1, "stem"]]);
    expect(bedGap(g, { x: -2.1, z: 0 }, CAR_HALF)).toBeCloseTo(0.9652, 4);
    const car = carSite(g, straightRoad, 1);
    expect(car.x).toBeCloseTo(-2.1, 9);
    expect(car.z).toBe(-2);
    expect(bedGap(g, car, CAR_HALF)).toBeCloseTo(1.1642, 4);
  });

  it("stops sliding at 8 m where no place clears the bed", () => {
    // The stem leaves along -z, so the car slides toward +z, where a second
    // bed runs along the shoulder through every place it could stand.
    const g = padGraph([[0, 0], [0, -100], [-1.5, 1], [-1.5, 100]], [[0, 1, "stem"], [2, 3, "loop"]]);
    const car = carSite(g, straightRoad, 1);
    expect(car.x).toBeCloseTo(-2.1, 9);
    expect(car.z).toBe(8);
  });

  it("gives the car by its own rule and the board by the mirrored one", () => {
    const g = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);
    expect(trailheadSite(g, straightRoad, 1, "car")).toEqual(carSite(g, straightRoad, 1));
    expect(trailheadSite(g, straightRoad, 1, "kiosk")).toEqual(propSite(g, straightRoad, 1, roadProp("kiosk")));
  });
});
```

Replace the test `"puts the pad centre 9 m from the road centreline on every seed, and the car on the shoulder beside it"` with:

```ts
  it("puts the pad centre 9 m from the road centreline on every seed, and the car on the shoulder at the pad", () => {
    const slides = new Map<number, number>();
    let leastGap = Infinity, leastSeed = 0;
    for (const seed of SEEDS) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const rx = roadCenterXOf(seed, graph.trailhead.z);
      expect(Math.abs(graph.trailhead.x - rx - TRAILHEAD_U)).toBeLessThan(1e-6);
      expect(TRAILHEAD_U).toBe(9);
      // The car: a box in the road frame, its road-side face 6 m from the
      // centreline AT ITS OWN z (the centreline curves), which is 0.5 m off
      // the pavement's edge.
      const car0 = carSite(graph, v.roadCenterX!, seed);
      const carRx = roadCenterXOf(seed, car0.z);
      const chunk = chunkHolding(seed, car0.x, car0.z);
      const car = chunk.props.find((p) => p.material === "car");
      expect(car, `seed ${seed}`).toBeDefined();
      expect(car!.box.min.x - carRx).toBeCloseTo(6, 6);
      expect(car!.box.max.z - car!.box.min.z).toBeCloseTo(4.6, 6);
      // It stands at the pad, or has slid a whole number of half-metres
      // along the road, away from the way the trail heads.
      const along = car0.z - graph.trailhead.z;
      const slide = Math.round(Math.abs(along) * 2) / 2;
      expect(Math.abs(Math.abs(along) - slide), `seed ${seed}`).toBeLessThan(1e-9);
      slides.set(slide, (slides.get(slide) ?? 0) + 1);
      if (slide > 0) expect(Math.sign(along), `seed ${seed}`).toBe(trailEntrance(graph).dz > 0 ? -1 : 1);
      const gap = bedGap(graph, car0, CAR_HALF);
      if (gap < leastGap) { leastGap = gap; leastSeed = seed; }
    }
    console.info(`[trailhead] car: slides ${JSON.stringify([...slides].sort((a, b) => a[0] - b[0]))}, least bed gap ${leastGap.toFixed(3)} m on seed ${leastSeed}`);
    expect([...slides].sort((a, b) => a[0] - b[0])).toEqual([[0, 216], [3, 1], [3.5, 10]]);
    expect(leastGap, `seed ${leastSeed}`).toBeGreaterThanOrEqual(1.15);
  }, timeLimit(300000));
```

In the test `"keeps every trailhead prop off the road bed AND clear of the trail bed, over the 227-seed sweep"`, replace the body of `for (const p of PROPS) { … }` with:

```ts
    for (const p of PROPS) {
      // The board keeps the mirrored-site rule and its centre-to-bed
      // threshold. The car stands by its own rule (`carSite`), beside the
      // pad's centre where the bed begins, so its clause is the gap from
      // the bed to its box: 1.15 m, a player's half-width off the bed's edge.
      const isCar = p.material === "car";
      const bedThreshold = TRAIL_BED_HALF + Math.max(p.half.x, p.half.z) + 0.5;
      let worstRoad = Infinity, worstRoadSeed = 0;
      let worstBed = Infinity, worstBedSeed = 0;
      let mirrored = 0;
      for (const seed of SEEDS) {
        const graph = v.trailGraph!(seed);
        const site = trailheadSite(graph, v.roadCenterX!, seed, p.material);
        if (!isCar && site.z !== graph.trailhead.z + p.z) mirrored++;
        const rx = roadCenterXOf(seed, site.z);
        const road = (site.x - p.half.x) - rx - (ROAD_BED_HALF + 0.5);
        if (road < worstRoad) { worstRoad = road; worstRoadSeed = seed; }
        const bed = isCar
          ? bedGap(graph, site, p.half) - 1.15
          : v.trailDistance!(seed, site.x, site.z) - bedThreshold;
        if (bed < worstBed) { worstBed = bed; worstBedSeed = seed; }
      }
      console.info(`[trailhead] ${p.material} u=${p.u}: mirrored on ${mirrored}/${SEEDS.length} seeds, worst road margin ${worstRoad.toFixed(2)} m, worst bed margin ${worstBed.toFixed(2)} m`);
      expect(worstRoad, `${p.material} u=${p.u} off the road bed, worst seed ${worstRoadSeed}`).toBeGreaterThanOrEqual(-1e-9);
      expect(worstBed, `${p.material} u=${p.u} clear of the trail bed, worst seed ${worstBedSeed}`).toBeGreaterThanOrEqual(0);
      expect(mirrored, `${p.material} mirrored`).toBe(isCar ? 0 : 15);
    }
```

In `client/test/sim/searchSweep.test.ts`, change the import to `import { CAR_MATERIAL, KIOSK_MATERIAL, trailheadSite } from "../../src/sim/passes/trailhead.js";` and the `site` helper to:

```ts
      const site = (material: string) => trailheadSite(graph, activeTerrainVariant().roadCenterX!, seed, material);
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest run --root client test/sim/trailhead.test.ts`
Expected: FAIL, `carSite`, `bedGap`, `trailEntrance` and `trailheadSite` are not exported.

- [ ] **Step 7: Write the car's place**

In `client/src/sim/passes/trailhead.ts`:

Add to the imports:

```ts
import { TRAILHEAD_U, TRAILHEAD_RADIUS } from "../bowl.js";
import { PLAYER_HALF } from "../constants.js";
import { segmentBoxGap, type Ground } from "../boxGap.js";
import type { TrailGraph, TrailNode } from "../trail.js";
```

(replacing the existing `TRAILHEAD_U` and `TrailGraph` imports).

Replace the car's constants and their comment with:

```ts
/** The car: parked on the shoulder, parallel to the
 * road, its road-side face 0.5 m off the pavement edge, at the pad's own
 * place along the road, so that it is behind a player who stands near the
 * pad's centre and faces the trail. */
export const CAR_ROAD_U = ROAD_BED_HALF + 0.5 + CAR_HALF.x; // centre's u
export const CAR_ROAD_Z = 0;                               // centre's z from the anchor
/** The least gap from the bed's centreline to the car's box: the bed's
 * half-width and a player's, so a player walking the bed's edge clears the
 * car. Where the gap is less, the car slides along the road. */
export const CAR_BED_CLEAR = TRAIL_BED_HALF + PLAYER_HALF.x;
export const CAR_SLIDE_STEP = 0.5;
/** The pad's radius. Over the 227-seed sweep the car slides 3.5 m at most. */
export const CAR_SLIDE_MAX = 8;
/** How far past the car's box, along the line to the entrance, a player
 * spawns (`trailheadSpawn` in spawn.ts). It stands here because it is part
 * of what every peer must agree on, and the pass's tunables are what the
 * level id reads. */
export const SPAWN_GAP = 2.5;
```

Add after `kioskFacing`:

```ts
export type EntranceGraph = Pick<TrailGraph, "nodes" | "edges" | "stem" | "trailhead">;

/**
 * The trail's entrance: the point where the stem's first edge crosses the
 * pad's rim, and the unit direction the trail leaves in. The first edge is
 * longer than the pad's radius on every seed of the sweep (11.4 m at the
 * least), so the bed is straight from the pad's centre to the rim. A graph
 * with no stem leaves toward +x.
 */
export function trailEntrance(graph: EntranceGraph): { x: number; z: number; dx: number; dz: number } {
  const first = graph.stem.length === 0 ? undefined : graph.edges[graph.stem[0] as number];
  const from = graph.nodes[0] as TrailNode;
  const to = first === undefined ? from : (graph.nodes[first.a === 0 ? first.b : first.a] as TrailNode);
  const ex = to.x - from.x, ez = to.z - from.z;
  const len = Math.sqrt(ex * ex + ez * ez);
  const dx = len > 0 ? ex / len : 1, dz = len > 0 ? ez / len : 0;
  return { x: graph.trailhead.x + dx * TRAILHEAD_RADIUS, z: graph.trailhead.z + dz * TRAILHEAD_RADIUS, dx, dz };
}

/** The least gap from any edge's centreline to a box. */
export function bedGap(graph: Pick<TrailGraph, "nodes" | "edges">, centre: Ground, half: Ground): number {
  let gap = Infinity;
  for (const e of graph.edges) {
    const g = segmentBoxGap(graph.nodes[e.a] as TrailNode, graph.nodes[e.b] as TrailNode, centre, half);
    if (g < gap) gap = g;
  }
  return gap;
}

/**
 * Where the car stands: on the shoulder at the pad's own place along the
 * road, and where the bed would come within CAR_BED_CLEAR of its box, slid
 * along the road in CAR_SLIDE_STEP steps until it does not, or until
 * CAR_SLIDE_MAX. It slides away from the way the trail heads, so the bed
 * runs off from the car and not along its flank. Over the 227-seed sweep it
 * stands at the pad on 216 seeds and slides 3 m on one and 3.5 m on ten.
 */
export function carSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
): Ground {
  const away = trailEntrance(graph).dz > 0 ? -1 : 1;
  const at = (slide: number): Ground => {
    const z = graph.trailhead.z + CAR_ROAD_Z + away * slide;
    return { x: roadCenterX(seed, z) + CAR_ROAD_U, z };
  };
  let site = at(0);
  for (let slide = CAR_SLIDE_STEP; slide <= CAR_SLIDE_MAX && bedGap(graph, site, CAR_HALF) < CAR_BED_CLEAR; slide += CAR_SLIDE_STEP) {
    site = at(slide);
  }
  return site;
}

/** Where the prop of a material stands: the car by its own rule, the rest by `propSite`. */
export function trailheadSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
  material: string,
): Ground {
  return material === CAR_MATERIAL ? carSite(graph, roadCenterX, seed) : propSite(graph, roadCenterX, seed, roadProp(material));
}
```

`propSite`'s first parameter type widens to `EntranceGraph` so that one graph serves both:

```ts
export function propSite(
  graph: EntranceGraph,
```

In the pass's `tunables` getter, add the new constants:

```ts
    return {
      CAR_HALF_X: CAR_HALF.x, CAR_HALF_Y: CAR_HALF.y, CAR_HALF_Z: CAR_HALF.z,
      KIOSK_HALF_X: KIOSK_HALF.x, KIOSK_HALF_Y: KIOSK_HALF.y, KIOSK_HALF_Z: KIOSK_HALF.z,
      CAR_ROAD_U, CAR_ROAD_Z, SIGN_ROAD_U, SIGN_ROAD_Z,
      CAR_BED_CLEAR, CAR_SLIDE_STEP, CAR_SLIDE_MAX, SPAWN_GAP,
    };
```

In the pass's `run`, replace the `propSite` call:

```ts
      const { x: cx, z: cz } = trailheadSite(graph, roadCenterX, worldSeed, p.material);
```

In the module's header comment, the first paragraph gains one sentence at its end, and the heading of the second changes; the board's measurements below them stay as they are:

```ts
/** The trailhead's two props: axis-aligned brushes for the ranger's car and
 * the roofed notice board (the kiosk) the missing hiker's poster is pinned
 * to. The drawn models stand on these boxes; the boxes are what a hiker
 * collides with. The board stands by `propSite`, the car by `carSite`.
 *
 * THE BOARD STANDS IN THE ROAD FRAME (u from the road centreline, z from the
 * trailhead's own anchor). The board
```

In `client/src/sim/world.ts`, replace the two sites:

```ts
    const kiosk = trailheadSite(graph, roadCenterX, forest.seed, KIOSK_MATERIAL);
    const car = trailheadSite(graph, roadCenterX, forest.seed, CAR_MATERIAL);
```

and its import: `import { CAR_MATERIAL, KIOSK_MATERIAL, trailheadSite } from "./passes/trailhead.js";`

In `client/src/app.ts`, in `createSigns`, replace the two sites the same way and change the import to `import { CAR_MATERIAL, KIOSK_MATERIAL, kioskFacing, trailheadSite } from "./sim/passes/trailhead.js";`

In `client/src/sim/forest.ts`: `export const GEN_VERSION = 7;`. Add to the comment above it one sentence: `7: the car stands at the pad and a sign stands at the trail's entrance, and a player arrives facing the trail.`

In `client/test/sim/containment.test.ts`, the last expectation and its comment become:

```ts
    // 5 was the wall at the road; 6, the ground's stick standing a hull on a
    // box top; 7, the car at the pad, the sign at the trail's entrance and
    // the player facing the trail. Either way no peer from before can join.
    expect(GEN_VERSION).toBe(7);
```

- [ ] **Step 8: Run the trailhead tests**

Run: `npx vitest run --root client test/sim/boxGap.test.ts test/sim/trailhead.test.ts test/sim/searchSweep.test.ts test/sim/containment.test.ts test/sim/forest.test.ts`
Expected: PASS. The console shows `[trailhead] car: slides [[0,216],[3,1],[3.5,10]], least bed gap 1.193 m`.

- [ ] **Step 9: Re-pin the pass hash**

Run: `npx vitest run --root client test/sim/groundGradient.test.ts -t "pins passHash"`
Expected: FAIL at `expect(passHash()).toBe(-311867473)`, with the received value in the message.

In `client/test/sim/groundGradient.test.ts`, write the received value as the literal, and add above it:

```ts
    // Re-baselined 2026-09-28 from -311867473: the car stands at the pad
    // (CAR_ROAD_Z 12 -> 0) and slides clear of the bed, so CAR_BED_CLEAR,
    // CAR_SLIDE_STEP, CAR_SLIDE_MAX and SPAWN_GAP join pass 8's tunables
    // (registryDigest moves) and the car's box moves 12 m along the road
    // in the probe chunk that holds it (probeDigest moves). A peer with the
    // car at its old place collides differently on the pad.
```

Run it again. Expected: PASS.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add client/src/sim/boxGap.ts client/test/sim/boxGap.test.ts client/src/sim/passes/trailhead.ts client/src/sim/world.ts client/src/app.ts client/src/sim/forest.ts client/test/sim/trailhead.test.ts client/test/sim/searchSweep.test.ts client/test/sim/containment.test.ts client/test/sim/groundGradient.test.ts
git commit
```

Message:

```
feat: park the car at the pad, clear of the trail

## What

The car stood on the shoulder 12 m along the road from the pad. It stands at
the pad now, so that it is behind a player who faces the trail. Where the
trail would run within 1.15 m of its box, the car slides along the road,
away from the way the trail heads, until it is clear. Over the 227 sweep
seeds it stands at the pad on 216 and slides 3 m on one and 3.5 m on ten,
and the bed's centreline is never nearer its box than 1.19 m. The level id
moves, so a match made before this cannot be joined after it.

## How

- `client/src/sim/boxGap.ts` — distances in the ground plane: a point to a
  box, a point to a segment, a segment to a box.
- `client/src/sim/passes/trailhead.ts` — `CAR_ROAD_Z` 12 -> 0;
  `trailEntrance`, where the stem's first edge crosses the pad's rim;
  `bedGap`, the least gap from any edge to a box; `carSite`, the slide;
  `trailheadSite`, the one place callers ask where a prop stands. Pass 8
  emits the car there, and its tunables carry the new constants.
- `client/src/sim/world.ts`, `client/src/app.ts` — ask `trailheadSite`.
- `client/src/sim/forest.ts` — `GEN_VERSION` 6 -> 7.
- `client/test/sim/boxGap.test.ts` — each distance at known numbers.
- `client/test/sim/trailhead.test.ts` — the car's place on hand-built
  graphs (no slide, a 2 m slide, the slide's 8 m limit) and over the 227
  seeds (the slides' counts, the bed's gap, the road-side face).
- `client/test/sim/searchSweep.test.ts` — reads the car's place by the new
  rule.
- `client/test/sim/containment.test.ts`,
  `client/test/sim/groundGradient.test.ts` — the generation's number and
  the pass hash, re-pinned.
```

---

### Task 5: The player's place and facing

**Files:**
- Modify: `client/src/sim/spawn.ts`
- Modify: `client/src/sim/world.ts` (`pickSpawn`, `spawnPlayer`)
- Modify: `client/test/sim/spawn.test.ts`
- Modify: `client/test/sim/trailhead.test.ts`

**Interfaces:**
- Consumes: `trailEntrance`, `carSite`, `CAR_HALF`, `SPAWN_GAP`, `EntranceGraph` from `sim/passes/trailhead.ts`; `facingYaw` from `sim/facing.ts`; `Ground` from `sim/boxGap.ts`.
- Produces, from `client/src/sim/spawn.ts`:
  - `type Start = { x: number; z: number; yaw: number }`
  - `trailheadSpawn(graph: EntranceGraph, car: Ground): Start`
  - `trailheadStart(seed: number): Start | null` — null on a world with no trail graph or no road.

- [ ] **Step 1: Write the failing tests**

Add to `client/test/sim/spawn.test.ts` (keep its existing imports and tests):

```ts
import { trailheadSpawn, trailheadStart } from "../../src/sim/spawn.js";
import { graph } from "./helpers/stemGraph.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer } from "../../src/sim/world.js";
import "../../src/sim/passes/index.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("trailheadSpawn", () => {
  it("stands the player 2.5 m past the car's box on the line to the entrance, facing it", () => {
    // The stem leaves along +x from the pad at the origin, so the entrance
    // is (8, 0). The car's box is 0.9 m deep toward it.
    const s = trailheadSpawn(graph(1), { x: -2.1, z: 0 });
    expect(s.x).toBeCloseTo(1.3, 9);
    expect(s.z).toBeCloseTo(0, 9);
    expect(s.yaw).toBeCloseTo(1.5707963267948966, 12);
  });

  it("follows the line when the car stands off to one side", () => {
    const s = trailheadSpawn(graph(1), { x: -2.1, z: -3 });
    expect(s.x).toBeCloseTo(1.1965159905355383, 9);
    expect(s.z).toBeCloseTo(-2.0208368344943946, 9);
    expect(s.yaw).toBeCloseTo(1.2110719771472105, 9);
  });
});

describe("trailheadStart", () => {
  it("gives every caller the same start for a seed", { timeout: timeLimit(60_000) }, () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const seed = seedFromToken("hollow");
    const first = trailheadStart(seed)!;
    trailheadStart(seedFromToken("room-1"));
    expect(trailheadStart(seed)).toEqual(first);
    expect(first.x).toBeCloseTo(-313.0286066837363, 6);
    expect(first.z).toBeCloseTo(-2.398352174641473, 6);
    expect(first.yaw).toBeCloseTo(2.295766724707367, 9);
  });

  it("has no start on a world with no trail", () => {
    setActiveTerrainVariant("montane");
    try {
      expect(trailheadStart(7)).toBeNull();
    } finally {
      setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    }
  });
});

describe("a player's arrival", () => {
  it("puts every player at the start, facing the trail", { timeout: timeLimit(60_000) }, () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const seed = seedFromToken("hollow");
    const w = createForestWorld(createForest(seed));
    const a = spawnPlayer(w), b = spawnPlayer(w);
    for (const p of [a, b]) {
      expect(p.pos.x).toBeCloseTo(-313.0286066837363, 6);
      expect(p.pos.z).toBeCloseTo(-2.398352174641473, 6);
      expect(p.yaw).toBeCloseTo(2.295766724707367, 9);
    }
  });
});
```

If `client/test/sim/spawn.test.ts` already imports any of these names, merge the imports rather than repeating them.

Add to `client/test/sim/trailhead.test.ts` a new `describe` block at the end of the file, with `trailheadSpawn` imported from `../../src/sim/spawn.js` and `KIOSK_HALF` added to the pass's import:

```ts
describe("the player's place", () => {
  it("stands the player in front of the car, facing the trail's entrance, on every seed", () => {
    const v = terrainVariant("olympic")!;
    const gapTo = (x: number, z: number, c: { x: number; z: number }, h: { x: number; z: number }): number =>
      Math.hypot(Math.max(Math.abs(x - c.x) - h.x, 0), Math.max(Math.abs(z - c.z) - h.z, 0));
    let behind = Infinity, ahead = 0, axis = 0, carGap = Infinity, boardGap = Infinity, road = Infinity, reach = 0;
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const car = carSite(graph, v.roadCenterX!, seed);
      const board = trailheadSite(graph, v.roadCenterX!, seed, "kiosk");
      const s = trailheadSpawn(graph, car);
      const e = trailEntrance(graph);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const off = (x: number, z: number): number => {
        const d = Math.hypot(x - s.x, z - s.z);
        const c = ((x - s.x) * fx + (z - s.z) * fz) / d;
        return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      };
      behind = Math.min(behind, off(car.x, car.z));
      ahead = Math.max(ahead, off(e.x, e.z));
      axis = Math.max(axis, (Math.acos(Math.max(-1, Math.min(1, fx * e.dx + fz * e.dz))) * 180) / Math.PI);
      carGap = Math.min(carGap, gapTo(s.x, s.z, car, CAR_HALF));
      boardGap = Math.min(boardGap, gapTo(s.x, s.z, board, KIOSK_HALF));
      road = Math.min(road, s.x - roadCenterXOf(seed, s.z));
      reach = Math.max(reach, Math.hypot(e.x - s.x, e.z - s.z));
    }
    console.info(`[trailhead] player: car ${behind.toFixed(2)} deg off the facing at least, entrance ${ahead.toFixed(2)} at most, facing ${axis.toFixed(2)} off the trail's direction at most, ${carGap.toFixed(2)} m from the car, ${boardGap.toFixed(2)} m from the board, ${road.toFixed(2)} m from the centreline, ${reach.toFixed(2)} m from the entrance at most`);
    expect(behind).toBeGreaterThanOrEqual(175);
    expect(ahead).toBeLessThanOrEqual(5);
    expect(axis).toBeLessThanOrEqual(19);
    expect(carGap).toBeGreaterThanOrEqual(1.5);
    expect(boardGap).toBeGreaterThanOrEqual(3);
    expect(road).toBeGreaterThanOrEqual(7.5);
    expect(reach).toBeLessThanOrEqual(7);
  }, timeLimit(300000));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/spawn.test.ts`
Expected: FAIL, `trailheadSpawn` and `trailheadStart` are not exported.

- [ ] **Step 3: Write the spawn**

Add to `client/src/sim/spawn.ts`:

```ts
import { facingYaw } from "./facing.js";
import type { Ground } from "./boxGap.js";
import { CAR_HALF, SPAWN_GAP, carSite, trailEntrance, type EntranceGraph } from "./passes/trailhead.js";

/** Where a player arrives, and the yaw they face. */
export type Start = { x: number; z: number; yaw: number };

/**
 * A player arrives on the straight line from the car to the trail's
 * entrance, SPAWN_GAP past the point where that line leaves the car's box,
 * facing the entrance. Because they stand on that line, the car is behind
 * them and the entrance ahead whatever way the trail leaves the pad: on 24
 * of the 227 sweep seeds it leaves nearly parallel to the road, and a place
 * fixed in the road's frame could not put the car behind them there.
 */
export function trailheadSpawn(graph: EntranceGraph, car: Ground): Start {
  const e = trailEntrance(graph);
  const lx = e.x - car.x, lz = e.z - car.z;
  const len = Math.sqrt(lx * lx + lz * lz);
  const ux = lx / len, uz = lz / len;
  const ax = ux < 0 ? -ux : ux, az = uz < 0 ? -uz : uz;
  // How far along the line the car's box reaches: the nearer of its two faces.
  const outX = ax === 0 ? Infinity : CAR_HALF.x / ax;
  const outZ = az === 0 ? Infinity : CAR_HALF.z / az;
  const reach = (outX < outZ ? outX : outZ) + SPAWN_GAP;
  const x = car.x + ux * reach, z = car.z + uz * reach;
  return { x, z, yaw: facingYaw(e.x - x, e.z - z) };
}

/**
 * The start on the active terrain's world for a seed, or null where the
 * world has no trail or no road. A pure function of the seed, so the sim
 * that places a player and the game that aims their view agree on every
 * peer with nothing exchanged.
 */
export function trailheadStart(seed: number): Start | null {
  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  const roadCenterX = variant.roadCenterX;
  if (graph === undefined || roadCenterX === undefined) return null;
  return trailheadSpawn(graph, carSite(graph, roadCenterX, seed));
}
```

In `client/src/sim/world.ts`, import `trailheadStart` from `./spawn.js` beside `spiralSpawn`, and replace `pickSpawn` and the head of `spawnPlayer`:

```ts
/**
 * Where a joining player starts, and the way they face.
 *
 * Hand-authored levels cycle their spawn list by player count so a full lobby
 * never stacks. A forest has no list: every peer derives the same start from
 * the seed (`trailheadStart`), in front of the car and facing the trail, and
 * walks the same deterministic spiral out from it to the first free place,
 * so they arrive at the same answer without exchanging anything.
 */
function pickSpawn(world: World): { pos: Vec3; yaw: number } {
  if (world.forest !== null) {
    const seed = world.forest.seed;
    const start = trailheadStart(seed);
    const centre = start === null ? { x: 0.5, z: 0.5 } : { x: start.x, z: start.z };
    return { pos: spiralSpawn(world.boxes, seed, PLAYER_HALF, centre), yaw: start === null ? 0 : start.yaw };
  }
  const spawns = world.level.playerSpawns;
  return { pos: spawns[world.state.players.size % spawns.length] as Vec3, yaw: 0 };
}

export function spawnPlayer(world: World): PlayerState {
  const id = world.state.nextEntityId++;
  const spawn = pickSpawn(world);
  const player: PlayerState = {
    id,
    pos: cloneVec3(spawn.pos),
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
```

(the rest of `spawnPlayer` is unchanged).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/sim/spawn.test.ts test/sim/trailhead.test.ts test/sim/world.test.ts test/sim/summitRun.test.ts test/sim/containment.test.ts`
Expected: PASS. The console shows `[trailhead] player: car 175.93 deg off the facing at least, entrance 4.07 at most, facing 18.63 off the trail's direction at most, 1.74 m from the car, 3.53 m from the board, 7.88 m from the centreline, 6.74 m from the entrance at most`.

If a test elsewhere placed a player by assuming the pad's centre or yaw 0 on a forest world, it fails here. Set the player's `pos` and `yaw` in that test to what it means to test, as `search.test.ts` does; do not change the spawn to suit it.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add client/src/sim/spawn.ts client/src/sim/world.ts client/test/sim/spawn.test.ts client/test/sim/trailhead.test.ts
git commit
```

Message:

```
feat: start a player in front of the car, facing the trail

## What

A player arrived at the pad's centre facing along the road. They arrive now
on the straight line from the car to the trail's entrance, 2.5 m clear of
the car, facing the entrance, so the car is behind them and the trail ahead
however the trail leaves the pad. Over the 227 sweep seeds the car is never
more than 4.07 degrees off directly behind, and the facing never more than
18.63 degrees off the trail's own direction.

## How

- `client/src/sim/spawn.ts` — `trailheadSpawn`, the place and the facing
  from a graph and the car's place; `trailheadStart`, the same from a seed
  on the active terrain, null where the world has no trail.
- `client/src/sim/world.ts` — `pickSpawn` centres its spiral on the start
  and returns the yaw; `spawnPlayer` sets it. A hand-authored level and a
  world with no trail face yaw 0 as before.
- `client/test/sim/spawn.test.ts` — the place and facing on a hand-built
  graph, the start as a function of the seed alone, no start on a world
  with no trail, and two players arriving alike.
- `client/test/sim/trailhead.test.ts` — over the 227 seeds: the car behind,
  the entrance ahead, the gaps to the car's and the board's boxes, and the
  distance from the road.
```

---

### Task 6: The Trail 14 sign

**Files:**
- Modify: `client/src/sim/signs.ts`
- Modify: `client/src/sim/passes/signs.ts`
- Modify: `client/test/sim/signs.test.ts`
- Modify: `client/test/sim/trailhead.test.ts`
- Modify: `client/test/sim/groundGradient.test.ts` (the pass hash, if it moves)

**Interfaces:**
- Consumes: `trailEntrance`, `trailheadSite`, `carSite`, `EntranceGraph` from `sim/passes/trailhead.ts`; `trailheadSpawn` from `sim/spawn.ts`; `Ground` from `sim/boxGap.ts`; `SignPost`, `SignArm`, `SIGN_POST_OFFSET`, `SIGN_POST_HALF`, `signPosts` from `sim/signs.ts`.
- Produces, from `client/src/sim/signs.ts`:
  - `TRAIL_NAME = "Trail 14"`
  - `trailSignSite(graph: EntranceGraph, board: Ground): Ground`
  - `trailSign(graph: EntranceGraph, board: Ground, spawn: Ground): SignPost` — one arm, `names: ["Trail 14"]`, `ranks: [0]`
  - `allSignPosts(graph: TrailGraph, sites: readonly { name: string; x: number; z: number }[], board: Ground, spawn: Ground): SignPost[]` — the junction posts, then the trail sign last.

- [ ] **Step 1: Write the failing tests**

Add to `client/test/sim/signs.test.ts`, with `TRAIL_NAME, allSignPosts, trailSign, trailSignSite` added to its import from `signs.js`:

```ts
describe("the trail's sign", () => {
  // The stem leaves along +x from the pad at the origin: the entrance is
  // (8, 0). The board stands at (2, 7); a player spawns at (1.3, 0).
  const board = { x: 2, z: 7 }, spawn = { x: 1.3, z: 0 };

  it("is named Trail 14", () => {
    expect(TRAIL_NAME).toBe("Trail 14");
  });

  it("stands 1.75 m off the bed at the entrance, on the side farther from the board", () => {
    expect(trailSignSite(graph(1), board)).toEqual({ x: 8, z: -1.75 });
    expect(trailSignSite(graph(1), { x: 2, z: -7 })).toEqual({ x: 8, z: 1.75 });
  });

  it("carries one plank, across the line to the player and pointing away from the bed", () => {
    const post = trailSign(graph(1), board, spawn);
    expect({ x: post.x, z: post.z }).toEqual({ x: 8, z: -1.75 });
    expect(post.arms).toHaveLength(1);
    const arm = post.arms[0]!;
    expect(arm.names).toEqual(["Trail 14"]);
    expect(arm.ranks).toEqual([0]);
    expect(arm.dx).toBeCloseTo(-0.2527158154000624, 9);
    expect(arm.dz).toBeCloseTo(-0.96754055038881, 9);
    // Across the line from the post to the player: the plank's face is toward them.
    const len = Math.hypot(spawn.x - post.x, spawn.z - post.z);
    expect(arm.dx * ((spawn.x - post.x) / len) + arm.dz * ((spawn.z - post.z) / len)).toBeCloseTo(0, 9);
  });

  it("joins the junction posts as the last post", () => {
    const g = graph(2);
    const named = [{ name: "Summit", x: 200, z: 0 }];
    const posts = allSignPosts(g, named, board, spawn);
    expect(posts).toHaveLength(3);
    expect(posts.slice(0, 2)).toEqual(signPosts(g, named));
    expect(posts[2]).toEqual(trailSign(g, board, spawn));
  });
});
```

Add to `client/test/sim/trailhead.test.ts`, with `SIGN_POST_HALF, trailSign, trailSignSite` imported from `../../src/sim/signs.js`:

```ts
describe("the trail's sign on real worlds", () => {
  it("stands in the player's view at the entrance, clear of the bed, the car and the board, on every seed", () => {
    const v = terrainVariant("olympic")!;
    const gapTo = (x: number, z: number, c: { x: number; z: number }, h: { x: number; z: number }): number =>
      Math.hypot(Math.max(Math.abs(x - c.x) - h.x, 0), Math.max(Math.abs(z - c.z) - h.z, 0));
    let widest = 0, nearest = Infinity, farthest = 0, carGap = Infinity, boardGap = Infinity, tipGap = Infinity, road = Infinity, turned = 0;
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const car = carSite(graph, v.roadCenterX!, seed);
      const board = trailheadSite(graph, v.roadCenterX!, seed, "kiosk");
      const s = trailheadSpawn(graph, car);
      const post = trailSign(graph, board, s);
      const arm = post.arms[0]!;
      expect(trailSignSite(graph, board)).toEqual({ x: post.x, z: post.z });
      expect(v.trailDistance!(seed, post.x, post.z), `seed ${seed}`).toBeCloseTo(1.75, 6);
      const d = Math.hypot(post.x - s.x, post.z - s.z);
      const c = ((post.x - s.x) * Math.sin(s.yaw) + (post.z - s.z) * Math.cos(s.yaw)) / d;
      widest = Math.max(widest, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
      nearest = Math.min(nearest, d);
      farthest = Math.max(farthest, d);
      carGap = Math.min(carGap, gapTo(post.x, post.z, car, CAR_HALF));
      boardGap = Math.min(boardGap, gapTo(post.x, post.z, board, KIOSK_HALF));
      // The plank is 1.095 m long: its tip must be farther from the bed than the post.
      tipGap = Math.min(tipGap, v.trailDistance!(seed, post.x + arm.dx * 1.095, post.z + arm.dz * 1.095));
      road = Math.min(road, post.x - roadCenterXOf(seed, post.z));
      turned = Math.max(turned, Math.abs(arm.dx * ((s.x - post.x) / d) + arm.dz * ((s.z - post.z) / d)));
    }
    console.info(`[trailhead] sign: ${widest.toFixed(2)} deg off the view's centre at most, ${nearest.toFixed(2)}-${farthest.toFixed(2)} m from the player, ${carGap.toFixed(2)} m from the car, ${boardGap.toFixed(2)} m from the board, plank tip ${tipGap.toFixed(2)} m from the bed, ${road.toFixed(2)} m from the centreline`);
    expect(widest).toBeLessThanOrEqual(35);
    expect(nearest).toBeGreaterThanOrEqual(3);
    expect(farthest).toBeLessThanOrEqual(7);
    expect(carGap).toBeGreaterThanOrEqual(3);
    expect(boardGap).toBeGreaterThanOrEqual(3);
    expect(tipGap).toBeGreaterThanOrEqual(2.5);
    expect(road).toBeGreaterThanOrEqual(6.5);
    expect(turned).toBeLessThan(1e-9);
  }, timeLimit(300000));

  it("is emitted once as a prop, where it stands", () => {
    for (const seed of [0x5eed, 1, 12345]) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const site = trailSignSite(graph, trailheadSite(graph, v.roadCenterX!, seed, "kiosk"));
      const chunk = chunkHolding(seed, site.x, site.z);
      const emitted = chunk.props.filter((b) => b.material === "signpost" && Math.abs(b.box.min.x + SIGN_POST_HALF.x - site.x) < 1e-6 && Math.abs(b.box.min.z + SIGN_POST_HALF.z - site.z) < 1e-6);
      expect(emitted, `seed ${seed}`).toHaveLength(1);
      expect(emitted[0]!.box.max.y - emitted[0]!.box.min.y).toBeCloseTo(2.2, 6);
    }
  }, timeLimit(60_000));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/signs.test.ts`
Expected: FAIL, `TRAIL_NAME`, `trailSignSite`, `trailSign` and `allSignPosts` are not exported.

- [ ] **Step 3: Write the sign**

In `client/src/sim/signs.ts`, add to the imports:

```ts
import type { Ground } from "./boxGap.js";
import { trailEntrance, type EntranceGraph } from "./passes/trailhead.js";
```

and add after `SUMMIT_LABEL`:

```ts
/** The trail's name, as the sign at its entrance and the poster give it. */
export const TRAIL_NAME = "Trail 14";
```

and at the end of the file:

```ts
/**
 * Where the trail's sign stands: SIGN_POST_OFFSET from the bed's centreline
 * at the entrance, across the trail's direction, on the side farther from
 * the notice board, so the two never crowd each other.
 */
export function trailSignSite(graph: EntranceGraph, board: Ground): Ground {
  const e = trailEntrance(graph);
  const px = -e.dz, pz = e.dx;
  const a = { x: e.x + px * SIGN_POST_OFFSET, z: e.z + pz * SIGN_POST_OFFSET };
  const b = { x: e.x - px * SIGN_POST_OFFSET, z: e.z - pz * SIGN_POST_OFFSET };
  const da = (a.x - board.x) * (a.x - board.x) + (a.z - board.z) * (a.z - board.z);
  const db = (b.x - board.x) * (b.x - board.x) + (b.z - board.z) * (b.z - board.z);
  return da >= db ? a : b;
}

/**
 * The sign at the trail's entrance: one post with one plank that names the
 * trail. The plank runs across the line from the post to where a player
 * arrives, so its face is toward them, and it points away from the bed, so
 * it never hangs over the trail.
 */
export function trailSign(graph: EntranceGraph, board: Ground, spawn: Ground): SignPost {
  const site = trailSignSite(graph, board);
  const e = trailEntrance(graph);
  const vx = spawn.x - site.x, vz = spawn.z - site.z;
  const len = Math.sqrt(vx * vx + vz * vz);
  let dx = len > 0 ? -vz / len : e.dx, dz = len > 0 ? vx / len : e.dz;
  if (dx * (site.x - e.x) + dz * (site.z - e.z) < 0) {
    dx = -dx;
    dz = -dz;
  }
  return { x: site.x, z: site.z, arms: [{ dx, dz, names: [TRAIL_NAME], ranks: [0] }] };
}

/** Every post the game draws: the junction posts, then the trail's sign. */
export function allSignPosts(graph: TrailGraph, sites: readonly NamedSite[], board: Ground, spawn: Ground): SignPost[] {
  return [...signPosts(graph, sites), trailSign(graph, board, spawn)];
}
```

Change the module's header comment's first sentence to: `Wooden sign posts at every junction of the trail graph, one arm per branch and one plank per place: each place named once on a post, on the arm with the shortest trail to it, the Summit on top; and one more post at the trail's entrance, whose one plank names the trail.`

In `client/src/sim/passes/signs.ts`:

```ts
import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import { SIGN_POST_HALF, SIGN_POST_OFFSET, signPostSites, trailSignSite } from "../signs.js";
import { KIOSK_MATERIAL, trailheadSite } from "./trailhead.js";

/** Pass 9. The sign posts' collision boxes, one per junction and one at the
 * trail's entrance, each emitted into the chunk holding the post's centre,
 * like the trailhead pass. The arms and their names are render-only
 * (`game/signMeshes.ts`), so the pass needs the graph and nothing else. */
registerPass({
  id: 9,
  name: "signs",
  get tunables() {
    return { SIGN_POST_OFFSET, SIGN_POST_HALF_X: SIGN_POST_HALF.x, SIGN_POST_HALF_Y: SIGN_POST_HALF.y, TRAIL_SIGNS: 1 };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE, minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
    const sites: { x: number; z: number }[] = [...signPostSites(graph)];
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX !== undefined) {
      sites.push(trailSignSite(graph, trailheadSite(graph, roadCenterX, worldSeed, KIOSK_MATERIAL)));
    }
    for (const p of sites) {
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

`TRAIL_SIGNS: 1` is a count in the pass's tunables: it says the pass emits the trail's sign, so the level id moves with it whether or not a probed chunk holds the post.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/sim/signs.test.ts test/sim/signsSweep.test.ts test/sim/trailhead.test.ts test/game/signMeshes.test.ts`
Expected: PASS. The console shows `[trailhead] sign: 33.48 deg off the view's centre at most, 3.45-6.95 m from the player, 5.76 m from the car, 3.24 m from the board, plank tip 2.72 m from the bed, 6.94 m from the centreline`.

- [ ] **Step 5: Re-pin the pass hash**

Run: `npx vitest run --root client test/sim/groundGradient.test.ts -t "pins passHash"`
Expected: FAIL, with the received value in the message.

Write the received value as the literal, and add above it, with the value this line held after Task 4 in place of `<the value before>`:

```ts
    // Re-baselined 2026-09-28 from <the value before>: a sign post stands
    // at the trail's entrance. TRAIL_SIGNS joins pass 9's tunables
    // (registryDigest moves), and the probe chunk that holds the pad gains
    // the post's box (probeDigest moves). A peer without the post has
    // different collision at the entrance.
```

Run it again. Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add client/src/sim/signs.ts client/src/sim/passes/signs.ts client/test/sim/signs.test.ts client/test/sim/trailhead.test.ts client/test/sim/groundGradient.test.ts
git commit
```

Message:

```
feat: stand a sign at the trail's entrance that names the trail

## What

Nothing marked where the trail leaves the pad. A post stands there now,
1.75 m off the bed on the side farther from the notice board, with one
plank reading "Trail 14". The plank runs across the line to where a player
arrives, so its face is toward them, and points away from the bed. Over
the 227 sweep seeds the sign is 3.45 to 6.95 m from the player and never
more than 33.48 degrees off the centre of their view.

## How

- `client/src/sim/signs.ts` — `TRAIL_NAME`; `trailSignSite`, the post's
  place; `trailSign`, the post with its one arm; `allSignPosts`, the
  junction posts and the trail's sign together.
- `client/src/sim/passes/signs.ts` — pass 9 emits the sign's box with the
  junction posts', and counts it in its tunables.
- `client/test/sim/signs.test.ts` — the place, the side, the plank's
  direction and name on a hand-built graph.
- `client/test/sim/trailhead.test.ts` — over the 227 seeds: in view, near,
  clear of the bed, the car and the board; and the box emitted once.
- `client/test/sim/groundGradient.test.ts` — the pass hash, re-pinned.
```

---

### Task 7: The view starts where the player faces

**Files:**
- Modify: `client/src/game/input.ts`
- Modify: `client/test/game/input.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `InputOptions.startYaw?: number` — the yaw the sampler's look starts at; 0 when absent.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/input.test.ts`, widen the `sampler` helper's parameter type:

```ts
function sampler(opts: { touch?: import("../../src/game/touchControls.js").TouchSource; touchMode?: boolean; startYaw?: number } = {}) {
```

and add:

```ts
describe("the starting yaw", () => {
  it("is the yaw of the first command", () => {
    const { input } = sampler({ startYaw: 1.25 });
    const cmd = input.sample(1);
    expect(cmd.yaw).toBe(1.25);
    expect(cmd.pitch).toBe(0);
  });

  it("is 0 when none is given", () => {
    const { input } = sampler();
    expect(input.sample(1).yaw).toBe(0);
  });

  it("carries the starting yaw while suppressed", () => {
    const { input } = sampler({ startYaw: 1.25 });
    input.setSuppressed(true);
    expect(input.sample(1).yaw).toBe(1.25);
    input.setSuppressed(false);
    expect(input.sample(2).yaw).toBe(1.25);
  });

  it("turns from the starting yaw with the mouse", () => {
    const { input, canvas } = sampler({ startYaw: 1.25 });
    lockPointer(canvas);
    fire("mousemove", { movementX: 100, movementY: 0 });
    expect(input.sample(1).yaw).toBeCloseTo(1.47, 9);
  });

  it("adds a touch look to the starting yaw", () => {
    const touch = {
      moveX: 0, moveZ: 0, sprinting: false,
      takeLook: () => ({ yaw: 0.5, pitch: 0 }),
      takeButtons: () => 0,
    } as unknown as import("../../src/game/touchControls.js").TouchSource;
    const { input } = sampler({ touch, touchMode: true, startYaw: 1.25 });
    expect(input.sample(1).yaw).toBe(1.75);
  });
});
```

(`MOUSE_SENSITIVITY` is 0.0022, so 100 px turns 0.22 rad: 1.25 + 0.22 = 1.47.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/input.test.ts -t "the starting yaw"`
Expected: FAIL. "is the yaw of the first command" receives 0 where it expects 1.25.

- [ ] **Step 3: Give the sampler its starting yaw**

In `client/src/game/input.ts`:

```ts
export type InputOptions = {
  /** Axes, look and buttons from the touch layer, merged into every sample. */
  touch?: TouchSource;
  /** Start in touch mode. `isTouchDevice()` decides; the layer can flip it later. */
  touchMode?: boolean;
  /**
   * The yaw the look starts at: the way the player faces when they arrive.
   * A player's yaw is whatever their input says, so a spawn that faces the
   * trail is turned back to yaw 0 by the first command unless the look
   * starts there too. 0 when absent.
   */
  startYaw?: number;
};
```

and in `createInputSampler`:

```ts
  let yaw = opts.startYaw ?? 0;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/input.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/input.ts client/test/game/input.test.ts
git commit
```

Message:

```
feat: let the input's look start at a given yaw

## What

A player's yaw is whatever their input says, and the input's look started
at 0, so a player who spawned facing the trail would be turned back along
the road by their first command. The input sampler takes the yaw to start
at.

## How

- `client/src/game/input.ts` — `InputOptions.startYaw`, 0 when absent.
- `client/test/game/input.test.ts` — the first command carries it, held
  controls carry it, and the mouse and a touch look turn from it.
```

---

### Task 8: The name, and the game's wiring

**Files:**
- Modify: `client/src/game/posterPanel.ts`
- Modify: `client/src/app.ts`
- Modify: `client/test/game/posterPanel.test.ts`
- Modify: `client/test/game/trailheadMeshes.test.ts:58`
- Modify: `README.md:14`
- Modify: `ARCHITECTURE.md:17`

**Interfaces:**
- Consumes: `TRAIL_NAME`, `allSignPosts` from `sim/signs.ts`; `trailheadStart` from `sim/spawn.ts`; `trailheadSite` from `sim/passes/trailhead.ts`; `InputOptions.startYaw`.
- Produces, from `client/src/game/posterPanel.ts`:
  - `POSTER_LAST_SEEN = "Last seen at Trail 14."`
  - `posterBoardLines(search: Search): string[]` — `["MISSING", <name>, "Last seen at Trail 14."]`

- [ ] **Step 1: Write the failing tests**

`client/test/game/posterPanel.test.ts` becomes:

```ts
import { describe, expect, it } from "vitest";
import { POSTER_LAST_SEEN, posterBoardLines, posterModel } from "../../src/game/posterPanel.js";

const search = { hiker: { name: "Dana Whitcombe" }, body: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }, poster: { x: 0, y: 1, z: 0 }, car: { x: 0, y: 0, z: 0 } };

describe("posterModel", () => {
  it("reads MISSING, the name, and where they were last seen", () => {
    const view = posterModel(search);
    expect(view.title).toBe("MISSING");
    expect(view.name).toBe("Dana Whitcombe");
    expect(view.lines).toEqual(["Last seen at Trail 14.", "If you have seen them, call the ranger station."]);
  });
});

describe("the poster painted on the board", () => {
  it("names the trail as the panel does", () => {
    expect(POSTER_LAST_SEEN).toBe("Last seen at Trail 14.");
    expect(posterBoardLines(search)).toEqual(["MISSING", "Dana Whitcombe", "Last seen at Trail 14."]);
  });
});
```

In `client/test/game/trailheadMeshes.test.ts`, the fixture becomes:

```ts
const LINES = ["MISSING", "Dana Whitcombe", "Last seen at Trail 14."];
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/posterPanel.test.ts`
Expected: FAIL, `POSTER_LAST_SEEN` and `posterBoardLines` are not exported.

- [ ] **Step 3: Write the poster's line**

In `client/src/game/posterPanel.ts`, replace the head of the file down to the end of `posterModel`:

```ts
import type { Search } from "../sim/search.js";
import { TRAIL_NAME } from "../sim/signs.js";

export type PosterView = { title: string; name: string; lines: string[] };

const POSTER_TITLE = "MISSING";
/** Where the hiker was last seen: the one line the panel and the board share. */
export const POSTER_LAST_SEEN = `Last seen at ${TRAIL_NAME}.`;

/** The poster as data: the one missing hiker it names, and where. */
export function posterModel(search: Search): PosterView {
  return {
    title: POSTER_TITLE,
    name: search.hiker.name,
    lines: [POSTER_LAST_SEEN, "If you have seen them, call the ranger station."],
  };
}

/** The lines painted on the notice board: the title, the name, and where. */
export function posterBoardLines(search: Search): string[] {
  return [POSTER_TITLE, search.hiker.name, POSTER_LAST_SEEN];
}
```

- [ ] **Step 4: Wire the game**

In `client/src/app.ts`:

Change the imports:

```ts
import { createPosterPanel, posterBoardLines, posterModel } from "./game/posterPanel.js";
import { allSignPosts } from "./sim/signs.js";
import { trailheadStart } from "./sim/spawn.js";
```

(`allSignPosts` replaces the `signPosts` import.)

Where the input sampler is created, give it the start's yaw:

```ts
  // A player's yaw is whatever their input says, so the look starts where
  // the spawn faces: the trail's entrance. Every peer derives it from the
  // seed, as the sim does, so a follower starts facing the trail too.
  const start = trailheadStart(seed);
  const input = createInputSampler(canvas, { touch: touchModel, touchMode: touchStart, startYaw: start?.yaw ?? 0 });
```

In `createSigns`, draw every post and paint the board from the panel's lines:

```ts
    const posts: SignMeshes = createSignMeshes(
      renderer.scene,
      allSignPosts(graph, signSites(seed, graph.features, hikerFirst, search.body.pos), kiosk, start ?? graph.trailhead),
      groundH,
      { materialFor: (name) => terrainMaterialFor(renderer.scene, name), shadows: renderer.shadows },
    );
```

and in the `createTrailheadMeshes` call:

```ts
        lines: posterBoardLines(search),
```

Update the doc comment on `createSigns` to: `Junction posts and the trail's sign, and the trailhead's car and notice board with the poster on it, from the same seed the sim used.`

- [ ] **Step 5: Change the premise's line**

In `README.md`, line 14 becomes:

```
One hiker is missing, last seen at Trail 14, and the poster at the trailhead is the whole briefing.
```

In `ARCHITECTURE.md`, line 17, replace

```
the poster's face on the trailhead kiosk, the kiosk and the car beside it, and the place at the crest where the body lies (`client/src/sim/search.ts`), the sign posts at the trail's forks, one plank per place, each place once on a post on the arm with the shortest trail to it and the Summit on top (`client/src/sim/signs.ts`),
```

with

```
the poster's face on the trailhead kiosk, the kiosk, the car at the pad and the place at the crest where the body lies (`client/src/sim/search.ts`), where a player arrives and the way they face — in front of the car, toward the trail's entrance (`client/src/sim/spawn.ts`) — the sign posts at the trail's forks, one plank per place, each place once on a post on the arm with the shortest trail to it and the Summit on top, and the post at the trail's entrance that names it Trail 14 (`client/src/sim/signs.ts`),
```

- [ ] **Step 6: Run the tests, typecheck, lint**

Run: `npx vitest run --root client test/game/posterPanel.test.ts test/game/trailheadMeshes.test.ts test/game/signMeshes.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: both clean.

Run: `grep -rn "summit trail" client/src client/test README.md ARCHITECTURE.md`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/posterPanel.ts client/src/app.ts client/test/game/posterPanel.test.ts client/test/game/trailheadMeshes.test.ts README.md ARCHITECTURE.md
git commit
```

Message:

```
feat: open the match facing Trail 14, and name it on the poster

## What

The game gives a player's view the direction they spawn facing, so a match
opens looking at the trail, with its sign in the frame. The sign is drawn
with the junction posts. The poster, on the notice board and in its panel,
reads "Last seen at Trail 14." where it read "the summit trail", and the
README's premise says the same.

## How

- `client/src/app.ts` — reads the start from the seed and gives its yaw to
  the input sampler; draws `allSignPosts`; paints the board from
  `posterBoardLines`.
- `client/src/game/posterPanel.ts` — `POSTER_LAST_SEEN`, built from the
  trail's name and shared by the panel and the board; `posterBoardLines`.
- `client/test/game/posterPanel.test.ts`,
  `client/test/game/trailheadMeshes.test.ts` — the line as it reads now.
- `README.md`, `ARCHITECTURE.md` — the premise's line; where a player
  arrives, and the post at the entrance.
```

---

### Task 9: The watcher's sweep, and the whole suite

**Files:**
- Modify: `client/test/sim/watcherSweep.test.ts` (its floors and its doc comment, if they move)

**Interfaces:**
- Consumes: `watcher-before.txt` from Task 1.
- Produces: the sweep's floors as measured on the changed world.

- [ ] **Step 1: Measure**

Run: `npx vitest run --root client test/sim/watcherSweep.test.ts 2>&1 | tee watcher-after.txt`

Compare the two `[watcher sweep]` blocks: the stands shown, the tries admitted, each refusal's count, each slot's line, and the `never shown:` list.

- [ ] **Step 2: Decide by what moved**

- **Nothing moved** (every line equal): the floors stand. Go to Step 4 with no change to this file.
- **The counts rose or stayed, and the test passes:** raise the two floors (`toBeGreaterThanOrEqual(875)` and `toBeGreaterThanOrEqual(78955)`) to the measured counts, and change the test's name and doc comment to the measured numbers.
- **A count fell:** the test fails. List every stand that is in one `never shown:` list and not the other. For each, say what now cuts or opens its sightline: the car's box at the pad, or the sign's post at the entrance. Only stands at the pad's slot may change; a stand elsewhere that changes is a defect to find, not a floor to lower.

- [ ] **Step 3: Re-pin, with the reason**

Write the measured counts as literals. Add to the end of the test's doc comment a paragraph in the form the last one takes, with the measured numbers and stands:

```
 * Re-pinned 2026-09-28 from 875 shown and 78 955 admitted: the car stands
 * at the pad, 12 m nearer the pad's node than it did, and a sign post
 * stands at the trail's entrance. <Which stands no longer show, or show
 * now, and which box is on each one's sightline.> <N> of 936, the pad <M>
 * of 200, <K> placements admitted and the sightline refusing <S>. No
 * other stand moved.
```

Every `<…>` is replaced by what Step 2 found; a comment with a `<` left in it is not finished.

Run: `npx vitest run --root client test/sim/watcherSweep.test.ts`
Expected: PASS.

- [ ] **Step 4: The whole suite**

Run once, when no other test run and no frame-time measurement is using the machine:

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck and lint clean; the client, server and tools suites all pass. A test that times out in a file this work did not touch is re-run alone (`npx vitest run --root client <file>`) and both results are recorded; a time limit is never edited to make one pass.

- [ ] **Step 5: Commit**

Only if `client/test/sim/watcherSweep.test.ts` changed:

```bash
git add client/test/sim/watcherSweep.test.ts
git commit
```

Message (with the measured numbers in place of the letters):

```
test: re-pin the watcher sweep for the car at the pad

## What

The car and the new sign stand on the pad's sightlines, so the watcher's
sweep was measured again. It shows on N of 936 stands within 120 ticks,
where it showed on 875; every stand that changed is at the pad.

## How

- `client/test/sim/watcherSweep.test.ts` — the floors as measured, and
  which stands moved and what stands on each one's sightline.
```

---

### Task 10: Look at it in the game

The tests prove the geometry. This proves the picture (spec §8.2). It needs a browser on this machine, which other work may be using: ask before starting, and run nothing else meanwhile.

**Files:**
- Create: `docs/trail/<the date this note is written>-trail-14-trailhead-verification.md` (text only: every file under `docs/` is a dated `.md`, so the stills are kept outside the repository)

**Interfaces:**
- Consumes: the built game on this branch.
- Produces: the verification note, which says what each world's still showed.

- [ ] **Step 1: Start the game**

Find two free ports (`lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(51|80)[0-9]{2}"` shows the ones taken), then from the worktree's root:

```bash
PORT=<signaling port> ALLOWED_ORIGINS=http://localhost:<vite port> npm run dev
```

with the vite port and the `/ws` proxy set in `client/vite.config.ts` for the session only; that edit is never staged or committed.

- [ ] **Step 2: Open each world and look**

Open `http://localhost:<vite port>/dayhike/`, press Play, and load each world by the command bar (`/`), `seed <token>`:

| Token | What it shows | Measured (angles from +x, in world axes) |
| --- | --- | --- |
| `hollow` | The world the summit loop was checked on | start (−313.03, −2.40), yaw 2.296 |
| `room-1` | The trail leaves straight inland | the trail leaves at 2.8°, the car at the pad |
| `room-140` | The trail leaves nearly parallel to the road; the board is mirrored | the trail leaves at 87.3°, the facing 18.6° off the trail's direction |
| `room-50` | The same, the other way; the board is not mirrored | the trail leaves at −82.3° |
| `room-19` | The car slides | 3.5 m along the road |
| `room-30` | The board is mirrored | the trail leaves at 56.1° |

On each, before any input, take a still. Then check:

1. The trail and the sign are in the frame.
2. The sign reads `Trail 14`, the right way round, and can be read from where the player stands.
3. The plank does not hang over the bed.
4. Turning round shows the car directly behind.
5. The poster on the board and its panel (Interact at the board) read `Last seen at Trail 14.`

- [ ] **Step 3: Two players**

Create a party on one page, open its invite link on a second page, and start the match. Both players arrive facing the trail, and each sees the other standing in the same place.

- [ ] **Step 4: Write the note**

`docs/trail/<date>-trail-14-trailhead-verification.md`: the commit looked at, the browser and its renderer string, and for each world what its still showed and the five checks, each met or missed. A check that is missed is reported as missed with what was seen; it is not re-worded into a pass.

If the sign's lettering cannot be read from the spawn on any world, say so with the still: the spec's boundary (§9) leaves a larger sign to a model made for the trailhead, and that becomes the next piece of work.

- [ ] **Step 5: Revert the session's edit and commit the note alone**

```bash
git checkout -- client/vite.config.ts
git status --short   # only the note
git add docs/trail/<date>-trail-14-trailhead-verification.md
git commit
```

Message:

```
docs: record the trailhead as it looks in the game

## What

The trailhead's new layout was looked at in the running game on six worlds
and with two players in one match. The note says what each view showed.

## How

- `docs/trail/<date>-trail-14-trailhead-verification.md` — the commit, the
  browser, and for each world the view on arrival, the sign's lettering,
  the plank clear of the bed, the car behind, and the poster's line.
```
