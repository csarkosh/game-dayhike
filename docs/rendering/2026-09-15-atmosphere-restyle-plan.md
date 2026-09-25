# Atmosphere Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Day Hike's identity layer (etched outline, cel band, ACES-plus-curves grade, single-colour fog) with height fog, an AgX grade pass, a film-treatment finish pass, dread channels and airborne motes, so the world reads photoreal, atmospheric and eerie.

**Architecture:** A globally registered PBR material plugin (`atmosphere.ts`) regex-replaces Babylon's fog line with height fog, a distance gradient and sun inscatter. Two custom post-processes bracket a slimmed `DefaultRenderingPipeline`: `grade` (before: AgX, white point, Purkinje, split-tone, lift, vignette, halation) and `finish` (after: peripheral overlap, luminance grain, dither). Every number is a uniform computed by pure `*Params.ts` modules from `(weather, hour, unsettle)` once per frame; nothing recompiles at runtime.

**Tech Stack:** TypeScript, Babylon.js 9.18 (`MaterialPluginBase`, `PostProcess`, `BlurPostProcess`, `ParticleSystem`, `RawTexture`), Vite `?raw` shader imports, Vitest under `NullEngine`.

**Spec:** `docs/rendering/2026-09-15-atmosphere-restyle-design.md` — read it first; this plan argues from it.

## Global Constraints

- Work in a fresh worktree branched from freshly fetched `origin/main` (`git worktree add -b worktree-atmosphere-restyle .claude/worktrees/atmosphere-restyle origin/main`). Never reuse a worktree. Run the suite with the main checkout's binaries: `/Users/csarko/Projects/game-dayhike/node_modules/.bin/vitest run --root client <path>`; typecheck and lint from the worktree root with `npm run typecheck` and `npm run lint` after `npm ci` there.
- Stage explicit paths. Never `git add -A` or `git add .`.
- Commit messages follow `.claude/skills/github-push/SKILL.md`: type-prefixed subject, `## What` paragraph, `## How` list led by file paths, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- GLSL comment rules (enforced by the hygiene test in Task 4): no `#`-prefixed preprocessor keyword spelled inside any comment, and no trailing `//` comment containing a `;` after code on a line. Write standalone comment lines above the code they describe.
- Plugin custom code is injected after include expansion and before `#ifdef` evaluation: gate runtime behaviour on float uniforms, never on injected defines. `vAlbedoColor` is the material constant, not the vertex colour.
- Every `.fx` numeric literal that mirrors a TS constant has a lockstep test; every Babylon-free module is listed in `client/test/architecture.test.ts`'s `BABYLON_FREE_FILES`.
- `WEATHER_PRESETS.clear` at any hour is the exact identity: every new modifier returns its base value there, asserted with `toBe`/`toEqual`, not `toBeCloseTo`.
- Nothing here touches `client/src/sim/`, the level id, or invite links.
- The one licensed piece of borrowed code is the AgX tone map from three.js (MIT). Keep the MIT notice line in `grade.fragment.fx`'s header exactly as Task 6 shows.

## Amendments made during execution

- Task 2/3's plateau tests use `{ ...WEATHER_PRESETS.eerie, dread: 0.36 }` and `{ ...WEATHER_PRESETS.eerie, dread: 0.42 }`, not a `mist`→`eerie` lerp at 0.4/0.45.
- Task 4's shader hygiene test applies the hashed-keyword check to the comment portion of every line, standalone or trailing, not only to lines that start with a comment.
- Task 4, 6, 7 and 8's commit subjects were shortened to stay under 72 characters.
- Task 6's AgX middle-grey test asserts `0.15 < out < 0.30` because `agx()` returns linear values, not display-referred ones.
- Task 7 builds no `DefaultRenderingPipeline`: `ChromaticAberrationPostProcess` and `FxaaPostProcess` are built directly, `finish` takes the half-float input, and on high a full-resolution `PassPostProcess("scene")` heads the chain because the scene renders into the first pass's input texture.
- The halation extract works on the exposed linear scene, with `HALATION_THRESHOLD = 1.0` and `HALATION_CAP = 4.0`.
- `post.test.ts` pins the pass order on high and medium.
- The vignette is `1 − smoothstep(0.55, 1.0, r) · clamp(weight · 0.22, 0, 0.8)` on the normalised corner radius.
- The split-tone is scaled by `SPLIT_TONE_DENSITY_SCALE = 0.35` and `SPLIT_TONE_SATURATION_SCALE = 0.5`.
- `HEIGHT_MIST_GAIN = 2`, `LEVEL_MIST_RISE = 8` and `LEVEL_DREAD_RISE = 6` after the browser gate (the plan text had 6, 25 and 20).
- Task 9's ω constants live in a Babylon-free `windField.ts`, not in `windPlugin.ts` itself.

## File structure

| Path | Responsibility |
| --- | --- |
| `client/src/game/weather.ts` (modify) | Adds `stepped()`, `dreadWorldUnder`, `dreadLensUnder`, `ambientCollapseUnder`; routes the world-side dread terms through `dreadWorld`. |
| `client/src/game/atmosphereParams.ts` (create, Babylon-free) | `AtmosphereRecord`, `atmosphereUnder`, `fogGradientUnder`, `heightFogAmount` (TS mirror of the GLSL), `sunWeightUnder`. |
| `client/src/game/shaders/atmosphereFog.fragment.fx` (create) | The fog function spliced into the PBR fragment. |
| `client/src/game/atmosphere.ts` (create) | The plugin, its global registration, the gradient `RawTexture`, `createAtmosphere(scene, viewDistance)`. |
| `client/src/game/gradeParams.ts` (create, Babylon-free) | `GradeRecord`, `gradeRecordUnder`, AgX constants and TS reference, `whitePointMatrix`, Purkinje constants, `splitToneUnder`. |
| `client/src/game/shaders/halationExtract.fragment.fx`, `grade.fragment.fx`, `finish.fragment.fx` (create) | The three post-process fragments. |
| `client/src/game/postParams.ts` (create, Babylon-free; replaces `stylizeParams.ts`) | `postFeaturesFor(tier, fxSupported)`, `FinishRecord`, `finishUnder`, `OVERLAP_*`, `GRAIN_*`, `DITHER_LSB`. |
| `client/src/game/post.ts` (create; replaces `stylize.ts`) | `createPost(scene, camera, tier)`: the halation passes, `grade`, the pipeline, `finish`; `update(weather, hour, unsettle)`. |
| `client/src/game/motesParams.ts` (create, Babylon-free) | `MotesRecord`, `motesUnder(weather, hour)`, `windAt(t)`, species constants. |
| `client/src/game/motes.ts` (create) | `createMotes(scene, tier)`: the particle system. |
| `client/src/game/lighting.ts` (modify) | `colourPath` option; Neutral + dithering on the material path; `applyByPostProcess` on the post path; ambient collapse. |
| `client/src/game/commands.ts`, `client/src/game/script.ts`, `client/src/app.ts` (modify) | `/unsettle`; `/style` retired and dropped silently from old URLs. |
| `client/src/game/renderer.ts`, `mistMeshes.ts`, `windPlugin.ts`, `sky.ts`, `quality.ts` (modify) | Wiring; mist colour from the gradient; exported ω constants; exported `twilightT`; `ssao` removed. |
| Deleted | `stylize.ts`, `stylizeParams.ts`, `cel.ts`, `shaders/celBand.fragment.fx`, `shaders/etchedOutline.fragment.fx` and their five tests. |

---

### Task 1: Retire the outline, the cel band and `/style`

**Files:**
- Delete: `client/src/game/stylize.ts`, `client/src/game/stylizeParams.ts`, `client/src/game/cel.ts`, `client/src/game/shaders/celBand.fragment.fx`, `client/src/game/shaders/etchedOutline.fragment.fx`, `client/test/game/stylize.test.ts`, `client/test/game/stylizeParams.test.ts`, `client/test/game/cel.test.ts`, `client/test/game/celBandShader.test.ts`, `client/test/game/etchedOutlineShader.test.ts`
- Modify: `client/src/game/commands.ts` (the `style` spec, lines 92–105), `client/src/game/script.ts:12-25`, `client/src/app.ts` (lines 32, 124, 229–235, 317–319), `client/src/game/renderer.ts` (lines 31–35, 616–620, 654–657, 853–855, 950–954, 971–973, the `setStyle` member at 588), `client/src/game/quality.ts` (the `ssao` field), `client/test/architecture.test.ts:117`
- Test: `client/test/game/script.test.ts` (create if absent), `client/test/game/commands.test.ts`

**Interfaces:**
- Produces: `RETIRED_COMMANDS: readonly string[]` exported from `commands.ts`; `parseScript` drops retired entries silently. `renderer.ts` temporarily has no post chain and no `setStyle`; Task 8 wires `createPost` and Task 9 adds `setUnsettle`.

- [ ] **Step 1: Write the failing test for the silent drop**

Add to `client/test/game/commands.test.ts`:

```ts
import { RETIRED_COMMANDS } from "../../src/game/commands.js";
import { parseScript } from "../../src/game/script.js";

describe("retired commands", () => {
  it("style is retired and an old URL carrying it parses without an error", () => {
    expect(RETIRED_COMMANDS).toContain("style");
    expect(findCommand("style")).toBeUndefined();
    const { entries, errors } = parseScript("time 17;style cel;weather mist");
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(["time", "weather"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node_modules/.bin/vitest run --root client test/game/commands.test.ts`
Expected: FAIL — `RETIRED_COMMANDS` is not exported, and `parseScript` reports `unknown command "style"`.

- [ ] **Step 3: Retire the command**

In `client/src/game/commands.ts` delete the `style` entry from `SPECS` and the `DEFAULT_STYLE, STYLE_NAMES` import; add after `SEED_TOKEN_MAX`:

```ts
/**
 * Commands that once existed and may still sit in a shared `?cmd=` link.
 * `parseScript` drops them without an error: a stale entry is not a mistake
 * the person opening the link can do anything about.
 */
export const RETIRED_COMMANDS: readonly string[] = ["style"];
```

In `client/src/game/script.ts`, inside `parseScript`'s loop, before `validateCommand`:

```ts
    if (RETIRED_COMMANDS.includes(parsed.name)) continue;
```

and add `RETIRED_COMMANDS` to the import from `./commands.js`.

- [ ] **Step 4: Remove the style plumbing from app.ts and renderer.ts**

`client/src/app.ts`: delete the import on line 32, the `styleName` declaration (line 124), the `else if (name === "style")` branch (229–235) and the bare-`/style` report (317–319).

`client/src/game/renderer.ts`: delete the `createStylize`, `createCelShading` and `StyleName` imports (31–35), the `createCelShading` call and its comment (616–619), the `createStylize` block (654–657), `stylize.update(weather)` (855), `stylize.dispose()` and `cel.dispose()` (952, 954), the `setStyle` implementation (971–973) and the `setStyle(name: StyleName): void;` member (588). Leave `skinShading` and `budgetLights` alone.

`client/src/game/quality.ts`: delete the `ssao` field from `QualitySettings` and the three tier objects, and the `ssao` clause in the doc comment.

`client/test/architecture.test.ts`: delete the `stylizeParams.ts` line (117).

- [ ] **Step 5: Delete the files**

```bash
git rm client/src/game/stylize.ts client/src/game/stylizeParams.ts client/src/game/cel.ts \
  client/src/game/shaders/celBand.fragment.fx client/src/game/shaders/etchedOutline.fragment.fx \
  client/test/game/stylize.test.ts client/test/game/stylizeParams.test.ts client/test/game/cel.test.ts \
  client/test/game/celBandShader.test.ts client/test/game/etchedOutlineShader.test.ts
```

- [ ] **Step 6: Run the gates**

Run: `npm run typecheck && npm run lint && node_modules/.bin/vitest run --root client`
Expected: all green. Any remaining reference to `stylize`, `StyleName`, `celEnabled` or `ssao` is a typecheck failure to fix in this task; `grep -rn "stylize\|StyleName\|ssao" client/src` must print nothing.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/commands.ts client/src/game/script.ts client/src/app.ts client/src/game/renderer.ts client/src/game/quality.ts client/test/architecture.test.ts client/test/game/commands.test.ts
git commit
```

Subject: `refactor: retire the etched outline, the cel band and /style`.

---

### Task 2: Stepped dread in `weather.ts`

**Files:**
- Modify: `client/src/game/weather.ts` (after `DREAD_AIR`, line 130; `fogColourUnder` line 259; `exposureUnder` line 270; `mistOpacityUnder` line 292)
- Test: `client/test/game/weather.test.ts`

**Interfaces:**
- Produces: `DREAD_PLATEAUS = 4`, `DREAD_STEP_EDGE = 0.06`, `stepped(d: number): number`, `dreadWorldUnder(w: WeatherParams): number`, `dreadLensUnder(w: WeatherParams): number`, `AMBIENT_COLLAPSE = 0.45`, `ambientCollapseUnder(w: WeatherParams): number` (a multiplier in (0, 1]). `fogColourUnder`, `exposureUnder` and `mistOpacityUnder` read `dreadWorldUnder`; `vignetteWeightUnder` and `grainIntensityUnder` read `dreadLensUnder`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/weather.test.ts` (extend the import from `../../src/game/weather.js` with `stepped, dreadWorldUnder, dreadLensUnder, ambientCollapseUnder, AMBIENT_COLLAPSE, DREAD_PLATEAUS, DREAD_STEP_EDGE`):

```ts
describe("stepped dread — the world moves in plateaus, the lens moves continuously", () => {
  it("is exact at 0 and 1 and monotonic between", () => {
    expect(stepped(0)).toBe(0);
    expect(stepped(1)).toBe(1);
    let last = 0;
    for (let d = 0; d <= 1; d += 0.001) {
      const s = stepped(d);
      expect(s).toBeGreaterThanOrEqual(last - 1e-12);
      last = s;
    }
  });

  it("sits on a plateau away from the edges", () => {
    const step = 1 / (DREAD_PLATEAUS - 1);
    for (let i = 0; i < DREAD_PLATEAUS; i++) {
      const centre = i * step;
      const probe = Math.min(1, Math.max(0, centre + (i === DREAD_PLATEAUS - 1 ? -0.5 : 0.5) * (step - 2 * DREAD_STEP_EDGE)));
      expect(stepped(probe)).toBeCloseTo(centre, 10);
    }
  });

  it("clear is the identity for every derived value", () => {
    expect(dreadWorldUnder(WEATHER_PRESETS.clear)).toBe(0);
    expect(dreadLensUnder(WEATHER_PRESETS.clear)).toBe(0);
    expect(ambientCollapseUnder(WEATHER_PRESETS.clear)).toBe(1);
  });

  it("eerie reaches the top plateau and the full collapse", () => {
    expect(dreadWorldUnder(WEATHER_PRESETS.eerie)).toBe(1);
    expect(dreadLensUnder(WEATHER_PRESETS.eerie)).toBe(1);
    expect(ambientCollapseUnder(WEATHER_PRESETS.eerie)).toBeCloseTo(1 - AMBIENT_COLLAPSE, 10);
  });

  it("a mid-fade dread holds the world on a plateau while the lens keeps moving", () => {
    const a = lerpWeather(WEATHER_PRESETS.mist, WEATHER_PRESETS.eerie, 0.4);
    const b = lerpWeather(WEATHER_PRESETS.mist, WEATHER_PRESETS.eerie, 0.45);
    expect(dreadWorldUnder(a)).toBe(dreadWorldUnder(b));
    expect(dreadLensUnder(b)).toBeGreaterThan(dreadLensUnder(a));
    expect(fogColourUnder(a, 17)).toEqual(fogColourUnder(b, 17));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/weather.test.ts`
