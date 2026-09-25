# Floor Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The canopy floor reads as a tan/rust leaf carpet on a mid-brown ground, and the trail reads as packed earth in the hue of its surroundings at 0.9–1.3× their brightness.

**Architecture:** Constants move in three files (`duffClump.ts`, `terrainSurface.ts`, `foliagePlugin.ts`) and the trail paint gains one `mix` between two textures it already samples (`trailPaint.ts`, constants in `trailBenchParams.ts`). No geometry, no field, nothing under `sim/`.

**Tech Stack:** TypeScript, Babylon.js material plugins (GLSL in template strings), vitest with `NullEngine`.

**Spec:** `docs/rendering/2026-09-24-floor-look-design.md`

## Global Constraints

- No file under `client/src/sim/` changes; the `CLUTTER_TUNABLES` digest pinned in `client/test/sim/groundGradient.test.ts` is unchanged.
- The trail's core stays traceable (the neglect design's rule): no band weight changes, only colours.
- Never write how any asset was produced, or process vocabulary (sessions, agents, reviews, briefs, tasks, plans, rulings, "the owner"), in code, comments, docs or commit messages. The repository is public.
- Stage explicit paths only (never `git add -A` / `git add .`). The repository's pre-push scan must pass on every commit; run it after each one, not only before the push.
- Before every commit: `npm run typecheck`, the touched test files under `client/` (`npx vitest run <files>`), and `npx eslint <touched files>` green.
- Commit format: type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then `Co-Authored-By: <your model name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1`.
- Every numeric expectation in a test is a literal, never the constant it pins.

---

### Task 1: Leaves and the floor paint

