# The title loop — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The title page plays a slow, silent, 30-second loop of the game's world behind its title
and buttons, as light to load as it is today.

**Architecture:** A second scene on the scene route (`/dayhike/scene/title`) frames five places of
the film's world under overcast haze; a recording of it ships as `video/title.mp4` with its still.
On the title page a pure model decides still or loop from the visitor's connection and settings and
the video's events, and a renderer draws what it says. The deploy check learns the title film.

**Tech Stack:** TypeScript, Babylon.js 9.18, Vite, vitest (Node, NullEngine, the stand-in DOM).

**Spec:** [`2026-10-01-title-loop.md`](2026-10-01-title-loop.md). The film itself is recorded,
assembled and delivered by the asset repository's own plan; Task 9 here is where the two meet.

## Global Constraints

- The title page's first load stays under 1.5 MB and fetches the still alone (spec §4).
- The loop: silent, 1280 by 640, 24 fps, exactly 30 s (720 frames), its seam inside a dissolve; the
  still its first frame (spec §3).
- The title scene: the world `hollow`, `overcast` (cloud 0.8, mist 0.25), one held afternoon hour,
  five shots of 7 s starting on whole seconds, no people, car, captions or wildlife; the camera
  under 2 m/s and under 0.12 rad/s in every shot (spec §2).
- Still only: `saveData`; `effectiveType` `slow-2g`, `2g` or `3g` (no `navigator.connection` counts
  as fast); `prefers-reduced-motion: reduce`; no title film; any video error or refused `play()`.
- The still and the loop: under the page's vignette, a 2 px blur scaled 1.03 (spec §4).
- Numeric test expectations are literals; explicit test time limits are `timeLimit(<ms>)`.
- Commits: type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list with
  backticked paths. Stage explicit paths only.
- This branch merges only after the title film's export has landed in it (Task 9): before that the
  title page has no still.

## Review Focus

1. **A visitor who presses Play before the loop has arrived.** The download is cancelled and nothing
   of the loop plays over the film (Task 6: "stops for good on Play, whatever it was doing";
   Task 7: "drops the download on stop").
2. **A tab opened in the background.** No `visibilitychange` fires for a page that starts hidden;
   the loop must not play unseen, and plays once shown (Task 7: "a page opened in a background tab").
3. **A page whose `load` has already fired when the loop is made** (a fast cache, a return to the
   title page). The download still starts (Task 7: "starts at once when the page has already loaded").
4. **A cut that moves the camera hundreds of metres.** The first frame after it is drawn on a world
   that has finished streaming in around the new camera, not one filling in (Task 4).
