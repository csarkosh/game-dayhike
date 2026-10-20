import { expect } from "vitest";
import "../../src/sim/passes/index.js";
import { activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { seedFromToken } from "../../src/game/seed.js";
import type { Vec3 } from "../../src/sim/types.js";
import {
  encodeSnapshot,
  decodeSnapshot,
  POSITION_PRECISION,
  type Snapshot,
} from "../../src/net/protocol.js";
import { seedPart } from "../helpers/seedPart.js";

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
        lamp: { on: false, charge: 1 },
        safe: false,
        stare: 0,
      },
    ],
    enemies: [],
    outcome: 0,
    phase: 0,
  };
  return decodeSnapshot(encodeSnapshot(snapshot)).players[0]!.pos;
}

/** That `pos` comes back through the wire within half its precision, on each axis; shared with `wireRange.test.ts`. */
export function expectSurvives(pos: Vec3, label: string): void {
  const back = throughTheWire(pos);
  const tolerance = POSITION_PRECISION / 2 + 1e-9;
  expect(Math.abs(back.x - pos.x), `${label} x ${pos.x} came back as ${back.x}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(back.y - pos.y), `${label} y ${pos.y} came back as ${back.y}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(back.z - pos.z), `${label} z ${pos.z} came back as ${back.z}`).toBeLessThanOrEqual(tolerance);
}

/** The parts the sweep is split into, one test file each (`wireRangeSweep.part<k>.test.ts`). */
export const WIRE_PARTS = 5;

/** The 200 worlds' tokens, `sweep0` to `sweep199`. */
const TOKENS = Array.from({ length: 200 }, (_, i) => `sweep${i}`);

/**
 * The wire over 200 worlds: every trailhead and trail node, at the ground's
 * height there, round-trips the snapshot codec. Every check is a node's own,
 * so the parts check together what the sweep whole did (`seedPart`), but for
 * the count of nodes, which the sweep held above 200 and each part holds
 * above its share of that, 200 over the parts rounded up, so the parts
 * together hold at least what the sweep whole did. The 200 trails build in
 * about 260 s on a CI runner, which made the sweep, as one test, one of the
 * floors under the client suite: vitest hands out files, not tests.
 */
export function checkWirePart(part: number): void {
  const variant = activeTerrainVariant();
  const trailGraph = variant.trailGraph!;
  let nodes = 0;
  for (const token of seedPart(TOKENS, part, WIRE_PARTS)) {
    const seed = seedFromToken(token);
    const graph = trailGraph(seed);
    const th = graph.trailhead;
    expectSurvives({ x: th.x, y: elevationAt(seed, th.x, th.z), z: th.z }, `seed ${token} trailhead`);
    for (const [n, node] of graph.nodes.entries()) {
      expectSurvives(
        { x: node.x, y: elevationAt(seed, node.x, node.z), z: node.z },
        `seed ${token} node ${n}`,
      );
      nodes++;
    }
  }
  expect(nodes).toBeGreaterThan(Math.ceil(200 / WIRE_PARTS));
}
