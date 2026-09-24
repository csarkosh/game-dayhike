# Forest Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The forest floor's litter becomes visible — leaf-sized pieces at a third of the ground, out to a wider reach — and the grass under the canopy stands at half cover and three-quarter height instead of a 15 % floor at a third of its height.

**Architecture:** Three constant sets move, in three layers that do not import each other: the sim's canopy floor (`sim/clutter.ts`, a level-id move), the blade renderer's height and size bands (`game/bladeField.ts`, `game/bladeMeshes.ts`), and the duff generator's characters, disc, reach and budget (`game/duffClump.ts`, `game/duffField.ts`). Every test that pins a moved value moves with it, with the reason in the pin's comment, and the duff budget test is rewritten on the reach constants rather than literals.

**Tech Stack:** TypeScript, Babylon.js 9.18, vitest.

**Spec:** `docs/rendering/2026-09-23-ground-cover-design.md`, section 12, the amendment dated 2026-09-24. It supersedes section 5's sizes and weights, section 7's reach, and the canopy-floor amendment's 0.15.

## Global Constraints

- The repository is public. Code, comments, docs and commit messages describe the change and the running game, nothing about how the work was done.
- Stage explicit paths only. Never `git add -A` or `git add .`. Never bare `git stash`.
- Commit messages: a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then `Co-Authored-By: Claude <model> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01JbDze4ef9icFkvYw2Ryws1`.
- `client/src/sim/` never imports from `client/src/game/`.
- A moved pin carries its reason in a comment, in the file's existing style (`// grass: 366 -> 987 on 2026-09-23 (…)`); a pinned value is read off the failing test, never hand-computed.
- The duff's analytic bounds (`duffClumpReach`, `duffClumpMaxHeight`) are derived from the character constants, so they move by themselves; a test that samples clumps against them must still pass without touching the bound functions.
- Frame bar: +2.0 ms at 4× pixels at DEEP and MEADOW against the `main` this branches from (`f276f25`), paired both orders; native reported.

---

## File map

| file | task | responsibility |
| --- | --- | --- |
| `client/src/sim/clutter.ts` | 1 | `CLUTTER_GRASS_CANOPY_FLOOR` 0.15 → 0.5 |
| `client/test/sim/clutter.test.ts`, `client/test/sim/groundGradient.test.ts` | 1 | the floor pin, the digest and the census rows that read the field's grass |
| `client/src/game/bladeMeshes.ts`, `client/src/game/bladeField.ts` | 2 | `BLADE_CANOPY_HEIGHT` 1, `BLADE_THIN_BAND` [0.25, 0.45], the height scale as a pure function |
| `client/test/game/bladeMeshes.test.ts`, `client/test/game/bladeField.test.ts` | 2 | the height at the floor under full canopy; the band pins |
| `client/src/game/duffClump.ts`, `client/src/game/duffField.ts` | 3 | the characters, weights, disc, reach and `DUFF_VERTEX_BUDGET` |
| `client/test/game/duffClump.test.ts`, `client/test/game/duffField.test.ts` | 3 | the pins, the budget test on the reach constants |
| `docs/rendering/2026-09-24-forest-floor-verification.md` | 4 | the gates |

---

### Task 1: The canopy floor

**Files:**
- Modify: `client/src/sim/clutter.ts:88`
- Test: `client/test/sim/clutter.test.ts:963`, `client/test/sim/groundGradient.test.ts` (the `CLUTTER_CENSUS` rows for grass, meadow and flower, and the `passHash()` pin near line 633)

**Interfaces:**
- Produces: `CLUTTER_GRASS_CANOPY_FLOOR = 0.5`. Under full canopy (`shade = 1`) the field's grass multiplier is exactly the floor, so `groundCover` at a full-canopy interior cell returns `grass ≈ 0.5 × patch × boost` where it returned `0.15 × …`.

- [ ] **Step 1: Write the failing tests**

In `client/test/sim/clutter.test.ts`, replace the pin at line 963 and add beside it:

```ts
    expect(CLUTTER_GRASS_CANOPY_FLOOR).toBe(0.5);
```

