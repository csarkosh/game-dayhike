import { describe, expect, it } from "vitest";
import type { TrailGraph, TrailEdge } from "../../src/sim/trail.js";
import type { Landmark } from "../../src/sim/landmarks.js";
import {
  BOX_INTERACTABLE_ID, ITEM_INTERACTABLE_BASE, ITEM_RADIUS, InteractKind, MIN_SITES, SITE_SPACING,
  buildRegister, installRegister, siteDisplayName, syncItemInteractables,
} from "../../src/sim/register.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { NO_CARRIER } from "../../src/sim/types.js";

const flat = parseLevel({
  id: "flat",
  brushes: [{ min: [-60, -1, -60], max: [60, 0, 60], material: "concrete" }],
  playerSpawns: [[0, 0.9, 0]],
  enemySpawns: [],
});

/** Straight stem 0→1→2 along +x (progress 0, 0.5, 1); loops 1→3→4→2 round a meadow at (150, 60) and 1→5→6→2 round one at (150, -60). */
export function graph(loops: 0 | 1 | 2): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 200, z: 0, h: 0, u: 0 },
    { x: 120, z: 50, h: 0, u: 0 }, { x: 180, z: 50, h: 0, u: 0 },
    { x: 120, z: -50, h: 0, u: 0 }, { x: 180, z: -50, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number, kind: TrailEdge["kind"], p0: number, p1: number): TrailEdge =>
    ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: p0, progress1: p1 });
  const edges = [edge(0, 1, "stem", 0, 0.5), edge(1, 2, "stem", 0.5, 1)];
  const g: TrailGraph = {
    nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1], loops: [], stemLen: 200,
    features: [{ id: 0, kind: "peak", x: 200, z: 0, radius: 300, height: 60 }], fallbacks: 0,
  };
  if (loops >= 1) {
    edges.push(edge(1, 3, "loop", 0.5, 0.5), edge(3, 4, "loop", 0.5, 0.5), edge(4, 2, "loop", 1, 1));
    g.features.push({ id: 1, kind: "meadow", x: 150, z: 60, radius: 60, height: 0 });
    g.loops.push({ kind: "meadow", featureId: 1, edges: [2, 3, 4], junctionA: 1, junctionB: 2 });
  }
  if (loops >= 2) {
    edges.push(edge(1, 5, "loop", 0.5, 0.5), edge(5, 6, "loop", 0.5, 0.5), edge(6, 2, "loop", 1, 1));
    g.features.push({ id: 2, kind: "meadow", x: 150, z: -60, radius: 60, height: 0 });
    g.loops.push({ kind: "meadow", featureId: 2, edges: [5, 6, 7], junctionA: 1, junctionB: 2 });
  }
  return g;
}
const stand: Landmark = { type: "stand", x: 60, z: 30, carved: false, discX: 60, discZ: 30 };
const talus: Landmark = { type: "talus", x: 140, z: -40, carved: true, discX: 140, discZ: -70 };
const input = (g: TrailGraph, landmarks: Landmark[]) => ({
  seed: 99, graph: g, landmarks, groundH: () => 10, box: { x: -5, z: -7 }, car: { x: -8, z: 12 },
});

