# Scattering Sky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two skies that disagree at dusk, Babylon's Preetham dome and the hand-tuned colours that light the ground, with one table of the clear sky computed from Rayleigh, aerosol and ozone scattering. The dome, the image-based light, the sun, the fill, the fog colour, the haze's glow and the clear colour all read from it, with a cloud deck over it under cloudy weather.

**Architecture:** A Babylon-free model (`skyModel.ts`) builds Hillaire's transmittance and multiple-scattering tables and, for each of 93 sun altitudes, a 64 × 32 slice of the sky's radiance, in a module worker at load (`sky.worker.ts`, `skyWorker.ts`) into a table that blends between slices (`skyTable.ts`). A pure state (`skyState.ts`) turns the blended slice, the hour and the weather into every value the scene needs: the scale and adaptation, the night factor, the deck, the sun, the fill, the horizon colours and the haze's glow. A new `ShaderMaterial` dome (`skyDome.ts`, `shaders/skyDome.*.fx`) draws the same composition the state's TypeScript transcription computes. `lighting.ts`, the atmosphere plugin's values and the grade read the state; no PBR material's shader changes, and `SkyMaterial` and `@babylonjs/materials` go.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`ShaderMaterial` in GLSL, translated to WGSL ahead from the recorded corpus on WebGPU; `ReflectionProbe` with half-float linear targets; `RawTexture` RGBA16F), Vite module workers, Vitest with `NullEngine`, glslang and the repository's translators under Node.

**Spec:** [`docs/rendering/2026-10-03-scattering-sky-design.md`](2026-10-03-scattering-sky-design.md). The look it replaces is [`2026-09-15-atmosphere-restyle-design.md`](2026-09-15-atmosphere-restyle-design.md).

## Global Constraints

- `client/src/sim/` is untouched. The sky is render-side.
- New Babylon-free modules (no `@babylonjs` import), each added to `BABYLON_FREE_FILES` in `client/test/architecture.test.ts` by the task that creates it: `game/skyModel.ts`, `game/skyTable.ts`, `game/skyState.ts`, `game/halfFloat.ts`, and the worker modules as the architecture test allows.
- GLSL (`client/src/game/shaders/skyDome.vertex.fx`, `skyDome.fragment.fx`) in the style of the repository's `ShaderMaterial` shaders (`rainMap.ts`); never spell a hashed preprocessor keyword in comment prose; never put a semicolon inside a trailing comment (`shaderHygiene.test.ts` enforces both); every texture read explicit-level (`textureLod(skyTable, uv, 0.0)`), never inside a branch on a varying; every shader constant mirrored in TypeScript and pinned in lockstep (`const float NAME = <value>;`, read with `glslFloat`).
- No PBR material's shader text changes: `client/src/game/shaders/atmosphereFog.fragment.fx` is byte-for-byte unchanged. The terrain's fragment stage stays at 16 textures, the lit materials at 12 uniform buffers and 7 lights (`stageBindings.test.ts`); the sun stays light 0 and the fill light 1 (`foliageLightPlugin.test.ts`).
- Noon and midnight are anchored: at clear noon the dome's zenith has luminance 0.416, the sun's intensity is exactly `SUN_PEAK` and the fill exactly `FILL_DAY`; at midnight the fill is exactly `FILL_NIGHT` in `MOONLIGHT`. Image exposure (`exposureFor`, noon 0.9, night 1.6) does not change; the Hollow's eyes are tuned to it.
- The repository is public: nothing in code, comments, docs or commit messages says how the work is organised (no "task", "plan", "brief", "agent", "session", "review", "owner", "ruling"), how a reference was gathered, or where reference photographs came from.
- Commits: a Conventional Commits subject under 72 characters, a body with `## What` and `## How` (backticked paths), ending with the two trailer lines `Co-Authored-By: <the committing model's name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4`. Stage explicit paths; never `git add -A`; never `--no-verify`; never bare `git stash`. After every commit, run the repository's pre-push scan over `origin/main..HEAD`.
- Test time limits through `timeLimit(ms)` (`client/test/helpers/timeLimit.ts`), never a bare number. Every numeric expectation is a literal.
- Each commit typechecks (`npx tsc -p client --noEmit`) and lints (`npx eslint <changed files>`); a function is removed only by the task that moves its last caller.
- Run a client test file from the worktree root with `npx vitest run --root client test/<path>`. The full client suite (`npm run test:client`) is heavy: run only the files a task names unless the task says otherwise, and never while another suite or a browser check runs.

## Review Focus

1. **One source.** The fog colour, the clear colour, the haze's glow and the dome's horizon must come from the same `SkyState`, so they cannot disagree. Pinned in Task 3 (the coherence tests: `horizonAway` is the dome's mean away from the sun at the ring's elevation; `horizonToward` the dome toward it) and Task 6 (the gradient's far end is `mistAir`; the glow's colour is the toward-horizon through the weather).
2. **The two compositions agree.** `domeRadiance` in TypeScript and the dome's fragment must be the same composition: the same table coordinates, the same deck, night floor, disc and mist blend, the same constants. Pinned in Task 3 (`skyTableUv` against hand values) and Task 4 (every `const float` in lockstep, `skyTableUv` and `skyDeck` textually the contract's).
3. **Finite everywhere.** No NaN, no Infinity, no negative radiance at any slice altitude, any direction, any weather. Pinned in Task 1 (every slice) and Task 3 (states across 0–24 h under every preset).
4. **Non-uniform control flow around the read.** The dome's one texture read is explicit-level and outside every branch; the capture and tone-map choices are `mix`/`step` on uniforms. Pinned in Task 4 (the WGSL holds `textureSampleLevel` and no `textureSample(`).
5. **No PBR shader change, no binding added.** Pinned in Task 6 (`atmosphereFog.fragment.fx` byte-pinned) and by `stageBindings.test.ts` and `foliageLightPlugin.test.ts` passing unchanged in Task 5.
6. **The anchors.** Clear noon and midnight reproduce today's values exactly where the constraints say. Pinned in Task 3 and Task 5.
7. **Nothing shown before the sky.** The render loop and the reveal wait for the table's noon bracket and the current hour's; a tier swap keeps the table; every worker is terminated. Pinned in Tasks 5 and 8.
8. **The removal order.** Each removed function goes in the task that moves its last caller, and every commit typechecks. Checked at each task's gate.

## Files

| File | Change | Responsibility |
| --- | --- | --- |
| `client/src/game/skyModel.ts` | create | The air, the transmittance and multiple-scattering tables, a direction's radiance, the sun's transmittance, the slices and their derived values |
| `client/src/game/skyTable.ts` | create | Holding slices, blending between them, the order they are made in, an in-thread builder |
| `client/src/game/sky.worker.ts`, `client/src/game/skyWorker.ts` | create | The module worker that makes the slices at load, and its in-thread fallback |
| `client/src/game/skyState.ts` | create | Every value the scene reads from the sky, and the dome's TypeScript transcription |
| `client/src/game/halfFloat.ts` | create | binary16 encoding for the dome's table texture |
| `client/src/game/skyDome.ts`, `client/src/game/shaders/skyDome.vertex.fx`, `client/src/game/shaders/skyDome.fragment.fx` | create | The dome: its mesh, material, table texture and uniforms |
| `client/src/game/weather.ts` | modify | `airColourUnder` over a base colour; the sky's old functions removed |
| `client/src/game/sky.ts` | modify | Keeps the sun's arc, `twilightT`, exposure and the fill and night constants; the hand-tuned colours removed |
| `client/src/game/lighting.ts` | modify | The dome, the half-float linear probe, the sun, the fill, fog and clear colour from the state |
| `client/src/game/atmosphereParams.ts`, `client/src/game/atmosphere.ts` | modify | The haze's gradient and glow from the state |
| `client/src/game/gradeParams.ts`, `client/src/game/post.ts` | modify | The white point and Purkinje by the night factor |
| `client/src/game/renderer.ts`, `client/src/app.ts`, `client/src/scene/sceneRoute.ts`, `client/src/game/probeScene.ts` | modify | One table for the app's life; nothing revealed before the sky |
| `client/package.json`, `package-lock.json` | modify | `@babylonjs/materials` removed |
| `ARCHITECTURE.md` | modify | The sky in the rendering section |

---

### Task 1: The scattering model of the clear sky

**Files:**
- Create: `client/src/game/skyModel.ts`
- Test: `client/test/game/skyModel.test.ts` (create)
- Modify: `client/test/architecture.test.ts` (one line in `BABYLON_FREE_FILES`)

**Interfaces:**
- Consumes: `Rgb`, `luma` from `client/src/game/colour.ts`; `Vec3` from `client/src/game/sky.ts` (and, in the test only, `sunPositionAt`). Nothing from any other task.
- Produces: everything in contract §2, with exactly these names and layouts, plus:
  - `export function skyIrradianceOf(texels: Float32Array): Rgb;` — the level-ground integral `buildSlice` stores as `skyIrradiance` (rows above the horizon, trapezoids in elevation with the horizon as a zero node, trapezoids in azimuth over 0..π, doubled for the mirrored half). A uniform sky of radiance 1 gives π × (1 − 0.0017).
  - `SKY_MIE_SCALE = 5` once Step 5 has run. **The calibration rule differs from contract §2/§7**: it is the *smallest* scale on a 0.05 grid *from 1 up* (to 10) that keeps the clear noon horizon at most twice the zenith. No scale in (0, 1] meets the property: fewer aerosols make the noon horizon *brighter* against the zenith (4.39 at 1, 5.62 at 0.05), because the zenith, 14° from the noon sun, takes much of its light from the aerosols' forward scattering.
  - `SkySlice.zenith` is the top row's first texel (`texels[(63 * 32) * 3 + c]`), exactly what the dome draws straight up.
  - `sunTransmittance` is exactly `{ r: 0, g: 0, b: 0 }` once the ray toward the sun meets the ground (below −0.45° from the 200 m eye), so every slice from −0.5° down has `sun` exactly 0.
  - `skyRadiance` normalises `dir` itself and returns `{ r: 0, g: 0, b: 0 }` for a zero or non-finite direction.
  - A view ray is marched over at most 400 km (private `VIEW_MAX_KM`); the midpoint step integral uses `Math.expm1`.

**Notes for the implementer** (measured on the M4, Node 22, `npx tsx`, from scratch copies of exactly the code below):
- `buildSkyTables()`: 91 ms on the first call (77 ms warm). `buildSlice`: 12 ms on the first call, 3.1 ms after; all 93 slices 290 ms; the whole set about 0.38 s. `skyModel.test.ts` runs in about 0.25 s, its `beforeAll` (tables plus three slices) about 0.1 s.
- The values at `SKY_MIE_SCALE = 1` reproduce the spec's §3.2 table (noon zenith 0.25 0.47 1.00; 0° zenith 0.069 of noon; −6° 4.2 × 10⁻⁴; sun at 10° 1.00 0.65 0.32). At 5: noon zenith 0.45 0.60 1.00 (paler), 0° zenith 4.2 % of noon, −18° zenith 2.0 × 10⁻⁹ of noon, noon sun 0.91 0.84 0.74. The aerosols' optical depth at 5 is about 0.05, a clear day.
- Below the horizon a slice holds only the air's own in-scattered light; no ground is drawn into it. At clear noon the radiance at −10° is 0.10 of the zenith's, at −45° 0.03, at the nadir 0.02.
- The eye's height is not a small effect: from 1 km against 0 km the noon zenith is 0.67 as bright, the sunset horizon away from the sun 1.79 as bright, the horizon toward the sun at −6° 2.16 (the largest of the directions tested), and the sun itself at 0° 13.6 times as bright. The test's bound is the aerosols' column factor, e^(1/1.2) = 2.30, as its doc comment explains, with the sun held to it only from 10° up.

- [ ] **Step 1: Write the failing test**

Create `client/test/game/skyModel.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { luma, type Rgb } from "../../src/game/colour.js";
import { sunPositionAt, type Vec3 } from "../../src/game/sky.js";
import {
  MULTI_SIZE,
  RING_ELEVATION_DEG,
  SKY_GROUND_KM,
  SKY_MIE_SCALE,
  SKY_TOP_KM,
  SLICE_ALTITUDES_DEG,
  SLICE_AZIMUTHS,
  SLICE_ELEVATIONS,
  TRANSMITTANCE_HEIGHT,
  TRANSMITTANCE_WIDTH,
  azimuthOfColumn,
  buildSkyTables,
  buildSlice,
  elevationOfRow,
  multiAt,
  rowOfElevation,
  skyIrradianceOf,
  skyRadiance,
  sunTransmittance,
  transmittanceAt,
  type SkySlice,
  type SkyTables,
} from "../../src/game/skyModel.js";
import { timeLimit } from "../helpers/timeLimit.js";

const DEG = Math.PI / 180;
/** The noon sun's altitude on the game's arc, degrees (75.96...). */
const NOON_DEG = Math.asin(sunPositionAt(12).y) / DEG;
const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** The unit direction at elevation e and azimuth az from the sun's, both in degrees. */
function dir(e: number, az: number): Vec3 {
  return { x: Math.cos(e * DEG) * Math.cos(az * DEG), y: Math.sin(e * DEG), z: Math.cos(e * DEG) * Math.sin(az * DEG) };
}

/** The mean of a ring's columns from..to, inclusive. */
function ringMean(ring: Float32Array, from: number, to: number): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  const n = to - from + 1;
  for (let i = from; i <= to; i++) {
    out.r += (ring[i * 3] as number) / n;
    out.g += (ring[i * 3 + 1] as number) / n;
    out.b += (ring[i * 3 + 2] as number) / n;
  }
  return out;
}

/** The clear noon horizon away from the sun (columns 16..31, azimuth 93 to 180 degrees) over the zenith, in luminance. */
function horizonOverZenith(slice: SkySlice): number {
  return luma(ringMean(slice.ring, 16, 31)) / luma(slice.zenith);
}

/** Every value that is not a finite, non-negative number, as "what[k] = v". */
function badValues(values: ArrayLike<number>, what: string): string[] {
  const bad: string[] = [];
  for (let k = 0; k < values.length; k++) {
    const v = values[k] as number;
    if (!Number.isFinite(v) || v < 0) bad.push(`${what}[${k}] = ${v}`);
  }
  return bad;
}

const rgbValues = (c: Rgb): number[] => [c.r, c.g, c.b];

let tables: SkyTables;
let noon: SkySlice;
let sunset: SkySlice;
let deep: SkySlice;

beforeAll(() => {
  tables = buildSkyTables();
  noon = buildSlice(tables, NOON_DEG);
  sunset = buildSlice(tables, 0);
  deep = buildSlice(tables, -18);
}, timeLimit(20_000));

describe("the slice altitudes and the table's coordinates", () => {
  it("are 93 altitudes from -18 to 76, every half degree to 12, then every 2", () => {
    expect(SLICE_ALTITUDES_DEG.length).toBe(93);
    expect(SLICE_ALTITUDES_DEG[0]).toBe(-18);
    expect(SLICE_ALTITUDES_DEG[60]).toBe(12);
    expect(SLICE_ALTITUDES_DEG[61]).toBe(14);
    expect(SLICE_ALTITUDES_DEG[92]).toBe(76);
    for (let k = 1; k < SLICE_ALTITUDES_DEG.length; k++) {
      const below = SLICE_ALTITUDES_DEG[k - 1] as number;
      expect((SLICE_ALTITUDES_DEG[k] as number) - below).toBe(below < 12 ? 0.5 : 2);
    }
  });

  it("puts half the rows within 22.5 degrees of the horizon, and maps rows and elevations both ways", () => {
    expect(elevationOfRow(0)).toBe(-Math.PI / 2);
    expect(elevationOfRow(0.5)).toBe(0);
    expect(elevationOfRow(1)).toBe(Math.PI / 2);
    expect(elevationOfRow(0.25)).toBeCloseTo(-Math.PI / 8, 12);
    expect(elevationOfRow(0.75)).toBeCloseTo(Math.PI / 8, 12);
    for (let j = 0; j < SLICE_ELEVATIONS; j++) {
      const v = j / (SLICE_ELEVATIONS - 1);
      expect(rowOfElevation(elevationOfRow(v))).toBeCloseTo(v, 12);
    }
    for (let e = -90; e <= 90; e += 2.5) expect(elevationOfRow(rowOfElevation(e * DEG))).toBeCloseTo(e * DEG, 12);
  });

  it("maps columns to azimuths from the sun's, 0 to 180 degrees", () => {
    expect(azimuthOfColumn(0)).toBe(0);
    expect(azimuthOfColumn(0.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(azimuthOfColumn(1)).toBeCloseTo(Math.PI, 12);
  });
});

describe("the transmittance", () => {
  it("lies in [0, 1] and rises with the cosine at every height of the table", () => {
    expect(tables.transmittance.length).toBe(TRANSMITTANCE_WIDTH * TRANSMITTANCE_HEIGHT * 3);
    const bad: string[] = [];
    for (let j = 0; j < TRANSMITTANCE_HEIGHT; j++) {
      for (let i = 0; i < TRANSMITTANCE_WIDTH; i++) {
        for (let c = 0; c < 3; c++) {
          const v = tables.transmittance[(j * TRANSMITTANCE_WIDTH + i) * 3 + c] as number;
          const before = i > 0 ? (tables.transmittance[(j * TRANSMITTANCE_WIDTH + i - 1) * 3 + c] as number) : 0;
          if (!(v >= 0 && v <= 1 && v >= before)) bad.push(`row ${j}, column ${i}, channel ${c}: ${before} then ${v}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("rises with the cosine between the table's texels, from the eye's height", () => {
    let previous = transmittanceAt(tables, SKY_GROUND_KM + 0.2, -1);
    for (let k = 1; k <= 400; k++) {
      const next = transmittanceAt(tables, SKY_GROUND_KM + 0.2, -1 + k / 200);
      for (const c of ["r", "g", "b"] as const) {
        expect(next[c]).toBeGreaterThanOrEqual(previous[c]);
        expect(next[c]).toBeLessThanOrEqual(1);
      }
      previous = next;
    }
  });

  it("is 1 looking up from the top of the air and 0 looking into the ground", () => {
    for (const v of rgbValues(transmittanceAt(tables, SKY_TOP_KM, 1))) expect(v).toBeCloseTo(1, 6);
    expect(transmittanceAt(tables, SKY_GROUND_KM, -0.5)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("reddens the sun toward the horizon, and is 0 once the sun is below the eye's horizon", () => {
    const altitudes = [76, 45, 20, 10, 5, 2, 0];
    const suns = altitudes.map((a) => sunTransmittance(tables, a * DEG));
    expect(suns[0]?.r).toBeGreaterThan(0.85);
    for (let k = 1; k < suns.length; k++) {
      const higher = suns[k - 1] as Rgb;
      const lower = suns[k] as Rgb;
      expect(lower.g / lower.r).toBeLessThan(higher.g / higher.r);
      expect(lower.b / lower.r).toBeLessThan(higher.b / higher.r);
      expect(luma(lower)).toBeLessThan(luma(higher));
    }
    // From 200 m the horizon dips 0.45 degrees: a sun 0.25 degrees down still shines, one 0.5 down is gone.
    expect(sunTransmittance(tables, -0.25 * DEG).r).toBeGreaterThan(0);
    expect(sunTransmittance(tables, -0.5 * DEG)).toEqual({ r: 0, g: 0, b: 0 });
    expect(sunTransmittance(tables, -30 * DEG)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("the multiple scattering", () => {
  it("is finite and non-negative, and brighter under a high sun than in the earth's shadow", () => {
    expect(tables.multi.length).toBe(MULTI_SIZE * MULTI_SIZE * 3);
    expect(badValues(tables.multi, "multi")).toEqual([]);
    const day = multiAt(tables, SKY_GROUND_KM + 0.2, 1);
    const shadow = multiAt(tables, SKY_GROUND_KM + 0.2, -0.5);
    expect(luma(day)).toBeGreaterThan(luma(shadow));
    expect(luma(day)).toBeGreaterThan(0);
  });
});

describe("the sky's light", () => {
  it("lays a slice out as the dome reads it", () => {
    expect(noon.altitudeDeg).toBe(NOON_DEG);
    expect(noon.texels.length).toBe(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3);
    expect(noon.ring.length).toBe(SLICE_AZIMUTHS * 3);
    for (const [j, i] of [[0, 0], [20, 7], [33, 0], [40, 31], [63, 16]] as const) {
      const e = elevationOfRow(j / (SLICE_ELEVATIONS - 1));
      const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
      const expected = skyRadiance(tables, { x: Math.cos(e) * Math.cos(az), y: Math.sin(e), z: Math.cos(e) * Math.sin(az) }, NOON_DEG * DEG);
      const k = (j * SLICE_AZIMUTHS + i) * 3;
      expect(noon.texels[k]).toBeCloseTo(expected.r, 7);
      expect(noon.texels[k + 1]).toBeCloseTo(expected.g, 7);
      expect(noon.texels[k + 2]).toBeCloseTo(expected.b, 7);
    }
    const ring9 = skyRadiance(tables, dir(RING_ELEVATION_DEG, (180 * 9) / 31), NOON_DEG * DEG);
    expect(noon.ring[27]).toBeCloseTo(ring9.r, 7);
    expect(noon.ring[28]).toBeCloseTo(ring9.g, 7);
    expect(noon.ring[29]).toBeCloseTo(ring9.b, 7);
    const top = (SLICE_ELEVATIONS - 1) * SLICE_AZIMUTHS * 3;
    expect(noon.zenith).toEqual({ r: noon.texels[top], g: noon.texels[top + 1], b: noon.texels[top + 2] });
    expect(noon.skyIrradiance).toEqual(skyIrradianceOf(noon.texels));
    expect(noon.sun).toEqual(sunTransmittance(tables, NOON_DEG * DEG));
  });

  it("is blue at the zenith at noon", () => {
    expect(noon.zenith.b).toBeGreaterThan(noon.zenith.g);
    expect(noon.zenith.g).toBeGreaterThan(noon.zenith.r);
  });

  it("keeps the clear noon horizon at most twice the zenith, at the smallest aerosol scale that does", () => {
    expect(horizonOverZenith(noon)).toBeLessThanOrEqual(2);
    // On the 0.05 grid, from the standard atmosphere's 1 up: one step less and the horizon is over twice the zenith.
    expect(Math.abs(SKY_MIE_SCALE * 20 - Math.round(SKY_MIE_SCALE * 20))).toBeLessThan(1e-9);
    expect(SKY_MIE_SCALE).toBeGreaterThanOrEqual(1);
    const less = buildSlice(buildSkyTables(SKY_MIE_SCALE - 0.05), NOON_DEG);
    expect(horizonOverZenith(less)).toBeGreaterThan(2);
  });

  it("keeps a blue zenith at sunset, between 3 % and 15 % of noon's light", () => {
    expect(sunset.zenith.b).toBeGreaterThan(sunset.zenith.r);
    expect(sunset.zenith.b).toBeGreaterThan(sunset.zenith.g);
    const share = luma(sunset.zenith) / luma(noon.zenith);
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.15);
  });

  it("is red toward the sun at the horizon at sunset", () => {
    const toward = ringMean(sunset.ring, 0, 0);
    expect(toward.r).toBeGreaterThan(toward.g);
    expect(toward.r).toBeGreaterThan(toward.b);
  });

  it("dims at the zenith with every half degree the sun sinks, to below a millionth of noon at -18 degrees", () => {
    let previous = luma(skyRadiance(tables, UP, 0));
    for (let k = 1; k <= 36; k++) {
      const next = luma(skyRadiance(tables, UP, (-k / 2) * DEG));
      expect(next).toBeLessThan(previous);
      previous = next;
    }
    expect(previous / luma(noon.zenith)).toBeLessThan(1e-6);
    expect(luma(deep.zenith) / luma(noon.zenith)).toBeLessThan(1e-6);
  });

  it("is finite and non-negative everywhere: whole slices at noon, sunset and -18 degrees, and every slice altitude sampled", () => {
    const bad: string[] = [];
    for (const slice of [noon, sunset, deep]) {
      bad.push(...badValues(slice.texels, `texels at ${slice.altitudeDeg}`));
      bad.push(...badValues(slice.ring, `ring at ${slice.altitudeDeg}`));
      bad.push(...badValues([...rgbValues(slice.zenith), ...rgbValues(slice.skyIrradiance), ...rgbValues(slice.sun)], `derived at ${slice.altitudeDeg}`));
    }
    for (const altitude of SLICE_ALTITUDES_DEG) {
      const sampled: number[] = rgbValues(sunTransmittance(tables, altitude * DEG));
      for (let j = 0; j < SLICE_ELEVATIONS; j += 7) {
        for (let i = 0; i < SLICE_AZIMUTHS; i += 5) {
          const e = elevationOfRow(j / (SLICE_ELEVATIONS - 1));
          const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
          sampled.push(...rgbValues(skyRadiance(tables, { x: Math.cos(e) * Math.cos(az), y: Math.sin(e), z: Math.cos(e) * Math.sin(az) }, altitude * DEG)));
        }
      }
      bad.push(...badValues(sampled, `samples at ${altitude}`));
    }
    expect(bad).toEqual([]);
  });

  it("gives no light along no direction, and reads a direction's length out", () => {
    expect(skyRadiance(tables, { x: 0, y: 0, z: 0 }, NOON_DEG * DEG)).toEqual({ r: 0, g: 0, b: 0 });
    const long = skyRadiance(tables, { x: 0, y: 3, z: 0 }, NOON_DEG * DEG);
    const unit = skyRadiance(tables, UP, NOON_DEG * DEG);
    expect(long.r).toBeCloseTo(unit.r, 12);
    expect(long.b).toBeCloseTo(unit.b, 12);
  });

  /**
   * The eye is fixed at 200 m, while the world's relief reaches several
   * hundred metres. Raising the eye 1 km leaves e^(-1/8) = 0.88 of the air's
   * Rayleigh column above it and e^(-1/1.2) = 0.43 of its aerosols: the
   * lowest kilometre holds most of the haze, so no direction's light can move
   * by more than that column's factor, e^(1/1.2) = 2.30. The sun's own light
   * near the horizon is the exception (its path through the haze changes many
   * times over), so it is held to the bound only from 10 degrees up.
   */
  it("changes by less than the aerosols' column factor between eye heights of 0 and 1 km", () => {
    for (const altitude of [NOON_DEG, 30, 10, 2, 0, -3, -6, -12]) {
      for (const d of [UP, dir(RING_ELEVATION_DEG, 0), dir(RING_ELEVATION_DEG, 90), dir(RING_ELEVATION_DEG, 180)]) {
        const ratio = luma(skyRadiance(tables, d, altitude * DEG, 1)) / luma(skyRadiance(tables, d, altitude * DEG, 0));
        expect(ratio).toBeGreaterThan(1 / 2.3);
        expect(ratio).toBeLessThan(2.3);
      }
    }
    for (const altitude of [NOON_DEG, 30, 10]) {
      const ratio = luma(sunTransmittance(tables, altitude * DEG, 1)) / luma(sunTransmittance(tables, altitude * DEG, 0));
      expect(ratio).toBeGreaterThan(1 / 2.3);
      expect(ratio).toBeLessThan(2.3);
    }
  });
});

describe("the sky's light on level ground", () => {
  const field = (f: (e: number, az: number) => number): Float32Array => {
    const texels = new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3);
    for (let j = 0; j < SLICE_ELEVATIONS; j++) {
      for (let i = 0; i < SLICE_AZIMUTHS; i++) {
        const v = f(elevationOfRow(j / (SLICE_ELEVATIONS - 1)), azimuthOfColumn(i / (SLICE_AZIMUTHS - 1)));
        texels.fill(v, (j * SLICE_AZIMUTHS + i) * 3, (j * SLICE_AZIMUTHS + i) * 3 + 3);
      }
    }
    return texels;
  };

  it("integrates a uniform sky to PI and a sky of radiance sin(e) to 2 PI / 3, within half a percent", () => {
    expect(Math.abs(skyIrradianceOf(field(() => 1)).g / Math.PI - 1)).toBeLessThan(0.005);
    expect(Math.abs(skyIrradianceOf(field((e) => Math.max(0, Math.sin(e)))).g / ((2 * Math.PI) / 3) - 1)).toBeLessThan(0.005);
  });

  it("counts both mirrored halves of the azimuth and nothing below the horizon", () => {
    // 1 + cos(azimuth) over the full circle averages 1: the same light as a uniform sky.
    const uniform = skyIrradianceOf(field(() => 1)).g;
    expect(skyIrradianceOf(field((_, az) => 1 + Math.cos(az))).g).toBeCloseTo(uniform, 6);
    expect(skyIrradianceOf(field((e) => (e < 0 ? 1 : 0)))).toEqual({ r: 0, g: 0, b: 0 });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/skyModel.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/game/skyModel.js' imported from …/client/test/game/skyModel.test.ts`, "no tests".

- [ ] **Step 3: Write the model**

Create `client/src/game/skyModel.ts`. `SKY_MIE_SCALE` starts at 1, the standard atmosphere's aerosols; Step 5 calibrates it.

```ts
/**
 * The clear sky's light, computed from how sunlight scatters in air: Rayleigh
 * scattering by the air itself, scattering and absorption by aerosols (Mie),
 * and absorption by ozone, over a spherical planet. The model is Hillaire's
 * (2020, "A Scalable and Production Ready Sky and Atmosphere Rendering
 * Technique"), with his standard Earth atmosphere.
 *
 * Pure and Babylon-free, so every number here is tested under Node, and the
 * same code runs in the sky's worker (`sky.worker.ts`) and, where there is no
 * worker, on the main thread. Two tables depend only on the air and are built
 * once: the transmittance (how much light survives a straight path to the top
 * of the air) and the multiple scattering (Hillaire's isotropic estimate of
 * the light scattered more than once). A slice is the whole sky for one sun
 * altitude, laid out as the dome reads it.
 *
 * Units: kilometres, coefficients per kilometre, and radiance per unit of
 * solar irradiance arriving at the top of the air (1 in each channel). The
 * scene's own scale is applied by the sky's state, not here.
 *
 * Every division is guarded: a value that comes back NaN would poison a
 * whole blended slice, and below the horizon several quantities are exactly 0.
 */
import type { Rgb } from "./colour.js";
import type { Vec3 } from "./sky.js";

/** Planet and air, kilometres; coefficients per kilometre. */
export const SKY_GROUND_KM = 6360;
export const SKY_TOP_KM = 6460;
export const SKY_RAYLEIGH: Rgb = { r: 5.802e-3, g: 13.558e-3, b: 33.1e-3 };
export const SKY_RAYLEIGH_HEIGHT_KM = 8;
export const SKY_MIE_SCATTERING = 3.996e-3;
export const SKY_MIE_ABSORPTION = 4.4e-3;
export const SKY_MIE_HEIGHT_KM = 1.2;
export const SKY_MIE_G = 0.8;
/**
 * Multiplies both aerosol coefficients. Under the standard atmosphere's
 * aerosols the clear noon horizon is about 4.4 times as bright as the zenith,
 * and fewer aerosols make it brighter still: the zenith, 14 degrees from the
 * noon sun, takes much of its light from the aerosols' forward scattering.
 * This is the smallest scale on a 0.05 grid from 1 up at which the horizon's
 * luminance (the ring's mean away from the sun) is at most twice the
 * zenith's, which keeps noon's sky close to even, as the game's noon has
 * always looked.
 */
export const SKY_MIE_SCALE = 1;
export const SKY_OZONE: Rgb = { r: 0.65e-3, g: 1.881e-3, b: 0.085e-3 };
export const SKY_OZONE_PEAK_KM = 25;
export const SKY_OZONE_HALF_WIDTH_KM = 15;
export const SKY_GROUND_ALBEDO = 0.3;
/** The eye's height above the ground. The world's relief is a few hundred metres at most. */
export const SKY_EYE_KM = 0.2;

/** Columns of the transmittance table: mu from -1 to 1. */
export const TRANSMITTANCE_WIDTH = 256;
/** Rows of the transmittance table: height (j / (H - 1))^2 of the air's depth, dense near the ground. */
export const TRANSMITTANCE_HEIGHT = 64;
/** The multiple-scattering table is square: muSun across, height up, at texel centres. */
export const MULTI_SIZE = 32;
/** Directions the multiple scattering integrates over: an 8 x 8 stratified sphere. */
export const MULTI_DIRECTIONS = 64;
export const TRANSMITTANCE_STEPS = 40;
export const MULTI_STEPS = 20;
export const VIEW_STEPS = 24;
/** Rows of a slice, elevation from the nadir to the zenith. */
export const SLICE_ELEVATIONS = 64;
/** Columns of a slice, azimuth 0 to 180 degrees from the sun's. The sky is mirror-symmetric about the sun's vertical plane. */
export const SLICE_AZIMUTHS = 32;
/** The elevation of a slice's horizon ring, degrees: low enough to be the horizon, high enough to stay clear of the ground. */
export const RING_ELEVATION_DEG = 2;

/**
 * The sun altitudes a slice is made at, degrees, ascending: every 0.5 from -18
 * to 12, where the sky's colour changes fastest, then every 2 from 14 to 76,
 * the noon sun's height on the game's arc. 93 altitudes. Written from integer
 * steps, so each value is exact.
 */
export const SLICE_ALTITUDES_DEG: readonly number[] = Object.freeze([
  ...Array.from({ length: 61 }, (_, k) => -18 + k / 2),
  ...Array.from({ length: 32 }, (_, k) => 14 + 2 * k),
]);

export type SkyTables = { transmittance: Float32Array; multi: Float32Array; mieScale: number };
export type SkySlice = {
  altitudeDeg: number;
  /** SLICE_ELEVATIONS x SLICE_AZIMUTHS x 3, row-major (index = (row * SLICE_AZIMUTHS + col) * 3).
   *  Row j holds elevation elevationOfRow(j / (SLICE_ELEVATIONS - 1)); column i holds azimuth
   *  azimuthOfColumn(i / (SLICE_AZIMUTHS - 1)) from the sun's. Radiance per unit solar irradiance. */
  texels: Float32Array;
  /** SLICE_AZIMUTHS x 3: the radiance at RING_ELEVATION_DEG, column i as in texels. */
  ring: Float32Array;
  zenith: Rgb;
  /** Cosine-weighted sky light on level ground per unit solar irradiance, integrated from texels
   *  (rows with elevation > 0, both mirrored halves, trapezoid weights). */
  skyIrradiance: Rgb;
  /** The sun's transmittance at the eye: its colour and strength; 0 when the ray meets the ground. */
  sun: Rgb;
};

const AIR_DEPTH_KM = SKY_TOP_KM - SKY_GROUND_KM;

/**
 * The longest stretch of a view ray that is marched, km. A ray along the
 * horizon crosses about 1,100 km of air; capped here, its VIEW_STEPS stay
 * short where the air is dense. At 400 km a level ray is 12.6 km up, above
 * which about a fifth of the air's Rayleigh column and almost none of its
 * aerosols remain.
 */
const VIEW_MAX_KM = 400;

/** Isotropic phase: the multiple-scattering term scatters equally every way. */
const ISOTROPIC = 1 / (4 * Math.PI);
const RAYLEIGH_PHASE_K = 3 / (16 * Math.PI);
const MIE_PHASE_K = ((3 / (8 * Math.PI)) * (1 - SKY_MIE_G * SKY_MIE_G)) / (2 + SKY_MIE_G * SKY_MIE_G);

/** The air at one height: Rayleigh scattering per channel, Mie scattering, extinction per channel. */
type Medium = { rr: number; rg: number; rb: number; ms: number; er: number; eg: number; eb: number };

function newMedium(): Medium {
  return { rr: 0, rg: 0, rb: 0, ms: 0, er: 0, eg: 0, eb: 0 };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function mediumAt(h: number, mieScale: number, out: Medium): void {
  const rayleigh = Math.exp(-h / SKY_RAYLEIGH_HEIGHT_KM);
  const mie = Math.exp(-h / SKY_MIE_HEIGHT_KM);
  const ozone = Math.max(0, 1 - Math.abs(h - SKY_OZONE_PEAK_KM) / SKY_OZONE_HALF_WIDTH_KM);
  const mieAbsorption = SKY_MIE_ABSORPTION * mieScale * mie;
  out.rr = SKY_RAYLEIGH.r * rayleigh;
  out.rg = SKY_RAYLEIGH.g * rayleigh;
  out.rb = SKY_RAYLEIGH.b * rayleigh;
  out.ms = SKY_MIE_SCATTERING * mieScale * mie;
  out.er = out.rr + out.ms + mieAbsorption + SKY_OZONE.r * ozone;
  out.eg = out.rg + out.ms + mieAbsorption + SKY_OZONE.g * ozone;
  out.eb = out.rb + out.ms + mieAbsorption + SKY_OZONE.b * ozone;
}

/**
 * The integral over one step of a source s seen through the step's own
 * extinction: s * (1 - e^(-ext * dt)) / ext, the analytic form, with expm1 so
 * a nearly clear step keeps its precision, and s * dt where the air is empty.
 */
function stepIntegral(s: number, ext: number, dt: number): number {
  return ext > 0 ? (-s * Math.expm1(-ext * dt)) / ext : s * dt;
}

/** Distance from radius r along mu to the top of the air; 0 from above it looking up. */
function rayToTop(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + SKY_TOP_KM * SKY_TOP_KM;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, d)));
}

/** Distance from radius r along mu to the ground, or -1 when the ray misses it. */
function rayToGround(r: number, mu: number): number {
  if (mu >= 0) return -1;
  const d = r * r * (mu * mu - 1) + SKY_GROUND_KM * SKY_GROUND_KM;
  return d >= 0 ? Math.max(0, -r * mu - Math.sqrt(d)) : -1;
}

/** Bilinear read of a 3-channel table at whole texel (i0, j0) plus fractions (fx, fy). */
function bilinear(table: Float32Array, width: number, i0: number, j0: number, fx: number, fy: number, out: Rgb): void {
  const p00 = (j0 * width + i0) * 3;
  const p01 = p00 + 3;
  const p10 = p00 + width * 3;
  const p11 = p10 + 3;
  const w00 = (1 - fx) * (1 - fy);
  const w01 = fx * (1 - fy);
  const w10 = (1 - fx) * fy;
  const w11 = fx * fy;
  out.r = (table[p00] as number) * w00 + (table[p01] as number) * w01 + (table[p10] as number) * w10 + (table[p11] as number) * w11;
  out.g = (table[p00 + 1] as number) * w00 + (table[p01 + 1] as number) * w01 + (table[p10 + 1] as number) * w10 + (table[p11 + 1] as number) * w11;
  out.b = (table[p00 + 2] as number) * w00 + (table[p01 + 2] as number) * w01 + (table[p10 + 2] as number) * w10 + (table[p11 + 2] as number) * w11;
}

function sampleTransmittance(table: Float32Array, radiusKm: number, mu: number, out: Rgb): void {
  const h = clamp(radiusKm - SKY_GROUND_KM, 0, AIR_DEPTH_KM);
  const fj = Math.sqrt(h / AIR_DEPTH_KM) * (TRANSMITTANCE_HEIGHT - 1);
  const fi = ((clamp(mu, -1, 1) + 1) / 2) * (TRANSMITTANCE_WIDTH - 1);
  const j0 = Math.min(TRANSMITTANCE_HEIGHT - 2, Math.floor(fj));
  const i0 = Math.min(TRANSMITTANCE_WIDTH - 2, Math.floor(fi));
  bilinear(table, TRANSMITTANCE_WIDTH, i0, j0, fi - i0, fj - j0, out);
}

function sampleMulti(table: Float32Array, radiusKm: number, muSun: number, out: Rgb): void {
  const fj = clamp(((radiusKm - SKY_GROUND_KM) / AIR_DEPTH_KM) * MULTI_SIZE - 0.5, 0, MULTI_SIZE - 1);
  const fi = clamp(((clamp(muSun, -1, 1) + 1) / 2) * MULTI_SIZE - 0.5, 0, MULTI_SIZE - 1);
  const j0 = Math.min(MULTI_SIZE - 2, Math.floor(fj));
  const i0 = Math.min(MULTI_SIZE - 2, Math.floor(fi));
  bilinear(table, MULTI_SIZE, i0, j0, fi - i0, fj - j0, out);
}

function buildTransmittance(mieScale: number): Float32Array {
  const table = new Float32Array(TRANSMITTANCE_WIDTH * TRANSMITTANCE_HEIGHT * 3);
  const med = newMedium();
  for (let j = 0; j < TRANSMITTANCE_HEIGHT; j++) {
    const r = SKY_GROUND_KM + (j / (TRANSMITTANCE_HEIGHT - 1)) ** 2 * AIR_DEPTH_KM;
    for (let i = 0; i < TRANSMITTANCE_WIDTH; i++) {
      const mu = -1 + (2 * i) / (TRANSMITTANCE_WIDTH - 1);
      const k = (j * TRANSMITTANCE_WIDTH + i) * 3;
      // A ray that meets the ground carries no sunlight: the table holds 0 there.
      if (rayToGround(r, mu) >= 0) continue;
      const dt = rayToTop(r, mu) / TRANSMITTANCE_STEPS;
      let odR = 0;
      let odG = 0;
      let odB = 0;
      for (let s = 0; s < TRANSMITTANCE_STEPS; s++) {
        const t = (s + 0.5) * dt;
        const ri = Math.sqrt(Math.max(0, r * r + t * t + 2 * r * t * mu));
        mediumAt(ri - SKY_GROUND_KM, mieScale, med);
        odR += med.er * dt;
        odG += med.eg * dt;
        odB += med.eb * dt;
      }
      table[k] = Math.exp(-odR);
      table[k + 1] = Math.exp(-odG);
      table[k + 2] = Math.exp(-odB);
    }
  }
  return table;
}

/** The 8 x 8 stratified sphere of directions, x y z, equal-area in the cosine of the polar angle. */
const SPHERE: Float64Array = (() => {
  const out = new Float64Array(MULTI_DIRECTIONS * 3);
  let k = 0;
  for (let a = 0; a < 8; a++) {
    for (let b = 0; b < 8; b++) {
      const theta = Math.acos(1 - (2 * (a + 0.5)) / 8);
      const phi = (2 * Math.PI * (b + 0.5)) / 8;
      out[k++] = Math.sin(theta) * Math.cos(phi);
      out[k++] = Math.cos(theta);
      out[k++] = Math.sin(theta) * Math.sin(phi);
    }
  }
  return out;
})();

/**
 * Hillaire's multiple scattering, Psi = L2 / (1 - F): L2 the light scattered
 * twice toward a point (the sun's single scattering along every direction,
 * plus the ground's albedo bounce), F the fraction of light the air around it
 * scatters back, summed as a geometric series of further orders.
 */
function buildMulti(transmittance: Float32Array, mieScale: number): Float32Array {
  const table = new Float32Array(MULTI_SIZE * MULTI_SIZE * 3);
  const med = newMedium();
  const ts: Rgb = { r: 0, g: 0, b: 0 };
  for (let j = 0; j < MULTI_SIZE; j++) {
    const r = SKY_GROUND_KM + ((j + 0.5) / MULTI_SIZE) * AIR_DEPTH_KM;
    for (let i = 0; i < MULTI_SIZE; i++) {
      const muS = -1 + (2 * (i + 0.5)) / MULTI_SIZE;
      const sx = Math.sqrt(Math.max(0, 1 - muS * muS));
      const sy = muS;
      let l2R = 0;
      let l2G = 0;
      let l2B = 0;
      let fR = 0;
      let fG = 0;
      let fB = 0;
      for (let d = 0; d < MULTI_DIRECTIONS; d++) {
        const dx = SPHERE[d * 3] as number;
        const dy = SPHERE[d * 3 + 1] as number;
        const dz = SPHERE[d * 3 + 2] as number;
        const ground = rayToGround(r, dy);
        const dt = (ground >= 0 ? ground : rayToTop(r, dy)) / MULTI_STEPS;
        let tR = 1;
        let tG = 1;
        let tB = 1;
        for (let s = 0; s < MULTI_STEPS; s++) {
          const t = (s + 0.5) * dt;
          const px = dx * t;
          const py = r + dy * t;
          const pz = dz * t;
          const ri = Math.sqrt(px * px + py * py + pz * pz);
          const muSi = ri > 0 ? (px * sx + py * sy) / ri : 0;
          sampleTransmittance(transmittance, ri, muSi, ts);
          mediumAt(ri - SKY_GROUND_KM, mieScale, med);
          const scR = med.rr + med.ms;
          const scG = med.rg + med.ms;
          const scB = med.rb + med.ms;
          l2R += tR * stepIntegral(ts.r * scR * ISOTROPIC, med.er, dt);
          l2G += tG * stepIntegral(ts.g * scG * ISOTROPIC, med.eg, dt);
          l2B += tB * stepIntegral(ts.b * scB * ISOTROPIC, med.eb, dt);
          fR += tR * stepIntegral(scR, med.er, dt);
          fG += tG * stepIntegral(scG, med.eg, dt);
          fB += tB * stepIntegral(scB, med.eb, dt);
          tR *= Math.exp(-med.er * dt);
          tG *= Math.exp(-med.eg * dt);
          tB *= Math.exp(-med.eb * dt);
        }
        if (ground >= 0) {
          const px = dx * ground;
          const py = r + dy * ground;
          const pz = dz * ground;
          const ri = Math.sqrt(px * px + py * py + pz * pz);
          const muG = ri > 0 ? (px * sx + py * sy) / ri : 0;
          sampleTransmittance(transmittance, ri, muG, ts);
          const lit = (Math.max(0, muG) * SKY_GROUND_ALBEDO) / Math.PI;
          l2R += tR * ts.r * lit;
          l2G += tG * ts.g * lit;
          l2B += tB * ts.b * lit;
        }
      }
      const k = (j * MULTI_SIZE + i) * 3;
      table[k] = l2R / MULTI_DIRECTIONS / Math.max(1e-6, 1 - fR / MULTI_DIRECTIONS);
      table[k + 1] = l2G / MULTI_DIRECTIONS / Math.max(1e-6, 1 - fG / MULTI_DIRECTIONS);
      table[k + 2] = l2B / MULTI_DIRECTIONS / Math.max(1e-6, 1 - fB / MULTI_DIRECTIONS);
    }
  }
  return table;
}

/** The two tables that depend only on the air. `mieScale` multiplies both aerosol coefficients. */
export function buildSkyTables(mieScale: number = SKY_MIE_SCALE): SkyTables {
  if (!Number.isFinite(mieScale) || mieScale < 0) throw new RangeError(`the aerosol scale must be finite and non-negative; got ${mieScale}`);
  const transmittance = buildTransmittance(mieScale);
  return { transmittance, multi: buildMulti(transmittance, mieScale), mieScale };
}

/** The transmittance from radius radiusKm along mu to the top of the air, read bilinearly from the table. */
export function transmittanceAt(t: SkyTables, radiusKm: number, mu: number): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  sampleTransmittance(t.transmittance, radiusKm, mu, out);
  return out;
}

/** The multiple scattering at radius radiusKm under a sun at cosine muSun, bilinear between texel centres. */
export function multiAt(t: SkyTables, radiusKm: number, muSun: number): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  sampleMulti(t.multi, radiusKm, muSun, out);
  return out;
}

/** Scratch for the view march, reused across calls: a slice makes 2,080 of them. */
const scratchMedium = newMedium();
const scratchSun: Rgb = { r: 0, g: 0, b: 0 };
const scratchMulti: Rgb = { r: 0, g: 0, b: 0 };

/** One view ray's in-scattered light, into `out`. The sun is (sx, sy, 0), unit. */
function radianceInto(t: SkyTables, x: number, y: number, z: number, sx: number, sy: number, eyeKm: number, out: Rgb): void {
  out.r = 0;
  out.g = 0;
  out.b = 0;
  const length = Math.sqrt(x * x + y * y + z * z);
  // No direction to look along: no light, rather than the NaN of normalising zero.
  if (!(length > 0) || !Number.isFinite(length)) return;
  const dx = x / length;
  const dy = y / length;
  const dz = z / length;
  const r = SKY_GROUND_KM + clamp(eyeKm, 0, AIR_DEPTH_KM);
  const cosTheta = clamp(dx * sx + dy * sy, -1, 1);
  const rayleighPhase = RAYLEIGH_PHASE_K * (1 + cosTheta * cosTheta);
  // Cornette-Shanks. Its denominator is at least (1 - g)^2, never 0.
  const mieDenominator = 1 + SKY_MIE_G * SKY_MIE_G - 2 * SKY_MIE_G * cosTheta;
  const miePhase = (MIE_PHASE_K * (1 + cosTheta * cosTheta)) / (mieDenominator * Math.sqrt(mieDenominator));
  const ground = rayToGround(r, dy);
  const dt = Math.min(ground >= 0 ? ground : rayToTop(r, dy), VIEW_MAX_KM) / VIEW_STEPS;
  const med = scratchMedium;
  const ts = scratchSun;
  const ms = scratchMulti;
  let tR = 1;
  let tG = 1;
  let tB = 1;
  for (let s = 0; s < VIEW_STEPS; s++) {
    const t0 = (s + 0.5) * dt;
    const px = dx * t0;
    const py = r + dy * t0;
    const pz = dz * t0;
    const ri = Math.sqrt(px * px + py * py + pz * pz);
    const muS = ri > 0 ? (px * sx + py * sy) / ri : 0;
    sampleTransmittance(t.transmittance, ri, muS, ts);
    sampleMulti(t.multi, ri, muS, ms);
    mediumAt(ri - SKY_GROUND_KM, t.mieScale, med);
    const mieIn = med.ms * miePhase;
    out.r += tR * stepIntegral(ts.r * (med.rr * rayleighPhase + mieIn) + ms.r * (med.rr + med.ms), med.er, dt);
    out.g += tG * stepIntegral(ts.g * (med.rg * rayleighPhase + mieIn) + ms.g * (med.rg + med.ms), med.eg, dt);
    out.b += tB * stepIntegral(ts.b * (med.rb * rayleighPhase + mieIn) + ms.b * (med.rb + med.ms), med.eb, dt);
    tR *= Math.exp(-med.er * dt);
    tG *= Math.exp(-med.eg * dt);
    tB *= Math.exp(-med.eb * dt);
  }
}

/** dir: unit, y up; the sun lies in the x-y plane at +x, sunAltitude radians. Never NaN, never < 0. */
export function skyRadiance(t: SkyTables, dir: Vec3, sunAltitude: number, eyeKm: number = SKY_EYE_KM): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  radianceInto(t, dir.x, dir.y, dir.z, Math.cos(sunAltitude), Math.sin(sunAltitude), eyeKm, out);
  return out;
}

/** The sun's light at the eye, per unit irradiance above the air: exactly 0 once the ray toward it meets the ground. */
export function sunTransmittance(t: SkyTables, sunAltitude: number, eyeKm: number = SKY_EYE_KM): Rgb {
  const r = SKY_GROUND_KM + clamp(eyeKm, 0, AIR_DEPTH_KM);
  const mu = Math.sin(sunAltitude);
  if (rayToGround(r, mu) >= 0) return { r: 0, g: 0, b: 0 };
  return transmittanceAt(t, r, mu);
}

/** v in [0,1] -> elevation radians: e = sign(v - 0.5) * (PI / 2) * (2v - 1)^2. */
export function elevationOfRow(v: number): number {
  const s = 2 * v - 1;
  return (Math.PI / 2) * s * Math.abs(s);
}

/** The inverse: v = 0.5 + 0.5 * sign(e) * sqrt(|e| / (PI / 2)). */
export function rowOfElevation(e: number): number {
  return 0.5 + 0.5 * Math.sign(e) * Math.sqrt(Math.abs(e) / (Math.PI / 2));
}

/** u in [0,1] -> azimuth from the sun's, radians: PI * u. */
export function azimuthOfColumn(u: number): number {
  return Math.PI * u;
}

/**
 * Weights of the rows above the horizon in the level-ground integral, whose
 * integrand is L sin(e) cos(e) over elevation e: trapezoids between the rows'
 * elevations, with the horizon itself as a first node where the integrand is 0.
 */
const IRRADIANCE_ROW_WEIGHTS: Float64Array = (() => {
  const first = SLICE_ELEVATIONS / 2;
  const elevation = (j: number): number => (j < first ? 0 : elevationOfRow(j / (SLICE_ELEVATIONS - 1)));
  const out = new Float64Array(SLICE_ELEVATIONS);
  for (let j = first; j < SLICE_ELEVATIONS; j++) {
    const e = elevation(j);
    const below = elevation(j - 1);
    const above = j + 1 < SLICE_ELEVATIONS ? elevation(j + 1) : e;
    out[j] = ((above - below) / 2) * Math.sin(e) * Math.cos(e);
  }
  return out;
})();

/**
 * Cosine-weighted light on level ground from a slice's texels, per unit solar
 * irradiance: the rows above the horizon, each column a trapezoid in azimuth
 * over 0..PI, doubled for the mirrored half. A sky of uniform radiance 1 gives PI.
 */
export function skyIrradianceOf(texels: Float32Array): Rgb {
  const dPhi = Math.PI / (SLICE_AZIMUTHS - 1);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let j = SLICE_ELEVATIONS / 2; j < SLICE_ELEVATIONS; j++) {
    const rowWeight = IRRADIANCE_ROW_WEIGHTS[j] as number;
    for (let i = 0; i < SLICE_AZIMUTHS; i++) {
      const w = rowWeight * dPhi * 2 * (i === 0 || i === SLICE_AZIMUTHS - 1 ? 0.5 : 1);
      const k = (j * SLICE_AZIMUTHS + i) * 3;
      r += (texels[k] as number) * w;
      g += (texels[k + 1] as number) * w;
      b += (texels[k + 2] as number) * w;
    }
  }
  return { r, g, b };
}

/** The whole sky for a sun at altitudeDeg, as the dome reads it. */
export function buildSlice(t: SkyTables, altitudeDeg: number): SkySlice {
  const altitude = (altitudeDeg * Math.PI) / 180;
  const sx = Math.cos(altitude);
  const sy = Math.sin(altitude);
  const px: Rgb = { r: 0, g: 0, b: 0 };
  const texels = new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3);
  for (let j = 0; j < SLICE_ELEVATIONS; j++) {
    const e = elevationOfRow(j / (SLICE_ELEVATIONS - 1));
    const ce = Math.cos(e);
    const se = Math.sin(e);
    for (let i = 0; i < SLICE_AZIMUTHS; i++) {
      const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
      radianceInto(t, ce * Math.cos(az), se, ce * Math.sin(az), sx, sy, SKY_EYE_KM, px);
      const k = (j * SLICE_AZIMUTHS + i) * 3;
      texels[k] = px.r;
      texels[k + 1] = px.g;
      texels[k + 2] = px.b;
    }
  }
  const ring = new Float32Array(SLICE_AZIMUTHS * 3);
  const ringE = (RING_ELEVATION_DEG * Math.PI) / 180;
  for (let i = 0; i < SLICE_AZIMUTHS; i++) {
    const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
    radianceInto(t, Math.cos(ringE) * Math.cos(az), Math.sin(ringE), Math.cos(ringE) * Math.sin(az), sx, sy, SKY_EYE_KM, px);
    ring[i * 3] = px.r;
    ring[i * 3 + 1] = px.g;
    ring[i * 3 + 2] = px.b;
  }
  // The zenith is the top row's first texel: exactly what the dome draws straight up.
  const top = (SLICE_ELEVATIONS - 1) * SLICE_AZIMUTHS * 3;
  const zenith: Rgb = { r: texels[top] as number, g: texels[top + 1] as number, b: texels[top + 2] as number };
  return { altitudeDeg, texels, ring, zenith, skyIrradiance: skyIrradianceOf(texels), sun: sunTransmittance(t, altitude) };
}
```

- [ ] **Step 4: Run the tests: all but the aerosol scale's pass**

Run: `npx vitest run --root client test/game/skyModel.test.ts`
Expected: 18 passed, 1 failed: `the sky's light > keeps the clear noon horizon at most twice the zenith, at the smallest aerosol scale that does`, with `AssertionError: expected 4.391183866148029 to be less than or equal to 2`.

- [ ] **Step 5: Calibrate `SKY_MIE_SCALE`**

Write the calibration script to the git-ignored `.superpowers/` directory (it is never committed):

```bash
mkdir -p .superpowers && cat > .superpowers/calibrate-mie.ts <<'EOF'
import { luma, type Rgb } from "../client/src/game/colour.ts";
import { sunPositionAt } from "../client/src/game/sky.ts";
import { buildSkyTables, buildSlice, SLICE_AZIMUTHS, type SkySlice } from "../client/src/game/skyModel.ts";

const noonDeg = (Math.asin(sunPositionAt(12).y) * 180) / Math.PI;

function horizonOverZenith(slice: SkySlice): number {
  const away: Rgb = { r: 0, g: 0, b: 0 };
  const half = SLICE_AZIMUTHS / 2;
  for (let i = half; i < SLICE_AZIMUTHS; i++) {
    away.r += (slice.ring[i * 3] as number) / half;
    away.g += (slice.ring[i * 3 + 1] as number) / half;
    away.b += (slice.ring[i * 3 + 2] as number) / half;
  }
  return luma(away) / luma(slice.zenith);
}

// From the standard atmosphere's aerosols (1) up, in steps of 0.05: the first
// scale at which the clear noon horizon is at most twice the zenith.
let found: number | null = null;
for (let k = 20; k <= 200 && found === null; k++) {
  const scale = k / 20;
  const ratio = horizonOverZenith(buildSlice(buildSkyTables(scale), noonDeg));
  console.log("scale " + String(scale) + ": horizon / zenith " + ratio.toFixed(3));
  if (ratio <= 2) found = scale;
}
if (found === null) {
  console.log("no scale up to 10 meets it");
  process.exit(1);
}
console.log("SKY_MIE_SCALE = " + String(found));
EOF
npx tsx .superpowers/calibrate-mie.ts
```

Expected: 81 lines from `scale 1: horizon / zenith 4.391` down to

```
scale 4.9: horizon / zenith 2.029
scale 4.95: horizon / zenith 2.013
scale 5: horizon / zenith 1.997
SKY_MIE_SCALE = 5
```

(about 6 s). In `client/src/game/skyModel.ts` replace `export const SKY_MIE_SCALE = 1;` with the printed value: `export const SKY_MIE_SCALE = 5;` (if the script prints another value, write that one; the test pins the property, not the number). Then `rm .superpowers/calibrate-mie.ts`.

- [ ] **Step 6: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/skyModel.test.ts`
Expected: 19 passed.

- [ ] **Step 7: Hold the model to the Babylon-free list**

In `client/test/architecture.test.ts`, in `BABYLON_FREE_FILES`, replace

```ts
      join(SRC, "game", "lensParams.ts"),
    ];
```

with

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "skyModel.ts"),
    ];
```

Run: `npx vitest run --root client test/architecture.test.ts`
Expected: every test passes (the new file exists and imports nothing from `@babylonjs`; the new test file's one limit goes through `timeLimit` and it reads no clock).

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc -p client --noEmit` — expected: no output.
Run: `npx eslint client/src/game/skyModel.ts client/test/game/skyModel.test.ts client/test/architecture.test.ts` — expected: no output.

- [ ] **Step 9: Commit**

```bash
git add client/src/game/skyModel.ts client/test/game/skyModel.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: a scattering model of the clear sky

## What

The clear sky's light computed on the CPU from how sunlight scatters in
air, by Rayleigh scattering, aerosols and ozone over a spherical planet,
with Hillaire's standard Earth atmosphere: the transmittance and
multiple-scattering tables, a view direction's radiance, the sun's light
at the eye, and a slice of the whole sky for one sun altitude, laid out
as the dome will read it, with its horizon ring, zenith and light on
level ground. The aerosols are scaled so that the clear noon horizon is
at most twice the zenith. Nothing draws it yet.

## How

- `client/src/game/skyModel.ts` — the air, the two tables, the view
  march with every division guarded, the slice and its derived values,
  the 93 slice altitudes from −18° to 76°.
- `client/test/game/skyModel.test.ts` — transmittance in [0, 1] and
  rising with the cosine, the sun reddening toward the horizon, a blue
  sunset zenith at 3–15 % of noon, a red horizon toward the sun, the
  zenith dimming at every half degree below the horizon, finite
  non-negative values at every slice altitude, the eye's height, the
  aerosol scale's property.
- `client/test/architecture.test.ts` — the model held Babylon-free.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

### Task 2: Slices held, blended and made in a worker

**Files:**
- Create: `client/src/game/skyTable.ts`, `client/src/game/sky.worker.ts`, `client/src/game/skyWorker.ts`
- Test: `client/test/game/skyTable.test.ts`, `client/test/game/skyWorker.test.ts` (create)
- Modify: `client/test/architecture.test.ts` (three lines in `BABYLON_FREE_FILES`)

**Interfaces:**
- Consumes (Task 1, `client/src/game/skyModel.ts`): `SLICE_ALTITUDES_DEG`, `SLICE_ELEVATIONS`, `SLICE_AZIMUTHS`, `buildSkyTables`, `buildSlice`, `type SkySlice`, `type SkyTables`. Also `sunPositionAt` (`sky.ts`) and `type Rgb` (`colour.ts`).
- Produces: everything in contract §3, with exactly those names and signatures, plus:
  - `export function sliceBracket(altitudeDeg: number): number[];` (`skyTable.ts`) — the indices into `SLICE_ALTITUDES_DEG` bracketing an altitude, which `has` and `sliceOrder` share: `[i]` when the altitude is `SLICE_ALTITUDES_DEG[i]` exactly, `[0]` at or below −18, `[92]` at or above 76, else `[i, i + 1]`. `sliceBracket(NOON_ALTITUDE_DEG)` is `[91, 92]` (74° and 76°).
  - `export type SkyWorkerRequest = { startDeg: number };` and `export type SkyWorkerReply = { slice: SkySlice };` (`sky.worker.ts`; `skyWorker.ts` imports them as types only, so the worker's code never enters the page's bundle).
  - Pinned semantics: `has(a)` is true when a slice at exactly `a` is held, or every index of `sliceBracket(a)` is held (so the night, below −18°, needs the −18° slice). `blendAt(a).altitudeDeg === a` always, including the copies at a held altitude and beyond the held range. `add` throws on a non-finite altitude or a texel or ring array of the wrong length. For a start at a slice altitude exactly, `sliceOrder`'s start bracket is that one slice.
  - `startSkySource` also makes the slices in this thread when a worker cannot be made, reports an error, sends a message it cannot read, or sends a slice `add` refuses: it keeps what the worker sent and makes the rest in `sliceOrder`. It terminates the worker once all 93 slices are held.

**Notes for the implementer:**
- In this thread the first timer builds the tables and the first slice (about 95 ms on the M4), each later timer one slice (about 3 ms), so the main thread is never held longer than that.
- Measured: `skyTable.test.ts` about 0.7 s (of which the default `buildSkyTableSync()`, every slice, 0.35 s); `skyWorker.test.ts` about 0.5 s.
- `sky.worker.ts` installs its message handler only where `WorkerGlobalScope` exists: Node has neither `self` nor `Worker`, and the test imports `makeSlices` from that module. The worker test stops `makeSlices` early by throwing from `post`, so it never builds all 93 slices.

- [ ] **Step 1: Write the failing test for the table**

Create `client/test/game/skyTable.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SLICE_ALTITUDES_DEG,
  SLICE_AZIMUTHS,
  SLICE_ELEVATIONS,
  buildSkyTables,
  buildSlice,
  type SkySlice,
} from "../../src/game/skyModel.js";
import {
  NOON_ALTITUDE_DEG,
  buildSkyTableSync,
  createSkyTable,
  sliceBracket,
  sliceOrder,
} from "../../src/game/skyTable.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A slice whose every texel holds `v`, every ring value v + 1, and whose derived colours are v + 2 to v + 4. */
function flatSlice(altitudeDeg: number, v: number): SkySlice {
  return {
    altitudeDeg,
    texels: new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3).fill(v),
    ring: new Float32Array(SLICE_AZIMUTHS * 3).fill(v + 1),
    zenith: { r: v + 2, g: v + 2, b: v + 2 },
    skyIrradiance: { r: v + 3, g: v + 3, b: v + 3 },
    sun: { r: v + 4, g: v + 4, b: v + 4 },
  };
}

/** Lets every promise already settled run its callbacks. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the order the slices are made in", () => {
  it("knows the noon sun's altitude on the arc", () => {
    expect(NOON_ALTITUDE_DEG).toBeCloseTo(75.96376, 5);
  });

  it("brackets an altitude by one slice when it is a slice altitude or beyond the ends, else by the two either side", () => {
    expect(sliceBracket(NOON_ALTITUDE_DEG)).toEqual([91, 92]);
    expect(sliceBracket(10.2)).toEqual([56, 57]);
    expect(sliceBracket(10)).toEqual([56]);
    expect(sliceBracket(12.5)).toEqual([60, 61]);
    expect(sliceBracket(-18)).toEqual([0]);
    expect(sliceBracket(-40)).toEqual([0]);
    expect(sliceBracket(76)).toEqual([92]);
    expect(sliceBracket(80)).toEqual([92]);
  });

  it("makes the noon bracket first, then the start's, then outward from the start, below first", () => {
    expect(sliceOrder(10.2).slice(0, 10)).toEqual([91, 92, 56, 57, 55, 58, 54, 59, 53, 60]);
  });

  it("makes a start that is a slice altitude from that one slice", () => {
    expect(sliceOrder(10).slice(0, 9)).toEqual([91, 92, 56, 55, 57, 54, 58, 53, 59]);
  });

  it("skips the start's bracket when it is the noon bracket, and runs out downward", () => {
    expect(sliceOrder(75)).toEqual([91, 92, ...Array.from({ length: 91 }, (_, k) => 90 - k)]);
  });

  it("starts the night from the lowest slice and climbs", () => {
    expect(sliceOrder(-40)).toEqual([91, 92, ...Array.from({ length: 91 }, (_, k) => k)]);
  });

  it("lists every slice exactly once, from any start", () => {
    const every = Array.from({ length: 93 }, (_, k) => k);
    for (const start of [-90, -18, -17.75, 0, 10, 10.2, 12, 13, 50, 74, 75, NOON_ALTITUDE_DEG, 76, 90]) {
      expect([...sliceOrder(start)].sort((a, b) => a - b)).toEqual(every);
    }
  });
});

describe("the sky table", () => {
  it("holds slices by altitude, replacing one of the same altitude", () => {
    const table = createSkyTable();
    expect(table.count).toBe(0);
    table.add(flatSlice(10, 1));
    table.add(flatSlice(-3, 1));
    table.add(flatSlice(10, 5));
    expect(table.count).toBe(2);
    expect(table.blendAt(10).texels[0]).toBe(5);
  });

  it("refuses a slice of the wrong size", () => {
    const table = createSkyTable();
    expect(() => table.add({ ...flatSlice(10, 1), texels: new Float32Array(3) })).toThrow("texels");
    expect(() => table.add({ ...flatSlice(10, 1), ring: new Float32Array(3) })).toThrow("ring");
    expect(() => table.add(flatSlice(Number.NaN, 1))).toThrow("finite altitude");
    expect(table.count).toBe(0);
  });

  it("has an altitude when its bracketing slices are held, or a slice at it exactly", () => {
    const table = createSkyTable();
    table.add(flatSlice(10, 1));
    expect(table.has(10)).toBe(true);
    expect(table.has(10.2)).toBe(false);
    table.add(flatSlice(10.5, 1));
    expect(table.has(10.2)).toBe(true);
    expect(table.has(10.5)).toBe(true);
    expect(table.has(10.7)).toBe(false);
    expect(table.has(11)).toBe(false);
    // Off the grid, a slice held at the altitude itself is enough.
    table.add(flatSlice(33.3, 1));
    expect(table.has(33.3)).toBe(true);
    // Beyond the ends, the end slice.
    expect(table.has(-40)).toBe(false);
    table.add(flatSlice(-18, 1));
    expect(table.has(-40)).toBe(true);
  });

  it("blends linearly between the held slices nearest below and above", () => {
    const table = createSkyTable();
    table.add(flatSlice(10, 2));
    table.add(flatSlice(12, 6));
    table.add(flatSlice(-6, 100));
    const mid = table.blendAt(11);
    expect(mid.altitudeDeg).toBe(11);
    expect(mid.texels.every((v) => v === 4)).toBe(true);
    expect(mid.ring.every((v) => v === 5)).toBe(true);
    expect(mid.zenith).toEqual({ r: 6, g: 6, b: 6 });
    expect(mid.skyIrradiance).toEqual({ r: 7, g: 7, b: 7 });
    expect(mid.sun).toEqual({ r: 8, g: 8, b: 8 });
    const quarter = table.blendAt(10.5);
    expect(quarter.texels[100]).toBe(3);
    expect(quarter.sun.g).toBe(7);
  });

  it("gives the held slice's own values at its altitude, and the nearest end's outside the held range", () => {
    const table = createSkyTable();
    const low = flatSlice(-6, 1);
    const high = flatSlice(20, 9);
    table.add(low);
    table.add(high);
    const exact = table.blendAt(-6);
    expect(exact).toEqual(low);
    for (const [altitude, held] of [[-40, low], [-6.0001, low], [20.5, high], [76, high]] as const) {
      const out = table.blendAt(altitude);
      expect(out.altitudeDeg).toBe(altitude);
      expect(out.texels).toEqual(held.texels);
      expect(out.ring).toEqual(held.ring);
      expect(out.zenith).toEqual(held.zenith);
      expect(out.skyIrradiance).toEqual(held.skyIrradiance);
      expect(out.sun).toEqual(held.sun);
    }
  });

  it("returns a new slice every call, sharing nothing with the table", () => {
    const table = createSkyTable();
    const held = flatSlice(10, 2);
    table.add(held);
    table.add(flatSlice(12, 6));
    for (const altitude of [10, 11, -40]) {
      const first = table.blendAt(altitude);
      const second = table.blendAt(altitude);
      for (const out of [first, second]) {
        expect(out.texels).not.toBe(held.texels);
        expect(out.ring).not.toBe(held.ring);
        expect(out.zenith).not.toBe(held.zenith);
        expect(out.skyIrradiance).not.toBe(held.skyIrradiance);
        expect(out.sun).not.toBe(held.sun);
      }
      expect(second.texels).not.toBe(first.texels);
      first.texels.fill(-1);
      first.zenith.r = -1;
      expect(table.blendAt(altitude).texels[0]).toBe(second.texels[0]);
      expect(table.blendAt(altitude).zenith.r).toBe(second.zenith.r);
    }
    expect(held.texels[0]).toBe(2);
  });

  it("throws when it holds nothing", () => {
    expect(() => createSkyTable().blendAt(10)).toThrow("no slice");
  });

  it("resolves whenReady once the altitude's slices are held, and at once when they already are", async () => {
    const table = createSkyTable();
    let ready = false;
    const waited = table.whenReady(10.2).then(() => {
      ready = true;
    });
    table.add(flatSlice(10, 1));
    await settle();
    expect(ready).toBe(false);
    table.add(flatSlice(10.5, 1));
    await waited;
    expect(ready).toBe(true);
    await expect(table.whenReady(10)).resolves.toBeUndefined();
  });

  it("calls its listeners after every add, until each unsubscribes", () => {
    const table = createSkyTable();
    const seen: number[] = [];
    const other: number[] = [];
    const stop = table.onChange(() => seen.push(table.count));
    const stopSelf: () => void = table.onChange(() => {
      other.push(table.count);
      stopSelf();
    });
    table.add(flatSlice(10, 1));
    table.add(flatSlice(10.5, 1));
    stop();
    table.add(flatSlice(11, 1));
    expect(seen).toEqual([1, 2]);
    expect(other).toEqual([1]);
  });
});

describe("a table built in this thread", () => {
  it("holds the slices asked for, as the model makes them", () => {
    const table = buildSkyTableSync([10, 10.5]);
    expect(table.count).toBe(2);
    expect(table.has(10.2)).toBe(true);
    expect(table.has(11)).toBe(false);
    const made = buildSlice(buildSkyTables(), 10);
    const held = table.blendAt(10);
    expect(held.texels).toEqual(made.texels);
    expect(held.ring).toEqual(made.ring);
    expect(held.zenith).toEqual(made.zenith);
    expect(held.sun).toEqual(made.sun);
  }, timeLimit(20_000));

  it("holds every slice altitude by default", () => {
    const table = buildSkyTableSync();
    expect(table.count).toBe(SLICE_ALTITUDES_DEG.length);
    for (const altitude of SLICE_ALTITUDES_DEG) expect(table.has(altitude)).toBe(true);
  }, timeLimit(60_000));
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/skyTable.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/game/skyTable.js' imported from …/client/test/game/skyTable.test.ts`, "no tests".

- [ ] **Step 3: Write the table**

Create `client/src/game/skyTable.ts`:

```ts
/**
 * The sky's slices as they arrive, and the sky at any sun altitude blended
 * from them. Slices are made off the main thread (`skyWorker.ts`) in the order
 * the start hour needs them, so the table fills over the first second or two
 * of a page; `has` and `whenReady` say when an altitude can be drawn as it
 * should be, and `blendAt` draws it from whatever is held meanwhile.
 *
 * Pure and Babylon-free: the worker imports `sliceOrder` from here.
 */
import { sunPositionAt } from "./sky.js";
import {
  SLICE_ALTITUDES_DEG,
  SLICE_AZIMUTHS,
  SLICE_ELEVATIONS,
  buildSkyTables,
  buildSlice,
  type SkySlice,
} from "./skyModel.js";
import type { Rgb } from "./colour.js";

export type SkyTable = {
  /** Holds a slice, replacing one of the same altitude. Throws on a slice of the wrong size or altitude. */
  add(slice: SkySlice): void;
  readonly count: number;
  /** True when the slices at or bracketing altitudeDeg are held (an exact altitude needs one). */
  has(altitudeDeg: number): boolean;
  /** The slice at altitudeDeg, blended linearly (texels, ring, zenith, skyIrradiance, sun) between
   *  the held slices nearest below and above; outside them, a copy of the nearest held slice.
   *  Throws when empty. Never returns a slice object held in the table (callers may keep it). */
  blendAt(altitudeDeg: number): SkySlice;
  whenReady(altitudeDeg: number): Promise<void>;
  /** Called after every add. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
};

/** The noon altitude on the sun's arc, degrees: asin(sunPositionAt(12).y) in degrees (75.96...). */
export const NOON_ALTITUDE_DEG: number = (Math.asin(sunPositionAt(12).y) * 180) / Math.PI;

const TEXEL_COUNT = SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3;
const RING_COUNT = SLICE_AZIMUTHS * 3;
const LAST = SLICE_ALTITUDES_DEG.length - 1;

/**
 * The indices into SLICE_ALTITUDES_DEG of the slices that bracket an
 * altitude: one when it is a slice altitude exactly, or lies beyond either end
 * (the nearest end's), else the two either side, lower first.
 */
export function sliceBracket(altitudeDeg: number): number[] {
  if (!(altitudeDeg > (SLICE_ALTITUDES_DEG[0] as number))) return [0];
  if (!(altitudeDeg < (SLICE_ALTITUDES_DEG[LAST] as number))) return [LAST];
  let upper = 1;
  while ((SLICE_ALTITUDES_DEG[upper] as number) < altitudeDeg) upper++;
  return SLICE_ALTITUDES_DEG[upper] === altitudeDeg ? [upper] : [upper - 1, upper];
}

/** Indices into SLICE_ALTITUDES_DEG in the order to make them: the two bracketing
 *  NOON_ALTITUDE_DEG (lower, upper), then the two bracketing startDeg (lower, upper; skipping any
 *  already listed), then the rest alternately outward from startDeg, below first. Every index once. */
export function sliceOrder(startDeg: number): number[] {
  const order: number[] = [];
  const listed = new Set<number>();
  const list = (index: number): void => {
    if (listed.has(index)) return;
    listed.add(index);
    order.push(index);
  };
  for (const index of sliceBracket(NOON_ALTITUDE_DEG)) list(index);
  const start = sliceBracket(startDeg);
  for (const index of start) list(index);
  let below = (start[0] as number) - 1;
  let above = (start[start.length - 1] as number) + 1;
  while (below >= 0 || above <= LAST) {
    if (below >= 0) list(below--);
    if (above <= LAST) list(above++);
  }
  return order;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function lerpArray(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = (a[k] as number) + ((b[k] as number) - (a[k] as number)) * t;
  return out;
}

/** A copy of a held slice, at the altitude asked for: nothing in it is shared with the table. */
function copyAt(s: SkySlice, altitudeDeg: number): SkySlice {
  return {
    altitudeDeg,
    texels: new Float32Array(s.texels),
    ring: new Float32Array(s.ring),
    zenith: { ...s.zenith },
    skyIrradiance: { ...s.skyIrradiance },
    sun: { ...s.sun },
  };
}

export function createSkyTable(): SkyTable {
  /** Held slices, ascending by altitude. */
  const slices: SkySlice[] = [];
  const listeners = new Set<() => void>();
  let waiting: { altitudeDeg: number; resolve: () => void }[] = [];

  function holds(altitudeDeg: number): boolean {
    return slices.some((s) => s.altitudeDeg === altitudeDeg);
  }

  function has(altitudeDeg: number): boolean {
    if (holds(altitudeDeg)) return true;
    return sliceBracket(altitudeDeg).every((index) => holds(SLICE_ALTITUDES_DEG[index] as number));
  }

  return {
    add(slice) {
      if (!Number.isFinite(slice.altitudeDeg) || slice.texels.length !== TEXEL_COUNT || slice.ring.length !== RING_COUNT) {
        throw new Error(`a sky slice must have a finite altitude, ${TEXEL_COUNT} texels and a ring of ${RING_COUNT}; got ${slice.altitudeDeg}, ${slice.texels.length}, ${slice.ring.length}`);
      }
      const at = slices.findIndex((s) => s.altitudeDeg >= slice.altitudeDeg);
      if (at === -1) slices.push(slice);
      else if ((slices[at] as SkySlice).altitudeDeg === slice.altitudeDeg) slices[at] = slice;
      else slices.splice(at, 0, slice);
      const ready = waiting.filter((w) => has(w.altitudeDeg));
      waiting = waiting.filter((w) => !has(w.altitudeDeg));
      for (const w of ready) w.resolve();
      // A snapshot, so a listener may unsubscribe itself, or another, as it runs.
      for (const listener of [...listeners]) listener();
    },
    get count() {
      return slices.length;
    },
    has,
    blendAt(altitudeDeg) {
      const first = slices[0];
      const last = slices[slices.length - 1];
      if (first === undefined || last === undefined) throw new Error("the sky table holds no slice yet");
      if (!(altitudeDeg > first.altitudeDeg)) return copyAt(first, altitudeDeg);
      if (!(altitudeDeg < last.altitudeDeg)) return copyAt(last, altitudeDeg);
      const upperIndex = slices.findIndex((s) => s.altitudeDeg >= altitudeDeg);
      const upper = slices[upperIndex] as SkySlice;
      if (upper.altitudeDeg === altitudeDeg) return copyAt(upper, altitudeDeg);
      const lower = slices[upperIndex - 1] as SkySlice;
      const t = (altitudeDeg - lower.altitudeDeg) / (upper.altitudeDeg - lower.altitudeDeg);
      return {
        altitudeDeg,
        texels: lerpArray(lower.texels, upper.texels, t),
        ring: lerpArray(lower.ring, upper.ring, t),
        zenith: lerpRgb(lower.zenith, upper.zenith, t),
        skyIrradiance: lerpRgb(lower.skyIrradiance, upper.skyIrradiance, t),
        sun: lerpRgb(lower.sun, upper.sun, t),
      };
    },
    whenReady(altitudeDeg) {
      if (has(altitudeDeg)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiting.push({ altitudeDeg, resolve });
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Builds the tables and the given altitudes (default: all) in this thread. Tests, and pages without Worker. */
export function buildSkyTableSync(altitudesDeg: readonly number[] = SLICE_ALTITUDES_DEG): SkyTable {
  const tables = buildSkyTables();
  const table = createSkyTable();
  for (const altitudeDeg of altitudesDeg) table.add(buildSlice(tables, altitudeDeg));
  return table;
}
```

- [ ] **Step 4: Run the table's tests and see them pass**

Run: `npx vitest run --root client test/game/skyTable.test.ts`
Expected: 18 passed.

- [ ] **Step 5: Write the failing test for the worker and the source**

Create `client/test/game/skyWorker.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SLICE_ALTITUDES_DEG, SLICE_AZIMUTHS, SLICE_ELEVATIONS, type SkySlice } from "../../src/game/skyModel.js";
import { makeSlices, type SkyWorkerReply } from "../../src/game/sky.worker.js";
import { startSkySource } from "../../src/game/skyWorker.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A slice whose every value is `v`: what a worker's message would carry, without the model's cost. */
function flatSlice(altitudeDeg: number, v = 1): SkySlice {
  return {
    altitudeDeg,
    texels: new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3).fill(v),
    ring: new Float32Array(SLICE_AZIMUTHS * 3).fill(v),
    zenith: { r: v, g: v, b: v },
    skyIrradiance: { r: v, g: v, b: v },
    sun: { r: v, g: v, b: v },
  };
}

/** A Worker that records what it is sent and whether it was ended; the test answers for it. */
class FakeWorker {
  static made: FakeWorker[] = [];
  static refuse = false;
  readonly posted: unknown[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<SkyWorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: URL, readonly options: WorkerOptions) {
    if (FakeWorker.refuse) throw new Error("no worker to be had");
    FakeWorker.made.push(this);
  }
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated++;
  }
  send(slice: SkySlice): void {
    this.onmessage?.({ data: { slice } } as MessageEvent<SkyWorkerReply>);
  }
}

afterEach(() => {
  FakeWorker.made = [];
  FakeWorker.refuse = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the sky's worker", () => {
  it("makes the slices in sliceOrder, posting each as it is made, and stops when a post throws", () => {
    const made: number[] = [];
    expect(() =>
      makeSlices(10.2, (slice) => {
        made.push(slice.altitudeDeg);
        if (made.length === 5) throw new Error("enough");
      }),
    ).toThrow("enough");
    expect(made).toEqual([74, 76, 10, 10.5, 9.5]);
    // Under Node there is no worker scope: importing the module set no handler.
    expect((globalThis as { onmessage?: unknown }).onmessage).toBeUndefined();
  }, timeLimit(20_000));

  it("posts slices whose buffers are their own, so each transfers whole and alone", () => {
    const slices: SkySlice[] = [];
    expect(() =>
      makeSlices(0, (slice) => {
        slices.push(slice);
        if (slices.length === 2) throw new Error("enough");
      }),
    ).toThrow("enough");
    const buffers = new Set<ArrayBufferLike>();
    for (const slice of slices) {
      for (const values of [slice.texels, slice.ring]) {
        expect(values.byteOffset).toBe(0);
        expect(values.buffer.byteLength).toBe(values.byteLength);
        buffers.add(values.buffer);
      }
    }
    expect(buffers.size).toBe(4);
    const slice = slices[0] as SkySlice;
    const texels = new Float32Array(slice.texels);
    const reply: SkyWorkerReply = { slice };
    const moved = structuredClone(reply, { transfer: [slice.texels.buffer, slice.ring.buffer] });
    expect(moved.slice.texels).toEqual(texels);
    expect(moved.slice.zenith).toEqual(slice.zenith);
    expect(slice.texels.buffer.byteLength).toBe(0);
    expect(slice.ring.buffer.byteLength).toBe(0);
  }, timeLimit(20_000));
});

describe("the sky's source", () => {
  it("starts a module worker in the form Vite bundles", () => {
    const source = readFileSync(new URL("../../src/game/skyWorker.ts", import.meta.url), "utf8");
    expect(source).toContain('new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" })');
  });

  it("without a Worker, makes the slices in this thread, one per timer, in sliceOrder, until disposed", () => {
    vi.useFakeTimers();
    const source = startSkySource(10.2);
    // Nothing is made before the first timer: the caller's frame is not held.
    expect(source.table.count).toBe(0);
    const expected = [74, 76, 10, 10.5];
    for (let k = 0; k < expected.length; k++) {
      vi.advanceTimersToNextTimer();
      expect(source.table.count).toBe(k + 1);
      expect(source.table.has(expected[k] as number)).toBe(true);
    }
    expect(source.table.has(10.2)).toBe(true);
    source.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(source.table.count).toBe(4);
  }, timeLimit(20_000));

  it("asks the worker for the start altitude, holds what it sends, and ends it when every slice is in", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    expect(String(worker.url)).toMatch(/\/sky\.worker\.ts$/);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.posted).toEqual([{ startDeg: 10.2 }]);
    worker.send(flatSlice(74));
    expect(source.table.count).toBe(1);
    expect(worker.terminated).toBe(0);
    for (const altitude of SLICE_ALTITUDES_DEG) worker.send(flatSlice(altitude));
    expect(source.table.count).toBe(93);
    expect(worker.terminated).toBe(1);
    source.dispose();
  });

  it("ends the worker on dispose and ignores a slice that arrives after", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    const send = worker.onmessage;
    source.dispose();
    expect(worker.terminated).toBe(1);
    send?.({ data: { slice: flatSlice(74) } } as MessageEvent<SkyWorkerReply>);
    expect(source.table.count).toBe(0);
  });

  it("makes the rest in this thread when the worker fails partway, skipping what it sent", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const source = startSkySource(10.2);
    const worker = FakeWorker.made.at(-1) as FakeWorker;
    worker.send(flatSlice(74, 7));
    worker.send(flatSlice(76, 7));
    worker.onerror?.({ message: "failed" } as ErrorEvent);
    expect(worker.terminated).toBe(1);
    vi.advanceTimersToNextTimer();
    expect(source.table.count).toBe(3);
    expect(source.table.has(10)).toBe(true);
    // The worker's slices stay as it sent them.
    expect(source.table.blendAt(74).texels[0]).toBe(7);
    source.dispose();
    expect(vi.getTimerCount()).toBe(0);
  }, timeLimit(20_000));

  it("makes the slices in this thread when no worker can be made", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.refuse = true;
    const source = startSkySource(-40);
    vi.advanceTimersToNextTimer();
    expect(source.table.count).toBe(1);
    expect(source.table.has(74)).toBe(true);
    source.dispose();
  }, timeLimit(20_000));
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `npx vitest run --root client test/game/skyWorker.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/game/sky.worker.js' imported from …/client/test/game/skyWorker.test.ts`, "no tests".

- [ ] **Step 7: Write the worker**

Create `client/src/game/sky.worker.ts`:

```ts
/**
 * The sky's slices, made off the main thread: a module worker, which Vite
 * bundles from the `new Worker(new URL(...), { type: "module" })` in
 * `skyWorker.ts`. One request, the start altitude; then one reply per slice,
 * in `sliceOrder`, each slice's buffers transferred, not copied, so the
 * slices the start hour needs reach the page first.
 */
import { SLICE_ALTITUDES_DEG, buildSkyTables, buildSlice, type SkySlice } from "./skyModel.js";
import { sliceOrder } from "./skyTable.js";

export type SkyWorkerRequest = { startDeg: number };
export type SkyWorkerReply = { slice: SkySlice };

/**
 * Builds the tables, then every slice in `sliceOrder(startDeg)`, handing each
 * to `post` as it is made. A `post` that throws stops the run.
 */
export function makeSlices(startDeg: number, post: (slice: SkySlice) => void): void {
  const tables = buildSkyTables();
  for (const index of sliceOrder(startDeg)) post(buildSlice(tables, SLICE_ALTITUDES_DEG[index] as number));
}

// Only inside a worker: under Node, where a test imports `makeSlices`, and on
// a page, there is no WorkerGlobalScope.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "function") {
  self.onmessage = (event: MessageEvent<SkyWorkerRequest>): void => {
    makeSlices(event.data.startDeg, (slice) => {
      const reply: SkyWorkerReply = { slice };
      self.postMessage(reply, { transfer: [slice.texels.buffer, slice.ring.buffer] });
    });
  };
}
```

- [ ] **Step 8: Write the source**

Create `client/src/game/skyWorker.ts`:

```ts
/**
 * Where the sky's slices come from: the module worker (`sky.worker.ts`), which
 * makes them off the main thread in the order the start hour needs them, or,
 * where there is no Worker or the worker fails, this thread, one slice per
 * timer so a frame is never held for more than one. Either way the slices
 * fill one table, which the page keeps for its life.
 */
import { SLICE_ALTITUDES_DEG, buildSkyTables, buildSlice, type SkyTables } from "./skyModel.js";
import { createSkyTable, sliceOrder, type SkyTable } from "./skyTable.js";
import type { SkyWorkerReply, SkyWorkerRequest } from "./sky.worker.js";

export type SkySource = { readonly table: SkyTable; dispose(): void };

/** Starts the worker (new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" }))
 *  and fills a table as slices arrive. Where Worker is undefined it makes the same slices in this
 *  thread, one per setTimeout(0), in the same order. dispose terminates the worker or stops the loop. */
export function startSkySource(startDeg: number): SkySource {
  const table = createSkyTable();
  const order = sliceOrder(startDeg);
  let disposed = false;
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function endWorker(): void {
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }

  // In this thread: the tables with the first slice, then one slice per
  // timer, skipping any a failed worker already delivered.
  function runHere(): void {
    endWorker();
    let tables: SkyTables | null = null;
    let next = 0;
    const step = (): void => {
      timer = null;
      if (disposed) return;
      while (next < order.length && table.has(SLICE_ALTITUDES_DEG[order[next] as number] as number)) next++;
      if (next >= order.length) return;
      tables ??= buildSkyTables();
      table.add(buildSlice(tables, SLICE_ALTITUDES_DEG[order[next] as number] as number));
      next++;
      if (next < order.length) timer = setTimeout(step, 0);
    };
    timer = setTimeout(step, 0);
  }

  if (typeof Worker === "undefined") {
    runHere();
  } else {
    try {
      worker = new Worker(new URL("./sky.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
    if (worker === null) {
      runHere();
    } else {
      worker.onmessage = (event: MessageEvent<SkyWorkerReply>): void => {
        if (disposed) return;
        try {
          table.add(event.data.slice);
        } catch {
          runHere();
          return;
        }
        // Every slice is in: the worker's thread is not needed again.
        if (table.count >= SLICE_ALTITUDES_DEG.length) endWorker();
      };
      // A worker that fails, or sends what cannot be read, leaves its slices
      // to this thread: without them the page would never be shown.
      worker.onerror = (): void => {
        if (!disposed) runHere();
      };
      worker.onmessageerror = (): void => {
        if (!disposed) runHere();
      };
      const request: SkyWorkerRequest = { startDeg };
      worker.postMessage(request);
    }
  }

  return {
    table,
    dispose() {
      disposed = true;
      endWorker();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
```

- [ ] **Step 9: Run the worker's tests and see them pass**

Run: `npx vitest run --root client test/game/skyWorker.test.ts test/game/skyTable.test.ts test/game/skyModel.test.ts`
Expected: 3 files, 45 passed (8 + 18 + 19).

- [ ] **Step 10: Hold the three modules to the Babylon-free list**

In `client/test/architecture.test.ts`, in `BABYLON_FREE_FILES`, replace

```ts
      join(SRC, "game", "skyModel.ts"),
    ];
```

with

```ts
      join(SRC, "game", "skyModel.ts"),
      join(SRC, "game", "skyTable.ts"),
      join(SRC, "game", "sky.worker.ts"),
      join(SRC, "game", "skyWorker.ts"),
    ];
```

The list's test only checks that each file exists and imports nothing from `@babylonjs`, so it takes the worker file as it takes the others.

Run: `npx vitest run --root client test/architecture.test.ts`
Expected: every test passes (the two new test files' limits all go through `timeLimit`; neither reads a clock: the fake timers are not clock reads).

- [ ] **Step 11: Typecheck and lint**

Run: `npx tsc -p client --noEmit` — expected: no output.
Run: `npx eslint client/src/game/skyTable.ts client/src/game/sky.worker.ts client/src/game/skyWorker.ts client/test/game/skyTable.test.ts client/test/game/skyWorker.test.ts client/test/architecture.test.ts` — expected: no output.

- [ ] **Step 12: Commit**

```bash
git add client/src/game/skyTable.ts client/src/game/sky.worker.ts client/src/game/skyWorker.ts client/test/game/skyTable.test.ts client/test/game/skyWorker.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the sky's slices, made in a worker and blended by altitude

## What

The sky's slices are made off the main thread at load, in the order
the start hour needs them: the two either side of noon, then the two
either side of the start, then outward. A table holds them as they
arrive, says when an altitude can be drawn, and blends the two slices
either side of any altitude. Where there is no worker, or it fails,
the same slices are made on the main thread, one per timer.

## How

- `client/src/game/skyTable.ts` — the table, its blend, the order the
  slices are made in, the noon altitude, and a table built in place.
- `client/src/game/sky.worker.ts` — the module worker: one request,
  one transferred reply per slice.
- `client/src/game/skyWorker.ts` — the source the page keeps: the
  worker, or this thread when there is none or it fails.
- `client/test/game/skyTable.test.ts`, `client/test/game/skyWorker.test.ts`
  — the order, the blend, readiness and its listeners, the transferred
  buffers, the fallback's one slice per timer, disposal.
- `client/test/architecture.test.ts` — the three modules held
  Babylon-free.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

### Task 3: The sky's state, and the air under the weather over it

**Files:**
- Create: `client/src/game/skyState.ts`, `client/test/game/helpers/skyFixture.ts`
- Modify: `client/src/game/weather.ts` (add `airColourUnder`; nothing removed), `client/src/game/sky.ts` (export `NIGHT_SKY` and `MOONLIGHT`), `client/test/architecture.test.ts` (one line in `BABYLON_FREE_FILES`)
- Test: `client/test/game/skyState.test.ts` (create), `client/test/game/weather.test.ts` (modify: two import lines, one block appended)

**Interfaces:**
- Consumes:
  - Task 1 (`client/src/game/skyModel.ts`): `RING_ELEVATION_DEG`, `SKY_EYE_KM`, `SKY_GROUND_KM`, `SLICE_ALTITUDES_DEG`, `SLICE_AZIMUTHS`, `SLICE_ELEVATIONS`, `rowOfElevation`, `type SkySlice` (its `zenith` is the top row's first texel; its `sun` is exactly 0 once the ray toward the sun meets the ground).
  - Task 2 (`client/src/game/skyTable.ts`): `NOON_ALTITUDE_DEG` (computed as `(Math.asin(sunPositionAt(12).y) * 180) / Math.PI`, the expression `skyStateFor` repeats so noon blends the same slice twice), `buildSkyTableSync`, `sliceBracket`, `type SkyTable`.
  - Existing: `clamp01`, `desaturateRgb`, `luma`, `mixRgb`, `type Rgb` (`colour.ts`); `FILL_DAY`, `FILL_NIGHT`, `SUN_PEAK`, `sunPositionAt`, `type Vec3` (`sky.ts`); `AMBIENT_DESAT`, `FILL_LIFT`, `SUN_CLOUD_LOSS`, `SUN_DESAT`, `type WeatherParams` and, inside `weather.ts`, `MIST_AIR`, `DREAD_AIR`, `FOG_RAIN_GREY`, `DREAD_FOG_PULL`, `dreadWorldUnder`.
- Produces: contract §4 with exactly its names and signatures (`SKY_NOON_ZENITH_LUMINANCE`, `SKY_GAMMA`, `SKY_Y_FLOOR`, `NIGHT_YA_DAY`, `NIGHT_YA_NIGHT`, `DECK_TAU`, `MIST_HORIZON`, `SUN_DISC_COS`, `SUN_DISC_RADIANCE`, `SUN_DISC_CAPTURE_MAX`, `FILL_DAY_LUMA`, `GLOW_POWER_MIN`, `GLOW_POWER_MAX`, `GLOW_MIN_CONTRAST`, `type SkyState`, `skyStateFor`, `skyScale`, `levelLight`, `adaptationFor`, `nightFactor`, `deckRadiance`, `skyTableUv`, `domeRadiance`, `fitGlow`), `airColourUnder(w: WeatherParams, base: Rgb): Rgb` (`weather.ts`), `NIGHT_SKY` and `MOONLIGHT` (`sky.ts`, now `export const …: Readonly<Rgb> = Object.freeze({…})`, values unchanged), `skyFixture(): SkyTable`. Additions and changes to §4, each forced by a test below:
  - `export const SUN_DISC_VIEW_MAX = 16;` and the disc becomes `d = T × SUN_DISC_RADIANCE × scale`, `discColour = d × min(1, SUN_DISC_VIEW_MAX / max(d.r, d.g, d.b)) × (1 − cloud) × sunUpFor(altitude)`. The contract's `× (1 − SUN_CLOUD_LOSS × cloud)` left a tenth of the disc at full cloud, where the deck is to take it away, and the disc's own radiance (about 1.9 × 10⁵ in scene units at noon) is past half float's largest value, so the post path's half-float scene target would hold infinity.
  - `export function sunUpFor(altitude: number): number;` — 1 until the sun's centre is one disc diameter (0.54°) above the horizon's dip (0.4544° from the 200 m eye), 0 at the dip, smoothstep between. `sunIntensity` and `discColour` are multiplied by it, so the light and the disc fade as the sun sets instead of dropping when its ray first meets the ground.
  - `export const GLOW_FULL_CONTRAST = 1.25;` and `fitGlow`'s weight is `smoothstep((luma(R_0) − GLOW_MIN_CONTRAST × la) / ((GLOW_FULL_CONTRAST − GLOW_MIN_CONTRAST) × la))` rather than a switch to 1, and its fit weights each column by `r(1 − r)` over `0 < r < 1` rather than keeping `0.02 < r < 0.98`. Both are what keep the continuity test passing: with the contract's switch the glow's weight steps from 1 to 0 between two hours 0.01 h apart (at 19:00 clear, at 18:44 in mist), and with its window the power steps by up to 38 %. A known power is still recovered exactly, and the weight is still exactly 0 at or below `GLOW_MIN_CONTRAST` (so a full deck gives none).
  - `export function captureEncode(c: Rgb): Rgb;` — each channel `Math.pow(Math.max(x, 0), 1 / 2.2)`: what the dome writes in the probe's capture for the linear colour `domeRadiance(s, d, true)` returns. The probe stays flagged as gamma (Task 5), so every PBR material raises what it reads to 2.2 and gets the dome's linear radiance back.
  - `export const SKY_IBL_SCALE = 1;` — the image-based light's share relative to the dome; Task 5 sets the environment intensity to the ambient collapse times it.
  - `SkyState.nightFloor: Rgb` = `NIGHT_SKY × night`: the dome's floor, standing in for the moonlit night sky and appearing as the twilight fades. It replaces `NIGHT_SKY` wherever §4 adds it (the dome in `domeRadiance`, and every ring column `R_i`, so `horizonAway` and `horizonToward`), so clear noon's dome straight up is the table's zenith alone, luma 0.416, and midnight's is `NIGHT_SKY`. Task 4's `skyNight` uniform is set from it.
  - `export const SKY_FIXTURE_HOURS: readonly number[]` from the fixture: the hours it holds.

**Notes for the implementer** (measured on the M4, Node 22, against the drafts of Tasks 1–2 at `SKY_MIE_SCALE = 5`):
- The fixture builds 17 slices in about 0.15 s; the continuity tests' table, every slice from −18° to 16° and the noon bracket (65 slices), about 0.3 s. `skyState.test.ts` runs in about 0.8 s.
- `DECK_TAU` comes to 0.1598.
- The clear noon dome straight up is checked to 7 places, not 12: the blended noon slice holds its texels in float32 while its `zenith` is blended in double, so the two differ by about 3 × 10⁻⁹.
- At 18:00 clear: zenith (0.175, 0.182, 0.334), horizon toward the sun (11.54, 2.22, 0.44), sun intensity 0.071, fill 0.044, night factor 0.026. The night factor is 1 from about −7.3°. At 17:00 clear the sun's intensity is 5.69: the adaptation raises the sun above noon's 4 while its beam is still bright and the level light falls.
- The coherence tests' worst per-channel error is 2.5 % of the luma (the tolerance is 5 %); the jump criterion's worst step-to-neighbour ratio is 2.06 (the bound is 3); the night factor's largest step is 0.037 (the bound is 0.072); the level light's steepest fall where night is incomplete is 0.94 decades a degree (the premise checked is 1.5).
- `weather.test.ts` after this task: the colour import reads `import { desaturateRgb, luma, type Rgb } from "../../src/game/colour.js";` and the appended block's second test (`agrees with fogColourUnder over skyColourAt wherever its dusk dimming is the identity`) calls `fogColourUnder` and `skyColourAt`. The task that removes those two functions deletes that one test; the block's other tests read only `airColourUnder`.

- [ ] **Step 1: Write the failing test for `airColourUnder`**

In `client/test/game/weather.test.ts`, replace the first line inside the import from `../../src/game/weather.js`

```ts
  ambientColourUnder, ambientGainsUnder, exposureUnder, fillIntensityUnder,
```

with

```ts
  airColourUnder, ambientColourUnder, ambientGainsUnder, exposureUnder, fillIntensityUnder,
```

and replace

```ts
import { luma } from "../../src/game/colour.js";
```

with

```ts
import { desaturateRgb, luma, type Rgb } from "../../src/game/colour.js";
```

Then append to the end of the file:

```ts
describe("airColourUnder: fogColourUnder's steps over a horizon colour from the sky, minus its dusk dimming", () => {
  /** Today's day sky and dusk horizon, a red sunset horizon past 1, a dim twilight and the night floor. */
  const BASES: Rgb[] = [
    { r: 0.42, g: 0.58, b: 0.82 },
    { r: 0.62, g: 0.5, b: 0.42 },
    { r: 2.6, g: 0.93, b: 0.63 },
    { r: 0.13, g: 0.12, b: 0.21 },
    { r: 0.02, g: 0.03, b: 0.06 },
  ];
  const spread = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

  it("is exactly the base at clear, as a copy", () => {
    for (const base of BASES) {
      const air = airColourUnder(CLEAR, base);
      expect(air).toEqual(base);
      expect(air).not.toBe(base);
    }
  });

  it("agrees with fogColourUnder over skyColourAt wherever its dusk dimming is the identity", () => {
    for (const w of Object.values(WEATHER_PRESETS)) {
      for (let hour = 0; hour < 24; hour += 0.25) {
        if (w.cloudCover > 0 && sunPositionAt(hour).y < 0.35) continue;
        expect(airColourUnder(w, skyColourAt(hour))).toEqual(fogColourUnder(w, hour));
      }
    }
    // This test goes when fogColourUnder and skyColourAt do.
  });

  it("pulls halfway to mist air scaled to the base's luma under full mist, the target capped at 1.2 times mist air", () => {
    const MIST_ONLY: WeatherParams = { ...CLEAR, mist: 1 };
    // A base dimmer than 1.2 times mist air's luma (0.5972): the target has the base's own luma.
    for (const base of [BASES[0]!, BASES[3]!, BASES[4]!]) {
      expect(luma(airColourUnder(MIST_ONLY, base))).toBeCloseTo(luma(base), 12);
    }
    // A white base: the target is mist air (0.58, 0.6, 0.62) times 1.2.
    const white = airColourUnder(MIST_ONLY, { r: 1, g: 1, b: 1 });
    expect(white.r).toBeCloseTo(0.848, 12);
    expect(white.g).toBeCloseTo(0.86, 12);
    expect(white.b).toBeCloseTo(0.872, 12);
  });

  it("desaturates by 0.9 of the cloud and never dims: the deck already darkens a cloudy dusk", () => {
    for (const base of BASES) {
      for (const cloudCover of [0.5, 0.8, 1]) {
        const air = airColourUnder({ ...CLEAR, cloudCover }, base);
        const expected = desaturateRgb(base, 0.9 * cloudCover);
        expect(air.r).toBeCloseTo(expected.r, 12);
        expect(air.g).toBeCloseTo(expected.g, 12);
        expect(air.b).toBeCloseTo(expected.b, 12);
        expect(luma(air)).toBeCloseTo(luma(base), 12);
      }
    }
  });

  it("greys toward its own luminance under rain, holding the luma", () => {
    for (const base of BASES) {
      const dry = airColourUnder({ ...RAIN, rain: 0 }, base);
      const wet = airColourUnder(RAIN, base);
      expect(luma(wet)).toBeCloseTo(luma(dry), 10);
      expect(spread(wet)).toBeCloseTo(0.7 * spread(dry), 10);
      const half = airColourUnder({ ...RAIN, rain: 0.5 }, base);
      expect(spread(half)).toBeCloseTo(0.85 * spread(dry), 10);
    }
  });

  it("pulls toward the dread air, greener and never brighter", () => {
    const DREAD_ONLY: WeatherParams = { ...CLEAR, dread: 1 };
    const greenShare = (c: Rgb) => c.g / (c.r + c.g + c.b);
    for (const base of BASES) {
      const pulled = airColourUnder(DREAD_ONLY, base);
      expect(pulled).not.toEqual(base);
      expect(luma(pulled)).toBeLessThanOrEqual(luma(base) + 1e-12);
    }
    expect(greenShare(airColourUnder(DREAD_ONLY, BASES[0]!))).toBeGreaterThan(greenShare(BASES[0]!));
    expect(greenShare(airColourUnder(DREAD_ONLY, BASES[2]!))).toBeGreaterThan(greenShare(BASES[2]!));
  });

  it("holds the air on a dread plateau while the lens keeps moving", () => {
    const a = { ...WEATHER_PRESETS.eerie, dread: 0.36 };
    const b = { ...WEATHER_PRESETS.eerie, dread: 0.42 };
    for (const base of BASES) expect(airColourUnder(a, base)).toEqual(airColourUnder(b, base));
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/weather.test.ts`
Expected: 35 passed, 7 failed, every failure in the new block with `TypeError: airColourUnder is not a function`.

- [ ] **Step 3: Write `airColourUnder`**

In `client/src/game/weather.ts`, insert immediately before the line `/** Babylon ShadowGenerator darkness: 0 = full shadows, 1 = invisible. */`:

```ts
/**
 * The colour of the air over a horizon colour from the sky (`skyState.ts`):
 * over the horizon away from the sun, the fog colour, the clear colour and the
 * far end of the haze gradient; over the horizon toward it, the haze's glow.
 * Nothing here dims a cloudy dusk: the sky's cloud deck already dims the base
 * with the light. In order: pulled toward mist air by mist, the target scaled
 * to the base's own luminance and capped at 1.2, so a dim dusk base is never
 * lit by a fixed bright grey; desaturated by cloud; greyed toward its own
 * luminance by rain; pulled toward the dread air without ever brightening. At
 * clear every step is an exact copy of the base.
 */
export function airColourUnder(w: WeatherParams, base: Rgb): Rgb {
  const c = clamp01(w.cloudCover);
  const lift = Math.min(1.2, luma(base) / luma(MIST_AIR));
  const air = { r: MIST_AIR.r * lift, g: MIST_AIR.g * lift, b: MIST_AIR.b * lift };
  const grey = desaturateRgb(mixRgb(base, air, 0.5 * clamp01(w.mist)), 0.9 * c);
  const r = clamp01(w.rain);
  const wet = r === 0 ? grey : mixRgb(grey, { r: luma(grey), g: luma(grey), b: luma(grey) }, FOG_RAIN_GREY * r);
  const d = dreadWorldUnder(w);
  if (d === 0) return wet;
  const dreadLift = Math.min(1, luma(wet) / luma(DREAD_AIR));
  const target = { r: DREAD_AIR.r * dreadLift, g: DREAD_AIR.g * dreadLift, b: DREAD_AIR.b * dreadLift };
  return mixRgb(wet, target, DREAD_FOG_PULL * d);
}

```

`fogColourUnder` and every other function stay: their callers move in Tasks 5–6.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run --root client test/game/weather.test.ts`
Expected: 42 passed.

- [ ] **Step 5: Export the night sky and the moonlight**

In `client/src/game/sky.ts`, replace

```ts
const NIGHT_SKY: Rgb = { r: 0.02, g: 0.03, b: 0.06 };
```

with

```ts
/**
 * The night sky's own colour. The scattering table is effectively black from
 * about 12 degrees below the horizon, so the dome adds this as its floor,
 * standing in for the moonlit night sky: weighted by the night factor, it
 * appears as the twilight fades, and midnight keeps the colour it has always
 * had (`skyState.ts`).
 */
export const NIGHT_SKY: Readonly<Rgb> = Object.freeze({ r: 0.02, g: 0.03, b: 0.06 });
```

and replace

```ts
/** A desaturated cool blue: moonlight, not the night sky's own near-black colour. */
const MOONLIGHT: Rgb = { r: 0.2, g: 0.26, b: 0.4 };
```

with

```ts
/**
 * A desaturated cool blue: moonlight, not the night sky's own near-black
 * colour. The fill's colour once the night factor has taken over from the
 * sky's light (`skyState.ts`).
 */
export const MOONLIGHT: Readonly<Rgb> = Object.freeze({ r: 0.2, g: 0.26, b: 0.4 });
```

`skyColourAt` and `ambientColourFor` pass both to `mixRgb`, which copies; nothing writes to them.

- [ ] **Step 6: Write the test fixture**

Create `client/test/game/helpers/skyFixture.ts`:

```ts
import { sunPositionAt } from "../../../src/game/sky.js";
import { SLICE_ALTITUDES_DEG } from "../../../src/game/skyModel.js";
import { buildSkyTableSync, NOON_ALTITUDE_DEG, sliceBracket, type SkyTable } from "../../../src/game/skyTable.js";

/** The hours the suite's sky tests read: night, sunrise, the morning, noon,
 * the afternoon, the run through sunset and twilight, and night again. */
export const SKY_FIXTURE_HOURS: readonly number[] = [0, 6, 8, 12, 15, 17, 18, 18.25, 18.5, 19, 21, 22];

let table: SkyTable | null = null;

/**
 * One table per test file, built once on first call with buildSkyTableSync:
 * the noon bracket plus the slices bracketing the sun's altitude at
 * SKY_FIXTURE_HOURS, as `sliceBracket` names them, so `has` is true at each.
 * These 17 slices take about 0.15 s; every slice would take more than twice
 * that in every file that reads the sky.
 */
export function skyFixture(): SkyTable {
  if (table === null) {
    const indices = new Set<number>(sliceBracket(NOON_ALTITUDE_DEG));
    for (const hour of SKY_FIXTURE_HOURS) {
      for (const index of sliceBracket((Math.asin(sunPositionAt(hour).y) * 180) / Math.PI)) indices.add(index);
    }
    table = buildSkyTableSync([...indices].sort((a, b) => a - b).map((index) => SLICE_ALTITUDES_DEG[index] as number));
  }
  return table;
}
```

- [ ] **Step 7: Write the failing test for the state**

Create `client/test/game/skyState.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { desaturateRgb, luma, type Rgb } from "../../src/game/colour.js";
import { MOONLIGHT, NIGHT_SKY, sunPositionAt, type Vec3 } from "../../src/game/sky.js";
import { AMBIENT_DESAT, WEATHER_PRESETS, airColourUnder, type WeatherParams } from "../../src/game/weather.js";
import {
  RING_ELEVATION_DEG, SKY_EYE_KM, SKY_GROUND_KM, SLICE_ALTITUDES_DEG, SLICE_AZIMUTHS, SLICE_ELEVATIONS, rowOfElevation,
  type SkySlice,
} from "../../src/game/skyModel.js";
import { buildSkyTableSync, NOON_ALTITUDE_DEG, type SkyTable } from "../../src/game/skyTable.js";
import {
  DECK_TAU, FILL_DAY_LUMA, GLOW_FULL_CONTRAST, GLOW_MIN_CONTRAST, GLOW_POWER_MAX, GLOW_POWER_MIN, MIST_HORIZON,
  NIGHT_YA_DAY, NIGHT_YA_NIGHT, SKY_GAMMA, SKY_IBL_SCALE, SKY_NOON_ZENITH_LUMINANCE, SUN_DISC_CAPTURE_MAX, SUN_DISC_COS,
  SUN_DISC_RADIANCE, SUN_DISC_VIEW_MAX, adaptationFor, captureEncode, deckRadiance, domeRadiance, fitGlow, levelLight,
  nightFactor, skyScale, skyStateFor, skyTableUv, sunUpFor, type SkyState,
} from "../../src/game/skyState.js";
import { skyFixture, SKY_FIXTURE_HOURS } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

const CLEAR = WEATHER_PRESETS.clear;
const MIST = WEATHER_PRESETS.mist;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const DEG = Math.PI / 180;

/** A slice with the given fields over a black sky. */
function slice(fields: Partial<SkySlice>): SkySlice {
  return {
    altitudeDeg: 30,
    texels: new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3),
    ring: new Float32Array(SLICE_AZIMUTHS * 3),
    zenith: { r: 0, g: 0, b: 0 },
    skyIrradiance: { r: 0, g: 0, b: 0 },
    sun: { r: 0, g: 0, b: 0 },
    ...fields,
  };
}

const grey = (v: number): Rgb => ({ r: v, g: v, b: v });

/** Direction at `elevationDeg`, `azimuth` radians round from the sun's azimuth. */
function around(s: SkyState, elevationDeg: number, azimuth: number): Vec3 {
  const e = elevationDeg * DEG;
  const g = s.glowDir;
  return {
    x: Math.cos(e) * (g.x * Math.cos(azimuth) - g.z * Math.sin(azimuth)),
    y: Math.sin(e),
    z: Math.cos(e) * (g.x * Math.sin(azimuth) + g.z * Math.cos(azimuth)),
  };
}

/** The largest per-channel difference, over the luma of `b`. */
function apart(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) / luma(b);
}

describe("the sky's constants", () => {
  it("keep the night sky and the moonlight they had, frozen", () => {
    expect(NIGHT_SKY).toEqual({ r: 0.02, g: 0.03, b: 0.06 });
    expect(MOONLIGHT).toEqual({ r: 0.2, g: 0.26, b: 0.4 });
    expect(Object.isFrozen(NIGHT_SKY)).toBe(true);
    expect(Object.isFrozen(MOONLIGHT)).toBe(true);
  });

  it("make the disc 0.27 degrees in radius with an irradiance of 1, and keep the day fill's luma", () => {
    expect(Math.acos(SUN_DISC_COS) / DEG).toBeCloseTo(0.27, 6);
    expect(SUN_DISC_RADIANCE * 2 * Math.PI * (1 - SUN_DISC_COS)).toBeCloseTo(1, 12);
    expect([SUN_DISC_CAPTURE_MAX, SUN_DISC_VIEW_MAX]).toEqual([1, 16]);
    expect(FILL_DAY_LUMA).toBe(0.5633);
    expect(luma({ r: 0.42, g: 0.58, b: 0.82 })).toBeCloseTo(0.5633, 4);
    expect(MIST_HORIZON).toBe(0.08);
    expect([GLOW_POWER_MIN, GLOW_POWER_MAX]).toEqual([1, 64]);
    expect(SKY_IBL_SCALE).toBe(1);
  });
});

describe("the pieces", () => {
  it("skyScale puts the noon zenith at 0.416", () => {
    expect(skyScale(slice({ zenith: grey(0.104) }))).toBeCloseTo(4, 12);
    expect(SKY_NOON_ZENITH_LUMINANCE).toBe(0.416);
  });

  it("levelLight is the sun on level ground plus the sky's light, and the sky's alone below the horizon", () => {
    const up = levelLight(slice({ altitudeDeg: 30, sun: { r: 1, g: 0.5, b: 0.25 }, skyIrradiance: { r: 0.1, g: 0.2, b: 0.3 } }));
    expect(up.r).toBeCloseTo(0.6, 12);
    expect(up.g).toBeCloseTo(0.45, 12);
    expect(up.b).toBeCloseTo(0.425, 12);
    const down = levelLight(slice({ altitudeDeg: -5, sun: { r: 1, g: 1, b: 1 }, skyIrradiance: { r: 0.1, g: 0.2, b: 0.3 } }));
    expect(down).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it("adaptationFor is 1 at noon's light, goes as its -1/2 power below, and stops at the floor", () => {
    expect(adaptationFor(1, 1)).toBe(1);
    expect(adaptationFor(0.25, 1)).toBeCloseTo(2, 12);
    expect(adaptationFor(2.5, 10)).toBeCloseTo(2, 12);
    expect(adaptationFor(0.01, 1)).toBeCloseTo(10, 12);
    expect(adaptationFor(0, 1) / 1e6).toBeCloseTo(1, 12);
    expect(SKY_GAMMA).toBe(0.5);
  });

  it("nightFactor is exactly 0 from NIGHT_YA_DAY up and exactly 1 from NIGHT_YA_NIGHT down, linear in the log between", () => {
    expect([NIGHT_YA_DAY, NIGHT_YA_NIGHT]).toEqual([0.1, 0.003]);
    expect(nightFactor(NIGHT_YA_DAY)).toBe(0);
    expect(nightFactor(1)).toBe(0);
    expect(nightFactor(NIGHT_YA_NIGHT)).toBe(1);
    expect(nightFactor(1e-4)).toBe(1);
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(Math.sqrt(NIGHT_YA_DAY * NIGHT_YA_NIGHT))).toBeCloseTo(0.5, 12);
    let previous = 0;
    for (let k = 1; k < 50; k++) {
      const n = nightFactor(NIGHT_YA_DAY * (NIGHT_YA_NIGHT / NIGHT_YA_DAY) ** (k / 50));
      expect(n).toBeGreaterThan(previous);
      previous = n;
    }
  });

  it("deckRadiance is the overcast law: the zenith overhead, a third of it at and below the horizon", () => {
    const zenith = { r: 3, g: 6, b: 9 };
    const at = (sinE: number) => {
      const c = deckRadiance(zenith, sinE);
      return [c.r, c.g, c.b].map((v) => Number(v.toFixed(12)));
    };
    expect(at(1)).toEqual([3, 6, 9]);
    expect(at(0.5)).toEqual([2, 4, 6]);
    expect(at(0)).toEqual([1, 2, 3]);
    expect(at(-0.5)).toEqual([1, 2, 3]);
  });

  it("sunUpFor fades the sun out over one disc diameter, ending where its ray meets the ground", () => {
    // From the eye's 200 m the horizon dips 0.4544 degrees.
    const dip = Math.acos(SKY_GROUND_KM / (SKY_GROUND_KM + SKY_EYE_KM));
    expect(dip / DEG).toBeCloseTo(0.4544, 4);
    expect(sunUpFor(0.1 * DEG)).toBe(1);
    expect(sunUpFor(-dip)).toBe(0);
    expect(sunUpFor(-0.46 * DEG)).toBe(0);
    expect(sunUpFor(-dip + 0.27 * DEG)).toBeCloseTo(0.5, 9);
    let previous = 1;
    for (let a = 0.1; a >= -0.46; a -= 0.01) {
      const up = sunUpFor(a * DEG);
      expect(up).toBeLessThanOrEqual(previous);
      previous = up;
    }
  });
});

describe("skyTableUv, the fragment stage's mapping transcribed", () => {
  const SUN: Vec3 = { x: Math.cos(0.3), y: Math.sin(0.3), z: 0 };

  it("lands on the texel centres at the zenith, the horizon either way and 90 degrees round", () => {
    expect(skyTableUv(UP, SUN)).toEqual([0.015625, 0.9921875]);
    expect(skyTableUv({ x: 1, y: 0, z: 0 }, SUN)).toEqual([0.015625, 0.5]);
    expect(skyTableUv({ x: -1, y: 0, z: 0 }, SUN)).toEqual([0.984375, 0.5]);
    // Mirror-symmetric about the sun's vertical plane.
    expect(skyTableUv({ x: 0, y: 0, z: 1 }, SUN)).toEqual([0.5, 0.5]);
    expect(skyTableUv({ x: 0, y: 0, z: -1 }, SUN)).toEqual([0.5, 0.5]);
  });

  it("measures the azimuth from the sun's, wherever the sun is", () => {
    const sun = sunPositionAt(17);
    const level = Math.hypot(sun.x, sun.z);
    expect(skyTableUv({ x: sun.x / level, y: 0, z: sun.z / level }, sun)).toEqual([0.015625, 0.5]);
  });

  it("maps the elevation by its root, as rowOfElevation does", () => {
    const e = Math.PI / 4;
    const [, v] = skyTableUv({ x: Math.cos(e), y: Math.sin(e), z: 0 }, SUN);
    // (0.5 + 0.5 sqrt(1/2)) on 64 texel centres.
    expect(v).toBeCloseTo(0.84802912, 8);
    for (const deg of [0.5, 2, 10, 30, 60, 89]) {
      const [, at] = skyTableUv({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG), z: 0 }, SUN);
      expect(at).toBeCloseTo((rowOfElevation(deg * DEG) * (SLICE_ELEVATIONS - 1) + 0.5) / SLICE_ELEVATIONS, 12);
    }
  });

  it("reads the horizon's row for every direction below the horizon", () => {
    const below = (deg: number, az: number): Vec3 => ({ x: Math.cos(deg * DEG) * Math.cos(az), y: Math.sin(deg * DEG), z: Math.cos(deg * DEG) * Math.sin(az) });
    expect(skyTableUv(below(-30, 1), SUN)).toEqual(skyTableUv(below(0, 1), SUN));
    expect(skyTableUv({ x: 0, y: -1, z: 0 }, SUN)).toEqual([0.015625, 0.5]);
  });
});

describe("clear noon keeps the anchors of the sky the table replaced", () => {
  it("the dome's zenith at 0.416, the sun at 4, the fill at 0.15, no night and no night floor", () => {
    const s = skyStateFor(skyFixture(), 12, CLEAR);
    expect(s.scale * luma(s.clear.zenith)).toBeCloseTo(0.416, 12);
    expect(s.nightFloor).toEqual({ r: 0, g: 0, b: 0 });
    // Straight up the stage reads the zenith texel at its centre, and the floor adds nothing by
    // day. The blended slice holds its texels in float32, so 7 places.
    expect(luma(domeRadiance(s, UP))).toBeCloseTo(0.416, 7);
    expect(s.adaptation).toBe(1);
    expect(s.night).toBe(0);
    expect(s.sunIntensity).toBe(4);
    expect(luma(s.sunColour)).toBeCloseTo(1, 12);
    expect(s.fillIntensity).toBe(0.15);
    expect(luma(s.fillColour)).toBeCloseTo(0.5633, 12);
    expect(s.cloud).toBe(0);
    expect(s.mistWeight).toBe(0);
  });
});

describe("midnight keeps the night it had", () => {
  it("the moonlight fill, the night sky overhead, no sun", () => {
    for (const w of [CLEAR, MIST, WEATHER_PRESETS.eerie]) {
      const s = skyStateFor(skyFixture(), 0, w);
      expect(s.night).toBe(1);
      expect(s.nightFloor).toEqual({ r: 0.02, g: 0.03, b: 0.06 });
      expect(s.fillIntensity).toBe(1.2);
      expect(s.fillColour).toEqual({ r: 0.2, g: 0.26, b: 0.4 });
      expect(s.sunIntensity).toBe(0);
      expect(s.discColour).toEqual({ r: 0, g: 0, b: 0 });
    }
    const s = skyStateFor(skyFixture(), 0, CLEAR);
    // What the table still holds at -18 degrees, adapted, is under a tenth of the night sky.
    const zenith = domeRadiance(s, UP);
    expect(Math.abs(zenith.r - 0.02)).toBeLessThan(0.002);
    expect(Math.abs(zenith.g - 0.03)).toBeLessThan(0.002);
    expect(Math.abs(zenith.b - 0.06)).toBeLessThan(0.002);
  });
});

describe("one sky for the dome, the fog and the glow", () => {
  const MISTLESS: WeatherParams[] = [CLEAR, { ...WEATHER_PRESETS.overcast, mist: 0 }, { ...WEATHER_PRESETS.rain, mist: 0 }];

  it("the horizon away from the sun is the dome's own, at the ring's elevation, 90 to 180 degrees round", () => {
    // The ring is the table's at exactly 2 degrees; the dome reads it between
    // the rows at 1.84 and 2.74 degrees, which moves a channel by a few per
    // cent of the luma at most where the horizon's colour bends fastest.
    for (const w of MISTLESS) {
      for (const hour of SKY_FIXTURE_HOURS) {
        const s = skyStateFor(skyFixture(), hour, w);
        let mean: Rgb = { r: 0, g: 0, b: 0 };
        for (let i = SLICE_AZIMUTHS / 2; i < SLICE_AZIMUTHS; i++) {
          const c = domeRadiance(s, around(s, RING_ELEVATION_DEG, (Math.PI * i) / (SLICE_AZIMUTHS - 1)));
          const k = 1 / (SLICE_AZIMUTHS / 2);
          mean = { r: mean.r + c.r * k, g: mean.g + c.g * k, b: mean.b + c.b * k };
        }
        expect(apart(mean, s.horizonAway), `hour ${hour}`).toBeLessThan(0.05);
      }
    }
  });

  it("the horizon toward the sun is the dome's own toward the sun's azimuth", () => {
    for (const w of MISTLESS) {
      for (const hour of SKY_FIXTURE_HOURS) {
        const s = skyStateFor(skyFixture(), hour, w);
        expect(apart(domeRadiance(s, around(s, RING_ELEVATION_DEG, 0)), s.horizonToward), `hour ${hour}`).toBeLessThan(0.05);
      }
    }
  });

  it("the fog's colour is the air over the horizon away from the sun, exactly that horizon at clear", () => {
    for (const hour of SKY_FIXTURE_HOURS) {
      const clear = skyStateFor(skyFixture(), hour, CLEAR);
      expect(clear.mistAir).toEqual(clear.horizonAway);
      const misty = skyStateFor(skyFixture(), hour, MIST);
      expect(misty.mistAir).toEqual(airColourUnder(MIST, misty.horizonAway));
    }
  });

  it("the glow points level, at the sun's azimuth", () => {
    for (const hour of [8, 15, 18]) {
      const s = skyStateFor(skyFixture(), hour, CLEAR);
      const level = Math.hypot(s.sunDir.x, s.sunDir.z);
      expect(s.glowDir.y).toBe(0);
      expect(s.glowDir.x).toBeCloseTo(s.sunDir.x / level, 12);
      expect(s.glowDir.z).toBeCloseTo(s.sunDir.z / level, 12);
    }
  });
});

describe("the dome, as the fragment stage computes it", () => {
  it("reads the horizon's colour below the horizon", () => {
    for (const hour of [12, 18, 18.5]) {
      const s = skyStateFor(skyFixture(), hour, MIST);
      for (const az of [0.4, 1.5, 2.9]) expect(domeRadiance(s, around(s, -30, az))).toEqual(domeRadiance(s, around(s, 0, az)));
    }
  });

  it("caps the disc in the probe's capture and nowhere else", () => {
    const s = skyStateFor(skyFixture(), 15, CLEAR);
    const noDisc = { ...s, discColour: { r: 0, g: 0, b: 0 } };
    const view = domeRadiance(s, s.sunDir);
    const capture = domeRadiance(s, s.sunDir, true);
    const sky = domeRadiance(noDisc, s.sunDir);
    expect(view.r - sky.r).toBeCloseTo(s.discColour.r, 9);
    expect(capture.r - sky.r).toBeCloseTo(Math.min(s.discColour.r, 1), 9);
    expect(capture.b - sky.b).toBeCloseTo(Math.min(s.discColour.b, 1), 9);
    // Off the disc the capture is the view.
    const off = around(s, 30, 2);
    expect(domeRadiance(s, off, true)).toEqual(domeRadiance(s, off));
  });

  it("writes the capture gamma-encoded, so a material decoding it by 2.2 reads the linear sky", () => {
    const encoded = captureEncode({ r: 1, g: 0.5, b: 4 });
    expect(encoded.r).toBe(1);
    expect(encoded.g).toBeCloseTo(0.72974, 5);
    expect(encoded.b).toBeCloseTo(1.87786, 5);
    const dim = captureEncode({ r: 0, g: -0.1, b: 0.04 });
    expect([dim.r, dim.g]).toEqual([0, 0]);
    expect(dim.b).toBeCloseTo(0.23151, 5);
    const s = skyStateFor(skyFixture(), 18, CLEAR);
    for (const d of [UP, s.sunDir, around(s, 2, 0), around(s, 10, 3)]) {
      const linear = domeRadiance(s, d, true);
      const decoded = captureEncode(linear);
      expect(decoded.r ** 2.2).toBeCloseTo(linear.r, 9);
      expect(decoded.g ** 2.2).toBeCloseTo(linear.g, 9);
      expect(decoded.b ** 2.2).toBeCloseTo(linear.b, 9);
    }
  });

  it("keeps the disc under half float's range in the view, its hue kept", () => {
    const s = skyStateFor(skyFixture(), 12, CLEAR);
    expect(Math.max(s.discColour.r, s.discColour.g, s.discColour.b)).toBeCloseTo(16, 9);
    const t = s.clear.sun;
    expect(s.discColour.g / s.discColour.r).toBeCloseTo(t.g / t.r, 9);
    expect(s.discColour.b / s.discColour.r).toBeCloseTo(t.b / t.r, 9);
  });

  it("blends into the fog colour at the horizon by the mist, and hardly at all overhead", () => {
    const s = skyStateFor(skyFixture(), 12, MIST);
    expect(domeRadiance(s, around(s, 0, 1))).toEqual(s.mistAir);
    const h = Math.exp(-1 / 0.08);
    const plain = domeRadiance({ ...s, mistWeight: 0 }, UP);
    expect(domeRadiance(s, UP).r).toBeCloseTo(plain.r + (s.mistAir.r - plain.r) * h, 12);
  });
});

describe("the cloud deck", () => {
  it("leaves the clear dome alone at no cloud", () => {
    for (const hour of [12, 18]) {
      const s = skyStateFor(skyFixture(), hour, CLEAR);
      const odd = { ...s, deckZenith: { r: 99, g: 99, b: 99 } };
      for (const d of [UP, around(s, 2, 0), around(s, 10, 2), around(s, 45, 3)]) expect(domeRadiance(odd, d)).toEqual(domeRadiance(s, d));
      const ring0 = { r: s.clear.ring[0]!, g: s.clear.ring[1]!, b: s.clear.ring[2]! };
      expect(s.horizonToward.r).toBeCloseTo(s.scale * ring0.r + s.nightFloor.r, 9);
      expect(s.horizonToward.b).toBeCloseTo(s.scale * ring0.b + s.nightFloor.b, 9);
    }
  });

  it("takes the disc and the glow away at full cloud", () => {
    for (const hour of [12, 15, 17, 18]) {
      const s = skyStateFor(skyFixture(), hour, WEATHER_PRESETS.rain);
      expect(s.cloud).toBe(1);
      expect(s.discColour).toEqual({ r: 0, g: 0, b: 0 });
      expect(s.glowWeight).toBe(0);
    }
  });

  it("follows the clear sky's light on level ground, desaturated, and dims with it toward dusk", () => {
    for (const hour of [8, 12, 15, 17, 18, 18.25]) {
      const s = skyStateFor(skyFixture(), hour, MIST);
      const light = levelLight(s.clear);
      const expected = luma(light) * DECK_TAU * (9 / (7 * Math.PI)) * s.scale;
      expect(luma(s.deckZenith) / expected).toBeCloseTo(1, 12);
      const hue = desaturateRgb(light, AMBIENT_DESAT);
      expect(s.deckZenith.g / s.deckZenith.r).toBeCloseTo(hue.g / hue.r, 9);
      expect(s.deckZenith.b / s.deckZenith.r).toBeCloseTo(hue.b / hue.r, 9);
    }
    const noon = skyStateFor(skyFixture(), 12, MIST);
    const dusk = skyStateFor(skyFixture(), 18, MIST);
    expect(luma(dusk.deckZenith)).toBeLessThan(0.2 * luma(noon.deckZenith));
  });

  it("gives noon in mist the old mist dome overhead, luma 0.80", () => {
    const s = skyStateFor(skyFixture(), 12, MIST);
    expect(Math.abs(luma(domeRadiance(s, UP)) - 0.8)).toBeLessThan(0.01);
  });
});

describe("the haze glow's fit", () => {
  /** A ring whose luma falls from `toward` to `away` as cos(phi)^power, level past 90 degrees. */
  function ring(power: number, away = 0.2, toward = 1): Rgb[] {
    const out: Rgb[] = [];
    for (let i = 0; i < SLICE_AZIMUTHS; i++) {
      const c = Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1));
      out.push(grey(i < SLICE_AZIMUTHS / 2 ? away + (toward - away) * c ** power : away));
    }
    return out;
  }

  it("recovers the power of a known fall-off at full weight", () => {
    for (const power of [2, 8, 32]) {
      const fit = fitGlow(ring(power), grey(0.2));
      expect(fit.weight).toBe(1);
      expect(fit.power).toBeCloseTo(power, 9);
    }
  });

  it("clamps the power to its range, and takes the largest when the ring cannot resolve the fall-off", () => {
    expect(fitGlow(ring(100), grey(0.2)).power).toBe(64);
    expect(fitGlow(ring(0.5), grey(0.2)).power).toBe(1);
    const spike = ring(8).map((c, i) => (i === 0 ? c : grey(0.2)));
    expect(fitGlow(spike, grey(0.2))).toEqual({ power: 64, weight: 1 });
  });

  it("has no glow at or below GLOW_MIN_CONTRAST, and fades in smoothly to full weight at GLOW_FULL_CONTRAST", () => {
    expect([GLOW_MIN_CONTRAST, GLOW_FULL_CONTRAST]).toEqual([1.05, 1.25]);
    expect(fitGlow(ring(8, 0.2, 0.2 * 1.04), grey(0.2))).toEqual({ power: 1, weight: 0 });
    expect(fitGlow(ring(8, 0.2, 0.2), grey(0.2))).toEqual({ power: 1, weight: 0 });
    expect(fitGlow(ring(8, 0.2, 0.2 * 1.15), grey(0.2)).weight).toBeCloseTo(0.5, 9);
    expect(fitGlow(ring(8, 0.2, 0.2 * 1.25), grey(0.2)).weight).toBeCloseTo(1, 9);
    expect(fitGlow(ring(8, 0.2, 0.3), grey(0.2)).weight).toBe(1);
    let previous = 0;
    for (let k = 1; k <= 20; k++) {
      const w = fitGlow(ring(8, 0.2, 0.2 * (1.05 + 0.01 * k)), grey(0.2)).weight;
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });
});

describe("18:00 under a clear sky", () => {
  it("keeps the zenith blue and turns the horizon toward the sun red", () => {
    const s = skyStateFor(skyFixture(), 18, CLEAR);
    const zenith = domeRadiance(s, UP);
    expect(zenith.b).toBeGreaterThan(zenith.r);
    expect(zenith.b).toBeGreaterThan(zenith.g);
    expect(s.horizonToward.r).toBeGreaterThan(s.horizonToward.g);
    expect(s.horizonToward.r).toBeGreaterThan(s.horizonToward.b);
    expect(s.glowWeight).toBeGreaterThan(0);
  });
});

describe("the night factor across the day", () => {
  it("is exactly 0 through the day and exactly 1 through the night", () => {
    for (const hour of [8, 12, 15, 17]) expect(skyStateFor(skyFixture(), hour, CLEAR).night).toBe(0);
    for (const hour of [19, 21, 22, 0]) expect(skyStateFor(skyFixture(), hour, CLEAR).night).toBe(1);
    const dusk = skyStateFor(skyFixture(), 18.25, CLEAR).night;
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("brings the night floor in with it: none by day, the night sky at night, between in the twilight", () => {
    expect(skyStateFor(skyFixture(), 15, CLEAR).nightFloor).toEqual({ r: 0, g: 0, b: 0 });
    expect(skyStateFor(skyFixture(), 21, CLEAR).nightFloor).toEqual({ r: 0.02, g: 0.03, b: 0.06 });
    const twilight = skyStateFor(skyFixture(), 18.25, CLEAR);
    for (const [k, full] of [["r", 0.02], ["g", 0.03], ["b", 0.06]] as const) {
      expect(twilight.nightFloor[k]).toBeGreaterThan(0);
      expect(twilight.nightFloor[k]).toBeLessThan(full);
      expect(twilight.nightFloor[k]).toBeCloseTo(full * twilight.night, 12);
    }
  });
});

describe("continuity through dusk", () => {
  let table: SkyTable;
  // Every slice from -18 to 16 degrees, as the game holds them, and the noon bracket.
  beforeAll(() => {
    table = buildSkyTableSync(SLICE_ALTITUDES_DEG.filter((a) => a <= 16 || a >= 74));
  }, timeLimit(60_000));

  const scaled = (c: Rgb, k: number): Rgb => ({ r: c.r * k, g: c.g * k, b: c.b * k });
  const channels = (name: string, f: (s: SkyState) => Rgb): [string, (s: SkyState) => number][] =>
    (["r", "g", "b"] as const).map((k) => [`${name}.${k}`, (s: SkyState) => f(s)[k]]);
  /** Every value the state hands a consumer: the lights as their colour times their
   * intensity (a colour at zero intensity is not seen), and the glow as its lobe at
   * three angles, weight times cos^power. */
  const VALUES: [string, (s: SkyState) => number][] = [
    ["night", (s) => s.night],
    ["sunIntensity", (s) => s.sunIntensity],
    ["fillIntensity", (s) => s.fillIntensity],
    ["glowWeight", (s) => s.glowWeight],
    ...[10, 30, 60].map((deg): [string, (s: SkyState) => number] => [`glow${deg}`, (s) => s.glowWeight * Math.cos(deg * DEG) ** s.glowPower]),
    ...channels("zenith", (s) => domeRadiance(s, UP)),
    ...channels("horizonAway", (s) => s.horizonAway),
    ...channels("horizonToward", (s) => s.horizonToward),
    ...channels("mistAir", (s) => s.mistAir),
    ...channels("deckZenith", (s) => s.deckZenith),
    ...channels("discColour", (s) => s.discColour),
    ...channels("sunLight", (s) => scaled(s.sunColour, s.sunIntensity)),
    ...channels("fillLight", (s) => scaled(s.fillColour, s.fillIntensity)),
  ];

  /**
   * The sun's altitude moves at most 0.146 degrees in 0.01 h (its arc's 15
   * degrees an hour, at the horizon), so a step crosses at most one slice
   * boundary. Between boundaries every value is a smooth function of a slice
   * blended linearly in the altitude, so a step differs from the steps either
   * side only by how the slope bends at a boundary. The table's light falls
   * by under 1.5 decades a degree wherever night is not complete (the next
   * test checks it): an adapted value, which goes as its square root, bends
   * by a factor under 2.4 across a 0.5 degree slice. A step more than 3 times
   * both its neighbours, beyond 0.5 % of the value's largest magnitude over
   * the sweep (below anything the eye sees), is a jump.
   */
  it("steps no value by more than 3 times its neighbouring steps, from 17:00 to 19:30 every 0.01 h, under every preset", () => {
    for (const name of ["clear", "overcast", "mist", "rain", "eerie"] as const) {
      const states: SkyState[] = [];
      for (let k = 0; k <= 250; k++) states.push(skyStateFor(table, 17 + k * 0.01, WEATHER_PRESETS[name]));
      for (const [key, value] of VALUES) {
        const v = states.map(value);
        for (const x of v) expect(Number.isFinite(x), `${name} ${key}`).toBe(true);
        const steps = v.slice(1).map((x, i) => Math.abs(x - (v[i] as number)));
        const floor = 0.005 * Math.max(...v.map(Math.abs));
        steps.forEach((step, k) => {
          const neighbours = Math.max(steps[k - 1] ?? 0, steps[k + 1] ?? 0);
          expect(step, `${name} ${key} at ${(17.01 + 0.01 * k).toFixed(2)}`).toBeLessThanOrEqual(3 * neighbours + floor);
        });
      }
    }
  });

  /**
   * The night factor is linear in log10 of the adapted light over
   * log10(NIGHT_YA_DAY / NIGHT_YA_NIGHT) = 1.52 decades; the adapted light goes
   * as the level light's SKY_GAMMA power, and the level light falls by under
   * 1.5 decades a degree wherever the night is not complete (checked here), so
   * n moves at most 0.5 x 1.5 x 0.146 / 1.52 = 0.072 a step.
   */
  it("moves the night factor by at most 0.072 a step", () => {
    const yNoon = luma(levelLight(table.blendAt(NOON_ALTITUDE_DEG)));
    let previous = luma(levelLight(table.blendAt(16)));
    for (let a = 15.95; a >= -18; a -= 0.05) {
      const y = luma(levelLight(table.blendAt(a)));
      if ((y / yNoon) ** SKY_GAMMA > NIGHT_YA_NIGHT) expect((Math.log10(previous) - Math.log10(y)) / 0.05).toBeLessThan(1.5);
      previous = y;
    }
    for (const name of ["clear", "mist", "eerie"] as const) {
      let n = skyStateFor(table, 17, WEATHER_PRESETS[name]).night;
      for (let k = 1; k <= 250; k++) {
        const next = skyStateFor(table, 17 + k * 0.01, WEATHER_PRESETS[name]).night;
        expect(Math.abs(next - n)).toBeLessThanOrEqual(0.072);
        n = next;
      }
    }
  });
});
```

- [ ] **Step 8: Run it and see it fail**

Run: `npx vitest run --root client test/game/skyState.test.ts`
Expected: FAIL, no tests run: `Error: Cannot find module '../../src/game/skyState.js' imported from …/client/test/game/skyState.test.ts`.

- [ ] **Step 9: Write the state**

Create `client/src/game/skyState.ts` (`DECK_TAU` is written as 1 here and calibrated in Step 11):

```ts
/**
 * The sky's state at one hour under one weather: every light, colour and
 * weight that the dome, the image-based light, the sun, the fill, the fog and
 * the haze read, from one blended slice of the scattering table
 * (`skyTable.ts`). One state feeds them all, so the fog's far colour is the
 * dome's horizon and the haze's glow is the dome's own glow toward the sun:
 * they cannot disagree.
 *
 * Pure and Babylon-free; `lighting.ts`, `skyDome.ts` and `atmosphereParams.ts`
 * are the shells that apply it. `domeRadiance`, `skyTableUv` and
 * `deckRadiance` transcribe the dome's fragment stage
 * (`shaders/skyDome.fragment.fx`) step for step, and a lockstep test holds the
 * stage's constants to the ones here.
 */
import { clamp01, desaturateRgb, luma, mixRgb, type Rgb } from "./colour.js";
import { FILL_DAY, FILL_NIGHT, MOONLIGHT, NIGHT_SKY, SUN_PEAK, sunPositionAt, type Vec3 } from "./sky.js";
import { AMBIENT_DESAT, FILL_LIFT, SUN_CLOUD_LOSS, SUN_DESAT, airColourUnder, type WeatherParams } from "./weather.js";
import {
  RING_ELEVATION_DEG, SKY_EYE_KM, SKY_GROUND_KM, SLICE_AZIMUTHS, SLICE_ELEVATIONS, type SkySlice,
} from "./skyModel.js";
import { NOON_ALTITUDE_DEG, type SkyTable } from "./skyTable.js";

/** The zenith at clear noon of the sky the table replaced (Babylon's
 * SkyMaterial), linear Rec. 709 luma. The scale K puts the table's noon
 * zenith here, so noon keeps its look. */
export const SKY_NOON_ZENITH_LUMINANCE = 0.416;
/** The adaptation's exponent. Every light the sky gives is multiplied by
 * (Y / Y_noon)^(SKY_GAMMA - 1), so the scene's brightness goes as
 * (Y / Y_noon)^SKY_GAMMA: at 0.5, sunset reads about a quarter of noon. */
export const SKY_GAMMA = 0.5;
/** The floor on Y / Y_noon under the adaptation's power: below it the table
 * is black and the factor stops growing. */
export const SKY_Y_FLOOR = 1e-12;
/** Adapted light at and above which the night factor is exactly 0. */
export const NIGHT_YA_DAY = 0.1;
/** Adapted light at and below which the night factor is exactly 1. */
export const NIGHT_YA_NIGHT = 0.003;
/** The cloud deck's transmission: its zenith is DECK_TAU times the zenith an
 * overcast sky has over the clear sky's light on level ground. Set so the
 * dome's zenith at noon in mist (cloud 0.9) has a luma of 0.80, the noon mist
 * dome of the sky the table replaced. */
export const DECK_TAU = 1;
/** Scale, in the sine of the elevation, of the mist's blend toward the fog
 * colour at the horizon. Mist is the one part of the air the table does not
 * hold, so with this blend the dome meets the fog without a band. */
export const MIST_HORIZON = 0.08;
/** The sun's angular radius, radians: 0.27 degrees. */
const SUN_RADIUS = (0.27 * Math.PI) / 180;
/** The cosine of the sun's angular radius: a direction this close to the sun
 * is on its disc. */
export const SUN_DISC_COS = Math.cos(SUN_RADIUS);
/** The radiance of a disc of that size whose irradiance is 1: one over its
 * solid angle. */
export const SUN_DISC_RADIANCE = 1 / (2 * Math.PI * (1 - SUN_DISC_COS));
/** The disc's cap per channel in the probe's capture, so a few texels of HDR
 * sun do not sparkle in rough reflections. */
export const SUN_DISC_CAPTURE_MAX = 1;
/** The image-based light's share relative to the dome's own radiance: 1 is
 * coherent with the dome. The checks by eye may lower it if noon's shadows
 * read brighter than they did, since the image-based light before the table
 * was the sky raised to 2.2 (a linear sky in a probe read as gamma). Lighting
 * sets the environment intensity to the dread's ambient collapse times this. */
export const SKY_IBL_SCALE = 1;
/** The disc's largest channel in the view, its hue kept. Its own radiance is
 * of the order of 10^5 in scene units by day, past half float's largest value
 * (65504): the scene's half-float target would hold infinity, and the post
 * chain's blurs would spread it. 16 is past white under either tone map at
 * every exposure the game uses. */
export const SUN_DISC_VIEW_MAX = 16;
/** The luma of the day sky colour the fill took before the table, (0.42,
 * 0.58, 0.82): the fill's day colour keeps it. */
export const FILL_DAY_LUMA = 0.5633;
/** The haze glow's power range. */
export const GLOW_POWER_MIN = 1;
export const GLOW_POWER_MAX = 64;
/** The horizon's luma toward the sun over its mean away from it, at and below
 * which there is no glow. */
export const GLOW_MIN_CONTRAST = 1.05;
/** The same ratio at and above which the glow has its full weight. */
export const GLOW_FULL_CONTRAST = 1.25;

export type SkyState = {
  hour: number;
  /** Radians: asin(sunPositionAt(hour).y). */
  altitude: number;
  /** sunPositionAt(hour). */
  sunDir: Vec3;
  /** K * A: the table's units to the scene's, adapted. */
  scale: number;
  /** A. */
  adaptation: number;
  /** n: 0 by day, 1 at night. */
  night: number;
  /** clamp01(cloudCover). */
  cloud: number;
  /** NIGHT_SKY times the night factor: the dome's floor, which stands in for
   * the moonlit night sky and appears as the twilight fades. Nothing by day,
   * so clear noon's zenith is the table's alone. */
  nightFloor: Rgb;
  /** The clear sky's slice at the sun's altitude, unscaled. */
  clear: SkySlice;
  /** The cloud deck's zenith, scene units. */
  deckZenith: Rgb;
  /** The fog colour and the clear colour: the air over the horizon away from the sun. */
  mistAir: Rgb;
  /** clamp01(mist): the weight of the dome's blend toward mistAir at the horizon. */
  mistWeight: number;
  /** The sun light's colour, luma 1, desaturated by cloud. */
  sunColour: Rgb;
  sunIntensity: number;
  /** The disc's radiance in the view, scene units. */
  discColour: Rgb;
  fillColour: Rgb;
  /** Before the dread's ambient collapse, which lighting applies. */
  fillIntensity: number;
  /** The dome's horizon away from the sun at RING_ELEVATION_DEG, scene units. */
  horizonAway: Rgb;
  /** The dome's horizon toward the sun at RING_ELEVATION_DEG, scene units. */
  horizonToward: Rgb;
  /** Unit and level: toward the sun's azimuth. */
  glowDir: Vec3;
  glowPower: number;
  glowWeight: number;
};

/** The overcast law's zenith luminance per unit of ground illuminance:
 * L_z = E / (7 pi / 9). */
const DECK_ZENITH_PER_LIGHT = 9 / (7 * Math.PI);
/** The first column of the ring's half away from the sun: past 90 degrees. */
const AWAY_FIRST = SLICE_AZIMUTHS / 2;
/** The last column the glow's fit reads, short of 90 degrees. */
const GLOW_LAST = AWAY_FIRST - 1;
const DEG = Math.PI / 180;
/** How far below level the eye's horizon lies, radians: a ray from SKY_EYE_KM
 * at this depression grazes the ground, and below it the sun's transmittance
 * is 0. */
const HORIZON_DIP = Math.acos(SKY_GROUND_KM / (SKY_GROUND_KM + SKY_EYE_KM));

function scaled(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

function added(a: Rgb, b: Rgb): Rgb {
  return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b };
}

/** Texel `i` of an RGB array. */
function texel(data: Float32Array, i: number): Rgb {
  return { r: data[i * 3] ?? 0, g: data[i * 3 + 1] ?? 0, b: data[i * 3 + 2] ?? 0 };
}

function smoothstep01(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}

/** K: the table's units to the scene's, so the noon zenith has the luma
 * SKY_NOON_ZENITH_LUMINANCE. */
export function skyScale(noon: SkySlice): number {
  return SKY_NOON_ZENITH_LUMINANCE / luma(noon.zenith);
}

/** The clear sky's light on level ground, sun and sky together, per unit of
 * solar irradiance. */
export function levelLight(s: SkySlice): Rgb {
  return added(scaled(s.sun, Math.max(Math.sin(s.altitudeDeg * DEG), 0)), s.skyIrradiance);
}

/** A: the factor every light the sky gives is multiplied by, standing in for
 * the eye adjusting. 1 at noon, growing as the light falls. */
export function adaptationFor(y: number, yNoon: number): number {
  return Math.pow(Math.max(y / yNoon, SKY_Y_FLOOR), SKY_GAMMA - 1);
}

/** n from the adapted light: exactly 0 at and above NIGHT_YA_DAY, exactly 1 at
 * and below NIGHT_YA_NIGHT, linear in the logarithm between. */
export function nightFactor(adapted: number): number {
  if (adapted >= NIGHT_YA_DAY) return 0;
  const day = Math.log10(NIGHT_YA_DAY);
  return clamp01((day - Math.log10(Math.max(adapted, 1e-12))) / (day - Math.log10(NIGHT_YA_NIGHT)));
}

/** The CIE overcast sky: brightest at the zenith, a third of it at the horizon. */
export function deckRadiance(zenith: Rgb, sinElevation: number): Rgb {
  return scaled(zenith, (1 + 2 * Math.max(sinElevation, 0)) / 3);
}

/** How much of the sun is still up: 1 until its centre is one disc diameter
 * above the horizon's dip, 0 at the dip, smooth between. The disc and the
 * light it casts fade out as it sets; on the transmittance alone they would
 * stay until the ray met the ground and then drop at once. */
export function sunUpFor(altitude: number): number {
  return smoothstep01((altitude + HORIZON_DIP) / (2 * SUN_RADIUS));
}

/**
 * The table texture's coordinates for direction `d`: the azimuth from the
 * sun's across (0 to 180 degrees, mirrored), the elevation's root mapping up,
 * each on texel centres. The elevation is clamped at the horizon: below it a
 * slice holds only the air's own scattered light, which is dim and grey,
 * where the dome has always shown the horizon's colour down to the ground.
 * The fragment stage's `skyTableUv`, transcribed.
 */
export function skyTableUv(d: Vec3, sunDir: Vec3): [number, number] {
  const hl = Math.hypot(d.x, d.z);
  const sl = Math.hypot(sunDir.x, sunDir.z);
  const c = hl > 1e-6 && sl > 1e-6 ? Math.min(1, Math.max(-1, (d.x * sunDir.x + d.z * sunDir.z) / (hl * sl))) : 1;
  const u = Math.acos(c) / Math.PI;
  const e = Math.asin(Math.min(1, Math.max(0, d.y)));
  const v = 0.5 + 0.5 * Math.sign(e) * Math.sqrt(Math.abs(e) / (0.5 * Math.PI));
  return [
    (u * (SLICE_AZIMUTHS - 1) + 0.5) / SLICE_AZIMUTHS,
    (v * (SLICE_ELEVATIONS - 1) + 0.5) / SLICE_ELEVATIONS,
  ];
}

/** The slice's texels read as the GPU reads them: bilinear between texel
 * centres, clamped at the edges. */
function bilinear(texels: Float32Array, u: number, v: number): Rgb {
  const x = Math.min(Math.max(u * SLICE_AZIMUTHS - 0.5, 0), SLICE_AZIMUTHS - 1);
  const y = Math.min(Math.max(v * SLICE_ELEVATIONS - 0.5, 0), SLICE_ELEVATIONS - 1);
  const x0 = Math.min(Math.floor(x), SLICE_AZIMUTHS - 2);
  const y0 = Math.min(Math.floor(y), SLICE_ELEVATIONS - 2);
  const row = (j: number): Rgb =>
    mixRgb(texel(texels, j * SLICE_AZIMUTHS + x0), texel(texels, j * SLICE_AZIMUTHS + x0 + 1), x - x0);
  return mixRgb(row(y0), row(y0 + 1), y - y0);
}

/**
 * The dome's colour in direction `d` (unit, y up) as the fragment stage
 * computes it: the clear table scaled, mixed toward the deck by the cloud, the
 * night floor (`nightFloor`) added, then the disc (capped in the probe's capture), then the
 * mist's blend toward the fog colour at the horizon. Linear: before the low
 * tier's tone map, which only the stage applies, and, with `capture`, the
 * radiance the probe's materials decode from what the stage writes
 * (`captureEncode`).
 */
export function domeRadiance(s: SkyState, d: Vec3, capture = false): Rgb {
  const [u, v] = skyTableUv(d, s.sunDir);
  let L = scaled(bilinear(s.clear.texels, u, v), s.scale);
  L = mixRgb(L, deckRadiance(s.deckZenith, d.y), s.cloud);
  L = added(L, s.nightFloor);
  if (d.x * s.sunDir.x + d.y * s.sunDir.y + d.z * s.sunDir.z >= SUN_DISC_COS) {
    const disc = s.discColour;
    L = added(L, capture
      ? {
        r: Math.min(disc.r, SUN_DISC_CAPTURE_MAX),
        g: Math.min(disc.g, SUN_DISC_CAPTURE_MAX),
        b: Math.min(disc.b, SUN_DISC_CAPTURE_MAX),
      }
      : disc);
  }
  const h = s.mistWeight * Math.exp(-Math.max(d.y, 0) / MIST_HORIZON);
  return mixRgb(L, s.mistAir, h);
}

/** What the stage writes in the probe's capture for a linear colour: each
 * channel raised to 1/2.2, the inverse of the 2.2 every material that reads
 * the gamma-flagged probe raises it to. */
export function captureEncode(c: Rgb): Rgb {
  const encode = (x: number): number => Math.pow(Math.max(x, 0), 1 / 2.2);
  return { r: encode(c.r), g: encode(c.g), b: encode(c.b) };
}

/**
 * The haze glow's power and weight, from the ring in scene units (column i at
 * azimuth pi i / (SLICE_AZIMUTHS - 1) from the sun's) and its mean away from
 * the sun.
 *
 * The weight is 0 until the horizon toward the sun is GLOW_MIN_CONTRAST times
 * as bright as away and rises smoothly to 1 at GLOW_FULL_CONTRAST, so the
 * glow fades in and out with the hour rather than switching. The power is the
 * slope, through the origin, of ln r on ln cos(phi) over the columns short of
 * 90 degrees, where r is each column's luma between the away mean (0) and the
 * column toward the sun (1): the power of cos(phi) that the horizon's
 * fall-off follows. Each column counts by r (1 - r), so it enters and leaves
 * the fit smoothly as it nears either end and the power never steps between
 * adjacent hours. GLOW_POWER_MAX when no column lies between the ends: the
 * fall-off is sharper than the ring resolves.
 */
export function fitGlow(ring: readonly Rgb[], away: Rgb): { power: number; weight: number } {
  const la = luma(away);
  const toward = ring[0];
  const lt = toward === undefined ? 0 : luma(toward);
  if (!(lt > GLOW_MIN_CONTRAST * la)) return { power: GLOW_POWER_MIN, weight: 0 };
  const weight = smoothstep01((lt - GLOW_MIN_CONTRAST * la) / ((GLOW_FULL_CONTRAST - GLOW_MIN_CONTRAST) * la));
  const span = lt - la;
  let xy = 0;
  let xx = 0;
  for (let i = 1; i <= GLOW_LAST; i++) {
    const column = ring[i];
    if (column === undefined) continue;
    const r = (luma(column) - la) / span;
    if (!(r > 0 && r < 1)) continue;
    const x = Math.log(Math.cos((Math.PI * i) / (SLICE_AZIMUTHS - 1)));
    const k = r * (1 - r);
    xy += k * x * Math.log(r);
    xx += k * x * x;
  }
  if (!(xx > 0)) return { power: GLOW_POWER_MAX, weight };
  return { power: Math.min(GLOW_POWER_MAX, Math.max(GLOW_POWER_MIN, xy / xx)), weight };
}

/**
 * The sky's state at `hour` under `w`. The table is to hold the noon bracket
 * and the slices at or bracketing the sun's altitude (`table.has`); short of
 * that, the nearest held slices stand in.
 */
export function skyStateFor(table: SkyTable, hour: number, w: WeatherParams): SkyState {
  const sunDir = sunPositionAt(hour);
  const altitude = Math.asin(sunDir.y);
  const noon = table.blendAt(NOON_ALTITUDE_DEG);
  // The same expression as NOON_ALTITUDE_DEG's, so noon blends the same slice
  // twice and its anchors hold exactly.
  const clear = table.blendAt((altitude * 180) / Math.PI);

  const K = skyScale(noon);
  const yNoon = luma(levelLight(noon));
  const light = levelLight(clear);
  const y = luma(light);
  const adaptation = adaptationFor(y, yNoon);
  const scale = K * adaptation;
  const adapted = (y / yNoon) * adaptation;
  const night = nightFactor(adapted);
  const cloud = clamp01(w.cloudCover);
  const nightFloor = scaled(NIGHT_SKY, night);

  const deckZenith = scaled(desaturateRgb(light, AMBIENT_DESAT), DECK_TAU * DECK_ZENITH_PER_LIGHT * scale);
  const ringDeck = deckRadiance(deckZenith, Math.sin(RING_ELEVATION_DEG * DEG));
  const ring: Rgb[] = [];
  for (let i = 0; i < SLICE_AZIMUTHS; i++) {
    ring.push(added(mixRgb(scaled(texel(clear.ring, i), scale), ringDeck, cloud), nightFloor));
  }
  let sum: Rgb = { r: 0, g: 0, b: 0 };
  for (let i = AWAY_FIRST; i < SLICE_AZIMUTHS; i++) sum = added(sum, ring[i] ?? nightFloor);
  const horizonAway = scaled(sum, 1 / (SLICE_AZIMUTHS - AWAY_FIRST));
  const horizonToward = ring[0] ?? horizonAway;
  const glow = fitGlow(ring, horizonAway);
  const level = Math.hypot(sunDir.x, sunDir.z);
  const glowDir: Vec3 = level > 0 ? { x: sunDir.x / level, y: 0, z: sunDir.z / level } : { x: 1, y: 0, z: 0 };

  const sun = clear.sun;
  const sunLuma = luma(sun);
  const sunHue = sunLuma > 0 ? scaled(sun, 1 / sunLuma) : { r: 1, g: 1, b: 1 };
  const up = sunUpFor(altitude);
  const sunIntensity = SUN_PEAK * (sunLuma / luma(noon.sun)) * adaptation * (1 - SUN_CLOUD_LOSS * cloud) * up;
  const disc = scaled(sun, SUN_DISC_RADIANCE * scale);
  const discPeak = Math.max(disc.r, disc.g, disc.b);
  const discCap = discPeak > SUN_DISC_VIEW_MAX ? SUN_DISC_VIEW_MAX / discPeak : 1;
  const discColour = scaled(disc, discCap * (1 - cloud) * up);

  const irradiance = clear.skyIrradiance;
  const irradianceLuma = luma(irradiance);
  const skyHue = irradianceLuma > 0 ? scaled(irradiance, 1 / irradianceLuma) : scaled(MOONLIGHT, 1 / luma(MOONLIGHT));
  const skyFill = scaled(desaturateRgb(skyHue, AMBIENT_DESAT * cloud), FILL_DAY_LUMA);
  const day = FILL_DAY * adapted * (1 + FILL_LIFT * cloud) * (1 - night);
  const moon = FILL_NIGHT * night;
  const fillIntensity = day + moon;
  // Each end exact: the day colour alone by day, the moonlight alone at night.
  const fillColour = moon === 0
    ? skyFill
    : day === 0
      ? { ...MOONLIGHT }
      : scaled(added(scaled(skyFill, day), scaled(MOONLIGHT, moon)), 1 / fillIntensity);

  return {
    hour,
    altitude,
    sunDir,
    scale,
    adaptation,
    night,
    cloud,
    nightFloor,
    clear,
    deckZenith,
    mistAir: airColourUnder(w, horizonAway),
    mistWeight: clamp01(w.mist),
    sunColour: desaturateRgb(sunHue, SUN_DESAT * cloud),
    sunIntensity,
    discColour,
    fillColour,
    fillIntensity,
    horizonAway,
    horizonToward,
    glowDir,
    glowPower: glow.power,
    glowWeight: glow.weight,
  };
}
```

- [ ] **Step 10: Run the tests: all but the mist dome's pass**

Run: `npx vitest run --root client test/game/skyState.test.ts`
Expected: 34 passed, 1 failed: `the cloud deck > gives noon in mist the old mist dome overhead, luma 0.80`, with `AssertionError: expected 3.9874… to be less than 0.01` (the figure depends on the model; anything far from 0 is the uncalibrated deck).

- [ ] **Step 11: Calibrate `DECK_TAU`**

Write the calibration script to the git-ignored `.superpowers/` directory (it is never committed):

```bash
mkdir -p .superpowers && cat > .superpowers/calibrate-deck.ts <<'EOF'
import { luma } from "../client/src/game/colour.ts";
import { WEATHER_PRESETS } from "../client/src/game/weather.ts";
import { SLICE_ALTITUDES_DEG } from "../client/src/game/skyModel.ts";
import { buildSkyTableSync, NOON_ALTITUDE_DEG, sliceBracket } from "../client/src/game/skyTable.ts";
import { DECK_TAU, domeRadiance, skyStateFor } from "../client/src/game/skyState.ts";

// Noon needs only its bracket.
const table = buildSkyTableSync(sliceBracket(NOON_ALTITUDE_DEG).map((i) => SLICE_ALTITUDES_DEG[i] as number));
const state = skyStateFor(table, 12, WEATHER_PRESETS.mist);
const UP = { x: 0, y: 1, z: 0 };

// The deck's zenith is proportional to the transmission. Nothing else in the
// state straight up depends on it but the mist's horizon blend, which is
// e^-12.5 of the way to the fog colour there.
function zenithLumaAt(tau: number): number {
  const k = tau / DECK_TAU;
  const deckZenith = { r: state.deckZenith.r * k, g: state.deckZenith.g * k, b: state.deckZenith.b * k };
  return luma(domeRadiance({ ...state, deckZenith }, UP));
}

let lo = 0;
let hi = 4;
for (let i = 0; i < 60; i++) {
  const mid = (lo + hi) / 2;
  if (zenithLumaAt(mid) < 0.8) lo = mid;
  else hi = mid;
}
const tau = Number(lo.toFixed(4));
console.log("DECK_TAU = " + String(tau) + ": the dome's zenith at noon in mist has luma " + zenithLumaAt(tau).toFixed(4));
EOF
npx tsx .superpowers/calibrate-deck.ts
```

Expected: one line, `DECK_TAU = 0.1598: the dome's zenith at noon in mist has luma 0.8000` (the script gives the same answer whatever `DECK_TAU` holds when it runs). In `client/src/game/skyState.ts` replace `export const DECK_TAU = 1;` with the printed value: `export const DECK_TAU = 0.1598;` (if the script prints another value, write that one; the test pins the property, not the number). Then `rm .superpowers/calibrate-deck.ts`.

- [ ] **Step 12: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/skyState.test.ts test/game/weather.test.ts`
Expected: 77 passed (35 and 42).

- [ ] **Step 13: Hold the state to the Babylon-free list**

In `client/test/architecture.test.ts`, in `BABYLON_FREE_FILES`, replace

```ts
      join(SRC, "game", "skyWorker.ts"),
    ];
```

with

```ts
      join(SRC, "game", "skyWorker.ts"),
      join(SRC, "game", "skyState.ts"),
    ];
```

Run: `npx vitest run --root client test/architecture.test.ts`
Expected: every test passes (`skyState.ts` exists and imports nothing from `@babylonjs`; the new test file's one limit goes through `timeLimit`, and nothing reads a clock).

- [ ] **Step 14: Typecheck and lint**

Run: `npx tsc -p client --noEmit` — expected: no output.
Run: `npx eslint client/src/game/skyState.ts client/src/game/weather.ts client/src/game/sky.ts client/test/game/skyState.test.ts client/test/game/weather.test.ts client/test/game/helpers/skyFixture.ts client/test/architecture.test.ts` — expected: no output.

- [ ] **Step 15: Commit**

```bash
git add client/src/game/skyState.ts client/src/game/weather.ts client/src/game/sky.ts client/test/game/skyState.test.ts client/test/game/weather.test.ts client/test/game/helpers/skyFixture.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: one sky state for the dome, the light, the fog and the glow

## What

Every value the scene reads from the sky now comes from one state, made
from the scattering table's slice at the sun's altitude, the hour and
the weather: the scale to the scene's units and an adaptation standing
in for the eye, the night factor, the cloud deck, the sun's light and
disc, the fill, the horizon toward and away from the sun, and the haze
glow's direction, power and weight. The dome's colour in any direction
is transcribed from its fragment stage, so the fog's colour is the
dome's own horizon. The night sky's colour is the dome's floor, coming
in with the night factor as the twilight fades. Clear noon keeps the
old zenith, sun and fill, and midnight the old moonlight and night sky. The weather's air over a
horizon colour keeps the fog colour's steps but no longer dims a cloudy
dusk, which the deck now does. Nothing reads the state yet.

## How

- `client/src/game/skyState.ts` — the state, the dome's composition and
  table coordinates, the capture's gamma encoding, the deck under the
  overcast law, the glow's fit, the sun fading as it sets, the disc
  capped below half float's range.
- `client/src/game/weather.ts` — `airColourUnder` over a base colour.
- `client/src/game/sky.ts` — `NIGHT_SKY` and `MOONLIGHT` exported,
  frozen.
- `client/test/game/helpers/skyFixture.ts` — one small table per test
  file, the slices for the hours the sky's tests read.
- `client/test/game/skyState.test.ts` — the noon and midnight anchors,
  the dome agreeing with the fog's and the glow's horizons, the deck,
  the glow on known fall-offs, the table coordinates against hand
  values, a blue zenith and a red horizon at 18:00, no jump between
  hours 0.01 h apart through dusk.
- `client/test/game/weather.test.ts` — the air's identity at clear,
  its agreement with the fog colour by day, the mist's lift, cloud
  greying without dimming, rain, dread.
- `client/test/architecture.test.ts` — the state held Babylon-free.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

Then run the repository's pre-push scan.

### Task 4: The sky dome

**Files:**
- Create: `client/src/game/halfFloat.ts`, `client/src/game/skyDome.ts`, `client/src/game/shaders/skyDome.vertex.fx`, `client/src/game/shaders/skyDome.fragment.fx`
- Modify: `client/test/architecture.test.ts` (one line in `BABYLON_FREE_FILES`)
- Test: `client/test/game/halfFloat.test.ts`, `client/test/game/skyDome.test.ts` (create); `client/test/game/shaderHygiene.test.ts` (unchanged, runs over the new stages)

**Interfaces:**
- Consumes:
  - Task 3: `type SkyState`, `skyStateFor`, `MIST_HORIZON`, `SUN_DISC_COS`, `SUN_DISC_CAPTURE_MAX` (`skyState.ts`), and `captureEncode`'s rule, which the capture line transcribes; `NIGHT_SKY` (`sky.ts`); `skyFixture()` (`client/test/game/helpers/skyFixture.ts`).
  - Task 1: `SLICE_AZIMUTHS` (32), `SLICE_ELEVATIONS` (64) (`skyModel.ts`).
  - Existing: `drawnEffect`, `webgpuProcessingEngine` (`client/test/game/helpers/webgpuProcessing.ts`); `startTranslators`, `translateStage` (`tools/wgsl/lib/translators.mjs`); `translatorInput`, `uniformityOff` (`client/src/game/wgslFormat.ts`); `WEATHER_PRESETS` (`weather.ts`).
- Produces: contract §5 with exactly its names and signatures (`SKY_DOME_NAME = "skyDome"`, `type SkyDome`, `createSkyDome(scene, colourPath)`, `toHalf`, `rgbToHalfRgba`), the stages `skyDome.vertex.fx` and `skyDome.fragment.fx` registered in Babylon's shader store as `skyDomeVertexShader` and `skyDomeFragmentShader`, the sampler `skyTable` (a texture named `"skyTable"`), and every uniform of the contract's table. Additions:
  - The capture branch (`skyCapture > 0.5`) writes `pow(max(sky, vec3(0.0)), vec3(1.0 / 2.2))` of the linear composition, the disc capped, never tone-mapped (`captureEncode` in `skyState.ts`), because the probe stays flagged as gamma.
  - `skyNight` is set from `s.nightFloor` (Task 3: `NIGHT_SKY × night`) at each `update`, not from the constant; before the first update it holds `NIGHT_SKY`.
  - The uniform `skyContrast` (float): the scene's `imageProcessingConfiguration.contrast`, read at each `update`. Applied after the encode on the material path, as Babylon's image processing applies contrast to every other material there; the spec's §6 table names exposure, contrast and Khronos PBR Neutral, and lighting sets that contrast to 1.1 on the material path.
  - `export const SKY_DOME_UNIFORMS: readonly string[]` — the material's uniform list, `world` and `viewProjection` first.
  - The fragment holds two more `const float`s beside the contract's six: `SKY_NEUTRAL_START = 0.76` and `SKY_NEUTRAL_DESATURATION = 0.15`, Khronos PBR Neutral's published constants as Babylon has them, pinned by literal.
  - `rgbToHalfRgba` reads `floor(length / 3)` texels.

**Notes for the implementer:**
- The repository's `ShaderMaterial` precedent is `rainMap.ts` (`rainSplash.ts` is a material plugin on a Standard material): a GLSL source in Babylon's shader store, a `ShaderMaterial` with its attributes, uniforms and samplers, and no shader language given, so it is GLSL on every engine and WebGPU translates it (or finds it in the WGSL map once the corpus holds it). The stages are imported with `?raw`, as `post.ts` imports its `.fx` files.
- The direction is the box's own vertex position. Babylon centres an `infiniteDistance` mesh on the scene's active camera, so the position is the direction from that camera; the old sky computed the same (its `vPositionW − cameraPosition`, the active camera's position), the reflection probe's faces included.
- Below about −7° the slice's texels fall into half float's subnormal range (under 6.1 × 10⁻⁵ per unit of solar irradiance). The dome's own light there is a few thousandths in scene units against the night floor's 0.02–0.06, and the shader's read differs from `domeRadiance`'s float32 read by under 10⁻³, so the quantisation is not seen.
- The capture's gamma encoding follows from the probe staying flagged as gamma (Task 5 builds it with `linearSpace` false, so no PBR stage changes): every PBR material decodes the capture with Babylon's `toLinearSpace`, a 2.2 power, the exact inverse of the stage's 1/2.2. The capture is half float, so the encoded values above 1 of a bright dusk horizon survive.
- Under `NullEngine` a half-float `RawTexture` falls back to nearest sampling (its caps say no half-float filtering); the test turns the cap on to see the bilinear mode WebGL2 and WebGPU give. `NullEngine` keeps the last upload in the internal texture's `_bufferView`, which the test reads.
- Measured: `halfFloat.test.ts` 0.3 s (every finite half round-trips), `skyDome.test.ts` about 0.5 s with both stages translated on both colour paths.

- [ ] **Step 1: Write the failing test for the half float**

Create `client/test/game/halfFloat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rgbToHalfRgba, toHalf } from "../../src/game/halfFloat.js";

/** A half's value, decoded the long way: sign, exponent and mantissa. */
function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

describe("toHalf", () => {
  it("encodes the known binary16 values exactly", () => {
    expect(toHalf(0)).toBe(0x0000);
    expect(toHalf(-0)).toBe(0x8000);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(-65504)).toBe(0xfbff);
    // The smallest normal, a subnormal, the smallest subnormal.
    expect(toHalf(2 ** -14)).toBe(0x0400);
    expect(toHalf(2 ** -15)).toBe(0x0200);
    expect(toHalf(2 ** -24)).toBe(0x0001);
    // Values that are not halves round to the nearest: 0.1 is 0.0999755859375.
    expect(toHalf(0.1)).toBe(0x2e66);
    expect(toHalf(1 / 3)).toBe(0x3555);
  });

  it("rounds a tie to the even half and anything past it to the nearer", () => {
    // 1 + 2^-11 lies halfway between 1 (0x3c00) and the next half (0x3c01).
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(toHalf(1 + 2 ** -11 + 2 ** -20)).toBe(0x3c01);
    // Halves are 2 apart from 2048: 2049 ties to 2048, 2051 to 2052.
    expect(toHalf(2049)).toBe(0x6800);
    expect(toHalf(2051)).toBe(0x6802);
    // Among the subnormals: half a step ties to 0, a step and a half to 2.
    expect(toHalf(2 ** -25)).toBe(0x0000);
    expect(toHalf(3 * 2 ** -25)).toBe(0x0002);
    expect(toHalf(2 ** -26)).toBe(0x0000);
    // Just under the smallest normal rounds up into it.
    expect(toHalf(2 ** -14 - 2 ** -25)).toBe(0x0400);
  });

  it("overflows to infinity from half a step past 65504, and keeps NaN a NaN", () => {
    expect(toHalf(65519)).toBe(0x7bff);
    expect(toHalf(65520)).toBe(0x7c00);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(-1e6)).toBe(0xfc00);
    expect(toHalf(Infinity)).toBe(0x7c00);
    expect(toHalf(-Infinity)).toBe(0xfc00);
    expect(toHalf(Number.NaN)).toBe(0x7e00);
  });

  it("gives back every finite half from its own value", () => {
    for (let bits = 0; bits < 0x10000; bits++) {
      if (((bits >> 10) & 0x1f) === 31) continue;
      expect(toHalf(fromHalf(bits))).toBe(bits);
    }
  });
});

describe("rgbToHalfRgba", () => {
  it("packs each RGB triple as four halves, alpha 1", () => {
    const packed = rgbToHalfRgba(new Float32Array([0, 1, -2, 0.5, 65504, 2 ** -24]));
    expect(packed).toBeInstanceOf(Uint16Array);
    expect([...packed]).toEqual([0x0000, 0x3c00, 0xc000, 0x3c00, 0x3800, 0x7bff, 0x0001, 0x3c00]);
  });

  it("packs a whole slice: 32 x 64 texels to 8192 halves", () => {
    expect(rgbToHalfRgba(new Float32Array(32 * 64 * 3)).length).toBe(32 * 64 * 4);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/halfFloat.test.ts`
Expected: FAIL, no tests run: `Error: Cannot find module '../../src/game/halfFloat.js' imported from …/client/test/game/halfFloat.test.ts`.

- [ ] **Step 3: Write the half float**

Create `client/src/game/halfFloat.ts`:

```ts
/**
 * IEEE 754 binary16, the half float: the texel format of an RGBA16F texture.
 * WebGL2 and WebGPU both take a half-float texture's data as 16-bit words, so
 * the float data the sky's table holds is packed here before it goes up
 * (`skyDome.ts`). Pure and Babylon-free.
 */

/** The largest finite half, 65504, is (2 - 2^-10) * 2^15. */
const HALF_MAX_EXPONENT = 15;
/** The smallest normal half is 2^-14; below it the halves are subnormal, in steps of 2^-24. */
const HALF_MIN_NORMAL = 2 ** -14;
const HALF_SUBNORMAL_STEP = 2 ** -24;
const HALF_INFINITY = 0x7c00;
const HALF_NAN = 0x7e00;
const HALF_ONE = 0x3c00;

/** Rounds to the nearest integer, a tie to the even one. */
function roundEven(x: number): number {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The binary16 bits of `value`, rounded to the nearest half with a tie to the
 * even one, as a GPU rounds. Rounded straight from the double, so nothing is
 * rounded twice. Past 65504 by half a step or more it is infinity; NaN is the
 * quiet NaN; a negative zero keeps its sign.
 */
export function toHalf(value: number): number {
  if (Number.isNaN(value)) return HALF_NAN;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  if (magnitude === Infinity) return sign | HALF_INFINITY;
  if (magnitude < HALF_MIN_NORMAL) {
    // A subnormal, in whole steps. 1024 steps is the smallest normal, whose
    // bits are exactly 1024: a value that rounds up into it lands on them.
    return sign | roundEven(magnitude / HALF_SUBNORMAL_STEP);
  }
  let exponent = Math.floor(Math.log2(magnitude));
  // Math.log2 may land a hair off at an exact power of two: settle it so
  // 2^exponent <= magnitude < 2^(exponent + 1).
  if (2 ** exponent > magnitude) exponent -= 1;
  else if (2 ** (exponent + 1) <= magnitude) exponent += 1;
  // Exact: a division by a power of two, and a value in [1, 2) less 1.
  let mantissa = roundEven((magnitude / 2 ** exponent - 1) * 1024);
  if (mantissa === 1024) {
    mantissa = 0;
    exponent += 1;
  }
  if (exponent > HALF_MAX_EXPONENT) return sign | HALF_INFINITY;
  return sign | ((exponent + 15) << 10) | mantissa;
}

/** RGB triples packed as RGBA halves, alpha 1: the data an RGBA16F texture takes. */
export function rgbToHalfRgba(rgb: Float32Array): Uint16Array {
  const texels = Math.floor(rgb.length / 3);
  const out = new Uint16Array(texels * 4);
  for (let i = 0; i < texels; i++) {
    out[i * 4] = toHalf(rgb[i * 3] ?? 0);
    out[i * 4 + 1] = toHalf(rgb[i * 3 + 1] ?? 0);
    out[i * 4 + 2] = toHalf(rgb[i * 3 + 2] ?? 0);
    out[i * 4 + 3] = HALF_ONE;
  }
  return out;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run --root client test/game/halfFloat.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write the failing test for the dome**

Create `client/test/game/skyDome.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import { createSkyDome, SKY_DOME_NAME, SKY_DOME_UNIFORMS, type SkyDome } from "../../src/game/skyDome.js";
import { rgbToHalfRgba } from "../../src/game/halfFloat.js";
import { NIGHT_SKY } from "../../src/game/sky.js";
import { SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "../../src/game/skyModel.js";
import { MIST_HORIZON, SUN_DISC_CAPTURE_MAX, SUN_DISC_COS, skyStateFor } from "../../src/game/skyState.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const VERTEX = fx("skyDome.vertex.fx");
const FRAGMENT = fx("skyDome.fragment.fx");

/** What a ShaderMaterial holds of its options and uniform values. */
type Held = {
  _options: { attributes: string[]; uniforms: string[]; samplers: string[] };
  _floats: Record<string, number>;
  _vectors3: Record<string, Vector3>;
  _textures: Record<string, Texture>;
};
const held = (material: ShaderMaterial) => material as unknown as Held;

let engine: NullEngine | null = null;
let dome: SkyDome | null = null;
afterEach(() => {
  dome?.dispose();
  dome = null;
  engine?.dispose();
  engine = null;
});
function scene(halfFloatFiltering = false): Scene {
  engine = new NullEngine();
  engine.getCaps().textureHalfFloatLinearFiltering = halfFloatFiltering;
  const s = new Scene(engine);
  s.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), s);
  return s;
}

describe("createSkyDome", () => {
  it("is a box 8000 across named skyDome, riding with the eye, never picked, drawn from inside", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    expect(dome.mesh.name).toBe(SKY_DOME_NAME);
    expect(SKY_DOME_NAME).toBe("skyDome");
    expect(dome.mesh.infiniteDistance).toBe(true);
    expect(dome.mesh.isPickable).toBe(false);
    expect(dome.mesh.getBoundingInfo().boundingBox.extendSize.asArray()).toEqual([4000, 4000, 4000]);
    expect(dome.mesh.material).toBe(dome.material);
    expect(dome.material).toBeInstanceOf(ShaderMaterial);
    expect(dome.material.name).toBe(SKY_DOME_NAME);
    expect(dome.material.backFaceCulling).toBe(false);
  });

  it("builds its material from the two stages it stores, with the position, the uniforms and the table", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    expect(Effect.ShadersStore["skyDomeVertexShader"]).toBe(VERTEX);
    expect(Effect.ShadersStore["skyDomeFragmentShader"]).toBe(FRAGMENT);
    const options = held(dome.material)._options;
    expect(options.attributes).toEqual(["position"]);
    expect(options.uniforms).toEqual([
      "world", "viewProjection",
      "skyScale", "skyCloud", "skyDeckZenith", "skyNight", "skyMistAir", "skyMistWeight", "skySunDir", "skyDisc",
      "skyCapture", "skyExposure", "skyToneMap", "skyContrast",
    ]);
    expect(SKY_DOME_UNIFORMS).toEqual(options.uniforms);
    expect(options.samplers).toEqual(["skyTable"]);
    // Every uniform the stages declare is one the material lists, and the reverse.
    const declared = [...`${VERTEX}\n${FRAGMENT}`.matchAll(/uniform\s+(?:float|vec3|mat4)\s+(\w+);/g)].map((m) => m[1]);
    expect([...declared].sort()).toEqual([...options.uniforms].sort());
    expect(FRAGMENT).toContain("uniform sampler2D skyTable;");
  });

  it("holds the table as a 32 x 64 RGBA half-float texture, clamped, filtered where the engine filters half floats", () => {
    const s = scene(true);
    dome = createSkyDome(s, "post");
    const table = held(dome.material)._textures["skyTable"]!;
    expect(table.name).toBe("skyTable");
    expect(table.getSize()).toEqual({ width: SLICE_AZIMUTHS, height: SLICE_ELEVATIONS });
    expect([SLICE_AZIMUTHS, SLICE_ELEVATIONS]).toEqual([32, 64]);
    const internal = table.getInternalTexture()!;
    expect(internal.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(internal.generateMipMaps).toBe(false);
    expect(table.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(table.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(table.samplingMode).toBe(Texture.BILINEAR_SAMPLINGMODE);
  });

  it("starts as the night sky alone, the tone map set by the colour path", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    const post = held(dome.material);
    expect(post._floats).toEqual({
      skyScale: 0, skyCloud: 0, skyMistWeight: 0, skyCapture: 0, skyExposure: 1, skyToneMap: 0, skyContrast: 1,
    });
    expect(post._vectors3["skyNight"]!.asArray()).toEqual([NIGHT_SKY.r, NIGHT_SKY.g, NIGHT_SKY.b]);
    expect(post._vectors3["skySunDir"]!.asArray()).toEqual([0, 1, 0]);
    dome.dispose();
    dome = createSkyDome(s, "material");
    expect(held(dome.material)._floats["skyToneMap"]).toBe(1);
  });

  it("update uploads the clear slice as halves and sets every uniform of the sky from the state", () => {
    const s = scene();
    s.imageProcessingConfiguration.contrast = 1.1;
    dome = createSkyDome(s, "post");
    // Dusk in mist: cloud, mist, a disc and a deck all in play.
    const state = skyStateFor(skyFixture(), 18, WEATHER_PRESETS.mist);
    dome.update(state, 1.3);
    const table = held(dome.material)._textures["skyTable"]!;
    const uploaded = (table.getInternalTexture() as unknown as { _bufferView: Uint16Array })._bufferView;
    expect(uploaded).toBeInstanceOf(Uint16Array);
    expect(uploaded.length).toBe(32 * 64 * 4);
    expect([...uploaded]).toEqual([...rgbToHalfRgba(state.clear.texels)]);
    const m = held(dome.material);
    expect(m._floats).toEqual({
      skyScale: state.scale,
      skyCloud: 0.9,
      skyMistWeight: 1,
      skyCapture: 0,
      skyExposure: 1.3,
      skyToneMap: 0,
      skyContrast: 1.1,
    });
    const v = (name: string) => m._vectors3[name]!.asArray();
    expect(v("skyDeckZenith")).toEqual([state.deckZenith.r, state.deckZenith.g, state.deckZenith.b]);
    expect(v("skyNight")).toEqual([state.nightFloor.r, state.nightFloor.g, state.nightFloor.b]);
    expect(v("skyMistAir")).toEqual([state.mistAir.r, state.mistAir.g, state.mistAir.b]);
    expect(v("skySunDir")).toEqual([state.sunDir.x, state.sunDir.y, state.sunDir.z]);
    expect(v("skyDisc")).toEqual([state.discColour.r, state.discColour.g, state.discColour.b]);
    // Every sky uniform holds a value: none is left to the engine's default.
    const set = [...Object.keys(m._floats), ...Object.keys(m._vectors3)].sort();
    expect(set).toEqual(SKY_DOME_UNIFORMS.filter((u) => u.startsWith("sky")).sort());
  });

  it("setCapture switches the capture output on and off", () => {
    const s = scene();
    dome = createSkyDome(s, "material");
    dome.setCapture(true);
    expect(held(dome.material)._floats["skyCapture"]).toBe(1);
    dome.setCapture(false);
    expect(held(dome.material)._floats["skyCapture"]).toBe(0);
  });

  it("dispose takes the mesh, the material and the table out of the scene", () => {
    const s = scene();
    const made = createSkyDome(s, "post");
    const table = held(made.material)._textures["skyTable"]!;
    expect(s.textures).toContain(table);
    made.dispose();
    expect(made.mesh.isDisposed()).toBe(true);
    expect(s.materials).not.toContain(made.material);
    expect(s.textures).not.toContain(table);
    expect(s.meshes).not.toContain(made.mesh);
  });
});

describe("the dome's stages", () => {
  it("hold the shared functions text for text", () => {
    expect(FRAGMENT).toContain(`const float SKY_PI = 3.14159265;
const float SKY_AZIMUTHS = 32.0;
const float SKY_ELEVATIONS = 64.0;
const float SKY_MIST_HORIZON = 0.08;
const float SKY_DISC_COS = 0.99998890;      // cos(0.27 degrees), lockstep with SUN_DISC_COS
const float SKY_DISC_CAPTURE_MAX = 1.0;`);
    expect(FRAGMENT).toContain(`vec2 skyTableUv(vec3 d, vec3 sunDir) {
  vec2 h = d.xz;
  vec2 s = sunDir.xz;
  float hl = length(h);
  float sl = length(s);
  float c = (hl > 1.0e-6 && sl > 1.0e-6) ? clamp(dot(h, s) / (hl * sl), -1.0, 1.0) : 1.0;
  float u = acos(c) / SKY_PI;
  float e = asin(clamp(d.y, 0.0, 1.0));
  float v = 0.5 + 0.5 * sign(e) * sqrt(abs(e) / (0.5 * SKY_PI));
  return vec2((u * (SKY_AZIMUTHS - 1.0) + 0.5) / SKY_AZIMUTHS, (v * (SKY_ELEVATIONS - 1.0) + 0.5) / SKY_ELEVATIONS);
}`);
    expect(FRAGMENT).toContain(`vec3 skyDeck(vec3 zenith, float sinE) {
  return zenith * (1.0 + 2.0 * max(sinE, 0.0)) / 3.0;
}`);
  });

  it("keep every constant in lockstep with skyState.ts and the model", () => {
    const consts = Object.fromEntries(
      [...FRAGMENT.matchAll(/const float (\w+) = ([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
    );
    expect(Object.keys(consts)).toEqual([
      "SKY_PI", "SKY_AZIMUTHS", "SKY_ELEVATIONS", "SKY_MIST_HORIZON", "SKY_DISC_COS", "SKY_DISC_CAPTURE_MAX",
      "SKY_NEUTRAL_START", "SKY_NEUTRAL_DESATURATION",
    ]);
    expect(consts["SKY_PI"]).toBe(Math.PI.toFixed(8));
    expect(consts["SKY_AZIMUTHS"]).toBe(glslFloat(SLICE_AZIMUTHS));
    expect(consts["SKY_ELEVATIONS"]).toBe(glslFloat(SLICE_ELEVATIONS));
    expect(consts["SKY_MIST_HORIZON"]).toBe(glslFloat(MIST_HORIZON));
    expect(consts["SKY_DISC_COS"]).toBe(SUN_DISC_COS.toFixed(8));
    expect(consts["SKY_DISC_CAPTURE_MAX"]).toBe(glslFloat(SUN_DISC_CAPTURE_MAX));
    // Khronos PBR Neutral's published constants, as Babylon's image processing has them.
    expect(consts["SKY_NEUTRAL_START"]).toBe("0.76");
    expect(consts["SKY_NEUTRAL_DESATURATION"]).toBe("0.15");
  });

  it("compose the dome as domeRadiance does, choosing the disc, the capture and the tone map by step and mix", () => {
    expect(VERTEX).toContain("vSkyDir = position;");
    expect(VERTEX).toContain("gl_Position = viewProjection * world * vec4(position, 1.0);");
    for (const line of [
      "vec3 d = normalize(vSkyDir);",
      "vec3 sky = skyScale * textureLod(skyTable, skyTableUv(d, skySunDir), 0.0).rgb;",
      "sky = mix(sky, skyDeck(skyDeckZenith, d.y), skyCloud);",
      "sky += skyNight;",
      "float inDisc = step(SKY_DISC_COS, dot(d, skySunDir));",
      "sky += inDisc * mix(skyDisc, min(skyDisc, vec3(SKY_DISC_CAPTURE_MAX)), skyCapture);",
      "float h = skyMistWeight * exp(-max(d.y, 0.0) / SKY_MIST_HORIZON);",
      "sky = mix(sky, skyMistAir, h);",
      "vec3 toned = skyNeutral(sky * skyExposure);",
      "toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);",
      "toned = skyContrastOf(toned);",
      // The capture: the linear sky, disc capped, gamma-encoded as captureEncode, never tone-mapped.
      "vec3 captured = pow(max(sky, vec3(0.0)), vec3(1.0 / 2.2));",
      "vec3 viewed = mix(sky, toned, step(0.5, skyToneMap));",
      "gl_FragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);",
    ]) {
      expect(FRAGMENT).toContain(line);
    }
    // The steps in domeRadiance's order.
    const at = (text: string) => FRAGMENT.indexOf(text);
    expect(at("sky = mix(sky, skyDeck")).toBeLessThan(at("sky += skyNight;"));
    expect(at("sky += skyNight;")).toBeLessThan(at("float inDisc"));
    expect(at("float inDisc")).toBeLessThan(at("sky = mix(sky, skyMistAir, h);"));
    // Khronos PBR Neutral and Babylon's contrast, as its image processing has them.
    expect(FRAGMENT).toContain("float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;");
    expect(FRAGMENT).toContain("float newPeak = 1.0 - k * k / (peak + k - SKY_NEUTRAL_START);");
    expect(FRAGMENT).toContain("float g = 1.0 - 1.0 / (SKY_NEUTRAL_DESATURATION * (peak - newPeak) + 1.0);");
    expect(FRAGMENT).toContain("return peak < SKY_NEUTRAL_START ? color : compressed;");
    expect(FRAGMENT).toContain("vec3 high = c * c * (3.0 - 2.0 * c);");
  });

  it("read the table once, at level 0, with no branch anywhere", () => {
    expect(FRAGMENT.match(/textureLod\(/g)).toHaveLength(1);
    expect(FRAGMENT).not.toMatch(/\btexture(?:2D)?\s*\(/);
    expect(`${VERTEX}\n${FRAGMENT}`).not.toMatch(/\bif\s*\(/);
    expect(FRAGMENT).not.toContain("discard");
  });

  it("migrate to GLSL 300 es with the varying, the explicit-level read and the output intact", async () => {
    const processing = new NullEngine();
    try {
      const vertex = await processed(VERTEX, false, processing);
      expect(vertex).toContain("in vec3 position");
      expect(vertex).toContain("out vec3 vSkyDir");
      const fragment = await processed(FRAGMENT, true, processing);
      expect(fragment).toContain("in vec3 vSkyDir");
      expect(fragment).toContain("textureLod(skyTable, skyTableUv(d, skySunDir), 0.0)");
      expect(fragment).toContain("glFragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);");
    } finally {
      processing.dispose();
    }
  });
});

describe("the dome's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  for (const colourPath of ["post", "material"] as const) {
    it(`compile through glslang and translate to WGSL on the ${colourPath} path, reading the table at an explicit level`, async () => {
      const gpu = webgpuProcessingEngine();
      const gpuScene = new Scene(gpu);
      try {
        gpuScene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), gpuScene);
        const made = createSkyDome(gpuScene, colourPath);
        const effect = await drawnEffect(made.mesh);
        const defines = (effect as unknown as { defines: string }).defines;
        const stage = (kind: "vertex" | "fragment", code: string) =>
          translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
        const vertex = stage("vertex", effect._vertexSourceCode);
        const fragment = stage("fragment", effect._fragmentSourceCode);
        expect(vertex).toContain("vSkyDir");
        expect(fragment).toContain("skyTable");
        expect(fragment).toMatch(/textureSampleLevel\(/);
        expect(fragment).not.toMatch(/textureSample\(/);
        made.dispose();
      } finally {
        gpuScene.dispose();
        gpu.dispose();
      }
    }, timeLimit(60_000));
  }
});

/** A stage as Babylon's WebGL2 processing migrates it. */
function processed(source: string, isFragment: boolean, on: NullEngine): Promise<string> {
  const options: _IProcessingOptions = {
    defines: [], indexParameters: {}, isFragment, shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: true, shadersRepository: "", includesShadersStore: {},
    processor: new WebGL2ShaderProcessor(), version: "300", platformName: "WEBGL2",
    processingContext: null, isNDCHalfZRange: false, useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => {
    Process(source, options, (migrated) => resolve(migrated), on);
  });
}
```

- [ ] **Step 6: Run it and see it fail**

Run: `npx vitest run --root client test/game/skyDome.test.ts`
Expected: FAIL, no tests run: `Error: Cannot find module '../../src/game/skyDome.js' imported from …/client/test/game/skyDome.test.ts`.

- [ ] **Step 7: Write the vertex stage**

Create `client/src/game/shaders/skyDome.vertex.fx`:

```glsl
// The sky dome's vertex stage, built by skyDome.ts. The box rides with the
// eye (infiniteDistance), so a corner's own position is its direction from
// the eye: the fragment stage normalises it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vSkyDir;

void main(void) {
  vSkyDir = position;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
```

- [ ] **Step 8: Write the fragment stage**

Create `client/src/game/shaders/skyDome.fragment.fx`:

```glsl
// The sky dome's fragment stage, built by skyDome.ts: the clear sky's slice
// of the scattering table at the sun's altitude, scaled to the scene and
// adapted, mixed toward the cloud deck, the night floor added (the moonlit
// night sky, appearing as the twilight fades), the sun's disc, then the mist's
// blend toward the fog colour at the horizon. On the
// material colour path (no post chain) it applies the image's exposure, the
// Khronos PBR Neutral tone map, the sRGB encode and the contrast itself, in
// the order Babylon's image processing applies them to every other material
// there. The probe's capture is never tone-mapped: it takes the linear
// composition with the disc capped, raised to 1/2.2, because the probe is
// flagged as gamma and every material that reads it raises it to 2.2 again.
//
// skyState.ts transcribes every step (domeRadiance, skyTableUv, deckRadiance,
// captureEncode) and a lockstep test holds the constants below to its own.
//
// The table is read once, at an explicit level, in uniform control flow: the
// disc, the capture and the tone map are chosen by step and mix on uniforms
// and the computed cosine, never by a branch around the read, so the WGSL
// translation keeps a plain textureSampleLevel.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform sampler2D skyTable;
uniform float skyScale;
uniform float skyCloud;
uniform vec3 skyDeckZenith;
uniform vec3 skyNight;
uniform vec3 skyMistAir;
uniform float skyMistWeight;
uniform vec3 skySunDir;
uniform vec3 skyDisc;
uniform float skyCapture;
uniform float skyExposure;
uniform float skyToneMap;
uniform float skyContrast;

varying vec3 vSkyDir;

const float SKY_PI = 3.14159265;
const float SKY_AZIMUTHS = 32.0;
const float SKY_ELEVATIONS = 64.0;
const float SKY_MIST_HORIZON = 0.08;
const float SKY_DISC_COS = 0.99998890;      // cos(0.27 degrees), lockstep with SUN_DISC_COS
const float SKY_DISC_CAPTURE_MAX = 1.0;
// Khronos PBR Neutral's published constants: where compression starts, and
// how far a compressed colour desaturates.
const float SKY_NEUTRAL_START = 0.76;
const float SKY_NEUTRAL_DESATURATION = 0.15;

vec2 skyTableUv(vec3 d, vec3 sunDir) {
  vec2 h = d.xz;
  vec2 s = sunDir.xz;
  float hl = length(h);
  float sl = length(s);
  float c = (hl > 1.0e-6 && sl > 1.0e-6) ? clamp(dot(h, s) / (hl * sl), -1.0, 1.0) : 1.0;
  float u = acos(c) / SKY_PI;
  float e = asin(clamp(d.y, 0.0, 1.0));
  float v = 0.5 + 0.5 * sign(e) * sqrt(abs(e) / (0.5 * SKY_PI));
  return vec2((u * (SKY_AZIMUTHS - 1.0) + 0.5) / SKY_AZIMUTHS, (v * (SKY_ELEVATIONS - 1.0) + 0.5) / SKY_ELEVATIONS);
}

vec3 skyDeck(vec3 zenith, float sinE) {
  return zenith * (1.0 + 2.0 * max(sinE, 0.0)) / 3.0;
}

// Khronos PBR Neutral, as Babylon's image processing defines it, with the
// early return for an uncompressed colour written as a selection.
vec3 skyNeutral(vec3 color) {
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  float k = 1.0 - SKY_NEUTRAL_START;
  float newPeak = 1.0 - k * k / (peak + k - SKY_NEUTRAL_START);
  float g = 1.0 - 1.0 / (SKY_NEUTRAL_DESATURATION * (peak - newPeak) + 1.0);
  vec3 compressed = mix(color * (newPeak / max(peak, 1.0e-6)), vec3(newPeak), g);
  return peak < SKY_NEUTRAL_START ? color : compressed;
}

// Babylon's contrast, after the encode, as its image processing applies it.
vec3 skyContrastOf(vec3 c) {
  vec3 high = c * c * (3.0 - 2.0 * c);
  vec3 shaped = skyContrast < 1.0 ? mix(vec3(0.5), c, skyContrast) : mix(c, high, skyContrast - 1.0);
  return max(shaped, 0.0);
}

void main(void) {
  vec3 d = normalize(vSkyDir);
  vec3 sky = skyScale * textureLod(skyTable, skyTableUv(d, skySunDir), 0.0).rgb;
  sky = mix(sky, skyDeck(skyDeckZenith, d.y), skyCloud);
  sky += skyNight;
  float inDisc = step(SKY_DISC_COS, dot(d, skySunDir));
  sky += inDisc * mix(skyDisc, min(skyDisc, vec3(SKY_DISC_CAPTURE_MAX)), skyCapture);
  float h = skyMistWeight * exp(-max(d.y, 0.0) / SKY_MIST_HORIZON);
  sky = mix(sky, skyMistAir, h);
  vec3 toned = skyNeutral(sky * skyExposure);
  toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);
  toned = skyContrastOf(toned);
  vec3 captured = pow(max(sky, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 viewed = mix(sky, toned, step(0.5, skyToneMap));
  gl_FragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);
}
```

- [ ] **Step 9: Write the dome**

Create `client/src/game/skyDome.ts`:

```ts
/**
 * The sky dome: a box around the eye drawn by one fragment stage
 * (`shaders/skyDome.fragment.fx`) from the sky's state (`skyState.ts`): the
 * clear sky's slice of the scattering table, the cloud deck, the night
 * floor (the moonlit night sky, by the night factor), the sun's disc and the
 * mist's horizon. The reflection probe captures
 * it as the image-based light (`lighting.ts`), switching it to the capture
 * output while it renders: the linear sky with the disc capped, raised to
 * 1/2.2 (`captureEncode`), since the probe is flagged as gamma and every PBR
 * material raises what it reads from it to 2.2 again.
 *
 * The slice goes up on each change of hour or weather as a 32 x 64 RGBA16F
 * texture, 16 KB: half float is filterable on WebGL2 and on WebGPU's core
 * features, where float32 filtering is optional. The stage reads it once, at
 * an explicit level, in uniform control flow.
 *
 * GLSL on every engine, as a ShaderMaterial is unless told otherwise
 * (`rainMap.ts` builds its own the same way): on WebGPU the stages are
 * translated, or found in the WGSL map once the corpus holds them.
 *
 * On the material colour path (no post chain) the stage tone-maps itself
 * (`skyToneMap`), as Babylon's image processing does every other material
 * there; the exposure comes in through `update` and the contrast is the
 * scene's own.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

import { NIGHT_SKY } from "./sky.js";
import { SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "./skyModel.js";
import type { SkyState } from "./skyState.js";
import { rgbToHalfRgba } from "./halfFloat.js";
import skyDomeVertex from "./shaders/skyDome.vertex.fx?raw";
import skyDomeFragment from "./shaders/skyDome.fragment.fx?raw";

/** The material's and the mesh's name, and the stages' name in Babylon's shader store. */
export const SKY_DOME_NAME = "skyDome";

/** The stages' uniforms: the two matrices, then the sky's. */
export const SKY_DOME_UNIFORMS: readonly string[] = [
  "world", "viewProjection",
  "skyScale", "skyCloud", "skyDeckZenith", "skyNight", "skyMistAir", "skyMistWeight", "skySunDir", "skyDisc",
  "skyCapture", "skyExposure", "skyToneMap", "skyContrast",
];

/** Big enough to sit outside any view, small enough to stay inside the far plane. */
const SKYBOX_SIZE = 8000;

export type SkyDome = {
  /** A box of SKYBOX_SIZE riding with the eye, never picked. */
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  /** Uploads the clear slice as the table texture and sets every uniform from `s`;
   * `exposure` is the material path's image exposure. */
  update(s: SkyState, exposure: number): void;
  /** The probe's capture: the disc capped, the linear sky gamma-encoded, no tone map. */
  setCapture(on: boolean): void;
  dispose(): void;
};

export function createSkyDome(scene: Scene, colourPath: "post" | "material"): SkyDome {
  Effect.ShadersStore[`${SKY_DOME_NAME}VertexShader`] = skyDomeVertex;
  Effect.ShadersStore[`${SKY_DOME_NAME}FragmentShader`] = skyDomeFragment;

  const material = new ShaderMaterial(SKY_DOME_NAME, scene, SKY_DOME_NAME, {
    attributes: ["position"],
    uniforms: [...SKY_DOME_UNIFORMS],
    samplers: ["skyTable"],
  });
  // Seen from inside.
  material.backFaceCulling = false;

  // Linear filtering where the engine filters half floats (WebGL2 and WebGPU
  // both do; RawTexture falls back to nearest where it does not), clamped so
  // the azimuth's ends and the zenith row never wrap.
  const table = RawTexture.CreateRGBATexture(
    new Uint16Array(SLICE_AZIMUTHS * SLICE_ELEVATIONS * 4),
    SLICE_AZIMUTHS,
    SLICE_ELEVATIONS,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  table.name = "skyTable";
  table.wrapU = Texture.CLAMP_ADDRESSMODE;
  table.wrapV = Texture.CLAMP_ADDRESSMODE;
  material.setTexture("skyTable", table);

  const deckZenith = new Vector3();
  const mistAir = new Vector3();
  const sunDir = new Vector3(0, 1, 0);
  const disc = new Vector3();
  const night = new Vector3(NIGHT_SKY.r, NIGHT_SKY.g, NIGHT_SKY.b);
  // Until the first update the dome is the night sky alone.
  material.setFloat("skyScale", 0);
  material.setFloat("skyCloud", 0);
  material.setVector3("skyDeckZenith", deckZenith);
  material.setVector3("skyNight", night);
  material.setVector3("skyMistAir", mistAir);
  material.setFloat("skyMistWeight", 0);
  material.setVector3("skySunDir", sunDir);
  material.setVector3("skyDisc", disc);
  material.setFloat("skyCapture", 0);
  material.setFloat("skyExposure", 1);
  material.setFloat("skyToneMap", colourPath === "material" ? 1 : 0);
  material.setFloat("skyContrast", 1);

  const mesh = MeshBuilder.CreateBox(SKY_DOME_NAME, { size: SKYBOX_SIZE }, scene);
  mesh.material = material;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;

  return {
    mesh,
    material,
    update(s, exposure) {
      table.update(rgbToHalfRgba(s.clear.texels));
      material.setFloat("skyScale", s.scale);
      material.setFloat("skyCloud", s.cloud);
      material.setVector3("skyNight", night.set(s.nightFloor.r, s.nightFloor.g, s.nightFloor.b));
      material.setVector3("skyDeckZenith", deckZenith.set(s.deckZenith.r, s.deckZenith.g, s.deckZenith.b));
      material.setVector3("skyMistAir", mistAir.set(s.mistAir.r, s.mistAir.g, s.mistAir.b));
      material.setFloat("skyMistWeight", s.mistWeight);
      material.setVector3("skySunDir", sunDir.set(s.sunDir.x, s.sunDir.y, s.sunDir.z));
      material.setVector3("skyDisc", disc.set(s.discColour.r, s.discColour.g, s.discColour.b));
      material.setFloat("skyExposure", exposure);
      material.setFloat("skyContrast", scene.imageProcessingConfiguration.contrast);
    },
    setCapture(on) {
      material.setFloat("skyCapture", on ? 1 : 0);
    },
    dispose() {
      mesh.dispose();
      material.dispose();
      table.dispose();
    },
  };
}
```

- [ ] **Step 10: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/skyDome.test.ts test/game/halfFloat.test.ts test/game/shaderHygiene.test.ts`
Expected: every test passes: 14 in `skyDome.test.ts`, 6 in `halfFloat.test.ts`, and in `shaderHygiene.test.ts` the two new tests each for `skyDome.vertex.fx` and `skyDome.fragment.fx` (no hashed keyword or semicolon in a comment; `skyTableUv`, `skyDeck`, `skyNeutral`, `skyContrastOf` and `main` survive the preprocessor) beside the existing files'.

- [ ] **Step 11: Hold the half float to the Babylon-free list**

In `client/test/architecture.test.ts`, in `BABYLON_FREE_FILES`, replace

```ts
      join(SRC, "game", "skyState.ts"),
    ];
```

with

```ts
      join(SRC, "game", "skyState.ts"),
      join(SRC, "game", "halfFloat.ts"),
    ];
```

Run: `npx vitest run --root client test/architecture.test.ts`
Expected: every test passes (`halfFloat.ts` imports nothing; the new test files' limits go through `timeLimit`; `skyDome.ts` is not yet in the page's module graph, so the WebGPU registration list is unchanged).

- [ ] **Step 12: Typecheck and lint**

Run: `npx tsc -p client --noEmit` — expected: no output.
Run: `npx eslint client/src/game/halfFloat.ts client/src/game/skyDome.ts client/test/game/halfFloat.test.ts client/test/game/skyDome.test.ts client/test/architecture.test.ts` — expected: no output.

- [ ] **Step 13: Commit**

```bash
git add client/src/game/halfFloat.ts client/src/game/skyDome.ts client/src/game/shaders/skyDome.vertex.fx client/src/game/shaders/skyDome.fragment.fx client/test/game/halfFloat.test.ts client/test/game/skyDome.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: a sky dome drawn from the scattering table

## What

A new dome for the sky: a box around the eye whose one fragment stage
reads the clear sky's slice of the scattering table once, at an
explicit level, then mixes in the cloud deck, adds the night floor and
the sun's disc and blends into the fog colour at the horizon under
mist, exactly as the sky's state computes it in TypeScript. The slice
goes up as a 32 x 64 half-float texture on each change. For the
reflection probe's capture the disc is capped and the linear sky is
written raised to 1/2.2, which every material reading the probe raises
to 2.2 again; on the material colour path, with no post chain, the stage
applies the exposure, Khronos PBR Neutral, the sRGB encode and the
contrast itself. Nothing draws it yet.

## How

- `client/src/game/skyDome.ts` — the box, the `ShaderMaterial`, the
  half-float table texture and every uniform from a sky state.
- `client/src/game/shaders/skyDome.vertex.fx`,
  `client/src/game/shaders/skyDome.fragment.fx` — the stages; the
  capture and the tone map chosen by `step` and `mix` on uniforms.
- `client/src/game/halfFloat.ts` — binary16 encoding, rounded to the
  nearest even half from the double.
- `client/test/game/skyDome.test.ts` — the material, the texture, the
  upload and uniforms from a state, the capture switch, disposal, the
  stages' shared functions text for text, the capture's encoding, every
  constant in lockstep with `skyState.ts`, one explicit-level read and
  no branch, and both stages through glslang to WGSL on both colour
  paths.
- `client/test/game/halfFloat.test.ts` — known halves, ties to even,
  overflow, and every finite half from its own value.
- `client/test/architecture.test.ts` — the half float held
  Babylon-free.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

Then run the repository's pre-push scan.

### Task 5: Lighting on the sky state, and the sky material gone

**Files:**
- Modify: `client/src/game/lighting.ts` (the whole file is rewritten; 409 lines today)
- Modify: `client/src/game/renderer.ts` (import at line 53; `RendererOptions`, lines 1210–1233; `buildRenderer` at lines 1479–1483; `dispose` at lines 2105–2107)
- Modify: `client/src/game/weather.ts` (import at lines 2–5; delete lines 228–281)
- Modify: `client/src/game/sky.ts` (doc comments at lines 51–58 and 64–69; delete lines 94–107 and 136–161)
- Modify: `client/package.json` (line 13), `package-lock.json` (lines 29 and 65–73), by `npm uninstall`
- Test: `client/test/game/lighting.test.ts` (rewritten whole)
- Test: `client/test/game/renderer.test.ts` (a module mock after line 44, an import after line 94, a new `describe` before line 377, line 866)
- Test: `client/test/game/interStage.test.ts` (import after line 36; line 143; line 352)
- Test: `client/test/game/stageBindings.test.ts` (import after line 51; line 101)
- Test: `client/test/game/foliageLightPlugin.test.ts` (import after line 10; lines 33–38)
- Test: `client/test/game/sky.test.ts` (import at lines 2–16; delete lines 76–99, 189–219, 221–248)
- Test: `client/test/game/weather.test.ts` (imports at lines 2–6 and 43–46; lines 102–112, 115–117, 191–194, 201–208)
- Line numbers are `main`'s (9edee7e); an earlier task's edits move some of them, and every edit quotes the text it replaces.

**Interfaces:**

Consumes:
- Task 1: `SkySlice` (through the table only).
- Task 2: `type SkyTable` (`has`, `add`, `blendAt`, `onChange`), `createSkyTable(): SkyTable`, `NOON_ALTITUDE_DEG: number`; `type SkySource = { readonly table: SkyTable; dispose(): void }`, `startSkySource(startDeg: number): SkySource`. `has(a)` is true when every index of `sliceBracket(a)` is held, so an altitude below −18° needs only the −18° slice; `blendAt(a).altitudeDeg === a`.
- Task 3: `skyStateFor(table: SkyTable, hour: number, w: WeatherParams): SkyState` and the fields `hour`, `sunDir`, `sunIntensity`, `sunColour`, `mistAir`, `horizonAway`, `fillColour`, `fillIntensity`, `cloud`; `skyFixture(): SkyTable` (`client/test/game/helpers/skyFixture.ts`).
- Task 4: `SKY_DOME_NAME = "skyDome"`, `createSkyDome(scene: Scene, colourPath: "post" | "material"): SkyDome` with `mesh`, `update(s: SkyState, exposure: number)`, `setCapture(on: boolean)`, `dispose()`.

Produces:
- `LightingOptions.sky: SkyTable` (required).
- `Lighting.sky: SkyState | null` — the state of the last apply, a new object each apply; **null until the table first holds the noon bracket and the hour's** (the contract's `SkyState`, widened: nothing exists to hand back before then, and `Renderer.sync` runs before then in tests and in the tier check's scene).
- `export function sunAltitudeDeg(hour: number): number` (`lighting.ts`): `asin(sunPositionAt(hour).y)` in degrees, `(Math.asin(y) * 180) / Math.PI` — the altitude the table is read at.
- `export function skyHeld(table: SkyTable, hour: number): boolean` (`lighting.ts`): `table.has(NOON_ALTITUDE_DEG) && table.has(sunAltitudeDeg(hour))`.
- `RendererOptions.skyTable?: SkyTable`. Absent, the renderer starts `startSkySource(sunAltitudeDeg(DEFAULT_HOUR))` and disposes it after the lighting.
- `apply()` re-runs on `table.onChange` only while the last apply found the slices missing (once an hour's slices are held, a later slice cannot change that hour's state).
- Removed: `skyMaterialParamsUnder`, `type SkyMaterialParams`, `sunIntensityUnder`, `sunColourUnder`, `fillIntensityUnder`, `ambientColourUnder` (`weather.ts`); `sunIntensityFor`, `sunIntensityAt`, `fillIntensityFor`, `ambientColourFor` (`sky.ts`); the `@babylonjs/materials` dependency. `HORIZON_SUN` and `ZENITH_SUN` stay until Task 6: `sunColourAt`, which `atmosphereParams.ts` still calls, reads them.

- [ ] **Step 1: Write the failing lighting test.** Replace the whole of `client/test/game/lighting.test.ts` with:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import type { SkyState } from "../../src/game/skyState.js";

/**
 * What the lighting asks of the dome, recorded on the way through to the
 * real one: each update's state and exposure, each turn of the capture
 * branch, and each dispose.
 */
const dome = vi.hoisted(() => ({
  updates: [] as { state: SkyState; exposure: number }[],
  captures: [] as boolean[],
  disposed: 0,
}));
vi.mock("../../src/game/skyDome.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/skyDome.js")>();
  return {
    ...mod,
    createSkyDome: (...args: Parameters<typeof mod.createSkyDome>) => {
      const made = mod.createSkyDome(...args);
      const update = made.update.bind(made);
      const setCapture = made.setCapture.bind(made);
      const dispose = made.dispose.bind(made);
      made.update = (state, exposure) => {
        dome.updates.push({ state, exposure });
        update(state, exposure);
      };
      made.setCapture = (on) => {
        dome.captures.push(on);
        setCapture(on);
      };
      made.dispose = () => {
        dome.disposed += 1;
        dispose();
      };
      return made;
    },
  };
});

import { createLighting, DEFAULT_HOUR, sunAltitudeDeg, type Lighting, type LightingOptions } from "../../src/game/lighting.js";
import { SKY_DOME_NAME } from "../../src/game/skyDome.js";
import { createSkyTable } from "../../src/game/skyTable.js";
import { SKY_IBL_SCALE, skyStateFor } from "../../src/game/skyState.js";
import { exposureFor, fogDensityFor, sunPositionAt } from "../../src/game/sky.js";
import { QUALITY } from "../../src/game/quality.js";
import { WEATHER_PRESETS, fogDensityUnder, exposureUnder, ambientCollapseUnder } from "../../src/game/weather.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;

let engine: NullEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
  dome.updates.length = 0;
  dome.captures.length = 0;
  dome.disposed = 0;
});

function scene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

/** The lighting on `s`: the medium tier, 70 m of fog, the material path and
 * the fixture's sky, with `options` over those. */
function light(s: Scene, options: Partial<LightingOptions> = {}): Lighting {
  return createLighting(s, { tier: "medium", viewDistance: 70, colourPath: "material", sky: skyFixture(), ...options });
}

const sunOf = (s: Scene): DirectionalLight => s.getLightByName("sun") as DirectionalLight;
const fillOf = (s: Scene): HemisphericLight => s.getLightByName("fill") as HemisphericLight;
const captureOf = (s: Scene): RenderTargetTexture => s.environmentTexture as RenderTargetTexture;

describe("createLighting", () => {
  it("survives an engine with no shadow support", () => {
    // NullEngine reports textureFloatRender false, so CascadedShadowGenerator
    // throws on construction. Real hardware at the low tier is the same case.
    // If this throws, the renderer cannot be tested headlessly at all.
    const lighting = light(scene(), { tier: "high" });
    expect(lighting.shadows).toBeNull();
    lighting.dispose();
  });

  it("never builds a shadow generator at the low tier", () => {
    const lighting = light(scene(), { tier: "low" });
    expect(lighting.shadows).toBeNull();
    lighting.dispose();
  });

  it("points the sun light along the direction light travels", () => {
    // The sign trap. sunPositionAt points TOWARD the sun; a DirectionalLight
    // wants the opposite. Getting this backwards lights the world from
    // underground at noon and is invisible to any test that only checks the axis.
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const toSun = sunPositionAt(12);
    const direction = sunOf(s).direction;
    expect(direction.x).toBeCloseTo(-toSun.x, 5);
    expect(direction.y).toBeCloseTo(-toSun.y, 5);
    expect(direction.z).toBeCloseTo(-toSun.z, 5);
    expect(direction.y).toBeLessThan(0);
    lighting.dispose();
  });

  it("keeps the sun light 0 and the fill light 1: the dome adds no light", () => {
    const s = scene();
    const lighting = light(s);
    expect(s.lights.map((l) => l.name)).toEqual(["sun", "fill"]);
    lighting.dispose();
  });

  it("defaults to DEFAULT_HOUR, which matches the /time command's default", () => {
    const lighting = light(scene());
    expect(lighting.hour).toBe(DEFAULT_HOUR);
    lighting.dispose();
  });

  it("moves the sun when the hour changes", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const noonY = sunOf(s).direction.y;
    // 8, not 7: the fixture holds the slices around the hours the suite visits.
    lighting.setHour(8);
    expect(sunOf(s).direction.y).not.toBeCloseTo(noonY, 3);
    expect(lighting.hour).toBe(8);
    lighting.dispose();
  });

  it("puts the fog and the clear colour on the sky state's mist air, which at clear is the dome's horizon away from the sun", () => {
    const s = scene();
    const table = skyFixture();
    const lighting = light(s, { hour: 8, weather: CLEAR, sky: table });
    // The state applied is the one the table makes for the hour and the weather.
    expect(lighting.sky).toEqual(skyStateFor(table, 8, CLEAR));
    for (const hour of [8, 21]) {
      lighting.setHour(hour);
      const sky = lighting.sky!;
      expect(sky.hour).toBe(hour);
      expect(sky.mistAir).toEqual(sky.horizonAway);
      // All three channels, not just r: Color4(air.r, air.r, air.r, 1) would
      // pass a red-only check without matching the sky.
      expect(s.fogColor.r).toBeCloseTo(sky.mistAir.r, 6);
      expect(s.fogColor.g).toBeCloseTo(sky.mistAir.g, 6);
      expect(s.fogColor.b).toBeCloseTo(sky.mistAir.b, 6);
      expect(s.clearColor.r).toBeCloseTo(sky.mistAir.r, 6);
      expect(s.clearColor.g).toBeCloseTo(sky.mistAir.g, 6);
      expect(s.clearColor.b).toBeCloseTo(sky.mistAir.b, 6);
    }
    lighting.dispose();
  });

  it("draws the dome, riding with the camera, unpicked, and alone in the probe's capture", () => {
    const s = scene();
    const lighting = light(s);
    const mesh = s.getMeshByName(SKY_DOME_NAME);
    expect(mesh).not.toBeNull();
    expect(mesh!.infiniteDistance).toBe(true);
    expect(mesh!.isPickable).toBe(false);
    // Assigned, not left null: a null render list is the whole scene in Babylon.
    expect(captureOf(s).renderList).toEqual([mesh]);
    lighting.dispose();
  });

  it("captures the dome gamma-flagged, 8-bit where the engine renders no half floats", () => {
    const s = scene();
    const lighting = light(s);
    expect(captureOf(s).gammaSpace).toBe(true);
    expect(captureOf(s).getInternalTexture()?.type).toBe(Constants.TEXTURETYPE_UNSIGNED_BYTE);
    lighting.dispose();
  });

  it("captures the dome in half float where the engine renders half floats, so the dusk horizon above 1 survives", () => {
    const s = scene();
    s.getEngine().getCaps().textureHalfFloatRender = true;
    const lighting = light(s);
    expect(captureOf(s).gammaSpace).toBe(true);
    expect(captureOf(s).getInternalTexture()?.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    lighting.dispose();
  });

  it("keeps the capture gamma-flagged and not RGBD, the two inputs Babylon's reflection defines read, so no PBR stage changes", () => {
    const s = scene();
    s.getEngine().getCaps().textureHalfFloatRender = true;
    const lighting = light(s);
    expect(captureOf(s).gammaSpace).toBe(true);
    expect(captureOf(s).isRGBD).toBe(false);
    lighting.dispose();
  });

  it("gives the image-based light SKY_IBL_SCALE of the dome at clear", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    expect(s.environmentIntensity).toBe(SKY_IBL_SCALE);
    lighting.dispose();
  });

  it("turns the dome's capture branch on for each face the probe draws, and off after it", () => {
    const s = scene();
    const lighting = light(s);
    captureOf(s).onBeforeRenderObservable.notifyObservers(0);
    expect(dome.captures).toEqual([true]);
    captureOf(s).onAfterRenderObservable.notifyObservers(0);
    expect(dome.captures).toEqual([true, false]);
    lighting.dispose();
  });

  it("hands the dome each state it applies, with the image's exposure, and re-arms the probe", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    expect(dome.updates.length).toBe(1);
    expect(dome.updates[0]!.state).toBe(lighting.sky);
    expect(dome.updates[0]!.exposure).toBe(s.imageProcessingConfiguration.exposure);
    captureOf(s).refreshRate = 60;
    lighting.setHour(15);
    expect(dome.updates.length).toBe(2);
    expect(dome.updates[1]!.state).toBe(lighting.sky);
    // REFRESHRATE_RENDER_ONCE: one capture of the dome as it now stands.
    expect(captureOf(s).refreshRate).toBe(0);
    lighting.dispose();
  });

  it("sets the sun from the sky state: SUN_PEAK at clear noon, its colour on its diffuse and its specular alike", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    const sun = sunOf(s);
    expect(sun.intensity).toBeCloseTo(4, 6);
    const c = lighting.sky!.sunColour;
    expect([sun.diffuse.r, sun.diffuse.g, sun.diffuse.b]).toEqual([c.r, c.g, c.b]);
    expect(sun.specular).toBe(sun.diffuse);
    // SUN_PEAK x (1 - SUN_CLOUD_LOSS x 0.9): mist's cloud takes 81 % of the noon sun.
    lighting.setWeather(WEATHER_PRESETS.mist, 0);
    expect(sun.intensity).toBeCloseTo(0.76, 6);
    // Full cloud: SUN_CLOUD_LOSS of it.
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(sun.intensity).toBeCloseTo(0.4, 6);
    lighting.dispose();
  });

  it("sets the fill from the sky state: FILL_DAY at clear noon, lifted under cloud, collapsed on the top dread plateau", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    const fill = fillOf(s);
    expect(fill.intensity).toBeCloseTo(0.15, 6);
    const c = lighting.sky!.fillColour;
    expect([fill.diffuse.r, fill.diffuse.g, fill.diffuse.b]).toEqual([c.r, c.g, c.b]);
    // FILL_DAY x (1 + FILL_LIFT x 0.9).
    lighting.setWeather(WEATHER_PRESETS.mist, 0);
    expect(fill.intensity).toBeCloseTo(0.4875, 6);
    // FILL_DAY x (1 + FILL_LIFT) on the state, x (1 - AMBIENT_COLLAPSE) on the light.
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(lighting.sky!.fillIntensity).toBeCloseTo(0.525, 6);
    expect(fill.intensity).toBeCloseTo(0.13125, 6);
    lighting.dispose();
  });

  it("sets exponential-squared fog at the requested view distance", () => {
    const s = scene();
    const lighting = light(s, { viewDistance: 250, weather: CLEAR });
    expect(s.fogMode).toBe(Scene.FOGMODE_EXP2);
    expect(s.fogDensity).toBeCloseTo(fogDensityFor(250), 10);
    lighting.dispose();
  });

  it("on the material path uses Khronos Neutral tone mapping with dithering and tracks exposure to the sun", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    const ip = s.imageProcessingConfiguration;
    expect(ip.toneMappingEnabled).toBe(true);
    expect(ip.toneMappingType).toBe(ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL);
    expect(ip.ditheringEnabled).toBe(true);
    expect(ip.applyByPostProcess).toBe(false);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(12).y), 5);
    lighting.setHour(0);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(0).y), 5);
    // Night must be the brighter exposure, or `/time 0` renders as pure black.
    expect(ip.exposure).toBeGreaterThan(exposureFor(sunPositionAt(12).y));
    lighting.dispose();
  });

  it("on the post path hands colour to the post chain", () => {
    const s = scene();
    const lighting = light(s, { tier: "high", hour: 12, colourPath: "post" });
    const ip = s.imageProcessingConfiguration;
    expect(ip.applyByPostProcess).toBe(true);
    expect(ip.toneMappingEnabled).toBe(false);
    expect(ip.colorCurvesEnabled).toBe(false);
    expect(ip.vignetteEnabled).toBe(false);
    lighting.dispose();
  });

  it("collapses the ambient on the top dread plateau", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const before = s.environmentIntensity;
    const fillBefore = fillOf(s).intensity;
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(s.environmentIntensity).toBeCloseTo(before * ambientCollapseUnder(WEATHER_PRESETS.eerie), 10);
    expect(fillOf(s).intensity).toBeLessThan(fillBefore);
    lighting.dispose();
  });

  it("installs an environment texture, so PBR has something to reflect", () => {
    // Without this, PBR metals read as flat grey and everything looks like plastic.
    const s = scene();
    const lighting = light(s);
    expect(s.environmentTexture).not.toBeNull();
    lighting.dispose();
  });

  it("applies the tier's hardware scaling to the engine", () => {
    // A spy on the call, not a readback of the engine's state: NullEngine's
    // getHardwareScalingLevel() is hardcoded to 1.0 in 9.18.0 and ignores
    // whatever the setter stored, so a readback assertion would be vacuous at
    // "medium" (1 either way) and impossible at "low" (never reads back 1.5).
    // Two tiers, not one, because low and medium are the only distinct values
    // in the table (high matches medium at 1).
    const low = scene();
    const setLow = vi.spyOn(low.getEngine(), "setHardwareScalingLevel");
    const lightingLow = light(low, { tier: "low" });
    expect(setLow).toHaveBeenCalledWith(QUALITY.low.hardwareScaling);
    lightingLow.dispose();
    // scene() reassigns the shared `engine` tracker, and afterEach disposes only
    // the last one: dispose this engine now rather than leak it.
    low.getEngine().dispose();

    const medium = scene();
    const setMedium = vi.spyOn(medium.getEngine(), "setHardwareScalingLevel");
    const lightingMedium = light(medium, { tier: "medium" });
    expect(setMedium).toHaveBeenCalledWith(QUALITY.medium.hardwareScaling);
    lightingMedium.dispose();
  });

  it("disposes every object it created", () => {
    // dispose() releases the objects createLighting created (the dome, the
    // lights, the probe). It does not restore borrowed scene state, which is
    // documented on `Lighting.dispose`: the renderer disposes the whole Scene.
    const s = scene();
    const before = s.meshes.length;
    const lighting = light(s);
    expect(s.meshes.length).toBeGreaterThan(before);
    lighting.dispose();
    expect(s.meshes.length).toBe(before);
    expect(s.getLightByName("sun")).toBeNull();
    expect(s.getLightByName("fill")).toBeNull();
    expect(dome.disposed).toBe(1);
    // ReflectionProbe.dispose() disposes its render target and nulls its own
    // reference, but never touches scene.environmentTexture.
    expect(s.environmentTexture).toBeNull();
  });

  it("tolerates addShadowMesh when there are no shadows", () => {
    // The low tier and any engine without float render targets both take this
    // path, so the caller must not have to check.
    const s = scene();
    const lighting = light(s, { tier: "low" });
    const box = s.meshes[0];
    expect(box).toBeDefined();
    expect(() => lighting.addShadowMesh(box!)).not.toThrow();
    lighting.dispose();
  });

  it("tolerates removeShadowMesh when there are no shadows", () => {
    // The inverse of addShadowMesh, needed because Babylon's own
    // `AbstractMesh.dispose` does NOT take the mesh out of a shadow
    // generator's render list. The add/remove pairing itself is covered from
    // the caller's side, against a recording stand-in, in wildlifeMeshes.test.ts.
    const s = scene();
    const lighting = light(s);
    expect(lighting.shadows).toBeNull();
    const box = s.meshes[0];
    expect(box).toBeDefined();
    lighting.addShadowMesh(box!);
    expect(() => lighting.removeShadowMesh(box!)).not.toThrow();
    lighting.dispose();
  });

  it("marks a registered mesh as a shadow receiver, not just a caster", () => {
    const s = scene();
    const lighting = light(s);
    const box = s.meshes[0];
    expect(box).toBeDefined();
    box!.receiveShadows = false;
    lighting.addShadowMesh(box!);
    expect(box!.receiveShadows).toBe(true);
    lighting.dispose();
  });
});

describe("the sky's table", () => {
  it("reads the sun's altitude in degrees, the deep night's below the lowest slice", () => {
    expect(sunAltitudeDeg(12)).toBeCloseTo(75.96375653207352, 10);
    expect(sunAltitudeDeg(15)).toBeCloseTo(43.31385665828306, 10);
    expect(sunAltitudeDeg(18.25)).toBeCloseTo(-3.6378813445700504, 10);
    expect(sunAltitudeDeg(0)).toBeCloseTo(-75.96375653207352, 10);
  });

  it("applies nothing before the table holds the slices either side of noon and of the hour, and applies once it does", () => {
    const s = scene();
    const table = createSkyTable();
    const lighting = light(s, { hour: 12, weather: CLEAR, sky: table });
    expect(lighting.sky).toBeNull();
    expect(dome.updates).toEqual([]);
    // Babylon's defaults stand: nothing of the sky has been applied.
    expect(sunOf(s).intensity).toBe(1);
    expect(fillOf(s).intensity).toBe(1);
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    expect(lighting.sky).toBeNull();
    table.add(fixture.blendAt(76));
    expect(lighting.sky).not.toBeNull();
    expect(dome.updates.length).toBe(1);
    expect(sunOf(s).intensity).toBeCloseTo(4, 6);
    lighting.dispose();
  });

  it("waits again for an hour whose slices are not in, keeping the last state, and applies when they arrive", () => {
    const s = scene();
    const table = createSkyTable();
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    const lighting = light(s, { hour: 12, weather: CLEAR, sky: table });
    const noon = lighting.sky;
    expect(noon?.hour).toBe(12);
    lighting.setHour(15);
    expect(lighting.sky).toBe(noon);
    expect(dome.updates.length).toBe(1);
    // 15:00's sun stands at 43.3 degrees, between the slices at 42 and 44.
    table.add(fixture.blendAt(42));
    table.add(fixture.blendAt(44));
    expect(lighting.sky?.hour).toBe(15);
    expect(dome.updates.length).toBe(2);
    // Once the hour's slices are in, a slice for another hour changes nothing.
    table.add(fixture.blendAt(28));
    expect(dome.updates.length).toBe(2);
    lighting.dispose();
  });

  it("reads the deep night from the lowest slice", () => {
    const s = scene();
    const table = createSkyTable();
    const fixture = skyFixture();
    for (const deg of [74, 76, -18]) table.add(fixture.blendAt(deg));
    const lighting = light(s, { hour: 0, weather: CLEAR, sky: table });
    expect(lighting.sky?.hour).toBe(0);
    lighting.dispose();
  });

  it("stops listening to the table when disposed", () => {
    const s = scene();
    const table = createSkyTable();
    const lighting = light(s, { hour: 12, sky: table });
    lighting.dispose();
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    expect(dome.updates).toEqual([]);
  });
});

describe("weather in lighting", () => {
  it("defaults to the mist preset — fog, sun and exposure all shifted", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    const w = WEATHER_PRESETS.mist;
    expect(lighting.weather).toEqual(w);
    expect(s.fogDensity).toBeCloseTo(fogDensityUnder(w, 70), 12);
    // SUN_PEAK x (1 - SUN_CLOUD_LOSS x 0.9).
    expect(sunOf(s).intensity).toBeCloseTo(0.76, 6);
    expect(s.imageProcessingConfiguration.exposure).toBeCloseTo(exposureUnder(w, sunPositionAt(12).y), 12);
    lighting.dispose();
  });

  it("explicit clear weather keeps the clear anchors exactly", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    expect(s.fogDensity).toBe(fogDensityFor(70));
    expect(s.imageProcessingConfiguration.exposure).toBe(exposureFor(sunPositionAt(12).y));
    expect(lighting.sky!.cloud).toBe(0);
    expect(sunOf(s).intensity).toBeCloseTo(4, 6);
    expect(fillOf(s).intensity).toBeCloseTo(0.15, 6);
    expect(s.imageProcessingConfiguration.colorCurves?.globalSaturation).toBe(0);
    lighting.dispose();
  });

  it("setWeather with fade 0 applies instantly; the dome follows", () => {
    const s = scene();
    const lighting = light(s, { hour: 12 });
    lighting.setWeather(CLEAR, 0);
    expect(lighting.weather).toEqual(CLEAR);
    expect(s.fogDensity).toBe(fogDensityFor(70));
    expect(dome.updates.at(-1)!.state.cloud).toBe(0);
    lighting.setWeather(WEATHER_PRESETS.rain, 0);
    expect(dome.updates.at(-1)!.state.cloud).toBe(1);
    expect(dome.updates.at(-1)!.exposure).toBe(s.imageProcessingConfiguration.exposure);
    lighting.dispose();
  });

  it("a timed fade does not jump: current weather is unchanged until a frame renders", () => {
    const s = scene();
    const lighting = light(s, { hour: 12, weather: CLEAR });
    lighting.setWeather(WEATHER_PRESETS.rain, 3);
    expect(lighting.weather).toEqual(CLEAR);
    lighting.dispose();
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run --root client test/game/lighting.test.ts`. Expected: FAIL. Among the failures: "the sky's table > reads the sun's altitude…" with `TypeError: sunAltitudeDeg is not a function`; "the sky's table > applies nothing before…" with `expected undefined to be null` (today's lighting has no `sky`); "draws the dome…" with `expected null not to be null` (no mesh named `skyDome`).

- [ ] **Step 3: Rewrite the lighting on the sky state.** Replace the whole of `client/src/game/lighting.ts` with:

```ts
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
// Non-`.pure` imports, and it is load-bearing. Babylon 9 splits each of these
// into a `.pure.js` half that defines behaviour and a wrapper that registers it.
// `cascadedShadowGenerator.js` calls RegisterCascadedShadowGenerator();
// `reflectionProbe.js` calls RegisterReflectionProbe(). Import the `.pure` paths
// instead and there is no error and no shadows — the same failure mode that cost
// hours on thin instances in `renderer.ts`.
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe.js";

import { QUALITY, type QualityTier } from "./quality.js";
import { sunPositionAt } from "./sky.js";
import { NOON_ALTITUDE_DEG, type SkyTable } from "./skyTable.js";
import { SKY_IBL_SCALE, skyStateFor, type SkyState } from "./skyState.js";
import { createSkyDome } from "./skyDome.js";
import {
  DEFAULT_WEATHER,
  WEATHER_PRESETS,
  weatherFadeAt,
  type WeatherParams,
  fogDensityUnder,
  shadowDarknessUnder,
  exposureUnder,
  ambientCollapseUnder,
} from "./weather.js";

/** Matches the `/time` command's `defaultValue` in `commands.ts`. */
export const DEFAULT_HOUR = 12;

/** Cube face resolution for the environment probe. */
const PROBE_SIZE = 128;

/**
 * The sun's altitude at `hour`, in degrees: the altitude the sky's table is
 * read at. Below the lowest slice the table serves the lowest slice
 * (`sliceBracket`), so the deep night needs no slice of its own.
 */
export function sunAltitudeDeg(hour: number): number {
  return (Math.asin(sunPositionAt(hour).y) * 180) / Math.PI;
}

/**
 * Whether `table` holds what the sky state at `hour` is made from: the
 * slices either side of noon, which fix the scale and the adaptation, and
 * those either side of the hour's sun.
 */
export function skyHeld(table: SkyTable, hour: number): boolean {
  return table.has(NOON_ALTITUDE_DEG) && table.has(sunAltitudeDeg(hour));
}

/**
 * How far cascaded shadows reach, in metres. Deliberately NOT `viewDistance`.
 *
 * The two were one number while the fog horizon was 70 m and the difference did
 * not exist. It does now: the fog reaches 4 km, and feeding that to
 * `shadowMaxZ` stretches the same four cascades across 57× the depth. Babylon
 * splits the frustum at `lambda·log + (1-lambda)·uniform` (`_splitFrustum`),
 * and with the camera's 0.05 m near plane the log term is negligible, so the
 * first cascade's extent tracks `shadowMaxZ` almost linearly: 2.0 m at 70 m,
 * 100.8 m at 4000 m. That is a ~50× coarser near-field shadow texel, spent
 * entirely on shadows kilometres away that 4 km of haze has already washed
 * flat. At 300 m the first cascade is 7.9 m — 3.9× the texel the `normalBias`
 * below was tuned against, rather than 49.7×.
 *
 * A few hundred metres is the useful shadow range at any view distance: cast
 * shadows read at human and boulder scale, while a mountain's own form comes
 * from its normals and the sun angle, not from the shadow it throws on the next
 * ridge.
 */
const SHADOW_DISTANCE = 300;

export type LightingOptions = {
  tier: QualityTier;
  /** Distance at which fog has all but hidden the world, in metres. */
  viewDistance: number;
  hour?: number;
  weather?: WeatherParams;
  /**
   * Who owns colour. `"post"`: the grade pass tone-maps, grades and
   * vignettes, so materials output linear HDR (`applyByPostProcess`).
   * `"material"`: no post chain exists (low tier, or no float targets), so
   * Babylon's in-material processing carries the intent with Khronos Neutral,
   * the colour curves and dithering. Decided by `postFeaturesFor` in
   * postParams.ts before either this or the post chain is built.
   */
  colourPath: "post" | "material";
  /**
   * The sky's slices (`skyTable.ts`), filled off the main thread by whoever
   * made the table (`skyWorker.ts`). Nothing of the sky is applied until the
   * table holds the slices either side of noon and of the hour (`skyHeld`);
   * a slice that arrives while that waits tries again.
   */
  sky: SkyTable;
};

export type Lighting = {
  setHour(hour: number): void;
  readonly hour: number;
  /**
   * Starts a fade from the current weather to `next` over `fadeSeconds`
   * (default 3 s). `0` (or negative) applies instantly, with no observer tick
   * required — see the mutation check in `lighting.test.ts` for why that
   * distinction is load-bearing.
   */
  setWeather(next: WeatherParams, fadeSeconds?: number): void;
  /** A copy of the current, possibly mid-fade, weather parameters. */
  readonly weather: WeatherParams;
  /**
   * The sky state of the last apply (`skyStateFor`), a new object each
   * apply: what the dome drew and what the haze and the grade read. Null
   * until the table first holds the slices either side of noon and of the
   * hour.
   */
  readonly sky: SkyState | null;
  readonly shadows: CascadedShadowGenerator | null;
  /** The direction the sun's light travels (the directional light's own
   * vector, live, not a copy): the negation of the direction to the sun. */
  readonly sunDirection: Vector3;
  /**
   * Registers `mesh` as a shadow caster and marks it as a receiver too.
   *
   * In this scene a mesh that casts almost always should also receive: a
   * boulder or a tree trunk standing inside another object's shadow needs to
   * show it, not stay fully lit. Terrain is the one caller that also sets
   * `receiveShadows` itself, directly on the mesh in `createClipmapMesh`,
   * because that function is tested without a `Lighting` in the loop — this
   * still runs for it too, redundantly but harmlessly, when the renderer
   * wires it up as a caster.
   */
  addShadowMesh(mesh: AbstractMesh): void;
  /**
   * Takes a mesh back out of the shadow map. Needed because Babylon's
   * `AbstractMesh.dispose` does NOT remove the mesh from a shadow generator's
   * render list, so anything whose meshes come and go — the pooled wildlife
   * creatures, which are acquired and released as the player walks — would
   * otherwise leave the generator holding every disposed animal forever.
   * Leaves `receiveShadows` alone: it describes the mesh, not the registry,
   * and a mesh that stops casting still receives.
   */
  removeShadowMesh(mesh: AbstractMesh): void;
  /**
   * Releases the objects this created: the sky dome, the sun and fill
   * lights, the shadow generator and the reflection probe, and stops
   * listening to the sky's table, which outlives it. It does not restore the
   * scene state it borrowed and mutated in place — fog mode, density and
   * colour, clear colour, tone-mapping enabled/type/contrast, exposure, and
   * the engine's hardware scaling are the caller's to reset, because
   * `createLighting` never held them, only set them. In practice the renderer
   * disposes the whole `Scene` on teardown, so restoring here would be dead
   * code; if that ever stops being true, restoring becomes this function's
   * job too.
   */
  dispose(): void;
};

/**
 * Everything that turns a scene from flat to lit: the scattering sky's dome,
 * a sun with cascaded shadows, image-based ambient captured from that dome,
 * aerial perspective tinted to match, and one of two colour paths — the grade
 * pass on `"post"`, Babylon's own Khronos Neutral tone mapping and colour
 * curves on `"material"` — chosen by `postFeaturesFor` in postParams.ts.
 *
 * This is the Babylon shell. Every number it applies comes from the sky state
 * (`skyState.ts`, made from the table's slices), `weather.ts` and
 * `quality.ts`, which are pure and tested; what is left here is wiring, and
 * the traps are in the wiring rather than the arithmetic.
 *
 * On the sky, there are two valid paths and this is the development
 * one: a dynamic sky captured to a reflection probe, which is what lets the sun
 * move. Shipped levels are to use a baked `.env` instead, because a probe's cube
 * is not prefiltered and its glossy response at high roughness is approximate.
 * Acceptable here precisely because terrain is almost entirely rough.
 */
export function createLighting(scene: Scene, options: LightingOptions): Lighting {
  const settings = QUALITY[options.tier];
  const table = options.sky;
  let hour = options.hour ?? DEFAULT_HOUR;
  let weather: WeatherParams = { ...(options.weather ?? WEATHER_PRESETS[DEFAULT_WEATHER]) };
  const viewDistance = options.viewDistance;
  let fadeFrom: WeatherParams | null = null;
  let fadeTarget: WeatherParams = weather;
  let fadeDuration = 0;
  let fadeElapsed = 0;
  /** The state of the last apply that found its slices; null before the first. */
  let sky: SkyState | null = null;
  /** The last apply found the table without its slices: the next slice to arrive applies again. */
  let waiting = true;

  scene.getEngine().setHardwareScalingLevel(settings.hardwareScaling);

  // The dome: the sky's table drawn on a box that rides with the camera. It
  // adds no light, so the sun below stays light 0 and the fill light 1, the
  // order the foliage light plugin reads them in.
  const dome = createSkyDome(scene, options.colourPath);

  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  // Hemispheric fill stays for ambient. Its intensity and colour are the sky
  // state's, set by `apply()` once the table holds its slices; until then it
  // keeps Babylon's defaults, which no frame shows.
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);

  // CascadedShadowGenerator needs float or half-float render targets, which
  // NullEngine does not have and weak hardware may not either. Constructing it
  // regardless throws, so the check is not optional — and the low tier wants no
  // shadows anyway.
  const shadows =
    settings.shadowMapSize > 0 && CascadedShadowGenerator.IsSupported
      ? new CascadedShadowGenerator(settings.shadowMapSize, sun)
      : null;
  if (shadows !== null) {
    shadows.numCascades = settings.shadowCascades;
    // Stabilisation is chosen deliberately over `autoCalcDepthBounds`, not merely
    // left at a default: the two fight, since stabilisation exists to stop
    // cascade bounds shimmering while `autoCalcDepthBounds` recomputes the depth
    // range every frame and pushes it through `setMinMaxDistance()`, moving the
    // split planes every frame. (`autoCalcDepthBounds` would also be a silent
    // no-op today regardless, since its setter early-returns when
    // `scene.activeCamera` is null at construction, which it is here — but that
    // ordering hazard is a second reason to drop it, not the main one.) This is
    // look-development for judging terrain shape with a freecam, so a stable
    // image beats marginally sharper shadows, and skipping the recompute also
    // costs one fewer depth-reduction pass per frame. Revisit once someone has
    // actually flown around and looked.
    shadows.stabilizeCascades = true;
    shadows.lambda = 0.9;
    shadows.shadowMaxZ = SHADOW_DISTANCE;
    // Already the constructor default; pinned explicitly so it reads as a
    // deliberate choice rather than an oversight among the settings above that
    // are load-bearing.
    shadows.usePercentageCloserFiltering = true;
    // Terrain registers itself as its own shadow caster (see `renderer.ts`), and
    // at the default normalBias of 0 that produced textbook self-shadow acne: a
    // concentric moiré ripple across the whole ground, confirmed in the browser
    // by removing terrain from the caster list and watching it vanish. 0.05 was
    // found by looking — nudged up from 0 until the ripple cleared while
    // hill-still-shadows-hill was preserved — not derived from the shadow map
    // resolution or texel size. Two things have moved under it since: the
    // terrain is genuinely steep now rather than the old gentle heightfield,
    // and acne severity scales with slope; and SHADOW_DISTANCE above changed
    // the cascade-0 texel it was calibrated against, by 3.9× rather than the
    // 49.7× that tying shadows to the fog horizon would have caused. Both say
    // this number wants re-checking by eye in a browser, not by arithmetic.
    //
    // Re-checked by eye, and 0.05 was indeed too low for the montane field: the
    // concentric ripple was back across the entire near ground, at every hour
    // tried. Swept 0.05 → 0.3 → 0.6 against a fixed camera. 0.3 clears it
    // wherever the first cascade lands; 0.6 is indistinguishable from 0.3 apart
    // from a slightly cleaner far strip, so it buys nothing worth the extra
    // contact-shadow offset. The large-scale light-and-dark modelling of the
    // hills is pixel-for-pixel unchanged between 0.05 and 0.3 — only the ripple
    // goes — so nothing real was traded away for it.
    shadows.normalBias = 0.3;
  }

  // Half float where the engine renders it: the dusk horizon is brighter
  // than 1, and an 8-bit capture clipped it before any material read it.
  // Half float rather than float because RGBA16F filters on WebGL2 and on
  // WebGPU's core features alike. Gamma-flagged (linearSpace false) as it
  // always was: a linear probe flips Babylon's GAMMAREFLECTION define in
  // every PBR material, so the dome's capture branch writes the gamma
  // encoding instead and every material decodes the dome's linear radiance.
  const halfFloatTargets = scene.getEngine().getCaps().textureHalfFloatRender;
  const probe = new ReflectionProbe("environment", PROBE_SIZE, scene, true, halfFloatTargets, false);
  // Assignment, not `renderList?.push(...)`: a null `renderList` means "render
  // the entire scene" in Babylon, so the optional chain would silently skip
  // rather than fail loudly if that default ever changed.
  probe.renderList = [dome.mesh];
  // The sky changes only with the hour, the weather or the table, so
  // re-rendering the probe every frame would be six cube faces of pure waste.
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  // Each face the probe draws takes the dome's capture branch: the gamma
  // encoding of the linear composition on either colour path, never tone
  // mapped, and the sun's disc capped so a few texels of HDR sun do not
  // sparkle in rough reflections.
  const capture = probe.cubeTexture;
  const captureOn = capture.onBeforeRenderObservable.add(() => dome.setCapture(true));
  const captureOff = capture.onAfterRenderObservable.add(() => dome.setCapture(false));
  scene.environmentTexture = capture;

  const image = scene.imageProcessingConfiguration;
  if (options.colourPath === "post") {
    image.applyByPostProcess = true;
    image.toneMappingEnabled = false;
    image.colorCurvesEnabled = false;
    image.vignetteEnabled = false;
  } else {
    image.applyByPostProcess = false;
    image.toneMappingEnabled = true;
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    image.contrast = 1.1;
    image.ditheringEnabled = true;
    // Colour curves carry the split-tone grade on this path, written by
    // post.ts's update() rather than here — see the doc comment above
    // createLighting. Neutral is 0 on Babylon's scale, so enabling them under
    // clear weather changes nothing.
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }

  scene.fogMode = Scene.FOGMODE_EXP2;

  function apply(): void {
    // Until the table holds the slices either side of noon and of the hour,
    // the state cannot be made: whatever stands (the defaults, or the last
    // hour's light) stays, and the next slice to arrive tries again.
    waiting = !skyHeld(table, hour);
    if (waiting) return;
    const s = skyStateFor(table, hour, weather);
    sky = s;

    // A DirectionalLight's `direction` is the direction light TRAVELS, which is
    // the negation of the direction toward the sun. Backwards here lights the
    // world from underground at noon.
    sun.direction.set(-s.sunDir.x, -s.sunDir.y, -s.sunDir.z);
    sun.intensity = s.sunIntensity;
    sun.diffuse = new Color3(s.sunColour.r, s.sunColour.g, s.sunColour.b);
    // Specular defaults to white; without this, sunrise goes warm orange while
    // every highlight stays neutral, disagreeing about what colour the sun is.
    sun.specular = sun.diffuse;

    // The fog and the clear colour are the dome's horizon away from the sun
    // under the weather's mist (`SkyState.mistAir`), so the haze dissolves into
    // the sky it stands against. The clear colour matters even behind the
    // dome: it is what shows through on any frame the dome has not drawn.
    scene.fogColor = new Color3(s.mistAir.r, s.mistAir.g, s.mistAir.b);
    scene.clearColor = new Color4(s.mistAir.r, s.mistAir.g, s.mistAir.b, 1);
    scene.fogDensity = fogDensityUnder(weather, viewDistance);

    // The fill: the sky's light on level ground by day and moonlight by night,
    // weighed by the night factor (`skyState.ts`). By day the probe below does
    // most of the ambient work; at night the fill is the light left.
    fill.diffuse = new Color3(s.fillColour.r, s.fillColour.g, s.fillColour.b);
    const collapse = ambientCollapseUnder(weather);
    fill.intensity = s.fillIntensity * collapse;
    // The probe's share of the ambient collapses with the fill, so the top
    // plateau reads as the light going, not the fill alone dimming.
    scene.environmentIntensity = collapse * SKY_IBL_SCALE;

    // Read on both paths: the grade pass reads it from the same record, and on
    // the post path the value is simply unused by materials.
    image.exposure = exposureUnder(weather, s.sunDir.y);
    // Overcast has no directional shadows: fade them rather than reconfigure the CSM.
    shadows?.setDarkness(shadowDarknessUnder(weather));

    dome.update(s, image.exposure);
    // One more capture of the dome as it now stands, then idle again.
    capture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  }

  // A slice that arrives while an apply waits for one tries it again. Once
  // the table holds an hour's slices, later ones fill hours the sun has not
  // reached and change nothing for this one.
  const offTable = table.onChange(() => {
    if (waiting) apply();
  });

  // The /weather fade — and the escalation's turn toward eerie — advance
  // here. apply() re-renders the probe each tick; its render list is one dome,
  // six cheap faces.
  const fadeObserver = scene.onBeforeRenderObservable.add(() => {
    if (fadeFrom === null) return;
    fadeElapsed += scene.getEngine().getDeltaTime() / 1000;
    weather = weatherFadeAt(fadeFrom, fadeTarget, fadeElapsed, fadeDuration);
    if (fadeElapsed >= fadeDuration) fadeFrom = null;
    apply();
  });

  apply();

  return {
    get hour() {
      return hour;
    },
    get weather() {
      return { ...weather };
    },
    get sky() {
      return sky;
    },
    get sunDirection() {
      return sun.direction;
    },
    shadows,
    setHour(next) {
      hour = next;
      apply();
    },
    setWeather(next, fadeSeconds = 3) {
      if (fadeSeconds <= 0) {
        weather = { ...next };
        fadeFrom = null;
        apply();
        return;
      }
      fadeFrom = { ...weather };
      fadeTarget = { ...next };
      fadeDuration = fadeSeconds;
      fadeElapsed = 0;
    },
    addShadowMesh(mesh) {
      mesh.receiveShadows = true;
      shadows?.addShadowCaster(mesh);
    },
    removeShadowMesh(mesh) {
      shadows?.removeShadowCaster(mesh);
    },
    dispose() {
      offTable();
      scene.onBeforeRenderObservable.remove(fadeObserver);
      capture.onBeforeRenderObservable.remove(captureOn);
      capture.onAfterRenderObservable.remove(captureOff);
      // Guarded by identity: only clear the environment texture if it is still
      // the one this created. ReflectionProbe.dispose() disposes its render
      // target and nulls its own reference but never touches
      // `scene.environmentTexture`, which would otherwise keep pointing at a
      // disposed cube texture that `scene.pure.js` re-adds to `_renderTargets`
      // every frame. The identity check means this never clobbers an
      // environment texture something else installed instead.
      if (scene.environmentTexture === capture) {
        scene.environmentTexture = null;
      }
      probe.dispose();
      shadows?.dispose();
      sun.dispose();
      fill.dispose();
      dome.dispose();
    },
  };
}
```

- [ ] **Step 4: Run it and see it pass.** Run `npx vitest run --root client test/game/lighting.test.ts`. Expected: PASS, 33 tests.

- [ ] **Step 5: Put the other suites that build the lighting on the fixture's sky.**
  - `client/test/game/interStage.test.ts`: after line 36 (`import { timeLimit } from "../helpers/timeLimit.js";`) add `import { skyFixture } from "./helpers/skyFixture.js";`. At line 143 replace `const lighting = createLighting(scene, { tier: "high", viewDistance: FOG_DISTANCE, colourPath: "post" });` with `const lighting = createLighting(scene, { tier: "high", viewDistance: FOG_DISTANCE, colourPath: "post", sky: skyFixture() });`. At line 352, in the drawn list, replace `"skyMaterial",` with `"skyDome",` (it sorts in the same place, between `"deadwood.snag.material0"` and `"tree.conifer_a.material0"`).
  - `client/test/game/stageBindings.test.ts`: after line 51 (`import { timeLimit } from "../helpers/timeLimit.js";`) add `import { skyFixture } from "./helpers/skyFixture.js";`. At line 101 make the same `createLighting` replacement as in `interStage.test.ts`. The `expect(world.drawn.size).toBe(21)` pin stays: the dome's material stands in the sky material's place, and the 7 lights are unchanged.
  - `client/test/game/foliageLightPlugin.test.ts`: after line 10 (`import { createLighting } from "../../src/game/lighting.js";`) add `import { skyFixture } from "./helpers/skyFixture.js";`. Replace lines 33–38:

```ts
  it("the sun is light 0", () => {
    const s = new Scene(new NullEngine());
    createLighting(s, { tier: "high", viewDistance: 70, colourPath: "material" });
    expect(s.lights[0]!.name).toBe("sun");
    s.getEngine().dispose();
  });
```

with:

```ts
  it("the sun is light 0 and the fill light 1", () => {
    const s = new Scene(new NullEngine());
    createLighting(s, { tier: "high", viewDistance: 70, colourPath: "material", sky: skyFixture() });
    expect(s.lights[0]!.name).toBe("sun");
    expect(s.lights[1]!.name).toBe("fill");
    s.getEngine().dispose();
  });
```

- [ ] **Step 6: Run them and see them pass.** Run `npx vitest run --root client test/game/interStage.test.ts test/game/stageBindings.test.ts test/game/foliageLightPlugin.test.ts`. Expected: PASS. (The dome's material is processed by Babylon's WebGPU GLSL path on `NullEngine` like every other drawn material; if `drawnEffect` throws `skyDome never became ready on the NullEngine`, the fault is in the dome's material, not here.)

- [ ] **Step 7: Write the failing renderer tests.** In `client/test/game/renderer.test.ts`:
  - After the `vi.mock("@babylonjs/core/Engines/engine.js", …)` block (it ends at line 44), add:

```ts
// The sky source a renderer starts when it is given no table: here the
// fixture's table, at once, so every renderer in this file lights itself as
// it is built, with a record of each source started and stopped.
const skySources = vi.hoisted(() => ({ started: [] as number[], stopped: 0 }));
vi.mock("../../src/game/skyWorker.js", async () => {
  const { skyFixture } = await import("./helpers/skyFixture.js");
  return {
    startSkySource: (startDeg: number) => {
      skySources.started.push(startDeg);
      return {
        table: skyFixture(),
        dispose: () => {
          skySources.stopped += 1;
        },
      };
    },
  };
});
```

  - After line 94 (`import { timeLimit } from "../helpers/timeLimit.js";`) add `import { skyFixture } from "./helpers/skyFixture.js";`.
  - Before line 377 (`describe("the renderer's engine", () => {`) add:

```ts
describe("the renderer's sky", () => {
  it("starts a source of its own at the default hour's sun when it is given no table, and stops it with itself", () => {
    skySources.started.length = 0;
    skySources.stopped = 0;
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low" });
    // Noon's sun, 75.96 degrees up the tilted arc.
    expect(skySources.started.length).toBe(1);
    expect(skySources.started[0]).toBeCloseTo(75.96375653207352, 10);
    expect(skySources.stopped).toBe(0);
    renderer.dispose();
    expect(skySources.stopped).toBe(1);
  });

  it("reads a table it is given, and starts and stops no source of its own", () => {
    skySources.started.length = 0;
    skySources.stopped = 0;
    const renderer = createRenderer({} as unknown as HTMLCanvasElement, EMPTY_LEVEL, null, { tier: "low", skyTable: skyFixture() });
    renderer.dispose();
    expect(skySources.started).toEqual([]);
    expect(skySources.stopped).toBe(0);
  });
});

```

  - At line 866, in "names the same parts in the dispose list and in the failed build's teardown", replace `expect(disposed.size).toBe(21);` with `expect(disposed.size).toBe(22);` (the renderer's own sky source is the new part).

- [ ] **Step 8: Run it and see it fail.** Run `npx vitest run --root client test/game/renderer.test.ts`. Expected: FAIL in "the renderer's sky > starts a source of its own…" with `expected 0 to be 1`, and in "names the same parts…" with `expected 21 to be 22`.

- [ ] **Step 9: Make or take the table in the renderer.** In `client/src/game/renderer.ts`:
  - Replace line 53, `import { createLighting } from "./lighting.js";`, with:

```ts
import { createLighting, DEFAULT_HOUR, sunAltitudeDeg } from "./lighting.js";
import type { SkyTable } from "./skyTable.js";
import { startSkySource, type SkySource } from "./skyWorker.js";
```

  - In `RendererOptions`, after the `wildlife?: boolean;` member (line 1232) and before the closing `};`, add:

```ts
  /** The sky's slices (`skyTable.ts`): the page's table, made once for its
   * life (`app.ts`) and handed to every renderer it builds, so a swap of
   * tier makes none of them again. Absent, the renderer starts a source of
   * its own (`startSkySource`) and stops it on dispose. */
  skyTable?: SkyTable;
```

  - Replace lines 1481–1483:

```ts
  const postFeatures = postFeaturesFor(tier, fxSupportedBy(engine));
  const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: postFeatures.colourPath });
  partOf(lighting);
```

with:

```ts
  const postFeatures = postFeaturesFor(tier, fxSupportedBy(engine));
  // The sky's slices: the page's table or, given none, a source of this
  // renderer's own, started at the default hour (the slices either side of
  // noon come first whatever the hour) and stopped with the renderer.
  let ownSky: SkySource | null = null;
  let skyTable: SkyTable;
  if (options.skyTable !== undefined) {
    skyTable = options.skyTable;
  } else {
    ownSky = startSkySource(sunAltitudeDeg(DEFAULT_HOUR));
    skyTable = ownSky.table;
  }
  partOf(ownSky);
  const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: postFeatures.colourPath, sky: skyTable });
  partOf(lighting);
```

  - In `dispose()`, replace

```ts
      lighting.dispose();
      atmosphere.dispose();
```

with:

```ts
      lighting.dispose();
      // After the lighting, which stops listening to its table first.
      ownSky?.dispose();
      atmosphere.dispose();
```

- [ ] **Step 10: Run the renderer suites and see them pass.** Run `npx vitest run --root client test/game/renderer.test.ts test/game/rendererCleanup.test.ts test/game/rendererTeardown.test.ts test/game/rendererSwap.test.ts test/game/rendererStart.test.ts test/game/rendererFilmCamera.test.ts test/game/brdfTeardown.test.ts test/game/pipelineScope.test.ts test/game/swapRelease.test.ts test/game/tierDeterminism.test.ts test/game/probeScene.test.ts test/game/scene/sceneRoute.test.ts`. Expected: PASS. Outside `renderer.test.ts` these renderers start a real source; under Node it fills its table a slice per timer, so the suites that await see the lighting apply part-way, and the ones that do not await never see a slice.

- [ ] **Step 11: Find every caller of what the lighting alone used.** Run:

```bash
git grep -n -w -e skyMaterialParamsUnder -e SkyMaterialParams -e sunIntensityUnder -e sunColourUnder -e fillIntensityUnder -e ambientColourUnder -e sunIntensityFor -e sunIntensityAt -e fillIntensityFor -e ambientColourFor -- client/src client/test tools
```

Expected: no hit in `lighting.ts` or any other file under `client/src/` except `weather.ts` and `sky.ts`, where the hits are the definitions, the calls between them (`sunIntensityUnder` → `sunIntensityAt` → `sunIntensityFor`, `fillIntensityUnder` → `fillIntensityFor`, `ambientColourUnder` → `ambientColourFor`), `weather.ts`'s import of three of them, and the doc comments of `FILL_NIGHT` and `twilightT` in `sky.ts`; and under `client/test/` only `sky.test.ts` and `weather.test.ts`. Every one of those goes in the next two steps, so nothing is left calling them. `sunColourAt`, `skyColourAt`, `HORIZON_SUN`, `ZENITH_SUN`, `HORIZON_SKY`, `DAY_SKY` and `fogColourUnder` are not removed here: `atmosphereParams.ts` still calls `sunColourAt` and `fogColourUnder` (Task 6 moves those calls).

- [ ] **Step 12: Remove them from `weather.ts` and `sky.ts`.**
  - `client/src/game/weather.ts`: replace the import at lines 2–5

```ts
import {
  ambientColourFor, exposureFor, fillIntensityFor, fogDensityFor,
  skyColourAt, sunColourAt, sunIntensityAt, sunPositionAt,
} from "./sky.js";
```

with `import { exposureFor, fogDensityFor, skyColourAt, sunPositionAt } from "./sky.js";`. Then delete lines 228–281, this text exactly (the blank line after it goes too):

```ts
export type SkyMaterialParams = {
  turbidity: number;
  luminance: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
};

/**
 * SkyMaterial under weather. At clear these are exactly the five constants
 * `lighting.ts` shipped with; high turbidity + low luminance turns the
 * scattering sky into flat grey-white haze — and the reflection probe capturing
 * that sky is what greys the IBL automatically.
 */
export function skyMaterialParamsUnder(w: WeatherParams): SkyMaterialParams {
  const c = clamp01(w.cloudCover);
  return {
    turbidity: 4 + 16 * c,
    luminance: 1 - 0.6 * c,
    // Browser-measured: turbidity alone whitens only the horizon —
    // the zenith stays saturated blue (probe faces r~180 b~232 under full
    // mist) — and DRAINING rayleigh darkens the dome to navy rather than
    // greying it (less scattered light, not whiter light). What actually
    // reads as overcast is leaving rayleigh alone and flooding the dome with
    // near-isotropic Mie haze: white, wavelength-independent scattering
    // everywhere, which is roughly what a cloud deck is.
    rayleigh: 2,
    mieCoefficient: 0.005 + 0.075 * c,
    mieDirectionalG: 0.8 - 0.8 * c,
  };
}

export function sunIntensityUnder(w: WeatherParams, hour: number): number {
  return sunIntensityAt(hour) * (1 - SUN_CLOUD_LOSS * clamp01(w.cloudCover));
}

export function sunColourUnder(w: WeatherParams, hour: number): Rgb {
  return desaturateRgb(sunColourAt(hour), SUN_DESAT * clamp01(w.cloudCover));
}

export function fillIntensityUnder(w: WeatherParams, altitude: number): number {
  // The lift stands in for the flat light a cloud deck scatters DOWNWARD by
  // day, so it must follow the sun: unconditional, it triple-lit the ground
  // at hour 18 under a near-black dusk sky (browser-measured). The
  // ramp matches sky.ts's DAY_ALTITUDE (0.35) so the lift fades in step with
  // the sky's own dusk transition. At night cloud adds nothing — the fill is
  // already the moonlight stand-in.
  const daylight = clamp01(altitude / 0.35);
  return fillIntensityFor(altitude) * (1 + FILL_LIFT * clamp01(w.cloudCover) * daylight);
}

export function ambientColourUnder(w: WeatherParams, hour: number): Rgb {
  return desaturateRgb(ambientColourFor(hour), AMBIENT_DESAT * clamp01(w.cloudCover));
}
```

`SUN_CLOUD_LOSS`, `SUN_DESAT`, `AMBIENT_DESAT` and `FILL_LIFT` stay: `skyState.ts` reads them.
  - `client/src/game/sky.ts`: replace the `FILL_NIGHT` doc comment (lines 51–58)

```ts
/**
 * Hemispheric fill intensity at night. Once the sun sets and `sunIntensityAt`
 * is 0, the fill is the *only* remaining light — measured: at hour 21 the old fixed 0.15 fill tinted by the
 * near-black night sky colour totalled roughly 0.005 of ambient light versus
 * ~4.0 at noon, which is why night rendered pure black no matter what
 * `exposureFor` did. This needs to be high enough on its own to keep the frame
 * legible.
 */
```

with:

```ts
/**
 * Hemispheric fill intensity at night. Once the sun has set, the fill is the
 * *only* remaining light — measured: at hour 21 the old fixed 0.15 fill tinted by the
 * near-black night sky colour totalled roughly 0.005 of ambient light versus
 * ~4.0 at noon, which is why night rendered pure black no matter what
 * `exposureFor` did. This needs to be high enough on its own to keep the frame
 * legible.
 */
```

  Replace the `twilightT` doc comment (lines 64–69)

```ts
/**
 * Where in the sun's altitude the day/night blend sits: 0 at the bottom of the
 * night transition band, 1 at the top of the day one. Shared by
 * `fillIntensityFor` and `ambientColourFor` so the two ramp in step rather than
 * drifting apart as `/time` sweeps.
 */
```

with:

```ts
/**
 * Where in the sun's altitude the day/night blend sits: 0 at the bottom of the
 * night transition band, 1 at the top of the day one. The airborne motes pick
 * their species by it (`motesParams.ts`).
 */
```

  Delete this text (lines 94–107, with the blank line after it):

```ts
/**
 * Sun intensity from its altitude: nothing below the horizon, then rising fast
 * and flattening out, which is roughly how a clear day behaves once the sun is
 * clear of the haze.
 */
export function sunIntensityFor(altitude: number): number {
  if (altitude <= 0) return 0;
  return SUN_PEAK * Math.pow(Math.min(altitude, 1), 0.4);
}

export function sunIntensityAt(hour: number): number {
  return sunIntensityFor(sunPositionAt(hour).y);
}
```

  and delete this text (lines 136–161, with the blank line after it):

```ts
/**
 * The hemispheric fill's intensity, from the sun's altitude: low by day, since
 * the sun and IBL dominate, and substantially higher at night, since the fill
 * becomes the only light once the sun sets (see `FILL_NIGHT`). Monotonically
 * non-increasing in altitude and ramped across the same twilight band as
 * `skyColourAt`, rather than switching at exactly zero, so a `/time` sweep
 * dims smoothly rather than stepping.
 */
export function fillIntensityFor(altitude: number): number {
  return FILL_NIGHT + (FILL_DAY - FILL_NIGHT) * twilightT(altitude);
}

/**
 * The hemispheric fill's colour, from the hour. By day this tracks
 * `skyColourAt`, which is the same choice the renderer made before this
 * existed. At night it blends toward `MOONLIGHT` instead of following
 * `skyColourAt` all the way to its near-black night value — the sky's own
 * colour and the colour of the light it casts are not the same thing once the
 * sun is gone, and a fill lit by the night sky's actual colour is why night
 * used to render pure black. Blended across the same
 * twilight band as `fillIntensityFor` so the two stay in step.
 */
export function ambientColourFor(hour: number): Rgb {
  const altitude = sunPositionAt(hour).y;
  return mixRgb(MOONLIGHT, skyColourAt(hour), twilightT(altitude));
}
```

  `MOONLIGHT` stays (exported for `skyState.ts`); `mixRgb` stays imported (`sunColourAt` and `skyColourAt` still use it until Task 6).

- [ ] **Step 13: Trim the removed functions' tests.**
  - `client/test/game/sky.test.ts`: replace the import at lines 2–16 with:

```ts
import {
  FOG_FLOOR,
  exposureFor,
  fogDensityFor,
  skyColourAt,
  sunColourAt,
  sunPositionAt,
} from "../../src/game/sky.js";
```

  and delete three whole blocks: `describe("sunIntensityFor", …)` (lines 76–99, from `describe("sunIntensityFor", () => {` to its closing `});` and the blank line after), `describe("fillIntensityFor", …)` (lines 189–219), and `describe("ambientColourFor", …)` (lines 221–248). The sun's strength, colour and the fill are tested on the sky state (`skyState.test.ts`) now.
  - `client/test/game/weather.test.ts`: in the import from `../../src/game/weather.js`, replace its first four lines (2–6)

```ts
import {
  ambientColourUnder, ambientGainsUnder, exposureUnder, fillIntensityUnder,
  fogColourUnder, fogDensityUnder, mistOpacityUnder,
  saturationUnder, shadowDarknessUnder, skyMaterialParamsUnder,
  sunColourUnder, sunIntensityUnder, wetSurfaceUnder,
```

  with

```ts
import {
  ambientGainsUnder, exposureUnder,
  fogColourUnder, fogDensityUnder, mistOpacityUnder,
  saturationUnder, shadowDarknessUnder, wetSurfaceUnder,
```

  (if Task 3 added `airColourUnder` to this list, keep it). Replace the import from `../../src/game/sky.js` (lines 43–46) with `import { exposureFor, fogDensityFor, skyColourAt, sunPositionAt } from "../../src/game/sky.js";`. Replace the test at lines 102–112:

```ts
  it("every hour-domain modifier at clear returns its base value", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(sunIntensityUnder(CLEAR, hour)).toBe(sunIntensityAt(hour));
      expect(sunColourUnder(CLEAR, hour)).toEqual(sunColourAt(hour));
      expect(ambientColourUnder(CLEAR, hour)).toEqual(ambientColourFor(hour));
      expect(fogColourUnder(CLEAR, hour)).toEqual(skyColourAt(hour));
      const altitude = sunPositionAt(hour).y;
      expect(fillIntensityUnder(CLEAR, altitude)).toBe(fillIntensityFor(altitude));
      expect(exposureUnder(CLEAR, altitude)).toBe(exposureFor(altitude));
    }
  });
```

  with:

```ts
  it("every hour-domain modifier at clear returns its base value", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(fogColourUnder(CLEAR, hour)).toEqual(skyColourAt(hour));
      const altitude = sunPositionAt(hour).y;
      expect(exposureUnder(CLEAR, altitude)).toBe(exposureFor(altitude));
    }
  });
```

  In "every scalar modifier at clear is the identity or zero", delete these three lines:

```ts
    expect(skyMaterialParamsUnder(CLEAR)).toEqual({
      turbidity: 4, luminance: 1, rayleigh: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8,
    });
```

  Replace

```ts
  it("full cloud kills 90% of direct sun and full mist multiplies fog 12x", () => {
    expect(sunIntensityUnder(RAIN, 12)).toBeCloseTo(0.1 * sunIntensityAt(12), 10);
    expect(fogDensityUnder(MIST, 4000)).toBeCloseTo(12 * fogDensityFor(4000), 10);
  });
```

  with

```ts
  it("full mist multiplies fog 12x", () => {
    expect(fogDensityUnder(MIST, 4000)).toBeCloseTo(12 * fogDensityFor(4000), 10);
  });
```

  and replace

```ts
  it("sun dimming is monotonic in cloud cover; fog is monotonic in mist", () => {
    let prev = Infinity;
    for (let c = 0; c <= 1; c += 0.1) {
      const v = sunIntensityUnder({ ...CLEAR, cloudCover: c }, 12);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    let prevFog = 0;
```

  with

```ts
  it("fog is monotonic in mist", () => {
    let prevFog = 0;
```

- [ ] **Step 14: Run them and see them pass, and the removals finished.** Run `npx vitest run --root client test/game/sky.test.ts test/game/weather.test.ts test/game/lighting.test.ts`. Expected: PASS. Then run the grep of Step 11 again. Expected: no output.

- [ ] **Step 15: Drop `@babylonjs/materials`.** From the worktree root run `npm uninstall @babylonjs/materials -w client`. Then run `git diff --stat -- client/package.json package-lock.json` and `git diff -- client/package.json package-lock.json`. Expected: two files changed; `client/package.json` loses the `"@babylonjs/materials": "9.18.0"` line (and `"@babylonjs/loaders": "9.18.0"` loses its trailing comma); `package-lock.json` loses the same line in the `client` package (the comma likewise) and the whole `"node_modules/@babylonjs/materials": { … }` entry, and nothing else. Then run `git grep -n "babylonjs/materials" -- client tools package.json package-lock.json eslint.config.js`. Expected: no output (`SkyMaterial` was the package's only use; the spec's mention of it under `docs/` stays).

- [ ] **Step 16: Typecheck and lint.** Run `npx tsc -p client --noEmit` (expected: no output) and `npx eslint client/src/game/lighting.ts client/src/game/renderer.ts client/src/game/weather.ts client/src/game/sky.ts client/test/game/lighting.test.ts client/test/game/renderer.test.ts client/test/game/interStage.test.ts client/test/game/stageBindings.test.ts client/test/game/foliageLightPlugin.test.ts client/test/game/sky.test.ts client/test/game/weather.test.ts` (expected: no output).

- [ ] **Step 17: Commit.**

```bash
git add client/src/game/lighting.ts client/src/game/renderer.ts client/src/game/weather.ts client/src/game/sky.ts client/package.json package-lock.json client/test/game/lighting.test.ts client/test/game/renderer.test.ts client/test/game/interStage.test.ts client/test/game/stageBindings.test.ts client/test/game/foliageLightPlugin.test.ts client/test/game/sky.test.ts client/test/game/weather.test.ts
git commit -F - <<'EOF'
feat: light the scene from the scattering sky's state

## What
The sun, the fill, the fog and clear colour and the image-based light now
come from one sky state, made from the table of scattering slices. The new
dome draws it, and the reflection probe captures that dome, gamma-encoded
as every PBR material expects and, where the engine renders it, in half
float, so the dusk horizon's brightness above 1 reaches every material as
the dome's own linear radiance. Nothing of the sky is applied until the table
holds the slices either side of noon and of the hour; a slice that arrives
while that waits applies it. Babylon's Preetham sky material, the package
that held it, and the hand-tuned sun and fill curves only it used are gone.

## How
- `client/src/game/lighting.ts`: the dome from `createSkyDome`; the probe half float and gamma-flagged as before, each face drawn on the dome's capture branch, the image-based light at `SKY_IBL_SCALE`; `apply()` sets the sun, the fill, the fog and the clear colour from `skyStateFor` once `skyHeld`, hands the dome the state and re-arms the probe; `Lighting.sky`, `sunAltitudeDeg`, `skyHeld`.
- `client/src/game/renderer.ts`: `RendererOptions.skyTable`; given none, the renderer starts a sky source of its own and stops it after the lighting.
- `client/src/game/weather.ts`, `client/src/game/sky.ts`: the sky material's parameters, the sun's and the fill's curves and `ambientColourFor` removed.
- `client/package.json`, `package-lock.json`: `@babylonjs/materials` dropped.
- `client/test/game/lighting.test.ts`: rewritten on the sky fixture: the state applied, the dome in the capture, the probe's format, the capture branch, nothing applied before the slices.
- `client/test/game/renderer.test.ts`: the renderer's own sky source, and the parts it disposes.
- `client/test/game/interStage.test.ts`, `client/test/game/stageBindings.test.ts`, `client/test/game/foliageLightPlugin.test.ts`: the lighting on the fixture's sky; the dome among the drawn materials; the fill as light 1.
- `client/test/game/sky.test.ts`, `client/test/game/weather.test.ts`: the removed functions' tests removed.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

- [ ] **Step 18: Run the repository's pre-push scan** and confirm it reports nothing for this commit.


### Task 6: The haze on the sky state, and the fog shader pinned

**Files:**
- Modify: `client/src/game/atmosphereParams.ts` (the whole file is rewritten; 96 lines today)
- Modify: `client/src/game/atmosphere.ts` (import at line 20; the `Atmosphere` type at lines 126–136; `createAtmosphere` with its doc comment at lines 150–219)
- Modify: `client/src/game/renderer.ts` (line 1912 on `main`)
- Modify: `client/src/game/weather.ts` (the `./sky.js` import; delete `fogColourUnder`, lines 292–327 on main)
- Modify: `client/src/game/sky.ts` (import at line 1; the constants at lines 31–35; delete `sunColourAt` and `skyColourAt`, lines 108–124 on main)
- Test: `client/test/game/atmosphereParams.test.ts` (rewritten whole)
- Test: `client/test/game/atmosphere.test.ts` (imports at lines 1–12; lines 70–97; a new `describe` at the end)
- Test: `client/test/game/renderer.test.ts` (line 638)
- Test: `client/test/game/weather.test.ts`, `client/test/game/sky.test.ts`
- Line numbers are `main`'s (9edee7e); an earlier task's edits move some of them, and every edit quotes the text it replaces.

**Interfaces:**

Consumes:
- Task 3: `SkyState` fields `mistAir`, `horizonAway`, `horizonToward`, `glowDir`, `glowPower`, `glowWeight`; `skyStateFor(table, hour, w)`; `airColourUnder(w: WeatherParams, base: Rgb): Rgb` (exactly `base` at clear); `skyFixture()`.
- Task 5: `Lighting.sky: SkyState | null`.

Produces:
- `fogGradientUnder(w: WeatherParams, sky: SkyState): Rgb[]` — far end a copy of `sky.mistAir`, near end `far × GRADIENT_NEAR_DIM`, the bias curve between, as today.
- `atmosphereUnder(w: WeatherParams, sky: SkyState, viewDistance: number): AtmosphereRecord` — `sunDir = sky.glowDir`, `sunColour = airColourUnder(w, sky.horizonToward)`, `sunWeight = sky.glowWeight`, `sunPower = sky.glowPower`; densities, height fog, reference level and gradient scale as today.
- `Atmosphere.update(weather: WeatherParams, sky: SkyState): void` — the gradient is rebuilt when `sky` is a different object from the last update's or a weather axis changed.
- `Atmosphere.record: AtmosphereRecord | null` — null before the first update (the initial record was built from an hour, which no longer makes one); the initial gradient texture is black, unread while the plugin is off.
- The renderer: `const sky = lighting.sky; if (sky !== null) atmosphere.update(weather, sky);` (the contract's `atmosphere.update(weather, lighting.sky)`, guarded for the null before the first slices).
- Removed: `fogColourUnder` (`weather.ts`); `sunColourAt`, `skyColourAt`, `HORIZON_SKY`, `DAY_SKY`, `HORIZON_SUN`, `ZENITH_SUN` (`sky.ts`); `sunWeightUnder`, `SUN_POWER`, `SUN_CLOUD_SURVIVAL` (`atmosphereParams.ts`).

- [ ] **Step 1: Write the failing haze tests.** Replace the whole of `client/test/game/atmosphereParams.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { atmosphereUnder, fogGradientUnder, heightFogAmount, GRADIENT_STEPS } from "../../src/game/atmosphereParams.js";
import { WEATHER_PRESETS, airColourUnder, fogDensityUnder } from "../../src/game/weather.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;
const MIST = WEATHER_PRESETS.mist;
const EERIE = WEATHER_PRESETS.eerie;
const table = skyFixture();

describe("the fog gradient", () => {
  it("has 256 entries, its far end the sky state's mist air and its near end that, dimmed", () => {
    expect(GRADIENT_STEPS).toBe(256);
    const sky = skyStateFor(table, 12, MIST);
    const g = fogGradientUnder(MIST, sky);
    expect(g.length).toBe(256);
    expect(g[255]).toEqual(sky.mistAir);
    // GRADIENT_NEAR_DIM: the air close by is denser and darker.
    expect(g[0]!.r).toBeCloseTo(sky.mistAir.r * 0.85, 12);
    expect(g[0]!.g).toBeCloseTo(sky.mistAir.g * 0.85, 12);
    expect(g[0]!.b).toBeCloseTo(sky.mistAir.b * 0.85, 12);
  });

  it("at clear ends exactly on the dome's horizon away from the sun, at every hour the sky is read at", () => {
    for (const hour of [6, 8, 12, 15, 17, 18, 18.25, 18.5, 19, 21]) {
      const sky = skyStateFor(table, hour, CLEAR);
      expect(fogGradientUnder(CLEAR, sky)[255], `hour ${hour}`).toEqual(sky.horizonAway);
    }
  });
});

describe("atmosphereUnder", () => {
  it("at clear keeps the base density and the lowest height fog, and takes its glow from the sky state", () => {
    const sky = skyStateFor(table, 17, CLEAR);
    const a = atmosphereUnder(CLEAR, sky, 4000);
    expect(a.baseDensity).toBe(fogDensityUnder(CLEAR, 4000));
    expect(a.heightDensity).toBe(0.004);
    expect(a.gradientScale).toBe(0.00025);
    expect(a.sunDir).toEqual(sky.glowDir);
    expect(a.sunColour).toEqual(sky.horizonToward);
    expect(a.sunWeight).toBe(sky.glowWeight);
    expect(a.sunPower).toBe(sky.glowPower);
  });

  it("colours the glow with the horizon toward the sun under the weather's air, as the fog is the horizon away under it", () => {
    for (const hour of [12, 18, 18.25]) {
      const sky = skyStateFor(table, hour, MIST);
      const a = atmosphereUnder(MIST, sky, 4000);
      expect(a.sunColour, `hour ${hour}`).toEqual(airColourUnder(MIST, sky.horizonToward));
      expect(fogGradientUnder(MIST, sky)[255], `hour ${hour}`).toEqual(airColourUnder(MIST, sky.horizonAway));
    }
  });

  it("lays the glow on the horizon under the sun, and puts none under a full deck", () => {
    const sky = skyStateFor(table, 17, CLEAR);
    const a = atmosphereUnder(CLEAR, sky, 4000);
    expect(a.sunDir.y).toBe(0);
    expect(Math.hypot(a.sunDir.x, a.sunDir.z)).toBeCloseTo(1, 12);
    // The afternoon sun is on the -x side of its arc.
    expect(Math.sign(a.sunDir.x)).toBe(Math.sign(sky.sunDir.x));
    // A full deck is even all round the horizon: no glow.
    expect(atmosphereUnder(EERIE, skyStateFor(table, 12, EERIE), 4000).sunWeight).toBe(0);
  });

  it("mist raises the height density and the reference level; dread raises the level further", () => {
    const at = (w: typeof CLEAR) => atmosphereUnder(w, skyStateFor(table, 12, w), 4000);
    // HEIGHT_DENSITY_BASE x (1 + HEIGHT_MIST_GAIN).
    expect(at(MIST).heightDensity).toBeCloseTo(0.012, 10);
    // REFERENCE_LEVEL_BASE, then + LEVEL_MIST_RISE, then + LEVEL_DREAD_RISE.
    expect(at(CLEAR).referenceLevel).toBe(-20);
    expect(at(MIST).referenceLevel).toBeCloseTo(-12, 10);
    expect(at(EERIE).referenceLevel).toBeCloseTo(-6, 10);
  });

  it("the reference level holds still across a plateau of the dread fade", () => {
    const a = { ...EERIE, dread: 0.36 };
    const b = { ...EERIE, dread: 0.42 };
    const sky = skyStateFor(table, 17, EERIE);
    expect(atmosphereUnder(a, sky, 4000).referenceLevel).toBe(atmosphereUnder(b, sky, 4000).referenceLevel);
  });
});

describe("heightFogAmount — the TS mirror of the GLSL", () => {
  it("is zero over zero distance, grows with distance, and is larger for a ray going down", () => {
    expect(heightFogAmount(50, 0.1, 0, 0.02, 0.05, 0)).toBe(0);
    expect(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0)).toBeGreaterThan(0);
    expect(heightFogAmount(50, 0.1, 200, 0.02, 0.05, 0)).toBeGreaterThan(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0));
    expect(heightFogAmount(50, -0.1, 100, 0.02, 0.05, 0)).toBeGreaterThan(heightFogAmount(50, 0.1, 100, 0.02, 0.05, 0));
  });

  it("a camera higher above the level sees thinner fog", () => {
    expect(heightFogAmount(200, 0, 100, 0.02, 0.05, 0)).toBeLessThan(heightFogAmount(20, 0, 100, 0.02, 0.05, 0));
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run --root client test/game/atmosphereParams.test.ts`. Expected: FAIL: today's `fogGradientUnder` and `atmosphereUnder` take an hour, so "has 256 entries…" fails on `toEqual(sky.mistAir)` and "at clear keeps the base density…" on `toEqual(sky.glowDir)`; the `heightFogAmount` tests pass.

- [ ] **Step 3: Rewrite the haze's arithmetic on the sky state.** Replace the whole of `client/src/game/atmosphereParams.ts` with:

```ts
import { clamp01, mixRgb, type Rgb } from "./colour.js";
import type { Vec3 } from "./sky.js";
import type { SkyState } from "./skyState.js";
import { airColourUnder, dreadWorldUnder, fogDensityUnder, type WeatherParams } from "./weather.js";

/**
 * The pure arithmetic of the atmosphere plugin: height fog, the distance
 * gradient and the glow toward the sun. Babylon-free and on the architecture
 * test's BABYLON_FREE_FILES list; `atmosphere.ts` is the shell that binds it.
 * Its colours are the sky state's (`skyState.ts`): the gradient ends on the
 * dome's horizon away from the sun, and the glow is its horizon toward it, so
 * the haze and the sky behind it cannot disagree.
 */

export type AtmosphereRecord = {
  baseDensity: number;
  heightDensity: number;
  heightFalloff: number;
  referenceLevel: number;
  gradientScale: number;
  sunDir: Vec3;
  sunColour: Rgb;
  sunWeight: number;
  sunPower: number;
};

export const GRADIENT_STEPS = 256;

// ---- Browser-tunable magnitudes. ----

/** Quílez `a` at clear: a faint valley haze even on a sunny day. */
export const HEIGHT_DENSITY_BASE = 0.004;
/** Height-density gain at full mist: density × (1 + gain·mist). */
export const HEIGHT_MIST_GAIN = 2;
/** Quílez `b`, per metre: the fog halves every ~14 m of height. */
export const HEIGHT_FALLOFF = 0.05;
/** World y the height fog is densest at, at clear. Below the trailhead pad. */
export const REFERENCE_LEVEL_BASE = -20;
/** Metres the reference level rises at full mist. */
export const LEVEL_MIST_RISE = 8;
/** Additional rise on the top dread plateau. */
export const LEVEL_DREAD_RISE = 6;
/** Near-end dimming of the gradient: air close by is denser and darker. */
export const GRADIENT_NEAR_DIM = 0.85;
/** Bias of the gradient toward the near colour: t^(1/GRADIENT_BIAS). */
export const GRADIENT_BIAS = 1.6;

/**
 * Quílez's closed-form height fog: density a·exp(−b·y) integrated along a
 * ray of length t from height camY (relative to `level`) with vertical slope
 * rdY. Mirrors `atmHeightFog` in atmosphereFog.fragment.fx exactly, including
 * the clamp that keeps a level ray from dividing by zero.
 */
export function heightFogAmount(camY: number, rdY: number, t: number, a: number, b: number, level: number): number {
  const y0 = camY - level;
  const slope = Math.abs(rdY) < 1e-3 ? (rdY < 0 ? -1e-3 : 1e-3) : rdY;
  return ((a / b) * Math.exp(-y0 * b) * (1 - Math.exp(-t * slope * b))) / slope;
}

/**
 * Near → far, GRADIENT_STEPS entries, linear. The far end is exactly the sky
 * state's mist air: the fog colour, the clear colour and, at clear, the
 * dome's horizon away from the sun, one colour. `w` is the weather the state
 * was made under; its mist, cloud, rain and dread are in that colour already.
 */
export function fogGradientUnder(w: WeatherParams, sky: SkyState): Rgb[] {
  const far = { r: sky.mistAir.r, g: sky.mistAir.g, b: sky.mistAir.b };
  const near = { r: far.r * GRADIENT_NEAR_DIM, g: far.g * GRADIENT_NEAR_DIM, b: far.b * GRADIENT_NEAR_DIM };
  const out: Rgb[] = [];
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    const t = i / (GRADIENT_STEPS - 1);
    out.push(i === GRADIENT_STEPS - 1 ? far : mixRgb(near, far, Math.pow(t, 1 / GRADIENT_BIAS)));
  }
  return out;
}

/**
 * The plugin's record. The glow is the horizon toward the sun under the
 * weather's air, centred on the sun's azimuth at the horizon and as wide as
 * the horizon's fall-off away from it (`fitGlow`, `skyState.ts`): it outlasts
 * the sun while the twilight glows, and a full cloud deck, even all round the
 * horizon, has none.
 */
export function atmosphereUnder(w: WeatherParams, sky: SkyState, viewDistance: number): AtmosphereRecord {
  const m = clamp01(w.mist);
  const d = dreadWorldUnder(w);
  return {
    baseDensity: fogDensityUnder(w, viewDistance),
    heightDensity: HEIGHT_DENSITY_BASE * (1 + HEIGHT_MIST_GAIN * m),
    heightFalloff: HEIGHT_FALLOFF,
    referenceLevel: REFERENCE_LEVEL_BASE + LEVEL_MIST_RISE * m + LEVEL_DREAD_RISE * d,
    gradientScale: 1 / viewDistance,
    sunDir: sky.glowDir,
    sunColour: airColourUnder(w, sky.horizonToward),
    sunWeight: sky.glowWeight,
    sunPower: sky.glowPower,
  };
}
```

- [ ] **Step 4: Run it and see it pass.** Run `npx vitest run --root client test/game/atmosphereParams.test.ts`. Expected: PASS, 9 tests.

- [ ] **Step 5: Read the fog shader's hash from the file as it stands.** Run `git diff --quiet 9edee7e -- client/src/game/shaders/atmosphereFog.fragment.fx && shasum -a 256 client/src/game/shaders/atmosphereFog.fragment.fx`. Expected output: `a9c4be1c436ff9b91fffeba91a93dc1baf458a6ab385077b0d93103fef39b828  client/src/game/shaders/atmosphereFog.fragment.fx` (the `git diff --quiet` guard fails the command if anything has touched the file since `main`; then stop and find out why before going on).

- [ ] **Step 6: Write the failing shell tests.** In `client/test/game/atmosphere.test.ts`:
  - Add `import { createHash } from "node:crypto";` after line 1, and after line 12 (`import { fogGradientUnder, GRADIENT_STEPS } from "../../src/game/atmosphereParams.js";`) add:

```ts
import { skyStateFor } from "../../src/game/skyState.js";
import { skyFixture } from "./helpers/skyFixture.js";
```

  - After line 16 (`let atmosphere: Atmosphere;`) add `const table = skyFixture();`.
  - Replace lines 70–97:

```ts
  it("update writes the record, keeps scene.fogColor on the gradient's far end, and rebuilds the gradient only on change", () => {
    atmosphere.update(WEATHER_PRESETS.clear, 12);
    const far = fogGradientUnder(WEATHER_PRESETS.clear, 12)[GRADIENT_STEPS - 1]!;
    expect(scene.fogColor.r).toBeCloseTo(far.r, 6);
    expect(scene.fogDensity).toBe(atmosphere.record.baseDensity);
    expect(atmosphere.record.sunWeight).toBe(1);
    const before = atmosphere.gradientBuilds;
    atmosphere.update(WEATHER_PRESETS.clear, 12);
    expect(atmosphere.gradientBuilds).toBe(before);
    atmosphere.update(WEATHER_PRESETS.eerie, 12);
    expect(atmosphere.gradientBuilds).toBe(before + 1);
    expect(atmosphere.record.sunWeight).toBeLessThan(1);
  });

  it("midColour is between the gradient's ends", () => {
    atmosphere.update(WEATHER_PRESETS.mist, 12);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, 12);
    const mid = atmosphere.midColour();
    expect(mid.r).toBeGreaterThanOrEqual(Math.min(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
    expect(mid.r).toBeLessThanOrEqual(Math.max(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
  });

  it("nearColour is the gradient's near end", () => {
    atmosphere.update(WEATHER_PRESETS.mist, 12);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, 12);
    const near = atmosphere.nearColour();
    expect(near).toEqual(g[0]);
  });
```

  with:

```ts
  it("leaves the plugin off and holds no record before its first update", () => {
    expect(atmosphere.record).toBeNull();
    expect(atmosphere.gradientBuilds).toBe(0);
  });

  it("update writes the record, keeps scene.fogColor on the sky state's mist air, and rebuilds the gradient only for a new state or a weather change", () => {
    const sky = skyStateFor(table, 12, WEATHER_PRESETS.clear);
    atmosphere.update(WEATHER_PRESETS.clear, sky);
    expect(scene.fogColor.r).toBeCloseTo(sky.mistAir.r, 6);
    expect(scene.fogColor.g).toBeCloseTo(sky.mistAir.g, 6);
    expect(scene.fogColor.b).toBeCloseTo(sky.mistAir.b, 6);
    expect(scene.fogDensity).toBe(atmosphere.record!.baseDensity);
    expect(atmosphere.record!.sunWeight).toBe(sky.glowWeight);
    expect(atmosphere.record!.sunPower).toBe(sky.glowPower);
    expect(atmosphere.gradientBuilds).toBe(1);
    // The same state, a still frame: nothing rebuilt.
    atmosphere.update(WEATHER_PRESETS.clear, sky);
    expect(atmosphere.gradientBuilds).toBe(1);
    // A new state object, as each apply of the lighting makes, even with equal values.
    const again = { ...sky };
    atmosphere.update(WEATHER_PRESETS.clear, again);
    expect(atmosphere.gradientBuilds).toBe(2);
    // A weather axis moved under the same state.
    atmosphere.update(WEATHER_PRESETS.eerie, again);
    expect(atmosphere.gradientBuilds).toBe(3);
  });

  it("midColour is between the gradient's ends", () => {
    const sky = skyStateFor(table, 12, WEATHER_PRESETS.mist);
    atmosphere.update(WEATHER_PRESETS.mist, sky);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, sky);
    const mid = atmosphere.midColour();
    expect(mid.r).toBeGreaterThanOrEqual(Math.min(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
    expect(mid.r).toBeLessThanOrEqual(Math.max(g[0]!.r, g[GRADIENT_STEPS - 1]!.r));
  });

  it("nearColour is the gradient's near end", () => {
    const sky = skyStateFor(table, 12, WEATHER_PRESETS.mist);
    atmosphere.update(WEATHER_PRESETS.mist, sky);
    const g = fogGradientUnder(WEATHER_PRESETS.mist, sky);
    expect(atmosphere.nearColour()).toEqual(g[0]);
  });
```

  - At the end of the file add:

```ts

describe("the fog's shader text", () => {
  it("is byte for byte the text every PBR material's stage is built with", () => {
    // The scattering sky changes no PBR shader: the glow's new shape is all in
    // the values the plugin binds (`atmosphereParams.ts`).
    expect(createHash("sha256").update(atmosphereFragment).digest("hex")).toBe(
      "a9c4be1c436ff9b91fffeba91a93dc1baf458a6ab385077b0d93103fef39b828",
    );
  });
});
```

- [ ] **Step 7: Run it and see it fail.** Run `npx vitest run --root client test/game/atmosphere.test.ts`. Expected: FAIL in "leaves the plugin off…" (`expected { baseDensity: … } to be null`, today's shell builds a record at once) and in "update writes the record…"; the shader-text pin passes already (the file is unchanged).

- [ ] **Step 8: Bind the haze from the sky state.** In `client/src/game/atmosphere.ts`:
  - Replace line 20, `import { WEATHER_PRESETS, type WeatherParams } from "./weather.js";`, with:

```ts
import type { WeatherParams } from "./weather.js";
import type { SkyState } from "./skyState.js";
```

  - Replace the `Atmosphere` type (lines 126–136) with:

```ts
export type Atmosphere = {
  /**
   * Recomputes the record from the weather and the sky state the lighting
   * last applied (`Lighting.sky`), and the gradient texture when that state
   * is a new one or a weather axis moved.
   */
  update(weather: WeatherParams, sky: SkyState): void;
  /** The last update's record; null before the first, while the plugin is off. */
  readonly record: AtmosphereRecord | null;
  readonly gradientBuilds: number;
  /** The gradient's middle colour, for mist banks. */
  midColour(): Rgb;
  /** The gradient's near-end colour, for motes. */
  nearColour(): Rgb;
  dispose(): void;
};
```

  - Replace `createAtmosphere` and its doc comment (lines 150–219) with:

```ts
/**
 * Registers the plugin factory. MUST run before any PBR material exists —
 * RegisterMaterialPlugin only reaches materials created afterwards. The
 * factory declines non-PBR materials (the sky dome, mist, particles) by
 * returning null, and declines the Hollow's PBR material by name: it keeps fog
 * off, and the plugin's spliced code reads `vFogColor`, which Babylon declares
 * only while the FOG define is set, so with the plugin attached that material
 * would fail to compile on an undeclared identifier (entityViews.ts says why
 * fog stays off).
 *
 * The gradient is a 256x1 RGBA8 strip in LINEAR space (the grade pass
 * tone-maps after it); the finish pass's dither hides its 8-bit steps.
 */
export function createAtmosphere(scene: Scene, viewDistance: number): Atmosphere {
  RegisterMaterialPlugin("Atmosphere", (material) =>
    material instanceof PBRMaterial && material.name !== HOLLOW_MATERIAL ? new AtmospherePlugin(material) : null,
  );
  registered = true;
  let record: AtmosphereRecord | null = null;
  let gradient: Rgb[] = [];
  let lastSky: SkyState | null = null;
  let lastWeather = "";
  let builds = 0;
  // Black until the first update. Nothing reads it before then (the plugin is
  // off while `current` is null), but WebGPU validates every binding a
  // pipeline declares, so the texture exists from the start.
  const blank: Rgb[] = Array.from({ length: GRADIENT_STEPS }, () => ({ r: 0, g: 0, b: 0 }));
  const tex = RawTexture.CreateRGBATexture(
    gradientTexels(blank),
    GRADIENT_STEPS, 1, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  gradientTexture = tex;

  return {
    get record() {
      return record;
    },
    get gradientBuilds() {
      return builds;
    },
    update(weather, sky) {
      record = atmosphereUnder(weather, sky, viewDistance);
      current = record;
      // The sky state and the five weather axes are the whole input to the
      // gradient. The lighting makes a new state at each apply (an hour, a
      // weather, a fade's tick, a slice arriving), so a fade rebuilds every
      // tick (256 texels, trivial) and a still frame never does.
      const weatherKey = `${weather.cloudCover}|${weather.mist}|${weather.rain}|${weather.wetness}|${weather.dread}`;
      if (sky !== lastSky || weatherKey !== lastWeather) {
        gradient = fogGradientUnder(weather, sky);
        tex.update(gradientTexels(gradient));
        const far = gradient[GRADIENT_STEPS - 1] as Rgb;
        // Non-PBR materials (mist, rain) still read Babylon's fog colour.
        scene.fogColor = new Color3(far.r, far.g, far.b);
        scene.fogDensity = record.baseDensity;
        lastSky = sky;
        lastWeather = weatherKey;
        builds += 1;
      }
    },
    midColour() {
      return gradient[GRADIENT_STEPS >> 1] ?? { r: 0, g: 0, b: 0 };
    },
    nearColour() {
      return gradient[0] ?? { r: 0, g: 0, b: 0 };
    },
    dispose() {
      UnregisterMaterialPlugin("Atmosphere");
      registered = false;
      current = null;
      gradientTexture = null;
      tex.dispose();
    },
  };
}
```

- [ ] **Step 9: Feed it the lighting's state in the renderer, and move the renderer's text pin.** In `client/src/game/renderer.ts` replace the line `      atmosphere.update(weather, lighting.hour);` (1912 on `main`) with:

```ts
      // The haze reads the sky state the lighting last applied; there is
      // none until the table holds its first slices.
      const sky = lighting.sky;
      if (sky !== null) atmosphere.update(weather, sky);
```

  In `client/test/game/renderer.test.ts` replace line 638, `    const feed = slice("applyWetness(scene, weather);", "atmosphere.update(weather, lighting.hour);");`, with `    const feed = slice("applyWetness(scene, weather);", "if (sky !== null) atmosphere.update(weather, sky);");`.

- [ ] **Step 10: Run them and see them pass.** Run `npx vitest run --root client test/game/atmosphere.test.ts test/game/atmosphereParams.test.ts test/game/renderer.test.ts test/game/stageBindings.test.ts test/game/interStage.test.ts`. Expected: PASS.

- [ ] **Step 11: Find every caller of what the old haze used.** Run:

```bash
git grep -n -w -e fogColourUnder -e sunColourAt -e skyColourAt -e HORIZON_SKY -e DAY_SKY -e HORIZON_SUN -e ZENITH_SUN -e sunWeightUnder -e SUN_POWER -e SUN_CLOUD_SURVIVAL -- client/src client/test tools
```

Expected: nothing in `atmosphereParams.ts`, `atmosphere.ts`, `lighting.ts` or any file under `client/src/` but `sky.ts` (the four constants, `sunColourAt`, `skyColourAt`) and `weather.ts` (its import of `skyColourAt`, and `fogColourUnder` with its comments naming `skyColourAt`); under `client/test/` only `sky.test.ts` and `weather.test.ts`. The next two steps remove every one; `sunWeightUnder`, `SUN_POWER` and `SUN_CLOUD_SURVIVAL` are already gone with Step 3's rewrite.

- [ ] **Step 12: Remove them from `weather.ts` and `sky.ts`.**
  - `client/src/game/weather.ts`: replace `import { exposureFor, fogDensityFor, skyColourAt, sunPositionAt } from "./sky.js";` with `import { exposureFor, fogDensityFor } from "./sky.js";`, and delete the function `fogColourUnder` with its doc comment; on `main` (lines 292–327) it reads, and is deleted with the blank line after it:

```ts
/**
 * Fog colour under weather: pulled toward mist air by mist, then desaturated
 * by cloud, so the horizon dissolves into the greyed sky rather than banding
 * against it. The mist-air target scales with the base sky's own luminance —
 * a fixed bright grey made the fog band GLOW against a near-black dusk sky
 * (browser-measured at hour 18); tracking the sky's brightness keeps
 * the noon look identical while dusk fog dims with the dusk. At clear every
 * step is an exact copy of `skyColourAt`.
 */
export function fogColourUnder(w: WeatherParams, hour: number): Rgb {
  const c = clamp01(w.cloudCover);
  const base = skyColourAt(hour);
  const lift = Math.min(1.2, luma(base) / luma(MIST_AIR));
  const air = { r: MIST_AIR.r * lift, g: MIST_AIR.g * lift, b: MIST_AIR.b * lift };
  const grey = desaturateRgb(mixRgb(base, air, 0.5 * clamp01(w.mist)), 0.9 * c);
  // skyColourAt models a CLEAR sky's bright sunset horizon, but a cloud deck
  // blocks exactly that low light — without this the fog band glowed white
  // against a near-black overcast dusk dome (browser-measured at hour 18).
  // Identity at clear (c = 0) and by day (daylight 1), both exact.
  const daylight = clamp01(sunPositionAt(hour).y / 0.35);
  const duskDim = 1 - 0.85 * c * (1 - daylight);
  const dusk = { r: grey.r * duskDim, g: grey.g * duskDim, b: grey.b * duskDim };
  // Under rain the far field greys: pulled toward its own luminance, so the
  // brightness the dusk term set is kept. Guarded, so the clear path is the
  // same object arithmetic as before the rain term existed.
  const r = clamp01(w.rain);
  const dimmed = r === 0 ? dusk : mixRgb(dusk, { r: luma(dusk), g: luma(dusk), b: luma(dusk) }, FOG_RAIN_GREY * r);
  const d = dreadWorldUnder(w);
  // Early return to ensure no dread-term arithmetic touches the clear path; the
  // preceding cloud-term arithmetic is IEEE-exact at zero (dimmed is a freshly built
  // object; the sweep asserts value equality, not identity).
  if (d === 0) return dimmed;
  const dreadLift = Math.min(1, luma(dimmed) / luma(DREAD_AIR));
  const target = { r: DREAD_AIR.r * dreadLift, g: DREAD_AIR.g * dreadLift, b: DREAD_AIR.b * dreadLift };
  return mixRgb(dimmed, target, DREAD_FOG_PULL * d);
}
```

  `MIST_AIR`, `DREAD_AIR`, `FOG_RAIN_GREY` and `DREAD_FOG_PULL` stay, as do the `clamp01`, `desaturateRgb`, `luma` and `mixRgb` imports: `airColourUnder` uses them all.
  - `client/src/game/sky.ts`: replace line 1, `import { clamp01, mixRgb, type Rgb } from "./colour.js";`, with `import { clamp01, type Rgb } from "./colour.js";`. Delete these four declarations and the blank line between them (lines 31–35 on `main`), leaving `NIGHT_SKY`'s declaration as it stands:

```ts
const HORIZON_SKY: Rgb = { r: 0.62, g: 0.5, b: 0.42 };
const DAY_SKY: Rgb = { r: 0.42, g: 0.58, b: 0.82 };

const HORIZON_SUN: Rgb = { r: 1, g: 0.52, b: 0.24 };
const ZENITH_SUN: Rgb = { r: 1, g: 0.96, b: 0.9 };
```

  and delete this text with the blank line after it:

```ts
/** Warm at the horizon, near-white overhead — the long path through air. */
export function sunColourAt(hour: number): Rgb {
  return mixRgb(HORIZON_SUN, ZENITH_SUN, Math.sqrt(clamp01(sunPositionAt(hour).y)));
}

/**
 * Drives the fog tint and the scene clear colour together, so haze and sky agree
 * as the sun moves. A fixed fog colour under a moving sun is the tell that gives
 * away a static skybox.
 */
export function skyColourAt(hour: number): Rgb {
  const altitude = sunPositionAt(hour).y;
  if (altitude <= 0) {
    return mixRgb(NIGHT_SKY, HORIZON_SKY, clamp01((altitude + NIGHT_ALTITUDE) / NIGHT_ALTITUDE));
  }
  return mixRgb(HORIZON_SKY, DAY_SKY, clamp01(altitude / DAY_ALTITUDE));
}
```

  `NIGHT_ALTITUDE` and `DAY_ALTITUDE` stay (`twilightT`).

- [ ] **Step 13: Rewrite their tests onto what replaced them.**
  - `client/test/game/sky.test.ts`: replace the import with

```ts
import {
  FOG_FLOOR,
  exposureFor,
  fogDensityFor,
  sunPositionAt,
} from "../../src/game/sky.js";
```

  and delete the whole `describe("sunColourAt", …)` and `describe("skyColourAt", …)` blocks (they stand together between the `sunPositionAt` and the `exposureFor` blocks). The horizon's colours are the sky state's now (`skyState.test.ts`).
  - `client/test/game/weather.test.ts`: in the import from `../../src/game/weather.js`, replace the lines left by Task 5

```ts
import {
  ambientGainsUnder, exposureUnder,
  fogColourUnder, fogDensityUnder, mistOpacityUnder,
  saturationUnder, shadowDarknessUnder, wetSurfaceUnder,
```

  with

```ts
import {
  airColourUnder, ambientGainsUnder, exposureUnder,
  fogDensityUnder, mistOpacityUnder,
  saturationUnder, shadowDarknessUnder, wetSurfaceUnder,
```

  (if Task 3 already imports `airColourUnder` further down the list, drop the second mention). Replace `import { exposureFor, fogDensityFor, skyColourAt, sunPositionAt } from "../../src/game/sky.js";` with `import { exposureFor, fogDensityFor, sunPositionAt } from "../../src/game/sky.js";`, and `import { luma } from "../../src/game/colour.js";` with `import { luma, type Rgb } from "../../src/game/colour.js";` (Task 3 already changed that line to `import { desaturateRgb, luma, type Rgb } from "../../src/game/colour.js";`: keep Task 3's line as it is, with no duplicate names). Delete Task 3's test `agrees with fogColourUnder over skyColourAt wherever its dusk dimming is the identity`, which names the functions this step removes. After `const MIST = WEATHER_PRESETS.mist;` add:

```ts
/** Horizon colours the fog is built over: a noon blue, a sunset orange
 * brighter than 1, a dusk and a deep night. */
const BASES: readonly Rgb[] = [
  { r: 0.42, g: 0.58, b: 0.82 },
  { r: 1.4, g: 0.62, b: 0.21 },
  { r: 0.11, g: 0.09, b: 0.14 },
  { r: 0.02, g: 0.03, b: 0.06 },
];
```

  Replace

```ts
  it("every hour-domain modifier at clear returns its base value", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(fogColourUnder(CLEAR, hour)).toEqual(skyColourAt(hour));
      const altitude = sunPositionAt(hour).y;
      expect(exposureUnder(CLEAR, altitude)).toBe(exposureFor(altitude));
    }
  });
```

  with

```ts
  it("the exposure at clear is the altitude's own at every hour", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      const altitude = sunPositionAt(hour).y;
      expect(exposureUnder(CLEAR, altitude)).toBe(exposureFor(altitude));
    }
  });
```

  In "rain thickens the fog by half on top of the mist, and greys it toward its own luminance", replace

```ts
    for (const hour of [6, 12, 18, 22]) {
      const dry = fogColourUnder({ ...RAIN, rain: 0 }, hour);
      const wet = fogColourUnder(RAIN, hour);
```

  with

```ts
    for (const base of BASES) {
      const dry = airColourUnder({ ...RAIN, rain: 0 }, base);
      const wet = airColourUnder(RAIN, base);
```

  and `      const half = fogColourUnder({ ...RAIN, rain: 0.5 }, hour);` with `      const half = airColourUnder({ ...RAIN, rain: 0.5 }, base);`. Replace

```ts
  it("dread alone shifts the fog's balance toward green", () => {
    const base = fogColourUnder(CLEAR, 12);
    const pulled = fogColourUnder(DREAD_ONLY, 12);
    const greenShare = (c: { r: number; g: number; b: number }) => c.g / (c.r + c.g + c.b);
    expect(pulled).not.toEqual(base);
    expect(greenShare(pulled)).toBeGreaterThan(greenShare(base));
  });

  it("dread never brightens the fog — no glowing air at night", () => {
    for (let hour = 0; hour <= 24; hour += 0.25) {
      expect(luma(fogColourUnder(DREAD_ONLY, hour))).toBeLessThanOrEqual(
        luma(fogColourUnder(CLEAR, hour)) + 1e-12,
      );
    }
  });
```

  with

```ts
  it("dread alone shifts the fog's balance toward green", () => {
    const plain = airColourUnder(CLEAR, BASES[0]!);
    const pulled = airColourUnder(DREAD_ONLY, BASES[0]!);
    const greenShare = (c: { r: number; g: number; b: number }) => c.g / (c.r + c.g + c.b);
    expect(pulled).not.toEqual(plain);
    expect(greenShare(pulled)).toBeGreaterThan(greenShare(plain));
  });

  it("dread never brightens the fog — no glowing air at night", () => {
    for (const base of BASES) {
      expect(luma(airColourUnder(DREAD_ONLY, base))).toBeLessThanOrEqual(luma(airColourUnder(CLEAR, base)) + 1e-12);
    }
  });
```

  and, in "a mid-fade dread holds the world on a plateau while the lens keeps moving", replace `    expect(fogColourUnder(a, 17)).toEqual(fogColourUnder(b, 17));` with `    expect(airColourUnder(a, BASES[1]!)).toEqual(airColourUnder(b, BASES[1]!));`.

- [ ] **Step 14: Run them and see them pass, and the removals finished.** Run `npx vitest run --root client test/game/sky.test.ts test/game/weather.test.ts test/game/atmosphereParams.test.ts test/game/atmosphere.test.ts test/game/lighting.test.ts`. Expected: PASS. Run the grep of Step 11 again. Expected: no output.

- [ ] **Step 15: Typecheck and lint.** Run `npx tsc -p client --noEmit` (expected: no output) and `npx eslint client/src/game/atmosphereParams.ts client/src/game/atmosphere.ts client/src/game/renderer.ts client/src/game/weather.ts client/src/game/sky.ts client/test/game/atmosphereParams.test.ts client/test/game/atmosphere.test.ts client/test/game/renderer.test.ts client/test/game/weather.test.ts client/test/game/sky.test.ts` (expected: no output).

- [ ] **Step 16: Commit.**

```bash
git add client/src/game/atmosphereParams.ts client/src/game/atmosphere.ts client/src/game/renderer.ts client/src/game/weather.ts client/src/game/sky.ts client/test/game/atmosphereParams.test.ts client/test/game/atmosphere.test.ts client/test/game/renderer.test.ts client/test/game/weather.test.ts client/test/game/sky.test.ts
git commit -F - <<'EOF'
feat: draw the haze from the scattering sky's state

## What
The haze's distance gradient now ends on the sky state's mist air, the
dome's horizon away from the sun under the weather, and its glow is the
horizon toward the sun: centred on the sun's azimuth at the horizon, as wide
as the horizon's fall-off, and still there after sunset while the twilight
glows. The hand-made horizon colours, the warm sun curve and the fog colour
built on them are gone. The fog shader's text is pinned byte for byte, since
no PBR shader changes with the sky.

## How
- `client/src/game/atmosphereParams.ts`: `fogGradientUnder` and `atmosphereUnder` take the sky state; the glow's direction, colour, weight and power are its; `sunWeightUnder`, `SUN_POWER` and `SUN_CLOUD_SURVIVAL` removed.
- `client/src/game/atmosphere.ts`: `update(weather, sky)` rebuilds the gradient for a new state or a weather change; no record, and a black strip, before the first.
- `client/src/game/renderer.ts`: the haze is fed the lighting's state once there is one.
- `client/src/game/weather.ts`, `client/src/game/sky.ts`: `fogColourUnder`, `sunColourAt`, `skyColourAt` and their colours removed.
- `client/test/game/atmosphereParams.test.ts`, `client/test/game/atmosphere.test.ts`: the gradient's far end and the glow against the sky fixture; rebuilds by state and weather; the fog shader's SHA-256.
- `client/test/game/renderer.test.ts`: the moved update line.
- `client/test/game/weather.test.ts`, `client/test/game/sky.test.ts`: the fog colour's rain, dread and plateau tests on `airColourUnder`; the removed functions' tests removed.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

- [ ] **Step 17: Run the repository's pre-push scan** and confirm it reports nothing for this commit.


### Task 7: The grade by the night factor

**Files:**
- Modify: `client/src/game/gradeParams.ts` (import at line 2; constants at lines 100–105; `whitePointMatrix` at lines 130–142; `gradeRecordUnder` at lines 207–240)
- Modify: `client/src/game/post.ts` (`Post` type at lines 27–32; the initial record at line 144; `update` at lines 301–303)
- Modify: `client/src/game/renderer.ts` (the `post.update` line, line 1923 on `main`, below Task 6's `const sky`)
- Test: `client/test/game/gradeParams.test.ts` (rewritten whole)
- Test: `client/test/game/dreadNight.test.ts` (rewritten whole)
- Test: `client/test/game/post.test.ts` (every `post.update` call; a new test before line 220)
- Line numbers are `main`'s (9edee7e); an earlier task's edits move some of them, and every edit quotes the text it replaces.

**Interfaces:**

Consumes:
- Task 3: `SkyState.night` (n: exactly 0 by day, 1 in full night); `skyStateFor`; `skyFixture()`.
- Task 5: `Lighting.sky: SkyState | null`. Task 6: the `const sky = lighting.sky;` local in the renderer's `sync`.

Produces:
- `whitePointMatrix(night: number): Mat3` — `IDENTITY` (the same object) when `night === 0`, else `bradfordMatrix(lerpXy(WHITE_NOON, WHITE_NIGHT, night))`.
- `gradeRecordUnder(w: WeatherParams, hour: number, night: number, unsettle: number, timeSeconds = 0, stare = 0): GradeRecord` — `whitePoint = whitePointMatrix(night)`, `purkinjeStrength = night === 0 ? 0 : PURKINJE_MAX * night`; exposure still from the hour (`exposureUnder`).
- `Post.update(weather: WeatherParams, hour: number, night: number, unsettle: number, stare: number, lens?: number): void`.
- The renderer passes `sky?.night ?? 0` (the contract's `lighting.sky.night`, guarded for the null before the first slices).
- Removed: `WHITE_DUSK`. `twilightT` stays in `sky.ts`: `motesParams.ts` still reads it.

- [ ] **Step 1: Write the failing grade tests.** Replace the whole of `client/test/game/gradeParams.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  agx, gradeRecordUnder, whitePointMatrix, hueToRgb, IDENTITY,
  HALATION_BASE, ABERRATION_BASE, AGX_MIN_EV, AGX_MAX_EV, STARE_VIGNETTE,
} from "../../src/game/gradeParams.js";
import { WEATHER_PRESETS, exposureUnder, vignetteWeightUnder, VIGNETTE_WEIGHT_BASE } from "../../src/game/weather.js";
import { sunPositionAt } from "../../src/game/sky.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;
const table = skyFixture();

/** Midnight's white point as it has always been: the night white's Bradford
 * matrix, column-major. */
const MIDNIGHT_WHITE = [
  0.9697945994651918, 0.0014453411088976608, 0.00580267983014306,
  -0.03242320525423818, 0.9984949351034228, 0.02245494273020565,
  -0.011408876046577587, -0.005255272691626595, 1.242522254356526,
];

describe("agx — the TS reference of the GLSL tone map", () => {
  it("is bracketed to [0, 1] and monotonic in exposure on grey", () => {
    let last = -1;
    for (let ev = -14; ev <= 6; ev += 0.25) {
      const v = 0.18 * Math.pow(2, ev);
      const out = agx({ r: v, g: v, b: v });
      expect(out.r).toBeGreaterThanOrEqual(0);
      expect(out.r).toBeLessThanOrEqual(1);
      expect(out.r).toBeGreaterThanOrEqual(last - 1e-9);
      last = out.r;
    }
  });

  it("maps middle grey near the middle and keeps grey neutral", () => {
    const out = agx({ r: 0.18, g: 0.18, b: 0.18 });
    // agx() returns linear values: 0.18 lands near 0.21 here, which is ~0.5 after the
    // sRGB encode the grade pass applies afterwards.
    expect(out.r).toBeGreaterThan(0.15);
    expect(out.r).toBeLessThan(0.3);
    expect(Math.abs(out.r - out.g)).toBeLessThan(1e-3);
    expect(Math.abs(out.g - out.b)).toBeLessThan(1e-3);
  });

  it("uses the documented log2 range", () => {
    expect(AGX_MIN_EV).toBe(-12.47393);
    expect(AGX_MAX_EV).toBe(4.026069);
  });
});

describe("white point", () => {
  it("is the identity while the night factor is 0: through the day and the twilight", () => {
    expect(whitePointMatrix(0)).toBe(IDENTITY);
    // Noon is day by definition: its adapted light is the reference.
    expect(skyStateFor(table, 12, CLEAR).night).toBe(0);
    for (const hour of [12, 15, 17, 18, 18.25, 18.5, 19]) {
      const night = skyStateFor(table, hour, CLEAR).night;
      expect(gradeRecordUnder(CLEAR, hour, night, 1).whitePoint === IDENTITY, `hour ${hour}`).toBe(night === 0);
    }
  });

  it("cools with the night factor, to midnight's night white, unchanged", () => {
    const half = whitePointMatrix(0.5);
    const full = whitePointMatrix(1);
    // A cool white point makes a grey pixel bluer than red, the more so the deeper the night.
    expect(half[8]).toBeGreaterThan(half[0]!);
    expect(full[8]).toBeGreaterThan(half[8]!);
    for (let i = 0; i < 9; i++) expect(full[i]).toBeCloseTo(MIDNIGHT_WHITE[i]!, 12);
    // Midnight's night factor is 1: the night white itself.
    expect(skyStateFor(table, 0, CLEAR).night).toBe(1);
  });
});

describe("hueToRgb", () => {
  it("returns pure red, green and blue at 0, 120 and 240 degrees", () => {
    expect(hueToRgb(0)).toEqual({ r: 1, g: 0, b: 0 });
    expect(hueToRgb(120)).toEqual({ r: 0, g: 1, b: 0 });
    expect(hueToRgb(240)).toEqual({ r: 0, g: 0, b: 1 });
  });
});

describe("gradeRecordUnder", () => {
  it("at clear is the identity apart from exposure, the white point and the baseline treatment", () => {
    for (let hour = 0; hour < 24; hour += 0.5) {
      const g = gradeRecordUnder(CLEAR, hour, 0, 1);
      expect(g.exposure).toBe(exposureUnder(CLEAR, sunPositionAt(hour).y));
      expect(g.shadows.density).toBe(0);
      expect(g.midtones.density).toBe(0);
      expect(g.highlights.density).toBe(0);
      expect(g.lift).toEqual({ r: 0, g: 0, b: 0 });
      expect(g.saturation).toBe(0);
      expect(g.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
      expect(g.halationStrength).toBe(HALATION_BASE);
      expect(g.aberrationAmount).toBe(ABERRATION_BASE);
    }
  });

  it("purkinje follows the night factor: none by day, today's 0.8 at midnight", () => {
    expect(gradeRecordUnder(CLEAR, 12, 0, 1).purkinjeStrength).toBe(0);
    expect(gradeRecordUnder(CLEAR, 18.5, 0.5, 1).purkinjeStrength).toBeCloseTo(0.4, 12);
    expect(gradeRecordUnder(CLEAR, 1, 1, 1).purkinjeStrength).toBeCloseTo(0.8, 10);
    // Through the sky state: noon's night factor and midnight's.
    expect(gradeRecordUnder(CLEAR, 12, skyStateFor(table, 12, CLEAR).night, 1).purkinjeStrength).toBe(0);
    expect(gradeRecordUnder(CLEAR, 0, skyStateFor(table, 0, CLEAR).night, 1).purkinjeStrength).toBeCloseTo(0.8, 10);
  });

  it("dread raises the lens terms and unsettle scales exactly those", () => {
    const full = gradeRecordUnder(EERIE, 17, 0, 1);
    const off = gradeRecordUnder(EERIE, 17, 0, 0);
    expect(full.halationStrength).toBeGreaterThan(HALATION_BASE);
    expect(full.aberrationAmount).toBeGreaterThan(ABERRATION_BASE);
    expect(full.vignetteWeight).toBe(vignetteWeightUnder(EERIE));
    expect(off.halationStrength).toBe(HALATION_BASE);
    expect(off.aberrationAmount).toBe(ABERRATION_BASE);
    expect(off.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
    // The world-side colour is untouched by the slider.
    expect(off.shadows).toEqual(full.shadows);
    expect(off.exposure).toBe(full.exposure);
  });

  it("the split-tone reaches today's densities under eerie", () => {
    const g = gradeRecordUnder(EERIE, 17, 0, 1);
    expect(g.shadows.density).toBeGreaterThan(0);
    expect(g.midtones.density).toBeGreaterThan(g.highlights.density);
  });
});

describe("the stare", () => {
  it("leaves the record untouched at 0, darkens monotonically, and is black at 1", () => {
    expect(gradeRecordUnder(CLEAR, 12, 0, 1, 0, 0)).toEqual(gradeRecordUnder(CLEAR, 12, 0, 1));
    let lastExposure = Infinity;
    let lastVignette = -Infinity;
    for (const stare of [0, 0.25, 0.5, 0.75, 1]) {
      const r = gradeRecordUnder(EERIE, 12, 0, 1, 0, stare);
      expect(r.exposure).toBeLessThanOrEqual(lastExposure);
      expect(r.vignetteWeight).toBeGreaterThanOrEqual(lastVignette);
      lastExposure = r.exposure;
      lastVignette = r.vignetteWeight;
    }
    expect(gradeRecordUnder(EERIE, 12, 0, 1, 0, 1).exposure).toBe(0);
    expect(gradeRecordUnder(EERIE, 12, 0, 1, 0, 1).vignetteWeight).toBeCloseTo(gradeRecordUnder(EERIE, 12, 0, 1).vignetteWeight + STARE_VIGNETTE, 9);
  });
});
```

- [ ] **Step 2: Rewrite the dread-night grade tests on the night factor.** Replace the whole of `client/test/game/dreadNight.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import gradeFragment from "../../src/game/shaders/grade.fragment.fx?raw";
import finishFragment from "../../src/game/shaders/finish.fragment.fx?raw";
import {
  WEATHER_PRESETS, fogDensityUnder, saturationUnder, ambientCollapseUnder,
  FOG_DREAD_GAIN, FOG_MIST_GAIN, AMBIENT_COLLAPSE, DREAD_SATURATION_DROP, DREAD_FOG_PULL,
} from "../../src/game/weather.js";
import { fogDensityFor } from "../../src/game/sky.js";
import { skyStateFor } from "../../src/game/skyState.js";
import {
  gradeRecordUnder, LIFT_DREAD, VIGNETTE_PULSE, VIGNETTE_PULSE_PERIOD, PURKINJE_MAX, ABERRATION_DREAD_GAIN,
} from "../../src/game/gradeParams.js";
import { finishUnder, OVERLAP_MAX, OVERLAP_INNER, OVERLAP_ECHO, GRAIN_DREAD_GAIN } from "../../src/game/postParams.js";
import { skyFixture } from "./helpers/skyFixture.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;
const DREAD_ONLY = { ...CLEAR, dread: 1 };
/** The escalation's end, 20:00, is full night: the sun is 29 degrees down. */
const NIGHT = 1;

function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

describe("darker and swallowed", () => {
  it("dread thickens the far fog on top of mist, and clear is exact", () => {
    expect(fogDensityUnder(CLEAR, 4000)).toBe(fogDensityFor(4000));
    expect(fogDensityUnder(DREAD_ONLY, 4000)).toBeCloseTo(fogDensityFor(4000) * (1 + FOG_DREAD_GAIN), 12);
    // Eerie carries rain 0.3, which at the rain gain of 0.5 is another 1.15x.
    expect(fogDensityUnder(EERIE, 4000)).toBeCloseTo(fogDensityFor(4000) * (1 + FOG_MIST_GAIN) * 1.15 * (1 + FOG_DREAD_GAIN), 12);
  });

  it("the ambient collapses hard on the top plateau", () => {
    expect(AMBIENT_COLLAPSE).toBeGreaterThanOrEqual(0.7);
    expect(ambientCollapseUnder(EERIE)).toBeCloseTo(1 - AMBIENT_COLLAPSE, 12);
    expect(ambientCollapseUnder(CLEAR)).toBe(1);
  });

  it("night rods pull harder", () => {
    expect(PURKINJE_MAX).toBeGreaterThanOrEqual(0.8);
    // Midnight's night factor is 1, and the rods take 0.8 of the colour.
    const night = skyStateFor(skyFixture(), 0, CLEAR).night;
    expect(night).toBe(1);
    expect(gradeRecordUnder(CLEAR, 0, night, 1).purkinjeStrength).toBeCloseTo(0.8, 10);
  });
});

describe("sicker, not just darker", () => {
  it("shadows lift toward a green-grey under dread, and stay black at clear", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const night of [0, 0.5, 1]) {
        expect(gradeRecordUnder(CLEAR, hour, night, 1).lift).toEqual({ r: 0, g: 0, b: 0 });
      }
    }
    const lifted = gradeRecordUnder(EERIE, 20, NIGHT, 1).lift;
    expect(lifted).toEqual(LIFT_DREAD);
    expect(lifted.g).toBeGreaterThan(lifted.r);
    expect(lifted.g).toBeGreaterThan(lifted.b);
    // World-side: the slider does not touch it.
    expect(gradeRecordUnder(EERIE, 20, NIGHT, 0).lift).toEqual(LIFT_DREAD);
  });

  it("the grade pass carries a global desaturation that is exactly 0 at clear", () => {
    expect(gradeRecordUnder(CLEAR, 12, 0, 1).saturation).toBe(0);
    expect(gradeRecordUnder(EERIE, 20, NIGHT, 1).saturation).toBeCloseTo(saturationUnder(EERIE) / 100, 12);
    expect(DREAD_SATURATION_DROP).toBeGreaterThanOrEqual(30);
    expect(DREAD_FOG_PULL).toBeGreaterThanOrEqual(0.7);
  });

  it("the GLSL takes the lift as a colour and the saturation as a uniform", () => {
    expect(gradeFragment).toContain("uniform vec3 lift;");
    expect(gradeFragment).toContain("uniform float saturation;");
  });
});

describe("heavier lens", () => {
  it("full dread is unmistakable and unsettle 0 still silences it", () => {
    expect(OVERLAP_MAX).toBeGreaterThanOrEqual(0.8);
    expect(OVERLAP_INNER).toBeLessThanOrEqual(0.45);
    expect(GRAIN_DREAD_GAIN).toBeGreaterThanOrEqual(4);
    expect(ABERRATION_DREAD_GAIN).toBeGreaterThanOrEqual(3);
    expect(finishUnder(EERIE, 0, 0).overlapGain).toBe(0);
    expect(finishFragment).toContain(`const float OVERLAP_ECHO = ${glslFloat(OVERLAP_ECHO)};`);
    expect(finishFragment).toContain(`const float OVERLAP_INNER = ${glslFloat(OVERLAP_INNER)};`);
  });

  it("the vignette breathes under dread and holds still at clear", () => {
    const quarter = VIGNETTE_PULSE_PERIOD / 4;
    const rest = gradeRecordUnder(EERIE, 20, NIGHT, 1, 0).vignetteWeight;
    const peak = gradeRecordUnder(EERIE, 20, NIGHT, 1, quarter).vignetteWeight;
    expect(peak).toBeCloseTo(rest * (1 + VIGNETTE_PULSE), 10);
    expect(gradeRecordUnder(EERIE, 20, NIGHT, 0, quarter).vignetteWeight).toBe(gradeRecordUnder(EERIE, 20, NIGHT, 0, 0).vignetteWeight);
    for (const t of [0, 1.7, quarter, 5.5]) {
      expect(gradeRecordUnder(CLEAR, 20, NIGHT, 1, t).vignetteWeight).toBe(gradeRecordUnder(CLEAR, 20, NIGHT, 1, 0).vignetteWeight);
    }
  });
});
```

- [ ] **Step 3: Run them and see them fail.** Run `npx vitest run --root client test/game/gradeParams.test.ts test/game/dreadNight.test.ts`. Expected: FAIL. Today's `whitePointMatrix(0)` reads its argument as an altitude (the horizon), so "is the identity while the night factor is 0" fails on `toBe(IDENTITY)`; today's `gradeRecordUnder` reads the new third argument as `unsettle`, so "dread raises the lens terms…" fails (`off` is built with unsettle 0 in the old fourth place, read as time) and "purkinje follows the night factor" fails at 18:30.

- [ ] **Step 4: Grade by the night factor.** In `client/src/game/gradeParams.ts`:
  - Replace line 2, `import { sunPositionAt, twilightT } from "./sky.js";`, with `import { sunPositionAt } from "./sky.js";`.
  - Replace lines 100–105:

```ts
/** D65, the sRGB white: the adaptation SOURCE, so noon is the identity. */
const WHITE_NOON = { x: 0.3127, y: 0.329 };
/** A warm dusk white (~4300 K) the image is adapted TOWARD at the horizon. */
export const WHITE_DUSK = { x: 0.3660, y: 0.3730 };
/** A cool night white (~8500 K). */
export const WHITE_NIGHT = { x: 0.2920, y: 0.3020 };
```

  with:

```ts
/** D65, the sRGB white: the adaptation SOURCE, so the day is the identity. */
const WHITE_NOON = { x: 0.3127, y: 0.329 };
/** A cool night white (~8500 K): the image's adaptation in full night. */
export const WHITE_NIGHT = { x: 0.2920, y: 0.3020 };
```

  - Replace `whitePointMatrix` (lines 130–142):

```ts
/** Identity at noon (altitude ≥ 0.35), warm at the horizon, cool below it. */
export function whitePointMatrix(altitude: number): Mat3 {
  if (altitude >= 0.35) return IDENTITY;
  const t = twilightT(altitude);
  // t is 0 deep in the night, 1 at full day; the horizon sits where the
  // altitude is 0, i.e. t = NIGHT_ALTITUDE / (NIGHT_ALTITUDE + DAY_ALTITUDE).
  const horizon = twilightT(0);
  const target =
    t >= horizon
      ? lerpXy(WHITE_DUSK, WHITE_NOON, (t - horizon) / (1 - horizon))
      : lerpXy(WHITE_NIGHT, WHITE_DUSK, t / horizon);
  return bradfordMatrix(target);
}
```

  with:

```ts
/**
 * The identity through the day and the twilight, while the sky's night factor
 * (`SkyState.night`) is 0: the sky itself carries the dusk's colour now, so a
 * warm white point on top would warm it twice. Cooler toward the night white
 * as the factor rises, and the night white itself at 1.
 */
export function whitePointMatrix(night: number): Mat3 {
  if (night === 0) return IDENTITY;
  return bradfordMatrix(lerpXy(WHITE_NOON, WHITE_NIGHT, night));
}
```

  - Replace the doc comment, the signature and the first lines of `gradeRecordUnder` (lines 207–218):

```ts
/**
 * The grade pass's record. `timeSeconds` only drives the vignette's breath;
 * it defaults to 0 so callers that do not animate (and every identity test)
 * see the resting weight. `stare` (hollow.ts) darkens the image toward black
 * at 1 and closes the vignette.
 */
export function gradeRecordUnder(w: WeatherParams, hour: number, unsettle: number, timeSeconds = 0, stare = 0): GradeRecord {
  const altitude = sunPositionAt(hour).y;
  const lens = dreadLensUnder(w) * clamp01(unsettle);
  const world = dreadWorldUnder(w);
  const mood = moodUnder(w);
  const night = 1 - clamp01(twilightT(altitude) / twilightT(0));
```

  with:

```ts
/**
 * The grade pass's record. `night` is the sky's night factor
 * (`SkyState.night`): the white point cools and the rods take over by it.
 * `timeSeconds` only drives the vignette's breath; it defaults to 0 so
 * callers that do not animate (and every identity test) see the resting
 * weight. `stare` (hollow.ts) darkens the image toward black at 1 and closes
 * the vignette.
 */
export function gradeRecordUnder(w: WeatherParams, hour: number, night: number, unsettle: number, timeSeconds = 0, stare = 0): GradeRecord {
  const altitude = sunPositionAt(hour).y;
  const lens = dreadLensUnder(w) * clamp01(unsettle);
  const world = dreadWorldUnder(w);
  const mood = moodUnder(w);
```

  and, in the returned record, replace `    whitePoint: whitePointMatrix(altitude),` with `    whitePoint: whitePointMatrix(night),`. The line `    purkinjeStrength: night === 0 ? 0 : PURKINJE_MAX * night,` stays as it is: it now reads the parameter.

- [ ] **Step 5: Run them and see them pass.** Run `npx vitest run --root client test/game/gradeParams.test.ts test/game/dreadNight.test.ts`. Expected: PASS.

- [ ] **Step 6: Write the failing post test.** In `client/test/game/post.test.ts`, give every `post.update` call the night factor after the hour:

```bash
perl -0pi -e 's/post\.update\((WEATHER_PRESETS\.\w+), (\d+(?:\.\d+)?), /post.update($1, $2, 0, /g' client/test/game/post.test.ts
```

  Then `grep -c "post.update(" client/test/game/post.test.ts` prints `21` and `grep -cE "post\.update\(WEATHER_PRESETS\.\w+, [0-9]+, 0, [01], 0(, [0-9.]+)?\);" client/test/game/post.test.ts` prints `21`: every call now reads `(weather, hour, 0, unsettle, stare[, lens])`. Then, before the test `  it("starts the lens detached, attaches it at 0.02, and detaches it a second after its strength falls under that, in its slot", () => {` (line 220), add:

```ts
  it("hands the grade pass the night factor: the identity white point and no rods by day, the night white and the rods' 0.8 at night", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("medium", true));
    const uniforms = (): { floats: Record<string, unknown>; whitePoint: number[] } => {
      const calls: { fn: string; args: unknown[] }[] = [];
      const fakeEffect = new Proxy(
        {},
        { get: (_target, prop: string) => (...args: unknown[]) => calls.push({ fn: prop, args }) },
      ) as unknown as Effect;
      passNamed(camera, "grade").onApplyObservable.notifyObservers(fakeEffect);
      const floats = Object.fromEntries(calls.filter((c) => c.fn === "setFloat").map((c) => [c.args[0], c.args[1]]));
      const white = calls.find((c) => c.fn === "setMatrix3x3" && c.args[0] === "whitePoint");
      return { floats, whitePoint: Array.from(white?.args[1] as Float32Array) };
    };
    // Sunset at clear: the sky's twilight, and still day to the eye.
    post.update(WEATHER_PRESETS.clear, 18, 0, 1, 0);
    const day = uniforms();
    expect(day.floats["purkinjeStrength"]).toBe(0);
    expect(day.whitePoint).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    post.update(WEATHER_PRESETS.clear, 0, 1, 1, 0);
    const night = uniforms();
    expect(night.floats["purkinjeStrength"]).toBeCloseTo(0.8, 6);
    // The night white's blue gain, as a float32 uniform.
    expect(night.whitePoint[8]).toBeCloseTo(1.242522254356526, 6);
    post.dispose();
    camera.dispose();
  });

```

- [ ] **Step 7: Run it and see it fail.** Run `npx vitest run --root client test/game/post.test.ts`. Expected: FAIL in "hands the grade pass the night factor…": today's `update` reads the inserted `0` as `unsettle` and its `gradeRecordUnder` takes no night, so at hour 0 `purkinjeStrength` is computed from the hour and the white point at hour 18 is the warm dusk one, `expected [ …(9) ] to deeply equal [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ]`.

- [ ] **Step 8: Pass the night factor through the post chain.** In `client/src/game/post.ts`:
  - Replace the `Post` type (lines 27–32):

```ts
export type Post = {
  readonly features: PostFeatures;
  /** `lens` is the smoothed strength of the rain on the glass (lensParams.ts), 0 when dry. */
  update(weather: WeatherParams, hour: number, unsettle: number, stare: number, lens?: number): void;
  dispose(): void;
};
```

  with:

```ts
export type Post = {
  readonly features: PostFeatures;
  /** `night` is the sky's night factor (`SkyState.night`), which the white
   * point and the rods follow. `lens` is the smoothed strength of the rain
   * on the glass (lensParams.ts), 0 when dry. */
  update(weather: WeatherParams, hour: number, night: number, unsettle: number, stare: number, lens?: number): void;
  dispose(): void;
};
```

  - Replace line 144, `  let record: GradeRecord = gradeRecordUnder(WEATHER_PRESETS.clear, 12, 1);`, with `  let record: GradeRecord = gradeRecordUnder(WEATHER_PRESETS.clear, 12, 0, 1);`.
  - Replace lines 301–303:

```ts
    update(weather, hour, unsettle, stare, lensTarget = 0) {
      const seconds = (now() - start) / 1000;
      record = gradeRecordUnder(weather, hour, unsettle, seconds, stare);
```

  with:

```ts
    update(weather, hour, night, unsettle, stare, lensTarget = 0) {
      const seconds = (now() - start) / 1000;
      record = gradeRecordUnder(weather, hour, night, unsettle, seconds, stare);
```

  In `client/src/game/renderer.ts` replace `      post.update(weather, lighting.hour, unsettle, stare, lensStrength);` with:

```ts
      // Before the sky's first slices there is no night factor; the day's 0
      // stands in, for frames no one sees.
      post.update(weather, lighting.hour, sky?.night ?? 0, unsettle, stare, lensStrength);
```

- [ ] **Step 9: Run them and see them pass.** Run `npx vitest run --root client test/game/post.test.ts test/game/gradeParams.test.ts test/game/dreadNight.test.ts test/game/renderer.test.ts test/game/hollowLook.test.ts test/game/motesParams.test.ts`. Expected: PASS (the exposure curve the Hollow's eyes are tuned to is untouched, and the motes still read `twilightT`).

- [ ] **Step 10: Check what is gone has no caller.** Run `git grep -n -w -e WHITE_DUSK -e twilightT -- client/src client/test`. Expected: no `WHITE_DUSK` anywhere; `twilightT` only in `client/src/game/sky.ts` (its definition) and `client/src/game/motesParams.ts` (lines 3, 9, 42, 43), which picks the motes' species by it and stays.

- [ ] **Step 11: Typecheck and lint.** Run `npx tsc -p client --noEmit` (expected: no output) and `npx eslint client/src/game/gradeParams.ts client/src/game/post.ts client/src/game/renderer.ts client/test/game/gradeParams.test.ts client/test/game/dreadNight.test.ts client/test/game/post.test.ts` (expected: no output).

- [ ] **Step 12: Commit.**

```bash
git add client/src/game/gradeParams.ts client/src/game/post.ts client/src/game/renderer.ts client/test/game/gradeParams.test.ts client/test/game/dreadNight.test.ts client/test/game/post.test.ts
git commit -F - <<'EOF'
feat: grade by the sky's night factor, not the sun's height

## What
The grade's white point is now the identity through the day and the
twilight, and cools toward the night white only as the sky's night factor
rises; the warm dusk white point is gone, because the scattering sky carries
the dusk's colour itself. The rods' Purkinje shift follows the same factor,
0.8 at full night as before. Midnight's matrix is unchanged.

## How
- `client/src/game/gradeParams.ts`: `whitePointMatrix(night)`; `gradeRecordUnder` takes the night factor after the hour and drives the white point and Purkinje by it; `WHITE_DUSK` removed.
- `client/src/game/post.ts`: `update` takes the night factor and hands it to the record.
- `client/src/game/renderer.ts`: the lighting's state's night factor passed each frame, 0 before the first slices.
- `client/test/game/gradeParams.test.ts`, `client/test/game/dreadNight.test.ts`: the identity while the factor is 0, midnight's matrix pinned, Purkinje through the sky fixture's night factor.
- `client/test/game/post.test.ts`: every update given the factor; the grade pass's uniforms by day and by night.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

- [ ] **Step 13: Run the repository's pre-push scan** and confirm it reports nothing for this commit.


### Task 8: No frame before the sky's first slices; one table for the hike

**Files:**
- Modify: `client/src/game/lighting.ts` (a new export after `skyHeld`)
- Modify: `client/src/game/renderer.ts` (the lighting import; the `Renderer` type after line 1120 on `main`; the returned object after line 1850 on `main`)
- Modify: `client/src/app.ts` (import at line 37; the `ready` doc at lines 124–126; after line 278; line 319; lines 1454–1478; line 1529; after line 1838)
- Modify: `client/src/game/scene/sceneRoute.ts` (imports after line 22; `DayhikeScene.ready` doc at lines 48–49; `SceneRouteDeps` after line 69; lines 96–99; line 196; lines 241–246; after line 297)
- Modify: `client/src/game/probeScene.ts` (module doc at lines 7–8; an import after line 12; a new export before line 90; lines 126 and 157)
- Test: `client/test/game/rendererStart.test.ts` (imports; a new `describe` at the end)
- Test: `client/test/game/rendererSwap.test.ts` (imports; a new `describe` before line 572)
- Test: `client/test/game/scene/sceneRoute.test.ts` (imports; every `startSceneRoute` call; the first test; a new test at the end)
- Test: `client/test/game/probeScene.test.ts` (import at line 48; a new `describe` before line 74)
- Create: `client/test/game/appSky.test.ts`
- Line numbers are `main`'s (9edee7e); an earlier task's edits move some of them, and every edit quotes the text it replaces.

**Interfaces:**

Consumes:
- Task 2: `startSkySource(startDeg)`, `SkySource.table`, `createSkyTable()`, `type SkyTable` (`has`, `onChange`, `add`, `blendAt`, `whenReady`, `count`). `startSkySource` falls back to this thread when the worker cannot be made or errors, keeping what already arrived.
- Task 3: `skyFixture()`.
- Task 5: `sunAltitudeDeg(hour)`, `skyHeld(table, hour)`, `RendererOptions.skyTable`, `LightingOptions.sky`.

Produces:
- `export function whenSkyHeld(table: SkyTable, hour: () => number): Promise<void>` (`lighting.ts`): resolves once `skyHeld(table, hour())`, `hour` read again at every slice that arrives.
- `Renderer.skyReady(): Promise<void>` — `whenSkyHeld(skyTable, () => lighting.hour)`.
- `SceneRouteDeps.skyTable?: SkyTable` — absent, the route starts `startSkySource(sunAltitudeDeg(hour))` at its own hour and disposes it on leaving.
- `export function probeSceneReady(meterReady: boolean, skyIn: boolean, scene: Pick<Scene, "isReady" | "getWaitingItemsCount">): boolean` (`probeScene.ts`).
- The app: one `skySource` for the hike, `startSkySource(sunAltitudeDeg(startHour))` where `startHour` is the script's last `time` entry or `DEFAULT_HOUR`; `skyTable: skySource.table` on both `createRenderer` calls; the loop starts, and `ready` waits, on `Promise.all([clipmapBuilt, built.skyReady()])`.
- A tier swap needs no code of its own to keep the table: `rendererSwap.ts` is unchanged, and the swap's `build` binding passes the hike's table. The swap's cover still waits on `whenSceneReady(renderer.scene, made.leftMs, renderer.forestReady)` alone (the hike's table already holds every slice by the time a swap can happen, and the pins in `architecture.test.ts` and `webgpuSwitchOff.test.ts` stay as they are).

- [ ] **Step 1: Write the failing renderer tests.**
  - `client/test/game/rendererStart.test.ts`: after line 28 (`import { timeLimit } from "../helpers/timeLimit.js";`) add:

```ts
import { createSkyTable } from "../../src/game/skyTable.js";
import { skyFixture } from "./helpers/skyFixture.js";
```

  and at the end of the file add:

```ts

/** One turn of the event loop: long enough for a resolved promise's callbacks. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the renderer's sky before its first frame", () => {
  it("is ready once its table holds the slices either side of noon, at noon, and not before", async () => {
    const table = createSkyTable();
    const fixture = skyFixture();
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: table });
    try {
      let ready = false;
      void r.skyReady().then(() => {
        ready = true;
      });
      await tick();
      expect(ready).toBe(false);
      table.add(fixture.blendAt(74));
      await tick();
      expect(ready).toBe(false);
      table.add(fixture.blendAt(76));
      await tick();
      expect(ready).toBe(true);
    } finally {
      r.dispose();
    }
  }, timeLimit(60_000));

  it("waits for the hour it is set to while it waits, not the hour it was asked at", async () => {
    const table = createSkyTable();
    const fixture = skyFixture();
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: table });
    try {
      let ready = false;
      void r.skyReady().then(() => {
        ready = true;
      });
      r.setHour(15);
      table.add(fixture.blendAt(74));
      table.add(fixture.blendAt(76));
      await tick();
      expect(ready).toBe(false);
      // 15:00's sun stands between the slices at 42 and 44 degrees.
      table.add(fixture.blendAt(42));
      table.add(fixture.blendAt(44));
      await tick();
      expect(ready).toBe(true);
    } finally {
      r.dispose();
    }
  }, timeLimit(60_000));

  it("is ready at once on a table that already holds them", async () => {
    const r = createRenderer(nullCanvas(), LEVEL, null, { tier: "low", skyTable: skyFixture() });
    try {
      await expect(r.skyReady()).resolves.toBeUndefined();
    } finally {
      r.dispose();
    }
  }, timeLimit(60_000));
});
```

  - `client/test/game/rendererSwap.test.ts`: after line 72 (`import { timeLimit } from "../helpers/timeLimit.js";`) add:

```ts
import type { SkyTable } from "../../src/game/skyTable.js";
import { skyFixture } from "./helpers/skyFixture.js";
```

  and before line 572 (`describe("a swap that fails at every tier, on NullEngine", () => {`) add:

```ts
describe("a swap keeps the hike's sky", () => {
  it("hands the new renderer the table the old one read, which the old one lets go of and nothing disposes", async () => {
    const fixture = skyFixture();
    let listening = 0;
    // The fixture's table, counting who listens to it.
    const table: SkyTable = {
      add: (slice) => fixture.add(slice),
      get count() {
        return fixture.count;
      },
      has: (altitudeDeg) => fixture.has(altitudeDeg),
      blendAt: (altitudeDeg) => fixture.blendAt(altitudeDeg),
      whenReady: (altitudeDeg) => fixture.whenReady(altitudeDeg),
      onChange(listener) {
        listening += 1;
        const off = fixture.onChange(listener);
        return () => {
          listening -= 1;
          off();
        };
      },
    };
    const held = table.count;
    const current = { renderer: createRenderer(nullCanvas(), LEVEL, null, { tier: "medium", skyTable: table }), canvas: nullCanvas() };
    expect(listening).toBe(1);
    const bindings: SwapBindings = {
      build: (canvas, tier) => createRenderer(canvas, LEVEL, null, { tier, skyTable: table }),
      freshCanvas: nullCanvas,
      extras: { dispose: () => undefined, build: () => undefined },
      rebind: () => undefined,
      restore: () => undefined,
      loop: () => undefined,
      unwatch: () => undefined,
      watch: () => undefined,
      engineFailed: () => undefined,
    };
    const next = swapRenderer(current, { tier: "low", engine: null, fallbackTier: "medium" }, bindings);
    try {
      // The old lighting stopped listening; the new one listens to the same table.
      expect(listening).toBe(1);
      await expect(next.renderer.skyReady()).resolves.toBeUndefined();
      expect(table.count).toBe(held);
    } finally {
      next.renderer.dispose();
    }
    expect(listening).toBe(0);
  }, timeLimit(120_000));
});

```

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run --root client test/game/rendererStart.test.ts test/game/rendererSwap.test.ts`. Expected: FAIL in the four new tests with `TypeError: r.skyReady is not a function` (`next.renderer.skyReady` in the swap's); the existing tests pass.

- [ ] **Step 3: Give the renderer `skyReady`.**
  - In `client/src/game/lighting.ts`, after `skyHeld`, add:

```ts
/**
 * Resolves once `skyHeld(table, hour())` holds. `hour` is read again at every
 * slice that arrives, so an hour changed while the first slices are made is
 * the one waited for.
 */
export function whenSkyHeld(table: SkyTable, hour: () => number): Promise<void> {
  return new Promise((resolve) => {
    if (skyHeld(table, hour())) {
      resolve();
      return;
    }
    const off = table.onChange(() => {
      if (!skyHeld(table, hour())) return;
      off();
      resolve();
    });
  });
}
```

  - In `client/src/game/renderer.ts`, replace `import { createLighting, DEFAULT_HOUR, sunAltitudeDeg } from "./lighting.js";` with `import { createLighting, DEFAULT_HOUR, sunAltitudeDeg, whenSkyHeld } from "./lighting.js";`. In the `Renderer` type, after `  readonly forestReady: Promise<void>;` (line 1120 on `main`), add:

```ts
  /** Resolves once the sky's table holds the slices the lighting needs:
   * those either side of noon and of the hour the renderer is set to, read
   * again as each slice arrives (`whenSkyHeld`). Until then the lighting has
   * applied nothing, so no start draws a frame before it: the hike's, the
   * scene routes', the tier check's. */
  skyReady(): Promise<void>;
```

  In the returned object, after `    forestReady: forestMeshes?.ready ?? Promise.resolve(),` (line 1850 on `main`), add:

```ts
    skyReady() {
      return whenSkyHeld(skyTable, () => lighting.hour);
    },
```

- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run --root client test/game/rendererStart.test.ts test/game/rendererSwap.test.ts test/game/lighting.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing scene-route test.** In `client/test/game/scene/sceneRoute.test.ts`:
  - After line 20 (`import { startSceneRoute } from "../../../src/game/scene/sceneRoute.js";`) add:

```ts
import { createSkyTable } from "../../../src/game/skyTable.js";
import { skyFixture } from "../helpers/skyFixture.js";
```

  - Hand every route the fixture's sky: run `perl -0pi -e 's/tier: "low",/tier: "low", skyTable: skyFixture(),/g' client/test/game/scene/sceneRoute.test.ts`, then `grep -c 'skyTable: skyFixture()' client/test/game/scene/sceneRoute.test.ts` prints `6` (one per `startSceneRoute` call).
  - In the first test, replace

```ts
      { t: 20, step: null },
    );
    const before = JSON.stringify(run.worldState());
```

  with

```ts
      { t: 20, step: null },
    );
    // The loop asks for its first frame once the sky's slices are in, a turn later.
    await new Promise((r) => setTimeout(r, 0));
    const before = JSON.stringify(run.worldState());
```

  - At the end of the file, replace the last test's closing and the `describe`'s

```ts
    expect([renders, waits]).toEqual([51, 2]);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));
});
```

  with

```ts
    expect([renders, waits]).toEqual([51, 2]);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));

  it("asks for no frame, and is not ready, before the sky's first slices are in", async () => {
    const doc = installStandInDom();
    const frames: ((ms: number) => void)[] = [];
    const table = createSkyTable();
    const run = startSceneRoute(
      {
        canvas: nullCanvas(), container: asHtml(doc.createElement("div")), tier: "low", skyTable: table, now: () => 0, loadCar: async () => null,
        raf: (fn) => { frames.push(fn); return frames.length; }, paint: (s, name) => new PBRMaterial(name, s), worldIn: async () => undefined,
      },
      { t: 20, step: null },
    );
    const api = (globalThis as { dayhikeScene?: { ready: Promise<void> } }).dayhikeScene!;
    let readied = false;
    void api.ready.then(() => { readied = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(frames.length).toBe(0);
    expect(readied).toBe(false);
    // The intro's noon: the slices either side of the noon sun.
    const fixture = skyFixture();
    table.add(fixture.blendAt(74));
    table.add(fixture.blendAt(76));
    await new Promise((r) => setTimeout(r, 0));
    expect(frames.length).toBe(1);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));
});
```

- [ ] **Step 6: Run it and see it fail.** Run `npx vitest run --root client test/game/scene/sceneRoute.test.ts`. Expected: FAIL in "asks for no frame…" with `expected 1 to be 0` (today's route asks for its first frame at once); the other tests pass.

- [ ] **Step 7: Hold the routes' first frame for the sky.** In `client/src/game/scene/sceneRoute.ts`:
  - After line 22 (`import { createRenderer } from "../renderer.js";`) add:

```ts
import type { SkyTable } from "../skyTable.js";
import { startSkySource } from "../skyWorker.js";
import { sunAltitudeDeg } from "../lighting.js";
```

  - Replace the `ready` doc in `DayhikeScene` (lines 48–49)

```ts
  /** Resolves once the intro's ranger and car have loaded or failed, or the
   * title's world is in around its first camera: a recorder waits on it. */
```

  with

```ts
  /** Resolves once the sky's first slices are in and the intro's ranger and
   * car have loaded or failed, or the title's world is in around its first
   * camera: a recorder waits on it. */
```

  - In `SceneRouteDeps`, after `  worldIn?: (maxMs: number) => Promise<void>;` (line 69), add:

```ts
  /** The sky's slices. Absent, the route makes its own, from its hour
   * outward (`startSkySource`), and stops them on leaving; a test hands in a
   * table of its own. */
  skyTable?: SkyTable;
```

  - Replace lines 97–99:

```ts
  const renderer = createRenderer(deps.canvas, level, forest, { tier: deps.tier, engine: deps.engine, clock: () => clock.time() * 1000, wildlife: false });
  renderer.setWeather(title ? TITLE_WEATHER : INTRO_WEATHER, 0);
  renderer.setHour(title ? TITLE_HOUR : INTRO_HOUR);
```

  with

```ts
  const hour = title ? TITLE_HOUR : INTRO_HOUR;
  // The sky's slices, from the route's hour outward: handed in, or made here
  // and stopped on leaving the route.
  const ownSky = deps.skyTable === undefined ? startSkySource(sunAltitudeDeg(hour)) : null;
  const renderer = createRenderer(deps.canvas, level, forest, {
    tier: deps.tier, engine: deps.engine, clock: () => clock.time() * 1000, wildlife: false, skyTable: deps.skyTable ?? ownSky?.table,
  });
  renderer.setWeather(title ? TITLE_WEATHER : INTRO_WEATHER, 0);
  renderer.setHour(hour);
```

  - Replace line 196, `  const ready = title ? worldIn(READY_MAX_MS) : Promise.all([rangerLoaded, carLoaded]).then(() => undefined);`, with:

```ts
  const loaded = title ? worldIn(READY_MAX_MS) : Promise.all([rangerLoaded, carLoaded]).then(() => undefined);
  const ready = Promise.all([renderer.skyReady(), loaded]).then(() => undefined);
```

  - Replace lines 241–246:

```ts
  const loop = (): void => {
    if (disposed || !looping) return;
    drawOneFrame();
    raf(loop);
  };
  raf(loop);
```

  with

```ts
  const loop = (): void => {
    if (disposed || !looping) return;
    drawOneFrame();
    raf(loop);
  };
  // No frame before the sky's first slices are in (`Renderer.skyReady`):
  // until then the lighting has applied nothing.
  void renderer.skyReady().then(() => {
    if (!disposed) raf(loop);
  });
```

  - In `dispose()`, replace the final `      renderer.dispose();` (line 297) with:

```ts
      renderer.dispose();
      ownSky?.dispose();
```

- [ ] **Step 8: Run it and see it pass.** Run `npx vitest run --root client test/game/scene/sceneRoute.test.ts`. Expected: PASS, 7 tests.

- [ ] **Step 9: Write the failing tier-check test.** In `client/test/game/probeScene.test.ts` replace line 48, `import { buildProbeScene, measureOnRuleEngine, runProbeStep, type StepEngine } from "../../src/game/probeScene.js";`, with `import { buildProbeScene, measureOnRuleEngine, probeSceneReady, runProbeStep, type StepEngine } from "../../src/game/probeScene.js";`, and before line 74 (`describe("a probe step's engine", () => {`) add:

```ts
describe("a probe step's readiness", () => {
  it("waits for the sky's first slices as well as the scene, and stays ready once the meter has found it so", () => {
    const ready = { isReady: () => true, getWaitingItemsCount: () => 0 };
    const loading = { isReady: () => true, getWaitingItemsCount: () => 2 };
    expect(probeSceneReady(false, false, ready)).toBe(false);
    expect(probeSceneReady(false, true, ready)).toBe(true);
    expect(probeSceneReady(false, true, loading)).toBe(false);
    expect(probeSceneReady(true, false, loading)).toBe(true);
  });

  it("is what each step's frame asks, the sky in once the renderer says so", () => {
    // A step's frames need a page to run; its wiring is read from the source.
    const src = readFileSync(new URL("../../src/game/probeScene.ts", import.meta.url), "utf8");
    expect(src).toContain("void probe.renderer.skyReady().then(() => {\n      skyIn = true;\n    });");
    expect(src).toContain("const sceneReady = probeSceneReady(meter.ready, skyIn, scene);");
  });
});

```

- [ ] **Step 10: Run it and see it fail.** Run `npx vitest run --root client test/game/probeScene.test.ts`. Expected: FAIL in "waits for the sky's first slices…" with `TypeError: probeSceneReady is not a function`, and in "is what each step's frame asks…" on the first `toContain`.

- [ ] **Step 11: Measure the tier check's frames only once its sky is in.** In `client/src/game/probeScene.ts`:
  - In the module doc, replace

```ts
 * non-authoritative world, mist, noon. It waits for the scene to be ready,
 * discards the warm-up frames, measures the intervals between render-loop
```

  with

```ts
 * non-authoritative world, mist, noon. It waits for the sky's first slices
 * and the scene to be ready, discards the warm-up frames, measures the
 * intervals between render-loop
```

  - After line 12 (`import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";`) add `import type { Scene } from "@babylonjs/core/scene.js";`.
  - Before the doc comment of `runProbeStep` (line 90) add:

```ts
/**
 * Whether a probe step's scene counts as ready this frame. Once the meter has
 * found it so, it stays so. Before that, the sky's first slices must be in
 * (`Renderer.skyReady`) as well as the scene ready with nothing waiting:
 * otherwise the frames warmed and measured could be the sky arriving (its
 * texture uploaded, the probe captured again), not the scene the tier draws.
 */
export function probeSceneReady(meterReady: boolean, skyIn: boolean, scene: Pick<Scene, "isReady" | "getWaitingItemsCount">): boolean {
  return meterReady || (skyIn && scene.isReady() && scene.getWaitingItemsCount() === 0);
}

```

  - After line 126 (`    const { engine, scene } = probe.renderer;`) add:

```ts
    // The step is not ready until the sky's first slices are in
    // (`probeSceneReady`); the meter's bound counts from here regardless.
    let skyIn = false;
    void probe.renderer.skyReady().then(() => {
      skyIn = true;
    });
```

  - Replace line 157, `        const sceneReady = meter.ready || (scene.isReady() && scene.getWaitingItemsCount() === 0);`, with `        const sceneReady = probeSceneReady(meter.ready, skyIn, scene);`.

- [ ] **Step 12: Run it and see it pass.** Run `npx vitest run --root client test/game/probeScene.test.ts`. Expected: PASS.

- [ ] **Step 13: Write the failing app test.** Create `client/test/game/appSky.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGL renderer, so nothing
 * here can start a hike under Node: the sky's wiring is read from the source, as
 * `wildlifeAudio.test.ts` reads the audio's.
 */
const src = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");

describe("the hike's sky", () => {
  it("makes one source for the hike's life, from the hour the script starts it at", () => {
    expect(src.match(/\bstartSkySource\(/g)).toHaveLength(1);
    expect(src).toContain('  const timeEntry = lastEntry(view, "time");');
    expect(src).toContain('  const startHour = typeof timeValue === "number" ? timeValue : DEFAULT_HOUR;');
    expect(src).toContain("  const skySource = startSkySource(sunAltitudeDeg(startHour));");
  });

  it("stops it with a start that throws, and on dispose after the renderer", () => {
    expect(src).toContain("  made(() => skySource.dispose());");
    const dispose = src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"));
    expect(dispose.indexOf("skySource.dispose();")).toBeGreaterThan(dispose.indexOf("if (!broken) renderer.dispose();"));
  });

  it("hands its table to every renderer it builds: the first, and a swap's", () => {
    expect(src.match(/\bcreateRenderer\(/g)).toHaveLength(2);
    expect(src).toContain(
      "createRenderer(next, level, forest, { tier: at, engine: engine ?? undefined, pipelines: pipelinesFor(engine), deferClipmap: options.deferClipmap, skyTable: skySource.table }),",
    );
    expect(src).toContain(
      "build: (next, target, engine) => createRenderer(next, level, forest, { tier: target, engine: engine ?? undefined, pipelines: pipelinesFor(engine), skyTable: skySource.table }),",
    );
  });

  it("starts the loop, and so shows the world, only once the clipmap stands and the sky's first slices are in, on either start", () => {
    expect(src).toContain(
      "  const firstBuild = Promise.all([clipmapBuilt, built.skyReady()]).then(() => {\n    if (!disposed && !broken && renderer === built) built.engine.runRenderLoop(loop);\n  });",
    );
    // The first build's, and the governor's restart after it times the idle
    // frames; a swap's own runs in `rendererSwap.ts`.
    expect(src.match(/\.runRenderLoop\(loop\)/g)).toHaveLength(2);
    expect(src).toContain("  const ready = firstBuild.then(() =>");
  });
});
```

- [ ] **Step 14: Run it and see it fail.** Run `npx vitest run --root client test/game/appSky.test.ts`. Expected: FAIL in every test, the first with `expected null to have a length of 1` (no `startSkySource(` in `app.ts` yet).

- [ ] **Step 15: Make the hike's one table and wait for it.** In `client/src/app.ts`:
  - Replace line 37, `import { DEFAULT_HOUR } from "./game/lighting.js";`, with:

```ts
import { DEFAULT_HOUR, sunAltitudeDeg } from "./game/lighting.js";
import { startSkySource } from "./game/skyWorker.js";
```

  - Replace the `ready` doc in `GameHandle` (lines 124–126)

```ts
  /** The world ready to be looked at (`startReady`): the scene ready, the
   * forest's billboards in, on WebGPU a whole frame drawn; a minute after
   * the build at the latest. The loading bar reads ready with it. */
```

  with

```ts
  /** The world ready to be looked at (`startReady`): the sky's first slices
   * in and the first frame drawn, then the scene ready, the forest's
   * billboards in, on WebGPU a whole frame drawn; a minute after that first
   * frame at the latest. The loading bar reads ready with it. */
```

  - After line 278 (`  const forest = createForest(seed);`) add:

```ts
  // The sky's slices, made off the main thread once for the whole hike and
  // handed to every renderer it builds, a swap of tier's included, so no
  // swap makes them again. Made from the hour the script starts the hike at
  // outward (`sliceOrder`): the first frame waits only for the slices either
  // side of noon and of that hour. The hour is read as `applyView`'s `time`
  // branch reads it, before that branch applies it to the renderer.
  const timeEntry = lastEntry(view, "time");
  const timeValue = timeEntry === undefined ? undefined : findCommand("time")?.scriptValue?.(timeEntry.args);
  const startHour = typeof timeValue === "number" ? timeValue : DEFAULT_HOUR;
  const skySource = startSkySource(sunAltitudeDeg(startHour));
  made(() => skySource.dispose());
```

  - At line 319 (line 330 after the insertion above), replace `        createRenderer(next, level, forest, { tier: at, engine: engine ?? undefined, pipelines: pipelinesFor(engine), deferClipmap: options.deferClipmap }),` with `        createRenderer(next, level, forest, { tier: at, engine: engine ?? undefined, pipelines: pipelinesFor(engine), deferClipmap: options.deferClipmap, skyTable: skySource.table }),`.
  - Replace the start's loop block (lines 1454–1478 on `main`):

```ts
  // The world stage of the loading bar: the clipmap's rings, then the
  // forest's billboards. With the build deferred, the rings are made a slice
  // at a time with a paint between (`CLIPMAP_YIELD_EVERY`), and the render
  // loop starts once they stand; otherwise they stood with the renderer.
  const progress = reportProgress();
  progress?.total("world", RING_COUNT + 1);
  const ringBuilt = (level: number): void => {
    progress?.start("world", `ring${level}`);
    progress?.done("world", `ring${level}`);
  };
  let firstBuild: Promise<void>;
  if (options.deferClipmap === true) {
    // The loop starts on the renderer the build was for: one swapped in
    // meanwhile (`swapRenderer`) runs its own already.
    const built = renderer;
    firstBuild = built.buildFirstClipmap(CLIPMAP_YIELD_EVERY, ringBuilt).then(() => {
      if (!disposed && !broken && renderer === built) built.engine.runRenderLoop(loop);
    });
  } else {
    for (let level = 0; level < RING_COUNT; level++) ringBuilt(level);
    renderer.engine.runRenderLoop(loop);
    firstBuild = Promise.resolve();
  }
```

  with

```ts
  // The world stage of the loading bar: the clipmap's rings, then the
  // forest's billboards. With the build deferred, the rings are made a slice
  // at a time with a paint between (`CLIPMAP_YIELD_EVERY`); otherwise they
  // stood with the renderer. The render loop starts once they stand and the
  // sky's first slices are in.
  const progress = reportProgress();
  progress?.total("world", RING_COUNT + 1);
  const ringBuilt = (level: number): void => {
    progress?.start("world", `ring${level}`);
    progress?.done("world", `ring${level}`);
  };
  // The renderer both waits are for: one swapped in meanwhile
  // (`swapRenderer`) runs its own loop already.
  const built = renderer;
  let clipmapBuilt: Promise<void>;
  if (options.deferClipmap === true) {
    clipmapBuilt = built.buildFirstClipmap(CLIPMAP_YIELD_EVERY, ringBuilt);
  } else {
    for (let level = 0; level < RING_COUNT; level++) ringBuilt(level);
    clipmapBuilt = Promise.resolve();
  }
  // No frame is drawn, and so none shown, before the sky's first slices are
  // in (`Renderer.skyReady`): until then the lighting has applied nothing.
  const firstBuild = Promise.all([clipmapBuilt, built.skyReady()]).then(() => {
    if (!disposed && !broken && renderer === built) built.engine.runRenderLoop(loop);
  });
```

  - In `swapBindings` replace `    build: (next, target, engine) => createRenderer(next, level, forest, { tier: target, engine: engine ?? undefined, pipelines: pipelinesFor(engine) }),` with `    build: (next, target, engine) => createRenderer(next, level, forest, { tier: target, engine: engine ?? undefined, pipelines: pipelinesFor(engine), skyTable: skySource.table }),`.
  - In the handle's `dispose()`, replace

```ts
      if (!broken) renderer.dispose();
      wildlifeAudio?.dispose();
```

  with

```ts
      if (!broken) renderer.dispose();
      skySource.dispose();
      wildlifeAudio?.dispose();
```

- [ ] **Step 16: Run it and see it pass, with the other pins on `app.ts`.** Run `npx vitest run --root client test/game/appSky.test.ts test/architecture.test.ts test/game/webgpuSwitchOff.test.ts test/game/wildlifeAudio.test.ts test/game/startEngine.test.ts`. Expected: PASS (`architecture.test.ts` and `webgpuSwitchOff.test.ts` pin `switchNow`'s `whenSceneReady` line and the dispose order around `renderer.dispose()`, both untouched).

- [ ] **Step 17: Run the client suite.** Run `npx vitest run --root client --tags-filter='!wall-clock'`. Expected: PASS. (The WGSL build check, `tools/wgsl/check-build.mjs`, is not run here: the dome's stages are recorded into the corpus later.)

- [ ] **Step 18: Typecheck and lint.** Run `npx tsc -p client --noEmit` (expected: no output) and `npx eslint client/src/app.ts client/src/game/lighting.ts client/src/game/renderer.ts client/src/game/scene/sceneRoute.ts client/src/game/probeScene.ts client/test/game/rendererStart.test.ts client/test/game/rendererSwap.test.ts client/test/game/scene/sceneRoute.test.ts client/test/game/probeScene.test.ts client/test/game/appSky.test.ts` (expected: no output).

- [ ] **Step 19: Commit.**

```bash
git add client/src/app.ts client/src/game/lighting.ts client/src/game/renderer.ts client/src/game/scene/sceneRoute.ts client/src/game/probeScene.ts client/test/game/rendererStart.test.ts client/test/game/rendererSwap.test.ts client/test/game/scene/sceneRoute.test.ts client/test/game/probeScene.test.ts client/test/game/appSky.test.ts
git commit -F - <<'EOF'
feat: show no frame before the sky's first slices are in

## What
A hike now makes the sky's slices once, off the main thread, from the hour
its script starts it at, and hands the one table to every renderer it
builds, so a change of tier makes none of them again. No frame is drawn
before the table holds the slices either side of noon and of the hour: not
at the hike's start, deferred or direct, not in the title and intro scenes,
and not in the start-up tier check, whose frames are measured only once its
sky is in.

## How
- `client/src/game/lighting.ts`: `whenSkyHeld`, which follows the hour while it waits.
- `client/src/game/renderer.ts`: `Renderer.skyReady()`.
- `client/src/app.ts`: one sky source for the hike, from the script's start hour, stopped with it; its table to the first renderer and to each swap's; the render loop and the ready gate wait on `skyReady`.
- `client/src/game/scene/sceneRoute.ts`: a sky source at the route's hour, or a table handed in; no frame and no ready before the sky.
- `client/src/game/probeScene.ts`: `probeSceneReady`; a step is ready only once its sky is in.
- `client/test/game/rendererStart.test.ts`, `client/test/game/rendererSwap.test.ts`: `skyReady` against a filling table and a moving hour; a swap's renderer on the same table, the old one's listener gone.
- `client/test/game/scene/sceneRoute.test.ts`, `client/test/game/probeScene.test.ts`, `client/test/game/appSky.test.ts`: the routes', the tier check's and the hike's waits.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

- [ ] **Step 20: Run the repository's pre-push scan** and confirm it reports nothing for this commit.

### Task 9: The sky in the architecture

**Files:**
- Modify: `ARCHITECTURE.md` (the "## Rendering" section, the paragraph beginning "The look is an identity layer over PBR")

**Interfaces:**
- Consumes: the modules of Tasks 1–8 as built.
- Produces: nothing in code.

- [ ] **Step 1: Find the paragraph and the stale phrase**

Run: `grep -n "The look is an identity layer over PBR" ARCHITECTURE.md` and `grep -n "per-hour white point" ARCHITECTURE.md`
Expected: one line each, in the same paragraph.

- [ ] **Step 2: Insert the sky ahead of the look**

Insert this paragraph immediately before the paragraph found in Step 1, as its own paragraph:

```markdown
The sky is one model of the air's light (`client/src/game/skyModel.ts`): Rayleigh, aerosol and ozone scattering over a spherical planet, from which a module worker builds, at load, a transmittance table, a multiple-scattering table and, for 93 sun altitudes from 18° below the horizon to the noon sun's height, a 64 × 32 slice of the clear sky's radiance (`sky.worker.ts`, `skyWorker.ts`); the app keeps the table for its life, across tier swaps, and nothing is revealed before the slices the noon and the current hour need are in (`skyTable.ts`). A pure state (`skyState.ts`) blends the two slices either side of the sun and turns them, with the weather, into every value the scene reads from the sky: one scale fixed so the clear noon zenith keeps the luminance of the dome it replaced, an adaptation factor standing in for the eye as the light falls through twilight, a night factor where the moonlight takes over, a CIE overcast deck that cloud cover mixes in and whose brightness follows the clear light, the sun's colour and strength from the air's transmittance, the fill, and the horizon's colours away from and toward the sun. The dome (`skyDome.ts`, `shaders/skyDome.*.fx`) draws that composition from the blended slice uploaded as a half-float texture, a reflection probe captures it linear and half-float for every PBR material's image-based light, and the fog colour, the clear colour and the atmosphere plugin's gradient and glow take the same horizon colours, so the haze meets the dome at every hour.
```

- [ ] **Step 3: Correct the grade's description**

In the same section, replace `per-hour white point` with `a night white point`.

- [ ] **Step 4: Check the docs and the vocabulary**

Run: `npx vitest run --root tools docs/test` and `grep -n -i -w -E "tasks?|plans?|briefs?|agents?|sessions?|reviews?|rulings?|owner" ARCHITECTURE.md`
Expected: the docs test passes; the grep prints no line added by this change.

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md
git commit -F - <<'MSG'
docs: the scattering sky in the architecture

## What

The rendering section describes the sky as built: one scattering model,
its tables made in a worker at load and kept for the app's life, the
state every consumer reads, the dome that draws it, and the probe, fog
and haze that take the same horizon colours. The grade's white point is
now the night's alone.

## How

- `ARCHITECTURE.md` — a paragraph on the sky ahead of the look; "per-hour
  white point" corrected to "a night white point".

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
MSG
```

### Task 10: Calibration, the corpus, the checks by eye and the cost

Run in the browser with the measurement rig, and decided by eye. No product code is written here except constants the checks move and the recorded corpus.

**Files:**
- Modify (as the checks decide): `client/src/game/skyState.ts` (`SKY_GAMMA`, `NIGHT_YA_DAY`, `NIGHT_YA_NIGHT`, `DECK_TAU`, `MIST_HORIZON`, `SKY_IBL_SCALE`), `client/src/game/skyModel.ts` (`SKY_MIE_SCALE`), their tests' literals
- Modify: `client/shaders/corpus/` (the dome's stages added on every tier, the four `SkyMaterial` stages retired by path), `client/shaders/corpus/tiers.json`, `tools/wgsl/test/corpusFiles.test.mjs` (its counts)
- Modify: `docs/rendering/2026-10-03-scattering-sky-design.md` (a closing section, as built: departures, the cost table, the checks)

- [ ] **Step 1: Hooks and servers.** Apply the measurement hooks to a scratch worktree at the branch's head and to one at `origin/main`, and start each one's dev server and signaling server inside one bounded background job with cleanup traps, as the ocean waves' checks did.

- [ ] **Step 2: First look.** Take stills at clear 12:00, 15:00, 17:30, 18:00, 18:30, 19:00 and 22:00, from the trailhead pad and from 18 m up with the sea in view, on the high tier, beside `main`'s at the same poses. Confirm no console error and each page on its tier's engine.

- [ ] **Step 3: Calibrate by eye.** Move `SKY_GAMMA` (dusk brightness), `NIGHT_YA_DAY` / `NIGHT_YA_NIGHT` (when the moonlight takes over), `DECK_TAU` (the deck's brightness), `MIST_HORIZON` and `SKY_IBL_SCALE` within the ranges the stills ask for, one at a time, re-taking the 18:00, 18:30 and 19:00 stills, the mist noon and the overcast 15:00. Each change updates its test literals and is committed as `fix: <what the change does to the look>`. Judge in particular, from the values the model gives at the starting constants:
  - the late sun: at `SKY_GAMMA` 0.5 the sun's intensity at 17:00 is about 5.7, 1.4× noon's, before the image exposure's own rise toward dusk;
  - the fill at 18:00, about 0.04 against today's 0.76, with the image-based light carrying the dusk's ambient;
  - when the night arrives: the night factor reaches 1 near −7° of sun;
  - the disc in mist, about 1.6 against a deck of about 0.8;
  - noon's shadows: the image-based light now carries the dome's linear radiance, where today's carried the sky to the power 2.2 on medium and high; lower `SKY_IBL_SCALE` only if noon's shadows read brighter than `main`'s.

- [ ] **Step 4: The corpus.** Record the dome's stages on every tier (`?wgsl=record`, the clear, mist and rain visits at noon and night, as the corpus's tooling expects), merge them with `tools/wgsl/merge-corpus.mjs`, retire the four `SkyMaterial` stages by path (never by emptying the corpus), update `corpusFiles.test.mjs`'s counts, build the client and run `node tools/wgsl/check-build.mjs`. Commit as `feat: record the sky dome's stages, retire the old sky's`.

- [ ] **Step 5: The checks.** Stills at every pose and hour of spec §10, each beside `main`'s and beside the reference photographs (clear sunset, civil twilight, the blue hour, an overcast dusk), assembled into one page for the verdict by eye.

- [ ] **Step 6: The cost.** Frame-time pairs against `main` at 4K on the quiet machine, at noon and at 18:00 on all three tiers, with a same-build noise pair; the worker's time at load in Chrome; the main thread's time for one change (blend and upload) during an escalation's chase start; the start-up tier check before and after.

- [ ] **Step 7: As built.** Append the design's closing section: what the build changed from the design, the cost table, and the checks' results. Commit as `docs: the scattering sky's checks and cost as built`.

- [ ] **Step 8: The whole suite and the scan.** Run the full client suite with `TEST_TIME_SCALE=2`, the tools suite, typecheck and lint, and the repository's pre-push scan over `origin/main..HEAD`.
