# Loops and Braids (T2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below the crest the trail becomes a web: the shipped stem-and-loops plus 2–3 parallel strands cross-linked by rungs, so a run home crosses 8–18 forks; the graph carries `forks`, `homeDist` and `shortestHome`, and a seeded guide walk can find a crest-to-pad route 1.5–2.5× the shortest on every seed.

**Architecture:** The builder's shared plumbing (graph state, path planning, routing, the simplifier, the stem geometry) moves out of `trailBuild.ts` into `sim/trailPlan.ts` unchanged, so a new `sim/trailBraid.ts` can route strands and rungs with the same machinery the loops use, and `trailBuild.ts` calls it after the loop stage. `sim/trailRoute.ts` gains the graph annotations (`homeDistances`, `forksOf`) and the guide walk, all pure functions of the graph. The current loop (register, Hollow, escalation) reads only the stem, which is untouched.

**Tech Stack:** TypeScript, vitest; `sim/` determinism rules (no trig, no `Math.pow`, no `**`, no `hypot` in `sim/`; `Math.sqrt` for lengths; every draw from `hash3` or a passed RNG).

**Spec:** `docs/gameplay/2026-09-16-the-summit.md` §3 (the trail), §5.3 (the guide, for the walk's rules), §10 (verification). The parent trail spec is `docs/trail/2026-09-11-trail-system.md`.

## Global Constraints

- Work in a fresh worktree off latest `origin/main` (`git worktree add -b worktree-t2-braid .claude/worktrees/t2-braid origin/main`). Stage explicit paths only; never `git add -A`.
- Commit messages use the repo's `## What` / `## How` shape (`.agents/skills/github-push/SKILL.md`), trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never cite any private process or tooling in code, comments, commits or docs. This repo is public.
- `sim/` never imports `net/`, `game/` or Babylon (ESLint enforces it). `sim/` determinism: no trig, no `Math.pow`, no `**`, no `Math.hypot`; `Math.sqrt` only.
- Every new constant that steers the graph lives in `BRAID_TUNABLES` and is folded into the level id in `olympic.ts` beside `FEATURE_TUNABLES`.
- A seed always gets a legal world: a strand or rung that cannot route is dropped, never forced, and never throws.
- The crest (`graph.summit`) stays the graph's only dead end; every feature disc stays disjoint from every edge; no two non-adjacent edges come within `TRAIL_EDGE_MIN_GAP` (16 m).
- Gates hold on the 227-seed sweep in `client/test/sim/trailSystem.test.ts`, red before and green after. A floor there is measured, never tuned to pass: if a gate misses, report the measured numbers in the task report rather than lowering it.
- A test tolerance never rewrites a rule from the spec. Fix the fixture.
- Run `npm run typecheck && npm run lint && npm test` from the repo root before the final task's commit. If the full suite times out under machine load, re-run the sweep files alone: `npx vitest run --root client test/sim/trailSystem.test.ts --maxWorkers=2`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/trailPlan.ts` (new) | The builder's plumbing, moved verbatim from `trailBuild.ts`: `BuildFrame`, `Heights`, `GraphState`, `Plan`, `Attempt`, `StemGeometry`, `StemSample`; `planPath`, `splitAt`, `markPath`, `routeTo`, `simplify`, `affectedEdges`, `composedMaxSlope`, `profileMaxSlope`, `cellsAlong`, `cellsBetween`, `restemProgress`, `stemGeometry`, `sampleStem`, `edgeLength`, `forEachCellNear`, `featureReach`. Plus the one addition Task 3 needs: an arrival exemption in `simplify`/`routeTo`. |
| `client/src/sim/trailBuild.ts` | Keeps `buildTrail`, the peak, the loop stage, the scenery pass, and now calls the braid stage and the annotation pass. Shrinks by ~600 lines. |
| `client/src/sim/trailBraid.ts` (new) | The braid: tunables, `BRAID_TUNABLES`, the stem pose helper, `buildStrands`, `buildRungs`. |
| `client/src/sim/trail.ts` | `EdgeKind` gains `"strand" \| "rung"`; `TrailGraph` gains `forks`, `homeDist`, `shortestHome`. |
| `client/src/sim/trailRoute.ts` | `homeDistances`, `forksOf`, `guideWalk`. |
| `client/src/sim/olympic.ts` | Folds `BRAID_TUNABLES` into the level id. |
| `client/test/sim/helpers/buildFrames.ts` (new) | The synthetic `BuildFrame`s (`ridgeFrame`, `flatFrame`, `narrowFrame`) shared by `trailBuild.test.ts` and `trailBraid.test.ts`. |
| `client/test/sim/trailBraid.test.ts` (new) | Strands and rungs on the flat frame. |
| `client/test/sim/trailRoute.test.ts` | `homeDistances`, `forksOf`, `guideWalk`. |
| `client/test/sim/trailSystem.test.ts` | The sweep gates. |
| `client/test/sim/helpers/registerGraph.ts`, `client/test/sim/trailRoute.test.ts` (`diamond`) | Fixtures gain the three new graph fields. |

---

### Task 1: Move the builder's plumbing into `trailPlan.ts`

A pure move. No behaviour changes; the existing tests are the test.

**Files:**
- Create: `client/src/sim/trailPlan.ts`
- Modify: `client/src/sim/trailBuild.ts`
- Test: `client/test/sim/trailBuild.test.ts`, `client/test/sim/trailRoute.test.ts` (unchanged; they must stay green)

**Interfaces:**
- Produces, exported from `trailPlan.ts` with exactly these names and their current signatures:
  - types `BuildFrame`, `Heights`, `Attempt`, `GraphState`, `Plan`, `StemGeometry`, `StemSample`
  - `planPath(base: GraphState, cells: readonly number[], grid: TrailGrid, frame: BuildFrame, H: Heights): Plan`
  - `splitAt(cell: number, grid: TrailGrid, frame: BuildFrame, H: Heights, state: GraphState): number`
  - `markPath(cells: readonly number[], grid: TrailGrid, frame: BuildFrame, tree: Uint8Array, treeEdges: Array<[number, number]>): void`
  - `routeTo(grid, frame, H, ground, state, tree, treeEdges, start, target, marked, weight): { ok: boolean; best: Attempt }`
  - `simplify(grid, frame, H, tree, treeEdges, cells): number[]`
  - `affectedEdges(plan: Plan): number[]`, `composedMaxSlope(...)`, `profileMaxSlope(...)`, `cellsAlong(...)`, `cellsBetween(...)`
  - `restemProgress(state: GraphState, summit: number): { stem: number[]; stemLen: number }`
  - `stemGeometry(state: GraphState, summit: number): StemGeometry`
  - `sampleStem(state: GraphState, geom: StemGeometry): StemSample[]`
  - `edgeLength(state: GraphState, ei: number): number`
  - `forEachCellNear(grid: TrailGrid, x: number, z: number, r: number, fn: (c: number, d2: number) => void): void`
  - `featureReach(f: { kind: string; radius: number }): number`
  - constants `SPLIT_SNAP`, `UNION_REACH`, `CHECK_STEP`
- `trailBuild.ts` re-exports the type: `export type { BuildFrame } from "./trailPlan.js";` so `trailBuild.test.ts`'s import keeps working.

- [ ] **Step 1: Run the two tests to record the baseline**

Run: `cd client && npx vitest run test/sim/trailBuild.test.ts test/sim/trailRoute.test.ts`
Expected: PASS (note the count of tests; it must be identical after the move).

- [ ] **Step 2: Create `trailPlan.ts`**

Create `client/src/sim/trailPlan.ts` with this header, then move the listed symbols below it **verbatim** (cut from `trailBuild.ts`, paste here, add `export`), keeping every doc comment with its symbol:

```ts
/**
 * The trail builder's plumbing, shared by the stages that route on the grid
 * (the stem and the loops in trailBuild.ts, the strands and rungs in
 * trailBraid.ts): the graph as it stands, a planned branch, routing with the
 * composed fine check, the simplifier, and the stem's geometry.
 *
 * Moved out of trailBuild.ts unchanged (2026-09-16) so the braid stage could
 * use it without a circular import. Nothing here decides where a trail goes;
 * the stages do.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { TerrainSample } from "./terrain.js";
import { TRAIL_Z_ANCHOR, BOWL_Z_HALF } from "./bowl.js";
import {
  cellAt, searchFrom, pathCells, TRAIL_GRID_CELL,
  type TrailGrid, type GroundFn,
} from "./trailGrid.js";
import {
  buildProfile, segmentDistance, segmentSegmentDistanceSq, trailCorridorD,
  TRAIL_HARD_SLOPE_MAX, TRAIL_SIMPLIFY_TOL, TRAIL_REROUTE_MAX, TRAIL_EDGE_MIN_GAP, TRAIL_CORRIDOR_HALF,
  type TrailNode, type TrailEdge,
} from "./trail.js";
import { MEADOW_RIM, POND_APRON } from "./features.js";
```

Symbols to move, in this order (each becomes `export`): `BuildFrame`, `Heights`, `Attempt`, `GraphState`, `Plan`, `StemGeometry`, `stemGeometry`, `edgeLength`, `forEachCellNear`, `featureReach`, `StemSample`, `sampleStem`, `routeTo`, `UNION_REACH`, `affectedEdges`, `composedMaxSlope`, `profileMaxSlope`, `cellsAlong`, `CHECK_STEP`, `cellsBetween`, `simplify`, `planPath`, `markPath`, `restemProgress`, `SPLIT_SNAP`, `splitAt`.

`Candidate` (used only by `rankCandidates`), `smoothedH`, `ringPassFraction`, `enclosesPoint`, `meanGradientInDisc`, `meanPreFeatureHeight` and `rankCandidates` **stay** in `trailBuild.ts`.

- [ ] **Step 3: Rewire `trailBuild.ts`**

Replace the moved definitions with one import and the re-export:

```ts
import {
  planPath, splitAt, markPath, routeTo, cellsAlong, restemProgress, stemGeometry, sampleStem,
  forEachCellNear, featureReach, SPLIT_SNAP,
  type BuildFrame, type Heights, type Attempt, type GraphState, type StemSample,
} from "./trailPlan.js";
export type { BuildFrame } from "./trailPlan.js";
```

Then delete from `trailBuild.ts`'s own import lists every symbol it no longer uses directly (`cellAt` stays — `buildTrail` calls it; `searchFrom`, `pathCells`, `buildProfile`, `segmentSegmentDistanceSq`, `trailCorridorD`, `TRAIL_HARD_SLOPE_MAX`, `TRAIL_SIMPLIFY_TOL`, `TRAIL_REROUTE_MAX`, `TRAIL_EDGE_MIN_GAP` go). `npm run lint` reports any unused import left behind; `npm run typecheck` reports any symbol still needed.

- [ ] **Step 4: Verify**

Run: `cd client && npx vitest run test/sim/trailBuild.test.ts test/sim/trailRoute.test.ts && cd .. && npm run typecheck && npm run lint`
Expected: PASS with the same test count as Step 1; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/trailPlan.ts client/src/sim/trailBuild.ts
git commit -m "refactor: move the trail builder's plumbing into trailPlan.ts"
```

(Write the `## What` / `## How` body: What — the braid stage needs the planner without a circular import; How — `trailPlan.ts` takes the listed symbols verbatim, `trailBuild.ts` imports them and re-exports `BuildFrame`.)

---

### Task 2: Graph annotations — `forks`, `homeDist`, `shortestHome`, the new edge kinds

**Files:**
- Modify: `client/src/sim/trail.ts:93-131`
- Modify: `client/src/sim/trailRoute.ts`
- Modify: `client/src/sim/trailBuild.ts` (the `return` at the end of `buildTrail`)
- Modify: `client/test/sim/helpers/registerGraph.ts`, `client/test/sim/trailRoute.test.ts` (fixtures)
- Test: `client/test/sim/trailRoute.test.ts`

**Interfaces:**
- Produces, in `trail.ts`:
  ```ts
  export type EdgeKind = "stem" | "loop" | "strand" | "rung";
  // TrailGraph gains:
  /** Every node of degree ≥ 3, ascending. */
  forks: number[];
  /** Per node index: the shortest trail distance to the pad (node 0), by arc length; Infinity if unreachable. */
  homeDist: number[];
  /** `homeDist[summit]`: the shortest crest-to-pad length. */
  shortestHome: number;
  ```
- Produces, in `trailRoute.ts`:
  ```ts
  export function homeDistances(nodes: readonly TrailNode[], edges: readonly TrailEdge[]): number[];
  export function forksOf(nodeCount: number, edges: readonly TrailEdge[]): number[];
  ```
  Both take nodes and edges rather than a `TrailGraph` because the builder calls them before the graph object exists.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/trailRoute.test.ts`:

```ts
import { homeDistances, forksOf } from "../../src/sim/trailRoute.js";

describe("homeDistances", () => {
  it("is 0 at the pad and the arc length along the stem elsewhere", () => {
    const g = graph(0);
    expect(homeDistances(g.nodes, g.edges)).toEqual([0, 100, 200, Infinity, Infinity, Infinity, Infinity]);
  });

  it("takes the shorter way when a loop offers one", () => {
    // Node 3 is 100 + 53.85 by the stem then the loop; node 4 is 100 + 53.85 + 60 that
    // way, or 200 + 53.85 via the crest — the loop wins.
    const g = graph(1);
    const d = homeDistances(g.nodes, g.edges);
    expect(d[3]).toBeCloseTo(100 + Math.sqrt(20 * 20 + 50 * 50), 6);
    expect(d[4]).toBeCloseTo(100 + Math.sqrt(20 * 20 + 50 * 50) + 60, 6);
  });
});

describe("forksOf", () => {
  it("lists every node of degree three or more, ascending", () => {
    expect(forksOf(graph(0).nodes.length, graph(0).edges)).toEqual([]);
    expect(forksOf(graph(1).nodes.length, graph(1).edges)).toEqual([1, 2]);
    expect(forksOf(graph(2).nodes.length, graph(2).edges)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/sim/trailRoute.test.ts`
Expected: FAIL — `homeDistances` / `forksOf` are not exported.

- [ ] **Step 3: Extend the types**

In `client/src/sim/trail.ts` replace the `EdgeKind` line and its comment:

```ts
/** stem: on the pad→crest chain; loop: on one of the made-feature loops;
 * strand: one of the braid's parallel descents between the top and bottom
 * forks; rung: a cross-link between two strands. Informational — the
 * corridor and the paint treat every edge alike. */
export type EdgeKind = "stem" | "loop" | "strand" | "rung";
```

Amend the `progress0`/`progress1` comment on `TrailEdge`:

```ts
  /** stem edges: progress (0 pad → 1 crest) at a and b. loop edges: the
   * nearer junction's progress, at both ends. strand and rung edges: the stem
   * progress of each end node's nearest stem point. */
```

Add to `TrailGraph`, after `fallbacks`:

```ts
  /** Every node of degree ≥ 3, ascending (trailRoute.ts `forksOf`). */
  forks: number[];
  /** Per node index: the shortest trail distance to the pad (node 0) by arc
   * length; Infinity if unreachable (trailRoute.ts `homeDistances`). */
  homeDist: number[];
  /** `homeDist[summit]`: the shortest crest-to-pad length. The guide walk's
   * band is a multiple of this. */
  shortestHome: number;
```

- [ ] **Step 4: Implement `homeDistances` and `forksOf`**

Append to `client/src/sim/trailRoute.ts`:

```ts
/**
 * The shortest trail distance from every node to the pad (node 0), by arc
 * length: Dijkstra from the pad over every edge. Infinity for a node no edge
 * chain reaches. The same settle order as `route` (lowest index among equal
 * distances), so it is bit-identical on every machine.
 */
export function homeDistances(nodes: readonly TrailNode[], edges: readonly TrailEdge[]): number[] {
  const n = nodes.length;
  const dist: number[] = new Array<number>(n).fill(Infinity);
  const done: boolean[] = new Array<boolean>(n).fill(false);
  if (n === 0) return dist;
  dist[0] = 0;
  for (let round = 0; round < n; round++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || (dist[i] as number) === Infinity) continue;
      if (u === -1 || (dist[i] as number) < (dist[u] as number)) u = i;
    }
    if (u === -1) break;
    done[u] = true;
    for (const e of edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v === -1 || done[v]) continue;
      const a = nodes[e.a] as TrailNode, b = nodes[e.b] as TrailNode;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = (dist[u] as number) + Math.sqrt(dx * dx + dz * dz);
      if (d < (dist[v] as number)) dist[v] = d;
    }
  }
  return dist;
}

/** Every node of degree ≥ 3, ascending: the forks the cut rule works on. */
export function forksOf(nodeCount: number, edges: readonly TrailEdge[]): number[] {
  const degree = new Array<number>(nodeCount).fill(0);
  for (const e of edges) {
    degree[e.a] = (degree[e.a] as number) + 1;
    degree[e.b] = (degree[e.b] as number) + 1;
  }
  const out: number[] = [];
  for (let n = 0; n < nodeCount; n++) if ((degree[n] as number) >= 3) out.push(n);
  return out;
}
```

- [ ] **Step 5: Fix the fixtures**

In `client/test/sim/helpers/registerGraph.ts`, the `g` literal gains `forks: [], homeDist: [], shortestHome: 200` and, at the end of the function before `return g;`:

```ts
  g.homeDist = homeDistances(g.nodes, g.edges);
  g.forks = forksOf(g.nodes.length, g.edges);
  g.shortestHome = g.homeDist[g.summit] as number;
```

with `import { homeDistances, forksOf } from "../../../src/sim/trailRoute.js";` at the top. In `trailRoute.test.ts`'s `diamond()` add `forks: [], homeDist: [0, 14.14, 14.14, 28.28], shortestHome: 28.28`.

- [ ] **Step 6: Annotate in the builder**

In `client/src/sim/trailBuild.ts`, import `{ homeDistances, forksOf } from "./trailRoute.js"` and replace the `return` at the end of `buildTrail` with:

```ts
  const homeDist = homeDistances(state.nodes, state.edges);
  return {
    graph: {
      nodes: state.nodes, edges: state.edges, trailhead: { x: thX, z: thZ, u: TRAILHEAD_U },
      summit, stem, loops, features, stemLen, fallbacks,
      forks: forksOf(state.nodes.length, state.edges),
      homeDist,
      shortestHome: homeDist[summit] as number,
    },
    landmarks,
    features,
  };
```

- [ ] **Step 7: Run tests, typecheck**

Run: `cd client && npx vitest run test/sim/trailRoute.test.ts test/sim/trailBuild.test.ts && cd .. && npm run typecheck`
Expected: PASS. Typecheck reports any other fixture that builds a `TrailGraph` literal (`grep -rln "fallbacks: 0" client/test` lists them); add the three fields there the same way, computing `homeDist`/`forks` with the two functions rather than by hand.

- [ ] **Step 8: Commit**

```bash
git add client/src/sim/trail.ts client/src/sim/trailRoute.ts client/src/sim/trailBuild.ts client/test/sim/trailRoute.test.ts client/test/sim/helpers/registerGraph.ts
git commit -m "feat: annotate the trail graph with its forks and home distances"
```

---

### Task 3: Strands

**Files:**
- Create: `client/src/sim/trailBraid.ts`
- Create: `client/test/sim/helpers/buildFrames.ts` (moved from `trailBuild.test.ts`)
- Modify: `client/src/sim/trailPlan.ts` (the arrival exemption in `simplify` and `routeTo`)
- Modify: `client/src/sim/trailBuild.ts` (call the stage after the loops, before scenery)
- Modify: `client/src/sim/olympic.ts:704-708` (fold `BRAID_TUNABLES`)
- Modify: `client/test/sim/trailBuild.test.ts` (import the frames from the helper)
- Test: `client/test/sim/trailBraid.test.ts`

**Interfaces:**
- Consumes from Task 1: everything in `trailPlan.ts`. From Task 2: `EdgeKind` `"strand"`.
- Produces:
  ```ts
  // trailBraid.ts
  export type Strand = { side: -1 | 0 | 1; top: number; bottom: number; nodes: number[] };
  export type BraidCtx = {
    seed: number; grid: TrailGrid; frame: BuildFrame; H: Heights; ground: GroundFn;
    tree: Uint8Array; treeEdges: Array<[number, number]>; features: readonly Feature[]; summit: number;
  };
  export function buildStrands(state: GraphState, ctx: BraidCtx): { state: GraphState; strands: Strand[]; topArc: number; bottomArc: number; samples: StemSample[] };
  export const BRAID_TUNABLES: Readonly<Record<string, number>>;
  ```
  `strands[0]` is always strand A (the stem between the forks, `side: 0`); the rest are built strands. `nodes` is each strand's node chain top → bottom as it stands when `buildStrands` returns (Task 4 splits these edges, so it reads positions off the nodes, never edge ids).
- `routeTo` gains a trailing optional parameter `arriveOnTree = false`; `simplify` gains a trailing optional `arrive: number | null = null` (the arrival cell whose tree edges are exempt from the gap test).

- [ ] **Step 1: Move the synthetic frames into a helper**

Create `client/test/sim/helpers/buildFrames.ts` containing, cut verbatim from `trailBuild.test.ts`: `ROAD_X`, `frame`, `ridgeFrame`, `RIPPLE_AMP`, `RIPPLE_PERIOD`, `ripple`, `flatFrame`, `narrowFrame`, with `export` on `ROAD_X`, `ridgeFrame`, `flatFrame`, `narrowFrame`, `frame`, and the imports they need (`BuildFrame` from `trailBuild.js`, `TerrainSample` type). In `trailBuild.test.ts` replace those definitions with `import { ROAD_X, frame, ridgeFrame, flatFrame, narrowFrame } from "./helpers/buildFrames.js";`.

Run: `cd client && npx vitest run test/sim/trailBuild.test.ts`
Expected: PASS, same count.

- [ ] **Step 2: Write the failing tests**

Create `client/test/sim/trailBraid.test.ts`:

```ts
/**
 * The braid on the flat frame: strands leave the stem at a top fork, rejoin at
 * a bottom fork, keep their lateral band, and keep every invariant the loops
 * keep (gap, disc disjointness, one dead end).
 */
import { describe, it, expect } from "vitest";
import { buildTrail } from "../../src/sim/trailBuild.js";
import { segmentSegmentDistanceSq, segmentDistance, TRAIL_EDGE_MIN_GAP, type TrailGraph } from "../../src/sim/trail.js";
import { stemProgress } from "../../src/sim/trailRoute.js";
import { BRAID_TOP_MIN, BRAID_TOP_MAX, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX, BRAID_LATERAL_MIN } from "../../src/sim/trailBraid.js";
import { flatFrame } from "./helpers/buildFrames.js";

/** A seed whose braid draw gives two strands on the flat frame, and one that gives three
 * (found by scanning seeds 1..40 once the stage exists; pin the first of each). */
const TWO = 1;
const THREE = 2;

function degreesOf(graph: TrailGraph): Map<number, number> {
  const d = new Map<number, number>();
  for (const e of graph.edges) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1); }
  return d;
}

/** The stem's nodes, pad first. */
function stemNodeSet(graph: TrailGraph): Set<number> {
  return new Set<number>([0, ...graph.stem.map((ei) => graph.edges[ei]!.b)]);
}

/**
 * Each extra strand as its node set: the connected components of the
 * kind-"strand" edges once the stem's own nodes (the top and bottom forks, where
 * every strand meets the stem) are removed. Rungs split a strand's edges and
 * add forks along it, so counting chains would over-count; components do not.
 * Each component also records the stem nodes it touches — its forks.
 */
function strandComponents(graph: TrailGraph): Array<{ nodes: number[]; forks: number[] }> {
  const stem = stemNodeSet(graph);
  const adj = new Map<number, number[]>();
  const touches = new Map<number, Set<number>>();
  for (const e of graph.edges) {
    if (e.kind !== "strand") continue;
    for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
      if (stem.has(p)) continue;
      if (stem.has(q)) { (touches.get(p) ?? touches.set(p, new Set()).get(p)!).add(q); continue; }
      (adj.get(p) ?? adj.set(p, []).get(p)!).push(q);
    }
  }
  const seen = new Set<number>();
  const out: Array<{ nodes: number[]; forks: number[] }> = [];
  const starts = new Set<number>([...adj.keys(), ...touches.keys()]);
  for (const s of starts) {
    if (seen.has(s)) continue;
    const nodes: number[] = [];
    const forks = new Set<number>();
    const stack = [s];
    seen.add(s);
    while (stack.length > 0) {
      const n = stack.pop()!;
      nodes.push(n);
      for (const f of touches.get(n) ?? []) forks.add(f);
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    out.push({ nodes: nodes.sort((p, q) => p - q), forks: [...forks].sort((p, q) => p - q) });
  }
  return out;
}

describe("buildStrands on the flat frame", () => {
  const two = buildTrail(TWO, flatFrame()).graph;
  const three = buildTrail(THREE, flatFrame()).graph;

  it("builds one extra strand for a two-strand seed and two for a three-strand seed", () => {
    expect(strandComponents(two)).toHaveLength(1);
    expect(strandComponents(three)).toHaveLength(2);
  });

  it("runs every strand from a top fork in the top band to a bottom fork in the bottom band", () => {
    for (const g of [two, three]) {
      for (const { forks } of strandComponents(g)) {
        expect(forks).toHaveLength(2);
        const ps = forks.map((f) => 1 - stemProgress(g, g.nodes[f]!.x, g.nodes[f]!.z)).sort((p, q) => p - q);
        const [lo, hi] = ps as [number, number];
        expect(hi).toBeGreaterThanOrEqual(BRAID_TOP_MIN - 0.03);
        expect(hi).toBeLessThanOrEqual(BRAID_TOP_MAX + 0.03);
        expect(lo).toBeGreaterThanOrEqual(BRAID_BOTTOM_MIN - 0.03);
        expect(lo).toBeLessThanOrEqual(BRAID_BOTTOM_MAX + 0.03);
      }
    }
  });

  it("gets at least BRAID_LATERAL_MIN off the stem somewhere along every strand", () => {
    for (const g of [two, three]) {
      const stemSegs = g.stem.map((ei) => { const e = g.edges[ei]!; return [g.nodes[e.a]!, g.nodes[e.b]!] as const; });
      for (const { nodes: chain } of strandComponents(g)) {
        let far = 0;
        for (const n of chain) {
          const p = g.nodes[n]!;
          let d = Infinity;
          for (const [a, b] of stemSegs) d = Math.min(d, segmentDistance(a.x, a.z, b.x, b.z, p.x, p.z));
          far = Math.max(far, d);
        }
        expect(far).toBeGreaterThanOrEqual(BRAID_LATERAL_MIN);
      }
    }
  });

  it("keeps the crest the only dead end and every non-adjacent edge pair apart", () => {
    for (const g of [two, three]) {
      const deg = degreesOf(g);
      const deadEnds = [...deg.entries()].filter(([n, d]) => d === 1 && n !== 0).map(([n]) => n);
      expect(deadEnds).toEqual([g.summit]);
      for (let i = 0; i < g.edges.length; i++) {
        for (let j = i + 1; j < g.edges.length; j++) {
          const e = g.edges[i]!, f = g.edges[j]!;
          if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
          const a = g.nodes[e.a]!, b = g.nodes[e.b]!, c = g.nodes[f.a]!, d = g.nodes[f.b]!;
          const d2 = segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z);
          expect(d2, `edges ${i} and ${j}`).toBeGreaterThanOrEqual(TRAIL_EDGE_MIN_GAP * TRAIL_EDGE_MIN_GAP * 0.99);
        }
      }
    }
  });

  it("keeps every non-peak feature disc off every edge", () => {
    for (const g of [two, three]) {
      for (const f of g.features) {
        if (f.kind === "peak") continue;
        for (const e of g.edges) {
          const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
          expect(segmentDistance(a.x, a.z, b.x, b.z, f.x, f.z)).toBeGreaterThanOrEqual(f.radius);
        }
      }
    }
  });

  it("labels strand edges with the stem progress of their ends' nearest stem points", () => {
    for (const e of two.edges) {
      if (e.kind !== "strand") continue;
      const a = two.nodes[e.a]!, b = two.nodes[e.b]!;
      expect(e.progress0).toBeCloseTo(1 - stemProgress(two, a.x, a.z), 6);
      expect(e.progress1).toBeCloseTo(1 - stemProgress(two, b.x, b.z), 6);
    }
  });
});
```

(`stemProgress` counts from the crest, so `1 - stemProgress` is progress from the pad. The `TWO`/`THREE` seeds are placeholders for whichever seeds Step 6 finds; both must be pinned before commit.)

- [ ] **Step 3: Run to verify they fail**

Run: `cd client && npx vitest run test/sim/trailBraid.test.ts`
Expected: FAIL — `trailBraid.js` does not exist.

- [ ] **Step 4: The arrival exemption in `trailPlan.ts`**

A strand starts on the tree (the top fork) and ends on it (the bottom fork). The simplifier's gap test already exempts the tree edges the branch *departs* from; it must also exempt the ones it *arrives* on, or the last segment is always "too close" to the bed it is joining. In `simplify`, change the signature to

```ts
function simplify(
  grid: TrailGrid, frame: BuildFrame, H: Heights,
  tree: Uint8Array, treeEdges: ReadonlyArray<[number, number]>, cells: readonly number[],
  arrive: number | null = null,
): number[] {
```

and replace the `exempt` computation with:

```ts
  const DEPART_REACH = TRAIL_GRID_CELL * Math.SQRT1_2;
  const ax0 = arrive === null ? NaN : (grid.x[arrive] as number), az0 = arrive === null ? NaN : (grid.z[arrive] as number);
  const exempt = treeEdges.map(([ea, eb]) => {
    const eax = grid.x[ea] as number, eaz = grid.z[ea] as number, ebx = grid.x[eb] as number, ebz = grid.z[eb] as number;
    if (segmentDistance(eax, eaz, ebx, ebz, dx0, dz0) <= DEPART_REACH) return true;
    // THE ARRIVAL IS EXEMPT LIKE THE DEPARTURE (2026-09-16): a strand or a rung
    // ends ON an existing bed, so its last segment is 0 m from that bed by
    // construction, exactly as its first is from the one it leaves.
    return arrive !== null && segmentDistance(eax, eaz, ebx, ebz, ax0, az0) <= DEPART_REACH;
  });
```

In `routeTo`, add a trailing parameter `arriveOnTree = false` and pass `arriveOnTree ? (branch[branch.length - 1] as number) : null` as `simplify`'s new argument. Both defaults keep every existing caller's behaviour bit-identical.

- [ ] **Step 5: Write `trailBraid.ts`**

```ts
/**
 * The braid — the descent below the crest as a web (2026-09-16).
 *
 * At a TOP FORK on the stem the trail splits into 2–3 STRANDS that descend
 * roughly in parallel, BRAID_LATERAL_MIN–MAX apart, and rejoin at a BOTTOM
 * FORK above the pad. RUNGS cross-link adjacent strands at seeded heights.
 * The original stem between the two forks is strand A. Every strand and rung
 * is routed on the walkability grid with the same machinery the loops use
 * (trailPlan.ts): the tree is forbidden except at the endpoints, feature
 * discs are forbidden, the two-cell rule keeps each new bed a corridor away
 * from every other, the simplifier keeps the gap, and the composed fine check
 * accepts or rejects. A strand or rung that cannot route is dropped — the
 * plan shrinks, a seed always gets a legal world.
 *
 * Where along the stem a cell "is" — its arc and its signed lateral offset —
 * comes from the nearest stem sample and that sample's tangent (`stemPose`),
 * not from the global pad→crest axis, so a stem that wanders keeps its
 * strands beside it rather than beside the chord.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import { hash3 } from "./field.js";
import { cellAt, TRAIL_GRID_CELL, type TrailGrid, type GroundFn } from "./trailGrid.js";
import { type TrailEdge, type TrailNode } from "./trail.js";
import { type Feature } from "./features.js";
import {
  planPath, splitAt, markPath, routeTo, forEachCellNear, featureReach, stemGeometry, sampleStem,
  type BuildFrame, type Heights, type GraphState, type StemSample,
} from "./trailPlan.js";

/** P(two strands); otherwise three. */
export const BRAID_STRANDS_WEIGHT_2 = 0.6;
/** The top fork's stem progress band: the last climb to the crest is one trail. */
export const BRAID_TOP_MIN = 0.75;
export const BRAID_TOP_MAX = 0.85;
/** The bottom fork's stem progress band: the strands rejoin above the pad. */
export const BRAID_BOTTOM_MIN = 0.08;
export const BRAID_BOTTOM_MAX = 0.15;
/** A strand's preferred lateral band off the stem (m). */
export const BRAID_LATERAL_MIN = 80;
export const BRAID_LATERAL_MAX = 200;
/** The search weight outside the lateral band, on the strand's own side. */
export const BRAID_OFF_BAND_COST = 2.5;
/** Within this of either fork a strand may cross the stem's line freely: it has to peel off and rejoin. */
export const BRAID_END_FREE = 40;
/** The tree is cleared this many cells round an arrival so the search can step onto it. */
export const BRAID_ARRIVE_CELLS = 2;
export const BRAID_SALT = 0xb2a1d;

export const BRAID_TUNABLES: Readonly<Record<string, number>> = {
  BRAID_STRANDS_WEIGHT_2, BRAID_TOP_MIN, BRAID_TOP_MAX, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX,
  BRAID_LATERAL_MIN, BRAID_LATERAL_MAX, BRAID_OFF_BAND_COST, BRAID_END_FREE, BRAID_ARRIVE_CELLS, BRAID_SALT,
};

/** A seeded value in [lo, hi] for braid draw `i`. */
export function braidDraw(seed: number, i: number, lo: number, hi: number): number {
  return lo + (hi - lo) * hash3(i, 0, 0, seed ^ BRAID_SALT);
}

export type Strand = { side: -1 | 0 | 1; top: number; bottom: number; nodes: number[] };
export type BraidCtx = {
  seed: number; grid: TrailGrid; frame: BuildFrame; H: Heights; ground: GroundFn;
  tree: Uint8Array; treeEdges: Array<[number, number]>; features: readonly Feature[]; summit: number;
};

/**
 * Where (x, z) stands relative to the stem: the arc of the nearest stem sample
 * and the signed lateral offset from that sample's tangent (left of the
 * pad→crest direction is positive).
 */
export function stemPose(samples: readonly StemSample[], x: number, z: number): { arc: number; lat: number } {
  let best = 0, bestD2 = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] as StemSample;
    const dx = x - s.x, dz = z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  const s = samples[best] as StemSample;
  const n = best + 1 < samples.length ? (samples[best + 1] as StemSample) : s;
  const p = best > 0 ? (samples[best - 1] as StemSample) : s;
  let tx = n.x - p.x, tz = n.z - p.z;
  const tl = Math.sqrt(tx * tx + tz * tz);
  if (tl > 1e-9) { tx /= tl; tz /= tl; } else { tx = 1; tz = 0; }
  return { arc: s.arc, lat: (x - s.x) * -tz + (z - s.z) * tx };
}

