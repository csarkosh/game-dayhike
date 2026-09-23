# Ground Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grass wherever the floor is grass, thinned smoothly toward every non-grass neighbour and thickened in the open interior, with the thinning paid back by code-built dead leaves, twigs and branches so the ground reads full everywhere — inside a +2.0 ms bar at 4× pixels against current `main`.

**Architecture:** One pure ground-cover field in the sim (`groundCover` in `sim/clutter.ts`) returns `{ grass, duff }` at a point; the grass and meadow card classes, the blade field, a new duff field and the terrain paint all read it. The blade field pays for the interior boost by choosing a clump size per cell from the cover (thin / base / full, dithered so no contour forms). The duff layer is a second lattice field with its own code-built clumps, drawn through the thin-instance path the blades use. Card placement changes, so the new constants join the clutter pass's tunables and the level id moves.

**Tech Stack:** TypeScript, Babylon.js 9.18 (thin instances, PBR material plugins, NullEngine in tests), vitest.

**Spec:** `docs/rendering/2026-09-23-ground-cover-design.md`. The spec says "litter" for the leaves-and-twigs layer; in code it is **duff**, because `CLUTTER_LITTER` already names the trail-margin pebble class. Task 8 amends the spec.

## Global Constraints

- The repository is public. Code, comments, docs and commit messages describe the change and the running game, nothing about how the work was done.
- Stage explicit paths only. Never `git add -A` or `git add .`.
- Commit messages: a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then a parsing `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that wrote the commit.
- Every transition is a smoothstep or a dithered draw, never a threshold. A test that hard-thresholds where the spec says smooth must fail.
- Frame bar: +2.0 ms at 4× pixels (`SCALE=0.5`) against current `main`, paired both orders, two pairs, at MEADOW, DEEP and TRAILSIDE; native p95 under 17.5 ms. Every game page is blanked before each sample.
- The low tier's cost is untouched: no blades, no duff on low. Medium draws half blade counts and duff to 8 m.
- Sub-project 2 (the trail) consumes `duffClumpGeometry(character, count)` and `DUFF_CHARACTERS` from `duffClump.ts`; that interface does not change after Task 4.
- `sim/` imports nothing from `game/` or Babylon (`client/test/architecture.test.ts` enforces it). `duffClump.ts` and `bladeClump.ts` are Babylon-free.
- Docs live in `docs/rendering/` named `YYYY-MM-DD-<topic>.md`.

---

## File map

| file | task | responsibility |
| --- | --- | --- |
| `client/src/sim/clutter.ts` | 1 | `groundCover`, the new constants, the grass/meadow/flower classes reading it, the tunables registry |
| `client/test/sim/clutter.test.ts` | 1 | the field's continuity, fullness, boost and census properties |
| `client/src/game/bladeField.ts` | 2 | cells carry `cover`; `bladeSizeFor` |
| `client/src/game/bladeClump.ts` | 2, 3 | size factors, trimmed coarse counts; the exported strip writer |
| `client/src/game/bladeMeshes.ts` | 2 | buckets by tier × character × size |
| `client/src/game/duffClump.ts` | 4 | twig, branch and leaf-cluster geometry |
| `client/src/game/duffField.ts` | 5 | the duff lattice walk and collector |
| `client/src/game/duffMeshes.ts` | 6 | six buckets, the DUFF foliage profile, the rebuild |
| `client/src/game/foliagePlugin.ts` | 6 | the `DUFF` profile |
| `client/src/game/renderer.ts` | 6 | creates, updates and disposes the duff meshes beside the blades |
| `client/src/game/terrainSurface.ts`, `clipmap.ts` | 7 | the forest-floor paint weight follows `duff` |
| `ARCHITECTURE.md`, the spec, the verification note | 8 | docs |

---

### Task 1: The ground-cover field

**Files:**
- Modify: `client/src/sim/clutter.ts` (the grass constants block ending at `CLUTTER_GRASS_PATCH_HI`; `grassGateProduct`; the `CLUTTER_GRASS`, `CLUTTER_MEADOW`, `CLUTTER_FLOWER` cases of `clutterDensity`; `CLUTTER_TUNABLES`)
- Test: `client/test/sim/clutter.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `smoothstep` (module-local in `clutter.ts`), `fbm2`, `forestDensity`, `grassTrailGate`, the existing grass constants.
- Produces: `export type GroundCover = { grass: number; duff: number }`; `export function groundCover(seed: number, x: number, z: number, sample?: TerrainSample): GroundCover`; constants `CLUTTER_GRASS_CANOPY_FLOOR = 0.15`, `CLUTTER_GRASS_PATCH_FLOOR = 0.6`, `CLUTTER_GRASS_BOOST = 1.5`, `CLUTTER_GRASS_BOOST_LO = 0.5`, `CLUTTER_DUFF_OPEN = 0.15`, `CLUTTER_DUFF_ROAD_CLEAR = 2`; the trail's terms `CLUTTER_GRASS_TRAIL_CORE = 0.35`, `CLUTTER_GRASS_TRAIL_REACH: readonly [number, number] = [0.35, 1.3]`, `CLUTTER_GRASS_TRAIL_REACH_WAVE = 9`, `CLUTTER_DUFF_BED_MAX = 0.8`, `CLUTTER_DUFF_BED_FADE = 0.5`, `CLUTTER_DUFF_DRIFT_WAVE = 6`, `CLUTTER_DUFF_DRIFT_BAND: readonly [number, number] = [0.35, 0.65]`; `export function trailReach(seed: number, x: number, z: number): number` (the ramp scale `k` in `[0.35, 1.3]`); `export function grassTrailRamp(rt: number, k: number): number` (with `grassTrailGate(rt)` kept as `grassTrailRamp(rt, 1)`); `export function trailDriftNoise(seed: number, x: number, z: number): number` in `[0, 1]`. `grass` is in `[0, CLUTTER_GRASS_BOOST]`; `duff` in `[0, 1]`. The trail sub-project reads `duff` at the terrain vertex (Task 7) for its drift paint and defines nothing of its own in the field.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/sim/clutter.test.ts` (it already imports `describe, expect, it` from vitest, the passes index, and `clutterDensity`; add the new names to the existing import from `../../src/sim/clutter.js` and import `activeTerrainVariant` from `../../src/sim/terrain.js` and `forestDensity` from `../../src/sim/vegetation.js` if not already imported):

