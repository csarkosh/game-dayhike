# Water Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trail's pond a photoreal lake (murk by altitude, a real basin, a marsh end, reeds, lilies and a skin of duckweed and algae on murky lakes) and turn the shore in front of the trailhead into a pebble pocket beach between two headlands, in one level-id release.

**Architecture:** The bowl's build is left bit-identical: the lake's bed and its marsh are a new stage (`lakeStageD`) applied to the composed field only, after the bowl is built, and the lake's murk and the marsh's direction are decided in a post-pass at the end of `buildTrail` that reads what the build placed and moves none of it. The marsh lies on the lake's own shelf, inside the rim, where the trail never comes. The cove is a stage of the coast (`coveD`) applied seaward of the road's corridor only. The terrain variant gains `waterBodies(seed)` (the sea and the lakes) and `coveMask`, which the renderer, the clutter field, the ground paint and the sim's wading read.

**Tech Stack:** TypeScript, Babylon.js 9.18 (PBR material plugins, GLSL injected into the PBR shader, WGSL translated ahead from the recorded corpus), Vitest with `NullEngine`.

**Spec:** [`docs/rendering/2026-09-30-water-terrain-design.md`](2026-09-30-water-terrain-design.md), with its amendments of 2026-09-30 (the backshore as measured; the wall at the shelf; the marsh on the lake's own shelf, where the shore is nearest the level). The water material it draws with is [`2026-09-29-water-material-design.md`](2026-09-29-water-material-design.md).

## Global Constraints

- Sim determinism, in everything under `client/src/sim/`: no trigonometric functions, no `Math.pow`, no `**`, no `Math.hypot`. `Math.sqrt` is allowed. Tables of directions are written out as literals.
- Every new sim number is a named constant folded into the level id through the tunables the file already exports into it: `FEATURE_TUNABLES` (`features.ts`), the olympic variant's `tunables` (`olympic.ts`), `CLUTTER_TUNABLES` (`clutter.ts`).
- Every terrain stage is C² with exact analytic derivatives, and passes `checkDerivatives` (`client/test/sim/helpers/derivatives.ts`, `TOL_RATIO` 0.01).
- The bowl's build does not change: every feature's position, radius, rim height and crest, the trail graph, the landmarks, and the field inside the road corridor and at the pad are bit-identical to `origin/main`. Task 1 records that as a fixture; every later task keeps it green.
- Numbers from the spec, verbatim: murk `1 − smoothstep(0.25, 0.75, f)`; lake rows Kd (0.2, 0.12, 0.2) at murk 0, (0.75, 0.8, 1.6) at 0.5, (1.1, 1.5, 3.5) at 1, shelter 0.3 → 0.1; shelf 0.9 m deep at 10 m in from the rim; slope 8 m; middle 3 m (murk 1) to 6 m (murk 0); marsh on murk > 0.5, on the shelf at one end (from the rim to 10 m in), 0.6 to 1.0 × R across by murk, ground within ±5 cm of the level; reeds 1.2 to 2 m tall in water 0 to 0.6 m deep and on the wet band; lilies in 0.5 to 2 m, a third of patches flowering; the cove 260 to 360 m wide centred on `TRAIL_Z_ANCHOR`, berm crest 3 m, face 1:12 to 2 m deep, bed 1:50 to the 8 m shelf break; headlands 12 to 25 m high reaching 100 to 150 m past the waterline, one or two stacks off each tip; the road wall stays.
- GLSL injected into Babylon's shaders: never spell a hashed preprocessor keyword in comment prose, and never put a semicolon inside a trailing comment (`shaderHygiene` enforces both).
- `waterShading.ts`, `terrainSurface.ts` and the new `waterGround.ts` stay Babylon-free (the architecture test).
- Nothing written may say how an asset was made or where the reference photos came from; gates name reference ids only.
- Commits: a Conventional Commits subject under 72 characters, a body with `## What` and `## How`, ending with the two trailer lines `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8`. Stage explicit paths; never `git add -A`; never `--no-verify`.
- Run a client test file from the worktree root with `npx vitest run --root client test/<path>` (the client's own Vitest config, as `npm run test:client` uses). The full client suite (`npm run test:client`) is heavy: run only the files a task names unless the task says otherwise, and never while another suite or a browser gate runs.

## Review Focus

1. **A world with no pond.** About half the worlds have none. `waterBodies` then holds only the sea, and the renderer, the clutter field, the ground paint and the wading must behave exactly as today. Pinned in Task 4 (`waterBodies` of a pondless seed is the sea alone), Task 7 (`createWater` with no lakes makes no lake mesh), Task 10 (`waterGroundAt` far from any lake is `NO_WATER_GROUND`).
2. **A murk exactly at an edge, and a world with no crest.** `murkFor` with no peak crest, or a crest not above the pad, falls back to 0.5, and a lake at murk 0.5 gets no marsh, no plants and no skin. Pinned in Task 2 (`murkFor` fallbacks) and Task 5 (`chooseLobe` at murk 0.5 and 0.49).
3. **A player put inside the wall.** A teleport or a respawn can place a hull where the water is deeper than the shelf; the next tick must put it at the wall, not leave it on the bed. Pinned in Task 4 (a player placed at the lake's centre is at the wall after one tick).
4. **Wading through the marsh.** The marsh lies on the shelf, outside the wall, so a player can walk into it at its ±5 cm ground; its inner edge falls to the lake's bed at the wall and never beyond, so no one walks off it into deep water. Pinned in Task 5 (every point of every marsh over the 200 worlds lies between the wall and the rim).
5. **A short beach.** On a world whose waterline lies nearer the road than the 60 measured, the backshore can vanish and the berm's crest falls inside the corridor's fade; the field must stay the cove's monotone, walkable profile seaward of the corridor and identical inside it. Pinned in Task 1 (the corridor's field against the fixture) and Task 6 (the 200-world scan finds the ground equal to the cove's profile from the toe to the corridor's edge on every world, whatever its backshore).

## Files

| File | Change | Responsibility |
| --- | --- | --- |
| `client/test/sim/waterTerrainSweep.test.ts` | create | The 200-world scan: the bowl and the corridor as before; later the marsh, the cove |
| `client/test/sim/fixtures/waterBaseline.json` | create (recorded) | The baseline from `origin/main` |
| `client/src/sim/features.ts` | modify | `murkFor`, `Lobe`, the lake's bed (`lakeDepthD`, `lakeD`), the marsh (`chooseLobe`, `marshD`, `marshWeightAt`, `lobePoints`), `lakeStageD` |
| `client/src/sim/trailBuild.ts` | modify | The post-pass: each pond's murk and marsh |
| `client/src/sim/terrain.ts` | modify | `LakeSource`, `WaterBodySource`, the `waterBodies` and `coveMask` hooks |
| `client/src/sim/olympic.ts` | modify | `lakeStageD` in the composed field, `waterBodies`, the cove (`coveFor`, `coveProfileD`, `coveD`, `coveMask`) |
| `client/src/sim/containment.ts`, `client/src/sim/world.ts` | modify | The wall at the shelf; wading by a lake's level |
| `client/src/sim/clutter.ts` | modify | `CLUTTER_REED`, `CLUTTER_LILY`; driftwood on the cove's backshore |
| `client/src/game/waterShading.ts` | modify | `lakeWaterRow`, `lakeSkin` |
| `client/src/game/renderer.ts` | modify | Lakes from `waterBodies`: a material per lake, `lakeSurface`, the wet line, the skin, the plants |
| `client/src/game/bedHeight.ts` | modify | A comment follows `pondDisc` → `lakeSurface` |
| `client/src/game/waterPlants.ts` | create | Reed, cattail and lily meshes, built in code, placed from the sim's classes |
| `client/src/game/foliagePlugin.ts` | modify | The `REEDS` profile |
| `client/src/game/waterPlugin.ts`, `client/src/game/shaders/water*.fx` | modify | The skin layer |
| `client/src/game/waterGround.ts` | create | What the ground paint needs from the water at a point |
| `client/src/game/terrainSurface.ts`, `client/src/game/clipmap.ts` | modify | The lake bed, the marsh and the cove in the ground paint |

---

### Task 1: The baseline, recorded before anything changes

**Files:**
- Create: `client/test/sim/waterTerrainSweep.test.ts`
- Create: `client/test/sim/fixtures/waterBaseline.json` (recorded by the test)

**Interfaces:**
- Consumes: `bowlFor(seed)` (`olympic.ts`), the olympic variant's `sample` and `roadCenterX`, `LOBBY_SEEDS` (`client/test/sim/trailGateSeeds.ts`), `timeLimit` (`client/test/helpers/timeLimit.ts`).
- Produces: the file `waterTerrainSweep.test.ts` with a lazily built `worlds()` list and a `describe` block later tasks add `it`s to; the helper `lakeOf(seed)` later tasks use.

This task changes no product code. It must run on the worktree exactly as branched from `origin/main` (plus the two spec commits): the fixture it writes is what "unchanged" means for every later task.

- [ ] **Step 1: Write the scan**

```ts
// client/test/sim/waterTerrainSweep.test.ts
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bowlFor } from "../../src/sim/olympic.js";
import { variantOrThrow } from "./helpers/derivatives.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * The water terrain's 200-world scan. The bowl's build must not move: every
 * feature, the trail graph and the field in the road's corridor and at the pad
 * are compared with a fixture recorded on `origin/main` before any of the water
 * terrain's code existed (`RECORD_WATER_BASELINE=1` writes it; nothing else
 * may). Later tasks add the lobe's and the cove's invariants here, so every
 * world is built once per run.
 */
const FIXTURE = fileURLToPath(new URL("./fixtures/waterBaseline.json", import.meta.url));

type FeatureRecord = {
  id: number; kind: string; x: number; z: number; radius: number; height: number; crestH: number | null;
};
type WorldRecord = { seed: number; features: FeatureRecord[]; loops: number; graph: string; field: string };

/** FNV-1a over the numbers' float64 bytes: a hash that changes when any bit does. */
function fnv(values: readonly number[]): string {
  const bytes = new Uint8Array(new Float64Array(values).buffer);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function recordWorld(seed: number): WorldRecord {
  const v = variantOrThrow("olympic");
  const centre = v.roadCenterX as (seed: number, z: number) => number;
  const b = bowlFor(seed);
  const graph: number[] = [];
  for (const n of b.graph.nodes) graph.push(n.x, n.z, n.h);
  for (const e of b.graph.edges) graph.push(e.a, e.b);
  const field: number[] = [];
  // The corridor, both sides of the centreline, along the cove's whole span.
  for (let z = -150; z <= 150; z += 50) {
    for (const u of [-29, -20, -10, 0, 10, 20, 29]) {
      const s = v.sample(seed, centre(seed, z) + u, z);
      field.push(s.h, s.dx, s.dz);
    }
  }
  // The pad and the ground just inland of it.
  for (const z of [-12, 0, 12]) {
    for (const u of [8, 9, 14, 20]) {
      const s = v.sample(seed, centre(seed, z) + u, z);
      field.push(s.h, s.dx, s.dz);
    }
  }
  return {
    seed,
    // `+ 0` turns a −0 into 0, which JSON cannot tell apart anyway.
    features: b.features.map((f) => ({
      id: f.id, kind: f.kind, x: f.x + 0, z: f.z + 0, radius: f.radius + 0, height: f.height + 0,
      crestH: f.crestH === undefined ? null : f.crestH + 0,
    })),
    loops: b.graph.loops.length,
    graph: fnv(graph),
    field: fnv(field),
  };
}

let built: WorldRecord[] | null = null;
function worlds(): WorldRecord[] {
  if (built === null) built = LOBBY_SEEDS.map(recordWorld);
  return built;
}

describe("the water terrain over 200 worlds", { timeout: timeLimit(900_000) }, () => {
  it("builds every world's features, trail and road as origin/main did", () => {
    const now = worlds();
    if (process.env.RECORD_WATER_BASELINE === "1") {
      writeFileSync(FIXTURE, "[\n" + now.map((w) => JSON.stringify(w)).join(",\n") + "\n]\n");
      return;
    }
    expect(existsSync(FIXTURE), "record the baseline on origin/main's code first").toBe(true);
    const before = JSON.parse(readFileSync(FIXTURE, "utf8")) as WorldRecord[];
    expect(now.length).toBe(before.length);
    for (let i = 0; i < now.length; i++) expect(now[i], `seed ${before[i]!.seed}`).toEqual(before[i]);
  });
});
```

- [ ] **Step 2: Run it without a fixture and see it fail**

Run: `npx vitest run --root client test/sim/waterTerrainSweep.test.ts`
Expected: FAIL with "record the baseline on origin/main's code first".

- [ ] **Step 3: Record the fixture**

```bash
mkdir -p client/test/sim/fixtures
RECORD_WATER_BASELINE=1 npx vitest run --root client test/sim/waterTerrainSweep.test.ts
```

Expected: PASS, and `client/test/sim/fixtures/waterBaseline.json` exists with 200 lines of worlds. Check that about half hold a pond: `grep -c '"kind":"pond"' client/test/sim/fixtures/waterBaseline.json` prints between 80 and 130.

- [ ] **Step 4: Run it against the fixture**

Run: `npx vitest run --root client test/sim/waterTerrainSweep.test.ts`
Expected: PASS (about two minutes: 200 bowls are built).

- [ ] **Step 5: Commit**

```bash
git add client/test/sim/waterTerrainSweep.test.ts client/test/sim/fixtures/waterBaseline.json
git commit -F - <<'EOF'
test: record the bowl and the road over 200 worlds before the lakes

## What

A scan over the 200 lobby worlds, and a fixture recorded on origin/main's
code, that every later piece of the water terrain must keep: each feature's
place, size and heights, the trail graph, and the field in the road's
corridor and at the pad.

## How

- `client/test/sim/waterTerrainSweep.test.ts` — builds each world once and
  compares it with the fixture; `RECORD_WATER_BASELINE=1` writes the fixture.
- `client/test/sim/fixtures/waterBaseline.json` — the recording.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 2: Murk, and the lake's water from it

**Files:**
- Modify: `client/src/sim/features.ts` (the `Feature` type at lines 13–26, the pond section near line 157, `FEATURE_TUNABLES` at line 281)
- Modify: `client/src/game/waterShading.ts` (after `WATER_ROWS`)
- Test: `client/test/sim/features.test.ts`, `client/test/game/waterShading.test.ts`

**Interfaces:**
- Produces (sim): `export type Lobe = { dirX: number; dirZ: number; width: number }`; `Feature` gains `murk?: number` and `lobe?: Lobe | null`; `MURK_LO = 0.25`, `MURK_HI = 0.75`; `murkFor(h: number, padH: number, crestH: number | undefined): number`.
- Produces (game): `CLEAR_LAKE_KD: [number, number, number]`; `lakeWaterRow(murk: number): WaterRow`; `lakeSkin(murk: number): number`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/features.test.ts` (add `murkFor, MURK_LO, MURK_HI` to its import from `../../src/sim/features.js`):

```ts
describe("murkFor", () => {
  it("is fully murky in the lowest quarter of the climb and fully clear in the highest", () => {
    expect(murkFor(10, 10, 210)).toBe(1);
    expect(murkFor(10 + 200 * MURK_LO, 10, 210)).toBe(1);
    expect(murkFor(10 + 200 * MURK_HI, 10, 210)).toBe(0);
    expect(murkFor(210, 10, 210)).toBe(0);
    expect(murkFor(110, 10, 210)).toBeCloseTo(0.5, 12);
  });

  it("stays in [0, 1] off the ends of the climb", () => {
    expect(murkFor(-50, 10, 210)).toBe(1);
    expect(murkFor(400, 10, 210)).toBe(0);
  });

  it("falls back to 0.5 with no crest, or a crest not above the pad", () => {
    expect(murkFor(50, 10, undefined)).toBe(0.5);
    expect(murkFor(50, 10, 10)).toBe(0.5);
    expect(murkFor(50, 10, 5)).toBe(0.5);
  });

  it("folds its two edges into the level id", () => {
    expect(FEATURE_TUNABLES.MURK_LO).toBe(0.25);
    expect(FEATURE_TUNABLES.MURK_HI).toBe(0.75);
  });
});
```

Append to `client/test/game/waterShading.test.ts` (add `lakeWaterRow, lakeSkin, CLEAR_LAKE_KD, WATER_ROWS` to its import from `../../src/game/waterShading.js`):

```ts
describe("lakeWaterRow", () => {
  it("is the very clear lake's row at murk 0 and the humic lake's at murk 1", () => {
    expect(lakeWaterRow(0)).toEqual(WATER_ROWS.highLake);
    expect(lakeWaterRow(1)).toEqual(WATER_ROWS.lowlandLake);
  });

  it("is the research's clear lake at murk 0.5", () => {
    const row = lakeWaterRow(0.5);
    expect(CLEAR_LAKE_KD).toEqual([0.75, 0.8, 1.6]);
    for (let c = 0; c < 3; c++) expect(row.kd[c]).toBeCloseTo(CLEAR_LAKE_KD[c]!, 12);
    expect(row.shelter).toBeCloseTo(0.2, 12);
    for (let c = 0; c < 3; c++) {
      expect(row.lInf[c]).toBeCloseTo((WATER_ROWS.highLake.lInf[c]! + WATER_ROWS.lowlandLake.lInf[c]!) / 2, 12);
    }
  });

  it("clamps murk outside [0, 1]", () => {
    expect(lakeWaterRow(-1)).toEqual(WATER_ROWS.highLake);
    expect(lakeWaterRow(2)).toEqual(WATER_ROWS.lowlandLake);
  });
});

describe("lakeSkin", () => {
  it("is off up to murk 0.5, full from 0.8", () => {
    expect(lakeSkin(0)).toBe(0);
    expect(lakeSkin(0.5)).toBe(0);
    expect(lakeSkin(0.8)).toBe(1);
    expect(lakeSkin(1)).toBe(1);
    expect(lakeSkin(0.65)).toBeCloseTo(0.5, 12);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/sim/features.test.ts test/game/waterShading.test.ts`
Expected: FAIL: `murkFor`, `lakeWaterRow`, `lakeSkin` are not exported.

- [ ] **Step 3: Implement**

In `client/src/sim/features.ts`, extend the `Feature` type (after `crestH?: number;`):

```ts
  /** pond only: 0 clear .. 1 murky, by where the lake lies on the climb
   * (`murkFor`). Written by the builder after the whole bowl is placed. */
  murk?: number;
  /** pond only: the marsh on a murky lake's shelf at one end, or null for
   * none. Written by the builder after the whole bowl is placed. */
  lobe?: Lobe | null;
```

and add, after the `Feature` type:

```ts
/** A murky lake's marsh: its shelf at one end, silted up to the water's
 * level, in the direction (dirX, dirZ) from the lake's centre (a unit
 * vector), `width` metres across. */
export type Lobe = { dirX: number; dirZ: number; width: number };
```

After the pond constants (after `POND_SLOPE_MAX`):

```ts
// ---- Lake ----------------------------------------------------------------
/** Murk by where the lake lies on the climb from the pad to the crest: the
 * lowest quarter fully murky, the highest fully clear, a gradient between. */
export const MURK_LO = 0.25;
export const MURK_HI = 0.75;

/** A lake's murk from its rim height `h`, the pad's height and the crest's.
 * With no crest, or one not above the pad, the middle of the range. */
export function murkFor(h: number, padH: number, crestH: number | undefined): number {
  if (crestH === undefined || !(crestH > padH)) return 0.5;
  return 1 - smoothstep(MURK_LO, MURK_HI, (h - padH) / (crestH - padH));
}
```

(`smoothstep` is the file's own function declaration further down; it is hoisted.) Add `MURK_LO, MURK_HI,` to `FEATURE_TUNABLES` on the line after `POND_TREE_MARGIN, POND_SLOPE_MAX,`.

In `client/src/game/waterShading.ts`, after `WATER_ROWS`:

```ts
/** Kd of the research's clear lake (§2.3, a 5.5 m Secchi depth): the row a
 * lake takes halfway between the very clear high lake and the humic one. */
export const CLEAR_LAKE_KD: [number, number, number] = [0.75, 0.8, 1.6];

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  // a·(1 − t) + b·t, so t = 0 and t = 1 give a and b exactly.
  return [a[0]! * (1 - t) + b[0]! * t, a[1]! * (1 - t) + b[1]! * t, a[2]! * (1 - t) + b[2]! * t];
}

/**
 * A lake's water from its murk (the sim's `murkFor`): Kd through the very
 * clear, the clear and the humic rows the research measured, piecewise
 * linear; L∞ and the shelter straight from the clear high lake to the humic
 * lowland one. Murk 0 is `WATER_ROWS.highLake`, murk 1 `WATER_ROWS.lowlandLake`.
 */
export function lakeWaterRow(murk: number): WaterRow {
  const m = clamp01(murk);
  const high = WATER_ROWS.highLake;
  const low = WATER_ROWS.lowlandLake;
  const kd = m <= 0.5 ? mix3(high.kd, CLEAR_LAKE_KD, m / 0.5) : mix3(CLEAR_LAKE_KD, low.kd, (m - 0.5) / 0.5);
  return { kd, lInf: mix3(high.lInf, low.lInf, m), shelter: high.shelter * (1 - m) + low.shelter * m };
}

/** How much of a lake's surface may carry the duckweed and algae skin: none
 * up to murk 0.5, all of it from 0.8. The clutter field gates the reeds and
 * lilies by the same two numbers (`CLUTTER_WATER_MURK_LO`/`_HI`). */
export function lakeSkin(murk: number): number {
  const t = clamp01((murk - 0.5) / 0.3);
  return t * t * (3 - 2 * t);
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/sim/features.test.ts test/game/waterShading.test.ts test/sim/waterTerrainSweep.test.ts`
Expected: PASS. The sweep still matches the fixture (nothing reads murk yet).

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/features.ts client/src/game/waterShading.ts client/test/sim/features.test.ts client/test/game/waterShading.test.ts
git commit -F - <<'EOF'
feat: a lake's murk by altitude, and its water row from the murk

## What

A lake is murky or clear by where it lies on the climb from the pad to the
crest: fully murky in the lowest quarter, fully clear in the highest. Its
water's attenuation, deep colour and shelter follow from that murk, through
the research's very clear, clear and humic rows.

## How

- `client/src/sim/features.ts` — `murkFor`, `MURK_LO`/`MURK_HI` in the level
  id, and the pond's `murk` and `lobe` fields with the `Lobe` type.
- `client/src/game/waterShading.ts` — `lakeWaterRow`, `CLEAR_LAKE_KD` and
  `lakeSkin`.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 3: The lake's basin

**Files:**
- Modify: `client/src/sim/features.ts` (the lake section from Task 2; `featureStageD` near line 462 stays as it is)
- Modify: `client/src/sim/trailBuild.ts` (the end of `buildTrail`, after the landmarks loop, before `const homeDist`)
- Modify: `client/src/sim/olympic.ts` (`olympicSample`, after `staged = featureStageD(bowl.features, x, z, staged);`)
- Modify: `client/test/sim/helpers/derivatives.ts` (`checkDerivatives` takes a seed)
- Test: `client/test/sim/features.test.ts`, `client/test/sim/lake.test.ts` (create), `client/test/sim/helpers/lakes.ts` (create)

**Interfaces:**
- Consumes: `Feature`, `murkFor` (Task 2).
- Produces: `LAKE_SHELF_DEPTH = 0.9`, `LAKE_SHELF_WIDTH = 10`, `LAKE_SLOPE_WIDTH = 8`, `LAKE_DEPTH_MURKY = 3`, `LAKE_DEPTH_CLEAR = 6`; `lakeMiddleDepth(murk: number): number`; `lakeDepthD(s: number, murk: number): { v: number; d: number }` (depth below the rim at `s` metres in from the rim, and ∂depth/∂s); `lakeD(f: Feature, x: number, z: number, base: TerrainSample): TerrainSample`; `lakeStageD(features: readonly Feature[], x: number, z: number, base: TerrainSample): TerrainSample` (Task 5 adds a leading `seed` parameter); `checkDerivatives(name, pts?, seed?)`. After this task every pond carries `murk`.

Why the build's dish stays: `basinD` (the 0.6 m dish) is what the bowl's builder sees while it places the trail. The lake's bed is applied only to the composed field (`olympicSample`), after the bowl is built, so the build cannot move. The old dish is still what `featureStageD` returns; the lake replaces it inside the rim because `basinD` ignores its base there, and `lakeD` ignores its own base there too.

- [ ] **Step 1: Write the failing tests**

In `client/test/sim/helpers/derivatives.ts`, give `checkDerivatives` a seed (replace its signature and the four `DERIV_SEED` reads inside it):

```ts
export function checkDerivatives(
  name: string,
  pts: Array<[number, number]> = sweepPoints(),
  seed: number = DERIV_SEED,
): { worst: number; steepest: number } {
  const v = variantOrThrow(name);
  let worst = 0;
  let steepest = 0;
  for (const [x, z] of pts) {
    const s = v.sample(seed, x, z);
    const ndx = (v.sample(seed, x + H, z).h - v.sample(seed, x - H, z).h) / (2 * H);
    const ndz = (v.sample(seed, x, z + H).h - v.sample(seed, x, z - H).h) / (2 * H);
```

(the rest of the function unchanged).

Append to `client/test/sim/features.test.ts` (import `lakeDepthD, lakeD, lakeMiddleDepth, LAKE_SHELF_DEPTH, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH, LAKE_DEPTH_MURKY, LAKE_DEPTH_CLEAR, POND_RADIUS_MIN`):

```ts
describe("the lake's bed", () => {
  it("falls to the shelf's depth 10 m in from the rim", () => {
    for (const murk of [0, 0.5, 1]) expect(lakeDepthD(LAKE_SHELF_WIDTH, murk).v).toBeCloseTo(LAKE_SHELF_DEPTH, 12);
    expect(LAKE_SHELF_DEPTH).toBe(0.9);
    expect(LAKE_SHELF_WIDTH).toBe(10);
  });

  it("has a flat middle 3 m deep when murky and 6 m when clear", () => {
    const flat = LAKE_SHELF_WIDTH + LAKE_SLOPE_WIDTH;
    expect(lakeDepthD(flat, 1).v).toBeCloseTo(LAKE_DEPTH_MURKY, 12);
    expect(lakeDepthD(flat, 0).v).toBeCloseTo(LAKE_DEPTH_CLEAR, 12);
    expect(lakeDepthD(flat + 7, 0.5).v).toBeCloseTo(4.5, 12);
    expect(lakeDepthD(flat + 7, 0.5).d).toBe(0);
    expect(lakeMiddleDepth(0.25)).toBeCloseTo(5.25, 12);
  });

  it("is C² at the rim, the shelf's edge and the middle's", () => {
    const e = 1e-4;
    for (const murk of [0, 1]) {
      expect(lakeDepthD(0, murk)).toEqual({ v: 0, d: 0 });
      for (const s of [0, LAKE_SHELF_WIDTH, LAKE_SHELF_WIDTH + LAKE_SLOPE_WIDTH]) {
        const second = (t: number): number => (lakeDepthD(t + e, murk).d - lakeDepthD(t - e, murk).d) / (2 * e);
        // the second derivative is continuous: the same a little either side
        expect(Math.abs(second(s - 1e-3) - second(s + 1e-3))).toBeLessThan(0.02);
      }
    }
  });

  it("keeps a flat middle on the smallest pond", () => {
    expect(POND_RADIUS_MIN - LAKE_SHELF_WIDTH - LAKE_SLOPE_WIDTH).toBeGreaterThan(0);
  });

  const flat = (h: number) => ({ h, dx: 0, dz: 0 });
  const pond = { id: 1, kind: "pond" as const, x: 0, z: 1000, radius: 30, height: 50, murk: 1 };

  it("leaves the ground at and outside the rim untouched", () => {
    const base = { h: 47, dx: 0.1, dz: -0.2 };
    expect(lakeD(pond, 30, 1000, base)).toBe(base);
    expect(lakeD(pond, 0, 1040, base)).toBe(base);
  });

  it("is the rim height less the depth inside, flat in the middle", () => {
    expect(lakeD(pond, 0, 1000 + 20, flat(0)).h).toBeCloseTo(50 - lakeDepthD(10, 1).v, 12);
    expect(lakeD(pond, 0, 1000, flat(0))).toEqual({ h: 50 - LAKE_DEPTH_MURKY, dx: 0, dz: 0 });
  });

  it("has exact derivatives", () => {
    const e = 1e-5;
    for (let i = 0; i < 40; i++) {
      const a = i * 0.7853 + 0.1;
      const q = 0.5 + (i * 29.3) % 29;
      const x = Math.cos(a) * q, z = 1000 + Math.sin(a) * q;
      const s = lakeD(pond, x, z, flat(0));
      const ndx = (lakeD(pond, x + e, z, flat(0)).h - lakeD(pond, x - e, z, flat(0)).h) / (2 * e);
      const ndz = (lakeD(pond, x, z + e, flat(0)).h - lakeD(pond, x, z - e, flat(0)).h) / (2 * e);
      expect(Math.abs(s.dx - ndx)).toBeLessThan(1e-5);
      expect(Math.abs(s.dz - ndz)).toBeLessThan(1e-5);
    }
  });
});
```

Create `client/test/sim/helpers/lakes.ts` (later tasks' tests use it too):

```ts
import "../../../src/sim/olympic.js";
import { bowlFor } from "../../../src/sim/olympic.js";
import type { Feature } from "../../../src/sim/features.js";
import { LOBBY_SEEDS } from "../trailGateSeeds.js";

/** The first lobby world with a pond `pred` accepts, and the pond. Each world
 * tried is a bowl build (about half a second), so call it inside a test. */
export function firstPondWorld(pred: (f: Feature) => boolean = () => true): { seed: number; pond: Feature } {
  for (const seed of LOBBY_SEEDS) {
    const pond = bowlFor(seed).features.find((f) => f.kind === "pond" && pred(f));
    if (pond !== undefined) return { seed, pond };
  }
  throw new Error("no such pond in the lobby worlds");
}
```

Create `client/test/sim/lake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { lakeDepthD, LAKE_SHELF_WIDTH } from "../../src/sim/features.js";
import { checkDerivatives, TOL_RATIO, variantOrThrow } from "./helpers/derivatives.js";
import { firstPondWorld } from "./helpers/lakes.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the lake in the composed field", { timeout: timeLimit(120_000) }, () => {
  it("gives every pond a murk in [0, 1]", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 30)) {
      for (const f of bowlFor(seed).features) {
        if (f.kind === "pond") {
          expect(f.murk, `seed ${seed}`).toBeGreaterThanOrEqual(0);
          expect(f.murk, `seed ${seed}`).toBeLessThanOrEqual(1);
        } else {
          expect(f.murk).toBeUndefined();
        }
      }
    }
  });

  it("carves the lake's bed into the ground: the shelf, then the middle", () => {
    const { seed, pond } = firstPondWorld();
    const v = variantOrThrow("olympic");
    const shelf = v.sample(seed, pond.x + pond.radius - LAKE_SHELF_WIDTH, pond.z).h;
    expect(shelf).toBeCloseTo(pond.height - lakeDepthD(LAKE_SHELF_WIDTH, pond.murk!).v, 6);
    const middle = v.sample(seed, pond.x, pond.z).h;
    expect(middle).toBeCloseTo(pond.height - lakeDepthD(pond.radius, pond.murk!).v, 6);
  });

  it("has exact derivatives across the bed, the rim and the apron", () => {
    const { seed, pond } = firstPondWorld();
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI + 0.37;
      for (const k of [0.1, 0.3, 0.5, 0.62, 0.7, 0.8, 0.9, 0.97, 1.03, 1.2, 1.4]) {
        pts.push([pond.x + Math.cos(a) * k * pond.radius, pond.z + Math.sin(a) * k * pond.radius]);
      }
    }
    const { worst, steepest } = checkDerivatives("olympic", pts, seed);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/sim/features.test.ts test/sim/lake.test.ts`
Expected: FAIL: `lakeDepthD` and `lakeD` are not exported; the ponds have no murk.

- [ ] **Step 3: Implement the bed**

In `client/src/sim/features.ts`, after `murkFor`:

```ts
/** The shelf: from the rim the bed falls to LAKE_SHELF_DEPTH at
 * LAKE_SHELF_WIDTH in (the depth a lake survey found at a shore's shelf,
 * research §5.1), deep enough to wade to the waist and no deeper. */
export const LAKE_SHELF_DEPTH = 0.9;
export const LAKE_SHELF_WIDTH = 10;
/** From the shelf's edge down to the flat middle. */
export const LAKE_SLOPE_WIDTH = 8;
/** The middle's depth: a murky lake's, and a clear lake's, whose bed then
 * reads to about 5 m as the research's subalpine lakes do (§5.5). */
export const LAKE_DEPTH_MURKY = 3;
export const LAKE_DEPTH_CLEAR = 6;

export function lakeMiddleDepth(murk: number): number {
  return LAKE_DEPTH_CLEAR + (LAKE_DEPTH_MURKY - LAKE_DEPTH_CLEAR) * murk;
}

/**
 * Depth below the rim at `s` metres in from the rim, and ∂depth/∂s: two
 * quintic steps, the shelf's and the drop's, each flat to second order at
 * both ends, so the bed is C² at the rim, at the shelf's edge and at the
 * middle's. The shelf levels out at its edge before the drop begins: the
 * ledge a real lake's shore has.
 */
export function lakeDepthD(s: number, murk: number): { v: number; d: number } {
  const shelf = smootherstepD(0, LAKE_SHELF_WIDTH, s);
  const drop = smootherstepD(LAKE_SHELF_WIDTH, LAKE_SHELF_WIDTH + LAKE_SLOPE_WIDTH, s);
  const extra = lakeMiddleDepth(murk) - LAKE_SHELF_DEPTH;
  return { v: LAKE_SHELF_DEPTH * shelf.v + extra * drop.v, d: LAKE_SHELF_DEPTH * shelf.d + extra * drop.d };
}

/**
 * A pond's lake bed. Inside the rim it replaces the build's dish (`basinD`
 * ignores its base there, and so does this); at and outside the rim the
 * ground is returned untouched, and meets the apron with value, slope and
 * curvature all continuous. Applied to the composed field only
 * (`lakeStageD`), never while the bowl is built.
 */
export function lakeD(f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const rx = x - f.x, rz = z - f.z;
  const q2 = rx * rx + rz * rz;
  if (q2 >= f.radius * f.radius) return base;
  const q = Math.sqrt(q2);
  const depth = lakeDepthD(f.radius - q, f.murk ?? 0.5);
  // h = height − D(R − q), so ∂h/∂q = D'(R − q). D' is zero across the flat
  // middle, which holds the centre on every pond, so q → 0 never divides.
  if (depth.d === 0) return { h: f.height - depth.v, dx: 0, dz: 0 };
  return { h: f.height - depth.v, dx: (depth.d * rx) / q, dz: (depth.d * rz) / q };
}

/** The water terrain's stage over the composed field: every pond's lake bed.
 * After `featureStageD` in the olympic variant's sample, and never in the
 * bowl's build, so nothing the build places can move. */
export function lakeStageD(features: readonly Feature[], x: number, z: number, base: TerrainSample): TerrainSample {
  let s = base;
  for (const f of features) if (f.kind === "pond") s = lakeD(f, x, z, s);
  return s;
}
```

Add `LAKE_SHELF_DEPTH, LAKE_SHELF_WIDTH, LAKE_SLOPE_WIDTH, LAKE_DEPTH_MURKY, LAKE_DEPTH_CLEAR,` to `FEATURE_TUNABLES` after `MURK_LO, MURK_HI,`.

- [ ] **Step 4: Write the murk in the build's post-pass**

In `client/src/sim/trailBuild.ts`, add `murkFor` to the import from `./features.js`, and insert after the landmarks loop (after the `for (let li = 0; li < LANDMARK_ORDER.length; li++) { … }` block, before `const homeDist = …`):

```ts
  // ---- The lakes, after everything is placed -------------------------------
  // Written onto each pond and never read by the build: the lake's bed is the
  // composed field's (`lakeStageD`), so nothing placed above can move.
  const peak = features.find((g) => g.kind === "peak");
  const padH = (state.nodes[0] as TrailNode).h;
  for (const f of features) {
    if (f.kind !== "pond") continue;
    f.murk = murkFor(f.height, padH, peak?.crestH);
  }
```

- [ ] **Step 5: Apply the stage in the composed field**

In `client/src/sim/olympic.ts`, add `lakeStageD` to the import from `./features.js`, and in `olympicSample` change

```ts
  staged = featureStageD(bowl.features, x, z, staged);
```

to

```ts
  staged = featureStageD(bowl.features, x, z, staged);
  staged = lakeStageD(bowl.features, x, z, staged);
```

Then check nothing else composes the features onto the field: `grep -rn "featureStageD(" client/src` must show only `trailBuild.ts` (the build's ground, which must NOT get the lake) and this line in `olympic.ts`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run --root client test/sim/features.test.ts test/sim/lake.test.ts test/sim/olympic.test.ts test/sim/waterTerrainSweep.test.ts`
Expected: PASS. The sweep still matches the fixture: the build is untouched and the lakes lie at least `FEATURE_ROAD_CLEAR` (150 m) from the road.

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/features.ts client/src/sim/trailBuild.ts client/src/sim/olympic.ts client/test/sim/helpers/derivatives.ts client/test/sim/helpers/lakes.ts client/test/sim/features.test.ts client/test/sim/lake.test.ts
git commit -F - <<'EOF'
feat: a lake's bed, a shelf and then a middle as deep as its water is clear

## What

The pond's 0.6 m dish becomes a lake's bed: a shore shelf falling to 0.9 m at
10 m in from the rim, then a drop to a flat middle 3 m deep in a murky lake
and 6 m in a clear one. The bowl's build still sees the old dish, so the
trail, the features and the landmarks do not move.

## How

- `client/src/sim/features.ts` — `lakeDepthD`, `lakeD` and `lakeStageD`, C²
  with exact derivatives; the five numbers in the level id.
- `client/src/sim/trailBuild.ts` — each pond's murk, written after the bowl
  is built.
- `client/src/sim/olympic.ts` — the lake's stage in the composed field.
- `client/test/sim/helpers/derivatives.ts` — the derivative check takes a
  seed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 4: The water bodies, the wall at the shelf, and wading by a lake's level

**Files:**
- Modify: `client/src/sim/terrain.ts` (the `TerrainVariant` type)
- Modify: `client/src/sim/olympic.ts` (a cached `waterBodiesHook`, registered on the variant)
- Modify: `client/src/sim/containment.ts`
- Modify: `client/src/sim/world.ts` (`applyMove`, near line 340)
- Test: `client/test/sim/containment.test.ts`, `client/test/sim/lake.test.ts`

**Interfaces:**
- Consumes: `Feature.murk`, `Feature.lobe`, `Lobe` (Task 2), `LAKE_SHELF_WIDTH` (Task 3), `firstPondWorld` (Task 3's `client/test/sim/helpers/lakes.ts`).
- Produces: in `terrain.ts`, `export type LakeSource = { kind: "lake"; level: number; x: number; z: number; radius: number; murk: number; lobe: Lobe | null }`, `export type WaterBodySource = { kind: "sea"; level: number } | LakeSource`, and `TerrainVariant.waterBodies?: (seed: number) => readonly WaterBodySource[]`; in `containment.ts`, `containAtLake(pos: Vec3, vel: Vec3, cx: number, cz: number, wallQ: number): boolean` and `waterLevelAt(world: World, x: number, z: number): number | null`.

The wall stands at the shelf's inner edge, `LAKE_SHELF_WIDTH` in from the rim, where the water is 0.9 m deep: the hull's centre never goes deeper in, so a player wades to the waist and the camera never goes under (sub-project 1's ruling). It is the players' only: the wall runs in `applyMove`, beside the road's.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/lake.test.ts`, adding `import { activeTerrainVariant, type LakeSource } from "../../src/sim/terrain.js";` to its imports:

```ts
describe("the water bodies", { timeout: timeLimit(120_000) }, () => {
  it("are the sea, then one lake per pond, at the pond's rim height, murk and radius", () => {
    const { seed, pond } = firstPondWorld();
    const bodies = variantOrThrow("olympic").waterBodies!(seed);
    expect(bodies[0]).toEqual({ kind: "sea", level: 0 });
    const lakes = bodies.filter((b): b is LakeSource => b.kind === "lake");
    expect(lakes).toHaveLength(1);
    expect(lakes[0]).toMatchObject({ level: pond.height, x: pond.x, z: pond.z, radius: pond.radius, murk: pond.murk });
    expect(variantOrThrow("olympic").waterBodies!(seed)).toBe(bodies); // cached
  });

  it("are the sea alone in a world with no pond", () => {
    const seed = LOBBY_SEEDS.find((s) => !bowlFor(s).features.some((f) => f.kind === "pond"))!;
    expect(activeTerrainVariant().waterBodies!(seed)).toEqual([{ kind: "sea", level: 0 }]);
  });
});
```

Append to `client/test/sim/containment.test.ts` (add `containAtLake, waterLevelAt` to the import from `containment.js`, and import `LAKE_SHELF_WIDTH` from `features.js`, `LakeSource` from `terrain.js`, `LOBBY_SEEDS` from `./trailGateSeeds.js`):

```ts
describe("containAtLake", () => {
  it("puts a hull inside the wall back on it and cancels the velocity into the lake", () => {
    const pos = { x: 100 + 5, y: 1, z: 50 };
    const vel = { x: -3, y: 0, z: 2 };
    expect(containAtLake(pos, vel, 100, 50, 12)).toBe(true);
    expect(pos.x).toBeCloseTo(112, 9);
    expect(pos.z).toBeCloseTo(50, 9);
    expect(vel).toEqual({ x: 0, y: 0, z: 2 });
  });

  it("puts a hull at the very centre out along +x", () => {
    const pos = { x: 100, y: 1, z: 50 };
    const vel = { x: 0, y: 0, z: 0 };
    expect(containAtLake(pos, vel, 100, 50, 12)).toBe(true);
    expect(pos).toEqual({ x: 112, y: 1, z: 50 });
  });

  it("leaves a hull on the shelf alone, velocity included", () => {
    const pos = { x: 100 + 12.01, y: 1, z: 50 };
    const vel = { x: -3, y: 0, z: 0 };
    expect(containAtLake(pos, vel, 100, 50, 12)).toBe(false);
    expect(vel.x).toBe(-3);
  });
});

describe("the lake in a forest world", { timeout: timeLimit(240_000) }, () => {
  /** The first lobby world with a lake: found inside a test, never while the
   * file is collected (each world is a bowl build). */
  function lakeWorld(): { seed: number; lake: LakeSource; wallQ: number } {
    const v = activeTerrainVariant();
    for (const seed of LOBBY_SEEDS) {
      const lake = v.waterBodies!(seed).find((b): b is LakeSource => b.kind === "lake");
      if (lake !== undefined) return { seed, lake, wallQ: lake.radius - LAKE_SHELF_WIDTH };
    }
    throw new Error("no lake in the lobby worlds");
  }

  it("never lets a player past the shelf's edge, whichever way they walk in", () => {
    const { seed, lake, wallQ } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    let nearest = Infinity;
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2;
      const p = spawnPlayer(world);
      const x = lake.x + lake.radius, z = lake.z;
      p.pos = { x, y: elevationAt(seed, x, z) + PLAYER_HALF.y, z };
      for (let t = 0; t < 600; t++) {
        tickWorld(world, new Map([[p.id, input({ seq: t + 1, moveZ: 1, yaw })]]));
        const q = Math.hypot(p.pos.x - lake.x, p.pos.z - lake.z);
        nearest = Math.min(nearest, q);
        expect(q, `heading ${k} tick ${t}`).toBeGreaterThanOrEqual(wallQ - 1e-6);
      }
      world.state.players.delete(p.id);
    }
    // the mechanism fired: some heading walked all the way to the wall
    expect(nearest).toBeLessThan(wallQ + 0.5);
  });

  it("puts a player placed at the lake's centre on the wall after one tick", () => {
    const { seed, lake, wallQ } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    const p = spawnPlayer(world);
    p.pos = { x: lake.x, y: elevationAt(seed, lake.x, lake.z) + PLAYER_HALF.y, z: lake.z };
    tickWorld(world, new Map([[p.id, input({ seq: 1 })]]));
    expect(Math.hypot(p.pos.x - lake.x, p.pos.z - lake.z)).toBeCloseTo(wallQ, 6);
  });

  it("wades by the lake's level within its rim and by the sea's elsewhere", () => {
    const { seed, lake } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    expect(waterLevelAt(world, lake.x + lake.radius - 3, lake.z)).toBe(lake.level);
    expect(waterLevelAt(world, lake.x + lake.radius + 200, lake.z)).toBe(world.waterLevel);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/sim/lake.test.ts test/sim/containment.test.ts`
Expected: FAIL: `waterBodies` is undefined; `containAtLake` and `waterLevelAt` are not exported.

- [ ] **Step 3: Declare the hook**

In `client/src/sim/terrain.ts`, extend the type import from `./features.js` to `import type { FeatureMask, Lobe } from "./features.js";` (keep whatever else it imports), and add before `export type TerrainVariant`:

```ts
/** A lake, as the renderer, the clutter field, the ground paint and the
 * wading read it: the pond feature's rim height, place, radius, murk and
 * marsh. */
export type LakeSource = {
  kind: "lake"; level: number; x: number; z: number; radius: number; murk: number; lobe: Lobe | null;
};
/** Every body of water in a world: the sea at the variant's level, then its lakes. */
export type WaterBodySource = { kind: "sea"; level: number } | LakeSource;
```

and inside `TerrainVariant`, after `waterLevel?: number;`:

```ts
  /** The world's water: the sea first, then each lake. Derived from the
   * bowl's features, cached per seed; absent on a variant with no water. */
  waterBodies?: (seed: number) => readonly WaterBodySource[];
```

- [ ] **Step 4: Register it on the olympic variant**

In `client/src/sim/olympic.ts`, import `type WaterBodySource` from `./terrain.js` (beside `registerTerrainVariant`), and after `featureMaskHook`:

```ts
const WATER_BODIES_CACHE = new Map<number, readonly WaterBodySource[]>();
/** The sea, then one lake per pond feature. A pure function of the bowl, so
 * a per-seed cache is bit-transparent. */
function waterBodiesHook(seed: number): readonly WaterBodySource[] {
  let bodies = WATER_BODIES_CACHE.get(seed);
  if (bodies === undefined) {
    const list: WaterBodySource[] = [{ kind: "sea", level: SEA_LEVEL }];
    for (const f of bowlFor(seed).features) {
      if (f.kind !== "pond") continue;
      list.push({ kind: "lake", level: f.height, x: f.x, z: f.z, radius: f.radius, murk: f.murk ?? 0.5, lobe: f.lobe ?? null });
    }
    bodies = list;
    WATER_BODIES_CACHE.set(seed, bodies);
  }
  return bodies;
}
```

and in the `registerTerrainVariant({ … })` call add `waterBodies: waterBodiesHook,` after `waterLevel: SEA_LEVEL,`.

- [ ] **Step 5: The wall and the wading level**

In `client/src/sim/containment.ts`, add after `containAtRoad`:

```ts
/**
 * The wall in a lake: a hull's centre may not go deeper in than `wallQ` from
 * the lake's centre (the shelf's inner edge, where the water is 0.9 m deep),
 * so a player wades to the waist and the camera never goes under. Moves the
 * hull back out along the radius and cancels the velocity into the lake.
 */
export function containAtLake(pos: Vec3, vel: Vec3, cx: number, cz: number, wallQ: number): boolean {
  const rx = pos.x - cx, rz = pos.z - cz;
  const q2 = rx * rx + rz * rz;
  if (q2 >= wallQ * wallQ) return false;
  const q = Math.sqrt(q2);
  // At the very centre there is no outward direction: out along +x.
  const nx = q > 1e-9 ? rx / q : 1;
  const nz = q > 1e-9 ? rz / q : 0;
  pos.x = cx + nx * wallQ;
  pos.z = cz + nz * wallQ;
  const inward = vel.x * nx + vel.z * nz;
  if (inward < 0) {
    vel.x -= inward * nx;
    vel.z -= inward * nz;
  }
  return true;
}

/** The water a hull at (x, z) wades in: a lake's level within its rim (the
 * marsh lies inside it), the world's sea level elsewhere. */
export function waterLevelAt(world: World, x: number, z: number): number | null {
  if (world.forest !== null) {
    const bodies = activeTerrainVariant().waterBodies?.(world.forest.seed);
    if (bodies !== undefined) {
      for (const b of bodies) {
        if (b.kind !== "lake") continue;
        const dx = x - b.x, dz = z - b.z;
        if (dx * dx + dz * dz < b.radius * b.radius) return b.level;
      }
    }
  }
  return world.waterLevel;
}
```

In `client/src/sim/world.ts`, import `containAtLake, waterLevelAt` beside `containAtRoad`, and `LAKE_SHELF_WIDTH` from `./features.js`. In `applyMove`, pass the wading level and add the wall after the road's:

```ts
function applyMove(world: World, player: PlayerState, cmd: InputCommand): void {
  const before: MoveState = { pos: player.pos, vel: player.vel, grounded: player.grounded };
  const after = stepMovement(
    before,
    cmd,
    TICK_DT,
    world.boxes,
    PLAYER_HALF,
    waterLevelAt(world, player.pos.x, player.pos.z),
    world.ground,
  );
  // The wall at the road (containment.ts): a forest world with a road keeps
  // every hull off the pavement. After the step, on the settled position, so
  // the box sweep and the ground have already had their say.
  if (world.forest !== null) {
    const variant = activeTerrainVariant();
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX !== undefined) {
      containAtRoad(after.pos, after.vel, roadCenterX(world.forest.seed, after.pos.z));
    }
    // The wall in each lake, at the shelf's inner edge.
    const bodies = variant.waterBodies?.(world.forest.seed);
    if (bodies !== undefined) {
      for (const b of bodies) {
        if (b.kind === "lake") containAtLake(after.pos, after.vel, b.x, b.z, b.radius - LAKE_SHELF_WIDTH);
      }
    }
  }
  player.pos = after.pos;
  player.vel = after.vel;
  player.grounded = after.grounded;
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run --root client test/sim/lake.test.ts test/sim/containment.test.ts test/sim/movement.test.ts test/sim/waterTerrainSweep.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/terrain.ts client/src/sim/olympic.ts client/src/sim/containment.ts client/src/sim/world.ts client/test/sim/lake.test.ts client/test/sim/containment.test.ts
git commit -F - <<'EOF'
feat: a wall at a lake's shelf, and wading by the lake's own level

## What

A player walking into a lake stops at the shelf's inner edge, where the water
is 0.9 m deep, so they wade to the waist and the camera never goes under.
Wading slows them by the lake's level as it does by the sea's. The terrain
variant lists its water: the sea, then a lake per pond.

## How

- `client/src/sim/terrain.ts` — `LakeSource`, `WaterBodySource` and the
  `waterBodies` hook.
- `client/src/sim/olympic.ts` — `waterBodiesHook`, cached per seed.
- `client/src/sim/containment.ts` — `containAtLake` and `waterLevelAt`.
- `client/src/sim/world.ts` — the players' step wades by the local level and
  meets each lake's wall after the road's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---
### Task 5: The marsh on a murky lake's shelf

**Files:**
- Modify: `client/src/sim/features.ts` (the lake section; `lakeStageD` gains a leading `seed`)
- Modify: `client/src/sim/trailBuild.ts` (the post-pass from Task 3)
- Modify: `client/src/sim/olympic.ts` (the `lakeStageD` call passes `seed`)
- Test: `client/test/sim/features.test.ts`, `client/test/sim/lake.test.ts`, `client/test/sim/waterTerrainSweep.test.ts`

**Interfaces:**
- Consumes: `Lobe`, `Feature.murk` (Task 2), `LAKE_SHELF_WIDTH`, `lakeD` (Task 3), `fbm2d` (`client/src/sim/field.ts`: value and exact gradient, in [−1, 1]).
- Produces: `MARSH_MURK_MIN = 0.5`, `MARSH_WIDTH_MIN = 0.6`, `MARSH_WIDTH_MAX = 1.0`, `MARSH_AMP = 0.05`, `MARSH_NOISE_WAVE = 4`, `MARSH_EDGE = 0.55`, `MARSH_SHORE_SCAN = 20`, `MARSH_SCORE_STEP = 3`, `MARSH_SALT = 0x3a75`; `marshWidth(radius: number, murk: number): number`; `chooseLobe(f: Feature, murk: number, ground: (x: number, z: number) => number): Lobe | null`; `marshWeightAt(f: { x: number; z: number; radius: number; lobe?: Lobe | null }, x: number, z: number): number` (0 outside, 1 in the marsh's core; takes a `LakeSource` as it is); `marshD(seed: number, f: Feature, x: number, z: number, base: TerrainSample): TerrainSample`; `lobePoints(f: { x: number; z: number; radius: number; lobe?: Lobe | null }, step: number): Array<[number, number]>`; `lakeStageD(seed: number, features: readonly Feature[], x: number, z: number, base: TerrainSample): TerrainSample`. After this task every pond with murk above 0.5 carries a `lobe`, and every other pond `lobe: null`.

The marsh is an ellipse in the shelf's own coordinates: `s = R − q` in from the rim, across the shelf from 0 to `LAKE_SHELF_WIDTH`, and the offset across its direction, up to `width / 2`. Its metric is 1 at the rim and at the shelf's edge, so it lies strictly between the wall (Task 4) and the rim: inside the rim, where the trail never comes, and outside the wall, so a player can wade through it. Nothing in the pond's feature mask changes: inside the rim everything is already bare, with no trees and no clutter.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/features.test.ts` (import `chooseLobe, marshD, marshWeightAt, marshWidth, lobePoints, lakeD, MARSH_AMP, MARSH_EDGE, MARSH_MURK_MIN, MARSH_WIDTH_MIN, MARSH_WIDTH_MAX, LAKE_SHELF_WIDTH`):

```ts
describe("the marsh", () => {
  const pond = { id: 1, kind: "pond" as const, x: 0, z: 1000, radius: 30, height: 50, murk: 0.9 };
  const flatGround = (): number => 50;

  it("comes only above murk 0.5, wider the murkier", () => {
    expect(chooseLobe(pond, 0.5, flatGround)).toBeNull();
    expect(chooseLobe(pond, 0.49, flatGround)).toBeNull();
    expect(marshWidth(30, 1)).toBeCloseTo(MARSH_WIDTH_MAX * 30, 12);
    expect(marshWidth(30, MARSH_MURK_MIN)).toBeCloseTo(MARSH_WIDTH_MIN * 30, 12);
    expect(chooseLobe(pond, 0.9, flatGround)!.width).toBeCloseTo(marshWidth(30, 0.9), 12);
  });

  it("lies where the shore is nearest the level: along the contour of a slope", () => {
    const slope = (x: number): number => 50 + 0.2 * (x - pond.x);
    const lobe = chooseLobe(pond, 0.9, slope)!;
    expect(lobe.dirX).toBe(0);
    expect(Math.abs(lobe.dirZ)).toBe(1);
  });

  it("takes the first direction on ground that ties everywhere", () => {
    expect(chooseLobe(pond, 0.9, flatGround)).toMatchObject({ dirX: 1, dirZ: 0 });
  });

  const withLobe = { ...pond, lobe: { dirX: 1, dirZ: 0, width: marshWidth(30, 0.9) } };
  const baseAt = (x: number, z: number) => lakeD(withLobe, x, z, { h: 50 + 0.1 * x + 0.05 * (z - 1000), dx: 0.1, dz: 0.05 });

  it("lies strictly between the wall and the rim", () => {
    const pts = lobePoints(withLobe, 0.5);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, z] of pts) {
      const q = Math.hypot(x - withLobe.x, z - withLobe.z);
      expect(q).toBeGreaterThan(withLobe.radius - LAKE_SHELF_WIDTH);
      expect(q).toBeLessThan(withLobe.radius);
    }
  });

  it("holds its core within MARSH_AMP of the level", () => {
    let core = 0;
    for (const [x, z] of lobePoints(withLobe, 0.5)) {
      if (marshWeightAt(withLobe, x, z) < 1) continue;
      core++;
      expect(Math.abs(marshD(7, withLobe, x, z, baseAt(x, z)).h - 50)).toBeLessThanOrEqual(MARSH_AMP + 1e-12);
    }
    expect(core).toBeGreaterThan(20);
  });

  it("is the bed itself outside the marsh, and on the far side of the lake", () => {
    for (const [x, z] of [[-25, 1000], [0, 1025], [31, 1000], [10, 1000]] as const) {
      const base = baseAt(x, z);
      expect(marshD(7, withLobe, x, z, base)).toBe(base);
    }
    const inside = baseAt(25, 1000);
    expect(marshD(7, pond, 25, 1000, inside)).toBe(inside); // no marsh on this pond
  });

  it("gives way to the bed smoothly: full inside MARSH_EDGE, none at the ellipse", () => {
    expect(marshWeightAt(withLobe, 25, 1000)).toBe(1);
    expect(marshWeightAt(withLobe, 29.999, 1000)).toBeLessThan(1e-6);
    expect(MARSH_EDGE).toBe(0.55);
  });

  it("has exact derivatives", () => {
    const e = 1e-5;
    const at = (x: number, z: number) => marshD(7, withLobe, x, z, baseAt(x, z));
    for (let i = 0; i < 60; i++) {
      const x = 20.3 + (i % 10);
      const z = 1000 - 14 + (i * 0.47);
      const s = at(x, z);
      expect(Math.abs(s.dx - (at(x + e, z).h - at(x - e, z).h) / (2 * e))).toBeLessThan(1e-5);
      expect(Math.abs(s.dz - (at(x, z + e).h - at(x, z - e).h) / (2 * e))).toBeLessThan(1e-5);
    }
  });
});
```

Append to `client/test/sim/lake.test.ts`, adding `marshWeightAt, lobePoints, MARSH_AMP, MARSH_MURK_MIN` to its import from `features.js`:

```ts
describe("the marsh in the composed field", { timeout: timeLimit(120_000) }, () => {
  it("is held at the lake's level in a real world, and has exact derivatives", () => {
    const { seed, pond } = firstPondWorld((f) => (f.murk ?? 0) > 0.7);
    expect(pond.lobe).not.toBeNull();
    const v = variantOrThrow("olympic");
    const pts = lobePoints(pond, 1);
    let core = 0;
    for (const [x, z] of pts) {
      if (marshWeightAt(pond, x, z) < 1) continue;
      core++;
      expect(Math.abs(v.sample(seed, x, z).h - pond.height)).toBeLessThanOrEqual(MARSH_AMP + 1e-9);
    }
    expect(core).toBeGreaterThan(10);
    const { worst, steepest } = checkDerivatives("olympic", pts.filter((_, i) => i % 3 === 0), seed);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });

  it("is on a pond exactly when its murk is above 0.5", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 40)) {
      for (const f of bowlFor(seed).features) {
        if (f.kind !== "pond") continue;
        expect(f.lobe === null, `seed ${seed}`).toBe(!((f.murk ?? 0) > MARSH_MURK_MIN));
      }
    }
  });
});
```

Append to the `describe` in `client/test/sim/waterTerrainSweep.test.ts`, adding `import { segmentDistance } from "../../src/sim/trail.js";` and `import { lobePoints, LAKE_SHELF_WIDTH, MARSH_MURK_MIN } from "../../src/sim/features.js";`:

```ts
  it("keeps every trail edge out of every lake, and every marsh between its wall and its rim", () => {
    let murky = 0, marshes = 0;
    for (const seed of LOBBY_SEEDS) {
      const b = bowlFor(seed);
      for (const f of b.features) {
        if (f.kind !== "pond") continue;
        let nearest = Infinity;
        for (const e of b.graph.edges) {
          const a = b.graph.nodes[e.a]!, c = b.graph.nodes[e.b]!;
          nearest = Math.min(nearest, segmentDistance(a.x, a.z, c.x, c.z, f.x, f.z));
        }
        expect(nearest, `seed ${seed}: a trail edge inside the lake`).toBeGreaterThanOrEqual(f.radius);
        if ((f.murk ?? 0) > MARSH_MURK_MIN) murky++;
        if (!f.lobe) continue;
        marshes++;
        for (const [x, z] of lobePoints(f, 2)) {
          const q = Math.hypot(x - f.x, z - f.z);
          expect(q, `seed ${seed}`).toBeGreaterThan(f.radius - LAKE_SHELF_WIDTH);
          expect(q, `seed ${seed}`).toBeLessThan(f.radius);
        }
      }
    }
    // every murky lake has its marsh, and there are some
    expect(marshes).toBe(murky);
    expect(marshes).toBeGreaterThan(10);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/sim/features.test.ts test/sim/lake.test.ts`
Expected: FAIL: `chooseLobe`, `marshD` and the others are not exported.

- [ ] **Step 3: Implement the marsh**

In `client/src/sim/features.ts`, change the field import to `import { fbm2d, hash3 } from "./field.js";`, and add after `lakeStageD` (replacing `lakeStageD` itself as shown):

```ts
// ---- The marsh ---------------------------------------------------------------
/** A lake gets a marsh on its shelf above this murk. */
export const MARSH_MURK_MIN = 0.5;
/** Across, as a fraction of R: just above MARSH_MURK_MIN, and at murk 1. */
export const MARSH_WIDTH_MIN = 0.6;
export const MARSH_WIDTH_MAX = 1.0;
/** The marsh ground's swing about the level (m): standing water and tussocks. */
export const MARSH_AMP = 0.05;
/** The swing's noise wavelength (m). */
export const MARSH_NOISE_WAVE = 4;
/** The marsh's metric where it starts giving way to the bed around it. */
export const MARSH_EDGE = 0.55;
/** A direction's shore is scored from 2 m outside the rim to this far out (m),
 * across the marsh's width, on a MARSH_SCORE_STEP grid. */
export const MARSH_SHORE_SCAN = 20;
export const MARSH_SCORE_STEP = 3;
export const MARSH_SALT = 0x3a75;

/** The 16 directions a marsh may take, every 22.5°, as literals: the sim
 * takes no trigonometric function. */
const MARSH_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0], [0.9238795325112867, 0.3826834323650898], [0.7071067811865476, 0.7071067811865476],
  [0.3826834323650898, 0.9238795325112867], [0, 1], [-0.3826834323650898, 0.9238795325112867],
  [-0.7071067811865476, 0.7071067811865476], [-0.9238795325112867, 0.3826834323650898], [-1, 0],
  [-0.9238795325112867, -0.3826834323650898], [-0.7071067811865476, -0.7071067811865476],
  [-0.3826834323650898, -0.9238795325112867], [0, -1], [0.3826834323650898, -0.9238795325112867],
  [0.7071067811865476, -0.7071067811865476], [0.9238795325112867, -0.3826834323650898],
];

/** What the marsh's functions need of a lake: a pond feature or a `LakeSource`. */
type LakeShape = { x: number; z: number; radius: number; lobe?: Lobe | null };

export function marshWidth(radius: number, murk: number): number {
  const t = (murk - MARSH_MURK_MIN) / (1 - MARSH_MURK_MIN);
  return (MARSH_WIDTH_MIN + (MARSH_WIDTH_MAX - MARSH_WIDTH_MIN) * t) * radius;
}

/**
 * A murky lake's marsh: on the shelf, in the direction whose shore (the
 * ground just outside the rim, before the lake) stands least far off the
 * level on average, since a marsh is flat ground the water spreads over. On a
 * tie the first of MARSH_DIRECTIONS. Null at murk MARSH_MURK_MIN and below.
 * `ground` is the pre-feature field; the builder calls this once per pond
 * after the whole bowl is placed.
 */
export function chooseLobe(f: Feature, murk: number, ground: (x: number, z: number) => number): Lobe | null {
  if (!(murk > MARSH_MURK_MIN)) return null;
  const width = marshWidth(f.radius, murk);
  let best: Lobe | null = null;
  let bestOff = Infinity;
  for (const [dirX, dirZ] of MARSH_DIRECTIONS) {
    let sum = 0;
    let n = 0;
    for (let t = f.radius + 2; t <= f.radius + MARSH_SHORE_SCAN; t += MARSH_SCORE_STEP) {
      for (let b = -width / 2; b <= width / 2; b += MARSH_SCORE_STEP) {
        const off = ground(f.x + dirX * t - dirZ * b, f.z + dirZ * t + dirX * b) - f.height;
        sum += off < 0 ? -off : off;
        n++;
      }
    }
    const mean = sum / n;
    if (mean < bestOff) {
      bestOff = mean;
      best = { dirX, dirZ, width };
    }
  }
  return best;
}

/**
 * The marsh's metric at (x, z), below 1 inside it, and its gradient: an
 * ellipse in the shelf's own coordinates, `s = R − q` in from the rim (1 at
 * the rim and at the shelf's edge) and the offset across the marsh's
 * direction (1 at half its width).
 */
function marshMetricD(f: LakeShape, lobe: Lobe, x: number, z: number): { v: number; dx: number; dz: number } {
  const rx = x - f.x, rz = z - f.z;
  // Only the marsh's own side of the lake. Every point it covers lies at
  // least 8 m along its direction (q > R − 10 ≥ 15, the offset across under
  // R/2), so this gate sits where the metric is already ≥ 1.
  if (rx * lobe.dirX + rz * lobe.dirZ <= 0) return { v: Infinity, dx: 0, dz: 0 };
  const q = Math.sqrt(rx * rx + rz * rz);
  const half = LAKE_SHELF_WIDTH / 2;
  const a = (f.radius - q - half) / half;
  const B = lobe.width / 2;
  const b = (-rx * lobe.dirZ + rz * lobe.dirX) / B;
  // ∂s/∂x = −rx/q, ∂s/∂z = −rz/q; the offset across is linear.
  return {
    v: a * a + b * b,
    dx: (2 * a * (-rx / q)) / half - (2 * b * lobe.dirZ) / B,
    dz: (2 * a * (-rz / q)) / half + (2 * b * lobe.dirX) / B,
  };
}

/** How much of the marsh is at (x, z): 1 in its core, 0 outside it. */
export function marshWeightAt(f: LakeShape, x: number, z: number): number {
  if (!f.lobe) return 0;
  const e = marshMetricD(f, f.lobe, x, z).v;
  if (e >= 1) return 0;
  return 1 - smootherstepD(MARSH_EDGE, 1, e).v;
}

/**
 * The marsh stage: the ground held at the lake's level, give or take
 * MARSH_AMP of seeded noise, so standing water and tussocks alternate;
 * blended C² into the bed around it over the metric's MARSH_EDGE..1.
 */
export function marshD(seed: number, f: Feature, x: number, z: number, base: TerrainSample): TerrainSample {
  const lobe = f.lobe;
  if (!lobe) return base;
  const e = marshMetricD(f, lobe, x, z);
  if (e.v >= 1) return base;
  const s = smootherstepD(MARSH_EDGE, 1, e.v);
  const w = 1 - s.v;
  const wDx = -s.d * e.dx, wDz = -s.d * e.dz;
  const n = fbm2d(x / MARSH_NOISE_WAVE, z / MARSH_NOISE_WAVE, seed ^ MARSH_SALT, 2);
  const mh = f.height + MARSH_AMP * n.v;
  const mDx = (MARSH_AMP * n.dx) / MARSH_NOISE_WAVE, mDz = (MARSH_AMP * n.dz) / MARSH_NOISE_WAVE;
  return {
    h: (1 - w) * base.h + w * mh,
    dx: (1 - w) * base.dx + w * mDx + wDx * (mh - base.h),
    dz: (1 - w) * base.dz + w * mDz + wDz * (mh - base.h),
  };
}

/** Points of the marsh on a `step` grid in its own coordinates, for tests and
 * scans: every one lies between the wall and the rim. */
export function lobePoints(f: LakeShape, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const lobe = f.lobe;
  if (!lobe) return out;
  const half = LAKE_SHELF_WIDTH / 2, B = lobe.width / 2;
  for (let s = step / 2; s < LAKE_SHELF_WIDTH; s += step) {
    for (let lat = -B + step / 2; lat < B; lat += step) {
      const a = (s - half) / half, b = lat / B;
      if (a * a + b * b >= 1) continue;
      const q = f.radius - s;
      const along = Math.sqrt(q * q - lat * lat);
      out.push([f.x + lobe.dirX * along - lobe.dirZ * lat, f.z + lobe.dirZ * along + lobe.dirX * lat]);
    }
  }
  return out;
}

/** The water terrain's stage over the composed field: every pond's lake bed,
 * then its marsh. After `featureStageD` in the olympic variant's sample, and
 * never in the bowl's build, so nothing the build places can move. */
export function lakeStageD(seed: number, features: readonly Feature[], x: number, z: number, base: TerrainSample): TerrainSample {
  let s = base;
  for (const f of features) {
    if (f.kind !== "pond") continue;
    s = lakeD(f, x, z, s);
    s = marshD(seed, f, x, z, s);
  }
  return s;
}
```

Delete Task 3's three-argument `lakeStageD`. Add `MARSH_MURK_MIN, MARSH_WIDTH_MIN, MARSH_WIDTH_MAX, MARSH_AMP, MARSH_NOISE_WAVE, MARSH_EDGE, MARSH_SHORE_SCAN, MARSH_SCORE_STEP, MARSH_SALT,` to `FEATURE_TUNABLES` after the lake's numbers.

- [ ] **Step 4: Decide each marsh in the build's post-pass, and pass the seed**

In `client/src/sim/trailBuild.ts`, add `chooseLobe` to the import from `./features.js`, and in the post-pass change the loop body to:

```ts
  for (const f of features) {
    if (f.kind !== "pond") continue;
    f.murk = murkFor(f.height, padH, peak?.crestH);
    // The marsh reads the ground before any feature, as the lake's rim does.
    f.lobe = chooseLobe(f, f.murk, (x, z) => frame.sample(x, z).h);
  }
```

In `client/src/sim/olympic.ts`, change `staged = lakeStageD(bowl.features, x, z, staged);` to `staged = lakeStageD(seed, bowl.features, x, z, staged);`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run --root client test/sim/features.test.ts test/sim/lake.test.ts test/sim/containment.test.ts test/sim/waterTerrainSweep.test.ts`
Expected: PASS. The baseline still matches: the marsh is decided after the build and applied only inside each lake's rim.

- [ ] **Step 6: Commit**

```bash
git add client/src/sim/features.ts client/src/sim/trailBuild.ts client/src/sim/olympic.ts client/test/sim/features.test.ts client/test/sim/lake.test.ts client/test/sim/waterTerrainSweep.test.ts
git commit -F - <<'EOF'
feat: a marsh on a murky lake's shelf, where the shore is flattest

## What

A lake with murk above 0.5 has a marsh at one end: its shelf, from the rim to
the shelf's edge, silted up to the water's level, 0.6 to 1.0 × R across. The
ground there swings 5 cm either side of the level, so standing water and
tussocks alternate. It lies where the ground just outside the rim is nearest
the level. Inside the rim the trail never comes, so nothing placed moves.

## How

- `client/src/sim/features.ts` — `chooseLobe`, `marshD`, `marshWeightAt`,
  `lobePoints`; `lakeStageD` applies the marsh after the bed and takes the
  seed; the marsh's numbers in the level id.
- `client/src/sim/trailBuild.ts` — each murky pond's marsh, decided after the
  bowl is built from the ground before the features.
- `client/src/sim/olympic.ts` — passes the seed.
- The 200-world scan: no trail edge inside any lake, every marsh between its
  wall and its rim, every murky lake with one.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 6: The pebble cove in front of the trailhead

**Files:**
- Modify: `client/src/sim/olympic.ts` (new constants after the dune constants; `stackFieldD` near line 202 and `olympicBaseFrom` near line 312 refactored; `olympicPreTrailSample` near line 491; `olympicSample` near line 562; the registration)
- Modify: `client/src/sim/terrain.ts` (the `coveMask` hook)
- Test: `client/test/sim/cove.test.ts` (create), `client/test/sim/waterTerrainSweep.test.ts`

**Interfaces:**
- Consumes: `TRAIL_Z_ANCHOR` (`bowl.ts`), `ROAD_CORRIDOR_HALF` (`road.ts`), the file's own `smootherstepD`, `smoothPosD`, `shoreProfileD`, `stackFieldD`, `coastFrame`, `roadOffsetD`.
- Produces: `COVE_WIDTH_MIN = 260`, `COVE_WIDTH_MAX = 360`, `COVE_END_BLEND = 30`, `COVE_BACK_FADE = 6`, `COVE_FACE_GRADE = 1 / 12`, `COVE_BED_GRADE = 0.02`, `COVE_TOE_DEPTH = 2`, `COVE_TOE_MORPH = 6`, `COVE_CREST = 3`, `COVE_CREST_MORPH = 0.3`, `HEAD_HEIGHT_MIN = 12`, `HEAD_HEIGHT_MAX = 25`, `HEAD_REACH_MIN = 100`, `HEAD_REACH_MAX = 150`, `HEAD_HALF_WIDTH = 30`, `HEAD_RISE = 50`, `HEAD_TIP = 40`, `COVE_STACK_STEP = 35`, `COVE_STACK_RADIUS_MIN = 8`, `COVE_STACK_RADIUS_MAX = 14`, `COVE_STACK_HEIGHT_MIN = 14`, `COVE_STACK_HEIGHT_MAX = 28`, `COVE_SALT = 0xc07e`; `export type Headland = { z: number; height: number; reach: number }`; `export type CoveStack = { x: number; z: number; radius: number; height: number }`; `export type Cove = { z0: number; halfWidth: number; heads: Headland[]; stacks: CoveStack[] }`; `coveFor(seed: number): Cove`; `coveProfileD(d: number): { v: number; dd: number }`; `TerrainVariant.coveMask?: (seed: number, x: number, z: number) => number` (the cove's weight, 0 to 1).

The cove's ground replaces the coast's outright where its weight is 1: the cove's profile plus the sea stacks, with no dunes, no cliffs and none of the inland blend (which adds up to 1 m and a 0.07 slope on the backshore, measured over 80 worlds). Its weight is the product of an along-shore window (full within `halfWidth − COVE_END_BLEND` of the pad's z, gone by `halfWidth + COVE_END_BLEND`, the seam under each headland) and a seaward window (full beyond `COVE_BACK_FADE` seaward of the road's corridor, zero at and inside the corridor), so the road, the pad and the doorway are untouched. The headlands and their stacks are added on top; each headland's rise is zero at the corridor's edge.

- [ ] **Step 1: Write the failing tests**

Create `client/test/sim/cove.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import {
  coveFor, coveProfileD, COVE_WIDTH_MIN, COVE_WIDTH_MAX, COVE_FACE_GRADE, COVE_BED_GRADE, COVE_CREST,
  COVE_BACK_FADE, HEAD_HEIGHT_MIN, HEAD_HEIGHT_MAX, HEAD_REACH_MIN, HEAD_REACH_MAX, HEAD_HALF_WIDTH,
} from "../../src/sim/olympic.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import { TRAIL_Z_ANCHOR } from "../../src/sim/bowl.js";
import { checkDerivatives, TOL_RATIO, variantOrThrow } from "./helpers/derivatives.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the cove's profile", () => {
  it("meets the sea at the waterline at 1:12", () => {
    expect(coveProfileD(0).v).toBeCloseTo(0, 9);
    expect(coveProfileD(0).dd).toBeCloseTo(COVE_FACE_GRADE, 9);
    expect(coveProfileD(30).v).toBeCloseTo(30 * COVE_FACE_GRADE, 9);
  });

  it("tops out in a berm 3 m up with a flat backshore behind it", () => {
    expect(coveProfileD(40).v).toBeCloseTo(COVE_CREST, 9);
    expect(coveProfileD(40).dd).toBeCloseTo(0, 9);
    expect(coveProfileD(90).v).toBeCloseTo(COVE_CREST, 9);
  });

  it("falls at 1:12 to 2 m deep, then at 1:50 to the 8 m shelf break, then to the floor", () => {
    expect(coveProfileD(-12).v).toBeCloseTo(-1, 9);
    expect(coveProfileD(-124).v).toBeCloseTo(-4, 9);
    expect(coveProfileD(-124).dd).toBeCloseTo(COVE_BED_GRADE, 9);
    expect(coveProfileD(-324).v).toBeCloseTo(-8, 9);
    expect(coveProfileD(-2000).v).toBe(-25);
  });

  it("never falls going inland, and is nowhere steeper than 1:12", () => {
    let prev = -Infinity;
    for (let d = -1500; d <= 120; d += 0.25) {
      const p = coveProfileD(d);
      expect(p.v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(p.dd).toBeLessThanOrEqual(COVE_FACE_GRADE + 1e-12);
      prev = p.v;
    }
  });

  it("has an exact derivative", () => {
    const e = 1e-4;
    for (let d = -1200; d <= 100; d += 3.7) {
      const num = (coveProfileD(d + e).v - coveProfileD(d - e).v) / (2 * e);
      expect(Math.abs(coveProfileD(d).dd - num)).toBeLessThan(1e-7);
    }
  });
});

describe("the cove in front of the trailhead", { timeout: timeLimit(120_000) }, () => {
  const seeds = [0x5eed, 1, 12345, 777, 4242];

  it("is centred on the pad, seeded within its sizes, with one or two stacks off each headland", () => {
    for (const seed of seeds) {
      const c = coveFor(seed);
      expect(coveFor(seed)).toBe(c);
      expect(c.z0).toBe(TRAIL_Z_ANCHOR);
      expect(2 * c.halfWidth).toBeGreaterThanOrEqual(COVE_WIDTH_MIN);
      expect(2 * c.halfWidth).toBeLessThanOrEqual(COVE_WIDTH_MAX);
      expect(c.heads.map((h) => Math.sign(h.z - c.z0))).toEqual([-1, 1]);
      for (const h of c.heads) {
        expect(h.height).toBeGreaterThanOrEqual(HEAD_HEIGHT_MIN);
        expect(h.height).toBeLessThanOrEqual(HEAD_HEIGHT_MAX);
        expect(h.reach).toBeGreaterThanOrEqual(HEAD_REACH_MIN);
        expect(h.reach).toBeLessThanOrEqual(HEAD_REACH_MAX);
        const off = c.stacks.filter((s) => Math.abs(s.z - h.z) <= HEAD_HALF_WIDTH / 2).length;
        expect(off).toBeGreaterThanOrEqual(1);
        expect(off).toBeLessThanOrEqual(2);
      }
    }
  });

  it("rises from the sea at 1:12 to the berm at the pad's frontage", () => {
    const v = variantOrThrow("olympic");
    for (const seed of seeds) {
      const cx = v.roadCenterX!(seed, TRAIL_Z_ANCHOR);
      const x0 = cx - v.coastDistance!(seed, cx, TRAIL_Z_ANCHOR); // the waterline: d = 0
      expect(Math.abs(v.sample(seed, x0, TRAIL_Z_ANCHOR).h)).toBeLessThan(1e-9);
      const grade = (v.sample(seed, x0 + 1, TRAIL_Z_ANCHOR).h - v.sample(seed, x0 - 1, TRAIL_Z_ANCHOR).h) / 2;
      expect(grade).toBeCloseTo(COVE_FACE_GRADE, 3);
      if (x0 + 40 <= cx - ROAD_CORRIDOR_HALF - COVE_BACK_FADE) {
        expect(v.sample(seed, x0 + 40, TRAIL_Z_ANCHOR).h).toBeCloseTo(COVE_CREST, 9);
      }
    }
  });

  it("names its weight on the variant: 1 in the cove, 0 in the corridor and past the headlands", () => {
    const v = variantOrThrow("olympic");
    const seed = 0x5eed;
    const c = coveFor(seed);
    const cx = v.roadCenterX!(seed, 0);
    expect(v.coveMask!(seed, cx - ROAD_CORRIDOR_HALF - COVE_BACK_FADE - 5, 0)).toBe(1);
    expect(v.coveMask!(seed, cx - ROAD_CORRIDOR_HALF + 0.5, 0)).toBe(0);
    const far = c.halfWidth + 40;
    expect(v.coveMask!(seed, v.roadCenterX!(seed, far) - 80, far)).toBe(0);
  });

  it("has exact derivatives across the cove, its ends, the headlands and the stacks", () => {
    const v = variantOrThrow("olympic");
    for (const seed of [0x5eed, 12345]) {
      const c = coveFor(seed);
      const pts: Array<[number, number]> = [];
      for (let z = -c.halfWidth - 60.3; z <= c.halfWidth + 60; z += 17.9) {
        for (let u = -330.1; u <= -25; u += 11.3) pts.push([v.roadCenterX!(seed, z) + u, z]);
      }
      for (const s of c.stacks) for (const k of [0.3, 0.7, 0.95]) pts.push([s.x + k * s.radius, s.z + 0.37]);
      const { worst, steepest } = checkDerivatives("olympic", pts, seed);
      expect(worst / steepest).toBeLessThan(TOL_RATIO);
    }
  });
});
```

Append to the `describe` in `client/test/sim/waterTerrainSweep.test.ts`, adding `coveProfileD, COVE_BACK_FADE` to its imports from `olympic.js` and `ROAD_CORRIDOR_HALF` from `../../src/sim/road.js`:

```ts
  it("gives every world its cove: the profile exactly, from the toe to the corridor, with no dunes", () => {
    const v = variantOrThrow("olympic");
    let backshore = 0;
    for (const seed of LOBBY_SEEDS) {
      // Inside the cove's full window, clear of the headlands and their stacks.
      for (const z of [-100, -50, 0, 50, 100]) {
        const cx = v.roadCenterX!(seed, z);
        const x0 = cx - v.coastDistance!(seed, cx, z);
        const inner = cx - ROAD_CORRIDOR_HALF - COVE_BACK_FADE; // the cove is whole seaward of here
        for (let d = -24; x0 + d <= inner; d += 0.5) {
          const h = v.sample(seed, x0 + d, z).h;
          expect(h, `seed ${seed} z ${z} d ${d}`).toBeCloseTo(coveProfileD(d).v, 9);
          if (d >= 40) backshore++;
        }
      }
    }
    // the mechanism fired on the backshore too, not only on the face
    expect(backshore).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/sim/cove.test.ts`
Expected: FAIL: `coveFor`, `coveProfileD` and the constants are not exported.

- [ ] **Step 3: Share the stack column and the stack band**

In `client/src/sim/olympic.ts`, replace the body of `stackFieldD`'s inner loop from `const rx = x - px;` to the end of the loop body with a call to a shared column, keeping the arithmetic exactly as it is:

```ts
/** One C² column, height·(1 − r²/R²)³ inside R, and its gradient, added into
 * `out`. The sea stacks' shape: the stack field's and the cove's. */
function addColumn(
  px: number, pz: number, radius: number, height: number, x: number, z: number,
  out: { v: number; dx: number; dz: number },
): void {
  const rx = x - px;
  const rz = z - pz;
  const u = (rx * rx + rz * rz) / (radius * radius);
  if (u >= 1) return;
  const s = 1 - u;
  // column = height·(1 − u)³;  ∂column/∂x = −3·height·(1 − u)²·(2·rx/R²)
  out.v += height * s * s * s;
  const dPerR = (-6 * height * s * s) / (radius * radius);
  out.dx += dPerR * rx;
  out.dz += dPerR * rz;
}
```

so `stackFieldD` becomes:

```ts
function stackFieldD(seed: number, x: number, z: number): { v: number; dx: number; dz: number } {
  const cellX = Math.floor(x / STACK_CELL);
  const cellZ = Math.floor(z / STACK_CELL);
  const out = { v: 0, dx: 0, dz: 0 };
  for (let cz = cellZ - 1; cz <= cellZ + 1; cz++) {
    for (let cx = cellX - 1; cx <= cellX + 1; cx++) {
      if (hash3(cx, cz, 0, seed ^ STACK_SALT) >= STACK_DENSITY) continue;
      const px = (cx + 0.2 + 0.6 * hash3(cx, cz, 1, seed ^ STACK_SALT)) * STACK_CELL;
      const pz = (cz + 0.2 + 0.6 * hash3(cx, cz, 2, seed ^ STACK_SALT)) * STACK_CELL;
      const radius =
        STACK_RADIUS_MIN + (STACK_RADIUS_MAX - STACK_RADIUS_MIN) * hash3(cx, cz, 3, seed ^ STACK_SALT);
      const height =
        STACK_HEIGHT_MIN + (STACK_HEIGHT_MAX - STACK_HEIGHT_MIN) * hash3(cx, cz, 4, seed ^ STACK_SALT);
      addColumn(px, pz, radius, height, x, z, out);
    }
  }
  return out;
}
```

Move the stack band out of `olympicBaseFrom` into its own function, the arithmetic unchanged:

```ts
/** The stack field windowed by a C² band in d, so stacks fade in past the
 * surf and out again before the shelf break. The window depends on position
 * only through d, so its gradient rides ∂d/∂x = 1 and ∂d/∂z = dDz. Band
 * support ends at d = STACK_BAND_NEAR < BLEND_START, so stacks never reach the
 * montane blend region. */
function stackBandD(seed: number, x: number, z: number, d: number, dDz: number): { v: number; dx: number; dz: number } {
  const bIn = smootherstepD(STACK_BAND_FAR, STACK_BAND_FAR + STACK_BAND_FADE, d);
  const bOut = smootherstepD(STACK_BAND_NEAR - STACK_BAND_FADE, STACK_BAND_NEAR, d);
  const band = bIn.v * (1 - bOut.v);
  const bandDd = bIn.d * (1 - bOut.v) - bIn.v * bOut.d;
  if (!(band > 0)) return { v: 0, dx: 0, dz: 0 };
  const st = stackFieldD(seed, x, z);
  return {
    v: band * st.v,
    dx: band * st.dx + bandDd * st.v, // ∂band/∂x = bandDd·(∂d/∂x = 1)
    dz: band * st.dz + bandDd * dDz * st.v,
  };
}
```

and in `olympicBaseFrom` replace everything from `const bIn = …` through `const baseDz = shore.dd * dDz + stackDz;` with:

```ts
  const stack = stackBandD(seed, x, z, d, dDz);
  const baseH = shore.v + stack.v;
  const baseDx = shore.dd + stack.dx;
  const baseDz = shore.dd * dDz + stack.dz;
```

Run `npx vitest run --root client test/sim/olympic.test.ts test/sim/waterTerrainSweep.test.ts`: both PASS before going on (the refactor moves no bit).

- [ ] **Step 4: Implement the cove**

In `client/src/sim/olympic.ts`, import `TRAIL_Z_ANCHOR` from `./bowl.js` if it is not imported already, and add after the dune constants:

```ts
// ---- The cove in front of the trailhead ---------------------------------------
/** A pebble pocket beach between two headlands, centred on the pad's frontage
 * (research §4.1, §4.2). Its width along the shore, seeded. */
export const COVE_WIDTH_MIN = 260;
export const COVE_WIDTH_MAX = 360;
/** The cove's ends blend into the bay's profile over ± this about each end,
 * under the headland there. */
export const COVE_END_BLEND = 30;
/** Seaward of the road's corridor the cove comes in over this (m). */
export const COVE_BACK_FADE = 6;
/** The face through the waterline, 1:12, down to COVE_TOE_DEPTH; then the bed
 * at 1:50 to the shelf break, steeper than the bays' 1:67 so swell reaches the
 * face unbroken. */
export const COVE_FACE_GRADE = 1 / 12;
export const COVE_BED_GRADE = 0.02;
export const COVE_TOE_DEPTH = 2;
/** Half-width (m) of the face-to-bed morph about the toe. */
export const COVE_TOE_MORPH = 6;
/** The berm's crest above the sea (m), and the height (m) over which the face
 * rounds into it. */
export const COVE_CREST = 3;
export const COVE_CREST_MORPH = 0.3;
/** Each headland: a ridge out to sea, its crest height and its reach past the
 * waterline (both seeded), its half-width along the shore, the run (m) over
 * which it rises from the corridor's edge, and the taper (m) at its tip. */
export const HEAD_HEIGHT_MIN = 12;
export const HEAD_HEIGHT_MAX = 25;
export const HEAD_REACH_MIN = 100;
export const HEAD_REACH_MAX = 150;
export const HEAD_HALF_WIDTH = 30;
export const HEAD_RISE = 50;
export const HEAD_TIP = 40;
/** One or two stacks off each tip, COVE_STACK_STEP apart beyond it. */
export const COVE_STACK_STEP = 35;
export const COVE_STACK_RADIUS_MIN = 8;
export const COVE_STACK_RADIUS_MAX = 14;
export const COVE_STACK_HEIGHT_MIN = 14;
export const COVE_STACK_HEIGHT_MAX = 28;
export const COVE_SALT = 0xc07e;
```

and after `shoreProfileD`:

```ts
/** Where the face meets the bed, and where the bed reaches the shelf break. */
const COVE_TOE_D = -COVE_TOE_DEPTH / COVE_FACE_GRADE;
const COVE_BREAK_D = COVE_TOE_D - (SHELF_BREAK_DEPTH - COVE_TOE_DEPTH) / COVE_BED_GRADE;

/**
 * The cove's profile in signed coast distance: a flat backshore at
 * COVE_CREST, rounded into the face at 1:12 through the waterline (d = 0),
 * morphing into the 1:50 bed at the toe, 2 m down, then blended to the open
 * floor past the shelf break exactly as `shoreProfileD` is. C² throughout;
 * monotone, and nowhere steeper than the face.
 */
export function coveProfileD(d: number): { v: number; dd: number } {
  const toe = smoothPosD(d - COVE_TOE_D, COVE_TOE_MORPH);
  const near = -COVE_TOE_DEPTH + COVE_BED_GRADE * (d - COVE_TOE_D) + (COVE_FACE_GRADE - COVE_BED_GRADE) * toe.v;
  const nearDd = COVE_BED_GRADE + (COVE_FACE_GRADE - COVE_BED_GRADE) * toe.d;
  // A softened min(near, COVE_CREST): the berm's crest.
  const cap = smoothPosD(near - COVE_CREST, COVE_CREST_MORPH);
  const capped = near - cap.v;
  const cappedDd = nearDd * (1 - cap.d);
  const w = smootherstepD(COVE_BREAK_D - SHELF_BREAK_WIDTH, COVE_BREAK_D, d);
  return {
    v: w.v * capped + (1 - w.v) * -FLOOR_DEPTH,
    dd: w.v * cappedDd + w.d * (capped + FLOOR_DEPTH),
  };
}

export type Headland = { z: number; height: number; reach: number };
export type CoveStack = { x: number; z: number; radius: number; height: number };
export type Cove = { z0: number; halfWidth: number; heads: Headland[]; stacks: CoveStack[] };

const COVE_CACHE = new Map<number, Cove>();
/** The seed's cove: its width, its two headlands and the stacks off their
 * tips. A pure function of the seed, cached. */
export function coveFor(seed: number): Cove {
  const cached = COVE_CACHE.get(seed);
  if (cached !== undefined) return cached;
  const salted = seed ^ COVE_SALT;
  const halfWidth = (COVE_WIDTH_MIN + (COVE_WIDTH_MAX - COVE_WIDTH_MIN) * hash3(0, 0, 0, salted)) / 2;
  const z0 = TRAIL_Z_ANCHOR;
  const heads: Headland[] = [];
  const stacks: CoveStack[] = [];
  for (let i = 0; i < 2; i++) {
    const z = z0 + (i === 0 ? -halfWidth : halfWidth);
    const height = HEAD_HEIGHT_MIN + (HEAD_HEIGHT_MAX - HEAD_HEIGHT_MIN) * hash3(i + 1, 0, 0, salted);
    const reach = HEAD_REACH_MIN + (HEAD_REACH_MAX - HEAD_REACH_MIN) * hash3(i + 1, 1, 0, salted);
    heads.push({ z, height, reach });
    const count = hash3(i + 1, 2, 0, salted) < 0.5 ? 1 : 2;
    for (let k = 0; k < count; k++) {
      const sz = z + (hash3(i + 1, 3 + k, 0, salted) - 0.5) * HEAD_HALF_WIDTH;
      const d = -(reach + HEAD_TIP + COVE_STACK_STEP * k);
      stacks.push({
        x: coastFrame(seed, sz).coastlineX + d,
        z: sz,
        radius: COVE_STACK_RADIUS_MIN + (COVE_STACK_RADIUS_MAX - COVE_STACK_RADIUS_MIN) * hash3(i + 1, 5 + k, 0, salted),
        height: COVE_STACK_HEIGHT_MIN + (COVE_STACK_HEIGHT_MAX - COVE_STACK_HEIGHT_MIN) * hash3(i + 1, 7 + k, 0, salted),
      });
    }
  }
  const cove: Cove = { z0, halfWidth, heads, stacks };
  COVE_CACHE.set(seed, cove);
  return cove;
}

/** The cove's weight and its gradient: the along-shore window times the
 * seaward window. Zero at and inside the road's corridor. */
function coveWeightD(cove: Cove, z: number, u: number, uDz: number): { v: number; dx: number; dz: number } {
  const seaward = smootherstepD(-ROAD_CORRIDOR_HALF - COVE_BACK_FADE, -ROAD_CORRIDOR_HALF, u);
  const wu = 1 - seaward.v;
  if (wu <= 0) return { v: 0, dx: 0, dz: 0 };
  const off = z - cove.z0;
  // |off| is flat-windowed near 0 (the window is 1 within halfWidth − END_BLEND),
  // so its kink at 0 never reaches the weight.
  const sign = off < 0 ? -1 : 1;
  const along = smootherstepD(cove.halfWidth - COVE_END_BLEND, cove.halfWidth + COVE_END_BLEND, off * sign);
  const wz = 1 - along.v;
  if (wz <= 0) return { v: 0, dx: 0, dz: 0 };
  // ∂u/∂x = 1, ∂u/∂z = uDz.
  return { v: wz * wu, dx: -wz * seaward.d, dz: -wz * seaward.d * uDz - along.d * sign * wu };
}

/** One headland added into `out`: a ridge (1 − t²)³ across its axis, rising
 * from nothing at the corridor's edge over HEAD_RISE, holding out to its reach
 * past the waterline, tapering to nothing over HEAD_TIP. */
function headlandD(
  head: Headland, z: number, d: number, dDz: number, u: number, uDz: number,
  out: { v: number; dx: number; dz: number },
): void {
  const t = (z - head.z) / HEAD_HALF_WIDTH;
  if (t <= -1 || t >= 1) return;
  const rise = smootherstepD(-ROAD_CORRIDOR_HALF - HEAD_RISE, -ROAD_CORRIDOR_HALF, u);
  const r = 1 - rise.v;
  if (r <= 0) return;
  const tip = smootherstepD(-head.reach - HEAD_TIP, -head.reach, d);
  if (tip.v <= 0) return;
  const m = 1 - t * t;
  const bump = m * m * m;
  const bumpDz = (-6 * t * m * m) / HEAD_HALF_WIDTH;
  const rDx = -rise.d, rDz = -rise.d * uDz;
  out.v += head.height * bump * r * tip.v;
  out.dx += head.height * bump * (rDx * tip.v + r * tip.d);
  out.dz += head.height * (bumpDz * r * tip.v + bump * (rDz * tip.v + r * tip.d * dDz));
}

/**
 * The cove's stage, after the dunes: where its weight is 1 the ground IS the
 * cove's profile plus the sea stacks (no dunes, no cliffs, none of the inland
 * blend), blended into the coast's own ground across the weight's edges; then
 * the headlands and their stacks on top. Returns `base` itself wherever none
 * of it reaches.
 */
function coveD(seed: number, x: number, z: number, d: number, dDz: number, u: number, uDz: number, base: TerrainSample): TerrainSample {
  const cove = coveFor(seed);
  let out = base;
  const w = coveWeightD(cove, z, u, uDz);
  if (w.v > 0) {
    const p = coveProfileD(d);
    const st = stackBandD(seed, x, z, d, dDz);
    const th = p.v + st.v;
    const tdx = p.dd + st.dx;
    const tdz = p.dd * dDz + st.dz;
    const gap = th - base.h;
    out = {
      h: base.h + w.v * gap,
      dx: base.dx + w.v * (tdx - base.dx) + w.dx * gap,
      dz: base.dz + w.v * (tdz - base.dz) + w.dz * gap,
    };
  }
  const add = { v: 0, dx: 0, dz: 0 };
  for (const head of cove.heads) headlandD(head, z, d, dDz, u, uDz, add);
  for (const s of cove.stacks) addColumn(s.x, s.z, s.radius, s.height, x, z, add);
  if (add.v === 0 && add.dx === 0 && add.dz === 0) return out;
  return { h: out.h + add.v, dx: out.dx + add.dx, dz: out.dz + add.dz };
}

/** The cove's weight at (x, z), 0 to 1: the ground paint and the clutter read it. */
function coveMaskHook(seed: number, x: number, z: number): number {
  const f = coastFrame(seed, z);
  const road = roadOffsetD(seed, z, BLEND_START, f.roadBlendEnd, f.roadBlendEndDz);
  return coveWeightD(coveFor(seed), z, x - f.coastlineX - road.dr, f.dDz - road.drDz).v;
}
```

`coastFrame` is declared further down the file as a function declaration, so `coveFor` may call it.

- [ ] **Step 5: Apply the stage and register the hook**

In `olympicPreTrailSample`, replace the two lines from `const duned = …` through `const padded = …` with:

```ts
  const duned = duneD(seed, x, z, u, uDz, cliffD(seed, x, z, u, uDz, base, apronKeepD(u, uDz, z)));
  const coved = coveD(seed, x, z, d, f.dDz, u, uDz, duned);
  const padded = inBowl(u, z) ? padD(u, uDz, z, padHeightFor(seed), coved) : coved;
```

In `olympicSample`, replace

```ts
  const duned = duneD(seed, x, z, u, uDz, cliffed);
  let staged = duned;
  if (inBowl(u, z)) staged = padD(u, uDz, z, padHeightFor(seed), duned);
```

with

```ts
  const duned = duneD(seed, x, z, u, uDz, cliffed);
  const coved = coveD(seed, x, z, d, f.dDz, u, uDz, duned);
  let staged = coved;
  if (inBowl(u, z)) staged = padD(u, uDz, z, padHeightFor(seed), coved);
```

In `registerTerrainVariant({ … })`, add `coveMask: coveMaskHook,` after `waterBodies: waterBodiesHook,`, and in its `tunables` add, after the DUNE entries:

```ts
    COVE_WIDTH_MIN, COVE_WIDTH_MAX, COVE_END_BLEND, COVE_BACK_FADE, COVE_FACE_GRADE, COVE_BED_GRADE,
    COVE_TOE_DEPTH, COVE_TOE_MORPH, COVE_CREST, COVE_CREST_MORPH,
    HEAD_HEIGHT_MIN, HEAD_HEIGHT_MAX, HEAD_REACH_MIN, HEAD_REACH_MAX, HEAD_HALF_WIDTH, HEAD_RISE, HEAD_TIP,
    COVE_STACK_STEP, COVE_STACK_RADIUS_MIN, COVE_STACK_RADIUS_MAX, COVE_STACK_HEIGHT_MIN, COVE_STACK_HEIGHT_MAX,
    COVE_SALT,
```

In `client/src/sim/terrain.ts`, inside `TerrainVariant` after `waterBodies`:

```ts
  /** The cove in front of the trailhead: its weight at (x, z), 0 to 1. Absent
   * on a variant with no cove. */
  coveMask?: (seed: number, x: number, z: number) => number;
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run --root client test/sim/cove.test.ts test/sim/olympic.test.ts test/sim/shoreStrip.test.ts test/sim/road.test.ts test/sim/waterTerrainSweep.test.ts`
Expected: PASS. The baseline still matches: the cove is zero at and inside the corridor, and the pad is inland of it.

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/olympic.ts client/src/sim/terrain.ts client/test/sim/cove.test.ts client/test/sim/waterTerrainSweep.test.ts
git commit -F - <<'EOF'
feat: a pebble cove between two headlands in front of the trailhead

## What

The shore in front of the pad becomes a pocket beach 260 to 360 m wide: a
flat backshore at 3 m, a berm rounding into a 1:12 face through the
waterline, a 1:50 bed to the shelf break, and a headland at each end reaching
100 to 150 m out to sea with one or two stacks off its tip. No dunes inside
it. Nothing changes at or inside the road's corridor, so the road, the pad and
the doorway are as they were.

## How

- `client/src/sim/olympic.ts` — `coveProfileD`, `coveFor`, the cove's stage
  after the dunes in both samples, `coveMask`; the stack column and the stack
  band shared with the stack field, their arithmetic unchanged; every number
  in the level id.
- `client/src/sim/terrain.ts` — the `coveMask` hook.
- The 200-world scan: the ground is the cove's profile exactly from the toe to
  the corridor's edge on every world.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 7: The renderer draws each lake by its own murk

**Files:**
- Modify: `client/src/game/renderer.ts` (the imports near lines 60–90; `export type Pond` at line 654; `pondDisc` at lines 678–712; `createWater` from line 736; the call site and the wet bodies near line 1411)
- Test: `client/test/game/waterMesh.test.ts`

**Interfaces:**
- Consumes: `LakeSource`, `waterBodies` (Task 4), `lakeWaterRow` (Task 2), `elevationAt` (`client/src/sim/terrain.ts`), `BedPond`, `POND_DISC_MARGIN` (`client/src/game/bedHeight.ts`).
- Produces: `createWater(scene, seed, waterLevel, lakes: readonly LakeSource[] = [], tier, camX, camZ, now)`; `LAKE_SURFACE_SPACING = 2`; `lakeSurface(scene: Scene, mat: PBRMaterial, lake: LakeSource, seed: number, index: number): Mesh` (replaces `pondDisc`; the mesh is still named `pond_${index}`); each lake's material is `mat_water_lake_${index}`, with its own `WaterPlugin` on `lakeWaterRow(lake.murk)`. `export type Pond` is removed.

The lake's surface is a square grid over the lake, not the old disc: a disc's vertices are its centre and its rim, so its per-vertex depth could only ramp linearly from the middle to the rim, and the new bed has a shelf and a drop. Each vertex's depth comes from the sim's own ground (`elevationAt`), so the shelf, the drop and the marsh are drawn as the sim has them; where the ground stands above the water the material discards, as it does on the sea's land.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/waterMesh.test.ts`, import `type LakeSource` and `elevationAt` from `../../src/sim/terrain.js` (beside `activeTerrainVariant`), `lakeWaterRow` from `../../src/game/waterShading.js`, and add this helper at the top of the file:

```ts
/** A lake as the variant lists it. */
function lake(over: Partial<LakeSource> = {}): LakeSource {
  return { kind: "lake", level: 42, x: 100, z: 50, radius: 30, murk: 1, lobe: null, ...over };
}
```

Replace the test "adds one disc per pond on the lake material at the pond's level, and disposes it" with:

```ts
  it("adds one surface per lake on its own material, at its level, with its murk's water, and disposes both", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [lake({ murk: 0 })]);
    const pond = scene.getMeshByName("pond_0")!;
    expect(pond.position.y).toBeCloseTo(42.02, 5);
    expect(pond.getBoundingInfo().boundingBox.extendSizeWorld.x).toBeCloseTo(31, 0);
    const mat = scene.getMaterialByName("mat_water_lake_0") as PBRMaterial;
    expect(pond.material).toBe(mat);
    const row = lakeWaterRow(0);
    for (let c = 0; c < 3; c++) expect(mat.albedoColor.asArray()[c]).toBeCloseTo(row.lInf[c]!, 6);
    expect((mat.pluginManager!.getPlugin("Water") as WaterPlugin).row).toEqual(row);
    expect((pond.metadata as { waterLevel: number }).waterLevel).toBe(42);
    expect(pond.isVerticesDataPresent("bedDepth")).toBe(true);
    expect(pond.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
    water.dispose();
    expect(scene.getMeshByName("pond_0")).toBeNull();
    expect(scene.getMaterialByName("mat_water_lake_0")).toBeNull();
  }, timeLimit(30_000));

  it("makes no lake material and no lake surface in a world with no lake", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, []);
    expect(scene.getMeshByName("pond_0")).toBeNull();
    expect(scene.materials.some((m) => m.name.startsWith("mat_water_lake"))).toBe(false);
    water.dispose();
  });

  it("gives a lake surface's vertices the depth of the sim's own ground under them", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const seed = 1;
    const water = createWater(scene, seed, 0, [lake({ level: 10_000 })]);
    const pond = scene.getMeshByName("pond_0")!;
    const positions = pond.getVerticesData(VertexBuffer.PositionKind)!;
    const depths = pond.getVerticesData("bedDepth")!;
    expect(depths.length).toBe(positions.length / 3);
    for (const i of [0, Math.floor(depths.length / 2), depths.length - 1]) {
      const wx = 100 + positions[i * 3]!, wz = 50 + positions[i * 3 + 2]!;
      expect(depths[i]).toBeCloseTo(10_000 - elevationAt(seed, wx, wz), 1);
    }
    water.dispose();
  }, timeLimit(30_000));
```

In the test "on the high tier draws the water opaque in group 1 …", change `createWater(scene, 7, 0, [{ x: 100, z: 50, radius: 30, height: 42 }], "high")` to `createWater(scene, 7, 0, [lake()], "high")`.

In the `describe` "rings without water are off …", replace

```ts
      const ponds = activeTerrainVariant().trailGraph!(seed).features.filter((f) => f.kind === "pond");
      expect(ponds[0]!.x).toBeCloseTo(pondCam.x, 0);
      const water = createWater(scene, seed, level, ponds, "medium", pondCam.x, pondCam.z);
```

with

```ts
      const lakes = activeTerrainVariant().waterBodies!(seed).filter((b): b is LakeSource => b.kind === "lake");
      expect(lakes[0]!.x).toBeCloseTo(pondCam.x, 0);
      const water = createWater(scene, seed, level, lakes, "medium", pondCam.x, pondCam.z);
```

and make the same `ponds` → `lakes` change anywhere else in the file that builds ponds from `trailGraph` (search the file for `trailGraph!(`).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/game/waterMesh.test.ts`
Expected: FAIL: there is no `mat_water_lake_0`, and the lake has no row of its own.

- [ ] **Step 3: Implement**

In `client/src/game/renderer.ts`:

- Import `elevationAt, type LakeSource` from `../sim/terrain.js` (beside `activeTerrainVariant`), and `lakeWaterRow` beside `WATER_ROWS` from `./waterShading.js`. Delete `import { POND_DEPTH } from "../sim/features.js";`.
- Delete `export type Pond = { x: number; z: number; radius: number; height: number };`.
- Replace `pondDisc` (its doc comment and the function) with:

```ts
/** Spacing (m) of a lake surface's vertices: fine enough that the per-vertex
 * depth follows the shelf and its drop. */
export const LAKE_SURFACE_SPACING = 2;

/**
 * One lake's surface: a flat square grid over the lake at its level, carrying
 * the same per-vertex `bedDepth` the ring meshes carry (`waterRingGeometry`),
 * read from the sim's own ground under each vertex, so the shelf, the drop and
 * the marsh draw as the sim has them. Where the ground stands above the water
 * the material discards, as it does on the sea's land. Static: a lake's
 * ground does not scroll with the camera.
 *
 * Exported so it is reachable from a test without a full `createWater` call.
 */
export function lakeSurface(scene: Scene, mat: PBRMaterial, lake: LakeSource, seed: number, index: number): Mesh {
  const ext = lake.radius + POND_DISC_MARGIN;
  const subdivisions = Math.ceil((2 * ext) / LAKE_SURFACE_SPACING);
  const mesh = MeshBuilder.CreateGround(`pond_${index}`, { width: 2 * ext, height: 2 * ext, subdivisions }, scene);
  mesh.position.set(lake.x, lake.level + 0.02, lake.z);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
  const vertexCount = positions.length / 3;
  const depths = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const wx = lake.x + (positions[i * 3] as number);
    const wz = lake.z + (positions[i * 3 + 2] as number);
    depths[i] = Math.max(0, lake.level - elevationAt(seed, wx, wz));
  }
  mesh.setVerticesData("bedDepth", depths, false, 1);
  mesh.metadata = { waterLevel: lake.level };
  mesh.freezeWorldMatrix();
  return mesh;
}
```

- In `createWater`, change the parameter `ponds: readonly Pond[] = [],` to `lakes: readonly LakeSource[] = [],`, and replace the lake material's creation:

```ts
  const lakeMat = new PBRMaterial("mat_water_lake", scene);
  lakeMat.backFaceCulling = false;
  const lakePlugin = attachWater(lakeMat, WATER_ROWS.lowlandLake);
  const plugins = [seaPlugin, lakePlugin];
  for (const mat of [seaMat, lakeMat]) {
```

with

```ts
  // One material per lake, on the row its murk gives (a world has at most one).
  const lakeMats = lakes.map((_, i) => {
    const mat = new PBRMaterial(`mat_water_lake_${i}`, scene);
    mat.backFaceCulling = false;
    return mat;
  });
  const lakePlugins = lakes.map((l, i) => attachWater(lakeMats[i] as PBRMaterial, lakeWaterRow(l.murk)));
  const plugins = [seaPlugin, ...lakePlugins];
  for (const mat of [seaMat, ...lakeMats]) {
```

then `budgetMaterial(lakeMat);` becomes `for (const mat of lakeMats) budgetMaterial(mat);`, `lakeMat.bumpTexture = bump;` becomes `for (const mat of lakeMats) mat.bumpTexture = bump;`, the pond meshes line becomes

```ts
  const pondMeshes: Mesh[] = lakes.map((l, i) => lakeSurface(scene, lakeMats[i] as PBRMaterial, l, seed, i));
```

(update the comment above it: "One surface per lake, on its own material. Static …"), `bedSquareHasWater(next, spare, ponds, waterLevel, seed)` becomes `bedSquareHasWater(next, spare, lakes, waterLevel, seed)` (a `LakeSource` is a `BedPond`), and in `dispose` `lakeMat.dispose();` becomes `for (const mat of lakeMats) mat.dispose();`.

- At the call site (near line 1411), replace

```ts
  const ponds: readonly Pond[] =
    forest !== null
      ? (activeTerrainVariant().trailGraph?.(forest.seed).features.filter((f) => f.kind === "pond") ?? [])
      : [];
  const water =
    forest !== null && waterLevel !== undefined
      ? createWater(scene, forest.seed, waterLevel, ponds, tier, level.playerSpawns[0]?.x ?? 0, level.playerSpawns[0]?.z ?? 0, clock)
      : null;
```

with

```ts
  const lakes: readonly LakeSource[] =
    forest !== null
      ? (activeTerrainVariant().waterBodies?.(forest.seed).filter((b): b is LakeSource => b.kind === "lake") ?? [])
      : [];
  const water =
    forest !== null && waterLevel !== undefined
      ? createWater(scene, forest.seed, waterLevel, lakes, tier, level.playerSpawns[0]?.x ?? 0, level.playerSpawns[0]?.z ?? 0, clock)
      : null;
```

and the wet bodies' loop

```ts
  for (const p of ponds) {
    wetBodies.push({ ...WATER_ROWS.lowlandLake, level: p.height, x: p.x, z: p.z, radius: p.radius });
  }
```

with

```ts
  for (const l of lakes) {
    wetBodies.push({ ...lakeWaterRow(l.murk), level: l.level, x: l.x, z: l.z, radius: l.radius });
  }
```

Then `grep -rn "Pond\b\|pondDisc\|POND_DEPTH" client/src/game` must show nothing but `BedPond` in `bedHeight.ts`; update `bedHeight.ts`'s comment on `POND_DISC_MARGIN` from "a pond's disc (renderer.ts `pondDisc`)" to "a lake's surface (renderer.ts `lakeSurface`)".

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/waterMesh.test.ts test/game/bedHeight.test.ts test/game/wetPlugin.test.ts`
Expected: PASS. Then `npm run typecheck` (the root script) must pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/renderer.ts client/src/game/bedHeight.ts client/test/game/waterMesh.test.ts
git commit -F - <<'EOF'
feat: draw each lake with the water its murk gives, over its real bed

## What

A lake is no longer always the humic lowland lake: its water's attenuation,
deep colour and roughness come from its murk, so a high lake draws clear to
its bed. Its surface is a grid whose depth per vertex is the sim's own ground,
so the shelf, the drop and the marsh draw as the sim has them.

## How

- `client/src/game/renderer.ts` — `createWater` takes the variant's lakes,
  with a material and a plugin per lake on `lakeWaterRow(murk)`;
  `lakeSurface` replaces `pondDisc`; the wet line takes each lake's row.
- `client/src/game/bedHeight.ts` — a comment follows the rename.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 8: Reeds, cattails and pond-lilies

**Files:**
- Modify: `client/src/sim/clutter.ts` (the class ids near line 19, new constants, the `CLASSES` table near line 451, `clutterDensity`'s switch, `CLUTTER_TUNABLES`)
- Modify: `client/src/game/foliagePlugin.ts` (`FOLIAGE_PROFILES`)
- Create: `client/src/game/waterPlants.ts`
- Modify: `client/src/game/renderer.ts` (after the water)
- Test: `client/test/sim/clutter.test.ts`, `client/test/game/foliagePlugin.test.ts`, `client/test/game/waterPlants.test.ts` (create)

**Interfaces:**
- Consumes: `waterBodies`, `LakeSource` (Task 4), `marshWeightAt` (Task 5), `POND_SHORE` (`features.ts`), `bladeClumpGeometry`, `BLADE_VERTS`, `BladeCharacter`, `BladeClumpGeometry` (`bladeClump.ts`), `attachFoliage`, `setFoliageEdges` (`foliagePlugin.ts`), `attachFoliageLight` (`foliageLightPlugin.ts`), `firstPondWorld` (`client/test/sim/helpers/lakes.ts`).
- Produces: `CLUTTER_REED = 9`, `CLUTTER_LILY = 10` (after `CLUTTER_CLASS_COUNT`, which stays 9: it counts the model-drawn classes `clutterField.ts` and `clutterMeshes.ts` iterate); `CLUTTER_REED_CELL`, `_D`, `_SCALE_MIN`, `_SCALE_MAX`, `_SALT`, `_DEPTH_LO`, `_DEPTH_HI`, `_PATCH_WAVE`, the same for `CLUTTER_LILY_`, and `CLUTTER_WATER_MURK_LO = 0.5`, `CLUTTER_WATER_MURK_HI = 0.8`; `FOLIAGE_PROFILES.REEDS`; `waterPlants.ts`: `REED_CHARACTERS`, `REED_BLADES`, `reedGeometry(variant: number)`, `lilyPadGeometry()`, `lilyFlowerGeometry()`, `lilyFlowers(seed: number, inst: ClutterInstance): boolean`, `LILY_LIFT = 0.03`, `createWaterPlants(scene: Scene, seed: number, lakes: readonly LakeSource[]): WaterPlants` with `type WaterPlants = { meshes: Mesh[]; dispose(): void }` (meshes in order: `water_reeds_0`, `water_reeds_1`, `water_reeds_2`, `water_lily_pads`, `water_lily_flowers`).

The sim places the plants (every peer agrees, and the numbers move the level id); the renderer builds their meshes in code and draws every plant a lake has once, at load: a lake is a few thousand square metres, so nothing needs to follow the camera. The reeds are the grass's blade builder with reed characters; the cattail variant adds a brown head below each stalk's tip. The reeds' profile has no ground tint, no per-blade cut and no tilt, so it compiles the same shader variant the trees' does.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/clutter.test.ts` (import `CLUTTER_REED, CLUTTER_LILY, CLUTTER_CLASS_COUNT, CLUTTER_TUNABLES, clutterDensity` from `clutter.js`, `firstPondWorld` from `./helpers/lakes.js`, `lobePoints, marshWeightAt` from `features.js`, `activeTerrainVariant, elevationAt, type LakeSource` from `terrain.js`, and `timeLimit` if the file does not already):

```ts
describe("the water plants", { timeout: timeLimit(120_000) }, () => {
  function lakeOf(seed: number): LakeSource {
    return activeTerrainVariant().waterBodies!(seed).find((b): b is LakeSource => b.kind === "lake")!;
  }

  it("follow the model-drawn classes, which still number nine", () => {
    expect(CLUTTER_CLASS_COUNT).toBe(9);
    expect([CLUTTER_REED, CLUTTER_LILY]).toEqual([9, 10]);
    for (const k of ["CLUTTER_REED_CELL", "CLUTTER_REED_D", "CLUTTER_LILY_CELL", "CLUTTER_LILY_D", "CLUTTER_WATER_MURK_LO", "CLUTTER_WATER_MURK_HI"]) {
      expect(CLUTTER_TUNABLES[k], k).toBeTypeOf("number");
    }
  });

  it("fill a murky lake's marsh with reeds and keep them out of its deep water", () => {
    const { seed, pond } = firstPondWorld((f) => (f.murk ?? 0) >= 0.8);
    const lake = lakeOf(seed);
    let core = 0;
    for (const [x, z] of lobePoints(lake, 1)) {
      if (marshWeightAt(lake, x, z) < 1) continue;
      core++;
      expect(clutterDensity(seed, CLUTTER_REED, x, z)).toBe(1);
    }
    expect(core).toBeGreaterThan(10);
    expect(clutterDensity(seed, CLUTTER_REED, pond.x, pond.z)).toBe(0);
    expect(clutterDensity(seed, CLUTTER_LILY, pond.x, pond.z)).toBe(0);
  });

  it("float lilies only in water 0.5 to 2 m deep, in patches", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 0) >= 0.8);
    const lake = lakeOf(seed);
    let most = 0;
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      for (let s = 0.5; s < 20; s += 0.5) {
        const x = lake.x + Math.cos(a) * (lake.radius - s), z = lake.z + Math.sin(a) * (lake.radius - s);
        const depth = lake.level - elevationAt(seed, x, z);
        const d = clutterDensity(seed, CLUTTER_LILY, x, z);
        if (depth < 0.5 || depth > 2) expect(d, `depth ${depth}`).toBe(0);
        most = Math.max(most, d);
      }
    }
    expect(most).toBeGreaterThan(0.5);
  });

  it("grow in no clear lake", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 1) <= 0.5);
    const lake = lakeOf(seed);
    for (let s = 0; s < 20; s += 0.5) {
      const x = lake.x + lake.radius - s;
      expect(clutterDensity(seed, CLUTTER_REED, x, lake.z)).toBe(0);
      expect(clutterDensity(seed, CLUTTER_LILY, x, lake.z)).toBe(0);
    }
  });
});
```

In `client/test/game/foliagePlugin.test.ts`, in "FOLIAGE_PROFILES matches the spec's table exactly", add to the expected object:

```ts
      REEDS: { amp: 0.5, groundTint: 0, rootAO: 0.6, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 1.0 },
```

Create `client/test/game/waterPlants.test.ts`:

```ts
import { describe, expect, it, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt, type LakeSource } from "../../src/sim/terrain.js";
import { firstPondWorld } from "../sim/helpers/lakes.js";
import { BLADE_VERTS, bladeClumpGeometry, bladeVertexCount } from "../../src/game/bladeClump.js";
import {
  REED_CHARACTERS, REED_BLADES, reedGeometry, lilyPadGeometry, lilyFlowerGeometry, lilyFlowers,
  createWaterPlants, LILY_LIFT, LILY_FLOWER_PATCHES,
} from "../../src/game/waterPlants.js";
import { CLUTTER_LILY_PATCH_WAVE } from "../../src/sim/clutter.js";
import { timeLimit } from "../helpers/timeLimit.js";

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

describe("the reeds and cattails", () => {
  it("stand 1.2 to 2 m tall across the class's 0.9 to 1.1 scale", () => {
    for (const c of REED_CHARACTERS) {
      expect(c.height[0] * 0.9).toBeGreaterThanOrEqual(1.2 - 1e-9);
      expect(c.height[1] * 1.1).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("give the cattail a brown head below every stalk's tip", () => {
    const stalks = REED_BLADES[2]!;
    // the layout the heads rely on: each blade's strip ends in its tip
    const raw = bladeClumpGeometry(REED_CHARACTERS[2]!, stalks);
    for (let b = 0; b < stalks; b++) expect(raw.blade[(b * BLADE_VERTS + BLADE_VERTS - 1) * 4 + 3]).toBe(1);
    const g = reedGeometry(2);
    const strip = bladeVertexCount(REED_CHARACTERS[2]!, stalks);
    const heads = g.positions.length / 3 - strip;
    expect(heads).toBe(stalks * 14);
    for (let b = 0; b < stalks; b++) {
      const tipY = g.positions[(b * BLADE_VERTS + BLADE_VERTS - 1) * 3 + 1]!;
      const headY = g.positions[(strip + b * 14 + 12) * 3 + 1]!; // the head's lower cap centre
      expect(headY).toBeLessThan(tipY);
      expect(headY).toBeGreaterThan(0.6 * tipY);
    }
    expect(reedGeometry(0).positions.length / 3).toBe(bladeVertexCount(REED_CHARACTERS[0]!, REED_BLADES[0]!));
  });
});

describe("the pond-lilies", () => {
  it("are notched discs lying flat", () => {
    const g = lilyPadGeometry();
    for (let i = 0; i < g.positions.length / 3; i++) {
      expect(g.positions[i * 3 + 1]).toBe(0);
      expect(Math.hypot(g.positions[i * 3]!, g.positions[i * 3 + 2]!)).toBeLessThanOrEqual(1 + 1e-6);
    }
    // nothing in the notch, along +x
    for (let i = 1; i < g.positions.length / 3; i++) {
      expect(Math.abs(Math.atan2(g.positions[i * 3 + 2]!, g.positions[i * 3]!))).toBeGreaterThan(0.24);
    }
    expect(lilyFlowerGeometry().indices.length).toBe(18);
  });

  it("flower in about a third of the patches", () => {
    let patches = 0, flowering = 0;
    for (let px = 0; px < 60; px++) {
      for (let pz = 0; pz < 60; pz++) {
        patches++;
        const inst = { cls: 10, x: (px + 0.5) * CLUTTER_LILY_PATCH_WAVE, z: (pz + 0.5) * CLUTTER_LILY_PATCH_WAVE, groundH: 0, groundDx: 0, groundDz: 0, scale: 0.15, variant: 0, hash: 0 };
        if (lilyFlowers(0x5eed, inst)) flowering++;
      }
    }
    expect(flowering / patches).toBeGreaterThan(LILY_FLOWER_PATCHES - 0.05);
    expect(flowering / patches).toBeLessThan(LILY_FLOWER_PATCHES + 0.05);
  });
});

describe("a lake's plants in the scene", { timeout: timeLimit(120_000) }, () => {
  function lakeOf(seed: number): LakeSource {
    return activeTerrainVariant().waterBodies!(seed).find((b): b is LakeSource => b.kind === "lake")!;
  }

  it("stand a murky lake's reeds on its ground and float its pads on its water", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 0) >= 0.8);
    const lake = lakeOf(seed);
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plants = createWaterPlants(scene, seed, [lake]);
    expect(plants.meshes.map((m) => m.name)).toEqual(["water_reeds_0", "water_reeds_1", "water_reeds_2", "water_lily_pads", "water_lily_flowers"]);
    const reeds = plants.meshes.slice(0, 3).reduce((n, m) => n + m.thinInstanceCount, 0);
    expect(reeds).toBeGreaterThan(100);
    const t = new Vector3();
    for (const m of plants.meshes[0]!.thinInstanceGetWorldMatrices().slice(0, 20)) {
      m.getTranslationToRef(t);
      expect(t.y).toBeCloseTo(elevationAt(seed, t.x, t.z), 3);
    }
    const pads = plants.meshes[3]!;
    expect(pads.thinInstanceCount).toBeGreaterThan(20);
    for (const m of pads.thinInstanceGetWorldMatrices().slice(0, 20)) {
      m.getTranslationToRef(t);
      expect(t.y).toBeCloseTo(lake.level + LILY_LIFT, 3);
    }
    plants.dispose();
    expect(scene.getMeshByName("water_reeds_0")).toBeNull();
  });

  it("gives a clear lake none", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 1) <= 0.5);
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plants = createWaterPlants(scene, seed, [lakeOf(seed)]);
    for (const m of plants.meshes) {
      expect(m.thinInstanceCount).toBe(0);
      expect(m.isEnabled()).toBe(false);
    }
    plants.dispose();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/sim/clutter.test.ts test/game/foliagePlugin.test.ts test/game/waterPlants.test.ts`
Expected: FAIL: `CLUTTER_REED`, `FOLIAGE_PROFILES.REEDS` and `waterPlants.ts` do not exist.

- [ ] **Step 3: Place the plants in the sim**

In `client/src/sim/clutter.ts`, after `export const CLUTTER_CLASS_COUNT = 9;` (and change its comment to say it counts the model-drawn classes, which `clutterField.ts` and `clutterMeshes.ts` iterate, the water plants following them):

```ts
/** Reeds and cattails at a murky lake's margin and on its marsh. Placed here
 * like every class; drawn by `waterPlants.ts`, not the model-drawn clutter. */
export const CLUTTER_REED = 9;
/** Yellow pond-lily pads on a murky lake's shallows; drawn by `waterPlants.ts`. */
export const CLUTTER_LILY = 10;
```

With the other class constants:

```ts
/** Reeds: a clump a square metre at most, standing from the wet band 30 cm
 * above the water down to 60 cm deep, in patches, and throughout the marsh. */
export const CLUTTER_REED_CELL = 1;
export const CLUTTER_REED_D = 1;
export const CLUTTER_REED_SCALE_MIN = 0.9;
export const CLUTTER_REED_SCALE_MAX = 1.1;
export const CLUTTER_REED_SALT = 0x2eed;
export const CLUTTER_REED_DEPTH_LO = -0.3;
export const CLUTTER_REED_DEPTH_HI = 0.6;
export const CLUTTER_REED_PATCH_WAVE = 6;
/** Pond-lilies: a pad of 12 to 20 cm radius, in water 0.5 to 2 m deep (the
 * depths a lake survey found them in, research §5.1), in patches. */
export const CLUTTER_LILY_CELL = 0.8;
export const CLUTTER_LILY_D = 1.2;
export const CLUTTER_LILY_SCALE_MIN = 0.12;
export const CLUTTER_LILY_SCALE_MAX = 0.2;
export const CLUTTER_LILY_SALT = 0x1117;
export const CLUTTER_LILY_DEPTH_LO = 0.5;
export const CLUTTER_LILY_DEPTH_HI = 2;
export const CLUTTER_LILY_PATCH_WAVE = 8;
/** The water plants begin above this murk and are full from the next; the
 * water's skin (`waterShading.ts` `lakeSkin`) takes the same two. */
export const CLUTTER_WATER_MURK_LO = 0.5;
export const CLUTTER_WATER_MURK_HI = 0.8;
```

Append two rows to `CLASSES` (after the litter row):

```ts
  { cell: CLUTTER_REED_CELL, density: CLUTTER_REED_D, salt: CLUTTER_REED_SALT, scaleMin: CLUTTER_REED_SCALE_MIN, scaleMax: CLUTTER_REED_SCALE_MAX, variants: 3, trailClear: 0 },
  { cell: CLUTTER_LILY_CELL, density: CLUTTER_LILY_D, salt: CLUTTER_LILY_SALT, scaleMin: CLUTTER_LILY_SCALE_MIN, scaleMax: CLUTTER_LILY_SCALE_MAX, variants: 1, trailClear: 0 },
```

Import `marshWeightAt, POND_SHORE` beside `NO_FEATURE_MASK` from `./features.js`, and `type WaterBodySource` beside the terrain imports. Add after the `smoothstep` helper:

```ts
/**
 * A water plant's gate at a point: the reeds on a murky lake's wet band and
 * shallows and throughout its marsh, the lilies on its 0.5 to 2 m water, each
 * in seeded patches; nothing on a lake at murk CLUTTER_WATER_MURK_LO or below,
 * or away from every lake.
 */
function waterPlantDensity(
  seed: number, cls: number, x: number, z: number, h: number, bodies: readonly WaterBodySource[] | undefined,
): number {
  if (bodies === undefined) return 0;
  for (const b of bodies) {
    if (b.kind !== "lake") continue;
    const reach = b.radius + POND_SHORE;
    const dx = x - b.x, dz = z - b.z;
    if (dx * dx + dz * dz >= reach * reach) continue;
    const murky = smoothstep(CLUTTER_WATER_MURK_LO, CLUTTER_WATER_MURK_HI, b.murk);
    if (murky <= 0) return 0;
    const depth = b.level - h;
    if (cls === CLUTTER_REED) {
      const band = smoothstep(CLUTTER_REED_DEPTH_LO, CLUTTER_REED_DEPTH_LO + 0.2, depth)
        * (1 - smoothstep(CLUTTER_REED_DEPTH_HI - 0.15, CLUTTER_REED_DEPTH_HI, depth));
      const patch = smoothstep(0.35, 0.6, valueNoise2(x / CLUTTER_REED_PATCH_WAVE, z / CLUTTER_REED_PATCH_WAVE, seed ^ CLUTTER_REED_SALT));
      return murky * Math.max(band * patch, marshWeightAt(b, x, z));
    }
    const band = smoothstep(CLUTTER_LILY_DEPTH_LO, CLUTTER_LILY_DEPTH_LO + 0.2, depth)
      * (1 - smoothstep(CLUTTER_LILY_DEPTH_HI - 0.2, CLUTTER_LILY_DEPTH_HI, depth));
    const patch = smoothstep(0.55, 0.7, valueNoise2(x / CLUTTER_LILY_PATCH_WAVE, z / CLUTTER_LILY_PATCH_WAVE, seed ^ CLUTTER_LILY_SALT));
    return murky * band * patch;
  }
  return 0;
}
```

In `clutterDensity`'s switch add:

```ts
    case CLUTTER_REED:
    case CLUTTER_LILY:
      return waterPlantDensity(seed, cls, x, z, s.h, variant.waterBodies?.(seed));
```

Add every new constant to `CLUTTER_TUNABLES` (the ids, the sixteen per-class numbers and the two murk edges).

The reeds in the marsh core read density 1: `murky` is 1 at murk ≥ 0.8 and `marshWeightAt` is 1 there. With `CLUTTER_REED_D` 1 and a 1 m cell, `clutterInCell` then places a clump in every cell of the core.

- [ ] **Step 4: The reeds' profile**

In `client/src/game/foliagePlugin.ts`, add to `FOLIAGE_PROFILES` after `BLADES`:

```ts
  /** Reeds and cattails: the blade builder's strips, whose normals lie flat,
   * so the blades' up-bias; no ground tint (their colours are their own), no
   * per-blade cut and no tilt, so the shader variant is the trees'. */
  REEDS: { amp: 0.5, groundTint: 0, rootAO: 0.6, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 1.0 },
```

- [ ] **Step 5: Build and draw them**

Create `client/src/game/waterPlants.ts`:

```ts
// client/src/game/waterPlants.ts
/**
 * A murky lake's plants: reeds and cattails on its wet band, its shallows and
 * its marsh; yellow pond-lilies on its 0.5 to 2 m water. The sim's clutter
 * field places them (`CLUTTER_REED`, `CLUTTER_LILY`, in the level id); this
 * builds their meshes in code and draws every plant a lake has, once, at load.
 * A lake is a few thousand square metres, so nothing follows the camera.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  CLUTTER_LILY, CLUTTER_LILY_PATCH_WAVE, CLUTTER_LILY_SALT, CLUTTER_REED, clutterInRect, type ClutterInstance,
} from "../sim/clutter.js";
import { hash3 } from "../sim/field.js";
import { POND_SHORE } from "../sim/features.js";
import type { LakeSource } from "../sim/terrain.js";
import { BLADE_VERTS, bladeClumpGeometry, type BladeCharacter, type BladeClumpGeometry } from "./bladeClump.js";
import { attachFoliage, setFoliageEdges, FOLIAGE_PROFILES } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import type { Rgb } from "./colour.js";

/** The reed class's variants, by `ClutterInstance.variant`: two reeds and a
 * cattail. Their colours are their own (the material's albedo is white), and
 * their heights times the class's 0.9 to 1.1 scale stand 1.2 to 2 m. */
export const REED_CHARACTERS: readonly BladeCharacter[] = [
  { name: "reed", height: [1.35, 1.65], width: 0.007, droop: [0.05, 0.25], tint: { r: 0.3, g: 0.34, b: 0.14 }, tip: "none" },
  { name: "tall reed", height: [1.5, 1.8], width: 0.009, droop: [0.1, 0.35], tint: { r: 0.36, g: 0.36, b: 0.17 }, tip: "none" },
  { name: "cattail", height: [1.35, 1.8], width: 0.006, droop: [0, 0.08], tint: { r: 0.27, g: 0.32, b: 0.13 }, tip: "none" },
];
/** Blades in each variant's clump. */
export const REED_BLADES: readonly number[] = [14, 12, 5];
/** A cattail's head: a brown spike this long and this thick (m), centred this
 * far up its stalk. */
export const CATTAIL_HEAD_LENGTH = 0.2;
export const CATTAIL_HEAD_RADIUS = 0.014;
export const CATTAIL_HEAD_AT = 0.82;
const CATTAIL_HEAD_SIDES = 6;
/** Two rings of sides, then the two caps' centres. */
const CATTAIL_HEAD_VERTS = CATTAIL_HEAD_SIDES * 2 + 2;
const CATTAIL_HEAD_COLOUR: Rgb = { r: 0.33, g: 0.21, b: 0.12 };
/** Lily pads float this far above the lake's level (m), over the water's own
 * surface at +0.02, with the depth bias a painted face needs at a distance
 * (the decal note in `boardPaint.ts`). */
export const LILY_LIFT = 0.03;
const LILY_DEPTH_BIAS = -120;
const LILY_PAD_SEGMENTS = 14;
/** Half the pad's notch (rad). */
const LILY_NOTCH = 0.25;
const LILY_PAD_COLOUR: Rgb = { r: 0.16, g: 0.26, b: 0.08 };
const LILY_FLOWER_COLOUR: Rgb = { r: 0.85, g: 0.7, b: 0.12 };
/** About a third of the lily patches flower (research §5.1), and in a
 * flowering patch this share of the pads. */
export const LILY_FLOWER_PATCHES = 1 / 3;
export const LILY_FLOWER_SHARE = 0.25;
const LILY_FLOWER_PETALS = 6;
const LILY_FLOWER_RADIUS = 0.022;
const LILY_FLOWER_HEIGHT = 0.025;
/** The reeds stop moving in the wind between these distances (m). */
const REED_WIND_EDGES: readonly [number, number] = [60, 90];

type Geometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

/** A reed clump by variant: the blade builder's strips, and on the cattail a
 * brown head below every stalk's tip. */
export function reedGeometry(variant: number): Geometry {
  const count = REED_BLADES[variant] as number;
  const g = bladeClumpGeometry(REED_CHARACTERS[variant] as BladeCharacter, count);
  return variant === 2 ? withCattailHeads(g, count) : g;
}

function withCattailHeads(g: BladeClumpGeometry, stalks: number): Geometry {
  const stride = g.colors.length / (g.positions.length / 3);
  const n0 = g.positions.length / 3;
  const n = n0 + stalks * CATTAIL_HEAD_VERTS;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * stride);
  const indices = new Uint16Array(g.indices.length + stalks * CATTAIL_HEAD_SIDES * 12);
  positions.set(g.positions);
  normals.set(g.normals);
  colors.set(g.colors);
  indices.set(g.indices);
  let v = n0;
  let t = g.indices.length;
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
    positions.set([x, y, z], v * 3);
    normals.set([nx, ny, nz], v * 3);
    colors.set([CATTAIL_HEAD_COLOUR.r, CATTAIL_HEAD_COLOUR.g, CATTAIL_HEAD_COLOUR.b, 1].slice(0, stride), v * stride);
    v++;
  };
  for (let b = 0; b < stalks; b++) {
    // Each blade's strip ends in its tip vertex; its root lies at y = 0.
    const tip = b * BLADE_VERTS + BLADE_VERTS - 1;
    const rootX = g.blade[tip * 4] as number;
    const rootZ = g.blade[tip * 4 + 1] as number;
    const cx = rootX + ((g.positions[tip * 3] as number) - rootX) * CATTAIL_HEAD_AT;
    const cy = (g.positions[tip * 3 + 1] as number) * CATTAIL_HEAD_AT;
    const cz = rootZ + ((g.positions[tip * 3 + 2] as number) - rootZ) * CATTAIL_HEAD_AT;
    const first = v;
    for (let ring = 0; ring < 2; ring++) {
      const y = cy + (ring - 0.5) * CATTAIL_HEAD_LENGTH;
      for (let k = 0; k < CATTAIL_HEAD_SIDES; k++) {
        const a = (k / CATTAIL_HEAD_SIDES) * Math.PI * 2;
        vertex(cx + Math.cos(a) * CATTAIL_HEAD_RADIUS, y, cz + Math.sin(a) * CATTAIL_HEAD_RADIUS, Math.cos(a), 0, Math.sin(a));
      }
    }
    const bottom = v;
    vertex(cx, cy - 0.5 * CATTAIL_HEAD_LENGTH, cz, 0, -1, 0);
    const top = v;
    vertex(cx, cy + 0.5 * CATTAIL_HEAD_LENGTH, cz, 0, 1, 0);
    for (let k = 0; k < CATTAIL_HEAD_SIDES; k++) {
      const a0 = first + k;
      const a1 = first + ((k + 1) % CATTAIL_HEAD_SIDES);
      const b0 = a0 + CATTAIL_HEAD_SIDES;
      const b1 = a1 + CATTAIL_HEAD_SIDES;
      indices.set([a0, b0, a1, a1, b0, b1, bottom, a1, a0, top, b0, b1], t);
      t += 12;
    }
  }
  return { positions, normals, colors, indices };
}

/** A pad: a disc of unit radius lying flat, with its notch along +x. */
export function lilyPadGeometry(): Geometry {
  const rim = LILY_PAD_SEGMENTS + 1;
  const positions = new Float32Array((rim + 1) * 3);
  const normals = new Float32Array((rim + 1) * 3);
  const colors = new Float32Array((rim + 1) * 4).fill(1);
  const indices = new Uint16Array(LILY_PAD_SEGMENTS * 3);
  normals[1] = 1;
  for (let k = 0; k < rim; k++) {
    const a = LILY_NOTCH + (k / LILY_PAD_SEGMENTS) * (Math.PI * 2 - 2 * LILY_NOTCH);
    positions.set([Math.cos(a), 0, Math.sin(a)], (k + 1) * 3);
    normals.set([0, 1, 0], (k + 1) * 3);
  }
  for (let k = 0; k < LILY_PAD_SEGMENTS; k++) indices.set([0, k + 2, k + 1], k * 3);
  return { positions, normals, colors, indices };
}

/** A flower: a cup of petals opening up from the pad's centre. */
export function lilyFlowerGeometry(): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const w = Math.PI / LILY_FLOWER_PETALS;
  for (let p = 0; p < LILY_FLOWER_PETALS; p++) {
    const a = (p / LILY_FLOWER_PETALS) * Math.PI * 2;
    const base = positions.length / 3;
    positions.push(
      0, 0, 0,
      Math.cos(a - w) * LILY_FLOWER_RADIUS, LILY_FLOWER_HEIGHT, Math.sin(a - w) * LILY_FLOWER_RADIUS,
      Math.cos(a + w) * LILY_FLOWER_RADIUS, LILY_FLOWER_HEIGHT, Math.sin(a + w) * LILY_FLOWER_RADIUS,
    );
    for (let k = 0; k < 3; k++) normals.push(Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6);
    indices.push(base, base + 1, base + 2);
  }
  const count = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(count * 4).fill(1),
    indices: new Uint16Array(indices),
  };
}