Expected: FAIL — `stepped` is not exported.

- [ ] **Step 3: Implement**

Add to `client/src/game/weather.ts` after the `DREAD_AIR` constant:

```ts
// ---- Stepped dread. Browser-tunable; `clear` identity is not. ----

/** Number of plateaus the WORLD-side dread terms move through: 0, 1/3, 2/3, 1. */
export const DREAD_PLATEAUS = 4;
/** Half-width, in dread units, of the soft edge on each plateau. */
export const DREAD_STEP_EDGE = 0.06;
/** Fraction of the fill and probe ambient lost on the top plateau. */
export const AMBIENT_COLLAPSE = 0.45;

function smoothstep01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * Quantises a dread level to DREAD_PLATEAUS plateaus with a smoothstep edge
 * of half-width DREAD_STEP_EDGE centred on each boundary. Exact at 0 and 1,
 * monotonic, so the world changes DREAD_PLATEAUS − 1 times as dread rises
 * rather than sliding.
 */
export function stepped(d: number): number {
  const x = clamp01(d);
  const step = 1 / (DREAD_PLATEAUS - 1);
  let out = 0;
  for (let i = 1; i < DREAD_PLATEAUS; i++) {
    const edge = i * step - step / 2;
    out += step * smoothstep01((x - edge + DREAD_STEP_EDGE) / (2 * DREAD_STEP_EDGE));
  }
  return x === 0 ? 0 : x === 1 ? 1 : out;
}

/** The plateau'd dread the world-side terms read: fog, exposure, mist, ambient, motes. */
export function dreadWorldUnder(w: WeatherParams): number {
  return stepped(w.dread);
}

/** The continuous dread the lens-side terms read: grain, aberration, vignette, halation, overlap. */
export function dreadLensUnder(w: WeatherParams): number {
  return clamp01(w.dread);
}

/** Multiplier on the fill light and the probe's contribution: 1 at clear, 1 − AMBIENT_COLLAPSE on the top plateau. */
export function ambientCollapseUnder(w: WeatherParams): number {
  const d = dreadWorldUnder(w);
  return d === 0 ? 1 : 1 - AMBIENT_COLLAPSE * d;
}
```

Then in `fogColourUnder` replace `const d = clamp01(w.dread);` with `const d = dreadWorldUnder(w);`; in `exposureUnder` replace `clamp01(w.dread)` with `dreadWorldUnder(w)`; in `mistOpacityUnder` replace `clamp01(w.dread)` with `dreadWorldUnder(w)`; in `vignetteWeightUnder` and `grainIntensityUnder` replace `clamp01(w.dread)` with `dreadLensUnder(w)`. Leave `saturationUnder` and `moodUnder` as they are (lens-side colour; `moodUnder` gates the grade and must stay continuous so a fade does not snap the grade).

- [ ] **Step 4: Run the weather tests**