```ts
describe("groundCover", () => {
  const SEED = 1;
  const variant = () => activeTerrainVariant();
  // A point whose ground is grass (altitude and slope gates open) but far
  // from any road or trail, so the only edge in play is the canopy.
  function openGround(seed: number, x: number, z: number): boolean {
    const v = variant();
    const s = v.sample(seed, x, z);
    const alt = s.h > CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE && s.h < CLUTTER_GRASS_ALT_HI;
    const gentle = s.dx * s.dx + s.dz * s.dz < CLUTTER_GRASS_SLOPE_LO * CLUTTER_GRASS_SLOPE_LO * 0.5;
    const r = v.roadDistance?.(seed, x, z) ?? Infinity;
    const rt = v.trailDistance?.(seed, x, z) ?? Infinity;
    return alt && gentle && r > CLUTTER_GRASS_ROAD_FAR + 5 && rt > CLUTTER_GRASS_TRAIL_FAR + 5;
  }

  it("exports the spec's constants and joins them to the level id", () => {
    expect(CLUTTER_GRASS_CANOPY_FLOOR).toBe(0.15);
    expect(CLUTTER_GRASS_PATCH_FLOOR).toBe(0.6);
    expect(CLUTTER_GRASS_BOOST).toBe(1.5);
    expect(CLUTTER_GRASS_BOOST_LO).toBe(0.5);
    expect(CLUTTER_DUFF_OPEN).toBe(0.15);
    expect(CLUTTER_DUFF_ROAD_CLEAR).toBe(2);
    expect(CLUTTER_GRASS_TRAIL_CORE).toBe(0.35);
    expect(CLUTTER_GRASS_TRAIL_REACH).toEqual([0.35, 1.3]);
    expect(CLUTTER_GRASS_TRAIL_REACH_WAVE).toBe(9);
    expect(CLUTTER_DUFF_BED_MAX).toBe(0.8);
    expect(CLUTTER_DUFF_BED_FADE).toBe(0.5);
    expect(CLUTTER_DUFF_DRIFT_WAVE).toBe(6);
    expect(CLUTTER_DUFF_DRIFT_BAND).toEqual([0.35, 0.65]);
    for (const key of [
      "CLUTTER_GRASS_CANOPY_FLOOR", "CLUTTER_GRASS_PATCH_FLOOR", "CLUTTER_GRASS_BOOST", "CLUTTER_GRASS_BOOST_LO", "CLUTTER_DUFF_OPEN", "CLUTTER_DUFF_ROAD_CLEAR",
      "CLUTTER_GRASS_TRAIL_CORE", "CLUTTER_GRASS_TRAIL_REACH_LO", "CLUTTER_GRASS_TRAIL_REACH_HI", "CLUTTER_GRASS_TRAIL_REACH_WAVE",
      "CLUTTER_DUFF_BED_MAX", "CLUTTER_DUFF_BED_FADE", "CLUTTER_DUFF_DRIFT_WAVE", "CLUTTER_DUFF_DRIFT_LO", "CLUTTER_DUFF_DRIFT_HI",
    ]) {
      expect(CLUTTER_TUNABLES[key]).toBeTypeOf("number");
    }
  });

  it("keeps the path readable: no grass inside the bed's core, and the ramp's reach varies along the trail", () => {
    // A 200 m square around the trailside pose, scanned at 1 m; the bed's
    // core (rt < CORE) is a few hundred points of it.
    const v = variant();
    let core = 0, near = 0, nearGrass = 0;
    const reaches = new Set<number>();
    for (let x = 164; x <= 364; x += 1) {
      for (let z = 18; z <= 218; z += 1) {
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        if (rt < CLUTTER_GRASS_TRAIL_CORE) { expect(groundCover(SEED, x, z).grass).toBe(0); core++; }
        if (rt >= CLUTTER_GRASS_TRAIL_CORE && rt < 0.75) { near++; if (groundCover(SEED, x, z).grass > 0) nearGrass++; }
        if (rt < 3) reaches.add(Math.round(trailReach(SEED, x, z) * 20) / 20);
      }
    }
    expect(core).toBeGreaterThan(300);
    // Where the default ramp would still be closed (rt < 0.75), the modulated
    // one opens in places: encroachment exists, and is not everywhere.
    expect(nearGrass).toBeGreaterThan(0);
    expect(nearGrass).toBeLessThan(near);
    expect(reaches.size).toBeGreaterThan(6);
    for (const k of reaches) { expect(k).toBeGreaterThanOrEqual(0.35 - 1e-9); expect(k).toBeLessThanOrEqual(1.3 + 1e-9); }
    // The old gate is the ramp at k = 1.
    expect(grassTrailGate(1.5)).toBe(grassTrailRamp(1.5, 1));
  });

  it("gathers duff on the bed in drifts, and only there past the core", () => {
    const v = variant();
    let onBed = 0, drifted = 0;
    for (let x = 164; x <= 364; x += 1) {
      for (let z = 18; z <= 218; z += 1) {
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        if (rt > 0.75) continue;
        onBed++;
        const d = groundCover(SEED, x, z).duff;
        expect(d).toBeLessThanOrEqual(CLUTTER_DUFF_BED_MAX + 1e-9);
        const drift = trailDriftNoise(SEED, x, z);
        expect(drift).toBeGreaterThanOrEqual(0);
        expect(drift).toBeLessThanOrEqual(1);
        if (drift > CLUTTER_DUFF_DRIFT_BAND[1]) { expect(d).toBeGreaterThan(0.5 * CLUTTER_DUFF_BED_MAX); drifted++; }
        if (drift < CLUTTER_DUFF_DRIFT_BAND[0]) expect(d).toBeLessThan(0.2);
      }
    }
    expect(onBed).toBeGreaterThan(300);
    expect(drifted).toBeGreaterThan(30);
  });

  it("is the grass gate: the grass class and the meadow class read it", () => {
    for (const [x, z] of [[35, 21335], [-216, 414], [160, -234], [264, 118]]) {
      const cover = groundCover(SEED, x, z);
      expect(cover.grass).toBeGreaterThanOrEqual(0);
      expect(cover.grass).toBeLessThanOrEqual(CLUTTER_GRASS_BOOST);
      expect(cover.duff).toBeGreaterThanOrEqual(0);
      expect(cover.duff).toBeLessThanOrEqual(1);
      // clutterDensity multiplies the field by the feature mask, which is 1
      // away from every feature; at these points the two agree exactly.
      const g = clutterDensity(SEED, CLUTTER_GRASS, x, z);
      expect(g).toBeLessThanOrEqual(cover.grass + 1e-12);
    }
  });

  it("is continuous: no step larger than the bound along lines that cross every edge kind", () => {
    // Lines chosen to cross a coast (sand), a slope, a canopy edge, the trail
    // and the road on seed 1; each is 60 m long, sampled at 0.25 m.
    const lines: [number, number, number, number][] = [
      [0, 21300, 0, 21360],     // open field into canopy
      [35, 21335, 95, 21335],   // across the open interior
      [264, 88, 264, 148],      // across the trail
      [120, -260, 200, -260],   // across a road verge
      [-260, 380, -180, 440],   // toward the coast fade
    ];
    let maxGrassStep = 0, maxDuffStep = 0;
    for (const [x0, z0, x1, z1] of lines) {
      const n = 240;
      let prev = groundCover(SEED, x0, z0);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const cur = groundCover(SEED, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
        maxGrassStep = Math.max(maxGrassStep, Math.abs(cur.grass - prev.grass));
        maxDuffStep = Math.max(maxDuffStep, Math.abs(cur.duff - prev.duff));
        prev = cur;
      }
    }
    expect(maxGrassStep).toBeLessThan(0.15);
    expect(maxDuffStep).toBeLessThan(0.15);
  });

  it("keeps the floor full: grass/BOOST + duff stays in band wherever the only edge is the canopy", () => {
    let checked = 0;
    for (let x = -600; x <= 600; x += 12) {
      for (let z = 21000; z <= 22200; z += 12) {
        if (!openGround(SEED, x, z)) continue;
        const { grass, duff } = groundCover(SEED, x, z);
        const fullness = grass / CLUTTER_GRASS_BOOST + duff;
        expect(fullness).toBeGreaterThan(0.55);
        expect(fullness).toBeLessThan(1.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("boosts only inside: never above edge · patch where the edge product is under the boost start", () => {
    // Under dense canopy the edge product is small, so no boost may apply.
    let checked = 0;
    for (let x = -600; x <= 600; x += 12) {
      for (let z = 21000; z <= 22200; z += 12) {
        if (!openGround(SEED, x, z)) continue;
        const s = variant().sample(SEED, x, z);
        const rho = forestDensity(SEED, x, z, s);
        if (rho < CLUTTER_GRASS_CANOPY_HI) continue; // dense canopy only
        const { grass } = groundCover(SEED, x, z);
        // canopy ramp is at its floor, patch is at most 1
        expect(grass).toBeLessThanOrEqual(CLUTTER_GRASS_CANOPY_FLOOR + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("puts no duff on sand or rock, and on the bed's core only the drifts", () => {
    const v = variant();
    let sandChecked = 0, coreChecked = 0;
    for (let x = -600; x <= 600; x += 6) {
      for (let z = -600; z <= 600; z += 6) {
        const s = v.sample(SEED, x, z);
        if (s.h < CLUTTER_GRASS_ALT_LO) { expect(groundCover(SEED, x, z, s).duff).toBe(0); sandChecked++; }
        const rt = v.trailDistance?.(SEED, x, z) ?? Infinity;
        if (rt < 0.1) {
          // Inside the core the floor duff is closed; whatever remains is the bed drift.
          const d = groundCover(SEED, x, z, s).duff;
          expect(d).toBeLessThanOrEqual(CLUTTER_DUFF_BED_MAX + 1e-9);
          if (trailDriftNoise(SEED, x, z) < CLUTTER_DUFF_DRIFT_LO) expect(d).toBe(0);
          coreChecked++;
        }
      }
    }
    expect(sandChecked).toBeGreaterThan(100);
    expect(coreChecked).toBeGreaterThan(0);
  });

  it("grows grass wherever the floor is grass: the census share tracks the grass-ground share", () => {
    // Ground whose altitude and slope gates are open (alt · grade ≥ 0.9) is
    // grass ground; the field must clear the blade floor on nearly all of it.
    const v = variant();
    let onGrass = 0, covered = 0;
    for (let x = -600; x <= 600; x += 6) {
      for (let z = -600; z <= 600; z += 6) {
        const s = v.sample(SEED, x, z);
        const alt = smoothstepT(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, s.h) *
          (1 - smoothstepT(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h));
        const grade = 1 - smoothstepT(CLUTTER_GRASS_SLOPE_LO ** 2, CLUTTER_GRASS_SLOPE_HI ** 2, s.dx * s.dx + s.dz * s.dz);
        if (alt * grade < 0.9) continue;
        onGrass++;
        if (groundCover(SEED, x, z, s).grass >= 0.05) covered++;
      }
    }
    expect(onGrass).toBeGreaterThan(5000);
    expect(covered / onGrass).toBeGreaterThan(0.85);
  });

  it("is deterministic", () => {
    const a = groundCover(SEED, 35, 21335);
    const b = groundCover(SEED, 35, 21335);
    expect(a).toEqual(b);
  });
});

function smoothstepT(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/sim/clutter.test.ts -t groundCover`
Expected: FAIL — `groundCover` and the constants are not exported.

- [ ] **Step 3: Implement the field**

In `client/src/sim/clutter.ts`, after `CLUTTER_GRASS_PATCH_HI`:

```ts
/** The canopy ramp bottoms here, not at zero: a forest floor keeps a thin
 * sward under the densest canopy, and the duff fills the rest. */
export const CLUTTER_GRASS_CANOPY_FLOOR = 0.15;
/** The patch noise modulates between this and 1 instead of gating: grass
 * is everywhere the floor is grass, with the meadow-shaped variation kept. */
export const CLUTTER_GRASS_PATCH_FLOOR = 0.6;
/** Interior density multiplier, engaged only where every edge ramp is near 1. */
export const CLUTTER_GRASS_BOOST = 1.5;
/** The edge product at which the boost starts rising toward its full value at 1. */
export const CLUTTER_GRASS_BOOST_LO = 0.5;
/** Duff in thin OPEN grass, as a share of the duff under full canopy. */
export const CLUTTER_DUFF_OPEN = 0.15;
/** Duff clears the road over this many metres inside the grass's own road edge. */
export const CLUTTER_DUFF_ROAD_CLEAR = 2;
/** The bed's core (m from the centreline) never opens to grass, so the
 * path always reads however far the margins are overgrown. */
export const CLUTTER_GRASS_TRAIL_CORE = 0.35;
/** The trail ramp's reach varies along the trail between these multiples
 * of its default, by a value noise of this wavelength (m): in places grass
 * creeps across the margin and stands in islands, elsewhere it hangs back. */
export const CLUTTER_GRASS_TRAIL_REACH_LO = 0.35;
export const CLUTTER_GRASS_TRAIL_REACH_HI = 1.3;
export const CLUTTER_GRASS_TRAIL_REACH: readonly [number, number] = [CLUTTER_GRASS_TRAIL_REACH_LO, CLUTTER_GRASS_TRAIL_REACH_HI];
export const CLUTTER_GRASS_TRAIL_REACH_WAVE = 9;
/** Duff on the bed: at most this, gathered where the drift noise is inside
 * its band, fading out this far past the bed's edge. */
export const CLUTTER_DUFF_BED_MAX = 0.8;
export const CLUTTER_DUFF_BED_FADE = 0.5;
export const CLUTTER_DUFF_DRIFT_WAVE = 6;
export const CLUTTER_DUFF_DRIFT_LO = 0.35;
export const CLUTTER_DUFF_DRIFT_HI = 0.65;
export const CLUTTER_DUFF_DRIFT_BAND: readonly [number, number] = [CLUTTER_DUFF_DRIFT_LO, CLUTTER_DUFF_DRIFT_HI];
const CLUTTER_TRAIL_REACH_SALT = 0x5a17;
const CLUTTER_DUFF_DRIFT_SALT = 0x6d1f;

export type GroundCover = { grass: number; duff: number };

/** The trail ramp's reach at a point, in [REACH_LO, REACH_HI]: continuous, so the grass it gates is too. */
export function trailReach(seed: number, x: number, z: number): number {
  const n = valueNoise2(x / CLUTTER_GRASS_TRAIL_REACH_WAVE, z / CLUTTER_GRASS_TRAIL_REACH_WAVE, seed ^ CLUTTER_TRAIL_REACH_SALT);
  return CLUTTER_GRASS_TRAIL_REACH_LO + (CLUTTER_GRASS_TRAIL_REACH_HI - CLUTTER_GRASS_TRAIL_REACH_LO) * n;
}

/** The grass trail ramp at reach scale `k`: closed inside the core, open
 * past `near + (FAR − NEAR)·k`, where `near` is the core plus `k` times the
 * default margin. `grassTrailGate(rt)` is this ramp at k = 1. */
export function grassTrailRamp(rt: number, k: number): number {
  const near = CLUTTER_GRASS_TRAIL_CORE + (CLUTTER_GRASS_TRAIL_NEAR - CLUTTER_GRASS_TRAIL_CORE) * k;
  const far = near + (CLUTTER_GRASS_TRAIL_FAR - CLUTTER_GRASS_TRAIL_NEAR) * k;
  return smoothstep(near, far, rt);
}

/** Where litter gathers on the bed: a value noise in [0, 1] the duff reads. */
export function trailDriftNoise(seed: number, x: number, z: number): number {
  return valueNoise2(x / CLUTTER_DUFF_DRIFT_WAVE, z / CLUTTER_DUFF_DRIFT_WAVE, seed ^ CLUTTER_DUFF_DRIFT_SALT);
}
```

`grassTrailGate` becomes `export function grassTrailGate(rt: number): number { return grassTrailRamp(rt, 1); }`; its existing tests hold. Import `valueNoise2` from `./field.js` beside `fbm2, hash3`.

Replace `grassGateProduct` with:

```ts
/** The ground-cover field at a point: `grass` in [0, CLUTTER_GRASS_BOOST],
 * `duff` in [0, 1] — dead leaves, twigs and branches wherever grass thins on
 * grass ground. Every factor is a smoothstep of a continuous field, so both
 * numbers are continuous; nothing decides per cell. */
function groundCoverAt(seed: number, x: number, z: number, s: TerrainSample, r: number, rt: number, slopeSq: number): GroundCover {
  const alt =
    smoothstep(CLUTTER_GRASS_ALT_LO, CLUTTER_GRASS_ALT_LO + CLUTTER_GRASS_ALT_LO_FADE, s.h) *
    (1 - smoothstep(CLUTTER_GRASS_ALT_HI, CLUTTER_GRASS_ALT_HI + CLUTTER_GRASS_ALT_HI_FADE, s.h));
  const grade = 1 - smoothstep(
    CLUTTER_GRASS_SLOPE_LO * CLUTTER_GRASS_SLOPE_LO,
    CLUTTER_GRASS_SLOPE_HI * CLUTTER_GRASS_SLOPE_HI,
    slopeSq,
  );
  const onGrass = alt * grade;
  if (onGrass === 0) return { grass: 0, duff: 0 };
  const rho = forestDensity(seed, x, z, s);
  const shade = smoothstep(CLUTTER_GRASS_CANOPY_LO, CLUTTER_GRASS_CANOPY_HI, rho);
  const canopy = CLUTTER_GRASS_CANOPY_FLOOR + (1 - CLUTTER_GRASS_CANOPY_FLOOR) * (1 - shade);
  const road = smoothstep(CLUTTER_GRASS_ROAD_NEAR, CLUTTER_GRASS_ROAD_FAR, r);
  // The ramp's reach varies along the trail (encroachment); the core never opens.
  const trail = grassTrailRamp(rt, trailReach(seed, x, z));
  const patch = CLUTTER_GRASS_PATCH_FLOOR + (1 - CLUTTER_GRASS_PATCH_FLOOR) * smoothstep(
    CLUTTER_GRASS_PATCH_LO,
    CLUTTER_GRASS_PATCH_HI,
    0.5 + 0.5 * fbm2(x / CLUTTER_GRASS_PATCH_WAVELENGTH, z / CLUTTER_GRASS_PATCH_WAVELENGTH, seed ^ CLUTTER_PATCH_SALT, CLUTTER_GRASS_PATCH_OCTAVES),
  );
  const edge = onGrass * canopy * road * trail;
  const boost = 1 + (CLUTTER_GRASS_BOOST - 1) * smoothstep(CLUTTER_GRASS_BOOST_LO, 1, edge);
  const grass = edge * patch * boost;
  // Duff fills what the thinning takes: strongest under dense canopy, a
  // trace in thin open grass, and clear of the asphalt, which is painted by
  // its own system. Off the bed it also clears the bed's core; on the bed
  // it gathers in drifts where the drift noise says litter has collected,
  // fading out past the bed's edge. `max` keeps both continuous.
  const road2 = smoothstep(CLUTTER_GRASS_ROAD_NEAR - CLUTTER_DUFF_ROAD_CLEAR, CLUTTER_GRASS_ROAD_NEAR, r);
  const offBed = smoothstep(0, CLUTTER_GRASS_TRAIL_CORE, rt);
  const floorDuff = onGrass * Math.max(0, 1 - grass / CLUTTER_GRASS_BOOST) * (CLUTTER_DUFF_OPEN + (1 - CLUTTER_DUFF_OPEN) * shade) * offBed * road2;
  const onBed = 1 - smoothstep(CLUTTER_GRASS_TRAIL_NEAR, CLUTTER_GRASS_TRAIL_NEAR + CLUTTER_DUFF_BED_FADE, rt);
  const drift = smoothstep(CLUTTER_DUFF_DRIFT_LO, CLUTTER_DUFF_DRIFT_HI, trailDriftNoise(seed, x, z));
  const bedDuff = onGrass * onBed * drift * CLUTTER_DUFF_BED_MAX * road2;
  return { grass, duff: Math.max(floorDuff, bedDuff) };
}

export function groundCover(seed: number, x: number, z: number, sample?: TerrainSample): GroundCover {
  const variant = activeTerrainVariant();
  const s = sample ?? variant.sample(seed, x, z);
  const r = variant.roadDistance?.(seed, x, z) ?? Infinity;
  const rt = variant.trailDistance?.(seed, x, z) ?? Infinity;
  return groundCoverAt(seed, x, z, s, r, rt, s.dx * s.dx + s.dz * s.dz);
}
```

Note the old early return `if (s.h < ALT_LO || r < ROAD_NEAR || rt < TRAIL_NEAR) return 0` is gone: each of those is already a smoothstep that is exactly 0 below its start, so the product is 0 there without the cut, and `duff` needs the point evaluated.

In `clutterDensity`, replace the three call sites of `grassGateProduct(seed, x, z, s, r, rt, slopeSq)` with `groundCoverAt(seed, x, z, s, r, rt, slopeSq).grass` (the `CLUTTER_GRASS` case, the `CLUTTER_MEADOW` case and the `CLUTTER_FLOWER` `base`). Delete `grassGateProduct`.

Add the six new constants to `CLUTTER_TUNABLES` on the line after the `CLUTTER_GRASS_PATCH_*` entries:

```ts
  CLUTTER_GRASS_CANOPY_FLOOR, CLUTTER_GRASS_PATCH_FLOOR, CLUTTER_GRASS_BOOST, CLUTTER_GRASS_BOOST_LO,
  CLUTTER_DUFF_OPEN, CLUTTER_DUFF_ROAD_CLEAR,
  CLUTTER_GRASS_TRAIL_CORE, CLUTTER_GRASS_TRAIL_REACH_LO, CLUTTER_GRASS_TRAIL_REACH_HI, CLUTTER_GRASS_TRAIL_REACH_WAVE,
  CLUTTER_DUFF_BED_MAX, CLUTTER_DUFF_BED_FADE, CLUTTER_DUFF_DRIFT_WAVE, CLUTTER_DUFF_DRIFT_LO, CLUTTER_DUFF_DRIFT_HI,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root client test/sim/clutter.test.ts test/sim/passes/clutter.test.ts test/game/clutterField.test.ts test/game/bladeField.test.ts`
Expected: the new `describe` passes. Other tests that pinned exact grass densities at a point may move; where one does, the new value is the field's and the pin updates — the change is the point. The level-id test (`client/test/sim/forest.test.ts` or wherever the registry digest is pinned) must show the id moved; update its pin with the new digest and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/clutter.ts client/test/sim/clutter.test.ts
git commit
```
Subject: `feat: one ground-cover field for grass and duff`. The `## What` says grass now grows wherever the floor is grass, thins toward every non-grass neighbour, thickens inside, and duff fills the thinning; the `## How` lists the file, the constants, the three classes reading the field, the tunables (level id moves), and the tests.

---

### Task 2: The blade field reads cover, and a cell buys the clump its cover earns

**Files:**
- Modify: `client/src/game/bladeField.ts` (`BladeCell`, `bladeCellAt`, new `bladeSizeFor`, new constants)
- Modify: `client/src/game/bladeClump.ts` (`BLADE_TIER_COUNTS.high` coarse column; new `BLADE_SIZE_FACTOR`, `bladeCountFor`)
- Modify: `client/src/game/bladeMeshes.ts` (`bladeMeshName`, buckets, `fill`)
- Test: `client/test/game/bladeField.test.ts`, `client/test/game/bladeClump.test.ts`, `client/test/game/bladeMeshes.test.ts`

