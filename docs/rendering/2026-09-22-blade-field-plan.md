# The Blade Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dense blade grass wherever the ground is grass inside 18 m of the eye, continuous where the gate is low, in three distance tiers of four clump characters with wildflowers, handing off to the cards at the carpet's own seam, inside +2 ms native on the high tier.

**Architecture:** A Babylon-free near-field lattice (`bladeField.ts`, 0.5 m cells, 1 m rebuild cadence) reads the sim's grass gate per cell and emits cells with a continuous strength and a hashed character, sorted nearest-first into three tier lists with hand-off duplication. `bladeClump.ts` builds one mesh per character × tier from a parameter table, with seed heads and flower heads as tip features. `bladeMeshes.ts` is the Babylon shell: twelve thin-instance buckets on three tier materials, filled through the cards' own matrix, trample and tint writers, plus a per-instance strength. The foliage plugin's collapse gains a grow-in band and a strength cut so every hand-off is geometric. The old blade bucket, its list and its constants are retired; the meadow's near cards go unfilled on the tiers that draw blades.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`MaterialPluginBase`, thin instances, `VertexData`), GLSL in `shaders/*.fx`, vitest with `NullEngine`.

**Spec:** `docs/rendering/2026-09-22-blade-field-design.md`

## Global Constraints

- Renderer-only: nothing touches `client/src/sim/`, `windParams.ts`, `distanceFadePlugin.ts`, the foliage plugin's fragment stage, or any asset. The level id does not move.
- `bladeField.ts` and `bladeClump.ts` are Babylon-free and on `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`. They may import from `../sim/*` (pure functions), `./groundHexParams.js`, `./colour.js`, `./clutterField.js`.
- Constants, verbatim from the spec: `BLADE_CELL = 0.5`, `BLADE_REBUILD_CELL = 1`, `BLADE_PAD = √2·(1 + 0.5)`, `BLADE_REACH = CLUTTER_RADII[CLUTTER_MEADOW] · CLUTTER_FAR_SPLIT` (= 18), `BLADE_TIER_EDGE = [4, 8]`, `BLADE_TIER_BAND = 1.5` (bands [2.5, 4] and [6.5, 8]; the outer band is `clutterSeamEdges(CLUTTER_MEADOW)`), `BLADE_STRENGTH_FLOOR = 0.05`, `BLADE_CLUMP_RADIUS = 0.35`, `BLADE_RINGS = 3`, `BLADE_ALBEDO = (0.30, 0.40, 0.12)`, `BLADE_TIP_TINT = (0.95, 0.95, 0.75)`, `BLADE_LUMA = 0.3`, `BLADE_SOFT = 0.15`, `BLADE_VERTEX_BUDGET = 1_000_000`, character weights 0.6 / 0.2 / 0.12 / 0.08 with `BLADE_FLOWER_MIN_STRENGTH = 0.5`, the character table and the per-tier counts of spec §5, material metallic 0, roughness 0.8, two-sided, `receiveShadows = true`, never `attachDistanceFade`.
- GLSL rules (`shaderHygiene.test.ts`): no comment spelling a preprocessor directive, no semicolon inside a trailing comment on a code line; every new uniform on BOTH the `getUniforms().ubo` list and the non-UBO vertex string; shader constants mirrored in TypeScript and pinned by the lockstep test with `glslFloat`.
- Plugin attach stays idempotent. No `discard` in any shader the blade materials compile.
- Public repository: no code comment, doc or commit message mentions how an asset was made, the private design process, sessions, agents, reviews, screenshots, probes, controllers, briefs or "the owner".
- Commit messages: type-prefixed subject under 72 chars, a `## What` paragraph, a `## How` list led by backticked paths, one blank line, then `Co-Authored-By: Claude <model> <noreply@anthropic.com>` naming the model that writes the commit. Stage explicit paths only. Tests are run per file (`npx vitest run <file>`); the full suite is the controller's.
- Docs under `docs/` are named `YYYY-MM-DD-<topic>.md`; new docs here are dated 2026-09-22.

---

## File map

| File | Task | Change |
| --- | --- | --- |
| `client/src/game/bladeField.ts` (new) | 1 | Constants, `BladeCell`, `bladeCellAt`, `bladeCharacterFor`, `bladeTierBands`, `collectBladeCells`, `createBladeCollector`. |
| `client/test/game/bladeField.test.ts` (new), `client/test/architecture.test.ts` | 1 | Membership, strength, tiers, pad, bands; Babylon-free. |
| `client/src/game/bladeClump.ts` | 2 | Characters, tier counts, `bladeClumpGeometry(character, count)`, tip features, `bladeVertexCount`, `bladeAlive` with grow-in and strength. |
| `client/test/game/bladeClump.test.ts` | 2 | Per character × tier; the vertex budget; `bladeAlive` at the edges. |
| `client/src/game/foliagePlugin.ts`, `shaders/foliage.vertex.fx`, `shaders/foliageWorldPos.vertex.fx` | 3 | `foliageBladeEdges` vec4 uniform, `setFoliageBladeEdges`, the `bladeStrength` attribute, the grow-in/strength collapse. |
| `client/test/game/foliagePlugin.test.ts` | 3 | Uniform on both paths, attribute gating, the collapse text, both-path compile. |
| `client/src/game/bladeMeshes.ts` (new) | 4 | The shell: materials, meshes, buckets, fill, 1 m cadence, dispose. |
| `client/src/game/clutterMeshes.ts` | 4, 5 | Export `prepBucketMesh` and `writeFoliage` (4); retire the blade bucket, `nearBlades` option (5). |
| `client/test/game/bladeMeshes.test.ts` (new) | 4 | Buckets, matrices, attributes, plugins, dispose. |
| `client/src/game/clutterField.ts`, `client/src/game/renderer.ts` | 5 | Retire `blades`/`bladeReach`/`BLADE_*`/`bladeEdges`; wire `createBladeMeshes`. |
| `client/test/game/clutterField.test.ts`, `client/test/game/clutterMeshes.test.ts` | 5 | Remove the blade describes; pin the unfilled meadow near bucket and the grass in-band. |
| `ARCHITECTURE.md`, `docs/rendering/2026-09-22-blade-field-verification.md` (new) | 6 | The sentence; the record. |

---

### Task 1: the blade field

**Files:**
- Create: `client/src/game/bladeField.ts`
- Modify: `client/test/architecture.test.ts` (`BABYLON_FREE_FILES`, after the `bladeClump.ts` entry)
- Test: `client/test/game/bladeField.test.ts` (new)

**Interfaces:**
- Consumes: `clutterDensity(seed, cls, x, z, sample?)`, `CLUTTER_GRASS`, `CLUTTER_MEADOW`, `type ClutterInstance` from `../sim/clutter.js`; `activeTerrainVariant()` (`.sample(seed, x, z)` → `{ h, dx, dz }`, `.trailDistance?`) from `../sim/terrain.js`; `forestDensity(seed, x, z, sample?)` from `../sim/vegetation.js`; `latticeHash(ci, cj)` from `./groundHexParams.js`; `CLUTTER_RADII`, `CLUTTER_FAR_SPLIT`, `clutterSeamEdges` from `./clutterField.js`.
- Produces: everything below. Task 4 consumes `createBladeCollector`, `BladeTiers`, `BladeCell`, `bladeTierBands`, `BLADE_CHARACTER_COUNT`, `BLADE_REBUILD_CELL`; Task 2 consumes the character ids.

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/bladeField.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { CLUTTER_GRASS, CLUTTER_MEADOW, clutterDensity } from "../../src/sim/clutter.js";
import { CLUTTER_FAR_SPLIT, CLUTTER_RADII, clutterSeamEdges } from "../../src/game/clutterField.js";
import {
  BLADE_CELL, BLADE_CHARACTER_COUNT, BLADE_CHARACTER_WEIGHTS, BLADE_FINE, BLADE_FLOWER, BLADE_FLOWER_MIN_STRENGTH,
  BLADE_PAD, BLADE_REACH, BLADE_REBUILD_CELL, BLADE_STRENGTH_FLOOR, BLADE_TIER_BAND, BLADE_TIER_EDGE,
  bladeCellAt, bladeCharacterFor, bladeTierBands, collectBladeCells, createBladeCollector, type BladeCell,
} from "../../src/game/bladeField.js";

// An open-field point where the grass gate is high across a wide neighbourhood
// (the census point clutter.test.ts uses), so every tier holds cells.
const SEED = 1;
const CAM = { x: 35, z: 21335 };

function d2From(ox: number, oz: number, c: { x: number; z: number }): number {
  return (c.x - ox) ** 2 + (c.z - oz) ** 2;
}
function origin(v: number): number {
  return Math.floor(v / BLADE_CELL) * BLADE_CELL;
}

describe("the blade field's constants", () => {
  it("reaches the meadow's own near/far split and pads for a 1 m rebuild on a 0.5 m lattice", () => {
    expect(BLADE_REACH).toBe(CLUTTER_RADII[CLUTTER_MEADOW]! * CLUTTER_FAR_SPLIT);
    expect(BLADE_REACH).toBe(18);
    expect(BLADE_PAD).toBeCloseTo(Math.SQRT2 * (BLADE_REBUILD_CELL + BLADE_CELL), 12);
    expect(BLADE_TIER_EDGE).toEqual([4, 8]);
    expect(BLADE_TIER_BAND).toBe(1.5);
  });

  it("hands off fine → mid → coarse → cards over the spec's bands, the last being the meadow seam", () => {
    const [fine, mid, coarse] = bladeTierBands();
    expect(fine.slice(2)).toEqual([BLADE_TIER_EDGE[0] - BLADE_TIER_BAND, BLADE_TIER_EDGE[0]]);
    expect(fine[0]).toBeLessThan(fine[1]);
    expect(fine[1]).toBeLessThan(0); // a no-op in-band: every distance is past it
    expect(mid).toEqual([BLADE_TIER_EDGE[0] - BLADE_TIER_BAND, BLADE_TIER_EDGE[0], BLADE_TIER_EDGE[1] - BLADE_TIER_BAND, BLADE_TIER_EDGE[1]]);
    const seam = clutterSeamEdges(CLUTTER_MEADOW);
    expect(coarse).toEqual([BLADE_TIER_EDGE[1] - BLADE_TIER_BAND, BLADE_TIER_EDGE[1], seam.start, seam.end]);
  });

  it("picks characters by the spec's weights, and flowers only in thick grass", () => {
    expect(BLADE_CHARACTER_WEIGHTS).toEqual([0.6, 0.2, 0.12, 0.08]);
    expect(BLADE_CHARACTER_COUNT).toBe(4);
    const counts = new Array<number>(BLADE_CHARACTER_COUNT).fill(0);
    const n = 10000;
    for (let i = 0; i < n; i++) counts[bladeCharacterFor(i / n, 1)]!++;
    for (let c = 0; c < BLADE_CHARACTER_COUNT; c++) expect(counts[c]! / n).toBeCloseTo(BLADE_CHARACTER_WEIGHTS[c]!, 2);
    for (let i = 0; i < n; i++) expect(bladeCharacterFor(i / n, BLADE_FLOWER_MIN_STRENGTH - 0.01)).not.toBe(BLADE_FLOWER);
    expect(bladeCharacterFor(0.99, 1)).toBe(BLADE_FLOWER);
    expect(bladeCharacterFor(0.1, 0.1)).toBe(BLADE_FINE);
  });
});

describe("one cell", () => {
  it("carries the sim's grass gate as its strength, the terrain under it, and is deterministic", () => {
    const ci = Math.floor(CAM.x / BLADE_CELL), cj = Math.floor(CAM.z / BLADE_CELL);
    const a = bladeCellAt(SEED, ci, cj);
    expect(a).not.toBeNull();
    const c = a as BladeCell;
    expect(c.strength).toBeCloseTo(clutterDensity(SEED, CLUTTER_GRASS, c.x, c.z), 12);
    expect(c.strength).toBeGreaterThanOrEqual(BLADE_STRENGTH_FLOOR);
    // Jittered inside its own cell.
    expect(c.x).toBeGreaterThanOrEqual(ci * BLADE_CELL);
    expect(c.x).toBeLessThan((ci + 1) * BLADE_CELL);
    expect(c.z).toBeGreaterThanOrEqual(cj * BLADE_CELL);
    expect(c.z).toBeLessThan((cj + 1) * BLADE_CELL);
    expect(c.cls).toBe(CLUTTER_MEADOW);
    expect(c.scale).toBe(1);
    expect(c.variant).toBe(0);
    expect(c.hash).toBeGreaterThanOrEqual(0);
    expect(c.hash).toBeLessThan(1);
    expect(c.character).toBe(bladeCharacterFor(c.characterDraw, c.strength));
    expect(bladeCellAt(SEED, ci, cj)).toEqual(a);
  });

  it("emits nothing where the gate is under the floor, and every emitted cell clears it", () => {
    // A 100 m × 100 m window around the census point: the trail bed inside
    // it clears the grass gate to 0, so some cells are null; every cell that
    // is not null clears the floor.
    const ci0 = Math.floor(CAM.x / BLADE_CELL) - 100, cj0 = Math.floor(CAM.z / BLADE_CELL) - 100;
    let nulls = 0, cells = 0;
    for (let ci = ci0; ci < ci0 + 200; ci += 2) {
      for (let cj = cj0; cj < cj0 + 200; cj += 2) {
        const c = bladeCellAt(SEED, ci, cj);
        if (c === null) {
          nulls++;
          // The jitter moves the sample by at most 0.2 m from the cell centre.
          const x = (ci + 0.5) * BLADE_CELL, z = (cj + 0.5) * BLADE_CELL;
          expect(clutterDensity(SEED, CLUTTER_GRASS, x, z)).toBeLessThan(0.5);
        } else {
          cells++;
          expect(c.strength).toBeGreaterThanOrEqual(BLADE_STRENGTH_FLOOR);
        }
      }
    }
    expect(cells).toBeGreaterThan(1000);
    // Not asserted > 0: whether a null cell falls inside this window is the
    // world's business; the gate test above is what matters.
    void nulls;
  });
});