Run: `node_modules/.bin/vitest run --root client test/game/weather.test.ts test/game/lighting.test.ts`
Expected: PASS, including the untouched clear-identity sweep. If the plateau test is off by the edge width, check the `edge` formula: boundary `i` sits at `i·step − step/2`.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/weather.ts client/test/game/weather.test.ts
git commit
```

Subject: `feat: step the world-side dread terms through four plateaus`.

---

### Task 3: `atmosphereParams.ts` — the pure fog model

**Files:**
- Create: `client/src/game/atmosphereParams.ts`
- Modify: `client/src/game/sky.ts:70` (export `twilightT`), `client/test/architecture.test.ts` (add `atmosphereParams.ts` to `BABYLON_FREE_FILES`)
- Test: `client/test/game/atmosphereParams.test.ts`

**Interfaces:**
- Produces:

```ts
export type AtmosphereRecord = {
  baseDensity: number;       // Babylon EXP2 density, unchanged from fogDensityUnder
  heightDensity: number;     // Quílez `a`
  heightFalloff: number;     // Quílez `b`, per metre
  referenceLevel: number;    // world y the height fog is densest at
  gradientScale: number;     // 1 / viewDistance
  sunDir: { x: number; y: number; z: number };  // toward the sun, unit
  sunColour: Rgb;
  sunWeight: number;         // 0..1
  sunPower: number;          // exponent on dot(rd, sunDir)
};
export const GRADIENT_STEPS = 256;
export function fogGradientUnder(w: WeatherParams, hour: number): Rgb[];         // GRADIENT_STEPS entries, near → far, linear
export function atmosphereUnder(w: WeatherParams, hour: number, viewDistance: number): AtmosphereRecord;
export function heightFogAmount(camY: number, rdY: number, t: number, a: number, b: number, level: number): number; // TS mirror of the GLSL
export function sunWeightUnder(w: WeatherParams, altitude: number): number;
```

- [ ] **Step 1: Export `twilightT` from sky.ts**

Change `function twilightT(altitude: number): number {` to `export function twilightT(altitude: number): number {`.

- [ ] **Step 2: Write the failing tests**

Create `client/test/game/atmosphereParams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  atmosphereUnder, fogGradientUnder, heightFogAmount, sunWeightUnder,
  GRADIENT_STEPS, HEIGHT_DENSITY_BASE, HEIGHT_MIST_GAIN, LEVEL_MIST_RISE, LEVEL_DREAD_RISE, SUN_POWER,
} from "../../src/game/atmosphereParams.js";
import { WEATHER_PRESETS, fogColourUnder, fogDensityUnder, lerpWeather } from "../../src/game/weather.js";
import { skyColourAt, sunColourAt, sunPositionAt } from "../../src/game/sky.js";

const CLEAR = WEATHER_PRESETS.clear;

describe("the fog gradient", () => {
  it("has GRADIENT_STEPS entries whose far end is the air colour and whose near end is dimmer", () => {
    const g = fogGradientUnder(CLEAR, 12);
    expect(g.length).toBe(GRADIENT_STEPS);
    expect(g[GRADIENT_STEPS - 1]).toEqual(fogColourUnder(CLEAR, 12));
    const near = g[0]!;
    const far = g[GRADIENT_STEPS - 1]!;
    expect(near.r + near.g + near.b).toBeLessThan(far.r + far.g + far.b);
  });

  it("at clear the far end is exactly the sky colour at every hour", () => {
    for (let hour = 0; hour < 24; hour += 0.5) {
      expect(fogGradientUnder(CLEAR, hour)[GRADIENT_STEPS - 1]).toEqual(skyColourAt(hour));
    }
  });
});

describe("atmosphereUnder", () => {
  it("at clear keeps the base density and the lowest height fog", () => {
    const a = atmosphereUnder(CLEAR, 12, 4000);
    expect(a.baseDensity).toBe(fogDensityUnder(CLEAR, 4000));
    expect(a.heightDensity).toBe(HEIGHT_DENSITY_BASE);
    expect(a.gradientScale).toBe(1 / 4000);
    expect(a.sunPower).toBe(SUN_POWER);
    expect(a.sunColour).toEqual(sunColourAt(12));
    expect(a.sunDir).toEqual(sunPositionAt(12));
  });

  it("mist raises the height density and the reference level; dread raises the level further", () => {
    const mist = atmosphereUnder(WEATHER_PRESETS.mist, 12, 4000);
    const eerie = atmosphereUnder(WEATHER_PRESETS.eerie, 12, 4000);
    const clear = atmosphereUnder(CLEAR, 12, 4000);
    expect(mist.heightDensity).toBeCloseTo(HEIGHT_DENSITY_BASE * (1 + HEIGHT_MIST_GAIN), 10);
    expect(mist.referenceLevel).toBeCloseTo(clear.referenceLevel + LEVEL_MIST_RISE, 10);
    expect(eerie.referenceLevel).toBeCloseTo(clear.referenceLevel + LEVEL_MIST_RISE + LEVEL_DREAD_RISE, 10);
  });

  it("the reference level holds still across a plateau of the dread fade", () => {
    const a = lerpWeather(WEATHER_PRESETS.mist, WEATHER_PRESETS.eerie, 0.4);
    const b = lerpWeather(WEATHER_PRESETS.mist, WEATHER_PRESETS.eerie, 0.45);
    expect(atmosphereUnder(a, 17, 4000).referenceLevel).toBe(atmosphereUnder(b, 17, 4000).referenceLevel);
  });
});

describe("sun weight", () => {
  it("is 1 with the sun up under clear, fades with cloud, and is 0 below the horizon", () => {
    expect(sunWeightUnder(CLEAR, 0.5)).toBe(1);
    expect(sunWeightUnder(WEATHER_PRESETS.rain, 0.5)).toBeLessThan(0.15);
    expect(sunWeightUnder(CLEAR, -0.3)).toBe(0);
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

- [ ] **Step 3: Run them to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/atmosphereParams.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `client/src/game/atmosphereParams.ts`:

```ts
import { clamp01, mixRgb, type Rgb } from "./colour.js";
import { skyColourAt, sunColourAt, sunPositionAt, type Vec3 } from "./sky.js";
import { dreadWorldUnder, fogColourUnder, fogDensityUnder, type WeatherParams } from "./weather.js";

/**
 * The pure arithmetic of the atmosphere plugin: height fog, the distance
 * gradient and the sun-direction inscatter. Babylon-free and on the
 * architecture test's BABYLON_FREE_FILES list; `atmosphere.ts` is the shell
 * that binds it. Every function is exact at `clear`.
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

// ---- Browser-tunable magnitudes. `clear` identity is not. ----

/** Quílez `a` at clear: a faint valley haze even on a sunny day. */
export const HEIGHT_DENSITY_BASE = 0.004;
/** Height-density gain at full mist: density × (1 + gain·mist). */
export const HEIGHT_MIST_GAIN = 6;
/** Quílez `b`, per metre: the fog halves every ~14 m of height. */
export const HEIGHT_FALLOFF = 0.05;
/** World y the height fog is densest at, at clear. Below the trailhead pad. */
export const REFERENCE_LEVEL_BASE = -20;
/** Metres the reference level rises at full mist. */
export const LEVEL_MIST_RISE = 25;
/** Additional rise on the top dread plateau. */
export const LEVEL_DREAD_RISE = 20;
/** Exponent on dot(rd, sunDir): 8 is a broad warm glow, 64 a tight disc. */
export const SUN_POWER = 8;
/** How much of the sun glow survives full cloud cover. */
export const SUN_CLOUD_SURVIVAL = 0.1;
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

/** 1 with the sun up under clear; scaled by cloud; 0 once the sun is below the horizon. */
export function sunWeightUnder(w: WeatherParams, altitude: number): number {
  if (altitude <= 0) return 0;
  const c = clamp01(w.cloudCover);
  const up = clamp01(altitude / 0.1);
  return up * (1 - (1 - SUN_CLOUD_SURVIVAL) * c);
}

/** Near → far, GRADIENT_STEPS entries, linear. Far end is exactly `fogColourUnder`. */
export function fogGradientUnder(w: WeatherParams, hour: number): Rgb[] {
  const far = fogColourUnder(w, hour);
  const near = { r: far.r * GRADIENT_NEAR_DIM, g: far.g * GRADIENT_NEAR_DIM, b: far.b * GRADIENT_NEAR_DIM };
  const out: Rgb[] = [];
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    const t = i / (GRADIENT_STEPS - 1);
    out.push(i === GRADIENT_STEPS - 1 ? far : mixRgb(near, far, Math.pow(t, 1 / GRADIENT_BIAS)));
  }
  return out;
}

export function atmosphereUnder(w: WeatherParams, hour: number, viewDistance: number): AtmosphereRecord {
  const m = clamp01(w.mist);
  const d = dreadWorldUnder(w);
  const toSun = sunPositionAt(hour);
  return {
    baseDensity: fogDensityUnder(w, viewDistance),
    heightDensity: HEIGHT_DENSITY_BASE * (1 + HEIGHT_MIST_GAIN * m),
    heightFalloff: HEIGHT_FALLOFF,
    referenceLevel: REFERENCE_LEVEL_BASE + LEVEL_MIST_RISE * m + LEVEL_DREAD_RISE * d,
    gradientScale: 1 / viewDistance,
    sunDir: toSun,
    sunColour: sunColourAt(hour),
    sunWeight: sunWeightUnder(w, toSun.y),
    sunPower: SUN_POWER,
  };
}

export { skyColourAt };
```

Remove the trailing `export { skyColourAt };` line if lint flags it as unused re-export; it is not needed. Add `join(SRC, "game", "atmosphereParams.ts"),` to `BABYLON_FREE_FILES`.

- [ ] **Step 5: Run the tests**

Run: `node_modules/.bin/vitest run --root client test/game/atmosphereParams.test.ts test/architecture.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/atmosphereParams.ts client/src/game/sky.ts client/test/game/atmosphereParams.test.ts client/test/architecture.test.ts
git commit
```

Subject: `feat: pure height-fog, gradient and sun-inscatter model`.

---

### Task 4: The atmosphere plugin and the shader hygiene test

**Files:**
- Create: `client/src/game/shaders/atmosphereFog.fragment.fx`, `client/src/game/atmosphere.ts`
- Test: `client/test/game/shaderHygiene.test.ts` (create), `client/test/game/atmosphere.test.ts` (create)

**Interfaces:**
- Consumes: `AtmosphereRecord`, `atmosphereUnder`, `fogGradientUnder`, `GRADIENT_STEPS` from Task 3.
- Produces:

```ts
export const ATMOSPHERE_FOG_ANCHOR = "!finalColor\\.rgb=mix\\(vFogColor,finalColor\\.rgb,fog\\);";
export type Atmosphere = {
  /** Recomputes the record and, if hour or weather changed, the gradient texture. */
  update(weather: WeatherParams, hour: number): void;
  readonly record: AtmosphereRecord;
  /** The gradient's middle colour, for mist banks. */
  midColour(): Rgb;
  dispose(): void;
};
export function createAtmosphere(scene: Scene, viewDistance: number): Atmosphere; // registers the plugin; call BEFORE any material exists
```

- [ ] **Step 1: Write the hygiene test that globs every shader**

Create `client/test/game/shaderHygiene.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";

const SHADERS = join(dirname(fileURLToPath(import.meta.url)), "../../src/game/shaders");
const files = readdirSync(SHADERS).filter((f) => f.endsWith(".fx"));

/**
 * Two comment defects broke shaders twice in this repo, and NullEngine never
 * compiles GLSL so it cannot see either: a trailing `// comment` holding a
 * semicolon is split by Babylon's ShaderCodeCursor into bare code, and a
 * hashed preprocessor keyword merely SPELLED in a comment is parsed as a
 * real directive by MoveCursorRegex. Every .fx file is linted here, and run
 * through the REAL preprocessor to prove main() survives.
 */
function processShader(source: string): Promise<string> {
  const options: _IProcessingOptions = {
    defines: [],
    indexParameters: {},
    isFragment: true,
    shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: false,
    shadersRepository: "",
    includesShadersStore: {},
    processor: { shaderLanguage: ShaderLanguage.GLSL },
    version: "",
    platformName: "WEBGL2",
    processingContext: null,
    isNDCHalfZRange: false,
    useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => Process(source, options, (code) => resolve(code)));
}

describe("every shader under src/game/shaders", () => {
  it("exists to be linted", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(join(SHADERS, file), "utf8");

    it(`${file}: no hashed keyword in a comment, no semicolon in a trailing comment`, () => {
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        const commentAt = line.indexOf("//");
        if (trimmed.startsWith("//")) {
          expect(/#(ifdef|ifndef|if|else|elif|endif|define|undef|include)\b/.test(trimmed), `${file}: ${line}`).toBe(false);
          continue;
        }
        if (commentAt >= 0) expect(line.slice(commentAt).includes(";"), `${file}: ${line}`).toBe(false);
      }
    });

    it(`${file}: survives Babylon's real preprocessor with every function intact`, async () => {
      const declared = [...source.matchAll(/^(?:vec[234]|float|mat[34]|void)\s+(\w+)\s*\(/gm)].map((m) => m[1]);
      expect(declared.length).toBeGreaterThan(0);
      const processed = await processShader(source);
      for (const name of declared) expect(processed, `${file} lost ${name}`).toContain(`${name}(`);
    });
  }
});
```

- [ ] **Step 2: Write the failing plugin tests**

Create `client/test/game/atmosphere.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/ShadersInclude/fogFragment.js";
import atmosphereFragment from "../../src/game/shaders/atmosphereFog.fragment.fx?raw";
import { ATMOSPHERE_FOG_ANCHOR, createAtmosphere, type Atmosphere } from "../../src/game/atmosphere.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { fogGradientUnder, GRADIENT_STEPS } from "../../src/game/atmosphereParams.js";

let engine: NullEngine;
let scene: Scene;
let atmosphere: Atmosphere;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  atmosphere = createAtmosphere(scene, 4000);
});

afterEach(() => {
  atmosphere.dispose();
  scene.dispose();
  engine.dispose();
});

describe("the fog anchor", () => {
  it("matches the installed fogFragment include once `color` is renamed to `finalColor`", () => {
    const include = ShaderStore.IncludesShadersStore["fogFragment"] as string;
    const expanded = include.replace(/\bcolor\b/g, "finalColor");
    const re = new RegExp(ATMOSPHERE_FOG_ANCHOR.slice(1));
    expect(re.test(expanded)).toBe(true);
  });

  it("the GLSL declares the function the replacement calls", () => {
    expect(atmosphereFragment).toContain("vec3 atmosphereFog(vec3 lit, float fog)");
    expect(atmosphereFragment).toContain("float atmHeightFog(");
  });
});

describe("createAtmosphere", () => {
  it("attaches to PBR materials created afterwards and declines everything else", () => {
    const pbr = new PBRMaterial("pbr", scene);
    const std = new StandardMaterial("std", scene);
    expect(pbr.pluginManager?.getPlugin("Atmosphere")).toBeTruthy();
    expect(std.pluginManager?.getPlugin("Atmosphere") ?? null).toBeNull();
  });

  it("update writes the record, keeps scene.fogColor on the gradient's far end, and rebuilds the gradient only on change", () => {
    atmosphere.update(WEATHER_PRESETS.clear, 12);
    const far = fogGradientUnder(WEATHER_PRESETS.clear, 12)[GRADIENT_STEPS - 1]!;
    expect(scene.fogColor.r).toBeCloseTo(far.r, 6);
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
});
```

(`gradientBuilds` is a test-facing counter on the `Atmosphere` type: `readonly gradientBuilds: number;` — add it to the interface above.)

- [ ] **Step 3: Run both to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/shaderHygiene.test.ts test/game/atmosphere.test.ts`
Expected: hygiene FAILS on "exists to be linted" (the folder is empty after Task 1); atmosphere FAILS on module not found.

- [ ] **Step 4: Write the GLSL**

Create `client/src/game/shaders/atmosphereFog.fragment.fx`:

```glsl
// Atmosphere fog, spliced into the PBR fragment by AtmospherePlugin in
// atmosphere.ts at CUSTOM_FRAGMENT_DEFINITIONS and called from the regex
// replacement of Babylon's fog mix line. Plugin custom code is applied after
// include expansion and before conditional evaluation, so nothing here may
// rely on material conditionals: the gate is the atmOn uniform.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals below mirror atmosphereParams.ts and a lockstep test asserts
// they agree. Tune them there and here together.

// Slope below which a ray counts as level, to keep the closed form finite.
const float ATM_LEVEL_SLOPE = 1.0e-3;

// Quilez closed-form height fog: density a*exp(-b*y) integrated along a ray
// of length t from height y0 with vertical slope rdY. Mirrors heightFogAmount
// in atmosphereParams.ts exactly.
float atmHeightFog(float y0, float rdY, float t, float a, float b) {
  float slope = abs(rdY) < ATM_LEVEL_SLOPE ? (rdY < 0.0 ? -ATM_LEVEL_SLOPE : ATM_LEVEL_SLOPE) : rdY;
  return (a / b) * exp(-y0 * b) * (1.0 - exp(-t * slope * b)) / slope;
}

// lit is the lit surface colour, fog is Babylon's linearised EXP2 factor
// (1 = clear, 0 = fully fogged). Returns the fogged colour. atmOn below 0.5
// reproduces Babylon's own mix so an unbound record is harmless.
vec3 atmosphereFog(vec3 lit, float fog) {
  if (atmOn < 0.5) {
    return mix(vFogColor, lit, fog);
  }
  vec3 toFrag = vPositionW - vEyePosition.xyz;
  float d = length(toFrag);
  vec3 rd = toFrag / max(d, 1.0e-4);
  float y0 = vEyePosition.y - atmReferenceLevel;
  float height = atmHeightFog(y0, rd.y, d, atmHeightDensity, atmHeightFalloff);
  float transmit = fog * exp(-max(height, 0.0));
  vec3 gradient = texture2D(atmGradient, vec2(clamp(d * atmGradientScale, 0.0, 1.0), 0.5)).rgb;
  float glow = pow(max(dot(rd, atmSunDir), 0.0), atmSunPower) * atmSunWeight;
  vec3 air = mix(gradient, atmSunColour, glow);
  return mix(air, lit, clamp(transmit, 0.0, 1.0));
}
```

- [ ] **Step 5: Write the plugin**

Create `client/src/game/atmosphere.ts`:

```ts
import type { Scene } from "@babylonjs/core/scene.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Nullable } from "@babylonjs/core/types.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
// Non-`.pure` import, load-bearing exactly as lighting.ts documents: the
// wrapper registers the plugin-manager machinery this module depends on.
import {
  RegisterMaterialPlugin,
  UnregisterMaterialPlugin,
} from "@babylonjs/core/Materials/materialPluginManager.js";
import atmosphereFragment from "./shaders/atmosphereFog.fragment.fx?raw";
import type { Rgb } from "./colour.js";
import type { WeatherParams } from "./weather.js";
import {
  atmosphereUnder, fogGradientUnder, GRADIENT_STEPS, type AtmosphereRecord,
} from "./atmosphereParams.js";

/**
 * The regex key that replaces Babylon's fog line. `fogFragment` reads
 * `color.rgb=mix(vFogColor,color.rgb,fog);` and pbr.fragment includes it as
 * `#include<fogFragment>(color,finalColor)`, so the expanded text names
 * `finalColor`. atmosphere.test.ts pins this against the installed include.
 */
export const ATMOSPHERE_FOG_ANCHOR = "!finalColor\\.rgb=mix\\(vFogColor,finalColor\\.rgb,fog\\);";
const ATMOSPHERE_FOG_CODE = "finalColor.rgb=atmosphereFog(finalColor.rgb,fog);";

/** Module-level so every material's plugin instance reads one truth, the cel.ts precedent. */
let current: AtmosphereRecord | null = null;
let gradientTexture: RawTexture | null = null;

class AtmospherePlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priority 200, no defines, enabled immediately: the uniform decides.
    super(material, "Atmosphere", 200, undefined, true, true);
  }

  override getClassName(): string {
    return "AtmospherePlugin";
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("atmGradient");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        { name: "atmOn", size: 1, type: "float" },
        { name: "atmHeightDensity", size: 1, type: "float" },
        { name: "atmHeightFalloff", size: 1, type: "float" },
        { name: "atmReferenceLevel", size: 1, type: "float" },
        { name: "atmGradientScale", size: 1, type: "float" },
        { name: "atmSunPower", size: 1, type: "float" },
        { name: "atmSunWeight", size: 1, type: "float" },
        { name: "atmSunDir", size: 3, type: "vec3" },
        { name: "atmSunColour", size: 3, type: "vec3" },
      ],
      fragment: [
        "uniform float atmOn;",
        "uniform float atmHeightDensity;",
        "uniform float atmHeightFalloff;",
        "uniform float atmReferenceLevel;",
        "uniform float atmGradientScale;",
        "uniform float atmSunPower;",
        "uniform float atmSunWeight;",
        "uniform vec3 atmSunDir;",
        "uniform vec3 atmSunColour;",
        "uniform sampler2D atmGradient;",
      ].join("\n"),
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const r = current;
    if (r === null || gradientTexture === null) {
      uniformBuffer.updateFloat("atmOn", 0);
      return;
    }
    uniformBuffer.updateFloat("atmOn", 1);
    uniformBuffer.updateFloat("atmHeightDensity", r.heightDensity);
    uniformBuffer.updateFloat("atmHeightFalloff", r.heightFalloff);
    uniformBuffer.updateFloat("atmReferenceLevel", r.referenceLevel);
    uniformBuffer.updateFloat("atmGradientScale", r.gradientScale);
    uniformBuffer.updateFloat("atmSunPower", r.sunPower);
    uniformBuffer.updateFloat("atmSunWeight", r.sunWeight);
    uniformBuffer.updateFloat3("atmSunDir", r.sunDir.x, r.sunDir.y, r.sunDir.z);
    uniformBuffer.updateFloat3("atmSunColour", r.sunColour.r, r.sunColour.g, r.sunColour.b);
    uniformBuffer.setTexture("atmGradient", gradientTexture);
  }

  override getCustomCode(shaderType: string): Nullable<{ [pointName: string]: string }> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: atmosphereFragment,
      [ATMOSPHERE_FOG_ANCHOR]: ATMOSPHERE_FOG_CODE,
    };
  }
}

export type Atmosphere = {
  update(weather: WeatherParams, hour: number): void;
  readonly record: AtmosphereRecord;
  readonly gradientBuilds: number;
  midColour(): Rgb;
  dispose(): void;
};

function gradientTexels(gradient: Rgb[]): Uint8Array {
  const data = new Uint8Array(GRADIENT_STEPS * 4);
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    const c = gradient[i] as Rgb;
    data[i * 4] = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

/**
 * Registers the plugin factory. MUST run before any PBR material exists —
 * RegisterMaterialPlugin only reaches materials created afterwards. The
 * factory declines non-PBR materials (sky, mist, particles) by returning null.
 *
 * The gradient is a 256x1 RGBA8 strip in LINEAR space (the grade pass
 * tone-maps after it); the finish pass's dither hides its 8-bit steps.
 */
export function createAtmosphere(scene: Scene, viewDistance: number): Atmosphere {
  RegisterMaterialPlugin("Atmosphere", (material) =>
    material instanceof PBRMaterial ? new AtmospherePlugin(material) : null,
  );
  let record = atmosphereUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }, 12, viewDistance);
  let gradient: Rgb[] = [];
  let lastKey = "";
  let builds = 0;
  const tex = RawTexture.CreateRGBATexture(
    gradientTexels(fogGradientUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }, 12)),
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
    update(weather, hour) {
      record = atmosphereUnder(weather, hour, viewDistance);
      current = record;
      // The five weather axes and the hour are the whole input to the
      // gradient; a fade rebuilds every tick (256 texels, trivial), a still
      // frame never does.
      const key = `${hour}|${weather.cloudCover}|${weather.mist}|${weather.rain}|${weather.wetness}|${weather.dread}`;
      if (key !== lastKey) {
        gradient = fogGradientUnder(weather, hour);
        tex.update(gradientTexels(gradient));
        const far = gradient[GRADIENT_STEPS - 1] as Rgb;
        // Non-PBR materials (mist, rain) still read Babylon's fog colour.
        scene.fogColor = new Color3(far.r, far.g, far.b);
        scene.fogDensity = record.baseDensity;
        lastKey = key;
        builds += 1;
      }
    },
    midColour() {
      return gradient[GRADIENT_STEPS >> 1] ?? { r: 0, g: 0, b: 0 };
    },
    dispose() {
      UnregisterMaterialPlugin("Atmosphere");
      current = null;
      gradientTexture = null;
      tex.dispose();
    },
  };
}
```

- [ ] **Step 6: Add the lockstep test and run everything**

Append to `client/test/game/atmosphere.test.ts`:

```ts
describe("GLSL literals stay in lockstep with atmosphereParams.ts", () => {
  it("carries the level-slope clamp the TS mirror uses", () => {
    expect(atmosphereFragment).toContain("const float ATM_LEVEL_SLOPE = 1.0e-3;");
  });
});
```

Run: `node_modules/.bin/vitest run --root client test/game/shaderHygiene.test.ts test/game/atmosphere.test.ts test/game/renderer.test.ts`
Expected: PASS. If `uniformBuffer.setTexture` is flagged by typecheck, the method exists on `UniformBuffer` in 9.18 (`setTexture(name: string, texture: Nullable<ThinTexture>)`); check the import of `RawTexture` satisfies it.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/atmosphere.ts client/src/game/shaders/atmosphereFog.fragment.fx client/test/game/atmosphere.test.ts client/test/game/shaderHygiene.test.ts
git commit
```

Subject: `feat: atmosphere plugin replaces Babylon's fog with height fog and a gradient`.

---

### Task 5: `lighting.ts` — two colour paths and the ambient collapse

**Files:**
- Modify: `client/src/game/lighting.ts` (options type at 71–77; the image-processing block at 246–255; `apply()` at 257–325)
- Test: `client/test/game/lighting.test.ts` (lines 153–166 and 321–350)