describe("buildRegister", () => {
  it("makes the summit a site and one site per built loop, items on the loop's nearest point to its feature", () => {
    const r = buildRegister(input(graph(1), [stand, talus]));
    expect(r.hikers.map((h) => h.site.kind)).toEqual(["summit", "meadow"]);
    expect(r.hikers[0]!.site).toMatchObject({ x: 200, z: 0, y: 10, progress: 1 });
    // The meadow at (150, 60): the loop's top edge 3→4 runs z = 50, so the
    // nearest point is (150, 50).
    expect(r.hikers[1]!.site).toMatchObject({ x: 150, z: 50, y: 10 });
  });

  it("falls back to the stand, then the talus, to reach two sites, on the trail's nearest point", () => {
    const withStand = buildRegister(input(graph(0), [stand, talus]));
    expect(withStand.hikers).toHaveLength(MIN_SITES);
    expect(withStand.hikers[1]!.site).toMatchObject({ kind: "stand", x: 60, z: 0 });
    const talusOnly = buildRegister(input(graph(0), [talus]));
    expect(talusOnly.hikers[1]!.site).toMatchObject({ kind: "talus", x: 140, z: 0 });
    expect(buildRegister(input(graph(1), [stand, talus])).hikers.map((h) => h.site.kind)).not.toContain("stand");
  });

  it("keeps a fallback site off the summit's doorstep when the landmark stands past the crest", () => {
    // A stand 30 m beyond the crest projects onto the summit node itself;
    // the site must move back down the stem instead.
    const past: Landmark = { type: "stand", x: 230, z: 0, carved: false, discX: 230, discZ: 0 };
    const r = buildRegister(input(graph(0), [past]));
    expect(r.hikers).toHaveLength(2);
    const s = r.hikers[1]!.site;
    expect(s.kind).toBe("stand");
    expect(Math.abs(s.x - 200)).toBeGreaterThanOrEqual(SITE_SPACING);
    expect(s.z).toBe(0);
  });

  it("tells two sites of one kind apart by their place along the stem", () => {
    const r = buildRegister(input(graph(2), []));
    const names = r.hikers.map((h) => h.site.name);
    expect(names).toEqual(["the summit", "the lower meadow", "the upper meadow"]);
  });

  it("names every site for the book", () => {
    expect(siteDisplayName("summit", 0, 1)).toBe("the summit");
    expect(siteDisplayName("pond", 0, 1)).toBe("the pond");
    expect(siteDisplayName("stand", 0, 1)).toBe("the old stand");
    expect(siteDisplayName("talus", 0, 1)).toBe("the talus field");
    expect(siteDisplayName("meadow", 1, 3)).toBe("the middle meadow");
  });

  it("gives every hiker a seeded name, the same on every machine", () => {
    const a = buildRegister(input(graph(1), []));
    const b = buildRegister(input(graph(1), []));
    expect(a.hikers.map((h) => h.name)).toEqual(b.hikers.map((h) => h.name));
    expect(a.hikers[0]!.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("places the box at chest height on the post and the car at its centre", () => {
    const r = buildRegister(input(graph(1), []));
    expect(r.box).toEqual({ x: -5, y: 11, z: -7 });
    expect(r.car).toEqual({ x: -8, y: 10.8, z: 12 });
  });
});

describe("installRegister", () => {
  it("lays one item per hiker at its site and registers the box and the items as interactables", () => {
    const world = createWorld(flat, 1);
    const r = buildRegister(input(graph(1), []));
    installRegister(world, r);
    expect(world.register).toBe(r);
    expect(world.state.items).toHaveLength(2);
    expect(world.state.items[1]).toEqual({ id: 1, pos: { x: 150, y: 10 + ITEM_RADIUS, z: 50 }, carrier: NO_CARRIER, pickedUp: false, signedOut: false });
    const box = world.interactables.get(BOX_INTERACTABLE_ID)!;
    expect(box.kind).toBe(InteractKind.Register);
    expect(box.label).toBe("Read the register");
    const item = world.interactables.get(ITEM_INTERACTABLE_BASE + 1)!;
    expect(item.kind).toBe(InteractKind.Item);
    expect(item.label).toBe(`Pick up ${r.hikers[1]!.name}`);
    expect(item.enabled).toBe(true);
  });

  it("disables a carried or signed-out item's interactable and moves it with the item", () => {
    const world = createWorld(flat, 1);
    installRegister(world, buildRegister(input(graph(1), [])));
    world.state.items[0]!.carrier = 7;
    world.state.items[1]!.pos = { x: 1, y: 2, z: 3 };
    syncItemInteractables(world);
    expect(world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
    expect(world.interactables.get(ITEM_INTERACTABLE_BASE + 1)!.pos).toEqual({ x: 1, y: 2, z: 3 });
    world.state.items[0]!.carrier = NO_CARRIER;
    world.state.items[0]!.signedOut = true;
    syncItemInteractables(world);
    expect(world.interactables.get(ITEM_INTERACTABLE_BASE)!.enabled).toBe(false);
  });
});
