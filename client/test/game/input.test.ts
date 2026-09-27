import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInputSampler } from "../../src/game/input.js";
import { createTouchModel } from "../../src/game/touchControls.js";

type Listener = (e: unknown) => void;
const listeners = new Map<string, Listener[]>();

function fakeTarget() {
  return {
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener() {},
  };
}

function fire(type: string, event: unknown) {
  for (const fn of listeners.get(type) ?? []) fn(event);
}

beforeEach(() => {
  listeners.clear();
  (globalThis as Record<string, unknown>).window = fakeTarget();
  (globalThis as Record<string, unknown>).document = { ...fakeTarget(), pointerLockElement: null };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

function sampler(opts: { touch?: import("../../src/game/touchControls.js").TouchSource; touchMode?: boolean } = {}) {
  const canvas = { ...fakeTarget(), requestPointerLock: () => undefined };
  return { input: createInputSampler(canvas as unknown as HTMLCanvasElement, opts), canvas };
}

/**
 * Enters pointer lock, which is what gates mouse-look accumulation: `onMouseMove`
 * ignores every event until `pointerlockchange` reports the canvas as locked.
 */
function lockPointer(canvas: object): void {
  const doc = (globalThis as Record<string, unknown>).document as { pointerLockElement: unknown };
  doc.pointerLockElement = canvas;
  fire("pointerlockchange", {});
}

describe("input suppression", () => {
  it("reports movement and buttons normally when not suppressed", () => {
    const { input } = sampler();
    fire("keydown", { code: "KeyW", preventDefault() {} });
    expect(input.sample(1).moveZ).toBe(1);
  });

  it("reports neutral movement while suppressed", () => {
    // Typing "freecam" would otherwise strafe left on the `A` and reload on the `R`.
    const { input } = sampler();
    fire("keydown", { code: "KeyA", preventDefault() {} });
    fire("keydown", { code: "KeyR", preventDefault() {} });
    input.setSuppressed(true);
    const cmd = input.sample(1);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveZ).toBe(0);
    expect(cmd.buttons).toBe(0);
  });

  it("preserves aim while suppressed, so the player does not snap round", () => {
    const { input, canvas } = sampler();
    // Aim has to be genuinely non-zero first. Asserting that a suppressed sample
    // equals the one before it passes trivially against an implementation that
    // returns a hardcoded yaw and pitch of 0 — which is the failure this test is
    // the only guard against.
    lockPointer(canvas);
    fire("mousemove", { movementX: 240, movementY: -90 });
    const aimed = input.sample(1);
    expect(aimed.yaw).not.toBe(0);
    expect(aimed.pitch).not.toBe(0);

    input.setSuppressed(true);
    const suppressed = input.sample(2);
    expect(suppressed.yaw).toBe(aimed.yaw);
    expect(suppressed.pitch).toBe(aimed.pitch);
  });

  it("resumes normal sampling when unsuppressed", () => {
    const { input } = sampler();
    fire("keydown", { code: "KeyW", preventDefault() {} });
    input.setSuppressed(true);
    expect(input.sample(1).moveZ).toBe(0);
    input.setSuppressed(false);
    expect(input.sample(2).moveZ).toBe(1);
  });

  it("exposes held keys, so freecam reads the same set the sampler does", () => {
    const { input } = sampler();
    fire("keydown", { code: "KeyJ", preventDefault() {} });
    expect(input.keys.has("KeyJ")).toBe(true);
    fire("keyup", { code: "KeyJ" });
    expect(input.keys.has("KeyJ")).toBe(false);
  });

  it("lets Space reach the command bar while suppressed, instead of preventDefault swallowing it", () => {
    const { input } = sampler();
    input.setSuppressed(true);
    let prevented = false;
    fire("keydown", { code: "Space", preventDefault: () => (prevented = true) });
    expect(prevented).toBe(false);
  });

  it("still blocks Space from scrolling the page when not suppressed", () => {
    const { input } = sampler();
    expect(input.suppressed).toBe(false);
    let prevented = false;
    fire("keydown", { code: "Space", preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });

  it("releases the pointer voluntarily on Escape while locked", () => {
    // In the browser Chromium ejects the lock itself before the page sees the
    // key, so this is a no-op there. In the Electron shell nothing ejects it:
    // this release is the only thing that opens the pause menu on Esc.
    const { canvas } = sampler();
    const doc = (globalThis as Record<string, unknown>).document as {
      exitPointerLock?: () => void;
    };
    let exits = 0;
    doc.exitPointerLock = () => {
      exits += 1;
    };
    lockPointer(canvas);
    fire("keydown", { code: "Escape", preventDefault() {} });
    expect(exits).toBe(1);
  });

  it("leaves Escape alone while suppressed, so the command bar owns it", () => {
    const { input, canvas } = sampler();
    const doc = (globalThis as Record<string, unknown>).document as {
      exitPointerLock?: () => void;
    };
    let exits = 0;
    doc.exitPointerLock = () => {
      exits += 1;
    };
    lockPointer(canvas);
    input.setSuppressed(true);
    fire("keydown", { code: "Escape", preventDefault() {} });
    expect(exits).toBe(0);
  });

  it("does nothing on Escape while not locked", () => {
    sampler();
    const doc = (globalThis as Record<string, unknown>).document as {
      exitPointerLock?: () => void;
    };
    let exits = 0;
    doc.exitPointerLock = () => {
      exits += 1;
    };
    fire("keydown", { code: "Escape", preventDefault() {} });
    expect(exits).toBe(0);
  });
});

describe("presses aimed at a form control", () => {
  // A select's open list, the command bar's field and the like take the
  // keyboard and the mouse for themselves, and can keep the matching release
  // from the page: a press recorded there could stay held after Resume.
  const controls = [
    { tagName: "SELECT" },
    { tagName: "OPTION" },
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "DIV", isContentEditable: true },
  ];
  const canvasTarget = { tagName: "CANVAS", isContentEditable: false };

  it("are never game presses, even when their release never comes", () => {
    for (const target of controls) {
      listeners.clear();
      const { input } = sampler();
      input.setSuppressed(true);
      fire("keydown", { code: "Space", target, preventDefault() {} });
      fire("keydown", { code: "KeyW", target, preventDefault() {} });
      fire("mousedown", { button: 0, target });
      input.setSuppressed(false);
      expect(input.keys.has("Space")).toBe(false);
      expect(input.keys.has("KeyW")).toBe(false);
      const cmd = input.sample(1);
      expect(cmd.buttons).toBe(0);
      expect(cmd.moveZ).toBe(0);
    }
  });

  it("are not swallowed either: Space and Tab typed into one keep their default", () => {
    const { input } = sampler();
    expect(input.suppressed).toBe(false);
    let prevented = 0;
    for (const code of ["Space", "Tab"]) fire("keydown", { code, target: { tagName: "INPUT" }, preventDefault: () => (prevented += 1) });
    expect(prevented).toBe(0);
  });

  it("do not stop a key or button pressed in the game from being released over one", () => {
    const { input } = sampler();
    fire("keydown", { code: "KeyW", target: canvasTarget, preventDefault() {} });
    fire("mousedown", { button: 0, target: canvasTarget });
    expect(input.sample(1).moveZ).toBe(1);
    expect(input.sample(2).buttons).toBe(1);
    fire("keyup", { code: "KeyW", target: { tagName: "SELECT" } });
    fire("mouseup", { button: 0, target: { tagName: "SELECT" } });
    expect(input.keys.has("KeyW")).toBe(false);
    const cmd = input.sample(3);
    expect(cmd.moveZ).toBe(0);
    expect(cmd.buttons).toBe(0);
  });

  it("leave a key pressed in the game tracked through the menu, as before", () => {
    const { input } = sampler();
    fire("keydown", { code: "KeyW", target: canvasTarget, preventDefault() {} });
    input.setSuppressed(true);
    fire("keydown", { code: "KeyS", target: { tagName: "SELECT" }, preventDefault() {} });
    input.setSuppressed(false);
    expect(input.sample(1).moveZ).toBe(1);
  });
});

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

  it("losing pointer lock in touch mode disengages, regaining it engages", () => {
    // A hybrid device: a touch-screen laptop that started in desktop mode and
    // took a touch, which flips touchMode on while a real pointer lock still
    // exists underneath. Esc dropping that lock must still open the pause
    // menu, and getting it back must still resume play.
    const { input, canvas } = sampler({ touch: fakeTouch().source, touchMode: true });
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    const doc = (globalThis as Record<string, unknown>).document as { pointerLockElement: unknown };

    lockPointer(canvas);
    expect(input.engaged).toBe(true);
    expect(seen).toEqual([]);

    doc.pointerLockElement = null;
    fire("pointerlockchange", {});
    expect(input.engaged).toBe(false);
    expect(seen).toEqual([false]);

    lockPointer(canvas);
    expect(input.engaged).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it("setTouchMode(true) while pointer-locked keeps engaged true and announces nothing", () => {
    const { input, canvas } = sampler({ touch: fakeTouch().source });
    lockPointer(canvas);
    expect(input.engaged).toBe(true);
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    input.setTouchMode(true);
    expect(input.engaged).toBe(true);
    expect(seen).toEqual([]);
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

  it("switching touch mode off announces the drop to desktop's unlocked state once", () => {
    const { input } = sampler({ touch: fakeTouch().source, touchMode: true });
    expect(input.engaged).toBe(true);
    const seen: boolean[] = [];
    input.onEngagedChange((e) => seen.push(e));
    input.setTouchMode(false);
    expect(input.engaged).toBe(false);
    expect(seen).toEqual([false]);
    input.setTouchMode(false);
    expect(seen).toEqual([false]);
  });
});

describe("pointer lock is a mouse affair", () => {
  function lockRequests(canvas: object): () => number {
    let n = 0;
    (canvas as { requestPointerLock: () => void }).requestPointerLock = () => {
      n++;
    };
    return () => n;
  }

  it("does not request pointer lock for a click that came from a touch, in touch mode", () => {
    // Chrome on Android grants pointer lock to a tap and shows a "to show your
    // cursor" toast; the lock then drops and takes the touch controls with it.
    const { input, canvas } = sampler({ touch: fakeTouch().source, touchMode: true });
    const requests = lockRequests(canvas);
    fire("pointerdown", { pointerType: "touch" });
    fire("click", {});
    expect(requests()).toBe(0);
    expect(input.engaged).toBe(true);
  });

  it("does not request pointer lock for a touch click on desktop either", () => {
    const { canvas } = sampler();
    const requests = lockRequests(canvas);
    fire("pointerdown", { pointerType: "touch" });
    fire("click", {});
    expect(requests()).toBe(0);
  });

  it("still requests pointer lock for a mouse click, in touch mode and out of it", () => {
    const desktop = sampler();
    const desktopRequests = lockRequests(desktop.canvas);
    fire("pointerdown", { pointerType: "mouse" });
    fire("click", {});
    expect(desktopRequests()).toBe(1);

    listeners.clear();
    const hybrid = sampler({ touch: fakeTouch().source, touchMode: true });
    const hybridRequests = lockRequests(hybrid.canvas);
    fire("pointerdown", { pointerType: "mouse" });
    fire("click", {});
    expect(hybridRequests()).toBe(1);
  });

  it("a click with no pointerdown before it (keyboard activation) still requests the lock", () => {
    const { canvas } = sampler();
    const requests = lockRequests(canvas);
    fire("click", {});
    expect(requests()).toBe(1);
  });
});

describe("a refused pointer lock never surfaces as an unhandled rejection", () => {
  // `unhandledRejection` fires on a later task than the rejection itself, so a
  // macrotask boundary (setTimeout) is always after it; a bare microtask flush
  // is not reliably late enough under Node's implementation. This is the only
  // one of the three refusals that is actually asynchronous, so it is the only
  // one that needs this wait.
  async function flushPendingRejections(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function watchUnhandledRejections(): { rejections: unknown[]; stop: () => void } {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    return { rejections, stop: () => process.off("unhandledRejection", onUnhandled) };
  }

  it("catches a click's rejected requestPointerLock", async () => {
    const { canvas } = sampler();
    (canvas as unknown as { requestPointerLock: () => Promise<never> }).requestPointerLock = () =>
      Promise.reject(new Error("WrongDocumentError: The root document of this element is not valid for pointer lock."));
    const watch = watchUnhandledRejections();
    fire("pointerdown", { pointerType: "mouse" });
    fire("click", {});
    await flushPendingRejections();
    watch.stop();
    expect(watch.rejections).toEqual([]);
  });

  it("does not throw when a click's requestPointerLock returns nothing (older browsers)", () => {
    const { canvas } = sampler();
    (canvas as { requestPointerLock: () => undefined }).requestPointerLock = () => undefined;
    fire("pointerdown", { pointerType: "mouse" });
    expect(() => fire("click", {})).not.toThrow();
  });

  it("does not throw when a click's requestPointerLock throws synchronously", () => {
    const { canvas } = sampler();
    (canvas as { requestPointerLock: () => void }).requestPointerLock = () => {
      throw new Error("WrongDocumentError");
    };
    fire("pointerdown", { pointerType: "mouse" });
    expect(() => fire("click", {})).not.toThrow();
  });

  it("engage() survives the same three refusals as the click path", async () => {
    const rejecting = sampler();
    (rejecting.canvas as unknown as { requestPointerLock: () => Promise<never> }).requestPointerLock = () =>
      Promise.reject(new Error("WrongDocumentError"));
    const watch = watchUnhandledRejections();
    rejecting.input.engage();
    await flushPendingRejections();
    watch.stop();
    expect(watch.rejections).toEqual([]);

    const returningNothing = sampler();
    (returningNothing.canvas as { requestPointerLock: () => undefined }).requestPointerLock = () => undefined;
    expect(() => returningNothing.input.engage()).not.toThrow();

    const throwing = sampler();
    (throwing.canvas as { requestPointerLock: () => void }).requestPointerLock = () => {
      throw new Error("WrongDocumentError");
    };
    expect(() => throwing.input.engage()).not.toThrow();
  });
});

describe("mouse look has no flick", () => {
  it("stops the instant the mouse does, with a live touch model ticking beside it", () => {
    const touch = createTouchModel({ width: 800, height: 400 }, { onPause: () => undefined });
    const { input, canvas } = sampler({ touch });
    lockPointer(canvas);
    for (let i = 1; i <= 6; i++) {
      fire("mousemove", { movementX: 60, movementY: 0 });
      touch.tick(i * 16);
    }
    const moved = input.sample(1);
    expect(moved.yaw).not.toBe(0);
    for (let i = 7; i <= 200; i++) touch.tick(i * 16);
    expect(input.sample(2).yaw).toBe(moved.yaw);
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

describe("rebinding to a fresh canvas", () => {
  /** A canvas of its own: its listeners kept apart from the window's. */
  function ownCanvas() {
    const live = new Map<string, Listener>();
    let locks = 0;
    return {
      live,
      locks: () => locks,
      addEventListener: (type: string, fn: Listener) => void live.set(type, fn),
      removeEventListener: (type: string, fn: Listener) => {
        if (live.get(type) === fn) live.delete(type);
      },
      requestPointerLock: () => {
        locks += 1;
      },
    };
  }

  it("keeps the aim, follows the pointer lock to the new canvas, and moves its listeners there", () => {
    const old = ownCanvas();
    const input = createInputSampler(old as unknown as HTMLCanvasElement);
    lockPointer(old);
    fire("mousemove", { movementX: 100, movementY: 40 });
    const before = input.sample(1);
    expect(before.yaw).not.toBe(0);
    // The old canvas leaves the page and the browser drops the lock with it.
    const doc = (globalThis as Record<string, unknown>).document as { pointerLockElement: unknown };
    doc.pointerLockElement = null;
    fire("pointerlockchange", {});
    expect(input.engaged).toBe(false);

    const fresh = ownCanvas();
    input.rebind(fresh as unknown as HTMLCanvasElement);
    expect(old.live.size).toBe(0);
    expect([...fresh.live.keys()].sort()).toEqual(["click", "pointerdown"]);
    // A click on the new canvas asks for the lock there; the old one is gone.
    fresh.live.get("pointerdown")!({ pointerType: "mouse" });
    fresh.live.get("click")!({});
    expect(fresh.locks()).toBe(1);
    input.engage();
    expect(fresh.locks()).toBe(2);
    expect(old.locks()).toBe(0);

    lockPointer(fresh);
    expect(input.engaged).toBe(true);
    lockPointer(old);
    expect(input.engaged).toBe(false);
    lockPointer(fresh);
    const after = input.sample(2);
    expect(after.yaw).toBe(before.yaw);
    expect(after.pitch).toBe(before.pitch);
    fire("keydown", { code: "KeyW", preventDefault() {} });
    expect(input.sample(3).moveZ).toBe(1);
  });

  it("announces a lock the new canvas already holds", () => {
    const old = ownCanvas();
    const input = createInputSampler(old as unknown as HTMLCanvasElement);
    const seen: boolean[] = [];
    input.onEngagedChange((engaged) => seen.push(engaged));
    const fresh = ownCanvas();
    const doc = (globalThis as Record<string, unknown>).document as { pointerLockElement: unknown };
    doc.pointerLockElement = fresh;
    input.rebind(fresh as unknown as HTMLCanvasElement);
    expect(input.engaged).toBe(true);
    expect(seen).toEqual([true]);
  });
});