**Files:**
- Modify: `client/src/game/duffClump.ts` (the `DUFF_CHARACTERS` leaf row)
- Modify: `client/src/game/terrainSurface.ts` (`NEEDLE_BED`)
- Modify: `client/src/game/foliagePlugin.ts` (the `DUFF` profile's `groundTint`)
- Test: `client/test/game/duffClump.test.ts`, `client/test/game/terrainSurface.test.ts`, `client/test/game/foliagePlugin.test.ts`

**Interfaces:**
- Consumes: `DUFF_ALBEDO`, `DUFF_CHARACTERS`, `DUFF_LEAF` from `duffClump.ts`; `classifySurface`, `NEEDLE_BED` from `terrainSurface.ts`; `FOLIAGE_PROFILES` from `foliagePlugin.ts`.
- Produces: nothing new — the same names with new values. `TRAIL_DRIFT_TINT` (`trailBenchParams.ts`) is derived from `NEEDLE_BED` and follows it with no edit.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/duffClump.test.ts`, add `DUFF_ALBEDO` and `DUFF_LEAF` to the import from `../../src/game/duffClump.js` if they are not imported already, and add inside the file's top-level `describe`:

```ts
  it("tints the leaf tan, not red: the litter's own hue in linear terms", () => {
    // A leaf's albedo is DUFF_ALBEDO × the leaf character's tint. The
    // litter in the reference photographs is tan/rust: linear g/r ≈ 0.67
    // and b/r ≈ 0.33. The previous tint (1.15, 0.80, 0.45) gave g/r 0.48,
    // which read as red-brown on a black floor.
    const leaf = DUFF_CHARACTERS[DUFF_LEAF]!;
    expect(leaf.tint).toEqual({ r: 1.05, g: 1.05, b: 0.9 });
    const r = DUFF_ALBEDO.r * leaf.tint.r;
    const g = DUFF_ALBEDO.g * leaf.tint.g;
    const b = DUFF_ALBEDO.b * leaf.tint.b;
    expect(g / r).toBeGreaterThanOrEqual(0.6);
    expect(g / r).toBeLessThanOrEqual(0.8);
    expect(b / r).toBeGreaterThanOrEqual(0.25);
    expect(b / r).toBeLessThanOrEqual(0.45);
  });
```

In `client/test/game/terrainSurface.test.ts`, add `NEEDLE_BED` to the import list from `../../src/game/terrainSurface.js`, and add a new `it` right after `"pulls the floor weight and colour toward leaf litter with duff, and leaves duff = 0 bitwise identical"` inside the same `describe`:

```ts
  it("paints the canopy litter as a mid-brown floor, not a black one", () => {
    // The reference floor is a tan/brown carpet at linear ≈ (0.15, 0.10,
    // 0.06); the previous NEEDLE_BED (0.10, 0.07, 0.04) was 1.5× darker
    // and read as black under the canopy. Same hue, 1.5× the luminance.
    expect(NEEDLE_BED).toEqual({ r: 0.15, g: 0.105, b: 0.06 });
    const lum = (c: Rgb) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // Under full canopy at full duff the litter paint carries the bed:
    // luminance in [0.104, 0.13] — at least 1.4× the previous bed's 0.0742
    // and no brighter than the photographs' floor.
    const full = classifySurface(SEED, 35, 21335, 40, 0.1, 1, 1);
    expect(lum(full.albedo)).toBeGreaterThanOrEqual(0.104);
    expect(lum(full.albedo)).toBeLessThanOrEqual(0.13);
  });
```

(`Rgb` is already imported at the top of that file; `SEED` is the `describe`'s own constant.)

In `client/test/game/foliagePlugin.test.ts`, in the `"FOLIAGE_PROFILES matches the spec's table exactly"` expectation, change the `DUFF` row to:

```ts
      DUFF: { amp: 0, groundTint: 0.5, rootAO: 0.6, normalRoot: 0, tilt: false, bend: false, blades: true, normalUp: 0.5 },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/duffClump.test.ts test/game/terrainSurface.test.ts test/game/foliagePlugin.test.ts`
Expected: three failures — the leaf tint equality, the `NEEDLE_BED` equality, and the `DUFF` profile row.

- [ ] **Step 3: Move the constants**

`client/src/game/duffClump.ts`, the leaf row of `DUFF_CHARACTERS`:

```ts
  { name: "leaf", pieces: [14, 22], length: [0.12, 0.20], width: 0.04, tint: { r: 1.05, g: 1.05, b: 0.9 }, tintSpread: 0.3, lift: [0.1, 0.5], forked: false },
```

and, on the line above the table, extend the existing comment on the tints with:

```ts
// The leaf's tint is near-neutral on DUFF_ALBEDO so a leaf comes out tan
// (linear g/r ≈ 0.69, b/r ≈ 0.32), which is the litter's own hue; the
// earlier red-brown tint read as rust on a dark floor.
```

`client/src/game/terrainSurface.ts`:

```ts
export const NEEDLE_BED: Rgb = { r: 0.15, g: 0.105, b: 0.06 };
```

and update the constant's doc comment to say the bed is a mid tan-brown floor — the paint carries the leaf carpet and the litter pieces add relief on it — rather than a dark one.

`client/src/game/foliagePlugin.ts`, the `DUFF` profile:

```ts
  DUFF: { amp: 0, groundTint: 0.5, rootAO: 0.6, normalRoot: 0, tilt: false, bend: false, blades: true, normalUp: 0.5 },
```

with a note in the profile table's comment that the litter pieces take half the ground's colour: on a mid-brown floor, half seats them; 0.7 pulled them into the floor.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/duffClump.test.ts test/game/terrainSurface.test.ts test/game/foliagePlugin.test.ts test/game/trailBenchParams.test.ts test/game/trailPaint.test.ts`
Expected: all pass. If `"pulls the floor weight and colour toward leaf litter with duff…"` fails on its `full.albedo.g < base.albedo.g` line, the lifted bed is no longer darker in green than that pose's base: replace that assertion with a hue check — `expect(full.albedo.g / full.albedo.r).toBeLessThan(base.albedo.g / base.albedo.r)` (browner: less green per red) — and say so in the commit. `trailBenchParams.test.ts` covers `TRAIL_DRIFT_TINT`'s derivation from `NEEDLE_BED`; it must pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/duffClump.ts client/src/game/terrainSurface.ts client/src/game/foliagePlugin.ts client/test/game/duffClump.test.ts client/test/game/terrainSurface.test.ts client/test/game/foliagePlugin.test.ts
git commit -F - <<'EOF'
feat: paint the canopy floor tan and tint the leaves to match

## What

Under the canopy the floor paint was near-black and the leaf pieces
red-brown, so the litter read as rust on a black ground. The bed paint is
now a mid tan-brown at 1.5× the luminance, the leaf tint is near-neutral so
a leaf comes out tan, and the pieces take half the ground's colour instead
of 70 %.

## How

- `client/src/game/terrainSurface.ts` — `NEEDLE_BED` (0.10, 0.07, 0.04) →
  (0.15, 0.105, 0.06), same hue.
- `client/src/game/duffClump.ts` — the leaf tint (1.15, 0.80, 0.45) →
  (1.05, 1.05, 0.9): linear g/r 0.48 → 0.69.
- `client/src/game/foliagePlugin.ts` — the `DUFF` profile's ground tint
  0.7 → 0.5.
- `client/test/game/*.test.ts` — the values pinned as literals; the litter
  paint's luminance under full canopy in [0.104, 0.13]; the leaf's hue
  ratios.

Co-Authored-By: <model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
```

---

### Task 2: The trail as earth

**Files:**
- Modify: `client/src/game/trailBenchParams.ts` (`TRAIL_BED_EARTH` new; `TRAIL_BENCH_SHADE`, `TRAIL_CORE_GAIN`, `TRAIL_MARGIN_GAIN`, `TRAIL_WASH_DARK`)
- Modify: `client/src/game/trailPaint.ts` (the bed texture mix, the core and margin colour lines)
- Test: `client/test/game/trailPaint.test.ts`, `client/test/game/trailBenchParams.test.ts`

**Interfaces:**
- Consumes: `TRAIL_FRAGMENT_PAINT` (the exported GLSL string the tests read), `glslFloat` from the test's existing imports.
- Produces: `export const TRAIL_BED_EARTH = 0.7` in `trailBenchParams.ts`.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/trailPaint.test.ts`, add `TRAIL_BED_EARTH` and `TRAIL_WASH_DARK` to the import from `../../src/game/trailBenchParams.js`, and add a new `it` beside `"…tCoreCol = mix(mix(tCoreCol, tDriftCol, tDrift), tWashCol, tWash)…"` (the neglect test near line 275):

```ts
  it("lays the bed as earth: the floor texture over the pebbles, and the bed wears the bank's shade", () => {
    // The bed texture is the forest-floor texture at TRAIL_BED_EARTH over
    // the pebble texture, so the trail is packed earth with grit in it
    // rather than a pale gravel band. Both textures were already sampled
    // for the bank and the drifts; this is one mix, inside the trail only.
    expect(TRAIL_BED_EARTH).toBe(0.7);
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tBedTex = mix(tGravelTex, tFloorTex, 0.7);");
    // The core and margin colours are built on the earth, not the gravel.
    const core = TRAIL_FRAGMENT_PAINT.match(/vec3 tCoreCol = [^\n]*/)![0];
    const margin = TRAIL_FRAGMENT_PAINT.match(/vec3 tMarginCol = [^\n]*/)![0];
    expect(core).toContain("* tBedTex *");
    expect(margin).toContain("* tBedTex *");
    expect(core).not.toContain("tGravelTex");
    expect(margin).not.toContain("tGravelTex");
    // The bed's brightness: gains down to where the bed / beside ratio
    // lands in 0.9–1.3, and the bed takes 80 % of the bank's shade.
    expect(TRAIL_CORE_GAIN).toBe(0.32);
    expect(TRAIL_MARGIN_GAIN).toBe(0.55);
    expect(TRAIL_BENCH_SHADE).toBe(0.8);
    expect(TRAIL_WASH_DARK).toBe(0.55);
    expect(TRAIL_FRAGMENT_PAINT).toContain(`vec3 tBenchBase = mix(vec3(1.0), tBankBase, ${glslFloat(0.8)});`);
  });
```

Also add `TRAIL_BED_EARTH` to the array in the existing "every constant appears as a literal" loop (the `for (const v of [TRAIL_CORE_HALF, …])` near line 300).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/trailPaint.test.ts`
Expected: FAIL — `TRAIL_BED_EARTH` is not exported (a type error at import, or `undefined`), and the gain/shade literals differ.

- [ ] **Step 3: Move the constants and add the mix**

`client/src/game/trailBenchParams.ts` — change the four existing values and add the new constant beside `TRAIL_BENCH_SHADE`:

```ts
export const TRAIL_CORE_GAIN = 0.32;
export const TRAIL_MARGIN_GAIN = 0.55;
/**
 * How much of the bank's shade the bed takes. At 0.6 the bed kept 40 % of
 * its own pale gravel brightness whatever ran beside it; at 0.8 it wears the
 * colour of the ground it runs through — brown under the canopy, tan in the
 * meadow — which is what packed earth does.
 */
export const TRAIL_BENCH_SHADE = 0.8;
/**
 * The bed's material: the forest-floor texture at this share over the pebble
 * texture. Packed earth with grit in it, not a gravel band. Both textures are
 * already sampled for the bank and the drifts, so the mix is the only cost.
 */
export const TRAIL_BED_EARTH = 0.7;
```

and `TRAIL_WASH_DARK = 0.55` with its comment amended: wash-outs at 0.7 read as pale sand; at 0.55 they read as the bare earth the drift has left.

`client/src/game/trailPaint.ts` — import `TRAIL_BED_EARTH` with the other bench params, and directly after the line that defines `tFloorTex` (`vec3 tFloorTex = mix(vec3(1.0), texture2D(terrainFloor, tuvF).rgb / terrainRock2.y, tk);`) add:

```glsl
    // The bed is earth: the floor texture over the pebbles, so the trail
    // wears the colour of the ground beside it with grit in it.
    vec3 tBedTex = mix(tGravelTex, tFloorTex, ${f(TRAIL_BED_EARTH)});
```

Then in the two colour lines replace `tGravelTex` with `tBedTex`:

```glsl
    vec3 tCoreCol = vec3(${f(TRAIL_CORE_TINT.r)}, ${f(TRAIL_CORE_TINT.g)}, ${f(TRAIL_CORE_TINT.b)}) * tDarkK * tBedTex * ${f(TRAIL_CORE_GAIN)} * tAo * tBenchBase;
    vec3 tMarginCol = vec3(${f(TRAIL_MARGIN_TINT.r)}, ${f(TRAIL_MARGIN_TINT.g)}, ${f(TRAIL_MARGIN_TINT.b)}) * tBedTex * ${f(TRAIL_MARGIN_GAIN)} * tAo * tBenchBase;
```

`tGravelTex` stays defined: `tAo` still reads `tGravelRAH`, and the pebble texture is the grit in the mix. Update the comment above the bench-shade line (`tBenchBase`) to say the bed takes 80 % of the bank's shade.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/trailPaint.test.ts test/game/trailBenchParams.test.ts test/game/terrainTexture.test.ts`
Expected: all pass. `terrainTexture.test.ts` compiles the plugin under `NullEngine` (WebGL1); the new line must compile there too.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/trailBenchParams.ts client/src/game/trailPaint.ts client/test/game/trailPaint.test.ts
git commit -F - <<'EOF'
feat: lay the trail bed as packed earth in the hue of its surroundings

## What

The trail was a pale grey gravel band 1.5–2.5× brighter than the ground
beside it, which is not what an abandoned trail looks like: in the
reference photographs it is packed earth of the same hue family as its
surroundings, at 0.8–1.4× their brightness, with no gravel texture. The bed
now mixes the forest-floor texture over the pebbles, takes 80 % of the
bank's shade, and its gains come down to land the ratio.

## How

- `client/src/game/trailBenchParams.ts` — `TRAIL_BED_EARTH` 0.7 (new);
  `TRAIL_BENCH_SHADE` 0.6 → 0.8; `TRAIL_CORE_GAIN` 0.45 → 0.32;
  `TRAIL_MARGIN_GAIN` 0.75 → 0.55; `TRAIL_WASH_DARK` 0.7 → 0.55.
- `client/src/game/trailPaint.ts` — `tBedTex = mix(tGravelTex, tFloorTex,
  0.7)`, one mix on two textures already sampled; the core and margin
  colours are built on it. Band weights untouched: the core stays
  traceable.
- `client/test/game/trailPaint.test.ts` — the mix line and the literals
  pinned; the core and margin lines no longer read the gravel.

Co-Authored-By: <model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
```

---

### Task 3: Gates and the verification note

**Files:**
- Create: `docs/rendering/<today>-floor-look-verification.md` (dated the day it is written)
- Read: `docs/rendering/2026-09-24-forest-floor-verification.md` (the canopy litter poses), `docs/rendering/2026-09-24-trail-neglect-verification.md` (the TRAIL / TRAILSIDE / drift poses and the frame rig)

**Interfaces:**
- Consumes: the gate rig at `~/Projects/fps-sdd-archive/2026-09-22-blade-field/scripts/` (`apply-hooks.py <worktree> <port> <ws-port>`, `apply-tier-hook.py <worktree>`, `stills.sh`, `frametime.sh`); the control worktree `.claude/worktrees/forest-control` — re-point it at `origin/main` (`git -C .claude/worktrees/forest-control checkout --detach d07a2cc`) before any pair, since it still sits at f276f25; the reference photographs under the scratchpad's `refs/` (`canopy-1.jpg`, `canopy-2.jpg`, `meadow-1.jpg`, `meadow-2.jpg`).
- Produces: the verification note and the numbers in it.

- [ ] **Step 1: Stills, paired**

Hook both worktrees (branch on 5174, control on 5175, tier hook on both), start both dev servers, and shoot with the isolated `chrome-devtools` CLI (never the MCP tools) at: the two canopy litter poses from the forest-floor note, the drift pose from the trail-neglect note (seed `atmo`, `time 12`, `weather clear`), the meadow drift pose on seed `ypeqauxk` from the same note, and one canopy trail pose (a bed cell under canopy > 0.6 — find it from the simulation as that note did, not by flying). Same seed, clear noon, `__fcSet` from the console, `?cmd=seed <token>;freecam;weather clear;time 12&tier=high`. Pair each control/branch still side by side with ffmpeg `hstack`.

- [ ] **Step 2: Measure the bed / beside ratio**

For each trail still, pick two rectangles in the branch image — one on the bed's core, one on the ground 2 m beside it on the same side of the sun — and measure each crop's mean in linear luminance:

```bash
# mean sRGB of a crop, then to linear luminance
ffmpeg -v error -i still.jpeg -vf "crop=W:H:X:Y,scale=1:1" -f rawvideo -pix_fmt rgb24 - | python3 -c "
import sys; r,g,b=[c/255 for c in sys.stdin.buffer.read()[:3]]
lin=lambda c: ((c+0.055)/1.055)**2.4 if c>0.04045 else c/12.92
print(0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b))"
```

Record both crops' rectangles and the ratio per still, on the control and on the branch. The gate is 0.9–1.3 on the branch in every trail still. If it misses: `TRAIL_CORE_GAIN` and `TRAIL_MARGIN_GAIN` by ±0.08 first, then `TRAIL_BENCH_SHADE` 0.8 → 0.9, never the textures; each move is its own commit with the tests' literals updated, and the ratio re-measured. Three rounds at most; report where it landed.

- [ ] **Step 3: The reference side-by-side**

Lay each canopy branch still beside `canopy-1.jpg` and `canopy-2.jpg` (`hstack`, both scaled to 600 px wide), and the meadow still beside `meadow-1.jpg`. Read them: does the floor read as the same kind of carpet, and the trail as the same kind of earth? Write what reads and what does not; do not tune to the photographs' pixel values.

- [ ] **Step 4: Frame pairs**

`frametime.sh` at TRAIL and TRAILSIDE (the trail-neglect note's poses), 4× pixels, interleaved pairs in both orders, medians. Bar: within noise, ≤ +0.3 ms. Record `main`'s median, the branch's, and the machine's load average at the time.

- [ ] **Step 5: Write the note and commit**

`docs/rendering/<today>-floor-look-verification.md`: the poses, the paired stills' read, the ratio table (still, crops, control ratio, branch ratio), the side-by-side read, the frame pairs, and anything that missed. Commit:

```bash
git add docs/rendering/<today>-floor-look-verification.md
git commit -F - <<'EOF'
docs: verify the floor look against its stills and its ratio gate