**Interfaces:**
- Consumes: `groundCover` from Task 1.
- Produces: `BladeCell.cover: number` (the field's `grass`, up to `CLUTTER_GRASS_BOOST`; `strength` stays `min(1, cover)`); `BladeCell.size: 0 | 1 | 2`; `export const BLADE_SIZE_THIN = 0, BLADE_SIZE_BASE = 1, BLADE_SIZE_FULL = 2, BLADE_SIZE_COUNT = 3`; `export const BLADE_THIN_BAND: readonly [number, number] = [0.4, 0.6]`; `export const BLADE_FULL_BAND: readonly [number, number] = [1.0, 1.25]`; `export function bladeSizeFor(draw: number, cover: number): number`; in `bladeClump.ts` `export const BLADE_SIZE_FACTOR: readonly [number, number, number] = [0.4, 1, 1.5]` and `export function bladeCountFor(quality: BladeQuality, character: number, tier: number, size: number): number`; `bladeMeshName(character, tier, size)`.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/bladeField.test.ts`, add to the constants `describe`:

```ts
  it("sizes a clump by its cover, dithered across the spec's bands so no contour forms", () => {
    expect(BLADE_THIN_BAND).toEqual([0.4, 0.6]);
    expect(BLADE_FULL_BAND).toEqual([1.0, 1.25]);
    // Outside both bands the choice is certain.
    for (let d = 0; d < 1; d += 0.05) {
      expect(bladeSizeFor(d, 0.2)).toBe(BLADE_SIZE_THIN);
      expect(bladeSizeFor(d, 0.8)).toBe(BLADE_SIZE_BASE);
      expect(bladeSizeFor(d, 1.5)).toBe(BLADE_SIZE_FULL);
    }
    // Inside a band the thin (or full) share falls (rises) monotonically and
    // continuously with cover: over 200 draws per step, no step of the share
    // is larger than 0.15.
    const share = (cover: number, size: number): number => {
      let n = 0;
      for (let i = 0; i < 200; i++) if (bladeSizeFor((i + 0.5) / 200, cover) === size) n++;
      return n / 200;
    };
    let prev = share(0.35, BLADE_SIZE_THIN);
    expect(prev).toBe(1);
    for (let c = 0.36; c <= 0.65; c += 0.01) {
      const cur = share(c, BLADE_SIZE_THIN);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - cur).toBeLessThan(0.15);
      prev = cur;
    }
    expect(prev).toBe(0);
    prev = share(0.95, BLADE_SIZE_FULL);
    expect(prev).toBe(0);
    for (let c = 0.96; c <= 1.3; c += 0.01) {
      const cur = share(c, BLADE_SIZE_FULL);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(cur - prev).toBeLessThan(0.15);
      prev = cur;
    }
    expect(prev).toBe(1);
  });
```

And in the cell tests: after the existing assertions on a cell from `bladeCellAt`, add

```ts
    expect(cell.cover).toBeCloseTo(groundCover(SEED, cell.x, cell.z).grass, 9);
    expect(cell.strength).toBe(Math.min(1, cell.cover));
    expect(cell.size).toBe(bladeSizeFor(cell.sizeDraw, cell.cover));
```

(import `groundCover` from `../../src/sim/clutter.js`; add `BLADE_THIN_BAND, BLADE_FULL_BAND, BLADE_SIZE_THIN, BLADE_SIZE_BASE, BLADE_SIZE_FULL, bladeSizeFor` to the bladeField import).

In `client/test/game/bladeClump.test.ts` "match the spec":

```ts
    expect(BLADE_TIER_COUNTS.high).toEqual([[100, 40, 10], [80, 28, 8], [12, 8, 4], [100, 32, 8]]);
    expect(BLADE_SIZE_FACTOR).toEqual([0.4, 1, 1.5]);
    expect(bladeCountFor("high", 0, 0, 0)).toBe(40);
    expect(bladeCountFor("high", 0, 0, 1)).toBe(100);
    expect(bladeCountFor("high", 0, 0, 2)).toBe(150);
    expect(bladeCountFor("high", 2, 2, 0)).toBe(4); // never under 4
```

and the vertex-budget test computes the worst case with every cell at `BLADE_SIZE_FULL` and must stay under `BLADE_VERTEX_BUDGET` (1_400_000 — recompute: fine 471 cells × 150 × 7 + mid 1,285 × 60 × 7 + coarse 4,847 × 15 × 7 ≈ 1.54 M for fine grass; if the test computes above the budget, the budget constant rises to 1_600_000 with its comment updated — the frame gate is the real bar).

In `client/test/game/bladeMeshes.test.ts`, the first test's expectations change: `blades.meshes.length` is `BLADE_CHARACTER_COUNT * 3 * BLADE_SIZE_COUNT`; the loop gains a size dimension; `bladeMeshName(ch, t, size)`; the geometry compares against `bladeClumpGeometry(BLADE_CHARACTERS[ch]!, bladeCountFor("high", ch, t, size))`. Add:

```ts
  it("routes each cell to the bucket of its character, tier and size", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const blades = createBladeMeshes(scene, SEED, { quality: "high" });
    blades.update(CAM.x, CAM.z);
    const tiers = createBladeCollector(SEED).collect(CAM.x, CAM.z);
    const lists = [tiers.fine, tiers.mid, tiers.coarse];
    for (let t = 0; t < 3; t++) {
      for (let ch = 0; ch < BLADE_CHARACTER_COUNT; ch++) {
        for (let size = 0; size < BLADE_SIZE_COUNT; size++) {
          const want = lists[t]!.filter((c) => c.character === ch && c.size === size).length;
          const mesh = scene.getMeshByName(bladeMeshName(ch, t, size)) as Mesh;
          expect(mesh.thinInstanceCount).toBe(want);
        }
      }
    }
    // At the census point the interior is boosted: full clumps outnumber thin ones in the fine tier.
    const full = tiers.fine.filter((c) => c.size === BLADE_SIZE_FULL).length;
    const thin = tiers.fine.filter((c) => c.size === BLADE_SIZE_THIN).length;
    expect(full).toBeGreaterThan(thin);
    blades.dispose();
    engine.dispose();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/game/bladeField.test.ts test/game/bladeClump.test.ts test/game/bladeMeshes.test.ts`
Expected: FAIL on the missing exports and the changed counts.

- [ ] **Step 3: Implement**

`client/src/game/bladeField.ts` — replace the `clutterDensity`/`CLUTTER_GRASS` import with `groundCover` (keep `CLUTTER_MEADOW`, `type ClutterInstance`); add after `BLADE_FLOWER_MIN_STRENGTH`:

```ts
/** Clump sizes a cell can buy, by its cover: thin below the thin band, full
 * above the full band, base between. Inside a band the choice is dithered by
 * the cell's own draw, so the share of each size is a smoothstep of cover
 * and no contour of clump size ever forms across the field. */
export const BLADE_SIZE_THIN = 0;
export const BLADE_SIZE_BASE = 1;
export const BLADE_SIZE_FULL = 2;
export const BLADE_SIZE_COUNT = 3;
export const BLADE_THIN_BAND: readonly [number, number] = [0.4, 0.6];
export const BLADE_FULL_BAND: readonly [number, number] = [1.0, 1.25];

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function bladeSizeFor(draw: number, cover: number): number {
  const pThin = 1 - smooth01(BLADE_THIN_BAND[0], BLADE_THIN_BAND[1], cover);
  if (draw < pThin) return BLADE_SIZE_THIN;
  const pFull = smooth01(BLADE_FULL_BAND[0], BLADE_FULL_BAND[1], cover);
  if (draw < pFull) return BLADE_SIZE_FULL;
  return BLADE_SIZE_BASE;
}
```

`BladeCell` gains `cover: number; size: number; sizeDraw: number;` with doc lines (`cover` is the field's grass up to `CLUTTER_GRASS_BOOST`; `strength` is `min(1, cover)`, the alive cut the shader applies). `bladeFieldCovers` becomes `groundCover(seed, x, z).grass >= BLADE_STRENGTH_FLOOR`. In `bladeCellAt`:

```ts
  const cover = groundCover(seed, x, z, s).grass;
  if (cover < BLADE_STRENGTH_FLOOR) return null;
  const strength = Math.min(1, cover);
  const characterDraw = cellDraw(ci, cj, 4);
  const sizeDraw = cellDraw(ci, cj, 5);
  return {
    ...,
    strength, cover, size: bladeSizeFor(sizeDraw, cover), sizeDraw,
    ...
  };
```

`client/src/game/bladeClump.ts`:

```ts
export const BLADE_TIER_COUNTS: Record<BladeQuality, readonly (readonly [number, number, number])[]> = {
  high: [[100, 40, 10], [80, 28, 8], [12, 8, 4], [100, 32, 8]],
  medium: [[50, 20, 5], [40, 14, 4], [6, 4, 2], [50, 16, 4]],
};
/** Blades per clump as a multiple of the tier's count, by size (thin, base, full). */
export const BLADE_SIZE_FACTOR: readonly [number, number, number] = [0.4, 1, 1.5];
/** A clump never carries fewer than this many blades. */
export const BLADE_COUNT_MIN = 4;
export function bladeCountFor(quality: BladeQuality, character: number, tier: number, size: number): number {
  const base = BLADE_TIER_COUNTS[quality][character]![tier]!;
  return Math.max(BLADE_COUNT_MIN, Math.round(base * (BLADE_SIZE_FACTOR[size] as number)));
}
```

`client/src/game/bladeMeshes.ts`: `bladeMeshName(character, tier, size)` returns `` `${BLADE_MESH_PREFIX}_c${character}_t${tier}_s${size}` ``; `createClumpMesh(scene, character, tier, size, count)`; buckets become `buckets[tier][character][size]` (`Bucket[][][]`), the tier loop nesting a size loop with `bladeCountFor(options.quality, ch, tier, size)`, the tier material shared by all twelve buckets of the tier and `tallest` taken over them; `fill(list, row: Bucket[][])` counts into `row[c.character]![c.size]!` and writes likewise; `rebuild` unchanged. `meshes` order: tier, character, size.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root client test/game/bladeField.test.ts test/game/bladeClump.test.ts test/game/bladeMeshes.test.ts test/game/clutterMeshes.test.ts test/architecture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/bladeField.ts client/src/game/bladeClump.ts client/src/game/bladeMeshes.ts client/test/game/bladeField.test.ts client/test/game/bladeClump.test.ts client/test/game/bladeMeshes.test.ts
git commit
```
Subject: `feat: a blade cell buys the clump its cover earns`.

---

### Task 3: Export the strip writer

**Files:**
- Modify: `client/src/game/bladeClump.ts` (extract `put`, `tri`, `strip` from `bladeClumpGeometry` into an exported factory)
- Test: `client/test/game/bladeClump.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StripArrays = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array; blade: Float32Array };
  export type StripWriter = StripArrays & {
    /** Vertices written so far. */
    readonly cursor: number;
    put(px, py, pz, nx, ny, nz, r, g, b, rootX, rootZ, random, h): number;
    tri(a: number, b: number, c: number): void;
    strip(baseX, baseY, baseZ, height, droop, hw, outX, outZ, yaw, random, tintR, tintG, tintB, rootX, rootZ): number;
  };
  export function createStripWriter(vertexCount: number, triangleCount: number): StripWriter;
  ```
  Behaviour identical to the closures they replace: `strip` writes `BLADE_VERTS` vertices and `BLADE_TRIS` triangles, rolls the normal by `BLADE_ROUND`, tints root→tip toward `BLADE_TIP_TINT`.

- [ ] **Step 1: Write the failing test**

```ts
describe("createStripWriter", () => {
  it("writes one strip as BLADE_VERTS vertices and BLADE_TRIS triangles, identically to the clump generator", () => {
    const w = createStripWriter(BLADE_VERTS, BLADE_TRIS);
    const first = w.strip(0.1, 0, 0.2, 0.4, 0.5, 0.01, 1, 0, 0.3, 0.42, 1, 1, 1, 0.1, 0.2);
    expect(first).toBe(0);
    expect(w.cursor).toBe(BLADE_VERTS);
    // The tip is the last vertex, at the strip's full height, bent outward by droop.
    const tip = BLADE_VERTS - 1;
    expect(w.positions[tip * 3 + 1]).toBeCloseTo(0.4, 9);
    expect(w.positions[tip * 3]).toBeCloseTo(0.1 + 0.4 * 0.5, 9);
    expect(w.blade[tip * 4 + 3]).toBe(1);
    // A one-blade clump through the public generator is the same strip.
    const g = bladeClumpGeometry(BLADE_CHARACTERS[BLADE_FINE]!, 1);
    expect(g.positions.length).toBe(BLADE_VERTS * 3);
    expect(g.indices.length).toBe(BLADE_TRIS * 3);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `createStripWriter` is not exported.

- [ ] **Step 3: Implement** — move the arrays, `v`, `ii`, `put`, `tri` and `strip` out of `bladeClumpGeometry` into `createStripWriter(n, tris)` returning them on one object (with `get cursor() { return v; }`), and have `bladeClumpGeometry` call `createStripWriter(bladeVertexCount(character, count), tris)` and use `w.strip(...)`, `w.positions[...]` where it read `positions` before. No behaviour changes; the existing `bladeClump.test.ts` tests must pass unchanged.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/bladeClump.test.ts test/game/bladeMeshes.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add client/src/game/bladeClump.ts client/test/game/bladeClump.test.ts`, subject `refactor: export the blade strip writer`.

---

### Task 4: The duff generator

**Files:**
- Create: `client/src/game/duffClump.ts`
- Test: `client/test/game/duffClump.test.ts`

**Interfaces:**
- Consumes: `createStripWriter`, `BLADE_VERTS`, `BLADE_TRIS` (Task 3); `latticeHash`; `Rgb`, `clamp01` from `./colour.js`.
- Produces (fixed for sub-project 2):
  ```ts
  export const DUFF_TWIG = 0; export const DUFF_LEAF = 1; export const DUFF_BRANCH = 2; export const DUFF_CHARACTER_COUNT = 3;
  export type DuffCharacter = { name: string; pieces: readonly [number, number]; length: readonly [number, number]; width: number; tint: Rgb; tintSpread: number; lift: readonly [number, number] };
  export const DUFF_CHARACTERS: readonly DuffCharacter[];
  export const DUFF_CLUMP_RADIUS = 0.3;
  export const DUFF_HEIGHT_MAX = 0.12;
  export const DUFF_ALBEDO: Rgb = { r: 0.16, g: 0.11, b: 0.06 };
  export const DUFF_TIER_COUNTS: Record<"high" | "medium", readonly [number, number]>; // pieces multiplier per tier (near, far)
  export type DuffClumpGeometry = StripArrays;
  export function duffVertexCount(character: DuffCharacter, count: number): number;
  export function duffClumpGeometry(character: DuffCharacter, count: number): DuffClumpGeometry;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  DUFF_ALBEDO, DUFF_BRANCH, DUFF_CHARACTERS, DUFF_CHARACTER_COUNT, DUFF_CLUMP_RADIUS, DUFF_HEIGHT_MAX, DUFF_LEAF, DUFF_TWIG,
  duffClumpGeometry, duffVertexCount,
} from "../../src/game/duffClump.js";
import { BLADE_TRIS, BLADE_VERTS } from "../../src/game/bladeClump.js";

describe("the duff characters", () => {
  it("match the spec", () => {
    expect(DUFF_CHARACTER_COUNT).toBe(3);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.length).toEqual([0.10, 0.25]);
    expect(DUFF_CHARACTERS[DUFF_TWIG]!.pieces).toEqual([2, 3]);
    expect(DUFF_CHARACTERS[DUFF_BRANCH]!.length).toEqual([0.30, 0.60]);
    expect(DUFF_CHARACTERS[DUFF_BRANCH]!.pieces).toEqual([1, 1]);
    expect(DUFF_CHARACTERS[DUFF_LEAF]!.pieces).toEqual([4, 6]);
    expect(DUFF_CLUMP_RADIUS).toBe(0.3);
    expect(DUFF_HEIGHT_MAX).toBe(0.12);
    expect(DUFF_ALBEDO).toEqual({ r: 0.16, g: 0.11, b: 0.06 });
  });
});

describe("duffClumpGeometry", () => {
  it("builds every character from strips: the declared vertex count, closed index ranges, unit normals", () => {
    for (const ch of DUFF_CHARACTERS) {
      for (const count of [1, 3]) {
        const g = duffClumpGeometry(ch, count);
        const n = duffVertexCount(ch, count);
        expect(g.positions.length).toBe(n * 3);
        expect(g.normals.length).toBe(n * 3);
        expect(g.colors.length).toBe(n * 4);
        expect(g.blade.length).toBe(n * 4);
        expect(g.indices.length % 3).toBe(0);
        for (const i of g.indices) expect(i).toBeLessThan(n);
        for (let v = 0; v < n; v++) {
          const l = Math.hypot(g.normals[v * 3]!, g.normals[v * 3 + 1]!, g.normals[v * 3 + 2]!);
          expect(l).toBeCloseTo(1, 6);
        }
      }
    }
  });

  it("lies on the ground: every vertex inside the clump disc and under the height cap, and lifted at most a little", () => {
    for (const ch of DUFF_CHARACTERS) {
      const g = duffClumpGeometry(ch, 3);
      for (let v = 0; v < g.positions.length / 3; v++) {
        const x = g.positions[v * 3]!, y = g.positions[v * 3 + 1]!, z = g.positions[v * 3 + 2]!;
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(DUFF_CLUMP_RADIUS + ch.length[1] + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(DUFF_HEIGHT_MAX + 1e-9);
      }
    }
  });

  it("colours every piece inside its character's palette", () => {
    for (const ch of DUFF_CHARACTERS) {
      const g = duffClumpGeometry(ch, 3);
      for (let v = 0; v < g.colors.length / 4; v++) {
        const r = g.colors[v * 4]!, gg = g.colors[v * 4 + 1]!, b = g.colors[v * 4 + 2]!;
        expect(r).toBeGreaterThanOrEqual(ch.tint.r * (1 - ch.tintSpread) - 1e-9);
        expect(r).toBeLessThanOrEqual(ch.tint.r * (1 + ch.tintSpread) + 1e-9);
        expect(gg).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(0);
        expect(g.colors[v * 4 + 3]).toBe(1);
      }
    }
  });

  it("carries the collapse attribute: every vertex names its piece's root and a random in [0, 1)", () => {
    const g = duffClumpGeometry(DUFF_CHARACTERS[DUFF_LEAF]!, 2);
    for (let v = 0; v < g.blade.length / 4; v++) {
      expect(Math.hypot(g.blade[v * 4]!, g.blade[v * 4 + 1]!)).toBeLessThanOrEqual(DUFF_CLUMP_RADIUS + 1e-9);
      expect(g.blade[v * 4 + 2]).toBeGreaterThanOrEqual(0);
      expect(g.blade[v * 4 + 2]).toBeLessThan(1);
    }
  });

  it("is deterministic", () => {
    const a = duffClumpGeometry(DUFF_CHARACTERS[DUFF_TWIG]!, 3);
    const b = duffClumpGeometry(DUFF_CHARACTERS[DUFF_TWIG]!, 3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it("stays under the vertex budget over the high tier's reach at full strength", () => {
    // 1 m lattice, near disc to 6 m + pad, far annulus to 12 m + pad, both padded 2.83 m.
    const pad = Math.SQRT2 * 2;
    const near = Math.PI * (6 + pad) ** 2, far = Math.PI * ((12 + pad) ** 2 - Math.max(0, 6 - 1.5 - pad) ** 2);
    let worst = 0;
    for (const ch of DUFF_CHARACTERS) {
      worst = Math.max(worst, near * duffVertexCount(ch, ch.pieces[1] * 2) + far * duffVertexCount(ch, ch.pieces[1]));
    }
    expect(worst).toBeLessThan(120_000);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement `client/src/game/duffClump.ts`**

```ts
import { type Rgb } from "./colour.js";
import { latticeHash } from "./groundHexParams.js";
import { BLADE_TRIS, BLADE_VERTS, createStripWriter, type StripArrays } from "./bladeClump.js";

/**
 * The duff clumps: dead leaves, twigs and small branches lying on the forest
 * floor, built from the blade strip writer so they shade and collapse like
 * the blades, on a lattice hash so they need no asset. Babylon-free; the
 * shell (duffMeshes.ts) wraps the arrays in meshes. The trail's own litter
 * (a separate piece of work) calls `duffClumpGeometry` with its own strength.
 *
 * A piece is a strip written upright by the writer, then laid down: rotated
 * about its root so its length runs along a ground direction with a small
 * lift at the far end, so twigs rest on the ground and leaves lie flat. The
 * `blade` attribute keeps the piece's root, so the field's collapse pulls the
 * whole piece to a point exactly as it does a blade.
 */

export const DUFF_TWIG = 0;
export const DUFF_LEAF = 1;
export const DUFF_BRANCH = 2;
export const DUFF_CHARACTER_COUNT = 3;

export type DuffCharacter = {
  name: string;
  /** Pieces per clump at count 1, [min, max], by the clump's draw. */
  pieces: readonly [number, number];
  /** Piece length (m) by the piece's draw. */
  length: readonly [number, number];
  /** Half-width (m) at the piece's base; a strip tapers to its tip. */
  width: number;
  /** Vertex colour, multiplied by a per-piece luma inside ±tintSpread. */
  tint: Rgb;
  tintSpread: number;
  /** Lift of the far end above the ground (rad), by the piece's draw. */
  lift: readonly [number, number];
};

/** Roots lie on a disc of this radius (m). */
export const DUFF_CLUMP_RADIUS = 0.3;
/** No vertex rises above this (m): duff is floor, never cover. */
export const DUFF_HEIGHT_MAX = 0.12;
/** The material's base albedo, linear: a dead-leaf brown. */
export const DUFF_ALBEDO: Rgb = { r: 0.16, g: 0.11, b: 0.06 };
/** Piece-count multiplier per tier (near, far). */
export const DUFF_TIER_COUNTS: Record<"high" | "medium", readonly [number, number]> = {
  high: [2, 1],
  medium: [1, 1],
};

export const DUFF_CHARACTERS: readonly DuffCharacter[] = [
  { name: "twig", pieces: [2, 3], length: [0.10, 0.25], width: 0.005, tint: { r: 1.0, g: 0.85, b: 0.65 }, tintSpread: 0.25, lift: [0.05, 0.25] },
  { name: "leaf cluster", pieces: [4, 6], length: [0.04, 0.07], width: 0.022, tint: { r: 1.15, g: 0.80, b: 0.45 }, tintSpread: 0.3, lift: [0.0, 0.12] },
  { name: "small branch", pieces: [1, 1], length: [0.30, 0.60], width: 0.010, tint: { r: 0.85, g: 0.70, b: 0.55 }, tintSpread: 0.2, lift: [0.02, 0.15] },
];

export type DuffClumpGeometry = StripArrays;

function draw(i: number, salt: number): number {
  return latticeHash(i + 977, salt + 313);
}

function pieceCount(character: DuffCharacter, count: number): number {
  const [lo, hi] = character.pieces;
  return count * (lo + Math.floor(draw(7, 11) * (hi - lo + 1)));
}

/** A branch is one strip plus a fork strip; every other piece is one strip. */
function stripsPer(character: DuffCharacter): number {
  return character === DUFF_CHARACTERS[DUFF_BRANCH] ? 2 : 1;
}

export function duffVertexCount(character: DuffCharacter, count: number): number {
  return pieceCount(character, count) * stripsPer(character) * BLADE_VERTS;
}

/** Rotates the vertices [first, first + n) about the piece's root so the
 * strip's +y length runs along (dirX, dirZ), rising by `lift` radians. The
 * normals rotate with them. */
function layDown(g: StripArrays, first: number, n: number, rootX: number, rootZ: number, dirX: number, dirZ: number, lift: number): void {
  const cl = Math.cos(lift), sl = Math.sin(lift);
  for (let v = first; v < first + n; v++) {
    const px = g.positions[v * 3]! - rootX, py = g.positions[v * 3 + 1]!, pz = g.positions[v * 3 + 2]! - rootZ;
    // Local frame: y (length) → along dir with lift; the strip's own width
    // axis stays horizontal, so a leaf lies flat and a twig rests on its side.
    const along = py * cl, up = py * sl;
    g.positions[v * 3] = rootX + px + dirX * along;
    g.positions[v * 3 + 1] = up;
    g.positions[v * 3 + 2] = rootZ + pz + dirZ * along;
    const nx = g.normals[v * 3]!, ny = g.normals[v * 3 + 1]!, nz = g.normals[v * 3 + 2]!;
    // The upright strip's normal lies in the horizontal plane; laid down, the
    // face turns to look up. Blend toward up by how flat the piece lies.
    const ux = nx * sl, uy = cl, uz = nz * sl;
    const l = Math.hypot(ux, uy, uz) || 1;
    g.normals[v * 3] = ux / l; g.normals[v * 3 + 1] = uy / l; g.normals[v * 3 + 2] = uz / l;
    void ny;
  }
}

export function duffClumpGeometry(character: DuffCharacter, count: number): DuffClumpGeometry {
  const pieces = pieceCount(character, count);
  const strips = stripsPer(character);
  const w = createStripWriter(pieces * strips * BLADE_VERTS, pieces * strips * BLADE_TRIS);
  for (let p = 0; p < pieces; p++) {
    const random = draw(p, 1);
    const rho = DUFF_CLUMP_RADIUS * Math.sqrt(draw(p, 2));
    const phi = 2 * Math.PI * draw(p, 3);
    const rootX = rho * Math.cos(phi), rootZ = rho * Math.sin(phi);
    const length = character.length[0] + (character.length[1] - character.length[0]) * draw(p, 4);
    const yaw = 2 * Math.PI * draw(p, 5);
    const lift = character.lift[0] + (character.lift[1] - character.lift[0]) * draw(p, 6);
    const luma = 1 + character.tintSpread * (2 * draw(p, 8) - 1);
    const dirX = Math.cos(yaw), dirZ = Math.sin(yaw);
    // Written upright with no droop, then laid along its direction.
    const first = w.strip(rootX, 0, rootZ, length, 0, character.width, dirX, dirZ, yaw + Math.PI / 2,
      random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma, rootX, rootZ);
    layDown(w, first, BLADE_VERTS, rootX, rootZ, dirX, dirZ, lift);
    if (strips === 2) {
      // The fork: a shorter strip from 60 % along the branch, 35° off its line.
      const fx = rootX + dirX * length * 0.6 * Math.cos(lift), fz = rootZ + dirZ * length * 0.6 * Math.cos(lift);
      const fyaw = yaw + (draw(p, 9) < 0.5 ? 0.61 : -0.61);
      const fdx = Math.cos(fyaw), fdz = Math.sin(fyaw);
      const f2 = w.strip(fx, 0, fz, length * 0.45, 0, character.width * 0.7, fdx, fdz, fyaw + Math.PI / 2,
        random, character.tint.r * luma, character.tint.g * luma, character.tint.b * luma, rootX, rootZ);
      layDown(w, f2, BLADE_VERTS, fx, fz, fdx, fdz, lift);
      // The fork's base sits at the branch's height there.
      const baseY = length * 0.6 * Math.sin(lift);
      for (let v = f2; v < f2 + BLADE_VERTS; v++) w.positions[v * 3 + 1] = Math.min(DUFF_HEIGHT_MAX, w.positions[v * 3 + 1]! + baseY);
    }
    for (let v = first; v < first + BLADE_VERTS; v++) w.positions[v * 3 + 1] = Math.min(DUFF_HEIGHT_MAX, w.positions[v * 3 + 1]!);
  }
  return { positions: w.positions, normals: w.normals, colors: w.colors, indices: w.indices, blade: w.blade };
}
```

The writer's `strip` tints root→tip toward `BLADE_TIP_TINT`; for duff that reads as a paler tip on each piece, which is right for a dead leaf and harmless for a twig. The `blade` attribute's height fraction is the strip's own `h`, unused by the shader.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/duffClump.test.ts test/architecture.test.ts` — PASS. If the height-cap test fails on a long branch at a high lift, the `lift` upper bound for the branch drops until `0.6 · sin(lift) ≤ 0.12` (0.2 rad).

- [ ] **Step 5: Commit** — `git add client/src/game/duffClump.ts client/test/game/duffClump.test.ts`, subject `feat: build dead leaves, twigs and branches in code`.

---

### Task 5: The duff field

**Files:**
- Create: `client/src/game/duffField.ts`
- Test: `client/test/game/duffField.test.ts`

**Interfaces:**
- Consumes: `groundCover` (Task 1); `DUFF_CHARACTER_COUNT`, the character ids (Task 4); `latticeHash`; `ClutterInstance`, `CLUTTER_LITTER`; `activeTerrainVariant`; `forestDensity`; `BladeEdges` from `bladeField.ts`.
- Produces:
  ```ts
  export const DUFF_CELL = 1; export const DUFF_REBUILD_CELL = 1;
  export const DUFF_PAD = Math.SQRT2 * (DUFF_REBUILD_CELL + DUFF_CELL);
  export const DUFF_REACH: Record<"high" | "medium", number> = { high: 12, medium: 8 };
  export const DUFF_TIER_EDGE = 6; export const DUFF_TIER_BAND = 1.5; export const DUFF_COLLAPSE_BAND = 2;
  export const DUFF_STRENGTH_FLOOR = 0.05; export const DUFF_JITTER = 0.4;
  export const DUFF_CHARACTER_WEIGHTS: readonly number[] = [0.55, 0.35, 0.10];
  export type DuffCell = ClutterInstance & { strength: number; canopy: number; character: number; characterDraw: number };
  export type DuffTiers = { near: DuffCell[]; far: DuffCell[] };
  export function duffTierBands(reach: number): [BladeEdges, BladeEdges];
  export function duffCharacterFor(draw: number): number;
  export function duffCellAt(seed: number, ci: number, cj: number): DuffCell | null;
  export function collectDuffCells(seed: number, camX: number, camZ: number, reach: number): DuffTiers;
  export type DuffCollector = { collect(camX: number, camZ: number, reach: number): DuffTiers; readonly size: number };
  export function createDuffCollector(seed: number): DuffCollector;
  ```
  Cells are `cls: CLUTTER_LITTER, scale: 1, variant: DUFF_CHARACTER_COUNT` — the variant is out of `LITTER_VARIANT_SCALE`'s range on purpose, so `instanceMatrixFor` applies no pebble scale and the `TILTED` path lays the piece on the ground normal.

- [ ] **Step 1: Write the failing tests** — mirror `bladeField.test.ts` with the duff names: constants pinned as above; `duffTierBands(12)` equals `[[-2, -1, 4.5, 6], [4.5, 6, 10, 12]]`; `duffCharacterFor` walks the weights (0.5 → twig, 0.7 → leaf, 0.95 → branch); `duffCellAt` at a cell under canopy on seed 1 (the point (0, 21340) lies in the census field's forest edge — the test scans a 40 m square around it for the first cell that is non-null and asserts `strength` equals `groundCover(SEED, x, z).duff`, `cls === CLUTTER_LITTER`, `variant === DUFF_CHARACTER_COUNT`, `character === duffCharacterFor(characterDraw)`); `collectDuffCells` returns nearest-first lists with the near list inside `6 + DUFF_PAD` and the far list inside `12 + DUFF_PAD` and outside `6 − 1.5 − DUFF_PAD`; the collector's output equals the pure walk's and its `size` grows only by the newly entered ring on a 1 m step.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** `duffField.ts` as `bladeField.ts` with: the constants above; `duffTierBands(reach)` returning `[[GROW_NONE[0], GROW_NONE[1], DUFF_TIER_EDGE - DUFF_TIER_BAND, DUFF_TIER_EDGE], [DUFF_TIER_EDGE - DUFF_TIER_BAND, DUFF_TIER_EDGE, reach - DUFF_COLLAPSE_BAND, reach]]`; `duffCellAt` sampling `groundCover(seed, x, z, s).duff` as strength with the floor; `collectDuffCore` with two lists; the same numeric-key cache and sweep (`DUFF_SWEEP_SIZE = 8000`, `EVICT_RADIUS = reach + DUFF_PAD + 8`). The `cellDraw` salts differ from the blades' (use `ci + 151 * salt, cj + 191 * salt`) so the two lattices never correlate.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/duffField.test.ts test/architecture.test.ts` — PASS.

- [ ] **Step 5: Commit** — subject `feat: walk a duff lattice from the ground-cover field`.

---

### Task 6: The duff meshes and the renderer

**Files:**
- Create: `client/src/game/duffMeshes.ts`
- Modify: `client/src/game/foliagePlugin.ts` (`FOLIAGE_PROFILES.DUFF`)
- Modify: `client/src/game/renderer.ts` (beside every `createBladeMeshes` / `blades.update` / `blades.dispose` site)
- Test: `client/test/game/duffMeshes.test.ts`, `client/test/game/foliagePlugin.test.ts`, `client/test/game/renderer.test.ts`

**Interfaces:**
- Consumes: Tasks 4 and 5; `attachFoliage`, `attachFoliageLight`, `setFoliageBladeEdges`, `FOLIAGE_PROFILES`; `prepBucketMesh`, `instanceMatrixFor`, `trampleFrame`, `writeFoliage` from `clutterMeshes.ts`.
- Produces: `export const DUFF_MESH_PREFIX = "duff_clumps"`; `export function duffMeshName(character: number, tier: number): string`; `export type DuffMeshes = { update(camX, camZ): void; readonly meshes: readonly Mesh[]; dispose(): void }`; `export function createDuffMeshes(scene: Scene, seed: number, options: { quality: "high" | "medium" }): DuffMeshes`; `FOLIAGE_PROFILES.DUFF = { amp: 0, groundTint: 0.7, rootAO: 0.6, normalRoot: 0, tilt: false, bend: false, blades: true, normalUp: 0.5 }`.

- [ ] **Step 1: Write the failing tests**

`duffMeshes.test.ts` mirrors the first two `bladeMeshes.test.ts` tests: six meshes named `duff_clumps_c{ch}_t{t}` on two materials with `DUFF_ALBEDO`, the `Foliage` plugin wearing `bladeEdges` equal to `duffTierBands(DUFF_REACH.high)[t]`, `FoliageLight` attached, no `DistanceFade`, `receiveShadows` true; after `update(CAM)`, each bucket's `thinInstanceCount` equals the collector's per-character count for its tier at a canopy point (scan for one as Task 5's test does); the 1 m rebuild cadence (no second `thinInstanceSetBuffer` call for a 0.4 m move, one for a 1.1 m move); `dispose` empties the scene of `duff_clumps` meshes. `foliagePlugin.test.ts`: the DUFF profile's values, and `amp: 0` yields a zero wind displacement through the plugin's uniform (the existing wind test parameterised over the profile). `renderer.test.ts`: on `high` and `medium` the scene holds six `duff_clumps` meshes; on `low` none.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** `duffMeshes.ts` as `bladeMeshes.ts` with: `Bucket` without `strength` (the DUFF profile still declares `bladeStrength`; write `c.strength` into it so the shader's per-piece cut works the same way); two tiers × three characters; `createClumpMesh` from `duffClumpGeometry(DUFF_CHARACTERS[ch]!, DUFF_TIER_COUNTS[quality][tier])`; the tier material with `attachFoliage(mat, FOLIAGE_PROFILES.DUFF, tallest)`, `attachFoliageLight(mat)`, `setFoliageBladeEdges(mat, duffTierBands(DUFF_REACH[quality])[tier])`, `albedoColor` `DUFF_ALBEDO`, roughness 0.9; `fill` writing the instance matrix through `instanceMatrixFor(c, frame, scratchMat)` with `trampleFrame(seed, c)` (the litter class is not trampled, so the frame is the identity) and `writeFoliage` for the tint. In `renderer.ts`, wherever `createBladeMeshes(scene, forest.seed, { quality })` is created for `tier !== "low"`, create `createDuffMeshes(scene, forest.seed, { quality })` beside it; update it with the same eye position in both the freecam and player branches; dispose it beside the blades. Add `DUFF` to `FOLIAGE_PROFILES`.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/duffMeshes.test.ts test/game/foliagePlugin.test.ts test/game/renderer.test.ts test/game/bladeMeshes.test.ts` — PASS.

- [ ] **Step 5: Commit** — subject `feat: draw the duff field beside the blades`.

---

### Task 7: The paint follows the duff

**Files:**
- Modify: `client/src/game/terrainSurface.ts` (`classifySurface` signature and body; new `DUFF_FLOOR_MAX`, `NEEDLE_BED`)
- Modify: `client/src/game/clipmap.ts:93-95`
- Test: `client/test/game/terrainSurface.test.ts`, `client/test/game/clipmap.test.ts`

**Interfaces:**
- Consumes: `groundCover` (Task 1).
- Produces: `classifySurface(seed, x, z, altitude, slope, canopy = 0, duff = 0)`; `export const DUFF_FLOOR_MAX = 0.75`; `export const NEEDLE_BED: Rgb = { r: 0.10, g: 0.07, b: 0.04 }`.

- [ ] **Step 1: Write the failing tests**

```ts
  it("pulls the floor weight and colour toward leaf litter with duff, and leaves duff = 0 bitwise identical", () => {
    const [x, z, altitude, slope, canopy] = [35, 21335, 40, 0.1, 0.7];
    const base = classifySurface(SEED, x, z, altitude, slope, canopy);
    const same = classifySurface(SEED, x, z, altitude, slope, canopy, 0);
    expect(same).toEqual(base);
    let prev = base.weights.forestFloor;
    for (let d = 0.1; d <= 1; d += 0.1) {
      const cur = classifySurface(SEED, x, z, altitude, slope, canopy, d);
      expect(cur.weights.forestFloor).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(cur.weights.forestFloor).toBeLessThanOrEqual(1);
      prev = cur.weights.forestFloor;
    }
    const full = classifySurface(SEED, x, z, altitude, slope, canopy, 1);
    expect(full.weights.forestFloor).toBeGreaterThan(base.weights.forestFloor);
    expect(full.weights.forestFloor - base.weights.forestFloor).toBeLessThanOrEqual(DUFF_FLOOR_MAX + 1e-12);
    // Under canopy the duff colour leans toward the needle bed: darker and browner than the base.
    expect(full.albedo.g).toBeLessThan(base.albedo.g);
  });
```

and in `clipmap.test.ts`: a ring vertex under canopy on seed 1 carries a `forestFloor` weight equal to `classifySurface(seed, x, z, h, slope, canopy, groundCover(seed, x, z, s).duff).weights.forestFloor`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — in `terrainSurface.ts` add the two constants, the `duff = 0` parameter, and after the canopy tint line:

```ts
  // Duff: where the ground-cover field says the grass has thinned into dead
  // leaves and twigs, the floor paints as leaf litter under them, leaning to
  // a needle bed the denser the canopy, so the gaps between pieces read as
  // full rather than as painted grass with twigs on it. A smoothstep of the
  // field, never a threshold; zero duff leaves every value bitwise unchanged.
  const litter = clamp01(duff) * DUFF_FLOOR_MAX;
  w = mixW(w, W_FLOOR, litter);
  colour = mixRgb(colour, mixRgb(FOREST_FLOOR, NEEDLE_BED, canopy), litter);
```

In `clipmap.ts` pass `groundCover(seed, x, z, s).duff` as the seventh argument (import `groundCover` from `../sim/clutter.js`).

- [ ] **Step 4: Run** `npx vitest run --root client test/game/terrainSurface.test.ts test/game/clipmap.test.ts` — PASS.

- [ ] **Step 5: Commit** — subject `feat: paint the floor as litter where the duff lies`.

---

### Task 8: Docs and the gates

**Files:**
- Modify: `ARCHITECTURE.md` (the rendering paragraph's near-field sentences)
- Modify: `docs/rendering/2026-09-23-ground-cover-design.md` (amendments)
- Create: `docs/rendering/2026-09-23-ground-cover-verification.md`

- [ ] **Step 1: Amend the spec** — append to its "12. Amendments" section (the naming and the trail's terms are already there): the canopy ramp bottoms at `CLUTTER_GRASS_CANOPY_FLOOR = 0.15` (a census showed 96 % of grass ground under canopy on one world, so a zero floor would have left the near field duff-only there); the interior boost is realised as a third clump size (thin / base / full) chosen per cell from its cover with dithered bands, which generalises the spec's thin-cell rule; duff clears the road by `CLUTTER_DUFF_ROAD_CLEAR`.
- [ ] **Step 2: `ARCHITECTURE.md`** — in the rendering paragraph, after the blade-field sentences, add: the near field reads one ground-cover field in the sim (`groundCover`, `sim/clutter.ts`) that thins grass toward every non-grass neighbour and thickens it inside, and where it thins a second lattice (`duffField.ts`, `duffMeshes.ts`, `duffClump.ts`) lays code-built dead leaves, twigs and branches on the floor, whose paint follows the same field; a cell buys the clump size its cover earns, dithered so no contour forms. The low tier gets the paint only.
- [ ] **Step 3: Run the gates** from the spec's section 9 and record them in the verification note, in the format of `docs/rendering/2026-09-22-blade-field-verification.md`: method (sun pinned, pages blanked, 8 s samples), the stills with before/after clump counts at MEADOW, an edge to sand, an edge to the trail, DEEP under canopy, and the seam pose, under clear noon and mist; the frame pairs at 4× pixels (two pairs, both orders) at MEADOW, DEEP and TRAILSIDE against current `main`, and the native p95; the fallback taken if any; the gaps left open.
- [ ] **Step 4: Run the whole suite** with `npx vitest run --root client --maxWorkers=3` and the server and tools roots, then `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git add ARCHITECTURE.md docs/rendering/2026-09-23-ground-cover-design.md docs/rendering/2026-09-23-ground-cover-verification.md`, subject `docs: describe the ground-cover field and record its gates`.

---

## Self-review

**Spec coverage.** §4 the field → Task 1 (with the canopy floor amendment in Task 8). §5 the generator and field → Tasks 3–5; the interface sub-project 2 depends on is fixed in Task 4. §6 paint coupling → Task 7. §7 tiers and budget: the thin-cell rule and coarse trim → Task 2; medium halves and 8 m duff → Tasks 2, 5, 6; low untouched → Task 6 (renderer creates duff only off low) and Task 7 (paint everywhere). §8 tests → each task's Step 1; the census as a property in Task 1. §9 gates, §10 fallbacks → Task 8. §11 merge order → the interface freeze in Task 4. Release (level id) → Task 1's tunables.

**Placeholders.** None: every step names its code, its command and its expected result; Task 5 and Task 6 describe their tests by mirroring named tests in named files with the exact values that differ.

**Type consistency.** `groundCover(seed, x, z, sample?) → { grass, duff }` is used identically in Tasks 1, 2, 5, 7. `BladeCell.cover/size/sizeDraw` (Task 2) match `bladeMeshes` routing (Task 2). `createStripWriter` returns `StripArrays & { cursor, put, tri, strip }` (Task 3) and Task 4 uses `w.strip`, `w.positions`, `w.cursor`. `DuffCell` (Task 5) is a `ClutterInstance`, which `instanceMatrixFor`, `trampleFrame` and `writeFoliage` accept (Task 6). `classifySurface`'s seventh parameter defaults to 0 (Task 7), so Task 6's and every other caller stay bitwise identical.

**Known risks the executor should watch.** The continuity bound in Task 1 (0.15 per 0.25 m) depends on `forestDensity`'s own smoothness; if a line crosses a hard feature-mask edge the test line moves, not the bound. The vertex budget in Task 2 may need the constant raised to 1.6 M; the frame gate is the real bar.
