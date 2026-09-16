# Grass grounding and one wind: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ground the card foliage in the terrain it stands on and move the whole world with one wind field, inside the 60 Hz contract, without touching `sim/`.

**Architecture:** a Babylon-free `windParams.ts` computes one `WindRecord` per frame from the weather and the clock. A `FoliagePlugin` (vertex and fragment `.fx`) replaces the wind plugin on every card material and the near tree LODs, reading the record as uniforms and one new per-instance `foliage` attribute the clutter rebuild writes. A `FoliageLightPlugin` backlights the sun's diffuse. Motes, mist, rain and the ambient audio read the same record; the pulsing air bed is removed. A `/wind` view command overrides speed for gating.

**Tech Stack:** Babylon.js 9.18 (`MaterialPluginBase`, thin instances, GLSL plugins), TypeScript, vitest under `NullEngine`, the chrome-devtools CLI for browser gates.

**Spec:** `docs/rendering/2026-09-15-grass-grounding-and-wind-design.md`. Read it first; every value here comes from it.

## Global Constraints

- Nothing in the wind, the tint or the bend may touch `sim/`; no new sim tunable; the level id must not change (`client/test/sim/forest.test.ts` pins it).
- Every temporal frequency is an exact multiple of `2π / 300` (`WIND_TIME_WRAP`), asserted in a test.
- No new `discard` anywhere; no new sampler in any plugin.
- New GLSL goes in `client/src/game/shaders/*.fx` (the hygiene test's glob), never in TypeScript template literals. In GLSL comments never spell a hashed preprocessor keyword and never put a semicolon in a trailing comment.
- In a PBR plugin `vAlbedoColor` is the material constant, never the vertex colour; tint `surfaceAlbedo` multiplicatively or by `mix`.
- The `foliage` attribute is declared only under `FOLIAGE_TINT` and `THIN_INSTANCES`; every plugin compiles on both the UBO and non-UBO shader paths (the forced-WebGL2 `NullEngine` test).
- Every `attach*` is idempotent by plugin name (LOD buckets share a GLB's material).
- Per-clump randomness hashes world position, never `gl_InstanceID`.
- `clear` weather has a light breeze (speed 0.25); the grade's clear identity is untouched.
- Babylon-free files stay on `BABYLON_FREE_FILES` in `client/test/architecture.test.ts`.
- Work happens in a fresh worktree off `origin/main`; stage explicit paths; commit per task with the `github-push` message format; push only when asked; run the leak scan before any push.
- Browser gates are paired branch-versus-main samples in both orders; a visual claim needs a control frame.

## File map

| File | Task | Change |
| --- | --- | --- |
| `client/src/game/windParams.ts` | 1 | New. Constants, `WindRecord`, `windSpeedUnder`, `windRecordUnder`, `directionAt`, `gustAt`, `omegaMultiple`. |
| `client/test/game/windParams.test.ts` | 1 | New. |
| `client/test/architecture.test.ts` | 1, 6 | Add `windParams.ts`; remove `windField.ts`. |
| `client/src/game/shaders/foliage.vertex.fx`, `foliageWorldPos.vertex.fx`, `foliage.fragment.fx`, `foliageLights.fragment.fx` | 2 | New. |
| `client/src/game/foliagePlugin.ts` | 2 | New. `FoliagePlugin`, `FOLIAGE_PROFILES`, `attachFoliage`, `setFoliageWind`. |
| `client/test/game/foliagePlugin.test.ts` | 2 | New. |
| `client/src/game/clutterMeshes.ts` | 3, 5 | `foliage` buffer, `attachFoliage` by class, `foliageEdges`, `attachFoliageLight`. |
| `client/test/game/clutterMeshes.test.ts` | 3 | Attribute and edges. |
| `client/src/game/windPlugin.ts`, `client/test/game/windPlugin.test.ts` | 3 | Deleted. |
| `client/src/game/forestMeshes.ts` | 3, 4 | Understory to `attachFoliage`; tree LOD0/LOD1 attached. |
| `client/test/game/forestMeshes.test.ts` | 4 | Tree attachment. |
| `client/src/game/foliageLightPlugin.ts`, `shaders/foliageDiffuse.fragment.fx` | 5 | New. |
| `client/test/game/foliageLightPlugin.test.ts` | 5 | New. |
| `client/src/game/motesParams.ts`, `motes.ts`, `mistMeshes.ts`, `rain.ts` | 6 | Read the record. |
| `client/src/game/windField.ts` | 6 | Deleted. |
| `client/src/game/ambientAudio.ts`, `weather.ts` | 7 | Air bed removed; `setWind`; `ambientGainsUnder` without `air`. |
| `client/src/game/renderer.ts`, `client/src/app.ts`, `commands.ts` | 8 | The per-frame record, players, `/wind`. |
| `ARCHITECTURE.md`, `docs/rendering/2026-09-15-grass-grounding-and-wind-verification.md` | 9 | One sentence; the gate record. |

---

### Task 1: `windParams.ts`, the Babylon-free wind record

**Files:**
- Create: `client/src/game/windParams.ts`
- Test: `client/test/game/windParams.test.ts`
- Modify: `client/test/architecture.test.ts` (the `BABYLON_FREE_FILES` list, line ~105)

**Interfaces:**
- Consumes: `WeatherParams`, `clamp01` from `./colour.js`.
- Produces: everything below; Tasks 2, 6, 7 and 8 import from it. `windField.ts` stays until Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/windParams.test.ts
import { describe, it, expect } from "vitest";
import {
  WIND_TIME_WRAP, WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER, WIND_K1, WIND_K2,
  WIND_BASE, WIND_CLOUD, WIND_RAIN, WIND_LEAN_MAX, WIND_GUST_MAX, WIND_FLUTTER_MAX,
  WIND_DIR_PERIOD, windSpeedUnder, windRecordUnder, directionAt, gustAt, omegaMultiple,
} from "../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

describe("wind frequencies", () => {
  it("are exact multiples of 2π / WIND_TIME_WRAP so the time wrap is phase-continuous", () => {
    for (const omega of [WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER]) {
      const n = omegaMultiple(omega);
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
    }
    expect(WIND_TIME_WRAP).toBe(300);
  });
  it("keep the gust ω values the old windField.ts exported", () => {
    expect(WIND_OMEGA_GUST).toBe(0.3769911184);
    expect(WIND_OMEGA_GUST2).toBe(0.879645943);
  });
  it("wave numbers give a 25 m primary wave and a 9 m second octave", () => {
    expect(WIND_K1).toBeCloseTo((2 * Math.PI) / 25, 12);
    expect(WIND_K2).toBeCloseTo((2 * Math.PI) / 9, 12);
  });
});

describe("windSpeedUnder", () => {
  it("is the spec's table per preset", () => {
    expect(windSpeedUnder(WEATHER_PRESETS.clear)).toBeCloseTo(0.25, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.overcast)).toBeCloseTo(0.53, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.mist)).toBeCloseTo(0.565, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.rain)).toBeCloseTo(0.9, 10);
    expect(windSpeedUnder(WEATHER_PRESETS.eerie)).toBeCloseTo(0.69, 10);
    expect(WIND_BASE + WIND_CLOUD + WIND_RAIN).toBeCloseTo(0.9, 10);
  });
  it("never exceeds 1", () => {
    expect(windSpeedUnder({ cloudCover: 1, mist: 1, rain: 1, wetness: 1, dread: 1 })).toBeLessThanOrEqual(1);
  });
});

describe("windRecordUnder", () => {
  it("scales lean, gust and flutter with speed and wraps time", () => {
    const r = windRecordUnder(WEATHER_PRESETS.rain, 301);
    expect(r.speed).toBeCloseTo(0.9, 10);
    expect(r.lean).toBeCloseTo(WIND_LEAN_MAX * 0.9, 10);
    expect(r.gustAmp).toBeCloseTo(WIND_GUST_MAX * 0.9, 10);
    expect(r.flutterAmp).toBeCloseTo(WIND_FLUTTER_MAX * 0.9, 10);
    expect(r.time).toBeCloseTo(1, 10);
    expect(r.dirX * r.dirX + r.dirZ * r.dirZ).toBeCloseTo(1, 10);
  });
  it("the override replaces speed only", () => {
    const a = windRecordUnder(WEATHER_PRESETS.clear, 10);
    const b = windRecordUnder(WEATHER_PRESETS.clear, 10, 1);
    expect(b.speed).toBe(1);
    expect(b.dirX).toBe(a.dirX);
    expect(b.time).toBe(a.time);
    expect(windRecordUnder(WEATHER_PRESETS.rain, 10, 0).lean).toBe(0);
  });
});

describe("directionAt", () => {
  it("is unit length and makes one full turn per WIND_DIR_PERIOD", () => {
    const a = directionAt(0);
    const b = directionAt(WIND_DIR_PERIOD);
    expect(a.x * a.x + a.z * a.z).toBeCloseTo(1, 10);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
    const q = directionAt(WIND_DIR_PERIOD / 4);
    expect(q.x * a.x + q.z * a.z).toBeCloseTo(0, 6);
  });
});