## What

The measured bed / beside luminance ratio, the paired stills against
main, the side-by-side with the reference photographs, and the frame
pairs at TRAIL and TRAILSIDE, for the tan floor and the earth trail.

## How

- `docs/rendering/<today>-floor-look-verification.md` — the poses, the
  ratio table, the reads, and the frame medians.

Co-Authored-By: <model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF
```

---

### Task 4: The drifts rise with the floor, and the bed's relief is earth

**Files:**
- Modify: `client/src/game/trailBenchParams.ts` (`TRAIL_DRIFT_LUM`, `TRAIL_CORE_GAIN`, `TRAIL_MARGIN_GAIN`)
- Modify: `client/src/game/trailPaint.ts` (the bed's normal, occlusion and roughness)
- Test: `client/test/game/trailPaint.test.ts`, `client/test/game/trailBenchParams.test.ts`

**Interfaces:**
- Consumes: `TRAIL_BED_EARTH`, `TRAIL_FRAGMENT_PAINT`, `glslFloat`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/trailPaint.test.ts`, extend the earth test from Task 2 (or add beside it):

```ts
  it("shades the bed's relief as earth too: normal, occlusion and roughness follow the same mix", () => {
    // A brown tint over a cobble mosaic still shades as cobbles: the normal
    // map, the ambient occlusion and the roughness were the pebble texture's.
    // The same share that mixes the colour mixes them.
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tBedN = mix(tGravelN, tFloorN, 0.7);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("vec3 tBedRAH = mix(tGravelRAH, tFloorRAH, 0.7);");
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tAo = mix(1.0, tBedRAH.g / 0.5, tk);");
    const bench = TRAIL_FRAGMENT_PAINT.match(/vec3 tBenchN = [^\n]*/)![0];
    expect(bench).toContain("tBedN.x, 0.0, tBedN.y");
    expect(bench).not.toContain("tGravelN");
    const rough = TRAIL_FRAGMENT_PAINT.match(/float tRoughBench = [^\n]*/)![0];
    expect(rough).toContain("tBedRAH.r / 0.5");
    expect(rough).not.toContain("tGravelRAH");
    // The open end's brightness, down by the allowance.
    expect(TRAIL_CORE_GAIN).toBe(0.24);
    expect(TRAIL_MARGIN_GAIN).toBe(0.47);
  });
```