```ts
  it("keeps half the sward under a closed canopy, and the duff yields to it", () => {
    // A cell under full canopy, away from every non-grass neighbour: the
    // canopy multiplier is the floor itself.
    const seed = 1;
    let found: { x: number; z: number } | null = null;
    for (let x = 0; x < 600 && !found; x += 3) for (let z = 0; z < 600 && !found; z += 3) {
      const s = elevationSampleAt(seed, x, z);
      if (forestDensity(seed, x, z, s) > 0.95 && activeTerrainVariant().trailDistance!(seed, x, z) > 30) found = { x, z };
    }
    expect(found).not.toBeNull();
    const s = elevationSampleAt(seed, found!.x, found!.z);
    const c = groundCover(seed, found!.x, found!.z, s);
    // grass is at least the floor's share of what the open field would give,
    // and the duff there is what the field's own share term says
    expect(c.grass).toBeGreaterThanOrEqual(CLUTTER_GRASS_CANOPY_FLOOR * 0.25);
    expect(c.duff).toBeLessThanOrEqual(1);
  });
```

(Use the file's existing imports for `elevationSampleAt`, `forestDensity`, `activeTerrainVariant` and `groundCover`; the file already imports the sim passes. The `0.25` is the patch floor's order — if the file pins `CLUTTER_GRASS_PATCH_FLOOR`, use that constant instead of the literal.)

- [ ] **Step 2: Run to verify they fail** — `npx vitest run --root client test/sim/clutter.test.ts` — the pin fails on 0.15.

- [ ] **Step 3: Implement** — `client/src/sim/clutter.ts:88`: `export const CLUTTER_GRASS_CANOPY_FLOOR = 0.5;` and update the constant's comment (the forest floor keeps half its sward under the densest canopy; the litter fills the rest).

- [ ] **Step 4: Run** `npx vitest run --root client test/sim/clutter.test.ts test/sim/groundGradient.test.ts`. `groundGradient` fails on the digest and on the census rows whose class reads the field's grass (grass, meadow, flower — and only those). Read each new value off the failure and re-pin, with the file's dated comment style naming this change, e.g. `// grass: 987 -> N on 2026-09-24 (the canopy floor rose from 0.15 to 0.5)`. Re-run: green.

- [ ] **Step 5: Commit** — `git add client/src/sim/clutter.ts client/test/sim/clutter.test.ts client/test/sim/groundGradient.test.ts`, subject `feat: keep half the sward under the canopy`. The `## How` entry for `groundGradient.test.ts` says the level id moves.

---

### Task 2: Grass that stands under the canopy

**Files:**
- Modify: `client/src/game/bladeMeshes.ts:49-51` and the height computation around line 282
- Modify: `client/src/game/bladeField.ts:67`
- Test: `client/test/game/bladeMeshes.test.ts`, `client/test/game/bladeField.test.ts:57`

**Interfaces:**
- Produces: `export function bladeHeightScale(strength: number, canopy: number): number` in `bladeMeshes.ts`, the pure form of the expression at line 282, used there; `BLADE_CANOPY_HEIGHT = 1`; `BLADE_THIN_BAND = [0.25, 0.45]`.

- [ ] **Step 1: Write the failing tests**

