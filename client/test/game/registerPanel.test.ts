import { describe, expect, it } from "vitest";
import { registerPanelModel } from "../../src/game/registerPanel.js";
import type { Register } from "../../src/sim/register.js";
import { NO_CARRIER, type ItemState } from "../../src/sim/types.js";

const register: Register = {
  hikers: [
    { id: 0, name: "Dana Whitcombe", site: { kind: "summit", name: "the summit", x: 0, y: 0, z: 0, progress: 1 } },
    { id: 1, name: "Owen Marsh", site: { kind: "meadow", name: "the meadow", x: 0, y: 0, z: 0, progress: 0.5 } },
    { id: 2, name: "Ruth Petersen", site: { kind: "pond", name: "the pond", x: 0, y: 0, z: 0, progress: 0.7 } },
  ],
  box: { x: 0, y: 1, z: 0 },
  car: { x: 0, y: 0, z: 0 },
};
const item = (id: number, over: Partial<ItemState> = {}): ItemState =>
  ({ id, pos: { x: 0, y: 0, z: 0 }, carrier: NO_CARRIER, pickedUp: false, signedOut: false, ...over });

describe("registerPanelModel", () => {
  it("lists every hiker in book order with where they were last seen and their state", () => {
    const view = registerPanelModel(register, [item(0, { signedOut: true, pickedUp: true }), item(1, { carrier: 7, pickedUp: true }), item(2)], new Map([[7, "Hiker-8097"]]));
    expect(view.title).toBe("Trailhead register");
    expect(view.rows).toEqual([
      { name: "Dana Whitcombe", site: "last seen at the summit", status: "signed out" },
      { name: "Owen Marsh", site: "last seen at the meadow", status: "with Hiker-8097" },
      { name: "Ruth Petersen", site: "last seen at the pond", status: "missing" },
    ]);
    expect(view.footer).toBe("1 of 3 signed out");
  });

  it("reads 'carried' when the carrier has no name", () => {
    const view = registerPanelModel(register, [item(0, { carrier: 9 }), item(1), item(2)], new Map());
    expect(view.rows[0]!.status).toBe("carried");
  });
});