In `client/test/game/trailBenchParams.test.ts`, update the pinned literals for `TRAIL_CORE_GAIN` (0.24), `TRAIL_MARGIN_GAIN` (0.47) and `TRAIL_DRIFT_LUM` (0.77), and where `TRAIL_DRIFT_TINT` is checked against `NEEDLE_BED`'s hue at `TRAIL_DRIFT_LUM`, keep that check — it is the derivation this task relies on.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/trailPaint.test.ts test/game/trailBenchParams.test.ts`
Expected: FAIL on the new `toContain`s and the three literals.

- [ ] **Step 3: Move the constants and mix the relief**

`client/src/game/trailBenchParams.ts`:

```ts
export const TRAIL_CORE_GAIN = 0.24;
export const TRAIL_MARGIN_GAIN = 0.47;
/** The drift's brightness relative to the floor texture. A drift is the
 * same litter as the floor beside the bed, so it rises with the floor
 * paint: 0.77 is the earlier 0.5154 at the floor's own 1.5× lift. */
export const TRAIL_DRIFT_LUM = 0.77;
```

`client/src/game/trailPaint.ts`: after the line that defines `tFloorRAH`, add

```glsl
    // The bed's relief is earth too: a brown tint over a cobble mosaic still
    // shades as cobbles if the normal, the occlusion and the roughness stay
    // the pebble texture's. The same share that mixes the colour mixes them.
    vec3 tBedN = mix(tGravelN, tFloorN, ${f(TRAIL_BED_EARTH)});
    vec3 tBedRAH = mix(tGravelRAH, tFloorRAH, ${f(TRAIL_BED_EARTH)});
```