/** The nearest sample by arc. */
function sampleAtArc(samples: readonly StemSample[], arc: number): StemSample {
  let best = samples[0] as StemSample;
  for (const s of samples) if (Math.abs(s.arc - arc) < Math.abs(best.arc - arc)) best = s;
  return best;
}

/** A tree copy with the cells within `cells` grid cells of `c` cleared: the arrival's doorway. */
export function clearedAround(grid: TrailGrid, tree: Uint8Array, c: number, cells: number): Uint8Array {
  const out = tree.slice();
  forEachCellNear(grid, grid.x[c] as number, grid.z[c] as number, cells * TRAIL_GRID_CELL, (m) => { out[m] = 0; });
  return out;
}

/** The weight every braid search starts from: feature discs (plus apron and a
 * cell) forbidden, the tree forbidden except the start cell and the arrival's
 * doorway; 1 everywhere else. */
export function baseWeight(ctx: BraidCtx, tree: Uint8Array, start: number, arrival: number): Float32Array {
  const { grid } = ctx;
  const w = new Float32Array(grid.pass.length).fill(1);
  for (const f of ctx.features) {
    if (f.kind === "peak") continue;
    forEachCellNear(grid, f.x, f.z, featureReach(f) + TRAIL_GRID_CELL, (c) => { w[c] = 0; });
  }
  for (let c = 0; c < tree.length; c++) if (tree[c] === 1) w[c] = 0;
  w[start] = 1;
  forEachCellNear(grid, grid.x[arrival] as number, grid.z[arrival] as number, BRAID_ARRIVE_CELLS * TRAIL_GRID_CELL, (c) => {
    if (ctx.tree[c] === 1) w[c] = 1; // the doorway: the bed being joined, not a feature disc
  });
  return w;
}

