# The Trail as a Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hiking trail from a flat 3 m gravel band with a ruled edge into a walked footpath: a sunk tread in the sim, litter along its margin, and a paint of four bands that varies along its length, breaks its edge, bends at the lip and goes wet in rain.

**Architecture:** The sim narrows the flat bench to 0.75 m half-width and sinks it 6 cm after the corridor blend, and gains a ninth clutter class (litter) — the one level-id release. The paint keeps its per-fragment nearest-segment search and adds a second table row for the along-trail parameter and junction widths; a Babylon-free params file mirrors every band, wear and trample function for the tests and the clutter rebuild; the clutter rebuild tramples the cards beside the bed.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`MaterialPluginBase`, thin instances, `RawTexture` float tables), WebGL2 GLSL in template literals, vitest with `NullEngine`.

**Spec:** `docs/rendering/2026-09-16-trail-bench-design.md`

## Global Constraints

- No renderer constant migrates into `sim/`; the renderer may import sim constants (`TRAIL_BED_HALF`, `TRAIL_SINK`, `TRAIL_SINK_RAMP`), never the reverse. `sim/` code uses no trig or `Math.pow` in per-cell paths (the clutter file's own determinism rule).
- The level id moves only through `TRAIL_TUNABLES` and `CLUTTER_TUNABLES`; `GEN_VERSION` stays 5. Every new sim constant appears in the tunables map of its file.
- No new sampler on the terrain material: the second table row rides `trailSegs` (512 × 2). No new texture asset, no new model asset.
- GLSL: derivatives (`fwidth`, `dFdx`) only where they already are, in uniform control flow before the corridor branch; every uniform declared on BOTH the uniform-buffer list (`getUniforms().ubo`) and the non-UBO fragment declaration; no comment spelling a preprocessor directive; no semicolon inside a trailing comment on a GLSL code line; `TRAIL_FRAGMENT_PAINT` may call `latticeHash` and `macroValueNoise` from the hex include because `CUSTOM_FRAGMENT_DEFINITIONS` splices `TERRAIN_HEX_DEFS` before it.
- Constants, verbatim from the spec: `TRAIL_BED_HALF = 0.75`, `TRAIL_SINK = 0.06`, `TRAIL_SINK_RAMP = 0.5`, `CLUTTER_GRASS_TRAIL_NEAR = 0.75`, `CLUTTER_GRASS_TRAIL_FAR = 2.5`, litter band core 0.45 / margin to 0.9 / gone by 1.6 with `CLUTTER_LITTER_CORE = 0.15`, litter scale 0.25–0.6, `LITTER_VARIANT_SCALE = [1, 1, 0.3]`, `TRAIL_JUNCTION_W = 1.35`, wear wavelengths 12 and 3 with weights 0.6/0.4, `TRAIL_WEAR_W0/W1 = 0.8/1.25`, `TRAIL_WEAR_D0/D1 = 0.85/1.1`, `TRAIL_EDGE_NOISE = 0.25` with octaves 1.5 and 0.4 at 0.6/0.4, `TRAIL_HEIGHT_SHIFT = 0.3`, bands core < 0.45, margin < 0.75, trampled < 1.35, `TRAIL_CORE_GAIN = 0.45`, `TRAIL_CORE_TINT = (0.26, 0.22, 0.18)`, `TRAIL_MARGIN_GAIN = 0.85`, `TRAIL_MARGIN_TINT = (0.42, 0.37, 0.30)`, `TRAIL_TRAMPLE_TINT = (0.82, 0.78, 0.66)`, `TRAIL_PAINT_EDGE = 0.08`, `TRAIL_WET_DARK = 0.35`, `TRAIL_WET_GLOSS = 0.5`, puddle `smoothstep(0.55, 0.8, wet) · smoothstep(0.62, 0.75, 1 − noise2(xz / 6))`, `TRAMPLE_HEIGHT = 0.55`, `TRAMPLE_LEAN = 0.35`, `TRAMPLE_TINT = (0.85, 0.80, 0.65)`, trample band 0.75–1.6.
- Public repository: no code comment, doc or commit message mentions how an asset was made, the private design process, sessions, agents, reviews, screenshots or "the owner".
- Commit messages: type-prefixed subject under 72 chars, a `## What` paragraph, a `## How` list led by backticked paths, final line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage explicit paths only. Tests are run per file (`npx vitest run <file>`); the full suite is the controller's.
- Docs under `docs/` are named `YYYY-MM-DD-<topic>.md`; new docs here are dated 2026-09-16.

---

## File map

| File | Task | Change |
| --- | --- | --- |
| `client/src/sim/trail.ts` | 1 | `TRAIL_BED_HALF` 0.75; `TRAIL_SINK`, `TRAIL_SINK_RAMP`; `trailSinkD`; tunables. |
| `client/src/sim/olympic.ts` | 1 | Apply `trailSinkD` after `trailCorridorD`. |
| `client/test/sim/trailBed.test.ts` | 1 | The sink's shape, derivatives and union. |
| `client/src/sim/clutter.ts` | 2 | Grass gate retune; `CLUTTER_LITTER` class, density, constants, tunables. |
| `client/src/game/clutterField.ts` | 2 | `CLUTTER_RADII[8] = 40`. |
| `client/src/game/clutterMeshes.ts` | 2, 5 | Litter model row and `TILTED`; then `LITTER_VARIANT_SCALE` and the trampled band. |
| `client/test/sim/clutter.test.ts`, `client/test/sim/forest.test.ts` | 2 | Litter band, gate, tunables, the level id moves. |
| `client/src/game/groundHexParams.ts` | 3 | Export `valueNoise2(x, z, wave)`; `macroNoise` uses it. |
| `client/src/game/trailBenchParams.ts` (new) | 3 | Constants and mirrors: `trailWear`, `trailEdgeNoise`, `trailBands`, `trampleAt`. |
| `client/test/game/trailBenchParams.test.ts` (new), `client/test/architecture.test.ts` | 3 | Shapes; Babylon-free listing. |
| `client/src/game/trailPaint.ts` | 4 | Table row 2; retired constants; the new paint. |
| `client/src/game/terrainTexture.ts`, `client/src/game/renderer.ts` | 4 | 512 × 2 upload; `terrainWet` uniform and `setTerrainWetness`. |
| `client/test/game/trailPaint.test.ts`, `client/test/game/terrainTexture.test.ts` | 4 | Row 2, paint text, both-path declaration, compile. |
| `client/test/game/clutterMeshes.test.ts` | 5 | Trampled card, litter scales. |
| `ARCHITECTURE.md`, `docs/rendering/2026-09-16-trail-bench-verification.md` (new) | 6 | Note and verification. |

---

### Task 1: the bench in the sim

**Files:**
- Modify: `client/src/sim/trail.ts` (constants near line 59, `TRAIL_TUNABLES` at 82–86, a new function after `trailCorridorD`)
- Modify: `client/src/sim/olympic.ts:604-611` (the `inBowl` block that calls `trailCorridorD`)
- Test: `client/test/sim/trailBed.test.ts`

**Interfaces:**
- Consumes: `smootherstepD(edge0, edge1, x): { v, d }` (trail.ts:135), `TerrainSample { h, dx, dz }`, `TrailNode`, `TrailEdge`.
- Produces: `export const TRAIL_SINK = 0.06`, `export const TRAIL_SINK_RAMP = 0.5`, `export function trailSinkD(nodes, edges, x, z, sample: TerrainSample): TerrainSample`. Task 4 imports the two constants for the lip.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/trailBed.test.ts` (it already imports `bowlFor`, `elevationSampleAt`, `SEEDS`; add `TRAIL_BED_HALF, TRAIL_SINK, TRAIL_SINK_RAMP, TRAIL_TUNABLES, trailSinkD, trailCorridorD` from `../../src/sim/trail.js`):

```ts
describe("the bench sink", () => {
  const nodes = [{ x: 0, z: 0, h: 10, u: 0 }, { x: 100, z: 0, h: 10, u: 100 }, { x: 100, z: 100, h: 10, u: 200 }];
  const profile = new Float64Array(51).fill(10);
  const edges = [
    { a: 0, b: 1, kind: "stem" as const, profile, progress0: 0, progress1: 0.5 },
    { a: 1, b: 2, kind: "stem" as const, profile, progress0: 0.5, progress1: 1 },
  ];
  const flat = { h: 10, dx: 0, dz: 0 };
  it("sinks the centreline by TRAIL_SINK and returns the input past the ramp", () => {
    expect(trailSinkD(nodes, edges, 50, 0, flat).h).toBeCloseTo(10 - TRAIL_SINK, 9);
    expect(trailSinkD(nodes, edges, 50, TRAIL_BED_HALF, flat).h).toBeCloseTo(10 - TRAIL_SINK, 9);
    expect(trailSinkD(nodes, edges, 50, TRAIL_BED_HALF + TRAIL_SINK_RAMP, flat)).toEqual(flat);
    expect(trailSinkD(nodes, edges, 50, 3, flat)).toEqual(flat);
  });
  it("sinks once at a junction, never twice", () => {
    expect(trailSinkD(nodes, edges, 100, 0, flat).h).toBeCloseTo(10 - TRAIL_SINK, 9);
    expect(trailSinkD(nodes, edges, 99.9, 0.1, flat).h).toBeGreaterThanOrEqual(10 - TRAIL_SINK - 1e-9);
  });
  it("carries an analytic gradient that matches a central difference across the ramp", () => {
    const eps = 1e-4;
    for (const z of [0.5, 0.8, 1.0, 1.2]) {
      const s = trailSinkD(nodes, edges, 50, z, flat);
      const fd = (trailSinkD(nodes, edges, 50, z + eps, flat).h - trailSinkD(nodes, edges, 50, z - eps, flat).h) / (2 * eps);
      expect(s.dz).toBeCloseTo(fd, 6);
      expect(s.dx).toBeCloseTo(0, 9);
    }
  });
  it("is the level-id contract: both constants are tunables", () => {
    expect(TRAIL_TUNABLES.TRAIL_SINK).toBe(0.06);
    expect(TRAIL_TUNABLES.TRAIL_SINK_RAMP).toBe(0.5);
    expect(TRAIL_TUNABLES.TRAIL_BED_HALF).toBe(0.75);
  });
  it("lowers the composed ground on a real stem by the sink", () => {
    const seed = SEEDS[0]!;
    const bowl = bowlFor(seed);
    const e = bowl.graph.edges[bowl.graph.stem[0]!]!;
    const a = bowl.graph.nodes[e.a]!, b = bowl.graph.nodes[e.b]!;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const withSink = elevationSampleAt(seed, mx, mz).h;
    const corridor = trailCorridorD(bowl.graph.nodes, bowl.graph.edges, mx, mz, olympicPreTrailSample(seed, mx, mz)).h;
    expect(corridor - withSink).toBeCloseTo(TRAIL_SINK, 6);
  });
});
```

If `olympicPreTrailSample` does not compose the feature stage the way `olympicSample` does (compare `olympic.ts:561-614`), replace the last test's `corridor` with the value `olympicSample` gave before this task at the same point, computed by temporarily calling the exported pre-trail sample plus `featureStageD(bowl.features, mx, mz, …)` exactly as `olympicSample` does; the assertion stays `corridor − withSink ≈ TRAIL_SINK`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/sim/trailBed.test.ts`
Expected: FAIL — `trailSinkD` is not exported; `TRAIL_TUNABLES.TRAIL_SINK` is undefined.

- [ ] **Step 3: Implement**

In `client/src/sim/trail.ts`, change `export const TRAIL_BED_HALF = 1;` to `export const TRAIL_BED_HALF = 0.75;` and update its comment: the flat bench is a 0.9 m compacted core plus a 0.3 m loose margin each side. Add after `TRAIL_CORRIDOR_HALF`:

```ts
/** The bench sits this far (m) below the corridor's blended bed, ramping
 * back up over TRAIL_SINK_RAMP past TRAIL_BED_HALF: a walked footpath is
 * sunk a few centimetres into the turf, and on a side-hill the uphill half
 * of the ramp is its short soil face. Applied after the corridor blend
 * (trailSinkD), as a saturating union across edges so a junction sinks once. */
export const TRAIL_SINK = 0.06;
export const TRAIL_SINK_RAMP = 0.5;
```

Add both to `TRAIL_TUNABLES` (after `TRAIL_CORRIDOR_HALF`). Add after `trailCorridorD`:

```ts
/**
 * The bench sink: TRAIL_SINK inside TRAIL_BED_HALF of any edge, ramping to
 * zero over TRAIL_SINK_RAMP, as a saturating union across edges (a junction
 * sinks once). Same analytic derivatives as the corridor: ∇d = q/d, and
 * smootherstepD's own slope. Returns the sample untouched outside every ramp.
 */
export function trailSinkD(
  nodes: readonly TrailNode[],
  edges: readonly TrailEdge[],
  x: number,
  z: number,
  sample: TerrainSample,
): TerrainSample {
  const outer = TRAIL_BED_HALF + TRAIL_SINK_RAMP;
  let prod = 1, prodDx = 0, prodDz = 0;
  for (const e of edges) {
    const a = nodes[e.a] as TrailNode;
    const b = nodes[e.b] as TrailNode;
    if (x < Math.min(a.x, b.x) - outer || x > Math.max(a.x, b.x) + outer) continue;
    if (z < Math.min(a.z, b.z) - outer || z > Math.max(a.z, b.z) + outer) continue;
    const ex = b.x - a.x, ez = b.z - a.z;
    const L2 = ex * ex + ez * ez;
    if (L2 === 0) continue;
    const px = x - a.x, pz = z - a.z;
    const t = Math.min(1, Math.max(0, (px * ex + pz * ez) / L2));
    const qx = px - t * ex, qz = pz - t * ez;
    const d = Math.sqrt(qx * qx + qz * qz);
    if (d >= outer) continue;
    const r = smootherstepD(TRAIL_BED_HALF, outer, d);
    const s = 1 - r.v;
    const dDx = d > 1e-9 ? qx / d : 0, dDz = d > 1e-9 ? qz / d : 0;
    const sDx = -r.d * dDx, sDz = -r.d * dDz;
    prodDx = prodDx * (1 - s) - prod * sDx;
    prodDz = prodDz * (1 - s) - prod * sDz;
    prod *= 1 - s;
  }
  if (prod === 1) return sample;
  const S = 1 - prod, SDx = -prodDx, SDz = -prodDz;
  return {
    h: sample.h - TRAIL_SINK * S,
    dx: sample.dx - TRAIL_SINK * SDx,
    dz: sample.dz - TRAIL_SINK * SDz,
  };
}
```

In `client/src/sim/olympic.ts`, import `trailSinkD` beside `trailCorridorD` and change the bowl block to:

```ts
  if (inBowl(u, z)) {
    staged = trailCorridorD(bowl.graph.nodes, bowl.graph.edges, x, z, staged);
    staged = trailSinkD(bowl.graph.nodes, bowl.graph.edges, x, z, staged);
  }
```

Leave `trailBuild.ts:1364`'s `composedMaxSlope` call alone: the route check runs on centrelines where the sink is a constant offset.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/test/sim/trailBed.test.ts client/test/sim/trail.test.ts client/test/sim/trailWalk.test.ts client/test/sim/trailSystem.test.ts client/test/sim/trailBuild.test.ts`
Expected: PASS. The walk scans stay green (the fine check runs at d = 0). If `trailBed.test.ts`'s "is FLUSH" test measures bed-to-ground at p95 over half a metre, 6 cm is inside it. If any test pins `TRAIL_BED_HALF === 1` or a width derived from it, update the pinned value to 0.75 and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/trail.ts client/src/sim/olympic.ts client/test/sim/trailBed.test.ts
git commit  # subject: feat: sink the trail bench and narrow it to a footpath
```

---

### Task 2: the grass gate and the litter class

**Files:**
- Modify: `client/src/sim/clutter.ts` (class ids 16–28, gate constants 70–73, `CLASSES` 349–356, `clutterDensity` switch ~404–520, `CLUTTER_TUNABLES` 611–650)
- Modify: `client/src/game/clutterField.ts:63` (`CLUTTER_RADII`)
- Modify: `client/src/game/clutterMeshes.ts:92-101` (`CLUTTER_MODEL_URLS`), `:133` (`TILTED`)
- Test: `client/test/sim/clutter.test.ts`, `client/test/sim/forest.test.ts`

**Interfaces:**
- Consumes: `grassTrailGate(rt)`, `smoothstep`, `hash3`, `activeTerrainVariant().trailDistance`.
- Produces: `export const CLUTTER_LITTER = 8`, `CLUTTER_CLASS_COUNT = 9`, `export function litterBand(rt: number): number`, constants `CLUTTER_LITTER_CELL = 1`, `CLUTTER_LITTER_D = 0.6`, `CLUTTER_LITTER_CORE = 0.15`, `CLUTTER_LITTER_MARGIN_LO = 0.45`, `CLUTTER_LITTER_MARGIN_HI = 0.9`, `CLUTTER_LITTER_FADE = 1.6`, `CLUTTER_LITTER_SCALE_MIN = 0.25`, `CLUTTER_LITTER_SCALE_MAX = 0.6`, `CLUTTER_LITTER_SALT = 0x1177`. Task 5 reads the class id and the variants (3).

- [ ] **Step 1: Write the failing tests**

In `client/test/sim/clutter.test.ts` add (imports: `CLUTTER_LITTER, CLUTTER_CLASS_COUNT, CLUTTER_GRASS_TRAIL_NEAR, CLUTTER_GRASS_TRAIL_FAR, CLUTTER_LITTER_CORE, CLUTTER_LITTER_FADE, CLUTTER_TUNABLES, litterBand, grassTrailGate, clutterInRect` from `../../src/sim/clutter.js`):

```ts
describe("the litter class", () => {
  it("follows its band of the trail distance", () => {
    expect(litterBand(0)).toBe(CLUTTER_LITTER_CORE);
    expect(litterBand(0.44)).toBe(CLUTTER_LITTER_CORE);
    expect(litterBand(0.5)).toBe(1);
    expect(litterBand(0.89)).toBe(1);
    expect(litterBand(1.25)).toBeGreaterThan(0);
    expect(litterBand(1.25)).toBeLessThan(1);
    expect(litterBand(CLUTTER_LITTER_FADE)).toBe(0);
    expect(litterBand(Infinity)).toBe(0);
  });
  it("is the ninth class with three variants and no instance farther than the fade", () => {
    expect(CLUTTER_LITTER).toBe(8);
    expect(CLUTTER_CLASS_COUNT).toBe(9);
    const seed = 1234;
    const insts = clutterInRect(seed, CLUTTER_LITTER, -600, -600, 600, 600);
    expect(insts.length).toBeGreaterThan(0);
    const rt = (x: number, z: number) => activeTerrainVariant().trailDistance!(seed, x, z);
    for (const i of insts) {
      expect(rt(i.x, i.z)).toBeLessThan(CLUTTER_LITTER_FADE + 0.001);
      expect(i.variant).toBeGreaterThanOrEqual(0);
      expect(i.variant).toBeLessThan(3);
    }
  });
  it("tightens the grass gate to the bench edge", () => {
    expect(CLUTTER_GRASS_TRAIL_NEAR).toBe(0.75);
    expect(CLUTTER_GRASS_TRAIL_FAR).toBe(2.5);
    expect(grassTrailGate(0.75)).toBe(0);
    expect(grassTrailGate(2.5)).toBe(1);
  });
});
```

Import `activeTerrainVariant` from `../../src/sim/terrain.js` if the file does not already. The existing "declares every exported CLUTTER_ constant in CLUTTER_TUNABLES" test covers the new constants once they exist; the existing "extends the class-range sweep to bushes (CLUTTER_CLASS_COUNT = 8)" test: change its pinned 8 to 9 and its name to say the litter class. The existing trail-bed grass test ("keeps grass, meadow and flowers off the trail bed, and lets them back past the bank") pins distances: update any that assumed NEAR 2 / FAR 5 to 0.75 / 2.5.

In `client/test/sim/forest.test.ts` add inside `describe("createForest")`:

```ts
  it("moved its level id with the trail bench release", () => {
    // The id before the bench: TRAIL_BED_HALF 1, no sink, eight clutter classes.
    // Pinned so a future retune cannot slide back to it unnoticed.
    expect(createForest(1234).levelId).not.toBe(PRE_BENCH_LEVEL_ID_1234);
  });
```

with `const PRE_BENCH_LEVEL_ID_1234 = "<the string createForest(1234).levelId returns on the branch base 71957f9>"` at the top of the file — obtain it by running `npx vitest run client/test/sim/forest.test.ts` with a temporary `console.log` before Task 1's commits are applied (e.g. `git stash`-free: `git show 71957f9:client/src/sim/trail.ts` is not needed; simply check the value once with `git checkout 71957f9 -- client/src/sim/trail.ts client/src/sim/olympic.ts client/src/sim/clutter.ts`, run, record, then `git checkout HEAD -- client/src/sim/trail.ts client/src/sim/olympic.ts client/src/sim/clutter.ts`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/sim/clutter.test.ts client/test/sim/forest.test.ts`
Expected: FAIL — `CLUTTER_LITTER` undefined, `litterBand` not exported, `CLUTTER_CLASS_COUNT` is 8, the gate constants are 2 and 5.

- [ ] **Step 3: Implement**

`client/src/sim/clutter.ts`:

```ts
/** Litter: pebbles, twigs and torn turf along the trail's loose margin. */
export const CLUTTER_LITTER = 8;
export const CLUTTER_CLASS_COUNT = 9;
```

Gate retune (replace the two constants and their comment):

```ts
/** Grass (and every class sharing its gate) is 0 over the bench — the
 * 0.9 m core plus its 0.3 m loose margin (TRAIL_BED_HALF = 0.75) — and returns
 * over [NEAR, FAR] of trailDistance (m): thin through the band the renderer
 * tramples, full from 2.5 m. Rocks and boulders are NOT gated: a stone on
 * the bench reads as a stone in the path. */
export const CLUTTER_GRASS_TRAIL_NEAR = 0.75;
export const CLUTTER_GRASS_TRAIL_FAR = 2.5;
```

Litter constants (beside the flower block):

```ts
/** Litter lives on a 1 m cell along the trail: a few proud stones on the
 * compacted core, the most over the loose margin and its lip, gone by
 * CLUTTER_LITTER_FADE. D = 0.6 puts about one piece per 1.5 m per side on
 * the margin (presence = min(1, band · 1 · D) per cell). */
export const CLUTTER_LITTER_CELL = 1;
export const CLUTTER_LITTER_D = 0.6;
export const CLUTTER_LITTER_CORE = 0.15;
export const CLUTTER_LITTER_MARGIN_LO = 0.45;
export const CLUTTER_LITTER_MARGIN_HI = 0.9;
export const CLUTTER_LITTER_FADE = 1.6;
/** Of the model's own unit: rock_a/rock_b at this scale are pebbles; the
 * renderer scales the driftwood variant further to twig size. */
export const CLUTTER_LITTER_SCALE_MIN = 0.25;
export const CLUTTER_LITTER_SCALE_MAX = 0.6;
export const CLUTTER_LITTER_SALT = 0x1177;

/** The litter density's band of the trail distance, pure. */
export function litterBand(rt: number): number {
  if (rt < CLUTTER_LITTER_MARGIN_LO) return CLUTTER_LITTER_CORE;
  if (rt < CLUTTER_LITTER_MARGIN_HI) return 1;
  return 1 - smoothstep(CLUTTER_LITTER_MARGIN_HI, CLUTTER_LITTER_FADE, rt);
}
```

`CLASSES` gains a ninth row:

```ts
  { cell: CLUTTER_LITTER_CELL, density: CLUTTER_LITTER_D, salt: CLUTTER_LITTER_SALT, scaleMin: CLUTTER_LITTER_SCALE_MIN, scaleMax: CLUTTER_LITTER_SCALE_MAX, variants: 3, trailClear: 0 },
```

`clutterDensity` gains a case (below the snow line only, like grass's upper altitude gate; no road, canopy or slope gates — a path is walked wherever it goes):

```ts
    case CLUTTER_LITTER: {
      const band = litterBand(rt);
      if (band === 0) return 0;
      const snow = 1 - smoothstep(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h);
      return band * snow;
    }
```

`CLUTTER_TUNABLES` gains every `CLUTTER_LITTER_*` constant. The class-count comment at the top of `clutterField.ts` and `clutterMeshes.ts`'s model-table comment list the ninth class.

`client/src/game/clutterField.ts:63`: `export const CLUTTER_RADII: readonly number[] = [110, 110, 400, 110, 70, 110, 40, 50, 40];` with a comment line: litter is pebble-sized, nothing that small reads past 40 m.

`client/src/game/clutterMeshes.ts`: `CLUTTER_MODEL_URLS` gains `[modelUrl("models/clutter.rock_a.glb"), modelUrl("models/clutter.rock_b.glb"), modelUrl("models/clutter.driftwood.glb")]` as its ninth row (the model-loading code keys on this table, so the three URLs are loaded once each — if the loader caches by URL nothing changes; if it loads per row, note the duplicate load in the report and leave it: Task 5 does not change it). `TILTED` gains `CLUTTER_LITTER`. Any per-class array or budget table indexed by class id in `clutterField.ts` (the instance budget list under `CLUTTER_RADII`) gets a ninth entry; grep `CLUTTER_CLASS_COUNT` and every `[110,` style literal to find them all, and say in the report which you touched.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/test/sim/clutter.test.ts client/test/sim/forest.test.ts client/test/game/clutterField.test.ts client/test/game/clutterMeshes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/clutter.ts client/src/game/clutterField.ts client/src/game/clutterMeshes.ts client/test/sim/clutter.test.ts client/test/sim/forest.test.ts
git commit  # subject: feat: litter along the trail's margin and grass to the bench edge
```

---

### Task 3: `trailBenchParams.ts`, the Babylon-free mirrors

**Files:**
- Modify: `client/src/game/groundHexParams.ts:125-129` (`macroNoise`)
- Create: `client/src/game/trailBenchParams.ts`
- Test: `client/test/game/trailBenchParams.test.ts` (new), `client/test/game/groundHexParams.test.ts`, `client/test/architecture.test.ts:105-127`

**Interfaces:**
- Consumes: `latticeHash(ci, cj)` from `groundHexParams.ts`.
- Produces: `valueNoise2(x, z, wave)` in `groundHexParams.ts` (mirrors the GLSL `macroValueNoise(p, wave)` token for token); in `trailBenchParams.ts`: every constant in Global Constraints, `valueNoise1(u, wave)`, `trailWear(u)`, `trailEdgeNoise(x, z)`, `trailBands(dB): { core, margin, trample }`, `trampleAt(rt): { height, lean, tint: Rgb }`. Task 4 prints the constants into the GLSL and the tests pin them; Task 5 calls `trampleAt`.

- [ ] **Step 1: Write the failing tests**

`client/test/game/trailBenchParams.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { valueNoise2, macroNoise, MACRO_WAVE, MACRO_WEIGHT } from "../../src/game/groundHexParams.js";
import {
  TRAIL_JUNCTION_W, TRAIL_WEAR_WAVE, TRAIL_WEAR_WEIGHT, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1,
  TRAIL_EDGE_NOISE, TRAIL_EDGE_WAVE, TRAIL_EDGE_WEIGHT, TRAIL_HEIGHT_SHIFT,
  TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE,
  TRAIL_CORE_GAIN, TRAIL_CORE_TINT, TRAIL_MARGIN_GAIN, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT,
  TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_PUDDLE_WET, TRAIL_PUDDLE_LOW, TRAIL_PUDDLE_WAVE,
  TRAMPLE_HEIGHT, TRAMPLE_LEAN, TRAMPLE_TINT, TRAMPLE_BAND,
  valueNoise1, trailWear, trailEdgeNoise, trailBands, trampleAt,
} from "../../src/game/trailBenchParams.js";

describe("constants", () => {
  it("are the spec's values", () => {
    expect(TRAIL_JUNCTION_W).toBe(1.35);
    expect(TRAIL_WEAR_WAVE).toEqual([12, 3]); expect(TRAIL_WEAR_WEIGHT).toEqual([0.6, 0.4]);
    expect([TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1]).toEqual([0.8, 1.25, 0.85, 1.1]);
    expect(TRAIL_EDGE_NOISE).toBe(0.25); expect(TRAIL_EDGE_WAVE).toEqual([1.5, 0.4]); expect(TRAIL_EDGE_WEIGHT).toEqual([0.6, 0.4]);
    expect(TRAIL_HEIGHT_SHIFT).toBe(0.3);
    expect([TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE]).toEqual([0.45, 0.75, 1.35, 0.08]);
    expect(TRAIL_CORE_GAIN).toBe(0.45); expect(TRAIL_CORE_TINT).toEqual({ r: 0.26, g: 0.22, b: 0.18 });
    expect(TRAIL_MARGIN_GAIN).toBe(0.85); expect(TRAIL_MARGIN_TINT).toEqual({ r: 0.42, g: 0.37, b: 0.3 });
    expect(TRAIL_TRAMPLE_TINT).toEqual({ r: 0.82, g: 0.78, b: 0.66 });
    expect([TRAIL_WET_DARK, TRAIL_WET_GLOSS]).toEqual([0.35, 0.5]);
    expect(TRAIL_PUDDLE_WET).toEqual([0.55, 0.8]); expect(TRAIL_PUDDLE_LOW).toEqual([0.62, 0.75]); expect(TRAIL_PUDDLE_WAVE).toBe(6);
    expect([TRAMPLE_HEIGHT, TRAMPLE_LEAN]).toEqual([0.55, 0.35]); expect(TRAMPLE_TINT).toEqual({ r: 0.85, g: 0.8, b: 0.65 });
    expect(TRAMPLE_BAND).toEqual([0.75, 1.6]);
  });
});

describe("noise", () => {
  it("macroNoise is the two-octave sum of valueNoise2", () => {
    for (const [x, z] of [[0, 0], [12.3, -45.6], [1000.5, 2000.25]]) {
      const expected = MACRO_WEIGHT[0] * valueNoise2(x, z, MACRO_WAVE[0]) + MACRO_WEIGHT[1] * valueNoise2(x, z, MACRO_WAVE[1]);
      expect(macroNoise(x, z)).toBeCloseTo(expected, 12);
    }
  });
  it("valueNoise1 and trailWear stay in [0, 1] and continuous", () => {
    let prev = trailWear(0);
    for (let u = 0; u <= 600; u += 0.1) {
      const w = trailWear(u);
      expect(w).toBeGreaterThanOrEqual(0); expect(w).toBeLessThanOrEqual(1);
      expect(Math.abs(w - prev)).toBeLessThan(0.05);
      prev = w;
      const n = valueNoise1(u, 3);
      expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(1);
    }
  });
  it("the edge noise is bounded by TRAIL_EDGE_NOISE", () => {
    for (let i = 0; i < 400; i++) {
      const e = trailEdgeNoise(i * 0.37 - 70, i * 0.91 + 3);
      expect(Math.abs(e)).toBeLessThanOrEqual(TRAIL_EDGE_NOISE);
    }
  });
});

describe("bands and trampling", () => {
  it("partitions the shifted distance into core, margin and trampled with soft edges", () => {
    for (const d of [0, 0.3, 0.45, 0.6, 0.75, 1.0, 1.35, 1.5, 3]) {
      const b = trailBands(d);
      expect(b.core + b.margin + b.trample).toBeLessThanOrEqual(1 + 1e-9);
      for (const v of Object.values(b)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    expect(trailBands(0)).toEqual({ core: 1, margin: 0, trample: 0 });
    expect(trailBands(0.6)).toEqual({ core: 0, margin: 1, trample: 0 });
    expect(trailBands(1.0).trample).toBeGreaterThan(0.4);
    expect(trailBands(1.5)).toEqual({ core: 0, margin: 0, trample: 0 });
  });
  it("trampleAt reaches the constants at the bench edge and is the identity past the band", () => {
    const at = trampleAt(0.75);
    expect(at.height).toBeCloseTo(TRAMPLE_HEIGHT, 9); expect(at.lean).toBeCloseTo(TRAMPLE_LEAN, 9);
    expect(at.tint).toEqual(TRAMPLE_TINT);
    const far = trampleAt(1.6);
    expect(far).toEqual({ height: 1, lean: 0, tint: { r: 1, g: 1, b: 1 } });
    expect(trampleAt(Infinity)).toEqual(far);
    const mid = trampleAt(1.0);
    expect(mid.height).toBeGreaterThan(TRAMPLE_HEIGHT); expect(mid.height).toBeLessThan(1);
  });
});
```

`client/test/architecture.test.ts`: add `join(SRC, "game", "trailBenchParams.ts")` to `BABYLON_FREE_FILES`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/trailBenchParams.test.ts client/test/architecture.test.ts`
Expected: FAIL — module not found; `valueNoise2` not exported.

- [ ] **Step 3: Implement**

`client/src/game/groundHexParams.ts`: extract the per-octave value noise from `macroNoise` into an export that mirrors the GLSL `macroValueNoise(p, wave)` exactly (floor, `smoothstep(0, 1, f)` fade, four `latticeHash` corners, bilinear mix):

```ts
/** One octave of value noise on the lattice hash at wavelength `wave` (m).
 * Mirrors macroValueNoise in groundHex.fragment.fx token for token. */
export function valueNoise2(x: number, z: number, wave: number): number {
  const qx = x / wave, qz = z / wave;
  const cx = Math.floor(qx), cz = Math.floor(qz);
  const fx = smooth01(qx - cx), fz = smooth01(qz - cz);
  const a = latticeHash(cx, cz), b = latticeHash(cx + 1, cz);
  const d = latticeHash(cx, cz + 1), e = latticeHash(cx + 1, cz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (d + (e - d) * fx) * fz;
}

export function macroNoise(x: number, z: number): number {
  return MACRO_WEIGHT[0] * valueNoise2(x, z, MACRO_WAVE[0]) + MACRO_WEIGHT[1] * valueNoise2(x, z, MACRO_WAVE[1]);
}
```

where `smooth01(t) = t * t * (3 - 2 * t)` is whatever helper the file already uses for the fade (keep the existing name if one exists; the existing `macroNoise` tests must still pass bit for bit, so the arithmetic order must not change — if the current `macroNoise` computes the bilinear mix in a different order, keep that order inside `valueNoise2`).

`client/src/game/trailBenchParams.ts`:

```ts
import { latticeHash, valueNoise2, type Rgb } from "./groundHexParams.js";
import { TRAIL_BED_HALF } from "../sim/trail.js";

/**
 * The trail paint's constants and the pure mirrors of its band, wear and
 * trample functions, Babylon-free so the tests and the clutter rebuild
 * share them with trailPaint.ts's GLSL. Renderer-only: nothing here may
 * migrate into sim/.
 */

/** Width factor at a node of degree three or more and at the trailhead. */
export const TRAIL_JUNCTION_W = 1.35;
/** Along-length wear: two octaves of 1-D value noise on the node parameter u (m). */
export const TRAIL_WEAR_WAVE: readonly [number, number] = [12, 3];
export const TRAIL_WEAR_WEIGHT: readonly [number, number] = [0.6, 0.4];
/** Band width scale at wear 0 and 1. */
export const TRAIL_WEAR_W0 = 0.8;
export const TRAIL_WEAR_W1 = 1.25;
/** Core darkness scale at wear 0 and 1. */
export const TRAIL_WEAR_D0 = 0.85;
export const TRAIL_WEAR_D1 = 1.1;
/** The ragged edge: metres of two-octave lattice noise added to the across distance. */
export const TRAIL_EDGE_NOISE = 0.25;
export const TRAIL_EDGE_WAVE: readonly [number, number] = [1.5, 0.4];
export const TRAIL_EDGE_WEIGHT: readonly [number, number] = [0.6, 0.4];
/** Metres a band boundary moves per unit of the pebble height's offset from 0.5. */
export const TRAIL_HEIGHT_SHIFT = 0.3;
/** The four bands from the centre, in metres of shifted distance. TRAIL_MARGIN_HALF is TRAIL_BED_HALF. */
export const TRAIL_CORE_HALF = 0.45;
export const TRAIL_MARGIN_HALF: number = TRAIL_BED_HALF;
export const TRAIL_TRAMPLE_HALF = 1.35;
/** Boundary softness (m), widened to the fragment footprint in the shader. */
export const TRAIL_PAINT_EDGE = 0.08;
export const TRAIL_CORE_GAIN = 0.45;
export const TRAIL_CORE_TINT: Rgb = { r: 0.26, g: 0.22, b: 0.18 };
export const TRAIL_MARGIN_GAIN = 0.85;
export const TRAIL_MARGIN_TINT: Rgb = { r: 0.42, g: 0.37, b: 0.3 };
export const TRAIL_TRAMPLE_TINT: Rgb = { r: 0.82, g: 0.78, b: 0.66 };
/** Wet: the core's albedo loss and roughness loss at wetness 1; puddles. */
export const TRAIL_WET_DARK = 0.35;
export const TRAIL_WET_GLOSS = 0.5;
export const TRAIL_PUDDLE_WET: readonly [number, number] = [0.55, 0.8];
export const TRAIL_PUDDLE_LOW: readonly [number, number] = [0.62, 0.75];
export const TRAIL_PUDDLE_WAVE = 6;
/** The trampled cards beside the bench. */
export const TRAMPLE_HEIGHT = 0.55;
export const TRAMPLE_LEAN = 0.35;
export const TRAMPLE_TINT: Rgb = { r: 0.85, g: 0.8, b: 0.65 };
export const TRAMPLE_BAND: readonly [number, number] = [0.75, 1.6];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** One octave of 1-D value noise on the lattice hash. Mirrors trailValueNoise1 in the GLSL. */
export function valueNoise1(u: number, wave: number): number {
  const q = u / wave;
  const c = Math.floor(q);
  const f = smoothstep(0, 1, q - c);
  const a = latticeHash(c, 0), b = latticeHash(c + 1, 0);
  return a + (b - a) * f;
}

export function trailWear(u: number): number {
  return TRAIL_WEAR_WEIGHT[0] * valueNoise1(u, TRAIL_WEAR_WAVE[0]) + TRAIL_WEAR_WEIGHT[1] * valueNoise1(u, TRAIL_WEAR_WAVE[1]);
}

/** Signed metres to add to the across distance, in [−TRAIL_EDGE_NOISE, TRAIL_EDGE_NOISE]. */
export function trailEdgeNoise(x: number, z: number): number {
  const n = TRAIL_EDGE_WEIGHT[0] * valueNoise2(x, z, TRAIL_EDGE_WAVE[0]) + TRAIL_EDGE_WEIGHT[1] * valueNoise2(x, z, TRAIL_EDGE_WAVE[1]);
  return TRAIL_EDGE_NOISE * (2 * n - 1);
}

/** Band weights of the shifted distance dB, each boundary a smoothstep of TRAIL_PAINT_EDGE. */
export function trailBands(dB: number): { core: number; margin: number; trample: number } {
  const e = TRAIL_PAINT_EDGE;
  const inCore = 1 - smoothstep(TRAIL_CORE_HALF, TRAIL_CORE_HALF + e, dB);
  const inMargin = 1 - smoothstep(TRAIL_MARGIN_HALF, TRAIL_MARGIN_HALF + e, dB);
  const trampleFade = 1 - smoothstep(TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, dB);
  return { core: inCore, margin: inMargin - inCore, trample: (1 - inMargin) * trampleFade };
}

/** The trampled card's height scale, lean (rad, away from the bench) and tint at trail distance rt. */
export function trampleAt(rt: number): { height: number; lean: number; tint: Rgb } {
  const s = smoothstep(TRAMPLE_BAND[0], TRAMPLE_BAND[1], rt);
  return {
    height: TRAMPLE_HEIGHT + (1 - TRAMPLE_HEIGHT) * s,
    lean: TRAMPLE_LEAN * (1 - s),
    tint: { r: TRAMPLE_TINT.r + (1 - TRAMPLE_TINT.r) * s, g: TRAMPLE_TINT.g + (1 - TRAMPLE_TINT.g) * s, b: TRAMPLE_TINT.b + (1 - TRAMPLE_TINT.b) * s },
  };
}
```

The `trailBands` test's exact `toEqual` cases hold because at `dB = 0` every smoothstep is 0, at 0.6 `inCore` is 0 and `inMargin` is 1, and at 1.5 the trample fade is 0; `Rgb` is exported from `groundHexParams.ts` (it re-exports `colour.ts`'s type — if not, import `type Rgb` from `./colour.js`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/test/game/trailBenchParams.test.ts client/test/game/groundHexParams.test.ts client/test/game/groundHex.test.ts client/test/game/clutterMeshes.test.ts client/test/architecture.test.ts`
Expected: PASS (the existing macro-noise tests bit for bit).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/groundHexParams.ts client/src/game/trailBenchParams.ts client/test/game/trailBenchParams.test.ts client/test/architecture.test.ts
git commit  # subject: feat: the trail bench's constants and mirrors, Babylon-free
```

---

### Task 4: the paint

**Files:**
- Modify: `client/src/game/trailPaint.ts` (constants 30–44, `Segment`/`TrailTable` 49–60, `trailSegments` 62–67, `buildTrailTable` 69–107, the mirrors 116–163, `TRAIL_FRAGMENT_DEFS` 168–173, `TRAIL_FRAGMENT_PAINT` 185–262)
- Modify: `client/src/game/terrainTexture.ts` (`enableTrail` 647–665, the `getUniforms()` ubo list near 723, the non-UBO fragment declaration near 771, `bindForSubMesh` near 843, a new `setWet` method and an exported `setTerrainWetness` helper beside `enableTrailPaint` at 992)
- Modify: `client/src/game/renderer.ts:915` (after `applyWetness(scene, weather);`)
- Test: `client/test/game/trailPaint.test.ts`, `client/test/game/terrainTexture.test.ts`

**Interfaces:**
- Consumes: Task 3's constants and mirrors; `TRAIL_SINK`, `TRAIL_SINK_RAMP`, `TRAIL_BED_HALF` from `sim/trail.ts`; `TrailGraph.nodes[i].u`, `trailhead`, edge endpoints for degree.
- Produces: `Segment { ax, az, bx, bz, ua, ub, wa, wb }`; `TrailTable.list` of length `TRAIL_PAINT_MAX_SEGMENTS · 4 · 2` (row 0 then row 1); `nodeWidths(graph): number[]`; `trailPaintAt(x, z, table, opts): { core, margin, trample, wear, u, widthK }` (the TypeScript mirror of the band selection); `TerrainTexturePlugin.setWet(w)`; `export function setTerrainWetness(scene, material, wetness)`. The uniform `terrainWet` (float).

- [ ] **Step 1: Write the failing tests**

`client/test/game/trailPaint.test.ts` — replace the imports of the retired constants (`TRAIL_PAINT_MARGIN`, `TRAIL_DIRT_TINT`, `TRAIL_GRAVEL_GAIN`) and add `nodeWidths, trailPaintAt` and, from `trailBenchParams.js`, `TRAIL_JUNCTION_W, TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE, TRAIL_CORE_TINT, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT, TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN, TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_HEIGHT_SHIFT, TRAIL_EDGE_NOISE, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1, TRAIL_PUDDLE_WET, TRAIL_PUDDLE_LOW, TRAIL_PUDDLE_WAVE, TRAIL_WEAR_WAVE, TRAIL_EDGE_WAVE, trailWear, trailEdgeNoise, trailBands`. Keep every existing test whose subject survives (the buckets, `bucketOf`, `trailNearest`, the bank, snow, the defs); delete the two that pin `TRAIL_PAINT_MARGIN`/`TRAIL_DIRT_TINT` ("is 1 on the bed plus its margin…" becomes the band test below; "is the ground's own vertex colour…" stays; "is packed snow…" stays). Add:

```ts
describe("the table's second row", () => {
  // A Y: trailhead 0 → 1 → 2 (degree 3 at 1) with a spur 1 → 3.
  const graph = {
    nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 100 }, { x: 200, z: 0, h: 0, u: 200 }, { x: 100, z: 80, h: 0, u: 180 }],
    edges: [
      { a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 0.5 },
      { a: 1, b: 2, kind: "stem", profile: new Float64Array(2), progress0: 0.5, progress1: 1 },
      { a: 1, b: 3, kind: "loop", profile: new Float64Array(2), progress0: 0.5, progress1: 0.5 },
    ],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1], loops: [], features: [], stemLen: 200, fallbacks: 0,
  } as unknown as TrailGraph;
  it("widens degree-3 nodes and the trailhead, and carries each node's u", () => {
    expect(nodeWidths(graph)).toEqual([TRAIL_JUNCTION_W, TRAIL_JUNCTION_W, 1, 1]);
    const segs = trailSegments(graph);
    expect(segs[0]).toMatchObject({ ua: 0, ub: 100, wa: TRAIL_JUNCTION_W, wb: TRAIL_JUNCTION_W });
    expect(segs[1]).toMatchObject({ ua: 100, ub: 200, wa: TRAIL_JUNCTION_W, wb: 1 });
    expect(segs[2]).toMatchObject({ ua: 100, ub: 180, wa: TRAIL_JUNCTION_W, wb: 1 });
  });
  it("writes row 1 behind row 0 in one buffer, so the texture is 512 by 2", () => {
    const t = buildTrailTable(trailSegments(graph));
    expect(t.list.length).toBe(TRAIL_PAINT_MAX_SEGMENTS * 4 * 2);
    const b = bucketOf(t, 150, 0);
    const s = t.index[b * 4]!;
    const row1 = TRAIL_PAINT_MAX_SEGMENTS * 4;
    expect([t.list[s * 4], t.list[s * 4 + 2]]).toEqual([100, 200]);
    expect([t.list[row1 + s * 4], t.list[row1 + s * 4 + 1], t.list[row1 + s * 4 + 2], t.list[row1 + s * 4 + 3]]).toEqual([100, 200, TRAIL_JUNCTION_W, 1]);
  });
});

describe("the mirror of the band selection", () => {
  const t = buildTrailTable(trailSegments({
    nodes: [{ x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 100 }],
    edges: [{ a: 0, b: 1, kind: "stem", profile: new Float64Array(2), progress0: 0, progress1: 1 }],
    trailhead: { x: 0, z: 0, u: 0 }, summit: 1, stem: [0], loops: [], features: [], stemLen: 100, fallbacks: 0,
  } as unknown as TrailGraph));
  it("reads u along the segment and the width factor between its ends", () => {
    const p = trailPaintAt(50, 0, t, { edgeNoise: 0, height: 0.5 });
    expect(p.u).toBeCloseTo(50, 9);
    expect(p.widthK).toBeCloseTo((TRAIL_WEAR_W0 + (TRAIL_WEAR_W1 - TRAIL_WEAR_W0) * trailWear(50)) * (TRAIL_JUNCTION_W + (1 - TRAIL_JUNCTION_W) * 0.5), 9);
  });
  it("is core on the centreline, margin at the bench edge, trampled beyond, ground past 1.35 × width", () => {
    const o = { edgeNoise: 0, height: 0.5 };
    const c = trailPaintAt(50, 0, t, o);
    expect(c.core).toBe(1);
    const k = c.widthK;
    expect(trailPaintAt(50, 0.6 * k, t, o).margin).toBe(1);
    expect(trailPaintAt(50, 1.0 * k, t, o).trample).toBeGreaterThan(0.4);
    const far = trailPaintAt(50, 1.5 * k, t, o);
    expect(far).toMatchObject({ core: 0, margin: 0, trample: 0 });
  });
  it("shifts every boundary by the pebble height and the edge noise", () => {
    const k = trailPaintAt(50, 0, t, { edgeNoise: 0, height: 0.5 }).widthK;
    const d = TRAIL_CORE_HALF * k + 0.02;
    expect(trailPaintAt(50, d, t, { edgeNoise: 0, height: 0.5 }).core).toBeLessThan(1);
    expect(trailPaintAt(50, d, t, { edgeNoise: 0, height: 1.0 }).core).toBe(1);
    expect(trailPaintAt(50, d, t, { edgeNoise: -0.2, height: 0.5 }).core).toBe(1);
  });
});

describe("the GLSL", () => {
  it("prints the mirror's constants, reads row 1 once for the best segment, and carries every term", () => {
    const g = TRAIL_FRAGMENT_PAINT;
    for (const v of [TRAIL_CORE_HALF, TRAIL_MARGIN_HALF, TRAIL_TRAMPLE_HALF, TRAIL_PAINT_EDGE, TRAIL_CORE_GAIN, TRAIL_MARGIN_GAIN, TRAIL_WET_DARK, TRAIL_WET_GLOSS, TRAIL_HEIGHT_SHIFT, TRAIL_EDGE_NOISE, TRAIL_WEAR_W0, TRAIL_WEAR_W1, TRAIL_WEAR_D0, TRAIL_WEAR_D1, TRAIL_PUDDLE_WAVE, ...TRAIL_WEAR_WAVE, ...TRAIL_EDGE_WAVE, ...TRAIL_PUDDLE_WET, ...TRAIL_PUDDLE_LOW]) {
      expect(g).toContain(Number.isInteger(v) ? v.toFixed(1) : String(v));
    }
    for (const c of [TRAIL_CORE_TINT, TRAIL_MARGIN_TINT, TRAIL_TRAMPLE_TINT]) expect(g).toContain(`vec3(${c.r}, ${c.g}, ${c.b})`);
    expect(g).toContain("texture2D(trailSegs, vec2(tu, 0.25))");
    expect(g.split("texture2D(trailSegs, vec2(tuBest, 0.75))").length).toBe(2);
    for (const term of ["trailValueNoise1(", "macroValueNoise(", "terrainWet", "tPuddle", "tLip", "tWidthK", "tDarkK", "tdN"]) expect(g).toContain(term);
    expect(g).not.toContain("TRAIL_DIRT_TINT");
    expect(g.indexOf("fwidth(tdBest)")).toBeLessThan(g.indexOf("if (tdBest <"));
  });
});
```

`client/test/game/terrainTexture.test.ts`: in the existing per-path declaration test (the `FLOOR_UNIFORMS` style list), add `["float", "terrainWet"]`; in the uniform-write test add `expect(writes.terrainWet).toBe(0)` before `setWet(1)` and `toBe(1)` after; extend the both-path compile test (line 788's describe) with a case that calls `plugin.enableTrail(graph)` on a two-node graph as above and asserts the compiled fragment source on both paths contains `trailSegs` and `terrainWet` exactly once as a declaration and `texture2D(trailSegs, vec2(tuBest, 0.75))` once.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/trailPaint.test.ts client/test/game/terrainTexture.test.ts`
Expected: FAIL — `nodeWidths`/`trailPaintAt` not exported; the buffer is 512 × 4; no `terrainWet`.

- [ ] **Step 3: Implement `trailPaint.ts`**

Imports: `TRAIL_BED_HALF, TRAIL_CORRIDOR_HALF, TRAIL_SINK, TRAIL_SINK_RAMP, type TrailGraph` from `../sim/trail.js`; every constant and `trailWear, trailEdgeNoise, trailBands` from `./trailBenchParams.js`. Remove `TRAIL_PAINT_MARGIN`, `TRAIL_DIRT_TINT`, `TRAIL_GRAVEL_GAIN` and the local `TRAIL_PAINT_EDGE` (re-export the params file's: `export { TRAIL_PAINT_EDGE } from "./trailBenchParams.js";` so existing importers keep working). `BED` becomes `TRAIL_BED_HALF` (no margin). `TRAIL_BANK_SLOPE` stays.

Types and table:

```ts
export type Segment = { ax: number; az: number; bx: number; bz: number; ua: number; ub: number; wa: number; wb: number };
export type TrailTable = {
  index: Float32Array;
  /** Two rows of TRAIL_PAINT_MAX_SEGMENTS × RGBA: row 0 (ax, az, bx, bz), row 1 (ua, ub, wa, wb). */
  list: Float32Array;
  x0: number; z0: number; count: number; bucketMax: number; overflow: boolean;
};

/** Width factor per node: TRAIL_JUNCTION_W at degree ≥ 3 and at the trailhead (node 0), else 1. */
export function nodeWidths(graph: TrailGraph): number[] {
  const degree = new Array<number>(graph.nodes.length).fill(0);
  for (const e of graph.edges) { degree[e.a]!++; degree[e.b]!++; }
  return degree.map((d, i) => (d >= 3 || i === 0 ? TRAIL_JUNCTION_W : 1));
}

export function trailSegments(graph: TrailGraph): Segment[] {
  const w = nodeWidths(graph);
  return graph.edges.map((e) => {
    const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, ua: a.u, ub: b.u, wa: w[e.a]!, wb: w[e.b]! };
  });
}
```

In `buildTrailTable`: `const list = new Float32Array(TRAIL_PAINT_MAX_SEGMENTS * 4 * 2); const ROW1 = TRAIL_PAINT_MAX_SEGMENTS * 4;` and where an entry is written add `list[ROW1 + count * 4] = s.ua; list[ROW1 + count * 4 + 1] = s.ub; list[ROW1 + count * 4 + 2] = s.wa; list[ROW1 + count * 4 + 3] = s.wb;` before `count++`.

`trailNearest` returns also the best entry's index and parameter: extend its return to `{ d, ex, ez, k, t }` (k = list entry, t along it; `k = -1` when empty). `trailBand` and `trailBankBand` keep their signatures but use `TRAIL_BED_HALF` where `BED` was. Add the mirror:

```ts
export type TrailPaintOpts = { edgeNoise: number; height: number };
/** The band weights the shader computes at (x, z): edgeNoise is the metres the ragged
 * edge adds (the shader's own comes from trailEdgeNoise), height the pebble height in [0, 1]. */
export function trailPaintAt(x: number, z: number, table: TrailTable, opts: TrailPaintOpts): { core: number; margin: number; trample: number; wear: number; u: number; widthK: number } {
  const n = trailNearest(table, x, z);
  if (n.k < 0) return { core: 0, margin: 0, trample: 0, wear: 0, u: 0, widthK: 1 };
  const row1 = TRAIL_PAINT_MAX_SEGMENTS * 4 + n.k * 4;
  const u = table.list[row1]! + (table.list[row1 + 1]! - table.list[row1]!) * n.t;
  const wj = table.list[row1 + 2]! + (table.list[row1 + 3]! - table.list[row1 + 2]!) * n.t;
  const wear = trailWear(u);
  const widthK = (TRAIL_WEAR_W0 + (TRAIL_WEAR_W1 - TRAIL_WEAR_W0) * wear) * wj;
  const dB = (n.d + opts.edgeNoise) / widthK - TRAIL_HEIGHT_SHIFT * (opts.height - 0.5);
  return { ...trailBands(dB), wear, u, widthK };
}
```

`TRAIL_FRAGMENT_DEFS` gains, under `#ifdef TRAILPAINT`, the 1-D noise (the hex include's `latticeHash` is already in scope):

```glsl
float trailValueNoise1(float u, float wave) {
  float q = u / wave;
  float c = floor(q);
  float f = smoothstep(0.0, 1.0, q - c);
  return mix(latticeHash(vec2(c, 0.0)), latticeHash(vec2(c + 1.0, 0.0)), f);
}
```

`TRAIL_FRAGMENT_PAINT`: keep the bucket lookup, the loop and `fwidth(tdBest)` exactly as they are, but the loop reads `texture2D(trailSegs, vec2(tu, 0.25))` (row 0 of the 512 × 2 texture) and also records `float tuBest` and `float ttBest` for the winner (`tu` and `tt`). After the `if (tdBest < CORRIDOR + taa)` line and the existing `tk`, `tAway`, `tRise`, `tSoil`, `tSnow`, replace everything from `tE` to `surfaceAlbedo = tCol;` with:

```glsl
    vec4 tRow = texture2D(trailSegs, vec2(tuBest, 0.75));
    float tU = mix(tRow.x, tRow.y, ttBest);
    float tWj = mix(tRow.z, tRow.w, ttBest);
    float tWear = ${f(TRAIL_WEAR_WEIGHT[0])} * trailValueNoise1(tU, ${f(TRAIL_WEAR_WAVE[0])}) + ${f(TRAIL_WEAR_WEIGHT[1])} * trailValueNoise1(tU, ${f(TRAIL_WEAR_WAVE[1])});
    float tWidthK = mix(${f(TRAIL_WEAR_W0)}, ${f(TRAIL_WEAR_W1)}, tWear) * tWj;
    float tDarkK = mix(${f(TRAIL_WEAR_D0)}, ${f(TRAIL_WEAR_D1)}, tWear);
    float tEdgeN = ${f(TRAIL_EDGE_WEIGHT[0])} * macroValueNoise(vPositionW.xz, ${f(TRAIL_EDGE_WAVE[0])}) + ${f(TRAIL_EDGE_WEIGHT[1])} * macroValueNoise(vPositionW.xz, ${f(TRAIL_EDGE_WAVE[1])});
    float tdN = tdBest + ${f(TRAIL_EDGE_NOISE)} * (2.0 * tEdgeN - 1.0);
    vec2 tuvP = vPositionW.xz * terrainTiling.w;
    vec2 tuvF = vPositionW.xz * terrainTiling.y;
    vec3 tGravelTex = mix(vec3(1.0), texture2D(terrainPebble, tuvP).rgb / terrainRock2.y, tk);
    vec3 tFloorTex = mix(vec3(1.0), texture2D(terrainFloor, tuvF).rgb / terrainRock2.y, tk);
    vec3 tGravelN = texture2D(terrainNormals, vec3(tuvP, 4.0)).rgb * 2.0 - 1.0;
    vec3 tGravelRAH = texture2D(terrainRAH, vec3(tuvP, 4.0)).rgb;
    vec3 tFloorN = texture2D(terrainNormals, vec3(tuvF, 1.0)).rgb * 2.0 - 1.0;
    vec3 tFloorRAH = texture2D(terrainRAH, vec3(tuvF, 1.0)).rgb;
    float tdB = tdN / tWidthK - ${f(TRAIL_HEIGHT_SHIFT)} * (mix(0.5, tGravelRAH.b, tk) - 0.5);
    float tE = max(${f(TRAIL_PAINT_EDGE)}, taa / tWidthK);
    float tInCore = 1.0 - smoothstep(${f(TRAIL_CORE_HALF)}, ${f(TRAIL_CORE_HALF)} + tE, tdB);
    float tInMargin = 1.0 - smoothstep(${f(TRAIL_MARGIN_HALF)}, ${f(TRAIL_MARGIN_HALF)} + tE, tdB);
    float tCore = tInCore * (1.0 - tSnow);
    float tMargin = (tInMargin - tInCore) * (1.0 - tSnow);
    float tTrample = (1.0 - tInMargin) * (1.0 - smoothstep(${f(TRAIL_MARGIN_HALF)}, ${f(TRAIL_TRAMPLE_HALF)}, tdB)) * tSoil * (1.0 - tSnow);
    float tBank = smoothstep(0.0, ${f(TRAIL_BANK_SLOPE)}, tRise) * (1.0 - smoothstep(${f(TRAIL_BED_HALF)}, ${f(TRAIL_CORRIDOR_HALF)}, tdN)) * tSoil * (1.0 - tSnow) * (1.0 - tInMargin);
#ifdef VERTEXCOLOR
    vec3 tBankBase = vColor.rgb;
#else
    vec3 tBankBase = vAlbedoColor.rgb;
#endif
    // The trampled band: this ground, dried and stained toward the bench.
    vec3 tCol = surfaceAlbedo * mix(vec3(1.0), vec3(${f(TRAIL_TRAMPLE_TINT.r)}, ${f(TRAIL_TRAMPLE_TINT.g)}, ${f(TRAIL_TRAMPLE_TINT.b)}), tTrample);
    // The bank: bare forest floor on the uphill side, under the vertex colour.
    tCol = mix(tCol, tFloorTex * mix(1.0, tFloorRAH.g / 0.5, tk) * tBankBase, tBank);
    normalW = normalize(mix(normalW, normalize(normalW + vec3(tFloorN.x, 0.0, tFloorN.y)), tBank * tk));
    terrainRough = mix(terrainRough, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tBank);
    terrainF0 = mix(terrainF0, terrainLayerF0.y, tBank);
    // Core and margin: the pebble layer under two tints, the core compacted and
    // darkened by wear, the margin loose and pale. Wet: the core darkens and
    // glosses, the margin half as much; puddles sit in the low spots of the
    // 6 m noise inside the core.
    float tAo = mix(1.0, tGravelRAH.g / 0.5, tk);
    vec3 tCoreCol = vec3(${f(TRAIL_CORE_TINT.r)}, ${f(TRAIL_CORE_TINT.g)}, ${f(TRAIL_CORE_TINT.b)}) * tDarkK * tGravelTex * ${f(TRAIL_CORE_GAIN)} * tAo * vAlbedoColor.rgb;
    vec3 tMarginCol = vec3(${f(TRAIL_MARGIN_TINT.r)}, ${f(TRAIL_MARGIN_TINT.g)}, ${f(TRAIL_MARGIN_TINT.b)}) * tGravelTex * ${f(TRAIL_MARGIN_GAIN)} * tAo * vAlbedoColor.rgb;
    float tPuddleLow = smoothstep(${f(TRAIL_PUDDLE_LOW[0])}, ${f(TRAIL_PUDDLE_LOW[1])}, 1.0 - macroValueNoise(vPositionW.xz, ${f(TRAIL_PUDDLE_WAVE)}));
    float tPuddle = smoothstep(${f(TRAIL_PUDDLE_WET[0])}, ${f(TRAIL_PUDDLE_WET[1])}, terrainWet) * tPuddleLow * tCore;
    tCoreCol *= 1.0 - ${f(TRAIL_WET_DARK)} * terrainWet;
    tMarginCol *= 1.0 - ${f(TRAIL_WET_DARK)} * 0.5 * terrainWet;
    tCoreCol = mix(tCoreCol, tCoreCol * 0.5, tPuddle);
    vec3 tPacked = surfaceAlbedo * vec3(0.86, 0.88, 0.94);
    float tOnBench = tInMargin;
    tCol = mix(tCol, mix(mix(tMarginCol, tCoreCol, tInCore), tPacked, tSnow), tOnBench);
    float tGravel = tOnBench * (1.0 - tSnow);
    vec3 tBenchN = normalize(normalW + vec3(tGravelN.x, 0.0, tGravelN.y) * mix(1.0, 0.5, tInCore));
    // The lip: over the sink ramp outside the bench the normal tilts outward
    // and down by the ramp's slope, so a low sun draws the edge as a line.
    float tRamp = smoothstep(${f(TRAIL_BED_HALF)}, ${f(TRAIL_BED_HALF + TRAIL_SINK_RAMP)}, tdN);
    float tLip = 4.0 * tRamp * (1.0 - tRamp) * (1.0 - tSnow);
    vec3 tLipN = normalize(normalW - vec3(tAway.x, 0.0, tAway.y) * ${f(TRAIL_SINK / TRAIL_SINK_RAMP)} * tLip);
    normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), vec3(0.0, 1.0, 0.0), tPuddle));
    float tRoughBench = clamp(terrainLayerRough2.x * mix(1.0, tGravelRAH.r / 0.5, tk), 0.0, 1.0);
    tRoughBench *= 1.0 - ${f(TRAIL_WET_GLOSS)} * terrainWet * mix(0.5, 1.0, tInCore);
    terrainRough = mix(mix(terrainRough, tRoughBench, tGravel), 0.05, tPuddle);
    terrainF0 = mix(terrainF0, terrainLayerF02.x, tGravel);
    surfaceAlbedo = tCol;
```

`f(TRAIL_SINK / TRAIL_SINK_RAMP)` prints `0.12`; `f(TRAIL_BED_HALF + TRAIL_SINK_RAMP)` prints `1.25`. Keep the paint's header comment accurate: it now reads row 0 in the loop and row 1 once for the winner, and every band is a function of the shifted distance.

- [ ] **Step 4: Implement `terrainTexture.ts` and `renderer.ts`**

`enableTrail`: `RawTexture.CreateRGBATexture(table.list, TRAIL_PAINT_MAX_SEGMENTS, 2, …)` (height 2). Add a field `private _wet = 0;` and:

```ts
  /** The weather's wetness in [0, 1]: the trail's core darkens, glosses and puddles with it. */
  setWet(wetness: number): void { this._wet = Math.min(1, Math.max(0, wetness)); }
```

`getUniforms()` ubo list: `{ name: "terrainWet", size: 1, type: "float" }` beside `trailInfo`; the non-UBO fragment declaration: `uniform float terrainWet;` beside `uniform vec4 trailInfo;`. `bindForSubMesh`: `uniformBuffer.updateFloat("terrainWet", this._wet);` unconditionally (declared unconditionally like `trailInfo`). Export beside `enableTrailPaint`:

```ts
export function setTerrainWetness(scene: Scene, material: PBRMaterial, wetness: number): void {
  const plugin = material.pluginManager?.getPlugin("TerrainTexture") as TerrainTexturePlugin | undefined;
  plugin?.setWet(wetness);
}
```

`renderer.ts`, after `applyWetness(scene, weather);`: `setTerrainWetness(scene, terrainMaterialFor(scene, "terrain"), weather.wetness);` (import it beside `enableTrailPaint`).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run client/test/game/trailPaint.test.ts client/test/game/terrainTexture.test.ts client/test/game/shaderHygiene.test.ts client/test/sim/trailBed.test.ts client/test/game/renderer.test.ts`
Expected: PASS (the `trailBed` "fits every world's segments in the paint's buckets" test still reads the same `index`).

- [ ] **Step 6: Commit**

```bash
git add client/src/game/trailPaint.ts client/src/game/terrainTexture.ts client/src/game/renderer.ts client/test/game/trailPaint.test.ts client/test/game/terrainTexture.test.ts
git commit  # subject: feat: paint the trail as a worn, ragged, wet footpath
```

---

### Task 5: the trampled cards and the litter meshes

**Files:**
- Modify: `client/src/game/clutterMeshes.ts` (`writeInstanceMatrix` 322–335, `writeFoliage` 340–355, the model table 92–101, near the `BOULDER_*` constants 110–118)
- Test: `client/test/game/clutterMeshes.test.ts`

**Interfaces:**
- Consumes: `trampleAt(rt)`, `TRAMPLE_BAND` from `trailBenchParams.ts`; `activeTerrainVariant().trailDistance?.(seed, x, z)`; `CLUTTER_LITTER`; `seatOnGround`, `groundNormalTilt` from `groundTilt.ts`.
- Produces: `export const LITTER_VARIANT_SCALE: readonly number[] = [1, 1, 0.3]`; `export function trampleFrame(seed, inst): { height, lean, ax, az, tint }` (pure, exported for the test).

- [ ] **Step 1: Write the failing tests**

Add to `client/test/game/clutterMeshes.test.ts` (import `CLUTTER_LITTER` from the sim, `trampleAt, TRAMPLE_BAND` from `trailBenchParams.js`, `LITTER_VARIANT_SCALE, trampleFrame` from `clutterMeshes.js`, `activeTerrainVariant` from `../../src/sim/terrain.js`):

```ts
  it("tramples the grass beside the bench: shorter, leaning away, stained; untouched past the band", () => {
    const seed = 1234;
    const rt = activeTerrainVariant().trailDistance!;
    const near = { cls: CLUTTER_GRASS, x: 0, z: 0, groundH: 0, groundDx: 0, groundDz: 0, scale: 1, variant: 0, hash: 0.3 };
    // Find a point 0.9 m from the trail and one 3 m away by scanning a stem edge's neighbourhood.
    const g = activeTerrainVariant().trailGraph!(seed);
    const e = g.edges[g.stem[1]!]!, a = g.nodes[e.a]!, b = g.nodes[e.b]!;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const L = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
    const p09 = { ...near, x: mx + nx * 0.9, z: mz + nz * 0.9 };
    const p3 = { ...near, x: mx + nx * 3, z: mz + nz * 3 };
    expect(rt(seed, p09.x, p09.z)).toBeCloseTo(0.9, 3);
    const t09 = trampleFrame(seed, p09), t3 = trampleFrame(seed, p3);
    const want = trampleAt(0.9);
    expect(t09.height).toBeCloseTo(want.height, 6);
    expect(t09.lean).toBeCloseTo(want.lean, 6);
    expect(t09.tint).toEqual(want.tint);
    // The away direction points from the bed toward the card.
    expect(t09.ax * nx + t09.az * nz).toBeGreaterThan(0.99);
    expect(t3).toEqual({ height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } });
  });
  it("scales the litter variants to pebbles and a twig, and lists litter among the tilted classes", () => {
    expect(LITTER_VARIANT_SCALE).toEqual([1, 1, 0.3]);
    expect(CLUTTER_LITTER).toBe(8);
  });
```

Extend the existing "writes the ground colour and the canopy shade per grass instance" test: multiply its expected colour by `trampleAt(rt(seed, x, z)).tint` (the identity for every card past 1.6 m, so the existing assertions hold where they held).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run client/test/game/clutterMeshes.test.ts`
Expected: FAIL — `trampleFrame`, `LITTER_VARIANT_SCALE` not exported.

- [ ] **Step 3: Implement**

`clutterMeshes.ts`:

```ts
/** Per-variant base scale of the litter class: rock_a/rock_b at the sim's
 * 0.25–0.6 are pebbles already; driftwood needs another 0.3 to be a twig. */
export const LITTER_VARIANT_SCALE: readonly number[] = [1, 1, 0.3];

/** The classes the bench tramples: the swaying ground layer. */
const TRAMPLED = new Set<number>([CLUTTER_GRASS, CLUTTER_MEADOW, CLUTTER_FLOWER]);

/**
 * The trampled band beside the bench for one card: height scale, lean (rad)
 * about the horizontal axis perpendicular to the away direction (ax, az) —
 * the unit gradient of the trail distance, by central difference — and the
 * stain tint. The identity (1, 0, 0, 0, white) past TRAMPLE_BAND[1], with
 * no trail, and for every class the bench does not trample.
 */
export function trampleFrame(seed: number, inst: ClutterInstance): { height: number; lean: number; ax: number; az: number; tint: Rgb } {
  const none = { height: 1, lean: 0, ax: 0, az: 0, tint: { r: 1, g: 1, b: 1 } };
  if (!TRAMPLED.has(inst.cls)) return none;
  const rtOf = activeTerrainVariant().trailDistance;
  if (rtOf === undefined) return none;
  const rt = rtOf(seed, inst.x, inst.z);
  if (rt >= TRAMPLE_BAND[1]) return none;
  const h = 0.25;
  let gx = rtOf(seed, inst.x + h, inst.z) - rtOf(seed, inst.x - h, inst.z);
  let gz = rtOf(seed, inst.x, inst.z + h) - rtOf(seed, inst.x, inst.z - h);
  const gl = Math.hypot(gx, gz);
  if (gl > 1e-9) { gx /= gl; gz /= gl; } else { gx = 0; gz = 0; }
  const t = trampleAt(rt);
  return { height: t.height, lean: t.lean, ax: gx, az: gz, tint: t.tint };
}
```

`writeInstanceMatrix(inst, buf, offset)` gains a `frame` parameter (`ReturnType<typeof trampleFrame>`), and the rebuild loop computes `const frame = trampleFrame(seed, inst);` once per instance and passes it to both writers. In `writeInstanceMatrix`: the y scale is `inst.scale * frame.height`; the litter class's uniform scale is `inst.scale * LITTER_VARIANT_SCALE[inst.variant]!`; when `frame.lean > 0` compose the tilt: `Quaternion.RotationAxisToRef(new Vector3(-frame.az, 0, frame.ax), frame.lean, scratchLean)` (the axis perpendicular to the away direction, so the card's top moves along (ax, az)) and `scratchLean.multiplyToRef(scratchQ, scratchQ)` after the yaw. Use a module-level scratch `Vector3` and `Quaternion`; do not allocate per instance. In `writeFoliage`: multiply `buf[offset..+2]` by `frame.tint.r/g/b`. `TILTED` already holds `CLUTTER_LITTER` from Task 2.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run client/test/game/clutterMeshes.test.ts client/test/game/forestMeshes.test.ts client/test/game/clutterField.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/clutterMeshes.ts client/test/game/clutterMeshes.test.ts
git commit  # subject: feat: trample the grass beside the bench and size the litter
```

---

### Task 6: docs and the browser gates

- [ ] **Step 1: `ARCHITECTURE.md`**, Rendering paragraph, after the grass-floor sentence: "The trail is a footpath sunk into the sim's ground (`sim/trail.ts`), painted per fragment from a two-row segment table as four bands that wander with the lattice noise, wear along their length and go wet with the weather (`trailPaint.ts`, `trailBenchParams.ts`), with litter along its margin and the grass beside it trampled at rebuild." In the sim/determinism paragraph, one sentence: the trail bench and the litter class are part of the level id through their tunables.
- [ ] **Step 2: The gates**, run by the controller with the rig from the previous rounds (both builds on their own ports, the gate hooks reverted before commit, the chrome-devtools CLI, one page at a time), against the daylight control stills of the trail taken on 2026-09-16: (1) the trail at noon, 16 h and in rain, along and down; (2) a junction and the trailhead; (3) a side-hill stretch; (4) standing on the bench, eye low; (5) frame pairs at the trail and the meadow at 4× pixels, and the 1.5× low-tier trail pair. Any constant changed by tuning is recorded in the spec's amendments and the plan's.
- [ ] **Step 3: `docs/rendering/2026-09-16-trail-bench-verification.md`** in the shape of `docs/rendering/2026-09-16-grass-floor-verification.md`: the rig, each gate's verdict, the frame tables, the level-id note (old clients cannot join), what stays unverified.
- [ ] **Step 4: Gates** `npm run typecheck && npm run lint && npm test`, leak scan, blob check. Commit `docs: trail bench — architecture note and browser verification`. Do not push; report.

---

## Self-review

**Spec coverage.** §4 width, sink, fine check → Task 1; §4 grass gate, litter, level id → Task 2 (+ the level-id test); §5 two coordinates, wear, ragged edge, height-aware boundaries, four bands, lip, wet, retired constants → Task 4 with the constants and mirrors of Task 3; §6 trampled band and litter meshes → Task 5 (near-band-only became a 40 m class radius: the far band exists but ends where nothing that small reads — recorded as an amendment below); §7 tests → each task's step 1; §8 gates, §9 fallbacks → Task 6.

**Placeholders.** Task 2's pre-bench level id is obtained by a stated procedure, not guessed. No "TBD".

**Type consistency.** `Segment` gains `ua, ub, wa, wb` in Task 4 and `trailSegments` fills them from `TrailNode.u` and `nodeWidths`; `trailNearest` returns `{ d, ex, ez, k, t }` and `trailPaintAt` consumes `k, t`; `trampleAt` returns `{ height, lean, tint }` in Task 3 and `trampleFrame` extends it with `ax, az` in Task 5; `setWet`/`setTerrainWetness` in Task 4 are the names the renderer and tests use.

## Amendments (decisions made during execution)

- **§6, litter distance.** The class radius is 40 m in `CLUTTER_RADII`; the field's near/far split applies as to every class, so litter has a far band out to 40 m rather than "near band only". Nothing that small reads past 40 m either way.
- **§5, the bench colours.** The core and margin take the ground's vertex colour at `TRAIL_BENCH_SHADE = 0.6` rather than the material's white constant, with retuned tints `TRAIL_MARGIN_TINT = (0.40, 0.36, 0.30)` at gain 0.75 and `TRAIL_CORE_TINT = (0.30, 0.26, 0.21)` at gain 0.5 (margin about twice the core's brightness) and `TRAIL_TRAMPLE_TINT = (0.90, 0.88, 0.80)`, after the material-white version read as a chalk-line margin and a yellow trampled band.
- **§6, the lean axis.** The trampled cards lean about the axis `(az, 0, −ax)`, not its negation, so the top of the card moves along the away direction rather than into the bed.
- **§4, fungus clearance.** A test pins `CLUTTER_FUNGUS_TRAIL_CLEAR` to be no smaller than the wear- and junction-widened worst case, `TRAIL_BED_HALF · TRAIL_WEAR_W1 · TRAIL_JUNCTION_W + 0.28 · 1.3 + 0.5`, so a future wear or junction retune cannot shrink the clearance below where a stump could sit on a scuffed bed without the test catching it.
- **§7, the level id.** The `passHash` pin in `forest.test.ts` was re-pinned twice, once after the sink and width landed and once after the litter class and grass gate landed, each time recording the prior value in the commit.
- **§7, the litter scan test.** The "no instance farther than the fade" check scans a local 100 × 100 m window centred on a stem edge instead of the full clutter field, which a 1200 m square of 1 m cells makes far too slow.
