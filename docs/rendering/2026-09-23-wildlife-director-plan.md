# Wildlife Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the player moves through daylight woods an animal is on screen about every five to ten seconds, most of them small; none is ever seen appearing or vanishing; the woods go quiet during the chase and near the Hollow.

**Architecture:** A pure director (`wildlifeDirector.ts`) receives the frame's view, the units and the match state, detects sightings, keeps a jittered target gap, and emits cue events — first choice, drive an existing off-screen unit to a goal; otherwise place a unit from a small per-species pool of director-owned units — every placement satisfying a never-on-screen invariant the director asserts on itself. One new behaviour phase walks a unit to a goal and resumes rest. A code-built butterfly rides the bird card path as a fifth card species. The wildlife shell calls the director each frame and applies its events; the renderer passes the view and the match state through.

**Tech Stack:** TypeScript, Babylon.js 9.18 (thin instances, NullEngine), vitest.

**Spec:** `docs/rendering/2026-09-23-wildlife-director-design.md`. Touches none of the other three sub-projects' files.

## Global Constraints

- The repository is public. Code, comments, docs and commit messages describe the change and the running game, nothing about how the work was done.
- Stage explicit paths only. Never `git add -A` or `git add .`.
- Commit messages: a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list led by backticked paths, a blank line, then a parsing `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that wrote the commit.
- The invariant: at the instant the director creates or moves a unit it is outside the view cone by `VIEW_MARGIN`, or behind terrain, or beyond the hide range; a unit is never removed while on screen. The director asserts this on every event; a test drives a thousand frames and checks every one.
- No per-frame allocation in the director's `step`: candidates, events and the log live in preallocated arrays (the pattern `wildlifeMeshes.ts` keeps and its allocation test enforces).
- `wildlifeDirector.ts` and `wildlifeBehaviour.ts` import nothing from Babylon.
- Wildlife stays cosmetic and local: nothing here crosses the wire or enters `sim/`.
- Frame: a 4× pixel pair at TRAIL and MEADOW against `main` within noise (≤ +0.3 ms); native p95 under 17.5 ms; every game page blanked before each sample.
- Docs live in `docs/rendering/` named `YYYY-MM-DD-<topic>.md`.

---

## File map

| file | task | responsibility |
| --- | --- | --- |
| `client/src/game/wildlifeDirector.ts` | 1, 2 | the on-screen predicate, the clock, the scheduler, staging, the invariant, the log |
| `client/src/game/wildlifeBehaviour.ts` | 2 | `PHASE_CUE`; the butterfly's flight (Task 4) |
| `client/src/game/wildlifeField.ts` | 3, 4 | director pool ids; the butterfly species |
| `client/src/game/wildlifeMeshes.ts` | 3, 4 | calls the director, applies its events, owns the pool; the butterfly card |
| `client/src/game/renderer.ts` | 3 | passes the view and the match state through |
| `ARCHITECTURE.md`, the verification note | 5 | docs and gates |

---

### Task 1: Sighting detection and the clock

**Files:**
- Create: `client/src/game/wildlifeDirector.ts`
- Test: `client/test/game/wildlifeDirector.test.ts`

**Interfaces:**
- Consumes: `elevationSampleAt(seed, x, z)` from `../sim/terrain.js` for the line of sight (injected as a function so tests can hand in a synthetic heightfield); `SPECIES_*`, `FIRST_BIRD_SPECIES`, `SPECIES_COUNT` from `./wildlifeField.js`; `SIM_TICK_HZ` from `../sim/constants.js`; `hash3` from `../sim/field.js`.
- Produces:
  ```ts
  export const VIEW_MARGIN = 5 * Math.PI / 180;
  export const SIGHTING_DWELL = 1;            // s
  export const GAP: readonly [number, number] = [5, 10]; // s
  export const LEAD = 2; export const RETRY = 1;          // s
  export const SMALL_TO_LARGE = 6;
  export const STILL_RELAX = 1.8; export const STILL_SECONDS = 3; export const STILL_SPEED = 0.3;
  export const NIGHT_RELAX = 2.5;
  export const HOLLOW_QUIET = 60;             // m
  export const RECYCLE = 60;                  // m
  export const HIDE_RANGE: readonly [number, number] = [200, 40]; // m at mist 0 → 1
  export const NOTICE: readonly number[];     // per species: elk 45, deer 45, rabbit 15, squirrel 15, birds Infinity (the hide range bounds them)
  export const LOS_SAMPLES = 4;
  export type View = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; aspect: number };
  export type MatchState = { phase: number; hollowDistance: number; hollowHunting: boolean; inWorld: boolean; hour: number; mist: number };
  export type Ground = (x: number, z: number) => number;   // ground height
  export type Seen = { id: number; species: number; x: number; y: number; z: number };
  export function hideRange(mist: number): number;
  export function inCone(view: View, x: number, y: number, z: number, margin: number): boolean;
  export function lineOfSight(ground: Ground, view: View, x: number, y: number, z: number): boolean;
  export function onScreen(view: View, ground: Ground, unit: Seen, mist: number): boolean;
  export function isNight(hour: number): boolean;         // the calls' dawn/dusk window, from wildlifeBehaviour's DAWN_HOUR/DUSK
  export type DirectorState = { sinceSighting: number; targetGap: number; lastSpecies: number; stillFor: number; lastSeenId: number; dwell: number; nextTry: number; log: Int32Array; logCount: number };
  export function createDirectorState(seed: number): DirectorState;
  export function relaxFor(state: DirectorState, match: MatchState): number;  // Infinity when quiet
  export function observe(state: DirectorState, view: View, ground: Ground, units: readonly Seen[], match: MatchState, dt: number, seed: number): void;
  ```
  `observe` advances the clock: marks the dwell of any on-screen unit, records a sighting when the dwell reaches `SIGHTING_DWELL` (resets `sinceSighting`, redraws `targetGap` from `GAP` by `hash3(seed, tick, 1, 0)`, appends to the log), and tracks stillness from the view's movement.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { SPECIES_DEER, SPECIES_ELK, SPECIES_GULL, SPECIES_RABBIT } from "../../src/game/wildlifeField.js";
import {
  GAP, HIDE_RANGE, HOLLOW_QUIET, LEAD, NIGHT_RELAX, NOTICE, SIGHTING_DWELL, SMALL_TO_LARGE, STILL_RELAX, STILL_SECONDS, VIEW_MARGIN,
  createDirectorState, hideRange, inCone, lineOfSight, observe, onScreen, relaxFor, type MatchState, type View,
} from "../../src/game/wildlifeDirector.js";

const flat = (): number => 0;
const ridge = (x: number): number => (x > 20 && x < 24 ? 6 : 0); // a wall across x ∈ (20, 24)
const view = (yaw = 0, x = 0, z = 0): View => ({ x, y: 1.7, z, yaw, pitch: 0, fov: 1.4, aspect: 16 / 9 });
const day: MatchState = { phase: 0, hollowDistance: Infinity, hollowHunting: false, inWorld: true, hour: 12, mist: 0 };

describe("the on-screen predicate", () => {
  it("is inside the cone with a margin, within notice, nearer than the hide range, and not behind terrain", () => {
    expect(VIEW_MARGIN).toBeCloseTo(5 * Math.PI / 180, 12);
    // Yaw 0 looks down +z. A rabbit 10 m ahead is seen; 10 m behind is not; at 14 m off the edge of a 1.4 rad cone it is not.
    expect(inCone(view(), 0, 0.3, 10, VIEW_MARGIN)).toBe(true);
    expect(inCone(view(), 0, 0.3, -10, VIEW_MARGIN)).toBe(false);
    const halfW = Math.tan(1.4 / 2) * (16 / 9); // horizontal half-extent per metre of depth
    expect(inCone(view(), halfW * 10 * 1.2, 0.3, 10, VIEW_MARGIN)).toBe(false);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 10 }, 0)).toBe(true);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: NOTICE[SPECIES_RABBIT]! + 1 }, 0)).toBe(false);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 }, 0)).toBe(true);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: 0, y: 1.2, z: 46 }, 0)).toBe(false);
    // Fog: at mist 1 the hide range is 40 m, so the elk at 40 m is gone.
    expect(hideRange(0)).toBe(HIDE_RANGE[0]); expect(hideRange(1)).toBe(HIDE_RANGE[1]);
    expect(onScreen(view(), flat, { id: 1, species: SPECIES_ELK, x: 0, y: 1.2, z: 40 }, 1)).toBe(false);
    // Terrain: a 6 m ridge between the eye and a deer at x = 30 hides it; looking along +x.
    expect(lineOfSight(ridge, view(Math.PI / 2), 30, 1.2, 0)).toBe(false);
    expect(lineOfSight(ridge, view(Math.PI / 2), 15, 1.2, 0)).toBe(true);
    expect(onScreen(view(Math.PI / 2), ridge, { id: 2, species: SPECIES_DEER, x: 30, y: 1.2, z: 0 }, 0)).toBe(false);
  });
});

describe("the clock", () => {
  it("counts a sighting after the dwell, resets, and redraws the gap inside the band", () => {
    const s = createDirectorState(7);
    expect(s.targetGap).toBeGreaterThanOrEqual(GAP[0]); expect(s.targetGap).toBeLessThanOrEqual(GAP[1]);
    const rabbit = { id: 1, species: SPECIES_RABBIT, x: 0, y: 0.3, z: 10 };
    for (let i = 0; i < 30; i++) observe(s, view(), flat, [rabbit], day, 1 / 60, 7); // 0.5 s: no sighting yet
    expect(s.logCount).toBe(0);
    for (let i = 0; i < 40; i++) observe(s, view(), flat, [rabbit], day, 1 / 60, 7); // past SIGHTING_DWELL
    expect(s.logCount).toBe(1);
    expect(s.sinceSighting).toBeLessThan(0.2);
    expect(s.lastSpecies).toBe(SPECIES_RABBIT);
    // Off screen the clock runs.
    for (let i = 0; i < 300; i++) observe(s, view(), flat, [], day, 1 / 60, 7);
    expect(s.sinceSighting).toBeCloseTo(5, 1);
    expect(SIGHTING_DWELL).toBe(1); expect(LEAD).toBe(2); expect(SMALL_TO_LARGE).toBe(6);
  });
  it("relaxes when still, at night, and goes quiet for the chase, the Hollow and other screens", () => {
    const s = createDirectorState(7);
    expect(relaxFor(s, day)).toBe(1);
    s.stillFor = STILL_SECONDS + 0.1;
    expect(relaxFor(s, day)).toBe(STILL_RELAX);
    s.stillFor = 0;
    expect(relaxFor(s, { ...day, hour: 2 })).toBe(NIGHT_RELAX);
    expect(relaxFor(s, { ...day, phase: 1 })).toBe(Infinity);
    expect(relaxFor(s, { ...day, hollowDistance: HOLLOW_QUIET - 1 })).toBe(Infinity);
    expect(relaxFor(s, { ...day, hollowHunting: true })).toBe(Infinity);
    expect(relaxFor(s, { ...day, inWorld: false })).toBe(Infinity);
  });
  it("tracks stillness from the view's own movement", () => {
    const s = createDirectorState(7);
    for (let i = 0; i < 240; i++) observe(s, view(0, 0, 0), flat, [], day, 1 / 60, 7); // 4 s still
    expect(s.stillFor).toBeGreaterThan(STILL_SECONDS);
    observe(s, view(0, 0, 1), flat, [], day, 1 / 60, 7); // 60 m/s for a frame
    expect(s.stillFor).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run --root client test/game/wildlifeDirector.test.ts`.

