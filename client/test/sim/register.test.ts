import { describe, expect, it } from "vitest";
import { graph } from "./helpers/registerGraph.js";
import { BOX_INTERACTABLE_ID, InteractKind, buildRegister, installRegister } from "../../src/sim/register.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0]],
  enemySpawns: [],
});

describe("buildRegister", () => {
  it("names one hiker and puts the body on the crest facing down the stem", () => {
    const g = graph(1);
    const r = buildRegister({ seed: 7, graph: g, groundH: () => 0, box: { x: 0, z: -20 }, car: { x: 30, z: -20 } });
    expect(r.hiker.name.length).toBeGreaterThan(0);
    expect(r.body.pos).toEqual({ x: 200, y: 0, z: 0 });
    // The stem's last edge runs +x from node 1 to the crest, so the body faces -x: yaw = -pi/2.
    expect(r.body.yaw).toBeCloseTo(-Math.PI / 2, 6);
    expect(r.box).toEqual({ x: 0, y: 1, z: -20 });
  });
});

describe("installRegister", () => {
  it("registers the box as the one interactable the poster hangs on", () => {
    const world = createWorld(flat, 1);
    const r = buildRegister({ seed: 7, graph: graph(1), groundH: () => 0, box: { x: 0, z: -20 }, car: { x: 30, z: -20 } });
    installRegister(world, r);
    expect(world.register).toBe(r);
    const box = world.interactables.get(BOX_INTERACTABLE_ID)!;
    expect(box.kind).toBe(InteractKind.Register);
    expect(box.label).toBe("Read the poster");
    expect(box.pos).toEqual(r.box);
  });
});