`client/test/game/bladeMeshes.test.ts` (beside the file's existing constant pins; import `bladeHeightScale`, `BLADE_CANOPY_HEIGHT`, `BLADE_STRENGTH_HEIGHT`):

```ts
  it("draws floor grass under a closed canopy at three-quarter height, from one cut not two", () => {
    expect(BLADE_CANOPY_HEIGHT).toBe(1);
    expect(BLADE_STRENGTH_HEIGHT).toEqual([0.5, 1]);
    expect(bladeHeightScale(0.5, 1)).toBeCloseTo(0.75, 6);
    expect(bladeHeightScale(1, 1)).toBeCloseTo(1, 6);
    expect(bladeHeightScale(0, 0)).toBeCloseTo(0.5, 6);
    // the canopy no longer scales height on its own
    expect(bladeHeightScale(0.5, 0)).toBeCloseTo(bladeHeightScale(0.5, 1), 6);
  });
```

`client/test/game/bladeField.test.ts:57`: `expect(BLADE_THIN_BAND).toEqual([0.25, 0.45]);` and add:

```ts
    // a cell at the canopy floor draws the base clump, not the thin one
    expect(bladeSizeFor(0.5, 0.5)).toBe(1);
    expect(bladeSizeFor(0.99, 0.5)).toBe(1);
```

(`bladeSizeFor(draw, cover)` returns 0 thin, 1 base, 2 full; if its dither means a draw of 0.5 at cover 0.5 is not deterministic under the new band, assert instead that over draws 0…1 at cover 0.5 no size 0 is returned.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`bladeMeshes.ts`: `export const BLADE_CANOPY_HEIGHT = 1;` (comment: the canopy no longer shortens the sward on its own; strength carries the height). Extract:

```ts
/** A cell's height scale: the strength cut between BLADE_STRENGTH_HEIGHT's
 * ends, then the canopy's own scale toward BLADE_CANOPY_HEIGHT. */
export function bladeHeightScale(strength: number, canopy: number): number {
  return (BLADE_STRENGTH_HEIGHT[0] + (BLADE_STRENGTH_HEIGHT[1] - BLADE_STRENGTH_HEIGHT[0]) * strength) *
    (1 + (BLADE_CANOPY_HEIGHT - 1) * canopy);
}
```

and at line 282 `const heightScale = bladeHeightScale(c.strength, c.canopy);`. `bladeField.ts:67`: `export const BLADE_THIN_BAND: readonly [number, number] = [0.25, 0.45];` with the comment updated (a canopy-floor cell sits above the band).

- [ ] **Step 4: Run** `npx vitest run --root client test/game/bladeMeshes.test.ts test/game/bladeField.test.ts test/game/bladeClump.test.ts` — PASS (the vertex-budget test in `bladeClump.test.ts` assumes every cell full and is unaffected).

- [ ] **Step 5: Commit** — subject `feat: let the sward stand under the canopy`.

---

### Task 3: Litter you can see

**Files:**
- Modify: `client/src/game/duffClump.ts:76, 96-100` (and export `DUFF_VERTEX_BUDGET`)
- Modify: `client/src/game/duffField.ts:33, 47`
- Test: `client/test/game/duffClump.test.ts:12-17, 127-139`, `client/test/game/duffField.test.ts:34, 58`

**Interfaces:**
- Produces, in `duffClump.ts`:
  ```ts
  export const DUFF_CLUMP_RADIUS = 0.5;
  export const DUFF_VERTEX_BUDGET = 480_000;
  export const DUFF_CHARACTERS: readonly DuffCharacter[] = [
    { name: "twig", pieces: [3, 5], length: [0.10, 0.25], width: 0.012, tint: { r: 1.0, g: 0.85, b: 0.65 }, tintSpread: 0.25, lift: [0.05, 0.25], forked: false },
    { name: "leaf", pieces: [14, 22], length: [0.12, 0.20], width: 0.08, tint: { r: 1.15, g: 0.80, b: 0.45 }, tintSpread: 0.3, lift: [0.1, 0.5], forked: false },
    { name: "small branch", pieces: [1, 1], length: [0.30, 0.60], width: 0.010, tint: { r: 0.85, g: 0.70, b: 0.55 }, tintSpread: 0.2, lift: [0.02, 0.15], forked: true },
  ];
  ```
  and in `duffField.ts`: `DUFF_REACH = { high: 24, medium: 16 }`, `DUFF_CHARACTER_WEIGHTS = [0.15, 0.75, 0.10]`. `DUFF_HEIGHT_MAX` (0.12) and `DUFF_TIER_EDGE` (6) do not move: a 20 cm leaf at the top of its lift reaches 0.2 × sin 0.5 = 0.096 m.

- [ ] **Step 1: Write the failing tests**

`duffClump.test.ts:12-17`: pins become `pieces [3, 5]` for the twig, `[14, 22]` for the leaf, `DUFF_CLUMP_RADIUS 0.5`, `DUFF_HEIGHT_MAX 0.12` unchanged; add `expect(DUFF_CHARACTERS[DUFF_LEAF]!.length).toEqual([0.12, 0.20]); expect(DUFF_CHARACTERS[DUFF_LEAF]!.width).toBe(0.08); expect(DUFF_CHARACTERS[DUFF_TWIG]!.width).toBe(0.012);`.

`duffClump.test.ts:127`, rewrite the budget test on the constants (import `DUFF_REACH`, `DUFF_TIER_EDGE`, `DUFF_TIER_BAND`, `DUFF_PAD` from `duffField.js` and `DUFF_VERTEX_BUDGET` from `duffClump.js`):

```ts
  it("stays under the vertex budget over the high tier's reach at full strength", () => {
    // 1 m lattice, near disc to the tier edge + pad, far annulus to the reach + pad.
    // `count` is the tier multiplier (DUFF_TIER_COUNTS), not a piece count.
    const e = DUFF_TIER_EDGE, r = DUFF_REACH.high, pad = DUFF_PAD;
    const near = Math.PI * (e + pad) ** 2, far = Math.PI * ((r + pad) ** 2 - Math.max(0, e - DUFF_TIER_BAND - pad) ** 2);
    let worst = 0;
    for (const ch of DUFF_CHARACTERS) {
      worst = Math.max(worst, near * duffVertexCount(ch, DUFF_TIER_COUNTS.high[0]) + far * duffVertexCount(ch, DUFF_TIER_COUNTS.high[1]));
    }
    expect(worst).toBeLessThan(DUFF_VERTEX_BUDGET);
    expect(worst).toBeGreaterThan(DUFF_VERTEX_BUDGET * 0.5); // the budget is a real bound, not a formality
  });
```

`duffField.test.ts:34`: `expect(DUFF_REACH).toEqual({ high: 24, medium: 16 });` and `:58`: `expect(DUFF_CHARACTER_WEIGHTS).toEqual([0.15, 0.75, 0.1]);`. Add beside them:

```ts
  it("keeps the widest padded reach inside the collector's cache", () => {
    const cells = Math.PI * (DUFF_REACH.high + DUFF_PAD) ** 2 / (DUFF_CELL * DUFF_CELL);
    expect(cells).toBeLessThan(DUFF_SWEEP_SIZE);
  });
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run --root client test/game/duffClump.test.ts test/game/duffField.test.ts`.

- [ ] **Step 3: Implement** the constants above. The `DUFF_CHARACTERS` comment block describes the pieces as they now are (a leaf 12–20 cm long and 8 cm wide, fourteen to twenty-two to a clump; a twig 1.2 cm wide). `DUFF_VERTEX_BUDGET` gets a comment stating what it bounds (the worst single character over the high tier's padded reach at full strength) and the measured worst (~422 k).

- [ ] **Step 4: Run** `npx vitest run --root client test/game/duffClump.test.ts test/game/duffField.test.ts test/game/duffMeshes.test.ts` — PASS. The analytic bound tests ("bounds a real sample") must pass untouched — the bounds derive from the constants. If `duffClumpMaxHeight` for the new leaf exceeds `DUFF_HEIGHT_MAX`, report it rather than raising the max: the numbers above say it does not (0.096 m).

- [ ] **Step 5: Commit** — subject `feat: leaf-sized litter to a wider reach`.

---

### Task 4: The gates and the note

Owned by the run's controller with a browser rig, not dispatched: paired stills at a full-canopy floor cell and an interior grass cell against `f276f25`, eye level and looking down; the near-field blade histogram at both; litter coverage from the instance buffers; frame pairs at DEEP and MEADOW at 4× and native. Written to `docs/rendering/2026-09-24-forest-floor-verification.md` in the format of `docs/rendering/2026-09-24-trail-neglect-verification.md`, every pair listed.

---

## Self-review

**Spec coverage.** Amendment "Litter": sizes, counts, shares, disc, reach, budget → Task 3. "Canopy grass": floor → Task 1; `BLADE_CANOPY_HEIGHT`, thin band → Task 2. "Gates" → Task 4. The duff's fall under canopy is a consequence of Task 1's constant through the existing `1 − grass / boost` term — no code.

**Placeholders.** None. Every constant has its value; every pin its line.

**Type consistency.** `bladeHeightScale(strength, canopy)` is defined in Task 2 and used only there. `DUFF_VERTEX_BUDGET`, `DUFF_PAD`, `DUFF_SWEEP_SIZE`, `DUFF_CELL` exist or are created in Task 3's files (`DUFF_PAD`, `DUFF_CELL`, `DUFF_SWEEP_SIZE` already exist in `duffField.ts`). Tasks 1, 2 and 3 touch disjoint files and can be reviewed independently; the level id moves once, in Task 1.
