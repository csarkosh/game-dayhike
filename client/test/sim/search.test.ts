import { describe, expect, it } from "vitest";
import { graph } from "./helpers/stemGraph.js";
import { POSTER_INTERACTABLE_ID, InteractKind, buildSearch, installSearch } from "../../src/sim/search.js";
import { createWorld, spawnPlayer } from "../../src/sim/world.js";
import { resolveInteract } from "../../src/sim/interact.js";
import { parseLevel } from "../../src/sim/level.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0]],
  enemySpawns: [],
});

/** A board at (0, -20) whose face looks toward +z: its own line runs toward -x. */
const board = { x: 0, z: -20, fx: 0, fz: 1, ax: -1, az: 0 };

describe("buildSearch", () => {
  it("names one hiker and puts the body on the crest facing down the stem", () => {
    const g = graph(1);
    const r = buildSearch({ seed: 7, graph: g, groundH: () => 0, board, car: { x: 30, z: -20 } });
    expect(r.hiker.name.length).toBeGreaterThan(0);
    expect(r.body.pos).toEqual({ x: 200, y: 0, z: 0 });
    // The stem's last edge runs +x from node 1 to the crest, so the body faces -x: yaw = -pi/2.
    expect(r.body.yaw).toBeCloseTo(-Math.PI / 2, 6);
    // The poster's sheet is 0.36 m along the board's own line from its centre,
    // 0.325 m in front of it (the boxes' half-depth and 0.05 m), 1.32 m up.
    expect(r.poster.x).toBeCloseTo(-0.36, 9);
    expect(r.poster.y).toBeCloseTo(1.32, 9);
    expect(r.poster.z).toBeCloseTo(-19.675, 9);
  });

  it("hangs the poster on the face of a board that looks any way", () => {
    const turned = { x: 5, z: 7, fx: -0.6, fz: -0.8, ax: 0.8, az: -0.6 };
    const r = buildSearch({ seed: 7, graph: graph(1), groundH: () => 2, board: turned, car: { x: 30, z: -20 } });
    expect(r.poster.x).toBeCloseTo(5.093, 9);
    expect(r.poster.y).toBeCloseTo(3.32, 9);
    expect(r.poster.z).toBeCloseTo(6.524, 9);
  });
});

describe("installSearch", () => {
  it("installs the poster as the one interactable on the board", () => {
    const world = createWorld(flat, 1);
    const r = buildSearch({ seed: 7, graph: graph(1), groundH: () => 0, board, car: { x: 30, z: -20 } });
    installSearch(world, r);
    expect(world.search).toBe(r);
    const poster = world.interactables.get(POSTER_INTERACTABLE_ID)!;
    expect(poster.kind).toBe(InteractKind.Poster);
    expect(poster.label).toBe("Read the poster");
    expect(poster.pos).toEqual(r.poster);
  });
});

describe("the poster on the wire", () => {
  it("keeps the numbers a peer on the same protocol expects", () => {
    // An Interacted event carries both. They were 2 and 2 under the module's
    // old name, and a rename must not move them.
    expect(InteractKind.Poster).toBe(2);
    expect(POSTER_INTERACTABLE_ID).toBe(2);
  });
});

describe("reading the poster", () => {
  it("resolves the poster for a player standing in front of the poster, facing it", () => {
    const world = createWorld(flat, 1);
    installSearch(world, buildSearch({ seed: 7, graph: graph(1), groundH: () => 0, board, car: { x: 30, z: -20 } }));
    const player = spawnPlayer(world);
    // A metre in front of the poster's point, on the flat, looking -z at it.
    player.pos = { x: -0.36, y: 0.9, z: -18.675 }; player.yaw = Math.PI; player.pitch = 0;
    expect(resolveInteract(world, player)?.id).toBe(POSTER_INTERACTABLE_ID);
    // From the pad, 18 m away, it is out of reach.
    player.pos = { x: 0, y: 0.9, z: 0 };
    expect(resolveInteract(world, player)).toBeNull();
  });
});