/** Whether a pad carries a flower: a third of the patches flower (seeded by
 * the patch's cell), and a share of the pads in each. */
export function lilyFlowers(seed: number, inst: ClutterInstance): boolean {
  const px = Math.floor(inst.x / CLUTTER_LILY_PATCH_WAVE);
  const pz = Math.floor(inst.z / CLUTTER_LILY_PATCH_WAVE);
  if (hash3(px, pz, 9, seed ^ CLUTTER_LILY_SALT) >= LILY_FLOWER_PATCHES) return false;
  return inst.hash < LILY_FLOWER_SHARE;
}

export type WaterPlants = { meshes: Mesh[]; dispose(): void };

function meshFrom(scene: Scene, name: string, g: Geometry): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.isPickable = false;
  return mesh;
}

function material(scene: Scene, name: string, albedo: Rgb, roughness: number): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor = new Color3(albedo.r, albedo.g, albedo.b);
  mat.metallic = 0;
  mat.roughness = roughness;
  mat.backFaceCulling = false;
  return mat;
}

/** Every plant `list` holds, as thin instances: yaw by its hash, scaled
 * (sx, sy, sx), at the height `y` gives. A mesh with none is disabled. */
function place(mesh: Mesh, list: readonly ClutterInstance[], y: (inst: ClutterInstance) => number, sx: (inst: ClutterInstance) => number, sy: (inst: ClutterInstance) => number): void {
  if (list.length === 0) {
    mesh.setEnabled(false);
    return;
  }
  const buf = new Float32Array(list.length * 16);
  const m = new Matrix();
  const rot = new Quaternion();
  const scale = new Vector3();
  const at = new Vector3();
  list.forEach((inst, i) => {
    Quaternion.RotationYawPitchRollToRef(inst.hash * Math.PI * 2, 0, 0, rot);
    scale.set(sx(inst), sy(inst), sx(inst));
    at.set(inst.x, y(inst), inst.z);
    Matrix.ComposeToRef(scale, rot, at, m);
    m.copyToArray(buf, i * 16);
  });
  mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
}

