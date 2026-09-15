# Mobile Touch Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone or tablet can play a full Day Hike match through a touch layer that feeds the existing input sampler, with an in-world interact prompt on every device.

**Architecture:** A pure touch model (`game/touchControls.ts`) turns pointer events into move axes, a look delta, button bits and paint state; a DOM layer paints it. The input sampler gains an "engaged" state that generalises pointer lock and merges the touch source into `sample()`. An interact prompt model resolves what is in reach on both sessions and a DOM renderer floats it at the object. The roster hides while engaged on touch and the landing gets a phone-width layout.

**Tech Stack:** TypeScript strict, Vite 8, Vitest 4 (node environment, no DOM tests), Babylon.js 9 (`Vector3.Project`), Pointer Events.

**Spec:** `docs/input/2026-09-15-mobile-controls.md`

## Global Constraints

- `client/src/sim/` gains nothing and imports nothing outside itself; `client/src/net/` never imports `client/src/game/` (`client/test/architecture.test.ts` enforces both).
- UI renderers use DOM APIs and `textContent` only, never `innerHTML`; each renderer's CSS is a `STYLE` template literal with no backtick inside.
- Every UI screen is a pure model (tested) plus a dumb renderer (untested): decisions live in the model.
- One source of "paused": the sampler's `engaged` state. Nothing else decides whether the pause menu is up.
- Numbers from the spec, verbatim: stick zone `0.45` of width, stick radius `60` px, dead zone `0.15`, double-tap window `300` ms, tap hold `250` ms, tap travel `10` px, look rate `0.0045` rad/px, idle after `3000` ms, idle opacity `0.35`, safe-area insets on every edge.
- Run from the worktree root `/Users/csarko/Projects/game-dayhike/.claude/worktrees/mobile-controls`: `npx vitest run --root client <path>` for a file, `npx tsc -p client --noEmit` for types, `npx eslint .` for lint. `node_modules` is a symlink to the main checkout's.
- Commit messages follow `.agents/skills/github-push/SKILL.md`: `<type>: <subject>`, a `## What` paragraph, a `## How` list led by file paths, and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Stage explicit paths, never `git add -A`.
- Never kill processes you did not start; never start a dev server or a browser (the controller runs the browser gates).

---

## File map

| File | Responsibility |
| --- | --- |
| `client/src/game/platform.ts` | `isTouchDevice(facts)` beside the other user-agent helpers |
| `client/src/game/touchControls.ts` | `createTouchModel` (pure: roles, stick, look, gestures, edges, idle) and `createTouchLayer` (DOM paint + pointer capture) |
| `client/src/game/input.ts` | engaged state, `onEngagedChange`, `engage`/`disengage`, `setTouchMode`, touch source merged into `sample()` |
| `client/src/game/interactPrompt.ts` | `promptModel` (pure) and `createInteractPrompt` (DOM) |
| `client/src/game/renderer.ts` | `project(pos)` world to CSS pixels |
| `client/src/net/clientSession.ts` | `readonly world` |
| `client/src/app.ts` | wires the touch model and layer, the prompt, `registerInteractables`, visibility disengage |
| `client/src/game/rosterModel.ts`, `roster.ts` | `touch` input, `"hidden"` presence, `share` flag and Share button |
| `client/src/game/landingModel.ts`, `landing.ts` | touch downloads note, phone-width CSS |
| `client/src/main.ts` | passes `touch` to the roster and landing models |

---

### Task 1: Touch detection

**Files:**
- Modify: `client/src/game/platform.ts`
- Test: `client/test/game/platform.test.ts`

**Interfaces:**
- Produces: `isTouchDevice(facts?: { coarsePointer: boolean; maxTouchPoints: number }): boolean`. With no argument it reads `matchMedia("(pointer: coarse)").matches` and `navigator.maxTouchPoints`, guarded so a missing `matchMedia` (vitest) reads as false.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/platform.test.ts`:

```ts
import { isTouchDevice } from "../../src/game/platform.js";

describe("isTouchDevice", () => {
  it("needs a coarse primary pointer and at least one touch point", () => {
    expect(isTouchDevice({ coarsePointer: true, maxTouchPoints: 5 })).toBe(true);
  });
  it("is false for a mouse-driven desktop", () => {
    expect(isTouchDevice({ coarsePointer: false, maxTouchPoints: 0 })).toBe(false);
  });
  it("is false for a touch laptop whose primary pointer is fine", () => {
    // Such a machine still gets the layer on its first real touch (the layer's
    // own fallback); the probe only decides the starting state.
    expect(isTouchDevice({ coarsePointer: false, maxTouchPoints: 10 })).toBe(false);
  });
  it("is false for a coarse pointer with no touch points, such as a TV remote", () => {
    expect(isTouchDevice({ coarsePointer: true, maxTouchPoints: 0 })).toBe(false);
  });
  it("reads false with no browser at all", () => {
    expect(isTouchDevice()).toBe(false);
  });
});
```

Merge the import into the existing import line from `platform.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/platform.test.ts`
Expected: FAIL, `isTouchDevice` is not exported.

- [ ] **Step 3: Implement**

Append to `client/src/game/platform.ts`:

```ts
export type TouchFacts = { coarsePointer: boolean; maxTouchPoints: number };

/**
 * Whether this device should start with the touch layer up. A coarse primary
 * pointer AND a touch point: a coarse pointer alone is a TV remote, touch
 * points alone are a touch laptop that should keep its mouse. The layer's own
 * first-touch fallback covers what this deliberately says no to.
 *
 * A different question from the quality tier's `mobile` (device class, by
 * user agent): a touch Windows laptop should keep its tier.
 */
export function isTouchDevice(facts: TouchFacts = browserTouchFacts()): boolean {
  return facts.coarsePointer && facts.maxTouchPoints > 0;
}

