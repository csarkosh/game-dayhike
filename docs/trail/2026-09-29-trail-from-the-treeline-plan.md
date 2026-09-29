# The Trail from the Treeline Implementation Plan

**Goal:** At the trailhead the forest comes down to the road: a player arrives with grass underfoot and trees ahead, the board stands beside the trail's start, and the trail goes straight back into the forest. No trail runs on sand.

**Architecture:** A strip inland of the pad, a pure function of a place in the road's own frame (`sim/shoreStrip.ts`), is read by every rule that tells shore from forest by the ground's height: trees, grass, bushes, rocks, stumps, the sand's paint and the animals' ground. The ground's shape does not change. The trail's search is closed to shore ground but for two rows of cells straight inland of the pad (`closeShore` in `sim/trailGrid.ts`), so the stem leaves the pad inland. The board's place is judged by its further end against the way the player faces.

**Tech Stack:** TypeScript, vitest, Babylon.js (the game layer only). `sim/` determinism rules: no trig, no `Math.pow`, no `**`, no `Math.hypot` in `sim/`; `Math.sqrt` for lengths; directions as unit vectors.

**Spec:** `docs/trail/2026-09-29-trail-from-the-treeline.md`. Read it first; this plan argues from it.

## Global Constraints

- Work in the worktree `.claude/worktrees/treeline-impl` on branch `worktree-treeline-impl`. Stage explicit paths only; never `git add -A` or `git add .`. Never use bare `git stash`.
- Commit messages use the repository's `## What` / `## How` shape (`.agents/skills/github-push/SKILL.md`): a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list with backticked paths, then the trailers.
- The repository is public. Code, comments, test names, docs and commit messages describe the change and its measurements, and nothing about how the work was organised.
- The repository's pre-push scan runs after every commit and must report nothing failing.
- Every numeric test expectation is a literal, never computed from the code under test.
- Every explicit test time limit goes through `timeLimit(<ms>)` from `client/test/helpers/timeLimit.ts`.
- `sim/` never imports `net/`, `game/` or Babylon (ESLint enforces it).
- Protocol 5 stands.
- The ground's shape, the road, its cleared strip, the pad, the car's rule and the rule for where a player arrives do not change.
- Constants, copied from the spec: `STRIP_HALF` 30, `STRIP_EDGE` 15, `STRIP_REACH` 100, `STRIP_FADE` 20, `STRIP_LIFT` 9, `STRIP_FOREST_FLOOR` 0.6, `SHORE_GATE_ALT` 9, `SHORE_GATE_U` 30, `DOORWAY_HALF` 4, `TRAILHEAD_CLEARING` 24, `GEN_VERSION` 8.
- Outside the strip every rule returns what it returned before, bit for bit: `shoreHeight` hands back the height it was given, the same number, where the strip's weight is 0.
- A sweep over the 227 seeds is one core for about two minutes. Run one at a time, and never beside a frame-time measurement.
- A pinned value that moves is read from a run of the changed code and written as a literal, with a dated comment saying what it was and why it moved, as `client/test/sim/groundGradient.test.ts` already does.
- **The pass hash** is pinned in `client/test/sim/groundGradient.test.ts` and `client/test/game/tierDeterminism.test.ts`. Tasks 1, 2, 3, 6, 7 and 8 each move it. Each of those tasks re-pins it in both files in its own commit, from its own failing run; the value is never carried from one task to the next.
- **From Task 6 to Task 9 the tests that follow the trail's route are red.** Task 6 moves the trail on most worlds, and the tests that name a world's nodes, forks and counts are re-derived in Task 9. Tasks 6, 7 and 8 run the files they name and leave the rest to Task 9. Nothing is pushed before Task 10.

## Inputs the tests must also cover

Inputs the spec implies and a person will meet. Each has its test in the task that owns the code.

1. **A world with no road, or no world registered at all.** The strip is nothing there and every rule reads the ground's own height; nothing throws (Task 1, "is nothing on a world with no road").
2. **Ground seaward of the road, opposite the pad.** The beach stays sand: the strip is nothing at and seaward of the centreline (Task 1, "is nothing at the road's centreline and seaward of it").
3. **A world whose raggedness leaves the strip bare.** A wood still stands there, by the floor (Task 2, "stands a wood in the strip where the raggedness would leave none").
4. **A doorway cell too steep to walk.** It stays closed: the doorway opens nothing (Task 6, "opens no cell").
5. **A trail that leaves the pad at the widest angle the doorway allows.** The whole board is still in an upright phone's first frame (Task 7, "judges the board by its further end against the way the player faces").

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/shoreStrip.ts` | New. The strip's weight at a place, the height the shore's rules read, the constants. |
| `client/src/sim/passes/trailhead.ts` | Pass 8 declares the strip's constants among its tunables. |
| `client/src/sim/vegetation.ts` | The forest's shore rule reads the strip; the floor on its density. |
| `client/src/sim/clutter.ts` | Grass, bushes, rocks, stumps and mushrooms read the strip; the trailhead's clearing. |
| `client/src/game/terrainSurface.ts` | The sand's paint reads the strip. |
| `client/src/game/wildlifeField.ts` | The animals' ground reads the strip. |
| `client/src/sim/trailGrid.ts` | `closeShore` and its three constants. |
| `client/src/sim/trailBuild.ts` | Calls `closeShore` wherever it re-opens the pad's ring. |
| `client/src/sim/facing.ts` | `facingDir`: the direction a yaw faces. |
| `client/src/sim/trailhead.ts` | `boardSite` judges a place by the board's further end. |
| `client/src/sim/forest.ts` | `GEN_VERSION` 8; the probe's record. |
| `client/test/sim/shoreStrip.test.ts` | New. |
| `client/test/sim/treeline.test.ts` | New. The spec's clauses over the 227 seeds. |
| `client/test/game/terrainSurfaceStrip.test.ts` | New. The paint in and out of the strip, on a real world. |
| `ARCHITECTURE.md` | The strip and the doorway, where the trail's build is described. |
| `docs/trail/2026-09-29-trail-from-the-treeline-verification.md` | New, in Task 11. |

Points on the world `hollow` (seed 2032433950) that the tests below use. The road's centreline is at x = -322.7267739768348 where z = 0, at x = -327.06319004698264 where z = 60, and at x = -325.66117205148345 where z = 38. The pad's centre is (-313.7267739768348, 0).

| Name | x | z | From the centreline | The ground | The strip's weight |
| --- | --- | --- | --- | --- | --- |
| the pad | -313.7267739768348 | 0 | 9 m | 3.0155 m | 1 |
| under the pavement | -319.7267739768348 | 0 | 3 m | 3.0169 m | 0.567994 |
| the verge | -302.7267739768348 | 0 | 20 m | 3.59 m | 1 |
| the verge, north | -304.3229187813898 | 20 | 20 m | 4.2029 m | 1 |
| past the road's strip | -291.7267739768348 | 0 | 31 m | 5.8899 m | 1 |
| the strip's edge | -305.66117205148345 | 38 | 20 m | 4.2139 m | 0.450074 |
| sand, north | -307.06319004698264 | 60 | 20 m | 4.2177 m | 0 |
| sand, north and inland | -287.06319004698264 | 60 | 40 m | 7.1664 m | 0 |
| the beach | -332.7267739768348 | 0 | -10 m | 2.9873 m | 0 |

The trail's bed runs down the pad's line, so what grows on "the verge" depends on where the trail is, and the trail moves in Task 6. "The verge, north" is 18 m and more from any trail before and after, and is the point the tests of what grows use.

---

### Task 1: The strip

**Files:**
- Create: `client/src/sim/shoreStrip.ts`
- Create: `client/test/sim/shoreStrip.test.ts`
- Modify: `client/src/sim/passes/trailhead.ts`
- Modify: `client/test/sim/groundGradient.test.ts`, `client/test/game/tierDeterminism.test.ts` (the pass hash)

**Interfaces:**
- Consumes: `TRAIL_Z_ANCHOR` (`sim/bowl.ts`), `ROAD_BED_HALF` (`sim/road.ts`), `terrainVariant`, `activeTerrainVariantName` (`sim/terrain.ts`).
- Produces: `shoreStripAt(u: number, w: number): number`, `shoreStrip(seed: number, x: number, z: number): number`, `shoreHeight(seed: number, x: number, z: number, h: number): number`, `STRIP_HALF`, `STRIP_EDGE`, `STRIP_REACH`, `STRIP_FADE`, `STRIP_LIFT`, `STRIP_FOREST_FLOOR`, `SHORE_STRIP_TUNABLES`.

- [ ] **Step 1: Write the failing tests**

`client/test/sim/shoreStrip.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { registeredPasses } from "../../src/sim/chunk.js";
import {
  SHORE_STRIP_TUNABLES, STRIP_EDGE, STRIP_FADE, STRIP_FOREST_FLOOR, STRIP_HALF, STRIP_LIFT, STRIP_REACH,
  shoreHeight, shoreStrip, shoreStripAt,
} from "../../src/sim/shoreStrip.js";

const HOLLOW = 2032433950;
afterEach(() => setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT));

describe("shoreStripAt", () => {
  it("is whole at the pad and 30 m along the road to either side, and gone 45 m along it", () => {
    expect(shoreStripAt(9, 0)).toBe(1);
    expect(shoreStripAt(9, 30)).toBe(1);
    expect(shoreStripAt(9, 37.5)).toBe(0.5);
    expect(shoreStripAt(9, 45)).toBe(0);
    expect(shoreStripAt(9, 200)).toBe(0);
  });

  it("is whole 100 m inland and gone 120 m inland", () => {
    expect(shoreStripAt(100, 0)).toBe(1);
    expect(shoreStripAt(110, 0)).toBe(0.5);
    expect(shoreStripAt(120, 0)).toBe(0);
  });

  it("is nothing at the road's centreline and seaward of it, and rises across the bed", () => {
    expect(shoreStripAt(0, 0)).toBe(0);
    expect(shoreStripAt(-1, 0)).toBe(0);
    expect(shoreStripAt(-40, 0)).toBe(0);
    expect(shoreStripAt(2.75, 0)).toBe(0.5);
    expect(shoreStripAt(5.5, 0)).toBe(1);
  });

  it("is the product of the two where both fade", () => {
    expect(shoreStripAt(60, 40)).toBeCloseTo(0.259259, 6);
    expect(shoreStripAt(105, 35)).toBeCloseTo(0.625, 9);
  });

  it("declares its constants", () => {
    expect([STRIP_HALF, STRIP_EDGE, STRIP_REACH, STRIP_FADE, STRIP_LIFT, STRIP_FOREST_FLOOR]).toEqual([30, 15, 100, 20, 9, 0.6]);
    expect(Object.keys(SHORE_STRIP_TUNABLES).sort()).toEqual(["STRIP_EDGE", "STRIP_FADE", "STRIP_FOREST_FLOOR", "STRIP_HALF", "STRIP_LIFT", "STRIP_REACH"]);
    const pass8 = registeredPasses().find((p) => p.id === 8)!;
    for (const [key, value] of Object.entries(SHORE_STRIP_TUNABLES)) expect(pass8.tunables[key], key).toBe(value);
  });
});