- [ ] **Step 3: Implement** the constants, `View`, `MatchState`, `Ground`, `Seen`; `hideRange(mist) = HIDE_RANGE[0] + (HIDE_RANGE[1] − HIDE_RANGE[0]) · clamp01(mist)`; `inCone`: transform the point into the view frame (yaw about y, pitch about x), require depth > 0, `|x/depth| ≤ tan(fov/2)·aspect · (1 + margin/ (fov/2))` and `|y/depth| ≤ tan(fov/2) · (1 + margin/(fov/2))` — margin widens the cone so "outside by the margin" is a strictly larger exclusion; `lineOfSight`: `LOS_SAMPLES` points along the ray from the eye to `(x, y, z)` at fractions 0.2, 0.4, 0.6, 0.8, false if `ground(px, pz) > ray height` at any; `onScreen` = in cone (with the margin *subtracted*, i.e. the strict cone) ∧ distance ≤ min(NOTICE[species], hideRange(mist)) ∧ lineOfSight; `isNight` from `DAWN_HOUR`/`DAWN_DUSK_WINDOW` in `wildlifeBehaviour.ts` (night when outside the day window those define); `createDirectorState` with a 256-entry `Int32Array` log of `(tick, species)` pairs; `relaxFor`; `observe` as specified, tracking the view's displacement per frame for stillness (`speed = hypot(dx, dz) / dt`; `stillFor += dt` if `speed < STILL_SPEED` else 0). Sightings use one dwell counter per unit id in a preallocated map keyed by id (a `Map<number, number>` is fine: it lives across frames and is not per-frame allocation).