function browserTouchFacts(): TouchFacts {
  const g = globalThis as { matchMedia?: (q: string) => { matches: boolean }; navigator?: { maxTouchPoints?: number } };
  return {
    coarsePointer: g.matchMedia?.("(pointer: coarse)").matches ?? false,
    maxTouchPoints: g.navigator?.maxTouchPoints ?? 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root client test/game/platform.test.ts`
Expected: PASS, all `isTouchDevice` cases green.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/platform.ts client/test/game/platform.test.ts
git commit -m "feat: detect touch devices beside the other platform probes" -m "## What

The touch layer needs to know whether to start up. A coarse primary pointer with at least one touch point means a phone or tablet; a touch laptop keeps its mouse and gets the layer on its first real touch instead.

## How

- \`client/src/game/platform.ts\` — \`isTouchDevice(facts)\`, pure over injected facts, reading matchMedia and maxTouchPoints by default and false without a browser.
- \`client/test/game/platform.test.ts\` — the four combinations and the no-browser case.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Touch model — roles, stick and look

**Files:**
- Create: `client/src/game/touchControls.ts`
- Test: `client/test/game/touchControls.test.ts`

**Interfaces:**
- Produces:

```ts
export type TouchPointer = { id: number; x: number; y: number; hit: "canvas" | "lamp" | "pause" };
export type Viewport = { width: number; height: number };
export type TouchSource = {
  readonly moveX: number;
  readonly moveZ: number;
  takeLook(): { yaw: number; pitch: number };
  takeButtons(): number;
  readonly sprinting: boolean;
};
export type TouchState = {
  stick: { anchorX: number; anchorY: number; dx: number; dy: number } | null;
  lampPressed: boolean;
  pausePressed: boolean;
  lampOn: boolean;
  idle: boolean;
};
export type TouchModel = TouchSource & {
  readonly state: TouchState;
  down(p: TouchPointer, nowMs: number): void;
  move(id: number, x: number, y: number, nowMs: number): void;
  up(id: number, nowMs: number): void;
  cancel(id: number, nowMs: number): void;
  interactDown(): void;
  interactUp(): void;
  setLampOn(on: boolean): void;
  resize(viewport: Viewport): void;
  tick(nowMs: number): void;
};
export function createTouchModel(viewport: Viewport, hooks: { onPause(): void }): TouchModel;
export const STICK_ZONE = 0.45, STICK_RADIUS = 60, DEAD_ZONE = 0.15, LOOK_RATE = 0.0045,
  DOUBLE_TAP_MS = 300, TAP_MAX_MS = 250, TAP_MAX_TRAVEL = 10, IDLE_AFTER_MS = 3000;
```

Task 3 adds the gestures and edges inside the same functions; this task lands roles, the stick, look accumulation, and `cancel`.

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/touchControls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createTouchModel,
  STICK_RADIUS,
  LOOK_RATE,
  type TouchModel,
} from "../../src/game/touchControls.js";

const VIEW = { width: 800, height: 400 };

function model(onPause = () => undefined): TouchModel {
  return createTouchModel(VIEW, { onPause });
}

describe("stick", () => {
  it("anchors where the first finger lands in the left 45% and reads zero until it moves", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    expect(m.state.stick).toEqual({ anchorX: 100, anchorY: 300, dx: 0, dy: 0 });
    expect(m.moveX).toBe(0);
    expect(m.moveZ).toBe(0);
  });

  it("does not anchor on a finger that lands right of the zone", () => {
    const m = model();
    m.down({ id: 1, x: 400, y: 300, hit: "canvas" }, 0); // 0.5 * width
    expect(m.state.stick).toBeNull();
  });

  it("maps the thumb offset to axes over the radius, screen-up being forward", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 100 + STICK_RADIUS, 300 - STICK_RADIUS, 16);
    // Diagonal at the rim: magnitude clamps to 1, direction kept.
    expect(m.moveX).toBeCloseTo(Math.SQRT1_2, 5);
    expect(m.moveZ).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("reads zero inside the dead zone and ramps from its edge", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 100 + STICK_RADIUS * 0.1, 300, 16);
    expect(m.moveX).toBe(0);
    m.move(1, 100 + STICK_RADIUS * 0.575, 300, 32); // halfway between dead zone and rim
    expect(m.moveX).toBeCloseTo(0.5, 5);
  });

  it("stops the drawn thumb at the rim while the finger keeps going", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 100 + STICK_RADIUS * 3, 300, 16);
    expect(m.state.stick?.dx).toBeCloseTo(STICK_RADIUS, 5);
    expect(m.moveX).toBeCloseTo(1, 5);
  });

  it("clears on up and on cancel", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.move(1, 150, 300, 16);
    m.up(1, 32);
    expect(m.state.stick).toBeNull();
    expect(m.moveX).toBe(0);
    m.down({ id: 2, x: 100, y: 300, hit: "canvas" }, 40);
    m.move(2, 150, 300, 48);
    m.cancel(2, 56);
    expect(m.state.stick).toBeNull();
    expect(m.moveX).toBe(0);
  });

  it("gives a second finger in the zone the look role while the stick is held", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.down({ id: 2, x: 200, y: 300, hit: "canvas" }, 10);
    m.move(2, 300, 300, 20);
    expect(m.state.stick?.anchorX).toBe(100);
    expect(m.takeLook().yaw).toBeCloseTo(100 * LOOK_RATE, 9);
  });
});

describe("look", () => {
  it("accumulates drag in radians and drains once", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.move(1, 650, 180, 16);
    m.move(1, 660, 180, 32);
    expect(m.takeLook()).toEqual({ yaw: 60 * LOOK_RATE, pitch: -20 * LOOK_RATE });
    expect(m.takeLook()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("keeps a released finger from moving the camera", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 16);
    m.move(1, 700, 200, 32);
    expect(m.takeLook()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("tracks pointers by id, so a stick thumb and a look finger never swap", () => {
    const m = model();
    m.down({ id: 7, x: 100, y: 300, hit: "canvas" }, 0);
    m.down({ id: 9, x: 600, y: 200, hit: "canvas" }, 5);
    m.move(9, 620, 200, 10);
    m.move(7, 130, 300, 10);
    expect(m.state.stick?.dx).toBe(30);
    expect(m.takeLook().yaw).toBeCloseTo(20 * LOOK_RATE, 9);
  });
});

describe("resize", () => {
  it("re-evaluates the stick zone against the new width", () => {
    const m = model();
    m.resize({ width: 400, height: 800 });
    m.down({ id: 1, x: 190, y: 700, hit: "canvas" }, 0); // 0.475 of 400: outside
    expect(m.state.stick).toBeNull();
    m.up(1, 5);
    m.down({ id: 2, x: 170, y: 700, hit: "canvas" }, 10); // 0.425: inside
    expect(m.state.stick?.anchorX).toBe(170);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/touchControls.test.ts`
Expected: FAIL, cannot resolve `../../src/game/touchControls.js`.

- [ ] **Step 3: Implement the model**

Create `client/src/game/touchControls.ts`:

```ts
import { Button } from "../sim/types.js";

/** Fraction of the viewport width, from the left, that anchors the stick. */
export const STICK_ZONE = 0.45;
/** Thumb travel from the anchor that reads as full deflection, CSS px. */
export const STICK_RADIUS = 60;
/** Fraction of the radius inside which the stick reads zero. */
export const DEAD_ZONE = 0.15;
/** Radians per CSS px of drag: about twice the mouse rate. */
export const LOOK_RATE = 0.0045;
/** A second down inside this window of the previous one is a double tap. */
export const DOUBLE_TAP_MS = 300;
/** A press held longer than this is not a tap. */
export const TAP_MAX_MS = 250;
/** A press that travels further than this is a drag, not a tap. */
export const TAP_MAX_TRAVEL = 10;
/** Without a touch for this long the layer fades to its idle level. */
export const IDLE_AFTER_MS = 3000;

export type TouchPointer = { id: number; x: number; y: number; hit: "canvas" | "lamp" | "pause" };
export type Viewport = { width: number; height: number };

/** What the input sampler reads from touch, alongside keys and the mouse. */
export type TouchSource = {
  /** Move axes in [-1, 1], already dead-zoned. Right is +X, screen-up is +Z. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Look accumulated since the last drain, in radians. Zeroed by the call. */
  takeLook(): { yaw: number; pitch: number };
  /** Held bits plus any latched edges; edges clear once taken. */
  takeButtons(): number;
  readonly sprinting: boolean;
};

/** What the layer paints. Read every frame; never mutated by the layer. */
export type TouchState = {
  stick: { anchorX: number; anchorY: number; dx: number; dy: number } | null;
  lampPressed: boolean;
  pausePressed: boolean;
  lampOn: boolean;
  idle: boolean;
};

export type TouchModel = TouchSource & {
  readonly state: TouchState;
  down(p: TouchPointer, nowMs: number): void;
  move(id: number, x: number, y: number, nowMs: number): void;
  up(id: number, nowMs: number): void;
  /** The browser took the pointer (a system gesture, a tab switch): same as up. */
  cancel(id: number, nowMs: number): void;
  /** The in-world prompt was pressed: an Interact edge now, and the bit while held. */
  interactDown(): void;
  interactUp(): void;
  /** The local player's lamp, so the layer can draw the lit ring. */
  setLampOn(on: boolean): void;
  resize(viewport: Viewport): void;
  /** Advances the idle clock. Once a frame. */
  tick(nowMs: number): void;
};

type Role =
  | { kind: "stick" }
  | { kind: "look"; downX: number; downY: number; lastX: number; lastY: number; downAt: number; dragged: boolean; jumped: boolean }
  | { kind: "lamp" }
  | { kind: "pause" };

/**
 * The pure half of the touch controls: pointer events in, axes, look, button
 * bits and paint state out. No DOM, no clock of its own — every call carries
 * `nowMs` so the double-tap windows and the idle fade are testable.
 */
export function createTouchModel(viewport: Viewport, hooks: { onPause(): void }): TouchModel {
  let width = viewport.width;
  const roles = new Map<number, Role>();
  const state: TouchState = { stick: null, lampPressed: false, pausePressed: false, lampOn: false, idle: false };

  let moveX = 0;
  let moveZ = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  let sprinting = false;
  let latched = 0;
  let interactHeld = false;
  let lastStickDownAt = -Infinity;
  let lastTapDownAt = -Infinity;
  let lastTouchAt = -Infinity;

  function stickAxes(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    // The thumb stops at the rim; the finger may keep going.
    const scale = dist > 0 ? clamped / dist : 0;
    state.stick = state.stick && { ...state.stick, dx: dx * scale, dy: dy * scale };
    const t = clamped / STICK_RADIUS;
    if (t <= DEAD_ZONE) {
      moveX = 0;
      moveZ = 0;
      return;
    }
    // The edge of the dead zone reads as 0 and the rim as 1.
    const mag = (t - DEAD_ZONE) / (1 - DEAD_ZONE);
    moveX = (dx / dist) * mag;
    moveZ = (-dy / dist) * mag;
  }

  function endStick(): void {
    state.stick = null;
    moveX = 0;
    moveZ = 0;
    sprinting = false;
  }

  function release(id: number, nowMs: number, cancelled: boolean): void {
    const role = roles.get(id);
    if (role === undefined) return;
    roles.delete(id);
    if (role.kind === "stick") endStick();
    else if (role.kind === "lamp") {
      state.lampPressed = false;
      if (!cancelled) latched |= Button.Lamp;
    } else if (role.kind === "pause") {
      state.pausePressed = false;
      if (!cancelled) hooks.onPause();
    } else if (role.kind === "look" && !cancelled && !role.jumped) {
      if (nowMs - role.downAt <= TAP_MAX_MS && !role.dragged) lastTapDownAt = role.downAt;
    }
  }

  return {
    get moveX() {
      return moveX;
    },
    get moveZ() {
      return moveZ;
    },
    get sprinting() {
      return sprinting;
    },
    get state() {
      return state;
    },
    takeLook() {
      const out = { yaw: lookYaw, pitch: lookPitch };
      lookYaw = 0;
      lookPitch = 0;
      return out;
    },
    takeButtons() {
      let bits = latched;
      latched = 0;
      if (sprinting) bits |= Button.Sprint;
      if (interactHeld) bits |= Button.Interact;
      return bits;
    },
    down(p, nowMs) {
      lastTouchAt = nowMs;
      state.idle = false;
      if (p.hit === "lamp") {
        roles.set(p.id, { kind: "lamp" });
        state.lampPressed = true;
        return;
      }
      if (p.hit === "pause") {
        roles.set(p.id, { kind: "pause" });
        state.pausePressed = true;
        return;
      }
      if (state.stick === null && p.x < width * STICK_ZONE) {
        roles.set(p.id, { kind: "stick" });
        state.stick = { anchorX: p.x, anchorY: p.y, dx: 0, dy: 0 };
        // A second stick down inside the window is "double-tap and hold": sprint
        // for as long as this finger stays down.
        sprinting = nowMs - lastStickDownAt <= DOUBLE_TAP_MS;
        lastStickDownAt = nowMs;
        return;
      }
      const jumped = nowMs - lastTapDownAt <= DOUBLE_TAP_MS;
      if (jumped) {
        latched |= Button.Jump;
        // Consumed: a third tap starts a new pair rather than jumping again.
        lastTapDownAt = -Infinity;
      }
      roles.set(p.id, { kind: "look", downX: p.x, downY: p.y, lastX: p.x, lastY: p.y, downAt: nowMs, dragged: false, jumped });
    },
    move(id, x, y, nowMs) {
      const role = roles.get(id);
      if (role === undefined) return;
      lastTouchAt = nowMs;
      if (role.kind === "stick" && state.stick !== null) {
        stickAxes(x - state.stick.anchorX, y - state.stick.anchorY);
      } else if (role.kind === "look") {
        lookYaw += (x - role.lastX) * LOOK_RATE;
        lookPitch += (y - role.lastY) * LOOK_RATE;
        role.lastX = x;
        role.lastY = y;
        if (Math.hypot(x - role.downX, y - role.downY) > TAP_MAX_TRAVEL) role.dragged = true;
      }
    },
    up(id, nowMs) {
      release(id, nowMs, false);
    },
    cancel(id, nowMs) {
      release(id, nowMs, true);
    },
    interactDown() {
      latched |= Button.Interact;
      interactHeld = true;
    },
    interactUp() {
      interactHeld = false;
    },
    setLampOn(on) {
      state.lampOn = on;
    },
    resize(next) {
      width = next.width;
    },
    tick(nowMs) {
      state.idle = nowMs - lastTouchAt > IDLE_AFTER_MS;
    },
  };
}
```

The look role carries its last position so each move is a delta against the previous one, and `dragged` flips once the finger has travelled past `TAP_MAX_TRAVEL` from where it landed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root client test/game/touchControls.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc -p client --noEmit && npx eslint client/src/game/touchControls.ts client/test/game/touchControls.test.ts`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/touchControls.ts client/test/game/touchControls.test.ts
git commit -m "feat: touch model with a floating stick and drag look" -m "## What

The pure half of the phone controls: pointer events in, move axes and a look delta out. A thumb landing in the left 45% of the screen anchors a floating stick with a dead zone and a 60 px rim; any other finger drags the camera. Roles are by pointer id so two fingers never swap jobs.

## How

- \`client/src/game/touchControls.ts\` — \`createTouchModel\`: roles per pointer, stick anchoring and dead-zone remap, look accumulated in radians and drained once, cancel handled like up, plus the edge latch and idle clock the next task fills in.
- \`client/test/game/touchControls.test.ts\` — anchoring, zone boundary, axis mapping, dead zone, rim clamp, release, multi-touch by id, drain-once, resize.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Touch model — sprint, jump, lamp, pause, interact and idle

**Files:**
- Modify: `client/src/game/touchControls.ts` (behaviour already sketched in Task 2; this task pins it with tests and fixes anything the tests reveal)
- Test: `client/test/game/touchControls.test.ts`

**Interfaces:**
- Consumes: `createTouchModel`, `Button` bits from `client/src/sim/types.ts` (`Interact = 1, Jump = 2, Sprint = 8, Lamp = 16`).
- Produces: the gesture semantics every later task relies on: `takeButtons()` carries `Button.Sprint` while sprinting and `Button.Interact` while the prompt is held; `Button.Jump` and `Button.Lamp` are edges taken once.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/touchControls.test.ts`:

```ts
import { Button } from "../../src/sim/types.js";
import { DOUBLE_TAP_MS, TAP_MAX_MS, TAP_MAX_TRAVEL, IDLE_AFTER_MS } from "../../src/game/touchControls.js";

describe("sprint: double-tap and hold the stick", () => {
  it("sprints while the second stick finger stays down, inside the window", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.up(1, 80);
    m.down({ id: 2, x: 110, y: 300, hit: "canvas" }, 200);
    expect(m.sprinting).toBe(true);
    expect(m.takeButtons() & Button.Sprint).toBe(Button.Sprint);
    m.move(2, 160, 300, 220);
    expect(m.moveX).toBeGreaterThan(0);
    m.up(2, 900);
    expect(m.sprinting).toBe(false);
    expect(m.takeButtons() & Button.Sprint).toBe(0);
  });

  it("does not sprint when the second down is outside the window", () => {
    const m = model();
    m.down({ id: 1, x: 100, y: 300, hit: "canvas" }, 0);
    m.up(1, 80);
    m.down({ id: 2, x: 110, y: 300, hit: "canvas" }, DOUBLE_TAP_MS + 1);
    expect(m.sprinting).toBe(false);
  });
});

describe("jump: double-tap the look zone", () => {
  it("latches one Jump edge on the second tap's down, taken once", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    m.down({ id: 2, x: 602, y: 201, hit: "canvas" }, 200);
    expect(m.takeButtons() & Button.Jump).toBe(Button.Jump);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("does not jump when the first press was a drag", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.move(1, 600 + TAP_MAX_TRAVEL + 1, 200, 20);
    m.up(1, 50);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("does not jump when the first press was held too long", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, TAP_MAX_MS + 1);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, TAP_MAX_MS + 100);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("does not jump on a single tap, and a third tap starts a new pair", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    expect(m.takeButtons() & Button.Jump).toBe(0);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    m.up(2, 250);
    expect(m.takeButtons() & Button.Jump).toBe(Button.Jump);
    m.down({ id: 3, x: 600, y: 200, hit: "canvas" }, 400);
    expect(m.takeButtons() & Button.Jump).toBe(0);
  });

  it("still looks while tapping: the drag of the second finger turns the camera", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, 200);
    m.move(2, 640, 200, 220);
    expect(m.takeLook().yaw).toBeCloseTo(40 * LOOK_RATE, 9);
  });
});

describe("buttons", () => {
  it("lamp latches one edge on release and reports pressed while down", () => {
    const m = model();
    m.down({ id: 1, x: 40, y: 200, hit: "lamp" }, 0);
    expect(m.state.lampPressed).toBe(true);
    expect(m.takeButtons() & Button.Lamp).toBe(0);
    m.up(1, 60);
    expect(m.state.lampPressed).toBe(false);
    expect(m.takeButtons() & Button.Lamp).toBe(Button.Lamp);
    expect(m.takeButtons() & Button.Lamp).toBe(0);
  });

  it("a cancelled lamp press toggles nothing", () => {
    const m = model();
    m.down({ id: 1, x: 40, y: 200, hit: "lamp" }, 0);
    m.cancel(1, 60);
    expect(m.takeButtons() & Button.Lamp).toBe(0);
  });

  it("pause fires the hook on release, not on press", () => {
    let pauses = 0;
    const m = model(() => pauses++);
    m.down({ id: 1, x: 780, y: 20, hit: "pause" }, 0);
    expect(pauses).toBe(0);
    m.up(1, 60);
    expect(pauses).toBe(1);
  });

  it("a lamp press does not anchor the stick even though it is in the left zone", () => {
    const m = model();
    m.down({ id: 1, x: 40, y: 200, hit: "lamp" }, 0);
    expect(m.state.stick).toBeNull();
  });

  it("interact from the prompt: an edge on down and the bit while held", () => {
    const m = model();
    m.interactDown();
    expect(m.takeButtons() & Button.Interact).toBe(Button.Interact);
    expect(m.takeButtons() & Button.Interact).toBe(Button.Interact);
    m.interactUp();
    expect(m.takeButtons() & Button.Interact).toBe(0);
  });

  it("mirrors the lamp state it is told", () => {
    const m = model();
    m.setLampOn(true);
    expect(m.state.lampOn).toBe(true);
  });
});

describe("idle", () => {
  it("is idle after three seconds without a touch and wakes on any down", () => {
    const m = model();
    m.down({ id: 1, x: 600, y: 200, hit: "canvas" }, 0);
    m.up(1, 50);
    m.tick(IDLE_AFTER_MS);
    expect(m.state.idle).toBe(false);
    m.tick(IDLE_AFTER_MS + 51);
    expect(m.state.idle).toBe(true);
    m.down({ id: 2, x: 600, y: 200, hit: "canvas" }, IDLE_AFTER_MS + 60);
    expect(m.state.idle).toBe(false);
  });
});
```

Merge the imports into the file's existing import statements (one import from `touchControls.js`, one from `types.js`).

- [ ] **Step 2: Run the tests to verify which fail**

Run: `npx vitest run --root client test/game/touchControls.test.ts`
Expected: most pass against Task 2's sketch; any failure names the gesture to fix in Step 3. If all pass, Step 3 is a no-op.

- [ ] **Step 3: Fix whatever the tests reveal**

The sketch in Task 2 implements every rule these tests pin. Fix only the failing assertions, keeping the constants and the `Role` union as defined.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root client test/game/touchControls.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/touchControls.ts client/test/game/touchControls.test.ts
git commit -m "feat: touch gestures for sprint, jump, lamp, pause and the prompt" -m "## What

The phone controls' gestures, pinned by tests: double-tap-and-hold the stick to sprint until that finger lifts, double-tap the look zone to jump once, tap the lamp button to toggle, tap the pause button to pause on release, and the in-world prompt's press as an Interact edge plus the held bit. An idle clock lets the layer fade three seconds after the last touch.

## How

- \`client/src/game/touchControls.ts\` — the double-tap windows on stick and look downs, tap detection by hold time and travel, edges latched until taken, the interact hold, and the idle clock.
- \`client/test/game/touchControls.test.ts\` — sprint inside and outside the window, jump on the second tap and never on a drag, a long hold or a single tap, lamp edge and cancel, pause on release, prompt hold, idle timing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The engaged state and the touch source in the sampler

**Files:**
- Modify: `client/src/game/input.ts`
- Modify: `client/src/app.ts:295-365` (the command bar `onOpenChange`, pause menu `onResume`, `onLockStateChange` and its listener, the dispose)
- Test: `client/test/game/input.test.ts`

**Interfaces:**
- Consumes: `TouchSource` from Task 2.
- Produces, on `InputSampler`:

```ts
readonly engaged: boolean;            // replaces `locked`
onEngagedChange(handler: (engaged: boolean) => void): void;
engage(): void;                        // replaces `requestLock`
disengage(): void;
setTouchMode(on: boolean): void;       // touch semantics for engaged; starts engaged
```

and `createInputSampler(canvas, opts?: { touch?: TouchSource; touchMode?: boolean })`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/input.test.ts`. The file's `sampler()` helper must accept options; change it to:

```ts
function sampler(opts: { touch?: import("../../src/game/touchControls.js").TouchSource; touchMode?: boolean } = {}) {
  const canvas = { ...fakeTarget(), requestPointerLock: () => undefined };
  return { input: createInputSampler(canvas as unknown as HTMLCanvasElement, opts), canvas };
}
```

Then add:

```ts
function fakeTouch(over: Partial<{ moveX: number; moveZ: number; yaw: number; pitch: number; buttons: number; sprinting: boolean }> = {}) {
  const s = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, sprinting: false, ...over };
  let looks = 0;
  let buttonsTaken = 0;
  return {
    source: {
      get moveX() { return s.moveX; },
      get moveZ() { return s.moveZ; },
      get sprinting() { return s.sprinting; },
      takeLook() { looks++; const out = { yaw: s.yaw, pitch: s.pitch }; s.yaw = 0; s.pitch = 0; return out; },
      takeButtons() { buttonsTaken++; const b = s.buttons; s.buttons = 0; return b; },
    },
    looks: () => looks,
    buttonsTaken: () => buttonsTaken,
  };
}

describe("engaged on desktop", () => {
  it("mirrors pointer lock and reports changes", () => {
    const { input, canvas } = sampler();
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    expect(input.engaged).toBe(false);
    lockPointer(canvas);
    expect(input.engaged).toBe(true);
    const doc = (globalThis as Record<string, unknown>).document as { pointerLockElement: unknown };
    doc.pointerLockElement = null;
    fire("pointerlockchange", {});
    expect(input.engaged).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("engage requests pointer lock and disengage exits it", () => {
    const { input, canvas } = sampler();
    let requests = 0;
    (canvas as { requestPointerLock: () => void }).requestPointerLock = () => { requests++; };
    const doc = (globalThis as Record<string, unknown>).document as { exitPointerLock?: () => void };
    let exits = 0;
    doc.exitPointerLock = () => { exits++; };
    input.engage();
    expect(requests).toBe(1);
    lockPointer(canvas);
    input.disengage();
    expect(exits).toBe(1);
  });
});

describe("engaged on touch", () => {
  it("starts engaged, disengages and re-engages without pointer lock", () => {
    const { input } = sampler({ touch: fakeTouch().source, touchMode: true });
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    expect(input.engaged).toBe(true);
    input.disengage();
    expect(input.engaged).toBe(false);
    input.engage();
    expect(input.engaged).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it("ignores pointer lock changes in touch mode", () => {
    const { input, canvas } = sampler({ touch: fakeTouch().source, touchMode: true });
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    lockPointer(canvas);
    expect(seen).toEqual([]);
    expect(input.engaged).toBe(true);
  });

  it("switching a mouse device into touch mode engages it once", () => {
    const { input } = sampler({ touch: fakeTouch().source });
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    expect(input.engaged).toBe(false);
    input.setTouchMode(true);
    expect(input.engaged).toBe(true);
    input.setTouchMode(true);
    expect(seen).toEqual([true]);
  });

  it("clears held keys on disengage so nothing stays pressed under the menu", () => {
    const { input } = sampler({ touch: fakeTouch().source, touchMode: true });
    fire("keydown", { code: "KeyW", preventDefault() {} });
    input.disengage();
    expect(input.keys.has("KeyW")).toBe(false);
  });
});

describe("touch source in sample", () => {
  it("adds touch axes to keyboard axes and clamps to the unit range", () => {
    const t = fakeTouch({ moveX: 0.5, moveZ: 1 });
    const { input } = sampler({ touch: t.source, touchMode: true });
    fire("keydown", { code: "KeyW", preventDefault() {} });
    const cmd = input.sample(1);
    expect(cmd.moveX).toBe(0.5);
    expect(cmd.moveZ).toBe(1);
  });

  it("applies the drained look to yaw and pitch, clamping pitch", () => {
    const t = fakeTouch({ yaw: 0.3, pitch: 9 });
    const { input } = sampler({ touch: t.source, touchMode: true });
    const cmd = input.sample(1);
    expect(cmd.yaw).toBeCloseTo(0.3, 9);
    expect(cmd.pitch).toBeCloseTo(Math.PI / 2 - 0.01, 9);
    expect(t.looks()).toBe(1);
  });

  it("merges touch buttons with keyboard buttons and reports touch sprint", () => {
    const t = fakeTouch({ buttons: 2 /* Jump */, sprinting: true });
    const { input } = sampler({ touch: t.source, touchMode: true });
    fire("keydown", { code: "KeyF", preventDefault() {} });
    const cmd = input.sample(1);
    expect(cmd.buttons & 2).toBe(2);
    expect(cmd.buttons & 16).toBe(16);
    expect(cmd.buttons & 8).toBe(8);
    expect(input.sprinting).toBe(true);
  });

  it("drops touch look and buttons while suppressed instead of banking them", () => {
    const t = fakeTouch({ yaw: 0.3, buttons: 2 });
    const { input } = sampler({ touch: t.source, touchMode: true });
    input.setSuppressed(true);
    const cmd = input.sample(1);
    expect(cmd.yaw).toBe(0);
    expect(cmd.buttons).toBe(0);
    expect(t.looks()).toBe(1);
    expect(t.buttonsTaken()).toBe(1);
    input.setSuppressed(false);
    expect(input.sample(2).yaw).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root client test/game/input.test.ts`
Expected: FAIL, `engaged`, `onEngagedChange`, `engage`, `disengage`, `setTouchMode` are not on the sampler and the second argument is refused by the typecheck.

- [ ] **Step 3: Implement in `input.ts`**

Replace the `InputSampler` type and `createInputSampler` in `client/src/game/input.ts` with:

```ts
import type { InputCommand } from "../sim/types.js";
import { Button } from "../sim/types.js";
import type { TouchSource } from "./touchControls.js";

const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export type InputSampler = {
  sample(seq: number): InputCommand;
  /**
   * The player's controls are live and the pause menu is down. On desktop this
   * is exactly pointer lock; in touch mode it is the touch layer's own state.
   * The single source of "paused" for the pause menu and the roster.
   */
  readonly engaged: boolean;
  readonly suppressed: boolean;
  /** Held key codes, shared with freecam so the two cannot disagree. */
  readonly keys: ReadonlySet<string>;
  /**
   * Whether sprint is held right now, by Shift or by the touch gesture. Same
   * suppression rule as `sample`, so the walking cue and the input command can
   * never disagree about it.
   */
  readonly sprinting: boolean;
  setSuppressed(value: boolean): void;
  /** Fires on every change of `engaged`. One handler; the caller is app.ts. */
  onEngagedChange(handler: (engaged: boolean) => void): void;
  /** Requests pointer lock on desktop; engages outright in touch mode. */
  engage(): void;
  /** Exits pointer lock on desktop; disengages outright in touch mode. */
  disengage(): void;
  /**
   * Switches engaged semantics to the touch layer. Idempotent. Turning it on
   * engages at once: the game starts playable on a phone with nothing to click.
   */
  setTouchMode(on: boolean): void;
  dispose(): void;
};

export type InputOptions = {
  /** Axes, look and buttons from the touch layer, merged into every sample. */
  touch?: TouchSource;
  /** Start in touch mode. `isTouchDevice()` decides; the layer can flip it later. */
  touchMode?: boolean;
};

export function createInputSampler(canvas: HTMLCanvasElement, opts: InputOptions = {}): InputSampler {
  const touch = opts.touch ?? null;
  const keys = new Set<string>();
  let yaw = 0;
  let pitch = 0;
  let locked = false;
  let touchMode = false;
  let touchEngaged = false;
  let interactHeld = false;
  let suppressed = false;
  let engagedHandler: ((engaged: boolean) => void) | null = null;

  const engaged = (): boolean => (touchMode ? touchEngaged : locked);

  /** The single definition of the sprint binding; both readers go through it. */
  const sprintHeld = (): boolean => !suppressed && (keys.has("ShiftLeft") || (touch?.sprinting ?? false));

  const clampPitch = (): void => {
    if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
    if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;
  };

  const setTouchEngaged = (next: boolean): void => {
    if (touchEngaged === next) return;
    touchEngaged = next;
    if (!next) {
      keys.clear();
      interactHeld = false;
    }
    engagedHandler?.(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    // Esc while locked releases the pointer, which opens the pause menu (the
    // caller watches engaged). In the browser Chromium has already ejected the
    // lock — and armed its 1.25 s relock cooldown — before the page sees this
    // key, so this is a no-op there. In the Electron shell nothing ejects it:
    // the page owns Escape outright, this release is what opens the menu, and
    // being page-initiated it arms no cooldown at all. While the command bar
    // is open, Esc belongs to the bar.
    if (!suppressed && e.code === "Escape" && locked) {
      document.exitPointerLock();
      return;
    }
    // Space scrolls the page and Tab moves focus out of the canvas.
    // But only while gameplay is actually reading these keys: while suppressed
    // (the command bar is open) the sampler already reports zero movement, and
    // the bar's focused <input> needs the real Space character to reach it —
    // preventDefault here would silently swallow every space typed into it.
    if (!suppressed && (e.code === "Space" || e.code === "Tab")) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    yaw += e.movementX * MOUSE_SENSITIVITY;
    pitch += e.movementY * MOUSE_SENSITIVITY;
    clampPitch();
  };

  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) interactHeld = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) interactHeld = false;
  };

  const onLockChange = () => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    // Releasing the pointer must not leave keys stuck down.
    if (!locked) {
      keys.clear();
      interactHeld = false;
    }
    // In touch mode pointer lock is not what engaged means, so it says nothing.
    if (!touchMode && was !== locked) engagedHandler?.(locked);
  };

  const onCanvasClick = () => {
    if (!touchMode && !locked) void canvas.requestPointerLock();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("pointerlockchange", onLockChange);
  canvas.addEventListener("click", onCanvasClick);

  const sampler: InputSampler = {
    get engaged() {
      return engaged();
    },
    get suppressed() {
      return suppressed;
    },
    get keys() {
      return keys as ReadonlySet<string>;
    },
    setSuppressed(value: boolean) {
      suppressed = value;
      // Held keys are left tracked, not cleared: `sample` already reports zero
      // movement/buttons whenever suppressed, and clearing here would forget a
      // key that is still physically held once suppression lifts.
    },
    onEngagedChange(handler) {
      engagedHandler = handler;
    },
    engage() {
      if (touchMode) {
        setTouchEngaged(true);
        return;
      }
      // Chrome rate-limits a re-lock that follows an unlock too closely, which
      // is precisely this path: opening the command bar unlocks and closing it
      // locks again. The rejection is not an error worth surfacing — you click
      // the canvas and carry on — but left unhandled it prints as one.
      void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    },
    disengage() {
      if (touchMode) {
        setTouchEngaged(false);
        return;
      }
      if (locked) document.exitPointerLock();
    },
    setTouchMode(on) {
      if (touchMode === on) return;
      touchMode = on;
      if (on) setTouchEngaged(true);
    },
    get sprinting() {
      return sprintHeld();
    },
    sample(seq: number): InputCommand {
      // Drained every sample, kept or dropped: a look or a jump that happened
      // while the menu was up must not land the moment it comes down.
      const look = touch?.takeLook() ?? { yaw: 0, pitch: 0 };
      const touchButtons = touch?.takeButtons() ?? 0;
      // While the command bar has focus every keystroke is text. Reporting it as
      // movement would walk the player away mid-sentence.
      if (suppressed) return { seq, moveX: 0, moveZ: 0, yaw, pitch, buttons: 0 };
      yaw += look.yaw;
      pitch += look.pitch;
      clampPitch();

      let moveX = touch?.moveX ?? 0;
      let moveZ = touch?.moveZ ?? 0;
      if (keys.has("KeyW")) moveZ += 1;
      if (keys.has("KeyS")) moveZ -= 1;
      if (keys.has("KeyD")) moveX += 1;
      if (keys.has("KeyA")) moveX -= 1;
      moveX = Math.max(-1, Math.min(1, moveX));
      moveZ = Math.max(-1, Math.min(1, moveZ));

      let buttons = touchButtons;
      if (interactHeld) buttons |= Button.Interact;
      if (keys.has("Space")) buttons |= Button.Jump;
      if (sprintHeld()) buttons |= Button.Sprint;
      if (keys.has("KeyF")) buttons |= Button.Lamp;

      return { seq, moveX, moveZ, yaw, pitch, buttons };
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      canvas.removeEventListener("click", onCanvasClick);
    },
  };
  if (opts.touchMode) sampler.setTouchMode(true);
  return sampler;
}
```

Note: `setTouchMode(true)` at construction fires no handler because none is registered yet; `engaged` simply starts true.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root client test/game/input.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Move `app.ts` onto the new names**

In `client/src/app.ts`:

- Line 304: `if (!open && !disposed) input.requestLock();` becomes `if (!open && !disposed) input.engage();`
- Line 343: `if (!disposed) input.requestLock();` becomes `if (!disposed) input.engage();`
- Replace the `onLockStateChange` block (lines 350–365, the comment through `document.addEventListener("pointerlockchange", onLockStateChange);`) with:

```ts
  /**
   * The pause menu is driven by the sampler's engaged state, not by who
   * changed it: Esc (the browser releases the lock), alt-tab, focus loss, the
   * touch Pause button — one rule covers them all. The command bar's own
   * unlock is the exception; the bar is already handling the keyboard.
   */
  input.onEngagedChange((engaged) => {
    if (disposed) return;
    if (engaged) {
      menu.hide();
      input.setSuppressed(bar.isOpen);
      options.onPauseChange(false);
    } else if (!bar.isOpen) {
      menu.show();
      input.setSuppressed(true);
      options.onPauseChange(true);
    }
  });
```

- In `dispose()`, delete the line `document.removeEventListener("pointerlockchange", onLockStateChange);` (the sampler owns that listener now).

- [ ] **Step 6: Typecheck, lint and the full client suite**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client`
Expected: all green. `freecam.ts` does not read `locked`; only `app.ts` did.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/input.ts client/src/app.ts client/test/game/input.test.ts
git commit -m "feat: an engaged state on the input sampler, fed by touch or pointer lock" -m "## What

Phones have no pointer lock, and pointer lock is what the pause menu and the roster take their one notion of paused from. The sampler now owns an \"engaged\" state that is pointer lock on desktop and the touch layer's own state in touch mode, and it merges a touch source's axes, look and buttons into every sample. app.ts pauses off that state instead of the lock event, so the rule stays single-sourced.

## How

- \`client/src/game/input.ts\` — \`engaged\`, \`onEngagedChange\`, \`engage\`/\`disengage\`, \`setTouchMode\`; the touch source drained every sample and dropped while suppressed; touch sprint folded into \`sprinting\`.
- \`client/src/app.ts\` — the pause wiring listens to \`onEngagedChange\`; the bar and Resume call \`engage()\`.
- \`client/test/game/input.test.ts\` — desktop mirrors pointer lock, touch mode starts engaged and ignores lock changes, mode switch engages once, axes/look/buttons merge and clamp, suppressed samples drop touch input.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The touch layer and its wiring

**Files:**
- Modify: `client/src/game/touchControls.ts` (add `createTouchLayer`)
- Modify: `client/src/app.ts` (construct the model and layer, drive them per frame, visibility disengage, canvas `touch-action`)
- No headless test (renderer). The controller's browser gates 2 to 5 and 7 cover it.

**Interfaces:**
- Consumes: `createTouchModel`, `TouchModel`, `TouchState` (Task 2/3); `InputSampler.engaged`, `setTouchMode`, `disengage` (Task 4); `isTouchDevice` (Task 1).
- Produces:

```ts
export type TouchLayer = {
  /** Paint from the model. Once a frame, after the model's tick. */
  sync(): void;
  /** Show the layer (a device that started without it just got touched). */
  show(): void;
  dispose(): void;
};
export function createTouchLayer(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  model: TouchModel,
  hooks: { engaged(): boolean; onFirstTouch(): void; visible: boolean },
): TouchLayer;
```

- [ ] **Step 1: Add the layer to `touchControls.ts`**

Append:

```ts
const STYLE = `
  .touch {
    position: absolute; inset: 0; pointer-events: none; z-index: 15;
    font-family: ui-monospace, monospace; color: #fff;
    opacity: 0; transition: opacity 400ms ease-out;
  }
  .touch.on { opacity: 1; }
  .touch.on.idle { opacity: 0.35; transition: opacity 600ms ease-out; }
  .touch.on.paused { opacity: 0; transition: opacity 200ms ease-out; }
  .touch.off { display: none; }
  .touch .stick {
    position: absolute; left: 0; top: 0; width: 120px; height: 120px;
    margin: -60px 0 0 -60px; border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.18);
    opacity: 0; transform: scale(0.8);
    transition: opacity 180ms ease-out, transform 180ms ease-out;
  }
  .touch .stick.live { opacity: 1; transform: scale(1); transition: opacity 120ms ease-out, transform 120ms ease-out; }
  .touch .thumb {
    position: absolute; left: 50%; top: 50%; width: 56px; height: 56px;
    margin: -28px 0 0 -28px; border-radius: 50%;
    background: rgba(16, 16, 20, 0.72); border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(4px);
    transition: transform 180ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  .touch .stick.live .thumb { transition: none; }
  .touch button {
    position: absolute; pointer-events: auto; touch-action: none;
    display: flex; align-items: center; justify-content: center;
    font: inherit; font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase;
    color: #fff; background: rgba(16, 16, 20, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 50%;
    backdrop-filter: blur(4px); -webkit-user-select: none; user-select: none;
    transition: transform 80ms ease-out, background 80ms ease-out, box-shadow 300ms ease-out;
  }
  .touch button.pressed { transform: scale(0.92); background: rgba(255, 255, 255, 0.18); }
  .touch .lamp {
    width: 56px; height: 56px;
    left: calc(32px + env(safe-area-inset-left, 0px));
    bottom: calc(200px + env(safe-area-inset-bottom, 0px));
  }
  .touch .lamp.lit { box-shadow: 0 0 0 1px #ffd24d; }
  .touch .lamp.pulse { box-shadow: 0 0 0 3px #ffd24d; transition: none; }
  .touch .pause {
    width: 40px; height: 40px; font-size: 0.9rem;
    right: calc(20px + env(safe-area-inset-right, 0px));
    top: calc(20px + env(safe-area-inset-top, 0px));
  }
`;

export type TouchLayer = {
  sync(): void;
  show(): void;
  dispose(): void;
};

/**
 * The dumb half: paints `model.state` and forwards pointer events. The canvas
 * gets the stick and look pointers (captured, so a finger sliding off still
 * ends its role); the two buttons get their own. Never decides anything.
 */
export function createTouchLayer(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  model: TouchModel,
  hooks: { engaged(): boolean; onFirstTouch(): void; visible: boolean },
): TouchLayer {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "touch";

  const stick = document.createElement("div");
  stick.className = "stick";
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  stick.append(thumb);

  const lamp = document.createElement("button");
  lamp.type = "button";
  lamp.className = "lamp";
  lamp.textContent = "Lamp";
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "pause";
  pause.textContent = "‖";
  pause.setAttribute("aria-label", "Pause");

  root.append(stick, lamp, pause);
  container.append(style, root);

  let visible = hooks.visible;
  root.classList.toggle("off", !visible);
  let wasLampOn = model.state.lampOn;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;

  const now = () => performance.now();

  // The stick and look pointers live on the canvas; a device that started
  // without the layer gets it on its first real touch.
  const onCanvasDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!visible) {
      visible = true;
      root.classList.remove("off");
      hooks.onFirstTouch();
    }
    if (!hooks.engaged()) return;
    canvas.setPointerCapture(e.pointerId);
    model.down({ id: e.pointerId, x: e.clientX, y: e.clientY, hit: "canvas" }, now());
  };
  const onCanvasMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") model.move(e.pointerId, e.clientX, e.clientY, now());
  };
  const onCanvasUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") model.up(e.pointerId, now());
  };
  const onCanvasCancel = (e: PointerEvent) => {
    if (e.pointerType === "touch") model.cancel(e.pointerId, now());
  };
  canvas.addEventListener("pointerdown", onCanvasDown);
  canvas.addEventListener("pointermove", onCanvasMove);
  canvas.addEventListener("pointerup", onCanvasUp);
  canvas.addEventListener("pointercancel", onCanvasCancel);

  function bindButton(el: HTMLButtonElement, hit: "lamp" | "pause"): void {
    el.addEventListener("pointerdown", (e) => {
      if (!hooks.engaged() && hit !== "pause") return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      model.down({ id: e.pointerId, x: e.clientX, y: e.clientY, hit }, now());
    });
    el.addEventListener("pointerup", (e) => model.up(e.pointerId, now()));
    el.addEventListener("pointercancel", (e) => model.cancel(e.pointerId, now()));
  }
  bindButton(lamp, "lamp");
  bindButton(pause, "pause");

  return {
    sync() {
      const s = model.state;
      const engaged = hooks.engaged();
      root.classList.toggle("on", visible);
      root.classList.toggle("paused", visible && !engaged);
      root.classList.toggle("idle", visible && engaged && s.idle);
      if (s.stick !== null) {
        stick.classList.add("live");
        stick.style.transform = `translate(${s.stick.anchorX}px, ${s.stick.anchorY}px)`;
        thumb.style.transform = `translate(${s.stick.dx}px, ${s.stick.dy}px)`;
      } else {
        stick.classList.remove("live");
        thumb.style.transform = "translate(0px, 0px)";
      }
      lamp.classList.toggle("pressed", s.lampPressed);
      pause.classList.toggle("pressed", s.pausePressed);
      lamp.classList.toggle("lit", s.lampOn);
      if (s.lampOn !== wasLampOn) {
        wasLampOn = s.lampOn;
        lamp.classList.add("pulse");
        clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => lamp.classList.remove("pulse"), 300);
      }
    },
    show() {
      visible = true;
      root.classList.remove("off");
    },
    dispose() {
      clearTimeout(pulseTimer);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      canvas.removeEventListener("pointermove", onCanvasMove);
      canvas.removeEventListener("pointerup", onCanvasUp);
      canvas.removeEventListener("pointercancel", onCanvasCancel);
      root.remove();
      style.remove();
    },
  };
}
```

The stick's `transform` translates the 120 px box whose negative margins centre it on the anchor, so `translate(anchorX, anchorY)` puts its centre at the finger.

- [ ] **Step 2: Wire it in `app.ts`**

Add imports at the top of `client/src/app.ts`:

```ts
import { createTouchModel, createTouchLayer } from "./game/touchControls.js";
import { isDesktop, isTouchDevice } from "./game/platform.js";
```

(merge `isTouchDevice` into the existing `platform.js` import.)

Replace `const input = createInputSampler(canvas);` with:

```ts
  // The browser must never scroll, zoom or select on the game canvas: every
  // finger on it is a stick or a look.
  canvas.style.touchAction = "none";
  const touchStart = isTouchDevice();
  // Built on every device: a mouse machine that gets touched shows the layer
  // on that first touch and flips the sampler into touch mode.
  const touchModel = createTouchModel(
    { width: canvas.clientWidth, height: canvas.clientHeight },
    { onPause: () => input.disengage() },
  );
  const input = createInputSampler(canvas, { touch: touchModel, touchMode: touchStart });