describe("the tiers", () => {
  const tiers = collectBladeCells(SEED, CAM.x, CAM.z);
  const ox = origin(CAM.x), oz = origin(CAM.z);

  it("holds every cell of the disc exactly once per tier it belongs to, nearest first", () => {
    const [e0, e1] = BLADE_TIER_EDGE;
    const lists: [BladeCell[], number, number][] = [
      [tiers.fine, 0, e0 + BLADE_PAD],
      [tiers.mid, e0 - BLADE_TIER_BAND - BLADE_PAD, e1 + BLADE_PAD],
      [tiers.coarse, e1 - BLADE_TIER_BAND - BLADE_PAD, BLADE_REACH + BLADE_PAD],
    ];
    for (const [list, lo, hi] of lists) {
      expect(list.length).toBeGreaterThan(50);
      const seen = new Set<string>();
      for (let k = 0; k < list.length; k++) {
        const c = list[k]!;
        const d = Math.sqrt(d2From(ox, oz, c));
        expect(d).toBeGreaterThanOrEqual(Math.max(0, lo) - 1e-9);
        expect(d).toBeLessThan(hi + 1e-9);
        if (k > 0) expect(d2From(ox, oz, c)).toBeGreaterThanOrEqual(d2From(ox, oz, list[k - 1]!));
        const key = `${c.x},${c.z}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("is the full lattice: every jittered cell under the reach with a gate above the floor is present", () => {
    const all = new Set<string>();
    for (const c of [...tiers.fine, ...tiers.mid, ...tiers.coarse]) all.add(`${c.x},${c.z}`);
    const r = BLADE_REACH + BLADE_PAD;
    let expected = 0;
    for (let ci = Math.floor((ox - r) / BLADE_CELL); ci <= Math.floor((ox + r) / BLADE_CELL); ci++) {
      for (let cj = Math.floor((oz - r) / BLADE_CELL); cj <= Math.floor((oz + r) / BLADE_CELL); cj++) {
        const c = bladeCellAt(SEED, ci, cj);
        if (c === null || d2From(ox, oz, c) >= r * r) continue;
        expected++;
        expect(all.has(`${c.x},${c.z}`)).toBe(true);
      }
    }
    expect(all.size).toBe(expected);
  });

  it("never lets a tier pop: every cell under a tier's edge of any eye in the rebuild cell is in that tier", () => {
    const cx = Math.floor(CAM.x / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
    const cz = Math.floor(CAM.z / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
    const eyes = [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]] as const;
    const fine = new Set(tiers.fine), mid = new Set(tiers.mid), coarse = new Set(tiers.coarse);
    const every = [...tiers.fine, ...tiers.mid, ...tiers.coarse];
    let checked = 0;
    for (const [ex, ez] of eyes) {
      const eyeX = cx + ex, eyeZ = cz + ez;
      for (const c of every) {
        const d = Math.hypot(c.x - eyeX, c.z - eyeZ);
        if (d < BLADE_TIER_EDGE[0]) { expect(fine.has(c)).toBe(true); checked++; }
        if (d >= BLADE_TIER_EDGE[0] - BLADE_TIER_BAND && d < BLADE_TIER_EDGE[1]) { expect(mid.has(c)).toBe(true); checked++; }
        if (d >= BLADE_TIER_EDGE[1] - BLADE_TIER_BAND && d < BLADE_REACH) { expect(coarse.has(c)).toBe(true); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("the memoized collector agrees with the pure walk and reuses cells across a crossing", () => {
    const collector = createBladeCollector(SEED);
    const a = collector.collect(CAM.x, CAM.z);
    const b = collectBladeCells(SEED, CAM.x, CAM.z);
    expect(a.fine.map((c) => [c.x, c.z])).toEqual(b.fine.map((c) => [c.x, c.z]));
    expect(a.coarse.length).toBe(b.coarse.length);
    const cold = collector.size;
    collector.collect(CAM.x + BLADE_REBUILD_CELL, CAM.z);
    // One metre of travel samples a ring's worth of new cells, not a disc's.
    expect(collector.size - cold).toBeLessThan(cold * 0.2);
  });
});
```

Add `join(SRC, "game", "bladeField.ts"),` to `BABYLON_FREE_FILES` in `client/test/architecture.test.ts` after the `bladeClump.ts` line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/bladeField.test.ts client/test/architecture.test.ts`
Expected: FAIL — cannot resolve `../../src/game/bladeField.js`.

- [ ] **Step 3: Implement**

Create `client/src/game/bladeField.ts`:

```ts
import { CLUTTER_GRASS, CLUTTER_MEADOW, clutterDensity, type ClutterInstance } from "../sim/clutter.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { forestDensity } from "../sim/vegetation.js";
import { latticeHash } from "./groundHexParams.js";
import { CLUTTER_FAR_SPLIT, CLUTTER_RADII, clutterSeamEdges } from "./clutterField.js";

/**
 * The blade field: the near-field lattice the blade clumps stand on, walked
 * around the eye and gated by the sim's own grass gate. Pure and
 * Babylon-free like `clutterField.ts`, whose walk this mirrors: cells of
 * BLADE_CELL on a fixed world grid, squared distances from a snapped origin,
 * a memoising collector keyed by cell. Where the clutter classes decide
 * presence by a coin flip per cell, this field draws a clump in every cell
 * whose gate clears a floor and lets the gate set how much grass the clump
 * shows (`strength`), so a thin spot is a thin sward rather than bare floor
 * with tufts.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 * The sim is read (its gate, terrain sample, trail distance and forest
 * density), never written.
 */

/** Lattice cell (m). */
export const BLADE_CELL = 0.5;
/** The field rebuilds when the eye crosses a cell of this size (m). */
export const BLADE_REBUILD_CELL = 1;
/** The worst offset (m) between the true eye and the origin the distances
 * were measured against: the origin is floored to BLADE_CELL at the last
 * rebuild, and the eye moves under BLADE_REBUILD_CELL per axis before the
 * next. Every tier list is collected this far past its edge, so a clump is
 * present for every eye inside the rebuild cell and never pops. */
export const BLADE_PAD = Math.SQRT2 * (BLADE_REBUILD_CELL + BLADE_CELL);
/** The outer reach: the meadow carpet's own near/far split, so the coarse
 * tier hands off to the far cards where they already dither in. */
export const BLADE_REACH = (CLUTTER_RADII[CLUTTER_MEADOW] as number) * CLUTTER_FAR_SPLIT;
/** Outer edges (m) of the fine and mid tiers. */
export const BLADE_TIER_EDGE: readonly [number, number] = [4, 8];
/** Width (m) of the fine→mid and mid→coarse hand-off bands, ending at the tier edge. */
export const BLADE_TIER_BAND = 1.5;
/** A cell whose gate is under this draws nothing. */
export const BLADE_STRENGTH_FLOOR = 0.05;
/** Jitter of a cell's clump inside the cell, as a fraction of the cell. */
export const BLADE_JITTER = 0.4;

/** Clump characters, by index into `BLADE_CHARACTERS` (bladeClump.ts). */
export const BLADE_FINE = 0;
export const BLADE_TUSSOCK = 1;
export const BLADE_WEED = 2;
export const BLADE_FLOWER = 3;
export const BLADE_CHARACTER_COUNT = 4;
/** Share of cells per character at full strength, in index order. */
export const BLADE_CHARACTER_WEIGHTS: readonly number[] = [0.6, 0.2, 0.12, 0.08];
/** Flower-bearing clumps only stand in grass at least this thick; below it
 * their share goes to fine grass. */
export const BLADE_FLOWER_MIN_STRENGTH = 0.5;

/** Four numbers like `fadeBands`: grow-in start and end, collapse start and end. */
export type BladeEdges = readonly [number, number, number, number];

/** A no-op grow-in: two distinct negative edges every distance is past. */
const GROW_NONE: readonly [number, number] = [-2, -1];

/** The three tiers' hand-off edges, in true eye distance. The fine tier has
 * no grow-in; each tier collapses over the band the next one grows over; the
 * coarse tier collapses over the meadow seam, where the far cards dither in. */
export function bladeTierBands(): [BladeEdges, BladeEdges, BladeEdges] {
  const [e0, e1] = BLADE_TIER_EDGE;
  const seam = clutterSeamEdges(CLUTTER_MEADOW);
  return [
    [GROW_NONE[0], GROW_NONE[1], e0 - BLADE_TIER_BAND, e0],
    [e0 - BLADE_TIER_BAND, e0, e1 - BLADE_TIER_BAND, e1],
    [e1 - BLADE_TIER_BAND, e1, seam.start, seam.end],
  ];
}

/** The character a cell draws: the weights walked with one uniform draw,
 * the flower share folded into fine grass below the strength threshold. */
export function bladeCharacterFor(draw: number, strength: number): number {
  let acc = 0;
  for (let c = 0; c < BLADE_CHARACTER_COUNT; c++) {
    let w = BLADE_CHARACTER_WEIGHTS[c] as number;
    if (c === BLADE_FINE && strength < BLADE_FLOWER_MIN_STRENGTH) w += BLADE_CHARACTER_WEIGHTS[BLADE_FLOWER] as number;
    if (c === BLADE_FLOWER && strength < BLADE_FLOWER_MIN_STRENGTH) w = 0;
    acc += w;
    if (draw < acc) return c;
  }
  return BLADE_FINE;
}

/**
 * One cell of the field. It is shaped as a `ClutterInstance` of the meadow
 * class (unit scale, variant 0) so the cards' matrix, trample and tint
 * writers in clutterMeshes.ts serve it unchanged, plus the field's own:
 * the gate strength, the canopy, the trail distance and the character.
 */
export type BladeCell = ClutterInstance & {
  /** The sim's grass gate at the clump, in [BLADE_STRENGTH_FLOOR, 1]. */
  strength: number;
  /** forestDensity at the clump, for the shade and the height. */
  canopy: number;
  /** Distance to the trail edge (Infinity without a trail). */
  rt: number;
  character: number;
  /** The uniform draw the character came from, kept so a test can re-derive it. */
  characterDraw: number;
};

/** One of a cell's draws: the lattice hash on salted cell indices. */
function cellDraw(ci: number, cj: number, salt: number): number {
  return latticeHash(ci + 131 * salt, cj + 173 * salt);
}

/** The cell at lattice indices (ci, cj), or null where the gate is under the
 * floor. Pure in (seed, ci, cj): every rebuild sees the same cell. */
export function bladeCellAt(seed: number, ci: number, cj: number): BladeCell | null {
  const x = (ci + 0.5 + BLADE_JITTER * (cellDraw(ci, cj, 1) - 0.5)) * BLADE_CELL;
  const z = (cj + 0.5 + BLADE_JITTER * (cellDraw(ci, cj, 2) - 0.5)) * BLADE_CELL;
  const variant = activeTerrainVariant();
  const s = variant.sample(seed, x, z);
  const strength = clutterDensity(seed, CLUTTER_GRASS, x, z, s);
  if (strength < BLADE_STRENGTH_FLOOR) return null;
  const characterDraw = cellDraw(ci, cj, 4);
  return {
    cls: CLUTTER_MEADOW,
    x,
    z,
    groundH: s.h,
    groundDx: s.dx,
    groundDz: s.dz,
    scale: 1,
    variant: 0,
    hash: cellDraw(ci, cj, 3),
    strength,
    canopy: forestDensity(seed, x, z, s),
    rt: variant.trailDistance?.(seed, x, z) ?? Infinity,
    character: bladeCharacterFor(characterDraw, strength),
    characterDraw,
  };
}

export type BladeTiers = { fine: BladeCell[]; mid: BladeCell[]; coarse: BladeCell[] };

function bladeOrigin(v: number): number {
  return Math.floor(v / BLADE_CELL) * BLADE_CELL;
}

/** The walk, shared by the pure one-shot and the memoising collector. */
function collectBladeCore(camX: number, camZ: number, sample: (ci: number, cj: number) => BladeCell | null): BladeTiers {
  const ox = bladeOrigin(camX), oz = bladeOrigin(camZ);
  const [e0, e1] = BLADE_TIER_EDGE;
  const fineHi = e0 + BLADE_PAD;
  const midLo = Math.max(0, e0 - BLADE_TIER_BAND - BLADE_PAD), midHi = e1 + BLADE_PAD;
  const coarseLo = Math.max(0, e1 - BLADE_TIER_BAND - BLADE_PAD), coarseHi = BLADE_REACH + BLADE_PAD;
  const fineHi2 = fineHi * fineHi, midLo2 = midLo * midLo, midHi2 = midHi * midHi;
  const coarseLo2 = coarseLo * coarseLo, coarseHi2 = coarseHi * coarseHi;
  const r = coarseHi;
  const fine: { c: BladeCell; d2: number }[] = [];
  const mid: { c: BladeCell; d2: number }[] = [];
  const coarse: { c: BladeCell; d2: number }[] = [];
  const c0x = Math.floor((ox - r) / BLADE_CELL), c1x = Math.floor((ox + r) / BLADE_CELL);
  const c0z = Math.floor((oz - r) / BLADE_CELL), c1z = Math.floor((oz + r) / BLADE_CELL);
  for (let cj = c0z; cj <= c1z; cj++) {
    for (let ci = c0x; ci <= c1x; ci++) {
      const c = sample(ci, cj);
      if (c === null) continue;
      const dx = c.x - ox, dz = c.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= coarseHi2) continue;
      if (d2 < fineHi2) fine.push({ c, d2 });
      if (d2 >= midLo2 && d2 < midHi2) mid.push({ c, d2 });
      if (d2 >= coarseLo2) coarse.push({ c, d2 });
    }
  }
  const nearest = (a: { d2: number }, b: { d2: number }) => a.d2 - b.d2;
  fine.sort(nearest);
  mid.sort(nearest);
  coarse.sort(nearest);
  return { fine: fine.map((p) => p.c), mid: mid.map((p) => p.c), coarse: coarse.map((p) => p.c) };
}

/** The three tier lists around the eye, nearest first, each padded past its
 * band so no eye inside the rebuild cell can want a clump that is absent. */
export function collectBladeCells(seed: number, camX: number, camZ: number): BladeTiers {
  return collectBladeCore(camX, camZ, (ci, cj) => bladeCellAt(seed, ci, cj));
}

export type BladeCollector = {
  /** Identical output to `collectBladeCells(seed, camX, camZ)`. */
  collect(camX: number, camZ: number): BladeTiers;
  /** Cached cell count, for the tests. */
  readonly size: number;
};

// Numeric cell key: exact for |index| < 2^20 (±524 km on a 0.5 m lattice).
const KEY_HALF = 1 << 20;
const KEY_SPAN = 1 << 21;
/** Cells whose nearest point sits this far past the reach are evicted. */
const EVICT_RADIUS = BLADE_REACH + BLADE_PAD + 8 * BLADE_CELL;
/** A cold disc is about π·(18 + 2.1)²/0.25 ≈ 5,100 cells; a 1 m crossing adds
 * about 450. The sweep runs once this many are cached, so it is periodic,
 * never per crossing. */
export const BLADE_SWEEP_SIZE = 30000;

/** The memoising collector the shell uses: `bladeCellAt` is pure in its cell,
 * so a crossing re-samples only the ring of cells newly inside the disc. */
export function createBladeCollector(seed: number): BladeCollector {
  const cache = new Map<number, BladeCell | null>();
  return {
    collect(camX: number, camZ: number): BladeTiers {
      const tiers = collectBladeCore(camX, camZ, (ci, cj) => {
        const key = (ci + KEY_HALF) * KEY_SPAN + (cj + KEY_HALF);
        let c = cache.get(key);
        if (c === undefined) {
          c = bladeCellAt(seed, ci, cj);
          cache.set(key, c);
        }
        return c;
      });
      if (cache.size > BLADE_SWEEP_SIZE) {
        const ox = bladeOrigin(camX), oz = bladeOrigin(camZ);
        for (const key of cache.keys()) {
          const cj = (key % KEY_SPAN) - KEY_HALF;
          const ci = Math.floor(key / KEY_SPAN) - KEY_HALF;
          const dx = Math.max(ci * BLADE_CELL - ox, 0, ox - (ci + 1) * BLADE_CELL);
          const dz = Math.max(cj * BLADE_CELL - oz, 0, oz - (cj + 1) * BLADE_CELL);
          if (dx * dx + dz * dz >= EVICT_RADIUS * EVICT_RADIUS) cache.delete(key);
        }
      }
      return tiers;
    },
    get size(): number {
      return cache.size;
    },
  };
}
```

If `clutterDensity`'s `sample` parameter expects the pre-feature sample rather than the composed one, read `clutterInCell` in `client/src/sim/clutter.ts` to see which sample it passes, and pass the same; if in doubt, call `clutterDensity(seed, CLUTTER_GRASS, x, z)` without the sample and let it sample itself (one extra terrain sample per cell, correct by construction) — say which in your report.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/bladeField.test.ts client/test/architecture.test.ts`
Expected: PASS. If the "full lattice" test is slow (it samples every cell of a 20 m disc twice), it must still finish under vitest's 5 s default; if it does not, cache the walk's cells in a `Map` inside the test rather than raising the timeout.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/bladeField.ts client/test/game/bladeField.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: walk a near-field blade lattice from the sim's grass gate

## What

The near field of blade grass gets a lattice of its own: 0.5 m cells around the eye out to
the meadow's 18 m seam, each cell gated by the sim's grass gate and carrying that gate as a
continuous strength, a hashed character, its terrain and its trail distance, sorted
nearest-first into three distance tiers with hand-off bands. Rebuilt every metre of travel,
padded so a clump is never absent for any eye in the rebuild cell.

## How

- `client/src/game/bladeField.ts` — the constants, `bladeCellAt` (the gate, the sample,
  the character), `bladeTierBands`, the shared walk, the pure `collectBladeCells` and the
  memoising `createBladeCollector`.
- `client/test/game/bladeField.test.ts` — the bands, the character weights, one cell's
  fields and determinism, the tier lists' membership and order, the full-lattice and no-pop
  properties, collector agreement.
- `client/test/architecture.test.ts` — the file is Babylon-free.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
EOF
```

(Replace `<model>` with the model writing the commit, here and in every task.)

---

### Task 2: clump characters and tiers

**Files:**
- Modify: `client/src/game/bladeClump.ts` (the whole constant block and `bladeClumpGeometry`; keep `draw`)
- Test: `client/test/game/bladeClump.test.ts` (rewrite)

**Interfaces:**
- Consumes: `BLADE_FINE`, `BLADE_TUSSOCK`, `BLADE_WEED`, `BLADE_FLOWER`, `BLADE_CHARACTER_COUNT`, `BLADE_REACH`, `BLADE_PAD`, `BLADE_TIER_EDGE`, `BLADE_TIER_BAND`, `BLADE_CELL` from `./bladeField.js` (Task 1).
- Produces: `export type BladeCharacter`, `export const BLADE_CHARACTERS: readonly BladeCharacter[]` (index = character id), `export type BladeQuality = "high" | "medium"`, `export const BLADE_TIER_COUNTS: Record<BladeQuality, readonly (readonly [number, number, number])[]>` (per character, per tier), `BLADE_RINGS = 3`, `BLADE_VERTS = 7`, `BLADE_TRIS = 5`, `BLADE_CLUMP_RADIUS = 0.35`, `BLADE_ALBEDO`, `BLADE_TIP_TINT`, `BLADE_LUMA`, `BLADE_SOFT`, `BLADE_VERTEX_BUDGET`, `FLOWER_PALETTE`, `bladeClumpGeometry(character: BladeCharacter, count: number): BladeClumpGeometry`, `bladeVertexCount(character, count): number`, `bladeSecondRandom(rootX, rootZ): number`, `bladeAlive(random, second, strength, grow, thin): number`. Tasks 3 and 4 consume these. `BLADE_COUNT`, `BLADE_HEIGHT`, `BLADE_WIDTH`, `BLADE_DROOP`, `BLADE_ROUND` are removed (they move into the characters).

- [ ] **Step 1: Write the failing tests**

Replace `client/test/game/bladeClump.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  BLADE_ALBEDO, BLADE_CHARACTERS, BLADE_CLUMP_RADIUS, BLADE_LUMA, BLADE_RINGS, BLADE_SOFT, BLADE_TIER_COUNTS,
  BLADE_TIP_TINT, BLADE_TRIS, BLADE_VERTEX_BUDGET, BLADE_VERTS, FLOWER_PALETTE,
  bladeAlive, bladeClumpGeometry, bladeSecondRandom, bladeVertexCount,
} from "../../src/game/bladeClump.js";
import {
  BLADE_CELL, BLADE_CHARACTER_COUNT, BLADE_FINE, BLADE_FLOWER, BLADE_PAD, BLADE_REACH, BLADE_TIER_BAND, BLADE_TIER_EDGE,
  BLADE_TUSSOCK, BLADE_WEED,
} from "../../src/game/bladeField.js";

describe("the character and tier tables", () => {
  it("match the spec", () => {
    expect(BLADE_CHARACTERS.length).toBe(BLADE_CHARACTER_COUNT);
    expect(BLADE_RINGS).toBe(3);
    expect(BLADE_VERTS).toBe(7);
    expect(BLADE_TRIS).toBe(5);
    expect(BLADE_CLUMP_RADIUS).toBe(0.35);
    expect(BLADE_ALBEDO).toEqual({ r: 0.3, g: 0.4, b: 0.12 });
    expect(BLADE_TIP_TINT).toEqual({ r: 0.95, g: 0.95, b: 0.75 });
    expect(BLADE_LUMA).toBe(0.3);
    expect(BLADE_SOFT).toBe(0.15);
    expect(BLADE_TIER_COUNTS.high).toEqual([[100, 40, 16], [80, 28, 12], [12, 8, 4], [100, 32, 12]]);
    expect(BLADE_TIER_COUNTS.medium).toEqual([[50, 20, 8], [40, 14, 6], [6, 4, 2], [50, 16, 6]]);
    expect(BLADE_CHARACTERS[BLADE_FINE]!.tip).toBe("none");
    expect(BLADE_CHARACTERS[BLADE_TUSSOCK]!.tip).toBe("seed");
    expect(BLADE_CHARACTERS[BLADE_WEED]!.width).toBe(0.03);
    expect(BLADE_CHARACTERS[BLADE_FLOWER]!.tip).toBe("flower");
    expect(BLADE_CHARACTERS[BLADE_FLOWER]!.heads).toEqual([1, 3]);
    expect(FLOWER_PALETTE.length).toBe(4);
  });

  it("keeps the high tier's field under the vertex budget", () => {
    const fine = BLADE_CHARACTERS[BLADE_FINE]!;
    const counts = BLADE_TIER_COUNTS.high[BLADE_FINE]!;
    const [e0, e1] = BLADE_TIER_EDGE;
    const cells = (rOut: number, rIn: number) => Math.PI * (rOut * rOut - rIn * rIn) / (BLADE_CELL * BLADE_CELL);
    const clumps = [
      cells(e0 + BLADE_PAD, 0),
      cells(e1 + BLADE_PAD, Math.max(0, e0 - BLADE_TIER_BAND - BLADE_PAD)),
      cells(BLADE_REACH + BLADE_PAD, Math.max(0, e1 - BLADE_TIER_BAND - BLADE_PAD)),
    ];
    let total = 0;
    for (let t = 0; t < 3; t++) total += clumps[t]! * bladeVertexCount(fine, counts[t]!);
    expect(total).toBeLessThan(BLADE_VERTEX_BUDGET);
    expect(total).toBeGreaterThan(BLADE_VERTEX_BUDGET * 0.5); // the budget is a real bound, not a formality
  });
});

describe("one clump per character and tier", () => {
  for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
    for (let t = 0; t < 3; t++) {
      const character = BLADE_CHARACTERS[ch]!;
      const count = BLADE_TIER_COUNTS.high[ch]![t]!;
      const g = bladeClumpGeometry(character, count);
      const vertexCount = g.positions.length / 3;

      it(`${character.name} tier ${t}: counts, roots, heights, normals, attribute, determinism`, () => {
        expect(vertexCount).toBe(bladeVertexCount(character, count));
        expect(g.normals.length).toBe(vertexCount * 3);
        expect(g.colors.length).toBe(vertexCount * 4);
        expect(g.blade.length).toBe(vertexCount * 4);
        for (const i of g.indices) expect(i).toBeLessThan(vertexCount);
        // Every blade's first two vertices sit at y = 0 inside the disc and
        // straddle their root; every vertex of a blade names the same root
        // and random; the height fraction rises to 1 at the tip.
        for (let b = 0; b < count; b++) {
          const v0 = b * BLADE_VERTS;
          for (const v of [v0, v0 + 1]) {
            expect(g.positions[v * 3 + 1]).toBe(0);
            const rx = g.blade[v * 4]!, rz = g.blade[v * 4 + 1]!;
            expect(Math.hypot(rx, rz)).toBeLessThanOrEqual(BLADE_CLUMP_RADIUS + 1e-9);
            expect(Math.hypot(g.positions[v * 3]! - rx, g.positions[v * 3 + 2]! - rz)).toBeCloseTo(character.width, 6);
          }
          for (let v = v0; v < v0 + BLADE_VERTS; v++) {
            expect(g.blade[v * 4]).toBe(g.blade[v0 * 4]);
            expect(g.blade[v * 4 + 1]).toBe(g.blade[v0 * 4 + 1]);
            expect(g.blade[v * 4 + 2]).toBe(g.blade[v0 * 4 + 2]);
          }
          const tip = v0 + BLADE_VERTS - 1;
          expect(g.blade[tip * 4 + 3]).toBe(1);
          const h = g.positions[tip * 3 + 1]!;
          expect(h).toBeGreaterThanOrEqual(character.height[0]);
          expect(h).toBeLessThanOrEqual(character.height[1]);
        }
        for (let v = 0; v < vertexCount; v++) {
          expect(Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!)).toBeCloseTo(1, 6);
          expect(g.colors[v * 4 + 3]).toBe(1);
        }
        const again = bladeClumpGeometry(character, count);
        expect(Array.from(again.positions)).toEqual(Array.from(g.positions));
      });

      it(`${character.name} tier ${t}: the tip feature`, () => {
        const bladeVerts = count * BLADE_VERTS;
        if (character.tip === "none") {
          expect(vertexCount).toBe(bladeVerts);
        } else if (character.tip === "seed") {
          // One 4-vertex diamond per blade, straw-tinted, above the blade's tip.
          expect(vertexCount).toBe(bladeVerts + count * 4);
          const v = bladeVerts; // the first seed head's first vertex
          expect(g.colors[v * 4]).toBeGreaterThan(g.colors[v * 4 + 2]!); // straw: red above blue
          expect(g.blade[v * 4 + 3]).toBe(1); // heads collapse with their blade, at full height fraction
        } else {
          // Heads: 1–3 per clump, each a stem strip (BLADE_VERTS vertices) plus a 5-quad rosette (20 vertices).
          const heads = (vertexCount - bladeVerts) / (BLADE_VERTS + 20);
          expect(Number.isInteger(heads)).toBe(true);
          expect(heads).toBeGreaterThanOrEqual(character.heads![0]);
          expect(heads).toBeLessThanOrEqual(character.heads![1]);
          const rosette = bladeVerts + BLADE_VERTS; // the first head's first petal vertex
          const c = [g.colors[rosette * 4]!, g.colors[rosette * 4 + 1]!, g.colors[rosette * 4 + 2]!];
          expect(FLOWER_PALETTE.some((p) => Math.abs(p.r - c[0]!) < 1e-6 && Math.abs(p.g - c[1]!) < 1e-6 && Math.abs(p.b - c[2]!) < 1e-6)).toBe(true);
          const y = g.positions[rosette * 3 + 1]!;
          expect(y).toBeGreaterThanOrEqual(0.3 - 0.04);
          expect(y).toBeLessThanOrEqual(0.45 + 0.04);
        }
      });
    }
  }

  it("tints by character and spreads the luma per blade", () => {
    const fine = bladeClumpGeometry(BLADE_CHARACTERS[BLADE_FINE]!, 40);
    const weed = bladeClumpGeometry(BLADE_CHARACTERS[BLADE_WEED]!, 12);
    // The weed's tint is bluer than the fine grass's at the root.
    expect(weed.colors[2]! / weed.colors[0]!).toBeGreaterThan(fine.colors[2]! / fine.colors[0]!);
    const lumas = new Set<number>();
    for (let b = 0; b < 40; b++) lumas.add(Math.round(fine.colors[b * BLADE_VERTS * 4]! * 1e6));
    expect(lumas.size).toBeGreaterThan(20);
  });
});

describe("bladeAlive, the mirror of the grow-in, the collapse and the strength cut", () => {
  it("is whole between the bands, absent before the grow-in and after the collapse", () => {
    for (const r of [0, 0.01, 0.5, 0.85, 0.999]) {
      expect(bladeAlive(r, 0.5, 1, 1, 0)).toBe(1);
      expect(bladeAlive(r, 0.5, 1, 0, 0)).toBe(0);
      expect(bladeAlive(r, 0.5, 1, 1, 1)).toBe(0);
    }
  });
  it("hands off complementary halves across a band: the inner keeps the high randoms, the outer the low", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      let inner = 0, outer = 0, both = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        const r = i / n;
        const a = bladeAlive(r, 0, 1, 1, t); // the inner tier: no grow-in, collapsing at t
        const b = bladeAlive(r, 0, 1, t, 0); // the outer tier: growing at t, no collapse
        inner += a; outer += b; if (a > 0 && b > 0) both++;
      }
      // Together they carry one clump's worth, within the soft window's width.
      expect((inner + outer) / n).toBeGreaterThan(1 - BLADE_SOFT);
      expect((inner + outer) / n).toBeLessThan(1 + BLADE_SOFT);
      expect(both / n).toBeLessThan(BLADE_SOFT + 0.01);
    }
  });
  it("cuts blades by the strength on the second random, not the hand-off random", () => {
    expect(bladeAlive(0.9, 0.2, 0.25, 1, 0)).toBe(1);
    expect(bladeAlive(0.9, 0.3, 0.25, 1, 0)).toBe(0);
    expect(bladeSecondRandom(0.1, 0.2)).toBeGreaterThanOrEqual(0);
    expect(bladeSecondRandom(0.1, 0.2)).toBeLessThan(1);
    expect(bladeSecondRandom(0.1, 0.2)).not.toBe(bladeSecondRandom(0.11, 0.2));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/bladeClump.test.ts`
Expected: FAIL — `BLADE_CHARACTERS`, `bladeVertexCount`, `FLOWER_PALETTE` are not exported.

- [ ] **Step 3: Implement**

Rewrite `client/src/game/bladeClump.ts`. Keep the file-head comment's voice; it now describes a table of characters. The full module:

```ts
import { clamp01, type Rgb } from "./colour.js";
import { latticeHash } from "./groundHexParams.js";
import { BLADE_CHARACTER_COUNT } from "./bladeField.js";

/**
 * The blade clumps: the meshes the blade field (bladeField.ts) draws, one per
 * character and distance tier, built here from a parameter table and a
 * lattice hash so they need no asset and every value can be retuned in one
 * place. Babylon-free: the shell (bladeMeshes.ts) wraps the arrays in
 * meshes, and the tests read them directly.
 *
 * A blade is a strip of BLADE_RINGS cross-sections plus one tip vertex, its
 * root on a disc of BLADE_CLUMP_RADIUS at y = 0 (the model convention: origin
 * at the base). It droops outward as a parabola, tapers to the tip, and
 * carries its face normal rolled to either side so it shades as a
 * half-cylinder. A character may add a tip feature: a seed head (one diamond
 * quad above the tip) or flower heads (a stem with a five-petal rosette).
 * One static vec4 per vertex, `blade`, names the root the blade collapses to,
 * the blade's random (its place in the hand-off order) and the vertex's
 * fraction of its own blade's height; a feature's vertices carry their
 * blade's root and random so they collapse with it.
 *
 * Renderer-only: nothing here may migrate into sim/ or a tunables registry.
 */

/** Cross-sections below the tip. */
export const BLADE_RINGS = 3;
export const BLADE_VERTS = BLADE_RINGS * 2 + 1;
export const BLADE_TRIS = (BLADE_RINGS - 1) * 2 + 1;
/** Roots lie on a disc of this radius (m); clumps on the 0.5 m lattice overlap a little. */
export const BLADE_CLUMP_RADIUS = 0.35;
/** The face normal is rolled this far (rad) about the blade's axis, one way per side. */
export const BLADE_ROUND = 0.3;
/** The material's base albedo, linear: a meadow green. */
export const BLADE_ALBEDO: Rgb = { r: 0.3, g: 0.4, b: 0.12 };
/** Vertex colour at the tip, from white at the root. */
export const BLADE_TIP_TINT: Rgb = { r: 0.95, g: 0.95, b: 0.75 };
/** Per-blade luminance spread: `1 + BLADE_LUMA · (random − 0.5)`. */
export const BLADE_LUMA = 0.3;
/** Width of one blade's shrink window in units of a hand-off ramp;
 * FOLIAGE_BLADE_SOFT in the GLSL. */
export const BLADE_SOFT = 0.15;
/** The high tier's whole field at full strength must stay under this many
 * vertices (a test computes it from the reach, the pad and the counts). */
export const BLADE_VERTEX_BUDGET = 1_000_000;

export type BladeTip = "none" | "seed" | "flower";

export type BladeCharacter = {
  name: string;
  /** Blade height (m) by the blade's random. */
  height: readonly [number, number];
  /** Half-width (m) at the root; the strip tapers linearly to the tip. */
  width: number;
  /** Outward lean (rad) applied as a parabola of the height fraction. */
  droop: readonly [number, number];
  /** Multiplies the vertex colour: the character's own cast. */
  tint: Rgb;
  tip: BladeTip;
  /** Flower-bearing only: how many heads a clump carries, by hash. */
  heads?: readonly [number, number];
};

/** Straw for seed heads. */
export const SEED_HEAD_TINT: Rgb = { r: 1.1, g: 1.0, b: 0.7 };
/** Flower-head colours, chosen by hash. */
export const FLOWER_PALETTE: readonly Rgb[] = [
  { r: 1.0, g: 1.0, b: 0.95 },
  { r: 1.0, g: 0.9, b: 0.3 },
  { r: 0.6, g: 0.45, b: 0.9 },
  { r: 0.9, g: 0.25, b: 0.2 },
];
/** Seed head: a diamond this long (m) along the blade's axis, half this wide. */
export const SEED_HEAD_SIZE = 0.03;
/** Flower head: the stem's half-width and the rosette's radius (m); the head sits this high (m). */
export const FLOWER_STEM_WIDTH = 0.003;
export const FLOWER_ROSETTE = 0.018;
export const FLOWER_HEIGHT: readonly [number, number] = [0.3, 0.45];

/** Indexed by the character ids of bladeField.ts (fine, tussock, weed, flower). */
export const BLADE_CHARACTERS: readonly BladeCharacter[] = [
  { name: "fine grass", height: [0.2, 0.45], width: 0.01, droop: [0.3, 0.9], tint: { r: 1, g: 1, b: 1 }, tip: "none" },
  { name: "tussock", height: [0.35, 0.5], width: 0.008, droop: [0.2, 0.6], tint: { r: 1.05, g: 1.0, b: 0.85 }, tip: "seed" },
  { name: "broad-leaf weed", height: [0.15, 0.25], width: 0.03, droop: [0.6, 1.1], tint: { r: 0.8, g: 0.9, b: 1.0 }, tip: "none" },
  { name: "flower-bearing", height: [0.2, 0.45], width: 0.01, droop: [0.3, 0.9], tint: { r: 1, g: 1, b: 1 }, tip: "flower", heads: [1, 3] },
];

export type BladeQuality = "high" | "medium";

/** Blades per clump, by quality tier, character and distance tier (fine, mid, coarse). */
export const BLADE_TIER_COUNTS: Record<BladeQuality, readonly (readonly [number, number, number])[]> = {
  high: [[100, 40, 16], [80, 28, 12], [12, 8, 4], [100, 32, 12]],
  medium: [[50, 20, 8], [40, 14, 6], [6, 4, 2], [50, 16, 6]],
};

export type BladeClumpGeometry = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  /** (rootX, rootZ, random, heightFraction) per vertex. */
  blade: Float32Array;
};

/** One of a blade's draws: the lattice hash on (blade index, salt). */
function draw(i: number, salt: number): number {
  return latticeHash(i, salt);
}

/** How many flower heads a flower-bearing clump carries: by the clump's own draw. */
function headCount(character: BladeCharacter): number {
  if (character.tip !== "flower" || character.heads === undefined) return 0;
  const [lo, hi] = character.heads;
  return lo + Math.floor(draw(7, 11) * (hi - lo + 1));
}

/** Vertices a clump of this character and blade count carries. */
export function bladeVertexCount(character: BladeCharacter, count: number): number {
  let n = count * BLADE_VERTS;
  if (character.tip === "seed") n += count * 4;
  if (character.tip === "flower") n += headCount(character) * (BLADE_VERTS + 20);
  return n;
}

export function bladeClumpGeometry(character: BladeCharacter, count: number): BladeClumpGeometry {
  const heads = headCount(character);
  const n = bladeVertexCount(character, count);
  const tris = count * BLADE_TRIS + (character.tip === "seed" ? count * 2 : 0) + heads * (2 * (BLADE_RINGS - 1) + 1 + 10);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  const blade = new Float32Array(n * 4);
  const indices = new Uint16Array(tris * 3);
  let ii = 0;
  let v = 0;

  // Writes one vertex: position, a unit normal, the colour (tint × luma ×
  // the root-to-tip gradient, or a feature's own colour) and the record.
  const put = (
    px: number, py: number, pz: number, nx: number, ny: number, nz: number,
    r: number, g: number, b: number, rootX: number, rootZ: number, random: number, h: number,
  ): number => {
    positions[v * 3] = px; positions[v * 3 + 1] = py; positions[v * 3 + 2] = pz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    normals[v * 3] = nx / nl; normals[v * 3 + 1] = ny / nl; normals[v * 3 + 2] = nz / nl;
    colors[v * 4] = r; colors[v * 4 + 1] = g; colors[v * 4 + 2] = b; colors[v * 4 + 3] = 1;
    blade[v * 4] = rootX; blade[v * 4 + 1] = rootZ; blade[v * 4 + 2] = random; blade[v * 4 + 3] = h;
    return v++;
  };
  const tri = (a: number, b: number, c: number): void => { indices[ii++] = a; indices[ii++] = b; indices[ii++] = c; };

  // One strip: `rings` cross-sections of half-width `hw(h)` plus a tip, drooping
  // outward along (outX, outZ) by a parabola of the height fraction. Returns
  // the index of its first vertex.
  const strip = (
    rootX: number, rootZ: number, height: number, droop: number, hw: number,
    outX: number, outZ: number, yaw: number, random: number, tintR: number, tintG: number, tintB: number,
  ): number => {
    const wX = Math.cos(yaw), wZ = Math.sin(yaw);
    const nX = -wZ, nZ = wX;
    const first = v;
    const ring = (h: number, side: number): void => {
      const cx = rootX + outX * height * droop * h * h;
      const cy = height * h;
      const cz = rootZ + outZ * height * droop * h * h;
      const w = hw * (1 - h);
      const c = Math.cos(BLADE_ROUND * side), s = Math.sin(BLADE_ROUND * side);
      put(
        cx + wX * w * side, cy, cz + wZ * w * side,
        c * nX + s * wX, 0, c * nZ + s * wZ,
        tintR * (1 + (BLADE_TIP_TINT.r - 1) * h), tintG * (1 + (BLADE_TIP_TINT.g - 1) * h), tintB * (1 + (BLADE_TIP_TINT.b - 1) * h),
        rootX, rootZ, random, h,
      );
    };
    for (let k = 0; k < BLADE_RINGS; k++) { ring(k / BLADE_RINGS, -1); ring(k / BLADE_RINGS, 1); }
    ring(1, 0);
    for (let k = 0; k + 1 < BLADE_RINGS; k++) {
      const a = first + 2 * k;
      tri(a, a + 2, a + 1);
      tri(a + 1, a + 2, a + 3);
    }
    const last = first + 2 * (BLADE_RINGS - 1);
    tri(last, first + BLADE_VERTS - 1, last + 1);
    return first;
  };

  // Every blade's strip first, so the blades' vertices are contiguous from 0
  // (the tests index them as b · BLADE_VERTS); the tip features follow.
  const seedHeads: { first: number; height: number; droop: number; outX: number; outZ: number; yaw: number; rootX: number; rootZ: number; random: number }[] = [];
  for (let b = 0; b < count; b++) {
    const random = draw(b, 1);
    const rho = BLADE_CLUMP_RADIUS * Math.sqrt(draw(b, 2));
    const phi = 2 * Math.PI * draw(b, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const height = character.height[0] + (character.height[1] - character.height[0]) * draw(b, 4);
    const droop = character.droop[0] + (character.droop[1] - character.droop[0]) * draw(b, 5);
    const yaw = 2 * Math.PI * draw(b, 6);
    const outX = rho > 1e-6 ? Math.cos(phi) : Math.cos(yaw);
    const outZ = rho > 1e-6 ? Math.sin(phi) : Math.sin(yaw);
    const luma = 1 + BLADE_LUMA * (random - 0.5);
    const first = strip(rootX, rootZ, height, droop, character.width, outX, outZ, yaw,
      random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma);
    if (character.tip === "seed") seedHeads.push({ first, height, droop, outX, outZ, yaw, rootX, rootZ, random });
  }
  for (const s of seedHeads) {
    // A diamond in the blade's own plane, from the tip up along the droop's tangent.
    const tip = s.first + BLADE_VERTS - 1;
    const tx = positions[tip * 3]!, ty = positions[tip * 3 + 1]!, tz = positions[tip * 3 + 2]!;
    const ax = s.outX * s.height * s.droop * 2, ay = s.height, az = s.outZ * s.height * s.droop * 2;
    const al = Math.hypot(ax, ay, az);
    const ux = ax / al, uy = ay / al, uz = az / al;
    const wX = Math.cos(s.yaw), wZ = Math.sin(s.yaw);
    const size = SEED_HEAD_SIZE;
    const n0x = -wZ, n0z = wX;
    const c = SEED_HEAD_TINT;
    const p0 = put(tx, ty, tz, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    const p1 = put(tx + ux * size * 0.5 + wX * size * 0.5, ty + uy * size * 0.5, tz + uz * size * 0.5 + wZ * size * 0.5, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    const p2 = put(tx + ux * size * 0.5 - wX * size * 0.5, ty + uy * size * 0.5, tz + uz * size * 0.5 - wZ * size * 0.5, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    const p3 = put(tx + ux * size, ty + uy * size, tz + uz * size, n0x, 0, n0z, c.r, c.g, c.b, s.rootX, s.rootZ, s.random, 1);
    tri(p0, p1, p2);
    tri(p1, p3, p2);
  }

  for (let f = 0; f < heads; f++) {
    // A head: a thin stem strip on its own root, then five petals around the
    // stem's tip, each a quad tilted outward, in one palette colour.
    const random = draw(100 + f, 1);
    const rho = BLADE_CLUMP_RADIUS * 0.8 * Math.sqrt(draw(100 + f, 2));
    const phi = 2 * Math.PI * draw(100 + f, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const height = FLOWER_HEIGHT[0] + (FLOWER_HEIGHT[1] - FLOWER_HEIGHT[0]) * draw(100 + f, 4);
    const yaw = 2 * Math.PI * draw(100 + f, 6);
    const stemTint = { r: 0.7, g: 0.9, b: 0.5 };
    const first = strip(rootX, rootZ, height, 0.15, FLOWER_STEM_WIDTH, Math.cos(phi), Math.sin(phi), yaw, random, stemTint.r, stemTint.g, stemTint.b);
    const tip = first + BLADE_VERTS - 1;
    const tx = positions[tip * 3]!, ty = positions[tip * 3 + 1]!, tz = positions[tip * 3 + 2]!;
    const colour = FLOWER_PALETTE[Math.floor(draw(100 + f, 9) * FLOWER_PALETTE.length) % FLOWER_PALETTE.length] as Rgb;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * 2 * Math.PI + yaw;
      const dx = Math.cos(a), dz = Math.sin(a);
      const r = FLOWER_ROSETTE;
      // A petal quad: from the head centre outward, tilted 30° down at the outer edge.
      const q0 = put(tx, ty, tz, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      const q1 = put(tx + dx * r * 0.5 - dz * r * 0.35, ty, tz + dz * r * 0.5 + dx * r * 0.35, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      const q2 = put(tx + dx * r, ty - r * 0.5, tz + dz * r, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      const q3 = put(tx + dx * r * 0.5 + dz * r * 0.35, ty, tz + dz * r * 0.5 - dx * r * 0.35, 0, 1, 0, colour.r, colour.g, colour.b, rootX, rootZ, random, 1);
      tri(q0, q1, q2);
      tri(q0, q2, q3);
    }
  }
  return { positions, normals, colors, indices, blade };
}

/** The second per-blade random the strength cut uses, derived from the root
 * so it is independent of the hand-off random. Mirrors bR2 in
 * foliageWorldPos.vertex.fx token for token; the roots stay under 0.35 m so
 * the products stay small enough for float32 to agree. */
export function bladeSecondRandom(rootX: number, rootZ: number): number {
  const v = rootX * 37.31 + rootZ * 91.17 + 0.37;
  return v - Math.floor(v);
}

/**
 * How much of a blade remains: `grow` (0 before the grow-in band, 1 past it)
 * admits blades from the low randoms up, `thin` (0 before the collapse band,
 * 1 past it) removes them from the low randoms up, each over a window
 * BLADE_SOFT wide, so an inner tier's survivors and an outer tier's arrivals
 * are complementary halves of one clump; `strength` cuts blades whose second
 * random exceeds it. Mirrors the collapse in foliageWorldPos.vertex.fx.
 */
export function bladeAlive(random: number, second: number, strength: number, grow: number, thin: number): number {
  const aliveIn = clamp01(((1 + BLADE_SOFT) * grow - random) / BLADE_SOFT);
  const aliveOut = clamp01((random - thin * (1 + BLADE_SOFT)) / BLADE_SOFT + 1);
  return aliveIn * aliveOut * (second < strength ? 1 : 0);
}
```

Note `BLADE_CHARACTER_COUNT` is imported only so a mismatch between the two files fails at the type level if someone adds a character in one place: add after the table `const _characterCount: typeof BLADE_CHARACTER_COUNT extends 4 ? true : never = true; void _characterCount;` only if the lint allows it; otherwise drop the import and rely on the test.

The blades' strips come first and every tip feature after them, so the first seed head's first vertex is at `count * BLADE_VERTS` and the first flower head's stem starts there too, which is what the tests index.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/bladeClump.test.ts client/test/game/bladeField.test.ts`
Expected: PASS. The old `clutterMeshes.test.ts` and `foliagePlugin.test.ts` cases that import the removed constants will fail until Tasks 3 and 5; do not run them here.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/bladeClump.ts client/test/game/bladeClump.test.ts
git commit -F - <<'EOF'
feat: give the blade clump four characters and three tiers

## What

The clump generator becomes a table: fine grass, tussocks with seed heads, broad-leaf weeds
and flower-bearing clumps with wildflower heads in four colours, each built for a fine, mid
or coarse distance tier with the high or medium tier's blade counts, on three rings a blade.
The hand-off mirror gains a grow-in and a strength cut, and a vertex budget is pinned.

## How

- `client/src/game/bladeClump.ts` — the character table and tier counts, `bladeClumpGeometry`
  over one strip generator with seed-head and flower-head tip features, `bladeVertexCount`,
  `bladeSecondRandom` and `bladeAlive`.
- `client/test/game/bladeClump.test.ts` — the tables, every character × tier's counts, roots,
  heights, normals and features, the tints, the vertex budget, and `bladeAlive` at the band
  edges, across a band, and against the strength.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
EOF
```

---

### Task 3: the grow-in, the strength and the four-edge band in the foliage plugin

**Files:**
- Modify: `client/src/game/foliagePlugin.ts` (uniforms, `bindForSubMesh`, `getAttributes`, a new setter)
- Modify: `client/src/game/shaders/foliage.vertex.fx` (the attribute block), `client/src/game/shaders/foliageWorldPos.vertex.fx` (the collapse block)
- Test: `client/test/game/foliagePlugin.test.ts`

**Interfaces:**
- Consumes: `BLADE_SOFT`, `bladeAlive`, `bladeSecondRandom` from `./bladeClump.js`; `type BladeEdges` from `./bladeField.js`.
- Produces: the uniform `foliageBladeEdges` (vec4), `export function setFoliageBladeEdges(material: Material, edges: BladeEdges): void`, the plugin field `bladeEdges: BladeEdges` (default `[-2, -1, 1e8, 2e8]`), the per-instance attribute `bladeStrength` (one float) pushed under the blades profile. Task 4 sets the edges per tier material and uploads `bladeStrength`.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/foliagePlugin.test.ts`:

1. Extend the imports: `setFoliageBladeEdges` from the plugin; `bladeAlive, bladeSecondRandom` from `../../src/game/bladeClump.js`.
2. In `"sets FOLIAGE_BLADES and pushes the blade attribute for the BLADES profile only"`, the attributes expectation becomes `expect(a).toEqual(["foliage", "blade", "bladeStrength"]);`.
3. Replace `"declares the blade attribute only under FOLIAGE_BLADES, and collapses after the wind"` with:

```ts
  it("declares the blade attributes only under FOLIAGE_BLADES, and collapses after the wind with a grow-in and a strength cut", () => {
    expect((vertexDefs.match(/attribute vec4 blade;/g) ?? []).length).toBe(1);
    expect((vertexDefs.match(/attribute float bladeStrength;/g) ?? []).length).toBe(1);
    const attr = vertexDefs.indexOf("attribute vec4 blade;");
    const before = vertexDefs.slice(0, attr);
    expect(before.lastIndexOf("#ifdef FOLIAGE_BLADES")).toBeGreaterThan(before.lastIndexOf("#ifdef FOLIAGE\n"));
    expect(before.slice(before.lastIndexOf("#ifdef FOLIAGE_BLADES"))).not.toContain("#endif");
    const strengthAttr = vertexDefs.indexOf("attribute float bladeStrength;");
    const beforeStrength = vertexDefs.slice(0, strengthAttr);
    expect(beforeStrength.lastIndexOf("#ifdef THIN_INSTANCES")).toBeGreaterThan(beforeStrength.lastIndexOf("#ifdef FOLIAGE_BLADES"));
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BLADE_SOFT = ${glslFloat(FOLIAGE_BLADE_SOFT)};`);
    expect(FOLIAGE_BLADE_SOFT).toBe(BLADE_SOFT);
    expect(vertexWorldPos).toContain("vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;");
    expect(vertexWorldPos).toContain("float bGrow = smoothstep(foliageBladeEdges.x, foliageBladeEdges.y, fDist);");
    expect(vertexWorldPos).toContain("float bThin = smoothstep(foliageBladeEdges.z, foliageBladeEdges.w, fDist);");
    expect(vertexWorldPos).toContain("float bIn = clamp(((1.0 + FOLIAGE_BLADE_SOFT) * bGrow - blade.z) / FOLIAGE_BLADE_SOFT, 0.0, 1.0);");
    expect(vertexWorldPos).toContain("float bOut = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);");
    expect(vertexWorldPos).toContain("float bR2 = fract(blade.x * 37.31 + blade.y * 91.17 + 0.37);");
    expect(vertexWorldPos).toContain("float bAlive = bIn * bOut * step(bR2, bStrength);");
    expect(vertexWorldPos).toContain("worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;");
    // A non-instanced draw has no strength attribute and draws every blade.
    expect(vertexWorldPos).toContain("float bStrength = 1.0;");
    expect(vertexWorldPos).toContain("bStrength = bladeStrength;");
    // After every displacement: the bend loop and the flutter precede it.
    expect(vertexWorldPos.indexOf("bAlive")).toBeGreaterThan(vertexWorldPos.indexOf("windPlayers[i]"));
    expect(vertexWorldPos.indexOf("bAlive")).toBeGreaterThan(vertexWorldPos.indexOf("fFlutter"));
    // The motion weight ignores the edge term under the gate, and the sink is skipped.
    expect(vertexWorldPos).toContain("fEdge = 1.0;");
    expect(vertexWorldPos.indexOf("#ifndef FOLIAGE_BLADES")).toBeLessThan(vertexWorldPos.indexOf("FOLIAGE_SINK * foliageHeight"));
    // The TypeScript mirror agrees with the GLSL's second random.
    const r2 = bladeSecondRandom(0.12, -0.2);
    expect(r2).toBeCloseTo((0.12 * 37.31 + -0.2 * 91.17 + 0.37) - Math.floor(0.12 * 37.31 + -0.2 * 91.17 + 0.37), 12);
    expect(bladeAlive(0.5, 0.1, 1, 1, 0)).toBe(1);
  });
```

4. In `"declares the record uniforms, the five-player array and the per-material profile"`, add `"foliageBladeEdges"` to the `arrayContaining` list and `expect(u.vertex).toContain("uniform vec4 foliageBladeEdges;");`.
5. Add:

```ts
  it("binds the blade edges a shell sets, four numbers, and a no-op pair by default", () => {
    const mat = new PBRMaterial("m5", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.BLADES, 0.5);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(plugin.bladeEdges).toEqual([-2, -1, 1e8, 2e8]);
    setFoliageBladeEdges(mat, [2.5, 4, 6.5, 8]);
    expect(plugin.bladeEdges).toEqual([2.5, 4, 6.5, 8]);
    const writes: Record<string, number[]> = {};
    const ub = {
      updateFloat: (n: string, v: number) => { writes[n] = [v]; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloat4: (n: string, a: number, b: number, c: number, d: number) => { writes[n] = [a, b, c, d]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ub as never, scene, undefined as never, undefined as never);
    expect(writes.foliageBladeEdges).toEqual([2.5, 4, 6.5, 8]);
  });
```

(The existing bind test, around line 190, builds a similar fake `UniformBuffer`; if it lacks `updateFloat4`, add it there too, since the plugin will now call it for every material.)

6. In the both-paths compile test, add `"foliageBladeEdges"` to the names expected in `blades.vertex`, and give the BLADES box a strength buffer beside the `blade` one: `mesh.setVerticesData("bladeStrength", new Float32Array(mesh.getTotalVertices()), false, 1);` (harmless on a non-instanced box; the shader takes its non-instanced default).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/foliagePlugin.test.ts`
Expected: FAIL — `setFoliageBladeEdges` not exported; the attribute list lacks `bladeStrength`; the GLSL lacks `bGrow`.

- [ ] **Step 3: Implement**

`client/src/game/foliagePlugin.ts`:

1. Import `type BladeEdges` from `./bladeField.js`.
2. On the class, beside `edges`: 

```ts
  /** The blades profile's hand-off: (grow-in start, grow-in end, collapse
   * start, collapse end) in metres from the eye. The default grows nowhere
   * and collapses nowhere: every blade whole. */
  bladeEdges: BladeEdges = [FADE_NONE_IN[0], FADE_NONE_IN[1], FADE_NONE_OUT[0], FADE_NONE_OUT[1]];
```

(import `FADE_NONE_IN` beside `FADE_NONE_OUT` from `./distanceFadePlugin.js`).
3. `getAttributes`: after the `blade` push, `if (this._profile.blades) attributes.push("bladeStrength");`.
4. `getUniforms`: add `{ name: "foliageBladeEdges", size: 4, type: "vec4" }` to the `ubo` list and `uniform vec4 foliageBladeEdges;` to the vertex string inside `#ifdef FOLIAGE`.
5. `bindForSubMesh`: `uniformBuffer.updateFloat4("foliageBladeEdges", this.bladeEdges[0], this.bladeEdges[1], this.bladeEdges[2], this.bladeEdges[3]);`.
6. Add after `setFoliageEdges`:

```ts
/** The blade tier's hand-off band: four edges like `fadeBands`. Materials
 * without the plugin are ignored. */
export function setFoliageBladeEdges(material: Material, edges: BladeEdges): void {
  const plugin = material.pluginManager?.getPlugin("Foliage") as FoliagePlugin | undefined;
  if (plugin) plugin.bladeEdges = edges;
}
```

`client/src/game/shaders/foliage.vertex.fx`: the blades attribute block becomes

```
#ifdef FOLIAGE_BLADES
attribute vec4 blade;
#ifdef THIN_INSTANCES
attribute float bladeStrength;
#endif
#endif
```

`client/src/game/shaders/foliageWorldPos.vertex.fx`: replace the `FOLIAGE_BLADES` collapse block at the end with

```
#ifdef FOLIAGE_BLADES
  vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;
  float bStrength = 1.0;
#ifdef THIN_INSTANCES
  bStrength = bladeStrength;
#endif
  float bGrow = smoothstep(foliageBladeEdges.x, foliageBladeEdges.y, fDist);
  float bThin = smoothstep(foliageBladeEdges.z, foliageBladeEdges.w, fDist);
  float bIn = clamp(((1.0 + FOLIAGE_BLADE_SOFT) * bGrow - blade.z) / FOLIAGE_BLADE_SOFT, 0.0, 1.0);
  float bOut = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);
  float bR2 = fract(blade.x * 37.31 + blade.y * 91.17 + 0.37);
  float bAlive = bIn * bOut * step(bR2, bStrength);
  worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;
#endif
```

Update the file-head comment's order line: "…then for the blade clumps the collapse: a grow-in from the tier inside, the collapse toward the tier outside, and the strength cut, each blade pulled toward its root by its share, last so a collapsed blade's vertices coincide exactly". Keep the COMMENT RULES.

`client/src/game/clutterMeshes.ts` still calls `setFoliageEdges` for the old blade bucket; that stays until Task 5. Nothing else changes here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/foliagePlugin.test.ts client/test/game/shaderHygiene.test.ts client/test/game/foliageLightPlugin.test.ts client/test/game/forestMeshes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/foliagePlugin.ts client/src/game/shaders/foliage.vertex.fx client/src/game/shaders/foliageWorldPos.vertex.fx client/test/game/foliagePlugin.test.ts
git commit -F - <<'EOF'
feat: grow blades in from the tier inside and cut them by the cell's strength

## What

A blade tier now hands off on both sides: across its grow-in band its blades appear from
the low randoms up while the tier inside collapses its blades from the low randoms up, so
the two carry one clump's worth of grass at every distance; and a per-instance strength
hides the blades whose second random exceeds it, so a cell draws as much grass as its
ground allows. The band is four edges per material, like the fade's.

## How

- `client/src/game/foliagePlugin.ts` — `bladeEdges` and `setFoliageBladeEdges`, the
  `foliageBladeEdges` vec4 on both uniform paths, the `bladeStrength` attribute under the
  blades profile.
- `client/src/game/shaders/foliage.vertex.fx` — the attribute, thin instances only.
- `client/src/game/shaders/foliageWorldPos.vertex.fx` — the grow-in, the collapse, the
  second random and the strength cut, as the block's last displacement.
- `client/test/game/foliagePlugin.test.ts` — the attributes' gating, the collapse text, the
  binding, both shader paths.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
EOF
```

---

### Task 4: the blade meshes shell

**Files:**
- Create: `client/src/game/bladeMeshes.ts`
- Modify: `client/src/game/clutterMeshes.ts` (export `prepBucketMesh` and `writeFoliage`; nothing else yet)
- Test: `client/test/game/bladeMeshes.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `createBladeCollector`, `BladeTiers`, `BladeCell`, `bladeTierBands`, `BLADE_CHARACTER_COUNT`, `BLADE_REBUILD_CELL`; Task 2's `BLADE_CHARACTERS`, `BLADE_TIER_COUNTS`, `BladeQuality`, `bladeClumpGeometry`, `BLADE_ALBEDO`; Task 3's `setFoliageBladeEdges`; from `clutterMeshes.ts`: `instanceMatrixFor(inst, frame, out)`, `trampleFrame(seed, inst)`, and the newly exported `prepBucketMesh(mesh)` and `writeFoliage(seed, inst, buf, offset, frame)`; `attachFoliage`, `attachFoliageLight`, `FOLIAGE_PROFILES`.
- Produces: `export const BLADE_MESH_PREFIX = "blade_clumps"`, `export function bladeMeshName(character: number, tier: number): string` (`blade_clumps_c<character>_t<tier>`), `export type BladeMeshesOptions = { quality: BladeQuality }`, `export type BladeMeshes = { update(camX, camZ): void; readonly meshes: readonly Mesh[]; dispose(): void }`, `export function createBladeMeshes(scene: Scene, seed: number, options: BladeMeshesOptions): BladeMeshes`, `export const BLADE_STRENGTH_HEIGHT: readonly [number, number] = [0.5, 1]`, `export const BLADE_CANOPY_HEIGHT = 0.6`. Task 5 wires it into `renderer.ts`.

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/bladeMeshes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import "../../src/sim/passes/index.js";
import { BLADE_ALBEDO, BLADE_CHARACTERS, BLADE_TIER_COUNTS, bladeClumpGeometry } from "../../src/game/bladeClump.js";
import { BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, bladeTierBands, createBladeCollector } from "../../src/game/bladeField.js";
import {
  BLADE_CANOPY_HEIGHT, BLADE_STRENGTH_HEIGHT, bladeMeshName, createBladeMeshes,
} from "../../src/game/bladeMeshes.js";
import { instanceMatrixFor, trampleFrame } from "../../src/game/clutterMeshes.js";
import { FoliagePlugin } from "../../src/game/foliagePlugin.js";

// The open-field census point: every tier and every character is present.
const SEED = 1;
const CAM = { x: 35, z: 21335 };

function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
  for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
    const call = spy.mock.calls[k]!;
    if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
  }
  return null;
}

describe("createBladeMeshes", () => {
  it("builds one mesh per character and tier on three tier materials, opaque, shadowed, plugged", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    expect(blades.meshes.length).toBe(BLADE_CHARACTER_COUNT * 3);
    const materials = new Set<PBRMaterial>();
    const bands = bladeTierBands();
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      for (let t = 0; t < 3; t++) {
        const mesh = scene.getMeshByName(bladeMeshName(ch, t)) as Mesh;
        expect(mesh).toBeInstanceOf(Mesh);
        const g = bladeClumpGeometry(BLADE_CHARACTERS[ch]!, BLADE_TIER_COUNTS.high[ch]![t]!);
        expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
        expect(mesh.getVerticesData("blade")).not.toBeNull();
        expect(mesh.receiveShadows).toBe(true);
        expect(mesh.isPickable).toBe(false);
        expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
        const mat = mesh.material as PBRMaterial;
        materials.add(mat);
        expect(mat.needAlphaTesting()).toBe(false);
        expect(mat.needAlphaBlending()).toBe(false);
        expect(mat.backFaceCulling).toBe(false);
        expect([mat.albedoColor.r, mat.albedoColor.g, mat.albedoColor.b]).toEqual([BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b]);
        const foliage = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
        expect(foliage).toBeInstanceOf(FoliagePlugin);
        expect(foliage.bladeEdges).toEqual(bands[t]);
        expect(mat.pluginManager!.getPlugin("FoliageLight")).not.toBeNull();
        expect(mat.pluginManager!.getPlugin("DistanceFade") ?? null).toBeNull();
      }
    }
    // One material per tier, shared by its four characters.
    expect(materials.size).toBe(3);
    blades.dispose();
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) for (let t = 0; t < 3; t++) expect(scene.getMeshByName(bladeMeshName(ch, t))).toBeNull();
    for (const mat of materials) expect(scene.getMaterialByName(mat.name)).toBeNull();
    engine.dispose();
  });

  it("fills each bucket with its tier's cells of its character, nearest first, with the cards' matrix and tint and the strength", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    let checked = 0;
    for (let t = 0; t < 3; t++) {
      for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
        const cells = lists[t]!.filter((c) => c.character === ch);
        const mesh = scene.getMeshByName(bladeMeshName(ch, t)) as Mesh;
        expect(mesh.thinInstanceCount).toBe(cells.length);
        if (cells.length === 0) continue;
        const matrices = bufferFor(spy, mesh, "matrix")!;
        const tints = bufferFor(spy, mesh, "foliage")!;
        const strengths = bufferFor(spy, mesh, "bladeStrength")!;
        expect(bufferFor(spy, mesh, "fadeBands")).toBeNull();
        const buf = new Float32Array(16);
        for (let i = 0; i < Math.min(cells.length, 20); i++) {
          const c = cells[i]!;
          expect(strengths[i]).toBe(Math.fround(c.strength));
          // The matrix is the cards' own, with the strength's and the canopy's height folded in.
          const frame = trampleFrame(SEED, c);
          const heightScale = (BLADE_STRENGTH_HEIGHT[0] + (BLADE_STRENGTH_HEIGHT[1] - BLADE_STRENGTH_HEIGHT[0]) * c.strength) * (1 + (BLADE_CANOPY_HEIGHT - 1) * c.canopy);
          instanceMatrixFor(c, { height: frame.height * heightScale, lean: frame.lean, ax: frame.ax, az: frame.az, tint: frame.tint }, buf);
          for (let k = 0; k < 16; k++) expect(matrices[i * 16 + k]).toBeCloseTo(buf[k]!, 5);
          expect(tints[i * 4 + 3]).toBeCloseTo(1 - 0.5 * c.canopy, 5);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    spy.mockRestore();
    blades.dispose();
    engine.dispose();
  });

  it("rebuilds on a 1 m crossing and not inside one", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "medium" });
    const spy = vi.spyOn(Mesh.prototype, "thinInstanceBufferUpdated");
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    blades.update(CAM.x, CAM.z);
    const afterFirst = set.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    blades.update(CAM.x + 0.4, CAM.z + 0.4);
    expect(set.mock.calls.length + spy.mock.calls.length).toBe(afterFirst);
    blades.update(CAM.x + BLADE_REBUILD_CELL, CAM.z);
    expect(set.mock.calls.length + spy.mock.calls.length).toBeGreaterThan(afterFirst);
    spy.mockRestore();
    set.mockRestore();
    blades.dispose();
    engine.dispose();
  });

  it("uses the medium counts on medium", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "medium" });
    const mesh = scene.getMeshByName(bladeMeshName(0, 0)) as Mesh;
    const g = bladeClumpGeometry(BLADE_CHARACTERS[0]!, BLADE_TIER_COUNTS.medium[0]![0]!);
    expect(mesh.getTotalVertices()).toBe(g.positions.length / 3);
    blades.dispose();
    engine.dispose();
  });

  it("collapses a blade to one world point through the cell's matrix", () => {
    const g = bladeClumpGeometry(BLADE_CHARACTERS[0]!, 16);
    const cell = { cls: 6, x: 3, z: -7, groundH: 12, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0.37 };
    const buf = new Float32Array(16);
    instanceMatrixFor(cell, { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } }, buf);
    const m = Matrix.FromArray(buf);
    const root = Vector3.TransformCoordinates(new Vector3(g.blade[0]!, 0, g.blade[1]!), m);
    for (let v = 0; v < 7; v++) {
      const world = Vector3.TransformCoordinates(new Vector3(g.positions[v * 3]!, g.positions[v * 3 + 1]!, g.positions[v * 3 + 2]!), m);
      const collapsed = root.add(world.subtract(root).scale(0));
      expect(collapsed.subtract(root).length()).toBeLessThan(1e-6);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/bladeMeshes.test.ts`
Expected: FAIL — cannot resolve `../../src/game/bladeMeshes.js`.

- [ ] **Step 3: Implement**

In `client/src/game/clutterMeshes.ts`, make `prepBucketMesh` and `writeFoliage` `export`ed (no other change; their doc comments stay).

Create `client/src/game/bladeMeshes.ts`:

```ts
/**
 * The Babylon shell over `bladeField.ts`: one thin-instance bucket per clump
 * character and distance tier, on one opaque material per tier, filled from
 * the field's tier lists with the cards' own matrix, trample and tint writers
 * (clutterMeshes.ts) plus a per-instance strength. Rebuilt on the field's own
 * 1 m crossing; no per-frame allocation on the hot path, the clutter shell's
 * discipline. Nothing here dithers: every hand-off is geometric, so no bucket
 * carries the distance fade or `fadeBands`.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import type { Rgb } from "./colour.js";
import {
  BLADE_CHARACTER_COUNT, BLADE_REBUILD_CELL, bladeTierBands, createBladeCollector, type BladeCell, type BladeEdges, type BladeTiers,
} from "./bladeField.js";
import { BLADE_ALBEDO, BLADE_CHARACTERS, BLADE_TIER_COUNTS, bladeClumpGeometry, type BladeQuality } from "./bladeClump.js";
import { attachFoliage, FOLIAGE_PROFILES, setFoliageBladeEdges } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import { instanceMatrixFor, prepBucketMesh, trampleFrame, writeFoliage } from "./clutterMeshes.js";

export const BLADE_MESH_PREFIX = "blade_clumps";
export function bladeMeshName(character: number, tier: number): string {
  return `${BLADE_MESH_PREFIX}_c${character}_t${tier}`;
}
/** A cell's height scale at strength 0 and 1. */
export const BLADE_STRENGTH_HEIGHT: readonly [number, number] = [0.5, 1];
/** A cell's height scale under full canopy: forest-floor grass is short as well as thin. */
export const BLADE_CANOPY_HEIGHT = 0.6;
/** The material's roughness. */
const BLADE_ROUGHNESS = 0.8;

export type BladeMeshesOptions = { quality: BladeQuality };

export type BladeMeshes = {
  update(camX: number, camZ: number): void;
  readonly meshes: readonly Mesh[];
  dispose(): void;
};

type Bucket = {
  mesh: Mesh;
  buf: Float32Array;
  foliage: Float32Array;
  strength: Float32Array;
  count: number;
  grown: boolean;
};

const BUCKET_MIN_INSTANCES = 64;
const EMPTY_BUFFER = new Float32Array(0);
const scratchMat = new Float32Array(16);
const scratchFrame: { height: number; lean: number; ax: number; az: number; tint: Rgb } = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };

function ensureCapacity(bucket: Bucket): void {
  const needed = bucket.count * 16;
  if (bucket.buf.length >= needed) {
    bucket.grown = false;
    return;
  }
  let capacity = Math.max(bucket.buf.length, BUCKET_MIN_INSTANCES * 16);
  while (capacity < needed) capacity *= 2;
  bucket.buf = new Float32Array(capacity);
  bucket.foliage = new Float32Array(capacity / 4);
  bucket.strength = new Float32Array(capacity / 16);
  bucket.grown = true;
}

function applyBucket(bucket: Bucket): void {
  const { mesh, count } = bucket;
  if (bucket.grown) {
    mesh.thinInstanceSetBuffer("matrix", bucket.buf, 16, false);
    mesh.thinInstanceSetBuffer("foliage", bucket.foliage, 4, false);
    mesh.thinInstanceSetBuffer("bladeStrength", bucket.strength, 1, false);
    mesh.thinInstanceCount = count;
  } else {
    mesh.thinInstanceCount = count;
    if (count > 0) {
      mesh.thinInstanceBufferUpdated("matrix");
      mesh.thinInstanceBufferUpdated("foliage");
      mesh.thinInstanceBufferUpdated("bladeStrength");
    }
  }
  mesh.setEnabled(count > 0);
}

/** One tier's material: opaque, two-sided, the meadow green, with the
 * blades profile, the sun-only translucency, its tier's hand-off band, and
 * never the distance fade. */
function createTierMaterial(scene: Scene, tier: number, meshHeight: number): PBRMaterial {
  const mat = new PBRMaterial(`${BLADE_MESH_PREFIX}_t${tier}_mat`, scene);
  mat.albedoColor = new Color3(BLADE_ALBEDO.r, BLADE_ALBEDO.g, BLADE_ALBEDO.b);
  mat.metallic = 0;
  mat.roughness = BLADE_ROUGHNESS;
  mat.backFaceCulling = false;
  attachFoliage(mat, FOLIAGE_PROFILES.BLADES, meshHeight);
  attachFoliageLight(mat);
  setFoliageBladeEdges(mat, bladeTierBands()[tier] as BladeEdges);
  return mat;
}

/** The clump mesh for one character and tier: the pure geometry through
 * `VertexData`, the `blade` record as a custom vertex buffer (set after
 * `applyToMesh`, which rebuilds the mesh's buffers). */
function createClumpMesh(scene: Scene, character: number, tier: number, count: number): Mesh {
  const g = bladeClumpGeometry(BLADE_CHARACTERS[character]!, count);
  const mesh = new Mesh(bladeMeshName(character, tier), scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.setVerticesData("blade", g.blade, false, 4);
  mesh.refreshBoundingInfo();
  prepBucketMesh(mesh);
  // The one clutter that receives shadows: opaque, near the eye and inside
  // the first cascade, a clump under the canopy must sit in the turf's shadow.
  mesh.receiveShadows = true;
  return mesh;
}

export function createBladeMeshes(scene: Scene, seed: number, options: BladeMeshesOptions): BladeMeshes {
  const counts = BLADE_TIER_COUNTS[options.quality];
  const collector = createBladeCollector(seed);
  /** `buckets[tier][character]`. */
  const buckets: Bucket[][] = [];
  const materials: PBRMaterial[] = [];
  const meshes: Mesh[] = [];
  for (let tier = 0; tier < 3; tier++) {
    const row: Bucket[] = [];
    let tallest = 0;
    for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
      const mesh = createClumpMesh(scene, ch, tier, counts[ch]![tier]!);
      tallest = Math.max(tallest, mesh.getBoundingInfo().boundingBox.maximum.y);
      row.push({ mesh, buf: EMPTY_BUFFER, foliage: EMPTY_BUFFER, strength: EMPTY_BUFFER, count: 0, grown: false });
      meshes.push(mesh);
    }
    const mat = createTierMaterial(scene, tier, tallest);
    for (const bucket of row) bucket.mesh.material = mat;
    materials.push(mat);
    buckets.push(row);
  }
  let disposed = false;
  let builtX = NaN;
  let builtZ = NaN;

  function fill(list: BladeCell[], row: Bucket[]): void {
    for (const bucket of row) bucket.count = 0;
    for (const c of list) row[c.character]!.count++;
    for (const bucket of row) {
      ensureCapacity(bucket);
      bucket.count = 0;
    }
    for (const c of list) {
      const bucket = row[c.character]!;
      const frame = trampleFrame(seed, c);
      const heightScale =
        (BLADE_STRENGTH_HEIGHT[0] + (BLADE_STRENGTH_HEIGHT[1] - BLADE_STRENGTH_HEIGHT[0]) * c.strength) *
        (1 + (BLADE_CANOPY_HEIGHT - 1) * c.canopy);
      scratchFrame.height = frame.height * heightScale;
      scratchFrame.lean = frame.lean;
      scratchFrame.ax = frame.ax;
      scratchFrame.az = frame.az;
      scratchFrame.tint = frame.tint;
      instanceMatrixFor(c, scratchFrame, scratchMat);
      bucket.buf.set(scratchMat, bucket.count * 16);
      writeFoliage(seed, c, bucket.foliage, bucket.count * 4, frame);
      bucket.strength[bucket.count] = c.strength;
      bucket.count++;
    }
    for (const bucket of row) applyBucket(bucket);
  }

  function rebuild(x: number, z: number): void {
    const tiers: BladeTiers = collector.collect(x, z);
    fill(tiers.fine, buckets[0]!);
    fill(tiers.mid, buckets[1]!);
    fill(tiers.coarse, buckets[2]!);
  }

  return {
    update(x, z) {
      if (disposed) return;
      const ox = Math.floor(x / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
      const oz = Math.floor(z / BLADE_REBUILD_CELL) * BLADE_REBUILD_CELL;
      if (ox === builtX && oz === builtZ) return;
      builtX = ox;
      builtZ = oz;
      rebuild(x, z);
    },
    meshes,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
      meshes.length = 0;
    },
  };
}
```

One note for the implementer: `trampleFrame` returns a shared scratch object, so `scratchFrame.tint = frame.tint` aliases it only until the next call, which is after `writeFoliage` — the order above is what makes that safe; keep it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/bladeMeshes.test.ts client/test/game/clutterMeshes.test.ts`
Expected: `bladeMeshes.test.ts` PASS. `clutterMeshes.test.ts` still passes except cases that import the removed `BLADE_*` constants from `bladeClump.ts` — those are Task 5's; if the file fails to compile because of them, note it and run only `bladeMeshes.test.ts` plus `npm run typecheck` restricted to your new file (`npx tsc -p client --noEmit` will report the stale test imports; those are expected until Task 5).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/bladeMeshes.ts client/src/game/clutterMeshes.ts client/test/game/bladeMeshes.test.ts
git commit -F - <<'EOF'
feat: draw the blade field as twelve buckets on three tier materials

## What

The blade field's cells are drawn: one thin-instance bucket per clump character and
distance tier, on one opaque, shadow-receiving material per tier carrying that tier's
hand-off band, filled nearest-first with the cards' own matrix (the trample lean and height,
now also scaled by the cell's strength and canopy), the cards' ground tint and the cell's
strength, rebuilt on the field's 1 m crossing.

## How

- `client/src/game/bladeMeshes.ts` — the tier materials, the clump meshes, the buckets and
  their buffers, the fill, the rebuild cadence, dispose.
- `client/src/game/clutterMeshes.ts` — `prepBucketMesh` and `writeFoliage` exported for the
  new shell.
- `client/test/game/bladeMeshes.test.ts` — meshes and materials, the fill against the field
  and the writers, the cadence, the medium counts, the collapse through a cell's matrix.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
EOF
```

---

### Task 5: retire the old blade bucket and wire the field in

**Files:**
- Modify: `client/src/game/clutterMeshes.ts` (remove `BLADE_MESH_NAME`, `BLADE_BUCKET`, `createBladeMesh`, the `blades` option, `bladeReach`, the blade count/fill, the blade bucket install, the blade dispose; add `nearBlades`), `client/src/game/clutterField.ts` (remove `BLADE_RADIUS`, `BLADE_BAND`, `BLADE_PAD`, `bladeEdges`, the `blades` list and `bladeReach`), `client/src/game/renderer.ts:783-787` and the two `update` sites and the dispose
- Test: `client/test/game/clutterMeshes.test.ts`, `client/test/game/clutterField.test.ts`

**Interfaces:**
- Consumes: `createBladeMeshes` (Task 4), `bladeTierBands` (Task 1).
- Produces: `ClutterMeshesOptions.nearBlades?: boolean` (true on the tiers that draw the blade field: the meadow's near card bucket is left unfilled and the grass class's near cards dither in over the meadow seam); `ClutterBands` back to `{ near, far }`; `collect(camX, camZ, radiusScale)`.

- [ ] **Step 1: Write the failing tests**

`client/test/game/clutterMeshes.test.ts`: delete the whole `describe("the blade bucket", …)` and the imports it alone used (`BLADE_MESH_NAME`, `createBladeMesh`, `bladeEdges`, `BLADE_PAD`, `BLADE_RADIUS`, `bladeAlive`, `bladeClumpGeometry`, `BLADE_VERTS`, `TUFT_ALBEDO`, `CLUTTER_MEADOW` if unused elsewhere). Add:

```ts
describe("the cards beside the blade field", () => {
  function build(nearBlades: boolean): { scene: Scene; assets: Mesh[][][][]; clutter: ReturnType<typeof createClutterMeshes>; engine: NullEngine } {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const assets: Mesh[][][][] = [];
    for (let cls = 0; cls < CLUTTER_CLASS_COUNT; cls++) {
      assets.push([0, 1].map((variant) => {
        const material = new PBRMaterial(`near-c${cls}v${variant}`, scene);
        material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        return [0, 1].map((lod) => {
          const mesh = CreateBox(`near-c${cls}v${variant}l${lod}`, { size: 0.5 }, scene);
          mesh.material = material;
          return [mesh];
        });
      }));
    }
    const clutter = createClutterMeshes(scene, 1, { assets, nearBlades });
    return { scene, assets, clutter, engine };
  }
  function bufferFor(spy: { mock: { calls: unknown[][]; instances: unknown[] } }, mesh: Mesh, kind: string): Float32Array | null {
    for (let k = spy.mock.calls.length - 1; k >= 0; k--) {
      const call = spy.mock.calls[k]!;
      if (spy.mock.instances[k] === mesh && call[0] === kind) return call[1] as Float32Array;
    }
    return null;
  }

  it("leaves the meadow's near cards unfilled and dithers the grass near cards in over the seam when the blade field draws", () => {
    // An open-field point where the meadow carpet is dense.
    for (const nearBlades of [true, false]) {
      const { assets, clutter, engine } = build(nearBlades);
      const spy = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
      clutter.update(35, 21335);
      const meadowNear = assets[CLUTTER_MEADOW]![0]![0]![0]!;
      const meadowFar = assets[CLUTTER_MEADOW]![0]![1]![0]!;
      const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
      expect(meadowFar.thinInstanceCount).toBeGreaterThan(0);
      if (nearBlades) {
        expect(meadowNear.thinInstanceCount).toBe(0);
        expect(meadowNear.isEnabled()).toBe(false);
      } else {
        expect(meadowNear.thinInstanceCount).toBeGreaterThan(0);
      }
      expect(grassNear.thinInstanceCount).toBeGreaterThan(0);
      const seam = clutterSeamEdges(CLUTTER_MEADOW);
      const grassSeam = clutterSeamEdges(CLUTTER_GRASS);
      const want = (nearBlades ? [seam.start, seam.end, grassSeam.start, grassSeam.end] : [-2, -1, grassSeam.start, grassSeam.end]).map(Math.fround);
      expect(Array.from(bufferFor(spy, grassNear, "fadeBands")!.subarray(0, 4))).toEqual(want);
      spy.mockRestore();
      clutter.dispose();
      engine.dispose();
    }
  });

  it("has no blade bucket of its own any more", () => {
    const { scene, clutter, engine } = build(true);
    clutter.update(35, 21335);
    expect(scene.meshes.some((m) => m.name.includes("clutter_blades"))).toBe(false);
    clutter.dispose();
    engine.dispose();
  });
});
```

`client/test/game/clutterField.test.ts`: delete the `describe("the blade list", …)` and its imports (`BLADE_BAND`, `BLADE_PAD`, `BLADE_RADIUS`, `bladeEdges`, `CLUTTER_MEADOW_CELL` if unused elsewhere). Add to `describe("clutter bands", …)`:

```ts
  it("carries only the near and far lists per class", () => {
    const bands = collectClutter(SEED, CAM.x, CAM.z);
    for (const band of bands) expect(Object.keys(band).sort()).toEqual(["far", "near"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/clutterMeshes.test.ts client/test/game/clutterField.test.ts`
Expected: FAIL — `nearBlades` is not an option (the meadow near bucket still fills); `blades` is still a key.

- [ ] **Step 3: Implement**

`client/src/game/clutterField.ts`:
- Remove `BLADE_RADIUS`, `BLADE_BAND`, `BLADE_PAD`, `bladeEdges` and their comments; remove `CLUTTER_MEADOW_CELL` from the sim import if now unused.
- `ClutterBands` back to `{ near: ClutterInstance[]; far: ClutterInstance[] }[]` with its earlier doc comment.
- `collectClutterCore`: drop the `bladeReach` parameter, `bladeReach2`, the `blades` array, its push in the walk, its reset and rebuild in the clamp, its sort, and push `{ near, far }` only.
- `collectClutter`, `collectClutterWithBudgets`, `ClutterCollector.collect` and `createClutterCollector`: drop the `bladeReach` parameter and argument; restore the doc comments to their pre-blade text.

`client/src/game/clutterMeshes.ts`:
- Imports: drop `bladeEdges, BLADE_PAD, BLADE_RADIUS` from `./clutterField.js`, `bladeClumpGeometry`, `VertexData`, `PBRMaterial`, `Color3`, `TUFT_ALBEDO`, `FADE_ALWAYS`, `Material`, `setFoliageBladeEdges`/`setFoliageEdges` if now unused (keep `setFoliageEdges`: the cards still use it), `FOLIAGE_PROFILES` stays (the cards' profiles).
- Remove `BLADE_MESH_NAME`, `BLADE_BUCKET`, `createBladeMesh`, the `blades` option, `bladeReach`, `bladeMesh`, the blade count/fill blocks in `rebuild`, the blade bucket install in `adopt`, the blade dispose; `collector.collect(x, z, radiusScale)`.
- Add to `ClutterMeshesOptions`:

```ts
  /** The blade field (bladeMeshes.ts) draws the grass inside the meadow's
   * near/far seam on this tier, so the meadow's near cards are never filled
   * and the grass class's near cards dither in across that seam. Off on the
   * low tier, which keeps the cards alone. */
  nearBlades?: boolean;
```

- In `adopt`, the near-bucket fade for the grass class:

```ts
          const meadowSeam = clutterSeamEdges(CLUTTER_MEADOW, radiusScale);
          const fade: FadeBands = lod === NEAR_LOD
            ? fadeBands(nearBlades && cls === CLUTTER_GRASS ? [meadowSeam.start, meadowSeam.end] : null, [seam.start, seam.end])
            : fadeBands([seam.start, seam.end], [edge.start, edge.end]);
```

with a comment: the grass class's near cards are the one card set still drawn inside the blade field's reach, and they dither in where the field's coarse tier collapses, the meadow's own seam.
- In `rebuild`, skip the meadow's near list when `nearBlades`: in both the count and the fill passes, `const nearList = nearBlades && cls === CLUTTER_MEADOW ? [] : band.near;` and iterate `nearList` (the bucket's `count` stays 0 and `applyBucket` disables it). Comment: with the blade field on, every meadow near instance lies inside the field's reach, so its card would be pure fill behind the blades.
- Update the file-head comment: remove the "plus one opaque blade-clump draw" clause.

`client/src/game/renderer.ts`:
- Import `createBladeMeshes` from `./bladeMeshes.js`.
- The clutter call: `createClutterMeshes(scene, forest.seed, { radiusScale: tier === "low" ? 0.6 : undefined, nearBlades: tier !== "low" })`, its comment amended: "High and medium draw the blade field inside the meadow's seam; low keeps the cards, whose 1.5× scaling is where blades resolve worst."
- After it: 

```ts
  // The near field of blade grass, on the tiers that can afford it; it
  // rebuilds on its own 1 m crossing and takes the meadow's near cards' place.
  const bladeMeshes = forest !== null && tier !== "low" ? createBladeMeshes(scene, forest.seed, { quality: tier }) : null;
```

(`tier` is `"high" | "medium"` in that branch; if TypeScript cannot narrow it, write `{ quality: tier === "high" ? "high" : "medium" }`.)
- Beside each `clutterMeshes?.update(…)` call (the freecam and the player branches): `bladeMeshes?.update(freecam.x, freecam.z);` and `bladeMeshes?.update(local.pos.x, local.pos.z);`.
- Beside `clutterMeshes?.dispose();`: `bladeMeshes?.dispose();`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run client/test/game/clutterMeshes.test.ts client/test/game/clutterField.test.ts client/test/game/bladeMeshes.test.ts client/test/game/bladeField.test.ts client/test/game/bladeClump.test.ts client/test/game/foliagePlugin.test.ts && npm run typecheck && npm run lint`
Expected: PASS, typecheck and lint clean (the stale imports are gone).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/clutterMeshes.ts client/src/game/clutterField.ts client/src/game/renderer.ts client/test/game/clutterMeshes.test.ts client/test/game/clutterField.test.ts
git commit -F - <<'EOF'
feat: hand the near field to the blade field and retire the meadow's blade bucket

## What

The renderer draws the blade field on the high and medium tiers and the clutter shell
steps back: the meadow's near cards, all inside the field's reach, are no longer filled,
the grass class's near cards dither in where the field's coarse tier hands off, and the
meadow-lattice blade bucket with its reach, band and list is gone. The low tier is unchanged.

## How

- `client/src/game/renderer.ts` — creates, updates and disposes the blade meshes beside the
  clutter, and passes `nearBlades` to the clutter shell.
- `client/src/game/clutterMeshes.ts` — the `nearBlades` option, the unfilled meadow near
  bucket, the grass near cards' in-band at the meadow seam; the blade bucket removed.
- `client/src/game/clutterField.ts` — the blade list, reach, band and constants removed;
  the bands are near and far again.
- `client/test/game/clutterMeshes.test.ts`, `client/test/game/clutterField.test.ts` — the
  unfilled bucket and the in-band on and off; the bands' shape; the old blade cases removed.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
EOF
```

---

### Task 6: the architecture note and the verification record

**Files:**
- Modify: `ARCHITECTURE.md:25` (the rendering paragraph's blade sentence)
- Create: `docs/rendering/2026-09-22-blade-field-verification.md`

**Interfaces:** none. The browser gates of the spec's §10 are the controller's; this task records their outcome once reported and must not claim a result it has not been given.

- [ ] **Step 1: ARCHITECTURE.md**

Replace the sentence beginning "Inside 12 m on the high and medium tiers the meadow's instances are drawn as opaque blade clumps…" with:

> Inside the meadow carpet's 18 m seam, on the high and medium tiers, the ground cover is a blade field (`bladeField.ts`, `bladeClump.ts`, `bladeMeshes.ts`): a 0.5 m lattice gated by the sim's grass gate, each cell drawing as much grass as its ground allows, in three distance tiers of four clump characters with seed heads and wildflowers, every hand-off geometric (an inner tier's blades collapse to their roots while the outer tier's grow); the first pass of the post chain is multisampled (`MSAA_SAMPLES`) on those tiers.

Run: `npx vitest run tools/docs/test/docNames.test.mjs` — Expected: PASS.

- [ ] **Step 2: The verification doc**

Create `docs/rendering/2026-09-22-blade-field-verification.md` from this skeleton and fill every "—" from the gate report you are given (a "—" left in the file fails the task):

```markdown
# The blade field: verification

**Spec:** [2026-09-22-blade-field-design](2026-09-22-blade-field-design.md). **Plan:** [2026-09-22-blade-field-plan](2026-09-22-blade-field-plan.md).

## Tests

`npm test` on an idle machine: — files, — tests, all green. New: `bladeField.test.ts` (—), `bladeMeshes.test.ts` (—), the rewritten `bladeClump.test.ts` (—), and the field cases in `foliagePlugin.test.ts`, `clutterMeshes.test.ts` and `clutterField.test.ts`.

## Browser gates

The branch merged after — against a control at — (the branch base), same seed, weather and hour on both.

| Gate | Result |
| --- | --- |
| Stills at MEADOW, EDGE, TRAIL, DEEP and TRAILSIDE, noon, 16 h, mist and rain | — |
| The hand-offs: three stills across each band | — |
| Frame pairs, high tier, native and 3×, both orders, p95 | — |
| Frame pairs, medium tier, MEADOW and TRAILSIDE | — |
| Low tier, one native pair | — |
| Console errors, both builds, both paths | — |

## Retunes

— (each constant changed from the spec's value, its old and new value, and why).
```

- [ ] **Step 3: Run the doc-name test and commit**

Run: `npx vitest run tools/docs/test/docNames.test.mjs`
Expected: PASS.

```bash
git add ARCHITECTURE.md docs/rendering/2026-09-22-blade-field-verification.md
git commit -F - <<'EOF'
docs: record the blade field in the architecture and its verification

## What

The architecture overview describes the blade field in place of the meadow's blade bucket,
and the verification doc records the test counts, the browser gates against a control
build, the frame pairs and every retune the gates asked for.

## How

- `ARCHITECTURE.md` — the rendering paragraph's blade sentence.
- `docs/rendering/2026-09-22-blade-field-verification.md` — the record.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
EOF
```

---

## Self-review

- **Spec coverage.** §4 the field → Task 1 (lattice, cadence, pad, cell record, continuous strength, characters by hash, tiers and bands). §5 the clump meshes → Task 2 (characters, tier counts, tip features, colours, the vertex budget) and Task 4 (the material). §6 the hand-offs → Task 3 (the four-edge collapse with grow-in and strength) and Task 5 (the meadow near cards unfilled, the grass near cards' in-band at the seam). §7 shading, wind, trample, shadows → Task 4 (profile, translucency, trample through `instanceMatrixFor`, height by strength and canopy, `receiveShadows`). §8 tiers → Task 4 (counts by quality) and Task 5 (renderer wiring, low untouched). §9 tests → each task; `architecture.test.ts` in Task 1. §10 gates and §11 fallbacks are the controller's, recorded by Task 6. §12 follow-ups: none implemented.
- **Placeholders.** The verification skeleton's "—" marks are explicit fill-ins the task forbids leaving; `<model>` in commit messages is the commit author's model, stated once.
- **Type consistency.** `BladeCell` (Task 1) is `ClutterInstance & {…}` so Task 4 passes it to `instanceMatrixFor`, `trampleFrame` and `writeFoliage` unchanged. `bladeTierBands(): [BladeEdges, BladeEdges, BladeEdges]` (Task 1) feeds `setFoliageBladeEdges(material, BladeEdges)` (Task 3) in Task 4 and the test's `foliage.bladeEdges` comparison. `BLADE_CHARACTERS[character]` and `BLADE_TIER_COUNTS[quality][character][tier]` (Task 2) are what Task 4's `createClumpMesh` reads. `bladeAlive(random, second, strength, grow, thin)` (Task 2) mirrors the GLSL's `bIn · bOut · step(bR2, bStrength)` (Task 3), with `bladeSecondRandom` mirroring `bR2`. `nearBlades` (Task 5) is the shell option the renderer sets; `quality` (Task 4) is the blade shell's. The spec's §4 sentence "every band is at least `BLADE_PAD` wide" is superseded: the bands are 1.5 m as its table says and the pad guarantees presence on its own; Task 6's record notes it.