**Interfaces:**
- Consumes: `ambientCollapseUnder` from Task 2.
- Produces: `LightingOptions.colourPath: "post" | "material"` (required). On `"material"`: Khronos Neutral tone mapping, `ditheringEnabled = true`, colour curves and vignette as today. On `"post"`: `image.applyByPostProcess = true`, `toneMappingEnabled = false`, `colorCurvesEnabled = false`, `vignetteEnabled = false` — the grade pass owns them. Both: `fill.intensity` and `scene.environmentIntensity` scaled by `ambientCollapseUnder(weather)`.

- [ ] **Step 1: Update the tests**

In `client/test/game/lighting.test.ts`, every `createLighting(s, {...})` call gains `colourPath: "material"`. Replace the ACES test (153–166) with:

```ts
  it("on the material path uses Khronos Neutral tone mapping with dithering and tracks exposure to the sun", () => {
    const s = scene();
    const lighting = createLighting(s, {
      tier: "medium", viewDistance: 70, hour: 12, weather: WEATHER_PRESETS.clear, colourPath: "material",
    });
    const ip = s.imageProcessingConfiguration;
    expect(ip.toneMappingEnabled).toBe(true);
    expect(ip.toneMappingType).toBe(ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL);
    expect(ip.ditheringEnabled).toBe(true);
    expect(ip.applyByPostProcess).toBe(false);
    expect(ip.exposure).toBeCloseTo(exposureFor(sunPositionAt(12).y), 5);
    lighting.setHour(0);
    expect(ip.exposure).toBeGreaterThan(exposureFor(sunPositionAt(12).y));
    lighting.dispose();
  });

  it("on the post path hands colour to the post chain", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "high", viewDistance: 70, hour: 12, colourPath: "post" });
    const ip = s.imageProcessingConfiguration;
    expect(ip.applyByPostProcess).toBe(true);
    expect(ip.toneMappingEnabled).toBe(false);
    expect(ip.colorCurvesEnabled).toBe(false);
    expect(ip.vignetteEnabled).toBe(false);
    lighting.dispose();
  });

  it("collapses the ambient on the top dread plateau", () => {
    const s = scene();
    const lighting = createLighting(s, { tier: "medium", viewDistance: 70, hour: 12, colourPath: "material" });
    const before = s.environmentIntensity;
    const fill = s.getLightByName("fill");
    const fillBefore = fill?.intensity ?? 0;
    lighting.setWeather(WEATHER_PRESETS.eerie, 0);
    expect(s.environmentIntensity).toBeCloseTo(before * ambientCollapseUnder(WEATHER_PRESETS.eerie), 10);
    expect(fill?.intensity ?? 0).toBeLessThan(fillBefore);
    lighting.dispose();
  });
```

Import `ambientCollapseUnder` from `../../src/game/weather.js`.

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/lighting.test.ts`
Expected: FAIL — typecheck on `colourPath`, and ACES still set.

- [ ] **Step 3: Implement**

In `lighting.ts` add to `LightingOptions`:

```ts
  /**
   * Who owns colour. `"post"`: the grade pass tone-maps, grades and
   * vignettes, so materials output linear HDR (`applyByPostProcess`).
   * `"material"`: no post chain exists (low tier, or no float targets), so
   * Babylon's in-material processing carries the intent with Khronos Neutral,
   * the colour curves and dithering. Decided by `postFeaturesFor` in
   * postParams.ts before either this or the post chain is built.
   */
  colourPath: "post" | "material";
```

Replace the image-processing block (lines 246–254) with:

```ts
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
    // Colour curves carry the split-tone grade on this path. Neutral is 0 on
    // Babylon's scale, so enabling them under clear weather changes nothing.
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }
```

In `apply()`, replace `fill.intensity = fillIntensityUnder(weather, toSun.y);` with:

```ts
    const collapse = ambientCollapseUnder(weather);
    fill.intensity = fillIntensityUnder(weather, toSun.y) * collapse;
    // The probe's share of the ambient collapses with the fill, so the top
    // plateau reads as the light going, not the fill alone dimming.
    scene.environmentIntensity = collapse;
```

Wrap the `if (image.colorCurves) { ... }` grade block in `if (options.colourPath === "material" && image.colorCurves)`. Keep `image.exposure = exposureUnder(...)` on both paths: the grade pass reads it from the same record, and on the post path the value is simply unused by materials. Import `ambientCollapseUnder` from `./weather.js`.

- [ ] **Step 4: Fix the other construction sites**

`renderer.ts` line 652 must pass `colourPath`; until Task 8 wires `postFeaturesFor`, pass `colourPath: "material"` so the game keeps rendering. `grep -rn "createLighting(" client/` for any other caller (tests) and add `colourPath: "material"`.

- [ ] **Step 5: Run the gates**

Run: `npm run typecheck && node_modules/.bin/vitest run --root client test/game/lighting.test.ts test/game/renderer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/lighting.ts client/src/game/renderer.ts client/test/game/lighting.test.ts
git commit
```

Subject: `feat: lighting takes a colour path and collapses the ambient with dread`.

---

### Task 6: `gradeParams.ts` — AgX, white point, Purkinje, split-tone, the grade record

**Files:**
- Create: `client/src/game/gradeParams.ts`
- Modify: `client/test/architecture.test.ts` (add to `BABYLON_FREE_FILES`)
- Test: `client/test/game/gradeParams.test.ts`

**Interfaces:**
- Consumes: `dreadLensUnder`, `moodUnder`, `exposureUnder`, `vignetteWeightUnder`, `GRADE_*` constants from `weather.ts`; `sunPositionAt`, `twilightT` from `sky.ts`.
- Produces:

```ts
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]; // column-major, GLSL order
export type Tint = { r: number; g: number; b: number; density: number; saturation: number };
export type GradeRecord = {
  exposure: number;
  whitePoint: Mat3;
  purkinje: Mat3;
  purkinjeThreshold: number;   // pixel luma below which the rod blend rises
  purkinjeStrength: number;    // 0..1
  shadows: Tint; midtones: Tint; highlights: Tint;
  lift: number;
  vignetteWeight: number;
  vignetteColour: Rgb;
  halationStrength: number;
  aberrationAmount: number;
};
export const AGX_INSET: Mat3; export const AGX_OUTSET: Mat3; export const SRGB_TO_REC2020: Mat3; export const REC2020_TO_SRGB: Mat3;
export const AGX_MIN_EV = -12.47393; export const AGX_MAX_EV = 4.026069;
export function agx(c: Rgb): Rgb;                                   // TS reference of the GLSL, exposure applied by the caller
export function whitePointMatrix(altitude: number): Mat3;           // Bradford adaptation; identity at noon
export const IDENTITY: Mat3;
export function hueToRgb(hueDeg: number): Rgb;
export function gradeRecordUnder(w: WeatherParams, hour: number, unsettle: number): GradeRecord;
export const HALATION_BASE = 0.04; export const HALATION_DREAD_GAIN = 4; export const ABERRATION_BASE = 10; export const ABERRATION_DREAD_GAIN = 1.5;
export const PURKINJE_THRESHOLD = 0.08; export const PURKINJE_MAX = 0.6; export const PURKINJE_MATRIX: Mat3;
```

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/gradeParams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  agx, gradeRecordUnder, whitePointMatrix, hueToRgb, IDENTITY,
  HALATION_BASE, ABERRATION_BASE, PURKINJE_MAX, AGX_MIN_EV, AGX_MAX_EV,
} from "../../src/game/gradeParams.js";
import { WEATHER_PRESETS, exposureUnder, vignetteWeightUnder, VIGNETTE_WEIGHT_BASE } from "../../src/game/weather.js";
import { sunPositionAt } from "../../src/game/sky.js";

const CLEAR = WEATHER_PRESETS.clear;
const EERIE = WEATHER_PRESETS.eerie;

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
    expect(out.r).toBeGreaterThan(0.25);
    expect(out.r).toBeLessThan(0.6);
    expect(Math.abs(out.r - out.g)).toBeLessThan(1e-3);
    expect(Math.abs(out.g - out.b)).toBeLessThan(1e-3);
  });

  it("uses the documented log2 range", () => {
    expect(AGX_MIN_EV).toBe(-12.47393);
    expect(AGX_MAX_EV).toBe(4.026069);
  });
});

describe("white point", () => {
  it("is the identity at noon and warms at dusk", () => {
    const noon = whitePointMatrix(sunPositionAt(12).y);
    for (let i = 0; i < 9; i++) expect(noon[i]).toBeCloseTo(IDENTITY[i]!, 6);
    const dusk = whitePointMatrix(sunPositionAt(18.2).y);
    // A warm white point makes a grey pixel redder than blue: the diagonal's
    // red gain exceeds its blue gain.
    expect(dusk[0]).toBeGreaterThan(dusk[8]!);
    const night = whitePointMatrix(sunPositionAt(1).y);
    expect(night[8]).toBeGreaterThan(night[0]!);
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
      const g = gradeRecordUnder(CLEAR, hour, 1);
      expect(g.exposure).toBe(exposureUnder(CLEAR, sunPositionAt(hour).y));
      expect(g.shadows.density).toBe(0);
      expect(g.midtones.density).toBe(0);
      expect(g.highlights.density).toBe(0);
      expect(g.lift).toBe(0);
      expect(g.vignetteWeight).toBe(VIGNETTE_WEIGHT_BASE);
      expect(g.halationStrength).toBe(HALATION_BASE);
      expect(g.aberrationAmount).toBe(ABERRATION_BASE);
    }
  });

  it("purkinje only bites at night", () => {
    expect(gradeRecordUnder(CLEAR, 12, 1).purkinjeStrength).toBe(0);
    expect(gradeRecordUnder(CLEAR, 1, 1).purkinjeStrength).toBeCloseTo(PURKINJE_MAX, 10);
  });

  it("dread raises the lens terms and unsettle scales exactly those", () => {
    const full = gradeRecordUnder(EERIE, 17, 1);
    const off = gradeRecordUnder(EERIE, 17, 0);
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
    const g = gradeRecordUnder(EERIE, 17, 1);
    expect(g.shadows.density).toBeGreaterThan(0);
    expect(g.midtones.density).toBeGreaterThan(g.highlights.density);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node_modules/.bin/vitest run --root client test/game/gradeParams.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `client/src/game/gradeParams.ts`:

```ts
import { clamp01, type Rgb } from "./colour.js";
import { sunPositionAt, twilightT } from "./sky.js";
import {
  dreadLensUnder, exposureUnder, moodUnder, vignetteWeightUnder,
  GRADE_SHADOW_HUE, GRADE_SHADOW_DENSITY, GRADE_SHADOW_SATURATION,
  GRADE_MIDTONE_HUE, GRADE_MIDTONE_DENSITY, GRADE_MIDTONE_SATURATION,
  GRADE_HIGHLIGHT_HUE, GRADE_HIGHLIGHT_DENSITY, GRADE_HIGHLIGHT_SATURATION,
  type WeatherParams,
} from "./weather.js";

/**
 * The pure arithmetic of the grade pass. Babylon-free and on the architecture
 * test's BABYLON_FREE_FILES list; `post.ts` binds it. Matrices are
 * column-major in GLSL order, so a `Mat3` uploads with setMatrix3x3 unchanged.
 */

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
export type Tint = { r: number; g: number; b: number; density: number; saturation: number };

export type GradeRecord = {
  exposure: number;
  whitePoint: Mat3;
  purkinje: Mat3;
  purkinjeThreshold: number;
  purkinjeStrength: number;
  shadows: Tint;
  midtones: Tint;
  highlights: Tint;
  lift: number;
  vignetteWeight: number;
  vignetteColour: Rgb;
  halationStrength: number;
  aberrationAmount: number;
};

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ---- AgX (three.js port, MIT). Column-major, mirrored in grade.fragment.fx. ----
// Constants are copied verbatim from three.js `tonemapping_pars_fragment.glsl.js`
// (src/renderers/shaders/ShaderChunk); the lockstep test pins the GLSL to these.
export const SRGB_TO_REC2020: Mat3 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956];
export const REC2020_TO_SRGB: Mat3 = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
export const AGX_INSET: Mat3 = [
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859,
];
export const AGX_OUTSET: Mat3 = [
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
];
export const AGX_MIN_EV = -12.47393;
export const AGX_MAX_EV = 4.026069;

/** GLSL `mat3 * vec3` with a column-major matrix. */
export function mulMat3(m: Mat3, v: Rgb): Rgb {
  return {
    r: m[0] * v.r + m[3] * v.g + m[6] * v.b,
    g: m[1] * v.r + m[4] * v.g + m[7] * v.b,
    b: m[2] * v.r + m[5] * v.g + m[8] * v.b,
  };
}

function agxContrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

/** The TS reference of `agxToneMap` in grade.fragment.fx. Input linear sRGB with exposure already applied; output linear sRGB in [0, 1]. */
export function agx(c: Rgb): Rgb {
  let v = mulMat3(AGX_INSET, mulMat3(SRGB_TO_REC2020, c));
  const enc = (x: number) => clamp01((Math.log2(Math.max(x, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV));
  v = { r: agxContrast(enc(v.r)), g: agxContrast(enc(v.g)), b: agxContrast(enc(v.b)) };
  v = mulMat3(AGX_OUTSET, v);
  const lin = (x: number) => Math.pow(Math.max(0, x), 2.2);
  v = mulMat3(REC2020_TO_SRGB, { r: lin(v.r), g: lin(v.g), b: lin(v.b) });
  return { r: clamp01(v.r), g: clamp01(v.g), b: clamp01(v.b) };
}

// ---- White point: Bradford chromatic adaptation between keyed illuminants. ----

const BRADFORD: Mat3 = [0.8951, -0.7502, 0.0389, 0.2664, 1.7135, -0.0685, -0.1614, 0.0367, 1.0296];
const BRADFORD_INV: Mat3 = [0.9869929, 0.4323053, -0.0085287, -0.1470543, 0.5183603, 0.0400428, 0.1599627, 0.0492912, 0.9684867];
const SRGB_TO_XYZ: Mat3 = [0.4124564, 0.2126729, 0.0193339, 0.3575761, 0.7151522, 0.1191920, 0.1804375, 0.0721750, 0.9503041];
const XYZ_TO_SRGB: Mat3 = [3.2404542, -0.9692660, 0.0556434, -1.5371385, 1.8760108, -0.2040259, -0.4985314, 0.0415560, 1.0572252];
/** D65, the sRGB white: the adaptation SOURCE, so noon is the identity. */
const WHITE_NOON = { x: 0.3127, y: 0.329 };
/** A warm dusk white (~4300 K) the image is adapted TOWARD at the horizon. */
export const WHITE_DUSK = { x: 0.3660, y: 0.3730 };
/** A cool night white (~8500 K). */
export const WHITE_NIGHT = { x: 0.2920, y: 0.3020 };

function mulMat3Mat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] = a[row]! * b[col * 3]! + a[3 + row]! * b[col * 3 + 1]! + a[6 + row]! * b[col * 3 + 2]!;
    }
  }
  return out as unknown as Mat3;
}

