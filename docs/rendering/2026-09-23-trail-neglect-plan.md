# Trail Neglect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trail bed reads as neglected everywhere — leaf and needle drifts, gravel washed out to dirt, loose stone and twigs along the margins, the grass beside it no longer trampled flat — while the bed's core stays traceable in every still.

**Architecture:** The ground-cover field (already on `main` in the grass plan) carries the trail's encroachment and its bed-litter drifts; this plan only reads them. The terrain clipmap gains one vertex channel carrying `duff` so the trail paint can read the drift the litter lies on, and `trailPaint.ts` gains two patch modulations (drifts from that channel, wash-outs from a paint-native noise) and a darker core, mirrored in TypeScript and pinned by tests as the bands are today. The pebble litter density and the trample strength move.

**Tech Stack:** TypeScript, Babylon.js 9.18 (GLSL in template strings spliced by the terrain plugin), vitest.

**Spec:** `docs/rendering/2026-09-23-trail-neglect-design.md`. Runs **after** the ground-cover plan (`docs/rendering/2026-09-23-ground-cover-plan.md`) lands on `main`; Task 1 depends on its Task 7 (`classifySurface` receiving `duff`, `clipmap.ts` calling `groundCover`).

## Global Constraints

- The repository is public. Code, comments, docs and commit messages describe the change and the running game, nothing about how the work was done.
- Stage explicit paths only. Never `git add -A` or `git add .`.
- Commit messages: a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then a parsing `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that wrote the commit.
- Every patch edge is a smoothstep of a continuous field; no threshold. A test that hard-thresholds where the spec says smooth must fail.
- The bed's core stays readable: no paint change may drive the core band's weight to zero.
- Frame bar: +0.5 ms at 4× pixels (`SCALE=0.5`), paired both orders, two pairs, at TRAIL and TRAILSIDE against `main` after the ground cover; native p95 under 17.5 ms. Every game page blanked before each sample.
- GLSL comment rule (this repo has been bitten twice): no hashed preprocessor keyword and no semicolon inside a trailing comment on a code line inside the shader strings.
- Docs live in `docs/rendering/` named `YYYY-MM-DD-<topic>.md`.

---

## File map

| file | task | responsibility |
| --- | --- | --- |
| `client/src/game/clipmap.ts`, `client/src/game/terrainTexture.ts` | 1 | a third terrain weight channel carrying `duff` to the fragment |
| `client/src/game/trailBenchParams.ts` | 2 | drift and wash-out constants and their TypeScript mirrors; the darker core |
| `client/src/game/trailPaint.ts` | 2 | the GLSL: drifts, wash-outs, the darker core |
| `client/src/sim/clutter.ts`, `client/src/game/trailBenchParams.ts` | 3 | pebble litter density; trample strength |
| `ARCHITECTURE.md`, the verification note | 3 | docs |

---

### Task 1: Carry `duff` to the fragment

**Files:**
- Modify: `client/src/game/clipmap.ts` (the ring vertex write around line 93–108; the `weights2` buffer's stride)
- Modify: `client/src/game/terrainTexture.ts` (the `terrainWeights2` attribute and `vTerrainW2` varying declarations, lines ~343–363)
- Test: `client/test/game/clipmap.test.ts`, `client/test/game/terrainTexture.test.ts`

**Interfaces:**
- Consumes: `groundCover(seed, x, z, sample)` from `sim/clutter.ts` (already called in `clipmap.ts` for `classifySurface`'s seventh argument).
- Produces: `terrainWeights2` is `vec3` (pebble, detail, duff); `vTerrainW2.z` is the vertex's duff in [0, 1]; `RingSamples.weights2` stride 3; `export const WEIGHTS2_STRIDE = 3` in `clipmap.ts`.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/clipmap.test.ts`, beside the existing weights test:

```ts
  it("carries the ground-cover duff as the third weight of every ring vertex", () => {
    const ring = buildRingForTest(); // the helper the existing weights test uses
    for (let at = 0; at < ring.count; at++) {
      const x = ring.positions[at * 3]!, z = ring.positions[at * 3 + 2]!;
      const s = elevationSampleAt(SEED, x, z);
      const want = groundCover(SEED, x, z, s).duff;
      expect(ring.weights2[at * WEIGHTS2_STRIDE + 2]).toBeCloseTo(want, 6);
      expect(ring.weights2[at * WEIGHTS2_STRIDE + 1]).toBeGreaterThanOrEqual(0); // detail still second
    }
    expect(WEIGHTS2_STRIDE).toBe(3);
  });
```

