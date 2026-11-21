import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "@csarkosh/engine/sim/forest";
import { createForestWorld, spawnPlayer, tickWorld, type World } from "../../src/sim/world.js";
import { seedFromToken } from "@csarkosh/engine/game/seed";
import { DEFAULT_TERRAIN_VARIANT, setActiveTerrainVariant } from "@csarkosh/engine/sim/terrain";
import { Button, DeathCause, Outcome, Phase, type InputCommand, type PlayerState } from "../../src/sim/types.js";
import { OFF_TRAIL_M } from "../../src/sim/deathCause.js";
import { wayDirection, wayPoint } from "../../src/sim/wayDown.js";
import { wayOf } from "../../src/sim/wayDraw.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
const SUITE = { timeout: timeLimit(240_000) };

/** A forest world in the chase with its way drawn, and one player stood on the way 150 m down it, `side` metres to its left. */
function chase(side = 0, peaceful = false): { w: World; p: PlayerState } {
  const w = createForestWorld(createForest(seed), true, peaceful);
  wayOf(w);
  w.state.phase = Phase.Chase;
  const p = spawnPlayer(w);
  p.out = true;
  // A peaceful world draws no way: its player stays where they were put.
  if (w.way === null) return { w, p };
  const at = wayPoint(w.way, 150, { x: 0, z: 0 }), d = wayDirection(w.way, 150, { x: 0, z: 0 });
  const x = at.x - d.z * side, z = at.z + d.x * side;
  p.pos = { x, y: w.ground!.heightAt(x, z) + 0.9, z };
  return { w, p };
}
const says = (p: PlayerState, buttons: number): Map<number, InputCommand> => new Map([[p.id, { seq: 1, moveX: 0, moveZ: 0, yaw: p.yaw, pitch: 0, buttons }]]);

describe("a player a shade of their own crowd has", SUITE, () => {
  it("is said in a bit of the command's buttons no other verb uses", () => {
    expect(Button.Taken).toBe(32);
    for (const other of [Button.Interact, Button.Jump, Button.Crouch, Button.Sprint, Button.Lamp]) expect(other & Button.Taken).toBe(0);
    expect(Button.Taken).toBeLessThan(256);
  });

  it("dies of it on the tick the host hears it: for walking into it on the path, for being off the path beyond it", () => {
    const on = chase();
    tickWorld(on.w, says(on.p, Button.Taken));
    expect(on.p.health).toBe(0);
    expect([on.p.cause, on.p.killedBy]).toEqual([DeathCause.Into, 0]);
    // The chase holds a player to the path with its own slack (chaseLine.ts): well past it.
    const off = chase(OFF_TRAIL_M + 10);
    tickWorld(off.w, says(off.p, Button.Taken));
    expect(off.p.health).toBe(0);
    expect(off.p.cause).toBe(DeathCause.OffTrail);
  });

  it("is a death of the chase like any other: they fall where they stood and come back", () => {
    const { w, p } = chase();
    tickWorld(w, says(p, Button.Taken));
    expect(p.deathPos).not.toBeNull();
    expect(p.returnIn).toBeGreaterThan(0);
    expect(w.state.outcome).toBe(Outcome.Playing);
  });

  it("lives where nothing kills: on the climb, in the summit scene, on the road, in the hold after a return, in a decided match, in a peaceful world", () => {
    const tries: [string, (t: { w: World; p: PlayerState }) => void, boolean?][] = [
      ["the climb", (t) => { t.w.state.phase = Phase.Climb; }],
      ["the scene", (t) => { t.w.state.phase = Phase.Scene; }],
      ["the hold", (t) => { t.p.heldFor = 30; }],
      ["a decided match", (t) => { t.w.state.outcome = Outcome.Won; }],
      ["a peaceful world", () => undefined, true],
    ];
    for (const [name, make, peaceful] of tries) {
      const t = chase(0, peaceful === true);
      make(t);
      tickWorld(t.w, says(t.p, Button.Taken));
      expect(t.p.health, name).toBeGreaterThan(0);
    }
    // On the road: the corridor at the way's end.
    const road = chase();
    const end = wayPoint(road.w.way!, road.w.way!.length, { x: 0, z: 0 });
    road.p.pos = { x: end.x, y: road.w.ground!.heightAt(end.x, end.z) + 0.9, z: end.z };
    tickWorld(road.w, says(road.p, 0));
    if (road.p.safe) {
      tickWorld(road.w, says(road.p, Button.Taken));
      expect(road.p.health, "the road").toBeGreaterThan(0);
    }
  });

  it("is nothing to how a player moves: the same command with the bit and without it moves them alike on a world that makes no deaths", () => {
    const a = chase(0, true), b = chase(0, true);
    for (let i = 0; i < 30; i++) {
      tickWorld(a.w, new Map([[a.p.id, { seq: i, moveX: 0.3, moveZ: 1, yaw: 0.4, pitch: 0, buttons: Button.Sprint }]]));
      tickWorld(b.w, new Map([[b.p.id, { seq: i, moveX: 0.3, moveZ: 1, yaw: 0.4, pitch: 0, buttons: Button.Sprint | Button.Taken }]]));
    }
    expect(b.p.pos).toEqual(a.p.pos);
  });

  it("and nobody dies of it who does not say it", () => {
    const { w, p } = chase();
    tickWorld(w, says(p, Button.Sprint));
    expect(p.health).toBeGreaterThan(0);
  });
});