- [ ] **Step 4: Run** — PASS, plus `test/architecture.test.ts`.

- [ ] **Step 5: Commit** — `git add client/src/game/wildlifeDirector.ts client/test/game/wildlifeDirector.test.ts`, subject `feat: the wildlife director's eye and clock`.

---

### Task 2: Cues, staging, the invariant, and `PHASE_CUE`

**Files:**
- Modify: `client/src/game/wildlifeDirector.ts`
- Modify: `client/src/game/wildlifeBehaviour.ts` (`PHASE_CUE`, its step, `clipForPhase`)
- Test: `client/test/game/wildlifeDirector.test.ts`, `client/test/game/wildlifeBehaviour.test.ts`

**Interfaces:**
- Produces, in the director:
  ```ts
  export type Candidate = { id: number; species: number; x: number; y: number; z: number; onScreen: boolean; phase: number };
  export type CueEvent =
    | { kind: "drive"; id: number; goalX: number; goalZ: number; run: boolean }
    | { kind: "place"; species: number; x: number; z: number; goalX: number; goalZ: number; run: boolean }
    | { kind: "remove"; id: number };
  export const STAGING_CROSS = 0, STAGING_COVER = 1, STAGING_TREELINE = 2;
  export function stagingFor(species: number): number;
  export function pickSpecies(state: DirectorState, draw: number): number;      // small 6:1, never lastSpecies
  export function stageCue(state, view, ground, candidates: readonly Candidate[], match, tick, seed, out: CueEvent[]): boolean;
  export function placementValid(view, ground, x, y, z, mist): boolean;       // the invariant's predicate
  export function step(state, view, ground, candidates, match, dt, tick, seed, out: CueEvent[]): void; // observe, then stage when due
  ```
  In `wildlifeBehaviour.ts`: `export const PHASE_CUE = 5`; `UnitState` gains `cueRun: boolean`; `stepUnit` handles `PHASE_CUE` for every ground species: move toward `(goalX, goalZ)` at the species' walk speed (run speed when `cueRun`), and on arrival `enter(u, PHASE_REST, tick)`; `clipForPhase(species, PHASE_CUE, moving)` returns `"run"` when running else `"walk"`. Birds in `PHASE_CUE` take the heading to the goal in their existing card flight and resume their loop on arrival.
