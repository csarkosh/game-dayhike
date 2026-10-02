# Ocean Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sea its waves: a seeded swell that arrives in sets, shoals, turns toward the beach and spills into white water across the cove's bed; a wind sea and its whitecaps from the weather and the hour; the same crest at the same moment for every player.

**Architecture:** The swell is analytic on every tier: twelve components (eight on low) whose phase is integrated along the coast through tables built at load, so each wave slows, steepens and turns as the bed rises, and a stateless rule caps and breaks it by the depth under it. The tables, the components and the coastline go to the GPU in one float texture (the atlas); the water plugin evaluates the same sum in the vertex shader (displacement) and the fragment shader (normal, break, foam). The wind sea is a GPU FFT in WebGPU compute on high, a 20 s loop baked at load on medium, and normals on low. The mesh is seven stitched rings from 1 m. Everything runs on one clock, the sim's tick, so every peer sees the same sea. Nothing under `client/src/sim/` changes but one `export`: the level id does not move.

**Tech Stack:** TypeScript, Babylon.js 9.18 (PBR material plugins with GLSL injected through the custom hooks, WebGPU compute shaders in WGSL, WGSL translated ahead from the recorded corpus), Vite module workers, Vitest with `NullEngine`, glslang and the repository's translators under Node.

**Spec:** [`docs/rendering/2026-10-02-ocean-waves-design.md`](2026-10-02-ocean-waves-design.md). The water it moves is [`2026-09-29-water-material-design.md`](2026-09-29-water-material-design.md) on the ground of [`2026-09-30-water-terrain-design.md`](2026-09-30-water-terrain-design.md).

## Global Constraints

- `client/src/sim/` is untouched except `export` on `shoreProfileD` in `sim/olympic.ts` (Task 7): no new sim numbers, the level id does not move. The ocean is render-side and reads the sim only.
- New Babylon-free modules (no `@babylonjs` import), each added to `BABYLON_FREE_FILES` in `client/test/architecture.test.ts` by the task that creates it: `game/oceanPhysics.ts`, `game/oceanSpectrum.ts`, `game/oceanFft.ts`, `game/oceanSwell.ts`, `game/oceanTables.ts`, `game/oceanWaves.ts`, `game/oceanWindSea.ts`, `game/oceanLoopBake.ts`. Game code may use `Math.sin`, `Math.pow` and the rest.
- One evaluation in two languages: the swell's sum (spec §4–§5) is written once in TypeScript (`swellAt`, `oceanWaves.ts`) and once in GLSL (`oceanSwellEval`, `ocean.vertex.fx`), line for line the same, with the same texel-centre interpolation of the atlas. Every constant the shaders use is mirrored in TypeScript and pinned in lockstep (the shader text holds `const float NAME = <value>;`, read with `glslFloat` as `waterPlugin.test.ts` pins `WATER_REFRACT`).
- GLSL injected into Babylon (`client/src/game/shaders/*.fx`): the existing water `.fx` style (`attribute`, `varying`), every ocean texture read explicit-level (`textureLod(sampler, coordinate, 0.0)`, 2D and array alike); never spell a hashed preprocessor keyword in comment prose; never put a semicolon inside a trailing comment (`shaderHygiene.test.ts` enforces both); no texture read inside a branch on a varying or on a value computed from one (WebGPU refuses non-uniform control flow around a read): branch on uniforms, or read unconditionally and select; a sampler is declared in the `.fx`, never in `getUniforms().fragment`, and bound in every state (1×1 placeholders when absent); every uniform in the `ubo` list and in both the `vertex` and the `fragment` string.
- The lakes do not change: a lake's injected shader text is byte-identical before and after this release (the `OCEAN` define gates every line of ocean code).
- WGSL compute shaders are files under `client/src/game/shaders/` named `oceanFft*.compute.wgsl`, imported with Vite's `?raw`, outside the GLSL corpus.
- The repository is public: nothing in code, comments, docs or commit messages says how the work is organised (no "task", "plan", "brief", "agent", "session", "review", "owner", "ruling"), how an asset was made, or where the reference photos came from (gates name reference ids only).
- Commits: a Conventional Commits subject under 72 characters, a body with `## What` and `## How` (backticked paths), ending with the two trailer lines `Co-Authored-By: <the committing model's name> <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4`. Stage explicit paths; never `git add -A`; never `--no-verify`.
- Test time limits through `timeLimit(ms)` (`client/test/helpers/timeLimit.ts`), never a bare number. Every numeric expectation is a literal.
- Run a client test file from the worktree root with `npx vitest run --root client test/<path>`. The full client suite (`npm run test:client`) is heavy: run only the files a task names unless the task says otherwise, and never while another suite or a browser gate runs.

## Review Focus

1. **The two evaluations agree.** The TypeScript `swellAt` and the GLSL `oceanSwellEval` must be the same sum: the same rows, the same texel-centre interpolation, the same blend of bay and cove by the coastline's weight, the same cap, the same Q scale, the same foam. A difference shows as a crest the breaker and the swash sub-projects place where the drawn wave is not. Pinned in Task 8 (`atlasRead`, `coastRead` and the sum's numbers) and Task 11 (the GLSL's constants in lockstep with the TypeScript's, the functions in Shared definitions §6); reviewers of Task 11 compare `oceanSwellEval` with `swellAt` line by line.
2. **Non-uniform control flow around a texture read.** The WebGPU compiler refuses an implicit-level read under a branch on a varying, and the failure appears only on the high tier's page. Every ocean read is explicit-level (`textureLod(…, 0.0)`, pinned on the WGSL as `textureSampleLevel`), and the sea's material is compiled through glslang and translated to WGSL under Node on every tier's defines in Tasks 11, 12 and 13, as `rainSplash.test.ts` does. The translator under Node does not report uniformity in Babylon's PBR stages, so the guarantee is the explicit-level rule, and Task 15's high-tier pages confirm it.
3. **Cracks and popping at the rings' borders.** A finer ring's border vertex must land exactly on the coarser ring's interpolated displacement, and a ring's culling box must hold the displaced surface. Pinned in Task 4 (every vertex's half-edge lies on a drawn edge of the coarser ring, and an outer-edge vertex moved by its full weight lands on a coarser vertex; the boxes hold the level ± `OCEAN_BOUND` every way) and Task 11 (the vertex is moved to p − `oceanMorph`·`oceanCoarse` before the waves are evaluated once there, and the ring's cutoff is a function of that point alone).
4. **The tables on land, at their ends and across the cove's ends.** No NaN or Infinity anywhere in the atlas for any seed; Ψ continuous across the shelf blend, the cove's along-shore window and d = −1,000 m; the plane wave exact far out. Pinned in Task 7.
5. **One sea for every player.** The same seed and tick give the same height and slopes on every peer, and the shared seconds advance monotonically and continuously through a tick. Pinned in Task 8 (determinism) and Task 9 (`sharedSeconds`; the renderer's wind and water read the shared seconds, everything else keeps its own clock).
6. **The high tier without compute.** Where `createGpuWindSea` returns null (no WebGPU compute, or a failure), the high tier draws the medium loop and nothing breaks. Pinned in Task 13 (the fallback under `NullEngine`).
7. **The limits.** The water material's inter-stage variables stay at or under 19 with `OCEAN` set (8 after Task 10, 7 on high and medium after Task 11), its vertex buffers at or under 8 on WebGPU (6), its textures at or under 16 a stage, and every compute shader at or under 4 storage textures (2). Pinned in Task 4 (vertex buffers), Tasks 10 and 11 (`interStage.test.ts`), Task 3 (storage textures).
8. **The test environment's array maker.** Task 10 gives NullEngine a raw 2D-array texture maker in every client test file (`client/test/setup/nullEngineArrays.ts`). It must make an internal texture exactly as NullEngine's `createRawTexture` does (holding the data, never uploaded, never ready), so no test comes to rely on an upload that a browser would do differently; the suites that mock the ground's loader keep their mocks.
9. **The chop's frame.** The wind sea is made along +x and turned in the shader about a pivot at the cove's waterline, so it never slides where the sea is seen up close. Pinned in Task 13 (the frame is the identity at the pivot; the slide at a distance is the distance times the turn).

## Files

| File | Change | Responsibility |
| --- | --- | --- |
| `client/src/game/oceanPhysics.ts` | create | Dispersion, group speed, shoaling, refraction, Weggel's breaker index, Callaghan's whitecap coverage |
| `client/src/game/oceanSpectrum.ts` | create | JONSWAP, directional spreading, the cascades' bands, the wind sea's h0 |
| `client/src/game/oceanFft.ts` | create | The CPU Stockham FFT the GPU's passes mirror, a DFT reference, the spectrum's evolution and a whole frame's fields |
| `client/src/game/oceanGpuFft.ts`, `client/src/game/shaders/oceanFft{Evolve,Pass,Resolve}.compute.wgsl` | create | The wind sea's FFT in WebGPU compute (high tier) |
| `client/src/game/water.ts` | modify | Seven stitched rings from 1 m; the border weight and the coarse lattice per vertex; `OCEAN_BOUND` |
| `client/src/game/oceanSwell.ts` | create | The swell's sea state and its components from the seed |
| `client/src/game/oceanTables.ts` | create | The coast's profiles, the phase tables, the coastline row, the atlas's data |
| `client/src/sim/olympic.ts` | modify | `export` on `shoreProfileD`, nothing else |
| `client/src/game/oceanWaves.ts` | create | The swell's evaluation at a point, shelter, `crestAt`, the bore's arrivals |
| `client/src/game/oceanWindSea.ts` | create | The shared clock, the hour's factor, the wind sea's state from the weather |
| `client/src/game/oceanRender.ts` | create | The atlas texture, the wind sea's textures by tier, the per-frame values, the binding |
| `client/src/game/oceanLoopBake.ts`, `client/src/game/oceanLoop.worker.ts` | create | The medium tier's 20 s loop, baked in a worker at load |
| `client/src/game/waterPlugin.ts` | modify | The `OCEAN` define, the ocean's uniforms, samplers, attributes and hooks |
| `client/src/game/shaders/ocean.vertex.fx`, `oceanDisplace.vertex.fx`, `ocean.fragment.fx` | create | The ocean's declarations under `OCEAN`, and the displacement hook |
| `client/src/game/shaders/oceanSurface.fx`, `oceanShade.fragment.fx` | create | The swell and the wind sea in GLSL (both stages); the white water and the whitecaps (fragment) |
| `client/src/game/oceanWindSource.ts` | create | The wind sea's source by tier: the loop's worker, the GPU FFT and its fallback, their textures and statistics |
| `client/src/game/shaders/waterLights.fragment.fx`, `waterCompose.fragment.fx` | modify | The sea's normal, waterline, roughness and foam layer under `OCEAN` |
| `client/src/game/waterShading.ts` | modify | The roughness the drawn waves leave to Cox and Munk |
| `client/src/game/renderer.ts` | modify | The rings' culling boxes, the shared seconds for the wind and the water, the ocean built for the sea |
| `client/test/setup/nullEngineArrays.ts`, `client/vite.config.ts` | create / modify | NullEngine makes raw 2D-array textures in every client test file (the sea's sampler placeholders need one) |
| `client/test/game/ocean*.test.ts`, `water.test.ts`, `waterMesh.test.ts`, `waterPlugin.test.ts`, `interStage.test.ts`, `renderer.test.ts`, `architecture.test.ts` | create / modify | The tests each task names |
| the comments of thirteen test files that said NullEngine cannot make a 2D array (Task 10 lists them) | modify | Each mock stays; its comment says it is there because the real loader fetches and decodes the layer images |
| `client/shaders/corpus/`, `tools/wgsl/test/corpusFiles.test.mjs` | modify (recorded) | The water's new stages on every tier, the superseded ones retired |
| `ARCHITECTURE.md` | modify | The sea's waves in the Rendering section |

## Shared Definitions

The names, constants, signatures, table layout and formulas every task codes against. A task that adds a name lists it under its **Interfaces → Produces**; where a task's text and this section differ, the task's is the later and wins (each such place says so). "§n" in a task's text means a section of the spec; "Shared definitions §n" means one below.

### Shared definitions §2: Constants

`game/oceanPhysics.ts`:
```ts
export const OCEAN_G = 9.81;                 // m/s²
export const WEGGEL_GAMMA_MIN = 0.78;
export const WEGGEL_GAMMA_MAX = 1.56;
export const WEGGEL_SLOPE_MAX = 0.1;         // Weggel's validity; slopes above are clamped
export const CALLAGHAN_ONSET = 3.7;          // m/s
export const CALLAGHAN_TOP = 11.25;          // m/s, the fit's upper end (past it, the cubic's tangent)
export const CALLAGHAN_COEFF = 3.18e-5;      // fraction (not %), × (U − 3.7)³
export const WHITECAP_MAX = 0.1;             // coverage cap
```
`game/oceanSwell.ts`:
```ts
export const SWELL_HS_MIN = 0.8;  export const SWELL_HS_MAX = 4.0;  export const SWELL_HS_MEDIAN = 1.9;
export const SWELL_HS_SIGMA = 0.45;          // log-normal σ of ln Hs
export const SWELL_TP_BASE = 7.5;  export const SWELL_TP_PER_HS = 1.6;  export const SWELL_TP_JITTER = 1;
export const SWELL_TP_MIN = 8;     export const SWELL_TP_MAX = 14;
export const SWELL_DIR_MIN_DEG = 255;  export const SWELL_DIR_MAX_DEG = 300;   // compass "from"
export const SWELL_GAMMA_MIN = 3.3;    export const SWELL_GAMMA_MAX = 7;
export const SWELL_SPREAD_MIN = 25;    export const SWELL_SPREAD_MAX = 75;
export const SWELL_COMPONENTS = 12;    export const SWELL_COMPONENTS_LOW = 8;
export const SWELL_PAIR_DF_MIN = 0.005; export const SWELL_PAIR_DF_MAX = 0.01;  // Hz
export const SWELL_Q_SUM_MAX = 0.9;    // Σ Q|K|A cap
export const SWELL_SALT = 0x5e11;
```
`game/oceanTables.ts`:
```ts
export const OCEAN_D_MIN = -1000;  export const OCEAN_D_STEP = 1;  export const OCEAN_TABLE_SAMPLES = 1040;
export const OCEAN_COAST_STEP = 4; export const OCEAN_COAST_SAMPLES = 1040;   // the coastline row: 4,160 m along z
export const OCEAN_COAST_RECENTRE = 1000;  // recentre the coastline row when the camera is this far from its centre
export const OCEAN_ATLAS_ROWS = 28;
export const OCEAN_ROW_BAY_PROFILE = 0;  export const OCEAN_ROW_COVE_PROFILE = 1;
export const OCEAN_ROW_BAY_FIRST = 2;    export const OCEAN_ROW_COVE_FIRST = 14;
export const OCEAN_ROW_COMPONENTS = 26;  export const OCEAN_ROW_COAST = 27;
export const OCEAN_DRY_DEPTH = 0.05;     // m: at or below it a sample is dry
```
`game/oceanWaves.ts`:
```ts
export const OCEAN_BORE_RATIO = 0.42;     // a broken wave's height over its depth (§2.2)
export const OCEAN_BREAK_FULL = 1.5;      // r at which the cap reaches the bore's
export const OCEAN_BREAK_FOAM_LO = 1.0;  export const OCEAN_BREAK_FOAM_HI = 1.3;   // B = smoothstep(lo, hi, r)
export const OCEAN_FOAM_LIFE = 20;        // s (§2.2)
export const OCEAN_ROLL_WIDTH = 0.6;      // rad of crest phase ahead of the crest carrying the roll
export const OCEAN_INNER_FOAM = 0.5;      // the inner surf's foam floor under a broken wave
export const SHELTER_SWELL = 0.3;  export const SHELTER_CHOP = 0.15;  export const SHELTER_WIDTH = 40;  // m
```
The wind sea's (`WIND_SEA_HS_COEFF`, `WIND_SEA_FP_COEFF`, `WIND_SEA_SPREAD`, `WIND_SEA_GAMMA` are defined in `game/oceanSpectrum.ts`, which needs them first, and re-exported from `game/oceanWindSea.ts`; the rest are defined in `oceanWindSea.ts`):
```ts
export const WIND_SEA_U_PER_WIND = 12;    // m/s per unit of the game's wind speed (as roughnessFor)
export const WIND_SEA_HS_COEFF = 0.28;    // Hs ≈ 0.28 U²/g, fully developed
export const WIND_SEA_FP_COEFF = 0.123;   // fp ≈ 0.123 g/U
export const WIND_SEA_DAWN = 0.4;  export const WIND_SEA_AFTERNOON = 1.25;
export const WIND_SEA_OFFSHORE_CUT = 0.3; // near-shore wind sea under an offshore wind
export const WIND_SEA_SPREAD = 10;
export const WIND_SEA_GAMMA = 3.3;
export const WIND_SEA_U_REF = 10;         // the medium loop's bake wind
```
`game/oceanSpectrum.ts`:
```ts
export const FFT_N = 256;  export const FFT_CASCADES = [1000, 150, 25] as const;   // m, high tier
export const LOOP_N = 128; export const LOOP_SIZE = 60; export const LOOP_FRAMES = 64; export const LOOP_SECONDS = 20;  // medium
export const WIND_SEA_SALT = 0x0ce4;
```
`game/water.ts` (Task 4): `WATER_RING_COUNT = 7`, `WATER_BASE_SPACING = 1` (rings 1, 2, 4, 8, 16, 32, 64 m), `WATER_RING_CELLS = 128` unchanged, `OCEAN_BOUND = 12`.

### Shared definitions §3: Types and signatures

```ts
// oceanPhysics.ts
export function waveNumber(omega: number, depth: number): number;           // Fenton–McKee explicit, two Newton steps; depth ≥ 0.01, Infinity → deep
export function waveNumberNewton(omega: number, depth: number): number;     // the reference (tests)
export function groupSpeed(omega: number, k: number, depth: number): number;
export function shoalingFactor(omega: number, depth: number): number;       // √(cg_deep / cg(h))
export function refraction(k0: number, k0z: number, k: number): { kn: number; kr: number };  // kn = √(k² − k0z²), kr = √(cosθ0/cosθ)
export function weggelCoefficients(slope: number): { a: number; b: number }; // slope clamped to WEGGEL_SLOPE_MAX
export function breakerIndex(slope: number, height: number, period: number): number;  // clamp(b − a·H/(gT²), MIN, MAX)
export function whitecapCoverage(u10: number): number;                      // 0 below onset, cubic, capped at WHITECAP_MAX

// oceanSwell.ts
export type SwellState = { hs: number; tp: number; dirFromDeg: number; gamma: number; spread: number };
export type SwellComponent = { k0x: number; k0z: number; omega: number; a0: number; phase0: number; q0: number };
export function swellStateFor(seed: number): SwellState;
export function swellComponents(seed: number, state: SwellState): SwellComponent[];   // SWELL_COMPONENTS, sorted by a0 descending (the low tier takes the first 8)
export function swellTravelDirection(components: readonly SwellComponent[]): [number, number];  // amplitude²-weighted unit vector of travel (x, z)
// Convention: the sea lies toward −x; swell travels toward +x (k0x > 0). "From" compass bearing θ (deg):
// travel angle α = (θ − 270)° measured from +x toward +z, i.e. k0 = k0 (cos α, sin α).

// oceanTables.ts
export type CoastProfiles = {
  bayDepth(d: number): { depth: number; slope: number };    // from shoreProfileD: depth = −v (positive at sea), slope = |dd|
  coveDepth(d: number): { depth: number; slope: number };   // from coveProfileD
  coveWeight(z: number): number;                            // the sim's along-shore window
  coastlineX(z: number): number;                            // x − coastDistance(seed, x, z) for any x
  shelfBreakD: { bay: number; cove: number };                // d where each profile reaches SHELF_BREAK_DEPTH
  headlandTips: [number, number][];                          // (x, z) of each headland's seaward tip
};
export function coastProfilesFor(seed: number): CoastProfiles;
export function deepWeight(d: number, shelfBreakD: number): number;          // 0 at the shelf break and shoreward, 1 at shelfBreakD − SHELF_BREAK_WIDTH and seaward, smootherstep between
export type OceanTables = { data: Float32Array; width: number; rows: number; coastOriginZ: number };
export function buildOceanTables(profiles: CoastProfiles, components: readonly SwellComponent[], tp: number, coastCentreZ: number): OceanTables;
export function writeCoastRow(tables: OceanTables, profiles: CoastProfiles, coastCentreZ: number): void;  // refills row 27 only, for a recentre

// oceanWaves.ts
export type OceanField = { tables: OceanTables; components: SwellComponent[]; count: number; tp: number; hs: number;
  travel: [number, number]; tips: [number, number][] };
export function oceanFieldFor(seed: number, count?: number): OceanField;     // count defaults to SWELL_COMPONENTS
export function swellPhases(field: OceanField, seconds: number): Float32Array; // θ_c = (phase0 − ω t) mod 2π, folded in double precision, length 12 (zeros past count)
export type SwellSample = { height: number; dx: number; dz: number; slopeX: number; slopeZ: number; normalY: number;
  depth: number; envelope: number; unbroken: number; ratio: number; broken: boolean; breaking: number;   // breaking = B
  crestPhase: number; foamAge: number; foam: number; reach: number; steepness: number };
export function swellAt(field: OceanField, phases: Float32Array, x: number, z: number): SwellSample;
export function shelterAt(field: OceanField, x: number, z: number, keep: number): number;  // keep = SHELTER_SWELL or SHELTER_CHOP
export type Crest = { height: number; period: number; direction: [number, number]; phase: number; depth: number; slope: number;
  offshoreHeight: number; offshoreLength: number; broken: boolean; iribarren: number };
export function crestAt(field: OceanField, phases: Float32Array, x: number, z: number): Crest;   // for the breaker's later work
export function boreArrivals(field: OceanField, x: number, z: number, from: number, to: number, step: number): { t: number; height: number }[];  // for the swash's later work

// oceanWindSea.ts
export type WindSeaState = { u10: number; dir: [number, number]; hs: number; tp: number; onshore: number;
  nearShore: number;   // WIND_SEA_OFFSHORE_CUT .. 1 by onshoreness
  coverage: number;    // whitecapCoverage(u10)
  loopScale: number;   // (u10 / WIND_SEA_U_REF)²: lengths and heights of the medium loop
  loopRate: number };  // WIND_SEA_U_REF / u10, u10 floored
export function hourFactor(hour: number): number;   // 0.4 dawn (5–8 h), 1.25 afternoon (13–18 h), 1 otherwise; smoothstep shoulders 1 h wide
export function windSeaStateFor(wind01: number, dir: [number, number], hour: number): WindSeaState;
export function sharedSeconds(tick: number, alpha: number): number;          // (tick + clamp(alpha, 0, 1)) × TICK_DT; alpha is the fixed-step accumulator's fraction toward the next tick

// oceanSpectrum.ts
export function jonswap(f: number, fp: number, hs: number, gamma: number): number;   // S(f), normalised so 4√∫S df = hs
export function spreading(theta: number, s: number): number;                        // ∫ over (−π, π] = 1
export function windSeaH0(n: number, size: number, state: { u10: number; dir: [number, number] }, band: { kMin: number; kMax: number }, seed: number, repeat?: number):
  { re: Float32Array; im: Float32Array; omega: Float32Array };                       // n×n, h0(k), zero outside the band
export function cascadeBands(sizes: readonly number[], n: number): { kMin: number; kMax: number }[];

// oceanFft.ts
export function fft2dInverse(re: Float32Array, im: Float32Array, n: number): void;   // in place, radix-2 Stockham in the WGSL's stage order
export function dft2dInverse(re: Float32Array, im: Float32Array, n: number): { re: Float32Array; im: Float32Array };  // reference
// evolveSpectrum and windSeaFields: the five fields' spectra and grids plus the Jacobian's three derivatives (exact types in oceanFft.ts)

// oceanGpuFft.ts (Babylon, WebGPU only)
export type GpuWindSea = { disp: BaseTexture; slope: BaseTexture;   // texture 2D arrays, 3 layers, FFT_N², rgba16float
  setSpectrum(state: { u10: number; dir: [number, number] }, seed: number): void;
  step(seconds: number): void;                                       // one frame, called before the scene's passes begin
  status(): "compiling" | "running" | "failed";
  dispose(): void };
export function createGpuWindSea(engine: AbstractEngine): GpuWindSea | null;   // null when compute is unavailable

// oceanLoopBake.ts
export function bakeWindSeaLoop(seed: number): Uint16Array;   // LOOP_FRAMES layers × LOOP_N² × 4 half-floats at WIND_SEA_U_REF, wind along +x

// oceanRender.ts (Babylon)
export type Ocean = { atlas: RawTexture; windDisp: BaseTexture; windSlope: BaseTexture; windMode: 0 | 1 | 2;   // 0 low, 1 medium loop, 2 high FFT
  update(camX: number, camZ: number, seconds: number, wind01: number, windDir: [number, number], hour: number): void;
  bind(plugin: WaterPlugin): void;
  dispose(): void };
export function createOcean(scene: Scene, seed: number, tier: QualityTier, wind?: { startLoop?: LoopStarter; startGpu?: GpuStarter }): Ocean;
```

`Water` (`renderer.ts`) changes in its type only by `update(camX, camZ, seconds, hour?: number)`: the optional hour (default 12) feeds the ocean. The sea's `WaterPlugin` gets `ocean`; the lakes' plugins never do.

### Shared definitions §4: The atlas

One RGBA32F texture, `OCEAN_TABLE_SAMPLES` wide, `OCEAN_ATLAS_ROWS` tall, nearest, clamp. Column i of the d-rows is d_i = OCEAN_D_MIN + i·OCEAN_D_STEP (d = x − coastlineX(z), negative at sea).

- Row 0 (bay profile), row 1 (cove profile): R = depth h(d) (positive under water, negative on land), G = Weggel a(slope), B = Weggel b(slope), A = deepWeight(d).
- Rows 2..13 (bay, component c = row − 2), rows 14..25 (cove, component c = row − 14): R = Ψ_c(d), G = kn_c(d), B = the amplitude factor K_s·K_r (with the deep blend), A = 0. With w = deepWeight(d): k_eff = (1 − w)·waveNumber(ω, max(h, OCEAN_DRY_DEPTH)) + w·k0; kn = refraction(k0, k0z, k_eff).kn; Ψ(d_0) = k0x·d_0 and Ψ(d_{i+1}) = Ψ(d_i) + ∫ kn over the step, by Simpson's rule on `OCEAN_PHASE_SUBSTEPS` (4) sub-steps (Task 7); K = ((1 − w)·shoalingFactor(ω, max(h, OCEAN_DRY_DEPTH)) + w)·refraction(…).kr. Where h ≤ OCEAN_DRY_DEPTH (land) a row holds its value at the last wet sample: no NaN anywhere.
- Row 26 (components): texel 2c = (k0x, k0z, ω, a0), texel 2c+1 = (q0, 0, 0, 0); unused texels 0.
- Row 27 (coastline, along z): texel j at z_j = coastOriginZ + j·OCEAN_COAST_STEP: R = coastlineX(z_j), G = d coastlineX/dz (central difference over OCEAN_COAST_STEP), B = coveWeight(z_j), A = 0. coastOriginZ = round(coastCentreZ / OCEAN_COAST_STEP)·OCEAN_COAST_STEP − (OCEAN_COAST_SAMPLES/2)·OCEAN_COAST_STEP.

Reads are linear interpolation by hand between the two nearest texels at texel centres, in TypeScript over the Float32Array (`atlasRead`, `coastRead`) and in GLSL over the texture (`oceanAtlasRead`, `oceanCoastAt`), d clamped to the table; seaward of OCEAN_D_MIN, Ψ continues as Ψ(OCEAN_D_MIN) + k0x·(d − OCEAN_D_MIN), kn = k0x, K = 1, the profile the row's first column.

### Shared definitions §5: The swell's evaluation

TypeScript in `swellAt` (Task 8), GLSL in `oceanSwellEval` (`oceanSurface.fx`, Task 11): the same maths, line for line. Inputs: the undisplaced (x, z); the per-frame phases θ_c (uniforms `oceanPhase0..2`, 12 floats); the atlas.
```
coast  = row 27 at z → (cx, cdz, wc)
d      = x − cx
for p in {bay, cove}: profile row at d → (h_p, a_p, b_p)    ; h = mix(h_bay, h_cove, wc), a, b likewise
for c < count:
  (k0x, k0z, ω, a0), q0 = row 26
  (Ψ, kn, K) = mix(bay row c at d, cove row c at d, wc)
  φ_c   = Ψ + k0x·cx + k0z·z + θ_c
  Kv_c  = (kn, k0z + (k0x − kn)·cdz)            ; |Kv_c| = kmag_c, unit D_c = Kv_c / kmag_c
  A_c   = a0·K·shelterAt(x, z, SHELTER_SWELL)
S      = Σ A_c (cos φ_c, sin φ_c)                ; envelope = |S|, unbroken = 2·envelope, crestPhase ψ = atan2(S.y, S.x)
hc     = max(h, OCEAN_DRY_DEPTH)                 ; no dry branch: over sand the swell falls to a few centimetres
γ      = clamp(b − a·unbroken/(g·tp²), WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX)
ratio  = unbroken / (γ·hc)
scale  = ratio ≤ 1 ? 1 : hc·mix(γ, OCEAN_BORE_RATIO, smoothstep(1, OCEAN_BREAK_FULL, ratio)) / unbroken
B      = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio)
A_c   *= scale
Q-scale: s = min(1, SWELL_Q_SUM_MAX / Σ q0_c·kmag_c·A_c); Q_c = q0_c·s
height  = Σ A_c cos φ_c
dx, dz  = −Σ Q_c A_c D_c sin φ_c                 (horizontal displacement)
slopeX  = Σ A_c Kv_c.x sin φ_c ;  slopeZ = Σ A_c Kv_c.y sin φ_c ;  normalY = 1 − Σ Q_c A_c kmag_c cos φ_c
normal  = normalize(slopeX, normalY, slopeZ)
foamAge = mod(−ψ, 2π) / (2π/tp)
roll    = B·(1 − smoothstep(0, OCEAN_ROLL_WIDTH, mod(ψ, 2π)))  ; trailing = B·exp(−foamAge/OCEAN_FOAM_LIFE)
foam    = max(roll, trailing, B·OCEAN_INNER_FOAM)
```
`shelterAt` (the shadow of each headland's ridge from the swell's travel direction, faded over SHELTER_WIDTH, a hard step on the ridge's side; the product over both tips; 1 with no tips) is defined in Task 8 and mirrored in `oceanShelter`. Each tip is at (coastlineX(head.z) − head.reach, head.z) (uniform `oceanTips` = x0, z0, x1, z1; an absent tip at `OCEAN_NO_TIP`).

### Shared definitions §6: The water plugin's ocean interface

- `WaterPlugin.ocean: OceanBinding | null`, where `OceanBinding = { atlas, windDisp, windSlope: BaseTexture; phases: Float32Array (12); swell /* ux, uz, tp, hs */; tips /* x0, z0, x1, z1 */; coast /* coastOriginZ, OCEAN_COAST_STEP, count, windMode */; wind /* wind sea hs × nearShore, loopScale, loopTime, coverage */; windDir /* dirX, dirZ, u10, 0 */; windStats /* height std, slope variances */; windPivot /* x, z, 0, 0 */ }`, each of the last seven a `[number, number, number, number]` (Task 10; `windStats` and `windPivot` Task 13).
- Define `OCEAN` when `ocean !== null` (the sea only); every line of ocean shader code sits under it, so a lake's shader text does not change.
- Uniforms, always declared, in the `ubo` list and in both the `vertex` and the `fragment` string: `vec4 oceanPhase0`, `oceanPhase1`, `oceanPhase2`, `oceanSwell`, `oceanTips`, `oceanCoast`, `oceanWind`, `oceanWindDir` (Task 10), `oceanWindStats`, `oceanWindPivot` (Task 13).
- Samplers, `highp`, declared in `ocean.vertex.fx` and `ocean.fragment.fx`, bound in every state (the bed texture and a per-scene 1×1 array placeholder when `ocean` is null): `oceanAtlas` (sampler2D, both stages), `oceanWindDisp` (sampler2DArray, both stages), `oceanWindSlope` (sampler2DArray, fragment). Every ocean read is explicit-level, `textureLod(sampler, coordinate, 0.0)`, so it is legal in any control flow on WebGPU.
- Hooks: `CUSTOM_VERTEX_UPDATE_POSITION` (`oceanDisplace.vertex.fx`: the vertex moved to p′ = p − `oceanMorph`·`oceanCoarse`, the waves evaluated once at p′, `vOceanXZ` = p′); the ocean's vertex definitions appended to `CUSTOM_VERTEX_DEFINITIONS` and its fragment definitions to `CUSTOM_FRAGMENT_DEFINITIONS`. One new varying, `vec2 vOceanXZ`.
- GLSL functions: in `oceanSurface.fx` (both stages) `oceanAtlasRow`, `oceanAtlasRead`, `oceanCoastAt` (named apart from the `oceanCoast` uniform), `oceanShelter`, `oceanSwellSum`, `oceanSwellEval`, `oceanRingCell`, `oceanDisplace`, and the wind sea's `oceanWindFrame`, `oceanWindDisplace`, `oceanWindSlopes`, `oceanWindFold`; in `oceanShade.fragment.fx` the white water and the whitecaps (`oceanFoamCover`, `oceanWhitecap`, `oceanCapCells`, …). Tasks 11 to 13 give the full lists.

### Shared definitions §7: What each tier draws

| | Swell count | `windMode` | Wind sea |
| --- | --- | --- | --- |
| high (WebGPU) | 12 | 2 | `createGpuWindSea`; where it gives null, fails to load or reports `"failed"`, the medium loop instead (mode 1) |
| medium | 12 | 1 | the baked loop (a worker), sampled with `loopScale` and `loopTime` in the wind's frame about the cove's pivot |
| low | 8 | 0 | none drawn; the sea keeps PBR's bump, its slope scaled by the wind sea's height |

On high and medium the sea's bump is off (by define); the lakes do not change.

---

### Task 1: The ocean's physics

**Files:**
- Create: `client/src/game/oceanPhysics.ts`
- Modify: `client/test/architecture.test.ts:445` (the `BABYLON_FREE_FILES` list, after `lensParams.ts`)
- Test: `client/test/game/oceanPhysics.test.ts`

**Interfaces:**
- Consumes: nothing (no earlier module of the sea).
- Produces (`client/src/game/oceanPhysics.ts`, Babylon-free):
  - The shared definitions' constants, names and values exactly: `OCEAN_G = 9.81`, `WEGGEL_GAMMA_MIN = 0.78`, `WEGGEL_GAMMA_MAX = 1.56`, `WEGGEL_SLOPE_MAX = 0.1`, `CALLAGHAN_ONSET = 3.7`, `CALLAGHAN_TOP = 11.25`, `CALLAGHAN_COEFF = 3.18e-5`, `WHITECAP_MAX = 0.1`.
  - `waveNumber(omega: number, depth: number): number` — Fenton–McKee's explicit k = k₀ / tanh((k₀h)^¾)^⅔, then **two** Newton steps on g·k·tanh(kh) − ω² (see the decisions below); `depth` below 0.01 m is taken as 0.01 m; `depth === Infinity`, or k₀·h > 20, returns k₀ = ω²/g exactly.
  - `waveNumberNewton(omega: number, depth: number): number` — Newton to convergence from Eckart's start k₀/√tanh(k₀h) (the tests' reference).
  - `groupSpeed(omega: number, k: number, depth: number): number` — (ω/k)·½(1 + 2kh/sinh 2kh); ω/(2k) at `Infinity` or kh > 20.
  - `shoalingFactor(omega: number, depth: number): number` — √(c_g,deep / c_g(h)); exactly 1 at `Infinity`.
  - `refraction(k0: number, k0z: number, k: number): { kn: number; kr: number }` — kn = √max(k² − k0z², 0), kr = √(cos θ₀/cos θ) with cos θ₀ = √(k0² − k0z²)/k0, cos θ = kn/k; `kr = 1` where kn = 0.
  - `weggelCoefficients(slope: number): { a: number; b: number }` — |slope| clamped to `WEGGEL_SLOPE_MAX`.
  - `breakerIndex(slope: number, height: number, period: number): number` — clamp(b − a·H/(gT²), `WEGGEL_GAMMA_MIN`, `WEGGEL_GAMMA_MAX`).
  - `whitecapCoverage(u10: number): number` — 0 at and below `CALLAGHAN_ONSET` (and for NaN); `CALLAGHAN_COEFF·(U − 3.7)³` up to `CALLAGHAN_TOP`; past it the cubic's tangent at `CALLAGHAN_TOP` (3.4 % at 15 m/s, inside the 2–4 % the research reports, where the bare cubic gives 4.6 %); capped at `WHITECAP_MAX` (reached at about 27 m/s).

Decisions (where the shared definitions leave the detail):
- **Two Newton steps, not one.** Fenton–McKee is within 1.63 % everywhere; one Newton step leaves up to 8.5e-5 relative error (an 11–14 s wave in 9–13 m), which fails the spec's 1e-6 bar; a Halley step instead reaches only 1.07e-6. A second Newton step brings every period from 3 to 16 s at every depth from 0.05 to 200 m to within 2.5e-9. `waveNumber` runs only on the CPU (the tables, about 25,000 calls a world), so the step costs nothing.
- The research's shoaling table is rounded by hand: this code gives 0.914 / 0.943 / 1.088 at 6 s and 1.192 / 1.322 / **1.641** at 15 s (8, 5, 2 m), so those two rows are tested at ±0.015; the 11 s row (1.053 / 1.155 / 1.416) at ±0.01 as asked.
- Values computed while drafting, against exactly this code: 11 s wavelengths 148.35 / 93.11 / 74.90 / 48.18 m at 25 / 8 / 5 / 2 m and 188.92 m deep; 9 s at 5 m 60.41 m; the 30° 11 s swell turns to 14.27° at 8 m and 7.33° at 2 m; γ_b = 0.896 (slope 0.02, 2.9 m, 11 s) and 1.238 (slope 1/12, 1.5 m, 9 s); coverage 0.00114 at 7 m/s, 0.00795 at 10, 0.0137 at 11.25, 0.0341 at 15.

- [ ] **Step 1: Write the failing test**

Create `client/test/game/oceanPhysics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  OCEAN_G, WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX, WEGGEL_SLOPE_MAX,
  CALLAGHAN_ONSET, CALLAGHAN_TOP, CALLAGHAN_COEFF, WHITECAP_MAX,
  waveNumber, waveNumberNewton, groupSpeed, shoalingFactor, refraction,
  weggelCoefficients, breakerIndex, whitecapCoverage,
} from "../../src/game/oceanPhysics.js";

const omega = (period: number): number => (2 * Math.PI) / period;
const length = (period: number, depth: number): number => (2 * Math.PI) / waveNumber(omega(period), depth);

describe("the ocean's constants", () => {
  it("are the values the shaders and tables are built on", () => {
    expect(OCEAN_G).toBe(9.81);
    expect([WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX, WEGGEL_SLOPE_MAX]).toEqual([0.78, 1.56, 0.1]);
    expect([CALLAGHAN_ONSET, CALLAGHAN_TOP, CALLAGHAN_COEFF, WHITECAP_MAX]).toEqual([3.7, 11.25, 3.18e-5, 0.1]);
  });
});

describe("dispersion", () => {
  it("Fenton and McKee's form, refined, is within 1e-6 of Newton's root for periods 3 to 16 s at depths 0.05 to 200 m", () => {
    let worst = 0;
    for (let period = 3; period <= 16.0001; period += 0.25) {
      for (let lnDepth = Math.log(0.05); lnDepth <= Math.log(200) + 1e-9; lnDepth += 0.05) {
        const depth = Math.exp(lnDepth);
        const exact = waveNumberNewton(omega(period), depth);
        worst = Math.max(worst, Math.abs(waveNumber(omega(period), depth) - exact) / exact);
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it("is ω²/g in deep water, by Infinity or by a depth past half a wavelength many times over", () => {
    for (const period of [3, 8, 11, 16]) {
      const k0 = (omega(period) * omega(period)) / 9.81;
      expect(waveNumber(omega(period), Infinity)).toBe(k0);
      expect(waveNumberNewton(omega(period), Infinity)).toBe(k0);
      expect(Math.abs(waveNumber(omega(period), 5000) - k0) / k0).toBeLessThan(1e-12);
    }
    expect(length(11, Infinity)).toBeCloseTo(188.92, 1);
  });

  it("gives the research's wavelengths: an 11 s swell 148, 93, 75 and 48 m long at 25, 8, 5 and 2 m; a 9 s swell 60 m at 5 m", () => {
    expect(Math.abs(length(11, 25) - 148)).toBeLessThan(1);
    expect(Math.abs(length(11, 8) - 93)).toBeLessThan(1);
    expect(Math.abs(length(11, 5) - 75)).toBeLessThan(1);
    expect(Math.abs(length(11, 2) - 48)).toBeLessThan(1);
    expect(Math.abs(length(9, 5) - 60)).toBeLessThan(1);
  });

  it("takes a depth below 0.01 m as 0.01 m and never returns NaN", () => {
    expect(waveNumber(omega(11), 0.001)).toBe(waveNumber(omega(11), 0.01));
    expect(waveNumber(omega(11), 0)).toBe(waveNumber(omega(11), 0.01));
    expect(Number.isFinite(waveNumber(omega(11), 0))).toBe(true);
  });
});

describe("group speed and shoaling", () => {
  it("is half the phase speed in deep water and near √(gh) in shallow water", () => {
    const k0 = waveNumber(omega(11), Infinity);
    expect(groupSpeed(omega(11), k0, Infinity)).toBeCloseTo(9.81 / (2 * omega(11)), 9);
    const k2 = waveNumber(omega(11), 2);
    expect(Math.abs(groupSpeed(omega(11), k2, 2) - Math.sqrt(9.81 * 2)) / Math.sqrt(9.81 * 2)).toBeLessThan(0.04);
  });

  it("gives the research's shoaling coefficients for an 11 s swell: 1.05, 1.15 and 1.42 at 8, 5 and 2 m", () => {
    expect(Math.abs(shoalingFactor(omega(11), 8) - 1.05)).toBeLessThan(0.01);
    expect(Math.abs(shoalingFactor(omega(11), 5) - 1.15)).toBeLessThan(0.01);
    expect(Math.abs(shoalingFactor(omega(11), 2) - 1.42)).toBeLessThan(0.01);
  });

  it("and for 6 s (0.91, 0.94, 1.09) and 15 s (1.19, 1.32, 1.63) at 8, 5 and 2 m, the table's rounding allowed", () => {
    // The research's table rounds by hand; 15 s at 2 m comes to 1.641 here.
    const rows: [number, number[]][] = [[6, [0.91, 0.94, 1.09]], [15, [1.19, 1.32, 1.63]]];
    for (const [period, expected] of rows) {
      [8, 5, 2].forEach((depth, i) => {
        expect(Math.abs(shoalingFactor(omega(period), depth) - expected[i]!)).toBeLessThan(0.015);
      });
    }
  });

  it("is 1 in deep water and dips below 1 before it grows", () => {
    expect(shoalingFactor(omega(11), Infinity)).toBe(1);
    expect(shoalingFactor(omega(6), 8)).toBeLessThan(1);
  });
});

describe("refraction", () => {
  const k0 = waveNumber(omega(11), Infinity);
  const k0z = k0 * Math.sin(Math.PI / 6);
  const angleAt = (depth: number): number => {
    const { kn } = refraction(k0, k0z, waveNumber(omega(11), depth));
    return (Math.atan2(k0z, kn) * 180) / Math.PI;
  };

  it("turns an 11 s swell from 30° offshore to about 14° at 8 m and 7° at 2 m", () => {
    expect(Math.abs(angleAt(8) - 14)).toBeLessThan(1);
    expect(Math.abs(angleAt(2) - 7)).toBeLessThan(1);
  });

  it("keeps the along-shore wavenumber and spreads the crests: K_r under 1 and kn² + k0z² = k²", () => {
    const k = waveNumber(omega(11), 5);
    const { kn, kr } = refraction(k0, k0z, k);
    expect(kn * kn + k0z * k0z).toBeCloseTo(k * k, 12);
    expect(kr).toBeLessThan(1);
    expect(kr).toBeGreaterThan(0.9);
  });

  it("changes nothing offshore: kn = k0x and K_r = 1", () => {
    const { kn, kr } = refraction(k0, k0z, k0);
    expect(kn).toBeCloseTo(k0 * Math.cos(Math.PI / 6), 12);
    expect(kr).toBeCloseTo(1, 12);
  });
});

describe("Weggel's breaker index", () => {
  it("is about 0.9 for the typical swell (2.9 m, 11 s) on the 1:50 bed", () => {
    expect(Math.abs(breakerIndex(0.02, 2.9, 11) - 0.9)).toBeLessThan(0.05);
  });

  it("is about 1.24 for a 1.5 m, 9 s wave on the 1:12 face", () => {
    expect(Math.abs(breakerIndex(1 / 12, 1.5, 9) - 1.24)).toBeLessThan(0.06);
  });

  it("holds the index inside [0.78, 1.56] and takes slopes past 1:10 as 1:10", () => {
    expect(breakerIndex(0, 1, 10)).toBe(0.78);
    expect(breakerIndex(0.001, 10, 4)).toBe(0.78);
    expect(breakerIndex(0.5, 1.5, 9)).toBe(breakerIndex(0.1, 1.5, 9));
    expect(weggelCoefficients(0.5)).toEqual(weggelCoefficients(0.1));
    expect(weggelCoefficients(-0.02)).toEqual(weggelCoefficients(0.02));
    for (let slope = 0; slope <= 0.2; slope += 0.01) {
      for (const height of [0, 0.5, 2, 6]) {
        const gamma = breakerIndex(slope, height, 9);
        expect(gamma).toBeGreaterThanOrEqual(0.78);
        expect(gamma).toBeLessThanOrEqual(1.56);
      }
    }
  });

  it("has Weggel's coefficients: a = 43.8(1 − e^(−19 tanβ)), b = 1.56/(1 + e^(−19.5 tanβ))", () => {
    const { a, b } = weggelCoefficients(0.02);
    expect(a).toBeCloseTo(13.847, 3);
    expect(b).toBeCloseTo(0.9302, 4);
  });
});

describe("whitecap coverage", () => {
  it("is none at 3.7 m/s and below", () => {
    for (const u of [-1, 0, 2, 3.7]) expect(whitecapCoverage(u)).toBe(0);
    expect(whitecapCoverage(Number.NaN)).toBe(0);
  });

  it("is 0.1 to 0.3 % at 7 m/s and about 1 % at 10 m/s", () => {
    expect(whitecapCoverage(7)).toBeGreaterThanOrEqual(0.001);
    expect(whitecapCoverage(7)).toBeLessThanOrEqual(0.003);
    expect(Math.abs(whitecapCoverage(10) - 0.01)).toBeLessThanOrEqual(0.003);
  });

  it("follows the cubic to 11.25 m/s, its tangent past it (a few per cent at 15 m/s), and stops at WHITECAP_MAX", () => {
    expect(whitecapCoverage(11.25)).toBeCloseTo(3.18e-5 * 7.55 ** 3, 12);
    expect(whitecapCoverage(15)).toBeGreaterThan(0.02);
    expect(whitecapCoverage(15)).toBeLessThan(0.04);
    expect(whitecapCoverage(30)).toBe(0.1);
    expect(whitecapCoverage(100)).toBe(0.1);
    let last = 0;
    for (let u = 3.7; u <= 40; u += 0.05) {
      const c = whitecapCoverage(u);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
    const step = 1e-6;
    expect(Math.abs(whitecapCoverage(11.25 + step) - whitecapCoverage(11.25 - step))).toBeLessThan(1e-7);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanPhysics.test.ts`
Expected: FAIL with "Cannot find module '../../src/game/oceanPhysics.js'"

- [ ] **Step 3: Implement**

Create `client/src/game/oceanPhysics.ts`:

```ts
/**
 * The physics of a wave coming in from the open sea, Babylon-free and tested
 * under Node: linear dispersion, group speed, shoaling, refraction on a coast
 * whose depth depends on the distance to shore alone, Weggel's breaker index
 * and Callaghan's whitecap coverage. The tables the sea's shaders read are
 * built from these on the CPU (`oceanTables.ts`); nothing here runs per pixel.
 *
 * Render-side only: nothing here crosses the wire or reaches `sim/`, so
 * `Math.tanh`, `Math.exp` and `Math.pow` are fine.
 * See docs/rendering/2026-10-02-ocean-waves-design.md §4.
 */

/** Gravity, m/s². */
export const OCEAN_G = 9.81;
/** Weggel's breaker index is held inside [MIN, MAX]: 0.78 is the flat-bed value, 1.56 twice it. */
export const WEGGEL_GAMMA_MIN = 0.78;
export const WEGGEL_GAMMA_MAX = 1.56;
/** Weggel's fit holds for bed slopes up to 1:10; steeper slopes are taken as 1:10. */
export const WEGGEL_SLOPE_MAX = 0.1;
/** Wind speed (U10, m/s) below which no whitecap forms. */
export const CALLAGHAN_ONSET = 3.7;
/** The upper end of Callaghan's cubic fit (m/s); past it the cubic goes on along its tangent. */
export const CALLAGHAN_TOP = 11.25;
/** Callaghan's coefficient as a fraction (3.18e-3 per cent): coverage = coeff × (U − onset)³. */
export const CALLAGHAN_COEFF = 3.18e-5;
/** The most of the sea whitecaps cover. */
export const WHITECAP_MAX = 0.1;

/** The shallowest depth the dispersion is solved at (m); shallower depths are taken as this. */
const DEPTH_MIN = 0.01;
/** k·h past which tanh(k·h) is 1 to double precision: deep water. */
const DEEP_KH = 20;

/** f(k) = g·k·tanh(k·h) − ω² and its derivative, for one Newton step at depth h. */
function newtonStep(omega: number, depth: number, k: number): number {
  const t = Math.tanh(k * depth);
  const f = OCEAN_G * k * t - omega * omega;
  const df = OCEAN_G * t + OCEAN_G * k * depth * (1 - t * t);
  return k - f / df;
}

/**
 * The wavenumber (rad/m) of angular frequency ω (rad/s) at depth h (m), from
 * ω² = g k tanh(k h): Fenton and McKee's explicit form,
 * k = k₀ / tanh((k₀ h)^¾)^⅔ with k₀ = ω²/g (within 1.7 % everywhere), then
 * two Newton steps. One step leaves up to 8.5e-5 (a 13.8 s wave in 12.6 m);
 * the second brings every period from 3 to 16 s at every depth to within
 * 1e-8 of the exact root. Depths below 0.01 m are taken as 0.01 m; an infinite
 * depth (or k₀·h past 20) is deep water, k = k₀.
 */
export function waveNumber(omega: number, depth: number): number {
  const k0 = (omega * omega) / OCEAN_G;
  if (depth === Infinity || k0 * depth > DEEP_KH) return k0;
  const h = Math.max(depth, DEPTH_MIN);
  let k = k0 / Math.pow(Math.tanh(Math.pow(k0 * h, 0.75)), 2 / 3);
  k = newtonStep(omega, h, k);
  k = newtonStep(omega, h, k);
  return k;
}

/**
 * The reference root of ω² = g k tanh(k h), Newton's method run to
 * convergence from Eckart's start k₀ / √tanh(k₀ h). For the tests; the sea
 * uses `waveNumber`.
 */
export function waveNumberNewton(omega: number, depth: number): number {
  const k0 = (omega * omega) / OCEAN_G;
  if (depth === Infinity) return k0;
  const h = Math.max(depth, DEPTH_MIN);
  let k = k0 / Math.sqrt(Math.tanh(k0 * h));
  for (let i = 0; i < 100; i++) {
    const next = newtonStep(omega, h, k);
    const done = Math.abs(next - k) <= 1e-15 * next;
    k = next;
    if (done) break;
  }
  return k;
}

/** Group speed (m/s): (ω/k)·½(1 + 2kh / sinh 2kh); ω/(2k) in deep water. */
export function groupSpeed(omega: number, k: number, depth: number): number {
  const kh = k * Math.max(depth, DEPTH_MIN);
  const n = depth === Infinity || kh > DEEP_KH ? 0.5 : 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
  return (omega / k) * n;
}

/**
 * The shoaling coefficient K_s = √(c_g,deep / c_g(h)) (H² c_g conserved): it
 * dips to about 0.91 at intermediate depth, then grows toward the shore.
 */
export function shoalingFactor(omega: number, depth: number): number {
  const deep = OCEAN_G / (2 * omega);
  return Math.sqrt(deep / groupSpeed(omega, waveNumber(omega, depth), depth));
}

/**
 * Snell's law on a coast running along z: a component keeps its along-shore
 * wavenumber k0z, so at local wavenumber k its onshore wavenumber is
 * kn = √(k² − k0z²), and the crests' spreading gives the refraction
 * coefficient K_r = √(cos θ₀ / cos θ), with cos θ₀ = √(k0² − k0z²)/k0 and
 * cos θ = kn/k. `k0` is the offshore wavenumber's magnitude.
 */
export function refraction(k0: number, k0z: number, k: number): { kn: number; kr: number } {
  const kn = Math.sqrt(Math.max(k * k - k0z * k0z, 0));
  const cos0 = Math.sqrt(Math.max(k0 * k0 - k0z * k0z, 0)) / k0;
  const cos = kn / k;
  return { kn, kr: cos > 0 ? Math.sqrt(cos0 / cos) : 1 };
}

/**
 * Weggel's coefficients for a bed slope tan β (taken as at most
 * WEGGEL_SLOPE_MAX): a = 43.8 (1 − e^(−19 tan β)), b = 1.56 / (1 + e^(−19.5 tan β)).
 */
export function weggelCoefficients(slope: number): { a: number; b: number } {
  const s = Math.min(Math.abs(slope), WEGGEL_SLOPE_MAX);
  return { a: 43.8 * (1 - Math.exp(-19 * s)), b: 1.56 / (1 + Math.exp(-19.5 * s)) };
}

/**
 * Weggel's breaker index γ_b = b − a·H/(g T²) for a wave of local height H (m)
 * and period T (s) on a bed of slope tan β, held inside
 * [WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX]: about 0.9 for the typical swell on a
 * 1:50 bed, about 1.24 on a 1:12 face. The wave breaks where H > γ_b h.
 */
export function breakerIndex(slope: number, height: number, period: number): number {
  const { a, b } = weggelCoefficients(slope);
  const gamma = b - (a * height) / (OCEAN_G * period * period);
  return Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, gamma));
}

/**
 * The fraction of the sea whitecaps cover at wind speed U10 (m/s), from
 * Callaghan's fit 3.18e-3 (U − 3.7)³ per cent: none at 3.7 m/s and below,
 * 0.11 % at 7 m/s, 0.8 % at 10. Past the fit's upper end (CALLAGHAN_TOP) the
 * cubic goes on along its tangent there (3.4 % at 15 m/s, inside the 2 to 4 %
 * observed), and the whole is capped at WHITECAP_MAX.
 */
export function whitecapCoverage(u10: number): number {
  if (!(u10 > CALLAGHAN_ONSET)) return 0;
  const top = CALLAGHAN_TOP - CALLAGHAN_ONSET;
  const x = u10 - CALLAGHAN_ONSET;
  const cover =
    x <= top ? CALLAGHAN_COEFF * x * x * x : CALLAGHAN_COEFF * top * top * (top + 3 * (x - top));
  return Math.min(WHITECAP_MAX, cover);
}
```

In `client/test/architecture.test.ts`, test "the pure game/ arithmetic modules stay Babylon-free", add the module to `BABYLON_FREE_FILES` (line 445 is `lensParams.ts`, the list's last entry today):

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "oceanPhysics.ts"),
    ];
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanPhysics.test.ts test/architecture.test.ts`
Expected: PASS (19 tests in `oceanPhysics.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanPhysics.ts client/test/game/oceanPhysics.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the swell's physics from deep water to the break

## What

The physics a swell needs on its way in from the open sea, Babylon-free and
tested under Node: linear dispersion (Fenton and McKee's explicit wavenumber,
refined by two Newton steps to within 1e-8 of the exact root), group speed,
shoaling, refraction on a coast whose depth follows the distance to shore,
Weggel's breaker index and Callaghan's whitecap coverage, each held to the
published values for this coast: an 11 s swell 75 m long and 1.15 times as
high at 5 m, turned from 30° to about 7° by 2 m, breaking at about 0.9 of the
depth on a 1:50 bed and 1.24 on a 1:12 face.

## How

- `client/src/game/oceanPhysics.ts` — the constants and `waveNumber`, `waveNumberNewton`, `groupSpeed`, `shoalingFactor`, `refraction`, `weggelCoefficients`, `breakerIndex`, `whitecapCoverage`
- `client/test/game/oceanPhysics.test.ts` — dispersion against Newton's root, the wavelengths, shoaling and turning at 8, 5 and 2 m, the breaker index, whitecap coverage
- `client/test/architecture.test.ts` — the module joins the Babylon-free list

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 2: The wind sea's spectrum and a CPU FFT

**Files:**
- Create: `client/src/game/oceanSpectrum.ts`
- Create: `client/src/game/oceanFft.ts`
- Modify: `client/test/architecture.test.ts:446` (the `BABYLON_FREE_FILES` list, after Task 1's `oceanPhysics.ts`)
- Test: `client/test/game/oceanSpectrum.test.ts`
- Test: `client/test/game/oceanFft.test.ts`

**Interfaces:**
- Consumes: `OCEAN_G` from `client/src/game/oceanPhysics.ts` (Task 1).
- Produces, `client/src/game/oceanFft.ts` (Babylon-free; imports nothing):
  - Conventions every later user of the wind sea keeps (Tasks 3 and 13): an n × n grid is stored row by row, index `row·n + col`; in a spectrum the column is the x frequency and the row the z frequency in FFT order (`fftWaveIndex`), so bin (col, row) of a tile `size` metres across has k = (2π/size)·(fftWaveIndex(col, n), fftWaveIndex(row, n)); in a field, sample (col, row) sits at (x, z) = (col, row)·size/n, so a texel (x, z) of the GPU's textures is uv = world (x, z) / size. The inverse is unnormalised, h(x) = Σ H(k) e^{+ik·x}. Each component travels along +k: H(k, t) = h0(k) e^{−iωt} + conj(h0(−k)) e^{+iωt}.
  - **The displacement is D(k) = +i·k̂·H(k)** (not −i·k̂·h): with the +ik·x inverse, −i k̂ H displaces a wave A cos θ by +k̂ A sin θ, which sharpens the troughs and folds the Jacobian at the troughs; +i k̂ H gives −k̂ A sin θ, the sign of the swell's own Gerstner displacement in Shared definitions §5 (`dx, dz = −Σ Q A D sin φ`), so the crests sharpen and fold where whitecaps belong. The slopes are i·k·H, the Jacobian's derivatives −(kₐk_b/|k|)·H.
  - `type SpectrumH0 = { re: Float32Array; im: Float32Array; omega: Float32Array }` (the shared definitions' h0 shape, named).
  - `type ComplexGrid = [Float32Array, Float32Array]`.
  - `type WindSeaSpectra = { height; dx; dz; sx; sz; dxdx; dzdz; dxdz: ComplexGrid }` — the shared definitions' five fields plus the three derivatives the Jacobian needs (∂dx/∂x, ∂dz/∂z, ∂dx/∂z = ∂dz/∂x), unscaled by the choppiness.
  - `type WindSeaFields = { height; dx; dz; slopeX; slopeZ; jacobian: Float32Array }` (the shared definitions' return of `windSeaFields`, named).
  - `WIND_SEA_CHOPPINESS = 1` — the λ the high tier displaces by (new; the shared definitions' `GpuWindSea` has no choppiness argument).
  - `fftWaveIndex(m: number, n: number): number` — 0 … n/2 − 1, then −n/2 … −1.
  - `fftInverseLine(re, im, offset, stride, n, scratchRe: Float64Array, scratchIm: Float64Array): void` — one line's radix-2 Stockham inverse FFT, in place, exactly the GPU pass's algorithm (Task 3); its six lines marked `// stockham: <name>` are compared token for token with the WGSL's.
  - `fft2dInverse(re: Float32Array, im: Float32Array, n: number): void` — every row, then every column, by `fftInverseLine`; 32-bit storage between passes.
  - `dft2dInverse(re, im, n): { re: Float32Array; im: Float32Array }` — the direct O(n⁴) reference.
  - `evolveSpectrum(h0: SpectrumH0, n: number, size: number, t: number): WindSeaSpectra`.
  - `windSeaFields(h0: SpectrumH0, n: number, size: number, t: number, choppiness: number): WindSeaFields` — packs two real fields a complex grid exactly as the GPU does — (height + i·dx, dz + i·slopeX, slopeZ + i·∂dx/∂x, ∂dz/∂z + i·∂dx/∂z) — runs four inverse FFTs, scales dx, dz by λ and forms J = (1 + λ∂dx/∂x)(1 + λ∂dz/∂z) − λ²(∂dx/∂z)².
- Produces, `client/src/game/oceanSpectrum.ts` (Babylon-free):
  - The shared definitions' `FFT_N = 256`, `FFT_CASCADES = [1000, 150, 25] as const`, `LOOP_N = 128`, `LOOP_SIZE = 60`, `LOOP_FRAMES = 64`, `LOOP_SECONDS = 20`, `WIND_SEA_SALT = 0x0ce4`, housed here (the shared definitions name three possible files; this is the Babylon-free one a worker can import).
  - `WIND_SEA_HS_COEFF = 0.28`, `WIND_SEA_FP_COEFF = 0.123`, `WIND_SEA_SPREAD = 10`, `WIND_SEA_GAMMA = 3.3` — **defined here, not in `oceanWindSea.ts`** (a departure in place only; names and values are the shared definitions'): `windSeaH0` takes `{ u10, dir }` and needs them two tasks before `oceanWindSea.ts` exists. Task 9 re-exports them so they are importable from `oceanWindSea.ts` as the shared definitions list: `export { WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA } from "./oceanSpectrum.js";`.
  - `WIND_SEA_REPEAT = 1024` (s, new): each bin's ω is rounded to a multiple of 2π/1024 (at most 0.003 rad/s off √(gk)), so the sea repeats every 1,024 s and the GPU takes the time folded into [0, 1024) — its single-precision phase and time stay fine however long a game runs.
  - `jonswap(f, fp, hs, gamma): number` — S(f) in m²/Hz, σ 0.07/0.09, normalised so 4√∫S df = hs (the shape's integral by Simpson to f/fp = 3 plus the tail's closed form, cached per γ); 0 for f ≤ 0, fp ≤ 0 or hs ≤ 0.
  - `spreading(theta, s): number` — N(s)·cos^{2s}(θ/2), θ wrapped to (−π, π], N(s) = 2^{2s} Γ(s+1)² / (2π Γ(2s+1)) by a Lanczos ln Γ; s < 0 taken as 0.
  - `cascadeBands(sizes, n): { kMin; kMax }[]` — the shared definitions' formula, with **kMin₀ = 0** (decided: the coarsest cascade carries everything below band 1, its DC bin zero): for 1000/150/25 m and n 256, [0, 0.16755), [0.16755, 1.00531), [1.00531, 32.16991).
  - `windSeaCascadeSeed(seed: number, cascade: number): number` (new) — `(seed + imul(cascade + 1, 0x9e3779b9)) >>> 0`, so no two cascades draw the same numbers (their index sets overlap in |k|).
  - `windSeaH0(n, size, state: { u10: number; dir: [number, number] }, band, seed, repeat = WIND_SEA_REPEAT): SpectrumH0` — the shared definitions' signature plus an optional `repeat` (s) the ω are rounded to (Task 13's loop passes `LOOP_SECONDS`). `dir` is the way the wind blows (x, z); fully developed JONSWAP for U = u10 (Hs = 0.28U²/g, fp = 0.123g/U, γ 3.3, s 10); h0 = (ξ₁ + iξ₂)·½Δk·√(c·F(k)), F = S(f)(df/dk)D(θ)/k, ξ standard normal by Box–Muller from a lowbias32 hash of (seed ^ `WIND_SEA_SALT`, row, col); c is the one factor that makes Σ c F Δk² over the band's bins equal the band's share ∫S df (without it the coarse rings near a band's inner edge carried up to 21 % too much, measured); zero outside [kMin, kMax), at DC and on the Nyquist row and column; all zero for u10 ≤ 0. About 5 ms a 256² cascade.
- Measured while drafting, against this code: over 32 seeds at u10 = 10 the drawn field's variance over the band's share is 1.029, 1.021 and 0.995 for the three cascades; JONSWAP's 4√m₀ is within 1e-5 of hs for four (fp, hs, γ); spreading integrates to 1 within 1e-11 for s from 0 to 75.

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/oceanSpectrum.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  FFT_N, FFT_CASCADES, LOOP_N, LOOP_SIZE, LOOP_FRAMES, LOOP_SECONDS, WIND_SEA_SALT,
  WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA, WIND_SEA_REPEAT,
  jonswap, spreading, cascadeBands, windSeaCascadeSeed, windSeaH0,
} from "../../src/game/oceanSpectrum.js";
import { evolveSpectrum, fft2dInverse, fftWaveIndex } from "../../src/game/oceanFft.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** ∫ S df by the midpoint rule over [lo, hi). */
function integrate(fn: (f: number) => number, lo: number, hi: number, steps: number): number {
  const h = (hi - lo) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += fn(lo + (i + 0.5) * h);
  return sum * h;
}

describe("the wind sea's constants", () => {
  it("are the cascades, the loop and the sea state the design sets", () => {
    expect(FFT_N).toBe(256);
    expect([...FFT_CASCADES]).toEqual([1000, 150, 25]);
    expect([LOOP_N, LOOP_SIZE, LOOP_FRAMES, LOOP_SECONDS]).toEqual([128, 60, 64, 20]);
    expect(WIND_SEA_SALT).toBe(0x0ce4);
    expect([WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA]).toEqual([0.28, 0.123, 10, 3.3]);
    expect(WIND_SEA_REPEAT).toBe(1024);
  });
});

describe("JONSWAP", () => {
  it("is normalised so that 4√(∫S df) is the significant height", () => {
    const cases: [number, number, number][] = [[0.1, 2, 3.3], [0.3, 0.5, 1], [0.07, 4, 7], [0.12, 2.85, 3.3]];
    for (const [fp, hs, gamma] of cases) {
      const m0 = integrate((f) => jonswap(f, fp, hs, gamma), 0, 5, 500_000);
      expect(Math.abs(4 * Math.sqrt(m0) - hs) / hs).toBeLessThan(1e-4);
    }
  });

  it("peaks at fp, and at γ = 1 is Pierson–Moskowitz's shape", () => {
    expect(jonswap(0.1, 0.1, 2, 3.3)).toBeGreaterThan(jonswap(0.095, 0.1, 2, 3.3));
    expect(jonswap(0.1, 0.1, 2, 3.3)).toBeGreaterThan(jonswap(0.105, 0.1, 2, 3.3));
    for (const x of [0.8, 1.2, 2, 4]) {
      const pm = Math.pow(1 / x, 5) * Math.exp(-1.25 * (Math.pow(1 / x, 4) - 1));
      expect(jonswap(0.1 * x, 0.1, 2, 1) / jonswap(0.1, 0.1, 2, 1)).toBeCloseTo(pm, 9);
    }
  });

  it("is zero at and below f = 0, and for no sea", () => {
    expect(jonswap(0, 0.1, 2, 3.3)).toBe(0);
    expect(jonswap(-0.1, 0.1, 2, 3.3)).toBe(0);
    expect(jonswap(0.1, 0, 2, 3.3)).toBe(0);
    expect(jonswap(0.1, 0.1, 0, 3.3)).toBe(0);
  });
});

describe("cos-2s spreading", () => {
  it("integrates to 1 over a turn for every s", () => {
    for (const s of [0, 1, 2.5, 10, 25, 75]) {
      expect(integrate((theta) => spreading(theta, s), -Math.PI, Math.PI, 100_000)).toBeCloseTo(1, 8);
    }
  });

  it("peaks along the mean direction, is symmetric, wraps every turn and is zero straight against it", () => {
    expect(spreading(0, 10)).toBeCloseTo(0.903278, 5);
    expect(spreading(0.3, 10)).toBeLessThan(spreading(0, 10));
    expect(spreading(-0.4, 10)).toBeCloseTo(spreading(0.4, 10), 12);
    expect(spreading(0.4 + 2 * Math.PI, 10)).toBeCloseTo(spreading(0.4, 10), 12);
    expect(spreading(Math.PI, 10)).toBeLessThan(1e-12);
    expect(spreading(1, 0)).toBeCloseTo(1 / (2 * Math.PI), 12);
  });
});

describe("the cascades' bands", () => {
  const bands = cascadeBands(FFT_CASCADES, FFT_N);

  it("run from 0 to the finest cascade's Nyquist wavenumber, each ending at four of the next cascade's fundamentals", () => {
    expect(bands.length).toBe(3);
    expect(bands[0]!.kMin).toBe(0);
    expect(bands[0]!.kMax).toBeCloseTo(0.1675516, 6);
    expect(bands[1]!.kMin).toBeCloseTo(0.1675516, 6);
    expect(bands[1]!.kMax).toBeCloseTo(1.0053096, 6);
    expect(bands[2]!.kMin).toBeCloseTo(1.0053096, 6);
    expect(bands[2]!.kMax).toBeCloseTo(32.1699088, 6);
  });

  it("are contiguous and do not overlap, and each fits under its own cascade's Nyquist wavenumber", () => {
    for (let i = 0; i < bands.length; i++) {
      expect(bands[i]!.kMin).toBeLessThan(bands[i]!.kMax);
      if (i > 0) expect(bands[i]!.kMin).toBe(bands[i - 1]!.kMax);
      expect(bands[i]!.kMax).toBeLessThanOrEqual((Math.PI * FFT_N) / FFT_CASCADES[i]! + 1e-12);
    }
  });
});

describe("the wind sea's h0", () => {
  const bands = cascadeBands(FFT_CASCADES, FFT_N);
  const state = { u10: 10, dir: [0.6, 0.8] as [number, number] };

  it("is the same for the same seed, and another for another seed", () => {
    const a = windSeaH0(64, 150, state, bands[1]!, 7);
    const b = windSeaH0(64, 150, state, bands[1]!, 7);
    const c = windSeaH0(64, 150, state, bands[1]!, 8);
    expect(b.re).toEqual(a.re);
    expect(b.im).toEqual(a.im);
    expect(b.omega).toEqual(a.omega);
    expect(c.re).not.toEqual(a.re);
    expect(windSeaCascadeSeed(7, 0)).not.toBe(windSeaCascadeSeed(7, 1));
  });

  it("is zero outside the band, at the DC bin and on the Nyquist row and column", () => {
    const n = 64;
    const size = 150;
    const h0 = windSeaH0(n, size, state, bands[1]!, 7);
    let inside = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const k = ((2 * Math.PI) / size) * Math.hypot(fftWaveIndex(col, n), fftWaveIndex(row, n));
        const i = row * n + col;
        const outside = k < bands[1]!.kMin || k >= bands[1]!.kMax || row === n / 2 || col === n / 2 || k === 0;
        if (outside) {
          expect(h0.re[i]).toBe(0);
          expect(h0.im[i]).toBe(0);
        } else if (h0.re[i] !== 0) {
          inside++;
        }
      }
    }
    expect(inside).toBeGreaterThan(100);
  });

  it("has deep water's dispersion, ω = √(g|k|) rounded to a multiple of 2π/1024", () => {
    const n = 32;
    const size = 25;
    const h0 = windSeaH0(n, size, state, bands[2]!, 3);
    const quantum = (2 * Math.PI) / 1024;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const k = ((2 * Math.PI) / size) * Math.hypot(fftWaveIndex(col, n), fftWaveIndex(row, n));
        const w = h0.omega[row * n + col]!;
        expect(Math.abs(w - Math.sqrt(9.81 * k))).toBeLessThanOrEqual(quantum / 2 + 1e-5);
        expect(Math.abs(w / quantum - Math.round(w / quantum))).toBeLessThan(1e-3);
      }
    }
  });

  it("is still for no wind", () => {
    const h0 = windSeaH0(32, 150, { u10: 0, dir: [1, 0] }, bands[1]!, 3);
    expect(h0.re.every((v) => v === 0)).toBe(true);
    expect(h0.im.every((v) => v === 0)).toBe(true);
  });

  it("puts its energy downwind", () => {
    const n = 64;
    const h0 = windSeaH0(n, 1000, state, bands[0]!, 11);
    let down = 0;
    let up = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const along = fftWaveIndex(col, n) * 0.6 + fftWaveIndex(row, n) * 0.8;
        const energy = h0.re[row * n + col]! ** 2 + h0.im[row * n + col]! ** 2;
        if (along > 0) down += energy;
        else if (along < 0) up += energy;
      }
    }
    expect(down).toBeGreaterThan(100 * up);
  });

  it("gives a field whose variance, over 32 seeds, is within 10 % of its band's share of the spectrum, on every cascade", () => {
    const hs = (0.28 * 10 * 10) / 9.81;
    const fp = (0.123 * 9.81) / 10;
    for (let c = 0; c < 3; c++) {
      const band = bands[c]!;
      const fLo = Math.sqrt(9.81 * band.kMin) / (2 * Math.PI);
      const fHi = Math.sqrt(9.81 * band.kMax) / (2 * Math.PI);
      const share = integrate((f) => jonswap(f, fp, hs, 3.3), fLo, fHi, 200_000);
      let mean = 0;
      for (let s = 0; s < 32; s++) {
        const h0 = windSeaH0(FFT_N, FFT_CASCADES[c]!, state, band, windSeaCascadeSeed(20261002 + s, c));
        const spectrum = evolveSpectrum(h0, FFT_N, FFT_CASCADES[c]!, 0);
        let variance = 0;
        for (let i = 0; i < FFT_N * FFT_N; i++) variance += spectrum.height[0][i]! ** 2 + spectrum.height[1][i]! ** 2;
        mean += variance / 32;
      }
      expect(Math.abs(mean / share - 1)).toBeLessThan(0.1);
    }
  }, timeLimit(60_000));

  it("by Parseval: the field's mean square is the spectrum's sum of squares", () => {
    const n = 64;
    const h0 = windSeaH0(n, 150, state, bands[1]!, 5);
    const spectrum = evolveSpectrum(h0, n, 150, 0);
    let sum = 0;
    for (let i = 0; i < n * n; i++) sum += spectrum.height[0][i]! ** 2 + spectrum.height[1][i]! ** 2;
    const [re, im] = spectrum.height;
    fft2dInverse(re, im, n);
    let meanSquare = 0;
    for (let i = 0; i < n * n; i++) meanSquare += re[i]! ** 2 / (n * n);
    expect(Math.abs(meanSquare / sum - 1)).toBeLessThan(1e-4);
  });
});
```

Create `client/test/game/oceanFft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WIND_SEA_CHOPPINESS, fftWaveIndex, fftInverseLine, fft2dInverse, dft2dInverse, evolveSpectrum, windSeaFields,
  type SpectrumH0,
} from "../../src/game/oceanFft.js";
import { cascadeBands, windSeaH0 } from "../../src/game/oceanSpectrum.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** Deterministic numbers in [−1, 1) (mulberry32). */
function randoms(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function randomGrid(n: number, seed: number): [Float32Array, Float32Array] {
  const next = randoms(seed);
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    re[i] = next();
    im[i] = next();
  }
  return [re, im];
}

/** A spectrum of one wave: h0 = amplitude/2 at (col, row), so the field is amplitude·cos(k·x − ωt). */
function oneWave(n: number, col: number, row: number, amplitude: number, omega: number): SpectrumH0 {
  const h0: SpectrumH0 = { re: new Float32Array(n * n), im: new Float32Array(n * n), omega: new Float32Array(n * n) };
  h0.re[row * n + col] = amplitude / 2;
  h0.omega[row * n + col] = omega;
  h0.omega[((n - row) % n) * n + ((n - col) % n)] = omega;
  return h0;
}

describe("the inverse FFT", () => {
  it("numbers frequencies in FFT order", () => {
    expect([0, 1, 7, 8, 9, 15].map((m) => fftWaveIndex(m, 16))).toEqual([0, 1, 7, -8, -7, -1]);
  });

  it("equals the direct inverse DFT within 1e-4 on random 8², 16² and 32² grids", () => {
    for (const n of [8, 16, 32]) {
      const [re, im] = randomGrid(n, n);
      const expected = dft2dInverse(re, im, n);
      fft2dInverse(re, im, n);
      for (let i = 0; i < n * n; i++) {
        expect(Math.abs(re[i]! - expected.re[i]!)).toBeLessThan(1e-4);
        expect(Math.abs(im[i]! - expected.im[i]!)).toBeLessThan(1e-4);
      }
    }
  }, timeLimit(30_000));

  it("transforms one strided line of 256 as the 1-D inverse DFT does", () => {
    const n = 256;
    const stride = 3;
    const next = randoms(256);
    const re = new Float32Array(n * stride + 1);
    const im = new Float32Array(n * stride + 1);
    for (let i = 0; i < n; i++) {
      re[1 + i * stride] = next();
      im[1 + i * stride] = next();
    }
    const inRe = Array.from({ length: n }, (_, i) => re[1 + i * stride]!);
    const inIm = Array.from({ length: n }, (_, i) => im[1 + i * stride]!);
    fftInverseLine(re, im, 1, stride, n, new Float64Array(2 * n), new Float64Array(2 * n));
    for (let x = 0; x < n; x++) {
      let sr = 0;
      let si = 0;
      for (let m = 0; m < n; m++) {
        const a = (2 * Math.PI * ((m * x) % n)) / n;
        sr += inRe[m]! * Math.cos(a) - inIm[m]! * Math.sin(a);
        si += inRe[m]! * Math.sin(a) + inIm[m]! * Math.cos(a);
      }
      expect(Math.abs(re[1 + x * stride]! - sr)).toBeLessThan(1e-4);
      expect(Math.abs(im[1 + x * stride]! - si)).toBeLessThan(1e-4);
    }
  });
});

describe("the wind sea's evolution", () => {
  const n = 16;
  const size = 64;
  const g = 9.81;

  it("turns one wave's spectrum into that cosine, moving along +k at ω", () => {
    const col = 3;
    const row = 14; // z wave index −2
    const kx = (2 * Math.PI * 3) / size;
    const kz = (2 * Math.PI * -2) / size;
    const k = Math.hypot(kx, kz);
    const omega = Math.sqrt(g * k);
    const h0 = oneWave(n, col, row, 0.8, omega);
    for (const t of [0, 1.3]) {
      const fields = windSeaFields(h0, n, size, t, 1);
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const theta = kx * ((x * size) / n) + kz * ((z * size) / n) - omega * t;
          const i = z * n + x;
          expect(fields.height[i]).toBeCloseTo(0.8 * Math.cos(theta), 5);
          // The crest sharpens: points gather under it (−k̂ A sin θ).
          expect(fields.dx[i]).toBeCloseTo(-(kx / k) * 0.8 * Math.sin(theta), 5);
          expect(fields.dz[i]).toBeCloseTo(-(kz / k) * 0.8 * Math.sin(theta), 5);
          expect(fields.slopeX[i]).toBeCloseTo(-kx * 0.8 * Math.sin(theta), 5);
          expect(fields.slopeZ[i]).toBeCloseTo(-kz * 0.8 * Math.sin(theta), 5);
          // J = 1 − λ A k cos θ for one wave: the fold is at the crest.
          expect(fields.jacobian[i]).toBeCloseTo(1 - 0.8 * k * Math.cos(theta), 5);
        }
      }
    }
  });

  it("gives real fields: every spectrum's inverse has imaginary parts under 1e-5", () => {
    const m = 64;
    const bands = cascadeBands([1000, 150, 25], 256);
    const h0 = windSeaH0(m, 25, { u10: 12, dir: [1, 0] }, { kMin: bands[2]!.kMin, kMax: (Math.PI * m) / 25 }, 9);
    const spectra = evolveSpectrum(h0, m, 25, 37.25);
    for (const [re, im] of Object.values(spectra)) {
      fft2dInverse(re, im, m);
      let largest = 0;
      for (let i = 0; i < m * m; i++) largest = Math.max(largest, Math.abs(im[i]!));
      expect(largest).toBeLessThan(1e-5);
    }
  });

  it("packs two fields a grid as the GPU does, and unpacks to the fields transformed one by one", () => {
    const m = 32;
    const h0 = windSeaH0(m, 150, { u10: 8, dir: [0.8, -0.6] }, { kMin: 0.1, kMax: (Math.PI * m) / 150 }, 4);
    const t = 12.5;
    const fields = windSeaFields(h0, m, 150, t, 0.7);
    const spectra = evolveSpectrum(h0, m, 150, t);
    const alone = (grid: [Float32Array, Float32Array]): Float32Array => {
      const re = grid[0].slice();
      fft2dInverse(re, grid[1].slice(), m);
      return re;
    };
    const height = alone(spectra.height);
    const dx = alone(spectra.dx);
    const sz = alone(spectra.sz);
    const dxdx = alone(spectra.dxdx);
    const dzdz = alone(spectra.dzdz);
    const dxdz = alone(spectra.dxdz);
    for (let i = 0; i < m * m; i++) {
      expect(fields.height[i]).toBeCloseTo(height[i]!, 5);
      expect(fields.dx[i]).toBeCloseTo(0.7 * dx[i]!, 5);
      expect(fields.slopeZ[i]).toBeCloseTo(sz[i]!, 5);
      const j = (1 + 0.7 * dxdx[i]!) * (1 + 0.7 * dzdz[i]!) - 0.49 * dxdz[i]! ** 2;
      expect(fields.jacobian[i]).toBeCloseTo(j, 4);
    }
  });

  it("has a Jacobian of 1 and no displacement everywhere at λ = 0", () => {
    const m = 32;
    const h0 = windSeaH0(m, 25, { u10: 15, dir: [0, 1] }, { kMin: 1, kMax: (Math.PI * m) / 25 }, 2);
    const fields = windSeaFields(h0, m, 25, 3, 0);
    for (let i = 0; i < m * m; i++) {
      expect(fields.jacobian[i]).toBe(1);
      expect(Math.abs(fields.dx[i]!)).toBe(0);
      expect(Math.abs(fields.dz[i]!)).toBe(0);
    }
    expect(fields.height.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  });

  it("repeats every 1024 s, its frequencies rounded to the repeat (to their single precision)", () => {
    const m = 32;
    const h0 = windSeaH0(m, 150, { u10: 10, dir: [1, 0] }, { kMin: 0.1, kMax: (Math.PI * m) / 150 }, 6);
    const a = windSeaFields(h0, m, 150, 40, WIND_SEA_CHOPPINESS);
    const b = windSeaFields(h0, m, 150, 40 + 1024, WIND_SEA_CHOPPINESS);
    for (let i = 0; i < m * m; i++) expect(b.height[i]).toBeCloseTo(a.height[i]!, 3);
    expect(WIND_SEA_CHOPPINESS).toBe(1);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --root client test/game/oceanSpectrum.test.ts test/game/oceanFft.test.ts`
Expected: FAIL with "Cannot find module '../../src/game/oceanSpectrum.js'" and "Cannot find module '../../src/game/oceanFft.js'"

- [ ] **Step 3: Implement**

Create `client/src/game/oceanFft.ts`:

```ts
/**
 * The wind sea's FFT on the CPU, Babylon-free and tested under Node: the
 * reference the high tier's WebGPU passes are held to (`oceanGpuFft.ts`), and
 * the engine of the medium tier's loop, baked on a worker.
 *
 * Conventions, shared with the WGSL in shaders/oceanFft*.compute.wgsl:
 * - A grid of n × n (n a power of two) is stored row by row: index
 *   row·n + col. In the spectrum the column is the x frequency and the row
 *   the z frequency, in FFT order (`fftWaveIndex`: 0 … n/2 − 1, then −n/2 … −1),
 *   so the wavenumber of column m on a tile `size` metres across is
 *   2π·fftWaveIndex(m, n)/size. In the field the column is x and the row z,
 *   sample (col, row) at (col, row)·size/n.
 * - The inverse transform is unnormalised: h(x) = Σ_k H(k) e^{+i k·x}.
 * - Each component travels along +k: H(k, t) = h0(k) e^{−iωt} + conj(h0(−k)) e^{+iωt}.
 * - The horizontal displacement is D(k) = i (k/|k|) H(k), so a wave
 *   A cos(k·x − ωt) is displaced by −k̂ A sin(k·x − ωt): points gather under
 *   the crest and the crest sharpens, as the swell's trochoid does (the
 *   design's §5), and the Jacobian folds at the crest.
 *
 * Render-side only; `Math.cos` and friends are fine here.
 * See docs/rendering/2026-10-02-ocean-waves-design.md §6.
 */

/** A spectrum's starting amplitudes and each bin's angular frequency, n × n. */
export type SpectrumH0 = { re: Float32Array; im: Float32Array; omega: Float32Array };
/** A complex grid as its real and imaginary parts. */
export type ComplexGrid = [Float32Array, Float32Array];
/** The complex spectra of the wind sea's fields at one time: the height, the
 * horizontal displacement (unscaled by the choppiness), the slopes, and the
 * displacement's derivatives the Jacobian is made of. */
export type WindSeaSpectra = {
  height: ComplexGrid;
  dx: ComplexGrid;
  dz: ComplexGrid;
  sx: ComplexGrid;
  sz: ComplexGrid;
  /** ∂dx/∂x, ∂dz/∂z and ∂dx/∂z (= ∂dz/∂x). */
  dxdx: ComplexGrid;
  dzdz: ComplexGrid;
  dxdz: ComplexGrid;
};
/** One frame of the wind sea in space, n × n each. */
export type WindSeaFields = {
  height: Float32Array;
  dx: Float32Array;
  dz: Float32Array;
  slopeX: Float32Array;
  slopeZ: Float32Array;
  jacobian: Float32Array;
};

/** The choppiness λ the high tier displaces its wind sea by: the trochoid's
 * own (a wave A cos θ is displaced by λ·A sin θ), so the crests sharpen as the
 * swell's do and fold where the sea is steep. */
export const WIND_SEA_CHOPPINESS = 1;

const PI = Math.PI;

/** Frequency index m of an n-point FFT as a signed wave index: 0 … n/2 − 1, then −n/2 … −1. */
export function fftWaveIndex(m: number, n: number): number {
  return m < n / 2 ? m : m - n;
}

/**
 * One line's inverse FFT, in place: the n values at `offset`, `offset +
 * stride`, … of (re, im). A radix-2 Stockham FFT in the order the GPU pass
 * runs it (shaders/oceanFftPass.compute.wgsl, one workgroup a line): the line
 * is read into a scratch of 2n values (the pass's workgroup array), then
 * log2(n) stages each read one half of the scratch and write the other,
 * invocation j of n/2 taking the butterfly of elements j and j + n/2. The
 * lines marked `stockham:` are the pass's own, token for token but for
 * WGSL's casts, its unsigned literals and its constant N for n
 * (`oceanGpuFft.test.ts` compares them). `scratchRe` and `scratchIm` hold at
 * least 2n values.
 */
export function fftInverseLine(
  re: Float32Array,
  im: Float32Array,
  offset: number,
  stride: number,
  n: number,
  scratchRe: Float64Array,
  scratchIm: Float64Array,
): void {
  const half = n >> 1;
  const stages = Math.round(Math.log2(n));
  for (let j = 0; j < half; j++) {
    scratchRe[j] = re[offset + j * stride]!;
    scratchIm[j] = im[offset + j * stride]!;
    scratchRe[j + half] = re[offset + (j + half) * stride]!;
    scratchIm[j + half] = im[offset + (j + half) * stride]!;
  }
  for (let stage = 0; stage < stages; stage++) {
    const src = (stage & 1) * n; // stockham: src
    const dst = n - src; // stockham: dst
    const span = 1 << stage; // stockham: span
    for (let j = 0; j < half; j++) {
      const r = j & (span - 1); // stockham: r
      const angle = (PI * r) / span; // stockham: angle
      const dest = ((j >> stage) << (stage + 1)) + r; // stockham: dest
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      const ar = scratchRe[src + j]!;
      const ai = scratchIm[src + j]!;
      const cr = scratchRe[src + j + half]!;
      const ci = scratchIm[src + j + half]!;
      const br = cr * wr - ci * wi;
      const bi = cr * wi + ci * wr;
      scratchRe[dst + dest] = ar + br;
      scratchIm[dst + dest] = ai + bi;
      scratchRe[dst + dest + span] = ar - br;
      scratchIm[dst + dest + span] = ai - bi;
    }
  }
  const out = (stages & 1) * n;
  for (let j = 0; j < n; j++) {
    re[offset + j * stride] = scratchRe[out + j]!;
    im[offset + j * stride] = scratchIm[out + j]!;
  }
}

/**
 * The 2-D inverse FFT of an n × n grid, in place (n a power of two): every
 * row (along x), then every column (along z), each by `fftInverseLine`, the
 * order of the GPU's two dispatches. Values are stored as 32-bit floats
 * between the passes, as the GPU stores them.
 */
export function fft2dInverse(re: Float32Array, im: Float32Array, n: number): void {
  const scratchRe = new Float64Array(2 * n);
  const scratchIm = new Float64Array(2 * n);
  for (let row = 0; row < n; row++) fftInverseLine(re, im, row * n, 1, n, scratchRe, scratchIm);
  for (let col = 0; col < n; col++) fftInverseLine(re, im, col, n, n, scratchRe, scratchIm);
}

/** The direct inverse DFT, out(x, z) = Σ in(m, l) e^{2πi (m x + l z)/n}: the reference for the tests. */
export function dft2dInverse(re: Float32Array, im: Float32Array, n: number): { re: Float32Array; im: Float32Array } {
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    cos[q] = Math.cos((2 * PI * q) / n);
    sin[q] = Math.sin((2 * PI * q) / n);
  }
  const outRe = new Float32Array(n * n);
  const outIm = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      let sr = 0;
      let si = 0;
      for (let l = 0; l < n; l++) {
        for (let m = 0; m < n; m++) {
          const q = (m * x + l * z) % n;
          const a = re[l * n + m]!;
          const b = im[l * n + m]!;
          sr += a * cos[q]! - b * sin[q]!;
          si += a * sin[q]! + b * cos[q]!;
        }
      }
      outRe[z * n + x] = sr;
      outIm[z * n + x] = si;
    }
  }
  return { re: outRe, im: outIm };
}

function grid(n: number): ComplexGrid {
  return [new Float32Array(n * n), new Float32Array(n * n)];
}

/**
 * The wind sea's spectra at time t (s) on a tile `size` metres across:
 * H(k, t) = h0(k) e^{−iωt} + conj(h0(−k)) e^{iωt}, and from it the
 * displacement i k̂ H, the slopes i k H and the displacement's derivatives
 * −(kₐ k_b / |k|) H. The DC bin carries no displacement.
 */
export function evolveSpectrum(h0: SpectrumH0, n: number, size: number, t: number): WindSeaSpectra {
  const out: WindSeaSpectra = {
    height: grid(n), dx: grid(n), dz: grid(n), sx: grid(n), sz: grid(n),
    dxdx: grid(n), dzdz: grid(n), dxdz: grid(n),
  };
  const dk = (2 * PI) / size;
  for (let row = 0; row < n; row++) {
    const kz = dk * fftWaveIndex(row, n);
    const mirrorRow = (n - row) % n;
    for (let col = 0; col < n; col++) {
      const kx = dk * fftWaveIndex(col, n);
      const i = row * n + col;
      const mirror = mirrorRow * n + ((n - col) % n);
      const phase = h0.omega[i]! * t;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const a = h0.re[i]!;
      const b = h0.im[i]!;
      const am = h0.re[mirror]!;
      const bm = h0.im[mirror]!;
      // (a + ib) e^{−iωt} + (am − i bm) e^{iωt}
      const hr = a * c + b * s + am * c + bm * s;
      const hi = b * c - a * s + am * s - bm * c;
      out.height[0][i] = hr;
      out.height[1][i] = hi;
      const k = Math.hypot(kx, kz);
      if (k === 0) continue;
      const ux = kx / k;
      const uz = kz / k;
      // i·u·H = u·(−hi, hr)
      out.dx[0][i] = -ux * hi;
      out.dx[1][i] = ux * hr;
      out.dz[0][i] = -uz * hi;
      out.dz[1][i] = uz * hr;
      out.sx[0][i] = -kx * hi;
      out.sx[1][i] = kx * hr;
      out.sz[0][i] = -kz * hi;
      out.sz[1][i] = kz * hr;
      out.dxdx[0][i] = -kx * ux * hr;
      out.dxdx[1][i] = -kx * ux * hi;
      out.dzdz[0][i] = -kz * uz * hr;
      out.dzdz[1][i] = -kz * uz * hi;
      out.dxdz[0][i] = -kx * uz * hr;
      out.dxdz[1][i] = -kx * uz * hi;
    }
  }
  return out;
}

/** A + i·B for the spectra of two real fields: its inverse is a(x) + i·b(x). */
function pack(a: ComplexGrid, b: ComplexGrid): ComplexGrid {
  const re = new Float32Array(a[0].length);
  const im = new Float32Array(a[0].length);
  for (let i = 0; i < re.length; i++) {
    re[i] = a[0][i]! - b[1][i]!;
    im[i] = a[1][i]! + b[0][i]!;
  }
  return [re, im];
}

/**
 * One frame of the wind sea on the CPU, the reference of a whole GPU frame:
 * the spectra at t, packed two real fields to a complex grid as the GPU
 * packs them (height + i·dx, dz + i·slopeX, slopeZ + i·∂dx/∂x,
 * ∂dz/∂z + i·∂dx/∂z), four inverse FFTs, then the displacement scaled by the
 * choppiness λ and the Jacobian
 * J = (1 + λ ∂dx/∂x)(1 + λ ∂dz/∂z) − λ² (∂dx/∂z)².
 */
export function windSeaFields(h0: SpectrumH0, n: number, size: number, t: number, choppiness: number): WindSeaFields {
  const s = evolveSpectrum(h0, n, size, t);
  const grids = [pack(s.height, s.dx), pack(s.dz, s.sx), pack(s.sz, s.dxdx), pack(s.dzdz, s.dxdz)];
  for (const [re, im] of grids) fft2dInverse(re, im, n);
  const [g0, g1, g2, g3] = grids as [ComplexGrid, ComplexGrid, ComplexGrid, ComplexGrid];
  const count = n * n;
  const out: WindSeaFields = {
    height: new Float32Array(count), dx: new Float32Array(count), dz: new Float32Array(count),
    slopeX: new Float32Array(count), slopeZ: new Float32Array(count), jacobian: new Float32Array(count),
  };
  const l = choppiness;
  for (let i = 0; i < count; i++) {
    out.height[i] = g0[0][i]!;
    out.dx[i] = l * g0[1][i]!;
    out.dz[i] = l * g1[0][i]!;
    out.slopeX[i] = g1[1][i]!;
    out.slopeZ[i] = g2[0][i]!;
    const jxx = g2[1][i]!;
    const jzz = g3[0][i]!;
    const jxz = g3[1][i]!;
    out.jacobian[i] = (1 + l * jxx) * (1 + l * jzz) - l * l * jxz * jxz;
  }
  return out;
}
```

Create `client/src/game/oceanSpectrum.ts`:

```ts
/**
 * The wind sea's spectrum, Babylon-free and tested under Node: JONSWAP in
 * frequency, cos-2s spreading in direction, the wavenumber band each of the
 * high tier's three cascades carries, and Tessendorf's starting amplitudes
 * h0(k) for a cascade, drawn from a seeded hash so every peer draws the same
 * sea. The swell is not here: it is analytic (`oceanSwell.ts`), and this
 * spectrum is the wind sea's alone, so nothing is counted twice.
 *
 * Render-side only; `Math.pow`, `Math.exp` and friends are fine here.
 * See docs/rendering/2026-10-02-ocean-waves-design.md §6.
 */
import { OCEAN_G } from "./oceanPhysics.js";
import { fftWaveIndex, type SpectrumH0 } from "./oceanFft.js";

/** Grid size of each of the high tier's cascades. */
export const FFT_N = 256;
/** The high tier's three cascades, metres across: the largest long enough for
 * the wind sea's longest waves, the smallest for its chop. */
export const FFT_CASCADES = [1000, 150, 25] as const;
/** The medium tier's loop: one cascade of LOOP_N², LOOP_SIZE metres across,
 * LOOP_FRAMES frames over LOOP_SECONDS. */
export const LOOP_N = 128;
export const LOOP_SIZE = 60;
export const LOOP_FRAMES = 64;
export const LOOP_SECONDS = 20;
/** Salt of the wind sea's random draws. */
export const WIND_SEA_SALT = 0x0ce4;
/** Fully developed sea for a wind U10 (m/s): Hs ≈ 0.28 U²/g, fp ≈ 0.123 g/U. */
export const WIND_SEA_HS_COEFF = 0.28;
export const WIND_SEA_FP_COEFF = 0.123;
/** The wind sea's directional spreading s (cos-2s), and its JONSWAP peak γ. */
export const WIND_SEA_SPREAD = 10;
export const WIND_SEA_GAMMA = 3.3;
/**
 * The wind sea repeats every this many seconds: each bin's ω is rounded to a
 * multiple of 2π/WIND_SEA_REPEAT (at most 0.003 rad/s away from √(gk)), so the
 * GPU can take the time folded into [0, WIND_SEA_REPEAT) and its
 * single-precision phase is as fine in the hundredth hour as in the first.
 */
export const WIND_SEA_REPEAT = 1024;

/** JONSWAP's peak width below and above the peak frequency. */
const SIGMA_BELOW = 0.07;
const SIGMA_ABOVE = 0.09;
/** Where the integral of the spectrum's shape switches from Simpson's rule
 * to the Pierson–Moskowitz tail's closed form (γ^r is 1 to double precision past it). */
const SHAPE_SPLIT = 3;
const SHAPE_STEPS = 6000;

/** JONSWAP's shape at x = f/fp: x⁻⁵ e^(−1.25 x⁻⁴) γ^r, r = e^(−(x − 1)²/(2σ²)). */
function jonswapShape(x: number, gamma: number): number {
  if (!(x > 0)) return 0;
  const x4 = x * x * x * x;
  const sigma = x <= 1 ? SIGMA_BELOW : SIGMA_ABOVE;
  const r = Math.exp(-((x - 1) * (x - 1)) / (2 * sigma * sigma));
  return (Math.exp(-1.25 / x4) / (x4 * x)) * Math.pow(gamma, r);
}

const shapeIntegrals = new Map<number, number>();

/** ∫₀^∞ of JONSWAP's shape over x = f/fp, for γ: Simpson's rule to x = 3,
 * then the tail's closed form, ∫ x⁻⁵ e^(−1.25 x⁻⁴) dx = e^(−1.25 x⁻⁴)/5. */
function shapeIntegral(gamma: number): number {
  const cached = shapeIntegrals.get(gamma);
  if (cached !== undefined) return cached;
  const h = SHAPE_SPLIT / SHAPE_STEPS;
  let sum = jonswapShape(SHAPE_SPLIT, gamma);
  for (let i = 1; i < SHAPE_STEPS; i++) sum += (i % 2 === 1 ? 4 : 2) * jonswapShape(i * h, gamma);
  const tail = (1 - Math.exp(-1.25 / SHAPE_SPLIT ** 4)) / 5;
  const total = (sum * h) / 3 + tail;
  shapeIntegrals.set(gamma, total);
  return total;
}

/**
 * The JONSWAP spectrum S(f) (m²/Hz) of significant height hs (m), peak
 * frequency fp (Hz) and peak enhancement γ, normalised so that
 * 4 √(∫ S df) = hs exactly (the shape's integral taken numerically, once per γ).
 */
export function jonswap(f: number, fp: number, hs: number, gamma: number): number {
  if (!(fp > 0) || !(hs > 0)) return 0;
  return (hs * hs * jonswapShape(f / fp, gamma)) / (16 * fp * shapeIntegral(gamma));
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x ≥ 1 (Lanczos, g = 7). */
function lnGamma(x: number): number {
  const y = x - 1;
  let a = LANCZOS[0]!;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i]! / (y + i);
  const t = y + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * The cos-2s spreading D(θ) = N(s) cos^{2s}(θ/2), θ the angle from the mean
 * direction (any angle, wrapped to (−π, π]), N(s) = 2^{2s} Γ(s+1)² / (2π Γ(2s+1))
 * so that its integral over a turn is 1. s below 0 is taken as 0 (uniform).
 */
export function spreading(theta: number, s: number): number {
  const spread = Math.max(0, s);
  const wrapped = theta - 2 * Math.PI * Math.round(theta / (2 * Math.PI));
  const norm = Math.exp(2 * spread * Math.LN2 + 2 * lnGamma(spread + 1) - lnGamma(2 * spread + 1)) / (2 * Math.PI);
  return norm * Math.pow(Math.max(0, Math.cos(wrapped / 2)), 2 * spread);
}

/**
 * The wavenumber band (rad/m) each cascade carries, [kMin, kMax): band i ends
 * where band i + 1 begins, at four of cascade i + 1's fundamentals
 * (4 · 2π/size_{i+1}), so each finer cascade leaves its three longest, worst
 * sampled waves to the coarser one; the first begins at 0, the last ends at
 * its own Nyquist wavenumber, π n / size.
 */
export function cascadeBands(sizes: readonly number[], n: number): { kMin: number; kMax: number }[] {
  return sizes.map((size, i) => ({
    kMin: i === 0 ? 0 : (8 * Math.PI) / size,
    kMax: i === sizes.length - 1 ? (Math.PI * n) / size : (8 * Math.PI) / sizes[i + 1]!,
  }));
}

/** The seed of cascade `cascade`'s draws, so no two cascades draw the same numbers. */
export function windSeaCascadeSeed(seed: number, cascade: number): number {
  return (seed + Math.imul(cascade + 1, 0x9e3779b9)) >>> 0;
}

/** A 32-bit integer mix (Wellons' lowbias32). */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A uniform number in [0, 1) from the seed, the bin and a lane. */
function unit(seed: number, row: number, col: number, lane: number): number {
  const h = mix32(mix32(mix32(seed ^ 0x9e3779b9) ^ row) ^ ((col << 1) | lane));
  return (h >>> 8) / 16777216;
}

/** Simpson intervals of the band's share of the spectrum. */
const BAND_STEPS = 4096;

/** The variance (m²) of the JONSWAP sea between wavenumbers kMin and kMax in
 * deep water: ∫ S df between their frequencies √(gk)/2π. */
function bandVariance(fp: number, hs: number, kMin: number, kMax: number): number {
  const fLo = Math.sqrt(OCEAN_G * kMin) / (2 * Math.PI);
  const fHi = Math.sqrt(OCEAN_G * kMax) / (2 * Math.PI);
  const h = (fHi - fLo) / BAND_STEPS;
  let sum = jonswap(fLo, fp, hs, WIND_SEA_GAMMA) + jonswap(fHi, fp, hs, WIND_SEA_GAMMA);
  for (let i = 1; i < BAND_STEPS; i++) sum += (i % 2 === 1 ? 4 : 2) * jonswap(fLo + i * h, fp, hs, WIND_SEA_GAMMA);
  return (sum * h) / 3;
}

/**
 * Tessendorf's h0(k) for the wind sea on one cascade: n × n bins on a tile
 * `size` metres across, in FFT order (`oceanFft.ts`). The sea is the fully
 * developed one for state.u10 (m/s, JONSWAP with Hs = WIND_SEA_HS_COEFF U²/g,
 * fp = WIND_SEA_FP_COEFF g/U, γ = WIND_SEA_GAMMA), spread by cos-2s
 * (s = WIND_SEA_SPREAD) about state.dir, the way the wind blows (x, z).
 * Each bin inside [band.kMin, band.kMax) gets
 * h0 = (ξ₁ + i ξ₂) · ½ Δk √(c F(k)), ξ standard normal from a hash of the
 * seed and the bin (Box–Muller), F(k) = S(f) (df/dk) D(θ) / k the spectrum
 * per unit area of wavenumber space at the bin's centre, Δk = 2π/size, and c the
 * one factor that makes the sum of c F Δk² over the band's bins equal the
 * band's share of the spectrum (the grid's coarse rings near a band's inner
 * edge would otherwise carry up to a fifth too much). So the field's expected
 * variance is that share. Bins outside the band, the DC bin and the Nyquist
 * row and column are zero. omega is deep water's √(g|k|) rounded to a multiple
 * of 2π/repeat (WIND_SEA_REPEAT by default), so the sea repeats every
 * `repeat` seconds. The same arguments give the same arrays.
 */
export function windSeaH0(
  n: number,
  size: number,
  state: { u10: number; dir: [number, number] },
  band: { kMin: number; kMax: number },
  seed: number,
  repeat: number = WIND_SEA_REPEAT,
): SpectrumH0 {
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  const omega = new Float32Array(n * n);
  const density = new Float64Array(n * n);
  const u = state.u10;
  const live = u > 0;
  const hs = live ? (WIND_SEA_HS_COEFF * u * u) / OCEAN_G : 0;
  const fp = live ? (WIND_SEA_FP_COEFF * OCEAN_G) / u : 0;
  const windAngle = Math.atan2(state.dir[1], state.dir[0]);
  const quantum = (2 * Math.PI) / repeat;
  const dk = (2 * Math.PI) / size;
  const nyquist = n / 2;
  let drawn = 0;
  for (let row = 0; row < n; row++) {
    const kz = dk * fftWaveIndex(row, n);
    for (let col = 0; col < n; col++) {
      const kx = dk * fftWaveIndex(col, n);
      const k = Math.hypot(kx, kz);
      const i = row * n + col;
      const w = Math.sqrt(OCEAN_G * k);
      omega[i] = Math.round(w / quantum) * quantum;
      if (!live || k === 0 || k < band.kMin || k >= band.kMax || row === nyquist || col === nyquist) continue;
      const sk = (jonswap(w / (2 * Math.PI), fp, hs, WIND_SEA_GAMMA) * OCEAN_G) / (4 * Math.PI * w);
      density[i] = (sk * spreading(Math.atan2(kz, kx) - windAngle, WIND_SEA_SPREAD)) / k;
      drawn += density[i]! * dk * dk;
    }
  }
  if (!(drawn > 0)) return { re, im, omega };
  const scale = bandVariance(fp, hs, band.kMin, band.kMax) / drawn;
  const salted = (seed ^ WIND_SEA_SALT) >>> 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      if (density[i] === 0) continue;
      const amplitude = 0.5 * dk * Math.sqrt(scale * density[i]!);
      const u1 = 1 - unit(salted, row, col, 0);
      const u2 = unit(salted, row, col, 1);
      const radius = Math.sqrt(-2 * Math.log(u1));
      re[i] = amplitude * radius * Math.cos(2 * Math.PI * u2);
      im[i] = amplitude * radius * Math.sin(2 * Math.PI * u2);
    }
  }
  return { re, im, omega };
}
```

In `client/test/architecture.test.ts`, `BABYLON_FREE_FILES`, after Task 1's entry:

```ts
      join(SRC, "game", "oceanPhysics.ts"),
      join(SRC, "game", "oceanSpectrum.ts"),
      join(SRC, "game", "oceanFft.ts"),
    ];
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanSpectrum.test.ts test/game/oceanFft.test.ts test/architecture.test.ts`
Expected: PASS (15 tests in `oceanSpectrum.test.ts`, 8 in `oceanFft.test.ts`; about 4 s, most of it the 32-seed variance test)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanSpectrum.ts client/src/game/oceanFft.ts client/test/game/oceanSpectrum.test.ts client/test/game/oceanFft.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the wind sea's spectrum and its FFT on the CPU

## What

The wind sea's spectrum and the FFT that turns it into a surface, Babylon-free
and tested under Node: JONSWAP normalised to its significant height, cos-2s
spreading, the band of wavenumbers each of the high tier's three cascades
carries, and Tessendorf's starting amplitudes drawn from a seeded hash so every
peer draws one sea, each band's variance its share of the spectrum. A radix-2
Stockham inverse FFT in the order the GPU will run it, held to a direct DFT,
turns a frame of the spectrum into the height, the displacement that sharpens
the crests, the slopes and the Jacobian: the reference the GPU is held to and
the engine of the medium tier's loop. The sea repeats every 1,024 s, its
frequencies rounded to that, so its phase stays fine in single precision.

## How

- `client/src/game/oceanSpectrum.ts` — the cascades' and the loop's constants, the fully developed sea's coefficients, `jonswap`, `spreading`, `cascadeBands`, `windSeaCascadeSeed`, `windSeaH0`
- `client/src/game/oceanFft.ts` — the grid's conventions, `fftInverseLine`, `fft2dInverse`, `dft2dInverse`, `evolveSpectrum`, `windSeaFields`, `WIND_SEA_CHOPPINESS`
- `client/test/game/oceanSpectrum.test.ts` — normalisation, spreading, the bands, determinism, dispersion, the drawn variance against the band's share on every cascade
- `client/test/game/oceanFft.test.ts` — the FFT against the DFT on 8², 16² and 32², one wave's cosine, real fields, the GPU's packing, J = 1 at λ = 0, the repeat
- `client/test/architecture.test.ts` — both modules join the Babylon-free list

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 3: The GPU wind sea

**Files:**
- Create: `client/src/game/oceanGpuFft.ts`
- Create: `client/src/game/shaders/oceanFftEvolve.compute.wgsl`
- Create: `client/src/game/shaders/oceanFftPass.compute.wgsl`
- Create: `client/src/game/shaders/oceanFftResolve.compute.wgsl`
- Test: `client/test/game/oceanGpuFft.test.ts`

(`oceanGpuFft.ts` imports Babylon, so it does not join `BABYLON_FREE_FILES`. `.gitattributes` already gives `*.wgsl` LF endings; `shaderHygiene.test.ts` reads only `*.fx`, and the WGSL corpus tools read only `client/shaders/corpus/`, so neither sees these files.)

**Interfaces:**
- Consumes: from Task 2, `FFT_N`, `FFT_CASCADES`, `WIND_SEA_REPEAT`, `cascadeBands`, `windSeaCascadeSeed`, `windSeaH0` (`oceanSpectrum.ts`) and `WIND_SEA_CHOPPINESS`, `fftInverseLine`, `windSeaFields`, the grid conventions and the six `// stockham:` lines (`oceanFft.ts`). From Babylon 9.18, exactly as its `.d.ts` declares them:
  - `ComputeShader` (`@babylonjs/core/Compute/computeShader.pure.js`): `new ComputeShader(name, engine, { computeSource }, { bindingsMapping, entryPoint })`, `setStorageBuffer(name, StorageBuffer)`, `setUniformBuffer(name, DataBuffer)`, `setStorageTexture(name, BaseTexture)`, `isReady()`, `dispatch(x, y, z)`, `onError: (effect, errors: string) => void`. Its constructor logs and returns early where `getCaps().supportComputeShaders` is false, so `createGpuWindSea` checks first.
  - `StorageBuffer` (`@babylonjs/core/Buffers/storageBuffer.js`): `new StorageBuffer(engine: WebGPUEngine, size, creationFlags, label)`, `update(data)`, `dispose()`.
  - `AbstractEngine`: `isWebGPU`, `getCaps().supportComputeShaders`, `createUniformBuffer(elements, label)`, `updateUniformBuffer(buffer, elements)`, `_releaseBuffer(buffer)`, `createRawTexture2DArray(data, w, h, depth, format, generateMipMaps, invertY, samplingMode, compression, textureType, creationFlags)` with `Constants.TEXTURE_CREATIONFLAG_STORAGE` (the WebGPU engine then makes a `2d-array` view and the `viewForWriting` a storage binding takes, and adds `STORAGE_BINDING` to the texture's usages); `new BaseTexture(engine, internalTexture)`.
  - Every pipeline takes the device's automatic layout (Babylon's default). Not `useExplicitComputePipelineLayout`: Babylon's explicit layout reads a binding's view dimension with a pattern that knows `texture_2d_array` but not `texture_storage_2d_array`, so it would declare the outputs `2d`.
- Produces (`client/src/game/oceanGpuFft.ts`, Babylon, WebGPU only):
  - `type GpuWindSea = { disp: BaseTexture; slope: BaseTexture; setSpectrum(state: { u10: number; dir: [number, number] }, seed: number): void; step(seconds: number): void; status(): "compiling" | "running" | "failed"; dispose(): void }`. Both are wider than the state type and the engine type the callers hold: `setSpectrum` takes the structural `{ u10, dir }` (a `WindSeaState` from Task 9 is assignable to it; `oceanWindSea.ts` does not exist yet), and `status()` is new — Task 13 falls back to the medium loop on `"failed"`, Task 5 waits for `"running"`.
  - `createGpuWindSea(engine: AbstractEngine): GpuWindSea | null` — an `AbstractEngine`, so the renderer's engine passes without a cast; null unless `engine.isWebGPU && engine.getCaps().supportComputeShaders`.
  - `disp`: texture 2D array, 3 layers (layer c = `FFT_CASCADES[c]`), `FFT_N`², `rgba16float`, bilinear, wrap, no mips: (height, λ·dx, λ·dz, Jacobian), λ = `WIND_SEA_CHOPPINESS`. `slope`: likewise (slopeX, slopeZ, 0, 0). Texel (x, z) of layer c is world (x, z) mod size, i.e. sample at uv = world.xz / `FFT_CASCADES[c]`. Before the first frame `disp` reads (0, 0, 0, 1), a flat unfolded sea, so no whitecap flashes while the shaders compile.
  - `gpuWindSeaH0(state, seed): Float32Array` — what `setSpectrum` uploads: per bin vec4 (re, im, ω, 0), cascade after cascade, each from `windSeaH0(FFT_N, FFT_CASCADES[c], state, bands[c], windSeaCascadeSeed(seed, c))`.
  - `OCEAN_FFT_EVOLVE_BINDINGS`, `OCEAN_FFT_PASS_BINDINGS`, `OCEAN_FFT_RESOLVE_BINDINGS` (`ComputeBindingMapping`s) and `OCEAN_FFT_DISPATCH = { evolve: [16, 16, 3], rows: [256, 6, 1], columns: [256, 6, 1], resolve: [16, 16, 3] }`.
  - For the callers (Tasks 5, 13): call `step(seconds)` once a frame **before `scene.render()`** — Babylon ends the current render pass before every dispatch, so a dispatch inside the frame's passes splits them; call `setSpectrum` when the wind sea's state moves by more than a step (about 20 ms on the main thread for the three cascades); prefer `await import("./oceanGpuFft.js")` on the WebGPU path, so the WebGL2 bundle does not carry `ComputeShader` (the module names no `Engines/WebGPU` module at run time, so a static import would still pass `architecture.test.ts`).

Structure and decisions:
- **Four dispatches a frame**: (1) evolve, 16×16 invocations a workgroup, one a bin of each cascade (dispatch 16×16×3): H(k,t) and the eight fields, packed two real fields a complex value; (2) rows and (3) columns, one shader with two entry points, a workgroup of 128 invocations a line, every line of every layer in one dispatch (256 lines × 6 layers), each running the whole 256-point Stockham in workgroup memory, 8 stages separated by barriers; (4) resolve, one invocation a texel of each cascade, writing `disp` and `slope`.
- **The spectra live in storage buffers, not textures** (not a texture 2D array for h0 and a ping-pong storage array): h0 is a read-only storage buffer (3 × 256² vec4, 3 MiB) and the spectra one read-write storage buffer (6 layers × 256² vec4, 6 MiB) transformed **in place** — each line is read whole into workgroup memory before any write and written back after the last barrier by the one workgroup that owns it, so no second copy ping-pongs in memory. Reasons: `rgba32float` textures read with `textureLoad` need their bindings laid out `unfilterable-float`, which Babylon writes only in its explicit layout, the one that mis-declares storage arrays (above); reading a storage texture instead needs WGSL's read-write storage texture extension; storage buffers need neither.
- **Packing (the fourth slot used)**: three values packed (height + i·dx, dz + i·slopeX, slopeZ + i·0) would leave the third value's imaginary half empty, and a vec4 holds two complex values, so three values take two vec4 layers anyway; the fourth complex value is free. They carry the Jacobian's three derivatives spectrally: layer 2c = (height + i·dx, dz + i·slopeX), layer 2c + 1 = (slopeZ + i·∂dx/∂x, ∂dz/∂z + i·∂dx/∂z). The Jacobian is then exact at every wavenumber, where finite differences on the 25 m cascade's 0.1 m texels lose all of it at the Nyquist wavenumber; it costs no extra FFT.
- **The device's limits, counted** (the test pins every count): storage textures a stage — evolve 0, pass 0, resolve 2 (`disp`, `slope`), all ≤ 4; storage buffers — 2, 1, 1, ≤ 8; uniform buffers — 1, 0, 1; invocations a workgroup — 256, 128, 256, ≤ 256; workgroup memory — the pass's `array<vec4<f32>, 512>`, 2 × 256 × 16 B = **8,192 B**, inside the 16,384 B a workgroup may hold, evolve and resolve none. All are WebGPU's defaults, so `WEBGPU_REQUIRED_LIMITS` needs nothing new.
- The evolve folds each bin's phase to one turn (`2π·fract(ωt/2π)`) before `sin`/`cos`, which WGSL guarantees only near zero; `step` folds the shared seconds into [0, `WIND_SEA_REPEAT`) in double precision before the 32-bit uniform.
- **What Node can and cannot check.** Node has no WebGPU: the tests pin the WGSL's text (bindings, kinds, workgroup sizes, workgroup memory, constants, the Stockham lines against `oceanFft.ts`'s), the dispatch shape, `null` on `NullEngine`, the upload's layout, and a CPU transcription of the three shaders (one line, then a whole frame of the three cascades) against `fftInverseLine` and `windSeaFields`. **The GPU's own result is verified in the browser by Task 5 (which measures it) and Task 15, not under Node.** For the record, while drafting, exactly this code was run once in headless Chrome on Apple silicon (`apple metal-3`): the three modules compiled with no message, the automatic layouts took Babylon's bindings with no validation error, `createGpuWindSea` on a real `WebGPUEngine` reached `"running"` in 6 frames, `disp` read (0, 0, 0, 1) before the first frame, and after one frame both textures matched `windSeaFields` to half precision on every cascade (largest differences: height 0.0020 m at an RMS of 0.80 m, displacement 0.0018 m, Jacobian 0.0011, slopes 0.0003).

- [ ] **Step 1: Write the failing test**

Create `client/test/game/oceanGpuFft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import evolveWgsl from "../../src/game/shaders/oceanFftEvolve.compute.wgsl?raw";
import passWgsl from "../../src/game/shaders/oceanFftPass.compute.wgsl?raw";
import resolveWgsl from "../../src/game/shaders/oceanFftResolve.compute.wgsl?raw";
import {
  OCEAN_FFT_DISPATCH, OCEAN_FFT_EVOLVE_BINDINGS, OCEAN_FFT_PASS_BINDINGS, OCEAN_FFT_RESOLVE_BINDINGS,
  createGpuWindSea, gpuWindSeaH0,
} from "../../src/game/oceanGpuFft.js";
import { FFT_CASCADES, FFT_N, cascadeBands, windSeaCascadeSeed, windSeaH0 } from "../../src/game/oceanSpectrum.js";
import { WIND_SEA_CHOPPINESS, fftInverseLine, windSeaFields } from "../../src/game/oceanFft.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SHADERS = { evolve: evolveWgsl, pass: passWgsl, resolve: resolveWgsl };

/** The WGSL's resource declarations: name → group, binding, address space or type. */
function declarations(wgsl: string): Record<string, { group: number; binding: number; kind: string }> {
  const out: Record<string, { group: number; binding: number; kind: string }> = {};
  const pattern = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+(\w+)\s*:\s*([^;]+);/g;
  for (const m of wgsl.matchAll(pattern)) {
    out[m[4]!] = { group: Number(m[1]), binding: Number(m[2]), kind: (m[3] ?? m[5]!).replace(/\s+/g, " ").trim() };
  }
  return out;
}

const where = (d: ReturnType<typeof declarations>): Record<string, { group: number; binding: number }> =>
  Object.fromEntries(Object.entries(d).map(([name, { group, binding }]) => [name, { group, binding }]));

/** The workgroup sizes of every entry point. */
function workgroupSizes(wgsl: string): number[][] {
  return [...wgsl.matchAll(/@workgroup_size\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
}

/** A `const NAME: u32 = <n>u;` of the WGSL. */
function u32Const(wgsl: string, name: string): number {
  const m = wgsl.match(new RegExp(`const ${name}: u32 = (\\d+)u;`));
  if (!m) throw new Error(`no const ${name}`);
  return Number(m[1]);
}

/** The lines marked `// stockham: <name>`, as name → expression, normalised:
 * no `const`/`let`, no spaces, WGSL's unsigned literals, `f32()` casts and `N`
 * written as TypeScript writes them. */
function stockhamLines(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/^\s*(?:const|let)\s+(\w+)\s*=\s*(.+);\s*\/\/ stockham: (\w+)\s*$/gm)) {
    expect(m[1]).toBe(m[3]);
    out[m[3]!] = m[2]!
      .replace(/\s+/g, "")
      .replace(/(\d+)u\b/g, "$1")
      .replace(/f32\((\w+)\)/g, "$1")
      .replace(/\bN\b/g, "n");
  }
  return out;
}

describe("the wind sea's compute shaders", () => {
  it("bind each resource where oceanGpuFft.ts says, as the kind it binds", () => {
    const evolve = declarations(evolveWgsl);
    const pass = declarations(passWgsl);
    const resolve = declarations(resolveWgsl);
    expect(where(evolve)).toEqual(OCEAN_FFT_EVOLVE_BINDINGS);
    expect(where(pass)).toEqual(OCEAN_FFT_PASS_BINDINGS);
    expect(where(resolve)).toEqual(OCEAN_FFT_RESOLVE_BINDINGS);
    expect(Object.fromEntries(Object.entries(evolve).map(([k, v]) => [k, v.kind]))).toEqual({
      h0: "storage, read",
      spectra: "storage, read_write",
      params: "uniform",
    });
    expect(pass.spectra!.kind).toBe("storage, read_write");
    expect(Object.fromEntries(Object.entries(resolve).map(([k, v]) => [k, v.kind]))).toEqual({
      spectra: "storage, read",
      params: "uniform",
      disp: "texture_storage_2d_array<rgba16float, write>",
      slope: "texture_storage_2d_array<rgba16float, write>",
    });
  });

  it("stay inside the device's limits: at most 4 storage textures, 8 storage buffers and 1 uniform buffer a stage", () => {
    const counts = Object.fromEntries(
      Object.entries(SHADERS).map(([name, wgsl]) => {
        const kinds = Object.values(declarations(wgsl)).map((d) => d.kind);
        return [name, {
          storageTextures: kinds.filter((k) => k.startsWith("texture_storage_")).length,
          storageBuffers: kinds.filter((k) => k.startsWith("storage")).length,
          uniforms: kinds.filter((k) => k === "uniform").length,
        }];
      }),
    );
    expect(counts).toEqual({
      evolve: { storageTextures: 0, storageBuffers: 2, uniforms: 1 },
      pass: { storageTextures: 0, storageBuffers: 1, uniforms: 0 },
      resolve: { storageTextures: 2, storageBuffers: 1, uniforms: 1 },
    });
  });

  it("run at most 256 invocations a workgroup, and the pass holds 8 KiB of workgroup memory of the 16 KiB allowed", () => {
    expect(workgroupSizes(evolveWgsl)).toEqual([[16, 16, 1]]);
    expect(workgroupSizes(passWgsl)).toEqual([[128, 1, 1], [128, 1, 1]]);
    expect(workgroupSizes(resolveWgsl)).toEqual([[16, 16, 1]]);
    for (const wgsl of Object.values(SHADERS)) {
      for (const [x, y, z] of workgroupSizes(wgsl)) expect(x! * y! * z!).toBeLessThanOrEqual(256);
    }
    const shared = [...passWgsl.matchAll(/var<workgroup>\s+(\w+)\s*:\s*array<vec4<f32>,\s*(\d+)>;/g)];
    expect(shared.length).toBe(1);
    const bytes = Number(shared[0]![2]) * 16;
    expect(bytes).toBe(8192);
    expect(bytes).toBeLessThanOrEqual(16384);
    expect(evolveWgsl).not.toMatch(/var<workgroup>/);
    expect(resolveWgsl).not.toMatch(/var<workgroup>/);
  });

  it("are dispatched over every bin, every line and every texel of the three cascades", () => {
    const [ex, ey, ez] = OCEAN_FFT_DISPATCH.evolve;
    expect([ex * 16, ey * 16, ez]).toEqual([256, 256, 3]);
    const [rx, ry, rz] = OCEAN_FFT_DISPATCH.resolve;
    expect([rx * 16, ry * 16, rz]).toEqual([256, 256, 3]);
    expect(OCEAN_FFT_DISPATCH.rows).toEqual([256, 6, 1]);
    expect(OCEAN_FFT_DISPATCH.columns).toEqual([256, 6, 1]);
    // A workgroup of HALF invocations moves two values each: the whole line.
    expect(2 * u32Const(passWgsl, "HALF")).toBe(FFT_N);
  });

  it("share the CPU FFT's size, stage count and Stockham index arithmetic", () => {
    for (const wgsl of Object.values(SHADERS)) expect(u32Const(wgsl, "N")).toBe(FFT_N);
    expect(u32Const(passWgsl, "HALF")).toBe(FFT_N / 2);
    expect(u32Const(passWgsl, "STAGES")).toBe(Math.log2(FFT_N));
    const cpu = readFileSync(fileURLToPath(new URL("../../src/game/oceanFft.ts", import.meta.url)), "utf8");
    const gpu = stockhamLines(passWgsl);
    expect(Object.keys(gpu).sort()).toEqual(["angle", "dest", "dst", "r", "span", "src"]);
    expect(gpu).toEqual(stockhamLines(cpu));
    expect(gpu.dest).toBe("((j>>stage)<<(stage+1))+r");
  });

  it("name no module of Babylon's WebGPU engine at run time", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/game/oceanGpuFft.ts", import.meta.url)), "utf8");
    const runtime = [...source.matchAll(/^\s*import\s+(?!type\s)(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]!);
    expect(runtime.filter((spec) => /^@babylonjs\/core\/Engines\/(?:webgpuEngine|WebGPU\/)/.test(spec))).toEqual([]);
  });
});

describe("createGpuWindSea", () => {
  it("returns null on an engine without WebGPU compute", () => {
    const engine = new NullEngine();
    expect(createGpuWindSea(engine)).toBeNull();
    Object.defineProperty(engine, "isWebGPU", { get: () => true });
    expect(engine.getCaps().supportComputeShaders).toBe(false);
    expect(createGpuWindSea(engine)).toBeNull();
    engine.dispose();
  });

  it("uploads each cascade's h0 as (re, im, ω, 0) a bin, cascade after cascade", () => {
    const state = { u10: 9, dir: [0.8, 0.6] as [number, number] };
    const upload = gpuWindSeaH0(state, 42);
    expect(upload.length).toBe(3 * 256 * 256 * 4);
    const bands = cascadeBands(FFT_CASCADES, FFT_N);
    for (let c = 0; c < 3; c++) {
      const h0 = windSeaH0(FFT_N, FFT_CASCADES[c]!, state, bands[c]!, windSeaCascadeSeed(42, c));
      for (const i of [0, 1, 257, 4000, 65535]) {
        const at = (c * 65536 + i) * 4;
        expect([upload[at], upload[at + 1], upload[at + 2], upload[at + 3]]).toEqual([h0.re[i], h0.im[i], h0.omega[i], 0]);
      }
    }
  });
});

/** Values a line apart, as one workgroup of the pass sees them: four numbers
 * (two complex values) at each of the line's N places. */
function passLine(spectra: Float64Array, offset: number, stride: number): void {
  const n = 256;
  const half = 128;
  const stages = 8;
  const scratch = new Float64Array(2 * n * 4);
  const copy = (to: Float64Array, toAt: number, from: Float64Array, fromAt: number): void => {
    for (let q = 0; q < 4; q++) to[toAt * 4 + q] = from[fromAt * 4 + q]!;
  };
  for (let j = 0; j < half; j++) {
    copy(scratch, j, spectra, offset + j * stride);
    copy(scratch, j + half, spectra, offset + (j + half) * stride);
  }
  for (let stage = 0; stage < stages; stage++) {
    // Every invocation of the workgroup between two barriers: each reads the
    // src half and writes the dst half, so their order does not matter.
    for (let j = 0; j < half; j++) {
      const src = (stage & 1) * n;
      const dst = n - src;
      const span = 1 << stage;
      const r = j & (span - 1);
      const angle = (Math.PI * r) / span;
      const dest = ((j >> stage) << (stage + 1)) + r;
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      const a = (src + j) * 4;
      const c = (src + j + half) * 4;
      const b = [
        scratch[c]! * wr - scratch[c + 1]! * wi, scratch[c]! * wi + scratch[c + 1]! * wr,
        scratch[c + 2]! * wr - scratch[c + 3]! * wi, scratch[c + 2]! * wi + scratch[c + 3]! * wr,
      ];
      for (let q = 0; q < 4; q++) {
        scratch[(dst + dest) * 4 + q] = scratch[a + q]! + b[q]!;
        scratch[(dst + dest + span) * 4 + q] = scratch[a + q]! - b[q]!;
      }
    }
  }
  const out = (stages & 1) * n;
  for (let j = 0; j < half; j++) {
    copy(spectra, offset + j * stride, scratch, out + j);
    copy(spectra, offset + (j + half) * stride, scratch, out + j + half);
  }
}

/** A whole frame as the three shaders compute it, on the CPU in double
 * precision: evolve, rows, columns, resolve, from what `setSpectrum` uploads. */
function frame(upload: Float32Array, t: number, choppiness: number): { disp: Float64Array; slope: Float64Array } {
  const n = 256;
  const cascades = 3;
  const spectra = new Float64Array(2 * cascades * n * n * 4);
  const waveIndex = (m: number): number => (m >= n / 2 ? m - n : m);
  for (let cascade = 0; cascade < cascades; cascade++) {
    const base = cascade * n * n;
    const dk = (2 * Math.PI) / FFT_CASCADES[cascade]!;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const here = (base + row * n + col) * 4;
        const there = (base + ((n - row) % n) * n + ((n - col) % n)) * 4;
        const cycles = (upload[here + 2]! * t) / (2 * Math.PI);
        const phase = 2 * Math.PI * (cycles - Math.floor(cycles));
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        const [ar, ai, br, bi] = [upload[here]!, upload[here + 1]!, upload[there]!, upload[there + 1]!];
        const hr = ar * c + ai * s + br * c + bi * s;
        const hi = ai * c - ar * s + br * s - bi * c;
        const kx = dk * waveIndex(col);
        const kz = dk * waveIndex(row);
        const k = Math.hypot(kx, kz);
        const inverse = k > 0 ? 1 / k : 0;
        const [ux, uz] = [kx * inverse, kz * inverse];
        // i·h, and a + i·b for each pair of fields
        const [ihr, ihi] = [-hi, hr];
        const field = {
          dx: [ux * ihr, ux * ihi], dz: [uz * ihr, uz * ihi], sx: [kx * ihr, kx * ihi], sz: [kz * ihr, kz * ihi],
          dxdx: [-kx * ux * hr, -kx * ux * hi], dzdz: [-kz * uz * hr, -kz * uz * hi], dxdz: [-kx * uz * hr, -kx * uz * hi],
        };
        const plusI = (a: number[], b: number[]): number[] => [a[0]! - b[1]!, a[1]! + b[0]!];
        const at = (cascade * 2 * n * n + row * n + col) * 4;
        spectra.set([...plusI([hr, hi], field.dx), ...plusI(field.dz, field.sx)], at);
        spectra.set([...plusI(field.sz, field.dxdx), ...plusI(field.dzdz, field.dxdz)], at + n * n * 4);
      }
    }
  }
  for (let layer = 0; layer < 2 * cascades; layer++) {
    for (let line = 0; line < n; line++) passLine(spectra, layer * n * n + line * n, 1);
  }
  for (let layer = 0; layer < 2 * cascades; layer++) {
    for (let line = 0; line < n; line++) passLine(spectra, layer * n * n + line, n);
  }
  const disp = new Float64Array(cascades * n * n * 4);
  const slope = new Float64Array(cascades * n * n * 4);
  const l = choppiness;
  for (let cascade = 0; cascade < cascades; cascade++) {
    for (let i = 0; i < n * n; i++) {
      const a = (cascade * 2 * n * n + i) * 4;
      const b = a + n * n * 4;
      const jacobian = (1 + l * spectra[b + 1]!) * (1 + l * spectra[b + 2]!) - l * l * spectra[b + 3]! ** 2;
      disp.set([spectra[a]!, l * spectra[a + 1]!, l * spectra[a + 2]!, jacobian], (cascade * n * n + i) * 4);
      slope.set([spectra[a + 3]!, spectra[b]!, 0, 0], (cascade * n * n + i) * 4);
    }
  }
  return { disp, slope };
}

describe("the pass's algorithm, run on the CPU as the WGSL runs it", () => {
  it("transforms a line of 256 as fftInverseLine does, both of its complex values", () => {
    let seed = 99;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296 - 0.5;
    };
    const n = 256;
    const spectra = new Float64Array(n * n * 4);
    for (let i = 0; i < spectra.length; i++) spectra[i] = next();
    const column = 37;
    const expected = [0, 1].map((pair) => {
      const re = new Float32Array(n);
      const im = new Float32Array(n);
      for (let z = 0; z < n; z++) {
        re[z] = spectra[(z * n + column) * 4 + 2 * pair]!;
        im[z] = spectra[(z * n + column) * 4 + 2 * pair + 1]!;
      }
      fftInverseLine(re, im, 0, 1, n, new Float64Array(2 * n), new Float64Array(2 * n));
      return [re, im] as const;
    });
    passLine(spectra, column, n);
    for (let z = 0; z < n; z++) {
      for (const pair of [0, 1]) {
        expect(spectra[(z * n + column) * 4 + 2 * pair]).toBeCloseTo(expected[pair]![0][z]!, 4);
        expect(spectra[(z * n + column) * 4 + 2 * pair + 1]).toBeCloseTo(expected[pair]![1][z]!, 4);
      }
    }
  });

  it("makes, over a whole frame of the three cascades, the fields windSeaFields makes", () => {
    const state = { u10: 11, dir: [0.6, -0.8] as [number, number] };
    const seed = 7;
    const t = 37.25;
    const { disp, slope } = frame(gpuWindSeaH0(state, seed), t, WIND_SEA_CHOPPINESS);
    const bands = cascadeBands(FFT_CASCADES, FFT_N);
    const n = FFT_N;
    for (let c = 0; c < 3; c++) {
      const h0 = windSeaH0(n, FFT_CASCADES[c]!, state, bands[c]!, windSeaCascadeSeed(seed, c));
      const cpu = windSeaFields(h0, n, FFT_CASCADES[c]!, t, WIND_SEA_CHOPPINESS);
      let largest = 0;
      for (let i = 0; i < n * n; i++) {
        const at = (c * n * n + i) * 4;
        largest = Math.max(
          largest,
          Math.abs(disp[at]! - cpu.height[i]!), Math.abs(disp[at + 1]! - cpu.dx[i]!), Math.abs(disp[at + 2]! - cpu.dz[i]!),
          Math.abs(disp[at + 3]! - cpu.jacobian[i]!), Math.abs(slope[at]! - cpu.slopeX[i]!), Math.abs(slope[at + 1]! - cpu.slopeZ[i]!),
        );
      }
      expect(largest).toBeLessThan(1e-4);
      expect(cpu.height.some((v) => Math.abs(v) > 1e-3)).toBe(true);
    }
  }, timeLimit(60_000));
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanGpuFft.test.ts`
Expected: FAIL with "ENOENT: no such file or directory, open '../../src/game/shaders/oceanFftEvolve.compute.wgsl'"

- [ ] **Step 3: Implement**

Create `client/src/game/shaders/oceanFftEvolve.compute.wgsl`:

```wgsl
// The wind sea's spectra at one time, one invocation a bin of each cascade
// (oceanGpuFft.ts). It mirrors evolveSpectrum in oceanFft.ts: each bin's
// starting amplitude turned by its frequency, and from it the eight fields,
// packed two real fields to a complex value, so that the inverse FFT of
// a + i b is a(x) + i b(x). Layer 2c of the spectra holds
// (height + i dx, dz + i slopeX), layer 2c + 1 (slopeZ + i ddx/dx,
// ddz/dz + i ddx/dz).

const N: u32 = 256u;
const PI: f32 = 3.14159265358979;

struct Params {
  // x: seconds folded into the sea's repeat, y: the choppiness.
  time: vec4<f32>,
  // The cascades' sizes, metres.
  sizes: vec4<f32>,
};

// Per bin: (h0 real, h0 imaginary, omega, 0), cascade by cascade.
@group(0) @binding(0) var<storage, read> h0: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> spectra: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

// FFT order: 0 .. N/2 - 1, then -N/2 .. -1.
fn waveIndex(m: u32) -> f32 {
  return select(f32(m), f32(m) - f32(N), m >= N / 2u);
}

// i times a.
fn timesI(a: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(-a.y, a.x);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let col = id.x;
  let row = id.y;
  let cascade = id.z;
  let base = cascade * N * N;
  let here = h0[base + row * N + col];
  let there = h0[base + ((N - row) % N) * N + (N - col) % N];
  // The phase folded to one turn before the sine, which is exact only near zero.
  let phase = 2.0 * PI * fract(here.z * params.time.x / (2.0 * PI));
  let c = cos(phase);
  let s = sin(phase);
  // h0(k) e^(-i w t) + conj(h0(-k)) e^(i w t)
  let h = vec2<f32>(
    here.x * c + here.y * s + there.x * c + there.y * s,
    here.y * c - here.x * s + there.x * s - there.y * c,
  );
  let dk = 2.0 * PI / params.sizes[cascade];
  let kx = dk * waveIndex(col);
  let kz = dk * waveIndex(row);
  let k = length(vec2<f32>(kx, kz));
  let inverse = select(0.0, 1.0 / k, k > 0.0);
  let ux = kx * inverse;
  let uz = kz * inverse;
  let ih = timesI(h);
  let dx = ux * ih;
  let dz = uz * ih;
  let sx = kx * ih;
  let sz = kz * ih;
  let dxdx = -kx * ux * h;
  let dzdz = -kz * uz * h;
  let dxdz = -kx * uz * h;
  let at = cascade * 2u * N * N + row * N + col;
  spectra[at] = vec4<f32>(h + timesI(dx), dz + timesI(sx));
  spectra[at + N * N] = vec4<f32>(sz + timesI(dxdx), dzdz + timesI(dxdz));
}
```

Create `client/src/game/shaders/oceanFftPass.compute.wgsl`:

```wgsl
// One direction of the wind sea's inverse FFT (oceanGpuFft.ts): a workgroup
// a line of N values, every line of every layer in one dispatch. The line is
// read into workgroup memory, transformed by a radix-2 Stockham FFT of
// STAGES stages, each reading one half of the scratch and writing the other
// with a barrier between, and written back in place. Each value is a vec4,
// two complex values that share every twiddle. It mirrors fftInverseLine in
// oceanFft.ts: the lines marked stockham are the same as its own.

const N: u32 = 256u;
const HALF: u32 = 128u;
const STAGES: u32 = 8u;
const PI: f32 = 3.14159265358979;

@group(0) @binding(0) var<storage, read_write> spectra: array<vec4<f32>>;

// Two halves of N vec4: 2 x 256 x 16 bytes = 8 KiB, inside the 16 KiB a workgroup may hold.
var<workgroup> scratch: array<vec4<f32>, 512>;

fn complexTimes(a: vec2<f32>, w: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(a.x * w.x - a.y * w.y, a.x * w.y + a.y * w.x);
}

fn transform(j: u32, offset: u32, stride: u32) {
  scratch[j] = spectra[offset + j * stride];
  scratch[j + HALF] = spectra[offset + (j + HALF) * stride];
  workgroupBarrier();
  for (var stage = 0u; stage < STAGES; stage++) {
    let src = (stage & 1u) * N; // stockham: src
    let dst = N - src; // stockham: dst
    let span = 1u << stage; // stockham: span
    let r = j & (span - 1u); // stockham: r
    let angle = (PI * f32(r)) / f32(span); // stockham: angle
    let dest = ((j >> stage) << (stage + 1u)) + r; // stockham: dest
    let w = vec2<f32>(cos(angle), sin(angle));
    let a = scratch[src + j];
    let c = scratch[src + j + HALF];
    let b = vec4<f32>(complexTimes(c.xy, w), complexTimes(c.zw, w));
    scratch[dst + dest] = a + b;
    scratch[dst + dest + span] = a - b;
    workgroupBarrier();
  }
  let out = (STAGES & 1u) * N;
  spectra[offset + j * stride] = scratch[out + j];
  spectra[offset + (j + HALF) * stride] = scratch[out + j + HALF];
}

// Workgroup (line, layer): the line's N values are consecutive.
@compute @workgroup_size(128, 1, 1)
fn rows(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) j: u32) {
  transform(j, group.y * N * N + group.x * N, 1u);
}

// Workgroup (column, layer): the column's N values are N apart.
@compute @workgroup_size(128, 1, 1)
fn columns(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) j: u32) {
  transform(j, group.y * N * N + group.x, N);
}
```

Create `client/src/game/shaders/oceanFftResolve.compute.wgsl`:

```wgsl
// The wind sea's fields out of the transformed spectra, one invocation a
// texel of each cascade (oceanGpuFft.ts): disp holds (height, dx, dz,
// Jacobian) with the displacement scaled by the choppiness, slope holds
// (slopeX, slopeZ, 0, 0), a layer a cascade. It mirrors windSeaFields in
// oceanFft.ts.

const N: u32 = 256u;

struct Params {
  // x: seconds folded into the sea's repeat, y: the choppiness.
  time: vec4<f32>,
  // The cascades' sizes, metres.
  sizes: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> spectra: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var disp: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var slope: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let z = id.y;
  let cascade = id.z;
  let at = cascade * 2u * N * N + z * N + x;
  // (height, dx, dz, slopeX) and (slopeZ, ddx/dx, ddz/dz, ddx/dz)
  let a = spectra[at];
  let b = spectra[at + N * N];
  let l = params.time.y;
  let jacobian = (1.0 + l * b.y) * (1.0 + l * b.z) - l * l * b.w * b.w;
  textureStore(disp, vec2<u32>(x, z), cascade, vec4<f32>(a.x, l * a.y, l * a.z, jacobian));
  textureStore(slope, vec2<u32>(x, z), cascade, vec4<f32>(a.w, b.x, 0.0, 0.0));
}
```

Create `client/src/game/oceanGpuFft.ts`:

```ts
/**
 * The high tier's wind sea: three cascades of FFT_N² (FFT_CASCADES metres
 * across) computed each frame in WebGPU compute, read by the sea's material
 * as two texture arrays. The compute shaders are WGSL
 * (shaders/oceanFft*.compute.wgsl), outside the GLSL → WGSL translation the
 * materials take; the CPU reference they mirror is `oceanFft.ts`.
 *
 * A frame is four dispatches (`step`):
 * 1. evolve: every bin of every cascade turned to the frame's time, the
 *    eight fields packed two real fields to a complex value (height + i·dx,
 *    dz + i·slopeX, slopeZ + i·∂dx/∂x, ∂dz/∂z + i·∂dx/∂z) into a storage
 *    buffer of 2 layers a cascade;
 * 2. rows: a workgroup a line, every row of every layer, the 256-point
 *    Stockham FFT in workgroup memory, in place;
 * 3. columns: the same down every column;
 * 4. resolve: the fields out to `disp` (height, dx, dz, Jacobian) and
 *    `slope` (slopeX, slopeZ, 0, 0), rgba16float, a layer a cascade.
 * The spectra live in storage buffers rather than textures: a line is read
 * and written in place by the one workgroup that owns it, so nothing
 * ping-pongs in memory, and no stage binds more than two storage textures
 * (resolve's outputs), inside the device's four.
 *
 * h0 is built on the CPU (`windSeaH0`, about 20 ms for the three cascades)
 * and uploaded by `setSpectrum`, which the caller runs when the wind sea's
 * state has moved by more than a step. Babylon ends the frame's render pass
 * before each dispatch, so `step` belongs before the scene's first pass of
 * the frame (before `scene.render()`).
 *
 * Babylon 9.18's compute API as it stands: `ComputeShader` (constructor with
 * `{ computeSource }` and `{ bindingsMapping, entryPoint }`, `setStorageBuffer`,
 * `setUniformBuffer`, `setStorageTexture`, `isReady`, `dispatch`, `onError`),
 * `StorageBuffer` (`update`, `dispose`), the engine's `createUniformBuffer`,
 * `updateUniformBuffer`, `_releaseBuffer` and `createRawTexture2DArray` with
 * `TEXTURE_CREATIONFLAG_STORAGE`. Every pipeline takes the device's automatic
 * layout: Babylon's explicit one gives a storage texture array a 2-D view.
 *
 * WebGPU only, and only where the engine reports compute: `createGpuWindSea`
 * returns null on any other engine, and the caller draws the medium tier's
 * loop instead. This module names no module of Babylon's WebGPU engine at run
 * time; the caller may import it dynamically on the WebGPU path alone.
 */
import { ComputeShader } from "@babylonjs/core/Compute/computeShader.pure.js";
import type { ComputeBindingMapping } from "@babylonjs/core/Engines/Extensions/engine.computeShader.pure.js";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer.js";
import type { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import evolveSource from "./shaders/oceanFftEvolve.compute.wgsl?raw";
import passSource from "./shaders/oceanFftPass.compute.wgsl?raw";
import resolveSource from "./shaders/oceanFftResolve.compute.wgsl?raw";
import { WIND_SEA_CHOPPINESS } from "./oceanFft.js";
import { FFT_CASCADES, FFT_N, WIND_SEA_REPEAT, cascadeBands, windSeaCascadeSeed, windSeaH0 } from "./oceanSpectrum.js";

export type GpuWindSea = {
  /** (height, dx, dz, Jacobian), a layer a cascade, FFT_N², rgba16float, bilinear, wrapping. */
  disp: BaseTexture;
  /** (slopeX, slopeZ, 0, 0), likewise. */
  slope: BaseTexture;
  /** Rebuilds h0 for the wind sea's state on the CPU and uploads it. */
  setSpectrum(state: { u10: number; dir: [number, number] }, seed: number): void;
  /** One frame at `seconds` on the shared clock: evolve, rows, columns, resolve.
   * Nothing until every shader has compiled; then four dispatches. */
  step(seconds: number): void;
  /** `compiling` until the four shaders are ready, `running` once a frame has
   * been dispatched, `failed` if one did not compile (the caller falls back). */
  status(): "compiling" | "running" | "failed";
  dispose(): void;
};

/** Where each shader's resources are bound, as its WGSL declares them. */
export const OCEAN_FFT_EVOLVE_BINDINGS: ComputeBindingMapping = {
  h0: { group: 0, binding: 0 },
  spectra: { group: 0, binding: 1 },
  params: { group: 0, binding: 2 },
};
export const OCEAN_FFT_PASS_BINDINGS: ComputeBindingMapping = {
  spectra: { group: 0, binding: 0 },
};
export const OCEAN_FFT_RESOLVE_BINDINGS: ComputeBindingMapping = {
  spectra: { group: 0, binding: 0 },
  params: { group: 0, binding: 1 },
  disp: { group: 0, binding: 2 },
  slope: { group: 0, binding: 3 },
};

/** Each dispatch's workgroup counts: a 16 × 16 workgroup per tile of bins or
 * texels of each cascade for evolve and resolve, a workgroup per line of each
 * of the 2 × 3 layers for the passes. */
export const OCEAN_FFT_DISPATCH = {
  evolve: [FFT_N / 16, FFT_N / 16, FFT_CASCADES.length],
  rows: [FFT_N, 2 * FFT_CASCADES.length, 1],
  columns: [FFT_N, 2 * FFT_CASCADES.length, 1],
  resolve: [FFT_N / 16, FFT_N / 16, FFT_CASCADES.length],
} as const;

/** A half float's 1.0: the Jacobian `disp` holds before the first frame, an unfolded sea. */
const HALF_ONE = 0x3c00;

/**
 * What `setSpectrum` uploads: h0 of each cascade for the wind sea's state
 * (`windSeaH0`, its seed `windSeaCascadeSeed(seed, c)`), as the evolve shader
 * reads it: a vec4 (re, im, ω, 0) a bin, cascade after cascade, each in FFT
 * order row by row.
 */
export function gpuWindSeaH0(state: { u10: number; dir: [number, number] }, seed: number): Float32Array {
  const n = FFT_N;
  const bands = cascadeBands(FFT_CASCADES, n);
  const data = new Float32Array(FFT_CASCADES.length * n * n * 4);
  FFT_CASCADES.forEach((size, c) => {
    const cascade = windSeaH0(n, size, state, bands[c]!, windSeaCascadeSeed(seed, c));
    for (let i = 0; i < n * n; i++) {
      const at = (c * n * n + i) * 4;
      data[at] = cascade.re[i]!;
      data[at + 1] = cascade.im[i]!;
      data[at + 2] = cascade.omega[i]!;
    }
  });
  return data;
}

/**
 * The wind sea on the GPU, or null where `engine` is not WebGPU or has no
 * compute. Its textures read a flat, unfolded sea until the first frame.
 */
export function createGpuWindSea(engine: AbstractEngine): GpuWindSea | null {
  if (!engine.isWebGPU || !engine.getCaps().supportComputeShaders) return null;
  const n = FFT_N;
  const cascades = FFT_CASCADES.length;
  const gpu = engine as WebGPUEngine;

  const h0 = new StorageBuffer(gpu, cascades * n * n * 16, Constants.BUFFER_CREATIONFLAG_WRITE, "oceanFftH0");
  const spectra = new StorageBuffer(gpu, 2 * cascades * n * n * 16, Constants.BUFFER_CREATIONFLAG_READWRITE, "oceanFftSpectra");
  const values = new Float32Array(8);
  values[1] = WIND_SEA_CHOPPINESS;
  FFT_CASCADES.forEach((size, c) => {
    values[4 + c] = size;
  });
  const params: DataBuffer = engine.createUniformBuffer(values, "oceanFftParams");

  const flat = new Uint16Array(n * n * cascades * 4);
  for (let i = 3; i < flat.length; i += 4) flat[i] = HALF_ONE;
  const target = (data: Uint16Array | null, name: string): BaseTexture => {
    const internal = engine.createRawTexture2DArray(
      data, n, n, cascades, Constants.TEXTUREFORMAT_RGBA, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      null, Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTURE_CREATIONFLAG_STORAGE,
    );
    const texture = new BaseTexture(engine, internal);
    texture.name = name;
    texture.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
    texture.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE;
    return texture;
  };
  const disp = target(flat, "oceanWindDisp");
  const slope = target(null, "oceanWindSlope");

  let failed = false;
  let ran = false;
  let disposed = false;
  const shader = (name: string, source: string, bindingsMapping: ComputeBindingMapping, entryPoint = "main"): ComputeShader => {
    const made = new ComputeShader(name, engine, { computeSource: source }, { bindingsMapping, entryPoint });
    made.onError = (_effect, errors) => {
      if (!failed) console.warn(`Ocean: the wind sea's ${name} shader did not compile; the sea draws without it.`, errors);
      failed = true;
    };
    return made;
  };
  const evolve = shader("oceanFftEvolve", evolveSource, OCEAN_FFT_EVOLVE_BINDINGS);
  const rows = shader("oceanFftRows", passSource, OCEAN_FFT_PASS_BINDINGS, "rows");
  const columns = shader("oceanFftColumns", passSource, OCEAN_FFT_PASS_BINDINGS, "columns");
  const resolve = shader("oceanFftResolve", resolveSource, OCEAN_FFT_RESOLVE_BINDINGS);
  evolve.setStorageBuffer("h0", h0);
  evolve.setStorageBuffer("spectra", spectra);
  evolve.setUniformBuffer("params", params);
  rows.setStorageBuffer("spectra", spectra);
  columns.setStorageBuffer("spectra", spectra);
  resolve.setStorageBuffer("spectra", spectra);
  resolve.setUniformBuffer("params", params);
  resolve.setStorageTexture("disp", disp);
  resolve.setStorageTexture("slope", slope);
  const all = [evolve, rows, columns, resolve];

  return {
    disp,
    slope,
    setSpectrum(state, seed) {
      if (!disposed) h0.update(gpuWindSeaH0(state, seed));
    },
    step(seconds) {
      if (disposed || failed || !all.every((s) => s.isReady())) return;
      const folded = seconds - WIND_SEA_REPEAT * Math.floor(seconds / WIND_SEA_REPEAT);
      values[0] = folded;
      engine.updateUniformBuffer(params, values);
      const d = OCEAN_FFT_DISPATCH;
      evolve.dispatch(d.evolve[0], d.evolve[1], d.evolve[2]);
      rows.dispatch(d.rows[0], d.rows[1], d.rows[2]);
      columns.dispatch(d.columns[0], d.columns[1], d.columns[2]);
      resolve.dispatch(d.resolve[0], d.resolve[1], d.resolve[2]);
      ran = true;
    },
    status() {
      if (failed) return "failed";
      return ran ? "running" : "compiling";
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      h0.dispose();
      spectra.dispose();
      engine._releaseBuffer(params);
      disp.dispose();
      slope.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanGpuFft.test.ts test/game/oceanFft.test.ts test/architecture.test.ts`
Expected: PASS (10 tests in `oceanGpuFft.test.ts`). Then `npm run typecheck` and `npx eslint client/src/game/oceanGpuFft.ts client/test/game/oceanGpuFft.test.ts`: no errors (the `?raw` imports are typed by `vite/client`).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanGpuFft.ts client/src/game/shaders/oceanFftEvolve.compute.wgsl client/src/game/shaders/oceanFftPass.compute.wgsl client/src/game/shaders/oceanFftResolve.compute.wgsl client/test/game/oceanGpuFft.test.ts
git commit -F - <<'EOF'
feat: the wind sea's FFT in WebGPU compute

## What

The high tier's wind sea computed on the GPU every frame: three cascades of
256², 1,000, 150 and 25 m across, in four dispatches (the spectra turned to the
frame's time, every row, every column, the fields out), each line's inverse
FFT a 256-point Stockham in workgroup memory, the same algorithm as the CPU's,
the results two rgba16float texture arrays the sea's material can read: the
height, the displacement and the Jacobian in one, the slopes in the other. The
spectra stay in storage buffers, transformed in place, and no stage binds more
than two storage textures. On any engine without WebGPU compute it is null,
for the medium tier's loop to take its place.

## How

- `client/src/game/oceanGpuFft.ts` — `createGpuWindSea`, the upload's layout (`gpuWindSeaH0`), the bindings and the dispatch counts
- `client/src/game/shaders/oceanFftEvolve.compute.wgsl` — each bin turned to the frame's time, eight fields packed four complex values a bin
- `client/src/game/shaders/oceanFftPass.compute.wgsl` — the rows' and the columns' entry points, a workgroup a line
- `client/src/game/shaders/oceanFftResolve.compute.wgsl` — the fields out to the two texture arrays, the Jacobian formed
- `client/test/game/oceanGpuFft.test.ts` — the WGSL's bindings, limits and Stockham lines in lockstep with `oceanFft.ts`, null without compute, and the shaders' algorithm run on the CPU against `windSeaFields`

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 4: Seven stitched rings

**Files:**
- Modify: `client/src/game/water.ts:1-12, 18-21, 34-42, 129-161, 186, 189-198, 221-222`
- Modify: `client/src/game/renderer.ts:633-645, 651, 820, 957-959` (line numbers as on main at 9edee7e; every edit is anchored on its text)
- Test: `client/test/game/water.test.ts` (rewritten), `client/test/game/waterMesh.test.ts:20, 54-67, 334-335, 339, 347-363, 393-398, 413-414`

**Interfaces:**
- Consumes:
  - `client/src/game/clipmap.ts`: `blendWeight(hole: { x0: number; z0: number } | null, ix: number, iz: number): number` (the terrain's border weight, unchanged), `HOLE_CELLS` (64), `snapOrigin(cam: number, spacing: number): number`, `RING_CELLS` (test).
  - `client/src/game/engineChoice.ts`: `WEBGPU_REQUIRED_LIMITS.maxVertexBuffers` (8) (test).
- Produces (`client/src/game/water.ts`, `client/src/game/renderer.ts`):
  - `WATER_RING_COUNT = 7`, `WATER_BASE_SPACING = 1`, `WATER_RING_CELLS = 128` (unchanged): rings a vertex every 1, 2, 4, 8, 16, 32 and 64 m; the outer ring 8,192 m across, reaching at least 3,968 m from the camera every way; the camera at least 62 m inside ring 0. `waterRingSpacing(level)` = 2^level.
  - `export const OCEAN_BOUND = 12` (m): how far the drawn sea may stand off its plane on every axis: the largest crest a wave reaches as it breaks, twice `SWELL_HS_MAX` (8 m), taken whole on either side of the level, plus the storm's wind sea (4 m). `wetBounds(geometry)` returns the wet cells' box grown by it on all six sides: y from level − 12 to level + 12, and x and z 12 m past the wet cells too (a trochoid carries its vertices sideways, and the waterline runs up the beach with the wave).
  - `WaterGeometry` gains `oceanMorph: Float32Array` (one float a vertex) and `oceanCoarse: Float32Array` (two a vertex), uploaded by `applyWaterGeometry` as the updatable vertex attributes `"oceanMorph"` (size 1) and `"oceanCoarse"` (size 2) on every emit:
    - `oceanMorph` = `blendWeight(hole, ix, iz)`, the terrain's definition, on rings 0 to 5: exactly 0.0 on the edge of the ring's hole (ring 0: at its centre vertex), rising linearly to exactly 1.0 on its outer edge. 0 everywhere on ring 6, which has no coarser ring.
    - `oceanCoarse` = e, the half-edge (x, z) in metres to the coarser ring's lattice, by the parity of the vertex's indices (the ring's origin is a multiple of 2·spacing, so an even index is on the coarser lattice): (0, 0) even-even; (s, 0) odd x; (0, s) odd z; (s, −s) odd-odd, a coarser cell's centre on the diagonal the coarser ring draws from its cell's (+x, 0) corner to its (0, +z) corner. (0, 0) everywhere on ring 6. For every vertex, p − e and p + e are the two ends of a drawn edge of the coarser ring's triangulation with p exactly at its middle, so the coarser ring's linear interpolation at p is the mean of what it draws at p ± e (pinned for all 99,846 vertices of rings 0 to 5).
  - The stitch the vertex stage writes (Task 11 consumes it): with p the vertex's world xz (the ring meshes carry no transform: `positionUpdated.xz` is the world's), m = `oceanMorph` and e = `oceanCoarse`, the waves are evaluated once, at p′ = p − m·e, the undisplaced point written to `vOceanXZ`, with the ring's wavelength cutoff mixed toward the coarser ring's, written `own * (1.0 - m) + coarser * m` so that m = 1.0 gives the coarser value exactly. On the outer edge m is exactly 1.0, so p′ is exactly a vertex of the coarser ring on its hole's edge, where the coarser ring's m is exactly 0.0: both draws evaluate the same point with the same cutoff, and the finer ring's border is the coarser ring's edge, vertex for vertex (its odd vertices fold onto their even neighbours: degenerate triangles, no T-junction, no crack; pinned edge for edge with the coarser ring's linear interpolation exact along every segment). Inside the band the vertices move toward the coarser lattice by the same weight the terrain blends its heights by. Chosen over blending two evaluations because it costs one swell evaluation a vertex, the 54 atlas reads Task 5 measures, where a blend toward the mean at p ± e costs three; the same two attributes carry that blend too (`mix(atP, 0.5 * (atPMinusE + atPPlusE), m)`), should the gates prefer it.
  - Counts: 16,641 vertices a ring, 116,487 uploaded over the seven (66,564 before), 92,673 of them indexed (ring 0's 16,641 and 12,672 a holed ring); 180,224 triangles: 32,768 in ring 0 and 24,576 in each of rings 1 to 6 (106,496 before). Vertex buffers per ring mesh: six (`position`, `normal`, `uv`, `bedDepth`, `oceanMorph`, `oceanCoarse`), one a kind, of WebGPU's 8 (`WEBGPU_REQUIRED_LIMITS`); were it ever instanced, its world matrix would be a seventh. A ring's emit (`waterRingGeometry` and `wetBounds`) measured 0.53 ms against 0.38 ms before, under Node on the development machine; ring 0 re-emits every 2 m the camera moves, ring 1 with it.

- [ ] **Step 1: Write the failing test**

`client/test/game/water.test.ts` — replace the whole file with:

```ts
import { beforeAll, describe, it, expect } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  createWaterRingSamples, updateWaterRingSamples, waterHoleCellsFor,
  waterRingGeometry, waterRingSpacing, wetBounds,
  OCEAN_BOUND, WATER_RING_CELLS, WATER_RING_COUNT,
  type WaterGeometry, type WaterRingSamples,
} from "../../src/game/water.js";
import { HOLE_CELLS, RING_CELLS, blendWeight } from "../../src/game/clipmap.js";

const SEED = 0x5eed;
setActiveTerrainVariant("olympic");

/** The seven rings around a camera, finest first, as the shell builds them. */
function ringsAt(camX: number, camZ: number): WaterRingSamples[] {
  return Array.from({ length: WATER_RING_COUNT }, (_, level) => createWaterRingSamples(SEED, level, camX, camZ));
}

/** Each ring's hole: the finer ring's footprint, none for ring 0. */
function holeOf(rings: WaterRingSamples[], level: number): { x0: number; z0: number } | null {
  return level === 0 ? null : waterHoleCellsFor(rings[level] as WaterRingSamples, rings[level - 1] as WaterRingSamples);
}

describe("water rings", () => {
  it("keeps the same cell count as the terrain clipmap", () => {
    // The borrowed `snapOrigin` centres rings using clipmap's RING_CELLS, so
    // if the two counts ever diverge, water rings silently miscentre.
    expect(WATER_RING_CELLS).toBe(RING_CELLS);
  });

  it("runs seven rings a vertex every 1, 2, 4, 8, 16, 32 and 64 m, spanning at least 8 km", () => {
    expect(WATER_RING_COUNT).toBe(7);
    expect(Array.from({ length: WATER_RING_COUNT }, (_, level) => waterRingSpacing(level))).toEqual([1, 2, 4, 8, 16, 32, 64]);
    expect(waterRingSpacing(WATER_RING_COUNT - 1) * WATER_RING_CELLS).toBe(8192);
    expect(waterRingSpacing(WATER_RING_COUNT - 1) * WATER_RING_CELLS).toBeGreaterThanOrEqual(8000);
  });

  it("nests every ring in the hole of the next and covers the view around the camera", () => {
    for (const [camX, camZ] of [[0, 0], [-500, 300], [1234.5, -987.25]] as const) {
      const rings = ringsAt(camX, camZ);
      // The camera at least 62 m inside the finest ring on every side, and the
      // coarsest reaching at least 3,968 m from it every way.
      const first = rings[0] as WaterRingSamples;
      const last = rings[WATER_RING_COUNT - 1] as WaterRingSamples;
      const reach = (r: WaterRingSamples) => Math.min(
        camX - r.originX, r.originX + WATER_RING_CELLS * r.spacing - camX,
        camZ - r.originZ, r.originZ + WATER_RING_CELLS * r.spacing - camZ,
      );
      expect(reach(first)).toBeGreaterThanOrEqual(62);
      expect(reach(last)).toBeGreaterThanOrEqual(3968);
      for (let level = 1; level < WATER_RING_COUNT; level++) {
        const ring = rings[level] as WaterRingSamples;
        const finer = rings[level - 1] as WaterRingSamples;
        const hole = waterHoleCellsFor(ring, finer);
        // whole cells, strictly inside the ring
        for (const at of [hole.x0, hole.z0]) {
          expect(Number.isInteger(at)).toBe(true);
          expect(at).toBeGreaterThanOrEqual(1);
          expect(at + HOLE_CELLS).toBeLessThanOrEqual(WATER_RING_CELLS - 1);
        }
        // exactly the finer ring's footprint
        expect(ring.originX + hole.x0 * ring.spacing).toBe(finer.originX);
        expect(ring.originZ + hole.z0 * ring.spacing).toBe(finer.originZ);
        expect(HOLE_CELLS * ring.spacing).toBe(WATER_RING_CELLS * finer.spacing);
      }
    }
  }, timeLimit(60_000));

  it("draws 180,224 triangles over 116,487 vertices in its seven rings", () => {
    const rings = ringsAt(-500, 0);
    let vertices = 0;
    let triangles = 0;
    const perRing: number[] = [];
    for (let level = 0; level < WATER_RING_COUNT; level++) {
      const g = waterRingGeometry(rings[level] as WaterRingSamples, holeOf(rings, level), 0);
      vertices += g.positions.length / 3;
      triangles += g.indices.length / 3;
      perRing.push(g.indices.length / 3);
    }
    expect(perRing).toEqual([32768, 24576, 24576, 24576, 24576, 24576, 24576]);
    expect(triangles).toBe(180224);
    expect(vertices).toBe(116487);
  }, timeLimit(30_000));

  it("scroll equals fresh build", () => {
    const scrolled = createWaterRingSamples(SEED, 0, 0, 0);
    updateWaterRingSamples(scrolled, SEED, 100, -60);
    const fresh = createWaterRingSamples(SEED, 0, 100, -60);
    expect(scrolled.originX).toBe(fresh.originX);
    expect(scrolled.originZ).toBe(fresh.originZ);
    expect(Array.from(scrolled.h)).toEqual(Array.from(fresh.h));
  }, timeLimit(30_000));

  it("returns false when the snapped origin has not moved", () => {
    const ring = createWaterRingSamples(SEED, 2, 0, 0);
    expect(updateWaterRingSamples(ring, SEED, 3, 3)).toBe(false); // level-2 snap step is 8 m
  });

  it("cuts a hole exactly where the finer ring sits", () => {
    const fine = createWaterRingSamples(SEED, 0, -500, 0);
    const coarse = createWaterRingSamples(SEED, 1, -500, 0);
    const hole = waterHoleCellsFor(coarse, fine);
    const g = waterRingGeometry(coarse, hole, 0);
    const cells = WATER_RING_CELLS * WATER_RING_CELLS - (WATER_RING_CELLS / 2) * (WATER_RING_CELLS / 2);
    expect(g.indices.length).toBe(cells * 6);
  });

  it("puts every vertex at the water level with an up normal and a UV", () => {
    const ring = createWaterRingSamples(SEED, 0, -500, 0);
    const g = waterRingGeometry(ring, null, 0);
    expect(g.positions[1]).toBe(0);
    expect(g.normals.slice(0, 3)).toEqual(new Float32Array([0, 1, 0]));
    expect(g.uvs.length * 3).toBe(g.positions.length * 2);
  });

  it("writes the bed depth per vertex, clamped at zero on land", () => {
    const ring = createWaterRingSamples(SEED, 0, 0, 0);
    const g = waterRingGeometry(ring, null, 10);
    expect(g.bedDepth.length).toBe(g.positions.length / 3);
    expect((g as unknown as { colors?: unknown }).colors).toBeUndefined();
    for (let i = 0; i < g.bedDepth.length; i++) {
      const expected = Math.max(0, 10 - (ring.h[i] as number));
      expect(g.bedDepth[i]).toBeCloseTo(expected, 5);
    }
  });

  describe("the box a ring's water can be drawn in (wetBounds)", () => {
    const SIDE = WATER_RING_CELLS + 1;

    it("is null for a ring with no wet vertex", () => {
      const ring = createWaterRingSamples(SEED, 1, 0, 0);
      ring.h.fill(50);
      expect(wetBounds(waterRingGeometry(ring, null, 0))).toBeNull();
    });

    it("is the box of the cells around the wet vertices, at the water level", () => {
      const ring = createWaterRingSamples(SEED, 0, 0, 0);
      ring.h.fill(50);
      // two wet vertices: (10, 20) and (30, 25)
      ring.h[20 * SIDE + 10] = -5;
      ring.h[25 * SIDE + 30] = -1;
      const b = wetBounds(waterRingGeometry(ring, null, 3))!;
      const s = ring.spacing;
      // each wet vertex's four cells draw water up to their dry corners, and
      // the waves may carry the surface OCEAN_BOUND off them every way
      expect(OCEAN_BOUND).toBe(12);
      expect(b.min).toEqual([ring.originX + 9 * s - 12, 3 - 12, ring.originZ + 19 * s - 12]);
      expect(b.max).toEqual([ring.originX + 31 * s + 12, 3 + 12, ring.originZ + 26 * s + 12]);
    });

    it("counts a vertex wet only when its depth is above zero, and a cell in the hole for nothing", () => {
      const fine = createWaterRingSamples(SEED, 0, 0, 0);
      const coarse = createWaterRingSamples(SEED, 1, 0, 0);
      const hole = waterHoleCellsFor(coarse, fine);
      coarse.h.fill(50);
      // exactly at the level: depth 0, dry
      coarse.h[10 * SIDE + 10] = 0;
      expect(wetBounds(waterRingGeometry(coarse, hole, 0))).toBeNull();
      // wet, but every cell around it is in the hole (not drawn)
      const inside = (hole.z0 + 5) * SIDE + hole.x0 + 5;
      coarse.h[inside] = -5;
      expect(wetBounds(waterRingGeometry(coarse, hole, 0))).toBeNull();
      expect(wetBounds(waterRingGeometry(coarse, null, 0))).not.toBeNull();
    });

    it("holds every wet vertex of a real ring and is no larger than the cells around them", () => {
      const ring = createWaterRingSamples(SEED, 1, -500, 0);
      const g = waterRingGeometry(ring, null, 0);
      const b = wetBounds(g)!;
      expect(b).not.toBeNull();
      let wet = 0;
      let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < g.bedDepth.length; i++) {
        if ((g.bedDepth[i] as number) <= 0) continue;
        wet++;
        const x = g.positions[i * 3] as number;
        const z = g.positions[i * 3 + 2] as number;
        [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)];
      }
      expect(wet).toBeGreaterThan(0);
      expect(wet).toBeLessThan(g.bedDepth.length); // a shore: some of it is land
      const s = ring.spacing;
      expect(b.min[0]).toBeLessThanOrEqual(minX - OCEAN_BOUND);
      expect(b.min[0]).toBeGreaterThanOrEqual(minX - s - OCEAN_BOUND);
      expect(b.min[2]).toBeLessThanOrEqual(minZ - OCEAN_BOUND);
      expect(b.min[2]).toBeGreaterThanOrEqual(minZ - s - OCEAN_BOUND);
      expect(b.max[0]).toBeGreaterThanOrEqual(maxX + OCEAN_BOUND);
      expect(b.max[0]).toBeLessThanOrEqual(maxX + s + OCEAN_BOUND);
      expect(b.max[2]).toBeGreaterThanOrEqual(maxZ + OCEAN_BOUND);
      expect(b.max[2]).toBeLessThanOrEqual(maxZ + s + OCEAN_BOUND);
      // the crest and the trough: the level, 0 here, give or take OCEAN_BOUND
      expect(b.min[1]).toBe(-12);
      expect(b.max[1]).toBe(12);
    }, timeLimit(30_000));
  });

  describe("what the vertex stage stitches a ring's waves to the coarser ring's with", () => {
    const SIDE = WATER_RING_CELLS + 1;
    let rings: WaterRingSamples[] = [];
    let geometries: WaterGeometry[] = [];
    beforeAll(() => {
      rings = ringsAt(-500, 0);
      geometries = rings.map((ring, level) => waterRingGeometry(ring, holeOf(rings, level), 0));
    }, timeLimit(30_000));
    const onOuterEdge = (ix: number, iz: number): boolean =>
      ix === 0 || iz === 0 || ix === WATER_RING_CELLS || iz === WATER_RING_CELLS;
    // Any value the waves give a point: a displacement, here made up.
    const f = (x: number, z: number): number => Math.sin(0.37 * x) + Math.cos(0.11 * z) + 0.001 * x;

    /** The coarser ring's surface at (px, pz) as it draws it, over its full
     * triangulation (`full`, built with no hole) and by barycentric weights:
     * the value there, the weights, and the two vertices `oceanCoarse` named. */
    function coarserAt(level: number, full: WaterGeometry, edges: Map<string, number>, px: number, pz: number, ex: number, ez: number):
      { value: number; weights: number[]; a: number; b: number } | string {
      const coarse = rings[level + 1]!;
      const vertexAt = (x: number, z: number): number | null => {
        const ix = (x - coarse.originX) / coarse.spacing;
        const iz = (z - coarse.originZ) / coarse.spacing;
        if (!Number.isInteger(ix) || !Number.isInteger(iz) || ix < 0 || iz < 0 || ix > WATER_RING_CELLS || iz > WATER_RING_CELLS) return null;
        return iz * SIDE + ix;
      };
      const a = vertexAt(px - ex, pz - ez);
      const b = vertexAt(px + ex, pz + ez);
      if (a === null || b === null) return "off the coarser lattice";
      const ax = full.positions[a * 3]!, az = full.positions[a * 3 + 2]!;
      if (a === b) return ax === px && az === pz ? { value: f(ax, az), weights: [1], a, b } : "not on its coarser vertex";
      const c = edges.get(`${Math.min(a, b)},${Math.max(a, b)}`);
      if (c === undefined) return "not a drawn edge of the coarser ring";
      const bx = full.positions[b * 3]!, bz = full.positions[b * 3 + 2]!;
      const cx = full.positions[c * 3]!, cz = full.positions[c * 3 + 2]!;
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const wa = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / area;
      const wb = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / area;
      const wc = ((ax - px) * (bz - pz) - (az - pz) * (bx - px)) / area;
      return { value: wa * f(ax, az) + wb * f(bx, bz) + wc * f(cx, cz), weights: [wa, wb, wc], a, b };
    }

    /** A ring's drawn edges, each to a third vertex of a triangle it bounds. */
    function edgesOf(g: WaterGeometry): Map<string, number> {
      const edges = new Map<string, number>();
      for (let t = 0; t < g.indices.length; t += 3) {
        const tri = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
        for (let k = 0; k < 3; k++) {
          const a = tri[k]!, b = tri[(k + 1) % 3]!;
          edges.set(`${Math.min(a, b)},${Math.max(a, b)}`, tri[(k + 2) % 3]!);
        }
      }
      return edges;
    }

    it("blends as the terrain does: the clipmap's blendWeight, 0 at the hole's edge and ring 0's centre, 1 on the outer edge", () => {
      const wrong: string[] = [];
      for (let level = 0; level < WATER_RING_COUNT - 1; level++) {
        const g = geometries[level]!;
        const hole = holeOf(rings, level);
        for (let iz = 0; iz < SIDE; iz++) {
          for (let ix = 0; ix < SIDE; ix++) {
            const m = g.oceanMorph[iz * SIDE + ix] as number;
            if (m !== Math.fround(blendWeight(hole, ix, iz))) wrong.push(`ring ${level} (${ix}, ${iz}): ${m}`);
            if (onOuterEdge(ix, iz) && m !== 1) wrong.push(`ring ${level} outer (${ix}, ${iz}): ${m}`);
          }
        }
        if (hole === null) {
          if (g.oceanMorph[64 * SIDE + 64] !== 0) wrong.push("ring 0's centre");
        } else {
          for (let i = 0; i <= HOLE_CELLS; i++) {
            for (const [ix, iz] of [[hole.x0 + i, hole.z0], [hole.x0 + i, hole.z0 + HOLE_CELLS], [hole.x0, hole.z0 + i], [hole.x0 + HOLE_CELLS, hole.z0 + i]] as const) {
              if (g.oceanMorph[iz * SIDE + ix] !== 0) wrong.push(`ring ${level} hole edge (${ix}, ${iz})`);
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it("leaves the outermost ring unstitched: it draws its own waves throughout", () => {
      const g = geometries[WATER_RING_COUNT - 1]!;
      expect(g.oceanMorph.every((m) => m === 0)).toBe(true);
      expect(g.oceanCoarse.every((c) => c === 0)).toBe(true);
    });

    it("names, at every vertex, two coarser vertices whose mean is the coarser ring's linear interpolation there", () => {
      const wrong: string[] = [];
      let checked = 0;
      for (let level = 0; level < WATER_RING_COUNT - 1; level++) {
        const g = geometries[level]!;
        const full = waterRingGeometry(rings[level + 1]!, null, 0);
        const edges = edgesOf(full);
        for (let v = 0; v < SIDE * SIDE; v++) {
          const px = g.positions[v * 3]!, pz = g.positions[v * 3 + 2]!;
          const ex = g.oceanCoarse[v * 2]!, ez = g.oceanCoarse[v * 2 + 1]!;
          const at = coarserAt(level, full, edges, px, pz, ex, ez);
          if (typeof at === "string") { wrong.push(`ring ${level} vertex ${v}: ${at}`); continue; }
          // the middle of the edge: weights one half, one half, nothing
          if (at.a !== at.b && (at.weights[0] !== 0.5 || at.weights[1] !== 0.5 || at.weights[2] !== 0)) {
            wrong.push(`ring ${level} vertex ${v}: weights ${at.weights.join(", ")}`);
          }
          const mean = 0.5 * (f(px - ex, pz - ez) + f(px + ex, pz + ez));
          if (mean !== at.value) wrong.push(`ring ${level} vertex ${v}: ${mean} is not ${at.value}`);
          checked++;
        }
      }
      expect(wrong).toEqual([]);
      expect(checked).toBe(99846);
    }, timeLimit(30_000));

    it("collapses its outer edge onto the coarser ring's: moved by oceanMorph times oceanCoarse, edge for edge the coarser ring's, its linear interpolation exact", () => {
      const wrong: string[] = [];
      let collapsed = 0;
      let segments = 0;
      for (let level = 0; level < WATER_RING_COUNT - 1; level++) {
        const g = geometries[level]!;
        const coarse = rings[level + 1]!;
        // the coarser ring as drawn, its hole cut for this ring
        const drawn = geometries[level + 1]!;
        const edges = edgesOf(drawn);
        // The outer edge's 512 vertices in order round the ring.
        const loop: number[] = [];
        for (let i = 0; i < WATER_RING_CELLS; i++) loop.push(i);
        for (let i = 0; i < WATER_RING_CELLS; i++) loop.push(i * SIDE + WATER_RING_CELLS);
        for (let i = WATER_RING_CELLS; i > 0; i--) loop.push(WATER_RING_CELLS * SIDE + i);
        for (let i = WATER_RING_CELLS; i > 0; i--) loop.push(i * SIDE);
        // Where the vertex stage puts each before the waves: p - oceanMorph * oceanCoarse.
        const moved = loop.map((v) => {
          const m = g.oceanMorph[v]!;
          if (m !== 1) wrong.push(`ring ${level} vertex ${v}: oceanMorph ${m}`);
          return [g.positions[v * 3]! - m * g.oceanCoarse[v * 2]!, g.positions[v * 3 + 2]! - m * g.oceanCoarse[v * 2 + 1]!] as const;
        });
        const coarseVertex = (x: number, z: number): number | null => {
          const ix = (x - coarse.originX) / coarse.spacing;
          const iz = (z - coarse.originZ) / coarse.spacing;
          return Number.isInteger(ix) && Number.isInteger(iz) && ix >= 0 && iz >= 0 && ix <= WATER_RING_CELLS && iz <= WATER_RING_CELLS ? iz * SIDE + ix : null;
        };
        for (let i = 0; i < moved.length; i++) {
          const [px, pz] = moved[i]!;
          const [qx, qz] = moved[(i + 1) % moved.length]!;
          const a = coarseVertex(px, pz);
          const b = coarseVertex(qx, qz);
          // on a coarser vertex, which the coarser ring draws unblended, where it is
          if (a === null || b === null) { wrong.push(`ring ${level} step ${i}: off the coarser lattice`); continue; }
          if (drawn.oceanMorph[a] !== 0) wrong.push(`ring ${level} step ${i}: the coarser vertex is blended`);
          collapsed++;
          if (a === b) continue;
          const c = edges.get(`${Math.min(a, b)},${Math.max(a, b)}`);
          if (c === undefined) { wrong.push(`ring ${level} step ${i}: not a drawn edge of the coarser ring`); continue; }
          segments++;
          const cx = drawn.positions[c * 3]!, cz = drawn.positions[c * 3 + 2]!;
          // Along the segment the finer ring draws, the coarser ring's
          // linear interpolation over its triangle, by barycentric weights.
          for (const t of [0.25, 0.5, 0.75]) {
            const x = px + t * (qx - px);
            const z = pz + t * (qz - pz);
            const fine = (1 - t) * f(px, pz) + t * f(qx, qz);
            const area = (qx - px) * (cz - pz) - (qz - pz) * (cx - px);
            const wa = ((qx - x) * (cz - z) - (qz - z) * (cx - x)) / area;
            const wb = ((cx - x) * (pz - z) - (cz - z) * (px - x)) / area;
            const wc = ((px - x) * (qz - z) - (pz - z) * (qx - x)) / area;
            const coarser = wa * f(px, pz) + wb * f(qx, qz) + wc * f(cx, cz);
            if (fine !== coarser) wrong.push(`ring ${level} step ${i} at ${t}: ${fine} is not ${coarser}`);
          }
        }
      }
      expect(wrong).toEqual([]);
      // six stitched rings, 512 outer-edge vertices each, half of whose steps join two coarser vertices
      expect(collapsed).toBe(3072);
      expect(segments).toBe(1536);
    }, timeLimit(30_000));
  });
});
```

`client/test/game/waterMesh.test.ts`, seven edits, each old → new:

Edit 1 — old:

```ts
import { WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE, waterRingSpacing } from "../../src/game/water.js";
```

new:

```ts
import { OCEAN_BOUND, WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE, waterRingSpacing } from "../../src/game/water.js";
import { WEBGPU_REQUIRED_LIMITS } from "../../src/game/engineChoice.js";
```

Edit 2 — old:

```ts
    const water = createWater(scene, 0x5eed, 0);
    expect(water.meshes.length).toBe(WATER_RING_COUNT);
    for (const m of water.meshes) {
      expect(m.getTotalVertices()).toBeGreaterThan(0);
      expect(m.isVerticesDataPresent("bedDepth")).toBe(true);
      expect(m.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
      expect(m.useVertexColors).toBe(false);
      expect((m.metadata as { waterLevel: number }).waterLevel).toBe(0);
      const mat = m.material as PBRMaterial;
      expect(mat.name).toBe("mat_water_sea");
      expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
      expect(mat.pluginManager?.getPlugin("Water")).toBeInstanceOf(WaterPlugin);
      expect(m.receiveShadows).toBe(false);
    }
```

new:

```ts
    const water = createWater(scene, 0x5eed, 0);
    expect(water.meshes.length).toBe(WATER_RING_COUNT);
    expect(WATER_RING_COUNT).toBe(7);
    water.meshes.forEach((m) => {
      expect(m.getTotalVertices()).toBeGreaterThan(0);
      expect(m.isVerticesDataPresent("bedDepth")).toBe(true);
      expect(m.isVerticesDataPresent(VertexBuffer.ColorKind)).toBe(false);
      expect(m.useVertexColors).toBe(false);
      expect((m.metadata as { waterLevel: number }).waterLevel).toBe(0);
      // the stitch: a float and an (x, z) per vertex
      expect(m.getVertexBuffer("oceanMorph")!.getSize()).toBe(1);
      expect(m.getVertexBuffer("oceanCoarse")!.getSize()).toBe(2);
      expect(m.getVerticesData("oceanMorph")!.length).toBe(m.getTotalVertices());
      // one vertex buffer a kind: six, inside the eight the WebGPU device is made with
      expect(m.getVerticesDataKinds().sort()).toEqual(["bedDepth", "normal", "oceanCoarse", "oceanMorph", "position", "uv"]);
      expect(m.getVerticesDataKinds().length).toBeLessThanOrEqual(WEBGPU_REQUIRED_LIMITS.maxVertexBuffers as number);
      // the vertices are world positions: the vertex stage's position is the world's
      expect(m.computeWorldMatrix(true).isIdentity()).toBe(true);
      const mat = m.material as PBRMaterial;
      expect(mat.name).toBe("mat_water_sea");
      expect(mat.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_ALPHABLEND);
      expect(mat.pluginManager?.getPlugin("Water")).toBeInstanceOf(WaterPlugin);
      expect(m.receiveShadows).toBe(false);
    });
    expect(WEBGPU_REQUIRED_LIMITS.maxVertexBuffers).toBe(8);
```

Edit 3 — old:

```ts
    // 620 m inland. Ring 0 is 1,024 m across, so it holds no sea only with the
    // camera more than 512 m from the coast.
```

new:

```ts
    // 620 m inland. Ring 3 is 1,024 m across, so it and the three inside it
    // hold no sea only with the camera more than 512 m from the coast.
```

Edit 4 — old:

```ts
    it("inland: ring 0 is disabled, ring 1's box ends at the coast, the pond disc stays on", () => {
```

new:

```ts
    it("inland: rings 0 to 3 are disabled, ring 4's box ends at the coast, the pond disc stays on", () => {
```

Edit 5 — old:

```ts
        expect(water.meshes[0]!.isEnabled()).toBe(false);
        const ring1 = water.meshes[1]!;
        expect(ring1.isEnabled()).toBe(true);
        const box = ring1.getBoundingInfo().boundingBox;
        // the whole plane would reach 1,024 m east of the camera
        const planeMaxX = box.minimumWorld.x + WATER_RING_CELLS * waterRingSpacing(1);
        expect(planeMaxX).toBeGreaterThan(pondCam.x);
        // the ring's east-most wet vertex is on the coast, and the box ends one 16 m cell past it
        const pos = ring1.getVerticesData(VertexBuffer.PositionKind)!;
        const depth = ring1.getVerticesData("bedDepth")!;
        let wetMaxX = -Infinity;
        for (let i = 0; i < depth.length; i++) if ((depth[i] as number) > 0) wetMaxX = Math.max(wetMaxX, pos[i * 3] as number);
        expect(wetMaxX).toBeLessThan(-360);
        expect(box.maximumWorld.x).toBeGreaterThanOrEqual(wetMaxX);
        expect(box.maximumWorld.x).toBeLessThanOrEqual(wetMaxX + waterRingSpacing(1));
        expect(box.minimumWorld.y).toBe(level);
        expect(box.maximumWorld.y).toBe(level);
```

new:

```ts
        for (const ring of water.meshes.slice(0, 4)) expect(ring.isEnabled()).toBe(false);
        const ring4 = water.meshes[4]!;
        expect(ring4.isEnabled()).toBe(true);
        const box = ring4.getBoundingInfo().boundingBox;
        // the whole plane would reach 1,024 m east of the camera
        const planeMaxX = box.minimumWorld.x + OCEAN_BOUND + WATER_RING_CELLS * waterRingSpacing(4);
        expect(planeMaxX).toBeGreaterThan(pondCam.x);
        // the ring's east-most wet vertex is on the coast, and the box ends one
        // 16 m cell past it, and the waves' 12 m past that
        const pos = ring4.getVerticesData(VertexBuffer.PositionKind)!;
        const depth = ring4.getVerticesData("bedDepth")!;
        let wetMaxX = -Infinity;
        for (let i = 0; i < depth.length; i++) if ((depth[i] as number) > 0) wetMaxX = Math.max(wetMaxX, pos[i * 3] as number);
        expect(wetMaxX).toBeLessThan(-360);
        expect(box.maximumWorld.x).toBeGreaterThanOrEqual(wetMaxX + 12);
        expect(box.maximumWorld.x).toBeLessThanOrEqual(wetMaxX + waterRingSpacing(4) + 12);
        // the crest above the level and the trough below it
        expect(box.minimumWorld.y).toBe(level - 12);
        expect(box.maximumWorld.y).toBe(level + 12);
```

Edit 6 — old:

```ts
      // inland, east: the camera is inside ring 1's wet box's bounding sphere,
      // so only the box test can cull it
      camera.setTarget(new Vector3(1209.6, 87.5, 84));
      scene.render();
      expect(water.meshes[1]!.isEnabled()).toBe(true);
      const sphere = water.meshes[1]!.getBoundingInfo().boundingSphere;
```

new:

```ts
      // inland, east: the camera is inside ring 4's wet box's bounding sphere,
      // so only the box test can cull it
      camera.setTarget(new Vector3(1209.6, 87.5, 84));
      scene.render();
      expect(water.meshes[4]!.isEnabled()).toBe(true);
      const sphere = water.meshes[4]!.getBoundingInfo().boundingSphere;
```

Edit 7 — old:

```ts
      const box = water.meshes[0]!.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.x).toBeLessThan(-374);
      water.dispose();
```

new:

```ts
      const box = water.meshes[0]!.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.x).toBeLessThan(-374);
      // ring 0 is 128 m across: its box, grown by the waves' 12 m, starts at most 76 m west of the camera
      expect(box.minimumWorld.x).toBeGreaterThanOrEqual(-374 - 76);
      expect(box.minimumWorld.y).toBe(-12);
      expect(box.maximumWorld.y).toBe(12);
      water.dispose();
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/water.test.ts test/game/waterMesh.test.ts`
Expected: FAIL with "AssertionError: expected 4 to be 7 // Object.is equality" (in both files), and in `water.test.ts` "expected undefined to be 12" and "Cannot read properties of undefined (reading '0')" (no `oceanMorph`), in `waterMesh.test.ts` "Cannot read properties of undefined (reading 'isEnabled')" (no ring 4)

- [ ] **Step 3: Implement**

`client/src/game/water.ts`, seven edits, each old → new:

Edit 1 — old:

```ts
/**
 * Pure water-ring math: a clipmap of flat rings at the water level, mirroring
 * `clipmap.ts` but for the ocean surface. Each ring stores only the
 * TERRAIN height under each vertex — the water itself is flat — and write the
 * depth below the surface per vertex (`bedDepth`), the fragment stage's
 * fallback outside the bed height texture. Four rings at 8/16/32/64 m spacing cover 8,192 m in four
 * draw calls, within a budget of ≤ 4.
 *
 * Pure and Babylon-free; the water shell uploads the output.
 */
import { elevationAt } from "../sim/terrain.js";
import { HOLE_CELLS, snapOrigin } from "./clipmap.js";
```

new:

```ts
/**
 * Pure water-ring math: a clipmap of rings at the water level, mirroring
 * `clipmap.ts` but for the ocean surface. Each ring stores only the TERRAIN
 * height under each vertex and writes the depth below the surface per vertex
 * (`bedDepth`), the fragment stage's fallback outside the bed height texture.
 * Seven rings at 1, 2, 4, 8, 16, 32 and 64 m spacing cover 8,192 m in seven
 * draw calls. Their vertices stay at the level: the waves are the vertex
 * stage's, and each vertex carries what that stage needs to stitch a ring's
 * outer edge to the coarser ring around it (`oceanMorph`, `oceanCoarse`), as
 * the terrain's rings stitch their heights.
 *
 * Pure and Babylon-free; the water shell uploads the output.
 */
import { elevationAt } from "../sim/terrain.js";
import { HOLE_CELLS, blendWeight, snapOrigin } from "./clipmap.js";
```

Edit 2 — old:

```ts
export const WATER_RING_COUNT = 4;
export const WATER_BASE_SPACING = 8;
/** Metres per bump-texture tile. */
export const WATER_UV_SCALE = 24;
```

new:

```ts
export const WATER_RING_COUNT = 7;
export const WATER_BASE_SPACING = 1;
/** Metres per bump-texture tile. */
export const WATER_UV_SCALE = 24;
/**
 * How far the drawn sea may stand off its flat plane, in metres, on every
 * axis: the largest crest a wave reaches as it breaks, twice the largest
 * significant height the swell is given (8 m), taken whole on either side of
 * the level, plus the wind sea's in a storm (4 m). Up and down for the crest
 * and the trough; sideways too, since a trochoid carries its vertices along
 * the wave as well as up. Each ring's culling box is grown by it
 * (`wetBounds`).
 */
export const OCEAN_BOUND = 12;
```

Edit 3 — old:

```ts
  /** Water level minus the bed's height, clamped at 0 where the ground is above the surface. */
  bedDepth: Float32Array;
  uvs: Float32Array;
};
```

new:

```ts
  /** Water level minus the bed's height, clamped at 0 where the ground is above the surface. */
  bedDepth: Float32Array;
  uvs: Float32Array;
  /**
   * The terrain's border blend (`blendWeight`) per vertex: 0 where the ring
   * draws its own waves (the edge of its hole, or ring 0's centre), rising
   * linearly to 1 on its outer edge, where it draws the coarser ring's. 0
   * throughout the outermost ring, which has no coarser ring.
   */
  oceanMorph: Float32Array;
  /**
   * Per vertex, (x, z) in metres: the half-edge to the coarser ring's
   * lattice. The coarser ring's two vertices joined by the drawn edge this
   * vertex lies at the middle of are at its position minus and plus it, so
   * the coarser ring's surface here is the mean of what it draws at those
   * two. (0, 0) on a vertex of the coarser lattice, where both are the vertex
   * itself, and throughout the outermost ring.
   */
  oceanCoarse: Float32Array;
};
```

Edit 4 — old:

```ts
/**
 * Flat plane at `waterLevel` carrying the bed depth per vertex.
 * No border clamping (a flat plane cannot crack) and no gradient normals —
 * every normal is (0, 1, 0); the bump texture supplies the ripple.
 */
export function waterRingGeometry(
  ring: WaterRingSamples,
  hole: { x0: number; z0: number } | null,
  waterLevel: number,
): WaterGeometry {
  const positions = new Float32Array(SIDE * SIDE * 3);
  const normals = new Float32Array(SIDE * SIDE * 3);
  const bedDepth = new Float32Array(SIDE * SIDE);
  const uvs = new Float32Array(SIDE * SIDE * 2);

  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const at = iz * SIDE + ix;
      const x = ring.originX + ix * ring.spacing;
      const z = ring.originZ + iz * ring.spacing;
      const p = at * 3;
      positions[p] = x;
      positions[p + 1] = waterLevel;
      positions[p + 2] = z;
      normals[p] = 0;
      normals[p + 1] = 1;
      normals[p + 2] = 0;
      bedDepth[at] = Math.max(0, waterLevel - (ring.h[at] as number));
      uvs[at * 2] = x / WATER_UV_SCALE;
      uvs[at * 2 + 1] = z / WATER_UV_SCALE;
    }
  }
```

new:

```ts
/**
 * The plane at `waterLevel` carrying the bed depth per vertex, and what the
 * vertex stage needs to stitch the waves it adds: every normal is (0, 1, 0)
 * and every vertex at the level, the waves displacing them there. A ring
 * other than the outermost blends its waves toward the coarser ring's across
 * its band (`oceanMorph`), and draws the coarser ring's exactly on its outer
 * edge, where `oceanCoarse` names the two coarser vertices the edge's middle
 * vertices lie between. Which ring this is comes from `ring.level`.
 */
export function waterRingGeometry(
  ring: WaterRingSamples,
  hole: { x0: number; z0: number } | null,
  waterLevel: number,
): WaterGeometry {
  const positions = new Float32Array(SIDE * SIDE * 3);
  const normals = new Float32Array(SIDE * SIDE * 3);
  const bedDepth = new Float32Array(SIDE * SIDE);
  const uvs = new Float32Array(SIDE * SIDE * 2);
  const oceanMorph = new Float32Array(SIDE * SIDE);
  const oceanCoarse = new Float32Array(SIDE * SIDE * 2);
  const stitched = ring.level < WATER_RING_COUNT - 1;
  const s = ring.spacing;

  for (let iz = 0; iz < SIDE; iz++) {
    for (let ix = 0; ix < SIDE; ix++) {
      const at = iz * SIDE + ix;
      const x = ring.originX + ix * s;
      const z = ring.originZ + iz * s;
      const p = at * 3;
      positions[p] = x;
      positions[p + 1] = waterLevel;
      positions[p + 2] = z;
      normals[p] = 0;
      normals[p + 1] = 1;
      normals[p + 2] = 0;
      bedDepth[at] = Math.max(0, waterLevel - (ring.h[at] as number));
      uvs[at * 2] = x / WATER_UV_SCALE;
      uvs[at * 2 + 1] = z / WATER_UV_SCALE;
      if (stitched) {
        oceanMorph[at] = blendWeight(hole, ix, iz);
        // The origin is a multiple of 2·spacing (snapOrigin), so an even index
        // is on the coarser lattice. An odd one along one axis is the middle
        // of a coarser edge along it; odd along both is a coarser cell's
        // centre, on the diagonal the coarser ring draws from its cell's
        // (+x, 0) corner to its (0, +z) corner (`coarseHeight`).
        const oddX = (ix & 1) === 1;
        const oddZ = (iz & 1) === 1;
        oceanCoarse[at * 2] = oddX ? s : 0;
        oceanCoarse[at * 2 + 1] = oddZ ? (oddX ? -s : s) : 0;
      }
    }
  }
```

Edit 5 — old:

```ts
  return { positions, indices, normals, bedDepth, uvs };
}
```

new:

```ts
  return { positions, indices, normals, bedDepth, uvs, oceanMorph, oceanCoarse };
}
```

Edit 6 — old:

```ts
/**
 * The box a ring's water can be drawn in, or null when it has none. Its wet
 * cells are the triangles it draws with a wet vertex (`bedDepth > 0`); outside
 * the bed texture the fragment's depth is `bedDepth` interpolated, so such a
 * triangle draws water up to its dry corners, and the box holds all three of
 * its vertices. Triangles in the hole are not drawn, so they count for
 * nothing. y is the water level. Null makes the ring's mesh disabled: a flat
 * plane at the level is in view from almost anywhere, and a mesh in view is
 * what asks for the high tier's copy.
 */
```

new:

```ts
/**
 * The box a ring's water can be drawn in, or null when it has none. Its wet
 * cells are the triangles it draws with a wet vertex (`bedDepth > 0`); outside
 * the bed texture the fragment's depth is `bedDepth` interpolated, so such a
 * triangle draws water up to its dry corners, and the box holds all three of
 * its vertices. Triangles in the hole are not drawn, so they count for
 * nothing. The box is grown by `OCEAN_BOUND` on every side, since the waves
 * carry the surface off the plane: up and down from the water level, and
 * across. Null makes the ring's mesh disabled: a plane at the level is in
 * view from almost anywhere, and a mesh in view is what asks for the high
 * tier's copy.
 */
```

Edit 7 — old:

```ts
  if (minX === Infinity) return null;
  return { min: [minX, y, minZ], max: [maxX, y, maxZ] };
}
```

new:

```ts
  if (minX === Infinity) return null;
  return {
    min: [minX - OCEAN_BOUND, y - OCEAN_BOUND, minZ - OCEAN_BOUND],
    max: [maxX + OCEAN_BOUND, y + OCEAN_BOUND, maxZ + OCEAN_BOUND],
  };
}
```

`client/src/game/renderer.ts`, four edits, each old → new:

Edit 1 — old:

```ts
/**
 * Uploads a water ring's buffers. Mirrors `applyRingGeometry` — same typed
 * arrays straight through, same `updatable` reasoning — plus the UV set the
 * scrolling bump texture samples.
 */
function applyWaterGeometry(mesh: Mesh, geometry: WaterGeometry): void {
  const data = new VertexData();
  data.positions = geometry.positions;
  data.indices = geometry.indices;
  data.normals = geometry.normals;
  data.uvs = geometry.uvs;
  data.applyToMesh(mesh, true);
  mesh.setVerticesData("bedDepth", geometry.bedDepth, true, 1);
}
```

new:

```ts
/**
 * Uploads a water ring's buffers. Mirrors `applyRingGeometry` — same typed
 * arrays straight through, same `updatable` reasoning — plus the UV set the
 * scrolling bump texture samples, and what the vertex stage stitches the
 * ring's waves to the coarser ring's with (`oceanMorph`, `oceanCoarse`).
 */
function applyWaterGeometry(mesh: Mesh, geometry: WaterGeometry): void {
  const data = new VertexData();
  data.positions = geometry.positions;
  data.indices = geometry.indices;
  data.normals = geometry.normals;
  data.uvs = geometry.uvs;
  data.applyToMesh(mesh, true);
  mesh.setVerticesData("bedDepth", geometry.bedDepth, true, 1);
  mesh.setVerticesData("oceanMorph", geometry.oceanMorph, true, 1);
  mesh.setVerticesData("oceanCoarse", geometry.oceanCoarse, true, 2);
}
```

Edit 2 — old:

```ts
  /** One mesh per ring, coarsening outward — four draw calls, capped by design.
```

new:

```ts
  /** One mesh per ring, coarsening outward — seven draw calls, capped by design.
```

Edit 3 — old:

```ts
 * The four-ring camera-following ocean surface. Same shape as `createClipmap`
```

new:

```ts
 * The seven-ring camera-following ocean surface. Same shape as `createClipmap`
```

Edit 4 — old:

```ts
  // A ring with no wet cell is off, and a wet ring's bounds are its wet
  // cells, not the whole plane: a flat plane at the level is in view from
  // almost anywhere, which would ask for the high tier's copy inland too.
```

new:

```ts
  // A ring with no wet cell is off, and a wet ring's bounds are its wet
  // cells, not the whole plane: a plane at the level is in view from almost
  // anywhere, which would ask for the high tier's copy inland too. The
  // bounds hold the waves: `OCEAN_BOUND` past the wet cells every way.
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/water.test.ts test/game/waterMesh.test.ts test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/water.ts client/src/game/renderer.ts client/test/game/water.test.ts client/test/game/waterMesh.test.ts`
Expected: PASS (17 tests in `water.test.ts`, 22 in `waterMesh.test.ts`; `water.ts` still imports nothing from Babylon)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/water.ts client/src/game/renderer.ts client/test/game/water.test.ts client/test/game/waterMesh.test.ts
git commit -F - <<'EOF'
feat: seven water rings from 1 m, stitched for the waves

## What

The sea is drawn by seven rings a vertex every 1, 2, 4, 8, 16, 32 and 64 m,
so the waterline stands on 1 m cells and the outer ring still reaches 8 km.
The rings stay at the level. Each vertex now carries what the vertex stage
needs to join a ring's waves to the coarser ring's with no crack: the
terrain's border weight, and the half-edge to the coarser ring's lattice,
along which an outer-edge vertex folds onto a vertex the coarser ring draws.
Each ring's culling box is grown by the most the waves move the surface.

## How

- `client/src/game/water.ts` — `WATER_RING_COUNT` 7 and `WATER_BASE_SPACING` 1; `OCEAN_BOUND` (12 m); `oceanMorph` and `oceanCoarse` per vertex from `waterRingGeometry`; `wetBounds` grown by `OCEAN_BOUND` on every side
- `client/src/game/renderer.ts` — the two attributes uploaded with each ring; each ring's culling box grown by `OCEAN_BOUND`
- `client/test/game/water.test.ts` — the spacings, the nesting, the counts, the border weight, the coarser edge at every vertex, the outer edge folded onto the coarser ring's, the grown boxes
- `client/test/game/waterMesh.test.ts` — seven rings with six vertex buffers and no transform; the inland and coast cases on the rings that now hold them; the boxes at the level, give or take 12 m

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 5: The two unknowns, measured before the rest is built (the controller's)

**Files:**
- None committed. Two scratch worktrees beside this one, both detached and removed at the end: `.claude/worktrees/ocean-probe` (this branch's HEAD after Task 4, plus the uncommitted probe below) and `.claude/worktrees/ocean-control` (`origin/main`).

**Interfaces:**
- Consumes: Task 3's `createGpuWindSea(engine)` and its `GpuWindSea` (`setSpectrum`, `step`, `dispose`); Task 4's seven rings.
- Produces: two costs reported to the owner before the swell's shaders are built: the wind sea's FFT on the high tier, and the seven rings with a vertex stage as heavy as the swell's (spec §10). Recorded in the run's ledger; written into the spec in Task 15.

The spec sets no bar in advance. These two numbers decide whether the design's high tier and its mesh stand as written or start down the cut order (the third cascade, the swell's components 12 to 8, the inner ring, the foam pattern's detail) before more is built on them. They are measured with the same method as every cost since the water material: fresh pages, GPU-bound at 3840 × 2160 (a 1920 × 1080 viewport at hardware scaling 0.5), paired readings in the order off, on, on, off, alternated between rounds, a discarded warm-up page, a same-code pair for the noise floor, and a silent machine (nothing else running a suite, a build or a browser; the 1-minute load average under 2.5).

- [ ] **Step 1: Make the two worktrees**

```bash
git fetch origin
git worktree add --detach .claude/worktrees/ocean-probe HEAD
git worktree add --detach .claude/worktrees/ocean-control origin/main
```

Apply the gate rig's page hooks (`window.__scene`, `window.__fcSet`) to both, uncommitted, with each worktree's own dev and signaling ports. These edits are never staged.

- [ ] **Step 2: Add the vertex probe to the probe worktree only**

The swell's vertex stage reads the atlas about 54 times a vertex (the coastline row twice, the two profile rows twice each, and for each of the 12 components its row in the bay and in the cove twice each, plus the component row). The probe stands in for it with 54 reads of a texture the atlas's size and format, gated by `?oceanProbe=reads` so one build serves both sides of the mesh's pair. In `.claude/worktrees/ocean-probe/client/src/game/waterPlugin.ts` (uncommitted, never staged):

Add after the import of `Color3`:

```ts
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";

const PROBE_READS = typeof location !== "undefined" && new URLSearchParams(location.search).get("oceanProbe") === "reads";
const PROBE_DEFS = "\nuniform sampler2D oceanProbeAtlas;\n";
const PROBE_POSITION = [
  "vec4 probeSum = vec4(0.0);",
  "for (int i = 0; i < 54; i++) {",
  "  float probeU = (fract(positionUpdated.x * 0.0013 + float(i) * 0.0173) * 1039.0 + 0.5) / 1040.0;",
  "  float probeV = (mod(float(i), 28.0) + 0.5) / 28.0;",
  "  probeSum += texture2D(oceanProbeAtlas, vec2(probeU, probeV));",
  "}",
  "positionUpdated.y += probeSum.x * 1e-9;",
].join("\n");
const probeAtlases = new WeakMap<Scene, RawTexture>();
function probeAtlas(scene: Scene): RawTexture {
  let atlas = probeAtlases.get(scene);
  if (atlas === undefined) {
    const data = new Float32Array(1040 * 28 * 4);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 12.9898) * 0.5;
    atlas = new RawTexture(data, 1040, 28, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    probeAtlases.set(scene, atlas);
  }
  return atlas;
}
```

In `getSamplers`, replace `samplers.push("waterBedHeight", "waterScene", "waterDepth");` with:

```ts
    samplers.push("waterBedHeight", "waterScene", "waterDepth");
    if (PROBE_READS) samplers.push("oceanProbeAtlas");
```

At the end of `bindForSubMesh`, after `if (depth !== null) uniformBuffer.setTexture("waterDepth", depth);`, add:

```ts
    if (PROBE_READS) uniformBuffer.setTexture("oceanProbeAtlas", probeAtlas(this._material.getScene()));
```

In `getCustomCode`, replace `return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };` with:

```ts
      if (PROBE_READS) {
        return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs + PROBE_DEFS, CUSTOM_VERTEX_UPDATE_POSITION: PROBE_POSITION, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
      }
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
```

On WebGPU the probe's stages are not in the corpus, so its first frames translate them at run time; the readings start after the page has drawn the pose for 8 s, past that.

Check the probe works before measuring: open the probe build with `?oceanProbe=reads&tier=medium` at the open-sea pose, read the console (no shader error), and confirm the sea draws as before.

- [ ] **Step 3: Find the poses**

With a scratch script outside the repository (never committed), take the cove's pad of the gate world used by the water terrain's gates (`room-3`) and two poses on it: the cove from the pad with the break line's place in view (the pad's position, eye height, looking out to sea, pitch 0.12), and the open sea to the horizon from the berm's crest (looking west, pitch 0.02).

- [ ] **Step 4: Measure the dense mesh with its vertex reads**

Three builds a pose, on the medium tier (WebGL2) and the high tier (WebGPU): `origin/main` (control), the probe without `oceanProbe` (seven rings, today's vertex stage), and the probe with `?oceanProbe=reads`. Pairs: control against each probe build, off, on, on, off, three rounds a pair, alternating which goes first. Report, for each tier and pose, the frame time of each build and the two differences: the rings alone, and the rings with the reads.

- [ ] **Step 5: Measure the FFT on the high tier**

On the probe build at the open-sea pose on the high tier (`&tier=high&engine=webgpu`), pair fresh pages without and with the FFT running. On the "with" pages, after the pose is set, start it from the page (Vite serves the module by its path, sharing the page's own Babylon modules). The FFT is stepped at the start of each frame, before the scene's passes begin, as Task 3 requires (a dispatch inside the frame's passes would split them):

```js
async () => {
  const m = await import("/dayhike/src/game/oceanGpuFft.ts");
  const scene = window.__scene;
  const engine = scene.getEngine();
  const sea = m.createGpuWindSea(engine);
  if (sea === null) return "null";
  sea.setSpectrum({ u10: 10, dir: [1, 0] }, 1);
  engine.onBeginFrameObservable.add(() => sea.step(performance.now() / 1000));
  window.__oceanProbeSea = sea;
  for (let i = 0; i < 100 && sea.status() === "compiling"; i++) await new Promise((r) => setTimeout(r, 100));
  return sea.status();
}
```

Measure only on pages that return `"running"`. A result of `"null"` is itself the finding: the high tier would draw the loop instead, and the cost of the loop is Task 15's. Three rounds, off, on, on, off. Report the frame time without and with, the difference, and the difference scaled to the high tier's own pixels.

Before trusting either step's numbers, read the renderer string of each page (it must be the machine's GPU, not a software renderer) and the console of each page (no errors), and include a same-code pair (probe against probe, both without the probe's parameters) to show the noise floor.

- [ ] **Step 6: Report, and clean up**

Report to the owner: the two costs, per tier and pose, with the noise floor, and against the cut order. Tasks 6 to 9 do not depend on the answer and go ahead; the swell's shaders (Task 11) and the wind sea's wiring (Task 13) wait for the owner's word on these numbers.

Then remove the scratch worktrees (their only changes are the uncommitted hooks and the probe):

```bash
git worktree remove --force .claude/worktrees/ocean-probe
git worktree remove --force .claude/worktrees/ocean-control
```

---

### Task 6: The swell's sea state and components

**Files:**
- Create: `client/src/game/oceanSwell.ts`
- Modify: `client/test/architecture.test.ts:445` (`BABYLON_FREE_FILES`)
- Test: `client/test/game/oceanSwell.test.ts`

**Interfaces:**
- Consumes:
  - `hash3(x: number, z: number, i: number, seed: number): number` — `client/src/sim/field.ts`
  - `OCEAN_G` — Task 1, `client/src/game/oceanPhysics.ts`
  - `jonswap(f: number, fp: number, hs: number, gamma: number): number` and `spreading(theta: number, s: number): number` — Task 2, `client/src/game/oceanSpectrum.ts`. Only their shapes matter here: the amplitudes are rescaled to Hs, and the spreading's cumulative table is normalised by its own total.
  - `LOBBY_SEEDS: number[]` — `client/test/sim/trailGateSeeds.ts` (test only)
- Produces (`client/src/game/oceanSwell.ts`):
  - The shared definitions' `SWELL_*` constants and `SWELL_SALT`, with the shared definitions' values.
  - Added constants: `SWELL_DIR_MODE_DEG = 270` (the direction's triangular draw on [255°, 300°] peaks due west, median ≈ 274°); `SWELL_PEAK_INDEX = 2` (in frequency order, the component just below fp: two below it, nine above); `SWELL_TRAVEL_MAX_DEG = 60` (no component travels further than this from straight onshore); `SWELL_Q0 = 1` (every component's q0: a true trochoid, its orbit radius its amplitude; offshore Σ q0·|k0|·a0 stays under 0.16 over the 200 lobby worlds, and the shared definitions' Σ cap at evaluation bounds it near shore).
  - `type SwellState = { hs: number; tp: number; dirFromDeg: number; gamma: number; spread: number }`
  - `type SwellComponent = { k0x: number; k0z: number; omega: number; a0: number; phase0: number; q0: number }`
  - `swellStateFor(seed: number): SwellState`
  - `swellComponents(seed: number, state: SwellState): SwellComponent[]` — SWELL_COMPONENTS (12), sorted by a0 descending (the low tier takes the first 8); deep-water wavenumbers |k0| = ω²/g, k0x > 0; components 0 and 1 are neighbours in frequency, so the set period 1/|f0 − f1| lies in [100, 200] s.
  - `swellTravelDirection(components: readonly SwellComponent[]): [number, number]`

- [ ] **Step 1: Write the failing test**

`client/test/game/oceanSwell.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SWELL_COMPONENTS, SWELL_COMPONENTS_LOW, SWELL_DIR_MAX_DEG, SWELL_DIR_MIN_DEG, SWELL_GAMMA_MAX, SWELL_GAMMA_MIN,
  SWELL_HS_MAX, SWELL_HS_MEDIAN, SWELL_HS_MIN, SWELL_PAIR_DF_MAX, SWELL_PAIR_DF_MIN, SWELL_Q0, SWELL_Q_SUM_MAX,
  SWELL_SPREAD_MAX, SWELL_SPREAD_MIN, SWELL_TP_MAX, SWELL_TP_MIN, SWELL_TRAVEL_MAX_DEG,
  swellComponents, swellStateFor, swellTravelDirection, type SwellComponent,
} from "../../src/game/oceanSwell.js";
import { OCEAN_G } from "../../src/game/oceanPhysics.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";

// Every world's swell, drawn once. The swell reads only the seed's hashes
// (no terrain, no bowl), so the 200 lobby worlds take a fraction of a second.
const WORLDS = LOBBY_SEEDS.map((seed) => {
  const state = swellStateFor(seed);
  return { seed, state, components: swellComponents(seed, state) };
});

const frequency = (c: SwellComponent): number => c.omega / (2 * Math.PI);
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return ((sorted[(sorted.length - 1) >> 1] as number) + (sorted[sorted.length >> 1] as number)) / 2;
};

describe("swellStateFor", () => {
  it("keeps every quantity inside the real coast's range over the 200 lobby worlds", () => {
    for (const { state } of WORLDS) {
      expect(state.hs).toBeGreaterThanOrEqual(SWELL_HS_MIN);
      expect(state.hs).toBeLessThanOrEqual(SWELL_HS_MAX);
      expect(state.tp).toBeGreaterThanOrEqual(SWELL_TP_MIN);
      expect(state.tp).toBeLessThanOrEqual(SWELL_TP_MAX);
      expect(state.dirFromDeg).toBeGreaterThanOrEqual(SWELL_DIR_MIN_DEG);
      expect(state.dirFromDeg).toBeLessThanOrEqual(SWELL_DIR_MAX_DEG);
      expect(state.gamma).toBeGreaterThanOrEqual(SWELL_GAMMA_MIN);
      expect(state.gamma).toBeLessThanOrEqual(SWELL_GAMMA_MAX);
      expect(state.spread).toBeGreaterThanOrEqual(SWELL_SPREAD_MIN);
      expect(state.spread).toBeLessThanOrEqual(SWELL_SPREAD_MAX);
    }
    expect([SWELL_HS_MIN, SWELL_HS_MAX, SWELL_TP_MIN, SWELL_TP_MAX]).toEqual([0.8, 4, 8, 14]);
    expect([SWELL_DIR_MIN_DEG, SWELL_DIR_MAX_DEG, SWELL_GAMMA_MIN, SWELL_GAMMA_MAX]).toEqual([255, 300, 3.3, 7]);
    expect([SWELL_SPREAD_MIN, SWELL_SPREAD_MAX]).toEqual([25, 75]);
  });

  it("draws Hs log-normally about 1.9 m: the 200 worlds' median within 15 %", () => {
    expect(SWELL_HS_MEDIAN).toBe(1.9);
    const m = median(WORLDS.map((w) => w.state.hs));
    expect(m).toBeGreaterThan(1.615);
    expect(m).toBeLessThan(2.185);
    // Spread out, not a constant: both tails are reached.
    expect(WORLDS.some((w) => w.state.hs < 1.2)).toBe(true);
    expect(WORLDS.some((w) => w.state.hs > 3)).toBe(true);
  });

  it("raises the peak period with the height, 7.5 + 1.6 Hs within its 1 s jitter, clamped to 8–14 s", () => {
    for (const { state } of WORLDS) {
      const centre = 7.5 + 1.6 * state.hs;
      expect(state.tp).toBeGreaterThanOrEqual(Math.min(14, Math.max(8, centre - 1)) - 1e-12);
      expect(state.tp).toBeLessThanOrEqual(Math.max(8, Math.min(14, centre + 1)) + 1e-12);
    }
  });

  it("weights the direction toward due west: the median within 3° of the triangle's 274°", () => {
    const m = median(WORLDS.map((w) => w.state.dirFromDeg));
    expect(m).toBeGreaterThan(271);
    expect(m).toBeLessThan(277);
  });

  it("is a pure function of the seed", () => {
    for (const { seed, state, components } of WORLDS.slice(0, 20)) {
      expect(swellStateFor(seed)).toEqual(state);
      expect(swellComponents(seed, state)).toEqual(components);
    }
    expect(swellStateFor(1)).not.toEqual(swellStateFor(2));
  });
});

describe("swellComponents", () => {
  it("makes SWELL_COMPONENTS components, largest first, so the low tier's first eight are the biggest", () => {
    expect([SWELL_COMPONENTS, SWELL_COMPONENTS_LOW]).toEqual([12, 8]);
    for (const { components } of WORLDS) {
      expect(components).toHaveLength(12);
      for (let i = 1; i < components.length; i++) {
        expect((components[i] as SwellComponent).a0).toBeLessThanOrEqual((components[i - 1] as SwellComponent).a0);
      }
    }
  });

  it("scales the amplitudes so 4√(Σa²/2) = Hs exactly", () => {
    for (const { state, components } of WORLDS) {
      const energy = components.reduce((sum, c) => sum + (c.a0 * c.a0) / 2, 0);
      expect(4 * Math.sqrt(energy)).toBeCloseTo(state.hs, 12);
    }
  });

  it("spaces neighbouring frequencies 0.005 to 0.01 Hz apart, the peak between the third and fourth", () => {
    expect([SWELL_PAIR_DF_MIN, SWELL_PAIR_DF_MAX]).toEqual([0.005, 0.01]);
    for (const { state, components } of WORLDS) {
      const f = components.map(frequency).sort((a, b) => a - b);
      for (let i = 1; i < f.length; i++) {
        const gap = (f[i] as number) - (f[i - 1] as number);
        expect(gap).toBeGreaterThanOrEqual(0.005 - 1e-12);
        expect(gap).toBeLessThanOrEqual(0.01 + 1e-12);
      }
      expect(f[2] as number).toBeLessThan(1 / state.tp);
      expect(f[3] as number).toBeGreaterThan(1 / state.tp);
    }
  });

  it("makes the two largest neighbours, so the sets repeat every 100 to 200 s", () => {
    let shortest = Infinity;
    let longest = 0;
    for (const { components } of WORLDS) {
      const set = 1 / Math.abs(frequency(components[0] as SwellComponent) - frequency(components[1] as SwellComponent));
      shortest = Math.min(shortest, set);
      longest = Math.max(longest, set);
      // Neighbours on the ladder: no other component's frequency lies between them.
      const lo = Math.min(frequency(components[0] as SwellComponent), frequency(components[1] as SwellComponent));
      const hi = Math.max(frequency(components[0] as SwellComponent), frequency(components[1] as SwellComponent));
      expect(components.filter((c) => frequency(c) > lo && frequency(c) < hi)).toHaveLength(0);
    }
    expect(shortest).toBeGreaterThanOrEqual(100 - 1e-9);
    expect(longest).toBeLessThanOrEqual(200 + 1e-9);
  });

  it("travels onshore in deep water: k0x > 0, |k0| = ω²/g, within SWELL_TRAVEL_MAX_DEG of the shore's normal", () => {
    expect(SWELL_TRAVEL_MAX_DEG).toBe(60);
    for (const { components } of WORLDS) {
      for (const c of components) {
        expect(c.k0x).toBeGreaterThan(0);
        expect(Math.hypot(c.k0x, c.k0z)).toBeCloseTo((c.omega * c.omega) / OCEAN_G, 12);
        expect(Math.abs(Math.atan2(c.k0z, c.k0x))).toBeLessThanOrEqual((60 * Math.PI) / 180 + 1e-12);
        expect(c.phase0).toBeGreaterThanOrEqual(0);
        expect(c.phase0).toBeLessThan(2 * Math.PI);
        expect(c.q0).toBe(SWELL_Q0);
      }
    }
    expect(SWELL_Q0).toBe(1);
  });

  it("stays far under the Σ Q|K|A cap offshore, where the cap is applied only near shore", () => {
    expect(SWELL_Q_SUM_MAX).toBe(0.9);
    for (const { components } of WORLDS) {
      const sum = components.reduce((s, c) => s + c.q0 * Math.hypot(c.k0x, c.k0z) * c.a0, 0);
      expect(sum).toBeLessThan(0.2);
    }
  });
});

describe("swellTravelDirection", () => {
  it("is a unit vector within 20° of the sea state's mean direction", () => {
    for (const { state, components } of WORLDS) {
      const [x, z] = swellTravelDirection(components);
      expect(Math.hypot(x, z)).toBeCloseTo(1, 12);
      expect(x).toBeGreaterThan(0);
      const mean = ((state.dirFromDeg - 270) * Math.PI) / 180;
      expect(Math.abs(Math.atan2(z, x) - mean)).toBeLessThan((20 * Math.PI) / 180);
    }
  });

  it("weights each component's direction by its amplitude squared", () => {
    const along = { k0x: 0.04, k0z: 0, omega: 0.6, a0: 1, phase0: 0, q0: 1 };
    const across = { k0x: 0, k0z: 0.04, omega: 0.6, a0: Math.sqrt(3), phase0: 0, q0: 1 };
    const [x, z] = swellTravelDirection([along, across]);
    expect(x).toBeCloseTo(0.31622776601683794, 12);
    expect(z).toBeCloseTo(0.9486832980505138, 12);
  });
});
```

`client/test/architecture.test.ts` — in `BABYLON_FREE_FILES`, old:

```ts
      join(SRC, "game", "lensParams.ts"),
```

new:

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "oceanSwell.ts"),
```

(Anchored on the `lensParams.ts` line, which the other Babylon-free additions leave in place; the list's order does not matter.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanSwell.test.ts test/architecture.test.ts`
Expected: FAIL with "Cannot find module '../../src/game/oceanSwell.js'" (and the architecture test's `existsSync` on `oceanSwell.ts` fails)

- [ ] **Step 3: Implement**

`client/src/game/oceanSwell.ts`:

```ts
/**
 * The swell: the long waves that reach this coast from distant storms, drawn
 * once per world from its seed. Babylon-free (on BABYLON_FREE_FILES) and
 * render-side: nothing in `sim/` reads it, and nothing here enters the level id.
 *
 * The sea state (`swellStateFor`) is the real coast's range (buoy 46041): a
 * significant height log-normal about 1.9 m, a peak period rising with it,
 * a direction within 15° south and 30° north of the west-facing shore's
 * normal, a peaked spectrum and long crests. Its components
 * (`swellComponents`) are twelve trochoidal waves whose neighbouring
 * frequencies lie 0.005 to 0.01 Hz apart, so the two largest beat every 100 to
 * 200 s: the sets.
 *
 * Convention: the sea lies toward −x and the swell travels toward +x
 * (k0x > 0). A compass bearing θ the swell comes FROM travels at
 * α = θ − 270° measured from +x toward +z.
 */
import { hash3 } from "../sim/field.js";
import { OCEAN_G } from "./oceanPhysics.js";
import { jonswap, spreading } from "./oceanSpectrum.js";

export const SWELL_HS_MIN = 0.8;
export const SWELL_HS_MAX = 4.0;
export const SWELL_HS_MEDIAN = 1.9;
/** The log-normal σ of ln Hs. */
export const SWELL_HS_SIGMA = 0.45;
export const SWELL_TP_BASE = 7.5;
export const SWELL_TP_PER_HS = 1.6;
export const SWELL_TP_JITTER = 1;
export const SWELL_TP_MIN = 8;
export const SWELL_TP_MAX = 14;
/** Compass bearings the swell comes from (deg), and the most likely one: due west. */
export const SWELL_DIR_MIN_DEG = 255;
export const SWELL_DIR_MAX_DEG = 300;
export const SWELL_DIR_MODE_DEG = 270;
export const SWELL_GAMMA_MIN = 3.3;
export const SWELL_GAMMA_MAX = 7;
export const SWELL_SPREAD_MIN = 25;
export const SWELL_SPREAD_MAX = 75;
export const SWELL_COMPONENTS = 12;
export const SWELL_COMPONENTS_LOW = 8;
/** Neighbouring components' frequencies lie this far apart (Hz): sets every 100 to 200 s. */
export const SWELL_PAIR_DF_MIN = 0.005;
export const SWELL_PAIR_DF_MAX = 0.01;
/** The cap on Σ Q|K|A, applied where the swell is evaluated, so the surface never loops. */
export const SWELL_Q_SUM_MAX = 0.9;
export const SWELL_SALT = 0x5e11;
/** In frequency order, the component just below the peak: two below it, nine above. */
export const SWELL_PEAK_INDEX = 2;
/** No component travels more than this far (deg) from straight onshore. */
export const SWELL_TRAVEL_MAX_DEG = 60;
/** Each component's own steepness factor: a true trochoid, whose orbit radius is its amplitude. */
export const SWELL_Q0 = 1;

export type SwellState = { hs: number; tp: number; dirFromDeg: number; gamma: number; spread: number };
export type SwellComponent = { k0x: number; k0z: number; omega: number; a0: number; phase0: number; q0: number };

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
/** Steps of the spreading's cumulative table over (−π, π]. */
const SPREAD_STEPS = 1024;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A triangular draw on [lo, hi] peaking at `mode`, from one uniform. */
function triangular(u: number, lo: number, mode: number, hi: number): number {
  const split = (mode - lo) / (hi - lo);
  return u < split
    ? lo + Math.sqrt(u * (hi - lo) * (mode - lo))
    : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

/** The world's swell: height, period, direction, peakedness and crest length. */
export function swellStateFor(seed: number): SwellState {
  const salted = seed ^ SWELL_SALT;
  // A standard normal by Box–Muller; 1 − u keeps the logarithm finite.
  const normal =
    Math.sqrt(-2 * Math.log(1 - hash3(0, 0, 0, salted))) * Math.cos(TWO_PI * hash3(0, 1, 0, salted));
  const hs = clamp(SWELL_HS_MEDIAN * Math.exp(SWELL_HS_SIGMA * normal), SWELL_HS_MIN, SWELL_HS_MAX);
  const jitter = SWELL_TP_JITTER * (2 * hash3(1, 0, 0, salted) - 1);
  const tp = clamp(SWELL_TP_BASE + SWELL_TP_PER_HS * hs + jitter, SWELL_TP_MIN, SWELL_TP_MAX);
  const dirFromDeg = triangular(hash3(2, 0, 0, salted), SWELL_DIR_MIN_DEG, SWELL_DIR_MODE_DEG, SWELL_DIR_MAX_DEG);
  const gamma = SWELL_GAMMA_MIN + (SWELL_GAMMA_MAX - SWELL_GAMMA_MIN) * hash3(3, 0, 0, salted);
  const spread = SWELL_SPREAD_MIN + (SWELL_SPREAD_MAX - SWELL_SPREAD_MIN) * hash3(4, 0, 0, salted);
  return { hs, tp, dirFromDeg, gamma, spread };
}

/** The spreading's inverse: the angle (rad, about the mean) below which a fraction `u` of its energy lies. */
function spreadAngle(u: number, cumulative: Float64Array): number {
  const total = cumulative[SPREAD_STEPS] as number;
  const target = u * total;
  let lo = 0;
  let hi = SPREAD_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] as number) <= target) lo = mid;
    else hi = mid;
  }
  const a = cumulative[lo] as number;
  const b = cumulative[hi] as number;
  const f = b > a ? (target - a) / (b - a) : 0;
  return -Math.PI + ((lo + f) / SPREAD_STEPS) * TWO_PI;
}

/**
 * The swell's components, largest first (the low tier takes the first
 * SWELL_COMPONENTS_LOW). Frequencies: a ladder whose neighbouring gaps are
 * drawn in [SWELL_PAIR_DF_MIN, SWELL_PAIR_DF_MAX], placed so the peak falls
 * between components SWELL_PEAK_INDEX and SWELL_PEAK_INDEX + 1. Each component
 * stands for an equal share of the band, its amplitude ∝ √S(f) of the world's
 * JONSWAP spectrum; that spectrum has one peak, so the two largest components
 * are neighbours on the ladder and beat at their gap: the sets come every
 * 1/Δf, 100 to 200 s. Amplitudes are then scaled so 4√(Σa²/2) = Hs exactly.
 * Directions are drawn from the spreading about the mean, held within
 * SWELL_TRAVEL_MAX_DEG of onshore; wavenumbers are deep water's, k0 = ω²/g;
 * phases are seeded; every q0 is SWELL_Q0.
 */
export function swellComponents(seed: number, state: SwellState): SwellComponent[] {
  const salted = seed ^ SWELL_SALT;
  const n = SWELL_COMPONENTS;
  const fp = 1 / state.tp;
  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    gaps.push(SWELL_PAIR_DF_MIN + (SWELL_PAIR_DF_MAX - SWELL_PAIR_DF_MIN) * hash3(i, 0, 1, salted));
  }
  const m = SWELL_PEAK_INDEX;
  // The peak sits a seeded quarter to three quarters of the way across its gap.
  const straddle = 0.25 + 0.5 * hash3(0, 1, 1, salted);
  const freqs = new Array<number>(n).fill(0);
  freqs[m] = fp - straddle * (gaps[m] as number);
  for (let i = m + 1; i < n; i++) freqs[i] = (freqs[i - 1] as number) + (gaps[i - 1] as number);
  for (let i = m - 1; i >= 0; i--) freqs[i] = (freqs[i + 1] as number) - (gaps[i] as number);

  // The spreading's cumulative table, for this world's s.
  const cumulative = new Float64Array(SPREAD_STEPS + 1);
  const dTheta = TWO_PI / SPREAD_STEPS;
  let prev = spreading(-Math.PI, state.spread);
  for (let j = 1; j <= SPREAD_STEPS; j++) {
    const next = spreading(-Math.PI + j * dTheta, state.spread);
    cumulative[j] = (cumulative[j - 1] as number) + 0.5 * (prev + next) * dTheta;
    prev = next;
  }

  const mean = (state.dirFromDeg - 270) * DEG;
  const limit = SWELL_TRAVEL_MAX_DEG * DEG;
  const raw: number[] = freqs.map((f) => Math.sqrt(jonswap(f, fp, state.hs, state.gamma)));
  let energy = 0;
  for (const a of raw) energy += (a * a) / 2;
  const scale = state.hs / 4 / Math.sqrt(energy);

  const out: SwellComponent[] = [];
  for (let i = 0; i < n; i++) {
    const omega = TWO_PI * (freqs[i] as number);
    const k0 = (omega * omega) / OCEAN_G;
    const alpha = clamp(mean + spreadAngle(hash3(i, 2, 1, salted), cumulative), -limit, limit);
    out.push({
      k0x: k0 * Math.cos(alpha),
      k0z: k0 * Math.sin(alpha),
      omega,
      a0: (raw[i] as number) * scale,
      phase0: TWO_PI * hash3(i, 3, 1, salted),
      q0: SWELL_Q0,
    });
  }
  return out.sort((p, q) => q.a0 - p.a0);
}

/** The amplitude²-weighted unit vector the swell travels along, (x, z). */
export function swellTravelDirection(components: readonly SwellComponent[]): [number, number] {
  let x = 0;
  let z = 0;
  for (const c of components) {
    const k = Math.hypot(c.k0x, c.k0z);
    const w = c.a0 * c.a0;
    x += (w * c.k0x) / k;
    z += (w * c.k0z) / k;
  }
  const len = Math.hypot(x, z);
  return len > 0 ? [x / len, z / len] : [1, 0];
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanSwell.test.ts test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/oceanSwell.ts client/test/game/oceanSwell.test.ts`
Expected: PASS (13 tests in `oceanSwell.test.ts`, about 0.1 s: the swell reads only the seed's hashes, so the 200 lobby worlds build no terrain and no bowl and need no `timeLimit`). Measured with Task 1's and Task 2's functions: the 200 worlds' Hs median 1.95 m, direction median 274.3°, set periods 100.0 to 198.3 s, travel within 15.1° of the mean, offshore Σ q0·|k0|·a0 at most 0.153.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanSwell.ts client/test/game/oceanSwell.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the swell's sea state and its components from the seed

## What

Each world now draws its swell from its seed, inside the real coast's range: a significant height log-normal about 1.9 m, a peak period rising with it, a direction from 255° to 300° weighted to due west, a peaked spectrum and long crests. Twelve trochoidal components carry it, their neighbouring frequencies 0.005 to 0.01 Hz apart so the two largest beat into sets every 100 to 200 s, their amplitudes scaled so that 4√(Σa²/2) is exactly Hs. Render-side and Babylon-free: nothing in the simulation reads it.

## How

- `client/src/game/oceanSwell.ts` — `swellStateFor`; `swellComponents` (a frequency ladder straddling the peak, JONSWAP amplitudes, directions from the spreading's inverse, seeded phases, largest first); `swellTravelDirection`
- `client/test/game/oceanSwell.test.ts` — the ranges, the Hs median, the energy identity, the frequency gaps and the set period over the 200 lobby worlds; deep-water wavenumbers; determinism
- `client/test/architecture.test.ts` — the module joins the Babylon-free list

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 7: The coast's profiles and the phase tables

**Files:**
- Create: `client/src/game/oceanTables.ts`
- Modify: `client/src/sim/olympic.ts:230` (`export` on `shoreProfileD`; nothing else in `sim/` changes)
- Modify: `client/test/architecture.test.ts:445` (`BABYLON_FREE_FILES`)
- Test: `client/test/game/oceanTables.test.ts`

**Interfaces:**
- Consumes:
  - `client/src/sim/olympic.ts`: `shoreProfileD(d: number): { v: number; dd: number }` (exported here), `coveProfileD(d: number): { v: number; dd: number }`, `coveFor(seed: number): Cove` (`{ z0; halfWidth; heads: { z; height; reach }[]; stacks }`), `COVE_END_BLEND`, `SHELF_BREAK_DEPTH`, `SHELF_BREAK_WIDTH`
  - `activeTerrainVariant(): TerrainVariant` — `client/src/sim/terrain.ts`: its `coastDistance(seed, x, z)` (and `coveMask` in the test)
  - Task 1 (`client/src/game/oceanPhysics.ts`): `waveNumber(omega, depth)`, `shoalingFactor(omega, depth)`, `refraction(k0, k0z, k): { kn; kr }`, `weggelCoefficients(slope): { a; b }`, `OCEAN_G` (test)
  - Task 6 (`client/src/game/oceanSwell.ts`): `SWELL_COMPONENTS`, `type SwellComponent`; `swellStateFor`, `swellComponents` (test)
- Produces (`client/src/game/oceanTables.ts`):
  - The shared definitions' `OCEAN_*` constants with the shared definitions' values.
  - Added: `OCEAN_DRY_DEPTH = 0.05` (m: at or below it a sample is dry: the phase rows hold landward of the last wet sample, and the swell's break takes the depth as at least this, Task 8's dry rule; the shaders mirror it as `const float OCEAN_DRY_DEPTH = 0.05;`), `OCEAN_PHASE_SUBSTEPS = 4`.
  - `type CoastProfiles`, `type OceanTables` (Shared definitions §3).
  - `coastProfilesFor(seed: number): CoastProfiles` — throws on a variant with no `coastDistance`; `coastlineX(z) = −coastDistance(seed, 0, z)`; `coveWeight` is the sim's along-shore window exactly (equal to the variant's `coveMask` at sea); `shelfBreakD` = { bay: −532.583…, cove: −324 } for every seed (the profiles do not depend on it); `headlandTips[i] = [coastlineX(head.z) − head.reach, head.z]`.
  - `deepWeight(d: number, shelfBreakD: number): number`
  - `buildOceanTables(profiles: CoastProfiles, components: readonly SwellComponent[], tp: number, coastCentreZ: number): OceanTables` — the atlas exactly as Shared definitions §4 lays it out, each step of Ψ integrated by Simpson's rule on OCEAN_PHASE_SUBSTEPS sub-intervals, not the trapezoid (the trapezoid misses a fine integral by up to 0.045 rad within a metre of the waterline, where k grows as h^−½; the shaders only read the table, so nothing else changes). `tp` is accepted for the shared definitions' signature and not read: Weggel's a and b are tabulated, and γ_b combines them with the local height and tp where the swell is evaluated.
  - `writeCoastRow(tables: OceanTables, profiles: CoastProfiles, coastCentreZ: number): void`

- [ ] **Step 1: Write the failing test**

`client/test/game/oceanTables.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { COVE_END_BLEND, coveFor, coveProfileD, shoreProfileD } from "../../src/sim/olympic.js";
import { activeTerrainVariant } from "../../src/sim/terrain.js";
import {
  OCEAN_ATLAS_ROWS, OCEAN_COAST_SAMPLES, OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_DRY_DEPTH,
  OCEAN_ROW_BAY_FIRST, OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COAST, OCEAN_ROW_COMPONENTS, OCEAN_ROW_COVE_FIRST,
  OCEAN_ROW_COVE_PROFILE, OCEAN_TABLE_SAMPLES,
  buildOceanTables, coastProfilesFor, deepWeight, writeCoastRow, type CoastProfiles, type OceanTables,
} from "../../src/game/oceanTables.js";
import { refraction, shoalingFactor, waveNumber, weggelCoefficients, OCEAN_G } from "../../src/game/oceanPhysics.js";
import { swellComponents, swellStateFor, type SwellComponent } from "../../src/game/oceanSwell.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = LOBBY_SEEDS[0] as number;

/** Channel `ch` of texel `i` in `row`. */
function texel(t: OceanTables, row: number, i: number, ch: number): number {
  return t.data[(row * t.width + i) * 4 + ch] as number;
}

/** The world's own swell, its profiles and its tables about the cove. */
function world(seed: number): { profiles: CoastProfiles; components: SwellComponent[]; tables: OceanTables } {
  const state = swellStateFor(seed);
  const components = swellComponents(seed, state);
  const profiles = coastProfilesFor(seed);
  return { profiles, components, tables: buildOceanTables(profiles, components, state.tp, 0) };
}

/** A component's onshore wavenumber at d, straight from the physics: the integrand of Ψ. */
function knAt(c: SwellComponent, depth: (d: number) => { depth: number }, shelfBreakD: number, d: number): number {
  const w = deepWeight(d, shelfBreakD);
  if (w === 1) return c.k0x;
  const k0 = Math.hypot(c.k0x, c.k0z);
  const h = Math.max(depth(d).depth, OCEAN_DRY_DEPTH);
  return refraction(k0, c.k0z, (1 - w) * waveNumber(c.omega, h) + w * k0).kn;
}

describe("coastProfilesFor", () => {
  const p = coastProfilesFor(SEED);

  it("reads the bays' and the cove's bed from the terrain's own profiles, depth positive at sea", () => {
    for (const d of [-900, -400, -100, -24, -3, 0, 12]) {
      expect(p.bayDepth(d).depth).toBe(-shoreProfileD(d).v);
      expect(p.bayDepth(d).slope).toBe(Math.abs(shoreProfileD(d).dd));
      expect(p.coveDepth(d).depth).toBe(-coveProfileD(d).v);
      expect(p.coveDepth(d).slope).toBe(Math.abs(coveProfileD(d).dd));
    }
    // The waterline at d = 0; the cove's toe 2 m down at 24 m out, on the 1:50 bed beyond it.
    expect(p.bayDepth(0).depth).toBeCloseTo(0, 12);
    expect(p.coveDepth(0).depth).toBeCloseTo(0, 12);
    expect(p.coveDepth(-100).depth).toBeCloseTo(3.52, 12);
    expect(p.coveDepth(-100).slope).toBeCloseTo(0.02, 12);
    expect(p.bayDepth(-100).slope).toBeCloseTo(0.015, 12);
  });

  it("finds each profile's shelf break, where it reaches 8 m", () => {
    expect(p.shelfBreakD.bay).toBeCloseTo(-532.5833333, 6);
    expect(p.shelfBreakD.cove).toBeCloseTo(-324, 6);
  });

  it("takes the coastline from the variant's coastDistance, the same for any x", () => {
    const coastDistance = activeTerrainVariant().coastDistance!;
    for (const z of [-2000, -135, 0, 77, 1500]) {
      expect(p.coastlineX(z)).toBeCloseTo(0 - coastDistance(SEED, 0, z), 9);
      expect(p.coastlineX(z)).toBeCloseTo(123 - coastDistance(SEED, 123, z), 9);
    }
  });

  it("windows the cove along the shore exactly as the sim does: 1 at its centre, 0 past its ends' blend", () => {
    const cove = coveFor(SEED);
    expect(p.coveWeight(cove.z0)).toBe(1);
    expect(p.coveWeight(cove.z0 + cove.halfWidth)).toBeCloseTo(0.5, 12);
    expect(p.coveWeight(cove.z0 - cove.halfWidth - COVE_END_BLEND)).toBe(0);
    expect(p.coveWeight(cove.z0 + cove.halfWidth + COVE_END_BLEND)).toBe(0);
    expect(p.coveWeight(cove.z0 + 2000)).toBe(0);
    // At sea, past the road's corridor, the sim's cove mask is this window alone.
    const coveMask = activeTerrainVariant().coveMask!;
    for (let z = cove.z0 - cove.halfWidth - 40; z <= cove.z0 + cove.halfWidth + 40; z += 7.3) {
      expect(p.coveWeight(z)).toBeCloseTo(coveMask(SEED, p.coastlineX(z) - 50, z), 12);
    }
  });

  it("puts each headland's tip its reach out from the coastline at its z", () => {
    const cove = coveFor(SEED);
    expect(p.headlandTips).toHaveLength(2);
    cove.heads.forEach((head, i) => {
      expect(p.headlandTips[i]).toEqual([p.coastlineX(head.z) - head.reach, head.z]);
    });
  });
});

describe("deepWeight", () => {
  it("is 0 at the shelf break and shoreward, 1 a shelf width seaward of it, smootherstep between", () => {
    expect(deepWeight(-324, -324)).toBe(0);
    expect(deepWeight(-100, -324)).toBe(0);
    expect(deepWeight(-724, -324)).toBe(1);
    expect(deepWeight(-1000, -324)).toBe(1);
    expect(deepWeight(-524, -324)).toBeCloseTo(0.5, 12);
    expect(deepWeight(-424, -324)).toBeCloseTo(0.103515625, 12);
  });
});

describe("buildOceanTables", () => {
  it("is OCEAN_ATLAS_ROWS rows of at most OCEAN_TABLE_SAMPLES RGBA texels", () => {
    const { tables } = world(SEED);
    expect([OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_TABLE_SAMPLES, OCEAN_ATLAS_ROWS]).toEqual([-1000, 1, 1040, 28]);
    expect(tables.width).toBeLessThanOrEqual(OCEAN_TABLE_SAMPLES);
    expect(tables.rows).toBe(28);
    expect(tables.data.length).toBe(28 * tables.width * 4);
  });

  it("writes the profile rows: depth, Weggel's a and b for the local slope, the deep weight", () => {
    const { profiles, tables } = world(SEED);
    for (const i of [0, 300, 600, 900, 975, 1000, 1039]) {
      const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
      for (const [row, depth, sb] of [
        [OCEAN_ROW_BAY_PROFILE, profiles.bayDepth, profiles.shelfBreakD.bay],
        [OCEAN_ROW_COVE_PROFILE, profiles.coveDepth, profiles.shelfBreakD.cove],
      ] as const) {
        const wg = weggelCoefficients(depth(d).slope);
        expect(texel(tables, row, i, 0)).toBe(Math.fround(depth(d).depth));
        expect(texel(tables, row, i, 1)).toBe(Math.fround(wg.a));
        expect(texel(tables, row, i, 2)).toBe(Math.fround(wg.b));
        expect(texel(tables, row, i, 3)).toBe(Math.fround(deepWeight(d, sb)));
      }
    }
  });

  it("writes the components row: (k0x, k0z, ω, a0) then (q0, 0, 0, 0), zeros past the last", () => {
    const { components, tables } = world(SEED);
    components.forEach((c, i) => {
      expect([0, 1, 2, 3].map((ch) => texel(tables, OCEAN_ROW_COMPONENTS, 2 * i, ch))).toEqual(
        [c.k0x, c.k0z, c.omega, c.a0].map(Math.fround),
      );
      expect([0, 1, 2, 3].map((ch) => texel(tables, OCEAN_ROW_COMPONENTS, 2 * i + 1, ch))).toEqual([Math.fround(c.q0), 0, 0, 0]);
    });
    for (let i = 24; i < tables.width; i++) expect(texel(tables, OCEAN_ROW_COMPONENTS, i, 0)).toBe(0);
  });

  it("holds Ψ to a fine integral of kn (Simpson at 0.05 m) within 0.01 rad over the whole table", () => {
    const { profiles, components, tables } = world(SEED);
    let worst = 0;
    for (const [first, depth, sb] of [
      [OCEAN_ROW_BAY_FIRST, profiles.bayDepth, profiles.shelfBreakD.bay],
      [OCEAN_ROW_COVE_FIRST, profiles.coveDepth, profiles.shelfBreakD.cove],
    ] as const) {
      components.forEach((c, row) => {
        let psi = c.k0x * OCEAN_D_MIN;
        for (let i = 1; i < tables.width; i++) {
          const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
          if (depth(d).depth <= OCEAN_DRY_DEPTH) break;
          let sum = knAt(c, depth, sb, d - 1) + knAt(c, depth, sb, d);
          for (let j = 1; j < 20; j++) sum += (j % 2 === 1 ? 4 : 2) * knAt(c, depth, sb, d - 1 + j * 0.05);
          psi += (sum * 0.05) / 3;
          worst = Math.max(worst, Math.abs(texel(tables, first + row, i, 0) - psi));
        }
      });
    }
    expect(worst).toBeLessThan(0.01);
  }, timeLimit(60_000));

  it("is the plane wave far out: Ψ = k0x·d exactly and kn = k0x, K = 1 wherever the deep weight is 1", () => {
    const { profiles, components, tables } = world(SEED);
    for (const [first, sb] of [
      [OCEAN_ROW_BAY_FIRST, profiles.shelfBreakD.bay],
      [OCEAN_ROW_COVE_FIRST, profiles.shelfBreakD.cove],
    ] as const) {
      components.forEach((c, row) => {
        let checked = 0;
        for (let i = 0; i < tables.width; i++) {
          const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
          if (deepWeight(d, sb) !== 1) break;
          expect(texel(tables, first + row, i, 0)).toBe(Math.fround(c.k0x * d));
          expect(texel(tables, first + row, i, 1)).toBe(Math.fround(c.k0x));
          expect(texel(tables, first + row, i, 2)).toBe(1);
          checked++;
        }
        expect(checked).toBeGreaterThan(60);
      });
    }
  });

  it("steps Ψ by no more than the row's largest kn a sample: no seam at the shelf blend, the waterline or d = OCEAN_D_MIN", () => {
    const { tables } = world(SEED);
    let worst = 0;
    for (let row = OCEAN_ROW_BAY_FIRST; row < OCEAN_ROW_COVE_FIRST + 12; row++) {
      let knMax = 0;
      for (let i = 0; i < tables.width; i++) knMax = Math.max(knMax, texel(tables, row, i, 1));
      for (let i = 1; i < tables.width; i++) {
        worst = Math.max(worst, Math.abs(texel(tables, row, i, 0) - texel(tables, row, i - 1, 0)) / (knMax * OCEAN_D_STEP));
      }
    }
    expect(worst).toBeLessThan(1.01);
  });

  it("grows an 11 s swell 30° off the shore's normal by K_s·K_r at the cove's 8, 5 and 2 m depths, within 0.03", () => {
    const profiles = coastProfilesFor(SEED);
    const omega = (2 * Math.PI) / 11;
    const k0 = (omega * omega) / OCEAN_G;
    const c: SwellComponent = {
      k0x: k0 * Math.cos(Math.PI / 6), k0z: k0 * Math.sin(Math.PI / 6), omega, a0: 1, phase0: 0, q0: 1,
    };
    const tables = buildOceanTables(profiles, [c], 11, 0);
    const factors: number[] = [];
    for (const h of [8, 5, 2]) {
      // Where the cove's bed is h deep, and the table read there by hand.
      let lo = OCEAN_D_MIN;
      let hi = 0;
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2;
        if (profiles.coveDepth(mid).depth > h) lo = mid;
        else hi = mid;
      }
      const column = (lo - OCEAN_D_MIN) / OCEAN_D_STEP;
      const i = Math.floor(column);
      const f = column - i;
      const read = texel(tables, OCEAN_ROW_COVE_FIRST, i, 2) * (1 - f) + texel(tables, OCEAN_ROW_COVE_FIRST, i + 1, 2) * f;
      const direct = shoalingFactor(omega, h) * refraction(k0, c.k0z, waveNumber(omega, h)).kr;
      expect(Math.abs(read - direct)).toBeLessThan(0.03);
      factors.push(read);
    }
    // Shoaling, less the turn's spreading: about 1.05, 1.15 and 1.42 square on, a few percent less at 30°.
    expect(factors[0]).toBeGreaterThan(0.95);
    expect(factors[0]).toBeLessThan(1.1);
    expect(factors[2]).toBeGreaterThan(1.3);
    expect(factors[2]).toBeLessThan(1.45);
  });

  it("holds every value finite over 50 worlds, land included", () => {
    // About 40 ms a world: the coast's hooks read the coastline's warp and the
    // cove's hashes, and build no bowl.
    for (const seed of LOBBY_SEEDS.slice(0, 50)) {
      const { tables } = world(seed);
      let bad = 0;
      for (const v of tables.data) if (!Number.isFinite(v)) bad++;
      expect(bad).toBe(0);
    }
  }, timeLimit(120_000));
});

describe("the coastline row", () => {
  it("starts half a row behind the centre snapped to its step", () => {
    const { profiles, tables } = world(SEED);
    expect([OCEAN_COAST_STEP, OCEAN_COAST_SAMPLES]).toEqual([4, 1040]);
    expect(tables.coastOriginZ).toBe(-2080);
    writeCoastRow(tables, profiles, 1001);
    expect(tables.coastOriginZ).toBe(-1080);
    writeCoastRow(tables, profiles, -3);
    expect(tables.coastOriginZ).toBe(-2084);
    writeCoastRow(tables, profiles, 5123);
    expect(tables.coastOriginZ).toBe(3044);
  });

  it("holds the coastline, its slope by central difference and the cove's weight at each z", () => {
    const { profiles, tables } = world(SEED);
    for (const j of [0, 1, 400, 520, 521, 1039]) {
      const z = tables.coastOriginZ + j * OCEAN_COAST_STEP;
      expect(texel(tables, OCEAN_ROW_COAST, j, 0)).toBe(Math.fround(profiles.coastlineX(z)));
      expect(texel(tables, OCEAN_ROW_COAST, j, 1)).toBeCloseTo(
        (profiles.coastlineX(z + 4) - profiles.coastlineX(z - 4)) / 8, 6,
      );
      expect(texel(tables, OCEAN_ROW_COAST, j, 2)).toBe(Math.fround(profiles.coveWeight(z)));
      expect(texel(tables, OCEAN_ROW_COAST, j, 3)).toBe(0);
    }
    expect(texel(tables, OCEAN_ROW_COAST, 520, 2)).toBe(1);
  });

  it("refills that row alone on a recentre", () => {
    const { profiles, tables } = world(SEED);
    const before = tables.data.slice();
    writeCoastRow(tables, profiles, 2500);
    const rowStart = OCEAN_ROW_COAST * tables.width * 4;
    expect(tables.data.subarray(0, rowStart)).toEqual(before.subarray(0, rowStart));
    expect(tables.data.subarray(rowStart)).not.toEqual(before.subarray(rowStart));
  });
});
```

`client/test/architecture.test.ts` — in `BABYLON_FREE_FILES`, old:

```ts
      join(SRC, "game", "lensParams.ts"),
```

new:

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "oceanTables.ts"),
```

(Anchored on the `lensParams.ts` line, which the other Babylon-free additions leave in place; the list's order does not matter.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanTables.test.ts test/architecture.test.ts`
Expected: FAIL with "Cannot find module '../../src/game/oceanTables.js'" (and the architecture test's `existsSync` on `oceanTables.ts` fails)

- [ ] **Step 3: Implement**

`client/src/sim/olympic.ts` — old:

```ts
function shoreProfileD(d: number): { v: number; dd: number } {
```

new:

```ts
export function shoreProfileD(d: number): { v: number; dd: number } {
```

(A function, not a tunable: the level id does not move, and no other line in `sim/` changes.)

`client/src/game/oceanTables.ts`:

```ts
/**
 * The coast the swell meets, and the tables it is evaluated from. Babylon-free
 * (on BABYLON_FREE_FILES); the atlas texture is made from `OceanTables.data`
 * elsewhere, and the shaders read it exactly as `oceanWaves.ts` does.
 *
 * Across each bay and across the cove's middle the bed is a function of the
 * signed coast distance d = x − coastlineX(z) alone (negative at sea): the
 * terrain's `shoreProfileD` and `coveProfileD`, blended across the cove's ends
 * by its along-shore window. So a component's phase is integrated once along d
 * for each profile, Ψ(d) = ∫ kn, with kn the onshore wavenumber Snell's law
 * leaves it at each depth; far out Ψ is the plane wave's k0x·d. Past the shelf
 * break the tables take deep water (`deepWeight`), so the open swell is as long
 * as the real coast's rather than the 25 m floor's.
 *
 * The atlas (RGBA32F, OCEAN_TABLE_SAMPLES wide, OCEAN_ATLAS_ROWS tall), column
 * i at d_i = OCEAN_D_MIN + i·OCEAN_D_STEP:
 * - rows 0 and 1, the bay's and the cove's profile: depth (positive at sea,
 *   negative on land), Weggel's a and b for the local slope, deepWeight;
 * - rows 2..13 (bay) and 14..25 (cove), one a component: Ψ, kn, the amplitude
 *   factor K_s·K_r (blended to 1 in deep water), 0; landward of the last wet
 *   sample each holds that sample's values;
 * - row 26, the components: texel 2c (k0x, k0z, ω, a0), texel 2c + 1 (q0, 0, 0, 0);
 * - row 27, the coastline along z from coastOriginZ every OCEAN_COAST_STEP:
 *   coastlineX, its slope dx/dz, the cove's weight, 0.
 */
import {
  COVE_END_BLEND, SHELF_BREAK_DEPTH, SHELF_BREAK_WIDTH, coveFor, coveProfileD, shoreProfileD,
} from "../sim/olympic.js";
import { activeTerrainVariant } from "../sim/terrain.js";
import { refraction, shoalingFactor, waveNumber, weggelCoefficients } from "./oceanPhysics.js";
import { SWELL_COMPONENTS, type SwellComponent } from "./oceanSwell.js";

export const OCEAN_D_MIN = -1000;
export const OCEAN_D_STEP = 1;
export const OCEAN_TABLE_SAMPLES = 1040;
/** The coastline row: OCEAN_COAST_SAMPLES texels, OCEAN_COAST_STEP m apart along z (4,160 m). */
export const OCEAN_COAST_STEP = 4;
export const OCEAN_COAST_SAMPLES = 1040;
/** The coastline row is recentred when the camera is this far (m) from its centre. */
export const OCEAN_COAST_RECENTRE = 1000;
export const OCEAN_ATLAS_ROWS = 28;
export const OCEAN_ROW_BAY_PROFILE = 0;
export const OCEAN_ROW_COVE_PROFILE = 1;
export const OCEAN_ROW_BAY_FIRST = 2;
export const OCEAN_ROW_COVE_FIRST = 14;
export const OCEAN_ROW_COMPONENTS = 26;
export const OCEAN_ROW_COAST = 27;
/** At or below this depth (m) a sample is dry: the phase rows hold, the break is off. */
export const OCEAN_DRY_DEPTH = 0.05;
/** Sub-intervals of Simpson's rule in each table step of the phase integral. */
export const OCEAN_PHASE_SUBSTEPS = 4;

export type CoastProfiles = {
  /** From `shoreProfileD`: depth = −v (positive at sea), slope = |dv/dd|. */
  bayDepth(d: number): { depth: number; slope: number };
  /** From `coveProfileD`, likewise. */
  coveDepth(d: number): { depth: number; slope: number };
  /** 1 − smootherstep(halfWidth − COVE_END_BLEND, halfWidth + COVE_END_BLEND, |z − z0|): the sim's along-shore window. */
  coveWeight(z: number): number;
  /** x − coastDistance(seed, x, z), the same for any x. */
  coastlineX(z: number): number;
  /** Where each profile reaches SHELF_BREAK_DEPTH. */
  shelfBreakD: { bay: number; cove: number };
  /** (x, z) of each headland's seaward tip. */
  headlandTips: [number, number][];
};

export type OceanTables = { data: Float32Array; width: number; rows: number; coastOriginZ: number };

/** Quintic smootherstep, the sim's `smootherstepD` value. */
function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The d (m) at which a monotone profile reaches `depth`, by bisection over [OCEAN_D_MIN, 0]. */
function depthCrossing(profile: (d: number) => { depth: number }, depth: number): number {
  let lo = OCEAN_D_MIN;
  let hi = 0;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (profile(mid).depth > depth) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** The world's coast as the swell sees it: the two profiles, the cove's window, the coastline and the headlands' tips. */
export function coastProfilesFor(seed: number): CoastProfiles {
  const variant = activeTerrainVariant();
  const coastDistance = variant.coastDistance;
  if (coastDistance === undefined) throw new Error(`terrain variant "${variant.name}" has no coast`);
  const cove = coveFor(seed);
  const bayDepth = (d: number): { depth: number; slope: number } => {
    const p = shoreProfileD(d);
    return { depth: -p.v, slope: Math.abs(p.dd) };
  };
  const coveDepth = (d: number): { depth: number; slope: number } => {
    const p = coveProfileD(d);
    return { depth: -p.v, slope: Math.abs(p.dd) };
  };
  const coastlineX = (z: number): number => -coastDistance(seed, 0, z);
  return {
    bayDepth,
    coveDepth,
    coveWeight: (z) =>
      1 - smootherstep(cove.halfWidth - COVE_END_BLEND, cove.halfWidth + COVE_END_BLEND, Math.abs(z - cove.z0)),
    coastlineX,
    shelfBreakD: { bay: depthCrossing(bayDepth, SHELF_BREAK_DEPTH), cove: depthCrossing(coveDepth, SHELF_BREAK_DEPTH) },
    headlandTips: cove.heads.map((h): [number, number] => [coastlineX(h.z) - h.reach, h.z]),
  };
}

/** 0 at the shelf break and shoreward, 1 at shelfBreakD − SHELF_BREAK_WIDTH and seaward, smootherstep between. */
export function deepWeight(d: number, shelfBreakD: number): number {
  return smootherstep(shelfBreakD, shelfBreakD - SHELF_BREAK_WIDTH, d);
}

/** One component's onshore wavenumber and amplitude factor at d over one profile. */
function waveAt(
  c: SwellComponent, k0: number, depth: (d: number) => { depth: number }, shelfBreakD: number, d: number,
): { kn: number; amp: number } {
  const w = deepWeight(d, shelfBreakD);
  if (w === 1) return { kn: c.k0x, amp: 1 };
  const h = Math.max(depth(d).depth, OCEAN_DRY_DEPTH);
  const r = refraction(k0, c.k0z, (1 - w) * waveNumber(c.omega, h) + w * k0);
  return { kn: r.kn, amp: ((1 - w) * shoalingFactor(c.omega, h) + w) * r.kr };
}

function writeProfileRow(
  data: Float32Array, width: number, row: number, depth: (d: number) => { depth: number; slope: number }, shelfBreakD: number,
): void {
  for (let i = 0; i < width; i++) {
    const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
    const p = depth(d);
    const wg = weggelCoefficients(p.slope);
    const o = (row * width + i) * 4;
    data[o] = p.depth;
    data[o + 1] = wg.a;
    data[o + 2] = wg.b;
    data[o + 3] = deepWeight(d, shelfBreakD);
  }
}

/** Ψ, kn and K for one component over one profile. Ψ is the plane wave's k0x·d
 * while the sample is in deep water, then integrated step by step by Simpson's
 * rule; landward of the last wet sample all three hold. */
function writePhaseRow(
  data: Float32Array, width: number, row: number, c: SwellComponent,
  depth: (d: number) => { depth: number }, shelfBreakD: number,
): void {
  const k0 = Math.hypot(c.k0x, c.k0z);
  const sub = OCEAN_D_STEP / OCEAN_PHASE_SUBSTEPS;
  let psi = 0;
  let kn = c.k0x;
  let amp = 1;
  let wet = true;
  for (let i = 0; i < width; i++) {
    const d = OCEAN_D_MIN + i * OCEAN_D_STEP;
    if (wet && depth(d).depth <= OCEAN_DRY_DEPTH) wet = false;
    if (wet) {
      const here = waveAt(c, k0, depth, shelfBreakD, d);
      if (deepWeight(d, shelfBreakD) === 1) {
        psi = c.k0x * d;
      } else {
        let sum = kn + here.kn;
        for (let j = 1; j < OCEAN_PHASE_SUBSTEPS; j++) {
          sum += (j % 2 === 1 ? 4 : 2) * waveAt(c, k0, depth, shelfBreakD, d - OCEAN_D_STEP + j * sub).kn;
        }
        psi += (sum * sub) / 3;
      }
      kn = here.kn;
      amp = here.amp;
    }
    const o = (row * width + i) * 4;
    data[o] = psi;
    data[o + 1] = kn;
    data[o + 2] = amp;
    data[o + 3] = 0;
  }
}

/** The atlas's data: the profiles, each component's phase rows, the components and the coastline row about coastCentreZ.
 * `tp` is the swell's peak period: the breaker index combines Weggel's a and b with it and the local height where the
 * swell is evaluated, so the tables carry a and b and do not read it. */
export function buildOceanTables(
  profiles: CoastProfiles, components: readonly SwellComponent[], tp: number, coastCentreZ: number,
): OceanTables {
  const width = OCEAN_TABLE_SAMPLES;
  const data = new Float32Array(width * OCEAN_ATLAS_ROWS * 4);
  const tables: OceanTables = { data, width, rows: OCEAN_ATLAS_ROWS, coastOriginZ: 0 };
  writeProfileRow(data, width, OCEAN_ROW_BAY_PROFILE, profiles.bayDepth, profiles.shelfBreakD.bay);
  writeProfileRow(data, width, OCEAN_ROW_COVE_PROFILE, profiles.coveDepth, profiles.shelfBreakD.cove);
  const count = Math.min(components.length, SWELL_COMPONENTS);
  for (let c = 0; c < count; c++) {
    const comp = components[c] as SwellComponent;
    writePhaseRow(data, width, OCEAN_ROW_BAY_FIRST + c, comp, profiles.bayDepth, profiles.shelfBreakD.bay);
    writePhaseRow(data, width, OCEAN_ROW_COVE_FIRST + c, comp, profiles.coveDepth, profiles.shelfBreakD.cove);
    const o = (OCEAN_ROW_COMPONENTS * width + 2 * c) * 4;
    data[o] = comp.k0x;
    data[o + 1] = comp.k0z;
    data[o + 2] = comp.omega;
    data[o + 3] = comp.a0;
    data[o + 4] = comp.q0;
  }
  writeCoastRow(tables, profiles, coastCentreZ);
  return tables;
}

/** Refills the coastline row (only) about coastCentreZ, and its origin: a recentre. */
export function writeCoastRow(tables: OceanTables, profiles: CoastProfiles, coastCentreZ: number): void {
  const origin =
    Math.round(coastCentreZ / OCEAN_COAST_STEP) * OCEAN_COAST_STEP - (OCEAN_COAST_SAMPLES / 2) * OCEAN_COAST_STEP;
  tables.coastOriginZ = origin;
  let before = profiles.coastlineX(origin - OCEAN_COAST_STEP);
  let here = profiles.coastlineX(origin);
  for (let j = 0; j < OCEAN_COAST_SAMPLES; j++) {
    const z = origin + j * OCEAN_COAST_STEP;
    const after = profiles.coastlineX(z + OCEAN_COAST_STEP);
    const o = (OCEAN_ROW_COAST * tables.width + j) * 4;
    tables.data[o] = here;
    tables.data[o + 1] = (after - before) / (2 * OCEAN_COAST_STEP);
    tables.data[o + 2] = profiles.coveWeight(z);
    tables.data[o + 3] = 0;
    before = here;
    here = after;
  }
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanTables.test.ts test/sim/olympic.test.ts test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/oceanTables.ts client/src/sim/olympic.ts client/test/game/oceanTables.test.ts`
Expected: PASS (17 tests in `oceanTables.test.ts`, about 6 s; one world's tables take about 40 ms and the coast's hooks build no bowl, so the 50-world test takes about 4 s under its `timeLimit(120_000)`). Measured with Task 1's functions: Ψ within 4.2e-5 rad of the 0.05 m Simpson integral; the 11 s, 30° component's factor 0.996, 1.085 and 1.323 at the cove's 8, 5 and 2 m (K_s alone 1.053, 1.155, 1.416).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanTables.ts client/src/sim/olympic.ts client/test/game/oceanTables.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the coast's profiles and the swell's phase tables

## What

The swell can now be evaluated against the coast it meets. The bays' and the cove's bed are read as functions of the coast distance, with the cove's along-shore window, the coastline and the headlands' tips; one atlas of tables holds, for each component over each profile, its onshore phase, its onshore wavenumber and its shoaling-and-refraction factor, blended to deep water past the shelf break, beside the components themselves and the coastline along z. The terrain's bay profile is exported for it; nothing else in the simulation changes and the level id does not move.

## How

- `client/src/sim/olympic.ts` — `shoreProfileD` exported
- `client/src/game/oceanTables.ts` — `coastProfilesFor`, `deepWeight`, `buildOceanTables`, `writeCoastRow`; the phase integrated by Simpson's rule a quarter metre at a time, the plane wave's k0x·d wherever the water is deep
- `client/test/game/oceanTables.test.ts` — the profiles against the terrain's, the cove's window against the sim's mask, Ψ against a fine integral, the far-out plane wave, continuity, K_s·K_r at 8, 5 and 2 m, finite values over 50 worlds, the coastline row and its recentre
- `client/test/architecture.test.ts` — the module joins the Babylon-free list

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 8: The swell's evaluation

**Files:**
- Create: `client/src/game/oceanWaves.ts`
- Modify: `client/test/architecture.test.ts:445` (`BABYLON_FREE_FILES`)
- Test: `client/test/game/oceanWaves.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `OCEAN_G`, `WEGGEL_GAMMA_MIN`, `WEGGEL_GAMMA_MAX`; `breakerIndex(slope, height, period)` (test)
  - Task 6: `SWELL_COMPONENTS`, `SWELL_Q_SUM_MAX`, `swellStateFor`, `swellComponents`, `swellTravelDirection`, `type SwellComponent`, `type SwellState`
  - Task 7: `OCEAN_COAST_STEP`, `OCEAN_D_MIN`, `OCEAN_D_STEP`, `OCEAN_DRY_DEPTH`, `OCEAN_ROW_BAY_FIRST`, `OCEAN_ROW_BAY_PROFILE`, `OCEAN_ROW_COAST`, `OCEAN_ROW_COMPONENTS`, `OCEAN_ROW_COVE_FIRST`, `OCEAN_ROW_COVE_PROFILE`, `buildOceanTables`, `coastProfilesFor`, `type OceanTables`
  - `coveFor(seed)` — `client/src/sim/olympic.ts` (the tables are built about the cove's z0)
- Produces (`client/src/game/oceanWaves.ts`):
  - The shared definitions' `OCEAN_BORE_RATIO`, `OCEAN_BREAK_FULL`, `OCEAN_BREAK_FOAM_LO/HI`, `OCEAN_FOAM_LIFE`, `OCEAN_ROLL_WIDTH`, `OCEAN_INNER_FOAM`, `SHELTER_SWELL`, `SHELTER_CHOP`, `SHELTER_WIDTH`.
  - `type OceanField`, `type Crest` (Shared definitions §3); `type SwellSample` = the shared definitions' fields plus `reach: number` (Σ Q·A, the most the surface moves across at this point) and `steepness: number` (Σ Q·|K|·A after the cap, ≤ SWELL_Q_SUM_MAX). `depth` is the true h (negative on land).
  - `oceanFieldFor(seed: number, count?: number): OceanField` and, new, `oceanFieldFromState(seed: number, state: SwellState, count?: number): OceanField` (the world's coast under a given sea state; tables about `coveFor(seed).z0`; `travel` from the first `count` components).
  - `swellPhases(field: OceanField, seconds: number): Float32Array` (length 12).
  - `atlasRead(tables: OceanTables, row: number, column: number): [number, number, number, number]`, `coastRead(tables: OceanTables, z: number): [number, number, number]`.
  - `shelterAt(field: OceanField, x: number, z: number, keep: number): number`.
  - `swellAt(field, phases, x, z): SwellSample` (Shared definitions §5 with the dry rule below), `swellNormal(sample: SwellSample): [number, number, number]` (new: the unit Gerstner normal), `crestAt(field, phases, x, z): Crest`, `boreArrivals(field, x, z, from, to, step): { t: number; height: number }[]`; the last two share `swellAt`'s evaluation, dry rule included.
  - **The rules the shaders mirror** (`ocean.vertex.fx`, `ocean.fragment.fx`; the TS above is the reference, and the lockstep tests compare the two):
    - Constants, each `const float NAME = value;` in the .fx and pinned against the TS: `OCEAN_D_MIN = -1000.0`, `OCEAN_D_STEP = 1.0`, `OCEAN_TABLE_SAMPLES = 1040.0` (also the coastline row's width), `OCEAN_ATLAS_ROWS = 28.0`, `OCEAN_DRY_DEPTH = 0.05`, `OCEAN_G = 9.81`, `WEGGEL_GAMMA_MIN = 0.78`, `WEGGEL_GAMMA_MAX = 1.56`, `OCEAN_BORE_RATIO = 0.42`, `OCEAN_BREAK_FULL = 1.5`, `OCEAN_BREAK_FOAM_LO = 1.0`, `OCEAN_BREAK_FOAM_HI = 1.3`, `OCEAN_FOAM_LIFE = 20.0`, `OCEAN_ROLL_WIDTH = 0.6`, `OCEAN_INNER_FOAM = 0.5`, `SHELTER_SWELL = 0.3`, `SHELTER_CHOP = 0.15`, `SHELTER_WIDTH = 40.0`, `SWELL_Q_SUM_MAX = 0.9`. The coastline row's origin and step are the uniform `oceanCoast.xy`.
    - `SWELL_Q0 = 1` is not a shader constant: each component's q0 is read from the atlas, row 26, texel 2c + 1, channel r (the tables write SWELL_Q0 there), never assumed.
    - The texel-centre reads (`atlasRead`, `coastRead`): for a row and a fractional column, c = clamp(column, 0, OCEAN_TABLE_SAMPLES − 1), i0 = floor(c), i1 = min(i0 + 1, OCEAN_TABLE_SAMPLES − 1), two reads of the nearest-sampled atlas at ((i0 + 0.5)/OCEAN_TABLE_SAMPLES, (row + 0.5)/OCEAN_ATLAS_ROWS) and ((i1 + 0.5)/OCEAN_TABLE_SAMPLES, the same), mixed by c − i0. A profile or phase row's column is (d − OCEAN_D_MIN)/OCEAN_D_STEP with d = x − coastlineX; the coastline row's (row 27) is (z − oceanCoast.x)/oceanCoast.y; a component's texels are the integer columns 2c and 2c + 1 of row 26 (exact). Seaward of the table each phase adds k0x·min(d − OCEAN_D_MIN, 0.0) to the mixed Ψ; kn and K need nothing (the first column is deep water's k0x and 1).
    - The dry rule (binding, replacing §5's `h > 0.05` branch; no branch on depth anywhere): `hc = max(h, OCEAN_DRY_DEPTH)`; `γ = clamp(b − a·unbroken/(OCEAN_G·tp²), WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX)` from the mixed profile's a and b at that sample; `ratio = unbroken/(γ·hc)`; `scale = ratio > 1 ? hc·mix(γ, OCEAN_BORE_RATIO, smoothstep(1, OCEAN_BREAK_FULL, ratio))/unbroken : 1` (in GLSL divide by max(unbroken, 1e-6): where ratio > 1, unbroken > 0.039, so the guard changes nothing); `B = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio)`; the sample's depth stays h. Over dry sand the drawn wave is then the shallowest bore, OCEAN_BORE_RATIO·OCEAN_DRY_DEPTH ≈ 2 cm crest to trough, wherever ratio ≥ OCEAN_BREAK_FULL (over 99 % of dry samples; in the moments the envelope nearly cancels the cap lies between γ_b and the bore's, and the crest is at most γ_b·OCEAN_DRY_DEPTH ≤ 7.8 cm tall), and it joins the wet side continuously.
    - The Q cap: s = min(1, SWELL_Q_SUM_MAX / Σ q0·|Kv|·A) (in GLSL over max(Σ, 1e-6)), Q_c = q0_c·s.
    - The shelter, with u = `oceanSwell.xy` (the field's `travel`) and the two tips `oceanTips.xy`, `oceanTips.zw`: side = u.y ≥ 0 ? 1 : −1 (u.y is the travel's z); for each tip T, r = P − T, on = step(0, dot(u, r))·step(0, r.y·side) (the hard ridge-side step: the lee side of the ridge's line along x through T, an edge that lies on the ridge itself, which is land), λ = −(u.x·r.y − u.y·r.x)·side, factor = 1 − (1 − keep)·smoothstep(0, SHELTER_WIDTH, λ)·on; the shelter is the product of the two factors. A tip whose `along` is negative everywhere at sea (one parked far inland, e.g. at x = 1e6) gives 1, as no tips do in the TS.
    - The rest as §5 writes it: φ_c = Ψ + k0x·cx + k0z·z + θ_c; Kv_c = (kn, k0z + (k0x − kn)·cdz); A_c = a0·K·shelter(SHELTER_SWELL) before the break's scale; crestPhase = atan(S.y, S.x); GLSL `mod` is the TS `mod` (x − y·floor(x/y)).

- [ ] **Step 1: Write the failing test**

`client/test/game/oceanWaves.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "../../src/sim/olympic.js";
import { coveFor } from "../../src/sim/olympic.js";
import {
  OCEAN_BORE_RATIO, OCEAN_BREAK_FULL, SHELTER_CHOP, SHELTER_SWELL, SHELTER_WIDTH,
  atlasRead, boreArrivals, coastRead, crestAt, oceanFieldFor, oceanFieldFromState, shelterAt, swellAt, swellNormal,
  swellPhases, type OceanField,
} from "../../src/game/oceanWaves.js";
import {
  OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_DRY_DEPTH, OCEAN_ROW_COAST, OCEAN_ROW_COVE_FIRST, OCEAN_ROW_COVE_PROFILE,
} from "../../src/game/oceanTables.js";
import { SWELL_Q_SUM_MAX, type SwellState } from "../../src/game/oceanSwell.js";
import { WEGGEL_GAMMA_MAX, breakerIndex } from "../../src/game/oceanPhysics.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = LOBBY_SEEDS[0] as number;
/** The typical day: Hs 2.0 m, Tp 11 s, square on to the shore. */
const TYPICAL: SwellState = { hs: 2, tp: 11, dirFromDeg: 270, gamma: 3.3, spread: 25 };

/** The coastline's x at z, as the field reads it. */
const shoreX = (field: OceanField, z: number): number => coastRead(field.tables, z)[0];

/** The first lobby world whose headland `i` reaches at least 140 m past the waterline. */
function longHeadland(i: 0 | 1): number {
  const seed = LOBBY_SEEDS.find((s) => (coveFor(s).heads[i] as { reach: number }).reach >= 140);
  if (seed === undefined) throw new Error("no such headland");
  return seed;
}

describe("swellPhases", () => {
  it("folds (phase0 − ω·t) into [0, 2π) in double precision, zeros past the count", () => {
    const field = oceanFieldFor(SEED, 8);
    const phases = swellPhases(field, 3600.25);
    expect(phases).toHaveLength(12);
    for (let c = 0; c < 8; c++) {
      const comp = field.components[c]!;
      const v = comp.phase0 - comp.omega * 3600.25;
      expect(phases[c]).toBe(Math.fround(v - 2 * Math.PI * Math.floor(v / (2 * Math.PI))));
      expect(phases[c]).toBeGreaterThanOrEqual(0);
      expect(phases[c]).toBeLessThanOrEqual(Math.fround(2 * Math.PI));
    }
    expect([...phases.subarray(8)]).toEqual([0, 0, 0, 0]);
  });
});

describe("atlasRead and coastRead", () => {
  const field = oceanFieldFor(SEED);
  const t = field.tables;
  const raw = (row: number, i: number) => [0, 1, 2, 3].map((ch) => t.data[(row * t.width + i) * 4 + ch] as number);

  it("read a texel at its column, the mean halfway, and clamp to the row", () => {
    expect(atlasRead(t, OCEAN_ROW_COVE_PROFILE, 700)).toEqual(raw(OCEAN_ROW_COVE_PROFILE, 700));
    const mid = atlasRead(t, OCEAN_ROW_COVE_FIRST, 700.5);
    raw(OCEAN_ROW_COVE_FIRST, 700).forEach((v, ch) =>
      expect(mid[ch]).toBeCloseTo((v + (raw(OCEAN_ROW_COVE_FIRST, 701)[ch] as number)) / 2, 6));
    expect(atlasRead(t, OCEAN_ROW_COVE_PROFILE, -20)).toEqual(raw(OCEAN_ROW_COVE_PROFILE, 0));
    expect(atlasRead(t, OCEAN_ROW_COVE_PROFILE, 5000)).toEqual(raw(OCEAN_ROW_COVE_PROFILE, t.width - 1));
  });

  it("read the coastline row by z from its origin", () => {
    const z = t.coastOriginZ + 37 * OCEAN_COAST_STEP;
    expect(coastRead(t, z)).toEqual(raw(OCEAN_ROW_COAST, 37).slice(0, 3));
  });
});

describe("swellAt", () => {
  it("is the same for the same seed and time, on any page", () => {
    const a = oceanFieldFor(SEED);
    const b = oceanFieldFor(SEED);
    const pa = swellPhases(a, 1234.5);
    const pb = swellPhases(b, 1234.5);
    expect(pa).toEqual(pb);
    for (const [x, z] of [[-1500, 40], [-600, -300], [shoreX(a, 0) - 80, 0], [shoreX(a, 0) - 5, 10]] as const) {
      expect(swellAt(a, pa, x, z)).toEqual(swellAt(b, pb, x, z));
    }
  });

  it("is the plane wave far out, continuous across the table's seaward end", () => {
    const field = oceanFieldFor(SEED);
    const phases = swellPhases(field, 77);
    for (const [x, z] of [[-2500, 300], [-3100, -700], [-1900, 1200]] as const) {
      let plane = 0;
      field.components.forEach((c, i) => { plane += c.a0 * Math.cos(c.k0x * x + c.k0z * z + (phases[i] as number)); });
      expect(Math.abs(swellAt(field, phases, x, z).height - plane)).toBeLessThan(1e-3);
    }
    const z = 250;
    const edge = shoreX(field, z) + OCEAN_D_MIN;
    expect(Math.abs(swellAt(field, phases, edge - 1e-3, z).height - swellAt(field, phases, edge + 1e-3, z).height)).toBeLessThan(1e-4);
  });

  it("carries the world's Hs far out: 4·std of the height over 2 km × 2 km within 10 %", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFor(seed);
      const phases = swellPhases(field, 0);
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let x = -4000; x <= -2000; x += 20) {
        for (let z = -1000; z <= 1000; z += 20) {
          const h = swellAt(field, phases, x, z).height;
          sum += h;
          sq += h * h;
          n++;
        }
      }
      const std = Math.sqrt(sq / n - (sum / n) * (sum / n));
      expect(Math.abs(4 * std - field.hs) / field.hs).toBeLessThan(0.1);
    }
  }, timeLimit(60_000));

  it("breaks the typical day's significant wave 55 to 83 m out on the cove's centre line: the research's 69 m within 20 %", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFromState(seed, TYPICAL);
      let first = Number.NaN;
      for (let d = -400; d <= 0; d++) {
        const column = d - OCEAN_D_MIN;
        let energy = 0;
        field.components.forEach((c, i) => {
          energy += (c.a0 * atlasRead(field.tables, OCEAN_ROW_COVE_FIRST + i, column)[2]) ** 2 / 2;
        });
        const height = 4 * Math.sqrt(energy);
        const depth = atlasRead(field.tables, OCEAN_ROW_COVE_PROFILE, column)[0];
        if (height > breakerIndex(0.02, height, 11) * depth) {
          first = d;
          break;
        }
      }
      expect(first).toBeGreaterThanOrEqual(-83);
      expect(first).toBeLessThanOrEqual(-55);
    }
  });

  it("at a set's peak breaks farther out, 70 to 160 m (a typical day's line runs 50 to 160 m), and caps the surf to the bore", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 5)) {
      const field = oceanFieldFromState(seed, TYPICAL);
      const z = coveFor(seed).z0;
      const cx = shoreX(field, z);
      // The set's peak: the largest unbroken crest 69 m out over two set periods.
      let peak = 0;
      let at = 0;
      for (let t = 0; t < 400; t += 0.25) {
        const s = swellAt(field, swellPhases(field, t), cx - 69, z);
        if (s.unbroken > peak) [peak, at] = [s.unbroken, t];
      }
      expect(peak).toBeGreaterThan(2.6);
      const phases = swellPhases(field, at);
      let first = Number.NaN;
      for (let d = -400; d <= -1; d++) {
        if (swellAt(field, phases, cx + d, z).ratio > 1) {
          first = d;
          break;
        }
      }
      expect(first).toBeGreaterThanOrEqual(-160);
      expect(first).toBeLessThanOrEqual(-70);
      // Shoreward, through the set: the drawn crest never stands taller than
      // γ_b·h (= unbroken/ratio), and where the cap is full it is the bore's.
      let over = 0;
      let bores = 0;
      let boreMiss = 0;
      for (let t = at; t < at + 30; t += 1.5) {
        const p = swellPhases(field, t);
        for (let d = -200; d <= -1; d += 1) {
          const s = swellAt(field, p, cx + d, z);
          if (!(s.ratio > 1)) continue;
          const crest = crestAt(field, p, cx + d, z);
          const cap = s.unbroken / s.ratio;
          if (!crest.broken || crest.height > cap + 1e-6 || s.height > cap + 1e-6) over++;
          if (s.ratio >= OCEAN_BREAK_FULL) {
            bores++;
            boreMiss = Math.max(boreMiss, Math.abs(crest.height / s.depth - OCEAN_BORE_RATIO));
          }
        }
      }
      expect(over).toBe(0);
      expect(boreMiss).toBeLessThan(0.15 * OCEAN_BORE_RATIO);
      expect(bores).toBeGreaterThan(50);
    }
  }, timeLimit(60_000));

  it("over dry sand falls to the shallowest bore's couple of centimetres and meets the waterline without a step", () => {
    const field = oceanFieldFromState(SEED, TYPICAL);
    const z = coveFor(SEED).z0;
    let dry = 0;
    let full = 0;
    let worst = 0;
    let worstFull = 0;
    for (let t = 0; t < 200; t += 0.25) {
      const phases = swellPhases(field, t);
      for (const along of [z - 60, z, z + 60]) {
        const cx = shoreX(field, along);
        for (let d = 0.5; d <= 39; d += 0.5) {
          const s = swellAt(field, phases, cx + d, along);
          if (!(s.depth < 0)) continue;
          dry++;
          worst = Math.max(worst, Math.abs(s.height));
          if (s.ratio >= OCEAN_BREAK_FULL) {
            full++;
            worstFull = Math.max(worstFull, Math.abs(s.height));
          }
        }
      }
    }
    expect(dry).toBeGreaterThan(50_000);
    // The shallowest bore, OCEAN_BORE_RATIO·OCEAN_DRY_DEPTH crest to trough, wherever
    // the cap is full: all but the moments the envelope nearly cancels, when the
    // cap is between γ_b and the bore's and the crest no taller than γ_b·OCEAN_DRY_DEPTH.
    expect(full / dry).toBeGreaterThan(0.99);
    expect(worstFull).toBeLessThanOrEqual((OCEAN_BORE_RATIO * OCEAN_DRY_DEPTH * 1.0001) / 2);
    expect(worst).toBeLessThanOrEqual((WEGGEL_GAMMA_MAX * OCEAN_DRY_DEPTH * 1.0001) / 2);
    // Across the waterline at a set's peak, a quarter metre at a time.
    const cx = shoreX(field, z);
    let peak = 0;
    let at = 0;
    for (let t = 0; t < 400; t += 0.25) {
      const s = swellAt(field, swellPhases(field, t), cx - 69, z);
      if (s.unbroken > peak) [peak, at] = [s.unbroken, t];
    }
    const phases = swellPhases(field, at);
    let step = 0;
    let prev = swellAt(field, phases, cx - 6, z).height;
    for (let d = -5.75; d <= 6; d += 0.25) {
      const next = swellAt(field, phases, cx + d, z).height;
      step = Math.max(step, Math.abs(next - prev));
      prev = next;
    }
    expect(step).toBeLessThan(0.05);
  }, timeLimit(60_000));

  it("keeps B, the foam and its age in range, the normal unit and upright, the sideways reach and Σ Q|K|A capped", () => {
    const field = oceanFieldFromState(SEED, { hs: 4, tp: 14, dirFromDeg: 290, gamma: 7, spread: 75 });
    const cx = shoreX(field, 0);
    const lo = { breaking: Infinity, foam: Infinity, foamAge: Infinity, normalY: Infinity };
    const hi = { breaking: -Infinity, foam: -Infinity, foamAge: -Infinity, steepness: -Infinity, unit: 0, reach: -Infinity };
    let broken = 0;
    for (let t = 0; t < 120; t += 7.3) {
      const phases = swellPhases(field, t);
      for (let d = -1200; d <= 30; d += 3.7) {
        for (const z of [-400, -150, -60, 0, 90, 170, 600]) {
          const s = swellAt(field, phases, cx + d, z);
          lo.breaking = Math.min(lo.breaking, s.breaking);
          hi.breaking = Math.max(hi.breaking, s.breaking);
          lo.foam = Math.min(lo.foam, s.foam);
          hi.foam = Math.max(hi.foam, s.foam);
          lo.foamAge = Math.min(lo.foamAge, s.foamAge);
          hi.foamAge = Math.max(hi.foamAge, s.foamAge);
          lo.normalY = Math.min(lo.normalY, s.normalY);
          hi.steepness = Math.max(hi.steepness, s.steepness);
          hi.unit = Math.max(hi.unit, Math.abs(Math.hypot(...swellNormal(s)) - 1));
          hi.reach = Math.max(hi.reach, Math.hypot(s.dx, s.dz) - s.reach);
          if (s.broken) broken++;
        }
      }
    }
    expect(lo.breaking).toBeGreaterThanOrEqual(0);
    expect(hi.breaking).toBeLessThanOrEqual(1);
    expect(hi.breaking).toBe(1);
    expect(lo.foam).toBeGreaterThanOrEqual(0);
    expect(hi.foam).toBeLessThanOrEqual(1);
    expect(lo.foamAge).toBeGreaterThanOrEqual(0);
    expect(hi.foamAge).toBeLessThan(14);
    expect(hi.unit).toBeLessThan(1e-12);
    expect(hi.steepness).toBeLessThanOrEqual(SWELL_Q_SUM_MAX + 1e-9);
    expect(lo.normalY).toBeGreaterThanOrEqual(1 - SWELL_Q_SUM_MAX - 1e-9);
    expect(hi.reach).toBeLessThanOrEqual(1e-9);
    expect(broken).toBeGreaterThan(100);
  }, timeLimit(60_000));
});

describe("shelterAt", () => {
  const lee = (field: OceanField, head: number, inward: number): [number, number] => {
    const z = (field.tips[head] as [number, number])[1] + inward;
    return [shoreX(field, z) - 10, z];
  };

  it("leaves SHELTER_SWELL deep in the lee of the up-swell headland of a swell 30° from the south-west", () => {
    expect([SHELTER_SWELL, SHELTER_CHOP, SHELTER_WIDTH]).toEqual([0.3, 0.15, 40]);
    const seed = longHeadland(0);
    const field = oceanFieldFromState(seed, { hs: 2, tp: 11, dirFromDeg: 300, gamma: 7, spread: 75 });
    expect(field.travel[1]).toBeGreaterThan(0.4);
    const [x, z] = lee(field, 0, 25);
    expect(Math.abs(shelterAt(field, x, z, SHELTER_SWELL) - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(shelterAt(field, x, z, SHELTER_CHOP) - 0.15)).toBeLessThan(0.05);
    // The same place behind the other headland is its weather side: open.
    const [ox, oz] = lee(field, 1, -25);
    expect(shelterAt(field, ox, oz, SHELTER_SWELL)).toBe(1);
  });

  it("turns the other way under a swell 30° from the north-west", () => {
    const seed = longHeadland(1);
    const field = oceanFieldFromState(seed, { hs: 2, tp: 11, dirFromDeg: 240, gamma: 7, spread: 75 });
    expect(field.travel[1]).toBeLessThan(-0.4);
    const [x, z] = lee(field, 1, -25);
    expect(Math.abs(shelterAt(field, x, z, SHELTER_SWELL) - 0.3)).toBeLessThan(0.05);
    const [ox, oz] = lee(field, 0, 25);
    expect(shelterAt(field, ox, oz, SHELTER_SWELL)).toBe(1);
  });

  it("is 1 on the open coast, in front of the tips and where there are no tips, and fades without a step", () => {
    const seed = longHeadland(0);
    const field = oceanFieldFromState(seed, { hs: 2, tp: 11, dirFromDeg: 300, gamma: 7, spread: 75 });
    for (const z of [-1500, 1500]) expect(shelterAt(field, shoreX(field, z) - 50, z, SHELTER_SWELL)).toBe(1);
    const [ux, uz] = field.travel;
    for (const [tx, tz] of field.tips) {
      expect(shelterAt(field, tx - 30 * ux, tz - 30 * uz, SHELTER_SWELL)).toBe(1);
      expect(shelterAt(field, tx - 60, tz, SHELTER_SWELL)).toBe(1);
    }
    expect(shelterAt({ ...field, tips: [] }, ...lee(field, 0, 25), SHELTER_SWELL)).toBe(1);
    // Along the beach out of the lee: from 0.3 to 1 with no jump.
    let prev = shelterAt(field, ...lee(field, 0, 25), SHELTER_SWELL);
    for (let inward = 25.5; inward <= 200; inward += 0.5) {
      const next = shelterAt(field, ...lee(field, 0, inward), SHELTER_SWELL);
      expect(Math.abs(next - prev)).toBeLessThan(0.03);
      prev = next;
    }
    expect(prev).toBe(1);
  });
});

describe("crestAt", () => {
  it("hands the breaker the crest's period, the deep wavelength, the bed and the Iribarren number on them", () => {
    const field = oceanFieldFromState(SEED, TYPICAL);
    const z = coveFor(SEED).z0;
    const x = shoreX(field, z) - 100;
    const crest = crestAt(field, swellPhases(field, 40), x, z);
    expect(crest.period).toBe(11);
    expect(crest.offshoreLength).toBeCloseTo(188.9185, 4);
    expect(crest.slope).toBeCloseTo(0.02, 4);
    expect(crest.depth).toBeCloseTo(3.52, 4);
    expect(crest.iribarren).toBeCloseTo(crest.slope / Math.sqrt(crest.offshoreHeight / crest.offshoreLength), 12);
    expect(Math.hypot(...crest.direction)).toBeCloseTo(1, 12);
    expect(crest.direction[0]).toBeGreaterThan(0.9);
    expect(crest.phase).toBe(swellAt(field, swellPhases(field, 40), x, z).crestPhase);
    // Spilling on the 1:50 bed: ξ0 well under 0.5 for a crest of about Hs.
    expect(crest.offshoreHeight).toBeGreaterThan(0.5);
    expect(crest.iribarren).toBeLessThan(0.5);
  });
});

describe("boreArrivals", () => {
  it("finds the broken crests passing the cove's toe about one peak period apart", () => {
    const field = oceanFieldFromState(SEED, TYPICAL);
    const z = coveFor(SEED).z0;
    const arrivals = boreArrivals(field, shoreX(field, z) - 24, z, 0, 600, 0.1);
    expect(arrivals.length).toBeGreaterThan(10);
    const gaps = arrivals.slice(1).map((a, i) => a.t - (arrivals[i] as { t: number }).t);
    // Within a set the broken crests come one period apart; between sets the
    // smaller crests reach the toe unbroken and leave a longer gap.
    const inSet = gaps.filter((g) => g < 1.5 * 11);
    expect(inSet.length).toBeGreaterThan(8);
    for (const g of inSet) {
      expect(g).toBeGreaterThan(0.8 * 11);
      expect(g).toBeLessThan(1.2 * 11);
    }
    for (const a of arrivals) {
      expect(a.t).toBeGreaterThanOrEqual(0);
      expect(a.t).toBeLessThan(600);
      // A bore in 2 m of water: no taller than γ_b·h on the toe.
      expect(a.height).toBeGreaterThan(0);
      expect(a.height).toBeLessThan(1.56 * 2.1);
    }
  }, timeLimit(60_000));
});
```

`client/test/architecture.test.ts` — in `BABYLON_FREE_FILES`, old:

```ts
      join(SRC, "game", "lensParams.ts"),
```

new:

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "oceanWaves.ts"),
```

(Anchored on the `lensParams.ts` line, which the other Babylon-free additions leave in place; the list's order does not matter.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanWaves.test.ts test/architecture.test.ts`
Expected: FAIL with "Cannot find module '../../src/game/oceanWaves.js'" (and the architecture test's `existsSync` on `oceanWaves.ts` fails)

- [ ] **Step 3: Implement**

`client/src/game/oceanWaves.ts`:

```ts
/**
 * The swell at a point: its height, its trochoidal displacement and slopes,
 * its envelope, its break and its white water, and how a headland shelters it.
 * Babylon-free (on BABYLON_FREE_FILES). The sea's shaders evaluate the same
 * maths from the same atlas (`ocean.vertex.fx`, `ocean.fragment.fx`); tests
 * hold the two in lockstep.
 *
 * Each component's phase is φ = Ψ(d) + k0x·coastlineX(z) + k0z·z + θ, Ψ from
 * the tables at the coast distance d = x − coastlineX(z) and θ = phase0 − ωt
 * the frame's phase (`swellPhases`): far out the plane wave k0·x − ωt, near
 * shore the crests turned to the contours. The local height before breaking is
 * twice the envelope |Σ A e^{iφ}| of the shoaled, refracted, sheltered
 * components, so it rises and falls with the sets; where it passes Weggel's
 * γ_b·h the wave has broken, and its components are scaled down to the bore's
 * OCEAN_BORE_RATIO·h over the transition to OCEAN_BREAK_FULL, h held at
 * OCEAN_DRY_DEPTH or more so the swell over dry sand is the shallowest
 * water's bore, a couple of centimetres. The white water
 * is a function of the crest's local phase: the roll on a broken crest's front,
 * the foam aged since the crest passed, the inner surf's floor.
 */
import { OCEAN_G, WEGGEL_GAMMA_MAX, WEGGEL_GAMMA_MIN } from "./oceanPhysics.js";
import {
  SWELL_COMPONENTS, SWELL_Q_SUM_MAX, swellComponents, swellStateFor, swellTravelDirection,
  type SwellComponent, type SwellState,
} from "./oceanSwell.js";
import {
  OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_DRY_DEPTH,
  OCEAN_ROW_BAY_FIRST, OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COAST, OCEAN_ROW_COMPONENTS,
  OCEAN_ROW_COVE_FIRST, OCEAN_ROW_COVE_PROFILE,
  buildOceanTables, coastProfilesFor, type OceanTables,
} from "./oceanTables.js";
import { coveFor } from "../sim/olympic.js";

/** A broken wave's height over its depth. */
export const OCEAN_BORE_RATIO = 0.42;
/** The ratio unbroken/(γ_b·h) at which the cap reaches the bore's. */
export const OCEAN_BREAK_FULL = 1.5;
/** The breaking intensity B = smoothstep(LO, HI, ratio). */
export const OCEAN_BREAK_FOAM_LO = 1.0;
export const OCEAN_BREAK_FOAM_HI = 1.3;
/** Seconds over which a broken crest's trailing foam thins. */
export const OCEAN_FOAM_LIFE = 20;
/** Radians of crest phase ahead of a broken crest that carry its roll. */
export const OCEAN_ROLL_WIDTH = 0.6;
/** The inner surf's foam floor under a broken wave. */
export const OCEAN_INNER_FOAM = 0.5;
/** What a headland's shadow leaves of the swell and of the wind sea, and the width (m) it fades in over. */
export const SHELTER_SWELL = 0.3;
export const SHELTER_CHOP = 0.15;
export const SHELTER_WIDTH = 40;

export type OceanField = {
  tables: OceanTables; components: SwellComponent[]; count: number; tp: number; hs: number;
  travel: [number, number]; tips: [number, number][];
};

export type SwellSample = {
  /** Displacement: up, and across (x, z). */
  height: number; dx: number; dz: number;
  /** The Gerstner normal's terms, unnormalised: (slopeX, normalY, slopeZ). */
  slopeX: number; slopeZ: number; normalY: number;
  depth: number; envelope: number; unbroken: number; ratio: number; broken: boolean; breaking: number;
  crestPhase: number; foamAge: number; foam: number;
  /** Σ Q·A, the most the surface moves across here, and Σ Q·|K|·A, held to SWELL_Q_SUM_MAX. */
  reach: number; steepness: number;
};

export type Crest = {
  height: number; period: number; direction: [number, number]; phase: number; depth: number; slope: number;
  offshoreHeight: number; offshoreLength: number; broken: boolean; iribarren: number;
};

const TWO_PI = 2 * Math.PI;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mod(x: number, m: number): number {
  return x - m * Math.floor(x / m);
}

/** The ocean of a world: its swell, the tables about its cove, the travel direction and the headlands' tips. */
export function oceanFieldFor(seed: number, count: number = SWELL_COMPONENTS): OceanField {
  return oceanFieldFromState(seed, swellStateFor(seed), count);
}

/** The same with the sea state given: the world's coast under any swell. */
export function oceanFieldFromState(seed: number, state: SwellState, count: number = SWELL_COMPONENTS): OceanField {
  const components = swellComponents(seed, state);
  const profiles = coastProfilesFor(seed);
  const n = Math.min(Math.max(count, 0), components.length);
  return {
    tables: buildOceanTables(profiles, components, state.tp, coveFor(seed).z0),
    components,
    count: n,
    tp: state.tp,
    hs: state.hs,
    travel: swellTravelDirection(components.slice(0, n)),
    tips: profiles.headlandTips,
  };
}

/** The frame's phases θ_c = (phase0 − ω·t) mod 2π, folded in double precision; zeros past the count. */
export function swellPhases(field: OceanField, seconds: number): Float32Array {
  const out = new Float32Array(SWELL_COMPONENTS);
  for (let c = 0; c < field.count; c++) {
    const comp = field.components[c] as SwellComponent;
    out[c] = mod(comp.phase0 - comp.omega * seconds, TWO_PI);
  }
  return out;
}

/**
 * One atlas row read at a fractional column, by hand: linear between the two
 * nearest texels, the column clamped to [0, width − 1]. The shaders read the
 * nearest-sampled texture at the same two texel centres, (i + 0.5)/width, and
 * mix by the same fraction, so the two agree texel centre for texel centre.
 */
export function atlasRead(tables: OceanTables, row: number, column: number): [number, number, number, number] {
  const c = Math.min(Math.max(column, 0), tables.width - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(i0 + 1, tables.width - 1);
  const f = c - i0;
  const o0 = (row * tables.width + i0) * 4;
  const o1 = (row * tables.width + i1) * 4;
  const d = tables.data;
  return [
    (d[o0] as number) + ((d[o1] as number) - (d[o0] as number)) * f,
    (d[o0 + 1] as number) + ((d[o1 + 1] as number) - (d[o0 + 1] as number)) * f,
    (d[o0 + 2] as number) + ((d[o1 + 2] as number) - (d[o0 + 2] as number)) * f,
    (d[o0 + 3] as number) + ((d[o1 + 3] as number) - (d[o0 + 3] as number)) * f,
  ];
}

/** The coastline row at z: (coastlineX, its slope dx/dz, the cove's weight). */
export function coastRead(tables: OceanTables, z: number): [number, number, number] {
  const r = atlasRead(tables, OCEAN_ROW_COAST, (z - tables.coastOriginZ) / OCEAN_COAST_STEP);
  return [r[0], r[1], r[2]];
}

/**
 * What the headlands leave of a wave at (x, z): `keep` deep in a shadow, 1 out
 * of every shadow, the product over the tips. The swell travels along the
 * unit u (the field's travel). A tip T's shadow lies
 * - downstream of the tip: along = u·(P − T) ≥ 0;
 * - on the ridge's lee side, the side the travel's along-shore part points
 *   to: (P − T).z·side ≥ 0 with side = +1 when u.z ≥ 0, else −1 (the ridge
 *   runs along x at the tip's z, and on that line the ground is the ridge
 *   itself, so this edge falls on land);
 * - past the swell's line through the tip: λ = −cross(u, P − T)·side > 0,
 *   cross(u, r) = u.x·r.z − u.z·r.x, the distance into the shadow;
 * and the wave fades to `keep` over SHELTER_WIDTH m of λ. So under a swell
 * from south of the shore's normal (u.z > 0) the headland at the cove's −z
 * end shelters the cove behind it and the +z headland the open coast beyond
 * the cove; from north of it the other way round; square on, neither.
 */
export function shelterAt(field: OceanField, x: number, z: number, keep: number): number {
  const [ux, uz] = field.travel;
  const side = uz >= 0 ? 1 : -1;
  let factor = 1;
  for (const [tx, tz] of field.tips) {
    const rx = x - tx;
    const rz = z - tz;
    if (ux * rx + uz * rz < 0 || rz * side < 0) continue;
    const lambda = -(ux * rz - uz * rx) * side;
    factor *= 1 - (1 - keep) * smoothstep(0, SHELTER_WIDTH, lambda);
  }
  return factor;
}

type Evaluation = {
  sample: SwellSample; scale: number; offshore: number; direction: [number, number]; wc: number; column: number;
};

function evaluate(field: OceanField, phases: Float32Array, x: number, z: number): Evaluation {
  const t = field.tables;
  const [cx, cdz, wc] = coastRead(t, z);
  const d = x - cx;
  const column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  const deep = Math.min(d - OCEAN_D_MIN, 0);
  const bay = atlasRead(t, OCEAN_ROW_BAY_PROFILE, column);
  const cove = atlasRead(t, OCEAN_ROW_COVE_PROFILE, column);
  const h = bay[0] + (cove[0] - bay[0]) * wc;
  const a = bay[1] + (cove[1] - bay[1]) * wc;
  const b = bay[2] + (cove[2] - bay[2]) * wc;
  const shelter = shelterAt(field, x, z, SHELTER_SWELL);

  const n = field.count;
  const phi = new Float64Array(n);
  const amp = new Float64Array(n);
  const q0 = new Float64Array(n);
  const kx = new Float64Array(n);
  const kz = new Float64Array(n);
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  for (let c = 0; c < n; c++) {
    const k = atlasRead(t, OCEAN_ROW_COMPONENTS, 2 * c);
    const q = atlasRead(t, OCEAN_ROW_COMPONENTS, 2 * c + 1);
    const rb = atlasRead(t, OCEAN_ROW_BAY_FIRST + c, column);
    const rc = atlasRead(t, OCEAN_ROW_COVE_FIRST + c, column);
    const k0x = k[0];
    const k0z = k[1];
    const psi = rb[0] + (rc[0] - rb[0]) * wc + k0x * deep;
    const kn = rb[1] + (rc[1] - rb[1]) * wc;
    const K = rb[2] + (rc[2] - rb[2]) * wc;
    const p = psi + k0x * cx + k0z * z + (phases[c] as number);
    phi[c] = p;
    kx[c] = kn;
    kz[c] = k0z + (k0x - kn) * cdz;
    const A = k[3] * K * shelter;
    amp[c] = A;
    q0[c] = q[0];
    sx += A * Math.cos(p);
    sy += A * Math.sin(p);
    ox += k[3] * Math.cos(p);
    oy += k[3] * Math.sin(p);
  }
  const envelope = Math.hypot(sx, sy);
  const unbroken = 2 * envelope;
  const crestPhase = Math.atan2(sy, sx);

  // The break on the depth held at OCEAN_DRY_DEPTH or more: over dry sand the
  // swell is capped as in the shallowest water, so it falls to the bore's
  // couple of centimetres and meets the waterline without a step.
  const hc = Math.max(h, OCEAN_DRY_DEPTH);
  const gamma = Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, b - (a * unbroken) / (OCEAN_G * field.tp * field.tp)));
  const ratio = unbroken / (gamma * hc);
  let scale = 1;
  if (ratio > 1) {
    const cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1, OCEAN_BREAK_FULL, ratio);
    scale = (hc * cap) / unbroken;
  }
  const breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);

  let steepness = 0;
  for (let c = 0; c < n; c++) {
    amp[c] = (amp[c] as number) * scale;
    steepness += (q0[c] as number) * Math.hypot(kx[c] as number, kz[c] as number) * (amp[c] as number);
  }
  const s = steepness > SWELL_Q_SUM_MAX ? SWELL_Q_SUM_MAX / steepness : 1;

  let height = 0;
  let dx = 0;
  let dz = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let fold = 0;
  let reach = 0;
  let wx = 0;
  let wz = 0;
  for (let c = 0; c < n; c++) {
    const A = amp[c] as number;
    const Q = (q0[c] as number) * s;
    const Kx = kx[c] as number;
    const Kz = kz[c] as number;
    const kmag = Math.hypot(Kx, Kz);
    const sin = Math.sin(phi[c] as number);
    const cos = Math.cos(phi[c] as number);
    height += A * cos;
    dx -= (Q * A * Kx * sin) / kmag;
    dz -= (Q * A * Kz * sin) / kmag;
    slopeX += A * Kx * sin;
    slopeZ += A * Kz * sin;
    fold += Q * A * kmag * cos;
    reach += Q * A;
    wx += (A * A * Kx) / kmag;
    wz += (A * A * Kz) / kmag;
  }
  const foamAge = mod(-crestPhase, TWO_PI) / (TWO_PI / field.tp);
  const roll = breaking * (1 - smoothstep(0, OCEAN_ROLL_WIDTH, mod(crestPhase, TWO_PI)));
  const trailing = breaking * Math.exp(-foamAge / OCEAN_FOAM_LIFE);
  const wl = Math.hypot(wx, wz);
  return {
    sample: {
      height, dx, dz, slopeX, slopeZ, normalY: 1 - fold,
      depth: h, envelope, unbroken, ratio, broken: ratio > 1, breaking,
      crestPhase, foamAge, foam: Math.max(roll, trailing, breaking * OCEAN_INNER_FOAM),
      reach, steepness: steepness * s,
    },
    scale,
    offshore: 2 * Math.hypot(ox, oy),
    direction: wl > 0 ? [wx / wl, wz / wl] : [1, 0],
    wc,
    column,
  };
}

/** The swell at the undisplaced point (x, z) under the frame's phases. */
export function swellAt(field: OceanField, phases: Float32Array, x: number, z: number): SwellSample {
  return evaluate(field, phases, x, z).sample;
}

/** The unit normal of a sample's Gerstner terms. */
export function swellNormal(s: SwellSample): [number, number, number] {
  const len = Math.hypot(s.slopeX, s.normalY, s.slopeZ);
  return [s.slopeX / len, s.normalY / len, s.slopeZ / len];
}

/**
 * The crest at a shore point, for the breaker: its local height (shoaled,
 * refracted, sheltered, capped where broken), the peak period, the direction
 * it travels and its phase, the depth and bed slope, the height the same
 * group has offshore (twice its envelope at deep amplitudes) and the deep
 * wavelength g·T²/2π, whether it has broken, and the Iribarren number
 * slope/√(H0/L0).
 */
export function crestAt(field: OceanField, phases: Float32Array, x: number, z: number): Crest {
  const e = evaluate(field, phases, x, z);
  const t = field.tables;
  const depthAt = (column: number): number => {
    const bay = atlasRead(t, OCEAN_ROW_BAY_PROFILE, column)[0];
    const cove = atlasRead(t, OCEAN_ROW_COVE_PROFILE, column)[0];
    return bay + (cove - bay) * e.wc;
  };
  const slope = Math.abs(depthAt(e.column - 1) - depthAt(e.column + 1)) / (2 * OCEAN_D_STEP);
  const offshoreLength = (OCEAN_G * field.tp * field.tp) / TWO_PI;
  return {
    height: e.sample.unbroken * e.scale,
    period: field.tp,
    direction: e.direction,
    phase: e.sample.crestPhase,
    depth: e.sample.depth,
    slope,
    offshoreHeight: e.offshore,
    offshoreLength,
    broken: e.sample.broken,
    iribarren: slope / Math.sqrt(Math.max(e.offshore, 1e-6) / offshoreLength),
  };
}

/**
 * The times in [from, to) a broken crest passes (x, z), and its height there:
 * for swash at the face's toe. Sampled every `step` s; a crest passes where
 * the crest phase, falling with time, wraps through 0, the time found by
 * linear interpolation between the two samples either side.
 */
export function boreArrivals(
  field: OceanField, x: number, z: number, from: number, to: number, step: number,
): { t: number; height: number }[] {
  const out: { t: number; height: number }[] = [];
  let prev: { t: number; q: number; broken: boolean; height: number } | null = null;
  for (let i = 0; from + i * step < to; i++) {
    const t = from + i * step;
    const e = evaluate(field, swellPhases(field, t), x, z);
    const here = { t, q: mod(e.sample.crestPhase, TWO_PI), broken: e.sample.broken, height: e.sample.unbroken * e.scale };
    if (prev !== null && here.q - prev.q > Math.PI && (prev.broken || here.broken)) {
      const f = prev.q / (prev.q + TWO_PI - here.q);
      out.push({ t: prev.t + f * step, height: Math.max(prev.height, here.height) });
    }
    prev = here;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanWaves.test.ts test/game/oceanTables.test.ts test/game/oceanSwell.test.ts test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/oceanWaves.ts client/test/game/oceanWaves.test.ts`
Expected: PASS (15 tests in `oceanWaves.test.ts`, a few seconds). Measured with Task 1's and Task 2's functions over the first five lobby worlds under Hs 2.0 m, Tp 11 s, from 270°: a wave of the significant height breaks 61 to 64 m out on the cove's centre line (the research's 69 m); at a set's peak (the largest unbroken crest 69 m out over 400 s, 3.1 to 3.7 m tall, 2.5 to 3.1 m offshore) the first breaking point lies 85 to 97 m out; far out 4·std/Hs is 0.979 to 1.029; deep in the up-swell headland's lee under a 30° swell the factor is 0.300 (swell) and 0.150 (chop) both ways round; at the cove's toe the broken crests come 10.4 to 12.6 s apart within a set; over the cove's dry sand through 200 s, 99.76 % of samples carry the full bore cap, |height| at most 0.0105 m there and 0.0219 m anywhere (a moment the envelope nearly cancels); across the waterline at a set's peak, neighbouring 0.25 m samples differ by at most 0.005 m.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanWaves.ts client/test/game/oceanWaves.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the swell at a point: height, break, white water and shelter

## What

The swell's evaluation, the maths the sea's shaders mirror: at any point and time the trochoidal height, displacement and normal of the shoaled, refracted and sheltered components; the envelope that rises and falls with the sets; the break where the unbroken height passes Weggel's γ_b·h, capped to the bore's 0.42·h shoreward of it; the white water from the crest's phase; a headland's shadow; and, for the breaker and swash to come, the crest at a shore point and the times its bores arrive.

## How

- `client/src/game/oceanWaves.ts` — `oceanFieldFor`, `oceanFieldFromState`, `swellPhases`, `atlasRead` and `coastRead` (by hand, texel centre for texel centre with the shaders), `shelterAt`, `swellAt`, `swellNormal`, `crestAt`, `boreArrivals`
- `client/test/game/oceanWaves.test.ts` — determinism; the far-out plane wave and its Hs; the typical day's significant wave breaking 55 to 83 m out and a set's peak 70 to 160 m out; the bore's cap; the swell over dry sand and across the waterline; the ranges and the Σ Q|K|A cap; a headland's lee under a swell from either side; the Iribarren number; the bores a period apart at the cove's toe
- `client/test/architecture.test.ts` — the module joins the Babylon-free list

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 9: The shared clock and the wind sea's state

**Files:**
- Create: `client/src/game/oceanWindSea.ts`
- Modify: `client/src/game/renderer.ts:33, 660, 1858–1859, 1864, 1929, 1970` (line numbers as on main at 9edee7e; every edit is anchored on its text)
- Modify: `client/test/game/renderer.test.ts:377, 642`
- Modify: `client/test/architecture.test.ts:445` (`BABYLON_FREE_FILES`)
- Test: `client/test/game/oceanWindSea.test.ts`, `client/test/game/renderer.test.ts` (`windParams.test.ts` needs no change: `windRecordUnder` keeps its signature; only the seconds the renderer hands it change)

**Interfaces:**
- Consumes:
  - `TICK_DT` — `client/src/sim/constants.ts`
  - Task 1: `OCEAN_G`, `whitecapCoverage(u10: number): number` (0 to 3.7 m/s, Callaghan's cubic to 11.25 m/s, its tangent beyond, capped at 0.1)
  - Task 2 (`client/src/game/oceanSpectrum.ts`): `WIND_SEA_HS_COEFF = 0.28`, `WIND_SEA_FP_COEFF = 0.123`, `WIND_SEA_SPREAD = 10`, `WIND_SEA_GAMMA = 3.3`: defined there (the spectrum's `windSeaH0` reads them), imported here and re-exported, never defined a second time
  - `FixedStepAccumulator` — `client/src/game/loop.ts` (test). Its `alpha` is `accumulated / TICK_DT`: the fraction of the way into the next pending tick, in [0, 1). Both of `app.ts`'s loops (`stepAndRender` for the host and for a client) call `accumulator.advance(dt)`, run that many ticks (`host.tick`, or `client.tick`, which steps the predicted world's `state.tick` once a tick), then hand `accumulator.alpha` to `renderer.sync` with the state whose `tick` already counts them. So (tick + alpha)·TICK_DT advances by exactly each frame's dt and the tick increments as the fraction wraps: continuous and monotonic across ticks with no other derivation needed. A client's reconcile resets its predicted tick to the snapshot's and replays its unacknowledged inputs, which can move it a tick or two either way: the prediction lead the spec allows; the water plugin's `advance` already ignores a backward step. `probeScene` and `sceneRoute` pass alpha 0; `sceneRoute` hands in its own clock, so it keeps it; the probe's single still holds the tick it was built at.
  - In `renderer.ts`'s `buildRenderer`: `options.clock`, `clock`, `lighting.hour`, `state.tick`, `alpha`.
- Produces:
  - `client/src/game/oceanWindSea.ts`: the shared definitions' other `WIND_SEA_*` constants (`WIND_SEA_U_PER_WIND`, `WIND_SEA_DAWN`, `WIND_SEA_AFTERNOON`, `WIND_SEA_OFFSHORE_CUT`, `WIND_SEA_U_REF`) and `export { WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA } from "./oceanSpectrum.js";`; added `WIND_SEA_DAWN_HOURS = [5, 8]` and `WIND_SEA_AFTERNOON_HOURS = [13, 18]` (h, held fully), `WIND_SEA_SHOULDER = 1` (h, smoothstep either side), `WIND_SEA_U_FLOOR = 0.5` (m/s, the floor under tp and loopRate); `type WindSeaState` (Shared definitions §3); `hourFactor(hour: number): number` (wraps at 24 h; 1 at noon exactly); `windSeaStateFor(wind01: number, dir: [number, number], hour: number): WindSeaState` (dir is the direction the wind blows toward, normalised; onshore = dir.x, since the land lies toward +x; tp = max(u10, 0.5)/(0.123·g)); `sharedSeconds(tick: number, alpha: number): number` = (tick + clamp(alpha, 0, 1))·TICK_DT.
  - `renderer.ts`: `Water.update(camX: number, camZ: number, seconds: number, hour?: number): void` (the type only; `createWater`'s implementation keeps its three parameters until the ocean reads the hour). In `sync`: `const oceanSeconds = options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha);` — the wind record (so every peer's wind turns and gusts alike, and with it the foliage, rain and motes that read the record) and both `water?.update(…, oceanSeconds, lighting.hour)` calls (the water plugins' time and wind integral) run on it; `seconds`, the page's clock, stays for the lamps, the terrain's rain, the mist, the splashes, the post effects and the bump's scroll.

- [ ] **Step 1: Write the failing test**

`client/test/game/oceanWindSea.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WIND_SEA_AFTERNOON, WIND_SEA_DAWN, WIND_SEA_GAMMA, WIND_SEA_OFFSHORE_CUT, WIND_SEA_SPREAD, WIND_SEA_U_PER_WIND,
  WIND_SEA_U_REF, hourFactor, sharedSeconds, windSeaStateFor,
} from "../../src/game/oceanWindSea.js";
import { whitecapCoverage } from "../../src/game/oceanPhysics.js";
import { FixedStepAccumulator } from "../../src/game/loop.js";
import { TICK_DT } from "../../src/sim/constants.js";

describe("hourFactor", () => {
  it("calms the dawn, raises the afternoon's sea breeze and leaves the rest of the day alone", () => {
    expect([WIND_SEA_DAWN, WIND_SEA_AFTERNOON]).toEqual([0.4, 1.25]);
    for (const h of [5, 6, 7.5, 8]) expect(hourFactor(h)).toBeCloseTo(0.4, 12);
    for (const h of [13, 15, 18]) expect(hourFactor(h)).toBeCloseTo(1.25, 12);
    for (const h of [0, 3, 4, 9, 10, 12, 19, 22, 23.99]) expect(hourFactor(h)).toBe(1);
  });

  it("turns over a smoothstep shoulder an hour wide either side", () => {
    expect(hourFactor(4.5)).toBeCloseTo(0.7, 12);
    expect(hourFactor(8.5)).toBeCloseTo(0.7, 12);
    expect(hourFactor(12.5)).toBeCloseTo(1.125, 12);
    expect(hourFactor(18.5)).toBeCloseTo(1.125, 12);
    expect(hourFactor(12.25)).toBeCloseTo(1.0390625, 12);
  });

  it("is continuous through the day and wraps at midnight", () => {
    let step = 0;
    for (let i = 1; i <= 24000; i++) step = Math.max(step, Math.abs(hourFactor(i / 1000) - hourFactor((i - 1) / 1000)));
    expect(step).toBeLessThan(0.001);
    expect(step).toBeGreaterThan(0.0008);
    expect(hourFactor(30)).toBeCloseTo(0.4, 12);
    expect(hourFactor(-9)).toBeCloseTo(1.25, 12);
  });
});

describe("windSeaStateFor", () => {
  it("a clear noon: 3 m/s, a small sea and no whitecaps", () => {
    expect(WIND_SEA_U_PER_WIND).toBe(12);
    const s = windSeaStateFor(0.25, [1, 0], 12);
    expect(s.u10).toBeCloseTo(3, 12);
    expect(s.hs).toBeCloseTo(0.25688073394495414, 12);
    expect(s.tp).toBeCloseTo(2.486263394744039, 12);
    expect(s.coverage).toBe(0);
    expect(s.loopScale).toBeCloseTo(0.09, 12);
    expect(s.loopRate).toBeCloseTo(3.3333333333333335, 12);
  });

  it("a rainy afternoon: 13.5 m/s, a storm sea and its whitecaps", () => {
    const s = windSeaStateFor(0.9, [1, 0], 15);
    expect(s.u10).toBeCloseTo(13.5, 12);
    expect(s.hs).toBeCloseTo(5.201834862385321, 12);
    expect(s.tp).toBeCloseTo(11.188185276348175, 12);
    expect(s.coverage).toBe(whitecapCoverage(13.5));
    expect(s.coverage).toBeGreaterThan(0.01);
    expect(s.loopScale).toBeCloseTo(1.8225, 12);
    expect(s.loopRate).toBeCloseTo(0.7407407407407407, 12);
  });

  it("a dawn: the same wind at 0.4 of its noon speed", () => {
    expect(windSeaStateFor(0.53, [1, 0], 6).u10).toBeCloseTo(2.544, 12);
    expect(windSeaStateFor(0.53, [1, 0], 6).u10).toBeCloseTo(0.4 * windSeaStateFor(0.53, [1, 0], 12).u10, 12);
  });

  it("keeps the whole sea near shore under an onshore wind, a fetch-limited fraction under an offshore one", () => {
    expect(WIND_SEA_OFFSHORE_CUT).toBe(0.3);
    const onshore = windSeaStateFor(0.6, [1, 0], 12);
    expect(onshore.onshore).toBe(1);
    expect(onshore.nearShore).toBe(1);
    const offshore = windSeaStateFor(0.6, [-1, 0], 12);
    expect(offshore.onshore).toBe(-1);
    expect(offshore.nearShore).toBe(0.3);
    const along = windSeaStateFor(0.6, [0, 1], 12);
    expect(along.nearShore).toBeCloseTo(0.5464, 12);
    // The direction is made a unit vector first.
    const slanted = windSeaStateFor(0.6, [3, 4], 12);
    expect(slanted.dir[0]).toBeCloseTo(0.6, 12);
    expect(slanted.dir[1]).toBeCloseTo(0.8, 12);
    expect(slanted.onshore).toBeCloseTo(0.6, 12);
    expect(slanted.nearShore).toBe(1);
  });

  it("stays finite in still air", () => {
    const s = windSeaStateFor(0, [0, 0], 12);
    expect([s.u10, s.hs, s.coverage, s.loopScale]).toEqual([0, 0, 0, 0]);
    expect(s.dir).toEqual([1, 0]);
    expect(s.loopRate).toBe(20);
    expect(s.tp).toBeCloseTo(0.4143772324573398, 12);
    expect([WIND_SEA_SPREAD, WIND_SEA_GAMMA, WIND_SEA_U_REF]).toEqual([10, 3.3, 10]);
  });
});

describe("sharedSeconds", () => {
  it("is the tick and its fraction in seconds, the same either side of a tick", () => {
    expect(sharedSeconds(0, 0)).toBe(0);
    expect(sharedSeconds(60, 0)).toBeCloseTo(1, 12);
    expect(sharedSeconds(7200, 0.5)).toBeCloseTo(120.00833333333333, 9);
    expect(sharedSeconds(10, 1)).toBe(sharedSeconds(11, 0));
    expect(sharedSeconds(5, -0.5)).toBe(sharedSeconds(5, 0));
    expect(sharedSeconds(5, 1.5)).toBe(sharedSeconds(6, 0));
  });

  it("advances exactly with the frames the fixed step runs, never backward", () => {
    const acc = new FixedStepAccumulator();
    let tick = 0;
    let prev = sharedSeconds(tick, acc.alpha);
    let elapsed = 0;
    for (let i = 0; i < 3000; i++) {
      // Frames from 4 to 40 ms, unevenly.
      const dt = 0.004 + 0.036 * ((i * 0.618033988749895) % 1);
      tick += acc.advance(dt);
      elapsed += dt;
      const now = sharedSeconds(tick, acc.alpha);
      expect(now).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(now - prev - dt)).toBeLessThan(1e-9);
      prev = now;
    }
    expect(prev).toBeCloseTo(elapsed, 6);
    // A backgrounded tab's long frame drops ticks; the clock still only moves forward.
    tick += acc.advance(2);
    const after = sharedSeconds(tick, acc.alpha);
    expect(after - prev).toBeGreaterThan(14 * TICK_DT);
    expect(after - prev).toBeLessThanOrEqual(15 * TICK_DT + 1e-12);
  });
});
```

`client/test/game/renderer.test.ts` — a behavioural test after `renderer.wind()`'s, old (line 377):

```ts
describe("the renderer's engine", () => {
```

new:

```ts
describe("the sea's clock", () => {
  it("runs the wind on the simulation's tick and its fraction, unless a scene hands in its own clock", () => {
    const canvas = {} as unknown as HTMLCanvasElement;
    const state = { ...windTestState(windTestPlayer(1)), tick: 7200 };
    const shared = createRenderer(canvas, EMPTY_LEVEL, null);
    try {
      shared.sync(state, 1, 0.5);
      // (7200 + 0.5) ticks at 60 Hz: the same on every peer at that tick.
      expect(shared.wind().time).toBeCloseTo(120.00833333333333, 9);
      expect(shared.wind().dirX).toBeCloseTo(0.335780920274179, 9);
      expect(shared.wind().dirZ).toBeCloseTo(0.9419401114613526, 9);
    } finally {
      shared.dispose();
    }
    const stepped = createRenderer(canvas, EMPTY_LEVEL, null, { clock: () => 5000 });
    try {
      stepped.sync(state, 1, 0.5);
      expect(stepped.wind().time).toBeCloseTo(5, 9);
    } finally {
      stepped.dispose();
    }
  });
});

describe("the renderer's engine", () => {
```

and the source pin at the end of `describe("world shell wiring")`, old (lines 642–644):

```ts
    expect(src.match(/water\?\.setRain\(/g)).toHaveLength(1);
  });
});
```

new:

```ts
    expect(src.match(/water\?\.setRain\(/g)).toHaveLength(1);
  });

  it("runs the sea's waves and the wind on the shared seconds, and keeps the page's clock for everything else", () => {
    expect(src).toContain('import { sharedSeconds } from "./oceanWindSea.js";');
    expect(src).toContain("update(camX: number, camZ: number, seconds: number, hour?: number): void;");
    const syncBlock = slice("sync(state, localId, alpha, frame = { dt: 0, sprinting: false }) {", "hasWildlife: wildlife !== null,");
    expect(syncBlock).toContain("const seconds = clock() / 1000;");
    expect(syncBlock).toContain(
      "const oceanSeconds = options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha);",
    );
    expect(syncBlock).toContain("wind = windRecordUnder(weather, oceanSeconds, windOverride ?? undefined);");
    const freecamBranch = slice("if (freecam !== null) {", "const local = state.players.get(localId);");
    const playerBranch = slice("const local = state.players.get(localId);", "resize() {");
    expect(freecamBranch.match(/water\?\.update\(/g)).toHaveLength(1);
    expect(playerBranch.match(/water\?\.update\(/g)).toHaveLength(1);
    expect(freecamBranch).toContain("water?.update(freecam.x, freecam.z, oceanSeconds, lighting.hour);");
    expect(playerBranch).toContain("water?.update(local.pos.x, local.pos.z, oceanSeconds, lighting.hour);");
    // The declaration, the wind and the two water updates: nothing else in the frame moves clock.
    expect(syncBlock.match(/oceanSeconds/g)).toHaveLength(4);
    expect(syncBlock).toContain("const lampState = lampUnder(weather, seconds);");
    expect(syncBlock).toContain('setTerrainRain(scene, terrainMaterialFor(scene, "terrain"), weather.rain, seconds);');
    expect(syncBlock.match(/mist\?\.update\([^;]*, wind, seconds\);/g)).toHaveLength(2);
    expect(syncBlock.match(/rainSplash\?\.update\([^;]*, seconds\);/g)).toHaveLength(2);
  });
});
```

`client/test/architecture.test.ts` — in `BABYLON_FREE_FILES`, old:

```ts
      join(SRC, "game", "lensParams.ts"),
```

new:

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "oceanWindSea.ts"),
```

(Anchored on the `lensParams.ts` line, which the other Babylon-free additions leave in place; the list's order does not matter.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanWindSea.test.ts test/game/renderer.test.ts test/architecture.test.ts`
Expected: FAIL with "Cannot find module '../../src/game/oceanWindSea.js'"; in `renderer.test.ts` the clock test fails with "expected … to be close to 120.00833333333333" (the wind runs on `performance.now`) and the source pin with `expected … to contain 'import { sharedSeconds } from "./oceanWindSea.js";'`

- [ ] **Step 3: Implement**

`client/src/game/oceanWindSea.ts`:

```ts
/**
 * The wind sea's state, and the clock the sea keeps. Babylon-free (on
 * BABYLON_FREE_FILES) and render-side: every input is something each client
 * already computes from shared state (the weather, the hour, the tick), so
 * nothing new crosses the network.
 *
 * The wind sea is a fully developed spectrum for U₁₀ = the game's wind speed ×
 * WIND_SEA_U_PER_WIND × the hour's factor (glassy at dawn, a sea breeze in the
 * afternoon): Hs ≈ 0.28 U²/g, fp ≈ 0.123 g/U. Blowing off the land it is held
 * to a fetch-limited fraction near shore. Whitecaps cover Callaghan's fraction.
 *
 * Convention: the sea lies toward −x and the land toward +x, so a wind blowing
 * toward +x (dir.x > 0) blows onshore.
 */
import { TICK_DT } from "../sim/constants.js";
import { OCEAN_G, whitecapCoverage } from "./oceanPhysics.js";
import { WIND_SEA_FP_COEFF, WIND_SEA_HS_COEFF } from "./oceanSpectrum.js";

/** The spectrum's own constants, defined beside it (`windSeaH0` reads them) and
 * importable from here too: Hs ≈ WIND_SEA_HS_COEFF·U²/g and fp ≈
 * WIND_SEA_FP_COEFF·g/U fully developed, its spreading s and its γ. */
export { WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA } from "./oceanSpectrum.js";

/** m/s of U₁₀ per unit of the game's 0..1 wind speed, as `roughnessFor` reads it. */
export const WIND_SEA_U_PER_WIND = 12;
/** The hour's factor on the wind: the dawn calm and the afternoon's sea breeze. */
export const WIND_SEA_DAWN = 0.4;
export const WIND_SEA_AFTERNOON = 1.25;
/** The hours (h) each holds fully, and the width (h) of the shoulder either side. */
export const WIND_SEA_DAWN_HOURS: readonly [number, number] = [5, 8];
export const WIND_SEA_AFTERNOON_HOURS: readonly [number, number] = [13, 18];
export const WIND_SEA_SHOULDER = 1;
/** What is left of the wind sea near shore under a wind off the land. */
export const WIND_SEA_OFFSHORE_CUT = 0.3;
/** The wind (m/s) the medium tier's loop is computed at. */
export const WIND_SEA_U_REF = 10;
/** The least wind (m/s) the period and the loop's rate are taken at, so a still sea's stay finite. */
export const WIND_SEA_U_FLOOR = 0.5;

export type WindSeaState = {
  u10: number; dir: [number, number]; hs: number; tp: number; onshore: number;
  /** WIND_SEA_OFFSHORE_CUT .. 1 by how onshore the wind blows. */
  nearShore: number;
  /** whitecapCoverage(u10). */
  coverage: number;
  /** (u10 / WIND_SEA_U_REF)²: the medium loop's lengths and heights. */
  loopScale: number;
  /** WIND_SEA_U_REF / u10, u10 floored at WIND_SEA_U_FLOOR: the loop's time rate. */
  loopRate: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 1 inside [from, to], 0 a shoulder's width outside it, smoothstep between. */
function held(hour: number, [from, to]: readonly [number, number]): number {
  return smoothstep(from - WIND_SEA_SHOULDER, from, hour) * (1 - smoothstep(to, to + WIND_SEA_SHOULDER, hour));
}

/** The hour's factor on the wind: WIND_SEA_DAWN through dawn, WIND_SEA_AFTERNOON through the afternoon, 1 otherwise. */
export function hourFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return (
    1 +
    (WIND_SEA_DAWN - 1) * held(h, WIND_SEA_DAWN_HOURS) +
    (WIND_SEA_AFTERNOON - 1) * held(h, WIND_SEA_AFTERNOON_HOURS)
  );
}

/** The wind sea for the game's wind (0..1, and the direction it blows toward) at an hour. */
export function windSeaStateFor(wind01: number, dir: [number, number], hour: number): WindSeaState {
  const u10 = Math.max(0, wind01) * WIND_SEA_U_PER_WIND * hourFactor(hour);
  const len = Math.hypot(dir[0], dir[1]);
  const unit: [number, number] = len > 0 ? [dir[0] / len, dir[1] / len] : [1, 0];
  const onshore = unit[0];
  const floored = Math.max(u10, WIND_SEA_U_FLOOR);
  return {
    u10,
    dir: unit,
    hs: (WIND_SEA_HS_COEFF * u10 * u10) / OCEAN_G,
    tp: floored / (WIND_SEA_FP_COEFF * OCEAN_G),
    onshore,
    nearShore: WIND_SEA_OFFSHORE_CUT + (1 - WIND_SEA_OFFSHORE_CUT) * smoothstep(-0.2, 0.3, onshore),
    coverage: whitecapCoverage(u10),
    loopScale: (u10 / WIND_SEA_U_REF) * (u10 / WIND_SEA_U_REF),
    loopRate: WIND_SEA_U_REF / floored,
  };
}

/**
 * The sea's seconds: the simulation's tick and the frame's fraction of the
 * next, `alpha` (the fixed-step accumulator's leftover over TICK_DT, 0 to 1,
 * clamped there). The tick advances as the leftover wraps, so the sum is
 * continuous and never runs backward across a tick; every peer's tick is the
 * host's to within its prediction lead.
 */
export function sharedSeconds(tick: number, alpha: number): number {
  return (tick + Math.min(1, Math.max(0, alpha))) * TICK_DT;
}
```

`client/src/game/renderer.ts`, six edits, each old → new:

Edit 1, the import (line 33) — old:

```ts
import { windRecordUnder, type WindRecord } from "./windParams.js";
```

new:

```ts
import { windRecordUnder, type WindRecord } from "./windParams.js";
import { sharedSeconds } from "./oceanWindSea.js";
```

Edit 2, the `Water` type (line 660) — old:

```ts
  update(camX: number, camZ: number, seconds: number): void;
```

new:

```ts
  /** Per frame: the camera's place, the sea's shared seconds and the hour (12 when absent), which the sea's waves read. */
  update(camX: number, camZ: number, seconds: number, hour?: number): void;
```

Edit 3, `sync`, the clock (lines 1858–1859) — old:

```ts
      const seconds = clock() / 1000;
      const lampState = lampUnder(weather, seconds);
```

new:

```ts
      const seconds = clock() / 1000;
      // The sea's time, and the wind's: the simulation's tick and this frame's
      // fraction of the next, so every peer's waves break together and its
      // wind sea blows the same way. A scene that hands in its own clock keeps it.
      const oceanSeconds = options.clock !== undefined ? seconds : sharedSeconds(state.tick, alpha);
      const lampState = lampUnder(weather, seconds);
```

Edit 4, `sync`, the wind record (line 1864) — old:

```ts
      wind = windRecordUnder(weather, seconds, windOverride ?? undefined);
```

new:

```ts
      wind = windRecordUnder(weather, oceanSeconds, windOverride ?? undefined);
```

Edit 5, `sync`, the freecam branch (line 1929) — old:

```ts
        water?.update(freecam.x, freecam.z, seconds);
```

new:

```ts
        water?.update(freecam.x, freecam.z, oceanSeconds, lighting.hour);
```

Edit 6, `sync`, the player branch (line 1970) — old:

```ts
        water?.update(local.pos.x, local.pos.z, seconds);
```

new:

```ts
        water?.update(local.pos.x, local.pos.z, oceanSeconds, lighting.hour);
```

Nothing else in the `sync` block changes clock.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanWindSea.test.ts test/game/renderer.test.ts test/game/windParams.test.ts test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/oceanWindSea.ts client/src/game/renderer.ts client/test/game/oceanWindSea.test.ts client/test/game/renderer.test.ts`
Expected: PASS (10 tests in `oceanWindSea.test.ts`; `renderer.test.ts` gains two and its others still pass)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanWindSea.ts client/src/game/renderer.ts client/test/game/oceanWindSea.test.ts client/test/game/renderer.test.ts client/test/architecture.test.ts
git commit -F - <<'EOF'
feat: the sea's shared clock and the wind sea's state

## What

The waves and the wind now run on the simulation's tick and the frame's fraction of the next, so every peer sees the same wave break and its wind sea blows the same way; a scene that hands the renderer its own clock keeps it, and everything else keeps the page's clock. The wind sea's state follows the weather and the hour: U₁₀ from the game's wind, calm at dawn and freshened by the afternoon's sea breeze, a fully developed height and period, held small near shore under a wind off the land, and Callaghan's whitecap cover.

## How

- `client/src/game/oceanWindSea.ts` — `hourFactor`, `windSeaStateFor`, `sharedSeconds`
- `client/src/game/renderer.ts` — `sync` computes the shared seconds and runs the wind record and the water's update on them, with the hour; `Water.update` takes the hour
- `client/test/game/oceanWindSea.test.ts` — the hour's shoulders, a clear noon, a rainy afternoon, a dawn, onshore against offshore, still air, the clock against the fixed step
- `client/test/game/renderer.test.ts` — the wind's time on a tick and under a scene's clock; the sync block pinned by its source
- `client/test/architecture.test.ts` — the module joins the Babylon-free list

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 10: The ocean's plumbing

**Files:**
- Create: `client/src/game/oceanRender.ts`
- Create: `client/src/game/shaders/ocean.vertex.fx`, `client/src/game/shaders/oceanDisplace.vertex.fx`, `client/src/game/shaders/ocean.fragment.fx`
- Create: `client/test/setup/nullEngineArrays.ts`
- Modify: `client/src/game/waterPlugin.ts:9-10, 21-30, 58-66, 77-79, 103-104, 118-126, 141-157, 194-195, 198-203`
- Modify: `client/src/game/renderer.ts:77, 853, 999, 1038, 1049-1051, 1060-1061` (`createWater` only; line numbers as on main at 9edee7e, which Tasks 4 and 9 shift; every edit is anchored on its text, which neither changes)
- Modify: `client/vite.config.ts:69-70`
- Modify (comments only, the mocks kept): `client/test/game/groundMaps.test.ts:51-52`, `client/test/game/rendererSwap.test.ts:5-11`, `client/test/game/rendererCleanup.test.ts:3-9`, `client/test/game/renderer.test.ts:13-19`, `client/test/game/probeScene.test.ts:3-9`, `client/test/game/tierDeterminism.test.ts:3-9`, `client/test/game/brdfTeardown.test.ts:3-4`, `client/test/game/rendererStart.test.ts:3-4`, `client/test/game/swapRelease.test.ts:3-4`, `client/test/game/rendererTeardown.test.ts:4-5`, `client/test/game/pipelineScope.test.ts:5-7`, `client/test/game/terrainTexture.test.ts:31-33`, `client/test/game/helpers/pluginText.ts:51-52`
- Test: `client/test/game/oceanRender.test.ts` (create), `client/test/game/waterPlugin.test.ts:11-13, 36-46, 59-65, 76-78` and appended, `client/test/game/waterMesh.test.ts:29` and two tests before "hands the rain to every plugin", `client/test/game/interStage.test.ts:31, 35` and appended

**Interfaces:**
- Consumes:
  - Task 4: the sea's ring meshes with the attributes `oceanMorph` (float) and `oceanCoarse` (vec2), world-space vertices and no transform.
  - Task 6 (`client/src/game/oceanSwell.ts`): `SWELL_COMPONENTS` (12), `SWELL_COMPONENTS_LOW` (8).
  - Task 7 (`client/src/game/oceanTables.ts`): `coastProfilesFor(seed: number): CoastProfiles`, `writeCoastRow(tables: OceanTables, profiles: CoastProfiles, coastCentreZ: number): void`, `OCEAN_COAST_STEP` (4), `OCEAN_COAST_RECENTRE` (1000). The atlas's data is `buildOceanTables`'s output, as Task 8's field holds it (`field.tables`): one table for the CPU's `swellAt` and the GPU, built once.
  - Task 8 (`client/src/game/oceanWaves.ts`): `oceanFieldFor(seed: number, count?: number): OceanField` (`tables` about the cove's z0, `components`, `count`, `tp`, `hs`, `travel`, `tips`, possibly `[]`), `swellPhases(field: OceanField, seconds: number): Float32Array`.
  - Task 9 (`client/src/game/oceanWindSea.ts`): `windSeaStateFor(wind01: number, dir: [number, number], hour: number): WindSeaState`. In `renderer.ts` after Task 9: the `Water` type's `update(camX, camZ, seconds, hour?: number)` and both `water?.update(…, oceanSeconds, lighting.hour)` calls, untouched here.
  - `client/test/game/helpers/webgpuProcessing.ts`: `webgpuProcessingEngine()`, `drawnEffect(mesh)`, `probeReady(scene)`, `stageBindings(effect)`, `type ProcessedEffect` (tests).
- Produces:
  - `client/src/game/waterPlugin.ts`:
    - `export type OceanBinding` (Shared definitions §6): `atlas`, `windDisp`, `windSlope: BaseTexture`; `phases: Float32Array` (12); `swell`, `tips`, `coast`, `wind`, `windDir: [number, number, number, number]`.
    - `WaterPlugin.ocean: OceanBinding | null` (a getter and setter; a change between null and an ocean marks the defines dirty). Define `OCEAN` = `ocean !== null`; the plugin's define list is `{ WATER, OCEAN }`.
    - Uniforms, always declared, in the `ubo` list after `waterRain` and in both the `fragment` and the new `vertex` string (the vertex stage's declarations where uniform buffers are not supported), bound as `updateFloat4` on every draw, zeros without an ocean: `vec4 oceanPhase0, oceanPhase1, oceanPhase2` (phases 0–3, 4–7, 8–11), `oceanSwell` (ux, uz, tp, hs), `oceanTips` (x0, z0, x1, z1), `oceanCoast` (coastOriginZ, 4, count, windMode), `oceanWind` (hs × nearShore, loopScale, loopTime, coverage), `oceanWindDir` (dirX, dirZ, u10, 0).
    - Samplers, listed always (`getSamplers` → `waterBedHeight, waterScene, waterDepth, oceanAtlas, oceanWindDisp, oceanWindSlope`) and bound on every draw: `oceanAtlas` → `ocean.atlas`, else the bed texture (as `waterScene` and `waterDepth` fall back today); `oceanWindDisp`, `oceanWindSlope` → the ocean's, else `oceanArrayPlaceholder(scene)`.
    - `export function oceanArrayPlaceholder(scene: Scene): BaseTexture`: a 1×1 RGBA unsigned-byte 2D array of one zero layer, nearest, made once per scene (a `WeakMap`), made again if disposed; WebGPU checks a binding's view dimension, so no 2D texture can stand in for an array.
    - Attributes: `bedDepth`, and with an ocean `oceanMorph`, `oceanCoarse`.
    - Hooks: `CUSTOM_VERTEX_DEFINITIONS` = `water.vertex.fx` + `ocean.vertex.fx`; `CUSTOM_VERTEX_UPDATE_POSITION` = `oceanDisplace.vertex.fx` (new); `CUSTOM_FRAGMENT_DEFINITIONS` = `water.fragment.fx` + `ocean.fragment.fx` (each water file ends in a newline: pinned). The other hooks unchanged.
  - The three `.fx` files: each is one `#ifdef OCEAN` … `#endif` block, its first and last lines, comments inside it (pinned: a lake's compiled WebGPU stages are byte-identical with and without this change's GLSL). `ocean.vertex.fx`: `attribute float oceanMorph; attribute vec2 oceanCoarse; uniform highp sampler2D oceanAtlas; uniform highp sampler2DArray oceanWindDisp; varying vec2 vOceanXZ;`. `ocean.fragment.fx`: `uniform highp sampler2D oceanAtlas; uniform highp sampler2DArray oceanWindDisp; uniform highp sampler2DArray oceanWindSlope; varying vec2 vOceanXZ;`. `oceanDisplace.vertex.fx`: `vOceanXZ = positionUpdated.xz;`, `positionUpdated` untouched. `highp` on every sampler: GLSL ES 3.00 gives `sampler2DArray` no default precision, and the atlas holds metres and radians in the thousands. Tasks 11 to 13 add their functions inside these blocks and make the displace hook move `positionUpdated` (to p′ = p − `oceanMorph`·`oceanCoarse` and on, Task 4).
  - `client/src/game/oceanRender.ts`: the shared definitions' `type Ocean` and `createOcean(scene: Scene, seed: number, tier: QualityTier): Ocean`; `export const OCEAN_NO_TIP = 1e9` and `export function oceanTipsFor(tips: readonly (readonly [number, number])[]): [number, number, number, number]` (an absent tip at (1e9, 0): the swell travels toward +x, so every point is up-swell of it and Task 8's `on` step is 0 there: shelter 1). `createOcean` takes `oceanFieldFor(seed, 8)` on low and `oceanFieldFor(seed, 12)` otherwise; writes the coastline row about z = 0 (`coastOriginZ` −2,080) into `field.tables` and uploads the tables as `atlas`, a `RawTexture` RGBA32F of 1,040 × 28, nearest, clamped, no mips, named `oceanAtlas`; `windMode` 0 and `windDisp` = `windSlope` = the scene's array placeholder on every tier (Task 13 fills them). `update(camX, camZ, seconds, wind01, windDir, hour)`: when |camZ − the row's last centre| > 1,000 m, `writeCoastRow` about camZ, `atlas.update(tables.data)` (466 KB, the whole atlas) and `coast[0]` = the new origin; then `phases` ← `swellPhases(field, seconds)`, `wind` ← (hs × nearShore, loopScale, 0, coverage) and `windDir` ← (dir.x, dir.z, u10, 0) from `windSeaStateFor(wind01, windDir, hour)`, all in place. `wind[2]`, the loop's time, stays 0: it is the medium loop's clock, Task 13's. `swell` = (travel.x, travel.z, tp, hs), `tips` = `oceanTipsFor(field.tips)`, `coast[1..3]` = (4, count, 0), fixed. `bind(plugin)` sets `plugin.ocean` to the one binding, whose values `update` moves. `dispose()` disposes the atlas only (the placeholder is the scene's).
  - `client/src/game/renderer.ts`, `createWater`: the sea's ocean made and bound to the sea's plugin before any draw; `update(camX, camZ, seconds, hour = 12)` calls `ocean.update(camX, camZ, seconds, wind01, dir, hour)` after the plugins advance, with the wind `setWind` last had (0 and (1, 0) before the first); `dispose` disposes it. The lakes' plugins never get one.
  - Test support: `client/test/setup/nullEngineArrays.ts`, loaded before every client test file (`setupFiles` in `client/vite.config.ts`), gives NullEngine a raw 2D array texture maker that does what its `createRawTexture` does (an internal texture holding the data, never uploaded, never ready). Babylon's NullEngine has only WebGL's, which reads a GL context it does not have, and every renderer built under NullEngine now makes the sea's array placeholder. The suites that mock `groundMaps.js` or stub its loader keep their mocks, since the real loader fetches and decodes the layer images; their comments, which gave NullEngine's missing array maker as the reason, are corrected to that one (13 comments).
  - Counts on WebGPU (Babylon's processing under NullEngine, every tier): the sea's material writes 7 vertex outputs (`vMainUV1`, `vPositionW`, `vNormalW`, `vFogDistance`, `vBedDepth`, `vWaterViewDepth`, `vOceanXZ`; 6 before) and its two-sided fragment reads `front_facing`: 8 of the 19 inter-stage variables. Textures and samplers: 2 and 2 in the vertex stage (`oceanAtlas`, `oceanWindDisp`), 10 and 10 in the fragment stage, of 16. `WaterPlugin` stays `MATERIALPLUGIN_19`; no plugin class is added (13 in `src/`).

- [ ] **Step 1: Write the failing test**

The suite's support first. Create `client/test/setup/nullEngineArrays.ts`:

```ts
/**
 * Every suite's NullEngine can make a raw 2D array texture. Babylon's
 * NullEngine makes a raw 2D texture without a GPU (`createRawTexture`: an
 * internal texture that holds the data, never uploaded, so never ready), but
 * its 2D array maker is WebGL's, which reads a GL context NullEngine does not
 * have. The water material binds one (`oceanArrayPlaceholder`) wherever a
 * water material is made, so the maker here does for an array what
 * `createRawTexture` does for a 2D texture. Loaded before every test file
 * (`vite.config.ts`, `setupFiles`).
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { InternalTexture, InternalTextureSource } from "@babylonjs/core/Materials/Textures/internalTexture.js";

type ArrayMaker = {
  createRawTexture2DArray(
    data: ArrayBufferView | null, width: number, height: number, depth: number, format: number,
    generateMipMaps: boolean, invertY: boolean, samplingMode: number, compression?: string | null, textureType?: number,
  ): InternalTexture;
  updateRawTexture2DArray(texture: InternalTexture, data: ArrayBufferView | null, format: number, invertY: boolean, compression?: string | null, textureType?: number): void;
};

const engine = NullEngine.prototype as unknown as ArrayMaker;

engine.createRawTexture2DArray = function (this: NullEngine, data, width, height, depth, format, generateMipMaps, invertY, samplingMode, compression = null, textureType = 0) {
  const texture = new InternalTexture(this, InternalTextureSource.Raw2DArray);
  texture.baseWidth = width;
  texture.baseHeight = height;
  texture.baseDepth = depth;
  texture.width = width;
  texture.height = height;
  texture.depth = depth;
  texture.format = format;
  texture.type = textureType;
  texture.generateMipMaps = generateMipMaps;
  texture.samplingMode = samplingMode;
  texture.invertY = invertY;
  texture.is2DArray = true;
  texture._compression = compression;
  texture._bufferView = data;
  return texture;
};

engine.updateRawTexture2DArray = function (texture, data, format, invertY, compression = null, textureType = 0) {
  texture._bufferView = data;
  texture.format = format;
  texture.invertY = invertY;
  texture._compression = compression;
  texture.type = textureType;
};
```

`client/vite.config.ts`, one edit — old:

```ts
    environment: "node",
    include: ["test/**/*.test.ts"],
```

new:

```ts
    environment: "node",
    include: ["test/**/*.test.ts"],
    // NullEngine given a raw 2D array texture maker (the file says why).
    setupFiles: ["test/setup/nullEngineArrays.ts"],
```

Create `client/test/game/oceanRender.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { OCEAN_NO_TIP, createOcean, oceanTipsFor } from "../../src/game/oceanRender.js";
import { attachWater, oceanArrayPlaceholder } from "../../src/game/waterPlugin.js";
import { WATER_ROWS } from "../../src/game/waterShading.js";
import { coastProfilesFor, writeCoastRow } from "../../src/game/oceanTables.js";
import { oceanFieldFor, swellPhases } from "../../src/game/oceanWaves.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import { seedFromToken } from "../../src/game/seed.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");
const SEED = seedFromToken("atmo");

/** The data a raw texture was made or last updated with: NullEngine keeps it on the internal texture. */
const uploaded = (texture: Texture): Float32Array =>
  (texture.getInternalTexture() as unknown as { _bufferView: Float32Array })._bufferView;

describe("the sea's waves as the water material reads them (createOcean)", () => {
  let engine: NullEngine;
  afterEach(() => engine?.dispose());

  it("uploads the swell's tables as one RGBA32F texture, 1,040 by 28, nearest and clamped", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const ocean = createOcean(scene, SEED, "medium");
    expect(ocean.atlas.getSize()).toEqual({ width: 1040, height: 28 });
    const internal = ocean.atlas.getInternalTexture()!;
    expect(internal.type).toBe(Constants.TEXTURETYPE_FLOAT);
    expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(internal.generateMipMaps).toBe(false);
    expect(ocean.atlas.samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
    expect(ocean.atlas.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(ocean.atlas.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    // the tables as the swell's evaluation reads them, the coastline row about z = 0
    const reference = oceanFieldFor(SEED, 12).tables;
    writeCoastRow(reference, coastProfilesFor(SEED), 0);
    const data = uploaded(ocean.atlas);
    expect(data.length).toBe(116480);
    expect(reference.coastOriginZ).toBe(-2080);
    expect(Array.from(data)).toEqual(Array.from(reference.data));
    ocean.dispose();
  }, timeLimit(30_000));

  it("draws the wind sea by its normals on every tier here, its textures the scene's one 1×1 array", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    for (const tier of ["low", "medium", "high"] as const) {
      const ocean = createOcean(scene, SEED, tier);
      expect(ocean.windMode).toBe(0);
      expect(ocean.windDisp).toBe(oceanArrayPlaceholder(scene));
      expect(ocean.windSlope).toBe(oceanArrayPlaceholder(scene));
      ocean.dispose();
    }
    const placeholder = oceanArrayPlaceholder(scene);
    expect(placeholder.is2DArray).toBe(true);
    expect(placeholder.getSize()).toEqual({ width: 1, height: 1 });
    expect(placeholder.getInternalTexture()!.depth).toBe(1);
    // disposing an ocean leaves the scene's placeholder to the scene
    expect(placeholder.getInternalTexture()).not.toBeNull();
  }, timeLimit(30_000));

  it("binds itself to a water plugin: its OCEAN define on, the tier's count of components, the coastline row's origin and step", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    for (const [tier, count] of [["low", 8], ["medium", 12], ["high", 12]] as const) {
      const plugin = attachWater(new PBRMaterial(`sea_${tier}`, scene), WATER_ROWS.sea);
      const ocean = createOcean(scene, SEED, tier);
      ocean.bind(plugin);
      const binding = plugin.ocean!;
      expect(binding.atlas).toBe(ocean.atlas);
      expect(binding.windDisp).toBe(ocean.windDisp);
      expect(binding.windSlope).toBe(ocean.windSlope);
      expect(binding.coast).toEqual([-2080, 4, count, 0]);
      const field = oceanFieldFor(SEED, count);
      expect(binding.swell).toEqual([field.travel[0], field.travel[1], field.tp, field.hs]);
      expect(binding.tips).toEqual(oceanTipsFor(field.tips));
      const defines: Record<string, unknown> = {};
      plugin.prepareDefines(defines as never, scene, undefined as never);
      expect(defines.OCEAN).toBe(true);
      ocean.dispose();
    }
  }, timeLimit(30_000));

  it("moves the swell's phases, the wind sea and its direction each frame, from the shared seconds, the wind and the hour", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
    const ocean = createOcean(scene, SEED, "medium");
    ocean.bind(plugin);
    const binding = plugin.ocean!;
    const field = oceanFieldFor(SEED, 12);
    for (const [seconds, wind01, dir, hour] of [[0, 0.25, [1, 0], 12], [3600.25, 0.9, [0.6, -0.8], 15], [12.5, 0.53, [-1, 0], 6]] as const) {
      ocean.update(0, 0, seconds, wind01, [dir[0], dir[1]], hour);
      expect(Array.from(binding.phases)).toEqual(Array.from(swellPhases(field, seconds)));
      const sea = windSeaStateFor(wind01, [dir[0], dir[1]], hour);
      expect(binding.wind).toEqual([sea.hs * sea.nearShore, sea.loopScale, 0, sea.coverage]);
      expect(binding.windDir).toEqual([sea.dir[0], sea.dir[1], sea.u10, 0]);
    }
    // the binding is the plugin's, written in place: no frame needs a new bind
    expect(plugin.ocean).toBe(binding);
    ocean.dispose();
  }, timeLimit(30_000));

  it("writes the coastline row again round the camera once it is more than 1,000 m along z from the last, and uploads it", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
    const ocean = createOcean(scene, SEED, "medium");
    ocean.bind(plugin);
    const upload = vi.spyOn(ocean.atlas, "update");
    const frame = (x: number, z: number): void => ocean.update(x, z, 1, 0.25, [1, 0], 12);
    // across x does not count, and 1,000 m along z is not past it
    frame(5000, 0);
    frame(0, 1000);
    frame(0, -1000);
    expect(upload).not.toHaveBeenCalled();
    expect(plugin.ocean!.coast[0]).toBe(-2080);
    // 1,200 m: the row about z = 1,200, 4,160 m long
    frame(0, 1200);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(plugin.ocean!.coast[0]).toBe(-880);
    const profiles = coastProfilesFor(SEED);
    const data = upload.mock.calls[0]![0] as Float32Array;
    const coastTexel = (j: number): number => data[(27 * 1040 + j) * 4] as number;
    expect(coastTexel(0)).toBe(Math.fround(profiles.coastlineX(-880)));
    expect(coastTexel(1039)).toBe(Math.fround(profiles.coastlineX(3276)));
    // and from there, not again until the camera is 1,000 m from 1,200
    frame(0, 2100);
    expect(upload).toHaveBeenCalledTimes(1);
    frame(0, -200);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(plugin.ocean!.coast[0]).toBe(-2280);
    ocean.dispose();
  }, timeLimit(30_000));

  it("writes an absent headland tip far inland, where it shelters nothing", () => {
    expect(OCEAN_NO_TIP).toBe(1e9);
    expect(oceanTipsFor([])).toEqual([1e9, 0, 1e9, 0]);
    expect(oceanTipsFor([[-520, -150]])).toEqual([-520, -150, 1e9, 0]);
    expect(oceanTipsFor([[-520, -150], [-505, 160]])).toEqual([-520, -150, -505, 160]);
  });

  it("disposes its atlas and not the scene's placeholder", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const ocean = createOcean(scene, SEED, "low");
    ocean.dispose();
    expect(ocean.atlas.getInternalTexture()).toBeNull();
    expect(oceanArrayPlaceholder(scene)).toBe(ocean.windDisp);
    expect(ocean.windDisp.getInternalTexture()).not.toBeNull();
  }, timeLimit(30_000));
});

describe("the water plugin's array placeholder", () => {
  it("is made once a scene, and again once disposed", () => {
    const engine = new NullEngine();
    try {
      const a = new Scene(engine);
      const b = new Scene(engine);
      const first = oceanArrayPlaceholder(a);
      expect(oceanArrayPlaceholder(a)).toBe(first);
      expect(oceanArrayPlaceholder(b)).not.toBe(first);
      expect(first.name).toBe("oceanArrayPlaceholder");
      first.dispose();
      const again = oceanArrayPlaceholder(a);
      expect(again).not.toBe(first);
      expect(again.getInternalTexture()).not.toBeNull();
    } finally {
      engine.dispose();
    }
  });
});
```

`client/test/game/waterPlugin.test.ts`, four edits, each old → new:

Edit 1 — old:

```ts
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { WaterPlugin, attachWater } from "../../src/game/waterPlugin.js";
```

new:

```ts
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { WaterPlugin, attachWater, oceanArrayPlaceholder, type OceanBinding } from "../../src/game/waterPlugin.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";
```

Edit 2 — old:

```ts
  it("declares the bedDepth attribute, the bed sampler, and the four hook points", () => {
    const mat = new PBRMaterial("w2", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    const attributes: string[] = [];
    p.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["bedDepth"]);
    const samplers: string[] = [];
    p.getSamplers(samplers);
    expect(samplers).toEqual(["waterBedHeight", "waterScene", "waterDepth"]);
    const v = p.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
```

new:

```ts
  it("declares the bedDepth attribute, its samplers and the sea's, and its hook points", () => {
    const mat = new PBRMaterial("w2", scene);
    const p = attachWater(mat, WATER_ROWS.lowlandLake);
    const attributes: string[] = [];
    p.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["bedDepth"]);
    const samplers: string[] = [];
    p.getSamplers(samplers);
    expect(samplers).toEqual(["waterBedHeight", "waterScene", "waterDepth", "oceanAtlas", "oceanWindDisp", "oceanWindSlope"]);
    const v = p.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_POSITION", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
```

Edit 3 — old:

```ts
    const f = p.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("waterLights.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe(fx("waterCompose.fragment.fx"));
    const v = p.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("waterWorldPos.vertex.fx"));
```

new:

```ts
    const f = p.getCustomCode("fragment")!;
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx") + fx("ocean.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("waterLights.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe(fx("waterCompose.fragment.fx"));
    const v = p.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_POSITION).toBe(fx("oceanDisplace.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("waterWorldPos.vertex.fx"));
    // the water's files end their last line, so the sea's never join it
    expect(fx("water.vertex.fx").endsWith(";\n")).toBe(true);
    expect(fx("water.fragment.fx").endsWith("}\n")).toBe(true);
```

Edit 4 — old:

```ts
    expect(d).toContain("uniform sampler2D waterBedHeight;");
    expect(p.getUniforms().fragment).not.toContain("sampler2D");
  });
```

new:

```ts
    expect(d).toContain("uniform sampler2D waterBedHeight;");
    expect(p.getUniforms().fragment).not.toContain("sampler2D");
    expect(p.getUniforms().vertex).not.toContain("sampler");
  });
```

Then append to the end of `client/test/game/waterPlugin.test.ts`, after the closing `});` of `describe("the rain's rings on the water", …)`:

```ts
/** The eight vec4 uniforms the sea's waves read, in their order. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
];

/** An ocean as `oceanRender.ts` binds one, with values to tell apart. */
function testOcean(): OceanBinding {
  return {
    atlas: RawTexture.CreateRGBATexture(new Float32Array(4), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT),
    windDisp: oceanArrayPlaceholder(scene),
    windSlope: oceanArrayPlaceholder(scene),
    phases: Float32Array.from({ length: 12 }, (_, i) => i + 0.5),
    swell: [0.96, 0.28, 11, 2],
    tips: [-520, -150, -505, 160],
    coast: [-2080, 4, 12, 0],
    wind: [0.4, 0.81, 0, 0.01],
    windDir: [0.6, -0.8, 9, 0],
  };
}

/** A bed texture, as every drawn water material has one. */
const bedTexture = (): RawTexture =>
  RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);

describe("the sea's waves in the water plugin", () => {
  it("declares the eight vec4 uniforms on every path, ocean or none", () => {
    const p = attachWater(new PBRMaterial("wO1", scene), WATER_ROWS.lowlandLake);
    const u = p.getUniforms();
    for (const name of OCEAN_UNIFORMS) {
      expect(u.ubo).toContainEqual({ name, size: 4, type: "vec4" });
      expect(u.fragment).toContain(`uniform vec4 ${name};`);
      // the vertex stage reads them too, which takes this where uniform buffers are not supported
      expect(u.vertex).toContain(`uniform vec4 ${name};`);
    }
    expect(u.ubo.map((e) => e.name).slice(-8)).toEqual(OCEAN_UNIFORMS);
    expect(u.ubo).toHaveLength(21);
  });

  it("declares its samplers in the .fx and never in getUniforms, and gates every line of its GLSL on OCEAN", () => {
    const vertex = fx("ocean.vertex.fx");
    const fragment = fx("ocean.fragment.fx");
    expect(vertex).toContain("uniform highp sampler2D oceanAtlas;");
    expect(vertex).toContain("uniform highp sampler2DArray oceanWindDisp;");
    expect(vertex).not.toContain("oceanWindSlope");
    expect(fragment).toContain("uniform highp sampler2D oceanAtlas;");
    expect(fragment).toContain("uniform highp sampler2DArray oceanWindDisp;");
    expect(fragment).toContain("uniform highp sampler2DArray oceanWindSlope;");
    const u = attachWater(new PBRMaterial("wO2", scene), WATER_ROWS.sea).getUniforms();
    expect(u.fragment).not.toContain("sampler");
    expect(u.vertex).not.toContain("sampler");
    for (const name of ["ocean.vertex.fx", "oceanDisplace.vertex.fx", "ocean.fragment.fx"]) {
      const lines = fx(name).trimEnd().split("\n");
      expect(lines[0], name).toBe("#ifdef OCEAN");
      expect(lines[lines.length - 1], name).toBe("#endif");
      expect(lines.filter((line) => line.trimStart().startsWith("#")), name).toEqual(["#ifdef OCEAN", "#endif"]);
    }
  });

  it("carries the rings' stitch and the position before the waves, and moves nothing yet", () => {
    const vertex = fx("ocean.vertex.fx");
    expect(vertex).toContain("attribute float oceanMorph;");
    expect(vertex).toContain("attribute vec2 oceanCoarse;");
    expect(vertex).toContain("varying vec2 vOceanXZ;");
    expect(fx("ocean.fragment.fx")).toContain("varying vec2 vOceanXZ;");
    const displace = fx("oceanDisplace.vertex.fx");
    expect(displace).toContain("vOceanXZ = positionUpdated.xz;");
    expect(displace).not.toMatch(/positionUpdated\s*=/);
  });

  it("sets OCEAN and asks for the stitch only with an ocean, and rebuilds the effect when one comes or goes", () => {
    const p = attachWater(new PBRMaterial("wO3", scene), WATER_ROWS.sea);
    const dirty = vi.spyOn(p, "markAllDefinesAsDirty");
    const defines = (): Record<string, unknown> => {
      const d: Record<string, unknown> = {};
      p.prepareDefines(d as never, scene, undefined as never);
      return d;
    };
    const attributes = (): string[] => {
      const a: string[] = [];
      p.getAttributes(a, scene, undefined as never);
      return a;
    };
    expect(p.ocean).toBeNull();
    expect(defines()).toEqual({ WATER: true, OCEAN: false });
    expect(attributes()).toEqual(["bedDepth"]);
    p.ocean = testOcean();
    expect(defines()).toEqual({ WATER: true, OCEAN: true });
    expect(attributes()).toEqual(["bedDepth", "oceanMorph", "oceanCoarse"]);
    expect(dirty).toHaveBeenCalledTimes(1);
    // another ocean: the define stands, nothing to rebuild
    p.ocean = testOcean();
    expect(dirty).toHaveBeenCalledTimes(1);
    p.ocean = null;
    expect(defines().OCEAN).toBe(false);
    expect(dirty).toHaveBeenCalledTimes(2);
  });

  it("binds the ocean's values, and zeros without one", () => {
    const p = attachWater(new PBRMaterial("wO4", scene), WATER_ROWS.sea);
    const record = (): Record<string, number[]> => {
      const quads: Record<string, number[]> = {};
      const ignore = (): void => undefined;
      const ubo = {
        updateFloat: ignore, updateFloat2: ignore, updateFloat3: ignore, setTexture: ignore,
        updateFloat4: (name: string, a: number, b: number, c: number, d: number) => { quads[name] = [a, b, c, d]; },
      } as unknown as UniformBuffer;
      p.bindForSubMesh(ubo);
      return quads;
    };
    const none = record();
    for (const name of OCEAN_UNIFORMS) expect(none[name], name).toEqual([0, 0, 0, 0]);
    p.ocean = testOcean();
    const bound = record();
    expect(bound.oceanPhase0).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(bound.oceanPhase1).toEqual([4.5, 5.5, 6.5, 7.5]);
    expect(bound.oceanPhase2).toEqual([8.5, 9.5, 10.5, 11.5]);
    expect(bound.oceanSwell).toEqual([0.96, 0.28, 11, 2]);
    expect(bound.oceanTips).toEqual([-520, -150, -505, 160]);
    expect(bound.oceanCoast).toEqual([-2080, 4, 12, 0]);
    expect(bound.oceanWind).toEqual([0.4, 0.81, 0, 0.01]);
    expect(bound.oceanWindDir).toEqual([0.6, -0.8, 9, 0]);
  });

  it("binds every sampler it lists in every state it is drawn in: a lake, the sea, the high tier's sea, the sea's waves gone", () => {
    const p = attachWater(new PBRMaterial("wO5", scene), WATER_ROWS.sea);
    const ocean = testOcean();
    const states: [string, () => void][] = [
      ["a lake", () => { p.bedTexture = bedTexture(); }],
      ["the sea", () => { p.ocean = ocean; }],
      ["the high tier's sea", () => { p.sceneTexture = new BaseTexture(scene); p.depthTexture = new BaseTexture(scene); }],
      ["the waves gone", () => { p.ocean = null; }],
    ];
    const missing: string[] = [];
    const seen: Record<string, Record<string, unknown>> = {};
    for (const [state, enter] of states) {
      enter();
      const declared: string[] = [];
      p.getSamplers(declared);
      const bound: Record<string, unknown> = {};
      const ubo = new Proxy(
        {},
        { get: (_t, key) => (key === "setTexture" ? (n: string, t: unknown) => void (bound[n] = t) : () => undefined) },
      ) as unknown as UniformBuffer;
      p.bindForSubMesh(ubo);
      for (const sampler of declared) if (!(sampler in bound)) missing.push(`${state}: ${sampler}`);
      seen[state] = bound;
    }
    expect(missing).toEqual([]);
    // the sea's own textures with an ocean; the bed and the scene's array placeholder without
    expect(seen["the sea"]!.oceanAtlas).toBe(ocean.atlas);
    expect(seen["the sea"]!.oceanWindDisp).toBe(ocean.windDisp);
    expect(seen["a lake"]!.oceanAtlas).toBe(p.bedTexture);
    expect(seen["a lake"]!.oceanWindDisp).toBe(oceanArrayPlaceholder(scene));
    expect(seen["a lake"]!.oceanWindSlope).toBe(oceanArrayPlaceholder(scene));
    expect(seen["the waves gone"]!.oceanWindSlope).toBe(oceanArrayPlaceholder(scene));
  });

  it("leaves a lake's shader as it was: compiled as WebGPU compiles it, the text the water's own hooks alone give", async () => {
    /** The water plugin with only the water's own hooks, as it was before the sea's waves. */
    class WaterAlone extends WaterPlugin {
      override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
        const code = super.getCustomCode(shaderType);
        if (code === null) return null;
        if (shaderType === "vertex") {
          return { CUSTOM_VERTEX_DEFINITIONS: fx("water.vertex.fx"), CUSTOM_VERTEX_UPDATE_WORLDPOS: fx("waterWorldPos.vertex.fx") };
        }
        return { ...code, CUSTOM_FRAGMENT_DEFINITIONS: fx("water.fragment.fx") };
      }
    }
    /** The stages one water material compiles to, on an engine of its own (an
     * engine shares an effect between materials of one define set). */
    const compiled = async (make: (material: PBRMaterial) => WaterPlugin, sea: boolean): Promise<{ vertex: string; fragment: string }> => {
      const own = webgpuProcessingEngine();
      try {
        const s = new Scene(own);
        s.activeCamera = new UniversalCamera("c", new Vector3(0, 2, -5), s);
        const material = new PBRMaterial("water", s);
        material.backFaceCulling = false;
        const plugin = make(material);
        plugin.bedTexture = RawTexture.CreateRTexture(new Float32Array(4), 2, 2, s, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        if (sea) {
          plugin.ocean = { ...testOcean(), atlas: plugin.bedTexture, windDisp: oceanArrayPlaceholder(s), windSlope: oceanArrayPlaceholder(s) };
        }
        const mesh = MeshBuilder.CreateGround("ground", { width: 4, height: 4 }, s);
        const vertices = mesh.getTotalVertices();
        mesh.setVerticesData("bedDepth", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanMorph", new Float32Array(vertices), false, 1);
        mesh.setVerticesData("oceanCoarse", new Float32Array(vertices * 2), false, 2);
        mesh.material = material;
        const effect = await drawnEffect(mesh);
        return { vertex: effect._vertexSourceCode, fragment: effect._fragmentSourceCode };
      } finally {
        own.dispose();
      }
    };
    const lake = await compiled((m) => new WaterPlugin(m, WATER_ROWS.lowlandLake), false);
    const before = await compiled((m) => new WaterAlone(m, WATER_ROWS.lowlandLake), false);
    expect(lake.vertex).toBe(before.vertex);
    expect(lake.fragment).toBe(before.fragment);
    expect(lake.vertex).not.toContain("vOceanXZ");
    // and the sea's is not: the comparison can see the ocean's code
    const sea = await compiled((m) => new WaterPlugin(m, WATER_ROWS.sea), true);
    expect(sea.vertex).toContain("vOceanXZ = positionUpdated.xz;");
    expect(sea.fragment).toContain("vOceanXZ");
  }, timeLimit(30_000));
});
```

The binding rule is checked here, in `pluginBindings.test.ts`'s own way (each state entered, `setTexture` recorded through a proxy, every listed sampler bound), rather than by adding the water material to `helpers/pluginText.ts`: every case there is also pinned byte for byte by `webglIdentity.test.ts` and per plugin by `interStage.test.ts`'s first pin, which the next three changes to the water's GLSL (the swell, the white water, the wind sea) would each have to re-pin; the water's own pins live in this file, and its varyings in the pin added to `interStage.test.ts` below.

`client/test/game/waterMesh.test.ts`, one edit — old:

```ts
import { WATER_GROUP } from "../../src/game/waterFrame.js";
```

new:

```ts
import { WATER_GROUP } from "../../src/game/waterFrame.js";
import { oceanFieldFor, swellPhases } from "../../src/game/oceanWaves.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
```

and insert these two tests immediately before `  it("hands the rain to every plugin, the sea's and each lake's", () => {`:

```ts
  it("gives the sea's material the sea's waves and no lake's: OCEAN on the sea alone", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [lake({ murk: 1 }), lake({ x: -300, z: 200, murk: 0 })], "low");
    const pluginOf = (m: AbstractMesh): WaterPlugin => (m.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const oceanDefine = (p: WaterPlugin): unknown => {
      const d: Record<string, unknown> = {};
      p.prepareDefines(d as never, scene, undefined as never);
      return d.OCEAN;
    };
    const sea = pluginOf(water.meshes[0]!);
    for (const m of water.meshes) expect(pluginOf(m)).toBe(sea);
    expect(sea.ocean ?? null).not.toBeNull();
    expect(oceanDefine(sea)).toBe(true);
    // the low tier draws the swell's eight largest components; the coastline row about z = 0
    expect(sea.ocean!.coast).toEqual([-2080, 4, 8, 0]);
    expect(sea.ocean!.atlas.getSize()).toEqual({ width: 1040, height: 28 });
    expect(water.lakeMeshes).toHaveLength(2);
    for (const pond of water.lakeMeshes) {
      expect(pluginOf(pond)).not.toBe(sea);
      expect(pluginOf(pond).ocean).toBeNull();
      expect(oceanDefine(pluginOf(pond))).toBe(false);
    }
    const atlas = sea.ocean!.atlas;
    water.dispose();
    expect(atlas.getInternalTexture()).toBeNull();
  }, timeLimit(30_000));

  it("hands the sea's waves the clock's seconds, the wind setWind last had and the hour, noon when none is given", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const water = createWater(scene, 1, 0, [], "medium");
    const sea = (water.meshes[0]!.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
    const field = oceanFieldFor(1, 12);
    water.setWind(0.9, [0, 1]);
    water.update(0, 0, 42.5, 15);
    expect(Array.from(sea.ocean!.phases)).toEqual(Array.from(swellPhases(field, 42.5)));
    const afternoon = windSeaStateFor(0.9, [0, 1], 15);
    expect(sea.ocean!.windDir).toEqual([afternoon.dir[0], afternoon.dir[1], afternoon.u10, 0]);
    water.update(0, 0, 43);
    const noon = windSeaStateFor(0.9, [0, 1], 12);
    expect(sea.ocean!.windDir).toEqual([noon.dir[0], noon.dir[1], noon.u10, 0]);
    // the hour reached it: the afternoon's sea breeze is the stronger wind
    expect(afternoon.u10).toBeGreaterThan(noon.u10);
    water.dispose();
  }, timeLimit(30_000));

```

`client/test/game/interStage.test.ts`, two edits, each old → new:

Edit 1 — old:

```ts
import { createForestMeshes } from "../../src/game/forestMeshes.js";
```

new:

```ts
import { createForestMeshes } from "../../src/game/forestMeshes.js";
import { createWater } from "../../src/game/renderer.js";
import type { WaterPlugin } from "../../src/game/waterPlugin.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
```

Edit 2 — old:

```ts
import { drawnEffect, probeReady, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
```

new:

```ts
import { drawnEffect, probeReady, stageBindings, webgpuProcessingEngine, type ProcessedEffect } from "./helpers/webgpuProcessing.js";
```

Then append to the end of `client/test/game/interStage.test.ts`, after the closing `});` of `describe("inter-stage variables on WebGPU", …)`:

```ts
/** What to do when a pin on the sea's material turns red. */
const WEIGH_SEA =
  "the varyings of the sea's water material changed: count them against `maxInterStageShaderVariables` " +
  "in engineChoice.ts, and read the effect's locations in a browser if the count grew";

describe("inter-stage variables of the sea's water material on WebGPU, its waves on", () => {
  const limit = WEBGPU_REQUIRED_LIMITS.maxInterStageShaderVariables as number;
  const seas = new Map<QualityTier, { effect: ProcessedEffect; ocean: boolean; receivesShadows: boolean }>();
  const disposers: (() => void)[] = [];

  // The renderer's order on each tier: the atmosphere, the camera, the local
  // lamp, the lighting, then the water, at the coast so ring 0 holds sea.
  beforeAll(async () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const engine = webgpuProcessingEngine();
      const scene = new Scene(engine);
      const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
      scene.activeCamera = new UniversalCamera("player", new Vector3(-380, 3, 0), scene);
      createHeadlamp(scene, "lamp_local");
      const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: "post" });
      probeReady(scene);
      const water = createWater(scene, seedFromToken("atmo"), 0, [], tier, -380, 0);
      const mesh = water.meshes[0] as Mesh;
      const plugin = (mesh.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
      seas.set(tier, { effect: await drawnEffect(mesh), ocean: (plugin.ocean ?? null) !== null, receivesShadows: mesh.receiveShadows });
      disposers.push(() => {
        water.dispose();
        lighting.dispose();
        atmosphere.dispose();
        scene.dispose();
        engine.dispose();
      });
    }
  }, timeLimit(60_000));
  afterAll(() => {
    for (const dispose of disposers) dispose();
  });

  it("writes seven vertex outputs and reads front_facing, 8 of the 19, on every tier", () => {
    for (const [tier, sea] of seas) {
      expect(sea.ocean, tier).toBe(true);
      // The water takes no shadows, so no light's shadow varyings join these.
      expect(sea.receivesShadows, tier).toBe(false);
      const varyings = [...sea.effect._vertexSourceCode.matchAll(/layout\(location = \d+\)\s*(?:flat\s+)?out (\w+) (\w+);/g)].map(
        ([, type, name]) => `${type} ${name}`,
      );
      expect(varyings, `${tier}: ${WEIGH_SEA}`).toEqual([
        "vec2 vMainUV1",
        "vec3 vPositionW",
        "vec3 vNormalW",
        "vec3 vFogDistance",
        "float vBedDepth",
        "float vWaterViewDepth",
        "vec2 vOceanXZ",
      ]);
      expect(sea.effect._processingContext._varyingNextLocation, tier).toBe(7);
      // Two-sided: the fragment stage reads front_facing, one more.
      const frontFacing = sea.effect._fragmentSourceCode.includes("gl_FrontFacing");
      expect(frontFacing, tier).toBe(true);
      expect(sea.effect._processingContext._varyingNextLocation + (frontFacing ? 1 : 0), `${tier}: ${WEIGH_SEA}`).toBe(8);
      expect(8).toBeLessThanOrEqual(limit);
    }
  });

  it("binds the waves' textures within a stage's 16: two in the vertex stage, ten in the fragment stage", () => {
    for (const [tier, sea] of seas) {
      const { vertex, fragment } = stageBindings(sea.effect);
      expect({ vertex: [vertex.textures, vertex.samplers], fragment: [fragment.textures, fragment.samplers] }, tier).toEqual({
        vertex: [2, 2],
        fragment: [10, 10],
      });
      expect(fragment.textures).toBeLessThanOrEqual(WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage as number);
    }
  });
});
```

The count, from the processed shader text: Babylon's PBR vertex stage writes `vMainUV1` (the bump's UV), `vPositionW`, `vNormalW` and `vFogDistance`; the water's own `vBedDepth` and `vWaterViewDepth`; and `vOceanXZ`: seven locations, each a scalar or vector. The ring meshes take no shadows, so no light adds its shadow varyings, and the material is two-sided, so the fragment stage reads `front_facing`: 7 + 1 = 8, against the giants' 18 + 1.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanRender.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/interStage.test.ts`
Expected: FAIL with "Error: Cannot find module '../../src/game/oceanRender.js'" (`oceanRender.test.ts`), "AssertionError: expected [ Array(3) ] to deeply equal [ Array(6) ]" and "ENOENT: no such file or directory, open '…/client/src/game/shaders/ocean.fragment.fx'" (`waterPlugin.test.ts`), "expected null not to be null" (`waterMesh.test.ts`) and "low: expected false to be true" (`interStage.test.ts`)

- [ ] **Step 3: Implement**

Create `client/src/game/shaders/ocean.vertex.fx`:

```glsl
#ifdef OCEAN
// The sea's waves, vertex definitions, spliced after the water's own at
// CUSTOM_VERTEX_DEFINITIONS. Everything here, comments too, sits under the
// sea's define, so a lake's shader is the text it was.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The ring's stitch to the coarser ring around it (water.ts): the border
// blend, 0 to 1, and the half-edge to the coarser lattice, metres.
attribute float oceanMorph;
attribute vec2 oceanCoarse;
// The tables the swell is read from (oceanTables.ts): RGBA32F, one row a
// profile, a component or the coastline, read texel by texel and blended by
// hand. highp, since they hold metres and radians in the thousands.
uniform highp sampler2D oceanAtlas;
// The wind sea's displacement, a layer a cascade or a frame of the loop.
uniform highp sampler2DArray oceanWindDisp;
// The vertex's world xz before the waves move it.
varying vec2 vOceanXZ;
#endif
```

Create `client/src/game/shaders/oceanDisplace.vertex.fx`:

```glsl
#ifdef OCEAN
// The sea's rings carry world positions and no transform, so the position
// here, before the waves move it, is the world's.
vOceanXZ = positionUpdated.xz;
#endif
```

Create `client/src/game/shaders/ocean.fragment.fx`:

```glsl
#ifdef OCEAN
// The sea's waves, fragment definitions, spliced after the water's own at
// CUSTOM_FRAGMENT_DEFINITIONS. Everything here, comments too, sits under the
// sea's define, so a lake's shader is the text it was. The samplers are
// declared here and not in getUniforms().fragment, as the water's own are.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
uniform highp sampler2D oceanAtlas;
uniform highp sampler2DArray oceanWindDisp;
uniform highp sampler2DArray oceanWindSlope;
// The world xz the surface's waves are evaluated at: where the vertex stood
// before they moved it.
varying vec2 vOceanXZ;
#endif
```

`client/src/game/waterPlugin.ts`, ten edits, each old → new:

Edit 1 — old:

```ts
 * The GLSL lives in shaders/water*.fx so shaderHygiene.test.ts covers it.
 */
```

new:

```ts
 * The GLSL lives in shaders/water*.fx so shaderHygiene.test.ts covers it.
 *
 * The sea's material also draws its waves (`ocean`, `oceanRender.ts`): their
 * GLSL lives in shaders/ocean*.fx, all of it under the `OCEAN` define, which
 * is set only while the plugin has an ocean, so a lake's shader text is
 * unchanged by it.
 */
```

Edit 2 — old:

```ts
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import vertexDefs from "./shaders/water.vertex.fx?raw";
import vertexWorldPos from "./shaders/waterWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/water.fragment.fx?raw";
import fragmentLights from "./shaders/waterLights.fragment.fx?raw";
import fragmentCompose from "./shaders/waterCompose.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";

/** Babylon's dielectric F0 at metallicF0Factor 1 is 0.04; water's 0.02 is half of it. */
const PBR_DIELECTRIC_F0 = 0.04;
```

new:

```ts
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import vertexDefs from "./shaders/water.vertex.fx?raw";
import vertexWorldPos from "./shaders/waterWorldPos.vertex.fx?raw";
import fragmentDefs from "./shaders/water.fragment.fx?raw";
import fragmentLights from "./shaders/waterLights.fragment.fx?raw";
import fragmentCompose from "./shaders/waterCompose.fragment.fx?raw";
import oceanVertexDefs from "./shaders/ocean.vertex.fx?raw";
import oceanDisplace from "./shaders/oceanDisplace.vertex.fx?raw";
import oceanFragmentDefs from "./shaders/ocean.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";

/** Babylon's dielectric F0 at metallicF0Factor 1 is 0.04; water's 0.02 is half of it. */
const PBR_DIELECTRIC_F0 = 0.04;

/** The definitions each stage gets: the water's, then the sea's waves'
 * (each file ends in a newline, so no two lines join). */
const VERTEX_DEFINITIONS = vertexDefs + oceanVertexDefs;
const FRAGMENT_DEFINITIONS = fragmentDefs + oceanFragmentDefs;

/**
 * What the sea's material draws its waves from, filled in place each frame
 * by `oceanRender.ts`. The tuples are the shader's vec4 uniforms, in order.
 */
export type OceanBinding = {
  /** The swell's tables (`oceanTables.ts`): RGBA32F, nearest, clamped. */
  atlas: BaseTexture;
  /** The wind sea's displacement and slopes, 2D arrays: the scene's 1×1
   * placeholder (`oceanArrayPlaceholder`) where the tier draws none. */
  windDisp: BaseTexture;
  windSlope: BaseTexture;
  /** The swell's twelve phases, radians (`swellPhases`), zeros past the drawn count. */
  phases: Float32Array;
  /** The swell's unit direction of travel (x, z), its peak period (s) and its significant height (m). */
  swell: [number, number, number, number];
  /** The cove's two headland tips, (x0, z0, x1, z1); an absent one far inland (`OCEAN_NO_TIP`). */
  tips: [number, number, number, number];
  /** The coastline row's first z (m), its step (m), the swell components drawn, and the wind sea's mode (0 low, 1 loop, 2 FFT). */
  coast: [number, number, number, number];
  /** The wind sea's height near shore (Hs times nearShore, m), the loop's length scale, the loop's time (s), the whitecap coverage. */
  wind: [number, number, number, number];
  /** The wind sea's direction (x, z), its wind speed U10 (m/s), and 0. */
  windDir: [number, number, number, number];
};

/** The eight vec4 uniforms the sea's waves read, in the order they are bound. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
] as const;

/** Bound without an ocean: the uniforms exist on every water material. */
const NO_PHASES = new Float32Array(12);
const NO_VEC4: readonly [number, number, number, number] = [0, 0, 0, 0];

const arrayPlaceholders = new WeakMap<Scene, BaseTexture>();

/**
 * A 1×1 RGBA 2D array of one layer, zero, made once per scene: what an array
 * sampler is bound to where nothing real is. WebGPU checks a binding's view
 * dimension against the shader's, so a 2D texture cannot stand in for it.
 * The scene disposes it with itself; a disposed one is made again.
 */
export function oceanArrayPlaceholder(scene: Scene): BaseTexture {
  const kept = arrayPlaceholders.get(scene);
  if (kept !== undefined && kept.getInternalTexture() !== null) return kept;
  const made = new RawTexture2DArray(new Uint8Array(4), 1, 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  made.name = "oceanArrayPlaceholder";
  arrayPlaceholders.set(scene, made);
  return made;
}
```

Edit 3 — old:

```ts
  rain = 0;

  constructor(material: Material, row: WaterRow) {
    // 230: after the atmosphere's 200 and every look plugin's 205 to 220; the
    // water carries only this and the atmosphere, so the order is fixed.
    super(material, "Water", 230, { WATER: false });
    this.row = row;
```

new:

```ts
  rain = 0;
  private _ocean: OceanBinding | null = null;
  /** What the array samplers are bound to without an ocean. */
  private readonly _arrayPlaceholder: BaseTexture;

  constructor(material: Material, row: WaterRow) {
    // 230: after the atmosphere's 200 and every look plugin's 205 to 220; the
    // water carries only this and the atmosphere, so the order is fixed.
    super(material, "Water", 230, { WATER: false, OCEAN: false });
    this.row = row;
    this._arrayPlaceholder = oceanArrayPlaceholder(material.getScene());
```

Edit 4 — old:

```ts
  override getClassName(): string {
    return "WaterPlugin";
  }
```

new:

```ts
  override getClassName(): string {
    return "WaterPlugin";
  }

  /** The sea's waves (`oceanRender.ts`), null on a lake. Whether there is one
   * sets `OCEAN`, so a change between the two rebuilds the effect. */
  get ocean(): OceanBinding | null {
    return this._ocean;
  }

  set ocean(binding: OceanBinding | null) {
    const had = this._ocean !== null;
    this._ocean = binding;
    if (had !== (binding !== null)) this.markAllDefinesAsDirty();
  }
```

Edit 5 — old:

```ts
    defines.WATER = true;
  }
```

new:

```ts
    defines.WATER = true;
    defines.OCEAN = this._ocean !== null;
  }
```

Edit 6 — old:

```ts
    attributes.push("bedDepth");
  }

  override getSamplers(samplers: string[]): void {
    samplers.push("waterBedHeight", "waterScene", "waterDepth");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
```

new:

```ts
    attributes.push("bedDepth");
    // The rings' stitch (water.ts), read only by the sea's waves.
    if (this._ocean !== null) attributes.push("oceanMorph", "oceanCoarse");
  }

  // Always listed, ocean or none: Babylon gathers a plugin's samplers once,
  // when the material's uniform layout is built (`rainPlugin.ts` says why).
  // Undeclared on a lake, the ocean's are a null location on WebGL and
  // ignored on WebGPU.
  override getSamplers(samplers: string[]): void {
    samplers.push("waterBedHeight", "waterScene", "waterDepth", "oceanAtlas", "oceanWindDisp", "oceanWindSlope");
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string; fragment: string } {
```

Edit 7 — old:

```ts
        { name: "waterRain", size: 1, type: "float" },
      ],
      fragment: [
```

new:

```ts
        { name: "waterRain", size: 1, type: "float" },
        ...OCEAN_UNIFORMS.map((name) => ({ name, size: 4, type: "vec4" })),
      ],
      // The sea's waves read theirs in the vertex stage too, which takes this
      // where uniform buffers are not supported.
      vertex: OCEAN_UNIFORMS.map((name) => `uniform vec4 ${name};`).join("\n"),
      fragment: [
```

Edit 8 — old:

```ts
        "uniform float waterRain;",
      ].join("\n"),
```

new:

```ts
        "uniform float waterRain;",
        ...OCEAN_UNIFORMS.map((name) => `uniform vec4 ${name};`),
      ].join("\n"),
```

Edit 9 — old:

```ts
    if (depth !== null) uniformBuffer.setTexture("waterDepth", depth);
  }
```

new:

```ts
    if (depth !== null) uniformBuffer.setTexture("waterDepth", depth);
    // The sea's waves: zeros and placeholders on a lake, whose shader declares
    // none of it, so every water material binds the same.
    const ocean = this._ocean;
    const phases = ocean?.phases ?? NO_PHASES;
    for (let i = 0; i < 3; i++) {
      uniformBuffer.updateFloat4(
        OCEAN_UNIFORMS[i] as string,
        phases[i * 4] as number, phases[i * 4 + 1] as number, phases[i * 4 + 2] as number, phases[i * 4 + 3] as number,
      );
    }
    const values = [ocean?.swell, ocean?.tips, ocean?.coast, ocean?.wind, ocean?.windDir];
    values.forEach((value, i) => {
      const v = value ?? NO_VEC4;
      uniformBuffer.updateFloat4(OCEAN_UNIFORMS[i + 3] as string, v[0], v[1], v[2], v[3]);
    });
    const atlas = ocean?.atlas ?? this.bedTexture;
    if (atlas !== null) uniformBuffer.setTexture("oceanAtlas", atlas);
    uniformBuffer.setTexture("oceanWindDisp", ocean?.windDisp ?? this._arrayPlaceholder);
    uniformBuffer.setTexture("oceanWindSlope", ocean?.windSlope ?? this._arrayPlaceholder);
  }
```

Edit 10 — old:

```ts
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
```

new:

```ts
    if (shaderType === "vertex") {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_UPDATE_POSITION: oceanDisplace,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: vertexWorldPos,
      };
    }
    if (shaderType === "fragment") {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
```

Create `client/src/game/oceanRender.ts`:

```ts
/**
 * The sea's waves as the water material reads them: the swell's tables as
 * one texture (`oceanTables.ts`), and the values that move each frame on the
 * shared clock, written in place into the binding the sea's water plugin
 * holds (`OceanBinding`): what the shaders read the swell from, the same
 * tables `swellAt` reads on the CPU.
 *
 * The coastline row covers 4,160 m along z; it is written again around the
 * camera, and the texture uploaded, whenever the camera has moved more than
 * `OCEAN_COAST_RECENTRE` along z from where it was last written.
 *
 * Renderer-only; the maths is in the Babylon-free modules it reads.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { QualityTier } from "./quality.js";
import { SWELL_COMPONENTS, SWELL_COMPONENTS_LOW } from "./oceanSwell.js";
import { OCEAN_COAST_RECENTRE, OCEAN_COAST_STEP, coastProfilesFor, writeCoastRow } from "./oceanTables.js";
import { oceanFieldFor, swellPhases } from "./oceanWaves.js";
import { windSeaStateFor } from "./oceanWindSea.js";
import { oceanArrayPlaceholder, type OceanBinding, type WaterPlugin } from "./waterPlugin.js";

/**
 * Where an absent headland tip is written (x, metres, at z = 0): far inland.
 * The swell travels toward +x, so every point of the world lies up-swell of
 * it and its shadow falls on none: the shelter it gives is 1 everywhere.
 */
export const OCEAN_NO_TIP = 1e9;

export type Ocean = {
  /** The swell's tables, RGBA32F, `OCEAN_TABLE_SAMPLES` × `OCEAN_ATLAS_ROWS`, nearest, clamped. */
  atlas: RawTexture;
  /** The wind sea's displacement and slopes, texture 2D arrays. */
  windDisp: BaseTexture;
  windSlope: BaseTexture;
  /** How the wind sea is drawn: 0 low (normals), 1 the loop, 2 the GPU FFT. */
  windMode: 0 | 1 | 2;
  /** Per frame: the camera, the shared seconds, the game's wind (0..1 and the
   * direction it blows toward) and the hour (0–24). */
  update(camX: number, camZ: number, seconds: number, wind01: number, windDir: [number, number], hour: number): void;
  /** Points the plugin at this ocean's binding, whose values `update` moves. */
  bind(plugin: WaterPlugin): void;
  dispose(): void;
};

/** The cove's headland tips as the uniform holds them: up to two, and an
 * absent one at (`OCEAN_NO_TIP`, 0). */
export function oceanTipsFor(tips: readonly (readonly [number, number])[]): [number, number, number, number] {
  const out: [number, number, number, number] = [OCEAN_NO_TIP, 0, OCEAN_NO_TIP, 0];
  for (let i = 0; i < Math.min(2, tips.length); i++) {
    const tip = tips[i] as readonly [number, number];
    out[i * 2] = tip[0];
    out[i * 2 + 1] = tip[1];
  }
  return out;
}

/**
 * The sea's waves for a world and a tier: the low tier draws the eight
 * largest of the swell's twelve components, the others all twelve. The wind
 * sea is drawn by its normals alone (mode 0) on every tier, its two
 * textures the scene's 1×1 array placeholder.
 */
export function createOcean(scene: Scene, seed: number, tier: QualityTier): Ocean {
  const field = oceanFieldFor(seed, tier === "low" ? SWELL_COMPONENTS_LOW : SWELL_COMPONENTS);
  const profiles = coastProfilesFor(seed);
  const { tables } = field;
  // The coastline row around z = 0, the cove's middle, whatever the field
  // was built around: the first update moves it to the camera if it is far.
  let coastCentreZ = 0;
  writeCoastRow(tables, profiles, coastCentreZ);
  const atlas = new RawTexture(
    tables.data,
    tables.width,
    tables.rows,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  );
  atlas.name = "oceanAtlas";
  atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
  atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
  const placeholder = oceanArrayPlaceholder(scene);
  const windMode = 0;
  const binding: OceanBinding = {
    atlas,
    windDisp: placeholder,
    windSlope: placeholder,
    phases: new Float32Array(12),
    swell: [field.travel[0], field.travel[1], field.tp, field.hs],
    tips: oceanTipsFor(field.tips),
    coast: [tables.coastOriginZ, OCEAN_COAST_STEP, field.count, windMode],
    wind: [0, 0, 0, 0],
    windDir: [1, 0, 0, 0],
  };
  return {
    atlas,
    windDisp: placeholder,
    windSlope: placeholder,
    windMode,
    update(camX, camZ, seconds, wind01, windDir, hour) {
      if (Math.abs(camZ - coastCentreZ) > OCEAN_COAST_RECENTRE) {
        coastCentreZ = camZ;
        writeCoastRow(tables, profiles, coastCentreZ);
        // The whole atlas, 466 KB, once a kilometre at most.
        atlas.update(tables.data);
        binding.coast[0] = tables.coastOriginZ;
      }
      binding.phases.set(swellPhases(field, seconds));
      const sea = windSeaStateFor(wind01, windDir, hour);
      binding.wind[0] = sea.hs * sea.nearShore;
      binding.wind[1] = sea.loopScale;
      // wind[2], the loop's time, is the loop's to keep: 0 while none is drawn.
      binding.wind[3] = sea.coverage;
      binding.windDir[0] = sea.dir[0];
      binding.windDir[1] = sea.dir[1];
      binding.windDir[2] = sea.u10;
    },
    bind(plugin) {
      plugin.ocean = binding;
    },
    dispose() {
      // The placeholder is the scene's, shared, and goes with the scene.
      atlas.dispose();
    },
  };
}
```

`client/src/game/renderer.ts`, `createWater`, six edits, each old → new (the `Water` type and the two `water?.update` calls are Task 9's and already carry the hour):

Edit 1 — old:

```ts
import { attachWater } from "./waterPlugin.js";
```

new:

```ts
import { attachWater } from "./waterPlugin.js";
import { createOcean } from "./oceanRender.js";
```

Edit 2 — old:

```ts
  const seaPlugin = attachWater(seaMat, WATER_ROWS.sea);
```

new:

```ts
  const seaPlugin = attachWater(seaMat, WATER_ROWS.sea);
  // The sea's waves, bound before any draw: the swell's tables and what moves
  // each frame. The lakes have none (no `OCEAN` on their materials).
  const ocean = createOcean(scene, seed, tier);
  ocean.bind(seaPlugin);
  // The wind the sea's waves are given in `update`, as `setWind` last had it.
  let seaWind = 0;
  let seaWindDir: [number, number] = [1, 0];
```

Edit 3 — old:

```ts
    update(camX, camZ, seconds) {
```

new:

```ts
    update(camX, camZ, seconds, hour = 12) {
```

Edit 4 — old:

```ts
      for (const p of plugins) p.advance(seconds);
```

new:

```ts
      for (const p of plugins) p.advance(seconds);
      ocean.update(camX, camZ, seconds, seaWind, seaWindDir, hour);
```

Edit 5 — old:

```ts
    setWind(wind01, dir) {
      for (const p of plugins) p.setWind(wind01, dir);
    },
```

new:

```ts
    setWind(wind01, dir) {
      seaWind = wind01;
      seaWindDir = dir;
      for (const p of plugins) p.setWind(wind01, dir);
    },
```

Edit 6 — old:

```ts
      bedTexture?.dispose();
      frame?.dispose();
```

new:

```ts
      bedTexture?.dispose();
      ocean.dispose();
      frame?.dispose();
```

The test comments the setup makes untrue: each mock or stub stays, and its comment gives the reason that stands. Thirteen edits, each old → new (`renderer.test.ts`'s comment is on lines Task 9 leaves alone):

Edit 1, `client/test/game/groundMaps.test.ts` — old:

```ts
      // NullEngine cannot create a 2D-array texture; the factory is the seam the
      // real loader and this test share.
```

new:

```ts
      // The factory is the seam the real loader and this test share: it
      // records each array the loader asks for.
```

Edit 2, `client/test/game/rendererSwap.test.ts` — old:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
```

new:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
```

Edit 3, `client/test/game/rendererCleanup.test.ts` — old:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
```

new:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
```

Edit 4, `client/test/game/renderer.test.ts` — old:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
```

new:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
```

Edit 5, `client/test/game/probeScene.test.ts` — old:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
```

new:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
```

Edit 6, `client/test/game/tierDeterminism.test.ts` — old:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader builds a `RawTexture2DArray`, which NullEngine cannot create (the
// same gap `groundMaps.test.ts` documents and works around with its own
// factory injection). Mocked here, at the module boundary, rather than by
// touching `renderer.ts`.
```

new:

```ts
// `terrainTexture.ts`'s plugin constructor calls the real `loadGroundArrays`
// whenever it isn't handed a factory, and `renderer.ts`'s own
// `attachTerrainTexture(scene, mat)` call site never passes one — so the real
// loader would fetch the ground's layer images and decode them, which a suite
// under Node cannot (`groundMaps.test.ts` hands the loader its own decoder).
// Mocked here, at the module boundary, rather than by touching `renderer.ts`.
```

Edit 7, `client/test/game/brdfTeardown.test.ts` — old:

```ts
// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

new:

```ts
// `terrainTexture.ts`'s real ground loader fetches and decodes the layer
// images (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

Edit 8, `client/test/game/rendererStart.test.ts` — old:

```ts
// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

new:

```ts
// `terrainTexture.ts`'s real ground loader fetches and decodes the layer
// images (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

Edit 9, `client/test/game/swapRelease.test.ts` — old:

```ts
// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

new:

```ts
// `terrainTexture.ts`'s real ground loader fetches and decodes the layer
// images (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

Edit 10, `client/test/game/rendererTeardown.test.ts` — old:

```ts
// `terrainTexture.ts` builds `RawTexture2DArray`s NullEngine cannot create
// (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

new:

```ts
// `terrainTexture.ts`'s real ground loader fetches and decodes the layer
// images (`rendererSwap.test.ts` says why); the flat placeholders stand in.
```

Edit 11, `client/test/game/pipelineScope.test.ts` — old:

```ts
// As in `rendererCleanup.test.ts`: the ground's texture arrays NullEngine
// cannot create, and `createRenderer`'s WebGL `Engine`, stand-ins at the
// module boundary.
```

new:

```ts
// As in `rendererCleanup.test.ts`: the ground's texture arrays, whose real
// loader fetches and decodes the layer images, and `createRenderer`'s WebGL
// `Engine`, stand-ins at the module boundary.
```

Edit 12, `client/test/game/terrainTexture.test.ts` — old:

```ts
/** A stand-in for `loadGroundArrays`: NullEngine cannot build a real
 * `RawTexture2DArray`, so every test that attaches the plugin passes this
 * factory instead of letting the constructor call the real loader. */
```

new:

```ts
/** A stand-in for `loadGroundArrays`, whose real loader fetches and decodes
 * the ground's layer images: every test that attaches the plugin passes this
 * factory instead of letting the constructor call the real loader. */
```

Edit 13, `client/test/game/helpers/pluginText.ts` — old:

```ts
/** A stand-in for `loadGroundArrays`, which NullEngine cannot build (the
 * `terrainTexture.test.ts` stub). */
```

new:

```ts
/** A stand-in for `loadGroundArrays`, whose real loader fetches and decodes
 * the ground's layer images (the `terrainTexture.test.ts` stub). */
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanRender.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/interStage.test.ts test/game/water.test.ts test/game/pluginNumbers.test.ts test/game/pluginBindings.test.ts test/game/shaderHygiene.test.ts test/game/webglIdentity.test.ts test/game/groundMaps.test.ts test/game/renderer.test.ts test/game/probeScene.test.ts test/game/rendererSwap.test.ts test/game/rendererCleanup.test.ts test/game/tierDeterminism.test.ts test/game/brdfTeardown.test.ts test/game/rendererStart.test.ts test/game/swapRelease.test.ts test/game/rendererTeardown.test.ts test/game/pipelineScope.test.ts test/game/terrainTexture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/oceanRender.ts client/src/game/waterPlugin.ts client/src/game/renderer.ts client/test/setup/nullEngineArrays.ts client/vite.config.ts client/test/game/oceanRender.test.ts client/test/game/waterPlugin.test.ts client/test/game/waterMesh.test.ts client/test/game/interStage.test.ts`
Expected: PASS (8 tests in `oceanRender.test.ts`, 27 in `waterPlugin.test.ts`, 24 in `waterMesh.test.ts`, 11 in `interStage.test.ts`; `pluginNumbers.test.ts` unchanged: 13 game plugin classes, `WaterPlugin` `MATERIALPLUGIN_19`; `shaderHygiene.test.ts` lints and preprocesses the three new files; `webglIdentity.test.ts` unchanged, the water being none of its cases)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanRender.ts client/src/game/shaders/ocean.vertex.fx client/src/game/shaders/oceanDisplace.vertex.fx client/src/game/shaders/ocean.fragment.fx client/src/game/waterPlugin.ts client/src/game/renderer.ts client/vite.config.ts client/test/setup/nullEngineArrays.ts client/test/game/oceanRender.test.ts client/test/game/waterPlugin.test.ts client/test/game/waterMesh.test.ts client/test/game/interStage.test.ts client/test/game/groundMaps.test.ts client/test/game/rendererSwap.test.ts client/test/game/rendererCleanup.test.ts client/test/game/renderer.test.ts client/test/game/probeScene.test.ts client/test/game/tierDeterminism.test.ts client/test/game/brdfTeardown.test.ts client/test/game/rendererStart.test.ts client/test/game/swapRelease.test.ts client/test/game/rendererTeardown.test.ts client/test/game/pipelineScope.test.ts client/test/game/terrainTexture.test.ts client/test/game/helpers/pluginText.ts
git commit -F - <<'EOF'
feat: the sea's material carries the swell's tables and clock

## What

The sea's water material now holds what its waves are drawn from: the
swell's tables as one float texture, the coastline row kept round the
camera, and the swell's phases and the wind sea's state moved each frame on
the shared clock and the hour. Its define, uniforms, samplers, the rings'
stitch attributes and a hook before the world position are in place, and
the vertex stage records where each vertex stands before the waves move it;
nothing moves yet. Every line of the sea's GLSL is under its define: a
lake compiles exactly as before.

## How

- `client/src/game/oceanRender.ts` — `createOcean`: the atlas from the swell's tables, the coastline row written again past 1 km, the per-frame values, the binding; absent headland tips far inland
- `client/src/game/waterPlugin.ts` — `OceanBinding` and `ocean`; the `OCEAN` define; eight vec4 uniforms; three samplers bound in every state, with a 1×1 array placeholder per scene; the stitch attributes; the position hook
- `client/src/game/shaders/ocean.vertex.fx`, `client/src/game/shaders/oceanDisplace.vertex.fx`, `client/src/game/shaders/ocean.fragment.fx` — the declarations and `vOceanXZ`, gated on `OCEAN`
- `client/src/game/renderer.ts` — `createWater` builds the sea's ocean, hands it the wind and the hour, disposes it
- `client/test/setup/nullEngineArrays.ts`, `client/vite.config.ts` — NullEngine makes raw 2D array textures in every suite
- `client/test/game/groundMaps.test.ts`, `client/test/game/rendererSwap.test.ts`, `client/test/game/rendererCleanup.test.ts`, `client/test/game/renderer.test.ts`, `client/test/game/probeScene.test.ts`, `client/test/game/tierDeterminism.test.ts`, `client/test/game/brdfTeardown.test.ts`, `client/test/game/rendererStart.test.ts`, `client/test/game/swapRelease.test.ts`, `client/test/game/rendererTeardown.test.ts`, `client/test/game/pipelineScope.test.ts`, `client/test/game/terrainTexture.test.ts`, `client/test/game/helpers/pluginText.ts` — the ground loader's mocks kept, their comments giving the reason that stands: the real loader fetches and decodes the layer images
- `client/test/game/oceanRender.test.ts`, `client/test/game/waterPlugin.test.ts`, `client/test/game/waterMesh.test.ts`, `client/test/game/interStage.test.ts` — the atlas, the recentre, the values, the bindings in every state, a lake's stages unchanged, the sea alone with `OCEAN`, 8 of 19 inter-stage variables

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 11: The swell in the shaders

**Files:**
- Create: `client/src/game/shaders/oceanSurface.fx`
- Create: `client/src/game/shaders/oceanShade.fragment.fx`
- Modify: `client/src/game/shaders/oceanDisplace.vertex.fx` (Task 10's file: after its `vOceanXZ = positionUpdated.xz;`)
- Modify: `client/src/game/shaders/waterLights.fragment.fx:6, 9-12`
- Modify: `client/src/game/waterPlugin.ts` (Task 10's text: the sea's `?raw` imports, `VERTEX_DEFINITIONS`/`FRAGMENT_DEFINITIONS`, the fragment hooks of `getCustomCode`)
- Modify: `client/src/game/waterShading.ts:10-11, 128-138`
- Modify: `client/src/game/renderer.ts:896-898` (`createWater`, the bump)
- Modify: `client/test/game/waterPlugin.test.ts` (Task 10's text: its import, the fragment hooks of the hook-points test, the definitions pins, the stitch test)
- Modify: `client/test/game/interStage.test.ts` (Task 10's appended `describe`: the varyings and the textures)
- Modify: `client/test/game/waterMesh.test.ts:76, 86`
- Test: `client/test/game/oceanShader.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 1 (`oceanPhysics.ts`): `OCEAN_G`, `WEGGEL_GAMMA_MIN`, `WEGGEL_GAMMA_MAX`. Task 6 (`oceanSwell.ts`): `SWELL_Q_SUM_MAX`.
  - Task 7 (`oceanTables.ts`): `OCEAN_D_MIN`, `OCEAN_D_STEP`, `OCEAN_TABLE_SAMPLES` (also the coastline row's width), `OCEAN_ATLAS_ROWS`, `OCEAN_ROW_BAY_PROFILE`, `OCEAN_ROW_COVE_PROFILE`, `OCEAN_ROW_BAY_FIRST`, `OCEAN_ROW_COVE_FIRST`, `OCEAN_ROW_COMPONENTS`, `OCEAN_ROW_COAST`, `OCEAN_DRY_DEPTH`, `OCEAN_COAST_STEP`; `coastProfilesFor(seed).coastlineX` (test).
  - Task 8 (`oceanWaves.ts`): `OCEAN_BORE_RATIO`, `OCEAN_BREAK_FULL`, `OCEAN_BREAK_FOAM_LO`, `OCEAN_BREAK_FOAM_HI`, `OCEAN_FOAM_LIFE`, `OCEAN_ROLL_WIDTH`, `OCEAN_INNER_FOAM`, `SHELTER_SWELL`, `SHELTER_CHOP`, `SHELTER_WIDTH`; `oceanFieldFor(seed: number, count?: number): OceanField`, `swellPhases(field: OceanField, seconds: number): Float32Array`, `swellAt(field, phases, x, z): SwellSample`; and the rules its Produces lists for the shaders, mirrored here line for line: the texel-centre reads (`atlasRead`, `coastRead`), the seaward phase, the dry rule (`hc = max(h, OCEAN_DRY_DEPTH)`, no branch on the depth), the Q cap over `max(Σ, 1e-6)`, the shelter's λ with its hard ridge-side step.
  - Task 4 (`water.ts`): `WATER_BASE_SPACING` (1), `WATER_RING_CELLS` (128), `WATER_RING_COUNT` (7), `waterRingSpacing(level)`; the rings' attributes `oceanMorph` (float, the terrain's `blendWeight`) and `oceanCoarse` (vec2, the half-edge e to the coarser lattice), and its stitch: the waves evaluated once at p′ = p − m·e, written to `vOceanXZ`.
  - Task 10 (`waterPlugin.ts`): `type OceanBinding`, `WaterPlugin.ocean` (getter and setter over the private `_ocean`), `oceanArrayPlaceholder(scene: Scene): BaseTexture`, the consts `VERTEX_DEFINITIONS`/`FRAGMENT_DEFINITIONS`, the `OCEAN` define, the eight vec4 uniforms `oceanPhase0..2`, `oceanSwell` (ux, uz, tp, hs), `oceanTips`, `oceanCoast` (coastOriginZ, 4, count, windMode), `oceanWind`, `oceanWindDir` (dirX, dirZ, u10, 0), in the UBO and both strings; the samplers `oceanAtlas` (both stages), `oceanWindDisp` (both stages), `oceanWindSlope` (fragment), `highp`, declared in `ocean.vertex.fx`/`ocean.fragment.fx` with `varying vec2 vOceanXZ`; `oceanDisplace.vertex.fx` as Task 10 writes it. `oceanRender.ts`: `oceanTipsFor(tips)` (test). `client/test/setup/nullEngineArrays.ts` (NullEngine's texture arrays, for the placeholder).
  - Babylon 9.18: `float roughness=reflectivityOut.roughness;`, once in `pbr.fragment.js`, after `CUSTOM_FRAGMENT_BEFORE_LIGHTS`; `vEyePosition` in the Scene UBO of both stages; `MaterialPluginManager` collects a plugin's hook names once, when the plugin is added, and asks for each hook's code at every effect build (an empty string injects nothing).
- Produces:
  - `client/src/game/shaders/oceanSurface.fx`, spliced into **both** stages' definitions after Task 10's declarations (decided: one shared text, so the vertex and the fragment stages run the same sum, rather than functions written into `ocean.vertex.fx` and `ocean.fragment.fx` twice): `vec4 oceanAtlasTexel(float row, float column)`, `vec4 oceanAtlasRead(float row, float column)` (`atlasRead`), `vec4 oceanAtlasRow(float row, float d)`, `vec3 oceanCoastAt(float z)` (`coastRead`; the shared definitions' `oceanCoast(z)` renamed, since GLSL refuses a function named as the `oceanCoast` uniform in its scope), `float oceanShelterTip(vec2 p, vec2 tip, float keep)`, `float oceanShelter(vec2 p, float keep)` (`shelterAt`), `void oceanSwellSum(vec2 p, vec2 dpx, vec2 dpy, out vec3 disp, out vec3 normal, out vec4 foam, out float drawn)` (the shared definitions' sum, each component faded out of what is drawn as its phase turns past a quarter turn over one step (dpx, dpy) of the drawing, gone at a half turn; `drawn` the slope variance the drawn components carry; zero steps fade nothing), `void oceanSwellEval(vec2 p, out vec3 disp, out vec3 normal, out vec4 foam)` (the shared definitions': `oceanSwellSum` with zero steps, `swellAt` exactly), `float oceanRingCell(vec2 p)` (decided: the drawing ring's spacing estimated from p's distance to the eye, no per-ring uniform; a function of the point alone gives a finer ring's edge vertex and the coarser ring's vertex it lands on the same cutoff, so the edge stays crack-free), `vec3 oceanDisplace(vec2 p)` (the swell's displacement of a ring vertex, components under four of the ring's cells a wavelength faded out, so no ring aliases); constants `OCEAN_TWO_PI`, `OCEAN_RESOLVE_PHASE_LO` (π/2), `OCEAN_RESOLVE_PHASE_HI` (π), `OCEAN_RING_BASE` (1), `OCEAN_RING_REACH` (32) beside the TypeScript's. **Every texture read is `textureLod(…, 0.0)`** (decided: the atlas has one level, and a read at a fixed level needs no derivatives, so it is legal in any control flow on WebGPU in both stages; the vertex stage's WGSL is `textureSampleLevel` either way); the component loops run to a constant 12 and `break` on `oceanCoast.z`, a uniform.
  - `client/src/game/shaders/oceanShade.fragment.fx`, fragment definitions after `oceanSurface.fx`: `WATER_COX_MUNK_A`, `WATER_COX_MUNK_B`, `OCEAN_SLOPE_VAR_FLOOR`, `float oceanUndrawnVariance(float u10, float shelter, float drawn)`. Tasks 12 and 13 append to it.
  - `oceanDisplace.vertex.fx`: `positionUpdated.xz -= oceanMorph * oceanCoarse; vOceanXZ = positionUpdated.xz; positionUpdated += oceanDisplace(positionUpdated.xz);` (one evaluation a vertex, before `worldPos`); `normalUpdated` untouched (up).
  - `waterLights.fragment.fx`, under `OCEAN`, locals Tasks 12 and 13 read: `vec2 wOceanDx, wOceanDy` (the derivatives of `vOceanXZ`, taken first, in uniform control flow), `vec3 wOceanDisp`, `vec3 wOceanNormal`, `vec4 wOceanFoam` (foam, B, foamAge, depth), `float wOceanDrawn`, `float wOceanChop` (`oceanShelter(vOceanXZ, SHELTER_CHOP)`), `vec2 wOceanExtra` (the slope added to the swell's normal: PBR's bump on the low tier, which is up elsewhere), `float wOceanVar` (the slope variance left to the roughness); `wDepth` is the displaced surface's depth. On the sea the second ripple octave never runs; on a lake every line is as before.
  - `waterPlugin.ts`: `export const OCEAN_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;"` and `export const OCEAN_ROUGHNESS_CODE = "float roughness=min(sqrt(sqrt(2.0 * wOceanVar)), 1.0);"`, the anchor listed always and its code `""` without an ocean (decided: roughness per pixel, Babylon's own line rewritten as the wet plugin rewrites it, since no hook after the reflectivity block can write it; the material's `roughness` from `setWind` goes unread on the sea); `VERTEX_DEFINITIONS = vertexDefs + oceanVertexDefs + oceanSurface`, `FRAGMENT_DEFINITIONS = fragmentDefs + oceanFragmentDefs + oceanSurface + oceanShade`.
  - `waterShading.ts`: `WATER_COX_MUNK_A = 0.003`, `WATER_COX_MUNK_B = 0.00512`, `coxMunkVariance(u10: number): number`, `roughnessFromVariance(variance: number): number`, `OCEAN_SLOPE_VAR_FLOOR = 0.0015`, `undrawnSlopeVariance(u10: number, shelter: number, drawn: number): number` (the spec's §7.3 remainder), `OCEAN_RESOLVE_PHASE_LO = Math.PI / 2`, `OCEAN_RESOLVE_PHASE_HI = Math.PI`, `resolvedShare(turn: number): number`, `resolvedSlopeVariance(waves: readonly { amplitude: number; k: number }[], step: number): number`, `OCEAN_RING_REACH = WATER_RING_CELLS / 4`, `oceanRingCell(dx: number, dz: number): number`.
  - `renderer.ts`: PBR's bump on the sea's material on the low tier alone (decided: the define, not a blend to zero, so high and medium skip the bump's read and its derivatives); the lakes keep it.
  - In `oceanShader.test.ts`, helpers Tasks 12 and 13 extend: `fx`, `pinned`, `at`, `bindingFor(scene, tier)`, `waterEffect(tier, lake?)`, `shaderSwell(field, phases, x, z, dpx, dpy)`.
  - The limits on WebGPU (Task 10's counts: 8 of 19 varyings, 2 of 16 vertex textures, 10 of 16 fragment textures): this task adds no varying, attribute, uniform or sampler. Without the bump on high and medium the sea's material loses `vMainUV1` and `bumpSampler` there: 6 vertex outputs + `front_facing` = **7 of 19**, **9 of 16** fragment textures (low unchanged: 8 of 19, 10 of 16); 2 of 16 vertex textures on every tier.

- [ ] **Step 1: Write the failing test**

Create `client/test/game/oceanShader.test.ts`:

```ts
// client/test/game/oceanShader.test.ts
/**
 * The sea's shaders: shaders/oceanSurface.fx (both stages), oceanShade.fragment.fx,
 * the displacement in oceanDisplace.vertex.fx and the OCEAN blocks of
 * waterLights.fragment.fx and waterCompose.fragment.fx. Their constants in
 * lockstep with the TypeScript, their swell the same sum as swellAt's, their
 * order in the stages Babylon builds, the lakes' text untouched, and every
 * tier's stages compiled through glslang and translated to WGSL under Node as
 * the page translates them, the sea's textures read at a fixed level only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  OCEAN_ROUGHNESS_ANCHOR, OCEAN_ROUGHNESS_CODE, attachWater, oceanArrayPlaceholder, type OceanBinding,
} from "../../src/game/waterPlugin.js";
import { oceanTipsFor } from "../../src/game/oceanRender.js";
import {
  OCEAN_RESOLVE_PHASE_HI, OCEAN_RESOLVE_PHASE_LO, OCEAN_RING_REACH, OCEAN_SLOPE_VAR_FLOOR, WATER_COX_MUNK_A,
  WATER_COX_MUNK_B, WATER_ROWS, coxMunkVariance, oceanRingCell, resolvedShare, resolvedSlopeVariance, roughnessFor,
  roughnessFromVariance, slopeVariance, undrawnSlopeVariance,
} from "../../src/game/waterShading.js";
import { OCEAN_G, WEGGEL_GAMMA_MAX, WEGGEL_GAMMA_MIN } from "../../src/game/oceanPhysics.js";
import { SWELL_Q_SUM_MAX } from "../../src/game/oceanSwell.js";
import {
  OCEAN_ATLAS_ROWS, OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_DRY_DEPTH, OCEAN_ROW_BAY_FIRST,
  OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COAST, OCEAN_ROW_COMPONENTS, OCEAN_ROW_COVE_FIRST, OCEAN_ROW_COVE_PROFILE,
  OCEAN_TABLE_SAMPLES, coastProfilesFor,
} from "../../src/game/oceanTables.js";
import {
  OCEAN_BORE_RATIO, OCEAN_BREAK_FOAM_HI, OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FULL, OCEAN_FOAM_LIFE, OCEAN_INNER_FOAM,
  OCEAN_ROLL_WIDTH, SHELTER_CHOP, SHELTER_SWELL, SHELTER_WIDTH, oceanFieldFor, swellAt, swellPhases, type OceanField,
} from "../../src/game/oceanWaves.js";
import { WATER_BASE_SPACING, WATER_RING_CELLS, WATER_RING_COUNT, waterRingSpacing } from "../../src/game/water.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine, type ProcessedEffect } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");

const fx = (name: string): string => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
function pinned(text: string, name: string, value: number): void {
  expect(text, name).toContain(`const float ${name} = ${glslFloat(value)};`);
}

/** Babylon's preprocessor over one hook's text, as shaderHygiene.test.ts runs it, with a lake's gates on. */
const LAKE_DEFINES = ["#define WATER", "#define BUMP", "#define REFLECTION", "#define SPECULARTERM"];
function processed(source: string, isFragment: boolean): Promise<string> {
  const options: _IProcessingOptions = {
    defines: LAKE_DEFINES,
    indexParameters: {},
    isFragment,
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
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

type Tier = "high" | "medium" | "low";
const MODE: Record<Tier, number> = { high: 2, medium: 1, low: 0 };
const SEED = 0x5eed;

function floatTexture(scene: Scene): RawTexture {
  return RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
}

/** The sea's binding for a tier, as oceanRender.ts makes it: the world's atlas and swell, the scene's array
 * placeholder for the wind sea's fields, the tier's mode. */
function bindingFor(scene: Scene, tier: Tier): OceanBinding {
  const field = oceanFieldFor(SEED, tier === "low" ? 8 : 12);
  return {
    atlas: new RawTexture(
      field.tables.data, field.tables.width, field.tables.rows, Constants.TEXTUREFORMAT_RGBA, scene,
      false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    ),
    windDisp: oceanArrayPlaceholder(scene),
    windSlope: oceanArrayPlaceholder(scene),
    phases: swellPhases(field, 0),
    swell: [field.travel[0], field.travel[1], field.tp, field.hs],
    tips: oceanTipsFor(field.tips),
    coast: [field.tables.coastOriginZ, OCEAN_COAST_STEP, field.count, MODE[tier]],
    wind: [0, 1, 0, 0],
    windDir: [1, 0, 6, 0],
  };
}

/** The water material's effect as Babylon's WebGPU processing builds it for a tier: the sea's, or a lake's. */
async function waterEffect(tier: Tier, lake = false): Promise<{ effect: ProcessedEffect; defines: string; dispose(): void }> {
  const engine = webgpuProcessingEngine();
  const scene = new Scene(engine);
  new UniversalCamera("c", new Vector3(0, 2, 0), scene);
  const mat = new PBRMaterial(lake ? "mat_water_lake_0" : "mat_water_sea", scene);
  mat.backFaceCulling = false;
  mat.transparencyMode = tier === "high" ? PBRMaterial.PBRMATERIAL_OPAQUE : PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const plugin = attachWater(mat, lake ? WATER_ROWS.lowlandLake : WATER_ROWS.sea);
  plugin.octaves = tier === "low" ? 1 : 2;
  plugin.bedTexture = floatTexture(scene);
  if (tier === "high") {
    plugin.sceneTexture = floatTexture(scene);
    plugin.depthTexture = floatTexture(scene);
  }
  // As createWater sets it: the bump on every lake, and on the sea on the low tier alone.
  if (lake || tier === "low") mat.bumpTexture = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene);
  if (!lake) plugin.ocean = bindingFor(scene, tier);
  const mesh = CreateGround("water_0", { width: 64, height: 64, subdivisions: 4 }, scene);
  const count = mesh.getTotalVertices();
  mesh.setVerticesData("bedDepth", new Float32Array(count), false, 1);
  mesh.setVerticesData("oceanMorph", new Float32Array(count), false, 1);
  mesh.setVerticesData("oceanCoarse", new Float32Array(count * 2), false, 2);
  mesh.material = mat;
  const effect = await drawnEffect(mesh);
  return {
    effect,
    defines: (effect as unknown as { defines: string }).defines,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

/** Where `needle` sits in `text`, failing when it is not there. */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mod = (x: number, y: number): number => x - y * Math.floor(x / y);

/**
 * oceanSwellSum (shaders/oceanSurface.fx) read line for line into TypeScript: the atlas read as the GPU
 * reads the nearest-sampled texture at texel centres, the uniforms as oceanRender.ts writes them, steps
 * (dpx, dpy) as the shader gets them. A difference between this and swellAt is a difference between the
 * shader and swellAt.
 */
function shaderSwell(field: OceanField, phases: Float32Array, px: number, pz: number, dpx: [number, number], dpy: [number, number]) {
  const t = field.tables;
  const swell = [field.travel[0], field.travel[1], field.tp];
  const tips = field.tips;
  const coastU = [t.coastOriginZ, OCEAN_COAST_STEP, field.count];
  const texel = (row: number, column: number): number[] => {
    const o = (row * t.width + column) * 4;
    return [t.data[o] as number, t.data[o + 1] as number, t.data[o + 2] as number, t.data[o + 3] as number];
  };
  const read = (row: number, column: number): number[] => {
    const c = Math.min(Math.max(column, 0), OCEAN_TABLE_SAMPLES - 1);
    const i0 = Math.floor(c);
    const a = texel(row, i0);
    const b = texel(row, Math.min(i0 + 1, OCEAN_TABLE_SAMPLES - 1));
    return a.map((v, j) => v + ((b[j] as number) - v) * (c - i0));
  };
  const shelterTip = (x: number, z: number, tip: [number, number], keep: number): number => {
    const [ux, uz] = [swell[0] as number, swell[1] as number];
    const rx = x - tip[0];
    const rz = z - tip[1];
    const side = uz >= 0 ? 1 : -1;
    const on = (ux * rx + uz * rz >= 0 ? 1 : 0) * (rz * side >= 0 ? 1 : 0);
    const lambda = -(ux * rz - uz * rx) * side;
    return 1 - (1 - keep) * smoothstep(0, SHELTER_WIDTH, lambda) * on;
  };
  const coast = read(OCEAN_ROW_COAST, (pz - (coastU[0] as number)) / (coastU[1] as number));
  const [cx, cdz, wc] = coast as [number, number, number];
  const d = px - cx;
  const column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  const deep = Math.min(d - OCEAN_D_MIN, 0);
  const bay = read(OCEAN_ROW_BAY_PROFILE, column);
  const cove = read(OCEAN_ROW_COVE_PROFILE, column);
  const h = (bay[0] as number) + ((cove[0] as number) - (bay[0] as number)) * wc;
  const a = (bay[1] as number) + ((cove[1] as number) - (bay[1] as number)) * wc;
  const b = (bay[2] as number) + ((cove[2] as number) - (bay[2] as number)) * wc;
  const shelter = shelterTip(px, pz, tips[0] as [number, number], SHELTER_SWELL) * shelterTip(px, pz, tips[1] as [number, number], SHELTER_SWELL);
  const phi: number[] = [];
  const amp: number[] = [];
  const q0: number[] = [];
  const kv: [number, number][] = [];
  let ex = 0;
  let ey = 0;
  for (let c = 0; c < 12; c++) {
    if (c >= (coastU[2] as number)) break;
    const k = texel(OCEAN_ROW_COMPONENTS, 2 * c) as [number, number, number, number];
    const rb = read(OCEAN_ROW_BAY_FIRST + c, column) as [number, number, number, number];
    const rc = read(OCEAN_ROW_COVE_FIRST + c, column) as [number, number, number, number];
    const psi = rb[0] + (rc[0] - rb[0]) * wc + k[0] * deep;
    const kn = rb[1] + (rc[1] - rb[1]) * wc;
    const shoal = rb[2] + (rc[2] - rb[2]) * wc;
    phi[c] = psi + k[0] * cx + k[1] * pz + (phases[c] as number);
    kv[c] = [kn, k[1] + (k[0] - kn) * cdz];
    amp[c] = k[3] * shoal * shelter;
    q0[c] = texel(OCEAN_ROW_COMPONENTS, 2 * c + 1)[0] as number;
    ex += (amp[c] as number) * Math.cos(phi[c] as number);
    ey += (amp[c] as number) * Math.sin(phi[c] as number);
  }
  const envelope = Math.hypot(ex, ey);
  const unbroken = 2 * envelope;
  const crestPhase = envelope > 0 ? Math.atan2(ey, ex) : 0;
  const hc = Math.max(h, OCEAN_DRY_DEPTH);
  const gamma = Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, b - (a * unbroken) / (OCEAN_G * (swell[2] as number) * (swell[2] as number))));
  const ratio = unbroken / (gamma * hc);
  let scale = 1;
  if (ratio > 1) {
    const cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1, OCEAN_BREAK_FULL, ratio);
    scale = (hc * cap) / Math.max(unbroken, 1e-6);
  }
  const breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);
  let steepness = 0;
  for (let c = 0; c < 12; c++) {
    if (c >= (coastU[2] as number)) break;
    amp[c] = (amp[c] as number) * scale;
    steepness += (q0[c] as number) * Math.hypot(...(kv[c] as [number, number])) * (amp[c] as number);
  }
  const s = Math.min(1, SWELL_Q_SUM_MAX / Math.max(steepness, 1e-6));
  let height = 0;
  let dx = 0;
  let dz = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let fold = 0;
  let drawn = 0;
  for (let c = 0; c < 12; c++) {
    if (c >= (coastU[2] as number)) break;
    const [kx, kz] = kv[c] as [number, number];
    const kmag = Math.hypot(kx, kz);
    const turn = Math.max(Math.abs(dpx[0] * kx + dpx[1] * kz), Math.abs(dpy[0] * kx + dpy[1] * kz));
    const A = (amp[c] as number) * (1 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn));
    const Q = (q0[c] as number) * s;
    const sn = Math.sin(phi[c] as number);
    const cs = Math.cos(phi[c] as number);
    height += A * cs;
    dx -= (Q * A * kx * sn) / kmag;
    dz -= (Q * A * kz * sn) / kmag;
    slopeX += A * kx * sn;
    slopeZ += A * kz * sn;
    fold += Q * A * kmag * cs;
    drawn += 0.5 * (A * kmag) * (A * kmag);
  }
  const foamAge = mod(-crestPhase, 2 * Math.PI) / ((2 * Math.PI) / (swell[2] as number));
  const roll = breaking * (1 - smoothstep(0, OCEAN_ROLL_WIDTH, mod(crestPhase, 2 * Math.PI)));
  const trailing = breaking * Math.exp(-foamAge / OCEAN_FOAM_LIFE);
  return {
    height, dx, dz, slopeX, slopeZ, normalY: 1 - fold, depth: h, breaking, foamAge,
    foam: Math.max(roll, trailing, breaking * OCEAN_INNER_FOAM), drawn,
  };
}

describe("the sea's shader constants and functions", () => {
  it("hold the TypeScript's values", () => {
    const s = fx("oceanSurface.fx");
    const surface: [string, number][] = [
      ["OCEAN_G", OCEAN_G], ["OCEAN_TWO_PI", 2 * Math.PI], ["OCEAN_D_MIN", OCEAN_D_MIN], ["OCEAN_D_STEP", OCEAN_D_STEP],
      ["OCEAN_TABLE_SAMPLES", OCEAN_TABLE_SAMPLES], ["OCEAN_ATLAS_ROWS", OCEAN_ATLAS_ROWS],
      ["OCEAN_ROW_BAY_PROFILE", OCEAN_ROW_BAY_PROFILE], ["OCEAN_ROW_COVE_PROFILE", OCEAN_ROW_COVE_PROFILE],
      ["OCEAN_ROW_BAY_FIRST", OCEAN_ROW_BAY_FIRST], ["OCEAN_ROW_COVE_FIRST", OCEAN_ROW_COVE_FIRST],
      ["OCEAN_ROW_COMPONENTS", OCEAN_ROW_COMPONENTS], ["OCEAN_ROW_COAST", OCEAN_ROW_COAST],
      ["OCEAN_DRY_DEPTH", OCEAN_DRY_DEPTH], ["WEGGEL_GAMMA_MIN", WEGGEL_GAMMA_MIN], ["WEGGEL_GAMMA_MAX", WEGGEL_GAMMA_MAX],
      ["SWELL_Q_SUM_MAX", SWELL_Q_SUM_MAX], ["OCEAN_BORE_RATIO", OCEAN_BORE_RATIO], ["OCEAN_BREAK_FULL", OCEAN_BREAK_FULL],
      ["OCEAN_BREAK_FOAM_LO", OCEAN_BREAK_FOAM_LO], ["OCEAN_BREAK_FOAM_HI", OCEAN_BREAK_FOAM_HI],
      ["OCEAN_FOAM_LIFE", OCEAN_FOAM_LIFE], ["OCEAN_ROLL_WIDTH", OCEAN_ROLL_WIDTH], ["OCEAN_INNER_FOAM", OCEAN_INNER_FOAM],
      ["SHELTER_SWELL", SHELTER_SWELL], ["SHELTER_CHOP", SHELTER_CHOP], ["SHELTER_WIDTH", SHELTER_WIDTH],
      ["OCEAN_RESOLVE_PHASE_LO", OCEAN_RESOLVE_PHASE_LO], ["OCEAN_RESOLVE_PHASE_HI", OCEAN_RESOLVE_PHASE_HI],
      ["OCEAN_RING_BASE", WATER_BASE_SPACING], ["OCEAN_RING_REACH", WATER_RING_CELLS / 4],
    ];
    for (const [name, value] of surface) pinned(s, name, value);
    const f = fx("oceanShade.fragment.fx");
    pinned(f, "WATER_COX_MUNK_A", WATER_COX_MUNK_A);
    pinned(f, "WATER_COX_MUNK_B", WATER_COX_MUNK_B);
    pinned(f, "OCEAN_SLOPE_VAR_FLOOR", OCEAN_SLOPE_VAR_FLOOR);
  });

  it("declares the sea's functions under OCEAN alone, the coastline's named apart from the oceanCoast uniform", () => {
    const s = fx("oceanSurface.fx");
    for (const signature of [
      "vec4 oceanAtlasRow(float row, float d)",
      "vec3 oceanCoastAt(float z)",
      "float oceanShelter(vec2 p, float keep)",
      "void oceanSwellEval(vec2 p, out vec3 disp, out vec3 normal, out vec4 foam)",
      "void oceanSwellSum(vec2 p, vec2 dpx, vec2 dpy, out vec3 disp, out vec3 normal, out vec4 foam, out float drawn)",
      "float oceanRingCell(vec2 p)",
      "vec3 oceanDisplace(vec2 p)",
    ]) expect(s).toContain(signature);
    expect(s).not.toMatch(/\boceanCoast\s*\(/);
    // Every line, comments too, inside the gate: a lake's definitions carry none of it.
    for (const name of ["oceanSurface.fx", "oceanShade.fragment.fx"]) {
      expect(fx(name).startsWith("#ifdef OCEAN\n"), name).toBe(true);
      expect(fx(name).endsWith("#endif\n"), name).toBe(true);
    }
  });

  it("reads every texture at a fixed level, in loops bounded by a constant and broken on the uniform count", () => {
    for (const name of ["oceanSurface.fx", "oceanShade.fragment.fx", "oceanDisplace.vertex.fx"]) {
      expect(fx(name), name).not.toMatch(/\btexture2D\s*\(|\btexture\s*\(/);
    }
    const s = fx("oceanSurface.fx");
    expect(s).toContain("return textureLod(oceanAtlas, vec2((column + 0.5) / OCEAN_TABLE_SAMPLES, (row + 0.5) / OCEAN_ATLAS_ROWS), 0.0);");
    expect(s.match(/for \(int c = 0; c < 12; c\+\+\) \{/g)).toHaveLength(3);
    expect(s.match(/if \(fc >= oceanCoast\.z\) break;/g)).toHaveLength(1);
    expect(s.match(/if \(float\(c\) >= oceanCoast\.z\) break;/g)).toHaveLength(2);
  });

  it("writes swellAt's sum: the phase, the wave vector, the dry rule, the cap, the Gerstner normal, the foam", () => {
    const s = fx("oceanSurface.fx");
    for (const line of [
      "  return a + (b - a) * (c - i0);",
      "  return oceanAtlasRead(OCEAN_ROW_COAST, (z - oceanCoast.x) / oceanCoast.y).xyz;",
      "  float side = u.y >= 0.0 ? 1.0 : -1.0;",
      "  float on = step(0.0, dot(u, r)) * step(0.0, r.y * side);",
      "  float lambda = -(u.x * r.y - u.y * r.x) * side;",
      "    float psi = rb.x + (rc.x - rb.x) * coast.z + k.x * deep;",
      "    phi[c] = psi + k.x * coast.x + k.y * p.y + theta[c];",
      "    kv[c] = vec2(kn, k.y + (k.x - kn) * coast.y);",
      "    amp[c] = k.w * shoal * shelter;",
      "    q0[c] = oceanAtlasTexel(OCEAN_ROW_COMPONENTS, 2.0 * fc + 1.0).x;",
      "  float hc = max(h, OCEAN_DRY_DEPTH);",
      "  float ratio = unbroken / (gamma * hc);",
      "    scale = hc * cap / max(unbroken, 1.0e-6);",
      "  float s = min(1.0, SWELL_Q_SUM_MAX / max(steepness, 1.0e-6));",
      "    across -= Q * A * kv[c] * sn / kmag;",
      "  normal = normalize(vec3(slope.x, 1.0 - fold, slope.y));",
      "  foam = vec4(max(max(roll, trailing), breaking * OCEAN_INNER_FOAM), breaking, foamAge, h);",
    ]) expect(s, line).toContain(line);
    // No branch on the depth: the dry rule holds the depth instead.
    expect(s).not.toContain("if (h > OCEAN_DRY_DEPTH)");
  });

  it("gives swellAt's numbers, transcribed line for line, at 1,275 points over three worlds, and fades only what is drawn", () => {
    let broken = 0;
    for (const seed of [SEED, 12345, 777]) {
      const field = oceanFieldFor(seed);
      const phases = swellPhases(field, 37.5);
      const coastline = coastProfilesFor(seed).coastlineX;
      for (let i = 0; i <= 24; i++) {
        for (let j = 0; j <= 16; j++) {
          const z = -400 + j * 50;
          const x = coastline(z) - 700 + i * 30;
          const want = swellAt(field, phases, x, z);
          const got = shaderSwell(field, phases, x, z, [0, 0], [0, 0]);
          for (const key of ["height", "dx", "dz", "slopeX", "slopeZ", "normalY", "depth", "breaking", "foamAge", "foam"] as const) {
            expect(Math.abs(got[key] - want[key]), `${key} at (${x}, ${z})`).toBeLessThan(1e-9);
          }
          if (want.breaking > 0.5) broken++;
          // A step of a kilometre fades every component out of what is drawn, never the break or its foam.
          const far = shaderSwell(field, phases, x, z, [1000, 0], [0, 1000]);
          expect(far.height).toBe(0);
          expect(far.slopeX).toBe(0);
          expect(far.drawn).toBe(0);
          expect(far.breaking).toBe(got.breaking);
          expect(far.foam).toBe(got.foam);
        }
      }
    }
    // The points cross the break line: some of them break.
    expect(broken).toBeGreaterThan(100);
  }, timeLimit(60_000));

  it("estimates a vertex's ring from its distance alone: its own spacing at the inner edge, the next ring's at the outer", () => {
    expect(OCEAN_RING_REACH).toBe(32);
    expect(oceanRingCell(0, 0)).toBe(WATER_BASE_SPACING);
    for (let level = 1; level < WATER_RING_COUNT; level++) {
      const spacing = waterRingSpacing(level);
      expect(oceanRingCell(32 * spacing, -5)).toBe(spacing);
      expect(oceanRingCell(-3, 64 * spacing)).toBe(2 * spacing);
    }
    expect(fx("oceanSurface.fx")).toContain("  return max(OCEAN_RING_BASE, max(r.x, r.y) / OCEAN_RING_REACH);");
  });

  it("displaces in UPDATE_POSITION once, at the vertex slid toward the coarser ring's lattice, the point it shades", () => {
    const d = fx("oceanDisplace.vertex.fx");
    const slide = at(d, "positionUpdated.xz -= oceanMorph * oceanCoarse;");
    const assign = at(d, "vOceanXZ = positionUpdated.xz;");
    const displace = at(d, "positionUpdated += oceanDisplace(positionUpdated.xz);");
    expect(slide).toBeLessThan(assign);
    expect(assign).toBeLessThan(displace);
    expect(d.match(/oceanDisplace\(/g)).toHaveLength(1);
    // The ring's normal is left up: the sea's normal is made per pixel.
    expect(d).not.toContain("normalUpdated");
    // Each ring fades the swell at four of its cells a wavelength.
    expect(fx("oceanSurface.fx")).toContain("  oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn);");
  });
});

describe("the sea's normal, waterline and roughness", () => {
  it("takes the swell's derivatives in uniform control flow, before any branch, and its depth under the displaced surface", () => {
    const l = fx("waterLights.fragment.fx");
    const top = l.slice(0, at(l, "wOceanDx = dFdx(vOceanXZ);"));
    expect(top.split("{").length).toBe(top.split("}").length);
    expect(l).toContain("vec2 wOceanDy = dFdy(vOceanXZ);");
    expect(l).toContain("oceanSwellSum(vOceanXZ, wOceanDx, wOceanDy, wOceanDisp, wOceanNormal, wOceanFoam, wOceanDrawn);");
    expect(l).toContain("float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;");
    expect(at(l, "float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;")).toBeLessThan(at(l, "if (wDepth <= 0.0) discard;"));
  });

  it("puts the swell's normal before the rain's rings, the horizon clamp and Fresnel, and the second octave off the sea", () => {
    const l = fx("waterLights.fragment.fx");
    const swell = at(l, "normalW = normalize(wOceanNormal + vec3(wOceanExtra.x, 0.0, wOceanExtra.y) * wOceanNormal.y);");
    expect(swell).toBeLessThan(at(l, "if (waterRain > 0.0) {"));
    expect(swell).toBeLessThan(at(l, "normalW = waterHorizonNormal(normalW, viewDirectionW);"));
    expect(swell).toBeLessThan(at(l, "float wF = WATER_F0"));
    // The ripple's block sits in the gate's other branch: never on the sea, unchanged on a lake.
    expect(at(l, "if (waterOctaves > 1.5) {")).toBeGreaterThan(swell);
    expect(l.slice(swell, at(l, "if (waterOctaves > 1.5) {"))).toContain("#else");
  });

  it("is Cox and Munk's variance for the wind less what the drawn waves carry, never under the floor", () => {
    expect(coxMunkVariance(10)).toBeCloseTo(0.0542, 12);
    expect(slopeVariance(10 / 12, 1)).toBeCloseTo(coxMunkVariance(10), 12);
    expect(undrawnSlopeVariance(10, 1, 0)).toBeCloseTo(0.0542, 12);
    expect(undrawnSlopeVariance(10, 1, 0.02)).toBeCloseTo(0.0342, 12);
    expect(undrawnSlopeVariance(10, 0.15, 0)).toBeCloseTo(0.00813, 12);
    expect(undrawnSlopeVariance(0, 1, 0.01)).toBe(OCEAN_SLOPE_VAR_FLOOR);
    expect(roughnessFromVariance(0.0542)).toBeCloseTo(0.5737957, 6);
    expect(roughnessFromVariance(OCEAN_SLOPE_VAR_FLOOR)).toBeCloseTo(0.2340347, 6);
    expect(roughnessFromVariance(slopeVariance(0.5, 1))).toBeCloseTo(roughnessFor(0.5, 1), 12);
    expect(roughnessFromVariance(10)).toBe(1);
    expect(fx("oceanShade.fragment.fx")).toContain("  return max((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);");
    expect(fx("waterLights.fragment.fx")).toContain("float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn);");
  });

  it("fades a drawn wave between four steps a wavelength and two, its variance moving to the roughness", () => {
    expect(resolvedShare(0)).toBe(1);
    expect(resolvedShare(Math.PI / 2)).toBe(1);
    expect(resolvedShare(0.75 * Math.PI)).toBeCloseTo(0.5, 12);
    expect(resolvedShare(Math.PI)).toBe(0);
    const wave = [{ amplitude: 0.5, k: 0.1 }];
    expect(resolvedSlopeVariance(wave, 0)).toBeCloseTo(0.00125, 12);
    expect(resolvedSlopeVariance(wave, 7.5 * Math.PI)).toBeCloseTo(0.0003125, 12);
    expect(resolvedSlopeVariance(wave, 10 * Math.PI)).toBe(0);
  });

  it("reads the roughness at Babylon's one roughness line, on the sea alone", () => {
    expect(OCEAN_ROUGHNESS_ANCHOR).toBe("!float roughness=reflectivityOut\\.roughness;");
    expect(OCEAN_ROUGHNESS_CODE).toBe("float roughness=min(sqrt(sqrt(2.0 * wOceanVar)), 1.0);");
    // A canary on the installed Babylon: the line is there, once.
    const pbr = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Shaders/pbr.fragment.js"), "utf8");
    expect(pbr.match(new RegExp(OCEAN_ROUGHNESS_ANCHOR.slice(1), "g"))).toHaveLength(1);
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const sea = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
      const lake = attachWater(new PBRMaterial("lake", scene), WATER_ROWS.lowlandLake);
      sea.ocean = bindingFor(scene, "medium");
      expect(sea.getCustomCode("fragment")![OCEAN_ROUGHNESS_ANCHOR]).toBe(OCEAN_ROUGHNESS_CODE);
      // An empty string injects nothing: the lake's line stays Babylon's own.
      expect(lake.getCustomCode("fragment")![OCEAN_ROUGHNESS_ANCHOR]).toBe("");
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));
});

describe("a lake's shaders", () => {
  it("process to the text they had before the sea moved", async () => {
    // Each hook through Babylon's preprocessor with a lake's gates, hashed as it was at 9edee7e.
    const before: Record<string, string> = {
      "water.vertex.fx": "3732482554b89e357fec2298edc8724ad085cc9defe35017b243df6b7782d50b",
      "waterWorldPos.vertex.fx": "d5bb8eb0b5c8047604fd2f58f00894c3968a427b29fa74daa73691917583dde3",
      "water.fragment.fx": "6c7a3933162a07f97a51c848e5f7cf34bd5095aa3c3778f2df0f1a0020808964",
      "waterLights.fragment.fx": "e43c7dd65420563ad94555469e69b237229563a6cf07e4ea5f86b53e73a1c5cb",
      "waterCompose.fragment.fx": "a3cdf837137ae07cea47e0facfbc0b6ad44269d7a723b9f157e487da0cf34447",
    };
    for (const [name, hash] of Object.entries(before)) {
      expect(sha256(await processed(fx(name), !name.includes(".vertex."))), name).toBe(hash);
    }
  });

  it("carry none of the sea's text: its definitions vanish under a lake's gates", async () => {
    const engine = new NullEngine();
    try {
      const lake = attachWater(new PBRMaterial("lake", new Scene(engine)), WATER_ROWS.lowlandLake);
      const v = lake.getCustomCode("vertex")!;
      const f = lake.getCustomCode("fragment")!;
      expect(await processed(v.CUSTOM_VERTEX_DEFINITIONS!, false)).toBe(await processed(fx("water.vertex.fx"), false));
      expect(await processed(f.CUSTOM_FRAGMENT_DEFINITIONS!, true)).toBe(await processed(fx("water.fragment.fx"), true));
    } finally {
      engine.dispose();
    }
  });
});

describe("the water material's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => {
    translators = await startTranslators();
  }, timeLimit(60_000));

  const translated = (effect: ProcessedEffect, defines: string): { vertex: string; fragment: string } => {
    const stage = (kind: "vertex" | "fragment", code: string): string =>
      translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
    return { vertex: stage("vertex", effect._vertexSourceCode), fragment: stage("fragment", effect._fragmentSourceCode) };
  };

  for (const tier of ["high", "medium", "low"] as const) {
    it(`compile through glslang and translate to WGSL for the sea on the ${tier} tier, its textures read at a fixed level, in order`, async () => {
      const sea = await waterEffect(tier);
      try {
        const { effect, defines } = sea;
        expect(defines).toContain("#define OCEAN");
        expect(defines.split("\n").includes("#define BUMP")).toBe(tier === "low");
        const v = effect._vertexSourceCode;
        const f = effect._fragmentSourceCode;
        // The displacement before worldPos, so it reaches the position, vPositionW and the view depth.
        const displaced = at(v, "positionUpdated += oceanDisplace(positionUpdated.xz);");
        expect(displaced).toBeGreaterThan(at(v, "vOceanXZ = positionUpdated.xz;"));
        expect(at(v, "vOceanXZ = positionUpdated.xz;")).toBeGreaterThan(at(v, "positionUpdated.xz -= oceanMorph * oceanCoarse;"));
        expect(displaced).toBeLessThan(at(v, "vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);"));
        // The swell's normal and the variance it leaves, then the rain's rings, the horizon clamp and
        // Fresnel; Babylon's roughness line, rewritten, after them all.
        const order = [
          "oceanSwellSum(vOceanXZ, wOceanDx, wOceanDy",
          "normalW = normalize(wOceanNormal",
          "float wOceanVar =",
          "if (waterRain > 0.0) {",
          "normalW = waterHorizonNormal(normalW, viewDirectionW);",
          "float wF = WATER_F0",
          OCEAN_ROUGHNESS_CODE,
        ].map((needle) => at(f, needle));
        for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1] as number);
        expect(f).not.toContain("float roughness=reflectivityOut.roughness;");
        expect(f).not.toContain("waterRipple2(vPositionW.xz)");
        // A stage that does not parse throws here, with glslang's message on stderr.
        const { vertex, fragment } = translated(effect, defines);
        expect(vertex).toContain("oceanAtlas");
        expect(vertex).toContain("oceanSwellSum");
        // WGSL allows no implicit-derivative sample in a vertex stage.
        expect(vertex).toMatch(/textureSampleLevel\(/);
        expect(vertex).not.toMatch(/textureSample\(/);
        // And the fragment stage reads the sea's textures at a fixed level only, so no read of theirs can
        // stand in non-uniform control flow.
        expect(fragment).toMatch(/textureSampleLevel\(\s*oceanAtlasTexture/);
        expect(fragment).not.toMatch(/textureSample(?:Bias|Grad|Compare)?\(\s*ocean/);
        expect(fragment).toContain("oceanSwellSum");
      } finally {
        sea.dispose();
      }
    }, timeLimit(120_000));
  }

  it("leave a lake's roughness line, its ripples and its vertices as they were", async () => {
    const lake = await waterEffect("medium", true);
    try {
      const f = lake.effect._fragmentSourceCode;
      expect(lake.defines).not.toContain("#define OCEAN");
      expect(f).toContain("float roughness=reflectivityOut.roughness;");
      expect(f).toContain("waterRipple2(vPositionW.xz)");
      expect(f).not.toContain("wOcean");
      expect(lake.effect._vertexSourceCode).not.toContain("oceanDisplace");
      translated(lake.effect, lake.defines);
    } finally {
      lake.dispose();
    }
  }, timeLimit(60_000));
});
```

The transcription `shaderSwell` is `oceanSwellSum` read into TypeScript line for line, reading the atlas as the nearest-sampled texture is read, texel centre by texel centre; while drafting, it gave `swellAt`'s numbers with a largest difference of exactly 0 at the 1,275 points, 249 of them breaking. The lake's hashes are each hook's text at 9edee7e through Babylon's preprocessor with a lake's gates (`WATER`, `BUMP`, `REFLECTION`, `SPECULARTERM`), computed while drafting; every line this release adds to those hooks, comments included, sits under `OCEAN`, so they hold through Tasks 12 and 13 too.

`client/test/game/waterPlugin.test.ts`, six edits on Task 10's text, each old → new:

Edit 1 — old:

```ts
import { WaterPlugin, attachWater, oceanArrayPlaceholder, type OceanBinding } from "../../src/game/waterPlugin.js";
```

new:

```ts
import { OCEAN_ROUGHNESS_ANCHOR, WaterPlugin, attachWater, oceanArrayPlaceholder, type OceanBinding } from "../../src/game/waterPlugin.js";
```

Edit 2 — old:

```ts
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual([
      "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION",
      "CUSTOM_FRAGMENT_BEFORE_LIGHTS",
      "CUSTOM_FRAGMENT_DEFINITIONS",
    ]);
```

new:

```ts
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual([
      OCEAN_ROUGHNESS_ANCHOR,
      "CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION",
      "CUSTOM_FRAGMENT_BEFORE_LIGHTS",
      "CUSTOM_FRAGMENT_DEFINITIONS",
    ]);
    // a lake's roughness line is left to Babylon
    expect(f[OCEAN_ROUGHNESS_ANCHOR]).toBe("");
```

Edit 3 — old:

```ts
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx") + fx("ocean.fragment.fx"));
```

new:

```ts
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("water.fragment.fx") + fx("ocean.fragment.fx") + fx("oceanSurface.fx") + fx("oceanShade.fragment.fx"));
```

Edit 4 — old:

```ts
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx"));
```

new:

```ts
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("water.vertex.fx") + fx("ocean.vertex.fx") + fx("oceanSurface.fx"));
```

Edit 5 — old:

```ts
  it("carries the rings' stitch and the position before the waves, and moves nothing yet", () => {
```

new:

```ts
  it("carries the rings' stitch and the position before the waves, and moves the vertex by them", () => {
```

Edit 6 — old:

```ts
    expect(displace).toContain("vOceanXZ = positionUpdated.xz;");
    expect(displace).not.toMatch(/positionUpdated\s*=/);
```

new:

```ts
    expect(displace).toContain("vOceanXZ = positionUpdated.xz;");
    // the waves move it, once (oceanShader.test.ts pins how)
    expect(displace).toContain("positionUpdated += oceanDisplace(positionUpdated.xz);");
```

`client/test/game/interStage.test.ts`, five edits in the `describe` Task 10 appended, each old → new (without the bump on high and medium the bump's UV leaves the sea's vertex outputs and its sampler the fragment stage):

Edit 1 — old:

```ts
  it("writes seven vertex outputs and reads front_facing, 8 of the 19, on every tier", () => {
```

new:

```ts
  it("writes seven vertex outputs on the low tier and six on high and medium, and reads front_facing: 8 and 7 of the 19", () => {
```

Edit 2 — old:

```ts
      expect(varyings, `${tier}: ${WEIGH_SEA}`).toEqual([
        "vec2 vMainUV1",
        "vec3 vPositionW",
```

new:

```ts
      // The bump's UV, on the low tier's sea alone: on high and medium the sea's
      // normal is its waves', and the material carries no bump.
      const bump = tier === "low";
      expect(varyings, `${tier}: ${WEIGH_SEA}`).toEqual([
        ...(bump ? ["vec2 vMainUV1"] : []),
        "vec3 vPositionW",
```

Edit 3 — old:

```ts
      expect(sea.effect._processingContext._varyingNextLocation, tier).toBe(7);
```

new:

```ts
      expect(sea.effect._processingContext._varyingNextLocation, tier).toBe(bump ? 7 : 6);
```

Edit 4 — old:

```ts
      expect(sea.effect._processingContext._varyingNextLocation + (frontFacing ? 1 : 0), `${tier}: ${WEIGH_SEA}`).toBe(8);
```

new:

```ts
      expect(sea.effect._processingContext._varyingNextLocation + (frontFacing ? 1 : 0), `${tier}: ${WEIGH_SEA}`).toBe(bump ? 8 : 7);
```

Edit 5 — old:

```ts
  it("binds the waves' textures within a stage's 16: two in the vertex stage, ten in the fragment stage", () => {
    for (const [tier, sea] of seas) {
      const { vertex, fragment } = stageBindings(sea.effect);
      expect({ vertex: [vertex.textures, vertex.samplers], fragment: [fragment.textures, fragment.samplers] }, tier).toEqual({
        vertex: [2, 2],
        fragment: [10, 10],
      });
```

new:

```ts
  it("binds the waves' textures within a stage's 16: two in the vertex stage, ten in the fragment stage on low, nine without the bump", () => {
    for (const [tier, sea] of seas) {
      const { vertex, fragment } = stageBindings(sea.effect);
      const textures = tier === "low" ? 10 : 9;
      expect({ vertex: [vertex.textures, vertex.samplers], fragment: [fragment.textures, fragment.samplers] }, tier).toEqual({
        vertex: [2, 2],
        fragment: [textures, textures],
      });
```

`client/test/game/waterMesh.test.ts`, two edits, each old → new:

Edit 1 — old:

```ts
    const water = createWater(scene, 0x5eed, 0, [], "medium", 0, 0, () => ms);
```

new:

```ts
    // The low tier's sea carries the bump; on high and medium its normal is its waves'.
    const water = createWater(scene, 0x5eed, 0, [], "low", 0, 0, () => ms);
```

Edit 2 — old:

```ts
    expect(bump.uOffset).toBeCloseTo(u0 + 0.5 * WATER_UV_SCROLL[0], 9);
    water.dispose();
  });
```

new:

```ts
    expect(bump.uOffset).toBeCloseTo(u0 + 0.5 * WATER_UV_SCROLL[0], 9);
    water.dispose();
  });

  it("keeps PBR's bump on the sea on the low tier alone, the sea's normal its waves' elsewhere, and on every lake", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    for (const tier of ["high", "medium", "low"] as const) {
      const water = createWater(scene, 0x5eed, 0, [lake()], tier);
      const sea = water.meshes[0]!.material as PBRMaterial;
      expect(sea.bumpTexture !== null, tier).toBe(tier === "low");
      expect((water.lakeMeshes[0]!.material as PBRMaterial).bumpTexture, tier).not.toBeNull();
      water.dispose();
    }
  }, timeLimit(60_000));
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanShader.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/interStage.test.ts`
Expected: FAIL with "ENOENT: no such file or directory, open '…/client/src/game/shaders/oceanSurface.fx'" and "TypeError: coxMunkVariance is not a function" (`oceanShader.test.ts`), "AssertionError: expected [ …(3) ] to deeply equal [ undefined, …(3) ]" (`waterPlugin.test.ts`: no `OCEAN_ROUGHNESS_ANCHOR` yet), "high: expected true to be false" (`waterMesh.test.ts`) and "high: … expected [ …(7) ] to deeply equal [ …(6) ]" (`interStage.test.ts`)

- [ ] **Step 3: Implement**

Create `client/src/game/shaders/oceanSurface.fx`:

```glsl
#ifdef OCEAN
// Water plugin, the sea's surface: spliced into the definitions of both
// stages, after the ocean's declarations (ocean.vertex.fx, ocean.fragment.fx).
// The vertex stage displaces the rings with it and the fragment stage shades
// with it. The swell's sum is swellAt's in oceanWaves.ts line for line: the
// same atlas rows, the same reads between texel centres, the same blend of
// the bay and the cove by the coastline's weight, the same cap, the same
// scale of steepness, the same foam.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror oceanPhysics.ts, oceanSwell.ts, oceanTables.ts,
// oceanWaves.ts, water.ts and waterShading.ts, and lockstep tests assert
// they agree. Every read is at level 0, which the atlas's only level is: a
// read at a fixed level needs no derivatives, so it is legal in any control
// flow on WebGPU, in the vertex stage and the fragment stage alike.
const float OCEAN_G = 9.81;
const float OCEAN_TWO_PI = 6.283185307179586;
const float OCEAN_D_MIN = -1000.0;
const float OCEAN_D_STEP = 1.0;
const float OCEAN_TABLE_SAMPLES = 1040.0;
const float OCEAN_ATLAS_ROWS = 28.0;
const float OCEAN_ROW_BAY_PROFILE = 0.0;
const float OCEAN_ROW_COVE_PROFILE = 1.0;
const float OCEAN_ROW_BAY_FIRST = 2.0;
const float OCEAN_ROW_COVE_FIRST = 14.0;
const float OCEAN_ROW_COMPONENTS = 26.0;
const float OCEAN_ROW_COAST = 27.0;
const float OCEAN_DRY_DEPTH = 0.05;
const float WEGGEL_GAMMA_MIN = 0.78;
const float WEGGEL_GAMMA_MAX = 1.56;
const float SWELL_Q_SUM_MAX = 0.9;
const float OCEAN_BORE_RATIO = 0.42;
const float OCEAN_BREAK_FULL = 1.5;
const float OCEAN_BREAK_FOAM_LO = 1.0;
const float OCEAN_BREAK_FOAM_HI = 1.3;
const float OCEAN_FOAM_LIFE = 20.0;
const float OCEAN_ROLL_WIDTH = 0.6;
const float OCEAN_INNER_FOAM = 0.5;
const float SHELTER_SWELL = 0.3;
const float SHELTER_CHOP = 0.15;
const float SHELTER_WIDTH = 40.0;
// A drawn wave keeps all of its share while its phase turns by at most a
// quarter turn over one step of the drawing (four steps a wavelength), and
// none of it from a half turn (two steps), where it would alias.
const float OCEAN_RESOLVE_PHASE_LO = 1.5707963267948966;
const float OCEAN_RESOLVE_PHASE_HI = 3.141592653589793;
// The finest ring's spacing, and how many of a ring's cells lie between the
// eye and the ring's inner edge (a quarter of its side).
const float OCEAN_RING_BASE = 1.0;
const float OCEAN_RING_REACH = 32.0;

// One texel of the atlas, at its centre: the atlas is sampled nearest.
vec4 oceanAtlasTexel(float row, float column) {
  return textureLod(oceanAtlas, vec2((column + 0.5) / OCEAN_TABLE_SAMPLES, (row + 0.5) / OCEAN_ATLAS_ROWS), 0.0);
}

// A row read at a fractional column, as atlasRead in oceanWaves.ts reads it:
// the column held to the table, linear between the two nearest texels.
vec4 oceanAtlasRead(float row, float column) {
  float c = clamp(column, 0.0, OCEAN_TABLE_SAMPLES - 1.0);
  float i0 = floor(c);
  vec4 a = oceanAtlasTexel(row, i0);
  vec4 b = oceanAtlasTexel(row, min(i0 + 1.0, OCEAN_TABLE_SAMPLES - 1.0));
  return a + (b - a) * (c - i0);
}

// A row over d, the distance from the coastline (negative at sea), at d.
vec4 oceanAtlasRow(float row, float d) {
  return oceanAtlasRead(row, (d - OCEAN_D_MIN) / OCEAN_D_STEP);
}

// The coastline's row at z, as coastRead has it: the coastline's x, its slope
// along z and the cove's weight. The row starts at oceanCoast.x and steps
// oceanCoast.y metres a texel. Named apart from the oceanCoast uniform, which
// shares its scope.
vec3 oceanCoastAt(float z) {
  return oceanAtlasRead(OCEAN_ROW_COAST, (z - oceanCoast.x) / oceanCoast.y).xyz;
}

// One headland's shadow at p, as shelterAt has it: the share of the height
// kept, keep deep in the lee and 1 outside it. The lee lies downstream of the
// tip, on the ridge's side the swell's along-shore travel points to, and past
// the swell's line through the tip, fading in over SHELTER_WIDTH metres.
float oceanShelterTip(vec2 p, vec2 tip, float keep) {
  vec2 u = oceanSwell.xy;
  vec2 r = p - tip;
  float side = u.y >= 0.0 ? 1.0 : -1.0;
  float on = step(0.0, dot(u, r)) * step(0.0, r.y * side);
  float lambda = -(u.x * r.y - u.y * r.x) * side;
  return 1.0 - (1.0 - keep) * smoothstep(0.0, SHELTER_WIDTH, lambda) * on;
}

// Both headlands' shelter at p, keep being SHELTER_SWELL or SHELTER_CHOP.
float oceanShelter(vec2 p, float keep) {
  return oceanShelterTip(p, oceanTips.xy, keep) * oceanShelterTip(p, oceanTips.zw, keep);
}

// The swell at the undisplaced point p: disp its displacement (x, height, z),
// normal its Gerstner normal, foam (foam, B, foamAge, depth) and drawn the
// slope variance its drawn waves carry. dpx and dpy are how far p moves over
// one step of the drawing, a pixel or a ring's cells: a component fades out
// of what is drawn as its phase turns by more than a quarter turn a step,
// gone at a half turn. With both zero nothing fades and the sum is exactly
// swellAt's. The envelope, the break and the foam are the whole swell's and
// never fade. The loops run to a constant 12 and stop at the count, a uniform.
void oceanSwellSum(vec2 p, vec2 dpx, vec2 dpy, out vec3 disp, out vec3 normal, out vec4 foam, out float drawn) {
  vec3 coast = oceanCoastAt(p.y);
  float d = p.x - coast.x;
  float column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  // Seaward of the table each phase runs on as the plane wave it is there.
  float deep = min(d - OCEAN_D_MIN, 0.0);
  vec4 bay = oceanAtlasRead(OCEAN_ROW_BAY_PROFILE, column);
  vec4 cove = oceanAtlasRead(OCEAN_ROW_COVE_PROFILE, column);
  float h = bay.x + (cove.x - bay.x) * coast.z;
  float a = bay.y + (cove.y - bay.y) * coast.z;
  float b = bay.z + (cove.z - bay.z) * coast.z;
  float shelter = oceanShelter(p, SHELTER_SWELL);
  float theta[12];
  theta[0] = oceanPhase0.x;
  theta[1] = oceanPhase0.y;
  theta[2] = oceanPhase0.z;
  theta[3] = oceanPhase0.w;
  theta[4] = oceanPhase1.x;
  theta[5] = oceanPhase1.y;
  theta[6] = oceanPhase1.z;
  theta[7] = oceanPhase1.w;
  theta[8] = oceanPhase2.x;
  theta[9] = oceanPhase2.y;
  theta[10] = oceanPhase2.z;
  theta[11] = oceanPhase2.w;
  float phi[12];
  float amp[12];
  float q0[12];
  vec2 kv[12];
  vec2 env = vec2(0.0);
  for (int c = 0; c < 12; c++) {
    float fc = float(c);
    if (fc >= oceanCoast.z) break;
    vec4 k = oceanAtlasTexel(OCEAN_ROW_COMPONENTS, 2.0 * fc);
    vec4 rb = oceanAtlasRead(OCEAN_ROW_BAY_FIRST + fc, column);
    vec4 rc = oceanAtlasRead(OCEAN_ROW_COVE_FIRST + fc, column);
    float psi = rb.x + (rc.x - rb.x) * coast.z + k.x * deep;
    float kn = rb.y + (rc.y - rb.y) * coast.z;
    float shoal = rb.z + (rc.z - rb.z) * coast.z;
    phi[c] = psi + k.x * coast.x + k.y * p.y + theta[c];
    kv[c] = vec2(kn, k.y + (k.x - kn) * coast.y);
    amp[c] = k.w * shoal * shelter;
    q0[c] = oceanAtlasTexel(OCEAN_ROW_COMPONENTS, 2.0 * fc + 1.0).x;
    env += amp[c] * vec2(cos(phi[c]), sin(phi[c]));
  }
  float envelope = length(env);
  float unbroken = 2.0 * envelope;
  float crestPhase = envelope > 0.0 ? atan(env.y, env.x) : 0.0;
  // No dry branch: over sand the depth is held at OCEAN_DRY_DEPTH, so the
  // swell there is the bore's few centimetres.
  float hc = max(h, OCEAN_DRY_DEPTH);
  float gamma = clamp(b - a * unbroken / (OCEAN_G * oceanSwell.z * oceanSwell.z), WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX);
  float ratio = unbroken / (gamma * hc);
  float scale = 1.0;
  if (ratio > 1.0) {
    float cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1.0, OCEAN_BREAK_FULL, ratio);
    scale = hc * cap / max(unbroken, 1.0e-6);
  }
  float breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);
  float steepness = 0.0;
  for (int c = 0; c < 12; c++) {
    if (float(c) >= oceanCoast.z) break;
    amp[c] *= scale;
    steepness += q0[c] * length(kv[c]) * amp[c];
  }
  float s = min(1.0, SWELL_Q_SUM_MAX / max(steepness, 1.0e-6));
  float height = 0.0;
  vec2 across = vec2(0.0);
  vec2 slope = vec2(0.0);
  float fold = 0.0;
  drawn = 0.0;
  for (int c = 0; c < 12; c++) {
    if (float(c) >= oceanCoast.z) break;
    float kmag = length(kv[c]);
    float turn = max(abs(dot(dpx, kv[c])), abs(dot(dpy, kv[c])));
    float A = amp[c] * (1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn));
    float Q = q0[c] * s;
    float sn = sin(phi[c]);
    float cs = cos(phi[c]);
    height += A * cs;
    across -= Q * A * kv[c] * sn / kmag;
    slope += A * kv[c] * sn;
    fold += Q * A * kmag * cs;
    drawn += 0.5 * (A * kmag) * (A * kmag);
  }
  disp = vec3(across.x, height, across.y);
  normal = normalize(vec3(slope.x, 1.0 - fold, slope.y));
  float foamAge = mod(-crestPhase, OCEAN_TWO_PI) / (OCEAN_TWO_PI / oceanSwell.z);
  float roll = breaking * (1.0 - smoothstep(0.0, OCEAN_ROLL_WIDTH, mod(crestPhase, OCEAN_TWO_PI)));
  float trailing = breaking * exp(-foamAge / OCEAN_FOAM_LIFE);
  foam = vec4(max(max(roll, trailing), breaking * OCEAN_INNER_FOAM), breaking, foamAge, h);
}

// The swell at p as swellAt has it, nothing faded.
void oceanSwellEval(vec2 p, out vec3 disp, out vec3 normal, out vec4 foam) {
  float drawn;
  oceanSwellSum(p, vec2(0.0), vec2(0.0), disp, normal, foam, drawn);
}

// The spacing of the ring that draws p, from p's distance to the eye: a ring
// of spacing s lies from 32 s to 64 s from the eye, so this is the ring's own
// spacing at its inner edge and the next ring's at its outer. It depends on
// the point alone, so two rings drawing one point displace it alike.
float oceanRingCell(vec2 p) {
  vec2 r = abs(p - vEyePosition.xz);
  return max(OCEAN_RING_BASE, max(r.x, r.y) / OCEAN_RING_REACH);
}

// The sea's displacement of a ring's vertex at p: a swell component under four
// of the ring's cells a wavelength is left to the pixels' normal, so no ring
// aliases it.
vec3 oceanDisplace(vec2 p) {
  float cell = oceanRingCell(p);
  vec3 disp;
  vec3 normal;
  vec4 foam;
  float drawn;
  oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn);
  return disp;
}
#endif
```

Create `client/src/game/shaders/oceanShade.fragment.fx`:

```glsl
#ifdef OCEAN
// Water plugin, the sea's shading: fragment definitions spliced after the
// sea's surface (oceanSurface.fx), for the code under OCEAN in
// waterLights.fragment.fx, waterCompose.fragment.fx and the roughness line.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror waterShading.ts and a lockstep test asserts they agree.
// Cox and Munk's slope variance, A + B U, and the least the sea keeps for its
// roughness however much the drawn waves carry: half the calm intercept, so
// a glassy sea's glint stays wider than a pixel.
const float WATER_COX_MUNK_A = 0.003;
const float WATER_COX_MUNK_B = 0.00512;
const float OCEAN_SLOPE_VAR_FLOOR = 0.0015;

// The slope variance the roughness carries: Cox and Munk's for the wind sea's
// wind, scaled by the shelter, less the variance the drawn waves already put
// in the normal.
float oceanUndrawnVariance(float u10, float shelter, float drawn) {
  return max((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}
#endif
```

`client/src/game/shaders/oceanDisplace.vertex.fx` (Task 10's file), one edit — old:

```glsl
vOceanXZ = positionUpdated.xz;
#endif
```

new:

```glsl
// A vertex in a ring's outer band first slides toward the coarser ring's
// lattice, by the band's weight (oceanMorph) along the half-edge to it
// (oceanCoarse): at the ring's edge the weight is whole and the vertex lies
// on a vertex of the coarser ring, which evaluates the same point, so no
// border cracks. The sea is evaluated once, at that point, which is the point
// the fragment stage shades. The ring's normal stays up: the sea's normal is
// made per pixel.
positionUpdated.xz -= oceanMorph * oceanCoarse;
vOceanXZ = positionUpdated.xz;
positionUpdated += oceanDisplace(positionUpdated.xz);
#endif
```

`client/src/game/shaders/waterLights.fragment.fx`, two edits, each old → new (every added line, comments too, under `OCEAN`; the `#else` branches are today's lines, so a lake's text is unchanged):

Edit 1 — old:

```glsl
float wDepth = waterBedDepth(vPositionW.xz);
```

new:

```glsl
#ifdef OCEAN
// The sea's swell at this pixel's undisplaced point, its drawn waves faded
// by the pixel's own footprint (the derivatives are taken here, in uniform
// control flow, before any branch). The depth is the displaced surface's
// over the bed, so the water's edge rises and falls with each wave.
vec2 wOceanDx = dFdx(vOceanXZ);
vec2 wOceanDy = dFdy(vOceanXZ);
vec3 wOceanDisp;
vec3 wOceanNormal;
vec4 wOceanFoam;
float wOceanDrawn;
oceanSwellSum(vOceanXZ, wOceanDx, wOceanDy, wOceanDisp, wOceanNormal, wOceanFoam, wOceanDrawn);
float wOceanChop = oceanShelter(vOceanXZ, SHELTER_CHOP);
float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;
#else
float wDepth = waterBedDepth(vPositionW.xz);
#endif
```

Edit 2 — old:

```glsl
if (waterOctaves > 1.5) {
  vec2 wSlope = waterRipple2(vPositionW.xz);
  normalW = normalize(normalW + vec3(wSlope.x, 0.0, wSlope.y));
}
```

new:

```glsl
#ifdef OCEAN
// The sea's normal is the swell's. PBR's bump is on the sea on the low tier
// alone, where its slope rides on the swell's: elsewhere normalW is still the
// ring's up and adds nothing. The second octave never runs on the sea.
vec2 wOceanExtra = normalW.xz / max(normalW.y, 0.05);
normalW = normalize(wOceanNormal + vec3(wOceanExtra.x, 0.0, wOceanExtra.y) * wOceanNormal.y);
// What Cox and Munk's slope variance for the wind leaves to the roughness
// once the drawn waves carry theirs, calmer in a headland's lee as the chop is.
float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn);
#else
if (waterOctaves > 1.5) {
  vec2 wSlope = waterRipple2(vPositionW.xz);
  normalW = normalize(normalW + vec3(wSlope.x, 0.0, wSlope.y));
}
#endif
```

`client/src/game/waterPlugin.ts`, three edits on Task 10's text, each old → new:

Edit 1 — old:

```ts
import oceanFragmentDefs from "./shaders/ocean.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";
```

new:

```ts
import oceanFragmentDefs from "./shaders/ocean.fragment.fx?raw";
import oceanSurface from "./shaders/oceanSurface.fx?raw";
import oceanShade from "./shaders/oceanShade.fragment.fx?raw";
import { WATER_F0, roughnessFor, type WaterRow } from "./waterShading.js";
```

Edit 2 — old:

```ts
/** The definitions each stage gets: the water's, then the sea's waves'
 * (each file ends in a newline, so no two lines join). */
const VERTEX_DEFINITIONS = vertexDefs + oceanVertexDefs;
const FRAGMENT_DEFINITIONS = fragmentDefs + oceanFragmentDefs;
```

new:

```ts
/** The definitions each stage gets: the water's, then the sea's declarations,
 * then the sea's surface, which both stages evaluate (`oceanSurface.fx`), and
 * in the fragment stage the sea's shading (each file ends in a newline, so no
 * two lines join). */
const VERTEX_DEFINITIONS = vertexDefs + oceanVertexDefs + oceanSurface;
const FRAGMENT_DEFINITIONS = fragmentDefs + oceanFragmentDefs + oceanSurface + oceanShade;

/**
 * Babylon 9.18's line that takes the reflectivity block's roughness, which
 * comes after CUSTOM_FRAGMENT_BEFORE_LIGHTS, where no roughness can be written
 * yet; and the sea's line in its place: the roughness of the slope variance
 * its normal leaves undrawn, per pixel (`wOceanVar`, waterLights.fragment.fx;
 * spec §7.3). The wet plugin rewrites the same line on the materials it wets;
 * the water never carries that plugin.
 */
export const OCEAN_ROUGHNESS_ANCHOR = "!float roughness=reflectivityOut\\.roughness;";
export const OCEAN_ROUGHNESS_CODE = "float roughness=min(sqrt(sqrt(2.0 * wOceanVar)), 1.0);";
```

Edit 3 — old:

```ts
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: fragmentCompose,
      };
```

new:

```ts
        CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: fragmentCompose,
        // Listed always: Babylon gathers a plugin's hook names once, when the
        // plugin is added. An empty string injects nothing, so a lake's line
        // stays Babylon's own.
        [OCEAN_ROUGHNESS_ANCHOR]: this._ocean !== null ? OCEAN_ROUGHNESS_CODE : "",
      };
```

`client/src/game/waterShading.ts`, two edits, each old → new:

Edit 1 — old:

```ts
import { CLUTTER_WATER_MURK_HI, CLUTTER_WATER_MURK_LO } from "../sim/clutter.js";
```

new:

```ts
import { CLUTTER_WATER_MURK_HI, CLUTTER_WATER_MURK_LO } from "../sim/clutter.js";
import { WATER_BASE_SPACING, WATER_RING_CELLS } from "./water.js";
```

Edit 2 — old:

```ts
/** Cox and Munk's slope variance, σ² = 0.003 + 0.00512 U, scaled by the body's shelter (§5.1). */
export function slopeVariance(wind01: number, shelter: number): number {
  const u = clamp01(wind01) * WATER_WIND_MAX;
  return (0.003 + 0.00512 * u) * clamp01(shelter);
}

/** PBR perceptual roughness from the slope variance: Beckmann α = √(2σ²), roughness = √α. */
export function roughnessFor(wind01: number, shelter: number): number {
  const alpha = Math.sqrt(2 * slopeVariance(wind01, shelter));
  return Math.sqrt(alpha);
}
```

new:

```ts
/** Cox and Munk's slope variance for a wind of U m/s: σ² = A + B·U. Mirrored in shaders/oceanShade.fragment.fx. */
export const WATER_COX_MUNK_A = 0.003;
export const WATER_COX_MUNK_B = 0.00512;

/** Cox and Munk's slope variance for a wind of `u10` m/s, the whole sea's. */
export function coxMunkVariance(u10: number): number {
  return WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10;
}

/** Cox and Munk's slope variance, σ² = 0.003 + 0.00512 U, scaled by the body's shelter (§5.1). */
export function slopeVariance(wind01: number, shelter: number): number {
  const u = clamp01(wind01) * WATER_WIND_MAX;
  return coxMunkVariance(u) * clamp01(shelter);
}

/** PBR perceptual roughness from the slope variance: Beckmann α = √(2σ²), roughness = √α. */
export function roughnessFor(wind01: number, shelter: number): number {
  const alpha = Math.sqrt(2 * slopeVariance(wind01, shelter));
  return Math.sqrt(alpha);
}

/**
 * The sea's roughness from the slope variance its normal leaves undrawn, per pixel in the shader (the
 * roughness line `waterPlugin.ts` rewrites): √√(2σ²) as `roughnessFor`, at most 1.
 */
export function roughnessFromVariance(variance: number): number {
  return Math.min(Math.sqrt(Math.sqrt(2 * Math.max(0, variance))), 1);
}

/**
 * The least slope variance the sea's roughness keeps however much of Cox and Munk's the drawn waves carry:
 * half their calm intercept, so a glassy sea's glint stays wider than a pixel. Mirrored in
 * shaders/oceanShade.fragment.fx.
 */
export const OCEAN_SLOPE_VAR_FLOOR = 0.0015;

/**
 * The slope variance left to the sea's roughness (spec §7.3): Cox and Munk's for the wind sea's wind
 * `u10` (m/s), scaled by the shelter, less `drawn`, the variance the drawn waves already put in the
 * normal; never under OCEAN_SLOPE_VAR_FLOOR. `oceanUndrawnVariance` in shaders/oceanShade.fragment.fx.
 */
export function undrawnSlopeVariance(u10: number, shelter: number, drawn: number): number {
  return Math.max(coxMunkVariance(u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}

/**
 * A drawn wave keeps all of its share while its phase turns by at most a quarter turn over one step of the
 * drawing (a pixel, or a ring's cells): four steps a wavelength; none from a half turn, two steps, where it
 * would alias. Mirrored in shaders/oceanSurface.fx.
 */
export const OCEAN_RESOLVE_PHASE_LO = Math.PI / 2;
export const OCEAN_RESOLVE_PHASE_HI = Math.PI;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The share of a wave the drawing keeps when its phase turns by `turn` radians over one step. */
export function resolvedShare(turn: number): number {
  return 1 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn);
}

/**
 * The slope variance the drawn waves carry when each is drawn over steps of `step` metres along its own
 * direction: Σ ½(a·k·share)², a sinusoid of amplitude a and wavenumber k carrying ½(a·k)², faded by
 * `resolvedShare(k·step)`. With a step of 0 it is the waves' whole variance.
 */
export function resolvedSlopeVariance(waves: readonly { amplitude: number; k: number }[], step: number): number {
  let sum = 0;
  for (const { amplitude, k } of waves) {
    const a = amplitude * resolvedShare(k * step);
    sum += 0.5 * (a * k) * (a * k);
  }
  return sum;
}

/**
 * The spacing (m) of the ring that draws a point (dx, dz) from the eye, as the vertex shader estimates it
 * (`oceanRingCell`): a ring of spacing s lies from OCEAN_RING_REACH·s to twice that from the eye, so the
 * estimate is the ring's own spacing at its inner edge and the next ring's at its outer, never under the
 * finest ring's. It depends on the point alone, so two rings drawing one point displace it alike.
 */
export const OCEAN_RING_REACH = WATER_RING_CELLS / 4;
export function oceanRingCell(dx: number, dz: number): number {
  return Math.max(WATER_BASE_SPACING, Math.max(Math.abs(dx), Math.abs(dz)) / OCEAN_RING_REACH);
}
```

`client/src/game/renderer.ts`, one edit — old:

```ts
  const bump = createWaterBump(scene);
  seaMat.bumpTexture = bump;
  for (const mat of lakeMats) mat.bumpTexture = bump;
```

new:

```ts
  const bump = createWaterBump(scene);
  // The sea's normal is its waves' on high and medium (oceanSurface.fx): PBR's
  // bump stays on the low tier's sea alone, where it draws the wind sea, and on
  // every lake.
  if (tier === "low") seaMat.bumpTexture = bump;
  for (const mat of lakeMats) mat.bumpTexture = bump;
```

Checked while drafting, against Tasks 1–10 as drafted (their code applied to a scratch copy of this worktree, Task 10's `waterPlugin.ts` edits applied verbatim): `oceanShader.test.ts` 18 of 18 and Task 10's `waterPlugin.test.ts` 27 of 27 pass with this task's code; the sea's stages on every tier compile through glslang and translate through twgsl with no message; the vertex WGSL samples with `textureSampleLevel` only, the fragment WGSL reads `oceanAtlasTexture` with `textureSampleLevel` only. Note for whoever extends these tests: twgsl under Node does not report a non-uniform `textureSample` inside Babylon's PBR stages (a probe read under a branch on `vOceanXZ` translated silently; the same read in a bare shader is reported), which is why the guarantee here is structural, explicit-level reads, pinned on the WGSL, rather than a check of twgsl's messages.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanShader.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/interStage.test.ts test/game/oceanRender.test.ts test/game/shaderHygiene.test.ts test/game/waterShading.test.ts test/game/wetPlugin.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/waterPlugin.ts client/src/game/waterShading.ts client/src/game/renderer.ts client/test/game/oceanShader.test.ts client/test/game/waterPlugin.test.ts client/test/game/waterMesh.test.ts client/test/game/interStage.test.ts`
Expected: PASS (18 tests in `oceanShader.test.ts`, 27 in `waterPlugin.test.ts`, 25 in `waterMesh.test.ts`, 11 in `interStage.test.ts`; `shaderHygiene.test.ts` lints and preprocesses `oceanSurface.fx` and `oceanShade.fragment.fx` with their gate on)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/shaders/oceanSurface.fx client/src/game/shaders/oceanShade.fragment.fx client/src/game/shaders/oceanDisplace.vertex.fx client/src/game/shaders/waterLights.fragment.fx client/src/game/waterPlugin.ts client/src/game/waterShading.ts client/src/game/renderer.ts client/test/game/oceanShader.test.ts client/test/game/waterPlugin.test.ts client/test/game/interStage.test.ts client/test/game/waterMesh.test.ts
git commit -F - <<'EOF'
feat: draw the swell on the sea, displaced and shaded per pixel

## What

The sea's material evaluates the seeded swell from the atlas, the same sum
swellAt takes, in both stages: the vertex stage slides each ring vertex
onto the coarser ring's lattice by its border weight and displaces it there
once, so no ring border cracks; the fragment stage builds the normal from
the swell's slopes, compares the displaced surface with the bed for the
water's edge and the transmission, and takes its roughness per pixel from
the slope variance Cox and Munk give the wind less what the drawn waves
carry. A wave too short for a ring's cells or a pixel fades out of what is
drawn into the roughness. PBR's bump stays on the low tier's sea alone; the
lakes' shaders are the text they were.

## How

- `client/src/game/shaders/oceanSurface.fx` — the atlas reads, the coastline,
  the shelter, the swell's sum with its fade, the ring's cell and the
  displacement, spliced into both stages, every read at level 0.
- `client/src/game/shaders/oceanShade.fragment.fx` — the undrawn slope
  variance.
- `client/src/game/shaders/oceanDisplace.vertex.fx` — the stitch's slide,
  the undisplaced point, the displacement before worldPos.
- `client/src/game/shaders/waterLights.fragment.fx` — the swell at the
  pixel, the displaced depth, the swell's normal in place of the ripples.
- `client/src/game/waterPlugin.ts` — the new files in the definitions, the
  roughness line rewritten on the sea alone.
- `client/src/game/waterShading.ts` — Cox and Munk's terms, the remainder,
  the fade and the ring's cell, mirrored for the tests.
- `client/src/game/renderer.ts` — the bump on the low tier's sea alone.
- `client/test/game/oceanShader.test.ts` — constants in lockstep, the sum
  against swellAt, the order of the stages, the lakes' text, every tier's
  stages through glslang and twgsl.
- `client/test/game/waterPlugin.test.ts`, `client/test/game/interStage.test.ts`,
  `client/test/game/waterMesh.test.ts` — the roughness hook, the sea's
  definitions, the stitch, 7 of 19 varyings and 9 fragment textures without
  the bump, the bump by tier.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 12: The white water

**Files:**
- Modify: `client/src/game/shaders/oceanShade.fragment.fx` (Task 11's file: before its closing `#endif`)
- Modify: `client/src/game/shaders/waterLights.fragment.fx` (after the skin's block, its last lines)
- Modify: `client/src/game/shaders/waterCompose.fragment.fx:15`
- Modify: `client/src/game/waterShading.ts` (Task 11's text: the imports, after `oceanRingCell`)
- Modify: `client/src/game/renderer.ts:853` (`createWater`, the sea's plugin)
- Modify: `client/test/game/oceanShader.test.ts` (Task 11's text: the `waterShading.js` import, the compiled stages' test; a `describe` appended)
- Modify: `client/test/game/waterMesh.test.ts:108`

**Interfaces:**
- Consumes:
  - Task 11: in `waterLights.fragment.fx` under `OCEAN`, `wOceanFoam` (foam, B, foamAge, depth), `wOceanDx`, `wOceanDy`; `oceanShelter(vec2 p, float keep)`, `SHELTER_CHOP`, `OCEAN_FOAM_LIFE` (`oceanSurface.fx`); the helpers of `oceanShader.test.ts` (`fx`, `pinned`, `at`, `waterEffect`).
  - `water.fragment.fx`: `float waterSkinHash(vec2 p)` and `float waterSkinNoise(vec2 p)`, the water's sine-free hash and value noise (decided: reused, not a second hash beside them), and the skin's layer in `waterLights.fragment.fx` and `waterCompose.fragment.fx`, whose structure the foam's mirrors.
  - The plugin's uniforms `waterSkin` (y: the seed's offset; the sea's x stays 0, its skin off), `waterTime` (the sea's seconds), `waterWindTime` (the wind's integral); Task 10's `oceanWind.w` (Callaghan's coverage) and `oceanSwell.xy` (the swell's travel).
  - `waterSkinOffset(seed)` (`waterShading.ts`); Task 8's `OCEAN_FOAM_LIFE`.
- Produces:
  - `oceanShade.fragment.fx`: constants `OCEAN_FOAM_ALBEDO` (0.8), `OCEAN_FOAM_ALBEDO_OLD` (0.5), `OCEAN_LACE_TILE` (3 m), `OCEAN_LACE_DRIFT` (0.4 m/s), `OCEAN_LACE_SOFT` (0.06), `OCEAN_CAP_CELL` (5 m), `OCEAN_CAP_PERIOD` (5 s), `OCEAN_CAP_RADIUS` (0.3), `OCEAN_CAP_INSET` (0.3), `OCEAN_CAP_DRIFT` (2), `OCEAN_CAP_SHARE` (0.1028), `OCEAN_CAP_SOFT` (0.4); `float oceanLace(vec2 p)` (two octaves of ridged noise, a net drifting with the swell's travel, seeded by `waterSkin.y`); `float oceanFoamCover(vec2 p, float foam, float pixel)` (the foam's amount through the lace: a sheet when fresh and full, thinning lines as it ages; its mean beyond a few pixels a cell); `float oceanFoamWhite(float foamAge)` (0.8 fresh, falling toward 0.5 over `OCEAN_FOAM_LIFE`: with the lace's cover, a fresh patch about 40 % white over the surface and old lace a few percent, spec §5); `float oceanCapCoverage(vec2 p)` (Callaghan's coverage, cut in the lee); `float oceanCapThreshold(float coverage)` (a Gaussian sea's height, in standard deviations, over that share of the surface: Abramowitz and Stegun 26.2.23); `float oceanWhitecap(vec2 p, float crest)` (the shared definitions': white over the coverage's top share of a drawn wind sea's crests, `crest` its height at p in standard deviations); `float oceanCapCells(vec2 p)` (the same coverage where no wind sea is drawn: a cap a cell, firing with the chance coverage / `OCEAN_CAP_SHARE` each cycle, flashing and fading, the low tier's for good). **Decided:** this task defines `oceanWhitecap`'s statistic and draws `oceanCapCells` on every tier; Task 13 feeds `oceanWhitecap` the wind sea's crests on medium and high and adds the FFT's folds (`oceanWindFold`) on high.
  - `waterLights.fragment.fx` under `OCEAN`, after the skin's block: `float wOceanLace`, `float wOceanCap` (`oceanCapCells`, then × (1 − B): the broken waves eat the chop), `float wFoam` (the larger), `float wFoamWhite`; the matte layer: `surfaceAlbedo` toward the foam's white, `wTransmit` × (1 − wFoam), `alpha` toward 1, `normalW` toward up. `waterCompose.fragment.fx` under `OCEAN`: the sky's reflection and the sun's glint × (1 − wFoam).
  - `waterShading.ts`: the constants above, `foamWhite(foamAge: number): number`, `laceCover(ridge: number, foam: number): number`, `whitecapThreshold(coverage: number): number`, `capProfile(r: number): number`.
  - `renderer.ts`: the sea's plugin `skin = [0, waterSkinOffset(seed)]` (its skin still off; its offset seeds the lace and the caps).
  - No varying, attribute, uniform or sampler added: the white water reads uniforms and functions the water already has.

- [ ] **Step 1: Write the failing test**

`client/test/game/oceanShader.test.ts`, two edits, each old → new:

Edit 1 — old:

```ts
import {
  OCEAN_RESOLVE_PHASE_HI, OCEAN_RESOLVE_PHASE_LO, OCEAN_RING_REACH, OCEAN_SLOPE_VAR_FLOOR, WATER_COX_MUNK_A,
  WATER_COX_MUNK_B, WATER_ROWS, coxMunkVariance, oceanRingCell, resolvedShare, resolvedSlopeVariance, roughnessFor,
  roughnessFromVariance, slopeVariance, undrawnSlopeVariance,
} from "../../src/game/waterShading.js";
```

new:

```ts
import {
  OCEAN_CAP_CELL, OCEAN_CAP_DRIFT, OCEAN_CAP_INSET, OCEAN_CAP_PERIOD, OCEAN_CAP_RADIUS, OCEAN_CAP_SHARE, OCEAN_CAP_SOFT,
  OCEAN_FOAM_ALBEDO, OCEAN_FOAM_ALBEDO_OLD, OCEAN_LACE_DRIFT, OCEAN_LACE_SOFT, OCEAN_LACE_TILE,
  OCEAN_RESOLVE_PHASE_HI, OCEAN_RESOLVE_PHASE_LO, OCEAN_RING_REACH, OCEAN_SLOPE_VAR_FLOOR, WATER_COX_MUNK_A,
  WATER_COX_MUNK_B, WATER_ROWS, capProfile, coxMunkVariance, foamWhite, laceCover, oceanRingCell, resolvedShare,
  resolvedSlopeVariance, roughnessFor, roughnessFromVariance, slopeVariance, undrawnSlopeVariance, whitecapThreshold,
} from "../../src/game/waterShading.js";
```

Edit 2 — old:

```ts
        expect(fragment).toContain("oceanSwellSum");
      } finally {
        sea.dispose();
```

new:

```ts
        expect(fragment).toContain("oceanSwellSum");
        expect(fragment).toContain("oceanFoamCover");
        expect(fragment).toContain("oceanCapCells");
      } finally {
        sea.dispose();
```

Then append to the end of `client/test/game/oceanShader.test.ts`:

```ts
describe("the white water", () => {
  it("holds the TypeScript's look and cap numbers", () => {
    const f = fx("oceanShade.fragment.fx");
    const look: [string, number][] = [
      ["OCEAN_FOAM_ALBEDO", OCEAN_FOAM_ALBEDO], ["OCEAN_FOAM_ALBEDO_OLD", OCEAN_FOAM_ALBEDO_OLD],
      ["OCEAN_LACE_TILE", OCEAN_LACE_TILE], ["OCEAN_LACE_DRIFT", OCEAN_LACE_DRIFT], ["OCEAN_LACE_SOFT", OCEAN_LACE_SOFT],
      ["OCEAN_CAP_CELL", OCEAN_CAP_CELL], ["OCEAN_CAP_PERIOD", OCEAN_CAP_PERIOD], ["OCEAN_CAP_RADIUS", OCEAN_CAP_RADIUS],
      ["OCEAN_CAP_INSET", OCEAN_CAP_INSET], ["OCEAN_CAP_DRIFT", OCEAN_CAP_DRIFT], ["OCEAN_CAP_SHARE", OCEAN_CAP_SHARE],
      ["OCEAN_CAP_SOFT", OCEAN_CAP_SOFT],
    ];
    for (const [name, value] of look) pinned(f, name, value);
    for (const signature of [
      "float oceanLace(vec2 p)", "float oceanFoamCover(vec2 p, float foam, float pixel)", "float oceanFoamWhite(float foamAge)",
      "float oceanCapCoverage(vec2 p)", "float oceanCapThreshold(float coverage)", "float oceanWhitecap(vec2 p, float crest)",
      "float oceanCapCells(vec2 p)",
    ]) expect(f).toContain(signature);
  });

  it("whitens fresh foam to 0.8 and old foam toward 0.5, through a lace that is a sheet when full and nothing when gone", () => {
    expect(foamWhite(0)).toBeCloseTo(0.8, 12);
    expect(foamWhite(20)).toBeCloseTo(0.6103638, 6);
    expect(foamWhite(1000)).toBeCloseTo(0.5, 9);
    expect(laceCover(1, 0)).toBe(0);
    expect(laceCover(0.5, 0)).toBe(0);
    expect(laceCover(0.06, 1)).toBe(1);
    expect(laceCover(0.5, 0.5)).toBe(0);
    expect(laceCover(0.56, 0.5)).toBe(1);
    const f = fx("oceanShade.fragment.fx");
    expect(f).toContain("  float lace = smoothstep(1.0 - foam, 1.0 - foam + OCEAN_LACE_SOFT, oceanLace(p));");
    expect(f).toContain("  return mix(OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_ALBEDO, exp(-foamAge / OCEAN_FOAM_LIFE));");
    // The lace drifts with the swell's travel and is offset by the world's seed, the sea's waterSkin.y.
    expect(f).toContain("  vec2 q = p + waterSkin.y - oceanSwell.xy * (OCEAN_LACE_DRIFT * waterTime);");
  });

  it("puts the whitecaps over Callaghan's share of a Gaussian sea's crests", () => {
    expect(Math.abs(whitecapThreshold(0.1) - 1.28155)).toBeLessThan(1e-3);
    expect(Math.abs(whitecapThreshold(0.01) - 2.32635)).toBeLessThan(1e-3);
    expect(Math.abs(whitecapThreshold(0.001) - 3.09023)).toBeLessThan(1e-3);
    expect(Math.abs(whitecapThreshold(0.5))).toBeLessThan(1e-3);
    expect(fx("oceanShade.fragment.fx")).toContain(
      "  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1.0 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);",
    );
  });

  it("gives the low tier's cells Callaghan's coverage by construction: a fired cap covers OCEAN_CAP_SHARE of its cell", () => {
    // The cap's profile over its cell by the midpoint rule, times its mean brightness over a cycle.
    const n = 1000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = (i + 0.5) / n - 0.5;
        const z = (j + 0.5) / n - 0.5;
        sum += capProfile(Math.hypot(x, z) / OCEAN_CAP_RADIUS);
      }
    }
    expect(Math.abs((sum / (n * n)) * 0.5 - OCEAN_CAP_SHARE)).toBeLessThan(1e-4);
    // A cap stays inside its cell: its centre is inset by at least its radius.
    expect(OCEAN_CAP_INSET).toBeGreaterThanOrEqual(OCEAN_CAP_RADIUS);
    const f = fx("oceanShade.fragment.fx");
    expect(f).toContain("  float fire = step(waterSkinHash(h + vec2(mod(k, 97.0) * 3.0, 7.0)), oceanCapCoverage(p) / OCEAN_CAP_SHARE);");
    expect(f).toContain("  return fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));");
  });

  it("lays the white water over the sea as the skin lies over a lake: after the transmission, matte in the compose", () => {
    const l = fx("waterLights.fragment.fx");
    const layer = at(l, "float wFoam = max(wOceanLace, wOceanCap);");
    expect(layer).toBeGreaterThan(at(l, "if (waterSkin.x > 0.0) {"));
    expect(layer).toBeGreaterThan(at(l, "wTransmit = wBed * wT * (1.0 - wF);"));
    // The swell's foam through its lace, and the caps, which the broken waves eat.
    expect(at(l, "float wOceanLace = oceanFoamCover(vOceanXZ, wOceanFoam.x, max(length(wOceanDx), length(wOceanDy)));")).toBeLessThan(layer);
    expect(at(l, "wOceanCap *= 1.0 - wOceanFoam.y;")).toBeLessThan(layer);
    // Then the matte layer: albedo toward the foam's white, transmission held, alpha toward 1, normal toward up.
    for (const line of [
      "surfaceAlbedo = mix(surfaceAlbedo, vec3(wFoamWhite), wFoam);",
      "wTransmit *= 1.0 - wFoam;",
      "alpha = mix(alpha, 1.0, wFoam);",
      "normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wFoam));",
    ]) expect(at(l, line)).toBeGreaterThan(layer);
    const c = fx("waterCompose.fragment.fx");
    const foam = at(c, "finalRadianceScaled *= 1.0 - wFoam;");
    expect(c).toContain("finalSpecularScaled *= 1.0 - wFoam;");
    expect(foam).toBeGreaterThan(at(c, "#ifdef OCEAN"));
    expect(foam).toBeLessThan(at(c, "finalEmissive += wTransmit;"));
  });
});
```

`client/test/game/waterMesh.test.ts`, one edit — old:

```ts
    expect((sea.pluginManager!.getPlugin("Water") as WaterPlugin).skin).toEqual([0, 0]);
```

new:

```ts
    // the sea's skin stays off; its offset seeds the white water's pattern
    expect((sea.pluginManager!.getPlugin("Water") as WaterPlugin).skin).toEqual([0, waterSkinOffset(1)]);
```

`OCEAN_CAP_SHARE`: the cap's profile 1 − smoothstep(0.7, 1, r/R) over its cell is 2πR²·0.3635 = 0.205554 of it at R = 0.3 (∫₀^0.7 ρ dρ = 0.245, plus 0.3·(0.7·½ + 0.3·0.15) = 0.1185 over the edge), times ½, its mean brightness over a cycle: 0.102777, written 0.1028. The thresholds against the exact inverse normal: 1.281729 for 0.1 (1.281552), 2.326785 for 0.01 (2.326348), 3.090522 for 0.001 (3.090232).

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanShader.test.ts test/game/waterMesh.test.ts`
Expected: FAIL with "expected '…' to contain 'const float OCEAN_FOAM_ALBEDO = 0.8;'" and "TypeError: foamWhite is not a function" (`oceanShader.test.ts`) and "expected [ +0, +0 ] to deeply equal [ +0, 0.731 ]" (`waterMesh.test.ts`)

- [ ] **Step 3: Implement**

`client/src/game/shaders/oceanShade.fragment.fx`, one edit — old:

```glsl
float oceanUndrawnVariance(float u10, float shelter, float drawn) {
  return max((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}
#endif
```

new:

```glsl
float oceanUndrawnVariance(float u10, float shelter, float drawn) {
  return max((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}

// The white water's look: fresh foam's albedo and old foam's, the lace's
// cell (m), its drift along the swell's travel (m/s) and its edge's softness.
const float OCEAN_FOAM_ALBEDO = 0.8;
const float OCEAN_FOAM_ALBEDO_OLD = 0.5;
const float OCEAN_LACE_TILE = 3.0;
const float OCEAN_LACE_DRIFT = 0.4;
const float OCEAN_LACE_SOFT = 0.06;
// The whitecaps where no wind sea is drawn: a cap a cell (m), each cell's
// cycle (s), a cap's radius and its centre's least inset (in cells), the
// cells' drift down the wind (m/s), and the cover a cell gives when its cap
// fires every cycle, its area's share times its mean brightness.
const float OCEAN_CAP_CELL = 5.0;
const float OCEAN_CAP_PERIOD = 5.0;
const float OCEAN_CAP_RADIUS = 0.3;
const float OCEAN_CAP_INSET = 0.3;
const float OCEAN_CAP_DRIFT = 2.0;
const float OCEAN_CAP_SHARE = 0.1028;
// The whitecaps on a drawn wind sea: their soft edge, in standard deviations
// of its height.
const float OCEAN_CAP_SOFT = 0.4;

// The foam's lace at p: two octaves of ridged noise, near 1 along the lines
// of a net, drifting with the swell's travel and offset by the world's seed
// (the sea's waterSkin.y, its skin itself off).
float oceanLace(vec2 p) {
  vec2 q = p + waterSkin.y - oceanSwell.xy * (OCEAN_LACE_DRIFT * waterTime);
  float a = 1.0 - abs(2.0 * waterSkinNoise(q / OCEAN_LACE_TILE) - 1.0);
  float b = 1.0 - abs(2.0 * waterSkinNoise(q / (0.37 * OCEAN_LACE_TILE) + 19.0) - 1.0);
  return 0.65 * a + 0.35 * b;
}

// The share of the surface the foam covers: its amount through the lace, a
// sheet where it is fresh and full, a net of thinning lines as it ages. Where
// a lace cell spans under a few pixels the amount stands in for it, so the
// net never shimmers.
float oceanFoamCover(vec2 p, float foam, float pixel) {
  float lace = smoothstep(1.0 - foam, 1.0 - foam + OCEAN_LACE_SOFT, oceanLace(p));
  return mix(lace, foam, smoothstep(0.1, 0.4, pixel / OCEAN_LACE_TILE));
}

// The foam's albedo by its age: fresh foam's, falling to old foam's.
float oceanFoamWhite(float foamAge) {
  return mix(OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_ALBEDO, exp(-foamAge / OCEAN_FOAM_LIFE));
}

// The whitecaps' coverage at p: Callaghan's for the wind (oceanWind.w), less
// in a headland's lee as the chop is.
float oceanCapCoverage(vec2 p) {
  return oceanWind.w * oceanShelter(p, SHELTER_CHOP);
}

// How many standard deviations above its mean a Gaussian sea's height stands
// over the coverage's share of the surface: Abramowitz and Stegun's 26.2.23,
// within 4.5e-4.
float oceanCapThreshold(float coverage) {
  float s = sqrt(-2.0 * log(clamp(coverage, 1.0e-6, 0.5)));
  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1.0 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);
}

// A whitecap at p on a drawn wind sea whose height there is crest standard
// deviations above its mean: white over the coverage's top share of the
// crests, so the caps cover what Callaghan's fraction says and flash and
// fade as each crest rises through the threshold and falls back.
float oceanWhitecap(vec2 p, float crest) {
  float coverage = oceanCapCoverage(p);
  float t = oceanCapThreshold(coverage);
  return smoothstep(t - 0.5 * OCEAN_CAP_SOFT, t + 0.5 * OCEAN_CAP_SOFT, crest) * step(1.0e-6, coverage);
}

// Whitecaps where no wind sea is drawn, the same coverage by construction: a
// cap a cell, its centre and its cycle's phase hashed from the cell (folded
// to 512, as the rain's rings are), the cells drifting down the wind. In each
// cycle the cap fires with the chance coverage over OCEAN_CAP_SHARE, flashes
// white and fades through the cycle. The cycle folds by the hour, a whole
// number of cycles in it.
float oceanCapCells(vec2 p) {
  vec2 q = (p + waterSkin.y - waterWindTime * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;
  vec2 c = floor(q);
  vec2 h = mod(c, 512.0);
  vec2 centre = vec2(waterSkinHash(h + vec2(13.0, 0.0)), waterSkinHash(h + vec2(0.0, 57.0))) * (1.0 - 2.0 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;
  float cycle = mod(waterTime, 3600.0) / OCEAN_CAP_PERIOD + waterSkinHash(h);
  float k = floor(cycle);
  float fire = step(waterSkinHash(h + vec2(mod(k, 97.0) * 3.0, 7.0)), oceanCapCoverage(p) / OCEAN_CAP_SHARE);
  float r = length(q - c - centre) / OCEAN_CAP_RADIUS;
  return fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));
}
#endif
```

`client/src/game/shaders/waterLights.fragment.fx`, one edit — old (the skin's block, the file's last lines):

```glsl
if (waterSkin.x > 0.0) {
  surfaceAlbedo = mix(surfaceAlbedo, waterSkinColour(vPositionW.xz, vWaterViewDepth), wSkin);
  wTransmit *= 1.0 - wSkin;
  alpha = mix(alpha, 1.0, wSkin);
  normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wSkin));
}
```

new:

```glsl
if (waterSkin.x > 0.0) {
  surfaceAlbedo = mix(surfaceAlbedo, waterSkinColour(vPositionW.xz, vWaterViewDepth), wSkin);
  wTransmit *= 1.0 - wSkin;
  alpha = mix(alpha, 1.0, wSkin);
  normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wSkin));
}
#ifdef OCEAN
// The white water, a matte layer over the sea the way the skin is over a
// lake: the swell's foam through its lace, and the whitecaps, which the
// broken waves eat shoreward of the break. Its albedo is the foam's by its
// age, a whitecap's fresh.
float wOceanLace = oceanFoamCover(vOceanXZ, wOceanFoam.x, max(length(wOceanDx), length(wOceanDy)));
float wOceanCap = oceanCapCells(vOceanXZ);
wOceanCap *= 1.0 - wOceanFoam.y;
float wFoam = max(wOceanLace, wOceanCap);
float wFoamWhite = wOceanLace >= wOceanCap ? oceanFoamWhite(wOceanFoam.z) : OCEAN_FOAM_ALBEDO;
surfaceAlbedo = mix(surfaceAlbedo, vec3(wFoamWhite), wFoam);
wTransmit *= 1.0 - wFoam;
alpha = mix(alpha, 1.0, wFoam);
normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wFoam));
#endif
```

`client/src/game/shaders/waterCompose.fragment.fx`, one edit — old:

```glsl
finalEmissive += wTransmit;
```

new:

```glsl
#ifdef OCEAN
// The white water is matte too.
#ifdef REFLECTION
finalRadianceScaled *= 1.0 - wFoam;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= 1.0 - wFoam;
#endif
#endif
finalEmissive += wTransmit;
```

`client/src/game/waterShading.ts`, two edits on Task 11's text, each old → new:

Edit 1 — old:

```ts
import { WATER_BASE_SPACING, WATER_RING_CELLS } from "./water.js";
```

new:

```ts
import { WATER_BASE_SPACING, WATER_RING_CELLS } from "./water.js";
import { OCEAN_FOAM_LIFE } from "./oceanWaves.js";
```

Edit 2 — old:

```ts
export function oceanRingCell(dx: number, dz: number): number {
  return Math.max(WATER_BASE_SPACING, Math.max(Math.abs(dx), Math.abs(dz)) / OCEAN_RING_REACH);
}
```

new:

```ts
export function oceanRingCell(dx: number, dz: number): number {
  return Math.max(WATER_BASE_SPACING, Math.max(Math.abs(dx), Math.abs(dz)) / OCEAN_RING_REACH);
}

/**
 * The white water's look (spec §5): fresh foam's albedo and old foam's, under the lace that thins the
 * cover itself (fresh foam reflects about 40 % of the surface it lies on, old foam 3 to 10 %: its albedo
 * times the share the lace covers); the lace's cell (m), its drift along the swell's travel (m/s) and its
 * edge's softness. Mirrored in shaders/oceanShade.fragment.fx.
 */
export const OCEAN_FOAM_ALBEDO = 0.8;
export const OCEAN_FOAM_ALBEDO_OLD = 0.5;
export const OCEAN_LACE_TILE = 3;
export const OCEAN_LACE_DRIFT = 0.4;
export const OCEAN_LACE_SOFT = 0.06;

/**
 * The whitecaps where no wind sea is drawn (the low tier, `oceanCapCells`): a cap a cell (m), each cell's
 * cycle (s), a cap's radius and its centre's least inset (in cells), the cells' drift down the wind (m/s
 * of the wind's integral), and OCEAN_CAP_SHARE, the cover a cell gives when its cap fires every cycle:
 * the cap's profile integrated over the cell (`capProfile`, 0.2056 of it) times its mean brightness over
 * the cycle (it fades linearly, ½). A cap fires with the chance coverage / OCEAN_CAP_SHARE, so the mean
 * cover is Callaghan's coverage by construction. And OCEAN_CAP_SOFT, the soft edge (in standard
 * deviations of its height) of the caps on a drawn wind sea (`oceanWhitecap`). Mirrored in
 * shaders/oceanShade.fragment.fx.
 */
export const OCEAN_CAP_CELL = 5;
export const OCEAN_CAP_PERIOD = 5;
export const OCEAN_CAP_RADIUS = 0.3;
export const OCEAN_CAP_INSET = 0.3;
export const OCEAN_CAP_DRIFT = 2;
export const OCEAN_CAP_SHARE = 0.1028;
export const OCEAN_CAP_SOFT = 0.4;

/** The foam's albedo at an age (s): fresh foam's, falling to old foam's over OCEAN_FOAM_LIFE (`oceanFoamWhite`). */
export function foamWhite(foamAge: number): number {
  const fresh = Math.exp(-foamAge / OCEAN_FOAM_LIFE);
  return OCEAN_FOAM_ALBEDO_OLD + (OCEAN_FOAM_ALBEDO - OCEAN_FOAM_ALBEDO_OLD) * fresh;
}

/** The lace's cover where the ridged noise is `ridge` (0 to 1) and the foam's amount `foam`: none at no
 * foam, nearly all of it at a full amount (`oceanFoamCover`'s threshold). */
export function laceCover(ridge: number, foam: number): number {
  return smoothstep(1 - foam, 1 - foam + OCEAN_LACE_SOFT, ridge);
}

/** How many standard deviations above its mean a Gaussian sea's height stands over a `coverage` share of
 * its surface: Abramowitz and Stegun's 26.2.23, within 4.5e-4, the coverage held to [1e-6, 0.5]
 * (`oceanCapThreshold`). */
export function whitecapThreshold(coverage: number): number {
  const s = Math.sqrt(-2 * Math.log(Math.min(Math.max(coverage, 1e-6), 0.5)));
  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);
}

/** A whitecap's brightness at `r` of its radius from its centre (`oceanCapCells`). */
export function capProfile(r: number): number {
  return 1 - smoothstep(0.7, 1, r);
}
```

`client/src/game/renderer.ts`, one edit (the line Task 10's own edit also follows; this goes directly under it) — old:

```ts
  const seaPlugin = attachWater(seaMat, WATER_ROWS.sea);
```

new:

```ts
  const seaPlugin = attachWater(seaMat, WATER_ROWS.sea);
  // The sea's skin stays off (x = 0); its offset seeds the white water's lace
  // and whitecaps (oceanShade.fragment.fx), so two worlds' foam differs.
  seaPlugin.skin = [0, waterSkinOffset(seed)];
```

Checked while drafting, against Tasks 1–11 as drafted: `oceanShader.test.ts` 23 of 23 pass; the sea's stages on every tier compile and translate, the foam's and the caps' functions in the fragment WGSL; a lake's hooks hash as before.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanShader.test.ts test/game/waterMesh.test.ts test/game/waterPlugin.test.ts test/game/shaderHygiene.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/waterShading.ts client/src/game/renderer.ts client/test/game/oceanShader.test.ts client/test/game/waterMesh.test.ts`
Expected: PASS (23 tests in `oceanShader.test.ts`, 25 in `waterMesh.test.ts`, 27 in `waterPlugin.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/shaders/oceanShade.fragment.fx client/src/game/shaders/waterLights.fragment.fx client/src/game/shaders/waterCompose.fragment.fx client/src/game/waterShading.ts client/src/game/renderer.ts client/test/game/oceanShader.test.ts client/test/game/waterMesh.test.ts
git commit -F - <<'EOF'
feat: the surf's white water and the open sea's whitecaps

## What

Where the swell breaks the sea turns white: the spilling roll on a broken
crest's front, the foam behind it thinning over twenty seconds from a sheet
to a lace that drifts with the bore, and the inner surf's floor, laid over
the water as a matte layer the way a murky lake's skin is, fresh foam near
white and old foam greyer. Whitecaps cover Callaghan's fraction of the sea
for the wind, cut in a headland's lee and shoreward of the break: over a
drawn wind sea's crests by the share of a Gaussian sea above a threshold,
and where none is drawn as caps that flash and fade in drifting cells.

## How

- `client/src/game/shaders/oceanShade.fragment.fx` — the lace, the foam's
  cover and whiteness, the coverage, its threshold, the crests' caps and
  the cells' caps.
- `client/src/game/shaders/waterLights.fragment.fx` — the matte layer after
  the transmission: albedo, transmission, alpha and normal.
- `client/src/game/shaders/waterCompose.fragment.fx` — no reflection or
  glint under the foam.
- `client/src/game/waterShading.ts` — the white water's numbers, mirrored.
- `client/src/game/renderer.ts` — the sea's offset seeds the pattern.
- `client/test/game/oceanShader.test.ts`, `client/test/game/waterMesh.test.ts`
  — the numbers in lockstep, the cells' coverage by construction, the
  thresholds, the layer's order, the sea's seed.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 13: The wind sea on each tier

**Files:**
- Create: `client/src/game/oceanLoopBake.ts`
- Create: `client/src/game/oceanLoop.worker.ts`
- Create: `client/src/game/oceanWindSource.ts`
- Modify: `client/src/game/shaders/oceanSurface.fx`, `client/src/game/shaders/oceanShade.fragment.fx`, `client/src/game/shaders/waterLights.fragment.fx` (Tasks 11 and 12's text)
- Modify: `client/src/game/waterShading.ts` (Task 12's text: after `capProfile`)
- Modify: `client/src/game/waterPlugin.ts` (Task 10's text: `OceanBinding`, `OCEAN_UNIFORMS`, the bound values)
- Modify: `client/src/game/oceanRender.ts` (Task 10's text: imports, `createOcean`, its binding, `update`, `dispose`)
- Modify: `client/test/architecture.test.ts:445` (`BABYLON_FREE_FILES`)
- Modify: `client/test/game/oceanShader.test.ts` (Tasks 11 and 12's text; a `describe` appended), `client/test/game/waterPlugin.test.ts` (Task 10's appended tests), `client/test/game/oceanRender.test.ts` (Task 10's import; a `describe` appended)
- Test: `client/test/game/oceanLoopBake.test.ts`, `client/test/game/oceanWindSource.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 2 (`oceanSpectrum.ts`): `LOOP_N` (128), `LOOP_SIZE` (60), `LOOP_FRAMES` (64), `LOOP_SECONDS` (20), `FFT_N` (256), `FFT_CASCADES` ([1000, 150, 25]), `WIND_SEA_HS_COEFF`, `WIND_SEA_FP_COEFF`, `WIND_SEA_GAMMA` (defined there), `cascadeBands(sizes, n)` (kMin₀ = 0), `jonswap(f, fp, hs, gamma)`, `windSeaH0(n, size, { u10, dir }, band, seed, repeat = WIND_SEA_REPEAT)` (each bin's ω rounded to a multiple of 2π/repeat; the bins' variance scaled to the band's share ∫S df); (`oceanFft.ts`) `WIND_SEA_CHOPPINESS` (1), `windSeaFields(h0, n, size, t, choppiness)` (`height`, `dx`, `dz`, `slopeX`, `slopeZ`, `jacobian`; sample (col, row) at (x, z) = (col, row)·size/n), `type SpectrumH0`.
  - Task 3 (`oceanGpuFft.ts`, imported dynamically): `createGpuWindSea(engine: AbstractEngine): GpuWindSea | null` (null unless WebGPU with compute: so on NullEngine), `type GpuWindSea = { disp; slope; setSpectrum(state: { u10: number; dir: [number, number] }, seed: number): void; step(seconds: number): void; status(): "compiling" | "running" | "failed"; dispose(): void }`; `disp` layer c = (height, λ·dx, λ·dz, Jacobian) and `slope` layer c = (slopeX, slopeZ, 0, 0), rgba16float, bilinear, wrap, sampled at uv = xz / `FFT_CASCADES[c]`; `step` once a frame before the scene renders (the ocean's `update`, from `Water.update` in the renderer's sync, runs before `scene.render()`).
  - Task 9 (`oceanWindSea.ts`): `WIND_SEA_U_REF` (10), `WIND_SEA_U_FLOOR` (0.5), `windSeaStateFor(wind01, dir, hour): WindSeaState` (`u10`, `dir`, `hs` = 0.28·u10²/g, `nearShore`, `coverage`, `loopScale` = (u10/10)², `loopRate` = 10/max(u10, 0.5)).
  - Task 10: `oceanRender.ts` as written (its `binding`, `update`, the array placeholder, `wind[2]` left to this task), `OceanBinding`, `OCEAN_UNIFORMS`, the uniforms' binding loop, the test setup `nullEngineArrays.ts` (NullEngine's `createRawTexture2DArray`).
  - The pivot: `coveFor(seed).z0` (`client/src/sim/olympic.ts`, as Task 8 reads it) and Task 7's `coastProfilesFor(seed).coastlineX`, which `createOcean` already holds as `profiles`; `WIND_DIR_PERIOD` (1,200 s, `windParams.ts`, test).
  - Tasks 11 and 12: `oceanSurface.fx` (`oceanDisplace`, `oceanRingCell`, `oceanSwellSum`, `OCEAN_RESOLVE_PHASE_LO/HI`, `OCEAN_TWO_PI`), `oceanShade.fragment.fx` (`oceanCapCoverage`, `oceanWhitecap`, `oceanCapCells`, the Cox and Munk constants), `waterLights.fragment.fx`'s locals (`wOceanChop`, `wOceanFoam`, `wOceanDx`, `wOceanDy`, `wOceanExtra`, `wOceanDrawn`, `wOceanCap`).
- Produces:
  - `oceanLoopBake.ts` (Babylon-free, on `BABYLON_FREE_FILES`): `type LoopRequest = { seed: number }`; `type LoopReply = { seed; frames; n; size; heightStd; slopeVar; data: Uint16Array<ArrayBuffer> }`; `toHalf(value: number): number`, `fromHalf(bits: number): number`; `loopSpectrum(seed: number): SpectrumH0` (the cascade at `WIND_SEA_U_REF` along +x, `repeat` = `LOOP_SECONDS`: every frequency a whole number of turns in the loop, so it closes exactly); `loopFrame(spectrum: SpectrumH0, t: number): Float32Array` ((height, dx, dz, 0) a texel); `bakeWindSeaLoop(seed: number): Uint16Array<ArrayBuffer>` (the shared definitions': `LOOP_FRAMES` × `LOOP_N`² × 4 half floats, frame f at f·LOOP_SECONDS/LOOP_FRAMES; about 0.5 s); `loopStats(data: Uint16Array, frame: number): { heightStd: number; slopeVar: number }` (as the shaders draw it: the heights' standard deviation, the central differences' mean square); `loopReply(request: LoopRequest): LoopReply`; `windSeaBandStats(u10: number, band: { kMin: number; kMax: number }): { heightVar: number; slopeVar: number }` (∫S df and ∫k²S df over the band, Simpson, as `windSeaH0` normalises).
  - `oceanLoop.worker.ts` (Babylon-free): a module worker answering one `LoopRequest` with `postMessage(reply, { transfer: [reply.data.buffer] })`. Vite bundles it from `new Worker(new URL("./oceanLoop.worker.ts", import.meta.url), { type: "module" })` with no change to `vite.config.ts` (none exists in the repository yet; Vite's default worker build serves a module worker).
  - `oceanWindSource.ts` (Babylon): `WIND_SEA_RESPECTRUM_U = 0.5`; `type WindSeaMode = 0 | 1 | 2`; `type WindSeaSource = { readonly mode; readonly disp: BaseTexture | null; readonly slope: BaseTexture | null; readonly stats: [number, number, number, number]; readonly loopTime: number; update(state: WindSeaState, seconds: number): void; dispose(): void }`; `type LoopStarter = (seed: number) => Promise<LoopReply>`, `type GpuStarter = (scene: Scene) => Promise<GpuWindSea | null>`; `startLoopWorker(seed)` (rejects where there is no `Worker`, as under Node), `startGpuWindSea(scene)` (`await import("./oceanGpuFft.js")`, so the WebGL2 tiers' bundle carries no compute); `needsRespectrum(lastU10: number | null, u10: number): boolean`; `cascadeStats(u10: number): [number, number, number, number]`; `createWindSeaSource(scene, seed, tier, startLoop = startLoopWorker, startGpu = startGpuWindSea): WindSeaSource`. Low: mode 0, nothing asked. Medium: the loop in the worker, uploaded as a `RawTexture2DArray` (RGBA, half float, bilinear, wrap, no mips, `LOOP_FRAMES` layers) when it answers, mode 0 until then and 1 after; its time run at `loopRate`, folded to `LOOP_SECONDS`, advancing only while a loop is drawn. High: the FFT, mode 2, its spectrum always along +x (`dir` [1, 0]) and rebuilt when u10 moves by 0.5 m/s or more, `step(seconds)` every frame; where `createGpuWindSea` gives null, the import fails, or `status()` turns `"failed"`, the medium loop (mode 0 until it answers).
  - **Decided, the step:** the spectrum is never rebuilt for the wind's turning. Both fields are made with the wind along +x and the shaders sample them in the wind's frame (`oceanWindFrame`), as the shared definitions have the loop sampled; so the high tier rebuilds (about 20 ms on the main thread) only when the speed moves by `WIND_SEA_RESPECTRUM_U`, where the wind's full turn every 20 minutes would ask for it every few seconds at a 5° step. **Decided, the pivot:** the fields turn about the cove's waterline centre, not the world's origin (uniform `oceanWindPivot`, x = the coastline's x at the cove's z0, z = z0, from `coastProfilesFor(seed)` and `coveFor(seed)` at `createOcean`). A turning field slides at r·dθ/dt, r from the point it turns about, with the wind's turn 2π/1,200 s = 0.3°/s: about the origin, some 250 m from the cove, the chop would slide sideways at 1.3 m/s on the beach the player stands on; about the pivot it does not move there, slides 0.26 m/s at 50 m and 0.52 m/s at 100 m, and far out is a slow 0.3°/s turn of fine texture. The low tier's bump does not use the frame (PBR's own UVs, scrolled as today).
  - Two new uniforms (UBO and both strings, through Task 10's `OCEAN_UNIFORMS`, now ten; zeros without an ocean): `vec4 oceanWindStats` with `OceanBinding.windStats: [number, number, number, number]`, the drawn field's height standard deviation (m) at the wind before the near-shore cut, then each field's slope variance (the loop's in y, or the three cascades' in y, z, w); and `vec4 oceanWindPivot` with `OceanBinding.windPivot: [number, number, number, number]`, the pivot (x, z, 0, 0) the fields turn about (no free slot holds two floats: `oceanWindDir.w` is the only spare).
  - `createOcean(scene, seed, tier, wind: { startLoop?: LoopStarter; startGpu?: GpuStarter } = {}): Ocean`; the `Ocean`'s `windDisp`, `windSlope`, `windMode` now follow the binding (getters); `update` writes `windDisp`/`windSlope` (the field's, else the placeholder), `coast[3]` = mode, `wind[2]` = the loop's time, `windStats`; `windPivot` written once, at `createOcean`.
  - `oceanSurface.fx`: `LOOP_N`, `LOOP_SIZE`, `LOOP_FRAMES`, `LOOP_SECONDS`, `FFT_N`, `FFT_CASCADE_0..2`, `WIND_SEA_HS_COEFF`, `OCEAN_LOOP_SCALE_MIN` (0.0025), `OCEAN_WIND_TILE_CELLS` (16); `float oceanWindAmp()` (the cut height over the fully developed height: the near-shore cut), `vec2 oceanWindFrame(vec2 p)` (p − `oceanWindPivot.xy`, turned to the wind: the identity's origin at the pivot), `vec2 oceanFromWind(vec2 v)`, `float oceanLoopSize()`, `vec3 oceanLoopRead(vec2 uv)` (two frames blended about the loop's time), `float oceanWindRingKeep(float size, float cell)`, `vec3 oceanWindDisplaceAt(vec2 p, float cell)`, `vec3 oceanWindDisplace(vec2 p)` (the shared definitions'; unfaded, uncut); `oceanDisplace` adds the wind sea × `oceanWindAmp()` × (1 − B) × the chop's shelter. **Decided, the damping by the break:** the swell's B from the same evaluation multiplies the chop by (1 − B), in the vertex and the fragment stage alike, and the shelter by `SHELTER_CHOP`.
  - `oceanShade.fragment.fx`: `OCEAN_FOLD` (0.4), `OCEAN_FOLD_FULL` (0.3), `OCEAN_BUMP_HS` (1 m), `OCEAN_BUMP_MAX` (2); `float oceanCapDamp(vec2 p)` (the lee × the near-shore cut, which `oceanCapCoverage` now takes); `float oceanWindPixelKeep(float size, float n, float pixel)`; `vec2 oceanWindSlopesAt(vec2 p, float pixel, out float drawn)` (high: the slope texture's three cascades, each faded by the pixel; medium: the loop's heights, two taps an axis a texel apart, faded; the normal's horizontal part, minus the gradient); `vec2 oceanWindSlopes(vec2 p)` (the shared definitions', unfaded); `float oceanWindFold(vec2 p)` (high: the least of the three cascades' Jacobians from `disp.w`; 1 elsewhere); `float oceanBumpScale(float breaking, float shelter)` (**decided, the low tier's factor:** the bump's slope × min(Hs·nearShore·(1 − B)·shelter / 1 m, 2): glassy at a calm dawn, Hs 0.04 m, doubled at most in a storm); `float oceanWindSlopeLimit(float u10, float shelter, float drawn)` (**decided:** the drawn chop's slopes are held to Cox and Munk's whole variance for the wind, since one bake scaled to every wind keeps a strong wind's steepness in a light one, where the sea should be glassy).
  - `waterLights.fragment.fx` under `OCEAN`: `float wWindAmp`, `vec3 wWind`, `float wWindDrawn`, `vec2 wWindSlope`, `float wWindSteep`; the water's edge with the chop's height; the normal with the chop's slopes; the roughness less their variance; on medium and high the caps on the wind sea's crests (`wWind.y / oceanWindStats.x` standard deviations), on high also its folds, on low the cells.
  - `waterShading.ts`: `OCEAN_WIND_TILE_CELLS`, `OCEAN_LOOP_SCALE_MIN`, `OCEAN_FOLD`, `OCEAN_FOLD_FULL`, `OCEAN_BUMP_HS`, `OCEAN_BUMP_MAX`, `windRingKeep(size, cell)`, `windPixelKeep(size, n, pixel)`, `foldCap(jacobian)`, `bumpScale(hsCut, breaking, shelter)`, `windSlopeLimit(u10, shelter, drawn)`, `windFrame(px, pz, dirX, dirZ, pivotX, pivotZ): [number, number]` (`oceanWindFrame`'s mirror).
  - The limits: two vec4 uniforms more; no varying, attribute or sampler (the fields use Task 10's `oceanWindDisp` in both stages and `oceanWindSlope` in the fragment): 2 of 16 vertex textures, 9 (high, medium) and 10 (low) of 16 fragment textures, 7 and 8 of 19 varyings, as Task 11 left them.

- [ ] **Step 1: Write the failing test**

Create `client/test/game/oceanLoopBake.test.ts`:

```ts
// client/test/game/oceanLoopBake.test.ts
import { describe, it, expect, vi } from "vitest";
import { LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE, cascadeBands, windSeaH0 } from "../../src/game/oceanSpectrum.js";
import { WIND_SEA_CHOPPINESS, windSeaFields } from "../../src/game/oceanFft.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import {
  bakeWindSeaLoop, fromHalf, loopFrame, loopSpectrum, loopStats, toHalf, windSeaBandStats, type LoopReply,
} from "../../src/game/oceanLoopBake.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 0x5eed;

/** A frame's heights, decoded, scaled. */
function heights(data: Uint16Array, frame: number, scale: number): Float64Array {
  const n = LOOP_N * LOOP_N;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fromHalf(data[(frame * n + i) * 4] as number) * scale;
  return out;
}

function std(values: ArrayLike<number>): number {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    sumSq += (values[i] as number) * (values[i] as number);
  }
  const mean = sum / values.length;
  return Math.sqrt(sumSq / values.length - mean * mean);
}

describe("half floats", () => {
  it("round to nearest, ties to even, and read back", () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(70000)).toBe(0x7c00);
    expect(toHalf(0.1)).toBe(0x2e66);
    expect(fromHalf(0x2e66)).toBe(0.0999755859375);
    expect(toHalf(2 ** -24)).toBe(1);
    expect(toHalf(1e-7)).toBe(2);
    expect(toHalf(0)).toBe(0);
    for (const v of [0.5, -1.25, 3.14159, 2.7, -0.001]) expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) * 2 ** -11);
  });
});

describe("the medium tier's loop", () => {
  it("closes: the frame at LOOP_SECONDS is the first, within half-float precision", () => {
    const spectrum = loopSpectrum(SEED);
    const first = loopFrame(spectrum, 0);
    const last = loopFrame(spectrum, LOOP_SECONDS);
    let largest = 0;
    let apart = 0;
    let sameHalf = 0;
    for (let i = 0; i < first.length; i++) {
      largest = Math.max(largest, Math.abs(first[i] as number));
      apart = Math.max(apart, Math.abs((first[i] as number) - (last[i] as number)));
      if (toHalf(first[i] as number) === toHalf(last[i] as number)) sameHalf++;
    }
    // Metres of sea, not a flat field: the bake draws waves.
    expect(largest).toBeGreaterThan(1);
    // Half precision at a metre is a thousandth; the frames differ by a hundredth of that.
    expect(apart).toBeLessThan(1e-4);
    expect(sameHalf / first.length).toBeGreaterThan(0.99);
  }, timeLimit(60_000));

  it("bakes LOOP_FRAMES frames of LOOP_N² texels, (height, dx, dz, 0) in half floats, frame f at f·LOOP_SECONDS/LOOP_FRAMES", () => {
    const data = bakeWindSeaLoop(SEED);
    expect(data.length).toBe(LOOP_FRAMES * LOOP_N * LOOP_N * 4);
    expect(data.length).toBe(4_194_304);
    const spectrum = loopSpectrum(SEED);
    const layer = LOOP_N * LOOP_N * 4;
    for (const f of [0, 17, 63]) {
      const frame = loopFrame(spectrum, (f * LOOP_SECONDS) / LOOP_FRAMES);
      for (const i of [0, 1, 2, 3, 4097, 30001, layer - 1]) expect(data[f * layer + i], `frame ${f}, ${i}`).toBe(toHalf(frame[i] as number));
    }
    for (let i = 3; i < data.length; i += 4 * 997) expect(data[i]).toBe(0);
  }, timeLimit(60_000));

  it("serves every wind: scaled to 15 m/s it has the significant height of the sea made at 15 m/s on the scaled tile, within 10 %", () => {
    const state = windSeaStateFor(15 / 12, [1, 0], 12);
    expect(state.u10).toBe(15);
    expect(state.loopScale).toBe(2.25);
    const baked = 4 * std(heights(bakeWindSeaLoop(SEED), 0, state.loopScale));
    const size = LOOP_SIZE * state.loopScale;
    const band = cascadeBands([size], LOOP_N)[0] as { kMin: number; kMax: number };
    const h0 = windSeaH0(LOOP_N, size, { u10: 15, dir: [1, 0] }, band, SEED, LOOP_SECONDS);
    const direct = 4 * std(windSeaFields(h0, LOOP_N, size, 0, WIND_SEA_CHOPPINESS).height);
    expect(direct).toBeGreaterThan(1);
    expect(Math.abs(baked / direct - 1)).toBeLessThan(0.1);
  }, timeLimit(60_000));

  it("measures the height and the slope the shaders draw: a sinusoid's standard deviation and its central differences", () => {
    const data = new Uint16Array(LOOP_N * LOOP_N * 4);
    for (let row = 0; row < LOOP_N; row++) {
      for (let col = 0; col < LOOP_N; col++) data[(row * LOOP_N + col) * 4] = toHalf(Math.cos((2 * Math.PI * 4 * col) / LOOP_N));
    }
    const stats = loopStats(data, 0);
    expect(stats.heightStd).toBeCloseTo(0.70713, 4);
    // ½ (sin(kΔ)/Δ)², k = 2π·4/LOOP_SIZE, Δ = LOOP_SIZE/LOOP_N: a hair under ½k².
    expect(stats.slopeVar).toBeCloseTo(0.086614, 5);
  });
});

describe("the wind sea's band shares", () => {
  it("are the spectrum's: below 1 Hz at 10 m/s the whole sea, (Hs/4)²; the cascades' three add to their span", () => {
    const below1Hz = windSeaBandStats(10, { kMin: 0, kMax: (2 * Math.PI) ** 2 / 9.81 });
    expect(below1Hz.heightVar).toBeCloseTo(0.50908, 4);
    expect(Math.abs(below1Hz.heightVar / 0.509164 - 1)).toBeLessThan(0.001);
    expect(below1Hz.slopeVar).toBeCloseTo(0.011626, 5);
    const bands = cascadeBands([1000, 150, 25], 256);
    const each = bands.map((band) => windSeaBandStats(10, band));
    const whole = windSeaBandStats(10, { kMin: 0, kMax: (bands[2] as { kMax: number }).kMax });
    expect(each.reduce((s, b) => s + b.heightVar, 0)).toBeCloseTo(whole.heightVar, 5);
    expect(each.reduce((s, b) => s + b.slopeVar, 0)).toBeCloseTo(whole.slopeVar, 5);
    expect(windSeaBandStats(0, bands[0] as { kMin: number; kMax: number })).toEqual({ heightVar: 0, slopeVar: 0 });
  });
});

describe("the loop's worker", () => {
  it("answers a seed with the loop and its numbers, the buffer transferred", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("self", { postMessage });
    try {
      await import("../../src/game/oceanLoop.worker.js");
      const scope = (globalThis as unknown as { self: { onmessage: (event: { data: { seed: number } }) => void } }).self;
      scope.onmessage({ data: { seed: 7 } });
      expect(postMessage).toHaveBeenCalledTimes(1);
      const [reply, options] = postMessage.mock.calls[0] as [LoopReply, { transfer: ArrayBuffer[] }];
      expect(Object.keys(reply).sort()).toEqual(["data", "frames", "heightStd", "n", "seed", "size", "slopeVar"]);
      expect([reply.seed, reply.frames, reply.n, reply.size]).toEqual([7, LOOP_FRAMES, LOOP_N, LOOP_SIZE]);
      expect(reply.data.length).toBe(4_194_304);
      expect(reply.heightStd).toBeGreaterThan(0);
      expect(reply.slopeVar).toBeGreaterThan(0);
      const measured = loopStats(reply.data, 0);
      expect([reply.heightStd, reply.slopeVar]).toEqual([measured.heightStd, measured.slopeVar]);
      expect(options.transfer).toHaveLength(1);
      expect(options.transfer[0]).toBe(reply.data.buffer);
    } finally {
      vi.unstubAllGlobals();
    }
  }, timeLimit(60_000));
});
```

Create `client/test/game/oceanWindSource.test.ts`:

```ts
// client/test/game/oceanWindSource.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import {
  WIND_SEA_RESPECTRUM_U, cascadeStats, createWindSeaSource, needsRespectrum, type GpuStarter, type LoopStarter,
} from "../../src/game/oceanWindSource.js";
import type { GpuWindSea } from "../../src/game/oceanGpuFft.js";
import type { LoopReply } from "../../src/game/oceanLoopBake.js";
import { LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE } from "../../src/game/oceanSpectrum.js";
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import { oceanArrayPlaceholder } from "../../src/game/waterPlugin.js";
import { timeLimit } from "../helpers/timeLimit.js";

const SEED = 0x5eed;

/** A bake's answer with the loop's sizes and numbers to tell apart. */
function reply(seed: number): LoopReply {
  return {
    seed, frames: LOOP_FRAMES, n: LOOP_N, size: LOOP_SIZE, heightStd: 0.8, slopeVar: 0.03,
    data: new Uint16Array(LOOP_FRAMES * LOOP_N * LOOP_N * 4),
  };
}

/** A GPU wind sea that records what it is asked, its status the test's to set. */
function fakeGpu(scene: Scene) {
  let status: ReturnType<GpuWindSea["status"]> = "running";
  return {
    disp: oceanArrayPlaceholder(scene),
    slope: oceanArrayPlaceholder(scene),
    setSpectrum: vi.fn<GpuWindSea["setSpectrum"]>(),
    step: vi.fn<GpuWindSea["step"]>(),
    status: (): ReturnType<GpuWindSea["status"]> => status,
    dispose: vi.fn<GpuWindSea["dispose"]>(),
    fail(): void {
      status = "failed";
    },
  };
}

let engine: NullEngine;
afterEach(() => engine?.dispose());

describe("the wind sea's field by tier", () => {
  it("bakes the loop in a module worker, in the form Vite bundles, and imports the compute on the high tier's path alone", () => {
    const source = readFileSync(new URL("../../src/game/oceanWindSource.ts", import.meta.url), "utf8");
    expect(source).toContain('new Worker(new URL("./oceanLoop.worker.ts", import.meta.url), { type: "module" })');
    expect(source).toContain('await import("./oceanGpuFft.js")');
    expect(source).not.toMatch(/^import \{[^\n]*from "\.\/oceanGpuFft\.js";$/m);
  });

  it("rebuilds the FFT's spectrum only when the wind's speed moves by half a metre a second", () => {
    expect(WIND_SEA_RESPECTRUM_U).toBe(0.5);
    expect(needsRespectrum(null, 10)).toBe(true);
    expect(needsRespectrum(10, 10.49)).toBe(false);
    expect(needsRespectrum(10, 10.5)).toBe(true);
    expect(needsRespectrum(10, 9.5)).toBe(true);
  });

  it("normalises the FFT by its cascades' shares: the three heights make the whole sea's at 10 m/s", () => {
    const stats = cascadeStats(10);
    expect(stats[0]).toBeCloseTo(0.713557, 5);
    expect(stats[1]).toBeCloseTo(0.0027272, 6);
    expect(stats[2]).toBeCloseTo(0.0049297, 6);
    expect(stats[3]).toBeCloseTo(0.0099255, 6);
  });

  it("draws nothing on the low tier, and asks for no field", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>(() => Promise.resolve(reply(SEED)));
    const startGpu = vi.fn<GpuStarter>(() => Promise.resolve(null));
    const source = createWindSeaSource(scene, SEED, "low", startLoop, startGpu);
    await Promise.resolve();
    source.update(windSeaStateFor(0.5, [1, 0], 12), 10);
    expect([source.mode, source.disp, source.slope, source.loopTime]).toEqual([0, null, null, 0]);
    expect(source.stats).toEqual([0, 0, 0, 0]);
    expect(startLoop).not.toHaveBeenCalled();
    expect(startGpu).not.toHaveBeenCalled();
  });

  it("bakes the loop on medium, uploads it as LOOP_FRAMES half-float layers, and runs its time at the wind's rate", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const startGpu = vi.fn<GpuStarter>(() => Promise.resolve(null));
    const source = createWindSeaSource(scene, SEED, "medium", startLoop, startGpu);
    expect(startLoop).toHaveBeenCalledWith(SEED);
    expect(source.mode).toBe(0);
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    const texture = source.disp as RawTexture2DArray;
    expect(texture).toBeInstanceOf(RawTexture2DArray);
    expect(texture.depth).toBe(LOOP_FRAMES);
    expect(texture.getSize()).toEqual({ width: LOOP_N, height: LOOP_N });
    expect(texture.getInternalTexture()!.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(texture.wrapU).toBe(Constants.TEXTURE_WRAP_ADDRESSMODE);
    expect(source.slope).toBeNull();
    // 10 m/s, the bake's own wind: the loop runs at one second a second and folds at LOOP_SECONDS.
    const state = windSeaStateFor(10 / 12, [1, 0], 12);
    expect(state.loopRate).toBe(1);
    source.update(state, 100);
    source.update(state, 130);
    expect(source.loopTime).toBeCloseTo(30 - LOOP_SECONDS, 9);
    expect(source.stats).toEqual([0.8, 0.03, 0, 0]);
    // 6 m/s: lengths and heights by 0.36, time at 10/6.
    const light = windSeaStateFor(0.5, [1, 0], 12);
    source.update(light, 133);
    expect(source.loopTime).toBeCloseTo(10 + 3 * (10 / 6), 9);
    expect(source.stats[0]).toBeCloseTo(0.8 * 0.36, 12);
    expect(startGpu).not.toHaveBeenCalled();
    source.dispose();
    expect(source.mode).toBe(0);
  }, timeLimit(30_000));

  it("falls back on high to the loop where the engine has no compute: createGpuWindSea is null on NullEngine", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop);
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    expect(startLoop).toHaveBeenCalledWith(SEED);
    expect(source.disp).toBeInstanceOf(RawTexture2DArray);
    source.dispose();
  }, timeLimit(30_000));

  it("draws the FFT on high along +x, rebuilt by the step, stepped every frame, and the loop once it fails", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const gpu = fakeGpu(scene);
    const startLoop = vi.fn<LoopStarter>((seed) => Promise.resolve(reply(seed)));
    const source = createWindSeaSource(scene, SEED, "high", startLoop, () => Promise.resolve(gpu));
    await vi.waitFor(() => expect(source.mode).toBe(2), { timeout: timeLimit(10_000) });
    expect(source.disp).toBe(gpu.disp);
    expect(source.slope).toBe(gpu.slope);
    // The wind turning never rebuilds: the shaders turn the field.
    source.update(windSeaStateFor(10 / 12, [1, 0], 12), 50);
    source.update(windSeaStateFor(10.4 / 12, [0, 1], 12), 51);
    expect(gpu.setSpectrum).toHaveBeenCalledTimes(1);
    expect(gpu.setSpectrum).toHaveBeenCalledWith({ u10: 10, dir: [1, 0] }, SEED);
    expect(source.stats).toEqual(cascadeStats(10));
    source.update(windSeaStateFor(10.6 / 12, [0, 1], 12), 52);
    expect(gpu.setSpectrum).toHaveBeenCalledTimes(2);
    expect(gpu.step.mock.calls.map(([seconds]) => seconds)).toEqual([50, 51, 52]);
    expect(startLoop).not.toHaveBeenCalled();
    gpu.fail();
    source.update(windSeaStateFor(10.6 / 12, [0, 1], 12), 53);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(source.mode).toBe(0);
    expect(startLoop).toHaveBeenCalledWith(SEED);
    await vi.waitFor(() => expect(source.mode).toBe(1), { timeout: timeLimit(10_000) });
    source.dispose();
  }, timeLimit(30_000));

  it("never uploads a loop that answers after it was disposed", async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    let answer: (value: LoopReply) => void = () => undefined;
    const startLoop = vi.fn<LoopStarter>(() => new Promise<LoopReply>((resolve) => { answer = resolve; }));
    const make = vi.spyOn(engine, "createRawTexture2DArray");
    const source = createWindSeaSource(scene, SEED, "medium", startLoop);
    source.dispose();
    answer(reply(SEED));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(make).not.toHaveBeenCalled();
    expect(source.mode).toBe(0);
  });
});
```

`client/test/game/oceanShader.test.ts`, six edits on Tasks 11 and 12's text, each old → new:

Edit 1 — old:

```ts
import {
  OCEAN_CAP_CELL, OCEAN_CAP_DRIFT, OCEAN_CAP_INSET, OCEAN_CAP_PERIOD, OCEAN_CAP_RADIUS, OCEAN_CAP_SHARE, OCEAN_CAP_SOFT,
  OCEAN_FOAM_ALBEDO, OCEAN_FOAM_ALBEDO_OLD, OCEAN_LACE_DRIFT, OCEAN_LACE_SOFT, OCEAN_LACE_TILE,
  OCEAN_RESOLVE_PHASE_HI, OCEAN_RESOLVE_PHASE_LO, OCEAN_RING_REACH, OCEAN_SLOPE_VAR_FLOOR, WATER_COX_MUNK_A,
  WATER_COX_MUNK_B, WATER_ROWS, capProfile, coxMunkVariance, foamWhite, laceCover, oceanRingCell, resolvedShare,
  resolvedSlopeVariance, roughnessFor, roughnessFromVariance, slopeVariance, undrawnSlopeVariance, whitecapThreshold,
} from "../../src/game/waterShading.js";
```

new:

```ts
import {
  OCEAN_BUMP_HS, OCEAN_BUMP_MAX, OCEAN_CAP_CELL, OCEAN_CAP_DRIFT, OCEAN_CAP_INSET, OCEAN_CAP_PERIOD, OCEAN_CAP_RADIUS,
  OCEAN_CAP_SHARE, OCEAN_CAP_SOFT, OCEAN_FOAM_ALBEDO, OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOLD, OCEAN_FOLD_FULL,
  OCEAN_LACE_DRIFT, OCEAN_LACE_SOFT, OCEAN_LACE_TILE, OCEAN_LOOP_SCALE_MIN, OCEAN_RESOLVE_PHASE_HI,
  OCEAN_RESOLVE_PHASE_LO, OCEAN_RING_REACH, OCEAN_SLOPE_VAR_FLOOR, OCEAN_WIND_TILE_CELLS, WATER_COX_MUNK_A,
  WATER_COX_MUNK_B, WATER_ROWS, bumpScale, capProfile, coxMunkVariance, foamWhite, foldCap, laceCover, oceanRingCell,
  resolvedShare, resolvedSlopeVariance, roughnessFor, roughnessFromVariance, slopeVariance, undrawnSlopeVariance,
  whitecapThreshold, windFrame, windPixelKeep, windRingKeep, windSlopeLimit,
} from "../../src/game/waterShading.js";
import { WIND_DIR_PERIOD } from "../../src/game/windParams.js";
import { FFT_CASCADES, FFT_N, LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE, WIND_SEA_HS_COEFF } from "../../src/game/oceanSpectrum.js";
import { WIND_SEA_U_FLOOR, WIND_SEA_U_REF, windSeaStateFor } from "../../src/game/oceanWindSea.js";
```

Edit 2 — old:

```ts
    wind: [0, 1, 0, 0],
    windDir: [1, 0, 6, 0],
  };
}
```

new:

```ts
    wind: [0, 1, 0, 0],
    windDir: [1, 0, 6, 0],
    windStats: [0.5, 0.01, 0.02, 0.03],
    windPivot: [-412.5, 37, 0, 0],
  };
}
```

Edit 3 — old:

```ts
    expect(l).toContain("float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;");
    expect(at(l, "float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;")).toBeLessThan(at(l, "if (wDepth <= 0.0) discard;"));
```

new:

```ts
    const depth = "float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y + wWind.y * wWindAmp;";
    expect(at(l, depth)).toBeLessThan(at(l, "if (wDepth <= 0.0) discard;"));
```

Edit 4 — old:

```ts
    expect(fx("waterLights.fragment.fx")).toContain("float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn);");
```

new:

```ts
    expect(fx("waterLights.fragment.fx")).toContain(
      "float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn + wWindDrawn * wWindSteep * wWindSteep);",
    );
```

Edit 5 — old:

```ts
        expect(vertex).toContain("oceanSwellSum");
```

new:

```ts
        expect(vertex).toContain("oceanSwellSum");
        expect(vertex).toContain("oceanWindDisplaceAt");
```

Edit 6 — old:

```ts
        expect(fragment).toContain("oceanCapCells");
```

new:

```ts
        expect(fragment).toContain("oceanCapCells");
        expect(fragment).toContain("oceanWindSlopesAt");
        expect(fragment).toContain("oceanWindFold");
```

Then append to the end of `client/test/game/oceanShader.test.ts`:

```ts
describe("the wind sea in the shaders", () => {
  it("holds the TypeScript's fields, scales and limits", () => {
    const s = fx("oceanSurface.fx");
    const fields: [string, number][] = [
      ["LOOP_N", LOOP_N], ["LOOP_SIZE", LOOP_SIZE], ["LOOP_FRAMES", LOOP_FRAMES], ["LOOP_SECONDS", LOOP_SECONDS],
      ["FFT_N", FFT_N], ["FFT_CASCADE_0", FFT_CASCADES[0]], ["FFT_CASCADE_1", FFT_CASCADES[1]], ["FFT_CASCADE_2", FFT_CASCADES[2]],
      ["WIND_SEA_HS_COEFF", WIND_SEA_HS_COEFF], ["OCEAN_LOOP_SCALE_MIN", OCEAN_LOOP_SCALE_MIN],
      ["OCEAN_WIND_TILE_CELLS", OCEAN_WIND_TILE_CELLS],
    ];
    for (const [name, value] of fields) pinned(s, name, value);
    expect(OCEAN_LOOP_SCALE_MIN).toBeCloseTo((WIND_SEA_U_FLOOR / WIND_SEA_U_REF) ** 2, 15);
    const f = fx("oceanShade.fragment.fx");
    for (const [name, value] of [
      ["OCEAN_FOLD", OCEAN_FOLD], ["OCEAN_FOLD_FULL", OCEAN_FOLD_FULL], ["OCEAN_BUMP_HS", OCEAN_BUMP_HS], ["OCEAN_BUMP_MAX", OCEAN_BUMP_MAX],
    ] as const) pinned(f, name, value);
    expect(s).toContain("vec3 oceanWindDisplace(vec2 p)");
    expect(f).toContain("vec2 oceanWindSlopes(vec2 p)");
    expect(f).toContain("float oceanWindFold(vec2 p)");
  });

  it("samples both fields in the wind's frame: the loop's frames blended at the loop's time and scale, the cascades summed", () => {
    const s = fx("oceanSurface.fx");
    for (const line of [
      "  vec2 r = p - oceanWindPivot.xy;",
      "  return vec2(dot(r, d), d.x * r.y - d.y * r.x);",
      "  return vec2(v.x * d.x - v.y * d.y, v.x * d.y + v.y * d.x);",
      "  float f = oceanWind.z / LOOP_SECONDS * LOOP_FRAMES;",
      "  vec3 b = textureLod(oceanWindDisp, vec3(uv, mod(f0 + 1.0, LOOP_FRAMES)), 0.0).xyz;",
      "    t = oceanLoopRead(w / size) * (size / LOOP_SIZE) * oceanWindRingKeep(size, cell);",
      "    t = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_0, 0.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_0, cell)",
      "  return oceanWind.x / max(WIND_SEA_HS_COEFF * u * u / OCEAN_G, 1.0e-4);",
      // The wind sea on the rings, cut by the break and the lee as the chop is.
      "  float chop = oceanWindAmp() * (1.0 - foam.y) * oceanShelter(p, SHELTER_CHOP);",
      "  return disp + oceanWindDisplaceAt(p, cell) * chop;",
    ]) expect(s, line).toContain(line);
    const f = fx("oceanShade.fragment.fx");
    // The slope texture's (slopeX, slopeZ), the displacement's Jacobian in its fourth channel (oceanGpuFft.ts).
    expect(f).toContain("    g = textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_0, 0.0), 0.0).xy * k0");
    expect(f).toContain("  float j0 = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_0, 0.0), 0.0).w;");
    expect(f).toContain("    g = vec2(gx, gz) * (LOOP_N / (2.0 * LOOP_SIZE)) * keep;");
    expect(f).toContain("  return -oceanFromWind(g);");
  });

  it("turns the fields about the cove's waterline centre: nothing slides there, half a metre a second 100 m off", () => {
    const [px, pz] = [-412.5, 37];
    for (const angle of [0, 1, 2.5, -2]) {
      const [u, v] = windFrame(px, pz, Math.cos(angle), Math.sin(angle), px, pz);
      expect(Math.abs(u) + Math.abs(v), `${angle}`).toBe(0);
    }
    // One second of the wind's turn, at 100 m and at 250 m from the pivot (the old frame's
    // origin lay about 250 m from the cove): the slide is the distance times the turn.
    const turn = (2 * Math.PI) / WIND_DIR_PERIOD;
    const slide = (r: number): number => {
      const before = windFrame(px + r, pz, 1, 0, px, pz);
      const after = windFrame(px + r, pz, Math.cos(turn), Math.sin(turn), px, pz);
      return Math.hypot(after[0] - before[0], after[1] - before[1]);
    };
    expect(slide(100)).toBeCloseTo(0.5236, 4);
    expect(slide(250)).toBeCloseTo(1.309, 3);
    // The frame keeps distances: a turn, not a stretch.
    const [u, v] = windFrame(px + 30, pz - 40, 0.6, 0.8, px, pz);
    expect(Math.hypot(u, v)).toBeCloseTo(50, 9);
  });

  it("fades a field on a ring too coarse for it and in a pixel too wide for its shortest wave", () => {
    expect(windRingKeep(60, 3.75)).toBe(1);
    expect(windRingKeep(60, 5.625)).toBeCloseTo(0.5, 12);
    expect(windRingKeep(60, 7.5)).toBe(0);
    expect(windPixelKeep(60, 128, 60 / 256)).toBe(1);
    expect(windPixelKeep(25, 256, 0.0732421875)).toBeCloseTo(0.5, 12);
    expect(windPixelKeep(60, 128, 60 / 128)).toBe(0);
    expect(fx("oceanShade.fragment.fx")).toContain(
      "  return 1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, 0.5 * OCEAN_TWO_PI * n * pixel / size);",
    );
  });

  it("keeps the drawn chop within Cox and Munk's sea for the wind, and the low tier's bump to the wind sea's height", () => {
    expect(windSlopeLimit(10, 1, 0.04)).toBe(1);
    expect(windSlopeLimit(1.2, 1, 0.04)).toBeCloseTo(0.4781213, 6);
    expect(windSlopeLimit(1.2, 1, 0)).toBe(1);
    expect(bumpScale(0.5, 0, 1)).toBe(0.5);
    expect(bumpScale(1, 0, 1)).toBe(1);
    expect(bumpScale(3, 0, 1)).toBe(2);
    expect(bumpScale(1, 0.5, 1)).toBe(0.5);
    expect(bumpScale(1, 0, 0.15)).toBe(0.15);
    // A calm dawn, the wind onshore: the bump nearly gone, the sea glassy.
    const dawn = windSeaStateFor(0.25, [1, 0], 6);
    expect(bumpScale(dawn.hs * dawn.nearShore, 0, 1)).toBeCloseTo(0.0411, 4);
    expect(foldCap(0.5)).toBe(0);
    expect(foldCap(0.35)).toBeCloseTo(0.5, 12);
    expect(foldCap(0.2)).toBe(1);
    const l = fx("waterLights.fragment.fx");
    expect(l).toContain("float wWindSteep = wWindAmp * oceanWindSlopeLimit(oceanWindDir.z, wOceanChop, wWindDrawn * wWindAmp * wWindAmp);");
    expect(l).toContain(
      "vec2 wOceanExtra = normalW.xz / max(normalW.y, 0.05) * oceanBumpScale(wOceanFoam.y, wOceanChop) + wWindSlope * wWindSteep;",
    );
  });

  it("whitens a drawn wind sea's own crests, and on the high tier its folds, the low tier keeping its cells", () => {
    const l = fx("waterLights.fragment.fx");
    const branch = at(l, "if (oceanCoast.w > 0.5) {");
    expect(branch).toBeGreaterThan(at(l, "float wOceanCap = oceanCapCells(vOceanXZ);"));
    expect(l).toContain("  wOceanCap = max(oceanWhitecap(vOceanXZ, wWind.y / max(oceanWindStats.x, 1.0e-4)), wFold);");
    expect(at(l, "wOceanCap *= 1.0 - wOceanFoam.y;")).toBeGreaterThan(branch);
  });
});
```

`client/test/game/waterPlugin.test.ts`, five edits in the tests Task 10 appended, each old → new:

Edit 1 — old:

```ts
/** The eight vec4 uniforms the sea's waves read, in their order. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
];
```

new:

```ts
/** The ten vec4 uniforms the sea's waves read, in their order. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
  "oceanWindStats", "oceanWindPivot",
];
```

Edit 2 — old:

```ts
    windDir: [0.6, -0.8, 9, 0],
  };
}
```

new:

```ts
    windDir: [0.6, -0.8, 9, 0],
    windStats: [0.7, 0.02, 0.03, 0.04],
    windPivot: [-412.5, 37, 0, 0],
  };
}
```

Edit 3 — old:

```ts
  it("declares the eight vec4 uniforms on every path, ocean or none", () => {
```

new:

```ts
  it("declares the ten vec4 uniforms on every path, ocean or none", () => {
```

Edit 4 — old:

```ts
    expect(u.ubo.map((e) => e.name).slice(-8)).toEqual(OCEAN_UNIFORMS);
    expect(u.ubo).toHaveLength(21);
```

new:

```ts
    expect(u.ubo.map((e) => e.name).slice(-10)).toEqual(OCEAN_UNIFORMS);
    expect(u.ubo).toHaveLength(23);
```

Edit 5 — old:

```ts
    expect(bound.oceanWindDir).toEqual([0.6, -0.8, 9, 0]);
```

new:

```ts
    expect(bound.oceanWindDir).toEqual([0.6, -0.8, 9, 0]);
    expect(bound.oceanWindStats).toEqual([0.7, 0.02, 0.03, 0.04]);
    expect(bound.oceanWindPivot).toEqual([-412.5, 37, 0, 0]);
```

`client/test/game/oceanRender.test.ts`, one edit on Task 10's imports — old:

```ts
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
```

new:

```ts
import { windSeaStateFor } from "../../src/game/oceanWindSea.js";
import type { LoopReply } from "../../src/game/oceanLoopBake.js";
import { LOOP_FRAMES, LOOP_N, LOOP_SIZE } from "../../src/game/oceanSpectrum.js";
import { coveFor } from "../../src/sim/olympic.js";
```

Then append to the end of `client/test/game/oceanRender.test.ts`:

```ts
describe("the wind sea by tier (createOcean)", () => {
  /** A bake's answer with the loop's sizes and numbers to tell apart. */
  const reply = (seed: number): LoopReply => ({
    seed, frames: LOOP_FRAMES, n: LOOP_N, size: LOOP_SIZE, heightStd: 0.8, slopeVar: 0.03,
    data: new Uint16Array(LOOP_FRAMES * LOOP_N * LOOP_N * 4),
  });

  it("draws none on low, and on medium the loop once its bake answers, its mode, field, time and numbers bound", async () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const startLoop = vi.fn((seed: number) => Promise.resolve(reply(seed)));
      const startGpu = vi.fn(() => Promise.resolve(null));
      const low = createOcean(scene, SEED, "low", { startLoop, startGpu });
      low.update(0, 0, 1, 0.5, [1, 0], 12);
      expect(low.windMode).toBe(0);
      expect(startLoop).not.toHaveBeenCalled();
      const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
      const medium = createOcean(scene, SEED, "medium", { startLoop, startGpu });
      medium.bind(plugin);
      expect(startLoop).toHaveBeenCalledWith(SEED);
      await vi.waitFor(() => {
        medium.update(0, 0, 10, 0.5, [1, 0], 12);
        expect(medium.windMode).toBe(1);
      }, { timeout: timeLimit(10_000) });
      medium.update(0, 0, 13, 0.5, [1, 0], 12);
      const sea = windSeaStateFor(0.5, [1, 0], 12);
      const binding = plugin.ocean!;
      expect(binding.coast[3]).toBe(1);
      expect(binding.windDisp).toBe(medium.windDisp);
      expect(binding.windDisp.is2DArray).toBe(true);
      expect(binding.windDisp.getInternalTexture()!.depth).toBe(LOOP_FRAMES);
      expect(binding.windSlope).toBe(oceanArrayPlaceholder(scene));
      expect(binding.wind[2]).toBeCloseTo(3 * sea.loopRate, 9);
      expect(binding.windStats).toEqual([0.8 * sea.loopScale, 0.03, 0, 0]);
      expect(startGpu).not.toHaveBeenCalled();
      low.dispose();
      medium.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));

  it("turns the wind sea about the cove's waterline centre, bound for the shaders", () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const plugin = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
      const ocean = createOcean(scene, SEED, "low");
      ocean.bind(plugin);
      const z0 = coveFor(SEED).z0;
      expect(plugin.ocean!.windPivot).toEqual([coastProfilesFor(SEED).coastlineX(z0), z0, 0, 0]);
      // at sea: the pivot is the cove's waterline, west of the road
      expect(plugin.ocean!.windPivot[0]).toBeLessThan(-150);
      ocean.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));

  it("falls back on high to the medium loop where the engine has no compute (NullEngine's createGpuWindSea is null)", async () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const startLoop = vi.fn((seed: number) => Promise.resolve(reply(seed)));
      const high = createOcean(scene, SEED, "high", { startLoop });
      await vi.waitFor(() => {
        high.update(0, 0, 10, 0.9, [0.6, -0.8], 15);
        expect(high.windMode).toBe(1);
      }, { timeout: timeLimit(10_000) });
      expect(startLoop).toHaveBeenCalledWith(SEED);
      high.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));
});
```

Task 10's "draws the wind sea by its normals on every tier here" and "moves the swell's phases, the wind sea and its direction" keep passing unchanged: under Node no field ever arrives (no `Worker`; NullEngine's `createGpuWindSea` is null and the loop it falls back to has no worker either), so every tier stays at mode 0 with the placeholder, and the loop's time stays 0 while no loop is drawn.

The numbers, computed while drafting with Task 2's code: the loop's frame at 20 s differs from its first by at most 2.1e-6 m on heights up to 2.67 m, 99.6 % of the half floats equal; the bake scaled to 15 m/s has 4σ = 10.974142 m against 10.974124 m for the sea made at 15 m/s on the 135 m tile (a ratio of 1.0000017: the spectrum is self-similar and `windSeaH0` draws by bin, so the two differ only by rounding; the 10 % bound is the request's); below 1 Hz at 10 m/s the band holds 0.509076 m² of (Hs/4)² = 0.509164 m², its slopes 0.011626; the cascades at 10 m/s: σ 0.713557 m and slope variances 0.0027272, 0.0049297, 0.0099255 (0.0176 together, against Cox and Munk's 0.0542 for 10 m/s: the rest goes to the roughness); the sinusoid of 4 cycles across the tile: σ 0.70713 in half floats, slope variance 0.086614 = ½(sin kΔ/Δ)² (k = 2π·4/60 m, Δ = 60/128 m); the slope limit for 1.2 m/s against a drawn 0.04: √(0.009144/0.04) = 0.478121; a calm dawn's bump, Hs = 0.28·1.2²/9.81 = 0.0411 m; the frame's slide over one second of the wind's turn (2π/1,200 rad), 0.5236 m at 100 m from the pivot and 1.309 m at 250 m, the distance the world's origin lies from the cove. The bake took 0.5 s under Node; the loop's realised height σ varies from seed to seed (0.57 to 1.30 m over four seeds, the tile holding few waves at the spectrum's long end), which is why the medium tier normalises its crests by the bake's own measured σ, not by the spectrum's.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --root client test/game/oceanLoopBake.test.ts test/game/oceanWindSource.test.ts test/game/oceanShader.test.ts test/game/oceanRender.test.ts test/game/waterPlugin.test.ts`
Expected: FAIL with "Error: Cannot find module '../../src/game/oceanLoopBake.js'" (`oceanLoopBake.test.ts`), "Error: Cannot find module '../../src/game/oceanWindSource.js'" (`oceanWindSource.test.ts`), "expected '…' to contain 'const float LOOP_N = 128.0;'" (`oceanShader.test.ts`), "AssertionError: expected [ 'waterSkin', …(9) ] to deeply equal [ 'oceanPhase0', …(9) ]" (`waterPlugin.test.ts`) and "expected +0 to be 1" (`oceanRender.test.ts`: `createOcean` ignores the fourth argument, so no loop is asked for)

- [ ] **Step 3: Implement**

Create `client/src/game/oceanLoopBake.ts`:

```ts
/**
 * The medium tier's wind sea (spec §6.3): one cascade, LOOP_N texels a side
 * over LOOP_SIZE metres, baked at load for WIND_SEA_U_REF blowing along +x
 * into LOOP_FRAMES frames of a LOOP_SECONDS loop, packed to half floats
 * (height, dx, dz, 0) for an RGBA16F texture array; and the numbers the
 * shaders scale it by. Babylon-free: the worker (`oceanLoop.worker.ts`) runs
 * it off the main thread and the tests run it under Node.
 *
 * A fully developed spectrum keeps its shape at every wind once lengths scale
 * by U² and times by U, so one bake serves every wind: the shaders sample the
 * tile at lengths and heights times loopScale = (U/U_ref)² and run its time
 * at loopRate = U_ref/U (`windSeaStateFor`), turned to the wind's direction.
 * Every frequency is a whole number of turns in LOOP_SECONDS (`windSeaH0`'s
 * `repeat`), so the last frame runs on into the first.
 */
import { OCEAN_G } from "./oceanPhysics.js";
import { WIND_SEA_CHOPPINESS, windSeaFields, type SpectrumH0 } from "./oceanFft.js";
import {
  LOOP_FRAMES, LOOP_N, LOOP_SECONDS, LOOP_SIZE, WIND_SEA_FP_COEFF, WIND_SEA_GAMMA, WIND_SEA_HS_COEFF,
  cascadeBands, jonswap, windSeaH0,
} from "./oceanSpectrum.js";
import { WIND_SEA_U_REF } from "./oceanWindSea.js";

/** What the page asks the worker: the world's seed. */
export type LoopRequest = { seed: number };

/** What the worker answers: the loop's half floats, frame after frame, and
 * the two numbers the shaders normalise it by, measured on its first frame as
 * the texture holds it: the height's standard deviation (m, at
 * WIND_SEA_U_REF) and the slope variance of the central differences a texel
 * apart that `oceanWindSlopesAt` draws. */
export type LoopReply = {
  seed: number; frames: number; n: number; size: number;
  heightStd: number; slopeVar: number;
  data: Uint16Array<ArrayBuffer>;
};

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A number as an IEEE half float's bits, rounded to nearest, ties to even. */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant !== 0 ? 0x200 : 0);
  const e = exp - 112;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let half = m >>> shift;
    const rest = m & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    if (rest > mid || (rest === mid && (half & 1) === 1)) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1)) half++;
  return sign | half;
}

/** A half float's bits as a number. */
export function fromHalf(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** The loop's spectrum: the cascade at WIND_SEA_U_REF along +x, its frequencies
 * whole turns in LOOP_SECONDS. */
export function loopSpectrum(seed: number): SpectrumH0 {
  const band = cascadeBands([LOOP_SIZE], LOOP_N)[0] as { kMin: number; kMax: number };
  return windSeaH0(LOOP_N, LOOP_SIZE, { u10: WIND_SEA_U_REF, dir: [1, 0] }, band, seed, LOOP_SECONDS);
}

/** One frame at t seconds as floats, four a texel: (height, dx, dz, 0). */
export function loopFrame(spectrum: SpectrumH0, t: number): Float32Array {
  const f = windSeaFields(spectrum, LOOP_N, LOOP_SIZE, t, WIND_SEA_CHOPPINESS);
  const out = new Float32Array(LOOP_N * LOOP_N * 4);
  for (let i = 0; i < LOOP_N * LOOP_N; i++) {
    out[i * 4] = f.height[i] as number;
    out[i * 4 + 1] = f.dx[i] as number;
    out[i * 4 + 2] = f.dz[i] as number;
  }
  return out;
}

/** The whole loop: LOOP_FRAMES frames LOOP_SECONDS / LOOP_FRAMES apart, half floats. */
export function bakeWindSeaLoop(seed: number): Uint16Array<ArrayBuffer> {
  const spectrum = loopSpectrum(seed);
  const layer = LOOP_N * LOOP_N * 4;
  const out = new Uint16Array(LOOP_FRAMES * layer);
  for (let f = 0; f < LOOP_FRAMES; f++) {
    const frame = loopFrame(spectrum, (f * LOOP_SECONDS) / LOOP_FRAMES);
    for (let i = 0; i < layer; i++) out[f * layer + i] = toHalf(frame[i] as number);
  }
  return out;
}

/** The height's standard deviation and the slope variance of a frame of the
 * packed loop, as the shaders draw it: the mean square of the central
 * differences a texel apart along x and along z, wrapping, summed. */
export function loopStats(data: Uint16Array, frame: number): { heightStd: number; slopeVar: number } {
  const n = LOOP_N;
  const base = frame * n * n * 4;
  const h = (col: number, row: number): number => fromHalf(data[base + ((((row % n) + n) % n) * n + (((col % n) + n) % n)) * 4] as number);
  const step = (2 * LOOP_SIZE) / n;
  let sum = 0;
  let sumSq = 0;
  let slope = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const v = h(col, row);
      sum += v;
      sumSq += v * v;
      const gx = (h(col + 1, row) - h(col - 1, row)) / step;
      const gz = (h(col, row + 1) - h(col, row - 1)) / step;
      slope += gx * gx + gz * gz;
    }
  }
  const count = n * n;
  const mean = sum / count;
  return { heightStd: Math.sqrt(Math.max(0, sumSq / count - mean * mean)), slopeVar: slope / count };
}

/** The worker's whole job: bake the seed's loop and measure it. */
export function loopReply(request: LoopRequest): LoopReply {
  const data = bakeWindSeaLoop(request.seed);
  const { heightStd, slopeVar } = loopStats(data, 0);
  return { seed: request.seed, frames: LOOP_FRAMES, n: LOOP_N, size: LOOP_SIZE, heightStd, slopeVar, data };
}

/** Simpson intervals of a band's share, as `windSeaH0` normalises its bins by. */
const BAND_STEPS = 4096;

/**
 * The share of the fully developed sea at u10 (m/s) between two wavenumbers
 * in deep water: the height variance ∫S df (m²), exactly what `windSeaH0`
 * scales a cascade's bins to, and the slope variance ∫k²S df, k = (2πf)²/g,
 * between the band's frequencies √(gk)/2π. Zero for no wind.
 */
export function windSeaBandStats(u10: number, band: { kMin: number; kMax: number }): { heightVar: number; slopeVar: number } {
  if (!(u10 > 0)) return { heightVar: 0, slopeVar: 0 };
  const hs = (WIND_SEA_HS_COEFF * u10 * u10) / OCEAN_G;
  const fp = (WIND_SEA_FP_COEFF * OCEAN_G) / u10;
  const fLo = Math.sqrt(OCEAN_G * band.kMin) / (2 * Math.PI);
  const fHi = Math.sqrt(OCEAN_G * band.kMax) / (2 * Math.PI);
  const h = (fHi - fLo) / BAND_STEPS;
  const k2 = (f: number): number => {
    const k = (2 * Math.PI * f) * (2 * Math.PI * f) / OCEAN_G;
    return k * k;
  };
  let heightSum = 0;
  let slopeSum = 0;
  for (let i = 0; i <= BAND_STEPS; i++) {
    const f = fLo + i * h;
    const weight = i === 0 || i === BAND_STEPS ? 1 : i % 2 === 1 ? 4 : 2;
    const s = jonswap(f, fp, hs, WIND_SEA_GAMMA);
    heightSum += weight * s;
    slopeSum += weight * k2(f) * s;
  }
  return { heightVar: (heightSum * h) / 3, slopeVar: (slopeSum * h) / 3 };
}
```

Create `client/src/game/oceanLoop.worker.ts`:

```ts
/**
 * The medium tier's wind sea loop, baked off the main thread (spec §6.3): a
 * module worker, which Vite bundles from the `new Worker(new URL(...),
 * { type: "module" })` in `oceanWindSource.ts`. One request, one reply, the
 * loop's buffer transferred, not copied.
 */
import { loopReply, type LoopRequest } from "./oceanLoopBake.js";

self.onmessage = (event: MessageEvent<LoopRequest>): void => {
  const reply = loopReply(event.data);
  self.postMessage(reply, { transfer: [reply.data.buffer] });
};
```

Create `client/src/game/oceanWindSource.ts`:

```ts
/**
 * The wind sea's field for the sea's material, by tier (spec §6, §10): on high
 * the WebGPU compute FFT (`oceanGpuFft.ts`, imported only on that path), on
 * medium, and on high where compute is not to be had or fails, the loop
 * baked in a worker (`oceanLoop.worker.ts`), on low nothing: the sea keeps
 * PBR's bump there. Until a field is ready the mode stays 0 and the sea is
 * the swell alone.
 *
 * Both fields are made with the wind blowing along +x; the shaders turn them
 * to the wind's direction (`oceanWindFrame`), so the high tier's spectrum is
 * rebuilt only when the wind's speed moves by WIND_SEA_RESPECTRUM_U, never as
 * it turns (it turns a full circle in 20 minutes, which would rebuild the
 * spectrum, about 20 ms on the main thread, every few seconds).
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { GpuWindSea } from "./oceanGpuFft.js";
import type { QualityTier } from "./quality.js";
import { FFT_CASCADES, FFT_N, LOOP_SECONDS, cascadeBands } from "./oceanSpectrum.js";
import { windSeaBandStats, type LoopReply, type LoopRequest } from "./oceanLoopBake.js";
import type { WindSeaState } from "./oceanWindSea.js";

/** m/s the wind's speed moves before the high tier's spectrum is rebuilt. */
export const WIND_SEA_RESPECTRUM_U = 0.5;

/** 0: no wind sea drawn (low, or a field not ready yet); 1: the medium loop; 2: the high tier's FFT. */
export type WindSeaMode = 0 | 1 | 2;

export type WindSeaSource = {
  readonly mode: WindSeaMode;
  /** The field's (height, dx, dz, ·) texture array: the loop's frames, or the FFT's cascades; null in mode 0. */
  readonly disp: BaseTexture | null;
  /** The FFT's (slopeX, slopeZ) cascades in mode 2, else null. */
  readonly slope: BaseTexture | null;
  /** `oceanWindStats`: the drawn field's height standard deviation (m) at the state's wind before the near-shore
   * cut, then each field's slope variance (the loop's alone in mode 1, the three cascades' in mode 2). */
  readonly stats: [number, number, number, number];
  /** The loop's time (s), run at the wind's rate and folded into [0, LOOP_SECONDS). */
  readonly loopTime: number;
  /** Per frame, before the scene renders: the wind sea's state and the sea's seconds. */
  update(state: WindSeaState, seconds: number): void;
  dispose(): void;
};

/** Bakes the loop for a seed: by default in the worker. */
export type LoopStarter = (seed: number) => Promise<LoopReply>;
/** Makes the high tier's FFT: by default `createGpuWindSea`, imported on that path alone. */
export type GpuStarter = (scene: Scene) => Promise<GpuWindSea | null>;

/** The loop baked in the module worker; rejects where there is no Worker (Node). */
export function startLoopWorker(seed: number): Promise<LoopReply> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("no Worker to bake the wind sea's loop in"));
  const worker = new Worker(new URL("./oceanLoop.worker.ts", import.meta.url), { type: "module" });
  return new Promise<LoopReply>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<LoopReply>): void => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event: ErrorEvent): void => {
      worker.terminate();
      reject(new Error(event.message));
    };
    const request: LoopRequest = { seed };
    worker.postMessage(request);
  });
}

/** The FFT on the scene's engine, null where the engine has no compute (every engine but WebGPU's). */
export async function startGpuWindSea(scene: Scene): Promise<GpuWindSea | null> {
  const { createGpuWindSea } = await import("./oceanGpuFft.js");
  return createGpuWindSea(scene.getEngine());
}

/** Whether the FFT's spectrum must be rebuilt for a wind of `u10`: the first time, or the speed moved by
 * WIND_SEA_RESPECTRUM_U or more since the last build at `lastU10`. */
export function needsRespectrum(lastU10: number | null, u10: number): boolean {
  return lastU10 === null || Math.abs(u10 - lastU10) >= WIND_SEA_RESPECTRUM_U;
}

/** The FFT's stats at a wind: the three cascades' summed height variance, as a standard deviation, and each
 * cascade's slope variance, over the bands `windSeaH0` fills. */
export function cascadeStats(u10: number): [number, number, number, number] {
  const bands = cascadeBands(FFT_CASCADES, FFT_N);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  let heightVar = 0;
  bands.forEach((band, i) => {
    const s = windSeaBandStats(u10, band);
    heightVar += s.heightVar;
    out[i + 1] = s.slopeVar;
  });
  out[0] = Math.sqrt(heightVar);
  return out;
}

function fold(x: number, m: number): number {
  return x - m * Math.floor(x / m);
}

export function createWindSeaSource(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  startLoop: LoopStarter = startLoopWorker,
  startGpu: GpuStarter = startGpuWindSea,
): WindSeaSource {
  let mode: WindSeaMode = 0;
  let disp: BaseTexture | null = null;
  let slope: BaseTexture | null = null;
  const stats: [number, number, number, number] = [0, 0, 0, 0];
  let loopTime = 0;
  let lastSeconds: number | null = null;
  let loop: { texture: RawTexture2DArray; heightStd: number; slopeVar: number } | null = null;
  let gpu: GpuWindSea | null = null;
  let gpuU10: number | null = null;
  let loopAsked = false;
  let disposed = false;

  function useLoop(): void {
    mode = loop === null ? 0 : 1;
    disp = loop?.texture ?? null;
    slope = null;
  }

  // The loop, once: on medium at once, on high when the FFT cannot be had.
  // Without a worker (Node) it never arrives and the sea keeps its swell.
  function askLoop(): void {
    if (loopAsked) return;
    loopAsked = true;
    startLoop(seed).then((reply) => {
      if (disposed) return;
      const texture = new RawTexture2DArray(
        reply.data, reply.n, reply.n, reply.frames, Constants.TEXTUREFORMAT_RGBA, scene,
        false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT,
      );
      texture.name = "oceanWindLoop";
      texture.wrapU = Texture.WRAP_ADDRESSMODE;
      texture.wrapV = Texture.WRAP_ADDRESSMODE;
      loop = { texture, heightStd: reply.heightStd, slopeVar: reply.slopeVar };
      if (gpu === null) useLoop();
    }, () => undefined);
  }

  if (tier === "medium") askLoop();
  if (tier === "high") {
    startGpu(scene).then((made) => {
      if (disposed) {
        made?.dispose();
        return;
      }
      if (made === null) {
        askLoop();
        return;
      }
      gpu = made;
      mode = 2;
      disp = made.disp;
      slope = made.slope;
    }, () => {
      if (!disposed) askLoop();
    });
  }

  return {
    get mode() {
      return mode;
    },
    get disp() {
      return disp;
    },
    get slope() {
      return slope;
    },
    get stats() {
      return stats;
    },
    get loopTime() {
      return loopTime;
    },
    update(state, seconds) {
      const dt = lastSeconds === null ? 0 : Math.max(0, seconds - lastSeconds);
      lastSeconds = seconds;
      if (gpu !== null && gpu.status() === "failed") {
        gpu.dispose();
        gpu = null;
        gpuU10 = null;
        useLoop();
        askLoop();
      }
      if (gpu !== null) {
        if (needsRespectrum(gpuU10, state.u10)) {
          gpu.setSpectrum({ u10: state.u10, dir: [1, 0] }, seed);
          gpuU10 = state.u10;
          const s = cascadeStats(state.u10);
          for (let i = 0; i < 4; i++) stats[i] = s[i] as number;
        }
        gpu.step(seconds);
        return;
      }
      // The loop's own clock, run at the wind's rate: a fully developed sea's
      // times scale with the wind as its lengths do with its square.
      if (loop !== null) {
        loopTime = fold(loopTime + dt * state.loopRate, LOOP_SECONDS);
        stats[0] = loop.heightStd * state.loopScale;
        stats[1] = loop.slopeVar;
        stats[2] = 0;
        stats[3] = 0;
      }
    },
    dispose() {
      disposed = true;
      gpu?.dispose();
      gpu = null;
      loop?.texture.dispose();
      loop = null;
      mode = 0;
      disp = null;
      slope = null;
    },
  };
}
```

`client/src/game/shaders/oceanSurface.fx`, one edit — old (the file's last function and its gate):

```glsl
// The sea's displacement of a ring's vertex at p: a swell component under four
// of the ring's cells a wavelength is left to the pixels' normal, so no ring
// aliases it.
vec3 oceanDisplace(vec2 p) {
  float cell = oceanRingCell(p);
  vec3 disp;
  vec3 normal;
  vec4 foam;
  float drawn;
  oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn);
  return disp;
}
#endif
```

new:

```glsl
// The wind sea's fields: the medium tier's loop, LOOP_FRAMES frames of
// LOOP_N texels a side over LOOP_SIZE metres at WIND_SEA_U_REF, and the high
// tier's three cascades, FFT_N texels a side over FFT_CASCADE_ metres. Both
// are made with the wind along +x and turned to the wind here.
const float LOOP_N = 128.0;
const float LOOP_SIZE = 60.0;
const float LOOP_FRAMES = 64.0;
const float LOOP_SECONDS = 20.0;
const float FFT_N = 256.0;
const float FFT_CASCADE_0 = 1000.0;
const float FFT_CASCADE_1 = 150.0;
const float FFT_CASCADE_2 = 25.0;
const float WIND_SEA_HS_COEFF = 0.28;
// The loop's least scale, the wind's floor's: (0.5 / 10) squared.
const float OCEAN_LOOP_SCALE_MIN = 0.0025;
// A ring displaces a field while its cells are at most a sixteenth of the
// field's tile, and none of it from an eighth.
const float OCEAN_WIND_TILE_CELLS = 16.0;

// The wind sea's height over the fully developed height for its wind: the
// cut near shore under an offshore wind (oceanWind.x is the cut height).
float oceanWindAmp() {
  float u = oceanWindDir.z;
  return oceanWind.x / max(WIND_SEA_HS_COEFF * u * u / OCEAN_G, 1.0e-4);
}

// p in the wind's frame: x down the wind, z across it, about the pivot
// (oceanWindPivot.xy, the cove's waterline centre). As the wind turns, the
// fields turn about that point, where the sea is seen up close, so nothing
// slides there; a point r metres off slides at r times the wind's turn.
vec2 oceanWindFrame(vec2 p) {
  vec2 d = oceanWindDir.xy;
  vec2 r = p - oceanWindPivot.xy;
  return vec2(dot(r, d), d.x * r.y - d.y * r.x);
}

// A vector of the wind's frame turned back into the world's.
vec2 oceanFromWind(vec2 v) {
  vec2 d = oceanWindDir.xy;
  return vec2(v.x * d.x - v.y * d.y, v.x * d.y + v.y * d.x);
}

// The loop's tile in metres at this wind: LOOP_SIZE times the loop's scale.
float oceanLoopSize() {
  return LOOP_SIZE * max(oceanWind.y, OCEAN_LOOP_SCALE_MIN);
}

// The loop's (height, dx, dz) at uv as baked, between the two frames about
// the loop's time (oceanWind.z, already run at the wind's rate and folded).
vec3 oceanLoopRead(vec2 uv) {
  float f = oceanWind.z / LOOP_SECONDS * LOOP_FRAMES;
  float f0 = floor(f);
  vec3 a = textureLod(oceanWindDisp, vec3(uv, f0), 0.0).xyz;
  vec3 b = textureLod(oceanWindDisp, vec3(uv, mod(f0 + 1.0, LOOP_FRAMES)), 0.0).xyz;
  return a + (b - a) * (f - f0);
}

// The share of a field size metres across that a ring of cell metres displaces.
float oceanWindRingKeep(float size, float cell) {
  return 1.0 - smoothstep(1.0, 2.0, OCEAN_WIND_TILE_CELLS * cell / size);
}

// The wind sea's displacement (x, height, z) at p as its field draws it,
// each field faded on a ring too coarse for it (a cell of 0 fades nothing):
// the high tier's three cascades summed, the medium tier's loop scaled to the
// wind, nothing on the low tier. Not yet cut by the shore. The tier is a
// uniform (oceanCoast.w), and every read is at level 0.
vec3 oceanWindDisplaceAt(vec2 p, float cell) {
  vec2 w = oceanWindFrame(p);
  vec3 t = vec3(0.0);
  if (oceanCoast.w > 1.5) {
    t = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_0, 0.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_0, cell)
      + textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_1, 1.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_1, cell)
      + textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_2, 2.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_2, cell);
  } else if (oceanCoast.w > 0.5) {
    float size = oceanLoopSize();
    t = oceanLoopRead(w / size) * (size / LOOP_SIZE) * oceanWindRingKeep(size, cell);
  }
  vec2 across = oceanFromWind(t.yz);
  return vec3(across.x, t.x, across.y);
}

// The wind sea's displacement at p, nothing faded.
vec3 oceanWindDisplace(vec2 p) {
  return oceanWindDisplaceAt(p, 0.0);
}

// The sea's displacement of a ring's vertex at p: a swell component under four
// of the ring's cells a wavelength, or a wind sea field a ring too coarse
// for, is left to the pixels' normal, so no ring aliases it. The wind sea
// dies shoreward of the break, where the broken waves eat it, and in a
// headland's lee.
vec3 oceanDisplace(vec2 p) {
  float cell = oceanRingCell(p);
  vec3 disp;
  vec3 normal;
  vec4 foam;
  float drawn;
  oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn);
  float chop = oceanWindAmp() * (1.0 - foam.y) * oceanShelter(p, SHELTER_CHOP);
  return disp + oceanWindDisplaceAt(p, cell) * chop;
}
#endif
```

`client/src/game/shaders/oceanShade.fragment.fx`, two edits on Task 12's text, each old → new:

Edit 1 — old:

```glsl
// The whitecaps' coverage at p: Callaghan's for the wind (oceanWind.w), less
// in a headland's lee as the chop is.
float oceanCapCoverage(vec2 p) {
  return oceanWind.w * oceanShelter(p, SHELTER_CHOP);
}

```

new:

```glsl
// What cuts the whitecaps at p as it cuts the chop: a headland's lee, and the
// near-shore cut of an offshore wind.
float oceanCapDamp(vec2 p) {
  return oceanShelter(p, SHELTER_CHOP) * min(oceanWindAmp(), 1.0);
}

// The whitecaps' coverage at p: Callaghan's for the wind (oceanWind.w), cut
// as the chop is.
float oceanCapCoverage(vec2 p) {
  return oceanWind.w * oceanCapDamp(p);
}

```

Edit 2 — old:

```glsl
  return fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));
}
#endif
```

new:

```glsl
  return fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));
}

// The high tier's folds: where the wind sea's Jacobian falls through
// OCEAN_FOLD its crest folds over, white in full by OCEAN_FOLD_FULL.
const float OCEAN_FOLD = 0.4;
const float OCEAN_FOLD_FULL = 0.3;
// The low tier's bump under the wind sea: its slope a metre of the wind
// sea's height draws, and the most it is scaled.
const float OCEAN_BUMP_HS = 1.0;
const float OCEAN_BUMP_MAX = 2.0;

// The share of a field size metres across, n texels a side, that a pixel of
// pixel metres draws: all while its shortest wave, of wavenumber pi n / size,
// spans four pixels, none from two.
float oceanWindPixelKeep(float size, float n, float pixel) {
  return 1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, 0.5 * OCEAN_TWO_PI * n * pixel / size);
}

// The wind sea's slopes at p as a normal's horizontal part (minus the height's
// gradient), each field faded by the pixel's footprint, and in drawn the
// slope variance the drawn fields carry (oceanWindStats.yzw, each field's
// whole). The high tier's from the slope texture, the medium tier's from the
// loop's heights, two taps an axis a texel apart: the loop's heights and
// lengths scale alike with the wind, so its slopes are the bake's.
vec2 oceanWindSlopesAt(vec2 p, float pixel, out float drawn) {
  vec2 w = oceanWindFrame(p);
  vec2 g = vec2(0.0);
  drawn = 0.0;
  if (oceanCoast.w > 1.5) {
    float k0 = oceanWindPixelKeep(FFT_CASCADE_0, FFT_N, pixel);
    float k1 = oceanWindPixelKeep(FFT_CASCADE_1, FFT_N, pixel);
    float k2 = oceanWindPixelKeep(FFT_CASCADE_2, FFT_N, pixel);
    g = textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_0, 0.0), 0.0).xy * k0
      + textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_1, 1.0), 0.0).xy * k1
      + textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_2, 2.0), 0.0).xy * k2;
    drawn = k0 * k0 * oceanWindStats.y + k1 * k1 * oceanWindStats.z + k2 * k2 * oceanWindStats.w;
  } else if (oceanCoast.w > 0.5) {
    float size = oceanLoopSize();
    vec2 uv = w / size;
    float e = 1.0 / LOOP_N;
    float keep = oceanWindPixelKeep(size, LOOP_N, pixel);
    float gx = oceanLoopRead(uv + vec2(e, 0.0)).x - oceanLoopRead(uv - vec2(e, 0.0)).x;
    float gz = oceanLoopRead(uv + vec2(0.0, e)).x - oceanLoopRead(uv - vec2(0.0, e)).x;
    g = vec2(gx, gz) * (LOOP_N / (2.0 * LOOP_SIZE)) * keep;
    drawn = keep * keep * oceanWindStats.y;
  }
  return -oceanFromWind(g);
}

// The wind sea's slopes at p, nothing faded.
vec2 oceanWindSlopes(vec2 p) {
  float drawn;
  return oceanWindSlopesAt(p, 0.0, drawn);
}

// The wind sea's Jacobian at p, the least of the three cascades', on the high
// tier (1, unfolded, elsewhere).
float oceanWindFold(vec2 p) {
  if (oceanCoast.w < 1.5) return 1.0;
  vec2 w = oceanWindFrame(p);
  float j0 = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_0, 0.0), 0.0).w;
  float j1 = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_1, 1.0), 0.0).w;
  float j2 = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_2, 2.0), 0.0).w;
  return min(j0, min(j1, j2));
}

// The low tier's bump scaled by the wind sea's height here, which the broken
// waves and the headland's lee cut down. Zero on the other tiers, whose sea
// carries no bump.
float oceanBumpScale(float breaking, float shelter) {
  return min(oceanWind.x * (1.0 - breaking) * shelter / OCEAN_BUMP_HS, OCEAN_BUMP_MAX);
}

// The most of the drawn wind sea's slopes the normal takes, so the variance
// they carry, drawn, is never more than Cox and Munk's whole sea for the wind
// in this shelter: the loop, one bake scaled to every wind, keeps a strong
// wind's steepness in a light one, where a calm sea is glassy.
float oceanWindSlopeLimit(float u10, float shelter, float drawn) {
  return min(1.0, sqrt((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter / max(drawn, 1.0e-6)));
}
#endif
```

`client/src/game/shaders/waterLights.fragment.fx`, three edits on Tasks 11 and 12's text, each old → new:

Edit 1 — old:

```glsl
float wOceanChop = oceanShelter(vOceanXZ, SHELTER_CHOP);
float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;
```

new:

```glsl
float wOceanChop = oceanShelter(vOceanXZ, SHELTER_CHOP);
// The wind sea here: its height for the water's edge and the whitecaps, its
// slopes faded by the pixel's footprint, both scaled by its height here,
// which the broken waves and the headland's lee cut down.
float wWindAmp = oceanWindAmp() * (1.0 - wOceanFoam.y) * wOceanChop;
vec3 wWind = oceanWindDisplace(vOceanXZ);
float wWindDrawn;
vec2 wWindSlope = oceanWindSlopesAt(vOceanXZ, max(length(wOceanDx), length(wOceanDy)), wWindDrawn);
float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y + wWind.y * wWindAmp;
```

Edit 2 — old:

```glsl
// The sea's normal is the swell's. PBR's bump is on the sea on the low tier
// alone, where its slope rides on the swell's: elsewhere normalW is still the
// ring's up and adds nothing. The second octave never runs on the sea.
vec2 wOceanExtra = normalW.xz / max(normalW.y, 0.05);
normalW = normalize(wOceanNormal + vec3(wOceanExtra.x, 0.0, wOceanExtra.y) * wOceanNormal.y);
// What Cox and Munk's slope variance for the wind leaves to the roughness
// once the drawn waves carry theirs, calmer in a headland's lee as the chop is.
float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn);
```

new:

```glsl
// The sea's normal is the swell's with the wind sea's slopes on it. PBR's
// bump is on the sea on the low tier alone, where its slope rides on the
// swell's, scaled by the wind sea's height: elsewhere normalW is still the
// ring's up and adds nothing. The second octave never runs on the sea.
float wWindSteep = wWindAmp * oceanWindSlopeLimit(oceanWindDir.z, wOceanChop, wWindDrawn * wWindAmp * wWindAmp);
vec2 wOceanExtra = normalW.xz / max(normalW.y, 0.05) * oceanBumpScale(wOceanFoam.y, wOceanChop) + wWindSlope * wWindSteep;
normalW = normalize(wOceanNormal + vec3(wOceanExtra.x, 0.0, wOceanExtra.y) * wOceanNormal.y);
// What Cox and Munk's slope variance for the wind leaves to the roughness
// once the drawn waves carry theirs, calmer in a headland's lee as the chop is.
float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn + wWindDrawn * wWindSteep * wWindSteep);
```

Edit 3 — old:

```glsl
float wOceanCap = oceanCapCells(vOceanXZ);
wOceanCap *= 1.0 - wOceanFoam.y;
```

new:

```glsl
float wOceanCap = oceanCapCells(vOceanXZ);
if (oceanCoast.w > 0.5) {
  // A drawn wind sea's own crests, and on the high tier its folds.
  float wFold = (1.0 - smoothstep(OCEAN_FOLD_FULL, OCEAN_FOLD, oceanWindFold(vOceanXZ))) * oceanCapDamp(vOceanXZ);
  wOceanCap = max(oceanWhitecap(vOceanXZ, wWind.y / max(oceanWindStats.x, 1.0e-4)), wFold);
}
wOceanCap *= 1.0 - wOceanFoam.y;
```

`client/src/game/waterShading.ts`, one edit on Task 12's text — old:

```ts
export function capProfile(r: number): number {
  return 1 - smoothstep(0.7, 1, r);
}
```

new:

```ts
export function capProfile(r: number): number {
  return 1 - smoothstep(0.7, 1, r);
}

/**
 * The wind sea on the rings and the pixels (spec §6, §7.1, §7.3). A ring displaces a field while its cells
 * are at most 1/OCEAN_WIND_TILE_CELLS of the field's tile, and none of it from twice that; the medium loop's
 * least scale is the wind's floor's, (WIND_SEA_U_FLOOR / WIND_SEA_U_REF)²; the high tier's crests whiten as
 * the wind sea's Jacobian falls through OCEAN_FOLD, in full by OCEAN_FOLD_FULL; the low tier's bump draws its
 * slope at OCEAN_BUMP_HS metres of the wind sea's height, scaled with it to at most OCEAN_BUMP_MAX. Mirrored in
 * shaders/oceanSurface.fx and shaders/oceanShade.fragment.fx.
 */
export const OCEAN_WIND_TILE_CELLS = 16;
export const OCEAN_LOOP_SCALE_MIN = 0.0025;
export const OCEAN_FOLD = 0.4;
export const OCEAN_FOLD_FULL = 0.3;
export const OCEAN_BUMP_HS = 1;
export const OCEAN_BUMP_MAX = 2;

/** The share of a wind sea field `size` metres across that a ring of `cell` metres displaces (`oceanWindRingKeep`). */
export function windRingKeep(size: number, cell: number): number {
  return 1 - smoothstep(1, 2, (OCEAN_WIND_TILE_CELLS * cell) / size);
}

/** The share of a field `size` metres across, `n` texels a side, a pixel of `pixel` metres draws: its shortest
 * wave, of wavenumber π·n/size, turning by that times the pixel over one (`oceanWindPixelKeep`). */
export function windPixelKeep(size: number, n: number, pixel: number): number {
  return resolvedShare((Math.PI * n * pixel) / size);
}

/** How white the high tier's fold makes a crest at a Jacobian `jacobian`. */
export function foldCap(jacobian: number): number {
  return 1 - smoothstep(OCEAN_FOLD_FULL, OCEAN_FOLD, jacobian);
}

/** The low tier's bump scaled by the wind sea's height `hsCut` (m, Hs times the near-shore cut), cut by the
 * break's B and the headland's shelter as the chop is (`oceanBumpScale`). */
export function bumpScale(hsCut: number, breaking: number, shelter: number): number {
  return Math.min((hsCut * (1 - breaking) * shelter) / OCEAN_BUMP_HS, OCEAN_BUMP_MAX);
}

/**
 * The most of the drawn wind sea's slopes the normal takes, so the variance they carry (`drawn`) is never
 * more than Cox and Munk's whole sea for the wind `u10` in the shelter: the medium loop, one bake scaled to
 * every wind, keeps a strong wind's steepness in a light one, where a calm sea should be glassy
 * (`oceanWindSlopeLimit`).
 */
export function windSlopeLimit(u10: number, shelter: number, drawn: number): number {
  return Math.min(1, Math.sqrt((coxMunkVariance(u10) * shelter) / Math.max(drawn, 1e-6)));
}

/**
 * A point (px, pz) in the wind's frame (`oceanWindFrame`): x down the wind (dirX, dirZ), z across it, about
 * the pivot, the cove's waterline centre (`oceanWindPivot`). Both wind sea fields are made with the wind
 * along +x and sampled here, so as the wind turns they turn about the pivot: nothing slides there, and a
 * point r metres off slides at r times the wind's turn (2π/WIND_DIR_PERIOD rad/s), 0.52 m/s at 100 m.
 */
export function windFrame(px: number, pz: number, dirX: number, dirZ: number, pivotX: number, pivotZ: number): [number, number] {
  const rx = px - pivotX;
  const rz = pz - pivotZ;
  return [rx * dirX + rz * dirZ, dirX * rz - dirZ * rx];
}
```

`client/src/game/waterPlugin.ts`, three edits on Task 10's text, each old → new:

Edit 1 — old:

```ts
  /** The wind sea's direction (x, z), its wind speed U10 (m/s), and 0. */
  windDir: [number, number, number, number];
};
```

new:

```ts
  /** The wind sea's direction (x, z), its wind speed U10 (m/s), and 0. */
  windDir: [number, number, number, number];
  /** What the shaders normalise the drawn wind sea by: its height's standard
   * deviation (m) at the wind, before the near-shore cut, then each field's
   * slope variance (the loop's alone, or the FFT's three cascades'); zeros
   * where none is drawn (`oceanWindSource.ts`). */
  windStats: [number, number, number, number];
  /** The point the wind sea's fields turn about as the wind turns, (x, z, 0, 0): the cove's waterline centre,
   * where the sea is seen up close, so nothing slides there (`oceanWindFrame`). */
  windPivot: [number, number, number, number];
};
```

Edit 2 — old:

```ts
/** The eight vec4 uniforms the sea's waves read, in the order they are bound. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
] as const;
```

new:

```ts
/** The ten vec4 uniforms the sea's waves read, in the order they are bound. */
const OCEAN_UNIFORMS = [
  "oceanPhase0", "oceanPhase1", "oceanPhase2", "oceanSwell", "oceanTips", "oceanCoast", "oceanWind", "oceanWindDir",
  "oceanWindStats", "oceanWindPivot",
] as const;
```

Edit 3 — old:

```ts
    const values = [ocean?.swell, ocean?.tips, ocean?.coast, ocean?.wind, ocean?.windDir];
```

new:

```ts
    const values = [ocean?.swell, ocean?.tips, ocean?.coast, ocean?.wind, ocean?.windDir, ocean?.windStats, ocean?.windPivot];
```

`client/src/game/oceanRender.ts`, six edits on Task 10's text, each old → new:

Edit 1 — old:

```ts
import { windSeaStateFor } from "./oceanWindSea.js";
import { oceanArrayPlaceholder, type OceanBinding, type WaterPlugin } from "./waterPlugin.js";
```

new:

```ts
import { windSeaStateFor } from "./oceanWindSea.js";
import { oceanArrayPlaceholder, type OceanBinding, type WaterPlugin } from "./waterPlugin.js";
import { createWindSeaSource, type GpuStarter, type LoopStarter } from "./oceanWindSource.js";
import { coveFor } from "../sim/olympic.js";
```

Edit 2 — old:

```ts
/**
 * The sea's waves for a world and a tier: the low tier draws the eight
 * largest of the swell's twelve components, the others all twelve. The wind
 * sea is drawn by its normals alone (mode 0) on every tier, its two
 * textures the scene's 1×1 array placeholder.
 */
export function createOcean(scene: Scene, seed: number, tier: QualityTier): Ocean {
```

new:

```ts
/**
 * The sea's waves for a world and a tier: the low tier draws the eight
 * largest of the swell's twelve components, the others all twelve. The wind
 * sea is the tier's (`oceanWindSource.ts`): the FFT on high, the loop baked
 * in a worker on medium and wherever the FFT cannot be had, none on low; its
 * textures are the scene's 1×1 array placeholder until a field is ready.
 * `wind` replaces how the fields are started (the tests', under Node).
 */
export function createOcean(
  scene: Scene,
  seed: number,
  tier: QualityTier,
  wind: { startLoop?: LoopStarter; startGpu?: GpuStarter } = {},
): Ocean {
```

Edit 3 — old:

```ts
  const placeholder = oceanArrayPlaceholder(scene);
  const windMode = 0;
  const binding: OceanBinding = {
```

new:

```ts
  const placeholder = oceanArrayPlaceholder(scene);
  const windMode = 0;
  const windSea = createWindSeaSource(scene, seed, tier, wind.startLoop, wind.startGpu);
  // The wind sea's fields turn with the wind about the cove's waterline
  // centre, where the sea is seen up close, so nothing slides there.
  const cove = coveFor(seed);
  const binding: OceanBinding = {
```

Edit 4 — old:

```ts
    wind: [0, 0, 0, 0],
    windDir: [1, 0, 0, 0],
  };
  return {
    atlas,
    windDisp: placeholder,
    windSlope: placeholder,
    windMode,
```

new:

```ts
    wind: [0, 0, 0, 0],
    windDir: [1, 0, 0, 0],
    windStats: [0, 0, 0, 0],
    windPivot: [profiles.coastlineX(cove.z0), cove.z0, 0, 0],
  };
  return {
    atlas,
    // What the binding holds, which follows the wind sea's field as it comes.
    get windDisp() {
      return binding.windDisp;
    },
    get windSlope() {
      return binding.windSlope;
    },
    get windMode() {
      return binding.coast[3] as 0 | 1 | 2;
    },
```

Edit 5 — old:

```ts
      binding.wind[0] = sea.hs * sea.nearShore;
      binding.wind[1] = sea.loopScale;
      // wind[2], the loop's time, is the loop's to keep: 0 while none is drawn.
      binding.wind[3] = sea.coverage;
      binding.windDir[0] = sea.dir[0];
      binding.windDir[1] = sea.dir[1];
      binding.windDir[2] = sea.u10;
```

new:

```ts
      binding.wind[0] = sea.hs * sea.nearShore;
      binding.wind[1] = sea.loopScale;
      binding.wind[3] = sea.coverage;
      binding.windDir[0] = sea.dir[0];
      binding.windDir[1] = sea.dir[1];
      binding.windDir[2] = sea.u10;
      // The tier's wind sea: its field and mode, the loop's time (0 while no
      // loop is drawn) and the numbers the shaders normalise it by.
      windSea.update(sea, seconds);
      binding.windDisp = windSea.disp ?? placeholder;
      binding.windSlope = windSea.slope ?? placeholder;
      binding.coast[3] = windSea.mode;
      binding.wind[2] = windSea.loopTime;
      for (let i = 0; i < 4; i++) binding.windStats[i] = windSea.stats[i] as number;
```

Edit 6 — old:

```ts
    dispose() {
      // The placeholder is the scene's, shared, and goes with the scene.
      atlas.dispose();
    },
```

new:

```ts
    dispose() {
      // The placeholder is the scene's, shared, and goes with the scene.
      atlas.dispose();
      windSea.dispose();
    },
```

`client/test/architecture.test.ts`, one edit (in `BABYLON_FREE_FILES`; the other tasks' files may sit beside it) — old:

```ts
      join(SRC, "game", "lensParams.ts"),
```

new:

```ts
      join(SRC, "game", "lensParams.ts"),
      join(SRC, "game", "oceanLoopBake.ts"),
      join(SRC, "game", "oceanLoop.worker.ts"),
```

Checked while drafting, against Tasks 1–12 as drafted (Tasks 2 and 3's code, Task 10's `waterPlugin.ts`, `oceanRender.ts`, test setup and tests applied verbatim to a scratch copy, then this task's edits): `oceanShader.test.ts` 29, `oceanLoopBake.test.ts` 7, `oceanWindSource.test.ts` 8, `oceanRender.test.ts` 11 and `waterPlugin.test.ts` 27 pass; `tsc` clean on the new and changed files; the sea's stages on every tier compile through glslang and translate through twgsl, the vertex WGSL with `textureSampleLevel` only (`oceanWindDisplaceAt` in it), the fragment's ocean reads all `textureSampleLevel`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --root client test/game/oceanLoopBake.test.ts test/game/oceanWindSource.test.ts test/game/oceanShader.test.ts test/game/oceanRender.test.ts test/game/waterPlugin.test.ts test/game/waterMesh.test.ts test/game/interStage.test.ts test/game/shaderHygiene.test.ts test/architecture.test.ts && npx tsc -p client --noEmit && npx eslint client/src/game/oceanLoopBake.ts client/src/game/oceanLoop.worker.ts client/src/game/oceanWindSource.ts client/src/game/oceanRender.ts client/src/game/waterPlugin.ts client/src/game/waterShading.ts client/test/game/oceanLoopBake.test.ts client/test/game/oceanWindSource.test.ts client/test/game/oceanShader.test.ts client/test/game/oceanRender.test.ts client/test/game/waterPlugin.test.ts client/test/architecture.test.ts`
Expected: PASS (7 tests in `oceanLoopBake.test.ts`, 8 in `oceanWindSource.test.ts`, 29 in `oceanShader.test.ts`, 11 in `oceanRender.test.ts`, 27 in `waterPlugin.test.ts`; `interStage.test.ts` still 7 and 8 of 19 varyings, 9 and 10 fragment textures)

- [ ] **Step 5: Commit**

```bash
git add client/src/game/oceanLoopBake.ts client/src/game/oceanLoop.worker.ts client/src/game/oceanWindSource.ts client/src/game/shaders/oceanSurface.fx client/src/game/shaders/oceanShade.fragment.fx client/src/game/shaders/waterLights.fragment.fx client/src/game/waterShading.ts client/src/game/waterPlugin.ts client/src/game/oceanRender.ts client/test/architecture.test.ts client/test/game/oceanLoopBake.test.ts client/test/game/oceanWindSource.test.ts client/test/game/oceanShader.test.ts client/test/game/oceanRender.test.ts client/test/game/waterPlugin.test.ts
git commit -F - <<'EOF'
feat: the wind sea on every tier, from a GPU FFT to the bump

## What

A wind sea from the weather and the hour now rides on the swell. On the
high tier it is the WebGPU FFT's three cascades; on the medium tier, and
on high wherever compute cannot be had, a 20 s loop baked once at load in
a module worker and scaled to the wind; on the low tier the bump, its
slope scaled by the wind sea's height. Both fields are made with the wind
along +x and turned to the wind in the shaders, about the cove's
waterline, so the chop never slides where the sea is seen up close and the
FFT's spectrum is rebuilt only when the wind's speed moves. The chop displaces the rings it
suits, shades every pixel it suits, dies shoreward of the break and in a
headland's lee, never draws steeper than Cox and Munk allow the wind, and
carries the whitecaps on its crests, on the high tier its folds too.

## How

- `client/src/game/oceanLoopBake.ts` — the loop's spectrum, frames, half
  floats and measured numbers, and a band's share of the spectrum.
- `client/src/game/oceanLoop.worker.ts` — the bake off the main thread.
- `client/src/game/oceanWindSource.ts` — the field by tier: the FFT, its
  fallbacks, the loop's texture and clock, the numbers the shaders use.
- `client/src/game/shaders/oceanSurface.fx` — the fields' reads in the
  wind's frame about the cove's pivot, the ring's fade, the chop's displacement and its cut.
- `client/src/game/shaders/oceanShade.fragment.fx` — the chop's slopes,
  folds and limit, the low tier's bump, the caps' cut.
- `client/src/game/shaders/waterLights.fragment.fx` — the chop in the
  waterline, the normal, the roughness and the whitecaps.
- `client/src/game/waterShading.ts` — the chop's numbers, mirrored.
- `client/src/game/waterPlugin.ts`, `client/src/game/oceanRender.ts` — the
  oceanWindStats and oceanWindPivot uniforms, the cove's pivot, the field
  bound by tier each frame.
- `client/test/architecture.test.ts` — the bake and its worker stay free of
  Babylon.
- `client/test/game/oceanLoopBake.test.ts`,
  `client/test/game/oceanWindSource.test.ts`,
  `client/test/game/oceanShader.test.ts`,
  `client/test/game/oceanRender.test.ts`,
  `client/test/game/waterPlugin.test.ts` — the loop's closure and scaling,
  the worker's reply, the tiers and their fallbacks, the pivot, the shaders' numbers.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF
```

---

### Task 14: The release: the whole suite, the moved pins, the architecture note

**Files:**
- Modify: `ARCHITECTURE.md` (the Rendering section: the wind's sentence and the water paragraph)
- Modify: whichever pinned values the whole suite shows moved by this release's rendering (expected: none outside the files Tasks 4, 9, 10 and 11 already updated)

**Interfaces:**
- Consumes: everything above.
- Produces: a branch whose typecheck, lint, three test suites and build pass.

- [ ] **Step 1: Write the architecture note**

In `ARCHITECTURE.md`, in the Rendering section, replace:

```markdown
One wind field (`client/src/game/windParams.ts`) moves the ground cover,
```

with:

```markdown
One wind field (`client/src/game/windParams.ts`), on the sim's tick so every player's gusts agree, moves the ground cover,
```

In the water paragraph (the one that begins "The water is one `PBRMaterial` on a body's row"), append after its last sentence:

```markdown
The sea moves (`client/src/game/ocean*.ts`, `shaders/ocean*.fx`). A swell seeded per world, inside the real coast's range of height, period and direction, is a sum of twelve components (eight on the low tier) in pairs close in frequency, so it arrives in sets; each component's phase is integrated along the coast from tables built at load from the bed's own profiles (`oceanTables.ts`), so a wave slows, steepens and turns toward the beach as the bed rises, and a rule by the depth under it (Weggel's breaker index) caps it and spills it into a bore and its white water across the cove's bed (`oceanWaves.ts`), sheltered behind the headlands. The tables, the components and the coastline reach the GPU as one float texture, which the water plugin reads in the vertex stage, displacing seven stitched rings from 1 m, and in the fragment stage, for the normal, the break and the foam. A wind sea from the weather and the hour rides on the swell, with whitecaps by Callaghan's coverage: a GPU FFT of three cascades in WebGPU compute on the high tier (`oceanGpuFft.ts`), a 20 s loop baked in a worker at load on the medium tier (`oceanLoopBake.ts`), the bump's normals on the low tier. The sea runs on the sim's tick (`sharedSeconds`, `oceanWindSea.ts`), so every player sees the same crest at the same moment, and `crestAt` and `boreArrivals` give the shore's later work each wave's height, period and phase.
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean. Fix anything they report in the file that introduced it, and commit the fix with what it belongs to in the subject (`fix: …`).

- [ ] **Step 3: The whole suite, on a quiet machine**

First check nothing else is running a suite or a browser gate: `pgrep -fl vitest` prints nothing and the 1-minute load average (`sysctl -n vm.loadavg`) is under 2.5. Then:

Run: `npm test`
Expected: PASS. This release changes nothing under `client/src/sim/` but one `export`, so no pin that encodes the world may move: `tierDeterminism.test.ts`'s `passHash` stays `-418956087`, and a sim fixture that moves is a defect, not a pin to update. A rendering pin that moved (a ring count, a culling box, a source-text pin of the renderer's sync) moves by design only if the task that changed it says so; update it to what the test now reports and note old and new values in the commit. Any other failure is a defect: fix it in the file that introduced it.

- [ ] **Step 4: The build**

Run: `npm run build && node tools/wgsl/check-build.mjs`
Expected: both succeed. The corpus does not hold the new stages yet (Task 15 records them), so the maps are today's size; `check-build` checks the maps the build made, not their coverage.

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md
git commit -F - <<'EOF2'
docs: the sea's waves in the architecture note

## What

The architecture note says how the sea moves: a seeded swell in sets that
shoals, turns and spills across the cove's bed, a wind sea from the weather
and the hour drawn by each tier its own way, and one clock, the sim's tick,
for the sea and the wind.

## How

- `ARCHITECTURE.md` — the wind's sentence names its clock; the water
  paragraph gains the swell, the break, the atlas, the rings, the wind sea by
  tier and the shared clock.

Co-Authored-By: <the committing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DZCynEaC9jVSqMGsejsau4
EOF2
```

(Add to `git add` and to the `## How` list every file whose pin moved in Step 3, with its old and new values.)

---

### Task 15: The gates in the browser (the controller's, not a subagent's)

**Files:**
- Modify: `client/shaders/corpus/` (recorded files only, through `tools/wgsl/merge-corpus.mjs`; superseded stages retired)
- Modify: `tools/wgsl/test/corpusFiles.test.mjs` (the stage count, the em-dash count, the tiers' counts and sets)
- Modify: `docs/rendering/2026-10-02-ocean-waves-design.md` (§10 the costs measured, §11 the gates' results)

**Interfaces:**
- Consumes: the finished branch.
- Produces: the corpus with the release's stages on every tier, the look gates passed on the owner's word, the cost measured and reported. Merging and deploying stay the owner's call.

These steps drive the real game and need the machine: the controller runs them itself, one at a time, following the browser-verification recipe (its own ports, its own Chrome profile, headed Chrome, the gate rig's page hooks applied uncommitted, a silent machine for timings).

- [ ] **Step 1: Find the gate worlds**

With a scratch script outside the repository (never committed), for `i` from 0 to 199 with `seed = seedFromToken(\`room-${i}\`)`, read `swellStateFor(seed)`, `coveFor(seed)` and `coastProfilesFor(seed)`, and take the first room of each kind:

| World | Swell | For |
| --- | --- | --- |
| Typical | Hs 1.7–2.3 m, Tp 10–12 s, from 265–285° | the cove's surf, sets and white water, the headland's lee, the open sea |
| Big | Hs ≥ 3.0 m | the storm sea under the rain weather |
| Small | Hs ≤ 1.1 m | the calm dawn |

For each, write down the pad, the cove's centre `z0` and half-width, the waterline `coastlineX(z0)`, the berm's crest, the headlands' tips, and the swell's travel direction, and from them the poses: from the pad with the break line in view (eye height, looking out to sea, pitch 0.12); from the berm's crest along the beach (yaw along the shore, pitch 0.08); across the cove's up-swell end toward the headland that shelters it; the open sea to the horizon from the berm (pitch 0.02).

- [ ] **Step 2: Record the shader corpus on every tier**

The waves re-key every stage of the sea's material, and the corpus's recorder runs on WebGPU only, so every tier is recorded with `&engine=webgpu&tier=<tier>&wgsl=record` (high, medium, low). For each gate world and pose, at noon, at night and in the rain weather (the sun pinned per reading), load the dev build and visit, each pose several times (a variant can show on one visit in three); add the lakes' poses of the water terrain's gates (a murky lake across its water, a clear lake's shelf from its shore) at noon and night on every tier, so every lake stage is met again. Download each page's recording and merge them:

```bash
node tools/wgsl/merge-corpus.mjs <recording.json> [<recording.json> ...]
```

Then retire the stages this release superseded: the water stages no recording of this run met (the sea's material from before `OCEAN`). With a scratch script outside the repository, list the stage files each of this run's recordings holds (`stageFile(entry, shared)` from `tools/wgsl/lib/corpus.mjs` over each recording's entries), and list the corpus's stage files whose text holds `waterBedHeight`; a file in the second list and not the first is retired if its text holds no `oceanAtlas` and every lake stage of the corpus is in the first list (if a lake stage is missing, visit the lakes again until it is met, rather than retire it). Remove the retired files with `removeCorpusFiles` and rewrite `tiers.json` with the tool's own text (`tiersText`), as the corpus's last retirement did.

Update the literals in `tools/wgsl/test/corpusFiles.test.mjs` (the stage count, the em-dash count, the tiers' counts and their sets, and the test's title) to what the merged corpus holds, then:

Run: `npx vitest run --root tools wgsl/test && npm run build && node tools/wgsl/check-build.mjs`
Expected: PASS, and every tier's map under the 10 MiB ceiling (`MAP_MAX_BYTES`). If a tier's map is over, stop and report its size to the owner; the ceiling is not raised unasked.

Commit as `feat: add the sea's waves to the corpus, retire what they replace`, its `## How` listing the corpus directory, `tiers.json` and the test with the counts' old and new values.

- [ ] **Step 3: The look gates**

At each pose, the sun pinned, take a still on the high tier and set it beside the reference photos by id; then the same pose on medium and low for the tiers' comparison:

| Gate | World | Pose | When | Reference |
| --- | --- | --- | --- | --- |
| The cove's surf | typical | from the pad, the break line in view | noon, dusk | `ruby-05`, `rialto-03` |
| Sets and white water | typical | from the berm along the beach | noon, dusk | `ruby-01`, `kalaloch-11` |
| The headland's lee | typical | across the cove's up-swell end | noon | `kalaloch-11` |
| A calm dawn | small | the cove at dawn, glassy | dawn | `ruby-11`, `rialto-11` |
| The open sea | typical, big | to the horizon, low sun; the big world in the rain weather | dusk, storm | `kalaloch-11` |

For the sets, take a short sequence (a still every 2 s for 3 minutes) from the berm and confirm the larger waves come in groups 100 to 200 s apart. For the white water, confirm the foam lies shoreward of the first break, thins over about 20 s behind each bore, and does not stand where the water is deep. For the lee, confirm the swell and the chop are lower behind the up-swell headland than across the cove. Read each page's console: no errors. Show the owner the stills and the sequence. A gate passes on the owner's word; a gate the owner turns back becomes a fix with its own test, then the still again.

- [ ] **Step 4: One sea for every player**

With the two-page rig (two pages joined to one room on the same build), set both free cameras to the cove's pose from the pad. On each page, at the same sim tick, evaluate the crest at the cove's centre on the first broken wave's line through the dev server's module path (`import("/dayhike/src/game/oceanWaves.ts")`, `crestAt(oceanFieldFor(seed), swellPhases(field, sharedSeconds(tick, 0)), x, z)`) and compare: identical. Take a still from each page within the same second: the same set, the same break.

- [ ] **Step 5: The cost**

Measured as the water material's and the terrain's were (spec §10): a control build of `origin/main` in a detached worktree beside this branch's build, a silent machine, 3840 × 2160 (hardware scaling 0.5), paired readings in the order off, on, on, off on fresh pages, alternated between rounds, a discarded warm-up page and a same-code pair for the noise floor, at the two worst poses (the cove from the pad with the break line in view; the open sea to the horizon), on every tier (high on WebGPU, medium and low on WebGL2), noon. Report the cost added over `main` on each tier, scaled to its pixels, with the cut order beside it (the third cascade, the swell's components 12 to 8, the inner ring, the foam pattern's detail), for the owner to judge. No bar is set in advance.

- [ ] **Step 6: Record the gates in the spec**

In `docs/rendering/2026-10-02-ocean-waves-design.md`, under §10's cost paragraph add the measured table (tier, pose, `main`, branch, added, scaled to the tier's pixels) and the two early measurements of Task 5; under §11's gates table add what each gate showed and the owner's word. Commit as `docs: the sea's waves' gates as passed`. Run the repository's pre-push scan over `origin/main..HEAD` (it must print `0 failing` apart from the two video files `main` already carries). Then stop and ask the owner about merging and deploying; after a deploy, the live first visits on every tier are checked for corpus misses as the last deploy's were.