```

After `const hud = createHud(container);` add:

```ts
  const touchLayer = createTouchLayer(container, canvas, touchModel, {
    engaged: () => input.engaged,
    onFirstTouch: () => input.setTouchMode(true),
    visible: touchStart,
  });
  // A phone backgrounds the page constantly; coming back should land on the
  // pause menu, not mid-walk. Desktop already gets this from pointer lock.
  const onVisibility = () => {
    if (document.visibilityState === "hidden" && !disposed) input.disengage();
  };
  document.addEventListener("visibilitychange", onVisibility);
```

`disposed` is declared with `let` a few lines below in the existing file; move `let disposed = false;` above this block.

Add a helper after `playWildlifeAudio`:

```ts
  /** Advances and paints the touch layer. Both loops, after `renderer.sync`. */
  function syncTouch(lampOn: boolean): void {
    touchModel.tick(performance.now());
    touchModel.setLampOn(lampOn);
    touchLayer.sync();
  }
```

In `runAsHost`'s `stepAndRender`, after `playWildlifeAudio();` add `syncTouch(self?.lamp.on ?? false);`. In `runAsClient`'s `stepAndRender`, the same line after its `playWildlifeAudio();`.

In `onResize` replace `const onResize = () => renderer.resize();` with:

```ts
  const onResize = () => {
    renderer.resize();
    touchModel.resize({ width: canvas.clientWidth, height: canvas.clientHeight });
  };
