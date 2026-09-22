import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { graph } from "./helpers/registerGraph.js";
import { BOX_INTERACTABLE_ID, InteractKind, buildRegister, installRegister } from "../../src/sim/register.js";
import { createWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { PROPS, propSite } from "../../src/sim/passes/trailhead.js";
import { DEFAULT_TERRAIN_VARIANT, activeTerrainVariant, elevationAt, setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

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

/**
 * The register on real worlds. The hand-built graph above pins the rule at
 * known numbers; only a sweep over the generator's own worlds can say the
 * crest and the stem's last edge are there to read on every seed a lobby
 * can draw.
 *
 * Ten minutes, not because the sweep takes them — 227 worlds build in about
 * 170 s on their own — but because vitest runs this file beside the other
 * sweeps, and the contention stretches it past a 300 s guard. The timeout is
 * there to catch a hang, not to fence the run time.
 */
describe("the register over the 227-seed sweep", { timeout: 600_000 }, () => {
  it("names one hiker on every world and puts the body on the crest, facing back down the stem", () => {
    for (const seed of SEEDS) {
      const { graph } = bowlFor(seed);
      const site = (i: number) => propSite(graph, activeTerrainVariant().roadCenterX!, seed, PROPS[i]!);
      const r = buildRegister({ seed, graph, groundH: (x, z) => elevationAt(seed, x, z), box: site(0), car: site(2) });
      expect(r.hiker.name.length, `seed ${seed}`).toBeGreaterThan(0);
      const crest = graph.nodes[graph.summit]!;
      expect(r.body.pos.x).toBe(crest.x);
      expect(r.body.pos.z).toBe(crest.z);
      expect(Number.isFinite(r.body.yaw)).toBe(true);
    }
  });
});
