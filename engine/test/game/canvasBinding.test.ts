import { describe, it, expect } from "vitest";
import { bindCanvas } from "../../src/game/canvasBinding.js";

function target() {
  const live = new Map<string, EventListener>();
  return {
    live,
    addEventListener: (type: string, fn: EventListener) => void live.set(type, fn),
    removeEventListener: (type: string, fn: EventListener) => {
      if (live.get(type) === fn) live.delete(type);
    },
  };
}

describe("bindCanvas", () => {
  it("moves every listener to the new canvas and off the old one", () => {
    const a = target();
    const b = target();
    const down: EventListener = () => undefined;
    const click: EventListener = () => undefined;
    const binding = bindCanvas(a as unknown as HTMLCanvasElement, { pointerdown: down, click });
    expect([...a.live.keys()]).toEqual(["pointerdown", "click"]);
    binding.rebind(b as unknown as HTMLCanvasElement);
    expect(a.live.size).toBe(0);
    expect(b.live.get("pointerdown")).toBe(down);
    expect(b.live.get("click")).toBe(click);
    expect(binding.canvas).toBe(b);
    binding.dispose();
    expect(b.live.size).toBe(0);
  });
});
