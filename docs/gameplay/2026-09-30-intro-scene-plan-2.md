# The intro scene, part 2: the scene player and the staged intro — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scene player that plays a scene as a pure function of time, the sixty-second intro staged on it with stand-ins on the fixed world, viewable and frame-steppable at `/dayhike/scene/intro`, and the intro's captions read from the staged scene's own track.

**Architecture:** Under `client/src/game/scene/`, pure modules describe a scene as data and evaluate one frame's description from *t* (`timeline.ts`, `shots.ts`, `roadPath.ts`, `sceneClock.ts`, `intro.ts`); one Babylon module applies a frame to the renderer's camera, the actors and the car and decides nothing (`sceneStage.ts`); one DOM module shows the caption (`captions.ts`); `scenePlayer.ts` runs clock → evaluate → stage. The renderer gains a field of view and a roll on its free camera and an injected clock, the character pool gains posing at an exact clip time, and `router.ts`/`main.ts` gain the scene route, which builds the fixed world with no local player (the way the title page's backdrop did until part 1) and exposes `dayhikeScene.seek/frame` for a recorder.

**Tech Stack:** TypeScript, Babylon.js 9.18, Vite, vitest (Node, NullEngine for the renderer; the stand-in DOM for the caption panel).

**Spec:** `docs/gameplay/2026-09-29-intro-scene.md` — §2 (the scene player), §3 (the intro's setting, shots and script), §6 (the recording interface), §8.1 (the tests in Node), §9 (boundaries). Part 1 (`docs/gameplay/2026-09-29-intro-scene-plan.md`) shipped on `main` `1fe1a65`: the loading bar, the playback, the title page.

## Global Constraints

- The sim and the wire are never touched: no file under `client/src/sim/` changes; the level id does not move (spec §9). The scene runs with no local player and a scene frame leaves the sim's state as it found it (§8.1).
- The film camera defaults to 0.43 rad, uses 0.10 to 0.14 rad for the coastal wide, and is never wider than 0.57 rad except the one deliberate cab shot (§2); every shot's field of view is within [0.10, 0.57] rad but that one (§8.1).
- Depth of field is off for every shot but the handset insert (§2).
- Eight shots summing 60 s at the times of §3's table; the ten lines of §3's script, dispatch's in italics with the label "Dispatch (radio)", at most 42 characters a line and two lines, no faster than 20 characters a second (§3).
- The scene's world: `hollow`, at noon, in mist (§3); one ranger for everyone, one world for the film (§1).
- A missing clip, part or mouth shape falls back to the stand-in and logs one line; a scene never fails to play because an asset is absent. A hidden tab holds the clock (§2).
- The route: `/dayhike/scene/intro`, `?t=<seconds>` seeks, `?step=<n>` holds frame *n* at 24 frames a second; `dayhikeScene.seek(t)` and `dayhikeScene.frame()` (renders one frame and resolves when it is drawn) (§2, §6).
- Every numeric test expectation is a literal; explicit time limits go through `timeLimit(<ms>)` (§8.1). UI: a pure model and a dumb renderer, `textContent` only. Nothing in code, comments, docs or commit messages describes how an asset is made.
- Every model load goes through `loadContainer` inside `loadUntilAborted` (part 1).

## Review Focus

Inputs the spec implies and a person will meet. Each has its test in the task that owns the code.

1. **A seek past the end, or before the start.** `?t=99` and `?t=-3` clamp to the scene's last and first frame; nothing throws, the page shows a frame (Task 2, "clamps t into [0, duration]"; Task 10, "parses the route's t and step").
2. **The ranger's model never arrives.** The scene plays with the actor absent and one warning; the car and the captions still run (Task 8, "stages a frame with no actor instance and logs once").
3. **The car has no named parts (today's model).** The whole model slides along the road, the wheels do not spin, the door does not open, and no error is thrown (Task 8, "moves a car with no parts as a whole").
4. **A hidden tab mid-scene.** The clock holds at the same *t*, resumes there, and the stepped clock ignores visibility (Task 1, "holds while hidden and resumes at the same time").
5. **The scene route opened while a hike is running.** The hike is disposed first, the world is rebuilt for the scene, and leaving the route disposes the scene's renderer and the `dayhikeScene` global (Task 10, "leaves nothing behind").

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/game/scene/sceneClock.ts` (new) | The time source: the wall clock, held, or stepped a frame at a time. Pure. |
| `client/src/game/scene/timeline.ts` (new) | A scene as data (duration, camera, actors, car, captions, black), `evaluate(scene, t)` → one frame's description. Pure. |
| `client/src/game/scene/shots.ts` (new) | Camera shots as functions of time: a hold, a follow, a push, a look-at; a cut list; the fade. Pure. |
| `client/src/game/scene/roadPath.ts` (new) | The car's pose a distance along the road, a lane offset, wheel spin from distance. Pure; the road's centreline injected. |
| `client/src/game/scene/intro.ts` (new) | The intro scene's data: the world, the shots, the car's path, the actor's clips, the captions. Pure. |
| `client/src/game/scene/captions.ts` (new) | The caption panel: a DOM node written with `textContent`. |
| `client/src/game/scene/sceneStage.ts` (new) | Applies one frame to the renderer, the actor instance and the car model. Decides nothing. |
| `client/src/game/scene/scenePlayer.ts` (new) | Runs clock → evaluate → stage each frame; the end, a hidden tab, a seek, `frame()`. |
| `client/src/game/renderer.ts` (modify) | `FreecamView` gains `fov` and `roll`; `RendererOptions.clock` feeds the wind and the post effects. |
| `client/src/game/post.ts` (modify) | Takes its clock from the renderer. |
| `client/src/game/characterModel.ts` (modify) | `CharacterInstance.pose(clip, seconds)` and `clipNames()`; a missing clip logs once and holds. |
| `client/src/game/router.ts` (modify) | `{ kind: "scene"; name: "intro" }` for `/scene/intro`. |
| `client/src/main.ts` (modify) | The scene route's branch; `dayhikeScene`; the intro's captions from `intro.ts`. |
| `client/src/game/introOverlay.ts` (modify) | `INTRO_CAPTIONS` removed; `Caption` re-exported from `timeline.ts`. |
| `docs/gameplay/2026-09-30-intro-staging-verification.md` (new, Task 12) | The look at the route. |

---

### Task 1: The scene clock

**Files:**
- Create: `client/src/game/scene/sceneClock.ts`
- Test: `client/test/game/scene/sceneClock.test.ts`

**Interfaces:**
- Produces: `createSceneClock(now: () => number): SceneClock` with `SceneClock = { time(): number; hold(): void; resume(): void; seek(t: number): void; step(frame: number, fps: number): void; held(): boolean; hidden(on: boolean): void }`. `time()` is seconds into the scene. `FPS = 24`.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/sceneClock.test.ts
import { describe, expect, it } from "vitest";
import { FPS, createSceneClock } from "../../../src/game/scene/sceneClock.js";

describe("the scene clock", () => {
  it("runs on the wall clock from zero, in seconds", () => {
    let ms = 1000;
    const c = createSceneClock(() => ms);
    expect(c.time()).toBe(0);
    ms = 3500;
    expect(c.time()).toBe(2.5);
  });

  it("holds while hidden and resumes at the same time", () => {
    let ms = 0;
    const c = createSceneClock(() => ms);
    ms = 2000;
    c.hidden(true);
    ms = 9000;
    expect(c.time()).toBe(2);
    expect(c.held()).toBe(true);
    c.hidden(false);
    ms = 10000;
    expect(c.time()).toBe(3);
  });

  it("seeks, and a seek is idempotent", () => {
    let ms = 0;
    const c = createSceneClock(() => ms);
    c.seek(12.5);
    c.seek(12.5);
    expect(c.time()).toBe(12.5);
    ms = 500;
    expect(c.time()).toBe(13);
  });

  it("steps to a frame and holds there, whatever the wall clock does", () => {
    let ms = 0;
    const c = createSceneClock(() => ms);
    c.step(48, FPS);
    ms = 5000;
    expect(c.time()).toBe(2);
    expect(c.held()).toBe(true);
    c.hidden(true);
    c.hidden(false);
    expect(c.time()).toBe(2);
    c.resume();
    ms = 5250;
    expect(c.time()).toBe(2.25);
    expect(FPS).toBe(24);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/sceneClock.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the clock**

```ts
// client/src/game/scene/sceneClock.ts
/**
 * A scene's time source. Three ways to run: on the wall clock from the
 * moment it was made (or last resumed), held at a time, or stepped to a
 * frame and held there. A hidden tab holds it and a visible one resumes it
 * at the same time, except a stepped clock, which stays where the step put
 * it until `resume`: a recorder's frame must not move because the page was
 * hidden.
 */
export const FPS = 24;

export type SceneClock = {
  /** Seconds into the scene. */
  time(): number;
  hold(): void;
  resume(): void;
  seek(t: number): void;
  /** Frame `frame` at `fps` frames a second, held. */
  step(frame: number, fps: number): void;
  held(): boolean;
  hidden(on: boolean): void;
};

export function createSceneClock(now: () => number): SceneClock {
  /** The wall time (ms) that reads as `base` seconds; null while held. */
  let origin: number | null = now();
  let base = 0;
  let stepped = false;
  let wasRunning = true;
  const time = (): number => (origin === null ? base : base + (now() - origin) / 1000);
  const hold = (): void => {
    if (origin === null) return;
    base = time();
    origin = null;
  };
  const resume = (): void => {
    stepped = false;
    if (origin !== null) return;
    origin = now();
  };
  return {
    time,
    hold,
    resume,
    seek(t) {
      const running = origin !== null;
      base = t;
      origin = running ? now() : null;
    },
    step(frame, fps) {
      hold();
      base = frame / fps;
      stepped = true;
    },
    held: () => origin === null,
    hidden(on) {
      if (stepped) return;
      if (on) {
        wasRunning = origin !== null;
        hold();
      } else if (wasRunning) resume();
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene/sceneClock.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/sceneClock.ts client/test/game/scene/sceneClock.test.ts
git commit -m "feat: a scene clock that runs, holds, seeks and steps a frame at a time"
```

---

### Task 2: The timeline: a scene as data, and one frame from t

**Files:**
- Create: `client/src/game/scene/timeline.ts`
- Test: `client/test/game/scene/timeline.test.ts`

**Interfaces:**
- Produces:

```ts
export type CameraPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; roll: number; dof: boolean };
export type ActorPose = { id: string; x: number; y: number; z: number; yaw: number; clip: string; clipTime: number; visible: boolean };
export type CarPose = { x: number; y: number; z: number; yaw: number; wheelSpin: number; doorOpen: number };
export type Caption = { from: number; to: number; text: string; radio: boolean };
export type Frame = { t: number; camera: CameraPose; actors: ActorPose[]; car: CarPose | null; caption: Caption | null; black: number };
export type Scene = {
  duration: number;
  camera: (t: number) => CameraPose;
  actors: ((t: number) => ActorPose)[];
  car: ((t: number) => CarPose) | null;
  captions: readonly Caption[];
  /** How black the frame is, 0 (the picture) to 1 (black): the fade in, the fade out. */
  black: (t: number) => number;
};
export function evaluate(scene: Scene, t: number): Frame;
export function captionAt(captions: readonly Caption[], t: number): Caption | null;
export function clampTime(scene: Pick<Scene, "duration">, t: number): number;
```

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/timeline.test.ts
import { describe, expect, it } from "vitest";
import { captionAt, clampTime, evaluate, type Scene } from "../../../src/game/scene/timeline.js";

const captions = [
  { from: 1, to: 3, text: "Four-one, dispatch.", radio: true },
  { from: 3, to: 4.5, text: "Four-one. Go ahead.", radio: false },
];

const scene: Scene = {
  duration: 10,
  camera: (t) => ({ x: t, y: 2, z: 0, yaw: 0, pitch: 0, fov: 0.43, roll: 0, dof: false }),
  actors: [(t) => ({ id: "ranger", x: 0, y: 0, z: t * 2, yaw: 1, clip: "walk", clipTime: t, visible: t > 5 })],
  car: (t) => ({ x: 1, y: 0, z: 10 * t, yaw: 0, wheelSpin: t, doorOpen: 0 }),
  captions,
  black: (t) => (t < 1 ? 1 - t : 0),
};

describe("the timeline", () => {
  it("evaluates one frame from t, the same numbers every call", () => {
    const a = evaluate(scene, 2.5);
    const b = evaluate(scene, 2.5);
    expect(a).toEqual(b);
    expect(a.camera.x).toBe(2.5);
    expect(a.actors[0]?.z).toBe(5);
    expect(a.actors[0]?.visible).toBe(false);
    expect(a.car?.z).toBe(25);
    expect(a.caption?.text).toBe("Four-one, dispatch.");
    expect(a.black).toBe(0);
  });

  it("gives the caption for t or none, the boundary belonging to the later line", () => {
    expect(captionAt(captions, 0.5)).toBeNull();
    expect(captionAt(captions, 3)?.text).toBe("Four-one. Go ahead.");
    expect(captionAt(captions, 4.5)).toBeNull();
  });

  it("clamps t into [0, duration]", () => {
    expect(clampTime(scene, -3)).toBe(0);
    expect(clampTime(scene, 99)).toBe(10);
    expect(evaluate(scene, 99).t).toBe(10);
    expect(evaluate(scene, -1).black).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/timeline.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the timeline**

```ts
// client/src/game/scene/timeline.ts
/**
 * A scene as data, and one frame of it from a time. A scene is a pure
 * function of time: given `t`, `evaluate` says where the camera, the actors
 * and the car are, which clip each actor is in and at what time, and which
 * caption is up. Nothing here advances on its own, which is what makes a
 * frame-exact recording, a test in Node and a seek all the same call.
 */

/** The camera: metres, radians; `fov` vertical, `roll` about the view axis,
 * `dof` whether depth of field is on. Yaw 0 faces +z, positive pitch looks down. */
export type CameraPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; roll: number; dof: boolean };
/** An actor: where it stands, which clip it is in and how far into it. */
export type ActorPose = { id: string; x: number; y: number; z: number; yaw: number; clip: string; clipTime: number; visible: boolean };
/** The car: its pose, the wheels' spin (radians) and how open the driver's door is (0 to 1). */
export type CarPose = { x: number; y: number; z: number; yaw: number; wheelSpin: number; doorOpen: number };
/** One caption, shown while `from <= t < to`; a `\n` in the text is its second line. */
export type Caption = { from: number; to: number; text: string; radio: boolean };

export type Frame = { t: number; camera: CameraPose; actors: ActorPose[]; car: CarPose | null; caption: Caption | null; black: number };

export type Scene = {
  duration: number;
  camera: (t: number) => CameraPose;
  actors: ((t: number) => ActorPose)[];
  car: ((t: number) => CarPose) | null;
  captions: readonly Caption[];
  /** How black the frame is, 0 (the picture) to 1 (black): the fade in, the fade out. */
  black: (t: number) => number;
};

export function clampTime(scene: Pick<Scene, "duration">, t: number): number {
  return Math.min(scene.duration, Math.max(0, t));
}

/** The caption up at `t`: the last whose `from` is not past `t` and whose `to` is. */
export function captionAt(captions: readonly Caption[], t: number): Caption | null {
  for (const c of captions) if (c.from <= t && t < c.to) return c;
  return null;
}

export function evaluate(scene: Scene, at: number): Frame {
  const t = clampTime(scene, at);
  return {
    t,
    camera: scene.camera(t),
    actors: scene.actors.map((a) => a(t)),
    car: scene.car === null ? null : scene.car(t),
    caption: captionAt(scene.captions, t),
    black: Math.min(1, Math.max(0, scene.black(t))),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene/timeline.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/timeline.ts client/test/game/scene/timeline.test.ts
git commit -m "feat: a scene as data, one frame evaluated from a time"
```

---

### Task 3: Shots: camera functions of time, and cuts between them

**Files:**
- Create: `client/src/game/scene/shots.ts`
- Test: `client/test/game/scene/shots.test.ts`

**Interfaces:**
- Consumes: `CameraPose` from Task 2.
- Produces:

```ts
export const FILM_FOV = 0.43;
export const FOV_MIN = 0.10;
export const FOV_MAX = 0.57;
export type Look = { x: number; y: number; z: number };
export type Shot = (t: number) => CameraPose;          // t is seconds INTO the shot
export type Cut = { from: number; to: number; shot: Shot };
export function lookAt(from: Look, at: Look, fov?: number, roll?: number, dof?: boolean): CameraPose;
export function hold(pose: CameraPose): Shot;
export function holdLookingAt(from: Look, at: (t: number) => Look, fov?: number): Shot;
export function follow(target: (t: number) => { x: number; y: number; z: number; yaw: number }, offset: (t: number) => Look, fov?: number, pitch?: number): Shot;
export function push(from: Look, to: Look, seconds: number, at: Look, fov?: number): Shot;
export function ease(u: number): number;               // smoothstep on [0, 1]
export function cutList(cuts: readonly Cut[]): (t: number) => CameraPose;
export function fade(inSeconds: number, outAt: number, duration: number): (t: number) => number;
```

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/shots.test.ts
import { describe, expect, it } from "vitest";
import { FILM_FOV, FOV_MAX, FOV_MIN, cutList, ease, fade, follow, hold, holdLookingAt, lookAt, push } from "../../../src/game/scene/shots.js";

describe("shots", () => {
  it("looks from a point at a point: yaw 0 faces +z, positive pitch looks down", () => {
    const ahead = lookAt({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 10 });
    expect(ahead.yaw).toBe(0);
    expect(ahead.pitch).toBe(0);
    expect(ahead.fov).toBe(FILM_FOV);
    const right = lookAt({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 });
    expect(right.yaw).toBeCloseTo(Math.PI / 2, 6);
    const down = lookAt({ x: 0, y: 12, z: 0 }, { x: 0, y: 2, z: 10 });
    expect(down.pitch).toBeCloseTo(Math.PI / 4, 6);
    expect(FILM_FOV).toBe(0.43);
    expect(FOV_MIN).toBe(0.1);
    expect(FOV_MAX).toBe(0.57);
  });

  it("holds a pose, and holds a point of view on a moving target", () => {
    const p = lookAt({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 30 }, 0.3);
    expect(hold(p)(5)).toEqual(p);
    const track = holdLookingAt({ x: 0, y: 2, z: 0 }, (t) => ({ x: 10, y: 2, z: 10 * t }), 0.3);
    expect(track(0).yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(track(1).yaw).toBeCloseTo(Math.PI / 4, 6);
  });

  it("follows a target with an offset in its own frame", () => {
    const car = (t: number) => ({ x: 5, y: 0, z: 10 * t, yaw: 0 });
    const behind = follow(car, () => ({ x: -2, y: 1.5, z: -8 }));
    const f = behind(1);
    expect(f.x).toBe(3);
    expect(f.y).toBe(1.5);
    expect(f.z).toBe(2);
    expect(f.yaw).toBe(0);
    const turned = follow((t) => ({ x: 0, y: 0, z: 0, yaw: Math.PI / 2 }), () => ({ x: 0, y: 1, z: -8 }));
    expect(turned(0).x).toBeCloseTo(-8, 6);
    expect(turned(0).z).toBeCloseTo(0, 6);
  });

  it("pushes from a point to a point over its seconds with an ease, then holds", () => {
    const p = push({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 4 }, 2, { x: 0, y: 1, z: 100 });
    expect(p(0).z).toBe(0);
    expect(p(1).z).toBe(2);
    expect(p(2).z).toBe(4);
    expect(p(3).z).toBe(4);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(0.25)).toBe(0.15625);
  });

  it("cuts between shots by time, each shot's clock starting at its cut", () => {
    const a = hold(lookAt({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }));
    const b = push({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 5, { x: 0, y: 1, z: 100 });
    const camera = cutList([{ from: 0, to: 3, shot: a }, { from: 3, to: 8, shot: b }]);
    expect(camera(2).z).toBe(0);
    expect(camera(3).z).toBe(0);
    expect(camera(5.5).z).toBe(5);
    expect(camera(20).z).toBe(10);
  });

  it("fades in from black and out to black", () => {
    const black = fade(2, 57, 60);
    expect(black(0)).toBe(1);
    expect(black(1)).toBe(0.5);
    expect(black(30)).toBe(0);
    expect(black(58.5)).toBe(0.5);
    expect(black(60)).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/shots.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the shots**

```ts
// client/src/game/scene/shots.ts
/**
 * Camera shots as functions of time, and the cuts between them. Pure: a
 * shot takes the seconds into itself and gives a camera pose; a cut list
 * turns a scene's time into the running shot's own. The conventions are the
 * renderer's free camera's: yaw 0 faces +z, positive pitch looks down.
 */
import type { CameraPose } from "./timeline.js";

/** The film's default lens: 0.43 rad vertical, a 32 mm lens on Super 35. */
export const FILM_FOV = 0.43;
/** The coastal wide's lens is 0.10 to 0.14 rad; nothing goes wider than
 * 0.57 rad but the one cab shot. */
export const FOV_MIN = 0.1;
export const FOV_MAX = 0.57;

export type Look = { x: number; y: number; z: number };
/** A shot: seconds into it → the camera. */
export type Shot = (t: number) => CameraPose;
export type Cut = { from: number; to: number; shot: Shot };

/** Smoothstep on [0, 1]. */
export function ease(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

export function lookAt(from: Look, at: Look, fov = FILM_FOV, roll = 0, dof = false): CameraPose {
  const dx = at.x - from.x, dy = at.y - from.y, dz = at.z - from.z;
  const flat = Math.sqrt(dx * dx + dz * dz);
  return { x: from.x, y: from.y, z: from.z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, flat), fov, roll, dof };
}

export function hold(pose: CameraPose): Shot {
  return () => pose;
}

/** A locked-off camera that keeps a moving point in its centre. */
export function holdLookingAt(from: Look, at: (t: number) => Look, fov = FILM_FOV): Shot {
  return (t) => lookAt(from, at(t), fov);
}

/**
 * A camera carried by a target: `offset` is in the target's own frame (x
 * to its right, z ahead), turned by its yaw; the camera looks the way the
 * target faces, tilted by `pitch`.
 */
export function follow(
  target: (t: number) => { x: number; y: number; z: number; yaw: number },
  offset: (t: number) => Look,
  fov = FILM_FOV,
  pitch = 0,
): Shot {
  return (t) => {
    const p = target(t);
    const o = offset(t);
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    return { x: p.x + o.x * c + o.z * s, y: p.y + o.y, z: p.z - o.x * s + o.z * c, yaw: p.yaw, pitch, fov, roll: 0, dof: false };
  };
}

/** A move from `from` to `to` over `seconds` with an ease, looking at `at`; then held. */
export function push(from: Look, to: Look, seconds: number, at: Look, fov = FILM_FOV): Shot {
  return (t) => {
    const u = ease(seconds > 0 ? t / seconds : 1);
    return lookAt({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u }, at, fov);
  };
}

/** The running cut's shot at the scene's `t`, on the shot's own clock; past
 * the last cut, the last cut's shot at its end. */
export function cutList(cuts: readonly Cut[]): (t: number) => CameraPose {
  return (t) => {
    for (const c of cuts) if (t >= c.from && t < c.to) return c.shot(t - c.from);
    const last = cuts[cuts.length - 1];
    if (last === undefined) throw new Error("a cut list needs one cut");
    return t < last.from ? last.shot(0) : last.shot(last.to - last.from);
  };
}

/** Black over the first `inSeconds`, the picture until `outAt`, black by `duration`. */
export function fade(inSeconds: number, outAt: number, duration: number): (t: number) => number {
  return (t) => {
    if (t < inSeconds) return 1 - t / inSeconds;
    if (t > outAt) return Math.min(1, (t - outAt) / Math.max(1e-6, duration - outAt));
    return 0;
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene/shots.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/shots.ts client/test/game/scene/shots.test.ts
git commit -m "feat: camera shots as functions of time, cut lists and the fade"
```

---

### Task 4: The road path: the car a distance along the road

**Files:**
- Create: `client/src/game/scene/roadPath.ts`
- Test: `client/test/game/scene/roadPath.test.ts`

**Interfaces:**
- Consumes: `CarPose` from Task 2.
- Produces:

```ts
export type Road = { centerX: (z: number) => number; groundY: (x: number, z: number) => number };
export const WHEEL_RADIUS = 0.36;
export function roadPose(road: Road, z: number, lane: number, direction: 1 | -1): { x: number; y: number; z: number; yaw: number };
export function carAlong(road: Road, startZ: number, distance: (t: number) => number, lane: number, direction: 1 | -1): (t: number) => CarPose;
export function stopAt(total: number, cruise: number, brakeSeconds: number): (t: number) => number;
```

The road runs along z (`roadCenterX(seed, z)` is the sim's centreline); `direction` +1 drives toward +z (yaw 0), −1 toward −z (yaw π). `lane` is metres to the car's right of the centreline.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/roadPath.test.ts
import { describe, expect, it } from "vitest";
import { WHEEL_RADIUS, carAlong, roadPose, stopAt } from "../../../src/game/scene/roadPath.js";

const road = { centerX: (z: number) => 100 + 0.1 * z, groundY: (x: number, z: number) => 5 + 0.01 * x + 0.001 * z };

describe("the road path", () => {
  it("puts the car on the centreline plus its lane, to its right, headed the way it drives", () => {
    const up = roadPose(road, 40, 1.8, 1);
    expect(up.x).toBeCloseTo(105.8, 6);
    expect(up.z).toBe(40);
    expect(up.yaw).toBeCloseTo(Math.atan2(0.1, 1), 6);
    expect(up.y).toBeCloseTo(5 + 1.058 + 0.04, 6);
    const down = roadPose(road, 40, 1.8, -1);
    expect(down.x).toBeCloseTo(102.2, 6);
    expect(down.yaw).toBeCloseTo(Math.PI + Math.atan2(0.1, 1), 6);
  });

  it("drives a distance along z from a start, the wheels spinning with the distance", () => {
    const car = carAlong(road, -100, (t) => 10 * t, 1.8, 1);
    expect(car(0).z).toBe(-100);
    expect(car(5).z).toBe(-50);
    expect(car(5).wheelSpin).toBeCloseTo(50 / WHEEL_RADIUS, 6);
    expect(car(5).doorOpen).toBe(0);
    expect(WHEEL_RADIUS).toBe(0.36);
  });

  it("cruises then brakes to a stop at the total, with no motion after", () => {
    const d = stopAt(470, 12, 7);
    expect(d(0)).toBe(0);
    expect(d(10)).toBe(120);
    const cruiseEnd = (470 - 12 * 7 / 2) / 12;
    expect(d(cruiseEnd)).toBeCloseTo(428, 6);
    expect(d(cruiseEnd + 7)).toBeCloseTo(470, 6);
    expect(d(cruiseEnd + 3.5)).toBeGreaterThan(428);
    expect(d(cruiseEnd + 3.5)).toBeLessThan(470);
    expect(d(99)).toBe(470);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/roadPath.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the road path**

```ts
// client/src/game/scene/roadPath.ts
/**
 * The car on the road: its pose a distance along the road, in a lane, and
 * its wheels' spin from the distance travelled. Pure; the road's centreline
 * and the ground are injected (the sim's `roadCenterX` and `elevationAt`,
 * which the scene route passes in), so a test can use a straight line.
 */
import type { CarPose } from "./timeline.js";

/** The car's centreline x at z, and the ground's height. */
export type Road = { centerX: (z: number) => number; groundY: (x: number, z: number) => number };

/** The SUV's wheel radius (m), for the spin. */
export const WHEEL_RADIUS = 0.36;
/** The step along z the road's heading is read over. */
const HEADING_DZ = 1;

/** The car at `z`: on the centreline plus `lane` metres to its right, on the
 * ground, headed along the road the way it drives. */
export function roadPose(road: Road, z: number, lane: number, direction: 1 | -1): { x: number; y: number; z: number; yaw: number } {
  const cx = road.centerX(z);
  const dx = road.centerX(z + HEADING_DZ) - cx;
  // The road's heading toward +z, as a yaw; driving toward -z turns it round.
  const yaw = Math.atan2(dx, HEADING_DZ) + (direction === 1 ? 0 : Math.PI);
  // The car's right, heading +z, is +x; heading -z, it is -x.
  const x = cx + lane * direction;
  return { x, y: road.groundY(x, z), z, yaw };
}

/** The car driving from `startZ`, `distance(t)` metres along the road. */
export function carAlong(road: Road, startZ: number, distance: (t: number) => number, lane: number, direction: 1 | -1): (t: number) => CarPose {
  return (t) => {
    const d = distance(t);
    const pose = roadPose(road, startZ + direction * d, lane, direction);
    return { ...pose, wheelSpin: d / WHEEL_RADIUS, doorOpen: 0 };
  };
}

/**
 * Distance travelled: `cruise` m/s until a braking stretch of `brakeSeconds`
 * that ends at `total` with the speed at zero (a linear brake covers half
 * the cruise's distance over its time), and none after.
 */
export function stopAt(total: number, cruise: number, brakeSeconds: number): (t: number) => number {
  const brakeDistance = (cruise * brakeSeconds) / 2;
  const cruiseEnd = (total - brakeDistance) / cruise;
  return (t) => {
    if (t <= 0) return 0;
    if (t <= cruiseEnd) return cruise * t;
    const u = Math.min(1, (t - cruiseEnd) / brakeSeconds);
    return total - brakeDistance + cruise * brakeSeconds * (u - u * u / 2);
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene/roadPath.test.ts`
Expected: 3 passed. The heading check: `atan2(0.1, 1)` for the straight test road.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/roadPath.ts client/test/game/scene/roadPath.test.ts
git commit -m "feat: the car's pose a distance along the road, and a stop"
```

---

### Task 5: The intro's data: the world, the shots, the car, the actor, the captions

**Files:**
- Create: `client/src/game/scene/intro.ts`
- Modify: `client/src/game/introOverlay.ts` (remove `INTRO_CAPTIONS`; `Caption` re-exported from `timeline.ts`), `client/src/main.ts` (import the captions from `intro.ts`), `client/test/game/introOverlay.test.ts` (the captions test moves)
- Test: `client/test/game/scene/intro.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:

```ts
export const INTRO_SEED_TOKEN = "hollow";
export const INTRO_HOUR = 12;
export const INTRO_WEATHER: WeatherParams;           // WEATHER_PRESETS.mist
export const INTRO_DURATION = 60;
export const INTRO_RANGER = "ranger.nathan";
export const INTRO_CAR = "trailhead.car";
export const INTRO_CAPTIONS: readonly Caption[];
export type IntroPlaces = { car: { x: number; z: number }; start: { x: number; z: number; yaw: number }; board: { x: number; z: number }; direction: 1 | -1 };
export const INTRO_SHOTS: readonly { from: number; to: number }[];   // eight, summing 60
export function introScene(road: Road, places: IntroPlaces): Scene;
```

`IntroPlaces` is what the route reads off the sim (`trailheadPlaces` and `carYaw`): the car's site, the spawn and the board, and the way the car arrives (`direction` +1 when the car's yaw is 0, −1 when π).

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/intro.test.ts
import { describe, expect, it } from "vitest";
import { INTRO_CAPTIONS, INTRO_DURATION, INTRO_SHOTS, introScene } from "../../../src/game/scene/intro.js";
import { evaluate } from "../../../src/game/scene/timeline.js";
import { FOV_MAX, FOV_MIN } from "../../../src/game/scene/shots.js";

const road = { centerX: (z: number) => -250 + 0.02 * z, groundY: () => 10 };
const places = { car: { x: -246, z: 0 }, start: { x: -240, z: 4, yaw: 1.1 }, board: { x: -236, z: 9 }, direction: 1 as const };

describe("the intro's data", () => {
  it("has eight shots that sum to sixty seconds at the script's times", () => {
    expect(INTRO_SHOTS.map((s) => [s.from, s.to])).toEqual([[0, 9], [9, 15], [15, 25], [25, 30], [30, 36], [36, 43], [43, 50], [50, 60]]);
    expect(INTRO_DURATION).toBe(60);
  });

  it("keeps every shot's field of view within the film's range but the cab shot", () => {
    const scene = introScene(road, places);
    for (const [i, s] of INTRO_SHOTS.entries()) {
      const fov = evaluate(scene, (s.from + s.to) / 2).camera.fov;
      if (i === 2) expect(fov).toBe(0.9);
      else {
        expect(fov).toBeGreaterThanOrEqual(FOV_MIN);
        expect(fov).toBeLessThanOrEqual(FOV_MAX);
      }
    }
    expect(evaluate(scene, 4).camera.fov).toBe(0.12);
    expect(evaluate(scene, 27).camera.dof).toBe(true);
    expect(evaluate(scene, 12).camera.dof).toBe(false);
  });

  it("drives the car along the road to its site by the end of shot 6, and holds it there", () => {
    const scene = introScene(road, places);
    const at = (t: number) => evaluate(scene, t).car;
    expect(at(0)?.z).toBe(-470);
    expect(at(43)?.z).toBeCloseTo(0, 6);
    expect(at(43)?.x).toBeCloseTo(-250 + 1.8, 6);
    expect(at(55)?.z).toBeCloseTo(0, 6);
    expect(at(20)?.wheelSpin).toBeGreaterThan(at(19)?.wheelSpin ?? 0);
    expect(at(45)?.doorOpen).toBeGreaterThan(0);
    expect(at(40)?.doorOpen).toBe(0);
  });

  it("keeps the ranger out of sight until the step out, then standing at the spawn facing the trail", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 20).actors[0]?.visible).toBe(false);
    const stepping = evaluate(scene, 45).actors[0];
    expect(stepping?.visible).toBe(true);
    expect(stepping?.clip).toBe("walk");
    const standing = evaluate(scene, 55).actors[0];
    expect(standing?.clip).toBe("idle");
    expect(standing?.x).toBeCloseTo(-240, 6);
    expect(standing?.z).toBeCloseTo(4, 6);
    expect(standing?.yaw).toBe(1.1);
  });

  it("captions every line of the call at most two lines of 42 characters, no faster than 20 a second, none before shot 3", () => {
    expect(INTRO_CAPTIONS.length).toBe(11);
    for (const c of INTRO_CAPTIONS) {
      const lines = c.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
      expect(c.text.replace("\n", " ").length / (c.to - c.from)).toBeLessThanOrEqual(20);
      expect(c.from).toBeGreaterThanOrEqual(15);
    }
    const scene = introScene(road, places);
    expect(evaluate(scene, 16).caption?.text).toBe("Four-one, dispatch.");
    expect(evaluate(scene, 50).caption).toBeNull();
  });

  it("fades in over two seconds and is black at the end", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 0).black).toBe(1);
    expect(evaluate(scene, 1).black).toBe(0.5);
    expect(evaluate(scene, 30).black).toBe(0);
    expect(evaluate(scene, 60).black).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/intro.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the intro's data**

```ts
// client/src/game/scene/intro.ts
/**
 * The intro scene's data: the world it plays on, the eight shots, the car's
 * drive to the trailhead, the ranger's step out, and the call's captions.
 * Pure: the road and the trailhead's places come from the sim through the
 * route, so this file names no seed's numbers. What the shots frame is
 * spec §3; the numbers here are the first staging and are tuned in the
 * browser (`docs/gameplay/2026-09-30-intro-staging-verification.md`).
 *
 * The frame: the road runs along z; the sea is toward -x and inland toward
 * +x, so "from the sea side" is a camera at a smaller x than the road.
 */
import { WEATHER_PRESETS, type WeatherParams } from "../weather.js";
import { carAlong, stopAt, type Road } from "./roadPath.js";
import { FILM_FOV, cutList, ease, fade, follow, hold, holdLookingAt, lookAt, push, type Cut } from "./shots.js";
import type { ActorPose, CarPose, Caption, Scene } from "./timeline.js";

export const INTRO_SEED_TOKEN = "hollow";
export const INTRO_HOUR = 12;
export const INTRO_WEATHER: WeatherParams = WEATHER_PRESETS.mist;
export const INTRO_DURATION = 60;
export const INTRO_RANGER = "ranger.nathan";
export const INTRO_CAR = "trailhead.car";

/** The eight shots of §3, in seconds. */
export const INTRO_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 9 }, { from: 9, to: 15 }, { from: 15, to: 25 }, { from: 25, to: 30 },
  { from: 30, to: 36 }, { from: 36, to: 43 }, { from: 43, to: 50 }, { from: 50, to: 60 },
];

/** The car's drive: from this far down the road, at a cruise, braking over the last seconds to the site. */
const DRIVE_M = 470;
const CRUISE_MPS = 12;
const BRAKE_S = 7;
/** The car's lane: metres right of the centreline. */
const LANE_M = 1.8;
/** The car stops at the end of shot 6, the door opens through shot 7. */
const STOP_AT_S = 43;
const DOOR_OPEN_S = 1.5;
/** The ranger steps from the door and walks to the spawn over shot 7. */
const STEP_OUT_S = 43.5;
const WALK_S = 5;
/** Where the ranger appears beside the car: at the driver's door, the car's left when it faces +z. */
const DOOR_X_M = -1.0;
const DOOR_Z_M = 0.6;
/** The cab shots ride the car: the back seat and the handset's place, in the car's frame. */
const BACK_SEAT = { x: -0.3, y: 1.05, z: -0.9 };
const HANDSET = { x: 0.35, y: 0.95, z: 0.45 };
/** The one wide lens, the cab; the coastal wide's long lens; the insert's. */
const CAB_FOV = 0.9;
const COAST_FOV = 0.12;
const INSERT_FOV = 0.3;

export type IntroPlaces = {
  car: { x: number; z: number };
  start: { x: number; z: number; yaw: number };
  board: { x: number; z: number };
  direction: 1 | -1;
};

/** The call's ten lines against the video's clock, dispatch's marked as heard through the radio. */
export const INTRO_CAPTIONS: readonly Caption[] = [
  { from: 15.0, to: 16.4, text: "Four-one, dispatch.", radio: true },
  { from: 16.4, to: 17.8, text: "Four-one. Go ahead.", radio: false },
  { from: 17.8, to: 20.9, text: "We've had reports of a missing hiker.\nLast seen at Trail 14.", radio: true },
  { from: 20.9, to: 22.6, text: "Copy. Anyone see them come down?", radio: false },
  { from: 22.6, to: 26.0, text: "Last sighting was near the summit.\nThe caller didn't leave a name.", radio: true },
  { from: 26.0, to: 28.0, text: "All right. Who's meeting me out there?", radio: false },
  { from: 28.0, to: 29.5, text: "I've got nobody else to send.", radio: true },
  { from: 29.5, to: 33.0, text: "Figures. I'm ten minutes out.\nUp to the summit and back before dark.", radio: false },
  { from: 33.0, to: 35.8, text: "Four-one, be advised,\nradio won't carry past the road.", radio: true },
  { from: 35.8, to: 37.8, text: "If anything... ...get back to the road.", radio: true },
  { from: 37.8, to: 40.4, text: "Dispatch, you're breaking up.\n...Dispatch?", radio: false },
];

export function introScene(road: Road, places: IntroPlaces): Scene {
  const dir = places.direction;
  const startZ = places.car.z - dir * DRIVE_M;
  const drive = carAlong(road, startZ, stopAt(DRIVE_M, CRUISE_MPS, BRAKE_S), LANE_M, dir);
  const car = (t: number): CarPose => {
    const pose = drive(Math.min(t, STOP_AT_S));
    const door = t <= STOP_AT_S ? 0 : ease((t - STOP_AT_S) / DOOR_OPEN_S);
    return { ...pose, doorOpen: door };
  };
  const carAt = (t: number) => car(t);
  const seaSide = (x: number, m: number) => x - m;
  const carSite = drive(STOP_AT_S);
  const ground = (x: number, z: number) => road.groundY(x, z);

  // The ranger: unseen in the cab until the step out, then from the door to
  // the spawn over shot 7, then standing there facing the trail.
  const doorAt = { x: carSite.x + DOOR_X_M * dir, z: carSite.z + DOOR_Z_M * dir };
  const ranger = (t: number): ActorPose => {
    if (t < STEP_OUT_S) return { id: INTRO_RANGER, x: doorAt.x, y: carSite.y, z: doorAt.z, yaw: places.start.yaw, clip: "idle", clipTime: 0, visible: false };
    const u = ease((t - STEP_OUT_S) / WALK_S);
    const x = doorAt.x + (places.start.x - doorAt.x) * u;
    const z = doorAt.z + (places.start.z - doorAt.z) * u;
    const walking = u < 1;
    const yaw = walking ? Math.atan2(places.start.x - doorAt.x, places.start.z - doorAt.z) : places.start.yaw;
    return { id: INTRO_RANGER, x, y: ground(x, z), z, yaw, clip: walking ? "walk" : "idle", clipTime: t - STEP_OUT_S, visible: true };
  };

  const rangerLook = (t: number) => {
    const r = ranger(t);
    return { x: r.x, y: r.y + 1.5, z: r.z };
  };
  const carLook = (t: number) => {
    const c = carAt(t);
    return { x: c.x, y: c.y + 1, z: c.z };
  };
  const trailAhead = { x: places.start.x + Math.sin(places.start.yaw) * 12, y: ground(places.start.x, places.start.z) + 1.4, z: places.start.z + Math.cos(places.start.yaw) * 12 };

  const s = INTRO_SHOTS;
  const cuts: Cut[] = [
    // 1. Wide over the sea stacks and the mist, the car small on the coast
    //    road from high up and far out, a long lens; the trailhead out of frame.
    { ...s[0]!, shot: holdLookingAt({ x: seaSide(road.centerX(startZ), 380), y: ground(road.centerX(startZ), startZ) + 140, z: startZ - dir * 120 }, (t) => carLook(t), COAST_FOV) },
    // 2. Along the road from the sea side: a beat behind the car, then level with it.
    { ...s[1]!, shot: follow((t) => carAt(t + s[1]!.from), (t) => ({ x: -6, y: 1.5, z: -22 + 22 * ease(t / 6) })) },
    // 3. The cab from the back seat: the one wide lens.
    { ...s[2]!, shot: follow((t) => carAt(t + s[2]!.from), () => BACK_SEAT, CAB_FOV, 0.05) },
    // 4. The handset and the hand that holds it: the insert, depth of field on.
    { ...s[3]!, shot: (t) => ({ ...follow((u) => carAt(u + s[3]!.from), () => HANDSET, INSERT_FOV, 0.55)(t), dof: true }) },
    // 5. Low on the shoulder, the car passing close into the treeline.
    { ...s[4]!, shot: holdLookingAt({ x: seaSide(road.centerX(carSite.z - dir * 90), 4), y: ground(road.centerX(carSite.z - dir * 90), carSite.z - dir * 90) + 0.5, z: carSite.z - dir * 95 }, (t) => carLook(t + s[4]!.from)) },
    // 6. A locked-off wide as the car slows onto the shoulder by the board.
    { ...s[5]!, shot: holdLookingAt({ x: seaSide(carSite.x, 18), y: carSite.y + 1.6, z: carSite.z - dir * 26 }, (t) => carLook(t + s[5]!.from), 0.35) },
    // 7. The door, the step onto gravel, the ranger from behind facing the trail.
    { ...s[6]!, shot: holdLookingAt({ x: carSite.x - dir * 4, y: carSite.y + 1.4, z: carSite.z - dir * 7 }, (t) => rangerLook(t + s[6]!.from)) },
    // 8. A slow push past the ranger's shoulder onto the trail, then held.
    { ...s[7]!, shot: push(
      { x: places.start.x - Math.sin(places.start.yaw) * 2.2 + Math.cos(places.start.yaw) * 0.6, y: ground(places.start.x, places.start.z) + 1.6, z: places.start.z - Math.cos(places.start.yaw) * 2.2 - Math.sin(places.start.yaw) * 0.6 },
      { x: places.start.x + Math.sin(places.start.yaw) * 1.5 + Math.cos(places.start.yaw) * 0.6, y: ground(places.start.x, places.start.z) + 1.6, z: places.start.z + Math.cos(places.start.yaw) * 1.5 - Math.sin(places.start.yaw) * 0.6 },
      7, trailAhead, FILM_FOV,
    ) },
  ];

  return {
    duration: INTRO_DURATION,
    camera: cutList(cuts),
    actors: [ranger],
    car,
    captions: INTRO_CAPTIONS,
    black: fade(2, 57, INTRO_DURATION),
  };
}
```

Then move the captions: in `client/src/game/introOverlay.ts` delete the `INTRO_CAPTIONS` constant and its comment, and replace the local `Caption` type with `export type { Caption } from "./scene/timeline.js";` plus `import type { Caption } from "./scene/timeline.js";` where the file uses it. In `client/src/main.ts` change the import to `import { INTRO_CAPTIONS } from "./game/scene/intro.js";` (keeping `createIntroOverlay`, `CutReason`, `IntroOverlay` from `introOverlay.js`). In `client/test/game/introOverlay.test.ts` delete the case "captions every line of the call…" (it now lives in `intro.test.ts`) and its `INTRO_CAPTIONS` import.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npx vitest run --root client test/game/scene/intro.test.ts test/game/introOverlay.test.ts && npm run typecheck && npm run lint`
Expected: all pass; no `INTRO_CAPTIONS` left in `introOverlay.ts` (`grep -c INTRO_CAPTIONS client/src/game/introOverlay.ts` → 0).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/intro.ts client/src/game/introOverlay.ts client/src/main.ts client/test/game/scene/intro.test.ts client/test/game/introOverlay.test.ts
git commit -m "feat: the intro's scene data, and its captions as the scene's own track"
```

---

### Task 6: The renderer's film camera and its injected clock

**Files:**
- Modify: `client/src/game/renderer.ts:760` (`FreecamView`), `:852-870` (`RendererOptions`), `:1118` (`camera.fov = 1.4`), `:1461` (`performance.now()`), `:1527-1530` (the freecam branch's camera set)
- Modify: `client/src/game/post.ts:130,244` (the clock)
- Test: `client/test/game/rendererFilmCamera.test.ts` (new)

**Interfaces:**
- Produces: `FreecamView = { x; y; z; yaw; pitch; fov?: number; roll?: number }` — absent, the game's 1.4 rad and no roll; `RendererOptions.clock?: () => number` (ms), read for the wind's and the post effects' seconds in place of `performance.now()`; `createPost(..., { now })`'s clock.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/rendererFilmCamera.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>("@babylonjs/core/Engines/nullEngine.js");
  return { Engine: mod.NullEngine };
});

import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { createRenderer } from "../../src/game/renderer.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };
import { timeLimit } from "../helpers/timeLimit.js";

const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900 }) as unknown as HTMLCanvasElement;

describe("the renderer's film camera", () => {
  it("takes a field of view and a roll from the free camera's view, and keeps the game's lens without them", () => {
    const level = parseLevel(sandbox01);
    const forest = createForest(4242);
    const world = createWorld(level, 4242, false);
    const clock = vi.fn(() => 5000);
    const r = createRenderer(nullCanvas(), level, forest, { tier: "low", clock });
    r.setFreecam({ x: 0, y: 30, z: 0, yaw: 0.2, pitch: 0.1, fov: 0.43, roll: 0.05 });
    r.sync(world.state, -1, 0);
    expect(r.camera.fov).toBe(0.43);
    expect(r.camera.rotation.z).toBe(0.05);
    r.setFreecam({ x: 0, y: 30, z: 0, yaw: 0.2, pitch: 0.1 });
    r.sync(world.state, -1, 0);
    expect(r.camera.fov).toBe(1.4);
    expect(r.camera.rotation.z).toBe(0);
    expect(clock).toHaveBeenCalled();
    r.dispose();
  }, timeLimit(60_000));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/rendererFilmCamera.test.ts`
Expected: FAIL: `r.camera.fov` stays 1.4 with a view carrying `fov` (a type error on `fov` first; run with the type error to see the runtime failure, or expect the typecheck failure as the red).

- [ ] **Step 3: Give the free camera a lens and a roll, and the renderer a clock**

In `renderer.ts`:

```ts
/** The free camera's view; `fov` (rad, vertical) and `roll` (rad) are a
 * film shot's, absent for the game's own lens and no roll. */
export type FreecamView = { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number; roll?: number };
```

```ts
/** The game's own lens (rad, vertical). */
export const GAME_FOV = 1.4;
```

and at line 1118 `camera.fov = GAME_FOV;`. In `RendererOptions`:

```ts
  /** The clock (ms) the wind, the post effects and everything that moves
   * with time read; `performance.now` absent. A scene stepped a frame at a
   * time hands in its own, so the grass and the water move in step with it. */
  clock?: () => number;
```

In `buildRenderer`, `const clock = options.clock ?? (() => performance.now());`, then line 1461 `const seconds = clock() / 1000;`, and `createPost(...)` receives `{ now: clock }` (add the option to `post.ts`'s factory: `const now = options?.now ?? (() => performance.now()); const start = now();` and `const seconds = (now() - start) / 1000;` at 244). In the freecam branch (1527–1530):

```ts
        camera.position.set(freecam.x, freecam.y, freecam.z);
        camera.rotation.set(freecam.pitch, freecam.yaw, freecam.roll ?? 0);
        camera.fov = freecam.fov ?? GAME_FOV;
```

and in the player branch, where the camera is placed from the player, `camera.fov = GAME_FOV;` once (so a hike after a scene draws with the game's lens; find the line that sets `camera.rotation` from the view and put it beside).

- [ ] **Step 4: Run the test, the renderer suite, typecheck and lint**

Run: `npx vitest run --root client test/game/rendererFilmCamera.test.ts test/game/renderer.test.ts test/game/rendererSwap.test.ts test/game/post.test.ts && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/renderer.ts client/src/game/post.ts client/test/game/rendererFilmCamera.test.ts
git commit -m "feat: a lens and a roll on the free camera, and a clock the renderer is handed"
```

---

### Task 7: Posing a character at an exact clip time

**Files:**
- Modify: `client/src/game/characterModel.ts:129-135` (`CharacterInstance`), `:298-320` (the instance)
- Test: `client/test/game/characterPose.test.ts` (new)

**Interfaces:**
- Produces: `CharacterInstance.pose(clip: string, seconds: number): void` — the named clip (its exact name, or a kind's name through `clipNameFor`) held at `seconds` into it, wrapped for a loop; `CharacterInstance.clipNames(): readonly string[]`. A clip the model lacks logs one warning per instance and leaves the pose as it was.

- [ ] **Step 1: Write the failing test**

```ts
// client/test/game/characterPose.test.ts
import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import { Animation } from "@babylonjs/core/Animations/animation.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { createCharacterPool } from "../../src/game/characterModel.js";

/** A container with one node and two clips: `Idle` (60 frames) and `Walk` (30 frames) at 30 fps. */
function fakeContainer(scene: Scene): AssetContainer {
  const c = new AssetContainer(scene);
  const root = new TransformNode("root", scene);
  c.rootNodes.push(root);
  c.transformNodes.push(root);
  for (const [name, frames] of [["Idle", 60], ["Walk", 30]] as const) {
    const g = new AnimationGroup(name, scene);
    const a = new Animation(`${name}.y`, "position.y", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    a.setKeys([{ frame: 0, value: 0 }, { frame: frames, value: frames }]);
    g.addTargetedAnimation(a, root);
    c.animationGroups.push(g);
  }
  return c;
}

const asset = { id: "ranger.nathan", output: "models/ranger.nathan.glb", clips: { idle: "Idle", walk: "Walk" } };

describe("posing a character at a clip time", () => {
  it("holds the named clip at the second asked, wrapping a loop, and names its clips", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const pool = createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene));
    await pool.load(scene, [asset.id]);
    const instance = pool.acquire(7, asset.id);
    expect(instance).not.toBeNull();
    expect(instance?.clipNames()).toEqual(["Idle", "Walk"]);
    instance?.pose("Walk", 0.5);
    const node = scene.getTransformNodeByName("character_7_root");
    expect(node?.position.y).toBeCloseTo(15, 3);
    instance?.pose("Walk", 1.5);
    expect(node?.position.y).toBeCloseTo(15, 3);
    instance?.pose("idle", 1);
    expect(node?.position.y).toBeCloseTo(30, 3);
    engine.dispose();
  });

  it("logs once and holds the pose for a clip the model lacks", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pool = createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene));
    await pool.load(scene, [asset.id]);
    const instance = pool.acquire(8, asset.id);
    instance?.pose("Walk", 0.5);
    instance?.pose("Drive", 2);
    instance?.pose("Drive", 3);
    const node = scene.getTransformNodeByName("character_8_root");
    expect(node?.position.y).toBeCloseTo(15, 3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    engine.dispose();
  });
});
```

`createCharacterPool(source = catalog, loader = defaultLoader)` takes the catalog's shape as `source`: the test passes `{ assets: [asset] }` as the first argument and the loader as the second — write the two calls above as `createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene))`. (`resolveCharacterAssets` reads `id`, `output` and the clips off each entry and derives the url through `modelUrl`, which throws for an output that does not ship: give the test asset the real output `models/ranger.nathan.glb`.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/characterPose.test.ts`
Expected: FAIL: `pose is not a function`.

- [ ] **Step 3: Write `pose` and `clipNames`**

In the `CharacterInstance` type:

```ts
  /** The named clip (its own name, or a kind's) held at `seconds` into it,
   * wrapped for a loop: a scene posing the character at a time of its own.
   * A clip the model lacks warns once and leaves the pose as it was. */
  pose(clip: string, seconds: number): void;
  /** The model's clip names. */
  clipNames(): readonly string[];
```

In the instance, beside `play`:

```ts
        pose: (clip, seconds) => {
          const byKind = (["idle", "walk", "attack", "death"] as const).includes(clip as ClipKind)
            ? clipNameFor(model.asset, model.clipNames, clip as ClipKind)
            : null;
          const group = groups.get(byKind ?? clip) ?? null;
          if (group === null) {
            if (!missingWarned.has(clip)) {
              missingWarned.add(clip);
              console.warn(`character ${assetId}: no clip "${clip}"; holding the pose`);
            }
            return;
          }
          if (current !== group) {
            current?.stop();
            group.start(true, ratio);
            group.pause();
            current = group;
          }
          const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
          const span = group.to - group.from;
          const frame = group.from + (span > 0 ? ((seconds * fps) % span + span) % span : 0);
          group.goToFrame(frame);
        },
        clipNames: () => model.clipNames,
```

with `const missingWarned = new Set<string>();` declared beside `let current`. `play` keeps its own path (it calls `group.play`, which a paused group resumes: make `play` call `next.play(...)` after `next.reset()` so a posed group plays from its start).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/characterPose.test.ts test/game/characterModel.test.ts test/game/entityViews.test.ts && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/characterModel.ts client/test/game/characterPose.test.ts
git commit -m "feat: pose a character at an exact time in a named clip"
```

---

### Task 8: The stage: one frame applied to the renderer, the actor and the car

**Files:**
- Create: `client/src/game/scene/sceneStage.ts`, `client/src/game/scene/captions.ts`
- Test: `client/test/game/scene/sceneStage.test.ts`, `client/test/game/scene/captions.test.ts`

**Interfaces:**
- Consumes: `Frame` (Task 2); `FreecamView` with `fov`/`roll` (Task 6); `CharacterInstance.pose` (Task 7).
- Produces:

```ts
export type StageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  actor(id: string): CharacterInstance | null;
  car: CarModel | null;
  captions: CaptionPanel;
  black(amount: number): void;
  warn(line: string): void;
};
export type CarModel = { root: TransformNode; wheels: readonly TransformNode[]; door: TransformNode | null };
export function stageFrame(frame: Frame, deps: StageDeps): void;
export function carModelOf(placed: PlacedModel): CarModel;          // finds `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`, `door_driver` by name; none → a whole-model stand-in
export function createCaptionPanel(container: HTMLElement): CaptionPanel;   // captions.ts
export type CaptionPanel = { set(caption: Caption | null): void; dispose(): void };
```

`stageFrame` decides nothing: it writes the camera, poses each actor (an absent instance is warned once by id and skipped), moves the car (the whole model; a wheel spun about its axle and the door swung about its hinge where the parts exist), sets the caption and the black.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/captions.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptionPanel } from "../../../src/game/scene/captions.js";
import { asHtml, installStandInDom } from "../helpers/standInDom.js";

afterEach(() => vi.unstubAllGlobals());

describe("the caption panel", () => {
  it("writes the caption's text and marks the radio, and clears", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const panel = createCaptionPanel(asHtml(container));
    panel.set({ from: 1, to: 2, text: "Four-one, dispatch.", radio: true });
    const node = container.querySelector("div.scene-caption");
    expect(node?.textContent).toBe("Four-one, dispatch.");
    expect(node?.classList.contains("radio")).toBe(true);
    panel.set(null);
    expect(node?.textContent).toBe("");
    expect(node?.classList.contains("radio")).toBe(false);
    panel.dispose();
    expect(container.querySelector("div.scene-caption")).toBeNull();
  });
});
```

```ts
// client/test/game/scene/sceneStage.test.ts
import { describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { carModelOf, stageFrame, type StageDeps } from "../../../src/game/scene/sceneStage.js";
import type { Frame } from "../../../src/game/scene/timeline.js";
import type { CharacterInstance } from "../../../src/game/characterModel.js";

const frame: Frame = {
  t: 3,
  camera: { x: 1, y: 2, z: 3, yaw: 0.4, pitch: 0.1, fov: 0.43, roll: 0.02, dof: true },
  actors: [{ id: "ranger.nathan", x: 5, y: 6, z: 7, yaw: 1.2, clip: "walk", clipTime: 0.75, visible: true }],
  car: { x: 10, y: 11, z: 12, yaw: 3, wheelSpin: 2, doorOpen: 0.5 },
  caption: { from: 1, to: 4, text: "hello", radio: false },
  black: 0.25,
};

function deps(over: Partial<StageDeps> = {}): StageDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setFreecam: (v) => void calls.push(`cam ${v.x},${v.y},${v.z} ${v.yaw} ${v.pitch} ${v.fov} ${v.roll}`),
    setDepthOfField: (on) => void calls.push(`dof ${on}`),
    actor: () => null,
    car: null,
    captions: { set: (c) => void calls.push(`caption ${c?.text ?? "-"}`), dispose() {} },
    black: (a) => void calls.push(`black ${a}`),
    warn: (line) => void calls.push(`warn ${line}`),
    ...over,
  };
}

describe("the stage", () => {
  it("writes the camera, the depth of field, the caption and the black from the frame", () => {
    const d = deps();
    stageFrame(frame, d);
    expect(d.calls).toEqual(["cam 1,2,3 0.4 0.1 0.43 0.02", "dof true", "caption hello", "black 0.25"]);
  });

  it("poses a visible actor at its place and clip time, and hides one that is not", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode("ranger", scene);
    const pose = vi.fn();
    const instance = { root, pose, clipNames: () => ["Walk"], play() {}, setSpeed() {}, dispose() {} } as unknown as CharacterInstance;
    const d = deps({ actor: (id) => (id === "ranger.nathan" ? instance : null) });
    stageFrame(frame, d);
    expect(root.position.asArray()).toEqual([5, 6, 7]);
    expect(root.rotation.y).toBe(1.2);
    expect(root.isEnabled()).toBe(true);
    expect(pose).toHaveBeenCalledWith("walk", 0.75);
    stageFrame({ ...frame, actors: [{ ...frame.actors[0]!, visible: false }] }, d);
    expect(root.isEnabled()).toBe(false);
    engine.dispose();
  });

  it("stages a frame with no actor instance and logs once", () => {
    const d = deps();
    stageFrame(frame, d);
    stageFrame(frame, d);
    expect(d.calls.filter((c) => c.startsWith("warn"))).toEqual(["warn scene: no model for actor ranger.nathan; not drawn"]);
  });

  it("moves a car with no parts as a whole, and spins the wheels and swings the door where they exist", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const whole = new TransformNode("car", scene);
    const d = deps({ car: { root: whole, wheels: [], door: null } });
    stageFrame(frame, d);
    expect(whole.position.asArray()).toEqual([10, 11, 12]);
    expect(whole.rotation.y).toBe(3);
    const root = new TransformNode("car2", scene);
    const wheel = new TransformNode("wheel_fl", scene);
    wheel.parent = root;
    const door = new TransformNode("door_driver", scene);
    door.parent = root;
    const parts = carModelOf({ node: root, meshes: [], dispose() {} });
    expect(parts.wheels.length).toBe(1);
    expect(parts.door).toBe(door);
    stageFrame(frame, deps({ car: parts }));
    expect(wheel.rotation.x).toBe(2);
    expect(door.rotation.y).toBeCloseTo(-Math.PI / 3, 6);
    engine.dispose();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/captions.test.ts test/game/scene/sceneStage.test.ts`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write the panel and the stage**

```ts
// client/src/game/scene/captions.ts
/** The scene route's caption: one line under the picture, the text and
 * whether it is heard through the radio, written with `textContent` only. */
import type { Caption } from "./timeline.js";

export type CaptionPanel = { set(caption: Caption | null): void; dispose(): void };

const STYLE = `
  .scene-caption { position: absolute; left: 0; right: 0; bottom: 8vh; margin: 0 auto; max-width: 44ch; text-align: center; white-space: pre-line; color: #eee; font: 500 clamp(16px, 2.4vh, 26px)/1.35 system-ui, sans-serif; pointer-events: none; z-index: 30; }
  .scene-caption.radio { font-style: italic; }
  .scene-caption.radio::before { content: "Dispatch (radio): "; font-style: normal; opacity: 0.7; }
`;

export function createCaptionPanel(container: HTMLElement): CaptionPanel {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const node = document.createElement("div");
  node.className = "scene-caption";
  container.append(style, node);
  return {
    set(caption) {
      node.textContent = caption?.text ?? "";
      node.classList.toggle("radio", caption?.radio ?? false);
    },
    dispose() {
      node.remove();
      style.remove();
    },
  };
}
```

```ts
// client/src/game/scene/sceneStage.ts
/**
 * Applies one frame's description to what draws it: the renderer's free
 * camera, the actors' instances, the car's model, the caption and the
 * black. It decides nothing: every number comes from the frame. What is
 * missing (an actor's model, a car part) is said once and skipped, so the
 * scene plays with whatever has arrived.
 */
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { CharacterInstance } from "../characterModel.js";
import type { FreecamView } from "../renderer.js";
import type { PlacedModel } from "../staticModel.js";
import type { CaptionPanel } from "./captions.js";
import type { Frame } from "./timeline.js";

/** The car: the node the whole model moves by, and its named parts where
 * the model has them (`wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`, `door_driver`). */
export type CarModel = { root: TransformNode; wheels: readonly TransformNode[]; door: TransformNode | null };

export type StageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  actor(id: string): CharacterInstance | null;
  car: CarModel | null;
  captions: CaptionPanel;
  black(amount: number): void;
  warn(line: string): void;
};

const WHEEL_NAMES = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
const DOOR_NAME = "door_driver";
/** How far the driver's door swings when fully open (rad), outward. */
const DOOR_SWING = Math.PI / 1.5;

/** The car's parts by name under a placed model; none found, the whole model is the stand-in. */
export function carModelOf(placed: PlacedModel): CarModel {
  const under = placed.node.getChildTransformNodes(false);
  const byName = (name: string): TransformNode | null => under.find((n) => n.name === name || n.name.endsWith(`_${name}`)) ?? null;
  const wheels = WHEEL_NAMES.map(byName).filter((n): n is TransformNode => n !== null);
  return { root: placed.node, wheels, door: byName(DOOR_NAME) };
}

const warnedActors = new WeakMap<StageDeps, Set<string>>();

export function stageFrame(frame: Frame, deps: StageDeps): void {
  const c = frame.camera;
  deps.setFreecam({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, fov: c.fov, roll: c.roll });
  deps.setDepthOfField(c.dof);
  for (const a of frame.actors) {
    const instance = deps.actor(a.id);
    if (instance === null) {
      let warned = warnedActors.get(deps);
      if (warned === undefined) warnedActors.set(deps, (warned = new Set()));
      if (!warned.has(a.id)) {
        warned.add(a.id);
        deps.warn(`scene: no model for actor ${a.id}; not drawn`);
      }
      continue;
    }
    instance.root.setEnabled(a.visible);
    if (!a.visible) continue;
    instance.root.position.set(a.x, a.y, a.z);
    instance.root.rotation.y = a.yaw;
    instance.pose(a.clip, a.clipTime);
  }
  if (frame.car !== null && deps.car !== null) {
    const car = frame.car;
    deps.car.root.position.set(car.x, car.y, car.z);
    deps.car.root.rotation.y = car.yaw;
    for (const wheel of deps.car.wheels) wheel.rotation.x = car.wheelSpin;
    if (deps.car.door !== null) deps.car.door.rotation.y = -car.doorOpen * DOOR_SWING;
  }
  deps.captions.set(frame.caption);
  deps.black(frame.black);
}
```

The `warnedActors` map keyed by deps keeps "once" per stage without state in the pure function's signature; the route makes one `deps` for the scene's life.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene/captions.test.ts test/game/scene/sceneStage.test.ts && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/sceneStage.ts client/src/game/scene/captions.ts client/test/game/scene/sceneStage.test.ts client/test/game/scene/captions.test.ts
git commit -m "feat: the stage that applies a scene frame, and the caption panel"
```

---

### Task 9: The scene player

**Files:**
- Create: `client/src/game/scene/scenePlayer.ts`
- Test: `client/test/game/scene/scenePlayer.test.ts`

**Interfaces:**
- Consumes: `SceneClock` (Task 1), `evaluate`/`Scene` (Task 2), `stageFrame`/`StageDeps` (Task 8).
- Produces:

```ts
export type ScenePlayer = {
  /** Evaluates and stages the frame at the clock's time (or `at`); returns it. */
  tick(at?: number): Frame;
  seek(t: number): void;
  step(frame: number): void;
  hidden(on: boolean): void;
  time(): number;
  ended(): boolean;
  dispose(): void;
};
export function createScenePlayer(scene: Scene, clock: SceneClock, deps: StageDeps, onEnd?: () => void): ScenePlayer;
```

`tick` stages `evaluate(scene, clock.time())`; at the duration the clock is held there (the last frame stays) and `onEnd` fires once.

- [ ] **Step 1: Write the failing tests**

```ts
// client/test/game/scene/scenePlayer.test.ts
import { describe, expect, it, vi } from "vitest";
import { createSceneClock } from "../../../src/game/scene/sceneClock.js";
import { createScenePlayer } from "../../../src/game/scene/scenePlayer.js";
import type { Scene } from "../../../src/game/scene/timeline.js";
import type { StageDeps } from "../../../src/game/scene/sceneStage.js";

const scene: Scene = {
  duration: 10,
  camera: (t) => ({ x: t, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0.43, roll: 0, dof: false }),
  actors: [],
  car: null,
  captions: [],
  black: () => 0,
};

function deps(): StageDeps & { cams: number[] } {
  const cams: number[] = [];
  return { cams, setFreecam: (v) => void cams.push(v.x), setDepthOfField() {}, actor: () => null, car: null, captions: { set() {}, dispose() {} }, black() {}, warn() {} };
}

describe("the scene player", () => {
  it("stages the frame at the clock's time, and holds the last frame at the end, saying so once", () => {
    let ms = 0;
    const onEnd = vi.fn();
    const d = deps();
    const p = createScenePlayer(scene, createSceneClock(() => ms), d, onEnd);
    ms = 2500;
    expect(p.tick().t).toBe(2.5);
    ms = 12000;
    expect(p.tick().t).toBe(10);
    expect(p.ended()).toBe(true);
    ms = 20000;
    expect(p.tick().t).toBe(10);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(d.cams).toEqual([2.5, 10, 10]);
  });

  it("seeks and steps, a seek after the end playing on from there", () => {
    let ms = 0;
    const d = deps();
    const p = createScenePlayer(scene, createSceneClock(() => ms), d);
    p.step(48);
    ms = 9000;
    expect(p.tick().t).toBe(2);
    ms = 50000;
    p.tick();
    expect(p.ended()).toBe(false);
    p.seek(3);
    expect(p.tick().t).toBe(3);
  });

  it("holds while hidden", () => {
    let ms = 0;
    const p = createScenePlayer(scene, createSceneClock(() => ms), deps());
    ms = 1000;
    p.hidden(true);
    ms = 5000;
    expect(p.tick().t).toBe(1);
    p.hidden(false);
    ms = 6000;
    expect(p.tick().t).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/scenePlayer.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the player**

```ts
// client/src/game/scene/scenePlayer.ts
/**
 * Runs a scene: the clock's time → one frame → the stage. A frame is
 * staged on `tick`, which the route calls once an animation frame and a
 * recorder calls once a rendered frame. At the end the clock is held on the
 * last frame and `onEnd` is told once; a seek or a step moves it and plays
 * on. A hidden tab holds the clock.
 */
import { FPS, type SceneClock } from "./sceneClock.js";
import { stageFrame, type StageDeps } from "./sceneStage.js";
import { evaluate, type Frame, type Scene } from "./timeline.js";

export type ScenePlayer = {
  /** Evaluates and stages the frame at the clock's time (or at `at`, which also seeks); returns it. */
  tick(at?: number): Frame;
  seek(t: number): void;
  /** Frame `frame` at 24 frames a second, held. */
  step(frame: number): void;
  hidden(on: boolean): void;
  time(): number;
  ended(): boolean;
  dispose(): void;
};

export function createScenePlayer(scene: Scene, clock: SceneClock, deps: StageDeps, onEnd?: () => void): ScenePlayer {
  let isEnded = false;
  let told = false;
  const player: ScenePlayer = {
    tick(at) {
      if (at !== undefined) player.seek(at);
      let t = clock.time();
      if (t >= scene.duration && !isEnded) {
        isEnded = true;
        clock.seek(scene.duration);
        clock.hold();
        t = scene.duration;
        if (!told) {
          told = true;
          onEnd?.();
        }
      }
      const frame = evaluate(scene, t);
      stageFrame(frame, deps);
      return frame;
    },
    seek(t) {
      isEnded = false;
      clock.seek(t);
      if (clock.held()) clock.resume();
    },
    step(frame) {
      isEnded = false;
      clock.step(frame, FPS);
    },
    hidden: (on) => clock.hidden(on),
    time: () => clock.time(),
    ended: () => isEnded,
    dispose() {
      deps.captions.dispose();
    },
  };
  return player;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene/scenePlayer.test.ts && npm run typecheck && npm run lint`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/scenePlayer.ts client/test/game/scene/scenePlayer.test.ts
git commit -m "feat: the scene player: clock, frame, stage, the end, a seek and a step"
```

---

### Task 10: The scene route

**Files:**
- Modify: `client/src/game/router.ts:3-11,55-72` (the `scene` route), `client/src/main.ts` (the branch), `client/index.html` if the route needs no change (it does not: the SPA rewrite serves any path)
- Create: `client/src/game/scene/sceneRoute.ts` (the route's build: world, renderer, models, player, the global)
- Test: `client/test/game/router.test.ts` (append), `client/test/game/scene/sceneRoute.test.ts` (new, NullEngine)

**Interfaces:**
- Consumes: everything above.
- Produces: `Route` gains `{ kind: "scene"; name: "intro" }` for `/scene/intro`; `parseSceneSearch(search: string): { t: number | null; step: number | null }`;

```ts
export type SceneRun = { dispose(): void };
export type SceneRouteDeps = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  tier: QualityTier;
  engine?: AbstractEngine;
  now?: () => number;                          // the wall clock the running scene reads
  loadCar?: (scene: BabylonScene) => Promise<PlacedModel | null>;
  pool?: CharacterPool;
  raf?: (fn: (ms: number) => void) => number;  // requestAnimationFrame
};
export function startSceneRoute(deps: SceneRouteDeps, search: { t: number | null; step: number | null }): SceneRun;
export type DayhikeScene = { seek(t: number): void; frame(): Promise<void>; time(): number };
```

`startSceneRoute` builds the fixed world (`seedFromToken("hollow")`, `parseLevel(sandbox01)`, `createForest`, `createWorld(level, seed, false)`), the renderer at the page's tier with `clock` = the scene clock in ms (so grass and water step with the scene), sets `INTRO_HOUR` and `INTRO_WEATHER`, reads `IntroPlaces` off the sim (`activeTerrainVariant().trailGraph(seed)`, `trailheadPlaces(graph, roadCenterX, seed)`, `carYaw(places.car, graph.trailhead) === 0 ? 1 : -1`), makes the road (`centerX: (z) => roadCenterX(seed, z)`, `groundY: (x, z) => elevationAt(seed, x, z)`), loads the ranger through the pool and the car through `loadContainer` + `placeStaticModel` (the trailhead's own car model, `INTRO_CAR`), builds `StageDeps` (`setFreecam` → `renderer.setFreecam`; `setDepthOfField` → `renderer.setDepthOfField` — add it to the renderer in this task as a no-op on tiers with no post chain and the `DepthOfFieldEffect` toggle on high/medium if the post chain has one, else a no-op everywhere with a comment: depth of field is the asset side's concern at the record if the chain lacks it; `black` → a full-screen black `div.scene-black` whose `style.opacity` is the amount), runs a render loop: each animation frame `player.tick()` then `renderer.sync(world.state, -1, 0)` and `renderer.scene.render()`; `?t` seeks and `?step` steps before the first frame; `document.visibilitychange` → `player.hidden`; installs `window.dayhikeScene = { seek, frame, time }` where `frame()` stops the loop, ticks, syncs, renders once and resolves after `engine.onEndFrameObservable`; `dispose` removes the global, the listeners, the black, stops the loop and disposes the pool, the car and the renderer.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/router.test.ts` (find its `describe("parseRoute"` block and add beside its cases):

```ts
  it("parses the scene route, and the seek and the step out of its search", () => {
    expect(parseRoute("/dayhike/scene/intro")).toEqual({ kind: "scene", name: "intro" });
    expect(parseRoute("/dayhike/scene/other")).toEqual({ kind: "landing" });
    expect(parseSceneSearch("?t=12.5")).toEqual({ t: 12.5, step: null });
    expect(parseSceneSearch("?step=48")).toEqual({ t: null, step: 48 });
    expect(parseSceneSearch("?t=abc&step=-1")).toEqual({ t: null, step: null });
    expect(parseSceneSearch("")).toEqual({ t: null, step: null });
  });
```

(`parseRoute` takes the pathname with the base as the file's other tests pass it; match their form.)

```ts
// client/test/game/scene/sceneRoute.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>("@babylonjs/core/Engines/nullEngine.js");
  return { Engine: mod.NullEngine };
});

import "../../../src/sim/passes/index.js";
import { startSceneRoute } from "../../../src/game/scene/sceneRoute.js";
import { asHtml, installStandInDom } from "../helpers/standInDom.js";
import { timeLimit } from "../../helpers/timeLimit.js";

const nullCanvas = (): HTMLCanvasElement => ({ renderWidth: 1600, renderHeight: 900, clientWidth: 1600, clientHeight: 900 }) as unknown as HTMLCanvasElement;

describe("the scene route", () => {
  it("plays the intro on the fixed world with no local player, seeks, renders one frame on request, and leaves nothing behind", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    let ms = 0;
    const frames: ((ms: number) => void)[] = [];
    const run = startSceneRoute(
      { canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => ms, loadCar: async () => null, raf: (fn) => { frames.push(fn); return frames.length; } },
      { t: 20, step: null },
    );
    const api = (globalThis as { dayhikeScene?: { seek(t: number): void; frame(): Promise<void>; time(): number } }).dayhikeScene;
    expect(api).toBeDefined();
    expect(api?.time()).toBe(20);
    api?.seek(30.5);
    expect(api?.time()).toBe(30.5);
    await api?.frame();
    expect(container.querySelector("div.scene-caption")?.textContent).toBe("Four-one, be advised,\nradio won't carry past the road.");
    run.dispose();
    expect((globalThis as { dayhikeScene?: unknown }).dayhikeScene).toBeUndefined();
    expect(container.querySelector("div.scene-caption")).toBeNull();
    expect(container.querySelector("div.scene-black")).toBeNull();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));

  it("holds the frame the step names", () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    let ms = 0;
    const run = startSceneRoute(
      { canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => ms, loadCar: async () => null, raf: () => 0 },
      { t: null, step: 240 },
    );
    const api = (globalThis as { dayhikeScene?: { time(): number } }).dayhikeScene;
    ms = 90000;
    expect(api?.time()).toBe(10);
    run.dispose();
    vi.unstubAllGlobals();
  }, timeLimit(120_000));
});
```

The world's untouched state (§8.1): in the first case, before `run.dispose()`, add `expect(JSON.stringify(run.worldState())).toBe(before)` where `before` is taken right after `startSceneRoute` — expose `worldState()` on `SceneRun` for the test (it returns `world.state`).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/router.test.ts test/game/scene/sceneRoute.test.ts`
Expected: FAIL: the route kind and the module are missing.

- [ ] **Step 3: Write the route**

`router.ts`: add `| { kind: "scene"; name: "intro" }` to `Route`; in `parseRoute`, before the party match: `if (trimmed === "/scene/intro") return { kind: "scene", name: "intro" };`; export

```ts
/** The scene route's search: `?t=<seconds>` seeks, `?step=<frame>` holds a frame (24 a second); a bad value is none. */
export function parseSceneSearch(search: string): { t: number | null; step: number | null } {
  const q = new URLSearchParams(search);
  const num = (key: string): number | null => {
    const v = q.get(key);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return { t: num("t"), step: num("step") };
}
```

`client/src/game/scene/sceneRoute.ts`:

```ts
/**
 * The scene route: the staged intro on its fixed world, with no local
 * player, the way the title page's backdrop ran until the still replaced
 * it. `?t` seeks and `?step` holds a frame; `window.dayhikeScene` lets a
 * recorder seek and draw one frame at a time. Everything built here is
 * disposed on leaving the route.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { Scene as BabylonScene } from "@babylonjs/core/scene.js";
import sandbox01 from "../../../levels/sandbox01.json" with { type: "json" };
import { parseLevel } from "../../sim/level.js";
import { createForest } from "../../sim/forest.js";
import { createWorld } from "../../sim/world.js";
import type { WorldState } from "../../sim/types.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../sim/terrain.js";
import { trailheadPlaces } from "../../sim/trailhead.js";
import { createCharacterPool, type CharacterPool } from "../characterModel.js";
import { loadContainer, loadUntilAborted } from "../modelLoad.js";
import { modelUrl } from "../assetUrls.js";
import { placeStaticModel, type PlacedModel } from "../staticModel.js";
import { createRenderer, type QualityTier } from "../renderer.js";
import { seedFromToken } from "../seed.js";
import { carYaw } from "../trailheadMeshes.js";
import { createCaptionPanel } from "./captions.js";
import { INTRO_CAR, INTRO_HOUR, INTRO_RANGER, INTRO_SEED_TOKEN, INTRO_WEATHER, introScene } from "./intro.js";
import { createSceneClock, type SceneClock } from "./sceneClock.js";
import { createScenePlayer } from "./scenePlayer.js";
import { carModelOf, type CarModel, type StageDeps } from "./sceneStage.js";

export type DayhikeScene = { seek(t: number): void; frame(): Promise<void>; time(): number };
export type SceneRun = { dispose(): void; worldState(): WorldState };
export type SceneRouteDeps = {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  tier: QualityTier;
  engine?: AbstractEngine;
  now?: () => number;
  loadCar?: (scene: BabylonScene) => Promise<PlacedModel | null>;
  pool?: CharacterPool;
  raf?: (fn: (ms: number) => void) => number;
};

const BLACK_STYLE = "position:absolute;inset:0;background:#000;pointer-events:none;z-index:29;";

async function loadTrailheadCar(scene: BabylonScene, signal: AbortSignal): Promise<PlacedModel | null> {
  try {
    const container = await loadUntilAborted(() => loadContainer(modelUrl(`models/${INTRO_CAR}.glb`), scene), signal);
    return placeStaticModel(container, INTRO_CAR, 0, 0, 0, 0);
  } catch (error) {
    if (!signal.aborted) console.warn(`scene: the car did not load (${error instanceof Error ? error.message : String(error)}); its boxes stand in`);
    return null;
  }
}

export function startSceneRoute(deps: SceneRouteDeps, search: { t: number | null; step: number | null }): SceneRun {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  const now = deps.now ?? (() => performance.now());
  const raf = deps.raf ?? ((fn) => requestAnimationFrame(fn));
  const seed = seedFromToken(INTRO_SEED_TOKEN);
  const level = parseLevel(sandbox01);
  const forest = createForest(seed);
  const world = createWorld(level, seed, false);
  const clock: SceneClock = createSceneClock(now);
  const renderer = createRenderer(deps.canvas, level, forest, { tier: deps.tier, engine: deps.engine, clock: () => clock.time() * 1000 });
  renderer.setWeather(INTRO_WEATHER, 0);
  renderer.setHour(INTRO_HOUR);

  const variant = activeTerrainVariant();
  const graph = variant.trailGraph?.(seed);
  const roadCenterX = variant.roadCenterX;
  if (graph === undefined || roadCenterX === undefined) throw new Error("the scene's world has no road or trail");
  const places = trailheadPlaces(graph, roadCenterX, seed);
  const road = { centerX: (z: number) => roadCenterX(seed, z), groundY: (x: number, z: number) => elevationAt(seed, x, z) };
  const scene = introScene(road, {
    car: places.car,
    start: places.start,
    board: places.board,
    direction: carYaw(places.car, graph.trailhead) === 0 ? 1 : -1,
  });

  const loads = new AbortController();
  const pool = deps.pool ?? createCharacterPool();
  let disposed = false;
  void pool.load(renderer.scene, [INTRO_RANGER]);
  let car: CarModel | null = null;
  let carModel: PlacedModel | null = null;
  void (deps.loadCar ?? ((s) => loadTrailheadCar(s, loads.signal)))(renderer.scene).then((placed) => {
    if (placed === null || disposed) {
      placed?.dispose();
      return;
    }
    carModel = placed;
    car = carModelOf(placed);
    // `stage` is made below, before this promise can resolve.
    stage.car = car;
    for (const mesh of placed.meshes) renderer.shadows.add(mesh);
  });

  const black = document.createElement("div");
  black.className = "scene-black";
  black.setAttribute("style", BLACK_STYLE);
  black.style.opacity = "1";
  deps.container.append(black);
  const captions = createCaptionPanel(deps.container);
  const stage: StageDeps = {
    setFreecam: (view) => renderer.setFreecam(view),
    setDepthOfField: (on) => renderer.setDepthOfField(on),
    actor: (id) => pool.acquire(1, id),
    car,
    captions,
    black: (amount) => {
      black.style.opacity = String(amount);
    },
    warn: (line) => console.warn(line),
  };
  const player = createScenePlayer(scene, clock, stage);
  if (search.step !== null) player.step(search.step);
  else if (search.t !== null) player.seek(search.t);

  let looping = search.step === null;
  const drawOnce = (): void => {
    player.tick();
    renderer.sync(world.state, -1, 0);
    renderer.scene.render();
  };
  const loop = (): void => {
    if (disposed || !looping) return;
    drawOnce();
    raf(loop);
  };
  raf(loop);

  const onVisibility = (): void => player.hidden(document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  const onResize = (): void => renderer.resize();
  window.addEventListener("resize", onResize);

  const api: DayhikeScene = {
    seek: (t) => {
      player.seek(t);
      clock.hold();
    },
    frame: () =>
      new Promise<void>((resolve) => {
        looping = false;
        const observer = renderer.engine.onEndFrameObservable.addOnce(() => resolve());
        drawOnce();
        void observer;
      }),
    time: () => player.time(),
  };
  (globalThis as { dayhikeScene?: DayhikeScene }).dayhikeScene = api;

  return {
    worldState: () => world.state,
    dispose() {
      if (disposed) return;
      disposed = true;
      loads.abort();
      delete (globalThis as { dayhikeScene?: DayhikeScene }).dayhikeScene;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      player.dispose();
      black.remove();
      pool.dispose();
      carModel?.dispose();
      renderer.dispose();
    },
  };
}
```

`renderer.ts` gains `setDepthOfField(on: boolean): void` on the `Renderer` type and object: on a renderer whose post chain has a depth-of-field effect, toggles it; otherwise a no-op (`client/src/game/post.ts` — check whether the chain has one; today it does not, so the renderer's method is `setDepthOfField() { /* the post chain has no depth of field today; the insert's blur is the record's */ }` with a test only that it exists and does not throw). `renderer.shadows` is `{ add, remove }` (`PropShadows`); the car's meshes are added as the body's are.

`main.ts`: in `render`, after `container.replaceChildren()` and before the landing branch:

```ts
  if (route.kind === "scene") {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    const scene = startSceneRoute({ canvas, container, tier: currentChoice().tier ?? "high" }, parseSceneSearch(location.search));
    running = { dispose: () => scene.dispose() };
    return;
  }
```

(`currentChoice()` is the saved tier choice; where it is Auto, use `"high"`: the film is made on the high tier. The scene route uses no WebGPU engine here — the WebGL2 engine `createRenderer` makes — so the record's engine is the WebGL2 one until the WebGPU start is given a place in this route, which the verification note records as owed.)

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npx vitest run --root client test/game/router.test.ts test/game/scene/sceneRoute.test.ts test/game/rendererFilmCamera.test.ts && npm run typecheck && npm run lint`
Expected: all pass; the caption at 30.5 s reads line 9's first caption.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/router.ts client/src/game/scene/sceneRoute.ts client/src/game/renderer.ts client/src/main.ts client/test/game/router.test.ts client/test/game/scene/sceneRoute.test.ts
git commit -m "feat: the scene route: the staged intro on its world, seekable and frame-steppable"
```

---

### Task 11: The sim untouched by a scene frame, and the architecture pins

**Files:**
- Modify: `client/test/game/scene/sceneRoute.test.ts` (the world-state case, if not folded into Task 10), `client/test/architecture.test.ts` (append)

**Interfaces:**
- Consumes: `SceneRun.worldState()` (Task 10).

- [ ] **Step 1: Write the failing test**

Append to `client/test/architecture.test.ts`, in its layering block:

```ts
  it("keeps the scene player pure of Babylon but its stage, and out of the sim's writes", () => {
    const dir = "client/src/game/scene";
    for (const pure of ["timeline.ts", "shots.ts", "roadPath.ts", "sceneClock.ts", "intro.ts", "scenePlayer.ts"]) {
      const src = readFileSync(`${dir}/${pure}`, "utf8");
      expect(src, pure).not.toMatch(/from "@babylonjs/);
    }
    const route = readFileSync(`${dir}/sceneRoute.ts`, "utf8");
    expect(route).toContain("createWorld(level, seed, false)");
    expect(route).toContain("renderer.sync(world.state, -1, 0)");
    expect(route).not.toMatch(/world\.(step|apply|input)/);
  });
```

(Use the file's own way of reading sources — it has a helper; match it.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/architecture.test.ts`
Expected: PASS already if Tasks 1–10 are as written — then the test pins them; if it fails, the file it names imports Babylon and the fix is in that file, not the test.

- [ ] **Step 3: Commit**

```bash
git add client/test/architecture.test.ts
git commit -m "test: pin the scene player's pure files and the route's read-only world"
```

---

### Task 12: The look at the route, and the note

**Files:**
- Create: `docs/gameplay/2026-09-30-intro-staging-verification.md`
- Modify (numbers only, if the look asks): `client/src/game/scene/intro.ts`

- [ ] **Step 1: The whole suite**

Run: `npm run typecheck && npm run lint && npm test` (on a quiet machine; rerun timed-out files serially at `TEST_TIME_SCALE=3`).
Expected: clean.

- [ ] **Step 2: The look**

Start the dev stack (`PORT=8080 ALLOWED_ORIGINS=http://localhost:5173 npm run dev`), open `http://localhost:5173/dayhike/scene/intro?tier=high` in the browser, and record, with a screenshot at the middle of each of the eight shots (`?step=<n>` at n = 108, 288, 480, 660, 792, 948, 1116, 1320):

1. Each shot frames what §3 says: the wide from the sea with the car small and no trailhead; the road from the sea side; the cab; the handset; the shoulder; the wide by the board; the door and the ranger facing the trail; the push onto the trail with the board in view. Where a shot frames wrong, change the numbers in `intro.ts` (never the sim), re-run `intro.test.ts`, and record the change.
2. `dayhikeScene.seek(30.5)` then `dayhikeScene.frame()` resolves and the caption reads line 9; `dayhikeScene.time()` is 30.5 after; `frame()` twice gives the same picture (a screenshot's bytes equal).
3. `?step=480` holds frame 480 (20 s): the caption is line 3 and nothing moves over five seconds.
4. The car slides along the road (no wheel spin, no door: today's model has no parts) and stops beside the board at 43 s; the ranger appears at the door at 43.5 s, walks to the spawn and stands facing the trail by 48.5 s.
5. The tab hidden and shown holds and resumes at the same time (`dayhikeScene.time()` before and after).
6. Leaving the route (Back) leaves no canvas and no `dayhikeScene`; the title page renders.
7. The grass and the water move with a seek: `seek(10)` and `seek(10.5)` differ, `seek(10)` twice does not.

- [ ] **Step 3: Write the note and commit it alone**

The note names the commit, the browser and its renderer string, each check met or missed with what was seen, the shot numbers changed and why, and what is owed: the WebGPU engine on the route, the parts and clips once the assets arrive, the summit scene's own needs.

```bash
git add docs/gameplay/2026-09-30-intro-staging-verification.md client/src/game/scene/intro.ts
git commit -m "docs: record the intro's staging as it looks on the scene route"
```

---

## Self-review

- **Spec coverage.** §2 files: `timeline.ts` (T2), `shots.ts` (T3), `roadPath.ts` (T4), `sceneClock.ts` (T1), `captions.ts` and `sceneStage.ts` (T8), `scenePlayer.ts` (T9), `intro.ts` (T5). §2 changes: the renderer's fov, roll and clock (T6); `characterModel.ts` posing by name and time (T7) — mouth and face shapes by weight are left until a model has them (the asset side's §1 dropped the face rig for the intro; the summit scene's spec adds it); the car's parts (T8, with today's whole-model stand-in); the route, `?t`, `?step`, `dayhikeScene` (T10). §2 failure handling: the missing clip (T7), the missing actor and parts (T8), the hidden tab (T1, T9). §3: the setting (T5's constants), the shots (T5, tuned in T12), the script's captions on the scene's track (T5). §6: `frame()` and the stepped clock (T10). §8.1: every bullet but the catalog's `bytes` (the asset side's export, as part 1's plan noted); the sim untouched (T10/T11). §9: no `client/src/sim/` change (T11 pins the route reads only).
- **Placeholders.** None. Task 4's first `roadPose` block is a struck mistake with the plain one after it; Task 7's step 1 names the check on `createCharacterPool`'s options before the test is trusted.
- **Type consistency.** `CameraPose`/`Frame`/`Scene`/`Caption` (T2) are what T3, T5, T8, T9 consume; `Road` (T4) is T5's and T10's; `IntroPlaces` (T5) is T10's; `FreecamView.fov/roll` (T6) is T8's; `pose`/`clipNames` (T7) is T8's; `StageDeps`/`CarModel` (T8) is T9's and T10's; `ScenePlayer` (T9) is T10's; `SceneRun.worldState` (T10) is T11's.
- **Review Focus.** 1 → T2 "clamps t" and T10's `parseSceneSearch` case; 2 → T8 "stages a frame with no actor instance and logs once"; 3 → T8 "moves a car with no parts as a whole"; 4 → T1 "holds while hidden" and T9 "holds while hidden"; 5 → T10 "leaves nothing behind".