/** The node chain from `from` along `firstEdge`, following degree-2 nodes until a node of another degree. */
export function chainFrom(state: GraphState, from: number, firstEdge: number): number[] {
  const degree = new Map<number, number>();
  const adj = new Map<number, Array<{ to: number; ei: number }>>();
  state.edges.forEach((e, ei) => {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, ei });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, ei });
  });
  const e0 = state.edges[firstEdge] as TrailEdge;
  const chain = [from];
  let prevEi = firstEdge, at = e0.a === from ? e0.b : e0.a;
  chain.push(at);
  while ((degree.get(at) ?? 0) === 2) {
    const next = (adj.get(at) ?? []).find((l) => l.ei !== prevEi);
    if (next === undefined) break;
    prevEi = next.ei;
    at = next.to;
    chain.push(at);
  }
  return chain;
}

/**
 * The strands. Draws the count and the two forks, splits the stem at both on
 * a copy of the graph, and routes each extra strand top → bottom on its own
 * side of the stem. Returns the graph as it stands (the original `state` if
 * no strand built — the fork splits are committed only with a strand) and
 * the strand list with strand A first.
 */
export function buildStrands(state: GraphState, ctx: BraidCtx): {
  state: GraphState; strands: Strand[]; topArc: number; bottomArc: number; samples: StemSample[];
} {
  const { seed, grid, frame, H, ground, tree, treeEdges, summit } = ctx;
  const geom = stemGeometry(state, summit);
  const samples = sampleStem(state, geom);
  const count = braidDraw(seed, 0, 0, 1) < BRAID_STRANDS_WEIGHT_2 ? 2 : 3;
  const topArc = geom.stemLen * braidDraw(seed, 1, BRAID_TOP_MIN, BRAID_TOP_MAX);
  const bottomArc = geom.stemLen * braidDraw(seed, 2, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX);
  const sTop = sampleAtArc(samples, topArc), sBot = sampleAtArc(samples, bottomArc);
  const cTop = cellAt(grid, frame.roadCenterX, sTop.x, sTop.z);
  const cBot = cellAt(grid, frame.roadCenterX, sBot.x, sBot.z);
  const none = { state, strands: [] as Strand[], topArc, bottomArc, samples };
  if (cTop < 0 || cBot < 0 || cTop === cBot) return none;

  // The forks, split into a copy: a world where no strand routes keeps its
  // unsplit stem.
  let base = planPath(state, [], grid, frame, H).state;
  const T = base.nodeOfCell.get(cTop) ?? splitAt(cTop, grid, frame, H, base);
  const B = base.nodeOfCell.get(cBot) ?? splitAt(cBot, grid, frame, H, base);
  if (T === B || T === summit || B === 0) return none;

  const firstSide: 1 | -1 = braidDraw(seed, 3, 0, 1) < 0.5 ? 1 : -1;
  const built: Strand[] = [];
  const tNode = base.nodes[T] as TrailNode, bNode = base.nodes[B] as TrailNode;
  for (let k = 1; k < count; k++) {
    const side: 1 | -1 = k === 1 ? firstSide : (firstSide === 1 ? -1 : 1);
    const tS = clearedAround(grid, tree, cBot, BRAID_ARRIVE_CELLS);
    const w = baseWeight(ctx, tree, cTop, cBot);
    for (let c = 0; c < w.length; c++) {
      if ((w[c] as number) === 0) continue;
      const x = grid.x[c] as number, z = grid.z[c] as number;
      const dT = (x - tNode.x) * (x - tNode.x) + (z - tNode.z) * (z - tNode.z);
      const dB = (x - bNode.x) * (x - bNode.x) + (z - bNode.z) * (z - bNode.z);
      if (dT < BRAID_END_FREE * BRAID_END_FREE || dB < BRAID_END_FREE * BRAID_END_FREE) continue;
      const { arc, lat } = stemPose(samples, x, z);
      // Only between the forks, and only on this strand's side.
      if (arc < bottomArc - BRAID_END_FREE || arc > topArc + BRAID_END_FREE || lat * side <= 0) { w[c] = 0; continue; }
      const a = lat < 0 ? -lat : lat;
      if (a < BRAID_LATERAL_MIN || a > BRAID_LATERAL_MAX) w[c] = BRAID_OFF_BAND_COST;
    }
    const marked: number[] = [];
    const r = routeTo(grid, frame, H, ground, base, tS, treeEdges, cTop, cBot, marked, w, true);
    for (const c of marked) grid.pass[c] = 1;
    if (!r.ok) continue;
    const plan = planPath(base, r.best.cells, grid, frame, H);
    if (plan.added.length === 0) continue;
    for (const ei of plan.added) (plan.state.edges[ei] as TrailEdge).kind = "strand";
    markPath(r.best.cells, grid, frame, tree, treeEdges);
    base = plan.state;
    built.push({ side, top: T, bottom: B, nodes: chainFrom(base, T, plan.added[0] as number) });
  }
  if (built.length === 0) return none;

  // Strand A: the stem between the forks, read off the split graph.
  const g2 = stemGeometry(base, summit);
  const iT = g2.stemNodes.indexOf(T), iB = g2.stemNodes.indexOf(B);
  const aNodes = g2.stemNodes.slice(Math.min(iT, iB), Math.max(iT, iB) + 1);
  if (iT < iB) aNodes.reverse();
  return { state: base, strands: [{ side: 0, top: T, bottom: B, nodes: aNodes }, ...built], topArc, bottomArc, samples };
}
```

- [ ] **Step 6: Call the stage from `buildTrail` and label progress**

In `client/src/sim/trailBuild.ts`, after the loop stage's closing `}` and **before** `const { stem, stemLen } = stemGeometry(state, summit);`, insert:

```ts
  // ---- The braid: strands between a top and a bottom fork ------------------
  const braid = buildStrands(state, {
    seed, grid, frame, H, ground, tree, treeEdges, features, summit,
  });
  state = braid.state;
