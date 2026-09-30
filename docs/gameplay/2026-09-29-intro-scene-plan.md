# The intro scene, part 1: playback, loading and the title page — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play starts a video at once and the game downloads and builds behind it, with one thin bar and one line for what is still loading, a title page that loads a still frame instead of a rendered world, hold-to-skip once the world is ready, and a click to step out into first person.

**Architecture:** Two pure models with dumb renderers, the house pattern: `loadProgress.ts` turns counts and bytes from a handful of hooks into one bar value and one line; `introPlayback.ts` turns the video's time, the world's readiness and the player's gestures into one of six states. An overlay (`introOverlay.ts`) draws both over the game's canvas. Every model the game loads passes through one loader that reports; the start's phases and the world's first build yield between steps so the overlay keeps painting; a start-time gate reuses the readiness test the tier switch already has. The landing page stops building a renderer.

**Tech Stack:** TypeScript, Babylon.js 9.18, Vite, vitest (`--root client`), the `<video>` element, Firebase Hosting.

**Spec:** `docs/gameplay/2026-09-29-intro-scene.md` §1, §4, §5, §7, §8 (the scene player and the staged intro, §2, §3 and §6, are part 2, a plan of their own).

## Global Constraints

- Every numeric test expectation is a literal; explicit time limits go through `timeLimit(<ms>)` (`client/test/helpers/timeLimit.ts`); a test that reads a clock without asserting on it is listed in the architecture test.
- `sim/` is not touched: no sim value changes and the level id does not move (spec §9).
- `game/` never writes sim state; the sim and the wire never see the intro (spec §5.5).
- Stage explicit paths only; never `git add -A`; one concern per commit; the repository's pre-push scan passes before any push.
- Docs under `docs/` are named `YYYY-MM-DD-<topic>.md`.
- The video and the still reach the game through the asset catalog and are LFS-tracked; when either is absent the game starts as it does today (spec §5.5).
- The title page's first load is under 1.5 MB (spec §5.1); the intro's overlay never shows a percentage for a stage with no total (spec §5.3).

## Review Focus

Inputs the spec implies and a person will meet. Each has its test in the task that owns the code.

1. **The video never loads** (a blocked CDN, a browser that plays no MP4). The game starts as today, with no overlay left behind (Task 6, "starts the game when the video errors").
2. **The world is ready before the video ends, and after it.** Both orders cut on a gesture and never on their own; the pause menu never appears by itself (Task 2, "cuts only on a gesture", "holds the last frame until ready").
3. **A stage with no total** (shader compiles on WebGL2). The bar's segment fills on the gate, the line counts up, never a fake percentage (Task 1, "reports a count and no percentage where there is no total").
4. **A join that fails mid-video.** The connect panel shows and the video stops; no game builds behind a failure (Task 6, "stops the video when the start fails").
5. **A tab hidden mid-video.** The video pauses and resumes at the same time; the load goes on; the states do not advance (Task 2, "holds its state while hidden").

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/game/loadProgress.ts` (new) | The progress model: stages, counts, bytes in; `{ bar, line, ready }` out. Pure. |
| `client/src/game/introPlayback.ts` (new) | The playback model: six states, driven by the video's time, readiness, the hold and the gesture. Pure. |
| `client/src/game/introOverlay.ts` (new) | The overlay's DOM: the `<video>`, the caption line, the bar and its line, the skip ring, the step-out prompt. A dumb renderer of the two models. |
| `client/src/game/modelLoad.ts` | Gains `loadModelContainer(url, scene, signal)`: the one loader every model passes through, reporting starts, bytes and settles. |
| `client/src/game/forestMeshes.ts`, `clutterMeshes.ts`, `cliffMeshes.ts`, `creatureModel.ts`, `characterModel.ts`, `wildlifeMeshes.ts`, `staticModel.ts` | Call `loadModelContainer` instead of `loadAssetContainerAsync`. |
| `client/src/game/groundMaps.ts`, `terrainTexture.ts`, `wildlifeAudio.ts` | Report each map fetch and each call. |
| `client/src/game/gpuEngine.ts`, `wgslMap.ts`, `asyncPipelines.ts` | Report the translators' and the map's bytes, and pipelines landed of asked. |
| `client/src/game/renderer.ts` | The clipmap's first build stepped with yields and reported ring by ring; `forestMeshes.impostorBakes()` exposed as `bakes()`. |
| `client/src/app.ts` | `GameHandle` gains `ready`, `cover()` and `engage()`; the start-time gate; the WebGL2 compile count. |
| `client/src/game/frameProbe.ts` | `startHike` yields to a paint between phases and takes a `before` hook for the download gate. |
| `client/src/main.ts` | Play starts the video in the click; the landing shows the still; the overlay is wired to the start. |
| `client/src/game/assetUrls.ts` | `videoUrl()` and `stillUrl()` from globs over `assets/video/*.mp4` and `assets/images/*.webp`; `assetBytes(output)` from the catalog. |
| `client/src/game/landingScene.ts`, `landingPath.ts` | Deleted with their tests. |
| `tools/deploy/verify.mjs` | The video's `ftyp`, the still's WebP, both immutable; the title page's first load under 1.5 MB. |
| `ARCHITECTURE.md` | The intro's playback and the light title page. |

---

### Task 1: The progress model

**Files:**
- Create: `client/src/game/loadProgress.ts`
- Test: `client/test/game/loadProgress.test.ts`

**Interfaces:**
- Produces: `createLoadProgress(): LoadProgress` with `start(stage: Stage, id: string, bytes?: number)`, `bytes(stage, id, loaded, total?)`, `done(stage, id)`, `total(stage, n: number)`, `gate()`, `view(): ProgressView`; `type Stage = "models" | "ground" | "shaders" | "pipelines" | "world"`; `type ProgressView = { bar: number; line: string; ready: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/loadProgress.test.ts
import { describe, expect, it } from "vitest";
import { createLoadProgress } from "../../src/game/loadProgress.js";

describe("the loading bar's model", () => {
  it("starts empty and reads nothing", () => {
    const p = createLoadProgress();
    expect(p.view()).toEqual({ bar: 0, line: "", ready: false });
  });

  it("counts models of a total, and weighs the bar by bytes when it knows them", () => {
    const p = createLoadProgress();
    p.total("models", 4);
    p.start("models", "a", 1000);
    p.start("models", "b", 3000);
    p.bytes("models", "a", 1000, 1000);
    p.done("models", "a");
    expect(p.view().line).toBe("downloading models 1 of 4, 0.0 of 0.0 MB");
    p.bytes("models", "b", 1500, 3000);
    // 2500 of 4000 bytes known: the models stage is 0.625 through; it is 0.6 of the bar.
    expect(p.view().bar).toBeCloseTo(0.375, 6);
  });

  it("reports a count and no percentage where there is no total", () => {
    const p = createLoadProgress();
    p.start("shaders", "x");
    p.done("shaders", "x");
    p.start("shaders", "y");
    p.done("shaders", "y");
    expect(p.view().line).toBe("compiling shaders 2");
    expect(p.view().line).not.toContain("%");
    // A stage with no total contributes nothing to the bar until the gate.
    expect(p.view().bar).toBe(0);
  });

  it("names one stage at a time, the first that is not finished", () => {
    const p = createLoadProgress();
    p.total("models", 1);
    p.total("ground", 2);
    p.start("models", "a");
    p.start("ground", "g1");
    p.done("ground", "g1");
    expect(p.view().line).toBe("downloading models 0 of 1");
    p.done("models", "a");
    expect(p.view().line).toBe("ground and sound 1 of 2");
  });

  it("never moves the bar backward", () => {
    const p = createLoadProgress();
    p.total("models", 2);
    p.start("models", "a", 100);
    p.bytes("models", "a", 100, 100);
    const before = p.view().bar;
    p.start("models", "b", 100_000);
    expect(p.view().bar).toBeGreaterThanOrEqual(before);
  });

  it("is ready only when the gate says so, and then reads ready with a full bar", () => {
    const p = createLoadProgress();
    p.total("models", 1);
    p.start("models", "a");
    p.done("models", "a");
    expect(p.view().ready).toBe(false);
    p.gate();
    expect(p.view()).toEqual({ bar: 1, line: "ready", ready: true });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root client test/game/loadProgress.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/game/loadProgress.js"`.

- [ ] **Step 3: Write the model**

```ts
// client/src/game/loadProgress.ts
/**
 * The loading bar's model: what the game has fetched and built so far, as
 * one bar value and one line. Pure: the overlay draws it, the hooks feed it.
 *
 * Stages are weighed by bytes where bytes are known (the downloads, the
 * only part that scales with the connection) and by count where they are
 * not. A stage with no total (shader compiles on WebGL2) counts up in its
 * line and adds nothing to the bar until the gate says the world is ready,
 * so the bar never shows a percentage it made up. The bar never moves
 * backward: a stage whose total grows keeps the value it had until the
 * new work catches up.
 */