```

In `dispose()` add, next to the other listener removals, `document.removeEventListener("visibilitychange", onVisibility);` and, before `input.dispose();`, `touchLayer.dispose();`.

- [ ] **Step 3: Typecheck, lint, full suite**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add client/src/game/touchControls.ts client/src/app.ts
git commit -m "feat: the touch layer, painted from the model and wired into the game loop" -m "## What

The on-screen half of the phone controls: a floating stick drawn where the thumb lands, a Lamp button above it, a Pause button top-right, all in the roster's visual language, fading in when the game engages, to 35% after three seconds idle, and out under the pause menu. Every device builds it; a phone starts with it up and a mouse machine gets it on its first real touch.

## How

- \`client/src/game/touchControls.ts\` — \`createTouchLayer\`: pointer capture on the canvas for stick and look, the two buttons, and a per-frame \`sync\` that paints the model's state; the CSS carries every fade and the safe-area insets.
- \`client/src/app.ts\` — builds the model and layer, disables browser gestures on the canvas, ticks and paints them after \`renderer.sync\` on both loops, disengages when the page is hidden, resizes the model with the canvas.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The in-world interact prompt

**Files:**
- Modify: `client/src/game/renderer.ts` (add `project`)
- Modify: `client/src/net/clientSession.ts` (add `readonly world`)
- Create: `client/src/game/interactPrompt.ts`
- Modify: `client/src/app.ts` (`registerInteractables`, prompt wiring on both loops)
- Test: `client/test/game/interactPrompt.test.ts`

**Interfaces:**
- Consumes: `resolveInteract`, `INTERACT_REACH`, `Interactable` from `client/src/sim/interact.ts`; `TouchModel.interactDown/interactUp` (Task 3).
- Produces:

```ts
// interactPrompt.ts
export type Projected = { x: number; y: number; depth: number };
export type PromptView = { x: number; y: number; label: string; scale: number };
export function promptLabel(kind: number): string;
export function promptModel(
  target: { kind: number } | null,
  projected: Projected | null,
  viewport: { width: number; height: number },
  touch: boolean,
): PromptView | null;
export type InteractPrompt = { sync(view: PromptView | null): void; dispose(): void };
export function createInteractPrompt(container: HTMLElement, hooks: { onDown(): void; onUp(): void }): InteractPrompt;
// renderer.ts
project(pos: Vec3): Projected | null;
// clientSession.ts
readonly world: World;
```

- [ ] **Step 1: Write the failing tests**

Create `client/test/game/interactPrompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { promptLabel, promptModel } from "../../src/game/interactPrompt.js";
import { INTERACT_REACH } from "../../src/sim/interact.js";