In `client/test/game/terrainTexture.test.ts`:

```ts
  it("declares the second weight attribute and varying as vec3, duff in z", () => {
    expect(TERRAIN_VERTEX_DEFS).toContain("attribute vec3 terrainWeights2;");
    expect(TERRAIN_VERTEX_DEFS).toContain("varying vec3 vTerrainW2;");
    expect(TERRAIN_FRAGMENT_DEFS).toContain("varying vec3 vTerrainW2;");
  });
```

(Use the exported shader-string names the file already exports; if the declarations live in one exported string, assert on that one.)

- [ ] **Step 2: Run to verify they fail** — `npx vitest run --root client test/game/clipmap.test.ts test/game/terrainTexture.test.ts`.

- [ ] **Step 3: Implement**

`clipmap.ts`: `export const WEIGHTS2_STRIDE = 3;` allocate `weights2` with `count * WEIGHTS2_STRIDE`; at the vertex write, keep `duff` in a local (it is already computed for `classifySurface`) and write:

```ts
  const cover = groundCover(seed, x, z, s);
  const { albedo, weights } = classifySurface(seed, x, z, s.h, Math.hypot(s.dx, s.dz), forestDensity(seed, x, z, s), cover.duff);
  ...
  ring.weights2[at * WEIGHTS2_STRIDE] = weights.pebble;
  ring.weights2[at * WEIGHTS2_STRIDE + 1] = weights.detail;
  ring.weights2[at * WEIGHTS2_STRIDE + 2] = cover.duff;
```

and wherever the buffer is uploaded (`setVerticesData("terrainWeights2", …, false, 2)` or the `VertexBuffer` construction), the stride becomes `WEIGHTS2_STRIDE`. `terrainTexture.ts`: `attribute vec3 terrainWeights2;`, `varying vec3 vTerrainW2;` in both stages; `vTerrainW2 = terrainWeights2;` is unchanged; every existing read of `.x`/`.y` is unchanged.

- [ ] **Step 4: Run** the two test files plus `test/game/trailPaint.test.ts` and `test/game/renderer.test.ts` — PASS.

- [ ] **Step 5: Commit** — `git add client/src/game/clipmap.ts client/src/game/terrainTexture.ts client/test/game/clipmap.test.ts client/test/game/terrainTexture.test.ts`, subject `feat: carry the ground cover's duff to the terrain fragment`.

---

### Task 2: Drifts, wash-outs and a darker core

**Files:**
- Modify: `client/src/game/trailBenchParams.ts` (new constants and mirrors; `TRAIL_CORE_GAIN`)
- Modify: `client/src/game/trailPaint.ts` (`TRAIL_FRAGMENT_PAINT`, the core-and-margin block)
- Test: `client/test/game/trailPaint.test.ts`, `client/test/game/trailBenchParams.test.ts`

**Interfaces:**
- Consumes: `vTerrainW2.z` (Task 1); `macroValueNoise(vec2, wave)` already in the shader; `valueNoise2(x, z, wave)` from `groundHexParams.ts` (the TypeScript mirror the edge noise uses).
- Produces, in `trailBenchParams.ts`:
  ```ts
  export const TRAIL_DRIFT_BAND: readonly [number, number] = [0.25, 0.7];
  export const TRAIL_DRIFT_TINT: Rgb = { r: 0.62, g: 0.5, b: 0.36 }; // needle-and-leaf bed over the floor texture
  export const TRAIL_WASH_WAVE = 4;
  export const TRAIL_WASH_BAND: readonly [number, number] = [0.55, 0.8];
  export const TRAIL_WASH_DARK = 0.7;
  export const TRAIL_WASH_ROUGH = 1.15;
  export const TRAIL_CORE_GAIN = 0.45; // was 0.5
  export function trailDriftWeight(duff: number): number;       // smoothstep(TRAIL_DRIFT_BAND, duff)
  export function trailWashoutNoise(x: number, z: number): number; // valueNoise2(x, z, TRAIL_WASH_WAVE), in [0, 1]
  export function trailWashoutWeight(x: number, z: number): number; // smoothstep(TRAIL_WASH_BAND, noise)
  export function trailPatches(duff: number, x: number, z: number): { drift: number; wash: number }; // wash wins: drift *= 1 − wash
  ```