- The pool: the director never creates units itself; a `place` event is applied by the shell (Task 3), which owns `DIRECTOR_POOL` units per species.

- [ ] **Step 1: Write the failing tests**

Director:

```ts
describe("cues", () => {
  it("weights small over large six to one and never repeats the last species", () => {
    const s = createDirectorState(3);
    const counts = new Map<number, number>();
    for (let i = 0; i < 10000; i++) { const sp = pickSpecies(s, (i + 0.5) / 10000); counts.set(sp, (counts.get(sp) ?? 0) + 1); }
    const small = [SPECIES_RABBIT, SPECIES_SQUIRREL, SPECIES_RAVEN_ROOST, SPECIES_RAVEN_PAIR, SPECIES_GULL, SPECIES_BUTTERFLY].reduce((a, sp) => a + (counts.get(sp) ?? 0), 0);
    const large = [SPECIES_DEER, SPECIES_ELK, SPECIES_EAGLE].reduce((a, sp) => a + (counts.get(sp) ?? 0), 0);
    expect(small / large).toBeGreaterThan(SMALL_TO_LARGE * 0.9); expect(small / large).toBeLessThan(SMALL_TO_LARGE * 1.1);
    s.lastSpecies = SPECIES_RABBIT;
    for (let i = 0; i < 1000; i++) expect(pickSpecies(s, (i + 0.5) / 1000)).not.toBe(SPECIES_RABBIT);
  });
  it("stages by species: cross for birds, cover for rabbit and squirrel, tree line for deer and elk", () => {
    expect(stagingFor(SPECIES_GULL)).toBe(STAGING_CROSS);
    expect(stagingFor(SPECIES_RABBIT)).toBe(STAGING_COVER);
    expect(stagingFor(SPECIES_ELK)).toBe(STAGING_TREELINE);
  });
  it("prefers to drive an existing off-screen unit, and places only when none is available", () => {
    const s = createDirectorState(3); s.sinceSighting = 20; s.targetGap = 5; s.lastSpecies = SPECIES_ELK;
    const out: CueEvent[] = [];
    const offScreenRabbit: Candidate = { id: 9, species: SPECIES_RABBIT, x: 0, y: 0.3, z: -10, onScreen: false, phase: 0 };
    // Force the rabbit: the draw is arranged by seed; loop seeds until the pick is a rabbit.
    let staged = false;
    for (let seed = 0; seed < 200 && !staged; seed++) { out.length = 0; if (pickSpecies(s, hash3(seed, 100, 2, 0)) === SPECIES_RABBIT) staged = stageCue(s, view(), flat, [offScreenRabbit], day, 100, seed, out); }
    expect(staged).toBe(true);
    expect(out[0]!.kind).toBe("drive");
    out.length = 0;
    // With no rabbit available the cue places one.
    for (let seed = 0; seed < 200; seed++) { out.length = 0; if (pickSpecies(s, hash3(seed, 100, 2, 0)) === SPECIES_RABBIT && stageCue(s, view(), flat, [], day, 100, seed, out)) break; }
    expect(out[0]!.kind).toBe("place");
  });
  it("never places or drives on screen: a thousand seeded frames with a walking, turning player", () => {
    const s = createDirectorState(11);
    const units: Candidate[] = [];
    const out: CueEvent[] = [];
    let violations = 0, cues = 0, x = 0, z = 0, yaw = 0;
    const stagings = new Set<number>();
    for (let tick = 0; tick < 1000 * 60; tick += 6) { // 1000 steps of 0.1 s
      x += 0.14 * Math.sin(yaw); z += 0.14 * Math.cos(yaw); yaw += 0.01;
      const v = view(yaw, x, z);
      out.length = 0;
      step(s, v, flat, units, day, 0.1, tick, 11, out);
      for (const e of out) {
        cues++;
        if (e.kind === "place") { if (!placementValid(v, flat, e.x, 0.5, e.z, 0)) violations++; units.push({ id: 1000 + units.length, species: e.species, x: e.x, y: 0.5, z: e.z, onScreen: false, phase: 0 }); stagings.add(stagingFor(e.species)); }
        if (e.kind === "drive") { const u = units.find((c) => c.id === e.id)!; if (u.onScreen) violations++; }
        if (e.kind === "remove") { const i = units.findIndex((c) => c.id === e.id); if (units[i]!.onScreen) violations++; units.splice(i, 1); }
      }
      // Move driven units a little and refresh on-screen flags.
      for (const u of units) u.onScreen = onScreen(v, flat, u, 0);
    }
    expect(violations).toBe(0);
    expect(cues).toBeGreaterThan(20);
    expect(stagings.size).toBeGreaterThanOrEqual(2);
    // The gaps' median lies inside the band (the log holds (tick, species) pairs).
    const gaps: number[] = [];
    for (let i = 1; i < s.logCount; i++) gaps.push((s.log[i * 2]! - s.log[(i - 1) * 2]!) / 60);
    gaps.sort((a, b) => a - b);
    if (gaps.length > 5) { const med = gaps[Math.floor(gaps.length / 2)]!; expect(med).toBeGreaterThanOrEqual(GAP[0]); expect(med).toBeLessThanOrEqual(GAP[1] * 2); }
  });
});
```

