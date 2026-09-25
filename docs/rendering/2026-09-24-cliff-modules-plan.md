# Cliff Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dress ground that is both rock and too steep to stand on with instanced rock-wall modules drawn at three LODs out to 400 m, renderer-only, so the steep faces read as ledged rock with a broken skyline.

**Architecture:** A pure placement field (`cliffField.ts`: cell → instance, gate, footprint, bands, memoising collector) feeds a Babylon shell (`cliffMeshes.ts`: six thin-instance buckets from the two GLBs' three LOD roots, a far bucket that dithers out, ground tint through a small fragment-only plugin). The renderer creates it beside the other fields, registers its casters, and updates it at both per-frame sites. Nothing under `sim/` changes.

**Tech Stack:** TypeScript, Babylon.js 9.18 (thin instances, `MaterialPluginBase`), Vitest with `NullEngine`.

**Spec:** `docs/rendering/2026-09-24-cliff-modules-design.md` — the binding authority; every constant below is copied from it.

## Global Constraints

- No file under `client/src/sim/` changes. The `CLUTTER_TUNABLES` digest pinned in `client/test/sim/groundGradient.test.ts` is unchanged (the level id does not move).
- Never mention how the models were produced, and never use process vocabulary (sessions, agents, reviews, briefs, tasks, plans, rulings, "the owner") in code, comments, docs or commit messages. The repository is public.
- Stage explicit paths only — never `git add -A` or `git add .`.
- The repository's pre-push scan must pass on every commit; run it after each one, not only before the push.
- Before every commit: `npm run typecheck` green, the touched test files green (`cd client && npx vitest run <files>`), and `npx eslint <touched files>` clean.
- `scale` is a multiplier on the model's own size, never a length. The metre bands in the spec become scale factors only through `CLIFF_MODEL_WIDTH` / `CLIFF_MODEL_HEIGHT`.
- Commit message format: `<type>: <subject under 72 chars>`, blank line, `## What` paragraph, `## How` list with each entry led by a backticked path, blank line, then `Co-Authored-By: <your model name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1`.
- Never run a rendering game page while the suite runs (a rendering page starves vitest).
- Work in `/Users/csarko/Projects/game-dayhike/.claude/worktrees/cliff-modules` on `worktree-cliff-modules`; the models are already committed there (`001e7bc`).

Measured facts the code relies on (from the built GLBs, `LOD0` root): `cliff.wall_a` spans x −3.87..4.40, y −0.42..4.54, z −3.61..0.77 (8.27 × 4.96 × 4.38 m); `cliff.wall_b` spans x −9.68..10.55, y −0.16..7.01, z −4.39..2.19 (20.23 × 7.17 × 6.58 m). The scanned face points +Z on both. Each LOD root holds exactly one geometry mesh with one material.

Yaw convention (from `client/src/game/freecam.ts` and `groundTilt.ts`): yaw 0 faces +Z; the forward vector is `(sin yaw, cos yaw)` in XZ and the right vector is `(cos yaw, −sin yaw)`. `instanceMatrixFor` derives yaw as `inst.hash · 2π`, so a cliff instance stores its yaw in `hash` as a fraction of a turn.

---

### Task 1: The placement field

**Files:**
- Create: `client/src/game/cliffField.ts`
- Test: `client/test/game/cliffField.test.ts`

**Interfaces:**
- Consumes: `elevationSampleAt(seed, x, z): TerrainSample` (`sim/terrain.ts`), `groundCover(seed, x, z, s).duff` and `CLUTTER_ROCK`, `ClutterInstance` (`sim/clutter.ts`), `forestDensity(seed, x, z, s)` (`sim/vegetation.ts`), `classifySurface(seed, x, z, h, slope, canopy, duff).weights.rock` (`game/terrainSurface.ts`), `latticeHash(ci, cj)` (`game/groundHexParams.ts`), `GROUND_NORMAL_Y` (`sim/constants.ts`).
- Produces: `cliffCell(seed, ci, cj): ClutterInstance | null`, `cliffCellPoint(ci, cj): { x, z }`, `cliffGate(seed, x, z): { s: TerrainSample; rock: number; open: boolean }`, `cliffYaw(s)`, and the constants `CLIFF_CELL`, `CLIFF_JITTER`, `CLIFF_STAND_MARGIN`, `CLIFF_ROCK_MIN`, `CLIFF_DENSITY`, `CLIFF_SCALE`, `CLIFF_YAW_JITTER`, `CLIFF_SINK`, `CLIFF_LONG_NEIGHBOURS`, `CLIFF_MODELS`, `CLIFF_MODEL_WIDTH`, `CLIFF_MODEL_DEPTH`, `CLIFF_MODEL_HEIGHT`, `CLIFF_WALL_A`, `CLIFF_WALL_B`. Task 2 builds the collector on `cliffCell`; Task 4 reads the model tables.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/cliffField.test.ts
import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { GROUND_NORMAL_Y } from "../../src/sim/constants.js";
import { CLUTTER_ROCK } from "../../src/sim/clutter.js";
import { elevationSampleAt } from "../../src/sim/terrain.js";
import {
  CLIFF_CELL, CLIFF_DENSITY, CLIFF_MODEL_DEPTH, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_WIDTH, CLIFF_ROCK_MIN,
  CLIFF_SCALE, CLIFF_SINK, CLIFF_STAND_MARGIN, CLIFF_WALL_A, CLIFF_WALL_B, CLIFF_YAW_JITTER,
  cliffCell, cliffCellPoint, cliffGate, cliffYaw,
} from "../../src/game/cliffField.js";

/** Seed 1's worst 400 m disc for steep rock (5,549 four-metre cells), from
 * the census in the design's §5. */
const WORST = { seed: 1, x: 1100, z: -1200 };

function normalY(dx: number, dz: number): number {
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

/** Every module the field places within `r` metres of (x, z). */
function modulesIn(seed: number, x: number, z: number, r: number) {
  const out: NonNullable<ReturnType<typeof cliffCell>>[] = [];
  for (let cj = Math.floor((z - r) / CLIFF_CELL); cj <= Math.floor((z + r) / CLIFF_CELL); cj++) {
    for (let ci = Math.floor((x - r) / CLIFF_CELL); ci <= Math.floor((x + r) / CLIFF_CELL); ci++) {
      const m = cliffCell(seed, ci, cj);
      if (m !== null && Math.hypot(m.x - x, m.z - z) < r) out.push(m);
    }
  }
  return out;
}

describe("cliffGate", () => {
  it("opens only below the stand limit by a margin, and only on rock", () => {
    let open = 0, closed = 0;
    for (let z = -1500; z < 1500; z += 40) {
      for (let x = -1500; x < 1500; x += 40) {
        const g = cliffGate(WORST.seed, x, z);
        const ny = normalY(g.s.dx, g.s.dz);
        if (g.open) {
          open++;
          expect(ny).toBeLessThan(GROUND_NORMAL_Y - CLIFF_STAND_MARGIN);
          expect(g.rock).toBeGreaterThanOrEqual(CLIFF_ROCK_MIN);
        } else {
          closed++;
          expect(ny >= GROUND_NORMAL_Y - CLIFF_STAND_MARGIN || g.rock < CLIFF_ROCK_MIN).toBe(true);
        }
      }
    }
    // Teeth: both branches ran on real ground.
    expect(open).toBeGreaterThan(20);
    expect(closed).toBeGreaterThan(1000);
  });
});

describe("cliffCell", () => {
  it("never stands where a foot can go: every footprint probe is steep rock", () => {
    // 200 worlds, every module within 400 m of the origin's neighbourhood
    // on each, probed at its centre and its four footprint points with the
    // gate itself. Red until the footprint check exists: a module a cell
    // wide can straddle the edge of a face.
    let modules = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const m of modulesIn(seed, 0, 0, 400)) {
        modules++;
        const yaw = m.hash * Math.PI * 2;
        const hw = (CLIFF_MODEL_WIDTH[m.variant] as number) * m.scale / 2;
        const hd = (CLIFF_MODEL_DEPTH[m.variant] as number) * m.scale / 2;
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const probes: [number, number][] = [
          [m.x, m.z],
          [m.x + rx * hw, m.z + rz * hw], [m.x - rx * hw, m.z - rz * hw],
          [m.x + fx * hd, m.z + fz * hd], [m.x - fx * hd, m.z - fz * hd],
        ];
        for (const [px, pz] of probes) expect(cliffGate(seed, px, pz).open, `seed ${seed} at ${px},${pz}`).toBe(true);
      }
    }
    // Teeth: the sweep found faces to test (measured: well over a thousand
    // across 200 worlds at a 12 m lattice and density 0.5).
    expect(modules).toBeGreaterThan(300);
  });

  it("is a pure function of (seed, cell) and differs by world", () => {
    let placed = 0, differ = 0;
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 200)) {
      placed++;
      const ci = Math.floor(m.x / CLIFF_CELL), cj = Math.floor(m.z / CLIFF_CELL);
      const again = cliffCell(WORST.seed, ci, cj);
      expect(again).toEqual(m);
      const other = cliffCell(WORST.seed + 1, ci, cj);
      if (other === null || other.x !== m.x || other.hash !== m.hash || other.scale !== m.scale) differ++;
    }
    expect(placed).toBeGreaterThan(20);
    expect(differ).toBe(placed);
  });

  it("faces downslope, within the yaw jitter, and is shaped as a lying rock instance", () => {
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 300)) {
      expect(m.cls).toBe(CLUTTER_ROCK);
      expect(m.variant === CLIFF_WALL_A || m.variant === CLIFF_WALL_B).toBe(true);
      expect(m.scale).toBeGreaterThanOrEqual(CLIFF_SCALE[0]);
      expect(m.scale).toBeLessThanOrEqual(CLIFF_SCALE[1]);
      expect(m.hash).toBeGreaterThanOrEqual(0);
      expect(m.hash).toBeLessThan(1);
      const s = elevationSampleAt(WORST.seed, m.x, m.z);
      const yaw = m.hash * Math.PI * 2;
      // The forward vector (sin yaw, cos yaw) points down the gradient.
      const down = Math.atan2(-s.dx, -s.dz);
      let d = yaw - down;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      expect(Math.abs(d)).toBeLessThanOrEqual(CLIFF_YAW_JITTER + 1e-9);
      expect(cliffYaw(s)).toBeCloseTo(down, 12);
      // The ground fields carry the sink: the instance sits CLIFF_SINK of its
      // rendered height below the sampled ground.
      const height = (CLIFF_MODEL_HEIGHT[m.variant] as number) * m.scale;
      expect(m.groundH).toBeCloseTo(s.h - CLIFF_SINK * height, 9);
      expect(m.groundDx).toBe(s.dx);
      expect(m.groundDz).toBe(s.dz);
    }
  });

  it("takes the long module where three neighbours are steep rock, the short one elsewhere", () => {
    let long = 0, short = 0;
    for (const m of modulesIn(WORST.seed, WORST.x, WORST.z, 300)) {
      let steepNeighbours = 0;
      for (const [ox, oz] of [[CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL]] as const) {
        if (cliffGate(WORST.seed, m.x + ox, m.z + oz).open) steepNeighbours++;
      }
      if (m.variant === CLIFF_WALL_B) {
        long++;
        expect(steepNeighbours).toBeGreaterThanOrEqual(3);
      } else {
        short++;
      }
    }
    // Both models are used on this face.
    expect(long).toBeGreaterThan(5);
    expect(short).toBeGreaterThan(5);
  });

  it("draws about half of the qualifying cells, before any terrain sample", () => {
    let qualifying = 0, placed = 0;
    const r = 400;
    for (let cj = Math.floor((WORST.z - r) / CLIFF_CELL); cj <= Math.floor((WORST.z + r) / CLIFF_CELL); cj++) {
      for (let ci = Math.floor((WORST.x - r) / CLIFF_CELL); ci <= Math.floor((WORST.x + r) / CLIFF_CELL); ci++) {
        const p = cliffCellPoint(ci, cj);
        if (Math.hypot(p.x - WORST.x, p.z - WORST.z) >= r) continue;
        if (!cliffGate(WORST.seed, p.x, p.z).open) continue;
        qualifying++;
        if (cliffCell(WORST.seed, ci, cj) !== null) placed++;
      }
    }
    // The density draw alone keeps CLIFF_DENSITY of them; the footprint check
    // then drops the ones at a face's edge, so the share sits under the draw
    // but not by much on a face this wide (measured on this disc: see the
    // verification doc). Bounds from the design's §7: 40–60 % of the draw.
    expect(qualifying).toBeGreaterThan(200);
    expect(placed / qualifying).toBeGreaterThan(CLIFF_DENSITY * 0.6);
    expect(placed / qualifying).toBeLessThan(CLIFF_DENSITY * 1.2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/cliffField.test.ts`
Expected: FAIL — `Cannot find module '../../src/game/cliffField.js'`.

- [ ] **Step 3: Write the field without the footprint check**

```ts
// client/src/game/cliffField.ts
/**
 * Where the cliff modules stand: a pure function of the world.
 *
 * The steep rock hillsides are a smooth sheet with a rock texture on them,
 * and no paint breaks a silhouette. This field seats rock-wall models on
 * ground that is BOTH rock and too steep to stand on, so the faces grow
 * ledges and the skyline breaks. The one rule everything here serves: a
 * module never stands where a foot can go. The gate is the simulation's own
 * stand limit (`GROUND_NORMAL_Y`) with a margin, read at the module's centre
 * and at the four corners of its footprint, so sight and collision never
 * disagree underfoot. Renderer-only: it reads the simulation and writes
 * nothing back. Nothing here may migrate into sim/.
 */
import { GROUND_NORMAL_Y } from "../sim/constants.js";
import { CLUTTER_ROCK, groundCover, type ClutterInstance } from "../sim/clutter.js";
import { elevationSampleAt, type TerrainSample } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { latticeHash } from "./groundHexParams.js";
import { classifySurface } from "./terrainSurface.js";

/** Lattice cell (m). One module at most per cell. */
export const CLIFF_CELL = 12;
/** Jitter of a module inside its cell, as a fraction of the cell, per axis. */
export const CLIFF_JITTER = 0.5;
/** How far below the stand limit the ground must be (in normal-y) before a
 * module may stand on it: a margin so a module never stands on the last
 * centimetre a foot can. */
export const CLIFF_STAND_MARGIN = 0.03;
/** Rock weight (`classifySurface`) a spot needs before a module stands on it,
 * so a module can never stand off the texture it belongs to. Above the snow
 * line the rock weight fades and the modules stop with the paint. */
export const CLIFF_ROCK_MIN = 0.8;
/** Share of the qualifying cells that carry a module. Drawn first, before a
 * terrain sample, so the cheap rejection comes first. */
export const CLIFF_DENSITY = 0.5;
/** Scale band a module draws from its cell hash — a multiplier on the model's
 * own size, not a length. */
export const CLIFF_SCALE: readonly [number, number] = [0.8, 1.3];
/** Yaw jitter (rad) either side of straight downslope, so a run of modules
 * is not a fence. */
export const CLIFF_YAW_JITTER = 0.3;
/** How far a module is pushed into the ground, as a fraction of its rendered
 * height: the base is buried, the ledges above ground are what shows. */
export const CLIFF_SINK = 0.35;
/** Neighbours (of four, at `CLIFF_CELL`) that must be steep rock for the long
 * module to be chosen over the short one. */
export const CLIFF_LONG_NEIGHBOURS = 3;
/** The two models, by variant index. */
export const CLIFF_WALL_A = 0;
export const CLIFF_WALL_B = 1;
export const CLIFF_MODELS: readonly string[] = ["models/cliff.wall_a.glb", "models/cliff.wall_b.glb"];
/** Each model's own size at scale 1, in metres, from its `LOD0` mesh: the
 * extent along its width (x), its depth (z) and its height (y). `scale` is a
 * multiplier on the model, so a band in metres means metres only once
 * divided by these. */
export const CLIFF_MODEL_WIDTH: readonly number[] = [8.27, 20.23];
export const CLIFF_MODEL_DEPTH: readonly number[] = [4.38, 6.58];
export const CLIFF_MODEL_HEIGHT: readonly number[] = [4.96, 7.17];

/** One of a cell's draws: the lattice hash on salted indices. The salts
 * (307, 331) are this field's own, so its draws never correlate with the
 * tree, blade or litter lattices beside it. */
function cellDraw(ci: number, cj: number, salt: number): number {
  return latticeHash(ci + 307 * salt, cj + 331 * salt);
}

/** Where cell (ci, cj)'s candidate stands, jittered inside the cell. */
export function cliffCellPoint(ci: number, cj: number): { x: number; z: number } {
  return {
    x: (ci + 0.5 + CLIFF_JITTER * (cellDraw(ci, cj, 1) - 0.5)) * CLIFF_CELL,
    z: (cj + 0.5 + CLIFF_JITTER * (cellDraw(ci, cj, 2) - 0.5)) * CLIFF_CELL,
  };
}

/**
 * The gate at one spot: the terrain sample, the rock weight read game-side
 * at that spot, and whether a module may stand there — steep past the
 * stand limit by the margin, AND rock.
 */
export function cliffGate(seed: number, x: number, z: number): { s: TerrainSample; rock: number; open: boolean } {
  const s = elevationSampleAt(seed, x, z);
  const ny = 1 / Math.sqrt(1 + s.dx * s.dx + s.dz * s.dz);
  if (ny >= GROUND_NORMAL_Y - CLIFF_STAND_MARGIN) return { s, rock: 0, open: false };
  const duff = groundCover(seed, x, z, s).duff;
  const rock = classifySurface(seed, x, z, s.h, Math.hypot(s.dx, s.dz), forestDensity(seed, x, z, s), duff).weights.rock;
  return { s, rock, open: rock >= CLIFF_ROCK_MIN };
}

/** Straight downslope, in the scene's yaw (yaw 0 faces +Z, forward is
 * (sin yaw, cos yaw)): the direction the scanned face looks out of the hill. */
export function cliffYaw(s: TerrainSample): number {
  return Math.atan2(-s.dx, -s.dz);
}

/** The four neighbours a long face is looked for in. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [CLIFF_CELL, 0], [-CLIFF_CELL, 0], [0, CLIFF_CELL], [0, -CLIFF_CELL],
];

/**
 * The module in cell (ci, cj), or null. Shaped as a `ClutterInstance` of the
 * rock class so `instanceMatrixFor` serves it unchanged: rock is in that
 * file's tilted set, so the module is seated on the ground normal — a wall
 * bedded into a 45° face leans back with it, as an outcrop does — and it is
 * outside the trampled set, so the trample frame is the identity. The yaw
 * rides in `hash` as a fraction of a turn, which is how that function reads
 * it. `groundH` already carries the sink.
 */
export function cliffCell(seed: number, ci: number, cj: number): ClutterInstance | null {
  if (cellDraw(ci, cj, 6) >= CLIFF_DENSITY) return null;
  const { x, z } = cliffCellPoint(ci, cj);
  const g = cliffGate(seed, x, z);
  if (!g.open) return null;
  let steepNeighbours = 0;
  for (const [ox, oz] of NEIGHBOURS) {
    if (cliffGate(seed, x + ox, z + oz).open) steepNeighbours++;
  }
  const scale = CLIFF_SCALE[0] + (CLIFF_SCALE[1] - CLIFF_SCALE[0]) * cellDraw(ci, cj, 3);
  const yaw = cliffYaw(g.s) + CLIFF_YAW_JITTER * (2 * cellDraw(ci, cj, 4) - 1);
  const hash = ((yaw / (Math.PI * 2)) % 1 + 1) % 1;
  const variant = steepNeighbours >= CLIFF_LONG_NEIGHBOURS ? CLIFF_WALL_B : CLIFF_WALL_A;
  return {
    cls: CLUTTER_ROCK,
    x,
    z,
    groundH: g.s.h - CLIFF_SINK * scale * (CLIFF_MODEL_HEIGHT[variant] as number),
    groundDx: g.s.dx,
    groundDz: g.s.dz,
    scale,
    variant,
    hash,
  };
}
```

- [ ] **Step 4: Run the tests — the footprint test must be red**

Run: `cd client && npx vitest run test/game/cliffField.test.ts`
Expected: the footprint test FAILS (a probe at a module's corner lands on walkable ground on at least one of the 200 worlds); the other four PASS. If the footprint test passes here, the sweep is not reaching face edges — do not proceed; raise the sweep radius in `modulesIn(seed, 0, 0, 400)` to 800 and rerun until it is red.

- [ ] **Step 5: Add the footprint check**

Replace the tail of `cliffCell` (from `const variant = ...` to the end) with:

```ts
  /** All four corners of a module of `variant` at this scale and yaw pass
   * the gate — the module's extent, since the sink keeps the rest of it
   * below the surface it stands on. */
  const footprintOpen = (variant: number): boolean => {
    const hw = (CLIFF_MODEL_WIDTH[variant] as number) * scale / 2;
    const hd = (CLIFF_MODEL_DEPTH[variant] as number) * scale / 2;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    return (
      cliffGate(seed, x + rx * hw, z + rz * hw).open &&
      cliffGate(seed, x - rx * hw, z - rz * hw).open &&
      cliffGate(seed, x + fx * hd, z + fz * hd).open &&
      cliffGate(seed, x - fx * hd, z - fz * hd).open
    );
  };
  // The long module where the face is long; where its own corners would
  // overhang walkable ground, the short one instead, and where even that
  // would, nothing.
  let variant = steepNeighbours >= CLIFF_LONG_NEIGHBOURS ? CLIFF_WALL_B : CLIFF_WALL_A;
  if (!footprintOpen(variant)) {
    if (variant === CLIFF_WALL_A) return null;
    variant = CLIFF_WALL_A;
    if (!footprintOpen(variant)) return null;
  }
  return {
    cls: CLUTTER_ROCK,
    x,
    z,
    groundH: g.s.h - CLIFF_SINK * scale * (CLIFF_MODEL_HEIGHT[variant] as number),
    groundDx: g.s.dx,
    groundDz: g.s.dz,
    scale,
    variant,
    hash,
  };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/cliffField.test.ts`
Expected: 6 passed. Record the footprint test's module count and the density test's `placed / qualifying` from a `console.log` you add and remove — the verification doc (Task 6) quotes them.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npx eslint client/src/game/cliffField.ts client/test/game/cliffField.test.ts
git add client/src/game/cliffField.ts client/test/game/cliffField.test.ts
git commit -F - <<'EOF'
feat: place cliff modules on steep rock that a foot cannot reach

## What

A pure field decides where rock-wall modules stand: on a 12 m lattice,
half the cells whose jittered point is both rock and steeper than the
simulation's stand limit by a margin, with the long module where the face
is long, facing downslope, scaled 0.8–1.3, sunk a third of its height, and
only where all four corners of its footprint pass the same gate — so a
module never overhangs ground a player can stand on.

## How

- `client/src/game/cliffField.ts` — the gate (`cliffGate`), the downslope
  yaw, the module choice by steep neighbours, the footprint check with the
  long-to-short fallback, and the instance shaped as a lying rock so the
  clutter shell's matrix writer seats it on the ground normal.
- `client/test/game/cliffField.test.ts` — the never-where-a-foot-can-go
  invariant on 200 worlds, purity, the downslope yaw and shape, the module
  choice, and the density band on the worst face of seed 1.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
# then the repository's pre-push scan, which must pass
```
Expected: `0 failing`.

---

### Task 2: The collector and the bands

**Files:**
- Modify: `client/src/game/cliffField.ts` (append)
- Test: `client/test/game/cliffField.test.ts` (append)

**Interfaces:**
- Consumes: `cliffCell`, `CLIFF_CELL` (Task 1); `QualityTier` (`game/quality.ts`).
- Produces: `CLIFF_PAD`, `CLIFF_RINGS`, `CLIFF_FADE_BAND`, `CLIFF_BUDGET`, `cliffOrigin(camX, camZ)`, `collectCliffs(seed, camX, camZ, reach)`, `createCliffCollector(seed): CliffCollector` with `collect(camX, camZ, reach): ClutterInstance[]` and `size`, `cliffBands(instances, ox, oz, rings): [ClutterInstance[], ClutterInstance[], ClutterInstance[]]`. Task 4 uses all of them.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/cliffField.test.ts` (extend the import from `cliffField.js` with `CLIFF_BUDGET, CLIFF_PAD, CLIFF_RINGS, cliffBands, cliffOrigin, collectCliffs, createCliffCollector`):

```ts
describe("collectCliffs and the collector", () => {
  it("returns every module within reach plus the pad of the snapped origin, nearest first", () => {
    const reach = CLIFF_RINGS.high[2];
    const o = cliffOrigin(WORST.x, WORST.z);
    const got = collectCliffs(WORST.seed, WORST.x, WORST.z, reach);
    const want = modulesIn(WORST.seed, o.x, o.z, reach + CLIFF_PAD);
    expect(got.length).toBe(want.length);
    for (let i = 1; i < got.length; i++) {
      const a = got[i - 1]!, b = got[i]!;
      expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeLessThanOrEqual(Math.hypot(b.x - o.x, b.z - o.z) + 1e-9);
    }
    expect(got.length).toBeGreaterThan(50);
    expect(got.length).toBeLessThanOrEqual(CLIFF_BUDGET);
  });

  it("memoises cells across rebuilds and matches the pure walk", () => {
    const reach = CLIFF_RINGS.high[2];
    const c = createCliffCollector(WORST.seed);
    const first = c.collect(WORST.x, WORST.z, reach);
    expect(first).toEqual(collectCliffs(WORST.seed, WORST.x, WORST.z, reach));
    const size = c.size;
    // One cell over: the disc's leading edge is new, the rest is cached.
    const second = c.collect(WORST.x + CLIFF_CELL, WORST.z, reach);
    expect(second).toEqual(collectCliffs(WORST.seed, WORST.x + CLIFF_CELL, WORST.z, reach));
    const cells = Math.ceil((2 * (reach + CLIFF_PAD)) / CLIFF_CELL) + 1;
    expect(c.size - size).toBeLessThanOrEqual(cells + 2);
    expect(c.size - size).toBeGreaterThan(0);
  });

  it("partitions the modules across the three LOD buckets by distance, exactly once each", () => {
    const rings = CLIFF_RINGS.high;
    const o = cliffOrigin(WORST.x, WORST.z);
    const all = collectCliffs(WORST.seed, WORST.x, WORST.z, rings[2]);
    const bands = cliffBands(all, o.x, o.z, rings);
    expect(bands[0].length + bands[1].length + bands[2].length).toBe(all.length);
    const seen = new Set<ClutterInstance>();
    for (const [lod, band] of bands.entries()) {
      for (const m of band) {
        expect(seen.has(m)).toBe(false);
        seen.add(m);
        const d = Math.hypot(m.x - o.x, m.z - o.z);
        expect(d).toBeLessThan(rings[lod] as number);
        if (lod > 0) expect(d).toBeGreaterThanOrEqual(rings[lod - 1] as number);
      }
    }
    // Teeth: the far band is where most of a 400 m disc lives.
    expect(bands[2].length).toBeGreaterThan(bands[0].length);
  });

  it("stays under the budget on the three census worlds' worst discs", () => {
    for (const [seed, x, z] of [[627994160, -200, -1000], [388817, -100, -500], [1, 1100, -1200]] as const) {
      expect(collectCliffs(seed, x, z, CLIFF_RINGS.high[2]).length).toBeLessThanOrEqual(CLIFF_BUDGET);
    }
  });
});
```

Add `import type { ClutterInstance } from "../../src/sim/clutter.js";` beside the `CLUTTER_ROCK` import (merge into one import line).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/cliffField.test.ts`
Expected: FAIL — the new names are not exported.

- [ ] **Step 3: Append the collector and bands**

```ts
// append to client/src/game/cliffField.ts
import type { QualityTier } from "./quality.js";

/** The worst offset (m) between the eye and the origin the distances are
 * measured against: the rebuild snaps to `CLIFF_CELL`, so the reach edge is
 * padded by a cell's diagonal and a module at the edge is collected before
 * its band needs it — the tree field's `SEAM_PAD`. */
export const CLIFF_PAD = Math.SQRT2 * CLIFF_CELL;
/** The three LOD rings (m from the rebuild origin) per quality tier: LOD0 to
 * the first, LOD1 to the second, LOD2 to the third, which is the reach. The
 * low tier has no LOD0 ring. */
export const CLIFF_RINGS: Record<QualityTier, readonly [number, number, number]> = {
  high: [60, 160, 400],
  medium: [60, 140, 250],
  low: [0, 80, 200],
};
/** Width (m) of the far bucket's dither-out at the reach. */
export const CLIFF_FADE_BAND = 40;
/** Modules a reach may hold at most; the worst 400 m disc of the census
 * worlds sits well under it. */
export const CLIFF_BUDGET = 700;

/** The eye's origin snapped to the lattice: the rebuild trigger and the
 * point every band distance is measured from. */
export function cliffOrigin(camX: number, camZ: number): { x: number; z: number } {
  return { x: Math.floor(camX / CLIFF_CELL) * CLIFF_CELL, z: Math.floor(camZ / CLIFF_CELL) * CLIFF_CELL };
}

function collectWith(
  camX: number,
  camZ: number,
  reach: number,
  cellAt: (ci: number, cj: number) => ClutterInstance | null,
): ClutterInstance[] {
  const { x: ox, z: oz } = cliffOrigin(camX, camZ);
  const r = reach + CLIFF_PAD;
  const r2 = r * r;
  const found: { m: ClutterInstance; d2: number }[] = [];
  const c0x = Math.floor((ox - r) / CLIFF_CELL), c1x = Math.floor((ox + r) / CLIFF_CELL);
  const c0z = Math.floor((oz - r) / CLIFF_CELL), c1z = Math.floor((oz + r) / CLIFF_CELL);
  for (let cj = c0z; cj <= c1z; cj++) {
    for (let ci = c0x; ci <= c1x; ci++) {
      const m = cellAt(ci, cj);
      if (m === null) continue;
      const dx = m.x - ox, dz = m.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r2) found.push({ m, d2 });
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  return found.map((p) => p.m);
}

/** Every module within `reach` (plus the pad) of the snapped origin,
 * nearest first. Pure; the collector below is its memoising twin. */
export function collectCliffs(seed: number, camX: number, camZ: number, reach: number): ClutterInstance[] {
  return collectWith(camX, camZ, reach, (ci, cj) => cliffCell(seed, ci, cj));
}

export type CliffCollector = {
  /** Identical output to `collectCliffs(seed, camX, camZ, reach)`. */
  collect(camX: number, camZ: number, reach: number): ClutterInstance[];
  /** Cached cell count — exposed so tests can pin the growth per crossing. */
  readonly size: number;
};

// Numeric cell key, exact for |cell index| < 2^20 — the tree field's packing.
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;
/** Cells this far past the reach are evicted once the cache outgrows
 * `COLLECTOR_SWEEP_SIZE`. */
const COLLECTOR_EVICT_MARGIN = 4 * CLIFF_CELL;
const COLLECTOR_SWEEP_SIZE = 16384;

/**
 * Memoising counterpart to `collectCliffs`: `cliffCell` is pure in (seed,
 * ci, cj), so a rebuild after a one-cell move re-reads only the disc's
 * leading edge instead of every cell in reach — a cell costs a terrain
 * sample and a surface classification, five more for the half that qualify.
 */
export function createCliffCollector(seed: number): CliffCollector {
  const cache = new Map<number, ClutterInstance | null>();
  return {
    collect(camX, camZ, reach) {
      const out = collectWith(camX, camZ, reach, (ci, cj) => {
        const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
        let m = cache.get(key);
        if (m === undefined) {
          m = cliffCell(seed, ci, cj);
          cache.set(key, m);
        }
        return m;
      });
      if (cache.size > COLLECTOR_SWEEP_SIZE) {
        const { x: ox, z: oz } = cliffOrigin(camX, camZ);
        const evict = reach + CLIFF_PAD + COLLECTOR_EVICT_MARGIN;
        const evict2 = evict * evict;
        for (const key of cache.keys()) {
          const cjPart = key % KEY_SPAN;
          const cj = cjPart - KEY_HALF;
          const ci = (key - cjPart) / KEY_SPAN - KEY_HALF;
          const cx = (ci + 0.5) * CLIFF_CELL - ox, cz = (cj + 0.5) * CLIFF_CELL - oz;
          if (cx * cx + cz * cz >= evict2) cache.delete(key);
        }
      }
      return out;
    },
    get size(): number {
      return cache.size;
    },
  };
}

/**
 * Splits nearest-first `instances` into the three LOD buckets by distance
 * from the origin against `rings`: [0, rings[0]) → LOD0, [rings[0],
 * rings[1]) → LOD1, [rings[1], rings[2]) → LOD2. Anything at or past the
 * reach is dropped (the pad collected it for the next rebuild, not this
 * one). Every instance lands in exactly one bucket.
 */
export function cliffBands(
  instances: readonly ClutterInstance[],
  ox: number,
  oz: number,
  rings: readonly [number, number, number],
): [ClutterInstance[], ClutterInstance[], ClutterInstance[]] {
  const out: [ClutterInstance[], ClutterInstance[], ClutterInstance[]] = [[], [], []];
  for (const m of instances) {
    const d = Math.hypot(m.x - ox, m.z - oz);
    if (d < rings[0]) out[0].push(m);
    else if (d < rings[1]) out[1].push(m);
    else if (d < rings[2]) out[2].push(m);
  }
  return out;
}
```

Move the `import type { QualityTier }` line up with the other imports (imports must lead the file for eslint).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/cliffField.test.ts`
Expected: 10 passed. If the budget test fails, the census disc holds more than 700 after the footprint check — do not raise `CLIFF_BUDGET`; report the count (the spec's §8 fallbacks are the only levers, and they are chosen at the gate, not here).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npx eslint client/src/game/cliffField.ts client/test/game/cliffField.test.ts
git add client/src/game/cliffField.ts client/test/game/cliffField.test.ts
git commit -F - <<'EOF'
feat: collect cliff modules within reach and band them by distance

## What

The cliff field now gathers every module within a tier's reach of the
eye's snapped origin, nearest first, through a memoising per-cell cache so
a 12 m crossing re-reads only the disc's leading edge, and splits them
across the three LOD rings so each module is drawn by exactly one bucket.

## How

- `client/src/game/cliffField.ts` — `CLIFF_RINGS` per tier, `CLIFF_PAD`,
  `CLIFF_FADE_BAND`, `CLIFF_BUDGET`; `collectCliffs` and its memoising
  twin `createCliffCollector` (packed cell keys, eviction past the reach);
  `cliffBands`, the one-bucket-per-module partition.
- `client/test/game/cliffField.test.ts` — the pure walk against the
  collector, cache growth per crossing, the partition, and the budget on
  the census worlds' worst discs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
# then the repository's pre-push scan, which must pass
```
Expected: `0 failing`.

---

### Task 3: The ground-tint plugin

**Files:**
- Create: `client/src/game/cliffTintPlugin.ts`, `client/src/game/shaders/cliffTint.vertex.fx`, `client/src/game/shaders/cliffTintWorldPos.vertex.fx`, `client/src/game/shaders/cliffTint.fragment.fx`, `client/src/game/shaders/cliffTintLights.fragment.fx`
- Test: `client/test/game/cliffTintPlugin.test.ts` (`shaderHygiene.test.ts` picks the `.fx` files up by itself)

**Interfaces:**
- Consumes: the `foliage` per-instance attribute (vec4: ground albedo rgb, canopy shade in a) that `writeFoliage` (`clutterMeshes.ts`) writes — the exact attribute `foliagePlugin.ts` declares under `THIN_INSTANCES`.
- Produces: `CLIFF_GROUND_TINT = 0.5`, `attachCliffTint(material)`, `CliffTintPlugin`. Task 4 attaches it to every cliff material.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/cliffTintPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CLIFF_GROUND_TINT, CliffTintPlugin, attachCliffTint } from "../../src/game/cliffTintPlugin.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("cliff tint plugin", () => {
  it("attaches once, idempotently, and activates", () => {
    const mat = new PBRMaterial("c", scene);
    attachCliffTint(mat);
    attachCliffTint(mat);
    const plugin = mat.pluginManager?.getPlugin("CliffTint");
    expect(plugin).toBeInstanceOf(CliffTintPlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active).toContain(plugin);
    expect(active.filter((p) => p instanceof CliffTintPlugin)).toHaveLength(1);
  });

  it("declares the foliage attribute and injects at the world-position and before-lights hooks only", () => {
    const mat = new PBRMaterial("c2", scene);
    attachCliffTint(mat);
    const plugin = mat.pluginManager!.getPlugin("CliffTint") as CliffTintPlugin;
    const attributes: string[] = [];
    plugin.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["foliage"]);
    const v = plugin.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = plugin.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(plugin.getCustomCode("compute")).toBeNull();
  });

  it("mixes the albedo halfway toward the ground under the module, from the same GLSL the files hold", () => {
    const mat = new PBRMaterial("c3", scene);
    attachCliffTint(mat);
    const plugin = mat.pluginManager!.getPlugin("CliffTint") as CliffTintPlugin;
    const f = plugin.getCustomCode("fragment")!;
    expect(CLIFF_GROUND_TINT).toBe(0.5);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toContain(`const float CLIFF_GROUND_TINT = ${glslFloat(CLIFF_GROUND_TINT)};`);
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("surfaceAlbedo = mix(surfaceAlbedo, vCliffTint.rgb, CLIFF_GROUND_TINT * cHas);");
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("cliffTint.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("cliffTintLights.fragment.fx"));
    const v = plugin.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("cliffTint.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("cliffTintWorldPos.vertex.fx"));
    // The attribute exists only on thin instances; elsewhere the default
    // black rgb tells the fragment stage there is no tint data.
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toContain("#ifdef THIN_INSTANCES\nattribute vec4 foliage;\n#endif");
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toContain("vCliffTint = vec4(0.0, 0.0, 0.0, 1.0);");
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toContain("#ifdef THIN_INSTANCES\n  vCliffTint = foliage;\n#endif");
  });

  it("sets CLIFFTINT in prepareDefines", () => {
    const mat = new PBRMaterial("c4", scene);
    attachCliffTint(mat);
    const plugin = mat.pluginManager!.getPlugin("CliffTint") as CliffTintPlugin;
    const defines: Record<string, boolean> = { CLIFFTINT: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.CLIFFTINT).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/game/cliffTintPlugin.test.ts`
Expected: FAIL — `Cannot find module '../../src/game/cliffTintPlugin.js'`.

- [ ] **Step 3: Write the four shader files**

`client/src/game/shaders/cliffTint.vertex.fx`:
```glsl
// Cliff tint vertex definitions, spliced by CliffTintPlugin (cliffTintPlugin.ts)
// at CUSTOM_VERTEX_DEFINITIONS: the per-instance ground colour the cliff shell
// writes (the same foliage attribute the ground cover carries), handed to the
// fragment stage untouched.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
#ifdef CLIFFTINT
#ifdef THIN_INSTANCES
attribute vec4 foliage;
#endif
varying vec4 vCliffTint;
#endif
```

`client/src/game/shaders/cliffTintWorldPos.vertex.fx`:
```glsl
// Spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS. The default first, overwritten
// only where the attribute actually exists: the fragment stage treats a
// black rgb as no tint data and leaves the albedo alone.
// COMMENT RULES as in cliffTint.vertex.fx.
#ifdef CLIFFTINT
  vCliffTint = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef THIN_INSTANCES
  vCliffTint = foliage;
#endif
#endif
```

`client/src/game/shaders/cliffTint.fragment.fx`:
```glsl
// Cliff tint fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS.
// CLIFF_GROUND_TINT mirrors cliffTintPlugin.ts and a lockstep test asserts
// they agree.
// COMMENT RULES as in cliffTint.vertex.fx.
#ifdef CLIFFTINT
varying vec4 vCliffTint;
const float CLIFF_GROUND_TINT = 0.5;
#endif
```

`client/src/game/shaders/cliffTintLights.fragment.fx`:
```glsl
// Spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS: half the module's own colour,
// half the ground's under it, so a granite wall and a pale cobble hillside
// read as one material. A black rgb means no tint data.
// COMMENT RULES as in cliffTint.vertex.fx.
#ifdef CLIFFTINT
  float cHas = step(1.0 / 255.0, max(vCliffTint.r, max(vCliffTint.g, vCliffTint.b)));
  surfaceAlbedo = mix(surfaceAlbedo, vCliffTint.rgb, CLIFF_GROUND_TINT * cHas);
#endif
```

- [ ] **Step 4: Write the plugin**

```ts
// client/src/game/cliffTintPlugin.ts
/**
 * The cliff tint plugin: one thing only — mix a module's albedo halfway
 * toward the ground colour under it, read from the per-instance `foliage`
 * attribute the cliff shell writes with `writeFoliage` (clutterMeshes.ts),
 * so a brown granite module and a pale cobble hillside read as one
 * material. Fragment-only in effect; the vertex stage just carries the
 * attribute across. Not the foliage plugin, whose vertex stage is wind,
 * lean and collapse for cards — a wall wants none of that. Renderer-only:
 * nothing here may migrate into sim/. The GLSL lives in shaders/cliffTint*.fx
 * so shaderHygiene.test.ts covers it.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import vertexDefs from "./shaders/cliffTint.vertex.fx?raw";
import vertexWorldPos from "./shaders/cliffTintWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/cliffTint.fragment.fx?raw";
import fragmentLights from "./shaders/cliffTintLights.fragment.fx?raw";

/** Share of the ground albedo in the module's colour. Mirrored in
 * shaders/cliffTint.fragment.fx; the lockstep test asserts it. */
export const CLIFF_GROUND_TINT = 0.5;

export class CliffTintPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // 210: after the foliage plugin's 200 and the fade's 205 — never on the
    // same material as either, but the order is fixed anyway.
    super(material, "CliffTint", 210, { CLIFFTINT: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "CliffTintPlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.CLIFFTINT = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("foliage");
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs, CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights };
    }
    return null;
  }
}

/** Attach once per material; later calls are no-ops (LOD buckets share materials). */
export function attachCliffTint(material: Material): void {
  if (material.pluginManager?.getPlugin("CliffTint")) return;
  new CliffTintPlugin(material);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/cliffTintPlugin.test.ts test/game/shaderHygiene.test.ts`
Expected: both files pass; the hygiene test lists four new `cliffTint*.fx` cases, each green (no hashed keyword in a comment, no semicolon in a trailing comment, real code survives the preprocessor with `CLIFFTINT` and `THIN_INSTANCES` on).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npx eslint client/src/game/cliffTintPlugin.ts client/test/game/cliffTintPlugin.test.ts
git add client/src/game/cliffTintPlugin.ts client/src/game/shaders/cliffTint.vertex.fx client/src/game/shaders/cliffTintWorldPos.vertex.fx client/src/game/shaders/cliffTint.fragment.fx client/src/game/shaders/cliffTintLights.fragment.fx client/test/game/cliffTintPlugin.test.ts
git commit -F - <<'EOF'
feat: tint a cliff module halfway toward the ground under it

## What

A small material plugin for the cliff modules: the albedo mixes halfway
toward the ground colour at the module's foot, carried per instance in the
same attribute the ground cover uses, so a granite wall and a pale cobble
hillside read as one material. Nothing of the foliage plugin's vertex
work — a wall does not sway.

## How

- `client/src/game/cliffTintPlugin.ts` — `CliffTintPlugin` (declares the
  `foliage` attribute, splices at the world-position and before-lights
  hooks), `attachCliffTint`, `CLIFF_GROUND_TINT`.
- `client/src/game/shaders/cliffTint*.fx` — the GLSL: the attribute
  carried as a varying, the mix gated on tint data being present.
- `client/test/game/cliffTintPlugin.test.ts` — attach-once, the hook set,
  the literal in lockstep with the constant, the define.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
# then the repository's pre-push scan, which must pass
```
Expected: `0 failing`.

---

### Task 4: The Babylon shell

**Files:**
- Create: `client/src/game/cliffMeshes.ts`
- Test: `client/test/game/cliffMeshes.test.ts`

**Interfaces:**
- Consumes: Task 1–3 exports; `instanceMatrixFor`, `trampleFrame`, `writeFoliage`, `prepBucketMesh` (`clutterMeshes.ts` — `prepBucketMesh` is exported there); `attachDistanceFade`, `fadeBands` (`distanceFadePlugin.ts`); `modelUrl` (`assetUrls.ts`); `loadAssetContainerAsync`, `registerBuiltInLoaders`.
- Produces: `createCliffMeshes(scene, seed, options: { quality: QualityTier; loader?: (output: string) => Promise<AssetContainer> }): CliffMeshes` with `update(camX, camZ)`, `meshes`, `casterMeshes`, `ready: Promise<void>`, `dispose()`; `cliffMeshName(model, lod)`, `CLIFF_LOD_NODES`. Task 5 wires it.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/cliffMeshes.test.ts
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import "../../src/sim/passes/index.js";
import {
  CLIFF_CELL, CLIFF_FADE_BAND, CLIFF_MODEL_HEIGHT, CLIFF_MODEL_WIDTH, CLIFF_MODELS, CLIFF_RINGS,
  cliffBands, cliffOrigin, collectCliffs,
} from "../../src/game/cliffField.js";
import { CLIFF_LOD_NODES, cliffMeshName, createCliffMeshes } from "../../src/game/cliffMeshes.js";
import { instanceMatrixFor, trampleFrame, writeFoliage } from "../../src/game/clutterMeshes.js";
import { CliffTintPlugin } from "../../src/game/cliffTintPlugin.js";
import { DistanceFadePlugin } from "../../src/game/distanceFadePlugin.js";

const SEED = 1;
/** Seed 1's worst face (design §5): every band is populated from here. */
const CAM = { x: 1100, z: -1200 };

/** The real GLBs, read from disk the way catalogModels.test.ts does. */
function loader(scene: Scene) {
  registerBuiltInLoaders();
  return (output: string) => {
    const bytes = readFileSync(new URL(`../../assets/${output}`, import.meta.url));
    return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
  };
}

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

describe("createCliffMeshes", () => {
  it("builds three buckets per model from the GLBs' LOD roots, tinted, shadowed, the far one dithering", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    expect(cliffs.meshes.length).toBe(0);
    await cliffs.ready;
    expect(cliffs.meshes.length).toBe(CLIFF_MODELS.length * 3);
    for (const [model] of CLIFF_MODELS.entries()) {
      const mats = new Set<PBRMaterial>();
      for (let lod = 0; lod < 3; lod++) {
        const mesh = scene.getMeshByName(cliffMeshName(model, lod)) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        expect(mesh.getTotalVertices()).toBeGreaterThan(0);
        expect(mesh.isPickable).toBe(false);
        expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
        expect(mesh.receiveShadows).toBe(true);
        // The LOD root's transform is baked away: the thin-instance matrix
        // is the only transform a module wears.
        expect(mesh.parent).toBeNull();
        const mat = mesh.material as PBRMaterial;
        mats.add(mat);
        expect(mat.pluginManager!.getPlugin("CliffTint")).toBeInstanceOf(CliffTintPlugin);
        if (lod === 2) expect(mat.pluginManager!.getPlugin("DistanceFade")).toBeInstanceOf(DistanceFadePlugin);
        else expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
      }
      // LOD0 and LOD1 share the GLB's material; the far bucket has its own.
      expect(mats.size).toBe(2);
    }
    // LOD0 and LOD1 cast; the far bucket does not.
    expect(cliffs.casterMeshes.length).toBe(CLIFF_MODELS.length * 2);
    for (const m of cliffs.casterMeshes) expect(/_l[01]$/.test(m.name)).toBe(true);
    cliffs.dispose();
    for (const [model] of CLIFF_MODELS.entries()) {
      for (let lod = 0; lod < 3; lod++) expect(scene.getMeshByName(cliffMeshName(model, lod))).toBeNull();
    }
    engine.dispose();
  });

  it("pins the model tables against the loaded LOD0 meshes", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    for (const [model] of CLIFF_MODELS.entries()) {
      const mesh = scene.getMeshByName(cliffMeshName(model, 0)) as Mesh;
      const b = mesh.getBoundingInfo().boundingBox;
      expect(b.maximum.x - b.minimum.x).toBeCloseTo(CLIFF_MODEL_WIDTH[model] as number, 1);
      expect(b.maximum.y - b.minimum.y).toBeCloseTo(CLIFF_MODEL_HEIGHT[model] as number, 1);
    }
    cliffs.dispose();
    engine.dispose();
  });

  it("fills each bucket with its band, matrices seated through the clutter writer, with tint and fade bands", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const cliffs = createCliffMeshes(scene, SEED, { quality: "high", loader: loader(scene) });
    await cliffs.ready;
    cliffs.update(CAM.x, CAM.z);
    const rings = CLIFF_RINGS.high;
    const o = cliffOrigin(CAM.x, CAM.z);
    const bands = cliffBands(collectCliffs(SEED, CAM.x, CAM.z, rings[2]), o.x, o.z, rings);
    expect(bands[0].length).toBeGreaterThan(0);
    expect(bands[2].length).toBeGreaterThan(0);
    const mat = new Float32Array(16);
    const fol = new Float32Array(4);
    for (const [model] of CLIFF_MODELS.entries()) {
      for (let lod = 0; lod < 3; lod++) {
        const mesh = scene.getMeshByName(cliffMeshName(model, lod)) as Mesh;
        const want = bands[lod]!.filter((m) => m.variant === model);
        expect(mesh.thinInstanceCount).toBe(want.length);
        expect(mesh.isEnabled()).toBe(want.length > 0);
        if (want.length === 0) continue;
        const matrices = bufferFor(spy, mesh, "matrix")!;
        const tints = bufferFor(spy, mesh, "foliage")!;
        expect(matrices.length).toBe(want.length * 16);
        expect(tints.length).toBe(want.length * 4);
        for (const [i, m] of want.entries()) {
          instanceMatrixFor(m, trampleFrame(SEED, m), mat);
          expect(Array.from(matrices.subarray(i * 16, i * 16 + 16))).toEqual(Array.from(mat));
          writeFoliage(SEED, m, fol, 0, trampleFrame(SEED, m));
          expect(Array.from(tints.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(fol));
        }
        const fade = bufferFor(spy, mesh, "fadeBands");
        if (lod === 2) {
          expect(fade!.length).toBe(want.length * 4);
          expect(Array.from(fade!.subarray(0, 4))).toEqual([-2, -1, rings[2] - CLIFF_FADE_BAND, rings[2]]);
        } else {
          expect(fade).toBeNull();
        }
      }
    }
    spy.mockRestore();
    cliffs.dispose();
    engine.dispose();
  });

  it("rebuilds only when the snapped origin moves, and remembers the eye until the models land", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    const cliffs = createCliffMeshes(scene, SEED, { quality: "medium", loader: loader(scene) });
    cliffs.update(CAM.x, CAM.z);
    expect(spy).not.toHaveBeenCalled();
    await cliffs.ready;
    const afterLoad = spy.mock.calls.length;
    expect(afterLoad).toBeGreaterThan(0);
    cliffs.update(CAM.x + CLIFF_CELL / 4, CAM.z);
    expect(spy.mock.calls.length).toBe(afterLoad);
    cliffs.update(CAM.x + CLIFF_CELL, CAM.z);
    expect(spy.mock.calls.length).toBeGreaterThan(afterLoad);
    spy.mockRestore();
    cliffs.dispose();
    engine.dispose();
  });

  it("names the LOD roots the models ship", () => {
    expect(CLIFF_LOD_NODES).toEqual(["LOD0", "LOD1", "LOD2"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/cliffMeshes.test.ts`
Expected: FAIL — `Cannot find module '../../src/game/cliffMeshes.js'`.

- [ ] **Step 3: Write the shell**

```ts
// client/src/game/cliffMeshes.ts
/**
 * The cliff modules' Babylon shell: rock-wall models instanced along the
 * steep rock faces the field (`cliffField.ts`) picks, in three LOD buckets
 * per model out to the tier's reach. LOD0 → LOD1 → LOD2 hand off
 * geometrically at fixed rings, the opaque path the rock props take (a
 * discard on an opaque material costs frame time scene-wide — see
 * distanceFadePlugin.ts); only the far bucket dithers, out over the last
 * `CLIFF_FADE_BAND` metres, on a material of its own, because a wall
 * popping out of the skyline at the reach is visible and its fragments at
 * that range are few. Every instance carries the ground colour under it for
 * the tint plugin (`cliffTintPlugin.ts`). The near buckets cast shadows.
 *
 * Renderer-only. Nothing here may migrate into sim/: the field reads the
 * simulation and writes nothing back, so the world and the level id are
 * untouched.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Node } from "@babylonjs/core/node.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";

import type { ClutterInstance } from "../sim/clutter.js";
import { modelUrl } from "./assetUrls.js";
import {
  CLIFF_FADE_BAND, CLIFF_MODELS, CLIFF_RINGS, cliffBands, cliffOrigin, createCliffCollector,
} from "./cliffField.js";
import { attachCliffTint } from "./cliffTintPlugin.js";
import { instanceMatrixFor, prepBucketMesh, trampleFrame, writeFoliage } from "./clutterMeshes.js";
import { attachDistanceFade, fadeBands, type FadeBands } from "./distanceFadePlugin.js";
import type { QualityTier } from "./quality.js";

/** The LOD roots inside each GLB, by bucket. */
export const CLIFF_LOD_NODES: readonly [string, string, string] = ["LOD0", "LOD1", "LOD2"];
export const CLIFF_MESH_PREFIX = "cliff";
export function cliffMeshName(model: number, lod: number): string {
  return `${CLIFF_MESH_PREFIX}_m${model}_l${lod}`;
}

export type CliffMeshesOptions = {
  quality: QualityTier;
  /** How a model's GLB is fetched; the default loads it by URL. A test hands
   * in a reader of the file on disk. */
  loader?: (output: string) => Promise<AssetContainer>;
};

export type CliffMeshes = {
  update(camX: number, camZ: number): void;
  /** Every bucket mesh, model-major then LOD. Empty until the GLBs land. */
  readonly meshes: readonly Mesh[];
  /** The LOD0 and LOD1 buckets — the ones that enter the shadow map, the
   * same contract `ForestMeshes.casterMeshes` carries: the renderer registers
   * new entries as they appear. */
  readonly casterMeshes: readonly Mesh[];
  /** Resolves once every model has loaded (or failed to). */
  readonly ready: Promise<void>;
  dispose(): void;
};

type Bucket = {
  mesh: Mesh;
  /** Matrix data; capacity is `buf.length / 16`. */
  buf: Float32Array;
  /** The `foliage` attribute; capacity is `tint.length / 4`. */
  tint: Float32Array;
  /** The far bucket's `fadeBands`; empty on the near buckets. */
  fade: Float32Array;
  count: number;
};

const EMPTY_BUFFER = new Float32Array(0);
const scratchMat = new Float32Array(16);

function grow(buf: Float32Array, needed: number, stride: number): Float32Array {
  if (buf.length >= needed) return buf;
  let capacity = Math.max(buf.length, 64 * stride);
  while (capacity < needed) capacity *= 2;
  return new Float32Array(capacity);
}

/**
 * The one geometry mesh under `name` in a loaded container, with its node
 * transform baked into its vertices and its parent cut, so a thin-instance
 * matrix is the only transform it wears — `clutterMeshes.ts`'s `lodMeshes`,
 * narrowed to the one mesh each cliff GLB puts under a LOD root.
 */
function lodMesh(container: AssetContainer, name: string): Mesh | null {
  const nodes: Node[] = [...container.transformNodes, ...container.meshes];
  const root = nodes.find((n) => n.name === name);
  if (root === undefined) return null;
  const all: Node[] = [root, ...root.getChildMeshes(false)];
  for (const n of all) {
    if (n instanceof Mesh && n.getTotalVertices() > 0) {
      n.bakeTransformIntoVertices(n.computeWorldMatrix(true).clone());
      n.position.setAll(0);
      n.rotationQuaternion = null;
      n.rotation.setAll(0);
      n.scaling.setAll(1);
      n.parent = null;
      return n;
    }
  }
  return null;
}

export function createCliffMeshes(scene: Scene, seed: number, options: CliffMeshesOptions): CliffMeshes {
  const rings = CLIFF_RINGS[options.quality];
  const reach = rings[2];
  const farBands: FadeBands = fadeBands(null, [reach - CLIFF_FADE_BAND, reach]);
  const load = options.loader ?? ((output: string) => loadAssetContainerAsync(modelUrl(output), scene));
  const collector = createCliffCollector(seed);
  const containers: AssetContainer[] = [];
  /** `buckets[model][lod]`; a slot is null when the GLB brought no such root. */
  const buckets: (Bucket | null)[][] = [];
  const meshes: Mesh[] = [];
  const casterMeshes: Mesh[] = [];
  let disposed = false;
  let builtX = NaN;
  let builtZ = NaN;
  let pendingX = NaN;
  let pendingZ = NaN;

  function rebuild(x: number, z: number): void {
    if (meshes.length === 0) return;
    const { x: ox, z: oz } = cliffOrigin(x, z);
    const all = collector.collect(x, z, reach);
    const bands = cliffBands(all, ox, oz, rings);
    for (const [lod, band] of bands.entries()) {
      // Two passes: every bucket knows its size before a matrix is written,
      // so no buffer grows mid-fill.
      for (const row of buckets) { const b = row[lod]; if (b) b.count = 0; }
      for (const m of band) { const b = buckets[m.variant]?.[lod]; if (b) b.count++; }
      for (const row of buckets) {
        const b = row[lod];
        if (!b) continue;
        b.buf = grow(b.buf, b.count * 16, 16);
        b.tint = grow(b.tint, b.count * 4, 4);
        if (lod === 2) b.fade = grow(b.fade, b.count * 4, 4);
        b.count = 0;
      }
      for (const m of band) {
        const b = buckets[m.variant]?.[lod];
        if (!b) continue;
        const frame = trampleFrame(seed, m);
        instanceMatrixFor(m, frame, scratchMat);
        b.buf.set(scratchMat, b.count * 16);
        writeFoliage(seed, m, b.tint, b.count * 4, frame);
        if (lod === 2) b.fade.set(farBands, b.count * 4);
        b.count++;
      }
      for (const row of buckets) {
        const b = row[lod];
        if (!b) continue;
        // Replaced wholesale on every rebuild (the tree shell's discipline);
        // "matrix" first, since it fixes the count the others are checked
        // against, and exact-length views so Babylon never reads past the
        // instances this rebuild wrote.
        b.mesh.thinInstanceSetBuffer("matrix", b.buf.subarray(0, b.count * 16), 16, true);
        b.mesh.thinInstanceSetBuffer("foliage", b.tint.subarray(0, b.count * 4), 4, true);
        if (lod === 2) b.mesh.thinInstanceSetBuffer("fadeBands", b.fade.subarray(0, b.count * 4), 4, true);
        // With `instancesCount` 0 Babylon's `hasThinInstances` is false and
        // the bare model would be drawn once at the origin.
        b.mesh.setEnabled(b.count > 0);
      }
    }
  }

  async function loadAssets(): Promise<void> {
    if (options.loader === undefined) registerBuiltInLoaders();
    for (const [model, output] of CLIFF_MODELS.entries()) {
      const container = await load(output);
      if (disposed) {
        container.dispose();
        return;
      }
      containers.push(container);
      container.addAllToScene();
      const row: (Bucket | null)[] = [];
      for (const [lod, name] of CLIFF_LOD_NODES.entries()) {
        const mesh = lodMesh(container, name);
        if (mesh === null) {
          row.push(null);
          continue;
        }
        mesh.name = cliffMeshName(model, lod);
        prepBucketMesh(mesh);
        // The modules stand on ground that receives shadows, near the eye
        // and inside the first cascade: a lit wall under a shadowed face
        // would glow.
        mesh.receiveShadows = true;
        if (lod === 2 && mesh.material !== null) {
          // The far bucket's own material, so the dither is paid only where
          // its fragments are few.
          const far = mesh.material.clone(`${mesh.material.name}_far`);
          if (far !== null) {
            mesh.material = far;
            attachDistanceFade(far, { force: true });
          }
        }
        if (mesh.material !== null) attachCliffTint(mesh.material);
        row.push({ mesh, buf: EMPTY_BUFFER, tint: EMPTY_BUFFER, fade: EMPTY_BUFFER, count: 0 });
        meshes.push(mesh);
        if (lod < 2) casterMeshes.push(mesh);
      }
      // Everything else the container brought (the unused roots' meshes)
      // stays out of the draw.
      for (const other of container.meshes) {
        if (other instanceof Mesh && !meshes.includes(other)) other.setEnabled(false);
      }
      buckets[model] = row;
    }
    if (disposed) return;
    if (!Number.isNaN(pendingX)) {
      builtX = NaN;
      rebuild(pendingX, pendingZ);
      const o = cliffOrigin(pendingX, pendingZ);
      builtX = o.x;
      builtZ = o.z;
    }
  }
  const ready = loadAssets();

  return {
    /** Rebuild only when the eye's snapped origin moves, and remember the eye
     * until the models land — this runs every frame, so it allocates nothing
     * in the common case. */
    update(x, z) {
      if (disposed) return;
      pendingX = x;
      pendingZ = z;
      if (meshes.length === 0) return;
      const { x: ox, z: oz } = cliffOrigin(x, z);
      if (ox === builtX && oz === builtZ) return;
      builtX = ox;
      builtZ = oz;
      rebuild(x, z);
    },
    meshes,
    casterMeshes,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const row of buckets) {
        for (const b of row) {
          // The far bucket's material is this shell's own clone.
          if (b && b.mesh.name.endsWith("_l2")) b.mesh.material?.dispose();
        }
      }
      // The meshes came out of the containers, so disposing the containers
      // takes them and their materials with them.
      for (const container of containers) container.dispose();
      containers.length = 0;
      buckets.length = 0;
      meshes.length = 0;
      casterMeshes.length = 0;
    },
  };
}
```

Note for the implementer: `ClutterInstance` is imported only for the type of `bands`; if eslint flags it unused, drop the import. `prepBucketMesh` is exported from `clutterMeshes.ts` (line 351) — use it, do not copy it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/cliffMeshes.test.ts test/game/cliffField.test.ts`
Expected: all pass. The model-table test pins the loaded LOD0 bounds against `CLIFF_MODEL_WIDTH` / `CLIFF_MODEL_HEIGHT` to one decimal; if it fails, the numbers in `cliffField.ts` are wrong, not the test — correct them from the failure's actual values and note the correction in the commit body.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npm run typecheck && npx eslint client/src/game/cliffMeshes.ts client/test/game/cliffMeshes.test.ts
git add client/src/game/cliffMeshes.ts client/test/game/cliffMeshes.test.ts
git commit -F - <<'EOF'
feat: draw the cliff modules in three LOD buckets per model

## What

The cliff shell loads the two rock-wall models, takes each one's three LOD
roots as thin-instance buckets, and fills them from the field on every
12 m crossing: matrices seated on the ground normal through the clutter
writer, the ground colour per instance for the tint plugin, and on the far
bucket alone a dither-out over the last 40 m before the reach on a
material of its own. The near buckets cast shadows.

## How

- `client/src/game/cliffMeshes.ts` — `createCliffMeshes` (loading, the
  buckets, the two-pass fill, exact-length buffer views, the far material
  clone with the forced distance fade, `casterMeshes`, `ready`, the
  snapped-origin rebuild rule, dispose).
- `client/test/game/cliffMeshes.test.ts` — the bucket set and its
  plugins, the model tables pinned against the loaded meshes, the fill
  against the field's own bands and the clutter writer, the rebuild rule.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
# then the repository's pre-push scan, which must pass
```
Expected: `0 failing`.

---

### Task 5: Renderer wiring and the architecture note

**Files:**
- Modify: `client/src/game/renderer.ts` (imports ~line 63; the field creation block after `const duffMeshes = ...` ~line 797; the caster registration ~line 945–960; both update sites ~974 and ~1008; the dispose list ~1120)
- Modify: `ARCHITECTURE.md` (the Rendering paragraph)
- Test: `client/test/game/renderer.test.ts` (append two cases beside the duff ones at ~line 429–454)

**Interfaces:**
- Consumes: `createCliffMeshes` (Task 4).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` that holds the duff wiring tests (the block ending at line ~454, which has `src` and `slice` in scope):

```ts
  it("creates the cliff field on every tier with the world seed", () => {
    const creation = slice("const duffMeshes =", "// Same late-registration story");
    // Every tier: the field has a ring set per tier (`CLIFF_RINGS`), and the
    // faces need their modules on the low tier as much as the high.
    expect(creation).toContain('const cliffMeshes = forest !== null ? createCliffMeshes(scene, forest.seed, { quality: tier }) : null;');
  });

  it("registers cliff casters late, updates cliffs in both camera branches after the forest, and disposes them", () => {
    const casters = slice("// Late caster registration", "applyWetness(scene, weather);");
    expect(casters).toContain("for (; cliffCastersRegistered < cliffMeshes.casterMeshes.length; cliffCastersRegistered++) {");
    expect(casters).toContain("lighting.addShadowMesh(cliffMeshes.casterMeshes[cliffCastersRegistered] as Mesh);");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/cliffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/cliffMeshes\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain("forestMeshes?.update(freecam.x, freecam.z);\n        cliffMeshes?.update(freecam.x, freecam.z);");
    expect(playerBranch).toContain("forestMeshes?.update(local.pos.x, local.pos.z);\n        cliffMeshes?.update(local.pos.x, local.pos.z);");
    expect(src.match(/cliffMeshes\?\.dispose\(\)/g)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run test/game/renderer.test.ts`
Expected: the two new cases FAIL (no `cliffMeshes` in the source); the rest pass.

- [ ] **Step 3: Wire the renderer**

In `client/src/game/renderer.ts`:

1. Imports, after `import { createDuffMeshes } from "./duffMeshes.js";`:
```ts
import { createCliffMeshes } from "./cliffMeshes.js";
```
(keep the import block's alphabetical order if the file keeps one — place it beside `clutterMeshes`' import if so.)

2. After the `const duffMeshes = ...` line (~797), before the `// Same late-registration story` comment:
```ts
  // Rock-wall modules on the faces too steep to stand on, on every tier —
  // the field carries a ring set per tier. Renderer-only: it reads the
  // simulation and touches nothing in it.
  const cliffMeshes = forest !== null ? createCliffMeshes(scene, forest.seed, { quality: tier }) : null;
```

3. Beside `let forestCastersRegistered = 0;` / `let clutterCastersRegistered = 0;` (find them with `grep -n CastersRegistered`), add:
```ts
  let cliffCastersRegistered = 0;
```

4. In the late caster registration block, after the clutter loop:
```ts
      // The cliff modules' near buckets, once their two GLBs have loaded.
      if (cliffMeshes !== null) {
        for (; cliffCastersRegistered < cliffMeshes.casterMeshes.length; cliffCastersRegistered++) {
          lighting.addShadowMesh(cliffMeshes.casterMeshes[cliffCastersRegistered] as Mesh);
        }
      }
```

5. Both update sites, immediately after the `forestMeshes?.update(...)` line:
```ts
        cliffMeshes?.update(freecam.x, freecam.z);
```
and
```ts
        cliffMeshes?.update(local.pos.x, local.pos.z);
```

6. Dispose list, after `duffMeshes?.dispose();`:
```ts
      cliffMeshes?.dispose();
```

- [ ] **Step 4: The architecture sentence**

In `ARCHITECTURE.md`, in the Rendering paragraph, after the sentence ending "…up to 0.30 m above the visible stone (`docs/rendering/2026-09-23-rock-relief-design.md`, §3)." append:

```
Rock ground too steep to stand on is dressed with two instanced rock-wall models (`cliffField.ts`, `cliffMeshes.ts`): a 12 m lattice seats a module wherever its centre and its four footprint corners are both rock and below the simulation's stand limit by a margin, facing downslope and sunk a third of its height, drawn in three LOD rings out to 400 m on the high tier, tinted halfway toward the ground under it (`cliffTintPlugin.ts`) — so a module never stands where a player can, and nothing in `sim/` changes.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/renderer.test.ts test/game/cliffMeshes.test.ts && cd .. && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Run the whole suite once**

Run: `npm test 2>&1 | tail -8` (with no game page open).
Expected: every root green; the `CLUTTER_TUNABLES` digest test in `client/test/sim/groundGradient.test.ts` untouched and green.

- [ ] **Step 7: Lint, commit**

```bash
npx eslint client/src/game/renderer.ts client/test/game/renderer.test.ts
git add client/src/game/renderer.ts client/test/game/renderer.test.ts ARCHITECTURE.md
git commit -F - <<'EOF'
feat: dress the steep rock faces with cliff modules

## What

The renderer now creates the cliff field beside the other ground fields
on every tier, registers its near buckets as shadow casters as their
models load, updates it at both per-frame sites after the forest, and
disposes it with the rest. The steep rock hillsides read as ledged rock
with a broken skyline; walkable ground is untouched.

## How

- `client/src/game/renderer.ts` — `createCliffMeshes(scene, forest.seed,
  { quality: tier })`; the late caster loop like the forest's; the update
  in the freecam branch and the player branch; the dispose entry.
- `client/test/game/renderer.test.ts` — the creation guard, the caster
  loop, both update sites, the dispose.
- `ARCHITECTURE.md` — the rendering paragraph names the field and its rule.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
# then the repository's pre-push scan, which must pass
```
Expected: `0 failing`.

---

### Task 6: The gates and the verification doc

**Files:**
- Create: `docs/rendering/<YYYY-MM-DD>-cliff-modules-verification.md` (dated the day it is written)
- Scratch (never committed): a stills script and a frame-time run under the scratchpad directory.

**Interfaces:**
- Consumes: the rig in `~/Projects/fps-sdd-archive/2026-09-22-blade-field/scripts/` — `apply-hooks.py <worktree> <vitePort> <wsPort> [revert]` (exposes `window.__fcSet(x, y, z, yaw, pitch)`, `__engine`, `__scene`, `__tier`, and moves vite to the port), `apply-tier-hook.py <worktree> [revert]` (reads `?tier=` from the URL), `stills.sh` and `frametime.sh` as templates. The chrome-devtools CLI (`chrome-devtools start --isolated=true --allowUnrestrictedPaths=true`, `new_page`, `evaluate_script`, `take_screenshot`, `close_page`, `stop`).

Control: the worktree `.claude/worktrees/forest-control` is at f276f25, which is NOT current `origin/main` (d07a2cc). Re-point it first: `git -C .claude/worktrees/forest-control checkout --detach d07a2cc` (it is a detached worktree; confirm with `git worktree list`). The branch serves on 5174, the control on 5175.

- [ ] **Step 1: Stand up both builds, hooked**

```bash
R=~/Projects/fps-sdd-archive/2026-09-22-blade-field/scripts
P=/Users/csarko/Projects/game-dayhike/.claude/worktrees/cliff-modules
C=/Users/csarko/Projects/game-dayhike/.claude/worktrees/forest-control
git -C $C checkout --detach d07a2cc
python3 $R/apply-hooks.py $P 5174 8081 && python3 $R/apply-tier-hook.py $P
python3 $R/apply-hooks.py $C 5175 8081 && python3 $R/apply-tier-hook.py $C
(cd $P/client && npx vite --strictPort > /tmp/vite5174.log 2>&1 &)
(cd $C/client && npx vite --strictPort > /tmp/vite5175.log 2>&1 &)
sleep 9; for p in 5174 5175; do printf "%s: %s\n" $p "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$p/dayhike/)"; done
```
Expected: `5174: 200` and `5175: 200`. The hooks are working-tree edits to `app.ts`, `renderer.ts` and `vite.config.ts` — they are reverted in Step 5 and must never be committed (`git status --porcelain` must be empty before every commit).

- [ ] **Step 2: Paired stills at the spec's poses**

Write `$SCRATCH/cliff-stills.sh` from the block-field stills script's `still()` function (the shape: blank every open Day Hike page, `new_page` with `?cmd=<cmd>&tier=high`, sleep 20, `__fcSet`, sleep 6, `take_screenshot`, `close_page`) and shoot, on both ports, `C12="seed%20atmo;freecam;weather%20clear;time%2012"`:

| name | x | y | z | yaw | pitch |
| --- | --- | --- | --- | --- | --- |
| face-10m | −345.5 | 41.8 | −896.9 | 1.882 | −0.75 |
| face-30m | −365.0 | 30.0 | −893.9 | 1.882 | −0.6 |
| face-80m | −420 | 60 | −900 | 1.571 | −0.05 |
| along-face | −340 | 60 | −860 | 3.1416 | 0.05 |
| crest-down | −300 | 135 | −900 | 4.712 | 0.6 |
| seam-a | −147 | 53.1 | 42 | 0.0 | 0.15 |
| seam-b | −147 | 53.1 | 42 | 1.571 | 0.15 |

(In `__fcSet`, negative pitch looks up, positive down.) Pair each with `ffmpeg -i control-<n>.jpeg -i preview-<n>.jpeg -filter_complex "[0:v]scale=600:-1[a];[1:v]scale=600:-1[b];[a][b]hstack" pair-<n>.jpg`. Also record, per preview page, `JSON.stringify(window.__scene.meshes.filter(m => /^cliff_/.test(m.name)).map(m => [m.name, m.thinInstanceCount]))` so the doc quotes instance counts per bucket at each pose.

Judge against the spec §8: the face reads as ledged rock with a broken skyline in every pose that shows it; `seam-a` / `seam-b` are pixel-identical (`compare -metric AE` from ImageMagick if present, else a byte-equal check of the two JPEGs is not valid — use `ffmpeg -i a -i b -filter_complex psnr -f null -` and require `psnr_avg:inf`).

- [ ] **Step 3: Frame pairs**

Copy `frametime.sh` to the scratchpad, add a `cliff` view line `"cliff|seed%20atmo;freecam;weather%20clear;time%2012|-345.5|41.8|-896.9|1.882|-0.75|false"`, and run `frametime.sh high $SCRATCH/cliff-frames.tsv cliff trailside`. Expected: the `cliff` view's branch − control mean, median of the two orders, ≤ +1.5 ms at 4× pixels; `trailside` within noise (≤ +0.3 ms). Then native (`SCALE=1`) at the cliff pose only, on a quiet machine (`uptime` load under 2): p95 branch − control ≤ +1.0 ms.

If the bar is missed, apply the spec's fallbacks in order (LOD0 targets are a model rebuild and out of this repo's scope — report it; then `CLIFF_RINGS.high[2]` 400 → 300; then `CLIFF_CELL` 12 → 16; then `CLIFF_DENSITY` 0.5 → 0.4), each as its own commit with the tests' literals updated, and re-measure.

- [ ] **Step 4: Write the verification doc**

`docs/rendering/<date>-cliff-modules-verification.md`, in the shape of `docs/rendering/2026-09-24-forest-floor-verification.md`: the poses and what each pair shows; the seam identity result; the bucket instance counts per pose; the frame pair table (both orders, medians); the native p95; the field census numbers from Task 1's test run (modules found on 200 worlds, placed / qualifying on the worst disc); what is still owed (the block field at the foot, mirrored variants, the snowy faces, the crest band beyond reach). Plain description of what is seen — no process vocabulary.

- [ ] **Step 5: Tear down, revert the hooks, commit the doc**

```bash
chrome-devtools stop; pkill -f "vite --strictPort"; sleep 2
python3 $R/apply-tier-hook.py $P revert && python3 $R/apply-hooks.py $P 5174 8081 revert && git -C $P status --porcelain
python3 $R/apply-tier-hook.py $C revert && python3 $R/apply-hooks.py $C 5175 8081 revert && git -C $C status --porcelain
```
Expected: both status outputs empty. Then:

```bash
(cd tools && npx vitest run docs)
git add docs/rendering/<date>-cliff-modules-verification.md
git commit -F - <<'EOF'
docs: verify the cliff modules at the scarp and the seam

## What

Paired stills of the steep scarp at 10, 30 and 80 m, along the face and
from the crest, against the build without the modules; the trail-over-rock
seam pose unchanged pixel for pixel; frame pairs at four times the pixels
in both orders and the native tail at the face.

## How

- `docs/rendering/<date>-cliff-modules-verification.md` — the poses, what
  each shows, the bucket counts, the frame table and what is still owed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
# then the repository's pre-push scan, which must pass
```
Expected: docs name test green; `0 failing`.

---

## Self-review

- **Spec coverage.** §1 rulings: modules (Task 4 loads the two committed GLBs), collision none and `sim/` untouched (Global Constraints, Task 5 Step 6), gate with margin at centre and four probes (Task 1), rings per tier (Task 2 `CLIFF_RINGS`), geometric seams with a far dither (Task 4), tint 0.5 (Task 3), cost bars (Task 6). §4.1 steps 1–6 → Task 1 (`cliffCellPoint`, `cliffGate`, module choice, frame, footprint, density draw first). §4.2 → Task 2 collector + `cliffBands`, `CLIFF_PAD`. §4.3 → Task 4 far material clone. §4.4 → Task 3 + `writeFoliage` in Task 4; casters in Task 4/5. §4.5 → Task 5. §5 budget → Task 2 test. §6 invariants 1–5 → Task 1 (1, 3), Task 2 (4, 5), Global Constraints (2). §7 tests → Tasks 1–5. §8 gates and fallbacks → Task 6.
- **Placeholder scan.** No TBD/TODO. The only deferred values are the verification doc's date and measured numbers, which the task says to fill from the runs.
- **Type consistency.** `cliffCell` returns `ClutterInstance | null` everywhere; `cliffBands` takes `readonly [number, number, number]` and `CLIFF_RINGS` values are that tuple type; `CliffMeshesOptions.loader` returns `Promise<AssetContainer>` and the test's loader does; `cliffMeshName(model, lod)` ends `_l<lod>`, which the caster-name regex and the dispose check rely on; `fadeBands(null, [a, b])` returns `[-2, -1, a, b]`, which the shell test asserts.