const VIEW = { width: 800, height: 400 };

describe("promptModel", () => {
  it("is null with nothing in reach", () => {
    expect(promptModel(null, { x: 1, y: 1, depth: 1 }, VIEW, true)).toBeNull();
  });
  it("is null when the target is behind the camera", () => {
    expect(promptModel({ kind: 0 }, null, VIEW, true)).toBeNull();
  });
  it("labels a plain interactable, with a click hint on desktop only", () => {
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 1 }, VIEW, true)?.label).toBe("Interact");
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 1 }, VIEW, false)?.label).toBe("Click to interact");
    expect(promptLabel(0)).toBe("Interact");
    expect(promptLabel(99)).toBe("Interact");
  });
  it("scales from 1 at one metre to 0.7 at reach", () => {
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 1 }, VIEW, true)?.scale).toBeCloseTo(1, 9);
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: INTERACT_REACH }, VIEW, true)?.scale).toBeCloseTo(0.7, 9);
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 0.2 }, VIEW, true)?.scale).toBeCloseTo(1, 9);
  });
  it("clamps the anchor 24 px inside the viewport", () => {
    const v = promptModel({ kind: 0 }, { x: -50, y: 900, depth: 1 }, VIEW, true);
    expect(v).toEqual({ x: 24, y: 376, label: "Interact", scale: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/interactPrompt.test.ts`
Expected: FAIL, cannot resolve `interactPrompt.js`.

- [ ] **Step 3: Create `interactPrompt.ts`**

```ts
import { INTERACT_REACH } from "../sim/interact.js";

export type Projected = { x: number; y: number; depth: number };
export type PromptView = { x: number; y: number; label: string; scale: number };

/** Kept from the viewport's edges, so a prompt at the corner is still legible. */
const EDGE_PX = 24;
/** Nearer than this the prompt is at full size. */
const NEAR_M = 1;
const FAR_SCALE = 0.7;

const LABELS: Record<number, string> = {
  0: "Interact",
};

/** The verb for an interactable's `kind`. Register kinds add rows here. */
export function promptLabel(kind: number): string {
  return LABELS[kind] ?? "Interact";
}

/**
 * Where and what the prompt shows, or null. Pure: the app resolves the target
 * and projects its position; this only decides the label, the size and the
 * clamp.
 */
export function promptModel(
  target: { kind: number } | null,
  projected: Projected | null,
  viewport: { width: number; height: number },
  touch: boolean,
): PromptView | null {
  if (target === null || projected === null) return null;
  const label = touch ? promptLabel(target.kind) : `Click to ${promptLabel(target.kind).toLowerCase()}`;
  const t = Math.min(1, Math.max(0, (projected.depth - NEAR_M) / (INTERACT_REACH - NEAR_M)));
  const scale = 1 - (1 - FAR_SCALE) * t;
  return {
    x: Math.min(viewport.width - EDGE_PX, Math.max(EDGE_PX, projected.x)),
    y: Math.min(viewport.height - EDGE_PX, Math.max(EDGE_PX, projected.y)),
    label,
    scale,
  };
}

const STYLE = `
  .prompt {
    position: absolute; left: 0; top: 0; z-index: 12;
    display: flex; align-items: center; gap: 0.5rem;
    font-family: system-ui, sans-serif; font-size: 0.95rem; color: #fff;
    text-shadow: 0 1px 4px #000; white-space: nowrap;
    pointer-events: none; opacity: 0;
    transition: opacity 150ms ease-out, transform 150ms ease-out;
    -webkit-user-select: none; user-select: none;
  }
  .prompt.on { opacity: 1; }
  .prompt.touch { pointer-events: auto; touch-action: none; }
  .prompt .dot {
    width: 12px; height: 12px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
    animation: prompt-drift 3s ease-in-out infinite;
  }
  @keyframes prompt-drift {
    0%, 100% { transform: translateY(-2px); }
    50% { transform: translateY(2px); }
  }
  @media (prefers-reduced-motion: reduce) { .prompt .dot { animation: none; } }
`;

export type InteractPrompt = {
  sync(view: PromptView | null): void;
  dispose(): void;
};

/**
 * Floats the prompt at the projected point. `hooks` are the touch press: on a
 * phone the prompt is the interact control, so pressing it is the edge and
 * holding it is the bit.
 */
export function createInteractPrompt(
  container: HTMLElement,
  hooks: { onDown(): void; onUp(): void; touch: boolean },
): InteractPrompt {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.className = "prompt";
  root.classList.toggle("touch", hooks.touch);
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.className = "label";
  root.append(dot, label);
  container.append(style, root);

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    hooks.onDown();
  };
  const onUp = () => hooks.onUp();
  if (hooks.touch) {
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
  }

  let shown = false;
  return {
    sync(view) {
      if (view === null) {
        if (shown) {
          shown = false;
          root.classList.remove("on");
          // A hidden prompt cannot be held; release so the bit does not stick.
          if (hooks.touch) hooks.onUp();
        }
        return;
      }
      if (!shown) {
        shown = true;
        root.classList.add("on");
      }
      label.textContent = view.label;
      // The 4 px rise on entry comes from the transition between the last
      // hidden position and this one; steady state is exact.
      root.style.transform = `translate(${view.x}px, ${view.y - 6}px) scale(${view.scale})`;
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root client test/game/interactPrompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add `project` to the renderer**

In `client/src/game/renderer.ts`, add to the imports: `import { Matrix } from "@babylonjs/core/Maths/math.vector.js";` (merge with the existing `Vector3` import from that module) and `import type { Vec3 } from "../sim/types.js";` (merge with the existing `WorldState` type import).

Add to the `Renderer` type, after `listener(): ListenerPose;`:

```ts
  /**
   * A world point as CSS pixels on the canvas, with its distance from the
   * camera, or null when it is behind the camera. Drives the interact prompt.
   */
  project(pos: Vec3): { x: number; y: number; depth: number } | null;
```

Add to the returned object, after `listener() {...},`:

```ts
    project(pos) {
      const p = new Vector3(pos.x, pos.y, pos.z);
      const view = Vector3.TransformCoordinates(p, camera.getViewMatrix());
      if (view.z <= camera.minZ) return null;
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const s = Vector3.Project(p, Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
      // Render pixels to CSS pixels: the hardware scaling level makes them differ.
      const canvasEl = engine.getRenderingCanvas();
      const cw = canvasEl?.clientWidth ?? w;
      const ch = canvasEl?.clientHeight ?? h;
      return { x: (s.x / w) * cw, y: (s.y / h) * ch, depth: Vector3.Distance(p, camera.position) };
    },
```

- [ ] **Step 6: Expose the client's world**

In `client/src/net/clientSession.ts`, add to the `ClientSession` type after `readonly stats: NetStats;`:

```ts
  /**
   * The predicted world: the local player and, once app.ts registers them,
   * the same interactables the host has. Read to resolve what is in reach for
   * the prompt; the host still decides what an Interact does.
   */
  readonly world: World;
```

and to the returned object after the `stats` getter:

```ts
    get world() {
      return predicted;
    },
```

- [ ] **Step 7: Wire the prompt in `app.ts`**

Add imports:

```ts
import { createInteractPrompt, promptModel } from "./game/interactPrompt.js";
import { resolveInteract } from "./sim/interact.js";
import type { World } from "./sim/world.js";
```

Replace the debug marker block inside `runAsHost` (from `if (debugOn) {` through its closing `}` that sets `host.world.interactables.set(1, …)`) with a call `registerInteractables(host.world);`, and add this function after `playWildlifeAudio`:

```ts
  /**
   * The world's interactables, registered identically on the host and on a
   * client's predicted world so both can resolve what is in reach. Nothing
   * crosses the wire: the registry is seeded like everything else. Today that
   * is only the debug pad marker: a lone interactable 2 m out from the
   * trailhead at chest height, provably in reach when standing on the pad and
   * facing it.
   */
  function registerInteractables(world: World): void {
    if (!debugOn) return;
    const th = activeTerrainVariant().trailGraph?.(seed).trailhead;
    if (th === undefined) return;
    const y = elevationAt(seed, th.x + 2, th.z) + 0.5;
    world.interactables.set(1, {
      id: 1,
      pos: { x: th.x + 2, y, z: th.z },
      radius: 0.5,
      kind: 0,
      onInteract: (id) => console.info("[debug] interact by", id),
    });
  }

  const prompt = createInteractPrompt(container, {
    onDown: () => touchModel.interactDown(),
    onUp: () => touchModel.interactUp(),
    touch: touchStart,
  });

  /** Resolves and paints the prompt. Both loops, after `renderer.sync`. */
  function syncPrompt(world: World, self: PlayerState | undefined): void {
    if (self === undefined || freecam !== null) {
      prompt.sync(null);
      return;
    }
    const target = resolveInteract(world, self);
    const projected = target === null ? null : renderer.project(target.pos);
    prompt.sync(
      promptModel(target, projected, { width: canvas.clientWidth, height: canvas.clientHeight }, input.engaged && touchStart),
    );
  }
```

Import `PlayerState` as a type from `./sim/types.js` (merge with the existing `WorldState` type import). In `runAsHost`'s loop add `syncPrompt(host.world, self);` after `syncTouch(...)`. In `runAsClient`, after `session = client;` add `registerInteractables(client.world);`, and in its loop add `syncPrompt(client.world, self);` after `syncTouch(...)`. In `dispose()` add `prompt.dispose();` next to `touchLayer.dispose();`.

- [ ] **Step 8: Typecheck, lint, full suite**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client`
Expected: all green, `architecture.test.ts` included (`app.ts` may import `sim/`; `net/` gained only a getter).

- [ ] **Step 9: Commit**

```bash
git add client/src/game/interactPrompt.ts client/src/game/renderer.ts client/src/net/clientSession.ts client/src/app.ts client/test/game/interactPrompt.test.ts
git commit -m "feat: an in-world interact prompt on every device" -m "## What

Interact has no button. When something is in reach a prompt floats at the object, projected from its world position each frame: a dot and a short verb, fading in and out. On a phone pressing it is the interact; on desktop it carries the click hint. To know what is in reach, the client registers the same interactables the host does on its predicted world.

## How

- \`client/src/game/interactPrompt.ts\` — \`promptModel\` (label by kind, scale by distance, clamped inside the viewport) and \`createInteractPrompt\` (the floating dot and label, pressable on touch).
- \`client/src/game/renderer.ts\` — \`project\`: world point to CSS pixels and depth, null behind the camera.
- \`client/src/net/clientSession.ts\` — \`world\`, the predicted world, read-only.
- \`client/src/app.ts\` — \`registerInteractables\` on both sessions, the prompt resolved and painted after \`renderer.sync\` on both loops, hidden in freecam.
- \`client/test/game/interactPrompt.test.ts\` — null cases, labels, scale, clamp.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The roster on a phone

**Files:**
- Modify: `client/src/game/rosterModel.ts`
- Modify: `client/src/game/roster.ts`
- Modify: `client/src/main.ts`
- Test: `client/test/game/rosterModel.test.ts`

**Interfaces:**
- Consumes: `isTouchDevice` (Task 1).
- Produces: `rosterModel` input gains `touch?: boolean`; `RosterView.presence` gains `"hidden"`; `RosterView.share: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `client/test/game/rosterModel.test.ts`:

```ts
describe("rosterModel on a touch device", () => {
  const base = { lobby: null, selfId: "me", selfName: "Sam", inviteUrl: invite, attempt: null };
  it("hides while a match is being played, since the screen belongs to the controls", () => {
    const view = rosterModel({ ...base, inGame: true, paused: false, touch: true });
    expect(view.presence).toBe("hidden");
    expect(view.interactive).toBe(false);
  });
  it("is full and interactive on the pause menu, the one place to invite from", () => {
    const view = rosterModel({ ...base, inGame: true, paused: true, touch: true });
    expect(view.presence).toBe("full");
    expect(view.interactive).toBe(true);
  });
  it("is full on the landing", () => {
    expect(rosterModel({ ...base, inGame: false, paused: false, touch: true }).presence).toBe("full");
  });
  it("offers the share sheet on touch and not otherwise", () => {
    expect(rosterModel({ ...base, inGame: false, paused: false, touch: true }).share).toBe(true);
    expect(rosterModel({ ...base, inGame: false, paused: false }).share).toBe(false);
  });
  it("keeps the desktop subdued presence without touch", () => {
    expect(rosterModel({ ...base, inGame: true, paused: false }).presence).toBe("subdued");
  });
});
```

The first test in the file uses `toEqual` on the whole view; add `share: false` to that expected object.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/rosterModel.test.ts`
Expected: FAIL on `presence` and `share`.

- [ ] **Step 3: Implement the model**

In `client/src/game/rosterModel.ts`:

- Change the `presence` doc and type to:

```ts
  /**
   * Faded while a match is being played on desktop; gone entirely while it is
   * played on touch, where the screen belongs to the controls; full on the
   * landing and on the pause menu.
   */
  presence: "full" | "subdued" | "hidden";
  /** Offer the system share sheet for the invite (touch devices). */
  share: boolean;
```

- Add `touch?: boolean;` to the input type with the doc `/** A touch device: the roster hides while playing and offers Share. */`.
- In the `view` literal set:

```ts
    presence: !input.inGame || input.paused ? "full" : input.touch ? "hidden" : "subdued",
    share: input.touch === true,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root client test/game/rosterModel.test.ts`
Expected: PASS.

- [ ] **Step 5: The renderer: hidden class, phone width, Share**

In `client/src/game/roster.ts`:

- Add to `STYLE` after the `.roster.subdued` rule:

```
  /* Playing on touch: the screen belongs to the controls. */
  .roster.hidden { opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
  @media (max-width: 480px) {
    .roster { left: 1rem; right: 1rem; min-width: 0; max-width: none; }
  }
  @media (max-height: 420px) {
    .roster { min-width: 0; max-width: 40vw; }
  }
```

- In `paint`, after `root.classList.toggle("subdued", ...)` add `root.classList.toggle("hidden", view.presence === "hidden");`.
- In the `"url" in view.invite` block, after the `copy` button is built and before `row.append(field, copy);`, add:

```ts
      // The share sheet where the browser has one: on a phone that is how a
      // link gets to a friend. Copy stays beside it for everyone.
      const share = view.share && typeof navigator.share === "function"
        ? (() => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "share";
            b.textContent = "Share";
            b.addEventListener("click", () => {
              void navigator.share({ url: field.value }).catch(() => field.select());
            });
            return b;
          })()
        : null;
      row.append(field, copy);
      if (share !== null) row.append(share);
```

and delete the original `row.append(field, copy);` line so it is not appended twice.

- [ ] **Step 6: Pass `touch` from `main.ts`**

In `client/src/main.ts`, next to `const desktop = isDesktop();` add `const touch = isTouchDevice();` (merge the import from `./game/platform.js`). In `paintRoster()`, add `touch,` to the `rosterModel({...})` argument.

- [ ] **Step 7: Typecheck, lint, full suite**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/rosterModel.ts client/src/game/roster.ts client/src/main.ts client/test/game/rosterModel.test.ts
git commit -m "feat: hide the roster while playing on touch and offer the share sheet" -m "## What

On a phone the bottom-right roster would sit under the thumbs and cover a fifth of the screen. It now disappears while a match is played on a touch device and comes back full and live on the pause menu and the landing, which makes the pause menu the place to invite from; Invite gains a Share button where the browser has a share sheet. It also fits a 400 px screen.

## How

- \`client/src/game/rosterModel.ts\` — \`touch\` input, the \`hidden\` presence while playing on touch, the \`share\` flag.
- \`client/src/game/roster.ts\` — the hidden class, phone-width and short-landscape rules, the Share button beside Copy.
- \`client/src/main.ts\` — passes the touch probe to the roster model.
- \`client/test/game/rosterModel.test.ts\` — hidden while playing, full on the pause menu and landing, share only on touch, desktop unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The landing at phone width

**Files:**
- Modify: `client/src/game/landingModel.ts`
- Modify: `client/src/game/landing.ts`
- Modify: `client/src/main.ts`
- Test: `client/test/game/landingModel.test.ts`

**Interfaces:**
- Consumes: `touch` from `main.ts` (Task 7).
- Produces: `LandingInput.touch?: boolean`; `export const TOUCH_DOWNLOADS_NOTE`.

- [ ] **Step 1: Write the failing test**

Append to `client/test/game/landingModel.test.ts`:

```ts
import { TOUCH_DOWNLOADS_NOTE } from "../../src/game/landingModel.js";

describe("landingModel on a touch device", () => {
  it("replaces the desktop download cards with a one-line note", () => {
    const view = landingModel({ desktop: false, host: "other", latest, touch: true });
    expect(view.downloadsPage).toEqual({ label: "Downloads", cards: [], empty: TOUCH_DOWNLOADS_NOTE });
    expect(view.play).toEqual({ label: "Play" });
  });
  it("leaves the desktop shell's view alone", () => {
    const view = landingModel({ desktop: true, host: "darwin-arm64", latest, appVersion: "1.2.0", touch: true });
    expect(view.downloadsPage).toBeUndefined();
  });
});
```

Merge the import into the existing one from `landingModel.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --root client test/game/landingModel.test.ts`
Expected: FAIL, `TOUCH_DOWNLOADS_NOTE` is not exported.

- [ ] **Step 3: Implement**

In `client/src/game/landingModel.ts`:

- After `WAITING_FOR_HOST` add:

```ts
/** A phone cannot install either desktop build; say so instead of offering them. */
export const TOUCH_DOWNLOADS_NOTE = "Day Hike is a desktop download; play in the browser here.";
```

- Add `touch?: boolean;` to `LandingInput` with the doc `/** A touch device: the download cards make no sense here. */`.
- In the `if (!input.desktop)` branch, replace `view.downloadsPage = { label: "Downloads", cards };` and the line after it with:

```ts
    if (input.touch) {
      view.downloadsPage = { label: "Downloads", cards: [], empty: TOUCH_DOWNLOADS_NOTE };
      return view;
    }
    view.downloadsPage = { label: "Downloads", cards };
    if (cards.length === 0) view.downloadsPage.empty = DOWNLOADS_UNAVAILABLE;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --root client test/game/landingModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Phone-width CSS**

In `client/src/game/landing.ts`, append to `STYLE` before the closing backtick:

```
  /* Phone widths: the title, copy and buttons scale to a 400 px screen with
     16 px gutters and nothing wider than the viewport. */
  @media (max-width: 480px) {
    .landing .panel { padding: 1rem; gap: 0.6rem; }
    .landing h1 { font-size: 1.4rem; letter-spacing: 0.1em; }
    .landing p { font-size: 0.85rem; max-width: 100%; }
    .landing button { width: 100%; max-width: 20rem; margin-top: 0.75rem; }
    .landing button.secondary { width: auto; }
    .landing form.join { width: 100%; max-width: 20rem; }
    .landing form.join input { width: 100%; max-width: none; min-width: 0; }
  }
```

- [ ] **Step 6: Pass `touch` from `main.ts`**

In `client/src/main.ts`'s `landingInput()`, add `touch,` to the returned object.

- [ ] **Step 7: Typecheck, lint, full suite**

Run: `npx tsc -p client --noEmit && npx eslint . && npx vitest run --root client`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add client/src/game/landingModel.ts client/src/game/landing.ts client/src/main.ts client/test/game/landingModel.test.ts
git commit -m "feat: fit the landing to a phone and drop the download cards there" -m "## What

The landing page at 400 px wide: the title, copy, buttons and join field scale to the screen with 16 px gutters and no horizontal scroll. The Downloads panel on a touch device shows a one-line note instead of two desktop installers a phone cannot use.

## How

- \`client/src/game/landingModel.ts\` — \`touch\` input and \`TOUCH_DOWNLOADS_NOTE\` in place of the cards.
- \`client/src/game/landing.ts\` — the phone-width rules.
- \`client/src/main.ts\` — passes the touch probe to the landing model.
- \`client/test/game/landingModel.test.ts\` — the note on touch, the desktop shell untouched.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Full gates and the browser gates

**Files:** none new. This task is the controller's.

- [ ] **Step 1: The three repo gates from the worktree root**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all exit 0. `forestField.test.ts` "keeps a warm one-cell-move collect fast", `clipmap.test.ts` "scrolls to exactly what a fresh build produces" and `trailWalk.test.ts` are known to flake under machine load; rerun any of those alone before believing a failure.

- [ ] **Step 2: Browser gates (controller, chrome-devtools CLI against `PORT=8080 npm run dev` from the worktree, daemon started `--isolated=true --headless=false --allowUnrestrictedPaths=true`)**

Emulate a phone: `chrome-devtools emulate <page> --viewport 390x844x3` and, for touch, dispatch `PointerEvent`s with `pointerType: "touch"` from `evaluate_script` on the canvas, the buttons and the prompt. Archive every screenshot under `~/Projects/fps-sdd-archive/2026-09-15-mobile-controls/`.

1. Landing at 390×844 and 844×390: `document.documentElement.scrollWidth <= innerWidth`, Play visible, roster readable, Downloads shows the note.
2. Game start on a touch-emulated page: `.touch.on` present, `.pausemenu` not open, `.roster.hidden` present.
3. Stick: a touch `pointerdown` at (100, 700) then `pointermove` to (100, 640): `.stick.live` present, the player's position (read via a throwaway `window.__player` hook if needed, reverted before commit) advances; `pointerup` clears the stick.
4. Sprint: two stick downs 150 ms apart with the second held and moved: distance covered in 2 s exceeds the walking distance from gate 3 by at least 25%.
5. Look and jump: a drag on the right half changes the camera yaw; two taps 150 ms apart at the same point raise the player's y within 300 ms; one drag never does.
6. Lamp: a tap on `.touch .lamp` toggles the local player's lamp; `.lamp.lit` follows; after 3 s without touches `.touch.idle` is present.
7. `?cmd=debug`: walk to the pad marker; `.prompt.on` appears with label "Interact"; a touch press on it logs `[debug] interact by` on the host page.
8. Pause: tap `.touch .pause`: `.pausemenu.open`, roster full with Copy and (if `navigator.share` exists in the emulation) Share; tap Resume: `.touch.on` without `.paused`.
9. Two pages, one phone-emulated joiner and one desktop host, on a fresh lobby: both see each other, joiner's netgraph prediction error 0.0 cm.
10. Frame time on the phone viewport at the `low` tier, reported as a number in the report, not gated.

- [ ] **Step 3: Report**

Write the gate results, screenshots and any deviation to the archive directory and summarise to the user. No commit in this task unless a gate found a defect, in which case fix it under its own task-sized commit with the same message shape.

---

## Self-review

**Spec coverage.** Detection: Task 1. Engaged state and the pause wiring: Task 4. Zones, stick, look: Task 2. Sprint, jump, lamp, pause, interact hold, idle: Task 3. Layer, styling, motion, visibility disengage, `touch-action`: Task 5. Interact prompt, `project`, `world`, `registerInteractables`: Task 6. Roster hidden/full/share and phone width: Task 7. Landing at phone width and the touch downloads note: Task 8. Gates: Task 9. The spec's "Downloads panel … one-line note" and "the roster is interactive on the pause menu" are covered (the latter was already true in `rosterModel`: `interactive: !inGame || paused`; Task 7's test pins it).

**Placeholders.** None: every code step carries the code it asks for.

**Type consistency.** `TouchSource` (Task 2) is what `InputOptions.touch` (Task 4) takes and what `createTouchModel` returns. `TouchModel.interactDown/interactUp` (Task 3) are what `createInteractPrompt`'s hooks call (Task 6). `InputSampler.engaged/engage/disengage/setTouchMode` (Task 4) are what the layer hooks and `app.ts` use (Task 5). `Projected` (Task 6) matches `renderer.project`'s return. `rosterModel`'s `touch` (Task 7) and `landingModel`'s `touch` (Task 8) are both fed from the one `touch` constant in `main.ts`.
