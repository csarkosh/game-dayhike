import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";
import "../../src/sim/passes/index.js";
import { facingYaw } from "../../src/sim/facing.js";
import { createForest } from "../../src/sim/forest.js";
import { trailheadStart } from "../../src/sim/spawn.js";
import { stemAhead } from "../../src/sim/trailRoute.js";
import type { InputCommand } from "../../src/sim/types.js";
import { createForestWorld, serializeWorldState, spawnPlayer, tickWorld, type World } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";

/**
 * Two scripted matches as they played out on 2026-11-19, by the digest of the host's whole state
 * every five seconds. The simulation is the same arithmetic on every peer, so a digest that moves
 * means the rules, the movement or the world under them changed: a client would no longer predict
 * what its host computes. The first twelve characters of each checkpoint are kept so that a
 * failure shows the tick the two parted at. Nothing here is steered by the platform's
 * trigonometry: the yaws are the simulation's own `facingYaw` or exact binary fractions.
 */

const SEED = seedFromToken("hollow39");
const TICKS = 3600;
const EVERY = 300;

type Script = (world: World, id: number, tick: number) => InputCommand;

/** Up the stem, sprinting in bursts, the lamp switched once. */
const climber: Script = (world, id, tick) => {
  const me = world.state.players.get(id);
  const graph = world.trail;
  const ahead = me === undefined || graph === null ? null : stemAhead(graph, me.pos.x, me.pos.z, 12);
  const yaw = me === undefined || ahead === null ? 0 : facingYaw(ahead.x - me.pos.x, ahead.z - me.pos.z);
  const buttons = (tick % 240 < 90 ? 8 : 0) | (tick === 200 ? 16 : 0) | (tick % 600 === 450 ? 1 : 0);
  return { seq: tick + 1, moveX: 0, moveZ: 1, yaw, pitch: -0.125, buttons };
};

/** Off the trail and round in circles, jumping and crouching. */
const wanderer: Script = (_world, _id, tick) => ({
  seq: tick + 1,
  moveX: tick % 180 < 90 ? 1 : -1,
  moveZ: tick % 400 < 300 ? 1 : 0,
  yaw: (tick % 512) / 64,
  pitch: ((tick % 64) - 32) / 128,
  buttons: (tick % 150 === 0 ? 2 : 0) | (tick % 700 > 600 ? 4 : 0),
});

/** Straight for the trailhead from wherever it stands, whatever is in the way. */
const runner: Script = (world, id, tick) => {
  const me = world.state.players.get(id);
  const home = trailheadStart(SEED);
  const yaw = me === undefined || home === null ? 0 : facingYaw(home.x - me.pos.x, home.z - me.pos.z);
  return { seq: tick + 1, moveX: 0, moveZ: 1, yaw, pitch: 0, buttons: 8 | (tick % 500 === 499 ? 32 : 0) };
};

type Played = { marks: string[]; whole: string; phase: number; outcome: number; enemies: number };

function play(scripts: readonly Script[], begin: (world: World, ids: readonly number[]) => void): Played {
  const world = createForestWorld(createForest(SEED), true, false);
  const ids = scripts.map(() => spawnPlayer(world).id);
  begin(world, ids);
  const whole = createHash("sha256");
  const marks: string[] = [];
  for (let tick = 0; tick < TICKS; tick++) {
    const inputs = new Map<number, InputCommand>();
    scripts.forEach((script, i) => inputs.set(ids[i] as number, script(world, ids[i] as number, tick)));
    tickWorld(world, inputs);
    if (tick % EVERY === EVERY - 1) {
      const state = serializeWorldState(world.state);
      whole.update(state).update("\n");
      marks.push(createHash("sha256").update(state).digest("hex").slice(0, 12));
    }
  }
  return { marks, whole: whole.digest("hex"), phase: world.state.phase, outcome: world.state.outcome, enemies: world.state.enemies.size };
}

describe("a match's identity", () => {
  it("a climb plays out as it did", () => {
    expect(play([climber, wanderer], () => {})).toEqual({
      marks: [
        "a77d86e2a7bc", "05a6a2bbbaef", "3851e45157f6", "4d3b0fae1b0e", "662a0f4a86d4", "9e9acb723a14",
        "c1f1143ecac8", "31e788e3513c", "a7b7ad35443c", "b036d9ce9c0a", "8f6b8660de34", "60e529a93807",
      ],
      whole: "6a6d3a116565335f891469e15de0b9dccf80193340a9fcdaac27de9165c9cff5",
      phase: 0, outcome: 0, enemies: 0,
    });
  }, timeLimit(120_000));

  it("a chase from the crest plays out as it did", () => {
    const played = play([runner, wanderer], (world, ids) => {
      const body = world.search?.body;
      const first = world.state.players.get(ids[0] as number);
      if (body === undefined || first === undefined) throw new Error("the default world has a body at its crest");
      first.pos = { x: body.pos.x + 4, y: body.pos.y + 1, z: body.pos.z };
    });
    expect(played).toEqual({
      marks: [
        "11132acf8b48", "cc16a7353e3b", "f848c5187fdd", "bf1415a24d5d", "c006a42f9ce0", "71a644c76cba",
        "83870de7b997", "12543823fdb1", "715fd121804f", "8973146fde3d", "db1c91fd1134", "bd8d058150f9",
      ],
      whole: "4e90207f9df4ca0fcddb5526933a4ff67f741dcface96be08e4a8a26e0992baa",
      phase: 1, outcome: 0, enemies: 2,
    });
  }, timeLimit(120_000));
});
