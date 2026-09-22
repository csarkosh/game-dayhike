import { describe, it, expect } from "vitest";
import { promptLabel, promptModel } from "../../src/game/interactPrompt.js";
import { INTERACT_REACH } from "../../src/sim/interact.js";
import { InteractKind } from "../../src/sim/register.js";

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

describe("promptModel at the box", () => {
  const at = { x: 100, y: 100, depth: 1.5 };

  it("names a labelled interactable from its own label, on every device", () => {
    const target = { kind: InteractKind.Debug, label: "Read the poster" };
    expect(promptModel(target, at, VIEW, false)?.label).toBe("Read the poster");
    expect(promptModel(target, at, VIEW, true)?.label).toBe("Read the poster");
  });

  it("reads the box's own label rather than a kind-specific one", () => {
    // The box is the one Register-kind interactable there is, and it carries
    // its label from the sim (`installRegister`) — no branch on the kind here.
    const box = { kind: InteractKind.Register, label: "Read the poster" };
    expect(promptModel(box, at, VIEW, false)?.label).toBe("Read the poster");
    expect(promptModel(box, at, VIEW, true)?.label).toBe("Read the poster");
  });
});
