import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { seedFromToken } from "../../src/game/seed.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer } from "../../src/sim/world.js";
import type { Vec3 } from "../../src/sim/types.js";
import {
  encodeSnapshot,
  decodeSnapshot,
  POSITION_PRECISION,
  type Snapshot,
} from "../../src/net/protocol.js";

/**
 * Sends one player at `pos` through the snapshot codec and returns where the
 * receiver sees them. This is the exact path a joining client's own position
 * takes: the host encodes it, the client reconciles onto whatever decodes.
 */
function throughTheWire(pos: Vec3): Vec3 {
  const snapshot: Snapshot = {
    tick: 1,
    lastProcessedInput: 0,
    players: [
      {
        id: 1,
        pos,
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
        pitch: 0,
        health: 100,
        grounded: true,
        respawnTimer: 0,
        lamp: { on: false, charge: 1 },
        carrying: 255,
        signOutTicks: 0,
        stare: 0,
      },
    ],
    enemies: [],
    items: [],
    outcome: 0,
  };
  return decodeSnapshot(encodeSnapshot(snapshot)).players[0]!.pos;
}

function expectSurvives(pos: Vec3, label: string): void {
  const back = throughTheWire(pos);
  const tolerance = POSITION_PRECISION / 2 + 1e-9;
  expect(Math.abs(back.x - pos.x), `${label} x ${pos.x} came back as ${back.x}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(back.y - pos.y), `${label} y ${pos.y} came back as ${back.y}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(back.z - pos.z), `${label} z ${pos.z} came back as ${back.z}`).toBeLessThanOrEqual(tolerance);
}

describe("the wire carries the whole forest", () => {
  it(
    "round-trips every trailhead and trail node across a 200-seed sweep",
    () => {
      const variant = activeTerrainVariant();
      const trailGraph = variant.trailGraph!;
      let nodes = 0;
      for (let i = 0; i < 200; i++) {
        const seed = seedFromToken(`sweep${i}`);
        const graph = trailGraph(seed);
        const th = graph.trailhead;
        expectSurvives({ x: th.x, y: elevationAt(seed, th.x, th.z), z: th.z }, `seed sweep${i} trailhead`);
        for (const [n, node] of graph.nodes.entries()) {
          expectSurvives(
            { x: node.x, y: elevationAt(seed, node.x, node.z), z: node.z },
            `seed sweep${i} node ${n}`,
          );
          nodes++;
        }
      }
      expect(nodes).toBeGreaterThan(200);
    },
    300_000,
  );

  it("round-trips a player spawned in the forest on seed token probe1 (the live repro)", () => {
    const seed = seedFromToken("probe1");
    const world = createForestWorld(createForest(seed));
    const player = spawnPlayer(world);
    // The trailhead on this seed sits near x = -384: beyond the +/-256 m an
    // int16 at 1/128 m can carry. A joiner here used to be pinned to -256.
    expect(player.pos.x).toBeLessThan(-256);
    expectSurvives(player.pos, "probe1 spawn");
  });
});