function xyToXyz(w: { x: number; y: number }): Rgb {
  return { r: w.x / w.y, g: 1, b: (1 - w.x - w.y) / w.y };
}

/** The 3x3 that adapts linear sRGB from D65 to `target`, in linear sRGB. */
export function bradfordMatrix(target: { x: number; y: number }): Mat3 {
  const src = mulMat3(BRADFORD, xyToXyz(WHITE_NOON));
  const dst = mulMat3(BRADFORD, xyToXyz(target));
  const scale: Mat3 = [dst.r / src.r, 0, 0, 0, dst.g / src.g, 0, 0, 0, dst.b / src.b];
  const cat = mulMat3Mat3(BRADFORD_INV, mulMat3Mat3(scale, BRADFORD));
  return mulMat3Mat3(XYZ_TO_SRGB, mulMat3Mat3(cat, SRGB_TO_XYZ));
}

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

function lerpXy(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  const k = clamp01(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// ---- Purkinje: an approximation, not Patry's opponent-space model. ----
// Below PURKINJE_THRESHOLD of pixel luma the colour blends toward a
// rod-weighted grey tinted blue: rods peak in the blue-green and see no red.
export const PURKINJE_THRESHOLD = 0.08;
export const PURKINJE_MAX = 0.6;
/** Column-major: each column is what one input channel contributes to (r, g, b). */
export const PURKINJE_MATRIX: Mat3 = [0.02, 0.03, 0.05, 0.35, 0.45, 0.60, 0.20, 0.25, 0.40];

// ---- Lens-side gains. Browser-tunable; `clear` identity is not. ----
export const HALATION_BASE = 0.04;
export const HALATION_DREAD_GAIN = 4;
export const ABERRATION_BASE = 10;
export const ABERRATION_DREAD_GAIN = 1.5;
export const VIGNETTE_COLOUR: Rgb = { r: 0.01, g: 0.02, b: 0.03 };

/** Pure hue to a unit-saturation RGB, HSB with S = B = 1. */
export function hueToRgb(hueDeg: number): Rgb {
  const h = (((hueDeg % 360) + 360) % 360) / 60;
  const i = Math.floor(h);
  const f = h - i;
  const q = 1 - f;
  switch (i) {
    case 0: return { r: 1, g: f, b: 0 };
    case 1: return { r: q, g: 1, b: 0 };
    case 2: return { r: 0, g: 1, b: f };
    case 3: return { r: 0, g: q, b: 1 };
    case 4: return { r: f, g: 0, b: 1 };
    default: return { r: 1, g: 0, b: q };
  }
}

function tint(hue: number, density: number, saturation: number, mood: number): Tint {
  const c = hueToRgb(hue);
  // Babylon's curves take density 0..100 and saturation -100..100; the pass
  // takes 0..1 and -1..1 so the same constants keep their tuning.
  return { r: c.r, g: c.g, b: c.b, density: mood === 0 ? 0 : (density / 100) * mood, saturation: mood === 0 ? 0 : (saturation / 100) * mood };
}

export function gradeRecordUnder(w: WeatherParams, hour: number, unsettle: number): GradeRecord {
  const altitude = sunPositionAt(hour).y;
  const lens = dreadLensUnder(w) * clamp01(unsettle);
  const mood = moodUnder(w);
  const night = 1 - clamp01(twilightT(altitude) / twilightT(0));
  return {
    exposure: exposureUnder(w, altitude),
    whitePoint: whitePointMatrix(altitude),
    purkinje: PURKINJE_MATRIX,
    purkinjeThreshold: PURKINJE_THRESHOLD,
    purkinjeStrength: night === 0 ? 0 : PURKINJE_MAX * night,
    shadows: tint(GRADE_SHADOW_HUE, GRADE_SHADOW_DENSITY, GRADE_SHADOW_SATURATION, mood),
    midtones: tint(GRADE_MIDTONE_HUE, GRADE_MIDTONE_DENSITY, GRADE_MIDTONE_SATURATION, mood),
    highlights: tint(GRADE_HIGHLIGHT_HUE, GRADE_HIGHLIGHT_DENSITY, GRADE_HIGHLIGHT_SATURATION, mood),
    lift: 0,
    // The dread share of the vignette is lens-side: at unsettle 0 the base weight stands.
    vignetteWeight: lens === 0 ? vignetteWeightUnder({ ...w, dread: 0 }) : vignetteWeightUnder({ ...w, dread: lens }),
    vignetteColour: VIGNETTE_COLOUR,
    halationStrength: lens === 0 ? HALATION_BASE : HALATION_BASE * (1 + HALATION_DREAD_GAIN * lens),
    aberrationAmount: lens === 0 ? ABERRATION_BASE : ABERRATION_BASE * (1 + ABERRATION_DREAD_GAIN * lens),
  };
}
```

Add `join(SRC, "game", "gradeParams.ts"),` to `BABYLON_FREE_FILES`.

- [ ] **Step 4: Run the tests**

Run: `node_modules/.bin/vitest run --root client test/game/gradeParams.test.ts test/architecture.test.ts`
Expected: PASS. If the "warms at dusk" assertion fails, print `bradfordMatrix(WHITE_DUSK)` and check the diagonal: red gain above 1, blue below — a transposed `BRADFORD_INV` is the likely cause, and the fix is to transpose the two Bradford literals together.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/gradeParams.ts client/test/game/gradeParams.test.ts client/test/architecture.test.ts
git commit
```

Subject: `feat: pure grade model — AgX, white point, Purkinje and the split-tone record`.

---

### Task 7: `postParams.ts`, the three post shaders and `post.ts`

**Files:**
- Create: `client/src/game/postParams.ts`, `client/src/game/shaders/halationExtract.fragment.fx`, `client/src/game/shaders/grade.fragment.fx`, `client/src/game/shaders/finish.fragment.fx`, `client/src/game/post.ts`
- Modify: `client/test/architecture.test.ts` (add `postParams.ts`)
- Test: `client/test/game/postParams.test.ts`, `client/test/game/post.test.ts`, `client/test/game/gradeShader.test.ts` (lockstep)

**Interfaces:**
- Consumes: `GradeRecord`, `gradeRecordUnder` and the AgX constants from Task 6; `dreadLensUnder` from Task 2.
- Produces:

```ts
// postParams.ts
export type PostFeatures = { pipeline: boolean; halation: boolean; colourPath: "post" | "material" };
export function postFeaturesFor(tier: QualityTier, fxSupported: boolean): PostFeatures;
export type FinishRecord = { overlapGain: number; overlapPhase: number; grainGain: number; time: number };
export function finishUnder(w: WeatherParams, unsettle: number, timeSeconds: number): FinishRecord;
export const OVERLAP_MAX = 0.35; export const OVERLAP_INNER = 0.55; export const OVERLAP_SCALE = 1.06; export const OVERLAP_BREATH_HZ = 0.05;
export const GRAIN_BASE = 0.035; export const GRAIN_DREAD_GAIN = 1.5; export const DITHER_LSB = 1 / 255; export const HALATION_THRESHOLD = 0.85;
// post.ts
export type Post = { readonly features: PostFeatures; update(weather: WeatherParams, hour: number, unsettle: number): void; dispose(): void };
export function createPost(scene: Scene, camera: Camera, features: PostFeatures): Post;
export function fxSupportedBy(engine: AbstractEngine): boolean;
```

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/postParams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  postFeaturesFor, finishUnder, OVERLAP_MAX, GRAIN_BASE, GRAIN_DREAD_GAIN, OVERLAP_BREATH_HZ,
} from "../../src/game/postParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

describe("postFeaturesFor", () => {
  it("high gets the pipeline and halation, medium the pipeline only, low nothing", () => {
    expect(postFeaturesFor("high", true)).toEqual({ pipeline: true, halation: true, colourPath: "post" });
    expect(postFeaturesFor("medium", true)).toEqual({ pipeline: true, halation: false, colourPath: "post" });
    expect(postFeaturesFor("low", true)).toEqual({ pipeline: false, halation: false, colourPath: "material" });
  });

  it("without float render targets every tier takes the material path", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(postFeaturesFor(tier, false).colourPath).toBe("material");
      expect(postFeaturesFor(tier, false).pipeline).toBe(false);
    }
  });
});

describe("finishUnder", () => {
  it("at clear the overlap is off and grain sits at its base", () => {
    const f = finishUnder(WEATHER_PRESETS.clear, 1, 3);
    expect(f.overlapGain).toBe(0);
    expect(f.grainGain).toBe(GRAIN_BASE);
    expect(f.time).toBe(3);
  });

  it("eerie reaches the full overlap and grain; unsettle scales both back to base", () => {
    const on = finishUnder(WEATHER_PRESETS.eerie, 1, 0);
    expect(on.overlapGain).toBeCloseTo(OVERLAP_MAX, 10);
    expect(on.grainGain).toBeCloseTo(GRAIN_BASE * (1 + GRAIN_DREAD_GAIN), 10);
    const off = finishUnder(WEATHER_PRESETS.eerie, 0, 0);
    expect(off.overlapGain).toBe(0);
    expect(off.grainGain).toBe(GRAIN_BASE);
  });

  it("the overlap breathes at OVERLAP_BREATH_HZ", () => {
    const period = 1 / OVERLAP_BREATH_HZ;
    expect(finishUnder(WEATHER_PRESETS.eerie, 1, 0).overlapPhase).toBeCloseTo(finishUnder(WEATHER_PRESETS.eerie, 1, period).overlapPhase, 6);
  });
});
```

Create `client/test/game/post.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createPost, fxSupportedBy } from "../../src/game/post.js";
import { postFeaturesFor } from "../../src/game/postParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("createPost under NullEngine — the silent-degradation contract", () => {
  it("reports no float render targets, so every tier is pass-free", () => {
    expect(fxSupportedBy(engine)).toBe(false);
    for (const tier of ["low", "medium", "high"] as const) {
      const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
      const post = createPost(scene, camera, postFeaturesFor(tier, fxSupportedBy(engine)));
      expect(post.features.pipeline).toBe(false);
      expect(camera._postProcesses.length).toBe(0);
      post.update(WEATHER_PRESETS.eerie, 17, 1);
      post.update(WEATHER_PRESETS.clear, 12, 0);
      post.dispose();
      camera.dispose();
    }
  });

  it("with the material path, update writes the grade record onto the image processing config", () => {
    const camera = new UniversalCamera("cam", new Vector3(0, 2, 0), scene);
    const post = createPost(scene, camera, postFeaturesFor("low", false));
    post.update(WEATHER_PRESETS.eerie, 17, 1);
    const ip = scene.imageProcessingConfiguration;
    expect(ip.vignetteEnabled).toBe(true);
    expect(ip.colorCurves?.midtonesDensity ?? 0).toBeGreaterThan(0);
    post.update(WEATHER_PRESETS.clear, 12, 1);
    expect(ip.colorCurves?.midtonesDensity).toBe(0);
    post.dispose();
  });
});
```

Create `client/test/game/gradeShader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import gradeFragment from "../../src/game/shaders/grade.fragment.fx?raw";
import finishFragment from "../../src/game/shaders/finish.fragment.fx?raw";
import halationFragment from "../../src/game/shaders/halationExtract.fragment.fx?raw";
import {
  AGX_INSET, AGX_OUTSET, SRGB_TO_REC2020, REC2020_TO_SRGB, AGX_MIN_EV, AGX_MAX_EV, type Mat3,
} from "../../src/game/gradeParams.js";
import { OVERLAP_INNER, OVERLAP_SCALE, DITHER_LSB, HALATION_THRESHOLD } from "../../src/game/postParams.js";

function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}
function glslMat3(m: Mat3): string {
  return `mat3(${m.map(glslFloat).join(", ")})`;
}

describe("grade.fragment.fx stays in lockstep with gradeParams.ts", () => {
  it("carries the AgX matrices and range verbatim", () => {
    expect(gradeFragment).toContain(`const mat3 AGX_INSET = ${glslMat3(AGX_INSET)};`);
    expect(gradeFragment).toContain(`const mat3 AGX_OUTSET = ${glslMat3(AGX_OUTSET)};`);
    expect(gradeFragment).toContain(`const mat3 SRGB_TO_REC2020 = ${glslMat3(SRGB_TO_REC2020)};`);
    expect(gradeFragment).toContain(`const mat3 REC2020_TO_SRGB = ${glslMat3(REC2020_TO_SRGB)};`);
    expect(gradeFragment).toContain(`const float AGX_MIN_EV = ${glslFloat(AGX_MIN_EV)};`);
    expect(gradeFragment).toContain(`const float AGX_MAX_EV = ${glslFloat(AGX_MAX_EV)};`);
  });
  it("keeps the MIT notice for the borrowed tone map", () => {
    expect(gradeFragment).toContain("three.js, MIT License, Copyright 2010-2024 three.js authors");
  });
});

describe("finish.fragment.fx and halationExtract.fragment.fx stay in lockstep with postParams.ts", () => {
  it("carries the overlap mask, the dither amplitude and the halation threshold", () => {
    expect(finishFragment).toContain(`const float OVERLAP_INNER = ${glslFloat(OVERLAP_INNER)};`);
    expect(finishFragment).toContain(`const float OVERLAP_SCALE = ${glslFloat(OVERLAP_SCALE)};`);
    expect(finishFragment).toContain(`const float DITHER_LSB = ${glslFloat(DITHER_LSB)};`);
    expect(halationFragment).toContain(`const float HALATION_THRESHOLD = ${glslFloat(HALATION_THRESHOLD)};`);
  });
});
```

`glslFloat(1/255)` prints `0.00392156862745098`; write exactly that literal in the GLSL.

- [ ] **Step 2: Run them to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/postParams.test.ts test/game/post.test.ts test/game/gradeShader.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `postParams.ts`**

```ts
import { clamp01 } from "./colour.js";
import type { QualityTier } from "./quality.js";
import { dreadLensUnder, type WeatherParams } from "./weather.js";

/**
 * The pure arithmetic of the post chain: which passes a tier gets, and the
 * finish pass's record. Babylon-free and on the architecture test's
 * BABYLON_FREE_FILES list; `post.ts` is the shell.
 */

export type PostFeatures = { pipeline: boolean; halation: boolean; colourPath: "post" | "material" };

/**
 * The tier ladder as data. Without float render targets (NullEngine, weak
 * WebGL) nothing HDR can run, so every tier falls to the material path: an
 * 8-bit chain would band the very frames this restyle exists for.
 */
export function postFeaturesFor(tier: QualityTier, fxSupported: boolean): PostFeatures {
  if (!fxSupported || tier === "low") return { pipeline: false, halation: false, colourPath: "material" };
  return { pipeline: true, halation: tier === "high", colourPath: "post" };
}

export type FinishRecord = { overlapGain: number; overlapPhase: number; grainGain: number; time: number };