- [ ] **Step 1: Write the failing tests**

`client/test/game/trailBenchParams.test.ts`:

```ts
describe("the neglect patches", () => {
  it("match the spec and rise only through their smoothsteps", () => {
    expect(TRAIL_DRIFT_BAND).toEqual([0.25, 0.7]);
    expect(TRAIL_WASH_WAVE).toBe(4);
    expect(TRAIL_WASH_BAND).toEqual([0.55, 0.8]);
    expect(TRAIL_WASH_DARK).toBe(0.7);
    expect(TRAIL_WASH_ROUGH).toBe(1.15);
    expect(TRAIL_CORE_GAIN).toBe(0.45);
    expect(trailDriftWeight(0)).toBe(0);
    expect(trailDriftWeight(0.25)).toBe(0);
    expect(trailDriftWeight(0.7)).toBe(1);
    expect(trailDriftWeight(1)).toBe(1);
    let prev = 0;
    for (let d = 0; d <= 1; d += 0.01) { const w = trailDriftWeight(d); expect(w).toBeGreaterThanOrEqual(prev); expect(w - prev).toBeLessThan(0.05); prev = w; }
    for (const [x, z] of [[0, 0], [12.3, -7.7], [301, 118]]) {
      const n = trailWashoutNoise(x, z);
      expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1);
      expect(trailWashoutWeight(x, z)).toBe(smoothstepT(TRAIL_WASH_BAND[0], TRAIL_WASH_BAND[1], n));
    }
  });
  it("lets the wash-out win where both are high, and never sums past one", () => {
    // Find a point whose wash-out weight is high, then feed full duff.
    let found = false;
    for (let x = 0; x < 400 && !found; x += 0.5) {
      if (trailWashoutWeight(x, 3) > 0.9) {
        const p = trailPatches(1, x, 3);
        expect(p.wash).toBeGreaterThan(0.9);
        expect(p.drift).toBeLessThan(0.1);
        expect(p.drift + p.wash).toBeLessThanOrEqual(1 + 1e-12);
        found = true;
      }
    }
    expect(found).toBe(true);
    for (let x = 0; x < 100; x += 0.7) { const p = trailPatches(0.6, x, 9); expect(p.drift + p.wash).toBeLessThanOrEqual(1 + 1e-12); }
  });
});
```

`client/test/game/trailPaint.test.ts` (the mirror-pinning pattern already used for the snow and bank lines):