(Import `SPECIES_BUTTERFLY` from `wildlifeField.js` — Task 4 adds it; until then define it in the director as `SPECIES_COUNT` and re-export, and Task 4 moves it. `hash3` from `../../src/sim/field.js`.)

Behaviour: in `wildlifeBehaviour.test.ts`, a test that a rabbit put into `PHASE_CUE` with a goal 8 m away walks there at its walk speed (run speed with `cueRun`), and on arrival is in `PHASE_REST`; `clipForPhase(SPECIES_RABBIT, PHASE_CUE, true)` is `"walk"`, with `cueRun` `"run"`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — `pickSpecies` walks a weight table (small species `SMALL_TO_LARGE` each, large 1 each; the eagle counts large) with the last species zeroed; `stagingFor`; `placementValid(view, ground, x, y, z, mist) = !inCone(view, x, y, z, VIEW_MARGIN) || !lineOfSight(ground, view, x, y, z) || dist > hideRange(mist)`; `stageCue`: pick the species by `hash3(seed, tick, 2, 0)`; find the nearest off-screen candidate of that species within `RECYCLE` — if found, emit `drive` with a goal by staging (cross: a point across the cone at the unit's range; cover: a point 6 m across the view inside 15 m; tree line: a point 30 m ahead inside the cone) and `run` for cover; otherwise try up to eight seeded start positions per staging (cross: outside the cone by 2× margin at 20–40 m; cover: behind terrain or beyond a lateral edge within 15 m — a candidate passes only if `placementValid`; tree line: outside the cone at 25–45 m, or inside beyond the hide range) and emit `place`; return whether an event was emitted; set `state.nextTry = now + RETRY` on failure. `step` = `observe`, then if `relax < Infinity && sinceSighting > targetGap · relax − LEAD && now ≥ nextTry` → `stageCue`. Removal: when a candidate of the director's pool (ids ≥ `DIRECTOR_ID_BASE`, Task 3) is off screen and beyond 1.5× its notice distance for 5 s, emit `remove`. In `wildlifeBehaviour.ts` add `PHASE_CUE` and its step for the four ground species and the bird heading.

- [ ] **Step 4: Run** the director and behaviour test files — PASS.

- [ ] **Step 5: Commit** — `git add client/src/game/wildlifeDirector.ts client/src/game/wildlifeBehaviour.ts client/test/game/wildlifeDirector.test.ts client/test/game/wildlifeBehaviour.test.ts`, subject `feat: the director stages animals into view and never on screen`.

---

### Task 3: The shell applies the director; the renderer passes the state

**Files:**
- Modify: `client/src/game/wildlifeMeshes.ts` (`update` signature; the director; the pool; applying events; exposing the log)
- Modify: `client/src/game/wildlifeField.ts` (`DIRECTOR_ID_BASE`, `DIRECTOR_POOL`)
- Modify: `client/src/game/renderer.ts` (both `wildlife?.update(...)` calls; the `sync` path reading `state.phase` and the Hollow)
- Test: `client/test/game/wildlifeMeshes.test.ts`, `client/test/game/renderer.test.ts`

**Interfaces:**
- Produces: `export const DIRECTOR_ID_BASE = 1 << 28; export const DIRECTOR_POOL: readonly number[]` (per species: elk 1, deer 1, rabbit 2, squirrel 2, birds 2 each, butterfly 3); `WildlifeMeshes.update(camX, camZ, tick, players, weather, hour, director?: { view: View; match: MatchState })` — without the seventh argument the director does not run (tests and the low tier); `WildlifeMeshes.directorLog(): readonly number[]` (the `(tick, species)` pairs so far); the shell builds the `Candidate` list from `states` each frame into a preallocated array, applies `drive` (sets `goalX/goalZ/cueRun` and `enter(PHASE_CUE)`), `place` (takes a pool unit of that species: a `WildlifeUnit` with `id = DIRECTOR_ID_BASE + species * 16 + slot`, positioned at the event, `createUnitState`, `enter(PHASE_CUE)` toward the goal), and `remove` (releases the pool unit). Pool units are exempt from the disc rebuild's `keep` set (they live until removed).
- In `renderer.ts`: the view is the camera (position, yaw, pitch, `camera.fov`, `engine.getAspectRatio(camera)`); the match state is `{ phase: state.phase, hollowDistance, hollowHunting, inWorld: true, hour: lighting.hour, mist: weather.mist }`, where the Hollow is the nearest `EnemyState` with `ai` in `{Emerge, Hunt, Stand}` and `hollowHunting` is `ai === AiState.Hunt`; the freecam path passes `inWorld: true` too.

- [ ] **Step 1: Write the failing tests** — `wildlifeMeshes.test.ts`: with the seventh argument given, after 900 ticks of `update` with the view fixed and a still player, the log is empty (still + no units on screen → the director waits ×1.8) — then with the view swept across a placed pool rabbit, the log records it; a `place` event produces exactly one new state with an id ≥ `DIRECTOR_ID_BASE` that survives a disc rebuild; `remove` releases it; without the seventh argument no pool unit ever exists. `renderer.test.ts`: `createRenderer` on `high` passes a director argument (spy on `update`'s arity through the wildlife shell's exposed log after a few frames with a Hollow in `Hunt` state within 50 m → the log stays empty).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** as the interfaces say; keep the `Candidate` array preallocated to `states.size + pool` and reused.
- [ ] **Step 4: Run** the shell, renderer and director test files, plus the existing allocation test — PASS.
- [ ] **Step 5: Commit** — subject `feat: wire the wildlife director through the shell and the renderer`.

---

### Task 4: The butterfly

**Files:**
- Modify: `client/src/game/wildlifeField.ts` (`SPECIES_BUTTERFLY = 8`, `SPECIES_COUNT = 9`, cell/radius/density/members entries; placement in the open near flower cells by `clutterDensity(seed, CLUTTER_FLOWER, …)`)
- Modify: `client/src/game/wildlifeBehaviour.ts` (the flight: a slow wander 0.3–1.5 m up at 1 m/s; daylight, open, no rain gate through `wildlifePresenceUnder`)
- Modify: `client/src/game/wildlifeMeshes.ts` (`BIRD_ASSET[SPECIES_BUTTERFLY] = "wildlife.butterfly"` resolved to code-built geometry: two 4 cm quads hinged on a 1 cm body, `BUTTERFLY_OMEGA = 12`, a vertex-colour wing pattern in three colourways)
- Test: the three matching test files

**Interfaces:**
- Produces: `SPECIES_BUTTERFLY`; `export function butterflyGeometry(colourway: number): { positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs: Float32Array; indices: Uint16Array }`; `BUTTERFLY_ALT: [0.3, 1.5]`, `BUTTERFLY_SPEED = 1`, `BUTTERFLY_OMEGA = 12`.

- [ ] **Step 1: Write the failing tests** — field: butterfly units exist only where `clutterDensity(seed, CLUTTER_FLOWER, x, z) > 0` and `forestDensity < CLUTTER_GRASS_CANOPY_LO`; behaviour: the pose stays inside `BUTTERFLY_ALT` above the ground and moves at most `BUTTERFLY_SPEED` per second; presence is 0 at night and in rain (`wildlifePresenceUnder` gains a `butterfly` field); meshes: `butterflyGeometry` has 8 vertices (two quads), the wing plugin receives `BUTTERFLY_OMEGA`, three colourways differ, the bird bucket path draws it with `BIRD_ASSET` naming it and no GLB loaded for it.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, moving `SPECIES_BUTTERFLY` from the director's placeholder into `wildlifeField.ts`.
- [ ] **Step 4: Run** the wildlife test files — PASS.
- [ ] **Step 5: Commit** — subject `feat: a code-built butterfly as the fifth card species`.

---

### Task 5: Docs and the gates

- [ ] **Step 1: `ARCHITECTURE.md`** — in the rendering paragraph's wildlife sentence: a director (`wildlifeDirector.ts`) counts the animals the player sees, keeps a jittered five-to-ten second gap in daylight, stages the next one by moving an off-screen unit or placing one where it cannot be seen appearing, and goes quiet during the chase and near the Hollow; a code-built butterfly joins the bird cards.
- [ ] **Step 2: Gates** per the spec's §10, read from `directorLog()` through a gate hook: the three-minute daytime walk's gap histogram (median 5–10 s, no gap over 20 s moving), the night walk (×2.5), the chase segment (zero cues), the invariant review (zero flagged), the three stills, the 4× pixel pair at TRAIL and MEADOW, the native cap check. Record in `docs/rendering/2026-09-23-wildlife-director-verification.md`.
- [ ] **Step 3: Run the whole suite** and `npm run typecheck && npm run lint`.
- [ ] **Step 4: Commit** — subject `docs: describe the wildlife director and record its gates`.

---

## Self-review

**Spec coverage.** §4 detection → Task 1. §5 scheduler, relaxation, quiet → Tasks 1–2. §6 stagings and the invariant → Task 2 (asserted in `placementValid` and the thousand-frame test). §7 budget and recycling → Task 2 (drive first) and Task 3 (the pool, removal off screen, no allocation). §8 butterfly → Task 4. §9 tests → Steps 1. §10 gates → Task 5. §11 fallbacks are the constants in Task 1.

**Placeholders.** None. Task 3's and Task 4's tests are described by their exact assertions against named exports; the implementer writes them in the files' existing scaffolds (`setActiveTerrainVariant("olympic")`, `SEED = 388817`).

**Type consistency.** `View`, `MatchState`, `Ground`, `Seen` (Task 1) are what `step` and `stageCue` take (Task 2) and what the shell builds (Task 3); `CueEvent` is emitted by the director and applied by the shell; `PHASE_CUE` and `cueRun` (Task 2) are what `drive`/`place` set (Task 3); `SPECIES_BUTTERFLY` is a director placeholder in Task 2 and moves to the field in Task 4 with the same value (`SPECIES_COUNT` before the move, 8).