// ---- Browser-tunable magnitudes. `clear` identity is not. ----
/** Overlap gain at full dread and unsettle 1. */
export const OVERLAP_MAX = 0.35;
/** Radius (of the half-diagonal) inside which the overlap mask is zero. */
export const OVERLAP_INNER = 0.55;
/** Scale of the echo about the frame centre. */
export const OVERLAP_SCALE = 1.06;
/** The echo's breathing rate. */
export const OVERLAP_BREATH_HZ = 0.05;
/** Grain amplitude in display units at clear; near the threshold of perception. */
export const GRAIN_BASE = 0.035;
/** Grain gain at full dread: base × (1 + gain). */
export const GRAIN_DREAD_GAIN = 1.5;
/** One 8-bit step, the dither's half-amplitude in display units. */
export const DITHER_LSB = 1 / 255;
/** Display luminance above which halation is extracted. */
export const HALATION_THRESHOLD = 0.85;

export function finishUnder(w: WeatherParams, unsettle: number, timeSeconds: number): FinishRecord {
  const lens = dreadLensUnder(w) * clamp01(unsettle);
  return {
    overlapGain: lens === 0 ? 0 : OVERLAP_MAX * lens,
    overlapPhase: (timeSeconds * OVERLAP_BREATH_HZ) % 1,
    grainGain: lens === 0 ? GRAIN_BASE : GRAIN_BASE * (1 + GRAIN_DREAD_GAIN * lens),
    time: timeSeconds,
  };
}
```

Add `join(SRC, "game", "postParams.ts"),` to `BABYLON_FREE_FILES`.

- [ ] **Step 4: Write the three shaders**

`client/src/game/shaders/halationExtract.fragment.fx`:

```glsl
// Halation extract: quarter-resolution first stage of the halation chain in
// post.ts. Keeps only what is brighter than HALATION_THRESHOLD in display
// luminance, tinted toward the red-orange bleed film shows around lights.
// The two BlurPostProcess stages that follow are Babylon's own.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. The literal mirrors
// postParams.ts and a lockstep test asserts they agree.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;

const float HALATION_THRESHOLD = 0.85;
const vec3 HALATION_TINT = vec3(1.0, 0.45, 0.2);

float halationLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main(void) {
  vec3 scene = texture2D(textureSampler, vUV).rgb;
  float over = max(halationLuma(scene) - HALATION_THRESHOLD, 0.0);
  gl_FragColor = vec4(scene * HALATION_TINT * over, 1.0);
}
```

`client/src/game/shaders/grade.fragment.fx`:

```glsl
// The grade pass: the whole colour identity in one full-screen shader, run
// on linear HDR before the pipeline's chromatic aberration and FXAA. Order:
// exposure, AgX, white point, Purkinje, split-tone, lift, vignette, halation,
// sRGB encode. Every knob is a uniform from gradeRecordUnder in
// gradeParams.ts, so nothing recompiles at runtime.
//
// The AgX tone map is ported from three.js, MIT License, Copyright 2010-2024 three.js authors
// (src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js).
// Its matrices are column-major and mirrored in gradeParams.ts; a lockstep
// test asserts they agree.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D halationSampler;

uniform float exposure;
uniform mat3 whitePoint;
uniform mat3 purkinje;
uniform float purkinjeThreshold;
uniform float purkinjeStrength;
uniform vec3 shadowTint;
uniform vec2 shadowAmount;
uniform vec3 midtoneTint;
uniform vec2 midtoneAmount;
uniform vec3 highlightTint;
uniform vec2 highlightAmount;
uniform float lift;
uniform float vignetteWeight;
uniform vec3 vignetteColour;
uniform float halationStrength;

const mat3 SRGB_TO_REC2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956);
const mat3 REC2020_TO_SRGB = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
const mat3 AGX_INSET = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
const mat3 AGX_OUTSET = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

float gradeLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// Linear sRGB in, linear sRGB in [0, 1] out. Mirrors agx() in gradeParams.ts.
vec3 agxToneMap(vec3 c) {
  vec3 v = AGX_INSET * (SRGB_TO_REC2020 * c);
  v = max(v, vec3(1.0e-10));
  v = (log2(v) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  v = clamp(v, 0.0, 1.0);
  v = agxContrast(v);
  v = AGX_OUTSET * v;
  v = pow(max(v, vec3(0.0)), vec3(2.2));
  v = REC2020_TO_SRGB * v;
  return clamp(v, 0.0, 1.0);
}

// One split-tone band: pushes the colour toward the tint by density and
// scales its saturation by (1 + saturation), weighted by the band mask.
vec3 gradeBand(vec3 c, float mask, vec3 tintColour, vec2 amount) {
  float l = gradeLuma(c);
  vec3 tinted = mix(c, tintColour * l, amount.x);
  vec3 grey = vec3(gradeLuma(tinted));
  vec3 sat = mix(grey, tinted, 1.0 + amount.y);
  return mix(c, sat, mask);
}

vec3 toSrgb(vec3 c) {
  return pow(c, vec3(1.0 / 2.2));
}

void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb * exposure;
  c = agxToneMap(c);
  c = clamp(whitePoint * c, 0.0, 1.0);
  float l = gradeLuma(c);
  float rod = smoothstep(purkinjeThreshold, 0.0, l) * purkinjeStrength;
  c = mix(c, purkinje * c, rod);
  float shadowMask = 1.0 - smoothstep(0.0, 0.35, l);
  float highlightMask = smoothstep(0.55, 1.0, l);
  float midMask = 1.0 - shadowMask - highlightMask;
  c = gradeBand(c, shadowMask, shadowTint, shadowAmount);
  c = gradeBand(c, midMask, midtoneTint, midtoneAmount);
  c = gradeBand(c, highlightMask, highlightTint, highlightAmount);
  c = lift + c * (1.0 - lift);
  vec2 centred = (vUV - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.4, 1.4, length(centred) * vignetteWeight * 0.5);
  c = mix(vignetteColour, c, vig);
  vec3 halo = texture2D(halationSampler, vUV).rgb * halationStrength;
  c = 1.0 - (1.0 - c) * (1.0 - clamp(halo, 0.0, 1.0));
  gl_FragColor = vec4(toSrgb(clamp(c, 0.0, 1.0)), 1.0);
}
```

`client/src/game/shaders/finish.fragment.fx`:

```glsl
// The finish pass, last on the camera after the pipeline's chromatic
// aberration and FXAA: the peripheral overlap, luminance-weighted grain and
// a triangular dither, on display-referred sRGB. Every knob is a uniform
// from finishUnder in postParams.ts.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. Literals mirror
// postParams.ts and a lockstep test asserts they agree.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texelSize;
uniform float overlapGain;
uniform float overlapPhase;
uniform float grainGain;
uniform float time;

const float OVERLAP_INNER = 0.55;
const float OVERLAP_SCALE = 1.06;
const float DITHER_LSB = 0.00392156862745098;
const float TWO_PI = 6.28318530718;

float finishLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Interleaved gradient noise on pixel coordinates plus a per-frame offset,
// the distanceFadePlugin pattern.
float finishNoise(vec2 p, float seed) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y + seed));
}

void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  vec2 centred = (vUV - 0.5) * 2.0;
  float radius = length(centred) / 1.41421356;
  float mask = smoothstep(OVERLAP_INNER, 1.0, radius) * overlapGain;
  if (mask > 0.0) {
    float breath = 0.01 * sin(overlapPhase * TWO_PI);
    vec2 mirrored = vec2(1.0 - vUV.x, vUV.y);
    vec2 echoUv = (mirrored - 0.5) / OVERLAP_SCALE + 0.5 + vec2(breath, 0.0);
    vec3 echo = texture2D(textureSampler, clamp(echoUv, 0.0, 1.0)).rgb;
    vec3 delit = vec3(finishLuma(echo)) * 0.35;
    c = 1.0 - (1.0 - c) * (1.0 - delit * mask);
  }
  vec2 pixel = vUV / texelSize;
  float l = finishLuma(c);
  float weight = (1.0 - l) * smoothstep(0.0, 0.15, l) + 0.15 * (1.0 - l);
  float g = finishNoise(pixel, fract(time * 7.31)) - 0.5;
  c += g * grainGain * weight;
  float d1 = finishNoise(pixel, fract(time * 3.17));
  float d2 = finishNoise(pixel + vec2(37.0, 11.0), fract(time * 5.03));
  c += (d1 + d2 - 1.0) * DITHER_LSB;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
```

- [ ] **Step 5: Write `post.ts`**

```ts
import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { BlurPostProcess } from "@babylonjs/core/PostProcesses/blurPostProcess.js";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Vector2 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";

import type { WeatherParams } from "./weather.js";
import { gradeUnder, saturationUnder } from "./weather.js";
import { gradeRecordUnder, type GradeRecord } from "./gradeParams.js";
import { finishUnder, type PostFeatures } from "./postParams.js";
import halationExtractFragment from "./shaders/halationExtract.fragment.fx?raw";
import gradeFragment from "./shaders/grade.fragment.fx?raw";
import finishFragment from "./shaders/finish.fragment.fx?raw";

export type Post = {
  readonly features: PostFeatures;
  update(weather: WeatherParams, hour: number, unsettle: number): void;
  dispose(): void;
};

/** The capability every HDR pass needs: float or half-float render targets. */
export function fxSupportedBy(engine: AbstractEngine): boolean {
  const caps = engine.getCaps();
  return Boolean(caps.textureHalfFloatRender || caps.textureFloatRender);
}

const HALATION_RATIO = 0.25;
const HALATION_KERNEL = 32;

/**
 * The post chain: halation extract and blur (high), the grade pass, the
 * DefaultRenderingPipeline slimmed to chromatic aberration and FXAA, then the
 * finish pass. Passes attach in creation order, which is what fixes the
 * order — FXAA and aberration must run before grain and dither, and dither
 * must be last. On the material path nothing is created and update() writes
 * the same record onto Babylon's in-material image processing.
 */