describe("shoreStrip on the world `hollow`", () => {
  it("is measured from the road's own centreline, wherever the road bends", () => {
    setActiveTerrainVariant("olympic");
    expect(shoreStrip(HOLLOW, -313.7267739768348, 0)).toBe(1);
    expect(shoreStrip(HOLLOW, -319.7267739768348, 0)).toBeCloseTo(0.567994, 6);
    expect(shoreStrip(HOLLOW, -305.66117205148345, 38)).toBeCloseTo(0.450074, 6);
    expect(shoreStrip(HOLLOW, -307.06319004698264, 60)).toBe(0);
    expect(shoreStrip(HOLLOW, -332.7267739768348, 0)).toBe(0);
  });

  it("is nothing on a world with no road", () => {
    setActiveTerrainVariant("montane");
    expect(shoreStrip(HOLLOW, 0, 0)).toBe(0);
    expect(shoreHeight(HOLLOW, 0, 0, 3)).toBe(3);
  });
});

describe("shoreHeight", () => {
  it("adds 9 m where the strip is whole, and hands back the height it was given where there is none", () => {
    setActiveTerrainVariant("olympic");
    expect(shoreHeight(HOLLOW, -313.7267739768348, 0, 3)).toBe(12);
    expect(shoreHeight(HOLLOW, -305.66117205148345, 38, 4)).toBeCloseTo(8.050667, 6);
    const h = 4.217712345;
    expect(shoreHeight(HOLLOW, -307.06319004698264, 60, h)).toBe(h);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/shoreStrip.test.ts`
Expected: FAIL, the module `../../src/sim/shoreStrip.js` cannot be found.

- [ ] **Step 3: Write the strip**

`client/src/sim/shoreStrip.ts`:

```ts
/**
 * The strip where the forest comes down to the road, at the trailhead.
 *
 * The road runs along the shore through ground low enough to be painted as
 * sand and to grow nothing, and the trailhead's pad stands in it. Inland of
 * the pad, for a way to either side of it, the shore's rules read the ground
 * as higher than it is, so grass and trees grow down to the road's verge
 * there. The ground's shape is not changed: only what the rules for sand,
 * grass, bushes, rocks and trees make of its height.
 *
 * A function of a place in the road's own frame and of nothing else: it
 * does not read the trail's graph, so the forest, the ground's cover and
 * the trail's search can each read it without waiting on another.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */
import { TRAIL_Z_ANCHOR } from "./bowl.js";
import { ROAD_BED_HALF } from "./road.js";
import { activeTerrainVariantName, terrainVariant } from "./terrain.js";

/** Along the road from the pad, to either side, the strip is whole (m). */
export const STRIP_HALF = 30;
/** Past that it fades out over this (m): the forest thins into the sand. */
export const STRIP_EDGE = 15;
/** Inland of the road's centreline the strip is whole to here (m). */
export const STRIP_REACH = 100;
/** Past that it fades out over this (m). */
export const STRIP_FADE = 20;
/** What the shore's rules add to the ground's height where the strip is whole (m). */
export const STRIP_LIFT = 9;
/** The least the forest's density is where the strip is whole and the road's verge is cleared. */
export const STRIP_FOREST_FLOOR = 0.6;

export const SHORE_STRIP_TUNABLES: Readonly<Record<string, number>> = {
  STRIP_HALF, STRIP_EDGE, STRIP_REACH, STRIP_FADE, STRIP_LIFT, STRIP_FOREST_FLOOR,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/**
 * The strip's weight at `u` metres inland of the road's centreline and `w`
 * metres along the road from the pad, without its sign. Nothing seaward of
 * the centreline; it rises across the road's bed, under the pavement.
 */
export function shoreStripAt(u: number, w: number): number {
  if (u <= 0 || u >= STRIP_REACH + STRIP_FADE || w >= STRIP_HALF + STRIP_EDGE) return 0;
  const along = 1 - smoothstep(STRIP_HALF, STRIP_HALF + STRIP_EDGE, w);
  const inland = smoothstep(0, ROAD_BED_HALF, u) * (1 - smoothstep(STRIP_REACH, STRIP_REACH + STRIP_FADE, u));
  return along * inland;
}

/** The strip's weight at a place: 0 on a world with no road, and where no world is registered at all. */
export function shoreStrip(seed: number, x: number, z: number): number {
  const dz = z - TRAIL_Z_ANCHOR;
  const w = dz < 0 ? -dz : dz;
  if (w >= STRIP_HALF + STRIP_EDGE) return 0;
  const centre = terrainVariant(activeTerrainVariantName())?.roadCenterX?.(seed, z);
  if (centre === undefined) return 0;
  return shoreStripAt(x - centre, w);
}

/** The height the shore's rules read at a place whose ground is `h` high: `h` itself outside the strip. */
export function shoreHeight(seed: number, x: number, z: number, h: number): number {
  const s = shoreStrip(seed, x, z);
  return s === 0 ? h : h + STRIP_LIFT * s;
}
```

In `client/src/sim/passes/trailhead.ts`, import `SHORE_STRIP_TUNABLES` from `"../shoreStrip.js"` and spread it last into pass 8's `tunables`:

```ts
      BOARD_BOX_STEP, BOARD_BOXES,
      ...SHORE_STRIP_TUNABLES,
    };
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --root client test/sim/shoreStrip.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Re-pin the pass hash**

Run: `npx vitest run --root client test/sim/groundGradient.test.ts test/game/tierDeterminism.test.ts`
Expected: FAIL on the two lines that pin 992778962, each printing the new value. Write that value in both files, and add to the comment above the pin in `groundGradient.test.ts`, in the form its last entry takes:

```
   * 2026-09-29: <new value>, from 992778962. Pass 8 declares the strip where
   * the forest comes down to the road (`shoreStrip.ts`), six constants.
```

Run both files again. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/sim/shoreStrip.ts client/test/sim/shoreStrip.test.ts client/src/sim/passes/trailhead.ts client/test/sim/groundGradient.test.ts client/test/game/tierDeterminism.test.ts
git commit
```

Message:

```
feat: add the strip where the forest comes down to the road

## What

The road runs through ground low enough to be sand, and the trailhead's
pad stands in it. A strip inland of the pad is defined in which the
shore's rules will read the ground as 9 m higher than it is: whole for
30 m along the road to either side of the pad and 100 m inland, fading
out over 15 m and 20 m, and nothing at the road's centreline and seaward
of it. Nothing reads it yet. Its constants join the level id.

## How

- `client/src/sim/shoreStrip.ts` — `shoreStripAt` in the road's frame,
  `shoreStrip` at a place, `shoreHeight`, which hands back the height it
  was given where the strip is nothing.
- `client/src/sim/passes/trailhead.ts` — pass 8 declares the constants.
- `client/test/sim/shoreStrip.test.ts` — the weight at the pad, along
  the road, inland, seaward and across the bed; on a real world whose
  road bends; on a world with no road.
- `client/test/sim/groundGradient.test.ts`,
  `client/test/game/tierDeterminism.test.ts` — the pass hash.
```

---

### Task 2: The forest reads the strip

**Files:**
- Modify: `client/src/sim/vegetation.ts`
- Modify: `client/test/sim/vegetation.test.ts`
- Modify: `client/test/sim/groundGradient.test.ts`, `client/test/game/tierDeterminism.test.ts` (the pass hash, and the tree census)

**Interfaces:**
- Consumes: `shoreStrip`, `STRIP_LIFT`, `STRIP_FOREST_FLOOR` from Task 1.
- Produces: `forestDensityUnmasked` and `forestDensity` with the same signatures, reading the strip.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/vegetation.test.ts` (it already imports `forestDensityUnmasked`, `treesInRect` and `setActiveTerrainVariant`):

```ts
describe("the forest in the strip at the trailhead", () => {
  const HOLLOW = 2032433950;

  it("grows on ground the shore rule would leave bare, inland of the pad", () => {
    setActiveTerrainVariant("olympic");
    // 20 m from the centreline, 20 m along the road from the pad, on ground 4.20 m up, read as 13.20 m.
    // The ground's own height would put it at the shore gate's foot; the road's gate is what is left.
    expect(forestDensityUnmasked(HOLLOW, -304.3229187813898, 20)).toBeCloseTo(0.712015, 6);
    // 31 m from it, on ground 5.89 m up.
    expect(forestDensityUnmasked(HOLLOW, -291.7267739768348, 0)).toBe(1);
  });

  it("keeps the road's verge clear, and the beach bare", () => {
    setActiveTerrainVariant("olympic");
    // The pad, 9 m from the centreline: inside ROAD_CLEAR.
    expect(forestDensityUnmasked(HOLLOW, -313.7267739768348, 0)).toBe(0);
    // 10 m seaward of the centreline.
    expect(forestDensityUnmasked(HOLLOW, -332.7267739768348, 0)).toBe(0);
  });

  it("is what it was outside the strip", () => {
    setActiveTerrainVariant("olympic");
    // 60 m along the road from the pad, 20 m from the centreline, 4.22 m up.
    expect(forestDensityUnmasked(HOLLOW, -307.06319004698264, 60)).toBeCloseTo(0.010709, 6);
  });

  it("stands a wood in the strip where the raggedness would leave none", () => {
    setActiveTerrainVariant("olympic");
    // Seed 24301, 40 m from the centreline on the pad's line: 11.50 m up, a slope of 0.207,
    // the road's gate wide open. The raggedness gives less than the floor there.
    expect(forestDensityUnmasked(24301, -190.2775522776278, 0)).toBe(0.6);
  });

  it("stands trees within 40 m of the pad", () => {
    setActiveTerrainVariant("olympic");
    const near = treesInRect(HOLLOW, -353.7267739768348, -40, -273.7267739768348, 40)
      .filter((t) => Math.hypot(t.x + 313.7267739768348, t.z) <= 40);
    expect(near).toHaveLength(8);
    expect(Math.min(...near.map((t) => Math.hypot(t.x + 313.7267739768348, t.z)))).toBeCloseTo(14.798, 3);
  });
});
```

The last test counts 8 with this task in place. No tree stands within 8 m of a trail, and the trail moves in Task 6, where the count is 6 and Task 6 re-pins it.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/vegetation.test.ts -t "the forest in the strip"`
Expected: FAIL. "grows on ground the shore rule would leave bare" reads less than 0.712015 at the first point and less than 1 at the second; "stands a wood in the strip" reads less than 0.6; "stands trees within 40 m" counts fewer than 8. "keeps the road's verge clear" and "is what it was outside the strip" pass already: they hold what must not change.

- [ ] **Step 3: Read the strip in the forest's shore rule**

In `client/src/sim/vegetation.ts`, import from the strip:

```ts
import { shoreStrip, STRIP_FOREST_FLOOR, STRIP_LIFT } from "./shoreStrip.js";
```

and in `forestDensityUnmasked` replace the body from the early return to the end:

```ts
  // The shore's rule reads the strip's height (`shoreStrip.ts`): the ground's own, but inland of the pad.
  const strip = shoreStrip(seed, x, z);
  const sh = strip === 0 ? s.h : s.h + STRIP_LIFT * strip;
  if (sh < SHORE_ALT || d < SHORE_D || r < ROAD_CLEAR) return 0;
  const slope = Math.sqrt(s.dx * s.dx + s.dz * s.dz);
  const alt = 1 - smoothstep(TREELINE_LO, TREELINE_HI, s.h);
  const grade = 1 - smoothstep(SLOPE_LO, SLOPE_HI, slope);
  const shore =
    smoothstep(SHORE_ALT, SHORE_ALT + SHORE_ALT_FADE, sh) *
    smoothstep(SHORE_D, SHORE_D + SHORE_D_FADE, d);
  const road = smoothstep(ROAD_CLEAR, ROAD_CLEAR + ROAD_CLEAR_FADE, r);
  const rag = smoothstep(RAG_LO, RAG_HI, fbm2(x / RAG_WAVELENGTH, z / RAG_WAVELENGTH, seed ^ RAG_SALT, RAG_OCTAVES));
  const valley = 1 + (VALLEY_DENSITY_BOOST - 1) * (1 - Math.min(1, s.h / TREELINE_HI));
  const rho = Math.min(1, alt * grade * shore * road * rag * valley);
  if (strip === 0) return rho;
  // A floor, as a carved stand has one: a wood stands in the strip whatever the raggedness says there.
  return Math.max(rho, STRIP_FOREST_FLOOR * strip * road);
```

Add one sentence to the module's opening comment, after the list of gates: "Inland of the trailhead's pad the shore gate reads the strip's height, and the density has a floor there (`shoreStrip.ts`)."

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --root client test/sim/vegetation.test.ts`
Expected: PASS, every test in the file.

- [ ] **Step 5: Re-pin what follows the trees**

Run: `npx vitest run --root client test/sim/groundGradient.test.ts test/game/tierDeterminism.test.ts`

Expected: FAIL on the pass hash in both files, and on "keeps every tree field bit-identical" in `groundGradient.test.ts` (its census hash was 1979230377). Read that test before re-pinning it: its census window takes in the strip, so the hash moves because trees were added, and the test's claim becomes "bit-identical outside the strip". Write the new values as literals with dated comments that say the strip added trees inside the window, and how many the window holds now against before (the test prints both counts; if it does not, print them).

Run both files again. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/sim/vegetation.ts client/test/sim/vegetation.test.ts client/test/sim/groundGradient.test.ts client/test/game/tierDeterminism.test.ts
git commit
```

Message:

```
feat: grow the forest down to the road at the trailhead

## What

Trees grew only on ground 4 m up and more, and the ground by the road is
lower than that, so the trailhead stood on open sand with the forest
some way off. Inland of the pad the forest's shore rule now reads the
strip's height, and its density there is at least 0.6 of the strip's
weight times the road's own gate, so a wood stands there on a world
whose raggedness would leave it bare. The road's verge stays clear for
12 m, and the forest outside the strip is as it was.

## How

- `client/src/sim/vegetation.ts` — `forestDensityUnmasked` reads the
  strip in its shore gate and takes the floor.
- `client/test/sim/vegetation.test.ts` — the density in the strip, on
  the verge, on the beach and outside the strip; the floor on a world
  that needs it; the trees within 40 m of the pad.
- `client/test/sim/groundGradient.test.ts`,
  `client/test/game/tierDeterminism.test.ts` — the pass hash and the
  tree census.
```

---

### Task 3: The ground's cover reads the strip, and the trailhead has a clearing

**Files:**
- Modify: `client/src/sim/clutter.ts`
- Modify: `client/test/sim/clutter.test.ts`
- Modify: `client/test/sim/groundGradient.test.ts`, `client/test/game/tierDeterminism.test.ts`

**Interfaces:**
- Consumes: `shoreHeight` from Task 1; `TRAIL_Z_ANCHOR`, `TRAILHEAD_U` from `sim/bowl.ts`.
- Produces: `TRAILHEAD_CLEARING` (24), in `CLUTTER_TUNABLES`. `clutterDensity` and `clutterInCell` keep their signatures.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/clutter.test.ts`, importing `TRAILHEAD_CLEARING`, `CLUTTER_ROCK`, `CLUTTER_BOULDER`, `CLUTTER_FUNGUS`, `CLUTTER_BUSH`, `CLUTTER_GRASS`, `clutterDensity` and `clutterInRect` where the file does not already:

```ts
describe("the ground's cover in the strip at the trailhead", () => {
  const HOLLOW = 2032433950;
  const PAD_X = -313.7267739768348;

  it("grows grass, bushes, rocks and stumps on ground the shore rule would leave bare", () => {
    setActiveTerrainVariant("olympic");
    // 20 m from the centreline, 20 m along the road from the pad, on ground 4.20 m up.
    expect(clutterDensity(HOLLOW, CLUTTER_GRASS, -304.3229187813898, 20)).toBeCloseTo(1.074327, 6);
    expect(clutterDensity(HOLLOW, CLUTTER_BUSH, -304.3229187813898, 20)).toBeCloseTo(0.95, 6);
    expect(clutterDensity(HOLLOW, CLUTTER_ROCK, -304.3229187813898, 20)).toBeCloseTo(0.403524, 6);
    expect(clutterDensity(HOLLOW, CLUTTER_FUNGUS, -304.3229187813898, 20)).toBe(1);
  });

  it("thins with the strip at its edge", () => {
    setActiveTerrainVariant("olympic");
    // 38 m along the road from the pad: the strip's weight is 0.450074 and the ground reads 8.26 m.
    expect(clutterDensity(HOLLOW, CLUTTER_GRASS, -305.66117205148345, 38)).toBeCloseTo(0.190756, 6);
    expect(clutterDensity(HOLLOW, CLUTTER_BUSH, -305.66117205148345, 38)).toBeCloseTo(0.224806, 6);
  });

  it("is what it was outside the strip: nothing, on the sand", () => {
    setActiveTerrainVariant("olympic");
    for (const cls of [CLUTTER_GRASS, CLUTTER_BUSH, CLUTTER_ROCK, CLUTTER_FUNGUS]) {
      expect(clutterDensity(HOLLOW, cls, -307.06319004698264, 60), `class ${cls}`).toBe(0);
      expect(clutterDensity(HOLLOW, cls, -332.7267739768348, 0), `class ${cls} on the beach`).toBe(0);
    }
  });

  it("stands nothing tall within 24 m of the pad's centre", () => {
    setActiveTerrainVariant("olympic");
    expect(TRAILHEAD_CLEARING).toBe(24);
    const nearest = (cls: number): number => {
      const all = clutterInRect(HOLLOW, cls, PAD_X - 60, -60, PAD_X + 60, 60);
      return all.reduce((least, c) => Math.min(least, Math.hypot(c.x - PAD_X, c.z)), Infinity);
    };
    // Bushes stand thick in the strip: some 277 in the 120 m square about the pad, none in the clearing.
    expect(clutterInRect(HOLLOW, CLUTTER_BUSH, PAD_X - 60, -60, PAD_X + 60, 60).length).toBeGreaterThan(200);
    expect(nearest(CLUTTER_BUSH)).toBeCloseTo(24.058, 3);
    expect(nearest(CLUTTER_FUNGUS)).toBeCloseTo(24.44, 3);
    expect(nearest(CLUTTER_ROCK)).toBeCloseTo(26.947, 3);
    expect(nearest(CLUTTER_BOULDER)).toBe(Infinity);
  });

  it("leaves the grass in the clearing", () => {
    setActiveTerrainVariant("olympic");
    const grass = clutterInRect(HOLLOW, CLUTTER_GRASS, PAD_X, -12, PAD_X + 24, 12);
    expect(grass.length).toBeGreaterThan(0);
  });
});
```

The three nearest distances are the same before the trail moves in Task 6 and after it; the bushes in the square are 277 before and 276 after, which is why their count is a floor and not a literal.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/clutter.test.ts -t "the ground's cover in the strip"`
Expected: FAIL. `TRAILHEAD_CLEARING` is not exported; with it stubbed, the first two tests read 0 and the fourth finds bushes nearer than 24 m.

- [ ] **Step 3: Read the strip, and keep the clearing**

In `client/src/sim/clutter.ts`:

```ts
import { shoreHeight } from "./shoreStrip.js";
import { TRAIL_Z_ANCHOR, TRAILHEAD_U } from "./bowl.js";
```

In `groundCoverAt`, the low edge of the grass's altitude gate reads the strip; the high edge, which is the snow's, reads the ground:

```ts
  const alt =
    smoothstep(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, shoreHeight(seed, x, z, s.h)) *
    (1 - smoothstep(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h));
```

In `clutterDensity`, the rock case:

```ts
    case CLUTTER_ROCK: {
      const sh = shoreHeight(seed, x, z, s.h);
      if (sh < CLUTTER_ROCK_ALT_LO || r < CLUTTER_ROCK_ROAD_NEAR) return 0;
      const alt = smoothstep(CLUTTER_ROCK_ALT_LO, CLUTTER_ROCK_ALT_LO + CLUTTER_ROCK_ALT_LO_FADE, sh);
```

the fungus case's altitude factor:

```ts
      const alt = smoothstep(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, shoreHeight(seed, x, z, s.h));
```

and the bush case, at its early return and at the low edge of its altitude gate:

```ts
    case CLUTTER_BUSH: {
      const sh = shoreHeight(seed, x, z, s.h);
      if (sh < CLUTTER_BUSH_ALT_LO || r < CLUTTER_BUSH_ROAD_NEAR) return 0;
```

```ts
      const alt =
        smoothstep(CLUTTER_BUSH_ALT_LO, CLUTTER_BUSH_ALT_LO + CLUTTER_BUSH_ALT_LO_FADE, sh) *
        (1 - smoothstep(CLUTTER_BUSH_ALT_HI, CLUTTER_BUSH_ALT_HI + CLUTTER_BUSH_ALT_HI_FADE, s.h));
```

Driftwood is left reading the ground's height (spec §3.2).

The clearing. Add to `ClassConfig`:

```ts
  /** Whether it is kept out of the trailhead's clearing (`TRAILHEAD_CLEARING`). */
  standsTall?: boolean;
```

set `standsTall: true` on the rock, boulder, fungus and bush rows of `CLASSES`, and above `clutterCell`:

```ts
/** Nothing that stands tall grows within this of the pad's centre (m): where a player arrives, the entrance and the board. */
export const TRAILHEAD_CLEARING = 24;
function inTrailheadClearing(seed: number, x: number, z: number): boolean {
  const dz = z - TRAIL_Z_ANCHOR;
  if (dz >= TRAILHEAD_CLEARING || dz <= -TRAILHEAD_CLEARING) return false;
  const centre = activeTerrainVariant().roadCenterX?.(seed, TRAIL_Z_ANCHOR);
  if (centre === undefined) return false;
  const dx = x - (centre + TRAILHEAD_U);
  return dx * dx + dz * dz < TRAILHEAD_CLEARING * TRAILHEAD_CLEARING;
}
```

In `clutterInCell`, after the trail's own rejection and before the ground is sampled, reject the instance by its own place, as the trail's rule does:

```ts
  if (cfg.standsTall && inTrailheadClearing(seed, x, z)) return null;
```

Add `TRAILHEAD_CLEARING` as the last entry of `CLUTTER_TUNABLES`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --root client test/sim/clutter.test.ts`
Expected: the five new tests pass. Two older tests in the file fail and are this task's to answer:

- "puts no duff on sand or rock, and on the bed's core only the drifts" read 0.0617 where it expected 0 with every task in place: one of its sand points is in the strip, which is grass now. Move that point out of the strip, to the same offset from the road 60 m along it from the pad, and say so in a dated comment.
- Any test that pins the keys or the count of `CLUTTER_TUNABLES` gains `TRAILHEAD_CLEARING`.

Run the file again. Expected: PASS.

- [ ] **Step 5: Re-pin what follows the cover**

Run: `npx vitest run --root client test/sim/groundGradient.test.ts test/game/tierDeterminism.test.ts`
Expected: FAIL on the pass hash, and on "keeps every clutter field bit-identical, class by class". Re-pin both as Task 2's Step 5 does, with the counts the window holds now and before.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/sim/clutter.ts client/test/sim/clutter.test.ts client/test/sim/groundGradient.test.ts client/test/game/tierDeterminism.test.ts
git commit
```

Message:

```
feat: grow the ground's cover in the strip, and clear the trailhead

## What

Grass, bushes, rocks, stumps and mushrooms each begin above the shore by
the ground's height, so none grew by the road. Inland of the pad they
read the strip's height now and grow down to the road's verge. Bushes
grow thickly there: 277 in the 120 m square about one world's pad. So
nothing that stands tall grows within 24 m of the pad's centre, which
takes in where a player arrives, the trail's entrance and the board.
Grass and flowers do.

## How

- `client/src/sim/clutter.ts` — the low edge of each altitude gate reads
  `shoreHeight`; `TRAILHEAD_CLEARING`, which rejects a rock, boulder,
  bush, stump or mushroom by its own place.
- `client/test/sim/clutter.test.ts` — the densities in the strip, at its
  edge and outside it; the clearing; a sand point of the duff's test
  moved out of the strip.
- `client/test/sim/groundGradient.test.ts`,
  `client/test/game/tierDeterminism.test.ts` — the pass hash and the
  clutter census.
```

---

### Task 4: The sand's paint reads the strip

**Files:**
- Modify: `client/src/game/terrainSurface.ts`
- Create: `client/test/game/terrainSurfaceStrip.test.ts`

**Interfaces:**
- Consumes: `shoreHeight` from Task 1.
- Produces: `classifySurface`, `surfaceAlbedo`, `surfaceWeights` with the same signatures.

The paint is the renderer's and moves no level id.

- [ ] **Step 1: Write the failing test**

`client/test/game/terrainSurfaceStrip.test.ts`. It is a file of its own because it registers the worlds, and `terrainSurface.test.ts` runs with none registered, which the strip must also bear:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { surfaceWeights } from "../../src/game/terrainSurface.js";

const HOLLOW = 2032433950;
const shore = (x: number, z: number, altitude: number): number => {
  const w = surfaceWeights(HOLLOW, x, z, altitude, 0.05);
  return w.sand + w.pebble;
};

describe("the sand's paint at the trailhead", () => {
  it("is gone inland of the pad, on ground that was all sand", () => {
    setActiveTerrainVariant("olympic");
    expect(shore(-313.7267739768348, 0, 3.0155)).toBe(0);
    expect(shore(-302.7267739768348, 0, 3.5929)).toBe(0);
  });

  it("fades with the strip under the pavement and at its edge", () => {
    setActiveTerrainVariant("olympic");
    expect(shore(-319.7267739768348, 0, 3.0169)).toBeCloseTo(0.080491, 6);
    expect(shore(-305.66117205148345, 38, 4.2139)).toBeCloseTo(0.058539, 6);
  });

  it("is what it was outside the strip and on the beach", () => {
    setActiveTerrainVariant("olympic");
    expect(shore(-307.06319004698264, 60, 4.2177)).toBeCloseTo(0.994478, 6);
    expect(shore(-287.06319004698264, 60, 7.1664)).toBeCloseTo(0.304815, 6);
    expect(shore(-332.7267739768348, 0, 2.9873)).toBe(1);
  });
});
```

The altitude and the slope are handed in, as the ground's mesh hands them in: the paint does not read the world's ground itself, so these hold wherever the trail runs.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/terrainSurfaceStrip.test.ts`
Expected: FAIL. The first test reads 1 where it expects 0.

- [ ] **Step 3: Read the strip in the paint**

In `client/src/game/terrainSurface.ts`:

```ts
import { shoreHeight } from "../sim/shoreStrip.js";
```

and in `classifySurface` replace the two lines that blend the coastal bands out:

```ts
  // Inland of the trailhead's pad the sand gives way by the strip's height
  // (`sim/shoreStrip.ts`). Ground at 9 m and above has no sand to take, and
  // is not asked about the strip.
  const inland = smoothstep(SAND_TOP, COAST_FADE_END, altitude >= COAST_FADE_END ? altitude : shoreHeight(seed, x, z, altitude));
  colour = mixRgb(coastal, colour, inland);
  w = mixW(wCoastal, w, inland);
```

- [ ] **Step 4: Run the paint's tests**

Run: `npx vitest run --root client test/game/terrainSurfaceStrip.test.ts test/game/terrainSurface.test.ts test/game/clipmap.test.ts`
Expected: PASS. `terrainSurface.test.ts` registers no world; it passes because the strip is nothing where none is registered.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/game/terrainSurface.ts client/test/game/terrainSurfaceStrip.test.ts
git commit
```

Message:

```
feat: paint the ground at the trailhead as forest floor, not sand

## What

The ground is painted as sand under 4 m, fading out by 9 m, and the
ground by the road is lower than that. Inland of the pad the paint reads
the strip's height now, so the ground there is grass and leaf litter to
the road's verge, and sand to either side of the strip and on the beach
as before.

## How

- `client/src/game/terrainSurface.ts` — `classifySurface` reads
  `shoreHeight` where the ground is under 9 m.
- `client/test/game/terrainSurfaceStrip.test.ts` — the sand's share of
  the paint at the pad, on the verge, under the pavement, at the strip's
  edge, outside it and on the beach.
```

---

### Task 5: The animals' ground reads the strip

**Files:**
- Modify: `client/src/game/wildlifeField.ts`
- Modify: `client/test/game/wildlifeField.test.ts`, `client/test/game/wildlifeBehaviour.test.ts`, `client/test/game/wildlifeMeshes.test.ts`

**Interfaces:**
- Consumes: `shoreHeight` from Task 1.
- Produces: `forestGround`, `speciesGround` with the same signatures. The animals are the renderer's and move no level id.

- [ ] **Step 1: Change the tests to say what the strip is**

In `client/test/game/wildlifeField.test.ts`, "the ground an animal may stand on" names four points on the pad's line as sand. Two of them are forest now. Replace its two tests:

```ts
  it("is not the road, the pad, the verge, or the sand to either side of the strip", () => {
    setActiveTerrainVariant("olympic");
    expect(forestGround(HOLLOW, -323, 0)).toBe(false); // the road
    expect(forestGround(HOLLOW, -314, 0)).toBe(false); // the pad
    expect(forestGround(HOLLOW, -302.7267739768348, 0)).toBe(false); // 20 m from the centreline: the road's strip
    expect(forestGround(HOLLOW, -287.06319004698264, 60)).toBe(false); // 60 m along the road, 40 m inland, 7.17 m up: sand
    expect(forestGround(HOLLOW, -287.5514467082555, -60)).toBe(false); // 60 m the other way, 31 m inland, 5.88 m up: sand
  });

  it("is the ground above the sand, and the strip inland of the pad, clear of the road's strip", () => {
    setActiveTerrainVariant("olympic");
    expect(forestGround(HOLLOW, -291.7267739768348, 0)).toBe(true); // 31 m inland on the pad's line, 5.89 m up, read as 14.89 m
    expect(forestGround(HOLLOW, -283, 0)).toBe(true); // 40 m inland, 7.00 m up
    expect(forestGround(HOLLOW, -263, 0)).toBe(true); // 60 m inland, 10.10 m up
    expect(forestGround(HOLLOW, -203, 0)).toBe(true); // 120 m inland, 24.60 m up
    expect(GROUND_SHORE_ALT).toBe(9);
    expect(GROUND_ROAD_CLEAR).toBe(30);
  });
```

In "the ground each species keeps to", the points `-291` and `-283` on the pad's line become the two sand points above, `(-287.06319004698264, 60)` and `(-287.5514467082555, -60)`.

In "wildlife placement census", the clause that nothing that walks is anchored under 9 m reads the ground's height. It reads the strip's now: import `shoreHeight` from `../../src/sim/shoreStrip.js` and change the expectation to

```ts
          expect(shoreHeight(seed, u.x, u.z, elevationSampleAt(seed, u.x, u.z).h), `species ${species} at ${u.x}, ${u.z}`).toBeGreaterThanOrEqual(9);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/wildlifeField.test.ts`
Expected: FAIL. `forestGround(HOLLOW, -291.7267739768348, 0)` and `(-283, 0)` read false.

- [ ] **Step 3: Read the strip in the animals' ground**

In `client/src/game/wildlifeField.ts`:

```ts
import { shoreHeight } from "../sim/shoreStrip.js";
```

```ts
/** Where an animal that walks may be anchored: the forest's ground, no steeper than a
 * player could walk. `sh` is the height the shore's rules read there. */
function standable(s: TerrainSample, road: number, sh: number): boolean {
  return sh >= GROUND_SHORE_ALT && road >= GROUND_ROAD_CLEAR && Math.hypot(s.dx, s.dz) <= MAX_WALKABLE_GRADIENT;
}
```

```ts
export function forestGround(seed: number, x: number, z: number): boolean {
  const road = activeTerrainVariant().roadDistance?.(seed, x, z) ?? Infinity;
  if (road < GROUND_ROAD_CLEAR) return false;
  return shoreHeight(seed, x, z, elevationSampleAt(seed, x, z).h) >= GROUND_SHORE_ALT;
}
```

and in `groundUnit`:

```ts
  if (!standable(s, road, shoreHeight(seed, x, z, s.h))) return null;
```

Change the comment above `GROUND_SHORE_ALT` to say the height is the one the shore's rules read, which inland of the pad is the strip's.

- [ ] **Step 4: Run the animals' tests, and answer each that moved**

Run: `npx vitest run --root client test/game/wildlifeField.test.ts test/game/wildlifeBehaviour.test.ts test/game/wildlifeDirector.test.ts test/game/wildlifeMeshes.test.ts`

Expected, measured with the change in place:

| Test | What it reads | What to do |
| --- | --- | --- |
| `wildlifeField.test.ts`, "the rabbits and the canopy", seeds 1 and -1117907922 | `[693, 960, 0]` for `[698, 958, 0]`; `[552, 791, 0]` for `[553, 793, 0]` | Re-pin. Bushes left the clearing and grass came to the strip, and a rabbit needs both. Say so in the dated comment. |
| `wildlifeBehaviour.test.ts`, "stands where the test says" | `forestGround(HOLLOW, -270, 0)` is true | The forest's edge on the pad's line is the road's strip now, 30 m from the centreline at x = -292.73. Change the point to `-300` (22.7 m from the centreline), and the test's name and opening comment to say so. |
| `wildlifeBehaviour.test.ts`, "stops an animal sent to a mark on the road at the forest's edge" | the goal's x is -292.5 | The animal is stopped at the road's strip. Expect the goal's x between -293 and -292. |
| `wildlifeMeshes.test.ts`, "puts no animal that walks in front of a player on the pad, looking inland across the sand" | one animal was placed | The strip inland of the pad is forest, 21 m from the pad, and animals are walked in there. Rename it "walks animals in on the strip inland of the pad, and none on the sand or the road", keep the clause that nothing drawn strays, and pin the number placed for each of the three views as read. |

Read every other failure in these four files as it comes; each is a point that was sand on the pad's line. Move the point along the road by 60 m, out of the strip, where the test is about sand, and leave it where the test is about the forest's edge.

Run the four files again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/game/wildlifeField.ts client/test/game/wildlifeField.test.ts client/test/game/wildlifeBehaviour.test.ts client/test/game/wildlifeMeshes.test.ts
git commit
```

Message:

```
feat: let the animals into the wood that comes down to the road

## What

The animals that walk keep to ground 9 m up and 30 m from the road. The
strip inland of the pad is forest now, on ground lower than that, and
they read its height as the forest does: they may stand and be walked in
there, 30 m from the road and more, and nowhere on the sand to either
side of it, on the road's own strip or on the road.

## How

- `client/src/game/wildlifeField.ts` — `standable` and `forestGround`
  read `shoreHeight`.
- `client/test/game/wildlifeField.test.ts` — the ground in the strip,
  on the verge and on the sand to either side; the census reads the
  strip's height; the rabbits' counts.
- `client/test/game/wildlifeBehaviour.test.ts`,
  `client/test/game/wildlifeMeshes.test.ts` — the forest's edge on the
  pad's line is the road's strip.
```

---

### Task 6: The shore is closed to the trail's search

**Files:**
- Modify: `client/src/sim/trailGrid.ts`, `client/src/sim/trailBuild.ts`
- Modify: `client/test/sim/trailGrid.test.ts`, `client/test/sim/trail.test.ts`
- Create: `client/test/sim/treeline.test.ts`
- Modify: `client/test/sim/vegetation.test.ts` (the trees within 40 m of the pad, 8 to 6)
- Modify: `client/test/sim/groundGradient.test.ts`, `client/test/game/tierDeterminism.test.ts` (the pass hash)

**Interfaces:**
- Consumes: `TrailGrid`, `buildTrailGrid`, `cellAt` (`sim/trailGrid.ts`); `shoreHeight` (Task 1) and the forest and cover of Tasks 2 and 3, in the sweep.
- Produces: `closeShore(grid: TrailGrid, roadCenterX: (z: number) => number, padZ: number): void`, `SHORE_GATE_ALT` (9), `SHORE_GATE_U` (30), `DOORWAY_HALF` (4), all three in `TRAIL_GRID_TUNABLES`.

`trailBuild.ts` already has a function named `doorway`: it opens the pad's own ring to the search. It keeps its name and its work. The spec's doorway is `closeShore`, which runs after it and closes what is shore outside the two rows.

- [ ] **Step 1: Write the failing tests on a hand-built grid**

Add to `client/test/sim/trailGrid.test.ts`, importing `closeShore`, `SHORE_GATE_ALT`, `SHORE_GATE_U` and `DOORWAY_HALF`:

```ts
describe("closeShore", () => {
  /** Low ground for 60 m inland of the road, high ground beyond: h = 5 where u < 60, else 40. */
  const shore: GroundFn = (x) => ({ h: x - ROAD_X < 60 ? 5 : 40, dx: 0, dz: 0 });

  it("closes shore ground outside the two rows beside the pad's line, and nothing else", () => {
    const g = buildTrailGrid(roadCenterX, shore);
    expect(g.pass.every((p) => p === 1)).toBe(true);
    closeShore(g, roadCenterX, 0);
    // The two rows, centred 4 m to either side of the pad's line: open down to the road.
    expect(g.pass[cellOf(g, 12, 4)]).toBe(1);
    expect(g.pass[cellOf(g, 12, -4)]).toBe(1);
    expect(g.pass[cellOf(g, 52, 4)]).toBe(1);
    // The next row out, 12 m from the line: closed while the ground is low.
    expect(g.pass[cellOf(g, 12, 12)]).toBe(0);
    expect(g.pass[cellOf(g, 52, 20)]).toBe(0);
    // Far along the road: within 30 m of it, and past 30 m on low ground.
    expect(g.pass[cellOf(g, 28, 100)]).toBe(0);
    expect(g.pass[cellOf(g, 36, 100)]).toBe(0);
    // High ground past 30 m is untouched.
    expect(g.pass[cellOf(g, 68, 20)]).toBe(1);
    expect(g.pass[cellOf(g, 68, 100)]).toBe(1);
    // Six columns of low ground, 148 rows of them closed: 888 cells of 18600.
    expect(g.pass.reduce((n: number, p: number) => n + p, 0)).toBe(17712);
  });

  it("closes ground within 30 m of the road however high it is", () => {
    const g = buildTrailGrid(roadCenterX, flat);
    closeShore(g, roadCenterX, 0);
    expect(g.pass[cellOf(g, 28, 100)]).toBe(0);
    expect(g.pass[cellOf(g, 36, 100)]).toBe(1);
    expect(g.pass[cellOf(g, 28, 4)]).toBe(1);
  });

  it("opens no cell: a doorway cell too steep for the search stays closed", () => {
    // A wall across the doorway, 24 to 32 m from the road.
    const walled: GroundFn = (x, z) => {
      const u = x - ROAD_X;
      if (u >= 24 && u <= 32 && z > -8 && z < 8) return { h: 5 + 3 * (u - 24), dx: 3, dz: 0 };
      return { h: u < 60 ? 5 : 40, dx: 0, dz: 0 };
    };
    const g = buildTrailGrid(roadCenterX, walled);
    expect(g.pass[cellOf(g, 28, 4)]).toBe(0);
    closeShore(g, roadCenterX, 0);
    expect(g.pass[cellOf(g, 28, 4)]).toBe(0);
    expect(g.pass[cellOf(g, 28, -4)]).toBe(0);
  });

  it("follows the pad's line, wherever along the road the pad is", () => {
    const g = buildTrailGrid(roadCenterX, shore);
    closeShore(g, roadCenterX, 40);
    expect(g.pass[cellOf(g, 12, 44)]).toBe(1);
    expect(g.pass[cellOf(g, 12, 36)]).toBe(1);
    expect(g.pass[cellOf(g, 12, 4)]).toBe(0);
  });

  it("declares its constants", () => {
    expect([SHORE_GATE_ALT, SHORE_GATE_U, DOORWAY_HALF]).toEqual([9, 30, 4]);
  });
});
```

In the same file, "declares its tunables" expects the list with the three new keys:

```ts
    expect(Object.keys(TRAIL_GRID_TUNABLES).sort()).toEqual([
      "DOORWAY_HALF", "SHORE_GATE_ALT", "SHORE_GATE_U",
      "TRAIL_GRID_CAP", "TRAIL_GRID_CELL", "TRAIL_MOVE_GRADE_MAX", "TRAIL_REUSE_FACTOR", "TRAIL_SLOPE_COST",
    ]);
```

and in `client/test/sim/trail.test.ts`, "declares its tunables, exhaustively", add `"SHORE_GATE_ALT", "SHORE_GATE_U", "DOORWAY_HALF"` to `keys`.

- [ ] **Step 2: Write the failing sweep**

`client/test/sim/treeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { segmentDistance } from "../../src/sim/trail.js";
import { treesInRect } from "../../src/sim/vegetation.js";
import { CLUTTER_BOULDER, CLUTTER_BUSH, CLUTTER_FUNGUS, CLUTTER_ROCK, clutterInRect } from "../../src/sim/clutter.js";
import { shoreHeight } from "../../src/sim/shoreStrip.js";
import { SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the trail from the treeline, over the 227-seed sweep", () => {
  it("leaves the pad inland, on no sand, into a wood, through a clearing", () => {
    setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
    const v = activeTerrainVariant();
    const most = { turn: 0, lateral: 0, alongOnSand: 0, fallbacks: 0, tall: 0, treesByTrail: 0 };
    const least = { shore: Infinity, bedShore: Infinity, trees: Infinity };
    for (const seed of SEEDS) {
      const g = v.trailGraph!(seed);
      const pad = g.trailhead;
      const road = (z: number): number => v.roadCenterX!(seed, z);
      most.fallbacks = Math.max(most.fallbacks, g.fallbacks);

      // The stem, from the pad to where it is off the shore: past 30 m from the road on ground 9 m up.
      const chain = stemNodes(g);
      let alongOnSand = 0, lateral = NaN, off = false;
      for (let k = 0; k + 1 < chain.length && !off; k++) {
        const a = g.nodes[chain[k]!]!, b = g.nodes[chain[k + 1]!]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const h = elevationAt(seed, x, z), u = x - road(z);
          if (Number.isNaN(lateral) && u >= 30) lateral = Math.abs(z - pad.z);
          if (h >= 9 && u >= 30) { off = true; break; }
          least.bedShore = Math.min(least.bedShore, shoreHeight(seed, x, z, h));
          if (h < 4) alongOnSand += (Math.abs(b.z - a.z) / len) * (len / n);
        }
      }
      most.lateral = Math.max(most.lateral, lateral);
      most.alongOnSand = Math.max(most.alongOnSand, alongOnSand);
      const a0 = g.nodes[chain[0]!]!, b0 = g.nodes[chain[1]!]!;
      most.turn = Math.max(most.turn, (Math.atan2(Math.abs(b0.z - a0.z), b0.x - a0.x) * 180) / Math.PI);

      // Every edge of every kind, each metre: the height the shore's rules read under it.
      for (const e of g.edges) {
        const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
        for (let i = 0; i <= n; i++) {
          const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
          least.shore = Math.min(least.shore, shoreHeight(seed, x, z, elevationAt(seed, x, z)));
        }
      }

      // The wood and the clearing about the pad.
      let trees = 0;
      for (const t of treesInRect(seed, pad.x - 40, pad.z - 40, pad.x + 40, pad.z + 40)) {
        if (Math.hypot(t.x - pad.x, t.z - pad.z) > 40) continue;
        trees++;
        for (const e of g.edges) {
          const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
          if (segmentDistance(a.x, a.z, b.x, b.z, t.x, t.z) < 8) most.treesByTrail++;
        }
      }
      least.trees = Math.min(least.trees, trees);
      for (const cls of [CLUTTER_ROCK, CLUTTER_BOULDER, CLUTTER_FUNGUS, CLUTTER_BUSH]) {
        for (const c of clutterInRect(seed, cls, pad.x - 24, pad.z - 24, pad.x + 24, pad.z + 24)) {
          if (Math.hypot(c.x - pad.x, c.z - pad.z) < 24) most.tall++;
        }
      }
    }
    console.info(`[treeline] first edge ${most.turn.toFixed(2)} deg from inland at most, the stem ${most.lateral.toFixed(2)} m from the pad's line 30 m from the road, ${most.alongOnSand.toFixed(2)} m along the road on ground under 4 m; the shore's rules read ${least.shore.toFixed(2)} m at the least under any edge and ${least.bedShore.toFixed(2)} m under the stem's first stretch; ${least.trees} trees within 40 m of the pad at the least`);
    expect(most.fallbacks).toBe(0);
    expect(most.turn).toBeLessThanOrEqual(21);
    expect(most.lateral).toBeLessThanOrEqual(7);
    expect(most.alongOnSand).toBeLessThanOrEqual(3.5);
    expect(least.shore).toBeGreaterThanOrEqual(8.8);
    expect(least.bedShore).toBeGreaterThanOrEqual(9);
    expect(least.trees).toBeGreaterThanOrEqual(2);
    expect(most.treesByTrail).toBe(0);
    expect(most.tall).toBe(0);
  }, timeLimit(300_000));
});
```

Measured with the change in place: 20.83°, 6.65 m, 3.33 m, 8.87 m, 11.12 m, and 2 trees at the least (9 on the median seed).

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run --root client test/sim/trailGrid.test.ts test/sim/treeline.test.ts`
Expected: FAIL. `closeShore` is not exported. With it stubbed to do nothing, the grid's tests read 1 where they expect 0, and the sweep reads a first edge of 107.8° and a run of 198.4 m along the road on sand.

- [ ] **Step 4: Close the shore**

In `client/src/sim/trailGrid.ts`, after `TRAIL_MOVE_GRADE_MAX`:

```ts
/** A cell is shore, and closed to the search, where its ground is under this (m)... */
export const SHORE_GATE_ALT = 9;
/** ...or it is within this of the road's centreline (m). */
export const SHORE_GATE_U = 30;
/** Shore cells within this of the pad's line along the road stay as they were (m): the two rows beside the line. */
export const DOORWAY_HALF = 4;
/** Folded into TRAIL_TUNABLES by trail.ts. */
export const TRAIL_GRID_TUNABLES: Readonly<Record<string, number>> = {
  TRAIL_GRID_CELL, TRAIL_GRID_CAP, TRAIL_SLOPE_COST, TRAIL_REUSE_FACTOR, TRAIL_MOVE_GRADE_MAX,
  SHORE_GATE_ALT, SHORE_GATE_U, DOORWAY_HALF,
};
```

and before `resampleCells`:

```ts
/**
 * Close the shore to the search, but for the rows straight inland of the
 * pad: a trail runs on no sand, and leaves the pad inland. Shore is ground
 * under SHORE_GATE_ALT, and everything within SHORE_GATE_U of the road. The
 * height read is the ground's own and not the strip's (`shoreStrip.ts`):
 * what is closed is what would be sand without it. It closes cells and opens
 * none, so a doorway cell too steep for the search stays closed.
 */
export function closeShore(grid: TrailGrid, roadCenterX: (z: number) => number, padZ: number): void {
  for (let j = 0; j < grid.nz; j++) {
    const row = j * grid.nu;
    const z = grid.z[row] as number;
    const dz = z - padZ;
    if ((dz < 0 ? -dz : dz) <= DOORWAY_HALF) continue;
    const centre = roadCenterX(z);
    for (let i = 0; i < grid.nu; i++) {
      const c = row + i;
      if ((grid.h[c] as number) < SHORE_GATE_ALT || (grid.x[c] as number) - centre < SHORE_GATE_U) grid.pass[c] = 0;
    }
  }
}
```

Add a paragraph to the module's opening comment: the shore is closed to the search but for the doorway, and why.

In `client/src/sim/trailBuild.ts`, import `closeShore` from `./trailGrid.js` and call it after each of the two calls of `doorway()`:

```ts
  doorway();
  closeShore(grid, frame.roadCenterX, thZ);
```

```ts
    for (const c of keep) grid.pass[c] = 1;
    doorway();
    closeShore(grid, frame.roadCenterX, thZ);
    smoothCache.clear(); // the dome moved the ground under every cached height
```

and add to the comment above `doorway`: the ring it opens is closed again outside the two rows by `closeShore`, so the pad is left by the doorway and not round its side.

- [ ] **Step 5: Run them to see them pass**

Run: `npx vitest run --root client test/sim/trailGrid.test.ts test/sim/trail.test.ts test/sim/treeline.test.ts test/sim/trailBuild.test.ts test/sim/trailBed.test.ts test/sim/trailSystem.test.ts`
Expected: `trailGrid.test.ts`, `trail.test.ts` and `treeline.test.ts` pass. In the other three, a test that holds a property of every trail (a bed no steeper than a player can walk, the spacing of edges, the budget to build a world) passes, and a test that pins a count for a named world reads a new count: re-pin it here with its reason if it is a count of the trail's own shape, and leave it for Task 9 if it names nodes or forks.

- [ ] **Step 6: Re-pin the trees by the pad, and the pass hash**

In `client/test/sim/vegetation.test.ts`, "stands trees within 40 m of the pad" counts 6 now: the trail runs down the pad's line and no tree stands within 8 m of it. Write 6, with a dated comment that says so.

Re-pin the pass hash in both files as in Task 1.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/sim/trailGrid.ts client/src/sim/trailBuild.ts client/test/sim/trailGrid.test.ts client/test/sim/trail.test.ts client/test/sim/treeline.test.ts client/test/sim/vegetation.test.ts client/test/sim/groundGradient.test.ts client/test/game/tierDeterminism.test.ts
git commit
```

(and any of `trailBuild.test.ts`, `trailBed.test.ts`, `trailSystem.test.ts` that Step 5 re-pinned).

Message:

```
feat: close the shore to the trail's search, but for a doorway

## What

The trail was routed over any ground it could walk, and the ground by
the road is sand: over the 227 seeds of the sweep the stem ran up to
198.4 m along the road on sand, and its first edge turned up to 107.8
degrees from straight inland. The search may no longer enter ground
under 9 m or within 30 m of the road, but for two rows of cells, 16 m,
straight inland of the pad. The stem's first edge turns 20.83 degrees at
most now and runs 3.33 m along the road on sand at most; no edge of any
kind is on ground the shore's rules read under 8.87 m; and the trail is
built on all 227 seeds with no fallback. The level id moves.

## How

- `client/src/sim/trailGrid.ts` — `closeShore`, and its three constants
  among the grid's tunables.
- `client/src/sim/trailBuild.ts` — closes the shore wherever it opens
  the pad's ring: at the start, and after every feature's resample.
- `client/test/sim/trailGrid.test.ts`, `client/test/sim/trail.test.ts`
  — a hand-built grid: what is closed, what is left, a steep doorway
  cell, a pad elsewhere along the road; the tunables.
- `client/test/sim/treeline.test.ts` — the sweep: the first edge, the
  stem's line, the sand under it, the height the shore's rules read
  under every edge, the trees and the clearing about the pad.
- `client/test/sim/vegetation.test.ts` — the trees by the pad, 8 to 6.
- `client/test/sim/groundGradient.test.ts`,
  `client/test/game/tierDeterminism.test.ts` — the pass hash.
```

---

### Task 7: The board is judged by its further end, against the way the player faces

**Files:**
- Modify: `client/src/sim/facing.ts`, `client/src/sim/trailhead.ts`
- Modify: `client/test/sim/facing.test.ts`, `client/test/sim/trailhead.test.ts`
- Modify: `client/test/sim/groundGradient.test.ts`, `client/test/game/tierDeterminism.test.ts` (the pass hash)

**Interfaces:**
- Consumes: `facingYaw`, `Start`, `trailEntrance`, `boardBoxes`, `bedGap`.
- Produces: `facingDir(yaw: number): { x: number; z: number }`; `boardSite(graph, roadCenterX, seed, start: Start): Board`, whose fourth argument was a `Ground` and is a `Start` now.

Why: a player faces the entrance to within 0.072 rad, which is `facingYaw`'s own error, and `boardSite` measured the board's centre against the line to the entrance. With the trail leaving nearly straight inland, that put the board's further end 23.53° from the centre of the view on 4 of the 227 seeds (173, -1609472273, -1691933345, 1484635213). An upright phone shows 21.3° to each side.

- [ ] **Step 1: Write the failing tests**

Add to `client/test/sim/facing.test.ts`, importing `facingDir`:

```ts
describe("facingDir", () => {
  it("is the direction a yaw faces: +z at 0, +x at a quarter turn", () => {
    expect(facingDir(0)).toEqual({ x: 0, z: 1 });
    expect(facingDir(Math.PI / 2).x).toBeCloseTo(1, 11);
    expect(facingDir(Math.PI / 2).z).toBeCloseTo(0, 11);
    expect(facingDir(Math.PI)).toEqual({ x: 0, z: -1 });
    expect(facingDir(1).x).toBeCloseTo(0.8414709848078965, 12);
    expect(facingDir(1).z).toBeCloseTo(0.5403023058681399, 12);
    expect(facingDir(-2.5).x).toBeCloseTo(-0.5984721441039563, 12);
    expect(facingDir(-2.5).z).toBeCloseTo(-0.8011436155469338, 12);
  });

  it("is within 1e-12 of the sine and cosine over the whole turn", () => {
    let worst = 0;
    for (let i = -3141; i <= 3141; i++) {
      const d = facingDir(i / 1000);
      worst = Math.max(worst, Math.abs(d.x - Math.sin(i / 1000)), Math.abs(d.z - Math.cos(i / 1000)));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("uses none of the host's trigonometry", () => {
    // The code, without its comments: they name what it does not use.
    const source = readFileSync(new URL("../../src/sim/facing.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/Math\.(sin|cos|tan|atan|atan2|acos|asin|hypot|pow)\b/);
  });
});
```

(`readFileSync` from `node:fs`, if the file does not import it already.)

In `client/test/sim/trailhead.test.ts`, import `facingYaw` and `type Start`, and above "the board's place" add:

```ts
/** A player at a place, facing the entrance at (8, 0) as `trailheadSpawn` faces them. */
const arrives = (x: number, z: number): Start => ({ x, z, yaw: facingYaw(8 - x, 0 - z) });
```

Every call `boardSite(<graph>, straightRoad, 1, { x: <x>, z: <z> })` in that block becomes `boardSite(<graph>, straightRoad, 1, arrives(<x>, <z>))`; there are nine. Their expectations stand. Then add:

```ts
  it("judges the board by its further end against the way the player faces", () => {
    // The trail leaves 18.4 degrees north of inland and then bends south, as it does on seed 173.
    // The player faces 4.0 degrees north of the entrance, which is the facing's own error there.
    const g = padGraph([[0, 0], [12, 4], [54, -52]], [[0, 1, "stem"], [1, 2, "stem"]]);
    const s = trailheadSpawn(g, carSite(g, straightRoad, 1));
    expect(s.x).toBeCloseTo(1.2189129331667146, 9);
    expect(s.z).toBeCloseTo(0.866534755019326, 9);
    expect(s.yaw).toBeCloseTo(1.2455862867634584, 9);
    const b = boardSite(g, straightRoad, 1, s);
    // North of the bed, 4.5 m past the entrance: its further end is 15.94 degrees from the
    // view's centre. South of it and 3 m past, where its centre is nearer the line to the
    // entrance, its further end would be 23.5 degrees from the view's centre.
    expect(b.x).toBeCloseTo(11.067971810589327, 9);
    expect(b.z).toBeCloseTo(6.324555320336759, 9);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/facing.test.ts test/sim/trailhead.test.ts -t "facingDir|the board's place"`
Expected: FAIL. `facingDir` is not exported; the new board test reads (11.23, 1.11).

- [ ] **Step 3: Write `facingDir`, and judge the board by it**

Append to `client/src/sim/facing.ts`:

```ts
/**
 * The unit direction a yaw faces, without the host's trigonometry: the sine
 * and cosine as polynomials, so that every peer gets the same bits. The yaw
 * is folded into a quarter turn either side of +z or of -z, where nine terms
 * of each series are good to 1e-13.
 */
export function facingDir(yaw: number): { x: number; z: number } {
  const half = Math.PI / 2;
  let a = yaw, flip = 1;
  if (a > half) { a = Math.PI - a; flip = -1; }
  else if (a < -half) { a = -Math.PI - a; flip = -1; }
  const q = a * a;
  let sin = 0, cos = 0;
  // Horner, from the highest term down: x^17/17! ... x, and x^16/16! ... 1.
  for (let k = 8; k >= 0; k--) {
    sin = 1 - (sin * q) / ((2 * k + 2) * (2 * k + 3));
    cos = 1 - (cos * q) / ((2 * k + 1) * (2 * k + 2));
  }
  return { x: a * sin, z: flip * cos };
}
```

In `client/src/sim/trailhead.ts`, import `facingDir` beside `facingYaw`, and in `boardSite` take a `Start` and judge each place by its further end:

```ts
  seed: number,
  start: Start,
): Board {
  const e = trailEntrance(graph);
  const nx = -e.dz, nz = e.dx;
  // The way the player faces, which is the way to the entrance to within
  // `facingYaw`'s own 0.072 rad: the view's centre is theirs, not the line's.
  const v = facingDir(start.yaw);
  // From the board's centre to either end of its row of boxes.
  const half = ((BOARD_BOXES - 1) / 2) * BOARD_BOX_STEP + BOARD_BOX_HALF.x;
```

and where a place's `centred` was the cosine to the board's centre:

```ts
    // The cosine of the angle between the view's centre and the way to the
    // board's further end: nearer 1 is nearer the centre.
    let centred = 1;
    for (const end of [-half, half]) {
      const ex = x + board.ax * end - start.x, ez = z + board.az * end - start.z;
      const c = (ex * v.x + ez * v.z) / Math.sqrt(ex * ex + ez * ez);
      if (c < centred) centred = c;
    }
    return { board, clears, centred };
```

Rewrite the three comments the measurements are in:

- above `boardSite`: the place taken is the one whose further end is nearest the centre of the view as the player faces; over the 227-seed sweep a place clears on every seed and the board stands 4.5 m past the entrance on all of them;
- above `BOARD_ALONG`: over the sweep the whole board is within 17.88°, 4.5 m past the entrance on every seed;
- above `carSite`: over the sweep the car stands at the pad on all 227 seeds.

- [ ] **Step 4: Run them to see them pass, and re-pin the file's sweeps**

Run: `npx vitest run --root client test/sim/facing.test.ts test/sim/trailhead.test.ts`

Expected: the hand-built tests pass. The file's sweeps print what they measure; with every task to here in place they read:

| Sweep | Pinned | Reads |
| --- | --- | --- |
| The car's slides | `[[0, 216], [3, 1], [3.5, 10]]` | `[[0, 227]]` |
| The board's further end | at most 21° (20.56°) | 17.88° |
| The board from the player | 7 to 12 m | 11.22 to 11.47 m |
| The board's sides, `[plus, minus]` | `[63, 164]` | `[195, 32]` |
| How far past the entrance | `[["3.0", 2], ["3.5", 1], ["4.5", 224]]` | `[["4.5", 227]]` |
| The board's gap to the bed, the road, the car | at least 1.15, 6, 8.5 m | 1.30, 17.63, 12.31 m |

Write what the run prints, as literals: the bound on the further end becomes 18. Every other expectation in the file that names a seed's place (`boxes[0]!.x` and the like are of hand-built graphs and stand) is read from the run in the same way.

- [ ] **Step 5: Re-pin the pass hash**

The board's boxes are in the probe. Re-pin in both files as in Task 1.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add client/src/sim/facing.ts client/src/sim/trailhead.ts client/test/sim/facing.test.ts client/test/sim/trailhead.test.ts client/test/sim/groundGradient.test.ts client/test/game/tierDeterminism.test.ts
git commit
```

Message:

```
fix: judge the board's place by its further end as the player faces

## What

The board takes, of the places it may stand, the one nearest the centre
of the player's view. That was measured to the board's centre, from the
line to the entrance, and a player faces the entrance only to within 4
degrees. With the trail leaving nearly straight inland, the board's
further end stood 23.53 degrees from the centre of the view on 4 of the
227 seeds of the sweep, and an upright phone shows 21.3. It is measured
to the board's further end now, from the way the player faces: the
further end is within 17.88 degrees on every seed, and the board stands
4.5 m past the entrance on all of them.

## How

- `client/src/sim/facing.ts` — `facingDir`, the direction a yaw faces,
  as polynomials.
- `client/src/sim/trailhead.ts` — `boardSite` takes where the player
  arrives with their facing, and judges each place by its further end.
- `client/test/sim/facing.test.ts` — the direction against the sine and
  cosine over the whole turn.
- `client/test/sim/trailhead.test.ts` — a trail that leaves north of
  inland and bends south; the sweeps' readings.
- `client/test/sim/groundGradient.test.ts`,
  `client/test/game/tierDeterminism.test.ts` — the pass hash.
```

---

### Task 8: The version, and the probe's record

**Files:**
- Modify: `client/src/sim/forest.ts`
- Modify: `client/test/sim/forest.test.ts`, `client/test/sim/containment.test.ts`
- Modify: `client/test/sim/groundGradient.test.ts`, `client/test/game/tierDeterminism.test.ts` (the pass hash, for the last time)

**Interfaces:**
- Consumes: everything above.
- Produces: `GEN_VERSION` 8; `PROBE_CHUNKS` with the chunk of a junction post on the probe's new trail.

- [ ] **Step 1: Change the test of the version**

In `client/test/sim/containment.test.ts` the last expectation is `expect(GEN_VERSION).toBe(7)`. Write 8, and add to the comment above it: "8, the trail from the treeline."

Run: `npx vitest run --root client test/sim/containment.test.ts`
Expected: FAIL, 7 is not 8.

- [ ] **Step 2: Raise the version**

In `client/src/sim/forest.ts`, `GEN_VERSION = 8`, and at the head of its comment:

```
 * Escape hatch, not the main defence. Bumped to 8 when the trail began to
 * leave the pad inland and the forest came down to the road at the
 * trailhead: a trail is how the world is used as much as how it is
 * generated, and a peer from before would walk another one. The strip, the
 * doorway and the clearing move `passHash` in the same release, but this
 * does not lean on that.
```

Run the file again. Expected: PASS.

- [ ] **Step 3: Find the probe's junction post again**

Run: `npx vitest run --root client test/sim/forest.test.ts`
Expected: FAIL on "would change if pass signs emitted something different": the probe's trail moved, and chunk `[2, -6]` holds no post.

Find where the posts stand now, with a working test file that is deleted afterwards (`client/test/sim/zzProbe.test.ts`):

```ts
import { it } from "vitest";
import "../../src/sim/passes/index.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { generateChunk } from "../../src/sim/chunk.js";

it("prints the probe's posts and the trees by its pad", () => {
  setActiveTerrainVariant("olympic");
  const seed = 0x0badf00d;
  const rows: string[] = [];
  for (let cx = -12; cx <= 32; cx++) for (let cz = -20; cz <= 20; cz++) {
    const props = generateChunk(createChunkGrid(seed), seed, cx, cz).props;
    const posts = props.filter((p) => p.material === "signpost").length;
    if (posts > 0) rows.push(`posts: [${cx}, ${cz}] holds ${posts}`);
    if (cx >= -10 && cx <= -7 && cz >= -2 && cz <= 1) rows.push(`trees: [${cx}, ${cz}] holds ${props.filter((p) => p.material === "trunk").length}`);
  }
  console.info(rows.join("\n"));
});
```

Run: `npx vitest run --root client test/sim/zzProbe.test.ts --reporter=default --silent=false`

Take the chunk nearest the origin that holds a post, put it in `PROBE_CHUNKS` in place of `[2, -6]`, and write the record in the comment's own form:

```
  // Re-derived 2026-09-29: the trail leaves the pad inland, so the probe's
  // trail is another one. Measured: <the chunks that hold posts>; the
  // nearest the origin is taken.
```

and, under the entries for pass 8:

```
  // Re-read 2026-09-29: the forest comes down to the road at the
  // trailhead. Measured for PROBE_SEED: [-9, 0] holds <n> trees and
  // [-9, -1] holds <n>, where each held none; the car and the board's five
  // boxes stand where they stood.
```

with the counts the working file printed, and the car's and board's chunks checked against the entry above it. Delete `client/test/sim/zzProbe.test.ts`.

Run: `npx vitest run --root client test/sim/forest.test.ts`
Expected: PASS, every pass's removal moves the digest.

- [ ] **Step 4: Re-pin the pass hash**

Re-pin in both files as in Task 1. This is the value the release carries.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git status --short   # no zzProbe.test.ts
git add client/src/sim/forest.ts client/test/sim/forest.test.ts client/test/sim/containment.test.ts client/test/sim/groundGradient.test.ts client/test/game/tierDeterminism.test.ts
git commit
```

Message:

```
feat: raise the world's version for the trail from the treeline

## What

A match made before the trail left the pad inland cannot be joined
after it: the trail is another one on most worlds. The version is 8.
The probe the level id is taken over is read again: its junction post
stands in another chunk, and the chunks at its pad hold trees.

## How

- `client/src/sim/forest.ts` — `GEN_VERSION` 8; the probe's chunk for a
  junction post; the record of what the chunks at the pad hold.
- `client/test/sim/containment.test.ts` — the version.
- `client/test/sim/forest.test.ts` — unchanged, and passing again.
- `client/test/sim/groundGradient.test.ts`,
  `client/test/game/tierDeterminism.test.ts` — the pass hash.
```

---

### Task 9: The tests that follow the trail

The trail is another one on most worlds, so every test that names a world's nodes, forks, counts or places reads something new. Nothing here changes the game. Each file is one commit, or a few files of one kind are.

**Files:** the test files in the table below, and no file under `client/src/`.

**Interfaces:**
- Consumes: the world as Tasks 1 to 8 leave it.
- Produces: the suite, green.

**The rule for every entry.** Read the test and its comment first, and say what it holds: a property of every world, or a reading of one world. A property is not re-pinned: if it fails, the change broke it, and that is a finding to stop on. A reading is measured again from a run and written as a literal, with a dated comment in the form the file's own comments take, saying what it was, what it is, and that the trail leaves the pad inland now. Where a comment tells a world's story by its node and edge numbers, the story is told again with the new numbers; a comment that still names an old number is not finished.

- [ ] **Step 1: List what is red**

Run, when nothing else is using the machine:

```bash
npx vitest run --root client --maxWorkers=4 2>&1 | tee suite-after.txt
```

Move `suite-after.txt` out of the repository afterwards; it is a working file. With every task to here in place, the run reads 60 to 70 failing tests in these files, and no other:

| File | Failing | What it reads | With the change in place |
| --- | --- | --- | --- |
| `test/sim/cut.test.ts` | 17 | The guide, the forks and the cuts on the world `hollow`, by node and edge number | The forks are `[21, 36, 53, 77, 78]` where they were `[2, 22, 37, 78, 79]`; the graph has 79 nodes and 81 edges; the stem is 1296.55 m |
| `test/sim/watcher.test.ts` | 14 | The lead, the reach and the placements on `hollow`, by node number | The crest is node 35 where it was 36; the top fork moved with the forks |
| `test/sim/watcherSweep.test.ts` | 1 | 884 of 936 stands shown | 860 of 924 |
| `test/sim/cutSweep.test.ts` | 1 | The guide in its band on at least 29 of 50 seeds | 28 of 50 |
| `test/sim/summit.test.ts` | 1 | A Hollow's first ten ticks toward the road's strip, on `hollow` | It travels 0.438 m where it travelled more than 0.5 |
| `test/sim/summitRun.test.ts` | 1 | One whole run on `hollow`, by places along the stem | The places are another stem's |
| `test/sim/hollowCorridor.test.ts` | 1 | The first stem node above the pad, 36 m from the road on `hollow` | 44 m |
| `test/sim/spawn.test.ts` | 2 | Where a player arrives on `hollow` | x = -312.4371156894627, where it was -313.0286066837363 |
| `test/sim/signsSweep.test.ts` | 1 | The planks over the sweep: `{ most: 5, total: 163, fillers: 17 }` | `{ most: 5, total: 145, fillers: 15 }` |
| `test/sim/cliffField.test.ts` | 1 | Cliff modules placed: 405 | 426 |
| `test/sim/passes/cliffs.test.ts` | 1 | Colliders over the 200-world sweep: 206 | 228 |
| `test/game/bladeMeshes.test.ts` | 1 | Blades held at two poses: `[1614, 6131, 1752, 6587]` | `[1614, 6188, 1752, 6587]` |
| `test/game/clutterMeshes.test.ts` | 1 | Cards held at two poses: `[870, 4559, 891, 4731]` | `[870, 4570, 891, 4731]` |
| `test/game/clutterField.test.ts` | 1 | The sward at two poses: `[2674, 8719]` | `[2771, 8969]` |
| `test/game/interStage.test.ts` | 2 | The first mesh that draws each of the giants' materials | One of the four is a mesh that takes no shadows |

A file in this table that Task 5, 6 or 7 already answered is not red, and a file that is red and not in this table is read before anything in it is changed: it is either a reading this table missed, which is re-pinned by the rule above and named in its commit, or a property the change broke.

- [ ] **Step 2: The world `hollow`, by its new numbers**

`cut.test.ts` and `watcher.test.ts` are written round one world's forks. Print the world with a working test file that is deleted afterwards (`client/test/sim/zzHollow.test.ts`):

```ts
import { it } from "vitest";
import "../../src/sim/passes/index.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld } from "../../src/sim/world.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { seedFromToken } from "../../src/game/seed.js";

it("prints the world `hollow`", () => {
  setActiveTerrainVariant("olympic");
  const w = createForestWorld(createForest(seedFromToken("hollow")));
  const g = w.trail!;
  const rows: string[] = [];
  rows.push(`nodes ${g.nodes.length}, edges ${g.edges.length}, stem ${g.stemLen.toFixed(2)} m, crest ${g.summit}, forks ${JSON.stringify(g.forks)}`);
  rows.push(`stem nodes ${JSON.stringify(stemNodes(g))}`);
  for (const f of g.forks) {
    const n = g.nodes[f]!;
    rows.push(`fork ${f} at (${n.x.toFixed(2)}, ${n.z.toFixed(2)}), ${n.u.toFixed(2)} m from the road`);
    g.edges.forEach((e, ei) => {
      if (e.a !== f && e.b !== f) return;
      const o = g.nodes[e.a === f ? e.b : e.a]!;
      rows.push(`  edge ${ei} (${e.kind}) to node ${e.a === f ? e.b : e.a}, ${Math.hypot(o.x - n.x, o.z - n.z).toFixed(2)} m`);
    });
  }
  for (const l of g.loops) rows.push(`loop ${l.kind} feature ${l.featureId}: junctions ${l.junctionA} and ${l.junctionB}, edges ${JSON.stringify(l.edges)}`);
  console.info(rows.join("\n"));
});
```

Run: `npx vitest run --root client test/sim/zzHollow.test.ts --reporter=default --silent=false`

Then, test by test in `cut.test.ts` and `watcher.test.ts`:

1. Read what the test is about: the shape it needs (the stem's lowest fork, a hub where three branches meet, a fork with a branch too short for a Hollow to stand 12 m down it, the top fork).
2. Find that shape in what was printed. The lowest fork is the first of `forks` in stem order; the top fork is the last on the stem; a hub is a fork with four edges; a short branch is an edge under 14 m.
3. Rewrite the test's numbers and its comment for the fork that has the shape now, and read every other literal in it (the world's RNG after the guide is drawn, the guide's length, the closed edges in order, the counts) from a run.
4. Where the new world has no fork with the shape a test needs, the test moves to a hand-built graph of that shape, as the file's own sandbox tests are built (`hand`, `sandboxWorld`), and its comment says the world `hollow` no longer has one.

Delete `client/test/sim/zzHollow.test.ts`.

- [ ] **Step 3: The watcher's sweep**

The sweep prints its summary and its `never shown:` list on every run. Read them against the ones the test pins: 884 of 936 stands shown, the pad 160 of 200.

Trees stand by the pad now. For every stand at the pad that is in one `never shown:` list and not the other, say which tree is on its sightline, by the tree's place. Write the measured counts as literals, and add to the end of the test's doc comment a paragraph in the form its last one takes:

```
 * Re-pinned 2026-09-29 from 884 shown of 936: the trail leaves the pad
 * inland and the forest comes down to the road at the trailhead.
```

followed by the counts as measured, which stands no longer show or show now, and the tree on each one's sightline. A comment that does not name the stands is not finished.

- [ ] **Step 4: The rest of the table**

`cutSweep.test.ts`: the floor on the guide in its band is a reading. Read the test's own account of the band before lowering the floor from 29 to the 28 measured: if its comment gives a reason the count could not fall, that reason is answered in the new comment.

`summit.test.ts`, `summitRun.test.ts`, `hollowCorridor.test.ts`, `spawn.test.ts`: each names places on `hollow`'s lower stem. In `summit.test.ts` the Hollow walks the pad's line toward the road's strip, where the trail's bed now runs; say in the comment what ground it walks and what it travels.

`signsSweep.test.ts`, `cliffField.test.ts`, `passes/cliffs.test.ts`: counts over many worlds. Cliff modules keep off the trail, so they moved with it.

`bladeMeshes.test.ts`, `clutterMeshes.test.ts`, `clutterField.test.ts`: what is held at the tests' poses. Say which pose moved and that the strip, the clearing or the trail is in its view.

`interStage.test.ts`: the test takes the first mesh that draws each material to speak for it, and says the giants take the sun's shadows. With more trees near the world's origin another mesh comes first for one material. Take, for each material, the first mesh that is among the forest's casters (`forest.casterMeshes`), which is what the test means by "as drawn", and leave its expectations as they are.

- [ ] **Step 5: Commit by file, or by kind**

One commit for `cut.test.ts` and `cutSweep.test.ts`; one for `watcher.test.ts` and `watcherSweep.test.ts`; one for the four that name places on `hollow`; one for the counts over many worlds; one for the renderer's. Each message's `## What` says what the tests read and what they read now; for example:

```
test: read the watcher on the world's new trail

## What

The watcher's tests name the nodes of one world's trail, and its sweep
counts the stands it shows on over fifty. The trail leaves the pad
inland now and trees stand by the pad, so both were read again: the
sweep shows on N of M stands within 120 ticks, where it showed on 884
of 936.

## How

- `client/test/sim/watcher.test.ts` — the lead, the reach and the
  placements, by the new trail's nodes.
- `client/test/sim/watcherSweep.test.ts` — the floors as measured, which
  stands moved, and the tree on each one's sightline.
```

with the measured numbers in place of the letters.

---

### Task 10: The whole suite, the architecture note, and the branch

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Write the strip and the doorway into the architecture note**

Find where `ARCHITECTURE.md` describes the trail's build (`grep -n "trailGrid\|trailBuild\|the trail" ARCHITECTURE.md`) and add, in its own words and at its own length:

- the strip: a function of a place in the road's frame, read by the shore's rules in place of the ground's height; what reads it; that the ground's shape does not change;
- the doorway: the shore is closed to the trail's search but for two rows inland of the pad, and that it closes cells and opens none;
- the trailhead's clearing.

- [ ] **Step 2: The whole suite**

Run once, when no other test run, no game in a browser and no frame-time measurement is using the machine:

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck and lint clean; the client, server and tools suites all pass. Run `npm test` on its own and read its summary line: never pipe it into a filter inside a chain. A test that times out in a file this work did not touch is re-run alone (`npx vitest run --root client --maxWorkers=2 <file>`) and must pass there.

- [ ] **Step 3: Commit the note, and run the suite where the machine is quiet**

```bash
git add ARCHITECTURE.md
git commit
```

Message:

```
docs: describe the strip and the doorway at the trailhead

## What

The architecture note says how the forest comes down to the road at the
trailhead and how the trail is kept off the sand.

## How

- `ARCHITECTURE.md` — the strip the shore's rules read, the doorway in
  the trail's search, and the trailhead's clearing.
```

Pushing the branch runs the same suite on a clean machine (`.github/workflows/test.yml`): push only when asked to, and read the `gates` job.

---

### Task 11: Look at it in the game

The tests prove where things stand. They cannot prove the picture (spec §9.2). This needs a browser on this machine: run nothing else meanwhile.

**Files:**
- Create: `docs/trail/<the date this note is written>-trail-from-the-treeline-verification.md` (text only: every file under `docs/` is a dated `.md`, so the stills are kept outside the repository)

**Interfaces:**
- Consumes: the built game on this branch.
- Produces: the verification note.

- [ ] **Step 1: Start the game**

Find two free ports (`lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(51|80)[0-9]{2}"` shows the ones taken), then from the worktree's root:

```bash
PORT=<signaling port> ALLOWED_ORIGINS=http://localhost:<vite port> npm run dev
```

with the vite port and the `/ws` proxy set in `client/vite.config.ts`; that edit is local and never staged or committed.

- [ ] **Step 2: Open each world and look**

Load each world by the command bar (`/`), `seed <token>`, with `weather clear` and `time 13`: `hollow`, `room-1`, `room-140`, `room-50`, `room-19`, `room-30`. On the high tier, and again on the low one (`?tier=low`). Take a still on arrival before any input, one from the road a hundred metres along it each way, and one from above.

1. On arrival there is grass underfoot and trees ahead, and no sand between the player and the board.
2. The board is whole in the first frame, at 1600 by 900 and at 390 by 844, with nothing standing between it and the player.
3. The trail leaves the pad into the trees, and from the pad its first 30 m can be seen to go inland.
4. To either side of the strip the shore is sand, as it was, and the forest thins into it: no line where the grass stops.
5. Walking the trail to the first fork, no part of it is on sand.
6. From the road, a hundred metres along it, the strip reads as a wood that comes down to the road and not as a patch laid on the sand.
7. The car stands on the shoulder with its soft dark patch under it, on ground painted as the ground round it is.
8. Watched for two minutes from the pad and two from the first trees, no animal that walks is on the sand or the road.

On the worlds where the trees within 40 m of the pad are fewest (the sweep prints the least; find the seeds with `least.trees`), look at the arrival again: if the pad reads as open ground there, say so, with the count, and say what `STRIP_FOREST_FLOOR` was tried at on the running game and what it showed. The constant is not changed in this task.

- [ ] **Step 3: Write the note**

The commit looked at, the browser and its renderer string, and for each world what its stills showed and the eight checks, each met or missed. A check that is missed is reported as missed with what was seen; it is not re-worded until it passes.

- [ ] **Step 4: Revert the local edit and commit the note alone**

```bash
git checkout -- client/vite.config.ts
git status --short   # only the note
git add docs/trail/<date>-trail-from-the-treeline-verification.md
git commit
```

Message:

```
docs: record the trail from the treeline as it looks in the game

## What

The trailhead was looked at in the running game on six worlds, on the
high tier and the low. The note says what each view showed.

## How

- `docs/trail/<date>-trail-from-the-treeline-verification.md` — the
  commit, the browser, and for each world the view on arrival, from the
  road and from above, the trail walked to its first fork, and the
  animals watched from the pad and from the first trees.
```