export type Stage = "models" | "ground" | "shaders" | "pipelines" | "world";

export type ProgressView = { bar: number; line: string; ready: boolean };

export type LoadProgress = {
  /** The stage will have `n` items; may be told again as more are found. */
  total(stage: Stage, n: number): void;
  /** An item began; `bytes` is its size when the catalog knows it. */
  start(stage: Stage, id: string, bytes?: number): void;
  /** Bytes landed for an item, and its size where the response says it. */
  bytes(stage: Stage, id: string, loaded: number, total?: number): void;
  /** An item is done. */
  done(stage: Stage, id: string): void;
  /** The world is ready: every stage reads finished and the bar is full. */
  gate(): void;
  view(): ProgressView;
};

/** The bar's share of each stage. They sum to 1. */
const WEIGHT: Record<Stage, number> = { models: 0.6, ground: 0.1, shaders: 0.1, pipelines: 0.1, world: 0.1 };
const ORDER: Stage[] = ["models", "ground", "shaders", "pipelines", "world"];

type Item = { loaded: number; total: number | null; done: boolean };
type StageState = { total: number | null; items: Map<string, Item> };

export function createLoadProgress(): LoadProgress {
  const stages = new Map<Stage, StageState>(ORDER.map((s) => [s, { total: null, items: new Map() }]));
  let gated = false;
  let highest = 0;
  const of = (stage: Stage): StageState => stages.get(stage) as StageState;

  /** A stage's fraction done, or null where nothing bounds it. */
  const fraction = (stage: Stage): number | null => {
    const s = of(stage);
    if (s.total === null) return null;
    if (s.total === 0) return 1;
    let known = 0, loaded = 0, sized = 0;
    for (const it of s.items.values()) {
      if (it.total !== null) { known += it.total; loaded += Math.min(it.loaded, it.total); sized++; }
    }
    // Bytes weigh the stage only when every started item has a size; else by count.
    if (sized > 0 && sized === s.items.size && s.items.size === s.total) return known === 0 ? 1 : loaded / known;
    let doneCount = 0;
    for (const it of s.items.values()) if (it.done) doneCount++;
    return Math.min(1, doneCount / s.total);
  };

  const line = (): string => {
    for (const stage of ORDER) {
      const s = of(stage);
      const doneCount = [...s.items.values()].filter((it) => it.done).length;
      if (s.total !== null && doneCount >= s.total) continue;
      if (s.total === null && s.items.size === 0) continue;
      switch (stage) {
        case "models": {
          let loaded = 0, known = 0;
          for (const it of s.items.values()) if (it.total !== null) { known += it.total; loaded += Math.min(it.loaded, it.total); }
          const mb = known > 0 ? `, ${(loaded / 1048576).toFixed(1)} of ${(known / 1048576).toFixed(1)} MB` : "";
          return `downloading models ${doneCount} of ${s.total ?? "?"}${mb}`;
        }
        case "ground": return `ground and sound ${doneCount} of ${s.total ?? "?"}`;
        case "shaders": return s.total === null ? `compiling shaders ${doneCount}` : `shaders ${doneCount} of ${s.total}`;
        case "pipelines": return `pipelines ${doneCount} of ${s.total ?? s.items.size}`;
        case "world": return `building the world ${doneCount} of ${s.total ?? "?"}`;
      }
    }
    return "";
  };

  const view = (): ProgressView => {
    if (gated) return { bar: 1, line: "ready", ready: true };
    let bar = 0;
    for (const stage of ORDER) {
      const f = fraction(stage);
      if (f !== null) bar += WEIGHT[stage] * f;
    }
    highest = Math.max(highest, bar);
    return { bar: highest, line: line(), ready: false };
  };

  return {
    total(stage, n) { of(stage).total = Math.max(n, of(stage).total ?? 0); },
    start(stage, id, bytes) {
      const s = of(stage);
      if (!s.items.has(id)) s.items.set(id, { loaded: 0, total: bytes ?? null, done: false });
    },
    bytes(stage, id, loaded, total) {
      const s = of(stage);
      const it = s.items.get(id) ?? { loaded: 0, total: null, done: false };
      it.loaded = Math.max(it.loaded, loaded);
      if (total !== undefined) it.total = total;
      s.items.set(id, it);
    },
    done(stage, id) {
      const s = of(stage);
      const it = s.items.get(id) ?? { loaded: 0, total: null, done: false };
      it.done = true;
      if (it.total !== null) it.loaded = it.total;
      s.items.set(id, it);
    },
    gate() { gated = true; },
    view,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/loadProgress.test.ts`
Expected: 6 passed. If "weighs the bar by bytes" reads 0.6 · 0.625 = 0.375 exactly, the byte weighing is right; if it reads by count, an item lacks a size.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/loadProgress.ts client/test/game/loadProgress.test.ts
git commit -m "feat: add the loading bar's model"
```

---

### Task 2: The playback model

**Files:**
- Create: `client/src/game/introPlayback.ts`
- Test: `client/test/game/introPlayback.test.ts`

**Interfaces:**
- Produces: `createIntroPlayback(input: { holdMs?: number }): IntroPlayback` with `tick(now: number, videoTime: number, ended: boolean)`, `ready()`, `holdStart(now)`, `holdEnd(now)`, `gesture()`, `hidden(on: boolean, now: number)`, `state(): IntroState`, `view(): PlaybackView`; `type IntroState = "playing" | "readyToSkip" | "holding" | "holdingLast" | "cut"`; `type PlaybackView = { state: IntroState; holdFraction: number; showSkip: boolean; showStepOut: boolean; titleCard: boolean }`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/introPlayback.test.ts
import { describe, expect, it } from "vitest";
import { createIntroPlayback, HOLD_MS, TITLE_CARD_MS } from "../../src/game/introPlayback.js";

describe("the intro's playback model", () => {
  it("plays, shows skip only once the world is ready, and a ring that fills over the hold", () => {
    const p = createIntroPlayback({});
    p.tick(0, 0, false);
    expect(p.view()).toMatchObject({ state: "playing", showSkip: false, holdFraction: 0 });
    p.holdStart(100);
    p.tick(500, 0.5, false);
    // Not ready: a hold does nothing.
    expect(p.view().holdFraction).toBe(0);
    p.ready();
    p.tick(600, 0.6, false);
    expect(p.view().showSkip).toBe(true);
    p.holdStart(1000);
    p.tick(1400, 1.4, false);
    expect(p.view().holdFraction).toBeCloseTo(400 / HOLD_MS, 6);
    expect(p.state()).toBe("holding");
  });

  it("cuts only on a gesture: a hold released early never skips, a full hold does", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.holdStart(0);
    p.tick(HOLD_MS - 1, 1, false);
    p.holdEnd(HOLD_MS - 1);
    expect(p.state()).toBe("readyToSkip");
    p.holdStart(2000);
    p.tick(2000 + HOLD_MS, 2, false);
    p.holdEnd(2000 + HOLD_MS);
    expect(p.state()).toBe("cut");
  });

  it("holds the last frame until ready, then waits for the step-out click", () => {
    const p = createIntroPlayback({});
    p.tick(60_000, 60, true);
    expect(p.view()).toMatchObject({ state: "holdingLast", titleCard: true, showStepOut: false });
    p.tick(60_000 + TITLE_CARD_MS, 60, true);
    expect(p.view().titleCard).toBe(false);
    expect(p.view().showStepOut).toBe(false);
    p.ready();
    p.tick(61_000 + TITLE_CARD_MS, 60, true);
    expect(p.view().showStepOut).toBe(true);
    expect(p.state()).toBe("holdingLast");
    p.gesture();
    expect(p.state()).toBe("cut");
  });

  it("shows the title card once, even when ready came first", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.tick(60_000, 60, true);
    expect(p.view().titleCard).toBe(true);
    p.tick(60_000 + TITLE_CARD_MS + 1, 60, true);
    expect(p.view()).toMatchObject({ titleCard: false, showStepOut: true });
  });

  it("holds its state while hidden", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.holdStart(0);
    p.hidden(true, 100);
    p.tick(5000, 5, false);
    expect(p.view().holdFraction).toBe(0);
    expect(p.state()).toBe("readyToSkip");
    p.hidden(false, 5000);
    p.tick(5001, 5.001, false);
    expect(p.state()).toBe("readyToSkip");
  });

  it("never leaves cut", () => {
    const p = createIntroPlayback({});
    p.ready();
    p.tick(1, 1, true);
    p.tick(1 + TITLE_CARD_MS, 1, true);
    p.gesture();
    p.tick(99_999, 99, true);
    p.holdStart(99_999);
    expect(p.state()).toBe("cut");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run --root client test/game/introPlayback.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the model**

```ts
// client/src/game/introPlayback.ts
/**
 * The intro's playback as a pure model: the video's time, the world's
 * readiness, the player's hold and their click go in; one of five states
 * and what to show come out. Nothing here touches the DOM or the sim.
 *
 * The cut is always on a gesture: a completed hold while the film plays,
 * or the step-out click on the held last frame. Neither the world's
 * readiness nor the film's end cuts on its own, so the game never lands in
 * the pause menu with no click to have taken the pointer.
 */
export type IntroState = "playing" | "readyToSkip" | "holding" | "holdingLast" | "cut";

export type PlaybackView = {
  state: IntroState;
  /** 0 to 1 while a hold runs; 0 otherwise. */
  holdFraction: number;
  showSkip: boolean;
  showStepOut: boolean;
  /** The game's name over black, once, after the film ends. */
  titleCard: boolean;
};

/** How long a key, button or touch is held to skip (ms). */
export const HOLD_MS = 800;
/** How long the title card shows after the film's last frame (ms). */
export const TITLE_CARD_MS = 3000;

export type IntroPlayback = {
  tick(now: number, videoTime: number, ended: boolean): void;
  ready(): void;
  holdStart(now: number): void;
  holdEnd(now: number): void;
  /** The step-out click on the held last frame. */
  gesture(): void;
  hidden(on: boolean, now: number): void;
  state(): IntroState;
  view(): PlaybackView;
};

export function createIntroPlayback(input: { holdMs?: number }): IntroPlayback {
  const holdMs = input.holdMs ?? HOLD_MS;
  let state: IntroState = "playing";
  let isReady = false;
  let holdSince: number | null = null;
  let holdFraction = 0;
  let endedAt: number | null = null;
  let cardShown = false;
  let isHidden = false;

  const settle = (): void => {
    if (state === "cut") return;
    if (endedAt !== null) { state = "holdingLast"; return; }
    if (holdSince !== null && isReady) { state = "holding"; return; }
    state = isReady ? "readyToSkip" : "playing";
  };

  return {
    tick(now, _videoTime, ended) {
      if (state === "cut") return;
      if (ended && endedAt === null) { endedAt = now; holdSince = null; holdFraction = 0; }
      if (endedAt !== null && !cardShown && now - endedAt >= TITLE_CARD_MS) cardShown = true;
      if (isHidden) return;
      if (holdSince !== null && isReady && endedAt === null) {
        holdFraction = Math.min(1, (now - holdSince) / holdMs);
        if (holdFraction >= 1) { state = "cut"; return; }
      }
      settle();
    },
    ready() { isReady = true; settle(); },
    holdStart(now) {
      if (state === "cut" || endedAt !== null || isHidden) return;
      holdSince = now;
      holdFraction = 0;
      settle();
    },
    holdEnd() {
      if (state === "cut") return;
      holdSince = null;
      holdFraction = 0;
      settle();
    },
    gesture() {
      if (state === "holdingLast" && isReady && cardShown) state = "cut";
    },
    hidden(on) {
      isHidden = on;
      if (on) { holdSince = null; holdFraction = 0; }
      settle();
    },
    state: () => state,
    view() {
      return {
        state,
        holdFraction: state === "holding" ? holdFraction : 0,
        showSkip: state === "readyToSkip" || state === "holding",
        showStepOut: state === "holdingLast" && isReady && cardShown,
        titleCard: endedAt !== null && !cardShown,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/introPlayback.test.ts`
Expected: 6 passed. If "shows the title card once" fails on `showStepOut`, `cardShown` is not set on the tick past `TITLE_CARD_MS`.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/introPlayback.ts client/test/game/introPlayback.test.ts
git commit -m "feat: add the intro's playback model"
```

---

### Task 3: One loader for every model, reporting

**Files:**
- Modify: `client/src/game/modelLoad.ts`
- Modify: `client/src/game/forestMeshes.ts:983`, `client/src/game/clutterMeshes.ts:1004`, `client/src/game/cliffMeshes.ts:177`, `client/src/game/creatureModel.ts:224`, `client/src/game/characterModel.ts:201`, `client/src/game/wildlifeMeshes.ts:734`, `client/src/game/staticModel.ts:19-31`
- Modify: `client/src/game/assetUrls.ts` (adds `assetBytes`)
- Test: `client/test/game/modelLoad.test.ts`, `client/test/game/assetUrls.test.ts`

**Interfaces:**
- Consumes: `LoadProgress` from Task 1.
- Produces: `loadModelContainer(url: string, scene: Scene, signal: AbortSignal): Promise<AssetContainer>`; `setLoadProgress(p: LoadProgress | null)` in `modelLoad.ts` (the one place the hooks report to; null when no intro is up); `assetBytes(output: string): number | undefined` in `assetUrls.ts`, from `catalog.json`'s `bytes` where the export wrote it.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/modelLoad.test.ts`:

```ts
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { loadModelContainer, setLoadProgress } from "../../src/game/modelLoad.js";

describe("the one loader every model passes through", () => {
  it("reports a start, the bytes as they land, and the settle to the progress model", async () => {
    const p = createLoadProgress();
    p.total("models", 1);
    setLoadProgress(p);
    const calls: Array<{ url: string; onProgress: ((e: { loaded: number; total: number }) => void) | undefined }> = [];
    const fake = async (url: string, _scene: unknown, options?: { onProgress?: (e: { loaded: number; total: number }) => void }) => {
      calls.push({ url, onProgress: options?.onProgress });
      options?.onProgress?.({ loaded: 512, total: 2048 });
      return { dispose() {} } as never;
    };
    const container = await loadModelContainer("/assets/tree-abc.glb", {} as never, new AbortController().signal, fake);
    expect(container).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(p.view().line).toBe("downloading models 1 of 1, 0.0 of 0.0 MB");
    setLoadProgress(null);
  });

  it("reports nothing when no progress model is set", async () => {
    setLoadProgress(null);
    const fake = async () => ({ dispose() {} }) as never;
    await expect(loadModelContainer("/assets/x.glb", {} as never, new AbortController().signal, fake)).resolves.toBeDefined();
  });
});
```

Append to `client/test/game/assetUrls.test.ts`:

```ts
import { assetBytes } from "../../src/game/assetUrls.js";

describe("assetBytes", () => {
  it("reads the catalog's bytes where the export wrote them, and nothing where it did not", () => {
    // The catalog's first model: the export writes `bytes` from this work on.
    const known = assetBytes("models/ranger.nathan.glb");
    expect(known === undefined || known > 100_000).toBe(true);
    expect(assetBytes("models/no-such-model.glb")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/modelLoad.test.ts test/game/assetUrls.test.ts`
Expected: FAIL: `loadModelContainer` and `assetBytes` are not exported.

- [ ] **Step 3: Write the loader and the catalog read**

In `client/src/game/modelLoad.ts`, add:

```ts
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { LoadProgress } from "./loadProgress.js";
import { assetBytes } from "./assetUrls.js";

let progress: LoadProgress | null = null;
/** The progress model the loads report to while an intro is up; null otherwise. */
export function setLoadProgress(p: LoadProgress | null): void {
  progress = p;
}

type Loader = (url: string, scene: Scene, options?: { onProgress?: (e: { loaded: number; total: number }) => void }) => Promise<AssetContainer>;

/**
 * The one loader every model passes through: forest, clutter, cliffs,
 * birds, creatures, characters, signs, the trailhead and the body. It
 * reports the start, the bytes as they land and the settle to the progress
 * model when one is set, keyed by the url, which is hashed and unique. The
 * catalog's `bytes`, where the export wrote them, give the size before the
 * first byte lands, so the bar is weighed by size from the start.
 */
export function loadModelContainer(url: string, scene: Scene, signal: AbortSignal, load: Loader = loadAssetContainerAsync): Promise<AssetContainer> {
  const output = "models/" + url.split("/").pop()!.replace(/-[A-Za-z0-9_-]{8}(\.glb)$/, "$1");
  progress?.start("models", url, assetBytes(output));
  return loadUntilAborted(
    () => load(url, scene, { onProgress: (e) => progress?.bytes("models", url, e.loaded, e.total > 0 ? e.total : undefined) }),
    signal,
  ).finally(() => progress?.done("models", url));
}
```

In `client/src/game/assetUrls.ts`, add:

```ts
import catalog from "../../assets/catalog.json";

/** Bytes of a shipped asset by its catalog `output`, where the export wrote them. */
export function assetBytes(output: string): number | undefined {
  const entry = (catalog as { assets: Array<{ output: string; bytes?: number }> }).assets.find((a) => a.output === output);
  return entry?.bytes;
}
```

(`resolveJsonModule` is on in `tsconfig.base.json`; if the import is refused, read the catalog the way `wildlifeAudio.ts` reads it.)

Then replace each `loadAssetContainerAsync(url, scene)` call at the seven sites with `loadModelContainer(url, scene, loads.signal)` (or the site's own signal), and make `defaultModelLoader` in `staticModel.ts` take a signal and call it. `loadUntilAborted` stays for the sites that pass a closure of their own.

- [ ] **Step 4: Run the tests, then the files that load models**

Run: `npx vitest run --root client test/game/modelLoad.test.ts test/game/assetUrls.test.ts test/game/forestMeshes.test.ts test/game/clutterMeshes.test.ts test/game/cliffMeshes.test.ts test/game/characterModel.test.ts test/game/wildlifeMeshes.test.ts test/game/staticModel.test.ts`
Expected: all pass. A file whose fake loader was `loadAssetContainerAsync` by name needs its fake moved to `loadModelContainer`'s `load` parameter or the module mock; the count of loads a test pins (45 per hike, section 2 of the survey in the spec's research) does not change.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/modelLoad.ts client/src/game/assetUrls.ts client/src/game/forestMeshes.ts client/src/game/clutterMeshes.ts client/src/game/cliffMeshes.ts client/src/game/creatureModel.ts client/src/game/characterModel.ts client/src/game/wildlifeMeshes.ts client/src/game/staticModel.ts client/test/game/modelLoad.test.ts client/test/game/assetUrls.test.ts
git commit -m "feat: load every model through one loader that reports"
```

---

### Task 4: The other hooks: ground and sound, shaders, pipelines, the world

**Files:**
- Modify: `client/src/game/groundMaps.ts:94-167`, `client/src/game/terrainTexture.ts:667-672`, `client/src/game/wildlifeAudio.ts:148-155`
- Modify: `client/src/game/wgslMap.ts:81-103`, `client/src/game/gpuEngine.ts:243-254`, `client/src/game/asyncPipelines.ts:110-133`
- Modify: `client/src/game/renderer.ts:484-493` (the clipmap's first build), `client/src/game/forestMeshes.ts:233` (`impostorBakes` exposed on the renderer as `bakes()`)
- Modify: `client/src/app.ts:325-340` (the compile observable feeds the model)
- Test: `client/test/game/loadProgressHooks.test.ts` (new), `client/test/game/clipmap.test.ts`

**Interfaces:**
- Consumes: `setLoadProgress`/the module's `progress` from Task 3; expose a `reportProgress(): LoadProgress | null` getter in `modelLoad.ts` for the other modules.
- Produces: `renderer.buildFirstClipmap(yieldEvery: number, onRing?: (level: number) => void): Promise<void>`; `renderer.buildClipmapNow(): void`; `renderer.bakes(): { ready: number; total: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/loadProgressHooks.test.ts
import { describe, expect, it } from "vitest";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { setLoadProgress, reportProgress } from "../../src/game/modelLoad.js";
import { reportLayer } from "../../src/game/groundMaps.js";
import { reportCall } from "../../src/game/wildlifeAudio.js";
import { reportPipelines } from "../../src/game/asyncPipelines.js";

describe("the loading hooks", () => {
  it("count the ground maps and the calls as one stage of 24", () => {
    const p = createLoadProgress();
    setLoadProgress(p);
    reportLayer("start", "ground.grass.normal");
    reportLayer("done", "ground.grass.normal");
    reportCall("start", "call.elk_bark");
    reportCall("done", "call.elk_bark");
    expect(reportProgress()).toBe(p);
    expect(p.view().line).toBe("ground and sound 2 of 24");
    setLoadProgress(null);
  });

  it("report pipelines landed of asked", () => {
    const p = createLoadProgress();
    setLoadProgress(p);
    reportPipelines({ asked: 60, landed: 40 });
    expect(p.view().line).toBe("pipelines 40 of 60");
    setLoadProgress(null);
  });
});
```

And in `client/test/game/clipmap.test.ts`, a case on the renderer's first build being stepped: build a renderer on `NullEngine` as the file's other tests do, then:

```ts
  it("builds the first clipmap ring by ring, yielding between slices", async () => {
    const rings: number[] = [];
    await renderer.buildFirstClipmap(1, (level) => rings.push(level));
    expect(rings).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/loadProgressHooks.test.ts test/game/clipmap.test.ts`
Expected: FAIL on the missing exports.

- [ ] **Step 3: Write the hooks**

`modelLoad.ts`: `export function reportProgress(): LoadProgress | null { return progress; }`.

`groundMaps.ts`: at the top of `decodeLayer` call `reportLayer("start", id)` and in its `finally` `reportLayer("done", id)`; `terrainTexture.ts`: the six albedo `Texture`s report through their `onLoadObservable` the same way; export:

```ts
export function reportLayer(what: "start" | "done", id: string): void {
  const p = reportProgress();
  if (p === null) return;
  p.total("ground", 24);
  if (what === "start") p.start("ground", id); else p.done("ground", id);
}
```

`wildlifeAudio.ts`: the same shape as `reportCall`, around each clip's fetch (six of the 24).

`wgslMap.ts` (the streaming reader already counts `bytes` against `content-length`): `p.start("shaders", "wgsl-map", length)` and `p.bytes("shaders", "wgsl-map", bytes, length)` as it reads, `done` at the end; `gpuEngine.ts`'s `startTranslators`: one item per fetched file, `Content-Length` as its size. On WebGPU `p.total("shaders", 5)` (two wasm, two loaders, the map).

`asyncPipelines.ts`: where `dayhikePipelines` is updated, call:

```ts
export function reportPipelines(n: { asked: number; landed: number }): void {
  const p = reportProgress();
  if (p === null) return;
  p.total("pipelines", n.asked);
  for (let i = 0; i < n.landed; i++) { p.start("pipelines", `p${i}`); p.done("pipelines", `p${i}`); }
}
```

`app.ts`: beside the governor's subscription to `engine.onAfterShaderCompilationObservable`, on WebGL2 report each compile as `p.start("shaders", `c${n}`); p.done(...)` with no total.

`renderer.ts`: the first build at line 493 is `finish(build(0, 0))`, and `build` (line 437) is a slice generator that samples each ring (`ringSampleSlices`, line 458) and then makes each stale ring's geometry (`geometrySlices`, line 465), with no marker between rings. Give `build` an optional `onRing?: (level: number) => void` called after line 458 for each ring sampled, and add to the renderer:

```ts
    /** The first clipmap build, stepped: a macrotask between every `yieldEvery` slices so the page paints, and each ring reported as it is sampled. */
    async buildFirstClipmap(yieldEvery: number, onRing?: (level: number) => void): Promise<void> {
      const gen = build(0, 0, onRing);
      let sinceYield = 0;
      for (;;) {
        const next = gen.next();
        if (next.done) break;
        if (++sinceYield >= yieldEvery) { sinceYield = 0; await new Promise<void>((r) => setTimeout(r, 0)); }
      }
    },
    /** The first build run whole, for a start with no intro up, the tier switch and the scene route. */
    buildClipmapNow(): void { finish(build(0, 0)); },
```

and take the `finish(build(0, 0))` out of construction: `buildGame` calls one or the other before the render loop starts. The test's "ring by ring" case reads the levels `onRing` names: `[0, 1, 2, 3, 4, 5, 6]`. Each ring reports `p.start("world", `ring${level}`); p.done(...)` against `p.total("world", RING_COUNT + 1)`; the billboards report through `bakes()` (`forestMeshes.impostorBakes()` exposed on the renderer), polled by the gate: `p.start("world", "bakes")` at the first poll and `done` when `bakes().ready === bakes().total`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/loadProgressHooks.test.ts test/game/clipmap.test.ts test/game/groundMaps.test.ts test/game/wildlifeAudio.test.ts test/game/asyncPipelines.test.ts test/game/wgslMap.test.ts`
Expected: all pass; the clipmap's rings read `[0, 1, 2, 3, 4, 5, 6]`.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/groundMaps.ts client/src/game/terrainTexture.ts client/src/game/wildlifeAudio.ts client/src/game/wgslMap.ts client/src/game/gpuEngine.ts client/src/game/asyncPipelines.ts client/src/game/renderer.ts client/src/game/modelLoad.ts client/src/app.ts client/test/game/loadProgressHooks.test.ts client/test/game/clipmap.test.ts
git commit -m "feat: report the ground, the shaders, the pipelines and the world to the loading bar"
```

---

### Task 5: The start yields, and a ready gate at start

**Files:**
- Modify: `client/src/game/frameProbe.ts:662-722` (`startHike`)
- Modify: `client/src/app.ts:102-115` (`GameHandle`), `client/src/app.ts:1385-1393` (after `runRenderLoop`)
- Test: `client/test/game/frameProbe.test.ts`, `client/test/game/startReady.test.ts` (new)

**Interfaces:**
- Consumes: `whenSceneReady(scene, maxMs, layers)` from `rendererSwap.ts:373`; `revealWhenWhole` from `revealHold.ts`; `renderer.buildFirstClipmap` from Task 4.
- Produces: `HikeStartDeps.before?: () => Promise<void>` (awaited after the tier is decided and before the engine is made: the download gate); `startHike` yields to a paint (`afterNextPaint`) between `decide`, `engine` and `build`; `GameHandle.ready: Promise<void>` (the start-time gate: `whenSceneReady(scene, READY_MAX_MS, forestReady)`, then on WebGPU the whole-frame reveal, then `progress.gate()`); `GameHandle.cover(): () => void` (wraps `gate.cover()`); `GameHandle.engage(): void` (`input.engage()`). `READY_MAX_MS = 60_000`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/frameProbe.test.ts`:

```ts
  it("awaits `before` after the tier and before the engine, and yields a paint between phases", async () => {
    const order: string[] = [];
    await startHike<string>({
      signals: Promise.resolve(fakeSignals()),
      current: () => true,
      showLoading: () => ({ dispose() { order.push("hide"); } }),
      decide: async () => { order.push("decide"); return decidedHigh(); },
      before: async () => { order.push("before"); },
      engine: async () => { order.push("engine"); return "e"; },
      discard: () => {},
      build: () => { order.push("build"); },
      fail: () => { order.push("fail"); },
    });
    expect(order).toEqual(["decide", "before", "engine", "hide", "build"]);
  });
```

`client/test/game/startReady.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { startReady } from "../../src/game/startReady.js";
import { createLoadProgress } from "../../src/game/loadProgress.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the start-time gate", () => {
  it("resolves when the scene is ready and the forest's layers are in, then gates the bar", async () => {
    const p = createLoadProgress();
    let readyCalls = 0;
    const scene = { isDisposed: false, isReady: () => ++readyCalls > 2, getWaitingItemsCount: () => 0 };
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal: null, progress: p, maxMs: 5000 });
    expect(p.view().ready).toBe(true);
    expect(readyCalls).toBeGreaterThan(2);
  }, timeLimit(10_000));

  it("waits for the whole-frame reveal on WebGPU before it gates", async () => {
    const p = createLoadProgress();
    let lifted = false;
    const scene = { isDisposed: false, isReady: () => true, getWaitingItemsCount: () => 0 };
    const reveal = new Promise<void>((r) => setTimeout(() => { lifted = true; r(); }, 50));
    await startReady({ scene: scene as never, forestReady: Promise.resolve(), reveal, progress: p, maxMs: 5000 });
    expect(lifted).toBe(true);
    expect(p.view().ready).toBe(true);
  }, timeLimit(10_000));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/frameProbe.test.ts test/game/startReady.test.ts`
Expected: FAIL: `before` is not awaited (order lacks it) and `startReady` does not exist.

- [ ] **Step 3: Write the gate and the yields**

`client/src/game/startReady.ts`:

```ts
import type { Scene } from "@babylonjs/core/scene.js";
import { whenSceneReady } from "./rendererSwap.js";
import type { LoadProgress } from "./loadProgress.js";

/** The longest the start waits for the world before it calls it ready anyway (ms). */
export const READY_MAX_MS = 60_000;

/**
 * The start-time gate: the scene ready, nothing in flight, the forest's
 * billboards baked (`forestReady`), and on WebGPU a whole frame drawn with
 * no draw left out (`reveal`), then the bar reads ready. The same test the
 * tier switch uses mid-hike (`rendererSwap.ts`), run once at the start.
 */
export async function startReady(input: { scene: Scene; forestReady: Promise<unknown>; reveal: Promise<void> | null; progress: LoadProgress | null; maxMs: number }): Promise<void> {
  await whenSceneReady(input.scene, input.maxMs, input.forestReady);
  if (input.reveal !== null) await input.reveal;
  input.progress?.gate();
}
```

`frameProbe.ts`: add `before?: () => Promise<void>` to `HikeStartDeps`; in `startHike`, after `decide` resolves and `current()` holds, `if (deps.before) await deps.before();`, and before `engine` and before `build` await `paint()`, a dep `paint: () => Promise<void>` that `main.ts` supplies as `afterNextPaint` wrapped in a promise (the tests pass `() => Promise.resolve()`).

`app.ts`: in `buildGame`, after `renderer.engine.runRenderLoop(loop)`:

```ts
  const ready = startReady({
    scene: renderer.scene,
    forestReady: renderer.forestReady,
    reveal: gpu ? new Promise<void>((r) => revealWhenWhole(/* the same deps as holdReveal above */, r)) : null,
    progress: reportProgress(),
    maxMs: READY_MAX_MS,
  });
```

and on the handle: `ready`, `cover: () => gate.cover()`, `engage: () => { if (!disposed) input.engage(); }`. The clipmap: with no intro up `buildGame` calls `renderer.buildClipmapNow()`; with one up it awaits `renderer.buildFirstClipmap(8, onRing)` before the render loop starts, inside `startHike`'s `build` made async for it (the launch's `build` returns a promise the chain awaits).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/frameProbe.test.ts test/game/startReady.test.ts test/game/rendererSwap.test.ts`
Expected: all pass, the order `["decide", "before", "engine", "hide", "build"]`.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/frameProbe.ts client/src/game/startReady.ts client/src/app.ts client/test/game/frameProbe.test.ts client/test/game/startReady.test.ts
git commit -m "feat: gate the start on the world being ready, and yield between its phases"
```

---

### Task 6: The overlay, and Play that starts the video

**Files:**
- Create: `client/src/game/introOverlay.ts`
- Modify: `client/src/game/assetUrls.ts` (`videoUrl`, `stillUrl`)
- Modify: `client/src/main.ts:535-547` (`onPlay`), `:792-845` (the start's wiring)
- Test: `client/test/game/introOverlay.test.ts` (jsdom, as `pauseMenu.test.ts` does), `client/test/game/assetUrls.test.ts`

**Interfaces:**
- Consumes: `createIntroPlayback`, `createLoadProgress`, `setLoadProgress`, `GameHandle.ready/cover/engage`, `HikeStartDeps.before`.
- Produces: `createIntroOverlay(container, input: { src: string; captions: Caption[]; onCut(): void }): IntroOverlay` with `video: HTMLVideoElement`, `progress: LoadProgress`, `play(): Promise<void>`, `bufferedAhead(): number`, `ready()`, `stop()`, `dispose()`; `type Caption = { from: number; to: number; text: string; radio: boolean }`; `videoUrl(): string | null`, `stillUrl(): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/introOverlay.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createIntroOverlay } from "../../src/game/introOverlay.js";

const captions = [{ from: 1, to: 3, text: "Four-one, dispatch.", radio: true }];

describe("the intro overlay", () => {
  it("draws the video, the caption at the video's time, and the bar's line", () => {
    const container = document.createElement("div");
    const o = createIntroOverlay(container, { src: "/x.mp4", captions, onCut: () => {} });
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/x.mp4");
    o.progress.total("models", 45);
    o.progress.start("models", "a");
    Object.defineProperty(o.video, "currentTime", { value: 2, configurable: true });
    o.render(0);
    expect(container.querySelector(".intro-caption")?.textContent).toBe("Four-one, dispatch.");
    expect(container.querySelector(".intro-caption")?.classList.contains("radio")).toBe(true);
    expect(container.querySelector(".intro-line")?.textContent).toBe("downloading models 0 of 45");
    expect((container.querySelector(".intro-bar-fill") as HTMLElement).style.width).toBe("0%");
    o.dispose();
  });

  it("shows hold to skip once ready, cuts on a full hold, and the step-out click cuts on the held last frame", () => {
    const container = document.createElement("div");
    const onCut = vi.fn();
    const o = createIntroOverlay(container, { src: "/x.mp4", captions, onCut });
    o.render(0);
    expect(container.querySelector(".intro-skip")?.classList.contains("shown")).toBe(false);
    o.ready();
    o.render(10);
    expect(container.querySelector(".intro-skip")?.classList.contains("shown")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    o.render(1000);
    expect(onCut).toHaveBeenCalledTimes(1);
    o.dispose();
  });

  it("starts the game when the video errors, and stops the video when the start fails", () => {
    const container = document.createElement("div");
    const onCut = vi.fn();
    const o = createIntroOverlay(container, { src: "/x.mp4", captions, onCut });
    o.video.dispatchEvent(new Event("error"));
    expect(onCut).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")).toBeNull();
    o.dispose();
  });
});
```

And in `assetUrls.test.ts`:

```ts
  it("gives the video's and the still's urls when they ship, and null when they do not", () => {
    for (const v of [videoUrl(), stillUrl()]) expect(v === null || v.startsWith("/")).toBe(true);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/introOverlay.test.ts test/game/assetUrls.test.ts`
Expected: FAIL on the missing modules and exports.

- [ ] **Step 3: Write the overlay**

```ts
// client/src/game/introOverlay.ts
import { createIntroPlayback, type IntroPlayback } from "./introPlayback.js";
import { createLoadProgress, type LoadProgress } from "./loadProgress.js";

export type Caption = { from: number; to: number; text: string; radio: boolean };

export type IntroOverlay = {
  video: HTMLVideoElement;
  progress: LoadProgress;
  playback: IntroPlayback;
  /** Starts the video; call inside the Play click's own task so it plays with sound. */
  play(): Promise<void>;
  /** Seconds of video buffered past the current time. */
  bufferedAhead(): number;
  ready(): void;
  /** Draws the models' state; `now` in ms. Called on each animation frame. */
  render(now: number): void;
  /** The start failed: the video stops and the overlay goes, leaving the container to the panel. */
  stop(): void;
  dispose(): void;
};

const STYLE = `
  .intro { position: absolute; inset: 0; background: #000; display: grid; grid-template-rows: 1fr auto 1fr; z-index: 30; }
  .intro video { grid-row: 2; width: 100%; aspect-ratio: 2 / 1; display: block; }
  .intro-caption { grid-row: 3; align-self: start; margin: 14px auto 0; max-width: 42ch; text-align: center; color: #eee; font: 500 clamp(16px, 2.4vh, 26px)/1.35 system-ui, sans-serif; }
  .intro-caption.radio { font-style: italic; }
  .intro-caption.radio::before { content: "Dispatch (radio): "; font-style: normal; opacity: 0.7; }
  .intro-bar { grid-row: 3; align-self: end; margin: 0 16px 10px; height: 2px; background: rgba(255,255,255,0.15); }
  .intro-bar-fill { height: 100%; width: 0%; background: rgba(255,255,255,0.7); transition: width 300ms linear; }
  .intro-line { position: absolute; right: 16px; bottom: 16px; color: rgba(255,255,255,0.55); font: 12px/1.4 system-ui, sans-serif; }
  .intro-skip, .intro-stepout { position: absolute; left: 16px; bottom: 16px; color: rgba(255,255,255,0.7); font: 12px/1.4 system-ui, sans-serif; opacity: 0; transition: opacity 400ms; }
  .intro-skip.shown, .intro-stepout.shown { opacity: 1; }
  .intro-ring { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.35); margin-right: 8px; vertical-align: -2px; background: conic-gradient(rgba(255,255,255,0.9) calc(var(--hold) * 360deg), transparent 0); }
  .intro-title { position: absolute; inset: 0; display: grid; place-items: center; color: #ddd; font: 300 clamp(28px, 6vw, 64px)/1 system-ui, sans-serif; letter-spacing: 0.3em; background: #000; opacity: 0; transition: opacity 600ms; pointer-events: none; }
  .intro-title.shown { opacity: 1; }
`;

export function createIntroOverlay(container: HTMLElement, input: { src: string; captions: Caption[]; onCut(): void }): IntroOverlay {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "intro";
  const video = document.createElement("video");
  video.setAttribute("src", input.src);
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  const caption = document.createElement("div"); caption.className = "intro-caption";
  const bar = document.createElement("div"); bar.className = "intro-bar";
  const fill = document.createElement("div"); fill.className = "intro-bar-fill"; bar.appendChild(fill);
  const line = document.createElement("div"); line.className = "intro-line";
  const skip = document.createElement("div"); skip.className = "intro-skip"; skip.innerHTML = `<span class="intro-ring"></span>hold to skip`;
  const stepOut = document.createElement("div"); stepOut.className = "intro-stepout"; stepOut.textContent = "click to step out";
  const title = document.createElement("div"); title.className = "intro-title"; title.textContent = "DAY HIKE";
  root.append(video, caption, bar, line, skip, stepOut, title);
  container.append(style, root);

  const progress = createLoadProgress();
  const playback = createIntroPlayback({});
  let cut = false;
  const doCut = (): void => {
    if (cut) return;
    cut = true;
    input.onCut();
  };
  const holdStart = (): void => playback.holdStart(performance.now());
  const holdEnd = (): void => playback.holdEnd(performance.now());
  const onKeyDown = (e: KeyboardEvent): void => { if (!e.repeat) holdStart(); };
  const onPointerDown = (): void => { if (playback.view().showStepOut) playback.gesture(); else holdStart(); };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", holdEnd);
  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", holdEnd);
  const onVisibility = (): void => {
    const hidden = document.visibilityState === "hidden";
    playback.hidden(hidden, performance.now());
    if (hidden) video.pause(); else if (!video.ended) void video.play().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisibility);
  video.addEventListener("error", () => { stop(); doCut(); });

  function stop(): void {
    video.pause();
    video.removeAttribute("src");
    video.load();
    root.remove();
    style.remove();
  }

  return {
    video, progress, playback,
    play: () => video.play(),
    bufferedAhead() {
      const t = video.currentTime;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= t && t <= video.buffered.end(i)) return video.buffered.end(i) - t;
      }
      return 0;
    },
    ready: () => playback.ready(),
    render(now) {
      playback.tick(now, video.currentTime, video.ended);
      const pv = playback.view();
      const t = video.currentTime;
      const c = input.captions.find((x) => x.from <= t && t < x.to);
      caption.textContent = c?.text ?? "";
      caption.classList.toggle("radio", c?.radio ?? false);
      const g = progress.view();
      fill.style.width = `${Math.round(g.bar * 100)}%`;
      line.textContent = g.line;
      skip.classList.toggle("shown", pv.showSkip);
      (skip.firstElementChild as HTMLElement).style.setProperty("--hold", String(pv.holdFraction));
      stepOut.classList.toggle("shown", pv.showStepOut);
      title.classList.toggle("shown", pv.titleCard);
      if (pv.state === "cut") doCut();
    },
    stop,
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", holdEnd);
      window.removeEventListener("pointerup", holdEnd);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    },
  };
}
```

`assetUrls.ts`: two more eager `?url` globs, `../../assets/video/*.mp4` and `../../assets/images/*.webp`, with `videoUrl(): string | null` returning the entry for `intro.mp4` and `stillUrl()` for `intro.still.webp`, null when the glob is empty.

`main.ts`: in `onPlay`, before `afterNextPaint`, when `videoUrl()` is not null (or `?intro=<url>` names a file for development, and `?intro=off` skips it): create the overlay in `container`, `setLoadProgress(overlay.progress)`, `void overlay.play()`. Keep the overlay across `navigateToGame`'s `container.replaceChildren()` by re-appending its root first thing in the game route's branch (the overlay's `root` is kept on the handle). In the game route's `startHike` call: `before: () => waitForBuffer(overlay, 6, 3000)` (resolves when `bufferedAhead() >= 6` or 3 s have passed), and after `launch` returns its handle: `handle.cover()` (lifted on the cut), `void handle.ready.then(() => overlay.ready())`, a `requestAnimationFrame` loop calling `overlay.render(now)` until the cut; `onCut`: lift the cover, `handle.engage()`, `overlay.dispose()`, `setLoadProgress(null)`. In `fail`, `overlay.stop()`. The captions come from `introCaptions` in `client/src/game/scene/intro.ts` when part 2 lands; until then `main.ts` passes the ten lines from a `captions` constant in `introOverlay.ts`, with the spec's timings (line 1 at 0:15).

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run --root client test/game/introOverlay.test.ts test/game/assetUrls.test.ts`
Expected: all pass. Then `npm run typecheck && npm run lint && npx vitest run --root client` on a quiet machine: every file passes.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/introOverlay.ts client/src/game/assetUrls.ts client/src/main.ts client/test/game/introOverlay.test.ts client/test/game/assetUrls.test.ts
git commit -m "feat: play the intro on Play, with the loading bar, hold to skip and the step out"
```

---

### Task 7: The light title page

**Files:**
- Modify: `client/src/main.ts:718-770` (the landing branch), `client/src/game/landing.ts:1-30` (the backdrop's style)
- Delete: `client/src/game/landingScene.ts`, `client/src/game/landingPath.ts`, `client/test/game/landingPath.test.ts`
- Test: `client/test/game/landingStill.test.ts` (new, jsdom), `client/test/architecture.test.ts` (the deleted files' names)

**Interfaces:**
- Consumes: `stillUrl()` from Task 6.
- Produces: the landing's backdrop is an `<img class="landing-bg">` of the still, or nothing; no renderer, no model load, no `createForest` before Play.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/landingStill.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { landingBackdrop } from "../../src/game/landingBackdrop.js";

describe("the title page's backdrop", () => {
  it("is the still when it ships, and nothing when it does not", () => {
    const withStill = landingBackdrop("/assets/intro.still-abc.webp");
    expect(withStill?.tagName).toBe("IMG");
    expect(withStill?.className).toBe("landing-bg ready");
    expect(withStill?.getAttribute("decoding")).toBe("async");
    expect(landingBackdrop(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/landingStill.test.ts`
Expected: FAIL, no `landingBackdrop`.

- [ ] **Step 3: Replace the rendered backdrop with the still**

```ts
// client/src/game/landingBackdrop.ts
/** The title page's backdrop: one still frame of the film, or nothing. No renderer, no model, no map loads before Play. */
export function landingBackdrop(still: string | null): HTMLImageElement | null {
  if (still === null) return null;
  const img = document.createElement("img");
  img.className = "landing-bg ready";
  img.src = still;
  img.alt = "";
  img.decoding = "async";
  return img;
}
```

In `main.ts`'s landing branch: replace the `backdrop` canvas and `createLandingScene(backdrop)` with `const backdrop = landingBackdrop(stillUrl()); if (backdrop) container.appendChild(backdrop);` and `running = { dispose: () => handle.dispose() }`. In `landing.ts`'s STYLE, `.landing-bg` keeps its blur and scale and gains `object-fit: cover`; the `.ready` opacity rule stays. Delete `landingScene.ts`, `landingPath.ts` and `landingPath.test.ts`; remove their names from `client/test/architecture.test.ts` where it lists wall-clock readers (`landingScene.ts` read `performance.now()`).

- [ ] **Step 4: Run the tests and the architecture test**

Run: `npx vitest run --root client test/game/landingStill.test.ts test/architecture.test.ts test/game/landingModel.test.ts`
Expected: all pass; the architecture test no longer expects `landingScene.ts`.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/landingBackdrop.ts client/src/main.ts client/src/game/landing.ts client/test/game/landingStill.test.ts client/test/architecture.test.ts
git rm client/src/game/landingScene.ts client/src/game/landingPath.ts client/test/game/landingPath.test.ts
git commit -m "feat: make the title page a still frame, with no renderer before Play"
```

---

### Task 8: The deploy's checks, and the docs

**Files:**
- Modify: `tools/deploy/verify.mjs:98-145` (after the model checks)
- Modify: `ARCHITECTURE.md`
- Test: `tools/deploy/test/verify.test.mjs`

**Interfaces:**
- Consumes: the bundle source `verify.mjs` already fetches; `findModelUrls`'s technique.

- [ ] **Step 1: Write the failing test**

In `tools/deploy/test/verify.test.mjs`, beside the model-url test:

```js
test("findAssetUrl finds the video's and the still's hashed urls in the bundle", () => {
  const src = 'x="/dayhike/assets/intro-Ab12Cd34.mp4";y="/dayhike/assets/intro.still-Zz99Yy88.webp"';
  assert.equal(findAssetUrl(src, "intro", "mp4"), "/dayhike/assets/intro-Ab12Cd34.mp4");
  assert.equal(findAssetUrl(src, "intro.still", "webp"), "/dayhike/assets/intro.still-Zz99Yy88.webp");
  assert.equal(findAssetUrl(src, "nothing", "mp4"), null);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root tools deploy/test/verify.test.mjs`
Expected: FAIL, `findAssetUrl` is not exported.

- [ ] **Step 3: Add the checks**

```js
// tools/deploy/verify.mjs
export function findAssetUrl(source, id, ext) {
  const m = source.match(new RegExp(`"(/dayhike/assets/${id.replace(/\./g, "\\.")}-[A-Za-z0-9_-]{8}\\.${ext})"`));
  return m ? m[1] : null;
}
```

and after the model checks: the video's url from the bundle (absent is allowed until the asset ships: reported as a note, not a failure), a `Range: bytes=0-11` fetch whose bytes 4 to 8 read `ftyp`, `cache-control` includes `immutable`; the still's url, its bytes `RIFF`…`WEBP`, immutable, under 200 KB by `content-length`; and the title page's first load: the bytes of `index.html` plus every `<script>` and `<link rel=stylesheet>` it names plus the still, under 1,500,000, as `check(total < 1_500_000, "the title page's first load is under 1.5 MB", `${total} bytes`)`.

`ARCHITECTURE.md`: after the tier paragraph in Rendering, one paragraph: Play starts the film and the game loads behind it; the two models and the overlay; the one loader every model passes through; the start's yields and the ready gate; the title page as a still.

- [ ] **Step 4: Run the tools suite**

Run: `npx vitest run --root tools`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tools/deploy/verify.mjs tools/deploy/test/verify.test.mjs ARCHITECTURE.md
git commit -m "feat: verify the intro's video and still, and the title page's weight, after a deploy"
```

---

### Task 9: The whole suite, and the look in the browser

**Files:**
- Create: `docs/gameplay/<today>-intro-playback-verification.md`

- [ ] **Step 1: The whole suite**

Run, when nothing else uses the machine: `npm run typecheck && npm run lint && npm test`
Expected: clean; every suite passes.

- [ ] **Step 2: The look (spec §8.2), with a development video**

Start the dev stack on free ports (the treeline verification note's rig applies: `PORT=<signaling> ALLOWED_ORIGINS=http://localhost:<vite> npm run dev`, the `/ws` proxy and port in `client/vite.config.ts` edited locally and reverted before the commit). Serve any sixty-second MP4 from `client/public/dev/intro.mp4` (not committed) and open the title page with `?intro=/dayhike/dev/intro.mp4`. Record, on both tiers and both engines, with the probe running (`?probe=`) and skipped (a stored choice):

1. **No freeze:** `document.querySelector("video").getVideoPlaybackQuality()` at the cut: `droppedVideoFrames` 0; the longest task from a `PerformanceObserver({ type: "longtask" })` after Play under 150 ms; the caption and the line seen to move in a screenshot series two seconds apart.
2. **The probe's verdict** (`console` "quality:" line) the same with `?intro=` and `?intro=off`, three runs each.
3. **Time to ready** under `chrome-devtools emulate <page> --networkConditions "Fast 4G"` and `"Slow 4G"` and unthrottled, first visit (a fresh isolated context) and repeat: the line reaches `ready`; the last frame holds; the step-out click cuts to first person on the pad facing the trail (the `me.yaw` of the spawn), the controls live (pointer lock held), the pause menu never seen.
4. **The cut:** a screenshot of the film's last frame and of the game's first frame.
5. **A phone:** `emulate --viewport 390x844x1,mobile,touch`: the video letterboxed, the caption and the line inside the bars, hold to skip by touch.
6. **A follower:** a second page joining by the invite link mid-video sees the intro; a join against a dead host shows the connect panel and the video stops.
7. **No video:** `?intro=off` starts the game as today.
8. **The title page:** `performance.getEntriesByType("resource")` total `transferSize` on the title page under 1,500,000 and no `.glb` among them.

- [ ] **Step 3: Write the note and commit it alone**

The note names the commit, the browser and its renderer string, the video used, and each check met or missed with what was seen; a missed check is reported as missed.

```bash
git checkout -- client/vite.config.ts
git add docs/gameplay/<today>-intro-playback-verification.md
git commit -m "docs: record the intro's playback as it looks in the game"
```

---

## Self-review

- **Spec coverage.** §1 pieces 5 and 6: Tasks 6 and 7. §4 the file: the urls and the deploy checks (Tasks 6, 8); the asset itself is the asset side's. §5.1: Task 7 and the 1.5 MB check (Task 8). §5.2 steps 1–5: Task 6 (the gesture, the buffer gate), Task 5 (the yields, the gate), Task 4 (the clipmap stepped). §5.3: Tasks 1, 3, 4. §5.4: Tasks 2, 6. §5.5: Task 6's error path and `fail`; the follower's join is the existing connect panel over the overlay's `stop`. §7: recorded in Task 9's note. §8.1: Tasks 1–7's tests; §8.2 and §8.4: Tasks 9 and 8. §8.3 (other hardware) is outside this plan and named in the note as owed. §9: no sim change.
- **Placeholders.** None; the one deferred piece is the captions' source, which part 2's `intro.ts` replaces, and Task 6 says what stands in meanwhile.
- **Type consistency.** `LoadProgress`, `Stage`, `ProgressView` (Task 1) are what Tasks 3, 4, 5, 6 consume; `IntroPlayback`, `PlaybackView` (Task 2) what Task 6 consumes; `GameHandle.ready/cover/engage` (Task 5) what Task 6 consumes; `videoUrl/stillUrl` (Task 6) what Task 7 consumes; `findAssetUrl` (Task 8) is its own.
- **Review Focus.** 1 → Task 6 test 3; 2 → Task 2 tests 2 and 3; 3 → Task 1 test 3; 4 → Task 6's `stop` in `fail` (a browser check in Task 9, item 6); 5 → Task 2 test 5.