export function createPost(scene: Scene, camera: Camera, features: PostFeatures): Post {
  const engine = scene.getEngine();
  const image = scene.imageProcessingConfiguration;
  let grade: PostProcess | null = null;
  let finish: PostProcess | null = null;
  let extract: PostProcess | null = null;
  let blurX: BlurPostProcess | null = null;
  let blurY: BlurPostProcess | null = null;
  let pipeline: DefaultRenderingPipeline | null = null;
  let black: RawTexture | null = null;
  let record: GradeRecord = gradeRecordUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }, 12, 1);
  let finishRecord = finishUnder({ cloudCover: 0, mist: 0, rain: 0, wetness: 0, dread: 0 }, 1, 0);
  const start = performance.now();

  if (features.pipeline) {
    const textureType = engine.getCaps().textureHalfFloatRender
      ? Constants.TEXTURETYPE_HALF_FLOAT
      : Constants.TEXTURETYPE_FLOAT;
    Effect.ShadersStore["halationExtractFragmentShader"] = halationExtractFragment;
    Effect.ShadersStore["gradeFragmentShader"] = gradeFragment;
    Effect.ShadersStore["finishFragmentShader"] = finishFragment;

    if (features.halation) {
      extract = new PostProcess("halationExtract", "halationExtract", [], [], HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
      blurX = new BlurPostProcess("halationBlurX", new Vector2(1, 0), HALATION_KERNEL, HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
      blurY = new BlurPostProcess("halationBlurY", new Vector2(0, 1), HALATION_KERNEL, HALATION_RATIO, camera,
        Texture.BILINEAR_SAMPLINGMODE, engine, false, textureType);
    } else {
      black = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    }

    grade = new PostProcess("grade", "grade",
      ["exposure", "whitePoint", "purkinje", "purkinjeThreshold", "purkinjeStrength", "shadowTint", "shadowAmount",
        "midtoneTint", "midtoneAmount", "highlightTint", "highlightAmount", "lift", "vignetteWeight", "vignetteColour",
        "halationStrength"],
      ["halationSampler"], 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
    const boundExtract = extract;
    const boundBlurY = blurY;
    const boundBlack = black;
    grade.onApply = (effect) => {
      const r = record;
      // With halation the scene is the extract's INPUT (setTextureFromPostProcess
      // binds a pass's input texture); without it the chain's previous output
      // is already the scene, so textureSampler needs no override.
      if (boundExtract !== null) effect.setTextureFromPostProcess("textureSampler", boundExtract);
      if (boundBlurY !== null) effect.setTextureFromPostProcessOutput("halationSampler", boundBlurY);
      else if (boundBlack !== null) effect.setTexture("halationSampler", boundBlack);
      effect.setFloat("exposure", r.exposure);
      effect.setMatrix3x3("whitePoint", Float32Array.from(r.whitePoint));
      effect.setMatrix3x3("purkinje", Float32Array.from(r.purkinje));
      effect.setFloat("purkinjeThreshold", r.purkinjeThreshold);
      effect.setFloat("purkinjeStrength", r.purkinjeStrength);
      effect.setFloat3("shadowTint", r.shadows.r, r.shadows.g, r.shadows.b);
      effect.setFloat2("shadowAmount", r.shadows.density, r.shadows.saturation);
      effect.setFloat3("midtoneTint", r.midtones.r, r.midtones.g, r.midtones.b);
      effect.setFloat2("midtoneAmount", r.midtones.density, r.midtones.saturation);
      effect.setFloat3("highlightTint", r.highlights.r, r.highlights.g, r.highlights.b);
      effect.setFloat2("highlightAmount", r.highlights.density, r.highlights.saturation);
      effect.setFloat("lift", r.lift);
      effect.setFloat("vignetteWeight", r.vignetteWeight);
      effect.setFloat3("vignetteColour", r.vignetteColour.r, r.vignetteColour.g, r.vignetteColour.b);
      effect.setFloat("halationStrength", r.halationStrength);
    };

    // hdr: true keeps the chain in half-float; everything but aberration and
    // FXAA stays off. Flipping an *Enabled flag rebuilds the pipeline, so the
    // tier decides once here and update() only writes uniforms.
    pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);
    pipeline.imageProcessingEnabled = false;
    pipeline.bloomEnabled = false;
    pipeline.grainEnabled = false;
    pipeline.sharpenEnabled = false;
    pipeline.depthOfFieldEnabled = false;
    pipeline.chromaticAberrationEnabled = true;
    // Babylon defaults radialIntensity to 0 — a flat screen-uniform shift.
    pipeline.chromaticAberration.radialIntensity = 2;
    pipeline.fxaaEnabled = true;

    finish = new PostProcess("finish", "finish", ["texelSize", "overlapGain", "overlapPhase", "grainGain", "time"], [],
      1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    finish.onApply = (effect) => {
      const f = finishRecord;
      effect.setFloat2("texelSize", 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
      effect.setFloat("overlapGain", f.overlapGain);
      effect.setFloat("overlapPhase", f.overlapPhase);
      effect.setFloat("grainGain", f.grainGain);
      effect.setFloat("time", f.time);
    };
  } else {
    image.vignetteEnabled = true;
    image.vignetteColor = new Color4(0.01, 0.02, 0.03, 0);
    image.colorCurves ??= new ColorCurves();
    image.colorCurvesEnabled = true;
  }

  return {
    features,
    update(weather, hour, unsettle) {
      record = gradeRecordUnder(weather, hour, unsettle);
      finishRecord = finishUnder(weather, unsettle, (performance.now() - start) / 1000);
      if (pipeline !== null) {
        pipeline.chromaticAberration.aberrationAmount = record.aberrationAmount;
        return;
      }
      // Material path: the same intent through Babylon's own operators.
      image.exposure = record.exposure;
      image.vignetteWeight = record.vignetteWeight;
      if (image.colorCurves) {
        const curves = image.colorCurves;
        const g = gradeUnder(weather);
        curves.globalSaturation = saturationUnder(weather);
        curves.shadowsHue = g.shadowsHue;
        curves.shadowsDensity = g.shadowsDensity;
        curves.shadowsSaturation = g.shadowsSaturation;
        curves.midtonesHue = g.midtonesHue;
        curves.midtonesDensity = g.midtonesDensity;
        curves.midtonesSaturation = g.midtonesSaturation;
        curves.highlightsHue = g.highlightsHue;
        curves.highlightsDensity = g.highlightsDensity;
        curves.highlightsSaturation = g.highlightsSaturation;
      }
    },
    dispose() {
      finish?.dispose();
      pipeline?.dispose();
      grade?.dispose();
      blurY?.dispose();
      blurX?.dispose();
      extract?.dispose();
      black?.dispose();
    },
  };
}
```

`effect.setTextureFromPostProcessOutput` exists on `Effect` in 9.18 (`setTextureFromPostProcessOutput(channel, postProcess)` binds the pass's OUTPUT); `setTextureFromPostProcess` binds its INPUT. If typecheck rejects either name, open `node_modules/@babylonjs/core/Materials/effect.d.ts` and use the two methods declared there with those semantics.

On the material path, `lighting.ts` (Task 5) already applied the curves in `apply()`; `post.update` re-applying them is redundant but harmless and keeps the colour intent in one call site per frame. Remove the curve writes from `lighting.ts`'s `apply()` in this task and update `lighting.test.ts`'s two colour-curve tests to call `post.update` instead — or keep both; pick one and say which in the commit's `## How`. Recommended: remove from lighting, keep in post, so lighting owns light and post owns colour on both paths.

- [ ] **Step 6: Run the gates**

Run: `npm run typecheck && node_modules/.bin/vitest run --root client test/game/postParams.test.ts test/game/post.test.ts test/game/gradeShader.test.ts test/game/shaderHygiene.test.ts test/game/lighting.test.ts test/architecture.test.ts`
Expected: PASS. The hygiene test's "functions intact" check must find `agxToneMap(`, `gradeBand(`, `finishNoise(`, `halationLuma(` after preprocessing.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/postParams.ts client/src/game/post.ts client/src/game/shaders/halationExtract.fragment.fx client/src/game/shaders/grade.fragment.fx client/src/game/shaders/finish.fragment.fx client/src/game/lighting.ts client/test/game/postParams.test.ts client/test/game/post.test.ts client/test/game/gradeShader.test.ts client/test/game/lighting.test.ts client/test/architecture.test.ts
git commit
```

Subject: `feat: grade and finish passes — AgX, split-tone, halation, overlap, grain, dither`.

---

### Task 8: Wire the renderer, colour the mist from the gradient, add `/unsettle`

**Files:**
- Modify: `client/src/game/renderer.ts` (imports; the `createLighting` call at ~652; the sync block at ~853; dispose; the `Renderer` type), `client/src/game/mistMeshes.ts:31-35,75-89`, `client/src/game/commands.ts` (`SPECS`), `client/src/app.ts` (`applyView`, `onSubmit`)
- Test: `client/test/game/commands.test.ts`, `client/test/game/mistMeshes.test.ts`, `client/test/game/renderer.test.ts`

**Interfaces:**
- Consumes: `createAtmosphere` (Task 4), `createPost`, `fxSupportedBy` (Task 7), `postFeaturesFor` (Task 7), `colourPath` (Task 5).
- Produces: `Renderer.setUnsettle(level: number): void` (0–1); `MistMeshes.update(camX, camZ, w, air: Rgb)`; `/unsettle` command with `scriptValue: Number(args[0])`, `defaultValue: 100`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/commands.test.ts`:

```ts
describe("/unsettle", () => {
  it("takes a level in [0, 100], persists as a number, and defaults to 100", () => {
    expect(validateCommand({ name: "unsettle", args: ["40"] })).toBeNull();
    expect(validateCommand({ name: "unsettle", args: [] })).toBeNull();
    expect(validateCommand({ name: "unsettle", args: ["101"] })).toContain("[0, 100]");
    expect(validateCommand({ name: "unsettle", args: ["x"] })).toContain("[0, 100]");
    const spec = findCommand("unsettle");
    expect(spec?.kind).toBe("view");
    expect(spec?.scriptValue?.(["40"])).toBe(40);
    expect(spec?.defaultValue).toBe(100);
  });
});
```

In `client/test/game/mistMeshes.test.ts`, every `update(x, z, w)` call gains a fourth argument `{ r: 0.5, g: 0.5, b: 0.5 }`, and add:

```ts
  it("colours the banks from the air colour it is handed", () => {
    const mist = createMistMeshes(scene, 1, "high");
    mist.update(0, 0, WEATHER_PRESETS.mist, { r: 0.2, g: 0.4, b: 0.6 });
    const mat = mist.meshes[0]?.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(0.2, 6);
    expect(mat.emissiveColor.b).toBeCloseTo(0.6, 6);
    mist.dispose();
  });
```

(import `StandardMaterial` from `@babylonjs/core/Materials/standardMaterial.js` and `WEATHER_PRESETS` from `../../src/game/weather.js` if not already imported.)

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/commands.test.ts test/game/mistMeshes.test.ts`
Expected: FAIL — `unsettle` unknown; `update` ignores the fourth argument.

- [ ] **Step 3: The command**

In `client/src/game/commands.ts` add to `SPECS` after the `bob` entry:

```ts
  {
    name: "unsettle",
    kind: "view",
    validate(args) {
      if (args.length === 0) return null;
      if (args.length > 1) return "unsettle takes one argument, a level in [0, 100]";
      const v = Number(args[0]);
      if (!Number.isFinite(v) || v < 0 || v > 100) return `"${args[0]}" is not a level in [0, 100]`;
      return null;
    },
    // Bare `/unsettle` restores the full effects, matching `/bob`.
    scriptValue: (args) => (args.length === 0 ? 100 : Number(args[0])),
    defaultValue: 100,
  },
```

In `client/src/app.ts` `applyView`, after the `bob` branch:

```ts
    } else if (name === "unsettle") {
      renderer.setUnsettle((typeof value === "number" ? value : 100) / 100);
```

- [ ] **Step 4: The mist colour**

In `client/src/game/mistMeshes.ts` change the type to `update(camX: number, camZ: number, w: WeatherParams, air: Rgb): void;`, import `type Rgb` from `./colour.js`, and replace `mat.emissiveColor.copyFrom(scene.fogColor);` with `mat.emissiveColor.set(air.r, air.g, air.b);`. Update the doc comment: the banks are the colour of the gradient's middle, handed in by the renderer, so they sit inside the fog rather than at its far end.

- [ ] **Step 5: The renderer**

In `client/src/game/renderer.ts`:

Imports: add `import { createAtmosphere } from "./atmosphere.js";`, `import { createPost, fxSupportedBy } from "./post.js";`, `import { postFeaturesFor } from "./postParams.js";`.

Before `createSkinShading` (the old cel slot, ~line 619):

```ts
  // Atmosphere plugin registration. BEFORE anything creates a material:
  // RegisterMaterialPlugin only reaches materials constructed after it runs.
  const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
```

Replace the `createLighting` line with:

```ts
  const tier = options.tier ?? detectTier();
  // Who owns colour is decided once, before lighting and the post chain are
  // built, from the tier and the float-target capability.
  const postFeatures = postFeaturesFor(tier, fxSupportedBy(engine));
  const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: postFeatures.colourPath });
  const post = createPost(scene, camera, postFeatures);
  let unsettle = 1;
```

In `sync`, replace the old `stylize.update(weather);` position with:

```ts
      atmosphere.update(weather, lighting.hour);
      post.update(weather, lighting.hour, unsettle);
```

Both `mist?.update(...)` calls gain `, atmosphere.midColour()` as the fourth argument.

Dispose: after `rain.dispose();` add `post.dispose();` and, after `lighting.dispose();`, `atmosphere.dispose();`.

The `Renderer` type gains `/** 0 silences the lens-side dread effects; 1 is full. */ setUnsettle(level: number): void;` and the object gains:

```ts
    setUnsettle(level) {
      unsettle = Math.min(1, Math.max(0, level));
    },
```

- [ ] **Step 6: Run the gates**

Run: `npm run typecheck && npm run lint && node_modules/.bin/vitest run --root client`
Expected: all green, including `renderer.test.ts` constructing under NullEngine with the plugin registered.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/renderer.ts client/src/game/mistMeshes.ts client/src/game/commands.ts client/src/app.ts client/test/game/commands.test.ts client/test/game/mistMeshes.test.ts
git commit
```

Subject: `feat: wire the atmosphere and post chain into the renderer, add /unsettle`.

---

### Task 9: Airborne motes

**Files:**
- Create: `client/src/game/motesParams.ts`, `client/src/game/motes.ts`
- Modify: `client/src/game/windPlugin.ts` (export the ω constants), `client/src/game/renderer.ts` (create, update, dispose), `client/test/architecture.test.ts`
- Test: `client/test/game/motesParams.test.ts`, `client/test/game/motes.test.ts`

**Interfaces:**
- Consumes: `twilightT` (Task 3), `dreadWorldUnder` (Task 2), `Atmosphere.record.sunColour` and `midColour()` (Task 4).
- Produces:

```ts
// windPlugin.ts
export const WIND_OMEGA_GUST = 0.3769911184; export const WIND_OMEGA_GUST2 = 0.8796459430;
// motesParams.ts
export type MoteSpecies = "pollen" | "midge" | "frost";
export type MoteSettings = { rate: number; minSize: number; maxSize: number; minLife: number; maxLife: number; rise: number; jitter: number };
export type MotesRecord = { species: Record<MoteSpecies, MoteSettings>; drift: { x: number; z: number }; colour: Rgb };
export const MOTE_CAPACITY: Record<QualityTier, number> = { low: 0, medium: 600, high: 1500 };
export const MOTE_DREAD_GAIN = 1.0;
export function windAt(t: number): { x: number; z: number };
export function motesUnder(w: WeatherParams, hour: number, air: Rgb, tier: QualityTier, t: number): MotesRecord;
// motes.ts
export type Motes = { update(camPos: { x: number; y: number; z: number }, w: WeatherParams, hour: number, air: Rgb): void; dispose(): void; readonly systems: readonly ParticleSystem[] };
export function createMotes(scene: Scene, tier: QualityTier): Motes | null; // null on low
```

- [ ] **Step 1: Export the wind constants**

In `client/src/game/windPlugin.ts` add above `WIND_GLSL`:

```ts
/** The gust ω constants (rad/s) the GLSL below inlines — exported so motes.ts rides the same wave. */
export const WIND_OMEGA_GUST = 0.3769911184;
export const WIND_OMEGA_GUST2 = 0.879645943;
```

and, in `client/test/game/windPlugin.test.ts` (create the file if it does not exist), assert the GLSL inlines them: `expect(WIND_GLSL_SOURCE).toContain("windTime * 0.3769911184")` — export `WIND_GLSL` from `windPlugin.ts` for that (`export const WIND_GLSL = ...`).

- [ ] **Step 2: Write the failing tests**

Create `client/test/game/motesParams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { motesUnder, windAt, MOTE_CAPACITY, MOTE_DREAD_GAIN } from "../../src/game/motesParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

const AIR = { r: 0.5, g: 0.55, b: 0.6 };

describe("motesUnder", () => {
  it("pollen by day, midges at dusk, frost at night, and never all three at once", () => {
    const noon = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 0).species;
    expect(noon.pollen.rate).toBeGreaterThan(0);
    expect(noon.frost.rate).toBe(0);
    const dusk = motesUnder(WEATHER_PRESETS.clear, 18.3, AIR, "high", 0).species;
    expect(dusk.midge.rate).toBeGreaterThan(0);
    const night = motesUnder(WEATHER_PRESETS.clear, 1, AIR, "high", 0).species;
    expect(night.frost.rate).toBeGreaterThan(0);
    expect(night.pollen.rate).toBe(0);
    for (const hour of [6, 12, 18, 22]) {
      const s = motesUnder(WEATHER_PRESETS.clear, hour, AIR, "high", 0).species;
      expect([s.pollen.rate, s.midge.rate, s.frost.rate].filter((r) => r > 0).length).toBeLessThanOrEqual(2);
    }
  });

  it("rain zeroes every rate and dread raises them on the top plateau", () => {
    const rain = motesUnder(WEATHER_PRESETS.rain, 12, AIR, "high", 0).species;
    expect(rain.pollen.rate + rain.midge.rate + rain.frost.rate).toBe(0);
    const clear = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 0).species.pollen.rate;
    const eerie = motesUnder({ ...WEATHER_PRESETS.eerie, rain: 0 }, 12, AIR, "high", 0).species.pollen.rate;
    expect(eerie).toBeCloseTo(clear * (1 + MOTE_DREAD_GAIN), 10);
  });

  it("scales with the tier's capacity and is silent on low", () => {
    expect(MOTE_CAPACITY.low).toBe(0);
    const high = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 0).species.pollen.rate;
    const medium = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "medium", 0).species.pollen.rate;
    expect(high).toBeCloseTo(medium * (MOTE_CAPACITY.high / MOTE_CAPACITY.medium), 10);
  });

  it("carries the air colour and a wind drift that varies with time", () => {
    const r = motesUnder(WEATHER_PRESETS.clear, 12, AIR, "high", 5);
    expect(r.colour).toEqual(AIR);
    expect(windAt(0)).not.toEqual(windAt(3));
  });
});
```

Create `client/test/game/motes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { createMotes } from "../../src/game/motes.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterEach(() => { scene.dispose(); engine.dispose(); });

describe("createMotes", () => {
  it("is null on low and builds three systems otherwise", () => {
    expect(createMotes(scene, "low")).toBeNull();
    const motes = createMotes(scene, "high");
    expect(motes?.systems.length).toBe(3);
    motes?.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.clear, 12, { r: 0.5, g: 0.5, b: 0.5 });
    motes?.update({ x: 0, y: 5, z: 0 }, WEATHER_PRESETS.rain, 12, { r: 0.5, g: 0.5, b: 0.5 });
    motes?.dispose();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node_modules/.bin/vitest run --root client test/game/motesParams.test.ts test/game/motes.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `motesParams.ts`**

```ts
import { clamp01, type Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import { sunPositionAt, twilightT } from "./sky.js";
import { dreadWorldUnder, type WeatherParams } from "./weather.js";
import { WIND_OMEGA_GUST, WIND_OMEGA_GUST2 } from "./windPlugin.js";

/**
 * The pure arithmetic of the airborne motes. Babylon-free; `motes.ts` binds it.
 * Species follow the sun through the same `twilightT` bands sky.ts uses, so
 * nothing new decides what time it is.
 */

export type MoteSpecies = "pollen" | "midge" | "frost";
export type MoteSettings = { rate: number; minSize: number; maxSize: number; minLife: number; maxLife: number; rise: number; jitter: number };
export type MotesRecord = { species: Record<MoteSpecies, MoteSettings>; drift: { x: number; z: number }; colour: Rgb };

export const MOTE_CAPACITY: Record<QualityTier, number> = { low: 0, medium: 600, high: 1500 };
/** Emit-rate gain on the top dread plateau. */
export const MOTE_DREAD_GAIN = 1.0;
/** Drift-speed loss on the top dread plateau: the air thickens. */
export const MOTE_DREAD_SLOW = 0.5;
/** Emit rate per particle of capacity per second at full presence: capacity/lifetime keeps the pool full. */
const RATE_PER_CAPACITY = 0.35;
/** Peak wind drift, m/s, at the gust crest. */
const WIND_DRIFT = 0.6;

const BASE: Record<MoteSpecies, Omit<MoteSettings, "rate">> = {
  pollen: { minSize: 0.02, maxSize: 0.05, minLife: 4, maxLife: 8, rise: 0.08, jitter: 0.15 },
  midge: { minSize: 0.01, maxSize: 0.02, minLife: 1.5, maxLife: 3, rise: 0.0, jitter: 0.9 },
  frost: { minSize: 0.03, maxSize: 0.08, minLife: 5, maxLife: 9, rise: -0.25, jitter: 0.1 },
};

/** The two gust terms windPlugin.ts sums, evaluated at the origin, as a horizontal drift. */
export function windAt(t: number): { x: number; z: number } {
  const gust = Math.sin(t * WIND_OMEGA_GUST) + 0.6 * Math.sin(t * WIND_OMEGA_GUST2);
  return { x: WIND_DRIFT * 0.75 * gust, z: WIND_DRIFT * 0.35 * gust };
}

/** Presence of each species in [0, 1] from the sun's altitude: day, the twilight band, night. */
export function presenceAt(hour: number): Record<MoteSpecies, number> {
  const t = twilightT(sunPositionAt(hour).y);
  const horizon = twilightT(0);
  const day = clamp01((t - horizon) / (1 - horizon));
  const night = clamp01(1 - t / horizon);
  const dusk = clamp01(1 - day - night);
  return { pollen: day, midge: dusk, frost: night };
}

export function motesUnder(w: WeatherParams, hour: number, air: Rgb, tier: QualityTier, t: number): MotesRecord {
  const presence = presenceAt(hour);
  const d = dreadWorldUnder(w);
  const rain = 1 - clamp01(w.rain);
  const gain = d === 0 ? 1 : 1 + MOTE_DREAD_GAIN * d;
  const slow = d === 0 ? 1 : 1 - MOTE_DREAD_SLOW * d;
  const capacity = MOTE_CAPACITY[tier];
  const species = {} as Record<MoteSpecies, MoteSettings>;
  for (const name of ["pollen", "midge", "frost"] as const) {
    const p = presence[name] * rain * gain;
    species[name] = { ...BASE[name], rate: p === 0 ? 0 : capacity * RATE_PER_CAPACITY * p / 3 };
  }
  const wind = windAt(t);
  return { species, drift: { x: wind.x * slow, z: wind.z * slow }, colour: air };
}
```

Add `join(SRC, "game", "motesParams.ts"),` to `BABYLON_FREE_FILES`. `windPlugin.ts` imports Babylon, so `motesParams.ts` importing its two number constants makes it Babylon-bearing transitively at runtime only through a type-erased path — the architecture test reads import specifiers, and `./windPlugin.js` is not `@babylonjs/*`, so it passes; but keep it honest: move the two ω constants into a new Babylon-free `client/src/game/windField.ts` (`export const WIND_OMEGA_GUST`, `WIND_OMEGA_GUST2`) imported by both `windPlugin.ts` and `motesParams.ts`, and add `windField.ts` to `BABYLON_FREE_FILES`. Do that instead of Step 1's export-from-windPlugin.

- [ ] **Step 5: Write `motes.ts`**

```ts
import type { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";

import type { Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import type { WeatherParams } from "./weather.js";
import { MOTE_CAPACITY, motesUnder, type MoteSpecies } from "./motesParams.js";

/** Emitter box half-width, metres, centred on the camera. */
export const MOTE_BOX_HALF = 10;
export const MOTE_TEX_SIZE = 16;
/** Additive alpha per mote: faint alone, bright where many overlap in lit air. */
const MOTE_ALPHA = 0.18;

/** A soft disc: alpha 1 at the centre falling to 0 at the rim. */
export function moteDiscMap(size: number = MOTE_TEX_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = 1 - r * r * (3 - 2 * r);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  return data;
}

export type Motes = {
  update(camPos: { x: number; y: number; z: number }, w: WeatherParams, hour: number, air: Rgb): void;
  dispose(): void;
  readonly systems: readonly ParticleSystem[];
};

const SPECIES: readonly MoteSpecies[] = ["pollen", "midge", "frost"];

/**
 * Three CPU particle systems, one per species, sharing a capacity budget and
 * a soft-disc sprite, additive so motes vanish over dark ground and shine in
 * lit air. Null on low: the tier has no capacity, and creating an idle system
 * would still cost a draw.
 */
export function createMotes(scene: Scene, tier: QualityTier): Motes | null {
  const capacity = MOTE_CAPACITY[tier];
  if (capacity === 0) return null;
  const tex = RawTexture.CreateRGBATexture(
    moteDiscMap(), MOTE_TEX_SIZE, MOTE_TEX_SIZE, scene, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;
  const emitter = new Vector3(0, 0, 0);
  const systems: ParticleSystem[] = [];
  const emitting: boolean[] = [];
  for (const name of SPECIES) {
    const system = new ParticleSystem(`motes_${name}`, Math.ceil(capacity / 3), scene);
    system.particleTexture = tex;
    system.emitter = emitter;
    system.minEmitBox = new Vector3(-MOTE_BOX_HALF, -MOTE_BOX_HALF * 0.5, -MOTE_BOX_HALF);
    system.maxEmitBox = new Vector3(MOTE_BOX_HALF, MOTE_BOX_HALF * 0.5, MOTE_BOX_HALF);
    system.minEmitPower = 1;
    system.maxEmitPower = 1;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.emitRate = 0;
    systems.push(system);
    emitting.push(false);
  }
  const start = performance.now();

  return {
    systems,
    update(camPos, w, hour, air) {
      emitter.set(camPos.x, camPos.y, camPos.z);
      const t = (performance.now() - start) / 1000;
      const r = motesUnder(w, hour, air, tier, t);
      const colour = new Color4(r.colour.r, r.colour.g, r.colour.b, MOTE_ALPHA);
      SPECIES.forEach((name, i) => {
        const s = r.species[name];
        const system = systems[i] as ParticleSystem;
        system.emitRate = s.rate;
        system.minSize = s.minSize;
        system.maxSize = s.maxSize;
        system.minLifeTime = s.minLife;
        system.maxLifeTime = s.maxLife;
        system.direction1 = new Vector3(r.drift.x - s.jitter, s.rise - s.jitter * 0.5, r.drift.z - s.jitter);
        system.direction2 = new Vector3(r.drift.x + s.jitter, s.rise + s.jitter * 0.5, r.drift.z + s.jitter);
        system.color1 = colour;
        system.color2 = colour;
        system.colorDead = new Color4(r.colour.r, r.colour.g, r.colour.b, 0);
        // The rain.ts start/stop latch: isStarted() stays true through the
        // drain, so track what we last asked for.
        if (s.rate > 0 && !emitting[i]) {
          system.start();
          emitting[i] = true;
        } else if (s.rate === 0 && emitting[i]) {
          system.stop();
          emitting[i] = false;
        }
      });
    },
    dispose() {
      // Only the first system disposes the shared texture; the rest keep it.
      systems.forEach((s, i) => s.dispose(i === 0));
    },
  };
}
```

- [ ] **Step 6: Wire into the renderer**

In `renderer.ts`: `import { createMotes } from "./motes.js";`; after `const rain = createRain(scene, tier);` add `const motes = createMotes(scene, tier);`; next to each `rain.update(camera.position, weather);` add `motes?.update(camera.position, weather, lighting.hour, atmosphere.midColour());`; in dispose, after `rain.dispose();` add `motes?.dispose();`.

- [ ] **Step 7: Run the gates**

Run: `npm run typecheck && npm run lint && node_modules/.bin/vitest run --root client`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/windField.ts client/src/game/windPlugin.ts client/src/game/motesParams.ts client/src/game/motes.ts client/src/game/renderer.ts client/test/game/motesParams.test.ts client/test/game/motes.test.ts client/test/game/windPlugin.test.ts client/test/architecture.test.ts
git commit
```

Subject: `feat: airborne motes — pollen, midges and frost lit by the air`.

---

### Task 10: Docs, the browser gates and the verification note

**Files:**
- Modify: `ARCHITECTURE.md` (the Rendering section), `AGENTS.md` (nothing unless a path changed), `README.md` only if it names `/style`
- Create: `docs/rendering/2026-09-15-atmosphere-restyle-verification.md` (dated the day the gates run)

- [ ] **Step 1: Update ARCHITECTURE.md's Rendering paragraph**

Append to the Rendering section:

```markdown
The look is an identity layer over PBR: a material plugin (`client/src/game/atmosphere.ts`) replaces Babylon's fog with height fog, a distance gradient and sun inscatter; a `grade` post-process (AgX tone map, per-hour white point, a night Purkinje shift, the split-tone grade, vignette, halation) runs before Babylon's pipeline (chromatic aberration, FXAA) and a `finish` pass (peripheral overlap, luminance grain, dither) runs after it. Every value is a uniform computed by the pure `*Params.ts` modules from the weather, the hour and `/unsettle`; the low tier has no passes and carries the same intent through Babylon's in-material image processing. Airborne motes (`motes.ts`) follow the sun's altitude and the wind.
```

- [ ] **Step 2: Grep for stale references**

Run: `grep -rn "style\b\|etched\|cel band\|celBand\|ssao" README.md ARCHITECTURE.md AGENTS.md .agents/skills docs/rendering/2026-09-1[45]-*.md | grep -v "restyle\|lifestyle\|stylized\|stylised"`
Expected: no hits that describe the retired features as current. Fix any.

- [ ] **Step 3: Stand up the game and take the gates**

Follow the browser-verification recipe in memory (`browser-verification-recipe`, `measuring-frame-time`, `visual-work-needs-visual-gates`): run the client from the worktree on its own port, drive Chrome through the chrome-devtools CLI with `--filePath` screenshots, and archive everything under `~/Projects/fps-sdd-archive/2026-09-<dd>-atmosphere-restyle/` (never in the repo).

For each of the four hero frames, at one fixed pose (record the `?cmd=` script and the freecam pose so it is reproducible):

| Frame | Script |
| --- | --- |
| Sunny start | `?cmd=weather clear;time 12` |
| Dawn | `?cmd=weather clear;time 6.5` |
| The eerie turn | `?cmd=weather eerie;time 17` |
| Night with headlamp | `?cmd=weather eerie;time 21` |

Take: (a) a control from `main` at the same pose and script (the old look), (b) the restyle on high, (c) the restyle on medium, (d) the restyle with the low tier forced. Then: (e) `weather mist;time 17` and a live `/weather eerie` fade, capturing at 0.5 s intervals to see the three plateaus land; (f) the night frame at 2× zoom on the fog band and the sky, looking for banding; (g) `unsettle 0` under eerie, confirming the world still steps and the frame corners are clean; (h) paired frame-time samples on high, both orders, alternating `main` and the restyle at the eerie 21 h frame, plus the restyle with motes disabled (comment out `createMotes` temporarily) to attribute their share. Budget: the whole post chain ≤ 2 ms of the paired delta at 1440p.

- [ ] **Step 4: Write the verification note**

Create `docs/rendering/2026-09-15-atmosphere-restyle-verification.md` with: the four frames judged (what reads photographic, what reads authored, anything wrong), the plateau sequence observed, the banding result, the `/unsettle 0` result, the low-tier result, the frame-time table (both orders, per pair, with the vsync check), the tuning changes made during the pass and the constants they changed, and what went unverified. Cite the archive by path for images. It is about the feature, not about the agents.

- [ ] **Step 5: Run every gate and commit**

Run: `npm run typecheck && npm run lint && npm test`, then the pre-push hook's leak scan by hand.
Expected: all green, zero leak-scan failures.

```bash
git add ARCHITECTURE.md docs/rendering/2026-09-15-atmosphere-restyle-verification.md
git commit
```

Subject: `docs: atmosphere restyle — architecture note and browser verification`. Any constants retuned in the browser pass are committed separately as `feat: tune the atmosphere restyle from the browser gates`, with the before/after values in `## How`.

---

## Plan self-review

- **Spec coverage.** §3.1 module map → Tasks 1, 3–9. §3.2 data flow → Tasks 4, 7, 8 (`atmosphere.update`, `post.update`, `motes.update` in `sync`). §3.3 two colour paths → Tasks 5 and 7. §4 plugin → Tasks 3–4. §5 post chain → Task 7 (order fixed by creation order; halation high only; black 1×1 on medium; `finish` last at 8-bit). §6 dread channels → Tasks 2 (stepped, collapse), 7 (overlap, grain, lens gains), 8 (`/unsettle`). §7 motes → Task 9. §8 fallbacks → `postFeaturesFor` (Task 7), anchor test (Task 4), retired `style` (Task 1). §9 tests → each task; the hygiene glob in Task 4; architecture list in Tasks 3, 6, 7, 9. §10 gates → Task 10. §11 follow-ups → none scheduled here, by design.
- **Deviations from the spec, stated:** the Purkinje term is an approximation (a luminance-keyed blend toward a rod-weighted blue-grey), not Patry's opponent-space model; the spec's "constants from Patry" becomes "constants tuned in the browser gate". The vignette in the grade pass is a radial smoothstep, not Babylon's exact vignette curve; its weight constant keeps today's name and the gate retunes it.
- **Type consistency.** `colourPath: "post" | "material"` (Tasks 5, 7, 8). `GradeRecord` fields as used in `post.ts`'s `onApply` (Task 7) match Task 6. `FinishRecord` (Task 7) matches `finishUnder`. `Atmosphere.midColour()` and `.record` (Task 4) are what Tasks 8 and 9 call. `Renderer.setUnsettle` (Task 8) is what `app.ts` calls. `MOTE_CAPACITY`, `motesUnder(w, hour, air, tier, t)` (Task 9) match `motes.ts`.
- **Placeholders.** `YYYY-MM-DD` in Task 10 is the verification note's date, chosen the day the gates run; no other open field.