```

Then, after `const { stem, stemLen } = stemGeometry(state, summit);`, label the braid edges' progress from the (now final) stem:

```ts
  // Strand and rung edges carry the stem progress of each end's nearest stem
  // point, so `nearestPointOnEdges` (register.ts) reads something sane on them.
  {
    const finalSamples = sampleStem(state, stemGeometry(state, summit));
    const progressAt = (n: TrailNode): number => stemLen > 0 ? stemPose(finalSamples, n.x, n.z).arc / stemLen : 0;
    for (const e of state.edges) {
      if (e.kind !== "strand" && e.kind !== "rung") continue;
      e.progress0 = progressAt(state.nodes[e.a] as TrailNode);
      e.progress1 = progressAt(state.nodes[e.b] as TrailNode);
    }
  }
```

with `import { buildStrands, stemPose } from "./trailBraid.js";`. (`restemProgress` replaces stem edge objects but never touches strand/rung objects, so writing through `e` is safe.)

In `client/src/sim/olympic.ts` import `BRAID_TUNABLES` from `./trailBraid.js` and add `...BRAID_TUNABLES,` after `...FEATURE_TUNABLES,` in the tunables object (line ~707).

- [ ] **Step 7: Find the seeds, pin them, run the tests**

Find a two-strand and a three-strand seed on the flat frame with a throwaway test file, `client/test/sim/braidScan.test.ts` (deleted before commit — never committed):

```ts
import { it } from "vitest";
import { buildTrail } from "../../src/sim/trailBuild.js";
import { flatFrame } from "./helpers/buildFrames.js";
it("scans", () => {
  for (let s = 1; s <= 40; s++) {
    const g = buildTrail(s, flatFrame()).graph;
    const strandNodes = new Set<number>();
    for (const e of g.edges) if (e.kind === "strand") { strandNodes.add(e.a); strandNodes.add(e.b); }
    console.info(s, "strand edges", g.edges.filter((e) => e.kind === "strand").length, "forks", g.forks.length);
  }
});
```

Run: `cd client && npx vitest run test/sim/braidScan.test.ts`, read the lines, then `rm test/sim/braidScan.test.ts`. Pin `TWO` to the first seed whose `strandComponents` count is 1 and `THREE` to the first whose count is 2 — confirm by running `trailBraid.test.ts` with the candidates. If **no** seed in 1..40 builds two extra strands, the flat frame's extent or the lateral band is the reason: report it in the task report with the printed counts, do not widen a band to make it pass.

Run: `cd client && npx vitest run test/sim/trailBraid.test.ts test/sim/trailBuild.test.ts test/sim/trailRoute.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add client/src/sim/trailBraid.ts client/src/sim/trailPlan.ts client/src/sim/trailBuild.ts client/src/sim/olympic.ts client/test/sim/trailBraid.test.ts client/test/sim/helpers/buildFrames.ts client/test/sim/trailBuild.test.ts
git commit -m "feat: braid the descent with seeded strands between two forks"
```

---

### Task 4: Rungs

**Files:**
- Modify: `client/src/sim/trailBraid.ts`
- Modify: `client/src/sim/trailBuild.ts` (call `buildRungs` after `buildStrands`)
- Test: `client/test/sim/trailBraid.test.ts`

**Interfaces:**
- Consumes from Task 3: `Strand`, `BraidCtx`, `stemPose`, `clearedAround`, `baseWeight`, `braidDraw`, the strand result's `samples`, `topArc`, `bottomArc`.
- Produces:
  ```ts
  export const BRAID_RUNGS_MIN = 2;
  export const BRAID_RUNGS_MAX = 3;
  export const BRAID_RUNG_GAP = 120;
  export const BRAID_RUNG_JITTER = 0.15;
  export const BRAID_RUNG_ALONG_HALF = 100;
  export function buildRungs(state: GraphState, ctx: BraidCtx, strands: readonly Strand[], samples: readonly StemSample[], topArc: number, bottomArc: number): { state: GraphState; rungs: number };
  ```

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/trailBraid.test.ts`:

```ts
import { BRAID_RUNG_GAP, BRAID_RUNGS_MAX } from "../../src/sim/trailBraid.js";

/** Rung chains: kind-"rung" edges walked fork to fork. */
function rungChains(graph: TrailGraph): number[][] {
  const adj = new Map<number, Array<{ to: number; ei: number }>>();
  graph.edges.forEach((e, ei) => {
    if (e.kind !== "rung") return;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, ei });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, ei });
  });
  const deg = degreesOf(graph);
  const seen = new Set<number>();
  const chains: number[][] = [];
  for (const [start, links] of adj) {
    if ((deg.get(start) ?? 0) < 3) continue;
    for (const { to, ei } of links) {
      if (seen.has(ei)) continue;
      const chain = [start];
      let prevEi = ei, at = to;
      seen.add(ei);
      chain.push(at);
      while ((deg.get(at) ?? 0) === 2) {
        const next = (adj.get(at) ?? []).find((l) => l.ei !== prevEi);
        if (next === undefined) break;
        seen.add(next.ei);
        prevEi = next.ei;
        at = next.to;
        chain.push(at);
      }
      chains.push(chain);
    }
  }
  return chains;
}

describe("buildRungs on the flat frame", () => {
  const two = buildTrail(TWO, flatFrame()).graph;
  const three = buildTrail(THREE, flatFrame()).graph;

  it("builds at least one rung per adjacent strand pair and never more than BRAID_RUNGS_MAX", () => {
    expect(rungChains(two).length).toBeGreaterThanOrEqual(1);
    expect(rungChains(two).length).toBeLessThanOrEqual(BRAID_RUNGS_MAX);
    expect(rungChains(three).length).toBeGreaterThanOrEqual(2);
    expect(rungChains(three).length).toBeLessThanOrEqual(2 * BRAID_RUNGS_MAX);
  });

  it("joins two different strands with every rung, and both ends are forks", () => {
    for (const g of [two, three]) {
      const deg = degreesOf(g);
      const strandOf = new Map<number, number>();
      strandComponents(g).forEach(({ nodes }, si) => { for (const n of nodes) strandOf.set(n, si); });
      const stem = stemNodeSet(g);
      for (const chain of rungChains(g)) {
        const a = chain[0]!, b = chain[chain.length - 1]!;
        expect(deg.get(a)).toBeGreaterThanOrEqual(3);
        expect(deg.get(b)).toBeGreaterThanOrEqual(3);
        // Strand A is the stem between the forks: owner -1. A built strand: its component index.
        const ownerA = stem.has(a) ? -1 : strandOf.get(a);
        const ownerB = stem.has(b) ? -1 : strandOf.get(b);
        expect(ownerA).toBeDefined();
        expect(ownerB).toBeDefined();
        expect(ownerA).not.toBe(ownerB);
      }
    }
  });

  it("spaces one pair's rungs at least BRAID_RUNG_GAP of stem apart", () => {
    // Only the two-strand world: with three strands the two pairs draw their
    // heights independently and may land near each other on strand A.
    const arcs = rungChains(two).map((chain) => {
      const a = two.nodes[chain[0]!]!;
      return (1 - stemProgress(two, a.x, a.z)) * two.stemLen;
    }).sort((p, q) => p - q);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]! - arcs[i - 1]!).toBeGreaterThanOrEqual(BRAID_RUNG_GAP - 2 * 8);
  });

  it("lands every world's fork count in the spec's band on these seeds", () => {
    expect(two.forks.length).toBeGreaterThanOrEqual(4);
    expect(three.forks.length).toBeGreaterThanOrEqual(6);
    expect(three.forks.length).toBeLessThanOrEqual(18);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/sim/trailBraid.test.ts`