export function createWaterPlants(scene: Scene, seed: number, lakes: readonly LakeSource[]): WaterPlants {
  const reeds: ClutterInstance[][] = [[], [], []];
  const pads: ClutterInstance[] = [];
  const levelOf = new Map<ClutterInstance, number>();
  for (const lake of lakes) {
    const r = lake.radius + POND_SHORE + 1;
    for (const inst of clutterInRect(seed, CLUTTER_REED, lake.x - r, lake.z - r, lake.x + r, lake.z + r)) {
      (reeds[inst.variant] as ClutterInstance[]).push(inst);
    }
    for (const inst of clutterInRect(seed, CLUTTER_LILY, lake.x - r, lake.z - r, lake.x + r, lake.z + r)) {
      pads.push(inst);
      levelOf.set(inst, lake.level);
    }
  }
  const meshes: Mesh[] = [];
  const materials: PBRMaterial[] = [];
  for (let variant = 0; variant < REED_CHARACTERS.length; variant++) {
    const mesh = meshFrom(scene, `water_reeds_${variant}`, reedGeometry(variant));
    const mat = material(scene, `water_reeds_${variant}_mat`, { r: 1, g: 1, b: 1 }, 0.8);
    attachFoliage(mat, FOLIAGE_PROFILES.REEDS, mesh.getBoundingInfo().boundingBox.maximum.y);
    attachFoliageLight(mat);
    setFoliageEdges(mat, REED_WIND_EDGES);
    mesh.material = mat;
    mesh.receiveShadows = true;
    place(mesh, reeds[variant] as ClutterInstance[], (i) => i.groundH, (i) => i.scale, (i) => i.scale);
    meshes.push(mesh);
    materials.push(mat);
  }
  const padMesh = meshFrom(scene, "water_lily_pads", lilyPadGeometry());
  const padMat = material(scene, "water_lily_pads_mat", LILY_PAD_COLOUR, 0.35);
  padMat.zOffsetUnits = LILY_DEPTH_BIAS;
  padMesh.material = padMat;
  const lifted = (i: ClutterInstance): number => (levelOf.get(i) as number) + LILY_LIFT;
  place(padMesh, pads, lifted, (i) => i.scale, () => 1);
  const flowerMesh = meshFrom(scene, "water_lily_flowers", lilyFlowerGeometry());
  const flowerMat = material(scene, "water_lily_flowers_mat", LILY_FLOWER_COLOUR, 0.6);
  flowerMat.zOffsetUnits = LILY_DEPTH_BIAS;
  flowerMesh.material = flowerMat;
  place(flowerMesh, pads.filter((i) => lilyFlowers(seed, i)), lifted, () => 1, () => 1);
  meshes.push(padMesh, flowerMesh);
  materials.push(padMat, flowerMat);
  return {
    meshes,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
```

In `client/src/game/renderer.ts`, import `createWaterPlants` from `./waterPlants.js`, and after `partOf(water);`:

```ts
  // A murky lake's reeds, cattails and lilies: placed by the sim, built here.
  const waterPlants = forest !== null && lakes.length > 0 ? createWaterPlants(scene, forest.seed, lakes) : null;
  partOf(waterPlants);
```

(`lakes` is Task 7's list, declared above the water.)

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run --root client test/sim/clutter.test.ts test/game/foliagePlugin.test.ts test/game/waterPlants.test.ts test/game/pluginBindings.test.ts test/game/shaderHygiene.test.ts test/sim/waterTerrainSweep.test.ts`
Expected: PASS. If a test that enumerates `FOLIAGE_PROFILES` (for example `client/test/game/helpers/pluginText.ts`'s consumers) lists the profiles, add `REEDS` to its expectation the same way.

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/clutter.ts client/src/game/foliagePlugin.ts client/src/game/waterPlants.ts client/src/game/renderer.ts client/test/sim/clutter.test.ts client/test/game/foliagePlugin.test.ts client/test/game/waterPlants.test.ts
git commit -F - <<'EOF'
feat: reeds, cattails and yellow pond-lilies on murky lakes

## What

A murky lake grows reeds and cattails on its wet band, in its shallows to
60 cm deep and throughout its marsh, and floats yellow pond-lilies in patches
on its 0.5 to 2 m water, a third of the patches in flower. A clear lake has
none. Every peer sees the same plants: the sim places them.

## How

- `client/src/sim/clutter.ts` — `CLUTTER_REED` and `CLUTTER_LILY`, gated by
  the lake's murk, depth and marsh, their numbers in the level id; the class
  count still counts the model-drawn classes.
- `client/src/game/waterPlants.ts` — the reed clumps from the grass's blade
  builder, the cattail heads, the notched pad and the flower, all built in
  code and drawn once per lake as thin instances.
- `client/src/game/foliagePlugin.ts` — the reeds' wind profile.
- `client/src/game/renderer.ts` — the plants beside the water.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 9: The duckweed and algae skin

**Files:**
- Modify: `client/src/game/waterShading.ts` (`waterSkinOffset`)
- Modify: `client/src/game/waterPlugin.ts` (the `skin` property, its uniform and its binding)
- Modify: `client/src/game/shaders/water.fragment.fx`, `client/src/game/shaders/waterLights.fragment.fx`, `client/src/game/shaders/waterCompose.fragment.fx`
- Modify: `client/src/game/renderer.ts` (`createWater`: each lake plugin's skin)
- Test: `client/test/game/waterPlugin.test.ts`, `client/test/game/waterShading.test.ts`, `client/test/game/waterMesh.test.ts`

**Interfaces:**
- Consumes: `lakeSkin(murk)` (Task 2), `createWater`'s per-lake plugins (Task 7).
- Produces: `waterSkinOffset(seed: number): number`; `WaterPlugin.skin: [number, number]` (x: how much of the surface may carry the skin, 0 on the sea; y: the seed's offset for the skin's noise), bound as `uniform vec2 waterSkin`; GLSL `waterSkinMask(vec2 xz, float depth)`, `waterSkinColour(vec2 xz, float viewDepth)` and the local `wSkin` in the lights block, read again in the compose block.

The skin is a film, not objects: where it lies the water's colour becomes the fronds', the bed's light and the ripples are held under it, and the sky's reflection and the sun's glint are taken off it (a matte film). Where it lies comes from the lake's depth under the pixel, its murk (through `lakeSkin`) and a seeded noise, so every peer sees the same skin without the sim placing it: duckweed drifts on the sheltered shallows under 1.5 m, clumped algae mats along the margin under 0.4 m.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/waterShading.test.ts` (import `waterSkinOffset`):

```ts
describe("waterSkinOffset", () => {
  it("is the same for a seed every time, and differs between seeds", () => {
    expect(waterSkinOffset(0x5eed)).toBe(waterSkinOffset(0x5eed));
    expect(waterSkinOffset(1)).not.toBe(waterSkinOffset(2));
    expect(waterSkinOffset(-1)).toBeGreaterThanOrEqual(0);
    expect(waterSkinOffset(-1)).toBeLessThan(4096);
  });
});
```

Append to the `describe("water plugin")` in `client/test/game/waterPlugin.test.ts`:

```ts
  it("declares and binds the skin, off by default", () => {
    const mat = new PBRMaterial("wSkin", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    expect(p.skin).toEqual([0, 0]);
    expect(p.getUniforms().ubo.map((u) => u.name)).toContain("waterSkin");
    expect(p.getUniforms().fragment).toContain("uniform vec2 waterSkin;");
    p.skin = [0.75, 123.5];
    const pairs: [string, number, number][] = [];
    const record = (): void => undefined;
    const ubo = {
      updateFloat: record, updateFloat3: record, updateFloat4: record, setTexture: vi.fn(),
      updateFloat2: (name: string, a: number, b: number) => { pairs.push([name, a, b]); },
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    expect(pairs).toContainEqual(["waterSkin", 0.75, 123.5]);
  });

  it("lays the skin over the water after the transmission, and takes the reflection off it", () => {
    const l = fx("waterLights.fragment.fx");
    const skin = l.indexOf("float wSkin = waterSkinMask(vPositionW.xz, wDepth);");
    expect(skin).toBeGreaterThan(l.indexOf("wTransmit = wBed * wT * (1.0 - wF);"));
    expect(l).toContain("wTransmit *= 1.0 - wSkin;");
    const c = fx("waterCompose.fragment.fx");
    expect(c).toContain("finalRadianceScaled *= 1.0 - wSkin;");
    expect(c).toContain("finalSpecularScaled *= 1.0 - wSkin;");
    expect(c.indexOf("finalRadianceScaled")).toBeLessThan(c.indexOf("finalEmissive += wTransmit;"));
    const d = fx("water.fragment.fx");
    expect(d).toContain("float waterSkinMask(vec2 xz, float depth)");
    expect(d).toContain("vec3 waterSkinColour(vec2 xz, float viewDepth)");
  });
```

In `client/test/game/waterMesh.test.ts`, append to "adds one surface per lake …" before `water.dispose();` (import `lakeSkin, waterSkinOffset` from `waterShading.js`):

```ts
    expect((mat.pluginManager!.getPlugin("Water") as WaterPlugin).skin).toEqual([lakeSkin(0), waterSkinOffset(1)]);
    const sea = water.meshes[0]!.material as PBRMaterial;
    expect((sea.pluginManager!.getPlugin("Water") as WaterPlugin).skin).toEqual([0, 0]);
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/game/waterShading.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts`
Expected: FAIL: no `waterSkinOffset`, no `skin`, no skin in the shaders.

- [ ] **Step 3: Implement**

In `client/src/game/waterShading.ts`, after `lakeSkin`:

```ts
/** The seed's offset (m) for the skin's noise, so two worlds' lakes do not
 * wear the same pattern. Render-only, but seeded: every peer sees one skin. */
export function waterSkinOffset(seed: number): number {
  return ((seed >>> 0) % 4096) * 0.731;
}
```

In `client/src/game/waterPlugin.ts`: add the property after `octaves = 2;`:

```ts
  /** The duckweed and algae skin: x how much of the surface may carry it
   * (`lakeSkin` of the lake's murk; 0 on the sea), y the seed's noise offset
   * (`waterSkinOffset`). */
  skin: [number, number] = [0, 0];
```

add `{ name: "waterSkin", size: 2, type: "vec2" },` to the `ubo` list and `"uniform vec2 waterSkin;",` to the `fragment` list (both after `waterNearFar`), and in `bindForSubMesh` after the `waterNearFar` line:

```ts
    uniformBuffer.updateFloat2("waterSkin", this.skin[0], this.skin[1]);
```

Append to `client/src/game/shaders/water.fragment.fx`:

```glsl

// The skin: duckweed and algae mats on a murky lake. A value noise on the unit
// lattice (a hash without sine, which loses precision at world coordinates),
// the lake's seed offsetting it.
float waterSkinHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float waterSkinNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = waterSkinHash(i);
  float b = waterSkinHash(i + vec2(1.0, 0.0));
  float c = waterSkinHash(i + vec2(0.0, 1.0));
  float d = waterSkinHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Where the skin lies, 0 to 1: duckweed in drifts on the sheltered shallows,
// under 1.5 m, and algae in clumped mats along the margin, under 0.4 m.
float waterSkinMask(vec2 xz, float depth) {
  if (waterSkin.x <= 0.0) return 0.0;
  vec2 p = xz + waterSkin.y;
  float drift = waterSkinNoise(p / 9.0) * 0.65 + waterSkinNoise(p / 3.0) * 0.35;
  float duckweed = smoothstep(0.55, 0.62, drift) * (1.0 - smoothstep(0.9, 1.5, depth));
  float algae = smoothstep(0.5, 0.58, waterSkinNoise(p / 1.6)) * (1.0 - smoothstep(0.15, 0.4, depth));
  return waterSkin.x * max(duckweed, algae);
}

// The skin's colour: duckweed's bright fronds, finely speckled near the eye
// and evened out with distance so the speckle never shimmers, and the
// yellower algae where the mats clump.
vec3 waterSkinColour(vec2 xz, float viewDepth) {
  vec2 p = xz + waterSkin.y;
  float frond = mix(waterSkinNoise(p * 7.0), 0.5, smoothstep(10.0, 40.0, viewDepth));
  vec3 duckweed = mix(vec3(0.16, 0.26, 0.05), vec3(0.24, 0.34, 0.07), frond);
  vec3 algae = vec3(0.30, 0.32, 0.10);
  return mix(duckweed, algae, 0.5 * smoothstep(0.4, 0.6, waterSkinNoise(p / 1.6)));
}
```

Append to `client/src/game/shaders/waterLights.fragment.fx`:

```glsl
// The skin, where a murky lake carries it: a matte film of fronds over the
// water, the bed, the depth and the ripples hidden under it.
float wSkin = waterSkinMask(vPositionW.xz, wDepth);
surfaceAlbedo = mix(surfaceAlbedo, waterSkinColour(vPositionW.xz, vWaterViewDepth), wSkin);
wTransmit *= 1.0 - wSkin;
alpha = mix(alpha, 1.0, wSkin);
normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wSkin));
```

In `client/src/game/shaders/waterCompose.fragment.fx`, insert before `finalEmissive += wTransmit;`:

```glsl
// The skin is matte: the sky's reflection and the sun's glint are held off it.
#ifdef REFLECTION
finalRadianceScaled *= 1.0 - wSkin;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= 1.0 - wSkin;
#endif
```

(`finalRadianceScaled` and `finalSpecularScaled` are declared by Babylon 9.18's `pbrBlockFinalLitComponents` before this hook: `grep -o "vec3 finalRadianceScaled=[^;]*" node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalLitComponents.js` prints `vec3 finalRadianceScaled=finalRadiance*vLightingIntensity.z`.)

In `client/src/game/renderer.ts`, import `lakeSkin, waterSkinOffset` beside `lakeWaterRow`, and in `createWater` after the `lakePlugins` line:

```ts
  lakePlugins.forEach((p, i) => {
    p.skin = [lakeSkin((lakes[i] as LakeSource).murk), waterSkinOffset(seed)];
  });
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/waterShading.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/pluginBindings.test.ts test/game/shaderHygiene.test.ts test/game/water.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/waterShading.ts client/src/game/waterPlugin.ts client/src/game/shaders/water.fragment.fx client/src/game/shaders/waterLights.fragment.fx client/src/game/shaders/waterCompose.fragment.fx client/src/game/renderer.ts client/test/game/waterShading.test.ts client/test/game/waterPlugin.test.ts client/test/game/waterMesh.test.ts
git commit -F - <<'EOF'
feat: a skin of duckweed and algae on a murky lake's shallows

## What

A murky lake carries a film of fronds: duckweed drifting on its sheltered
shallows and yellower algae mats clumped along its margin. Where it lies the
water takes the fronds' colour, hides the bed and the ripples, and loses its
reflection and glint. It comes from the lake's depth, its murk and a seeded
noise, so every peer sees the same skin. The sea and clear lakes have none.

## How

- `client/src/game/shaders/water*.fx` — the skin's noise, mask and colour, its
  film over the water before lights, and its matte in the composition.
- `client/src/game/waterPlugin.ts` — the `skin` uniform, 0 unless set.
- `client/src/game/waterShading.ts` — `waterSkinOffset`.
- `client/src/game/renderer.ts` — each lake's skin from its murk.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 10: The ground under and beside the water

**Files:**
- Create: `client/src/game/waterGround.ts`
- Modify: `client/src/game/terrainSurface.ts` (the palette near line 105; `classifySurface` from line 168)
- Modify: `client/src/game/clipmap.ts` (the `classifySurface` call near line 166)
- Modify: `client/src/sim/clutter.ts` (the driftwood case near line 590)
- Test: `client/test/game/waterGround.test.ts` (create), `client/test/game/terrainSurface.test.ts`, `client/test/sim/clutter.test.ts`, `client/test/architecture.test.ts`

**Interfaces:**
- Consumes: `waterBodies`, `coveMask` (Tasks 4, 6), `marshWeightAt`, `lobePoints` (Task 5), `firstPondWorld` (Task 3).
- Produces: `type WaterGround = { bed: number; murk: number; marsh: number; cove: number }`, `NO_WATER_GROUND`, `BED_PAINT_TOP = 0.05`, `BED_PAINT_FULL = 0.2`, `waterGroundAt(seed: number, x: number, z: number, h: number): WaterGround`; `classifySurface(seed, x, z, altitude, slope, canopy = 0, duff = 0, water: WaterGround = NO_WATER_GROUND)`.

Every term is guarded, so a vertex with no water, no marsh and no cove paints bit for bit as today. The lake's bed paints after the slope overlays, so the drop below the shelf reads as silt or stones rather than as rock.

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/waterGround.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { activeTerrainVariant, elevationAt, type LakeSource } from "../../src/sim/terrain.js";
import { lobePoints, marshWeightAt } from "../../src/sim/features.js";
import { TRAIL_Z_ANCHOR } from "../../src/sim/bowl.js";
import { firstPondWorld } from "../sim/helpers/lakes.js";
import { NO_WATER_GROUND, waterGroundAt } from "../../src/game/waterGround.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("waterGroundAt", { timeout: timeLimit(120_000) }, () => {
  const lakeOf = (seed: number): LakeSource =>
    activeTerrainVariant().waterBodies!(seed).find((b): b is LakeSource => b.kind === "lake")!;

  it("is nothing far from every lake and the cove", () => {
    const { seed, pond } = firstPondWorld();
    const x = pond.x + 400, z = pond.z + 400;
    expect(waterGroundAt(seed, x, z, elevationAt(seed, x, z))).toBe(NO_WATER_GROUND);
  });

  it("is the whole bed, with the lake's murk, in a lake's middle", () => {
    const { seed, pond } = firstPondWorld();
    const g = waterGroundAt(seed, pond.x, pond.z, elevationAt(seed, pond.x, pond.z));
    expect(g.bed).toBe(1);
    expect(g.murk).toBe(lakeOf(seed).murk);
    expect(g.cove).toBe(0);
  });

  it("is the marsh in a murky lake's marsh", () => {
    const { seed } = firstPondWorld((f) => (f.murk ?? 0) > 0.7);
    const lake = lakeOf(seed);
    const [x, z] = lobePoints(lake, 1).find(([px, pz]) => marshWeightAt(lake, px, pz) === 1)!;
    expect(waterGroundAt(seed, x, z, elevationAt(seed, x, z)).marsh).toBe(1);
  });

  it("is the cove on the beach in front of the pad", () => {
    const v = activeTerrainVariant();
    const seed = 0x5eed;
    const cx = v.roadCenterX!(seed, TRAIL_Z_ANCHOR);
    const x0 = cx - v.coastDistance!(seed, cx, TRAIL_Z_ANCHOR);
    expect(waterGroundAt(seed, x0 + 10, TRAIL_Z_ANCHOR, elevationAt(seed, x0 + 10, TRAIL_Z_ANCHOR)).cove).toBe(1);
  });
});
```

Append to `client/test/game/terrainSurface.test.ts` (import `NO_WATER_GROUND` from `../../src/game/waterGround.js`; `classifySurface` if not imported):

```ts
describe("the ground under and beside the water", () => {
  const at = (altitude: number, water = NO_WATER_GROUND, slope = 0) => classifySurface(7, 1234, 5678, altitude, slope, 0, 0, water);

  it("paints exactly as before with no water", () => {
    for (const alt of [-3, 0.2, 2, 20, 120]) {
      for (const slope of [0, 0.5, 1.2]) {
        expect(classifySurface(7, 1234, 5678, alt, slope, 0.3, 0.2, NO_WATER_GROUND)).toEqual(classifySurface(7, 1234, 5678, alt, slope, 0.3, 0.2));
      }
    }
  });

  it("paints a murky lake's bed as the floor's silt and a clear one's as stones, over any slope", () => {
    const murky = at(100, { bed: 1, murk: 1, marsh: 0, cove: 0 }, 1.2);
    expect(murky.weights.forestFloor).toBeCloseTo(1, 9);
    expect(murky.weights.rock).toBeCloseTo(0, 9);
    const clear = at(100, { bed: 1, murk: 0, marsh: 0, cove: 0 }, 1.2);
    expect(clear.weights.pebble).toBeCloseTo(1, 9);
    expect(clear.albedo.r).toBeGreaterThan(murky.albedo.r);
  });

  it("paints the marsh as mud", () => {
    const m = at(100, { bed: 0, murk: 1, marsh: 1, cove: 0 });
    expect(m.weights.forestFloor).toBeCloseTo(1, 9);
  });

  it("paints the cove's berm and face as pebbles and its bed as sand", () => {
    const berm = at(2, { bed: 0, murk: 0, marsh: 0, cove: 1 });
    expect(berm.weights.pebble).toBeCloseTo(1, 9);
    const bed = at(-3, { bed: 0, murk: 0, marsh: 0, cove: 1 });
    expect(bed.weights.sand).toBeCloseTo(1, 9);
  });
});
```

Append to `client/test/sim/clutter.test.ts` (import `CLUTTER_DRIFTWOOD` from `clutter.js` and `ROAD_CORRIDOR_HALF` from `road.js`):

```ts
describe("driftwood in the cove", () => {
  it("lies on the backshore up to the road's corridor, past the beach's own reach", () => {
    const v = activeTerrainVariant();
    let found = 0;
    for (const seed of [0x5eed, 1, 12345, 777, 4242]) {
      const cx = v.roadCenterX!(seed, 0);
      const x0 = cx - v.coastDistance!(seed, cx, 0);
      for (let d = 41; x0 + d <= cx - ROAD_CORRIDOR_HALF - 6; d += 1) {
        found++;
        expect(clutterDensity(seed, CLUTTER_DRIFTWOOD, x0 + d, 0), `seed ${seed} d ${d}`).toBeGreaterThan(0);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/game/waterGround.test.ts test/game/terrainSurface.test.ts test/sim/clutter.test.ts`
Expected: FAIL: `waterGround.ts` does not exist; `classifySurface` ignores an eighth argument; no driftwood past 40 m.

- [ ] **Step 3: Implement**

Create `client/src/game/waterGround.ts`:

```ts
// client/src/game/waterGround.ts
/**
 * What the ground paint needs from the water at a point: how far under a lake
 * it lies (`bed`), that lake's murk, the marsh's weight and the cove's. Pure
 * and Babylon-free: `clipmap.ts` asks it per vertex beside `groundCover`.
 */
import { marshWeightAt } from "../sim/features.js";
import { activeTerrainVariant } from "../sim/terrain.js";

export type WaterGround = { bed: number; murk: number; marsh: number; cove: number };
export const NO_WATER_GROUND: WaterGround = Object.freeze({ bed: 0, murk: 0, marsh: 0, cove: 0 });

/** The bed's paint comes in from this far above a lake's waterline (m)… */
export const BED_PAINT_TOP = 0.05;
/** …and is whole from this far below it. */
export const BED_PAINT_FULL = 0.2;

export function waterGroundAt(seed: number, x: number, z: number, h: number): WaterGround {
  const variant = activeTerrainVariant();
  const cove = variant.coveMask?.(seed, x, z) ?? 0;
  let bed = 0;
  let murk = 0;
  let marsh = 0;
  const bodies = variant.waterBodies?.(seed);
  if (bodies !== undefined) {
    for (const b of bodies) {
      if (b.kind !== "lake") continue;
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz >= b.radius * b.radius) continue;
      const t = Math.min(1, Math.max(0, (b.level - h + BED_PAINT_TOP) / (BED_PAINT_FULL + BED_PAINT_TOP)));
      bed = t * t * (3 - 2 * t);
      murk = b.murk;
      marsh = marshWeightAt(b, x, z);
    }
  }
  return cove === 0 && bed === 0 && marsh === 0 ? NO_WATER_GROUND : { bed, murk, marsh, cove };
}
```

In `client/src/game/terrainSurface.ts`, import `NO_WATER_GROUND, type WaterGround` from `./waterGround.js`, and add to the palette after `DRY_SAND`:

```ts
/** The cove: its wet pebbles in the swash, dry above COVE_WET_TOP (m). */
const PEBBLE_WET: Rgb = { r: 0.26, g: 0.24, b: 0.21 };
const COVE_WET_TOP = 1.5;
/** A lake's bed: silt under murky water, with dark patches of sunken wood
 * where a seeded noise is high; stones under clear. The marsh is mud. */
const SILT: Rgb = { r: 0.16, g: 0.13, b: 0.09 };
const SUNKEN_WOOD: Rgb = { r: 0.05, g: 0.04, b: 0.03 };
const LAKE_STONES: Rgb = { r: 0.3, g: 0.28, b: 0.24 };
const MUD: Rgb = { r: 0.1, g: 0.08, b: 0.055 };
const LAKE_WOOD_WAVE = 3;
const LAKE_WOOD_LO = 0.62;
const LAKE_WOOD_HI = 0.72;
const LAKE_WOOD_SALT = 0x3d0d;
```

(`PEBBLE` and `W_*` are declared further down the file; move these constants below `W_PEBBLE` if the linter reports a use before definition.)

Change `classifySurface`'s signature to add `water: WaterGround = NO_WATER_GROUND,` after `duff = 0,`, and document it in the function's comment: "`water` is what the lake, its marsh and the cove make of the ground here (`waterGround.ts`); its default leaves every value bitwise unchanged." Then:

- Change `const coastal = …` and `const wCoastal = …` to `let`, and insert after them, before `// Inland of the trailhead's pad …`:

```ts
  // The cove: pebbles on its berm and face down through the waterline, wet in
  // the swash, and the sand bed below the water.
  if (water.cove > 0) {
    const above = smoothstep(-0.4, 0.1, altitude);
    const beach = mixRgb(WET_SAND, mixRgb(PEBBLE_WET, PEBBLE, smoothstep(0, COVE_WET_TOP, altitude)), above);
    coastal = mixRgb(coastal, beach, water.cove);
    wCoastal = mixW(wCoastal, mixW(W_SAND, W_PEBBLE, above), water.cove);
  }
```

- Insert after the scree line (`w = mixW(w, W_ROCK, smoothstep(ROCK_SLOPE, SCREE_SLOPE, slope)); // scree is the rock layer`) and before `const above = altitude - snowLineAt(…)`:

```ts
  // A lake's bed and its marsh, over whatever the slope made of the ground
  // (the drop below the shelf would otherwise paint as rock).
  if (water.bed > 0 || water.marsh > 0) {
    const wood = smoothstep(LAKE_WOOD_LO, LAKE_WOOD_HI, valueNoise2(x / LAKE_WOOD_WAVE, z / LAKE_WOOD_WAVE, seed ^ LAKE_WOOD_SALT));
    const bedColour = mixRgb(mixRgb(LAKE_STONES, PEBBLE, ground), mixRgb(SILT, SUNKEN_WOOD, wood), water.murk);
    colour = mixRgb(colour, bedColour, water.bed);
    w = mixW(w, mixW(W_PEBBLE, W_FLOOR, water.murk), water.bed);
    colour = mixRgb(colour, MUD, water.marsh);
    w = mixW(w, W_FLOOR, water.marsh);
  }
```

(The snow line's local is named `above` already; the cove block's `above` is inside its own `if` block, so the two do not collide.)

In `client/src/game/clipmap.ts`, import `waterGroundAt` from `./waterGround.js` and change the call to:

```ts
  const { albedo, weights } = classifySurface(
    seed, x, z, s.h, Math.hypot(s.dx, s.dz), canopy, duff, waterGroundAt(seed, x, z, s.h),
  );
```

In `client/test/architecture.test.ts`, add `join(SRC, "game", "waterGround.ts"),` to `BABYLON_FREE_FILES` in "the pure game/ arithmetic modules stay Babylon-free", after the `terrainSurface.ts` line.

In `client/src/sim/clutter.ts`, change the driftwood case to:

```ts
    case CLUTTER_DRIFTWOOD: {
      // The cove's backshore holds drift logs up to the road's corridor, past
      // the beach's own reach inland; everywhere else is as before.
      const cove = variant.coveMask?.(seed, x, z) ?? 0;
      if (c > CLUTTER_DRIFT_INLAND + CLUTTER_DRIFT_INLAND_FADE && cove === 0) return 0;
      const alt =
        smoothstep(CLUTTER_DRIFT_ALT_LO, CLUTTER_DRIFT_ALT_LO + CLUTTER_DRIFT_ALT_LO_FADE, s.h) *
        (1 - smoothstep(CLUTTER_DRIFT_ALT_HI, CLUTTER_DRIFT_ALT_HI + CLUTTER_DRIFT_ALT_HI_FADE, s.h));
      const inland = 1 - smoothstep(CLUTTER_DRIFT_INLAND, CLUTTER_DRIFT_INLAND + CLUTTER_DRIFT_INLAND_FADE, c);
      return alt * Math.max(inland, cove);
    }
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/waterGround.test.ts test/game/terrainSurface.test.ts test/game/clipmap.test.ts test/sim/clutter.test.ts test/architecture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/waterGround.ts client/src/game/terrainSurface.ts client/src/game/clipmap.ts client/src/sim/clutter.ts client/test/game/waterGround.test.ts client/test/game/terrainSurface.test.ts client/test/sim/clutter.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: silt, stones and mud under the lakes, pebbles and logs in the cove

## What

A murky lake's bed paints as silt with dark patches of sunken wood, a clear
lake's as stones, and the marsh as mud, down the drop as well as on the
shelf. The cove's berm and face paint as pebbles, wet in the swash, over a
sand bed, and drift logs lie on its backshore up to the road's corridor.
Everywhere else the ground paints exactly as before.

## How

- `client/src/game/waterGround.ts` — `waterGroundAt`, what the paint needs
  from the water at a point.
- `client/src/game/terrainSurface.ts` — the cove's and the lake's terms in
  `classifySurface`, each guarded so no water leaves every value unchanged.
- `client/src/game/clipmap.ts` — passes it per vertex.
- `client/src/sim/clutter.ts` — driftwood reaches the cove's backshore.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

---

### Task 11: The release: the whole suite, the moved pins, the architecture note

**Files:**
- Modify: `ARCHITECTURE.md` (the Determinism section, after the trailhead's paragraph; the Rendering section's water paragraph)
- Modify: whichever pinned values the whole suite shows moved by the new level id (expected: `client/test/game/tierDeterminism.test.ts`'s `passHash`)

**Interfaces:**
- Consumes: everything above.
- Produces: a branch whose typecheck, lint and three test suites pass.

- [ ] **Step 1: Write the architecture note**

In `ARCHITECTURE.md`, after the Determinism section's paragraph that begins "At the trailhead the forest comes down to the road", add:

```markdown
The water's ground is the sim's too. The trail's pond is a lake whose murk follows where it lies on the climb from the pad to the crest, with a shore shelf, a drop to a middle as deep as its water is clear, and on a murky lake a marsh on the shelf at one end, its ground held at the water's level (`client/src/sim/features.ts`). The lake is applied to the composed field only, after the bowl is built, so nothing the build places can move, and a wall at the shelf's edge keeps a wading player's camera above the water (`containment.ts`). The shore in front of the pad is a pebble cove between two headlands, seaward of the road's corridor only (`olympic.ts`). The variant lists its water (`waterBodies`: the sea, then each lake) and the cove's weight (`coveMask`) for the renderer, the clutter, the ground paint and the wading.
```

In the Rendering section's water paragraph, change "on a body's row (`mat_water_sea`, `mat_water_lake`)" to "on a body's row (`mat_water_sea`, and `mat_water_lake_<i>` on the row a lake's murk gives, `lakeWaterRow`)", and append to the paragraph:

```markdown
A murky lake carries a skin of duckweed and algae in the same plugin, laid from its depth, its murk and a seeded noise, and its reeds, cattails and pond-lilies are built in code and drawn by `waterPlants.ts` from the sim's clutter classes.
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean. Fix anything they report in the file that introduced it, and commit the fix with the task it belongs to in the subject (`fix: …`).

- [ ] **Step 3: The whole suite, on a quiet machine**

First check nothing else is running a suite or a browser gate: `pgrep -fl vitest` prints nothing and the 1-minute load average (`sysctl -n vm.loadavg`) is under 2.5. Then:

Run: `npm test`
Expected: PASS apart from pins that encode the world. For each failing test, read what it pins. A pin moves by design when its world reads anything this release changed (a feature's fields, the lake's or the cove's ground, the new clutter classes, or the tunables that fold into the level id); `tierDeterminism`'s `passHash` is expected to be one. Update such a pin to the value the test now reports, and note old and new values in the commit. Any other failure is a defect: fix it in the file that introduced it.

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md client/test/game/tierDeterminism.test.ts
git commit -F - <<'EOF'
docs: the water's ground in the architecture note, and the moved pins

## What

The architecture note says where the lake, its marsh and wall, and the cove
live, and that the water is drawn by each lake's murk with its skin and
plants. The pins that encode the world move with the level id, as this
release means them to.

## How

- `ARCHITECTURE.md` — a Determinism paragraph for the water's ground; the
  Rendering section's water paragraph names the lake's row, skin and plants.
- `client/test/game/tierDeterminism.test.ts` — `passHash` from <old> to <new>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TcpRkLqxXeFire9EG97s8
EOF
```

(Write the real old and new values in place of `<old>` and `<new>`, and list every other pin that moved the same way, with its file.)

---

### Task 12: The gates in the browser (the controller's, not a subagent's)

**Files:**
- Modify: `client/shaders/corpus/` (recorded files only, through `tools/wgsl/merge-corpus.mjs`)
- Modify: `tools/wgsl/test/corpusFiles.test.mjs` (the stage count and the em-dash count)
- Modify: `docs/rendering/2026-09-30-water-terrain-design.md` (§8: the gates' results)

**Interfaces:**
- Consumes: the finished branch.
- Produces: the corpus with the release's stages, the look gates passed on the owner's word, the cost measured and reported. Merging and deploying stay the owner's call.

These steps drive the real game and need the machine: the controller runs them itself, one at a time, following the browser-verification recipe (its own ports, its own Chrome profile, headed Chrome, a silent machine for timings).

- [ ] **Step 1: Find the gate worlds**

With a scratch script outside the repository (never committed), list the lobby rooms whose lake is murky (murk ≥ 0.8), and clear (murk ≤ 0.2), with each lake's centre, radius, level and marsh direction: for `i` from 0 to 199, `seed = seedFromToken(\`room-${i}\`)`, the lake is `activeTerrainVariant().waterBodies!(seed)`'s `kind: "lake"` entry. Take the first of each, and the pad of the murky one's world for the cove.

- [ ] **Step 2: Record the shader corpus**

For each gate world, at noon and at night (the sun pinned per reading), load the dev build with `?wgsl=record` and visit, each several times (a variant can show on one visit in three): the pad looking out to sea over the cove; the murky lake from across its water with the marsh, the reeds and the lilies in view; the clear lake's shelf from its shore. Download each page's recording and merge it: `node tools/wgsl/merge-corpus.mjs <recording.json>`. Update the two literals in `tools/wgsl/test/corpusFiles.test.mjs` (the stage count and the count of stages whose text holds an em dash) to what the merged corpus holds, then run `npx vitest run --root tools wgsl/test` and `node tools/wgsl/check-build.mjs` after `npm run build`. Commit the corpus and the test as `feat: add the lakes' and the cove's stages to the corpus`.

- [ ] **Step 3: The look gates**

At each pose, the sun pinned, take a still and set it beside the reference photos by id:

| Gate | Pose | Reference |
| --- | --- | --- |
| The cove | from the pad, looking out | `rialto-03`, `ruby-05` |
| A murky lake | across it, the marsh and the lilies in view | `ozette-08`, `lily-pond-08`, `duckweed-11` |
| A clear high lake | a shallow bed in view | `crescent-04`, `crescent-13` |

Show the owner the stills. A gate passes on the owner's word; a gate the owner turns back becomes a fix task with its own test, then the still again.

- [ ] **Step 4: The cost**

Measured as the water material's was (its spec's §8): a control build of `origin/main` in a detached worktree beside this branch's build, a silent machine, 3840×2160 (hardware scaling 0.5, where every tier is fragment-bound), paired readings in the order off, on, on, off, at the two worst poses (close to the murky lake with its reeds and skin in view; the cove from the pad). Report the cost added over `main` on each tier, scaled to its pixels, for the owner to judge. No bar is set in advance.

- [ ] **Step 5: Record the gates in the spec**

In `docs/rendering/2026-09-30-water-terrain-design.md` §8, add under the look gates' table what each gate showed and the owner's word, and under the cost paragraph the measured table (tier, main, branch, added). Commit as `docs: the water terrain's gates as passed`. Then stop and ask the owner about merging and deploying.