5. **A world with no lake on its trail.** The third shot frames a meadow, or the hills, and the
   scene still builds (Task 2: "frames a meadow where the world has no lake").

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/game/scene/shots.ts` | + `drift`: a constant-speed move. |
| `client/src/game/scene/title.ts` (new) | The title scene: its constants, `TitleWorld`, `titleScene`. |
| `client/src/game/router.ts` | + `/scene/title`. |
| `client/src/game/scene/sceneRoute.ts` | The route picks the scene; the title's world and `ready`; the settle after a cut. |
| `client/src/game/scene/cameraJump.ts` (new) | `cameraJumped` and the settle's constants, pure. |
| `client/src/main.ts` | The route's scene name; the title loop on the title page. |
| `client/src/game/assetUrls.ts` | `titleVideoUrl`, `titleStillUrl`; `stillUrl` goes. |
| `client/src/game/titleLoopModel.ts` (new) | The loop's decisions, pure. |
| `client/src/game/titleLoop.ts` (new) | The still and the video, drawn as the model says. |
| `client/src/game/landing.ts` | The backdrop's CSS: the 2 px blur, the still's fade, the video. |
| `client/src/game/landingBackdrop.ts` | Removed with its test: `titleLoop.ts` draws the still. |
| `client/test/game/helpers/standInDom.ts` | + a document's `readyState` and `visibilityState`, and a `<video>`. |
| `tools/deploy/lib/modelUrls.mjs`, `tools/deploy/verify.mjs` | The films and the title still, read from every chunk. |
| `docs/gameplay/2026-10-01-title-loop-staging.md` (new) | The look and the page's gates as measured. |

---

### Task 1: A constant-speed camera move

**Files:**
- Modify: `client/src/game/scene/shots.ts` (after `push`, line 87)
- Test: `client/test/game/scene/shots.test.ts`

**Interfaces:**
- Produces: `drift(from: Look, to: Look, seconds: number, at: Look | ((t: number) => Look), fov?: number): Shot` — the camera moves from `from` to `to` at one speed over `seconds` (held at `to` after), looking at `at` (a point, or a point at the shot's time).

- [ ] **Step 1: Write the failing test** (add `drift` to the file's import from `shots.js`)

```ts
describe("a drift", () => {
  it("moves at one speed from start to end, looking where it is told", () => {
    const shot = drift({ x: 0, y: 10, z: 0 }, { x: 14, y: 10, z: 0 }, 7, { x: 100, y: 10, z: 0 });
    expect([shot(0).x, shot(3.5).x, shot(7).x, shot(9).x]).toEqual([0, 7, 14, 14]);
    // Straight down +x is a yaw of a quarter turn.
    expect(shot(1).yaw).toBeCloseTo(1.570796, 6);
    const moving = drift({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7 }, 7, (t) => ({ x: t, y: 0, z: 100 }));
    expect(moving(0).yaw).toBe(0);
    expect(moving(7).yaw).toBeCloseTo(0.075127, 6);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/scene/shots.test.ts`
Expected: FAIL — `drift` is not exported.

- [ ] **Step 3: Write `drift`**

```ts
/** A move from `from` to `to` at one speed over `seconds`, then held, looking at `at` (a point, or
 * a point at the shot's time). No ease: a shot that dissolves into the next keeps its speed through
 * the dissolve, where an eased one would be seen to stop. */
export function drift(from: Look, to: Look, seconds: number, at: Look | ((t: number) => Look), fov = FILM_FOV): Shot {
  return (t) => {
    const u = seconds > 0 ? Math.min(1, Math.max(0, t / seconds)) : 1;
    const target = typeof at === "function" ? at(t) : at;
    return lookAt({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u }, target, fov);
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run --root client test/game/scene/shots.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat: a constant-speed camera move for the scenes`; `## How`: `client/src/game/scene/shots.ts`, `client/test/game/scene/shots.test.ts`.

---

### Task 2: The title scene

**Files:**
- Create: `client/src/game/scene/title.ts`
- Test: `client/test/game/scene/title.test.ts`

**Interfaces:**
- Consumes: `drift` (Task 1); `holdLookingAt`, `cutList`, `Cut`, `Look` (`shots.ts`); `Scene` (`timeline.ts`); `WEATHER_PRESETS` (`../weather.js`); `INTRO_SEED_TOKEN` (`intro.ts`).
- Produces:
  - `TITLE_DURATION = 35`; `TITLE_SHOTS: readonly { from: number; to: number }[]` = `[0,7]`, `[7,14]`, `[14,21]`, `[21,28]`, `[28,35]`; `TITLE_HOUR = 15`; `TITLE_WEATHER = WEATHER_PRESETS.overcast`; `TITLE_SEED_TOKEN = INTRO_SEED_TOKEN`.
  - `type TitleWorld = { ground(x: number, z: number): number; seaLevel: number; coastlineX(z: number): number; cove: { z0: number; halfWidth: number }; water: { x: number; z: number; radius: number; level: number } | null; meadow: { x: number; z: number; radius: number } | null; peak: { x: number; z: number; radius: number }; start: { x: number; z: number; yaw: number } }`
  - `titleScene(world: TitleWorld): Scene`

The world the route builds this from (`hollow`, measured): the trail's start at (−312, 0.3) facing
+x (yaw 1.44); the shoreline near x −405 at z 0, the sea to −x at level 0; the cove at z0 0,
half-width 177, its headlands at z ±177 reaching 103 and 113 m out to sea and 23 and 25 m high; the
lake at (165, 60), radius 36, its water at 175.3 m; the peak at (408, −172), radius 300, its crest at
256 m. The camera constants below are the look's starting values: Task 9 sets them by frames. The
tests pin the rules (where each shot is, how slow, never under the ground or the water), not the
constants.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { TITLE_DURATION, TITLE_HOUR, TITLE_SHOTS, TITLE_WEATHER, titleScene, type TitleWorld } from "../../../src/game/scene/title.js";
import { evaluate } from "../../../src/game/scene/timeline.js";
import { FOV_MAX, FOV_MIN } from "../../../src/game/scene/shots.js";

/** A test world: the sea west of x = -300 at level 0, the ground rising 0.1 m a metre inland, a lake
 * at (200, 400) whose water is at 50 m, a meadow at (400, 200), the peak at (900, 600). */
const world: TitleWorld = {
  ground: (x) => Math.max(0, (x + 300) * 0.1),
  seaLevel: 0,
  coastlineX: () => -300,
  cove: { z0: 0, halfWidth: 150 },
  water: { x: 200, z: 400, radius: 30, level: 50 },
  meadow: { x: 400, z: 200, radius: 40 },
  peak: { x: 900, z: 600, radius: 60 },
  start: { x: -230, z: 10, yaw: 1.4 },
};
const camAt = (w: TitleWorld, t: number) => evaluate(titleScene(w), t).camera;

describe("the title scene", () => {
  it("is five shots of seven seconds on whole seconds, in the overcast at a held hour, with no one in it", () => {
    expect(TITLE_DURATION).toBe(35);
    expect(TITLE_SHOTS.map((s) => [s.from, s.to])).toEqual([[0, 7], [7, 14], [14, 21], [21, 28], [28, 35]]);
    expect([TITLE_WEATHER.cloudCover, TITLE_WEATHER.mist, TITLE_HOUR]).toEqual([0.8, 0.25, 15]);
    const frame = evaluate(titleScene(world), 10);
    expect([frame.actors.length, frame.car, frame.caption, frame.black]).toEqual([0, null, null, 0]);
  });

  it("frames the cove from well out over the sea, looking inland", () => {
    const c = camAt(world, 3);
    expect(c.x).toBeLessThan(-500);
    expect(Math.abs(c.z)).toBeLessThan(150);
    expect(Math.sin(c.yaw)).toBeGreaterThan(0.9);
  });

  it("glides over the forest, well above the ground", () => {
    for (let t = 7; t < 14; t += 0.5) {
      const c = camAt(world, t);
      expect(c.y - world.ground(c.x, c.z)).toBeGreaterThan(30);
    }
  });

  it("looks across the lake from beyond its shore", () => {
    const c = camAt(world, 17);
    expect(Math.hypot(c.x - 200, c.z - 400)).toBeLessThan(90);
    expect(Math.hypot(c.x - 200, c.z - 400)).toBeGreaterThan(30);
  });

  it("frames a meadow where the world has no lake, and the hills where it has neither", () => {
    const meadow = camAt({ ...world, water: null }, 17);
    expect(Math.hypot(meadow.x - 400, meadow.z - 200)).toBeLessThan(100);
    const hills = camAt({ ...world, water: null, meadow: null }, 17);
    expect(Math.hypot(hills.x + 230, hills.z - 10)).toBeLessThan(15);
  });

  it("rises at the trail's start", () => {
    const [a, b] = [camAt(world, 22), camAt(world, 27)];
    expect(Math.hypot(a.x + 230, a.z - 10)).toBeLessThan(15);
    expect(b.y).toBeGreaterThan(a.y);
  });

  it("pushes toward the summit", () => {
    const [a, b] = [camAt(world, 29), camAt(world, 34)];
    expect(Math.hypot(b.x - 900, b.z - 600)).toBeLessThan(Math.hypot(a.x - 900, a.z - 600));
  });

  it("moves slowly in every shot, under 2 m/s and 0.12 rad/s, and never under the ground or the water", () => {
    const scene = titleScene(world);
    for (const { from, to } of TITLE_SHOTS) {
      for (let t = from; t + 1 / 24 < to; t += 1 / 24) {
        const [a, b] = [evaluate(scene, t).camera, evaluate(scene, t + 1 / 24).camera];
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 24).toBeLessThan(2);
        const dYaw = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
        expect(Math.hypot(dYaw, b.pitch - a.pitch) * 24).toBeLessThan(0.12);
        expect(a.fov).toBeGreaterThanOrEqual(FOV_MIN);
        expect(a.fov).toBeLessThanOrEqual(FOV_MAX);
        expect(a.y).toBeGreaterThan(Math.max(world.ground(a.x, a.z), world.seaLevel) + 1);
      }
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/title.test.ts`
Expected: FAIL — `title.js` does not exist.

- [ ] **Step 3: Write `title.ts`**

```ts
/**
 * The title loop's scene: five slow shots of the film's world in overcast haze, end to end, recorded
 * and joined by dissolves into the title page's 30 s loop (`docs/gameplay/2026-10-01-title-loop.md`
 * §2). A pure function of the world's places; no people, no car, no captions.
 */
import { WEATHER_PRESETS } from "../weather.js";
import { INTRO_SEED_TOKEN } from "./intro.js";
import { cutList, drift, holdLookingAt, type Cut, type Look } from "./shots.js";
import type { Scene } from "./timeline.js";

export const TITLE_DURATION = 35;
export const TITLE_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 7 }, { from: 7, to: 14 }, { from: 14, to: 21 }, { from: 21, to: 28 }, { from: 28, to: 35 },
];
/** One afternoon hour, held: the light never changes across the loop. */
export const TITLE_HOUR = 15;
export const TITLE_WEATHER = WEATHER_PRESETS.overcast;
/** The film's world: the place in the title, the film and the hike is one place. */
export const TITLE_SEED_TOKEN = INTRO_SEED_TOKEN;

export type TitleWorld = {
  ground(x: number, z: number): number;
  seaLevel: number;
  /** The shoreline's x at z; the sea lies to -x. */
  coastlineX(z: number): number;
  cove: { z0: number; halfWidth: number };
  water: { x: number; z: number; radius: number; level: number } | null;
  meadow: { x: number; z: number; radius: number } | null;
  peak: { x: number; z: number; radius: number };
  start: { x: number; z: number; yaw: number };
};

/** Every moving shot's move: 12 m in its 7 s, 1.7 m/s. */
const DRIFT_M = 12;
const SHOT_S = 7;
/** The coast: this far out to sea from the shoreline (past the headlands' reach), this high, starting
 * this far along the shore from the cove's middle, looking into the cove. */
const COAST_OUT_M = 250;
const COAST_UP_M = 8;
const COAST_ALONG_M = -30;
/** The forest: from this share of the way from the trail's start to the peak, this high over the ground. */
const CANOPY_ALONG = 0.25;
const CANOPY_UP_M = 45;
/** The lake: the camera this far beyond its rim on the trail's side, this high over the water or
 * the bank, panning this far across it. */
const SHORE_OUT_M = 25;
const SHORE_UP_M = 4;
const PAN_RAD = 0.6;
/** Where there is no lake or meadow: over the trail's start, looking at the peak. */
const HILLS_UP_M = 20;
/** The trailhead: the camera this far behind the start, rising between these heights, looking this
 * far up the trail. */
const START_BACK_M = 6;
const RISE_FROM_M = 1.6;
const RISE_TO_M = 7.6;
const TRAIL_LOOK_M = 30;
/** The summit: the push starts this far short of the peak's middle, this high over the ground. */
const SUMMIT_SHORT_M = 220;
const SUMMIT_UP_M = 30;

export function titleScene(w: TitleWorld): Scene {
  const onGround = (x: number, z: number, up: number): Look => ({ x, y: w.ground(x, z) + up, z });
  const toPeak = { x: w.peak.x - w.start.x, z: w.peak.z - w.start.z };
  const peakDist = Math.hypot(toPeak.x, toPeak.z);
  const dir = { x: toPeak.x / peakDist, z: toPeak.z / peakDist };
  const peakLook = onGround(w.peak.x, w.peak.z, 0);
  const ahead = (from: Look): Look => ({ x: from.x + dir.x * DRIFT_M, y: from.y, z: from.z + dir.z * DRIFT_M });

  // 1. The coast: well out over the sea, drifting along the shore across the cove's mouth.
  const coastAt = (z: number): Look => {
    const x = w.coastlineX(z) - COAST_OUT_M;
    return { x, y: Math.max(w.seaLevel, w.ground(x, z)) + COAST_UP_M, z };
  };
  const coastFrom = coastAt(w.cove.z0 + COAST_ALONG_M);
  const coastTo = coastAt(w.cove.z0 + COAST_ALONG_M + DRIFT_M);
  const coveLook: Look = { x: w.coastlineX(w.cove.z0), y: w.seaLevel + 6, z: w.cove.z0 };

  // 2. Over the forest: from a quarter of the way to the peak, gliding toward it.
  const glideFrom = onGround(w.start.x + toPeak.x * CANOPY_ALONG, w.start.z + toPeak.z * CANOPY_ALONG, CANOPY_UP_M);

  // 3. The lake (a meadow where there is none, the hills where neither): from beyond its rim on the
  // trail's side, panning across it.
  const pond = w.water ?? (w.meadow === null ? null : { ...w.meadow, level: w.ground(w.meadow.x, w.meadow.z) });
  const third = (): Cut["shot"] => {
    if (pond === null) return holdLookingAt(onGround(w.start.x, w.start.z, HILLS_UP_M), () => peakLook);
    const back = Math.atan2(w.start.x - pond.x, w.start.z - pond.z);
    const out = pond.radius + SHORE_OUT_M;
    const ex = pond.x + Math.sin(back) * out, ez = pond.z + Math.cos(back) * out;
    const eye: Look = { x: ex, y: Math.max(pond.level, w.ground(ex, ez)) + SHORE_UP_M, z: ez };
    const across = back + Math.PI;
    return holdLookingAt(eye, (t) => {
      const a = across - PAN_RAD / 2 + PAN_RAD * Math.min(1, t / SHOT_S);
      return { x: eye.x + Math.sin(a) * out, y: pond.level, z: eye.z + Math.cos(a) * out };
    });
  };

  // 4. The trailhead: behind the start, rising, looking up the trail.
  const sy = Math.sin(w.start.yaw), cy = Math.cos(w.start.yaw);
  const riseX = w.start.x - sy * START_BACK_M, riseZ = w.start.z - cy * START_BACK_M;
  const trailLook = onGround(w.start.x + sy * TRAIL_LOOK_M, w.start.z + cy * TRAIL_LOOK_M, 3);

  // 5. The summit: from the trail's side, pushing toward the peak.
  const summitFrom = onGround(w.peak.x - dir.x * SUMMIT_SHORT_M, w.peak.z - dir.z * SUMMIT_SHORT_M, SUMMIT_UP_M);

  const s = TITLE_SHOTS;
  const cuts: Cut[] = [
    { ...s[0]!, shot: drift(coastFrom, coastTo, SHOT_S, coveLook) },
    { ...s[1]!, shot: drift(glideFrom, ahead(glideFrom), SHOT_S, peakLook) },
    { ...s[2]!, shot: third() },
    { ...s[3]!, shot: drift(onGround(riseX, riseZ, RISE_FROM_M), onGround(riseX, riseZ, RISE_TO_M), SHOT_S, trailLook) },
    { ...s[4]!, shot: drift(summitFrom, ahead(summitFrom), SHOT_S, peakLook) },
  ];
  return { duration: TITLE_DURATION, camera: cutList(cuts), actors: [], car: null, captions: [], black: () => 0 };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --root client test/game/scene/title.test.ts`
Expected: PASS. A failure in the last test means a constant moves the camera too fast or too low:
change the constant, never the test's limits.

- [ ] **Step 5: Commit** — `feat: the title loop's scene, five slow shots of the world`; `## How`: `client/src/game/scene/title.ts`, its test.

---

### Task 3: The title scene on the scene route

**Files:**
- Modify: `client/src/game/router.ts:12-14,63`, `client/src/main.ts:826`, `client/src/game/scene/sceneRoute.ts`
- Test: `client/test/game/router.test.ts:78-79`, `client/test/game/scene/sceneRoute.test.ts`

**Interfaces:**
- Consumes: `titleScene`, `TitleWorld`, `TITLE_HOUR`, `TITLE_WEATHER`, `TITLE_SEED_TOKEN` (Task 2); `whenSceneReady` (`../rendererSwap.js`); `READY_MAX_MS` (`../startReady.js`, 60 000); `coveFor` (`../../sim/olympic.js`); `LakeSource` (`../../sim/terrain.js`); the variant's `coastDistance`, `waterBodies`, `waterLevel`.
- Produces:
  - `Route`'s scene member becomes `{ kind: "scene"; name: "intro" | "title" }`.
  - `export type SceneName = "intro" | "title"`; `startSceneRoute(deps, search, name: SceneName = "intro")`.
  - `SceneRouteDeps.worldIn?: (maxMs: number) => Promise<void>` — resolves when the world is in around the camera, or at `maxMs`; default `whenSceneReady(renderer.scene, maxMs, renderer.forestReady)`. (Under Node's null engine the scene never reports ready — measured: still not ready at 30 s — so a test hands in its own.)
  - On the title, `dayhikeScene.ready` is `worldIn(READY_MAX_MS)`.

- [ ] **Step 1: Write the failing tests**

`router.test.ts`, after line 79:

```ts
    expect(parseRoute("/dayhike/scene/title", BASE)).toEqual({ kind: "scene", name: "title" });
```

`sceneRoute.test.ts`, a new case:

```ts
  it("builds the title scene: no film models, the hike's parked car, and ready once the world is in", async () => {
    const doc = installStandInDom();
    let carLoads = 0;
    let release: () => void = () => undefined;
    const worldIn = vi.fn((_maxMs: number) => new Promise<void>((resolve) => { release = resolve; }));
    const run = startSceneRoute(
      {
        canvas: nullCanvas(), container: asHtml(doc.createElement("div")), tier: "low", now: () => 0, raf: () => 0,
        paint: (s, name) => new PBRMaterial(name, s), worldIn,
        loadCar: async () => { carLoads += 1; return null; },
      },
      { t: 3, step: null },
      "title",
    );
    const api = (globalThis as { dayhikeScene?: { ready: Promise<void>; time(): number } }).dayhikeScene!;
    let readied = false;
    void api.ready.then(() => { readied = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(readied).toBe(false);
    release();
    await api.ready;
    expect(worldIn).toHaveBeenCalledWith(60000);
    expect([carLoads, api.time()]).toEqual([0, 3]);
    expect(run.scene().getMeshByName("trailhead_car_box")).not.toBeNull();
    expect(run.scene().getMeshByName("film_car_shadow")).toBeNull();
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/router.test.ts test/game/scene/sceneRoute.test.ts`
Expected: FAIL — `/scene/title` parses as something else; `startSceneRoute` takes no name, so the title case builds the intro (loads the car, no parked car).

- [ ] **Step 3: The router, the route and main**

`router.ts`: the member becomes `| { kind: "scene"; name: "intro" | "title" };` (its comment: "the
intro or the title loop's tour"), and after line 63:
`if (trimmed === "/scene/title") return { kind: "scene", name: "title" };`

`sceneRoute.ts`:
- The module comment: "The scene route: a staged scene (the intro, or the title loop's tour) on its fixed world, with no local player …".
- `export type SceneName = "intro" | "title";` `SceneRouteDeps` gains `worldIn?: (maxMs: number) => Promise<void>;` with the comment above.
- `startSceneRoute(deps, search, name: SceneName = "intro")`. The seed from `name === "title" ? TITLE_SEED_TOKEN : INTRO_SEED_TOKEN`; the weather and hour by name (`TITLE_WEATHER`, `TITLE_HOUR` for the title).
- `const worldIn = deps.worldIn ?? ((maxMs: number) => whenSceneReady(renderer.scene, maxMs, renderer.forestReady));`
- `groundH` moves above the scene's construction, and the scene is chosen by name: the intro's as now; the title's `titleScene(titleWorld())`, with

```ts
  const titleWorld = (): TitleWorld => {
    const lake = (variant.waterBodies?.(seed) ?? []).find((b): b is LakeSource => b.kind === "lake") ?? null;
    const meadow = graph.features.find((f) => f.kind === "meadow") ?? null;
    const peak = graph.features[0]!;
    const cove = coveFor(seed);
    return {
      ground: groundH,
      seaLevel: variant.waterLevel ?? 0,
      // Signed, positive inland, and one to one with x: the shoreline is where it is 0.
      coastlineX: (z) => -(variant.coastDistance?.(seed, 0, z) ?? 0),
      cove: { z0: cove.z0, halfWidth: cove.halfWidth },
      water: lake === null ? null : { x: lake.x, z: lake.z, radius: lake.radius, level: lake.level },
      meadow: meadow === null ? null : { x: meadow.x, z: meadow.z, radius: meadow.radius },
      peak: { x: peak.x, z: peak.z, radius: peak.radius },
      start: places.start,
    };
  };
```

- The trailhead for the title is the hike's, its parked car included: `createTrailheadMeshes(renderer.scene, name === "title" ? { car: { site: places.car, trailhead: graph.trailhead }, board: places.board } : { board: places.board }, …)`; the comment above it says so.
- The ranger's load and the film's car (its load, its cord, its patch) only for the intro: `const rangerLoaded = name === "intro" ? pool.load(renderer.scene, [INTRO_RANGER]) : Promise.resolve();` and `const carLoaded = name === "intro" ? (deps.loadCar ?? …)(renderer.scene).then(…) : Promise.resolve();`.
- `const ready = name === "intro" ? Promise.all([rangerLoaded, carLoaded]).then(() => undefined) : worldIn(READY_MAX_MS);` and `DayhikeScene.ready`'s comment: "Resolves once the intro's ranger and car have loaded or failed, or the title's world is in around its first camera: a recorder waits on it."

`main.ts:826`: `startSceneRoute({ … }, parseSceneSearch(location.search), route.name)`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --root client test/game/router.test.ts test/game/scene`
Expected: PASS, the intro's cases unchanged.

- [ ] **Step 5: Commit** — `feat: the title scene on the scene route`; `## How` in order: `router.ts`, `sceneRoute.ts`, `main.ts`, the tests.

---

### Task 4: The world settles after a cut before the frame that counts

**Files:**
- Create: `client/src/game/scene/cameraJump.ts`
- Modify: `client/src/game/scene/sceneRoute.ts` (the stage's `setFreecam`, `drawOneFrame`, `api.frame`)
- Test: `client/test/game/scene/cameraJump.test.ts`, `client/test/game/scene/sceneRoute.test.ts`

**Interfaces:**
- Consumes: `worldIn` (Task 3).
- Produces: `JUMP_M = 50`, `WARM_FRAMES = 48`, `SETTLE_MAX_MS = 10_000`; `cameraJumped(before: { x: number; y: number; z: number } | null, after: { x: number; y: number; z: number }, metres?: number): boolean`.

A frame is drawn on what the renderer has streamed in around the camera: the ground cover, the
forest's bands and the ground's rings fill in over frames after the camera moves far. On a cut,
`frame()` now draws `WARM_FRAMES` frames at the new camera (the scene's clock is held, so each is the
same moment), waits for the world (`worldIn`), and draws the frame that counts. Within a shot it
draws once, as now. 48 is a starting value: the asset side's pop check reads each shot's first frames
against that shot's own, so a fill-in after a cut shows in its draft, and Task 9 raises it if one does.

- [ ] **Step 1: Write the failing tests**

`cameraJump.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cameraJumped } from "../../../src/game/scene/cameraJump.js";

describe("a jump of the camera", () => {
  it("is a move of more than 50 m between two drawn frames; the first drawn frame has nothing to jump from", () => {
    expect(cameraJumped(null, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(cameraJumped({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 40 })).toBe(false);
    expect(cameraJumped({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 41 })).toBe(true);
  });
});
```

`sceneRoute.test.ts`: a helper at the top, and the new case.

```ts
/** Calls queued animation frames until `p` settles: a `frame()` that waits on the world asks for
 * its animation frame only after the wait. */
async function drain(frames: ((ms: number) => void)[], p: Promise<void>): Promise<void> {
  let done = false;
  void p.then(() => { done = true; });
  while (!done) {
    for (const fn of frames.splice(0)) fn(0);
    await new Promise((r) => setTimeout(r, 0));
  }
}

  it("draws the world in at a cut's new camera before the frame that counts, and draws once within a shot", async () => {
    const doc = installStandInDom();
    const frames: ((ms: number) => void)[] = [];
    let waits = 0;
    const run = startSceneRoute(
      {
        canvas: nullCanvas(), container: asHtml(doc.createElement("div")), tier: "low", now: () => 0,
        raf: (fn) => { frames.push(fn); return frames.length; }, paint: (s, name) => new PBRMaterial(name, s),
        worldIn: async () => { waits += 1; },
      },
      { t: 6.9, step: null },
      "title",
    );
    const api = (globalThis as { dayhikeScene?: { seek(t: number): void; frame(): Promise<void>; ready: Promise<void> } }).dayhikeScene!;
    await api.ready;
    for (const fn of frames.splice(0)) fn(0);
    let renders = 0;
    run.scene().onAfterRenderObservable.add(() => { renders += 1; });
    api.seek(6.95);
    await drain(frames, api.frame());
    expect([renders, waits]).toEqual([1, 1]);
    // 7.05 is the second shot, over the forest, hundreds of metres from the coast.
    api.seek(7.05);
    await drain(frames, api.frame());
    expect([renders, waits]).toEqual([51, 2]);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));
```

The intro's first case calls `frame()` across its own cut (t 20 to 43): give it
`worldIn: async () => undefined` in its deps and replace its manual flush
(`const drawn = api?.frame(); for (const fn of frames.splice(0)) fn(0); await drawn;`) with
`await drain(frames, api!.frame());`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/cameraJump.test.ts test/game/scene/sceneRoute.test.ts`
Expected: FAIL — no `cameraJump.js`; the cut draws once (`[2, 1]`, not `[51, 2]`).

- [ ] **Step 3: Write `cameraJump.ts` and the settle**

```ts
/**
 * A cut, as the scene route's `frame()` sees it: the camera moved further between two drawn frames
 * than any shot moves it in one. After one the world streams in around the new camera over frames;
 * the route draws it in before the frame that counts.
 */
export const JUMP_M = 50;
/** Frames drawn at a cut's new camera before the frame that counts. */
export const WARM_FRAMES = 48;
/** The longest the route waits for the world after a cut. */
export const SETTLE_MAX_MS = 10_000;

export function cameraJumped(
  before: { x: number; y: number; z: number } | null,
  after: { x: number; y: number; z: number },
  metres = JUMP_M,
): boolean {
  return before !== null && Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > metres;
}
```

In `sceneRoute.ts`:

```ts
  /** The camera the stage last set, and the one the last drawn frame was drawn from. */
  let lastView: FreecamView | null = null;
  let drawnView: FreecamView | null = null;
```

the stage's `setFreecam: (view) => { lastView = view; renderer.setFreecam(view); }`, `drawOneFrame`
ending in `drawnView = lastView;`, and `api.frame`:

```ts
    // Drawn now, and resolved on the animation frame after, when the picture has been presented
    // and a screenshot reads it. After a cut the world is drawn in first (`cameraJump.ts`).
    frame: async () => {
      looping = false;
      const before = drawnView;
      drawOneFrame();
      if (lastView !== null && cameraJumped(before, lastView)) {
        for (let i = 0; i < WARM_FRAMES; i += 1) drawOneFrame();
        await worldIn(SETTLE_MAX_MS);
        drawOneFrame();
      }
      await new Promise<void>((resolve) => raf(() => resolve()));
    },
```

(`FreecamView` is imported as a type from `../renderer.js`, as `sceneStage.ts` does.)

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run --root client test/game/scene`
Expected: PASS.

- [ ] **Step 5: Commit** — `fix: let a scene's world settle after a cut before the frame that counts`; `## How`: `cameraJump.ts`, `sceneRoute.ts`, the tests.

---

### Task 5: The title film's and still's urls

**Files:**
- Modify: `client/src/game/assetUrls.ts` (beside `videoUrl`)
- Test: `client/test/game/assetUrls.test.ts:119-124`

**Interfaces:**
- Produces: `titleVideoUrl(): string | null` (`video/title.mp4`), `titleStillUrl(): string | null` (`images/title.still.webp`). `stillUrl` stays until Task 7 removes its last caller.

- [ ] **Step 1: Write the failing test** (beside the `videoUrl` case, its import extended)

```ts
  it("gives the title film and its still as urls, or null before they ship", () => {
    for (const url of [titleVideoUrl(), titleStillUrl()]) expect(url === null || url.startsWith("/")).toBe(true);
    expect(titleVideoUrl() === null).toBe(titleStillUrl() === null);
  });
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run --root client test/game/assetUrls.test.ts`; Expected: FAIL, not exported.

- [ ] **Step 3: Write them**

```ts
/** The title page's loop, or null until it ships. */
export function titleVideoUrl(): string | null {
  return Object.hasOwn(VIDEO_URLS, "video/title.mp4") ? (VIDEO_URLS["video/title.mp4"] as string) : null;
}

/** The title page's still, the loop's first frame, or null until it ships. */
export function titleStillUrl(): string | null {
  return Object.hasOwn(IMAGE_URLS, "images/title.still.webp") ? (IMAGE_URLS["images/title.still.webp"] as string) : null;
}
```

- [ ] **Step 4: Run it to see it pass.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat: the title film's and its still's urls`.

---

### Task 6: The title loop's model

**Files:**
- Create: `client/src/game/titleLoopModel.ts`
- Test: `client/test/game/titleLoopModel.test.ts`

**Interfaces:**
- Produces:

```ts
export type TitleLoopEnv = { saveData: boolean; effectiveType: string | null; reducedMotion: boolean; hasFilm: boolean };
export type TitleLoopPhase = "still" | "waiting" | "loading" | "showing" | "stopped";
export type TitleLoopState = { phase: TitleLoopPhase; hidden: boolean };
export type TitleLoopEvent = "load" | "canplaythrough" | "error" | "refused" | "play" | "hidden" | "visible";
export type TitleLoopView = { src: boolean; playing: boolean; still: boolean };
export function titleLoopStart(env: TitleLoopEnv): TitleLoopState;
export function titleLoopNext(state: TitleLoopState, event: TitleLoopEvent): TitleLoopState;
export function titleLoopView(state: TitleLoopState): TitleLoopView;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { titleLoopNext, titleLoopStart, titleLoopView, type TitleLoopEnv, type TitleLoopEvent } from "../../src/game/titleLoopModel.js";

const fast: TitleLoopEnv = { saveData: false, effectiveType: "4g", reducedMotion: false, hasFilm: true };
const run = (env: TitleLoopEnv, events: TitleLoopEvent[]) => titleLoopView(events.reduce(titleLoopNext, titleLoopStart(env)));
const STILL = { src: false, playing: false, still: true };

describe("the title loop's model", () => {
  it("keeps the still when data is saved, the connection is slow, motion is to be reduced, or no film ships", () => {
    for (const env of [
      { ...fast, saveData: true }, { ...fast, effectiveType: "3g" }, { ...fast, effectiveType: "2g" },
      { ...fast, effectiveType: "slow-2g" }, { ...fast, reducedMotion: true }, { ...fast, hasFilm: false },
    ]) expect(run(env, ["load", "canplaythrough"])).toEqual(STILL);
  });

  it("counts a browser that does not say its connection as fast", () => {
    expect(run({ ...fast, effectiveType: null }, ["load", "canplaythrough"])).toEqual({ src: true, playing: true, still: false });
  });

  it("downloads after the page's load and shows the loop once it can play through", () => {
    expect(run(fast, [])).toEqual(STILL);
    expect(run(fast, ["canplaythrough"])).toEqual(STILL);
    expect(run(fast, ["load"])).toEqual({ src: true, playing: false, still: true });
    expect(run(fast, ["load", "canplaythrough"])).toEqual({ src: true, playing: true, still: false });
  });

  it("goes back to the still for good on an error or a refused play", () => {
    for (const e of ["error", "refused"] as const) expect(run(fast, ["load", "canplaythrough", e, "load", "canplaythrough"])).toEqual(STILL);
  });

  it("stops for good on Play, whatever it was doing", () => {
    for (const before of [[], ["load"], ["load", "canplaythrough"]] as TitleLoopEvent[][]) {
      expect(run(fast, [...before, "play", "load", "canplaythrough"])).toEqual(STILL);
    }
  });

  it("pauses while hidden and plays again when shown, from whenever it was hidden", () => {
    expect(run(fast, ["load", "canplaythrough", "hidden"])).toEqual({ src: true, playing: false, still: false });
    expect(run(fast, ["hidden", "load", "canplaythrough"])).toEqual({ src: true, playing: false, still: false });
    expect(run(fast, ["hidden", "load", "canplaythrough", "visible"])).toEqual({ src: true, playing: true, still: false });
  });
});
```

- [ ] **Step 2: Run them to see them fail** — `npx vitest run --root client test/game/titleLoopModel.test.ts`; Expected: FAIL, no module.

- [ ] **Step 3: Write the model**

```ts
/**
 * The title page's loop, decided (`docs/gameplay/2026-10-01-title-loop.md` §4): the still alone, or
 * the still until the loop can play through, then the loop. Pure; `titleLoop.ts` draws it.
 */
export type TitleLoopEnv = { saveData: boolean; effectiveType: string | null; reducedMotion: boolean; hasFilm: boolean };
export type TitleLoopPhase = "still" | "waiting" | "loading" | "showing" | "stopped";
export type TitleLoopState = { phase: TitleLoopPhase; hidden: boolean };
export type TitleLoopEvent = "load" | "canplaythrough" | "error" | "refused" | "play" | "hidden" | "visible";
export type TitleLoopView = { src: boolean; playing: boolean; still: boolean };

/** The connections too slow for the loop; a browser that does not say counts as fast. */
const SLOW = new Set(["slow-2g", "2g", "3g"]);

export function titleLoopStart(env: TitleLoopEnv): TitleLoopState {
  const still = !env.hasFilm || env.saveData || env.reducedMotion || (env.effectiveType !== null && SLOW.has(env.effectiveType));
  return { phase: still ? "still" : "waiting", hidden: false };
}

export function titleLoopNext(state: TitleLoopState, event: TitleLoopEvent): TitleLoopState {
  if (event === "hidden" || event === "visible") return { ...state, hidden: event === "hidden" };
  if (state.phase === "still" || state.phase === "stopped") return state;
  if (event === "play") return { ...state, phase: "stopped" };
  if (event === "error" || event === "refused") return { ...state, phase: "still" };
  if (event === "load" && state.phase === "waiting") return { ...state, phase: "loading" };
  if (event === "canplaythrough" && state.phase === "loading") return { ...state, phase: "showing" };
  return state;
}

export function titleLoopView(state: TitleLoopState): TitleLoopView {
  const showing = state.phase === "showing";
  return { src: state.phase === "loading" || showing, playing: showing && !state.hidden, still: !showing };
}
```

- [ ] **Step 4: Run them to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat: the title loop's model: the still, or the loop once it can play`.

---

### Task 7: The title loop on the title page

**Files:**
- Create: `client/src/game/titleLoop.ts`
- Modify: `client/test/game/helpers/standInDom.ts`, `client/src/game/landing.ts` (STYLE, lines 3-16), `client/src/main.ts` (imports at 24-26, the landing branch at 834-877, `onPlay` at 620), `client/src/game/assetUrls.ts` (`stillUrl` goes), `client/test/game/assetUrls.test.ts` (its `stillUrl` line goes)
- Delete: `client/src/game/landingBackdrop.ts`, `client/test/game/landingStill.test.ts`
- Test: `client/test/game/titleLoop.test.ts`

**Interfaces:**
- Consumes: the model (Task 6); `titleVideoUrl`, `titleStillUrl` (Task 5).
- Produces: `type TitleLoop = { stop(): void; dispose(): void }`; `createTitleLoop(container: HTMLElement, still: string | null, video: string | null, env: Omit<TitleLoopEnv, "hasFilm">): TitleLoop`; `titleLoopEnv(): Omit<TitleLoopEnv, "hasFilm">`.
- The stand-in DOM gains: `StandInDocument.readyState: "loading" | "complete"` (default `"complete"`) and `visibilityState: "visible" | "hidden"` (default `"visible"`), `finishLoading()` (sets `"complete"`, fires `load` on the window), `setVisibility(state)` (sets it, fires `visibilitychange` on the document); `createElement("video")` gives a `StandInVideo`: `muted`, `paused` (true), `refusePlay` (false), `loads` (0), `play(): Promise<void>` (rejects when `refusePlay`, else un-pauses), `pause()`, `load()` (counts, pauses).

- [ ] **Step 1: The stand-in's additions**

In `standInDom.ts`:

```ts
const eventOf = (type: string, target: StandInElement): StandInEvent => ({ type, target, defaultPrevented: false, preventDefault() {} });

/** A `<video>`: it plays when asked unless told to refuse, as a browser that blocks autoplay does. */
export class StandInVideo extends StandInElement {
  muted = false;
  paused = true;
  refusePlay = false;
  loads = 0;
  play(): Promise<void> {
    if (this.refusePlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {
    this.loads += 1;
    this.paused = true;
  }
}
```

and in `StandInDocument`: `readyState: "loading" | "complete" = "complete";`,
`visibilityState: "visible" | "hidden" = "visible";`, `createElement`'s
`if (tag === "video") return new StandInVideo(this, tag);`, and

```ts
  /** The page finishing its load, as the browser fires it. */
  finishLoading(): void {
    this.readyState = "complete";
    this.window.fire(eventOf("load", this.body));
  }
  /** The tab hidden or shown. */
  setVisibility(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    this.listeners.fire(eventOf("visibilitychange", this.body));
  }
```

Run the whole client suite once, its output to a file, and read the tail: a document that now says
`visible` and `complete`, as a browser's does, must change no other test.
Run: `npx vitest run --root client > /tmp/title-loop-client.log 2>&1; tail -20 /tmp/title-loop-client.log`
Expected: PASS.

- [ ] **Step 2: Write the failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleLoop } from "../../src/game/titleLoop.js";
import { asHtml, installStandInDom, type StandInVideo } from "./helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());
const fast = { saveData: false, effectiveType: "4g", reducedMotion: false };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the title loop on the page", () => {
  it("lays the still over a silent, inline, looping video with nothing to download until the page has loaded", () => {
    const doc = installStandInDom();
    doc.readyState = "loading";
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    const still = container.children[1]!;
    expect([video.tagName, still.tagName]).toEqual(["VIDEO", "IMG"]);
    for (const a of ["muted", "playsinline", "loop", "disablepictureinpicture", "disableremoteplayback"]) expect(video.hasAttribute(a)).toBe(true);
    expect([video.muted, video.getAttribute("preload"), video.getAttribute("aria-hidden"), video.getAttribute("src")]).toEqual([true, "none", "true", null]);
    expect([still.className, still.getAttribute("src"), still.getAttribute("alt")]).toEqual(["landing-bg ready", "/s.webp", ""]);
    doc.finishLoading();
    expect([video.getAttribute("src"), video.getAttribute("preload")]).toEqual(["/v.mp4", "auto"]);
    loop.dispose();
  });

  it("starts at once when the page has already loaded, plays and fades the still when it can play through", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    expect(video.getAttribute("src")).toBe("/v.mp4");
    video.dispatch("canplaythrough");
    expect([video.paused, container.children[1]?.className]).toEqual([false, "landing-bg ready gone"]);
    loop.dispose();
  });

  it("goes back to the still for good, and drops the download, when the browser refuses to play", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    video.refusePlay = true;
    video.dispatch("canplaythrough");
    await tick();
    expect([video.getAttribute("src"), video.loads, container.children[1]?.className]).toEqual([null, 1, "landing-bg ready"]);
    loop.dispose();
  });

  it("drops the download on stop, and leaves nothing behind on dispose", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    loop.stop();
    expect([video.getAttribute("src"), video.loads]).toEqual([null, 1]);
    loop.dispose();
    expect(container.children.length).toBe(0);
  });

  it("pauses while hidden and plays when shown, and a page opened in a background tab does not play until shown", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const loop = createTitleLoop(asHtml(container), "/s.webp", "/v.mp4", fast);
    const video = container.children[0] as StandInVideo;
    video.dispatch("canplaythrough");
    doc.setVisibility("hidden");
    expect(video.paused).toBe(true);
    doc.setVisibility("visible");
    expect(video.paused).toBe(false);
    loop.dispose();

    const back = installStandInDom();
    back.visibilityState = "hidden";
    const c2 = back.createElement("div");
    const l2 = createTitleLoop(asHtml(c2), "/s.webp", "/v.mp4", fast);
    const v2 = c2.children[0] as StandInVideo;
    v2.dispatch("canplaythrough");
    expect(v2.paused).toBe(true);
    back.setVisibility("visible");
    expect(v2.paused).toBe(false);
    l2.dispose();
  });

  it("draws only what has shipped, and keeps the still where the visitor's settings say so", () => {
    const doc = installStandInDom();
    const none = doc.createElement("div");
    createTitleLoop(asHtml(none), null, null, fast).dispose();
    expect(none.children.length).toBe(0);
    const stillOnly = doc.createElement("div");
    const l1 = createTitleLoop(asHtml(stillOnly), "/s.webp", null, fast);
    expect(stillOnly.children.map((c) => c.tagName)).toEqual(["IMG"]);
    l1.dispose();
    const reduced = doc.createElement("div");
    const l2 = createTitleLoop(asHtml(reduced), "/s.webp", "/v.mp4", { ...fast, reducedMotion: true });
    expect(reduced.children[0]?.getAttribute("src")).toBeNull();
    l2.dispose();
  });
});
```

- [ ] **Step 3: Run them to see them fail** — `npx vitest run --root client test/game/titleLoop.test.ts`; Expected: FAIL, no module.

- [ ] **Step 4: Write `titleLoop.ts`**

```ts
/**
 * The title page's backdrop: the loop behind its still, drawn as `titleLoopModel.ts` says. The video
 * is muted, inline and looping, with no source until the page has loaded; the still fades when the
 * loop can play through and comes back for good on an error or a refused play. Each is drawn only
 * once it ships.
 */
import { titleLoopNext, titleLoopStart, titleLoopView, type TitleLoopEnv, type TitleLoopEvent } from "./titleLoopModel.js";

export type TitleLoop = { stop(): void; dispose(): void };

export function createTitleLoop(container: HTMLElement, still: string | null, video: string | null, env: Omit<TitleLoopEnv, "hasFilm">): TitleLoop {
  const el = video === null ? null : document.createElement("video");
  if (el !== null) {
    for (const a of ["muted", "playsinline", "loop", "disablepictureinpicture", "disableremoteplayback"]) el.setAttribute(a, "");
    el.muted = true;
    el.setAttribute("preload", "none");
    el.setAttribute("aria-hidden", "true");
    el.className = "landing-loop";
    container.append(el);
  }
  const img = still === null ? null : document.createElement("img");
  if (img !== null && still !== null) {
    img.className = "landing-bg ready";
    img.setAttribute("src", still);
    img.setAttribute("alt", "");
    img.setAttribute("decoding", "async");
    container.append(img);
  }

  let state = titleLoopStart({ ...env, hasFilm: el !== null });
  const apply = (): void => {
    const view = titleLoopView(state);
    if (el !== null && video !== null) {
      if (view.src && el.getAttribute("src") === null) {
        el.setAttribute("src", video);
        el.setAttribute("preload", "auto");
      } else if (!view.src && el.getAttribute("src") !== null) {
        el.removeAttribute("src");
        el.load(); // drops the download in flight
      }
      if (view.playing) el.play().catch(() => send("refused"));
      else if (!el.paused) el.pause();
    }
    if (img !== null) img.className = view.still ? "landing-bg ready" : "landing-bg ready gone";
  };
  const send = (event: TitleLoopEvent): void => {
    state = titleLoopNext(state, event);
    apply();
  };
  const onLoad = (): void => send("load");
  const onCan = (): void => send("canplaythrough");
  const onError = (): void => send("error");
  const onVisibility = (): void => send(document.visibilityState === "hidden" ? "hidden" : "visible");
  el?.addEventListener("canplaythrough", onCan);
  el?.addEventListener("error", onError);
  document.addEventListener("visibilitychange", onVisibility);
  // A page opened in a background tab starts hidden, and no event says so.
  if (document.visibilityState === "hidden") send("hidden");
  if (document.readyState === "complete") send("load");
  else window.addEventListener("load", onLoad);
  apply();

  return {
    stop: () => send("play"),
    dispose: () => {
      send("play");
      el?.removeEventListener("canplaythrough", onCan);
      el?.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("load", onLoad);
      el?.remove();
      img?.remove();
    },
  };
}

/** What the browser says of the connection and the visitor's settings. */
export function titleLoopEnv(): Omit<TitleLoopEnv, "hasFilm"> {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}
```

- [ ] **Step 5: The CSS, the page, and the old backdrop's removal**

`landing.ts` STYLE: `.landing-bg`'s `filter: blur(2px)` and `transform: scale(1.03)` (its comment:
"a 2 px blur: the world reads, the title and buttons stay in front; scaling hides the blur's bright
rim"); after `.landing-bg.ready`:

```css
  .landing-bg.ready.gone { opacity: 0; transition: opacity 500ms ease-out; }
  .landing-loop {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; filter: blur(2px); transform: scale(1.03);
  }
```

`main.ts`: import `createTitleLoop`, `titleLoopEnv`, `type TitleLoop` from `./game/titleLoop.js`
and `titleStillUrl`, `titleVideoUrl` (dropping `stillUrl` and `landingBackdrop`); a module-level
`let titleLoop: TitleLoop | null = null;`; in the landing branch, in place of the backdrop's two lines:

```ts
    // The still goes in first so the UI paints above it; the loop behind it fetches nothing until
    // the page has loaded, and nothing of the game is built or fetched before Play.
    titleLoop = createTitleLoop(container, titleStillUrl(), titleVideoUrl(), titleLoopEnv());
```

and `running = { dispose: () => { titleLoop?.dispose(); titleLoop = null; handle.dispose(); } };`.
`onPlay`, after the `launching` guard: `titleLoop?.stop(); // the game's load gets the bandwidth`.
Delete `landingBackdrop.ts` and `landingStill.test.ts`; remove `stillUrl` from `assetUrls.ts` (and
from its module comment, which names it with `videoUrl`) and its line from `assetUrls.test.ts`.

- [ ] **Step 6: Run them to see them pass**

Run: `npx vitest run --root client test/game/titleLoop.test.ts test/game/assetUrls.test.ts && npm run typecheck && npm run lint`
Expected: PASS, no errors.

- [ ] **Step 7: Commit** — `feat: the title page's loop behind its still`; `## How` in order: `titleLoop.ts`, `main.ts`, `landing.ts`, `assetUrls.ts`, the removed backdrop, the stand-in, the tests.

---

### Task 8: The deploy check reads the films from every chunk

**Files:**
- Modify: `tools/deploy/lib/modelUrls.mjs` (after `findAssetUrl`, line 94), `tools/deploy/verify.mjs:215-280`
- Test: `tools/deploy/test/assetUrl.test.mjs`

**Interfaces:**
- Produces: `filmUrls(source: string): { introFilm: string | null; titleFilm: string | null; titleStill: string | null }`.

- [ ] **Step 1: Write the failing test** (its import extended to `filmUrls`)

```js
describe('filmUrls', () => {
  it('reads the films and the title still from the entry and the chunks it names, read together', () => {
    const built = 'import("./engineChoice-A1.js")\nx="/dayhike/assets/title-Ab12Cd34.mp4";y="/dayhike/assets/title.still-Zz99Yy88.webp";z="/dayhike/assets/intro-Qq11Ww22.mp4"';
    expect(filmUrls(built)).toEqual({
      introFilm: '/dayhike/assets/intro-Qq11Ww22.mp4',
      titleFilm: '/dayhike/assets/title-Ab12Cd34.mp4',
      titleStill: '/dayhike/assets/title.still-Zz99Yy88.webp',
    });
    expect(filmUrls('import("./engineChoice-A1.js")')).toEqual({ introFilm: null, titleFilm: null, titleStill: null });
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run --root tools deploy/test/assetUrl.test.mjs`; Expected: FAIL, not exported.

- [ ] **Step 3: Write `filmUrls` and use it**

```js
/** The films and the title still a built site references: read from the entry and every chunk it
 * names together, since the asset-url map is in a chunk (`engineChoice-*.js`), not the entry. */
export function filmUrls(source) {
  return {
    introFilm: findAssetUrl(source, 'intro', 'mp4'),
    titleFilm: findAssetUrl(source, 'title', 'mp4'),
    titleStill: findAssetUrl(source, 'title.still', 'webp'),
  };
}
```

`verify.mjs` 4b': read `filmUrls(builtSource)` (it read `bundleSource`, the entry alone, and
reported the live intro film as missing). One helper, `checkFilm(url, label)`, in place of the
inline block, checks each film as the intro's was checked (the first twelve bytes, `ftyp`,
immutable; absent, a note); it runs for the intro film and the title film. The title still is
checked as the intro's still was (WebP, immutable, under `STILL_MAX_BYTES`). The first-load check
pushes `titleStill` in place of `stillUrl`, and adds
`check(!/\.mp4\b/.test(html), "the title page's html names no film", "a film is named in the html");`.

- [ ] **Step 4: Run it to see it pass** — `npx vitest run --root tools deploy`; Expected: PASS.
- [ ] **Step 5: Commit** — `fix: the deploy check reads the films from every chunk, and the title's`.

---

### Task 9: The look, the record, and the page's gates

The asset repository's plan records, assembles and delivers the film from a build of this branch;
this task is the game's half of that, in order.

- [ ] **Step 1: The look.** `DAYHIKE_SKIP_WGSL_MAP=1 npm run dev -- --port 5189` (a port no other
worktree holds), headed Chrome on `/dayhike/scene/title?tier=high&step=<frame>`; for each shot, the
frames at its local 1, 3.5 and 6 s (`step` = 24 × seconds). Set `TITLE_HOUR` and Task 2's camera
constants by those frames: the coast's open sea and sky where the page's title and buttons sit, each
subject toward the middle (a phone held upright sees the middle of the 2:1 frame). Re-run Task 2's
tests after each change (`npx vitest run --root client test/game/scene/title.test.ts`, Expected:
PASS, the hour's literal changed with the hour); commit — `feat: the title scene framed`.
- [ ] **Step 2: The build the film is recorded from.** The asset plan's record runs from this
branch's commit, built by `npm run build` and served by `vite preview`.
- [ ] **Step 3: The draft, watched** (the asset plan's draft): the five shots and the four joins played
back; its pop check's report, which reads each shot's first frames against that shot's own. A fill-in after a cut: raise
`WARM_FRAMES` (Task 4) and re-draft.
- [ ] **Step 4: The delivered film on the page.** After the asset export lands in this worktree (its
own commit): `npm run build && npx vite preview --root client --port 5190`, then in Chrome, Safari
and Firefox on the title page: the frame timing across the loop's wrap
(`requestVideoFrameCallback`; no gap over 2/24 s across it, 20 wraps each); the first load (the
still and nothing of the video before `load`, in the network panel); a slow connection (the network
panel's 3G preset), save-data (an init script defining `navigator.connection` with
`saveData: true`) and reduced motion (the rendering panel's emulation) each keeping the still; Play
cancelling the video's request; then a look at the page on a desktop and on a phone held upright.
If the wrap holds a frame in any of the three, stop: the
two-element handover the spec names (§4, "The seam") becomes a task of its own in this plan, written
from the measurement.
- [ ] **Step 5: The note.** `docs/gameplay/2026-10-01-title-loop-staging.md`: the machine, the
engine, each shot's constants and why, each gate's result.
- [ ] **Step 6: The whole suite and commit.** `npm run typecheck && npm run lint && npm test`
(Expected: PASS); commit the note — `docs: the title loop as staged and measured`.