then change `float tAo = mix(1.0, tGravelRAH.g / 0.5, tk);` to read `tBedRAH.g`; in the `tBenchN` line replace `vec3(tGravelN.x, 0.0, tGravelN.y)` with `vec3(tBedN.x, 0.0, tBedN.y)`; in the first `tRoughBench` line replace `tGravelRAH.r` with `tBedRAH.r`. `tGravelN` and `tGravelRAH` stay defined: they are the mix's inputs. Keep every comment free of `#` directives.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/trailPaint.test.ts test/game/trailBenchParams.test.ts test/game/terrainTexture.test.ts`
Expected: all pass (the plugin still compiles under `NullEngine`).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/trailBenchParams.ts client/src/game/trailPaint.ts client/test/game/trailPaint.test.ts client/test/game/trailBenchParams.test.ts
git commit -F - <<'EOF2'
feat: let the trail's drifts rise with the floor and shade its bed as earth

## What

The first stills missed the bed / beside ratio in both directions. Under
the canopy the bed is mostly litter drift, whose brightness was pinned, so
the floor beside it rose with the floor paint and the bed did not; in the
open the bed still shaded as cobbles, because only its colour had been
mixed toward earth while its normal, occlusion and roughness stayed the
pebble texture's. The drift now rises with the floor, the bed's relief
follows the same earth mix, and the open bed's gains come down by the
design's allowance.

