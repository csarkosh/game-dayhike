import { describe, expect, it } from "vitest";
import { graph } from "./helpers/registerGraph.js";
import { BOX_INTERACTABLE_ID, InteractKind, buildRegister, installRegister } from "../../src/sim/register.js";
import { createWorld, spawnPlayer } from "../../src/sim/world.js";
import { resolveInteract } from "../../src/sim/interact.js";
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
    const r = buildRegister({ seed: 7, graph: g, groundH: () => 0, kiosk: { x: 0, z: -20 }, car: { x: 30, z: -20 } });
    expect(r.hiker.name.length).toBeGreaterThan(0);
    expect(r.body.pos).toEqual({ x: 200, y: 0, z: 0 });
    // The stem's last edge runs +x from node 1 to the crest, so the body faces -x: yaw = -pi/2.
    expect(r.body.yaw).toBeCloseTo(-Math.PI / 2, 6);
    // The kiosk stands on the pad's -z side, so its poster faces +z: 0.55 m
    // of half-depth plus 0.05 m in front of the site, 1.4 m above the ground.
    expect(r.box.x).toBe(0);
    expect(r.box.y).toBeCloseTo(1.4, 9);
    expect(r.box.z).toBeCloseTo(-19.4, 9);
  });

  it("faces the poster back toward the pad when the kiosk stands on its +z side", () => {
    const r = buildRegister({ seed: 7, graph: graph(1), groundH: () => 2, kiosk: { x: 5, z: 7 }, car: { x: 30, z: -20 } });
    expect(r.box.x).toBe(5);
    expect(r.box.y).toBeCloseTo(3.4, 9);
    expect(r.box.z).toBeCloseTo(6.4, 9);
  });
});

describe("installRegister", () => {
  it("registers the box as the one interactable the poster hangs on", () => {
    const world = createWorld(flat, 1);
    const r = buildRegister({ seed: 7, graph: graph(1), groundH: () => 0, kiosk: { x: 0, z: -20 }, car: { x: 30, z: -20 } });
    installRegister(world, r);
    expect(world.register).toBe(r);
    const box = world.interactables.get(BOX_INTERACTABLE_ID)!;
    expect(box.kind).toBe(InteractKind.Register);
    expect(box.label).toBe("Read the poster");
    expect(box.pos).toEqual(r.box);
  });
});

describe("reading the poster", () => {
  it("resolves the poster for a player standing in front of the kiosk, facing it", () => {
    const world = createWorld(flat, 1);
    installRegister(world, buildRegister({ seed: 7, graph: graph(1), groundH: () => 0, kiosk: { x: 0, z: -20 }, car: { x: 30, z: -20 } }));
    const player = spawnPlayer(world);
    // A metre in front of the poster's face, on the flat, looking -z at it.
    player.pos = { x: 0, y: 0.9, z: -18.4 }; player.yaw = Math.PI; player.pitch = 0;
    expect(resolveInteract(world, player)?.id).toBe(BOX_INTERACTABLE_ID);
    // From the pad, 18 m away, it is out of reach.
    player.pos = { x: 0, y: 0.9, z: 0 };
    expect(resolveInteract(world, player)).toBeNull();
  });
});