Expected: FAIL — `BRAID_RUNG_GAP` is not exported; no `rung` edges.

- [ ] **Step 3: Implement `buildRungs`**

Append to `client/src/sim/trailBraid.ts` (and add the five constants to `BRAID_TUNABLES`):

```ts
/** Rungs per adjacent strand pair, inclusive. */
export const BRAID_RUNGS_MIN = 2;
export const BRAID_RUNGS_MAX = 3;
/** Least stem arc between two rungs of one pair, and between a rung and a fork (m). */
export const BRAID_RUNG_GAP = 120;
/** A rung's seeded slide off its even spacing, as a fraction of that spacing. */
export const BRAID_RUNG_JITTER = 0.15;
/** A rung's search may wander this far along the stem's arc from its height (m). */
export const BRAID_RUNG_ALONG_HALF = 100;

/** The point on a strand's node chain nearest a stem arc, as a grid cell on the tree
 * (the cell the chain passes through nearest that arc), or -1. */
function strandCellAtArc(grid: TrailGrid, frame: BuildFrame, state: GraphState, tree: Uint8Array, samples: readonly StemSample[], strand: Strand, arc: number): number {
  let best = -1, bestDiff = Infinity;
  for (let k = 0; k + 1 < strand.nodes.length; k++) {
    const a = state.nodes[strand.nodes[k] as number] as TrailNode, b = state.nodes[strand.nodes[k + 1] as number] as TrailNode;
    const L = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    const n = Math.max(1, Math.ceil(L / TRAIL_GRID_CELL));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const diff = Math.abs(stemPose(samples, x, z).arc - arc);
      if (diff >= bestDiff) continue;
      const c = cellAt(grid, frame.roadCenterX, x, z);
      if (c < 0 || tree[c] !== 1) continue;
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * The rungs: for each adjacent strand pair (sorted by side), 2–3 seeded
 * heights between the forks, each at least BRAID_RUNG_GAP of stem apart and
 * from either fork; each rung is routed from the pair's first strand to its
 * second inside a window of ±BRAID_RUNG_ALONG_HALF of its height, tree
 * forbidden except at its ends. A rung that cannot route, or whose height
 * cannot be found on both strands, is dropped.
 */
export function buildRungs(
  state: GraphState, ctx: BraidCtx, strands: readonly Strand[], samples: readonly StemSample[],
  topArc: number, bottomArc: number,
): { state: GraphState; rungs: number } {
  const { seed, grid, frame, H, ground, tree, treeEdges } = ctx;
  if (strands.length < 2) return { state, rungs: 0 };
  const ordered = strands.slice().sort((p, q) => p.side - q.side);
  let cur = state;
  let rungs = 0;
  for (let pi = 0; pi + 1 < ordered.length; pi++) {
    const X = ordered[pi] as Strand, Y = ordered[pi + 1] as Strand;
    const draw = braidDraw(seed, 10 + pi, 0, 1);
    const n = BRAID_RUNGS_MIN + Math.floor(draw * (BRAID_RUNGS_MAX - BRAID_RUNGS_MIN + 1));
    const lo = bottomArc + BRAID_RUNG_GAP, hi = topArc - BRAID_RUNG_GAP;
    if (hi - lo < BRAID_RUNG_GAP) continue;
    const spacing = (hi - lo) / (n + 1);
    let lastArc = -Infinity;
    for (let i = 0; i < n; i++) {
      const jitter = (braidDraw(seed, 20 + pi * 8 + i, 0, 1) - 0.5) * 2 * BRAID_RUNG_JITTER * spacing;
      const arc = lo + spacing * (i + 1) + jitter;
      if (arc - lastArc < BRAID_RUNG_GAP) continue;
      const cX = strandCellAtArc(grid, frame, cur, tree, samples, X, arc);
      const cY = strandCellAtArc(grid, frame, cur, tree, samples, Y, arc);
      if (cX < 0 || cY < 0 || cX === cY) continue;
      const tS = clearedAround(grid, tree, cY, BRAID_ARRIVE_CELLS);
      const w = baseWeight(ctx, tree, cX, cY);
      for (let c = 0; c < w.length; c++) {
        if ((w[c] as number) === 0) continue;
        const a = stemPose(samples, grid.x[c] as number, grid.z[c] as number).arc;
        if (a < arc - BRAID_RUNG_ALONG_HALF || a > arc + BRAID_RUNG_ALONG_HALF) w[c] = 0;
      }
      w[cX] = 1;
      const marked: number[] = [];
      const r = routeTo(grid, frame, H, ground, cur, tS, treeEdges, cX, cY, marked, w, true);
      for (const c of marked) grid.pass[c] = 1;
      if (!r.ok) continue;
      const plan = planPath(cur, r.best.cells, grid, frame, H);
      if (plan.added.length === 0) continue;
      for (const ei of plan.added) (plan.state.edges[ei] as TrailEdge).kind = "rung";
      markPath(r.best.cells, grid, frame, tree, treeEdges);
      cur = plan.state;
      lastArc = arc;
      rungs++;
    }
  }
  return { state: cur, rungs };
}
```

Note `strandCellAtArc` reads node **positions** off the strand's chain: `splitAt` inserts a node on the centreline of the split edge, so the chain's straight segments still lie on the bed after earlier rungs split them.

- [ ] **Step 4: Call it from the builder**

In `trailBuild.ts`, right after `state = braid.state;`:

```ts
  state = buildRungs(state, {
    seed, grid, frame, H, ground, tree, treeEdges, features, summit,
  }, braid.strands, braid.samples, braid.topArc, braid.bottomArc).state;
```

and add `buildRungs` to the import from `./trailBraid.js`.

- [ ] **Step 5: Run the tests**