```ts
  it("paints drifts from the vertex's duff and wash-outs from its own noise, and keeps the core readable", () => {
    expect(TRAIL_FRAGMENT_PAINT).toContain(`float tDrift = smoothstep(${glslFloat(TRAIL_DRIFT_BAND[0])}, ${glslFloat(TRAIL_DRIFT_BAND[1])}, clamp(vTerrainW2.z, 0.0, 1.0));`);
    expect(TRAIL_FRAGMENT_PAINT).toContain(`float tWash = smoothstep(${glslFloat(TRAIL_WASH_BAND[0])}, ${glslFloat(TRAIL_WASH_BAND[1])}, macroValueNoise(vPositionW.xz, ${glslFloat(TRAIL_WASH_WAVE)}));`);
    expect(TRAIL_FRAGMENT_PAINT).toContain("tDrift *= 1.0 - tWash;");
    expect(TRAIL_FRAGMENT_PAINT).toContain(`* ${glslFloat(TRAIL_CORE_GAIN)} *`);
    // The patches tint and re-normal the bench but never zero the band weights:
    // tOnBench and tInCore are formed before the patches and are not multiplied by them.
    const onBench = TRAIL_FRAGMENT_PAINT.split("\n").find((l) => l.includes("float tOnBench = "))!;
    expect(onBench).not.toContain("tDrift"); expect(onBench).not.toContain("tWash");
  });
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`trailBenchParams.ts`:

```ts
export const TRAIL_DRIFT_BAND: readonly [number, number] = [0.25, 0.7];
export const TRAIL_DRIFT_TINT: Rgb = { r: 0.62, g: 0.5, b: 0.36 };
export const TRAIL_WASH_WAVE = 4;
export const TRAIL_WASH_BAND: readonly [number, number] = [0.55, 0.8];
export const TRAIL_WASH_DARK = 0.7;
export const TRAIL_WASH_ROUGH = 1.15;
export const TRAIL_CORE_GAIN = 0.45;
/** Drift weight from the vertex's duff: the same smoothstep the shader applies. */
export function trailDriftWeight(duff: number): number {
  return smoothstep(TRAIL_DRIFT_BAND[0], TRAIL_DRIFT_BAND[1], Math.min(1, Math.max(0, duff)));
}
/** Gravel washed out to dirt: a 4 m value noise, the shader's macroValueNoise at the same wave. */
export function trailWashoutNoise(x: number, z: number): number {
  return valueNoise2(x, z, TRAIL_WASH_WAVE);
}
export function trailWashoutWeight(x: number, z: number): number {
  return smoothstep(TRAIL_WASH_BAND[0], TRAIL_WASH_BAND[1], trailWashoutNoise(x, z));
}
/** Both patches at a point; where both are high the wash-out wins — dirt under leaves is still dirt at the drift's edge. */
export function trailPatches(duff: number, x: number, z: number): { drift: number; wash: number } {
  const wash = trailWashoutWeight(x, z);
  return { drift: trailDriftWeight(duff) * (1 - wash), wash };
}
```

(`valueNoise2(x, z, wave)` from `groundHexParams.ts` is what `trailEdgeNoise` already calls with a wave; the shader's `macroValueNoise(vec2, wave)` is its mirror. Confirm the pair agree in the existing edge-noise test before relying on them; they are pinned there.)

`trailPaint.ts`, in `TRAIL_FRAGMENT_PAINT` after `float tMarginCol …` and before the puddle lines, add:

```glsl
    // Neglect: leaf and needle drifts where the ground cover says litter lies
    // (the vertex's duff weight, so a painted drift always has pieces on it),
    // and gravel washed out to bare dirt in patches of the bed's own noise.
    // Both are smoothsteps and neither touches the band weights: the bed's
    // core stays traceable however much lies on it.
    float tDrift = smoothstep(${f(TRAIL_DRIFT_BAND[0])}, ${f(TRAIL_DRIFT_BAND[1])}, clamp(vTerrainW2.z, 0.0, 1.0));
    float tWash = smoothstep(${f(TRAIL_WASH_BAND[0])}, ${f(TRAIL_WASH_BAND[1])}, macroValueNoise(vPositionW.xz, ${f(TRAIL_WASH_WAVE)}));
    tDrift *= 1.0 - tWash;
    vec3 tDriftCol = tFloorTex * vec3(${f(TRAIL_DRIFT_TINT.r)}, ${f(TRAIL_DRIFT_TINT.g)}, ${f(TRAIL_DRIFT_TINT.b)}) * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
    vec3 tWashCol = tFloorTex * ${f(TRAIL_WASH_DARK)} * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
    tCoreCol = mix(mix(tCoreCol, tDriftCol, tDrift), tWashCol, tWash);
    tMarginCol = mix(mix(tMarginCol, tDriftCol, tDrift), tWashCol, tWash);
```

and where the bench normal and roughness are formed:

```glsl
    vec3 tBenchN = normalize(normalW + vec3(tGravelN.x, 0.0, tGravelN.y) * mix(1.0, 0.5, tInCore) * (1.0 - tDrift) * (1.0 - tWash) + vec3(tFloorN.x, 0.0, tFloorN.y) * tDrift);
    ...
    float tRoughBench = clamp(terrainLayerRough2.x * mix(1.0, tGravelRAH.r / 0.5, tk), 0.0, 1.0);
    tRoughBench = mix(tRoughBench, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tDrift);
    tRoughBench = mix(tRoughBench, clamp(tRoughBench * ${f(TRAIL_WASH_ROUGH)}, 0.0, 1.0), tWash);
```

The core gain line reads `TRAIL_CORE_GAIN` already; the constant's change to 0.45 is the darkening.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/trailPaint.test.ts test/game/trailBenchParams.test.ts test/game/terrainTexture.test.ts` — PASS. Then load the game once in the browser and confirm the shader compiles (an error would show as a black terrain and a console error).

