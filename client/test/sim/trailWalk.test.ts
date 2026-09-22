import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { elevationSampleAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { PLAYER_HALF } from "../../src/sim/constants.js";
import { MAX_WALKABLE_GRADIENT } from "../../src/sim/ground.js";
import { Phase, type InputCommand } from "../../src/sim/types.js";

/**
 * The graph is walkable end to end. The sim has no pathing, so each edge is walked separately: the
 * player is placed at the edge's start, faced along it, and walked for as
 * many ticks as the edge is long; it must stay grounded and arrive within a
 * few metres of the far node. Facing uses the movement vector directly —
 * `yaw` is only for the renderer's camera here, so we drive `moveX/moveZ`.
 */
// A timeout on the suite, as containment.test.ts carries one: each seed here
// builds a forest cold, which runs past vitest's 5 s default whenever this
// file shares the machine with the other forest suites. It guards a hang, not
// the run time.
describe("walking the trail graph", { timeout: 120_000 }, () => {
  setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
  for (const seed of [0x5eed, 1, 12345]) {
    it(`seed ${seed}: every edge is grounded and reaches its far node`, () => {
      const forest = createForest(seed);
      const world = createForestWorld(forest);
      // The walk measures the ground, not the Hollow. It crawls this very
      // stem, and on seed 12345 it meets the walker head-on: contact kills,
      // death is permanent, and every later edge would be walked by a corpse.
      // The chase is already on for the same reason: the walk teleports the
      // player onto every node, the crest among them, and on the climb that
      // reads as the find and steps a fresh Hollow out beside them
      // (summit.ts).
      world.state.phase = Phase.Chase;
      world.state.enemies.clear();
      const player = spawnPlayer(world);
      const { graph } = bowlFor(seed);
      for (const e of graph.edges) {
        const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
        const s = world.state.players.get(player.id)!;
        s.pos.x = a.x; s.pos.z = a.z; s.pos.y = elevationSampleAt(seed, a.x, a.z).h + PLAYER_HALF.y;
        s.vel.x = 0; s.vel.y = 0; s.vel.z = 0;
        const dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.sqrt(dx * dx + dz * dz);
        // Walk speed is 5.25 m/s at 60 Hz; allow 40% extra ticks for slopes.
        const ticks = Math.ceil((L / 5.25) * 60 * 1.4);
        let airborne = 0;
        let steepest = 0;
        for (let i = 0; i < ticks; i++) {
          const p = world.state.players.get(player.id)!;
          const rx = b.x - p.pos.x, rz = b.z - p.pos.z;
          const r = Math.sqrt(rx * rx + rz * rz);
          if (r < 1.5) break;
          // moveX/moveZ are in the player's yaw frame; with yaw = 0, moveZ is +z and moveX is +x.
          const cmd: InputCommand = { seq: i, moveX: rx / r, moveZ: rz / r, yaw: 0, pitch: 0, buttons: 0 };
          tickWorld(world, new Map([[player.id, cmd]]));
          const q = world.state.players.get(player.id)!;
          if (i > 30 && !q.grounded) airborne++;
          const g = elevationSampleAt(seed, q.pos.x, q.pos.z);
          steepest = Math.max(steepest, Math.sqrt(g.dx * g.dx + g.dz * g.dz));
        }
        const end = world.state.players.get(player.id)!;
        const gap = Math.sqrt((end.pos.x - b.x) ** 2 + (end.pos.z - b.z) ** 2);
        expect({ seed, kind: e.kind, a: e.a, b: e.b, gap: gap < 3, airborne, steepest: steepest <= MAX_WALKABLE_GRADIENT + 0.05 })
          .toEqual({ seed, kind: e.kind, a: e.a, b: e.b, gap: true, airborne: 0, steepest: true });
      }
    });
  }
});