Run: `cd client && npx vitest run test/sim/trailBraid.test.ts test/sim/trailBuild.test.ts`
Expected: PASS. If the strand tests from Task 3 now fail because a rung split changed which seeds give which strand counts, they must not: strand counts are drawn before rungs. If `rungChains(three).length < 2`, print per-rung rejection reasons once (a temporary `console.info`, removed before commit) and report.

- [ ] **Step 6: Commit**

```bash
git add client/src/sim/trailBraid.ts client/src/sim/trailBuild.ts client/test/sim/trailBraid.test.ts
git commit -m "feat: cross-link the braid's strands with seeded rungs"
```

---

### Task 5: The guide walk

**Files:**
- Modify: `client/src/sim/trailRoute.ts`
- Test: `client/test/sim/trailRoute.test.ts`

**Interfaces:**
- Consumes from Task 2: `homeDist`, `shortestHome` on `TrailGraph`.
- Produces:
  ```ts
  export const GUIDE_MIN = 1.5;
  export const GUIDE_MAX = 2.5;
  export const GUIDE_TRIES = 64;
  /** A crest → pad node path whose length is in [GUIDE_MIN, GUIDE_MAX] × shortestHome when one is found. */
  export function guideWalk(graph: TrailGraph, rand: () => number, min = GUIDE_MIN, max = GUIDE_MAX, tries = GUIDE_TRIES): { path: readonly number[]; length: number; inBand: boolean };
  export function pathLength(graph: TrailGraph, path: readonly number[]): number;
  ```
  `rand` returns a number in [0, 1); S3 passes `() => nextRandom(state)`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/trailRoute.test.ts`:

```ts
import { guideWalk, pathLength, GUIDE_MIN, GUIDE_MAX } from "../../src/sim/trailRoute.js";
import { nextRandom } from "../../src/sim/types.js";

/** A ladder: a stem 0→1→2→3 (three 100 m edges, summit 3) and a parallel strand
 * 1→4→5→2 (4 at (100,80), 5 at (200,80)) with a rung 4→... no: two rungs 1–4 and 2–5
 * make the strand; the far side 4→5 is 100 m. Round trips are possible: 3→2→5→4→1→0
 * is 100+80+100+80+100 = 460 vs the stem's 300. */
function ladder(): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 200, z: 0, h: 0, u: 0 }, { x: 300, z: 0, h: 0, u: 0 },
    { x: 100, z: 80, h: 0, u: 0 }, { x: 200, z: 80, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number, kind: TrailEdge["kind"]): TrailEdge =>
    ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
  const edges = [edge(0, 1, "stem"), edge(1, 2, "stem"), edge(2, 3, "stem"), edge(1, 4, "rung"), edge(4, 5, "strand"), edge(5, 2, "rung")];
  const homeDist = homeDistances(nodes, edges);
  return {
    nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 3, stem: [0, 1, 2], loops: [], features: [], stemLen: 300, fallbacks: 0,
    forks: forksOf(nodes.length, edges), homeDist, shortestHome: homeDist[3]!,
  };
}

describe("guideWalk", () => {
  it("returns a crest-to-pad walk in the band when one exists, never repeating an edge", () => {
    const g = ladder();
    const rng = { rngSeed: 7 };
    const walk = guideWalk(g, () => nextRandom(rng), 1.5, 1.6, 64);
    expect(walk.path[0]).toBe(3);
    expect(walk.path[walk.path.length - 1]).toBe(0);
    expect(walk.inBand).toBe(true);
    expect(walk.length).toBeCloseTo(460, 6);
    expect(walk.path).toEqual([3, 2, 5, 4, 1, 0]);
  });

  it("falls back to the longest walk under the cap, then to the shortest path", () => {
    const g = ladder();
    const rng = { rngSeed: 7 };
    // Nothing in [2, 2.5] × 300 exists (the longest simple walk is 460 = 1.53×):
    // the longest under the cap is returned, out of band.
    const under = guideWalk(g, () => nextRandom(rng), 2, 2.5, 16);
    expect(under.inBand).toBe(false);
    expect(under.length).toBeCloseTo(460, 6);
    // Nothing under 1.2× but the stem itself: the shortest path.
    const shortest = guideWalk(g, () => nextRandom(rng), 1.1, 1.2, 16);
    expect(shortest.inBand).toBe(false);
    expect(shortest.path).toEqual([3, 2, 1, 0]);
  });

  it("is deterministic in the RNG", () => {
    const g = ladder();
    const a = guideWalk(g, () => nextRandom({ rngSeed: 99 }), GUIDE_MIN, GUIDE_MAX, 8);
    const b = guideWalk(g, () => nextRandom({ rngSeed: 99 }), GUIDE_MIN, GUIDE_MAX, 8);
    expect(a).toEqual(b);
  });

  it("measures a path's length by arc", () => {
    expect(pathLength(ladder(), [3, 2, 1, 0])).toBeCloseTo(300, 6);
  });
});
```

(`nextRandom` takes `{ rngSeed }` and advances it. The first test's exact path holds because on the ladder every branch choice at node 2 that can still reach the pad under a 1.6× cap is either the stem (300, out of band, abandoned as too short only at the end) or the strand (460); with `rngSeed: 7` the walk that lands in band is the strand one — if the RNG's first draws pick the stem, the loop retries; 64 tries is far more than enough for a coin flip to come up once.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run test/sim/trailRoute.test.ts`
Expected: FAIL — `guideWalk` is not exported.

- [ ] **Step 3: Implement**

Append to `client/src/sim/trailRoute.ts`:

```ts
/** The guide's length band, as multiples of `shortestHome`, and how many walks to try. */
export const GUIDE_MIN = 1.5;
export const GUIDE_MAX = 2.5;
export const GUIDE_TRIES = 64;

/** A node path's arc length. */
export function pathLength(graph: TrailGraph, path: readonly number[]): number {
  let len = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = graph.nodes[path[i] as number] as TrailNode, b = graph.nodes[path[i + 1] as number] as TrailNode;
    const dx = b.x - a.x, dz = b.z - a.z;
    len += Math.sqrt(dx * dx + dz * dz);
  }
  return len;
}

/** True if `from` reaches node 0 without using any edge index in `used` (BFS). */
function reachesPad(graph: TrailGraph, from: number, used: ReadonlySet<number>): boolean {
  if (from === 0) return true;
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const n = stack.pop() as number;
    for (let ei = 0; ei < graph.edges.length; ei++) {
      if (used.has(ei)) continue;
      const e = graph.edges[ei] as TrailEdge;
      const m = e.a === n ? e.b : e.b === n ? e.a : -1;
      if (m === -1 || seen.has(m)) continue;
      if (m === 0) return true;
      seen.add(m);
      stack.push(m);
    }
  }
  return false;
}

/**
 * The guide: a seeded random walk crest → pad that never repeats an edge,
 * choosing at each node uniformly among the unused edges whose far node can
 * still reach the pad without a repeated edge, abandoned once it exceeds
 * `max` × shortestHome. The first walk whose length lands in
 * [min, max] × shortestHome is returned with `inBand: true`; otherwise the
 * longest walk found under the cap; otherwise the shortest path (the sweep
 * pins that last case to never happen on a built world). Deterministic in
 * `rand` (the host passes `() => nextRandom(state)`).
 */
export function guideWalk(
  graph: TrailGraph, rand: () => number, min = GUIDE_MIN, max = GUIDE_MAX, tries = GUIDE_TRIES,
): { path: readonly number[]; length: number; inBand: boolean } {
  const lo = min * graph.shortestHome, hi = max * graph.shortestHome;
  let best: { path: number[]; length: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const used = new Set<number>();
    const path = [graph.summit];
    let at = graph.summit, length = 0, dead = false;
    while (at !== 0) {
      const options: Array<{ ei: number; to: number; len: number }> = [];
      for (let ei = 0; ei < graph.edges.length; ei++) {
        if (used.has(ei)) continue;
        const e = graph.edges[ei] as TrailEdge;
        const to = e.a === at ? e.b : e.b === at ? e.a : -1;
        if (to === -1) continue;
        const trial = new Set(used);
        trial.add(ei);
        if (!reachesPad(graph, to, trial)) continue;
        const a = graph.nodes[e.a] as TrailNode, b = graph.nodes[e.b] as TrailNode;
        const dx = b.x - a.x, dz = b.z - a.z;
        options.push({ ei, to, len: Math.sqrt(dx * dx + dz * dz) });
      }
      if (options.length === 0) { dead = true; break; }
      const pick = options[Math.min(options.length - 1, Math.floor(rand() * options.length))] as { ei: number; to: number; len: number };
      used.add(pick.ei);
      length += pick.len;
      at = pick.to;
      path.push(at);
      if (length > hi) { dead = true; break; }
    }
    if (dead) continue;
    if (length >= lo && length <= hi) return { path: Object.freeze(path), length, inBand: true };
    if (best === null || length > best.length) best = { path, length };
  }
  if (best !== null) return { path: Object.freeze(best.path), length: best.length, inBand: false };
  const shortest = route(graph, graph.summit, 0);
  return { path: shortest, length: pathLength(graph, shortest), inBand: false };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd client && npx vitest run test/sim/trailRoute.test.ts`
