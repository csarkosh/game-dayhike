import { describe, it, expect } from "vitest";
import { promptLabel, promptModel } from "../../src/game/interactPrompt.js";
import { INTERACT_REACH } from "../../src/sim/interact.js";
import { InteractKind } from "../../src/sim/register.js";

const VIEW = { width: 800, height: 400 };
const CTX = { carrying: null, hold: 0 };

describe("promptModel", () => {
  it("is null with nothing in reach", () => {
    expect(promptModel(null, { x: 1, y: 1, depth: 1 }, VIEW, true, CTX)).toBeNull();
  });
  it("is null when the target is behind the camera", () => {
    expect(promptModel({ kind: 0 }, null, VIEW, true, CTX)).toBeNull();
  });
  it("labels a plain interactable, with a click hint on desktop only", () => {
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 1 }, VIEW, true, CTX)?.label).toBe("Interact");
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 1 }, VIEW, false, CTX)?.label).toBe("Click to interact");
    expect(promptLabel(0)).toBe("Interact");
    expect(promptLabel(99)).toBe("Interact");
  });
  it("scales from 1 at one metre to 0.7 at reach", () => {
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 1 }, VIEW, true, CTX)?.scale).toBeCloseTo(1, 9);
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: INTERACT_REACH }, VIEW, true, CTX)?.scale).toBeCloseTo(0.7, 9);
    expect(promptModel({ kind: 0 }, { x: 400, y: 200, depth: 0.2 }, VIEW, true, CTX)?.scale).toBeCloseTo(1, 9);
  });
  it("clamps the anchor 24 px inside the viewport", () => {
    const v = promptModel({ kind: 0 }, { x: -50, y: 900, depth: 1 }, VIEW, true, CTX);
    expect(v).toEqual({ x: 24, y: 376, label: "Interact", scale: 1, hold: 0 });
  });
});

describe("promptModel with the register", () => {
  const at = { x: 100, y: 100, depth: 1.5 };

  it("names the item from the interactable's label, on every device", () => {
    const target = { kind: InteractKind.Item, label: "Pick up Dana Whitcombe" };
    expect(promptModel(target, at, VIEW, false, { carrying: null, hold: 0 })?.label).toBe("Pick up Dana Whitcombe");
    expect(promptModel(target, at, VIEW, true, { carrying: null, hold: 0 })?.label).toBe("Pick up Dana Whitcombe");
  });

  it("offers the book with empty hands and the sign-out while carrying", () => {
    const box = { kind: InteractKind.Register, label: "Read the register" };
    expect(promptModel(box, at, VIEW, false, { carrying: null, hold: 0 })?.label).toBe("Read the register");
    expect(promptModel(box, at, VIEW, false, { carrying: "Dana Whitcombe", hold: 0 })?.label).toBe("Sign out Dana Whitcombe — hold");
  });

  it("carries the hold, clamped, only at the box", () => {
    const box = { kind: InteractKind.Register, label: "Read the register" };
    expect(promptModel(box, at, VIEW, false, { carrying: "Dana Whitcombe", hold: 0.4 })?.hold).toBe(0.4);
    expect(promptModel(box, at, VIEW, false, { carrying: "Dana Whitcombe", hold: 1.7 })?.hold).toBe(1);
    expect(promptModel({ kind: InteractKind.Item, label: "Pick up X" }, at, VIEW, false, { carrying: null, hold: 0.4 })?.hold).toBe(0);
  });
});