## How

- `client/src/game/trailBenchParams.ts` — `TRAIL_DRIFT_LUM` 0.5154 → 0.77
  (the floor's own 1.5× lift); `TRAIL_CORE_GAIN` 0.32 → 0.24;
  `TRAIL_MARGIN_GAIN` 0.55 → 0.47.
- `client/src/game/trailPaint.ts` — `tBedN` and `tBedRAH` mix the pebble
  and floor maps by `TRAIL_BED_EARTH`; the bench normal, the occlusion and
  the roughness read them.
- `client/test/game/trailPaint.test.ts`, `trailBenchParams.test.ts` — the
  mixes and the literals pinned.

Co-Authored-By: <model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1
EOF2
```

---

### Task 5: The gate, again

Repeat Task 3's Steps 1–2 and 4 at the same poses and the same crops (the
verification note's table), plus the side-by-side of Step 3 for the meadow
and one canopy still; append a `## 7. Second gate` section to the existing
verification note with the new ratio table, the frame medians and the read.
The allowance for a retune is the same as Task 3's — gains ±0.08, then the
shade — and, new, `TRAIL_DRIFT_LUM` ±0.15 for the canopy end alone. Commit
the note alone, as in Task 3.

---

### Task 6: The wash-out's darkness follows the litter

**Files:**
- Modify: `client/src/game/trailBenchParams.ts` (`TRAIL_WASH_DARK` → `TRAIL_WASH_DARK_OPEN`, `TRAIL_WASH_DARK_LITTER`)
- Modify: `client/src/game/trailPaint.ts` (the `tWashCol` line)
- Test: `client/test/game/trailPaint.test.ts`, `client/test/game/trailBenchParams.test.ts`

- [ ] **Step 1: Write the failing tests**

In `client/test/game/trailPaint.test.ts` replace the `TRAIL_WASH_DARK` import and pin with `TRAIL_WASH_DARK_OPEN`, `TRAIL_WASH_DARK_LITTER`, and add:

```ts
  it("darkens the wash-out by the litter the bed lies in: bare earth in the open, the litter floor's earth under it", () => {
    expect(TRAIL_WASH_DARK_OPEN).toBe(0.4);
    expect(TRAIL_WASH_DARK_LITTER).toBe(0.75);
    expect(TRAIL_FRAGMENT_PAINT).toContain("float tWashDark = mix(0.4, 0.75, clamp(vTerrainW2.z, 0.0, 1.0));");
    const wash = TRAIL_FRAGMENT_PAINT.match(/vec3 tWashCol = [^\n]*/)![0];
    expect(wash).toContain("tFloorTex * tWashDark *");
  });
```

and update the "every constant appears as a literal" loop to carry the two new constants in place of the old one. In `client/test/game/trailBenchParams.test.ts` replace the `TRAIL_WASH_DARK` import and its `0.55` pin with the two new pins (`0.4`, `0.75`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run test/game/trailPaint.test.ts test/game/trailBenchParams.test.ts` — FAIL on the missing exports.

- [ ] **Step 3: Split the constant and blend it**

`client/src/game/trailBenchParams.ts` — replace `TRAIL_WASH_DARK` with:

```ts
/**
 * The wash-out's darkness, by the litter the bed lies in. In the open the
 * washed bed is bare earth that must come down toward the grass beside it;
 * where litter lies, the bare earth between the drifts is the same floor's
 * earth and must not fall below it. Blended in the paint by the vertex's
 * own litter weight — the field the drifts already read.
 */
export const TRAIL_WASH_DARK_OPEN = 0.4;
export const TRAIL_WASH_DARK_LITTER = 0.75;
```

`client/src/game/trailPaint.ts` — import the two in place of the old one, and above the `tWashCol` line add `float tWashDark = mix(${f(TRAIL_WASH_DARK_OPEN)}, ${f(TRAIL_WASH_DARK_LITTER)}, clamp(vTerrainW2.z, 0.0, 1.0));`, then change the `tWashCol` line to `vec3 tWashCol = tFloorTex * tWashDark * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;`. Every other `TRAIL_WASH_DARK` reference (the import list, any comment) follows.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run test/game/trailPaint.test.ts test/game/trailBenchParams.test.ts test/game/terrainTexture.test.ts` — all pass.

- [ ] **Step 5: Commit** — subject under 72 characters, e.g. `feat: darken the trail's wash-outs by the litter they lie in`, the usual body and trailers; the four files only.

---

### Task 7: The gate, a third time

Repeat Task 5 for the six trail stills (a new crop pair for `trail-along`, beside on ground not bed) and the two canopy floor stills; one frame pair at TRAIL. Append `## 8. Third gate` to the verification note. No retune allowance beyond `TRAIL_WASH_DARK_OPEN` ±0.08.