Expected: PASS. If the first test's exact path differs, the RNG's draws on the ladder differ from the expectation; the walk is still correct if `inBand` is true and the length is 460 — pin the path the test prints, since determinism is the property, not the specific draw.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/trailRoute.ts client/test/sim/trailRoute.test.ts
git commit -m "feat: seeded guide walk on the trail graph"
```

---

### Task 6: The sweep gates

**Files:**
- Modify: `client/test/sim/trailSystem.test.ts`

**Interfaces:**
- Consumes: `forks`, `homeDist`, `shortestHome` (Task 2), `guideWalk`, `GUIDE_MIN`, `GUIDE_MAX`, `GUIDE_TRIES` (Task 5), `TRAIL_EDGE_MIN_GAP`.

- [ ] **Step 1: Add the gates**

Append inside the `describe` in `client/test/sim/trailSystem.test.ts`, with the imports `import { guideWalk, GUIDE_MIN, GUIDE_MAX, GUIDE_TRIES } from "../../src/sim/trailRoute.js";`, `import { nextRandom } from "../../src/sim/types.js";`, `TRAIL_EDGE_MIN_GAP` and `segmentSegmentDistanceSq` from `trail.js`:

```ts
    it("is connected on every seed, with a finite home distance from every node", () => {
      for (const { seed, graph } of worlds) {
        const unreachable = graph.homeDist.map((d, n) => (Number.isFinite(d) ? -1 : n)).filter((n) => n >= 0);
        expect({ seed, unreachable }).toEqual({ seed, unreachable: [] });
        expect(graph.shortestHome, `seed ${seed}`).toBe(graph.homeDist[graph.summit]);
        expect(graph.homeDist[0]).toBe(0);
      }
    });

    it("braids most worlds into the fork band and never past it", () => {
      // THE BAND IS THE SPEC'S (the summit design §3.5): 8–18 forks on a braided
      // world. A world whose strands all failed to route is a stem-and-loops world
      // and reads under 8; the floor below is the share of worlds that braided,
      // measured, not tuned.
      let inBand = 0;
      let forks = 0;
      for (const { seed, graph } of worlds) {
        expect(graph.forks.length, `seed ${seed}`).toBeLessThanOrEqual(18);
        expect(graph.forks.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
        if (graph.forks.length >= 8) inBand++;
        forks += graph.forks.length;
      }
      const frac = inBand / worlds.length;
      console.info(`[trailSystem] forks ≥ 8: ${inBand}/${worlds.length} = ${(frac * 100).toFixed(1)}%, mean ${(forks / worlds.length).toFixed(1)}`);
      expect(frac).toBeGreaterThanOrEqual(0.9);
    });

    it("finds a guide route in the band from the crest on every seed", () => {
      for (const { seed, graph } of worlds) {
        const rng = { rngSeed: seed };
        const walk = guideWalk(graph, () => nextRandom(rng), GUIDE_MIN, GUIDE_MAX, GUIDE_TRIES);
        expect({ seed, inBand: walk.inBand }).toEqual({ seed, inBand: true });
        expect(walk.path[0]).toBe(graph.summit);
        expect(walk.path[walk.path.length - 1]).toBe(0);
      }
    });

    it("keeps every non-adjacent edge pair a corridor apart, braid included", () => {
      for (const { seed, graph } of worlds) {
        const close: Array<[number, number]> = [];
        for (let i = 0; i < graph.edges.length; i++) {
          const e = graph.edges[i]!;
          const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
          for (let j = i + 1; j < graph.edges.length; j++) {
            const f = graph.edges[j]!;
            if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
            const c = graph.nodes[f.a]!, d = graph.nodes[f.b]!;
            if (segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) < TRAIL_EDGE_MIN_GAP * TRAIL_EDGE_MIN_GAP * 0.99) close.push([i, j]);
          }
        }
        expect({ seed, close }).toEqual({ seed, close: [] });
      }
    });

    it("builds a world in budget", () => {
      // Measured before the braid: ~460 ms/seed. The braid adds up to two strand
      // searches and up to six rung searches; the budget is a mean, printed so a
      // regression is visible before it is a timeout.
      const t0 = performance.now();
      for (const seed of SEEDS.slice(0, 20)) {
        const fresh = seed ^ 0x51ee7;
        bowlFor(fresh);
      }
      const perSeed = (performance.now() - t0) / 20;
      console.info(`[trailSystem] build time: ${perSeed.toFixed(0)} ms/seed over 20 fresh seeds`);
      expect(perSeed).toBeLessThanOrEqual(1200);
    });
```

The 20 fresh seeds (`seed ^ 0x51ee7`) are built here because the sweep's own worlds were built at the top of the file and their time is not observable per seed.

- [ ] **Step 2: Raise the file's timeout**

Change `{ timeout: 300_000 }` to `{ timeout: 600_000 }` on the `describe` — 227 worlds at up to ~1 s each, plus the 20 fresh ones. Do the same in any other sweep file that fails on time in Step 3 (`registerSweep.test.ts`, `signsSweep.test.ts`, `trailBed.test.ts`, `trailhead.test.ts` all build the same 227 worlds).

- [ ] **Step 3: Run the sweep**

Run: `cd client && npx vitest run test/sim/trailSystem.test.ts --maxWorkers=2`
Expected: PASS, with the four `console.info` lines. If "forks ≥ 8" reads under 90 %, or the guide misses the band on some seed, or a gap violation appears, **do not lower the floor**: capture the failing seeds and the printed numbers in the task report. The controller rules on whether it is a builder defect or a lever (`BRAID_LATERAL_*`, `BRAID_OFF_BAND_COST`, `BRAID_RUNG_ALONG_HALF`) to move, and moves it in a fix round with the before/after numbers recorded.

- [ ] **Step 4: Run every sweep file and the loop rate**

Run: `cd client && npx vitest run test/sim/trailSystem.test.ts test/sim/trailBed.test.ts test/sim/trailhead.test.ts test/sim/registerSweep.test.ts test/sim/signsSweep.test.ts --maxWorkers=2`
Expected: PASS. The existing "builds at least one loop on most seeds" floor (`withLoop / worlds ≥ …`) must still hold — the braid runs after the loops and cannot lower it.

- [ ] **Step 5: Commit**

```bash
git add client/test/sim/trailSystem.test.ts
git commit -m "test: gate the braid on the 227-seed sweep"
```

---

### Task 7: Docs, status lines, full suite

**Files:**
- Modify: `docs/gameplay/2026-09-16-the-summit.md` (§9 status row for T2; §3's Status note if numbers moved)
- Modify: `docs/trail/2026-09-11-trail-system.md` (Status line: extended by the braid, pointer to the summit spec)
- Modify: `ARCHITECTURE.md` (the trail graph paragraph, if it names the graph's shape)

- [ ] **Step 1: Update the docs**

In `docs/gameplay/2026-09-16-the-summit.md` §9, change T2's status cell to `Built <date> (docs/trail/2026-09-16-loops-and-braids-plan.md)` and, if any lever moved during Task 6, add to the file's `**Status:**` line one sentence per number that moved, in the form the Hollow spec uses ("What moved in execution: …"). In `docs/trail/2026-09-11-trail-system.md`, append to the `**Status:**` line: `Extended 2026-09-16 by the braid — strands and rungs below the crest, docs/gameplay/2026-09-16-the-summit.md §3.` In `ARCHITECTURE.md`, run `grep -n "stem\|loop" ARCHITECTURE.md`; where it describes the graph as "a stem and loops", add "and, below the crest, a braid of strands and rungs".

- [ ] **Step 2: Full gates**

Run from the repo root: `npm run typecheck && npm run lint && npm test`
Expected: all green. A timeout in a sweep file under load is environmental — re-run that file alone with `--maxWorkers=2` and report both runs.

- [ ] **Step 3: Scan and commit**

Run the pre-push scan (the repository's pre-push hook runs it; run the hook's command by hand from the worktree root) and confirm it is clean.
Expected: clean. Then:

```bash
git add docs/gameplay/2026-09-16-the-summit.md docs/trail/2026-09-11-trail-system.md ARCHITECTURE.md
git commit -m "docs: record the braid as built"
```

---

## Self-review

**Spec coverage (§3):** 3.1 what stays — Task 1 moves code without changing it, Task 3 runs after the loops. 3.2 top/bottom fork bands, 2–3 strands with weights, lateral 80–200, rungs 2–3 per pair ≥ 120 m apart — Tasks 3 and 4's constants. Loops off strands (3.3 step 4) — **deferred out of T2** by ruling recorded in the spec amendment that ships with this plan: the fork band is met without it and it needs the loop stage made spine-generic, a refactor with its own risk; it is a follow-up, not part of this plan. Strands and rungs avoid feature discs — `baseWeight`. 3.3 order — peak, stem, loops, strands, rungs, annotate. 3.4 forks/EdgeKind/homeDist/shortestHome — Task 2; tunables folded — Task 3 Step 6. 3.5 gates — Task 6 (connected, only dead end via the existing test, fork band, loop rate via the existing test, guide band, fallbacks via the existing test, build time). 3.6 standalone — nothing reads strand/rung edges but the paint, which treats every edge alike.

**Placeholder scan:** `TWO`/`THREE` seeds are found in Task 3 Step 7 and pinned before commit; the exact guide path in Task 5 is pinned from the run if the RNG's draw differs. No TBDs.

**Type consistency:** `routeTo(..., weight, arriveOnTree)` — Task 3 Step 4 defines it, Steps 5 and Task 4 Step 3 call it with `true`. `Strand.nodes` — defined in Task 3, read by `strandCellAtArc` in Task 4. `guideWalk` returns `{ path, length, inBand }` — Task 6 reads `inBand` and `path`. `forksOf(nodeCount, edges)` / `homeDistances(nodes, edges)` — the same argument order in Tasks 2, 5 and the fixtures.
