import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { tipMotion } from "../../src/admin/charts.js";

// The admin tests run under plain Node, which has no animation frames: a hide is never due here.
const g = globalThis as unknown as Record<string, unknown>;
const had = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
beforeAll(() => {
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
});
afterAll(() => {
  g.requestAnimationFrame = had.raf;
  g.cancelAnimationFrame = had.caf;
});

/** A tooltip node with only what tipMotion touches: its classes. */
function tipNode(): { node: HTMLElement; classes: Set<string> } {
  const classes = new Set<string>();
  const classList = {
    add: (...names: string[]) => names.forEach((n) => classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
    contains: (name: string) => classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !classes.has(name);
      if (on) classes.add(name);
      else classes.delete(name);
      return on;
    },
  };
  return { node: { classList } as unknown as HTMLElement, classes };
}

describe("a tooltip's coming and going", () => {
  it("glides from one bar to the next once it is on", () => {
    const { node, classes } = tipNode();
    const tip = tipMotion(node);
    tip.show();
    expect([...classes].sort()).toEqual(["on"]);
    tip.show();
    expect([...classes].sort()).toEqual(["glide", "on"]);
  });

  it("never glides where it follows the pointer, so it keeps up with it", () => {
    const { node, classes } = tipNode();
    const tip = tipMotion(node, { glide: false });
    for (let i = 0; i < 5; i += 1) tip.show();
    expect([...classes]).toEqual(["on"]);
  });
});
