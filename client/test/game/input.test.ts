import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInputSampler } from "../../src/game/input.js";

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

function sampler() {
  const canvas = { ...fakeTarget(), requestPointerLock: () => undefined };
  return { input: createInputSampler(canvas as unknown as HTMLCanvasElement), canvas };
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