describe("gustAt", () => {
  it("is bounded in [-1.5, 1.5]", () => {
    const r = windRecordUnder(WEATHER_PRESETS.rain, 0);
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 300; t += 0.37) {
      const v = gustAt({ ...r, time: t }, 13.2, -41.7);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1.5);
    expect(hi).toBeLessThanOrEqual(1.5);
  });
  it("the primary front travels downwind at ω1 / k1 = 1.5 m/s", () => {
    // Same 6 m ragged cell for both points so only the travelling phase differs:
    // the first term at (x, t) equals the first term at (x + 15 m downwind, t + 10 s).
    const r = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 1, dirZ: 0 };
    const speed = WIND_OMEGA_GUST / WIND_K1;
    expect(speed).toBeCloseTo(1.5, 6);
    const x0 = 0.5, dt = 10, x1 = x0 + speed * dt;
    // Isolate the primary term by differencing out the second octave analytically.
    const primary = (x: number, t: number) => gustAt({ ...r, time: t }, x, 0) - 0.5 * Math.sin(WIND_K2 * x + WIND_OMEGA_GUST2 * t + 1.7 * 0);
    // Both points sit in cells whose ragged term is identical only if ci is equal;
    // x0 = 0.5 and x1 = 15.5 are in cells 0 and 2, so compare with the ragged
    // difference removed by evaluating on a record with the ragged amplitude ignored:
    // the test therefore pins the closed form directly.
    const raggedAt = (x: number) => { const f = Math.floor(x / 6) * 0.618034; return 1.2 * (f - Math.floor(f) - 0.5); };
    const p0 = Math.sin(WIND_K1 * x0 + WIND_OMEGA_GUST * 0 + raggedAt(x0));
    const p1 = Math.sin(WIND_K1 * x1 + WIND_OMEGA_GUST * dt + raggedAt(x1));
    expect(Math.abs(Math.sin(WIND_K1 * x1 + WIND_OMEGA_GUST * dt) - Math.sin(WIND_K1 * x0))).toBeLessThan(1e-9);
    expect(primary(x0, 0)).toBeCloseTo(p0, 9);
    expect(primary(x1, dt)).toBeCloseTo(p1, 9);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root client test/game/windParams.test.ts`
Expected: FAIL, cannot resolve `../../src/game/windParams.js`.

- [ ] **Step 3: Write the module**

```ts
// client/src/game/windParams.ts
import { clamp01, type WeatherParams } from "./weather.js";

/**
 * The one wind field every moving thing reads: grass, carpet, flowers, bushes,
 * understory, the near tree LODs (foliagePlugin.ts), the motes, the mist banks,
 * the rain and the ambient wind bed. Babylon-free and on BABYLON_FREE_FILES.
 * Renderer-only by design: nothing here may migrate into sim/ or a tunables
 * registry — sway is cosmetic, peers need not agree on phase, and a wind
 * constant in the level id would break invite links.
 *
 * Time is wrapped at WIND_TIME_WRAP seconds and every temporal frequency is an
 * exact multiple of 2π / WIND_TIME_WRAP (`omegaMultiple` is asserted integral
 * in the tests), so the wrap is phase-continuous and the float32 sin()
 * argument in the shader never grows past ~3800.
 */

export const WIND_TIME_WRAP = 300;
/** rad/s: n = 18, 42 and 600 of 2π / 300. The gust pair is unchanged from the retired windField.ts. */
export const WIND_OMEGA_GUST = 0.3769911184;
export const WIND_OMEGA_GUST2 = 0.879645943;
export const WIND_OMEGA_FLUTTER = 12.5663706144;
/** rad/m: a 25 m primary wave (1.5 m/s downwind at Ω1) and a 9 m second octave. */
export const WIND_K1 = (2 * Math.PI) / 25;
export const WIND_K2 = (2 * Math.PI) / 9;
/** Peak-to-peak ragged phase offset per 6 m cell (±0.6 rad). */
export const WIND_RAGGED = 1.2;
export const WIND_RAGGED_CELL = 6;
/** speed = WIND_BASE + WIND_CLOUD·cloudCover + WIND_RAIN·rain, clamped to 1. */
export const WIND_BASE = 0.25;
export const WIND_CLOUD = 0.35;
export const WIND_RAIN = 0.3;
/** Tip lean, gust and flutter amplitudes at speed 1, as fractions of mesh height. */
export const WIND_LEAN_MAX = 0.35;
export const WIND_GUST_MAX = 0.25;
export const WIND_FLUTTER_MAX = 0.04;
/** Direction: a slow turn, one revolution per WIND_DIR_PERIOD seconds from WIND_DIR_BASE. */
export const WIND_DIR_BASE = 0.6;
export const WIND_DIR_PERIOD = 1200;

export type WindRecord = {
  dirX: number;
  dirZ: number;
  speed: number;
  lean: number;
  gustAmp: number;
  flutterAmp: number;
  time: number;
};

/** ω divided by the wrap's fundamental; integral for a phase-continuous wrap. */
export function omegaMultiple(omega: number): number {
  return omega / ((2 * Math.PI) / WIND_TIME_WRAP);
}

export function windSpeedUnder(w: WeatherParams): number {
  return clamp01(WIND_BASE + WIND_CLOUD * clamp01(w.cloudCover) + WIND_RAIN * clamp01(w.rain));
}

export function directionAt(seconds: number): { x: number; z: number } {
  const a = WIND_DIR_BASE + (seconds * 2 * Math.PI) / WIND_DIR_PERIOD;
  return { x: Math.cos(a), z: Math.sin(a) };
}

/** `override`, when given, replaces the weather-driven speed (the /wind command). */
export function windRecordUnder(w: WeatherParams, seconds: number, override?: number): WindRecord {
  const speed = override === undefined ? windSpeedUnder(w) : clamp01(override);
  const d = directionAt(seconds);
  return {
    dirX: d.x,
    dirZ: d.z,
    speed,
    lean: WIND_LEAN_MAX * speed,
    gustAmp: WIND_GUST_MAX * speed,
    flutterAmp: WIND_FLUTTER_MAX * speed,
    time: seconds % WIND_TIME_WRAP,
  };
}

/** The gust the shader evaluates (foliage.vertex.fx `foliageGust`), in [-1.5, 1.5].
 * The ragged term is a golden-ratio lattice hash: multiply-add-fract on cell
 * indices, which GPU and CPU compute to the same 1e-3, unlike a sin() hash. */
export function gustAt(r: WindRecord, x: number, z: number): number {
  const u = r.dirX * x + r.dirZ * z;
  const ci = Math.floor(x / WIND_RAGGED_CELL);
  const cj = Math.floor(z / WIND_RAGGED_CELL);
  const f = ci * 0.618034 + cj * 0.381966;
  const ragged = WIND_RAGGED * (f - Math.floor(f) - 0.5);
  return (
    Math.sin(WIND_K1 * u + WIND_OMEGA_GUST * r.time + ragged) +
    0.5 * Math.sin(WIND_K2 * u + WIND_OMEGA_GUST2 * r.time + 1.7 * ragged)
  );
}
```

`clamp01` lives in `./colour.js`; import it from there if `weather.ts` does not re-export it (check `weather.ts`'s imports and follow them).

- [ ] **Step 4: Add the file to `BABYLON_FREE_FILES`** in `client/test/architecture.test.ts` (keep `windField.ts` there until Task 6).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root client test/game/windParams.test.ts test/architecture.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/windParams.ts client/test/game/windParams.test.ts client/test/architecture.test.ts
git commit -m "feat: the wind record every moving thing will read"
```
(Full message per the `github-push` skill: `## What` paragraph, `## How` list, the trailer.)

---

### Task 2: the foliage plugin and its shaders

**Files:**
- Create: `client/src/game/shaders/foliage.vertex.fx` (definitions), `client/src/game/shaders/foliageWorldPos.vertex.fx` (the world-position block), `client/src/game/shaders/foliage.fragment.fx` (definitions), `client/src/game/shaders/foliageLights.fragment.fx` (the before-lights block), `client/src/game/foliagePlugin.ts`
- Test: `client/test/game/foliagePlugin.test.ts`

**Interfaces:**
- Consumes: `windParams.ts` (constants and `WindRecord`).
- Produces: `FOLIAGE_PROFILES`, `type FoliageProfile`, `attachFoliage(material, profile, meshHeight)`, `setFoliageWind(record, players)`, `setFoliageEdges(material, edges)`, `FoliagePlugin`. `windPlugin.ts` stays untouched until Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/foliagePlugin.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import vertexDefs from "../../src/game/shaders/foliage.vertex.fx?raw";
import vertexWorldPos from "../../src/game/shaders/foliageWorldPos.vertex.fx?raw";
import fragmentLights from "../../src/game/shaders/foliageLights.fragment.fx?raw";
import {
  attachFoliage, setFoliageWind, setFoliageEdges, FoliagePlugin, FOLIAGE_PROFILES,
  FOLIAGE_TILT, FOLIAGE_BEND, FOLIAGE_BEND_R, FOLIAGE_SINK, FOLIAGE_CLUMP_LUMA, FOLIAGE_CLUMP_CELL,
} from "../../src/game/foliagePlugin.js";
import {
  WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER, WIND_K1, WIND_K2, WIND_RAGGED, WIND_RAGGED_CELL,
  windRecordUnder,
} from "../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }

describe("foliage plugin", () => {
  it("attaches once, idempotently, and activates", () => {
    const mat = new PBRMaterial("m", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    const plugin = mat.pluginManager?.getPlugin("Foliage");
    expect(plugin).toBeInstanceOf(FoliagePlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active).toContain(plugin);
  });

  it("injects at the world-position and before-lights hooks only", () => {
    const mat = new PBRMaterial("m2", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const v = plugin.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = plugin.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(v.CUSTOM_VERTEX_UPDATE_POSITION).toBeUndefined();
  });

  it("sets FOLIAGE always and FOLIAGE_TINT only for a tinting profile", () => {
    const grass = new PBRMaterial("g", scene);
    attachFoliage(grass, FOLIAGE_PROFILES.GRASS, 0.4);
    const tree = new PBRMaterial("t", scene);
    attachFoliage(tree, FOLIAGE_PROFILES.TREE, 30);
    const dg: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false };
    (grass.pluginManager!.getPlugin("Foliage") as FoliagePlugin).prepareDefines(dg as never, scene, undefined as never);
    expect(dg).toEqual({ FOLIAGE: true, FOLIAGE_TINT: true });
    const dt: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false };
    (tree.pluginManager!.getPlugin("Foliage") as FoliagePlugin).prepareDefines(dt as never, scene, undefined as never);
    expect(dt).toEqual({ FOLIAGE: true, FOLIAGE_TINT: false });
    // The attribute is pushed only for tinting profiles.
    const ag: string[] = [];
    (grass.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(ag, scene, undefined as never);
    expect(ag).toEqual(["foliage"]);
    const at: string[] = [];
    (tree.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(at, scene, undefined as never);
    expect(at).toEqual([]);
  });

  it("declares the record uniforms, the five-player array and the per-material profile", () => {
    const mat = new PBRMaterial("m3", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.BUSH, 1.2);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const u = plugin.getUniforms();
    const names = u.ubo!.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining([
      "windDir", "windLean", "windGust", "windFlutter", "windTime", "windPlayers", "windEye",
      "foliageAmp", "foliageHeight", "foliageTint", "foliageRootAO", "foliageNormalRoot", "foliageFlags", "foliageEdges",
    ]));
    const players = u.ubo!.find((x: { name: string }) => x.name === "windPlayers") as { arraySize?: number };
    expect(players.arraySize).toBe(5);
    expect(u.vertex).toContain("uniform vec3 windPlayers[5];");
  });

  it("the GLSL constants stay in lockstep with windParams.ts and this module", () => {
    expect(vertexDefs).toContain(`const float WIND_K1 = ${glslFloat(WIND_K1)};`);
    expect(vertexDefs).toContain(`const float WIND_K2 = ${glslFloat(WIND_K2)};`);
    expect(vertexDefs).toContain(`const float WIND_OMEGA1 = ${glslFloat(WIND_OMEGA_GUST)};`);
    expect(vertexDefs).toContain(`const float WIND_OMEGA2 = ${glslFloat(WIND_OMEGA_GUST2)};`);
    expect(vertexDefs).toContain(`const float WIND_OMEGA3 = ${glslFloat(WIND_OMEGA_FLUTTER)};`);
    expect(vertexDefs).toContain(`const float WIND_RAGGED = ${glslFloat(WIND_RAGGED)};`);
    expect(vertexDefs).toContain(`const float WIND_RAGGED_CELL = ${glslFloat(WIND_RAGGED_CELL)};`);
    expect(vertexDefs).toContain(`const float FOLIAGE_CLUMP_CELL = ${glslFloat(FOLIAGE_CLUMP_CELL)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_TILT = ${glslFloat(FOLIAGE_TILT)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BEND = ${glslFloat(FOLIAGE_BEND)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BEND_R = ${glslFloat(FOLIAGE_BEND_R)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_SINK = ${glslFloat(FOLIAGE_SINK)};`);
    expect(fragmentLights).toContain(`const float FOLIAGE_CLUMP_LUMA = ${glslFloat(FOLIAGE_CLUMP_LUMA)};`);
    // The gust closed form, token by token, so it cannot drift from gustAt.
    expect(vertexDefs).toContain("fract(c.x * 0.618034 + c.y * 0.381966) - 0.5");
    expect(vertexDefs).toContain("sin(WIND_K1 * u - WIND_OMEGA1 * t + ragged) + 0.5 * sin(WIND_K2 * u - WIND_OMEGA2 * t + 1.7 * ragged)");
    // Tips move, bases anchored.
    expect(vertexWorldPos).toContain("fH * fH");
    expect(fragmentLights).not.toContain("discard");
    expect(vertexDefs).not.toContain("sampler");
  });

  it("binds the record and the players it was handed", () => {
    const mat = new PBRMaterial("m4", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    setFoliageEdges(mat, [88, 110]);
    const record = windRecordUnder(WEATHER_PRESETS.rain, 12);
    const players = new Float32Array(15).fill(0);
    players[0] = 3; players[2] = 4;
    setFoliageWind(record, players);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const writes: Record<string, unknown> = {};
    const ubo = {
      updateFloat: (n: string, v: number) => { writes[n] = v; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ubo as never, scene, engine, undefined as never);
    expect(writes.windLean).toBeCloseTo(record.lean, 10);
    expect(writes.windTime).toBeCloseTo(record.time, 10);
    expect(writes.windDir).toEqual([record.dirX, record.dirZ]);
    expect(writes.foliageEdges).toEqual([88, 110]);
    expect((writes.windPlayers as number[]).slice(0, 3)).toEqual([3, 0, 4]);
    expect(writes.foliageHeight).toBe(0.4);
  });
});

describe("compiles on both shader paths (the sampler/UBO trap, pinned even with no sampler)", () => {
  async function compiledSources(targetScene: Scene, profileKey: "GRASS" | "TREE"): Promise<{ vertex: string; fragment: string }> {
    const material = new PBRMaterial(`pbr-${profileKey}`, targetScene);
    attachFoliage(material, FOLIAGE_PROFILES[profileKey], 1);
    const mesh = CreateBox(`box-${profileKey}`, {}, targetScene);
    mesh.material = material;
    const subMesh = mesh.subMeshes[0]!;
    await new Promise<void>((resolve) => {
      const tick = () => { if (material.isReadyForSubMesh(mesh, subMesh, false)) resolve(); else setTimeout(tick, 16); };
      tick();
    });
    return { vertex: subMesh.effect?.vertexSourceCode ?? "", fragment: subMesh.effect?.fragmentSourceCode ?? "" };
  }
  for (const version of [1, 2]) {
    it(`webGL ${version}: the record uniforms reach both stages; the attribute only under FOLIAGE_TINT`, async () => {
      const e = new NullEngine();
      (e as unknown as { _webGLVersion: number })._webGLVersion = version;
      const s = new Scene(e);
      try {
        const grass = await compiledSources(s, "GRASS");
        for (const name of ["windDir", "windLean", "windGust", "windTime", "windPlayers", "foliageEdges"]) expect(grass.vertex).toContain(name);
        for (const name of ["foliageTint", "foliageRootAO", "foliageNormalRoot", "vFoliageH"]) expect(grass.fragment).toContain(name);
        const tree = await compiledSources(s, "TREE");
        // A non-instanced box: no THIN_INSTANCES, so neither profile declares the attribute.
        expect(tree.vertex).not.toContain("attribute vec4 foliage;");
        expect(grass.vertex).not.toContain("attribute vec4 foliage;");
      } finally {
        s.dispose();
        e.dispose();
      }
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root client test/game/foliagePlugin.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Write the four shader files**

```glsl
// client/src/game/shaders/foliage.vertex.fx
// Foliage vertex definitions, spliced by FoliagePlugin (foliagePlugin.ts) at
// CUSTOM_VERTEX_DEFINITIONS. The record uniforms are declared by the plugin
// before this text (the declaration include precedes the custom definitions
// in Babylon's PBR vertex source), so the function below may read windDir.
// Every constant mirrors windParams.ts and a lockstep test asserts they agree.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
#ifdef FOLIAGE
#ifdef FOLIAGE_TINT
#ifdef THIN_INSTANCES
attribute vec4 foliage;
#endif
#endif
varying vec4 vFoliage;
varying float vFoliageH;
varying float vFoliageClump;
varying float vFoliageDist;

const float WIND_K1 = 0.25132741228718347;
const float WIND_K2 = 0.6981317007977318;
const float WIND_OMEGA1 = 0.3769911184;
const float WIND_OMEGA2 = 0.879645943;
const float WIND_OMEGA3 = 12.5663706144;
const float WIND_RAGGED = 1.2;
const float WIND_RAGGED_CELL = 6.0;
const float FOLIAGE_CLUMP_CELL = 1.5;

// Mirrors gustAt in windParams.ts: two octaves whose phase is the position
// projected onto the wind direction, plus a lattice hash so the front is
// ragged rather than a stripe.
float foliageGust(vec2 p, float t) {
  float u = windDir.x * p.x + windDir.y * p.y;
  vec2 c = floor(p / WIND_RAGGED_CELL);
  float ragged = WIND_RAGGED * (fract(c.x * 0.618034 + c.y * 0.381966) - 0.5);
  return sin(WIND_K1 * u - WIND_OMEGA1 * t + ragged) + 0.5 * sin(WIND_K2 * u - WIND_OMEGA2 * t + 1.7 * ragged);
}
#endif
```

The literal for `WIND_K1` must be exactly what `${WIND_K1}` prints in JavaScript (`0.25132741228718347`); the lockstep test enforces it. Same for `WIND_K2`.

```glsl
// client/src/game/shaders/foliageWorldPos.vertex.fx
// The foliage world-position block, spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS,
// after the thin-instance matrix: worldPos, positionUpdated and finalWorld
// are in scope. Order: clump hash, motion weight, lean, gust (phased at the
// instance origin so a tuft moves as one), flutter (phased at the vertex so
// blades break up), camera tilt, player bend, far sink.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_TILT = 0.04;
  const float FOLIAGE_BEND = 0.25;
  const float FOLIAGE_BEND_R = 0.6;
  const float FOLIAGE_SINK = 0.5;
  vec2 fOrigin = finalWorld[3].xz;
  float fH = clamp(positionUpdated.y / foliageHeight, 0.0, 1.0);
  float fH2 = fH * fH;
  float fDist = distance(fOrigin, windEye.xz);
  vec2 fCell = floor(fOrigin / FOLIAGE_CLUMP_CELL);
  float fClump = fract(fCell.x * 0.618034 + fCell.y * 0.381966);
  float fM = foliageAmp * fH2 * foliageHeight * (1.0 - smoothstep(foliageEdges.x, foliageEdges.y, fDist));
  vec3 fDir = vec3(windDir.x, 0.0, windDir.y);
  float fGust = foliageGust(fOrigin, windTime + 0.6 * (fClump - 0.5));
  worldPos.xyz += fDir * (windLean + windGust * fGust) * fM;
  float fFlutter = sin(2.1 * worldPos.x + 1.7 * worldPos.z + WIND_OMEGA3 * windTime);
  worldPos.xz += windFlutter * fM * fFlutter * vec2(0.75, -0.35);
  if (foliageFlags.x > 0.5) {
    vec2 fAway = fOrigin - windEye.xz;
    worldPos.xz += FOLIAGE_TILT * fH2 * fAway / max(length(fAway), 1.0e-3);
  }
  if (foliageFlags.y > 0.5) {
    for (int i = 0; i < 5; i++) {
      vec2 fD = fOrigin - windPlayers[i].xz;
      float fL = length(fD);
      float fW = 1.0 - clamp(fL / FOLIAGE_BEND_R, 0.0, 1.0);
      worldPos.xz += (fD / max(fL, 1.0e-3)) * (FOLIAGE_BEND * fH2 * fW * fW);
    }
  }
#ifdef FOLIAGE_TINT
  worldPos.y -= FOLIAGE_SINK * foliageHeight * smoothstep(foliageEdges.x, foliageEdges.y, fDist);
#ifdef THIN_INSTANCES
  vFoliage = foliage;
#else
  vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
#endif
#else
  vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
#endif
  vFoliageH = fH;
  vFoliageClump = fClump;
  vFoliageDist = fDist;
}
#endif
```

```glsl
// client/src/game/shaders/foliage.fragment.fx
// Foliage fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varyings the vertex block wrote. No sampler, no function.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
varying vec4 vFoliage;
varying float vFoliageH;
varying float vFoliageClump;
varying float vFoliageDist;
#endif
```

```glsl
// client/src/game/shaders/foliageLights.fragment.fx
// The foliage colour and normal block, spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS,
// where surfaceAlbedo, normalW and viewDirectionW are established and no
// light has run: root darkening, the ground tint (strongest at the root,
// more with distance), the canopy shade, a per-clump luminance nudge, then
// the normal blended toward the ground's up at the root and forced to face
// the viewer so a card never lights as its back. No discard.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_CLUMP_LUMA = 0.16;
  surfaceAlbedo *= mix(foliageRootAO, 1.0, vFoliageH);
  float fRoot = (1.0 - vFoliageH) * (1.0 - vFoliageH);
  float fTintW = foliageTint * fRoot * (1.0 + 0.5 * smoothstep(20.0, 80.0, vFoliageDist));
  surfaceAlbedo = mix(surfaceAlbedo, vFoliage.rgb, clamp(fTintW, 0.0, 0.85));
  surfaceAlbedo *= vFoliage.a;
  surfaceAlbedo *= 1.0 + FOLIAGE_CLUMP_LUMA * (vFoliageClump - 0.5);
  normalW = normalize(mix(vec3(0.0, 1.0, 0.0), normalW, mix(foliageNormalRoot, 1.0, vFoliageH)));
  normalW = faceforward(normalW, -viewDirectionW, normalW);
}
#endif
```

- [ ] **Step 4: Write the plugin**

```ts
// client/src/game/foliagePlugin.ts
/**
 * The foliage plugin: everything the vertex stage does to a card or a crown
 * (lean, gust, flutter, camera tilt, player bend, far sink) and everything
 * the fragment stage does to ground it (root darkening, ground tint, canopy
 * shade, clump variation, a rounded normal). Replaces windPlugin.ts. The wind
 * arrives as one WindRecord per frame through `setFoliageWind`, computed by
 * windParams.ts; the ground colour arrives as the per-instance `foliage`
 * attribute clutterMeshes.ts writes. Renderer-only: nothing here may migrate
 * into sim/ or a tunables registry.
 *
 * Injection points: CUSTOM_VERTEX_DEFINITIONS + CUSTOM_VERTEX_UPDATE_WORLDPOS
 * (after the thin-instance matrix, so finalWorld[3] is the instance origin)
 * and CUSTOM_FRAGMENT_DEFINITIONS + CUSTOM_FRAGMENT_BEFORE_LIGHTS. The GLSL
 * lives in shaders/foliage*.fx so shaderHygiene.test.ts covers it.
 */
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import vertexDefs from "./shaders/foliage.vertex.fx?raw";
import vertexWorldPos from "./shaders/foliageWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/foliage.fragment.fx?raw";
import fragmentLights from "./shaders/foliageLights.fragment.fx?raw";
import type { WindRecord } from "./windParams.js";
import { FADE_NONE_OUT } from "./distanceFadePlugin.js";

/** Mirrored in the .fx files; the lockstep test asserts it. */
export const FOLIAGE_TILT = 0.04;
export const FOLIAGE_BEND = 0.25;
export const FOLIAGE_BEND_R = 0.6;
export const FOLIAGE_SINK = 0.5;
export const FOLIAGE_CLUMP_LUMA = 0.16;
export const FOLIAGE_CLUMP_CELL = 1.5;
export const FOLIAGE_PLAYERS = 5;

export type FoliageProfile = {
  /** Unitless multiplier on the record's fractions (grass 0.06 m of tip = 1). */
  amp: number;
  /** Ground-tint weight at the root; > 0 turns on FOLIAGE_TINT and the attribute. */
  groundTint: number;
  /** Albedo factor at the root. */
  rootAO: number;
  /** Weight of the card's own normal at the root (0 = the ground's up). */
  normalRoot: number;
  tilt: boolean;
  bend: boolean;
};

export const FOLIAGE_PROFILES = {
  GRASS: { amp: 1.0, groundTint: 0.6, rootAO: 0.45, normalRoot: 0, tilt: true, bend: true },
  MEADOW: { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true },
  FLOWER: { amp: 0.83, groundTint: 0.4, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true },
  BUSH: { amp: 0.5, groundTint: 0.3, rootAO: 0.6, normalRoot: 0, tilt: false, bend: true },
  UNDERSTORY: { amp: 0.67, groundTint: 0.4, rootAO: 0.55, normalRoot: 0, tilt: false, bend: true },
  TREE: { amp: 0.33, groundTint: 0, rootAO: 1, normalRoot: 0.6, tilt: false, bend: false },
} as const satisfies Record<string, FoliageProfile>;

// Module-level like skin.ts: every material's plugin instance reads one truth,
// written once per frame by the renderer.
let wind: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
/** 5 × xyz; unused slots parked far below the world. */
const players = new Float32Array(FOLIAGE_PLAYERS * 3);
for (let i = 0; i < FOLIAGE_PLAYERS; i++) players[i * 3 + 1] = -1e6;

export function setFoliageWind(record: WindRecord, positions: Float32Array): void {
  wind = record;
  players.set(positions.subarray(0, FOLIAGE_PLAYERS * 3));
}

export class FoliagePlugin extends MaterialPluginBase {
  private readonly _profile: FoliageProfile;
  private readonly _meshHeight: number;
  /** Outer fade of the bucket, set by the shell; motion reaches zero at .y. */
  edges: readonly [number, number] = FADE_NONE_OUT;

  constructor(material: Material, profile: FoliageProfile, meshHeight: number) {
    super(material, "Foliage", 200, { FOLIAGE: false, FOLIAGE_TINT: false });
    this._profile = profile;
    this._meshHeight = meshHeight;
    this._enable(true);
  }

  override getClassName(): string {
    return "FoliagePlugin";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.FOLIAGE = true;
    defines.FOLIAGE_TINT = this._profile.groundTint > 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    if (this._profile.groundTint > 0) attributes.push("foliage");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string; arraySize?: number }[]; vertex: string; fragment: string } {
    return {
      ubo: [
        { name: "windDir", size: 2, type: "vec2" },
        { name: "windLean", size: 1, type: "float" },
        { name: "windGust", size: 1, type: "float" },
        { name: "windFlutter", size: 1, type: "float" },
        { name: "windTime", size: 1, type: "float" },
        { name: "windEye", size: 3, type: "vec3" },
        { name: "windPlayers", size: 3, type: "vec3", arraySize: FOLIAGE_PLAYERS },
        { name: "foliageAmp", size: 1, type: "float" },
        { name: "foliageHeight", size: 1, type: "float" },
        { name: "foliageTint", size: 1, type: "float" },
        { name: "foliageRootAO", size: 1, type: "float" },
        { name: "foliageNormalRoot", size: 1, type: "float" },
        { name: "foliageFlags", size: 2, type: "vec2" },
        { name: "foliageEdges", size: 2, type: "vec2" },
      ],
      vertex: `
#ifdef FOLIAGE
uniform vec2 windDir;
uniform float windLean;
uniform float windGust;
uniform float windFlutter;
uniform float windTime;
uniform vec3 windEye;
uniform vec3 windPlayers[5];
uniform float foliageAmp;
uniform float foliageHeight;
uniform vec2 foliageFlags;
uniform vec2 foliageEdges;
#endif
`,
      fragment: `
#ifdef FOLIAGE
uniform float foliageTint;
uniform float foliageRootAO;
uniform float foliageNormalRoot;
#endif
`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    const p = this._profile;
    const eye = scene.activeCamera?.globalPosition;
    uniformBuffer.updateFloat2("windDir", wind.dirX, wind.dirZ);
    uniformBuffer.updateFloat("windLean", wind.lean);
    uniformBuffer.updateFloat("windGust", wind.gustAmp);
    uniformBuffer.updateFloat("windFlutter", wind.flutterAmp);
    uniformBuffer.updateFloat("windTime", wind.time);
    uniformBuffer.updateFloat3("windEye", eye?.x ?? 0, eye?.y ?? 0, eye?.z ?? 0);
    uniformBuffer.updateFloatArray("windPlayers", players);
    uniformBuffer.updateFloat("foliageAmp", p.amp);
    uniformBuffer.updateFloat("foliageHeight", this._meshHeight);
    uniformBuffer.updateFloat("foliageTint", p.groundTint);
    uniformBuffer.updateFloat("foliageRootAO", p.rootAO);
    uniformBuffer.updateFloat("foliageNormalRoot", p.normalRoot);
    uniformBuffer.updateFloat2("foliageFlags", p.tilt ? 1 : 0, p.bend ? 1 : 0);
    uniformBuffer.updateFloat2("foliageEdges", this.edges[0], this.edges[1]);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs, CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights };
    }
    return null;
  }
}

/** Attach once per material; later calls are no-ops (LOD buckets share materials). */
export function attachFoliage(material: Material, profile: FoliageProfile, meshHeight: number): void {
  if (material.pluginManager?.getPlugin("Foliage")) return;
  new FoliagePlugin(material, profile, meshHeight);
}

/** The bucket's outer fade: motion weight reaches zero at `edges[1]`, and tinting
 * profiles sink across it. Materials without the plugin are ignored. */
export function setFoliageEdges(material: Material, edges: readonly [number, number]): void {
  const plugin = material.pluginManager?.getPlugin("Foliage") as FoliagePlugin | undefined;
  if (plugin) plugin.edges = edges;
}
```

Checked against the installed Babylon: `UniformBuffer.updateFloatArray(name, Float32Array)` is the array setter (`updateArray` takes a plain `number[]`; `Materials/uniformBuffer.d.ts:85,91`); uniform arrays in `getUniforms().ubo` are declared through `arraySize` (`materialPluginManager.pure.js:211`); `preLightingInfo` carries `L` and `NdotLUnclamped`; the declaration include (`__decl__pbrVertex`, line 44 of `pbr.vertex.js`) precedes `CUSTOM_VERTEX_DEFINITIONS` (line 134), so `foliageGust` may read `windDir`; `faceforward` and `fract` are GLSL ES 1.00 core. `?raw` imports of `.fx` follow `atmosphere.ts` and `skin.ts`.

The `edges` field being per material means a card GLB whose two LOD buckets share one material gets ONE edge pair; Task 3 sets the far bucket's edges (the near bucket's sink then starts at the disc edge too, which is past its own seam and therefore harmless). Record this in the file comment.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root client test/game/foliagePlugin.test.ts test/game/shaderHygiene.test.ts`
Expected: PASS (the hygiene test picks up the four new `.fx` files by glob).

- [ ] **Step 6: Commit**

```bash
git add client/src/game/foliagePlugin.ts client/src/game/shaders/foliage.vertex.fx client/src/game/shaders/foliageWorldPos.vertex.fx client/src/game/shaders/foliage.fragment.fx client/src/game/shaders/foliageLights.fragment.fx client/test/game/foliagePlugin.test.ts
git commit -m "feat: the foliage plugin that grounds a card and moves it with the wind"
```

---

### Task 3: the clutter writes the attribute and wears the plugin; `windPlugin.ts` retires

**Files:**
- Modify: `client/src/game/clutterMeshes.ts` (imports at ~62, `WIND_AMPS` ~118, `Bucket` type ~171, `ensureCapacity` ~234, `applyBucket` ~265, the rebuild write loop ~392–407, `adopt` ~504–540)
- Modify: `client/src/game/forestMeshes.ts` (the understory attach at ~843–851)
- Delete: `client/src/game/windPlugin.ts`, `client/test/game/windPlugin.test.ts`
- Test: `client/test/game/clutterMeshes.test.ts`

**Interfaces:**
- Consumes: `attachFoliage`, `setFoliageEdges`, `FOLIAGE_PROFILES`; `surfaceAlbedo(seed, x, z, altitude, slope, canopy)` from `./terrainSurface.js`; `forestDensity(seed, x, z)` from `../sim/vegetation.js`; `clutterFadeEdges` (already imported).
- Produces: the `foliage` thin-instance buffer on every tinting class's buckets.

- [ ] **Step 1: Write the failing tests** (append to `client/test/game/clutterMeshes.test.ts`; follow its existing `assets` escape-hatch setup to build bucket meshes under NullEngine)

```ts
import { FOLIAGE_PROFILES, FoliagePlugin } from "../../src/game/foliagePlugin.js";
import { surfaceAlbedo } from "../../src/game/terrainSurface.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import { clutterFadeEdges } from "../../src/game/clutterField.js";
import { CLUTTER_GRASS, CLUTTER_ROCK } from "../../src/sim/clutter.js";

describe("foliage attribute and plugin", () => {
  it("attaches the foliage plugin to the swaying classes only, with the far bucket's edges", () => {
    const { meshes, assets } = buildWithAssets(); // the file's existing helper that returns the bucket meshes per class/variant/lod
    const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
    const rockNear = assets[CLUTTER_ROCK]![0]![0]![0]!;
    const plugin = grassNear.material!.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(plugin).toBeInstanceOf(FoliagePlugin);
    expect(rockNear.material!.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
    const edge = clutterFadeEdges(CLUTTER_GRASS);
    expect(plugin.edges).toEqual([edge.start, edge.end]);
    meshes.dispose();
  });

  it("writes the ground colour and the canopy shade per grass instance", () => {
    const { meshes, assets, seed } = buildWithAssets();
    meshes.update(0, 0);
    const grassNear = assets[CLUTTER_GRASS]![0]![0]![0]!;
    const count = grassNear.thinInstanceCount;
    expect(count).toBeGreaterThan(0);
    const foliage = grassNear.thinInstanceGetBuffer("foliage") as Float32Array;  // or the Bucket's own buffer via a test-only accessor
    const matrices = grassNear.thinInstanceGetBuffer("matrix") as Float32Array;
    for (let i = 0; i < Math.min(count, 8); i++) {
      const x = matrices[i * 16 + 12]!, z = matrices[i * 16 + 14]!;
      const shade = foliage[i * 4 + 3]!;
      expect(shade).toBeCloseTo(1 - 0.5 * forestDensity(seed, x, z), 5);
      // RGB is the palette colour surfaceAlbedo returns for that spot (the
      // exact altitude/slope inputs are the instance's own, so compare to a
      // recomputation from the same instance record the shell used).
      expect(foliage[i * 4]!).toBeGreaterThanOrEqual(0);
      expect(foliage[i * 4]!).toBeLessThanOrEqual(1);
    }
    meshes.dispose();
  });
});
```

Exact assertions on RGB need the instance's `groundH` and slope; expose them through the test-only path the file already uses for `fadeBands` (look at how the existing tests read `fadeBands` per instance and mirror it). If `thinInstanceGetBuffer` is not available for custom kinds, read the `Bucket` through the existing test accessor.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root client test/game/clutterMeshes.test.ts`
Expected: FAIL, no `Foliage` plugin.

- [ ] **Step 3: Implement in `clutterMeshes.ts`**

1. Replace the `windPlugin.js` import with
   `import { attachFoliage, setFoliageEdges, FOLIAGE_PROFILES, type FoliageProfile } from "./foliagePlugin.js";`
   and add `import { surfaceAlbedo } from "./terrainSurface.js";` and `import { forestDensity } from "../sim/vegetation.js";`.
2. Replace `WIND_AMPS` with
   ```ts
   const FOLIAGE_BY_CLASS = new Map<number, FoliageProfile>([
     [CLUTTER_GRASS, FOLIAGE_PROFILES.GRASS],
     [CLUTTER_MEADOW, FOLIAGE_PROFILES.MEADOW],
     [CLUTTER_FLOWER, FOLIAGE_PROFILES.FLOWER],
     [CLUTTER_BUSH, FOLIAGE_PROFILES.BUSH],
   ]);
   ```
3. `Bucket` gains `foliage: Float32Array` (4 floats per instance, capacity tracks `buf`) and `tints: boolean`. `ensureCapacity` allocates `bucket.foliage = new Float32Array(capacity / 4)` beside `bands`. `applyBucket` sets/updates the `"foliage"` buffer exactly as `"fadeBands"`, only when `bucket.tints`.
4. A writer beside `writeInstanceMatrix`:
   ```ts
   /** Ground colour at the instance (the palette the clipmap bakes into vertex
    * colour, so grass and ground can never disagree) and the canopy shade the
    * bush palette used to carry by hand. slope = |∇h|; canopy = forestDensity. */
   function writeFoliage(seed: number, inst: ClutterInstance, buf: Float32Array, offset: number): void {
     const slope = Math.sqrt(inst.groundDx * inst.groundDx + inst.groundDz * inst.groundDz);
     const canopy = forestDensity(seed, inst.x, inst.z);
     const c = surfaceAlbedo(seed, inst.x, inst.z, inst.groundH, slope, canopy);
     buf[offset] = c.r; buf[offset + 1] = c.g; buf[offset + 2] = c.b;
     buf[offset + 3] = 1 - 0.5 * canopy;
   }
   ```
   Check `surfaceAlbedo`'s slope convention against `clipmap.ts`'s call (it may want the gradient magnitude or `atan`); copy whatever the clipmap passes so grass and ground agree by construction.
5. In both rebuild write loops, after `writeFadeBands`, `if (bucket.tints) writeFoliage(seed, inst, bucket.foliage, bucket.count * 4);`.
6. In `adopt`, replace the `WIND_AMPS` block with
   ```ts
   const profile = FOLIAGE_BY_CLASS.get(cls);
   if (profile !== undefined) {
     for (const mesh of meshes) {
       if (mesh.material) {
         mesh.refreshBoundingInfo();
         attachFoliage(mesh.material, profile, mesh.getBoundingInfo().boundingBox.maximum.y);
         if (lod === FAR_LOD) setFoliageEdges(mesh.material, [edge.start, edge.end]);
       }
     }
   }
   ```
   (`edge` is computed just below in the existing code; hoist it above.) The bucket record gets `tints: profile !== undefined, foliage: EMPTY_BUFFER`.
7. The file-head comment: replace the wind sentence with one on the foliage plugin and the `foliage` attribute.

- [ ] **Step 4: `forestMeshes.ts` understory**: replace `attachWind(mesh.material, WIND_AMP_UNDERSTORY, …)` with `attachFoliage(mesh.material, FOLIAGE_PROFILES.UNDERSTORY, …)` and the import; delete the "understory only" comment's claim about trees only in Task 4.

- [ ] **Step 5: Delete `windPlugin.ts` and `windPlugin.test.ts`**; grep for `attachWind|WIND_AMP_|windPlugin` and fix every remaining reference (`forestMeshes.ts`, `motesParams.ts` still imports `windField.ts`, which stays until Task 6).

- [ ] **Step 6: Run**

Run: `npm run typecheck && npx vitest run --root client test/game/clutterMeshes.test.ts test/game/forestMeshes.test.ts test/game/foliagePlugin.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/clutterMeshes.ts client/src/game/forestMeshes.ts client/test/game/clutterMeshes.test.ts
git rm client/src/game/windPlugin.ts client/test/game/windPlugin.test.ts
git commit -m "feat: clutter carries its ground colour and wears the foliage plugin"
```

---

### Task 4: the trees sway

**Files:**
- Modify: `client/src/game/forestMeshes.ts` (`adoptSpecies` ~836–900)
- Test: `client/test/game/forestMeshes.test.ts`

**Interfaces:**
- Consumes: `attachFoliage`, `setFoliageEdges`, `FOLIAGE_PROFILES.TREE`, `SEAM_LOD1` (already imported).

- [ ] **Step 1: Write the failing test** (in the existing NullEngine `assets` setup of `forestMeshes.test.ts`)

```ts
it("attaches the foliage plugin to LOD0 and LOD1 of giants and saplings, never LOD2 or the impostor", () => {
  const { meshes, species } = buildWithAssets();
  for (const s of species) {
    for (const lod of [0, 1]) for (const m of s.lods[lod]) expect(m.material!.pluginManager?.getPlugin("Foliage")).toBeTruthy();
    for (const m of s.lods[2]) expect(m.material!.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
  }
  const lod1 = species[0]!.lods[1][0]!.material!.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
  expect(lod1.edges).toEqual(SEAM_LOD1);
  for (const plane of meshes.impostorPlanes()) expect(plane.material!.pluginManager?.getPlugin("Foliage") ?? null).toBeNull();
  meshes.dispose();
});
```

Adapt the accessor names to what the test file already exposes for species buckets and impostor planes; do not add a production accessor only for the test if one exists.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Implement** in `adoptSpecies`, after the conform/fade loop over `lods.flat()`:

```ts
// Wind on the crowns: LOD0 and LOD1 carry the foliage plugin at the tree
// profile (whole-tree bend by height fraction squared, so trunks stay
// planted). LOD2, the snag and the impostor plane stay rigid, and LOD1's
// motion reaches zero across SEAM_LOD1 so nothing pops against them. The
// shadow depth pass does not run the plugin: casters draw unswayed, which at a
// 2 % tip lean is under a shadow-map texel at the cascade distances involved.
for (const lod of [0, 1] as const) {
  for (const mesh of lods[lod]) {
    if (mesh.material) {
      mesh.refreshBoundingInfo();
      attachFoliage(mesh.material, FOLIAGE_PROFILES.TREE, mesh.getBoundingInfo().boundingBox.maximum.y);
      if (lod === 1) setFoliageEdges(mesh.material, SEAM_LOD1);
    }
  }
}
```

If a GLB shares one material across LOD0 and LOD1 (check with `lods[0][0].material === lods[1][0].material`), the single plugin's `edges` is `SEAM_LOD1` for both, which is correct: LOD0 is entirely inside it. If LOD2 shares that material too, LOD2 would sway; in that case clone the material for LOD2 (`material.clone`) before attaching, and note it in the comment. Update the "understory only" comment above.

- [ ] **Step 4: Run** `npx vitest run --root client test/game/forestMeshes.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat: the crowns move with the same wind as the grass`.

---

### Task 5: translucency on the sun

**Files:**
- Create: `client/src/game/foliageLightPlugin.ts`, `client/src/game/shaders/foliageDiffuse.fragment.fx`
- Modify: `client/src/game/clutterMeshes.ts` (`adopt`: attach beside `attachFoliage`), `client/src/game/forestMeshes.ts` (understory only)
- Test: `client/test/game/foliageLightPlugin.test.ts`

**Interfaces:**
- Consumes: the `vFoliageH` varying (Task 2), `lighting.ts`'s light order (sun first).
- Produces: `attachFoliageLight(material)`, `FOLIAGE_LIGHT_INJECTION_POINT`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/foliageLightPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import "@babylonjs/core/Shaders/ShadersInclude/lightFragment.js";
import diffuseFx from "../../src/game/shaders/foliageDiffuse.fragment.fx?raw";
import { attachFoliageLight, FOLIAGE_LIGHT_INJECTION_POINT, FOLIAGE_WRAP } from "../../src/game/foliageLightPlugin.js";
import { createLighting } from "../../src/game/lighting.js";

let engine: NullEngine; let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

describe("foliage light plugin", () => {
  it("anchors on Babylon's per-light diffuse line and captures the light index", () => {
    const include = ShaderStore.IncludesShadersStore["lightFragment"] as string;
    const re = new RegExp(FOLIAGE_LIGHT_INJECTION_POINT.slice(1));
    const m = re.exec(include);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("diffuse{X}.rgb");
    expect(m![2]).toBe("{X}");
  });
  it("the sun is light 0", () => {
    const s = new Scene(new NullEngine());
    createLighting(s, /* whatever createLighting's signature needs; see lighting.test.ts */);
    expect(s.lights[0]!.name).toBe("sun");
    s.getEngine().dispose();
  });
  it("attaches idempotently and only modifies the fragment", () => {
    const mat = new PBRMaterial("m", scene);
    attachFoliageLight(mat);
    attachFoliageLight(mat);
    const plugin = mat.pluginManager!.getPlugin("FoliageLight")!;
    expect(plugin.getCustomCode("vertex")).toBeNull();
    const f = plugin.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(diffuseFx);
    expect(f[FOLIAGE_LIGHT_INJECTION_POINT]).toContain("foliageDiffuseLighting(preInfo,$1,float($2),vFoliageH,viewDirectionW)");
  });
  it("the wrap term never exceeds Lambert at full light and returns the stock result off the sun", () => {
    expect(diffuseFx).toContain("if (lightIndex > 0.5) {");
    expect(diffuseFx).toContain(`const float FOLIAGE_WRAP = ${FOLIAGE_WRAP};`);
    // (ndotl + w) / ((1 + w)^2) ≤ ndotl for ndotl = 1: 1/(1+w) ≤ 1.
    expect((1 + FOLIAGE_WRAP) / ((1 + FOLIAGE_WRAP) * (1 + FOLIAGE_WRAP))).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Write the shader**

```glsl
// client/src/game/shaders/foliageDiffuse.fragment.fx
// Foliage diffuse, spliced into the PBR fragment by FoliageLightPlugin at
// CUSTOM_FRAGMENT_DEFINITIONS and called from every per-light diffuse line
// with that light's index. Only the sun (index 0) is changed: an energy-
// conserving wrap Lambert plus a backlight term that glows when the light is
// behind the card and the viewer in front, thicker at the root. Other lights
// return Babylon's own result untouched. The plugin is only attached to
// materials that also carry the foliage plugin, which declares vFoliageH.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

const float FOLIAGE_WRAP = 0.35;
const float FOLIAGE_BACK = 0.6;
const float FOLIAGE_BACK_POWER = 4.0;
const float FOLIAGE_PI = 3.14159265;

float foliageWrapLambert(float ndotl, float wrap) {
  return clamp((ndotl + wrap) / ((1.0 + wrap) * (1.0 + wrap)), 0.0, 1.0);
}

vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float lightIndex, float h, vec3 viewDir) {
  vec3 base = computeDiffuseLighting(info, lightColor);
  if (lightIndex > 0.5) {
    return base;
  }
  vec3 unit = info.attenuation * lightColor / FOLIAGE_PI;
  vec3 wrapped = unit * foliageWrapLambert(info.NdotLUnclamped, FOLIAGE_WRAP);
  float back = pow(clamp(-dot(viewDir, info.L), 0.0, 1.0), FOLIAGE_BACK_POWER);
  float thickness = 1.0 - 0.7 * h;
  return wrapped + unit * FOLIAGE_BACK * back * thickness;
}
```

Verify `preLightingInfo` carries `L` and `NdotLUnclamped` in 9.18 (`Shaders/ShadersInclude/pbrDirectLightingSetupFunctions.js`); if the field is named differently, use it and pin the name in the test.

- [ ] **Step 4: Write the plugin** on the `skin.ts` shape (priority 210, fragment-only, no uniforms):

```ts
export const FOLIAGE_WRAP = 0.35;
export const FOLIAGE_LIGHT_INJECTION_POINT =
  "!info\\.diffuse=computeDiffuseLighting\\(preInfo,(diffuse(\\d+|\\{X\\})\\.rgb)\\);";
const FOLIAGE_LIGHT_INJECTION_CODE =
  "info.diffuse=foliageDiffuseLighting(preInfo,$1,float($2),vFoliageH,viewDirectionW);";
```

`attachFoliageLight(material)` returns early unless `material.pluginManager?.getPlugin("Foliage")` exists (the shader needs `vFoliageH`), and is idempotent by name `"FoliageLight"`. Both custom-code keys are fragment-only.

- [ ] **Step 5: Attach** in `clutterMeshes.ts`'s `adopt` right after `attachFoliage` for the four card classes, and in `forestMeshes.ts` for the understory (not trees).

- [ ] **Step 6: Run** `npm run typecheck && npx vitest run --root client test/game/foliageLightPlugin.test.ts test/game/clutterMeshes.test.ts test/game/shaderHygiene.test.ts` → PASS.

- [ ] **Step 7: Commit** `feat: low sun glows through the grass`.

---

### Task 6: motes, mist and rain read the record; `windField.ts` retires

**Files:**
- Modify: `client/src/game/motesParams.ts` (`windAt`, `motesUnder`), `client/src/game/motes.ts` (`update` signature), `client/src/game/mistMeshes.ts` (`update`), `client/src/game/rain.ts` (`update`)
- Delete: `client/src/game/windField.ts`
- Modify: `client/test/architecture.test.ts` (remove `windField.ts`)
- Test: `client/test/game/motesParams.test.ts`, `motes.test.ts`, `mistMeshes.test.ts`, `rain.test.ts`

**Interfaces:**
- Consumes: `WindRecord`, `gustAt`.
- Produces: `motesUnder(w, hour, air, tier, wind: WindRecord)`, `motes.update(camPos, w, hour, air, wind)`, `mist.update(camX, camZ, w, air, wind, seconds)`, `rain.update(camPos, w, wind)`; constants `MOTE_WIND_DRIFT`, `MIST_DRIFT`, `RAIN_SLANT`.

- [ ] **Step 1: Write the failing tests**

```ts
// motesParams.test.ts — replace the windAt(t) test
it("drifts downwind with the gust and stands still at speed 0", () => {
  const still = windRecordUnder(WEATHER_PRESETS.clear, 0, 0);
  expect(windAt(still)).toEqual({ x: 0, z: 0 });
  const blowing = { ...windRecordUnder(WEATHER_PRESETS.rain, 7), dirX: 1, dirZ: 0 };
  const d = windAt(blowing);
  expect(d.z).toBe(0);
  expect(Math.abs(d.x)).toBeGreaterThan(0);
  expect(Math.abs(d.x)).toBeLessThanOrEqual(MOTE_WIND_DRIFT * (0.4 + 0.6) * 1.25 + 1e-9);
});

// mistMeshes.test.ts — add
it("banks drift downwind by MIST_DRIFT·speed·t and wrap inside their cell", () => {
  // Two updates 10 s apart at speed 1 along +x: every enabled quad moved by
  // 2.5 m in x, none by more than a cell.
});

// rain.test.ts — add
it("slants downwind by RAIN_SLANT·speed", () => {
  const wind = { ...windRecordUnder(WEATHER_PRESETS.rain, 0), dirX: 0, dirZ: 1 };
  rain.update({ x: 0, y: 0, z: 0 }, WEATHER_PRESETS.rain, wind);
  expect((rain.system.direction1.z + rain.system.direction2.z) / 2).toBeCloseTo(RAIN_SLANT * wind.speed, 6);
  expect(rain.system.direction1.y).toBe(-RAIN_FALL_SPEED);
});
```

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

`motesParams.ts`:
```ts
import { gustAt, type WindRecord } from "./windParams.js";
/** Peak drift, m/s, at speed 1 on the gust crest. */
export const MOTE_WIND_DRIFT = 0.6;
/** Horizontal drift: downwind, scaled by speed, breathing with the gust at the origin. */
export function windAt(r: WindRecord): { x: number; z: number } {
  if (r.speed === 0) return { x: 0, z: 0 };
  const g = MOTE_WIND_DRIFT * (0.4 + 0.6 * r.speed) * (0.5 + 0.5 * gustAt(r, 0, 0));
  return { x: r.dirX * g, z: r.dirZ * g };
}
export function motesUnder(w, hour, air, tier, wind: WindRecord): MotesRecord { /* as before, with windAt(wind) */ }
```
`motes.ts`: `update(camPos, w, hour, air, wind)` passes `wind` through; the internal `start`/`t` clock goes away.

`mistMeshes.ts`: `update(camX, camZ, w, air, wind, seconds)`; per bank, `const off = MIST_DRIFT * wind.speed * seconds;` then position `x = bank.x + wrap(off * wind.dirX)`, `z = bank.z + wrap(off * wind.dirZ)` where `wrap(v) = ((v + MIST_CELL / 2) % MIST_CELL + MIST_CELL) % MIST_CELL - MIST_CELL / 2`, so a bank wanders within ±48 m of its seeded spot and never leaves its cell. `export const MIST_DRIFT = 0.25;`

`rain.ts`: `update(camPos, w, wind)` sets `direction1 = (wind.dirX·RAIN_SLANT·speed − 0.5, −RAIN_FALL_SPEED, wind.dirZ·RAIN_SLANT·speed − 0.2)` and `direction2` with `+0.5, +0.2`, writing into the existing `Vector3`s rather than allocating (`set(...)`). `export const RAIN_SLANT = 3;`

Delete `windField.ts`, drop it from `BABYLON_FREE_FILES`, grep for `windField` (nothing may remain).

- [ ] **Step 4: Run** `npm run typecheck && npx vitest run --root client test/game/motesParams.test.ts test/game/motes.test.ts test/game/mistMeshes.test.ts test/game/rain.test.ts test/architecture.test.ts` → PASS (the renderer's call sites are fixed in Task 8; until then typecheck fails there, so do Task 8's renderer edits for these four calls in this task if `npm run typecheck` must stay green per commit — it must; pass a temporary `windRecordUnder(weather, performance.now() / 1000)` at each call site and Task 8 replaces it with the shared record).

- [ ] **Step 5: Commit** `feat: motes, mist and rain ride the same wind as the grass`.

---

### Task 7: the audio loses the pulsing air and follows the gusts

**Files:**
- Modify: `client/src/game/ambientAudio.ts`, `client/src/game/weather.ts` (`ambientGainsUnder` ~353)
- Test: `client/test/game/ambientAudio.test.ts`, `client/test/game/weather.test.ts` (lines ~122, ~160–164)

**Interfaces:**
- Produces: `ambient.setWind(record: WindRecord)`; `ambientGainsUnder(w): { rain, wind }`; `WIND_CUTOFF_BASE = 400`, `WIND_CUTOFF_GUST = 250`, `WIND_MIST_DEEPEN = 0.5`, `WIND_GAIN_FLOOR = 0.35`, `WIND_MIST_QUIET = 0.3`, `WIND_AUDIO_INTERVAL_S = 0.1`. `AIR_LEVEL` is deleted.

- [ ] **Step 1: Write the failing tests**

In `ambientAudio.test.ts`: the unlock test expects `created.oscillators` **0**, `created.filters` **2**, `created.gains.length` **5** (master, rain, wind, wildlife, plus nothing else: the LFO depth gain is gone too), and the wiring test expects **3** layer gains all reaching the master and no gain feeding a param. Replace the `gains.air * AIR_LEVEL` expectation with:

```ts
it("setWind moves the wind cutoff with the gust and the gain with speed, no more than every 100 ms", () => {
  const { ctx, created } = fakeCtx();
  const audio = createAmbientAudio(() => ctx);
  audio.setWeather(WEATHER_PRESETS.mist);
  audio.unlock();
  const windFilter = /* the lowpass filter: extend fakeCtx to keep created filters in an array */;
  const rec = windRecordUnder(WEATHER_PRESETS.mist, 5);
  audio.setWind(rec);
  const cutoff = WIND_CUTOFF_BASE * (1 - WIND_MIST_DEEPEN * 1) + WIND_CUTOFF_GUST * gustAt(rec, 0, 0);
  expect(windFilter.frequency.targets.at(-1)!.value).toBeCloseTo(cutoff, 6);
  const windGain = created.gains.find(/* the wind gain — identify it by its last target value below */);
  const gain = WIND_LEVEL * (WIND_GAIN_FLOOR + (1 - WIND_GAIN_FLOOR) * rec.speed) * (1 - WIND_MIST_QUIET * 1);
  expect(windGain!.gain.targets.at(-1)!.value).toBeCloseTo(gain, 6);
  const n = windFilter.frequency.targets.length;
  audio.setWind({ ...rec, time: 5.02 }); // 20 ms later on the fake clock: throttled
  expect(windFilter.frequency.targets.length).toBe(n);
  audio.dispose();
});
it("clear has a quiet steady wind bed instead of silence", () => {
  const rec = windRecordUnder(WEATHER_PRESETS.clear, 0);
  expect(rec.speed).toBeCloseTo(0.25, 10);
  // gain floor × level > 0
});
```

The throttle uses the record's `time`, not `performance.now`, so tests can drive it. In `weather.test.ts` the two `ambientGainsUnder` assertions become `{ rain: 0, wind: 0 }` and `{ rain: 1, wind: 0.8 }` and the `.air` line is deleted.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

In `ambientAudio.ts`: delete `AIR_LEVEL`, `airGain`, the two-sine loop and `airFilter`; delete the LFO oscillator and `lfoDepth`; keep `windFilter` with `frequency.value = WIND_CUTOFF_BASE`. Add:

```ts
export const WIND_CUTOFF_BASE = 400;
export const WIND_CUTOFF_GUST = 250;
export const WIND_MIST_DEEPEN = 0.5;
export const WIND_GAIN_FLOOR = 0.35;
export const WIND_MIST_QUIET = 0.3;
export const WIND_AUDIO_INTERVAL_S = 0.1;
/** Listener XZ for the gust sample, in Babylon's world (setListener's mirrored z is undone). */
let listenerX = 0, listenerZ = 0, lastWindTime = -Infinity;

setWind(record) {
  if (!ctx || !windGain) return;
  if (record.time - lastWindTime < WIND_AUDIO_INTERVAL_S && record.time >= lastWindTime) return;
  lastWindTime = record.time;
  const mist = clamp01(pending.mist);
  const cutoff = WIND_CUTOFF_BASE * (1 - WIND_MIST_DEEPEN * mist) + WIND_CUTOFF_GUST * gustAt(record, listenerX, listenerZ);
  windFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.15);
  const gain = WIND_LEVEL * (WIND_GAIN_FLOOR + (1 - WIND_GAIN_FLOOR) * record.speed) * (1 - WIND_MIST_QUIET * mist);
  windGain.gain.setTargetAtTime(gain, ctx.currentTime, GAIN_RAMP_S);
}
```

`applyGains` no longer writes the wind gain from `ambientGainsUnder` (the record owns it; on unlock, apply the floor gain so clear is not silent before the first `setWind`). `ambientGainsUnder` returns `{ rain, wind }` with `wind` kept as the presence term the wildlife or anything else may still read; if nothing reads `wind` after this task, delete it too and update its test. `setListener` stores `listenerX = x; listenerZ = -z` (Web Audio's frame is mirrored, see `wildlifeAudio.ts`).

- [ ] **Step 4: Run** `npx vitest run --root client test/game/ambientAudio.test.ts test/game/weather.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat: the wind bed follows the gusts and the pulsing air tone goes`.

---

### Task 8: the renderer computes the record, the players bend it, `/wind` overrides it

**Files:**
- Modify: `client/src/game/renderer.ts` (type at ~559–600, `sync` ~840–935, setters ~996–1012), `client/src/app.ts` (command dispatch ~236–266 and the frame loop that calls `renderer.sync`), `client/src/game/commands.ts` (after `unsettle` ~131)
- Test: `client/test/game/commands.test.ts`, `client/test/game/renderer.test.ts`

**Interfaces:**
- Produces: `renderer.wind(): WindRecord` (the record of the last `sync`), `renderer.setWindOverride(level: number | null)`, the `/wind` command.

- [ ] **Step 1: Write the failing tests**

```ts
// commands.test.ts
describe("/wind", () => {
  it("accepts bare, 0–100, rejects the rest", () => {
    expect(validateCommand({ name: "wind", args: [] })).toBeNull();
    expect(validateCommand({ name: "wind", args: ["40"] })).toBeNull();
    expect(validateCommand({ name: "wind", args: ["101"] })).toContain("[0, 100]");
    expect(validateCommand({ name: "wind", args: ["x"] })).toContain("[0, 100]");
    expect(validateCommand({ name: "wind", args: ["1", "2"] })).toContain("one argument");
  });
  it("is a view command whose bare form restores the weather-driven wind", () => {
    const spec = COMMANDS.find((c) => c.name === "wind")!;
    expect(spec.kind).toBe("view");
    expect(spec.scriptValue!([])).toBeNull();
    expect(spec.scriptValue!(["25"])).toBe(25);
  });
});

// renderer.test.ts (NullEngine renderer as the file already builds one)
it("wind() is the weather-driven record until an override, then the override's speed", () => {
  renderer.setWeather(WEATHER_PRESETS.rain, 0);
  renderer.sync(state, localId, 0);
  expect(renderer.wind().speed).toBeCloseTo(0.9, 6);
  renderer.setWindOverride(0);
  renderer.sync(state, localId, 0);
  expect(renderer.wind().speed).toBe(0);
  expect(renderer.wind().lean).toBe(0);
  renderer.setWindOverride(null);
  renderer.sync(state, localId, 0);
  expect(renderer.wind().speed).toBeCloseTo(0.9, 6);
});
```

`scriptValue` returning `null` for the bare form: check `CommandSpec`'s value type allows `null` (it allows `false`/numbers/strings today; extend the union if needed, and make `app.ts` treat `null` as "no override").

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement**

`commands.ts`, after `unsettle`:
```ts
{
  name: "wind",
  kind: "view",
  validate(args) {
    if (args.length === 0) return null;
    if (args.length > 1) return "wind takes one argument, a level in [0, 100]";
    const v = Number(args[0]);
    if (!Number.isFinite(v) || v < 0 || v > 100) return `"${args[0]}" is not a level in [0, 100]`;
    return null;
  },
  // Bare `/wind` restores the weather-driven wind.
  scriptValue: (args) => (args.length === 0 ? null : Number(args[0])),
  defaultValue: null,
},
```

`renderer.ts`:
- `let windOverride: number | null = null; let wind: WindRecord = windRecordUnder(DEFAULT weather, 0); const windPlayers = new Float32Array(FOLIAGE_PLAYERS * 3);`
- In `sync`, right after `lampState`: 
  ```ts
  const seconds = performance.now() / 1000;
  wind = windRecordUnder(weather, seconds, windOverride ?? undefined);
  let n = 0;
  windPlayers.fill(0);
  for (let i = 0; i < FOLIAGE_PLAYERS; i++) { windPlayers[i * 3] = FOLIAGE_PLAYER_PARKED; windPlayers[i * 3 + 2] = FOLIAGE_PLAYER_PARKED; }
  for (const p of state.players.values()) {
    if (n === FOLIAGE_PLAYERS) break;
    windPlayers[n * 3] = p.pos.x; windPlayers[n * 3 + 1] = p.pos.y; windPlayers[n * 3 + 2] = p.pos.z;
    n++;
  }
  setFoliageWind(wind, windPlayers);
  ```
- Replace the temporary records from Task 6 with `wind` at the four call sites (`mist.update(..., wind, seconds)`, `rain.update(..., wind)`, `motes.update(..., wind)`), in both the freecam and the player branches.
- `wind() { return wind; }` and `setWindOverride(level) { windOverride = level === null ? null : Math.min(1, Math.max(0, level)); }` on the returned object and its type.

`app.ts`: in the command dispatch, `else if (name === "wind") { renderer.setWindOverride(typeof value === "number" ? value / 100 : null); }`; in the per-frame loop that calls `renderer.sync`, add `ambient.setWind(renderer.wind());` after it (the audio throttles itself).

- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npx vitest run --root client test/game/commands.test.ts test/game/renderer.test.ts test/game/script.test.ts` → PASS. Then the whole suite: `npm test` (close any game tab first; a rendering page makes the suite time out en masse).

- [ ] **Step 5: Commit** `feat: one wind record per frame, the players bend it, /wind overrides it`.

---

### Task 9: docs and the browser gates

**Files:**
- Modify: `ARCHITECTURE.md` (the Rendering paragraph)
- Create: `docs/rendering/2026-09-15-grass-grounding-and-wind-verification.md`

- [ ] **Step 1: `ARCHITECTURE.md`**: after the sentence on airborne motes, add: "One wind field (`client/src/game/windParams.ts`) moves the ground cover, the crowns, the motes, the mist and the rain, and swells the ambient wind bed; the foliage plugin (`foliagePlugin.ts`) also tints every card to the ground it stands on from a per-instance attribute the clutter rebuild writes."

- [ ] **Step 2: Stand up the gate rig** per the browser-verification recipe: the branch's client on one port and a `main` checkout's on another, both seeded with the same world, the chrome-devtools CLI with `--isolated=true`, screenshots under the OS temp dir, hardware scaling 0.5 for the frame pairs, a 3 s warm-up before every sample, paired in both orders.

- [ ] **Step 3: The four gates** (each: still frames branch and control; frame-time pairs; for 1 and 2 a 10 s clip at `/wind 100`)
  1. Open meadow, `weather clear;time 12` and `weather rain;time 12`; bonus frame `time 17` with the sun behind the grass.
  2. Forest edge, `time 14`.
  3. The trail, `weather eerie;time 20`, lamp on (the hook that forces it, as in the dread-night gate).
  4. Deep forest, `time 12`: the tree-sway gate. If the branch misses 60 Hz where main holds it, apply the fallback ladder (trees on LOD0 only, then off) and re-pair.
  Also `/wind 0` at gate 1 (everything still, the bed steady) and the audio by ear at clear, mist and eerie.

- [ ] **Step 4: Write the verification doc** with the pairs, the verdicts, the frames' paths and every constant changed by tuning (each tuning change goes into the spec's departures section as well).

- [ ] **Step 5: Gates** `npm run typecheck && npm run lint && npm test`, the leak scan, the large-blob check. Commit `docs: grass grounding and wind — architecture note and browser verification`. Do not push; report.

---

## Self-review

**Spec coverage.** §4 record → Task 1. §5 plugin, attribute, vertex and fragment stages → Tasks 2–3. §6 translucency → Task 5. §7 clutter and trees → Tasks 3–4; motes, mist, rain → Task 6; audio → Task 7; `/wind` → Task 8. §8 tiers and the fallback ladder → Task 9 gate 4. §9 tests → each task's step 1 (the lockstep, both-path, attribute, audio, motes/mist/rain, commands and architecture tests are all present). §10 gates → Task 9. §11 follow-ups need no task.

**Placeholders.** Task 3 step 1 and Task 6 step 1 describe two tests in prose where the file's existing helpers decide the exact accessor; each names the helper to copy and the assertion to make. Task 5's `createLighting` call defers to `lighting.test.ts` for the signature. Nothing says "TBD".

**Type consistency.** `WindRecord` fields (`dirX, dirZ, speed, lean, gustAmp, flutterAmp, time`) are used identically in Tasks 1, 2, 6, 7, 8. `setFoliageWind(record, Float32Array)` in Tasks 2 and 8. `attachFoliage(material, profile, meshHeight)` and `setFoliageEdges(material, [start, end])` in Tasks 2, 3, 4. `motes.update(camPos, w, hour, air, wind)`, `mist.update(camX, camZ, w, air, wind, seconds)`, `rain.update(camPos, w, wind)` in Tasks 6 and 8. `ambient.setWind(record)` in Tasks 7 and 8.

## Amendments (rulings made during execution)

- **Task 1, the travelling phase.** The gust phase is `K·u − Ω·t`; with `+` the crest moves upwind. The spec's §4 and Task 2's shader text and lockstep assertion were corrected, and Task 1's algebraic front-travel test became a crest-tracking test (the crest found at 1 mm over one ragged cell at t = 0 and t = 0.2 s must advance by 0.2–0.35 m).
- **Task 2, the shader-hygiene test.** `client/test/game/shaderHygiene.test.ts` required an unconditional top-level function in every `.fx` and processed with no defines, which no define-gated file or splice block can satisfy. It now enables every define a file gates on (collected from its own `#ifdef`/`#ifndef` lines), keeps the function-survives check where a file declares functions, and requires at least one code line to survive in every file. The intent — prove Babylon's real preprocessor keeps the code — is unchanged.
- **Task 2, the attribute assertions.** Under `NullEngine` the compiled source is never define-evaluated, so `not.toContain("attribute vec4 foliage;")` cannot hold. Those two expectations were replaced by a structural check on the raw `CUSTOM_VERTEX_DEFINITIONS` text (the attribute declared once, nested under `FOLIAGE` → `FOLIAGE_TINT` → `THIN_INSTANCES`). The uniform-reach checks on both shader paths stay.
- **Task 6, the mist wrap.** A shared drift offset wrapped inside the cell teleports every bank a full cell at the same instant. Each bank now wraps at its own phase (`wrap(off + bank.hash·MIST_CELL)`) and dissolves over the last `MIST_WRAP_FADE = 8` m before its wrap, so one soft bank at a time re-emerges upwind.