- [ ] **Step 5: Commit** — `git add client/src/game/trailBenchParams.ts client/src/game/trailPaint.ts client/test/game/trailPaint.test.ts client/test/game/trailBenchParams.test.ts`, subject `feat: leaf drifts, wash-outs and a darker bed on the trail`.

---

### Task 3: The small things, the docs and the gates

**Files:**
- Modify: `client/src/sim/clutter.ts` (`CLUTTER_LITTER_D`)
- Modify: `client/src/game/trailBenchParams.ts` (`TRAMPLE_HEIGHT`, `TRAMPLE_LEAN`)
- Modify: `ARCHITECTURE.md`; Create: `docs/rendering/2026-09-23-trail-neglect-verification.md`
- Test: `client/test/sim/clutter.test.ts`, `client/test/game/trailBenchParams.test.ts`

**Interfaces:**
- Produces: `CLUTTER_LITTER_D = 0.9`; `TRAMPLE_HEIGHT = 0.73`, `TRAMPLE_LEAN = 0.21` (0.6 of today's strength: the height drop 0.45 → 0.27, the lean 0.35 → 0.21).

- [ ] **Step 1: Write the failing tests** — in `clutter.test.ts` where `CLUTTER_LITTER_D` is pinned: `expect(CLUTTER_LITTER_D).toBe(0.9)` and that it is in `CLUTTER_TUNABLES`; in `trailBenchParams.test.ts`: `expect(TRAMPLE_HEIGHT).toBe(0.73); expect(TRAMPLE_LEAN).toBe(0.21);` and `trampleAt(0)` returns `{ height: 0.73, lean: 0.21 }`, `trampleAt(TRAMPLE_BAND[1])` the identity (height 1, lean 0, tint white) — the identity off the band is unchanged.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the three constants. Any level-id pin in the tests moves; update it and say so in the commit.
- [ ] **Step 4: Run** `npx vitest run --root client test/sim/clutter.test.ts test/game/trailBenchParams.test.ts test/game/clutterMeshes.test.ts` — PASS.
- [ ] **Step 5: Docs** — `ARCHITECTURE.md`, in the rendering paragraph's trail sentence, add that the bed reads as neglected: leaf and needle drifts painted where the ground cover's duff lies, gravel washed out to dirt in patches, and the grass beside it only lightly trampled. Write the verification note in the format of `docs/rendering/2026-09-22-blade-field-verification.md`: method; stills at TRAIL and TRAILSIDE under clear noon and mist, eye level and looking down, before/after against `main`, with duff and litter counts on the bed; the 40 m walk as three stills; the frame pairs at 4× pixels; the fallback taken if any; gaps.
- [ ] **Step 6: Run the whole suite** (`npx vitest run --root client --maxWorkers=3`, then server and tools) and `npm run typecheck && npm run lint`.
- [ ] **Step 7: Commit** — `git add client/src/sim/clutter.ts client/src/game/trailBenchParams.ts client/test/sim/clutter.test.ts client/test/game/trailBenchParams.test.ts ARCHITECTURE.md docs/rendering/2026-09-23-trail-neglect-verification.md`, subject `feat: loose stone on the margins and grass that stands up beside the bed`.

---

## Self-review

**Spec coverage.** §3 (the field's terms) is the ground-cover plan's Task 1 — nothing here. §4 paint: drifts, wash-outs, darker core → Task 2; the vertex duff channel it needs → Task 1. §5 litter ×1.5, twigs (free from the duff bed term), trample 0.6 → Task 3. §6 tests → Steps 1 of Tasks 1–3; gates → Task 3 Step 5. §7 fallbacks are constants named in Task 2. §8 order: this plan starts after the ground cover lands; Task 1 asserts on `groundCover`, which exists only then.

**Placeholders.** None. `buildRingForTest` names the helper the existing clipmap weights test uses; if it is named differently there, the implementer uses that one — it is the same ring.

**Type consistency.** `WEIGHTS2_STRIDE` (Task 1) is read by Task 1's test only; the shader reads `vTerrainW2.z` (Tasks 1, 2). `trailPatches` returns `{ drift, wash }` and the GLSL forms the same two numbers in the same order with the same edges (Task 2's mirror test pins the literals). `TRAMPLE_HEIGHT`/`TRAMPLE_LEAN` feed `trampleAt`, whose shape is unchanged (Task 3).
